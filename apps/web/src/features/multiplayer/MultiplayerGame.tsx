"use client";

import {
  CHARACTER_CATALOG,
  CHARACTER_CLASS_IDS,
  MAX_CARDS_PER_ROUND,
  formatHp,
  type CharacterClassId,
  type PrivateCardView,
  type QueuedCardAdditionalSelection,
  type PlayerGameView,
  type SessionCredentials,
  type SocketError,
} from "@blind-turn/shared";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { CombatStage } from "./CombatStage";
import {
  buildCombatSequences,
  createCombatDisplayState,
  describeCombatSequence,
} from "./combat-sequence";
import {
  getGameSocket,
  SOCKET_CONFIGURATION_ERROR,
  SOCKET_SERVER_URL,
  USING_DEFAULT_SOCKET_URL,
  type GameClientSocket,
} from "./socket-client";
import { useCombatPlayback } from "./use-combat-playback";

type ConnectionStatus = "connecting" | "connected" | "reconnecting" | "disconnected" | "failed";

const CONNECTION_LABEL: Record<ConnectionStatus, string> = {
  connecting: "연결 중",
  connected: "연결됨",
  reconnecting: "재연결 중",
  disconnected: "연결 끊김",
  failed: "연결 실패",
};

const SESSION_STORAGE_KEY = "blind-turn:online-session";
const SESSION_RESET_ERRORS = new Set<SocketError["code"]>([
  "ROOM_SESSION_EXPIRED",
  "INVALID_RECONNECT_TOKEN",
  "PLAYER_NOT_FOUND",
]);

function readStoredSession(): SessionCredentials | null {
  try {
    const value = window.localStorage.getItem(SESSION_STORAGE_KEY);
    return value ? JSON.parse(value) as SessionCredentials : null;
  } catch {
    return null;
  }
}

function gameResultTitle(view: PlayerGameView): string {
  const result = view.result;
  if (!result) return "";
  if (result.type === "DRAW") return "무승부";
  return `${view.players.find((player) => player.playerId === result.winnerPlayerId)?.nickname ?? "승자"} 승리`;
}

function CardTile(props: {
  card: PrivateCardView;
  disabled?: boolean;
  selected?: boolean;
  footer?: string;
  onClick?: () => void;
}) {
  const className = `v2Card card-${props.card.definition.category.toLowerCase()} ${props.selected ? "selected" : ""}`;
  const content = (
    <>
      <span>{props.card.definition.classId}</span>
      <strong>{props.card.definition.name}</strong>
      <p>{props.card.definition.description}</p>
      <small>{props.footer ?? props.card.definition.category}</small>
    </>
  );
  return props.onClick ? (
    <button type="button" className={className} disabled={props.disabled} onClick={props.onClick}>{content}</button>
  ) : <article className={className}>{content}</article>;
}

function Countdown({ deadlineAt, maxSeconds }: { deadlineAt: number | null; maxSeconds: number }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const update = () => setSeconds(deadlineAt ? Math.max(0, Math.ceil((deadlineAt - Date.now()) / 1_000)) : 0);
    update();
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, [deadlineAt]);
  return (
    <div className={`roundTimer ${seconds <= 10 ? "warning" : ""}`}>
      <span>남은 시간</span><strong>{deadlineAt ? `${seconds}초` : "--"}</strong>
      <div><i style={{ width: `${Math.min(100, seconds / maxSeconds * 100)}%` }} /></div>
    </div>
  );
}

export function MultiplayerGame() {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("connecting");
  const [restoringSession, setRestoringSession] = useState(true);
  const [view, setViewState] = useState<PlayerGameView | null>(null);
  const [nickname, setNickname] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [error, setError] = useState<SocketError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [initialSelection, setInitialSelection] = useState<string[]>([]);
  const [pendingCard, setPendingCard] = useState<PrivateCardView | null>(null);
  const [pendingTarget, setPendingTarget] = useState("");
  const [additionalIds, setAdditionalIds] = useState<string[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [showFullLog, setShowFullLog] = useState(false);
  const socketRef = useRef<GameClientSocket | null>(null);
  const viewRef = useRef<PlayerGameView | null>(null);

  const setView = (next: PlayerGameView | null) => {
    viewRef.current = next;
    setViewState(next);
  };

  const playback = useCombatPlayback({
    onRoundComplete: (roundNumber) => {
      const current = viewRef.current;
      if (!current || !socketRef.current) return;
      socketRef.current.emit(
        "game:events-finished",
        { roomCode: current.roomCode, roundNumber },
        () => undefined,
      );
    },
  });

  const connected = connectionStatus === "connected";
  const self = view?.players.find((player) => player.playerId === view.selfPlayerId) ?? null;
  const targets = view?.players.filter(
    (player) => player.alive && player.playerId !== view.selfPlayerId,
  ) ?? [];
  const queuedIds = new Set(view?.myQueuedCards.map((queued) => queued.cardInstanceId) ?? []);
  const playerNames = useMemo(
    () => Object.fromEntries((view?.players ?? []).map((player) => [player.playerId, player.nickname])),
    [view?.players],
  );
  const combatRecords = playback.completedSequences.filter(
    (record) => record.sequence.type === "STEP",
  );
  const visibleRecords = showFullLog ? combatRecords : combatRecords.slice(-8);

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
    let connectedOnce = socket.connected;
    const onConnect = () => {
      connectedOnce = true;
      setConnectionStatus("connected");
      const stored = readStoredSession();
      if (!stored) return setRestoringSession(false);
      socket.emit("room:reconnect", stored, (response) => {
        setRestoringSession(false);
        if (!response.ok) {
          if (!response.error.recoverable) window.localStorage.removeItem(SESSION_STORAGE_KEY);
          setError(response.error);
          return;
        }
        setView(response.data.view);
        playback.syncServerState(createCombatDisplayState(response.data.view.players));
        const pending = response.data.view.pendingRoundPlayback;
        if (pending) {
          playback.enqueueBatch({
            id: `round-${pending.roundNumber}`,
            roundNumber: pending.roundNumber,
            sequences: buildCombatSequences(pending.events),
            initialState: createCombatDisplayState(response.data.view.players.map((player) => {
              const final = pending.publicState.players.find((candidate) => candidate.playerId === player.playerId);
              const damage = pending.events.reduce(
                (sum, event) => event.type === "DAMAGE_APPLIED" && event.playerId === player.playerId
                  ? sum + event.damage
                  : sum,
                0,
              );
              const healing = pending.events.reduce(
                (sum, event) => event.type === "HEAL_APPLIED" && event.playerId === player.playerId
                  ? sum + event.amount
                  : sum,
                0,
              );
              const diedThisRound = pending.events.some(
                (event) => event.type === "PLAYER_DIED" && event.playerId === player.playerId,
              );
              return {
                ...player,
                hp: Math.max(0, (final?.hp ?? player.hp) + damage - healing),
                alive: final?.alive || diedThisRound || false,
              };
            })),
            serverState: createCombatDisplayState(pending.publicState.players),
          });
        }
        setNotice("게임 상태를 복원했습니다.");
      });
    };
    const onDisconnect = () => setConnectionStatus(socket.active ? "reconnecting" : "disconnected");
    const onConnectError = () => {
      setConnectionStatus("failed");
      setRestoringSession(false);
      setError({
        code: "INTERNAL_SERVER_ERROR",
        message: `멀티플레이 서버에 연결할 수 없습니다. ${SOCKET_SERVER_URL}`,
        recoverable: true,
      });
    };
    const onSocketError = (nextError: SocketError) => setError(nextError);

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onConnectError);
    socket.io.on("reconnect_attempt", () => setConnectionStatus(connectedOnce ? "reconnecting" : "connecting"));
    socket.io.on("reconnect_failed", () => setConnectionStatus("failed"));
    socket.on("room:error", onSocketError);
    socket.on("game:error", onSocketError);
    socket.on("chat:error", onSocketError);
    socket.on("room:state-updated", (nextView) => {
      setView(nextView);
      playback.syncServerState(createCombatDisplayState(nextView.players));
    });
    socket.on("game:started", () => {
      playback.reset(createCombatDisplayState(viewRef.current?.players ?? []));
      setNotice("게임이 시작되었습니다.");
    });
    socket.on("game:round-resolving", ({ roundNumber }) =>
      setNotice(`${roundNumber}라운드를 판정하고 있습니다.`));
    socket.on("game:round-resolved", (payload) => {
      playback.enqueueBatch({
        id: `round-${payload.roundNumber}`,
        roundNumber: payload.roundNumber,
        sequences: buildCombatSequences(payload.events),
        initialState: createCombatDisplayState(viewRef.current?.players ?? payload.publicState.players),
        serverState: createCombatDisplayState(payload.publicState.players),
      });
    });
    socket.on("game:next-round", ({ roundNumber }) => {
      setPendingCard(null);
      setAdditionalIds([]);
      setNotice(`${roundNumber}라운드가 시작되었습니다.`);
    });
    socket.on("game:reward-options", () => setNotice("카드 보상을 선택하세요."));
    socket.on("game:deck-removal-required", () => setNotice("새 카드를 넣기 위해 기존 카드 1장을 제거하세요."));
    socket.on("game:finished", () => setNotice("게임이 종료되었습니다."));
    socket.on("room:player-disconnected", () => setNotice("플레이어의 연결이 끊어졌습니다."));
    socket.on("room:player-reconnected", () => setNotice("플레이어가 재접속했습니다."));
    socket.on("chat:message", (message) => {
      const current = viewRef.current;
      if (!current || current.roomCode !== message.roomCode) return;
      if (current.chatHistory.some((entry) => entry.id === message.id)) return;
      setView({ ...current, chatHistory: [...current.chatHistory, message].slice(-50) });
    });
    socket.connect();
    if (socket.connected) onConnect();

    return () => {
      socket.removeAllListeners();
      socket.io.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  function persistSession(credentials: SessionCredentials) {
    window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(credentials));
  }

  function createRoom() {
    const socket = socketRef.current;
    if (!socket) return;
    setError(null);
    setNotice(null);
    socket.emit("room:create", { nickname }, (response) => {
      if (!response.ok) return setError(response.error);
      persistSession(response.data.credentials);
      setView(response.data.view);
      playback.syncServerState(createCombatDisplayState(response.data.view.players));
    });
  }

  function joinRoom() {
    const socket = socketRef.current;
    if (!socket) return;
    setError(null);
    setNotice(null);
    socket.emit("room:join", { nickname, roomCode: roomCode.toUpperCase() }, (response) => {
      if (!response.ok) return setError(response.error);
      persistSession(response.data.credentials);
      setView(response.data.view);
      playback.syncServerState(createCombatDisplayState(response.data.view.players));
    });
  }

  function selectCharacter(characterId: CharacterClassId) {
    if (!view || !socketRef.current) return;
    socketRef.current.emit("room:select-character", { roomCode: view.roomCode, characterId }, (response) => {
      if (!response.ok) setError(response.error);
    });
  }

  function setReady() {
    if (!view || !self || !socketRef.current) return;
    socketRef.current.emit("room:set-ready", { roomCode: view.roomCode, ready: !self.ready }, (response) => {
      if (!response.ok) setError(response.error);
    });
  }

  function startGame() {
    if (!view || !socketRef.current) return;
    socketRef.current.emit("room:start-game", { roomCode: view.roomCode }, (response) => {
      if (!response.ok) setError(response.error);
    });
  }

  function submitInitialHand() {
    if (!view || !socketRef.current || initialSelection.length !== 3) return;
    socketRef.current.emit(
      "game:select-initial-hand",
      { roomCode: view.roomCode, selectedInstanceIds: initialSelection },
      (response) => {
        if (!response.ok) setError(response.error);
        else setInitialSelection([]);
      },
    );
  }

  function emitQueue(card: PrivateCardView, targetPlayerId?: string, additionalSelection?: QueuedCardAdditionalSelection) {
    if (!view || !socketRef.current) return;
    socketRef.current.emit("game:queue-card", {
      roomCode: view.roomCode,
      roundNumber: view.roundNumber,
      cardInstanceId: card.instanceId,
      ...(targetPlayerId ? { targetPlayerId } : {}),
      additionalSelection: additionalSelection ?? null,
    }, (response) => {
      if (!response.ok) setError(response.error);
      else {
        setPendingCard(null);
        setPendingTarget("");
        setAdditionalIds([]);
      }
    });
  }

  function chooseHandCard(card: PrivateCardView) {
    const needsAdditional = ["TACTICIAN_RECYCLE", "TACTICIAN_SWAP", "TACTICIAN_SIFT"].includes(card.cardId);
    if (card.definition.targetType === "ENEMY" || needsAdditional) {
      setPendingCard(card);
      setPendingTarget("");
      setAdditionalIds([]);
      return;
    }
    emitQueue(card);
  }

  function confirmPendingCard() {
    if (!pendingCard) return;
    let additional: QueuedCardAdditionalSelection = null;
    if (pendingCard.cardId === "TACTICIAN_RECYCLE") {
      if (additionalIds.length !== 1) return;
      additional = { discardCardInstanceId: additionalIds[0]! };
    }
    if (pendingCard.cardId === "TACTICIAN_SWAP") {
      additional = { handCardInstanceIds: additionalIds };
    }
    if (pendingCard.cardId === "TACTICIAN_SIFT") {
      if (additionalIds.length !== 1) return;
      additional = { returnCardInstanceId: additionalIds[0]! };
    }
    emitQueue(pendingCard, pendingTarget || undefined, additional);
  }

  function removeQueued(instanceId: string) {
    if (!view || !socketRef.current) return;
    socketRef.current.emit("game:remove-queued-card", {
      roomCode: view.roomCode,
      roundNumber: view.roundNumber,
      cardInstanceId: instanceId,
    }, (response) => { if (!response.ok) setError(response.error); });
  }

  function moveQueued(index: number, direction: -1 | 1) {
    if (!view || !socketRef.current) return;
    const next = [...view.myQueuedCards];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    socketRef.current.emit("game:reorder-queued-cards", {
      roomCode: view.roomCode,
      roundNumber: view.roundNumber,
      orderedInstanceIds: next.map((queued) => queued.cardInstanceId),
    }, (response) => { if (!response.ok) setError(response.error); });
  }

  function confirmRound() {
    if (!view || !socketRef.current) return;
    socketRef.current.emit("game:confirm-round", {
      roomCode: view.roomCode,
      roundNumber: view.roundNumber,
    }, (response) => { if (!response.ok) setError(response.error); });
  }

  function selectReward(cardId: string) {
    if (!view || !socketRef.current) return;
    socketRef.current.emit("game:select-reward", { roomCode: view.roomCode, cardId }, (response) => {
      if (!response.ok) setError(response.error);
    });
  }

  function selectRemoval(cardInstanceId: string) {
    if (!view || !socketRef.current) return;
    socketRef.current.emit("game:select-deck-removal", { roomCode: view.roomCode, cardInstanceId }, (response) => {
      if (!response.ok) setError(response.error);
    });
  }

  function sendChat(event: FormEvent) {
    event.preventDefault();
    if (!view || !socketRef.current || !chatInput.trim()) return;
    socketRef.current.emit("chat:send", { roomCode: view.roomCode, message: chatInput }, (response) => {
      if (!response.ok) setError(response.error);
      else setChatInput("");
    });
  }

  function leaveRoom() {
    if (view && socketRef.current) {
      socketRef.current.emit("room:leave", { roomCode: view.roomCode }, () => undefined);
    }
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
    setView(null);
    playback.reset();
    setError(null);
    setNotice(null);
  }

  function requestRematch() {
    if (!view || !socketRef.current) return;
    socketRef.current.emit("game:request-rematch", { roomCode: view.roomCode }, (response) => {
      if (!response.ok) setError(response.error);
      else playback.reset();
    });
  }

  if (restoringSession) {
    return <main className="onlineShell centerState"><div className="signalLoader"><span>BT</span><p>SESSION RECOVERY</p></div></main>;
  }

  const chatPanel = view ? (
    <aside className="v2SidePanel">
      <div className="panelTitle"><p className="eyebrow">ROOM CHAT</p><h2>작전 통신</h2></div>
      <div className="chatHistory" aria-live="polite">
        {view.chatHistory.map((message) => message.kind === "SYSTEM" ? (
          <p className="systemMessage" key={message.id}>{message.message}</p>
        ) : (
          <div className={message.playerId === view.selfPlayerId ? "chatMessage mine" : "chatMessage"} key={message.id}>
            <strong>{message.nickname}</strong><p>{message.message}</p>
          </div>
        ))}
      </div>
      <form className="chatForm" onSubmit={sendChat}>
        <input
          value={chatInput}
          onChange={(event) => setChatInput(event.target.value)}
          maxLength={100}
          placeholder={self && !self.alive ? "사망 후 채팅 불가" : "메시지 입력"}
          disabled={Boolean(self && !self.alive)}
        />
        <button type="submit" disabled={!chatInput.trim() || Boolean(self && !self.alive)}>전송</button>
      </form>
    </aside>
  ) : null;

  return (
    <main className="onlineShell">
      <div className="ambientGrid" aria-hidden="true" />
      <header className="siteHeader onlineHeader">
        <div className="brandLockup"><span className="brandMark">BT</span><span className="brandWords"><strong>BLIND TURN</strong><small>V2 CARD TACTICS</small></span></div>
        <div className={`connectionBadge ${connectionStatus}`}><span />{CONNECTION_LABEL[connectionStatus]}</div>
        <div className="headerActions">{view ? <button className="ghostButton" onClick={leaveRoom}>방 나가기</button> : null}<Link className="ghostLink" href="/local">규칙 실험실</Link></div>
      </header>

      {error ? (
        <div className="errorBanner" role="alert"><b>{error.code}</b><span>{error.message}</span><button onClick={() => {
          if (SESSION_RESET_ERRORS.has(error.code)) {
            window.localStorage.removeItem(SESSION_STORAGE_KEY);
            setView(null);
          }
          setError(null);
        }}>닫기</button></div>
      ) : null}
      {notice ? <div className="noticeBanner">{notice}<button onClick={() => setNotice(null)}>닫기</button></div> : null}

      {!view ? (
        <section className="onlineLanding">
          <div className="onlineHero">
            <p className="eyebrow">2–6 PLAYER / SIMULTANEOUS STEPS</p>
            <h1>BLIND<br /><em>TURN</em></h1>
            <p>캐릭터를 선택하고 손패에서 최대 3장을 예약하세요. 모두가 확정할 때까지 카드와 순서는 공개되지 않습니다.</p>
            <div className="securityNotes"><span>서버 권한 판정</span><span>비공개 카드 큐</span><span>재접속 복구</span></div>
          </div>
          <div className="entryTerminal">
            <div className="terminalTop"><span>NEW SESSION</span><i>{connected ? "CONNECTED" : "OFFLINE"}</i></div>
            <label className="onlineField"><span>닉네임</span><input value={nickname} maxLength={12} onChange={(event) => setNickname(event.target.value)} placeholder="1~12자" /></label>
            <button className="primaryButton fullWidth" onClick={createRoom} disabled={!connected || !nickname.trim()}>새 방 만들기</button>
            <div className="entryDivider">OR JOIN</div>
            <div className="joinRow"><input value={roomCode} maxLength={6} onChange={(event) => setRoomCode(event.target.value.toUpperCase())} placeholder="ROOM CODE" /><button onClick={joinRoom} disabled={!connected || !nickname.trim() || roomCode.length !== 6}>입장</button></div>
            {USING_DEFAULT_SOCKET_URL ? <p className="configHint">기본 서버 {SOCKET_SERVER_URL}</p> : null}
          </div>
        </section>
      ) : view.phase === "LOBBY" ? (
        <section className="v2RoomPage">
          <div className="roomHero"><div><p className="eyebrow">PRIVATE ROOM</p><h1>{view.roomCode}</h1></div><button onClick={() => void navigator.clipboard.writeText(view.roomCode)}>코드 복사</button></div>
          <div className="v2RoomGrid">
            <div>
              <section className="characterSelect">
                <div className="panelTitle"><p className="eyebrow">CHOOSE CHARACTER</p><h2>캐릭터 선택</h2></div>
                <div className="characterGrid">
                  {CHARACTER_CLASS_IDS.map((id) => {
                    const character = CHARACTER_CATALOG[id];
                    return <button key={id} className={view.myCharacterId === id ? "characterCard selected" : "characterCard"} onClick={() => selectCharacter(id)} disabled={Boolean(self?.ready)}>
                      <span>{id}</span><strong>{character.name}</strong><b>HP {formatHp(character.maxHp)}</b><p>{character.passive}</p><small>{character.playStyle}</small>
                    </button>;
                  })}
                </div>
              </section>
              <section className="rosterPanel">
                <div className="panelTitle"><p className="eyebrow">PLAYERS</p><h2>{view.players.length} / 6</h2></div>
                <div className="rosterList">{view.players.map((player) => (
                  <article className="rosterPlayer" key={player.playerId}><span className="seatBadge">{player.seatNumber}</span><div><h3>{player.nickname}</h3><p>{player.characterId ? CHARACTER_CATALOG[player.characterId].name : "캐릭터 미선택"}</p></div><b>{player.connected ? "ONLINE" : "AWAY"}</b><strong className={player.ready ? "ready" : ""}>{player.ready ? "READY" : "WAIT"}</strong></article>
                ))}</div>
                <div className="lobbyActions"><button className="readyButton" onClick={setReady} disabled={!view.myCharacterId}>{self?.ready ? "준비 취소" : "준비 완료"}</button>{view.selfPlayerId === view.hostPlayerId ? <button className="primaryButton" onClick={startGame} disabled={view.players.length < 2 || view.players.some((player) => !player.connected || !player.ready)}>게임 시작</button> : <span>방장이 게임을 시작합니다.</span>}</div>
              </section>
            </div>
            {chatPanel}
          </div>
        </section>
      ) : (
        <section className="v2BattlePage">
          <div className="battleTop"><div><p className="eyebrow">LIVE MATCH / {view.roomCode}</p><h1>ROUND {playback.currentRoundNumber ?? view.roundNumber}</h1></div><div className="deckStats"><span>HAND <b>{view.myHand.length}/5</b></span><span>DRAW <b>{view.drawPileCount}</b></span><span>DISCARD <b>{view.discardPileCount}</b></span></div><Countdown deadlineAt={view.actionDeadlineAt ?? view.rewardDeadlineAt} maxSeconds={view.actionDeadlineAt ? 60 : 30} /></div>

          {view.phase === "ROUND_STARTING" && view.initialHandOptions.length > 0 ? (
            <section className="modalPanel initialHandPanel"><p className="eyebrow">TACTICIAN PASSIVE</p><h2>시작 손패 3장을 선택하세요</h2><div className="v2CardGrid">{view.initialHandOptions.map((card) => <CardTile key={card.instanceId} card={card} selected={initialSelection.includes(card.instanceId)} onClick={() => setInitialSelection((current) => current.includes(card.instanceId) ? current.filter((id) => id !== card.instanceId) : current.length < 3 ? [...current, card.instanceId] : current)} />)}</div><button className="primaryButton" disabled={initialSelection.length !== 3} onClick={submitInitialHand}>3장 확정</button></section>
          ) : null}

          {view.phase === "SELECTING_REWARD" && view.rewardOptions.length > 0 ? (
            <section className="modalPanel rewardPanel"><p className="eyebrow">ROUND REWARD</p><h2>새 카드 1장을 선택하세요</h2><div className="v2CardGrid">{view.rewardOptions.map((definition) => <button className={`v2Card card-${definition.category.toLowerCase()}`} key={definition.id} onClick={() => selectReward(definition.id)}><span>{definition.classId}</span><strong>{definition.name}</strong><p>{definition.description}</p><small>덱에 추가</small></button>)}</div></section>
          ) : null}

          {view.phase === "SELECTING_DECK_REMOVAL" && view.deckRemovalCandidates.length > 0 ? (
            <section className="modalPanel removalPanel"><p className="eyebrow">DECK LIMIT 10</p><h2>기존 카드 1장을 제거하세요</h2><p>새 보상 카드는 제거할 수 없으며 공격 카드가 최소 1장 남아야 합니다.</p><div className="v2CardGrid compact">{view.deckRemovalCandidates.map((card) => <CardTile key={card.instanceId} card={card} footer="제거" onClick={() => selectRemoval(card.instanceId)} />)}</div></section>
          ) : null}

          {view.phase === "FINISHED" && !playback.isPlaying ? (
            <section className="resultPanel"><p>FINAL RESULT · {view.totalRounds} ROUNDS</p><h2>{view.fatalError ? "게임 오류 종료" : gameResultTitle(view)}</h2>{view.selfPlayerId === view.hostPlayerId ? <button onClick={requestRematch}>재경기 준비</button> : <span>방장의 재경기 요청을 기다립니다.</span>}</section>
          ) : null}

          <div className="v2BattleGrid">
            <div className="v2Arena">
              <CombatStage
                players={view.players}
                selfPlayerId={view.selfPlayerId}
                hostPlayerId={view.hostPlayerId}
                displayState={playback.displayState}
                sequence={playback.currentSequence}
                stage={playback.currentStage}
                statuses={playback.statuses}
                isPlaying={playback.isPlaying}
                isPaused={playback.isPaused}
                speed={playback.speed}
                onTogglePause={playback.togglePause}
                onSpeedChange={playback.setSpeed}
                onSkip={playback.skip}
              />

              {view.phase === "SELECTING_CARDS" && self?.alive && !playback.isPlaying ? (
                <section className="cardCommandPanel">
                  <div className="panelTitle"><div><p className="eyebrow">PRIVATE QUEUE</p><h2>{view.myConfirmed ? "라운드 확정 완료" : "최대 3장을 순서대로 예약"}</h2></div><span>{view.myQueuedCards.length}/{MAX_CARDS_PER_ROUND}</span></div>
                  <div className="queueSlots">
                    {Array.from({ length: 3 }, (_, index) => {
                      const queued = view.myQueuedCards[index];
                      const card = queued ? view.myHand.find((entry) => entry.instanceId === queued.cardInstanceId) : null;
                      return <div className={queued ? "queueSlot filled" : "queueSlot"} key={index}><b>{index + 1}</b>{card && queued ? <><strong>{card.definition.name}</strong><small>{queued.targetPlayerId ? `→ ${playerNames[queued.targetPlayerId]}` : "대상 없음"}</small>{!view.myConfirmed ? <div><button onClick={() => moveQueued(index, -1)} disabled={index === 0}>←</button><button onClick={() => moveQueued(index, 1)} disabled={index === view.myQueuedCards.length - 1}>→</button><button onClick={() => removeQueued(queued.cardInstanceId)}>제거</button></div> : null}</> : <span>EMPTY</span>}</div>;
                    })}
                  </div>
                  {!view.myConfirmed ? <div className="v2CardGrid handGrid">{view.myHand.map((card) => <CardTile key={card.instanceId} card={card} disabled={queuedIds.has(card.instanceId) || view.myQueuedCards.length >= 3} selected={queuedIds.has(card.instanceId)} footer={queuedIds.has(card.instanceId) ? "예약됨" : "큐에 추가"} onClick={() => chooseHandCard(card)} />)}</div> : <div className="lockedRound">✓ 다른 플레이어의 확정을 기다리고 있습니다.</div>}
                  {!view.myConfirmed ? <button className="confirmRoundButton" onClick={confirmRound}>이 순서로 라운드 확정 · 변경 불가</button> : null}
                </section>
              ) : null}

              {pendingCard ? (
                <div className="choiceOverlay" role="dialog" aria-modal="true">
                  <div className="choiceDialog"><p className="eyebrow">CARD SETUP</p><h2>{pendingCard.definition.name}</h2>
                    {pendingCard.definition.targetType === "ENEMY" ? <div className="choiceList"><h3>대상 선택</h3>{targets.map((target) => <button className={pendingTarget === target.playerId ? "selected" : ""} key={target.playerId} onClick={() => setPendingTarget(target.playerId)}>{target.nickname}<small>HP {formatHp(target.hp)}</small></button>)}</div> : null}
                    {pendingCard.cardId === "TACTICIAN_RECYCLE" ? <div className="choiceList"><h3>회수할 버린 카드 1장</h3>{view.myDiscardPile.map((card) => <button className={additionalIds.includes(card.instanceId) ? "selected" : ""} key={card.instanceId} onClick={() => setAdditionalIds([card.instanceId])}>{card.definition.name}</button>)}</div> : null}
                    {pendingCard.cardId === "TACTICIAN_SWAP" ? <div className="choiceList"><h3>버리고 다시 뽑을 손패 최대 2장</h3>{view.myHand.filter((card) => card.instanceId !== pendingCard.instanceId && !queuedIds.has(card.instanceId)).map((card) => <button className={additionalIds.includes(card.instanceId) ? "selected" : ""} key={card.instanceId} onClick={() => setAdditionalIds((current) => current.includes(card.instanceId) ? current.filter((id) => id !== card.instanceId) : current.length < 2 ? [...current, card.instanceId] : current)}>{card.definition.name}</button>)}</div> : null}
                    {pendingCard.cardId === "TACTICIAN_SIFT" ? <div className="choiceList"><h3>덱 아래로 돌려보낼 손패 1장</h3>{view.myHand.filter((card) => card.instanceId !== pendingCard.instanceId && !queuedIds.has(card.instanceId)).map((card) => <button className={additionalIds.includes(card.instanceId) ? "selected" : ""} key={card.instanceId} onClick={() => setAdditionalIds([card.instanceId])}>{card.definition.name}</button>)}</div> : null}
                    <div className="dialogActions"><button onClick={() => setPendingCard(null)}>취소</button><button className="primaryButton" onClick={confirmPendingCard} disabled={(pendingCard.definition.targetType === "ENEMY" && !pendingTarget) || (["TACTICIAN_RECYCLE", "TACTICIAN_SIFT"].includes(pendingCard.cardId) && additionalIds.length !== 1)}>예약</button></div>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="battleSidebar">
              {chatPanel}
              <aside className="v2SidePanel combatLogPanel"><div className="panelTitle"><p className="eyebrow">COMBAT LOG</p><h2>완료 기록</h2></div><div className="combatLog">{visibleRecords.length === 0 ? <p className="emptyText">아직 완료된 판정이 없습니다.</p> : visibleRecords.map((record) => <div key={`${record.roundNumber}-${record.sequence.id}`}><small>R{record.roundNumber} · STEP {(record.sequence.stepIndex ?? 0) + 1}</small><p>{describeCombatSequence(record.sequence, playerNames)}</p></div>)}</div>{combatRecords.length > 8 ? <button onClick={() => setShowFullLog((current) => !current)}>{showFullLog ? "최근 8개" : "전체 보기"}</button> : null}</aside>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
