# F8 bundles-followups (đợt 4e-2): sửa nốt phát hiện của reviewer Opus cho P15

> **Cho người thực hiện:** dùng superpowers:executing-plans, làm từng task theo thứ tự, mỗi task: test đỏ → code → test xanh → commit. Bước dùng ô `- [ ]`.

**Mục tiêu:** đóng bảy việc còn lại của P15 (`plans/P15-bundles.md` mục "Sửa theo review vòng 2" và "Chờ chủ quyết"): bốn lỗi đường tiền (trần ADDON, nhân viên tự hưởng, hai PATCH lách trần, thứ tự dòng giỏ) và ba lỗi giao diện/chữ (Mini giữ khối, "Tạm hết hàng" khác "Đã kết thúc", hai MINOR lượt 1).

**Kiến trúc:** luật tiền nằm trong hàm thuần `bundle-rules.ts` (dùng chung cho giỏ, báo giá, đặt đơn và API công khai, nên giá quảng cáo = giá giỏ không thể lệch). Cột mới `BundleItem.refPrice` (giá đang bán của phân loại ghim lúc tạo/sửa bộ) làm trần khoản giảm của món mua kèm. Giữ khối của PDP: logic quyết định (`latchBundleSide`, `bundleHoldReason`, `bundleHoldTitle`) nằm ở `packages/app-core` để hai app dùng chung, mỗi app chỉ giữ một `useRef` mỏng.

**Tech Stack:** NestJS 10 + Prisma (Postgres), Jest (`apps/api`, race spec trên DB thật), Vitest (app-core, miniapp, web), Playwright (e2e Mini).

**Spec:** `docs/2026-10-31-shop-redesign/01-thiet-ke.md` §4 (luật), `plans/P15-bundles.md` ("Sửa theo review vòng 1/2", "Chờ chủ quyết / rủi ro đã biết" mục 1 và 2). Mục 3 của "Chờ chủ quyết" (chống trùng Trang chủ lệch §5) KHÔNG thuộc F8.

## Global Constraints

- Base `019e3d59d`, nhánh `shop/F8-bundles-followups`, worktree `.claude/worktrees/shop-F8`. Không push, không đọc/ghi PROD, không sửa file ngoài phạm vi bundles (nhánh tích hợp đang gộp F7a/F7b).
- Migration mới tên đúng `20261101130000_bundle_item_ref_price`, sau `20261101120000_bundles`; tạo bằng `prisma migrate dev` trên DB riêng, rồi đối chiếu với SQL viết tay (CHECK và backfill nằm trong file migration).
- Bộ không có quota toàn cục: mọi trần phải nằm ở lúc tính tiền, không chỉ lúc ghi.
- Chữ giao diện qua `SHOP_COPY` + `shop-copy-budget.ts` (spec bắt thiếu một bên); từ cấm theo `FORBIDDEN_TERMS`; không lộ khoá cấu hình thô cho người dùng.
- Mini App entry ≤ 700 KB: không thêm import nặng vào đường nạp gói đầu.
- Comment chỉ giải thích "vì sao"; commit tiếng Việt kiểu repo, cuối message có `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Máy thiếu RAM: chạy test theo file; gate đầy đủ đúng một lần ở cuối. `export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH`.
- DB riêng cho race: cụm Postgres native cổng 25677 (DB `tubutree_it`, `DATABASE_URL=postgresql://tubu@127.0.0.1:25677/tubutree_it`); xong việc `bash docs/2026-10-20-uat/tools/pg-native.sh stop 25677`.

## Review Focus

Các đầu vào mà spec không nói nhưng dễ vỡ nhất, mỗi dòng có test ở task chủ:

1. Dòng ADDON cũ/ghi tay thiếu `refPrice`: giỏ không giảm VÀ PDP không quảng cáo (không để PDP hiện giá kèm mà giỏ tính giá thường). Test: Task 1 (hàm thuần), Task 4 (`bundles.service.spec`, race `bundle-price-parity`).
2. Giá phân loại ghim tụt dưới giá lúc tạo (sale mới): giảm theo giá hiện tại, không bao giờ làm giá tăng. Test: Task 1.
3. Hai giỏ cùng nội dung nhưng dòng thêm theo thứ tự khác (heap Postgres khác): cùng khoản giảm. Test: Task 1 (hoán vị), Task 3 (race hai giỏ).
4. Nhân viên là người tạo bộ nhưng tài khoản đã đổi sang ADMIN (hoặc role không rõ): ADMIN được hưởng, role không rõ chặn như mã giảm giá. Test: Task 2.
5. Hai PATCH đồng thời, mỗi cái đúng trần khi đứng một mình, ghép lại vượt trần: đúng một cái bị 403, bộ cuối cùng không vượt trần. Test: Task 5.
6. Món mua kèm hết hàng, hay sản phẩm chính hết hàng, khi khách đang ở trang: khối ghi "Tạm hết hàng" (không "Đã kết thúc"), vẫn ở nguyên chỗ, hai app như nhau. Test: Task 6, 7, 8.

## Giao diện dùng chung (giữ đúng tên, gói khác import)

- API: `ProductBundles.addonsSoldOut?: boolean` (app-core `api/bundle.ts` và `BundlesService.forProduct`): true khi có bộ Mua kèm đang chạy nhưng sản phẩm chính hết hàng.
- app-core `commerce/bundle-view.ts`: `type BundleHold = 'ended' | 'soldOut'`, `bundleHoldReason(side: 'combos' | 'addons', data: ProductBundles | undefined, now: number, heldBundleIds?: readonly string[]): BundleHold`, `bundleHoldTitle(titleKey: 'combo.pdpTitle' | 'addon.title', hold: BundleHold | null): string`, `latchBundleSide<T>(live: T[], last: T[] | null, why: (held: T[]) => BundleHold): { items: T[]; held: BundleHold | null; last: T[] | null }`.
- Chữ "Tạm hết hàng" dùng chung khoá `stock.out` của thẻ (`TILE_COPY`), không có khoá riêng `bundle.soldOut` (hai bản sẽ lệch nhau khi một bản được sửa).
- `bundle-rules.ts`: `addonUnitDiscount(unitPrice, addonPrice, refPrice: number | null | undefined): number`, `addonPayPrice(...)` cùng đối số, `isOwnStaffBundle(b, user)`, `LiveBundle.createdById`, `LiveBundle.items[].refPrice`.

## Cấu trúc file

| File | Việc |
|---|---|
| `apps/api/prisma/schema.prisma`, `prisma/migrations/20261101130000_bundle_item_ref_price/migration.sql` | cột `refPrice`, CHECK ≥ 0, backfill |
| `apps/api/src/modules/bundles/bundle-rules.ts` (+spec) | trần theo `refPrice`, `isOwnStaffBundle`, chia đơn vị theo khoá ổn định |
| `apps/api/src/modules/bundles/bundle-read.ts` (+spec) | loader chọn `createdById`, `refPrice` |
| `apps/api/src/modules/storefront/combo.service.ts` (+spec) | bỏ bộ do chính nhân viên tạo cho người mua đó |
| `apps/api/src/modules/bundles/bundles.service.ts` (+spec) | giá công khai qua `addonPayPrice`, `addonsSoldOut` |
| `apps/api/src/modules/bundles/bundles-admin.service.ts` (+spec), `bundle-admin-rules.ts` | ghi `refPrice`; kiểm lại nội dung sau khoá |
| `apps/api/test/integration-race/{bundle-price-parity,bundles-admin}.race-spec.ts` | race trên DB thật |
| `packages/app-core/src/commerce/bundle-view.ts`, `api/bundle.ts`, `shop-copy.ts`, `shop-copy-budget.ts` (+spec) | giữ khối, chữ mới, ghi chú trần chữ |
| `apps/web/src/app/san-pham/[slug]/pdp-bundles.tsx`, `apps/miniapp/src/components/product/pdp-bundles.tsx` (+spec) | dùng chung `latchBundleSide` |
| `apps/e2e/tests/bundles-cls.miniapp.spec.ts` (+`support/bundle-mocks.ts`) | e2e giữ khối ở Mini |

---

### Task 1: Trần giảm ADDON theo giá tham chiếu (luật thuần, cột, loader, backfill)

**Files:** Modify `schema.prisma` (`BundleItem.refPrice Int?`), Create migration `20261101130000_bundle_item_ref_price/migration.sql`; Modify `bundle-rules.ts` + `bundle-rules.spec.ts`, `bundle-read.ts` + `bundle-read.spec.ts`; Test race `bundles-admin.race-spec.ts` (backfill).

**Interfaces — Produces:** các chữ ký ở "Giao diện dùng chung" (`addonUnitDiscount`, `addonPayPrice`, `isOwnStaffBundle`, `LiveBundle`); `loadLiveBundles` trả `createdById` và `items[].refPrice`.

Phần luật thuần đã viết ở lần chạy trước (chưa commit trong worktree: trần `min(giá hiện tại, refPrice) − giá kèm`, `isOwnStaffBundle` gọi lại `isOwnStaffCoupon`, `addUnits` sắp theo `variationId`) được rà lại và giữ, với ba chỉnh: (a) `refPrice` thiếu (`null`/`undefined`) nằm trong chính `addonUnitDiscount` (trả 0) để API công khai và giỏ cùng đi qua một hàm, không có nhánh `continue` riêng ở `addonBundle`; (b) chú thích `addUnits` đang ghi "theo thứ tự dòng", sửa thành "theo `variationId`"; (c) cùng spec phủ cả hoán vị dòng và `isOwnStaffBundle`.

- [ ] **Step 1: test đỏ** trong `bundle-rules.spec.ts` (đã có 31 ca: trần 50.000→500.000 giảm 11.000, `maxQty` kẹp trần, sale tụt, bằng giá tham chiếu, giá kèm ≥ tham chiếu, hoán vị, `isOwnStaffBundle`), thêm: `addonUnitDiscount(500_000, 39_000, null) === 0`, `addonUnitDiscount(500_000, 39_000, undefined) === 0`, `addonPayPrice(500_000, 39_000, null) === 500_000`. `bundle-read.spec.ts`: ca "ánh xạ ra LiveBundle" kỳ vọng thêm `createdById: 'u1'` và `refPrice` trên từng món; ca ADDON giữ `refPrice: 50_000`. Race `bundles-admin.race-spec.ts` (ca mới "migration backfill"): tạo bộ ADDON (món ghim, `refPrice` NULL), bộ ADDON món không ghim, bộ BUNDLE_PCT; chạy đúng câu `UPDATE` đọc từ file migration (cắt giữa hai dòng `-- backfill:` và `-- end backfill`); kỳ vọng món ADDON ghim có `refPrice = salePrice ?? retailPrice`, hai loại kia vẫn NULL; chạy lần hai không đổi.
- [ ] **Step 2:** `cd apps/api && npx jest src/modules/bundles/bundle-rules.spec.ts src/modules/bundles/bundle-read.spec.ts` → FAIL (null, loader); race backfill FAIL (chưa có cột).
- [ ] **Step 3: implement.** Schema + migration: `ALTER TABLE "bundle_items" ADD COLUMN "refPrice" INTEGER;`, câu `UPDATE ... FROM "bundles" b, "variations" v` cho dòng `b.kind = 'ADDON'` ghim phân loại (giá hiện tại là điểm xuất phát duy nhất có thể; chưa có dòng nào trên PROD vì bộ chưa deploy), `CHECK ("refPrice" IS NULL OR "refPrice" >= 0)` tên `bundle_items_ref_price_chk`. `migrate dev --name bundle_item_ref_price` trên `tubutree_it` rồi so SQL sinh ra với file viết tay (chỉ khác ở CHECK/backfill). `bundle-read.ts`: `LIVE_SELECT` chọn `createdById` và `refPrice` của món; map vào `LiveBundle`.
- [ ] **Step 4:** hai spec xanh; `npx tsc --noEmit -p apps/api` xanh; `DATABASE_URL=... npx jest -c test/integration-race/jest.config.js --runInBand test/integration-race/bundles-admin.race-spec.ts` xanh.
- [ ] **Step 5: Commit** `feat(api): trần giảm ADDON theo giá tham chiếu lúc tạo (BundleItem.refPrice), luật thuần cho bộ`.

### Task 2: Nhân viên không hưởng bộ do mình tạo

**Files:** Modify `combo.service.ts` + `combo.service.spec.ts`; Test race `bundle-price-parity.race-spec.ts`.

**Interfaces — Consumes:** `isOwnStaffBundle`, `LiveBundle.createdById` (Task 1). `computeForStorefront(slug, lines, buyerId?, now?)` đã nhận `buyerId` ở cả hai nơi gọi (giỏ và checkout), chữ ký giữ nguyên.

- [ ] **Step 1: test đỏ.** `combo.service.spec.ts` (nhóm "combo toàn sàn"): bộ `createdById: 'staff1'`, người mua `staff1` có role STAFF (mock `prisma.user.findUnique → { role: 'STAFF' }`) → giảm 0; cùng người mua role ADMIN → vẫn giảm; người mua khác → giảm và KHÔNG gọi `user.findUnique`; bộ `createdById: null` → giảm, không tra role; bộ của staff1 + bộ khác cùng giỏ: chỉ bộ khác áp. Race `bundle-price-parity`: sửa helper `buyer(role?)` và `bundle(..., { createdById })`; ca "nhân viên tạo bộ rồi tự mua": BUNDLE_PCT và ADDON do user STAFF tạo → giỏ = báo giá = đơn đều KHÔNG giảm; cùng bộ do ADMIN tạo và ADMIN mua → giảm; khách khác mua bộ của staff → giảm; PDP (`publicBundles.forProduct`) vẫn hiện bộ (cache chung).
- [ ] **Step 2:** `npx jest src/modules/storefront/combo.service.spec.ts` → FAIL.
- [ ] **Step 3: implement** trong `computeForStorefront`: sau `loadLiveBundles`, nếu `buyerId` và có bộ `createdById === buyerId` thì đọc `role` một lần (`prisma.user.findUnique({ where: { id: buyerId }, select: { role: true } })`, giống `flash-sale.service.ts`), lọc bỏ bộ có `isOwnStaffBundle(b, { id: buyerId, role })`; không có bộ nào khớp thì không tra DB.
- [ ] **Step 4:** spec xanh; race `bundle-price-parity` xanh.
- [ ] **Step 5: Commit** `fix(api): nhân viên không hưởng bộ combo/mua kèm do chính mình tạo (cùng luật mã giảm giá và Giờ vàng)`.

### Task 3: Thứ tự dòng giỏ không đổi khoản giảm (chốt ở bốn đường)

**Files:** Test `combo.service.spec.ts`, race `bundle-price-parity.race-spec.ts` (sắp xếp đã nằm trong `addUnits`, Task 1).

- [ ] **Step 1: test.** `combo.service.spec.ts`: `computeForStorefront(null, lines)` với `lines` hai thứ tự khác nhau (BUNDLE_PCT `maxQty` 1, hai phân loại khác giá của cùng một món) ra cùng `perLine`. Race: hai khách, giỏ có cùng bốn dòng nhưng thêm theo thứ tự ngược nhau (heap Postgres khác nhau); `cartQuoteOrder` của từng người ra cùng `comboDiscount`. Chứng minh đỏ: tạm bỏ `.sort(byVariationId)` trong `addUnits`, chạy hai ca, thấy đỏ, khôi phục.
- [ ] **Step 2:** chạy hai ca → xanh với mã hiện tại, đỏ khi bỏ sort (ghi vào commit).
- [ ] **Step 3:** không đổi mã. Nếu race lộ thêm đường đọc có thứ tự khác (báo giá, đặt đơn), sắp ngay trong `addUnits` chứ không thêm `orderBy` rải rác.
- [ ] **Step 4: Commit** `test(api): khoản giảm bộ không phụ thuộc thứ tự dòng giỏ (giỏ, báo giá, đặt đơn)`.

### Task 4: API công khai dùng cùng hàm giá với giỏ; ghi `refPrice` lúc tạo/sửa

**Files:** Modify `bundles.service.ts` + spec, `bundles-admin.service.ts` + spec; Test race `bundle-price-parity`, `bundles-admin`.

**Interfaces — Consumes:** `addonPayPrice`, `addonUnitDiscount`. **Produces:** `BundleItemDTO.addonPrice` = giá khách trả sau trần (`addonPayPrice(giá hiện tại, addonPrice, refPrice)`); món `refPrice` null hoặc khoản giảm 0 thì bỏ khỏi bộ công khai.

- [ ] **Step 1: test đỏ.** `bundles.service.spec.ts`: ADDON ghim phân loại hiện 500.000đ, `addonPrice` 39.000, `refPrice` 50.000 → DTO `addonPrice` 489.000; hiện 45.000 → 39.000; `refPrice` null → món bị bỏ, bộ rỗng thì cả bộ bỏ. `bundles-admin.service.spec.ts` (create): món ADDON ghim được ghi `refPrice` = giá đang bán của phân loại ghim; BUNDLE_PCT ghi `refPrice: null`; update với `items` mới ghi lại `refPrice` theo giá lúc đó; update không đụng `items` thì không ghi lại. Race `bundle-price-parity`: sửa helper `bundle()` nhận `refPrice` (mặc định = giá phân loại ghim lúc tạo); ca "phân loại ghim 50.000 → 500.000": giá công khai = giá dòng giỏ = báo giá = đơn (489.000), giảm 11.000/đơn vị; ca dòng ghi tay không `refPrice`: công khai ẩn, giỏ không giảm. Race `bundles-admin`: bộ admin tạo đọc lại có `refPrice`.
- [ ] **Step 2:** `npx jest src/modules/bundles/bundles.service.spec.ts src/modules/bundles/bundles-admin.service.spec.ts` → FAIL.
- [ ] **Step 3: implement.** `PUBLIC_SELECT` chọn `refPrice` của món. `build()` thay điều kiện `addonPrice >= giá` bằng `const pay = addonPayPrice(unit, addonPrice, refPrice)`; `pay >= unit` (không giảm) thì `continue`; DTO `addonPrice: pay`. Admin: `validateContent` trả `resolved` (đã có `price` của phân loại ghim); `create` và nhánh `items` của `update` ghi `items: content.items.map((it, i) => ({ ...it, refPrice: content.kind === 'ADDON' ? resolved[i].price : null }))`. Không đổi trần nhân viên (`bundleExposure` tính trên giá lúc tạo, đã ≥ khoản giảm sau trần).
- [ ] **Step 4:** spec + race (`bundle-price-parity`, `bundles-admin`) xanh.
- [ ] **Step 5: Commit** `fix(api): giá mua kèm công khai và giá giỏ cùng đi qua addonPayPrice; ghi giá tham chiếu khi tạo/sửa bộ`.

### Task 5: Hai PATCH đồng thời không lách trần nhân viên

**Files:** Modify `bundles-admin.service.ts` (`update`) + `bundles-admin.service.spec.ts`; Test race `bundles-admin.race-spec.ts`.

- [ ] **Step 1: test đỏ.** Unit: `$transaction` mock trả dòng đã đổi (`tx.bundle.findUnique` kèm `DETAIL_INCLUDE` trả bộ có món đắt hơn dòng đọc trước khoá) → `update` của nhân viên phải ném 403 dù dòng đọc trước khoá hợp lệ; dòng bị xoá giữa chừng → 404. Race: bộ BUNDLE_PCT của nhân viên (`pct` 10, hai món 100.000đ), `coupon.staff_max_percent = 20`, `coupon.staff_max_amount_vnd = 100_000`; PATCH A `{ pct: 20 }` và PATCH B `{ items: [hai món 500.000đ, maxQty 1] }` chạy `Promise.allSettled` (mỗi cái một mình hợp lệ: 40.000 và 100.000, ghép 200.000 > 100.000). Cổng chặn: bọc `validateContent` bằng rào hai đầu chờ tối đa 300ms để hai lệnh cùng qua bước kiểm trước khoá trên mã cũ. Kỳ vọng đúng một cái 403, cái kia thành công, và bộ lưu xuống có `bundleExposure ≤ 100_000`. Đỏ trên mã hiện tại (cả hai thành công, 200.000).
- [ ] **Step 2:** `npx jest ... bundles-admin.service.spec.ts` → FAIL; race → FAIL.
- [ ] **Step 3: implement.** `update`: bước đọc trước khoá chỉ còn để trả 404 sớm; trong `$transaction`, sau `SELECT ... FOR UPDATE`, đọc lại dòng (`tx.bundle.findUnique` với `DETAIL_INCLUDE`), rồi chạy trên dòng này: kiểm người tạo (`assertStaffCreated`), kiểm khung giờ, `normalizeBundleContent` + `validateContent` (gộp `dto` với dòng đã khoá). Tách phần dựng dữ liệu ghi thành một hàm riêng nhận `current` để dùng một lần, không nhân đôi khối `if (dto.pct !== undefined || ...)`.
- [ ] **Step 4:** spec + race xanh (chạy race 5 lần liên tiếp để chắc không chập chờn).
- [ ] **Step 5: Commit** `fix(api): kiểm lại nội dung bộ sau khoá FOR UPDATE, hai PATCH đồng thời không lách trần nhân viên`.

### Task 6: Chữ và logic "giữ khối" dùng chung (app-core) + `addonsSoldOut` ở API

**Files:** Modify `packages/app-core/src/commerce/bundle-view.ts` (+`bundle-view.spec.ts`), `api/bundle.ts`, `shop-copy.ts`, `shop-copy-budget.ts`; Modify `apps/api/src/modules/bundles/bundles.service.ts` (+spec); race `bundle-price-parity`.

**Interfaces — Produces:** `BundleHold`, `bundleHoldReason`, `bundleHoldTitle`, `latchBundleSide`, `ProductBundles.addonsSoldOut?` (chữ dùng khoá `stock.out`).

- [ ] **Step 1: test đỏ.** `bundle-view.spec.ts`: `bundleHoldReason('addons', { combos: [], addons: [bộ còn hạn, mọi món inStock:false] }, now) === 'soldOut'`; `addonsSoldOut: true` → `'soldOut'`; bộ quá hạn hoặc `addons: []` → `'ended'`; `data` undefined → `'ended'`; phía `combos` có bộ còn hạn mà `comboView` null (thiếu `variationId`) → `'soldOut'`. `latchBundleSide`: `live` không rỗng → `held: null`, `last = live`; `live` rỗng và `last` có → `{ items: last, held: why() }`; `live` rỗng và `last` null → `{ items: [], held: null }`. `bundleHoldTitle('addon.title', 'soldOut') === 'Mua kèm deal sốc · Tạm hết hàng'`, `'ended'` → `· Đã kết thúc`, `null` → chỉ tiêu đề. `bundles.service.spec.ts`: `forProduct` khi sản phẩm chính hết hàng và có bộ Mua kèm đang chạy → `{ addons: [], addonsSoldOut: true }`; còn hàng → không có khoá (undefined); không có bộ Mua kèm nào → không có khoá.
- [ ] **Step 2:** `cd packages/app-core && npx vitest run src/commerce/bundle-view.spec.ts src/shop-copy.spec.ts` và `cd apps/api && npx jest src/modules/bundles/bundles.service.spec.ts` → FAIL.
- [ ] **Step 3: implement** theo "Giao diện dùng chung". Chữ "Tạm hết hàng" lấy từ `stock.out` (đã có, trần 12). `forProduct`: tính `shown` như khi còn hàng; nếu `!anchorBuyable` và có bộ ADDON hiện được thì trả `addons: []` kèm `addonsSoldOut: true`.
- [ ] **Step 4:** các spec xanh; race `bundle-price-parity` (ca "sản phẩm chính hết hàng") thêm kiểm `addonsSoldOut`, xanh.
- [ ] **Step 5: Commit** `feat(app-core,api): phân biệt "Tạm hết hàng" với "Đã kết thúc" cho khối Combo/Mua kèm; logic giữ khối dùng chung`.

### Task 7: Web `PdpBundles` dùng `latchBundleSide`

**Files:** Modify `apps/web/src/app/san-pham/[slug]/pdp-bundles.tsx` + `pdp-bundles.spec.tsx`.

- [ ] **Step 1: test đỏ** trong nhóm "khối đã hiện thì không gỡ giữa trang": (a) khối Mua kèm hiện, dữ liệu tải lại là bộ còn hạn nhưng mọi món `inStock:false` → khối ở nguyên chỗ, tiêu đề "Mua kèm deal sốc · Tạm hết hàng", `inert`, nút khoá; (b) tải lại trả `{ addons: [], addonsSoldOut: true }` → cũng "Tạm hết hàng"; (c) bộ quá hạn → vẫn "Đã kết thúc" (ca có sẵn, giữ).
- [ ] **Step 2:** `cd apps/web && npx vitest run 'src/app/san-pham/[slug]/pdp-bundles.spec.tsx'` → FAIL ở (a), (b).
- [ ] **Step 3: implement.** Thay `useLatched` cục bộ bằng `useRef` + `latchBundleSide(live, ref.current, () => bundleHoldReason(side, query.data, now))`; tiêu đề qua `bundleHoldTitle`; `held` thay cho `ended` ở `EndedBody` và `disabled` (đặt `data-testid` `bundle-ended` giữ nguyên để spec cũ chạy).
- [ ] **Step 4:** spec xanh.
- [ ] **Step 5: Commit** `fix(web): khối Combo/Mua kèm ghi "Tạm hết hàng" khi bộ còn mà món hết, khác "Đã kết thúc"`.

### Task 8: Mini `PdpBundles` giữ khối như web

**Files:** Modify `apps/miniapp/src/components/product/pdp-bundles.tsx` + `pdp-bundles.spec.tsx`; Modify `apps/e2e/tests/bundles-cls.miniapp.spec.ts` (+`support/bundle-mocks.ts` nếu cần).

- [ ] **Step 1: test đỏ** (Vitest, cùng ca với Task 7 cho Mini): bộ đã hiện rồi tải lại ra rỗng → khối KHÔNG biến mất, tiêu đề "· Đã kết thúc", vùng nội dung có `inert`, nút "Thêm cả combo" và nút Mua kèm không gọi giỏ; món hết hàng/`addonsSoldOut` → "Tạm hết hàng"; chưa từng hiện + rỗng → `container` rỗng (ca có sẵn). E2E Mini 375px: PDP có combo + mua kèm, đồng hồ đẩy qua 30 giây và đẩy sự kiện tải lại để API trả rỗng → hai khối còn nguyên chỗ, tiêu đề mới, toạ độ `top` của khối bên dưới không đổi (so sánh `boundingBox` trước/sau).
- [ ] **Step 2:** `cd apps/miniapp && npx vitest run src/components/product/pdp-bundles.spec.tsx` → FAIL. E2E ca mới → FAIL.
- [ ] **Step 3: implement.** Hook mỏng giống web (`useRef` + `latchBundleSide`), `EndedBody` cho Mini: `<div {...({ inert: '' } as Record<string, string>)} aria-hidden="true" data-testid="bundle-ended" style={{ opacity: 0.6 }}>` (React 18 chưa có `inert` boolean); tiêu đề qua `bundleHoldTitle`; `onAddAll` và nút Mua kèm bị chặn khi `held`.
- [ ] **Step 4:** Vitest xanh; chạy riêng e2e ca mới xanh.
- [ ] **Step 5: Commit** `fix(miniapp): PDP giữ khối Combo/Mua kèm khi bộ hết hạn hay hết hàng, như web`.

### Task 9: Hai MINOR lượt 1 (gợi ý admin, trần độ dài chữ)

**Files:** Modify `apps/web/src/components/admin/bundles-tab.spec.tsx` (hoặc spec của form), `packages/app-core/src/shop-copy-budget.ts`.

- [ ] **Step 1: kiểm.** `bundle-form.tsx` hiện KHÔNG còn chuỗi `bundle.max_pct` (đã viết lại ở P15 vòng 1: "Không vượt trần % đang cấu hình (mặc định 50%)..."): thêm vào spec một ca chốt "mọi chữ gợi ý của form không chứa khoá cấu hình thô" (không khớp `/\b[a-z]+\.[a-z_]+\b/` ngoài URL/số), đỏ nếu ai đưa lại khoá thô.
- [ ] **Step 2: trần chữ.** Rút `addon.add` ("Thêm {n} món vào giỏ") và `addon.added` ("Đã thêm vào giỏ") về trần 8 không làm được mà vẫn giữ nghĩa: nút hiển thị SỐ món đã chọn ("Thêm 3 món") và đứng một mình trong khối, rộng hết khối (không phải "nút nhỏ" như ux-copy B7 giả định; mục C của ux-copy không có dòng nào cho nút rộng hết khối, `combo.add` "Thêm cả combo" cùng dạng cũng không có trần). Giữ chữ và trần 20/16, ghi lý do ngay trên hai dòng trong `shop-copy-budget.ts` (đối chiếu ux-copy B7 và C), kiểm đủ một dòng ở 375px trong ảnh chụp (Task 10).
- [ ] **Step 3:** `cd apps/web && npx vitest run src/components/admin/bundles-tab.spec.tsx`; `cd packages/app-core && npx vitest run src/shop-copy.spec.ts` xanh.
- [ ] **Step 4: Commit** `test(web): chốt gợi ý admin Combo không lộ khoá cấu hình; ghi lý do trần chữ nút Mua kèm`.

### Task 10: Chụp 375px, gate, ghi nhận

**Files:** Modify `plans/P15-bundles.md` ("Chờ chủ quyết" mục 1, 2: ghi "đã sửa ở F8"); Create `screens/F8/*.png` (gitignore).

- [ ] **Step 1:** chụp 375px (Mini Vite cổng 3345, web Next cổng 3346, host localhost; mock/fixture): PDP có Mua kèm giá sau trần, khối "Đã kết thúc", khối "Tạm hết hàng", ở cả hai app; so từng cặp; tắt server của mình.
- [ ] **Step 2:** `npx prisma generate` trong `apps/api`; `pnpm --filter @tubutree/shared-types build`; race spec liên quan với DB riêng (`bundle-price-parity`, `bundles-admin`, `cart-combo-equals-quote`, `coupon-preview-equals-quote`, `split-checkout`, `buyer-totals-regression`, `partner-goods-rules`).
- [ ] **Step 3:** gate một lần: `bash docs/2026-10-28-review/tools/gate.sh <worktree> --base 019e3d59d --out .../gate-F8.txt`; rồi e2e Mini toàn bộ (`cd apps/e2e && E2E_SCOPE=miniapp E2E_MINIAPP_PORT=3345 npx playwright test --workers=2 --reporter=line`); FAIL nào cũng kiểm trên base trước khi kết luận.
- [ ] **Step 4:** `pg-native.sh stop 25677`; commit `docs(shop): F8 ghi kết quả, đóng hai việc chờ chủ của P15`.

## Self-review

- **Độ phủ:** (1) Task 1 + 4; (2) Task 2; (3) Task 5; (4) Task 1 (hàm) + 3 (service, race); (5) Task 8; (6) Task 6, 7, 8; (7) Task 9.
- **Nhất quán tên:** `addonUnitDiscount`/`addonPayPrice`/`isOwnStaffBundle` (Task 1) là tên Task 2 và 4 dùng; `BundleHold`/`bundleHoldReason`/`bundleHoldTitle`/`latchBundleSide` (Task 6) là tên Task 7 và 8 dùng; `refPrice` thống nhất ở schema, loader, admin, API công khai.
- **Rủi ro biết trước:** dữ liệu `refPrice` backfill lấy giá hiện tại (không có giá lúc tạo); chấp nhận vì bộ chưa lên PROD. API công khai vẫn quảng cáo bộ cho chính nhân viên tạo (cache chung, giỏ chỉ giảm ít hơn quảng cáo), giống Giờ vàng và mã.

## Sửa theo review lần chạy lại (đợt 4e-2)

| Mức | Phát hiện | Cách sửa |
|---|---|---|
| MAJOR | Form sửa luôn gửi lại cả `items`, nên `update()` ghi lại `refPrice` theo giá HIỆN TẠI và gỡ trần của Task 1/4 (gia hạn giờ cũng đủ để giảm vọt 11.000đ → 461.000đ); chi tiết admin báo sai khoản giảm; nhân viên gia hạn bộ của mình bị 403 oan | `keptRefPrices` (món không đổi sản phẩm/phân loại/giá kèm giữ `refPrice` cũ; món mới, đổi giá kèm hay dòng cũ thiếu `refPrice` lấy giá lúc sửa); `capAtRefPrices` cho trần nhân viên; `AdminBundleItem.refPrice` và form báo `min(giá bán, refPrice) − giá kèm`. Test: unit (`bundle-admin-rules`, `bundles-admin.service`), race hai ca (admin, nhân viên), web (`bundles-tab`, `admin-bundle-form`) |
| MINOR | `bundleHoldReason` coi MỌI bộ còn hạn của phía đó là lý do giữ, nên bộ A bị tắt mà bộ B còn chạy (mọi món hết hàng) ra "Tạm hết hàng" thay vì "Đã kết thúc" | `bundleHoldReason(..., heldBundleIds)` chỉ tính các bộ của dòng đang giữ; `latchBundleSide` đưa danh sách đang giữ cho `why`. Giới hạn đã biết: khi API báo `addonsSoldOut` (sản phẩm chính hết hàng, `addons` rỗng) không có mã bộ để đối chiếu nên coi mọi bộ đang giữ là hết hàng |
| MINOR | `bundle.soldOut` lặp lại chữ chuẩn `stock.out` | bỏ khoá `bundle.soldOut` (copy lẫn budget), tiêu đề giữ khối dùng `stock.out`; spec chốt chữ chỉ có một nơi định nghĩa |

## Sửa theo review lần chạy lại thứ hai (đợt 4e-2)

| Mức | Phát hiện | Cách sửa |
|---|---|---|
| MAJOR | Gợi ý "Giảm …" và ghi chú "giảm tính theo giá X" của form admin luôn dùng `refPrice` đã lưu, kể cả khi admin vừa sửa giá kèm; máy chủ chỉ giữ `refPrice` khi sản phẩm, phân loại và giá kèm không đổi (`keptRefPrices`), sửa giá kèm thì đặt lại theo giá đang bán, nên form báo giảm nhỏ hơn số giỏ sẽ cho (vd 5.000đ so với 455.000đ) | `BundleDraftItem.savedAddonPrice` + `keptRefPrice()` ở `admin-bundle-form.ts`: `refPrice` chỉ còn hiệu lực khi ô giá kèm vẫn bằng giá đã lưu (cùng luật `keptRefPrices`); `addonBasePrice` và ghi chú dùng nó. Test: `admin-bundle-form.spec` (ba ca), `bundles-tab.spec` (gõ 45.000 → 455.000đ, 399.000 → 101.000đ, trả về 39.000 → 11.000đ) |
| MINOR | `validateContent` và `assertStaffCreated` chạy trong giao dịch đang giữ `FOR UPDATE` nhưng qua `this.prisma` (kết nối thứ hai): đủ N PATCH bằng cỡ hồ thì cả nhóm quá hạn | catalog và người tạo đọc qua `tx`; cấu hình (`bundle.max_pct`, trần nhân viên) đọc TRƯỚC khi mở giao dịch. Test: unit (không có lệnh nào qua kết nối khác lúc giữ khoá), race hồ 2 chỗ + hai PATCH (đỏ trên mã cũ: một PATCH bị từ chối) |
| MINOR | Trần % nhân viên đã tính trên `min(giá, refPrice)` mà lời từ chối vẫn nói "so với giá đang bán" | `ResolvedBundleItem.cappedAt` (đặt bởi `capAtRefPrices` khi kẹp), lời từ chối: "so với giá lúc đặt giá kèm (50.000đ)"; chưa kẹp thì giữ chữ cũ. Test: `bundle-admin-rules.spec` |
