import { z } from "zod";

const PortSchema = z.coerce
  .number<number>()
  .int("정수여야 합니다.")
  .min(1, "1 이상이어야 합니다.")
  .max(65_535, "65535 이하여야 합니다.");

const ShutdownTimeoutSchema = z.coerce
  .number<number>()
  .int()
  .min(1_000)
  .max(60_000);

export type ServerEnvironment = {
  nodeEnv: "development" | "test" | "production";
  port: number;
  allowedOrigins: string[];
  shutdownTimeoutMs: number;
};

function readFirstValue(
  environment: NodeJS.ProcessEnv,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const value = environment[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

export function parseAllowedOrigins(value: string): string[] {
  const candidates = [...new Set(
    value
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  )];

  if (candidates.length === 0) {
    throw new Error("WEB_CLIENT_ORIGIN에 하나 이상의 Origin이 필요합니다.");
  }

  return candidates.map((candidate) => {
    let url: URL;
    try {
      url = new URL(candidate);
    } catch {
      throw new Error(`WEB_CLIENT_ORIGIN에 올바르지 않은 URL이 있습니다: ${candidate}`);
    }
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      url.username ||
      url.password
    ) {
      throw new Error(
        `WEB_CLIENT_ORIGIN은 경로가 없는 http(s) Origin이어야 합니다: ${candidate}`,
      );
    }
    return url.origin;
  });
}

export function parseServerEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): ServerEnvironment {
  const nodeEnvResult = z
    .enum(["development", "test", "production"])
    .safeParse(environment.NODE_ENV ?? "development");
  if (!nodeEnvResult.success) {
    throw new Error("NODE_ENV는 development, test, production 중 하나여야 합니다.");
  }

  const portValue = readFirstValue(environment, ["PORT", "SOCKET_SERVER_PORT"])
    ?? "4000";
  const portResult = PortSchema.safeParse(portValue);
  if (!portResult.success) {
    throw new Error(`PORT가 올바르지 않습니다: ${portResult.error.issues[0]?.message}`);
  }

  const originValue = environment.WEB_CLIENT_ORIGIN?.trim()
    || (nodeEnvResult.data === "production" ? undefined : "http://localhost:3000");
  if (!originValue) {
    throw new Error("production에서는 WEB_CLIENT_ORIGIN이 필요합니다.");
  }

  const shutdownResult = ShutdownTimeoutSchema.safeParse(
    environment.SHUTDOWN_TIMEOUT_MS ?? "10000",
  );
  if (!shutdownResult.success) {
    throw new Error("SHUTDOWN_TIMEOUT_MS는 1000~60000 사이의 정수여야 합니다.");
  }

  return {
    nodeEnv: nodeEnvResult.data,
    port: portResult.data,
    allowedOrigins: parseAllowedOrigins(originValue),
    shutdownTimeoutMs: shutdownResult.data,
  };
}
