import { sha256 } from "./crypto.js";
import { pool } from "@workspace/db";

export interface UTXO {
  txId: string;
  vout: number;
  address: string;
  amount: number;
  scriptPubKey: string;
  blockHeight: number;
  coinbase: boolean;
  spent: boolean;
  spentTxId?: string;
}

export interface UTXOInput {
  txId: string;
  vout: number;
  scriptSig: string;
  sequence: number;
}

export interface UTXOOutput {
  address: string;
  amount: number;
  scriptPubKey: string;
}

export interface UTXOTransaction {
  txId: string;
  inputs: UTXOInput[];
  outputs: UTXOOutput[];
  fee: number;
  timestamp: number;
  blockHeight?: number;
  coinbase: boolean;
  locktime: number;
}

export class UTXOSet {
  async ensureTables(): Promise<void> {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ix_utxos (
        tx_id TEXT NOT NULL,
        vout INTEGER NOT NULL,
        address TEXT NOT NULL,
        amount NUMERIC NOT NULL,
        script_pub_key TEXT NOT NULL DEFAULT '',
        block_height INTEGER NOT NULL DEFAULT 0,
        coinbase BOOLEAN NOT NULL DEFAULT false,
        spent BOOLEAN NOT NULL DEFAULT false,
        spent_tx_id TEXT,
        created_at BIGINT NOT NULL DEFAULT extract(epoch from now())*1000,
        PRIMARY KEY (tx_id, vout)
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS ix_utxos_address ON ix_utxos(address) WHERE spent = false`);
    await pool.query(`CREATE INDEX IF NOT EXISTS ix_utxos_block ON ix_utxos(block_height)`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ix_utxo_txs (
        tx_id TEXT PRIMARY KEY,
        data JSONB NOT NULL,
        block_height INTEGER,
        fee NUMERIC NOT NULL DEFAULT 0,
        coinbase BOOLEAN NOT NULL DEFAULT false,
        timestamp BIGINT NOT NULL,
        created_at BIGINT NOT NULL DEFAULT extract(epoch from now())*1000
      )
    `);
  }

  async addUTXOs(utxos: UTXO[]): Promise<void> {
    for (const utxo of utxos) {
      await pool.query(
        `INSERT INTO ix_utxos (tx_id, vout, address, amount, script_pub_key, block_height, coinbase)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (tx_id, vout) DO NOTHING`,
        [utxo.txId, utxo.vout, utxo.address, utxo.amount, utxo.scriptPubKey, utxo.blockHeight, utxo.coinbase]
      );
    }
  }

  async spendUTXOs(inputs: { txId: string; vout: number; spentTxId: string }[]): Promise<void> {
    for (const inp of inputs) {
      await pool.query(
        `UPDATE ix_utxos SET spent = true, spent_tx_id = $3 WHERE tx_id = $1 AND vout = $2`,
        [inp.txId, inp.vout, inp.spentTxId]
      );
    }
  }

  async getUTXOsForAddress(address: string): Promise<UTXO[]> {
    const res = await pool.query(
      `SELECT tx_id, vout, address, amount, script_pub_key, block_height, coinbase, spent, spent_tx_id
       FROM ix_utxos WHERE address = $1 AND spent = false ORDER BY block_height ASC`,
      [address]
    );
    return res.rows.map((r) => ({
      txId: r.tx_id,
      vout: r.vout,
      address: r.address,
      amount: Number(r.amount),
      scriptPubKey: r.script_pub_key,
      blockHeight: r.block_height,
      coinbase: r.coinbase,
      spent: r.spent,
      spentTxId: r.spent_tx_id,
    }));
  }

  async getUTXO(txId: string, vout: number): Promise<UTXO | null> {
    const res = await pool.query(
      `SELECT * FROM ix_utxos WHERE tx_id = $1 AND vout = $2`,
      [txId, vout]
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      txId: r.tx_id,
      vout: r.vout,
      address: r.address,
      amount: Number(r.amount),
      scriptPubKey: r.script_pub_key,
      blockHeight: r.block_height,
      coinbase: r.coinbase,
      spent: r.spent,
      spentTxId: r.spent_tx_id,
    };
  }

  async getBalanceUTXO(address: string): Promise<number> {
    const res = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) as balance FROM ix_utxos WHERE address = $1 AND spent = false`,
      [address]
    );
    return Number(res.rows[0].balance);
  }

  async saveUTXOTransaction(tx: UTXOTransaction): Promise<void> {
    await pool.query(
      `INSERT INTO ix_utxo_txs (tx_id, data, block_height, fee, coinbase, timestamp)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (tx_id) DO NOTHING`,
      [tx.txId, JSON.stringify(tx), tx.blockHeight ?? null, tx.fee, tx.coinbase, tx.timestamp]
    );
  }

  async getUTXOTransaction(txId: string): Promise<UTXOTransaction | null> {
    const res = await pool.query(`SELECT data FROM ix_utxo_txs WHERE tx_id = $1`, [txId]);
    if (res.rows.length === 0) return null;
    return res.rows[0].data as UTXOTransaction;
  }

  selectUTXOs(utxos: UTXO[], needed: number): { selected: UTXO[]; change: number } | null {
    const sorted = [...utxos].sort((a, b) => b.amount - a.amount);
    let total = 0;
    const selected: UTXO[] = [];
    for (const utxo of sorted) {
      selected.push(utxo);
      total += utxo.amount;
      if (total >= needed) break;
    }
    if (total < needed) return null;
    return { selected, change: total - needed };
  }

  buildScriptPubKey(address: string): string {
    return `OP_DUP OP_HASH160 ${sha256(address).slice(0, 40)} OP_EQUALVERIFY OP_CHECKSIG`;
  }

  buildCoinbaseTxId(height: number, minerAddress: string): string {
    return sha256(`COINBASE:${height}:${minerAddress}:${Date.now()}`);
  }
}

export const utxoSet = new UTXOSet();
