import rateLimit from "express-rate-limit";
import { Request, Response } from "express";
import { logger } from "../lib/logger.js";
import { blacklistIPSync, requestFingerprint } from "./security.js";
import { checkRateLimit } from "../lib/redis.js";

const isProd = process.env["NODE_ENV"] === "production";

// ─── Violation tracker ───────────────────────────────────────────────────────

const violationMap = new Map<string, { count: number; firstAt: number }>();
const VIOLATION_WINDOW_MS = 10 * 60 * 1000;
const AUTO_BLACKLIST_THRESHOLD = 15;

function trackViolation(ip: string, endpoint: string): void {
  const now = Date.now();
  const entry = violationMap.get(ip);
  if (!entry || now - entry.firstAt > VIOLATION_WINDOW_MS) {
    violationMap.set(ip, { count: 1, firstAt: now });
    return;
  }
  entry.count++;
  if (entry.count >= AUTO_BLACKLIST_THRESHOLD) {
    blacklistIPSync(ip, `auto_blacklist:repeated_violations:${endpoint}`);
    violationMap.delete(ip);
  }
}

setInterval(() => {
  const now = Date.now();
  for (const [k, e] of violationMap) if (now - e.firstAt > VIOLATION_WINDOW_MS) violationMap.delete(k);
}, 5 * 60 * 1000);

function logAbuse(req: Request, endpoint: string) {
  const ip = req.ip ?? "unknown";
  logger.warn({ ip, path: req.path, method: req.method, ua: req.headers["user-agent"], fp: requestFingerprint(req) }, `Rate limit exceeded [${endpoint}]`);
  trackViolation(ip, endpoint);
}

function compositeKey(req: Request): string {
  return (req.ip ?? "unknown") + "|" + requestFingerprint(req);
}

// ─── Distributed rate limit middleware factory ────────────────────────────────
// Uses Redis when available (shared across all nodes/workers), falls back to memory.

export function makeDistributedRateLimit(opts: {
  name: string;
  windowMs: number;
  max: number;
  keyFn?: (req: Request) => string;
  message?: string;
}) {
  const { name, windowMs, max, keyFn = compositeKey, message = "Terlalu banyak request" } = opts;
  return async (req: Request, res: Response, next: (err?: unknown) => void): Promise<void> => {
    const key = `${name}:${keyFn(req)}`;
    try {
      const result = await checkRateLimit(key, max, windowMs);
      res.setHeader("X-RateLimit-Limit", max);
      res.setHeader("X-RateLimit-Remaining", result.remaining);
      res.setHeader("X-RateLimit-Reset", Math.ceil(result.resetAt / 1000));

      if (!result.allowed) {
        logAbuse(req, name);
        res.status(429).json({ error: message, retryAfter: `${Math.ceil(windowMs / 60000)} menit` });
        return;
      }
      next();
    } catch {
      next();
    }
  };
}

// ─── Global rate limit ────────────────────────────────────────────────────────

export const globalRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isProd ? 3_000 : 500,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  validate: { xForwardedForHeader: false, ip: false, keyGeneratorIpFallback: false },
  keyGenerator: compositeKey,
  handler: (req, res) => {
    logAbuse(req, "global");
    res.status(429).json({ error: "Terlalu banyak request", retryAfter: "15 menit" });
  },
  skip: (req) =>
    req.path === "/api/healthz" || req.path === "/api/healthz/live" || req.path === "/api/healthz/ready",
});

// ─── Endpoint-specific distributed limiters ───────────────────────────────────

export const strictRateLimit = makeDistributedRateLimit({
  name: "strict",
  windowMs: 60_000,
  max: isProd ? 60 : 30,
  message: "Terlalu banyak request ke endpoint ini",
});

export const miningRateLimit = makeDistributedRateLimit({
  name: "mining",
  windowMs: 60_000,
  max: isProd ? 5 : 10,
  keyFn: (req) => req.ip ?? "unknown",
  message: "Rate limit mining: maksimal 5 permintaan per menit",
});

export const walletRateLimit = makeDistributedRateLimit({
  name: "wallet",
  windowMs: 60_000,
  max: isProd ? 20 : 30,
  message: "Rate limit wallet: maksimal 20 permintaan per menit",
});

export const sendTxRateLimit = makeDistributedRateLimit({
  name: "send_tx",
  windowMs: 60_000,
  max: isProd ? 30 : 20,
  keyFn: (req) => {
    const body = req.body as { from?: string } | undefined;
    return `${req.ip ?? "unknown"}|${body?.from ?? ""}`;
  },
  message: "Terlalu banyak transaksi dari alamat atau IP ini",
});

export const p2pRateLimit = makeDistributedRateLimit({
  name: "p2p",
  windowMs: 60_000,
  max: isProd ? 10 : 5,
  keyFn: (req) => req.ip ?? "unknown",
  message: "Rate limit P2P: terlalu banyak koneksi peer",
});

export const searchRateLimit = makeDistributedRateLimit({
  name: "search",
  windowMs: 60_000,
  max: isProd ? 120 : 60,
  message: "Terlalu banyak pencarian",
});

export const contractDeployRateLimit = makeDistributedRateLimit({
  name: "contract_deploy",
  windowMs: 5 * 60_000,
  max: isProd ? 10 : 20,
  message: "Rate limit deploy kontrak: maksimal 10 per 5 menit",
});

export const nftMintRateLimit = makeDistributedRateLimit({
  name: "nft_mint",
  windowMs: 60_000,
  max: isProd ? 20 : 30,
  message: "Rate limit mint NFT: maksimal 20 per menit",
});
