import { v4 as uuidv4 } from "uuid";
import { sha256, sha256bytes } from "./crypto.js";
import { CHAIN_CONFIG } from "./config.js";
import { HDKey } from "@scure/bip32";
import { pubKeyBytesToAddress } from "./wallet.js";

export interface TransactionData {
  id: string;
  from: string;
  to: string;
  amount: number;
  fee: number;
  gasPrice: number;
  gasUsed: number;
  nonce: number;
  timestamp: number;
  signature?: string;
  publicKey?: string;
  contract?: string | null;
  status: "pending" | "confirmed" | "failed";
}

const MAX_TX_AMOUNT = CHAIN_CONFIG.MAX_SUPPLY;
const MAX_FEE = 1000;
const MAX_TX_FUTURE_MS = 5 * 60 * 1000;
const MAX_TX_AGE_MS = 24 * 60 * 60 * 1000;
const MIN_GAS_PRICE = 0;
const MAX_GAS_USED = CHAIN_CONFIG.CONTRACT_GAS_LIMIT;

// Null-byte separator prevents "separator attacks" where
// different field combinations produce the same concatenated string.
const SEP = "\x00";

export class Transaction implements TransactionData {
  id: string;
  from: string;
  to: string;
  amount: number;
  fee: number;
  gasPrice: number;
  gasUsed: number;
  nonce: number;
  timestamp: number;
  signature?: string;
  publicKey?: string;
  contract?: string | null;
  status: "pending" | "confirmed" | "failed";

  constructor(params: {
    from: string;
    to: string;
    amount: number;
    fee?: number;
    gasPrice?: number;
    gasUsed?: number;
    nonce?: number;
    contract?: string | null;
  }) {
    this.id = uuidv4();
    this.from = params.from;
    this.to = params.to;
    this.amount = params.amount;
    this.gasPrice = params.gasPrice ?? CHAIN_CONFIG.BASE_GAS_PRICE;
    this.gasUsed = params.gasUsed ?? CHAIN_CONFIG.TX_GAS_LIMIT;
    this.fee = params.fee ?? (this.gasPrice * this.gasUsed) / 1_000_000;
    this.nonce = params.nonce ?? 0;
    this.contract = params.contract ?? null;
    this.timestamp = Date.now();
    this.status = "pending";
  }

  static fromSystem(to: string, amount: number): Transaction {
    return new Transaction({ from: "SYSTEM", to, amount, fee: 0, gasUsed: 0 });
  }

  static fromJSON(data: TransactionData): Transaction {
    const tx = new Transaction({
      from: data.from,
      to: data.to,
      amount: Number(data.amount),
      fee: Number(data.fee),
      gasPrice: Number(data.gasPrice),
      gasUsed: Number(data.gasUsed),
      nonce: data.nonce,
      contract: data.contract ?? null,
    });
    tx.id = data.id;
    tx.timestamp = data.timestamp;
    tx.signature = data.signature;
    tx.publicKey = data.publicKey;
    tx.status = data.status;
    return tx;
  }

  /**
   * Produce a canonical hash for signing.
   * Fields are separated by a null byte (\x00) to prevent separator-attack
   * collisions where different field combos produce identical concatenated strings.
   *
   * SECURITY: Chain ID (7777) is included first to prevent cross-chain replay attacks.
   * TX ID is included to make every signature unique — even if all other fields match.
   * This matches EIP-155-style replay protection adapted for IXCOIN.
   */
  hash(): string {
    const parts = [
      CHAIN_CONFIG.CHAIN_ID.toString(), // replay protection: bind signature to this chain
      this.id,                           // unique per tx: prevents signature reuse
      this.from,
      this.to,
      this.amount.toString(),
      this.fee.toString(),
      this.nonce.toString(),
      this.timestamp.toString(),
      JSON.stringify(this.contract ?? null),
    ];
    return sha256(parts.join(SEP));
  }

  sign(privateKeyHex: string, publicKeyHex: string): void {
    try {
      const privBytes = Buffer.from(privateKeyHex, "hex");
      if (privBytes.length !== 32) throw new Error("Private key harus tepat 32 bytes");
      const hdKey = new HDKey({ privateKey: privBytes });
      const hash = sha256bytes(this.hash());
      const sig = hdKey.sign(hash);
      this.signature = Buffer.from(sig).toString("hex");
      this.publicKey = publicKeyHex;
    } catch (err) {
      throw new Error("Gagal menandatangani transaksi: " + String(err));
    }
  }

  isValid(): boolean {
    if (this.from === "SYSTEM") return true;

    if (!this.signature || !this.publicKey) return false;
    if (!this.id || typeof this.id !== "string") return false;
    if (typeof this.amount !== "number" || !isFinite(this.amount)) return false;
    // BUG FIX: allow amount = 0 for contract transactions; reject negative amounts for all
    if (this.amount < 0) return false;
    if (!this.contract && this.amount === 0) return false;
    if (this.amount > MAX_TX_AMOUNT) return false;
    if (typeof this.fee !== "number" || !isFinite(this.fee)) return false;
    if (this.fee < 0 || this.fee > MAX_FEE) return false;
    if (typeof this.nonce !== "number" || this.nonce < 0 || !Number.isInteger(this.nonce)) return false;
    if (typeof this.gasPrice !== "number" || this.gasPrice < MIN_GAS_PRICE) return false;
    if (typeof this.gasUsed !== "number" || this.gasUsed < 0 || this.gasUsed > MAX_GAS_USED) return false;

    const now = Date.now();
    if (this.timestamp > now + MAX_TX_FUTURE_MS) return false;
    if (this.timestamp < now - MAX_TX_AGE_MS) return false;

    if (this.from === this.to) return false;

    try {
      const pubBytes = Buffer.from(this.publicKey, "hex");
      if (pubBytes.length !== 33) return false;

      // CRITICAL: Verify that the publicKey actually corresponds to the `from` address.
      // Without this check, someone could sign a valid tx for their account but set
      // a different address in `from`, potentially bypassing balance checks.
      const derivedAddress = pubKeyBytesToAddress(pubBytes);
      if (derivedAddress !== this.from) return false;

      const hdKey = new HDKey({ publicKey: pubBytes });
      const hash = sha256bytes(this.hash());
      const sig = Buffer.from(this.signature, "hex");
      return hdKey.verify(hash, sig);
    } catch {
      return false;
    }
  }

  validationErrors(): string[] {
    const errors: string[] = [];
    if (this.from === "SYSTEM") return errors;

    if (!this.signature) errors.push("Signature tidak ada");
    if (!this.publicKey) errors.push("Public key tidak ada");
    if (this.amount < 0) errors.push(`Amount tidak boleh negatif, got ${this.amount}`);
    if (!this.contract && this.amount === 0) errors.push("Amount harus lebih dari 0 untuk transaksi biasa");
    if (this.amount > MAX_TX_AMOUNT) errors.push(`Amount melebihi max supply: ${this.amount}`);
    if (this.fee < 0) errors.push(`Fee negatif: ${this.fee}`);
    if (this.fee > MAX_FEE) errors.push(`Fee terlalu tinggi: ${this.fee}`);
    if (this.nonce < 0) errors.push(`Nonce negatif: ${this.nonce}`);
    if (this.from === this.to) errors.push("Pengirim dan penerima sama");

    const now = Date.now();
    if (this.timestamp > now + MAX_TX_FUTURE_MS) errors.push("Timestamp terlalu jauh di masa depan");
    if (this.timestamp < now - MAX_TX_AGE_MS) errors.push("Transaksi kedaluwarsa (> 24 jam)");

    return errors;
  }

  toJSON(): TransactionData {
    return {
      id: this.id,
      from: this.from,
      to: this.to,
      amount: this.amount,
      fee: this.fee,
      gasPrice: this.gasPrice,
      gasUsed: this.gasUsed,
      nonce: this.nonce,
      timestamp: this.timestamp,
      signature: this.signature,
      publicKey: this.publicKey,
      contract: this.contract,
      status: this.status,
    };
  }
}
