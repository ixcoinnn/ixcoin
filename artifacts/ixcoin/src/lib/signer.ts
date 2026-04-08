/**
 * IXCOIN Browser-Side Cryptographic Library
 *
 * SECURITY GUARANTEE: All key generation and transaction signing happens
 * entirely within this file, in the user's browser.
 * Private keys NEVER leave the user's device.
 *
 * Algorithm compatibility: exact match with artifacts/api-server/src/blockchain/
 * - SHA256: same as Node.js crypto sha256(utf8 string)
 * - RIPEMD160: same as Node.js crypto ripemd160(raw bytes from hex decode)
 * - secp256k1 ECDSA: same HDKey.sign() from @scure/bip32
 * - Chain ID 7777 in signing hash: prevents cross-chain replay attacks
 */

import { HDKey } from "@scure/bip32";
import * as bip39 from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { sha256 as sha256Noble } from "@noble/hashes/sha256";
import { ripemd160 } from "@noble/hashes/ripemd160";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import { v4 as uuidv4 } from "uuid";

// ─── Crypto primitives — must match backend blockchain/crypto.ts exactly ──────

/** SHA256 of a UTF-8 string → hex string. Matches backend: sha256(string) */
function sha256hex(data: string): string {
  return bytesToHex(sha256Noble(utf8ToBytes(data)));
}

/** SHA256 of a UTF-8 string → raw bytes. Matches backend: sha256bytes(string) */
function sha256bytes(data: string): Uint8Array {
  return sha256Noble(utf8ToBytes(data));
}

/**
 * RIPEMD160 of bytes decoded from a hex string → hex.
 * Matches backend: ripemd160hex(hexData) which does:
 *   crypto.createHash("ripemd160").update(Buffer.from(hexData, "hex")).digest("hex")
 */
function ripemd160Hex(hexData: string): string {
  const bytes = hexToBytes(hexData);
  return bytesToHex(ripemd160(bytes));
}

function hexToBytes(hex: string): Uint8Array {
  const matches = hex.match(/.{1,2}/g);
  if (!matches) return new Uint8Array(0);
  return new Uint8Array(matches.map((b) => parseInt(b, 16)));
}

// ─── Base58 — must match backend blockchain/wallet.ts exactly ─────────────────

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function encodeBase58(buffer: Uint8Array): string {
  let num = BigInt("0x" + (buffer.length ? bytesToHex(buffer) : "0"));
  let result = "";
  while (num > 0n) {
    result = BASE58_ALPHABET[Number(num % 58n)] + result;
    num = num / 58n;
  }
  for (const byte of buffer) {
    if (byte === 0) result = "1" + result;
    else break;
  }
  return result || "1";
}

function decodeBase58(str: string): Uint8Array | null {
  try {
    let num = 0n;
    for (const char of str) {
      const idx = BASE58_ALPHABET.indexOf(char);
      if (idx === -1) return null;
      num = num * 58n + BigInt(idx);
    }
    let hex = num.toString(16);
    if (hex.length % 2 !== 0) hex = "0" + hex;
    let leadingZeros = 0;
    for (const c of str) {
      if (c === "1") leadingZeros++;
      else break;
    }
    return hexToBytes("00".repeat(leadingZeros) + hex);
  } catch {
    return null;
  }
}

// ─── Address derivation — must match backend pubKeyBytesToAddress() exactly ───

/**
 * Derive an IXCOIN address from a compressed secp256k1 public key (33 bytes).
 *
 * Algorithm (matches backend blockchain/wallet.ts):
 *   1. pubHex   = hex(pubKeyBytes)              — encode pubkey as hex string
 *   2. step1    = SHA256(pubHex as UTF-8)        — SHA256 of the hex representation
 *   3. step2    = RIPEMD160(decode_hex(step1))   — RIPEMD160 of raw bytes
 *   4. versioned = "00" + step2                  — version prefix
 *   5. checksum = SHA256(SHA256(versioned))[0:8] — 4-byte checksum
 *   6. address  = "IX" + Base58(versioned + checksum)
 */
export function pubKeyBytesToAddress(pubKeyBytes: Uint8Array): string {
  const pubHex = bytesToHex(pubKeyBytes);
  const step1 = sha256hex(pubHex);
  const step2 = ripemd160Hex(step1);
  const versioned = "00" + step2;
  const checksum = sha256hex(sha256hex(versioned)).slice(0, 8);
  const fullBytes = hexToBytes(versioned + checksum);
  return "IX" + encodeBase58(fullBytes);
}

/** Validate IXCOIN address: prefix, charset, and checksum. */
export function validateAddress(address: string): boolean {
  if (typeof address !== "string") return false;
  if (!address.startsWith("IX")) return false;
  if (address.length < 15 || address.length > 100) return false;
  const base58Part = address.slice(2);
  for (const c of base58Part) {
    if (!BASE58_ALPHABET.includes(c)) return false;
  }
  const decoded = decodeBase58(base58Part);
  if (!decoded || decoded.length < 5) return false;
  const payload = decoded.slice(0, decoded.length - 4);
  const stored = decoded.slice(decoded.length - 4);
  const payloadHex = bytesToHex(payload);
  const computed = hexToBytes(sha256hex(sha256hex(payloadHex)).slice(0, 8));
  if (stored.length !== computed.length) return false;
  for (let i = 0; i < stored.length; i++) {
    if (stored[i] !== computed[i]) return false;
  }
  return true;
}

// ─── Wallet types ──────────────────────────────────────────────────────────────

export interface WalletKeys {
  address: string;
  publicKey: string;  // compressed secp256k1, 33 bytes = 66 hex chars (starts with 02 or 03)
  privateKey: string; // 32 bytes = 64 hex chars
  mnemonic: string;   // BIP39 12-word English phrase
}

const HD_PATH = "m/44'/0'/0'/0/0";

// ─── Wallet generation ─────────────────────────────────────────────────────────

/**
 * Generate a brand-new IXCOIN wallet entirely in the browser.
 * Uses window.crypto.getRandomValues for secure entropy.
 * The server is NOT involved — no network call.
 */
export function createWallet(): WalletKeys {
  const mnemonic = bip39.generateMnemonic(wordlist); // 128-bit entropy → 12 words
  return deriveWalletFromMnemonic(mnemonic);
}

/**
 * Restore an existing wallet from a 12-word BIP39 mnemonic phrase.
 * Validates the mnemonic checksum before deriving keys.
 * The server is NOT involved — no network call.
 */
export function restoreWallet(mnemonic: string): WalletKeys {
  const trimmed = mnemonic.trim().replace(/\s+/g, " ");
  if (!bip39.validateMnemonic(trimmed, wordlist)) {
    throw new Error("Frase 12 kata tidak valid — periksa ejaan dan urutan kata");
  }
  return deriveWalletFromMnemonic(trimmed);
}

function deriveWalletFromMnemonic(mnemonic: string): WalletKeys {
  const seed = bip39.mnemonicToSeedSync(mnemonic);
  const master = HDKey.fromMasterSeed(seed);
  const child = master.derive(HD_PATH);
  if (!child.privateKey || !child.publicKey) {
    throw new Error("Gagal mendapatkan kunci dari frase ini");
  }
  return {
    mnemonic,
    privateKey: bytesToHex(child.privateKey),
    publicKey: bytesToHex(child.publicKey),
    address: pubKeyBytesToAddress(child.publicKey),
  };
}

// ─── Transaction signing ────────────────────────────────────────────────────────

const CHAIN_ID = 7777; // IXCOIN Network chain ID (matches CHAIN_CONFIG.CHAIN_ID)
const SEP = "\x00";    // null-byte separator (prevents separator-attack collisions)

export interface UnsignedTxParams {
  from: string;
  to: string;
  amount: number;
  fee: number;
  nonce: number;
  gasPrice?: number;
  contract?: string | null;
}

export interface SignedTx {
  id: string;
  from: string;
  to: string;
  amount: number;
  fee: number;
  nonce: number;
  timestamp: number;
  gasPrice: number;
  signature: string;  // compact secp256k1, 64 bytes = 128 hex chars
  publicKey: string;  // compressed secp256k1, 33 bytes = 66 hex chars
  contract: string | null;
}

/**
 * Create and sign an IXCOIN transaction entirely in the browser.
 *
 * SECURITY: The private key is used only within this function and never returned
 * or stored. Only the signed payload (SignedTx) is returned — safe to send to server.
 *
 * Signing algorithm (must match backend transaction.ts sign()):
 *   payload = [chainId, id, from, to, amount, fee, nonce, timestamp, contract].join("\x00")
 *   h1      = SHA256(payload as UTF-8) → hex          (= tx.hash())
 *   bytes   = SHA256(h1 as UTF-8) → raw bytes         (= sha256bytes(tx.hash()))
 *   sig     = secp256k1_ECDSA_sign(bytes, privateKey)  (compact 64-byte format)
 */
export function signTransaction(params: UnsignedTxParams, wallet: WalletKeys): SignedTx {
  const id = uuidv4();
  const timestamp = Date.now();
  const gasPrice = params.gasPrice ?? 1;

  // Build canonical signing payload — must EXACTLY match backend transaction.hash()
  const parts = [
    CHAIN_ID.toString(),
    id,
    params.from,
    params.to,
    params.amount.toString(),
    params.fee.toString(),
    params.nonce.toString(),
    timestamp.toString(),
    JSON.stringify(params.contract ?? null),
  ];

  const h1 = sha256hex(parts.join(SEP));   // first SHA256 → hex (= tx.hash())
  const signingBytes = sha256bytes(h1);    // second SHA256 → bytes (= sha256bytes(tx.hash()))

  // secp256k1 ECDSA sign using @scure/bip32 (compact 64-byte output, no DER encoding)
  const privBytes = hexToBytes(wallet.privateKey);
  const hdKey = new HDKey({ privateKey: privBytes });
  const sigBytes = hdKey.sign(signingBytes);

  return {
    id,
    from: params.from,
    to: params.to,
    amount: params.amount,
    fee: params.fee,
    nonce: params.nonce,
    timestamp,
    gasPrice,
    signature: bytesToHex(sigBytes),
    publicKey: wallet.publicKey,
    contract: params.contract ?? null,
  };
}
