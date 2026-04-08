import { pool } from "@workspace/db";

export interface VMContext {
  caller: string;
  origin: string;
  contractAddress: string;
  value: number;
  blockHeight: number;
  timestamp: number;
  gasLimit: number;
}

export interface VMEvent {
  name: string;
  args: unknown[];
  timestamp: number;
}

export interface VMResult {
  success: boolean;
  gasUsed: number;
  returnValue: unknown;
  error?: string;
  logs: string[];
  events: VMEvent[];
  stateChanges: Record<string, unknown>;
}

export interface ContractRecord {
  address: string;
  deployer: string;
  name: string;
  description: string;
  code: string;
  abi: ContractABI[];
  state: Record<string, unknown>;
  balance: number;
  txHash: string;
  blockHeight: number;
  createdAt: number;
  callCount: number;
  verified: boolean;
  contractType: "generic" | "token" | "nft" | "defi" | "bridge" | "metaid";
}

export interface ContractABI {
  name: string;
  inputs: { name: string; type: string }[];
  outputs: { name: string; type: string }[];
  stateMutability: "pure" | "view" | "nonpayable" | "payable";
}

export class TuringVM {
  private gasUsed: number = 0;
  private logs: string[] = [];
  private events: VMEvent[] = [];
  private stateChanges: Record<string, unknown> = {};

  // Standard library available in all contracts
  private buildStdlib(state: Record<string, unknown>, ctx: VMContext): Record<string, unknown> {
    const emit = (name: string, ...args: unknown[]) => {
      this.events.push({ name, args, timestamp: ctx.timestamp });
      this.gasUsed += 50;
    };

    const requireCond = (cond: boolean, msg: string) => {
      if (!cond) throw new Error(`Require failed: ${msg}`);
      this.gasUsed += 3;
    };

    const log = (msg: string) => {
      this.logs.push(`[${ctx.contractAddress}] ${msg}`);
      this.gasUsed += 10;
    };

    // Storage ops with gas
    const sstore = (key: string, value: unknown) => {
      state[key] = value;
      this.stateChanges[key] = value;
      this.gasUsed += 200;
    };

    const sload = (key: string, defaultVal: unknown = null): unknown => {
      this.gasUsed += 50;
      return state[key] ?? defaultVal;
    };

    // Math helpers
    const safeAdd = (a: number, b: number): number => {
      const r = a + b;
      if (r < a) throw new Error("SafeAdd overflow");
      return r;
    };

    const safeSub = (a: number, b: number): number => {
      if (b > a) throw new Error("SafeSub underflow");
      return a - b;
    };

    const safeMul = (a: number, b: number): number => a * b;
    const safeDiv = (a: number, b: number): number => {
      if (b === 0) throw new Error("Division by zero");
      return Math.floor(a / b);
    };

    // Map helpers
    const mapGet = (mapKey: string, key: string, def: unknown = 0): unknown => {
      this.gasUsed += 50;
      const map = (state[mapKey] ?? {}) as Record<string, unknown>;
      return map[key] ?? def;
    };

    const mapSet = (mapKey: string, key: string, value: unknown): void => {
      this.gasUsed += 200;
      if (!state[mapKey]) state[mapKey] = {};
      const map = state[mapKey] as Record<string, unknown>;
      map[key] = value;
      state[mapKey] = map;
      this.stateChanges[mapKey] = map;
    };

    const mapDel = (mapKey: string, key: string): void => {
      this.gasUsed += 100;
      if (!state[mapKey]) return;
      const map = state[mapKey] as Record<string, unknown>;
      delete map[key];
      state[mapKey] = map;
      this.stateChanges[mapKey] = map;
    };

    const mapKeys = (mapKey: string): string[] => {
      this.gasUsed += 100;
      return Object.keys((state[mapKey] ?? {}) as Record<string, unknown>);
    };

    // Array helpers
    const arrPush = (arrKey: string, value: unknown): void => {
      this.gasUsed += 100;
      if (!Array.isArray(state[arrKey])) state[arrKey] = [];
      (state[arrKey] as unknown[]).push(value);
      this.stateChanges[arrKey] = state[arrKey];
    };

    const arrGet = (arrKey: string): unknown[] => {
      this.gasUsed += 50;
      return (state[arrKey] as unknown[]) ?? [];
    };

    const arrLength = (arrKey: string): number => {
      this.gasUsed += 20;
      return ((state[arrKey] as unknown[]) ?? []).length;
    };

    return {
      // Context
      caller: ctx.caller,
      origin: ctx.origin,
      self: ctx.contractAddress,
      value: ctx.value,
      block: { height: ctx.blockHeight, timestamp: ctx.timestamp },

      // Core ops
      require: requireCond,
      emit,
      log,
      revert: (msg: string) => { throw new Error(msg); },

      // Storage
      sstore,
      sload,
      get: sload,
      set: sstore,

      // Maps & arrays
      mapGet,
      mapSet,
      mapDel,
      mapKeys,
      arrPush,
      arrGet,
      arrLength,

      // Math
      safeAdd,
      safeSub,
      safeMul,
      safeDiv,
      min: Math.min,
      max: Math.max,
      sqrt: Math.sqrt,
      abs: Math.abs,
      floor: Math.floor,
      ceil: Math.ceil,

      // Utilities
      now: ctx.timestamp,
      timestamp: ctx.timestamp,
      parseInt: (s: string, radix?: number) => parseInt(s, radix),
      parseFloat: (s: string) => parseFloat(s),
      String: String,
      Number: Number,
      Boolean: Boolean,
      JSON: { stringify: JSON.stringify, parse: JSON.parse },

      // Gas
      gas: () => ctx.gasLimit - this.gasUsed,
      gasUsed: () => this.gasUsed,
      useGas: (amount: number) => { this.gasUsed += amount; },
    };
  }

  execute(code: string, method: string, args: unknown[], state: Record<string, unknown>, ctx: VMContext): VMResult {
    this.gasUsed = 0;
    this.logs = [];
    this.events = [];
    this.stateChanges = {};

    const stateCopy = JSON.parse(JSON.stringify(state));

    try {
      const stdlib = this.buildStdlib(stateCopy, ctx);

      // Build function with all stdlib injected
      const paramNames = Object.keys(stdlib);
      const paramValues = Object.values(stdlib);

      // Wrap user code in a module pattern — exposes contract functions
      const wrappedCode = `
        "use strict";
        ${code}

        // Execute the requested method
        if (typeof ${method} !== 'function') {
          throw new Error('Method "${method}" not found in contract');
        }
        return ${method}(...__args__);
      `;

      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const fn = new Function(...paramNames, "__args__", wrappedCode);
      const returnValue = fn(...paramValues, args);

      if (this.gasUsed > ctx.gasLimit) {
        throw new Error(`Out of gas: used ${this.gasUsed}, limit ${ctx.gasLimit}`);
      }

      // Apply state changes
      for (const [k, v] of Object.entries(this.stateChanges)) {
        state[k] = v;
      }

      return {
        success: true,
        gasUsed: this.gasUsed,
        returnValue,
        logs: this.logs,
        events: this.events,
        stateChanges: this.stateChanges,
      };
    } catch (err) {
      return {
        success: false,
        gasUsed: this.gasUsed,
        returnValue: null,
        error: err instanceof Error ? err.message : String(err),
        logs: this.logs,
        events: this.events,
        stateChanges: {},
      };
    }
  }
}

// Contract storage in DB
export class ContractStorage {
  async ensureTables(): Promise<void> {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ix_contracts_v2 (
        address TEXT PRIMARY KEY,
        deployer TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        code TEXT NOT NULL,
        abi JSONB NOT NULL DEFAULT '[]',
        state JSONB NOT NULL DEFAULT '{}',
        balance NUMERIC NOT NULL DEFAULT 0,
        tx_hash TEXT NOT NULL,
        block_height INTEGER NOT NULL DEFAULT 0,
        created_at BIGINT NOT NULL,
        call_count INTEGER NOT NULL DEFAULT 0,
        verified BOOLEAN NOT NULL DEFAULT false,
        contract_type TEXT NOT NULL DEFAULT 'generic'
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ix_contract_calls (
        id TEXT PRIMARY KEY,
        contract_address TEXT NOT NULL,
        caller TEXT NOT NULL,
        method TEXT NOT NULL,
        args JSONB NOT NULL DEFAULT '[]',
        result JSONB,
        gas_used INTEGER NOT NULL DEFAULT 0,
        success BOOLEAN NOT NULL DEFAULT true,
        error TEXT,
        events JSONB NOT NULL DEFAULT '[]',
        tx_hash TEXT,
        block_height INTEGER,
        timestamp BIGINT NOT NULL
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS ix_contracts_deployer ON ix_contracts_v2(deployer)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS ix_contract_calls_contract ON ix_contract_calls(contract_address)`);
  }

  async saveContract(contract: ContractRecord): Promise<void> {
    await pool.query(
      `INSERT INTO ix_contracts_v2 (address, deployer, name, description, code, abi, state, balance, tx_hash, block_height, created_at, contract_type)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (address) DO UPDATE SET state=$7, balance=$8, call_count=ix_contracts_v2.call_count+1`,
      [
        contract.address, contract.deployer, contract.name, contract.description,
        contract.code, JSON.stringify(contract.abi), JSON.stringify(contract.state),
        contract.balance, contract.txHash, contract.blockHeight, contract.createdAt,
        contract.contractType,
      ]
    );
  }

  async updateContractState(address: string, state: Record<string, unknown>): Promise<void> {
    await pool.query(
      `UPDATE ix_contracts_v2 SET state=$2, call_count=call_count+1 WHERE address=$1`,
      [address, JSON.stringify(state)]
    );
  }

  async getContract(address: string): Promise<ContractRecord | null> {
    const res = await pool.query(`SELECT * FROM ix_contracts_v2 WHERE address=$1`, [address]);
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      address: r.address,
      deployer: r.deployer,
      name: r.name,
      description: r.description,
      code: r.code,
      abi: r.abi as ContractABI[],
      state: r.state as Record<string, unknown>,
      balance: Number(r.balance),
      txHash: r.tx_hash,
      blockHeight: r.block_height,
      createdAt: Number(r.created_at),
      callCount: r.call_count,
      verified: r.verified,
      contractType: r.contract_type,
    };
  }

  async listContracts(type?: string, limit = 20): Promise<object[]> {
    const where = type ? `WHERE contract_type = $2` : "";
    const params = type ? [limit, type] : [limit];
    const res = await pool.query(
      `SELECT address, deployer, name, description, contract_type, balance, call_count, created_at, verified
       FROM ix_contracts_v2 ${where} ORDER BY created_at DESC LIMIT $1`,
      params
    );
    return res.rows;
  }

  async saveCallRecord(record: {
    id: string; contractAddress: string; caller: string; method: string;
    args: unknown[]; result: unknown; gasUsed: number; success: boolean;
    error?: string; events: VMEvent[]; txHash?: string; blockHeight?: number; timestamp: number;
  }): Promise<void> {
    await pool.query(
      `INSERT INTO ix_contract_calls (id, contract_address, caller, method, args, result, gas_used, success, error, events, tx_hash, block_height, timestamp)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        record.id, record.contractAddress, record.caller, record.method,
        JSON.stringify(record.args), JSON.stringify(record.result), record.gasUsed,
        record.success, record.error ?? null, JSON.stringify(record.events),
        record.txHash ?? null, record.blockHeight ?? null, record.timestamp,
      ]
    );
  }

  async getCallHistory(contractAddress: string, limit = 20): Promise<object[]> {
    const res = await pool.query(
      `SELECT * FROM ix_contract_calls WHERE contract_address=$1 ORDER BY timestamp DESC LIMIT $2`,
      [contractAddress, limit]
    );
    return res.rows;
  }
}

export const contractStorage = new ContractStorage();
export const turingVM = new TuringVM();

// Standard contract templates
export const CONTRACT_TEMPLATES = {
  fungible_token: `
// ERC-20 like Fungible Token
function initialize(name, symbol, totalSupply) {
  require(!sload('initialized'), 'Already initialized');
  sstore('name', name);
  sstore('symbol', symbol);
  sstore('totalSupply', totalSupply);
  mapSet('balances', caller, totalSupply);
  sstore('initialized', true);
  emit('Transfer', '0x0', caller, totalSupply);
}

function transfer(to, amount) {
  const fromBal = Number(mapGet('balances', caller, 0));
  require(fromBal >= amount, 'Insufficient balance');
  require(amount > 0, 'Amount must be positive');
  mapSet('balances', caller, safeSub(fromBal, amount));
  mapSet('balances', to, safeAdd(Number(mapGet('balances', to, 0)), amount));
  emit('Transfer', caller, to, amount);
  return true;
}

function approve(spender, amount) {
  mapSet('allowances', caller + ':' + spender, amount);
  emit('Approval', caller, spender, amount);
  return true;
}

function transferFrom(from, to, amount) {
  const allowed = Number(mapGet('allowances', from + ':' + caller, 0));
  require(allowed >= amount, 'Allowance exceeded');
  const fromBal = Number(mapGet('balances', from, 0));
  require(fromBal >= amount, 'Insufficient balance');
  mapSet('allowances', from + ':' + caller, safeSub(allowed, amount));
  mapSet('balances', from, safeSub(fromBal, amount));
  mapSet('balances', to, safeAdd(Number(mapGet('balances', to, 0)), amount));
  emit('Transfer', from, to, amount);
  return true;
}

function balanceOf(addr) {
  return Number(mapGet('balances', addr, 0));
}

function allowance(owner, spender) {
  return Number(mapGet('allowances', owner + ':' + spender, 0));
}

function totalSupply() {
  return Number(sload('totalSupply', 0));
}

function name() { return sload('name', ''); }
function symbol() { return sload('symbol', ''); }
`,

  nft_collection: `
// ERC-721 like NFT Collection
function initialize(name, symbol, baseURI) {
  require(!sload('initialized'), 'Already initialized');
  sstore('name', name);
  sstore('symbol', symbol);
  sstore('baseURI', baseURI);
  sstore('totalSupply', 0);
  sstore('initialized', true);
}

function mint(to, tokenURI, metadata) {
  const supply = Number(sload('totalSupply', 0));
  const tokenId = supply + 1;
  mapSet('owners', String(tokenId), to);
  mapSet('tokenURIs', String(tokenId), tokenURI);
  mapSet('tokenMetadata', String(tokenId), JSON.stringify(metadata || {}));
  mapSet('balances', to, Number(mapGet('balances', to, 0)) + 1);
  sstore('totalSupply', tokenId);
  arrPush('allTokenIds', tokenId);
  emit('Mint', to, tokenId, tokenURI);
  return tokenId;
}

function transfer(from, to, tokenId) {
  require(mapGet('owners', String(tokenId)) === from, 'Not owner');
  const approved = mapGet('approved', String(tokenId));
  require(from === caller || approved === caller || mapGet('operators', from + ':' + caller), 'Not authorized');
  mapSet('owners', String(tokenId), to);
  mapDel('approved', String(tokenId));
  mapSet('balances', from, safeSub(Number(mapGet('balances', from, 0)), 1));
  mapSet('balances', to, safeAdd(Number(mapGet('balances', to, 0)), 1));
  emit('Transfer', from, to, tokenId);
}

function approve(spender, tokenId) {
  require(mapGet('owners', String(tokenId)) === caller, 'Not owner');
  mapSet('approved', String(tokenId), spender);
  emit('Approval', caller, spender, tokenId);
}

function ownerOf(tokenId) {
  return mapGet('owners', String(tokenId), null);
}

function tokenURI(tokenId) {
  return mapGet('tokenURIs', String(tokenId), '');
}

function balanceOf(addr) {
  return Number(mapGet('balances', addr, 0));
}

function totalSupply() {
  return Number(sload('totalSupply', 0));
}
`,
};
