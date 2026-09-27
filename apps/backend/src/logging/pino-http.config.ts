import { Params } from "nestjs-pino";

export const SENSITIVE_HTTP_LOG_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  'req.headers["proxy-authorization"]',
  'req.headers["x-api-key"]',
  'req.headers["x-auth-token"]',
  'res.headers["set-cookie"]',
] as const;

export function createPinoHttpConfig(): NonNullable<Params["pinoHttp"]> {
  return {
    transport:
      process.env.NODE_ENV !== "production"
        ? { target: "pino-pretty" }
        : undefined,
    level: process.env.NODE_ENV !== "production" ? "debug" : "info",
    redact: {
      paths: [...SENSITIVE_HTTP_LOG_PATHS],
      censor: "[REDACTED]",
    },
  };
}
