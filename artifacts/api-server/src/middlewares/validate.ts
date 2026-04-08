import { Request, Response, NextFunction } from "express";
import { z, ZodSchema } from "zod";

export function validateBody<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({
        error: "Input tidak valid",
        details: result.error.errors.map((e) => ({
          field: e.path.join("."),
          message: e.message,
        })),
      });
      return;
    }
    req.body = result.data;
    next();
  };
}

export function validateQuery<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      res.status(400).json({
        error: "Query parameter tidak valid",
        details: result.error.errors.map((e) => ({
          field: e.path.join("."),
          message: e.message,
        })),
      });
      return;
    }
    next();
  };
}

// ─── Reusable field types ─────────────────────────────────────────────────────

export const ixAddress = z
  .string()
  .min(10, "Alamat terlalu pendek")
  .max(100, "Alamat terlalu panjang")
  .startsWith("IX", "Alamat harus dimulai dengan IX")
  .regex(/^IX[A-Za-z0-9]+$/, "Alamat hanya boleh mengandung karakter alphanumeric");

export const hexPrivKey = z
  .string()
  .length(64, "Private key harus tepat 64 karakter hex")
  .regex(/^[0-9a-fA-F]+$/, "Private key harus berupa hex valid");

export const positiveAmount = z
  .number({ invalid_type_error: "Harus berupa angka" })
  .positive("Harus lebih dari 0")
  .finite("Harus berupa angka terbatas")
  .max(21_000_000, "Melebihi maksimum supply IXC (21.000.000)");

// Primitive scalar safe for use inside args/metadata
const safePrimitive = z.union([
  z.string().max(2_000),
  z.number().finite().safe(),
  z.boolean(),
  z.null(),
]);

// ─── Schemas ──────────────────────────────────────────────────────────────────

/** Legacy schema — kept for backward compatibility, deprecated */
export const SendTxSchema = z.object({
  from: ixAddress,
  to: ixAddress,
  amount: positiveAmount,
  privateKeyHex: hexPrivKey,
  nonce: z.number().int().nonnegative().max(1_000_000_000).optional(),
  gasPrice: z.number().positive().finite().max(1_000_000).optional(),
  contract: z.string().max(10_000).nullable().optional(),
}).strict();

/**
 * Secure schema: client signs the transaction locally, sends only the signed payload.
 * Private key NEVER leaves the user's device.
 *
 * Includes chain ID in the signing hash (see transaction.hash()) for replay protection.
 */
export const SignedTxSchema = z.object({
  id: z.string().uuid("TX ID harus berupa UUID v4"),
  from: ixAddress,
  to: ixAddress,
  amount: positiveAmount,
  // Minimum fee: 0.00001 IXC — prevents dust spam while keeping fees accessible
  fee: z.number().min(0.00001, "Fee minimum 0.00001 IXC").max(1000, "Fee terlalu tinggi").finite(),
  nonce: z.number().int().nonnegative().max(1_000_000_000),
  timestamp: z.number().int().positive("Timestamp tidak valid"),
  gasPrice: z.number().min(0).finite().max(1_000_000).optional(),
  // compact secp256k1 signature: exactly 64 bytes = 128 hex chars
  signature: z.string().regex(/^[0-9a-fA-F]{128,144}$/, "Signature harus 64-72 bytes hex"),
  // compressed secp256k1 public key: 33 bytes = 66 hex chars (starts with 02 or 03)
  publicKey: z.string().regex(/^0[23][0-9a-fA-F]{64}$/, "Public key harus compressed secp256k1 (66 hex chars)"),
  contract: z.string().max(10_000).nullable().optional(),
}).strict();

export const MineSchema = z.object({
  address: ixAddress,
}).strict();

export const WalletRestoreSchema = z.object({
  mnemonic: z
    .string()
    .min(20, "Mnemonic terlalu pendek")
    .max(500, "Mnemonic terlalu panjang")
    .refine(
      (m) => m.trim().split(/\s+/).length >= 12,
      "Mnemonic harus terdiri dari minimal 12 kata"
    ),
}).strict();

export const P2PConnectSchema = z.object({
  peerUrl: z
    .string()
    .url("URL peer tidak valid")
    .startsWith("ws", "URL peer harus dimulai dengan ws:// atau wss://")
    .max(500, "URL terlalu panjang"),
}).strict();

export const PaginationSchema = z.object({
  limit: z
    .string()
    .optional()
    .transform((v) => Math.min(Math.max(1, parseInt(v ?? "20") || 20), 200))
    .pipe(z.number().int().min(1).max(200)),
  offset: z
    .string()
    .optional()
    .transform((v) => Math.max(0, parseInt(v ?? "0") || 0))
    .pipe(z.number().int().min(0).max(1_000_000_000)),
});

export const NFTMintSchema = z.object({
  ownerAddress: ixAddress,
  privateKeyHex: hexPrivKey,
  name: z.string().min(1).max(200),
  description: z.string().max(2_000).optional(),
  imageUrl: z.string().url().max(500).optional(),
  attributes: z
    .array(z.object({
      trait_type: z.string().min(1).max(100),
      value: z.union([z.string().max(500), z.number().finite().safe(), z.boolean(), z.null()]),
    }))
    .max(50)
    .optional(),
  royaltyPercent: z.number().min(0).max(50).optional(),
  collection: z.string().max(200).optional(),
}).strict();

export const TokenizeRWASchema = z.object({
  issuerAddress: ixAddress,
  privateKeyHex: hexPrivKey,
  name: z.string().min(1).max(200),
  symbol: z.string().min(1).max(20).regex(/^[A-Z0-9]+$/, "Symbol harus uppercase alphanumeric"),
  assetType: z.enum(["property", "commodity", "security", "bond", "equity", "other"]),
  description: z.string().max(2_000).optional(),
  location: z.string().max(500).optional(),
  totalSupply: z.number().int().min(1).max(1_000_000_000).optional(),
  // Use a reasonable max — Number.MAX_SAFE_INTEGER may overflow DB int columns
  valueIdc: z.number().min(0).max(1_000_000_000_000).optional(),
  // SHA-256 hash is exactly 64 hex chars (or empty)
  documentHash: z
    .string()
    .regex(/^([0-9a-fA-F]{64})?$/, "documentHash harus berupa SHA-256 hex (64 karakter) atau kosong")
    .optional(),
  // Limit metadata: max 50 keys, each key ≤100 chars, values are safe primitives
  metadata: z
    .record(z.string().max(100), safePrimitive)
    .refine((v) => Object.keys(v).length <= 50, "Metadata tidak boleh lebih dari 50 keys")
    .optional(),
}).strict();

export const DeFiDepositSchema = z.object({
  userAddress: ixAddress,
  privateKeyHex: hexPrivKey,
  amount: positiveAmount,
  poolId: z.string().min(1).max(100),
}).strict();

export const ContractDeploySchema = z.object({
  deployerAddress: ixAddress,
  privateKeyHex: hexPrivKey,
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2_000).optional(),
  // Limit to 100KB — same as the manual check in the route
  code: z.string().min(1).max(100_000, "Kode kontrak terlalu besar (maks 100KB)"),
  // initialState keys: max 100, values: safe primitives only
  initialState: z
    .record(z.string().max(100), safePrimitive)
    .refine((v) => Object.keys(v).length <= 100, "initialState tidak boleh lebih dari 100 keys")
    .optional(),
}).strict();

export const ContractCallSchema = z.object({
  contractAddress: ixAddress,
  callerAddress: ixAddress,
  privateKeyHex: hexPrivKey,
  callCode: z.string().min(1).max(100_000, "Call code terlalu besar (maks 100KB)"),
  amount: z
    .number()
    .min(0, "Amount tidak boleh negatif")
    .max(21_000_000, "Melebihi maksimum supply IXC")
    .finite()
    .optional()
    .default(0),
}).strict();

export const RWATransferSchema = z.object({
  tokenAddress: z.string().min(3).max(100),
  fromAddress: ixAddress,
  toAddress: ixAddress,
  privateKeyHex: hexPrivKey,
  amount: z.number().positive("Jumlah transfer harus lebih dari 0").max(1_000_000_000).finite(),
  memo: z.string().max(500).optional(),
}).strict();
