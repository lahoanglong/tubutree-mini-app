# P13 `best-sellers` Implementation Plan

> **Cho agent làm:** BẮT BUỘC dùng superpowers:subagent-driven-development hoặc superpowers:executing-plans. Bước dùng checkbox `- [ ]`.

**Mục tiêu:** trang Bán chạy nhất `/best-sellers` (web `/ban-chay`) ở Mini App và web: tab danh mục tầng 1 + "Tất cả", thẻ `ProductTile variant=rank` hạng 1..n theo vị trí thật, `sort=best_seller_30d`, 20 món/trang (điện thoại "Xem thêm", web lg phân trang số). Kệ Bán chạy nhất Trang chủ (hai app) và hub Danh mục trỏ "Xem tất cả" tới trang này thay vì `/browse?sort=best_seller`.

**Kiến trúc:** việc tính tab, phạm vi danh mục, hạng, đường dẫn nằm ở `packages/app-core/src/browse/best-sellers.ts` (một nguồn cho hai app); `fetchBestSellersPage` + `bestSellersListQuery` dùng chung. Mini App và web chỉ vẽ: `SegmentedTabs` (có sẵn trong design system, `role=tablist/tab`, `aria-selected`) cho tab, `ProductGrid variant="rank"` cho lưới. Phạm vi danh mục nằm trên URL (`?category=<id tầng 1>`, replace, không chồng lịch sử).

**Tech stack:** TypeScript, React 18 (Mini: zmp-ui + inline style; web: Next 15 + Tailwind), TanStack Query `useInfiniteQuery`, vitest + testing-library, Playwright (`E2E_SCOPE=miniapp`, mock API).

**Spec:** `docs/2026-10-31-shop-redesign/01-thiet-ke.md` (§4 Q5, Q13, Q18, Q19 là luật; §5 "Bán chạy nhất"); mục P13 của `02-ke-hoach.md`. Nguồn: `review/ia-merch.md` D1 (Top bán chạy), `review/ux-copy.md` (`rank.*`). Bàn giao: `plans/handoff-wave1.md`, `-wave2.md`, `-wave3.md` (mục "Việc còn mở": "Xem tất cả" của Bán chạy nhất).

## Global Constraints

- Node: `export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH`. Worktree mới: `pnpm --filter @tubutree/shared-types build` và `cd apps/api && npx prisma generate` trước gate.
- Chữ theo Q5: "Bán chạy nhất", không "Top". Chữ mới vào `SHOP_COPY` **và** `SHOP_COPY_MAX` (`shop-copy.spec` bắt thiếu một bên). Chữ có sẵn dùng lại: `rank.title`, `rank.basis`, `rank.tabAll`, `rank.emptyTitle`, `rank.emptyCta`.
- Tiêu đề trang Fraunces/`title-lg` (PageHeader); vùng chạm >=44px, tương phản >=4,5:1, axe 0 vi phạm ở 375px; tab có tên đọc (`aria-label` của tablist) và `aria-selected`.
- Chunk vào Mini App <=700 KB: trang mới là chunk theo route (`lazy`), không import `shop-copy`/`best-sellers.ts` vào đường nạp gói đầu. Entry trước/sau ghi vào notes.
- Khách chưa đăng nhập xem được (không gọi API cần phiên). Cây danh mục rỗng như PROD: chỉ còn tab "Tất cả", trang vẫn đẹp.
- Hạng thẻ = vị trí thật trong danh sách API (`(trang-1)*20 + chỉ số + 1`); không dùng `soldApp30d` trộn số nhập tay (Q18, API đã xếp).
- Chỉ sửa mục `/best-sellers` của `route-fallback.ts` (P12 sửa mục `/flash-sale` cùng file). Không sửa file của P11/P12/F3 (xem notes nếu buộc đụng). `route-map.json`, `shop-copy*.ts`, `vi.ts`, `shelves.spec.ts` chỉ sửa đúng dòng của gói.
- Comment chỉ giải thích "vì sao", tiếng Việt, mật độ như file quanh đó. Không push, không PROD, không `git stash` trần. Máy thiếu RAM: chạy vitest theo file; gate đầy đủ đúng một lần ở cuối.

## Review Focus

1. Cây danh mục rỗng/lỗi/phẳng (API cũ) hoặc `?category=` lạ (link cũ, danh mục tầng 2, đã xoá): chỉ tab "Tất cả" hoặc tab gốc đúng, không ô trắng, không lỗi; id lạ sau khi cây đã tải thì coi như "Tất cả". Test ở T1 (`bestSellerScope`) và T2/T3.
2. Danh sách rỗng/dưới 3 món, API 500, "Xem thêm" lỗi giữa chừng: có trạng thái rỗng "Chưa đủ lượt bán để xếp hạng" + lối "Xem sản phẩm trong danh mục", lỗi có "Thử lại" tại chỗ, danh sách đã tải giữ nguyên. Test ở T2/T3.
3. API trước P3a từ chối `best_seller_30d` (400): trang lùi về `best_seller` thay vì lỗi trắng. Test ở T1 (`fetchBestSellersPage`).
4. Hạng sau "Xem thêm" và ở trang số 2 web lg tiếp nối (#21...), không đánh lại từ #1. Test ở T2/T3.
5. Đổi tab khi đang cuộn sâu: về đầu danh sách; Back từ chi tiết sản phẩm về đúng vị trí cuộn (Mini). Test ở T2 (vitest) và T5 (e2e).

---

## File Structure

| File | Việc |
|---|---|
| `packages/app-core/src/browse/best-sellers.ts` + `.spec.ts` | `BEST_SELLERS_PAGE_LIMIT`, `bestSellerTabs`, `bestSellerScope`, `bestSellersRankFrom`, `bestSellersHref` |
| `packages/app-core/src/api/browse.ts` + `.spec.ts` | `fetchBestSellersPage` |
| `packages/app-core/src/queries/browse.ts` | `bestSellersListQuery` |
| `packages/app-core/src/shop-copy.ts`, `shop-copy-budget.ts` | khoá `rank.tabsLabel` |
| `packages/app-core/src/merch/home-shelves.ts` + `.spec.ts` | `seeAllHref(shelfId, platform, scope?)` giữ `?category=` |
| `packages/app-core/src/merch/route-fallback.ts` + `.spec.ts` | `/best-sellers` thành route thật |
| `packages/app-core/src/route-map.json`, `merch/shelves.spec.ts` | dòng route, bỏ `/best-sellers` khỏi `PLANNED_ROUTES` |
| `apps/miniapp/src/components/ui/segmented-tabs.tsx`, `apps/web/src/components/mini/segmented-tabs.tsx` | prop `label` (aria-label của tablist) |
| `apps/miniapp/src/pages/best-sellers.tsx` + `.spec.tsx`, `components/app.tsx` | trang Mini + route lười |
| `apps/web/src/app/ban-chay/page.tsx`, `best-sellers-view.tsx` + spec | trang web (SSR trang đầu, client tiếp quản) |
| `apps/web/src/components/catalog/numbered-pager.tsx`, `browse-pager.tsx` | tách pager số dùng chung |
| `apps/miniapp/src/components/catalog/browse-hub.tsx`, `apps/web/src/components/catalog/browse-hub.tsx` (+spec) | "Xem tất cả" -> trang mới |
| `apps/miniapp/src/components/home/best-seller-rail.tsx`, web bản tương ứng (+spec), `home.spec`, `home-view.spec` | chỉ đổi kỳ vọng href |
| `apps/e2e/tests/{buy-flow-4b,buy-flow-4b-browse,browse-hub}.miniapp.spec.ts`, `best-sellers.miniapp.spec.ts` (mới) | đổi theo trang mới + e2e mới |

Lệnh kiểm một file: `cd packages/app-core && npx vitest run src/<đường dẫn>.spec.ts`; `cd apps/miniapp && npx vitest run src/<đường dẫn>`; `cd apps/web && npx vitest run src/<đường dẫn>`.

## Điều chỉnh đã chốt trước khi làm

- Tier 1 = nút gốc của cây (`parentId == null`), ẩn `productCount === 0`, tối đa 8 (`HUB_CATEGORY_MAX`). Tab "Tất cả" luôn có và hàng tab luôn vẽ (kể cả cây rỗng): giữ chiều cao hàng nên trang không nhảy khi cây về sau.
- Khoá URL là id danh mục như `/browse?category=<id>`; lọc cha gồm cả con do API (P3a).
- Web không dùng `ListingLayout` (h1 của nó ẩn ở điện thoại vì Mini `/browse` không có tiêu đề; Mini trang này có `PageHeader`): web dùng `ListingBreadcrumb` + `PageHeader` + lưới, cùng pager số tách khỏi `BrowsePager`. Điện thoại giống Mini, lg có breadcrumb và phân trang số.
- Không sticky ở web/Mini cho tiêu đề; chỉ hàng tab dính ngay dưới thanh lùi (`calc(var(--safe-top) + 56px)` điện thoại, `var(--header-h)` từ md web).

---

### Task 1: app-core `browse/best-sellers` + `fetchBestSellersPage` + query + chữ

**Files:**
- Create: `packages/app-core/src/browse/best-sellers.ts`, `best-sellers.spec.ts`
- Modify: `packages/app-core/src/api/browse.ts`, `api/browse.spec.ts`, `queries/browse.ts`, `shop-copy.ts`, `shop-copy-budget.ts`

**Interfaces:**
- Produces:
  - `best-sellers.ts`: `BEST_SELLERS_PAGE_LIMIT = 20`; `BEST_SELLERS_ALL_KEY = '__all__'`; `interface BestSellerTab { key: string; label: string }`; `bestSellerTabs(tree: CategoryNode[] | undefined): BestSellerTab[]` (đầu mảng luôn là `{ key: ALL, label: fillCopy('rank.tabAll') }`, rồi gốc có hàng, tối đa 8); `bestSellerScope(tabs: BestSellerTab[] | null, category: string | null | undefined): { tab: string; category: string | undefined }` (`tabs=null` = cây chưa tải: tin param); `bestSellersRankFrom(startPage: number): number`; `bestSellersHref(platform: 'mini' | 'web', o?: { category?: string; page?: number }): string` (dựa `liveRoute('/best-sellers', platform)`, trang 1 không ghi `page`).
  - `api/browse.ts`: `fetchBestSellersPage(http: HttpClient, o: { category?: string; page: number; limit?: number }): Promise<PageResponse<ProductCard>>` (limit mặc định 20; 400 -> lùi `sort=best_seller`).
  - `queries/browse.ts`: `bestSellersListQuery(http, category: string | undefined, startPage = 1)` trả `{ queryKey: ['products','best-sellers-list', category ?? 'all', startPage], queryFn({pageParam}), initialPageParam: startPage, getNextPageParam }`.
  - Khoá chữ: `rank.tabsLabel` = "Danh mục bán chạy" (<=20).

- [ ] **Step 1: Viết spec đỏ** `best-sellers.spec.ts`: (a) `bestSellerTabs(undefined)` và `[]` đều ra đúng một tab `{key:'__all__',label:'Tất cả'}`; (b) cây 3 gốc, một gốc `productCount:0` -> tab Tất cả + 2 gốc theo thứ tự cây, bỏ con (`children` không thành tab); (c) 10 gốc có hàng -> 1 + 8 tab; (d) gốc thiếu `productCount` (API cũ) vẫn có tab; (e) `bestSellerScope(null,'c1')` -> `{tab:'c1',category:'c1'}`; `bestSellerScope(tabs,'lạ')` -> `{tab:ALL,category:undefined}`; `bestSellerScope(tabs,'c1')` khi `c1` là tab; `(tabs, undefined)` -> ALL; (f) `bestSellersRankFrom(1)===1`, `(2)===21`, `(3)===41`, `(0)===1`, `(NaN)===1`; (g) `bestSellersHref('mini')==='/best-sellers'`, `('web',{category:'c 1'})==='/ban-chay?category=c%201'`, `('web',{category:'c1',page:2})==='/ban-chay?category=c1&page=2'`, `('mini',{page:1})==='/best-sellers'`. Trong `api/browse.spec.ts`: `fetchBestSellersPage` gọi `/products` với `{sort:'best_seller_30d',limit:20,page:2,category:'c1'}` (không gửi `category` khi thiếu); khi `get` ném lỗi `status:400` lần đầu thì gọi lại với `sort:'best_seller'` và trả kết quả đó; lỗi 500 ném ra.
- [ ] **Step 2: Chạy** `cd packages/app-core && npx vitest run src/browse/best-sellers.spec.ts src/api/browse.spec.ts` -> FAIL (thiếu hàm). `bestSellersHref` cần route-fallback cũ: ở bước này `liveRoute('/best-sellers','mini')` còn trả `/browse?sort=best_seller` nên ca (g) đỏ tới T4: chuyển ca (g) sang T4 (viết cùng lúc đổi `route-fallback`), ở đây chỉ viết (a)-(f).
- [ ] **Step 3: Cài đặt** theo chữ ký trên. `bestSellerTabs` lọc `parentId == null` (nút gốc), `productCount === undefined || > 0`, cắt `HUB_CATEGORY_MAX`. `bestSellersRankFrom`: `Number.isFinite(p) && p>=1 ? (floor(p)-1)*20+1 : 1`. Thêm `rank.tabsLabel` vào `SHOP_COPY` và `SHOP_COPY_MAX`.
- [ ] **Step 4: Chạy lại** hai spec + `npx vitest run src/shop-copy.spec.ts` -> PASS.
- [ ] **Step 5: Commit** `feat(app-core): tab, phạm vi danh mục, hạng và tải trang Bán chạy nhất (sort 30 ngày, lùi best_seller khi API cũ)`.

### Task 2: Mini App trang `/best-sellers`

**Files:**
- Create: `apps/miniapp/src/pages/best-sellers.tsx`, `best-sellers.spec.tsx`
- Modify: `apps/miniapp/src/components/ui/segmented-tabs.tsx` (+spec nếu có), `apps/miniapp/src/components/app.tsx` (route lười `/best-sellers`, `RouteShell skeleton="grid"`), `packages/app-core/src/route-map.json` (dòng `{ "miniapp": "/best-sellers", "web": "/ban-chay", "private": false, "pending": true }` trong lane `shop`, bỏ `pending` ở T3)

**Interfaces:**
- Consumes: T1; `useCategories()` (`hooks/use-categories`), `ProductGrid` (`rankFrom`, `listSource`, `loading`, `skeletonCount`), `PageHeader`, `SegmentedTabs`, `EmptyState`/`ErrorState`, `PullToRefresh`, `useScrollRestoration`.
- Produces: `export default function BestSellersPage()`; `SegmentedTabsProps.label?: string` (-> `aria-label` của `role="tablist"`).

- [ ] **Step 1: Viết spec đỏ** `best-sellers.spec.tsx` (theo khung `browse.spec.tsx`: MemoryRouter, mock `core-http`/`shop-api`): (a) vào `/best-sellers`: một lời gọi `GET /products` có `sort=best_seller_30d, limit=20, page=1`, không `category`; tablist tên "Danh mục bán chạy" có tab "Tất cả" `aria-selected=true`; thẻ đầu có `#1`, `#2`...; (b) cây có 2 gốc: tab hiện cả hai; chạm tab -> URL `?category=<id>` (replace), tab đó `aria-selected=true`, request mới có `category`; (c) `?category=<id gốc>` ban đầu: tab đúng được chọn, request có `category`; `?category=lạ` sau khi cây tải: tab Tất cả, request không `category`; (d) cây rỗng (`[]`) hoặc `/categories` lỗi: chỉ tab "Tất cả", danh sách vẫn hiện; (e) "Xem thêm" tải trang 2, thẻ đầu trang 2 có `#21`, hạng trang 1 giữ nguyên; (f) trả 0 món -> `Chưa đủ lượt bán để xếp hạng` + nút `Xem sản phẩm trong danh mục`; nút điều hướng `/browse?all=1` (hoặc `/browse?category=<id>` khi đang ở tab danh mục); (g) lỗi 500 ở trang đầu -> ErrorState "Thử lại" gọi lại; lỗi ở "Xem thêm" -> danh sách giữ, có "Thử lại" tại chỗ.
- [ ] **Step 2: Chạy** `cd apps/miniapp && npx vitest run src/pages/best-sellers.spec.tsx` -> FAIL (module chưa có).
- [ ] **Step 3: Cài đặt** `BestSellersPage` + `SegmentedTabs.label`. Trạng thái `category` lấy bằng `useSearchParams` của react-router-dom, ghi `setParams(next, { replace: true })` (bỏ tham số khi chọn Tất cả). `tabs = categories.isLoading ? null : bestSellerTabs(categories.categories)`; `scope = bestSellerScope(tabs, param)`; `useInfiniteQuery(bestSellersListQuery(coreHttp, scope.category))`; hàng tab dính `top: calc(var(--safe-top) + 56px)`, nền canvas, `padding: 8px 16px`; vùng kết quả `role="tabpanel"` + `aria-label` = nhãn tab đang chọn; `ProductGrid variant="rank" rankFrom={bestSellersRankFrom(1)} listSource="best_seller_page"` (hạng tiếp nối vì danh sách phẳng từ trang 1); khung chờ `loading` 6 thẻ; đổi tab cuộn `.zaui-page` về 0; `useScrollRestoration(scope.category ?? 'all', list.length > 0)`; `PullToRefresh` làm mới `['products']`. Route lười trong `app.tsx`.
- [ ] **Step 4: Chạy lại** spec + `npx vitest run src/components/ui/segmented-tabs` (nếu có) + `cd ../.. && pnpm lint:parity` -> PASS (dòng `pending`).
- [ ] **Step 5: Commit** `feat(miniapp): trang Bán chạy nhất theo danh mục tầng 1 (thẻ hạng, 20 món/trang, Xem thêm)`.

### Task 3: Web trang `/ban-chay`

**Files:**
- Create: `apps/web/src/app/ban-chay/page.tsx`, `apps/web/src/app/ban-chay/best-sellers-view.tsx`, `best-sellers-view.spec.tsx`, `page.spec.tsx`, `apps/web/src/components/catalog/numbered-pager.tsx`
- Modify: `apps/web/src/components/catalog/browse-pager.tsx` (dùng `NumberedPager`, hành vi y nguyên), `apps/web/src/components/mini/segmented-tabs.tsx` (prop `label`), `packages/app-core/src/route-map.json` (bỏ `pending`)

**Interfaces:**
- Consumes: T1; `ListingBreadcrumb`, `PageHeader` (`@/components/ui/page-header`), `SegmentedTabs`, `ProductGrid` + `GRID_PRODUCTS`, `ErrorState`, `ProductGridSkeleton`, `categoriesQuery`, `fetchCategories`, `createServerHttp`, `parsePage`/`firstParam`, `pageItems`.
- Produces: `NumberedPager({ hrefFor(page: number): string; startPage; lastPage; totalPages; hasNext })` (markup cũ của `BrowsePager`: điện thoại Trang trước/sau, lg dãy số); `BestSellersView({ initial?: { category: string | undefined; startPage: number; page: PageResponse<ProductCard> } | null; categories?: CategoryDTO[] })`; trang server `export default async function BestSellersPage({ searchParams })` + `generateMetadata` (có `category` hoặc `page>1`: `robots: { index: false, follow: true }`; còn lại title "Bán chạy nhất — Tubu Tree", canonical `/ban-chay`).

- [ ] **Step 1: Viết spec đỏ** `best-sellers-view.spec.tsx` (theo khung `browse-view.spec.tsx`: mock `next/navigation`, `@/lib/core-http`): (a) h1 "Bán chạy nhất", breadcrumb "Trang chủ › Bán chạy nhất", thẻ có `#1..#n`; (b) tab: `role=tablist` tên "Danh mục bán chạy", "Tất cả" `aria-selected=true`; chạm tab gốc -> `router.replace('/ban-chay?category=<id>', { scroll: false })`, bỏ `page`; cây rỗng -> chỉ "Tất cả"; (c) `initial` khớp thì không gọi `/products` lần đầu; `?page=2` + `initial.startPage=2`: thẻ đầu `#21`, có liên kết "Trang trước" `href="/ban-chay"` và dãy số trang `href="/ban-chay?page=N"` (giữ `category`); (d) "Xem thêm" dùng `aria-disabled` khi đang tải, thêm trang kế, hạng tiếp nối `#21`; (e) rỗng, lỗi 500 (Thử lại), lỗi Xem thêm; (f) `NumberedPager`: giữ nguyên ca của `browse-view.spec` (chạy lại spec đó). `page.spec.tsx`: `generateMetadata` noindex khi có `category`/`page=2`, index khi trơn; trang gọi `fetchCategories` rồi `fetchBestSellersPage` với `category` hợp lệ (id lạ -> không gửi `category`); API lỗi thì vẫn render view không `initial`.
- [ ] **Step 2: Chạy** `cd apps/web && npx vitest run src/app/ban-chay src/components/catalog/browse-view.spec.tsx` -> FAIL (thiếu module).
- [ ] **Step 3: Cài đặt.** Tách `NumberedPager` rồi `BrowsePager` gọi nó với `hrefFor = (p) => pagedHref(state, p)`. `BestSellersView`: `useSearchParams`/`useRouter`/`useShellPathname`; `startPage = parsePage(page)`; `useInfiniteQuery({ ...bestSellersListQuery(coreHttp, scope.category, startPage), initialData seeded khi khớp, staleTime 60s })`; hàng tab bọc `sticky top-[calc(var(--safe-top)+56px)] md:top-[var(--header-h)] z-[2] -mx-4 px-4 md:mx-0 md:px-0` và `md:w-fit` quanh `SegmentedTabs scroll`; "Xem thêm" `lg:hidden` + `aria-disabled`, focus vào thẻ đầu của trang mới như `browse-view`; `NumberedPager` với `hrefFor = bestSellersHref('web', { category, page })`; trang server: `revalidate = 300`, lấy cây trước rồi trang đầu theo `bestSellerScope`.
- [ ] **Step 4: Bỏ `pending` ở route-map**, chạy lại spec trên + `cd apps/web && npx vitest run src/lib/route-map` (nếu có) + `pnpm lint:parity` -> PASS.
- [ ] **Step 5: Commit** `feat(web): trang /ban-chay (tab danh mục, thẻ hạng, Xem thêm điện thoại, phân trang số từ lg)`.

### Task 4: Đổi lối "Xem tất cả" sang trang mới

**Files:**
- Modify: `packages/app-core/src/merch/route-fallback.ts` (+`.spec.ts`), `merch/home-shelves.ts` (+`.spec.ts`), `merch/shelves.spec.ts` (`PLANNED_ROUTES`), `apps/miniapp/src/components/catalog/browse-hub.tsx` (+spec), `apps/web/src/components/catalog/browse-hub.tsx` (+spec), `apps/miniapp/src/components/home/best-seller-rail.spec.tsx`, `apps/web/src/components/home/best-seller-rail.spec.tsx`, `home.spec.tsx` (Mini), `home-view.spec.tsx` (web), `best-sellers.spec.ts` (ca (g) của T1)

**Interfaces:**
- Consumes: T1 `bestSellersHref`; `seeAllHref` hiện có.
- Produces: `seeAllHref(shelfId: string, platform?: 'mini' | 'web', scope?: { category?: string | null }): string | null` (chỉ route `/best-sellers` nhận `?category=<id>` khi `scope.category` có giá trị); hub bỏ hằng `BEST_SELLERS_LIST_ROUTE`, lấy lối từ `seeAllHref('browse.bestSellers', platform)`.

- [ ] **Step 1: Sửa spec thành đỏ trước**: `route-fallback.spec`: `liveRoute('/best-sellers','mini')==='/best-sellers'`, `('web')==='/ban-chay'`, `routeUsable('/best-sellers')` true, hai ca của `/flash-sale` và `/vouchers` giữ nguyên; `home-shelves.spec`: `seeAllHref('home.bestSellers','mini')==='/best-sellers'`, `('home.bestSellers','web')==='/ban-chay'`, `('home.bestSellers','web',{category:'c1'})==='/ban-chay?category=c1'`, `('home.flash','web',{category:'c1'})` không có `category`; `shelves.spec`: `PLANNED_ROUTES=['/flash-sale']`; hub Mini `navigate` gọi `/best-sellers`, hub web `href="/ban-chay"`; spec rail/home Mini `navigate('/best-sellers')`, web `href="/ban-chay"`; thêm ca (g) của T1 vào `best-sellers.spec.ts`.
- [ ] **Step 2: Chạy** các spec đó -> FAIL đúng kỳ vọng mới.
- [ ] **Step 3: Cài đặt**: `ENTRIES['/best-sellers'].pending=false` và xoá mục `/best-sellers` của `PENDING_TARGET` (chỉ hai dòng này của file); `seeAllHref` thêm tham số `scope`; hub hai app dùng `seeAllHref('browse.bestSellers', ...)`; comment cũ "Chưa có trang /best-sellers" xoá.
- [ ] **Step 4: Chạy lại** `cd packages/app-core && npx vitest run src/merch src/browse`; `cd apps/miniapp && npx vitest run src/components/catalog/browse-hub.spec.tsx src/components/home/best-seller-rail.spec.tsx src/pages/home.spec.tsx`; `cd apps/web && npx vitest run src/components/catalog/browse-hub.spec.tsx src/components/home/best-seller-rail.spec.tsx src/components/home/home-view.spec.tsx` -> PASS.
- [ ] **Step 5: Commit** `feat: "Xem tất cả" của Bán chạy nhất (Trang chủ, hub Danh mục) mở trang xếp hạng 30 ngày`.

### Task 5: e2e Mini App

**Files:**
- Create: `apps/e2e/tests/best-sellers.miniapp.spec.ts`
- Modify: `apps/e2e/tests/buy-flow-4b.miniapp.spec.ts` (ca "'Xem tất cả' của Bán chạy nhất..."), `buy-flow-4b-browse.miniapp.spec.ts` (ca "Mở mới /browse bằng điều hướng thường..."), `browse-hub.miniapp.spec.ts` (ca "kệ Bán chạy nhất: 10 thẻ có hạng")

- [ ] **Step 1: Đổi ca cũ cho đúng ý, chạy thấy đỏ rồi xanh**: (a) `buy-flow-4b`: "Xem tất cả" ở Trang chủ -> `toHaveURL(/\/best-sellers$/)`, `/products` có `sort=best_seller_30d, limit=20`, thẻ đầu tên `XA_PHONG` mang `#1`; (b) `browse-hub`: "Xem tất cả Bán chạy nhất" -> `/best-sellers`, thẻ hạng `#1…`, tab "Tất cả" đang chọn; (c) `buy-flow-4b-browse` (hồi quy 63dc4214b: Back rồi chạm ngay lúc trang cũ còn trượt ra): lối vào `/browse` khác từ Trang chủ = ô "Tất cả" của khối Danh mục (`PUSH` tới `/browse?all=1`); giữ nguyên các bước còn lại (cuộn 900, `sessionStorage` khoá `tubu_scroll:all=1`, `goBack`, chạm lại ngay, `scrollTop===0`, số `result-count` theo mock).
- [ ] **Step 2: Viết `best-sellers.miniapp.spec.ts`** (`mockDiscovery`, khách chưa đăng nhập, 375px): trang mở không 401; tablist "Danh mục bán chạy" có Tất cả + 3 gốc của `CATEGORY_TREE`; chạm tab "Cho bé" -> `category=cat-baby` ở request, URL `?category=cat-baby`, hạng bắt đầu lại `#1`; "Xem thêm" ra `#21` (mock 30 món); cây `[]` chỉ còn "Tất cả" và lưới vẫn có thẻ; `AxeBuilder` 0 vi phạm; chip tab đo bằng `tests/support/hit-area.ts` (vùng chạm 44).
- [ ] **Step 3: Chạy** `cd apps/e2e && E2E_SCOPE=miniapp E2E_MINIAPP_PORT=3315 npx playwright test tests/best-sellers.miniapp.spec.ts tests/buy-flow-4b.miniapp.spec.ts tests/buy-flow-4b-browse.miniapp.spec.ts tests/browse-hub.miniapp.spec.ts --workers=2 --reporter=line` -> PASS (không `--repeat-each` trừ ca hồi quy cuộn: chạy `--repeat-each=8`).
- [ ] **Step 4: Commit** `test(e2e): trang Bán chạy nhất và lối "Xem tất cả" mới; ca cuộn /browse đổi lối vào sang ô Tất cả`.

### Task 6: Chụp so 375px, gate, bàn giao

- [ ] **Step 1: Chụp** Mini (Vite dev cổng 3315, mock API trong Playwright) và web (Next dev cổng 3316, API giả) `/best-sellers` và `/ban-chay` ở 375px (cây đầy đủ và cây rỗng) + web 1280px; lưu `docs/2026-10-31-shop-redesign/screens/P13/`; so hai bản (tiêu đề, hàng tab, thẻ hạng, nút Xem thêm); sửa lệch. Tắt server của mình.
- [ ] **Step 2: Đo bundle** `node scripts/ci/bundle-budget.cjs apps/miniapp/www` trước (base) và sau; entry không tăng đáng kể (trang mới là chunk lười).
- [ ] **Step 3: Gate** `bash docs/2026-10-28-review/tools/gate.sh <worktree> --base 77433c0d0 --out .../gate-P13.txt`; sau đó cả bộ e2e Mini (`--workers=2`). Bước FAIL kiểm trên base để ghi "có sẵn".
- [ ] **Step 4: Commit** (nếu có sửa sau chụp) và trả báo cáo theo schema.

## Ghi chú thực hiện (khác kế hoạch)

- `bestSellersHref` làm độc lập ở T3 (hằng `PAGE_PATH` riêng cho Mini/web), không đi qua `liveRoute`: view web cần nó trước T4. `seeAllHref` (T4) vẫn đi qua `liveRoute`, nên hai chỗ cùng trỏ một route nhưng không chung một bảng.
- Ca hồi quy cuộn (T5c): từ Trang chủ chỉ có ô "Tất cả danh mục" PUSH tới `/browse` (hub, khoá cuộn rỗng `tubu_scroll:`), không có lối nào PUSH tới `/browse?all=1`. Ca dùng hub ở màn 375x520 và chạm bằng `dispatchEvent('click')`: `click()` chờ nút Trang chủ đứng yên, tức chờ hết hiệu ứng, và ca không còn bắt được lỗi 63dc4214b. Kiểm bằng đột biến: bỏ `navKey` khỏi deps của hook cuộn thì 16/16 lần đỏ; khôi phục thì 24/24 xanh.
- `AxeBuilder` không có trong `apps/e2e`: thay bằng khẳng định theo vai trò (tablist có tên, tab `aria-selected`, tabpanel có tên), vùng chạm 44px (`expectChipHitArea44`) và thử chạm thật vào tab dính.
- Thanh tab dính của Mini: `top: 8px` thay vì `calc(var(--safe-top) + 56px)`; vị trí dính tính từ chỗ nội dung của `.page` bắt đầu (đệm `safe-top + 48px`), nên ghi 56px thì hở dải 48px giữa thanh Back và hàng tab. Phát hiện ở bước chụp 375px, ca e2e "vùng chạm" nay đo mép trên thanh dính.
- Web khổ điện thoại: "Xem thêm"/"Thử lại" dùng `Button` DS (nút phụ nền xanh nhạt như Mini) thay vì `ui.btnSecondary` viền; hàng tab cuộn ngang ẩn thanh cuộn (`.scroll-x[role='tablist']` trong `mini.css`, vì thanh 6px của `globals.css` hiện cả trên điện thoại).
- Cổng chụp: web chạy ở 3326, API giả ở 3327 (3316 đang do gói F3 giữ).
