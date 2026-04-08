import Redis from "ioredis";
import { logger } from "./logger.js";

// ─── Redis client singleton ──────────────────────────────────────────────────
// Redis is OPTIONAL. If REDIS_URL is not set, all operations fall back to
// in-memory equivalents — the server works on Replit without Redis.
// When Redis IS set, all workers/nodes share distributed state automatically.

let _redis: Redis | null = null;
let _connected = false;

export function getRedisClient(): Redis | null {
  return _redis;
}

export function isRedisConnected(): boolean {
  return _connected;
}

export async function initRedis(): Promise<void> {
  const url = process.env["REDIS_URL"];
  if (!url) {
    logger.info("REDIS_URL tidak di-set — menggunakan in-memory state (single node mode)");
    return;
  }

  _redis = new Redis(url, {
    maxRetriesPerRequest: 3,
    retryStrategy: (times) => Math.min(times * 200, 5_000),
    lazyConnect: true,
    connectTimeout: 10_000,
    enableReadyCheck: true,
    keepAlive: 30_000,
  });

  _redis.on("connect", () => {
    _connected = true;
    logger.info("Redis terkoneksi — distributed state aktif");
  });

  _redis.on("error", (err) => {
    if (_connected) {
      logger.error({ err: err.message }, "Redis error — fallback ke in-memory");
    }
    _connected = false;
  });

  _redis.on("close", () => {
    _connected = false;
    logger.warn("Redis terputus — fallback ke in-memory sementara");
  });

  _redis.on("reconnecting", () => {
    logger.info("Mencoba reconnect ke Redis...");
  });

  try {
    await _redis.connect();
    await _redis.ping();
    logger.info({ url: url.replace(/:\/\/.*@/, "://**@") }, "Redis siap");
  } catch (err) {
    logger.warn({ err }, "Gagal koneksi ke Redis — fallback ke in-memory");
    _redis = null;
    _connected = false;
  }
}

export async function closeRedis(): Promise<void> {
  if (_redis) {
    await _redis.quit();
    _redis = null;
    _connected = false;
  }
}

// ─── Distributed IP Blacklist ────────────────────────────────────────────────

const BLACK_PREFIX = "ix:blacklist:";
const memBlacklist = new Map<string, { reason: string; expireAt: number; strikes: number }>();
const BLACKLIST_TTL_MS = 30 * 60 * 1000;
const PERMANENT_STRIKES = 5;

export async function blacklistIPDistributed(ip: string, reason: string): Promise<void> {
  const mem = memBlacklist.get(ip);
  const strikes = (mem?.strikes ?? 0) + 1;
  const ttlMs = strikes >= PERMANENT_STRIKES ? 24 * 60 * 60 * 1000 : BLACKLIST_TTL_MS * strikes;

  memBlacklist.set(ip, { reason, expireAt: Date.now() + ttlMs, strikes });

  if (_redis && _connected) {
    try {
      await _redis
        .pipeline()
        .set(`${BLACK_PREFIX}${ip}`, JSON.stringify({ reason, strikes }), "PX", ttlMs)
        .exec();
    } catch {
      // in-memory already set above
    }
  }

  logger.warn({ ip, reason, strikes, ttlMin: Math.round(ttlMs / 60000) }, "IP blacklisted");
}

export async function isIPBlacklistedDistributed(ip: string): Promise<boolean> {
  // Check memory first (fast path)
  const mem = memBlacklist.get(ip);
  if (mem) {
    if (Date.now() > mem.expireAt) { memBlacklist.delete(ip); }
    else return true;
  }

  // Check Redis (cross-node)
  if (_redis && _connected) {
    try {
      const val = await _redis.get(`${BLACK_PREFIX}${ip}`);
      if (val) {
        // Populate memory cache
        const ttl = await _redis.pttl(`${BLACK_PREFIX}${ip}`);
        const parsed = JSON.parse(val) as { reason: string; strikes: number };
        if (ttl > 0) memBlacklist.set(ip, { reason: parsed.reason, strikes: parsed.strikes, expireAt: Date.now() + ttl });
        return true;
      }
    } catch {
      // fall through to memory check
    }
  }

  return false;
}

// Cleanup memory every 5 min
setInterval(() => {
  const now = Date.now();
  for (const [ip, e] of memBlacklist) if (now > e.expireAt) memBlacklist.delete(ip);
}, 5 * 60 * 1000);

// ─── Distributed Rate Limiter ────────────────────────────────────────────────

const memRateLimits = new Map<string, { count: number; resetAt: number }>();

export async function checkRateLimit(
  key: string,
  max: number,
  windowMs: number
): Promise<{ allowed: boolean; count: number; remaining: number; resetAt: number }> {
  const windowKey = `ix:rl:${key}:${Math.floor(Date.now() / windowMs)}`;
  const resetAt = (Math.floor(Date.now() / windowMs) + 1) * windowMs;
  const ttlSec = Math.ceil(windowMs / 1000) + 1;

  if (_redis && _connected) {
    try {
      const pipeline = _redis.pipeline();
      pipeline.incr(windowKey);
      pipeline.expire(windowKey, ttlSec, "NX");
      const results = await pipeline.exec();
      const count = (results?.[0]?.[1] as number) ?? 1;
      return { allowed: count <= max, count, remaining: Math.max(0, max - count), resetAt };
    } catch {
      // fall through to in-memory
    }
  }

  // In-memory fallback
  const now = Date.now();
  const mem = memRateLimits.get(windowKey);
  if (!mem || now > mem.resetAt) {
    memRateLimits.set(windowKey, { count: 1, resetAt });
    return { allowed: true, count: 1, remaining: max - 1, resetAt };
  }
  mem.count++;
  return { allowed: mem.count <= max, count: mem.count, remaining: Math.max(0, max - mem.count), resetAt };
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of memRateLimits) if (now > v.resetAt + 5000) memRateLimits.delete(k);
}, 60_000);

// ─── Distributed Mining Lock ─────────────────────────────────────────────────
// TTL 30 detik — cukup untuk mining block, tidak stuck terlalu lama jika crash.
// Lock menggunakan SET ... EX NX sehingga otomatis kadaluarsa di Redis.
// In-memory fallback juga menggunakan TTL yang sama.

const MINING_LOCK_KEY = "ix:mining:lock";
const MINING_LOCK_TTL_SEC = 30;      // Redis EX (detik)
const MINING_LOCK_TTL_MS  = 30_000;  // In-memory fallback (ms)

let memMiningLock   = false;
let memMiningLockAt = 0;

export async function acquireMiningLockDistributed(): Promise<boolean> {
  const nodeId = process.env["NODE_ID"] ?? `pid-${process.pid}`;

  if (_redis && _connected) {
    try {
      // SET key value EX ttl NX — atomic: hanya berhasil jika key belum ada
      const result = await _redis.set(MINING_LOCK_KEY, nodeId, "EX", MINING_LOCK_TTL_SEC, "NX");
      if (result === "OK") {
        logger.info({ nodeId, ttlSec: MINING_LOCK_TTL_SEC }, "[MiningLock] Lock ACQUIRED via Redis");
        return true;
      }
      // Cek siapa yang memegang lock sekarang
      const holder = await _redis.get(MINING_LOCK_KEY).catch(() => null);
      logger.warn({ nodeId, holder }, "[MiningLock] Gagal acquire lock — sedang dipegang node lain");
      return false;
    } catch (err) {
      logger.error({ err }, "[MiningLock] Redis error saat acquire — fallback ke in-memory");
      // fall through to in-memory
    }
  }

  // In-memory fallback (single node)
  if (memMiningLock && Date.now() - memMiningLockAt < MINING_LOCK_TTL_MS) {
    logger.warn({ nodeId }, "[MiningLock] Gagal acquire lock (in-memory) — sedang mining");
    return false;
  }
  memMiningLock   = true;
  memMiningLockAt = Date.now();
  logger.info({ nodeId }, "[MiningLock] Lock ACQUIRED via in-memory");
  return true;
}

export async function releaseMiningLockDistributed(): Promise<void> {
  const nodeId = process.env["NODE_ID"] ?? `pid-${process.pid}`;

  if (_redis && _connected) {
    try {
      const deleted = await _redis.del(MINING_LOCK_KEY);
      logger.info({ nodeId, deleted }, "[MiningLock] Lock RELEASED via Redis");
      return;
    } catch (err) {
      logger.error({ err }, "[MiningLock] Redis error saat release — fallback ke in-memory");
      // fall through
    }
  }
  memMiningLock = false;
  logger.info({ nodeId }, "[MiningLock] Lock RELEASED via in-memory");
}

export async function forceReleaseMiningLock(): Promise<void> {
  // Force release untuk admin endpoint — hapus lock tanpa cek ownership
  if (_redis && _connected) {
    try {
      await _redis.del(MINING_LOCK_KEY);
    } catch {
      // ignore
    }
  }
  memMiningLock = false;
  logger.warn("[MiningLock] Lock FORCE-RELEASED oleh admin");
}

export async function getMiningLockStatus(): Promise<{ locked: boolean; holder: string | null; ttlSec: number }> {
  if (_redis && _connected) {
    try {
      const [holder, ttl] = await Promise.all([
        _redis.get(MINING_LOCK_KEY),
        _redis.ttl(MINING_LOCK_KEY),
      ]);
      return { locked: holder !== null, holder, ttlSec: ttl };
    } catch {
      // fall through
    }
  }
  const elapsed = (Date.now() - memMiningLockAt) / 1000;
  const isActive = memMiningLock && elapsed * 1000 < MINING_LOCK_TTL_MS;
  return {
    locked:  isActive,
    holder:  isActive ? `in-memory:pid-${process.pid}` : null,
    ttlSec:  isActive ? Math.max(0, MINING_LOCK_TTL_SEC - Math.round(elapsed)) : 0,
  };
}

// ─── Distributed Anti-Flood ──────────────────────────────────────────────────

const FLOOD_WINDOW_MS = 1_000;
const FLOOD_MAX_PER_SEC = 20;
const memFlood = new Map<string, { count: number; resetAt: number }>();

export async function checkAntiFlood(ip: string, path: string): Promise<boolean> {
  const key = `${ip}|${path}`;
  const rl = await checkRateLimit(`flood:${key}`, FLOOD_MAX_PER_SEC, FLOOD_WINDOW_MS);
  if (!rl.allowed) {
    // In-memory path for speed even if Redis is up
    const mem = memFlood.get(key);
    if (!mem || Date.now() > mem.resetAt) {
      memFlood.set(key, { count: 1, resetAt: Date.now() + FLOOD_WINDOW_MS });
    } else {
      mem.count++;
      if (mem.count > FLOOD_MAX_PER_SEC) return false;
    }
    return false;
  }
  return true;
}

// ─── Node registry (cross-server discovery) ───────────────────────────────────

const NODE_TTL_SEC = 60;

export async function registerThisNode(url: string): Promise<void> {
  if (!_redis || !_connected) return;
  try {
    const nodeId = process.env["NODE_ID"] ?? `node-${process.pid}`;
    await _redis.setex(`ix:nodes:${nodeId}`, NODE_TTL_SEC, JSON.stringify({ url, nodeId, pid: process.pid, ts: Date.now() }));
  } catch {
    // non-critical
  }
}

export async function getActiveNodes(): Promise<{ url: string; nodeId: string; ts: number }[]> {
  if (!_redis || !_connected) return [];
  try {
    const keys = await _redis.keys("ix:nodes:*");
    if (!keys.length) return [];
    const vals = await _redis.mget(...keys);
    return vals.filter(Boolean).map((v) => JSON.parse(v!) as { url: string; nodeId: string; ts: number });
  } catch {
    return [];
  }
}
