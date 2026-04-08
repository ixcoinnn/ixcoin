import { sha256 } from "./crypto.js";
import { computeMerkleRoot } from "./merkle.js";

export interface UTXOEntry {
  txId: string;
  vout: number;
  address: string;
  amount: number;
  scriptPubKey: string;
  blockHeight: number;
  coinbase: boolean;
  spent: boolean;
  spentTxId?: string;
}

export interface AccountEntry {
  address: string;
  gasBalance: number;
  nonce: number;
}

export interface ContractStorageEntry {
  address: string;
  deployer: string;
  code: string;
  state: Record<string, unknown>;
  balance: number;
  callCount: number;
}

/**
 * GlobalState — the single source of truth for all blockchain state.
 *
 * All fields are plain data (no methods that mutate). Any transition
 * must go through applyBlock() / applyTransaction() in state-machine.ts.
 *
 * Layout:
 *  - utxos: UTXO set for smart contract outputs (contract UTXO model)
 *  - accounts: account-model balances used for gas tracking
 *  - contractStorage: per-contract key-value stores
 *  - stateRoot: deterministic Merkle root of the entire state snapshot
 */
export interface GlobalState {
  readonly utxos: Readonly<Record<string, UTXOEntry>>;
  readonly accounts: Readonly<Record<string, AccountEntry>>;
  readonly contractStorage: Readonly<Record<string, ContractStorageEntry>>;
  readonly balances: Readonly<Record<string, number>>;
  readonly nonces: Readonly<Record<string, number>>;
  readonly totalMinted: number;
  readonly totalBurned: number;
  readonly stateRoot: string;
}

export function emptyGlobalState(): GlobalState {
  const s: Omit<GlobalState, "stateRoot"> = {
    utxos: {},
    accounts: {},
    contractStorage: {},
    balances: {},
    nonces: {},
    totalMinted: 0,
    totalBurned: 0,
  };
  return { ...s, stateRoot: computeStateRoot(s) };
}

/**
 * Compute a deterministic stateRoot from all state components.
 * Same input → same hash. No external dependencies.
 */
export function computeStateRoot(
  state: Omit<GlobalState, "stateRoot">
): string {
  const parts = [
    sha256(JSON.stringify(sortedObject(state.balances))),
    sha256(JSON.stringify(sortedObject(state.nonces))),
    sha256(JSON.stringify(state.totalMinted.toString())),
    sha256(JSON.stringify(state.totalBurned.toString())),
    computeMerkleRoot(Object.values(state.utxos).sort((a, b) =>
      a.txId.localeCompare(b.txId) || a.vout - b.vout
    )),
    computeMerkleRoot(Object.values(state.accounts).sort((a, b) =>
      a.address.localeCompare(b.address)
    )),
    computeMerkleRoot(
      Object.values(state.contractStorage).sort((a, b) =>
        a.address.localeCompare(b.address)
      ).map((c) => ({ address: c.address, state: c.state, balance: c.balance }))
    ),
  ];

  return computeMerkleRoot(parts.map((p) => ({ hash: p })));
}

function sortedObject<T>(obj: Record<string, T>): Record<string, T> {
  const sorted: Record<string, T> = {};
  for (const k of Object.keys(obj).sort()) sorted[k] = obj[k];
  return sorted;
}

/**
 * Produce a new GlobalState by applying a pure updater function.
 * The stateRoot is always recomputed — no hidden mutation possible.
 */
export function withState(
  current: GlobalState,
  updater: (draft: {
    utxos: Record<string, UTXOEntry>;
    accounts: Record<string, AccountEntry>;
    contractStorage: Record<string, ContractStorageEntry>;
    balances: Record<string, number>;
    nonces: Record<string, number>;
    totalMinted: number;
    totalBurned: number;
  }) => void
): GlobalState {
  const draft = {
    utxos: { ...current.utxos },
    accounts: { ...current.accounts },
    contractStorage: { ...current.contractStorage },
    balances: { ...current.balances },
    nonces: { ...current.nonces },
    totalMinted: current.totalMinted,
    totalBurned: current.totalBurned,
  };

  updater(draft);

  const next: Omit<GlobalState, "stateRoot"> = {
    utxos: Object.freeze({ ...draft.utxos }),
    accounts: Object.freeze({ ...draft.accounts }),
    contractStorage: Object.freeze({ ...draft.contractStorage }),
    balances: Object.freeze({ ...draft.balances }),
    nonces: Object.freeze({ ...draft.nonces }),
    totalMinted: draft.totalMinted,
    totalBurned: draft.totalBurned,
  };

  return Object.freeze({
    ...next,
    stateRoot: computeStateRoot(next),
  }) as GlobalState;
}
