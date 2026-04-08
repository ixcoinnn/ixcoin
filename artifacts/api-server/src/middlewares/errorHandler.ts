import { Request, Response, NextFunction } from "express";
import { logger } from "../lib/logger.js";

// ─── 404 handler ─────────────────────────────────────────────────────────────

export function notFoundHandler(_req: Request, res: Response): void {
  // Don't leak the path — it reveals API surface and helps attackers enumerate
  res.status(404).json({ error: "Endpoint tidak ditemukan" });
}

// ─── Global error handler ─────────────────────────────────────────────────────

export function globalErrorHandler(
  err: Error & { status?: number; statusCode?: number; code?: string },
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const status = err.status ?? err.statusCode ?? 500;
  const isOperational = status < 500;
  const isProduction = process.env["NODE_ENV"] === "production";

  if (!isOperational) {
    logger.error(
      {
        err: {
          message: err.message,
          name: err.name,
          code: err.code,
          // Never expose stack trace in production
          stack: !isProduction ? err.stack : undefined,
        },
        req: {
          method: req.method,
          // Scrub path in production to not leak internal structure
          path: !isProduction ? req.path : undefined,
          ip: req.ip,
        },
      },
      "Unhandled server error"
    );
  } else {
    req.log?.warn({ errMessage: err.message }, "Client error");
  }

  if (res.headersSent) return;

  res.status(status).json({
    error: isOperational
      ? err.message
      : "Terjadi kesalahan server internal",
    // Only expose detail in development, never in production
    ...(!isProduction && !isOperational ? { detail: err.message } : {}),
  });
}

// ─── Async handler wrapper ────────────────────────────────────────────────────

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// ─── Promise timeout race ─────────────────────────────────────────────────────

export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]);
}
