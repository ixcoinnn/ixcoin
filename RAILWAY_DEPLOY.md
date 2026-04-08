# Panduan Deploy IXCOIN ke Railway

## Langkah 1: Upload ke GitHub

Upload semua file berikut ke GitHub repository kamu. Lihat daftar file lengkap di bawah.

## Langkah 2: Deploy ke Railway

1. Buka [railway.app](https://railway.app) dan login
2. Klik **New Project** → **Deploy from GitHub repo**
3. Pilih repository IXCOIN kamu
4. Railway akan otomatis mendeteksi `Dockerfile`

## Langkah 3: Tambah Database PostgreSQL

1. Di Railway dashboard, klik **+ Add Service** → **Database** → **PostgreSQL**
2. Setelah database dibuat, klik database → **Variables**
3. Copy nilai `DATABASE_URL`
4. Pergi ke service IXCOIN → **Variables** → tambahkan `DATABASE_URL`

## Langkah 4: Set Environment Variables

Di Railway dashboard, pergi ke service IXCOIN → **Variables**, tambahkan:

| Variable | Nilai | Wajib |
|----------|-------|-------|
| `DATABASE_URL` | URL PostgreSQL dari Railway | Ya |
| `PORT` | `8080` | Ya (biasanya otomatis) |
| `NODE_ENV` | `production` | Ya |
| `GENESIS_MNEMONIC` | 24 kata mnemonic rahasia kamu | **SANGAT PENTING** |
| `API_KEY` | String random panjang (untuk proteksi API) | Sangat disarankan |
| `ADMIN_KEY` | String random panjang (untuk endpoint admin) | Sangat disarankan |
| `ALLOWED_ORIGINS` | Domain Railway kamu (contoh: `https://xxx.railway.app`) | Disarankan |

### Generate API Key & Admin Key yang aman:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### PERINGATAN GENESIS_MNEMONIC:
- Genesis wallet memegang 11 juta IXC (premine)
- Gunakan 24 kata BIP39 yang benar-benar RAHASIA
- Jangan pernah bagikan ke siapapun
- Backup dengan aman sebelum deploy

## Langkah 5: Deploy

Klik **Deploy** dan tunggu Railway build selesai (sekitar 2-5 menit).

Setelah berhasil, akses aplikasi di URL Railway yang diberikan.

---

## Struktur File yang Perlu di GitHub

```
ixcoin-repo/
├── Dockerfile                    <- Wajib untuk Railway
├── railway.json                  <- Konfigurasi Railway
├── package.json                  <- Root workspace
├── pnpm-workspace.yaml           <- Config pnpm monorepo
├── pnpm-lock.yaml                <- Lockfile (penting!)
├── tsconfig.json                 <- TypeScript config
├── tsconfig.base.json            <- TypeScript base config
├── .gitignore                    <- File yang diabaikan git
├── .env.example                  <- Contoh environment variables
│
├── artifacts/
│   ├── api-server/               <- Backend Node.js
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── build.mjs
│   │   └── src/
│   │       ├── index.ts
│   │       ├── app.ts
│   │       ├── blockchain/       <- Core blockchain
│   │       ├── features/         <- NFT, DeFi, Bridge, MetaID
│   │       ├── lib/              <- Logger, Redis, Market
│   │       ├── middlewares/      <- Auth, Security, Ratelimit
│   │       ├── p2p/              <- P2P networking
│   │       └── routes/           <- API routes
│   │
│   └── ixcoin/                   <- Frontend React
│       ├── package.json
│       ├── tsconfig.json
│       ├── vite.config.ts
│       ├── index.html
│       ├── components.json
│       ├── public/
│       │   ├── ixcoin-logo.jpg
│       │   ├── favicon.svg
│       │   └── opengraph.jpg
│       └── src/
│           ├── App.tsx
│           ├── index.css
│           ├── main.tsx
│           ├── pages/            <- 11 halaman
│           ├── components/       <- UI components
│           ├── hooks/
│           └── lib/
│
├── lib/
│   ├── db/                       <- Database (Drizzle ORM)
│   ├── api-spec/                 <- OpenAPI spec
│   ├── api-zod/                  <- Zod validators
│   └── api-client-react/         <- React Query hooks
│
└── scripts/                      <- Utility scripts
```

## File yang TIDAK perlu di GitHub (ada di .gitignore)

- `node_modules/` - di-install ulang saat build
- `artifacts/api-server/dist/` - dibuild oleh Dockerfile
- `artifacts/ixcoin/dist/` - dibuild oleh Dockerfile
- `attached_assets/` - file upload lokal
- `.env` - rahasia, jangan pernah commit!
- `.local/` - config Replit
