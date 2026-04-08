import { useState, useEffect } from "react";
import { api, type ContractSummary, type ContractDetail, type CallResult, type DeployResult } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

const TEMPLATES = [
  {
    name: "Counter",
    description: "Kontrak penghitung sederhana yang bisa di-increment oleh siapapun.",
    code: `// Counter Contract
// State awal: { count: 0 }
if (!state.count) state.count = 0;
state.count += 1;
log("Count sekarang: " + state.count);
return state.count;`,
    initialState: { count: 0 },
    callCode: `// Increment counter
state.count = (state.count || 0) + 1;
log("Counter: " + state.count);
return state.count;`,
  },
  {
    name: "Simple Token",
    description: "Token sederhana dengan fungsi transfer antar alamat.",
    code: `// SimpleToken Contract
// State: { balances: {}, totalSupply: 1000 }
if (!state.balances) state.balances = {};
if (!state.totalSupply) state.totalSupply = 1000;
state.balances[context.from] = (state.balances[context.from] || 0) + state.totalSupply;
log("Token dibuat: " + state.totalSupply + " unit untuk " + context.from);
return { deployer: context.from, totalSupply: state.totalSupply };`,
    initialState: { balances: {}, totalSupply: 1000 },
    callCode: `// Transfer token ke alamat tertentu
const recipient = "IX_ALAMAT_TUJUAN"; // ganti dengan alamat tujuan
const amount = 10;
require(state.balances[context.from] >= amount, "Saldo token tidak cukup");
state.balances[context.from] -= amount;
state.balances[recipient] = (state.balances[recipient] || 0) + amount;
log("Transfer " + amount + " token ke " + recipient);
return { from: context.from, to: recipient, amount };`,
  },
  {
    name: "Voting",
    description: "Kontrak voting untuk pemilihan terdesentralisasi.",
    code: `// Voting Contract
if (!state.votes) state.votes = {};
if (!state.candidates) state.candidates = ["Alice", "Bob", "Charlie"];
if (!state.voters) state.voters = [];
log("Kontrak voting aktif. Kandidat: " + state.candidates.join(", "));
return { candidates: state.candidates, totalVotes: 0 };`,
    initialState: { votes: {}, candidates: ["Alice", "Bob", "Charlie"], voters: [] },
    callCode: `// Cast vote untuk kandidat
const candidate = "Alice"; // ganti nama kandidat
require(!state.voters.includes(context.from), "Kamu sudah voting!");
require(state.candidates.includes(candidate), "Kandidat tidak valid");
state.votes[candidate] = (state.votes[candidate] || 0) + 1;
state.voters.push(context.from);
log(context.from + " vote untuk " + candidate);
return { candidate, totalVotes: state.votes };`,
  },
  {
    name: "Escrow",
    description: "Kontrak escrow untuk transaksi aman antara dua pihak.",
    code: `// Escrow Contract
if (!state.locked) state.locked = false;
if (!state.owner) state.owner = context.from;
if (!state.amount) state.amount = 0;
log("Escrow dibuat oleh: " + context.from);
return { owner: state.owner, locked: state.locked };`,
    initialState: { locked: false, owner: "", amount: 0 },
    callCode: `// Lock IXC ke escrow
require(!state.locked, "Escrow sudah terkunci");
state.locked = true;
state.amount = context.amount;
state.depositor = context.from;
log("Locked " + context.amount + " IXC dari " + context.from);
return { locked: true, amount: context.amount };`,
  },
];

function truncate(str: string, n = 16) {
  return str.length > n ? str.slice(0, n) + "…" : str;
}

function timeAgo(ms: number) {
  const diff = Date.now() - ms;
  if (diff < 60000) return "baru saja";
  if (diff < 3600000) return Math.floor(diff / 60000) + " menit lalu";
  if (diff < 86400000) return Math.floor(diff / 3600000) + " jam lalu";
  return Math.floor(diff / 86400000) + " hari lalu";
}

export default function SmartContract() {
  const { toast } = useToast();
  const [tab, setTab] = useState<"deploy" | "interact" | "list">("list");

  const [contracts, setContracts] = useState<ContractSummary[]>([]);
  const [loadingContracts, setLoadingContracts] = useState(false);

  const [selectedContract, setSelectedContract] = useState<ContractDetail | null>(null);
  const [loadingContract, setLoadingContract] = useState(false);

  const [deployForm, setDeployForm] = useState({
    name: "",
    description: "",
    code: "",
    deployerAddress: "",
    privateKeyHex: "",
  });
  const [deploying, setDeploying] = useState(false);
  const [deployResult, setDeployResult] = useState<DeployResult | null>(null);

  const [callForm, setCallForm] = useState({
    contractAddress: "",
    callerAddress: "",
    privateKeyHex: "",
    callCode: "",
    amount: "",
  });
  const [calling, setCalling] = useState(false);
  const [callResult, setCallResult] = useState<CallResult | null>(null);

  const [selectedTemplate, setSelectedTemplate] = useState<number | null>(null);

  useEffect(() => {
    loadContracts();
  }, []);

  async function loadContracts() {
    setLoadingContracts(true);
    try {
      const data = await api.getContracts(50);
      setContracts(data.contracts);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingContracts(false);
    }
  }

  async function loadContract(address: string) {
    setLoadingContract(true);
    try {
      const data = await api.getContract(address);
      setSelectedContract(data);
      setCallForm((f) => ({ ...f, contractAddress: address }));
      setTab("interact");
    } catch {
      toast({ title: "Gagal", description: "Kontrak tidak ditemukan", variant: "destructive" });
    } finally {
      setLoadingContract(false);
    }
  }

  function applyTemplate(idx: number) {
    const t = TEMPLATES[idx];
    setSelectedTemplate(idx);
    setDeployForm((f) => ({
      ...f,
      name: t.name,
      description: t.description,
      code: t.code,
    }));
  }

  async function handleDeploy(e: React.FormEvent) {
    e.preventDefault();
    if (!deployForm.code || !deployForm.deployerAddress || !deployForm.privateKeyHex) {
      toast({ title: "Field wajib", description: "Isi semua field yang diperlukan", variant: "destructive" });
      return;
    }
    setDeploying(true);
    setDeployResult(null);
    try {
      const template = selectedTemplate !== null ? TEMPLATES[selectedTemplate] : null;
      const result = await api.deployContract({
        deployerAddress: deployForm.deployerAddress,
        privateKeyHex: deployForm.privateKeyHex,
        name: deployForm.name || "Unnamed Contract",
        description: deployForm.description,
        code: deployForm.code,
        initialState: template?.initialState,
      });
      setDeployResult(result);
      toast({ title: "Kontrak berhasil di-deploy!", description: result.contractAddress });
      await loadContracts();
    } catch (err) {
      toast({
        title: "Deploy gagal",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setDeploying(false);
    }
  }

  async function handleCall(e: React.FormEvent) {
    e.preventDefault();
    if (!callForm.contractAddress || !callForm.callerAddress || !callForm.privateKeyHex || !callForm.callCode) {
      toast({ title: "Field wajib", description: "Isi semua field yang diperlukan", variant: "destructive" });
      return;
    }
    setCalling(true);
    setCallResult(null);
    try {
      const result = await api.callContract({
        contractAddress: callForm.contractAddress,
        callerAddress: callForm.callerAddress,
        privateKeyHex: callForm.privateKeyHex,
        callCode: callForm.callCode,
        amount: callForm.amount ? Number(callForm.amount) : 0,
      });
      setCallResult(result);
      if (result.success) {
        toast({ title: "Kontrak berhasil dipanggil", description: `Gas: ${result.gasUsed}` });
        if (selectedContract && selectedContract.address === callForm.contractAddress) {
          setSelectedContract((prev) =>
            prev ? { ...prev, state: result.newState } : prev
          );
        }
      } else {
        toast({ title: "Eksekusi gagal", description: result.error, variant: "destructive" });
      }
    } catch (err) {
      toast({
        title: "Panggilan gagal",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setCalling(false);
    }
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-12">
      <div className="border-b border-border pb-4">
        <h1 className="text-2xl font-bold text-foreground mb-1">Smart Contract (IXVM)</h1>
        <p className="text-sm text-muted-foreground">
          Deploy dan jalankan kontrak pintar di atas jaringan IXCoin menggunakan IX Virtual Machine.
        </p>
      </div>

      <div className="flex gap-2 border-b border-border">
        {(["list", "deploy", "interact"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t
                ? "border-orange-400 text-orange-400"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t === "list" ? "Daftar Kontrak" : t === "deploy" ? "Deploy Kontrak" : "Interaksi"}
          </button>
        ))}
      </div>

      {tab === "list" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">{contracts.length} kontrak terdeploy</p>
            <button
              onClick={loadContracts}
              className="text-xs text-orange-400 hover:text-orange-300 transition-colors"
            >
              Refresh
            </button>
          </div>

          {loadingContracts ? (
            <div className="text-center py-12 text-muted-foreground text-sm">Memuat kontrak...</div>
          ) : contracts.length === 0 ? (
            <div className="rounded-xl border border-border bg-muted/20 p-10 text-center">
              <p className="text-muted-foreground text-sm mb-3">Belum ada kontrak yang terdeploy.</p>
              <button
                onClick={() => setTab("deploy")}
                className="text-sm font-medium text-orange-400 hover:text-orange-300 transition-colors"
              >
                Deploy kontrak pertama →
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {contracts.map((c) => (
                <div
                  key={c.address}
                  className="rounded-lg border border-border bg-card p-4 hover:border-orange-500/40 transition-colors cursor-pointer"
                  onClick={() => loadContract(c.address)}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-semibold text-foreground">{c.name}</span>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/15 text-purple-400 border border-purple-500/20">
                          IXVM
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground font-mono mb-1">{c.address}</p>
                      {c.description && (
                        <p className="text-xs text-muted-foreground">{c.description}</p>
                      )}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-xs text-muted-foreground">{timeAgo(c.createdAt)}</p>
                      <p className="text-xs text-orange-400 mt-1">{c.callCount} panggilan</p>
                    </div>
                  </div>
                  <div className="mt-2 pt-2 border-t border-border/50 flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">
                      Deployer: <span className="font-mono">{truncate(c.deployer, 20)}</span>
                    </p>
                    <span className="text-xs text-orange-400 font-medium">Lihat detail →</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "deploy" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1 space-y-3">
            <p className="text-sm font-semibold text-foreground">Template Kontrak</p>
            {TEMPLATES.map((t, i) => (
              <button
                key={t.name}
                onClick={() => applyTemplate(i)}
                className={`w-full text-left rounded-lg border p-3 transition-colors ${
                  selectedTemplate === i
                    ? "border-orange-500/50 bg-orange-500/10"
                    : "border-border hover:border-orange-500/30 bg-card"
                }`}
              >
                <p className="text-sm font-medium text-foreground">{t.name}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{t.description}</p>
              </button>
            ))}
          </div>

          <div className="lg:col-span-2">
            <form onSubmit={handleDeploy} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Nama Kontrak</label>
                  <input
                    className="w-full bg-muted/30 border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-orange-500/50"
                    placeholder="Nama kontrak..."
                    value={deployForm.name}
                    onChange={(e) => setDeployForm((f) => ({ ...f, name: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Deskripsi</label>
                  <input
                    className="w-full bg-muted/30 border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-orange-500/50"
                    placeholder="Deskripsi singkat..."
                    value={deployForm.description}
                    onChange={(e) => setDeployForm((f) => ({ ...f, description: e.target.value }))}
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Kode Kontrak (IXVM)</label>
                <textarea
                  rows={10}
                  className="w-full bg-zinc-900 border border-border rounded-lg px-3 py-2 text-sm text-green-400 font-mono placeholder:text-muted-foreground/50 focus:outline-none focus:border-orange-500/50 resize-none"
                  placeholder={`// Tulis kode kontrak di sini\n// Tersedia: state, context, log(), require(), transfer()\nstate.counter = (state.counter || 0) + 1;\nreturn state.counter;`}
                  value={deployForm.code}
                  onChange={(e) => setDeployForm((f) => ({ ...f, code: e.target.value }))}
                />
              </div>

              <div className="grid grid-cols-1 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Alamat Deployer</label>
                  <input
                    className="w-full bg-muted/30 border border-border rounded-lg px-3 py-2 text-sm text-foreground font-mono placeholder:text-muted-foreground/50 focus:outline-none focus:border-orange-500/50"
                    placeholder="IX..."
                    value={deployForm.deployerAddress}
                    onChange={(e) => setDeployForm((f) => ({ ...f, deployerAddress: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Private Key (Hex)</label>
                  <input
                    type="password"
                    className="w-full bg-muted/30 border border-border rounded-lg px-3 py-2 text-sm text-foreground font-mono placeholder:text-muted-foreground/50 focus:outline-none focus:border-orange-500/50"
                    placeholder="Private key hex..."
                    value={deployForm.privateKeyHex}
                    onChange={(e) => setDeployForm((f) => ({ ...f, privateKeyHex: e.target.value }))}
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={deploying}
                className="w-full py-2.5 rounded-lg bg-orange-500 hover:bg-orange-400 disabled:opacity-50 text-white text-sm font-semibold transition-colors"
              >
                {deploying ? "Mendeploy..." : "Deploy Kontrak"}
              </button>
            </form>

            {deployResult && (
              <div className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 space-y-2">
                <p className="text-sm font-semibold text-emerald-400">Kontrak berhasil di-deploy!</p>
                <div className="text-xs space-y-1">
                  <div className="flex gap-2">
                    <span className="text-muted-foreground">Alamat:</span>
                    <span className="font-mono text-foreground break-all">{deployResult.contractAddress}</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-muted-foreground">TX:</span>
                    <span className="font-mono text-foreground break-all">{deployResult.deployTxId}</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-muted-foreground">Gas:</span>
                    <span className="text-foreground">{deployResult.gasUsed}</span>
                  </div>
                </div>
                {deployResult.logs.length > 0 && (
                  <div className="mt-2 rounded bg-black/30 p-2">
                    {deployResult.logs.map((l, i) => (
                      <p key={i} className="text-xs text-green-400 font-mono">{l}</p>
                    ))}
                  </div>
                )}
                <button
                  onClick={() => {
                    setCallForm((f) => ({ ...f, contractAddress: deployResult.contractAddress }));
                    setTab("interact");
                    loadContract(deployResult.contractAddress);
                  }}
                  className="text-xs text-orange-400 hover:text-orange-300 transition-colors"
                >
                  Interaksi dengan kontrak ini →
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === "interact" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Alamat Kontrak</label>
              <div className="flex gap-2">
                <input
                  className="flex-1 bg-muted/30 border border-border rounded-lg px-3 py-2 text-sm text-foreground font-mono placeholder:text-muted-foreground/50 focus:outline-none focus:border-orange-500/50"
                  placeholder="IXC..."
                  value={callForm.contractAddress}
                  onChange={(e) => setCallForm((f) => ({ ...f, contractAddress: e.target.value }))}
                />
                <button
                  onClick={() => callForm.contractAddress && loadContract(callForm.contractAddress)}
                  disabled={loadingContract}
                  className="px-3 py-2 rounded-lg border border-border bg-muted/30 text-sm text-foreground hover:border-orange-500/30 transition-colors"
                >
                  Load
                </button>
              </div>
            </div>

            {selectedContract && (
              <div className="rounded-lg border border-border bg-card p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-foreground">{selectedContract.name}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/15 text-purple-400 border border-purple-500/20">IXVM</span>
                </div>
                <p className="text-xs text-muted-foreground">{selectedContract.description}</p>
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">State Sekarang:</p>
                  <pre className="text-xs bg-black/30 rounded p-2 overflow-auto max-h-40 text-green-400 font-mono">
                    {JSON.stringify(selectedContract.state, null, 2)}
                  </pre>
                </div>
                <div className="text-xs text-muted-foreground space-y-1 pt-2 border-t border-border/50">
                  <p>Total panggilan: <span className="text-foreground">{selectedContract.callCount}</span></p>
                  <p>Deployer: <span className="font-mono">{truncate(selectedContract.deployer, 24)}</span></p>
                </div>
                {selectedContract.recentCalls.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-2">Panggilan Terakhir:</p>
                    <div className="space-y-1.5 max-h-32 overflow-y-auto">
                      {selectedContract.recentCalls.map((c) => (
                        <div
                          key={c.id}
                          className={`rounded p-2 text-xs border ${
                            c.success
                              ? "border-emerald-500/20 bg-emerald-500/5"
                              : "border-red-500/20 bg-red-500/5"
                          }`}
                        >
                          <div className="flex justify-between">
                            <span className={c.success ? "text-emerald-400" : "text-red-400"}>
                              {c.success ? "✓ Sukses" : "✗ Gagal"}
                            </span>
                            <span className="text-muted-foreground">{timeAgo(c.createdAt)}</span>
                          </div>
                          <p className="text-muted-foreground mt-0.5 font-mono">{truncate(c.caller, 22)}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {selectedTemplate !== null && (
                  <div className="pt-2 border-t border-border/50">
                    <p className="text-xs font-medium text-muted-foreground mb-1">Template Call Code:</p>
                    <button
                      onClick={() => setCallForm((f) => ({ ...f, callCode: TEMPLATES[selectedTemplate].callCode }))}
                      className="text-xs text-orange-400 hover:text-orange-300 transition-colors"
                    >
                      Terapkan template call →
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          <div>
            <form onSubmit={handleCall} className="space-y-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Kode Panggilan (IXVM)</label>
                <textarea
                  rows={8}
                  className="w-full bg-zinc-900 border border-border rounded-lg px-3 py-2 text-sm text-green-400 font-mono placeholder:text-muted-foreground/50 focus:outline-none focus:border-orange-500/50 resize-none"
                  placeholder={`// Tulis kode untuk memanggil fungsi kontrak\n// state, context, log(), require() tersedia\nstate.counter = (state.counter || 0) + 1;\nreturn state.counter;`}
                  value={callForm.callCode}
                  onChange={(e) => setCallForm((f) => ({ ...f, callCode: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Alamat Pemanggil</label>
                <input
                  className="w-full bg-muted/30 border border-border rounded-lg px-3 py-2 text-sm text-foreground font-mono placeholder:text-muted-foreground/50 focus:outline-none focus:border-orange-500/50"
                  placeholder="IX..."
                  value={callForm.callerAddress}
                  onChange={(e) => setCallForm((f) => ({ ...f, callerAddress: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Private Key (Hex)</label>
                <input
                  type="password"
                  className="w-full bg-muted/30 border border-border rounded-lg px-3 py-2 text-sm text-foreground font-mono placeholder:text-muted-foreground/50 focus:outline-none focus:border-orange-500/50"
                  placeholder="Private key hex..."
                  value={callForm.privateKeyHex}
                  onChange={(e) => setCallForm((f) => ({ ...f, privateKeyHex: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">
                  Kirim IXC ke Kontrak (opsional)
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.001"
                  className="w-full bg-muted/30 border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-orange-500/50"
                  placeholder="0"
                  value={callForm.amount}
                  onChange={(e) => setCallForm((f) => ({ ...f, amount: e.target.value }))}
                />
              </div>
              <button
                type="submit"
                disabled={calling}
                className="w-full py-2.5 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-sm font-semibold transition-colors"
              >
                {calling ? "Menjalankan..." : "Panggil Kontrak"}
              </button>
            </form>

            {callResult && (
              <div
                className={`mt-4 rounded-lg border p-4 space-y-2 ${
                  callResult.success
                    ? "border-emerald-500/30 bg-emerald-500/10"
                    : "border-red-500/30 bg-red-500/10"
                }`}
              >
                <p className={`text-sm font-semibold ${callResult.success ? "text-emerald-400" : "text-red-400"}`}>
                  {callResult.success ? "Eksekusi berhasil!" : "Eksekusi gagal"}
                </p>
                {callResult.error && (
                  <p className="text-xs text-red-400">{callResult.error}</p>
                )}
                <div className="text-xs space-y-1">
                  <p className="text-muted-foreground">Gas digunakan: <span className="text-foreground">{callResult.gasUsed}</span></p>
                  {callResult.txId && (
                    <p className="text-muted-foreground">TX: <span className="font-mono text-foreground break-all">{callResult.txId}</span></p>
                  )}
                  {callResult.result !== undefined && callResult.result !== null && (
                    <div>
                      <p className="text-muted-foreground mb-0.5">Hasil:</p>
                      <pre className="bg-black/30 rounded p-2 text-green-400 font-mono overflow-auto max-h-24">
                        {JSON.stringify(callResult.result, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
                {callResult.logs.length > 0 && (
                  <div className="rounded bg-black/30 p-2">
                    {callResult.logs.map((l, i) => (
                      <p key={i} className="text-xs text-green-400 font-mono">{l}</p>
                    ))}
                  </div>
                )}
                {callResult.success && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">State baru:</p>
                    <pre className="text-xs bg-black/30 rounded p-2 overflow-auto max-h-32 text-green-400 font-mono">
                      {JSON.stringify(callResult.newState, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="rounded-xl border border-purple-500/20 bg-purple-500/5 p-4">
        <p className="text-xs font-semibold text-purple-400 mb-2">API IXVM yang tersedia di dalam kontrak:</p>
        <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
          <div><code className="text-purple-300">state</code> — State permanen kontrak</div>
          <div><code className="text-purple-300">context</code> — {"{from, to, amount, timestamp, blockHeight}"}</div>
          <div><code className="text-purple-300">log(msg)</code> — Cetak log ke output</div>
          <div><code className="text-purple-300">require(cond, msg)</code> — Assert kondisi</div>
          <div><code className="text-purple-300">transfer(from, to, amount)</code> — Transfer IXC di state</div>
          <div><code className="text-purple-300">return value</code> — Kembalikan hasil eksekusi</div>
        </div>
      </div>
    </div>
  );
}
