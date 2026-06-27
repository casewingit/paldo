// 숙소(또는 현재 위치) 기준 장소 추천 + 이동 정보.
// - 추천: places.json(빌드 시 평점·리뷰·점수 계산) 을 점수순 렌더.
// - 이동: 출발지→각 장소 거리/시간을 Worker 프록시(Routes)로 받아 Grab 예상비용 계산.
//   WORKER_URL 이 비어 있으면(Phase 1) 거리·비용 없이 추천 + 길찾기 링크만 동작.

import { estimateGrabFare, GRAB_CONFIG } from "./lib/grab.js";
import {
  CATEGORIES,
  DISCOVERY_CONFIG,
  staticScore,
  finalScore,
  categoryOf,
  haversineKm,
  estDriveMin,
  INCLUDED_TYPES,
} from "./lib/score.mjs";
import { updateWeather, updateForecast, updateWarnings } from "./lib/weather.js";
import { initCurrency } from "./lib/fx.js";

const KL_CENTER = { lat: 3.139, lng: 101.6869 }; // 쿠알라룸푸르 도심(현재 위치 거리 판단용)

const WORKER_URL = (window.PALDO_CONFIG && window.PALDO_CONFIG.WORKER_URL) || "";
const LS_ACCOMMODATION = "paldo.accommodation";
const LS_ROUTES = "paldo.routes";
const ROUTE_TTL_MS = 30 * 60 * 1000; // 30분

// ---- 상태 ----
let accommodation = loadAccommodation(); // {lat,lng,label} | null
let useCurrentLoc = false;
let currentLoc = null; // {lat,lng} | null
let places = []; // 큐레이션 추천(staticScore 정렬)
let activeCategory = "추천"; // 활성 카테고리 탭
let sortMode = "추천순"; // "추천순" | "가까운순"
const nearbyCache = new Map(); // Map<`${gridKey}|${cat}`, {ts, list}> — 음식점/카페 발견
let nearbyEpoch = 0; // /nearby 요청 세대 — 최신 요청만 렌더(레이스 방지)
const routeCache = loadRouteCache(); // Map<cacheKey, {ts,distanceMeters,durationSeconds}>

// ---- DOM ----
const el = (id) => document.getElementById(id);
const recoList = el("recoList");

// ---- 저장소 헬퍼 ----
function loadAccommodation() {
  try {
    return JSON.parse(localStorage.getItem(LS_ACCOMMODATION)) || null;
  } catch {
    return null;
  }
}
function saveAccommodation(value) {
  accommodation = value;
  localStorage.setItem(LS_ACCOMMODATION, JSON.stringify(value));
}
function loadRouteCache() {
  try {
    const obj = JSON.parse(localStorage.getItem(LS_ROUTES)) || {};
    return new Map(Object.entries(obj));
  } catch {
    return new Map();
  }
}
function saveRouteCache() {
  localStorage.setItem(LS_ROUTES, JSON.stringify(Object.fromEntries(routeCache)));
}

// ---- 출발지 ----
function getOrigin() {
  if (useCurrentLoc && currentLoc) return currentLoc;
  return accommodation;
}
const originKey = (o) => (o ? `${o.lat.toFixed(4)},${o.lng.toFixed(4)}` : "none");
const routeKey = (o, place) => `${originKey(o)}|${place.placeId || place.name}`;

// ---- 숙소 검색 (자동완성 타입어헤드) ----
const suggestBox = el("staySuggest");
let searchSession = null; // Places 세션 토큰 (검색 1회 묶음 과금)
let searchTimer = null;
let suggestions = [];

function isMapLink(v) {
  return /maps\.app\.goo\.gl|google\.[^/]+\/maps|maps\.google\./i.test(v);
}

// 세션 토큰: 보안용이 아니라 과금 묶음용 식별자 → http(비보안)에서도 만들 수 있게 폴백.
function ensureSession() {
  if (!searchSession) {
    searchSession =
      (crypto.randomUUID && crypto.randomUUID()) ||
      "s-" + Date.now() + "-" + Math.random().toString(16).slice(2);
  }
  return searchSession;
}

function hideSuggest() {
  suggestBox.hidden = true;
  suggestBox.replaceChildren();
  el("stayInput").setAttribute("aria-expanded", "false");
}

function renderSuggest(list) {
  suggestions = list;
  if (!list.length) {
    hideSuggest();
    return;
  }
  suggestBox.replaceChildren(
    ...list.map((s) => {
      const li = document.createElement("li");
      li.className = "suggestItem";
      li.setAttribute("role", "option");
      li.innerHTML = `<strong>${s.primary}</strong>${s.secondary ? `<span>${s.secondary}</span>` : ""}`;
      // mousedown 으로 처리해 input blur 보다 먼저 선택되게 한다.
      li.addEventListener("mousedown", (e) => {
        e.preventDefault();
        selectSuggestion(s);
      });
      return li;
    })
  );
  suggestBox.hidden = false;
  el("stayInput").setAttribute("aria-expanded", "true");
}

async function fetchSuggestions(input) {
  if (!WORKER_URL) {
    setStatus("검색은 Worker 설정 후 사용할 수 있어요. (Phase 2)", true);
    return;
  }
  try {
    const res = await fetch(WORKER_URL + "/autocomplete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input, sessionToken: ensureSession() }),
    });
    if (!res.ok) throw new Error(`검색 실패 (${res.status})`);
    renderSuggest(await res.json());
  } catch (err) {
    hideSuggest();
    setStatus(err.message, true);
  }
}

function onSearchInput(value) {
  const v = value.trim();
  clearTimeout(searchTimer);
  if (v.length < 2 || isMapLink(v)) {
    hideSuggest();
    return;
  }
  searchTimer = setTimeout(() => fetchSuggestions(v), 250);
}

async function selectSuggestion(s) {
  hideSuggest();
  el("stayInput").value = s.primary;
  setStatus("위치를 확인하는 중…");
  try {
    const res = await fetch(WORKER_URL + "/place-details", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ placeId: s.placeId, sessionToken: searchSession }),
    });
    if (!res.ok) throw new Error(`상세 조회 실패 (${res.status})`);
    const d = await res.json();
    if (d.lat == null) throw new Error("좌표를 찾지 못했어요.");
    applyAccommodation({ lat: d.lat, lng: d.lng, label: d.label });
  } catch (err) {
    setStatus(`설정 실패: ${err.message}`, true);
  } finally {
    searchSession = null; // 다음 검색은 새 세션
  }
}

// 엔터 폴백: 후보가 있으면 첫 후보, 공유링크면 /resolve-link, 그 외 직접 주소면 /geocode.
async function submitRaw(value) {
  const v = value.trim();
  if (!v) return;
  if (!isMapLink(v) && suggestions.length) {
    selectSuggestion(suggestions[0]);
    return;
  }
  if (!WORKER_URL) {
    setStatus("Worker 설정 후 사용할 수 있어요. (Phase 2)", true);
    return;
  }
  setStatus("위치를 해석하는 중…");
  hideSuggest();
  try {
    const endpoint = isMapLink(v) ? "/resolve-link" : "/geocode";
    const body = isMapLink(v) ? { shareUrl: v } : { address: v };
    const res = await fetch(WORKER_URL + endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`해석 실패 (${res.status})`);
    const d = await res.json();
    if (d.lat == null) throw new Error("좌표를 찾지 못했어요.");
    applyAccommodation({ lat: d.lat, lng: d.lng, label: d.label || d.formattedAddress || v });
  } catch (err) {
    setStatus(`설정 실패: ${err.message}`, true);
  }
}

function applyAccommodation({ lat, lng, label }) {
  saveAccommodation({ lat, lng, label });
  useCurrentLoc = false;
  syncToggle();
  renderOrigin();
  onOriginChanged();
  setStatus(`숙소가 설정되었습니다: ${label}`);
}

function useCurrentLocation() {
  // 이미 현재 위치 사용 중이면 토글 오프 → 숙소(있으면)로 복귀.
  if (useCurrentLoc) {
    useCurrentLoc = false;
    syncToggle();
    renderOrigin();
    onOriginChanged();
    setStatus(
      accommodation
        ? `숙소를 출발지로 사용합니다: ${accommodation.label}`
        : "현재 위치 사용을 해제했습니다. 숙소를 설정해 주세요."
    );
    return;
  }

  if (!navigator.geolocation) {
    setStatus("이 브라우저는 위치 기능을 지원하지 않아요.", true);
    return;
  }
  // Geolocation 은 보안(HTTPS·localhost) 컨텍스트에서만 동작 — 아니면 조용히 실패하므로 미리 안내.
  if (!window.isSecureContext) {
    setStatus("현재 위치는 보안(HTTPS) 연결에서만 사용할 수 있어요.", true);
    return;
  }

  const btn = el("useCurrentLoc");
  btn.disabled = true;
  setStatus("현재 위치를 확인하는 중…");

  const onOk = (pos) => {
    btn.disabled = false;
    currentLoc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    useCurrentLoc = true;
    syncToggle();
    renderOrigin();
    onOriginChanged();
    // 여행 전(한국 등) KL 에서 멀면 DRIVE 경로가 없어 이동 정보가 비는데, 그 이유를 명확히 안내.
    const km = haversineKm(currentLoc, KL_CENTER);
    if (km > 300) {
      setStatus(
        `현재 위치가 쿠알라룸푸르에서 약 ${Math.round(km).toLocaleString()}km 떨어져 있어, ` +
          `이동 정보는 현지 도착 후에 표시됩니다.`,
        true
      );
    } else {
      setStatus("현재 위치를 출발지로 사용합니다.");
    }
  };
  const onFail = (err) => {
    btn.disabled = false;
    useCurrentLoc = false;
    syncToggle();
    const why =
      err.code === err.PERMISSION_DENIED
        ? "위치 권한이 거부됐어요. 브라우저(주소창 자물쇠) 위치 권한을 허용 후 다시 눌러 주세요."
        : err.code === err.TIMEOUT
          ? "위치 확인이 시간 초과됐어요. 실외에서 다시 시도해 주세요."
          : "현재 위치를 확인할 수 없어요. (기기 위치 서비스가 켜져 있는지 확인)";
    setStatus(accommodation ? `${why} (숙소를 출발지로 사용합니다.)` : why, true);
  };

  // 1차 고정밀 → 실패 시(권한 거부 제외) 저정밀 재시도. 실내·데스크톱·정밀위치 OFF 에서 더 안정적.
  navigator.geolocation.getCurrentPosition(
    onOk,
    (err) => {
      if (err.code === err.PERMISSION_DENIED) return onFail(err);
      setStatus("현재 위치 확인 중… (정밀도를 낮춰 재시도)");
      navigator.geolocation.getCurrentPosition(onOk, onFail, {
        enableHighAccuracy: false,
        timeout: 12000,
        maximumAge: 300000,
      });
    },
    { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
  );
}

// ---- 렌더: 출발지 박스/상태 ----
function setStatus(text, isError = false) {
  const node = el("stayStatus");
  node.textContent = text;
  node.classList.toggle("error", isError);
}
function syncToggle() {
  const b = el("useCurrentLoc");
  b.classList.toggle("active", useCurrentLoc);
  b.textContent = useCurrentLoc ? "현재 위치 사용 중 · 해제하기" : "현재 위치 사용";
}
function renderOrigin() {
  const origin = getOrigin();
  const label = useCurrentLoc && currentLoc ? "현재 위치" : accommodation ? accommodation.label : "미설정";
  el("originLabel").textContent = label;
  el("heroStatus").textContent = origin ? `출발지: ${label}` : "숙소를 설정해 주세요";
  el("originHint").textContent = origin
    ? "추천 카드에 거리·Grab 예상비용이 표시됩니다."
    : "설정하면 추천 카드에 이동 정보가 표시됩니다.";
}

// ---- 추천 로드 & 렌더 ----
async function loadPlaces() {
  // no-store: 정적 서버가 Cache-Control을 안 보내 브라우저가 옛 places.json을
  // 휴리스틱 캐시로 재사용하면 photoName 등 새 필드가 누락된다 → 항상 최신을 받는다.
  const res = await fetch("./places.json", { cache: "no-store" });
  if (!res.ok) throw new Error("places.json 로드 실패");
  const obj = await res.json();
  return Object.values(obj).sort((a, b) => (b.staticScore || 0) - (a.staticScore || 0));
}

function ratingRow(place) {
  if (place.rating == null) return "";
  const reviews = place.userRatingCount ? ` · 리뷰 ${place.userRatingCount.toLocaleString()}` : "";
  return `<div class="ratingRow"><span class="stars">★ ${place.rating.toFixed(1)}</span><span class="reviews">${reviews}</span></div>`;
}
function tagRow(place) {
  const chips = [];
  if (place.category) chips.push(`<span class="catChip">${place.category}</span>`);
  (place.tags || []).forEach((t) => chips.push(`<span>${t}</span>`));
  if (!chips.length) return "";
  return `<div class="tagRow">${chips.join("")}</div>`;
}

function directionsLink(place) {
  const origin = getOrigin();
  const params = new URLSearchParams({ api: "1", travelmode: "driving" });
  params.set("destination", `${place.lat},${place.lng}`);
  if (place.placeId) params.set("destination_place_id", place.placeId);
  if (origin) params.set("origin", `${origin.lat},${origin.lng}`);
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

// Google 장소 페이지 링크(place_id 기반) — 좌표가 아니라 상호·평점·영업시간 카드가 열린다.
function placeLink(place) {
  const params = new URLSearchParams({ api: "1", query: place.name });
  if (place.placeId) params.set("query_place_id", place.placeId);
  return `https://www.google.com/maps/search/?${params.toString()}`;
}

// 폴백 썸네일: 키리스 임베드 지도 + 위에 투명 링크(탭 → 장소 페이지).
function makeMapThumb(place) {
  const box = document.createElement("div");
  box.className = "placeMap";
  const iframe = document.createElement("iframe");
  iframe.src = `https://maps.google.com/maps?q=${place.lat},${place.lng}&z=16&hl=ko&output=embed`;
  iframe.loading = "lazy";
  iframe.title = `${place.name} 지도`;
  const link = document.createElement("a");
  link.className = "mapLink";
  link.href = placeLink(place);
  link.target = "_blank";
  link.rel = "noreferrer";
  link.setAttribute("aria-label", `${place.name} 정보`);
  box.append(iframe, link);
  return box;
}

// 썸네일: 실제 사진(Worker /photo) 우선, 실패/없음 시 지도 폴백. 모두 탭 → 장소 페이지.
function makeThumb(place) {
  if (place.photoName && WORKER_URL) {
    const a = document.createElement("a");
    a.className = "thumb";
    a.href = placeLink(place);
    a.target = "_blank";
    a.rel = "noreferrer";
    const img = document.createElement("img");
    img.alt = place.name;
    img.src = `${WORKER_URL}/photo?name=${encodeURIComponent(place.photoName)}&maxw=800`;
    img.addEventListener("error", () => a.replaceWith(makeMapThumb(place)));
    a.appendChild(img);
    return a;
  }
  return makeMapThumb(place);
}

function buildCard(place) {
  const card = document.createElement("article");
  card.className = "placeCard recoCard";
  const body = document.createElement("div");
  body.className = "cardBody";
  body.innerHTML = `
    ${tagRow(place)}
    <h3>${place.name}</h3>
    ${ratingRow(place)}
    ${place.note ? `<p>${place.note}</p>` : ""}
    <div class="travelCard" hidden></div>
    <a class="dirLink" href="${directionsLink(place)}" target="_blank" rel="noreferrer">길찾기</a>`;
  // 이미지(사진/지도)는 카드 최상단 풀블리드, 본문은 패딩.
  card.append(makeThumb(place), body);
  card._place = place;
  return card;
}

// ---- 카테고리 탭 / 정렬 ----
function renderCatTabs() {
  const box = el("catTabs");
  box.replaceChildren(
    ...CATEGORIES.map((cat) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "catTab" + (cat === activeCategory ? " active" : "");
      b.textContent = cat;
      b.dataset.cat = cat;
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", cat === activeCategory ? "true" : "false");
      b.addEventListener("click", () => {
        if (activeCategory === cat) return;
        activeCategory = cat;
        renderCatTabs();
        renderForTab();
      });
      return b;
    })
  );
}

// 현재 출발지 기준 주행시간(분): 실측 캐시 우선, 없으면 직선거리 추정.
function getDriveMin(place) {
  const origin = getOrigin();
  if (!origin) return null;
  const hit = routeCache.get(routeKey(origin, place));
  if (hit && Date.now() - hit.ts < ROUTE_TTL_MS && hit.durationSeconds != null) {
    return hit.durationSeconds / 60;
  }
  return estDriveMin(haversineKm(origin, place));
}

function sortList(list) {
  const withDM = list.map((p) => ({ p, dm: getDriveMin(p) }));
  if (sortMode === "가까운순") {
    withDM.sort((a, b) => (a.dm == null ? Infinity : a.dm) - (b.dm == null ? Infinity : b.dm));
  } else {
    withDM.sort((a, b) => finalScore(b.p, b.dm) - finalScore(a.p, a.dm));
  }
  return withDM.map((x) => x.p);
}

// 활성 카테고리의 큐레이션 장소(추천=전체).
function curatedForTab() {
  if (activeCategory === "추천") return places.slice();
  return places.filter((p) => p.category === activeCategory);
}

// 탭 전환/초기: 전체 재구성(replaceChildren).
function renderForTab() {
  const curated = sortList(curatedForTab());
  recoList.replaceChildren(...curated.map(buildCard));

  // 발견 대상 카테고리(INCLUDED_TYPES에 있는 것)는 출발지 주변 자동발견 tail.
  // 이동정보는 renderDiscovered가 큐레이션+발견 전체를 한 번에 계산하므로 여기선 생략.
  if (INCLUDED_TYPES[activeCategory]) {
    loadNearbyTail();
    return;
  }
  if (!curated.length) {
    recoList.innerHTML = `<article class="placeCard"><div class="cardBody"><h3>이 카테고리엔 아직 장소가 없어요</h3><p>다른 탭을 둘러보세요.</p></div></article>`;
  }
  recomputeAllTravel();
}

// 출발지/실측 변경: 노드 유지한 채 재정렬(iframe·travelCard 보존).
function reorderList() {
  const cards = [...recoList.querySelectorAll(".recoCard")];
  if (!cards.length) return;
  // 큐레이션/발견 그룹을 각각 정렬하고, 발견 그룹은 divider 아래에 유지.
  const curated = cards.filter((c) => !c.classList.contains("discovered"));
  const discovered = cards.filter((c) => c.classList.contains("discovered"));
  const place = (c) => c._place;
  sortList(curated.map(place)).forEach((p) => {
    const c = curated.find((x) => x._place === p);
    if (c) recoList.appendChild(c);
  });
  const divider = recoList.querySelector(".discoverDivider");
  if (divider) recoList.appendChild(divider);
  sortList(discovered.map(place)).forEach((p) => {
    const c = discovered.find((x) => x._place === p);
    if (c) recoList.appendChild(c);
  });
  // 발견 로딩 카드는 항상 맨 끝에 유지(큐레이션 카드가 그 위로 가지 않게).
  const loading = recoList.querySelector(".discoveredLoading");
  if (loading) recoList.appendChild(loading);
}

// 출발지 변경 시 호출.
function onOriginChanged() {
  updateWeather(getOrigin()); // 헤더 날씨를 새 출발지(없으면 KL) 기준으로 갱신
  if (INCLUDED_TYPES[activeCategory]) {
    renderForTab(); // 새 출발지 기준 발견 목록 재요청
  } else {
    reorderList(); // 즉시 haversine 재정렬
    recomputeAllTravel(); // 실측 도착 시 추가 재정렬
  }
}

// ---- 음식점/카페 자동발견 (Worker /nearby) ----
const gridKey = (o) => (o ? `${o.lat.toFixed(2)},${o.lng.toFixed(2)}` : "none");

function scoreDiscovered(r, cat) {
  const place = {
    placeId: r.placeId,
    name: r.name,
    address: r.address || "",
    lat: r.lat,
    lng: r.lng,
    rating: r.rating ?? null,
    userRatingCount: r.userRatingCount ?? null,
    primaryType: r.primaryType ?? null,
    primaryTypeDisplayName: r.primaryTypeDisplayName ?? null,
    types: r.types ?? [],
    photoName: r.photoName ?? null,
    category: categoryOf(r.primaryType, r.types), // 진짜 카테고리(검색 탭으로 강제 안 함)
    tier: "discovered",
    note: "",
    tags: r.primaryTypeDisplayName ? [r.primaryTypeDisplayName] : [],
  };
  place.staticScore = staticScore(place);
  return place;
}

async function loadNearbyTail() {
  const origin = getOrigin();
  const cat = activeCategory;
  const myEpoch = ++nearbyEpoch; // 이 호출의 세대 — 더 늦은 호출이 시작되면 무효화

  if (!origin || !WORKER_URL) {
    if (!recoList.querySelector(".recoCard")) {
      const why = !origin
        ? `숙소를 설정하면 주변 ${cat}을 찾아드려요.`
        : `이 기능은 Worker 설정 후 동작합니다.`;
      recoList.innerHTML = `<article class="placeCard"><div class="cardBody"><h3>${cat} 추천 준비중</h3><p>${why}</p></div></article>`;
    }
    return;
  }

  const key = `${gridKey(origin)}|${cat}`;
  const hit = nearbyCache.get(key);
  let list = hit && Date.now() - hit.ts < ROUTE_TTL_MS ? hit.list : null;

  if (!list) {
    const loading = document.createElement("article");
    loading.className = "placeCard discoveredLoading";
    loading.innerHTML = `<div><h3>주변 ${cat} 찾는 중…</h3></div>`;
    recoList.appendChild(loading);
    try {
      const res = await fetch(WORKER_URL + "/nearby", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          center: { lat: origin.lat, lng: origin.lng },
          category: cat,
          radii: DISCOVERY_CONFIG.radii,
          rankPreference: DISCOVERY_CONFIG.rankPreference,
          minRating: DISCOVERY_CONFIG.minRating,
          minReviews: DISCOVERY_CONFIG.minReviews[cat] ?? 0,
        }),
      });
      if (!res.ok) throw new Error(`nearby ${res.status}`);
      // 검색 탭에 걸렸어도 진짜 카테고리가 다른 곳(매장 안 식당 가진 호텔·명소,
      // 음식점 검색에 섞인 카페 등)은 제외 → 각 장소는 본질 카테고리 탭에만 표시.
      // 진짜 카테고리가 이 탭이고, 큐레이션 핀과 중복되지 않는 것만.
      const curatedIds = new Set(places.map((p) => p.placeId).filter(Boolean));
      list = (await res.json())
        .map((r) => scoreDiscovered(r, cat))
        .filter((p) => p.category === cat && !curatedIds.has(p.placeId));
      nearbyCache.set(key, { ts: Date.now(), list });
    } catch {
      list = [];
    }
  }

  // 탭이 바뀌었거나(다른 카테고리) 더 늦은 출발지 변경 요청이 시작됐으면 폐기.
  if (activeCategory !== cat || myEpoch !== nearbyEpoch) return;
  renderDiscovered(list);
}

function renderDiscovered(list) {
  recoList
    .querySelectorAll(".recoCard.discovered, .discoverDivider, .discoveredLoading")
    .forEach((n) => n.remove());

  if (!list.length) {
    if (!recoList.querySelector(".recoCard")) {
      recoList.innerHTML = `<article class="placeCard"><div class="cardBody"><h3>주변 ${activeCategory}을 찾지 못했어요</h3><p>출발지를 바꿔보세요.</p></div></article>`;
    }
    return;
  }
  // 큐레이션 카드가 있을 때만 divider 표시
  if (recoList.querySelector(".recoCard:not(.discovered)")) {
    const d = document.createElement("div");
    d.className = "discoverDivider";
    d.textContent = "주변에서 더 둘러보기";
    recoList.appendChild(d);
  }
  // 상위 N곳만 표시 (동시 이미지 로드·과금 절제)
  sortList(list)
    .slice(0, DISCOVERY_CONFIG.maxResults)
    .forEach((p) => {
      const card = buildCard(p);
      card.classList.add("discovered");
      recoList.appendChild(card);
    });
  recomputeAllTravel();
}

// ---- 이동 정보 ----
async function fetchRouteMatrix(origin, list) {
  // Worker /routes 에 출발지 1 + 목적지 N 을 한 번에 보내 computeRouteMatrix 로 받는다.
  const res = await fetch(WORKER_URL + "/routes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      origin: { lat: origin.lat, lng: origin.lng },
      destinations: list.map((p) => ({ lat: p.lat, lng: p.lng })),
    }),
  });
  if (!res.ok) throw new Error(`routes ${res.status}`);
  return await res.json(); // [{distanceMeters,durationSeconds}, ...] (목적지 순서)
}

function renderTravelCard(card, route) {
  const box = card.querySelector(".travelCard");
  if (!route || route.distanceMeters == null) {
    box.hidden = true;
    return;
  }
  const km = route.distanceMeters / 1000;
  const min = Math.round(route.durationSeconds / 60);
  const fare = estimateGrabFare(km, min);
  box.innerHTML = `
    <div class="travelMetrics">
      <span><b>${km.toFixed(1)}</b> km</span>
      <span><b>${min}</b> 분</span>
    </div>
    <div class="fareBadge" title="${GRAB_CONFIG.surgeNote}">
      Grab 예상 ${fare.currency} ~${fare.amount}<sup>예상치</sup>
    </div>`;
  box.hidden = false;
}

async function recomputeAllTravel() {
  const origin = getOrigin();
  const cards = [...recoList.querySelectorAll(".recoCard")];

  // 출발지 없음 또는 Worker 미설정 → 이동 카드 숨기고 안내만
  if (!origin || !WORKER_URL) {
    cards.forEach((c) => {
      const box = c.querySelector(".travelCard");
      if (!origin) {
        box.innerHTML = `<p class="travelHint">숙소를 설정하면 거리·Grab 예상비용이 표시됩니다.</p>`;
        box.hidden = false;
      } else {
        box.hidden = true; // origin 있으나 Worker 없음 → 길찾기 링크로 충분
      }
      // 길찾기 링크 origin 반영 갱신
      c.querySelector(".dirLink").href = directionsLink(c._place);
    });
    return;
  }

  // 캐시 우선, 미스만 모아 한 번에 매트릭스 호출
  const now = Date.now();
  const misses = [];
  cards.forEach((c) => {
    c.querySelector(".dirLink").href = directionsLink(c._place);
    const key = routeKey(origin, c._place);
    const hit = routeCache.get(key);
    if (hit && now - hit.ts < ROUTE_TTL_MS) {
      renderTravelCard(c, hit);
    } else {
      const box = c.querySelector(".travelCard");
      box.innerHTML = `<p class="travelHint">이동 정보 계산 중…</p>`;
      box.hidden = false;
      misses.push(c);
    }
  });
  if (!misses.length) return;

  try {
    const results = await fetchRouteMatrix(origin, misses.map((c) => c._place));
    misses.forEach((c, i) => {
      const r = results[i];
      if (r && r.distanceMeters != null) {
        routeCache.set(routeKey(origin, c._place), { ts: now, ...r });
        renderTravelCard(c, r);
      } else {
        const box = c.querySelector(".travelCard");
        box.innerHTML = `<p class="travelHint">이 장소의 경로를 찾지 못했어요.</p>`;
      }
    });
    saveRouteCache();
    reorderList(); // 실측 주행시간으로 순서 보정
  } catch {
    misses.forEach((c) => {
      const box = c.querySelector(".travelCard");
      box.innerHTML = `<p class="travelHint">이동 정보를 불러올 수 없어요. 길찾기 링크를 이용하세요.</p>`;
    });
  }
}

// ---- 부트 ----
function wireEvents() {
  const input = el("stayInput");
  input.addEventListener("input", (e) => onSearchInput(e.target.value));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submitRaw(input.value);
    } else if (e.key === "Escape") {
      hideSuggest();
    }
  });
  // blur 시 약간 지연 후 닫아 항목 클릭(mousedown)이 먼저 처리되게 한다.
  input.addEventListener("blur", () => setTimeout(hideSuggest, 150));
  el("useCurrentLoc").addEventListener("click", useCurrentLocation);

  // 기상 경보 배너 닫기 → 같은 경보는 세션 동안 다시 안 뜨게 기록.
  const alertClose = el("alertClose");
  if (alertClose) {
    alertClose.addEventListener("click", () => {
      const b = el("alertBanner");
      if (b.dataset.sig) sessionStorage.setItem("paldo.alertDismissed", b.dataset.sig);
      b.hidden = true;
    });
  }

  el("sortToggle").addEventListener("click", () => {
    sortMode = sortMode === "추천순" ? "가까운순" : "추천순";
    const btn = el("sortToggle");
    btn.textContent = sortMode;
    btn.setAttribute("aria-pressed", sortMode === "가까운순" ? "true" : "false");
    reorderList();
  });
}

async function boot() {
  wireEvents();
  syncToggle();
  renderOrigin();
  if (accommodation) setStatus(`저장된 숙소: ${accommodation.label}`);
  renderCatTabs();
  updateWeather(getOrigin()); // 헤더 날씨(출발지 없으면 KL 기본)
  updateForecast(WORKER_URL); // 헤더 보조 줄: 오늘 KL 공식 예보
  updateWarnings(WORKER_URL); // 기상 경보 배너(활성·KL권역만)
  initCurrency(); // 팁 환율 계산기
  try {
    places = await loadPlaces();
    renderForTab();
  } catch (err) {
    recoList.innerHTML = `<article class="placeCard"><div class="cardBody"><h3>추천을 불러오지 못했어요</h3><p>${err.message}</p></div></article>`;
  }
}

boot();
