import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import {
  createWallet,
  restoreWallet,
  signTransaction,
  validateAddress,
  type WalletKeys,
} from "@/lib/signer";

interface ActiveWallet extends WalletKeys {
  balance: number;
  nonce: number;
}

function CopyButton({ text, label = "Salin" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="text-xs text-orange-400 hover:text-orange-300 transition-colors flex-shrink-0 font-medium"
    >
      {copied ? "✓ Tersalin!" : label}
    </button>
  );
}

function SecurityBadge() {
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30">
      <svg className="w-3 h-3 text-emerald-400" fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
      </svg>
      <span className="text-xs text-emerald-400 font-semibold">Kunci hanya di perangkat Anda</span>
    </div>
  );
}

function WalletCard({
  wallet,
  onSend,
  onRefresh,
}: {
  wallet: ActiveWallet;
  onSend: () => void;
  onRefresh: () => void;
}) {
  const [showKey, setShowKey] = useState(false);

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-orange-500/30 bg-gradient-to-br from-orange-500/10 via-amber-500/5 to-transparent p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <img src="/ixcoin-logo.jpg" alt="IXC" className="w-8 h-8 rounded-full object-cover" />
            <div>
              <p className="text-xs text-muted-foreground">IXCOIN Network</p>
              <p className="text-xs font-mono text-orange-400/70">
                {wallet.address.slice(0, 10)}...{wallet.address.slice(-6)}
              </p>
            </div>
          </div>
          <button
            onClick={onRefresh}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors p-1"
          >
            🔄
          </button>
        </div>

        <div className="text-center py-2">
          <p className="text-xs text-muted-foreground mb-1">Total Aset</p>
          <p className="text-4xl font-bold font-mono text-orange-400">
            {wallet.balance.toLocaleString("id-ID", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 8,
            })}
          </p>
          <p className="text-lg text-orange-400/70 font-semibold mt-0.5">IXC</p>
        </div>

        <div className="flex gap-2 mt-4">
          <button
            onClick={onSend}
            className="flex-1 rounded-xl bg-orange-500 text-black font-bold py-2.5 text-sm hover:bg-orange-400 transition-colors"
          >
            📤 Kirim
          </button>
          <button
            onClick={() => navigator.clipboard.writeText(wallet.address)}
            className="flex-1 rounded-xl border border-orange-500/40 text-orange-400 font-bold py-2.5 text-sm hover:bg-orange-500/10 transition-colors"
          >
            📋 Salin Alamat
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Info Dompet</p>
          <SecurityBadge />
        </div>

        <div className="rounded-lg border border-border bg-muted/20 p-3">
          <p className="text-xs text-muted-foreground mb-1">Alamat Publik</p>
          <div className="flex items-center justify-between gap-2">
            <p className="font-mono text-xs break-all flex-1 text-foreground">{wallet.address}</p>
            <CopyButton text={wallet.address} />
          </div>
        </div>

        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-red-300 font-semibold">🔐 Private Key</p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowKey(!showKey)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                {showKey ? "Sembunyikan" : "Tampilkan"}
              </button>
              <CopyButton text={wallet.privateKey} />
            </div>
          </div>
          {showKey ? (
            <p className="font-mono text-red-200 text-xs break-all">{wallet.privateKey}</p>
          ) : (
            <p className="font-mono text-red-400/50 text-xs tracking-widest">
              ••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••
            </p>
          )}
          <p className="text-xs text-red-400/60 mt-2">
            Private key hanya tersimpan di memori browser — tidak dikirim ke server manapun
          </p>
        </div>

        {wallet.mnemonic && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
            <p className="text-xs text-amber-300 font-semibold mb-2">
              📝 Frase 12 Kata — Simpan di tempat offline yang aman!
            </p>
            <div className="grid grid-cols-3 gap-1.5">
              {wallet.mnemonic.split(" ").map((word, i) => (
                <div
                  key={i}
                  className="flex items-center gap-1 rounded border border-amber-500/20 bg-amber-500/5 px-2 py-1"
                >
                  <span className="text-amber-600 text-xs w-4">{i + 1}.</span>
                  <span className="text-amber-200 font-mono text-xs font-semibold">{word}</span>
                </div>
              ))}
            </div>
            <CopyButton text={wallet.mnemonic} label="Salin Semua" />
          </div>
        )}

        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-lg border border-border bg-muted/20 p-2 text-center">
            <p className="text-muted-foreground">Nonce</p>
            <p className="font-mono font-bold">{wallet.nonce}</p>
          </div>
          <div className="rounded-lg border border-border bg-muted/20 p-2 text-center">
            <p className="text-muted-foreground">Jaringan</p>
            <p className="font-mono font-bold text-orange-400">IXCOIN</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function NewWalletTab({ onWalletCreated }: { onWalletCreated: (w: ActiveWallet) => void }) {
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState("");

  const handleCreate = async () => {
    setIsCreating(true);
    setError("");
    try {
      // Generate wallet entirely in browser — NO server call
      const keys = createWallet();
      const info = await api.getAddress(keys.address).catch(() => ({ balance: 0, nonce: 0 }));
      onWalletCreated({
        ...keys,
        balance: info.balance ?? 0,
        nonce: info.nonce ?? 0,
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="text-center py-4">
        <div className="w-16 h-16 rounded-full bg-orange-500/10 border border-orange-500/30 flex items-center justify-center text-3xl mx-auto mb-3">
          ✨
        </div>
        <h2 className="font-bold text-lg">Buat Dompet Baru</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Dibuat sepenuhnya di browser Anda — kunci tidak pernah meninggalkan perangkat
        </p>
      </div>

      <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
        <p className="text-emerald-300 text-xs font-semibold mb-1">🔒 100% Lokal di Perangkat Anda</p>
        <p className="text-emerald-400/80 text-xs">
          Private key dan frase 12 kata dibuat di browser menggunakan kriptografi secp256k1 standar.
          Server tidak pernah melihat kunci Anda.
        </p>
      </div>

      <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
        <p className="text-amber-300 text-xs font-semibold mb-1">⚠️ Penting</p>
        <p className="text-amber-400/80 text-xs">
          Setelah dompet dibuat, simpan 12 kata frase di tempat offline yang aman.
          Tidak ada cara memulihkannya jika hilang.
        </p>
      </div>

      <button
        onClick={handleCreate}
        disabled={isCreating}
        className="w-full rounded-xl bg-orange-500 text-black font-bold py-3.5 text-base hover:bg-orange-400 transition-colors disabled:opacity-50"
      >
        {isCreating ? "Membuat Dompet..." : "✨ Buat Dompet Baru"}
      </button>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}
    </div>
  );
}

function RestoreWalletTab({ onWalletRestored }: { onWalletRestored: (w: ActiveWallet) => void }) {
  const [mnemonic, setMnemonic] = useState("");
  const [isRestoring, setIsRestoring] = useState(false);
  const [error, setError] = useState("");
  const wordCount = mnemonic.trim() === "" ? 0 : mnemonic.trim().split(/\s+/).length;

  const handleRestore = async () => {
    setIsRestoring(true);
    setError("");
    try {
      // Restore wallet in browser — NO server call for key derivation
      const keys = restoreWallet(mnemonic);
      const info = await api.getAddress(keys.address).catch(() => ({ balance: 0, nonce: 0 }));
      onWalletRestored({
        ...keys,
        balance: info.balance ?? 0,
        nonce: info.nonce ?? 0,
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsRestoring(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="text-center py-4">
        <div className="w-16 h-16 rounded-full bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-3xl mx-auto mb-3">
          🔓
        </div>
        <h2 className="font-bold text-lg">Pulihkan Dompet</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Masukkan 12 kata frase — kunci diturunkan langsung di browser Anda
        </p>
      </div>

      <div>
        <div className="flex justify-between items-center mb-2">
          <label className="text-sm font-medium">Frase 12 Kata</label>
          <span
            className={`text-xs font-mono ${wordCount === 12 ? "text-emerald-400" : "text-muted-foreground"}`}
          >
            {wordCount}/12 kata
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2 mb-3">
          {Array.from({ length: 12 }, (_, i) => {
            const words = mnemonic.trim().split(/\s+/);
            return (
              <div
                key={i}
                className="flex items-center gap-1 rounded-lg border border-border bg-muted/20 px-2 py-1.5"
              >
                <span className="text-muted-foreground text-xs w-4 flex-shrink-0">{i + 1}.</span>
                <span
                  className={`font-mono text-xs font-semibold ${words[i] ? "text-foreground" : "text-muted-foreground/40"}`}
                >
                  {words[i] || "---"}
                </span>
              </div>
            );
          })}
        </div>
        <textarea
          value={mnemonic}
          onChange={(e) => setMnemonic(e.target.value)}
          placeholder="Ketik atau tempel 12 kata frase di sini, pisahkan dengan spasi..."
          rows={2}
          className="w-full rounded-lg border border-border bg-background px-4 py-3 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-orange-500 resize-none"
        />
        <p className="text-xs text-muted-foreground mt-1">
          Frase ini hanya digunakan di browser — tidak dikirim ke server
        </p>
      </div>

      <button
        onClick={handleRestore}
        disabled={isRestoring || wordCount < 12}
        className="w-full rounded-xl bg-orange-500 text-black font-bold py-3.5 text-base hover:bg-orange-400 transition-colors disabled:opacity-50"
      >
        {isRestoring ? "Memulihkan..." : "🔓 Buka Dompet"}
      </button>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}
    </div>
  );
}

function SendTab({
  wallet,
}: {
  wallet: ActiveWallet;
}) {
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [result, setResult] = useState<{ txId: string; fee: number } | null>(null);
  const [error, setError] = useState("");
  const [isSending, setIsSending] = useState(false);
  const qc = useQueryClient();

  const { data: gasData } = useQuery({
    queryKey: ["gas"],
    queryFn: api.getGasEstimate,
    refetchInterval: 15000,
  });

  const { data: addressData } = useQuery({
    queryKey: ["address", wallet.address],
    queryFn: () => api.getAddress(wallet.address),
    refetchInterval: 10000,
  });

  const currentNonce = addressData?.nonce ?? wallet.nonce;
  const fee = gasData?.fee ?? 0.00001;

  const toValid = validateAddress(to);
  const amtNum = parseFloat(amount);
  const canSend = toValid && amtNum > 0 && to !== wallet.address && !isSending;

  const handleSend = async () => {
    if (!canSend) return;
    setIsSending(true);
    setError("");
    setResult(null);

    try {
      // Sign transaction ENTIRELY in browser — private key never sent to server
      const signedTx = signTransaction(
        {
          from: wallet.address,
          to: to.trim(),
          amount: amtNum,
          fee,
          nonce: currentNonce,
          gasPrice: gasData?.gasPrice ?? 1,
        },
        wallet
      );

      // Send ONLY the signed payload — server verifies signature, never sees private key
      const resp = await api.sendSigned(signedTx);
      setResult({ txId: resp.txId, fee: signedTx.fee });
      setAmount("");
      setTo("");

      qc.invalidateQueries({ queryKey: ["stats"] });
      qc.invalidateQueries({ queryKey: ["mempool"] });
      qc.invalidateQueries({ queryKey: ["address", wallet.address] });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 flex items-center justify-between">
        <div>
          <p className="text-emerald-300 text-xs font-semibold">🔒 Penandatanganan Lokal</p>
          <p className="text-emerald-400/70 text-xs">Transaksi ditandatangani di browser Anda</p>
        </div>
        <div className="text-right">
          <p className="text-blue-300 text-xs">Estimasi fee</p>
          <p className="font-mono text-blue-300 text-xs font-bold">{fee.toFixed(6)} IXC</p>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-muted/20 p-3">
        <p className="text-xs text-muted-foreground mb-0.5">Dari</p>
        <p className="font-mono text-xs text-foreground break-all">{wallet.address}</p>
        <p className="text-xs text-muted-foreground mt-1">
          Saldo: <span className="font-mono text-orange-400 font-bold">{wallet.balance.toFixed(6)} IXC</span>
          {" · "}Nonce: <span className="font-mono">{currentNonce}</span>
        </p>
      </div>

      <div className="space-y-3">
        <div>
          <label className="text-sm font-medium mb-1.5 block">Ke (Alamat Tujuan)</label>
          <input
            value={to}
            onChange={(e) => setTo(e.target.value.trim())}
            placeholder="IXxxxxxxxxxxxxxxxxxx..."
            className={`w-full rounded-lg border bg-background px-4 py-2.5 text-sm font-mono focus:outline-none focus:ring-1 transition-colors ${
              to && !toValid
                ? "border-red-500/50 focus:ring-red-500"
                : to && toValid
                ? "border-emerald-500/50 focus:ring-emerald-500"
                : "border-border focus:ring-orange-500"
            }`}
          />
          {to && !toValid && (
            <p className="text-xs text-red-400 mt-1">Alamat IXCOIN tidak valid</p>
          )}
          {to === wallet.address && (
            <p className="text-xs text-red-400 mt-1">Tidak bisa mengirim ke alamat sendiri</p>
          )}
        </div>

        <div>
          <label className="text-sm font-medium mb-1.5 block">Jumlah IXC</label>
          <div className="relative">
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              step="0.00000001"
              min="0.00000001"
              className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-orange-500 pr-14"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-semibold">
              IXC
            </span>
          </div>
          {amtNum > 0 && (
            <p className="text-xs text-muted-foreground mt-1">
              Total keluar: <span className="font-mono">{(amtNum + fee).toFixed(8)} IXC</span>
            </p>
          )}
        </div>
      </div>

      <button
        onClick={handleSend}
        disabled={!canSend}
        className="w-full rounded-xl bg-orange-500 text-black font-bold py-3.5 text-base hover:bg-orange-400 transition-colors disabled:opacity-50"
      >
        {isSending ? "Menandatangani & Mengirim..." : "📤 Kirim IXC"}
      </button>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      {result && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-2xl">✅</span>
            <div>
              <p className="text-emerald-400 font-semibold">Transaksi Terkirim!</p>
              <p className="text-xs text-muted-foreground">Menunggu konfirmasi dari miner</p>
            </div>
          </div>
          <div className="rounded-lg border border-border bg-muted/20 p-3">
            <p className="text-xs text-muted-foreground mb-1">ID Transaksi</p>
            <div className="flex items-center justify-between gap-2">
              <p className="font-mono text-xs break-all flex-1">{result.txId}</p>
              <CopyButton text={result.txId} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Fee: {result.fee?.toFixed(8) ?? "0"} IXC · Cek status di Block Explorer
          </p>
        </div>
      )}
    </div>
  );
}

type Tab = "new" | "restore" | "send";

export default function WalletPage() {
  const [tab, setTab] = useState<Tab>("new");
  const [activeWallet, setActiveWallet] = useState<ActiveWallet | null>(null);
  const [showSend, setShowSend] = useState(false);

  const handleWalletReady = (w: ActiveWallet) => {
    setActiveWallet(w);
    setShowSend(false);
  };

  const { data: addressData, refetch } = useQuery({
    queryKey: ["address", activeWallet?.address ?? ""],
    queryFn: () => api.getAddress(activeWallet!.address),
    enabled: !!activeWallet?.address,
    refetchInterval: 15000,
  });

  useEffect(() => {
    if (addressData && activeWallet) {
      setActiveWallet((prev) =>
        prev ? { ...prev, balance: addressData.balance, nonce: addressData.nonce } : null
      );
    }
  }, [addressData]);

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: "new", label: "Buat Dompet", icon: "✨" },
    { id: "restore", label: "Pulihkan", icon: "🔓" },
    { id: "send", label: "Kirim IXC", icon: "📤" },
  ];

  return (
    <div className="max-w-lg mx-auto space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold">Dompet IXCOIN</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Buat, pulihkan, dan kirim IXC — kunci kriptografi hanya ada di perangkat Anda
          </p>
        </div>
        <SecurityBadge />
      </div>

      {activeWallet && !showSend ? (
        <div className="space-y-3">
          <WalletCard
            wallet={activeWallet}
            onSend={() => setShowSend(true)}
            onRefresh={() => refetch()}
          />
          <button
            onClick={() => {
              setActiveWallet(null);
              setShowSend(false);
            }}
            className="w-full text-xs text-muted-foreground hover:text-foreground py-2 transition-colors"
          >
            Keluar dari dompet ini
          </button>
        </div>
      ) : activeWallet && showSend ? (
        <div className="space-y-3">
          <button
            onClick={() => setShowSend(false)}
            className="flex items-center gap-1 text-sm text-orange-400 hover:text-orange-300 transition-colors"
          >
            ← Kembali ke dompet
          </button>
          <div className="rounded-xl border border-border bg-card p-5">
            <SendTab wallet={activeWallet} />
          </div>
        </div>
      ) : (
        <>
          <div className="flex gap-1 p-1 rounded-xl bg-muted/50 border border-border">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 px-2 rounded-lg text-sm font-medium transition-all ${
                  tab === t.id
                    ? "bg-orange-500 text-black shadow-sm"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                }`}
              >
                <span>{t.icon}</span>
                <span>{t.label}</span>
              </button>
            ))}
          </div>

          <div className="rounded-xl border border-border bg-card p-5">
            {tab === "new" && <NewWalletTab onWalletCreated={handleWalletReady} />}
            {tab === "restore" && <RestoreWalletTab onWalletRestored={handleWalletReady} />}
            {tab === "send" && !activeWallet && (
              <div className="text-center py-8 space-y-3">
                <div className="w-14 h-14 rounded-full bg-muted/30 flex items-center justify-center text-2xl mx-auto">🔐</div>
                <p className="text-sm text-muted-foreground">
                  Buat atau pulihkan dompet terlebih dahulu untuk mengirim IXC
                </p>
                <button
                  onClick={() => setTab("new")}
                  className="text-sm text-orange-400 hover:text-orange-300"
                >
                  Buat Dompet →
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
