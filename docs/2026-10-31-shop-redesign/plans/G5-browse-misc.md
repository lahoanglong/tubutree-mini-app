# G5 `browse-misc` (đợt 6b): P2 về duyệt, danh mục, thẻ, chiến dịch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sửa chín P2 của `review/final-critique.md` về duyệt/danh mục/thẻ/chiến dịch: bỏ "Trang sau" thừa ở web 375, danh mục quá 8 gốc có "Xem tất cả" ở tiêu đề và cột 6 ló mép, ẩn dòng thương hiệu lặp tên, mũi tên cuộn web ẩn khi hết đường, hub lg không lặp h1/h2, vùng dính Bán chạy nhất phủ hết bóng thẻ, ảnh chiến dịch web 1280 giữ 5/2, ghi hai lệch có chủ đích vào `DESIGN.md`.

**Architecture:** Quyết định (ẩn thương hiệu, lưới danh mục có cuộn không, hub còn danh mục chưa hiện không) là hàm thuần ở `packages/app-core` kèm spec; Mini App và web chỉ vẽ. Phần web dùng lớp Tailwind có sẵn (không px viết tay, không `max-md:` mới). Mỗi sửa có test đỏ trước (vitest theo file); hành vi bố cục chốt bằng e2e Mini (mock toàn bộ API) và đo/chụp web bằng API giả.

**Tech Stack:** React 18 + zmp-ui (Mini App), Next 15 + Tailwind 3.4 (web), vitest, Playwright.

**Spec:** `docs/2026-10-31-shop-redesign/01-thiet-ke.md` §4 (Q1, Q4, Q13), `02-ke-hoach.md` (Global Constraints, "Giao diện dùng chung"), `review/final-critique.md` P2 số 1, 2, 6, 8, 9, 10, 21, 22, 38; `plans/handoff-wave4b-4f.md` mục 5.

## Global Constraints

- Node: `export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH` cho mọi lệnh. Worktree mới đã chạy `pnpm install --offline --frozen-lockfile`, `pnpm --filter @tubutree/shared-types build`, `npx prisma generate` (trong `apps/api`).
- Web khổ điện thoại phải giống Mini App cả giao diện. Thẻ lưới cùng hàng chênh đáy giá ≤1px; thân thẻ cao cố định theo `TILE_METRICS` (khung chờ đọc cùng số).
- Vùng chạm ≥44px, tương phản ≥4,5:1, axe 0 vi phạm ở 375px.
- `pnpm lint:parity` chạy bánh cóc px và `max-md:` (`scripts/uiux/ds-baseline.json`): không thêm số px viết tay hay `max-md:` mới; hạ được thì `node scripts/uiux/ds-ratchet.mjs --write` rồi commit baseline.
- Chữ mới (nếu có) vào `shop-copy.ts` kèm ngân sách; không thuật ngữ cấm.
- KHÔNG sửa file của G1 (`voucher.ts`, `voucher-ticket.tsx`, Ưu đãi, `brand-view.tsx` chip phiếu, `GuestLinkCard`), G4 (Trang chủ: `pages/home.tsx`, `merch/*`, `home-shelves`, `HOME_BEST_SELLER_LIMIT`, `shop-copy.ts` khoá của G4, ghi chú Giờ vàng ở `product-tile`, `tile-metrics.ts`) và G6 (trình dựng gian hàng, `phone-ui.ts`, `button.tsx`, `sticky-action-bar.tsx`, `shop-top-bar.tsx`, `brand-body.tsx`, `shop-section.tsx`). Hai chỗ buộc phải đụng file nằm trong thư mục của G4 (ghi ở notes): `components/home/category-row.tsx` của hai app (P2 #2 nằm đúng ở đây) và đúng một khối `hasBrand` của `product-tile.tsx` hai app (P2 #6).
- Máy chung thiếu RAM: lúc làm chỉ chạy vitest theo file; gate đầy đủ đúng một lần ở cuối. Không push, không đọc/ghi PROD, không `git stash` trần, không kill tiến trình không phải của mình.
- Comment chỉ giải thích "vì sao" không hiển nhiên (tiếng Việt, theo mật độ file xung quanh).

## Review Focus

1. Sản phẩm không thương hiệu hay tên chứa thương hiệu trong từ khác ("Tubutree" so với "Tubu"): chỉ ẩn khi khớp NGUYÊN TỪ; thương hiệu có ký tự đặc biệt ("A+", "L'Occitane") không làm regex nổ. Test: `product-card-view.spec.ts`.
2. Lưới có thẻ ẩn thương hiệu đứng cạnh thẻ có thương hiệu: tên hai thẻ vẫn cùng hàng ngang, thân thẻ cao bằng nhau, khung chờ không lệch. Test: `product-tile.spec.tsx` hai app (khe giữ chỗ) và e2e Mini `browse-misc.miniapp.spec.ts` (đo `y` của tên).
3. Danh mục đúng ngưỡng: 9 gốc + "Tất cả" = 10 ô (còn xếp theo hàng, không "Xem tất cả" ở tiêu đề), 10 gốc + "Tất cả" = 11 ô (cuộn, có "Xem tất cả"). Hub: 8 gốc không có "Xem tất cả", 9 gốc có. Test: `home-layout.spec.ts`, `hub.spec.ts`, spec `category-row`/`category-tiles` hai app.
4. Mũi tên cuộn: đầu kệ chỉ còn `›`, cuối kệ chỉ còn `‹`; nút đang giữ focus bàn phím không biến mất (dùng `aria-disabled`, hiện lại mờ khi `:focus-visible`). Test: `scroll-rail.spec.tsx`.
5. Liên kết phân trang giữ trong HTML cho crawler dưới md và vẫn bấm được bằng bàn phím (hiện ra khi nhận focus). Test: `numbered-pager.spec.tsx` (mới).

---

## Quyết định lúc viết plan

- **#1 Trang sau.** Sửa ở `NumberedPager` dùng chung (Bán chạy nhất và Danh mục cùng bị; Mini không có pager ở cả hai nên bản web 375 giống Mini sau sửa): khối "Trang trước/Trang sau" dưới md thành `sr-only focus-within:not-sr-only md:not-sr-only`. Vẫn nằm trong HTML (crawler, trình đọc màn hình), hiện lại khi bàn phím nhảy vào để không có điểm Tab vô hình. Không dùng `max-md:` (bánh cóc).
- **#2 Danh mục.** Đo lại trên Mini 375: với 10 gốc, lưới Trang chủ có 11 ô nên xếp theo cột, mỗi cột `20%` nên 5 cột vừa khít vùng nội dung và cột 6 chỉ ló đúng đệm 16px, nằm trọn trong lớp mờ 28px (không thấy gì). Sửa: cột rộng `1/5,5` (hằng `CATEGORY_SCROLL_COLUMNS = 5.5` ở app-core) nên cột 6 ló nửa cột; "Xem tất cả" ở `SectionHeader` (`action.onPress`, tên đọc "Xem tất cả Danh mục") chỉ khi lưới cuộn, để lối vào "Tất cả" không còn phụ thuộc ô bị che; web bật `arrows` ở `ScrollRow` (nút `‹ ›` từ md). Hub: quá `HUB_CATEGORY_MAX` (8) gốc thì tiêu đề có "Xem tất cả" mở danh sách không lọc (cùng việc của ô "Tất cả"); ô "Tất cả" giữ nguyên.
- **#6 Thương hiệu.** `brandLine` thành null khi tên chứa thương hiệu nguyên từ (gấp dấu: bỏ dấu, đ→d, thường hoá, gộp khoảng trắng; cùng cách `voucher.ts` làm nhưng tự viết vì file đó thuộc G1). Thêm `brandSlot?: boolean` vào `ProductCardView`: khe dòng thương hiệu vẫn giữ chỗ (16px) khi ẩn chữ vì lặp tên, để tên của các thẻ cùng hàng thẳng hàng và khung chờ (đã gồm dòng thương hiệu) không nhảy. `showBrand=false` và biến thể không có khe thì `brandSlot=false` như cũ. Tile: `hasBrand = (view.brandSlot ?? view.brandLine !== null) && (grid || rail-md)`.
- **#8 Mũi tên.** Nút hết đường: `aria-disabled` giữ nguyên (Chromium bỏ focus khi nút disabled thật) nhưng thành `opacity-0 pointer-events-none`, hiện mờ lại khi `:focus-visible`.
- **#9 Hub lg.** `SectionHeader` của hub web bọc `lg:hidden` (vùng vẫn có tên qua `Section label`); từ lg 8 ô + "Tất cả" vừa một hàng nên không cần "Xem tất cả" ở đó.
- **#10 Vùng dính.** Đo ở 1280: vùng dính đã rộng đúng 1152 (bằng lưới, nền trùng nền trang, chênh pixel 0). Cái nhìn thấy trong ảnh review là bóng `--elevation-1` của thẻ cuộn bên dưới tràn ra 2–3px ngoài mép vùng dính (pixel (243,241,236) ở x=1218 so nền (246,244,239)). Sửa: từ md vùng dính lấn ra đúng đệm của khung trang (`md:-mx-6 md:px-6`, cùng `PAGE_WIDE` `md:px-6`) nên phủ bóng; hàng tab vẫn thẳng mép lưới. Không đổi bề rộng cụm tab (`md:w-fit`).
- **#21 Chiến dịch.** Bỏ `md:max-h-80` + `object-cover` (cắt 1152×320 = 3,6:1); ảnh giữ `aspect-ratio: var(--banner-ratio)` (5/2) với trần bề rộng `md:max-w-3xl md:mx-auto` (768 × 307).
- **#22, #38 DESIGN.md.** Chỉ ghi chữ: nút "Mua ngay" của trang Giờ vàng dùng `--color-flash-solid-bg` là chủ ý (không đổi `button.tsx`, của G6); chân trang web ở 375px là lệch có chủ đích (liên kết pháp lý).

## File Structure

| File | Việc |
|---|---|
| `packages/app-core/src/commerce/product-card-view.ts` (+ spec) | ẩn `brandLine` lặp tên, `brandSlot` (Task 1) |
| `apps/miniapp/src/components/ui/product-tile.tsx`, `apps/web/src/components/mini/product-tile.tsx` (+ spec) | khe thương hiệu giữ chỗ (Task 2) |
| `apps/web/src/components/catalog/numbered-pager.tsx` (+ spec mới) | liên kết trang sr-only dưới md (Task 3) |
| `apps/web/src/components/scroll-rail.tsx` (+ spec) | ẩn mũi tên hết đường (Task 4) |
| `packages/app-core/src/home-layout.ts`, `apps/{miniapp,web}/src/components/home/category-row.tsx` (+ spec) | cột 6 ló, "Xem tất cả", arrows (Task 5) |
| `packages/app-core/src/browse/hub.ts`, `apps/{miniapp/src/components,web/src/components}/catalog/category-tiles.tsx` (+ spec) | hub quá 8 gốc, hub lg bỏ h2 (Task 6) |
| `apps/web/src/app/ban-chay/best-sellers-view.tsx`, `apps/web/src/components/campaign/campaign-body.tsx` (+ spec) | vùng dính, ảnh chiến dịch (Task 7) |
| `DESIGN.md` | hai lệch có chủ đích (Task 8) |
| `apps/e2e/tests/browse-misc.miniapp.spec.ts`, `scripts/uiux/ds-baseline.json` | e2e Mini, baseline (Task 9) |

## Task 1: `productCardView` ẩn thương hiệu lặp tên (P2 #6)

**Files:** Modify `packages/app-core/src/commerce/product-card-view.ts`; Test `product-card-view.spec.ts`.

**Interfaces:** Produces: `ProductCardView.brandSlot?: boolean`. `brandLine` là `null` khi biến thể không có khe, `showBrand === false`, hoặc tên sản phẩm chứa thương hiệu nguyên từ. `brandSlot` là `true` khi biến thể có khe và `showBrand !== false` (kể cả khi `brandLine` null vì lặp tên).

- [ ] **Step 1: test đỏ** trong khối `khe nhãn theo biến thể`, tên ca và khẳng định:
  - `'ẩn dòng thương hiệu khi tên đã chứa thương hiệu (không dấu, không phân biệt hoa thường), khe vẫn giữ chỗ'`: `{name:'Nước rửa chén sinh học Fuwa3e', brand:'Fuwa3e'}` → `brandLine` null, `brandSlot` true; `{name:'Dầu xả bồ kết Pơ Lang', brand:'PO LANG'}` → null; `{name:'Băng vệ sinh Moc An', brand:'Mộc An'}` → null.
  - `'chỉ khớp nguyên từ'`: `{name:'Tubutree xà phòng', brand:'Tubu'}` → `brandLine` `'Tubu'`; `{name:'Sữa A+ 900g', brand:'A+'}` → null; `{name:'Sữa AA 900g', brand:'A+'}` → `'A+'`; `{name:'Kem L\'Occitane 50ml', brand:'L\'Occitane'}` → null.
  - `'showBrand=false và biến thể không khe thì không giữ khe'`: `showBrand:false` → `brandLine` null, `brandSlot` false; `rail-sm` → `brandSlot` false.
- [ ] **Step 2:** `cd packages/app-core && npx vitest run src/commerce/product-card-view.spec.ts` → FAIL (brandSlot undefined, brandLine còn là chuỗi).
- [ ] **Step 3: implement** trong `product-card-view.ts`: hàm không export `carriesBrand(name: string, brand: string): boolean` (gấp dấu `NFD`, bỏ `̀-ͯ`, `đĐ`→`d`, thường, gộp khoảng trắng; thương hiệu rỗng sau gấp → false; khớp bằng `RegExp` với thương hiệu thoát ký tự đặc biệt, biên là đầu/cuối chuỗi hoặc ký tự không phải `[a-z0-9]`); thêm `brandSlot` vào type và vào giá trị trả về; `brandLine` dùng `carriesBrand`.
- [ ] **Step 4:** chạy lại spec → PASS; `npx vitest run src/commerce` → PASS.
- [ ] **Step 5:** commit `feat(app-core): ẩn dòng thương hiệu thẻ khi tên đã chứa thương hiệu, giữ khe (G5 #6)`.

## Task 2: `ProductTile` giữ khe thương hiệu (P2 #6)

**Files:** Modify `apps/miniapp/src/components/ui/product-tile.tsx:103`, `apps/web/src/components/mini/product-tile.tsx:104`; Test hai `product-tile.spec.tsx`.

**Interfaces:** Consumes: `ProductCardView.brandSlot` (Task 1). Produces: khi `brandSlot` true và `brandLine` null (grid, rail-md): có `[data-ds-part="brand"]` rỗng cao 16px và `body.minHeight === tileBodyHeight(variant, { brand: true })px`.

- [ ] **Step 1: test đỏ** (cả hai spec), cạnh ca `showBrand=false`: `'tên chứa thương hiệu: không in chữ nhưng giữ khe, chiều cao thân bằng thẻ có thương hiệu'`: `viewOf({ name: 'Serum Bã Trầu Tubu', brand: 'Tubu' })` → `part(brand).textContent === ''`, `style.height === '16px'`, `minHeight` bằng `tileBodyHeight('grid', { brand: true })`.
- [ ] **Step 2:** chạy hai spec → FAIL (không có phần tử brand).
- [ ] **Step 3: implement** `const brandSlot = view.brandSlot ?? view.brandLine !== null;` rồi `hasBrand = brandSlot && (variant === 'grid' || variant === 'rail-md')`; phần vẽ giữ nguyên (`{view.brandLine}` null thì rỗng). Không đụng gì khác trong file (G4 sửa khối ghi chú Giờ vàng).
- [ ] **Step 4:** vitest `src/components/ui/product-tile.spec.tsx` (Mini) và `src/components/mini/product-tile.spec.tsx` (web) → PASS.
- [ ] **Step 5:** commit `fix(miniapp,web): thẻ giữ khe dòng thương hiệu khi tên đã chứa thương hiệu (G5 #6)`.

## Task 3: `NumberedPager` bỏ "Trang sau" nhìn thấy ở điện thoại (P2 #1)

**Files:** Modify `apps/web/src/components/catalog/numbered-pager.tsx:32`; Create `numbered-pager.spec.tsx`.

**Interfaces:** Produces: khối liên kết trước/sau có lớp `sr-only focus-within:not-sr-only md:not-sr-only lg:hidden` (cùng `flex flex-wrap items-center justify-center gap-3` cũ); dãy số `hidden lg:flex` giữ nguyên.

- [ ] **Step 1: test đỏ** `numbered-pager.spec.tsx`: (a) `startPage=1, hasNext=true`: có `a[rel="next"][href=hrefFor(lastPage+1)]` chữ "Trang sau"; khối chứa nó có lớp `sr-only`, `focus-within:not-sr-only`, `md:not-sr-only`, `lg:hidden`; (b) `startPage=2`: có `a[rel="prev"]`; (c) `startPage=1, hasNext=false` → render rỗng; (d) dãy số `ol` có `aria-current="page"` đúng trang.
- [ ] **Step 2:** `cd apps/web && npx vitest run src/components/catalog/numbered-pager.spec.tsx` → FAIL (a, b thiếu lớp).
- [ ] **Step 3:** sửa chuỗi lớp; cập nhật comment đầu hàm (điện thoại không hiện nhìn thấy, giữ cho crawler).
- [ ] **Step 4:** vitest `numbered-pager.spec.tsx`, `src/app/ban-chay`, `src/components/catalog` → PASS.
- [ ] **Step 5:** commit `fix(web): liên kết Trang trước/sau thành sr-only ở điện thoại, giống Mini (G5 #1)`.

## Task 4: `RailArrows` ẩn nút hết đường (P2 #8)

**Files:** Modify `apps/web/src/components/scroll-rail.tsx`; Test `scroll-rail.spec.tsx`.

**Interfaces:** Produces: `ARROW` thay `aria-disabled:opacity-40` bằng `aria-disabled:pointer-events-none aria-disabled:opacity-0 aria-disabled:focus-visible:opacity-40`; ngữ nghĩa `aria-disabled`, nhãn, `hasPrev/hasNext` không đổi.

- [ ] **Step 1: test đỏ**: sửa ca "hàng tràn ở đầu" thêm: nút trước có lớp `aria-disabled:opacity-0` và `aria-disabled:pointer-events-none`, `aria-disabled:focus-visible:opacity-40`, còn `aria-disabled:opacity-40` không còn; ca mới `'cuộn tới cuối: nút tiếp aria-disabled, nút trước bật'`: đặt `scrollLeft` của `ul` bằng 600 (`scrollWidth` 1000, `clientWidth` 400), phát `scroll` trong `act` → `next.getAttribute('aria-disabled') === 'true'`, `prev` `'false'`.
- [ ] **Step 2:** vitest `src/components/scroll-rail.spec.tsx` → FAIL.
- [ ] **Step 3:** sửa hằng `ARROW`; cập nhật comment ("hết đường thì ẩn, hiện mờ lại khi focus bàn phím").
- [ ] **Step 4:** vitest `scroll-rail.spec.tsx` và `src/components/mini/scroll-row.spec.tsx` → PASS.
- [ ] **Step 5:** commit `fix(web): mũi tên cuộn ẩn khi đầu/cuối kệ, hiện mờ khi focus bàn phím (G5 #8)`.

## Task 5: Danh mục Trang chủ quá 10 ô: cột 6 ló, "Xem tất cả", arrows (P2 #2)

**Files:** Modify `packages/app-core/src/home-layout.ts` (cạnh `CATEGORY_GRID_MAX_CELLS`), `apps/miniapp/src/components/home/category-row.tsx`, `apps/web/src/components/home/category-row.tsx`; Test `packages/app-core/src/home-layout.spec.ts`, hai `category-row.spec.tsx`.

**Interfaces:** Produces: `export const CATEGORY_SCROLL_COLUMNS = 5.5;` `export function categoryGridScrolls(cells: number): boolean` (`cells > CATEGORY_GRID_MAX_CELLS`). `COLUMN_FLOW.gridAutoColumns = \`calc(100% / ${CATEGORY_SCROLL_COLUMNS})\``; `SectionHeader action={scrolls && onSeeAll ? { onPress: onSeeAll } : undefined}`; web `ScrollRow arrows`.

- [ ] **Step 1: test đỏ** `home-layout.spec.ts`: `categoryGridScrolls(10) === false`, `categoryGridScrolls(11) === true`, `CATEGORY_SCROLL_COLUMNS === 5.5`. Hai `category-row.spec.tsx`: đổi khẳng định `gridAutoColumns` quá 10 ô từ `'20%'` thành `'calc(100% / 5.5)'`; ca mới: 12 danh mục → có nút `Xem tất cả Danh mục` trong `section-header`, bấm gọi `onSeeAll`; 3 danh mục và 9 danh mục → không có nút đó; 12 danh mục nhưng không truyền `onSeeAll` → không có nút. Web thêm: 12 danh mục → có `button[aria-label="Xem các mục tiếp"]` (arrows) khi hàng tràn.
- [ ] **Step 2:** `cd packages/app-core && npx vitest run src/home-layout.spec.ts`; Mini `npx vitest run src/components/home/category-row.spec.tsx`; web `npx vitest run src/components/home/category-row.spec.tsx` → FAIL.
- [ ] **Step 3: implement** theo Interfaces; dùng `categoryGridScrolls(cells)` thay phép so `cells <= MAX_SKELETON_CELLS` ở chỗ chọn `flow`; sửa comment đầu hàm ("cột thứ 6 thò nửa cột"). Web: jsdom không có kích thước nên ca arrows giả `scrollWidth/clientWidth` như `scroll-rail.spec.tsx`.
- [ ] **Step 4:** ba spec trên → PASS; `npx vitest run src/components/home` (Mini và web) → PASS.
- [ ] **Step 5:** commit `feat(app-core,miniapp,web): lưới danh mục Trang chủ cuộn có Xem tất cả ở tiêu đề, cột 6 ló nửa cột, arrows web (G5 #2)`.

## Task 6: Hub Danh mục quá 8 gốc, hub lg không lặp tiêu đề (P2 #2, #9)

**Files:** Modify `packages/app-core/src/browse/hub.ts`, `apps/miniapp/src/components/catalog/category-tiles.tsx`, `apps/web/src/components/catalog/category-tiles.tsx`; Test `hub.spec.ts`, hai `category-tiles.spec.tsx`.

**Interfaces:** Produces: `export function hubHasMoreCategories(count: number): boolean` (`count > HUB_CATEGORY_MAX`). Cả hai `CategoryTiles`: `SectionHeader action={hubHasMoreCategories(entries.length) ? { onPress: onSelectAll } : undefined}`; web bọc `SectionHeader` trong `<div className="lg:hidden">`.

- [ ] **Step 1: test đỏ** `hub.spec.ts`: `hubHasMoreCategories(8) === false`, `(9) === true`, `(0) === false`. Hai `category-tiles.spec.tsx`: 10 gốc → có nút `Xem tất cả Danh mục`, bấm gọi `onSelectAll`; 8 gốc → không có; đang tải → không có; web: tiêu đề h2 nằm trong phần tử có lớp `lg:hidden`, `Section` vẫn có `aria-label="Danh mục"`.
- [ ] **Step 2:** chạy ba spec → FAIL.
- [ ] **Step 3: implement** theo Interfaces; Mini giữ `<div style={{ padding: '0 16px' }}>`.
- [ ] **Step 4:** ba spec và `browse-hub.spec.tsx` hai app → PASS (nhớ ca `getByRole('button', { name: 'Tất cả' })` của hub không đụng nút mới: ≤8 gốc không có nút).
- [ ] **Step 5:** commit `feat(app-core,miniapp,web): hub Danh mục có Xem tất cả khi quá 8 gốc, hub web lg bỏ tiêu đề lặp h1 (G5 #2, #9)`.

## Task 7: Vùng dính Bán chạy nhất và ảnh chiến dịch web (P2 #10, #21)

**Files:** Modify `apps/web/src/app/ban-chay/best-sellers-view.tsx:120`, `apps/web/src/components/campaign/campaign-body.tsx:72`; Test `best-sellers-view.spec.tsx`, `campaign-body.spec.tsx` (tạo nếu chưa có).

**Interfaces:** Produces: vùng dính `md:-mx-6 md:px-6` thay `md:mx-0 md:px-0`; ảnh chiến dịch `md:max-w-3xl md:mx-auto`, bỏ `md:max-h-80`, giữ `aspectRatio: var(--banner-ratio)`.

- [ ] **Step 1: test đỏ**: spec Bán chạy nhất: phần tử `.sticky-below-back` có lớp `md:-mx-6`, `md:px-6`, không có `md:mx-0`; spec chiến dịch: `img` có lớp `md:max-w-3xl`, `md:mx-auto`, không có `md:max-h-80`, `style.aspectRatio === 'var(--banner-ratio)'`.
- [ ] **Step 2:** vitest hai file → FAIL.
- [ ] **Step 3:** sửa chuỗi lớp; cập nhật comment cho `md:-mx-6` (phủ bóng thẻ cuộn bên dưới; bằng `px-6` của `PAGE_WIDE`).
- [ ] **Step 4:** vitest `src/app/ban-chay` và `src/components/campaign` → PASS.
- [ ] **Step 5:** commit `fix(web): vùng dính Bán chạy nhất phủ bóng thẻ, ảnh chiến dịch giữ 5/2 bằng trần bề rộng (G5 #10, #21)`.

## Task 8: `DESIGN.md` ghi hai lệch có chủ đích (P2 #22, #38)

**Files:** Modify `DESIGN.md` (bảng Token, mục Khuôn trang web máy tính, Nhật ký quyết định); Test `packages/app-core/src/design-docs.spec.ts` (không sửa, phải xanh).

- [ ] **Step 1:** dòng `--color-flash-solid-bg, --color-flash-solid-fg` ở bảng Token: thêm nút "Mua ngay" của trang Giờ vàng (`apps/miniapp/src/components/ui/button.tsx`, biến thể Giờ vàng) vào danh sách được dùng, ghi là chủ ý (nền cam đặc nhận ra ngay là nút của đợt Giờ vàng, cặp màu đã có trong `contrast.spec.ts`).
- [ ] **Step 2:** thêm đoạn "Lệch có chủ đích giữa web 375px và Mini" vào mục Khuôn trang web máy tính: chân trang web (Hotline, Điều khoản, Bảo mật, Đổi trả, Vận chuyển) vẫn hiện ở 375px còn Mini không có, vì web là trang công khai cần liên kết pháp lý; đo `ds-parity` chỉ so thành phần trong thân trang.
- [ ] **Step 3:** hai dòng vào Nhật ký quyết định (2026-11-02: G5 #22, #38; và dòng "liên kết Trang trước/sau sr-only ở điện thoại").
- [ ] **Step 4:** `cd packages/app-core && npx vitest run src/design-docs.spec.ts` → PASS (mọi đường dẫn trong dấu huyền phải tồn tại).
- [ ] **Step 5:** commit `docs(design): ghi nút Mua ngay Giờ vàng và chân trang web 375 là lệch có chủ đích (G5 #22, #38)`.

## Task 9: e2e Mini, ratchet, chụp so, gate

**Files:** Create `apps/e2e/tests/browse-misc.miniapp.spec.ts`; Modify `scripts/uiux/ds-baseline.json` nếu số hạ.

- [ ] **Step 1: e2e Mini (mock toàn bộ API, 375×812)**: (a) Trang chủ 10 danh mục gốc: có nút `Xem tất cả Danh mục` ở tiêu đề; ô "Tất cả danh mục" ló nửa cột (`left` trong khoảng 300–360 và `right` > 375) và bấm nút tiêu đề mở `/browse`; 9 gốc không có nút; (b) hub 10 gốc: nút `Xem tất cả` ở tiêu đề khối Danh mục và bấm vào dẫn tới `?all=1`, 8 gốc không có; (c) `/browse?all=1`: thẻ NRC (tên chứa "Tubu") và thẻ BINH_SUA cùng hàng có `y` của tên lệch ≤1px và đáy giá lệch ≤1px.
- [ ] **Step 2:** chạy trước khi sửa code (git stash không dùng: chạy ở commit Task 5/6 trở về trước bằng cách tạo spec sau; chứng minh đỏ bằng `git log` thứ tự commit), rồi `cd apps/e2e && E2E_SCOPE=miniapp E2E_MINIAPP_PORT=3397 npx playwright test tests/browse-misc.miniapp.spec.ts tests/browse-hub.miniapp.spec.ts tests/tile-rhythm.miniapp.spec.ts tests/home-p6.miniapp.spec.ts --workers=1 --reporter=line` → PASS.
- [ ] **Step 3:** `pnpm lint:parity`; nếu số `px`/`max-md` hạ thì `node scripts/uiux/ds-ratchet.mjs --write`, kiểm `git diff scripts/uiux/ds-baseline.json` chỉ giảm, commit.
- [ ] **Step 4:** chụp "sau" mini375/web375/web1280 các màn đụng (Trang chủ danh mục, hub, lưới thẻ, Bán chạy nhất, chiến dịch) vào `docs/2026-10-31-shop-redesign/screens/G5/after/` (gitignore; ảnh trước đã ở `before/`) bằng hai spec chụp tạm `apps/e2e/tests/zz-g5-shots.*.spec.ts` (không commit; xoá khi xong) với API giả ở scratchpad và `next dev`; đo hộp: vùng dính phủ ≥6px mỗi bên mép lưới, ảnh chiến dịch tỉ lệ 2,5; tắt server của mình.
- [ ] **Step 5:** web-gate (cần Docker): `E2E_API_PORT=3398 E2E_WEB_PORT=3399 E2E_MINIAPP_PORT=3400 bash apps/e2e/scripts/web-gate.sh tests/a11y-shop.web.spec.ts tests/tiles-scroll.web.spec.ts tests/home-merged.web.spec.ts`; Mini a11y/ds-parity: `tests/a11y-shop.miniapp.spec.ts tests/ds-parity.shop.spec.ts`.
- [ ] **Step 6:** gate đúng một lần: `bash docs/2026-10-28-review/tools/gate.sh <worktree> --base cca490dbc --out .../gate-G5.txt`, rồi bộ e2e Mini đầy đủ (`--workers=2`). Bước FAIL: đỏ cả ở base thì "có sẵn".
- [ ] **Step 7:** ghi mục "Điều chỉnh lúc làm" cuối file này; commit.
