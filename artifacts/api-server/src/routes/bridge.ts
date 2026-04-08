import { Router } from "express";
import { bridgeStorage, BRIDGE_CONFIG, calcBridgeFee, generateBridgeId } from "../features/bridge.js";

const router = Router();

// Get supported chains and tokens
router.get("/config", async (req, res) => {
  res.json({
    supportedChains: BRIDGE_CONFIG.supportedChains,
    supportedTokens: BRIDGE_CONFIG.supportedTokens,
    fees: {
      baseFeePercent: BRIDGE_CONFIG.baseFeePercent,
      minFee: BRIDGE_CONFIG.minFee,
    },
    confirmations: BRIDGE_CONFIG.requiredConfirmations,
  });
});

// Estimate bridge fee
router.get("/estimate", async (req, res) => {
  try {
    const { token, amount, sourceChain, destChain } = req.query;
    if (!token || !amount) return res.status(400).json({ error: "token, amount required" });
    const fee = calcBridgeFee(Number(amount), String(token));
    const tokenCfg = BRIDGE_CONFIG.supportedTokens.find((t) => t.symbol === String(token));
    res.json({
      token, sourceChain, destChain,
      amount: Number(amount),
      bridgeFee: fee,
      receive: Number(amount) - fee,
      minBridge: tokenCfg?.minBridge ?? 0,
      maxBridge: tokenCfg?.maxBridge ?? 0,
      estimatedTime: "5-30 minutes",
      requiredConfirmations: BRIDGE_CONFIG.requiredConfirmations[String(sourceChain)] ?? 10,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Initiate bridge (lock tokens on IXCOIN → receive on dest)
router.post("/lock", async (req, res) => {
  try {
    const { sender, recipient, token, amount, destChain, sourceHash } = req.body;
    if (!sender || !recipient || !token || !amount || !destChain) {
      return res.status(400).json({ error: "sender, recipient, token, amount, destChain required" });
    }

    const tokenCfg = BRIDGE_CONFIG.supportedTokens.find((t) => t.symbol === String(token));
    if (!tokenCfg) return res.status(400).json({ error: "Unsupported token" });
    if (!BRIDGE_CONFIG.supportedChains.includes(destChain)) return res.status(400).json({ error: "Unsupported destination chain" });
    if (Number(amount) < (tokenCfg.minBridge ?? 0)) return res.status(400).json({ error: `Minimum bridge amount is ${tokenCfg.minBridge}` });
    if (tokenCfg.maxBridge && Number(amount) > tokenCfg.maxBridge) return res.status(400).json({ error: `Maximum bridge amount is ${tokenCfg.maxBridge}` });

    const bridgeFee = calcBridgeFee(Number(amount), token);
    const id = generateBridgeId(sender, token, Number(amount));
    const requiredConfirmations = BRIDGE_CONFIG.requiredConfirmations["ixcoin"] ?? 10;

    await bridgeStorage.createRequest({
      id,
      sourceChain: "ixcoin",
      destChain,
      sender, recipient, token,
      amount: Number(amount),
      bridgeFee,
      status: "locked",
      sourceHash,
      requiredConfirmations,
      expiresAt: Date.now() + BRIDGE_CONFIG.expiryMs,
      createdAt: Date.now(),
    });

    await bridgeStorage.updateLockedAmount(token, "ixcoin", Number(amount));
    await bridgeStorage.addRelayerEvent(id, "LOCK", { sender, amount: Number(amount), destChain }, sourceHash);

    res.json({ success: true, bridgeId: id, bridgeFee, receive: Number(amount) - bridgeFee, status: "locked", estimatedTime: "5-30 minutes" });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Bridge in (receive wrapped tokens from external chain)
router.post("/bridge-in", async (req, res) => {
  try {
    const { sender, recipient, token, amount, sourceChain, sourceHash } = req.body;
    if (!sender || !recipient || !token || !amount || !sourceChain || !sourceHash) {
      return res.status(400).json({ error: "sender, recipient, token, amount, sourceChain, sourceHash required" });
    }

    const tokenCfg = BRIDGE_CONFIG.supportedTokens.find((t) => t.symbol === String(token));
    if (!tokenCfg) return res.status(400).json({ error: "Unsupported token" });
    if (!BRIDGE_CONFIG.supportedChains.includes(sourceChain)) return res.status(400).json({ error: "Unsupported source chain" });

    const bridgeFee = calcBridgeFee(Number(amount), token);
    const id = generateBridgeId(sender, token, Number(amount));
    const requiredConfirmations = BRIDGE_CONFIG.requiredConfirmations[sourceChain] ?? 10;

    await bridgeStorage.createRequest({
      id,
      sourceChain,
      destChain: "ixcoin",
      sender, recipient, token,
      amount: Number(amount),
      bridgeFee,
      status: "minting",
      sourceHash,
      requiredConfirmations,
      expiresAt: Date.now() + BRIDGE_CONFIG.expiryMs,
      createdAt: Date.now(),
    });

    await bridgeStorage.addRelayerEvent(id, "BRIDGE_IN", { sender, sourceChain, amount: Number(amount) }, sourceHash);

    // Simulate completion after confirmations
    await bridgeStorage.updateRequest(id, { status: "completed", confirmations: requiredConfirmations });

    res.json({ success: true, bridgeId: id, received: Number(amount) - bridgeFee, bridgeFee, token, recipient, status: "completed" });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Update bridge status (relayer endpoint)
router.post("/update/:id", async (req, res) => {
  try {
    const { status, destHash, confirmations } = req.body;
    await bridgeStorage.updateRequest(req.params.id, { status, destHash, confirmations });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Get bridge request
router.get("/request/:id", async (req, res) => {
  try {
    const req_ = await bridgeStorage.getRequest(req.params.id);
    if (!req_) return res.status(404).json({ error: "Not found" });
    res.json(req_);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Get user bridge history
router.get("/history/:address", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    const history = await bridgeStorage.getUserRequests(req.params.address, limit);
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Pending requests (relayer view)
router.get("/pending", async (req, res) => {
  try {
    const pending = await bridgeStorage.getPendingRequests();
    res.json(pending);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Bridge stats
router.get("/stats", async (req, res) => {
  try {
    const [stats, locked] = await Promise.all([
      bridgeStorage.getStats(),
      bridgeStorage.getLockedAmounts(),
    ]);
    res.json({ ...stats as object, lockedByToken: locked, supportedChains: BRIDGE_CONFIG.supportedChains.length });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
