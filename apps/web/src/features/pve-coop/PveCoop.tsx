"use client";

import {
  PVE_ACTIONS,
  PVE_BOARD_HEIGHT,
  PVE_BOARD_WIDTH,
  PVE_CHARACTER_ORDER,
  getPveActionPreview,
  getPveActionsForCharacter,
  getPvePlannedActionOrder,
  isPvePreviewPosition,
  type PveActionPreview,
  type PveActionId,
  type PveActionTarget,
  type PveBeat,
  type PveCharacterId,
  type PveCoopRoomView,
  type PvePlannedAction,
  type PvePosition,
  type SessionCredentials,
  type SocketError,
} from "@blind-turn/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  ActionTimeline,
  BeatTransitionOverlay,
  buildPlanningTimelineItems,
  buildPlaybackTimelineItems,
  CurrentActionBanner,
} from "../pve-prototype/ActionTimeline";
import pveStyles from "../pve-prototype/PvePrototype.module.css";
import { usePvePlayback } from "../pve-prototype/usePvePlayback";
import { getGameSocket } from "../multiplayer/socket-client";
import {
  SOCKET_CONFIGURATION_ERROR,
  SOCKET_SERVER_URL,
} from "../multiplayer/socket-client";
import styles from "./PveCoop.module.css";

const SESSION_KEY = "blind-turn-pve-session";
const BEATS: readonly PveBeat[] = [1, 2, 3];
const MARKERS = ["①", "②", "③"] as const;
const ROLE_LABEL: Record<PveCharacterId, string> = {
  WARRIOR: "전사",
  ARCHER: "궁수",
  MAGE: "마법사",
  PRIEST: "사제",
};

function tileKey(position: PvePosition): string {
  return `${position.x}:${position.y}`;
}

function samePosition(left: PvePosition, right: PvePosition): boolean {
  return left.x === right.x && left.y === right.y;
}

function readCredentials(): SessionCredentials | null {
  try {
    const value = sessionStorage.getItem(SESSION_KEY);
    return value ? JSON.parse(value) as SessionCredentials : null;
  } catch {
    return null;
  }
}

function saveCredentials(credentials: SessionCredentials): void {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(credentials));
}

function clearCredentials(): void {
  sessionStorage.removeItem(SESSION_KEY);
}

function targetLabel(target: PveActionTarget | undefined, view: PveCoopRoomView): string {
  if (!target) return "";
  if (target.type === "TILE") return `→ (${target.position.x}, ${target.position.y})`;
  return `→ ${view.battleState.characters[target.characterId].name}`;
}

function planCount(view: PveCoopRoomView): number {
  return PVE_CHARACTER_ORDER.reduce(
    (count, characterId) => count + view.plans[characterId].filter(Boolean).length,
    0,
  );
}

export function pveConfirmationLabel(confirmedCount: number, playerCount: number): string {
  return `확정 ${confirmedCount} / ${playerCount}`;
}

function readableLog(view: PveCoopRoomView): string {
  const lines = [
    `BLIND TURN PvE 테스트 로그`,
    `방 코드: ${view.roomCode}`,
    `현재 턴: ${view.turnNumber}`,
    `결과: ${view.result}`,
    "",
    "[담당 직업]",
    ...view.players.map((player) =>
      `${player.nickname}: ${player.assignedCharacterIds.map((id) => ROLE_LABEL[id]).join(", ") || "미선택"} (${player.connected ? "접속" : "연결 끊김"})`
    ),
    "",
    "[최종 상태]",
    ...PVE_CHARACTER_ORDER.map((characterId) => {
      const character = view.battleState.characters[characterId];
      return `${character.name}: HP ${character.hp}/${character.maxHp}, 위치 (${character.position.x}, ${character.position.y}), 보호막 ${character.shield}`;
    }),
    `훈련용 골렘: HP ${view.battleState.boss.hp}/${view.battleState.boss.maxHp}`,
  ];
  for (const turn of view.history) {
    lines.push("", `[${turn.turnNumber}턴 계획]`);
    for (const characterId of PVE_CHARACTER_ORDER) {
      const character = turn.finalState.characters[characterId];
      const actions = turn.plans[characterId]
        .map((action, index) => `${MARKERS[index]} ${action ? PVE_ACTIONS[action.actionId].name : "미선택"}`)
        .join(" / ");
      lines.push(`${character.name}: ${actions}`);
    }
    lines.push(`[${turn.turnNumber}턴 주요 이벤트]`);
    for (const event of turn.events) {
      if (["ACTION_STARTED", "ACTION_FAILED", "MOVED", "BOSS_DAMAGED", "CHARACTER_DAMAGED", "CHARACTER_DIED", "BOSS_DEFEATED", "PARTY_DEFEATED"].includes(event.type)) {
        lines.push(`${event.beat}비트 · ${event.message}`);
      }
    }
  }
  return lines.join("\n");
}

function startBlockReason(view: PveCoopRoomView): string | null {
  if (view.players.length < 2) return "최소 2명의 플레이어가 필요합니다.";
  const assigned = new Set(view.players.flatMap((player) => player.assignedCharacterIds));
  const missing = PVE_CHARACTER_ORDER.find((characterId) => !assigned.has(characterId));
  if (missing) return `${ROLE_LABEL[missing]}가 아직 배정되지 않았습니다.`;
  if (view.players.some((player) => player.assignedCharacterIds.length === 0)) {
    return "모든 플레이어가 최소 한 캐릭터를 담당해야 합니다.";
  }
  if (view.players.some((player) => !player.connected || !player.ready)) {
    return "모든 플레이어가 접속하고 준비해야 합니다.";
  }
  return null;
}

function previewStatusText(preview: PveActionPreview, selectingTarget: boolean): string {
  const definition = PVE_ACTIONS[preview.actionId];
  if (preview.invalidReason) return preview.invalidReason;
  if (preview.requiresCharacterTarget) {
    return preview.selectedCharacterId
      ? `${ROLE_LABEL[preview.selectedCharacterId]} 대상 · 노란색 테두리로 표시 중`
      : "노란색 테두리의 생존 아군을 선택하세요.";
  }
  if (definition.phase === "MOVE" && !definition.attackPattern) {
    return preview.selectedTile
      ? `예상 이동 경로 · (${preview.originPosition.x}, ${preview.originPosition.y}) → (${preview.selectedTile.x}, ${preview.selectedTile.y})`
      : "초록색 타일 중 이동할 위치를 선택하세요.";
  }
  if (definition.attackPattern) {
    if (preview.requiresTileTarget && selectingTarget && !preview.selectedTile) {
      return "파란 점이 표시된 공격 중심 타일을 선택하세요.";
    }
    return preview.willHitBoss
      ? "훈련용 골렘 명중 예상"
      : "현재 예상 범위에는 대상이 없습니다.";
  }
  return `${definition.name} · 타일 대상이 없는 행동입니다.`;
}

type EntryProps = { initialRoomCode?: string };

export function PveCoop({ initialRoomCode }: EntryProps) {
  const router = useRouter();
  const socket = useMemo(() => getGameSocket(), []);
  const [connected, setConnected] = useState(Boolean(socket?.connected));
  const [view, setView] = useState<PveCoopRoomView | null>(null);
  const [nickname, setNickname] = useState("");
  const [roomCode, setRoomCode] = useState(initialRoomCode ?? "");
  const [error, setError] = useState<SocketError | null>(null);
  const [notice, setNotice] = useState("서버에 연결 중입니다.");
  const [chatInput, setChatInput] = useState("");

  useEffect(() => {
    if (!socket) return;
    const onConnect = () => {
      setConnected(true);
      setNotice("서버에 연결되었습니다.");
      if (!initialRoomCode) return;
      const credentials = readCredentials();
      if (!credentials || credentials.roomCode !== initialRoomCode.toUpperCase()) return;
      socket.emit("pve:room:reconnect", credentials, (response) => {
        if (response.ok) {
          saveCredentials(response.data.credentials);
          setView(response.data.view);
          setError(null);
        } else {
          clearCredentials();
          setError(response.error);
        }
      });
    };
    const onDisconnect = () => {
      setConnected(false);
      setNotice("연결이 끊겼습니다. 자동 재접속 중입니다.");
    };
    const onView = (next: PveCoopRoomView) => {
      if (!initialRoomCode || next.roomCode === initialRoomCode.toUpperCase()) setView(next);
    };
    const onError = (next: SocketError) => setError(next);
    const onReconnect = () => setNotice("파티원이 재접속했습니다.");
    const onPlayerDisconnect = () => setNotice("파티원의 연결이 끊겼습니다.");
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("pve:room:state-updated", onView);
    socket.on("pve:error", onError);
    socket.on("pve:player-reconnected", onReconnect);
    socket.on("pve:player-disconnected", onPlayerDisconnect);
    socket.connect();
    if (socket.connected) onConnect();
    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("pve:room:state-updated", onView);
      socket.off("pve:error", onError);
      socket.off("pve:player-reconnected", onReconnect);
      socket.off("pve:player-disconnected", onPlayerDisconnect);
    };
  }, [initialRoomCode, socket]);

  function createRoom(): void {
    if (!socket || !nickname.trim()) return;
    socket.emit("pve:room:create", { nickname }, (response) => {
      if (!response.ok) return setError(response.error);
      saveCredentials(response.data.credentials);
      setView(response.data.view);
      router.push(`/pve/room/${response.data.credentials.roomCode}`);
    });
  }

  function joinRoom(): void {
    if (!socket || !nickname.trim() || roomCode.length !== 6) return;
    socket.emit("pve:room:join", { nickname, roomCode: roomCode.toUpperCase() }, (response) => {
      if (!response.ok) return setError(response.error);
      saveCredentials(response.data.credentials);
      setView(response.data.view);
      router.push(`/pve/room/${response.data.credentials.roomCode}`);
    });
  }

  if (!view) {
    return (
      <main className={styles.entryShell}>
        <section className={styles.entryCard}>
          <p>ONLINE PVE CO-OP</p>
          <h1>2~4인 골렘 훈련</h1>
          <span>전사·궁수·마법사·사제를 모두 나눠 맡아 3비트 행동을 함께 계획합니다.</span>
          {SOCKET_CONFIGURATION_ERROR && <div className={styles.error}>{SOCKET_CONFIGURATION_ERROR}</div>}
          {error && <div className={styles.error}>{error.message}</div>}
          <label>닉네임<input maxLength={12} onChange={(event) => setNickname(event.target.value)} value={nickname} /></label>
          <button disabled={!connected || !nickname.trim()} onClick={createRoom} type="button">새 PvE 방 만들기</button>
          <div className={styles.joinRow}>
            <input aria-label="방 코드" maxLength={6} onChange={(event) => setRoomCode(event.target.value.toUpperCase())} placeholder="6자리 방 코드" value={roomCode} />
            <button disabled={!connected || !nickname.trim() || roomCode.length !== 6} onClick={joinRoom} type="button">참가</button>
          </div>
          <small>{notice}{SOCKET_SERVER_URL ? ` · ${SOCKET_SERVER_URL}` : ""}</small>
          <nav><Link href="/">PvP</Link><Link href="/pve-prototype">1인 개발용 프로토타입</Link></nav>
        </section>
      </main>
    );
  }

  if (view.phase === "LOBBY") {
    return <PveLobby connected={connected} error={error} notice={notice} setError={setError} socket={socket!} view={view} />;
  }
  return <PveBattle connected={connected} error={error} setError={setError} socket={socket!} view={view} chatInput={chatInput} setChatInput={setChatInput} />;
}

type SocketValue = NonNullable<ReturnType<typeof getGameSocket>>;

function PveLobby({ connected, error, notice, setError, socket, view }: {
  connected: boolean;
  error: SocketError | null;
  notice: string;
  setError: (error: SocketError | null) => void;
  socket: SocketValue;
  view: PveCoopRoomView;
}) {
  const router = useRouter();
  const self = view.players.find((player) => player.playerId === view.selfPlayerId)!;
  const selectedRoles = new Set(view.players.flatMap((player) => player.assignedCharacterIds));
  const blockReason = startBlockReason(view);
  const canStart = blockReason === null;
  const request = (run: (done: (response: { ok: boolean; error?: SocketError }) => void) => void) => {
    run((response) => setError(response.ok ? null : response.error ?? null));
  };
  const leave = () => request((done) => socket.emit("pve:room:leave", { roomCode: view.roomCode }, (response) => {
    if (response.ok) {
      clearCredentials();
      router.push("/pve");
    }
    done(response);
  }));
  return (
    <main className={styles.lobbyShell}>
      <header><div><p>PVE CO-OP ROOM</p><h1>{view.roomCode}</h1></div><div className={connected ? styles.online : styles.offline}>{connected ? "ONLINE" : "RECONNECTING"}</div></header>
      {error && <div className={styles.error}>{error.message}</div>}
      <section className={styles.lobbyGrid}>
        <article className={styles.rolePanel}>
          <h2>담당 직업 선택</h2>
          <div className={styles.roleGrid}>
            {PVE_CHARACTER_ORDER.map((characterId) => {
              const character = view.battleState.characters[characterId];
              const owner = view.players.find((player) => player.assignedCharacterIds.includes(characterId));
              const mine = self.assignedCharacterIds.includes(characterId);
              const unavailable = selectedRoles.has(characterId) && !mine;
              return <button
                className={mine ? styles.selectedRole : ""}
                disabled={self.ready || unavailable}
                key={characterId}
                onClick={() => request((done) => socket.emit("pve:room:select-character", { roomCode: view.roomCode, characterId }, done))}
                type="button"
              ><b>{character.token}</b><strong>{character.name}</strong><span>{owner?.nickname ?? "선택 가능"}</span></button>;
            })}
          </div>
        </article>
        <aside className={styles.rosterPanel}>
          <h2>파티 {view.players.length} / 4 · 최소 2명</h2>
          {view.players.map((player) => <div className={styles.rosterRow} key={player.playerId}>
            <b>{player.seatNumber}</b><span><strong>{player.nickname}</strong><small>{player.assignedCharacterIds.map((id) => ROLE_LABEL[id]).join(" · ") || "직업 미선택"}</small></span>
            <em>{player.connected ? "접속" : "연결 끊김"}</em><i>{player.ready ? "준비" : "대기"}</i>
          </div>)}
          <button disabled={self.assignedCharacterIds.length === 0} onClick={() => request((done) => socket.emit("pve:room:set-ready", { roomCode: view.roomCode, ready: !self.ready }, done))} type="button">{self.ready ? "준비 취소" : "준비 완료"}</button>
          {view.hostPlayerId === view.selfPlayerId
            ? <><button className={styles.primary} disabled={!canStart} onClick={() => request((done) => socket.emit("pve:room:start", { roomCode: view.roomCode }, done))} type="button">협동 전투 시작</button>{blockReason && <p className={styles.startReason}>시작 불가 · {blockReason}</p>}</>
            : <p>방장이 전투를 시작합니다.</p>}
        </aside>
      </section>
      <footer><span>{notice}</span><button onClick={() => void navigator.clipboard.writeText(view.roomCode)} type="button">방 코드 복사</button><button onClick={leave} type="button">방 나가기</button></footer>
    </main>
  );
}

function PveBattle({ connected, error, setError, socket, view, chatInput, setChatInput }: {
  connected: boolean;
  error: SocketError | null;
  setError: (error: SocketError | null) => void;
  socket: SocketValue;
  view: PveCoopRoomView;
  chatInput: string;
  setChatInput: (value: string) => void;
}) {
  const router = useRouter();
  const playback = usePvePlayback(view.pendingPlayback?.startState ?? view.battleState);
  const acknowledgedTurn = useRef<number | null>(null);
  const [selectedBeat, setSelectedBeat] = useState<PveBeat>(1);
  const [timelineBeat, setTimelineBeat] = useState<PveBeat>(1);
  const [pendingActionId, setPendingActionId] = useState<PveActionId | null>(null);
  const [message, setMessage] = useState("내 행동 슬롯과 카드를 선택하세요.");
  const [copied, setCopied] = useState(false);
  const [myRole, setMyRole] = useState<PveCharacterId>(
    () => view.myAssignedCharacterIds[0] ?? "WARRIOR",
  );
  const [previewCharacterId, setPreviewCharacterId] = useState<PveCharacterId>(
    () => view.myAssignedCharacterIds[0] ?? "WARRIOR",
  );
  const [hoveredTile, setHoveredTile] = useState<PvePosition | null>(null);
  const myRoles = view.myAssignedCharacterIds;
  const self = view.players.find((player) => player.playerId === view.selfPlayerId)!;
  const planning = view.phase === "PLANNING";
  const myLocked = self.confirmed || !planning;
  const myPlansComplete = myRoles.every((characterId) =>
    view.plans[characterId].every(Boolean)
  );

  useEffect(() => {
    if (!pendingActionId) return;
    const cancelTargetSelection = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setPendingActionId(null);
      setHoveredTile(null);
      setMessage("대상 선택을 취소했습니다.");
    };
    window.addEventListener("keydown", cancelTargetSelection);
    return () => window.removeEventListener("keydown", cancelTargetSelection);
  }, [pendingActionId]);

  useEffect(() => {
    if (!myLocked) return;
    setPendingActionId(null);
    setHoveredTile(null);
  }, [myLocked]);

  useEffect(() => {
    const pending = view.pendingPlayback;
    if (view.phase === "RESOLVING" && pending && playback.resolution?.events[0]?.id !== pending.resolution.events[0]?.id) {
      playback.reset(pending.startState);
      playback.start(pending.resolution, pending.startState);
    }
    if (view.phase === "PLANNING") {
      playback.reset(view.battleState);
      acknowledgedTurn.current = null;
      setPendingActionId(null);
    }
  }, [playback.reset, playback.start, view.battleState, view.pendingPlayback, view.phase]);

  useEffect(() => {
    const resolution = playback.resolution;
    if (
      view.phase !== "RESOLVING"
      || !resolution
      || playback.eventIndex < resolution.events.length - 1
      || acknowledgedTurn.current === view.turnNumber
    ) return;
    acknowledgedTurn.current = view.turnNumber;
    socket.emit("pve:playback-finished", { roomCode: view.roomCode, turnNumber: view.turnNumber }, (response) => {
      if (!response.ok) setError(response.error);
    });
  }, [playback.eventIndex, playback.resolution, setError, socket, view.phase, view.roomCode, view.turnNumber]);

  const displayState = view.phase === "RESOLVING" ? playback.displayState : view.battleState;
  const currentEvent = playback.currentEvent;
  const resolution = view.pendingPlayback?.resolution ?? playback.resolution;
  const displayBeat = currentEvent?.beat ?? timelineBeat;
  const allTimeline = resolution
    ? buildPlaybackTimelineItems(resolution.timeline, playback.eventIndex)
    : buildPlanningTimelineItems(getPvePlannedActionOrder(view.plans, timelineBeat, view.bossPlan));
  const timelineItems = allTimeline.filter((item) => item.beat === displayBeat);
  const activeItem = allTimeline.find((item) => item.visualStatus === "ACTIVE") ?? null;
  const nextItem = allTimeline.find((item) => item.isNext) ?? null;
  const activeCharacterId = activeItem?.actorId !== "BOSS" ? activeItem?.actorId ?? null : null;
  const bossActing = activeItem?.actorId === "BOSS";
  const visibleEvents = resolution
    ? resolution.events.slice(0, Math.max(0, playback.eventIndex + 1))
    : view.history.flatMap((turn) => turn.events);
  const pendingDefinition = pendingActionId ? PVE_ACTIONS[pendingActionId] : null;
  const tiles = useMemo(() => {
    const result: PvePosition[] = [];
    for (let y = 0; y < PVE_BOARD_HEIGHT; y += 1) {
      for (let x = 0; x < PVE_BOARD_WIDTH; x += 1) result.push({ x, y });
    }
    return result;
  }, []);
  const previewPlannedAction = view.plans[previewCharacterId][selectedBeat - 1];
  const previewActionId = pendingActionId ?? previewPlannedAction?.actionId ?? null;
  const previewTarget = pendingActionId
    ? pendingDefinition?.targetType === "TILE" && hoveredTile
      ? { type: "TILE" as const, position: hoveredTile }
      : undefined
    : previewPlannedAction?.target;
  const actionPreview = useMemo(() => {
    if (!planning || !previewActionId) return null;
    return getPveActionPreview(
      view.battleState,
      view.plans,
      previewCharacterId,
      selectedBeat,
      previewActionId,
      previewTarget,
    );
  }, [
    planning,
    previewActionId,
    previewCharacterId,
    previewTarget,
    selectedBeat,
    view.battleState,
    view.plans,
  ]);
  const teamPreviewByTile = useMemo(() => {
    const markers = new Map<string, Set<PveCharacterId>>();
    if (!planning) return markers;
    const addMarker = (position: PvePosition, characterId: PveCharacterId) => {
      if (position.x < 0 || position.x >= PVE_BOARD_WIDTH || position.y < 0 || position.y >= PVE_BOARD_HEIGHT) return;
      const key = tileKey(position);
      const values = markers.get(key) ?? new Set<PveCharacterId>();
      values.add(characterId);
      markers.set(key, values);
    };
    for (const characterId of PVE_CHARACTER_ORDER) {
      const action = view.plans[characterId][timelineBeat - 1];
      if (!action) continue;
      const preview = getPveActionPreview(
        view.battleState,
        view.plans,
        characterId,
        timelineBeat,
        action.actionId,
        action.target,
      );
      for (const position of [...preview.pathTiles, ...preview.effectTiles]) {
        addMarker(position, characterId);
      }
      if (action.target?.type === "ALLY") {
        addMarker(view.battleState.characters[action.target.characterId].position, characterId);
      }
    }
    return markers;
  }, [planning, timelineBeat, view]);
  const previewMessage = actionPreview
    ? previewStatusText(actionPreview, Boolean(pendingActionId))
    : message;

  const sendSlot = (beat: PveBeat, action: PvePlannedAction | null) => {
    socket.emit("pve:plan:set-slot", { roomCode: view.roomCode, turnNumber: view.turnNumber, characterId: myRole, beat, action }, (response) => {
      if (response.ok) {
        setError(null);
        setPendingActionId(null);
        setHoveredTile(null);
        setMessage(action ? `${beat}비트에 ${PVE_ACTIONS[action.actionId].name}을(를) 배치했습니다.` : `${beat}비트를 비웠습니다.`);
      } else setError(response.error);
    });
  };

  const chooseAction = (actionId: PveActionId) => {
    const definition = PVE_ACTIONS[actionId];
    setPreviewCharacterId(myRole);
    setHoveredTile(null);
    if (definition.targetType === "NONE") {
      setPendingActionId(actionId);
      sendSlot(selectedBeat, { actionId });
    }
    else {
      setPendingActionId(actionId);
      setMessage(
        definition.targetType === "ALLY"
          ? "보호·지원할 아군을 선택하세요."
          : definition.phase === "MOVE"
            ? "이동할 타일을 선택하세요."
            : "공격 중심 타일을 선택하세요.",
      );
    }
  };

  const selectTile = (position: PvePosition, characterId?: PveCharacterId) => {
    if (!pendingActionId || !pendingDefinition || !actionPreview) return;
    const target: PveActionTarget | null = pendingDefinition.targetType === "ALLY"
      ? characterId ? { type: "ALLY", characterId } : null
      : { type: "TILE", position };
    if (!target) return;
    if (
      target.type === "TILE"
      && !isPvePreviewPosition(actionPreview.selectableTiles, target.position)
    ) return setMessage(actionPreview.invalidReason ?? "선택할 수 없는 타일입니다.");
    if (
      target.type === "ALLY"
      && !actionPreview.selectableCharacterIds.includes(target.characterId)
    ) return setMessage("선택할 수 없는 아군입니다.");
    sendSlot(selectedBeat, { actionId: pendingActionId, target });
  };

  const cancelTargetSelection = () => {
    setPendingActionId(null);
    setHoveredTile(null);
    setMessage("대상 선택을 취소했습니다.");
  };

  const showPlannedPreview = (characterId: PveCharacterId, beat: PveBeat) => {
    const action = view.plans[characterId][beat - 1];
    setPreviewCharacterId(characterId);
    setSelectedBeat(beat);
    setTimelineBeat(beat);
    setPendingActionId(null);
    setHoveredTile(null);
    setMessage(
      action
        ? `${ROLE_LABEL[characterId]} 행동 ${MARKERS[beat - 1]} · ${PVE_ACTIONS[action.actionId].name} 예상 범위`
        : `${ROLE_LABEL[characterId]} 행동 ${MARKERS[beat - 1]}은 아직 미선택입니다.`,
    );
  };

  const submitChat = (event: FormEvent) => {
    event.preventDefault();
    if (!chatInput.trim()) return;
    socket.emit("pve:chat:send", { roomCode: view.roomCode, message: chatInput }, (response) => {
      if (response.ok) setChatInput("");
      else setError(response.error);
    });
  };

  const leaveBattle = () => {
    socket.emit("pve:room:leave", { roomCode: view.roomCode }, (response) => {
      if (!response.ok) return setError(response.error);
      clearCredentials();
      router.push("/pve");
    });
  };

  const bossWasHit = currentEvent?.type === "BOSS_DAMAGED";
  const previewDefinition = actionPreview ? PVE_ACTIONS[actionPreview.actionId] : null;
  const previewIsMove = previewDefinition?.phase === "MOVE" && !previewDefinition.attackPattern;
  const previewHasAttack = Boolean(previewDefinition?.attackPattern);
  const bossPreviewHit = planning && Boolean(actionPreview?.willHitBoss);
  const previewReadOnly = planning && !myRoles.includes(previewCharacterId);
  return (
    <main className={`${pveStyles.shell} ${styles.coopShell}`}>
      <header className={`${pveStyles.header} ${styles.battleHeader}`}>
        <div className={pveStyles.brand}><span>BT</span><div><strong>BLIND TURN</strong><small>ONLINE PVE CO-OP</small></div></div>
        <div className={styles.turnIdentity}><b>TURN {view.turnNumber}</b><span>내 담당 · {myRoles.map((id) => ROLE_LABEL[id]).join(" · ")}</span><em>{connected ? "동기화됨" : "재접속 중"}</em></div>
        <div className={pveStyles.headerActions}><button onClick={() => void navigator.clipboard.writeText(view.roomCode)} type="button">방 {view.roomCode}</button><button onClick={leaveBattle} type="button">나가기</button></div>
      </header>
      {error && <div className={styles.battleError}>{error.message}</div>}
      <section className={`${pveStyles.workspace} ${styles.battleWorkspace}`}>
        <section className={pveStyles.upperGrid}>
          <section className={pveStyles.battleArena}>
            <div className={pveStyles.arenaHeader}>
              <div className={pveStyles.panelHeader}><div><span>6 × 4 SHARED GRID</span><h1 className={pveStyles.battleArenaTitle}>전술 전장</h1></div><div className={pveStyles.axisHint}>후열 x=0 <b>→</b> 전열 x=5 <b>▶</b> 보스</div></div>
              <div className={pveStyles.intentStrip} aria-label="서버가 확정한 보스 행동 예고">
                {view.bossPlan.map((intent) => <article className={currentEvent?.beat === intent.beat ? pveStyles.activeIntent : ""} key={intent.id}>
                  <span>{MARKERS[intent.beat - 1]}</span><div><strong>{intent.name}</strong><p>{intent.description}</p></div>
                </article>)}
              </div>
            </div>
            <div className={pveStyles.timelinePanel}>
              <ActionTimeline beat={displayBeat} characters={displayState.characters} items={timelineItems} onBeatChange={setTimelineBeat} planning={planning} />
              <CurrentActionBanner activeItem={activeItem} beat={displayBeat} bossName={displayState.boss.name} characters={displayState.characters} currentEvent={currentEvent} nextItem={nextItem} planning={planning} />
            </div>
            <div className={pveStyles.arenaBody} onContextMenu={(event) => {
                if (!pendingActionId) return;
                event.preventDefault();
                cancelTargetSelection();
              }}>
              <div className={pveStyles.boardWrap}>
                <div className={`${pveStyles.board} ${activeItem ? pveStyles.boardHasActiveActor : ""}`}>
                  {tiles.map((position) => {
                    const character = PVE_CHARACTER_ORDER.map((id) => displayState.characters[id]).find((candidate) => samePosition(candidate.position, position));
                    const playbackEffect = !planning && Boolean(currentEvent?.effectArea?.some((tile) => samePosition(tile, position)));
                    const previewSelectable = Boolean(
                      pendingActionId
                      && actionPreview
                      && isPvePreviewPosition(actionPreview.selectableTiles, position)
                    );
                    const previewEffect = Boolean(actionPreview && isPvePreviewPosition(actionPreview.effectTiles, position));
                    const previewPath = Boolean(actionPreview && isPvePreviewPosition(actionPreview.pathTiles, position));
                    const previewOrigin = Boolean(actionPreview && samePosition(actionPreview.originPosition, position));
                    const previewSelected = Boolean(actionPreview?.selectedTile && samePosition(actionPreview.selectedTile, position));
                    const previewHovered = Boolean(hoveredTile && samePosition(hoveredTile, position));
                    const selectableSupport = Boolean(
                      pendingActionId
                      && character
                      && actionPreview?.selectableCharacterIds.includes(character.id)
                    );
                    const selectedSupport = Boolean(
                      character
                      && actionPreview?.selectedCharacterId === character.id
                    );
                    const canSelectTile = Boolean(
                      pendingDefinition?.targetType === "TILE" && previewSelectable
                    );
                    const canSelectSupport = Boolean(
                      pendingDefinition?.targetType === "ALLY" && selectableSupport
                    );
                    const teamMarkers = teamPreviewByTile.get(tileKey(position));
                    const targetPreview = view.bossPlan.some((intent) => intent.targetTiles?.some((tile) => samePosition(tile, position)));
                    const isHit = currentEvent?.type === "CHARACTER_DAMAGED" && currentEvent.targetCharacterId === character?.id;
                    const isHealed = currentEvent?.type === "HEALED" && currentEvent.targetCharacterId === character?.id;
                    const previewKinds = [
                      previewSelectable && previewIsMove ? "move-selectable" : null,
                      previewSelectable && previewHasAttack ? "attack-selectable" : null,
                      previewPath ? "move-path" : null,
                      previewEffect ? "attack-effect" : null,
                      previewOrigin ? "origin" : null,
                      previewSelected ? "selected" : null,
                      selectableSupport ? "support-selectable" : null,
                      selectedSupport ? "support-selected" : null,
                    ].filter(Boolean).join(" ") || undefined;
                    return <button
                      className={`${pveStyles.tile} ${playbackEffect ? pveStyles.attackEffectArea : ""} ${targetPreview ? pveStyles.dangerActive : ""} ${previewSelectable && previewIsMove ? styles.previewMoveSelectable : ""} ${previewSelectable && previewHasAttack ? styles.previewAttackSelectable : ""} ${previewPath ? styles.previewMovePath : ""} ${previewEffect ? styles.previewAttackEffect : ""} ${previewOrigin ? styles.previewOriginTile : ""} ${previewSelected ? styles.previewSelectedTile : ""} ${previewHovered ? styles.previewHoveredTile : ""}`}
                      data-preview={previewKinds}
                      disabled={!canSelectTile && !canSelectSupport}
                      key={tileKey(position)}
                      onClick={() => selectTile(position, character?.id)}
                      onMouseEnter={() => {
                        if (canSelectTile) setHoveredTile(position);
                      }}
                      onMouseLeave={() => {
                        if (previewHovered) setHoveredTile(null);
                      }}
                      type="button"
                    >
                      <span className={pveStyles.coordinate}>x{position.x} · y{position.y}</span>
                      {teamMarkers && teamMarkers.size > 0 && <span className={pveStyles.playerRangeMarker}>{[...teamMarkers].map((id) => displayState.characters[id].token).join("·")}{displayBeat}</span>}
                      {previewSelectable && <span aria-hidden="true" className={styles.previewTileMarker}>{previewIsMove ? "↦" : "•"}</span>}
                      {previewOrigin && <span aria-hidden="true" className={styles.previewOriginMarker}>S</span>}
                      {previewSelected && <span aria-hidden="true" className={styles.previewSelectedMarker}>✓</span>}
                      {character && <span className={`${pveStyles.characterUnit} ${activeCharacterId === character.id ? pveStyles.currentActorToken : ""} ${!character.alive ? pveStyles.deadToken : ""} ${isHit ? pveStyles.tokenHit : ""} ${isHealed ? pveStyles.tokenHealed : ""} ${selectableSupport ? styles.previewSupportSelectable : ""} ${selectedSupport ? styles.previewSupportSelected : ""}`}>
                        {view.bossPlan.flatMap((intent) => intent.targetCharacterIds?.includes(character.id) ? [<b className={pveStyles.trackingMarker} key={intent.id}>{MARKERS[intent.beat - 1]}</b>] : [])}
                        <strong className={pveStyles.characterToken}>{character.token}</strong>
                        {activeCharacterId === character.id && <small className={pveStyles.actorStatusBadge}>행동 중</small>}
                        <em className={pveStyles.characterHp}>HP {character.hp}/{character.maxHp}</em>
                        {character.shield > 0 && <i>◆{character.shield}</i>}
                        {isHit && <b className={pveStyles.damageFloat}>-{currentEvent.amount}</b>}
                        {isHealed && <b className={pveStyles.healFloat}>+{currentEvent.amount}</b>}
                      </span>}
                    </button>;
                  })}
                </div>
              </div>
              <div className={pveStyles.bossConnector}><span>보스 영역</span><b>▶</b></div>
              <div className={pveStyles.bossLane}>
                <section className={pveStyles.bossCard}>
                  <header className={pveStyles.bossHeader}><strong className={pveStyles.bossName}>{displayState.boss.name}</strong>{bossActing && <small className={pveStyles.bossActorBadge}>행동 중</small>}<span className={pveStyles.bossCoordinate}>x=6 · y=1~2</span></header>
                  <div className={pveStyles.bossVisual}>
                    <div className={`${pveStyles.bossStatue} ${bossActing ? pveStyles.bossActing : ""} ${bossWasHit ? pveStyles.bossHit : ""} ${bossPreviewHit ? styles.bossPreviewHit : ""}`}><span className={pveStyles.bossEyes}><i /><i /></span></div>
                    <strong className={pveStyles.bossLabel}>BOSS</strong>
                    {bossPreviewHit && <span className={styles.bossPreviewBadge}>명중 예상</span>}
                    {planning && actionPreview && (actionPreview.selectableTiles.some((tile) => tile.x === 6) || actionPreview.effectTiles.some((tile) => tile.x === 6)) && <div className={styles.bossVirtualTargets} aria-label="보스 가상 점유 타일">
                      {displayState.boss.occupiedTiles.map((position) => {
                        const selectable = Boolean(
                          pendingActionId
                          && isPvePreviewPosition(actionPreview.selectableTiles, position)
                        );
                        const inEffect = isPvePreviewPosition(actionPreview.effectTiles, position);
                        const selected = Boolean(actionPreview.selectedTile && samePosition(actionPreview.selectedTile, position));
                        return <button
                          aria-label={`공격 중심 보스 타일 ${position.x}, ${position.y}`}
                          className={`${styles.bossVirtualTarget} ${selectable ? styles.bossVirtualSelectable : ""} ${inEffect ? styles.bossVirtualEffect : ""} ${selected ? styles.bossVirtualSelected : ""}`}
                          data-preview={[selectable ? "attack-selectable" : null, inEffect ? "attack-effect" : null, selected ? "selected" : null].filter(Boolean).join(" ") || undefined}
                          disabled={!selectable}
                          key={tileKey(position)}
                          onClick={() => selectTile(position)}
                          onMouseEnter={() => {
                            if (selectable) setHoveredTile(position);
                          }}
                          onMouseLeave={() => {
                            if (hoveredTile && samePosition(hoveredTile, position)) setHoveredTile(null);
                          }}
                          type="button"
                        >x6,y{position.y}</button>;
                      })}
                    </div>}
                  </div>
                  <div className={pveStyles.hpReadout}><div className={pveStyles.hpTrack}><span style={{ width: `${displayState.boss.hp / displayState.boss.maxHp * 100}%` }} /></div><div className={pveStyles.hpNumbers}><span>HP</span><strong>{displayState.boss.hp} / {displayState.boss.maxHp}</strong></div></div>
                  <div className={pveStyles.bossCurrentIntent}><span>{currentEvent ? `패턴 ${MARKERS[currentEvent.beat - 1]}` : "현재 턴"}</span><strong>{currentEvent ? view.bossPlan[currentEvent.beat - 1]?.name : "행동 예고 공개"}</strong></div>
                  {bossWasHit && <b className={pveStyles.bossDamageFloat}>-{currentEvent.amount}</b>}
                </section>
              </div>
              <BeatTransitionOverlay beat={currentEvent?.type === "BEAT_STARTED" ? currentEvent.beat : null} />
            </div>
          </section>
          <aside className={`${pveStyles.planSummary} ${styles.teamPanel}`}>
            <div className={pveStyles.summaryParty}>
              <div className={pveStyles.panelHeader}><div><span>SHARED PARTY PLAN</span><h2>전체 행동 요약</h2></div><b>{pveConfirmationLabel(view.confirmedPlayerIds.length, view.players.length)}</b></div>
              <div className={pveStyles.partyPlans}>
                {PVE_CHARACTER_ORDER.map((characterId) => {
                  const character = displayState.characters[characterId];
                  const owner = view.players.find((player) => player.assignedCharacterIds.includes(characterId));
                  return <article className={`${pveStyles.partyPlanCard} ${myRoles.includes(characterId) ? pveStyles.selectedPlan : ""}`} key={characterId}>
                    <div className={`${pveStyles.partyPlanCharacter} ${styles.readonlyCharacter}`}><span>{character.token}</span><strong>{character.name}</strong><small>{owner?.nickname ?? "미배정"} · {owner?.confirmed ? "확정" : "계획 중"}{owner && !owner.connected ? " · 연결 끊김" : ""}</small></div>
                    <div className={pveStyles.partyPlanActions}>{BEATS.map((beat) => {
                      const action = view.plans[characterId][beat - 1];
                      const activePreview = planning
                        && !pendingActionId
                        && previewCharacterId === characterId
                        && selectedBeat === beat;
                      return <button
                        aria-label={`${character.name} 행동 ${beat} ${action ? PVE_ACTIONS[action.actionId].name : "미선택"} 미리보기`}
                        aria-pressed={activePreview}
                        className={`${pveStyles.partyPlanAction} ${styles.previewPlanAction} ${activePreview ? styles.previewPlanActionActive : ""}`}
                        disabled={!planning || !action}
                        key={beat}
                        onClick={() => showPlannedPreview(characterId, beat)}
                        type="button"
                      ><b>{MARKERS[beat - 1]}</b><span className={pveStyles.planActionLine}><strong className={pveStyles.planActionName}>{action ? PVE_ACTIONS[action.actionId].name : "미선택"}</strong>{action?.target && <small className={pveStyles.planActionTarget}>{targetLabel(action.target, view)}</small>}</span></button>;
                    })}</div>
                  </article>;
                })}
              </div>
            </div>
            <div className={pveStyles.summaryMeta}>
              <div className={styles.confirmStatus}><strong>{pveConfirmationLabel(view.confirmedPlayerIds.length, view.players.length)}</strong><span>대기 중: {view.players.filter((player) => !player.confirmed).map((player) => player.nickname).join(", ") || "없음"}</span></div>
              {planning && <p className={styles.previewHint}>비트 탭을 바꾸면 해당 비트의 팀 이동·공격·지원 예상 범위를 전장에서 확인할 수 있습니다.</p>}
            </div>
          </aside>
        </section>
        <section className={`${pveStyles.commandPanel} ${styles.commandGrid}`}>
          <div className={pveStyles.characterCommand}>
            <nav className={styles.myCharacterTabs} aria-label="내 담당 캐릭터 전환">
              {myRoles.map((characterId) => {
                const complete = view.plans[characterId].every(Boolean);
                return <button
                  aria-pressed={myRole === characterId}
                  className={myRole === characterId ? styles.activeCharacterTab : ""}
                  key={characterId}
                  onClick={() => {
                    setMyRole(characterId);
                    setPreviewCharacterId(characterId);
                    setPendingActionId(null);
                    setHoveredTile(null);
                    setMessage(`${ROLE_LABEL[characterId]} 계획을 편집합니다.`);
                  }}
                  type="button"
                >{ROLE_LABEL[characterId]} <small>{complete ? "계획 완료" : `미선택 ${view.plans[characterId].filter((action) => !action).length}`}</small></button>;
              })}
            </nav>
            <div className={pveStyles.commandTitle}><span className={pveStyles.commandToken}>{displayState.characters[myRole].token}</span><div><small>MY CHARACTER</small><h2>{ROLE_LABEL[myRole]} 행동 계획</h2></div><div className={pveStyles.selectedStats}>HP {displayState.characters[myRole].hp}/{displayState.characters[myRole].maxHp}<b>{self.confirmed ? "확정됨" : "편집 가능"}</b></div></div>
            <div className={pveStyles.slotRow}>{BEATS.map((beat) => {
              const action = view.plans[myRole][beat - 1];
              return <div className={`${pveStyles.planSlot} ${selectedBeat === beat && previewCharacterId === myRole ? pveStyles.activeSlot : ""}`} key={beat}><button disabled={!planning} onClick={() => showPlannedPreview(myRole, beat)} type="button"><span>BEAT {beat}</span><strong>{action ? PVE_ACTIONS[action.actionId].name : "행동 선택"}</strong><small>{action ? targetLabel(action.target, view) : "카드를 배치하세요"}</small></button>{action && !myLocked && <button className={pveStyles.removeAction} onClick={() => sendSlot(beat, null)} type="button">×</button>}</div>;
            })}</div>
            <div className={pveStyles.cardRow}>{getPveActionsForCharacter(myRole).map((action) => <button className={`${pveStyles.actionCard} ${pendingActionId === action.id ? pveStyles.pendingCard : ""}`} disabled={myLocked || !displayState.characters[myRole].alive} key={action.id} onClick={() => chooseAction(action.id)} type="button"><span>{action.phase}</span><strong>{action.name}</strong><p>{action.description}</p><small>{action.damageType ?? action.targetType}</small></button>)}</div>
          </div>
          <aside className={`${pveStyles.playbackPanel} ${styles.controlPanel}`}>
            <div className={pveStyles.playbackHeader}><div><span>{view.phase}</span><h2>{view.phase === "RESOLVING" ? "동기화 재생" : view.phase === "RESULT" ? "전투 결과" : "계획 상태"}</h2></div><b>{planCount(view)} / 12</b></div>
            {view.phase === "PLANNING" && <><p className={`${pveStyles.planningMessage} ${actionPreview?.willHitBoss ? styles.previewHitMessage : ""}`}>{previewReadOnly && <b>읽기 전용 · </b>}{previewMessage}</p>{pendingActionId && <button className={styles.cancelPreviewButton} onClick={cancelTargetSelection} type="button">대상 선택 취소 · Esc / 우클릭</button>}<div className={styles.myPlanStatus}>{myRoles.map((characterId) => <span key={characterId}>{ROLE_LABEL[characterId]} · {view.plans[characterId].every(Boolean) ? "계획 완료" : `행동 ${view.plans[characterId].findIndex((action) => !action) + 1} 미선택`}</span>)}</div><button className={pveStyles.startButton} disabled={!myPlansComplete} onClick={() => socket.emit("pve:plan:set-confirmed", { roomCode: view.roomCode, turnNumber: view.turnNumber, confirmed: !self.confirmed }, (response) => response.ok ? setError(null) : setError(response.error))} type="button">{self.confirmed ? "확정 취소" : "계획 확정"}</button><small className={pveStyles.lockHint}>담당한 모든 캐릭터 계획이 함께 잠깁니다.</small></>}
            {view.phase === "RESOLVING" && <><div className={pveStyles.playbackControls}><button onClick={playback.toggle} type="button">{playback.isPlaying ? "일시 정지" : "계속 재생"}</button><button onClick={playback.skip} type="button">결과까지 건너뛰기</button></div><p className={styles.syncMessage}>서버 결과 적용 완료 · 로컬 연출만 재생 중</p></>}
            {view.phase === "RESULT" && <div className={styles.resultActions}><strong>{view.result === "VICTORY" ? "승리" : "패배"}</strong><button disabled={self.rematchRequested} onClick={() => socket.emit("pve:request-rematch", { roomCode: view.roomCode }, (response) => !response.ok && setError(response.error))} type="button">{self.rematchRequested ? "재시작 동의 완료" : "같은 직업으로 다시 시작"}</button>{view.hostPlayerId === view.selfPlayerId && <button onClick={() => socket.emit("pve:return-lobby", { roomCode: view.roomCode }, (response) => !response.ok && setError(response.error))} type="button">방으로 돌아가기</button>}</div>}
            <div className={pveStyles.eventLog}>{[...visibleEvents].slice(-12).reverse().map((event) => <article key={`${view.turnNumber}-${event.id}`}><span>{event.beat} · {event.phase}</span><p>{event.message}</p></article>)}</div>
            <button className={styles.copyLog} onClick={() => { void navigator.clipboard.writeText(readableLog(view)); setCopied(true); }} type="button">{copied ? "복사 완료" : "테스트 로그 복사"}</button>
            <form className={styles.chatForm} onSubmit={submitChat}><div>{view.chatHistory.slice(-5).map((chat) => <p key={chat.id}><b>{chat.kind === "SYSTEM" ? "시스템" : chat.nickname}</b> {chat.message}</p>)}</div><label><input maxLength={100} onChange={(event) => setChatInput(event.target.value)} placeholder="파티 채팅" value={chatInput} /><button type="submit">전송</button></label></form>
          </aside>
        </section>
      </section>
    </main>
  );
}
