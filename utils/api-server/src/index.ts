import cluster from "cluster";
import { availableParallelism } from "os";
import { createServer } from "http";
import app, { initAll } from "./app.js";
import { logger } from "./lib/logger.js";
import { validateEnvironment, logStartupBanner } from "./lib/startup.js";
import { initRedis, closeRedis, registerThisNode } from "./lib/redis.js";
import { initP2PServer, connectToPeer, closeAllPeers } from "./p2p/p2p.js";
import { initLiveFeedServer } from "./p2p/live-feed.js";

validateEnvironment();

const rawPort = process.env["PORT"];
if (!rawPort) throw new Error("PORT environment variable is required but was not provided.");
const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) throw new Error(`Invalid PORT value: "${rawPort}"`);

// ─── Cluster mode ────────────────────────────────────────────────────────────
// Set CLUSTER_WORKERS=auto to use all CPU cores (e.g. on AWS EC2).
// Set CLUSTER_WORKERS=4 to use 4 workers. Default=1 (single process).
// With Redis enabled, all workers share distributed state automatically.

const rawWorkers = process.env["CLUSTER_WORKERS"] ?? "1";
const WORKER_COUNT =
  rawWorkers === "auto"
    ? availableParallelism()
    : Math.max(1, Math.min(parseInt(rawWorkers, 10) || 1, 64));

if (cluster.isPrimary && WORKER_COUNT > 1) {
  logger.info({ workers: WORKER_COUNT, pid: process.pid }, `IXCOIN Primary — forking ${WORKER_COUNT} workers`);

  for (let i = 0; i < WORKER_COUNT; i++) cluster.fork();

  cluster.on("exit", (worker, code, signal) => {
    logger.warn({ pid: worker.process.pid, code, signal }, "Worker crashed — restarting...");
    cluster.fork();
  });

  cluster.on("online", (worker) => {
    logger.info({ pid: worker.process.pid }, "Worker online");
  });
} else {
  startWorker();
}

// ─── Worker startup ──────────────────────────────────────────────────────────

async function startWorker(): Promise<void> {
  const nodeId = process.env["NODE_ID"] ?? `node-${process.pid}`;
  const httpServer = createServer(app);
  initP2PServer(httpServer);
  initLiveFeedServer(httpServer);

  const SEED_PEERS = (process.env["SEED_PEERS"] ?? "").split(",").filter(Boolean);
  let isShuttingDown = false;

  async function start(): Promise<void> {
    // Initialize Redis first (other systems depend on it for distributed state)
    await initRedis();

    await initAll().catch((err) => {
      logger.error({ err }, "Failed to initialize IXCOIN modules — continuing");
    });

    for (const peer of SEED_PEERS) {
      connectToPeer(peer).catch(() => {
        logger.warn({ peer }, "Could not connect to seed peer on startup");
      });
    }

    httpServer.listen(port, "0.0.0.0", () => {
      logStartupBanner(port, nodeId, WORKER_COUNT);

      // Register this node in Redis for cross-server discovery
      const publicUrl = process.env["PUBLIC_URL"] ?? `http://localhost:${port}`;
      registerThisNode(publicUrl).catch(() => {});

      // Periodically re-register (keep-alive in Redis)
      setInterval(() => registerThisNode(publicUrl).catch(() => {}), 30_000);

      if (SEED_PEERS.length > 0) {
        logger.info({ count: SEED_PEERS.length }, "Connecting to seed peers...");
      }
    });
  }

  async function gracefulShutdown(signal: string): Promise<void> {
    if (isShuttingDown) return;
    isShuttingDown = true;
    logger.info({ signal, nodeId }, "Shutdown signal received — shutting down gracefully");

    const timeout = setTimeout(() => {
      logger.error("Graceful shutdown timeout — forcing exit");
      process.exit(1);
    }, 30_000);

    try {
      httpServer.close();
      await closeAllPeers();
      await closeRedis();
      logger.info("Graceful shutdown complete");
      clearTimeout(timeout);
      process.exit(0);
    } catch (err) {
      clearTimeout(timeout);
      logger.error({ err }, "Error during graceful shutdown");
      process.exit(1);
    }
  }

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));

  process.on("uncaughtException", (err) => {
    logger.error({ err, type: "uncaughtException" }, "Uncaught exception");
    if (!isShuttingDown) gracefulShutdown("uncaughtException").catch(() => process.exit(1));
  });

  process.on("unhandledRejection", (reason) => {
    logger.error({ reason, type: "unhandledRejection" }, "Unhandled promise rejection");
    if (!isShuttingDown) gracefulShutdown("unhandledRejection").catch(() => process.exit(1));
  });

  start().catch((err) => {
    logger.error({ err }, "Failed to start server");
    process.exit(1);
  });
}
