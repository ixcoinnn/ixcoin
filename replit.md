# IXCOIN Blockchain Project

## Overview

Proyek blockchain Layer 1 lengkap dengan nama IXCOIN (IXC). Terdiri dari backend Node.js API dan frontend React.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **Frontend**: React 19 + Vite 7 + Tailwind CSS v4
- **State management**: TanStack React Query

## Fitur IXCOIN

- **Blockchain Layer 1**: PoW mining, halving, difficulty adjustment
- **Wallet**: BIP32/BIP39 HD wallet, ECDSA signing
- **Block Explorer**: Cari block, transaksi, alamat
- **Mining**: Browser-based mining interface
- **NFT**: Mint, transfer, marketplace
- **DeFi**: Liquidity pools, swap, staking
- **MetaID**: Identitas on-chain
- **Bridge Web3**: Bridge ke jaringan lain
- **Smart Contract**: Turing-VM, deploy & call contract
- **RWA**: Real World Assets tokenization
- **P2P Network**: WebSocket-based peer network
- **Live Feed**: SSE real-time updates
- **Security**: Helmet, rate limiting, IP blacklist, audit log

## Key Commands

- `pnpm run typecheck` — full typecheck
- `pnpm run build` — typecheck + build semua packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks dan Zod schemas
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server (port 8080)
- `pnpm --filter @workspace/ixcoin run dev` — run frontend (port 24675)

## Chain Config

- Max Supply: 21,000,000 IXC
- Premine: 11,000,000 IXC (genesis wallet)
- Mining Supply: 10,000,000 IXC
- Initial Reward: 12.5 IXC per block
- Halving: setiap 200,000 block
- Initial Difficulty: 6 leading zeros

## Environment Variables (Penting!)

- `DATABASE_URL` — PostgreSQL connection string (WAJIB)
- `GENESIS_MNEMONIC` — 24-kata mnemonic genesis wallet (SANGAT PENTING di production)
- `API_KEY` — proteksi endpoint API
- `ADMIN_KEY` — proteksi endpoint admin
- `ALLOWED_ORIGINS` — CORS origin whitelist
- `REDIS_URL` — Redis untuk distributed state (opsional)
- `NODE_ID` — identifier node (opsional)
- `PUBLIC_URL` — URL publik node untuk P2P discovery
- `SEED_PEERS` — comma-separated seed peer URLs

## Struktur Artifact

- `artifacts/api-server` — Backend API (port 8080, path: `/api`)
- `artifacts/ixcoin` — Frontend React (port 24675, path: `/`)

## Deployment (Railway)

Lihat `RAILWAY_DEPLOY.md` untuk panduan lengkap deployment ke Railway.

File konfigurasi yang tersedia:
- `Dockerfile` — Multi-stage Docker build
- `railway.json` — Konfigurasi Railway
- `.env.example` — Template environment variables
