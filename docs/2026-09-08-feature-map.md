# Tubu Tree — Feature map (auto-generated 2026-09-08)

## API modules

| Module | Routes | Files | Spec files | LOC |
|---|---:|---:|---:|---:|
| staff | 36 | 37 | 11 | 3214 |
| brand | 27 | 6 | 1 | 1021 |
| feed | 27 | 8 | 3 | 2629 |
| game | 25 | 23 | 10 | 3579 |
| admin | 18 | 5 | 2 | 1611 |
| storefront | 17 | 8 | 3 | 1350 |
| dealer | 12 | 6 | 1 | 956 |
| affiliate | 11 | 6 | 2 | 1481 |
| academy | 10 | 6 | 1 | 591 |
| flash-sale | 9 | 5 | 1 | 838 |
| merchant | 9 | 4 | 1 | 899 |
| catalog | 8 | 5 | 1 | 650 |
| integrations | 8 | 37 | 12 | 2614 |
| orders | 8 | 4 | 1 | 609 |
| users | 7 | 6 | 1 | 415 |
| auth | 6 | 9 | 1 | 851 |
| cart | 6 | 5 | 1 | 580 |
| cashback | 5 | 10 | 4 | 1074 |
| faq | 5 | 6 | 1 | 236 |
| refill | 5 | 4 | 1 | 356 |
| beta | 4 | 4 | 1 | 226 |
| cskh | 4 | 5 | 1 | 273 |
| groupbuy | 4 | 5 | 1 | 584 |
| loyalty | 4 | 11 | 4 | 1461 |
| reviews | 4 | 5 | 1 | 443 |
| subscriptions | 4 | 4 | 1 | 590 |
| wallet | 4 | 6 | 2 | 732 |
| wishlist | 4 | 4 | 1 | 262 |
| content-kit | 3 | 6 | 1 | 359 |
| checkout | 2 | 6 | 2 | 1017 |
| notifications | 2 | 4 | 1 | 202 |
| ai-advisor | 1 | 6 | 2 | 432 |
| health | 1 | 2 | 0 | 34 |
| system-config | 1 | 5 | 2 | 256 |
| coupons | 0 | 5 | 2 | 581 |
| lifecycle | 0 | 5 | 2 | 573 |
| pricing | 0 | 3 | 1 | 153 |
| vouchers | 0 | 3 | 1 | 304 |

Totals: modules 38, routes 301, spec files 85, API LOC 34036

Modules with ZERO spec files: health

## Prisma models

Total models: 95

Models never accessed via prisma.<model> in non-test API code (1): MissionProgress

## Miniapp pages

Total pages: 41

Pages not referenced in components/app.tsx (0): none

## FE→API wiring

- Distinct API routes: 298
- Distinct FE call sites: 271
# Route reconciliation

- API routes (unique): 298
- FE call sites (unique): 270
- API routes with no FE caller: 33
- FE calls with no matching API route: 5

## FE calls with NO matching API route (potential 404s)

- `GET /:p` — apps/web/src/lib/client-api.ts
- `GET /admin/config${category ` — apps/web/src/lib/admin-client.ts
- `GET /admin/dealer-applications${status ` — apps/web/src/lib/admin-client.ts
- `GET /admin/return-requests${status ` — apps/web/src/lib/admin-client.ts
- `GET /merchant/orders${status ` — apps/web/src/lib/merchant-client.ts

## API routes with NO FE caller

- `DELETE /reviews/:p` — apps/api/src/modules/reviews/reviews.controller.ts
- `GET /admin/attendance/live` — apps/api/src/modules/staff/attendance/admin-attendance.controller.ts
- `GET /admin/config` — apps/api/src/modules/admin/admin.controller.ts
- `GET /admin/dealer-applications` — apps/api/src/modules/admin/admin.controller.ts
- `GET /admin/dealer-prices/history` — apps/api/src/modules/admin/admin.controller.ts
- `GET /admin/orders` — apps/api/src/modules/admin/admin.controller.ts
- `GET /admin/return-requests` — apps/api/src/modules/admin/admin.controller.ts
- `GET /admin/users` — apps/api/src/modules/admin/admin.controller.ts
- `GET /auth/me` — apps/api/src/modules/auth/auth.controller.ts
- `GET /brand/owner/me/promotions` — apps/api/src/modules/brand/brand.controller.ts
- `GET /categories` — apps/api/src/modules/catalog/catalog.controller.ts
- `GET /faqs` — apps/api/src/modules/faq/faq.controller.ts
- `GET /feed/events/:p` — apps/api/src/modules/feed/community-feed.controller.ts
- `GET /health` — apps/api/src/modules/health/health.controller.ts
- `GET /merchant/orders` — apps/api/src/modules/merchant/merchant.controller.ts
- `GET /storefront/by-host` — apps/api/src/modules/storefront/storefront.controller.ts
- `PATCH /admin/dealer-rewards/:p` — apps/api/src/modules/brand/brand-admin.controller.ts
- `PATCH /admin/promotions/:p` — apps/api/src/modules/brand/brand-admin.controller.ts
- `POST /admin/attendance/manual-checkout` — apps/api/src/modules/staff/attendance/admin-attendance.controller.ts
- `POST /admin/brands/:p/products` — apps/api/src/modules/brand/brand-admin.controller.ts
- `POST /admin/pancake/sync` — apps/api/src/modules/integrations/pancake/pancake.controller.ts
- `POST /admin/payroll/:p/recompute` — apps/api/src/modules/staff/payroll/admin-payroll.controller.ts
- `POST /admin/products/recompute-sold` — apps/api/src/modules/admin/admin.controller.ts
- `POST /me/redeem-points` — apps/api/src/modules/loyalty/loyalty.controller.ts
- `POST /orders/:p/issue-invoice` — apps/api/src/modules/orders/orders.controller.ts
- `POST /orders/:p/track` — apps/api/src/modules/orders/orders.controller.ts
- `POST /payments/zalopay/create` — apps/api/src/modules/integrations/payment/payment.controller.ts
- `POST /reviews/:p/visibility` — apps/api/src/modules/reviews/reviews.controller.ts
- `POST /webhooks/accesstrade` — apps/api/src/modules/cashback/cashback.controller.ts
- `POST /webhooks/cashback/:p` — apps/api/src/modules/cashback/cashback.controller.ts
- `POST /webhooks/pancake` — apps/api/src/modules/integrations/pancake/pancake-webhook.controller.ts
- `POST /webhooks/zalo-oa` — apps/api/src/modules/integrations/zalo-oa/zalo-oa-webhook.controller.ts
- `POST /webhooks/zalopay` — apps/api/src/modules/integrations/payment/payment.controller.ts
# Miniapp UI hard-coded value audit

Files scanned (excluding tokens.css): 119
Total lines: 25212

- Distinct hard-coded hex colors: **53** (occurrences: 160)
- Distinct rgb/rgba literals: **30** (occurrences: 74)
- Distinct px values: **34** (occurrences: 475)
- Inline `style={{` occurrences: **2095**

## Top 30 hex colors

- `#211003` ×20
- `#fff` ×18
- `#ffffff` ×14
- `#8d6e63` ×8
- `#3e2723` ×8
- `#ffd54f` ×8
- `#da251d` ×7
- `#d7ccc8` ×5
- `#7a5c3a` ×4
- `#4a2c20` ×4
- `#5d4037` ×4
- `#a0a0a0` ×3
- `#000` ×3
- `#d4843e` ×3
- `#6d4c41` ×3
- `#a1887f` ×3
- `#e8b72c` ×2
- `#4e342e` ×2
- `#8b3a3a` ×2
- `#6b6b6b` ×2
- `#c9b280` ×2
- `#dca84a` ×2
- `#16a34a` ×2
- `#7a8b5c` ×2
- `#121212` ×1
- `#000000` ×1
- `#1a1a17` ×1
- `#dcdcdc` ×1
- `#fbc02d` ×1
- `#f57f17` ×1

## Top 30 px values

- `1px` ×120
- `8px` ×51
- `12px` ×46
- `16px` ×40
- `6px` ×34
- `10px` ×31
- `2px` ×28
- `4px` ×19
- `3px` ×16
- `24px` ×13
- `14px` ×13
- `1.5px` ×11
- `20px` ×8
- `9px` ×6
- `32px` ×5
- `18px` ×4
- `40px` ×4
- `60px` ×3
- `15px` ×2
- `240px` ×2
- `132px` ×2
- `7px` ×2
- `64px` ×2
- `150px` ×2
- `30px` ×2
- `9999px` ×1
- `36px` ×1
- `88px` ×1
- `48px` ×1
- `56px` ×1

## Top 25 files by inline-style density

- apps/miniapp/src/pages/game.tsx — inline 162, hex 0, px 22 (1239 lines)
- apps/miniapp/src/pages/dealer.tsx — inline 128, hex 0, px 18 (876 lines)
- apps/miniapp/src/pages/affiliate.tsx — inline 81, hex 1, px 15 (752 lines)
- apps/miniapp/src/pages/product-detail.tsx — inline 81, hex 0, px 25 (897 lines)
- apps/miniapp/src/pages/admin.tsx — inline 77, hex 0, px 8 (941 lines)
- apps/miniapp/src/pages/checkout.tsx — inline 71, hex 0, px 12 (821 lines)
- apps/miniapp/src/pages/order-detail.tsx — inline 66, hex 0, px 7 (558 lines)
- apps/miniapp/src/pages/post-detail.tsx — inline 66, hex 0, px 15 (684 lines)
- apps/miniapp/src/pages/wallet.tsx — inline 65, hex 0, px 9 (392 lines)
- apps/miniapp/src/pages/storefront-builder.tsx — inline 64, hex 8, px 16 (496 lines)
- apps/miniapp/src/pages/staff.tsx — inline 58, hex 0, px 7 (767 lines)
- apps/miniapp/src/pages/loyalty.tsx — inline 50, hex 0, px 12 (452 lines)
- apps/miniapp/src/components/affiliate/ctv-order-sheet.tsx — inline 46, hex 0, px 10 (520 lines)
- apps/miniapp/src/pages/cart.tsx — inline 44, hex 1, px 13 (610 lines)
- apps/miniapp/src/pages/brand-view.tsx — inline 39, hex 1, px 8 (251 lines)
- apps/miniapp/src/pages/home.tsx — inline 39, hex 9, px 25 (447 lines)
- apps/miniapp/src/components/reviews-section.tsx — inline 36, hex 1, px 8 (290 lines)
- apps/miniapp/src/pages/community-moderation.tsx — inline 35, hex 0, px 3 (460 lines)
- apps/miniapp/src/pages/my-payroll.tsx — inline 35, hex 0, px 6 (236 lines)
- apps/miniapp/src/pages/profile.tsx — inline 34, hex 0, px 11 (371 lines)
- apps/miniapp/src/pages/refill.tsx — inline 34, hex 0, px 6 (210 lines)
- apps/miniapp/src/pages/bank-payment.tsx — inline 33, hex 0, px 7 (199 lines)
- apps/miniapp/src/pages/cashback.tsx — inline 33, hex 3, px 5 (262 lines)
- apps/miniapp/src/components/checkout/voucher-sheet.tsx — inline 31, hex 0, px 11 (298 lines)
- apps/miniapp/src/pages/about.tsx — inline 30, hex 1, px 8 (284 lines)
