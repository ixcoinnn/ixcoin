import { useState, useEffect } from "react";
import { api, type RWAToken, type RWATokenDetail, type TokenizeResult, type TransferRWAResult, type RWAHolding } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

const ASSET_TYPES = [
  { id: "real_estate", label: "Real Estate", icon: "🏠", desc: "Properti, tanah, gedung" },
  { id: "commodity", label: "Komoditas", icon: "🥇", desc: "Emas, perak, minyak, dll" },
  { id: "art", label: "Seni & Kolektibel", icon: "🎨", desc: "Lukisan, NFT fisik, koleksi" },
  { id: "vehicle", label: "Kendaraan", icon: "🚗", desc: "Mobil, kapal, pesawat" },
  { id: "securities", label: "Sekuritas", icon: "📊", desc: "Saham, obligasi, reksadana" },
  { id: "business", label: "Aset Bisnis", icon: "💼", desc: "Mesin, inventaris, IP" },
  { id: "infrastructure", label: "Infrastruktur", icon: "🏗️", desc: "Jembatan, jalan, utilitas" },
  { id: "other", label: "Lainnya", icon: "📦", desc: "Aset lain yang terverifikasi" },
];

function assetIcon(type: string) {
  return ASSET_TYPES.find((a) => a.id === type)?.icon ?? "📦";
}
function assetLabel(type: string) {
  return ASSET_TYPES.find((a) => a.id === type)?.label ?? type;
}

function fmt(n: number) {
  return n.toLocaleString("id-ID");
}
function fmtIdc(n: number) {
  return n > 0 ? `${fmt(n)} IXC` : "-";
}
function timeAgo(ms: number) {
  const diff = Date.now() - ms;
  if (diff < 60000) return "baru saja";
  if (diff < 3600000) return Math.floor(diff / 60000) + " mnt lalu";
  if (diff < 86400000) return Math.floor(diff / 3600000) + " jam lalu";
  return Math.floor(diff / 86400000) + " hari lalu";
}
function truncate(s: string, n = 20) {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

export default function RWA() {
  const { toast } = useToast();
  const [tab, setTab] = useState<"market" | "tokenize" | "portfolio" | "detail">("market");

  const [tokens, setTokens] = useState<RWAToken[]>([]);
  const [loadingTokens, setLoadingTokens] = useState(false);
  const [filterType, setFilterType] = useState("");

  const [selectedToken, setSelectedToken] = useState<RWATokenDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const [tokenizeForm, setTokenizeForm] = useState({
    name: "", symbol: "", assetType: "", description: "",
    location: "", totalSupply: "1000", valueIdc: "",
    documentHash: "", issuerAddress: "", privateKeyHex: "",
  });
  const [tokenizing, setTokenizing] = useState(false);
  const [tokenizeResult, setTokenizeResult] = useState<TokenizeResult | null>(null);

  const [transferForm, setTransferForm] = useState({
    tokenAddress: "", fromAddress: "", privateKeyHex: "",
    toAddress: "", amount: "", memo: "",
  });
  const [transferring, setTransferring] = useState(false);
  const [transferResult, setTransferResult] = useState<TransferRWAResult | null>(null);

  const [portfolioAddress, setPortfolioAddress] = useState("");
  const [holdings, setHoldings] = useState<RWAHolding[]>([]);
  const [loadingHoldings, setLoadingHoldings] = useState(false);

  useEffect(() => {
    loadTokens();
  }, [filterType]);

  async function loadTokens() {
    setLoadingTokens(true);
    try {
      const data = await api.getRWATokens(50, filterType || undefined);
      setTokens(data.tokens);
    } catch { /* silent */ } finally {
      setLoadingTokens(false);
    }
  }

  async function openDetail(address: string) {
    setLoadingDetail(true);
    setTab("detail");
    try {
      const data = await api.getRWAToken(address);
      setSelectedToken(data);
      setTransferForm((f) => ({ ...f, tokenAddress: address }));
    } catch {
      toast({ title: "Gagal", description: "Token tidak ditemukan", variant: "destructive" });
      setTab("market");
    } finally {
      setLoadingDetail(false);
    }
  }

  async function handleTokenize(e: React.FormEvent) {
    e.preventDefault();
    if (!tokenizeForm.name || !tokenizeForm.symbol || !tokenizeForm.assetType || !tokenizeForm.issuerAddress || !tokenizeForm.privateKeyHex) {
      toast({ title: "Field wajib", description: "Lengkapi semua field yang wajib diisi", variant: "destructive" });
      return;
    }
    setTokenizing(true);
    setTokenizeResult(null);
    try {
      const result = await api.tokenizeRWA({
        issuerAddress: tokenizeForm.issuerAddress,
        privateKeyHex: tokenizeForm.privateKeyHex,
        name: tokenizeForm.name,
        symbol: tokenizeForm.symbol,
        assetType: tokenizeForm.assetType,
        description: tokenizeForm.description,
        location: tokenizeForm.location,
        totalSupply: Number(tokenizeForm.totalSupply) || 1000,
        valueIdc: Number(tokenizeForm.valueIdc) || 0,
        documentHash: tokenizeForm.documentHash,
      });
      setTokenizeResult(result);
      toast({ title: "Tokenisasi berhasil!", description: result.tokenAddress });
      await loadTokens();
    } catch (err) {
      toast({ title: "Gagal tokenisasi", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setTokenizing(false);
    }
  }

  async function handleTransfer(e: React.FormEvent) {
    e.preventDefault();
    if (!transferForm.tokenAddress || !transferForm.fromAddress || !transferForm.toAddress || !transferForm.privateKeyHex || !transferForm.amount) {
      toast({ title: "Field wajib", description: "Lengkapi semua field", variant: "destructive" });
      return;
    }
    setTransferring(true);
    setTransferResult(null);
    try {
      const result = await api.transferRWA({
        tokenAddress: transferForm.tokenAddress,
        fromAddress: transferForm.fromAddress,
        toAddress: transferForm.toAddress,
        privateKeyHex: transferForm.privateKeyHex,
        amount: Number(transferForm.amount),
        memo: transferForm.memo,
      });
      setTransferResult(result);
      toast({ title: "Transfer berhasil!", description: result.message });
      if (selectedToken) openDetail(selectedToken.address);
    } catch (err) {
      toast({ title: "Transfer gagal", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setTransferring(false);
    }
  }

  async function loadPortfolio() {
    if (!portfolioAddress) return;
    setLoadingHoldings(true);
    setHoldings([]);
    try {
      const data = await api.getRWAHoldings(portfolioAddress);
      setHoldings(data.holdings);
    } catch {
      toast({ title: "Gagal", description: "Tidak bisa memuat portfolio", variant: "destructive" });
    } finally {
      setLoadingHoldings(false);
    }
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-12">
      <div className="border-b border-border pb-4">
        <div className="flex items-center gap-3 mb-1">
          <span className="text-3xl">🏛️</span>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Real World Asset (RWA)</h1>
            <p className="text-sm text-muted-foreground">Tokenisasi aset dunia nyata di atas blockchain IXCoin</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-border bg-card p-4 text-center">
          <p className="text-2xl font-bold text-orange-400">{tokens.length}</p>
          <p className="text-xs text-muted-foreground mt-1">Aset Terdaftar</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 text-center">
          <p className="text-2xl font-bold text-orange-400">
            {fmt(tokens.reduce((s, t) => s + t.valueIdc, 0))}
          </p>
          <p className="text-xs text-muted-foreground mt-1">Total Nilai (IXC)</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 text-center">
          <p className="text-2xl font-bold text-orange-400">
            {new Set(tokens.map((t) => t.assetType)).size}
          </p>
          <p className="text-xs text-muted-foreground mt-1">Jenis Aset</p>
        </div>
      </div>

      <div className="flex gap-1 border-b border-border flex-wrap">
        {(["market", "tokenize", "portfolio"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t
                ? "border-orange-400 text-orange-400"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t === "market" ? "Pasar Aset" : t === "tokenize" ? "Tokenisasi Aset" : "Portofolio"}
          </button>
        ))}
        {tab === "detail" && (
          <button className="px-4 py-2 text-sm font-medium border-b-2 border-orange-400 text-orange-400">
            Detail Aset
          </button>
        )}
      </div>

      {tab === "market" && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setFilterType("")}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors border ${
                filterType === ""
                  ? "bg-orange-500/15 border-orange-500/30 text-orange-400"
                  : "border-border text-muted-foreground hover:border-orange-500/20"
              }`}
            >
              Semua
            </button>
            {ASSET_TYPES.map((at) => (
              <button
                key={at.id}
                onClick={() => setFilterType(at.id)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors border ${
                  filterType === at.id
                    ? "bg-orange-500/15 border-orange-500/30 text-orange-400"
                    : "border-border text-muted-foreground hover:border-orange-500/20"
                }`}
              >
                {at.icon} {at.label}
              </button>
            ))}
          </div>

          {loadingTokens ? (
            <div className="text-center py-12 text-muted-foreground text-sm">Memuat aset...</div>
          ) : tokens.length === 0 ? (
            <div className="rounded-xl border border-border bg-muted/20 p-10 text-center">
              <p className="text-4xl mb-3">🏛️</p>
              <p className="text-muted-foreground text-sm mb-3">Belum ada aset yang ditokenisasi.</p>
              <button
                onClick={() => setTab("tokenize")}
                className="text-sm font-medium text-orange-400 hover:text-orange-300 transition-colors"
              >
                Tokenisasi aset pertama →
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {tokens.map((t) => (
                <div
                  key={t.address}
                  onClick={() => openDetail(t.address)}
                  className="rounded-xl border border-border bg-card p-4 hover:border-orange-500/40 cursor-pointer transition-all hover:shadow-lg hover:shadow-orange-500/5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-orange-500/10 border border-orange-500/20 flex items-center justify-center text-xl flex-shrink-0">
                        {assetIcon(t.assetType)}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="text-sm font-bold text-foreground">{t.name}</p>
                          <span className="text-xs px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-400 font-mono border border-orange-500/20">
                            {t.symbol}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{assetLabel(t.assetType)}</p>
                      </div>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full border flex-shrink-0 ${
                      t.status === "active"
                        ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                        : "bg-muted/20 text-muted-foreground border-border"
                    }`}>
                      {t.status === "active" ? "Aktif" : t.status}
                    </span>
                  </div>

                  {t.description && (
                    <p className="text-xs text-muted-foreground mt-2 line-clamp-2">{t.description}</p>
                  )}

                  <div className="mt-3 pt-3 border-t border-border/50 grid grid-cols-3 gap-2 text-center">
                    <div>
                      <p className="text-xs text-muted-foreground">Supply</p>
                      <p className="text-xs font-mono font-semibold text-foreground">{fmt(t.totalSupply)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Nilai</p>
                      <p className="text-xs font-mono font-semibold text-orange-400">{fmtIdc(t.valueIdc)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Diterbitkan</p>
                      <p className="text-xs text-muted-foreground">{timeAgo(t.createdAt)}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "tokenize" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1 space-y-2">
            <p className="text-sm font-semibold text-foreground mb-3">Pilih Jenis Aset</p>
            {ASSET_TYPES.map((at) => (
              <button
                key={at.id}
                onClick={() => setTokenizeForm((f) => ({ ...f, assetType: at.id }))}
                className={`w-full text-left rounded-lg border p-3 transition-colors ${
                  tokenizeForm.assetType === at.id
                    ? "border-orange-500/50 bg-orange-500/10"
                    : "border-border hover:border-orange-500/30 bg-card"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-lg">{at.icon}</span>
                  <div>
                    <p className="text-sm font-medium text-foreground">{at.label}</p>
                    <p className="text-xs text-muted-foreground">{at.desc}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>

          <div className="lg:col-span-2">
            <form onSubmit={handleTokenize} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Nama Aset *</label>
                  <input
                    className="w-full bg-muted/30 border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-orange-500/50"
                    placeholder="Gedung Sudirman Center..."
                    value={tokenizeForm.name}
                    onChange={(e) => setTokenizeForm((f) => ({ ...f, name: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Simbol Token *</label>
                  <input
                    className="w-full bg-muted/30 border border-border rounded-lg px-3 py-2 text-sm text-foreground font-mono uppercase placeholder:text-muted-foreground/50 focus:outline-none focus:border-orange-500/50"
                    placeholder="GDGSC"
                    maxLength={10}
                    value={tokenizeForm.symbol}
                    onChange={(e) => setTokenizeForm((f) => ({ ...f, symbol: e.target.value.toUpperCase() }))}
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Deskripsi Aset</label>
                <textarea
                  rows={3}
                  className="w-full bg-muted/30 border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-orange-500/50 resize-none"
                  placeholder="Deskripsi lengkap tentang aset..."
                  value={tokenizeForm.description}
                  onChange={(e) => setTokenizeForm((f) => ({ ...f, description: e.target.value }))}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Lokasi / Identifikasi</label>
                  <input
                    className="w-full bg-muted/30 border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-orange-500/50"
                    placeholder="Jakarta, Indonesia / No. Sertifikat..."
                    value={tokenizeForm.location}
                    onChange={(e) => setTokenizeForm((f) => ({ ...f, location: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Total Supply (unit token)</label>
                  <input
                    type="number"
                    min="1"
                    max="1000000000"
                    className="w-full bg-muted/30 border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-orange-500/50"
                    placeholder="1000"
                    value={tokenizeForm.totalSupply}
                    onChange={(e) => setTokenizeForm((f) => ({ ...f, totalSupply: e.target.value }))}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Nilai Estimasi (IXC)</label>
                  <input
                    type="number"
                    min="0"
                    className="w-full bg-muted/30 border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-orange-500/50"
                    placeholder="0"
                    value={tokenizeForm.valueIdc}
                    onChange={(e) => setTokenizeForm((f) => ({ ...f, valueIdc: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Hash Dokumen Legal (SHA256)</label>
                  <input
                    className="w-full bg-muted/30 border border-border rounded-lg px-3 py-2 text-sm text-foreground font-mono placeholder:text-muted-foreground/50 focus:outline-none focus:border-orange-500/50"
                    placeholder="sha256 dari dokumen..."
                    value={tokenizeForm.documentHash}
                    onChange={(e) => setTokenizeForm((f) => ({ ...f, documentHash: e.target.value }))}
                  />
                </div>
              </div>

              <div className="border-t border-border pt-3 space-y-3">
                <p className="text-xs font-semibold text-muted-foreground">Identitas Penerbit</p>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Alamat Wallet Penerbit *</label>
                  <input
                    className="w-full bg-muted/30 border border-border rounded-lg px-3 py-2 text-sm text-foreground font-mono placeholder:text-muted-foreground/50 focus:outline-none focus:border-orange-500/50"
                    placeholder="IX..."
                    value={tokenizeForm.issuerAddress}
                    onChange={(e) => setTokenizeForm((f) => ({ ...f, issuerAddress: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Private Key (Hex) *</label>
                  <input
                    type="password"
                    className="w-full bg-muted/30 border border-border rounded-lg px-3 py-2 text-sm text-foreground font-mono placeholder:text-muted-foreground/50 focus:outline-none focus:border-orange-500/50"
                    placeholder="Private key hex..."
                    value={tokenizeForm.privateKeyHex}
                    onChange={(e) => setTokenizeForm((f) => ({ ...f, privateKeyHex: e.target.value }))}
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={tokenizing || !tokenizeForm.assetType}
                className="w-full py-3 rounded-lg bg-orange-500 hover:bg-orange-400 disabled:opacity-50 text-white text-sm font-bold transition-colors"
              >
                {tokenizing ? "Memproses Tokenisasi..." : "🏛️ Tokenisasi Aset Sekarang"}
              </button>

              {!tokenizeForm.assetType && (
                <p className="text-xs text-center text-muted-foreground">Pilih jenis aset terlebih dahulu ←</p>
              )}
            </form>

            {tokenizeResult && (
              <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-5 space-y-3">
                <div className="flex items-center gap-2">
                  <span className="text-emerald-400 text-xl">✓</span>
                  <p className="text-sm font-bold text-emerald-400">Tokenisasi Berhasil!</p>
                </div>
                <div className="text-xs space-y-1.5">
                  <div className="flex gap-2">
                    <span className="text-muted-foreground w-28 flex-shrink-0">Alamat Token:</span>
                    <span className="font-mono text-foreground break-all">{tokenizeResult.tokenAddress}</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-muted-foreground w-28 flex-shrink-0">Simbol:</span>
                    <span className="font-mono font-bold text-orange-400">{tokenizeResult.symbol}</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-muted-foreground w-28 flex-shrink-0">Total Supply:</span>
                    <span className="text-foreground">{fmt(tokenizeResult.totalSupply)} unit</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-muted-foreground w-28 flex-shrink-0">TX Mint:</span>
                    <span className="font-mono text-foreground break-all">{tokenizeResult.mintTxId}</span>
                  </div>
                </div>
                <button
                  onClick={() => openDetail(tokenizeResult.tokenAddress)}
                  className="text-xs text-orange-400 hover:text-orange-300 transition-colors"
                >
                  Lihat detail & transfer token →
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === "portfolio" && (
        <div className="space-y-4">
          <div className="flex gap-2">
            <input
              className="flex-1 bg-muted/30 border border-border rounded-lg px-3 py-2 text-sm text-foreground font-mono placeholder:text-muted-foreground/50 focus:outline-none focus:border-orange-500/50"
              placeholder="Masukkan alamat wallet IX..."
              value={portfolioAddress}
              onChange={(e) => setPortfolioAddress(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && loadPortfolio()}
            />
            <button
              onClick={loadPortfolio}
              disabled={!portfolioAddress || loadingHoldings}
              className="px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-400 disabled:opacity-50 text-white text-sm font-semibold transition-colors"
            >
              {loadingHoldings ? "..." : "Cari"}
            </button>
          </div>

          {holdings.length === 0 && portfolioAddress && !loadingHoldings && (
            <div className="rounded-xl border border-border bg-muted/20 p-8 text-center">
              <p className="text-muted-foreground text-sm">Alamat ini belum memiliki token RWA.</p>
            </div>
          )}

          {holdings.length > 0 && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">{holdings.length} token RWA dimiliki</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {holdings.map((h) => (
                  <div
                    key={h.tokenAddress}
                    onClick={() => openDetail(h.tokenAddress)}
                    className="rounded-xl border border-border bg-card p-4 hover:border-orange-500/40 cursor-pointer transition-colors"
                  >
                    <div className="flex items-center gap-3 mb-3">
                      <span className="text-2xl">{assetIcon(h.assetType)}</span>
                      <div>
                        <div className="flex items-center gap-1.5">
                          <p className="text-sm font-bold text-foreground">{h.name}</p>
                          <span className="text-xs px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-400 font-mono border border-orange-500/20">
                            {h.symbol}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">{assetLabel(h.assetType)}</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-center">
                      <div className="rounded-lg bg-muted/20 p-2">
                        <p className="text-xs text-muted-foreground">Dimiliki</p>
                        <p className="text-sm font-bold text-orange-400">{fmt(h.amount)}</p>
                      </div>
                      <div className="rounded-lg bg-muted/20 p-2">
                        <p className="text-xs text-muted-foreground">Nilai Est.</p>
                        <p className="text-sm font-bold text-foreground">{fmtIdc(h.valueIdc)}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === "detail" && (
        <div className="space-y-5">
          <button
            onClick={() => setTab("market")}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
          >
            ← Kembali ke pasar
          </button>

          {loadingDetail && (
            <div className="text-center py-12 text-muted-foreground text-sm">Memuat detail...</div>
          )}

          {selectedToken && !loadingDetail && (
            <div className="space-y-5">
              <div className="rounded-xl border border-border bg-card p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 rounded-xl bg-orange-500/10 border border-orange-500/20 flex items-center justify-center text-3xl">
                      {assetIcon(selectedToken.assetType)}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h2 className="text-xl font-bold text-foreground">{selectedToken.name}</h2>
                        <span className="px-2 py-0.5 rounded bg-orange-500/10 text-orange-400 font-mono text-sm border border-orange-500/20">
                          {selectedToken.symbol}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground">{assetLabel(selectedToken.assetType)}</p>
                      <p className="text-xs font-mono text-muted-foreground mt-1 break-all">{selectedToken.address}</p>
                    </div>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full border flex-shrink-0 ${
                    selectedToken.status === "active"
                      ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                      : "bg-muted/20 text-muted-foreground border-border"
                  }`}>
                    {selectedToken.status === "active" ? "Aktif" : selectedToken.status}
                  </span>
                </div>

                {selectedToken.description && (
                  <p className="text-sm text-muted-foreground mt-4">{selectedToken.description}</p>
                )}

                <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="rounded-lg bg-muted/20 p-3 text-center">
                    <p className="text-xs text-muted-foreground">Total Supply</p>
                    <p className="text-sm font-bold text-foreground mt-1">{fmt(selectedToken.totalSupply)}</p>
                  </div>
                  <div className="rounded-lg bg-muted/20 p-3 text-center">
                    <p className="text-xs text-muted-foreground">Nilai Estimasi</p>
                    <p className="text-sm font-bold text-orange-400 mt-1">{fmtIdc(selectedToken.valueIdc)}</p>
                  </div>
                  <div className="rounded-lg bg-muted/20 p-3 text-center">
                    <p className="text-xs text-muted-foreground">Pemegang</p>
                    <p className="text-sm font-bold text-foreground mt-1">{selectedToken.holders.length}</p>
                  </div>
                  <div className="rounded-lg bg-muted/20 p-3 text-center">
                    <p className="text-xs text-muted-foreground">Diterbitkan</p>
                    <p className="text-sm font-bold text-foreground mt-1">{timeAgo(selectedToken.createdAt)}</p>
                  </div>
                </div>

                <div className="mt-3 pt-3 border-t border-border/50 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-muted-foreground">
                  <div>Penerbit: <span className="font-mono text-foreground">{truncate(selectedToken.issuer, 28)}</span></div>
                  {selectedToken.location && <div>Lokasi: <span className="text-foreground">{selectedToken.location}</span></div>}
                  {selectedToken.documentHash && <div>Doc Hash: <span className="font-mono text-foreground">{truncate(selectedToken.documentHash, 20)}</span></div>}
                  {selectedToken.mintTx && <div>Mint TX: <span className="font-mono text-foreground">{truncate(selectedToken.mintTx, 20)}</span></div>}
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <div className="space-y-4">
                  {selectedToken.holders.length > 0 && (
                    <div className="rounded-xl border border-border bg-card p-4">
                      <p className="text-sm font-semibold text-foreground mb-3">Pemegang Token</p>
                      <div className="space-y-2">
                        {selectedToken.holders.map((h, i) => (
                          <div key={h.address} className="flex items-center justify-between text-xs">
                            <div className="flex items-center gap-2">
                              <span className="text-muted-foreground w-4">#{i + 1}</span>
                              <span className="font-mono text-muted-foreground">{truncate(h.address, 22)}</span>
                            </div>
                            <span className="font-semibold text-orange-400">{fmt(h.amount)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {selectedToken.recentTransfers.length > 0 && (
                    <div className="rounded-xl border border-border bg-card p-4">
                      <p className="text-sm font-semibold text-foreground mb-3">Transfer Terakhir</p>
                      <div className="space-y-2">
                        {selectedToken.recentTransfers.map((t) => (
                          <div key={t.id} className="rounded-lg bg-muted/20 p-2.5 text-xs">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-orange-400 font-semibold">+{fmt(t.amount)} {selectedToken.symbol}</span>
                              <span className="text-muted-foreground">{timeAgo(t.createdAt)}</span>
                            </div>
                            <div className="text-muted-foreground">
                              <span className="font-mono">{truncate(t.from, 16)}</span>
                              <span className="mx-1">→</span>
                              <span className="font-mono">{truncate(t.to, 16)}</span>
                            </div>
                            {t.memo && <p className="text-muted-foreground/70 mt-1 italic">"{t.memo}"</p>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="rounded-xl border border-border bg-card p-4">
                  <p className="text-sm font-semibold text-foreground mb-4">Transfer Token</p>
                  <form onSubmit={handleTransfer} className="space-y-3">
                    <div>
                      <label className="text-xs font-medium text-muted-foreground mb-1 block">Dari Alamat</label>
                      <input
                        className="w-full bg-muted/30 border border-border rounded-lg px-3 py-2 text-sm text-foreground font-mono placeholder:text-muted-foreground/50 focus:outline-none focus:border-orange-500/50"
                        placeholder="IX..."
                        value={transferForm.fromAddress}
                        onChange={(e) => setTransferForm((f) => ({ ...f, fromAddress: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground mb-1 block">Private Key (Hex)</label>
                      <input
                        type="password"
                        className="w-full bg-muted/30 border border-border rounded-lg px-3 py-2 text-sm text-foreground font-mono placeholder:text-muted-foreground/50 focus:outline-none focus:border-orange-500/50"
                        placeholder="Private key hex..."
                        value={transferForm.privateKeyHex}
                        onChange={(e) => setTransferForm((f) => ({ ...f, privateKeyHex: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground mb-1 block">Ke Alamat</label>
                      <input
                        className="w-full bg-muted/30 border border-border rounded-lg px-3 py-2 text-sm text-foreground font-mono placeholder:text-muted-foreground/50 focus:outline-none focus:border-orange-500/50"
                        placeholder="IX..."
                        value={transferForm.toAddress}
                        onChange={(e) => setTransferForm((f) => ({ ...f, toAddress: e.target.value }))}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-xs font-medium text-muted-foreground mb-1 block">Jumlah</label>
                        <input
                          type="number"
                          min="1"
                          className="w-full bg-muted/30 border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-orange-500/50"
                          placeholder="100"
                          value={transferForm.amount}
                          onChange={(e) => setTransferForm((f) => ({ ...f, amount: e.target.value }))}
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-muted-foreground mb-1 block">Memo (opsional)</label>
                        <input
                          className="w-full bg-muted/30 border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-orange-500/50"
                          placeholder="Catatan..."
                          value={transferForm.memo}
                          onChange={(e) => setTransferForm((f) => ({ ...f, memo: e.target.value }))}
                        />
                      </div>
                    </div>
                    <button
                      type="submit"
                      disabled={transferring}
                      className="w-full py-2.5 rounded-lg bg-orange-500 hover:bg-orange-400 disabled:opacity-50 text-white text-sm font-bold transition-colors"
                    >
                      {transferring ? "Memproses..." : `Transfer ${selectedToken.symbol}`}
                    </button>
                  </form>

                  {transferResult && (
                    <div className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs space-y-1">
                      <p className="text-emerald-400 font-semibold">Transfer berhasil!</p>
                      <p className="text-muted-foreground">TX: <span className="font-mono text-foreground break-all">{transferResult.txId}</span></p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="rounded-xl border border-orange-500/20 bg-orange-500/5 p-4">
        <p className="text-xs font-semibold text-orange-400 mb-2">Cara Kerja RWA di IXCoin:</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs text-muted-foreground">
          <div className="flex gap-2"><span className="text-orange-400 font-bold">1.</span><span>Aset dunia nyata didaftarkan dan diverifikasi</span></div>
          <div className="flex gap-2"><span className="text-orange-400 font-bold">2.</span><span>Token digital diterbitkan mewakili kepemilikan aset</span></div>
          <div className="flex gap-2"><span className="text-orange-400 font-bold">3.</span><span>Token bisa ditransfer antar wallet di blockchain IXCoin</span></div>
          <div className="flex gap-2"><span className="text-orange-400 font-bold">4.</span><span>Kepemilikan fraksional memungkinkan investasi lebih mudah</span></div>
        </div>
      </div>
    </div>
  );
}
