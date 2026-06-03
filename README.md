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

## Tiến độ tổng quan (2026-06-03)

| Phase | Backend | Frontend | Verified |
|-------|---------|----------|----------|
| 0 Khởi tạo | ✅ monorepo, Prisma, auth Zalo, RBAC | — | ✅ |
| 1 MVP B2C | ✅ catalog/cart/checkout/orders/Pancake/ZaloPay/ZNS | ✅ miniapp: home/browse/PDP/cart/checkout/orders/profile | ✅ e2e |
| 2 Loyalty+Game | ✅ points/tier/coupons + check-in/spin/quiz/tree/missions/leaderboard + reviews | ✅ miniapp Game page | ✅ e2e |
| 3 Affiliate+Cashback | ✅ CTV link/commission/payout + Accesstrade cashback + Ví Tubu | ⏳ (API sẵn sàng) | ✅ e2e |
| 4 Dealer+Admin | ✅ apply/duyệt/bảng giá/đơn/công nợ + admin config CRUD/dealer review | ⏳ (API sẵn sàng) | ✅ e2e |
| 5 Web shop | ✅ catalog SSR + PDP (SEO generateMetadata) | ✅ Next.js | ✅ e2e |

Mọi tham số nghiệp vụ trong bảng `SystemConfig` (sửa qua `PUT /api/admin/config`). Swagger: `/api/docs`.
**Còn lại:** FE miniapp cho affiliate/cashback/dealer (API đã xong); web cart/checkout (cần auth web OTP/Zalo OAuth); upload ảnh KYC/review; tích hợp thật cần API key (Pancake/ZaloPay/Accesstrade/ZNS). Dev: `apps/api/scripts/dev-token.ts` mint JWT test (`DEV_ROLE=ADMIN` cho admin).

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
- [ ] DNS: api.tubutree.com, shop.tubutree.com.
- [ ] Figma chi tiết mini app + web.

## Quy tắc code (Build Spec §19)
1. TypeScript strict, no `any`.
2. Mọi tham số nghiệp vụ đọc từ `SystemConfig` qua `SystemConfigService` — không hard-code.
3. Pancake là source of truth cho catalog/order/shipping/invoice.
4. Đơn tạo ở client → push Pancake idempotent (`external_id`).
5. Mỗi feature: unit test service layer + ≥1 E2E happy path.
6. Stateless API; state ở Postgres + Redis.
