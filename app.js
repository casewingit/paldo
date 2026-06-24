const tripDays = [
  {
    date: "2026-06-26",
    city: "쿠알라룸푸르",
    title: "도착과 가벼운 적응",
    map: "Kuala Lumpur Malaysia",
    weatherKey: "kl",
    steps: [
      {
        time: "13:00",
        text: "쿠알라룸푸르 도착, 호텔 이동",
        type: "이동",
        place: "공항 또는 KL Sentral → 호텔",
        note: "차량 호출 전에 호텔 주소를 기사에게 보여주세요.",
        map: "Kuala Lumpur Malaysia hotel",
      },
      {
        time: "15:00",
        text: "체크인 후 90분 휴식",
        type: "휴식",
        place: "호텔",
        note: "첫날은 부모님 컨디션 회복이 가장 중요합니다.",
        map: "Kuala Lumpur hotel",
      },
      {
        time: "17:30",
        text: "호텔 주변 산책과 물·간식 준비",
        type: "준비",
        place: "호텔 주변 편의점",
        note: "생수, 휴지, 우산을 바로 꺼낼 수 있게 챙기세요.",
        map: "Kuala Lumpur convenience store",
      },
      {
        time: "19:00",
        text: "KLCC 또는 가까운 쇼핑몰에서 가볍게 식사",
        type: "식사",
        place: "Suria KLCC 또는 호텔 근처",
        note: "덥거나 비가 오면 바로 실내 식당으로 들어가세요.",
        map: "Suria KLCC",
      },
    ],
    advice: "첫날은 이동 피로가 있으니 욕심내지 말고 호텔 근처 중심으로 움직이세요.",
  },
  {
    date: "2026-06-27",
    city: "쿠알라룸푸르",
    title: "KLCC와 시내 대표 코스",
    map: "Petronas Twin Towers Kuala Lumpur",
    weatherKey: "kl",
    steps: [
      {
        time: "09:30",
        text: "페트로나스 트윈 타워 사진 촬영",
        type: "관광",
        place: "Petronas Twin Towers",
        note: "오전이 덜 덥고 사진 찍기 편합니다.",
        map: "Petronas Twin Towers Kuala Lumpur",
      },
      {
        time: "10:30",
        text: "KLCC 공원 짧은 산책",
        type: "산책",
        place: "KLCC Park",
        note: "그늘 위주로 30분 정도만 걸으세요.",
        map: "KLCC Park",
      },
      {
        time: "12:00",
        text: "수리아 KLCC 안에서 점심",
        type: "식사",
        place: "Suria KLCC",
        note: "식사 후 바로 카페 휴식을 붙이면 좋습니다.",
        map: "Suria KLCC restaurants",
      },
      {
        time: "14:00",
        text: "아쿠아리아 KLCC 또는 파빌리온 이동",
        type: "실내",
        place: "Aquaria KLCC 또는 Pavilion KL",
        note: "오후 더위와 소나기 시간대는 실내 일정이 편합니다.",
        map: "Aquaria KLCC",
      },
      {
        time: "19:30",
        text: "KLCC 분수 쇼 후 호텔 복귀",
        type: "야경",
        place: "Lake Symphony KLCC",
        note: "끝나자마자 택시를 잡으면 붐빌 수 있어 조금 여유를 두세요.",
        map: "Lake Symphony KLCC",
      },
    ],
    advice: "실내와 실외를 섞으면 부모님 체력 관리가 쉽습니다.",
  },
  {
    date: "2026-06-28",
    city: "쿠알라룸푸르",
    title: "바투 동굴과 전통 시장",
    map: "Batu Caves Malaysia",
    weatherKey: "kl",
    steps: [
      {
        time: "08:30",
        text: "덜 더울 때 바투 동굴 출발",
        type: "이동",
        place: "호텔 → Batu Caves",
        note: "계단이 많으니 운동화와 물을 챙기세요.",
        map: "Batu Caves Malaysia",
      },
      {
        time: "09:30",
        text: "바투 동굴 광장과 동상 구경",
        type: "관광",
        place: "Batu Caves",
        note: "무릎이 불편하면 계단 전체를 오르지 않아도 충분합니다.",
        map: "Batu Caves Malaysia",
      },
      {
        time: "12:30",
        text: "차이나타운 또는 센트럴 마켓 근처 식사",
        type: "식사",
        place: "Central Market Kuala Lumpur",
        note: "식사 장소는 에어컨이 있는 곳으로 고르세요.",
        map: "Central Market Kuala Lumpur",
      },
      {
        time: "14:30",
        text: "센트럴 마켓과 메르데카 광장 짧게 둘러보기",
        type: "관광",
        place: "Central Market, Merdeka Square",
        note: "한 번에 오래 걷지 말고 중간에 앉아서 쉬세요.",
        map: "Merdeka Square Kuala Lumpur",
      },
      {
        time: "18:00",
        text: "호텔 근처에서 휴식 위주 저녁",
        type: "휴식",
        place: "호텔 주변",
        note: "다음 날을 위해 일찍 쉬는 일정입니다.",
        map: "Kuala Lumpur hotel restaurants",
      },
    ],
    advice: "바투 동굴은 계단이 많습니다. 무릎이 불편하면 아래 광장 위주로 보셔도 충분합니다.",
  },
  {
    date: "2026-06-29",
    city: "쿠알라룸푸르",
    title: "전망과 쉬어가는 하루",
    map: "KL Tower Kuala Lumpur",
    weatherKey: "kl",
    steps: [
      {
        time: "10:00",
        text: "KL 타워 전망대 또는 호텔 수영장",
        type: "가벼운 관광",
        place: "KL Tower 또는 호텔",
        note: "부모님 컨디션에 따라 전망대 대신 호텔 휴식으로 바꿔도 좋습니다.",
        map: "KL Tower Kuala Lumpur",
      },
      {
        time: "12:30",
        text: "부킷 빈탕에서 점심",
        type: "식사",
        place: "Bukit Bintang",
        note: "쇼핑몰 안 식당을 고르면 이동이 짧습니다.",
        map: "Bukit Bintang Kuala Lumpur",
      },
      {
        time: "14:30",
        text: "카페, 마사지, 쇼핑몰 휴식",
        type: "휴식",
        place: "Pavilion KL 또는 Lot 10",
        note: "이날은 체력 회복일로 생각하세요.",
        map: "Pavilion KL",
      },
      {
        time: "17:30",
        text: "기념품 구입",
        type: "쇼핑",
        place: "쇼핑몰 또는 마트",
        note: "무거운 물건은 마지막에 사고 바로 호텔로 돌아가세요.",
        map: "Kuala Lumpur supermarket souvenirs",
      },
      {
        time: "20:00",
        text: "다음날 이동을 위해 짐 정리",
        type: "준비",
        place: "호텔",
        note: "여권, 충전기, 상비약을 따로 빼두세요.",
        map: "Kuala Lumpur hotel",
      },
    ],
    advice: "다음날 푸트라자야 이동이 있으니 무리하지 않는 날로 잡는 것이 좋습니다.",
  },
  {
    date: "2026-06-30",
    city: "쿠알라룸푸르 → 푸트라자야",
    title: "푸트라자야 이동",
    map: "Putra Mosque Putrajaya",
    weatherKey: "putrajaya",
    steps: [
      {
        time: "09:30",
        text: "체크아웃 준비",
        type: "준비",
        place: "쿠알라룸푸르 호텔",
        note: "방 안 충전기와 여권을 한 번 더 확인하세요.",
        map: "Kuala Lumpur hotel",
      },
      {
        time: "10:30",
        text: "차량으로 푸트라자야 이동",
        type: "이동",
        place: "쿠알라룸푸르 → 푸트라자야",
        note: "차 안에서 쉴 수 있도록 물을 가까이 두세요.",
        map: "Putrajaya Malaysia",
      },
      {
        time: "12:00",
        text: "도착 후 식사와 체크인",
        type: "식사",
        place: "푸트라자야 호텔 또는 Alamanda",
        note: "체크인 전 짐 보관이 가능한지 확인하세요.",
        map: "Alamanda Putrajaya",
      },
      {
        time: "15:30",
        text: "푸트라 모스크와 푸트라 광장",
        type: "관광",
        place: "Putra Mosque, Putra Square",
        note: "복장 안내를 확인하고 햇빛이 강하면 오래 서 있지 마세요.",
        map: "Putra Mosque Putrajaya",
      },
      {
        time: "18:00",
        text: "세리 와와산 브리지 또는 호수 산책",
        type: "산책",
        place: "Seri Wawasan Bridge",
        note: "해질 무렵이 덜 덥고 사진이 예쁩니다.",
        map: "Seri Wawasan Bridge Putrajaya",
      },
    ],
    advice: "이동일에는 목적지를 2곳 정도로 줄이고, 더운 시간에는 실내에서 쉬세요.",
  },
  {
    date: "2026-07-01",
    city: "푸트라자야",
    title: "마무리와 출발 준비",
    map: "Putrajaya Botanical Garden",
    weatherKey: "putrajaya",
    steps: [
      {
        time: "09:00",
        text: "호텔 조식 후 가벼운 산책",
        type: "휴식",
        place: "호텔 주변",
        note: "마지막 날은 서두르지 않는 흐름이 좋습니다.",
        map: "Putrajaya hotel",
      },
      {
        time: "10:30",
        text: "보태니컬 가든 또는 가까운 카페",
        type: "가벼운 관광",
        place: "Putrajaya Botanical Garden",
        note: "덥다면 정원 대신 카페 휴식으로 바꾸세요.",
        map: "Putrajaya Botanical Garden",
      },
      {
        time: "12:30",
        text: "점심과 짐 최종 확인",
        type: "준비",
        place: "호텔 또는 쇼핑몰",
        note: "여권, 지갑, 휴대폰, 충전기를 먼저 확인하세요.",
        map: "Alamanda Putrajaya restaurants",
      },
      {
        time: "14:30",
        text: "공항 또는 다음 목적지로 이동",
        type: "이동",
        place: "Putrajaya → KLIA",
        note: "부모님 이동 시간을 넉넉히 잡으세요.",
        map: "KLIA Airport",
      },
    ],
    advice: "마지막 날은 여권, 충전기, 약, 짐을 다시 확인하세요.",
  },
];

const weatherPlaces = {
  kl: { name: "쿠알라룸푸르", lat: 3.139, lon: 101.6869 },
  putrajaya: { name: "푸트라자야", lat: 2.9264, lon: 101.6964 },
};

const params = new URLSearchParams(window.location.search);
const mockDate = params.get("date");
const mockHour = params.get("hour");
const now = mockDate ? new Date(`${mockDate}T${mockHour || "09"}:00:00`) : new Date();

const formatDate = new Intl.DateTimeFormat("ko-KR", {
  month: "long",
  day: "numeric",
  weekday: "short",
});

let selectedDayIndex = getTodayIndex();

function dateOnly(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getTodayIndex() {
  const today = dateOnly(now);
  const exact = tripDays.findIndex((day) => day.date === today);
  if (exact >= 0) return exact;

  const first = new Date(`${tripDays[0].date}T00:00:00`);
  const last = new Date(`${tripDays[tripDays.length - 1].date}T23:59:59`);
  if (now < first) return 0;
  if (now > last) return tripDays.length - 1;
  return 0;
}

function getTripState() {
  const first = new Date(`${tripDays[0].date}T00:00:00`);
  const last = new Date(`${tripDays[tripDays.length - 1].date}T23:59:59`);
  const dayMs = 24 * 60 * 60 * 1000;

  if (now < first) {
    const daysLeft = Math.ceil((first - now) / dayMs);
    return { label: `출발 ${daysLeft}일 전`, mode: "before" };
  }

  if (now > last) return { label: "여행이 끝난 뒤", mode: "after" };

  const current = tripDays[getTodayIndex()];
  return { label: `${formatDate.format(new Date(`${current.date}T09:00:00`))} 여행 중`, mode: "during" };
}

function getStepForNow(day) {
  const currentMinutes = Number(mockHour || now.getHours()) * 60 + now.getMinutes();
  const upcoming = day.steps.find((step) => timeToMinutes(step.time) >= currentMinutes);
  return upcoming || day.steps.at(-1);
}

function timeToMinutes(time) {
  const match = time.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return 12 * 60;
  return Number(match[1]) * 60 + Number(match[2]);
}

function getStepState(day, step, index, dayIndex) {
  if (dayIndex !== getTodayIndex() || dateOnly(now) !== day.date) return "";

  const currentMinutes = Number(mockHour || now.getHours()) * 60 + now.getMinutes();
  const start = timeToMinutes(step.time);
  const next = day.steps[index + 1] ? timeToMinutes(day.steps[index + 1].time) : 24 * 60;

  if (currentMinutes >= start && currentMinutes < next) return "now";
  if (start > currentMinutes) return "next";
  return "done";
}

function renderAssistant() {
  const index = getTodayIndex();
  const day = tripDays[index];
  const state = getTripState();
  const step = getStepForNow(day);

  document.querySelector("#heroStatus").textContent = state.label;
  document.querySelector("#todayBadge").textContent = `${formatDate.format(new Date(day.date))} · ${day.city}`;

  const title = state.mode === "before" ? "출발 전 준비를 하면 좋아요" : `${day.city}에서 오늘의 흐름`;
  const body =
    state.mode === "before"
      ? "여권, 충전기, 상비약, 우산을 먼저 챙기고 도착 첫날은 휴식 중심으로 잡아두세요."
      : day.advice;

  document.querySelector("#assistantTitle").textContent = title;
  document.querySelector("#assistantBody").textContent = body;

  document.querySelector("#nextBox").innerHTML = `
    <span>다음 일정</span>
    <strong>${step.time} · ${step.text}</strong>
    <p>${day.title}</p>
  `;
}

function renderTimeline() {
  const todayIndex = getTodayIndex();
  const timeline = document.querySelector("#timeline");
  timeline.innerHTML = tripDays
    .map((day, index) => {
      const date = new Date(`${day.date}T09:00:00`);
      const items = day.steps.map((step) => `<li><strong>${step.time}</strong> ${step.text}</li>`).join("");
      return `
        <article class="dayCard ${index === todayIndex ? "active" : ""}">
          <span>${formatDate.format(date)} · ${day.city}</span>
          <h3>${day.title}</h3>
          <p>${day.advice}</p>
          <ol>${items}</ol>
        </article>
      `;
    })
    .join("");
}

function renderAgendaApp() {
  const selector = document.querySelector("#daySelector");
  const summary = document.querySelector("#agendaSummary");
  const list = document.querySelector("#agendaList");
  const todayIndex = getTodayIndex();
  const day = tripDays[selectedDayIndex];
  const date = new Date(`${day.date}T09:00:00`);

  selector.innerHTML = tripDays
    .map((item, index) => {
      const itemDate = new Date(`${item.date}T09:00:00`);
      const isSelected = index === selectedDayIndex;
      const isToday = index === todayIndex;
      return `
        <button class="${isSelected ? "selected" : ""}" data-day-index="${index}" aria-pressed="${isSelected}">
          <span>${formatDate.format(itemDate).replace("요일", "")}</span>
          <strong>${item.city.includes("푸트라자야") ? "푸트라자야" : "쿠알라룸푸르"}</strong>
          ${isToday ? "<em>오늘</em>" : ""}
        </button>
      `;
    })
    .join("");

  summary.innerHTML = `
    <span>${formatDate.format(date)} · ${day.city}</span>
    <h3>${day.title}</h3>
    <p>${day.advice}</p>
    <div>
      <strong>${day.steps.length}개 일정</strong>
      <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(day.map)}" target="_blank" rel="noreferrer">대표 지도 열기</a>
    </div>
  `;

  list.innerHTML = day.steps
    .map((step, index) => {
      const state = getStepState(day, step, index, selectedDayIndex);
      const stateLabel = state === "now" ? "지금" : state === "next" ? "다음" : state === "done" ? "완료" : step.type;
      return `
        <article class="agendaItem ${state}">
          <div class="agendaTime">
            <strong>${step.time}</strong>
            <span>${stateLabel}</span>
          </div>
          <div class="agendaBody">
            <span>${step.type} · ${step.place}</span>
            <h4>${step.text}</h4>
            <p>${step.note}</p>
            <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(step.map)}" target="_blank" rel="noreferrer">지도 열기</a>
          </div>
        </article>
      `;
    })
    .join("");

  selector.querySelectorAll("[data-day-index]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedDayIndex = Number(button.dataset.dayIndex);
      renderAgendaApp();
    });
  });
}

function fallbackWeather() {
  return tripDays.map((day) => ({
    date: day.date,
    city: day.city.includes("푸트라자야") ? "푸트라자야" : "쿠알라룸푸르",
    min: 24,
    max: 33,
    rain: 55,
    text: "덥고 습함, 오후 소나기 가능",
  }));
}

function weatherLabel(code) {
  if ([0, 1].includes(code)) return "대체로 맑음";
  if ([2, 3].includes(code)) return "구름 많음";
  if ([45, 48].includes(code)) return "안개 가능";
  if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(code)) return "비 또는 소나기";
  if ([95, 96, 99].includes(code)) return "천둥·번개 가능";
  return "변덕스러운 날씨";
}

async function fetchPlaceWeather(place) {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.search = new URLSearchParams({
    latitude: place.lat,
    longitude: place.lon,
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
    timezone: "Asia/Kuala_Lumpur",
    start_date: "2026-06-26",
    end_date: "2026-07-01",
  });

  const response = await fetch(url);
  if (!response.ok) throw new Error("날씨를 불러오지 못했습니다.");
  const data = await response.json();
  return data.daily.time.map((date, index) => ({
    date,
    min: Math.round(data.daily.temperature_2m_min[index]),
    max: Math.round(data.daily.temperature_2m_max[index]),
    rain: data.daily.precipitation_probability_max[index] ?? 50,
    text: weatherLabel(data.daily.weather_code[index]),
  }));
}

async function renderWeather() {
  const cards = document.querySelector("#weatherCards");
  try {
    const [kl, putrajaya] = await Promise.all([
      fetchPlaceWeather(weatherPlaces.kl),
      fetchPlaceWeather(weatherPlaces.putrajaya),
    ]);

    const byKey = { kl, putrajaya };
    const rows = tripDays.map((day) => {
      const forecast = byKey[day.weatherKey].find((item) => item.date === day.date);
      return {
        date: day.date,
        city: day.weatherKey === "kl" ? "쿠알라룸푸르" : "푸트라자야",
        ...forecast,
      };
    });
    cards.innerHTML = weatherMarkup(rows);
  } catch {
    cards.innerHTML = weatherMarkup(fallbackWeather());
  }
}

function weatherMarkup(rows) {
  return rows
    .map((item) => {
      const rainTip = item.rain >= 50 ? "우산을 바로 꺼내기 쉬운 곳에 두세요." : "그래도 접이식 우산은 챙기세요.";
      return `
        <article class="weatherCard">
          <span>${formatDate.format(new Date(`${item.date}T09:00:00`))} · ${item.city}</span>
          <strong>${item.min}°C - ${item.max}°C</strong>
          <p>${item.text} · 강수 가능성 ${item.rain}%</p>
          <p>${rainTip}</p>
        </article>
      `;
    })
    .join("");
}

function answerQuestion(type) {
  const day = tripDays[getTodayIndex()];
  const step = getStepForNow(day);
  const answerBox = document.querySelector("#answerBox");
  const answers = {
    next: {
      title: "다음 일정",
      body: `${step.time}에는 "${step.text}"입니다. 너무 덥거나 피곤하면 바로 실내 카페나 쇼핑몰 휴식으로 바꾸세요.`,
    },
    weather: {
      title: "오늘 날씨 준비",
      body: `${day.city}는 덥고 습할 가능성이 큽니다. 물, 접이식 우산, 얇은 긴팔을 챙기고 오후 야외 일정은 짧게 잡으세요.`,
    },
    rain: {
      title: "비가 오면 이렇게 바꾸세요",
      body: "야외 사진 코스는 줄이고 쇼핑몰, 카페, 박물관, 마사지처럼 실내 동선으로 바꾸세요. 택시 승하차 지점을 먼저 정하면 부모님이 덜 힘듭니다.",
    },
    rest: {
      title: "부모님 휴식 우선",
      body: "오전 1곳, 오후 1곳만 확실히 보고 중간에 60분 이상 쉬는 흐름이 좋습니다. 계단 많은 곳은 사진만 찍고 무리하지 않아도 괜찮습니다.",
    },
  };

  const answer = answers[type] || answers.next;
  answerBox.innerHTML = `<strong>${answer.title}</strong><p>${answer.body}</p>`;
}

document.querySelectorAll("[data-question]").forEach((button) => {
  button.addEventListener("click", () => answerQuestion(button.dataset.question));
});

renderAssistant();
renderAgendaApp();
renderTimeline();
renderWeather();
