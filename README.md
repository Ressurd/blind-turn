# BLIND TURN

2~6인 서버 권한형 카드 심리전 웹게임입니다. V2는 속도·숨김 동률·시선/허점 규칙을 제거하고, `8장 덱 → 3장 시작 손패 → 라운드마다 최대 3장 비공개 예약 → 단계별 동시 판정` 구조를 사용합니다.

## 패키지

```text
apps/web             Next.js 온라인 UI, 전투 재생, /local 카드 카탈로그
apps/server          Node.js + Socket.IO 권한형 룸/게임 서버
packages/shared      공용 타입, Socket 계약, Zod 입력 스키마
packages/game-engine 순수 TypeScript 카드·덱·라운드 판정 엔진
```

서버가 캐릭터, 체력, 덱/손패/버림 더미, 비공개 카드 큐, 주사위, 피해, 보상과 승패를 소유합니다. 클라이언트는 자신의 손패에서 카드와 대상만 요청하며 확정 전 상대의 카드 수·종류·순서는 볼 수 없습니다.

## V2 핵심

- 캐릭터 4종: 결투가, 광전사, 수호자, 전술가
- 기본 덱 8장: 속공×2, 강공×2, 방어×2, 회피×1, 반격×1
- 시작 손패 3장, 손패 최대 5장, 라운드 시작 시 1장 드로우
- 한 라운드에 0~3장을 순서대로 예약하고 60초 안에 확정
- 같은 단계의 공격·방어·회피·반격·회복·피해는 동시 기준으로 판정
- 매 3라운드마다 직업 카드 2장 + 공용 카드 1장 중 하나를 30초 안에 선택
- 덱은 8→9→10장으로 성장하고, 10장 이후에는 기존 카드 1장을 제거한 뒤 새 카드를 삽입
- 같은 카드 최대 2장, 덱에 공격 카드 최소 1장 유지
- 같은 방 채팅, 최근 50개 복구, 100자/초당 2개 제한, 사망자 전송 금지

상세 규칙은 [게임 규칙](./docs/GAME_RULES.md)에 있습니다.

## 로컬 실행

Node.js 22.17.x와 pnpm 11.x를 사용합니다.

```bash
pnpm install --frozen-lockfile
pnpm dev
```

- Web: `http://localhost:3000`
- Web health: `http://localhost:3000/api/health`
- Socket.IO Server: `http://localhost:4000`
- Server health: `http://localhost:4000/health`
- 카드/캐릭터 카탈로그: `http://localhost:3000/local`

```env
# apps/web/.env.local
NEXT_PUBLIC_SOCKET_SERVER_URL=http://localhost:4000

# apps/server/.env
NODE_ENV=development
SOCKET_SERVER_PORT=4000
WEB_CLIENT_ORIGIN=http://localhost:3000
SHUTDOWN_TIMEOUT_MS=10000
```

운영 환경에서는 Web의 `NEXT_PUBLIC_SOCKET_SERVER_URL`과 Server의 `WEB_CLIENT_ORIGIN`이 필수입니다. Server는 Railway의 `PORT`를 우선 사용합니다.

## Railway 서비스

두 서비스 모두 저장소 루트에서 빌드합니다.

| 서비스 | Build Command | Start Command | Health Check |
| --- | --- | --- | --- |
| `blind-turn-web` | `pnpm install --frozen-lockfile && pnpm build:web` | `pnpm start:web` | `/api/health` |
| `blind-turn-server` | `pnpm install --frozen-lockfile && pnpm build:server` | `pnpm start:server` | `/health` |

방과 게임은 Server 프로세스 메모리에만 있으므로 Server는 한 인스턴스로 운용해야 합니다. 재배포/재시작 시 진행 중 방은 사라집니다. 자세한 설정은 [Railway 배포 가이드](./docs/DEPLOYMENT_RAILWAY.md)를 따릅니다.

## 검증

```bash
pnpm test
pnpm lint
pnpm typecheck
pnpm build
```

테스트는 카드/캐릭터 데이터, 덱 생명주기, 0~3장 큐, 단계 동시성, 방어·회피·반격·합, 사망 후 예약 취소, 보상/덱 교체, 비공개 뷰, 타이머, 채팅, 재접속, Socket.IO 동기화와 프로덕션 health/CORS를 검증합니다.

- [아키텍처](./docs/ARCHITECTURE.md)
- [멀티플레이 테스트 가이드](./docs/MULTIPLAYER_TEST_GUIDE.md)
- [프로덕션 실전 테스트 체크리스트](./docs/PRODUCTION_PLAYTEST_CHECKLIST.md)
