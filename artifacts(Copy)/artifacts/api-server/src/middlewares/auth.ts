import { Request, Response, NextFunction } from "express";
import { timingSafeEqual, createHmac, randomBytes } from "crypto";
import { logger } from "../lib/logger.js";
import { blacklistIP } from "./security.js";

const API_KEY = process.env["API_KEY"];
const ADMIN_KEY = process.env["ADMIN_KEY"];

// ─── Auth failure tracker (auto-blacklist brute-forcers) ─────────────────────

const authFailMap = new Map<string, { count: number; firstAt: number }>();
const AUTH_FAIL_WINDOW_MS = 5 * 60 * 1000;
const AUTH_FAIL_THRESHOLD = 20;

function trackAuthFailure(ip: string, type: string): void {
  const now = Date.now();
  const entry = authFailMap.get(ip);

  if (!entry || now - entry.firstAt > AUTH_FAIL_WINDOW_MS) {
    authFailMap.set(ip, { count: 1, firstAt: now });
    return;
  }

  entry.count++;
  if (entry.count >= AUTH_FAIL_THRESHOLD) {
    blacklistIP(ip, `brute_force:${type}`);
    authFailMap.delete(ip);
  }
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of authFailMap) {
    if (now - entry.firstAt > AUTH_FAIL_WINDOW_MS) authFailMap.delete(key);
  }
}, 5 * 60 * 1000);

// ─── Safe string comparison (constant time) ──────────────────────────────────

function safeCompare(a: string, b: string): boolean {
  try {
    // Pad both to same length using a random nonce to prevent length oracle
    const nonce = randomBytes(8).toString("hex");
    const aNonce = a + nonce;
    const bNonce = b + nonce;
    const bufA = Buffer.from(aNonce);
    const bufB = Buffer.from(bNonce);
    if (bufA.length !== bufB.length) {
      // Lengths differ — still do dummy comparison to avoid timing leak
      timingSafeEqual(Buffer.alloc(1), Buffer.alloc(1));
      return false;
    }
    return timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

// ─── HMAC request signing ────────────────────────────────────────────────────

function generateRequestSignature(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

// ─── API Key auth (header only — never query string) ─────────────────────────

export function apiKeyAuth(req: Request, res: Response, next: NextFunction): void {
  if (!API_KEY) {
    next();
    return;
  }

  // SECURITY: Only accept from X-API-Key header — NOT from query params
  // Query params appear in server logs, browser history, and CDN caches
  const key = req.headers["x-api-key"] as string | undefined;

  if (!key || !safeCompare(key, API_KEY)) {
    const ip = req.ip ?? "unknown";
    trackAuthFailure(ip, "api_key");
    logger.warn({ ip, path: req.path, method: req.method }, "Unauthorized API access");
    // Add delay to slow down brute force without revealing valid key length
    setTimeout(() => {
      if (!res.headersSent) {
        res.status(401).json({ error: "Unauthorized" });
      }
    }, 100 + Math.random() * 100);
    return;
  }
  next();
}

// ─── Admin key auth (header only) ────────────────────────────────────────────

export function adminAuth(req: Request, res: Response, next: NextFunction): void {
  if (!ADMIN_KEY) {
    next();
    return;
  }

  const key = req.headers["x-admin-key"] as string | undefined;
  if (!key || !safeCompare(key, ADMIN_KEY)) {
    const ip = req.ip ?? "unknown";
    trackAuthFailure(ip, "admin_key");
    logger.warn({ ip, path: req.path }, "Unauthorized admin access attempt");
    setTimeout(() => {
      if (!res.headersSent) {
        res.status(403).json({ error: "Forbidden" });
      }
    }, 200 + Math.random() * 200);
    return;
  }
  next();
}

// ─── Optional auth ────────────────────────────────────────────────────────────

export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!API_KEY) {
    next();
    return;
  }
  const key = req.headers["x-api-key"] as string | undefined;
  if (key && safeCompare(key, API_KEY)) {
    (req as Request & { authenticated?: boolean }).authenticated = true;
  }
  next();
}

// ─── HMAC signature verification ─────────────────────────────────────────────

export function hmacSignatureVerify(secret: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const signature = req.headers["x-signature"] as string | undefined;
    const timestamp = req.headers["x-timestamp"] as string | undefined;

    if (!signature || !timestamp) {
      res.status(401).json({ error: "Signature dan timestamp diperlukan" });
      return;
    }

    const now = Date.now();
    const reqTime = parseInt(timestamp, 10);
    if (isNaN(reqTime) || Math.abs(now - reqTime) > 5 * 60 * 1000) {
      res.status(401).json({ error: "Request timestamp kedaluwarsa (maks 5 menit)" });
      return;
    }

    if (!signature.match(/^[0-9a-f]{64}$/)) {
      res.status(401).json({ error: "Format signature tidak valid" });
      return;
    }

    const payload = `${timestamp}.${JSON.stringify(req.body)}`;
    const expected = generateRequestSignature(payload, secret);

    if (!safeCompare(signature, expected)) {
      logger.warn({ ip: req.ip, path: req.path }, "Invalid HMAC signature");
      res.status(401).json({ error: "Signature tidak valid" });
      return;
    }

    next();
  };
}
