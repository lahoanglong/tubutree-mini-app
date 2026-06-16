# Local test KHÔNG cần Docker

Dựng Postgres nhúng + chạy E2E hành trình B2C trên máy bất kỳ (kể cả máy không có Docker).
Đây chính là cách đã dùng trong overnight 2026-06-16 (E2E 19/19 PASS) — xem `../../CHANGELOG_OVERNIGHT.md`.

## Yêu cầu
- Node ≥ 20, pnpm 9 (cho repo). Không cần Docker, không cần Redis (API tự retry BullMQ nền).

## Các bước

```bash
# 0) Cài deps cho repo (ở gốc repo)
pnpm install

# 1) Cài deps cho bộ test này
cd tools/local-test
npm install          # tải embedded-postgres (binary PG18) + pg

# 2) Khởi động Postgres nhúng (UTF8) — GIỮ TERMINAL NÀY MỞ
npm run pg
#   → in ra: READY  DATABASE_URL=postgresql://postgres:postgres@localhost:5544/tubutree

# 3) Terminal khác: migrate + seed (44 SP / 8 brand)
cd apps/api
# Windows PowerShell:
$env:DATABASE_URL="postgresql://postgres:postgres@localhost:5544/tubutree"
# macOS/Linux:  export DATABASE_URL=postgresql://postgres:postgres@localhost:5544/tubutree
pnpm exec prisma generate
pnpm exec prisma migrate deploy
pnpm exec tsx prisma/seed.ts

# 4) Boot API (cùng DATABASE_URL). Cần JWT secret tối thiểu:
#   tạo apps/api/.env từ .env.example, đặt DATABASE_URL ở trên + 2 JWT secret ≥16 ký tự.
pnpm build        # hoặc: pnpm dev (watch)
node dist/main.js  # → 🌿 API listening on http://localhost:3001/api

# 5) Terminal khác: chạy E2E (KHÔNG tạo đơn để tránh rác; bỏ PLACE_ORDER để có tạo đơn)
cd tools/local-test
PLACE_ORDER=0 npm run e2e     # auth→cart→quote (+ game/loyalty), dọn giỏ
npm run e2e                   # full: + đặt đơn COD CONFIRMED + idempotency
```

## Verify PROD (chỉ đọc)
```bash
cd tools/local-test
npm run verify-prod           # health + 9 brand + ảnh + Le Plateau detail
```

## Mini App (FE) — chạy/preview
```bash
cd apps/miniapp
pnpm exec vite --port 5199    # dev server (API base = .env.development = localhost:3001/api)
# build production (bundle để zmp deploy): pnpm build  → output www/
```
> Mini App chạy đúng nhất trong Zalo simulator/`zmp start`; ngoài Zalo nó tự fallback đăng nhập KHÁCH
> (đã thêm timeout chống treo ở `apps/miniapp/src/services/zmp-bridge.ts`).

## Ghi chú
- Cluster PG nhúng mặc định WIN1252 → `start-pg.mjs` đã tự tạo DB `tubutree` mã hoá **UTF8** (tiếng Việt OK).
- `.pgdata/` (dữ liệu) và `node_modules/` đã gitignore.
- Migration `apps/api/prisma/migrations/20260616000000_demo_catalog_multibrand` đã LIVE trên prod (idempotent, an toàn).
