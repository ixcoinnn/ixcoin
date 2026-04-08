import { logger } from "../lib/logger.js";

export interface VMContext {
  from: string;
  to: string;
  amount: number;
  timestamp: number;
  blockHeight: number;
}

export interface VMResult {
  success: boolean;
  gasUsed: number;
  result: unknown;
  error?: string;
  logs: string[];
}

const FORBIDDEN_KEYWORDS = [
  "process",
  "require",
  "import",
  "__dirname",
  "__filename",
  "module",
  "exports",
  "global",
  "Buffer",
  "fetch",
  "XMLHttpRequest",
  "eval",
  "Function",
  "setTimeout",
  "setInterval",
  "setImmediate",
  "clearTimeout",
  "clearInterval",
  "fs",
  "net",
  "http",
  "https",
  "child_process",
  "os",
  "crypto",
  "path",
];

export class MiniVM {
  private state: Record<string, unknown>;
  private gasLimit: number;
  private gasUsed: number = 0;
  private logs: string[] = [];
  private readonly MAX_LOGS = 100;
  private readonly MAX_STATE_KEYS = 500;
  private readonly VM_TIMEOUT_MS = 5_000;

  constructor(state: Record<string, unknown>, gasLimit: number = 1_000_000) {
    this.state = JSON.parse(JSON.stringify(state));
    this.gasLimit = gasLimit;
  }

  private sanitizeCode(code: string): { ok: boolean; error?: string } {
    if (code.length > 100_000) return { ok: false, error: "Kode kontrak terlalu besar (maks 100KB)" };

    for (const keyword of FORBIDDEN_KEYWORDS) {
      const regex = new RegExp(`\\b${keyword}\\b`);
      if (regex.test(code)) {
        return { ok: false, error: `Keyword dilarang dalam kontrak: '${keyword}'` };
      }
    }

    return { ok: true };
  }

  run(code: string, context: VMContext): VMResult {
    const sanitizeCheck = this.sanitizeCode(code);
    if (!sanitizeCheck.ok) {
      return { success: false, gasUsed: 0, result: null, error: sanitizeCheck.error, logs: [] };
    }

    this.gasUsed = 0;
    this.logs = [];

    const startTime = Date.now();

    const checkGasAndTime = () => {
      if (Date.now() - startTime > this.VM_TIMEOUT_MS) {
        throw new Error(`VM timeout: eksekusi melebihi ${this.VM_TIMEOUT_MS}ms`);
      }
      if (this.gasUsed > this.gasLimit) {
        throw new Error(`Out of gas: used ${this.gasUsed}, limit ${this.gasLimit}`);
      }
    };

    try {
      const stateCopy = JSON.parse(JSON.stringify(this.state));

      const sandbox = {
        state: stateCopy,
        context: {
          from: context.from,
          to: context.to,
          amount: Number(context.amount),
          timestamp: Number(context.timestamp),
          blockHeight: Number(context.blockHeight),
        },
        log: (msg: string) => {
          if (this.logs.length < this.MAX_LOGS) {
            this.logs.push(String(msg).slice(0, 500));
          }
          this.gasUsed += 10;
          checkGasAndTime();
        },
        require: (condition: boolean, msg: string) => {
          if (!condition) throw new Error(`Require failed: ${String(msg).slice(0, 200)}`);
          this.gasUsed += 5;
          checkGasAndTime();
        },
        transfer: (from: string, to: string, amount: number) => {
          this.gasUsed += 100;
          checkGasAndTime();
          if (!stateCopy["balances"]) stateCopy["balances"] = {};
          const balances = stateCopy["balances"] as Record<string, number>;
          if ((balances[from] ?? 0) < amount) throw new Error("Insufficient balance in contract");
          balances[from] = (balances[from] ?? 0) - amount;
          balances[to] = (balances[to] ?? 0) + amount;
        },
        safeAdd: (a: number, b: number): number => {
          const r = Number(a) + Number(b);
          if (!isFinite(r)) throw new Error("Overflow detected");
          return r;
        },
        safeSub: (a: number, b: number): number => {
          if (Number(b) > Number(a)) throw new Error("Underflow detected");
          return Number(a) - Number(b);
        },
        safeMul: (a: number, b: number): number => {
          const r = Number(a) * Number(b);
          if (!isFinite(r)) throw new Error("Overflow in multiply");
          return r;
        },
        safeDiv: (a: number, b: number): number => {
          if (Number(b) === 0) throw new Error("Division by zero");
          return Math.floor(Number(a) / Number(b));
        },
        min: Math.min,
        max: Math.max,
        abs: Math.abs,
        floor: Math.floor,
        ceil: Math.ceil,
        parseInt: (s: string, radix?: number) => parseInt(s, radix),
        parseFloat: (s: string) => parseFloat(s),
        String: String,
        Number: Number,
        Boolean: Boolean,
        JSON: { stringify: JSON.stringify, parse: JSON.parse },
      };

      const fn = new Function(
        "state",
        "context",
        "log",
        "require",
        "transfer",
        "safeAdd",
        "safeSub",
        "safeMul",
        "safeDiv",
        "min",
        "max",
        "abs",
        "floor",
        "ceil",
        "parseInt",
        "parseFloat",
        "String",
        "Number",
        "Boolean",
        "JSON",
        `"use strict"; ${code}`
      );

      const result = fn(
        sandbox.state,
        sandbox.context,
        sandbox.log,
        sandbox.require,
        sandbox.transfer,
        sandbox.safeAdd,
        sandbox.safeSub,
        sandbox.safeMul,
        sandbox.safeDiv,
        sandbox.min,
        sandbox.max,
        sandbox.abs,
        sandbox.floor,
        sandbox.ceil,
        sandbox.parseInt,
        sandbox.parseFloat,
        sandbox.String,
        sandbox.Number,
        sandbox.Boolean,
        sandbox.JSON
      );

      if (Date.now() - startTime > this.VM_TIMEOUT_MS) {
        throw new Error("VM timeout terdeteksi setelah eksekusi");
      }

      const stateKeys = Object.keys(stateCopy).length;
      if (stateKeys > this.MAX_STATE_KEYS) {
        throw new Error(`State terlalu besar: ${stateKeys} keys (maks ${this.MAX_STATE_KEYS})`);
      }

      this.state = stateCopy;

      logger.debug({ gasUsed: this.gasUsed, elapsed: Date.now() - startTime }, "VM execution complete");

      return { success: true, gasUsed: this.gasUsed, result, logs: this.logs };
    } catch (err) {
      return {
        success: false,
        gasUsed: this.gasUsed,
        result: null,
        error: err instanceof Error ? err.message.slice(0, 500) : String(err),
        logs: this.logs,
      };
    }
  }

  getState(): Record<string, unknown> {
    return JSON.parse(JSON.stringify(this.state));
  }
}
