import { pool } from "@workspace/db";
import { Transaction } from "./transaction.js";
import { Block } from "./block.js";

export class BlockchainStorage {
  async ensureTables(): Promise<void> {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ix_blocks (
        height INTEGER PRIMARY KEY,
        hash TEXT NOT NULL,
        previous_hash TEXT NOT NULL,
        timestamp BIGINT NOT NULL,
        nonce BIGINT NOT NULL DEFAULT 0,
        difficulty INTEGER NOT NULL DEFAULT 1,
        merkle_root TEXT,
        state_root TEXT NOT NULL DEFAULT '',
        miner TEXT NOT NULL,
        block_reward NUMERIC NOT NULL DEFAULT 0,
        total_fees NUMERIC NOT NULL DEFAULT 0,
        tx_count INTEGER NOT NULL DEFAULT 0,
        size_bytes INTEGER NOT NULL DEFAULT 0,
        data JSONB NOT NULL
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ix_transactions (
        id TEXT PRIMARY KEY,
        block_height INTEGER NOT NULL,
        block_hash TEXT NOT NULL,
        from_addr TEXT NOT NULL,
        to_addr TEXT NOT NULL,
        amount NUMERIC NOT NULL,
        fee NUMERIC NOT NULL DEFAULT 0,
        gas_price NUMERIC NOT NULL DEFAULT 1,
        gas_used INTEGER NOT NULL DEFAULT 21000,
        nonce INTEGER NOT NULL DEFAULT 0,
        signature TEXT,
        public_key TEXT,
        contract TEXT,
        status TEXT NOT NULL DEFAULT 'confirmed',
        timestamp BIGINT NOT NULL,
        data JSONB NOT NULL
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ix_config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ix_wallets (
        address TEXT PRIMARY KEY,
        public_key TEXT NOT NULL,
        mnemonic TEXT NOT NULL,
        is_genesis BOOLEAN NOT NULL DEFAULT false,
        created_at BIGINT NOT NULL
      )
    `);
    await pool.query(`
      ALTER TABLE ix_blocks ADD COLUMN IF NOT EXISTS state_root TEXT NOT NULL DEFAULT ''
    `);

    // ─── Performance indexes (critical for scale) ─────────────────────────────
    // These make address queries, block lookups, and TX searches O(log n) instead of O(n).
    await pool.query(`CREATE INDEX IF NOT EXISTS ix_tx_from_addr ON ix_transactions (from_addr)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS ix_tx_to_addr ON ix_transactions (to_addr)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS ix_tx_timestamp ON ix_transactions (timestamp DESC)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS ix_tx_block_height ON ix_transactions (block_height)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS ix_tx_status ON ix_transactions (status)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS ix_blocks_hash ON ix_blocks (hash)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS ix_blocks_miner ON ix_blocks (miner)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS ix_blocks_timestamp ON ix_blocks (timestamp DESC)`);
  }

  async saveBlock(block: Block): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO ix_blocks
          (height, hash, previous_hash, timestamp, nonce, difficulty, merkle_root,
           state_root, miner, block_reward, total_fees, tx_count, size_bytes, data)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT (height) DO UPDATE SET
           hash=$2, state_root=$8, data=$14`,
        [
          block.height,
          block.hash,
          block.previousHash,
          block.timestamp,
          block.nonce,
          block.difficulty,
          block.merkleRoot,
          block.stateRoot,
          block.miner,
          block.blockReward,
          block.totalFees,
          block.txCount,
          block.sizeBytes,
          JSON.stringify(block.toJSON()),
        ]
      );

      for (const tx of block.transactions) {
        await client.query(
          `INSERT INTO ix_transactions
            (id, block_height, block_hash, from_addr, to_addr, amount, fee,
             gas_price, gas_used, nonce, signature, public_key, contract, status, timestamp, data)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
           ON CONFLICT (id) DO NOTHING`,
          [
            tx.id,
            block.height,
            block.hash,
            tx.from,
            tx.to,
            tx.amount,
            tx.fee,
            tx.gasPrice,
            tx.gasUsed,
            tx.nonce,
            tx.signature ?? null,
            tx.publicKey ?? null,
            tx.contract ? JSON.stringify(tx.contract) : null,
            "confirmed",
            tx.timestamp,
            JSON.stringify(tx.toJSON()),
          ]
        );
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async loadChain(): Promise<Block[]> {
    const res = await pool.query(
      "SELECT data FROM ix_blocks ORDER BY height ASC"
    );
    return res.rows.map((r) => {
      const d = typeof r.data === "string" ? JSON.parse(r.data) : r.data;
      return this.deserializeBlock(d);
    });
  }

  deserializeBlock(d: ReturnType<Block["toJSON"]>): Block {
    const txs = (d.transactions ?? []).map((t: ReturnType<Transaction["toJSON"]>) => {
      const tx = new Transaction({
        from: t.from,
        to: t.to,
        amount: Number(t.amount),
        fee: Number(t.fee),
        gasPrice: Number(t.gasPrice),
        gasUsed: Number(t.gasUsed),
        nonce: t.nonce,
        contract: t.contract ?? null,
      });
      tx.id = t.id;
      tx.timestamp = t.timestamp;
      tx.signature = t.signature;
      tx.publicKey = t.publicKey;
      tx.status = t.status as "pending" | "confirmed" | "failed";
      return tx;
    });

    // BUG FIX: restore stateRoot and merkleRoot from stored data.
    // Without stateRoot, computeHash() would produce a different hash than
    // what was stored, breaking hash integrity verification on chain reload.
    const block = new Block({
      height: d.height,
      previousHash: d.previousHash,
      timestamp: d.timestamp,
      difficulty: d.difficulty,
      miner: d.miner,
      transactions: txs,
      blockReward: Number(d.blockReward),
      totalFees: Number(d.totalFees),
      stateRoot: d.stateRoot ?? "",
      merkleRoot: d.merkleRoot,
    });
    block.hash = d.hash;
    block.nonce = d.nonce;
    return block;
  }

  async getBlock(hashOrHeight: string | number): Promise<Block | null> {
    const query =
      typeof hashOrHeight === "number"
        ? "SELECT data FROM ix_blocks WHERE height = $1"
        : "SELECT data FROM ix_blocks WHERE hash = $1";
    const res = await pool.query(query, [hashOrHeight]);
    if (!res.rows.length) return null;
    const d = typeof res.rows[0].data === "string"
      ? JSON.parse(res.rows[0].data)
      : res.rows[0].data;
    return this.deserializeBlock(d);
  }

  async getTransaction(id: string) {
    const res = await pool.query(
      "SELECT data FROM ix_transactions WHERE id = $1",
      [id]
    );
    if (!res.rows.length) return null;
    return typeof res.rows[0].data === "string"
      ? JSON.parse(res.rows[0].data)
      : res.rows[0].data;
  }

  async getAddressTransactions(address: string, limit = 20, offset = 0) {
    const res = await pool.query(
      `SELECT data FROM ix_transactions
       WHERE from_addr = $1 OR to_addr = $1
       ORDER BY timestamp DESC LIMIT $2 OFFSET $3`,
      [address, limit, offset]
    );
    return res.rows.map((r) =>
      typeof r.data === "string" ? JSON.parse(r.data) : r.data
    );
  }

  /** Efficient COUNT query — avoids fetching all TX rows just to count them */
  async getAddressTxCount(address: string): Promise<number> {
    const res = await pool.query(
      `SELECT COUNT(*) as cnt FROM ix_transactions WHERE from_addr = $1 OR to_addr = $1`,
      [address]
    );
    return Number(res.rows[0]?.cnt ?? 0);
  }

  async saveConfig(key: string, value: string): Promise<void> {
    await pool.query(
      `INSERT INTO ix_config (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = $2`,
      [key, value]
    );
  }

  async getConfig(key: string): Promise<string | null> {
    const res = await pool.query(
      "SELECT value FROM ix_config WHERE key = $1",
      [key]
    );
    return res.rows.length ? res.rows[0].value : null;
  }

  async saveWallet(address: string, publicKey: string, mnemonic: string, isGenesis = false): Promise<void> {
    await pool.query(
      `INSERT INTO ix_wallets (address, public_key, mnemonic, is_genesis, created_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (address) DO NOTHING`,
      [address, publicKey, mnemonic, isGenesis, Date.now()]
    );
  }

  async getGenesisWallet() {
    const res = await pool.query(
      "SELECT address, public_key, mnemonic FROM ix_wallets WHERE is_genesis = true LIMIT 1"
    );
    return res.rows[0] ?? null;
  }

  async getChainHeight(): Promise<number> {
    const res = await pool.query(
      "SELECT COALESCE(MAX(height), -1) as height FROM ix_blocks"
    );
    return Number(res.rows[0].height);
  }

  async getTotalTransactions(): Promise<number> {
    const res = await pool.query("SELECT COUNT(*) as cnt FROM ix_transactions");
    return Number(res.rows[0].cnt);
  }

  async getRecentBlocks(limit = 10): Promise<object[]> {
    const res = await pool.query(
      `SELECT height, hash, previous_hash, timestamp, miner, block_reward, total_fees, tx_count, difficulty
       FROM ix_blocks ORDER BY height DESC LIMIT $1`,
      [limit]
    );
    return res.rows;
  }

  async getRecentTransactions(limit = 10): Promise<object[]> {
    const res = await pool.query(
      `SELECT id, block_height, from_addr, to_addr, amount, fee, status, timestamp
       FROM ix_transactions ORDER BY timestamp DESC LIMIT $1`,
      [limit]
    );
    return res.rows;
  }

  async searchBlocks(query: string): Promise<object[]> {
    const height = parseInt(query);
    if (!isNaN(height)) {
      const res = await pool.query(
        "SELECT * FROM ix_blocks WHERE height = $1",
        [height]
      );
      return res.rows;
    }
    const res = await pool.query(
      "SELECT * FROM ix_blocks WHERE hash ILIKE $1 LIMIT 5",
      [`%${query}%`]
    );
    return res.rows;
  }

  async ensureContractTable(): Promise<void> {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ix_contracts (
        address TEXT PRIMARY KEY,
        deployer TEXT NOT NULL,
        name TEXT NOT NULL DEFAULT 'Unnamed Contract',
        description TEXT NOT NULL DEFAULT '',
        code TEXT NOT NULL,
        state JSONB NOT NULL DEFAULT '{}',
        deploy_tx TEXT,
        block_height INTEGER,
        created_at BIGINT NOT NULL,
        call_count INTEGER NOT NULL DEFAULT 0
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ix_contract_calls (
        id TEXT PRIMARY KEY,
        contract_address TEXT NOT NULL,
        caller TEXT NOT NULL,
        call_code TEXT NOT NULL,
        result JSONB,
        logs JSONB,
        gas_used INTEGER NOT NULL DEFAULT 0,
        success BOOLEAN NOT NULL DEFAULT false,
        tx_id TEXT,
        amount NUMERIC NOT NULL DEFAULT 0,
        created_at BIGINT NOT NULL
      )
    `);
  }

  async saveContract(params: {
    address: string;
    deployer: string;
    name: string;
    description: string;
    code: string;
    state: Record<string, unknown>;
    deployTx?: string;
    blockHeight?: number;
  }): Promise<void> {
    await pool.query(
      `INSERT INTO ix_contracts (address, deployer, name, description, code, state, deploy_tx, block_height, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (address) DO NOTHING`,
      [
        params.address,
        params.deployer,
        params.name,
        params.description,
        params.code,
        JSON.stringify(params.state),
        params.deployTx ?? null,
        params.blockHeight ?? null,
        Date.now(),
      ]
    );
  }

  async updateContractState(address: string, state: Record<string, unknown>): Promise<void> {
    await pool.query(
      `UPDATE ix_contracts SET state = $2, call_count = call_count + 1 WHERE address = $1`,
      [address, JSON.stringify(state)]
    );
  }

  async getContract(address: string): Promise<{
    address: string;
    deployer: string;
    name: string;
    description: string;
    code: string;
    state: Record<string, unknown>;
    deployTx: string | null;
    blockHeight: number | null;
    createdAt: number;
    callCount: number;
  } | null> {
    const res = await pool.query(
      "SELECT * FROM ix_contracts WHERE address = $1",
      [address]
    );
    if (!res.rows.length) return null;
    const r = res.rows[0];
    return {
      address: r.address,
      deployer: r.deployer,
      name: r.name,
      description: r.description,
      code: r.code,
      state: typeof r.state === "string" ? JSON.parse(r.state) : r.state,
      deployTx: r.deploy_tx,
      blockHeight: r.block_height,
      createdAt: Number(r.created_at),
      callCount: Number(r.call_count),
    };
  }

  async listContracts(limit = 20, offset = 0): Promise<{
    address: string;
    deployer: string;
    name: string;
    description: string;
    callCount: number;
    createdAt: number;
    blockHeight: number | null;
  }[]> {
    const res = await pool.query(
      `SELECT address, deployer, name, description, call_count, created_at, block_height
       FROM ix_contracts ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    return res.rows.map((r) => ({
      address: r.address,
      deployer: r.deployer,
      name: r.name,
      description: r.description,
      callCount: Number(r.call_count),
      createdAt: Number(r.created_at),
      blockHeight: r.block_height,
    }));
  }

  async saveContractCall(params: {
    id: string;
    contractAddress: string;
    caller: string;
    callCode: string;
    result: unknown;
    logs: string[];
    gasUsed: number;
    success: boolean;
    txId?: string;
    amount?: number;
  }): Promise<void> {
    await pool.query(
      `INSERT INTO ix_contract_calls (id, contract_address, caller, call_code, result, logs, gas_used, success, tx_id, amount, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        params.id,
        params.contractAddress,
        params.caller,
        params.callCode,
        JSON.stringify(params.result),
        JSON.stringify(params.logs),
        params.gasUsed,
        params.success,
        params.txId ?? null,
        params.amount ?? 0,
        Date.now(),
      ]
    );
  }

  async getContractCalls(contractAddress: string, limit = 10): Promise<object[]> {
    const res = await pool.query(
      `SELECT id, caller, call_code, result, logs, gas_used, success, tx_id, amount, created_at
       FROM ix_contract_calls WHERE contract_address = $1
       ORDER BY created_at DESC LIMIT $2`,
      [contractAddress, limit]
    );
    return res.rows.map((r) => ({
      id: r.id,
      caller: r.caller,
      callCode: r.call_code,
      result: typeof r.result === "string" ? JSON.parse(r.result) : r.result,
      logs: typeof r.logs === "string" ? JSON.parse(r.logs) : r.logs,
      gasUsed: Number(r.gas_used),
      success: r.success,
      txId: r.tx_id,
      amount: Number(r.amount),
      createdAt: Number(r.created_at),
    }));
  }

  async ensureRWATable(): Promise<void> {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ix_rwa_tokens (
        address TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        symbol TEXT NOT NULL,
        asset_type TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        location TEXT NOT NULL DEFAULT '',
        total_supply NUMERIC NOT NULL DEFAULT 1000,
        issuer TEXT NOT NULL,
        value_idc NUMERIC NOT NULL DEFAULT 0,
        document_hash TEXT NOT NULL DEFAULT '',
        metadata JSONB NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'active',
        mint_tx TEXT,
        created_at BIGINT NOT NULL
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ix_rwa_holdings (
        token_address TEXT NOT NULL,
        owner_address TEXT NOT NULL,
        amount NUMERIC NOT NULL DEFAULT 0,
        PRIMARY KEY (token_address, owner_address)
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ix_rwa_transfers (
        id TEXT PRIMARY KEY,
        token_address TEXT NOT NULL,
        from_address TEXT NOT NULL,
        to_address TEXT NOT NULL,
        amount NUMERIC NOT NULL,
        tx_id TEXT,
        memo TEXT NOT NULL DEFAULT '',
        created_at BIGINT NOT NULL
      )
    `);
  }

  async saveRWAToken(params: {
    address: string;
    name: string;
    symbol: string;
    assetType: string;
    description: string;
    location: string;
    totalSupply: number;
    issuer: string;
    valueIdc: number;
    documentHash: string;
    metadata: Record<string, unknown>;
    mintTx?: string;
  }): Promise<void> {
    await pool.query(
      `INSERT INTO ix_rwa_tokens
        (address, name, symbol, asset_type, description, location, total_supply, issuer, value_idc, document_hash, metadata, status, mint_tx, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'active',$12,$13)
       ON CONFLICT (address) DO NOTHING`,
      [
        params.address, params.name, params.symbol, params.assetType,
        params.description, params.location, params.totalSupply, params.issuer,
        params.valueIdc, params.documentHash, JSON.stringify(params.metadata),
        params.mintTx ?? null, Date.now(),
      ]
    );
    await pool.query(
      `INSERT INTO ix_rwa_holdings (token_address, owner_address, amount)
       VALUES ($1, $2, $3)
       ON CONFLICT (token_address, owner_address) DO UPDATE SET amount = ix_rwa_holdings.amount + $3`,
      [params.address, params.issuer, params.totalSupply]
    );
  }

  async getRWAToken(address: string): Promise<{
    address: string; name: string; symbol: string; assetType: string;
    description: string; location: string; totalSupply: number; issuer: string;
    valueIdc: number; documentHash: string; metadata: Record<string, unknown>;
    status: string; mintTx: string | null; createdAt: number;
  } | null> {
    const res = await pool.query("SELECT * FROM ix_rwa_tokens WHERE address = $1", [address]);
    if (!res.rows.length) return null;
    const r = res.rows[0];
    return {
      address: r.address, name: r.name, symbol: r.symbol, assetType: r.asset_type,
      description: r.description, location: r.location, totalSupply: Number(r.total_supply),
      issuer: r.issuer, valueIdc: Number(r.value_idc), documentHash: r.document_hash,
      metadata: typeof r.metadata === "string" ? JSON.parse(r.metadata) : r.metadata,
      status: r.status, mintTx: r.mint_tx, createdAt: Number(r.created_at),
    };
  }

  async listRWATokens(limit = 20, assetType?: string): Promise<object[]> {
    const args: unknown[] = [limit];
    const where = assetType ? `WHERE asset_type = $2` : "";
    if (assetType) args.push(assetType);
    const res = await pool.query(
      `SELECT address, name, symbol, asset_type, description, location, total_supply, issuer, value_idc, status, created_at
       FROM ix_rwa_tokens ${where} ORDER BY created_at DESC LIMIT $1`,
      args
    );
    return res.rows.map((r) => ({
      address: r.address, name: r.name, symbol: r.symbol, assetType: r.asset_type,
      description: r.description, location: r.location, totalSupply: Number(r.total_supply),
      issuer: r.issuer, valueIdc: Number(r.value_idc), status: r.status,
      createdAt: Number(r.created_at),
    }));
  }

  async transferRWA(params: {
    id: string;
    tokenAddress: string;
    fromAddress: string;
    toAddress: string;
    amount: number;
    txId?: string;
    memo?: string;
  }): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const holding = await client.query(
        "SELECT amount FROM ix_rwa_holdings WHERE token_address = $1 AND owner_address = $2",
        [params.tokenAddress, params.fromAddress]
      );
      const balance = holding.rows.length ? Number(holding.rows[0].amount) : 0;
      if (balance < params.amount) throw new Error("Saldo token RWA tidak cukup");

      await client.query(
        `UPDATE ix_rwa_holdings SET amount = amount - $3
         WHERE token_address = $1 AND owner_address = $2`,
        [params.tokenAddress, params.fromAddress, params.amount]
      );
      await client.query(
        `INSERT INTO ix_rwa_holdings (token_address, owner_address, amount)
         VALUES ($1, $2, $3)
         ON CONFLICT (token_address, owner_address) DO UPDATE SET amount = ix_rwa_holdings.amount + $3`,
        [params.tokenAddress, params.toAddress, params.amount]
      );
      await client.query(
        `INSERT INTO ix_rwa_transfers (id, token_address, from_address, to_address, amount, tx_id, memo, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [params.id, params.tokenAddress, params.fromAddress, params.toAddress,
         params.amount, params.txId ?? null, params.memo ?? "", Date.now()]
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async getRWAHoldings(ownerAddress: string): Promise<object[]> {
    const res = await pool.query(
      `SELECT h.token_address, h.amount, t.name, t.symbol, t.asset_type, t.value_idc, t.status
       FROM ix_rwa_holdings h
       JOIN ix_rwa_tokens t ON t.address = h.token_address
       WHERE h.owner_address = $1 AND h.amount > 0
       ORDER BY h.amount DESC`,
      [ownerAddress]
    );
    return res.rows.map((r) => ({
      tokenAddress: r.token_address, amount: Number(r.amount),
      name: r.name, symbol: r.symbol, assetType: r.asset_type,
      valueIdc: Number(r.value_idc), status: r.status,
    }));
  }

  async getRWATransfers(tokenAddress: string, limit = 20): Promise<object[]> {
    const res = await pool.query(
      `SELECT id, from_address, to_address, amount, tx_id, memo, created_at
       FROM ix_rwa_transfers WHERE token_address = $1
       ORDER BY created_at DESC LIMIT $2`,
      [tokenAddress, limit]
    );
    return res.rows.map((r) => ({
      id: r.id, from: r.from_address, to: r.to_address,
      amount: Number(r.amount), txId: r.tx_id, memo: r.memo,
      createdAt: Number(r.created_at),
    }));
  }

  async getRWAHolders(tokenAddress: string): Promise<object[]> {
    const res = await pool.query(
      `SELECT owner_address, amount FROM ix_rwa_holdings
       WHERE token_address = $1 AND amount > 0
       ORDER BY amount DESC LIMIT 20`,
      [tokenAddress]
    );
    return res.rows.map((r) => ({
      address: r.owner_address, amount: Number(r.amount),
    }));
  }
}
