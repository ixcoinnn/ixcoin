import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import pinoHttp from "pino-http";
import router from "./routes/index.js";
import { logger } from "./lib/logger.js";
import { globalRateLimit } from "./middlewares/rateLimiter.js";
import { globalErrorHandler, notFoundHandler } from "./middlewares/errorHandler.js";
import { abuseDetection, requestSizeGuard, addSecurityHeaders } from "./middlewares/security.js";
import { requestTimeout } from "./middlewares/timeout.js";
import { blockchain } from "./blockchain/index.js";
import { utxoSet } from "./blockchain/utxo.js";
import { contractStorage } from "./blockchain/turing-vm.js";
import { metaIDStorage } from "./features/metaid.js";
import { nftStorage } from "./features/nft.js";
import { defiStorage } from "./features/defi.js";
import { bridgeStorage } from "./features/bridge.js";

const app: Express = express();

const ALLOWED_ORIGINS = process.env["ALLOWED_ORIGINS"]
  ? process.env["ALLOWED_ORIGINS"].split(",").map((s) => s.trim())
  : ["*"];

app.set("trust proxy", 1);

const isProd = process.env["NODE_ENV"] === "production";

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        ...(isProd ? { upgradeInsecureRequests: [] } : {}),
      },
    },
    crossOriginEmbedderPolicy: false,
    frameguard: false,
    hsts: isProd
      ? { maxAge: 63_072_000, includeSubDomains: true, preload: true }
      : false,
    noSniff: true,
    xssFilter: true,
    referrerPolicy: { policy: "no-referrer" },
    permittedCrossDomainPolicies: false,
    dnsPrefetchControl: { allow: false },
  })
);

app.use(addSecurityHeaders);

// ─── Gzip compression — reduces response size 60–80% for JSON payloads ──────
app.use(compression({
  level: 6,
  threshold: 1024,
  filter: (req, res) => {
    if (req.headers["x-no-compression"]) return false;
    return compression.filter(req, res);
  },
}));

app.use(
  cors({
    origin: ALLOWED_ORIGINS.includes("*")
      ? "*"
      : (origin, cb) => {
          if (!origin || ALLOWED_ORIGINS.includes(origin)) {
            cb(null, true);
          } else {
            logger.warn({ origin }, "CORS: origin tidak diizinkan");
            cb(new Error("CORS: origin tidak diizinkan"));
          }
        },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-API-Key", "X-Admin-Key", "X-Signature", "X-Timestamp"],
    exposedHeaders: ["X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset"],
    credentials: ALLOWED_ORIGINS.includes("*") ? false : true,
    maxAge: 600,
  })
);

app.use(globalRateLimit);

app.use(requestTimeout(30_000));

app.use(abuseDetection);

app.use(requestSizeGuard(100 * 1024));

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
          ip: req.remoteAddress,
        };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
    customLogLevel(_req, res, err) {
      if (err || (res.statusCode && res.statusCode >= 500)) return "error";
      if (res.statusCode && res.statusCode >= 400) return "warn";
      return "info";
    },
    autoLogging: {
      ignore: (req) => req.url === "/api/healthz/live",
    },
  })
);

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

app.get("/", (_req, res) => {
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
  h1{font-size:28px;font-weight:700;color:#38bdf8;margin-bottom:4px}
  .sub{color:#64748b;font-size:14px;margin-bottom:32px}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px;margin-bottom:32px}
  .card{background:#131929;border:1px solid #1e293b;border-radius:12px;padding:20px}
  .card .label{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#64748b;margin-bottom:6px}
  .card .value{font-size:22px;font-weight:700;color:#f8fafc}
  .card .value.green{color:#4ade80}
  .card .value.blue{color:#38bdf8}
  .card .value.yellow{color:#fbbf24}
  .badge{display:inline-block;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:600;background:#14532d;color:#4ade80;margin-bottom:24px}
  .sr{font-size:11px;color:#475569;word-break:break-all;margin-top:4px}
  .section-title{font-size:13px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.08em;margin-bottom:12px}
  .api-list{background:#131929;border:1px solid #1e293b;border-radius:12px;padding:20px}
  .api-row{display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid #1e293b}
  .api-row:last-child{border-bottom:none}
  .method{font-size:11px;font-weight:700;padding:2px 8px;border-radius:4px;min-width:42px;text-align:center}
  .get{background:#1e3a5f;color:#38bdf8}
  .post{background:#1a3a2a;color:#4ade80}
  .api-path{font-size:13px;color:#cbd5e1;font-family:monospace}
  .api-desc{font-size:12px;color:#64748b;margin-left:auto}
  footer{margin-top:32px;text-align:center;font-size:12px;color:#334155}
</style>
</head>
<body>
<h1>⛓ IXCOIN Blockchain Node</h1>
<p class="sub">Layer 1 · ${stats.network} · v${stats.ticker}</p>
<span class="badge">● ONLINE</span>

<div class="grid">
  <div class="card">
    <div class="label">Chain Height</div>
    <div class="value blue">${stats.height.toLocaleString()}</div>
  </div>
  <div class="card">
    <div class="label">Difficulty</div>
    <div class="value yellow">${stats.difficulty}</div>
  </div>
  <div class="card">
    <div class="label">Total Minted</div>
    <div class="value">${stats.totalMinted.toLocaleString()} IXC</div>
  </div>
  <div class="card">
    <div class="label">Total Burned</div>
    <div class="value">${stats.totalBurned.toLocaleString()} IXC</div>
  </div>
  <div class="card">
    <div class="label">Circulating Supply</div>
    <div class="value green">${stats.circulating.toLocaleString()} IXC</div>
  </div>
  <div class="card">
    <div class="label">Max Supply</div>
    <div class="value">${stats.maxSupply.toLocaleString()} IXC</div>
  </div>
  <div class="card">
    <div class="label">Block Reward</div>
    <div class="value yellow">${stats.blockReward} IXC</div>
  </div>
  <div class="card">
    <div class="label">Mempool</div>
    <div class="value">${stats.mempoolSize} TX</div>
  </div>
  <div class="card" style="grid-column:1/-1">
    <div class="label">State Root</div>
    <div class="sr">${stats.stateRoot || '—'}</div>
  </div>
</div>

<p class="section-title">API Endpoints</p>
<div class="api-list">
  <div class="api-row"><span class="method get">GET</span><span class="api-path">/api/ixcoin/info</span><span class="api-desc">Info & stats blockchain</span></div>
  <div class="api-row"><span class="method get">GET</span><span class="api-path">/api/ixcoin/chain</span><span class="api-desc">Daftar block terbaru</span></div>
  <div class="api-row"><span class="method get">GET</span><span class="api-path">/api/ixcoin/block/:id</span><span class="api-desc">Detail block</span></div>
  <div class="api-row"><span class="method get">GET</span><span class="api-path">/api/ixcoin/address/:addr</span><span class="api-desc">Saldo & riwayat transaksi</span></div>
  <div class="api-row"><span class="method get">GET</span><span class="api-path">/api/ixcoin/mempool</span><span class="api-desc">Transaksi pending</span></div>
  <div class="api-row"><span class="method post">POST</span><span class="api-path">/api/ixcoin/wallet/new</span><span class="api-desc">Buat wallet baru (privateKey terlihat)</span></div>
  <div class="api-row"><span class="method post">POST</span><span class="api-path">/api/ixcoin/send</span><span class="api-desc">Kirim transaksi</span></div>
  <div class="api-row"><span class="method post">POST</span><span class="api-path">/api/ixcoin/mine</span><span class="api-desc">Mine block baru</span></div>
  <div class="api-row"><span class="method get">GET</span><span class="api-path">/api/healthz</span><span class="api-desc">Health check</span></div>
</div>

<footer>IXCOIN Node · Port ${process.env["PORT"] ?? 8080} · ${new Date().toUTCString()}</footer>
</body>
</html>`);
});

app.use("/api", router);

app.use(notFoundHandler);
app.use(globalErrorHandler);

export async function initAll(): Promise<void> {
  const { genesisAddress } = await blockchain.init();
  logger.info({ genesisAddress }, "IXCOIN Blockchain initialized");

  await utxoSet.ensureTables();
  logger.info("UTXO tables ready");

  await contractStorage.ensureTables();
  logger.info("Contract storage ready");

  await metaIDStorage.ensureTables();
  logger.info("MetaID storage ready");

  await nftStorage.ensureTables();
  logger.info("NFT storage ready");

  await defiStorage.ensureTables();
  logger.info("DeFi storage ready");

  await bridgeStorage.ensureTables();
  logger.info("Bridge storage ready");

  logger.info("All IXCOIN modules initialized: UTXO, Turing VM, MetaID, NFT, DeFi, Bridge");
}

export default app;
