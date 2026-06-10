# TUBU TREE — BUILD CONTEXT EXPORT

Ngày xuất: 2026-06-10 (repo commit cuối: 2026-06-03)
Branch hiện tại: `main` (clean, đồng bộ origin/main)
Commit cuối: `907d8e6` "chore: merge history from legacy mini_app branch"
Spec gốc: `design_handoff/specs/TUBU_TREE_BUILD_SPEC_v1.1.md` (2778 dòng)

---

## 1. Tổng quan tiến độ

Ước tính tổng thể: **~70% hoàn thành** so với SPEC v1.1

| Layer | Status | Ghi chú |
|-------|--------|---------|
| Monorepo setup | ✅ DONE | pnpm 9 + Turborepo, 3 apps + 3 packages |
| Backend NestJS | ✅ DONE | 20 modules, service + controller đầy đủ |
| Database schema | ✅ DONE | 35 models, 3 migrations |
| Mini App (Phase 1-2) | ✅ DONE | 9 trang B2C + Game |
| Mini App (Phase 3-4) | 🔴 MISSING | Affiliate/Cashback/Dealer FE chưa có |
| Web Shop | 🟡 PARTIAL | Chỉ có catalog homepage + PDP, thiếu cart/checkout/auth |
| Integrations | 🟡 PARTIAL | Pancake ✅, ZaloPay 🟡 code only, ZNS 🟡 code only, Accesstrade 🟡 webhook only |
| Tests | 🔴 MINIMAL | Chỉ 1 file spec (pricing.service.spec.ts) |
| CI/CD | 🔴 EMPTY | Không có .github/workflows |
| Deployment | 🟡 PARTIAL | Railway đã cấu hình (commits), Dockerfile không còn ở main |
| Design handoff | ✅ DONE | 14 HTML batch screens, 2 spec files |

---

## 2. Cây thư mục (rút gọn)

```
tubutree-mini-app/
├── apps/
│   ├── api/                  NestJS + Prisma (port 3001)
│   │   ├── prisma/
│   │   │   ├── schema.prisma  (35 models, 748 dòng)
│   │   │   ├── seed.ts        (367 dòng — SystemConfig + tiers)
│   │   │   └── migrations/    (3 migrations)
│   │   ├── scripts/
│   │   │   └── dev-token.ts   (mint JWT test)
│   │   └── src/
│   │       ├── app.module.ts  (67 dòng — 20 module imports)
│   │       ├── main.ts
│   │       ├── common/        decorators, guards (jwt, roles)
│   │       ├── config/        env.validation.ts (zod, 51 dòng)
│   │       ├── jobs/          queue.module + queues (BullMQ)
│   │       ├── prisma/        PrismaService
│   │       └── modules/
│   │           ├── admin/          ✅ service+controller (79+126 dòng)
│   │           ├── affiliate/      ✅ service+controller (227+55 dòng)
│   │           ├── auth/           ✅ service+controller+zalo+strategies
│   │           ├── cart/           ✅ service+controller (135+43 dòng)
│   │           ├── cashback/       ✅ service+controller (138+45 dòng)
│   │           ├── catalog/        ✅ service+controller (115+40 dòng)
│   │           ├── checkout/       ✅ service+controller (243+? dòng)
│   │           ├── coupons/        ✅ service (70 dòng), NO controller
│   │           ├── dealer/         ✅ service+controller (189+50 dòng)
│   │           ├── game/           ✅ service+controller (290+58 dòng)
│   │           ├── health/         ✅ basic health check
│   │           ├── integrations/
│   │           │   ├── pancake/    ✅ client+order+sync+webhook+processor (6 files, ~620 dòng)
│   │           │   ├── payment/    🟡 zalopay.service.ts (111 dòng), no real keys
│   │           │   └── zns/        🟡 zns.client.ts (46 dòng), env-gated
│   │           ├── loyalty/        ✅ service+controller (201+46 dòng)
│   │           ├── notifications/  🟡 service+controller (67 dòng), dùng ZNS client
│   │           ├── orders/         ✅ service+controller (98+47 dòng)
│   │           ├── pricing/        ✅ service+spec (65+67 dòng) — duy nhất có test
│   │           ├── reviews/        ✅ service+controller (89+? dòng)
│   │           ├── system-config/  ✅ service (56 dòng), NO controller riêng
│   │           ├── users/          ✅ service+controller (98+44 dòng)
│   │           └── wallet/         ✅ service+controller (50+? dòng)
│   │
│   ├── miniapp/              Zalo Mini App: React + ZaUI + zmp-sdk (port via zmp-cli)
│   │   ├── app-config.json
│   │   └── src/
│   │       ├── app.tsx        entry, 9 routes
│   │       ├── components/    app.tsx, bottom-nav.tsx, product-card.tsx
│   │       ├── pages/         9 trang (xem Section 5)
│   │       ├── services/      api.ts, shop-api.ts, game-api.ts, zmp-bridge.ts
│   │       ├── store/         auth.ts (zustand, 87 dòng)
│   │       └── utils/         format.ts
│   │
│   └── web/                  Next.js 14 App Router (port 3000)
│       └── src/
│           ├── app/
│           │   ├── layout.tsx       (15 dòng — bare layout)
│           │   ├── page.tsx         (56 dòng — catalog homepage SSR)
│           │   └── san-pham/[slug]/ (92 dòng — PDP SSR + SEO)
│           ├── components/
│           │   └── product-card.tsx (32 dòng)
│           └── lib/
│               └── api.ts           (79 dòng — fetch helpers)
│
├── packages/
│   ├── shared-types/    auth.ts, catalog.ts, enums.ts, order.ts (267 dòng tổng)
│   ├── eslint-config/   flat config shared
│   └── typescript-config/ base/nestjs/nextjs/react presets
│
├── design_handoff/
│   ├── specs/           TUBU_TREE_BUILD_SPEC_v1.1.md + DESIGN_BRIEF.md
│   ├── m1_brand/        Brand foundation HTML
│   ├── m2_design_system/ Design system HTML
│   ├── m3_screens/      Batch 1-12 (Home→Dealer B2B, 12 files)
│   └── m4_screens/      Batch 13-15 (Profile, Review/Wishlist/Flash/Wheel, States)
│
├── docker-compose.dev.yml  (Postgres 5434 + Redis 6381)
├── turbo.json
├── pnpm-workspace.yaml
└── README.md
```

---

## 3. Trạng thái runtime (chưa chạy — ghi nhận từ code review)

> Môi trường build chưa được verify trong phiên này. Ghi chú từ code:

| App | pnpm install | typecheck | lint | test | build |
|-----|-------------|-----------|------|------|-------|
| api | Cần verify | Cần verify | Cần verify | 1 spec pass (pricing) | Cần verify |
| miniapp | Cần verify | Cần verify | Cần verify | N/A | Cần verify |
| web | Cần verify | Cần verify | Cần verify | N/A | Cần verify |

**Cần chạy để verify:**
```bash
cd /path/to/tubutree-mini-app
pnpm install --frozen-lockfile
pnpm --filter @tubutree/api typecheck
pnpm --filter @tubutree/miniapp typecheck
pnpm --filter @tubutree/web typecheck
pnpm --filter @tubutree/api test --passWithNoTests
```

---

## 4. Database

**Prisma schema:** `apps/api/prisma/schema.prisma` (748 dòng)

**Số model: 35**

| Domain | Models |
|--------|--------|
| User & Auth | User, RefreshToken, MembershipTier, Address |
| Catalog | Product, Variation, Category |
| Cart & Order | Cart, CartItem, Order, OrderItem |
| Loyalty & Coupon | PointsTransaction, Coupon, CouponRedemption |
| Affiliate | AffiliateLink, AffiliateClick, Commission, Payout |
| Cashback | CashbackMerchant, CashbackClick, CashbackTransaction |
| Dealer B2B | DealerApplication, DealerTier, DealerCreditLedger |
| Game | GameProfile, GameSpin, GameQuiz, GameQuizAttempt, Mission, MissionProgress |
| Reviews | Review |
| Notifications | NotificationTemplate, NotificationLog |
| Webhook | PancakeWebhookEvent |
| Config | SystemConfig, SystemConfigHistory |

**Migrations (3 files):**
- `20260602161717_init` — Schema khởi tạo đầy đủ
- `20260602170000_phase1_orders_idempotency` — Thêm idempotencyKey cho Order
- `20260603100000_phase3_commission_locked_at` — Thêm lockedAt cho Commission

**Seed:** `prisma/seed.ts` (367 dòng) — SystemConfig (Section 15) + 4 MembershipTier + 4 DealerTier

**DB local:** Cần `pnpm dev:infra` để bật Docker (Postgres 5434, Redis 6381)

---

## 5. Integrations

| Integration | Status | Files | Ghi chú |
|-------------|--------|-------|---------|
| Pancake POS | ✅ CODE REAL | `modules/integrations/pancake/` (6 files, ~620 dòng) | client, order create, sync, webhook, BullMQ processor, status mapping. API key cần điền vào env |
| ZaloPay | 🟡 CODE MOCK | `modules/integrations/payment/zalopay.service.ts` (111 dòng) | HMAC signing, create payment, callback webhook. Cần APP_ID + KEY1/KEY2 thật |
| ZNS | 🟡 CODE MOCK | `modules/integrations/zns/zns.client.ts` (46 dòng) | HTTP client đã build, gated by `ZALO_OA_ACCESS_TOKEN`. Cần OA token thật |
| Accesstrade | 🟡 PARTIAL | Webhook endpoint tại `POST /cashback/webhooks/accesstrade` | Chỉ có webhook receiver, chưa có client để call Accesstrade API tạo deeplink |
| Zalo Auth | ✅ CODE REAL | `modules/auth/zalo.service.ts` + strategies/jwt | Verify token, access/refresh JWT rotation. Cần ZALO_APP_ID + SECRET thật |

**Env vars cần điền (tất cả rỗng trong .env.example):**
```
ZALO_APP_ID, ZALO_APP_SECRET, ZALO_OA_ACCESS_TOKEN
PANCAKE_API_KEY, PANCAKE_BASE_URL, PANCAKE_SHOP_ID, PANCAKE_WAREHOUSE_ID
ZALOPAY_APP_ID, ZALOPAY_KEY1, ZALOPAY_KEY2
ZNS_BASE_URL
ACCESSTRADE_BASE_URL (có default), ACCESSTRADE_PUBLISHER_ID
```

---

## 6. Screens đã implement

### Mini App (apps/miniapp) — 9/~30 screens từ design

| Trang | File | Dòng | Status |
|-------|------|------|--------|
| Home | pages/home.tsx | 63 | ✅ Featured products, banner |
| Browse / Catalog | pages/browse.tsx | 71 | ✅ Search + filter + list |
| Product Detail | pages/product-detail.tsx | 163 | ✅ Variations, cart, share, giá sỉ |
| Cart | pages/cart.tsx | 158 | ✅ Items, coupon, points toggle |
| Checkout | pages/checkout.tsx | 255 | ✅ Địa chỉ, payment method, voucher |
| Orders | pages/orders.tsx | 83 | ✅ List, tab filter theo status |
| Order Detail | pages/order-detail.tsx | 108 | ✅ Timeline, items, tracking |
| Game (Vườn Xanh) | pages/game.tsx | 207 | ✅ Check-in, spin, quiz, tree |
| Profile | pages/profile.tsx | 67 | ✅ Tier, referral, links |

**Thiếu trong Mini App (Phase 3-4, API đã xong):**
- ❌ Trang Affiliate / CTV (commission, links, analytics)
- ❌ Trang Cashback (danh sách merchant, click tracking)
- ❌ Trang Ví Tubu (wallet balance, lịch sử, payout)
- ❌ Trang Đại lý / Dealer B2B (apply, giá sỉ, đơn dealer)
- ❌ Trang Admin (chỉ backend, không có FE)
- ❌ Onboarding screens (Batch 7)
- ❌ Wishlist, Flash sale, Wheel (Batch 14)
- ❌ Upload ảnh KYC/Review (multer đã cài nhưng chưa có UI)

### Web Shop (apps/web) — 3/~10 screens

| Route | File | Dòng | Status |
|-------|------|------|--------|
| / (catalog) | app/page.tsx | 56 | ✅ SSR product grid |
| /san-pham/[slug] | app/san-pham/[slug]/page.tsx | 92 | ✅ PDP + SEO generateMetadata |
| /gio-hang | — | — | ❌ Chưa có |
| /thanh-toan | — | — | ❌ Chưa có (cần auth) |
| /tai-khoan | — | — | ❌ Chưa có (auth web OTP/Zalo OAuth) |

---

## 7. Mapping với SPEC v1.1

### Section 4 — Data Model
- **Spec yêu cầu:** ~35 models (Sections 4.1–4.11)
- **Đã có:** 35 models ✅ — khớp hoàn toàn

### Section 6 — Tính năng

| Feature | Backend | FE Miniapp | FE Web |
|---------|---------|------------|--------|
| 6.1 Auth (Zalo + JWT) | ✅ DONE | ✅ DONE | ❌ EMPTY |
| 6.2 Catalog (Pancake sync) | ✅ DONE | ✅ DONE | ✅ DONE (SSR) |
| 6.3 Cart | ✅ DONE | ✅ DONE | ❌ EMPTY |
| 6.4 Checkout + idempotency | ✅ DONE | ✅ DONE | ❌ EMPTY |
| 6.5 Orders + tracking | ✅ DONE | ✅ DONE | ❌ EMPTY |
| 6.6 Loyalty / Points | ✅ DONE | 🟡 (profile page only) | ❌ EMPTY |
| 6.7 Coupons | ✅ DONE (service only) | 🟡 (checkout wired) | ❌ EMPTY |
| 6.8 Game — Vườn Xanh | ✅ DONE | ✅ DONE | N/A |
| 6.9 Affiliate (CTV) | ✅ DONE | ❌ EMPTY | N/A |
| 6.10 Cashback Accesstrade | 🟡 PARTIAL | ❌ EMPTY | N/A |
| 6.11 Ví Tubu (Wallet) | ✅ DONE | ❌ EMPTY | N/A |
| 6.12 Dealer B2B | ✅ DONE | ❌ EMPTY | N/A |
| 6.13 Reviews | ✅ DONE | ❌ EMPTY | N/A |
| 6.14 Admin CRUD | ✅ DONE | ❌ EMPTY | N/A |

### Section 7 — UI
- **Design system:** Có đầy đủ HTML handoff (m1-m4, 14 batch screens)
- **Tokens CSS:** `apps/miniapp/src/css/tokens.css` đã có
- **Component library:** Rất minimal (3 components: app.tsx, bottom-nav.tsx, product-card.tsx)
- **Màn hình thiếu:** ~21 screens chưa code theo design batches

### Section 8 — Pancake POS
- ✅ `PancakeClient` (REST wrapper)
- ✅ `PancakeOrderService` (tạo đơn idempotent, cancel)
- ✅ `PancakeSyncService` (sync catalog từ Pancake)
- ✅ `PancakeWebhookController` (nhận webhook)
- ✅ `PancakeProcessor` (BullMQ queue)
- 🟡 Cần điền `PANCAKE_API_KEY`, `PANCAKE_SHOP_ID`, `PANCAKE_WAREHOUSE_ID` thật

### Section 9 — Accesstrade
- 🟡 Có webhook receiver (`POST /cashback/webhooks/accesstrade`)
- 🟡 Có `CashbackService` với `processPostback()` logic (138 dòng)
- ❌ Thiếu: client gọi Accesstrade API để generate deeplink
- ❌ Thiếu: FE màn Cashback merchant browser

### Section 10 — ZaloPay
- 🟡 `ZalopayService` (111 dòng): HMAC-256 signing, createPayment, callback verify
- 🟡 Endpoint: `POST /payments/zalopay/create`, `POST /payments/zalopay/callback`
- ❌ Cần real keys: `ZALOPAY_APP_ID`, `ZALOPAY_KEY1`, `ZALOPAY_KEY2`

### Section 11 — ZNS
- 🟡 `ZnsClient` (46 dòng): HTTP client gửi template notification
- 🟡 `NotificationsService` (67 dòng): gọi ZNS hoặc fallback inapp log
- ❌ Cần `ZALO_OA_ACCESS_TOKEN` thật + template IDs đăng ký

### Section 13 — Bảo mật
- ✅ JwtAuthGuard global (APP_GUARD)
- ✅ RolesGuard global (APP_GUARD)
- ✅ Refresh token rotation (hash lưu DB)
- ✅ Helmet, validation pipe
- ✅ Idempotency key cho checkout

### Section 14 — Roadmap
| Phase | Backend | FE |
|-------|---------|-----|
| 0 Khởi tạo | ✅ | ✅ |
| 1 MVP B2C | ✅ | ✅ miniapp |
| 2 Loyalty+Game | ✅ | ✅ miniapp |
| 3 Affiliate+Cashback | ✅ | ❌ miniapp missing |
| 4 Dealer+Admin | ✅ | ❌ miniapp missing |
| 5 Web shop | ✅ | 🟡 partial (catalog+PDP only) |

### Section 16 — WordPress Migration
- ❌ EMPTY — chưa bắt đầu

---

## 8. Deployment & DevOps

**CI/CD:** ❌ Không có `.github/workflows/`

**Docker:**
- `docker-compose.dev.yml` ✅ — Postgres 5434 + Redis 6381
- Dockerfile: Đã từng có (commit `d750502`, `434dd1e`), nhưng **không còn trong main branch**
- Railway: Đã có setup scripts (commit `d4d2c60`, `aac1f88`), nhưng configs không còn trong main

**Targets deploy (từ README + commits):**
- API: Railway (NestJS + Prisma)
- Web: Vercel hoặc Railway
- Mini App: Zalo Mini App Store (cần `zmp-cli deploy`)

**DNS cần setup (chưa làm):**
- `api.tubutree.com`
- `shop.tubutree.com`

---

## 9. Testing

**Tình trạng:** Cực kỳ minimal

| App | Test files | Coverage |
|-----|-----------|---------|
| api | `pricing.service.spec.ts` (67 dòng, 1 file) | Chỉ pricing logic |
| miniapp | 0 | 0% |
| web | 0 | 0% |

**Cần thêm (theo spec §5):**
- Unit test cho mỗi service: auth, cart, checkout, orders, loyalty, game, affiliate, dealer
- E2E test cho happy path mỗi feature
- Hiện tại chỉ có: jest.config.js đã setup, `@nestjs/testing` đã cài

---

## 10. TODO và Việc cần làm ngay

### Ưu tiên cao — FE còn thiếu (API đã sẵn sàng)
1. **Mini App: Trang Affiliate/CTV** — `POST /affiliate/links`, commission list, analytics
2. **Mini App: Trang Cashback** — merchant browser, click tracking (cần Accesstrade deeplink API)
3. **Mini App: Trang Ví Tubu** — wallet balance, lịch sử, request payout
4. **Mini App: Trang Dealer** — apply form (KYC upload), giá sỉ, đơn dealer

### Ưu tiên trung — Web shop
5. **Web: Auth** — OTP login hoặc Zalo OAuth cho web
6. **Web: Cart + Checkout** — sau khi có auth

### Ưu tiên thấp hơn — Infrastructure
7. **Tests** — unit tests cho API services còn thiếu
8. **CI/CD** — GitHub Actions (build, typecheck, test)
9. **Dockerfile** — khôi phục hoặc viết mới cho Railway deploy
10. **Accesstrade client** — tạo deeplink (cần Publisher ID thật)

### Việc ngoài-code (cần con người)
- [ ] Đăng ký Zalo Mini App ID + OA + ZNS template (lead time duyệt ~2-4 tuần)
- [ ] Đăng ký Accesstrade Publisher, lấy Publisher ID
- [ ] Setup Pancake sandbox, lấy API key
- [ ] ZaloPay merchant registration
- [ ] DNS setup: api.tubutree.com, shop.tubutree.com

---

## 11. Hướng dẫn cho phiên kế tiếp

### Khởi tạo môi trường dev
```bash
cd /path/to/tubutree-mini-app
pnpm install
cp apps/api/.env.example apps/api/.env
# Điền env vars cần thiết
pnpm dev:infra                  # bật Postgres + Redis
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm --filter @tubutree/api dev # port 3001
```

### Bắt đầu trang mới trong miniapp
```bash
# Xem app.tsx để biết routing pattern
cat apps/miniapp/src/components/app.tsx
# Xem shop-api.ts để biết API call pattern
cat apps/miniapp/src/services/shop-api.ts
# Xem profile.tsx làm template trang đơn giản
cat apps/miniapp/src/pages/profile.tsx
# Xem checkout.tsx làm template trang phức tạp
cat apps/miniapp/src/pages/checkout.tsx
```

### Design screens cần xem
- Affiliate/CTV: `design_handoff/m3_screens/Tubu Tree - M3 Batch 9 (CTV).html`
- Cashback: `design_handoff/m3_screens/Tubu Tree - M3 Batch 10 (Cashback).html`
- Dealer: `design_handoff/m3_screens/Tubu Tree - M3 Batch 11 (Dealer B2B).html`
- Profile: `design_handoff/m4_screens/Tubu Tree - M4 Batch 13 (Profile).html`

### API endpoints affiliate (đã có)
- `POST /affiliate/links` — tạo link CTV
- `GET /affiliate/links` — list link của user
- `GET /affiliate/dashboard` — stats (commission, clicks, conversions)
- `GET /affiliate/commissions` — lịch sử hoa hồng
- `POST /affiliate/payouts` — yêu cầu rút tiền

### API endpoints wallet (đã có)
- `GET /wallet/balance` — số dư
- `GET /wallet/transactions` — lịch sử
- `POST /wallet/payouts` — yêu cầu payout

### API endpoints dealer (đã có)
- `POST /dealer/apply` — đăng ký đại lý (form + KYC)
- `GET /dealer/status` — trạng thái đơn xét duyệt
- `GET /dealer/price-list` — bảng giá sỉ
- `GET /dealer/orders` — đơn hàng dealer
- `GET /dealer/credit` — hạn mức & công nợ

---

## 12. Thông tin kỹ thuật nhanh

| Item | Giá trị |
|------|---------|
| Node yêu cầu | ≥ 20 |
| pnpm version | 9.15.9 |
| Postgres port (dev) | 5434 |
| Redis port (dev) | 6381 |
| API port | 3001 |
| Web port | 3000 |
| Miniapp dev | `zmp start` (cần zmp-cli login) |
| Swagger UI | `http://localhost:3001/api/docs` |
| Dev JWT | `npx tsx apps/api/scripts/dev-token.ts` (set `DEV_ROLE=ADMIN` cho admin) |
| Total source lines | API ~5,400 + Miniapp ~1,716 + Web ~442 + Shared ~267 ≈ 7,800 dòng |

---

*File này được generate tự động từ code audit — 2026-06-10. Verify lại bằng cách chạy typecheck và tests trước khi build.*
