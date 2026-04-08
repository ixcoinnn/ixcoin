import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

const API = import.meta.env.BASE_URL.replace(/\/$/, "").replace(/\/[^/]*$/, "") + "/api";

function Avatar({ avatar, name, size = "md" }: { avatar?: string; name: string; size?: "sm" | "md" | "lg" }) {
  const sz = size === "sm" ? "w-8 h-8 text-sm" : size === "lg" ? "w-16 h-16 text-2xl" : "w-10 h-10 text-base";
  if (avatar) return <img src={avatar} alt={name} className={`${sz} rounded-full object-cover`} />;
  return (
    <div className={`${sz} rounded-full bg-orange-500/20 border border-orange-500/30 flex items-center justify-center font-bold text-orange-400`}>
      {name.slice(0, 2).toUpperCase()}
    </div>
  );
}

function RegisterForm() {
  const { toast } = useToast();
  const [form, setForm] = useState({ address: "", username: "", displayName: "", bio: "", avatar: "", website: "", twitter: "", github: "" });

  const reg = useMutation({
    mutationFn: () => fetch(`${API}/metaid/register`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    }).then((r) => r.json()),
    onSuccess: (d) => {
      if (d.error) { toast({ title: "Error", description: d.error, variant: "destructive" }); return; }
      toast({ title: "MetaID registered!", description: `TX: ${d.txHash?.slice(0, 16)}...` });
    },
  });

  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((p) => ({ ...p, [k]: e.target.value }));

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <h3 className="font-semibold text-sm text-foreground flex items-center gap-2">🪪 Register / Update MetaID</h3>
      <div className="grid grid-cols-2 gap-3">
        {[
          { k: "address", label: "Wallet Address", ph: "IX17..." },
          { k: "username", label: "Username", ph: "@satoshi" },
          { k: "displayName", label: "Display Name", ph: "Satoshi Nakamoto" },
          { k: "avatar", label: "Avatar URL", ph: "https://..." },
          { k: "website", label: "Website", ph: "https://..." },
          { k: "twitter", label: "Twitter", ph: "@handle" },
          { k: "github", label: "GitHub", ph: "username" },
        ].map(({ k, label, ph }) => (
          <div key={k} className={k === "address" || k === "displayName" ? "col-span-2" : ""}>
            <label className="text-xs text-muted-foreground mb-1 block">{label}</label>
            <input value={form[k as keyof typeof form]} onChange={f(k)} placeholder={ph}
              className="w-full bg-muted/30 border border-border rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-orange-500/50" />
          </div>
        ))}
        <div className="col-span-2">
          <label className="text-xs text-muted-foreground mb-1 block">Bio</label>
          <textarea value={form.bio} onChange={f("bio")} placeholder="Tell the world about yourself..." rows={2}
            className="w-full bg-muted/30 border border-border rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-orange-500/50 resize-none" />
        </div>
      </div>
      <button onClick={() => reg.mutate()} disabled={reg.isPending || !form.address || !form.username || !form.displayName}
        className="w-full bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-semibold py-2 rounded-lg text-sm transition-colors">
        {reg.isPending ? "Registering..." : "Register MetaID"}
      </button>
    </div>
  );
}

function ProfileCard({ q }: { q: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["metaid-profile", q],
    queryFn: () => fetch(`${API}/metaid/profile/${q}`).then((r) => r.json()),
    enabled: q.length > 2,
  });

  if (isLoading) return <div className="text-xs text-muted-foreground">Loading...</div>;
  if (!data || data.error) return null;

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-start gap-4">
        <Avatar avatar={data.avatar} name={data.displayName || data.username || "?"} size="lg" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-bold text-foreground">{data.displayName}</p>
            {data.verified && <span className="text-blue-400 text-sm">✓</span>}
          </div>
          <p className="text-sm text-muted-foreground">@{data.username}</p>
          <p className="text-xs text-muted-foreground mt-1">{data.bio}</p>
          <div className="flex gap-4 mt-2">
            <span className="text-xs"><span className="font-semibold text-foreground">{data.followerCount}</span> <span className="text-muted-foreground">Followers</span></span>
            <span className="text-xs"><span className="font-semibold text-foreground">{data.followingCount}</span> <span className="text-muted-foreground">Following</span></span>
          </div>
          <div className="flex gap-2 mt-2 flex-wrap">
            {data.twitter && <a href={`https://twitter.com/${data.twitter.replace("@", "")}`} target="_blank" rel="noreferrer" className="text-xs text-blue-400 hover:underline">🐦 {data.twitter}</a>}
            {data.github && <a href={`https://github.com/${data.github}`} target="_blank" rel="noreferrer" className="text-xs text-gray-400 hover:underline">🐙 {data.github}</a>}
            {data.website && <a href={data.website} target="_blank" rel="noreferrer" className="text-xs text-orange-400 hover:underline">🌐 Website</a>}
          </div>
        </div>
      </div>
      <div className="mt-3 pt-3 border-t border-border">
        <p className="text-xs text-muted-foreground font-mono break-all">{data.address}</p>
      </div>
    </div>
  );
}

function Leaderboard() {
  const { data } = useQuery({ queryKey: ["metaid-leaderboard"], queryFn: () => fetch(`${API}/metaid/leaderboard?limit=10`).then((r) => r.json()) });
  if (!data || !Array.isArray(data)) return null;
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <h3 className="font-semibold text-sm mb-3">🏆 Top MetaID Profiles</h3>
      <div className="space-y-2">
        {data.map((p: { address: string; username: string; display_name: string; avatar: string; follower_count: number; verified: boolean }, i: number) => (
          <div key={p.address} className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground w-4">{i + 1}</span>
            <Avatar avatar={p.avatar} name={p.display_name || p.username || "?"} size="sm" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-foreground truncate">{p.display_name || p.username}</p>
              <p className="text-xs text-muted-foreground">@{p.username}</p>
            </div>
            <span className="text-xs text-muted-foreground">{p.follower_count} followers</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SocialActions() {
  const { toast } = useToast();
  const [follower, setFollower] = useState("");
  const [following, setFollowing] = useState("");
  const [postAuthor, setPostAuthor] = useState("");
  const [postContent, setPostContent] = useState("");

  const followMut = useMutation({
    mutationFn: () => fetch(`${API}/metaid/follow`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ follower, following }) }).then((r) => r.json()),
    onSuccess: (d) => toast({ title: d.error ? "Error" : "Followed!", description: d.error || `You are now following ${following}` }),
  });

  const postMut = useMutation({
    mutationFn: () => fetch(`${API}/metaid/post`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ author: postAuthor, content: postContent }) }).then((r) => r.json()),
    onSuccess: (d) => {
      if (d.error) { toast({ title: "Error", description: d.error, variant: "destructive" }); return; }
      toast({ title: "Posted on-chain!", description: `Post ID: ${d.id?.slice(0, 8)}...` });
      setPostContent("");
    },
  });

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-5 space-y-3">
        <h3 className="font-semibold text-sm">👥 Follow User</h3>
        <input value={follower} onChange={(e) => setFollower(e.target.value)} placeholder="Your address (follower)" className="w-full bg-muted/30 border border-border rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-orange-500/50" />
        <input value={following} onChange={(e) => setFollowing(e.target.value)} placeholder="Address to follow" className="w-full bg-muted/30 border border-border rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-orange-500/50" />
        <button onClick={() => followMut.mutate()} disabled={followMut.isPending || !follower || !following} className="w-full bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-semibold py-2 rounded-lg text-sm transition-colors">
          {followMut.isPending ? "Following..." : "Follow"}
        </button>
      </div>

      <div className="rounded-xl border border-border bg-card p-5 space-y-3">
        <h3 className="font-semibold text-sm">📝 Post On-Chain</h3>
        <input value={postAuthor} onChange={(e) => setPostAuthor(e.target.value)} placeholder="Your address" className="w-full bg-muted/30 border border-border rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-orange-500/50" />
        <textarea value={postContent} onChange={(e) => setPostContent(e.target.value)} placeholder="What's on your mind?" rows={3} className="w-full bg-muted/30 border border-border rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-orange-500/50 resize-none" />
        <button onClick={() => postMut.mutate()} disabled={postMut.isPending || !postAuthor || !postContent} className="w-full bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-semibold py-2 rounded-lg text-sm transition-colors">
          {postMut.isPending ? "Posting..." : "Post On-Chain"}
        </button>
      </div>
    </div>
  );
}

export default function MetaID() {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">🪪 MetaID</h1>
        <p className="text-sm text-muted-foreground mt-1">Decentralized identity, social graph, and on-chain posts linked to your wallet</p>
      </div>

      {/* Search */}
      <div className="flex gap-2">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by address or @username..." className="flex-1 bg-muted/30 border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-orange-500/50" />
        <button onClick={() => setQuery(search)} className="bg-orange-500 hover:bg-orange-600 text-white font-semibold px-4 py-2 rounded-lg text-sm transition-colors">Search</button>
      </div>

      {query && <ProfileCard q={query} />}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-4">
          <RegisterForm />
          <SocialActions />
        </div>
        <div>
          <Leaderboard />
        </div>
      </div>
    </div>
  );
}
