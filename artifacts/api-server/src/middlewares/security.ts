import { Request, Response, NextFunction } from "express";
import { createHash } from "crypto";
import { logger } from "../lib/logger.js";
import {
  blacklistIPDistributed,
  isIPBlacklistedDistributed,
  checkAntiFlood,
  acquireMiningLockDistributed,
  releaseMiningLockDistributed,
} from "../lib/redis.js";

// ─── IP Blacklist (distributed via Redis, in-memory fallback) ────────────────

export async function blacklistIP(ip: string, reason: string): Promise<void> {
  await blacklistIPDistributed(ip, reason);
}

export function blacklistIPSync(ip: string, reason: string): void {
  blacklistIPDistributed(ip, reason).catch(() => {});
}

// ─── Mining concurrency lock (distributed via Redis) ─────────────────────────

export async function acquireMiningLock(): Promise<boolean> {
  return acquireMiningLockDistributed();
}

export async function releaseMiningLock(): Promise<void> {
  return releaseMiningLockDistributed();
}

// ─── Comprehensive threat patterns ──────────────────────────────────────────

const BLOCKED_UA_PATTERNS = [
  /sqlmap/i, /nikto/i, /masscan/i, /zgrab/i, /nessus/i, /openvas/i,
  /nmap/i, /burpsuite/i, /metasploit/i, /w3af/i, /dirbuster/i, /gobuster/i,
  /nuclei/i, /acunetix/i, /appscan/i, /whatweb/i, /python-requests\/[01]\./i,
  /curl\/[0-5]\./i, /go-http-client/i, /libwww-perl/i, /lwp-trivial/i,
  /wget\/[01]\./i, /scrapy/i, /arachni/i, /skipfish/i, /havij/i,
  /pangolin/i, /webscarab/i, /\bzap\b/i, /paros/i, /netsparker/i,
  /rapid7/i, /qualys/i, /vega/i, /^$/,
];

const SUSPICIOUS_PATH_PATTERNS = [
  /\.\.\//,
  /\.\.\\/,
  /<script/i,
  /javascript:/i,
  /data:text\/html/i,
  /union[\s\+]+select/i,
  /insert[\s\+]+into/i,
  /drop[\s\+]+table/i,
  /exec\s*\(/i,
  /xp_cmdshell/i,
  /\/etc\/passwd/i,
  /\/etc\/shadow/i,
  /\/proc\//i,
  /\/sys\//i,
  /wp-admin/i,
  /wp-login/i,
  /phpmyadmin/i,
  /\.env$/i,
  /\.git\//i,
  /\.htaccess/i,
  /\/admin\//i,
  /\/actuator/i,
  /\/jenkins/i,
  /\x00/,
  /%00/,
  /\%27/,
  /\%3C/i,
  /\%3E/i,
  /select.*from.*where/i,
  /or\s+1\s*=\s*1/i,
  /\balert\s*\(/i,
  /\beval\s*\(/i,
  /\bdocument\.cookie/i,
];

const SUSPICIOUS_HEADER_PATTERNS = [/\.\.\//, /<script/i, /\x00/];

// ─── Request fingerprint ────────────────────────────────────────────────────

export function requestFingerprint(req: Request): string {
  const parts = [
    req.ip ?? "unknown",
    req.headers["user-agent"] ?? "",
    req.headers["accept-language"] ?? "",
    req.headers["accept-encoding"] ?? "",
  ];
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 16);
}

// ─── Abuse detection (async-safe middleware) ─────────────────────────────────

export function abuseDetection(req: Request, res: Response, next: NextFunction): void {
  const ip = req.ip ?? "unknown";
  const ua = req.headers["user-agent"] ?? "";
  const path = req.originalUrl ?? "";

  // Synchronous checks first (fast path)
  for (const p of BLOCKED_UA_PATTERNS) {
    if (p.test(ua)) {
      blacklistIPSync(ip, `blocked_ua:${ua.slice(0, 40)}`);
      res.status(403).json({ error: "Akses ditolak" });
      return;
    }
  }

  for (const p of SUSPICIOUS_PATH_PATTERNS) {
    if (p.test(path)) {
      blacklistIPSync(ip, `suspicious_path:${path.slice(0, 60)}`);
      res.status(400).json({ error: "Request tidak valid" });
      return;
    }
  }

  for (const header of ["referer", "x-forwarded-for", "x-real-ip"]) {
    const val = req.headers[header];
    if (val) {
      const valStr = Array.isArray(val) ? val.join(",") : val;
      for (const p of SUSPICIOUS_HEADER_PATTERNS) {
        if (p.test(valStr)) {
          blacklistIPSync(ip, `suspicious_header:${header}`);
          res.status(400).json({ error: "Request tidak valid" });
          return;
        }
      }
    }
  }

  // Async Redis blacklist check
  isIPBlacklistedDistributed(ip)
    .then((blocked) => {
      if (blocked) {
        logger.warn({ ip, path: req.path }, "Blocked blacklisted IP");
        if (!res.headersSent) res.status(403).json({ error: "Akses ditolak" });
        return;
      }
      next();
    })
    .catch(() => next());
}

// ─── Anti-flood (distributed via Redis) ─────────────────────────────────────

export function antiFlood(req: Request, res: Response, next: NextFunction): void {
  const ip = req.ip ?? "unknown";
  checkAntiFlood(ip, req.path)
    .then((allowed) => {
      if (!allowed) {
        blacklistIPSync(ip, `flood:${req.path}`);
        if (!res.headersSent) {
          res.status(429).json({ error: "Terlalu banyak request — anda diblokir sementara" });
        }
        return;
      }
      next();
    })
    .catch(() => next());
}

// ─── Content-Type enforcement ────────────────────────────────────────────────

export function requireJSON(req: Request, res: Response, next: NextFunction): void {
  if (["POST", "PUT", "PATCH"].includes(req.method)) {
    const ct = req.headers["content-type"] ?? "";
    if (!ct.includes("application/json")) {
      res.status(415).json({ error: "Content-Type harus application/json" });
      return;
    }
  }
  next();
}

// ─── Request size guard ──────────────────────────────────────────────────────

export function requestSizeGuard(maxBytes: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const contentLength = parseInt(req.headers["content-length"] ?? "0", 10);
    if (!isNaN(contentLength) && contentLength > maxBytes) {
      logger.warn({ ip: req.ip, contentLength, maxBytes, path: req.path }, "Request body too large");
      res.status(413).json({ error: `Request terlalu besar (maks ${Math.round(maxBytes / 1024)} KB)` });
      return;
    }

    let received = 0;
    req.on("data", (chunk: Buffer) => {
      received += chunk.length;
      if (received > maxBytes) {
        logger.warn({ ip: req.ip, received, maxBytes, path: req.path }, "Request body too large (stream)");
        if (!res.headersSent) {
          res.status(413).json({ error: `Request terlalu besar (maks ${Math.round(maxBytes / 1024)} KB)` });
        }
        req.destroy();
      }
    });

    next();
  };
}

// ─── Private key guard ──────────────────────────────────────────────────────

export function privateKeyGuard(req: Request, _res: Response, next: NextFunction): void {
  const body = req.body as Record<string, unknown> | undefined;
  if (body && typeof body === "object") {
    for (const key of ["privateKeyHex", "mnemonic", "seed", "privateKey", "secret"]) {
      if (key in body && String(body[key] ?? "").length > 500) {
        logger.warn({ ip: req.ip, path: req.path, key }, "Suspiciously long sensitive field");
      }
    }
  }
  next();
}

// ─── Security headers ───────────────────────────────────────────────────────

export function addSecurityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=(), payment=(), usb=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("X-DNS-Prefetch-Control", "off");
  next();
}

// ─── Origin check ───────────────────────────────────────────────────────────

export function enforceOrigin(req: Request, res: Response, next: NextFunction): void {
  const allowedOrigins = process.env["ALLOWED_ORIGINS"];
  if (!allowedOrigins || allowedOrigins === "*") { next(); return; }
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) { next(); return; }
  const origin = req.headers["origin"];
  if (!origin) { next(); return; }
  const allowed = allowedOrigins.split(",").map((s) => s.trim());
  if (!allowed.includes(origin)) {
    logger.warn({ ip: req.ip, origin }, "Rejected disallowed origin");
    res.status(403).json({ error: "Origin tidak diizinkan" });
    return;
  }
  next();
}

// ─── Mining concurrency guard ────────────────────────────────────────────────
// CATATAN: jangan gunakan middleware ini untuk mining lock!
// Middleware tidak punya fase cleanup sehingga lock tidak pernah dilepas.
// Gunakan acquireMiningLock() + try/finally langsung di route handler.
// Fungsi ini dihapus — route /mine sudah mengelola lock sendiri dengan benar.
