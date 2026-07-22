// paldo-proxy — Google 키를 서버측에 숨기는 Cloudflare Worker 프록시.
// 프론트(GitHub Pages)는 키를 갖지 않고 이 Worker 만 호출한다.
//
// POST 엔드포인트 (JSON):
//   /autocomplete  {input,sessionToken}             → [{placeId,primary,secondary}]
//   /place-details {placeId,sessionToken}           → {lat,lng,label}
//   /geocode       {address}                        → {lat,lng,formattedAddress}
//   /resolve-link  {shareUrl}                        → {lat,lng,label}
//   /routes        {origin,destinations:[{lat,lng}]} → [{distanceMeters,durationSeconds}]
//   /nearby        {center,category,radius?}          → [{placeId,name,...,primaryType,types}]
// GET 엔드포인트:
//   /photo?name=&maxw=       → 이미지 바이트 스트리밍
// (날씨·대기질은 Open-Meteo 가 CORS 를 허용하므로 프론트에서 직접 호출한다 — 프록시 불필요.)
//
// 시크릿:  GOOGLE_MAPS_API_KEY  (wrangler secret put)
// 변수:    ALLOWED_ORIGIN       (CORS 허용 오리진; 운영 시 Pages 오리진으로 고정)
//
// GCP 활성화 필요: Geocoding API, Routes API, (Places API New).

function corsHeaders(env) {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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
  url.searchParams.set("region", "th");
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
    includedRegionCodes: ["th"], // 태국으로 한정
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

// ---- Nearby Search (New): 좌표 주변 카테고리 자동발견 (음식점/카페) ----
// lib/score.mjs 의 INCLUDED_TYPES 와 동기화. 모든 타입은 Nearby 유효성 검증됨.
const NEARBY_INCLUDED_TYPES = {
  추천: ["restaurant", "cafe", "tourist_attraction", "shopping_mall"], // 메인 탭 혼합 발견
  음식점: ["restaurant", "food_court", "meal_takeaway"],
  카페: ["cafe", "coffee_shop", "bakery"],
  관광명소: ["tourist_attraction", "observation_deck", "amusement_park", "historical_landmark"],
  쇼핑: ["shopping_mall", "department_store", "market"],
  "문화·역사": ["buddhist_temple", "museum", "art_gallery", "hindu_temple", "church", "monument", "performing_arts_theater"],
  "자연·공원": ["park", "botanical_garden", "garden", "zoo", "aquarium", "national_park"],
};

const NEARBY_FIELD_MASK =
  "places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.primaryType,places.primaryTypeDisplayName,places.types,places.photos";

async function searchNearbyRing(center, includedTypes, radius, rankPreference, env) {
  const res = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": env.GOOGLE_MAPS_API_KEY,
      "X-Goog-FieldMask": NEARBY_FIELD_MASK,
    },
    body: JSON.stringify({
      includedTypes,
      maxResultCount: 20,
      rankPreference, // POPULARITY → 화제성순(저품질 배제)
      languageCode: "ko",
      locationRestriction: {
        circle: { center: { latitude: center.lat, longitude: center.lng }, radius },
      },
    }),
  });
  if (!res.ok) throw new Error(`nearby http ${res.status} ${await res.text()}`);
  return (await res.json()).places || [];
}

// 다중 링(동네+도시)을 합쳐 placeId로 중복 제거하고 품질 필터(평점/리뷰)를 적용한다.
async function nearby(center, category, env, opts = {}) {
  const includedTypes = NEARBY_INCLUDED_TYPES[category];
  if (!includedTypes) throw new Error(`지원하지 않는 카테고리: ${category}`);

  const radii = Array.isArray(opts.radii) && opts.radii.length ? opts.radii : [2000];
  const rankPreference = opts.rankPreference || "POPULARITY";
  const minRating = Number(opts.minRating) || 0;
  const minReviews = Number(opts.minReviews) || 0;

  const byId = new Map();
  for (const radius of radii) {
    const ring = await searchNearbyRing(center, includedTypes, radius, rankPreference, env);
    for (const p of ring) if (p.id && !byId.has(p.id)) byId.set(p.id, p);
  }

  return [...byId.values()]
    .filter((p) => (p.rating ?? 0) >= minRating && (p.userRatingCount ?? 0) >= minReviews)
    .map((p) => ({
      placeId: p.id,
      name: p.displayName?.text ?? "",
      address: p.formattedAddress ?? "",
      lat: p.location?.latitude ?? null,
      lng: p.location?.longitude ?? null,
      rating: p.rating ?? null,
      userRatingCount: p.userRatingCount ?? null,
      primaryType: p.primaryType ?? null,
      primaryTypeDisplayName: p.primaryTypeDisplayName?.text ?? null,
      types: p.types ?? [],
      photoName: p.photos?.[0]?.name ?? null,
    }));
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(env) });
    }

    const url = new URL(request.url);

    // GET /photo?name=places/.../photos/...&maxw=800 → 이미지 바이트를 직접 스트리밍.
    // (302 리다이렉트 대신 단일 200 응답 — 다수 동시 로드 시 더 안정적.)
    // <img src> 가 GET 으로 부르므로 POST 가드 앞에서 처리한다.
    if (url.pathname === "/photo" && request.method === "GET") {
      const name = url.searchParams.get("name");
      const maxw = url.searchParams.get("maxw") || "800";
      if (!name) return new Response("name required", { status: 400 });
      try {
        const meta = await fetch(
          `https://places.googleapis.com/v1/${name}/media?maxWidthPx=${maxw}&skipHttpRedirect=true`,
          { headers: { "X-Goog-Api-Key": env.GOOGLE_MAPS_API_KEY } }
        );
        if (!meta.ok) return new Response("photo error", { status: 502 });
        const { photoUri } = await meta.json();
        const img = await fetch(photoUri);
        if (!img.ok) return new Response("image error", { status: 502 });
        return new Response(img.body, {
          status: 200,
          headers: {
            "Content-Type": img.headers.get("Content-Type") || "image/jpeg",
            "Cache-Control": "public, max-age=86400",
            "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
          },
        });
      } catch (err) {
        return new Response(String(err.message || err), { status: 502 });
      }
    }

    if (request.method !== "POST") {
      return json({ error: "POST only" }, env, 405);
    }

    const path = url.pathname;
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

      if (path === "/nearby") {
        const { center, category, radii, rankPreference, minRating, minReviews } = payload;
        if (!center || !category) return json({ error: "center and category required" }, env, 400);
        if (!NEARBY_INCLUDED_TYPES[category]) {
          return json({ error: `지원하지 않는 카테고리: ${category}` }, env, 400);
        }
        if (!Number.isFinite(center.lat) || !Number.isFinite(center.lng)) {
          return json({ error: "center.lat/lng must be finite numbers" }, env, 400);
        }
        const rs = Array.isArray(radii) ? radii : null;
        if (rs && rs.some((r) => !Number.isFinite(r) || r <= 0 || r > 50000)) {
          return json({ error: "each radius must be in (0, 50000]" }, env, 400);
        }
        return json(
          await nearby(center, category, env, { radii: rs, rankPreference, minRating, minReviews }),
          env
        );
      }

      return json({ error: "not found" }, env, 404);
    } catch (err) {
      return json({ error: String(err.message || err) }, env, 502);
    }
  },
};
