# P15 bundles: combo toàn sàn + mua kèm Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `Bundle` + `BundleItem` (BUNDLE_PCT "mua đủ bộ giảm %", ADDON "mua kèm giá riêng"), tính giảm qua đường combo sẵn có, hiện ở PDP ("Combo ưu đãi" ≤2, "Mua kèm deal sốc" ≤3), giỏ (dòng "Giảm giá combo" sẵn có), khối `combos` Trang chủ, và admin "Combo và mua kèm". Mini App và web cùng gói.

**Architecture:** hàm thuần `bundle-rules.ts` (chia khoản giảm về từng dòng, gộp "lớn nhất mỗi dòng") + `bundle-read.ts` (đọc đợt đang chạy). `ComboService.computeForStorefront` giữ nguyên chữ ký (14 spec/race spec đang mock tên này) nhưng trả thêm khoản giảm của bundle, hợp với combo gian hàng bằng max từng dòng; nên giỏ, báo giá, xem trước mã và đặt đơn tự đi qua `comboPerLine`/`Order.comboDiscount`/`paidTotal` mà không sửa checkout-split. API công khai `GET /products/:slug/bundles`, `GET /bundles/combos`; admin `/admin/bundles` (MARKETING, nhân viên bị trần). Giao diện: thành phần mới `PdpBundles`/`HomeCombos` ở file riêng, chỉ thay `<PdpBundleSlots />` (chỗ P8 để sẵn) ở hai file PDP. Web PDP lấy bundle ở server làm `initialData` để không chèn khối sau khi tải (CLS).

**Tech Stack:** NestJS + Prisma + jest (API, race spec Postgres thật), vitest (app-core, Mini, web), React 18 + zmp-ui (Mini), Next 15 (web), Playwright (e2e Mini).

**Spec:** `docs/2026-10-31-shop-redesign/01-thiet-ke.md` (§4 Q15, §5 "Combo + mua kèm toàn sàn"), mục P15 của `02-ke-hoach.md`, `review/backend-gap.md` §4–6, `review/ia-merch.md` D4, `review/critique-shop.md` (PDP combo/mua kèm), `review/ux-copy.md` B7, `review/a11y.md` B7. Bàn giao: `plans/handoff-wave1..4a.md`.

## Kết luận kiểm luật hiện có (đọc mã trước khi viết plan)

- **Hoa hồng CTV:** `affiliate/commission-base.ts::paidLineTotals` lấy `OrderItem.paidTotal`; `checkout-split.ts::splitOverLines` ghi `paid = total − combo − coupon − tier − points`. Bundle đi vào `comboPerLine` nên hoa hồng tính trên giá sau giảm bundle, đúng Q15 ("giữ luật hiện có của combo gian hàng"), KHÔNG cần sửa gì ở hoa hồng. Hệ quả cho chủ: combo toàn sàn làm giảm hoa hồng CTV (ghi vào PROGRESS).
- **Trả một món của combo:** `orders/refund-allocation.ts::computeReturnShares` hoàn đúng `paidTotal` của dòng (luỹ kế, trả hết dòng = đúng `paidTotal`), không thu lại phần giảm của món còn giữ. Đúng Q15; P15 chỉ thêm test chứng minh trên đơn có bundle.
- **Thứ tự giảm:** Giờ vàng → combo (gian hàng và bundle, max mỗi dòng) → mã → hạng → điểm. Dòng Giờ vàng không nhận combo: `lines` đưa vào `computeForStorefront` đã loại dòng Giờ vàng, nên bundle cũng không giảm dòng Giờ vàng, và một bộ thiếu món vì món đó đang Giờ vàng thì không đủ bộ (cùng luật combo gian hàng).
- **Hàng đối tác (`cart/partner-goods.ts`):** bundle có món hoặc món chính thuộc `isPartnerOwnedProduct` bị loại cả bộ, ở admin (400 `partnerGoodsError('COMBO')`) lẫn lúc tính tiền/đọc công khai (dữ liệu ghi tay hoặc sản phẩm đổi chủ về sau).
- **Giá đổi giữa báo giá và đặt đơn:** `placeOrder` đã chặn khi `computed.total > dto.expectedTotal` (`TOTAL_CHANGED`). Bundle hết hạn/tắt giữa hai lần tính làm tổng tăng nên bị chặn đúng cơ chế đó; ranh giới `startAt <= now < endAt`.
- **ADDON ghim một phân loại (sửa sau review vòng 1):** giá kèm là một con số cố định, nên chỉ có nghĩa với MỘT phân loại. Bản đầu cho món không ghim nhận giá kèm trên mọi phân loại: món có phân loại 50.000đ (giá đại diện) và 500.000đ, giá kèm 39.000đ, khách chọn loại 500.000đ ×2 thì 1.000.000đ hàng bán 78.000đ, và giỏ = báo giá = đơn nên `TOTAL_CHANGED` không bắt. Luật mới: `normalizeBundleContent` đòi `variationId` cho mọi món ADDON, `resolveBundleItems` so giá kèm với giá phân loại ghim, `addonBundle` bỏ món không ghim (dữ liệu ghi tay không giảm), `BundlesService.build` bỏ món không ghim khỏi bộ công khai, form admin chọn món theo phân loại (`AddonVariationPicker`). BUNDLE_PCT vẫn cho món không ghim vì giảm theo %.
- **Trần nhân viên trên phân loại đắt nhất:** `bundleExposure` và kiểm % của nhân viên tính trên giá cao nhất mà một dòng giỏ của món có thể mang (`ResolvedBundleItem.maxPrice`: phân loại ghim, hoặc phân loại đắt nhất đang bán của món BUNDLE_PCT không ghim), không phải phân loại đại diện (rẻ nhất) như bản đầu: combo 20% `maxQty` 10 trên món 50.000đ/500.000đ là 2.000.000đ mỗi đơn, không phải 200.000đ.
- **Công khai không quảng cáo bộ mà giỏ không giảm vì Giờ vàng:** giỏ chỉ đưa dòng KHÔNG Giờ vàng vào `computeForStorefront`. `GET /products/:slug/bundles` và `GET /bundles/combos` (qua `loadFlashFootprint`, cùng điều kiện `FlashSaleService.resolveEffective`: đợt bật và đang trong giờ, còn suất, phân loại còn bán) ẩn ADDON có sản phẩm chính đang Giờ vàng, bỏ món kèm có phân loại sẽ vào giỏ đang Giờ vàng, và bỏ cả combo có một món (phân loại sẽ vào giỏ) đang Giờ vàng. Không tra theo người mua (API công khai, cache chung): người đã hết suất cá nhân vẫn thấy bộ ẩn, và giỏ chỉ giảm thêm chứ không bao giờ đắt hơn thứ đã quảng cáo.
- **Chống trùng Trang chủ (lệch §5, ghi nhận):** `composeHomeShelves` xếp combo theo id bộ nên món của combo vẫn có thể hiện ở Bán chạy nhất, trái thứ tự §5 (Giờ vàng > Mua lại > Combo > Bán chạy). Không sửa vì trên web khối combo chỉ tải ở trình duyệt: nếu combo chiếm món thì Bán chạy nhất (đã có trong HTML ISR) mất món sau hydrate, làm kệ nhảy và phá "Danh mục không xê dịch"/`home-p6-cls`. Muốn làm đúng §5 thì phải cho combo đi cùng yêu cầu `/home` gộp ở server (ISR) trước, việc của gói sau.
- **Ngân sách độ dài chữ:** `addon.add` (8 → 20), `addon.added` (8 → 16), `addon.title` (18), `combo.pdpTitle` (14), `combo.homeTitle` (18), `addon.pickHint` (24) không lấy ở ux-copy mục C (ở đó nút nhỏ chỉ "Thêm"/"Đã thêm", tiêu đề "Mua kèm giá ưu đãi"). Tiêu đề theo `01-thiet-ke.md` §3 (PDP), nút theo `review/a11y.md` B7 ("Thêm {n} món vào giỏ"); số ký tự là số đo thực của chữ ở trường hợp xấu nhất (n = 3).
- **Không quota toàn cục** cho bundle bản đầu (backend-gap §4b); chặn rủi ro bằng `maxQty` mỗi đơn (số đơn vị mỗi món được hưởng).

## Global Constraints

- Node: `export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH`; worktree mới đã chạy `pnpm --filter @tubutree/shared-types build` và `npx prisma generate` (apps/api).
- Giá không âm: `addonPrice ≥ 0` (CHECK ở migration + DTO + service); `addonPrice ≥ giá đang bán` thì dòng không giảm (không bao giờ giá tăng). Khoản giảm mỗi dòng ≤ `total` của dòng.
- Mỗi dòng lấy khoản giảm LỚN NHẤT giữa combo gian hàng và mọi bundle; không cộng dồn.
- Chữ giao diện theo `01-thiet-ke.md` §4 Q5 và `review/ux-copy.md` B7; không "Top", "Freeship", "Kho voucher", "Nhãn hàng". Khoá chữ mới thêm CẢ `shop-copy.ts` và `shop-copy-budget.ts`.
- Mini App: entry ≤ 700 KB (hiện 630); PDP/Home thêm khối vào chunk lười đã có, không thêm thư viện; ghi số trước/sau.
- CLS: khối PDP không chèn đẩy màn đầu sau khi tải (web: dữ liệu từ server; Mini: khối nằm dưới màn đầu, ẩn hẳn khi không có); `home-p6-cls` và 'Danh mục không xê dịch' giữ xanh.
- Vùng chạm ≥ 44px, tương phản ≥ 4,5:1, axe 0 vi phạm ở 375px trên màn đụng tới.
- Migration `20261101120000_bundles` (sau P14 `20261101110000_*`, P16 `20261101110100_*`); chỉ thêm bảng/enum, không sửa bảng cũ.
- Không sửa file của P10/P14/P16/F6/P17a hoặc `pdp-extras.tsx` và khối Điểm Xanh của 7e. File gộp tay chỉ thêm dòng của gói: `shop-copy*.ts`, `route-map.json` (không có route mới), `staff-permissions.matrix.spec.ts`, `app/admin/page.tsx`, `app.module.ts`.
- Không deploy, không đọc/ghi PROD, không push. Comment chỉ giải thích "vì sao".

## Review Focus

1. Giờ vàng + bundle + mã cùng lúc: giỏ = báo giá = số trừ khi đặt đơn, dòng Giờ vàng không nhận bundle, mã tính trên phần sau combo. Test: Task 4 (`bundle-price-parity`).
2. Bundle hết hạn/tắt giữa báo giá và đặt đơn: báo giá mới không giảm; đặt với `expectedTotal` cũ bị `TOTAL_CHANGED`; tổng giảm thì đơn đi tiếp. Test: Task 4.
3. Món của bộ hết hàng, bị ẩn, hoặc đổi sang hàng đối tác: bộ không được quảng cáo "tạm hết" sai, không giảm tiền cho thứ không đủ bộ. Test: Task 2, 5.
4. Giá mua kèm ≥ giá đang bán (sale tụt xuống dưới giá kèm) hoặc 0đ: không giảm âm; 0đ hợp lệ (tặng kèm). Test: Task 2, 6.
5. Giỏ nhiều phân loại cùng sản phẩm, số lượng nhiều hơn `maxQty`: chỉ `maxQty` đơn vị được hưởng; không dòng nào bị giảm quá `total`. Test: Task 2.

---

## File Structure

| File | Trách nhiệm |
|---|---|
| `apps/api/prisma/schema.prisma` + `migrations/20261101120000_bundles/` | enum `BundleKind`, `Bundle`, `BundleItem` (+ CHECK), quan hệ ngược trên `Product`, `Variation` |
| `apps/api/src/modules/bundles/bundle-rules.ts` | thuần: `allocateBundleDiscounts`, `mergeMaxPerLine`, `bundleExposure` |
| `apps/api/src/modules/bundles/bundle-read.ts` | `loadLiveBundles(prisma, now, productIds)` bỏ bộ có hàng đối tác |
| `apps/api/src/modules/storefront/combo.service.ts` | `computeForStorefront` gộp bundle (max mỗi dòng), `ComboLine.quantity` |
| `apps/api/src/modules/cart/cart.service.ts`, `checkout/checkout.service.ts` | luôn gọi `computeForStorefront` (kể cả không gian hàng), truyền `quantity` |
| `apps/api/src/modules/bundles/bundles.service.ts`, `bundles.controller.ts`, `bundles.module.ts` | `GET /products/:slug/bundles`, `GET /bundles/combos` |
| `apps/api/src/modules/bundles/bundles-admin.service.ts`, `bundles-admin.controller.ts`, `bundle-admin-rules.ts`, `dto/bundle.dto.ts` | `/admin/bundles` CRUD + trần nhân viên |
| `packages/app-core/src/api/bundle.ts`, `queries/bundle.ts`, `commerce/bundle-view.ts`, `shop-copy*.ts` | kiểu DTO, hàm gọi API, `comboView`/`addonRows`/`addonSummary`, chữ |
| `apps/miniapp/src/components/product/pdp-bundles.tsx`, `components/home/home-combos.tsx`, `pages/product-detail.tsx`, `pages/home.tsx`, `use-home-shelves.ts` | PDP + Trang chủ Mini |
| `apps/web/src/app/san-pham/[slug]/pdp-bundles.tsx`, `page.tsx`, `components/home/home-combos.tsx`, `home-view.tsx`, `use-home-shelves.ts` | PDP + Trang chủ web |
| `apps/web/src/components/admin/bundles-tab.tsx`, `bundle-form.tsx`, `lib/admin-bundles-client.ts`, `app/admin/page.tsx` | admin "Combo và mua kèm" (nhóm "Khuyến mãi và điểm", cạnh "Chiến dịch") |
| `apps/api/test/integration-race/bundle-price-parity.race-spec.ts` | race spec Postgres thật |
| `apps/e2e/tests/bundles.miniapp.spec.ts`, `support/bundle-mocks.ts` | e2e Mini (mock API) |

---

### Task 1: Prisma model + migration

**Files:** Modify `apps/api/prisma/schema.prisma`; Create `apps/api/prisma/migrations/20261101120000_bundles/migration.sql`.

**Interfaces — Produces:** `enum BundleKind { BUNDLE_PCT ADDON }`. `Bundle { id cuid, kind, title, pct Int?, anchorProductId String? (onDelete SetNull, relation "BundleAnchor"), isActive @default(true), startAt, endAt, sortOrder Int @default(0), createdById String?, items BundleItem[], createdAt, updatedAt; @@index([isActive, startAt, endAt]); @@index([anchorProductId]); @@map("bundles") }`. `BundleItem { bundleId (Cascade), productId (Cascade), variationId String? (SetNull), addonPrice Int?, maxQty Int @default(1), sortOrder Int @default(0); @@id([bundleId, productId]); @@index([productId]); @@map("bundle_items") }`. CHECK trong migration: `bundles_pct_chk (pct IS NULL OR pct BETWEEN 1 AND 100)`, `bundles_window_chk (endAt > startAt)`, `bundle_items_addon_price_chk (addonPrice IS NULL OR addonPrice >= 0)`, `bundle_items_max_qty_chk (maxQty BETWEEN 1 AND 10)`, `bundles_kind_chk` (BUNDLE_PCT cần `pct`; ADDON cần `anchorProductId`... không ràng buộc ở DB vì anchor SetNull).

- [ ] **Step 1:** `bash docs/2026-10-20-uat/tools/pg-native.sh start 25548`, tạo DB `tubutree_it` trong cụm, `export DATABASE_URL=postgresql://tubu@127.0.0.1:25548/tubutree_it`.
- [ ] **Step 2:** sửa schema, `npx prisma migrate dev --create-only --name bundles` trong `apps/api`, đổi tên thư mục thành `20261101120000_bundles`, thêm CHECK vào cuối `migration.sql`, `npx prisma migrate dev` áp lại. Mong đợi: SQL chỉ có `CREATE TYPE`, `CREATE TABLE`, `CREATE INDEX`, FK, `ALTER TABLE ... ADD CONSTRAINT ... CHECK`; không `ALTER` nào lên bảng cũ.
- [ ] **Step 3:** `npx prisma generate`; `npx tsc --noEmit -p tsconfig.json` (apps/api) xanh. Kiểm CHECK: `psql` thử chèn `addonPrice = -1` bị từ chối.
- [ ] **Step 4: Commit** `feat(api): model Bundle, BundleItem và migration bundles`.

### Task 2: Luật chia khoản giảm (thuần)

**Files:** Create `apps/api/src/modules/bundles/bundle-rules.ts`; Test `bundle-rules.spec.ts`.

**Interfaces — Produces:**
```ts
export interface BundleLine { variationId: string; productId: string; total: number; quantity: number }
export interface LiveBundle { id: string; kind: 'BUNDLE_PCT' | 'ADDON'; pct: number | null; anchorProductId: string | null;
  items: { productId: string; variationId: string | null; addonPrice: number | null; maxQty: number }[] }
export interface BundleDiscount { total: number; perLine: Record<string, number> }
export function allocateBundleDiscounts(bundles: LiveBundle[], lines: BundleLine[], maxPct: number): BundleDiscount;
export function mergeMaxPerLine(a: BundleDiscount, b: BundleDiscount): BundleDiscount; // mỗi variationId lấy max, total = tổng perLine
export function bundleExposure(b: { kind: 'BUNDLE_PCT' | 'ADDON'; pct: number | null }, items: { price: number; addonPrice: number | null; maxQty: number }[]): number; // VND tối đa một đơn được giảm
```

- [ ] **Step 1: test đỏ** (`bundle-rules.spec.ts`), mỗi ca một `it`:
  - BUNDLE_PCT 10% bộ p1+p2, giỏ v1 60.000×1 + v2 40.000×2 (total 80.000), `maxQty` 1: `perLine` `{ v1: 6000, v2: 4000 }` (v2 chỉ 1 đơn vị được hưởng = floor(40.000×10/100)), `total` 10.000.
  - Thiếu một món của bộ → `{ total: 0, perLine: {} }`; bộ chỉ 1 sản phẩm khác nhau → 0; `pct` 0 → 0; `pct` 90 với `maxPct` 30 → kẹp 30.
  - Món ghim `variationId`: giỏ có phân loại khác của cùng sản phẩm thì bộ không đủ; có đúng phân loại thì giảm đúng dòng đó. Món không ghim, hai phân loại cùng sản phẩm trong giỏ, `maxQty` 2, mỗi dòng 2 đơn vị: tổng đơn vị được hưởng đúng 2 (dòng đầu 2, dòng sau 0).
  - ADDON anchor p1, kèm p2 giá kèm 39.000, giỏ p1 + p2 (50.000×1): giảm 11.000 ở dòng p2; thiếu anchor → 0; `addonPrice` ≥ đơn giá (sale tụt 30.000, kèm 39.000) → 0; `addonPrice` 0 → giảm đủ đơn giá, không âm, `perLine ≤ total`; `maxQty` 1 với 3 đơn vị → chỉ giảm 1 đơn vị; món kèm cũng là anchor thì bỏ.
  - Nhiều bundle trùng dòng → lấy lớn nhất, không cộng; `mergeMaxPerLine({v1:5,v2:9},{v1:7})` → `{ v1:7, v2:9 }`, `total` 16.
  - `bundleExposure({kind:'BUNDLE_PCT',pct:10}, [{price:60000,addonPrice:null,maxQty:1},{price:40000,addonPrice:null,maxQty:2}])` = 6000 + 8000 = 14.000; ADDON `(50.000−39.000)×maxQty 2` = 22.000.
- [ ] **Step 2:** `npx jest src/modules/bundles/bundle-rules.spec.ts` → FAIL (module chưa có).
- [ ] **Step 3: implement** theo đúng chữ ký. Đơn vị được hưởng của một dòng = `min(quantity, còn lại của món)`; khoản giảm BUNDLE_PCT dòng = `floor(total × take × pct / (quantity × 100))`, ADDON = `max(0, floor(total / quantity) − addonPrice) × take`; `pct` kẹp `min(pct, maxPct, 100)`; bộ BUNDLE_PCT cần ≥ `MIN_COMBO_PRODUCTS` (import từ `../storefront/combo.service`) sản phẩm khác nhau. ADDON cần `anchorProductId` có trong `lines`.
- [ ] **Step 4:** chạy lại → PASS. **Step 5: Commit** `feat(api): luật chia khoản giảm combo và mua kèm toàn sàn`.

### Task 3: Đọc bundle đang chạy + nối vào ComboService, giỏ, checkout

**Files:** Create `bundles/bundle-read.ts`, `bundle-read.spec.ts`; Modify `storefront/combo.service.ts`, `combo.service.spec.ts`, `cart/cart.service.ts`, `cart.service.spec.ts`, `checkout/checkout.service.ts`, `checkout.service.spec.ts`.

**Interfaces — Consumes:** Task 2. **Produces:**
```ts
// bundle-read.ts
export const BUNDLE_MAX_PCT_KEY = 'bundle.max_pct'; export const BUNDLE_MAX_PCT_DEFAULT = 50;
export async function loadLiveBundles(prisma: Pick<PrismaService, 'bundle'>, now: Date, productIds: readonly string[]): Promise<LiveBundle[]>;
// combo.service.ts
export interface ComboLine { variationId: string; productId: string; total: number; quantity?: number }
ComboService.computeForStorefront(slug: string | null | undefined, lines: ComboLine[], buyerId?: string, now?: Date): Promise<ComboResult>
```
`quantity` thiếu coi như 1 (chỉ các spec cũ gọi thuần; cart/checkout luôn truyền).

- [ ] **Step 1: test đỏ:** `bundle-read.spec.ts` với prisma giả: where lọc `isActive`, `startAt <= now`, `endAt > now` (đúng ranh giới: `endAt === now` không lấy), bỏ bộ có món/anchor `storefrontId != null`, ánh xạ ra `LiveBundle`. `combo.service.spec.ts`: slug null + bundle đang chạy → vẫn giảm; slug có combo 10% và bundle 20% cùng dòng → lấy 20%; chủ gian hàng mua không mất bundle; không bundle (mock `bundle.findMany` → `[]`) thì kết quả như cũ. `cart.service.spec.ts`/`checkout.service.spec.ts`: `computeForStorefront` được gọi cả khi không có gian hàng; `toHaveBeenCalledWith('linh-shop', [{ variationId: 'v1', productId: 'prod1', total: 100, quantity: 1 }], 'u1')`.
- [ ] **Step 2:** chạy các spec trên → FAIL.
- [ ] **Step 3: implement:** `loadLiveBundles` một truy vấn (`OR` theo `items.some.productId in` / `anchorProductId in`). `computeForStorefront`: tính combo gian hàng như cũ (slug null → rỗng), đọc `bundle.max_pct`, `allocateBundleDiscounts`, `mergeMaxPerLine`. Cart: `couponBaseAfterCombo` gọi `computeForStorefront(storefront?.slug ?? null, …quantity…)` luôn; checkout `couponBase` thêm `quantity`.
- [ ] **Step 4:** chạy lại các spec trên + `npx jest src/modules/cart src/modules/checkout src/modules/storefront` → PASS. **Step 5: Commit** `feat(api): giỏ và checkout trừ khoản giảm của bundle qua comboPerLine`.

### Task 4: Race spec `bundle-price-parity` (Postgres thật)

**Files:** Create `apps/api/test/integration-race/bundle-price-parity.race-spec.ts` (mẫu: `cart-combo-equals-quote.race-spec.ts`).

- [ ] **Step 1: viết spec** (DB `tubutree_it` cụm 25548): bộ provider như `cart-combo-equals-quote` nhưng dùng `ComboService` thật. Ca:
  1. BUNDLE_PCT 10% (a 60.000 + b 40.000×2) + mã PERCENT 10%: `cart.getCart` = `checkout.quote` (subtotal, `comboDiscount`, `discount`, `subtotal − combo − discount = total − shippingFee`); `comboDiscount` 10.000 (maxQty 1); mã 10% trên 130.000 sau combo = 13.000.
  2. Giờ vàng + bundle + mã cùng lúc: sản phẩm thứ ba Giờ vàng 100.000→50.000 trong giỏ; dòng Giờ vàng không nhận bundle, mã không tính phần Giờ vàng; giỏ = báo giá = `OrderItem.total/paidTotal` sau `placeOrder`; `Order.comboDiscount` = tổng bundle; Σ `paidTotal` = `order.total − shippingFee`.
  3. Bundle + combo gian hàng cùng dòng: lấy lớn hơn, không cộng (combo gian hàng 30% > bundle 10% và ngược lại).
  4. ADDON: anchor + món kèm 39.000 (giá 50.000): giảm 11.000, giỏ = báo giá.
  5. Hết hạn giữa hai lần: báo giá có bundle (giảm); `prisma.bundle.update({ endAt: quá khứ })`; báo giá mới không giảm; `placeOrder` với `expectedTotal` của báo giá cũ ném lỗi `TOTAL_CHANGED` (`BadRequestException` mã `TOTAL_CHANGED`) và không tạo đơn; bật lại bộ khác rẻ hơn thì đơn đi tiếp (tổng giảm không bị chặn). Tắt bằng `isActive=false` cùng kết quả.
  6. Hàng đối tác: bộ có món thuộc `storefrontId` → không giảm; mua món của bộ hàng Tubu bình thường vẫn giảm.
  7. Trả một món: sau `placeOrder` đơn có bundle, `computeReturnShares` trả một dòng đúng `refundAmount === paidTotal` của dòng đó và `goods` bằng nó (không thu lại phần giảm của món còn giữ).
- [ ] **Step 2:** `cd apps/api && DATABASE_URL=postgresql://tubu@127.0.0.1:25548/tubutree_it npx jest -c test/integration-race/jest.config.js --runInBand test/integration-race/bundle-price-parity.race-spec.ts` → chạy đúng cả 7 ca PASS (nếu Task 3 đủ thì xanh ngay; đỏ ca nào thì sửa mã Task 3 chứ không nới test).
- [ ] **Step 3: Commit** `test(api): race spec bundle-price-parity (giỏ = báo giá = đặt đơn)`.

### Task 5: API công khai

**Files:** Create `bundles/bundles.service.ts`, `bundles.controller.ts`, `bundles.module.ts`, `bundles.service.spec.ts`, `bundles.controller.spec.ts`; Modify `app.module.ts` (import `BundlesModule`).

**Interfaces — Produces:**
```ts
export interface BundleItemDTO { productId: string; variationId: string; maxQty: number; addonPrice: number | null; inStock: boolean; product: ProductCard }
export interface BundleDTO { id: string; kind: 'BUNDLE_PCT' | 'ADDON'; title: string; pct: number | null; endAt: string; anchorProductId: string | null; items: BundleItemDTO[] }
BundlesService.forProduct(slug: string, now?: Date): Promise<{ combos: BundleDTO[]; addons: BundleDTO[] }>   // combos ≤2, addons ≤3 bộ
BundlesService.homeCombos(limit: number, now?: Date): Promise<BundleDTO[]>                                 // chỉ bộ đủ hàng, mặc định 4
```
Route: `GET /products/:slug/bundles` và `GET /bundles/combos?limit=` (`@Public()`, `@PublicCache('CATALOG')`). `product` = thẻ từ `CatalogService.cardsByIds` với giá thay bằng phân loại đã chọn (`variationId` ghim hoặc đại diện); `pct` kẹp `bundle.max_pct`.

- [ ] **Step 1: test đỏ:** sản phẩm có bộ đang chạy → combos có đủ món và `pct` kẹp; bộ hết hạn/tắt/chưa tới giờ không có; món thuộc đối tác → bỏ cả bộ; món bị ẩn (`cardsByIds` không trả) → bỏ cả bộ; món hết hàng → bộ giữ nhưng `inStock=false` ở `forProduct`, bị bỏ ở `homeCombos`; ADDON chỉ hiện ở sản phẩm là anchor; `limit` kẹp 1..8; sản phẩm không tồn tại → 404. Controller: hai route có `PublicCache`.
- [ ] **Step 2:** FAIL. **Step 3: implement** service + controller + module (import `CatalogModule`, `PrismaModule` sẵn global). **Step 4:** PASS + `npx tsc --noEmit`. **Step 5: Commit** `feat(api): GET /products/:slug/bundles và /bundles/combos`.

### Task 6: API admin + trần nhân viên

**Files:** Create `bundles/bundle-admin-rules.ts`, `bundles-admin.service.ts`, `bundles-admin.controller.ts`, `dto/bundle.dto.ts` và spec của từng file; Modify `bundles.module.ts`, `common/staff-permissions.matrix.spec.ts`.

**Interfaces — Produces:** `@Roles('ADMIN') @AllowStaff('MARKETING') @Controller('admin/bundles')`: `GET /` (`?status=live|scheduled|ended|off`), `GET /:id`, `POST /`, `PATCH /:id` (nếu có `items` thì thay cả danh sách), `DELETE /:id`. Body: `{ kind, title, pct?, anchorProductId?, startAt, endAt, isActive?, sortOrder?, items: { productId, variationId?, addonPrice?, maxQty? }[] }` (giờ ISO, web gửi qua `vnLocalToIso`). Luật (`bundle-admin-rules.ts`, thuần): tiêu đề 1–120 ký tự; `endAt > startAt`; BUNDLE_PCT: `pct` nguyên 1..`bundle.max_pct`, 2–6 sản phẩm khác nhau, không `addonPrice`, bỏ `anchorProductId`; ADDON: `anchorProductId` bắt buộc, 1–3 món khác anchor, mỗi món GHIM `variationId`, `addonPrice` nguyên ≥ 0 và < giá đang bán của phân loại ghim, không `pct`; `maxQty` 1..10 (mặc định 1); món/anchor phải đang bán, đã duyệt, không đối tác (`partnerGoodsError('COMBO', name)`), `variationId` thuộc đúng sản phẩm và đang bán. Nhân viên (`actor.staff`): `pct` (hoặc % giảm của món kèm) ≤ `loadStaffCouponCaps().maxPercent`, `bundleExposure` ≤ `maxAmount`, chỉ sửa/xoá bộ do nhân viên tạo (`createdById` có role STAFF), 403 với bộ của quản trị viên (mẫu `assertStaffCreated` của Giờ vàng).

- [ ] **Step 1: test đỏ:** mỗi luật trên một `it` (hợp lệ qua, vi phạm 400 nêu lý do tiếng Việt); `addonPrice` = 0 hợp lệ, −1 bị DTO chặn; nhân viên pct 30 khi trần 20 → 403; nhân viên exposure vượt → 403; nhân viên sửa bộ của admin → 403; admin không bị trần; xoá bộ đã kết thúc hay đang chạy đều được (không có quota nên không ràng buộc đơn); ma trận quyền có 5 dòng `/admin/bundles` = [MARKETING].
- [ ] **Step 2:** FAIL. **Step 3: implement** (ghi bộ + món trong một `$transaction`; `createdById` = người tạo). **Step 4:** PASS. **Step 5: Commit** `feat(api): quản trị bundle (CRUD, trần nhân viên)`.

### Task 7: app-core: kiểu, hàm gọi, logic hiển thị, chữ

**Files:** Create `packages/app-core/src/api/bundle.ts`, `queries/bundle.ts`, `commerce/bundle-view.ts` + `.spec.ts`; Modify `shop-copy.ts`, `shop-copy-budget.ts`.

**Interfaces — Produces:**
```ts
// api/bundle.ts: BundleKind, BundleItemDTO, BundleDTO, ProductBundles (như Task 5)
export const fetchProductBundles: (http: HttpClient, slug: string) => Promise<ProductBundles>;
export const fetchHomeCombos: (http: HttpClient, limit?: number) => Promise<BundleDTO[]>;
// queries/bundle.ts: bundleKeys, productBundlesQuery(http, slug), homeCombosQuery(http)
// commerce/bundle-view.ts
export const PDP_COMBO_MAX = 2; export const PDP_ADDON_MAX = 3;
export function bundleLive(b: Pick<BundleDTO, 'endAt'>, now: number): boolean;
export interface ComboView { id: string; title: string; pct: number; items: ProductCardView[]; lines: { variationId: string; quantity: number }[]; total: number; comboTotal: number }
export function comboView(b: BundleDTO, now: number): ComboView | null;      // null khi hết hạn / <2 món
export interface AddonRow { key: string; bundleId: string; productId: string; variationId: string; name: string; thumbnail: string | null; listPrice: number; addonPrice: number; savingPct: number; maxQty: number }
export function addonRows(bundles: BundleDTO[], now: number, max?: number): AddonRow[]; // bỏ món hết hàng, bỏ món addonPrice ≥ listPrice
export function addonSummary(rows: AddonRow[], picked: ReadonlySet<string>): { count: number; pay: number; save: number };
```
Khoá chữ mới (đủ cả hai file): `combo.pdpTitle` 'Combo ưu đãi', `addon.title` 'Mua kèm deal sốc', `addon.price` 'Giá mua kèm {price}', `addon.condition` 'Chỉ khi mua cùng {name}', `addon.add` 'Thêm {n} món vào giỏ', `addon.added` 'Đã thêm vào giỏ', `addon.pickSpoken` 'Chọn mua kèm {name}, {price}, giảm {pct}%', `addon.error`, `combo.homeTitle`.

- [ ] **Step 1: test đỏ** (`bundle-view.spec.ts`): `comboView` tính `total`/`comboTotal` bằng `comboTotals` (floor từng món) và `lines` đủ món `quantity 1`; hết hạn (`endAt <= now`) → null; một món → null; `addonRows` cắt `max`, bỏ `addonPrice ≥ listPrice`, bỏ `inStock=false`, `savingPct` làm tròn; `addonSummary` cộng đúng `pay`/`save` của các dòng đã chọn, rỗng → 0. `shop-copy.spec.ts` bắt thiếu khoá/độ dài.
- [ ] **Step 2:** `cd packages/app-core && npx vitest run src/commerce/bundle-view.spec.ts src/shop-copy.spec.ts` → FAIL. **Step 3:** implement. **Step 4:** PASS + `entry-imports.spec.ts` xanh. **Step 5: Commit** `feat(app-core): API và logic hiển thị combo, mua kèm toàn sàn`.

### Task 8: Mini App: PDP + Trang chủ

**Files:** Create `apps/miniapp/src/components/product/pdp-bundles.tsx` (+ spec); Modify `components/home/home-combos.tsx` (+ `home-banner.spec.tsx` ca "chờ P15"), `pages/product-detail.tsx` (thay `<PdpBundleSlots />` ở dòng ~761 bằng `<PdpBundles slug=… />`), `pages/home.tsx`, `components/home/use-home-shelves.ts`.

**Interfaces — Consumes:** Task 7; `ComboCard` (`ui/combo-card.tsx`), `addAllToCart` (`services/cart-batch.ts`, nguồn `ctv_sheet` đã có), `useNotify`, `Section`/`SectionHeader`. **Produces:** `PdpBundles({ slug }: { slug: string })`: ẩn hẳn (null) khi không có combo lẫn mua kèm hoặc API lỗi; combo: ≤2 `ComboCard` ("Thêm cả combo" gọi `addAllToCart(view.lines)`, thành công `invalidateQueries(['cart'])` + notify `shop.comboAdded`); mua kèm: ≤3 dòng `role=checkbox` (tên đọc `addon.pickSpoken`, vùng chạm 44px), nút "Thêm n món vào giỏ" gọi `addAllToCart` với món đã chọn (không gồm món chính; khách tự thêm món chính bằng nút mua của trang), đổi "Đã thêm vào giỏ" 1,2s. `HomeCombos()` lấy `homeCombosQuery`, vẽ rail `ComboCard` (chống trùng id = id bộ); `useHomeShelves` đưa bộ vào `composeHomeShelves({ combos })`.

- [ ] **Step 1: test đỏ:** `pdp-bundles.spec.tsx`: không bộ → container rỗng; có combo → `ComboCard` với `total/comboTotal` của `comboView`, bấm "Thêm cả combo" gọi `addAllToCart` đúng `lines`, lỗi → notify lỗi và giỏ không đổi; mua kèm → checkbox chọn/bỏ cập nhật "Thêm n món" và "Tiết kiệm", bấm gọi batch đúng món; bộ hết hạn (theo `serverNow`) bị ẩn. `home-banner.spec` ca combo: không bộ → rỗng; có 2 bộ → rail hiện 2 thẻ.
- [ ] **Step 2:** `cd apps/miniapp && npx vitest run src/components/product/pdp-bundles.spec.tsx src/components/home/home-banner.spec.tsx` → FAIL. **Step 3:** implement. **Step 4:** PASS, cộng `npx vitest run src/pages/product-detail*.spec.tsx src/pages/home*.spec.tsx src/components/product`. **Step 5: Commit** `feat(miniapp): Combo ưu đãi, Mua kèm deal sốc ở PDP và khối combo Trang chủ`.

### Task 9: Web: PDP + Trang chủ

**Files:** Create `apps/web/src/app/san-pham/[slug]/pdp-bundles.tsx` (+ spec); Modify `page.tsx` (một dòng `orUndefined(fetchProductBundles(http, slug))` song song với `related`, truyền `initial` xuống, thay `<PdpBundleSlots />`), `components/home/home-combos.tsx` (tạo), `home-view.tsx` (`combos: null` → `<HomeCombos />`), `use-home-shelves.ts`.

**Interfaces — Consumes:** Task 7; `ComboCard` (web), `addCartItemsBatch`. Dữ liệu server làm `initialData` (`staleTime: 60_000`) nên HTML đã có khối, không chèn sau khi tải; client lọc bộ hết hạn theo giờ sau hydrate.

- [ ] **Step 1: test đỏ:** `pdp-bundles.spec.tsx` (cùng ca với Mini, gồm: không bộ → không DOM; `initial` có bộ → render ngay không chờ fetch). `page.spec.tsx`: ca 'chưa có Combo/Mua kèm (P15 điền)' đổi thành "API bundles trả rỗng/lỗi → không khối giữ chỗ" và thêm ca có bộ → thấy "Combo ưu đãi".
- [ ] **Step 2:** `cd apps/web && npx vitest run 'src/app/san-pham/[slug]'` → FAIL. **Step 3:** implement. **Step 4:** PASS. **Step 5: Commit** `feat(web): Combo ưu đãi, Mua kèm deal sốc ở PDP và khối combo Trang chủ`.

### Task 10: Admin web "Combo và mua kèm"

**Files:** Create `apps/web/src/lib/admin-bundles-client.ts`, `components/admin/bundles-tab.tsx`, `bundle-form.tsx` + spec; Modify `app/admin/page.tsx` (Tab `'bundles'`, mục "Combo và mua kèm" sau "Chiến dịch" trong nhóm "Khuyến mãi và điểm", `MARKETING` thêm `'bundles'`, `{active === 'bundles' && <BundlesTab />}`).

**Interfaces — Produces:** client `listAdminBundles(status?)`, `getAdminBundle(id)`, `createAdminBundle(body)`, `updateAdminBundle(id, patch)`, `deleteAdminBundle(id)`. Form: loại (Mua đủ bộ giảm % / Mua kèm giá riêng), tiêu đề, % hoặc sản phẩm chính, chọn món (bộ chọn sản phẩm theo mẫu `campaign-form.tsx`), giá kèm từng món, "Số đơn vị tối đa mỗi đơn", giờ bắt đầu/kết thúc nhập theo giờ VN qua `vnLocalToIso` (P11, `lib/admin-campaign-form.ts`). Nhân viên thấy chữ trần ("Nhân viên giảm tối đa …").

- [ ] **Step 1: test đỏ:** danh sách hiện trạng thái (Đang chạy/Sắp chạy/Đã kết thúc/Đang tắt), bật/tắt gọi `updateAdminBundle`, xoá hỏi xác nhận; form BUNDLE_PCT đòi ≥2 món và `%`, ADDON đòi sản phẩm chính + giá kèm ≥0; ô giờ gửi ISO `+07:00` bất kể múi giờ máy; lỗi 403 trần nhân viên hiện nguyên lời API; `admin-all-tabs`/spec nav có mục mới và `STAFF_TABS.MARKETING`.
- [ ] **Step 2:** `npx vitest run src/components/admin/bundles-tab.spec.tsx src/app/admin` → FAIL. **Step 3:** implement. **Step 4:** PASS. **Step 5: Commit** `feat(web): admin Combo và mua kèm`.

### Task 11: e2e Mini + chụp 375px + gate

**Files:** Create `apps/e2e/tests/bundles.miniapp.spec.ts`, `apps/e2e/tests/support/bundle-mocks.ts`; Modify `support/mock-api.ts` (thêm `api.fallback('GET', '/bundles/combos', [])` và `/products/:slug/bundles` rỗng nếu mock yêu cầu); `docs/2026-10-31-shop-redesign/PROGRESS.md` (một dòng).

- [ ] **Step 1: test đỏ:** e2e Mini 375px: PDP có 1 combo + 2 món kèm: thấy "Combo ưu đãi" và "Mua kèm deal sốc", "Thêm cả combo" gửi đúng `POST /cart/items/batch`, chọn món kèm đổi nút; PDP không bộ → không có `pdp-bundle-slots`, vị trí các khối dưới không đổi; Trang chủ có 2 combo → khối "Combo tiết kiệm" dưới Bán chạy nhất; CLS PDP và Trang chủ ≤ ngưỡng sẵn có.
- [ ] **Step 2:** chạy riêng spec mới → FAIL; sau Task 8 → PASS.
- [ ] **Step 3:** chụp 375px Mini (Vite 3327) và web (Next 3328) PDP có combo/mua kèm, Trang chủ, admin tab; lưu `docs/2026-10-31-shop-redesign/screens/P15/`; so hai bản; sửa lệch.
- [ ] **Step 4:** gate đầy đủ một lần: `bash docs/2026-10-28-review/tools/gate.sh <worktree> --base d768f7d42 --out …/gate-P15.txt`; race `bundle-price-parity` + các race spec đụng combo/checkout (`cart-combo-equals-quote`, `coupon-preview-equals-quote`, `split-checkout`, `storefront-moderation`, `buyer-totals-regression`, `partner-goods-rules`); e2e Mini toàn bộ (`E2E_SCOPE=miniapp E2E_MINIAPP_PORT=3327 npx playwright test --workers=2 --reporter=line`); `pg-native.sh stop 25548`.
- [ ] **Step 5: Commit** `test(e2e): bundles Mini, tiến độ P15`.

---

## Self-review

- **Spec coverage:** Q15 (Tubu tài trợ, hoa hồng `paidTotal`, hoàn `paidTotal`, một đơn một mã) → "Kết luận" + Task 4 ca 7; mỗi dòng max → Task 2, 3, 4 ca 3; `addonPrice ≥ 0` → Task 1 CHECK, Task 2, 6; trần nhân viên → Task 6; hết hạn giờ VN → Task 3 (ranh giới), 4 ca 5, 10 (`vnLocalToIso`); race `bundle-price-parity` → Task 4; loại hàng đối tác → Task 2/3/5/6; migration tên đúng → Task 1; CLS → Task 9 (server initialData), 8/11 (khối dưới màn đầu, e2e CLS); admin cạnh "Chiến dịch" → Task 10.
- **Chữ ký nhất quán:** `LiveBundle`/`BundleLine`/`BundleDiscount` (Task 2) dùng nguyên ở Task 3; `BundleDTO`/`BundleItemDTO` (Task 5) = Task 7; `ComboView.lines` = đầu vào `addAllToCart` (Task 8).
- **Ngoài phạm vi (ghi notes):** `bundleHints` trong giỏ ("Thêm 1 món nữa để giảm 10%") chưa làm; quota toàn cục cho ADDON và ngân sách ngày của nhân viên không áp được vì bộ không có quota.

## Sửa theo review vòng 1

| Mức | Phát hiện | Sửa | Test |
|---|---|---|---|
| BLOCKER | ADDON không ghim phân loại: giá kèm cố định áp mọi phân loại, 1.000.000đ bán 78.000đ | ADDON đòi `variationId` (DTO/`normalizeBundleContent`, form admin chọn theo phân loại); `addonBundle` bỏ món không ghim; công khai bỏ món không ghim | `bundle-rules.spec`, `bundle-admin-rules.spec`, `bundles-admin.service.spec`, `bundles.service.spec`, race `bundle-price-parity` (ghi tay không ghim, phân loại 50k/500k), race `bundles-admin` |
| MAJOR | Trần nhân viên tính trên phân loại rẻ nhất | `resolveBundleItems` trả `{ price, maxPrice }`; `assertStaffBundleCaps`/`bundleExposure` dùng `maxPrice` | `bundle-admin-rules.spec` (50k/500k → 403), `bundles-admin.service.spec` |
| MAJOR | PDP/Trang chủ quảng cáo bộ mà giỏ không giảm vì Giờ vàng | `loadFlashFootprint` + `BundlesService.build` ẩn bộ/món dính Giờ vàng | `bundles.service.spec` (6 ca), race `bundle-price-parity` (ADDON anchor Giờ vàng, combo có món Giờ vàng: công khai ẩn = giỏ không giảm; hết Giờ vàng thì cả hai cùng giảm) |
| MINOR | `initialData` ISR coi là tươi 30 giây dù cũ 5 phút | `page.tsx` truyền `initialFetchedAt`; `PdpBundles` đặt `initialDataUpdatedAt` | `pdp-bundles.spec` (web) |
| MINOR | Thứ tự khối ở 375px khác Mini | Web: Combo/Mua kèm đứng trước khối mua (`max-md:order-2`), khối mua `order-3`, Mở nhóm mua chung `order-4`; máy tính giữ thứ tự HTML | ảnh `web-pdp-*.png` chụp trước khi đổi thứ tự, chưa chụp lại (máy tải nặng): gói sau hoặc UAT chụp lại ở 375px |
| MINOR | Gợi ý admin lộ khoá cấu hình `bundle.max_pct` | Viết lại bằng chữ thường ngày | `bundles-tab.spec` |
| MINOR | Chống trùng Trang chủ và ngân sách chữ chưa ghi | Ghi vào "Kết luận kiểm luật" ở trên (lệch §5 có lý do, nguồn ngân sách chữ) | không |

## Sửa theo review vòng 2

| Mức | Phát hiện | Sửa | Test |
|---|---|---|---|
| MAJOR | Web PDP: máy chủ và trình duyệt lọc hết hạn theo hai đồng hồ khác nhau; trang ISR cũ hàng giờ thì lần vẽ đầu của trình duyệt lệch HTML ("Hydration failed") và khối biến mất | Trước hydrate (`useHydrated()` false) `PdpBundles` dùng giờ lúc máy chủ lấy dữ liệu (`initialFetchedAt`), đúng giờ máy chủ đã dùng khi dựng HTML; chỉ sau hydrate mới lọc theo `serverNow()` | `pdp-bundles.spec.tsx` (web): lần vẽ đầu ở giờ khách mở trang (hết hạn, lệch ±4 phút) = HTML đã dựng, `hydrateRoot` không lỗi, sau hydrate bộ quá hạn rời trang. Đỏ khi bỏ cờ `hydrated` |
| MAJOR | Khối Combo/Mua kèm đứng TRÊN khối mua ở điện thoại: bộ vừa tắt/hết hạn (dữ liệu ISR cũ, tải lại sau 30 giây) bị gỡ giữa trang, nút "Thêm vào giỏ" và mọi thứ bên dưới nhảy lên | Chọn cách "giữ khối trong lúc khách còn ở trang" thay vì dời khối xuống dưới khối mua (dời không đủ: đo trên khung 430×932 và 375×1100, gỡ khối vẫn đẩy phần bên dưới đang nằm trong màn hình, CLS 0,1554 và 0,2227, ngang với khi khối ở trên). `PdpBundles` giữ danh sách cuối cùng đã hiện cho từng phía (Combo, Mua kèm): bộ hết hạn/tắt thì khối ở nguyên chỗ, mờ đi, `inert` (không bấm, không Tab), tiêu đề ghi "Đã kết thúc" (khoá `bundle.ended`); bộ mới về sau thì hiện lại bình thường. Thứ tự khối ở điện thoại GIỮ như Mini App (Combo/Mua kèm, Số lượng, Mở nhóm mua chung). Chỉ còn một cú chèn: bộ hiện sau khi tải (máy chủ lỗi lúc dựng, hay bộ vừa tạo sau lần dựng trang), như Mini App | `pdp-bundles.spec.tsx` (dữ liệu cũ + tải lại rỗng giữ khối "Đã kết thúc", `inert`, nút không thêm được; chỉ một phía hết; bộ mới hiện lại), `page.spec.tsx` (thứ tự `order`). Đo CLS web PDP (Next dev, chromium, 375×812): sản phẩm Giờ vàng có bộ 0,0715 (không có bộ 0,0715 đến 0,0771: cú nhảy là thanh Giờ vàng của P12, không phải khối bộ); trang ISR cũ 10 phút + tải lại rỗng, sản phẩm không Giờ vàng: 0,0000 đến 0,0074 ở 375×812, 430×932, 375×1100 (trước khi giữ khối: 0,1554 đến 0,2227). Ảnh 375px chụp lại: `screens/P15/web-pdp-combo.png`, `web-pdp-addon.png`, `web-pdp-ended.png` |
| MINOR | `forProduct` vẫn trả Mua kèm khi sản phẩm chính hết hàng: khách thêm món kèm, món chính không vào giỏ được, giỏ tính giá thường | `forProduct` đọc phân loại đang bán còn tồn của sản phẩm chính (cùng điều kiện `inStock` của thẻ); hết thì bỏ ADDON, giữ combo (thẻ báo "tạm hết" theo món) | `bundles.service.spec.ts` (2 ca), race `bundle-price-parity` (hết hàng, tắt phân loại, còn hàng lại: ẩn rồi hiện) |
| MINOR | Ô chọn Mua kèm của web là ô vuông gốc của trình duyệt, Mini là ô bo góc xanh (ảnh `web-pdp-addon.png` đã chụp lại, khớp `mini-pdp-addon.png`) | Dùng `miniCheckbox` + `miniCheckboxWrap` + `CheckMark` (`order-mobile/mobile-ui.tsx`, cùng bộ giỏ hàng/thanh toán); từ md giữ ô gốc | `pdp-bundles.spec.tsx` (vùng chạm 44px, tên đọc được) |
| MINOR | Nhân viên tạo bundle rồi tự mua hưởng giảm (mã giảm giá và Giờ vàng đã chặn: `isOwnStaffCoupon`, `ownSalesBlocked`) | KHÔNG sửa, chờ chủ quyết (xem "Chờ chủ quyết") | không |
| MINOR | ADDON không có trần lúc tính tiền: giá phân loại ghim đổi lên sau khi tạo bộ thì khoản giảm mỗi đơn vị phình theo | KHÔNG sửa, ghi rủi ro đã biết (xem dưới) | không |
| MINOR | Chống trùng Trang chủ lệch §5 chưa được chủ duyệt | Ghi thành việc cho gói sau + chờ chủ (xem dưới, PROGRESS) | không |

### Chờ chủ quyết / rủi ro đã biết

1. **Nhân viên tự hưởng bundle do mình tạo.** Mã giảm giá chặn (`coupons.service.ts` `isOwnStaffCoupon`) và Giờ vàng chặn (`flash-sale.service.ts` `ownSalesBlocked`); bundle chưa. Trần nhân viên chỉ giới hạn khoản giảm MỖI ĐƠN, không giới hạn số đơn: nhân viên MARKETING tạo ADDON hay BUNDLE_PCT trong trần, rồi tự đặt nhiều đơn. Bundle không quota toàn cục, nên đây là hở thật. Cách sửa nếu chủ muốn giống hai luật kia: `Bundle.createdById` đã có sẵn trong bảng, đưa vào `LiveBundle`, và `computeForStorefront` bỏ bộ có `createdById === buyerId` khi người mua không phải ADMIN. Cần chữ ký `computeForStorefront` nhận thêm `buyerId` (14 spec và race spec đang mock tên này), và API công khai vẫn quảng cáo bộ đó cho chính nhân viên (cache chung, giỏ chỉ giảm ít hơn quảng cáo). Chưa làm vì đụng đường tiền và cần chủ chọn: áp luật giống mã giảm giá, hay chấp nhận vì nhân viên tin cậy.
2. **ADDON không có trần lúc tính tiền (giá phân loại đổi sau khi tạo).** `resolveBundleItems` chỉ so giá kèm với giá phân loại ghim LÚC TẠO (và trần nhân viên tính lúc đó). Lúc tính tiền khoản giảm là `giá hiện tại − giá kèm` không trần: ADDON ghim phân loại 50.000đ, giá kèm 39.000đ (giảm 22%, trong trần), về sau phân loại đổi giá thành 500.000đ (sửa tay hay đồng bộ Pancake) thì mỗi đơn vị giảm 461.000đ × `maxQty`, và không kiểm lại trần nhân viên hay %. `maxPct` không dùng được vì giá kèm 0đ (tặng kèm) hợp lệ. Hướng sửa khi cần: lưu giá tham chiếu lúc tạo (cột mới `BundleItem.refPrice`) và bỏ giảm khi giá hiện tại vượt giá tham chiếu quá một tỉ lệ. Chưa làm vì cần cột mới và quyết tỉ lệ; giảm rủi ro hiện nay bằng `maxQty` ≤ 10 và việc bộ do nhân viên/ADMIN tạo thủ công, có hạn.
3. **Chống trùng Trang chủ lệch §5** (combo không lấy món của Bán chạy nhất): đã ghi ở "Kết luận kiểm luật" với lý do. Việc cho gói sau: đưa combo vào yêu cầu `/home` gộp ở máy chủ (ISR) rồi mới xếp Giờ vàng > Mua lại > Combo > Bán chạy đúng §5. Chủ chưa duyệt chỗ lệch này; chờ chủ ký ở PROGRESS.
