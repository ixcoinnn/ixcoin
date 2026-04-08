import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useState } from "react";

export default function Genesis() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["genesis-wallet"],
    queryFn: api.getGenesisWallet,
  });

  const [copied, setCopied] = useState(false);

  const copy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div className="rounded-xl border border-yellow-500/50 bg-yellow-500/5 p-6">
        <div className="flex items-center gap-3 mb-6">
          <img src="/ixcoin-logo.jpg" alt="IXCOIN" className="w-12 h-12 rounded-full object-cover" />
          <div>
            <h1 className="text-xl font-bold text-yellow-400">Genesis Wallet</h1>
            <p className="text-sm text-yellow-500/80">Dompet Biaya Pengembangan — {(13_000_000).toLocaleString()} IXC</p>
          </div>
        </div>

        {isLoading && (
          <div className="space-y-3">
            <div className="h-12 bg-muted rounded animate-pulse" />
            <div className="h-20 bg-muted rounded animate-pulse" />
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-4">
            <p className="text-red-400 text-sm">Gagal memuat genesis wallet. Pastikan server berjalan.</p>
          </div>
        )}

        {data && (
          <div className="space-y-5">
            <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-4">
              <div className="flex gap-2 items-start">
                <span className="text-green-400 text-lg flex-shrink-0">✅</span>
                <div>
                  <p className="text-green-300 font-semibold text-sm">Dompet Genesis Aktif</p>
                  <p className="text-green-400/80 text-xs mt-1">
                    Genesis wallet berhasil dibuat. Mnemonic phrase Anda telah tersimpan secara pribadi. 
                    Gunakan 12 kata kunci yang telah Anda salin untuk mengakses dompet ini.
                  </p>
                </div>
              </div>
            </div>

            <div>
              <div className="flex justify-between items-center mb-2">
                <p className="text-sm font-semibold text-yellow-300">Alamat Dompet Publik</p>
                <button
                  onClick={() => copy(data.address)}
                  className="text-xs text-yellow-400 hover:text-yellow-300 transition-colors"
                >
                  {copied ? "✓ Tersalin!" : "Salin"}
                </button>
              </div>
              <div className="rounded-lg border border-yellow-500/30 bg-black/30 p-3">
                <p className="font-mono text-yellow-300 text-sm break-all">{data.address}</p>
              </div>
              <p className="text-xs text-muted-foreground mt-1">Alamat ini aman untuk dibagikan kepada siapapun</p>
            </div>

            <div>
              <p className="text-sm font-semibold text-yellow-300 mb-2">Saldo</p>
              <div className="rounded-lg border border-yellow-500/30 bg-black/30 p-4">
                <p className="font-mono text-yellow-400 text-3xl font-bold">
                  {Number(data.balance).toLocaleString()} <span className="text-xl">IXC</span>
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Biaya Pengembangan — {((Number(data.balance) / 21_000_000) * 100).toFixed(2)}% dari total supply
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
              <p className="text-amber-300 font-semibold text-sm mb-3">🔐 Keamanan Dompet</p>
              <ul className="text-amber-400/80 text-xs space-y-2">
                <li className="flex gap-2"><span>•</span><span>Mnemonic phrase Anda <strong>tidak ditampilkan di sini</strong> untuk keamanan</span></li>
                <li className="flex gap-2"><span>•</span><span>Gunakan 12 kata kunci yang sudah Anda catat untuk restore dompet ini di halaman Wallet</span></li>
                <li className="flex gap-2"><span>•</span><span>Simpan mnemonic di tempat offline yang aman — tidak ada cara lain untuk memulihkannya</span></li>
                <li className="flex gap-2"><span>•</span><span>Jangan pernah bagikan mnemonic atau private key kepada siapapun</span></li>
              </ul>
            </div>

            <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 p-4">
              <p className="text-blue-300 font-semibold text-sm mb-3">Cara Menggunakan Dompet Genesis</p>
              <ol className="text-blue-400/80 text-xs space-y-2 list-decimal list-inside">
                <li>Pergi ke halaman <strong>Wallet</strong> di menu navigasi</li>
                <li>Klik tab <strong>"Restore Wallet"</strong></li>
                <li>Masukkan 12 kata kunci mnemonic Anda (urutan harus tepat)</li>
                <li>Dapatkan akses ke saldo {(13_000_000).toLocaleString()} IXC Anda</li>
                <li>Gunakan private key yang ditampilkan untuk mengirim transaksi</li>
              </ol>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
