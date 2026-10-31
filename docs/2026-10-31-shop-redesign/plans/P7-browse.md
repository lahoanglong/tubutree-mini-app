# P7 `browse` Implementation Plan

> **Cho agent làm:** BẮT BUỘC dùng superpowers:subagent-driven-development hoặc superpowers:executing-plans. Bước dùng checkbox `- [ ]`.

**Mục tiêu:** `/browse` (web `/san-pham`) thành hub không lưới ở gốc (danh mục tầng 1, Đã xem, Bán chạy nhất 10, logo thương hiệu, nút "Xem tất cả sản phẩm") và chế độ danh sách (SortBar dính, chip danh mục tầng 2, tiêu đề một lần + số SP caption, 20 món/trang) ở Mini App và web; web lg có `ListingLayout` (h1 + breadcrumb, cột lọc 200px cuộn theo trang, phân trang số) và nút "Xem thêm" không mất focus.

**Kiến trúc:** quyết định chế độ (hub/danh sách), cây danh mục, tab sắp xếp, trần/sàn của hub nằm ở `packages/app-core/src/browse/` (một nguồn cho hai app); Mini App và web chỉ vẽ. Chế độ do URL quyết: gốc không tham số = hub; `?all=1` (nút "Xem tất cả sản phẩm"), `sort`, `q`, `category`, `segment`, bộ lọc hoặc `page>1` = danh sách. Hub không gọi `fetchCatalog`; kệ Bán chạy nhất dùng `fetchBestSellers` (`sort=best_seller_30d`, lùi về `best_seller` khi API cũ 400).

**Tech stack:** TypeScript, React 18 (Mini: zmp-ui + inline style + token CSS; web: Next 15 + Tailwind + inline style), vitest + testing-library, Playwright (`E2E_SCOPE=miniapp`, mock API).

**Spec:** `docs/2026-10-31-shop-redesign/01-thiet-ke.md` (§4 Q1, Q5, Q13 là luật; §5 "Danh mục `/browse`"); chữ ký ở `02-ke-hoach.md` "Giao diện dùng chung" và mục P7. Nguồn: `review/ia-merch.md` C2; `review/critique-shop.md` 4.2 (BR-01, BR-02, sơ đồ C/D); `review/web.md` D-03, D-04, D-05, W-12; `review/ux-copy.md` UC-05, UC-22. Bàn giao: `plans/handoff-wave1.md`, `plans/handoff-wave2.md`.

## Global Constraints

- Node: `export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH` cho mọi lệnh. Worktree mới: `pnpm --filter @tubutree/shared-types build` và `cd apps/api && npx prisma generate` trước gate.
- Giữ đúng tên/props đã chốt: `SortBar {value, options, onChange, filterCount?, onFilter?, sticky?}`, `SectionHeader {title, id?, icon?, tone?, trailing?, action?}`, `Section {id, spacing?, label?}`, `ProductRail {items, variant, rankFrom?, label}`, `ProductCard`. Thêm prop optional được; không đổi cái đã chốt.
- Chữ theo Q5: "Bán chạy nhất", "Thương hiệu", không "Top", "Nhãn hàng", "Voucher", "cửa hàng"; mọi chữ mới thêm vào `SHOP_COPY` **và** `SHOP_COPY_MAX` (shop-copy.spec bắt thiếu một bên).
- Tiêu đề khối Inter 16/700 (`SectionHeader`); Fraunces chỉ tiêu đề trang. Vùng chạm ≥44px, tương phản ≥4,5:1, axe 0 vi phạm ở 375px.
- Chip md nhìn 36px, vùng chạm 44px: e2e đo bằng `apps/e2e/tests/support/hit-area.ts`, không đòi chiều cao thật 44.
- Entry Mini ≤700 KB (`node scripts/ci/bundle-budget.cjs apps/miniapp/www`): `/browse` là chunk lười nên code mới ở đó không đụng entry; không import `shop-copy` vào đường nạp gói đầu.
- Danh mục: API trả cây (`children`) và `?flat=1` cho danh sách phẳng; PROD chưa có cây (mọi danh mục là gốc, hoặc rỗng): hub vẫn đẹp, rơi về 4 phân khúc/thương hiệu, có test.
- KHÔNG sửa file của P6/P8/P9 (home*, product-detail*, cart*, storefront-view, brand-view, `store-page-shell`, `components/shop/*`, `layouts/{hub,pdp,store}-layout`, catalog controller/service API, `merch/shelves.ts`, `api/catalog.ts`); buộc phải đụng thì ghi vào notes. `shop-copy.ts`, `shop-copy-budget.ts`, `route-map.json`, `vi.ts` chỉ thêm khoá.
- Comment chỉ giải thích "vì sao" không hiển nhiên, tiếng Việt, mật độ như file quanh đó. Không `git stash` trần, không push, không PROD. Máy thiếu RAM: chạy vitest theo file, gate đầy đủ đúng một lần ở cuối.

## Review Focus

1. Cây danh mục rỗng/phẳng/`children` thiếu (API cũ): hub dựng 4 phân khúc hoặc các danh mục gốc, không ô trắng, không lỗi. Test ở T4 (hub) và T1 (`category-tree`).
2. Vào link cũ (`?segment=`, `?brand=`, `?sort=best_seller`, `?inStock=1`, `?utm_source=`) hoặc `?page=2` ở gốc: ra danh sách, không bao giờ rơi nhầm vào hub; `?utm_source` một mình vẫn là hub. Test ở T2.
3. Gỡ chip cuối cùng, đổi sắp xếp về "Phổ biến", "Xoá tìm kiếm & bộ lọc" khi đang ở danh sách: ở lại danh sách (`all=1`), không nhảy về hub. Test ở T2 (`withListMode`) và T5.
4. Kệ Bán chạy nhất lỗi/rỗng/dưới 3 món, thương hiệu dưới 4, chưa xem gì: khối ẩn, hub không còn tiêu đề trơ, nút "Xem tất cả sản phẩm" vẫn có. Test ở T4.
5. Quay lại từ PDP khôi phục vị trí cuộn của cả hub và danh sách; "Xem thêm" ở web không làm mất focus (aria-disabled, focus vào thẻ đầu trang mới). Test ở T5 (e2e có sẵn) và T8.

---

## File Structure

| File | Việc |
|---|---|
| `packages/app-core/src/browse/{mode,category-tree,sort,hub}.ts` + `.spec.ts` | chế độ hub/danh sách, cây danh mục, tab sắp xếp, trần/sàn hub |
| `packages/app-core/src/api/browse.ts` + `.spec.ts` | `fetchBestSellers` |
| `packages/app-core/src/queries/browse.ts` | `bestSellersQuery` |
| `packages/app-core/src/shop-copy.ts`, `shop-copy-budget.ts` | khoá `sort.*`, `browse.*` |
| `apps/miniapp/src/utils/search-state.ts` (+spec) | tham số `all`, `PAGE_LIMIT` 20, bỏ chip danh mục khi tiêu đề đã nêu |
| `apps/miniapp/src/components/catalog/{category-tiles,brand-grid,browse-hub,list-heading,category-chip-row,active-filters}.tsx` | thành phần hub + danh sách |
| `apps/miniapp/src/components/catalog/recently-viewed-rail.tsx` | dùng `SectionHeader` |
| `apps/miniapp/src/components/catalog/{sort-chips,result-header,category-chips}.tsx` | xoá |
| `apps/miniapp/src/pages/browse.tsx` | hai chế độ, SortBar dính |
| `apps/web/src/lib/search-state.ts`, `home-seo.ts` | `all`, `PAGE_LIMIT` 20, `all` noindex |
| `apps/web/src/components/layouts/listing-layout.tsx` | khuôn lg của P7 |
| `apps/web/src/components/catalog/*` | hub, danh sách, cột lọc 200, pager số, focus |
| `apps/web/src/app/san-pham/page.tsx` | gốc không gọi `fetchCatalog` |
| `apps/e2e/tests/{buy-flow-4b-browse,buy-flow-4b,browse-defaults,tile-rhythm}.miniapp.spec.ts`, `support/discovery-mocks.ts` | sửa theo thiết kế mới |
| `apps/e2e/tests/browse-hub.miniapp.spec.ts` | hub, cây rỗng/phẳng, thẻ đầu y ≤ 200 |

Lệnh kiểm một file: `cd packages/app-core && npx vitest run src/<đường dẫn>.spec.ts`; `cd apps/miniapp && npx vitest run src/<đường dẫn>`; `cd apps/web && npx vitest run src/<đường dẫn>`.

## Điều chỉnh đã chốt trước khi làm (lệch kế hoạch chung, có lý do)

- `/brands` của API chưa trả `logoUrl` (sửa cần `catalog.service.ts` thuộc P6). Hub đọc `logoUrl?` nếu có, không thì hiện chữ cái đầu (`InitialsAvatar`). Ghi vào notes cho việc API nhỏ sau.
- "Xem tất cả" của kệ Bán chạy nhất ở hub trỏ `/browse?sort=best_seller` (route `/best-sellers` chưa có tới P13); P13 đổi sang `shelf('browse.bestSellers').seeAllRoute`.
- Nhãn tab giá: "Giá ⇅" khi chưa chọn, "Giá thấp" / "Giá cao" khi đang chọn (ux-copy UC-05), tên đọc đầy đủ chiều xếp. Tab sắp xếp "Bán chạy" giữ `sort=best_seller` (tổng bán, khớp "Đã bán" trên thẻ); kệ hub dùng 30 ngày.
- Chip danh mục tầng 2: con của danh mục đang xem (kèm "Tất cả" chọn cha); đang ở lá thì chip anh em. Danh mục gốc không có con thì không có hàng chip (quay lại hub bằng Back: chạm ô ở hub là PUSH). Tên danh mục/phân khúc hiện đúng một lần (tiêu đề), nên bỏ chip lọc của chúng khi không có `q`.

---

### Task 1: app-core `browse/` + `fetchBestSellers` + chữ

**Files:**
- Create: `packages/app-core/src/browse/{mode,category-tree,sort,hub}.ts` + `.spec.ts` mỗi file; `packages/app-core/src/api/browse.ts` + `browse.spec.ts`; `packages/app-core/src/queries/browse.ts`
- Modify: `packages/app-core/src/shop-copy.ts`, `shop-copy-budget.ts`

**Interfaces:**
- Produces:
  - `mode.ts`: `BROWSE_PAGE_LIMIT = 20`; `interface BrowseModeInput { q: string; category?: string; segment?: string; sort?: string; all?: boolean; brands: string[]; minPrice?: number; maxPrice?: number; inStock: boolean; minRating?: number }`; `type BrowseMode = 'hub' | 'list'`; `browseMode(s: BrowseModeInput): BrowseMode`.
  - `category-tree.ts`: `interface CategoryNode { id: string; parentId: string | null; name: string; slug: string; image: string | null; productCount?: number; children?: CategoryNode[] }`; `findCategory(tree: CategoryNode[] | undefined, id: string): CategoryNode | null`; `categoryTrail(tree, id): CategoryNode[]` (gốc → nút); `chipScope(tree, activeId): { parent: CategoryNode; chips: CategoryNode[] } | null`.
  - `sort.ts`: `type SortTab = 'default' | 'best_seller' | 'newest' | 'price'`; `sortTab(sort?: CatalogSort): SortTab`; `sortForTab(current: CatalogSort | undefined, tab: SortTab): CatalogSort | undefined`; `browseSortOptions(sort: CatalogSort | undefined, hasQuery: boolean): { value: SortTab; label: string; spoken?: string }[]`.
  - `hub.ts`: `HUB_CATEGORY_MAX = 8`, `HUB_BRAND_MAX = 12`, `HUB_BRAND_MIN = 4`; `hubBrands<T extends { brand: string; count: number }>(list: T[] | undefined): T[]`; `hubBestSellers<T extends { id: string }>(items: T[] | undefined): T[]` (qua `applyShelfDedupe` với `browse.bestSellers`: cắt 10, dưới 3 trả `[]`).
  - `api/browse.ts`: `fetchBestSellers(http: HttpClient, limit?: number): Promise<ProductCard[]>` (mặc định 10); `queries/browse.ts`: `bestSellersQuery(http, limit = 10)` khoá `['products','best-sellers',limit]`.
  - Khoá chữ: `sort.default` Phổ biến, `sort.relevant` Liên quan, `sort.bestSeller` Bán chạy, `sort.newest` Mới, `sort.price` "Giá ⇅", `sort.priceAsc` "Giá thấp", `sort.priceDesc` "Giá cao", `sort.priceSpoken` "Giá, chạm để xếp từ thấp đến cao", `sort.priceAscSpoken` "Giá từ thấp đến cao, chạm để đổi chiều", `sort.priceDescSpoken` "Giá từ cao đến thấp, chạm để đổi chiều"; `browse.categories` Danh mục, `browse.all` Tất cả, `browse.seeAllProducts` "Xem tất cả sản phẩm", `browse.brands` Thương hiệu, `browse.brandSpoken` "Xem thương hiệu {name}", `browse.chipsLabel` "Danh mục con", `browse.pageLabel` "Phân trang", `browse.pageN` "Trang {n}", `browse.prevPage` "Trang trước", `browse.nextPage` "Trang sau", `browse.crumbHome` "Trang chủ", `browse.allTitle` "Tất cả sản phẩm", `browse.resultsFor` `Kết quả cho "{q}"`.

- [ ] **Step 1: test đỏ** (một spec mỗi file):
  - `mode.spec`: `browseMode({q:'',brands:[],inStock:false})==='hub'`; mỗi một trong `q:'x'`, `category`, `segment`, `sort:'newest'`, `all:true`, `brands:['A']`, `minPrice:1`, `maxPrice:1`, `inStock:true`, `minRating:4` cho `'list'`.
  - `category-tree.spec`: `findCategory` tìm cả nút con; `categoryTrail(tree,'con')` = `[cha, con]`, id lạ = `[]`; `chipScope`: nút gốc có con → `{parent:gốc, chips:con}`; nút lá có cha → `{parent:cha, chips: anh em gồm chính nó}`; gốc không con → `null`; id lạ / `tree` undefined → `null`; con `productCount===0` bị ẩn trừ khi là nút đang xem; vòng `parentId` không treo.
  - `sort.spec`: `sortTab('price_desc')==='price'`, `sortTab('best_seller_30d')==='best_seller'`, `sortTab(undefined)==='default'`; `sortForTab(undefined,'price')==='price_asc'`, `('price_asc','price')==='price_desc'`, `('price_desc','price')==='price_asc'`, `('newest','default')===undefined`; `browseSortOptions(undefined,false).map(o=>o.label)` = `['Phổ biến','Bán chạy','Mới','Giá ⇅']`, `hasQuery` đổi nhãn đầu thành `Liên quan`; `price_asc` → nhãn `Giá thấp`, `price_desc` → `Giá cao`, tên đọc nêu chiều xếp.
  - `hub.spec`: `hubBrands` sắp theo `count` giảm rồi tên, cắt 12, dưới 4 nhãn trả `[]`, undefined trả `[]`; `hubBestSellers` 12 món → 10; 2 món → `[]`; trùng id chỉ một.
  - `api/browse.spec`: `fetchBestSellers` gọi `GET /products` query `{ sort:'best_seller_30d', limit:10 }` và trả `data`; 400 từ API cũ → gọi lại với `sort:'best_seller'`; lỗi 500 ném tiếp.
- [ ] **Step 2:** `cd packages/app-core && npx vitest run src/browse src/api/browse.spec.ts` → FAIL (module chưa có).
- [ ] **Step 3: cài đặt** theo Interfaces; `chipScope` dùng `Set` đã thăm; `fetchBestSellers` dùng `errorStatus` (`api/error-status`) như `fetchCatalog`; chữ thêm vào `SHOP_COPY` và `SHOP_COPY_MAX` (ngân sách: nhãn tab ≤10, `sort.*Spoken` null, câu dài null).
- [ ] **Step 4:** chạy lại các spec trên + `src/shop-copy.spec.ts` + `src/merch/shelves.spec.ts` → PASS.
- [ ] **Step 5: Commit** `feat(app-core): logic hub/danh sách của Danh mục, cây danh mục, tab sắp xếp, kệ Bán chạy nhất`.

### Task 2: Mini `search-state` có chế độ hub

**Files:** Modify `apps/miniapp/src/utils/search-state.ts`, `search-state.spec.ts`, `apps/miniapp/src/hooks/use-search-state.spec.tsx` (chỉ nếu đỏ)

**Interfaces:**
- Consumes: `browseMode` (T1).
- Produces: `SearchState.all?: boolean`; `isBrowseHub(s: SearchState): boolean`; `withListMode(patch: Partial<SearchState>): Partial<SearchState>` (= `{...patch, all: true}`); `PAGE_LIMIT = 20` (chuyển ra đây, `browse.tsx` import); `activeFilterChips(s, names, opts?: { omitScope?: boolean })` bỏ chip `category`/`segment` khi `omitScope`; `SEARCH_PARAM_KEYS` thêm `'all'`; `CLEAR_SEARCH_PATCH` thêm `all: true`.

- [ ] **Step 1: test đỏ** (`search-state.spec.ts`): parse `all=1` → `all:true`, `all=0|rỗng` → falsy; serialize `{all:true}` đơn lẻ → `all=1`; `{all:true, sort:'newest'}` → chỉ `sort=newest` (một trạng thái một URL); `{all:true, category:'c'}` → chỉ `category=c`; `isBrowseHub(EMPTY_SEARCH_STATE)===true`, `isBrowseHub(parse('utm_source=zalo'))===true` (tham số lạ không đổi chế độ), `isBrowseHub(parse('sort=best_seller'))===false`, `?segment=eco`, `?brand=Tubu`, `?inStock=1`, `?all=1` đều `false`; `withListMode({sort: undefined})` từ `?sort=newest` ghi lại ra `all=1`; `activeFilterChips(..., {omitScope:true})` không có chip `category`/`segment` nhưng còn chip nhãn/giá.
- [ ] **Step 2:** `cd apps/miniapp && npx vitest run src/utils/search-state.spec.ts` → FAIL.
- [ ] **Step 3: cài đặt** (`isBrowseHub` = `browseMode(s)==='hub'`; `serializeSearchState` chỉ ghi `all=1` khi `s.all && browseMode({...s, all:false})==='hub'`).
- [ ] **Step 4:** chạy lại spec + `src/hooks/use-search-state.spec.tsx` → PASS.
- [ ] **Step 5: Commit** `feat(miniapp): trạng thái Danh mục có chế độ hub (tham số all)`.

### Task 3: Mini thành phần danh sách (heading, chip tầng 2, chip lọc, tab sắp xếp)

**Files:** Create `components/catalog/{list-heading,category-chip-row,active-filters}.tsx` + spec; Modify `recently-viewed-rail.tsx` (+spec); Delete `sort-chips.tsx`, `result-header.tsx`, `category-chips.tsx`; sửa `catalog-controls.spec.tsx`.

**Interfaces:**
- Produces:
  - `ListHeading({ title, count, isLoading }: { title: string | null; count: number | undefined; isLoading: boolean })`: một hàng cao ~28px; `title` là `<h2>` `Heading title-sm` một dòng (ellipsis); caption `data-testid="result-count"` `aria-live="polite" aria-atomic`, chữ `vi.browse.resultCount(n)`; khi `isLoading` hoặc `count===undefined` caption là khoảng trắng không ngắt (giữ chiều cao, không in "0 sản phẩm").
  - `CategoryChipRow({ parent, chips, activeId, onSelect }: { parent: CategoryNode; chips: CategoryNode[]; activeId: string; onSelect(id: string): void })`: `role="group" aria-label={fillCopy('browse.chipsLabel')}`, chip đầu "Tất cả" (chọn khi `activeId===parent.id`, chạm → `onSelect(parent.id)`), rồi một `Chip` mỗi `chips`; chạm chip đang chọn không làm gì; đệm dọc 6px để vùng chạm 44px không bị `.scroll-x` cắt.
  - `ActiveFilters({ chips, filtersIgnored, onPatch }: { chips: ActiveFilterChip[]; filtersIgnored: boolean; onPatch(p: Partial<SearchState>): void })`: phần chip "Đang lọc" + câu `filtersIgnored` của `ResultHeader` cũ (không còn số kết quả, không còn nút Bộ lọc vì đã ở SortBar); không vẽ gì khi cả hai rỗng.
  - `RecentlyViewedRail`: tiêu đề bằng `SectionHeader` (không `action`), dải bọc `Section id="browse-recent"`; giữ nguyên dữ liệu/giá hiện hành, cắt `shelf('browse.recent').maxItems` (10).

- [ ] **Step 1: test đỏ:** `list-heading.spec` (có title: h2 + caption "21 sản phẩm"; `title=null` chỉ còn caption; `isLoading` caption không chứa số; `count=0` in "0 sản phẩm"); `category-chip-row.spec` (chip "Tất cả" `aria-pressed` khi `activeId` là cha; chạm con gọi `onSelect(id)`; chạm chip đang chọn không gọi); `active-filters.spec` (chạm chip gọi `onPatch(c.patch)`, nhãn "Bỏ lọc X", không vẽ khi rỗng, in câu filtersIgnored); `recently-viewed-rail.spec` cập nhật: tiêu đề là `h2` trong `section-header`, 12 món đã xem chỉ hiện 10; `catalog-controls.spec` bỏ ca SortChips/ResultHeader, giữ ca còn dùng.
- [ ] **Step 2:** chạy các spec → FAIL.
- [ ] **Step 3: cài đặt** theo Interfaces; xoá ba file cũ và mọi import của chúng (chỉ `pages/browse.tsx` dùng, sửa ở T5).
- [ ] **Step 4:** chạy lại → PASS (`pages/browse.spec.tsx` đỏ tạm tới T5, ghi rõ trong commit).
- [ ] **Step 5: Commit** `feat(miniapp): ListHeading, CategoryChipRow, ActiveFilters; Đã xem dùng SectionHeader`.

### Task 4: Mini hub (`BrowseHub`)

**Files:** Create `components/catalog/{category-tiles,brand-grid,browse-hub}.tsx` + spec mỗi file.

**Interfaces:**
- Consumes: `hubBrands`, `hubBestSellers`, `HUB_CATEGORY_MAX` (T1); `bestSellersQuery` (T1) với `coreHttp` của `services/core-http`; `CategoryEntry` (`hooks/use-categories`); `RecentlyViewedRail` (T3); `SectionHeader`, `Section`, `ProductRail variant="rank"`.
- Produces:
  - `CategoryTiles({ entries, isLoading, placeholderCount, onSelect(e: CategoryEntry): void, onSelectAll(): void })`: `<section aria-label="Danh mục">` gồm `SectionHeader title="Danh mục"` và lưới 4 cột: tối đa `HUB_CATEGORY_MAX` ô (ảnh/icon 40px trong nền `--color-bg-media`, nhãn 12/600 tối đa 2 dòng) + ô "Tất cả" cuối; mỗi ô `<button>` cao ≥ 88 (vùng chạm đủ), `aria-label` = tên; khi `isLoading` vẽ `placeholderCount + 1` khung chờ cùng cỡ (`data-testid="category-grid-loading"`).
  - `BrandGrid({ brands, onSelect(brand: string): void })`: `hubBrands`, lưới 4 cột tối đa 3 hàng: avatar 48px (`logoUrl` nếu có, không thì `InitialsAvatar`) + tên 1 dòng; rỗng thì `null`; mỗi ô `aria-label={fillCopy('browse.brandSpoken',{name})}`.
  - `BrowseHub({ entries, categoriesLoading, placeholderCount, brands, onPickCategory, onPickAll, onPickBrand, onSeeBestSellers })`: thứ tự `CategoryTiles` → `RecentlyViewedRail` → kệ Bán chạy nhất (`SectionHeader title={fillCopy('rank.title')} action` → `onSeeBestSellers`, `ProductRail variant="rank" rankFrom={1}`, khung chờ 10 thẻ có cùng chiều cao; ẩn hẳn khi `hubBestSellers` rỗng sau khi tải xong hoặc lỗi) → `BrandGrid` (`SectionHeader title="Thương hiệu"`) → nút `Button variant="secondary"` full-width "Xem tất cả sản phẩm" gọi `onPickAll`. Hub KHÔNG gọi `fetchCatalog`.

- [ ] **Step 1: test đỏ:**
  - `category-tiles.spec`: 10 danh mục → 8 ô + "Tất cả"; chạm ô gọi `onSelect(entry)`; "Tất cả" gọi `onSelectAll`; `isLoading` có đúng `placeholderCount+1` khung chờ; danh sách rỗng vẫn có ô "Tất cả"; mọi ô có `minHeight ≥ 44` khai báo.
  - `brand-grid.spec`: 5 nhãn hiện đủ, 3 nhãn trả null, 20 nhãn cắt 12 theo `count`; nhãn có `logoUrl` vẽ `<img alt="">`, không có thì chữ cái đầu.
  - `browse-hub.spec` (mock `../../services/core-http`): API best-sellers trả 10 → rail có 10 thẻ có hạng 1..10; trả 2 → không có tiêu đề "Bán chạy nhất"; lỗi → khối ẩn, nút "Xem tất cả sản phẩm" vẫn còn; `fetchCatalog` không được gọi (mock `services/shop-api` ném khi gọi); `entries` là 4 phân khúc (cây rỗng) vẫn vẽ 4 ô + "Tất cả"; `entries` gốc phẳng 7 ô; chạm "Xem tất cả" của kệ gọi `onSeeBestSellers`; không có chuỗi "Top".
- [ ] **Step 2:** chạy → FAIL.
- [ ] **Step 3: cài đặt** theo Interfaces (số đo token, không px mới ngoài 40/48/88 đã nêu).
- [ ] **Step 4:** chạy lại → PASS.
- [ ] **Step 5: Commit** `feat(miniapp): hub Danh mục (ô danh mục, Bán chạy nhất, logo thương hiệu)`.

### Task 5: Mini `BrowsePage` hai chế độ + sửa vitest

**Files:** Modify `apps/miniapp/src/pages/browse.tsx`, `browse.spec.tsx`

**Interfaces:**
- Consumes: T1–T4. Produces: trang với `data-testid` giữ nguyên (`result-count`, `catalog-grid`, `catalog-grid-skeleton`).

- [ ] **Step 1: test đỏ** (`browse.spec.tsx`, mock thêm `../services/core-http`):
  - gốc `/browse`: có `region Danh mục`, nút "Xem tất cả sản phẩm", KHÔNG có `catalog-grid`, `fetchCatalog` 0 lần (so với bản cũ gọi ngay).
  - chạm "Xem tất cả sản phẩm" → URL `?all=1` (replace), `catalogCalls()[0]` có `limit: 20`, có `group Sắp xếp` và lưới.
  - chạm ô danh mục ở hub → `navigate`/PUSH tới `/browse?category=<id>` (history +1; Back về hub).
  - danh sách: `SortBar` có nhãn `Phổ biến · Bán chạy · Mới · Giá ⇅`; có `q` thì nhãn đầu là `Liên quan`; chạm "Giá ⇅" → `sort=price_asc`, chạm lần nữa → `price_desc`; "Phổ biến" từ `?sort=best_seller` → URL `?all=1` (không về hub); nút "Lọc" mở sheet, "Lọc (2)" khi có 2 loại lọc.
  - `?category=<cha có con>`: tiêu đề h2 là tên cha đúng một lần, caption "n sản phẩm", hàng chip "Tất cả" + con; chạm con → `category=<con>`; không có chip lọc "Bỏ lọc <tên danh mục>"; có `q` + category thì có chip.
  - gỡ chip lọc cuối từ `?brand=Tubu` → URL `?all=1`; "Xoá tìm kiếm & bộ lọc" giữ `sort` (`?sort=newest`) hoặc ra `?all=1`.
  - scroll khôi phục: lưu theo `urlKey` cả hub (khoá rỗng) và danh sách.
  - Cập nhật mọi ca cũ bắt đầu ở `/browse` mong lưới: đổi sang `/browse?all=1`, ghi lý do trong commit.
- [ ] **Step 2:** `cd apps/miniapp && npx vitest run src/pages/browse.spec.tsx` → FAIL.
- [ ] **Step 3: cài đặt** `browse.tsx`: `hub = isBrowseHub(state) && !showSuggest`; hub gọi không `useInfiniteQuery` (đặt `enabled: !hub` để `fetchCatalog` không chạy); `STICKY_SEARCH` đệm `6px 16px` (cao 56px) và đặt `--sort-bar-top: calc(var(--safe-top) + 56px)` trên `Page`; danh sách theo thứ tự `SortBar sticky` (`value={sortTab(state.sort)}`, `onChange={(tab)=>updateList({ sort: sortForTab(state.sort, tab) })}`, `filterCount`, `onFilter`) → `ListHeading` → `CategoryChipRow` (khi `chipScope` có) → `ActiveFilters` (`omitScope: !state.q`) → lưới/lỗi/rỗng; `PAGE_LIMIT` 20 từ `search-state`; mọi `update` trong danh sách đi qua `updateList = (p) => update(withListMode(p))` (trừ xoá `q` và chọn gợi ý); chạm ô ở hub dùng `navigate('/browse?category=…')` (PUSH), `onPickBrand` → `navigate('/browse?brand=…')`, `onPickAll` → `update({ all: true })`; tên danh mục lấy qua `findCategory(categories.categories, state.category)` (tìm cả con); `useScrollRestoration(urlKey, hub ? hubReady : …)`.
- [ ] **Step 4:** chạy lại `browse.spec.tsx`, `src/components/catalog`, `src/utils/search-state.spec.ts` → PASS; `npx tsc --noEmit -p apps/miniapp` sạch.
- [ ] **Step 5: Commit** `feat(miniapp): Danh mục có hub ở gốc và SortBar dính ở danh sách`.

### Task 6: e2e Mini (sửa theo thiết kế mới + hub mới)

**Files:** Modify `apps/e2e/tests/{buy-flow-4b-browse,buy-flow-4b,browse-defaults,tile-rhythm}.miniapp.spec.ts`, `support/discovery-mocks.ts`; Create `apps/e2e/tests/browse-hub.miniapp.spec.ts`

**Interfaces:** `discovery-mocks.ts` thêm `CATEGORY_TREE: CategoryDTO[]` (có `children`: một gốc có 2 con, một gốc lá) và `catalogHandler` hiểu `sort=best_seller_30d` như `best_seller`; export `mockDiscovery(api, { tree?: boolean })` trả cây khi `tree`.

- [ ] **Step 1: sửa/thêm test đỏ:**
  - Ca cũ bắt đầu ở `/browse` mong lưới → `/browse?all=1`; URL mong đợi `?sort=…` giữ, `/browse$` sau khi gỡ chip/Phổ biến → `/browse?all=1`; chip sắp xếp tìm theo `group Sắp xếp` + `button` tên mới (`Giá ⇅`, `Giá thấp`, `Giá cao`; "Gợi ý" → "Phổ biến"); chip `Bỏ lọc <danh mục|phân khúc>` thay bằng kiểm tiêu đề h2; vùng chạm: `expectChipHitArea44` trên chip hàng "Đang lọc" giữ nguyên, hàng sắp xếp kiểm `minHeight` ≥ 44 của tab. Ghi lý do từng thay đổi bằng comment ngắn trong test.
  - `browse-hub.miniapp.spec.ts`: (a) gốc, cây phẳng: `region Danh mục` có ô, nút "Xem tất cả sản phẩm", không có `catalog-grid`, request `/products` duy nhất có `sort=best_seller_30d&limit=10`; (b) cây rỗng (`/categories` trả `[]`) và `legacy: true`: hub vẫn có 4 phân khúc + "Tất cả", không `alert`; (c) API cũ 400 với `best_seller_30d` → kệ vẫn hiện nhờ lùi `best_seller`; (d) `?category=<cha>`: hàng chip con, thẻ đầu `boundingBox().y ≤ 200`; (e) hub → ô danh mục → Back về hub, vị trí cuộn hub khôi phục; (f) vùng chạm ô danh mục ≥ 44 theo `boundingBox`.
- [ ] **Step 2:** dựng Vite Mini cổng 3303 theo `E2E_SCOPE=miniapp E2E_MINIAPP_PORT=3303`; `cd apps/e2e && npx playwright test buy-flow-4b-browse browse-hub browse-defaults tile-rhythm buy-flow-4b --workers=2 --reporter=line` → FAIL ở ca chưa khớp.
- [ ] **Step 3:** sửa mã/mock cho tới khi PASS (đỏ do hồi quy thì sửa mã, đỏ vì thiết kế đã chốt thì sửa test).
- [ ] **Step 4: Commit** `test(e2e): Danh mục hub và danh sách (Mini)`.

### Task 7: web: trạng thái, hub, danh sách (khổ điện thoại giống Mini)

**Files:** Modify `apps/web/src/lib/{search-state,home-seo,use-browse-state}.ts` (+spec), `components/catalog/{browse-view,recently-viewed-rail,filter-sidebar}.tsx` (+spec); Create `components/catalog/{category-tiles,brand-grid,browse-hub,list-heading,category-chip-row,active-filters}.tsx` + spec; Delete `sort-chips.tsx`, `result-header.tsx`; Modify `apps/web/src/app/san-pham/page.tsx` (+spec)

**Interfaces:**
- Consumes: T1 (cùng hàm app-core), thành phần `components/mini` (`SortBar`, `SectionHeader`, `Section`, `ProductRail`, `Chip`).
- Produces: cùng tên/props với Mini ở T3–T4 (nguồn chép: `apps/miniapp/src/components/catalog/<tên>.tsx`); `lib/search-state`: `all`, `isBrowseHub`, `withListMode`, `PAGE_LIMIT = 20`, `activeFilterChips(..., { omitScope })`; `browseNoindex` thêm `all`; `page.tsx`: hub (không `q`, không lọc, `page==1`, không `all`/`sort`) bỏ `fetchCatalog` và tải `fetchBestSellers` cho hub (`initial` danh sách là `null`); danh sách giữ `initial`.

- [ ] **Step 1: test đỏ:** `search-state.spec` (như T2); `category-tiles/brand-grid/browse-hub.spec` (như T4, mock `@/lib/core-http`); `browse-view.spec` đổi ca gốc: hub không gọi `/products` kiểu danh sách (`limit:20`), có `sort=best_seller_30d`; `?all=1` gọi `{page:1,limit:20}`; chip sắp xếp đổi sang `SortBar`; h1 điện thoại chỉ cho trình đọc màn hình, danh mục có tên thì hiện tiêu đề; `page.spec` (gốc không gọi `fetchCatalog`, `?all=1`/`?page=2`/`?q=` gọi); `home-seo.spec` (`?all=1` noindex).
- [ ] **Step 2:** chạy từng spec web → FAIL.
- [ ] **Step 3: cài đặt** (web chép logic bố cục của Mini; `?page>1` ở gốc coi là danh sách: `mode = browseMode({...state, all: state.all || page > 1})`; liên kết `BrowsePager` dựng với `all: true`).
- [ ] **Step 4:** chạy lại các spec trên + `src/components/mini` liên quan → PASS; `npx tsc --noEmit -p apps/web` sạch.
- [ ] **Step 5: Commit** `feat(web): Danh mục có hub ở gốc và SortBar ở danh sách (khổ điện thoại)`.

### Task 8: web lg: `ListingLayout`, breadcrumb, cột lọc 200, phân trang số, "Xem thêm" giữ focus

**Files:** Create `apps/web/src/components/layouts/listing-layout.tsx` + spec; Modify `components/catalog/{browse-view,browse-pager,filter-sidebar}.tsx` (+spec)

**Interfaces:**
- Produces: `ListingLayout({ breadcrumb, title, caption, sidebar, children }: { breadcrumb?: ReactNode; title: ReactNode; caption?: ReactNode; sidebar?: ReactNode; children: ReactNode })`: dưới `lg` trả `children` nguyên con (không cột, `title` chỉ là `h1` ẩn ở dưới md, hiện từ md); từ lg lưới `lg:grid-cols-[200px_minmax(0,1fr)] gap-6` (`aside` là phần tử bình thường, KHÔNG `sticky`/`max-h`/`overflow`); `ListingBreadcrumb({ trail: { label: string; href?: string }[] })` (`nav aria-label="Breadcrumb"`, mục cuối `aria-current="page"`, ẩn dưới md); `BrowsePager` thêm danh sách số trang (dùng `pageItems` của `lib/catalog-filter`) `hidden lg:flex`, mỗi số là `Link` thật (`?page=n`, `aria-current` ở trang hiện tại, `aria-label` "Trang n"), trước/sau `lg:hidden` như cũ.
  - Nút "Xem thêm" dùng `aria-disabled` (không `disabled`) trong lúc tải và bỏ qua lần bấm khi đang tải; sau khi trang mới về, focus chuyển vào liên kết của thẻ đầu trang mới (`ul[data-testid="catalog-grid"] li:nth-child(<số cũ+1>) a`); ẩn nút ở lg (đã có phân trang số).
  - h1: `Kết quả cho "q"` / tên danh mục / "Tất cả sản phẩm" / "Danh mục" (hub); breadcrumb `Trang chủ › Danh mục › <danh mục cha › con>` từ `categoryTrail`.
  - Cột lọc: danh mục dạng cây (gốc, con của gốc đang chọn), nhóm Thương hiệu hiện 6 + "Thêm" (không `max-h`/`overflow`), mục đang chọn luôn hiện.

- [ ] **Step 1: test đỏ:** `listing-layout.spec` (có `aside`, class lưới 200px, `aside` không có class `sticky`/`overflow`; không `sidebar` thì không cột); `browse-view.spec`: h1 theo danh mục/`q`/"Tất cả sản phẩm"; breadcrumb có cha › con; "Xem thêm" khi đang tải có `aria-disabled="true"`, không `disabled`, bấm lần hai không gọi API thêm; tải xong `document.activeElement` là liên kết của thẻ đầu trang mới (trang 2 có thẻ thứ 21); `BrowsePager` ở trang 3/6 hiện `1 … 2 3 4 … 6` với `Link` đúng href và `aria-current` ở 3; `filter-sidebar.spec`: không còn `overflow-y-auto` trong cột, Thương hiệu 6 + "Thêm" bật hết khi bấm.
- [ ] **Step 2:** chạy → FAIL.
- [ ] **Step 3: cài đặt** theo Interfaces.
- [ ] **Step 4:** chạy lại các spec + `tsc` web → PASS.
- [ ] **Step 5: Commit** `feat(web): ListingLayout cho Danh mục máy tính (breadcrumb, cột lọc 200, phân trang số, Xem thêm giữ focus)`.

### Task 9: chụp 375px, bundle, e2e đầy đủ, gate

- [ ] **Step 1: bundle:** `cd apps/miniapp && VITE_API_BASE_URL=https://api.tubutree.com/api npx vite build` rồi `node scripts/ci/bundle-budget.cjs apps/miniapp/www`; mong entry không tăng so với 676 KB (ghi số vào notes).
- [ ] **Step 2: chụp:** Playwright host `localhost`, Mini `npx vite --host localhost --port 3303`, web `npx next dev -H localhost -p 3304` với API giả (xem `handoff-wave2.md` mục bẫy môi trường); 375×812, hub (có/không cây), danh sách (category có con, `q`), lưu `docs/2026-10-31-shop-redesign/screens/P7/{miniapp,web}-<màn>.png`; so số đo hai app (`getComputedStyle`: cao SortBar 44, cao ô danh mục, cao tiêu đề khối 44); sửa lệch; tắt server của mình.
- [ ] **Step 3: e2e Mini đầy đủ:** `cd apps/e2e && E2E_SCOPE=miniapp E2E_MINIAPP_PORT=3303 npx playwright test --workers=2 --reporter=line` → 0 đỏ (đỏ vì thiết kế đã chốt thì sửa test và ghi notes).
- [ ] **Step 4: gate:** `bash docs/2026-10-28-review/tools/gate.sh <worktree> --base 2e52b9be9 --out .claude/worktrees/gate-P7.txt`; bước FAIL kiểm lại ở base (worktree tạm) để ghi "có sẵn".
- [ ] **Step 5: ghi `plans/P7-browse.md` mục "Ghi chú cho gói sau"** (lệch kế hoạch thật, số bundle, đường dẫn ảnh) rồi commit `docs(shop-redesign): P7 browse, ghi chú bàn giao`.

## Ghi chú cho gói sau

### Kết quả kiểm cuối gói

- Gate (`gate-P7.txt`): 0 FAIL, mọi bước PASS: vitest app-core 1556, miniapp 5684 (cả múi giờ UTC), web 8398, jest api 11989; tsc 5 gói, eslint 3 gói, lint-parity, vite-build, bundle-mini (entry 682 KB, tổng 2044 KB).
- e2e Mini đầy đủ (`--workers=2`): 236 passed, 10 skipped, 0 failed.
- Chụp 375px khớp Mini ở hub (có và không cây), danh sách theo danh mục có con, theo `q`, và web lg 1280 có cột lọc; số đo: hàng ô tìm 58, ô danh mục 102, tiêu đề khối 24, SortBar 44, lưới đầu danh sách 140 (Mini 140,5).

### Việc đã làm lệch kế hoạch hoặc cần biết

- **Bundle Mini:** entry 682 KB (trần 700 KB), tổng 2044 KB trên cảnh báo 2048 KB. Gói sau thêm vào Mini phải đo lại bằng `node scripts/ci/bundle-budget.cjs apps/miniapp/www`; còn 4 KB dư.
- **`/brands` thiếu `logoUrl`:** hub đọc `logoUrl?` nếu có, không thì hiện chữ cái đầu (`avatarInitial`/`avatarTone` của app-core). Sửa ở `catalog.service.ts` thuộc P6.
- **"Xem tất cả" của kệ Bán chạy nhất:** Mini trỏ `/browse?sort=best_seller`, web trỏ `/san-pham?sort=best_seller`. P13 đổi sang `shelf('browse.bestSellers').seeAllRoute` khi có route `/best-sellers`.
- **`CLEAR_SEARCH_PATCH` giữ nguyên:** dùng `withListMode(patch)` thêm `all: true`. Prop `onSeeBestSellers` của hub bỏ vì nút "Xem tất cả" tự đẩy URL.
- **PUSH và replace:** ô danh mục ở hub, ô thương hiệu và "Xem tất cả sản phẩm" dùng PUSH (Back về hub). Mọi thao tác trong danh sách dùng replace (`update`/`updateList`).
- **Chia sẻ chung đã đổi:** `useScrollRestoration` (khôi phục cuộn theo từng chế độ hub/danh sách), Mini `CategoryDTO.children?`, kiểu trả về của `sortForTab` thu hẹp thành `BrowseSort`.
- **Hàng tiêu đề danh sách:** `ListHeading` là MỘT hàng (tên trái, số phải) cả Mini lẫn web; ở web tên chỉ hiện từ điện thoại (`md:hidden`), từ md tên là `h1` của `ListingLayout`. Hàng ô tìm Mini cao 58px (ô 46 + đệm 6x2); web đặt `max-md:h-[46px]` cho khớp, `--sort-bar-top:58px` ở khung `data-browse-scope`.
- **Trình tự TDD:** `pages/browse.tsx` của Mini viết trước spec của nó (vi phạm thứ tự); spec bổ sung ngay sau.
- **e2e sửa vì thiết kế đã chốt:** `browse-defaults`, `buy-flow-4b-browse`, `buy-flow-4b`, `tile-rhythm` (Mini), `shop.web`, `pdp-mobile.web` đổi sang hub ở `/browse` và danh sách ở `?all=1`, mock dùng chung `support/discovery-mocks.ts` thêm `CATEGORY_TREE`, cờ `tree`/`emptyCategories` và 400 cho `best_seller_30d` ở chế độ `legacy`; `browse-hub.miniapp.spec.ts` mới; nhãn SortBar "Giá ⇅", "Lọc"; tiêu đề h1 web 'Kết quả cho "dau goi"' và 'Tất cả sản phẩm'; limit 20. WebKit đọc `boundingBox` sau cuộn lệch 1px nên dùng `expect.poll`.
- **Web:** liên kết trang có `all=1` chỉ ở trang 1 (canonical không đổi); `ListingLayout` có thêm prop `toolbar`; SortBar dính ở khung bọc (cha của phần tử dính phải cao bằng danh sách) và nút Lọc ẩn từ lg bằng `!hidden` (nút có `display` ở style); cột lọc lg hiện 6 thương hiệu rồi "Thêm"/"Thu gọn".
- **SEO web:** `/san-pham` gốc không còn liệt kê toàn bộ sản phẩm (hub chỉ có liên kết Bán chạy, ô danh mục là nút); `?all=1` vào `NOINDEX_PARAMS`; `?page=N` canonical lấy từ phân trang.
- **Chưa chạy ở máy:** `shop.web.spec.ts` và `pdp-mobile.web.spec.ts` cần API thật, để CI.

### Sửa sau review (đợt 3)

- **Khung chờ ô danh mục khớp ô thật:** `HUB_TILE_HEIGHT = 102` (đặt chỗ cho nhãn 2 dòng) dùng cho cả `min-height` của ô lẫn khung chờ; `hubPlaceholderTiles(n)` chặn ở `HUB_CATEGORY_MAX` rồi cộng ô "Tất cả" (trước đây 12 danh mục gốc vẽ 13 khung chờ rồi co còn 9 ô). Ô một dòng nay cũng cao 102 (trước 88).
- **Đổi sắp xếp/lọc/gửi từ khoá giữa lưới sâu về đầu danh sách:** `scrollDeltaToListTop` (app-core `browse/scroll.ts`) so điểm đánh dấu đặt ngay trước SortBar với vạch dính; chỉ cuộn NGƯỢC, khách ở gần đầu trang không bị kéo. Mini đặt `scrollTop` của `.zaui-page`, web `window.scrollBy`. Gọi trong `updateList` và `commit`; chưa xử lý hub -> danh sách bằng gửi từ khoá khi đã cuộn sâu ở hub (điểm đánh dấu chưa có trong DOM).
- **Chip không lặp tiêu đề:** `activeFilterChips(s, names, { titleScope })` thay `omitScope`: chỉ phạm vi đang làm tiêu đề (`category` | `segment` | `brand`) bị bỏ chip. `?brand=Tubu` nay có tiêu đề "Tubu" và không còn chip "Bỏ lọc Tubu" (gỡ qua nút Lọc); hai nhãn trở lên giữ đủ chip. Danh mục không có trong cây (đã tải xong) hiện chip "Danh mục" để khách thấy và gỡ được.
- **Chọn danh mục trong gợi ý ở hub là PUSH** (như chạm ô danh mục: Back về hub); trong danh sách vẫn replace.
- **Chữ:** "Xem trang thương hiệu {brand}" (Mini `vi.browse.viewBrand`, web `browseText.viewBrand`), bỏ "nhãn hàng" theo Q5.

### Bẫy khi dựng lại ảnh chụp

- `.scroll-x` (mini.css và tokens.css) có `max-width: 100%`: dòng `-mx-4` trên web bị chặn ở 343px. Hàng cuộn tràn mép phải đặt `maxWidth: 'none'` ở style.
- Chữ nền web 16px, Mini 15px: phần tử không đặt cỡ chữ sẽ cao hơn Mini 1,5px mỗi dòng.
- Next dev giữ cache fetch của `/categories` (stale-while-revalidate): đổi API giả giữa hai lần chụp phải dừng server, chuyển `apps/web/.next/cache/fetch-cache` đi rồi mới chạy lại.
- Cổng 3304 có thể trùng API giả của gói khác nghe ở `*:3304`; Next của mình nghe `[::1]`. Dùng `localhost` và kiểm `lsof` trước khi tắt, chỉ tắt tiến trình có cwd trong worktree của mình.
- Ảnh: `docs/2026-10-31-shop-redesign/screens/P7/{miniapp,web}-{hub,hub-notree,list-category,list-search,list-all}.png` (375x812, DPR 3) và `web-lg-{hub,list-category}.png` (1280). Thư mục không vào git.
