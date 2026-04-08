import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

const API = import.meta.env.BASE_URL.replace(/\/$/, "").replace(/\/[^/]*$/, "") + "/api";

function StatCard({ label, value, icon, sub }: { label: string; value: string | number; icon: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 mb-1">
        <span>{icon}</span>
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
      <p className="text-xl font-bold text-foreground">{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

function PoolCard({ pool }: { pool: { id: string; token_a: string; token_b: string; reserve_a: number; reserve_b: number; total_lp_shares: number; fee: number; total_volume: number; total_fees: number } }) {
  const price = pool.reserve_a > 0 ? (pool.reserve_b / pool.reserve_a).toFixed(6) : "0";
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="flex -space-x-1">
            <div className="w-7 h-7 rounded-full bg-orange-500/20 border-2 border-background flex items-center justify-center text-xs font-bold text-orange-400">
              {pool.token_a.slice(0, 2).toUpperCase()}
            </div>
            <div className="w-7 h-7 rounded-full bg-blue-500/20 border-2 border-background flex items-center justify-center text-xs font-bold text-blue-400">
              {pool.token_b.slice(0, 2).toUpperCase()}
            </div>
          </div>
          <span className="font-semibold text-sm">{pool.token_a}/{pool.token_b}</span>
        </div>
        <span className="text-xs bg-orange-500/10 text-orange-400 border border-orange-500/20 px-2 py-0.5 rounded-full">{(pool.fee * 100).toFixed(2)}% fee</span>
      </div>
      <div className="grid grid-cols-2 gap-3 text-xs">
        <div><p className="text-muted-foreground">Reserve {pool.token_a}</p><p className="font-semibold">{Number(pool.reserve_a).toFixed(4)}</p></div>
        <div><p className="text-muted-foreground">Reserve {pool.token_b}</p><p className="font-semibold">{Number(pool.reserve_b).toFixed(4)}</p></div>
        <div><p className="text-muted-foreground">Price</p><p className="font-semibold">1 {pool.token_a} = {price} {pool.token_b}</p></div>
        <div><p className="text-muted-foreground">Volume</p><p className="font-semibold">{Number(pool.total_volume).toFixed(2)}</p></div>
      </div>
    </div>
  );
}

function SwapPanel() {
  const { toast } = useToast();
  const [form, setForm] = useState({ trader: "", tokenIn: "IXC", tokenOut: "WETH", amountIn: "", minAmountOut: "" });
  const [quote, setQuote] = useState<{ amountOut: number; fee: number; priceImpact: string; poolId: string } | null>(null);

  const getQuote = useMutation({
    mutationFn: () => fetch(`${API}/defi/quote?tokenIn=${form.tokenIn}&tokenOut=${form.tokenOut}&amountIn=${form.amountIn}`).then((r) => r.json()),
    onSuccess: (d) => {
      if (d.error) { toast({ title: "Error", description: d.error, variant: "destructive" }); return; }
      setQuote(d);
    },
  });

  const swap = useMutation({
    mutationFn: () => fetch(`${API}/defi/swap`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, amountIn: Number(form.amountIn), minAmountOut: Number(form.minAmountOut) || undefined }),
    }).then((r) => r.json()),
    onSuccess: (d) => {
      if (d.error) { toast({ title: "Error", description: d.error, variant: "destructive" }); return; }
      toast({ title: "Swap successful!", description: `Got ${Number(d.amountOut).toFixed(6)} ${form.tokenOut} · TX: ${d.txHash?.slice(0, 12)}...` });
      setQuote(null);
    },
  });

  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((p) => ({ ...p, [k]: e.target.value }));

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <h3 className="font-semibold text-sm flex items-center gap-2">⚡ Swap</h3>
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">Your Address</label>
        <input value={form.trader} onChange={f("trader")} placeholder="IX17..." className="w-full bg-muted/30 border border-border rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-orange-500/50" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">From</label>
          <input value={form.tokenIn} onChange={f("tokenIn")} placeholder="IXC" className="w-full bg-muted/30 border border-border rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-orange-500/50" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">To</label>
          <input value={form.tokenOut} onChange={f("tokenOut")} placeholder="WETH" className="w-full bg-muted/30 border border-border rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-orange-500/50" />
        </div>
      </div>
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">Amount In</label>
        <input value={form.amountIn} onChange={f("amountIn")} placeholder="100" type="number" className="w-full bg-muted/30 border border-border rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-orange-500/50" />
      </div>

      {quote && (
        <div className="rounded-lg bg-muted/30 border border-border p-3 space-y-1.5 text-xs">
          <div className="flex justify-between"><span className="text-muted-foreground">You receive</span><span className="font-semibold text-green-400">{quote.amountOut.toFixed(6)} {form.tokenOut}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Fee</span><span>{quote.fee.toFixed(6)} {form.tokenIn}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Price Impact</span><span className={Number(quote.priceImpact) > 5 ? "text-red-400" : "text-green-400"}>{quote.priceImpact}%</span></div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <button onClick={() => getQuote.mutate()} disabled={getQuote.isPending || !form.tokenIn || !form.tokenOut || !form.amountIn}
          className="bg-muted hover:bg-muted/80 text-foreground font-semibold py-2 rounded-lg text-sm transition-colors">
          Get Quote
        </button>
        <button onClick={() => swap.mutate()} disabled={swap.isPending || !form.trader || !quote}
          className="bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-semibold py-2 rounded-lg text-sm transition-colors">
          {swap.isPending ? "Swapping..." : "Swap"}
        </button>
      </div>
    </div>
  );
}

function LiquidityPanel() {
  const { toast } = useToast();
  const [form, setForm] = useState({ provider: "", tokenA: "IXC", tokenB: "WETH", amountA: "", amountB: "" });

  const addLiq = useMutation({
    mutationFn: () => fetch(`${API}/defi/add-liquidity`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, amountA: Number(form.amountA), amountB: Number(form.amountB) }),
    }).then((r) => r.json()),
    onSuccess: (d) => {
      if (d.error) { toast({ title: "Error", description: d.error, variant: "destructive" }); return; }
      toast({ title: "Liquidity Added!", description: `Received ${d.shares} LP shares · Pool: ${d.poolId?.slice(0, 8)}...` });
    },
  });

  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((p) => ({ ...p, [k]: e.target.value }));

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-3">
      <h3 className="font-semibold text-sm flex items-center gap-2">💧 Add Liquidity</h3>
      <input value={form.provider} onChange={f("provider")} placeholder="Your address (IX17...)" className="w-full bg-muted/30 border border-border rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-orange-500/50" />
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Token A</label>
          <input value={form.tokenA} onChange={f("tokenA")} placeholder="IXC" className="w-full bg-muted/30 border border-border rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-orange-500/50" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Token B</label>
          <input value={form.tokenB} onChange={f("tokenB")} placeholder="WETH" className="w-full bg-muted/30 border border-border rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-orange-500/50" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Amount A</label>
          <input value={form.amountA} onChange={f("amountA")} type="number" placeholder="1000" className="w-full bg-muted/30 border border-border rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-orange-500/50" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Amount B</label>
          <input value={form.amountB} onChange={f("amountB")} type="number" placeholder="0.5" className="w-full bg-muted/30 border border-border rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-orange-500/50" />
        </div>
      </div>
      <button onClick={() => addLiq.mutate()} disabled={addLiq.isPending || !form.provider || !form.amountA || !form.amountB}
        className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold py-2 rounded-lg text-sm transition-colors">
        {addLiq.isPending ? "Adding..." : "Add Liquidity"}
      </button>
    </div>
  );
}

function StakingPanel() {
  const { toast } = useToast();
  const [stakeForm, setStakeForm] = useState({ poolId: "", staker: "", amount: "" });
  const { data: stakingPools } = useQuery({ queryKey: ["staking-pools"], queryFn: () => fetch(`${API}/defi/staking`).then((r) => r.json()) });

  const stake = useMutation({
    mutationFn: () => fetch(`${API}/defi/stake`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...stakeForm, amount: Number(stakeForm.amount) }),
    }).then((r) => r.json()),
    onSuccess: (d) => {
      if (d.error) { toast({ title: "Error", description: d.error, variant: "destructive" }); return; }
      toast({ title: "Staked!", description: `Lock until block ${d.lockUntilBlock}` });
    },
  });

  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setStakeForm((p) => ({ ...p, [k]: e.target.value }));

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <h3 className="font-semibold text-sm flex items-center gap-2">🌾 Staking</h3>

      <div className="space-y-2">
        {Array.isArray(stakingPools) && stakingPools.length > 0 ? stakingPools.map((p: { id: string; name: string; staking_token: string; reward_token: string; reward_per_block: number; total_staked: number }) => (
          <div key={p.id} className="rounded-lg border border-border bg-muted/20 p-3">
            <div className="flex justify-between items-center">
              <div>
                <p className="text-xs font-semibold">{p.name}</p>
                <p className="text-xs text-muted-foreground">Stake: {p.staking_token} → Reward: {p.reward_token}</p>
              </div>
              <div className="text-right">
                <p className="text-xs font-semibold text-green-400">{p.reward_per_block} {p.reward_token}/block</p>
                <p className="text-xs text-muted-foreground">{Number(p.total_staked).toFixed(2)} staked</p>
              </div>
            </div>
          </div>
        )) : <p className="text-xs text-muted-foreground text-center py-3">No staking pools available</p>}
      </div>

      <div className="border-t border-border pt-4 space-y-3">
        <h4 className="text-xs font-semibold text-muted-foreground">Stake Tokens</h4>
        <select value={stakeForm.poolId} onChange={f("poolId")} className="w-full bg-muted/30 border border-border rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-orange-500/50">
          <option value="">Select staking pool...</option>
          {Array.isArray(stakingPools) && stakingPools.map((p: { id: string; name: string }) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <input value={stakeForm.staker} onChange={f("staker")} placeholder="Your address" className="w-full bg-muted/30 border border-border rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-orange-500/50" />
        <input value={stakeForm.amount} onChange={f("amount")} type="number" placeholder="Amount to stake" className="w-full bg-muted/30 border border-border rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-orange-500/50" />
        <button onClick={() => stake.mutate()} disabled={stake.isPending || !stakeForm.poolId || !stakeForm.staker || !stakeForm.amount}
          className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-semibold py-2 rounded-lg text-sm transition-colors">
          {stake.isPending ? "Staking..." : "Stake"}
        </button>
      </div>
    </div>
  );
}

export default function DeFi() {
  const [tab, setTab] = useState<"swap" | "liquidity" | "staking" | "pools">("swap");
  const { data: pools } = useQuery({ queryKey: ["defi-pools"], queryFn: () => fetch(`${API}/defi/pools?limit=20`).then((r) => r.json()) });

  const totalLiquidity = Array.isArray(pools) ? pools.reduce((s: number, p: { reserve_a: number; reserve_b: number }) => s + Number(p.reserve_a) + Number(p.reserve_b), 0) : 0;
  const totalVolume = Array.isArray(pools) ? pools.reduce((s: number, p: { total_volume: number }) => s + Number(p.total_volume), 0) : 0;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">⚡ DeFi Protocol</h1>
        <p className="text-sm text-muted-foreground mt-1">AMM DEX, liquidity pools, and yield staking on IXCOIN</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Total Pools" value={Array.isArray(pools) ? pools.length : 0} icon="🏊" />
        <StatCard label="Total Liquidity" value={`${totalLiquidity.toFixed(2)} IXC`} icon="💧" />
        <StatCard label="Total Volume" value={`${totalVolume.toFixed(2)} IXC`} icon="📊" />
        <StatCard label="AMM Model" value="x·y=k" icon="📐" sub="Constant Product" />
      </div>

      <div className="flex gap-1 bg-muted/30 rounded-xl p-1">
        {(["swap", "liquidity", "staking", "pools"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 py-2 rounded-lg text-xs font-medium transition-colors ${tab === t ? "bg-orange-500 text-white" : "text-muted-foreground hover:text-foreground"}`}>
            {t === "swap" ? "⚡" : t === "liquidity" ? "💧" : t === "staking" ? "🌾" : "🏊"} {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === "swap" && <SwapPanel />}
      {tab === "liquidity" && <LiquidityPanel />}
      {tab === "staking" && <StakingPanel />}
      {tab === "pools" && (
        <div className="space-y-3">
          <h3 className="font-semibold text-sm text-muted-foreground">All Liquidity Pools</h3>
          {Array.isArray(pools) && pools.length > 0 ? pools.map((p: Parameters<typeof PoolCard>[0]["pool"]) => <PoolCard key={p.id} pool={p} />) : <p className="text-center text-xs text-muted-foreground py-8">No pools yet. Add liquidity to create the first pool!</p>}
        </div>
      )}
    </div>
  );
}
