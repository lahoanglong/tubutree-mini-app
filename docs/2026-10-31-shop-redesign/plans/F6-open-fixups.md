# F6 open-fixups (đợt 4c): sửa bảy việc còn mở của đợt 3 và 4a Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** đóng bảy việc nhỏ ghi ở mục "Việc còn mở" của `handoff-wave3.md` và `handoff-wave4a.md` (thanh dính Mini, hai nút "Quay lại", tên tabpanel và dòng thước đo ở Bán chạy nhất, "Nhắc tôi" sau đăng nhập, CLS banner Trang chủ web từ lg, icon danh mục), mỗi việc có test đỏ trước.

**Architecture:** logic quyết định (tên tabpanel, chữ thước đo, quyết định đặt nhắc sau đăng nhập, icon theo slug) đặt ở `packages/app-core` để hai app cùng dùng; hai app chỉ nối. Hình học (thanh dính, khung giữ chỗ banner) đo bằng Playwright rồi sửa theo số đo. Không đổi tên, chữ ký hay route ở "Giao diện dùng chung" của `02-ke-hoach.md`; `fetchBestSellersPage` chỉ thêm một trường tuỳ chọn vào kết quả.

**Tech Stack:** React 18 + zmp-ui + Vite (Mini App), Next 15 + Tailwind (web), `packages/app-core`, vitest, Playwright (Mini mock toàn bộ API; web chạy với API giả).

**Spec:** `docs/2026-10-31-shop-redesign/01-thiet-ke.md` (§4 là luật), `02-ke-hoach.md`, `plans/handoff-wave3.md` và `plans/handoff-wave4a.md` (mục "Việc còn mở"). Gói F6 không có mục riêng trong `02-ke-hoach.md`.

## Global Constraints

- Node: `export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH` cho mọi lệnh; worktree mới đã chạy `pnpm --filter @tubutree/shared-types build` và `npx prisma generate` (trong `apps/api`).
- Chữ giao diện tiếng Việt theo §4 Q5; không dùng "Top", "Freeship", "Kho voucher", "Nhãn hàng". Chữ mới (nếu có) vào `shop-copy.ts` kèm hạn độ dài ở `shop-copy-budget.ts`. Gói này dùng lại khoá có sẵn `rank.title`, `rank.basis`, `rank.basisAll`, `rank.tabAll`.
- Logic gọi API, chữ, quyết định nằm ở `packages/app-core`; app không chép logic.
- Vùng chạm ≥44px, tương phản ≥4,5:1, axe 0 vi phạm ở 375px trên màn đụng tới. Chunk vào Mini App ≤700 KB (`node scripts/ci/bundle-budget.cjs apps/miniapp/www`).
- Khung chờ Trang chủ không làm trang nhảy (CLS). Ca CLS chập chờn là lỗi thật: chạy `--repeat-each=10 --retries=0`.
- Không sửa: `apps/miniapp/src/pages/storefront-view.tsx`, `storefront-builder` (P10); offers/vouchers/coupons/`route-fallback` (P14); admin danh mục (P16); `product-detail.tsx`, `pdp-extras.tsx`, hook `/orders`, `PurchasedRail` (7e); `pages/cart.tsx` ngoài đầu trang (P15); file của P17a (DESIGN.md, `ds-map.json`, `check-ds-parity.mjs`, `.gitignore`, `AGENTS.md`, `terminology.spec.ts`). Buộc phải đụng thì ghi vào notes.
- Không deploy, không push, không đọc/ghi PROD, không `git stash` trần, không kill tiến trình của người khác. Máy thiếu RAM: chạy test theo từng file; gate đầy đủ đúng một lần ở cuối.
- Comment chỉ giải thích "vì sao" không hiển nhiên, tiếng Việt, theo mật độ của file xung quanh. Commit kết thúc bằng dòng `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Khách chưa đăng nhập bấm "Nhắc tôi", đăng nhập xong nhưng món ĐÃ được nhắc từ trước (máy khác): tự đặt lại sẽ HUỶ nhắc. Mong đợi: không gọi `POST` lẫn `DELETE` nào (Task 5, test `remindIntentAction` trả `drop`).
2. Khách bấm "Nhắc tôi", huỷ đăng nhập rồi quay lại trang như khách: ý định cũ không được tự đặt nhắc ở lần đăng nhập sau (web: xoá khi trang đã ở trạng thái khách, TTL 10 phút; Mini: bỏ khi phiên không thành `authenticated`).
3. `/best-sellers?category=<id lạ>` khi cây danh mục lỗi hoặc về chậm: tabpanel không được mang tên "Tất cả" trong lúc chưa biết tên danh mục; cây về rồi mà id không phải tab thì quay về "Tất cả" (Task 3).
4. API cũ trả 400 cho `best_seller_30d` ở trang 2 trở đi, hoặc cache khởi tạo web không có trường `basis`: thiếu trường coi là 30 ngày, có trang nào `total` thì dòng thước đo đổi sang "Theo tổng lượt bán" (Task 4).
5. Khách cũ có gợi ý banner, banner chưa về, máy tính và điện thoại: khung giữ chỗ chỉ xuất hiện MỘT lần (điện thoại không có hai khung banner chồng nhau) và biến mất đúng lúc banner hoặc "không có chiến dịch" được biết (Task 6).

---

## Cấu trúc file

| File | Việc |
|---|---|
| `apps/miniapp/src/pages/brand-view.tsx` | `STICKY_TOP` bỏ `--safe-top` (trang `page-bleed` đã đệm sẵn), `--sort-bar-top` theo; thêm `data-testid` cho thanh tab dính |
| `apps/miniapp/src/css/tokens.css` | chú thích rõ `.sticky-below-back` chỉ đúng cho trang KHÔNG có đệm `.page` |
| `apps/e2e/tests/sticky-below-back.miniapp.spec.ts` (mới) | đo vị trí thanh dính ở trang thương hiệu và Vườn Xanh, `--safe-top` 0 và 47 |
| `apps/miniapp/src/components/ui/page-header.tsx` | bỏ `BackButton` thứ hai; `back` chỉ còn quyết định chỗ chừa cho nút |
| `apps/miniapp/src/components/ui/page-header.spec.tsx`, `pages/orders.spec.tsx` | sửa theo (nút lùi do vỏ app vẽ) |
| `apps/e2e/tests/cart-lines.miniapp.spec.ts` | bỏ dò `elementFromPoint` ở phần chọn nút, dùng một nút duy nhất |
| `packages/app-core/src/browse/best-sellers.ts` (+ spec) | `bestSellerPanelLabel`, `bestSellersBasisCopy`, kiểu `BestSellersBasis` |
| `packages/app-core/src/api/browse.ts` (+ `browse.spec.ts`) | `fetchBestSellersPage` trả thêm `basis` |
| `apps/miniapp/src/pages/best-sellers.tsx`, `apps/web/src/app/ban-chay/best-sellers-view.tsx` (+ spec) | nối tên tabpanel và dòng thước đo |
| `apps/e2e/tests/best-sellers.miniapp.spec.ts` | ca cây danh mục về chậm, ca API cũ |
| `packages/app-core/src/commerce/flash-remind-intent.ts` (mới, + spec) | `remindIntentAction` |
| `apps/miniapp/src/pages/flash-sale.tsx` (+ spec), `apps/e2e/tests/flash-slots.miniapp.spec.ts` | Mini: nhớ ý định trong bộ nhớ, đặt nhắc khi `authenticated` |
| `apps/web/src/lib/pending-remind.ts` (mới, + spec), `apps/web/src/app/gio-vang/flash-slots-view.tsx` (+ spec), `apps/e2e/tests/flash-slots.web.spec.ts` | web: nhớ ý định qua sessionStorage |
| `apps/web/src/components/home/home-view.tsx`, `home-settling.tsx` (+ spec), `apps/e2e/tests/home-banner-lg.web.spec.ts` (mới) | giữ chỗ banner ở lg |
| `packages/app-core/src/browse/category-icons.ts` (mới, + spec), `apps/miniapp/src/hooks/use-categories.ts`, `apps/web/src/lib/browse-categories.ts` | một bảng slug → khoá icon cho hai app |

---

### Task 1: Thanh dính Mini hở khi có vùng an toàn (STICKY_TOP, sticky-below-back)

Đo ở 375px (đã thăm dò, `--safe-top` đặt tay): `top` của phần tử dính tính từ mép NỘI DUNG của `.zaui-page`, tức cộng thêm đệm đầu của chính trang. Trang `page-bleed` (thương hiệu) đệm đúng `--safe-top`, nên `calc(var(--safe-top) + 56px)` làm thanh dính ở `56 + 2·safe` thay vì `56 + safe` (hở đúng `--safe-top`: 0 ở trình duyệt, 47px trên tai thỏ). Vườn Xanh không dùng lớp `page` (đệm 0) nên `.sticky-below-back` đo đúng (y = safe, hoặc 56 + safe khi có nút lùi): lớp này chỉ sai ở trang có đệm `.page`, như P12 đã ghi. `storefront-view.tsx` có cùng lỗi nhưng thuộc P10: không sửa, ghi notes.

**Files:**
- Create: `apps/e2e/tests/sticky-below-back.miniapp.spec.ts`
- Modify: `apps/miniapp/src/pages/brand-view.tsx:46,216,220`
- Modify: `apps/miniapp/src/css/tokens.css:68-71` (chú thích)

**Interfaces:**
- Consumes: `mockBrandPage`, `BRAND_SLUG` (`support/shop-page-mocks.ts`), `makeUser`, `mockSession` (`support/mock-api.ts`), nền thanh lùi `[data-back-bar]` (`back-button.tsx`).
- Produces: `data-testid="brand-tabs-sticky"` trên thanh tab dính của `brand-view.tsx`; hằng `STICKY_TOP = 56` (px, số) thay chuỗi `calc(...)`.

- [ ] **Step 1: Viết spec đo.** `sticky-below-back.miniapp.spec.ts`, viewport 375×520 (thấp để trang đủ dài cuộn), `test.use`. Helper `setSafeTop(page, px)`: `addInitScript` đặt `document.documentElement.style.setProperty('--safe-top', px+'px')` ở `DOMContentLoaded`. Ca theo `for (const safe of [0, 47])`:
  - `thương hiệu: thanh tab dính khít dưới thanh lùi (safe=${safe})`: mở `/brand/fuwa`, cuộn `.zaui-page` chứa tablist tới `scrollTop` > 250, đợi `expect.poll`; `expect(box(getByTestId('brand-tabs-sticky')).y).toBe(box([data-back-bar]).height)` (làm tròn); và `back-bar.height === 56 + safe`.
  - `thương hiệu, tab Sản phẩm: thanh sắp xếp dính ngay dưới hàng tab, không chồng không hở`: bấm tab `Sản phẩm (45)`, cuộn sâu, `sortBar.y - (tabsSticky.y + 62 - 12)` nằm trong `[-1, 1]` (SortBar bắt đầu 12px trên đáy khung tab, đúng thiết kế hiện tại), `sortBar.y >= backBar.height`.
  - `Vườn Xanh: thanh tab dính dưới vùng an toàn, và dưới thanh lùi khi có nút lùi`: mock game như `garden.miniapp.spec.ts` (`mockGame` chép nhỏ trong spec: `/game/profile`, `/game/quiz/today`, `/game/leaderboard`, `/game/missions`, `/game/forest`, `/game/community`, `/game/collection`, `/game/season`, `/game/season/leaderboard`, `/game/friends`, `/game/garden`, `/me/loyalty`, `allowUnmocked('GET /game/season-pass','POST /events')`); cuộn `scrollTo(0, 5000)`; `.sticky-below-back` có `y === safe`; thêm class `with-back-btn` vào `<body>` (mô phỏng điều hướng có `state.from`) thì `y === 56 + safe`.
- [ ] **Step 2: Chạy, thấy đỏ đúng chỗ.** `cd apps/e2e && E2E_SCOPE=miniapp E2E_MINIAPP_PORT=3329 npx playwright test sticky-below-back --workers=1 --retries=0 --reporter=line`. Expected: ca thương hiệu `safe=47` đỏ (y = 150, nền thanh lùi 103); `safe=0` xanh; ca Vườn Xanh xanh (khoá hành vi đúng đã có).
- [ ] **Step 3: Sửa `brand-view.tsx`.** `const STICKY_TOP = 56;` với chú thích vì sao không cộng `--safe-top` (trang `page-bleed` đệm sẵn `--safe-top`; `top` đo từ mép nội dung); `style={{ position: 'sticky', top: STICKY_TOP, ... }}` và `--sort-bar-top: ${STICKY_TOP + TABS_HEIGHT - 12}px`; thêm `data-testid="brand-tabs-sticky"` vào thanh tab. `tokens.css`: thêm một dòng chú thích dưới `.sticky-below-back` rằng lớp chỉ dùng cho trang không có đệm `.page` (Vườn Xanh), trang `.page` tự tính (xem `flash-sale.tsx` `STICKY`).
- [ ] **Step 4: Chạy lại.** Cùng lệnh Step 2. Expected: tất cả xanh. Chạy thêm `pnpm --filter @tubutree/miniapp exec vitest run src/pages/brand-view.spec.tsx` xanh.
- [ ] **Step 5: Commit** `fix(miniapp): thanh tab dính của trang thương hiệu khít dưới thanh lùi khi có vùng an toàn`.

---

### Task 2: Mini `/cart` có hai nút "Quay lại"

`PageHeader` (76 trang dùng) tự dựng thêm một `BackButton` trong `#main-content` trong khi `app.tsx` đã dựng một `BackButton` toàn cục (fixed, z 200) cho mọi trang con. Hai nút cùng tên, cùng chỗ; nút nào cũng gắn/gỡ `with-back-btn` trên `<body>`, nên khi bản trong trang gỡ (rời trang `PageHeader` sang trang không có) thì bản toàn cục mất lớp đệm. Giữ bản toàn cục (phủ cả trang không có `PageHeader`, đúng một nút, đúng một lớp thanh đặc); `PageHeader` chỉ chừa chỗ cho nó.

**Files:**
- Modify: `apps/miniapp/src/components/ui/page-header.tsx`
- Modify: `apps/miniapp/src/components/ui/page-header.spec.tsx`, `apps/miniapp/src/pages/orders.spec.tsx:62-65`
- Modify: `apps/e2e/tests/cart-lines.miniapp.spec.ts:58-60`
- Test: `apps/e2e/tests/cart-lines.miniapp.spec.ts` (ca mới), `apps/miniapp/src/components/ui/page-header.spec.tsx`

**Interfaces:**
- Consumes: `PageHeaderProps` (giữ nguyên `back?: 'auto' | false`), `BackButton` toàn cục (`app.tsx`).
- Produces: `PageHeader` không còn render nút; `back !== false` chỉ còn nghĩa "chừa 48px bên trái tiêu đề".

- [ ] **Step 1: Test đỏ.** Thêm ca e2e vào `cart-lines.miniapp.spec.ts`: `giỏ hàng chỉ có đúng một nút "Quay lại"`: `mockPilotCart(api)`, mở `/cart`, `await expect(page.getByRole('button', { name: 'Quay lại', exact: true })).toHaveCount(1)`. Trong `page-header.spec.tsx` đổi ca `back=false omits the back button` thành `PageHeader không tự vẽ nút lùi (vỏ app có một nút toàn cục): back mặc định không có button "Quay lại"` (mặc định `queryByRole(...)` null), và ca `back=false không chừa chỗ cho nút` kiểm `paddingLeft` của khối tiêu đề là `0px` khi `back={false}` và `48px` khi mặc định.
- [ ] **Step 2: Chạy, thấy đỏ.** Playwright cùng lệnh ở Task 1 với `cart-lines -g "đúng một nút"`; vitest `pnpm --filter @tubutree/miniapp exec vitest run src/components/ui/page-header.spec.tsx`. Expected: e2e đếm 2; vitest đỏ ca "không tự vẽ".
- [ ] **Step 3: Sửa `PageHeader`.** Xoá `import BackButton`, dòng `{back !== false && <BackButton />}` và sửa chú thích đầu file theo thực tế (nút do `app.tsx` dựng, `PageHeader` chỉ chừa chỗ `BACK_BUTTON_TITLE_CLEARANCE`). `orders.spec.tsx` dòng 62–65: đổi ca `...có nút Quay lại` thành kiểm tiêu đề `Đơn hàng` và 7 tab (bỏ khẳng định về nút, ghi rõ ở tên ca vì sao).
- [ ] **Step 4: Đơn giản hoá e2e đang dò.** `cart-lines.miniapp.spec.ts`: `const back = page.getByRole('button', { name: 'Quay lại', exact: true })` thay `locator(...).last()`, bỏ chú thích "trong #main-content còn một nút cùng tên"; vẫn giữ phép thăm dò `elementFromPoint` ở ca "tấm phủ nút" (đó là kiểm lớp phủ, không phải chọn nút). Chạy `cart-lines` toàn spec: xanh.
- [ ] **Step 5: Chạy vitest các spec đụng `PageHeader`.** `pnpm --filter @tubutree/miniapp exec vitest run src/components/ui/page-header.spec.tsx src/pages/orders.spec.tsx src/components/back-button.spec.tsx src/pages/notifications-page.spec.tsx src/pages/bank-payment.spec.tsx`. Expected: xanh.
- [ ] **Step 6: Commit** `fix(miniapp): PageHeader không vẽ nút Quay lại thứ hai (đã có nút toàn cục)`.

---

### Task 3: `/best-sellers?category=` lúc cây danh mục chưa về, tabpanel mang tên "Tất cả"

`activeLabel` rơi về `rank.tabAll` khi `tabs === null` (cây chưa tải) nhưng URL đang lọc một danh mục. Chưa biết tên thì dùng tên trang ("Bán chạy nhất", `rank.title`), cây về rồi thì tên danh mục.

**Files:**
- Modify: `packages/app-core/src/browse/best-sellers.ts` (+ `best-sellers.spec.ts`)
- Modify: `apps/miniapp/src/pages/best-sellers.tsx` (+ `.spec.tsx`), `apps/web/src/app/ban-chay/best-sellers-view.tsx` (+ `.spec.tsx`)
- Test: `apps/e2e/tests/best-sellers.miniapp.spec.ts`

**Interfaces:**
- Produces: `export function bestSellerPanelLabel(tabs: BestSellerTab[] | null, tab: string): string` ở `@tubutree/app-core/browse/best-sellers`: `tab === BEST_SELLERS_ALL_KEY` → `rank.tabAll`; `tabs === null` → `rank.title`; tìm thấy → nhãn tab; không thấy → `rank.tabAll`.

- [ ] **Step 1: Test đỏ ở app-core.** `best-sellers.spec.ts`: `bestSellerPanelLabel(null, BEST_SELLERS_ALL_KEY)` = `'Tất cả'`; `bestSellerPanelLabel(null, 'cat-baby')` = `'Bán chạy nhất'`; `bestSellerPanelLabel(bestSellerTabs(TREE), 'cat-baby')` = `'Cho bé'`; `bestSellerPanelLabel(bestSellerTabs(TREE), 'khong-co')` = `'Tất cả'`. Chạy `pnpm --filter @tubutree/app-core exec vitest run src/browse/best-sellers.spec.ts`: đỏ (hàm chưa có).
- [ ] **Step 2: Cài `bestSellerPanelLabel`** theo bảng trên, dùng `fillCopy`.
- [ ] **Step 3: Test đỏ ở hai app.** Mini `best-sellers.spec.tsx` và web `best-sellers-view.spec.tsx`: mock cây danh mục chưa về (promise treo), URL `?category=cat-baby`; `expect(screen.getByRole('tabpanel')).toHaveAccessibleName('Bán chạy nhất')`; cây về → tên `Cho bé`. Chạy từng file, đỏ.
- [ ] **Step 4: Nối hai trang.** Thay `activeLabel` bằng `bestSellerPanelLabel(tabs, scope.tab)` (Mini và web), bỏ biến `activeLabel` cũ và import thừa. Chạy hai spec: xanh.
- [ ] **Step 5: e2e Mini.** Thêm vào `best-sellers.miniapp.spec.ts` ca `cây danh mục về chậm: ?category= không mang tên "Tất cả" cho tới khi biết tên`: `mockDiscovery(api, { tree: true })`, rồi đăng ký lại `api.get('/categories', async () => { await new Promise(r => setTimeout(r, 1500)); return CATEGORY_TREE; })` (export `CATEGORY_TREE` từ `discovery-mocks.ts` nếu chưa export); mở `/best-sellers?category=cat-baby`; `expect(page.getByRole('tabpanel', { name: 'Tất cả' })).toHaveCount(0)` ngay khi thấy h1, rồi `expect(page.getByRole('tabpanel', { name: 'Cho bé' })).toBeVisible({ timeout: 15_000 })`. Chạy: xanh sau Step 4 (đỏ nếu tạm hoàn tác).
- [ ] **Step 6: Commit** `fix(app-core): tabpanel Bán chạy nhất không mang tên "Tất cả" khi đang lọc mà cây danh mục chưa về`.

---

### Task 4: Dòng "Theo lượt bán 30 ngày qua" khi trang lùi về `best_seller`

`fetchBestSellersPage` lùi về `best_seller` (tổng lượt bán) khi API cũ trả 400 nhưng hai trang vẫn ghi `rank.basis`. Khoá `rank.basisAll` ("Theo tổng lượt bán") đã có trong `shop-copy.ts` và chưa dùng. Hàm trả thêm `basis` để trang nói đúng thước đo. Kệ Bán chạy Trang chủ (`fetchBestSellers`, `best-seller-rail.tsx`) có cùng lùi nhưng không thuộc phạm vi: ghi notes.

**Files:**
- Modify: `packages/app-core/src/api/browse.ts:18-33` (+ `browse.spec.ts`)
- Modify: `packages/app-core/src/browse/best-sellers.ts` (+ spec)
- Modify: `apps/miniapp/src/pages/best-sellers.tsx:77`, `apps/web/src/app/ban-chay/best-sellers-view.tsx:118` (+ spec cả hai)
- Test: `apps/e2e/tests/best-sellers.miniapp.spec.ts`

**Interfaces:**
- Produces (`@tubutree/app-core/api/browse`): `export type BestSellersBasis = 'days30' | 'total'`; `export interface BestSellersPage extends PageResponse<ProductCard> { basis?: BestSellersBasis }`; `fetchBestSellersPage(...)` trả `Promise<BestSellersPage>` (tham số không đổi): `days30` khi `best_seller_30d` thành công, `total` khi lùi.
- Produces (`@tubutree/app-core/browse/best-sellers`): `export function bestSellersBasisCopy(pages: readonly { basis?: BestSellersBasis }[] | undefined): string`: có trang nào `basis === 'total'` → `fillCopy('rank.basisAll')`, ngược lại (kể cả thiếu trường hay chưa có dữ liệu) → `fillCopy('rank.basis')`.
- Consumes: `bestSellersListQuery` (không đổi, kiểu trang suy ra từ hàm).

- [ ] **Step 1: Test đỏ ở app-core.** `browse.spec.ts`: ca `fetchBestSellersPage` thành công trả `basis: 'days30'` cùng `data`/`meta` nguyên vẹn; ca 400 rồi thành công trả `basis: 'total'` (kiểm chứng đã gọi hai lần, lần hai `sort=best_seller`); ca 500 vẫn ném. `best-sellers.spec.ts`: `bestSellersBasisCopy(undefined)` = `'Theo lượt bán 30 ngày qua'`; `[{ basis: 'days30' }]` = cùng chữ; `[{}]` = cùng chữ; `[{ basis: 'days30' }, { basis: 'total' }]` = `'Theo tổng lượt bán'`. Chạy hai file: đỏ.
- [ ] **Step 2: Cài.** `fetchBestSellersPage` trả `{ ...res, basis }`; `bestSellersBasisCopy` như trên. Chạy hai file: xanh.
- [ ] **Step 3: Test đỏ ở hai app.** Spec Mini/web: `useInfiniteQuery` trả trang `basis: 'total'` thì `PageHeader` có chữ phụ `Theo tổng lượt bán` và không có `Theo lượt bán 30 ngày qua`; trang `days30` thì ngược lại.
- [ ] **Step 4: Nối.** `subtitle={bestSellersBasisCopy(products.data?.pages)}` ở cả hai trang. Web: `initial.page` đến từ server (`page.tsx`) mang nguyên trường `basis` (cùng một hàm), không cần sửa `page.tsx`. Chạy hai spec: xanh.
- [ ] **Step 5: e2e Mini.** `best-sellers.miniapp.spec.ts`: ca `API cũ trả 400 cho best_seller_30d: dòng thước đo nói "Theo tổng lượt bán"`: `mockDiscovery(api, { legacy: true })`, mở `/best-sellers`; `expect(page.getByText('Theo tổng lượt bán', { exact: true })).toBeVisible({ timeout: 15_000 })` và `expect(page.getByText('Theo lượt bán 30 ngày qua')).toHaveCount(0)`. Ca mặc định (không legacy) đã có thêm khẳng định dòng 30 ngày hiện.
- [ ] **Step 6: Commit** `fix(app-core): trang Bán chạy nhất nói đúng thước đo khi lùi về tổng lượt bán`.

---

### Task 5: "Nhắc tôi" sau đăng nhập tự đặt nhắc (hai app)

Khách chưa đăng nhập bấm "Nhắc tôi" → đăng nhập → quay lại trang: nhắc phải được đặt, không bấm lần hai. Quyết định dùng chung ở app-core. Mini đăng nhập tại chỗ (không tải lại trang) nên giữ ý định trong bộ nhớ trang; web đi qua `/dang-nhap` rồi quay về nên giữ ở `sessionStorage` (cùng cách `rememberPendingAdd` của `return-to.ts`, nhưng file riêng để không đụng nhau với gói khác).

**Files:**
- Create: `packages/app-core/src/commerce/flash-remind-intent.ts`, `flash-remind-intent.spec.ts`
- Modify: `apps/miniapp/src/pages/flash-sale.tsx` (+ `flash-sale.spec.tsx`), `apps/e2e/tests/flash-slots.miniapp.spec.ts`
- Create: `apps/web/src/lib/pending-remind.ts`, `pending-remind.spec.ts`
- Modify: `apps/web/src/app/gio-vang/flash-slots-view.tsx` (+ `flash-slots-view.spec.tsx`), `apps/e2e/tests/flash-slots.web.spec.ts`

**Interfaces:**
- Produces (`@tubutree/app-core/commerce/flash-remind-intent`): `export interface RemindIntent { itemId: string; startAt: string }`; `export function remindIntentAction(intent: RemindIntent, upcoming: readonly Pick<UpcomingFlashItem, 'itemId' | 'reminded'>[]): 'remind' | 'drop'`: `remind` chỉ khi món có trong danh sách "sắp diễn ra" và `reminded === false`; còn lại `drop` (đã nhắc rồi: không bật lại để khỏi huỷ nhầm; món không còn sắp diễn ra).
- Produces (web `@/lib/pending-remind`): `rememberPendingRemind(intent: RemindIntent): void`, `takePendingRemind(now?: number): RemindIntent | null` (đọc và xoá; quá `PENDING_REMIND_TTL_MS = 10 * 60_000` hoặc sai dạng thì xoá và trả `null`), `clearPendingRemind(): void`. Khoá `tubu_pending_remind`, mọi truy cập storage bọc try/catch.
- Consumes: `remindMut`, `reminded`, `upcomingQ`, `authed`, `phase` của hai trang; `useAuthStore` (Mini); `loginHref` (web).

- [ ] **Step 1: Test đỏ ở app-core.** `flash-remind-intent.spec.ts`: món chưa nhắc → `remind`; món đã `reminded: true` → `drop`; món vắng trong danh sách (khung đã mở, hoặc API không trả) → `drop`; danh sách rỗng → `drop`. Chạy: đỏ. Cài `remindIntentAction`: xanh.
- [ ] **Step 2: Test đỏ cho kho web.** `pending-remind.spec.ts` (jsdom, `sessionStorage`): ghi rồi đọc trả đúng intent và xoá; đọc lần hai `null`; quá TTL (`now` + 11 phút) → `null` và đã xoá; JSON hỏng hoặc thiếu `itemId` → `null`; `clearPendingRemind` xoá; storage ném lỗi (`vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error() })`) không ném ra ngoài. Cài `pending-remind.ts`: xanh.
- [ ] **Step 3: Test đỏ cho Mini.** `flash-sale.spec.tsx`: khách `idle` bấm "Nhắc tôi" → gọi `login` đúng một lần, chưa gọi `setFlashReminder`; sau đó đặt `useAuthStore` sang `authenticated` và `upcoming` trả món chưa nhắc → gọi `setFlashReminder(itemId)` đúng một lần; nếu `upcoming` trả món `reminded: true` → không gọi `setFlashReminder` lẫn `cancelFlashReminder`; nếu phiên rơi `idle`/`error` sau khi bấm → ý định bị bỏ, đăng nhập sau đó không đặt nhắc. Chạy: đỏ.
- [ ] **Step 4: Cài cho Mini.** `const pendingRemind = useRef<RemindIntent | null>(null)`; `onToggleRemind` khi `!authed`: nếu `authStatus !== 'loading'` đặt `pendingRemind.current = { itemId: item.itemId, startAt: activeSlot.startAt }` rồi `login()`. `useEffect` theo `[authStatus, upcomingQ.isSuccess, upcomingQ.data]`: có ý định và `authStatus === 'authenticated'` và `upcomingQ.isSuccess` → `remindIntentAction(intent, upcomingQ.data)`; `remind` thì `remindMut.mutate({ itemId, reminded: false, startAt })`; xoá ref cả hai trường hợp. Phiên `idle`/`error` (không còn `loading`/`authenticated`) → xoá ref. Chạy `flash-sale.spec.tsx`: xanh.
- [ ] **Step 5: e2e Mini.** `flash-slots.miniapp.spec.ts`, mở rộng nhóm "khách chưa đăng nhập": ca `bấm Nhắc tôi, đăng nhập xong tự đặt nhắc không cần bấm lần hai`: `mockNoSession(api)`, `mockFlashSlots(api)`, mở `/flash-sale`, sang tab `20:00`; sau khi phiên đã ở trạng thái khách (như ca có sẵn, đếm `/auth/guest`), gọi `mockSession(api, makeUser({ id: 'user-late', fullName: 'Khách Vừa Đăng Nhập' }))` để lần đăng nhập kế thành công, bấm `Nhắc tôi Sản phẩm Giờ vàng 21`; `await api.waitForCall('POST', '/flash-sales/items/:id/remind')` có `path` `/flash-sales/items/fi-21/remind`; nút đổi thành `Đã đặt nhắc Sản phẩm Giờ vàng 21, bỏ nhắc` (`aria-pressed=true`); số lần `POST remind` đúng 1 và `DELETE` 0. Ca thứ hai `đã nhắc sẵn từ trước thì không đổi gì`: `mockFlashSlots(api, { remindedIds: ['fi-21'] })` cho phiên mới: sau đăng nhập `POST` và `DELETE remind` đều 0 lần.
- [ ] **Step 6: Test đỏ cho web.** `flash-slots-view.spec.tsx`: khách (`phase 'guest'`) bấm "Nhắc tôi" → `rememberPendingRemind` được gọi với `{ itemId, startAt }` rồi `router.push(loginHref('/gio-vang'))`; render lại ở `authed` với `takePendingRemind` trả intent và `upcoming` có món chưa nhắc → `setFlashReminder` gọi đúng một lần (không lặp khi render lại); `upcoming` có món đã nhắc → không gọi gì; `phase === 'guest'` khi mount → `clearPendingRemind` được gọi (khách quay về mà không đăng nhập). Chạy: đỏ.
- [ ] **Step 7: Cài cho web.** `needSession` giữ nguyên; `onToggleRemind` ghi `rememberPendingRemind` ngay trước `needSession()` khi `phase === 'guest'`. `useRef<boolean>` `intentHandled`; `useEffect([authed, upcomingQ.isSuccess, upcomingQ.data])`: `authed && upcomingQ.isSuccess && !intentHandled.current` → `intentHandled.current = true`, `takePendingRemind()`, nếu có thì `remindIntentAction` → `remindMut.mutate({ itemId, reminded: false, startAt })`. `useEffect([phase])`: `phase === 'guest'` → `clearPendingRemind()`. Chạy `flash-slots-view.spec.tsx` và `pending-remind.spec.ts`: xanh.
- [ ] **Step 8: Cập nhật e2e web.** `flash-slots.web.spec.ts` ca khách (dòng ~148): thêm khẳng định `sessionStorage.getItem('tubu_pending_remind')` chứa `fi-21` ngay sau khi bấm, và `POST remind` 0 lần; ca đăng nhập quay lại viết như sau: đặt `sessionStorage` `tubu_pending_remind` bằng `addInitScript` + phiên khôi phục như `profile-calls.web.spec.ts` (`tubu_web_session`, `/auth/refresh`, `/me`) và `mockFlashSlots`: mở `/gio-vang`, chờ `POST /flash-sales/items/fi-21/remind`. Spec web cần API thật nên chạy cục bộ bằng API giả theo `handoff-wave2.md`; nếu không chạy được ghi "chưa chạy" vào notes để CI chạy.
- [ ] **Step 9: Commit** hai lần: `feat(app-core): quyết định đặt nhắc sau đăng nhập cho Nhắc tôi` (app-core + web kho + spec) rồi `fix(miniapp,web): Nhắc tôi tự đặt sau khi khách đăng nhập` (hai trang + e2e).

---

### Task 6: CLS Trang chủ web từ lg khi banner có gợi ý nhưng phiên chưa khôi phục

Khung chờ chung (`HomeSettlingSkeleton`) vẽ khung banner với `lg:hidden` (từ lg banner nằm cột 8 của `HubLayout`), nhưng trong lúc `settling` thứ tự khối bị cắt sau thẻ thành viên nên `banner` KHÔNG nằm trong `order`, `HubLayout` không có cột banner. Khi hết chờ cột banner (cao theo bề ngang 8 cột) chen vào hàng đầu và đẩy mọi khối dưới xuống. Sửa: trong lúc `settling`, nếu có gợi ý banner thì đặt khung giữ chỗ ở slot `banner` của `HubLayout` (điện thoại: `display: contents` nên vẫn đứng ngay sau thẻ thành viên, đúng vị trí cũ) và bỏ khung banner riêng trong khung chờ chung, để chỉ có một khung ở mọi khổ.

**Files:**
- Create: `apps/e2e/tests/home-banner-lg.web.spec.ts`
- Modify: `apps/web/src/components/home/home-view.tsx:127-211`, `apps/web/src/components/home/home-settling.tsx`
- Test: `apps/web/src/components/home/home-view.spec.tsx`, `home-settling.spec.tsx`

**Interfaces:**
- Consumes: `useHomeBanners` (`hinted`, `loading`, `slides`), `HomeBanner`, `HubLayout` (prop `banner`), `homeRenderOrder`.
- Produces: không đổi chữ ký công khai. `HomeSettlingSkeleton` giữ prop `banner?: boolean` (mặc định false) nhưng `home-view.tsx` không còn truyền `true` (khung banner do `HubLayout` giữ); prop vẫn dùng được cho nơi dựng khung chờ không có `HubLayout`.

- [ ] **Step 1: Viết e2e web đo CLS và chỗ giữ.** `home-banner-lg.web.spec.ts`, project Desktop Chrome (`test.skip` nếu tên project không phải `Web Customer`), viewport 1280×800, `tubu_home_banner='1'` và `tubu_web_session='1'` qua `addInitScript`, `/auth/refresh` trả chậm 900ms, `/me`, `/me/purchased-items` (một món), `/config/public`, `/me/new-customer-offer`, và `GET /campaigns?placement=HOME_TOP...` trả một chiến dịch có ảnh (theo hợp đồng của `useCampaignSlides`; xem mock trong `campaigns.web`/`home-view.spec.tsx` để lấy đúng dạng) trả chậm 1500ms; copy bộ đo `PerformanceObserver('layout-shift')` từ `profile-calls.web.spec.ts`. Hai ca: (a) trong lúc phiên chưa về, `[data-testid="home-banner-loading"]` hiện và nằm bên trái thẻ thành viên (cùng hàng: `banner.y` ≈ `aside.y`, `banner.width` ≈ 8/12 khung) ở 1280px; (b) tổng CLS cả lượt tải `< 0.01` và không có dịch chuyển nào có nguồn là `data-home-block="categories"`/`flash`. Điện thoại 375px (project `Web Customer Mobile`, ca thứ ba): đếm `[data-testid="home-banner-loading"]` đúng 1.
- [ ] **Step 2: Dựng API giả, chạy, thấy đỏ.** Theo `handoff-wave2.md` (API giả trả `/api/health` 200, `/api/products` dạng `{data,meta}`, còn lại 404), `next dev` cổng 3330 (`E2E_SCOPE=web E2E_API_PORT=<cổng giả> E2E_WEB_PORT=3330 npx playwright test home-banner-lg --project='Web Customer' --retries=0 --workers=1`). Expected: đỏ ở (a) hoặc (b) với dịch chuyển của khối Danh mục/Giờ vàng; ghi số CLS vào log để so.
- [ ] **Step 3: Test đỏ ở vitest.** `home-view.spec.tsx`: khách có phiên chưa khôi phục, `localStorage[BANNER_HINT_KEY]='1'`, banner `loading`: `HubLayout` có `[data-hub-part="banner"]` chứa `home-banner-loading` và `home-settling` KHÔNG chứa khung banner riêng (`querySelectorAll('[data-testid="home-banner-loading"]').length === 1`); không có gợi ý → không có khung nào. `home-settling.spec.tsx` giữ nguyên ca `banner=true`. Chạy hai file: đỏ ca mới.
- [ ] **Step 4: Sửa `home-view.tsx`.** `settling` (khung chờ trong `blocks.settling`) không truyền `banner` nữa (`banner={false}`); `hasBanner` được tính từ `blocks.banner != null && (order.includes('banner') || (settling && banners.hinted && banners.loading))`; `wrap('banner')` chạy kể cả khi `order` chưa có `banner` (dùng cùng `wrap`). `rest` không lọc `banner` ra hai lần (đã lọc bằng `hasBanner`). Chú thích vì sao (khung banner ở slot `HubLayout` để lg giữ cột 8, điện thoại `contents`). Chạy hai spec vitest: xanh.
- [ ] **Step 5: Chạy e2e web (Step 2)** lặp `--repeat-each=10 --retries=0` ở lg và ở `Web Customer Mobile`. Expected: xanh, CLS lg `< 0.01`. Chạy lại `profile-calls.web.spec.ts` ca khách cũ/mới (CLS không tăng so với số đã ghi: 0,1 cho khách cũ, 0,01 cho khách mới).
- [ ] **Step 6: Commit** `fix(web): giữ chỗ banner Trang chủ ở cột 8 khi còn chờ phiên (CLS lg)`.

---

### Task 7: Danh mục "Tẩy rửa sinh học" khác icon giữa Mini và web

Đã đối chiếu: `CATEGORY_ICONS` ở Mini (`use-categories.ts`) và web (`browse-categories.ts`) là hai bản chép giống hệt nhau (`tay-rua-sinh-hoc` → `Sparkles` ở cả hai); mock Mini (`discovery-mocks.ts`) dùng đúng slug này. Khác biệt ở ảnh P6 do API giả của web dùng slug khác (rơi về `LayoutGrid`), không phải lỗi mã. Hai bản chép là chỗ trượt sau này, nên gom thành một bảng slug → khoá icon ở app-core (kiểu `Record` đủ khoá nên thiếu icon là lỗi tsc); mỗi app chỉ ánh xạ khoá sang `LucideIcon`.

**Files:**
- Create: `packages/app-core/src/browse/category-icons.ts`, `category-icons.spec.ts`
- Modify: `apps/miniapp/src/hooks/use-categories.ts:18-27,52`, `apps/web/src/lib/browse-categories.ts:15-24,48`

**Interfaces:**
- Produces (`@tubutree/app-core/browse/category-icons`): `export type CategoryIconKey = 'flower' | 'sparkles' | 'baby' | 'heart-handshake' | 'smile' | 'coffee' | 'wheat'`; `export const CATEGORY_ICON_KEYS: Readonly<Record<string, CategoryIconKey>>`; `export function categoryIconKey(slug: string | null | undefined): CategoryIconKey | null`. Bảy slug: `my-pham-thien-nhien` → flower, `tay-rua-sinh-hoc` → sparkles, `cho-be` → baby, `cho-me-bau` → heart-handshake, `cham-soc-ca-nhan` → smile, `ca-phe-do-uong` → coffee, `nong-san-thuc-pham` → wheat.
- Consumes: `CategoryEntry.icon: LucideIcon` ở cả hai app (không đổi).

- [ ] **Step 1: Test đỏ.** `category-icons.spec.ts`: `categoryIconKey('tay-rua-sinh-hoc')` = `'sparkles'`; bảy slug chuẩn cho bảy khoá khác nhau; slug lạ, `''`, `null`, `undefined` → `null`. Chạy `pnpm --filter @tubutree/app-core exec vitest run src/browse/category-icons.spec.ts`: đỏ.
- [ ] **Step 2: Cài `category-icons.ts`**, rồi ở mỗi app thay `CATEGORY_ICONS` bằng `ICON_BY_KEY: Record<CategoryIconKey, LucideIcon>` và `icon: ICON_BY_KEY[categoryIconKey(c.slug) ?? ''] ?? LayoutGrid` (viết cho gọn: tách hàm `iconFor(slug)`), giữ nguyên import lucide cần dùng.
- [ ] **Step 3: Chạy test cũ của hai app.** `pnpm --filter @tubutree/miniapp exec vitest run src/hooks/use-categories.spec.ts` và `pnpm --filter @tubutree/web exec vitest run src/lib/browse-categories.spec.ts` (hai ca "7 danh mục chuẩn có icon khác LayoutGrid và khác nhau từng đôi" phải vẫn xanh): xanh.
- [ ] **Step 4: Commit** `refactor(app-core): một bảng slug → icon cho danh mục ở Mini và web`.

---

### Task 8: Ảnh 375px, bộ e2e Mini, gate

- [ ] **Step 1: Chụp 375px** Mini (Vite 3329) và web (Next dev 3330 + API giả): thanh tab dính trang thương hiệu cuộn giữa (safe-top 47), Bán chạy nhất với `?category=` lúc cây về chậm và ở chế độ lùi `total`, Trang chủ lưới danh mục có "Tẩy rửa sinh học" ở hai app, giỏ Mini đầu trang. Lưu vào `docs/2026-10-31-shop-redesign/screens/F6/` (gitignore). Tắt server của mình (kill đúng PID đã mở) trước khi chạy e2e đầy đủ.
- [ ] **Step 2: Bộ e2e Mini** `cd apps/e2e && E2E_SCOPE=miniapp E2E_MINIAPP_PORT=3329 npx playwright test --workers=2 --reporter=line` (~4 phút). Ca cũ đỏ vì thiết kế đã chốt thì sửa test theo thiết kế, ghi notes; đỏ vì hồi quy thì sửa mã.
- [ ] **Step 3: Gate đúng một lần.** `bash docs/2026-10-28-review/tools/gate.sh /Users/longla/coding/tubutree-mini-app/.claude/worktrees/shop-F6 --base d768f7d42 --out /Users/longla/coding/tubutree-mini-app/.claude/worktrees/gate-F6.txt`. Bước FAIL: chạy riêng file đỏ trước (máy quá tải sinh FAIL giả); còn đỏ thì so với base `d768f7d42` qua worktree tạm, "có sẵn" thì ghi, do gói thì sửa.
- [ ] **Step 4: Cập nhật PROGRESS?** Không (file thuộc điều phối); thông tin trả qua notes.

---

## Self-review

- **Spec coverage:** (1) Task 1; (2) Task 2; (3) Task 3; (4) Task 4; (5) Task 5; (6) Task 6; (7) Task 7. Ảnh, e2e Mini, gate: Task 8.
- **Step scan:** mỗi bước có lệnh chạy hoặc chữ ký; thân hàm chỉ nằm ở bảng quyết định (Task 3, 4, 5) và số đo (Task 1).
- **Type consistency:** `BestSellersBasis` ('days30' | 'total') dùng ở Task 4 cho `fetchBestSellersPage`, `bestSellersBasisCopy` và hai trang; `RemindIntent` định nghĩa ở Task 5 app-core và web `pending-remind.ts` import lại; `bestSellerPanelLabel` ở Task 3 dùng `BestSellerTab` có sẵn; `CategoryIconKey` chỉ ở Task 7.
- **Review Focus:** mục 1, 2 → Task 5 (spec app-core và e2e "đã nhắc sẵn"); 3 → Task 3; 4 → Task 4; 5 → Task 6 (ca đếm khung ở 375px). Không có mục nào chưa có task.
- **Proportion:** kế hoạch ngắn hơn đoạn mã nó mô tả cộng test; không chép thân hàm.
