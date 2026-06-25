// paldo-proxy — Google 키를 서버측에 숨기는 Cloudflare Worker 프록시.
// 프론트(GitHub Pages)는 키를 갖지 않고 이 Worker 만 호출한다.
//
// 엔드포인트 (모두 POST, JSON):
//   /geocode       {address}                       → {lat,lng,formattedAddress}
//   /resolve-link  {shareUrl}                       → {lat,lng,label}
//   /routes        {origin,destinations:[{lat,lng}]}→ [{distanceMeters,durationSeconds}]
//
// 시크릿:  GOOGLE_MAPS_API_KEY  (wrangler secret put)
// 변수:    ALLOWED_ORIGIN       (CORS 허용 오리진; 운영 시 Pages 오리진으로 고정)
//
// GCP 활성화 필요: Geocoding API, Routes API, (Places API New).

function corsHeaders(env) {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function json(data, env, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(env) },
  });
}

// ---- Google Geocoding: 주소 → 좌표 ----
async function geocode(address, env) {
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", address);
  url.searchParams.set("language", "ko");
  url.searchParams.set("region", "my");
  url.searchParams.set("key", env.GOOGLE_MAPS_API_KEY);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`geocode http ${res.status}`);
  const data = await res.json();
  // Geocoding 은 항상 200 을 주고 status 필드로 결과를 알린다.
  if (data.status && data.status !== "OK") {
    throw new Error(data.error_message || `geocode ${data.status}`);
  }
  const hit = data.results?.[0];
  if (!hit) throw new Error("주소를 찾지 못했어요.");
  return {
    lat: hit.geometry.location.lat,
    lng: hit.geometry.location.lng,
    formattedAddress: hit.formatted_address,
  };
}

// ---- Places Autocomplete (New): 입력 텍스트 → 후보 목록 ----
// 같은 검색 세션 동안 sessionToken 을 재사용하면 키 입력 단위 과금이 묶인다.
async function autocomplete(input, sessionToken, env) {
  const body = {
    input,
    languageCode: "ko",
    includedRegionCodes: ["my"], // 말레이시아로 한정
  };
  if (sessionToken) body.sessionToken = sessionToken;

  const res = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": env.GOOGLE_MAPS_API_KEY,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`autocomplete http ${res.status} ${await res.text()}`);

  const data = await res.json();
  return (data.suggestions || [])
    .map((s) => {
      const p = s.placePrediction;
      if (!p) return null;
      return {
        placeId: p.placeId,
        primary: p.structuredFormat?.mainText?.text || p.text?.text || "",
        secondary: p.structuredFormat?.secondaryText?.text || "",
      };
    })
    .filter(Boolean);
}

// ---- Place Details (New): placeId → 좌표 + 이름 ----
// sessionToken 을 함께 보내면 위 autocomplete 세션을 닫아 묶음 과금된다.
async function placeDetails(placeId, sessionToken, env) {
  const url = new URL(`https://places.googleapis.com/v1/places/${placeId}`);
  url.searchParams.set("languageCode", "ko");
  if (sessionToken) url.searchParams.set("sessionToken", sessionToken);

  const res = await fetch(url, {
    headers: {
      "X-Goog-Api-Key": env.GOOGLE_MAPS_API_KEY,
      "X-Goog-FieldMask": "location,displayName,formattedAddress",
    },
  });
  if (!res.ok) throw new Error(`details http ${res.status} ${await res.text()}`);

  const p = await res.json();
  return {
    lat: p.location?.latitude ?? null,
    lng: p.location?.longitude ?? null,
    label: p.displayName?.text || p.formattedAddress || "선택한 장소",
  };
}

// ---- 공유링크 해석: maps.app.goo.gl/... → 좌표 (+가능하면 이름) ----
// 비공식 스크랩. 3단계 캐스케이드로 시도하고 실패 시 null.
async function resolveShareLink(shareUrl) {
  const res = await fetch(shareUrl, {
    redirect: "follow",
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  const finalUrl = res.url;
  const html = await res.text();

  let m = finalUrl.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  if (!m) m = finalUrl.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (!m) m = html.match(/center=(-?\d+\.\d+)(?:%2C|,)(-?\d+\.\d+)/);
  if (!m) return null;

  let label = null;
  const nameMatch = finalUrl.match(/\/maps\/place\/([^/]+)/);
  if (nameMatch) label = decodeURIComponent(nameMatch[1].replace(/\+/g, " "));

  return { lat: Number(m[1]), lng: Number(m[2]), label };
}

// ---- Routes: 출발지 1 → 목적지 N 거리/시간 (computeRouteMatrix 1콜) ----
async function routeMatrix(origin, destinations, env) {
  const body = {
    origins: [
      { waypoint: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } } },
    ],
    destinations: destinations.map((d) => ({
      waypoint: { location: { latLng: { latitude: d.lat, longitude: d.lng } } },
    })),
    travelMode: "DRIVE",
    routingPreference: "TRAFFIC_AWARE",
  };

  const res = await fetch("https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": env.GOOGLE_MAPS_API_KEY,
      "X-Goog-FieldMask": "originIndex,destinationIndex,distanceMeters,duration,condition",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`routes http ${res.status} ${await res.text()}`);

  const rows = await res.json(); // [{destinationIndex,distanceMeters,duration:"123s",condition}]
  const out = destinations.map(() => null);
  for (const row of rows) {
    if (row.condition !== "ROUTE_EXISTS") continue;
    out[row.destinationIndex] = {
      distanceMeters: row.distanceMeters,
      durationSeconds: Number(String(row.duration).replace("s", "")) || 0,
    };
  }
  return out;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(env) });
    }
    if (request.method !== "POST") {
      return json({ error: "POST only" }, env, 405);
    }

    const path = new URL(request.url).pathname;
    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ error: "invalid JSON body" }, env, 400);
    }

    try {
      if (path === "/autocomplete") {
        if (!payload.input) return json({ error: "input required" }, env, 400);
        return json(await autocomplete(payload.input, payload.sessionToken, env), env);
      }

      if (path === "/place-details") {
        if (!payload.placeId) return json({ error: "placeId required" }, env, 400);
        return json(await placeDetails(payload.placeId, payload.sessionToken, env), env);
      }

      if (path === "/geocode") {
        if (!payload.address) return json({ error: "address required" }, env, 400);
        return json(await geocode(payload.address, env), env);
      }

      if (path === "/resolve-link") {
        if (!payload.shareUrl) return json({ error: "shareUrl required" }, env, 400);
        const r = await resolveShareLink(payload.shareUrl);
        if (!r) return json({ error: "링크에서 좌표를 찾지 못했어요." }, env, 422);
        return json(r, env);
      }

      if (path === "/routes") {
        const { origin, destinations } = payload;
        if (!origin || !Array.isArray(destinations) || !destinations.length) {
          return json({ error: "origin and destinations[] required" }, env, 400);
        }
        return json(await routeMatrix(origin, destinations, env), env);
      }

      return json({ error: "not found" }, env, 404);
    } catch (err) {
      return json({ error: String(err.message || err) }, env, 502);
    }
  },
};
