import { z } from "zod";

const SocketServerUrlSchema = z
  .url("NEXT_PUBLIC_SOCKET_SERVER_URL은 올바른 URL이어야 합니다.")
  .refine((value) => ["http:", "https:"].includes(new URL(value).protocol), {
    message: "NEXT_PUBLIC_SOCKET_SERVER_URL은 http 또는 https URL이어야 합니다.",
  });

const configuredUrl = process.env.NEXT_PUBLIC_SOCKET_SERVER_URL?.trim();
const developmentFallback =
  process.env.NODE_ENV === "development" ? "http://localhost:4000" : undefined;
const result = SocketServerUrlSchema.safeParse(configuredUrl || developmentFallback);

export const SOCKET_SERVER_URL = result.success ? result.data.replace(/\/$/, "") : null;
export const USING_DEFAULT_SOCKET_URL = !configuredUrl && Boolean(developmentFallback);
export const SOCKET_CONFIGURATION_ERROR = result.success
  ? null
  : configuredUrl
    ? result.error.issues[0]?.message ?? "Socket 서버 URL이 올바르지 않습니다."
    : "운영 환경에 NEXT_PUBLIC_SOCKET_SERVER_URL이 설정되지 않았습니다.";
