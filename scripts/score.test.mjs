// 점수 모델 스냅샷 테스트 — 의존성 없음.
//   node scripts/score.test.mjs
// 실 8핀의 staticScore가 설계 워크드넘버와 일치하는지, 불변식·카테고리 매핑을 단언한다.

import {
  SCORE_CONFIG,
  staticScore,
  finalScore,
  proximityNorm,
  categoryOf,
} from "../lib/score.mjs";

let pass = 0;
let fail = 0;
function approx(name, got, want, tol = 0.005) {
  const ok = Math.abs(got - want) <= tol;
  console.log(`  ${ok ? "✓" : "✗"} ${name}: got ${got.toFixed(4)} want ~${want}`);
  ok ? pass++ : fail++;
}
function eq(name, got, want) {
  const ok = got === want;
  console.log(`  ${ok ? "✓" : "✗"} ${name}: ${JSON.stringify(got)}${ok ? "" : ` (want ${JSON.stringify(want)})`}`);
  ok ? pass++ : fail++;
}
function ok(name, cond) {
  console.log(`  ${cond ? "✓" : "✗"} ${name}`);
  cond ? pass++ : fail++;
}

// 실 8핀 (tier는 시드대로)
const PINS = [
  { name: "Petronas", rating: 4.7, userRatingCount: 102745, tier: "must", want: 3.385 },
  { name: "Putra Mosque", rating: 4.7, userRatingCount: 24100, tier: "rec", want: 2.385 },
  { name: "Batu Caves", rating: 4.4, userRatingCount: 79393, tier: "rec", want: 2.22 },
  { name: "Suria KLCC", rating: 4.6, userRatingCount: 75144, tier: "opt", want: 1.33 },
  { name: "KL Tower", rating: 4.5, userRatingCount: 41741, tier: "opt", want: 1.275 },
  { name: "Botanical", rating: 4.5, userRatingCount: 8811, tier: "opt", want: 1.274 },
  { name: "Seri Wawasan", rating: 4.5, userRatingCount: 2939, tier: "opt", want: 1.271 },
  { name: "Central Market", rating: 4.3, userRatingCount: 60435, tier: "opt", want: 1.165 },
];

console.log("staticScore vs 워크드넘버:");
for (const p of PINS) approx(p.name, staticScore(p), p.want);

console.log("\n정적 순위(내림차순):");
const order = [...PINS].sort((a, b) => staticScore(b) - staticScore(a)).map((p) => p.name);
console.log("  " + order.join(" > "));
eq("Putra가 Batu보다 위(리뷰 독점 깨짐)", order.indexOf("Putra Mosque") < order.indexOf("Batu Caves"), true);
eq("Petronas #1", order[0], "Petronas");

console.log("\n불변식:");
ok("w_q+w_d = 0.90 < 1.0 (밴드갭)", SCORE_CONFIG.w_q + SCORE_CONFIG.w_d < 1.0);
// 거리 최대치를 줘도 opt(=1) 최상이 rec(=2) 최하를 못 넘는다.
const optMax = finalScore({ ...PINS[3], staticScore: staticScore(PINS[3]), category: "쇼핑" }, 0);
const recMin = finalScore({ ...PINS[2], staticScore: staticScore(PINS[2]), category: "문화·역사" }, 999);
ok(`opt 최상(거리0)=${optMax.toFixed(3)} < rec 최하(거리∞)=${recMin.toFixed(3)}`, optMax < recMin);

console.log("\ncategoryOf 매핑:");
eq("Petronas(tourist_attraction)", categoryOf("tourist_attraction", ["point_of_interest"]), "관광명소");
eq("Putra(mosque+tourist_attraction)", categoryOf("mosque", ["place_of_worship", "tourist_attraction"]), "문화·역사");
eq("Suria(shopping_mall)", categoryOf("shopping_mall", []), "쇼핑");
eq("Botanical(botanical_garden)", categoryOf("botanical_garden", ["park"]), "자연·공원");
eq("카페(cafe)", categoryOf("cafe", []), "카페");
eq("null 타입 → 관광명소 폴백", categoryOf(null, []), "관광명소");
eq("override 우선", categoryOf("restaurant", [], "관광명소"), "관광명소");
eq("historical_landmark → 관광명소(현대 랜드마크)", categoryOf("historical_landmark", ["tourist_attraction"]), "관광명소");
eq("primaryType가 types의 restaurant를 이김(KL타워)", categoryOf("historical_landmark", ["restaurant", "tourist_attraction"]), "관광명소");
// primaryType 권위 — types 폴백 제거(매장 안 식당 누수 차단)
eq("호텔은 음식점 아님(in-house 식당 무시)", categoryOf("hotel", ["restaurant"]), "관광명소");
eq("cultural_center → 문화·역사(REXKL)", categoryOf("cultural_center", ["restaurant"]), "문화·역사");
eq("coffee_roastery → 카페(Feeka)", categoryOf("coffee_roastery", ["restaurant"]), "카페");
eq("*_restaurant 접미사 → 음식점", categoryOf("thai_restaurant", []), "음식점");
// 치앙마이: 사원이 문화 카테고리의 핵심 — 자동발견/분류 양쪽에서 빠지면 탭이 빈다.
eq("buddhist_temple → 문화·역사(왓)", categoryOf("buddhist_temple", ["tourist_attraction"]), "문화·역사");
eq("lake → 자연·공원(후아이 뜽타오)", categoryOf("lake", ["natural_feature"]), "자연·공원");
eq("night_club → 음식점/카페 아님", categoryOf("night_club", ["restaurant"]) !== "음식점" && categoryOf("night_club", []) !== "카페", true);

console.log("\nproximityNorm 단조성(카페):");
ok("가까울수록 큼", proximityNorm(2, "카페") > proximityNorm(30, "카페"));
ok("floor 하한", proximityNorm(9999, "카페") >= PROXIMITY_FLOOR());
function PROXIMITY_FLOOR() { return 0.15; }

console.log(`\n결과: ${pass} pass · ${fail} fail`);
process.exit(fail ? 1 : 0);
