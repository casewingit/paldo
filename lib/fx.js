// 원↔링깃 환율 계산기 — 무료·키 불필요 API(open.er-api.com)로 하루 1회 갱신,
// 실패 시 하드코딩 근사치로 폴백. 목적: 현지 물가를 원화로 직관적으로 체감.

const FALLBACK_KRW_PER_RM = 370; // 2026 근사치(네트워크 실패 시 폴백)
const LS_FX = "paldo.fx";
const ONE_DAY = 24 * 60 * 60 * 1000;
const QUICK_RM = [1, 5, 10, 20, 50, 100]; // 물가 체감용 빠른 환산(커피·식사·Grab·쇼핑대)

const won = (n) => "₩" + Math.round(n).toLocaleString("ko-KR");

// 캐시(1일) → 라이브 API → 폴백 순. {rate, live} 반환.
async function getRate() {
  try {
    const cached = JSON.parse(localStorage.getItem(LS_FX) || "null");
    if (cached && cached.rate > 0 && Date.now() - cached.ts < ONE_DAY) {
      return { rate: cached.rate, live: cached.live };
    }
  } catch {
    /* 무시하고 재요청 */
  }
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/MYR");
    if (!res.ok) throw new Error("fx http");
    const data = await res.json();
    const rate = data?.rates?.KRW;
    if (!rate || !Number.isFinite(rate)) throw new Error("no KRW");
    localStorage.setItem(LS_FX, JSON.stringify({ rate, ts: Date.now(), live: true }));
    return { rate, live: true };
  } catch {
    return { rate: FALLBACK_KRW_PER_RM, live: false };
  }
}

export async function initCurrency() {
  const inRM = document.getElementById("fxRM");
  const inKRW = document.getElementById("fxKRW");
  const rateEl = document.getElementById("fxRate");
  const chipsEl = document.getElementById("fxChips");
  const noteEl = document.getElementById("fxNote");
  if (!inRM || !inKRW) return;

  const { rate, live } = await getRate();

  if (rateEl) rateEl.textContent = `RM 1 ≈ ${won(rate)}`;
  if (noteEl) {
    noteEl.textContent = live
      ? "실시간 환율 기준 · 참고용 (수수료·스프레드 제외)"
      : "환율을 불러오지 못해 근사치(RM 1 ≈ ₩370)를 사용합니다.";
  }

  // 양방향 동기화: 편집 중인 입력은 건드리지 않고 반대쪽만 갱신.
  inRM.addEventListener("input", () => {
    const v = parseFloat(inRM.value);
    inKRW.value = v > 0 ? Math.round(v * rate) : "";
  });
  inKRW.addEventListener("input", () => {
    const v = parseFloat(inKRW.value);
    inRM.value = v > 0 ? Math.round((v / rate) * 100) / 100 : "";
  });

  // 현재 RM 입력값(소수 2자리)으로 양쪽 동기화.
  const setRM = (v) => {
    const n = Math.round(v * 100) / 100;
    inRM.value = n > 0 ? n : "";
    inKRW.value = n > 0 ? Math.round(n * rate) : "";
  };

  // 빠른 추가 칩: 누를 때마다 해당 금액을 누적(RM100 두 번 → 200).
  if (chipsEl) {
    chipsEl.replaceChildren(
      ...QUICK_RM.map((amt) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "fxChip";
        b.innerHTML = `<b>+RM ${amt}</b><span>${won(amt * rate)}</span>`;
        b.addEventListener("click", () => setRM((parseFloat(inRM.value) || 0) + amt));
        return b;
      })
    );
  }

  // 초기화: 두 입력 비우고 RM에 포커스.
  const resetBtn = document.getElementById("fxReset");
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      inRM.value = "";
      inKRW.value = "";
      inRM.focus();
    });
  }
}
