# P6 `home` Implementation Plan

> **Cho agent làm:** BẮT BUỘC dùng superpowers:subagent-driven-development hoặc superpowers:executing-plans. Bước dùng checkbox `- [ ]`.

**Mục tiêu:** làm lại Trang chủ Mini App và web theo `01-thiet-ke.md` §5: header dính 56px, màn đầu có deal (Giờ vàng gọn), Mua lại 1 món = 1 dòng 88px, Danh mục lưới 2×5, Bán chạy nhất có hạng cho cả hai loại khách, Gợi ý hôm nay xoay theo ngày, kệ chống trùng qua `SHELVES`; web lg dùng `HubLayout` (lưới 12 cột).

**Kiến trúc:** thứ tự khối, ô lối tắt, số đo khung chờ, luật chống trùng, hạt giống ngày và chip gợi ý nằm ở `packages/app-core` (Mini và web chỉ vẽ). Khối vẽ bằng thành phần đợt 2 (`SectionHeader`, `Countdown`, `FlashSoldBar`, `ProductRail`/`ProductCard`, `BannerCarousel`). API thêm tham số `seed` (ngày VN `YYYYMMDD`) cho `/products` và `/products/for-you`. Web là bản chép của Mini ở `apps/web/src/components/home/*`, khác ở điều hướng và SSR.

**Tech stack:** React 18 + zmp-ui (Mini), Next 15 + Tailwind (web), NestJS/Prisma (seed), vitest, jest, Playwright.

**Spec:** `docs/2026-10-31-shop-redesign/01-thiet-ke.md` (§4 Q1–Q7, Q11, Q13, Q18, Q19 là luật; §5 mục "Trang chủ"); chữ ký ở `02-ke-hoach.md` ("Giao diện dùng chung" + mục P6). Nguồn: `review/critique-shop.md` 4.1 + sơ đồ A/B + CS-05/06, `review/ia-merch.md` C5 + D2, `review/polish.md` PL-05/12, `review/web.md` D-02 + §3. Bàn giao: `plans/handoff-wave1.md`, `plans/handoff-wave2.md`.

## Global Constraints

- Node: `export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH`. Worktree mới: `pnpm --filter @tubutree/shared-types build` và `cd apps/api && npx prisma generate` (đã chạy).
- Chữ: "Giờ vàng", "Bán chạy nhất", "Mã giảm giá", "Gợi ý hôm nay", "Xem tất cả"; không "Top", "Freeship", "Kho voucher", "Nhãn hàng"; không `...` (dùng `…`). Chữ mới vào `homeCopy` (`packages/app-core/src/home-copy.ts`) hoặc `SHOP_COPY` + `SHOP_COPY_MAX` (thiếu một bên là spec đỏ).
- Tiêu đề khối Inter 16/700 (qua `SectionHeader`); giá giảm `--color-text-price-deal`; không đỏ; đồng hồ HH:MM:SS chỉ ở đầu khối Giờ vàng (`Countdown mode="clock"`).
- Bề rộng thẻ kệ chỉ `--tile-w-sm` 128 hoặc `--tile-w-md` 148. Vùng chạm ≥44px (`tubu-hit-44`), axe 0 vi phạm, tương phản ≥4,5:1.
- Entry Mini ≤700 KB (trần mềm 690; đang 682): `node scripts/ci/bundle-budget.cjs apps/miniapp/www`; khối dưới màn đầu nạp lười kèm chiều cao giữ chỗ; ghi số trước/sau ở notes.
- Khung chờ Trang chủ không làm trang nhảy: e2e `buy-flow-4a.miniapp.spec.ts` 'Danh mục không xê dịch' (≤2px) xanh; mọi khối mới có chiều cao trong `HOME_SETTLING_HEIGHTS`.
- Khoảng cách giữa khối đặt ở vỏ khối `data-home-block` (`margin-top: var(--space-block)`), khối con không tự đặt đệm trên/dưới (CS-05).
- Không sửa file của P7/P8/P9 (Danh mục, PDP, giỏ, gian hàng, thương hiệu, `combo-card.tsx`). File gộp tay khi merge: `shop-copy.ts`, `shop-copy-budget.ts`, `route-map.json`, `vi.ts`.
- Comment chỉ giải thích "vì sao", tiếng Việt. Không `git stash` trần, không push, không PROD. Máy thiếu RAM: chạy vitest/jest theo file, gate đầy đủ đúng một lần ở cuối.

## Review Focus

1. Kệ dưới `minItems` hoặc API 404/500 (Giờ vàng, Bán chạy nhất, Mua lại): khối ẩn hoặc hiện khối lỗi `home-block-error`, không để tiêu đề trơ, không nhảy trang. Test: Task 3 (`composeHomeShelves` kệ rỗng), Task 10 (`home-blocks.spec` nguồn rỗng/lỗi).
2. Món vừa ở Giờ vàng vừa ở Bán chạy/Gợi ý/Mua lại: chỉ hiện ở kệ hạng cao nhất, kệ bị rút xuống dưới `minItems` thì ẩn và không chiếm món. Test: Task 3.
3. Giờ vàng hết giờ khi khách đang xem (đồng hồ về 0): khối chuyển sang suất kế tiếp hoặc ẩn, không hiện 00:00:00, thẻ về giá thường. Test: Task 7.
4. `seed` rác (không đủ 8 số, ngày không có thật) hoặc không truyền: API bỏ qua rác bằng 400 hoặc giữ thứ tự cũ; không truyền thì kết quả y như trước. Test: Task 4.
5. Khách cũ chưa biết số món Mua lại lúc mở (khung chờ): chiều cao khung chờ khớp 1 dòng 88px hoặc kệ nhiều món theo gợi ý nhớ lần trước, Danh mục không xê dịch. Test: Task 8 + e2e Task 12.

---

## File Structure

| File | Việc |
|---|---|
| `packages/app-core/src/home-layout.ts` (+ `.spec.ts`) | id khối `banner`/`combos`, thứ tự 3 loại khách, `HOME_HEADER_HEIGHT`, ô lối tắt cố định + "Tất cả", số đo khung chờ mới, gợi ý nhớ số món Mua lại (Task 1) |
| `packages/app-core/src/merch/home-shelves.ts` (+ spec) | `composeHomeShelves`, `seeAllHref` (Task 2) |
| `packages/app-core/src/merch/route-fallback.ts` (+ spec) | lối thay thế cho route đợt sau (`/flash-sale`, `/best-sellers`, `/vouchers`) (Task 2) |
| `packages/app-core/src/home-suggest.ts` (+ spec) | `vnDateSeed`, `suggestChips`, hằng số gợi ý; `api/catalog.ts` nhận `seed` (Task 3) |
| `apps/api/src/modules/catalog/{dto/product-query.dto.ts,dto/for-you-query.dto.ts,catalog-seed.ts,catalog.service.ts,catalog.controller.ts}` + spec | tham số `seed` (Task 4) |
| `apps/miniapp/src/components/home/*`, `pages/home.tsx`, `components/flash-sale.tsx`, `components/reorder/purchased-rail.tsx` | giao diện Mini (Task 5–11) |
| `apps/web/src/components/home/*`, `components/reorder/purchased-rail.tsx`, `components/layouts/hub-layout.tsx` | giao diện web + `HubLayout` (Task 13–16) |
| `apps/e2e/tests/{home-h,home-merged,buy-flow-4a,...}.miniapp.spec.ts`, `home-p6.miniapp.spec.ts` | sửa test theo thiết kế mới + test CLS/màn đầu (Task 12) |

Lệnh kiểm một file: Mini `cd apps/miniapp && npx vitest run <đường dẫn>`; web `cd apps/web && npx vitest run <đường dẫn>`; app-core `cd packages/app-core && npx vitest run <đường dẫn>`; API `cd apps/api && npx jest <đường dẫn>`.

---

### Task 1: app-core `home-layout`: thứ tự khối, lối tắt, số đo

**Files:** Modify `packages/app-core/src/home-layout.ts`, `home-layout.spec.ts`, `home-copy.ts`.

**Interfaces:**
- Produces: `HomeBlockId` thêm `'banner' | 'combos'`; thứ tự (`homeBlockOrder`):
  - returning: `search, member, todo, banner, shortcuts, flash, purchased, categories, bestSellers, combos, journey, community, suggest`
  - new: `search, welcome, todo, banner, shortcuts, flash, categories, bestSellers, combos, journey, community, suggest`
  - unknown: `search, member, todo, banner, shortcuts, flash, categories, bestSellers, combos, journey, community, suggest`
- `export const HOME_HEADER_HEIGHT = 56;`
- `HomeShortcutId` thêm `'flash'` (nhãn "Giờ vàng", đích `/flash-sale`); `HOME_SHORTCUT_SLOTS = 4`; `homeShortcutSlots(flags: HomeFlags): { pinned: HomeShortcutSpec[]; all: HomeShortcutSpec[] }`: `pinned` = 4 mục đầu theo thứ tự ưu tiên `flash, coupons, recycle, groupBuy, rewards, orders, claim, earn, community` sau khi bỏ mục cờ tắt (Đổi rác tắt thì ô trống được mục kế lấp); `all` = toàn bộ mục còn hiển thị. Nhãn coupons đổi "Mã giảm giá" (≤10 ký tự, câu đọc chứa nhãn).
- `HOME_SETTLING_HEIGHTS` đổi số đo cho khớp khối mới (xem Task 12 đo thật): `shortcuts` 84, `flash` (đo lại), `categories` (2×5, đo lại), `products` giữ.
- `PURCHASED_HINT_KEY = 'tubu_home_purchased'`; `readPurchasedHint(storage): 'none' | 'one' | 'many'` (chưa nhớ = 'none'); `writePurchasedHint(storage, count: number)`; `purchasedSkeletonHeight(hint): number` (88 + tiêu đề cho 'one', chiều cao kệ rail-md cho 'many').

- [ ] **Step 1: Viết test đỏ** trong `home-layout.spec.ts`: thứ tự 3 loại khách đúng như trên (`toEqual`); `bestSellers` ở cả returning/new; returning có `flash` trước `purchased` và `purchased` trước `categories`; `homeShortcutSlots({wasteEnabled:true,claimEnabled:true}).pinned.map(id)` = `['flash','coupons','recycle','groupBuy']`; Đổi rác tắt → `['flash','coupons','groupBuy','rewards']`; `all` chứa `earn`, `community`, `orders`; nhãn mọi mục ≤10 ký tự; `readPurchasedHint`/`writePurchasedHint` khứ hồi 0→none, 1→one, 3→many, kho ném lỗi → 'none' không văng; `homeRenderOrder(..., true)` vẫn cắt sau hero.
- [ ] **Step 2: Chạy** `cd packages/app-core && npx vitest run src/home-layout.spec.ts` → FAIL.
- [ ] **Step 3: Cài đặt** các chữ ký ở Interfaces; `visibleHomeShortcuts` giữ nguyên chữ ký (spec cũ về cờ vẫn đúng, sửa chỗ thứ tự theo `HOME_SHORTCUTS` mới).
- [ ] **Step 4: Chạy lại** → PASS; `cd packages/app-core && npx tsc --noEmit` xanh.
- [ ] **Step 5: Commit** `feat(app-core): thứ tự khối Trang chủ mới, lối tắt cố định 4 + Tất cả, gợi ý nhớ số món Mua lại`.

### Task 2: app-core chống trùng kệ Trang chủ và lối thay thế route

**Files:** Create `packages/app-core/src/merch/home-shelves.ts`, `merch/route-fallback.ts` + spec; Modify `home-copy.ts` (tên khối).

**Interfaces:**
- Consumes: `applyShelfDedupe`, `shelf` (`merch/shelves.ts`).
- Produces:
```ts
export interface HomeShelfInput { flash: HomeShelfItem[]; purchased: HomeShelfItem[]; combos: HomeShelfItem[]; bestSellers: HomeShelfItem[] }
export type HomeShelfItem<T = unknown> = { id: string; item: T }; // id = slug sản phẩm (flash chỉ có productSlug)
export function composeHomeShelves<T>(input: Record<'flash'|'purchased'|'combos'|'bestSellers', { id: string; item: T }[]>): Record<'flash'|'purchased'|'combos'|'bestSellers', T[]> & { seen: ReadonlySet<string> };
export function seeAllHref(shelfId: string, platform: 'mini' | 'web' = 'mini'): string | null;
// route-fallback.ts
export function liveRoute(route: string, platform: 'mini' | 'web'): string;
```
  `composeHomeShelves` gọi `applyShelfDedupe` với id `home.flash|home.purchased|home.combos|home.bestSellers`, trả mỗi kệ đã cắt/ẩn và `seen` = hợp slug mọi kệ còn hiện (để Gợi ý loại trùng, rank 6). `liveRoute('/flash-sale','mini')` = `/offers`, `/best-sellers` = `/browse?sort=best_seller`, `/vouchers` = `/offers?section=coupons`; web: `/gio-vang` → `/uu-dai`, `/ban-chay` → `/san-pham?sort=best_seller`, `/ma-giam-gia` → `/uu-dai`; route khác trả nguyên. P12/P13/P14 xoá dòng của mình khi thêm route.

- [ ] **Step 1: Test đỏ** (`home-shelves.spec.ts`): món `a` ở flash và bestSellers → chỉ ở flash; flash 2 món (< minItems 3) → `[]` và các món đó KHÔNG vào `seen` (còn hiện ở bestSellers); bestSellers 12 món → cắt 10; bestSellers còn 2 món sau dedupe → `[]`; purchased 1 món vẫn hiện (min 1); `seen` đúng; `seeAllHref('home.flash')` = `/offers` (qua fallback), `seeAllHref('home.purchased')` = `/orders`, `seeAllHref('home.combos')` = null. `route-fallback.spec.ts`: bảng trên cả hai nền, route lạ trả nguyên.
- [ ] **Step 2: Chạy** → FAIL. **Step 3: Cài đặt.** **Step 4: Chạy** → PASS + `shelves.spec.ts` vẫn xanh.
- [ ] **Step 5: Commit** `feat(app-core): chống trùng kệ Trang chủ qua SHELVES, lối thay thế route đợt sau`.

### Task 3: app-core hạt giống ngày và chip gợi ý

**Files:** Create `packages/app-core/src/home-suggest.ts` + spec; Modify `api/catalog.ts` (`CatalogQuery.seed?: string`, `catalogParams`, `fetchForYou(http, query?: { seed?: string })`), `api/catalog.spec.ts`, `home-layout.ts` (bỏ `SUGGEST_TABS`/`SuggestTab` sort; `SUGGEST_PAGE_SIZE = 20`).

**Interfaces:**
```ts
export function vnDateSeed(now: number): string;            // 'YYYYMMDD' theo giờ Việt Nam (UTC+7)
export const SUGGEST_MAX = 100; export const SUGGEST_MAX_DESKTOP = 48; export const SUGGEST_CHIP_MAX = 4;
export interface SuggestChip { key: string; label: string; categoryId: string | null }
export function suggestChips(categories: Pick<CategoryDTO, 'id' | 'name' | 'productCount'>[]): SuggestChip[]; // "Tất cả" + tối đa 4 danh mục tầng 1 nhiều SP nhất, bỏ productCount 0
export function suggestLimit(loaded: number, desktop: boolean): { hasMore: boolean; max: number };
```
- [ ] **Step 1: Test đỏ:** `vnDateSeed(Date.UTC(2026,9,31,17,30))` = `'20261101'` (17:30 UTC đã sang ngày VN sau); `vnDateSeed(Date.UTC(2026,9,31,16,59))` = `'20261031'`; chip: 6 danh mục → "Tất cả" + 4 theo `productCount` giảm dần, id hoà theo thứ tự đầu vào, danh mục 0 SP bị bỏ, rỗng → chỉ "Tất cả"; `catalogParams({page:1,limit:20,seed:'20261101'}).seed === '20261101'` và không có `seed` khi không truyền; `suggestLimit(100,false).hasMore === false`, `suggestLimit(48,true).hasMore === false`, `(20,true).hasMore === true`.
- [ ] **Step 2–4:** chạy đỏ → cài đặt → xanh (`npx vitest run src/home-suggest.spec.ts src/api/catalog.spec.ts`). Mini/web còn chỗ gọi `SUGGEST_TABS` sẽ được sửa ở Task 11/16 (tạm giữ export cũ đến lúc đó, xoá ở task đó).
- [ ] **Step 5: Commit** `feat(app-core): hạt giống ngày VN, chip danh mục cho Gợi ý hôm nay, tham số seed ở API client`.

### Task 4: API `seed` cho `/products` và `/products/for-you`

**Files:** Modify `apps/api/src/modules/catalog/dto/product-query.dto.ts`, `catalog.controller.ts`, `catalog.service.ts`; Create `dto/for-you-query.dto.ts`, `catalog-seed.ts`, `catalog-seed.spec.ts`; Test `catalog.service.spec.ts`, `catalog.controller.spec.ts`.

**Interfaces:**
```ts
// catalog-seed.ts
export const SEED_PATTERN = /^\d{8}$/;
export function seedHash(seed: string, id: string): number;                      // xác định, 32-bit không dấu
export function seededOrder<T extends { id: string; brandId: string | null }>(rows: T[], seed: string): T[]; // theo seedHash tăng dần; không quá 2 món liền nhau cùng brandId nếu còn món khác nhãn để xen
```
`ProductQuery.seed?: string` (`@Matches(SEED_PATTERN)`), `ForYouQuery.seed?`. `list()`: có `seed` và `sort` rỗng và không `q` → `listRanked` với `select {id, brandId}`, `needsPrice=false`, bước sắp là `seededOrder`, khoá nhớ 60 giây gồm `seed`. Không `seed` → đường cũ nguyên văn. `getForYou(userId, seed?)`: có `seed` thì lấy 2×`TAKE` ứng viên đầu theo thứ tự cũ, xếp lại bằng `seedHash`, cắt `TAKE`; không có thì y như cũ.

- [ ] **Step 1: Test đỏ:** `seededOrder` cùng seed → cùng thứ tự (gọi hai lần), khác ngày (`20261101` vs `20261102`) → thứ tự khác trên 20 id, không xen quá 2 cùng `brandId` với 6 món nhãn A + 6 nhãn B, một nhãn duy nhất thì giữ nguyên thứ tự hash; `ProductQuery` từ chối `seed='2026-11-01'`, `'1234567'`, `'abc'` (validate qua `validateSync`), chấp nhận `'20261101'`; service: `list({page:1,limit:5,seed:'20261101'})` hai lần cùng kết quả, không `seed` gọi đúng `prisma.product.findMany` với `orderBy [{isFeatured:'desc'},{id:'asc'}]` như cũ (test cũ giữ nguyên xanh); `sort='newest'` + `seed` bỏ qua seed.
- [ ] **Step 2: Chạy** `cd apps/api && npx jest src/modules/catalog/catalog-seed.spec.ts src/modules/catalog/catalog.service.spec.ts src/modules/catalog/catalog.controller.spec.ts` → FAIL.
- [ ] **Step 3: Cài đặt** như Interfaces. **Step 4:** chạy lại → PASS; `npx tsc --noEmit -p apps/api` xanh.
- [ ] **Step 5: Commit** `feat(api): tham số seed ngày VN xoay thứ tự Gợi ý hôm nay`.

### Task 5: Mini header dính 56px, thẻ thành viên nền sáng, Việc cần làm 1 dòng

**Files:** Modify `apps/miniapp/src/components/home/home-header.tsx`, `member-card.tsx`, `todo-strip.tsx`, `apps/miniapp/src/pages/home.tsx` (khối `search` = header dính, bỏ `HomeHeader` ngoài khối), specs `home-header-logo.spec.ts`, `member-card.spec.tsx`, `todo-strip.spec.tsx`, `home-parts.spec.tsx`; `home-copy.ts`.

**Interfaces:**
- `HomeHeader({ unreadCount }: { unreadCount: number })` giờ là khối `search`: cao đúng `HOME_HEADER_HEIGHT` 56, hàng `[dấu logo 26×30 cắt từ tubu-logo-home.png, h1 tên "Tubu Tree"] [ô tìm flex, nút tên "Bạn đang tìm gì hôm nay?"] [chuông 44] [giỏ 44]`, dính `top: var(--safe-top)`, nền canvas. `SearchShell` trong `home.tsx` bị xoá.
- `MemberCard`: nền `--color-bg-surface`, viền `--color-border-subtle`, chữ `--color-text-brand` (forest-700), nút "Điểm danh" `primary` cỡ sm là điểm màu duy nhất; cao `HOME_HERO_HEIGHT` 64; không đệm dưới (vỏ khối lo khoảng cách).
- `TodoStrip`: một dòng 64px, viền trái 3px `--color-status-warning-fg`, nút "Thanh toán" cỡ sm; `todoSkeletonHeight(rows)` = `rows * 64` (cập nhật `home-layout.ts` + spec).

- [ ] **Step 1: Test đỏ:** `home-header` (RTL, mới `home-header.spec.tsx`): có `h1` tên "Tubu Tree", nút "Bạn đang tìm gì hôm nay?" điều hướng `/browse?focus=search`, chuông và giỏ có tên, tổng cao 56 (`style.height === '56px'`), dính; `home-header-logo.spec` vẫn đọc `LOGO_WIDTH`/`LOGO_HEIGHT` 83×30; `member-card.spec`: không có `linear-gradient` trong style vỏ, nút Điểm danh gọi `checkIn`; `todo-strip.spec`: một việc → vỏ cao 64, "Thanh toán" cỡ sm.
- [ ] **Step 2: Chạy** `cd apps/miniapp && npx vitest run src/components/home/home-header.spec.tsx src/components/home/member-card.spec.tsx src/components/home/todo-strip.spec.tsx src/components/home/home-parts.spec.tsx` → FAIL.
- [ ] **Step 3: Cài đặt.** Vỏ khối `data-home-block` trong `home.tsx` đặt `marginTop: var(--space-block)` cho mọi khối trừ `search`/`settling`; bỏ đệm dọc trong `member-card`/`todo-strip`/`new-customer-gift`.
- [ ] **Step 4: Chạy lại** → PASS (sửa `home.spec`, `home-settle.spec` nếu bắt `SearchShell`).
- [ ] **Step 5: Commit** `feat(miniapp): header dính 56px, thẻ thành viên nền sáng, Việc cần làm một dòng`.

### Task 6: Mini lối tắt 4 ô cố định + "Tất cả"

**Files:** Modify `apps/miniapp/src/components/home/shortcut-grid.tsx`, `shortcut-grid.spec.tsx`; Create `shortcuts-sheet.tsx` + spec.

**Interfaces:**
- Consumes: `homeShortcutSlots`, `liveRoute`.
- `ShortcutGrid()` vẽ 4 ô `pinned` + ô "Tất cả" thành lưới 5 cột đều (không cuộn), vòng 44, nhãn caption 1 dòng, cao 84; `ShortcutsSheet({ open, onClose })` là `BottomSheet` liệt kê `all` bằng `ListRow` (mục Kiếm tiền mở `EarnSheet`).
- [ ] **Step 1: Test đỏ:** có 5 nút (4 + "Tất cả"), không `ScrollRow`; bấm "Tất cả" mở hộp thoại tên "Tất cả lối tắt" liệt kê đủ mục; bấm "Giờ vàng" điều hướng tới `liveRoute('/flash-sale','mini')`; cờ tắt Đổi rác → ô thứ 4 là "Đổi quà"; ô cao 84.
- [ ] **Step 2–4:** chạy đỏ → cài đặt → xanh (`npx vitest run src/components/home/shortcut-grid.spec.tsx src/components/home/shortcuts-sheet.spec.tsx`).
- [ ] **Step 5: Commit** `feat(miniapp): lối tắt 4 ô cố định và sheet Tất cả`.

### Task 7: Mini khối Giờ vàng gọn

**Files:** Modify `apps/miniapp/src/components/flash-sale.tsx` (+ spec của nó nếu có), `home.tsx`, `home-copy.ts`.

**Interfaces:**
- Consumes: `SectionHeader tone="promo" icon="zap"`, `Countdown mode="clock"`, `FlashSoldBar`, `RailShell/RailCell`, `composeHomeShelves` (Task 10 truyền `items` đã cắt).
- `FlashSale({ items: FlashSaleActiveItem[]; loading: boolean; error?: unknown; onRetry?(): void })` thay vì tự `useQuery`: tiêu đề "Giờ vàng" + `Countdown mode="clock"` (đồng hồ suất sớm nhất còn giờ) + "Xem tất cả" tới `seeAllHref('home.flash')`; kệ `flash` ≤8 thẻ; thẻ chân `FlashSoldBar` (16px); dưới kệ dòng 40px `NextSlotLine` "{HH:mm} · {n} món sắp mở · Nhắc tôi ›" chỉ khi suất kế tiếp mở trong ≤6 giờ, bấm → `/flash-sale` (qua `liveRoute`). `UpcomingFlashSales` rời Trang chủ (kệ "Sắp diễn ra" bỏ); `fetchUpcomingFlashSales` chạy cả khi chưa đăng nhập (P3b đã mở công khai).
- Hết giờ (`Countdown.onEnd` hoặc `soonestEndAt` quá hạn): tính lại suất sớm nhất; không còn suất → khối ẩn (không 00:00:00).

- [ ] **Step 1: Test đỏ:** 3 suất → tiêu đề "Giờ vàng", 1 `role=timer` có ô số, 3 `flash-sold-bar`, nút "Xem tất cả Giờ vàng"; 2 suất (< minItems) → không render gì; 9 suất → 8 thẻ; suất đầu hết giờ (fake timers) → đồng hồ chuyển sang suất kế; hết mọi suất → ẩn; suất kế mở sau 3 giờ → thấy `NextSlotLine`, sau 8 giờ → không; khách chưa đăng nhập vẫn thấy dòng.
- [ ] **Step 2–4:** chạy đỏ → cài đặt → xanh (`npx vitest run src/components/flash-sale.spec.tsx` hoặc file spec hiện có).
- [ ] **Step 5: Commit** `feat(miniapp): Giờ vàng gọn: header promo, đồng hồ, thanh bán có chữ, dòng suất kế`.

### Task 8: Mini Mua lại 1 món = 1 dòng 88px

**Files:** Modify `apps/miniapp/src/components/reorder/purchased-rail.tsx`, spec; `home.tsx`.

**Interfaces:**
- Consumes: `readPurchasedHint`/`writePurchasedHint`/`purchasedSkeletonHeight` (Task 1), `SectionHeader`.
- `COMPACT_MAX_ITEMS = 1` với `source === 'home_rail'`; 1 món → `RebuyLine` cao 88: ảnh 64, tên (1 dòng), phân loại, giá `PriceTag size="sm"`, nút "Mua lại" `secondary` ở phải; từ 2 món → `RailShell` thẻ `rail-md` như cũ. Tab Đơn hàng (`orders_tab`) giữ hành vi cũ. Khung chờ dùng `purchasedSkeletonHeight(readPurchasedHint(...))`. Tiêu đề dùng `SectionHeader` có "Xem tất cả" tới `/orders?tab=delivered`.
- [ ] **Step 1: Test đỏ:** 1 món home → vỏ dòng cao 88 và có nút "Mua lại"; 2 món → kệ `rail-md`; hết hàng → dòng chữ "Tạm hết hàng", không nút Mua lại; ghi hint 'one'/'many' khi tải xong; khung chờ cao đúng `purchasedSkeletonHeight`; `orders_tab` với 1 món vẫn thẻ cũ.
- [ ] **Step 2–4:** đỏ → cài đặt → xanh (`npx vitest run src/components/reorder`).
- [ ] **Step 5: Commit** `feat(miniapp): Mua lại một món thành một dòng 88px, khung chờ theo số món nhớ`.

### Task 9: Mini Danh mục lưới 2×5

**Files:** Modify `apps/miniapp/src/components/home/category-row.tsx`, spec trong `home-parts.spec.tsx`; `apps/miniapp/src/hooks/use-categories.ts` nếu cần cắt 9 + "Tất cả".

**Interfaces:** `CategoryRow` (giữ props) vẽ lưới `grid-template-columns: repeat(5, 1fr)` 2 hàng; ô 56 nền màu xoay vòng theo `SHORTCUT_TINT_VARS` (hoặc `category.image`); ô thứ 10 là "Tất cả ›" mở `/browse`; quá 10 mục cuộn ngang theo cột 2 hàng; tiêu đề `SectionHeader` "Danh mục" (region tên "Danh mục"); khung chờ 10 ô cùng số đo.
- [ ] **Step 1: Test đỏ:** 12 danh mục → hàng đầu 5 ô, vùng cuộn ngang; 6 danh mục → 6 ô + "Tất cả" trong lưới 2 hàng; loading → 10 ô `category-row-skeleton`; chạm ô gọi `onSelect`; vùng tên "Danh mục" giữ nguyên.
- [ ] **Step 2–4:** đỏ → cài đặt → xanh. **Step 5: Commit** `feat(miniapp): Danh mục lưới 2 hàng × 5 cột`.

### Task 10: Mini Bán chạy nhất có hạng, khối banner/combos, ghép Trang chủ

**Files:** Modify `best-seller-rail.tsx`, `home-lazy.tsx`, `pages/home.tsx`, `home-blocks.ts`; Create `use-home-shelves.ts`, `home-banner.tsx`, `home-combos.tsx`, `home-blocks.spec.tsx`.

**Interfaces:**
- `useHomeShelves(kind: HomeKindState): { flash: FlashSaleActiveItem[]; purchased: PurchasedItem[]; bestSellers: ProductCardData[]; combos: ProductCardData[]; seen: ReadonlySet<string>; loading: {...} }`: đọc cùng query key (`['flash-sales','active']`, purchased 10, `['products','home-best-seller']` với `sort: 'best_seller_30d', limit: 20`), khoá slug, qua `composeHomeShelves`. Kệ chỉ dành khách cũ (purchased) rỗng với khách mới.
- `BestSellerRail({ items, loading, error, onRetry })`: `SectionHeader` "Bán chạy nhất" + "Xem tất cả" `seeAllHref('home.bestSellers')`, `ProductRail variant="rank" rankFrom={1}`, cho cả khách cũ và mới.
- `HomeBanner()` và `HomeCombos()` trả `null` (P11/P15 nối dữ liệu); `use-home-banners.ts` trả `[]`; không giữ chỗ.
- `home.tsx` ghép theo `homeRenderOrder`, bỏ `UpcomingFlashSales`, dải lỗi cấp trang dùng `bestSellers` (mọi loại khách).
- [ ] **Step 1: Test đỏ** (`home-blocks.spec.tsx`): bestSellers < 3 sau dedupe → ẩn; món trùng flash không xuất hiện ở bestSellers; nguồn lỗi và chưa có dữ liệu → `HomeBlockError` có "Thử lại"; `HomeBanner` rỗng không có `data-home-block` con nào có chiều cao; khách mới và cũ đều thấy "Bán chạy nhất" có số hạng 1..n.
- [ ] **Step 2–4:** đỏ → cài đặt → xanh (`npx vitest run src/components/home src/pages/home*.spec.tsx`).
- [ ] **Step 5: Commit** `feat(miniapp): Bán chạy nhất có hạng cho cả hai loại khách, chống trùng kệ, khối banner và combos`.

### Task 11: Mini Gợi ý hôm nay (chip danh mục, seed, trần 100)

**Files:** Modify `suggest-feed.tsx`, `suggest-feed.spec.tsx`, `services/shop-api.ts` (`fetchProducts`/`fetchForYou` nhận `seed`); `home-layout.ts` xoá `SUGGEST_TABS`; `home-copy.ts` (`suggest.title` "Gợi ý hôm nay", `suggest.end` + nút "Vào Danh mục").

**Interfaces:** `SuggestFeed({ exclude }: { exclude: ReadonlySet<string> })`; chip từ `suggestChips(useCategories().tree)`, hàng chip dính `top: var(--home-header-h)` khi lưới chạm đỉnh; mọi lời gọi gửi `seed: vnDateSeed(serverNow())`; loại món có slug trong `exclude`; dừng ở `SUGGEST_MAX` món với dòng "Bạn đã xem hết gợi ý hôm nay" + nút "Vào Danh mục" → `/browse`; đổi chip → lọc `category`.
- [ ] **Step 1: Test đỏ:** lời gọi `/products` có `seed=YYYYMMDD` (fake `serverNow`); đổi chip → `category=<id>`; món trong `exclude` không vẽ; sau 100 món hết "Xem thêm", hiện "Vào Danh mục"; chip chỉ "Tất cả" khi chưa có danh mục; hai lần mở cùng ngày gửi cùng seed.
- [ ] **Step 2–4:** đỏ → cài đặt → xanh. **Step 5: Commit** `feat(miniapp): Gợi ý hôm nay với chip danh mục, seed ngày và trần 100 món`.

### Task 12: Mini e2e, khung chờ, màn đầu và bundle

**Files:** Modify `apps/e2e/tests/{buy-flow-4a,home-h,home-merged,design-system-pilot,tile-rhythm,...}.miniapp.spec.ts` theo test đỏ; Create `apps/e2e/tests/home-p6.miniapp.spec.ts`; Modify `home-layout.ts` (`HOME_SETTLING_HEIGHTS`, `FLASH_SKELETON_HEIGHT`) theo số đo thật.

- [ ] **Step 1: Test mới** `home-p6.miniapp.spec.ts` (E2E_SCOPE=miniapp, 375×812, API giả): khách cũ có 3 suất Giờ vàng, không banner: `boundingBox` khối Giờ vàng `y + height ≤ 812`; CLS đo bằng `PerformanceObserver('layout-shift')` ≤ 0,02 từ lúc mở tới khi mọi khối đã về; khách mới thấy "Bán chạy nhất" có hạng; không có banner → không có phần tử banner.
- [ ] **Step 2:** chạy `cd apps/e2e && E2E_SCOPE=miniapp E2E_MINIAPP_PORT=3301 npx playwright test tests/home-p6.miniapp.spec.ts tests/buy-flow-4a.miniapp.spec.ts tests/home-h.miniapp.spec.ts tests/home-merged.miniapp.spec.ts --workers=1` → ghi test nào đỏ; sửa mã nếu hồi quy, sửa test nếu đỏ vì thiết kế mới (ghi vào notes).
- [ ] **Step 3: Đo và cập nhật** `HOME_SETTLING_HEIGHTS`/`FLASH_SKELETON_HEIGHT` đúng số đo khối thật; chạy lại 'Danh mục không xê dịch' (≤2px) xanh.
- [ ] **Step 4: Bundle:** `pnpm --filter @tubutree/miniapp build` rồi `node scripts/ci/bundle-budget.cjs apps/miniapp/www`; ghi entry trước (682 KB) / sau; nếu >690 KB chuyển khối dưới màn đầu sang `home-below.tsx` nạp lười.
- [ ] **Step 5: Commit** `test(e2e): Trang chủ Mini theo thiết kế mới, CLS và màn đầu`.

### Task 13: Web header dính, thẻ thành viên, Việc cần làm, lối tắt, bỏ lề âm

**Files:** Modify `apps/web/src/components/home/{home-header,member-card,todo-strip,shortcut-grid,category-row,home-view}.tsx` + specs. Bản chép của Task 5, 6, 9 (cùng props, `next/link` thay `useNavigate`).

- [ ] **Step 1: Test đỏ** (vitest web, `@/test-utils/dom`): header khổ điện thoại cao 56 (class `h-14`), có `h1`; không còn lớp `-mx-4`/`margin: '0 -16px'` trong `category-row.tsx`, `shortcut-grid.tsx` (đọc nguồn); lối tắt 4 + "Tất cả" mở sheet; Danh mục lưới 2×5; thẻ thành viên không `gradient`; `shortcut-grid` ẩn từ lg (`lg:hidden`).
- [ ] **Step 2–4:** đỏ → cài đặt → xanh (`cd apps/web && npx vitest run src/components/home`). **Step 5: Commit** `feat(web): Trang chủ khổ điện thoại khớp Mini: header 56, lối tắt cố định, danh mục 2×5, bỏ lề âm`.

### Task 14: Web Giờ vàng, Mua lại, Bán chạy nhất, Gợi ý hôm nay

**Files:** Modify `apps/web/src/components/home/{flash-sale,best-seller-rail,suggest-feed,home-view,home-blocks}.ts*`, `components/reorder/purchased-rail.tsx`, `lib/home-initial.ts`, `lib/use-flash-sales.ts` (nếu cần); Create `components/home/use-home-shelves.ts`. Bản chép của Task 7, 8, 10, 11.

- [ ] **Step 1: Test đỏ:** như Task 7/8/10/11 (cùng ca, test web): Giờ vàng `SectionHeader tone=promo` + `Countdown clock` + 8 thẻ; 1 món Mua lại → dòng 88; Bán chạy nhất có hạng cho `kind='new'` và `'returning'`; Gợi ý gửi `seed`, chip danh mục, trần 100 (máy tính `SUGGEST_MAX_DESKTOP` 48 rồi "Xem thêm" tới `/san-pham`); `loadHomeInitial` truyền `sort: 'best_seller_30d'` và `seed` cho trang 1 gợi ý.
- [ ] **Step 2–4:** đỏ → cài đặt → xanh. **Step 5: Commit** `feat(web): Giờ vàng gọn, Mua lại một dòng, Bán chạy nhất có hạng, Gợi ý hôm nay`.

### Task 15: Web `HubLayout` (lưới 12 cột ở lg)

**Files:** Create `apps/web/src/components/layouts/hub-layout.tsx` + `hub-layout.spec.tsx`; Modify `home-view.tsx`.

**Interfaces:**
```tsx
export function HubLayout({ banner, aside, children }: { banner?: ReactNode; aside: ReactNode; children: ReactNode }): JSX.Element
```
`lg:grid lg:grid-cols-12 lg:gap-6`: `banner` col-span-8, `aside` col-span-4 (thẻ thành viên/quà + Việc cần làm), `children` col-span-12 dưới đó; dưới `md` trả `<>{banner}{aside}{children}</>` đúng thứ tự Mini (không thêm khung, không đổi DOM so với Mini 375). `home-view.tsx` dùng `HubLayout` ở lg, ẩn lối tắt từ lg.
- [ ] **Step 1: Test đỏ:** render có đủ ba phần; class lưới 12 cột (`lg:grid-cols-12`), `lg:col-span-8`/`lg:col-span-4` có mặt; không có `max-md:`; `banner` rỗng → `aside` chiếm col-span-12; thứ tự DOM banner → aside → children; `ShortcutGrid` có `lg:hidden`.
- [ ] **Step 2–4:** đỏ → cài đặt → xanh. **Step 5: Commit** `feat(web): HubLayout lưới 12 cột cho Trang chủ máy tính`.

### Task 16: Web e2e/vitest dọn và so 375px

- [ ] **Step 1:** sửa spec web đỏ vì thiết kế (`home-view*.spec.tsx`, `home-parts.spec.tsx`), chạy `cd apps/web && npx vitest run src/components/home src/components/layouts src/components/reorder src/lib` → xanh.
- [ ] **Step 2: Chụp 375px** Mini (Vite dev 3301) và web (Next dev 3302) bằng Playwright với API giả (`apps/e2e/tests/support/mock-api.ts` hoặc `/ds-gallery`), lưu `docs/2026-10-31-shop-redesign/screens/P6/{mini,web}-{returning,new}.png`, so hai bản, sửa lệch; tắt server.
- [ ] **Step 3: Commit** `test(web): spec Trang chủ theo thiết kế mới`.

### Task 17: Gate, e2e Mini đầy đủ, race

- [ ] **Step 1:** `bash docs/2026-10-28-review/tools/gate.sh /Users/longla/coding/tubutree-mini-app/.claude/worktrees/shop-P6 --base 2e52b9be9 --out /Users/longla/coding/tubutree-mini-app/.claude/worktrees/gate-P6.txt`; FAIL nào cũng FAIL ở base thì ghi "có sẵn".
- [ ] **Step 2:** `cd apps/e2e && E2E_SCOPE=miniapp E2E_MINIAPP_PORT=3301 npx playwright test --workers=2 --reporter=line`.
- [ ] **Step 3:** API có đụng catalog: không có race spec liên quan `seed`; không cần cụm Postgres riêng (jest dùng mock Prisma). Ghi vào notes.
- [ ] **Step 4: Cập nhật** `plans/P6-home.md` mục "Điều chỉnh lúc làm" nếu lệch, commit `docs(shop-redesign): P6 kế hoạch và ghi chú`.

## Điều chỉnh lúc làm

Các chỗ làm khác kế hoạch, và vì sao:

- Hàng danh mục và lưới lối tắt trên web dùng lề âm chỉ ở điện thoại (`max-md:-mx-4` cho hàng danh mục, `max-md:-mx-2` cho lưới lối tắt). Kế hoạch ghi không dùng lề âm, nhưng Mini lộ nửa cột thứ 6 và lưới lối tắt sát mép hơn lề trang 8px; muốn web 375px giống Mini phải bù lề. Lề âm bị giới hạn bằng `max-md:` nên máy tính không bị ảnh hưởng, spec kiểm tra không có `-mx-` không giới hạn.
- Thứ tự DOM của `HubLayout` là `aside` → `banner` → phần còn lại (đúng thứ tự Mini), không phải banner → aside → children như kế hoạch. Nhờ vậy điện thoại không cần đổi thứ tự bằng CSS; từ lg banner được đặt vào cột đầu bằng `lg:col-start-1 lg:row-start-1`. Khung bọc là `display: contents` dưới lg.
- Giờ vàng trên web không chờ danh sách `upcoming` mới vẽ (giữ nguyên HTML ISR); dòng "suất kế tiếp" đến sau và chỗ 44px được giữ trước nhờ gợi ý đã lưu, nên trang không nhảy.
- `PurchasedRail` và `BestSellerRail` (web) có thêm prop tuỳ chọn; trang Đơn hàng chuyển sang `BestSellerRailQuery` (sửa một dòng ở `tai-khoan/don-hang/page.tsx`).
- `HomeInitial` có thêm `suggestSeed`, để HTML đầu và lưới sau hydrate cùng một thứ tự gợi ý.
- `UpcomingFlashSales` không còn vẽ ở Trang chủ nhưng vẫn được export.
- Web dùng `ProductGrid` và `ProductRail` từ `components/mini` (không có tham số `listSource`).
- Banner và combos là chỗ trống (`null`) chờ P11 và P15.
- Gỡ phần chết ở app-core: `SuggestTab`, `SUGGEST_TABS`, `shortcuts.rail`, `suggest.tabsLabel`, `bestSellers`.
- Thư mục `apps/web/src/components/layouts/` do gói này tạo; P7, P8, P9 thêm layout của mình vào đó.
- `home-block-error.tsx` trên web còn dùng kiểu cũ, chưa chỉnh theo Mini.
- Nhãn lối tắt: bản đầu để một dòng và cắt `…` ("Mã giảm…", "Mua chu…" ở cả Mini lẫn web ở 375px, không riêng web như ghi lúc trước). Đã sửa: nhãn tối đa hai dòng, cao cố định 32px, ô vẫn 84px (đệm trên 4, khoảng cách 4, dòng 16). e2e đo tràn ngang và số dòng ở 375 và 320 trên hai app.
- Vòng sửa sau review:
  - Bán chạy nhất trở lại gói đầu (bản đầu đưa vào chunk `home-below` để nhẹ ~1,5 KB, nhưng chunk hỏng hay chậm làm kệ biến mất hoặc bật ra dưới Danh mục, và đó là kệ sản phẩm duy nhất của khách mới khi không có Giờ vàng). Entry Mini sau vòng sửa (gate `bundle-mini`): 621 KB raw / 193 KB gz, dưới trần mềm 690; bản đầu có kệ này nằm ngoài entry nhưng không đo riêng số trước/sau; số 682 KB là của bàn giao đợt 2 (trước P6), đo ở máy khác lúc đó.
  - Danh mục: tới 10 ô (kể cả "Tất cả") xếp theo hàng để "Tất cả" luôn cuối và thứ tự nhìn khớp thứ tự đọc; quá 10 ô mới xếp theo cột và cuộn ngang. Khung chờ dùng cùng luật. Khi chỉ có ≤ 5 ô, lưới thấp còn một hàng (trước đây hai hàng với 2 ô trở lên).
  - Gợi ý hôm nay (hai app): cả trang 1 là món đã nằm ở kệ trên mà còn trang sau thì tải tiếp (trước đây khối ẩn, trang 2 không bao giờ tải); ẩn khối chỉ khi hết trang.
  - Web, request gộp: `/products/for-you` kèm `seed` vẫn lấy từ khối `/home/me` (trước đây lọt ra request lẻ, e2e `home-merged.web` đỏ); suất sắp mở chỉ hỏi khi phiên đã biết (`useAuthPhase() !== 'loading'`, vì `useAuthRestoring` là `false` ở lượt hydrate đầu), và khách chưa đăng nhập đi request lẻ chứ không khởi động `/home/me` (401, khoá định danh rỗng, mọi khối cá nhân sau đó lọt ra request lẻ).
  - Hàng cuộn Mua lại trên web tên "Sản phẩm đã mua" như Mini (nhánh tích hợp đã sửa cùng chỗ ở 9a2e71994; bản P6 viết lại `purchased-rail.tsx` nên hai bên sẽ xung đột một dòng khi gộp, giữ dòng của P6 và nhãn này).
  - e2e web (`shop.web.spec.ts`, `home-merged.web.spec.ts`) theo thiết kế mới: vùng "Bán chạy nhất" có hạng #1..#3 (mock 3 món, kệ chỉ hiện từ 3 món), "Gợi ý hôm nay" với chip danh mục, không còn nhóm "Nguồn gợi ý"; Mua lại một món là dòng 88px (không còn nút "Định kỳ" ở Trang chủ); thẻ đầu kệ Mua lại 3 món cách đầu kệ 48px (tiêu đề 44 + đệm 4, bằng Mini). Chạy cục bộ 42/42 xanh (Next dev + API giả), Mini 66/66 xanh.
  - Hai spec vitest bị sót ở vòng đầu và đỏ ở gate đầy đủ: `orders-subscription-tab.spec` (Mini, mock thiếu `BestSellerRailQuery` sau khi Đơn hàng đổi sang nó) và `khoi-phuc/[hint]/page.spec` (web, khẳng định cũ "khách cũ không có Bán chạy"). Đã sửa; gate chạy lại: vitest-miniapp 5691/5691 (cả TZ=UTC), vitest-web 8372/8372, vitest-app-core 1561/1561. jest-api 12013/12013 chạy ở lượt đầu trên cùng mã API (vòng sửa không đụng API nên lượt hai dùng `--no-jest`).
  - Bỏ hai khẳng định rỗng mang tiền đề sai (`buy-flow-4a`, `home-h`: "khách cũ không có kệ Bán chạy").
- Chấp nhận, chưa sửa: "Xem tất cả" của Bán chạy nhất tới `/browse?sort=best_seller` (xếp theo tổng lượt bán) trong khi kệ xếp theo `best_seller_30d`. Trang Danh mục chưa nhận `best_seller_30d` và thuộc P7; chờ P7/P13 (`route-fallback.ts` đổi một dòng khi có). Hai thứ hạng đầu có thể khác kệ vừa xem.
- **Cần chủ quyết:** hàng danh mục và lưới lối tắt trên web vẫn dùng lề âm giới hạn `max-md:` (`-mx-4`, `-mx-2`), `STICKY_SEARCH` có `-mx-4`: lệch yêu cầu gói "bỏ lề âm tay". Cùng khuôn với `RailShell` dùng chung (`-mx-4 max-w-none md:-mx-3`). Bỏ hẳn lề âm nghĩa là bỏ đệm 16px của khung trang ở điện thoại cho các khối này; chưa làm vì đổi nhịp lề cả trang.
- Vòng sửa sau review lượt hai:
  - Lối vào Giờ vàng: `/flash-sale` (P12) chưa có trang và trang thay thế (Ưu đãi, `/uu-dai`) không có Giờ vàng hay "Nhắc tôi", mà `UpcomingFlashSales` (nơi duy nhất đặt nhắc) đã rời Trang chủ theo thiết kế. `routeUsable('/flash-sale')` trả false: ô lối tắt Giờ vàng bị bỏ khỏi `homeShortcutSlots` (mục kế lấp chỗ, 4 ô cố định thành Mã giảm giá, Đổi rác, Mua chung, Đổi quà), `seeAllHref('home.flash')` trả null nên header Giờ vàng không có "Xem tất cả", dòng suất kế là dòng thông tin cao 44px không nút và không chữ "Nhắc tôi". Việc đặt nhắc không làm được ở đâu cho tới P12: P6 không nên lên PROD trước P12. P12 bỏ cờ `pending` của `/flash-sale` (và đổi `usable` ở `PENDING_TARGET`) thì ô, "Xem tất cả" và "Nhắc tôi" hiện lại; các spec đang khoá trạng thái chờ (`home-layout.spec`, `shortcut-grid.spec` hai app, `route-fallback.spec`, `home-shelves.spec`, `flash-sale.spec` hai app, nhánh mặc định) sẽ đỏ đúng chỗ cần sửa; nhánh "có trang" đã có test qua mock `routeUsable`.
  - Gợi ý cho bạn lệch giữa khối gộp và request lẻ: sửa ở API. `/home/me` gọi `getForYou(userId, { seed })` với `vnDateSeed(now)` (bản của API ở `catalog-seed.ts`, cùng công thức app-core, có test mốc 16:59/17:00 UTC), nên lần tải đầu và các lần sau trong ngày là cùng bộ 10 món; không seed vẫn là top 10 theo lượt bán. Test: `home.service.spec` (seed theo mốc request), `catalog.service.spec` (có seed: có/không `hasOrders` ra cùng bộ và cùng thứ tự; không seed giữ hành vi cũ), `catalog-seed.spec`.
  - Khung chờ Danh mục: ô khung chờ nay có khe nhãn cao 32 (ô 92 như thật, trước 76 làm khối dưới nhảy 32px); khung chờ chung (`HomeSettlingSkeleton`) nhận `categoryCells` theo số danh mục nhớ: `categoriesBlockHeight(cells)` = 148 (tới 5 ô) hoặc 248 (từ 6 ô), `HOME_SETTLING_HEIGHTS.categories` giữ 248.
  - Ảnh 375px chụp lại từ HEAD sau các sửa trên (Chromium, Vite 3301 và Next dev 3302 với API giả, khách cũ và khách mới) lúc 05:36 (Mini) và 05:38 (web) ngày 01/11: nhãn lối tắt hai dòng đủ chữ, Danh mục "Tất cả" ở cuối, thứ tự khối và số đo hai app khớp. Hai bản khác ở dữ liệu giả (ảnh sản phẩm, thẻ "Quà khách mới" chỉ thấy ở web vì ảnh web chụp ở trạng thái chưa đăng nhập, còn Mini chụp với phiên giả đã đăng nhập; hai app cùng ẩn thẻ này theo trạng thái phiên), không phải mã. Ảnh ở `screens/P6/` (thư mục bị `.gitignore`).
  - Lề âm `max-md:-mx-4`/`-mx-2` trên web: vẫn chờ chủ quyết (xem "Cần chủ quyết" ở trên), không đổi. Nếu chủ chọn bỏ: một lớp full-bleed dùng chung trong design system cho `RailShell`, `category-row`, `shortcut-grid`, `STICKY_SEARCH`, thay vì lề âm từng file.
