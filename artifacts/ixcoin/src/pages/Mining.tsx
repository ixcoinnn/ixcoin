import { useState, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export default function Mining() {
  const [minerAddr, setMinerAddr] = useState("");
  const [mineLog, setMineLog] = useState<string[]>([]);
  const [autoMine, setAutoMine] = useState(false);
  const autoRef = useRef(false);
  const qc = useQueryClient();

  const { data: gasData } = useQuery({
    queryKey: ["gas"],
    queryFn: api.getGasEstimate,
    refetchInterval: 10000,
  });

  const { data: mempool } = useQuery({
    queryKey: ["mempool"],
    queryFn: api.getMempool,
    refetchInterval: 5000,
  });

  const { data: stats } = useQuery({
    queryKey: ["stats"],
    queryFn: api.getStats,
    refetchInterval: 10000,
  });

  const mineMut = useMutation({
    mutationFn: () => api.mine(minerAddr),
    onSuccess: (result) => {
      const b = result.block;
      const msg = `✅ Block #${b.height} | Hash: ${b.hash?.slice(0, 16)}... | Nonce: ${b.nonce} | Reward: ${b.reward.toFixed(2)} IXC + ${b.fees.toFixed(4)} fee`;
      setMineLog(prev => [msg, ...prev.slice(0, 49)]);
      qc.invalidateQueries({ queryKey: ["stats"] });
      qc.invalidateQueries({ queryKey: ["chain"] });
      qc.invalidateQueries({ queryKey: ["mempool"] });

      if (autoRef.current) {
        setMineLog(prev => ["⛏️ Auto-mining next block...", ...prev]);
        setTimeout(() => {
          if (autoRef.current) mineMut.mutate();
        }, 500);
      }
    },
    onError: (err: Error) => {
      setMineLog(prev => [`❌ Error: ${err.message}`, ...prev]);
      autoRef.current = false;
      setAutoMine(false);
    },
  });

  const startAutoMine = () => {
    if (!minerAddr.startsWith("IX")) return;
    autoRef.current = true;
    setAutoMine(true);
    setMineLog(prev => ["🚀 Auto-mining dimulai...", ...prev]);
    mineMut.mutate();
  };

  const stopAutoMine = () => {
    autoRef.current = false;
    setAutoMine(false);
    setMineLog(prev => ["⏹️ Auto-mining dihentikan.", ...prev]);
  };

  const nextReward = stats?.blockReward ?? 12.5;
  const nextHeight = (stats?.height ?? 0) + 1;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Mining IXCOIN</h1>
        {autoMine && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-yellow-500/40 bg-yellow-500/10">
            <span className="w-2 h-2 rounded-full bg-yellow-400 mining-pulse"></span>
            <span className="text-yellow-400 text-xs font-semibold">Mining...</span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/5 p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Block Reward</p>
          <p className="text-2xl font-bold font-mono text-yellow-400">{nextReward.toFixed(2)} IXC</p>
          <p className="text-xs text-muted-foreground">Block #{nextHeight}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Difficulty</p>
          <p className="text-2xl font-bold font-mono">{stats?.difficulty ?? 3}</p>
          <p className="text-xs text-muted-foreground">Leading zeros</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Mempool</p>
          <p className="text-2xl font-bold font-mono">{mempool?.count ?? 0}</p>
          <p className="text-xs text-muted-foreground">Pending txs</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Base Fee</p>
          <p className="text-2xl font-bold font-mono">{gasData?.baseFee?.toFixed(2) ?? "1"}</p>
          <p className="text-xs text-muted-foreground">Gas per unit</p>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-6 space-y-4">
        <h2 className="font-semibold">Konfigurasi Miner</h2>

        <div>
          <label className="text-sm text-muted-foreground mb-2 block">Alamat Penerima Reward</label>
          <input
            value={minerAddr}
            onChange={(e) => setMinerAddr(e.target.value)}
            placeholder="IXxxxxxxxxxxxxxxxxxx... (alamat dompet Anda)"
            className="w-full rounded-lg border border-border bg-background px-4 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-yellow-500"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Reward sebesar {nextReward.toFixed(2)} IXC + fee akan dikirim ke alamat ini
          </p>
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => mineMut.mutate()}
            disabled={mineMut.isPending || !minerAddr.startsWith("IX") || autoMine}
            className="flex-1 rounded-lg bg-yellow-500 text-black font-bold py-3 hover:bg-yellow-400 transition-colors disabled:opacity-50"
          >
            {mineMut.isPending && !autoMine ? "⛏️ Mining..." : "⛏️ Mine 1 Block"}
          </button>

          {!autoMine ? (
            <button
              onClick={startAutoMine}
              disabled={!minerAddr.startsWith("IX") || mineMut.isPending}
              className="flex-1 rounded-lg border-2 border-yellow-500 text-yellow-400 font-bold py-3 hover:bg-yellow-500/10 transition-colors disabled:opacity-50"
            >
              🔄 Auto Mine
            </button>
          ) : (
            <button
              onClick={stopAutoMine}
              className="flex-1 rounded-lg bg-red-500/20 border border-red-500/40 text-red-400 font-bold py-3 hover:bg-red-500/30 transition-colors"
            >
              ⏹️ Stop
            </button>
          )}
        </div>

        {mempool && mempool.count > 0 && (
          <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3">
            <p className="text-xs text-blue-400">
              {mempool.count} transaksi pending di mempool — mine block untuk konfirmasi dan dapatkan fee {mempool.totalFees.toFixed(4)} IXC tambahan!
            </p>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-border bg-card p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="font-semibold">Mining Log</h2>
          {mineLog.length > 0 && (
            <button onClick={() => setMineLog([])} className="text-xs text-muted-foreground hover:text-foreground">
              Bersihkan
            </button>
          )}
        </div>

        {mineLog.length === 0 ? (
          <div className="h-32 flex items-center justify-center rounded-lg border border-dashed border-border">
            <p className="text-muted-foreground text-sm">Log mining akan muncul di sini...</p>
          </div>
        ) : (
          <div className="bg-black/40 rounded-lg border border-border p-4 max-h-64 overflow-y-auto space-y-1">
            {mineLog.map((line, i) => (
              <p key={i} className="font-mono text-xs text-green-400 leading-relaxed">{line}</p>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-border bg-card p-6">
        <h2 className="font-semibold mb-1">IXCOIN Halving Schedule</h2>
        <p className="text-xs text-muted-foreground mb-4">
          Block reward halves every <strong className="text-foreground">200,000 blocks</strong> (~1.9 years at 5-min block time)
        </p>
        <div className="space-y-3">
          {[
            { era: 1, start: 1, end: 200_000, period: "~1.9 years", reward: "12.5 IXC" },
            { era: 2, start: 200_001, end: 400_000, period: "~1.9 years", reward: "6.25 IXC" },
            { era: 3, start: 400_001, end: 600_000, period: "~1.9 years", reward: "3.125 IXC" },
            { era: 4, start: 600_001, end: 800_000, period: "~1.9 years", reward: "1.5625 IXC" },
            { era: 5, start: 800_001, end: 1_000_000, period: "~1.9 years", reward: "0.78125 IXC" },
          ].map((row) => {
            const h = stats?.height ?? 0;
            const active = h >= row.start && h <= row.end;
            return (
              <div key={row.era} className={`flex items-center gap-4 rounded-lg p-3 border ${
                active ? "border-yellow-500/40 bg-yellow-500/5" : "border-border bg-muted/20"
              }`}>
                <span className={`text-xs font-mono font-bold w-10 flex-shrink-0 ${active ? "text-yellow-400" : "text-muted-foreground"}`}>
                  Era {row.era}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-mono text-muted-foreground truncate">
                    {row.start.toLocaleString()} – {row.end.toLocaleString()}
                  </p>
                  <p className="text-xs text-muted-foreground/60">{row.period}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className={`text-sm font-mono font-bold ${active ? "text-yellow-300" : "text-foreground"}`}>{row.reward}</span>
                  {active && <span className="text-xs bg-yellow-500/20 text-yellow-400 px-1.5 py-0.5 rounded font-semibold">ACTIVE</span>}
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground mt-3">
          Mining supply: 10,000,000 IXC · biaya pengembangan Devolever: 11,000,000 IXC · Max: 21,000,000 IXC · Block time: 5 min
        </p>
      </div>
    </div>
  );
}
