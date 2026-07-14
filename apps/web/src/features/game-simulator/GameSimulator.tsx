"use client";

import {
  CreatePlayersSchema,
  ManualRollListSchema,
  MAX_HP,
  PlayerActionSchema,
  ProductionRandomSource,
  SequenceRandomSource,
  createGame,
  formatHp,
  resolveTurn,
  startTurn,
  submitAction,
  type BattleEvent,
  type GameState,
  type PlayerAction,
  type PlayerActionType,
  type PlayerState,
  type RandomSource,
} from "@blind-turn/shared";
import { useEffect, useMemo, useRef, useState } from "react";

type ActionDraft = {
  type: PlayerActionType;
  targetPlayerId: string;
};

type LogEntry = {
  id: number;
  turn: number;
  event: BattleEvent;
};

const DEFAULT_NAMES = ["레이븐", "노바", "에코", "미라", "제로", "루멘"];

const ACTIONS: Array<{
  type: PlayerActionType;
  label: string;
  hint: string;
}> = [
  { type: "ATTACK", label: "공격", hint: "대상에게 5 피해" },
  { type: "DEFEND", label: "수비", hint: "활성화 후 피해 50% 감소" },
  { type: "EVADE", label: "회피", hint: "속도와 주사위로 판정" },
  { type: "COUNTER", label: "반격", hint: "지정 공격자에게 반격" },
];

const PHASE_LABEL: Record<GameState["phase"], string> = {
  WAITING: "턴 준비",
  ROLLING_SPEED: "속도 판정",
  SELECTING_ACTION: "행동 선택",
  RESOLVING: "전투 판정",
  FINISHED: "게임 종료",
};

const ACTION_LABEL: Record<PlayerActionType, string> = {
  ATTACK: "공격",
  DEFEND: "수비",
  EVADE: "회피",
  COUNTER: "반격",
  PASS: "대기",
};

function parseRolls(value: string): number[] {
  if (!value.trim()) return [];
  const numbers = value
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number);
  const result = ManualRollListSchema.safeParse(numbers);
  if (!result.success) {
    throw new Error("주사위 값은 1~10 사이의 정수를 쉼표로 입력하세요.");
  }
  return result.data;
}

function makeTurnDrafts(state: GameState): Record<string, ActionDraft> {
  return Object.fromEntries(
    state.players
      .filter((player) => player.alive)
      .map((player) => {
        const target = state.players.find(
          (candidate) => candidate.alive && candidate.id !== player.id,
        );
        return [
          player.id,
          { type: "ATTACK", targetPlayerId: target?.id ?? "" } satisfies ActionDraft,
        ];
      }),
  );
}

function toPlayerAction(draft: ActionDraft): PlayerAction {
  if (draft.type === "ATTACK" || draft.type === "COUNTER") {
    return PlayerActionSchema.parse({
      type: draft.type,
      targetPlayerId: draft.targetPlayerId,
    });
  }
  return PlayerActionSchema.parse({ type: draft.type });
}

function playerName(state: GameState, playerId: string): string {
  return state.players.find((player) => player.id === playerId)?.nickname ?? playerId;
}

function eventDescription(event: BattleEvent, state: GameState): string {
  const name = (id: string) => playerName(state, id);
  switch (event.type) {
    case "TURN_STARTED":
      return `${event.turnNumber}턴이 시작되었습니다.`;
    case "SPEED_ROLLED":
      return `${name(event.playerId)}의 속도는 ${event.speed}입니다.`;
    case "ACTION_STARTED":
      return `${name(event.playerId)} · ${ACTION_LABEL[event.actionType]} 행동 시작`;
    case "ATTACK_STARTED":
      return `${name(event.attackerId)} → ${name(event.targetId)} 공격`;
    case "CLASH_STARTED":
      return `${name(event.playerIds[0])}와 ${name(event.playerIds[1])}의 합 발생`;
    case "CLASH_ROLLED":
      return `${name(event.playerId)}의 합 주사위 · ${event.roll}`;
    case "CLASH_RESOLVED":
      return `${name(event.winnerId)} 승리 · ${name(event.loserId)} 패배`;
    case "DEFENSE_ACTIVATED":
      return `${name(event.playerId)}의 수비가 활성화되었습니다.`;
    case "EVADE_ACTIVATED":
      return `${name(event.playerId)}의 회피가 활성화되었습니다.`;
    case "EVADE_ROLLED":
      return `${name(event.playerId)} 회피 ${event.roll} vs ${name(event.attackerId)} 속도 ${event.attackerSpeed}`;
    case "EVADE_SUCCEEDED":
      return `${name(event.playerId)}가 공격을 회피했습니다.`;
    case "EVADE_FAILED":
      return `${name(event.playerId)}의 회피 실패 · 최종 피해 10`;
    case "COUNTER_ACTIVATED":
      return `${name(event.playerId)}가 ${name(event.targetPlayerId)}을(를) 주시합니다.`;
    case "COUNTER_TRIGGERED":
      return `${name(event.counterPlayerId)}의 반격이 ${name(event.attackerId)}에게 적중했습니다.`;
    case "EXPOSED_ATTACK":
      return `${name(event.targetId)}의 허점을 ${name(event.attackerId)}가 포착했습니다.`;
    case "DAMAGE_APPLIED":
      return `${name(event.playerId)} · ${formatHp(event.damage)} 피해 / HP ${formatHp(event.remainingHp)}`;
    case "ACTION_SKIPPED": {
      const reason = {
        DEAD: "이미 사망",
        TARGET_DEAD: "대상 사망",
        ACTION_ALREADY_CONSUMED: "합으로 행동 소모",
      }[event.reason];
      return `${name(event.playerId)}의 행동 취소 · ${reason}`;
    }
    case "PLAYER_DIED":
      return `${name(event.playerId)} 전투 불능`;
    case "GAME_FINISHED":
      return event.result.type === "DRAW"
        ? "모든 플레이어가 쓰러졌습니다. 무승부입니다."
        : `${name(event.result.winnerPlayerId)} 최종 승리`;
  }
}

function eventTone(event: BattleEvent): "neutral" | "accent" | "danger" | "success" {
  switch (event.type) {
    case "PLAYER_DIED":
    case "EVADE_FAILED":
      return "danger";
    case "GAME_FINISHED":
    case "EVADE_SUCCEEDED":
      return "success";
    case "DAMAGE_APPLIED":
    case "COUNTER_TRIGGERED":
    case "EXPOSED_ATTACK":
    case "CLASH_RESOLVED":
      return "accent";
    default:
      return "neutral";
  }
}

export function GameSimulator() {
  const [playerCount, setPlayerCount] = useState(3);
  const [nicknames, setNicknames] = useState(DEFAULT_NAMES);
  const [game, setGame] = useState<GameState | null>(null);
  const [drafts, setDrafts] = useState<Record<string, ActionDraft>>({});
  const [visibilityMode, setVisibilityMode] = useState<"all" | "single">("all");
  const [viewerId, setViewerId] = useState("player-1");
  const [manualRolls, setManualRolls] = useState(false);
  const [speedRolls, setSpeedRolls] = useState("");
  const [clashRolls, setClashRolls] = useState("");
  const [evadeRolls, setEvadeRolls] = useState("");
  const [eventLog, setEventLog] = useState<LogEntry[]>([]);
  const [isReplaying, setIsReplaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timersRef = useRef<number[]>([]);
  const logIdRef = useRef(0);
  const logEndRef = useRef<HTMLDivElement | null>(null);

  const alivePlayers = useMemo(
    () => game?.players.filter((player) => player.alive) ?? [],
    [game],
  );

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [eventLog]);

  useEffect(() => {
    return () => timersRef.current.forEach((timer) => window.clearTimeout(timer));
  }, []);

  function clearReplay(): void {
    timersRef.current.forEach((timer) => window.clearTimeout(timer));
    timersRef.current = [];
    setIsReplaying(false);
  }

  function replayEvents(events: BattleEvent[], turn: number): void {
    clearReplay();
    if (events.length === 0) return;
    setIsReplaying(true);
    events.forEach((event, index) => {
      const timer = window.setTimeout(() => {
        logIdRef.current += 1;
        setEventLog((current) => [
          ...current,
          { id: logIdRef.current, turn, event },
        ]);
        if (index === events.length - 1) setIsReplaying(false);
      }, index * 130);
      timersRef.current.push(timer);
    });
  }

  function handleCreateGame(): void {
    setError(null);
    const inputs = Array.from({ length: playerCount }, (_, index) => ({
      id: `player-${index + 1}`,
      nickname: nicknames[index] ?? "",
      seatNumber: index + 1,
    }));
    const parsed = CreatePlayersSchema.safeParse(inputs);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "플레이어 정보를 확인하세요.");
      return;
    }
    try {
      const created = createGame(parsed.data);
      setGame(created);
      setViewerId(created.players[0]!.id);
      setDrafts({});
      setEventLog([]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "게임을 만들지 못했습니다.");
    }
  }

  function randomForSpeed(): RandomSource {
    if (!manualRolls) return new ProductionRandomSource();
    return new SequenceRandomSource(
      { SPEED: parseRolls(speedRolls) },
      new ProductionRandomSource(),
    );
  }

  function randomForCombat(): RandomSource {
    if (!manualRolls) return new ProductionRandomSource();
    return new SequenceRandomSource(
      {
        CLASH: parseRolls(clashRolls),
        EVADE: parseRolls(evadeRolls),
      },
      new ProductionRandomSource(),
    );
  }

  function handleStartTurn(): void {
    if (!game || isReplaying) return;
    setError(null);
    try {
      const started = startTurn(game, randomForSpeed());
      setGame(started);
      setDrafts(makeTurnDrafts(started));
      const nextViewer = started.players.find(
        (player) => player.alive && player.id === viewerId,
      );
      if (!nextViewer) setViewerId(started.actionOrder[0] ?? "");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "턴을 시작하지 못했습니다.");
    }
  }

  function updateDraftType(player: PlayerState, type: PlayerActionType): void {
    const target = game?.players.find(
      (candidate) => candidate.alive && candidate.id !== player.id,
    );
    setDrafts((current) => ({
      ...current,
      [player.id]: {
        type,
        targetPlayerId: current[player.id]?.targetPlayerId || target?.id || "",
      },
    }));
  }

  function updateDraftTarget(playerId: string, targetPlayerId: string): void {
    setDrafts((current) => {
      const draft = current[playerId];
      return draft
        ? { ...current, [playerId]: { ...draft, targetPlayerId } }
        : current;
    });
  }

  function handleResolveTurn(): void {
    if (!game || game.phase !== "SELECTING_ACTION" || isReplaying) return;
    setError(null);
    try {
      let submitted = game;
      for (const player of game.players.filter((candidate) => candidate.alive)) {
        const draft = drafts[player.id];
        if (!draft) throw new Error(`${player.nickname}의 행동을 선택하세요.`);
        submitted = submitAction(submitted, player.id, toPlayerAction(draft));
      }
      const resolved = resolveTurn(submitted, randomForCombat());
      setGame(resolved.state);
      setDrafts({});
      replayEvents(resolved.events, resolved.state.turnNumber);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "턴 판정에 실패했습니다.");
    }
  }

  function handleReset(): void {
    clearReplay();
    setGame(null);
    setDrafts({});
    setEventLog([]);
    setError(null);
    logIdRef.current = 0;
  }

  function speedText(player: PlayerState): string {
    if (!player.alive) return "—";
    if (player.speedRoll === null) return "대기";
    if (visibilityMode === "single" && player.id !== viewerId) return "비공개";
    return String(player.speedRoll);
  }

  const canResolve =
    game?.phase === "SELECTING_ACTION" &&
    alivePlayers.every((player) => Boolean(drafts[player.id])) &&
    !isReplaying;

  return (
    <main className="appShell">
      <div className="ambientGrid" aria-hidden="true" />
      <header className="siteHeader">
        <div className="brandLockup" aria-label="BLIND TURN">
          <span className="brandMark">BT</span>
          <span className="brandWords">
            <strong>BLIND TURN</strong>
            <small>LOCAL BATTLE LAB</small>
          </span>
        </div>
        <div className="headerMeta">
          <span className="liveDot" />
          PURE ENGINE / LOCAL SESSION
        </div>
        {game ? (
          <button className="ghostButton" type="button" onClick={handleReset}>
            게임 초기화
          </button>
        ) : null}
      </header>

      {error ? (
        <div className="errorBanner" role="alert">
          <span>!</span>
          {error}
        </div>
      ) : null}

      {!game ? (
        <section className="setupLayout">
          <div className="introBlock">
            <p className="eyebrow">TURN-BASED PSYCHOLOGICAL COMBAT</p>
            <h1>
              먼저 움직이고,
              <br />
              <em>끝까지 읽어라.</em>
            </h1>
            <p className="introCopy">
              속도, 시선, 선택. 세 가지 정보만으로 전장을 해석하는 2~6인
              로컬 전투 시뮬레이터입니다.
            </p>
            <div className="ruleStrip">
              <span><b>01</b> 속도 판정</span>
              <span><b>02</b> 행동 잠금</span>
              <span><b>03</b> 순차 해결</span>
            </div>
          </div>

          <div className="setupCard">
            <div className="sectionHeading">
              <div>
                <p className="eyebrow">SESSION SETUP</p>
                <h2>전투 참가자</h2>
              </div>
              <div className="countStepper" aria-label="플레이어 수">
                <button
                  type="button"
                  onClick={() => setPlayerCount((count) => Math.max(2, count - 1))}
                  disabled={playerCount === 2}
                  aria-label="플레이어 한 명 줄이기"
                >
                  −
                </button>
                <strong>{playerCount}</strong>
                <button
                  type="button"
                  onClick={() => setPlayerCount((count) => Math.min(6, count + 1))}
                  disabled={playerCount === 6}
                  aria-label="플레이어 한 명 늘리기"
                >
                  +
                </button>
              </div>
            </div>

            <div className="nicknameList">
              {Array.from({ length: playerCount }, (_, index) => (
                <label className="nicknameField" key={index}>
                  <span>SEAT {String(index + 1).padStart(2, "0")}</span>
                  <input
                    value={nicknames[index] ?? ""}
                    maxLength={20}
                    onChange={(event) => {
                      const next = [...nicknames];
                      next[index] = event.target.value;
                      setNicknames(next);
                    }}
                    placeholder={`플레이어 ${index + 1}`}
                  />
                </label>
              ))}
            </div>

            <button className="primaryButton fullWidth" type="button" onClick={handleCreateGame}>
              로컬 게임 생성
              <span>→</span>
            </button>
            <p className="setupNote">네트워크 연결 없이 이 기기에서만 실행됩니다.</p>
          </div>
        </section>
      ) : (
        <section className="battlePage">
          <div className="battleHeader">
            <div>
              <p className="eyebrow">BATTLE CONTROL</p>
              <h1>턴 {game.turnNumber || "준비"}</h1>
            </div>
            <div className="battleStats">
              <div><span>PHASE</span><strong>{PHASE_LABEL[game.phase]}</strong></div>
              <div><span>ALIVE</span><strong>{alivePlayers.length} / {game.players.length}</strong></div>
              <div><span>EVENTS</span><strong>{eventLog.length}</strong></div>
            </div>
          </div>

          {game.result ? (
            <div className="resultBanner">
              <p>FINAL RESULT</p>
              <h2>
                {game.result.type === "DRAW"
                  ? "무승부"
                  : `${playerName(game, game.result.winnerPlayerId)} 승리`}
              </h2>
              <button type="button" className="lightButton" onClick={handleReset}>
                새 게임 시작
              </button>
            </div>
          ) : null}

          <div className="controlBar">
            <div className="visibilityControl">
              <span>속도 공개</span>
              <div className="segmentControl">
                <button
                  type="button"
                  className={visibilityMode === "all" ? "active" : ""}
                  onClick={() => setVisibilityMode("all")}
                >
                  전체
                </button>
                <button
                  type="button"
                  className={visibilityMode === "single" ? "active" : ""}
                  onClick={() => setVisibilityMode("single")}
                >
                  개별
                </button>
              </div>
              {visibilityMode === "single" ? (
                <select value={viewerId} onChange={(event) => setViewerId(event.target.value)}>
                  {alivePlayers.map((player) => (
                    <option key={player.id} value={player.id}>{player.nickname} 시점</option>
                  ))}
                </select>
              ) : null}
            </div>
            <div className="orderLine">
              <span>ACTION ORDER</span>
              <div>
                {game.actionOrder.length > 0
                  ? game.actionOrder.map((id, index) => (
                      <span key={id}>
                        <b>{index + 1}</b>{playerName(game, id)}
                      </span>
                    ))
                  : <em>턴 시작 후 확정</em>}
              </div>
            </div>
          </div>

          <div className="battleGrid">
            <div className="arenaColumn">
              <div className="playerGrid">
                {game.players.map((player) => {
                  const draft = drafts[player.id];
                  const targetOptions = game.players.filter(
                    (candidate) => candidate.alive && candidate.id !== player.id,
                  );
                  return (
                    <article
                      className={`playerCard ${player.alive ? "" : "dead"}`}
                      key={player.id}
                    >
                      <div className="playerTopline">
                        <span className="seatBadge">{String(player.seatNumber).padStart(2, "0")}</span>
                        <div className="playerIdentity">
                          <h3>{player.nickname}</h3>
                          <span className={player.alive ? "statusAlive" : "statusDead"}>
                            {player.alive ? "ACTIVE" : "DOWN"}
                          </span>
                        </div>
                        <div className="speedReadout">
                          <small>SPD</small>
                          <strong>{speedText(player)}</strong>
                        </div>
                      </div>

                      <div className="hpRow">
                        <div className="hpCopy"><span>HP</span><strong>{formatHp(player.hp)}<small>/30</small></strong></div>
                        <div className="hpTrack" aria-label={`체력 ${formatHp(player.hp)} / 30`}>
                          <span style={{ width: `${(player.hp / MAX_HP) * 100}%` }} />
                        </div>
                      </div>

                      {game.phase === "SELECTING_ACTION" && player.alive && draft ? (
                        <div className="actionPanel">
                          <div className="actionButtons" role="group" aria-label={`${player.nickname} 행동`}>
                            {ACTIONS.map((action) => {
                              const counterLocked =
                                action.type === "COUNTER" &&
                                player.previousTurnActionType === "COUNTER";
                              return (
                                <button
                                  type="button"
                                  key={action.type}
                                  className={draft.type === action.type ? "selected" : ""}
                                  disabled={counterLocked}
                                  title={counterLocked ? "지난 턴에 반격을 선택했습니다." : action.hint}
                                  aria-pressed={draft.type === action.type}
                                  onClick={() => updateDraftType(player, action.type)}
                                >
                                  {action.label}
                                </button>
                              );
                            })}
                          </div>
                          {draft.type === "ATTACK" || draft.type === "COUNTER" ? (
                            <label className="targetField">
                              <span>{draft.type === "ATTACK" ? "공격 대상" : "반격 대상"}</span>
                              <select
                                value={draft.targetPlayerId}
                                onChange={(event) => updateDraftTarget(player.id, event.target.value)}
                              >
                                {targetOptions.map((target) => (
                                  <option key={target.id} value={target.id}>
                                    SEAT {target.seatNumber} · {target.nickname}
                                  </option>
                                ))}
                              </select>
                            </label>
                          ) : (
                            <p className="actionHint">
                              {ACTIONS.find((action) => action.type === draft.type)?.hint}
                            </p>
                          )}
                        </div>
                      ) : (
                        <div className="lastAction">
                          <span>LAST ACTION</span>
                          <strong>
                            {player.selectedAction
                              ? ACTION_LABEL[player.selectedAction.type]
                              : "—"}
                          </strong>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>

              <div className="turnCommand">
                <div>
                  <span className="commandIndex">{game.phase === "WAITING" ? "01" : "02"}</span>
                  <div>
                    <h3>
                      {game.phase === "WAITING"
                        ? `${game.turnNumber + 1}턴을 준비하세요`
                        : game.phase === "SELECTING_ACTION"
                          ? "모든 행동을 잠그고 판정합니다"
                          : "전투가 종료되었습니다"}
                    </h3>
                    <p>
                      {game.phase === "WAITING"
                        ? "속도 주사위를 굴리고 행동 순서를 확정합니다."
                        : "선택 후에는 판정이 끝날 때까지 변경할 수 없습니다."}
                    </p>
                  </div>
                </div>
                {game.phase === "WAITING" ? (
                  <button
                    type="button"
                    className="primaryButton"
                    onClick={handleStartTurn}
                    disabled={isReplaying}
                  >
                    {isReplaying ? "로그 재생 중" : `${game.turnNumber + 1}턴 시작`}
                    <span>→</span>
                  </button>
                ) : game.phase === "SELECTING_ACTION" ? (
                  <button
                    type="button"
                    className="primaryButton dangerButton"
                    onClick={handleResolveTurn}
                    disabled={!canResolve}
                  >
                    행동 제출 · 턴 실행
                    <span>▶</span>
                  </button>
                ) : null}
              </div>

              <details className="debugPanel">
                <summary>
                  <span><b>DEBUG</b> 수동 주사위 제어</span>
                  <em>개발 테스트 전용</em>
                </summary>
                <div className="debugBody">
                  <label className="toggleRow">
                    <span>
                      <strong>수동 입력 사용</strong>
                      <small>비어 있는 값은 자동 주사위로 보충됩니다.</small>
                    </span>
                    <input
                      type="checkbox"
                      checked={manualRolls}
                      onChange={(event) => setManualRolls(event.target.checked)}
                    />
                  </label>
                  <div className="debugFields">
                    <label>
                      <span>속도 주사위</span>
                      <input
                        value={speedRolls}
                        onChange={(event) => setSpeedRolls(event.target.value)}
                        placeholder="예: 9, 7, 8"
                        disabled={!manualRolls}
                      />
                      <small>생존 좌석 순서</small>
                    </label>
                    <label>
                      <span>합 주사위</span>
                      <input
                        value={clashRolls}
                        onChange={(event) => setClashRolls(event.target.value)}
                        placeholder="예: 8, 5"
                        disabled={!manualRolls}
                      />
                      <small>판정 발생 순서</small>
                    </label>
                    <label>
                      <span>회피 주사위</span>
                      <input
                        value={evadeRolls}
                        onChange={(event) => setEvadeRolls(event.target.value)}
                        placeholder="예: 8, 9, 3"
                        disabled={!manualRolls}
                      />
                      <small>공격받는 순서</small>
                    </label>
                  </div>
                </div>
              </details>
            </div>

            <aside className="eventPanel">
              <div className="eventHeader">
                <div>
                  <p className="eyebrow">LIVE FEED</p>
                  <h2>전투 이벤트</h2>
                </div>
                <span className={isReplaying ? "feedStatus active" : "feedStatus"}>
                  {isReplaying ? "PLAYING" : "READY"}
                </span>
              </div>
              <div className="eventList" aria-live="polite">
                {eventLog.length === 0 ? (
                  <div className="emptyLog">
                    <span>∅</span>
                    <h3>아직 기록이 없습니다</h3>
                    <p>턴을 실행하면 판정 이벤트가 시간순으로 표시됩니다.</p>
                  </div>
                ) : (
                  eventLog.map((entry, index) => {
                    const beginsTurn =
                      index === 0 || eventLog[index - 1]?.turn !== entry.turn;
                    return (
                      <div key={entry.id}>
                        {beginsTurn ? <div className="turnDivider"><span>TURN {entry.turn}</span></div> : null}
                        <div className={`eventItem ${eventTone(entry.event)}`}>
                          <span className="eventNumber">{String(index + 1).padStart(2, "0")}</span>
                          <div>
                            <small>{entry.event.type.replaceAll("_", " ")}</small>
                            <p>{eventDescription(entry.event, game)}</p>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={logEndRef} />
              </div>
            </aside>
          </div>
        </section>
      )}
    </main>
  );
}
