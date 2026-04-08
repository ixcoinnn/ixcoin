import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

const API = import.meta.env.BASE_URL.replace(/\/$/, "").replace(/\/[^/]*$/, "") + "/api";

const CHAIN_ICONS: Record<string, string> = {
  ethereum: "⟠", bsc: "🟡", polygon: "🟣", avalanche: "🔺", solana: "◎", bitcoin: "₿", ixcoin: "🔶",
};

function ChainBadge({ chain }: { chain: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs bg-muted/50 border border-border px-2 py-0.5 rounded-full capitalize">
      <span>{CHAIN_ICONS[chain] ?? "🔗"}</span>
      {chain}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: "text-yellow-400 bg-yellow-500/10 border-yellow-500/20",
    locked: "text-blue-400 bg-blue-500/10 border-blue-500/20",
    minting: "text-purple-400 bg-purple-500/10 border-purple-500/20",
    completed: "text-green-400 bg-green-500/10 border-green-500/20",
    failed: "text-red-400 bg-red-500/10 border-red-500/20",
    refunded: "text-orange-400 bg-orange-500/10 border-orange-500/20",
  };
  return (
    <span className={`inline-flex items-center text-xs border px-2 py-0.5 rounded-full capitalize font-medium ${colors[status] ?? ""}`}>
      {status}
    </span>
  );
}

function BridgeOutForm({ config }: { config: { supportedChains: string[]; supportedTokens: { symbol: string; minBridge: number; maxBridge: number }[] } }) {
  const { toast } = useToast();
  const [form, setForm] = useState({ sender: "", recipient: "", token: "IXC", amount: "", destChain: "ethereum" });
  const [estimate, setEstimate] = useState<{ bridgeFee: number; receive: number; estimatedTime: string } | null>(null);

  const getEstimate = useMutation({
    mutationFn: () => fetch(`${API}/bridge/estimate?token=${form.token}&amount=${form.amount}&sourceChain=ixcoin&destChain=${form.destChain}`).then((r) => r.json()),
    onSuccess: (d) => { if (!d.error) setEstimate(d); },
  });

  const lock = useMutation({
    mutationFn: () => fetch(`${API}/bridge/lock`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, amount: Number(form.amount) }),
    }).then((r) => r.json()),
    onSuccess: (d) => {
      if (d.error) { toast({ title: "Error", description: d.error, variant: "destructive" }); return; }
      toast({ title: "Bridge Initiated!", description: `Bridge ID: ${d.bridgeId?.slice(0, 16)}... · Fee: ${d.bridgeFee} IXC` });
      setEstimate(null);
    },
  });

  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => { setForm((p) => ({ ...p, [k]: e.target.value })); setEstimate(null); };

  const tokenCfg = config.supportedTokens.find((t) => t.symbol === form.token);

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-xl">{CHAIN_ICONS.ixcoin}</span>
        <span className="text-sm font-semibold text-foreground">IXCOIN</span>
        <span className="text-muted-foreground text-xs px-2">→</span>
        <span className="text-xl">{CHAIN_ICONS[form.destChain] ?? "🔗"}</span>
        <span className="text-sm font-semibold text-foreground capitalize">{form.destChain}</span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="text-xs text-muted-foreground mb-1 block">Your IXCOIN Address</label>
          <input value={form.sender} onChange={f("sender")} placeholder="IX17..." className="w-full bg-muted/30 border border-border rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-orange-500/50" />
        </div>
        <div className="col-span-2">
          <label className="text-xs text-muted-foreground mb-1 block">Recipient Address (on destination chain)</label>
          <input value={form.recipient} onChange={f("recipient")} placeholder="0x... or native address" className="w-full bg-muted/30 border border-border rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-orange-500/50" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Token</label>
          <select value={form.token} onChange={f("token")} className="w-full bg-muted/30 border border-border rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-orange-500/50">
            {config.supportedTokens.map((t) => <option key={t.symbol} value={t.symbol}>{t.symbol}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Destination Chain</label>
          <select value={form.destChain} onChange={f("destChain")} className="w-full bg-muted/30 border border-border rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-orange-500/50">
            {config.supportedChains.map((c) => <option key={c} value={c}>{CHAIN_ICONS[c]} {c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
          </select>
        </div>
        <div className="col-span-2">
          <label className="text-xs text-muted-foreground mb-1 block">
            Amount {tokenCfg && <span className="ml-1">(min: {tokenCfg.minBridge}, max: {tokenCfg.maxBridge})</span>}
          </label>
          <input value={form.amount} onChange={f("amount")} type="number" placeholder="100" className="w-full bg-muted/30 border border-border rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-orange-500/50" />
        </div>
      </div>

      {estimate && (
        <div className="rounded-lg bg-muted/30 border border-border p-3 space-y-1.5 text-xs">
          <div className="flex justify-between"><span className="text-muted-foreground">Bridge Fee</span><span className="text-orange-400">{estimate.bridgeFee} {form.token}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">You Receive</span><span className="font-semibold text-green-400">{estimate.receive} {form.token}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Est. Time</span><span>{estimate.estimatedTime}</span></div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <button onClick={() => getEstimate.mutate()} disabled={getEstimate.isPending || !form.token || !form.amount}
          className="bg-muted hover:bg-muted/80 text-foreground font-semibold py-2 rounded-lg text-sm transition-colors">
          Get Estimate
        </button>
        <button onClick={() => lock.mutate()} disabled={lock.isPending || !form.sender || !form.recipient || !form.amount}
          className="bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-semibold py-2 rounded-lg text-sm transition-colors">
          {lock.isPending ? "Initiating..." : "Bridge Out"}
        </button>
      </div>
    </div>
  );
}

function BridgeInForm({ config }: { config: { supportedChains: string[]; supportedTokens: { symbol: string }[] } }) {
  const { toast } = useToast();
  const [form, setForm] = useState({ sender: "", recipient: "", token: "WETH", amount: "", sourceChain: "ethereum", sourceHash: "" });

  const bridge = useMutation({
    mutationFn: () => fetch(`${API}/bridge/bridge-in`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, amount: Number(form.amount) }),
    }).then((r) => r.json()),
    onSuccess: (d) => {
      if (d.error) { toast({ title: "Error", description: d.error, variant: "destructive" }); return; }
      toast({ title: "Bridge In Successful!", description: `Received ${d.received} ${form.token} on IXCOIN` });
    },
  });

  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((p) => ({ ...p, [k]: e.target.value }));

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-xl">{CHAIN_ICONS[form.sourceChain] ?? "🔗"}</span>
        <span className="text-sm font-semibold text-foreground capitalize">{form.sourceChain}</span>
        <span className="text-muted-foreground text-xs px-2">→</span>
        <span className="text-xl">{CHAIN_ICONS.ixcoin}</span>
        <span className="text-sm font-semibold text-foreground">IXCOIN</span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="text-xs text-muted-foreground mb-1 block">Sender Address (on source chain)</label>
          <input value={form.sender} onChange={f("sender")} placeholder="0x..." className="w-full bg-muted/30 border border-border rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-orange-500/50" />
        </div>
        <div className="col-span-2">
          <label className="text-xs text-muted-foreground mb-1 block">Your IXCOIN Recipient Address</label>
          <input value={form.recipient} onChange={f("recipient")} placeholder="IX17..." className="w-full bg-muted/30 border border-border rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-orange-500/50" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Source Chain</label>
          <select value={form.sourceChain} onChange={f("sourceChain")} className="w-full bg-muted/30 border border-border rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-orange-500/50">
            {config.supportedChains.map((c) => <option key={c} value={c}>{CHAIN_ICONS[c]} {c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Token</label>
          <select value={form.token} onChange={f("token")} className="w-full bg-muted/30 border border-border rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-orange-500/50">
            {config.supportedTokens.map((t) => <option key={t.symbol} value={t.symbol}>{t.symbol}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Amount</label>
          <input value={form.amount} onChange={f("amount")} type="number" placeholder="1.0" className="w-full bg-muted/30 border border-border rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-orange-500/50" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Source TX Hash</label>
          <input value={form.sourceHash} onChange={f("sourceHash")} placeholder="0x..." className="w-full bg-muted/30 border border-border rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-orange-500/50" />
        </div>
      </div>

      <button onClick={() => bridge.mutate()} disabled={bridge.isPending || !form.sender || !form.recipient || !form.amount || !form.sourceHash}
        className="w-full bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-semibold py-2 rounded-lg text-sm transition-colors">
        {bridge.isPending ? "Bridging..." : "Bridge In to IXCOIN"}
      </button>
    </div>
  );
}

function BridgeHistory({ address }: { address: string }) {
  const { data } = useQuery({
    queryKey: ["bridge-history", address],
    queryFn: () => fetch(`${API}/bridge/history/${address}`).then((r) => r.json()),
    enabled: address.length > 5,
  });
  if (!Array.isArray(data) || data.length === 0) return null;
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <h3 className="font-semibold text-sm mb-3">📋 Bridge History</h3>
      <div className="space-y-2">
        {data.map((req: { id: string; source_chain: string; dest_chain: string; token: string; amount: number; bridge_fee: number; status: string; created_at: number }) => (
          <div key={req.id} className="flex items-center gap-3 p-2 rounded-lg bg-muted/20">
            <ChainBadge chain={req.source_chain} />
            <span className="text-xs text-muted-foreground">→</span>
            <ChainBadge chain={req.dest_chain} />
            <div className="flex-1">
              <p className="text-xs font-semibold">{req.amount} {req.token}</p>
              <p className="text-xs text-muted-foreground">Fee: {req.bridge_fee}</p>
            </div>
            <StatusBadge status={req.status} />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Bridge() {
  const [direction, setDirection] = useState<"out" | "in">("out");
  const [historyAddr, setHistoryAddr] = useState("");
  const [queryAddr, setQueryAddr] = useState("");

  const { data: config } = useQuery({ queryKey: ["bridge-config"], queryFn: () => fetch(`${API}/bridge/config`).then((r) => r.json()) });
  const { data: stats } = useQuery({ queryKey: ["bridge-stats"], queryFn: () => fetch(`${API}/bridge/stats`).then((r) => r.json()) });

  if (!config) return <div className="text-xs text-muted-foreground">Loading bridge config...</div>;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">🌉 Cross-Chain Bridge</h1>
        <p className="text-sm text-muted-foreground mt-1">Bridge tokens between IXCOIN and other blockchains securely</p>
      </div>

      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Total Bridged", value: `${Number(stats.total_volume ?? 0).toFixed(2)} IXC`, icon: "📊" },
            { label: "Completed", value: stats.completed ?? 0, icon: "✅" },
            { label: "Pending", value: stats.pending ?? 0, icon: "⏳" },
            { label: "Supported Chains", value: config.supportedChains.length, icon: "🔗" },
          ].map(({ label, value, icon }) => (
            <div key={label} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center gap-2 mb-1"><span>{icon}</span><p className="text-xs text-muted-foreground">{label}</p></div>
              <p className="text-xl font-bold text-foreground">{value}</p>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-1 bg-muted/30 rounded-xl p-1">
        <button onClick={() => setDirection("out")} className={`flex-1 py-2 rounded-lg text-xs font-medium transition-colors ${direction === "out" ? "bg-orange-500 text-white" : "text-muted-foreground hover:text-foreground"}`}>
          🔶 IXCOIN → Other Chain
        </button>
        <button onClick={() => setDirection("in")} className={`flex-1 py-2 rounded-lg text-xs font-medium transition-colors ${direction === "in" ? "bg-orange-500 text-white" : "text-muted-foreground hover:text-foreground"}`}>
          🔷 Other Chain → IXCOIN
        </button>
      </div>

      {direction === "out" ? <BridgeOutForm config={config} /> : <BridgeInForm config={config} />}

      {/* Supported tokens */}
      <div className="rounded-xl border border-border bg-card p-5">
        <h3 className="font-semibold text-sm mb-3">🪙 Supported Tokens</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {config.supportedTokens.map((t: { symbol: string; name: string; sourceChain: string; bridgeFeePercent: number; minBridge: number; maxBridge: number }) => (
            <div key={t.symbol} className="rounded-lg border border-border bg-muted/20 p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="font-semibold text-sm">{t.symbol}</span>
                <ChainBadge chain={t.sourceChain} />
              </div>
              <p className="text-xs text-muted-foreground">{t.name}</p>
              <p className="text-xs text-muted-foreground mt-1">Fee: {(t.bridgeFeePercent * 100).toFixed(2)}% · Min: {t.minBridge}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Bridge history lookup */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-3">
        <h3 className="font-semibold text-sm">📋 Check Bridge History</h3>
        <div className="flex gap-2">
          <input value={historyAddr} onChange={(e) => setHistoryAddr(e.target.value)} placeholder="Your address..." className="flex-1 bg-muted/30 border border-border rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-orange-500/50" />
          <button onClick={() => setQueryAddr(historyAddr)} className="bg-orange-500 hover:bg-orange-600 text-white font-semibold px-4 py-2 rounded-lg text-sm">View</button>
        </div>
        <BridgeHistory address={queryAddr} />
      </div>
    </div>
  );
}
