type LogContext = Record<string, unknown>;

export interface AppLogger {
  info(event: string, context?: LogContext): void;
  warn(event: string, context?: LogContext): void;
  error(event: string, context?: LogContext): void;
}

const SENSITIVE_KEYS = new Set([
  "reconnecttoken",
  "token",
  "selectedaction",
  "action",
  "gamestate",
  "speedroll",
]);

function redact(value: unknown, key = ""): unknown {
  if (SENSITIVE_KEYS.has(key.toLowerCase())) return "[REDACTED]";
  if (value instanceof Error) {
    return { name: value.name, message: value.message };
  }
  if (Array.isArray(value)) return value.map((entry) => redact(entry));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        redact(entryValue, entryKey),
      ]),
    );
  }
  return value;
}

function write(level: "info" | "warn" | "error", event: string, context: LogContext): void {
  const payload = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    event,
    ...redact(context) as LogContext,
  });
  if (level === "error") console.error(payload);
  else if (level === "warn") console.warn(payload);
  else console.log(payload);
}

export function createConsoleLogger(): AppLogger {
  return {
    info: (event, context = {}) => write("info", event, context),
    warn: (event, context = {}) => write("warn", event, context),
    error: (event, context = {}) => write("error", event, context),
  };
}

export const noopLogger: AppLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export function maskRoomCode(roomCode: string): string {
  return roomCode.length <= 3
    ? "***"
    : `${roomCode.slice(0, 2)}***${roomCode.slice(-1)}`;
}

export function maskPlayerId(playerId: string): string {
  return playerId.length <= 8 ? `${playerId.slice(0, 3)}…` : `${playerId.slice(0, 8)}…`;
}
