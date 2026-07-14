# BLIND TURN Railway 배포 가이드

이 문서는 하나의 Railway 프로젝트에 Next.js Web과 Socket.IO Server를 각각 한 서비스로 배포하는 절차입니다. 두 앱은 `packages/shared`와 `packages/game-engine`을 참조하므로 두 서비스 모두 저장소 루트를 빌드 컨텍스트로 사용합니다.

## 1. 사전 준비

1. 이 저장소를 GitHub 원격 저장소에 push합니다.
2. Railway 계정에서 GitHub 연동을 허용합니다.
3. 로컬에서 다음 명령이 모두 성공하는지 확인합니다.

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm lint
pnpm typecheck
pnpm build
```

4. 서버 상태가 메모리에만 있으므로 Server 인스턴스는 한 개만 사용할 것을 확인합니다.

## 2. 프로젝트와 서비스 만들기

1. Railway Dashboard에서 `New Project` → `Empty Project`를 선택합니다.
2. 프로젝트 이름을 `blind-turn`으로 바꿉니다.
3. 프로젝트 Canvas의 `Create`에서 빈 서비스 두 개를 만들고 각각 `blind-turn-web`, `blind-turn-server`로 이름을 바꿉니다.
4. 각 서비스의 `Settings` → `Source`에서 같은 GitHub 저장소와 배포 브랜치를 연결합니다.

Railway가 JavaScript 모노레포를 자동 감지해 서비스를 제안한 경우에도 최종적으로 위 두 서비스만 사용하고 아래 명령을 직접 확인합니다.

## 3. 공유 모노레포 빌드 설정

두 서비스의 `Settings`에서 Root Directory를 비워 두거나 `/`로 유지합니다. `apps/web` 또는 `apps/server`로 지정하면 루트 lockfile과 workspace 공유 패키지를 함께 사용할 수 없습니다.

### blind-turn-web

- Build Command: `pnpm install --frozen-lockfile && pnpm build:web`
- Start Command: `pnpm start:web`
- Healthcheck Path: `/api/health`

### blind-turn-server

- Build Command: `pnpm install --frozen-lockfile && pnpm build:server`
- Start Command: `pnpm start:server`
- Healthcheck Path: `/health`

Railway는 `packageManager`와 `.node-version`을 읽어 pnpm 11.7.0과 Node.js 22.17.0을 사용합니다. `PORT`는 Railway가 자동 주입하므로 서비스 변수에 수동으로 고정하지 않습니다.

선택 사항으로 `Settings` → Watch Paths를 다음처럼 지정하면 무관한 앱 변경으로 인한 재배포를 줄일 수 있습니다.

Web:

```text
/apps/web/**
/packages/shared/**
/packages/game-engine/**
/package.json
/pnpm-lock.yaml
/pnpm-workspace.yaml
```

Server:

```text
/apps/server/**
/packages/shared/**
/packages/game-engine/**
/package.json
/pnpm-lock.yaml
/pnpm-workspace.yaml
```

## 4. 공개 도메인과 환경변수 연결

가장 안전한 방법은 두 서비스의 `Settings` → `Networking`에서 `Generate Domain`으로 도메인을 먼저 확보한 뒤 변수를 입력하고 한 번에 배포하는 것입니다.

예시:

```text
Web:    https://blind-turn-web-production.up.railway.app
Server: https://blind-turn-server-production.up.railway.app
```

실제 Railway가 생성한 주소를 사용하며 끝에 `/`를 붙이지 않습니다.

### blind-turn-web Variables

```env
NEXT_PUBLIC_SOCKET_SERVER_URL=https://실제-server-도메인
```

`NEXT_PUBLIC_*` 값은 Next.js 빌드 결과에 포함됩니다. 이 값을 바꾼 뒤에는 Web을 반드시 새로 빌드해야 하며, Railway의 `Skipped Builds` 기능은 Web 서비스에서 끕니다.

### blind-turn-server Variables

```env
NODE_ENV=production
WEB_CLIENT_ORIGIN=https://실제-web-도메인
SHUTDOWN_TIMEOUT_MS=10000
```

미리보기 도메인 등 여러 Origin이 꼭 필요하면 쉼표로 추가합니다.

```env
WEB_CLIENT_ORIGIN=https://실제-web-도메인,https://허용할-preview-도메인
```

`*`는 사용하지 않습니다. 경로, query, 사용자 정보가 포함된 URL도 거부됩니다.

만약 첫 배포 전 `Generate Domain` 버튼을 사용할 수 없다면 다음 bootstrap 순서를 사용합니다.

1. Server에 `NODE_ENV=production`, `WEB_CLIENT_ORIGIN=https://bootstrap.invalid`를 넣어 먼저 배포합니다.
2. Server의 공개 도메인을 생성합니다.
3. Web에 Server URL을 넣어 배포하고 Web 도메인을 생성합니다.
4. Server의 `WEB_CLIENT_ORIGIN`을 실제 Web 도메인으로 교체합니다.
5. Server를 재배포합니다. `bootstrap.invalid`는 최종 변수에 남기지 않습니다.

## 5. 배포 적용과 인스턴스 수

1. 각 서비스의 staged changes를 확인하고 `Deploy`를 누릅니다.
2. Server 서비스의 replica/region 설정은 인스턴스 한 개만 유지합니다.
3. Server 로그에서 `server_started` JSON 로그와 Railway가 주입한 포트가 보이는지 확인합니다.
4. Web은 Server 도메인 설정 후 빌드되었는지 확인합니다.

진행 중 게임은 메모리 상태이므로 Server를 재배포하면 사라집니다. 실전 게임 중에는 설정 변경과 재배포를 피합니다.

## 6. Health check 확인

브라우저나 터미널에서 실제 도메인으로 확인합니다.

```bash
curl https://실제-server-도메인/health
curl https://실제-web-도메인/api/health
```

Server 정상 응답 예:

```json
{
  "ok": true,
  "service": "blind-turn-server",
  "uptimeSeconds": 12,
  "activeRooms": 0,
  "connectedPlayers": 0
}
```

방 코드, 닉네임, reconnectToken, 비공개 속도와 행동이 응답에 없어야 합니다. Railway healthcheck는 새 배포가 `200`을 반환한 뒤 트래픽을 전환하며, 배포 후의 지속 모니터링을 대신하지는 않습니다.

## 7. 실제 브라우저 테스트

1. Web 공개 도메인을 일반 브라우저에서 엽니다.
2. 개발자 도구 Network에서 Socket.IO가 Server 공개 도메인으로 연결되는지 확인합니다.
3. 일반 창에서 방을 만들고 시크릿 창에서 입장합니다.
4. 준비, 게임 시작, 행동 제출, 턴 판정, 재경기를 확인합니다.
5. 게임 중 한 브라우저를 새로고침해 자신의 속도·제출 상태·남은 시간이 복원되는지 확인합니다.
6. Wi-Fi와 모바일 데이터처럼 서로 다른 네트워크에서도 연결합니다.
7. 전체 시나리오는 [프로덕션 플레이테스트 체크리스트](./PRODUCTION_PLAYTEST_CHECKLIST.md)를 사용합니다.

연결이 실패하면 다음 순서로 확인합니다.

1. Web 빌드 로그에 `NEXT_PUBLIC_SOCKET_SERVER_URL`이 설정된 상태였는지
2. Server `WEB_CLIENT_ORIGIN`이 주소창의 Web Origin과 정확히 같은지
3. 두 URL 모두 `https://`인지
4. Server 로그의 `socket_origin_rejected`, `socket_request_failed` 오류 코드
5. Server가 단일 인스턴스인지

## 8. 재배포와 롤백

환경변수를 바꿨다면 해당 서비스의 `Deployments`에서 최신 commit을 다시 배포합니다. 특히 Web의 공개 환경변수 변경은 재시작이 아니라 재빌드가 필요합니다.

문제가 발생하면 서비스의 `Deployments` 탭에서 이전 성공 배포 오른쪽 `⋯` → `Rollback`을 선택하고 확인합니다. Railway rollback은 해당 배포의 이미지와 변수도 이전 상태로 복원하므로, 롤백 후 Web URL과 Server CORS가 서로 맞는지 다시 확인합니다. 보존 기간이 지나 Rollback이 보이지 않으면 정상 배포를 선택해 `Redeploy`하거나 정상 commit을 다시 배포합니다.

## 9. 현재 운영 제한

- Server 재시작·재배포 시 진행 중인 방과 게임이 사라집니다.
- 기존 reconnectToken으로 사라진 방을 복구할 수 없습니다.
- Server는 단일 인스턴스만 지원합니다.
- Redis, 데이터베이스, 계정, 전적 저장은 없습니다.

## Railway 공식 참고 문서

- [Deploying a Monorepo](https://docs.railway.com/deployments/monorepo)
- [Build and Start Commands](https://docs.railway.com/builds/build-and-start-commands)
- [Healthchecks](https://docs.railway.com/deployments/healthchecks)
- [Deployment Actions and Rollback](https://docs.railway.com/deployments/deployment-actions)
