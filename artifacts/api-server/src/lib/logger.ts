import pino from "pino";

const isProduction = process.env["NODE_ENV"] === "production";

export const logger = pino({
  level: process.env["LOG_LEVEL"] ?? (isProduction ? "info" : "debug"),
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "res.headers['set-cookie']",
      "req.headers['x-api-key']",
      "req.headers['x-admin-key']",
      "req.body.privateKeyHex",
      "req.body.mnemonic",
      "req.body.seed",
      "req.body.privateKey",
      "*.privateKeyHex",
      "*.mnemonic",
      "*.privateKey",
      "*.seed",
      "mnemonic",
    ],
    censor: "[REDACTED]",
  },
  serializers: {
    err: pino.stdSerializers.err,
  },
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, ignore: "pid,hostname" },
        },
      }),
});

export function auditLog(
  action: string,
  actor: string,
  target: string,
  meta?: Record<string, unknown>
): void {
  logger.info({ audit: true, action, actor, target, ...meta }, `AUDIT: ${action}`);
}
