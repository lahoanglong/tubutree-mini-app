# F7a customer-minors Implementation Plan

> **Cho agent làm:** dùng superpowers:executing-plans. Bước dùng checkbox `- [ ]`.

**Mục tiêu:** sửa 8 phát hiện MINOR mà reviewer Opus để lại cho P14 (mã giảm giá), P16 (danh mục), F6 (sửa việc mở), P17a (cơ chế) ở phía khách: ví lỗi không gắn nhãn sai, mã khách-mới đã nhận mà không còn áp dụng, mẫu gian hàng theo danh mục cha, chữ đếm ngược Giờ vàng, thứ tự Tab của nút Quay lại Mini, thước đo kệ Bán chạy nhất Trang chủ, khung chờ banner web, spec CLS chạy được trên CI.

**Kiến trúc:** logic ở `packages/app-core` (voucher-center, api/browse, commerce/campaign); hai app chỉ nối. API chỉ thêm một trường cộng thêm vào `GET /coupons/collectable/mine` (client cũ bỏ qua, client mới chịu được thiếu trường) và một lệnh lọc danh mục con ở `applyTemplate`.

**Tech stack:** vitest (app-core, miniapp, web), jest (api), Playwright (apps/e2e), React Query.

**Spec:** `docs/2026-10-31-shop-redesign/01-thiet-ke.md` (§4 là luật: Q3 chữ đếm ngược "2 giờ 05 phút", Q5 tên chữ, Q10 `/offers`), không có mục F7a trong `02-ke-hoach.md`; việc lấy từ ghi chú review của P14, P16, F6, P17a (nêu trong lệnh giao gói).

## Global Constraints

- Node: `export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH`; `pnpm --filter @tubutree/shared-types build` và `npx prisma generate` (trong `apps/api`) trước gate.
- Mini App và web cùng gói; logic ở `packages/app-core`, app không chép logic. `pnpm lint:parity` xanh.
- Chữ cấm: "Top", "Freeship", "Kho voucher", "Nhãn hàng", dạng "2h 05m" (`FORBIDDEN_TERMS`, `shop-copy.ts`). Khoá chữ mới thêm vào `shop-copy.ts` và `shop-copy-budget.ts` (ngân sách độ dài).
- Chunk vào Mini ≤ 700 KB; vùng chạm ≥ 44px; axe 0 vi phạm.
- Không sửa file của P15 (giỏ, báo giá/đặt đơn, `product-detail.tsx`, `pdp-bundles`, khối combos Trang chủ, admin bundles) và F7b (admin danh mục, `category-admin.service.ts`, trình dựng gian hàng Mini/web); không đụng `todo-strip` và hook `/orders` Trang chủ (7e). Buộc phải đụng thì ghi notes.
- Không push, không đọc/ghi PROD, không `git stash` trần. Máy thiếu RAM: chạy test theo file; gate đầy đủ đúng một lần ở cuối.
- Comment chỉ giải thích "vì sao", tiếng Việt, theo mật độ file xung quanh.

## Review Focus

1. Ví tải lỗi nhưng đã có cache cũ (react-query giữ `data` khi refetch lỗi): dùng dữ liệu cũ, không báo "ví lỗi". Test T1.
2. Ví lỗi và API `mine` cũ chưa có trường mới (`claimedIneligible` thiếu): không vỡ, chạy như trước. Test T1/T2.
3. Mã khách-mới đã nhận, đã DÙNG (đủ `perUserLimit`) rồi mới có đơn: vẫn là "Đã dùng", không thành "không còn áp dụng". Test T2 (jest).
4. Chọn mẫu theo danh mục cha có vòng `parentId` hoặc cha không có con: không treo, trả đúng như trước với lá. Test T3.
5. API cũ trả 400 cho `best_seller_30d` ở Trang chủ: kệ vẫn hiện, ghi "Theo tổng lượt bán"; lỗi khác 400 vẫn là lỗi khối. Test T6.
6. Chiến dịch riêng NEW/RETURNING còn ẩn vì chưa biết loại khách: khung chờ banner vẫn giữ; danh sách server rỗng thật thì không giữ. Test T7.

---

## File Structure

| File | Việc |
|---|---|
| `packages/app-core/src/commerce/voucher-center.ts` (+spec) | `collectRows` nhận ví `null`; `claimedIneligible`; `walletCodeSet` |
| `packages/app-core/src/api/coupon-collect.ts` (+spec) | `CollectableMineDTO.claimedIneligible?` |
| `packages/app-core/src/queries/loyalty.ts` | sửa comment staleTime |
| `packages/app-core/src/shop-copy.ts`, `shop-copy-budget.ts` | khoá `coupon.claimedIneligibleReason`, `coupon.walletLoadError` |
| `apps/api/src/modules/coupons/coupon-collect.service.ts` (+spec) | `mine()` trả `claimedIneligible` |
| `apps/miniapp/src/pages/vouchers.tsx`, `apps/web/src/app/ma-giam-gia/vouchers-view.tsx` (+spec) | ví lỗi → dải thử lại, thẻ không nút |
| `apps/api/src/modules/catalog/category-scope.ts` (mới, +spec), `catalog.service.ts`, `storefront/storefront.service.ts` (+spec) | `applyTemplate` gồm con của danh mục cha |
| `apps/miniapp/src/hooks/use-countdown.ts`, `apps/web/src/lib/use-countdown.ts` (+spec), `packages/app-core/src/commerce/countdown.ts`, `countdown-format.ts` (xoá), `terminology.spec.ts` | đếm ngược theo `countdownText`, xoá `formatCountdown` |
| `apps/miniapp/src/components/app.tsx` (+`app-focus-order.spec.ts`), `apps/e2e/tests/back-button-focus.miniapp.spec.ts` | nút Quay lại lên trước `<main>` |
| `packages/app-core/src/api/browse.ts`, `queries/home.ts` (+spec), Mini/web `use-home-shelves.ts`, `best-seller-rail.tsx`, `home.tsx`/`home-view.tsx` | basis kệ Bán chạy Trang chủ |
| `packages/app-core/src/commerce/campaign.ts` (+spec), `apps/web/src/components/campaign/use-campaign-slides.ts`, `use-home-banners.ts`, `home-view.tsx` | hold khung chờ banner theo `revealable` |
| `apps/e2e/tests/home-banner-lg.web.spec.ts` | bỏ skip, tự bỏ danh sách chiến dịch của server khỏi tài liệu |

---

### Task 1: Tab Nhận mã, ví lỗi không suy ra "Đã dùng"

**Files:** Modify `voucher-center.ts`, `vouchers.tsx` (Mini), `vouchers-view.tsx` (web), `shop-copy.ts`, `shop-copy-budget.ts`; Test `voucher-center.spec.ts`, `apps/miniapp/src/pages/vouchers.spec.tsx`, `apps/web/src/app/ma-giam-gia/vouchers-view.spec.tsx`.

**Interfaces:**
- Produces: `collectRows(collectable, walletCodes: ReadonlySet<string> | null, now, mine?)` (`null` = ví chưa tải được); `VoucherRow.unverified?: true`; `walletCodeSet(wallet: readonly CouponDTO[] | undefined, failed: boolean): ReadonlySet<string> | null`; khoá chữ `coupon.walletLoadError`.

- [ ] **Step 1: Test đỏ** (`voucher-center.spec.ts`): `collectRows([collectable('A')], null, NOW, mineOf({ claimed: ['A'] }))` cho `view.state === 'saved'`, `row.unverified === true`, KHÔNG phải `used`; mã không có trong `mine.claimed` vẫn `collectable`; `walletCodeSet(undefined, true)` là `null`, `walletCodeSet(undefined, false)` là tập rỗng, `walletCodeSet([wallet('A')], true)` là `Set(['A'])` (cache cũ thắng).
- [ ] **Step 2:** `npx vitest run src/commerce/voucher-center.spec.ts` (trong `packages/app-core`) → FAIL.
- [ ] **Step 3:** cài đặt trong `voucher-center.ts`: `walletCodes === null` thì mã đã nhận (không trong `claimedIneligible`) → `claimed: true, used: false`, `unverified: true`; thêm `walletCodeSet`.
- [ ] **Step 4: Test đỏ trang** (cả Mini và web, `walletQ` lỗi, `mine.claimed = ['A']`): thẻ A không có chữ "Đã dùng", không có nút "Dùng ngay", có `role=alert`/ErrorState "Chưa tải được mã đã lưu của bạn" với nút "Thử lại" gọi lại `/me/coupons`. Cài trang: `walletCodes = walletCodeSet(walletQ.data, walletQ.isError)`, dải lỗi trên tab Nhận mã khi `walletCodes === null`, `primaryFor` trả `undefined` khi `row.unverified`.
- [ ] **Step 5:** chạy ba file spec → PASS. Commit `fix(app-core,miniapp,web): ví lỗi không gắn nhãn "Đã dùng" cho mã đã nhận`.

### Task 2: Mã khách-mới đã nhận mà không còn áp dụng (API + UI) và comment staleTime

**Files:** Modify `coupon-collect.service.ts`, `api/coupon-collect.ts`, `voucher-center.ts`, `shop-copy.ts`, `queries/loyalty.ts`; Test `coupon-collect.service.spec.ts`, `voucher-center.spec.ts`, `coupons.controller.spec.ts` (nếu kiểm hình).

**Interfaces:**
- Produces: `CollectableMine.claimedIneligible: string[]` (API), `CollectableMineDTO.claimedIneligible?: string[]`; khoá chữ `coupon.claimedIneligibleReason` = "Chỉ dành cho khách đặt đơn đầu tiên, nên không còn áp dụng".
- Luật: `claimedIneligible` = mã trong kho, khách đã nhận, `newCustomerOnly`, khách đã có đơn, và CHƯA dùng hết `perUserLimit` (đã dùng hết thì là `used` như trước; mirror `getAvailableCoupons`: `perUserLimit > 0 && redemptions >= perUserLimit`).

- [ ] **Step 1: Jest đỏ** (`CouponCollectService.mine`): (a) mã khách-mới đã nhận + khách có đơn + chưa redeem → nằm ở `claimedIneligible` và vẫn ở `claimed`; (b) cùng nhưng đã redeem đủ `perUserLimit` → không ở `claimedIneligible`; (c) khách chưa có đơn → rỗng; (d) kho trống → `{ claimed: [], newCustomerOnly: [], claimedIneligible: [] }`, không đọc đơn; (e) không có mã khách-mới nào → không đọc đơn. Cập nhật hai ca cũ cần hình `{claimed, newCustomerOnly}` thêm `claimedIneligible: []`.
- [ ] **Step 2:** `cd apps/api && npx jest src/modules/coupons/coupon-collect.service.spec.ts` → FAIL.
- [ ] **Step 3:** `mine()` đọc `perUserLimit` trong `select`; hỏi đơn khi có mã `newCustomerOnly` (đã nhận hay chưa); với mã đã nhận + khách-mới + có đơn, một `couponRedemption.groupBy` theo `couponId` cho `userId`.
- [ ] **Step 4: Vitest đỏ** (`voucher-center.spec.ts`): `mine.claimedIneligible = ['I']` và `I` không có trong ví → `state 'ineligible'`, `reason` = `coupon.claimedIneligibleReason`, không `used`; `I` trong ví thì ví quyết định (`saved`); thiếu `claimedIneligible` (API cũ) → như trước (`used`); ví `null` + `claimedIneligible` → vẫn `ineligible`. Cài trong `collectRows`.
- [ ] **Step 5:** sửa comment `queries/loyalty.ts:24` đúng: `staleTime` 30 giây bằng `s-maxage=30` của route; trình duyệt giữ thêm `max-age=15`, nên lần tải lại ngay sau nhận mã bị từ chối dùng `fresh`.
- [ ] **Step 6:** chạy jest + vitest các file trên → PASS. Commit `feat(api,app-core): mã khách-mới đã nhận mà khách có đơn thì báo "không còn áp dụng", không "Đã dùng"`.

### Task 3: `applyTemplate` gồm con của danh mục cha

**Files:** Create `apps/api/src/modules/catalog/category-scope.ts` (+`category-scope.spec.ts`); Modify `catalog.service.ts` (`categoryScope` dùng helper), `storefront.service.ts`; Test `storefront.service.spec.ts`.

**Interfaces:**
- Produces: `childrenByParent(rows: { id: string; parentId: string | null }[]): Map<string, string[]>`; `expandCategoryScope(children: Map<string, string[]>, id: string): string[]` (`[id, ...con cháu]`, có `visited` chống vòng).

- [ ] **Step 1: Test đỏ** `category-scope.spec.ts` (cha có 2 con → 3 id; lá → `[id]`; vòng `a→b→a` không treo) và `storefront.service.spec.ts`: `category.findMany` trả cây, `applyTemplate('u1','cat1')` truyền `where.categoryIds = { hasSome: ['cat1','c1','c2'] }`; cha không con vẫn `hasSome: ['cat1']`; các ca cũ cập nhật `has` thành `hasSome`.
- [ ] **Step 2:** chạy → FAIL. **Step 3:** cài helper; `applyTemplate` đọc `category.findMany({ select: { id, parentId } })`; `catalog.service.ts` đổi vòng BFS tại chỗ sang `expandCategoryScope` (hành vi giữ nguyên).
- [ ] **Step 4:** `npx jest src/modules/catalog src/modules/storefront` → PASS. Commit `fix(api): mẫu gian hàng theo danh mục cha gồm sản phẩm của mục con`.

### Task 4: Chữ đếm ngược "Sắp diễn ra" theo `countdownText`

**Files:** Modify Mini `hooks/use-countdown.ts`, web `lib/use-countdown.ts`, `app-core/commerce/countdown.ts` (xoá `formatCountdown`), xoá `app-core/src/countdown-format.ts` + `.spec.ts`; Test hai `use-countdown.spec.tsx`, hai spec đồng hồ máy chủ (`hooks/server-clock.spec.tsx`, `lib/server-clock-web.spec.tsx`), `commerce/countdown.spec.ts`, `terminology.spec.ts`.

**Interfaces:** `useCountdown(target: Date | string | null): string` đổi đầu ra thành `countdownText(ms)` (floor theo phút; dưới 1 phút "dưới 1 phút"; hết giờ/NaN/null → `''`).

- [ ] **Step 1: Test đỏ:** hai `use-countdown.spec.tsx`: còn 2h05m → `'2 giờ 05 phút'`, 59 giây → `'dưới 1 phút'`, null/rác/đã qua → `''`; hai spec đồng hồ máy chủ: còn 8 phút theo máy chủ → `'8 phút'`. `terminology.spec.ts`: bỏ `it.fails`, thay bằng ca thường "không file giao diện nào còn nhắc `formatCountdown`" (quét `loadSources()` ngoài spec) và `countdownText(2h05m)` không dính `FORBIDDEN_TERMS`; sửa comment ca đó.
- [ ] **Step 2:** chạy → FAIL. **Step 3:** `useCountdown` gọi `countdownText`; bỏ re-export `formatCountdown`; xoá `formatCountdown`, `countdown-format.ts` và spec tương ứng (trong `countdown.spec.ts` bỏ khối bản cũ).
- [ ] **Step 4:** chạy các file → PASS; `grep -rn formatCountdown apps packages` rỗng. Commit `fix(miniapp,web): thẻ "Sắp diễn ra" ghi "Bắt đầu sau 2 giờ 05 phút" theo luật chữ`.

### Task 5: Nút Quay lại Mini lên trước `<main>` trong thứ tự DOM

**Files:** Modify `apps/miniapp/src/components/app.tsx`; Create `apps/miniapp/src/components/app-focus-order.spec.ts`, `apps/e2e/tests/back-button-focus.miniapp.spec.ts`.

- [ ] **Step 1: Test đỏ:** vitest đọc `app.tsx`: chỉ số `<BackButton />` nhỏ hơn `<MainLandmark>` và `<BottomNav />`. E2E (mock API): mở `/orders` (trang con, có nút lùi), nhấn Tab một lần → phần tử focus có tên "Quay lại".
- [ ] **Step 2:** chạy vitest → FAIL. **Step 3:** dời `<BackButton />` ngay sau `<ScreenTracker />` (trước `LivePathnameProvider`/`MainLandmark`); nút `position: fixed` nên hình không đổi.
- [ ] **Step 4:** vitest → PASS; chạy riêng spec e2e (`E2E_SCOPE=miniapp E2E_MINIAPP_PORT=3341 npx playwright test back-button-focus`) → PASS. Commit `fix(miniapp): nút Quay lại đứng trước nội dung chính trong thứ tự Tab`.

### Task 6: Kệ Bán chạy nhất Trang chủ ghi đúng thước đo (basis)

**Files:** Modify `app-core/src/api/browse.ts`, `queries/home.ts`; Mini `components/home/use-home-shelves.ts`, `best-seller-rail.tsx`, `pages/home.tsx`; web `components/home/use-home-shelves.ts`, `best-seller-rail.tsx`, `home-view.tsx`; Test `api/browse.spec.ts`, `queries/home.spec.ts` (nếu có), spec kệ hai app.

**Interfaces:**
- Produces: `bestSellersWithBasis(load: (sort: 'best_seller_30d' | 'best_seller') => Promise<PageResponse<ProductCard>>): Promise<BestSellersPage>` (400 ở 30 ngày → lùi `best_seller`, `basis: 'total'`; lỗi khác ném); `fetchBestSellersPage` và `homeBestSellerQuery` dùng nó; `HomeShelves.bestSellerBasis: BestSellersBasis`; `BestSellerRail` thêm prop `basis?: BestSellersBasis` (mặc định `days30`), phụ đề `bestSellersBasisCopy([{ basis }])`.
- Thực tế code: Trang chủ không dùng `fetchBestSellers` (hub Danh mục dùng, và hub không có phụ đề); Trang chủ gọi `fetchProducts(30d)` không lùi. Gói này cho Trang chủ lùi như trang Bán chạy nhất và ghi đúng phụ đề.

- [ ] **Step 1: Test đỏ:** `bestSellersWithBasis` (200 → `days30`; 400 rồi 200 → `total`, hai lần gọi, lần hai `sort: 'best_seller'`; 500 → ném); `homeBestSellerQuery(http).queryFn()` với `/products` trả 400 cho `best_seller_30d` → `basis 'total'`; `BestSellerRail basis="total"` ghi "Theo tổng lượt bán", mặc định ghi "Theo lượt bán 30 ngày qua".
- [ ] **Step 2:** chạy → FAIL. **Step 3:** cài; Mini dùng `bestSellersWithBasis((sort) => fetchProducts({ limit: HOME_BEST_SELLER_LIMIT, sort }))` ở cả hai nơi khai query cùng khoá; `useHomeShelves` (hai app) trả `bestSellerBasis = bestSellerQuery.data?.basis ?? 'days30'`; `home.tsx`/`home-view.tsx` truyền `basis`; `BestSellerRailQuery` tự đọc `q.data?.basis`.
- [ ] **Step 4:** chạy các file → PASS. Commit `fix(app-core,miniapp,web): kệ Bán chạy nhất Trang chủ lùi về tổng lượt bán và ghi đúng thước đo`.

### Task 7: Web Trang chủ không giữ khung chờ banner khi server đã trả danh sách rỗng

**Files:** Modify `app-core/src/commerce/campaign.ts`, `apps/web/src/components/campaign/use-campaign-slides.ts`, `use-home-banners.ts`, `home-view.tsx`; Test `commerce/campaign.spec.ts`, spec `home-view`/`use-home-banners` web.

**Interfaces:**
- Produces: `campaignsRevealByKind(list: readonly CampaignBanner[] | null | undefined, o: { platform: 'mini' | 'web'; now?: number }): boolean` — có chiến dịch hiện được cho khách mới hoặc khách cũ (`campaignSlides` kind `new`/`returning` khác rỗng); `useCampaignSlides` trả thêm `revealable: boolean` (chỉ khi `kind === 'unknown'`); `useHomeBanners` trả thêm `loaded` và `revealable`.
- Luật giữ chỗ: `slides.length > 0 || (hinted && (loading || (settling && (!loaded || revealable))))`. Danh sách chưa biết (`!loaded`) giữ như cũ; danh sách đã biết mà không có chiến dịch riêng loại khách thì không giữ. API không có `audience` nên danh sách server gồm MỌI đối tượng, lọc theo loại khách ở máy khách (`campaignVisible`).

- [ ] **Step 1: Test đỏ:** `campaignsRevealByKind` (chỉ `ALL` → false; có `NEW` còn hạn → true; `RETURNING` hết hạn theo `now` → false; undefined → false); `home-view` web: `initial.campaigns = []`, `tubu_home_banner = '1'`, `kind` chưa biết → không có `home-banner-loading`; `initial.campaigns = [chiến dịch RETURNING còn hạn]` cùng điều kiện → có khung chờ; `initial.campaigns` thiếu + còn đang tải → có khung chờ.
- [ ] **Step 2:** chạy → FAIL. **Step 3:** cài theo Interfaces.
- [ ] **Step 4:** chạy → PASS. Commit `fix(web): Trang chủ không giữ khung chờ banner khi server đã trả danh sách chiến dịch rỗng`.

### Task 8: `home-banner-lg.web.spec.ts` chạy được trên CI

**Files:** Modify `apps/e2e/tests/home-banner-lg.web.spec.ts`.

- [ ] **Step 1:** thay `test.skip(!asked, ...)` bằng điều kiện chắc chắn: trong `openHome`, `page.route` cho tài liệu `/` gọi `route.fetch()`, bỏ thuộc tính `campaigns` khỏi dữ liệu flight nhúng trong HTML (khớp `\"campaigns\":[...]` bằng đếm ngoặc), đặt `expect(removed).toBeGreaterThan(0)` khi server có trả danh sách (API thật, kể cả `[]`) và chấp nhận 0 khi server không có thuộc tính (API giả 404); sau đó chờ yêu cầu `/campaigns?placement=HOME_TOP` từ trình duyệt và **không** skip: không thấy yêu cầu thì đỏ.
- [ ] **Step 2:** chạy spec với Next + API giả cục bộ (cổng 3342) nếu dựng được; không thì ghi "chưa chạy" vào notes, CI chạy. Commit `test(e2e): home-banner-lg không tự skip khi server đã dựng danh sách chiến dịch`.

### Task 9: Gate, e2e Mini, chụp 375px

- [ ] `bash docs/2026-10-28-review/tools/gate.sh <worktree> --base e3229fe39 --out .../gate-F7a.txt`; race spec liên quan (`coupon-collectable-last-slot`, `my-coupons-query`) với DB `tubutree_it` ở cổng 25549 rồi `pg-native.sh stop 25549`.
- [ ] Bộ e2e Mini (`E2E_SCOPE=miniapp E2E_MINIAPP_PORT=3341 npx playwright test --workers=2 --reporter=line`).
- [ ] Chụp 375px `/vouchers` (Mini cổng 3341) và `/ma-giam-gia` (web cổng 3342) ở trạng thái ví lỗi và mã không còn áp dụng, lưu `docs/2026-10-31-shop-redesign/screens/F7a/`, tắt server.
