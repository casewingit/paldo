// 추천 점수 — 빌드 시(enrich-places.mjs)와 런타임(app.js)이 공유하는 단일 진실원.
// 점수 = 평점 품질 + 리뷰 신뢰도 + 주관적 경험 가중치.
// 가중치/기준값은 SCORE_CONFIG 한 곳에서만 조정한다.

export const SCORE_CONFIG = {
  ratingWeight: 1.0, // Google 별점(0~5)에 대한 가중치
  reviewWeight: 0.6, // log10(리뷰수)에 대한 가중치
  boostWeight: 1.2, // 큐레이션 핀의 주관적 가중치(boost-1)에 대한 가중치
  ratingFloor: 3.0, // 이 점수 미만의 별점은 품질 기여 0 (평범한 곳 배제)
};

// place: { rating, userRatingCount, boost }
//  - rating: Google 별점 (없으면 0 → 품질 기여 0)
//  - userRatingCount: 리뷰 수 (많을수록 신뢰, 로그로 체감)
//  - boost: 주관적 추천 강도 (1=중립, 1.5=강한 개인추천)
export function recommendationScore(place = {}, cfg = SCORE_CONFIG) {
  const rating = Number(place.rating) || 0;
  const reviews = Number(place.userRatingCount) || 0;
  const boost = Number(place.boost) || 1;

  const quality = Math.max(0, rating - cfg.ratingFloor); // 0..2 (3.0~5.0 구간)
  const trust = Math.log10(1 + reviews); // 10→1, 1000→3, 체감 증가

  return (
    cfg.ratingWeight * quality +
    cfg.reviewWeight * trust +
    cfg.boostWeight * (boost - 1)
  );
}
