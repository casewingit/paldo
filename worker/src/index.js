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
// GET 엔드포인트 (키 불필요 정부 공개 데이터 프록시 — data.gov.my 는 CORS 미허용이라 여기서 우회):
//   /photo?name=&maxw=       → 이미지 바이트 스트리밍
//   /weather-warning         → [{title,text,validFrom,validTo,...}] (활성·KL권역 육상 경보만)
//   /weather-forecast?location= → {date,summary,summaryWhen,minTemp,maxTemp,...} (해당 지역 오늘 예보)
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

// ---- Nearby Search (New): 좌표 주변 카테고리 자동발견 (음식점/카페) ----
// lib/score.mjs 의 INCLUDED_TYPES 와 동기화. 모든 타입은 Nearby 유효성 검증됨.
const NEARBY_INCLUDED_TYPES = {
  음식점: ["restaurant", "food_court", "meal_takeaway"],
  카페: ["cafe", "coffee_shop", "bakery"],
  관광명소: ["tourist_attraction", "observation_deck", "amusement_park", "historical_landmark"],
  쇼핑: ["shopping_mall", "department_store", "market"],
  "문화·역사": ["museum", "art_gallery", "mosque", "hindu_temple", "church", "monument", "performing_arts_theater"],
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

// ---- data.gov.my 날씨(MET Malaysia 공식) 프록시 ----
// data.gov.my 는 CORS 헤더가 없어 브라우저가 직접 못 부른다 → 서버측에서 받아 우리 CORS 로 재포장.
// 시각 문자열은 타임존 표기 없는 MYT(UTC+8) wall-clock → "UTC 로 파싱"하는 동일 규칙으로 비교(일관성만 유지).
const DATAGOV = "https://api.data.gov.my/weather";
const MYT_OFFSET = 8 * 3600 * 1000;
const RE_MARINE = /waters of|perairan|rough seas|laut bergelora/i; // 해상 경보(도심 여행 무관) 제외용
// KL권역만. "Wilayah Persekutuan" 단독은 라부안(동말레이시아)까지 매치하므로 제외 —
// KL/푸트라자야 경보는 텍스트에 항상 "Kuala Lumpur"/"Putrajaya" 가 명시된다.
const RE_KL = /Kuala Lumpur|Selangor|Putrajaya|\bKlang\b/i;

function wallClockEpoch(s) {
  if (!s) return null;
  const t = Date.parse(s + "Z"); // MYT wall-clock 을 UTC 로 간주(비교 일관성용)
  return Number.isFinite(t) ? t : null;
}

// 활성 + No-Advisory 아님 + 해상 아님 + KL/셀랑오르 권역 텍스트 매치만 통과.
function filterWarnings(list, nowWallEpoch) {
  return list
    .filter((w) => {
      // heading_en 은 경보별 실제 종류, title_en 은 게시판 공통 헤드라인 → 둘 다로 판정.
      const head = `${w.heading_en || ""} ${w.warning_issue?.title_en || ""}`;
      if (/no advisory/i.test(head) || !w.valid_from) return false; // 사이클론 '없음' 플레이스홀더 제거
      const from = wallClockEpoch(w.valid_from);
      const to = wallClockEpoch(w.valid_to);
      if (from == null || to == null) return false;
      if (!(from <= nowWallEpoch && nowWallEpoch <= to)) return false; // 만료/미래 제외
      const text = w.text_en || "";
      if (RE_MARINE.test(head) || RE_MARINE.test(text)) return false;
      return RE_KL.test(text);
    })
    .map((w) => ({
      title: w.heading_en || w.warning_issue?.title_en || "", // 경보별 종류 우선
      issued: w.warning_issue?.issued || null,
      text: w.text_en || "",
      instruction: w.instruction_en || null,
      validFrom: w.valid_from,
      validTo: w.valid_to,
    }));
}

// data.gov.my 가 멈추면 Worker 가 벽시계 한도까지 매달리지 않도록 8초 타임아웃.
const govFetch = (url) =>
  fetch(url, { headers: { "User-Agent": "paldo-proxy" }, signal: AbortSignal.timeout(8000) });

async function weatherWarnings(_env) {
  const res = await govFetch(`${DATAGOV}/warning/`);
  if (!res.ok) throw new Error(`warning http ${res.status}`);
  const list = await res.json();
  return filterWarnings(Array.isArray(list) ? list : [], Date.now() + MYT_OFFSET);
}

async function weatherForecast(location, _env) {
  const url = `${DATAGOV}/forecast/?contains=${encodeURIComponent(location)}@location__location_name`;
  const res = await govFetch(url);
  if (!res.ok) throw new Error(`forecast http ${res.status}`);
  const list = await res.json();
  const today = new Date(Date.now() + MYT_OFFSET).toISOString().slice(0, 10);
  // contains 는 부분일치라 정확한 location_name + 오늘 날짜로 한 건만 고른다(대소문자·공백 관대).
  const want = location.trim().toLowerCase();
  const r = (Array.isArray(list) ? list : []).find(
    (x) => x.date === today && (x.location?.location_name || "").trim().toLowerCase() === want
  );
  if (!r) return null;
  return {
    date: r.date,
    location: r.location?.location_name ?? location,
    morning: r.morning_forecast ?? null,
    afternoon: r.afternoon_forecast ?? null,
    night: r.night_forecast ?? null,
    summary: r.summary_forecast ?? null,
    summaryWhen: r.summary_when ?? null,
    minTemp: r.min_temp ?? null,
    maxTemp: r.max_temp ?? null,
  };
}

function govJson(data, env, maxAge) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": `public, max-age=${maxAge}`,
      "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
    },
  });
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

    // GET /weather-warning → 활성·KL권역 육상 경보(없으면 빈 배열). data.gov.my 우회 + 우리 CORS.
    if (url.pathname === "/weather-warning" && request.method === "GET") {
      try {
        return govJson(await weatherWarnings(env), env, 600);
      } catch (err) {
        return json({ error: String(err.message || err) }, env, 502);
      }
    }

    // GET /weather-forecast?location=Kuala Lumpur → 해당 지역 오늘 예보(없으면 null).
    if (url.pathname === "/weather-forecast" && request.method === "GET") {
      const location = url.searchParams.get("location") || "Kuala Lumpur";
      try {
        return govJson(await weatherForecast(location, env), env, 1800);
      } catch (err) {
        return json({ error: String(err.message || err) }, env, 502);
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
