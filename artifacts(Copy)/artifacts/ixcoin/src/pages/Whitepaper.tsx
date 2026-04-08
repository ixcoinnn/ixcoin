export default function Whitepaper() {
  return (
    <div className="max-w-3xl mx-auto space-y-8 pb-12">
      <div className="border-b border-border pb-6">
        <h1 className="text-3xl font-bold text-foreground mb-2">IXCoin Whitepaper</h1>
        <p className="text-muted-foreground text-sm">Version 1.0 · 2025</p>
      </div>

      <Section title="Abstract">
        <p>
          IXCoin adalah mata uang kripto berbasis teknologi blockchain Layer 1 Proof of Work (PoW)
          dengan algoritma SHA-256 yang mengintegrasikan sistem transaksi, mining, Virtual Machine
          (IXVM), serta platform token dalam satu ekosistem.
        </p>
        <p className="mt-3">
          IXCoin dirancang untuk menggabungkan keamanan model seperti Bitcoin, fleksibilitas
          komputasi seperti Ethereum, dan transaksi cepat serta biaya rendah seperti Solana.
        </p>
      </Section>

      <Section title="1. Introduction">
        <p>
          Blockchain tradisional seperti Bitcoin fokus pada keamanan dan transfer nilai, sementara
          platform seperti Ethereum menambahkan kemampuan komputasi melalui smart contract, dan
          Solana menawarkan transaksi cepat serta biaya rendah.
        </p>
        <p className="mt-3">IXCoin bertujuan menggabungkan ketiga pendekatan tersebut dalam satu sistem:</p>
        <ul className="list-disc list-inside mt-2 space-y-1 text-sm">
          <li>Keamanan melalui Proof of Work (PoW)</li>
          <li>Fleksibilitas melalui IXCoin Virtual Machine (IXVM)</li>
          <li>Ekosistem melalui token system</li>
        </ul>
      </Section>

      <Section title="2. System Architecture">
        <SubSection title="2.1 Node Architecture">
          <p>Setiap node dalam jaringan IXCoin bertanggung jawab untuk:</p>
          <ul className="list-disc list-inside mt-2 space-y-1 text-sm">
            <li>Menyimpan blockchain</li>
            <li>Memvalidasi transaksi</li>
            <li>Menjalankan IXVM</li>
            <li>Berpartisipasi dalam mining</li>
          </ul>
        </SubSection>
        <SubSection title="2.2 Network Model (Future P2P)">
          <ul className="list-disc list-inside mt-2 space-y-1 text-sm">
            <li>Peer-to-peer communication</li>
            <li>Block propagation</li>
            <li>Transaction broadcast</li>
            <li>Chain synchronization</li>
          </ul>
        </SubSection>
      </Section>

      <Section title="3. Blockchain Data Structure">
        <p>Setiap block terdiri dari:</p>
        <ul className="list-disc list-inside mt-2 space-y-1 text-sm">
          <li>Block Index</li>
          <li>Timestamp</li>
          <li>Transaction List</li>
          <li>Previous Block Hash</li>
          <li>Nonce</li>
          <li>Current Hash</li>
        </ul>
        <SubSection title="Hash Function">
          <p>
            Menggunakan <strong className="text-foreground">SHA-256</strong>:
          </p>
          <ul className="list-disc list-inside mt-2 space-y-1 text-sm">
            <li>Deterministic</li>
            <li>Collision-resistant</li>
            <li>One-way function</li>
          </ul>
        </SubSection>
      </Section>

      <Section title="4. Consensus Mechanism">
        <p>
          IXCoin menggunakan <strong className="text-foreground">Proof of Work (PoW)</strong> sebagai mekanisme
          konsensus.
        </p>
        <SubSection title="Mining Process">
          <ol className="list-decimal list-inside mt-2 space-y-1 text-sm">
            <li>Mengumpulkan transaksi dari mempool</li>
            <li>Menyusun block kandidat</li>
            <li>Mencari nonce sehingga hash memenuhi difficulty</li>
            <li>Broadcast block ke network</li>
          </ol>
        </SubSection>
        <SubSection title="Difficulty Adjustment">
          <p>
            Menyesuaikan tingkat kesulitan secara dinamis untuk menjaga stabilitas waktu block.
          </p>
        </SubSection>
        <SubSection title="Chain Rule">
          <p>
            Longest chain (atau chain dengan cumulative work terbesar) dianggap valid.
          </p>
        </SubSection>
      </Section>

      <Section title="5. Transaction Model">
        <SubSection title="Struktur Transaksi">
          <ul className="list-disc list-inside mt-2 space-y-1 text-sm">
            <li>Sender address</li>
            <li>Receiver address</li>
            <li>Amount</li>
            <li>Signature</li>
          </ul>
        </SubSection>
        <SubSection title="Transaction Flow">
          <ol className="list-decimal list-inside mt-2 space-y-1 text-sm">
            <li>Transaksi dibuat</li>
            <li>Masuk ke mempool</li>
            <li>Diverifikasi</li>
            <li>Dimasukkan ke block</li>
            <li>Dikonfirmasi melalui mining</li>
          </ol>
        </SubSection>
      </Section>

      <Section title="6. Wallet & Cryptography">
        <ul className="list-disc list-inside space-y-1 text-sm">
          <li>Address dihasilkan dari key pair</li>
          <li>Signature digunakan untuk otorisasi transaksi</li>
          <li>Private key menjaga keamanan aset</li>
        </ul>
      </Section>

      <Section title="7. IX Virtual Machine (IXVM)">
        <p>
          IXVM adalah mesin eksekusi deterministik yang menjalankan smart contract di atas jaringan
          IXCoin.
        </p>
        <SubSection title="Karakteristik">
          <ul className="list-disc list-inside mt-2 space-y-1 text-sm">
            <li>Deterministic execution</li>
            <li>Sandbox environment</li>
            <li>State-based execution</li>
          </ul>
        </SubSection>
        <SubSection title="Execution Model">
          <ul className="list-disc list-inside mt-2 space-y-1 text-sm">
            <li><strong className="text-foreground">Input:</strong> transaksi / contract call</li>
            <li><strong className="text-foreground">Process:</strong> interpretasi instruksi</li>
            <li><strong className="text-foreground">Output:</strong> perubahan state blockchain</li>
          </ul>
        </SubSection>
      </Section>

      <Section title="8. Smart Contract Architecture">
        <SubSection title="Lifecycle">
          <ol className="list-decimal list-inside mt-2 space-y-1 text-sm">
            <li>Deployment — contract dibuat</li>
            <li>Storage — disimpan di blockchain</li>
            <li>Execution — dijalankan oleh IXVM</li>
          </ol>
        </SubSection>
        <SubSection title="Features">
          <ul className="list-disc list-inside mt-2 space-y-1 text-sm">
            <li>Immutable logic (setelah deploy)</li>
            <li>Automated execution</li>
            <li>Interoperability antar contract</li>
          </ul>
        </SubSection>
      </Section>

      <Section title="9. Token Standard">
        <p>IXCoin menyediakan framework untuk pembuatan token di atas jaringan.</p>
        <SubSection title="Fitur">
          <ul className="list-disc list-inside mt-2 space-y-1 text-sm">
            <li>Token creation</li>
            <li>Supply management</li>
            <li>Transfer logic</li>
          </ul>
        </SubSection>
        <SubSection title="Use Case">
          <ul className="list-disc list-inside mt-2 space-y-1 text-sm">
            <li>Asset digital</li>
            <li>Utility token</li>
            <li>Platform token</li>
          </ul>
        </SubSection>
      </Section>

      <Section title="10. Mining & Incentive Model">
        <SubSection title="Reward System">
          <ul className="list-disc list-inside mt-2 space-y-1 text-sm">
            <li>Block reward untuk miner</li>
            <li>Insentif menjaga keamanan network</li>
          </ul>
        </SubSection>
        <SubSection title="Transaction Fee (Future)">
          <p>Fee sebagai insentif tambahan bagi miner.</p>
        </SubSection>
      </Section>

      <Section title="11. Security, Performance & Flexibility Model">
        <p>IXCoin dirancang dengan menggabungkan 3 keunggulan utama dari blockchain besar:</p>

        <div className="mt-4 space-y-4">
          <div className="rounded-lg border border-orange-500/30 bg-orange-500/5 p-4">
            <h3 className="text-sm font-semibold text-orange-400 mb-2">Keamanan Tingkat Tinggi (Model seperti Bitcoin)</h3>
            <ul className="list-disc list-inside space-y-1 text-sm">
              <li>Menggunakan SHA-256 Proof of Work</li>
              <li>Sistem mining terbuka (public participation)</li>
              <li>Chain berbasis cumulative work (sulit diserang)</li>
              <li>Immutable ledger (data tidak bisa diubah)</li>
            </ul>
            <p className="mt-2 text-xs font-medium text-foreground">Mekanisme Keamanan:</p>
            <ul className="list-disc list-inside space-y-1 text-sm mt-1">
              <li>Hash berlapis antar block</li>
              <li>Validasi transaksi ketat</li>
              <li>Proteksi terhadap double-spend</li>
              <li>Konsensus berbasis komputasi (bukan trust)</li>
            </ul>
          </div>

          <div className="rounded-lg border border-purple-500/30 bg-purple-500/5 p-4">
            <h3 className="text-sm font-semibold text-purple-400 mb-2">Fleksibilitas Tinggi (Model seperti Smart Contract Platform)</h3>
            <p className="text-sm mb-2">Melalui IXVM, IXCoin mendukung:</p>
            <ul className="list-disc list-inside space-y-1 text-sm">
              <li>Smart contract programmable</li>
              <li>Deploy aplikasi terdesentralisasi (dApps)</li>
              <li>Pembuatan token di atas jaringan</li>
              <li>Interaksi antar kontrak</li>
            </ul>
            <p className="mt-2 text-xs font-medium text-foreground">Keunggulan:</p>
            <ul className="list-disc list-inside space-y-1 text-sm mt-1">
              <li>Eksekusi logika kompleks</li>
              <li>Pengembangan aplikasi blockchain</li>
              <li>Ekosistem terbuka untuk developer</li>
            </ul>
          </div>

          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4">
            <h3 className="text-sm font-semibold text-emerald-400 mb-2">Transaksi Cepat & Biaya Rendah (Optimasi Network)</h3>
            <p className="text-sm mb-2">IXCoin mengimplementasikan optimasi untuk performa:</p>
            <ul className="list-disc list-inside space-y-1 text-sm">
              <li>Block time lebih cepat</li>
              <li>Proses mining efisien</li>
              <li>Struktur transaksi ringan</li>
              <li>Optimasi mempool</li>
            </ul>
            <p className="mt-2 text-xs font-medium text-foreground">Hasil:</p>
            <ul className="list-disc list-inside space-y-1 text-sm mt-1">
              <li>Konfirmasi transaksi lebih cepat</li>
              <li>Biaya transaksi rendah</li>
              <li>Cocok untuk penggunaan massal</li>
            </ul>
          </div>
        </div>
      </Section>

      <Section title="12. Scalability Considerations">
        <ul className="list-disc list-inside space-y-1 text-sm">
          <li>Optimasi block size</li>
          <li>Efisiensi mempool</li>
          <li>Pengembangan layer tambahan (future)</li>
        </ul>
      </Section>

      <Section title="13. Roadmap">
        <div className="space-y-3">
          {[
            { phase: "Phase 1", status: "Completed", items: ["Blockchain core", "Wallet & transaction"] },
            { phase: "Phase 2", status: "Completed", items: ["Mining (PoW)", "Explorer & rich list"] },
            { phase: "Phase 3", status: "In Progress", items: ["IXVM", "Smart contract", "Token system"] },
            { phase: "Phase 4", status: "Planned", items: ["Multi-node P2P", "Desentralisasi penuh"] },
            { phase: "Phase 5", status: "Planned", items: ["Ekosistem & integrasi DEX"] },
          ].map((phase) => (
            <div key={phase.phase} className="rounded-lg border border-border p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-semibold text-foreground">{phase.phase}</p>
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  phase.status === "Completed"
                    ? "bg-emerald-500/20 text-emerald-400"
                    : phase.status === "In Progress"
                    ? "bg-orange-500/20 text-orange-400"
                    : "bg-muted text-muted-foreground"
                }`}>{phase.status}</span>
              </div>
              <ul className="text-xs text-muted-foreground space-y-0.5">
                {phase.items.map((item) => (
                  <li key={item} className="flex items-center gap-1.5">
                    <span className={phase.status === "Completed" ? "text-emerald-400" : "text-muted-foreground"}>
                      {phase.status === "Completed" ? "✓" : "○"}
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Section>

      <Section title="14. Conclusion">
        <p>
          IXCoin merupakan platform blockchain yang menggabungkan keamanan Proof of Work,
          fleksibilitas komputasi melalui IXVM, dan kecepatan transaksi dalam satu ekosistem.
        </p>
        <p className="mt-3">
          Suplai koin terbatas — hanya ada <strong className="text-foreground">21 juta koin</strong> yang pernah ada.
        </p>
        <p className="mt-3">
          Dengan pengembangan menuju desentralisasi penuh, IXCoin berpotensi menjadi fondasi
          ekosistem blockchain yang scalable dan inovatif.
        </p>
      </Section>

      <div className="rounded-xl border border-orange-500/20 bg-orange-500/5 p-5 text-center">
        <p className="text-sm font-semibold text-orange-400 mb-1">IXCoin Network</p>
        <p className="text-xs text-muted-foreground">
          Max Supply: 21,000,000 IXC · Ticker: IXC · Algorithm: SHA-256 · Consensus: PoW
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          VM: IXVM · Token System: Native · Layer: 1
        </p>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-bold text-foreground border-b border-border pb-2">{title}</h2>
      <div className="text-sm text-muted-foreground leading-relaxed space-y-2">{children}</div>
    </section>
  );
}

function SubSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5 mt-3">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <div className="text-sm text-muted-foreground leading-relaxed">{children}</div>
    </div>
  );
}
