/**
 * IXCOIN Security Tests
 * Run with: pnpm --filter @workspace/api-server exec ts-node --esm src/tests/security.test.ts
 */

import assert from "assert";
import { Transaction } from "../blockchain/transaction.js";
import { MiniVM } from "../blockchain/vm.js";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    → ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

// ─── Transaction Validation ───────────────────────────────────────────────

console.log("\nTransaction Validation:");

test("SYSTEM transactions are always valid", () => {
  const tx = Transaction.fromSystem("IXTEST123456789012345", 100);
  assert.strictEqual(tx.isValid(), true);
});

test("Rejects zero amount transactions", () => {
  const tx = new Transaction({ from: "IXA", to: "IXB", amount: 0 });
  const errors = tx.validationErrors();
  assert(errors.some((e) => e.includes("positif")));
});

test("Rejects negative amount transactions", () => {
  const tx = new Transaction({ from: "IXA", to: "IXB", amount: -100 });
  assert.strictEqual(tx.isValid(), false);
});

test("Rejects self-transfer", () => {
  const tx = new Transaction({ from: "IXSameAddress12345678", to: "IXSameAddress12345678", amount: 100 });
  assert.strictEqual(tx.isValid(), false);
});

test("Rejects excessive fee", () => {
  const tx = new Transaction({ from: "IXA", to: "IXB", amount: 100, fee: 99999 });
  const errors = tx.validationErrors();
  assert(errors.some((e) => e.includes("Fee terlalu tinggi")));
});

test("Rejects amount exceeding max supply", () => {
  const tx = new Transaction({ from: "IXA", to: "IXB", amount: 100_000_000 });
  const errors = tx.validationErrors();
  assert(errors.some((e) => e.includes("max supply")));
});

test("Unsigned transaction is invalid", () => {
  const tx = new Transaction({ from: "IXA12345678901234567890", to: "IXB12345678901234567890", amount: 100 });
  tx.signature = undefined;
  assert.strictEqual(tx.isValid(), false);
});

// ─── VM Security Tests ────────────────────────────────────────────────────

console.log("\nVM Security Tests:");

const ctx = {
  from: "IXCaller123",
  to: "IXContract123",
  amount: 0,
  timestamp: Date.now(),
  blockHeight: 1,
};

test("Blocks access to 'process' keyword", () => {
  const vm = new MiniVM({}, 100_000);
  const result = vm.run(`log(process.env.SECRET)`, ctx);
  assert.strictEqual(result.success, false);
  assert(result.error?.includes("process"));
});

test("Blocks access to 'require'", () => {
  const vm = new MiniVM({}, 100_000);
  const result = vm.run(`const fs = require('fs'); log(fs.readFileSync('/etc/passwd'))`, ctx);
  assert.strictEqual(result.success, false);
});

test("Blocks access to 'eval'", () => {
  const vm = new MiniVM({}, 100_000);
  const result = vm.run(`eval("malicious code")`, ctx);
  assert.strictEqual(result.success, false);
});

test("Blocks access to 'global'", () => {
  const vm = new MiniVM({}, 100_000);
  const result = vm.run(`log(global.process.version)`, ctx);
  assert.strictEqual(result.success, false);
});

test("Legitimate contract runs successfully", () => {
  const vm = new MiniVM({ balance: 100 }, 100_000);
  const result = vm.run(`
    const bal = state.balance;
    require(bal > 0, 'Balance must be positive');
    log('Balance: ' + bal);
    state.balance = bal + 50;
  `, ctx);
  assert.strictEqual(result.success, true);
  assert.strictEqual(vm.getState().balance, 150);
});

test("Out-of-gas protection works", () => {
  const vm = new MiniVM({}, 100);
  const result = vm.run(`
    let i = 0;
    while(true) {
      log('spam' + i);
      i++;
    }
  `, ctx);
  assert.strictEqual(result.success, false);
});

test("VM state isolation (no state leakage between runs)", () => {
  const vm1 = new MiniVM({ secret: "SENSITIVE_DATA" }, 100_000);
  const vm2 = new MiniVM({}, 100_000);

  const result1 = vm1.run(`state.secret = 'changed';`, ctx);
  assert.strictEqual(result1.success, true);

  assert.strictEqual(vm2.getState().secret, undefined, "VM2 should not have access to VM1 state");
});

// ─── Summary ─────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error(`\n⚠️  ${failed} test(s) gagal`);
  process.exit(1);
} else {
  console.log(`\n✅ Semua ${passed} test berhasil`);
  process.exit(0);
}
