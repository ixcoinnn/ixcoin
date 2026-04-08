import { pool } from "@workspace/db";
import { sha256 } from "../blockchain/crypto.js";

export interface LiquidityPool {
  id: string;
  tokenA: string;
  tokenB: string;
  reserveA: number;
  reserveB: number;
  totalLPShares: number;
  fee: number;          // e.g. 0.003 = 0.3%
  protocolFee: number;  // e.g. 0.001 = 0.1% to treasury
  totalVolume: number;
  totalFees: number;
  creator: string;
  txHash: string;
  createdAt: number;
}

export interface LPPosition {
  id: string;
  poolId: string;
  provider: string;
  shares: number;
  tokenAAdded: number;
  tokenBAdded: number;
  txHash: string;
  addedAt: number;
}

export interface SwapRecord {
  id: string;
  poolId: string;
  trader: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: number;
  amountOut: number;
  fee: number;
  priceImpact: number;
  txHash: string;
  timestamp: number;
}

export interface StakingPool {
  id: string;
  name: string;
  stakingToken: string;     // token being staked (IXC or LP)
  rewardToken: string;      // token being rewarded
  rewardPerBlock: number;
  totalStaked: number;
  totalRewardDistributed: number;
  startBlock: number;
  endBlock: number;
  minStakeDuration: number; // blocks
  earlyExitPenalty: number; // percent
  active: boolean;
  createdAt: number;
}

export interface StakePosition {
  id: string;
  poolId: string;
  staker: string;
  amount: number;
  sharePercent: number;
  pendingRewards: number;
  stakedAt: number;
  lastClaimBlock: number;
  lockUntilBlock: number;
}

// Constant Product AMM: x * y = k
export class AMMEngine {
  // Calculate output amount given input (with fee)
  getAmountOut(amountIn: number, reserveIn: number, reserveOut: number, fee: number): number {
    if (amountIn <= 0 || reserveIn <= 0 || reserveOut <= 0) return 0;
    const amountInWithFee = amountIn * (1 - fee);
    const numerator = amountInWithFee * reserveOut;
    const denominator = reserveIn + amountInWithFee;
    return numerator / denominator;
  }

  // Calculate required input for exact output
  getAmountIn(amountOut: number, reserveIn: number, reserveOut: number, fee: number): number {
    if (amountOut <= 0 || reserveIn <= 0 || reserveOut <= 0) return 0;
    const numerator = reserveIn * amountOut;
    const denominator = (reserveOut - amountOut) * (1 - fee);
    return numerator / denominator + 1;
  }

  // Price of tokenA in terms of tokenB
  getPrice(reserveA: number, reserveB: number): number {
    if (reserveA === 0) return 0;
    return reserveB / reserveA;
  }

  // Calculate price impact percentage
  getPriceImpact(amountIn: number, reserveIn: number): number {
    return (amountIn / (reserveIn + amountIn)) * 100;
  }

  // LP shares to mint on add liquidity
  getLPShares(amountA: number, amountB: number, reserveA: number, reserveB: number, totalLP: number): number {
    if (totalLP === 0) {
      // Initial liquidity: geometric mean
      return Math.sqrt(amountA * amountB);
    }
    // Proportional
    return Math.min(
      (amountA / reserveA) * totalLP,
      (amountB / reserveB) * totalLP
    );
  }

  // Amounts to return when removing liquidity
  getLiquidityAmounts(shares: number, totalLP: number, reserveA: number, reserveB: number): { amountA: number; amountB: number } {
    const ratio = shares / totalLP;
    return { amountA: reserveA * ratio, amountB: reserveB * ratio };
  }
}

export class DeFiStorage {
  async ensureTables(): Promise<void> {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ix_defi_pools (
        id TEXT PRIMARY KEY,
        token_a TEXT NOT NULL,
        token_b TEXT NOT NULL,
        reserve_a NUMERIC NOT NULL DEFAULT 0,
        reserve_b NUMERIC NOT NULL DEFAULT 0,
        total_lp_shares NUMERIC NOT NULL DEFAULT 0,
        fee NUMERIC NOT NULL DEFAULT 0.003,
        protocol_fee NUMERIC NOT NULL DEFAULT 0.001,
        total_volume NUMERIC NOT NULL DEFAULT 0,
        total_fees NUMERIC NOT NULL DEFAULT 0,
        creator TEXT NOT NULL,
        tx_hash TEXT NOT NULL DEFAULT '',
        created_at BIGINT NOT NULL,
        UNIQUE(token_a, token_b)
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ix_defi_lp_positions (
        id TEXT PRIMARY KEY,
        pool_id TEXT NOT NULL REFERENCES ix_defi_pools(id),
        provider TEXT NOT NULL,
        shares NUMERIC NOT NULL DEFAULT 0,
        token_a_added NUMERIC NOT NULL DEFAULT 0,
        token_b_added NUMERIC NOT NULL DEFAULT 0,
        tx_hash TEXT NOT NULL DEFAULT '',
        added_at BIGINT NOT NULL
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS ix_defi_lp_provider ON ix_defi_lp_positions(provider)`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ix_defi_swaps (
        id TEXT PRIMARY KEY,
        pool_id TEXT NOT NULL,
        trader TEXT NOT NULL,
        token_in TEXT NOT NULL,
        token_out TEXT NOT NULL,
        amount_in NUMERIC NOT NULL,
        amount_out NUMERIC NOT NULL,
        fee NUMERIC NOT NULL DEFAULT 0,
        price_impact NUMERIC NOT NULL DEFAULT 0,
        tx_hash TEXT NOT NULL DEFAULT '',
        timestamp BIGINT NOT NULL
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS ix_defi_swaps_trader ON ix_defi_swaps(trader)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS ix_defi_swaps_pool ON ix_defi_swaps(pool_id)`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ix_defi_staking_pools (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        staking_token TEXT NOT NULL,
        reward_token TEXT NOT NULL,
        reward_per_block NUMERIC NOT NULL DEFAULT 0,
        total_staked NUMERIC NOT NULL DEFAULT 0,
        total_reward_distributed NUMERIC NOT NULL DEFAULT 0,
        start_block INTEGER NOT NULL DEFAULT 0,
        end_block INTEGER NOT NULL DEFAULT 0,
        min_stake_duration INTEGER NOT NULL DEFAULT 0,
        early_exit_penalty NUMERIC NOT NULL DEFAULT 0,
        active BOOLEAN NOT NULL DEFAULT true,
        created_at BIGINT NOT NULL
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ix_defi_stakes (
        id TEXT PRIMARY KEY,
        pool_id TEXT NOT NULL REFERENCES ix_defi_staking_pools(id),
        staker TEXT NOT NULL,
        amount NUMERIC NOT NULL,
        share_percent NUMERIC NOT NULL DEFAULT 0,
        pending_rewards NUMERIC NOT NULL DEFAULT 0,
        staked_at BIGINT NOT NULL,
        last_claim_block INTEGER NOT NULL DEFAULT 0,
        lock_until_block INTEGER NOT NULL DEFAULT 0
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS ix_defi_stakes_staker ON ix_defi_stakes(staker)`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ix_defi_user_balances (
        address TEXT NOT NULL,
        token TEXT NOT NULL,
        balance NUMERIC NOT NULL DEFAULT 0,
        updated_at BIGINT NOT NULL,
        PRIMARY KEY (address, token)
      )
    `);
  }

  async getOrCreatePool(tokenA: string, tokenB: string, fee: number, creator: string, txHash: string): Promise<LiquidityPool> {
    const [ta, tb] = [tokenA, tokenB].sort();
    const id = sha256(`pool:${ta}:${tb}`).slice(0, 16);
    await pool.query(
      `INSERT INTO ix_defi_pools (id, token_a, token_b, fee, creator, tx_hash, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (token_a, token_b) DO NOTHING`,
      [id, ta, tb, fee, creator, txHash, Date.now()]
    );
    const res = await pool.query(`SELECT * FROM ix_defi_pools WHERE id=$1`, [id]);
    return this.rowToPool(res.rows[0]);
  }

  async getPool(id: string): Promise<LiquidityPool | null> {
    const res = await pool.query(`SELECT * FROM ix_defi_pools WHERE id=$1`, [id]);
    if (res.rows.length === 0) return null;
    return this.rowToPool(res.rows[0]);
  }

  async getPoolByTokens(tokenA: string, tokenB: string): Promise<LiquidityPool | null> {
    const [ta, tb] = [tokenA, tokenB].sort();
    const res = await pool.query(`SELECT * FROM ix_defi_pools WHERE token_a=$1 AND token_b=$2`, [ta, tb]);
    if (res.rows.length === 0) return null;
    return this.rowToPool(res.rows[0]);
  }

  async updatePoolReserves(id: string, reserveA: number, reserveB: number, totalLP: number, volumeDelta: number, feeDelta: number): Promise<void> {
    await pool.query(
      `UPDATE ix_defi_pools SET reserve_a=$2, reserve_b=$3, total_lp_shares=$4, total_volume=total_volume+$5, total_fees=total_fees+$6 WHERE id=$1`,
      [id, reserveA, reserveB, totalLP, volumeDelta, feeDelta]
    );
  }

  async addLPPosition(pos: LPPosition): Promise<void> {
    // Check if user already has a position in this pool
    const existing = await pool.query(
      `SELECT id, shares FROM ix_defi_lp_positions WHERE pool_id=$1 AND provider=$2 LIMIT 1`,
      [pos.poolId, pos.provider]
    );
    if (existing.rows.length > 0) {
      await pool.query(
        `UPDATE ix_defi_lp_positions SET shares=shares+$2, token_a_added=token_a_added+$3, token_b_added=token_b_added+$4 WHERE id=$1`,
        [existing.rows[0].id, pos.shares, pos.tokenAAdded, pos.tokenBAdded]
      );
    } else {
      await pool.query(
        `INSERT INTO ix_defi_lp_positions (id, pool_id, provider, shares, token_a_added, token_b_added, tx_hash, added_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [pos.id, pos.poolId, pos.provider, pos.shares, pos.tokenAAdded, pos.tokenBAdded, pos.txHash, pos.addedAt]
      );
    }
  }

  async removeLPShares(poolId: string, provider: string, shares: number): Promise<void> {
    await pool.query(
      `UPDATE ix_defi_lp_positions SET shares=GREATEST(shares-$3, 0) WHERE pool_id=$1 AND provider=$2`,
      [poolId, provider, shares]
    );
  }

  async getLPPosition(poolId: string, provider: string): Promise<LPPosition | null> {
    const res = await pool.query(
      `SELECT * FROM ix_defi_lp_positions WHERE pool_id=$1 AND provider=$2 LIMIT 1`,
      [poolId, provider]
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return { id: r.id, poolId: r.pool_id, provider: r.provider, shares: Number(r.shares), tokenAAdded: Number(r.token_a_added), tokenBAdded: Number(r.token_b_added), txHash: r.tx_hash, addedAt: Number(r.added_at) };
  }

  async saveSwap(swap: SwapRecord): Promise<void> {
    await pool.query(
      `INSERT INTO ix_defi_swaps (id, pool_id, trader, token_in, token_out, amount_in, amount_out, fee, price_impact, tx_hash, timestamp)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [swap.id, swap.poolId, swap.trader, swap.tokenIn, swap.tokenOut, swap.amountIn, swap.amountOut, swap.fee, swap.priceImpact, swap.txHash, swap.timestamp]
    );
  }

  async listPools(limit = 20): Promise<object[]> {
    const res = await pool.query(`SELECT * FROM ix_defi_pools ORDER BY total_volume DESC LIMIT $1`, [limit]);
    return res.rows;
  }

  async getSwapHistory(trader: string, limit = 20): Promise<object[]> {
    const res = await pool.query(
      `SELECT * FROM ix_defi_swaps WHERE trader=$1 ORDER BY timestamp DESC LIMIT $2`, [trader, limit]
    );
    return res.rows;
  }

  async getUserLPPositions(provider: string): Promise<object[]> {
    const res = await pool.query(
      `SELECT lp.*, p.token_a, p.token_b, p.reserve_a, p.reserve_b, p.total_lp_shares, p.fee, p.total_volume
       FROM ix_defi_lp_positions lp
       JOIN ix_defi_pools p ON p.id = lp.pool_id
       WHERE lp.provider=$1 AND lp.shares > 0`,
      [provider]
    );
    return res.rows;
  }

  // Staking
  async createStakingPool(p: Omit<StakingPool, "totalStaked" | "totalRewardDistributed">): Promise<void> {
    await pool.query(
      `INSERT INTO ix_defi_staking_pools (id, name, staking_token, reward_token, reward_per_block, start_block, end_block, min_stake_duration, early_exit_penalty, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [p.id, p.name, p.stakingToken, p.rewardToken, p.rewardPerBlock, p.startBlock, p.endBlock, p.minStakeDuration, p.earlyExitPenalty, p.createdAt]
    );
  }

  async getStakingPool(id: string): Promise<StakingPool | null> {
    const res = await pool.query(`SELECT * FROM ix_defi_staking_pools WHERE id=$1`, [id]);
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return { id: r.id, name: r.name, stakingToken: r.staking_token, rewardToken: r.reward_token, rewardPerBlock: Number(r.reward_per_block), totalStaked: Number(r.total_staked), totalRewardDistributed: Number(r.total_reward_distributed), startBlock: r.start_block, endBlock: r.end_block, minStakeDuration: r.min_stake_duration, earlyExitPenalty: Number(r.early_exit_penalty), active: r.active, createdAt: Number(r.created_at) };
  }

  async listStakingPools(): Promise<object[]> {
    const res = await pool.query(`SELECT * FROM ix_defi_staking_pools WHERE active=true ORDER BY created_at DESC`);
    return res.rows;
  }

  async stake(pos: StakePosition): Promise<void> {
    const existing = await pool.query(
      `SELECT id FROM ix_defi_stakes WHERE pool_id=$1 AND staker=$2 LIMIT 1`,
      [pos.poolId, pos.staker]
    );
    if (existing.rows.length > 0) {
      await pool.query(
        `UPDATE ix_defi_stakes SET amount=amount+$2, lock_until_block=$3 WHERE id=$1`,
        [existing.rows[0].id, pos.amount, pos.lockUntilBlock]
      );
    } else {
      await pool.query(
        `INSERT INTO ix_defi_stakes (id, pool_id, staker, amount, share_percent, pending_rewards, staked_at, last_claim_block, lock_until_block)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [pos.id, pos.poolId, pos.staker, pos.amount, pos.sharePercent, 0, pos.stakedAt, pos.lastClaimBlock, pos.lockUntilBlock]
      );
    }
    await pool.query(`UPDATE ix_defi_staking_pools SET total_staked=total_staked+$2 WHERE id=$1`, [pos.poolId, pos.amount]);
  }

  async unstake(poolId: string, staker: string, amount: number): Promise<void> {
    await pool.query(
      `UPDATE ix_defi_stakes SET amount=GREATEST(amount-$3,0) WHERE pool_id=$1 AND staker=$2`,
      [poolId, staker, amount]
    );
    await pool.query(`UPDATE ix_defi_staking_pools SET total_staked=GREATEST(total_staked-$2,0) WHERE id=$1`, [poolId, amount]);
  }

  async getStakePosition(poolId: string, staker: string): Promise<StakePosition | null> {
    const res = await pool.query(
      `SELECT * FROM ix_defi_stakes WHERE pool_id=$1 AND staker=$2 LIMIT 1`,
      [poolId, staker]
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return { id: r.id, poolId: r.pool_id, staker: r.staker, amount: Number(r.amount), sharePercent: Number(r.share_percent), pendingRewards: Number(r.pending_rewards), stakedAt: Number(r.staked_at), lastClaimBlock: r.last_claim_block, lockUntilBlock: r.lock_until_block };
  }

  async getUserStakes(staker: string): Promise<object[]> {
    const res = await pool.query(
      `SELECT s.*, p.name, p.staking_token, p.reward_token, p.reward_per_block, p.total_staked
       FROM ix_defi_stakes s JOIN ix_defi_staking_pools p ON p.id=s.pool_id
       WHERE s.staker=$1 AND s.amount>0`,
      [staker]
    );
    return res.rows;
  }

  // User token balances (for DeFi tokens like LP shares)
  async getUserBalance(address: string, token: string): Promise<number> {
    const res = await pool.query(
      `SELECT balance FROM ix_defi_user_balances WHERE address=$1 AND token=$2`,
      [address, token]
    );
    return res.rows.length > 0 ? Number(res.rows[0].balance) : 0;
  }

  async updateUserBalance(address: string, token: string, delta: number): Promise<void> {
    await pool.query(
      `INSERT INTO ix_defi_user_balances (address, token, balance, updated_at) VALUES ($1,$2,$3,$4)
       ON CONFLICT (address, token) DO UPDATE SET balance=GREATEST(ix_defi_user_balances.balance+$3, 0), updated_at=$4`,
      [address, token, delta, Date.now()]
    );
  }

  async getUserPortfolio(address: string): Promise<object[]> {
    const res = await pool.query(
      `SELECT * FROM ix_defi_user_balances WHERE address=$1 AND balance>0 ORDER BY balance DESC`,
      [address]
    );
    return res.rows;
  }

  private rowToPool(r: Record<string, unknown>): LiquidityPool {
    return {
      id: r.id as string, tokenA: r.token_a as string, tokenB: r.token_b as string,
      reserveA: Number(r.reserve_a), reserveB: Number(r.reserve_b),
      totalLPShares: Number(r.total_lp_shares), fee: Number(r.fee),
      protocolFee: Number(r.protocol_fee), totalVolume: Number(r.total_volume),
      totalFees: Number(r.total_fees), creator: r.creator as string,
      txHash: r.tx_hash as string, createdAt: Number(r.created_at),
    };
  }
}

export const defiStorage = new DeFiStorage();
export const amm = new AMMEngine();
