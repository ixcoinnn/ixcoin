import { Router, type IRouter, Request, Response } from "express";
import { blockchain, IXWallet, Transaction, CHAIN_CONFIG, validateAddress } from "../blockchain/index.js";
import { broadcastTransaction, broadcastBlock, connectToPeer, getPeerCount, getKnownPeers } from "../p2p/p2p.js";
import { emitNewBlock, emitNewTx, getLiveFeedClientCount } from "../p2p/live-feed.js";
import { emitNewBlockSSE, emitNewTxSSE } from "./events.js";
import { MiniVM } from "../blockchain/vm.js";
import { sha256 } from "../blockchain/crypto.js";
import { HDKey } from "@scure/bip32";
import { v4 as uuidv4 } from "uuid";
import {
  strictRateLimit,
  miningRateLimit,
  walletRateLimit,
  sendTxRateLimit,
  p2pRateLimit,
  contractDeployRateLimit,
  nftMintRateLimit,
} from "../middlewares/rateLimiter.js";
import {
  validateBody,
  SignedTxSchema,
  MineSchema,
  WalletRestoreSchema,
  P2PConnectSchema,
  ContractDeploySchema,
  ContractCallSchema,
  TokenizeRWASchema,
  RWATransferSchema,
  NFTMintSchema,
} from "../middlewares/validate.js";
import { asyncHandler } from "../middlewares/errorHandler.js";
import { miningTimeout } from "../middlewares/timeout.js";
import { logger, auditLog } from "../lib/logger.js";
import { acquireMiningLock, releaseMiningLock } from "../middlewares/security.js";
import { getActiveNodes, forceReleaseMiningLock, getMiningLockStatus } from "../lib/redis.js";
import { adminAuth } from "../middlewares/auth.js";
import { searchRateLimit } from "../middlewares/rateLimiter.js";

const router: IRouter = Router();

blockchain.storage.ensureContractTable().catch(() => {});
blockchain.storage.ensureRWATable().catch(() => {});

// ─── READ endpoints ──────────────────────────────────────────────────────────

router.get("/info", (_req, res) => {
  res.json(blockchain.getStats());
});

router.get("/stats", asyncHandler(async (_req, res) => {
  const [totalTxs, recentBlocks, recentTxs] = await Promise.all([
    blockchain.storage.getTotalTransactions(),
    blockchain.storage.getRecentBlocks(5),
    blockchain.storage.getRecentTransactions(5),
  ]);
  // Stats change ~every block (~15s) — 8s stale-while-revalidate balances freshness vs DB load
  res.setHeader("Cache-Control", "public, max-age=8, stale-while-revalidate=16");
  res.json({
    ...blockchain.getStats(),
    totalTransactions: totalTxs,
    recentBlocks,
    recentTransactions: recentTxs,
    peers: getPeerCount(),
  });
}));

router.get("/chain", asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(String(req.query.limit ?? "50")), 200);
  const blocks = await blockchain.storage.getRecentBlocks(limit);
  res.json({ blocks, total: blockchain.chain.length });
}));

router.get("/block/:id", asyncHandler(async (req, res) => {
  const id = req.params.id;
  if (!id) return res.status(400).json({ error: "Block ID diperlukan" });
  const block = isNaN(Number(id))
    ? await blockchain.storage.getBlock(id)
    : await blockchain.storage.getBlock(Number(id));
  if (!block) return res.status(404).json({ error: "Block tidak ditemukan" });
  // Blocks are immutable once mined — cache aggressively
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.setHeader("ETag", `"block-${block.hash.slice(0, 16)}"`);
  res.json(block.toJSON());
}));

router.get("/tx/:id", asyncHandler(async (req, res) => {
  const txId = req.params.id?.trim();
  if (!txId || txId.length < 10) return res.status(400).json({ error: "TX ID tidak valid" });
  const tx = await blockchain.storage.getTransaction(txId);
  if (!tx) return res.status(404).json({ error: "Transaksi tidak ditemukan" });
  // Confirmed transactions are immutable — cache aggressively
  if (tx.status === "confirmed") {
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.setHeader("ETag", `"tx-${txId.slice(0, 16)}"`);
  } else {
    res.setHeader("Cache-Control", "no-store");
  }
  res.json(tx);
}));

router.get("/address/:addr", asyncHandler(async (req, res) => {
  const addr = req.params.addr?.trim();
  if (!addr || !validateAddress(addr)) return res.status(400).json({ error: "Alamat IXCOIN tidak valid" });
  const balance = blockchain.getBalance(addr);
  const nonce = blockchain.getNonce(addr);
  const pending = blockchain.getPendingOutflow(addr);
  // FIX: Use COUNT query instead of fetching 1000 txs just to count them
  const [txs, txCount] = await Promise.all([
    blockchain.storage.getAddressTransactions(addr, 20, 0),
    blockchain.storage.getAddressTxCount(addr),
  ]);
  res.json({
    address: addr,
    balance,
    pendingOutflow: pending,
    available: Math.max(0, balance - pending),
    nonce,
    txCount,
    transactions: txs,
  });
}));

router.get("/balance/:addr", (req: Request, res: Response) => {
  const addr = req.params.addr?.trim();
  if (!addr || !validateAddress(addr)) return res.status(400).json({ error: "Alamat tidak valid" });
  res.json({ address: addr, balance: blockchain.getBalance(addr), ticker: CHAIN_CONFIG.TICKER });
});

router.get("/mempool", (_req, res) => {
  res.json({
    count: blockchain.mempool.length,
    transactions: blockchain.mempool.map((t) => t.toJSON()),
    totalFees: blockchain.mempool.reduce((s, t) => s + t.fee, 0),
  });
});

router.get("/gas/estimate", (req, res) => {
  const priority = (req.query.priority as "low" | "medium" | "high") ?? "medium";
  const validPriorities = ["low", "medium", "high"];
  if (!validPriorities.includes(priority)) {
    return res.status(400).json({ error: "Priority harus: low, medium, atau high" });
  }
  res.json({ ...blockchain.gas.estimate(priority), baseFee: blockchain.gas.getBaseFee() });
});

// FIX: validate only recent N blocks to prevent DoS — full chain scan is O(n) CPU
router.get("/validate", strictRateLimit, (_req, res) => {
  const chain = blockchain.chain;
  const checkLast = Math.min(100, chain.length);
  const start = Math.max(1, chain.length - checkLast);
  let valid = true;
  let error: string | undefined;
  for (let i = start; i < chain.length; i++) {
    const block = chain[i];
    const prev = chain[i - 1];
    if (!block || !prev || !block.isValid(prev)) {
      valid = false;
      error = `Block ${i} tidak valid`;
      break;
    }
  }
  res.json({
    valid,
    error,
    checkedBlocks: checkLast,
    totalHeight: chain.length - 1,
    note: `Validasi ${checkLast} block terakhir (full-scan tersedia via admin endpoint)`,
  });
});

router.get("/search/:query", searchRateLimit, asyncHandler(async (req, res) => {
  const q = req.params.query?.trim();
  if (!q || q.length < 3 || q.length > 200) {
    return res.status(400).json({ error: "Query tidak valid (3-200 karakter)" });
  }
  if (validateAddress(q)) {
    return res.json({
      type: "address",
      data: { address: q, balance: blockchain.getBalance(q), nonce: blockchain.getNonce(q) },
    });
  }
  const height = parseInt(q);
  if (!isNaN(height) && height >= 0) {
    const block = await blockchain.storage.getBlock(height);
    if (block) return res.json({ type: "block", data: block.toJSON() });
  }
  if (q.length > 20) {
    const [tx, block] = await Promise.all([
      blockchain.storage.getTransaction(q),
      blockchain.storage.getBlock(q),
    ]);
    if (tx) return res.json({ type: "transaction", data: tx });
    if (block) return res.json({ type: "block", data: block.toJSON() });
  }
  res.status(404).json({ error: "Tidak ditemukan" });
}));

router.get("/network", (_req, res) => {
  res.json({
    ...blockchain.getStats(),
    peers: getPeerCount(),
    knownPeers: getKnownPeers(),
    p2pEndpoint: "/p2p",
    liveFeedEndpoint: "/ws",
    liveFeedClients: getLiveFeedClientCount(),
    version: CHAIN_CONFIG.VERSION,
    chainId: CHAIN_CONFIG.CHAIN_ID,
    genesisTimestamp: CHAIN_CONFIG.GENESIS_TIMESTAMP,
    targetBlockTime: CHAIN_CONFIG.TARGET_BLOCK_TIME_MS,
    halvingInterval: CHAIN_CONFIG.HALVING_INTERVAL,
  });
});

// FIX: Protect genesis wallet info — admin only (exposes on-chain state of genesis address)
router.get("/genesis-wallet", adminAuth, asyncHandler(async (_req, res) => {
  const address = await blockchain.storage.getConfig("genesis_address");
  if (!address) return res.status(404).json({ error: "Genesis wallet tidak ditemukan" });
  const balance = blockchain.getBalance(address);
  const publicKey = await blockchain.storage.getConfig("genesis_pubkey") ?? "";
  res.json({
    address,
    balance,
    publicKey,
    network: CHAIN_CONFIG.NETWORK,
    ticker: CHAIN_CONFIG.TICKER,
  });
}));

// ─── WALLET endpoints (rate limited + validation) ──────────────────────────

router.post("/wallet/new", walletRateLimit, (_req, res) => {
  try {
    const wallet = IXWallet.create();
    const full = wallet.toFullJSON();
    auditLog("WALLET_CREATED", "API", full.address ?? "unknown");
    res.json({
      address: full.address,
      publicKey: full.publicKey,
      privateKey: full.privateKey,
      mnemonic: full.mnemonic,
      network: CHAIN_CONFIG.NETWORK,
      warning: "SIMPAN PRIVATE KEY DAN MNEMONIC! Jangan berbagi dengan siapapun. Ini satu-satunya kali private key ditampilkan.",
    });
  } catch (err) {
    logger.error({ err }, "Failed to create wallet");
    res.status(500).json({ error: "Gagal membuat wallet" });
  }
});

router.post(
  "/wallet/restore",
  walletRateLimit,
  strictRateLimit,
  validateBody(WalletRestoreSchema),
  (req: Request, res: Response) => {
    try {
      const { mnemonic } = req.body as { mnemonic: string };
      const wallet = IXWallet.fromMnemonic(mnemonic.trim());
      auditLog("WALLET_RESTORED", req.ip ?? "unknown", wallet.address);
      res.json({
        address: wallet.address,
        publicKey: wallet.publicKeyHex,
        balance: blockchain.getBalance(wallet.address),
        nonce: blockchain.getNonce(wallet.address),
        warning: "Private key tidak dikembalikan via API. Gunakan mnemonic untuk mengakses wallet.",
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Mnemonic tidak valid" });
    }
  }
);

// ─── TRANSACTION endpoints ────────────────────────────────────────────────

/**
 * POST /send — Secure transaction broadcast endpoint.
 *
 * SECURITY ARCHITECTURE: The client MUST sign the transaction locally before calling this.
 * Private keys NEVER reach this server. The server only receives:
 *   - The transaction fields (from, to, amount, fee, nonce, timestamp, id)
 *   - A secp256k1 ECDSA signature (64 bytes, compact format)
 *   - The compressed public key (33 bytes)
 *
 * The server verifies the signature cryptographically (ECDSA + address derivation check)
 * then adds the transaction to the mempool. This is equivalent to Bitcoin/Ethereum's
 * broadcast-signed-tx flow and is safe for use with billions of users.
 */
router.post(
  "/send",
  sendTxRateLimit,
  strictRateLimit,
  validateBody(SignedTxSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { id, from, to, amount, fee, nonce, timestamp, gasPrice, signature, publicKey, contract } = req.body as {
      id: string; from: string; to: string; amount: number; fee: number;
      nonce: number; timestamp: number; gasPrice?: number;
      signature: string; publicKey: string; contract?: string | null;
    };

    if (from === to) {
      return res.status(400).json({ error: "Tidak bisa mengirim ke alamat sendiri" });
    }

    // Reconstruct transaction from client-provided fields (no private key involved)
    const gasEstimate = blockchain.gas.estimate("medium");
    const tx = new Transaction({
      from,
      to,
      amount: Number(amount),
      fee,
      gasPrice: gasPrice ?? gasEstimate.gasPrice,
      gasUsed: gasEstimate.gasUsed,
      nonce,
      contract: contract ?? null,
    });

    // Restore exact client-provided fields (id + timestamp are part of signing hash)
    tx.id = id;
    tx.timestamp = timestamp;
    tx.signature = signature.toLowerCase();
    tx.publicKey = publicKey.toLowerCase();

    // Cryptographic verification: checks signature + public key → address derivation
    if (!tx.isValid()) {
      logger.warn({ ip: req.ip, from, to }, "Signature verification failed on /send");
      return res.status(400).json({ error: "Verifikasi signature gagal — pastikan tx ditandatangani dengan benar" });
    }

    blockchain.addTransaction(tx);
    broadcastTransaction(tx);
    emitNewTx({ id: tx.id, from, to, amount: Number(amount), fee: tx.fee, timestamp: tx.timestamp });
    emitNewTxSSE({ id: tx.id, from, to, amount: Number(amount), fee: tx.fee, timestamp: tx.timestamp });

    auditLog("TRANSACTION_SENT", from, to, { txId: tx.id, amount, fee: tx.fee });
    logger.info({ txId: tx.id, from, to, amount, fee }, "Transaction accepted to mempool");

    res.json({
      success: true,
      txId: tx.id,
      from,
      to,
      amount,
      fee: tx.fee,
      nonce,
      status: "pending",
    });
  })
);

// ─── MINING endpoint ──────────────────────────────────────────────────────

router.post(
  "/mine",
  miningRateLimit,
  miningTimeout(120_000),
  validateBody(MineSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { address } = req.body as { address: string };

    // Cek dan acquire distributed mining lock.
    // Lock WAJIB dilepas di blok finally — tidak boleh lewat path manapun.
    const acquired = await acquireMiningLock();
    if (!acquired) {
      logger.warn({ ip: req.ip, address }, "[Mining] Ditolak — lock sedang dipegang node lain");
      return res.status(503).json({ error: "Mining sedang berjalan di node lain — tunggu selesai" });
    }

    logger.info({ ip: req.ip, address }, "[Mining] Lock acquired — mulai mining");

    try {
      auditLog("MINING_STARTED", req.ip ?? "unknown", address);
      const block = await blockchain.mine(address);
      broadcastBlock(block);

      const blockPayload = {
        height: block.height,
        hash: block.hash,
        nonce: block.nonce,
        difficulty: block.difficulty,
        txCount: block.txCount,
        reward: block.blockReward,
        fees: block.totalFees,
        miner: address,
        timestamp: block.timestamp,
      };
      emitNewBlock(blockPayload);
      emitNewBlockSSE(blockPayload);

      auditLog("MINING_SUCCESS", address, `block:${block.height}`, { hash: block.hash.slice(0, 16) });
      logger.info({ height: block.height, hash: block.hash.slice(0, 16), address }, "[Mining] Block berhasil ditambang");

      // Guard: miningTimeout middleware bisa mengirim 503 sebelum mine() selesai.
      // Tanpa cek ini, res.json() setelah headers terkirim akan throw ERR_HTTP_HEADERS_SENT.
      if (!res.headersSent) {
        res.json({
          success: true,
          block: blockPayload,
          newBalance: blockchain.getBalance(address),
        });
      }
    } catch (err) {
      logger.error({ err, address }, "[Mining] Error saat mining block");
      throw err;
    } finally {
      // WAJIB — dijalankan selalu agar lock tidak stuck
      await releaseMiningLock();
    }
  })
);

// ─── MINING LOCK endpoints (admin) ────────────────────────────────────────

// GET /api/ixcoin/mining/status — cek status lock saat ini (admin only)
router.get("/mining/status", adminAuth, asyncHandler(async (_req, res) => {
  const status = await getMiningLockStatus();
  res.json({
    ...status,
    message: status.locked
      ? `Lock aktif — dipegang oleh: ${status.holder} — sisa TTL: ${status.ttlSec}s`
      : "Tidak ada mining yang berjalan",
  });
}));

// GET /api/ixcoin/force-unlock — paksa lepas lock — WAJIB admin key
router.get("/force-unlock", adminAuth, asyncHandler(async (req, res) => {
  const before = await getMiningLockStatus();
  await forceReleaseMiningLock();
  logger.warn({ ip: req.ip, before }, "[MiningLock] Force-unlock dijalankan via endpoint admin");
  auditLog("FORCE_UNLOCK", req.ip ?? "unknown", "mining-lock", { before });
  res.json({
    success: true,
    message: "Mining lock berhasil direset",
    wasLocked: before.locked,
    previousHolder: before.holder,
  });
}));

// ─── P2P endpoints ────────────────────────────────────────────────────────

router.get("/p2p/peers", p2pRateLimit, (_req, res) => {
  res.json({ peers: getKnownPeers(), connected: getPeerCount() });
});

router.post(
  "/p2p/connect",
  p2pRateLimit,
  validateBody(P2PConnectSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { peerUrl } = req.body as { peerUrl: string };
    await connectToPeer(peerUrl);
    auditLog("P2P_CONNECTED", req.ip ?? "unknown", peerUrl);
    res.json({ success: true, message: `Terhubung ke ${peerUrl}`, totalPeers: getPeerCount() });
  })
);

// ─── CONTRACT endpoints ────────────────────────────────────────────────────

function generateContractAddress(deployer: string, code: string): string {
  const raw = sha256(deployer + code + Date.now().toString());
  return "IXC" + raw.slice(0, 30).toUpperCase();
}

router.post("/contract/deploy", contractDeployRateLimit, strictRateLimit, validateBody(ContractDeploySchema), asyncHandler(async (req: Request, res: Response) => {
  const {
    deployerAddress, privateKeyHex, name, description, code, initialState,
  } = req.body as {
    deployerAddress: string; privateKeyHex: string;
    name?: string; description?: string; code: string;
    initialState?: Record<string, unknown>;
  };

  const initState: Record<string, unknown> = initialState ?? {};
  const vm = new MiniVM(initState, CHAIN_CONFIG.CONTRACT_GAS_LIMIT);
  const testResult = vm.run(code, {
    from: deployerAddress,
    to: "CONTRACT_DEPLOY",
    amount: 0,
    timestamp: Date.now(),
    blockHeight: blockchain.chain.length,
  });

  if (!testResult.success) {
    return res.status(400).json({ error: "Kode kontrak mengandung error: " + testResult.error });
  }

  const finalState = vm.getState();
  const contractAddress = generateContractAddress(deployerAddress, code);

  let hdKey: HDKey;
  try {
    hdKey = new HDKey({ privateKey: Buffer.from(privateKeyHex, "hex") });
  } catch {
    return res.status(400).json({ error: "Private key tidak valid" });
  }

  const publicKeyHex = Buffer.from(hdKey.publicKey!).toString("hex");
  const gasEstimate = blockchain.gas.estimate("medium");
  const nonce = blockchain.getNonce(deployerAddress);

  const tx = new Transaction({
    from: deployerAddress,
    to: contractAddress,
    amount: 0,
    fee: gasEstimate.fee,
    gasPrice: gasEstimate.gasPrice,
    gasUsed: testResult.gasUsed,
    nonce,
    contract: contractAddress,
  });
  tx.sign(privateKeyHex, publicKeyHex);
  blockchain.addTransaction(tx);
  broadcastTransaction(tx);

  await blockchain.storage.saveContract({
    address: contractAddress,
    deployer: deployerAddress,
    name: name ?? "Unnamed Contract",
    description: description ?? "",
    code,
    state: finalState,
    deployTx: tx.id,
    blockHeight: blockchain.chain.length,
  });

  auditLog("CONTRACT_DEPLOYED", deployerAddress, contractAddress, { txId: tx.id });

  res.json({
    success: true,
    contractAddress,
    deployTxId: tx.id,
    gasUsed: testResult.gasUsed,
    initialState: finalState,
    logs: testResult.logs,
    message: "Kontrak berhasil di-deploy! Mine block untuk konfirmasi.",
  });
}));

router.post("/contract/call", strictRateLimit, validateBody(ContractCallSchema), asyncHandler(async (req: Request, res: Response) => {
  const { contractAddress, callerAddress, privateKeyHex, callCode, amount } = req.body as {
    contractAddress: string; callerAddress: string;
    privateKeyHex: string; callCode: string; amount: number;
  };

  const contract = await blockchain.storage.getContract(contractAddress);
  if (!contract) {
    return res.status(404).json({ error: "Kontrak tidak ditemukan" });
  }

  const callAmount = Number(amount ?? 0);
  if (callAmount > 0) {
    const balance = blockchain.getBalance(callerAddress);
    if (balance < callAmount) {
      return res.status(400).json({ error: "Saldo tidak cukup untuk memanggil kontrak" });
    }
  }

  const vm = new MiniVM(contract.state, CHAIN_CONFIG.CONTRACT_GAS_LIMIT);
  const vmResult = vm.run(callCode, {
    from: callerAddress,
    to: contractAddress,
    amount: callAmount,
    timestamp: Date.now(),
    blockHeight: blockchain.chain.length,
  });

  if (vmResult.success) {
    const newState = vm.getState();
    await blockchain.storage.updateContractState(contractAddress, newState);
  }

  let txId: string | undefined;
  if (callAmount > 0 && vmResult.success) {
    let hdKey: HDKey;
    try {
      hdKey = new HDKey({ privateKey: Buffer.from(privateKeyHex, "hex") });
    } catch {
      return res.status(400).json({ error: "Private key tidak valid" });
    }
    const publicKeyHex = Buffer.from(hdKey.publicKey!).toString("hex");
    const gasEstimate = blockchain.gas.estimate("medium");
    const nonce = blockchain.getNonce(callerAddress);
    const tx = new Transaction({
      from: callerAddress,
      to: contractAddress,
      amount: callAmount,
      fee: gasEstimate.fee,
      gasPrice: gasEstimate.gasPrice,
      gasUsed: vmResult.gasUsed,
      nonce,
      contract: contractAddress,
    });
    tx.sign(privateKeyHex, publicKeyHex);
    blockchain.addTransaction(tx);
    broadcastTransaction(tx);
    txId = tx.id;
  }

  const callId = uuidv4();
  await blockchain.storage.saveContractCall({
    id: callId,
    contractAddress,
    caller: callerAddress,
    callCode,
    result: vmResult.result,
    logs: vmResult.logs,
    gasUsed: vmResult.gasUsed,
    success: vmResult.success,
    txId,
    amount: callAmount,
  });

  res.json({
    success: vmResult.success,
    callId,
    result: vmResult.result,
    logs: vmResult.logs,
    gasUsed: vmResult.gasUsed,
    error: vmResult.error,
    txId,
    newState: vmResult.success ? vm.getState() : contract.state,
  });
}));

router.get("/contracts", asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(String(req.query.limit ?? "20")), 100);
  const offset = parseInt(String(req.query.offset ?? "0"));
  const contracts = await blockchain.storage.listContracts(limit, offset);
  res.json({ contracts, total: contracts.length });
}));

router.get("/contract/:address", asyncHandler(async (req, res) => {
  const address = req.params.address?.trim();
  if (!address) return res.status(400).json({ error: "Contract address diperlukan" });
  const contract = await blockchain.storage.getContract(address);
  if (!contract) return res.status(404).json({ error: "Kontrak tidak ditemukan" });
  const calls = await blockchain.storage.getContractCalls(address, 10);
  res.json({ ...contract, recentCalls: calls });
}));

router.get("/contract/:address/calls", asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(String(req.query.limit ?? "20")), 50);
  const calls = await blockchain.storage.getContractCalls(req.params.address, limit);
  res.json({ calls });
}));

// ─── RWA endpoints ────────────────────────────────────────────────────────

function generateRWAAddress(issuer: string, symbol: string): string {
  const raw = sha256(issuer + symbol + Date.now().toString());
  return "RWA" + raw.slice(0, 29).toUpperCase();
}

router.post("/rwa/tokenize", strictRateLimit, validateBody(TokenizeRWASchema), asyncHandler(async (req: Request, res: Response) => {
  const {
    issuerAddress, privateKeyHex,
    name, symbol, assetType, description, location,
    totalSupply, valueIdc, documentHash, metadata,
  } = req.body as {
    issuerAddress: string; privateKeyHex: string;
    name: string; symbol: string; assetType: string;
    description?: string; location?: string;
    totalSupply?: number; valueIdc?: number;
    documentHash?: string; metadata?: Record<string, unknown>;
  };

  const supply = Number(totalSupply ?? 1000);

  const tokenAddress = generateRWAAddress(issuerAddress, symbol);

  let hdKey: HDKey;
  try {
    hdKey = new HDKey({ privateKey: Buffer.from(privateKeyHex, "hex") });
  } catch {
    return res.status(400).json({ error: "Private key tidak valid" });
  }

  const publicKeyHex = Buffer.from(hdKey.publicKey!).toString("hex");
  const gasEstimate = blockchain.gas.estimate("medium");
  const nonce = blockchain.getNonce(issuerAddress);

  const tx = new Transaction({
    from: issuerAddress,
    to: tokenAddress,
    amount: 0,
    fee: gasEstimate.fee,
    gasPrice: gasEstimate.gasPrice,
    gasUsed: 50000,
    nonce,
    contract: tokenAddress,
  });
  tx.sign(privateKeyHex, publicKeyHex);
  blockchain.addTransaction(tx);
  broadcastTransaction(tx);

  await blockchain.storage.saveRWAToken({
    address: tokenAddress,
    name,
    symbol: symbol.toUpperCase(),
    assetType,
    description: description ?? "",
    location: location ?? "",
    totalSupply: supply,
    issuer: issuerAddress,
    valueIdc: Number(valueIdc ?? 0),
    documentHash: documentHash ?? "",
    metadata: metadata ?? {},
    mintTx: tx.id,
  });

  auditLog("RWA_TOKENIZED", issuerAddress, tokenAddress, { name, symbol, supply });

  res.json({
    success: true,
    tokenAddress,
    symbol: symbol.toUpperCase(),
    totalSupply: supply,
    mintTxId: tx.id,
    message: `Token RWA ${name} berhasil diterbitkan dengan ${supply} unit!`,
  });
}));

router.get("/rwa/tokens", asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(String(req.query.limit ?? "30")), 100);
  const assetType = req.query.assetType ? String(req.query.assetType) : undefined;
  const tokens = await blockchain.storage.listRWATokens(limit, assetType);
  res.json({ tokens, total: tokens.length });
}));

router.get("/rwa/token/:address", asyncHandler(async (req, res) => {
  const token = await blockchain.storage.getRWAToken(req.params.address);
  if (!token) return res.status(404).json({ error: "Token RWA tidak ditemukan" });
  const [transfers, holders] = await Promise.all([
    blockchain.storage.getRWATransfers(req.params.address, 10),
    blockchain.storage.getRWAHolders(req.params.address),
  ]);
  res.json({ ...token, recentTransfers: transfers, holders });
}));

router.post("/rwa/transfer", strictRateLimit, validateBody(RWATransferSchema), asyncHandler(async (req: Request, res: Response) => {
  const { tokenAddress, fromAddress, toAddress, privateKeyHex, amount, memo } = req.body as {
    tokenAddress: string; fromAddress: string; toAddress: string;
    privateKeyHex: string; amount: number; memo?: string;
  };

  const token = await blockchain.storage.getRWAToken(tokenAddress);
  if (!token) return res.status(404).json({ error: "Token RWA tidak ditemukan" });
  if (token.status !== "active") return res.status(400).json({ error: "Token tidak aktif" });

  let hdKey: HDKey;
  try {
    hdKey = new HDKey({ privateKey: Buffer.from(privateKeyHex, "hex") });
  } catch {
    return res.status(400).json({ error: "Private key tidak valid" });
  }

  const publicKeyHex = Buffer.from(hdKey.publicKey!).toString("hex");
  const gasEstimate = blockchain.gas.estimate("medium");
  const nonce = blockchain.getNonce(fromAddress);

  const tx = new Transaction({
    from: fromAddress,
    to: toAddress,
    amount: 0,
    fee: gasEstimate.fee,
    gasPrice: gasEstimate.gasPrice,
    gasUsed: 30000,
    nonce,
    contract: tokenAddress,
  });
  tx.sign(privateKeyHex, publicKeyHex);
  blockchain.addTransaction(tx);
  broadcastTransaction(tx);

  const transferId = uuidv4();
  await blockchain.storage.transferRWA({
    id: transferId,
    tokenAddress,
    fromAddress,
    toAddress,
    amount: Number(amount),
    txId: tx.id,
    memo: memo ?? "",
  });

  auditLog("RWA_TRANSFER", fromAddress, toAddress, { tokenAddress, amount, transferId });

  res.json({
    success: true,
    transferId,
    txId: tx.id,
    from: fromAddress,
    to: toAddress,
    amount: Number(amount),
    symbol: token.symbol,
    message: `Berhasil transfer ${amount} ${token.symbol} ke ${toAddress}`,
  });
}));

router.get("/rwa/holdings/:address", asyncHandler(async (req, res) => {
  const holdings = await blockchain.storage.getRWAHoldings(req.params.address);
  res.json({ address: req.params.address, holdings });
}));

export default router;
