import { createBlindTurnServer } from "./app-server";
import { parseServerEnvironment } from "./config/env";
import { createShutdownHandler } from "./lifecycle/graceful-shutdown";
import { createConsoleLogger } from "./logging/logger";

async function main(): Promise<void> {
  const logger = createConsoleLogger();

  try {
    const environment = parseServerEnvironment();
    const server = createBlindTurnServer({
      port: environment.port,
      host: "0.0.0.0",
      allowedOrigins: environment.allowedOrigins,
      logger,
    });
    const shutdown = createShutdownHandler({
      stop: server.stop,
      timeoutMs: environment.shutdownTimeoutMs,
      logger,
      forceExit: (exitCode) => process.exit(exitCode),
    });

    process.once("SIGINT", () => void shutdown("SIGINT"));
    process.once("SIGTERM", () => void shutdown("SIGTERM"));

    const address = await server.start();
    logger.info("server_started", {
      host: address.host,
      port: address.port,
      nodeEnv: environment.nodeEnv,
      allowedOriginCount: environment.allowedOrigins.length,
    });
  } catch (error) {
    logger.error("server_start_failed", { error });
    process.exitCode = 1;
  }
}

void main();
