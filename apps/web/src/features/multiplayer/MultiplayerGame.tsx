"use client";

import {
  MAX_HP,
  SocketPlayerActionSchema,
  formatHp,
  type PlayerActionType,
  type PlayerGameView,
  type PublicBattleEvent,
  type SessionCredentials,
  type SocketError,
  type TurnResolvedPayload,
} from "@blind-turn/shared";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  getGameSocket,
  SOCKET_CONFIGURATION_ERROR,
  SOCKET_SERVER_URL,
  USING_DEFAULT_SOCKET_URL,
  type GameClientSocket,
} from "./socket-client";

type ClientActionType = Exclude<PlayerActionType, "PASS">;

type ActionDraft = {
  type: ClientActionType;
  targetPlayerId: string;
};

type EventLogEntry = {
  id: number;
  turnNumber: number;
  event: PublicBattleEvent;
};

type PlaybackState = {
  payload: TurnResolvedPayload;
  nextIndex: number;
};

type ConnectionStatus =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "failed";

const CONNECTION_LABEL: Record<ConnectionStatus, string> = {
  connecting: "연결 중",
  connected: "연결됨",
  reconnecting: "재연결 중",
  disconnected: "연결 끊김",
  failed: "연결 실패",
};

const SESSION_RESET_ERRORS = new Set<SocketError["code"]>([
  "ROOM_SESSION_EXPIRED",
  "INVALID_RECONNECT_TOKEN",
  "PLAYER_NOT_FOUND",
]);

const SESSION_STORAGE_KEY = "blind-turn:online-session";

const ACTIONS: Array<{ type: ClientActionType; label: string; code: string }> = [
  { type: "ATTACK", label: "공격", code: "ATK" },
  { type: "DEFEND", label: "수비", code: "DEF" },
  { type: "EVADE", label: "회피", code: "EVD" },
  { type: "COUNTER", label: "반격", code: "CTR" },
];

const ACTION_LABEL: Record<PlayerActionType, string> = {
  ATTACK: "공격",
  DEFEND: "수비",
  EVADE: "회피",
  COUNTER: "반격",
  PASS: "시간 초과",
};

function playbackDelay(event: PublicBattleEvent): number {
  switch (event.type) {
    case "PLAYER_DIED":
      return 800;
    case "CLASH_STARTED":
    case "CLASH_ROLLED":
    case "EVADE_ROLLED":
      return 700;
    case "DAMAGE_APPLIED":
      return 600;
    default:
      return 400;
  }
}

function eventDescription(
  event: PublicBattleEvent,
  view: PlayerGameView,
): string {
  const name = (id: string) =>
    view.players.find((player) => player.playerId === id)?.nickname ?? "알 수 없음";
  switch (event.type) {
    case "TURN_STARTED":
      return `${event.turnNumber}턴이 시작되었습니다.`;
    case "ACTION_STARTED":
      return `${name(event.playerId)} · ${ACTION_LABEL[event.actionType]}`;
    case "ATTACK_STARTED":
      return `${name(event.attackerId)} → ${name(event.targetId)} 공격`;
    case "CLASH_STARTED":
      return `${name(event.playerIds[0])}와 ${name(event.playerIds[1])}의 합 발생`;
    case "CLASH_ROLLED":
      return `${name(event.playerId)}의 합 주사위 · ${event.roll}`;
    case "CLASH_RESOLVED":
      return `${name(event.winnerId)} 승리 · ${name(event.loserId)} 패배`;
    case "DEFENSE_ACTIVATED":
      return `${name(event.playerId)} 수비 활성화`;
    case "EVADE_ACTIVATED":
      return `${name(event.playerId)} 회피 활성화`;
    case "EVADE_ROLLED":
      return `${name(event.playerId)} 회피 ${event.roll} vs 공격 속도 ${event.attackerSpeed}`;
    case "EVADE_SUCCEEDED":
      return `${name(event.playerId)} 회피 성공`;
    case "EVADE_FAILED":
      return `${name(event.playerId)} 회피 실패`;
    case "COUNTER_ACTIVATED":
      return `${name(event.playerId)}가 ${name(event.targetPlayerId)}을 주시합니다.`;
    case "COUNTER_TRIGGERED":
      return `${name(event.counterPlayerId)}의 반격이 ${name(event.attackerId)}에게 적중`;
    case "EXPOSED_ATTACK":
      return `${name(event.attackerId)}가 ${name(event.targetId)}의 허점을 포착`;
    case "DAMAGE_APPLIED":
      return `${name(event.playerId)} · ${formatHp(event.damage)} 피해 / HP ${formatHp(event.remainingHp)}`;
    case "ACTION_SKIPPED":
      return `${name(event.playerId)} 행동 취소 · ${event.reason}`;
    case "PLAYER_DIED":
      return `${name(event.playerId)} 전투 불능`;
    case "GAME_FINISHED":
      return event.result.type === "DRAW"
        ? "모든 플레이어가 쓰러졌습니다."
        : `${name(event.result.winnerPlayerId)} 최종 승리`;
  }
}

function eventTone(event: PublicBattleEvent): string {
  if (event.type === "PLAYER_DIED" || event.type === "EVADE_FAILED") {
    return "danger";
  }
  if (event.type === "GAME_FINISHED" || event.type === "EVADE_SUCCEEDED") {
    return "success";
  }
  if (
    event.type === "DAMAGE_APPLIED" ||
    event.type === "COUNTER_TRIGGERED" ||
    event.type === "EXPOSED_ATTACK" ||
    event.type === "CLASH_RESOLVED"
  ) {
    return "accent";
  }
  return "neutral";
}

function gameResultTitle(view: PlayerGameView): string {
  const result = view.result;
  if (!result) return "";
  if (result.type === "DRAW") return "무승부";
  const winner = view.players.find(
    (player) => player.playerId === result.winnerPlayerId,
  );
  return `${winner?.nickname ?? "승자"} 승리`;
}

function readStoredSession(): SessionCredentials | null {
  try {
    const value = window.localStorage.getItem(SESSION_STORAGE_KEY);
    return value ? (JSON.parse(value) as SessionCredentials) : null;
  } catch {
    return null;
  }
}

export function MultiplayerGame() {
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("connecting");
  const [restoringSession, setRestoringSession] = useState(true);
  const [view, setView] = useState<PlayerGameView | null>(null);
  const [nickname, setNickname] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [draft, setDraft] = useState<ActionDraft>({
    type: "ATTACK",
    targetPlayerId: "",
  });
  const [eventLog, setEventLog] = useState<EventLogEntry[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<SocketError | null>(null);
  const socketRef = useRef<GameClientSocket | null>(null);
  const viewRef = useRef<PlayerGameView | null>(null);
  const playbackRef = useRef<PlaybackState | null>(null);
  const playbackTimerRef = useRef<number | null>(null);
  const logIdRef = useRef(0);
  const eventEndRef = useRef<HTMLDivElement | null>(null);
  const connected = connectionStatus === "connected";

  const self = useMemo(
    () => view?.players.find((player) => player.playerId === view.selfPlayerId),
    [view],
  );
  const availableTargets = useMemo(
    () =>
      view?.players.filter(
        (player) => player.alive && player.playerId !== view.selfPlayerId,
      ) ?? [],
    [view],
  );

  useEffect(() => {
    const socket = getGameSocket();
    if (!socket) {
      setConnectionStatus("failed");
      setRestoringSession(false);
      setError({
        code: "INTERNAL_SERVER_ERROR",
        message: SOCKET_CONFIGURATION_ERROR ?? "Socket 서버 설정을 확인하세요.",
        recoverable: false,
      });
      return;
    }
    socketRef.current = socket;
    let hasConnectedOnce = socket.connected;

    const onConnect = () => {
      hasConnectedOnce = true;
      setConnectionStatus("connected");
      const stored = readStoredSession();
      if (!stored) {
        setRestoringSession(false);
        return;
      }
      socket.emit("room:reconnect", stored, (response) => {
        setRestoringSession(false);
        if (!response.ok) {
          if (!response.error.recoverable) {
            window.localStorage.removeItem(SESSION_STORAGE_KEY);
            setView(null);
          }
          setError(response.error);
          return;
        }
        setView(response.data.view);
        setNotice("게임 상태를 복원했습니다.");
      });
    };
    const onDisconnect = () => {
      setConnectionStatus(socket.active ? "reconnecting" : "disconnected");
    };
    const onConnectError = () => {
      setConnectionStatus("failed");
      setRestoringSession(false);
      setError({
        code: "INTERNAL_SERVER_ERROR",
        message: `멀티플레이 서버에 연결할 수 없습니다. 서버 주소: ${SOCKET_SERVER_URL}`,
        recoverable: true,
      });
    };
    const onReconnectAttempt = () => {
      setConnectionStatus(hasConnectedOnce ? "reconnecting" : "connecting");
    };
    const onReconnectFailed = () => setConnectionStatus("failed");

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onConnectError);
    socket.io.on("reconnect_attempt", onReconnectAttempt);
    socket.io.on("reconnect_failed", onReconnectFailed);
    socket.on("room:state-updated", (nextView) => setView(nextView));
    socket.on("room:error", (socketError) => setError(socketError));
    socket.on("game:error", (socketError) => setError(socketError));
    socket.on("room:player-disconnected", () =>
      setNotice("플레이어의 연결이 끊어졌습니다."),
    );
    socket.on("room:player-reconnected", () =>
      setNotice("플레이어가 다시 연결되었습니다."),
    );
    socket.on("game:private-speed", ({ speed, turnNumber }) => {
      setView((current) =>
        current && current.turnNumber === turnNumber
          ? { ...current, mySpeed: speed }
          : current,
      );
    });
    socket.on("game:started", () => {
      setEventLog([]);
      setNotice("게임이 시작되었습니다.");
    });
    socket.on("game:turn-resolving", () => setNotice("서버가 턴을 판정 중입니다."));
    socket.on("game:turn-resolved", (payload) => beginPlayback(payload));
    socket.on("game:next-turn", () => {
      flushPlayback(false);
      setDraft({ type: "ATTACK", targetPlayerId: "" });
      setNotice("다음 턴이 시작되었습니다.");
    });
    socket.on("game:finished", () => setNotice("게임이 종료되었습니다."));
    socket.connect();

    return () => {
      if (playbackTimerRef.current !== null) {
        window.clearTimeout(playbackTimerRef.current);
      }
      socket.removeAllListeners();
      socket.io.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  useEffect(() => {
    const firstTarget = availableTargets[0]?.playerId ?? "";
    if (
      view?.phase === "SELECTING_ACTION" &&
      !view.mySubmittedAction &&
      !availableTargets.some((target) => target.playerId === draft.targetPlayerId)
    ) {
      setDraft((current) => ({ ...current, targetPlayerId: firstTarget }));
    }
  }, [availableTargets, draft.targetPlayerId, view?.mySubmittedAction, view?.phase]);

  useEffect(() => {
    const updateCountdown = () => {
      const deadline = view?.actionDeadlineAt;
      setRemainingSeconds(
        deadline ? Math.max(0, Math.ceil((deadline - Date.now()) / 1_000)) : 0,
      );
    };
    updateCountdown();
    const timer = window.setInterval(updateCountdown, 250);
    return () => window.clearInterval(timer);
  }, [view?.actionDeadlineAt]);

  useEffect(() => {
    eventEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [eventLog]);

  function persistSession(nextCredentials: SessionCredentials): void {
    window.localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify(nextCredentials),
    );
  }

  function clearMessages(): void {
    setError(null);
    setNotice(null);
  }

  function handleCreateRoom(): void {
    const socket = socketRef.current;
    if (!socket) return;
    clearMessages();
    socket.emit("room:create", { nickname }, (response) => {
      if (!response.ok) {
        setError(response.error);
        return;
      }
      persistSession(response.data.credentials);
      setView(response.data.view);
    });
  }

  function handleJoinRoom(): void {
    const socket = socketRef.current;
    if (!socket) return;
    clearMessages();
    socket.emit(
      "room:join",
      { nickname, roomCode: roomCode.toUpperCase() },
      (response) => {
        if (!response.ok) {
          setError(response.error);
          return;
        }
        persistSession(response.data.credentials);
        setView(response.data.view);
      },
    );
  }

  function handleReady(): void {
    const socket = socketRef.current;
    if (!socket || !view || !self) return;
    clearMessages();
    socket.emit(
      "room:set-ready",
      { roomCode: view.roomCode, ready: !self.ready },
      (response) => {
        if (!response.ok) setError(response.error);
      },
    );
  }

  function handleStartGame(): void {
    const socket = socketRef.current;
    if (!socket || !view) return;
    clearMessages();
    socket.emit("room:start-game", { roomCode: view.roomCode }, (response) => {
      if (!response.ok) setError(response.error);
    });
  }

  function handleSubmitAction(): void {
    const socket = socketRef.current;
    if (!socket || !view) return;
    clearMessages();
    const candidate =
      draft.type === "ATTACK" || draft.type === "COUNTER"
        ? { type: draft.type, targetPlayerId: draft.targetPlayerId }
        : { type: draft.type };
    const parsed = SocketPlayerActionSchema.safeParse(candidate);
    if (!parsed.success) {
      setError({
        code: "INVALID_ACTION",
        message: "행동과 대상을 확인하세요.",
        recoverable: true,
      });
      return;
    }
    socket.emit(
      "game:submit-action",
      {
        roomCode: view.roomCode,
        turnNumber: view.turnNumber,
        action: parsed.data,
      },
      (response) => {
        if (!response.ok) setError(response.error);
      },
    );
  }

  function beginPlayback(payload: TurnResolvedPayload): void {
    if (playbackTimerRef.current !== null) {
      window.clearTimeout(playbackTimerRef.current);
    }
    playbackRef.current = { payload, nextIndex: 0 };
    setIsPlaying(true);
    playNextEvent();
  }

  function playNextEvent(): void {
    const playback = playbackRef.current;
    if (!playback) return;
    if (playback.nextIndex >= playback.payload.events.length) {
      finishPlayback(true);
      return;
    }
    const event = playback.payload.events[playback.nextIndex]!;
    playback.nextIndex += 1;
    logIdRef.current += 1;
    setEventLog((current) => [
      ...current,
      {
        id: logIdRef.current,
        turnNumber: playback.payload.turnNumber,
        event,
      },
    ]);
    playbackTimerRef.current = window.setTimeout(
      playNextEvent,
      playbackDelay(event),
    );
  }

  function finishPlayback(notifyServer: boolean): void {
    const playback = playbackRef.current;
    if (playbackTimerRef.current !== null) {
      window.clearTimeout(playbackTimerRef.current);
      playbackTimerRef.current = null;
    }
    playbackRef.current = null;
    setIsPlaying(false);
    const currentView = viewRef.current;
    if (notifyServer && playback && socketRef.current && currentView) {
      socketRef.current.emit(
        "game:events-finished",
        {
          roomCode: currentView.roomCode,
          turnNumber: playback.payload.turnNumber,
        },
        () => undefined,
      );
    }
  }

  function flushPlayback(notifyServer: boolean): void {
    const playback = playbackRef.current;
    if (!playback) return;
    const remaining = playback.payload.events.slice(playback.nextIndex);
    if (remaining.length > 0) {
      setEventLog((current) => [
        ...current,
        ...remaining.map((event) => {
          logIdRef.current += 1;
          return {
            id: logIdRef.current,
            turnNumber: playback.payload.turnNumber,
            event,
          };
        }),
      ]);
    }
    finishPlayback(notifyServer);
  }

  function handleLeave(): void {
    const socket = socketRef.current;
    if (socket && view) {
      socket.emit("room:leave", { roomCode: view.roomCode }, () => undefined);
    }
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
    setView(null);
    setEventLog([]);
    setError(null);
    setNotice(null);
  }

  function handleClearSession(): void {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
    setView(null);
    setEventLog([]);
    setError(null);
    setNotice("저장된 게임 정보를 초기화했습니다.");
  }

  function handleRematch(): void {
    const socket = socketRef.current;
    if (!socket || !view) return;
    socket.emit("game:request-rematch", { roomCode: view.roomCode }, (response) => {
      if (!response.ok) setError(response.error);
      else setEventLog([]);
    });
  }

  async function copyRoomCode(): Promise<void> {
    if (!view) return;
    await navigator.clipboard.writeText(view.roomCode);
    setNotice("방 코드를 복사했습니다.");
  }

  if (restoringSession) {
    return (
      <main className="onlineShell centerState">
        <div className="ambientGrid" aria-hidden="true" />
        <div className="signalLoader"><span>BT</span><p>SESSION RECOVERY</p></div>
      </main>
    );
  }

  return (
    <main className="onlineShell">
      <div className="ambientGrid" aria-hidden="true" />
      <header className="siteHeader onlineHeader">
        <div className="brandLockup">
          <span className="brandMark">BT</span>
          <span className="brandWords"><strong>BLIND TURN</strong><small>ONLINE ARENA</small></span>
        </div>
        <div className={`connectionBadge ${connectionStatus}`}>
          <span />{CONNECTION_LABEL[connectionStatus]}
        </div>
        <div className="headerActions">
          {view ? <button type="button" className="ghostButton" onClick={handleLeave}>방 나가기</button> : null}
          <Link className="ghostLink" href="/local">로컬 실험실</Link>
        </div>
      </header>

      {error ? (
        <div className="errorBanner onlineMessage" role="alert">
          <span>!</span><div><b>{error.code}</b>{error.message}</div>
          {SESSION_RESET_ERRORS.has(error.code) ? (
            <button type="button" onClick={handleClearSession}>게임 정보 초기화</button>
          ) : (
            <button type="button" onClick={() => setError(null)}>닫기</button>
          )}
        </div>
      ) : null}
      {notice ? (
        <div className="noticeBanner onlineMessage" role="status">
          <span>●</span>{notice}<button type="button" onClick={() => setNotice(null)}>닫기</button>
        </div>
      ) : null}

      {!view ? (
        <section className="onlineLanding">
          <div className="onlineHero">
            <p className="eyebrow">2–6 PLAYER / LIVE BATTLE</p>
            <h1>BLIND<br/><em>TURN</em></h1>
            <p>친구에게 여섯 자리 코드를 공유하세요. 속도와 행동은 판정 전까지 오직 자신만 볼 수 있습니다.</p>
            <div className="securityNotes">
              <span><b>01</b> 서버 권한 판정</span>
              <span><b>02</b> 비공개 행동</span>
              <span><b>03</b> 재접속 복구</span>
            </div>
          </div>
          <div className="entryTerminal">
            <div className="terminalTop"><span>NEW SESSION</span><i>{connected ? "CONNECTED" : "OFFLINE"}</i></div>
            <label className="onlineField">
              <span>CALLSIGN / 닉네임</span>
              <input value={nickname} maxLength={12} onChange={(event) => setNickname(event.target.value)} placeholder="1~12자" />
            </label>
            <button type="button" className="primaryButton fullWidth" onClick={handleCreateRoom} disabled={!connected || !nickname.trim()}>
              새 방 만들기 <span>→</span>
            </button>
            <div className="entryDivider"><span>OR JOIN WITH CODE</span></div>
            <div className="joinRow">
              <input value={roomCode} maxLength={6} onChange={(event) => setRoomCode(event.target.value.toUpperCase())} placeholder="ROOM CODE" aria-label="방 코드" />
              <button type="button" onClick={handleJoinRoom} disabled={!connected || !nickname.trim() || roomCode.length !== 6}>입장</button>
            </div>
            {USING_DEFAULT_SOCKET_URL ? <p className="configHint">환경 변수 미설정 · 기본 서버 {SOCKET_SERVER_URL} 사용 중</p> : null}
          </div>
        </section>
      ) : view.phase === "LOBBY" ? (
        <section className="lobbyPage">
          <div className="roomCodeHero">
            <div><p className="eyebrow">PRIVATE ROOM</p><h1>{view.roomCode}</h1></div>
            <button type="button" onClick={() => void copyRoomCode()}>코드 복사</button>
          </div>
          <div className="lobbyGrid">
            <section className="lobbyRoster">
              <div className="onlineSectionTitle"><div><p className="eyebrow">OPERATIVES</p><h2>플레이어 {view.players.length} / 6</h2></div><span>전원 준비 후 시작</span></div>
              <div className="rosterList">
                {view.players.map((player) => (
                  <article className="rosterPlayer" key={player.playerId}>
                    <span className="seatBadge">{String(player.seatNumber).padStart(2, "0")}</span>
                    <div><h3>{player.nickname}</h3><p>{player.playerId === view.hostPlayerId ? "ROOM HOST" : "PLAYER"}</p></div>
                    <span className={`connectionState ${player.connected ? "on" : ""}`}>{player.connected ? "ONLINE" : "AWAY"}</span>
                    <strong className={player.ready ? "ready" : ""}>{player.ready ? "READY" : "WAITING"}</strong>
                  </article>
                ))}
                {Array.from({ length: 6 - view.players.length }, (_, index) => <div className="emptySeat" key={index}>EMPTY SLOT</div>)}
              </div>
            </section>
            <aside className="lobbyCommand">
              <p className="eyebrow">MISSION CONTROL</p>
              <h2>{self?.ready ? "준비 완료" : "전투 준비"}</h2>
              <p>게임 시작 후에는 각자의 속도와 행동이 비공개로 처리됩니다.</p>
              <button type="button" className={self?.ready ? "readyButton active" : "readyButton"} onClick={handleReady}>
                {self?.ready ? "준비 취소" : "준비 완료"}
              </button>
              {view.selfPlayerId === view.hostPlayerId ? (
                <button type="button" className="primaryButton fullWidth" onClick={handleStartGame} disabled={view.players.length < 2 || view.players.some((player) => !player.connected || !player.ready)}>
                  게임 시작 <span>▶</span>
                </button>
              ) : <div className="hostWaiting">방장이 게임을 시작할 때까지 대기 중</div>}
            </aside>
          </div>
        </section>
      ) : (
        <section className="onlineBattlePage">
          <div className="onlineBattleTop">
            <div><p className="eyebrow">LIVE MATCH / {view.roomCode}</p><h1>TURN {view.turnNumber}</h1></div>
            <div className="privateIntel"><span>MY SPEED</span><strong>{view.mySpeed ?? "—"}</strong><small>다른 플레이어에게 비공개</small></div>
            <div className={`turnTimer ${remainingSeconds <= 5 ? "urgent" : ""}`}><span>TIME LEFT</span><strong>00:{String(remainingSeconds).padStart(2, "0")}</strong><div><i style={{ width: `${Math.min(100, (remainingSeconds / 30) * 100)}%` }} /></div></div>
          </div>

          {view.phase === "FINISHED" && view.result ? (
            <div className="onlineResult">
              <div><p>FINAL RESULT · {view.totalTurns} TURNS</p><h2>{gameResultTitle(view)}</h2></div>
              {view.selfPlayerId === view.hostPlayerId ? <button type="button" className="lightButton" onClick={handleRematch}>로비로 돌아가기</button> : <span>방장의 재경기 요청을 기다리는 중</span>}
            </div>
          ) : null}
          {view.phase === "FINISHED" && view.fatalError ? (
            <div className="onlineResult errorResult">
              <div><p>{view.fatalError.code}</p><h2>게임이 안전하게 오류 종료되었습니다.</h2></div>
              {view.selfPlayerId === view.hostPlayerId ? <button type="button" className="lightButton" onClick={handleRematch}>재경기 준비</button> : <span>방장이 재경기를 시작할 수 있습니다.</span>}
            </div>
          ) : null}

          <div className="onlineBattleGrid">
            <div className="onlineArena">
              <div className="onlinePlayers">
                {view.players.map((player) => (
                  <article className={`onlinePlayerCard ${player.alive ? "" : "dead"} ${player.playerId === view.selfPlayerId ? "self" : ""}`} key={player.playerId}>
                    <div className="onlinePlayerHead"><span className="seatBadge">{String(player.seatNumber).padStart(2, "0")}</span><div><h3>{player.nickname}</h3><small>{player.playerId === view.selfPlayerId ? "YOU" : player.playerId === view.hostPlayerId ? "HOST" : "PLAYER"}</small></div><b className={player.connected ? "online" : "offline"}>{player.connected ? "●" : "○"}</b></div>
                    <div className="onlineHp"><div><span>HP</span><strong>{formatHp(player.hp)}<small>/30</small></strong></div><div className="hpTrack"><span style={{ width: `${(player.hp / MAX_HP) * 100}%` }} /></div></div>
                    <div className="submissionFlag"><span>{player.alive ? "ACTION" : "STATUS"}</span><strong className={player.submitted ? "done" : ""}>{!player.alive ? "DOWN" : player.submitted ? "LOCKED" : "SELECTING"}</strong></div>
                  </article>
                ))}
              </div>

              {view.phase === "SELECTING_ACTION" && self?.alive ? (
                <section className="onlineActionDock">
                  <div className="dockTitle"><div><p className="eyebrow">PRIVATE INPUT</p><h2>{view.mySubmittedAction ? "행동 잠금 완료" : "행동을 선택하세요"}</h2></div><span>{view.mySubmittedAction ? ACTION_LABEL[view.mySubmittedAction.type] : "다른 플레이어에게 숨겨집니다"}</span></div>
                  {!view.mySubmittedAction ? (
                    <>
                      <div className="onlineActionButtons">
                        {ACTIONS.map((action) => (
                          <button type="button" key={action.type} className={draft.type === action.type ? "selected" : ""} disabled={action.type === "COUNTER" && !view.counterAvailable} onClick={() => setDraft((current) => ({ ...current, type: action.type }))}>
                            <small>{action.code}</small>{action.label}
                          </button>
                        ))}
                      </div>
                      <div className="actionConfirmRow">
                        {draft.type === "ATTACK" || draft.type === "COUNTER" ? (
                          <label><span>대상</span><select value={draft.targetPlayerId} onChange={(event) => setDraft((current) => ({ ...current, targetPlayerId: event.target.value }))}>{availableTargets.map((target) => <option key={target.playerId} value={target.playerId}>SEAT {target.seatNumber} · {target.nickname}</option>)}</select></label>
                        ) : <p>{draft.type === "DEFEND" ? "활성화 후 받는 피해를 절반으로 줄입니다." : "활성화 후 공격받을 때마다 회피 판정을 합니다."}</p>}
                        <button type="button" className="dangerButton lockActionButton" onClick={handleSubmitAction}>선택 확정 · 변경 불가</button>
                      </div>
                    </>
                  ) : <div className="lockedAction"><span>✓</span><div><strong>{ACTION_LABEL[view.mySubmittedAction.type]}</strong><p>서버가 모든 플레이어의 선택을 기다리고 있습니다.</p></div></div>}
                </section>
              ) : view.phase === "RESOLVING" ? <div className="resolvingBanner"><span className="liveDot"/><div><strong>전투 판정 재생 중</strong><p>모든 플레이어가 같은 이벤트 순서를 보고 있습니다.</p></div></div> : null}
            </div>

            <aside className="eventPanel onlineEventPanel">
              <div className="eventHeader"><div><p className="eyebrow">SYNCHRONIZED FEED</p><h2>전투 이벤트</h2></div>{isPlaying ? <button type="button" className="skipButton" onClick={() => flushPlayback(true)}>연출 건너뛰기</button> : <span className="feedStatus">READY</span>}</div>
              <div className="eventList" aria-live="polite">
                {eventLog.length === 0 ? <div className="emptyLog"><span>∅</span><h3>판정 대기 중</h3><p>모든 행동이 제출되면 서버가 결과를 계산합니다.</p></div> : eventLog.map((entry, index) => {
                  const newTurn = index === 0 || eventLog[index - 1]?.turnNumber !== entry.turnNumber;
                  return <div key={entry.id}>{newTurn ? <div className="turnDivider"><span>TURN {entry.turnNumber}</span></div> : null}<div className={`eventItem ${eventTone(entry.event)}`}><span className="eventNumber">{String(index + 1).padStart(2, "0")}</span><div><small>{entry.event.type.replaceAll("_", " ")}</small><p>{eventDescription(entry.event, view)}</p></div></div></div>;
                })}
                <div ref={eventEndRef}/>
              </div>
            </aside>
          </div>
        </section>
      )}
    </main>
  );
}
