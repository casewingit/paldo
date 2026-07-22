// 현지 날씨 — Open-Meteo(API 키 불필요·CORS 허용·무과금)로 현재 날씨/오늘 예보/대기질을 헤더에 표시.
// 출발지(숙소/현재 위치)가 있으면 그 좌표, 없으면 치앙마이 기본값.

const CNX = { lat: 18.7883, lng: 98.9853, label: "치앙마이" };

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

// 출발지가 유효하면 그 좌표, 아니면 치앙마이 기본값. {lat,lng,label} 반환.
function resolveSpot(origin) {
  const ok = origin && Number.isFinite(origin.lat) && Number.isFinite(origin.lng);
  return ok
    ? { lat: origin.lat, lng: origin.lng, label: origin.label || "현재 위치" }
    : { ...CNX };
}

// 출발지(또는 치앙마이) 좌표의 현재 날씨를 헤더 위젯에 채운다. 실패하면 날씨 행만 숨긴다.
export async function updateWeather(origin) {
  const spot = resolveSpot(origin);

  const widget = el("heroWeather");
  if (!widget) return;
  const placeEl = el("hwPlace");
  if (placeEl) placeEl.textContent = spot.label;

  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${spot.lat}&longitude=${spot.lng}` +
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
    // 날씨 행 표시 + 컨테이너 노출(예보 줄과 독립적으로 동작).
    if (el("hwTop")) el("hwTop").hidden = false;
    if (el("hwSub")) el("hwSub").hidden = false;
    widget.hidden = false;
  } catch {
    // Open-Meteo 현재 날씨 실패 시: 컨테이너는 건드리지 않고 날씨 행만 숨긴다.
    // (예보 줄이 살아 있으면 칩은 그 줄만으로 계속 표시됨)
    if (el("hwTop")) el("hwTop").hidden = true;
    if (el("hwSub")) el("hwSub").hidden = true;
  }
}

// ---- 오늘 예보 (Open-Meteo daily) ----

// 헤더 칩 보조 줄: 오늘 최저–최고 + 날씨 + 강수확률(없으면 줄 숨김).
export async function updateForecast(origin) {
  const node = el("hwForecast");
  if (!node) return;
  const spot = resolveSpot(origin);
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${spot.lat}&longitude=${spot.lng}` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
      `&forecast_days=1&timezone=auto`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("forecast");
    const d = (await res.json()).daily || {};
    const code = d.weather_code?.[0];
    const tMax = d.temperature_2m_max?.[0];
    const tMin = d.temperature_2m_min?.[0];
    if (code == null && tMax == null) {
      node.hidden = true;
      return;
    }
    const [, desc] = WMO[code] || ["", ""];
    const pop = d.precipitation_probability_max?.[0];

    // 날씨 정보 줄 / 기온 줄을 분리해 각자 자기 줄에(textContent 로 XSS 방지).
    const parts = ["오늘", desc];
    // 강수확률은 의미 있을 때만(20% 미만은 사실상 '비 안 옴' → 노이즈).
    if (pop != null && pop >= 20) parts.push(`강수 ${pop}%`);
    const mainLine = document.createElement("span");
    mainLine.className = "hwfMain";
    mainLine.textContent = parts.filter(Boolean).join(" · ");
    node.replaceChildren(mainLine);

    if (tMin != null && tMax != null) {
      const tempLine = document.createElement("span");
      tempLine.className = "hwfTemp";
      tempLine.textContent = `${Math.round(tMin)}–${Math.round(tMax)}°`;
      node.appendChild(tempLine);
    }
    node.hidden = false;
    // 현재 날씨 fetch 와 독립: 예보만 성공해도 칩 컨테이너를 노출한다.
    const widget = el("heroWeather");
    if (widget) widget.hidden = false;
  } catch {
    node.hidden = true;
  }
}

// ---- 대기질(PM2.5) 경보 배너 ----
// 치앙마이는 우기 태풍보다 건기 말 연무(burning season, 2~4월)가 실질적인 건강 위험이라
// 기상 경보 대신 PM2.5 를 배너로 쓴다. US AQI 의 PM2.5 구간(µg/m³)을 그대로 따른다.
// 12 미만(좋음)·35.4 이하(보통)는 배너를 띄우지 않는다 — 매일 뜨면 아무도 안 본다.
const PM25_LEVELS = [
  { min: 250.5, ko: "대기질 위험", icon: "🛑", advice: "실외 활동을 피하고 실내 위주로 일정을 조정하세요" },
  { min: 150.5, ko: "대기질 매우 나쁨", icon: "😷", advice: "KF94 마스크를 쓰고 야외 일정을 줄이세요" },
  { min: 55.5, ko: "대기질 나쁨", icon: "😷", advice: "마스크를 챙기고 장시간 야외 활동은 피하세요" },
  { min: 35.5, ko: "대기질 민감군 주의", icon: "🌫️", advice: "호흡기가 약하면 마스크를 챙기세요" },
];

function pm25Level(v) {
  return PM25_LEVELS.find((l) => v >= l.min) || null;
}

// 대기질 배너: PM2.5 가 '민감군 주의' 이상이면 표시(아니면 숨김).
// 닫으면 같은 등급은 세션 동안 숨김(등급이 올라가면 다시 뜬다).
export async function updateWarnings(origin) {
  const banner = el("alertBanner");
  if (!banner) return;
  const spot = resolveSpot(origin);
  try {
    const url =
      `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${spot.lat}` +
      `&longitude=${spot.lng}&current=pm2_5&timezone=auto`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("air quality");
    const pm = (await res.json()).current?.pm2_5;
    const level = Number.isFinite(pm) ? pm25Level(pm) : null;
    if (!level) {
      banner.hidden = true;
      return;
    }
    const sig = `pm25|${level.min}`;
    if (sessionStorage.getItem("paldo.alertDismissed") === sig) {
      banner.hidden = true;
      return;
    }
    el("alertIcon").textContent = level.icon;
    el("alertTitle").textContent = level.ko;
    el("alertText").textContent = `PM2.5 ${Math.round(pm)}㎍/㎥ · ${level.advice}`;
    banner.dataset.sig = sig;
    banner.hidden = false;
  } catch {
    banner.hidden = true;
  }
}
