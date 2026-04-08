import { useEffect, useRef, useCallback } from "react";

export type LiveEventType = "NEW_BLOCK" | "NEW_TX" | "STATS" | "PING" | "PONG";

export interface LiveNewBlock {
  height: number;
  hash: string;
  nonce: number;
  difficulty: number;
  txCount: number;
  reward: number;
  fees: number;
  miner: string;
  timestamp: number;
}

export interface LiveNewTx {
  id: string;
  from: string;
  to: string;
  amount: number;
  fee: number;
  timestamp: number;
}

export interface LiveStats {
  height: number;
  difficulty: number;
  totalMinted: number;
  totalBurned: number;
  circulating: number;
  mempoolSize: number;
  blockReward: number;
}

interface UseLiveFeedOptions {
  onNewBlock?: (block: LiveNewBlock) => void;
  onNewTx?: (tx: LiveNewTx) => void;
  onStats?: (stats: LiveStats) => void;
  onConnected?: () => void;
}

/**
 * useLiveFeed — subscribes to the IXCOIN Server-Sent Events stream at /api/events.
 * SSE works reliably behind HTTP/HTTPS proxies.
 * Reconnects automatically with exponential backoff.
 */
export function useLiveFeed(options: UseLiveFeedOptions): void {
  const esRef = useRef<EventSource | null>(null);
  const reconnectDelay = useRef(2000);
  const unmounted = useRef(false);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const connect = useCallback(() => {
    if (unmounted.current) return;

    const es = new EventSource("/api/events");
    esRef.current = es;

    es.addEventListener("STATS", (e: MessageEvent) => {
      try {
        reconnectDelay.current = 2000;
        const data = JSON.parse(e.data as string) as LiveStats;
        optionsRef.current.onStats?.(data);
        optionsRef.current.onConnected?.();
      } catch { /* ignore */ }
    });

    es.addEventListener("NEW_BLOCK", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data as string) as LiveNewBlock;
        optionsRef.current.onNewBlock?.(data);
      } catch { /* ignore */ }
    });

    es.addEventListener("NEW_TX", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data as string) as LiveNewTx;
        optionsRef.current.onNewTx?.(data);
      } catch { /* ignore */ }
    });

    es.onerror = () => {
      es.close();
      if (unmounted.current) return;
      const delay = Math.min(reconnectDelay.current, 30_000);
      reconnectDelay.current = delay * 2;
      setTimeout(connect, delay);
    };
  }, []);

  useEffect(() => {
    unmounted.current = false;
    connect();
    return () => {
      unmounted.current = true;
      esRef.current?.close();
    };
  }, [connect]);
}
