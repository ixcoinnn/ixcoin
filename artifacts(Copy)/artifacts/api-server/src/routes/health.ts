import { Router, type IRouter, type Request, type Response } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import os from "os";
import { pool } from "@workspace/db";
import { blockchain } from "../blockchain/index.js";
import { getPeerCount } from "../p2p/p2p.js";
import { isRedisConnected, getActiveNodes } from "../lib/redis.js";

const router: IRouter = Router();
const startTime = Date.now();
const version = "1.0.0";

function getUptimeSeconds(): number {
  return Math.floor((Date.now() - startTime) / 1000);
}

function getMemStats() {
  const m = process.memoryUsage();
  return {
    heapUsedMB: Math.round(m.heapUsed / 1024 / 1024),
    heapTotalMB: Math.round(m.heapTotal / 1024 / 1024),
    rssMB: Math.round(m.rss / 1024 / 1024),
    externalMB: Math.round(m.external / 1024 / 1024),
    heapUsedPercent: Math.round((m.heapUsed / m.heapTotal) * 100),
  };
}

async function checkDatabase(): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
  const start = Date.now();
  try {
    await pool.query("SELECT 1");
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "DB error" };
  }
}

router.get("/healthz", (_req: Request, res: Response) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json({
    ...data,
    uptime: getUptimeSeconds(),
    timestamp: new Date().toISOString(),
    version,
    node: process.version,
  });
});

router.get("/healthz/live", (_req: Request, res: Response) => {
  res.status(200).json({ status: "alive", timestamp: new Date().toISOString() });
});

router.get("/healthz/ready", async (_req: Request, res: Response) => {
  const mem = getMemStats();
  const loadAvg = os.loadavg();
  const db = await checkDatabase();
  const chainHeight = blockchain.chain.length - 1;
  const mempoolSize = blockchain.mempool.length;
  const redisOk = isRedisConnected();

  const heapOk = mem.heapUsedPercent < 90;
  const dbOk = db.ok;
  const isReady = heapOk && dbOk;

  res.status(isReady ? 200 : 503).json({
    status: isReady ? "ready" : "degraded",
    nodeId: process.env["NODE_ID"] ?? `pid-${process.pid}`,
    checks: {
      database: { ok: db.ok, latencyMs: db.latencyMs, error: db.error },
      redis: { ok: redisOk, mode: redisOk ? "distributed" : "in-memory" },
      memory: { ok: heapOk, ...mem },
      blockchain: { ok: chainHeight >= 0, height: chainHeight, mempoolSize, difficulty: blockchain.difficulty },
    },
    loadAvg: { "1m": loadAvg[0].toFixed(2), "5m": loadAvg[1].toFixed(2), "15m": loadAvg[2].toFixed(2) },
    uptimeSeconds: getUptimeSeconds(),
    timestamp: new Date().toISOString(),
  });
});

router.get("/healthz/deep", async (_req: Request, res: Response) => {
  const mem = getMemStats();
  const loadAvg = os.loadavg();
  const db = await checkDatabase();
  const chainValidation = blockchain.validateChain();
  const chainHeight = blockchain.chain.length - 1;

  const redisOk = isRedisConnected();
  const activeNodes = await getActiveNodes();
  const allOk = db.ok && chainValidation.valid && mem.heapUsedPercent < 90;

  res.status(allOk ? 200 : 503).json({
    status: allOk ? "healthy" : "unhealthy",
    version,
    environment: process.env["NODE_ENV"] ?? "development",
    nodeId: process.env["NODE_ID"] ?? `pid-${process.pid}`,
    workers: process.env["CLUSTER_WORKERS"] ?? "1",
    uptimeSeconds: getUptimeSeconds(),
    timestamp: new Date().toISOString(),
    node: process.version,
    platform: process.platform,
    checks: {
      database: { ok: db.ok, latencyMs: db.latencyMs, error: db.error },
      redis: { ok: redisOk, mode: redisOk ? "distributed" : "in-memory" },
      memory: { ok: mem.heapUsedPercent < 90, ...mem },
      blockchain: {
        ok: chainValidation.valid,
        height: chainHeight,
        valid: chainValidation.valid,
        error: chainValidation.error,
        mempoolSize: blockchain.mempool.length,
        difficulty: blockchain.difficulty,
        totalMinted: blockchain.totalMinted,
        peers: getPeerCount(),
      },
      network: {
        ok: true,
        activeNodes: activeNodes.length,
        nodes: activeNodes,
      },
      system: {
        loadAvg: { "1m": loadAvg[0].toFixed(2), "5m": loadAvg[1].toFixed(2), "15m": loadAvg[2].toFixed(2) },
        cpuCount: os.cpus().length,
        freeMB: Math.round(os.freemem() / 1024 / 1024),
        totalMB: Math.round(os.totalmem() / 1024 / 1024),
      },
    },
  });
});

router.get("/healthz/metrics", (_req: Request, res: Response) => {
  const mem = getMemStats();
  const loadAvg = os.loadavg();
  const uptimeSeconds = getUptimeSeconds();

  const lines = [
    `# HELP ixcoin_uptime_seconds Total uptime in seconds`,
    `# TYPE ixcoin_uptime_seconds gauge`,
    `ixcoin_uptime_seconds ${uptimeSeconds}`,
    ``,
    `# HELP ixcoin_heap_used_mb Heap memory used in MB`,
    `# TYPE ixcoin_heap_used_mb gauge`,
    `ixcoin_heap_used_mb ${mem.heapUsedMB}`,
    ``,
    `# HELP ixcoin_heap_total_mb Total heap memory in MB`,
    `# TYPE ixcoin_heap_total_mb gauge`,
    `ixcoin_heap_total_mb ${mem.heapTotalMB}`,
    ``,
    `# HELP ixcoin_rss_mb RSS memory in MB`,
    `# TYPE ixcoin_rss_mb gauge`,
    `ixcoin_rss_mb ${mem.rssMB}`,
    ``,
    `# HELP ixcoin_chain_height Current blockchain height`,
    `# TYPE ixcoin_chain_height gauge`,
    `ixcoin_chain_height ${blockchain.chain.length - 1}`,
    ``,
    `# HELP ixcoin_mempool_size Current mempool transaction count`,
    `# TYPE ixcoin_mempool_size gauge`,
    `ixcoin_mempool_size ${blockchain.mempool.length}`,
    ``,
    `# HELP ixcoin_difficulty Current mining difficulty`,
    `# TYPE ixcoin_difficulty gauge`,
    `ixcoin_difficulty ${blockchain.difficulty}`,
    ``,
    `# HELP ixcoin_peers_connected Connected P2P peers`,
    `# TYPE ixcoin_peers_connected gauge`,
    `ixcoin_peers_connected ${getPeerCount()}`,
    ``,
    `# HELP ixcoin_load_avg_1m System load average 1 minute`,
    `# TYPE ixcoin_load_avg_1m gauge`,
    `ixcoin_load_avg_1m ${loadAvg[0].toFixed(4)}`,
  ];

  res.set("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
  res.send(lines.join("\n") + "\n");
});

export default router;
