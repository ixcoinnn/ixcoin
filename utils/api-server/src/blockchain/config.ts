// SECURITY WARNING: This default mnemonic is PUBLIC in source code.
// In production, always set GENESIS_MNEMONIC environment variable to a private 24-word phrase.
// Anyone with this mnemonic can derive the genesis wallet private key!
const DEFAULT_GENESIS_MNEMONIC =
  "buddy mandate enact toy salon announce decline hill chief absorb fine farm";

if (!process.env["GENESIS_MNEMONIC"] && process.env["NODE_ENV"] === "production") {
  // eslint-disable-next-line no-console
  console.error(
    "\n⚠️  SECURITY CRITICAL: GENESIS_MNEMONIC env var is NOT set!\n" +
    "   Using default hardcoded mnemonic which is PUBLIC in source code.\n" +
    "   Set GENESIS_MNEMONIC to a private 24-word mnemonic before production use!\n"
  );
}

if (!process.env["ADMIN_KEY"] && process.env["NODE_ENV"] === "production") {
  // eslint-disable-next-line no-console
  console.error(
    "\n⚠️  SECURITY WARNING: ADMIN_KEY env var is NOT set!\n" +
    "   Admin endpoints (force-unlock, genesis-wallet, mining/status) will be unprotected.\n" +
    "   Set ADMIN_KEY to a strong random secret before production use!\n"
  );
}

export const CHAIN_CONFIG = {
  NAME: "IXCOIN",
  TICKER: "IXC",
  NETWORK: "IXCOIN Network",
  CHAIN_ID: 7777,

  MAX_SUPPLY: 21_000_000,
  PREMINE: 11_000_000,
  MINING_SUPPLY: 10_000_000,

  INITIAL_REWARD: 12.5,
  HALVING_INTERVAL: 200_000,
  MIN_REWARD: 0.00000001,

  INITIAL_DIFFICULTY: 6,
  MAX_DIFFICULTY: Number.MAX_SAFE_INTEGER,
  DIFFICULTY_ADJUSTMENT_INTERVAL: 10,
  TARGET_BLOCK_TIME_MS: 300_000,

  MAX_BLOCK_SIZE: 1_000_000,
  MAX_TX_PER_BLOCK: 2000,

  BASE_GAS_PRICE: 1,
  MIN_GAS_PRICE: 0.1,
  BLOCK_GAS_LIMIT: 10_000_000,
  TX_GAS_LIMIT: 21_000,
  CONTRACT_GAS_LIMIT: 1_000_000,

  GENESIS_TIMESTAMP: 1743501600000,
  GENESIS_MESSAGE: "IXCOIN Genesis Block - Building the future of decentralized finance",

  get GENESIS_MNEMONIC(): string {
    return process.env["GENESIS_MNEMONIC"] ?? DEFAULT_GENESIS_MNEMONIC;
  },

  P2P_PORT: 4001,
  HTTP_PORT: 8080,

  VERSION: "1.0.0",
} as const;
