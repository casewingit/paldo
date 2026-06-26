// 현지 날씨 — Open-Meteo(API 키 불필요·CORS 허용·무과금)로 현재 날씨를 헤더에 표시.
// 출발지(숙소/현재 위치)가 있으면 그 좌표, 없으면 쿠알라룸푸르 기본값.

const KL = { lat: 3.139, lng: 101.6869, label: "쿠알라룸푸르" };

// WMO weather code → [이모지, 한글 설명]
const WMO = {
  0: ["☀️", "맑음"],
  1: ["🌤️", "대체로 맑음"],
  2: ["⛅", "구름 조금"],
  3: ["☁️", "흐림"],
  45: ["🌫️", "안개"],
  48: ["🌫️", "서리 안개"],
  51: ["🌦️", "약한 이슬비"],
  53: ["🌦️", "이슬비"],
  55: ["🌧️", "강한 이슬비"],
  56: ["🌧️", "어는 이슬비"],
  57: ["🌧️", "강한 어는 이슬비"],
  61: ["🌦️", "약한 비"],
  63: ["🌧️", "비"],
  65: ["🌧️", "강한 비"],
  66: ["🌧️", "어는 비"],
  67: ["🌧️", "강한 어는 비"],
  71: ["🌨️", "약한 눈"],
  73: ["🌨️", "눈"],
  75: ["❄️", "강한 눈"],
  77: ["🌨️", "싸락눈"],
  80: ["🌦️", "소나기"],
  81: ["🌧️", "소나기"],
  82: ["⛈️", "강한 소나기"],
  85: ["🌨️", "소낙눈"],
  86: ["❄️", "강한 소낙눈"],
  95: ["⛈️", "뇌우"],
  96: ["⛈️", "우박 동반 뇌우"],
  99: ["⛈️", "강한 우박 뇌우"],
};

const el = (id) => document.getElementById(id);

// 출발지(또는 KL) 좌표의 현재 날씨를 헤더 위젯에 채운다. 실패하면 위젯을 숨긴다.
export async function updateWeather(origin) {
  const useOrigin = origin && Number.isFinite(origin.lat) && Number.isFinite(origin.lng);
  const lat = useOrigin ? origin.lat : KL.lat;
  const lng = useOrigin ? origin.lng : KL.lng;
  const place = useOrigin ? origin.label || "현재 위치" : KL.label;

  const widget = el("heroWeather");
  if (!widget) return;
  const placeEl = el("hwPlace");
  if (placeEl) placeEl.textContent = place;

  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
      `&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code&timezone=auto`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`weather ${res.status}`);
    const data = await res.json();
    const c = data.current || {};
    const [emoji, desc] = WMO[c.weather_code] || ["🌡️", "—"];

    el("hwIcon").textContent = emoji;
    el("hwTemp").textContent = `${Math.round(c.temperature_2m)}°`;
    el("hwDesc").textContent = desc;
    const feels = el("hwFeels");
    if (feels && c.apparent_temperature != null) {
      feels.textContent = `체감 ${Math.round(c.apparent_temperature)}° · 습도 ${Math.round(
        c.relative_humidity_2m
      )}%`;
    }
    widget.hidden = false;
  } catch {
    widget.hidden = true; // 실패 시 헤더가 깨지지 않게 위젯만 숨김
  }
}

// ---- MET Malaysia 공식 예보/경보 (Worker 프록시 경유) ----

// data.gov.my forecast 의 고정 어휘 18종 → 한글(전수 매핑, 누락 시 원문 폴백).
const MALAY_FORECAST = {
  Berangin: "바람",
  Hujan: "비",
  "Hujan di beberapa tempat": "곳에 따라 비",
  "Hujan di beberapa tempat di kawasan pantai": "해안 지역 곳에 따라 비",
  "Hujan di beberapa tempat di kawasan pedalaman": "내륙 지역 곳에 따라 비",
  "Hujan di kebanyakan tempat": "대부분 지역 비",
  "Hujan di kebanyakan tempat di kawasan pedalaman": "내륙 대부분 지역 비",
  "Hujan menyeluruh": "전역 비",
  Mendung: "흐림",
  "Ribut petir": "천둥번개",
  "Ribut petir di beberapa tempat": "곳에 따라 천둥번개",
  "Ribut petir di beberapa tempat di kawasan pantai": "해안 지역 곳에 따라 천둥번개",
  "Ribut petir di beberapa tempat di kawasan pedalaman": "내륙 지역 곳에 따라 천둥번개",
  "Ribut petir di kebanyakan tempat": "대부분 지역 천둥번개",
  "Ribut petir di kebanyakan tempat di kawasan pedalaman": "내륙 대부분 지역 천둥번개",
  "Ribut petir menyeluruh": "전역 천둥번개",
  "Ribut petir menyeluruh di kawasan pedalaman": "내륙 전역 천둥번개",
  "Tiada hujan": "비 없음",
};
const MALAY_WHEN = {
  Pagi: "아침",
  Petang: "오후",
  Malam: "밤",
  "Sepanjang Hari": "하루 종일",
  "Pagi dan Petang": "아침·오후",
  "Pagi dan Malam": "아침·밤",
  "Petang dan Malam": "오후·밤",
};
// 경보 영문 제목 → {한글, 아이콘}
const WARN_TITLE = {
  "Thunderstorms Warning": { ko: "천둥번개·호우 경보", icon: "⛈️" },
  "Heavy Rain Warning": { ko: "호우 경보", icon: "🌧️" },
  "Strong Winds and Rough Seas": { ko: "강풍·풍랑 경보", icon: "🌊" },
};

// "2026-06-27T08:00:00"(MYT) → "오늘 08:00까지" / "06/28 14:00까지"
function untilText(s) {
  if (!s) return "";
  const time = (s.match(/T(\d{2}:\d{2})/) || [])[1] || "";
  const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  const day = s.slice(0, 10) === today ? "오늘" : s.slice(5, 10).replace("-", "/");
  return `${day} ${time}까지`.trim();
}

// 헤더 칩 보조 줄: 오늘 KL 공식 예보(없으면 줄 숨김).
export async function updateForecast(workerUrl) {
  const node = el("hwForecast");
  if (!node || !workerUrl) return;
  try {
    const res = await fetch(`${workerUrl}/weather-forecast?location=${encodeURIComponent("Kuala Lumpur")}`);
    if (!res.ok) throw new Error("forecast");
    const f = await res.json();
    if (!f || !f.summary) {
      node.hidden = true;
      return;
    }
    const when = MALAY_WHEN[f.summaryWhen] ? `${MALAY_WHEN[f.summaryWhen]} ` : "";
    const desc = MALAY_FORECAST[f.summary] || f.summary;
    const temp = f.minTemp != null && f.maxTemp != null ? ` · ${f.minTemp}–${f.maxTemp}°` : "";
    node.textContent = `오늘 KL ${when}${desc}${temp}`;
    node.hidden = false;
  } catch {
    node.hidden = true;
  }
}

// 기상 경보 배너: 활성·KL권역 육상 경보가 있으면 표시(없으면 숨김). 닫으면 같은 경보는 세션 동안 숨김.
export async function updateWarnings(workerUrl) {
  const banner = el("alertBanner");
  if (!banner || !workerUrl) return;
  try {
    const res = await fetch(`${workerUrl}/weather-warning`);
    if (!res.ok) throw new Error("warning");
    const list = await res.json();
    const w = Array.isArray(list) ? list[0] : null;
    if (!w) {
      banner.hidden = true;
      return;
    }
    const sig = `${w.title}|${w.validTo}`;
    if (sessionStorage.getItem("paldo.alertDismissed") === sig) {
      banner.hidden = true;
      return;
    }
    const meta = WARN_TITLE[w.title] || { ko: w.title, icon: "⚠️" };
    el("alertIcon").textContent = meta.icon;
    el("alertTitle").textContent = meta.ko;
    el("alertText").textContent = `${untilText(w.validTo)} · 우산을 챙기고 야외 일정에 유의하세요`;
    banner.dataset.sig = sig;
    banner.hidden = false;
  } catch {
    banner.hidden = true;
  }
}
