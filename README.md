# 🌿 Tubu Tree — Monorepo

Nền tảng e-commerce đa kênh (Zalo Mini App + Web Shop + Backend) cho thương hiệu
Tubu Tree. Triển khai theo `design_handoff/specs/TUBU_TREE_BUILD_SPEC_v1.1.md`.

> Thư mục `mini_app/` là app **cũ** (Express + ZMP-UI) — giữ làm tham chiếu, KHÔNG nằm
> trong workspace pnpm. Code mới nằm ở `apps/` + `packages/`.

## Cấu trúc

```
apps/
  api/        NestJS + Prisma + PostgreSQL  (port 3001)
  miniapp/    Zalo Mini App: React + ZaUI + zmp-sdk + Vite
  web/        Next.js 14 (App Router) + Tailwind  (port 3000)
packages/
  shared-types/       Types dùng chung (enums, DTO)
  eslint-config/      ESLint flat config dùng chung
  typescript-config/  tsconfig base/nestjs/react/nextjs
```

## Yêu cầu
- Node ≥ 20, pnpm 9 (`npm i -g pnpm@9`), Docker.

## Bắt đầu (Phase 0)

```bash
pnpm install                      # cài toàn workspace
pnpm dev:infra                    # bật Postgres(5434) + Redis(6381) qua Docker
cp apps/api/.env.example apps/api/.env   # (đã có .env mẫu sẵn cho dev)
pnpm db:generate                  # prisma generate
pnpm db:migrate                   # tạo schema (migrate dev)
pnpm db:seed                      # seed SystemConfig + tiers

pnpm --filter @tubutree/api dev   # chạy backend → http://localhost:3001/api/health
pnpm --filter @tubutree/web dev   # chạy web    → http://localhost:3000
pnpm --filter @tubutree/miniapp dev  # chạy mini app (cần zmp-cli login)
```

## Tiến độ tổng quan (cập nhật 2026-06-21)

> **Prod LIVE tại `api.tubutree.com` + `app.tubutree.com`** — 9 brand, 139 SP (44 demo có ảnh + 95 từ Pancake), 245 unit test xanh, E2E 19/19 pass.

### Lịch sử cập nhật

**2026-06-15→16 — Catalog đa thương hiệu + hotfix:**
- Catalog demo nâng từ 6 SP/3 brand → **44 SP/8 brand có ảnh** (Visante, Pơ Lang, Fuwa3e, Cobote, Le Plateau Coffee, BH.Nong, Sokfram, Hector). Migration idempotent, không đụng SP Pancake.
- Fix loyalty: user mới mặc định hạng nền Mầm Xanh thay vì `tier=null`.
- Fix bảo mật: hủy đơn atomic (`updateMany` với guard status) chống hoàn ví 2 lần khi double-tap.
- Fix auth: timeout 3s cho `zmpLogin`/`getAccessToken` chống treo màn loading ngoài Zalo.

**2026-06-10 — Tier S polish (miniapp):** Foundation (token palette đúng logo cam #E08C1C, i18n vi.ts, error normalization, Skeleton/EmptyState/haptic) + 5 feature core (Home, PDP, Cart, Checkout, Orders) nâng từ skeleton lên production-grade: optimistic updates, idempotency key, inline validation, timeline đơn hàng, empty/error states có illustration, code-split (initial 438KB / gzip 138KB). Chi tiết: `EXECUTION_PLAN.md`, `ARCHITECTURE_DECISIONS.md`, `DESIGN_IMPROVEMENTS.md`.

### Bảng phase (cập nhật 2026-06-21)

| Phase | Backend | Frontend | Verified |
|-------|---------|----------|----------|
| 0 Khởi tạo | ✅ monorepo, Prisma, auth Zalo, RBAC | — | ✅ |
| 1 MVP B2C | ✅ catalog/cart/checkout/orders/Pancake/ZaloPay/ZNS | ✅ miniapp: home/browse/PDP/cart/checkout/orders/profile | ✅ e2e |
| 2 Loyalty+Game | ✅ points/tier/coupons + check-in/spin/quiz/tree/missions/leaderboard + reviews | ✅ miniapp Game page (Vườn Xanh 2.0 đủ 4 phase) | ✅ e2e |
| 3 Affiliate+Cashback | ✅ CTV link/commission/payout + Accesstrade cashback + Ví Tubu | ⏳ FE chưa có (API sẵn sàng) | ✅ e2e |
| 4 Dealer+Admin | ✅ apply/duyệt/bảng giá/đơn/công nợ + admin config CRUD/dealer review | ⏳ FE chưa có (API sẵn sàng) | ✅ e2e |
| 5 Web shop | ✅ catalog SSR + PDP (SEO generateMetadata) | ✅ Next.js (cart/checkout cần auth web) | ✅ e2e |
| 6 Deploy Mini App | — | ✅ Bundle sẵn (`apps/miniapp/www/`, 937KB) | ⏳ Cần `zmp login` + `zmp deploy` |

Mọi tham số nghiệp vụ trong bảng `SystemConfig` (sửa qua `PUT /api/admin/config`). Swagger: `/api/docs`.

**Việc còn lại theo độ ưu tiên:**
1. **`zmp deploy`** — đẩy Mini App lên Zalo (bundle đã build sẵn, xem `DEPLOY_ZALO.md`).
2. FE miniapp cho affiliate/cashback/dealer (API đã xong).
3. Web cart/checkout (cần auth web OTP/Zalo OAuth).
4. Tích hợp key thật: Pancake/ZaloPay/Accesstrade/ZNS (xem `docs/SESSION-HANDOFF.md` mục 5).
5. Upload ảnh KYC/review.

Dev: `apps/api/scripts/dev-token.ts` mint JWT test (`DEV_ROLE=ADMIN` cho admin).

## Trạng thái Phase 0 — Khởi tạo
- [x] Monorepo pnpm + Turborepo
- [x] Prisma schema v0 (toàn bộ model Section 4 + SystemConfig)
- [x] Seed SystemConfig (Section 15) + 4 hạng loyalty + 4 bậc đại lý
- [x] Auth Zalo Mini App (verify token → JWT access/refresh, rotation) + RBAC guards
- [x] Skeleton miniapp (zmp-bridge login/share) + web (Next.js)
- [x] Docker compose dev (Postgres + Redis)

### Việc ngoài-code của Phase 0 (cần con người làm)
- [ ] Đăng ký Zalo Mini App ID + OA + ZNS template (lead time duyệt).
- [ ] Đăng ký Accesstrade Publisher, ZaloPay merchant.
- [ ] Setup Pancake sandbox + lấy API key.
- [x] DNS: `api.tubutree.com` + `app.tubutree.com` — đã LIVE trên GCP VM.
- [ ] Figma chi tiết mini app + web.

## Quy tắc code (Build Spec §19)
1. TypeScript strict, no `any`.
2. Mọi tham số nghiệp vụ đọc từ `SystemConfig` qua `SystemConfigService` — không hard-code.
3. Pancake là source of truth cho catalog/order/shipping/invoice.
4. Đơn tạo ở client → push Pancake idempotent (`external_id`).
5. Mỗi feature: unit test service layer + ≥1 E2E happy path.
6. Stateless API; state ở Postgres + Redis.
