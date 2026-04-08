import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import ixcoinRouter from "./ixcoin.js";
import metaidRouter from "./metaid.js";
import nftRouter from "./nft.js";
import defiRouter from "./defi.js";
import bridgeRouter from "./bridge.js";
import contractsRouter from "./contracts.js";
import eventsRouter from "./events.js";
import { blockchain } from "../blockchain/index.js";

const router: IRouter = Router();

router.get("/", (_req, res) => {
  const stats = blockchain.getStats();
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>IXCOIN Node</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Segoe UI',sans-serif;background:#0a0e1a;color:#e2e8f0;min-height:100vh;padding:24px}
  h1{font-size:26px;font-weight:700;color:#38bdf8;margin-bottom:4px}
  .sub{color:#64748b;font-size:14px;margin-bottom:20px}
  .badge{display:inline-block;padding:3px 12px;border-radius:999px;font-size:12px;font-weight:600;background:#14532d;color:#4ade80;margin-bottom:24px}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px;margin-bottom:28px}
  .card{background:#131929;border:1px solid #1e293b;border-radius:12px;padding:18px}
  .label{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#64748b;margin-bottom:6px}
  .value{font-size:20px;font-weight:700;color:#f8fafc}
  .blue{color:#38bdf8} .green{color:#4ade80} .yellow{color:#fbbf24}
  .sr{font-size:10px;color:#475569;word-break:break-all;margin-top:4px;font-family:monospace}
  .sec{font-size:12px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px}
  .api-box{background:#131929;border:1px solid #1e293b;border-radius:12px;padding:18px}
  .row{display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid #1e293b}
  .row:last-child{border-bottom:none}
  .m{font-size:11px;font-weight:700;padding:2px 8px;border-radius:4px;min-width:40px;text-align:center}
  .get{background:#1e3a5f;color:#38bdf8} .post{background:#1a3a2a;color:#4ade80}
  .path{font-size:12px;color:#cbd5e1;font-family:monospace}
  .desc{font-size:11px;color:#64748b;margin-left:auto}
  footer{margin-top:28px;text-align:center;font-size:11px;color:#334155}
</style>
</head>
<body>
<h1>&#9741; IXCOIN Blockchain Node</h1>
<p class="sub">Layer 1 &middot; ${stats.network} &middot; ${stats.ticker}</p>
<span class="badge">&#9679; ONLINE</span>

<div class="grid">
  <div class="card"><div class="label">Chain Height</div><div class="value blue">${stats.height.toLocaleString()}</div></div>
  <div class="card"><div class="label">Difficulty</div><div class="value yellow">${stats.difficulty}</div></div>
  <div class="card"><div class="label">Block Reward</div><div class="value yellow">${stats.blockReward} IXC</div></div>
  <div class="card"><div class="label">Mempool</div><div class="value">${stats.mempoolSize} TX</div></div>
  <div class="card"><div class="label">Total Minted</div><div class="value">${stats.totalMinted.toLocaleString()} IXC</div></div>
  <div class="card"><div class="label">Total Burned</div><div class="value">${stats.totalBurned.toLocaleString()} IXC</div></div>
  <div class="card"><div class="label">Circulating</div><div class="value green">${stats.circulating.toLocaleString()} IXC</div></div>
  <div class="card"><div class="label">Max Supply</div><div class="value">${stats.maxSupply.toLocaleString()} IXC</div></div>
  <div class="card" style="grid-column:1/-1">
    <div class="label">State Root (GlobalState Hash)</div>
    <div class="sr">${stats.stateRoot || '—'}</div>
  </div>
</div>

<p class="sec">API Endpoints</p>
<div class="api-box">
  <div class="row"><span class="m get">GET</span><span class="path">/api/ixcoin/info</span><span class="desc">Info &amp; stats chain</span></div>
  <div class="row"><span class="m get">GET</span><span class="path">/api/ixcoin/chain</span><span class="desc">Daftar block terbaru</span></div>
  <div class="row"><span class="m get">GET</span><span class="path">/api/ixcoin/block/:id</span><span class="desc">Detail block</span></div>
  <div class="row"><span class="m get">GET</span><span class="path">/api/ixcoin/address/:addr</span><span class="desc">Saldo &amp; riwayat TX</span></div>
  <div class="row"><span class="m get">GET</span><span class="path">/api/ixcoin/mempool</span><span class="desc">Transaksi pending</span></div>
  <div class="row"><span class="m post">POST</span><span class="path">/api/ixcoin/wallet/new</span><span class="desc">Buat wallet (privateKey ditampilkan)</span></div>
  <div class="row"><span class="m post">POST</span><span class="path">/api/ixcoin/send</span><span class="desc">Kirim transaksi</span></div>
  <div class="row"><span class="m post">POST</span><span class="path">/api/ixcoin/mine</span><span class="desc">Mine block baru</span></div>
  <div class="row"><span class="m get">GET</span><span class="path">/api/healthz</span><span class="desc">Health check</span></div>
</div>

<footer>IXCOIN Node &middot; Port ${process.env["PORT"] ?? 8080} &middot; ${new Date().toUTCString()}</footer>
</body>
</html>`);
});

router.use(healthRouter);
router.use("/ixcoin", ixcoinRouter);
router.use("/metaid", metaidRouter);
router.use("/nft", nftRouter);
router.use("/defi", defiRouter);
router.use("/bridge", bridgeRouter);
router.use("/contracts", contractsRouter);
router.use("/events", eventsRouter);

export default router;
