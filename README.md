# BLIND TURN

2~6인 서버 권한형 온라인 전투 웹게임 MVP입니다. 순수 TypeScript 전투 엔진, Socket.IO 서버, Next.js 클라이언트를 pnpm workspace로 분리했습니다.

## 구성

```text
apps/web             Next.js 온라인 UI와 /local 규칙 시뮬레이터
apps/server          Node.js + Socket.IO 권한형 게임 서버
packages/shared      공용 타입, Zod 스키마, 플레이어별 공개 뷰
packages/game-engine 순수 전투 판정 엔진
```

서버가 체력, 속도, 턴, 행동 잠금, 피해와 승패를 소유합니다. 클라이언트에는 자신의 속도·행동과 판정이 끝난 공개 결과만 전달합니다.

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
- 로컬 규칙 시뮬레이터: `http://localhost:3000/local`

로컬 환경 파일은 예제를 복사해 만듭니다.

```env
# apps/web/.env.local
NEXT_PUBLIC_SOCKET_SERVER_URL=http://localhost:4000

# apps/server/.env
NODE_ENV=development
SOCKET_SERVER_PORT=4000
WEB_CLIENT_ORIGIN=http://localhost:3000
SHUTDOWN_TIMEOUT_MS=10000
```

운영 환경에서는 Web의 `NEXT_PUBLIC_SOCKET_SERVER_URL`과 Server의 `WEB_CLIENT_ORIGIN`이 필수입니다. `WEB_CLIENT_ORIGIN`은 쉼표로 여러 Origin을 받을 수 있으며 경로 없는 정확한 `http(s)` Origin만 허용합니다. Server는 Railway의 `PORT`를 `SOCKET_SERVER_PORT`보다 우선합니다.

## 서비스별 명령

Railway 두 서비스 모두 공유 workspace 패키지를 사용하므로 저장소 루트에서 빌드합니다.

| 서비스 | Build Command | Start Command | Health Check |
| --- | --- | --- | --- |
| `blind-turn-web` | `pnpm install --frozen-lockfile && pnpm build:web` | `pnpm start:web` | `/api/health` |
| `blind-turn-server` | `pnpm install --frozen-lockfile && pnpm build:server` | `pnpm start:server` | `/health` |

Server는 `0.0.0.0:$PORT`에 바인딩합니다. Next.js Web도 `0.0.0.0:$PORT`로 실행됩니다.

## 프로덕션 구조

하나의 Railway 프로젝트에 `blind-turn-web`과 `blind-turn-server` 두 서비스를 만들고, Server는 반드시 단일 인스턴스로 운용합니다. 자세한 화면 설정은 [Railway 배포 가이드](./docs/DEPLOYMENT_RAILWAY.md)를 따릅니다.

현재 방, 게임 상태, reconnectToken은 Server 프로세스 메모리에만 있습니다. 브라우저는 자신의 `roomCode`, `playerId`, `reconnectToken`만 localStorage에 저장합니다. 따라서 Server 재시작·재배포 시 진행 중인 방은 사라지고 기존 토큰으로 복구할 수 없습니다. 이때 `ROOM_SESSION_EXPIRED` 안내와 `게임 정보 초기화` 버튼이 표시됩니다. 이번 단계에는 데이터베이스, Redis, 다중 Server 인스턴스가 포함되지 않습니다.

## 검증

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm lint
pnpm typecheck
pnpm build
```

테스트는 전투 규칙, 비공개 정보, 제한 시간, 중복 판정, Socket.IO 흐름, CORS, health, 환경변수, 재접속, 종료와 타이머 정리를 검증합니다.

관련 문서:

- [게임 규칙](./docs/GAME_RULES.md)
- [아키텍처](./docs/ARCHITECTURE.md)
- [멀티플레이 테스트 가이드](./docs/MULTIPLAYER_TEST_GUIDE.md)
- [Railway 배포 가이드](./docs/DEPLOYMENT_RAILWAY.md)
- [프로덕션 실전 테스트 체크리스트](./docs/PRODUCTION_PLAYTEST_CHECKLIST.md)
