import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

const API = import.meta.env.BASE_URL.replace(/\/$/, "").replace(/\/[^/]*$/, "") + "/api";

function StatCard({ label, value, icon }: { label: string; value: string | number; icon: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 mb-1">
        <span>{icon}</span>
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
      <p className="text-xl font-bold text-foreground">{value}</p>
    </div>
  );
}

function CollectionCard({ col }: { col: { id: string; name: string; symbol: string; cover_image: string; total_minted: number; floor_price: number; total_volume: number; creator: string; category: string; royalty_percent: number } }) {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden hover:border-orange-500/30 transition-colors">
      {col.cover_image ? (
        <img src={col.cover_image} alt={col.name} className="w-full h-32 object-cover" />
      ) : (
        <div className="w-full h-32 bg-gradient-to-br from-orange-500/20 to-purple-500/20 flex items-center justify-center text-3xl">🖼️</div>
      )}
      <div className="p-4">
        <div className="flex items-center justify-between mb-1">
          <p className="font-bold text-sm text-foreground">{col.name}</p>
          <span className="text-xs bg-muted/50 px-2 py-0.5 rounded-full text-muted-foreground">{col.symbol}</span>
        </div>
        <p className="text-xs text-muted-foreground mb-3 capitalize">{col.category} · {col.royalty_percent}% royalty</p>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <p className="text-xs font-semibold text-foreground">{col.total_minted}</p>
            <p className="text-xs text-muted-foreground">Minted</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-foreground">{col.floor_price > 0 ? `${col.floor_price} IXC` : "—"}</p>
            <p className="text-xs text-muted-foreground">Floor</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-foreground">{col.total_volume} IXC</p>
            <p className="text-xs text-muted-foreground">Volume</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function NFTCard({ nft }: { nft: { id: string; name: string; image: string; collection_name?: string; listing_price?: number; listed: boolean; owner: string; rarity: number } }) {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden hover:border-orange-500/30 transition-colors">
      {nft.image ? (
        <img src={nft.image} alt={nft.name} className="w-full h-36 object-cover" />
      ) : (
        <div className="w-full h-36 bg-gradient-to-br from-purple-500/20 to-blue-500/20 flex items-center justify-center text-3xl">🎨</div>
      )}
      <div className="p-3">
        <p className="font-semibold text-xs text-foreground">{nft.name}</p>
        {nft.collection_name && <p className="text-xs text-muted-foreground">{nft.collection_name}</p>}
        <div className="flex items-center justify-between mt-2">
          {nft.listed && nft.listing_price ? (
            <span className="text-xs font-bold text-orange-400">{nft.listing_price} IXC</span>
          ) : (
            <span className="text-xs text-muted-foreground">Not listed</span>
          )}
          {nft.rarity > 0 && <span className="text-xs text-purple-400">⭐ {nft.rarity.toFixed(1)}%</span>}
        </div>
      </div>
    </div>
  );
}

function MintForm({ collections }: { collections: { id: string; name: string; symbol: string }[] }) {
  const { toast } = useToast();
  const [form, setForm] = useState({ collectionId: "", owner: "", name: "", description: "", image: "", edition: "1" });

  const mint = useMutation({
    mutationFn: () => fetch(`${API}/nft/mint`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, edition: Number(form.edition) }),
    }).then((r) => r.json()),
    onSuccess: (d) => {
      if (d.error) { toast({ title: "Error", description: d.error, variant: "destructive" }); return; }
      toast({ title: "NFT Minted!", description: `Token #${d.tokenId} · TX: ${d.txHash?.slice(0, 12)}...` });
    },
  });

  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm((p) => ({ ...p, [k]: e.target.value }));

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-3">
      <h3 className="font-semibold text-sm">🎨 Mint NFT</h3>
      <select value={form.collectionId} onChange={f("collectionId")} className="w-full bg-muted/30 border border-border rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-orange-500/50">
        <option value="">Select collection...</option>
        {collections.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.symbol})</option>)}
      </select>
      {[
        { k: "owner", label: "Owner Address", ph: "IX17..." },
        { k: "name", label: "NFT Name", ph: "My NFT #1" },
        { k: "image", label: "Image URL", ph: "https://..." },
        { k: "edition", label: "Edition", ph: "1" },
      ].map(({ k, label, ph }) => (
        <div key={k}>
          <label className="text-xs text-muted-foreground mb-1 block">{label}</label>
          <input value={form[k as keyof typeof form]} onChange={f(k)} placeholder={ph}
            className="w-full bg-muted/30 border border-border rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-orange-500/50" />
        </div>
      ))}
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">Description</label>
        <textarea value={form.description} onChange={f("description")} rows={2} placeholder="Describe your NFT..."
          className="w-full bg-muted/30 border border-border rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-orange-500/50 resize-none" />
      </div>
      <button onClick={() => mint.mutate()} disabled={mint.isPending || !form.collectionId || !form.owner || !form.name}
        className="w-full bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white font-semibold py-2 rounded-lg text-sm transition-colors">
        {mint.isPending ? "Minting..." : "Mint NFT"}
      </button>
    </div>
  );
}

function CreateCollectionForm() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({ creator: "", name: "", symbol: "", description: "", coverImage: "", category: "art", royaltyPercent: "2.5", maxSupply: "0" });

  const create = useMutation({
    mutationFn: () => fetch(`${API}/nft/collections`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, royaltyPercent: Number(form.royaltyPercent), maxSupply: Number(form.maxSupply) }),
    }).then((r) => r.json()),
    onSuccess: (d) => {
      if (d.error) { toast({ title: "Error", description: d.error, variant: "destructive" }); return; }
      toast({ title: "Collection Created!", description: `ID: ${d.id?.slice(0, 16)}...` });
      qc.invalidateQueries({ queryKey: ["nft-collections"] });
    },
  });

  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((p) => ({ ...p, [k]: e.target.value }));

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-3">
      <h3 className="font-semibold text-sm">🏗️ Create Collection</h3>
      <div className="grid grid-cols-2 gap-3">
        {[
          { k: "creator", label: "Creator Address", ph: "IX17...", span: true },
          { k: "name", label: "Collection Name", ph: "My Art Collection", span: false },
          { k: "symbol", label: "Symbol", ph: "MAC", span: false },
          { k: "coverImage", label: "Cover Image URL", ph: "https://...", span: true },
          { k: "royaltyPercent", label: "Royalty %", ph: "2.5", span: false },
          { k: "maxSupply", label: "Max Supply (0=unlimited)", ph: "10000", span: false },
        ].map(({ k, label, ph, span }) => (
          <div key={k} className={span ? "col-span-2" : ""}>
            <label className="text-xs text-muted-foreground mb-1 block">{label}</label>
            <input value={form[k as keyof typeof form]} onChange={f(k)} placeholder={ph}
              className="w-full bg-muted/30 border border-border rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-orange-500/50" />
          </div>
        ))}
        <div className="col-span-2">
          <label className="text-xs text-muted-foreground mb-1 block">Category</label>
          <select value={form.category} onChange={f("category")} className="w-full bg-muted/30 border border-border rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-orange-500/50">
            {["art", "gaming", "collectible", "music", "photography", "sport", "utility"].map((c) => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
          </select>
        </div>
      </div>
      <button onClick={() => create.mutate()} disabled={create.isPending || !form.creator || !form.name || !form.symbol}
        className="w-full bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-semibold py-2 rounded-lg text-sm transition-colors">
        {create.isPending ? "Creating..." : "Create Collection"}
      </button>
    </div>
  );
}

export default function NFT() {
  const [tab, setTab] = useState<"marketplace" | "collections" | "create" | "owned">("marketplace");
  const [ownerAddr, setOwnerAddr] = useState("");
  const [queryAddr, setQueryAddr] = useState("");

  const { data: marketplace } = useQuery({ queryKey: ["nft-marketplace"], queryFn: () => fetch(`${API}/nft/marketplace?limit=40`).then((r) => r.json()), enabled: tab === "marketplace" });
  const { data: collections } = useQuery({ queryKey: ["nft-collections"], queryFn: () => fetch(`${API}/nft/collections?limit=20`).then((r) => r.json()) });
  const { data: owned } = useQuery({ queryKey: ["nft-owned", queryAddr], queryFn: () => fetch(`${API}/nft/owned/${queryAddr}?limit=40`).then((r) => r.json()), enabled: queryAddr.length > 10 });

  const tabs = ["marketplace", "collections", "create", "owned"] as const;
  const tabIcons = { marketplace: "🛒", collections: "🗂️", create: "✨", owned: "👛" };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">🎨 NFT Marketplace</h1>
        <p className="text-sm text-muted-foreground mt-1">Mint, buy, sell, and collect NFTs on IXCOIN blockchain</p>
      </div>

      <div className="flex gap-1 bg-muted/30 rounded-xl p-1">
        {tabs.map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 py-2 rounded-lg text-xs font-medium transition-colors ${tab === t ? "bg-orange-500 text-white" : "text-muted-foreground hover:text-foreground"}`}>
            {tabIcons[t]} {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === "marketplace" && (
        <div>
          <h3 className="font-semibold text-sm mb-3 text-muted-foreground">Active Listings</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {Array.isArray(marketplace) && marketplace.length > 0 ? marketplace.map((item: { nft_id: string; name: string; image: string; collection_name: string; price: number; seller: string }) => (
              <NFTCard key={item.nft_id} nft={{ id: item.nft_id, name: item.name, image: item.image, collection_name: item.collection_name, listing_price: Number(item.price), listed: true, owner: item.seller, rarity: 0 }} />
            )) : <p className="col-span-4 text-center text-xs text-muted-foreground py-8">No active listings yet. Create a collection and mint your first NFT!</p>}
          </div>
        </div>
      )}

      {tab === "collections" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.isArray(collections) && collections.length > 0 ? collections.map((c: Parameters<typeof CollectionCard>[0]["col"]) => (
            <CollectionCard key={c.id} col={c} />
          )) : <p className="col-span-3 text-center text-xs text-muted-foreground py-8">No collections yet. Create one!</p>}
        </div>
      )}

      {tab === "create" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <CreateCollectionForm />
          <MintForm collections={Array.isArray(collections) ? collections : []} />
        </div>
      )}

      {tab === "owned" && (
        <div className="space-y-4">
          <div className="flex gap-2">
            <input value={ownerAddr} onChange={(e) => setOwnerAddr(e.target.value)} placeholder="Enter wallet address..." className="flex-1 bg-muted/30 border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-orange-500/50" />
            <button onClick={() => setQueryAddr(ownerAddr)} className="bg-orange-500 hover:bg-orange-600 text-white font-semibold px-4 py-2 rounded-lg text-sm transition-colors">View</button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {Array.isArray(owned) && owned.length > 0 ? owned.map((nft: Parameters<typeof NFTCard>[0]["nft"]) => (
              <NFTCard key={nft.id} nft={nft} />
            )) : queryAddr ? <p className="col-span-4 text-center text-xs text-muted-foreground py-8">No NFTs found for this address</p> : null}
          </div>
        </div>
      )}
    </div>
  );
}
