# P9 `shop-page` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dựng lại trang shop công khai (gian hàng CTV `/s/:slug`, thương hiệu `/brand/:slug`) ở Mini App và web: đầu shop kiểu cửa hàng, tab Shop | Sản phẩm | Danh mục (+ Câu chuyện), khối vẽ theo `layout`, combo có "Thêm cả combo".

**Architecture:** Logic mới (tab, sắp xếp, trần 6 khối, tổng combo, số liệu shop, ẩn bậc thấp nhất, trang số) ở `packages/app-core/src/commerce/shop-page.ts`; hai app chỉ vẽ cùng tên thành phần `ShopHeader`, `ShopStatsRow`, `ShopTopBar`, `ShopSection` (Mini `components/ui/`, web `components/mini/`). Trang server của web không truyền được prop hàm xuống client, nên thân trang (tab, khối, tab Sản phẩm) là một client component nhận dữ liệu thuần; khung lg là `StoreLayout`.

**Tech Stack:** TypeScript, React 18, zmp-ui + Vite (Mini), Next 15 + Tailwind (web), vitest, Playwright (mock-api cho Mini).

**Spec:** `docs/2026-10-31-shop-redesign/01-thiet-ke.md` (§4 là luật; §5 "Khung trang shop"); `02-ke-hoach.md` mục P9 + "Giao diện dùng chung"; nguồn `review/critique-store.md` (4.1, 4.3, sơ đồ 3.1, 3.1b, ST-01..ST-09, BR-01..BR-05), `review/ia-merch.md` C4, `review/web.md` D-06/D-07, `review/backend-gap.md` §4. Bàn giao: `handoff-wave1.md`, `handoff-wave2.md`.

## Global Constraints

- Node: `export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH`; worktree mới: `pnpm --filter @tubutree/shared-types build` và `npx prisma generate` (trong `apps/api`) trước gate.
- Chữ tiếng Việt: "Thương hiệu" (không "Nhãn hàng"), "Mã giảm giá", "Miễn phí giao hàng", "Tạm hết hàng"; không "Top", "Freeship", "voucher", "cửa hàng". Chữ mới vào `SHOP_COPY` **và** `SHOP_COPY_MAX` (spec bắt thiếu một bên).
- Giá giảm `--color-text-price-deal`; giá thường đen; không đỏ. Tiêu đề khối Inter 16/700; Fraunces chỉ tiêu đề trang (tên shop) và số ≥22px.
- Bề rộng thẻ kệ chỉ `--tile-w-sm`/`--tile-w-md`; vùng chạm ≥44px; axe 0 vi phạm ở 375px.
- Thẻ sản phẩm chỉ qua `ProductCard`/`ProductGrid`/`ProductRail`; giá gạch chỉ ở `price-tag.tsx` (`ds-shop-guard.spec` chặn).
- Trần khối: `SHOP_MAX_SECTIONS = 6` (§4 Q12); ngân sách món `SECTION_BUDGET`; ẩn bậc CTV thấp nhất (§4 Q9) qua `ownerTier.publicBadge`.
- Chunk vào Mini ≤700 KB (hiện 682): hai trang shop là route lười, không import `SHOP_COPY` vào đường nạp gói đầu; ghi số trước/sau.
- Mini zmp-ui: không `getByRole('dialog')` stub bằng `role="dialog"`; thông báo qua `useNotify`; không `openSnackbar` trực tiếp.
- Không sửa file gói song song (P6/P7/P8); `route-map.json`, `shop-copy.ts`, `vi.ts` là file gộp tay. Không push, không PROD, không `git stash` trần.
- Comment chỉ nói "vì sao" không hiển nhiên (tiếng Việt).

## Review Focus

1. Khách chưa đăng nhập mở `/s/:slug`, `/brand/:slug`: thấy đủ nội dung, không 401; Theo dõi / Thêm cả combo cần tài khoản thì báo rõ hoặc mở cổng đăng nhập. Test: e2e Mini guest `/s/:slug` (Task 8) + web e2e `/s/uatctv` (Task 12).
2. "Thêm cả combo" lỗi (một món hết hàng, mạng): báo lỗi bằng chữ, giỏ không đổi, nút mở lại được, không gọi hai lần khi bấm đúp. Test: `shop-section.spec` (Task 5).
3. Combo thiếu món/hết hàng/% = 0/`pct` không số; bộ rỗng; >6 khối; shop không có món nào; `ownerTier` null. Test: `shop-page.spec` (Task 1) + `shop-section.spec`.
4. Tên shop/tên SP tiếng Việt dài có dấu, avatar/bìa thiếu hoặc URL lạ: header không tràn 375px, tên cắt 2 dòng. Test: `shop-header.spec` (Task 3).
5. API cũ chưa trả `productCount`/`publicBadge`/`children` (cache cũ): số "Sản phẩm (n)" rơi về đếm phía máy khách, bậc không hiện, không "NaN". Test: `shop-page.spec` (Task 1).

---

## File Structure

| File | Việc |
|---|---|
| `packages/app-core/src/commerce/shop-page.ts` (+spec) | logic dùng chung (Task 1) |
| `packages/app-core/src/shop-copy.ts`, `shop-copy-budget.ts` | chữ mới `shop.*`, `stats.followers*` |
| `packages/app-core/src/commerce/voucher.ts` | export `expiryText` (một dòng) |
| `packages/app-core/src/api/storefront.ts` | `StorefrontItem.product.repVariationId?`, `pinnedVariationId?` |
| `apps/miniapp/src/components/ui/{combo-card,shop-header,shop-stats-row,shop-top-bar,shop-section}.tsx` (+spec) | thành phần Mini |
| `apps/miniapp/src/components/shop-page/{shop-products-tab,shop-categories-tab}.tsx` (+spec) | tab Sản phẩm, Danh mục |
| `apps/miniapp/src/pages/{storefront-view,brand-view}.tsx` (+spec) | ghép trang; thay `StorePageShell` |
| `apps/miniapp/src/services/{storefront-api,brand-api,cart-batch}.ts` | kiểu `publicBadge`, `fetchBrandProducts`, `addAllToCart` |
| `apps/web/src/components/mini/{combo-card,shop-header,shop-stats-row,shop-top-bar,shop-section}.tsx` (+spec) + `index.ts` | thành phần web |
| `apps/web/src/components/layouts/store-layout.tsx` (+spec) | khuôn lg |
| `apps/web/src/components/shop-page/{storefront-body,brand-body,shop-products-tab,shop-pager}.tsx` (+spec) | thân trang client |
| `apps/web/src/app/{s,brand}/[slug]/page.tsx`, `apps/web/src/lib/api.ts` | trang server, kiểu |
| `apps/e2e/tests/shop-page.miniapp.spec.ts`, `apps/e2e/tests/shop.web.spec.ts` | e2e |

---

### Task 1: Logic dùng chung `commerce/shop-page.ts` + chữ

**Files:**
- Create: `packages/app-core/src/commerce/shop-page.ts`, `packages/app-core/src/commerce/shop-page.spec.ts`
- Modify: `packages/app-core/src/shop-copy.ts`, `shop-copy-budget.ts`, `commerce/voucher.ts` (export `expiryText`), `api/storefront.ts`

**Interfaces — Produces** (đúng tên, các task sau import):

```ts
export const SHOP_PAGE_SIZE = 20;
export type ShopTabKey = 'shop' | 'products' | 'categories' | 'story';
export interface ShopTab { key: ShopTabKey; label: string; count?: number }
export function shopTabs(i: { productCount: number; hasStory?: boolean; hasCategories?: boolean }): ShopTab[];   // Shop | Sản phẩm (n) | Danh mục (mặc định có; thương hiệu truyền false) (+ Câu chuyện)
export type ShopSort = 'popular' | 'newest' | 'best_seller_30d' | 'price_asc' | 'price_desc';
export const SHOP_SORT_OPTIONS: { value: string; label: string; spoken?: string }[];     // popular | newest | best_seller_30d | price
export function shopSortValue(s: ShopSort): string;                  // price_asc|price_desc → 'price'
export function nextShopSort(current: ShopSort, picked: string): ShopSort; // chọn 'price' khi đang price_asc → price_desc, ngược lại price_asc
export function shopSortToCatalog(s: ShopSort): CatalogSort | undefined;   // popular → undefined
export function sortShopProducts<T extends ShopProductLike>(items: readonly T[], s: ShopSort): T[]; // ổn định, không đổi mảng vào
export function uniqueShopProducts<P extends { id: string }>(collections: { items: { product: P }[] }[]): P[]; // bỏ trùng, giữ thứ tự khối
export function planShopSections<C extends { kind: string; items: { product: { id: string } }[] }>(collections: C[]): { main: C[]; extra: C[] };
export function comboTotals(prices: readonly number[], pct: number | null): { total: number; comboTotal: number; saving: number };
export function publicTier(t: { name: string; emoji: string; publicBadge?: boolean } | null | undefined): { name: string; emoji: string } | null;
export function storefrontStatsInput(collections: { items: { product: { id: string; ratingAvg?: number | null; reviewCount?: number | null; sold?: number | null } }[] }[]): { productCount: number; ratingAvg: number | null; sold: number | null };
export function brandStatsInput(b: { productCount?: number; products: { ratingAvg?: number | null; reviewCount?: number | null; sold?: number | null }[] }): { productCount: number; ratingAvg: number | null; sold: number | null };
export function followerStat(n: number | null | undefined): ShopStat | null;            // ShopStat từ commerce/shop-stats
export function promotionVoucher(p: { id: string; title: string; subtitle?: string | null; couponCode?: string | null; endAt: string }, now: number): VoucherView;
export function pageWindow(page: number, pages: number): (number | '…')[];              // 1 … 4 5 6 … 20; tối đa 7 phần tử
```

`ShopProductLike = { id: string; basePrice: number; salePrice?: number | null; sold?: number | null; createdAt?: string | null }`.

- [ ] **Step 1: Test đỏ `shop-page.spec.ts`** (mỗi dòng là một `it`):
  - `shopTabs({productCount:17})` → keys `['shop','products','categories']`, nhãn `Shop|Sản phẩm|Danh mục`, `count` 17 ở `products`; `hasStory:true` thêm `story` "Câu chuyện" cuối; `hasCategories:false` bỏ `categories`.
  - `nextShopSort('popular','price')==='price_asc'`; `('price_asc','price')==='price_desc'`; `('price_desc','price')==='price_asc'`; `('price_asc','newest')==='newest'`; `shopSortValue('price_desc')==='price'`; `shopSortToCatalog('popular')===undefined`, `('best_seller_30d')==='best_seller_30d'`.
  - `sortShopProducts`: `price_asc` theo `salePrice ?? basePrice`; `newest` theo `createdAt` giảm, thiếu `createdAt` xuống cuối; `popular` giữ nguyên thứ tự; `best_seller_30d` theo `sold` giảm; không đổi mảng vào.
  - `uniqueShopProducts` bỏ SP trùng giữa hai bộ, giữ thứ tự.
  - `planShopSections`: 8 bộ có món → `main.length 6`, `extra.length 2`; bộ 0 món bị bỏ; COMBO chỉ 1 SP khác nhau bị bỏ (cả `main` lẫn `extra`); mảng rỗng → cả hai rỗng.
  - `comboTotals([100000,50000], 10)` → `{total:150000, comboTotal:135000, saving:15000}`; `([33333,33333],10)` → saving `2*floor(3333.3)=6666` (sàn từng dòng như `allocateComboDiscounts`); `pct` null/NaN/≤0/>100 → saving 0 (kẹp 100 khi >100).
  - `publicTier({name:'Tân binh',emoji:'🌱',publicBadge:false})===null`; `publicBadge:true` → `{name,emoji}`; `publicBadge` thiếu (API cũ) → `null`; `null` → `null`.
  - `storefrontStatsInput`: `productCount` đếm SP khác nhau; `ratingAvg` trung bình có trọng số `reviewCount`, `null` khi tổng đánh giá <5; `sold` = tổng `sold` SP khác nhau, `null` khi 0/thiếu hết.
  - `brandStatsInput({productCount:40, products:[30 món]})` → `productCount 40`, `ratingAvg null`, `sold null` (danh sách cụt thì không khoe số bán/sao); `productCount` thiếu → `products.length` và tính sao/bán bình thường.
  - `followerStat(1200)` → `value '1.200'`, `spoken '1.200 người theo dõi'`; `0|null|NaN` → `null`.
  - `promotionVoucher`: `kind 'shop'`, `code` = `couponCode ?? ''`, `condition = subtitle ?? ''`, `state 'collectable'` khi có mã, `expiry` đọc bằng `expiryText`; `endAt` hỏng → `expiry ''`.
  - `pageWindow(1,5)` → `[1,2,3,4,5]`; `(10,20)` → `[1,'…',9,10,11,'…',20]`; `(1,20)` → `[1,2,3,'…',20]`; `(20,20)` → `[1,'…',18,19,20]`; `pages<=1` → `[1]`/`[]` khi 0.
  - `SHOP_COPY` có `shop.tabShop|tabProducts|tabCategories|tabStory|follow|following|vouchers|seeAllN|sortPopular|sortNew|sortSold|sortPrice|loadMore|emptyProducts|categoryCount|pagerLabel|comboError|comboAdded|loginForCombo`, `stats.followers`, `stats.followersSpoken`; `shop-copy.spec` xanh (ngân sách đủ).
- [ ] **Step 2:** `npx vitest run packages/app-core/src/commerce/shop-page.spec.ts` (từ `packages/app-core`) → FAIL (thiếu module).
- [ ] **Step 3:** Cài đặt `shop-page.ts` theo Interfaces; thêm khoá chữ vào `SHOP_COPY` + `SHOP_COPY_MAX`; export `expiryText` ở `voucher.ts`; thêm `repVariationId?: string; pinnedVariationId?: string` vào `StorefrontItem.product` (API đã trả qua `pinnedCardPrices`). Dùng `Math.floor(price*pct/100)` từng dòng.
- [ ] **Step 4:** `npx vitest run src/commerce src/shop-copy.spec.ts src/api/storefront.spec.ts src/route-map-parity.spec.ts` → PASS.
- [ ] **Step 5:** Commit `feat(app-core): logic trang shop (tab, sắp xếp, trần 6 khối, tổng combo, số liệu)`.

---

### Task 2: Kiểu dữ liệu hai app + gọi API

**Files:**
- Modify: `apps/miniapp/src/services/storefront-api.ts` (`ownerTier: { name; emoji; publicBadge: boolean } | null`; item.product thêm `repVariationId?`, `pinnedVariationId?`), `apps/miniapp/src/services/brand-api.ts` (`BrandView.productCount?`, hàm `fetchBrandProducts(slug, q)` bọc app-core qua `coreHttp`), `apps/web/src/lib/api.ts` (`StorefrontDetail.ownerTier.publicBadge`, item `repVariationId`, `BrandDetail.productCount?`), fixture `storefront-view.spec.tsx`, web `page.spec.tsx`, `storefront-page.spec.tsx`, `guest-pages.a11y.spec.tsx` (thêm `publicBadge` vào `ownerTier`).
- Create: `apps/miniapp/src/services/cart-batch.ts` — `addAllToCart(items: {variationId:string; quantity:number}[]): Promise<CartSummary>` = `addCartItemsBatch(coreHttp, items, 'ctv_sheet', cartStorefrontSlug())`; web `apps/web/src/lib/shop-combo.ts` cùng chữ ký bằng `coreHttp` + `cartStorefrontSlug()`; `apps/web/src/lib/shop-brand-products.ts`: `fetchBrandProductsPage(slug, q)`.

**Interfaces — Produces:** `fetchBrandProducts(slug: string, q: { page?: number; limit?: number; sort?: CatalogSort }): Promise<PageResponse<ProductCard>>` (Mini `services/brand-api.ts`; web `lib/shop-brand-products.ts` cùng tên), `addAllToCart` (như trên).

- [ ] **Step 1: Test đỏ** `cart-batch.spec.ts` (Mini): gọi `addAllToCart([{variationId:'v1',quantity:1}])` → `POST /cart/items/batch` body `{items:[…], addSource:'ctv_sheet'}` và gửi `storefrontSlug` khi có ngữ cảnh (mock `api.post`, mẫu `core-http.spec.ts`); `brand-api.spec.ts`: `fetchBrandProducts('fuwa',{page:2,limit:20,sort:'newest'})` gọi `GET /brand/public/fuwa/products` với `params {page:2,limit:20,sort:'newest'}`.
- [ ] **Step 2:** `npx vitest run src/services/cart-batch.spec.ts src/services/brand-api.spec.ts` (trong `apps/miniapp`) → FAIL.
- [ ] **Step 3:** Cài đặt; web chép cùng chữ ký (spec web `shop-combo.spec.ts`: cùng body). Sửa fixture `ownerTier` ở các spec đã nêu để `tsc` xanh.
- [ ] **Step 4:** `npx tsc -p apps/miniapp --noEmit`, `npx tsc -p apps/web --noEmit`, vitest các file trên → PASS.
- [ ] **Step 5:** Commit `feat(shop): kiểu publicBadge/productCount, gọi fetchBrandProducts và thêm giỏ hàng loạt ở hai app`.

---

### Task 3: ComboCard (việc mở từ đợt 2) + `ShopHeader`, `ShopStatsRow`, `ShopTopBar`

**Files:**
- Modify: `apps/miniapp/src/components/ui/combo-card.tsx` (+spec), `apps/web/src/components/mini/combo-card.tsx` (+spec)
- Create: Mini `components/ui/{shop-header,shop-stats-row,shop-top-bar}.tsx` (+spec mỗi file); web `components/mini/` cùng tên; export vào `apps/web/src/components/mini/index.ts`.

**Interfaces — Produces** (cùng props hai app):

```ts
export interface ShopHeaderProps {
  title: string;                       // h1, Fraunces, tối đa 2 dòng
  coverUrl?: string | null;            // thiếu → nền phẳng var(--color-bg-cover)
  avatarUrl?: string | null;           // thiếu → nền primary + icon Sprout (cùng một kiểu ở mọi khổ)
  verified?: boolean;                  // dấu tích góc avatar ("Đã được Tubu Tree duyệt")
  badges?: ReactNode;                  // hàng Badge dưới tên
  action?: ReactNode;                  // nút bên phải hàng tên: Theo dõi (thương hiệu)
  note?: string | null;                // headerNote/tagline, tối đa 2 dòng + "Xem thêm"
}
export function ShopHeader(p: ShopHeaderProps): JSX.Element;
export function ShopStatsRow(p: { stats: ShopStat[] }): JSX.Element | null;   // 1–4 cột, null khi rỗng; mỗi ô là một phần tử có aria-label = spoken
export function ShopTopBar(p: { title: string; threshold?: number }): JSX.Element;   // hiện tên shop (aria-hidden khi chưa cuộn) khi cuộn quá `threshold` (mặc định = chiều cao bìa − 56)
```

- [ ] **Step 1: Test đỏ.**
  - `combo-card.spec`: `saving>0` → `PriceTag` có tone deal (`data-tone="deal"` hoặc màu `var(--color-text-price-deal)` theo cách `price-tag.spec` kiểm); `soldOut` (một món `stock:'out'`) → **không** có nhãn "Combo -n%", **không** có dòng giá gạch `compareAt`, nút tên `Combo tạm hết: {title}` và `aria-disabled`, bấm không gọi `onAddAll`.
  - `shop-header.spec`: bìa không URL → `background` `var(--color-bg-cover)`; có URL có ngoặc kép → được mã hoá (không thoát `url()`); avatar fallback có icon, không chữ cái; `verified` → ảnh/biểu tượng có tên "Đã được Tubu Tree duyệt"; `action` render cạnh tên; tên 60 ký tự có dấu vẫn trong `h1` với `overflow:hidden` + line-clamp 2; `note` dài có nút "Xem thêm" (aria-expanded) mở hết chữ.
  - `shop-stats-row.spec`: `shopStats({productCount:17,ratingAvg:4.6,sold:31000})` → 3 ô "17 Sản phẩm", "4,6 Đánh giá", "31k+ Đã bán"; `aria-label` của ô = `spoken`; `stats=[]` → null; 1 ô vẫn render.
  - `shop-top-bar.spec`: ban đầu `aria-hidden="true"`/`opacity 0`; sau khi vùng cuộn trang (Mini: `.zaui-page` scrollTop; web: `window.scrollY`) vượt ngưỡng → hiện tên, `aria-hidden="false"`; cuộn lại về 0 → ẩn.
- [ ] **Step 2:** `npx vitest run src/components/ui/{combo-card,shop-header,shop-stats-row,shop-top-bar}.spec.tsx` → FAIL.
- [ ] **Step 3:** Cài đặt. `ComboCard`: `tone={saving>0 ? 'deal' : 'default'}` cho `PriceTag`; khi `soldOut` truyền `compareAt={undefined}`, ẩn badge, nút `aria-label={fillCopy('combo.soldOutSpoken',{title})}` ("Combo tạm hết: {title}") — thêm khoá ở `SHOP_COPY`+budget. `ShopHeader`: bìa cao 120px, avatar 56px đè mép bìa (viền 3px `--color-bg-surface`), hàng tên + `action`, kiểu y hệt hai app (inline style theo token, không `max-md:`). `ShopTopBar`: thanh cố định `top:0` cao `calc(var(--safe-top)+56px)`, tên căn giữa (chừa 56px trái cho nút lùi, 96px phải cho viên thuốc Zalo), `pointer-events:none`, `zIndex` thấp hơn nút lùi (Mini 199→thanh, nút 200: dùng 199); web `md:hidden`.
- [ ] **Step 4:** chạy lại các spec trên ở cả hai app → PASS; `ds-shop-guard.spec` hai app xanh.
- [ ] **Step 5:** Commit `feat(shop): ShopHeader, ShopStatsRow, ShopTopBar; ComboCard giá deal và trạng thái tạm hết`.

---

### Task 4: `ShopSection` (hai app)

**Files:**
- Create: Mini `components/ui/shop-section.tsx` (+spec); web `components/mini/shop-section.tsx` (+spec), export ở `mini/index.ts`.
- Modify: Mini `components/ui/product-grid.tsx` + `product-rail.tsx` và web bản tương ứng: thêm prop `noteOf?: (p: ProductCardData, index: number) => string | undefined` chuyển thành `ProductCard note` (ghi chú CTV nằm trong thẻ, không còn hộp xanh ngoài thẻ); giữ `renderAfter`.

**Interfaces — Produces** (P10 import đúng tên này làm xem trước):

```ts
export interface ShopSectionItem {
  id: string; note?: string | null; variationId?: string | null;
  product: ProductCard & { repVariationId?: string; pinnedVariationId?: string };
}
export interface ShopSectionProps {
  collection: { id: string; title: string; kind: string; layout: string; comboDiscountPct?: number | null; items: ShopSectionItem[] };
  showBrand?: boolean;                 // thương hiệu truyền false
  onSeeAll?: () => void;               // có thì khối bị cắt hiện "Tất cả (n)"
  preview?: boolean;                   // xem trước ở màn dựng: nút "Thêm cả combo" không ghi giỏ
}
export function ShopSection(p: ShopSectionProps): JSX.Element | null;
```

Hành vi: `collectionView(collection)` → `rail` = `ProductRail variant="rail-md"` (≤10), `grid` = `ProductGrid variant="grid"` (≤6), `line` = `ProductGrid` một cột? — dùng `ProductGrid variant="line"` (≤5); `combo` = `ComboCard` (`comboTotals` từ giá thẻ `salePrice ?? basePrice`, `onAddAll` gọi `addAllToCart`, món lấy `variationId ?? product.pinnedVariationId ?? product.repVariationId`; thiếu biến thể ở bất kỳ món nào hoặc `comboPct===null` → không gọi API, báo `shop.comboError`). `data-testid` `shop-rail|shop-grid|shop-line|shop-combo`. Tiêu đề bằng `SectionHeader` (`action` "Tất cả (n)" chỉ khi `hasMore && onSeeAll`; combo có `Badge` ở ComboCard). Bộ `<2` SP: không vẽ combo, rơi về `line`.

- [ ] **Step 1: Test đỏ `shop-section.spec`** (mock `addAllToCart`, `useNotify`):
  - 4 layout: CAROUSEL 14 món → 10 thẻ + nút "Tất cả (14)"; GRID 9 món → 6 thẻ; STACK 8 món → 5 dòng; COMBO 3 món `pct 10` → `ComboCard` (có nút "Thêm cả combo"), không lưới.
  - `onSeeAll` bấm được gọi một lần; không `onSeeAll` thì không nút.
  - "Thêm cả combo" thành công: `addAllToCart` gọi một lần với 3 `{variationId,quantity:1}`, giỏ cache `['cart']` bị làm mới, thông báo `shop.comboAdded`; bấm đúp nhanh chỉ gọi một lần.
  - Lỗi: `addAllToCart` reject → `notify` type error có chữ `shop.comboError` (hoặc message nghiệp vụ nếu `isBusinessMessage`), nút `loading=false` bấm lại được, `queryClient.setQueryData` không bị gọi (giỏ không đổi).
  - Thiếu `repVariationId` ở một món → không gọi `addAllToCart`, báo lỗi.
  - `preview` → bấm "Thêm cả combo" không gọi `addAllToCart`.
  - `note` của item hiện trong thẻ (`noteOf`), thẻ cùng hàng cùng chiều cao (không hộp ngoài thẻ).
  - Món `inStock:false` trong combo → ComboCard "Combo tạm hết", `addAllToCart` không gọi.
- [ ] **Step 2:** `npx vitest run src/components/ui/shop-section.spec.tsx` → FAIL.
- [ ] **Step 3:** Cài đặt; Mini dùng `useMutation` + `useNotify`, web `useMutation` + thông báo dòng chữ `role=status` cạnh khối (web chưa có `useNotify`; kiểm cách `add-to-cart.tsx` hiện `msg`), khách web chưa đăng nhập (`useAuthPhase()==='guest'`) → `router.push(loginHref(current))` thay vì gọi API.
- [ ] **Step 4:** spec hai app + `product-grid.spec`/`product-rail.spec` → PASS.
- [ ] **Step 5:** Commit `feat(shop): ShopSection vẽ theo layout, combo Thêm cả combo (tất cả hoặc không)`.

---

### Task 5: Mini — tab Sản phẩm, tab Danh mục, trang `storefront-view`

**Files:**
- Create: `apps/miniapp/src/components/shop-page/shop-products-tab.tsx`, `shop-categories-tab.tsx` (+spec)
- Modify: `apps/miniapp/src/pages/storefront-view.tsx` (+`storefront-view.spec.tsx`, `storefront-view-not-found.spec.tsx` nếu đụng)
- Delete: `apps/miniapp/src/components/store-page-shell.tsx` + `.spec.tsx` (chỉ còn hai trang này dùng; Task 6 gỡ nốt `brand-view`)

**Interfaces:**
- `ShopProductsTab` props: `{ source: { kind: 'local'; products: ProductCard[] } | { kind: 'brand'; slug: string }; showBrand?: boolean; initialSort?: ShopSort }`. `local` (CTV): `uniqueShopProducts` + `sortShopProducts` + cắt `SHOP_PAGE_SIZE` mỗi trang bằng nút "Xem thêm"; `brand`: `fetchBrandProducts(slug,{page,limit:SHOP_PAGE_SIZE,sort:shopSortToCatalog(sort)})` `useInfiniteQuery`, hiển thị `meta.total`. `SortBar sticky` với `SHOP_SORT_OPTIONS`, `nextShopSort`. Rỗng → `EmptyState` `shop.emptyProducts`.
- `ShopCategoriesTab` props: `{ collections: { id; title; items: { product: { thumbnail } }[] }[]; onOpen(collectionId: string): void }` — dòng: dải ≤4 ảnh 48px + tên + `shop.categoryCount` ("{n} món") + ›. Bấm → mở tab Sản phẩm (CTV lọc theo bộ: `onOpen` đặt `filterCollectionId`).
- Trang: khung `Page page-bleed` → `ShopTopBar` → `ShopHeader` (badges: Gian hàng mẫu, nhãn tin cậy, `publicTier(ownerTier)` qua `TierBadge`, Kho; `action` = nút "Chia sẻ" ghost cho chủ shop) → `ShopStatsRow(shopStats(storefrontStatsInput(collections)))` → ghi chú → `SegmentedTabs(shopTabs)` dính → tab Shop: `planShopSections(collections).main.map(ShopSection)` (khối đầu "Nổi bật" là bộ đầu), cuối trang giữ liên kết "Muốn có gian hàng như này? Tìm hiểu ›" dạng caption (ST-07) + "Xem thêm ở Tubu Tree". Bỏ `stickyBar` cho chủ (Chia sẻ lên đầu shop). Voucher shop: CTV chưa có API → ẩn.

- [ ] **Step 1: Test đỏ.**
  - `shop-products-tab.spec`: nguồn `local` 45 SP khác nhau → trang 1 có 20 thẻ + "Xem thêm", bấm → 40, bấm → 45 và hết nút; SP trùng giữa hai bộ chỉ một thẻ; chọn "Giá" hai lần đổi chiều tăng→giảm (thứ tự thẻ đổi); nguồn `brand` gọi `fetchBrandProducts` với `sort` đúng (`newest`) và hiển thị "Xem thêm" đến hết `meta.total`; rỗng → thông báo; lỗi API → `ErrorState` có "Thử lại".
  - `shop-categories-tab.spec`: mỗi bộ một dòng "n món", bấm gọi `onOpen(id)`.
  - `storefront-view.spec` (cập nhật): giữ ca ngữ cảnh ghi công/`referralCode`; thêm: tab mặc định "Shop" vẽ đúng layout từng bộ (`shop-rail|grid|line|combo`); 8 bộ → 6 khối ở tab Shop, bộ 7–8 chỉ ở tab Danh mục; `ownerTier.publicBadge=false` không hiện `TierBadge`, `true` hiện; không `StorePageShell`; tab "Sản phẩm (n)" đếm đúng và bấm "Tất cả (n)" của khối bị cắt chuyển sang tab Sản phẩm; guest (`auth user null`) vẫn thấy tất cả, không request cần phiên.
- [ ] **Step 2:** `npx vitest run src/components/shop-page src/pages/storefront-view` → FAIL.
- [ ] **Step 3:** Cài đặt; tab state cục bộ (`useState<ShopTabKey>`), `role="tabpanel"` có `aria-label`; xoá `StorePageShell` khi `brand-view` chưa xong thì giữ file tới Task 6 (xoá ở Task 6).
- [ ] **Step 4:** vitest các file trên + `ds-shop-guard.spec` → PASS; `npx tsc -p apps/miniapp --noEmit` xanh.
- [ ] **Step 5:** Commit `feat(miniapp): trang gian hàng CTV theo khung shop (tab, khối theo layout, thống kê)`.

---

### Task 6: Mini — trang thương hiệu `brand-view`

**Files:** Modify `apps/miniapp/src/pages/brand-view.tsx` (+`brand-view.spec.tsx`); Delete `store-page-shell.tsx` + spec (nếu chưa xoá).

Hành vi: `ShopHeader` (nút "Theo dõi"/"Đang theo dõi" ở `action`, `secondary` sm, icon Check; không còn thanh dính đáy); `ShopStatsRow([...shopStats(brandStatsInput(b)), followerStat(b.followerCount)])`; tagline làm `note`; khuyến mãi: `promotionVoucher` → `VoucherTicket variant="chip"` trong `ScrollRow`, nút chính "Sao chép" (chép mã + thông báo) — bỏ viền `themeColor`; tab Shop | Sản phẩm (n) | Danh mục? — thương hiệu không có bộ sưu tập, nên: **Shop** (chứng nhận, khuyến mãi, 3 dòng câu chuyện + "Đọc câu chuyện ›", `ProductRail rail-md` ≤10 "Sản phẩm nổi bật" từ `b.products`, đại lý), **Sản phẩm (n)** (`ShopProductsTab kind:'brand'`, `showBrand=false`), **Câu chuyện** (xuất xứ + bản đồ, câu chuyện, ảnh); không có tab Danh mục (không có bộ sưu tập) — truyền `hasCategories:false` cho `shopTabs`.

- [ ] **Step 1: Test đỏ** (`brand-view.spec`, cập nhật + thêm): tab thấy "Shop", "Sản phẩm (40)" khi `productCount:40` còn `products` 30 (không lấy 30); API cũ thiếu `productCount` → "Sản phẩm (n)" với n = `products.length`, không "NaN"; có tab "Câu chuyện" chỉ khi có story/origin/ảnh; "Theo dõi" ở đầu shop (không trong `sticky-bar`), bấm khi chưa đăng nhập báo "Cần đăng nhập…" (giữ ca cũ); khuyến mãi có mã → `VoucherTicket` chip, bấm "Sao chép" gọi `copyText` + notify; `ProductCard showBrand=false` (không in tên nhãn trong thẻ); không gọi `getBrandFollowState` khi chưa đăng nhập (giữ).
- [ ] **Step 2:** `npx vitest run src/pages/brand-view.spec.tsx` → FAIL.
- [ ] **Step 3:** Cài đặt theo mô tả; thêm khoá chữ cần (đã có ở Task 1: `shop.tabStory`, `shop.follow`, `shop.following`; thêm `shop.readStory` "Đọc câu chuyện" nếu thiếu — cập nhật cả budget).
- [ ] **Step 4:** vitest các file đụng + `tsc` → PASS.
- [ ] **Step 5:** Commit `feat(miniapp): trang thương hiệu theo khung shop (Theo dõi ở đầu, mã dạng chip, tab Sản phẩm phân trang thật)`.

---

### Task 7: Mini — e2e guest + giữ e2e pilot xanh

**Files:** Create `apps/e2e/tests/shop-page.miniapp.spec.ts` (+ mock trong `support/shop-page-mocks.ts`); sửa `design-system-pilot.miniapp.spec.ts`/`pilot-mocks.ts` chỉ khi hồi quy do thiết kế mới (ghi vào notes).

- [ ] **Step 1: Test** (Playwright, `E2E_SCOPE=miniapp`, 375×812, mock-api, **không** phiên): `/s/uatctv` có 45 SP khác nhau trong 3 bộ (CAROUSEL 14, GRID 9, COMBO 3 món `pct 10`) → (a) màn đầu thấy tên shop h1, hàng số liệu "Sản phẩm", đúng 4 loại `shop-rail|shop-grid|shop-combo`; (b) tab "Sản phẩm" → 20 thẻ, "Xem thêm" → 40, đổi SortBar "Mới" thấy thẻ đầu đổi; (c) không có request nào trả 401 (`api.callsTo` không có `/me/*` ngoài cho phép); (d) cuộn qua bìa → `ShopTopBar` hiện tên shop; (e) "Thêm cả combo" khi mock trả 400 `CART_BATCH_REJECTED` → thấy câu lỗi, `GET /cart` sau đó không đổi. Cộng `/brand/fuwa` tab Sản phẩm: `GET /brand/public/fuwa/products?page=2` được gọi sau "Xem thêm".
- [ ] **Step 2:** `cd apps/e2e && E2E_SCOPE=miniapp E2E_MINIAPP_PORT=3307 npx playwright test tests/shop-page.miniapp.spec.ts tests/design-system-pilot.miniapp.spec.ts --workers=1` → FAIL trước khi hoàn thiện, PASS sau.
- [ ] **Step 3:** Sửa mã/mock tới xanh. Commit `test(e2e): trang shop Mini App cho khách chưa đăng nhập`.

---

### Task 8: Web — thành phần `ShopHeader`, `ShopStatsRow`, `ShopTopBar`, `ShopSection`, ComboCard

Làm **trước Task 9**; cùng đặc tả Task 3–4, chép từ bản Mini (đầu file `// Nguồn: apps/miniapp/src/components/ui/<tên>.tsx`).

**Files:** Create/modify như bảng File Structure (web `components/mini/*` + `index.ts` + spec).

- [ ] **Step 1: Test đỏ:** các spec của Task 3 và Task 4 bản web (`combo-card.spec`, `shop-header.spec`, `shop-stats-row.spec`, `shop-top-bar.spec` dùng `window.scrollY` + `fireEvent.scroll`, `shop-section.spec`; thêm ca web: guest bấm "Thêm cả combo" → `router.push(loginHref(...))`, không gọi API; `ShopHeader` không `'use client'` (render được bằng `renderToString`); `ShopTopBar` có `md:hidden`).
- [ ] **Step 2:** `npx vitest run src/components/mini/shop-*.spec.tsx src/components/mini/combo-card.spec.tsx` (trong `apps/web`) → FAIL.
- [ ] **Step 3:** Cài đặt, token CSS qua `style` như các thành phần `mini/` khác (không `max-md:`).
- [ ] **Step 4:** PASS + `ds-shop-guard.spec` + `ds-v2-guest.spec`.
- [ ] **Step 5:** Commit `feat(web): ShopHeader, ShopStatsRow, ShopTopBar, ShopSection, ComboCard khớp Mini App`.

---

### Task 9: Web — `StoreLayout`, thân trang client, trang `/s/[slug]` và `/brand/[slug]`

**Files:**
- Create: `apps/web/src/components/layouts/store-layout.tsx` (+spec), `apps/web/src/components/shop-page/{shop-products-tab,shop-pager,storefront-body,brand-body}.tsx` (+spec)
- Modify: `apps/web/src/app/s/[slug]/page.tsx`, `apps/web/src/app/brand/[slug]/page.tsx`, `brand-actions.tsx` (chỉ phần Theo dõi/Chia sẻ đưa lên đầu shop; giữ dải share-to-earn), các spec `page.spec.tsx`, `storefront-page.spec.tsx`, `brand-actions.spec.tsx`.

**Interfaces — Produces:**

```ts
// layouts/store-layout.tsx — khuôn lg: bìa + đầu shop một hàng; dưới md trả nguyên con
export function StoreLayout(p: { header: ReactNode; stats?: ReactNode; tabs: ReactNode; children: ReactNode }): JSX.Element;
export function ShopPager(p: { page: number; pages: number; onChange(page: number): void; label?: string }): JSX.Element | null; // pageWindow, aria-current="page", nút ‹ ›
export function StorefrontBody(p: { storefront: StorefrontDetail; isPartner: boolean }): JSX.Element;   // client
export function BrandBody(p: { brand: BrandDetail }): JSX.Element;                                       // client
```

Hành vi: lg `StoreLayout` bìa tràn khung `max-w-frame` + thẻ đầu shop (avatar, tên, nút, số liệu) một hàng; lưới tab Sản phẩm 5 cột (`GRID_PRODUCTS`), `SortBar`, dưới lg "Xem thêm", từ lg `ShopPager` (phân trang số, đổi trang thay danh sách và cuộn lên đầu lưới); bỏ bìa gradient tối và avatar chữ cái; thanh "Chia sẻ" dính đáy của chủ ở lg chuyển lên hàng đầu shop (`StorefrontAction` giữ cho phone); `ShopTopBar` chỉ phone. Trang server giữ `generateMetadata`, `StorefrontTracker`, `StorefrontEmpty`, kho/hotline (khối thông tin shop tự giao), dải cam kết ở lg (`max-md:hidden`).

- [ ] **Step 1: Test đỏ.**
  - `store-layout.spec`: render `header/stats/tabs/children` theo thứ tự; lớp lg (`lg:`) có ở khung, dưới md không bọc thêm khung (con là phần tử trực tiếp).
  - `shop-pager.spec`: `pages=1` → null; `page=10,pages=20` có `…`; bấm số gọi `onChange`; số hiện tại `aria-current="page"` và không bấm được; ‹ ở trang 1 `aria-disabled`.
  - `shop-products-tab.spec` (web): nguồn local 45 SP → lg: 20 thẻ + pager 3 trang, bấm trang 2 → thẻ khác; phone: "Xem thêm" cộng dồn; nguồn brand gọi `fetchBrandProductsPage` với `page/sort`; `useMediaQuery` mock.
  - `page.spec`/`storefront-page.spec`/brand `page.spec`: giữ ca cũ còn đúng (metadata, `notFound`, tracker, kho/hotline chỉ gian hàng tự giao, OG); thêm: h1 tên shop, `ShopStatsRow` có "17 Sản phẩm", `ownerTier.publicBadge=false` không hiện "Tân binh", bìa không còn `linear-gradient`, avatar không chữ cái, 8 bộ → 6 khối ở tab Shop, `storefront-owner` "Chia sẻ" vẫn có; không `max-md:` mới trong 3 file (bánh cóc `ds-v2-guest.spec` không tăng).
- [ ] **Step 2:** `npx vitest run src/components/layouts src/components/shop-page "src/app/s" "src/app/brand"` (trong `apps/web`) → FAIL.
- [ ] **Step 3:** Cài đặt; trang server chỉ truyền dữ liệu thuần xuống `StorefrontBody`/`BrandBody` (không hàm); `useMediaQuery('(min-width: 1024px)')` sau mount (lần đầu theo phone để khớp HTML dựng sẵn).
- [ ] **Step 4:** PASS + `npx tsc -p apps/web --noEmit` + `pnpm lint:parity`.
- [ ] **Step 5:** Commit `feat(web): trang gian hàng và thương hiệu theo khung shop (StoreLayout, tab, phân trang số)`.

---

### Task 10: e2e web (CI) + chụp 375px hai app + gate

**Files:** Modify `apps/e2e/tests/shop.web.spec.ts` (thêm khối guest `/s/uatctv`: tab Sản phẩm có phân trang số ở 1280, nút "Xem thêm" ở 375; `getByRole('tab',{name:/^Sản phẩm/})`); ảnh ở `docs/2026-10-31-shop-redesign/screens/P9/` (gitignore).

- [ ] **Step 1:** Viết spec web theo mẫu `shop.web.spec.ts` (cần API thật, chạy ở CI; **không** chạy cục bộ — ghi "unverified cục bộ" vào notes).
- [ ] **Step 2:** Chụp 375px Mini (Vite dev 3307) và web (Next dev 3308) với fixture, ComboCard trạng thái tạm hết ở cả hai app, so hai bản; tắt server sau khi chụp. Đường dẫn ảnh vào notes.
- [ ] **Step 3:** e2e Mini đầy đủ: `cd apps/e2e && E2E_SCOPE=miniapp E2E_MINIAPP_PORT=3307 npx playwright test --workers=2 --reporter=line` (sau khi tắt server chụp).
- [ ] **Step 4:** Gate: `bash docs/2026-10-28-review/tools/gate.sh <worktree> --base 2e52b9be9 --out .../gate-P9.txt`; bước FAIL kiểm trên base xem có sẵn không.
- [ ] **Step 5:** Cập nhật `bundle` trước/sau (entry Mini) vào notes; commit `test(e2e): spec web trang shop; docs: bàn giao P9`.

---

## Self-Review

- Phủ spec P9: ShopHeader/ShopStatsRow/ShopTopBar/ShopSection (T3, T4, T8), tab (T1, T5, T6, T9), voucher chip (T6), combo + `addCartItemsBatch` (T2, T4), ẩn bậc (T1, T5), 6 khối (T1, T5, T9), `ProductCard showBrand=false`/`note` (T4, T6), việc mở đợt 2 ComboCard (T3), StoreLayout + phân trang số (T9), e2e guest + pilot (T7, T10).
- Lệch có chủ ý so với đề: tab Sản phẩm CTV **không** gọi `fetchCatalog` (API `/products?slugs=` chỉ nhận ≤20 slug, chưa có endpoint theo gian hàng ở P3a/P3b): dùng danh sách món đã có trong phản hồi `/storefront/public/:slug`, sắp xếp + phân trang phía máy khách; ghi vào notes. Thương hiệu không có bộ sưu tập nên không có tab Danh mục (`shopTabs` có `hasCategories`).
- Nhất quán kiểu: `ShopSort`, `ShopTab`, `ShopSectionProps`, `ShopHeaderProps`, `fetchBrandProducts`, `addAllToCart` dùng cùng tên ở T1–T9.
