import { sha256d } from "./crypto.js";
import { computeMerkleRoot } from "./merkle.js";
import { Transaction, type TransactionData } from "./transaction.js";

export interface BlockHeader {
  height: number;
  previousHash: string;
  timestamp: number;
  nonce: number;
  difficulty: number;
  merkleRoot: string;
  miner: string;
  stateRoot: string;
}

export interface BlockData extends BlockHeader {
  hash: string;
  transactions: Transaction[];
  blockReward: number;
  totalFees: number;
  txCount: number;
  sizeBytes: number;
}

export class Block implements BlockData {
  height: number;
  previousHash: string;
  timestamp: number;
  nonce: number;
  difficulty: number;
  merkleRoot: string;
  miner: string;
  /** Deterministic root of GlobalState after applying this block. */
  stateRoot: string;
  hash: string;
  transactions: Transaction[];
  blockReward: number;
  totalFees: number;
  txCount: number;
  sizeBytes: number;

  constructor(params: {
    height: number;
    previousHash: string;
    timestamp: number;
    difficulty: number;
    miner: string;
    transactions: Transaction[];
    blockReward: number;
    totalFees: number;
    stateRoot?: string;
    merkleRoot?: string;
  }) {
    this.height = params.height;
    this.previousHash = params.previousHash;
    this.timestamp = params.timestamp;
    this.difficulty = params.difficulty;
    this.miner = params.miner;
    this.transactions = params.transactions;
    this.blockReward = params.blockReward;
    this.totalFees = params.totalFees;
    this.stateRoot = params.stateRoot ?? "";
    // BUG FIX: allow restoring merkleRoot from serialized data (e.g., when loading from DB)
    this.merkleRoot = params.merkleRoot ?? computeMerkleRoot(params.transactions.map((t) => t.toJSON()));
    this.txCount = params.transactions.length;
    this.sizeBytes = JSON.stringify(params.transactions).length;
    this.nonce = 0;
    this.hash = "";
  }

  static fromJSON(data: {
    height: number; previousHash: string; timestamp: number; difficulty: number;
    miner: string; transactions: TransactionData[]; blockReward: number; totalFees: number;
    hash: string; nonce: number; merkleRoot?: string; txCount?: number; sizeBytes?: number;
    stateRoot?: string;
  }): Block {
    const txs = (data.transactions ?? []).map((t) => Transaction.fromJSON(t));
    const block = new Block({
      height: data.height,
      previousHash: data.previousHash,
      timestamp: data.timestamp,
      difficulty: data.difficulty,
      miner: data.miner,
      transactions: txs,
      blockReward: Number(data.blockReward),
      totalFees: Number(data.totalFees),
      stateRoot: data.stateRoot ?? "",
      merkleRoot: data.merkleRoot,
    });
    block.hash = data.hash;
    block.nonce = data.nonce;
    return block;
  }

  computeHash(nonce: number): string {
    return sha256d(
      this.previousHash +
        this.timestamp.toString() +
        this.merkleRoot +
        nonce.toString() +
        this.difficulty.toString() +
        this.height.toString() +
        this.stateRoot
    );
  }

  meetsTarget(hash: string): boolean {
    return hash.startsWith("0".repeat(this.difficulty));
  }

  isValid(previousBlock: Block | null): boolean {
    if (this.height === 0) return true;
    if (!previousBlock) return false;

    // BUG FIX: Verify hash integrity — recompute the hash from block data and
    // confirm it matches the stored hash AND meets the difficulty target.
    // This prevents accepting blocks with fake hashes that start with enough zeros
    // but don't actually correspond to the block's contents.
    const recomputed = this.computeHash(this.nonce);
    if (recomputed !== this.hash) return false;
    if (!this.meetsTarget(this.hash)) return false;

    if (this.previousHash !== previousBlock.hash) return false;
    if (this.height !== previousBlock.height + 1) return false;
    if (this.timestamp < previousBlock.timestamp - 7200000) return false;

    const expectedMerkle = computeMerkleRoot(this.transactions.map((t) => t.toJSON()));
    if (this.merkleRoot !== expectedMerkle) return false;

    return true;
  }

  toJSON() {
    return {
      height: this.height,
      hash: this.hash,
      previousHash: this.previousHash,
      timestamp: this.timestamp,
      nonce: this.nonce,
      difficulty: this.difficulty,
      merkleRoot: this.merkleRoot,
      stateRoot: this.stateRoot,
      miner: this.miner,
      blockReward: this.blockReward,
      totalFees: this.totalFees,
      txCount: this.txCount,
      sizeBytes: this.sizeBytes,
      transactions: this.transactions.map((t) => t.toJSON()),
    };
  }
}
