/**
 * Live Feed WebSocket Server
 *
 * Broadcasts real-time blockchain events to browser clients.
 * Path: /ws (separate from P2P at /p2p)
 *
 * Events emitted:
 *  - NEW_BLOCK: when a new block is mined
 *  - NEW_TX: when a transaction is submitted to mempool
 *  - STATS: updated chain stats (throttled, sent with every block)
 */

import { WebSocket, WebSocketServer } from "ws";
import { Server as HttpServer } from "http";
import { blockchain } from "../blockchain/index.js";
import { logger } from "../lib/logger.js";

export type LiveEventType = "NEW_BLOCK" | "NEW_TX" | "STATS" | "PING" | "PONG";

export interface LiveEvent {
  type: LiveEventType;
  data?: unknown;
  ts: number;
}

const clients: Set<WebSocket> = new Set();

function safeSend(ws: WebSocket, msg: LiveEvent): void {
  if (ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      clients.delete(ws);
    }
  }
}

function broadcast(event: LiveEvent): void {
  for (const ws of clients) {
    safeSend(ws, event);
  }
}

export function emitNewBlock(block: {
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
  const stats = blockchain.getStats();
  broadcast({ type: "NEW_BLOCK", data: block, ts: Date.now() });
  broadcast({ type: "STATS", data: stats, ts: Date.now() });
}

export function emitNewTx(tx: {
  id: string;
  from: string;
  to: string;
  amount: number;
  fee: number;
  timestamp: number;
}): void {
  broadcast({ type: "NEW_TX", data: tx, ts: Date.now() });
}

export function getLiveFeedClientCount(): number {
  return clients.size;
}

export function initLiveFeedServer(httpServer: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  wss.on("connection", (ws: WebSocket) => {
    clients.add(ws);
    logger.debug({ total: clients.size }, "Live feed client connected");

    // Send current stats immediately on connect
    const stats = blockchain.getStats();
    safeSend(ws, { type: "STATS", data: stats, ts: Date.now() });

    ws.on("message", (data: Buffer | string) => {
      try {
        const msg = JSON.parse(data.toString()) as { type?: string };
        if (msg.type === "PING") {
          safeSend(ws, { type: "PONG", ts: Date.now() });
        }
      } catch {
        // ignore invalid messages from clients
      }
    });

    ws.on("close", () => {
      clients.delete(ws);
    });

    ws.on("error", () => {
      clients.delete(ws);
    });
  });

  // Heartbeat every 30s to keep connections alive
  setInterval(() => {
    for (const ws of clients) {
      safeSend(ws, { type: "PING", ts: Date.now() });
    }
  }, 30_000);

  logger.info("Live Feed WebSocket server initialized at /ws");
  return wss;
}
