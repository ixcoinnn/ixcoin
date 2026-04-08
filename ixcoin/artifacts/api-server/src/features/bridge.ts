import { pool } from "@workspace/db";
import { sha256 } from "../blockchain/crypto.js";

export type BridgeChain = "ethereum" | "bsc" | "polygon" | "avalanche" | "solana" | "bitcoin";

export type BridgeStatus =
  | "pending"       // waiting for lock confirmation
  | "locked"        // locked on source chain
  | "minting"       // minting on dest chain
  | "completed"     // fully bridged
  | "failed"        // failed/reverted
  | "refunded";     // refunded to sender

export interface BridgeRequest {
  id: string;
  sourceChain: "ixcoin" | BridgeChain;
  destChain: BridgeChain | "ixcoin";
  sender: string;
  recipient: string;
  token: string;
  amount: number;
  bridgeFee: number;
  status: BridgeStatus;
  sourceHash?: string;
  destHash?: string;
  lockHeight?: number;
  confirmations: number;
  requiredConfirmations: number;
  expiresAt: number;
  createdAt: number;
  updatedAt: number;
}

export interface BridgedToken {
  symbol: string;
  name: string;
  sourceChain: BridgeChain;
  sourceAddress: string;   // original contract on source chain
  ixcAddress: string;      // wrapped token address on IXCOIN
  decimals: number;
  bridgeFeePercent: number;
  minBridge: number;
  maxBridge: number;
  totalLocked: number;
  totalBridgedIn: number;
  totalBridgedOut: number;
  active: boolean;
}

// Bridge fees and configuration
export const BRIDGE_CONFIG = {
  baseFeePercent: 0.001,       // 0.1%
  minFee: 0.1,                 // 0.1 IXC minimum fee
  requiredConfirmations: {
    ethereum: 12,
    bsc: 15,
    polygon: 30,
    avalanche: 5,
    solana: 32,
    bitcoin: 6,
    ixcoin: 10,
  } as Record<string, number>,
  expiryMs: 24 * 60 * 60 * 1000, // 24 hours
  supportedChains: ["ethereum", "bsc", "polygon", "avalanche", "solana", "bitcoin"] as BridgeChain[],
  supportedTokens: [
    { symbol: "IXC", name: "IXCoin", sourceChain: "ethereum" as BridgeChain, sourceAddress: "0x0000000000000000000000000000000000000001", ixcAddress: "IXC_NATIVE", decimals: 8, bridgeFeePercent: 0.001, minBridge: 10, maxBridge: 1_000_000, active: true },
    { symbol: "WETH", name: "Wrapped Ether", sourceChain: "ethereum" as BridgeChain, sourceAddress: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", ixcAddress: "WETH_IXC", decimals: 18, bridgeFeePercent: 0.002, minBridge: 0.01, maxBridge: 1000, active: true },
    { symbol: "USDT", name: "Tether USD", sourceChain: "ethereum" as BridgeChain, sourceAddress: "0xdAC17F958D2ee523a2206206994597C13D831ec7", ixcAddress: "USDT_IXC", decimals: 6, bridgeFeePercent: 0.001, minBridge: 10, maxBridge: 1_000_000, active: true },
    { symbol: "WBNB", name: "Wrapped BNB", sourceChain: "bsc" as BridgeChain, sourceAddress: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", ixcAddress: "WBNB_IXC", decimals: 18, bridgeFeePercent: 0.002, minBridge: 0.1, maxBridge: 5000, active: true },
    { symbol: "WBTC", name: "Wrapped Bitcoin", sourceChain: "bitcoin" as BridgeChain, sourceAddress: "BTC_NATIVE", ixcAddress: "WBTC_IXC", decimals: 8, bridgeFeePercent: 0.001, minBridge: 0.001, maxBridge: 100, active: true },
  ] as BridgedToken[],
};

export class BridgeStorage {
  async ensureTables(): Promise<void> {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ix_bridge_requests (
        id TEXT PRIMARY KEY,
        source_chain TEXT NOT NULL,
        dest_chain TEXT NOT NULL,
        sender TEXT NOT NULL,
        recipient TEXT NOT NULL,
        token TEXT NOT NULL,
        amount NUMERIC NOT NULL,
        bridge_fee NUMERIC NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending',
        source_hash TEXT,
        dest_hash TEXT,
        lock_height INTEGER,
        confirmations INTEGER NOT NULL DEFAULT 0,
        required_confirmations INTEGER NOT NULL DEFAULT 10,
        expires_at BIGINT NOT NULL,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ix_bridge_locked (
        token TEXT NOT NULL,
        source_chain TEXT NOT NULL,
        amount NUMERIC NOT NULL DEFAULT 0,
        updated_at BIGINT NOT NULL,
        PRIMARY KEY (token, source_chain)
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ix_bridge_relayer_events (
        id TEXT PRIMARY KEY,
        request_id TEXT NOT NULL REFERENCES ix_bridge_requests(id),
        event_type TEXT NOT NULL,
        data JSONB NOT NULL DEFAULT '{}',
        tx_hash TEXT,
        timestamp BIGINT NOT NULL
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS ix_bridge_sender ON ix_bridge_requests(sender)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS ix_bridge_status ON ix_bridge_requests(status)`);
  }

  async createRequest(req: Omit<BridgeRequest, "updatedAt" | "confirmations">): Promise<void> {
    await pool.query(
      `INSERT INTO ix_bridge_requests
        (id, source_chain, dest_chain, sender, recipient, token, amount, bridge_fee, status, source_hash, lock_height, required_confirmations, expires_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14)`,
      [
        req.id, req.sourceChain, req.destChain, req.sender, req.recipient,
        req.token, req.amount, req.bridgeFee, req.status,
        req.sourceHash ?? null, req.lockHeight ?? null,
        req.requiredConfirmations, req.expiresAt, req.createdAt,
      ]
    );
  }

  async updateRequest(id: string, updates: Partial<Pick<BridgeRequest, "status" | "destHash" | "confirmations" | "lockHeight">>): Promise<void> {
    const sets: string[] = ["updated_at=$2"];
    const params: unknown[] = [id, Date.now()];
    let idx = 3;
    if (updates.status !== undefined) { sets.push(`status=$${idx++}`); params.push(updates.status); }
    if (updates.destHash !== undefined) { sets.push(`dest_hash=$${idx++}`); params.push(updates.destHash); }
    if (updates.confirmations !== undefined) { sets.push(`confirmations=$${idx++}`); params.push(updates.confirmations); }
    if (updates.lockHeight !== undefined) { sets.push(`lock_height=$${idx++}`); params.push(updates.lockHeight); }
    await pool.query(`UPDATE ix_bridge_requests SET ${sets.join(",")} WHERE id=$1`, params);
  }

  async getRequest(id: string): Promise<BridgeRequest | null> {
    const res = await pool.query(`SELECT * FROM ix_bridge_requests WHERE id=$1`, [id]);
    if (res.rows.length === 0) return null;
    return this.rowToRequest(res.rows[0]);
  }

  async getUserRequests(sender: string, limit = 20): Promise<BridgeRequest[]> {
    const res = await pool.query(
      `SELECT * FROM ix_bridge_requests WHERE sender=$1 ORDER BY created_at DESC LIMIT $2`,
      [sender, limit]
    );
    return res.rows.map(this.rowToRequest);
  }

  async getPendingRequests(limit = 50): Promise<BridgeRequest[]> {
    const res = await pool.query(
      `SELECT * FROM ix_bridge_requests WHERE status IN ('pending','locked','minting') ORDER BY created_at ASC LIMIT $1`,
      [limit]
    );
    return res.rows.map(this.rowToRequest);
  }

  async getStats(): Promise<object> {
    const res = await pool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status='completed') as completed,
        COUNT(*) FILTER (WHERE status='pending' OR status='locked') as pending,
        COUNT(*) FILTER (WHERE status='failed') as failed,
        COALESCE(SUM(amount) FILTER (WHERE status='completed'), 0) as total_volume,
        COALESCE(SUM(bridge_fee) FILTER (WHERE status='completed'), 0) as total_fees
      FROM ix_bridge_requests
    `);
    return res.rows[0];
  }

  async addRelayerEvent(requestId: string, eventType: string, data: object, txHash?: string): Promise<void> {
    await pool.query(
      `INSERT INTO ix_bridge_relayer_events (id, request_id, event_type, data, tx_hash, timestamp)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [sha256(`${requestId}:${eventType}:${Date.now()}`), requestId, eventType, JSON.stringify(data), txHash ?? null, Date.now()]
    );
  }

  async updateLockedAmount(token: string, sourceChain: string, delta: number): Promise<void> {
    await pool.query(
      `INSERT INTO ix_bridge_locked (token, source_chain, amount, updated_at) VALUES ($1,$2,$3,$4)
       ON CONFLICT (token, source_chain) DO UPDATE SET amount=GREATEST(ix_bridge_locked.amount+$3, 0), updated_at=$4`,
      [token, sourceChain, delta, Date.now()]
    );
  }

  async getLockedAmounts(): Promise<object[]> {
    const res = await pool.query(`SELECT * FROM ix_bridge_locked ORDER BY amount DESC`);
    return res.rows;
  }

  private rowToRequest(r: Record<string, unknown>): BridgeRequest {
    return {
      id: r.id as string, sourceChain: r.source_chain as BridgeRequest["sourceChain"],
      destChain: r.dest_chain as BridgeRequest["destChain"],
      sender: r.sender as string, recipient: r.recipient as string,
      token: r.token as string, amount: Number(r.amount),
      bridgeFee: Number(r.bridge_fee), status: r.status as BridgeStatus,
      sourceHash: r.source_hash as string | undefined,
      destHash: r.dest_hash as string | undefined,
      lockHeight: r.lock_height as number | undefined,
      confirmations: Number(r.confirmations),
      requiredConfirmations: Number(r.required_confirmations),
      expiresAt: Number(r.expires_at), createdAt: Number(r.created_at), updatedAt: Number(r.updated_at),
    };
  }
}

export function calcBridgeFee(amount: number, token: string): number {
  const cfg = BRIDGE_CONFIG.supportedTokens.find((t) => t.symbol === token);
  const pct = cfg?.bridgeFeePercent ?? BRIDGE_CONFIG.baseFeePercent;
  return Math.max(amount * pct, BRIDGE_CONFIG.minFee);
}

export function generateBridgeId(sender: string, token: string, amount: number): string {
  return sha256(`bridge:${sender}:${token}:${amount}:${Date.now()}`).slice(0, 32);
}

export const bridgeStorage = new BridgeStorage();
