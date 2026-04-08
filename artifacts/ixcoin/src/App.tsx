import { Switch, Route, Router as WouterRouter, Link, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import Dashboard from "@/pages/Dashboard";
import Explorer from "@/pages/Explorer";
import Wallet from "@/pages/Wallet";
import Mining from "@/pages/Mining";
import Whitepaper from "@/pages/Whitepaper";
import SmartContract from "@/pages/SmartContract";
import RWA from "@/pages/RWA";
import NFT from "@/pages/NFT";
import DeFi from "@/pages/DeFi";
import MetaID from "@/pages/MetaID";
import Bridge from "@/pages/Bridge";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 5000 },
  },
});

function NavLink({ href, icon, label }: { href: string; icon: string; label: string }) {
  const [location] = useLocation();
  const active = href === "/" ? location === "/" : location.startsWith(href);
  return (
    <Link href={href}>
      <span className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-all cursor-pointer ${
        active
          ? "bg-orange-500/15 text-orange-400 border border-orange-500/25"
          : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
      }`}>
        <span className="text-base">{icon}</span>
        <span>{label}</span>
      </span>
    </Link>
  );
}

function Sidebar() {
  const links = [
    { href: "/", icon: "📊", label: "Dashboard" },
    { href: "/explorer", icon: "🔍", label: "Block Explorer" },
    { href: "/wallet", icon: "👛", label: "Wallet" },
    { href: "/mining", icon: "⛏️", label: "Mining" },
    { href: "/nft", icon: "🖼️", label: "NFT" },
    { href: "/defi", icon: "💰", label: "DeFi" },
    { href: "/metaid", icon: "🪪", label: "Meta ID" },
    { href: "/bridge", icon: "🌉", label: "Bridge Web3" },
    { href: "/contract", icon: "📜", label: "Smart Contract" },
    { href: "/rwa", icon: "🏛️", label: "RWA" },
    { href: "/whitepaper", icon: "📄", label: "Whitepaper" },
  ];

  return (
    <aside className="w-56 flex-shrink-0 border-r border-border bg-sidebar flex flex-col">
      <div className="p-4 border-b border-border">
        <div className="flex items-center gap-2.5">
          <img
            src="/ixcoin-logo.jpg"
            alt="IXCOIN"
            className="w-9 h-9 rounded-full object-cover flex-shrink-0 shadow-md"
          />
          <div>
            <p className="font-bold text-sm text-orange-400 tracking-wide">IXCOIN</p>
            <p className="text-xs text-muted-foreground">IXCOIN Network</p>
          </div>
        </div>
      </div>

      <nav className="p-3 space-y-0.5 flex-1 overflow-y-auto">
        {links.map((l) => (
          <NavLink key={l.href} href={l.href} icon={l.icon} label={l.label} />
        ))}
      </nav>

      <div className="p-4 border-t border-border">
        <div className="rounded-lg border border-orange-500/20 bg-orange-500/5 p-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse flex-shrink-0"></span>
            <p className="text-xs text-orange-400 font-semibold">LIVE</p>
          </div>
          <p className="text-xs text-muted-foreground">Layer 1 Blockchain</p>
          <p className="text-xs text-muted-foreground">Max Supply: 21M IXC</p>
        </div>
      </div>
    </aside>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/explorer" component={Explorer} />
      <Route path="/block/:id" component={Explorer} />
      <Route path="/tx/:id" component={Explorer} />
      <Route path="/address/:id" component={Explorer} />
      <Route path="/wallet" component={Wallet} />
      <Route path="/mining" component={Mining} />
      <Route path="/nft" component={NFT} />
      <Route path="/nft/:address" component={NFT} />
      <Route path="/defi" component={DeFi} />
      <Route path="/metaid" component={MetaID} />
      <Route path="/metaid/:id" component={MetaID} />
      <Route path="/bridge" component={Bridge} />
      <Route path="/contract" component={SmartContract} />
      <Route path="/contract/:address" component={SmartContract} />
      <Route path="/rwa" component={RWA} />
      <Route path="/rwa/:address" component={RWA} />
      <Route path="/whitepaper" component={Whitepaper} />
      <Route>
        <div className="flex items-center justify-center h-full">
          <div className="text-center">
            <p className="text-4xl font-mono text-orange-400 font-bold mb-2">404</p>
            <p className="text-muted-foreground mb-4">Page not found</p>
            <Link href="/" className="text-orange-400 hover:text-orange-300 text-sm">← Back to Dashboard</Link>
          </div>
        </div>
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
        <div className="flex h-screen overflow-hidden bg-background text-foreground">
          <Sidebar />
          <main className="flex-1 overflow-y-auto">
            <div className="p-6">
              <Router />
            </div>
          </main>
        </div>
        <Toaster />
      </WouterRouter>
    </QueryClientProvider>
  );
}

export default App;
