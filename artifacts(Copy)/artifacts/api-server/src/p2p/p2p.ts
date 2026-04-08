import { WebSocket, WebSocketServer } from "ws";
import { blockchain } from "../blockchain/blockchain.js";
import { Block } from "../blockchain/block.js";
import { Transaction } from "../blockchain/transaction.js";
import { logger } from "../lib/logger.js";
import { IncomingMessage, Server as HttpServer } from "http";

type MessageType =
  | "QUERY_LATEST"
  | "QUERY_ALL"
  | "RESPONSE_BLOCKCHAIN"
  | "RESPONSE_LATEST"
  | "BROADCAST_TRANSACTION"
  | "BROADCAST_BLOCK"
  | "QUERY_PEERS"
  | "RESPONSE_PEERS"
  | "PING"
  | "PONG";

interface P2PMessage {
  type: MessageType;
  data?: unknown;
  version: string;
  timestamp: number;
}

const PEERS: Set<WebSocket> = new Set();
const KNOWN_PEER_URLS: Set<string> = new Set();
const VERSION = "1.0.0";
const RECONNECT_DELAY_MS = 30_000;
const PING_INTERVAL_MS = 30_000;
// 20MB — large enough for a full chain sync, small enough to prevent OOM attacks
const MAX_P2P_MESSAGE_BYTES = 20 * 1024 * 1024;
// Limit how many peer URLs we auto-discover to prevent memory exhaustion
const MAX_KNOWN_PEERS = 500;

function createMessage(type: MessageType, data?: unknown): string {
  return JSON.stringify({ type, data, version: VERSION, timestamp: Date.now() } satisfies P2PMessage);
}

function safeSend(ws: WebSocket, message: string) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(message);
  }
}

function broadcastToAll(message: string, exclude?: WebSocket) {
  for (const peer of PEERS) {
    if (peer !== exclude) safeSend(peer, message);
  }
}

async function handleMessage(ws: WebSocket, raw: string) {
  try {
    const msg = JSON.parse(raw) as P2PMessage;

    switch (msg.type) {
      case "PING":
        safeSend(ws, createMessage("PONG"));
        break;

      case "PONG":
        break;

      case "QUERY_LATEST":
        if (blockchain.chain.length > 0) {
          const latest = blockchain.chain[blockchain.chain.length - 1];
          safeSend(ws, createMessage("RESPONSE_LATEST", latest.toJSON()));
        }
        break;

      case "QUERY_ALL":
        safeSend(ws, createMessage("RESPONSE_BLOCKCHAIN", blockchain.chain.map(b => b.toJSON())));
        break;

      case "RESPONSE_LATEST": {
        const incomingBlock = msg.data as ReturnType<Block["toJSON"]>;
        if (!incomingBlock) break;

        const latestOwn = blockchain.chain[blockchain.chain.length - 1];

        if (incomingBlock.height <= latestOwn.height) break;

        // Peer is ahead — request full chain
        logger.info(
          { peerHeight: incomingBlock.height, ourHeight: latestOwn.height },
          "Peer ahead — requesting full chain"
        );
        safeSend(ws, createMessage("QUERY_ALL"));
        break;
      }

      case "RESPONSE_BLOCKCHAIN": {
        const receivedChain = msg.data as ReturnType<Block["toJSON"]>[];
        if (!Array.isArray(receivedChain) || receivedChain.length === 0) break;

        if (receivedChain.length <= blockchain.chain.length) break;

        logger.info(
          { peerHeight: receivedChain.length - 1, ourHeight: blockchain.chain.length - 1 },
          "Received longer chain from peer — attempting replacement"
        );

        try {
          const newChain = receivedChain.map((b) => Block.fromJSON(b));
          // BUG FIX: replaceChain is now async (awaits replayDifficulty)
          const replaced = await blockchain.replaceChain(newChain);
          if (replaced) {
            // Persist all new blocks to storage
            for (const block of newChain) {
              await blockchain.storage.saveBlock(block);
            }
            const latest = newChain[newChain.length - 1];
            broadcastToAll(createMessage("RESPONSE_LATEST", latest.toJSON()), ws);
            logger.info({ newHeight: newChain.length - 1 }, "Chain replaced and synced from peer");
          }
        } catch (err) {
          logger.warn({ err }, "Failed to replace chain from peer");
        }
        break;
      }

      case "BROADCAST_TRANSACTION": {
        const txData = msg.data as ReturnType<Transaction["toJSON"]>;
        if (!txData) break;
        try {
          const tx = Transaction.fromJSON(txData);
          blockchain.addTransaction(tx);
          broadcastToAll(createMessage("BROADCAST_TRANSACTION", txData), ws);
          logger.info({ txId: txData.id }, "Relayed transaction from peer");
        } catch {
          // Ignore duplicate or invalid txs from peers
        }
        break;
      }

      case "BROADCAST_BLOCK": {
        const blockData = msg.data as ReturnType<Block["toJSON"]>;
        if (!blockData) break;
        try {
          const block = Block.fromJSON(blockData);
          const added = blockchain.addBlockFromPeer(block);
          if (added) {
            broadcastToAll(createMessage("BROADCAST_BLOCK", blockData), ws);
            logger.info({ height: block.height, hash: block.hash.slice(0, 16) }, "Accepted and relayed block from peer");
          }
        } catch {
          // Ignore invalid blocks
        }
        break;
      }

      case "QUERY_PEERS":
        safeSend(ws, createMessage("RESPONSE_PEERS", Array.from(KNOWN_PEER_URLS)));
        break;

      case "RESPONSE_PEERS": {
        const peerList = msg.data as string[];
        if (!Array.isArray(peerList)) break;
        for (const url of peerList) {
          if (typeof url !== "string" || url.length > 500) continue;
          if (!url.startsWith("ws://") && !url.startsWith("wss://")) continue;
          if (KNOWN_PEER_URLS.size >= MAX_KNOWN_PEERS) break;
          if (!KNOWN_PEER_URLS.has(url)) {
            KNOWN_PEER_URLS.add(url);
            connectToPeer(url).catch(() => {});
          }
        }
        break;
      }
    }
  } catch {
    // Ignore parse errors
  }
}

export function broadcastTransaction(tx: Transaction) {
  broadcastToAll(createMessage("BROADCAST_TRANSACTION", tx.toJSON()));
}

export function broadcastBlock(block: Block) {
  broadcastToAll(createMessage("BROADCAST_BLOCK", block.toJSON()));
}

export async function connectToPeer(peerUrl: string): Promise<void> {
  // Check if already connected
  for (const peer of PEERS) {
    if ((peer as unknown as { _peerUrl?: string })._peerUrl === peerUrl) return;
  }

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(peerUrl) as WebSocket & { _peerUrl: string };
    ws._peerUrl = peerUrl;
    KNOWN_PEER_URLS.add(peerUrl);

    const timeout = setTimeout(() => {
      ws.terminate();
      reject(new Error(`Connection timeout to ${peerUrl}`));
    }, 8000);

    ws.on("open", () => {
      clearTimeout(timeout);
      PEERS.add(ws);
      logger.info({ peerUrl }, "Connected to peer");

      // On connect: query latest block + discover more peers
      safeSend(ws, createMessage("QUERY_LATEST"));
      safeSend(ws, createMessage("QUERY_PEERS"));
      resolve();
    });

    ws.on("message", (data: Buffer | string) => {
      const str = data.toString();
      if (str.length > MAX_P2P_MESSAGE_BYTES) {
        logger.warn({ peerUrl, size: str.length }, "P2P message too large — ignored");
        return;
      }
      handleMessage(ws, str);
    });

    ws.on("close", () => {
      PEERS.delete(ws);
      logger.info({ peerUrl }, "Peer disconnected — will retry in 30s");
      setTimeout(() => connectToPeer(peerUrl).catch(() => {}), RECONNECT_DELAY_MS);
    });

    ws.on("error", (err) => {
      clearTimeout(timeout);
      PEERS.delete(ws);
      reject(err);
    });
  });
}

export function initP2PServer(httpServer: HttpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: "/p2p" });

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    PEERS.add(ws);
    const ip = req.socket.remoteAddress ?? "unknown";
    logger.info({ ip }, "New inbound P2P peer connected");

    // Greet new peer
    safeSend(ws, createMessage("QUERY_LATEST"));
    safeSend(ws, createMessage("QUERY_PEERS"));

    ws.on("message", (data: Buffer | string) => {
      const str = data.toString();
      if (str.length > MAX_P2P_MESSAGE_BYTES) {
        logger.warn({ ip, size: str.length }, "Inbound P2P message too large — ignored");
        return;
      }
      handleMessage(ws, str);
    });

    ws.on("close", () => {
      PEERS.delete(ws);
      logger.info({ ip }, "Inbound peer disconnected");
    });

    ws.on("error", () => {
      PEERS.delete(ws);
    });
  });

  // Heartbeat to keep connections alive
  setInterval(() => {
    const ping = createMessage("PING");
    for (const peer of PEERS) {
      safeSend(peer, ping);
    }
  }, PING_INTERVAL_MS);

  logger.info("P2P WebSocket server initialized at /p2p");
  return wss;
}

export function getPeerCount(): number {
  return PEERS.size;
}

export function getKnownPeers(): string[] {
  return Array.from(KNOWN_PEER_URLS);
}

export async function closeAllPeers(): Promise<void> {
  const closePromises: Promise<void>[] = [];
  for (const peer of PEERS) {
    closePromises.push(
      new Promise<void>((resolve) => {
        try {
          peer.close(1001, "Server shutting down");
          peer.once("close", resolve);
          setTimeout(resolve, 3_000);
        } catch {
          resolve();
        }
      })
    );
  }
  await Promise.all(closePromises);
  PEERS.clear();
  logger.info("All P2P peer connections closed");
}
