import { sha256 } from "./crypto.js";

export function computeMerkleRoot(items: object[]): string {
  if (items.length === 0) return sha256("");

  let hashes = items.map((item) => sha256(JSON.stringify(item)));

  while (hashes.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < hashes.length; i += 2) {
      if (i + 1 < hashes.length) {
        next.push(sha256(hashes[i] + hashes[i + 1]));
      } else {
        next.push(sha256(hashes[i] + hashes[i]));
      }
    }
    hashes = next;
  }

  return hashes[0];
}

export function getMerkleProof(items: object[], index: number): string[] {
  if (items.length === 0) return [];

  let hashes = items.map((item) => sha256(JSON.stringify(item)));
  const proof: string[] = [];
  let idx = index;

  while (hashes.length > 1) {
    const sibling =
      idx % 2 === 0
        ? hashes[idx + 1] ?? hashes[idx]
        : hashes[idx - 1];
    proof.push(sibling);

    const next: string[] = [];
    for (let i = 0; i < hashes.length; i += 2) {
      if (i + 1 < hashes.length) {
        next.push(sha256(hashes[i] + hashes[i + 1]));
      } else {
        next.push(sha256(hashes[i] + hashes[i]));
      }
    }
    hashes = next;
    idx = Math.floor(idx / 2);
  }

  return proof;
}
