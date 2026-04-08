import { CHAIN_CONFIG } from "./config.js";
import { IXWallet } from "./wallet.js";
import { Transaction } from "./transaction.js";
import { Block } from "./block.js";
import { GasSystem } from "./gas.js";
import { BlockchainStorage } from "./storage.js";
import { logger } from "../lib/logger.js";
import {
  GlobalState,
  emptyGlobalState,
  withState,
} from "./state.js";
import { applyBlock, applyTransaction, replayStateFromChain } from "./state-machine.js";

export class IXCoinBlockchain {
  chain: Block[] = [];
  mempool: Transaction[] = [];

  /**
   * GlobalState — single source of truth.
   * All balance/nonce/contract queries read from here.
   * Never mutated directly — always replaced via state-machine functions.
   */
  globalState: GlobalState = emptyGlobalState();

  difficulty: number = CHAIN_CONFIG.INITIAL_DIFFICULTY;

  /** Tracks the number of unique active miners in the previous adjustment window */
  private _prevMinerCount: number = 0;

  get balances(): Readonly<Record<string, number>> {
    return this.globalState.balances;
  }

  get nonces(): Readonly<Record<string, number>> {
    return this.globalState.nonces;
  }

  get totalMinted(): number {
    return this.globalState.totalMinted;
  }

  get totalBurned(): number {
    return this.globalState.totalBurned;
  }

  get contractState(): Readonly<Record<string, unknown>> {
    return Object.fromEntries(
      Object.entries(this.globalState.contractStorage).map(([k, v]) => [k, v.state])
    );
  }

  gas = new GasSystem();
  storage = new BlockchainStorage();

  private initialized = false;
  private _genesisAddress = "";

  async init(): Promise<{ genesisAddress: string; mnemonic: string }> {
    if (this.initialized) {
      return { genesisAddress: this._genesisAddress, mnemonic: CHAIN_CONFIG.GENESIS_MNEMONIC };
    }

    await this.storage.ensureTables();
    this.chain = await this.storage.loadChain();

    if (this.chain.length === 0) {
      logger.info("Initializing IXCOIN genesis block...");
      const result = await this.createGenesisBlock();
      this._genesisAddress = result.genesisAddress;
      this.initialized = true;
      setInterval(() => this.cleanExpiredMempool(), 10 * 60 * 1000).unref();
      return result;
    }

    // Migrate legacy genesis block: if genesis hash is the custom non-PoW format,
    // re-mine it with real PoW and update DB
    const genesis = this.chain[0];
    if (genesis && !genesis.hash.match(/^[0-9a-f]{64}$/i)) {
      logger.info("Migrating legacy genesis block to PoW hash...");
      const target = "0".repeat(CHAIN_CONFIG.INITIAL_DIFFICULTY);
      let nonce = 0;
      let hash = "";
      while (true) {
        hash = genesis.computeHash(nonce);
        if (hash.startsWith(target)) break;
        nonce++;
      }
      genesis.hash = hash;
      genesis.nonce = nonce;
      // Also ensure genesis tx is confirmed
      for (const tx of genesis.transactions) {
        tx.status = "confirmed";
      }
      await this.storage.saveBlock(genesis);
      logger.info({ nonce, hash: hash.slice(0, 20) + "..." }, "Genesis block migrated to PoW hash");
    }

    this.globalState = replayStateFromChain(this.chain, this.gas);
    await this.replayDifficulty();

    const savedAddr = await this.storage.getConfig("genesis_address");
    this._genesisAddress = savedAddr ?? "";

    this.initialized = true;

    // Periodically clean stale/failed transactions from the mempool
    setInterval(() => this.cleanExpiredMempool(), 10 * 60 * 1000).unref();

    logger.info(
      { height: this.chain.length - 1, difficulty: this.difficulty, stateRoot: this.globalState.stateRoot },
      "IXCOIN blockchain loaded"
    );
    return { genesisAddress: savedAddr ?? "", mnemonic: CHAIN_CONFIG.GENESIS_MNEMONIC };
  }

  private async createGenesisBlock(): Promise<{ genesisAddress: string; mnemonic: string }> {
    const wallet = IXWallet.fromMnemonic(CHAIN_CONFIG.GENESIS_MNEMONIC);

    await this.storage.saveWallet(wallet.address, wallet.publicKeyHex, wallet.mnemonic, true);
    await this.storage.saveConfig("genesis_address", wallet.address);
    await this.storage.saveConfig("genesis_mnemonic", wallet.mnemonic);
    await this.storage.saveConfig("genesis_pubkey", wallet.publicKeyHex);

    const premineAmount = CHAIN_CONFIG.PREMINE;
    const genesisTx = Transaction.fromSystem(wallet.address, premineAmount);
    genesisTx.timestamp = CHAIN_CONFIG.GENESIS_TIMESTAMP;

    let state = emptyGlobalState();
    const txResult = applyTransaction(state, genesisTx, 0, CHAIN_CONFIG.GENESIS_TIMESTAMP, this.gas);
    state = txResult.state;

    // Mark genesis tx as confirmed (not pending)
    genesisTx.status = "confirmed";

    const genesisBlock = new Block({
      height: 0,
      previousHash: "0000000000000000000000000000000000000000000000000000000000000000",
      timestamp: CHAIN_CONFIG.GENESIS_TIMESTAMP,
      difficulty: CHAIN_CONFIG.INITIAL_DIFFICULTY,
      miner: "GENESIS",
      transactions: [genesisTx],
      blockReward: premineAmount,
      totalFees: 0,
      stateRoot: state.stateRoot,
    });

    // Mine the genesis block with real PoW — hash must start with INITIAL_DIFFICULTY leading zeros
    logger.info({ difficulty: CHAIN_CONFIG.INITIAL_DIFFICULTY }, "Mining genesis block with PoW...");
    let genesisNonce = 0;
    let genesisHash = "";
    const target = "0".repeat(CHAIN_CONFIG.INITIAL_DIFFICULTY);
    while (true) {
      genesisHash = genesisBlock.computeHash(genesisNonce);
      if (genesisHash.startsWith(target)) break;
      genesisNonce++;
    }
    genesisBlock.hash = genesisHash;
    genesisBlock.nonce = genesisNonce;

    logger.info({ nonce: genesisNonce, hash: genesisHash.slice(0, 20) + "..." }, "Genesis PoW solved");

    this.globalState = state;
    this.chain.push(genesisBlock);

    await this.storage.saveBlock(genesisBlock);

    logger.info({ address: wallet.address, premine: premineAmount, stateRoot: state.stateRoot }, "IXCOIN Genesis block created");
    if (process.env["NODE_ENV"] !== "production") {
      logger.info({ mnemonic: "[REDACTED_IN_PRODUCTION]" }, "GENESIS WALLET MNEMONIC — dev only");
    }

    return { genesisAddress: wallet.address, mnemonic: wallet.mnemonic };
  }

  /**
   * Count unique active miners in a slice of the chain.
   */
  private _countMiners(start: number, end: number): number {
    const miners = new Set<string>();
    for (let i = start; i < end && i < this.chain.length; i++) {
      const miner = this.chain[i]?.miner;
      if (miner && miner !== "GENESIS") miners.add(miner);
    }
    return miners.size;
  }

  private async replayDifficulty(): Promise<void> {
    this.difficulty = CHAIN_CONFIG.INITIAL_DIFFICULTY;
    this._prevMinerCount = 0;
    const n = this.chain.length;
    const interval = CHAIN_CONFIG.DIFFICULTY_ADJUSTMENT_INTERVAL;

    for (let i = interval; i <= n; i += interval) {
      const prevStart = Math.max(0, i - interval * 2);
      const prevEnd = i - interval;
      const currStart = i - interval;
      const currEnd = i;

      const prevCount = prevEnd > prevStart ? this._countMiners(prevStart, prevEnd) : 0;
      const currCount = this._countMiners(currStart, currEnd);

      if (prevCount === 0) {
        this._prevMinerCount = currCount;
        continue;
      }

      if (currCount > prevCount) {
        const increase = currCount - prevCount;
        this.difficulty = Math.max(CHAIN_CONFIG.INITIAL_DIFFICULTY, this.difficulty + increase);
      } else if (currCount < prevCount) {
        const decrease = prevCount - currCount;
        this.difficulty = Math.max(CHAIN_CONFIG.INITIAL_DIFFICULTY, this.difficulty - decrease);
      }

      this._prevMinerCount = currCount;
    }
  }

  getBalance(address: string): number {
    return Math.max(0, this.globalState.balances[address] ?? 0);
  }

  getNonce(address: string): number {
    return this.globalState.nonces[address] ?? 0;
  }

  getPendingOutflow(address: string): number {
    return this.mempool
      .filter((tx) => tx.from === address)
      .reduce((sum, tx) => sum + tx.amount + tx.fee, 0);
  }

  getBlockReward(height: number): number {
    const halvings = Math.floor(height / CHAIN_CONFIG.HALVING_INTERVAL);
    const reward = CHAIN_CONFIG.INITIAL_REWARD / Math.pow(2, halvings);
    const remainingMining = CHAIN_CONFIG.MINING_SUPPLY - (this.totalMinted - CHAIN_CONFIG.PREMINE);
    if (remainingMining <= 0) return 0;
    return Math.min(reward, Math.max(0, remainingMining));
  }

  adjustDifficulty(): number {
    const n = this.chain.length;
    const interval = CHAIN_CONFIG.DIFFICULTY_ADJUSTMENT_INTERVAL;
    if (n < interval || n % interval !== 0) return this.difficulty;

    // Count unique active miners in the current window
    const currStart = n - interval;
    const currEnd = n;
    const currMinerCount = this._countMiners(currStart, currEnd);

    const oldDiff = this.difficulty;
    const prevCount = this._prevMinerCount;

    if (prevCount === 0) {
      // First window — just record the baseline
      this._prevMinerCount = currMinerCount;
      return this.difficulty;
    }

    if (currMinerCount > prevCount) {
      // More miners joined — increase difficulty by the difference
      const increase = currMinerCount - prevCount;
      this.difficulty = Math.max(CHAIN_CONFIG.INITIAL_DIFFICULTY, this.difficulty + increase);
    } else if (currMinerCount < prevCount) {
      // Miners left — decrease difficulty by the difference
      const decrease = prevCount - currMinerCount;
      this.difficulty = Math.max(CHAIN_CONFIG.INITIAL_DIFFICULTY, this.difficulty - decrease);
    }

    this._prevMinerCount = currMinerCount;

    if (this.difficulty !== oldDiff) {
      logger.info(
        { oldDiff, newDiff: this.difficulty, prevMiners: prevCount, currMiners: currMinerCount },
        "IXCOIN Difficulty adjusted based on miner count"
      );
    }

    return this.difficulty;
  }

  addTransaction(tx: Transaction): void {
    if (!tx.isValid()) throw new Error("Tanda tangan transaksi tidak valid");

    const available = this.getBalance(tx.from) - this.getPendingOutflow(tx.from);
    if (available < tx.amount + tx.fee) {
      throw new Error(
        `Saldo tidak cukup: tersedia ${available.toFixed(8)}, butuh ${(tx.amount + tx.fee).toFixed(8)} IXC`
      );
    }

    const expectedNonce = this.getNonce(tx.from);
    if (tx.nonce < expectedNonce) {
      throw new Error(`Nonce tidak valid: expected ${expectedNonce}, got ${tx.nonce}`);
    }

    if (this.mempool.some((t) => t.id === tx.id)) throw new Error("Transaksi duplikat");

    // Enforce max mempool size to prevent memory exhaustion
    const MAX_MEMPOOL = CHAIN_CONFIG.MAX_TX_PER_BLOCK * 10;
    if (this.mempool.length >= MAX_MEMPOOL) {
      // Evict the cheapest transaction to make room
      this.mempool.sort((a, b) => b.fee - a.fee);
      this.mempool.pop();
    }

    this.mempool.push(tx);
  }

  /**
   * Remove stale transactions from the mempool:
   * - transactions that have been pending > 24h
   * - transactions that were marked failed
   * Called periodically via setInterval in init()
   */
  cleanExpiredMempool(): void {
    const before = this.mempool.length;
    const now = Date.now();
    const MAX_AGE_MS = 24 * 60 * 60 * 1000;
    this.mempool = this.mempool.filter((tx) => {
      if (tx.status === "failed") return false;
      if (now - tx.timestamp > MAX_AGE_MS) return false;
      return true;
    });
    const removed = before - this.mempool.length;
    if (removed > 0) {
      logger.info({ removed, mempoolSize: this.mempool.length }, "Cleaned stale transactions from mempool");
    }
  }

  validateChain(): { valid: boolean; error?: string } {
    for (let i = 1; i < this.chain.length; i++) {
      const block = this.chain[i];
      const prev = this.chain[i - 1];
      if (!block.isValid(prev)) {
        return { valid: false, error: `Block ${i} tidak valid` };
      }
    }
    return { valid: true };
  }

  isValidChain(chain: Block[]): boolean {
    if (chain.length === 0) return false;
    for (let i = 1; i < chain.length; i++) {
      if (!chain[i].isValid(chain[i - 1])) return false;
    }
    return true;
  }

  async replaceChain(newChain: Block[]): Promise<boolean> {
    if (newChain.length <= this.chain.length) return false;
    if (!this.isValidChain(newChain)) return false;
    this.chain = newChain;
    this.globalState = replayStateFromChain(newChain, this.gas);
    // BUG FIX: was missing await — difficulty was not recalculated synchronously
    await this.replayDifficulty();
    logger.info({ newHeight: newChain.length - 1, stateRoot: this.globalState.stateRoot }, "Chain replaced (longest chain rule)");
    return true;
  }

  async mine(minerAddress: string): Promise<Block> {
    const height = this.chain.length;
    const prev = this.chain[height - 1];

    this.adjustDifficulty();

    const reward = this.getBlockReward(height);

    // BUG FIX: select and sort pending txs first so we know actual total fees
    const pendingTxs = [...this.mempool]
      .sort((a, b) => b.fee - a.fee)
      .slice(0, CHAIN_CONFIG.MAX_TX_PER_BLOCK);

    const blockTimestamp = Date.now();

    // BUG FIX: Apply transactions through the state machine in order.
    // Previously, a separate VM pre-pass was done with incorrect shared state,
    // and tx.status was mutated in the mempool before DB commit.
    // Now we track confirmed/failed results from applyTransaction directly.
    const confirmedTxs: Transaction[] = [];
    const failedTxIds = new Set<string>();
    let stateAfterBlock = this.globalState;

    // BUG FIX: block reward only mints the actual new coins (reward).
    // Miner fees are redistributed from senders (already in circulation),
    // so they must NOT go through a SYSTEM tx that adds to totalMinted.
    // Credit miner fees directly via a state mutation after applying all txs.
    const rewardTx = Transaction.fromSystem(minerAddress, reward);
    const rewardResult = applyTransaction(stateAfterBlock, rewardTx, height, blockTimestamp, this.gas);
    stateAfterBlock = rewardResult.state;
    confirmedTxs.push(rewardTx);

    for (const tx of pendingTxs) {
      const result = applyTransaction(stateAfterBlock, tx, height, blockTimestamp, this.gas);
      if (result.status === "confirmed") {
        stateAfterBlock = result.state;
        confirmedTxs.push(tx);
      } else {
        failedTxIds.add(tx.id);
      }
    }

    // Credit miner fees: sum fees from confirmed pending txs (not the rewardTx)
    const confirmedPendingTxs = confirmedTxs.filter((t) => t.from !== "SYSTEM");
    const totalFees = confirmedPendingTxs.reduce((s, t) => s + t.fee, 0);
    const burned = this.gas.calculateBurn(totalFees);
    const minerFees = totalFees - burned;

    // BUG FIX: Credit miner fees directly to miner's balance without incrementing totalMinted,
    // since fees were already deducted from senders (they're in circulation, not new coins).
    if (minerFees > 0) {
      stateAfterBlock = withState(stateAfterBlock, (d) => {
        d.balances[minerAddress] = (d.balances[minerAddress] ?? 0) + minerFees;
      });
    }

    const block = new Block({
      height,
      previousHash: prev.hash,
      timestamp: blockTimestamp,
      difficulty: this.difficulty,
      miner: minerAddress,
      transactions: confirmedTxs,
      blockReward: reward,
      totalFees: minerFees,
      stateRoot: stateAfterBlock.stateRoot,
    });

    logger.info({ height, difficulty: this.difficulty }, "Mining block...");
    const minedBlock = await this.mineBlock(block);

    // BUG FIX: Save to DB FIRST before updating in-memory state.
    // If saveBlock throws, the chain state remains consistent with the DB.
    await this.storage.saveBlock(minedBlock);

    // Update in-memory state only after successful DB commit
    this.globalState = stateAfterBlock;
    this.gas.recordBlockFees(confirmedPendingTxs.map((t) => t.fee));

    // Remove confirmed AND failed pending txs from mempool; mark failed ones
    this.mempool = this.mempool.filter((t) => {
      if (pendingTxs.some((p) => p.id === t.id)) {
        if (failedTxIds.has(t.id)) {
          t.status = "failed";
          return false;
        }
        return false;
      }
      return true;
    });

    this.chain.push(minedBlock);

    logger.info({ height: minedBlock.height, stateRoot: minedBlock.stateRoot }, "Block mined — stateRoot updated");

    return minedBlock;
  }

  private async mineBlock(block: Block): Promise<Block> {
    let nonce = 0;
    const startTime = Date.now();

    return new Promise((resolve) => {
      const mine = () => {
        const batchSize = 2000;
        for (let i = 0; i < batchSize; i++) {
          const hash = block.computeHash(nonce);
          if (block.meetsTarget(hash)) {
            block.nonce = nonce;
            block.hash = hash;
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            logger.info({ height: block.height, nonce, elapsed: elapsed + "s", difficulty: block.difficulty }, "Block mined");
            return resolve(block);
          }
          nonce++;
        }
        setImmediate(mine);
      };
      mine();
    });
  }

  addBlockFromPeer(block: Block): boolean {
    const prev = this.chain[this.chain.length - 1];
    if (!block.isValid(prev)) return false;
    if (block.height !== this.chain.length) return false;

    const result = applyBlock(this.globalState, block, this.gas);
    this.globalState = result.state;

    this.gas.recordBlockFees(block.transactions.map((t) => t.fee));

    const confirmedTxs = block.transactions;
    this.mempool = this.mempool.filter(
      (t) => !confirmedTxs.some((c) => c.id === t.id)
    );

    this.chain.push(block);
    this.storage.saveBlock(block);
    this.adjustDifficulty();

    logger.info({ height: block.height, stateRoot: result.state.stateRoot }, "Accepted block from peer");
    return true;
  }

  getGenesisAddress(): string {
    return this._genesisAddress;
  }

  getStats() {
    const height = this.chain.length - 1;
    return {
      chainName: CHAIN_CONFIG.NAME,
      ticker: CHAIN_CONFIG.TICKER,
      network: CHAIN_CONFIG.NETWORK,
      height,
      difficulty: this.difficulty,
      totalMinted: this.totalMinted,
      totalBurned: this.totalBurned,
      circulating: this.totalMinted - this.totalBurned,
      maxSupply: CHAIN_CONFIG.MAX_SUPPLY,
      premineAmount: CHAIN_CONFIG.PREMINE,
      miningSupply: CHAIN_CONFIG.MINING_SUPPLY,
      mempoolSize: this.mempool.length,
      blockReward: this.getBlockReward(height + 1),
      baseFee: this.gas.getBaseFee(),
      halvingProgress: `${((height % CHAIN_CONFIG.HALVING_INTERVAL) / CHAIN_CONFIG.HALVING_INTERVAL * 100).toFixed(2)}%`,
      nextHalvingBlock: Math.ceil((height + 1) / CHAIN_CONFIG.HALVING_INTERVAL) * CHAIN_CONFIG.HALVING_INTERVAL,
      targetBlockTime: CHAIN_CONFIG.TARGET_BLOCK_TIME_MS,
      stateRoot: this.globalState.stateRoot,
    };
  }
}

export const blockchain = new IXCoinBlockchain();
