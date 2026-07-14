import type { AppLogger } from "../logging/logger";

export type ShutdownSignal = "SIGINT" | "SIGTERM";

type ShutdownHandlerOptions = {
  stop: () => Promise<void>;
  timeoutMs: number;
  logger: AppLogger;
  forceExit?: (exitCode: number) => void;
};

export function createShutdownHandler(options: ShutdownHandlerOptions) {
  let shutdownPromise: Promise<void> | null = null;

  return (signal: ShutdownSignal): Promise<void> => {
    if (shutdownPromise) return shutdownPromise;

    options.logger.info("server_shutdown_started", { signal });
    const forceTimer = setTimeout(() => {
      options.logger.error("server_shutdown_timeout", {
        signal,
        timeoutMs: options.timeoutMs,
      });
      options.forceExit?.(1);
    }, options.timeoutMs);
    forceTimer.unref?.();

    shutdownPromise = options
      .stop()
      .then(() => {
        options.logger.info("server_shutdown_completed", { signal });
      })
      .catch((error: unknown) => {
        options.logger.error("server_shutdown_failed", { signal, error });
        options.forceExit?.(1);
        throw error;
      })
      .finally(() => clearTimeout(forceTimer));

    return shutdownPromise;
  };
}
