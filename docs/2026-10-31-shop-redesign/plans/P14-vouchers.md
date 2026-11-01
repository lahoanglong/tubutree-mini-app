# P14 `vouchers` (Mã giảm giá, kho mã, Ưu đãi) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kho mã giảm giá công khai (`/vouchers` ↔ `/ma-giam-gia`) với tab Nhận mã / Mã của tôi / Đã dùng–hết hạn, dựng lại `/offers` ↔ `/uu-dai` theo §4 Q10 (công khai, rời `AccountShell`), và làm gọn các việc mở của đợt 4a.

**Architecture:** `Coupon.listed` + `Coupon.title` chỉ quyết định mã có hiện ở kho hay không; nhận mã vẫn là `POST /coupons/claim` (khoá advisory theo mã, không đổi), cách tính giảm giá khi báo giá/đặt đơn không đổi. `GET /coupons/collectable` công khai (cache CATALOG) trả mã `listed` còn hạn còn lượt; trạng thái riêng của khách (đã nhận) ghép phía client từ `/me/coupons`, vì route công khai có cache không được trộn dữ liệu theo khách (backend-gap §0). Logic tab/lọc/ghép dữ liệu ở `packages/app-core/src/commerce/voucher-center.ts`; hai app chỉ vẽ bằng `VoucherTicket`, `SegmentedTabs`, `Chip` đã có.

**Tech Stack:** NestJS + Prisma + Postgres, jest (API, race), vitest (app-core, Mini, web), Playwright (e2e Mini).

**Spec:** `docs/2026-10-31-shop-redesign/01-thiet-ke.md` §4 Q10, Q13 (luật); `02-ke-hoach.md` mục P14; nguồn `review/backend-gap.md` §3b, §6.3, `review/ia-merch.md` C6, `review/critique-store.md` 3.4 + OF-01..04, `review/web.md` D-08; bàn giao `plans/handoff-wave4a.md` (việc mở: banner `/offers` chống nhảy, `TOUR['/offers']`).

## Global Constraints

- Node: `export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH`. Worktree mới: `pnpm --filter @tubutree/shared-types build` và `cd apps/api && npx prisma generate`.
- Đường tiền: không đổi `CouponsService.validateAndCompute/redeem`, không đổi thứ tự giảm Giờ vàng → combo → mã → hạng → điểm. Nhận mã chỉ qua `POST /coupons/claim`. Một đơn một mã; chữ "Mỗi đơn dùng 1 mã" (`coupon.oneCodeHint`) ở mọi chỗ chọn mã.
- Chữ: "Mã giảm giá", "Miễn phí giao hàng", "Nhận mã", "Mã của tôi", "Đã dùng–hết hạn"; không "Kho voucher", "Freeship", "Voucher", "Top". Khoá chữ mới thêm vào cả `shop-copy.ts` và `shop-copy-budget.ts`.
- Vùng chạm ≥44px, tương phản ≥4,5:1, axe 0 vi phạm ở 375px màn đụng tới. Số px viết tay không tăng (ratchet), không lề âm ngang tay (dùng `.tubu-bleed`).
- Route mới khai ở `route-map.json`, `pnpm lint:parity` xanh. Chunk vào Mini ≤700 KB; `/vouchers` là chunk theo route (`lazy`).
- Khung chờ không làm trang nhảy; banner `/offers` giữ chỗ cùng cách banner Trang chủ (tỉ lệ `--banner-ratio`, 137px ở 375).
- Khách chưa đăng nhập xem được `/offers`, `/vouchers`; thao tác cần tài khoản (Lưu mã) mở đăng nhập, không màn lỗi 401.
- `/uu-dai` và `/ma-giam-gia` giữ quy tắc robots hiện có: `noindex, nofollow` ở layout, không vào sitemap, robots.txt vẫn `Disallow`.
- Migration đặt tên sau `20261101100100_flash_item_sort_order`: `20261101110000_coupon_listed` (P16 không dùng tên này). Không deploy, không đọc/ghi PROD, không `git stash` trần, không push.
- Comment chỉ nói "vì sao", tiếng Việt, theo mật độ của file xung quanh.

## Review Focus

1. Mã còn 1 lượt, hai khách bấm Lưu cùng lúc (hoặc danh sách cache 30 giây đã cũ): đúng một người nhận, không vượt `usageLimit`; người kia thấy câu "đã hết lượt nhận" và danh sách tải lại, thẻ chuyển "Đã hết lượt". Test: race spec `coupon-collectable-last-slot` (Task 4) + vitest trang `/vouchers` với claim bị từ chối (Task 7).
2. Khách chưa đăng nhập bấm "Lưu mã", hoặc tài khoản khách chưa liên kết (`REAL_USER_REQUIRED_MSG`): mở đăng nhập / hiện câu của máy chủ, không 401, không lưu ngầm. Test: vitest hai app (Task 7, 9) + e2e guest (Task 14).
3. Mã hết hạn đúng giây cuối ngày giờ Việt Nam (`endAt = 23:59:59 +07`) và mã chưa tới `startAt`: `collectable` so theo thời điểm, không cắt ngày theo múi giờ máy chủ. Test: jest `collectable` với `now` cố định hai phía mốc (Task 2).
4. Mọi tab rỗng, API `collectable` 500/mạng lỗi: khối hiện chữ rỗng hoặc lỗi tại chỗ có "Thử lại", `/offers` vẫn vẽ phần còn lại, không nhảy trang. Test: vitest `/vouchers` và `/offers` nguồn rỗng/lỗi (Task 7, 8).
5. Mã thuộc lô thẻ in hoặc không phải CLAIM bị bật `listed` (PATCH trực tiếp, SQL): API 400 và DB CHECK từ chối; admin khoá ô. Test: jest `assertListable` + race spec ràng buộc DB + vitest admin (Task 1, 4, 12).

---

## File Structure

| Việc | File |
|---|---|
| Schema + migration | `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/20261101110000_coupon_listed/migration.sql` |
| Luật `listed` | `apps/api/src/modules/admin/coupon-input-rules.ts` (`assertListable`), `admin.controller.ts` (DTO), `admin.service.ts` (create/update) |
| Kho mã công khai | `apps/api/src/modules/coupons/coupon-collect.service.ts` (mới), `coupons.controller.ts`, `coupons.module.ts` |
| Lịch sử mã + tên mã | `apps/api/src/modules/loyalty/loyalty.service.ts`, `loyalty.controller.ts` |
| Race | `apps/api/test/integration-race/coupon-collectable-last-slot.race-spec.ts` |
| app-core | `api/coupon-collect.ts` (mới), `api/loyalty.ts`, `queries/loyalty.ts`, `commerce/voucher.ts`, `commerce/voucher-center.ts` (mới), `home-layout.ts` (hint banner theo khoá), `shop-copy.ts` + `shop-copy-budget.ts`, `merch/route-fallback.ts`, `route-map.json` |
| Mini | `pages/vouchers.tsx` (mới), `pages/offers.tsx`, `components/offers/*` (mới), `components/ui/voucher-ticket.tsx`, `components/campaign/campaign-banner.tsx`, `components/app.tsx`, `components/checkout/voucher-sheet.tsx` |
| Web | `app/ma-giam-gia/{layout,page,vouchers-view}.tsx` (mới), `app/uu-dai/{layout,page}.tsx`, `components/offers/*` (mới), `components/mini/voucher-ticket.tsx`, `components/campaign/campaign-banner.tsx`, `components/coupon-box.tsx`, `lib/site.ts`, `app/robots.ts`, `app/sitemap.ts`, `components/admin/coupon-listing.tsx` (mới), `components/admin/coupon-list.tsx`, `lib/admin-client.ts` |
| e2e | `apps/e2e/tests/support/{tour.ts,tour-setups.ts,voucher-mocks.ts}`, `vouchers.miniapp.spec.ts`, `offers.miniapp.spec.ts`, `offers-cls.miniapp.spec.ts`, `offers.web.spec.ts` |

---

### Task 1: Prisma `listed` + `title`, luật chặn lô thẻ in, admin bật/tắt

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (model Coupon), `apps/api/src/modules/admin/coupon-input-rules.ts`, `admin.controller.ts` (`CreateCouponDto`, `UpdateCouponDto`), `admin.service.ts` (`createCoupon`, `updateCoupon`)
- Create: `apps/api/prisma/migrations/20261101110000_coupon_listed/migration.sql`
- Test: `apps/api/src/modules/admin/coupon-input-rules.spec.ts` (mới), `admin.service.spec.ts`, `admin.controller.spec.ts`

**Interfaces:**
- Produces: `Coupon.listed Boolean @default(false)`, `Coupon.title String?`, `@@index([listed, endAt])`; `assertListable(coupon: { scope?: string; batch?: string | null }, listed: boolean | undefined): void` ném `BadRequestException` khi `listed === true` mà `scope !== 'CLAIM'` hoặc `batch` khác null; `COUPON_TITLE_MAX = 60`. `CreateCouponDto` thêm `listed?: boolean`, `title?: string`; `UpdateCouponDto` thêm `listed?: boolean`, `title?: string | null`.

- [ ] **Step 1: Viết test đỏ** trong `coupon-input-rules.spec.ts`: `assertListable({ scope: 'CLAIM', batch: null }, true)` không ném; `({ scope: 'CLAIM', batch: 'LOT-1' }, true)` ném 400 "lô thẻ"; `({ scope: 'PUBLIC', batch: null }, true)` ném 400 "mã nhận qua thẻ"; `(… , false)` và `(…, undefined)` không ném với mọi coupon. Trong `admin.service.spec.ts`: `createCoupon({ scope: 'PUBLIC', listed: true, … })` ném 400; `createCoupon({ scope: 'CLAIM', usageLimit: 10, listed: true, title: '  Mừng bạn mới  ' })` ghi `listed: true, title: 'Mừng bạn mới'`; `updateCoupon(id, { listed: true })` trên mã có `batch` ném 400 và không gọi `update`; `updateCoupon(id, { title: null })` ghi `title: null`. Trong `admin.controller.spec.ts`: DTO `title` dài 61 ký tự lỗi validate.
- [ ] **Step 2: Chạy đỏ.** `cd apps/api && npx jest src/modules/admin/coupon-input-rules.spec.ts src/modules/admin/admin.service.spec.ts src/modules/admin/admin.controller.spec.ts` → FAIL (`assertListable` chưa có).
- [ ] **Step 3: Cài đặt.** Schema thêm cột + index. `migration.sql`: `ALTER TABLE "coupons" ADD COLUMN "listed" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "title" TEXT;`, `CREATE INDEX "coupons_listed_endAt_idx" ON "coupons"("listed","endAt");`, và `ALTER TABLE "coupons" ADD CONSTRAINT "coupons_listed_claim_only_chk" CHECK (NOT "listed" OR ("scope" = 'CLAIM' AND "batch" IS NULL));` (hàng rào cuối nếu mã ghi thẳng DB). `assertListable` gọi ở `createCoupon` (batch = null) và `updateCoupon` (đọc `coupon.batch`, `coupon.scope`). `title` trim, rỗng → `null`, `@MaxLength(COUPON_TITLE_MAX)`. Cập nhật `this.logger.warn` giữ như cũ.
- [ ] **Step 4: Chạy xanh** lệnh Step 2, rồi `npx prisma generate` và `npx tsc --noEmit -p tsconfig.json`.
- [ ] **Step 5: Commit** `feat(api): Coupon.listed + title, chặn bật listed cho mã lô thẻ in`.

### Task 2: `GET /coupons/collectable`

**Files:**
- Create: `apps/api/src/modules/coupons/coupon-collect.service.ts`, `coupon-collect.service.spec.ts`
- Modify: `coupons.controller.ts`, `coupons.module.ts`, `coupons.controller.spec.ts`

**Interfaces:**
- Produces: `CouponCollectService.collectable(now = new Date()): Promise<CollectableCoupon[]>` với `CollectableCoupon = { code: string; title: string | null; type: CouponType; value: number; minOrder: number | null; maxDiscount: number | null; startAt: Date; endAt: Date; newCustomerOnly: boolean; claimedCount: number; usageLimit: number | null }`. Controller `@Public() @PublicCache('CATALOG') @Get('collectable') @Throttle({ default: { ttl: 60_000, limit: 60 } })`.

- [ ] **Step 1: Test đỏ** (`coupon-collect.service.spec.ts`, Prisma giả): `where` của `coupon.findMany` đúng `{ listed: true, isActive: true, scope: 'CLAIM', batch: null, startAt: { lte: now }, endAt: { gte: now } }`; kết quả gắn `claimedCount` từ một `couponClaim.groupBy`; mã `claimedCount >= usageLimit` bị loại; `usageLimit: null` giữ lại; sắp `endAt` tăng; tối đa 50; **mốc giờ VN**: với `now = 2026-11-30T16:59:59Z` (23:59:59 VN) và mã `endAt = 2026-11-30T16:59:59Z` vẫn trả, với `now = 2026-11-30T17:00:00Z` thì `findMany` nhận `endAt: { gte: now }` mới (không cắt ngày): test kiểm tra tham số truyền vào đúng instant `now`. Controller spec: có `@Public` và metadata `PUBLIC_CACHE_POLICY_KEY = 'CATALOG'`, kết quả không có `id`, `createdById`, `scopeMeta`.
- [ ] **Step 2: Chạy đỏ.** `npx jest src/modules/coupons/coupon-collect.service.spec.ts src/modules/coupons/coupons.controller.spec.ts`.
- [ ] **Step 3: Cài đặt** service (đọc mã rồi một `groupBy` đếm claim, lọc lượt trong JS) + route + provider. Trả đúng trường của `CollectableCoupon`, không lộ `id`.
- [ ] **Step 4: Chạy xanh** lệnh Step 2 + `npx tsc --noEmit -p tsconfig.json`.
- [ ] **Step 5: Commit** `feat(api): GET /coupons/collectable, mã listed còn hạn còn lượt`.

### Task 3: `GET /me/coupons/history` + `title` trong `/me/coupons`

**Files:**
- Modify: `apps/api/src/modules/loyalty/loyalty.service.ts`, `loyalty.controller.ts`, `loyalty.service.spec.ts`

**Interfaces:**
- Produces: `LoyaltyService.getCouponHistory(userId: string, now = new Date()): Promise<CouponHistoryItem[]>`, `CouponHistoryItem = { code: string; title: string | null; type; value; minOrder; maxDiscount; endAt: Date; state: 'used' | 'expired'; usedAt: Date | null }`; route `GET me/coupons/history` (theo khách, mặc định no-store). `getAvailableCoupons` mỗi dòng thêm `title: c.title`.

- [ ] **Step 1: Test đỏ** (Prisma giả như spec hiện có): (a) mã trong ví có `title` thì `getAvailableCoupons` trả `title`; (b) `getCouponHistory`: mã đã dùng hết `perUserLimit` của khách → `state: 'used'` kèm `usedAt` mới nhất; mã CLAIM khách đã nhận hoặc USER_GROUP của chính khách mà `endAt < now` trong 90 ngày, chưa dùng hết → `'expired'`; mã còn dùng được (ví) không có trong lịch sử; mã dùng một phần của mã `perUserLimit = 3` mới dùng 1 lần không có; mã PUBLIC hết hạn khách chưa dùng không có; tối đa 50 dòng, mới nhất trước.
- [ ] **Step 2: Chạy đỏ.** `npx jest src/modules/loyalty/loyalty.service.spec.ts -t "coupon"`.
- [ ] **Step 3: Cài đặt.** Hai truy vấn: `couponRedemption.groupBy` theo khách (kèm `max(redeemedAt)`) rồi `coupon.findMany` các id đó lọc `perUserLimit > 0 && used >= perUserLimit`; `coupon.findMany` cho CLAIM đã nhận + USER_GROUP của khách hết hạn trong 90 ngày. Gộp, loại trùng theo `code`, sắp, cắt 50. Không đụng `redeem`.
- [ ] **Step 4: Chạy xanh** + `npx tsc --noEmit -p tsconfig.json`.
- [ ] **Step 5: Commit** `feat(api): lịch sử mã của khách + tên hiển thị trong ví mã`.

### Task 4: Race nhận lượt cuối + ràng buộc DB (cụm Postgres riêng 25546)

**Files:**
- Create: `apps/api/test/integration-race/coupon-collectable-last-slot.race-spec.ts`

- [ ] **Step 1: Dựng DB riêng.** `bash docs/2026-10-20-uat/tools/pg-native.sh start 25546`; tạo DB `tubutree_it` (`prisma db execute` như `pg-native.sh createdb` nhưng chạy trong worktree này); `DATABASE_URL=postgresql://tubu@127.0.0.1:25546/tubutree_it npx prisma migrate deploy` trong `apps/api`.
- [ ] **Step 2: Viết spec** (khuôn `claim-first-order.race-spec.ts`, dùng `createUser`, `warmPool`, `randCode` của `helpers.ts`; `CouponClaimService` + `CouponCollectService` bản thật): (1) mã CLAIM `listed`, `usageLimit: 1`, hai khách thật cùng `claim` → đúng một `fulfilled`, một `BadRequestException` "đã được tài khoản khác nhận", `couponClaim.count = 1`, `collectable()` không còn mã; (2) `usageLimit: 3` đã có 2 claim, 6 khách cùng nhận → đúng 1 thành công, `count = 3`; (3) cùng một khách gọi `claim` hai lần song song → cả hai trả, một dòng claim; (4) ràng buộc DB: `coupon.update({ data: { listed: true } })` trên mã có `batch` và trên mã `scope: 'PUBLIC'` đều ném lỗi `coupons_listed_claim_only_chk`.
- [ ] **Step 3: Chạy.** `cd apps/api && DATABASE_URL=postgresql://tubu@127.0.0.1:25546/tubutree_it npx jest -c test/integration-race/jest.config.js --runInBand test/integration-race/coupon-collectable-last-slot.race-spec.ts` → PASS. Chạy lại thêm `claim-first-order.race-spec.ts` để chắc nhận mã cũ không đổi.
- [ ] **Step 4: Commit** `test(api): race nhận mã lượt cuối ở kho mã, CHECK listed`. (Cụm 25546 để chạy tới cuối gói, dừng ở Task 15.)

### Task 5: app-core: kiểu API, truy vấn, logic trung tâm mã

**Files:**
- Create: `packages/app-core/src/api/coupon-collect.ts`, `coupon-collect.spec.ts`, `commerce/voucher-center.ts`, `commerce/voucher-center.spec.ts`
- Modify: `api/loyalty.ts` (`CouponDTO.title?`, `getCouponHistory`), `queries/loyalty.ts`, `commerce/voucher.ts`, `commerce/voucher.spec.ts`, `home-layout.ts` (+ spec), `shop-copy.ts`, `shop-copy-budget.ts`

**Interfaces:**
- Produces (`api/coupon-collect.ts`): `CollectableCouponDTO = { code: string; title: string | null; type: CouponDTO['type']; value: number; minOrder: number | null; maxDiscount: number | null; startAt: string; endAt: string; newCustomerOnly: boolean; claimedCount: number; usageLimit: number | null }`; `fetchCollectableCoupons(http): Promise<CollectableCouponDTO[]>` (`GET /coupons/collectable`). `api/loyalty.ts`: `CouponHistoryDTO = Pick<CouponDTO, 'code'|'type'|'value'|'minOrder'|'maxDiscount'|'endAt'|'title'> & { state: 'used' | 'expired'; usedAt: string | null }`, `getCouponHistory(http)`. `queries/loyalty.ts`: `collectableCouponsQuery(http)` (key `['coupons','collectable']`, `staleTime 30_000`), `couponHistoryQuery(http)` (key `['coupons','history']`).
- `commerce/voucher.ts`: `VoucherView` thêm `name: string | null` (tên admin đặt, trim, rỗng → null) và `quota: string | null` ("Còn 3 lượt" khi `remaining` là số 1..10 và state `collectable`); `VoucherFlags` thêm `remaining?: number | null`; `CouponDTO` thêm `title?: string | null`.
- `commerce/voucher-center.ts`:
  - `VOUCHER_TABS: readonly { key: 'claim' | 'mine' | 'history'; label: string }[]` (chữ từ `coupon.tabClaim/tabMine/tabHistory`).
  - `type VoucherFilter = 'all' | 'discount' | 'freeship' | 'shop' | 'expiring'`; `voucherFilters(views: VoucherView[]): { key: VoucherFilter; label: string }[]` (luôn có Tất cả, Giảm giá, Miễn phí giao hàng, Sắp hết hạn; "Của shop" chỉ khi có mã `kind === 'shop'`); `filterVouchers<T extends { view: VoucherView; coupon: { endAt: string } }>(rows: T[], filter: VoucherFilter, now: number): T[]` (`expiring` dùng `isCouponExpiring` của `home-layout`).
  - `interface VoucherRow { view: VoucherView; coupon: CouponDTO & VoucherFlags }`; `collectRows(collectable: CollectableCouponDTO[], walletCodes: ReadonlySet<string>, now: number): VoucherRow[]` (mã đã có trong ví → `claimed: true` state `saved`; `usageLimit - claimedCount <= 0` → `soldOut`; chưa nhận đứng trước đã lưu; mỗi nhóm `sortVouchers`); `mineRows(wallet: CouponDTO[], now: number): VoucherRow[]`; `historyRows(items: CouponHistoryDTO[], now: number): VoucherRow[]` (state `used`/`expired`, không có nút chính).
- `home-layout.ts`: `readBannerHint(storage, key = BANNER_HINT_KEY)`, `writeBannerHint(storage, has, key = BANNER_HINT_KEY)`, `OFFERS_BANNER_HINT_KEY = 'tubu_offers_banner'` (mỗi vị trí banner có gợi ý riêng: một khoá chung làm khung chờ Ưu đãi hiện rồi biến mất khi chỉ Trang chủ có banner).
- Chữ mới (cả `shop-copy.ts` và `shop-copy-budget.ts`): `coupon.emptyHistoryTitle` ("Chưa có mã đã dùng hoặc hết hạn"), `coupon.emptyFilterTitle` ("Không có mã nào ở mục này"), `coupon.loadError` ("Chưa tải được mã giảm giá"), `coupon.allCount` ("Tất cả {n} mã"), `coupon.filterAll`, `coupon.filterDiscount`, `coupon.filterFreeship`, `coupon.filterShop`, `coupon.filterExpiring`, `coupon.tabsLabel`.

- [ ] **Step 1: Test đỏ.** `voucher-center.spec.ts`: `collectRows` với ví chứa `A`, collectable `[A, B(soldOut: usageLimit 5, claimedCount 5), C]` → `C` (chưa nhận) đứng đầu, rồi `A` (saved) và `B` (soldout) sau; `quota` của `C` còn 3 lượt = "Còn 3 lượt", còn 50 lượt → `null`; `voucherFilters` không có "Của shop" khi không mã shop; `filterVouchers('freeship')` chỉ mã FREESHIP; `'expiring'` chỉ mã còn ≤3 ngày giờ VN; `historyRows` state đúng và `expiry` rỗng. `voucher.spec.ts`: `name` lấy từ `title` đã trim. `coupon-collect.spec.ts`: gọi `GET /coupons/collectable`. `home-layout.spec.ts`: hai khoá hint độc lập (ghi `OFFERS_BANNER_HINT_KEY` không đổi `tubu_home_banner`). `shop-copy.spec.ts` đã bắt thiếu khoá ở `shop-copy-budget.ts`.
- [ ] **Step 2: Chạy đỏ.** `cd packages/app-core && npx vitest run src/commerce/voucher-center.spec.ts src/commerce/voucher.spec.ts src/api/coupon-collect.spec.ts src/home-layout.spec.ts src/shop-copy.spec.ts`.
- [ ] **Step 3: Cài đặt** theo Interfaces; `voucherView` thêm `name`, `quota`. Mọi spec cũ của `VoucherView` (toEqual) cập nhật thêm hai trường.
- [ ] **Step 4: Chạy xanh** lệnh Step 2, rồi `npx tsc --noEmit` và `npx vitest run` trong `packages/app-core` (toàn gói, một lần).
- [ ] **Step 5: Commit** `feat(app-core): kho mã giảm giá (kiểu API, truy vấn, voucher-center)`.

### Task 6: Mini App `/vouchers`

**Files:**
- Create: `apps/miniapp/src/pages/vouchers.tsx`, `vouchers.spec.tsx`, `apps/miniapp/src/hooks/use-claim-coupon.ts` (+ spec)
- Modify: `components/app.tsx` (`<Route path="/vouchers">` + `lazy`), `components/ui/voucher-ticket.tsx` (+ spec: hiện `name` trong dòng meta trước điều kiện, `quota` sau dòng hạn), `packages/app-core/src/route-map.json` (`/vouchers` ↔ `/ma-giam-gia`, `private: false`, `pending: true` tới Task 9)

**Interfaces:**
- Consumes: Task 5 (`collectableCouponsQuery`, `couponsQuery`, `couponHistoryQuery`, `collectRows/mineRows/historyRows/voucherFilters/filterVouchers`, `VOUCHER_TABS`).
- Produces: `useClaimCoupon(): { claim(code: string): Promise<boolean>; pendingCode: string | null }`: khách chưa đăng nhập → `useAuthStore.getState().login()` và trả false; thành công → `notify(coupon.savedToast)`, `invalidateQueries(['coupons'])`; lỗi → `notify({ text: getErrorMessage(e), type: 'error' })` rồi `invalidateQueries(['coupons','collectable'])` (cache 30 giây có thể đã cũ). Trang `VouchersPage` (default export) dùng `?tab=claim|mine|history` (replace, như `/best-sellers`).

- [ ] **Step 1: Test đỏ** (`vouchers.spec.tsx`, mock service như `offers.spec.tsx`): tab mặc định "Nhận mã" gọi `collectable` mà không cần đăng nhập, khách chưa đăng nhập thấy thẻ và nút "Lưu mã" (bấm → `login` được gọi, `POST /coupons/claim` không gọi); đã đăng nhập bấm "Lưu mã" → gọi claim với đúng mã, báo "Đã lưu vào Mã của tôi", thẻ chuyển "Dùng ngay"; claim lỗi "Mã giảm giá đã hết lượt nhận." → báo lỗi và gọi lại `collectable`; tab "Mã của tôi" khách chưa đăng nhập hiện `GuestLinkCard`/mời đăng nhập, không gọi `/me/coupons`; chip "Miễn phí giao hàng" chỉ giữ mã FREESHIP, chip hiện đủ tên đọc; tab "Đã dùng–hết hạn" vẽ thẻ `used`/`expired` không nút; `collectable` 500 → khối lỗi "Thử lại" gọi lại; mọi tab rỗng có chữ rỗng; chữ "Mỗi đơn dùng 1 mã" có trên trang.
- [ ] **Step 2: Chạy đỏ.** `cd apps/miniapp && npx vitest run src/pages/vouchers.spec.tsx src/hooks/use-claim-coupon.spec.tsx src/components/ui/voucher-ticket.spec.tsx`.
- [ ] **Step 3: Cài đặt.** `PageHeader title="Mã giảm giá"`; `SegmentedTabs` (label "Mục mã giảm giá"); hàng `Chip` lọc cuộn ngang (`scroll-x`, đệm dọc ≥4px) dính dưới tab; danh sách `VoucherTicket variant="ticket"` (`primary`: collectable → "Lưu mã" (`useClaimCoupon`), saved/mine → "Dùng ngay" (`useCouponUse().use`), history → không có); `PullToRefresh` làm tươi cả ba truy vấn. Route `lazy` để không phình entry.
- [ ] **Step 4: Chạy xanh** lệnh Step 2 + `npx tsc --noEmit`; `pnpm lint:parity` (route-map có `pending`).
- [ ] **Step 5: Commit** `feat(miniapp): trang Mã giảm giá /vouchers (Nhận mã, Mã của tôi, Đã dùng–hết hạn)`.

### Task 7: Mini App `/offers` theo Q10 + banner giữ chỗ

**Files:**
- Create: `apps/miniapp/src/components/offers/offers-flash.tsx`, `offers-collect.tsx`, `offers-points-strip.tsx` (+ spec mỗi file)
- Modify: `pages/offers.tsx`, `pages/offers.spec.tsx`, `components/campaign/campaign-banner.tsx` (+ spec), `components/flash-sale.tsx` (export `ActiveFlashCard`), `hooks/use-campaign-slides.ts` (ghi gợi ý `OFFERS_BANNER_HINT_KEY` khi đã biết loại khách)

**Interfaces:**
- Produces: `CampaignBanner({ placement, kind })` giữ chỗ: `loading && readBannerHint(browserStorage(), hintKey)` → khung `Skeleton aspectRatio var(--banner-ratio)` (`data-testid="offers-banner-loading"`, đệm `12px 16px 0`); có slide thì băng chuyền; không slide và không gợi ý thì null. `OffersFlash` (≤ `shelf('offers.flash').maxItems` = 4 thẻ `flash`, tiêu đề promo + `Countdown`, "Xem tất cả" → `/flash-sale`, ẩn khi 0 suất, đọc cache `['flash-sales','active']`). `OffersCollect` (3 `VoucherTicket` đầu của `collectRows`, tiêu đề "Nhận mã", `action` "Tất cả n mã" → `/vouchers`, ẩn khi rỗng, lỗi tải thì khối lỗi tại chỗ có "Thử lại").
- Thứ tự trang: `CampaignBanner` → `OffersFlash` → `OffersCollect` → dải Điểm Xanh gọn (`OffersPointsStrip`: hạng, điểm, thanh tiến độ, nút "Chi tiết điểm" → `/loyalty`; giữ region tên `homeCopy.offers.pointsTitle`) + `DailyCheckInCard` hiện có → Mã của tôi (`VoucherTicket` ví, `sortVouchers`, "Dùng ngay") → Đổi quà và tiện ích (ListRow như cũ). Khách chưa đăng nhập: ba khối đầu vẫn hiện; từ dải Điểm Xanh xuống dưới thay bằng một `EmptyState` mời đăng nhập (giữ chữ `offers.loginTitle/loginBody` và nút "Đăng nhập ngay"). `?section=coupons` cuộn tới khối Mã của tôi.

- [ ] **Step 1: Test đỏ.** `offers.spec.tsx`: khách chưa đăng nhập thấy "Giờ vàng" và "Nhận mã" và nút đăng nhập, không gọi `getLoyalty/getCoupons`; thứ tự DOM Banner < Giờ vàng < Nhận mã < Điểm Xanh < Mã của tôi < Đổi quà; `OffersCollect` lỗi `collectable` → "Thử lại" và các khối khác vẫn vẽ; `?section=coupons` cuộn (giữ ca cũ). `campaign-banner.spec.tsx`: có gợi ý `tubu_offers_banner = 1` và đang tải → khung chờ `offers-banner-loading` cao theo `--banner-ratio`; không gợi ý → null; gợi ý của Trang chủ (`tubu_home_banner`) không làm hiện khung chờ ở Ưu đãi; tải xong không slide thì ghi gợi ý `0`. `offers-flash.spec.tsx`: 0 suất → null; 6 suất → 4 thẻ + "Xem tất cả".
- [ ] **Step 2: Chạy đỏ.** `cd apps/miniapp && npx vitest run src/pages/offers.spec.tsx src/components/campaign src/components/offers`.
- [ ] **Step 3: Cài đặt** theo Interfaces. Nạp lười `OffersCollect` không cần (trang đã là chunk riêng). Điểm Xanh gọn: bỏ hai dòng "Chi tiết" thừa, giữ `aria-label` `memberCardAriaLabel`.
- [ ] **Step 4: Chạy xanh** + `npx tsc --noEmit`.
- [ ] **Step 5: Commit** `feat(miniapp): Ưu đãi theo Q10, banner OFFERS_TOP giữ chỗ chống nhảy`.

### Task 8: Web `/ma-giam-gia`

**Files:**
- Create: `apps/web/src/app/ma-giam-gia/{layout.tsx,page.tsx,vouchers-view.tsx,vouchers-view.spec.tsx,page.spec.tsx}`, `apps/web/src/lib/use-claim-coupon.ts` (+ spec)
- Modify: `apps/web/src/components/mini/voucher-ticket.tsx` (+ spec: `name`, `quota`), `packages/app-core/src/route-map.json` (bỏ `pending` của `/vouchers`), `lib/site.ts`, `app/robots.ts`, `app/sitemap.ts` (+ spec)

**Interfaces:**
- Produces: `NOINDEX_PUBLIC_PATHS = ['/uu-dai', '/ma-giam-gia']` ở `lib/site.ts`: `PRIVATE_PATHS` gồm cả hai (robots vẫn `Disallow`), `robots.ts` lọc chúng khỏi `allow` do `publicAllowPaths` sinh (Google chọn `allow` khi hoà độ dài), `sitemap.ts` bỏ hai route này. `layout.tsx` của `/ma-giam-gia`: `metadata = { title: 'Mã giảm giá — Tubu Tree', robots: { index: false, follow: false } }`, không canonical. `useClaimCoupon()` web: khách → `router.push(loginHref(pathname))`, `phase === 'unavailable'` → câu lỗi mạng, lỗi máy chủ → `role="alert"` một dòng.

- [ ] **Step 1: Test đỏ** (cùng ca của Task 6 theo cách web: `useAuthPhase` giả, không `login()` mà `router.push('/dang-nhap?returnTo=%2Fma-giam-gia')`, `?tab=` qua `useSearchParams`/`router.replace`, ≥lg lưới `lg:grid-cols-3`); `robots` không còn `allow: '/uu-dai'`, vẫn `disallow` cả `/uu-dai` và `/uu-dai/`; `sitemap` không có `/uu-dai`, `/ma-giam-gia`; `page.spec`: `metadata.robots` noindex, nofollow.
- [ ] **Step 2: Chạy đỏ.** `cd apps/web && npx vitest run src/app/ma-giam-gia src/app/robots src/app/sitemap.spec.ts src/components/mini/voucher-ticket.spec.tsx`.
- [ ] **Step 3: Cài đặt.** Trang `PAGE_WIDE` (`main.mx-auto…`), `PageHeader`, tab và chip dùng `SegmentedTabs`/`Chip` của `components/mini`; từ lg lưới 3 cột `VoucherTicket`; điện thoại một cột đúng như Mini. `layout.tsx` không có `AccountShell`.
- [ ] **Step 4: Chạy xanh** + `npx next typegen && npx tsc --noEmit`; `pnpm lint:parity`.
- [ ] **Step 5: Commit** `feat(web): trang Mã giảm giá /ma-giam-gia, noindex như /uu-dai`.

### Task 9: Web `/uu-dai` rời `AccountShell`

**Files:**
- Create: `apps/web/src/components/offers/{offers-flash,offers-collect,offers-points-strip}.tsx` (+ spec)
- Modify: `app/uu-dai/layout.tsx` (giữ `metadata` noindex, trả `children`, bỏ `AccountShell`), `app/uu-dai/page.tsx`, `page.spec.tsx`, `components/campaign/campaign-banner.tsx` (+ gợi ý `OFFERS_BANNER_HINT_KEY`, khung chờ `data-testid="offers-banner-loading"`), `packages/app-core/src/route-map.json` (`/offers` → `private: false`), `components/skeletons/route-skeleton.tsx` (nếu khung chờ `/uu-dai` còn giả định khung Tài khoản)

**Interfaces:** Cùng thứ tự khối và chữ như Task 7; khung `PAGE_WIDE` (không `md:max-w-xl`); từ lg: hàng đầu hai cột (Điểm Xanh gọn | Điểm danh), Nhận mã và Mã của tôi lưới `lg:grid-cols-3`. Điện thoại giống Mini 375px (so ảnh Task 15).

- [ ] **Step 1: Test đỏ** (`page.spec.tsx`): khách chưa đăng nhập thấy "Giờ vàng" và "Nhận mã" (không "Đăng nhập với Zalo" chặn cả trang); thứ tự khối; không còn `AccountShell` (không có nav "Tài khoản" bao ngoài); `layout` metadata noindex, nofollow; `?section=coupons` cuộn tới Mã của tôi (giữ ca cũ); banner hint như Mini.
- [ ] **Step 2: Chạy đỏ.** `cd apps/web && npx vitest run src/app/uu-dai src/components/offers src/components/campaign`.
- [ ] **Step 3: Cài đặt** theo Task 7, lấy chữ từ cùng nguồn app-core.
- [ ] **Step 4: Chạy xanh** + `npx tsc --noEmit`; `pnpm lint:parity`.
- [ ] **Step 5: Commit** `feat(web): Ưu đãi /uu-dai công khai, rời khung Tài khoản, lưới 3 cột ở lg`.

### Task 10: "Mỗi đơn dùng 1 mã" ở chỗ chọn mã giỏ/thanh toán

**Files:**
- Modify: `apps/miniapp/src/components/checkout/voucher-sheet.tsx` (+ spec), `apps/web/src/components/coupon-box.tsx` (+ spec)

- [ ] **Step 1: Test đỏ:** mở sheet chọn mã (Mini `VoucherSheet visible`, web `CouponBox` sheet) thấy `fillCopy('coupon.oneCodeHint')`.
- [ ] **Step 2: Chạy đỏ.** `npx vitest run src/components/checkout` (Mini), `npx vitest run src/components/coupon-box` (web).
- [ ] **Step 3: Cài đặt** một dòng `caption` tertiary dưới danh sách mã, cùng kiểu với `pdp-offers-sheet.tsx`.
- [ ] **Step 4: Chạy xanh. Step 5: Commit** `feat: ghi "Mỗi đơn dùng 1 mã" ở chỗ chọn mã giỏ và thanh toán`.

### Task 11: Admin bật "Hiện ở mục Nhận mã" + tên hiển thị

**Files:**
- Create: `apps/web/src/components/admin/coupon-listing.tsx`, `coupon-listing.spec.tsx`
- Modify: `components/admin/coupon-list.tsx` (+ spec), `lib/admin-client.ts` (`AdminCoupon.listed/title/batch`, `updateCoupon` patch thêm `listed?: boolean; title?: string | null`), `apps/api/src/modules/admin/admin.service.ts` (`listCoupons` trả `batch`, đã có vì trả cả dòng)

**Interfaces:** `CouponListing({ coupon, pending, onSave }: { coupon: AdminCoupon; pending: boolean; onSave(patch: { listed: boolean; title: string | null }): void })`: hộp chọn "Hiện ở mục Nhận mã" + ô "Tên hiển thị" (≤60) + nút "Lưu". Mã `scope !== 'CLAIM'` hoặc có `batch`: hộp chọn `disabled` kèm dòng giải thích ("Chỉ mã nhận qua thẻ, không thuộc lô thẻ in, mới hiện ở mục Nhận mã") — API vẫn là hàng rào thật (Task 1).

- [ ] **Step 1: Test đỏ:** mã CLAIM không batch: bật hộp chọn + nhập tên + Lưu → `updateCoupon(id, { listed: true, title: 'Mừng bạn mới' })`; mã có `batch` và mã PUBLIC: hộp chọn `disabled` + có dòng giải thích, nút Lưu không gọi API; tên rỗng → `title: null`.
- [ ] **Step 2: Chạy đỏ.** `cd apps/web && npx vitest run src/components/admin/coupon-listing.spec.tsx src/components/admin/coupon-list.spec.tsx`.
- [ ] **Step 3: Cài đặt; Step 4: Chạy xanh + `npx tsc --noEmit`; Step 5: Commit** `feat(admin): bật hiện mã ở mục Nhận mã và đặt tên hiển thị`.

### Task 12: Gỡ trạng thái chờ của `/vouchers` ở route-fallback

**Files:**
- Modify: `packages/app-core/src/merch/route-fallback.ts` (+ `route-fallback.spec.ts`), `merch/home-shelves.spec.ts`, `commerce/campaign.spec.ts`, `apps/miniapp/src/components/home/shortcut-grid.spec.tsx`, `apps/web/src/components/home/shortcut-grid.spec.tsx`, `shortcut-visuals.ts` (hai app: lối "Mã giảm giá" trỏ route thật), `apps/miniapp/src/pages/{profile,loyalty}.tsx` + web `tai-khoan/{page,diem-xanh/page}.tsx` chỉ khi spec đòi (đổi `?section=coupons` sang `/vouchers?tab=mine` nếu lối đó nên mở trang mới: giữ nguyên nếu không có lý do, ghi vào notes)

**Interfaces:** `ENTRIES['/vouchers'] = { mini: '/vouchers', web: '/ma-giam-gia', pending: false }`; `PENDING_TARGET` là `{}`; câu chú thích đầu file nói "hiện không route nào chờ"; `routeUsable('/vouchers') === true`, `liveRoute('/vouchers','mini') === '/vouchers'`, `liveRoute('/vouchers','web') === '/ma-giam-gia'`.

- [ ] **Step 1: Sửa spec trước:** `route-fallback.spec.ts` kỳ vọng `/vouchers` đi thẳng route thật cả hai nền, `PENDING_TARGET` rỗng (spec không còn nhánh `pending`); các spec đang khoá trạng thái chờ (liệt kê bằng `grep -rn "offers?section=coupons\|'/uu-dai'" packages apps --include=*.spec.*`) đổi sang route thật.
- [ ] **Step 2: Chạy đỏ** các spec vừa sửa. **Step 3: Cài đặt** `route-fallback.ts`. **Step 4: Chạy xanh** + `pnpm lint:parity --strict` (không còn `pending` nào của P14). **Step 5: Commit** `refactor(app-core): /vouchers là route thật, PENDING_TARGET rỗng`.

### Task 13: e2e + chuyến tham quan

**Files:**
- Create: `apps/e2e/tests/support/voucher-mocks.ts` (`mockCollectable(api, items)`, `mockCouponHistory`), `vouchers.miniapp.spec.ts`, `offers.miniapp.spec.ts`, `offers-cls.miniapp.spec.ts`, `offers.web.spec.ts`
- Modify: `tests/support/tour.ts` (`TOUR['/offers']`, `TOUR['/vouchers']`), `tour-setups.ts` (`/vouchers`, `/offers`), `campaigns.miniapp.spec.ts`, `home-h.miniapp.spec.ts` (mốc Ưu đãi nếu đổi)

- [ ] **Step 1: Viết spec.** `offers.miniapp.spec.ts` persona `guest` (không phiên): mở `/offers` thấy vùng "Giờ vàng" (suất giả) và "Nhận mã" (collectable giả), bấm "Lưu mã" không gọi claim; `vouchers.miniapp.spec.ts`: ba tab, chip lọc dùng `expectChipHitArea44`; `offers-cls.miniapp.spec.ts` (Chromium như `campaigns-cls`): máy nhớ `tubu_offers_banner=1`, banner OFFERS_TOP về muộn qua `mockCampaigns({ hold })` → CLS ≤ 0,02, và ca không banner không khung chờ; `offers.web.spec.ts`: guest thấy Giờ vàng + Nhận mã (CI chạy, cần API thật).
- [ ] **Step 2: Chạy.** `cd apps/e2e && E2E_SCOPE=miniapp E2E_MINIAPP_PORT=3323 npx playwright test offers vouchers campaigns visual-tour --workers=2 --reporter=line` → xanh.
- [ ] **Step 3: Commit** `test(e2e): Ưu đãi và Mã giảm giá cho khách chưa đăng nhập, banner không xê dịch`.

### Task 14: Ảnh 375px, gate, e2e Mini, dọn

- [ ] **Step 1: Chụp** Mini (Vite dev 3323) và web (Next dev 3324, API giả) ở 375px: `/vouchers` (ba tab), `/offers` khách + đã đăng nhập, `/ma-giam-gia`, `/uu-dai`; so hai bản; lưu `docs/2026-10-31-shop-redesign/screens/P14/`; tắt server của mình.
- [ ] **Step 2: Gate** `bash docs/2026-10-28-review/tools/gate.sh /Users/longla/coding/tubutree-mini-app/.claude/worktrees/shop-P14 --base d768f7d42 --out /Users/longla/coding/tubutree-mini-app/.claude/worktrees/gate-P14.txt` (một lần). Race: `coupon-collectable-last-slot` + `claim-first-order` trên cụm 25546. e2e Mini cả bộ: `cd apps/e2e && E2E_SCOPE=miniapp E2E_MINIAPP_PORT=3323 npx playwright test --workers=2 --reporter=line`.
- [ ] **Step 3: Dừng cụm** `bash docs/2026-10-20-uat/tools/pg-native.sh stop 25546`. Bước FAIL: so với base bằng worktree tạm hoặc log, ghi "có sẵn" nếu có sẵn, còn lại sửa tới PASS.

## Tự rà soát

- Phủ spec: Q10 thứ tự khối (Task 7, 9), `private:false` (Task 8, 9 sửa route-map), `GuestLinkCard`/khối cần đăng nhập (Task 7), tab + chip + `VoucherTicket` + `sortVouchers` (Task 5, 6, 8), `listed`/`title` + chặn lô thẻ in (Task 1, 11), `collectable` còn hạn giờ VN còn lượt (Task 2), race lượt cuối (Task 4), "Mỗi đơn dùng 1 mã" (Task 10), Q13 `/uu-dai` rộng + lưới 3 cột + robots/canonical (Task 8, 9), PENDING_TARGET rỗng (Task 12), việc mở banner chống nhảy + `TOUR['/offers']` (Task 7, 13).
- Lệch có chủ ý so với dòng P14 của kế hoạch: trạng thái của khách không nằm trong `collectable` (route công khai có cache): ghép phía client từ `/me/coupons` (backend-gap §0, §3b); tab "Đã dùng–hết hạn" cần `GET /me/coupons/history` (mã đã dùng/hết hạn không còn trong `/me/coupons`); `listed` chỉ cho mã `scope = CLAIM` không thuộc lô (backend-gap §3b), thêm CHECK ở DB; gợi ý banner của `/offers` dùng khoá riêng `tubu_offers_banner`; chip "Của shop" chỉ hiện khi có mã `kind: 'shop'` (API chưa có phạm vi gian hàng nên hiện chưa bao giờ hiện); admin bật `listed` ở dòng của danh sách mã, không đụng form tạo mã trong `admin/page.tsx` (4336 dòng).
