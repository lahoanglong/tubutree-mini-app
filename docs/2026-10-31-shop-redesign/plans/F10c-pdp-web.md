# F10c `pdp-web` (đợt 5b): PDP web khổ điện thoại giống Mini App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sửa bốn lỗi P1 của PDP web trong `review/final-critique.md` (số 10, 11, 12, 13): thứ tự khối ở 375px, nửa dưới là dải trắng + nút/chip như Mini, chip phân loại hai dòng có ⚡ và Eco lên khối đầu, tiêu đề khối Inter 16/700 ở mọi khổ.

**Architecture:** Chỉ đổi lớp trình bày của PDP web (`apps/web/src/app/san-pham/[slug]/*`, `components/add-to-cart.tsx`, thêm một lớp nút ghost vào `order-mobile/mobile-ui.ts`) và một hàm lọc đánh giá thuần ở app-core (`commerce/review-filter.ts`) dùng chung hai app. Điện thoại dùng `flex` + `max-md:order-N` trên các khối con của cột thông tin; `AddToCart` và `PdpBundles` dùng `max-md:contents` để các phần của chúng (Phân loại, Số lượng) cũng xếp theo `order` như Mini. Máy tính giữ nguyên thứ tự DOM (nút mua trong khung 1280x800). Mỗi khối gắn `data-section="pdp-*"` để e2e đọc thứ tự.

**Tech Stack:** Next 15 + Tailwind (web), React + zmp-ui (Mini), vitest (app-core, web, miniapp), Playwright (`web-gate.sh`).

**Spec:** `docs/2026-10-31-shop-redesign/01-thiet-ke.md` §4 (Q1, Q8), `02-ke-hoach.md` (Global Constraints, "Giao diện dùng chung", "Cách chạy mỗi gói"), `review/final-critique.md` P1 #10-#13, `review/web.md` W-03, W-04, W-07.

## Global Constraints

- Node: `export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH` cho mọi lệnh; worktree mới đã chạy `pnpm --filter @tubutree/shared-types build` và `npx prisma generate` (trong `apps/api`).
- Tiêu đề khối Inter 16/700 -0.01em; Fraunces chỉ tiêu đề trang và số >= 22px.
- Vùng chạm >= 44px (chip phân loại min-h 44), tương phản >= 4,5:1, axe 0 vi phạm ở 375px.
- Giá giảm màu `--color-text-price-deal`; Giờ vàng là chip ⚡ + giá deal.
- Logic lọc đánh giá nằm ở `packages/app-core`; hai app không chép logic.
- Chữ giao diện tiếng Việt; không đổi API; không sửa `pdp-bundles.tsx` (combo đã xong ở F8); không sửa file của F10a/F10b/F10d.
- Máy chung thiếu RAM: chỉ chạy vitest theo file lúc làm; gate đầy đủ đúng một lần ở cuối. Không push, không đọc/ghi PROD, không `git stash` trần.
- Comment chỉ giải thích "vì sao" không hiển nhiên (tiếng Việt, theo mật độ file xung quanh).

## Review Focus

1. Sản phẩm một phân loại (không có dòng "Phân loại ›" và chip): các dải trắng không để lại dải rỗng 8px, thứ tự còn lại đúng (Tubu giao hàng > Số lượng...). Test: page.spec ca một phân loại không có `data-section="pdp-variation"`.
2. Không có Combo/Mua kèm, không có đánh giá có chữ: khối Đánh giá nhanh và Combo không dựng, không dải rỗng, Số lượng nối ngay sau Phân loại. Test: page.spec ca `reviews` rỗng.
3. Món hết hàng ở chip: hiện "Hết hàng" thay giá, gạch tên, vẫn đọc được. Test: add-to-cart.spec.
4. Giờ vàng hết hạn khi khách đang xem: chip về giá thường, mất ⚡ và chữ "Giờ vàng" đọc (đã có `useFlashListExpiry`). Test: add-to-cart.spec ca danh sách quá hạn không còn chữ.
5. Máy tính 1280x800 không đổi thứ tự DOM (nút "Thêm vào giỏ" nằm trọn khung): `pdp-desktop.web.spec.ts` và page.spec ca "khối mua đứng trước chứng nhận trong HTML" vẫn xanh.

---

## Quyết định lúc viết plan

- **Tiêu đề khối 16/700 cả hai app.** `SectionTitle` của Mini là 16/600 và chỉ `SectionHeader` (Trang chủ, "Có thể bạn cũng thích") là 700, nên PDP Mini tự lệch Q1. Thêm prop `block` cho `SectionTitle` hai app (16/700, -0.01em), Mini PDP truyền `block`; web `pdpSectionTitle` dùng cùng số đo ở mọi khổ. Đây là sửa Mini theo luật Q1, ghi vào notes.
- **Chip phân loại hai dòng chỉ dưới md.** Từ md giữ "tên · giá" + nhãn "Giờ vàng" chữ thấy được để nút mua vẫn nằm trong 1280x800 ở ca nhiều phân loại.
- **Thứ tự điện thoại (theo Mini):** thông tin chính (thương hiệu, tên, đánh giá, giá, Điểm Xanh, mô tả ngắn) > chứng nhận Eco > Đặt định kỳ (chỉ web, ngoại lệ có chủ đích) > Ưu đãi + Vận chuyển > Phân loại + chip > ghi chú vận chuyển > Combo/Mua kèm > Đánh giá nhanh > Số lượng > Mở nhóm mua chung + Nội dung bán hàng > Thành phần > Cam kết > Mô tả > Đánh giá > dải gợi ý.
- **Nút phụ dưới md:** "Chat với Tubu Tree" dùng `mini.secondary` (nền xanh nhạt, không viền); "Viết đánh giá", "Sửa đánh giá của bạn", "Xem thêm (n)", "Xem thêm" mô tả là chữ màu thương hiệu (ghost) như Mini.
- **Mini không đổi** ngoài: `SectionTitle block` + 9 chỗ truyền `block` ở PDP, và `reviews-section.tsx` dùng `filterReviews`/`reviewFilterChips` thay logic lọc chép tay (cùng hành vi).

## File Structure

| File | Việc |
|---|---|
| `packages/app-core/src/commerce/review-filter.ts` (+ `.spec.ts`) | tạo: `ReviewFilterKey`, `reviewFilterChips`, `filterReviews` |
| `apps/miniapp/src/components/ui/section-title.tsx`, `apps/web/src/components/mini/section-title.tsx` | thêm prop `block` |
| `apps/miniapp/src/components/reviews-section.tsx`, `pages/product-detail.tsx`, `components/product/pdp-bundles.tsx`, `components/product/pdp-quick-reviews.tsx` | dùng `filterReviews`; truyền `block` cho tiêu đề khối |
| `apps/web/src/app/san-pham/[slug]/pdp-sections.tsx` | `pdpSectionTitle`; dải trắng; chữ nhỏ như Mini; nút Xem thêm ghost |
| `apps/web/src/app/san-pham/[slug]/page.tsx` | `order`, dải, `data-section`; Đánh giá nhanh vào khối thông tin |
| `apps/web/src/app/san-pham/[slug]/pdp-quick-reviews.tsx` | dải trắng điện thoại; `data-section` |
| `apps/web/src/app/san-pham/[slug]/pdp-extras.tsx` | freeship cỡ Mini; nút Chat; Mở nhóm mua chung dạng dải |
| `apps/web/src/app/san-pham/[slug]/product-reviews.tsx` | chip lọc; nút ghost; dải trắng |
| `apps/web/src/components/add-to-cart.tsx` | chip hai dòng + ⚡; `contents` + `order` + dải |
| `apps/web/src/components/order-mobile/mobile-ui.ts` | thêm `mini.ghost` |
| `apps/e2e/tests/pdp-mobile.web.spec.ts` | ca thứ tự khối PDP web 375 |

## Task 1: `reviewFilterChips` / `filterReviews` ở app-core

**Files:** Create `packages/app-core/src/commerce/review-filter.ts`, Test `packages/app-core/src/commerce/review-filter.spec.ts`.

**Interfaces:**
- Produces:
  ```ts
  export type ReviewFilterKey = number | 'all' | 'photo' | 'video';
  export interface ReviewFilterChip { key: ReviewFilterKey; label: string; count?: number }
  export function reviewFilterChips(videoCount: number | undefined): ReviewFilterChip[];
  export function filterReviews<T extends { rating: number; images: readonly string[]; videoUrl: string | null }>(items: readonly T[], key: ReviewFilterKey): T[];
  ```

- [ ] **Step 1: test** (`review-filter.spec.ts`): `reviewFilterChips(0).map(c => c.label)` bằng `['Tất cả','5 sao','4 sao','3 sao','Có ảnh']`; `reviewFilterChips(2)` thêm `{ key: 'video', label: 'Có video', count: 2 }` ở cuối; `filterReviews(items,'all')` trả đủ; `5` chỉ rating 5; `'photo'` chỉ có ảnh; `'video'` chỉ có `videoUrl`; không đổi mảng gốc.
- [ ] **Step 2:** `pnpm --filter @tubutree/app-core exec vitest run src/commerce/review-filter.spec.ts` -> FAIL (không tìm thấy module).
- [ ] **Step 3:** cài đặt đúng chữ ký trên (chữ chip chép nguyên từ `reviews-section.tsx` Mini: "Tất cả", "5 sao", "4 sao", "3 sao", "Có ảnh", "Có video").
- [ ] **Step 4:** chạy lại -> PASS.
- [ ] **Step 5:** commit `feat(app-core): lọc đánh giá dùng chung (reviewFilterChips, filterReviews)`.

## Task 2: Tiêu đề khối 16/700 (item 13) + Mini dùng bộ lọc chung

**Files:** Modify `apps/web/src/components/mini/section-title.tsx`, `apps/miniapp/src/components/ui/section-title.tsx`, `apps/web/src/app/san-pham/[slug]/pdp-sections.tsx:12`, Mini `product-detail.tsx`, `pdp-bundles.tsx`, `pdp-quick-reviews.tsx`, `reviews-section.tsx`. Test: `pdp-sections.spec.tsx:160`, `product-reviews.spec.tsx:160`, spec `SectionTitle` hai app (tạo nếu chưa có cạnh component).

**Interfaces:**
- Produces: `SectionTitleProps.block?: boolean` (hai app): true -> `fontWeight: 700`, `letterSpacing: '-0.01em'`. `pdpSectionTitle: string` (web) = Inter `--type-title-sm-size/lh`, `font-bold`, `tracking-[-0.01em]`, không còn `font-display` ở bất kỳ khổ nào.

- [ ] **Step 1: test đỏ.** Sửa `pdp-sections.spec.tsx`: `h.className` chứa `font-ui` và `font-bold`, không chứa `font-display`, không có tiền tố `max-md:` ở lớp chữ; `product-reviews.spec.tsx:160` cùng ý. Spec `SectionTitle` mỗi app: `block` cho `style.fontWeight === '700'`, mặc định `'var(--type-title-sm-weight)'`.
- [ ] **Step 2:** chạy `vitest run` hai file web + hai spec SectionTitle -> FAIL.
- [ ] **Step 3:** thêm prop `block`; đổi `pdpSectionTitle`; Mini PDP truyền `block` cho "Thành phần", "Cam kết Tubu", "Mô tả sản phẩm", "Đánh giá", "Đánh giá nhanh" (`fillCopy('pdp.reviews')`), hai tiêu đề bộ (combo, mua kèm), `pdp.boughtTogether`, "Cùng nhà ...". Mini `reviews-section.tsx`: thay `filtered` và `chips` bằng `filterReviews(data.items, filter)` và `reviewFilterChips(data.videoCount)` (icon `Video` gắn theo `key === 'video'`).
- [ ] **Step 4:** PASS các spec trên + `pnpm --filter @tubutree/miniapp exec vitest run src/components/reviews-section.spec.tsx src/components/product src/pages/product-detail*.spec.tsx` giữ xanh.
- [ ] **Step 5:** commit `fix(web,miniapp): tiêu đề khối PDP Inter 16/700 ở mọi khổ (Q1), Mini dùng bộ lọc đánh giá chung`.

## Task 3: Thứ tự khối PDP 375 như Mini + dải trắng (items 10, 11a, 12b)

**Files:** Modify `page.tsx`, `pdp-quick-reviews.tsx`, `pdp-sections.tsx`, `pdp-extras.tsx` (`PdpGroupBuyRow`, `PdpContentKitRow`, `PdpSubscribeRow` vỏ), `product-reviews.tsx` (vỏ section), `add-to-cart.tsx` (vỏ + `order`). Test: `page.spec.tsx`, `pdp-quick-reviews.spec.tsx`, `add-to-cart.spec.tsx`, `pdp-sections.spec.tsx`.

**Interfaces:**
- Produces: thuộc tính `data-section` trên khối: `pdp-main`, `pdp-certs`, `pdp-subscribe`, `pdp-offers`, `pdp-variation`, `pdp-variation-chips`, `pdp-notes`, `pdp-bundles`, `pdp-quick-reviews`, `pdp-quantity`, `pdp-groupbuy`, `pdp-contentkit`, `pdp-ingredients`, `pdp-promises`, `pdp-description`, `pdp-reviews`. Thứ tự `max-md:order-N` trong `pdp-info`: main 0, certs 1, subscribe 2, offers (Ưu đãi + Vận chuyển) 3, variation 4, chips 5, notes 6, bundles 7, quick-reviews 8, quantity 9, groupbuy/contentkit 10.
- Dải: `max-md:bg-[var(--color-bg-surface)] max-md:px-4`, cách nhau `max-md:mt-2`; `pdp-main`, `pdp-certs`, `pdp-subscribe` liền nhau (một dải); Phân loại, chip, ghi chú liền dải với Ưu đãi/Vận chuyển.
- `PdpQuickReviews` được dựng trong `info` (không còn trong `below`) ở mọi khổ; từ md vẫn nằm sau khối mua trong DOM, nên không đổi nút mua ở 1280x800.
- Cột `info` bỏ `max-md:bg-stone-0 max-md:p-4` (mỗi khối tự là dải); `below` bỏ `max-md:px-4 max-md:py-6`; mỗi section dưới đổi `mt-8` thành `mt-8 max-md:mt-2` + `max-md:bg-[var(--color-bg-surface)] max-md:p-4`. Dải gợi ý (`PdpRails`, `PdpFeed`) giữ nền canvas và có `max-md:px-4`.

- [ ] **Step 1: test đỏ.**
  - `page.spec.tsx`: thay ca `max-md:bg-stone-0` (dòng 106) bằng `pdp-info` không có `max-md:bg-stone-0`; thêm ca "thứ tự điện thoại": từ các phần tử `[data-section]` trong `pdp-info` (Mini-mock AddToCart nên chỉ kiểm khối thuộc page), đọc `order` (`max-md:order-N`, mặc định 0) và `expect` dãy id theo order tăng dần bằng `['pdp-main','pdp-certs','pdp-subscribe','pdp-offers','pdp-notes','pdp-bundles','pdp-quick-reviews','pdp-groupbuy']`; sửa ca dòng 574-576 và 609-614 theo thứ tự mới (`order` của bundles < quick-reviews < groupbuy). Ca máy tính: `add-to-cart` vẫn đứng trước `pdp-certs` trong DOM. Ca `reviews.items` không có chữ: không có `pdp-quick-reviews`. Ca một phân loại: không `pdp-variation`.
  - `pdp-quick-reviews.spec.tsx`: `section[aria-label="Đánh giá nhanh"]` có `data-section="pdp-quick-reviews"` và lớp `max-md:bg-[var(--color-bg-surface)]`.
  - `add-to-cart.spec.tsx`: gốc có `max-md:contents`; `[data-section="pdp-variation"]` order 4, `pdp-variation-chips` 5, `pdp-quantity` 9.
  - `pdp-sections.spec.tsx`: mỗi section (Thành phần, Cam kết, Mô tả) có `max-md:bg-[var(--color-bg-surface)]` và `data-section` tương ứng.
- [ ] **Step 2:** chạy 4 spec trên -> FAIL đúng chỗ mới.
- [ ] **Step 3:** cài đặt theo khối Interfaces. `page.tsx`: bọc nhóm thông tin chính vào `<div data-section="pdp-main">`; `pdp-certs` thành `max-md:order-1` (không đổi vị trí DOM); `AddToCart` bọc `max-md:contents`; thêm `<PdpQuickReviews>` sau `PdpBundles` trong DOM (từ md nằm sau khối mua nhờ DOM, điện thoại `max-md:order-8`); tách khối ghi chú vận chuyển ra thành lá riêng `pdp-notes`. `add-to-cart.tsx`: gốc `mt-4 max-md:contents`; hàng "Phân loại ›", nhóm chip, dòng "Chỉ còn N" và hàng Số lượng nhận `max-md:order-*` + dải như bảng trên.
- [ ] **Step 4:** chạy lại 4 spec + `pnpm --filter @tubutree/web exec vitest run "src/app/san-pham"` -> PASS.
- [ ] **Step 5:** commit `fix(web): PDP khổ điện thoại xếp khối và dải trắng như Mini App (final-critique #10, #11)`.

## Task 4: Chip phân loại hai dòng + ⚡, dòng miễn phí giao, Eco lên khối đầu (item 12)

**Files:** Modify `add-to-cart.tsx:376-377`, `pdp-extras.tsx:126` (`PdpFreeship`), `pdp-extras.tsx:141` (`PdpShippingRow` khoảng cách). Test `add-to-cart.spec.tsx`, `pdp-extras.spec.tsx`.

**Interfaces:** chip điện thoại = nút `aria-pressed`, hai dòng: tên (đậm khi chọn, gạch khi hết hàng) và giá (xs; `--color-text-price-deal` + icon `Zap` 12px khi `vp.isFlash`; "Hết hàng" thay giá khi hết); chữ ", Giờ vàng" luôn có trong cây truy cập (`sr-only` dưới md; từ md là nhãn "Giờ vàng" thấy được như cũ). Viền 1,5px; chọn: `--color-border-selected` + `--color-action-secondary-bg`; chưa chọn: `--color-border-subtle` + surface. `PdpFreeship` dưới md: `text-xs font-semibold text-[var(--color-text-brand)]`. `PdpShippingRow` subtitle dưới md `gap-0`.

- [ ] **Step 1: test đỏ.**
  - `add-to-cart.spec.tsx`: chip 500ml đang Giờ vàng có `svg` (⚡) và text chứa "Giờ vàng" + "200.000đ"; chip 250ml không có `svg` và không chứa "Giờ vàng"; chip hết hàng chứa "Hết hàng", không chứa giá; chip có `min-h-11`; danh sách quá hạn -> không chữ "Giờ vàng".
  - `pdp-extras.spec.tsx`: `[data-testid="pdp-freeship"]` có `max-md:text-xs` và `max-md:font-semibold`.
- [ ] **Step 2:** chạy -> FAIL.
- [ ] **Step 3:** cài đặt theo khối Interfaces (Eco đã lên khối đầu bằng `order` ở Task 3, test ở page.spec).
- [ ] **Step 4:** PASS `add-to-cart.spec.tsx`, `pdp-extras.spec.tsx`.
- [ ] **Step 5:** commit `fix(web): chip phân loại hai dòng có ⚡, dòng miễn phí giao cỡ Mini (final-critique #12)`.

## Task 5: Chip lọc đánh giá + nút ghost/phụ như Mini (item 11, W-04, W-07)

**Files:** Modify `product-reviews.tsx:153-180,316`, `pdp-extras.tsx:411,425,432` (`PdpChatButton`), `pdp-sections.tsx:88`, `components/order-mobile/mobile-ui.ts` (thêm `mini.ghost`). Test `product-reviews.spec.tsx`, `pdp-extras.spec.tsx`, `pdp-sections.spec.tsx`.

**Interfaces:** `mini.ghost = 'max-md:border-transparent max-md:bg-transparent max-md:text-[color:var(--color-action-ghost-fg)] max-md:hover:bg-transparent'`. Hàng chip lọc trong `ProductReviews` (sau khối điểm trung bình, trước danh sách): `Chip size="sm"` từ `@/components/mini/chip` cho mỗi `reviewFilterChips(data.videoCount)`, `flex flex-wrap gap-2`, đổi lọc về trang đầu (`visible = PAGE_SIZE`); danh sách dùng `filterReviews`; rỗng sau lọc -> "Không có đánh giá khớp bộ lọc." Chip hiện ở mọi khổ.

- [ ] **Step 1: test đỏ.** `product-reviews.spec.tsx`: có `button[aria-pressed]` tên "Tất cả" (chọn sẵn), "5 sao", "Có ảnh"; bấm "5 sao" chỉ còn đánh giá 5 sao; bấm "Có ảnh" mà không ai có ảnh -> thấy "Không có đánh giá khớp bộ lọc."; "Viết đánh giá" và "Xem thêm (n)" có `max-md:bg-transparent`, không còn `max-md:border` màu stone. `pdp-extras.spec.tsx`: nút Chat có `max-md:border-transparent` và `max-md:bg-[var(--color-action-secondary-bg)]`. `pdp-sections.spec.tsx`: nút "Xem thêm" mô tả có `max-md:no-underline`.
- [ ] **Step 2:** chạy -> FAIL.
- [ ] **Step 3:** cài đặt theo khối Interfaces; "Chat với Tubu Tree" dùng `mini.secondary`; nút "Xem thêm" mô tả: `max-md:no-underline max-md:px-0 max-md:text-[color:var(--color-text-brand)]`; "Mở nhóm mua chung"/"Nội dung bán hàng" dưới md thành dải (`max-md:mt-2 max-md:bg-surface max-md:p-4`, nút `max-md:border-0 max-md:bg-transparent max-md:p-0`).
- [ ] **Step 4:** PASS ba spec trên.
- [ ] **Step 5:** commit `fix(web): đánh giá có chip lọc, nút phụ và nút chữ như Mini (final-critique #11)`.

## Task 6: e2e thứ tự khối PDP web 375

**Files:** Modify `apps/e2e/tests/pdp-mobile.web.spec.ts`.

- [ ] **Step 1:** thêm ca vào `describe` sẵn có: mock như ca đầu nhưng `reviews` có hai đánh giá có chữ và đợt Giờ vàng gắn phân loại đầu; ở 375x812 đọc `[data-section]` đang hiển thị, sắp theo `boundingBox().y`, `expect` dãy id là con của danh sách chuẩn theo thứ tự Mini (`pdp-main` ... `pdp-reviews`) và `Đánh giá nhanh` nằm sau `pdp-bundles`/`pdp-variation-chips` và trước `pdp-quantity`; cạnh dưới mỗi dải cách cạnh trên dải kế <= 9px (dải trắng cách 8px); `document.documentElement.scrollWidth <= 375`.
- [ ] **Step 2:** chạy `E2E_API_PORT=3374 E2E_WEB_PORT=3375 E2E_MINIAPP_PORT=3376 bash apps/e2e/scripts/web-gate.sh tests/pdp-mobile.web.spec.ts` -> trước khi sửa Task 3 sẽ đỏ; sau khi sửa phải PASS.
- [ ] **Step 3:** chạy luôn `tests/pdp-desktop.web.spec.ts` cùng cách -> PASS (nút mua trong 1280x800).
- [ ] **Step 4:** commit `test(e2e): thứ tự và dải khối PDP web 375`.

## Task 7: Chụp so, gate, ghi nhận

- [ ] Chụp 375px Mini (Vite 3373), web 375 và web 1280 (Next dev 3374) PDP (Giờ vàng + một món nhiều phân loại + đánh giá) vào `docs/2026-10-31-shop-redesign/screens/F10c/`, so từng khối; tắt server của mình.
- [ ] Gate: `bash docs/2026-10-28-review/tools/gate.sh <worktree> --base 201046ff2 --out .../gate-F10c.txt`; e2e Mini: `cd apps/e2e && E2E_SCOPE=miniapp E2E_MINIAPP_PORT=3373 npx playwright test --workers=2 --reporter=line`.
- [ ] Ghi vào cuối plan mục "Điều chỉnh lúc làm" những chỗ lệch.

## Điều chỉnh lúc làm

- Mini cũng đổi: `SectionTitle` thêm prop `block` (Inter 700, -0.01em) và các tiêu đề khối PDP của Mini dùng nó, vì luật Q1 đòi 16/700 mà Mini đang 16/600. Test `product-detail-chat.spec.tsx` sửa theo (600 thành 700).
- Bộ lọc đánh giá (chip, lọc theo sao/ảnh/video) gom vào `packages/app-core/src/commerce/review-filter.ts` để hai app dùng chung; Mini đổi sang dùng nó, hành vi không đổi.
- Xếp khối ở điện thoại dùng một cột flex `pdp-info` với `max-md:order-N` và `max-md:contents` trên vỏ AddToCart (không tách AddToCart thành nhiều component). Máy tính giữ nguyên thứ tự HTML để nút Thêm vào giỏ còn trong khung 1280x800. Đánh giá nhanh nằm trong cột thông tin ở mọi khổ.
- `apps/web/.../pdp-bundles.tsx` (web) không sửa: dải trắng và khe 8px của Combo/Mua kèm đặt ở khối bọc trong `page.tsx` (`max-md:[&_section]`, `max-md:[&>div]:mt-2`). Bản Mini `apps/miniapp/src/components/product/pdp-bundles.tsx` CÓ sửa hai dòng (thêm prop `block` cho tiêu đề Combo và Mua kèm, để 16/700 theo Q1); người phụ trách F8 cần biết, hành vi và bố cục không đổi.
- `test-utils/a11y.ts`: `smallTouchTargets` nhận `tubu-hit-44` chỉ khi kèm chiều rộng tối thiểu 44px (`min-w-11`/`w-11`/`style.minWidth`), vì `::after` của lớp này chỉ giãn theo chiều dọc; `tubu-hit-44-square` đủ một mình. Có spec riêng `test-utils/a11y.spec.ts`.
- Chụp tự kiểm bằng API giả (Next dev 3374, Vite 3373): Mini và web375 khác nhau chủ yếu ở hàng Đặt định kỳ (web có, Mini không hiện cho khách) nên mọi khối phía dưới lệch 44-64px; trình tự khối, khe 8px, tiêu đề Inter 16/700 khớp.
- Sau review: chip phân loại hết hàng của web khoá (`disabled`, không `onClick`) như `VariationChip` của Mini, ở mọi khổ; chữ "Hết hàng" mờ nằm trong control đang khoá nên không tính vào luật tương phản.
- Sau review: "Chỉ còn N sản phẩm" ở điện thoại vẽ trong khối `pdp-main` ngay dưới Điểm Xanh (`PdpLowStock`, `md:hidden`) như Mini; máy tính giữ dòng trong khối mua (`AddToCart`, `max-md:hidden`). Hai nơi dùng chung `useProductStock` và `LOW_STOCK_NOTICE` ở `components/pdp-stock.ts` (cùng khoá react-query nên không gọi API thêm); gian hàng tạm nghỉ thì không dựng.
- Sau review: đã ghi đúng phạm vi lệch thứ tự Tab/TalkBack so với thứ tự nhìn ở điện thoại trong comment `page.tsx` (Số lượng đứng ngay sau chip trong DOM nhưng nằm sau Combo và Đánh giá nhanh trên màn hình). Chấp nhận có chủ đích, không tách hàng Số lượng khỏi AddToCart: nút mua thật của điện thoại ở thanh dính đáy nên không phụ thuộc thứ tự này, và tách ra thì phải dựng hai bản bộ chọn số lượng.
- Sau review: trạng thái "không có đánh giá khớp bộ lọc" dùng `EmptyState variant="inline" art="search"` như Mini. e2e đo khe giữa các dải nền surface thật (không đo vỏ `data-section`), khe phải 7..9px, và kiểm thêm chip hết hàng khoá + "Chỉ còn N" nằm trong `pdp-main`.
