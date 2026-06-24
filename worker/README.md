# paldo-proxy (Cloudflare Worker)

Google 키를 서버측에 숨기는 프록시. 프론트는 이 Worker 만 호출하고 키를 갖지 않는다.

## 엔드포인트 (POST, JSON)

| 경로 | 요청 | 응답 |
|------|------|------|
| `/geocode` | `{address}` | `{lat,lng,formattedAddress}` |
| `/resolve-link` | `{shareUrl}` | `{lat,lng,label}` |
| `/routes` | `{origin:{lat,lng}, destinations:[{lat,lng},…]}` | `[{distanceMeters,durationSeconds}|null, …]` |

## GCP 사전 설정
기존 키에 **Geocoding API**, **Routes API** 활성화 (Places API New 는 빌드용으로 이미 켜짐).
키는 이 Worker 의 시크릿에만 보관 → API 제한 + 예산 알림 설정 권장.

## 로컬 개발
```bash
cd worker
npm install
cp .dev.vars.example .dev.vars      # .dev.vars 에 실제 키 입력
npx wrangler dev                    # http://localhost:8787
```
그동안 루트 `config.js` 의 `WORKER_URL` 을 `"http://localhost:8787"` 로 두면 프론트가 로컬 Worker 를 호출한다.

## 배포
```bash
cd worker
npx wrangler deploy
npx wrangler secret put GOOGLE_MAPS_API_KEY   # 운영 키 입력
# (권장) ALLOWED_ORIGIN 을 Pages 오리진으로 고정: wrangler.jsonc 수정 후 재배포
```
배포 후 출력된 `https://paldo-proxy.<subdomain>.workers.dev` 를 루트 `config.js` 의 `WORKER_URL` 에 넣고 커밋.

## 빠른 테스트
```bash
curl -X POST http://localhost:8787/geocode \
  -H 'Content-Type: application/json' -d '{"address":"KLCC, Kuala Lumpur"}'
```
