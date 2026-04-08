import crypto from "crypto";

export function sha256(data: string): string {
  return crypto.createHash("sha256").update(data, "utf8").digest("hex");
}

export function sha256d(data: string): string {
  return sha256(sha256(data));
}

export function sha256bytes(data: string): Uint8Array {
  return crypto.createHash("sha256").update(data, "utf8").digest();
}

export function ripemd160hex(data: string): string {
  return crypto.createHash("ripemd160").update(Buffer.from(data, "hex")).digest("hex");
}

export function hash160hex(hexData: string): string {
  return ripemd160hex(sha256(hexData));
}
