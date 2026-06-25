// 빌드 시 1회 실행: places-source.json 의 큐레이션 핀을 Google Places API (New) 로
// 해석해 좌표·place_id·평점·리뷰수를 받아오고, 추천 점수를 계산해 places.json 에 캐시한다.
//
// 사용법:
//   node --env-file=.env scripts/enrich-places.mjs          (변경분만)
//   node --env-file=.env scripts/enrich-places.mjs --force   (전체 재해석)
//
// - 키는 환경변수(GOOGLE_MAPS_API_KEY)로만 쓰고 레포에는 절대 저장하지 않는다.
// - API 결과(좌표/평점 등)는 캐시하고, note/boost/tags/score 는 매 실행 시 소스에서
//   다시 반영한다(메모만 고쳐도 API 재호출이 필요 없게).
// - GCP: "Places API (New)" 필요. shareUrl 항목을 쓰면 좌표 스크랩에 추가 권한은 불필요.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { staticScore, categoryOf, bayesRating, qualityNorm, credibility } from "../lib/score.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SOURCE_PATH = join(ROOT, "places-source.json");
const CACHE_PATH = join(ROOT, "places.json");

const API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const FORCE = process.argv.includes("--force");

if (!API_KEY) {
  console.error("✗ GOOGLE_MAPS_API_KEY 환경변수가 필요합니다.");
  console.error("  예) node --env-file=.env scripts/enrich-places.mjs");
  process.exit(1);
}

async function loadJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

const FIELD_MASK =
  "places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.primaryType,places.primaryTypeDisplayName,places.types,places.photos";

// Places API (New) Text Search — 텍스트 검색어 → 첫 결과의 좌표/평점/리뷰수.
// locationBias 가 있으면 그 좌표 주변으로 결과를 좁힌다(공유링크 보강용).
async function searchText(textQuery, locationBias) {
  const body = { textQuery, languageCode: "ko", regionCode: "MY" };
  if (locationBias) {
    body.locationBias = { circle: { center: locationBias, radius: 200.0 } };
  }
  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": API_KEY,
      "X-Goog-FieldMask": FIELD_MASK,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text()}`);
  const place = (await res.json()).places?.[0];
  if (!place) return null;
  return {
    placeId: place.id,
    name: place.displayName?.text ?? textQuery,
    address: place.formattedAddress ?? "",
    lat: place.location?.latitude ?? null,
    lng: place.location?.longitude ?? null,
    rating: place.rating ?? null,
    userRatingCount: place.userRatingCount ?? null,
    primaryType: place.primaryType ?? null,
    primaryTypeDisplayName: place.primaryTypeDisplayName?.text ?? null,
    types: place.types ?? [],
    photoName: place.photos?.[0]?.name ?? null,
  };
}

// Google Maps 공유링크(maps.app.goo.gl/...) → 좌표 + 가능하면 장소명.
// 비공식 스크랩이라 3단계 캐스케이드로 시도하고, 실패하면 null.
async function resolveShareLink(shareUrl) {
  const res = await fetch(shareUrl, {
    redirect: "follow",
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  const finalUrl = res.url;
  const html = await res.text();

  let lat = null;
  let lng = null;
  // (a) 최종 URL 의 !3d<lat>!4d<lng>
  let m = finalUrl.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  // (b) @lat,lng
  if (!m) m = finalUrl.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  // (c) og:image staticmap center=lat,lng (URL 인코딩 %2C 포함)
  if (!m) m = html.match(/center=(-?\d+\.\d+)(?:%2C|,)(-?\d+\.\d+)/);
  if (m) {
    lat = Number(m[1]);
    lng = Number(m[2]);
  }

  // 장소명: /maps/place/<Name>/ 경로에서 추출 시도
  let name = null;
  const nameMatch = finalUrl.match(/\/maps\/place\/([^/]+)/);
  if (nameMatch) name = decodeURIComponent(nameMatch[1].replace(/\+/g, " "));

  if (lat == null || lng == null) return null;
  return { lat, lng, name };
}

// 소스 항목 1개를 API 데이터로 해석한다 (좌표/평점/이름/주소).
async function resolveEntry(entry) {
  if (entry.query) {
    return await searchText(entry.query);
  }
  if (entry.shareUrl) {
    const link = await resolveShareLink(entry.shareUrl);
    if (!link) return null;
    // 좌표 주변에서 평점/place_id 까지 보강 (장소명이 있으면 그걸로, 없으면 좌표만)
    if (link.name) {
      const enriched = await searchText(link.name, { latitude: link.lat, longitude: link.lng });
      if (enriched && enriched.lat != null) return enriched;
    }
    // 평점은 못 구해도 좌표/이름은 확보
    return {
      placeId: null,
      name: link.name ?? "사용자 핀",
      address: "",
      lat: link.lat,
      lng: link.lng,
      rating: null,
      userRatingCount: null,
      primaryType: null,
      primaryTypeDisplayName: null,
      types: [],
      photoName: null,
    };
  }
  return null;
}

const sourceKey = (entry) => entry.query || entry.shareUrl;

async function main() {
  const source = await loadJson(SOURCE_PATH, []);
  const cache = FORCE ? {} : await loadJson(CACHE_PATH, {});

  if (!Array.isArray(source) || source.length === 0) {
    console.error("✗ places-source.json 이 비어 있거나 배열이 아닙니다.");
    process.exit(1);
  }

  console.log(`소스 핀 ${source.length}개 처리`);
  const out = {};
  let resolved = 0;
  let cached = 0;
  let fail = 0;

  for (const entry of source) {
    const key = sourceKey(entry);
    if (!key) continue;

    // API 데이터: 캐시에 좌표 + 신필드(primaryType/types)가 있으면 재사용, 없으면 새로 해석.
    // (구 캐시엔 primaryType 키가 없어 카테고리가 관광명소로 잘못 떨어지므로 stale로 본다.
    //  공유링크 좌표-only 핀은 primaryType:null 로 키가 존재하므로 재해석 대상 아님.)
    let api = cache[key];
    const fresh =
      api && api.lat != null && api.lng != null && "primaryType" in api && Array.isArray(api.types);
    if (!fresh) {
      try {
        api = await resolveEntry(entry);
        if (!api) {
          console.warn(`  · ${key} → 해석 결과 없음, 건너뜀`);
          fail++;
          continue;
        }
        resolved++;
        console.log(`  ✓ ${key} → ${api.name} ★${api.rating ?? "-"} (${api.userRatingCount ?? 0})`);
      } catch (err) {
        console.warn(`  ✗ ${key} → ${err.message}`);
        fail++;
        continue;
      }
    } else {
      cached++;
    }

    // note/tier/category/tags/점수는 매번 소스 기준으로 갱신 (메모·티어 수정 시 API 재호출 불필요)
    const tier = entry.tier || "opt";
    const category = categoryOf(api.primaryType, api.types, entry.category);
    const place = { rating: api.rating, userRatingCount: api.userRatingCount, tier };
    const round4 = (x) => Number(x.toFixed(4));
    out[key] = {
      placeId: api.placeId ?? null,
      name: api.name,
      address: api.address ?? "",
      lat: api.lat,
      lng: api.lng,
      rating: api.rating ?? null,
      userRatingCount: api.userRatingCount ?? null,
      primaryType: api.primaryType ?? null,
      primaryTypeDisplayName: api.primaryTypeDisplayName ?? null,
      types: api.types ?? [],
      photoName: api.photoName ?? null,
      category,
      tier,
      note: entry.note ?? "",
      tags: entry.tags ?? [],
      qN: round4(qualityNorm(bayesRating(api.rating, api.userRatingCount))),
      cred: round4(credibility(api.userRatingCount)),
      staticScore: round4(staticScore(place)),
    };
  }

  // 키 정렬로 diff 안정화
  const sorted = Object.fromEntries(Object.keys(out).sort().map((k) => [k, out[k]]));
  await writeFile(CACHE_PATH, JSON.stringify(sorted, null, 2) + "\n", "utf8");

  console.log(
    `\n완료 · 새로해석 ${resolved} · 캐시재사용 ${cached} · 실패 ${fail} · places.json 갱신됨`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
