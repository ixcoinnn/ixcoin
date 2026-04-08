import * as bip39 from "bip39";
import { HDKey } from "@scure/bip32";
import { sha256, sha256bytes, ripemd160hex } from "./crypto.js";

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function encodeBase58(buffer: Uint8Array): string {
  let num = BigInt("0x" + Buffer.from(buffer).toString("hex"));
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

function decodeBase58(str: string): Buffer | null {
  try {
    let num = 0n;
    for (const char of str) {
      const idx = BASE58_ALPHABET.indexOf(char);
      if (idx === -1) return null;
      num = num * 58n + BigInt(idx);
    }
    // Convert BigInt to hex, pad to at least 50 hex chars (25 bytes for standard address)
    let hex = num.toString(16);
    if (hex.length % 2 !== 0) hex = "0" + hex;
    // Count leading '1's (encode as leading zero bytes)
    let leadingZeros = 0;
    for (const c of str) {
      if (c === "1") leadingZeros++;
      else break;
    }
    const result = Buffer.from("00".repeat(leadingZeros) + hex, "hex");
    return result;
  } catch {
    return null;
  }
}

export function pubKeyBytesToAddress(pubKeyBytes: Uint8Array): string {
  const pubHex = Buffer.from(pubKeyBytes).toString("hex");
  const step1 = sha256(pubHex);
  const step2 = ripemd160hex(step1);
  const versioned = "00" + step2;
  const checksum = sha256(sha256(versioned)).slice(0, 8);
  const full = Buffer.from(versioned + checksum, "hex");
  return "IX" + encodeBase58(full);
}

/**
 * Validate an IXCOIN address with full checksum verification.
 * A valid address must:
 * 1. Start with "IX"
 * 2. Be a valid Base58 string
 * 3. Have a correct 4-byte (8 hex chars) checksum at the end
 */
export function validateAddress(address: string): boolean {
  if (typeof address !== "string") return false;
  if (!address.startsWith("IX")) return false;
  if (address.length < 15 || address.length > 100) return false;

  const base58Part = address.slice(2);

  // All characters must be in BASE58_ALPHABET
  for (const c of base58Part) {
    if (!BASE58_ALPHABET.includes(c)) return false;
  }

  // Decode and verify checksum
  const decoded = decodeBase58(base58Part);
  if (!decoded || decoded.length < 5) return false;

  // Last 4 bytes are checksum, rest is payload
  const payload = decoded.slice(0, decoded.length - 4);
  const providedChecksum = decoded.slice(decoded.length - 4);

  const payloadHex = payload.toString("hex");
  const expectedChecksumHex = sha256(sha256(payloadHex)).slice(0, 8);
  const expectedChecksum = Buffer.from(expectedChecksumHex, "hex");

  return providedChecksum.equals(expectedChecksum);
}

export class IXWallet {
  address: string;
  publicKeyHex: string;
  privateKeyHex: string;
  mnemonic: string;

  private hdKey: HDKey;

  private constructor(mnemonic: string, hdKey: HDKey) {
    this.mnemonic = mnemonic;
    this.hdKey = hdKey;
    this.privateKeyHex = Buffer.from(hdKey.privateKey!).toString("hex");
    this.publicKeyHex = Buffer.from(hdKey.publicKey!).toString("hex");
    this.address = pubKeyBytesToAddress(hdKey.publicKey!);
  }

  static create(): IXWallet {
    const mnemonic = bip39.generateMnemonic(128);
    return IXWallet.fromMnemonic(mnemonic);
  }

  static fromMnemonic(mnemonic: string): IXWallet {
    if (!bip39.validateMnemonic(mnemonic.trim())) {
      throw new Error("Mnemonic tidak valid");
    }
    const seed = bip39.mnemonicToSeedSync(mnemonic.trim());
    const master = HDKey.fromMasterSeed(seed);
    const child = master.derive("m/44'/0'/0'/0/0");
    return new IXWallet(mnemonic.trim(), child);
  }

  static fromPrivateKeyHex(privHex: string, mnemonicHint = ""): IXWallet {
    const privBytes = Buffer.from(privHex, "hex");
    const hdKey = new HDKey({ privateKey: privBytes });
    const w = Object.create(IXWallet.prototype) as IXWallet;
    w.mnemonic = mnemonicHint;
    w.hdKey = hdKey;
    w.privateKeyHex = privHex;
    w.publicKeyHex = Buffer.from(hdKey.publicKey!).toString("hex");
    w.address = pubKeyBytesToAddress(hdKey.publicKey!);
    return w;
  }

  sign(dataStr: string): string {
    const hash = sha256bytes(dataStr);
    const sig = this.hdKey.sign(hash);
    return Buffer.from(sig).toString("hex");
  }

  verify(dataStr: string, signatureHex: string): boolean {
    try {
      const hash = sha256bytes(dataStr);
      const sig = Buffer.from(signatureHex, "hex");
      return this.hdKey.verify(hash, sig);
    } catch {
      return false;
    }
  }

  toJSON() {
    return {
      address: this.address,
      publicKey: this.publicKeyHex,
      mnemonic: this.mnemonic,
    };
  }

  toSafeJSON() {
    return {
      address: this.address,
      publicKey: this.publicKeyHex,
    };
  }

  toFullJSON() {
    return {
      address: this.address,
      publicKey: this.publicKeyHex,
      privateKey: this.privateKeyHex,
      mnemonic: this.mnemonic,
    };
  }
}
