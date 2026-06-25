// 추천 점수 — 빌드 시(enrich-places.mjs)와 런타임(app.js)이 공유하는 단일 진실원.
//
// 모델: "큐레이터 척추(Editorial Spine) + Bayesian 보정 + 카테고리별 거리 감쇠".
//  - 티어(must/rec/opt/discovered)가 정수 밴드(3/2/1/0)로 순위를 지배한다.
//  - 평점은 Bayesian 평탄화(Rb) + 리뷰수는 가산이 아닌 '신뢰 배수(cred)'로만 작동.
//  - 거리는 같은 티어 안에서만 재정렬(타이브레이커 합 0.90 < 밴드갭 1.0).
// 모든 상수는 SCORE_CONFIG / PROXIMITY_CONFIG 한 곳에서만 조정한다.

export const SCORE_CONFIG = {
  tierBase: { must: 3, rec: 2, opt: 1, discovered: 0 }, // 정수 밴드(갭 1.0)
  m: 120, // Bayesian 사전 리뷰수(약한 prior)
  C: 4.3, // Bayesian 사전 평균 평점
  ratingFloor: 4.0, // qN 하한(관광 평점대 4.3~4.8을 0~1로 펼침)
  ratingCeil: 5.0,
  credSat: 800, // 신뢰 배수 포화 리뷰수
  credMin: 0.6, // 신뢰 배수 하한(소수 리뷰도 0 아님)
  w_q: 0.55, // 품질 타이브레이커 가중
  w_d: 0.35, // 거리 타이브레이커 가중 (w_q+w_d=0.90 < 1.0 밴드갭 → 티어 불가침)
  detourFactor: 1.5, // haversine→실주행 보정(직선거리×1.5)
  fallbackKmh: 30, // /routes 도착 전 추정 주행속도
};

// 카테고리별 거리 감쇠: τ(분) 작을수록 '가까워야 점수', floor는 강등하되 삭제 안 함.
export const PROXIMITY_CONFIG = {
  카페: { tau: 8, floor: 0.15 },
  음식점: { tau: 12, floor: 0.2 },
  쇼핑: { tau: 20, floor: 0.4 },
  관광명소: { tau: 30, floor: 0.5 },
  "문화·역사": { tau: 30, floor: 0.5 },
  "자연·공원": { tau: 35, floor: 0.45 },
};

// 탭 순서(첫 항목은 전체 catch-all).
export const CATEGORIES = ["추천", "관광명소", "음식점", "카페", "쇼핑", "자연·공원", "문화·역사"];

// 음식점/카페 자동발견 설정 (Worker /nearby + 프론트 공유).
//  - rankPreference POPULARITY: 가까운순(DISTANCE) 대신 화제성순 → 저품질 배제.
//  - radii 다중 링: 동네 숨은맛집(800m) + 도시 화제맛집(2km)을 합쳐 20개 상한 완화.
//  - minRating/minReviews: 신뢰도 필터. 리뷰 기준은 카테고리별(식당 1000 / 카페 500).
export const DISCOVERY_CONFIG = {
  rankPreference: "POPULARITY",
  radii: [800, 2000],
  minRating: 4.0,
  minReviews: { 음식점: 1000, 카페: 500 },
  maxResults: 12, // 화면 표시 상한
};

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// Bayesian 평탄화 평점: 리뷰 적을수록 사전평균 C로 끌어당김.
export function bayesRating(rating, v, cfg = SCORE_CONFIG) {
  const r = Number(rating) || 0;
  const n = Number(v) || 0;
  return (n * r + cfg.m * cfg.C) / (n + cfg.m);
}

// 품질 정규화 0..1 (floor 4.0 기준).
export function qualityNorm(Rb, cfg = SCORE_CONFIG) {
  return clamp((Rb - cfg.ratingFloor) / (cfg.ratingCeil - cfg.ratingFloor), 0, 1);
}

// 신뢰 배수 0.6..1: 리뷰수가 가산이 아니라 품질의 '확신도'를 곱한다.
export function credibility(v, cfg = SCORE_CONFIG) {
  const n = Number(v) || 0;
  return clamp(Math.log10(1 + n) / Math.log10(1 + cfg.credSat), cfg.credMin, 1);
}

// 정적 점수(출발지 무관, places.json에 저장): tierBase + w_q·qN·cred.
export function staticScore(place, cfg = SCORE_CONFIG) {
  const tier = place.tier ?? "discovered";
  const base = cfg.tierBase[tier] ?? 0;
  const Rb = bayesRating(place.rating, place.userRatingCount, cfg);
  const qN = qualityNorm(Rb, cfg);
  const cred = credibility(place.userRatingCount, cfg);
  return base + cfg.w_q * qN * cred;
}

// 카테고리별 거리 감쇠 0..1 (driveMin 작을수록 1).
export function proximityNorm(driveMin, category, cfg = SCORE_CONFIG) {
  const p = PROXIMITY_CONFIG[category] || PROXIMITY_CONFIG["관광명소"];
  if (driveMin == null || !isFinite(driveMin)) return p.floor;
  return p.floor + (1 - p.floor) * Math.exp(-driveMin / p.tau);
}

// 최종 점수(런타임·출발지별, 추천순): staticScore + w_d·prox. driveMin 없으면 정적값.
export function finalScore(place, driveMin, cfg = SCORE_CONFIG) {
  const s = place.staticScore != null ? place.staticScore : staticScore(place, cfg);
  if (driveMin == null || !isFinite(driveMin)) return s;
  return s + cfg.w_d * proximityNorm(driveMin, place.category, cfg);
}

// 직선거리(km).
export function haversineKm(a, b) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// /routes 도착 전 직선거리 기반 주행시간(분) 추정.
export function estDriveMin(km, cfg = SCORE_CONFIG) {
  return (km * cfg.detourFactor) / cfg.fallbackKmh * 60;
}

// ---- 카테고리 해석 (Google primaryType/types → 단일 탭) ----
// 우선순위 그룹(food>cafe>shop>nature>culture>sights). types[] 스캔에 이 순서를 쓴다.
// 주의: historical_landmark 는 Google이 현대 랜드마크(페트로나스·KL타워)에도 붙이므로 관광명소로.
const CAT_PRIORITY = [
  ["음식점", new Set([
    "restaurant", "indian_restaurant", "chinese_restaurant", "japanese_restaurant",
    "seafood_restaurant", "fast_food_restaurant", "fine_dining_restaurant", "sushi_restaurant",
    "steak_house", "barbecue_restaurant", "buffet_restaurant", "thai_restaurant",
    "italian_restaurant", "mexican_restaurant", "korean_restaurant", "vietnamese_restaurant",
    "ramen_restaurant", "asian_restaurant", "food_court", "meal_takeaway", "meal_delivery", "food",
  ])],
  ["카페", new Set([
    "cafe", "coffee_shop", "bakery", "tea_house", "dessert_shop", "ice_cream_shop",
    "juice_shop", "cafeteria",
  ])],
  ["쇼핑", new Set([
    "shopping_mall", "department_store", "market", "supermarket", "gift_shop", "store",
    "plaza", "clothing_store", "convenience_store",
  ])],
  ["자연·공원", new Set([
    "park", "national_park", "botanical_garden", "garden", "hiking_area", "beach",
    "natural_feature", "wildlife_park", "wildlife_refuge", "zoo", "aquarium",
  ])],
  ["문화·역사", new Set([
    "place_of_worship", "mosque", "hindu_temple", "buddhist_temple", "church", "synagogue",
    "museum", "art_gallery", "historical_place", "monument", "cultural_landmark",
    "performing_arts_theater",
  ])],
  ["관광명소", new Set([
    "tourist_attraction", "landmark", "historical_landmark", "observation_deck",
    "amusement_park", "viewpoint", "point_of_interest",
  ])],
];

// 단일 타입 → 탭 (primaryType 조회용; CAT_PRIORITY 순서로 첫 매치).
const TYPE_TO_CAT = new Map();
for (const [cat, set] of CAT_PRIORITY) {
  for (const t of set) if (!TYPE_TO_CAT.has(t)) TYPE_TO_CAT.set(t, cat);
}

// override → primaryType(권위) → types[] 우선순위 스캔 → 기본 관광명소.
// primaryType 이 매핑되면 그것이 이긴다(예: KL타워의 primaryType는 랜드마크이므로
// types 안의 restaurant 때문에 음식점으로 오분류되지 않는다).
export function categoryOf(primaryType, types = [], override) {
  if (override) return override;
  if (primaryType && TYPE_TO_CAT.has(primaryType)) return TYPE_TO_CAT.get(primaryType);
  for (const [cat, set] of CAT_PRIORITY) {
    if ((types || []).some((t) => set.has(t))) return cat;
  }
  return "관광명소";
}

// /nearby용 탭→Google includedTypes (worker도 동일 맵을 사용; 발견 대상은 음식점/카페).
export const INCLUDED_TYPES = {
  음식점: ["restaurant", "food_court", "meal_takeaway"],
  카페: ["cafe", "coffee_shop", "bakery"],
};
