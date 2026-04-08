import { Router } from "express";
import { turingVM, contractStorage, CONTRACT_TEMPLATES } from "../blockchain/turing-vm.js";
import { sha256 } from "../blockchain/crypto.js";
import { v4 as uuidv4 } from "uuid";

const router = Router();

// List all deployed contracts
router.get("/", async (req, res) => {
  try {
    const type = req.query.type as string | undefined;
    const limit = parseInt(req.query.limit as string) || 20;
    const contracts = await contractStorage.listContracts(type, limit);
    res.json(contracts);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Get contract templates
router.get("/templates", (req, res) => {
  res.json({
    fungible_token: { name: "Fungible Token (ERC-20 like)", code: CONTRACT_TEMPLATES.fungible_token },
    nft_collection: { name: "NFT Collection (ERC-721 like)", code: CONTRACT_TEMPLATES.nft_collection },
  });
});

// Deploy new contract
router.post("/deploy", async (req, res) => {
  try {
    const { deployer, name, description, code, abi, initialState, gasLimit, contractType } = req.body;
    if (!deployer || !name || !code) return res.status(400).json({ error: "deployer, name, code required" });

    const address = `IX_CONTRACT_${sha256(`${deployer}:${name}:${Date.now()}`).slice(0, 20).toUpperCase()}`;
    const txHash = sha256(`deploy:${address}:${Date.now()}`);

    await contractStorage.saveContract({
      address,
      deployer,
      name,
      description: description ?? "",
      code,
      abi: abi ?? [],
      state: initialState ?? {},
      balance: 0,
      txHash,
      blockHeight: 0,
      createdAt: Date.now(),
      callCount: 0,
      verified: false,
      contractType: contractType ?? "generic",
    });

    res.json({ success: true, address, txHash });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Call a contract method
router.post("/:address/call", async (req, res) => {
  try {
    const { caller, method, args, value, blockHeight, gasLimit } = req.body;
    if (!caller || !method) return res.status(400).json({ error: "caller, method required" });

    const contract = await contractStorage.getContract(req.params.address);
    if (!contract) return res.status(404).json({ error: "Contract not found" });

    const ctx = {
      caller,
      origin: caller,
      contractAddress: contract.address,
      value: value ?? 0,
      blockHeight: blockHeight ?? 0,
      timestamp: Date.now(),
      gasLimit: gasLimit ?? 1_000_000,
    };

    const stateCopy = JSON.parse(JSON.stringify(contract.state)) as Record<string, unknown>;
    const result = turingVM.execute(contract.code, method, args ?? [], stateCopy, ctx);

    if (result.success) {
      await contractStorage.updateContractState(contract.address, stateCopy);
    }

    const callId = uuidv4();
    await contractStorage.saveCallRecord({
      id: callId,
      contractAddress: contract.address,
      caller,
      method,
      args: args ?? [],
      result: result.returnValue,
      gasUsed: result.gasUsed,
      success: result.success,
      error: result.error,
      events: result.events,
      timestamp: Date.now(),
    });

    res.json({
      success: result.success,
      gasUsed: result.gasUsed,
      returnValue: result.returnValue,
      error: result.error,
      logs: result.logs,
      events: result.events,
      callId,
    });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Read contract state (no gas cost)
router.get("/:address/state", async (req, res) => {
  try {
    const contract = await contractStorage.getContract(req.params.address);
    if (!contract) return res.status(404).json({ error: "Contract not found" });
    res.json({ address: contract.address, state: contract.state });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Get contract
router.get("/:address", async (req, res) => {
  try {
    const contract = await contractStorage.getContract(req.params.address);
    if (!contract) return res.status(404).json({ error: "Contract not found" });
    res.json(contract);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Get contract call history
router.get("/:address/calls", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    const calls = await contractStorage.getCallHistory(req.params.address, limit);
    res.json(calls);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Quick script execution (sandbox — not persisted)
router.post("/execute", async (req, res) => {
  try {
    const { caller, code, method, args, state, gasLimit } = req.body;
    if (!code || !method || !caller) return res.status(400).json({ error: "caller, code, method required" });

    const ctx = {
      caller,
      origin: caller,
      contractAddress: "SANDBOX",
      value: 0,
      blockHeight: 0,
      timestamp: Date.now(),
      gasLimit: Math.min(gasLimit ?? 500_000, 2_000_000),
    };

    const sandboxState = state ?? {};
    const result = turingVM.execute(code, method, args ?? [], sandboxState, ctx);

    res.json({
      success: result.success,
      gasUsed: result.gasUsed,
      returnValue: result.returnValue,
      error: result.error,
      logs: result.logs,
      events: result.events,
      finalState: sandboxState,
    });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
