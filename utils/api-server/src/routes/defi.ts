import { Router } from "express";
import { defiStorage, amm } from "../features/defi.js";
import { sha256 } from "../blockchain/crypto.js";
import { v4 as uuidv4 } from "uuid";

const router = Router();

// ===========================================================
// POOLS
// ===========================================================

// List pools
router.get("/pools", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    const pools = await defiStorage.listPools(limit);
    res.json(pools);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Get specific pool
router.get("/pools/:id", async (req, res) => {
  try {
    const p = await defiStorage.getPool(req.params.id);
    if (!p) return res.status(404).json({ error: "Pool not found" });
    res.json(p);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Create / get pool
router.post("/pools", async (req, res) => {
  try {
    const { tokenA, tokenB, fee, creator } = req.body;
    if (!tokenA || !tokenB || !creator) return res.status(400).json({ error: "tokenA, tokenB, creator required" });
    if (tokenA === tokenB) return res.status(400).json({ error: "tokenA must differ from tokenB" });
    const txHash = sha256(`pool:${tokenA}:${tokenB}:${Date.now()}`);
    const p = await defiStorage.getOrCreatePool(tokenA, tokenB, fee ?? 0.003, creator, txHash);
    res.json({ success: true, pool: p });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Get price quote for swap
router.get("/quote", async (req, res) => {
  try {
    const { tokenIn, tokenOut, amountIn } = req.query;
    if (!tokenIn || !tokenOut || !amountIn) return res.status(400).json({ error: "tokenIn, tokenOut, amountIn required" });

    const p = await defiStorage.getPoolByTokens(String(tokenIn), String(tokenOut));
    if (!p) return res.status(404).json({ error: "Pool not found for this pair" });

    const isAtoB = p.tokenA === String(tokenIn);
    const [rIn, rOut] = isAtoB ? [p.reserveA, p.reserveB] : [p.reserveB, p.reserveA];
    const ain = Number(amountIn);
    const aout = amm.getAmountOut(ain, rIn, rOut, p.fee);
    const priceImpact = amm.getPriceImpact(ain, rIn);
    const price = amm.getPrice(rIn, rOut);

    res.json({
      tokenIn, tokenOut, amountIn: ain, amountOut: aout,
      priceImpact: priceImpact.toFixed(4),
      fee: ain * p.fee,
      price: price.toFixed(8),
      poolId: p.id,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Swap tokens
router.post("/swap", async (req, res) => {
  try {
    const { trader, tokenIn, tokenOut, amountIn, minAmountOut } = req.body;
    if (!trader || !tokenIn || !tokenOut || !amountIn) {
      return res.status(400).json({ error: "trader, tokenIn, tokenOut, amountIn required" });
    }

    const p = await defiStorage.getPoolByTokens(tokenIn, tokenOut);
    if (!p) return res.status(404).json({ error: "Pool not found" });

    const isAtoB = p.tokenA === tokenIn;
    const [rIn, rOut] = isAtoB ? [p.reserveA, p.reserveB] : [p.reserveB, p.reserveA];
    const ain = Number(amountIn);
    const aout = amm.getAmountOut(ain, rIn, rOut, p.fee);

    if (minAmountOut && aout < Number(minAmountOut)) {
      return res.status(400).json({ error: `Slippage exceeded: got ${aout.toFixed(8)}, min ${minAmountOut}` });
    }

    const priceImpact = amm.getPriceImpact(ain, rIn);
    const fee = ain * p.fee;

    // Update reserves
    const [newRA, newRB] = isAtoB
      ? [p.reserveA + ain, p.reserveB - aout]
      : [p.reserveA - aout, p.reserveB + ain];

    await defiStorage.updatePoolReserves(p.id, newRA, newRB, p.totalLPShares, ain, fee);

    const txHash = sha256(`swap:${trader}:${tokenIn}:${tokenOut}:${Date.now()}`);
    const swapId = uuidv4();
    await defiStorage.saveSwap({ id: swapId, poolId: p.id, trader, tokenIn, tokenOut, amountIn: ain, amountOut: aout, fee, priceImpact, txHash, timestamp: Date.now() });

    res.json({ success: true, amountIn: ain, amountOut: aout, fee, priceImpact: priceImpact.toFixed(4), txHash });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Add liquidity
router.post("/add-liquidity", async (req, res) => {
  try {
    const { provider, tokenA, tokenB, amountA, amountB } = req.body;
    if (!provider || !tokenA || !tokenB || !amountA || !amountB) {
      return res.status(400).json({ error: "provider, tokenA, tokenB, amountA, amountB required" });
    }

    const txHash = sha256(`lp:${provider}:${tokenA}:${tokenB}:${Date.now()}`);
    const p = await defiStorage.getOrCreatePool(tokenA, tokenB, 0.003, provider, txHash);

    const shares = amm.getLPShares(Number(amountA), Number(amountB), p.reserveA, p.reserveB, p.totalLPShares);
    const newRA = p.reserveA + Number(amountA);
    const newRB = p.reserveB + Number(amountB);
    const newLP = p.totalLPShares + shares;

    await defiStorage.updatePoolReserves(p.id, newRA, newRB, newLP, 0, 0);

    const posId = uuidv4();
    await defiStorage.addLPPosition({ id: posId, poolId: p.id, provider, shares, tokenAAdded: Number(amountA), tokenBAdded: Number(amountB), txHash, addedAt: Date.now() });

    // Track LP token balance
    const lpToken = `LP-${p.id}`;
    await defiStorage.updateUserBalance(provider, lpToken, shares);

    res.json({ success: true, shares: shares.toFixed(8), txHash, poolId: p.id, lpToken });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Remove liquidity
router.post("/remove-liquidity", async (req, res) => {
  try {
    const { provider, poolId, shares } = req.body;
    if (!provider || !poolId || !shares) return res.status(400).json({ error: "provider, poolId, shares required" });

    const p = await defiStorage.getPool(poolId);
    if (!p) return res.status(404).json({ error: "Pool not found" });

    const pos = await defiStorage.getLPPosition(poolId, provider);
    if (!pos || pos.shares < Number(shares)) return res.status(400).json({ error: "Insufficient LP shares" });

    const { amountA, amountB } = amm.getLiquidityAmounts(Number(shares), p.totalLPShares, p.reserveA, p.reserveB);
    const newRA = p.reserveA - amountA;
    const newRB = p.reserveB - amountB;
    const newLP = p.totalLPShares - Number(shares);

    await defiStorage.updatePoolReserves(poolId, newRA, newRB, newLP, 0, 0);
    await defiStorage.removeLPShares(poolId, provider, Number(shares));

    const lpToken = `LP-${poolId}`;
    await defiStorage.updateUserBalance(provider, lpToken, -Number(shares));

    const txHash = sha256(`remove_lp:${provider}:${poolId}:${Date.now()}`);
    res.json({ success: true, amountA: amountA.toFixed(8), amountB: amountB.toFixed(8), txHash });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// User LP positions
router.get("/lp/:address", async (req, res) => {
  try {
    const positions = await defiStorage.getUserLPPositions(req.params.address);
    res.json(positions);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Swap history
router.get("/swaps/:address", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    const swaps = await defiStorage.getSwapHistory(req.params.address, limit);
    res.json(swaps);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ===========================================================
// STAKING
// ===========================================================

// List staking pools
router.get("/staking", async (req, res) => {
  try {
    const pools = await defiStorage.listStakingPools();
    res.json(pools);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Create staking pool
router.post("/staking", async (req, res) => {
  try {
    const { name, stakingToken, rewardToken, rewardPerBlock, startBlock, endBlock, minStakeDuration, earlyExitPenalty } = req.body;
    if (!name || !stakingToken || !rewardToken) return res.status(400).json({ error: "name, stakingToken, rewardToken required" });
    const id = sha256(`stake:${stakingToken}:${rewardToken}:${Date.now()}`).slice(0, 16);
    await defiStorage.createStakingPool({ id, name, stakingToken, rewardToken, rewardPerBlock: rewardPerBlock ?? 1, startBlock: startBlock ?? 0, endBlock: endBlock ?? 999999999, minStakeDuration: minStakeDuration ?? 0, earlyExitPenalty: earlyExitPenalty ?? 0, active: true, createdAt: Date.now() });
    res.json({ success: true, id });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Stake
router.post("/stake", async (req, res) => {
  try {
    const { poolId, staker, amount, currentBlock = 0 } = req.body;
    if (!poolId || !staker || !amount) return res.status(400).json({ error: "poolId, staker, amount required" });

    const p = await defiStorage.getStakingPool(poolId);
    if (!p) return res.status(404).json({ error: "Staking pool not found" });
    if (!p.active) return res.status(400).json({ error: "Pool not active" });

    const lockUntilBlock = Number(currentBlock) + p.minStakeDuration;
    const id = uuidv4();
    await defiStorage.stake({ id, poolId, staker, amount: Number(amount), sharePercent: 0, pendingRewards: 0, stakedAt: Date.now(), lastClaimBlock: Number(currentBlock), lockUntilBlock });

    const txHash = sha256(`stake:${staker}:${poolId}:${amount}:${Date.now()}`);
    res.json({ success: true, txHash, lockUntilBlock });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Unstake
router.post("/unstake", async (req, res) => {
  try {
    const { poolId, staker, amount, currentBlock = 0 } = req.body;
    if (!poolId || !staker || !amount) return res.status(400).json({ error: "poolId, staker, amount required" });

    const pos = await defiStorage.getStakePosition(poolId, staker);
    if (!pos) return res.status(404).json({ error: "No stake position found" });
    if (Number(amount) > pos.amount) return res.status(400).json({ error: "Insufficient staked amount" });

    const p = await defiStorage.getStakingPool(poolId);
    const isEarlyExit = pos.lockUntilBlock > Number(currentBlock);
    const penalty = isEarlyExit ? Number(amount) * ((p?.earlyExitPenalty ?? 0) / 100) : 0;
    const received = Number(amount) - penalty;

    await defiStorage.unstake(poolId, staker, Number(amount));
    const txHash = sha256(`unstake:${staker}:${poolId}:${amount}:${Date.now()}`);
    res.json({ success: true, received: received.toFixed(8), penalty: penalty.toFixed(8), earlyExit: isEarlyExit, txHash });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// User stakes
router.get("/stakes/:address", async (req, res) => {
  try {
    const stakes = await defiStorage.getUserStakes(req.params.address);
    res.json(stakes);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// User portfolio
router.get("/portfolio/:address", async (req, res) => {
  try {
    const [portfolio, positions, stakes] = await Promise.all([
      defiStorage.getUserPortfolio(req.params.address),
      defiStorage.getUserLPPositions(req.params.address),
      defiStorage.getUserStakes(req.params.address),
    ]);
    res.json({ balances: portfolio, lpPositions: positions, stakes });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
