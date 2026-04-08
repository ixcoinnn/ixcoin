import { useQuery } from "@tanstack/react-query";
import { useRoute, Link, useLocation } from "wouter";
import { api } from "@/lib/api";
import { useState } from "react";

function hashShort(h: string, n = 14) {
  if (!h) return "";
  return h.length > n * 2 + 3 ? `${h.slice(0, n)}...${h.slice(-8)}` : h;
}

function timeAgo(ts: number) {
  const diff = Date.now() - ts;
  if (diff < 60000) return `${Math.floor(diff / 1000)}s lalu`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m lalu`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}j lalu`;
  return new Date(ts).toLocaleString("id-ID");
}

function InfoRow({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-lg border border-border bg-card/50 p-3">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <div className="flex items-start justify-between gap-2">
        <p className={`text-xs break-all flex-1 ${mono ? "font-mono text-foreground" : "text-foreground"}`}>{value}</p>
        <button
          onClick={() => { navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
          className="text-xs text-orange-400 hover:text-orange-300 flex-shrink-0"
        >{copied ? "✓" : "📋"}</button>
      </div>
    </div>
  );
}

function BlockDetail({ height }: { height: number }) {
  const { data, isLoading } = useQuery({
    queryKey: ["block", height],
    queryFn: () => api.getBlock(height),
  });

  if (isLoading) return <div className="h-48 bg-muted rounded-xl animate-pulse" />;
  if (!data) return (
    <div className="rounded-xl border border-border bg-card p-8 text-center">
      <p className="text-muted-foreground">Block #{height} tidak ditemukan</p>
    </div>
  );
  const b = data as Record<string, unknown>;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Link href="/explorer"><span className="text-orange-400 hover:text-orange-300 text-sm cursor-pointer">← Explorer</span></Link>
        <span className="text-muted-foreground text-sm">/ Block #{String(b.height)}</span>
      </div>
      <div className="rounded-xl border border-orange-500/30 bg-orange-500/5 p-5">
        <h2 className="text-lg font-bold text-orange-400 mb-4">Block #{String(b.height)}</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <InfoRow label="Hash" value={String(b.hash)} />
          <InfoRow label="Previous Hash" value={String(b.previousHash)} />
          <InfoRow label="Merkle Root" value={String(b.merkleRoot)} />
          <InfoRow label="Miner" value={String(b.miner)} />
          <InfoRow label="Timestamp" value={new Date(Number(b.timestamp)).toLocaleString("id-ID")} mono={false} />
          <InfoRow label="Nonce" value={String(b.nonce)} />
          <InfoRow label="Difficulty" value={String(b.difficulty)} />
          <InfoRow label="Block Reward" value={`${Number(b.blockReward).toFixed(4)} IXC`} />
          <InfoRow label="Total Fees" value={`${Number(b.totalFees).toFixed(8)} IXC`} />
          <InfoRow label="Transaksi" value={String(b.txCount)} />
          <InfoRow label="Size" value={`${String(b.sizeBytes)} bytes`} />
        </div>
      </div>

      {Array.isArray(b.transactions) && b.transactions.length > 0 && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="p-4 border-b border-border flex justify-between">
            <h3 className="font-semibold text-sm">Transaksi ({(b.transactions as unknown[]).length})</h3>
          </div>
          <div className="divide-y divide-border">
            {(b.transactions as Record<string, unknown>[]).map((tx) => (
              <Link key={String(tx.id)} href={`/tx/${String(tx.id)}`}>
                <div className="px-4 py-3 hover:bg-muted/30 cursor-pointer transition-colors">
                  <div className="flex justify-between items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-mono text-muted-foreground truncate">{String(tx.id)}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {String(tx.from).slice(0, 14)}... → {String(tx.to).slice(0, 14)}...
                      </p>
                    </div>
                    <p className="text-sm font-mono text-emerald-400 font-bold flex-shrink-0">
                      {Number(tx.amount).toFixed(4)} IXC
                    </p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TxDetail({ id }: { id: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["tx", id],
    queryFn: () => api.getTx(id),
  });

  if (isLoading) return <div className="h-48 bg-muted rounded-xl animate-pulse" />;
  if (!data) return (
    <div className="rounded-xl border border-border bg-card p-8 text-center">
      <p className="text-muted-foreground">Transaksi tidak ditemukan</p>
    </div>
  );
  const t = data as Record<string, unknown>;

  const fromAddr = String(t.from_addr ?? t.from ?? "-");
  const toAddr = String(t.to_addr ?? t.to ?? "-");

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Link href="/explorer"><span className="text-orange-400 hover:text-orange-300 text-sm cursor-pointer">← Explorer</span></Link>
        <span className="text-muted-foreground text-sm">/ Transaksi</span>
      </div>
      <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 p-5">
        <div className="flex items-center gap-2 mb-4">
          <h2 className="text-lg font-bold text-blue-400">Transaksi</h2>
          <span className={`text-xs px-2 py-0.5 rounded-full border ${
            String(t.status) === "confirmed"
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
              : "border-yellow-500/40 bg-yellow-500/10 text-yellow-400"
          }`}>{String(t.status)}</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <InfoRow label="ID Transaksi" value={String(t.id)} />
          <InfoRow label="Block" value={String(t.block_height ?? t.blockHeight ?? "Pending")} />
          <InfoRow label="Dari (From)" value={fromAddr} />
          <InfoRow label="Ke (To)" value={toAddr} />
          <InfoRow label="Jumlah" value={`${Number(t.amount).toFixed(8)} IXC`} />
          <InfoRow label="Fee" value={`${Number(t.fee).toFixed(8)} IXC`} />
          <InfoRow label="Gas Price" value={String(t.gas_price ?? t.gasPrice ?? "-")} />
          <InfoRow label="Gas Used" value={String(t.gas_used ?? t.gasUsed ?? "-")} />
          <InfoRow label="Nonce" value={String(t.nonce ?? "0")} />
          <InfoRow label="Timestamp" value={new Date(Number(t.timestamp)).toLocaleString("id-ID")} mono={false} />
        </div>
      </div>

      <div className="flex gap-4">
        {fromAddr.startsWith("IX") && (
          <Link href={`/address/${fromAddr}`}>
            <span className="text-xs text-orange-400 hover:text-orange-300 cursor-pointer">Lihat pengirim →</span>
          </Link>
        )}
        {toAddr.startsWith("IX") && (
          <Link href={`/address/${toAddr}`}>
            <span className="text-xs text-orange-400 hover:text-orange-300 cursor-pointer">Lihat penerima →</span>
          </Link>
        )}
      </div>
    </div>
  );
}

function AddressDetail({ address }: { address: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["address", address],
    queryFn: () => api.getAddress(address),
  });

  if (isLoading) return <div className="h-48 bg-muted rounded-xl animate-pulse" />;
  if (!data) return (
    <div className="rounded-xl border border-border bg-card p-8 text-center">
      <p className="text-muted-foreground">Alamat tidak ditemukan</p>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Link href="/explorer"><span className="text-orange-400 hover:text-orange-300 text-sm cursor-pointer">← Explorer</span></Link>
        <span className="text-muted-foreground text-sm">/ Alamat</span>
      </div>

      <div className="rounded-xl border border-orange-500/30 bg-orange-500/5 p-5">
        <h2 className="text-lg font-bold text-orange-400 mb-4">Alamat IXC</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <div className="md:col-span-2"><InfoRow label="Alamat" value={data.address} /></div>
          <div className="rounded-lg border border-orange-500/30 bg-orange-500/5 p-3">
            <p className="text-xs text-muted-foreground mb-1">Saldo</p>
            <p className="font-mono text-orange-400 text-2xl font-bold">{data.balance.toFixed(8)} IXC</p>
          </div>
          <div className="rounded-lg border border-border bg-card/50 p-3">
            <p className="text-xs text-muted-foreground mb-1">Tersedia</p>
            <p className="font-mono text-foreground text-2xl font-bold">{data.available.toFixed(8)} IXC</p>
            {data.pendingOutflow > 0 && (
              <p className="text-xs text-yellow-500 mt-1">Pending: -{data.pendingOutflow.toFixed(4)}</p>
            )}
          </div>
          <InfoRow label="Total Transaksi" value={String(data.txCount)} />
          <InfoRow label="Nonce" value={String(data.nonce)} />
        </div>
      </div>

      {data.transactions.length > 0 && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="p-3 border-b border-border">
            <p className="text-sm font-semibold">Histori Transaksi</p>
          </div>
          <div className="divide-y divide-border max-h-96 overflow-y-auto">
            {data.transactions.map((tx) => (
              <Link key={tx.id} href={`/tx/${tx.id}`}>
                <div className="px-4 py-3 hover:bg-muted/30 cursor-pointer transition-colors">
                  <div className="flex justify-between items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-mono text-muted-foreground truncate">{tx.id.slice(0, 24)}...</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {tx.from_addr?.slice(0, 12)}... → {tx.to_addr?.slice(0, 12)}...
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0 ml-2">
                      <p className={`font-mono text-sm font-bold ${
                        tx.to_addr === data.address ? "text-emerald-400" : "text-red-400"
                      }`}>
                        {tx.to_addr === data.address ? "+" : "-"}{parseFloat(String(tx.amount)).toFixed(4)} IXC
                      </p>
                      <p className="text-xs text-muted-foreground">{tx.status}</p>
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function BlockList() {
  const { data, isLoading } = useQuery({
    queryKey: ["chain"],
    queryFn: () => api.getChain(50),
    refetchInterval: 8000,
  });

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="p-4 border-b border-border flex items-center justify-between">
        <h2 className="font-semibold">Semua Block ({data?.total ?? 0})</h2>
        {isLoading && <span className="text-xs text-muted-foreground animate-pulse">Memuat...</span>}
      </div>
      <div className="divide-y divide-border">
        <div className="px-4 py-2 bg-muted/20 grid grid-cols-12 gap-2 text-xs text-muted-foreground font-medium">
          <span className="col-span-1">Block</span>
          <span className="col-span-4">Hash</span>
          <span className="col-span-2 text-center">Txs</span>
          <span className="col-span-2 text-center">Waktu</span>
          <span className="col-span-3 text-right">Reward</span>
        </div>
        {data?.blocks?.map((b) => (
          <Link key={b.height} href={`/block/${b.height}`}>
            <div className="px-4 py-3 hover:bg-muted/30 cursor-pointer transition-colors grid grid-cols-12 gap-2 items-center">
              <span className="col-span-1 font-mono text-orange-400 font-bold text-sm">#{b.height}</span>
              <span className="col-span-4 font-mono text-xs text-muted-foreground truncate">{hashShort(b.hash)}</span>
              <span className="col-span-2 text-xs text-muted-foreground text-center">{b.tx_count}</span>
              <span className="col-span-2 text-xs text-muted-foreground text-center">{timeAgo(Number(b.timestamp))}</span>
              <span className="col-span-3 font-mono text-sm text-emerald-400 text-right font-semibold">{parseFloat(b.block_reward).toFixed(2)} IXC</span>
            </div>
          </Link>
        ))}
        {(!data?.blocks || data.blocks.length === 0) && !isLoading && (
          <div className="p-8 text-center text-muted-foreground">
            <p className="mb-2">Belum ada block.</p>
            <Link href="/mining"><span className="text-orange-400 hover:text-orange-300 text-sm cursor-pointer">Mulai Mining →</span></Link>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Explorer() {
  const [, blockParams] = useRoute("/block/:id");
  const [, txParams] = useRoute("/tx/:id");
  const [, addrParams] = useRoute("/address/:id");
  const [search, setSearch] = useState("");
  const [, navigate] = useLocation();

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = search.trim();
    if (!q) return;
    if (q.startsWith("IX")) navigate(`/address/${q}`);
    else if (!isNaN(Number(q))) navigate(`/block/${q}`);
    else navigate(`/tx/${q}`);
  };

  const isDetail = blockParams?.id || txParams?.id || addrParams?.id;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Block Explorer</h1>
      </div>

      <form onSubmit={handleSearch} className="flex gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Cari: block height, hash, tx ID, atau alamat IX..."
          className="flex-1 rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-orange-500"
        />
        <button
          type="submit"
          className="rounded-lg bg-orange-500 text-black font-semibold px-5 py-2.5 text-sm hover:bg-orange-400 transition-colors"
        >
          Cari
        </button>
      </form>

      {blockParams?.id ? (
        <BlockDetail height={Number(blockParams.id)} />
      ) : txParams?.id ? (
        <TxDetail id={txParams.id} />
      ) : addrParams?.id ? (
        <AddressDetail address={addrParams.id} />
      ) : (
        <BlockList />
      )}
    </div>
  );
}
