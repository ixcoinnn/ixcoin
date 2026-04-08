const BASE = "/api/ixcoin";

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

export interface ChainInfo {
  chainName: string;
  ticker: string;
  network: string;
  height: number;
  difficulty: number;
  totalMinted: number;
  totalBurned: number;
  circulating: number;
  maxSupply: number;
  premineAmount: number;
  miningSupply: number;
  mempoolSize: number;
  blockReward: number;
  baseFee: number;
  halvingProgress: string;
  nextHalvingBlock: number;
}

export interface BlockRow {
  height: number;
  hash: string;
  previous_hash: string;
  timestamp: number;
  miner: string;
  block_reward: string;
  total_fees: string;
  tx_count: number;
  difficulty: number;
}

export interface TxRow {
  id: string;
  block_height: number;
  from_addr: string;
  to_addr: string;
  amount: string;
  fee: string;
  status: string;
  timestamp: number;
}

export interface GenesisWallet {
  address: string;
  balance: number;
  publicKey: string;
  network: string;
  ticker: string;
}

export interface Stats extends ChainInfo {
  totalTransactions: number;
  recentBlocks: BlockRow[];
  recentTransactions: TxRow[];
}

export interface MineResult {
  success: boolean;
  block: {
    height: number;
    hash: string;
    nonce: number;
    difficulty: number;
    txCount: number;
    reward: number;
    fees: number;
    timestamp: number;
  };
  newBalance: number;
}

export interface WalletResult {
  address: string;
  publicKey: string;
  privateKey: string;
  mnemonic: string;
  network: string;
  warning: string;
}

export interface AddressInfo {
  address: string;
  balance: number;
  pendingOutflow: number;
  available: number;
  nonce: number;
  txCount: number;
  transactions: TxRow[];
}

export interface RWAToken {
  address: string;
  name: string;
  symbol: string;
  assetType: string;
  description: string;
  location: string;
  totalSupply: number;
  issuer: string;
  valueIdc: number;
  status: string;
  createdAt: number;
}

export interface RWATokenDetail extends RWAToken {
  documentHash: string;
  metadata: Record<string, unknown>;
  mintTx: string | null;
  recentTransfers: RWATransfer[];
  holders: { address: string; amount: number }[];
}

export interface RWATransfer {
  id: string;
  from: string;
  to: string;
  amount: number;
  txId: string | null;
  memo: string;
  createdAt: number;
}

export interface RWAHolding {
  tokenAddress: string;
  amount: number;
  name: string;
  symbol: string;
  assetType: string;
  valueIdc: number;
  status: string;
}

export interface TokenizeResult {
  success: boolean;
  tokenAddress: string;
  symbol: string;
  totalSupply: number;
  mintTxId: string;
  message: string;
}

export interface TransferRWAResult {
  success: boolean;
  transferId: string;
  txId: string;
  from: string;
  to: string;
  amount: number;
  symbol: string;
  message: string;
}

export interface ContractSummary {
  address: string;
  deployer: string;
  name: string;
  description: string;
  callCount: number;
  createdAt: number;
  blockHeight: number | null;
}

export interface ContractDetail extends ContractSummary {
  code: string;
  state: Record<string, unknown>;
  deployTx: string | null;
  recentCalls: ContractCall[];
}

export interface ContractCall {
  id: string;
  caller: string;
  callCode: string;
  result: unknown;
  logs: string[];
  gasUsed: number;
  success: boolean;
  txId: string | null;
  amount: number;
  createdAt: number;
}

export interface DeployResult {
  success: boolean;
  contractAddress: string;
  deployTxId: string;
  gasUsed: number;
  initialState: Record<string, unknown>;
  logs: string[];
  message: string;
}

export interface CallResult {
  success: boolean;
  callId: string;
  result: unknown;
  logs: string[];
  gasUsed: number;
  error?: string;
  txId?: string;
  newState: Record<string, unknown>;
}

export const api = {
  getInfo: () => apiFetch<ChainInfo>("/info"),
  getStats: () => apiFetch<Stats>("/stats"),
  getGenesisWallet: () => apiFetch<GenesisWallet>("/genesis-wallet"),
  getChain: (limit = 20) => apiFetch<{ blocks: BlockRow[]; total: number }>(`/chain?limit=${limit}`),
  getBlock: (id: string | number) => apiFetch<object>(`/block/${id}`),
  getTx: (id: string) => apiFetch<object>(`/tx/${id}`),
  getAddress: (addr: string) => apiFetch<AddressInfo>(`/address/${addr}`),
  getBalance: (addr: string) => apiFetch<{ address: string; balance: number; ticker: string }>(`/balance/${addr}`),
  getMempool: () => apiFetch<{ count: number; transactions: TxRow[]; totalFees: number }>(`/mempool`),
  getGasEstimate: () => apiFetch<{ gasPrice: number; gasUsed: number; fee: number; baseFee: number }>(`/gas/estimate`),
  search: (q: string) => apiFetch<{ type: string; data: object }>(`/search/${q}`),
  mine: (address: string) => apiFetch<MineResult>("/mine", {
    method: "POST",
    body: JSON.stringify({ address }),
  }),
  newWallet: () => apiFetch<WalletResult>("/wallet/new", { method: "POST" }),
  restoreWallet: (mnemonic: string) => apiFetch<{ address: string; publicKey: string; privateKey: string; mnemonic: string; balance: number; nonce: number; warning: string }>("/wallet/restore", {
    method: "POST",
    body: JSON.stringify({ mnemonic }),
  }),
  /**
   * @deprecated — sends private key to server. Use sendSigned() instead.
   * Kept only for internal compatibility during transition.
   */
  send: (params: {
    from: string;
    to: string;
    amount: number;
    privateKeyHex: string;
    nonce?: number;
  }) => apiFetch<{ success: boolean; txId: string; fee: number }>("/send", {
    method: "POST",
    body: JSON.stringify(params),
  }),

  /**
   * SECURE: Broadcasts a pre-signed transaction to the network.
   * The private key never leaves the browser — this sends only the signed payload.
   * Use signTransaction() from lib/signer.ts to create the SignedTx object.
   */
  sendSigned: (signedTx: {
    id: string;
    from: string;
    to: string;
    amount: number;
    fee: number;
    nonce: number;
    timestamp: number;
    gasPrice?: number;
    signature: string;
    publicKey: string;
    contract?: string | null;
  }) => apiFetch<{ success: boolean; txId: string; fee: number; nonce: number }>("/send", {
    method: "POST",
    body: JSON.stringify(signedTx),
  }),
  getPeers: () => apiFetch<{ peers: string[]; connected: number }>("/p2p/peers"),
  connectPeer: (peerUrl: string) => apiFetch<{ success: boolean; message: string; totalPeers: number }>("/p2p/connect", {
    method: "POST",
    body: JSON.stringify({ peerUrl }),
  }),
  getRWATokens: (limit = 30, assetType?: string) =>
    apiFetch<{ tokens: RWAToken[]; total: number }>(`/rwa/tokens?limit=${limit}${assetType ? `&assetType=${assetType}` : ""}`),
  getRWAToken: (address: string) =>
    apiFetch<RWATokenDetail>(`/rwa/token/${address}`),
  getRWAHoldings: (address: string) =>
    apiFetch<{ address: string; holdings: RWAHolding[] }>(`/rwa/holdings/${address}`),
  tokenizeRWA: (params: {
    issuerAddress: string;
    privateKeyHex: string;
    name: string;
    symbol: string;
    assetType: string;
    description?: string;
    location?: string;
    totalSupply?: number;
    valueIdc?: number;
    documentHash?: string;
    metadata?: Record<string, unknown>;
  }) => apiFetch<TokenizeResult>("/rwa/tokenize", {
    method: "POST",
    body: JSON.stringify(params),
  }),
  transferRWA: (params: {
    tokenAddress: string;
    fromAddress: string;
    toAddress: string;
    privateKeyHex: string;
    amount: number;
    memo?: string;
  }) => apiFetch<TransferRWAResult>("/rwa/transfer", {
    method: "POST",
    body: JSON.stringify(params),
  }),
  getContracts: (limit = 20) =>
    apiFetch<{ contracts: ContractSummary[]; total: number }>(`/contracts?limit=${limit}`),
  getContract: (address: string) =>
    apiFetch<ContractDetail>(`/contract/${address}`),
  getContractCalls: (address: string, limit = 20) =>
    apiFetch<{ calls: ContractCall[] }>(`/contract/${address}/calls?limit=${limit}`),
  deployContract: (params: {
    deployerAddress: string;
    privateKeyHex: string;
    name: string;
    description: string;
    code: string;
    initialState?: Record<string, unknown>;
  }) => apiFetch<DeployResult>("/contract/deploy", {
    method: "POST",
    body: JSON.stringify(params),
  }),
  callContract: (params: {
    contractAddress: string;
    callerAddress: string;
    privateKeyHex: string;
    callCode: string;
    amount?: number;
  }) => apiFetch<CallResult>("/contract/call", {
    method: "POST",
    body: JSON.stringify(params),
  }),
};
