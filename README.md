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

## Tiến độ tổng quan (cập nhật 2026-09-01, verify trực tiếp trên code)

> **Backend: 36 module** (catalog, checkout, orders, loyalty, game/Vườn Xanh, affiliate, cashback (provider-agnostic), dealer B2B, flash-sale, groupbuy, subscriptions, storefront CTV, brand, staff (RBAC/ca làm/chấm công/lương), academy, content-kit, community feed, refill, wishlist, reviews, ai-advisor, notifications, vouchers, wallet, beta, faq, lifecycle, v.v.) — **typecheck sạch, 80/80 test suite · 1043/1043 unit test PASS** (verify lại trực tiếp, không chỉ dựa tài liệu cũ).
> Miniapp (36 trang) + Web đều typecheck sạch. Commit gần nhất trên `main`: 2026-07-30.
> Toàn bộ blocker bảo mật/money-path từng ghi nhận (webhook fail-open, thiếu rate-limit, oversell, hoàn ví 2 lần…) đã xác nhận **FIX trong code hiện tại** (fail-closed theo `NODE_ENV`, `@nestjs/throttler` global, trừ stock atomic `updateMany+gte`, exception filter, healthcheck compose).

### Việc còn tồn đọng (thực tế, không phải backlog cũ)

1. **Ngoài-code — chờ cấp/duyệt:** key **ZaloPay**, **Zalo OA + Template ID ZNS** (lead time ~7–14 ngày), **Accesstrade** — xem `docs/GO-LIVE-KEYS.md`. Thiếu key thì hệ thống tự fallback an toàn (COD/Ví/TubuXu vẫn chạy đủ), không sập.
2. **`zmp deploy`** lên Zalo Mini App Studio — cần phiên đăng nhập Zalo dev thủ công, xem `DEPLOY_ZALO.md`.
3. **Tích hợp PanNature** (trồng cây thật khi đủ mốc cộng đồng) — chưa có đầu mối.
4. **Gap tính năng tăng trưởng** (nghiên cứu `docs/2026-07-05-growth-features-research-roadmap.md`): Quỹ/CLB gây quỹ qua cashback (mô hình WeShare/FlipGive), live commerce/video ngắn, chat/CSKH trong app, cổng thanh toán VNPAY — đều **chưa có trong code**, là hướng mở rộng chứ không phải nợ kỹ thuật.
5. Vài gap nhỏ đã biết: CTV "lên đơn hộ" chưa đẩy sang Pancake fulfillment; remarketing/point-expiry/flash-reminder mới chỉ gửi kênh INAPP (chưa ZNS).

Mọi tham số nghiệp vụ đọc từ bảng `SystemConfig` (sửa qua `PUT /api/admin/config`). Swagger: `/api/docs`.

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
