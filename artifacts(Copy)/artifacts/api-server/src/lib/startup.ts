import { logger } from "./logger.js";
import { isRedisConnected } from "./redis.js";

interface EnvCheck {
  name: string;
  required: boolean;
  warn?: string;
  validate?: (val: string) => boolean;
  validationMsg?: string;
}

const ENV_CHECKS: EnvCheck[] = [
  { name: "PORT", required: true, validate: (v) => !isNaN(Number(v)) && Number(v) > 0, validationMsg: "PORT harus berupa angka positif" },
  { name: "NODE_ENV", required: false, warn: "NODE_ENV tidak di-set, defaulting ke 'development'" },
  { name: "GENESIS_MNEMONIC", required: false, warn: "GENESIS_MNEMONIC tidak di-set — TIDAK AMAN untuk production!" },
  { name: "API_KEY", required: false, warn: "API_KEY tidak di-set, API tidak terproteksi" },
  { name: "ADMIN_KEY", required: false, warn: "ADMIN_KEY tidak di-set, admin endpoints tidak terproteksi" },
  { name: "ALLOWED_ORIGINS", required: false, warn: "ALLOWED_ORIGINS tidak di-set, CORS terbuka untuk semua origin" },
  { name: "DATABASE_URL", required: false, warn: "DATABASE_URL tidak di-set, menggunakan koneksi default" },
  { name: "REDIS_URL", required: false, warn: "REDIS_URL tidak di-set — gunakan Redis untuk multi-server scaling" },
  { name: "NODE_ID", required: false, warn: "NODE_ID tidak di-set — menggunakan PID sebagai identifier" },
  { name: "PUBLIC_URL", required: false, warn: "PUBLIC_URL tidak di-set — node tidak akan terdaftar di registry" },
  { name: "CLUSTER_WORKERS", required: false },
  { name: "SEED_PEERS", required: false },
];

export function validateEnvironment(): void {
  const isProd = process.env["NODE_ENV"] === "production";
  let hasFatal = false;

  logger.info("Memeriksa environment variables...");

  for (const check of ENV_CHECKS) {
    const val = process.env[check.name];
    if (!val) {
      if (check.required) {
        logger.error({ name: check.name }, `Environment variable wajib tidak ditemukan: ${check.name}`);
        hasFatal = true;
      } else if (check.warn) {
        isProd ? logger.warn({ name: check.name }, check.warn) : logger.debug({ name: check.name }, check.warn);
      }
    } else if (check.validate && !check.validate(val)) {
      logger.error({ name: check.name }, check.validationMsg ?? `Nilai ${check.name} tidak valid`);
      hasFatal = true;
    }
  }

  if (isProd) {
    for (const name of ["API_KEY", "ADMIN_KEY", "GENESIS_MNEMONIC", "REDIS_URL"]) {
      if (!process.env[name]) {
        logger.warn({ name }, `[PRODUCTION WARNING] ${name} sebaiknya di-set di production`);
      }
    }
    if (process.env["ALLOWED_ORIGINS"] === "*" || !process.env["ALLOWED_ORIGINS"]) {
      logger.warn("ALLOWED_ORIGINS terbuka untuk semua origin — tidak direkomendasikan di production");
    }
  }

  if (hasFatal) {
    logger.error("Environment validation gagal — server tidak dapat dijalankan");
    process.exit(1);
  }

  logger.info({ isProd, nodeEnv: process.env["NODE_ENV"] ?? "development" }, "Environment validation berhasil");
}

export function logStartupBanner(port: number, nodeId: string, workers: number): void {
  const isProd = process.env["NODE_ENV"] === "production";
  const redisOk = isRedisConnected();
  const clusterMode = workers > 1 ? `${workers} workers` : "single process";

  logger.info("=".repeat(60));
  logger.info("  IXCOIN Layer 1 Blockchain Node");
  logger.info(`  Mode     : ${isProd ? "PRODUCTION" : "DEVELOPMENT"}`);
  logger.info(`  Node ID  : ${nodeId}`);
  logger.info(`  Port     : ${port}`);
  logger.info(`  Cluster  : ${clusterMode}`);
  logger.info(`  Redis    : ${redisOk ? "✓ terhubung (distributed state aktif)" : "✗ in-memory (single node)"}`);
  logger.info(`  API      : http://localhost:${port}/api/ixcoin/info`);
  logger.info(`  Health   : http://localhost:${port}/api/healthz`);
  logger.info(`  P2P WS   : ws://localhost:${port}/p2p`);
  logger.info(`  Auth     : API_KEY ${process.env["API_KEY"] ? "✓ aktif" : "✗ tidak diset"}`);
  logger.info(`  Public   : ${process.env["PUBLIC_URL"] ?? "tidak di-set"}`);
  logger.info(`  Peers    : ${process.env["SEED_PEERS"] ? process.env["SEED_PEERS"].split(",").length + " seed peers" : "tidak ada seed peer"}`);
  logger.info("=".repeat(60));
}
