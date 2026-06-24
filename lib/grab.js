// Grab 예상 요금 — 공개 가격 API 가 없으므로 공개된 요금 공식 기반 "추정치".
// GrabCar Economy / Klang Valley(쿠알라룸푸르·셀랑오르) 기준. 실제 요금은
// 혼잡(surge)·통행료·시간대에 따라 달라지므로 반드시 "예상치"로 표기한다.
// 상수는 GRAB_CONFIG 한 곳에서만 조정한다.

export const GRAB_CONFIG = {
  currency: "RM",
  base: 4.0, // 기본요금(flagfall)
  perKm: 1.6, // km 당 요금
  perMin: 0.3, // 분당 요금(대기/정체 반영)
  minFare: 6.0, // 플랫폼 최소요금
  surgeNote: "혼잡 시간대·통행료에 따라 실제 요금은 더 높을 수 있어요.",
};

// distanceKm, durationMin → { amount, currency, isEstimate }
export function estimateGrabFare(distanceKm, durationMin, cfg = GRAB_CONFIG) {
  const km = Math.max(0, Number(distanceKm) || 0);
  const min = Math.max(0, Number(durationMin) || 0);
  const raw = cfg.base + cfg.perKm * km + cfg.perMin * min;
  const fare = Math.max(raw, cfg.minFare);
  return { amount: Math.round(fare), currency: cfg.currency, isEstimate: true };
}
