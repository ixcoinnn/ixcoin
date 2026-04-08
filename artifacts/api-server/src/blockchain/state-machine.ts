/**
 * Deterministic State Machine
 *
 * Rules:
 *  - applyTransaction() and applyBlock() are pure functions:
 *      (state, input) → new state
 *  - No database access inside these functions.
 *  - No Date.now() or Math.random() — all timestamps come from block header.
 *  - Same (state, block) pair ALWAYS produces the same output.
 *  - Throws on invalid input so callers can decide how to handle.
 */

import { GlobalState, withState, emptyGlobalState } from "./state.js";
import { Transaction } from "./transaction.js";
import { Block } from "./block.js";
import { GasSystem } from "./gas.js";
import { MiniVM } from "./vm.js";
import { CHAIN_CONFIG } from "./config.js";

export interface TxApplyResult {
  state: GlobalState;
  status: "confirmed" | "failed";
  gasUsed: number;
  error?: string;
}

/**
 * applyTransaction — applies a single transaction to the global state.
 *
 * Pure: no I/O, no Date.now(). Timestamp used for VM context comes from
 * the block that contains this transaction.
 *
 * Returns a new GlobalState (original is untouched).
 */
export function applyTransaction(
  state: GlobalState,
  tx: Transaction,
  blockHeight: number,
  blockTimestamp: number,
  gas: GasSystem
): TxApplyResult {
  if (tx.from === "SYSTEM") {
    const newState = withState(state, (d) => {
      d.balances[tx.to] = (d.balances[tx.to] ?? 0) + tx.amount;
      d.totalMinted += tx.amount;
    });
    return { state: newState, status: "confirmed", gasUsed: 0 };
  }

  const available = (state.balances[tx.from] ?? 0);
  if (available < tx.amount + tx.fee) {
    return {
      state,
      status: "failed",
      gasUsed: 0,
      error: `Saldo tidak cukup: tersedia ${available.toFixed(8)}, butuh ${(tx.amount + tx.fee).toFixed(8)} IXC`,
    };
  }

  const expectedNonce = state.nonces[tx.from] ?? 0;
  if (tx.nonce < expectedNonce) {
    return {
      state,
      status: "failed",
      gasUsed: 0,
      error: `Nonce tidak valid: expected ${expectedNonce}, got ${tx.nonce}`,
    };
  }

  let vmGasUsed = 0;
  let vmError: string | undefined;

  if (tx.contract) {
    const contractState = state.contractStorage[tx.contract]?.state ?? {};
    const vm = new MiniVM(contractState, CHAIN_CONFIG.CONTRACT_GAS_LIMIT);
    const result = vm.run(tx.contract, {
      from: tx.from,
      to: tx.to,
      amount: tx.amount,
      timestamp: blockTimestamp,
      blockHeight,
    });
    vmGasUsed = result.gasUsed;
    if (!result.success) {
      vmError = result.error;
      return { state, status: "failed", gasUsed: vmGasUsed, error: vmError };
    }
  }

  const burned = gas.calculateBurn(tx.fee);

  const newState = withState(state, (d) => {
    d.balances[tx.from] = (d.balances[tx.from] ?? 0) - tx.amount - tx.fee;
    d.balances[tx.to] = (d.balances[tx.to] ?? 0) + tx.amount;
    d.nonces[tx.from] = (d.nonces[tx.from] ?? 0) + 1;
    d.totalBurned += burned;

    d.accounts[tx.from] = {
      address: tx.from,
      gasBalance: d.balances[tx.from] ?? 0,
      nonce: d.nonces[tx.from] ?? 0,
    };
  });

  return { state: newState, status: "confirmed", gasUsed: vmGasUsed };
}

export interface BlockApplyResult {
  state: GlobalState;
  confirmedTxIds: string[];
  failedTxIds: string[];
  totalBurned: number;
}

/**
 * applyBlock — applies an entire block to the global state.
 *
 * Pure: no I/O. Returns a new GlobalState with updated stateRoot.
 * The stateRoot in the returned state can be compared against
 * block.stateRoot for validity.
 */
export function applyBlock(
  state: GlobalState,
  block: Block,
  gas: GasSystem
): BlockApplyResult {
  let current = state;
  const confirmedTxIds: string[] = [];
  const failedTxIds: string[] = [];
  let blockBurned = 0;

  for (const tx of block.transactions) {
    const result = applyTransaction(
      current,
      tx,
      block.height,
      block.timestamp,
      gas
    );
    current = result.state;

    if (result.status === "confirmed") {
      confirmedTxIds.push(tx.id);
      blockBurned += gas.calculateBurn(tx.fee);
    } else {
      failedTxIds.push(tx.id);
    }
  }

  return {
    state: current,
    confirmedTxIds,
    failedTxIds,
    totalBurned: blockBurned,
  };
}

/**
 * replayStateFromChain — rebuild GlobalState from scratch by replaying
 * all blocks in order. Used for chain validation and reorg handling.
 * No database access — input is the raw chain array.
 */
export function replayStateFromChain(
  blocks: Block[],
  gas: GasSystem
): GlobalState {
  let state = emptyGlobalState();

  for (const block of blocks) {
    const result = applyBlock(state, block, gas);
    state = result.state;
  }

  return state;
}
