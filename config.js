// 프론트 공개 설정 (시크릿 아님 — 커밋해도 됨).
// WORKER_URL = 키를 보관하는 Cloudflare Worker 프록시 주소.
//   - 로컬 테스트: "http://localhost:8787" (wrangler dev)
//   - 운영: "https://paldo-proxy.<your-subdomain>.workers.dev"
// 비어 있으면(Phase 1) 거리·Grab 비용 없이 추천 목록과 길찾기 링크만 동작한다.
window.PALDO_CONFIG = {
  WORKER_URL: "",
};
