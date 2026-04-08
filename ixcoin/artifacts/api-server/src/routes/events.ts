/**
 * Server-Sent Events (SSE) endpoint for live blockchain updates.
 *
 * SSE works reliably behind HTTP/1.1 proxies (unlike WebSocket upgrades).
 * The client connects to GET /api/events and receives a stream of JSON events.
 *
 * Event types:
 *  - NEW_BLOCK: a new block was mined
 *  - NEW_TX: a transaction entered the mempool
 *  - STATS: updated chain stats (sent with every NEW_BLOCK)
 *  - PING: keep-alive (sent every 25s)
 */

import { Router, Request, Response } from "express";
import { blockchain } from "../blockchain/index.js";
import { logger } from "../lib/logger.js";

const router = Router();

interface SSEClient {
  id: string;
  res: Response;
  connectedAt: number;
}

const clients = new Map<string, SSEClient>();
let clientIdSeq = 0;

function broadcast(eventType: string, data: unknown): void {
  const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const [id, client] of clients) {
    try {
      client.res.write(payload);
    } catch {
      clients.delete(id);
    }
  }
}

export function emitNewBlockSSE(block: {
  height: number;
  hash: string;
  nonce: number;
  difficulty: number;
  txCount: number;
  reward: number;
  fees: number;
  miner: string;
  timestamp: number;
}): void {
  broadcast("NEW_BLOCK", block);
  broadcast("STATS", blockchain.getStats());
}

export function emitNewTxSSE(tx: {
  id: string;
  from: string;
  to: string;
  amount: number;
  fee: number;
  timestamp: number;
}): void {
  broadcast("NEW_TX", tx);
}

export function getSSEClientCount(): number {
  return clients.size;
}

// GET /api/events — SSE stream
router.get("/", (req: Request, res: Response) => {
  const id = `sse-${++clientIdSeq}`;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  // Send initial stats
  const stats = blockchain.getStats();
  res.write(`event: STATS\ndata: ${JSON.stringify(stats)}\n\n`);

  clients.set(id, { id, res, connectedAt: Date.now() });
  logger.debug({ id, total: clients.size }, "SSE client connected");

  // Ping every 25s to keep connection alive through proxies
  const pingInterval = setInterval(() => {
    try {
      res.write(`: ping\n\n`);
    } catch {
      clearInterval(pingInterval);
      clients.delete(id);
    }
  }, 25_000);

  req.on("close", () => {
    clearInterval(pingInterval);
    clients.delete(id);
    logger.debug({ id, total: clients.size }, "SSE client disconnected");
  });
});

export default router;
