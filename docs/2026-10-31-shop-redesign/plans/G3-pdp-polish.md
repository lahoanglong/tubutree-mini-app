# G3 `pdp-polish` (đợt 6a): MINOR còn lại của F10c và P2 về PDP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sửa các lỗi nhỏ còn lại của trang chi tiết sản phẩm (PDP) ở Mini App và web: nút "Viết đánh giá" cho khách web, số sao `4,4`, bỏ thuật ngữ cấm, rãnh thanh "Đã bán" nhìn thấy được, Số lượng đứng ngay dưới phân loại (không trùng dòng và chip), trần dải gợi ý khách web, PDP web 1280 Giờ vàng gọn hơn, e2e chip hết hàng không bị bỏ qua lặng lẽ, và hạ `max-md:` của PDP web.

**Architecture:** Logic chữ và trần số món nằm ở `packages/app-core` (`shop-copy.ts`, `commerce/pdp-view.ts`); hai app chỉ vẽ. Phần trình bày web dùng hằng lớp `max-md:` dùng chung ở `apps/web/src/lib/phone-ui.ts` thay vì chép chuỗi lớp. Mỗi sửa đi kèm test đỏ trước (vitest theo file; e2e web qua `web-gate.sh`).

**Tech Stack:** React 18 + zmp-ui (Mini App), Next 15 + Tailwind (web), vitest, Playwright (`web-gate.sh`).

**Spec:** `docs/2026-10-31-shop-redesign/01-thiet-ke.md` §4 (Q1, Q5, Q8), `02-ke-hoach.md` (Global Constraints, "Giao diện dùng chung"), `review/final-critique.md` P2 số 11, 16, 17, 18, 19, 20; `review/web.md` D-01; `plans/F10c-pdp-web.md`; các dòng `[F10c]` của danh sách MINOR F10.

## Global Constraints

- Node: `export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH` cho mọi lệnh. Worktree mới đã chạy `pnpm install --offline --frozen-lockfile`, `pnpm --filter @tubutree/shared-types build`, `npx prisma generate` (trong `apps/api`).
- Web khổ điện thoại phải giống Mini App cả giao diện (luật chủ dặn). Chữ giao diện tiếng Việt theo §4 Q5: "Thương hiệu", "Mã giảm giá"; không "Cùng nhà", không "mã giảm" thiếu chữ "giá".
- Tiêu đề khối Inter 16/700; giá giảm màu `--color-text-price-deal`; vùng chạm >= 44px; tương phản >= 4,5:1; axe 0 vi phạm ở 375px.
- `pnpm lint:parity` chạy bánh cóc px và `max-md:` (`scripts/uiux/ds-baseline.json`): không thêm số px viết tay hay `max-md:` mới; hạ được thì `node scripts/uiux/ds-ratchet.mjs --write` rồi commit baseline.
- KHÔNG sửa `pdp-bundles.tsx` (hai app). KHÔNG sửa file của G1 (`voucher.ts`, `voucher-ticket.tsx`, Ưu đãi, `useMarkExpiringSeen`, `guest-points-note.tsx`, `GuestLinkCard`, `DailyCheckInCard`, `OffersPointsStrip`, chip phiếu `brand-view.tsx`/`shop-page.ts`, `--banner-ratio`) và của G2 (Giỏ hai app, `flash-price.ts` `cardPricing`, `price.ts` `strikePrice`, phần Tiết kiệm của `pdp-view.ts`, `.tubu-scroll-pad-sticky-bar`). `pdp-view.ts` chỉ thêm hằng trần dải gợi ý, không đụng `cartSaving`/`lineSaving`.
- Máy chung thiếu RAM: lúc làm chỉ chạy vitest theo file; gate đầy đủ đúng một lần ở cuối. Không push, không đọc/ghi PROD, không `git stash` trần, không kill tiến trình không phải của mình.
- Comment chỉ giải thích "vì sao" không hiển nhiên (tiếng Việt, theo mật độ file xung quanh).

## Review Focus

1. Sản phẩm một phân loại: bỏ dòng "Phân loại ›" không được để dải rỗng; Số lượng vẫn đứng ngay sau Ưu đãi/Vận chuyển. Test: `add-to-cart.spec.tsx` (web), `product-detail-info.spec.tsx` (Mini).
2. Sản phẩm nhiều phân loại có Giờ vàng ở phân loại đang chọn: PDP web 1280 hiện giá Giờ vàng ở cột thông tin; ở 375 giá chỉ nằm ở thanh Giờ vàng (không hiện hai lần). Test: `pdp-extras.spec.tsx`.
3. Giờ vàng hết hạn khi khách đang xem: cột thông tin về giá thường, thanh Giờ vàng mất. Test: `pdp-extras.spec.tsx` ca hết hạn.
4. Điểm trung bình lẻ (4,35 làm tròn 4,4; 5 không thành `5,0` sai kiểu): mọi chỗ PDP in `formatRating`. Test: spec từng chỗ.
5. Khách web chưa đăng nhập ở khối Đánh giá: nút "Viết đánh giá" dẫn tới đăng nhập kèm `returnTo` đúng trang (và `?danh-gia=` nếu có). Test: `product-reviews.spec.tsx`.

---

## Quyết định lúc viết plan

- **Chọn chip, bỏ dòng "Phân loại ›" (P2 #18).** Chip hiện đủ giá Giờ vàng, "Hết hàng" khoá, ngay trên màn; bảng chọn (`VariationSheet`) vẫn mở khi bấm "Thêm vào giỏ"/"Mua ngay" từ 2 phân loại, nên dòng "›" chỉ lặp. Cả Mini và web bỏ dòng; e2e `pdp-variation` mất khỏi thứ tự chuẩn. Q8 giữ nguyên: Đánh giá nhanh vẫn ngay sau Combo/Mua kèm; Số lượng dời lên ngay sau chip.
- **Ghi chú vận chuyển dời lên trên chip** (cùng khối với Ưu đãi/Vận chuyển mà nó chú thích) để Số lượng thật sự sát phân loại khi gian hàng có ghi chú.
- **Trần dải "Có thể bạn cũng thích" (P2 #20).** `GET /products/for-you` trả tối đa 10 món (`TAKE` ở `catalog.service.ts`), nên Mini chỉ bao giờ có <= 10 món. Khách web (chưa đăng nhập, nguồn bán chạy) lấy cùng 10 món: hằng `PDP_FEED_SOURCE_LIMIT = 10` ở app-core. Lệch nguồn (bán chạy so với gợi ý cá nhân) ghi vào `DESIGN.md` mục Nhật ký quyết định.
- **PDP web 1280 (P2 #19), phần làm trong gói:** giá Giờ vàng ở cột thông tin (từ lg), dải Giờ vàng bo góc như ảnh (từ md), nửa dưới thành hai cột (Thành phần + Cam kết + Mô tả | Đánh giá) từ lg nên thanh phân bổ sao không còn dài ~1000px. **Để lại (ghi notes):** thanh mua thu gọn dính (D-01 mục 5) và cột phụ "Cùng thương hiệu" dạng danh sách dọc (D-01 mục 4).
- **Hạ `max-md:` (F10c)**: gom các cặp lớp lặp lại (dải trắng, khe 8px) vào hằng ở `phone-ui.ts`; Tailwind vẫn thấy đủ chuỗi lớp vì hằng nằm trong cây nguồn.

## File Structure

| File | Việc |
|---|---|
| `apps/web/src/app/san-pham/[slug]/product-reviews.tsx` (+ spec) | nút ghost "Viết đánh giá" cho khách (Task 1); `formatRating` (Task 2) |
| `apps/web/src/app/san-pham/[slug]/pdp-sections.tsx`, Mini `product-detail.tsx`, `reviews-section.tsx` | `formatRating` (Task 2) |
| `packages/app-core/src/shop-copy.ts`, `shop-copy-budget.ts`; Mini `product-detail.tsx`; web `pdp-rails.tsx`, `pdp-extras.tsx`; `terminology.spec.ts` | khoá `pdp.brandShelf`, `pdp.brandShelfLabel`; "mã giảm giá"; hạ `EXEMPT` (Task 3) |
| `apps/{miniapp/src/components/ui,web/src/components/mini}/flash-sold-bar.tsx`, `.../flash-price-bar.tsx` | prop `track` (Task 4) |
| `apps/miniapp/src/pages/product-detail.tsx`; `apps/web/src/components/add-to-cart.tsx`, `san-pham/[slug]/page.tsx` | bỏ dòng "Phân loại ›", Số lượng ngay sau chip (Task 5) |
| `packages/app-core/src/commerce/pdp-view.ts`, `apps/web/src/app/san-pham/[slug]/pdp-rails.tsx`, `DESIGN.md` | trần nguồn dải gợi ý khách (Task 6) |
| `apps/web/src/components/flash-price.tsx`, `san-pham/[slug]/page.tsx`, `components/layouts/pdp-layout.tsx` | PDP web 1280 (Task 7) |
| `apps/e2e/tests/pdp-mobile.web.spec.ts`, `apps/e2e/tests/support/pdp-product.ts` | chọn sản phẩm >= 2 phân loại (Task 8) |
| `apps/web/src/lib/phone-ui.ts` + file PDP web, `scripts/uiux/ds-baseline.json` | gom `max-md:` (Task 9) |

## Task 1: Nút "Viết đánh giá" cho khách web (F10c, final-critique #11 phần link)

**Files:** Modify `apps/web/src/app/san-pham/[slug]/product-reviews.tsx:161-165`; Test `product-reviews.spec.tsx:215`, `page.spec.tsx:255`.

**Interfaces:** Produces: khách (`phase === 'guest'`, đã hydrate) thấy `<a href={loginHref(returnTo)}>` tên "Viết đánh giá", lớp `${ui.btnSecondary} ${mini.ghost}`, KHÔNG có `underline`. Chữ "Đăng nhập để đánh giá" biến mất khỏi mã.

- [ ] **Step 1: test đỏ.** Sửa hai spec: `byText(c, 'a', 'Viết đánh giá')` tồn tại cho khách, `href` bằng `loginHref('/san-pham/<slug>')`, `className` chứa `max-md:bg-transparent` và không chứa `underline`; `queryByText('Đăng nhập để đánh giá')` là null.
- [ ] **Step 2:** `pnpm --filter @tubutree/web exec vitest run "src/app/san-pham/\[slug\]/product-reviews.spec.tsx"` -> FAIL.
- [ ] **Step 3:** đổi lớp và chữ của `Link` (giữ `href`, giữ `hydrated &&`).
- [ ] **Step 4:** chạy lại hai spec -> PASS. Commit `fix(web): khách thấy nút ghost "Viết đánh giá" như Mini thay link gạch chân (F10c)`.

## Task 2: Số sao định dạng vi-VN ở mọi chỗ PDP (P2 #16)

**Files:** Modify Mini `pages/product-detail.tsx:618`, `components/reviews-section.tsx:223`; web `san-pham/[slug]/pdp-sections.tsx:24,30`, `product-reviews.tsx:235`. Test: spec cạnh từng file.

**Interfaces:** Consumes: `formatRating(avg: number): string` ở `@tubutree/app-core/commerce/card-meta` (4.4 -> "4,4"). Produces: không đổi chữ ký; `aria-label` của `PdpRating` thành "4,4 trên 5 sao".

- [ ] **Step 1: test đỏ.** Mini `product-detail-info.spec.tsx`: với `average: 4.4, count: 27` thấy "4,4 · 27 đánh giá", không thấy "4.4"; `reviews-section.spec.tsx`: số lớn là "4,4". Web `pdp-sections.spec.tsx`: `PdpRating average=4.4` có text "4,4 · 27 đánh giá" và `aria-label` "4,4 trên 5 sao"; `product-reviews.spec.tsx`: số lớn "4,4".
- [ ] **Step 2:** chạy bốn spec -> FAIL (đang "4.4").
- [ ] **Step 3:** thay `toFixed(1)` bằng `formatRating(...)` ở năm chỗ.
- [ ] **Step 4:** PASS. Commit `fix(miniapp,web): điểm trung bình PDP dùng formatRating "4,4" (P2 #16)`.

## Task 3: Bỏ thuật ngữ cấm còn trong EXEMPT (P2 #17)

**Files:** Modify `packages/app-core/src/shop-copy.ts` (+ `shop-copy-budget.ts`), Mini `pages/product-detail.tsx:818,1002,1004`, web `san-pham/[slug]/pdp-rails.tsx:81`, `pdp-extras.tsx:386`, `packages/app-core/src/terminology.spec.ts` (EXEMPT, REASON.BRAND). Test: `terminology.spec.ts`, `shop-copy.spec.ts`, `product-detail-info.spec.tsx`, `product-detail-chat.spec.tsx`, web `page.spec.tsx:492`, `pdp-extras.spec.tsx`.

**Interfaces:** Produces: khoá `'pdp.brandShelf': 'Cùng thương hiệu'` (budget 20) và `'pdp.brandShelfLabel': 'Cùng thương hiệu {brand}'` (budget null, tên thương hiệu tuỳ ý); chữ nút mua chung "Mở nhóm mua chung — nhận mã giảm giá khi đủ người" ở hai app.

- [ ] **Step 1: test đỏ.** Đổi kỳ vọng: heading "Cùng thương hiệu" (không kèm tên), `aria-label` của dải chứa tên thương hiệu; nút mua chung có "mã giảm giá khi đủ người". Chạy `terminology.spec.ts` ngay sau khi sửa mã sẽ báo "còn 0/1, xoá dòng miễn" nên đó là test đỏ ở bước 3.
- [ ] **Step 2:** chạy các spec trên -> FAIL.
- [ ] **Step 3:** thêm hai khoá chữ; Mini và web dùng `fillCopy('pdp.brandShelf')` cho tiêu đề và `fillCopy('pdp.brandShelfLabel', { brand })` cho nhãn đọc của `ProductRail`; sửa chữ nút mua chung. Hạ `EXEMPT`: Mini `product-detail.tsx` [Thương hiệu] 2 -> xoá, [Mã giảm giá] 1 -> xoá; web `pdp-rails.tsx` [Thương hiệu] xoá; web `pdp-extras.tsx` [Mã giảm giá] xoá (chỉ xoá khi `countOf` bằng 0, không thì hạ max); sửa `REASON.BRAND` bỏ nhắc dải "Cùng nhà" ở PDP.
- [ ] **Step 4:** `pnpm --filter @tubutree/app-core exec vitest run src/terminology.spec.ts src/shop-copy.spec.ts` + các spec Mini/web -> PASS. Commit `fix(app-core,miniapp,web): PDP bỏ "Cùng nhà" và "mã giảm" thiếu "giá", hạ EXEMPT terminology (P2 #17)`.

## Task 4: Rãnh thanh "Đã bán" trên nền kem dùng `--color-track` (P2 #11)

**Files:** Modify Mini `components/ui/flash-sold-bar.tsx`, `components/product/flash-price-bar.tsx`; web `components/mini/flash-sold-bar.tsx`, `components/mini/flash-price-bar.tsx`. Test: `flash-sold-bar.spec.tsx` (web, Mini nếu có), `flash-price-bar.spec.tsx`.

**Interfaces:** Produces: `FlashSoldBarProps.track?: 'flash' | 'neutral'` (mặc định `'flash'`, hai app cùng khoá); `neutral` vẽ rãnh `var(--color-track)`. `FlashPriceBar` (nền `--color-flash-bg`) truyền `track="neutral"`.

- [ ] **Step 1: test đỏ.** `FlashSoldBar track="neutral"` cho `flash-sold-track` `background` là `var(--color-track)`; mặc định vẫn `var(--color-flash-bg)`; `FlashPriceBar` render rãnh `var(--color-track)`.
- [ ] **Step 2:** chạy spec -> FAIL.
- [ ] **Step 3:** thêm prop ở hai app (`soldOut` vẫn dùng `--color-track`), `FlashPriceBar` truyền `neutral`.
- [ ] **Step 4:** PASS. Commit `fix(miniapp,web): rãnh thanh Đã bán trên thanh Giờ vàng PDP dùng --color-track (P2 #11)`.

## Task 5: Số lượng ngay dưới phân loại, bỏ dòng "Phân loại ›" trùng chip (P2 #18)

**Files:** Modify Mini `pages/product-detail.tsx` (infoRows `variation`, khối chip, khối Số lượng); web `components/add-to-cart.tsx` (khối `pdp-variation`, thứ tự `order`, nhánh `blockedReason`), `san-pham/[slug]/page.tsx` (`order` của ghi chú, Combo, Đánh giá nhanh, mua chung + comment bảng thứ tự). Test: Mini `product-detail-info.spec.tsx`, web `add-to-cart.spec.tsx`, `page.spec.tsx`.

**Interfaces:** Produces (điện thoại): thứ tự `pdp-main 0, pdp-certs 1, pdp-subscribe 2, pdp-offers 3, pdp-notes 4, pdp-variation-chips 5, pdp-quantity 6, pdp-bundles 8, pdp-quick-reviews 9, pdp-groupbuy 11`; `data-section="pdp-variation"` không còn. Mini: khối Ưu đãi/Vận chuyển/ghi chú/chip chung một dải, Số lượng ngay sau, rồi Combo/Mua kèm, Đánh giá nhanh.

- [ ] **Step 1: test đỏ.** Mini: nhiều phân loại KHÔNG có nút tên `/^Phân loại ›?/` (`queryByRole('button', { name: /^Phân loại$/ })` null) mà có `group` "Phân loại nhanh"; trong DOM Số lượng đứng trước `pdp-quick-reviews` và sau nhóm chip. Web `add-to-cart.spec.tsx`: `[data-section="pdp-variation"]` null, thứ tự chip 5 -> Số lượng 6; một phân loại không dải rỗng. `page.spec.tsx`: dãy `visual` thành `['pdp-main','pdp-certs','pdp-subscribe','pdp-offers','pdp-bundles','pdp-quick-reviews','pdp-groupbuy']` giữ nguyên (Số lượng/chip nằm trong AddToCart) và `pdp-notes` có `max-md:order-4`.
- [ ] **Step 2:** chạy ba spec -> FAIL.
- [ ] **Step 3:** Mini: bỏ phần tử `variation` khỏi `infoRows`, đặt điều kiện hộp dòng thông tin thành `infoRows.length > 0 || variations.length > 1 || shippingNotes.length > 0`, đưa `shippingNotes` lên trước nhóm chip, chuyển khối Số lượng lên ngay sau hộp đó (trước `PdpBundles`). Web: bỏ `ListRow` Phân loại (dọn import `Layers`, `Icon`, `ListRow` nếu hết dùng), `order` theo bảng trên, nhánh `blockedReason` dùng `max-md:order-6`, cập nhật comment bảng thứ tự và phần "Hệ quả Tab" ở `page.tsx`.
- [ ] **Step 4:** PASS các spec trên + `pnpm --filter @tubutree/miniapp exec vitest run src/pages/product-detail-default-variation.spec.tsx src/pages/product-detail-flash.spec.tsx`. Commit `fix(miniapp,web): PDP Số lượng ngay dưới phân loại, bỏ dòng Phân loại trùng chip (P2 #18)`.

## Task 6: Trần dải "Có thể bạn cũng thích" của khách web bằng Mini (P2 #20)

**Files:** Modify `packages/app-core/src/commerce/pdp-view.ts` (chỉ thêm hằng), web `san-pham/[slug]/pdp-rails.tsx:15,59`, `DESIGN.md` (Nhật ký quyết định). Test: `pdp-view.spec.ts`, `pdp-rails.spec.tsx`.

**Interfaces:** Produces: `export const PDP_FEED_SOURCE_LIMIT = 10` (app-core). Web thay `POPULAR_LIMIT = 24` bằng hằng này.

- [ ] **Step 1: test đỏ.** `pdp-rails.spec.tsx`: khách gọi `fetchProducts` với `{ limit: 10, sort: 'best_seller' }`. `pdp-view.spec.ts`: `PDP_FEED_SOURCE_LIMIT` bằng 10.
- [ ] **Step 2:** chạy hai spec -> FAIL.
- [ ] **Step 3:** thêm hằng (comment: bằng số món `/products/for-you` trả); web dùng; thêm một dòng vào `DESIGN.md` Nhật ký quyết định (khách web lấy bán chạy cùng trần 10 với gợi ý cá nhân của Mini).
- [ ] **Step 4:** PASS. Commit `fix(app-core,web): dải Có thể bạn cũng thích của khách web cùng trần 10 món với Mini (P2 #20)`.

## Task 7: PDP web 1280 Giờ vàng gọn hơn (P2 #19, phần trong gói)

**Files:** Modify `apps/web/src/components/flash-price.tsx` (`PdpPrice`), `san-pham/[slug]/page.tsx` (vỏ thanh Giờ vàng, nửa dưới), `product-reviews.tsx` nếu cần. Test: `flash-price.spec.tsx` (hoặc `pdp-extras.spec.tsx`), `page.spec.tsx`.

**Interfaces:** Produces: `PdpPrice` khi phân loại đang chọn Giờ vàng trả `<div data-testid="pdp-flash-price" aria-hidden="true" className="... hidden lg:flex">` (giá deal, giá gạch, `-x%`), vì thanh Giờ vàng đã đọc giá đó. Vỏ `PdpFlashBar` có `empty:hidden md:mt-2 md:overflow-hidden md:rounded-sheet`. `below` từ lg: `lg:grid lg:grid-cols-2 lg:gap-8` với cột trái Thành phần/Cam kết/Mô tả, cột phải Đánh giá; dải gợi ý bên dưới full bề rộng.

- [ ] **Step 1: test đỏ.** Giờ vàng: `pdp-flash-price` có và có lớp `lg:flex`, `hidden`; không Giờ vàng: không có; hết hạn: biến mất. `page.spec.tsx`: vỏ thanh Giờ vàng chứa `md:rounded-sheet`; `below` có hai cột lg (`lg:grid-cols-2`) và `data-section="pdp-reviews"` nằm ở cột thứ hai.
- [ ] **Step 2:** chạy spec -> FAIL.
- [ ] **Step 3:** cài đặt theo khối Interfaces; không đổi thứ tự DOM của khối mua (nút mua phải nằm trong 1280×800).
- [ ] **Step 4:** PASS; `pdp-desktop.web.spec.ts` ở Task 10 xác nhận nút mua trong khung. Commit `fix(web): PDP 1280 Giờ vàng: giá ở cột thông tin, dải bo góc như ảnh, nửa dưới hai cột (P2 #19)`.

## Task 8: e2e chip hết hàng không bị bỏ qua lặng lẽ (F10c)

**Files:** Create `apps/e2e/tests/support/pdp-product.ts`; Modify `apps/e2e/tests/pdp-mobile.web.spec.ts`.

**Interfaces:** Produces: `productWithVariations(request: APIRequestContext, apiOrigin: string, min: number): Promise<Detail | null>` quét `/api/products?limit=50` và trả sản phẩm đầu tiên có từ `min` phân loại.

- [ ] **Step 1:** ca thứ tự khối dùng `productWithVariations(..., 2) ?? firstProduct`, kiểm các khối bắt buộc có mặt (`pdp-main`, `pdp-quantity`, `pdp-quick-reviews`, `pdp-reviews`) và `pdp-variation-chips` có mặt khi sản phẩm >= 2 phân loại; dãy chuẩn bỏ `pdp-variation`, thêm ràng buộc `pdp-variation-chips` đứng ngay trước `pdp-quantity`. Tách ca "chip hết hàng khoá" thành ca riêng, `test.skip(!p, 'DB e2e không có sản phẩm nào từ 2 phân loại')`.
- [ ] **Step 2:** chạy `E2E_API_PORT=3390 E2E_WEB_PORT=3391 E2E_MINIAPP_PORT=3392 bash apps/e2e/scripts/web-gate.sh tests/pdp-mobile.web.spec.ts` ở Task 10 -> PASS, và ca chip hết hàng báo "passed" (không "skipped") vì seed có 4 sản phẩm hai phân loại.
- [ ] **Step 3:** commit `test(e2e): PDP web 375 chọn sản phẩm từ 2 phân loại cho ca chip hết hàng, thứ tự khối không phụ thuộc sản phẩm đầu`.

## Task 9: Gom `max-md:` của PDP web, hạ baseline (F10c)

**Files:** Modify `apps/web/src/lib/phone-ui.ts` (thêm hằng), `san-pham/[slug]/page.tsx`, `components/add-to-cart.tsx`, `pdp-extras.tsx`, `pdp-sections.tsx`, `pdp-quick-reviews.tsx`, `scripts/uiux/ds-baseline.json`.

**Interfaces:** Produces: `phoneBand = 'max-md:bg-[var(--color-bg-surface)] max-md:px-4'`, `phoneBandPad = 'max-md:bg-[var(--color-bg-surface)] max-md:p-4'` (dải trắng PDP). Không đổi lớp cuối cùng trên phần tử, nên spec kiểm lớp giữ nguyên.

- [ ] **Step 1:** `node scripts/uiux/ds-ratchet.mjs` ghi số `max-md` hiện tại của sáu file làm mốc.
- [ ] **Step 2:** thay các cặp lớp lặp bằng hằng; chạy vitest `src/app/san-pham` và `add-to-cart.spec.tsx` -> PASS (không đổi hành vi).
- [ ] **Step 3:** `node scripts/uiux/ds-ratchet.mjs --write`, kiểm `git diff scripts/uiux/ds-baseline.json` chỉ giảm; `pnpm lint:parity` xanh. Commit `refactor(web): gom lớp dải trắng PDP vào phone-ui, hạ baseline max-md (F10c)`.

## Task 10: Chụp so, gate, ghi nhận

- [ ] Ảnh "trước" (trước Task 1) và "sau" ở `docs/2026-10-31-shop-redesign/screens/G3/{before,after}/` (gitignore): `mini375.png`, `web375.png`, `web1280.png` của PDP Giờ vàng nhiều phân loại, bằng spec chụp tạm `apps/e2e/tests/zz-g3-shots.*.spec.ts` (không commit; xoá khi xong); tắt server của mình.
- [ ] e2e web: `E2E_API_PORT=3390 E2E_WEB_PORT=3391 E2E_MINIAPP_PORT=3392 bash apps/e2e/scripts/web-gate.sh tests/pdp-mobile.web.spec.ts tests/pdp-desktop.web.spec.ts tests/a11y-shop.web.spec.ts`.
- [ ] Gate đúng một lần: `bash docs/2026-10-28-review/tools/gate.sh <worktree> --base 7d2fbce40 --out .../gate-G3.txt`. Bước FAIL: so với base, đỏ cả ở base thì "có sẵn".
- [ ] e2e Mini: `cd apps/e2e && E2E_SCOPE=miniapp E2E_MINIAPP_PORT=3389 npx playwright test --workers=2 --reporter=line`; đỏ vì thiết kế đã chốt thì sửa test theo thiết kế.
- [ ] Ghi vào cuối plan mục "Điều chỉnh lúc làm" những chỗ lệch.

## Điều chỉnh lúc làm

- **Task 3:** thêm hai khoá `pdp.brandShelf` ("Cùng thương hiệu") và `pdp.brandShelfLabel` ("Cùng thương hiệu {brand}") vào `shop-copy.ts` và `shop-copy-budget.ts` thay vì viết chữ thẳng; tên nhãn nằm ở `aria-label` của dải, tiêu đề hiện chữ cố định. `pdp-sections.spec.tsx` (PdpRails) cũng phải đổi vì còn khẳng định "Cùng nhà <nhãn>" (không có trong danh sách file của plan).
- **Task 4:** tách thành `track?: 'flash' | 'neutral'` ở `FlashSoldBar` hai app (mặc định giữ rãnh cam nhạt cho thẻ trên nền trắng); chỉ `FlashPriceBar` truyền `neutral`.
- **Task 5:** khoá `pdp.variation` không còn dòng nào dùng nên chuyển sang làm nhãn sr-only/máy tính của nhóm chip web (`id="variation-label"`), khỏi để khoá chết. Hộp đệm trên của chip khi không có dòng nào phía trên dùng `Box pt` (không thêm số px viết tay: ratchet px đỏ).
- **Task 6:** hằng `PDP_FEED_SOURCE_LIMIT = 10` ở `pdp-view.ts`; sửa luôn comment "Cùng nhà" cũ ở đó; ghi hai dòng vào `DESIGN.md` (Nhật ký quyết định) cho Task 5 và 6.
- **Task 7:** `FlashPriceBar` web thêm hai props chỉ có ở web (`className`, `priceRowClassName`), khai `propsDiff.webOnly` ở `docs/design/ds-map.json`; `PdpPrice` gom thành một `PriceRow` cho giá thường và giá Giờ vàng (bản chép tay lần đầu thêm một chỗ vi phạm `primitive-color` của ds-shop-guard). Phần để lại (ghi ở notes): thanh mua thu gọn dính (D-01 mục 5) và cột phụ "Cùng thương hiệu" dạng danh sách dọc (D-01 mục 4).
- **Task 8:** thêm `apps/e2e/tests/support/pdp-product.ts` (`firstProduct`, `multiVariationProduct`); thứ tự khối chuẩn mới `main, certs, subscribe, offers, notes, variation-chips, quantity, bundles, quick-reviews, groupbuy, ...`, kiểm thêm chip liền Số lượng cách 7–9px và khối bắt buộc không vắng.
- **Task 9:** ba hằng mới ở `phone-ui.ts` (`phoneBand`, `phoneBandPad`, `phoneBrandLabel`) và dùng lại `phoneBrandText` sẵn có; max-md 1057 → 1027 (phone-ui.ts +8, page.tsx −13, add-to-cart −11, pdp-sections −5, pdp-extras −6, pdp-quick-reviews −3). Spec `pdp-sections` đổi lớp kỳ vọng `max-md:text-[color:...]` thành `max-md:text-[var(...)]` (cùng màu, theo `phoneBrandText`).
- **Chung:** lỡ `git add apps` kéo hai file chụp ảnh tạm vào commit d487c8462, đã gỡ ở b986f6d22 (hook chặn amend nên không viết lại lịch sử); cây cuối không còn hai file đó. Commit Task 4 để lỗi kiểu `noUncheckedIndexedAccess` ở spec web, sửa ở 52501c135.
