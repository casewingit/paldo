// 숙소(또는 현재 위치) 기준 장소 추천 + 이동 정보.
// - 추천: places.json(빌드 시 평점·리뷰·점수 계산) 을 점수순 렌더.
// - 이동: 출발지→각 장소 거리/시간을 Worker 프록시(Routes)로 받아 Grab 예상비용 계산.
//   WORKER_URL 이 비어 있으면(Phase 1) 거리·비용 없이 추천 + 길찾기 링크만 동작.

import { estimateGrabFare, GRAB_CONFIG } from "./lib/grab.js";

const WORKER_URL = (window.PALDO_CONFIG && window.PALDO_CONFIG.WORKER_URL) || "";
const LS_ACCOMMODATION = "paldo.accommodation";
const LS_ROUTES = "paldo.routes";
const ROUTE_TTL_MS = 30 * 60 * 1000; // 30분

// ---- 상태 ----
let accommodation = loadAccommodation(); // {lat,lng,label} | null
let useCurrentLoc = false;
let currentLoc = null; // {lat,lng} | null
let places = []; // 점수순 정렬된 추천 배열
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

// ---- 입력 해석(공유링크/주소) ----
function isMapLink(v) {
  return /maps\.app\.goo\.gl|google\.[^/]+\/maps|maps\.google\./i.test(v);
}

async function resolveStayInput(value) {
  const v = value.trim();
  if (!v) return;
  if (!WORKER_URL) {
    setStatus("Worker 가 아직 설정되지 않아 주소/링크 해석을 할 수 없어요. (Phase 2 필요)", true);
    return;
  }
  setStatus("위치를 해석하는 중…");
  try {
    const endpoint = isMapLink(v) ? "/resolve-link" : "/geocode";
    const body = isMapLink(v) ? { shareUrl: v } : { address: v };
    const res = await fetch(WORKER_URL + endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`해석 실패 (${res.status})`);
    const data = await res.json();
    if (data.lat == null || data.lng == null) throw new Error("좌표를 찾지 못했어요.");
    saveAccommodation({
      lat: data.lat,
      lng: data.lng,
      label: data.label || data.formattedAddress || v,
    });
    useCurrentLoc = false;
    syncToggle();
    renderOrigin();
    recomputeAllTravel();
    setStatus("숙소가 설정되었습니다.");
  } catch (err) {
    setStatus(`설정 실패: ${err.message}`, true);
  }
}

function useCurrentLocation() {
  if (!navigator.geolocation) {
    setStatus("이 브라우저는 위치 기능을 지원하지 않아요.", true);
    return;
  }
  setStatus("현재 위치를 확인하는 중…");
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      currentLoc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      useCurrentLoc = true;
      syncToggle();
      renderOrigin();
      recomputeAllTravel();
      setStatus("현재 위치를 출발지로 사용합니다.");
    },
    () => {
      useCurrentLoc = false;
      syncToggle();
      setStatus("위치 권한이 거부되어 숙소를 출발지로 사용합니다.", true);
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
  el("useCurrentLoc").classList.toggle("active", useCurrentLoc);
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
  const res = await fetch("./places.json");
  if (!res.ok) throw new Error("places.json 로드 실패");
  const obj = await res.json();
  return Object.values(obj).sort((a, b) => (b.score || 0) - (a.score || 0));
}

function ratingRow(place) {
  if (place.rating == null) return "";
  const reviews = place.userRatingCount ? ` · 리뷰 ${place.userRatingCount.toLocaleString()}` : "";
  return `<div class="ratingRow"><span class="stars">★ ${place.rating.toFixed(1)}</span><span class="reviews">${reviews}</span></div>`;
}
function tagRow(place) {
  if (!place.tags || !place.tags.length) return "";
  return `<div class="tagRow">${place.tags.map((t) => `<span>${t}</span>`).join("")}</div>`;
}

function directionsLink(place) {
  const origin = getOrigin();
  const params = new URLSearchParams({ api: "1", travelmode: "driving" });
  params.set("destination", `${place.lat},${place.lng}`);
  if (place.placeId) params.set("destination_place_id", place.placeId);
  if (origin) params.set("origin", `${origin.lat},${origin.lng}`);
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

function buildCard(place) {
  const card = document.createElement("article");
  card.className = "placeCard recoCard";
  card.innerHTML = `
    <div>
      ${tagRow(place)}
      <h3>${place.name}</h3>
      ${ratingRow(place)}
      ${place.note ? `<p>${place.note}</p>` : ""}
      <div class="placeMap"></div>
      <div class="travelCard" hidden></div>
      <a class="dirLink" href="${directionsLink(place)}" target="_blank" rel="noreferrer">길찾기</a>
    </div>`;

  // 키리스 임베드 지도 (API 키 불필요)
  const mapBox = card.querySelector(".placeMap");
  const iframe = document.createElement("iframe");
  iframe.src = `https://maps.google.com/maps?q=${place.lat},${place.lng}&z=16&hl=ko&output=embed`;
  iframe.loading = "lazy";
  iframe.title = `${place.name} 지도`;
  iframe.allowFullscreen = true;
  mapBox.replaceChildren(iframe);

  card._place = place;
  return card;
}

function renderRecommendations() {
  recoList.replaceChildren(...places.map(buildCard));
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
  } catch {
    misses.forEach((c) => {
      const box = c.querySelector(".travelCard");
      box.innerHTML = `<p class="travelHint">이동 정보를 불러올 수 없어요. 길찾기 링크를 이용하세요.</p>`;
    });
  }
}

// ---- 부트 ----
function wireEvents() {
  el("stayResolve").addEventListener("click", () => resolveStayInput(el("stayInput").value));
  el("stayInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") resolveStayInput(el("stayInput").value);
  });
  el("useCurrentLoc").addEventListener("click", useCurrentLocation);
}

async function boot() {
  wireEvents();
  renderOrigin();
  if (accommodation) setStatus(`저장된 숙소: ${accommodation.label}`);
  try {
    places = await loadPlaces();
    renderRecommendations();
  } catch (err) {
    recoList.innerHTML = `<article class="placeCard"><div><h3>추천을 불러오지 못했어요</h3><p>${err.message}</p></div></article>`;
  }
}

boot();
