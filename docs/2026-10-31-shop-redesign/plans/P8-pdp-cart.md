# P8 `pdp-cart` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** làm lại chi tiết sản phẩm (PDP) và giỏ hàng ở Mini App và web: thanh Giờ vàng dưới ảnh, chip phân loại đúng giá, các dòng thông tin có "›", mã giảm gom một dòng mở sheet, đánh giá nhanh, hai dải gợi ý, giỏ dòng gọn có giá gạch và "Tiết kiệm", chân giỏ dính; web lg có khuôn `PdpLayout` để nút mua nằm trong khung 1280×800.

**Architecture:** logic thuần (tiết kiệm của dòng giỏ, chọn 2 đánh giá nhanh, chống trùng các dải của PDP) ở `packages/app-core/src/commerce/pdp-view.ts`; hai app chỉ vẽ bằng thành phần P4/P5 (`PriceTag`, `Countdown`, `FlashSoldBar`, `ListRow`, `VoucherTicket`, `BottomSheet`, `ProductGrid`). Không đổi cách tính tiền: giá giỏ/báo giá/đặt đơn vẫn do API; giao diện chỉ hiển thị `listUnitPrice` (P3b) và `variationPricing` (đã có).

**Tech Stack:** React 18 + zmp-ui + vitest (Mini App), Next 15 + Tailwind + vitest (web), vitest (app-core), Playwright.

**Spec:** `docs/2026-10-31-shop-redesign/01-thiet-ke.md` (§4 Q2, Q3, Q8; §5 "Chi tiết SP", "Giỏ", "Web máy tính"); `02-ke-hoach.md` mục P8 + "Giao diện dùng chung"; nguồn `review/critique-shop.md` 4.3 (PD-01..08) + 4.4 (CT-01..04), `review/ia-merch.md` C3, `review/web.md` D-01, W-02..W-06, `review/ux-copy.md` UC-02, UC-08; bàn giao `plans/handoff-wave1.md`, `handoff-wave2.md`.

## Global Constraints

- Node: `export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH`; worktree mới cần `pnpm --filter @tubutree/shared-types build` và `npx prisma generate` (trong `apps/api`).
- Giá giảm màu `--color-text-price-deal`; giá thường đen; không đỏ. Tiêu đề khối Inter 16/700. Vùng chạm ≥44px, tương phản ≥4,5:1, axe 0 vi phạm ở 375px.
- Đồng hồ Giờ vàng ngoài đầu khối Trang chủ/trang Giờ vàng: chữ "Kết thúc sau 2 giờ 05 phút" (`Countdown mode="text"`), không HH:MM:SS (§4 Q3).
- Chữ: "Khách thường mua cùng", "Mã giảm giá", "Mỗi khách tối đa {n}", "Tiết kiệm {x}", "Còn" chỉ cho số lượng; không "Top", "Freeship", "Kho voucher". Khoá chữ mới thêm cả `SHOP_COPY` và `SHOP_COPY_MAX` (spec bắt thiếu một bên).
- Chunk vào Mini App ≤700 KB: PDP và giỏ là chunk theo route, không import chúng vào entry. Ghi số trước/sau.
- Giỏ/PDP khi Giờ vàng hết giờ: về giá thường không cần tải lại; nút thêm giỏ không mang giá Giờ vàng cũ (giá do API tính lại).
- Chỗ cho Combo/Mua kèm (P15): khối không render khi rỗng, không giữ chỗ.
- Không sửa file thuộc P6, P7, P9. Không deploy, không push, không đọc/ghi PROD. Không `git stash` trần.
- Comment chỉ nói "vì sao", tiếng Việt. Commit nhỏ, cuối message `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Giờ vàng hết giờ khi khách đang xem PDP: giá, thanh Giờ vàng, chip phân loại về giá thường (không tải lại); `flash-sales/active` còn trả suất cũ. Test: Task 3 `onEnd`.
2. Giỏ `listUnitPrice` thiếu (API cũ) hoặc bằng `unitPrice`: không gạch giá, không "Tiết kiệm". Test: Task 1 `lineSaving`, Task 4.
3. Sản phẩm không có đánh giá / một đánh giá / đánh giá không có chữ: "Đánh giá nhanh" ẩn hoặc hiện đúng số mục, không vỡ. Test: Task 1 `pickQuickReviews`.
4. Dải gợi ý rỗng, lỗi, trùng món đang xem: khối ẩn, không trùng món đang xem hay món ở dải trên. Test: Task 1 `pdpShelves`.
5. Tên tiếng Việt dài, giá triệu đồng, 3 phân loại: thanh Giờ vàng không tràn 375px; chân giỏ không che nút. Test: Task 2 vitest nowrap + Task 8 ảnh 375px.

---

## File Structure

| File | Việc |
|---|---|
| `packages/app-core/src/commerce/pdp-view.ts` (+spec) | `lineSaving`, `cartSaving`, `lineCompareAt`, `pickQuickReviews`, `pdpShelves` |
| `packages/app-core/src/shop-copy.ts`, `shop-copy-budget.ts` | khoá `pdp.*`, `cart.saving`, `cart.freeLeft` |
| `packages/app-core/src/api/flash-sale.ts` | `FlashSaleActiveItem.perUserLimit?` |
| `apps/miniapp/src/components/product/flash-price-bar.tsx` (+spec) | `FlashPriceBar` |
| `apps/miniapp/src/components/product/pdp-bundle-slots.tsx` | chỗ cho Combo/Mua kèm (P15), null khi rỗng |
| `apps/miniapp/src/components/product/pdp-offers-sheet.tsx` (+spec) | sheet "Mã giảm giá" dùng `VoucherTicket variant="row"` |
| `apps/miniapp/src/components/product/pdp-quick-reviews.tsx`, `pdp-feed.tsx` | Đánh giá nhanh; "Có thể bạn cũng thích" |
| `apps/miniapp/src/pages/product-detail.tsx` | ráp khối mới, chip giá, hết giờ |
| `apps/miniapp/src/pages/cart.tsx`, `cart-footer.tsx` (mới) | dòng 124px, chân dính |
| `apps/web/src/components/mini/flash-price-bar.tsx`, `apps/web/src/app/san-pham/[slug]/pdp-offers.tsx`, `pdp-quick-reviews.tsx`, `pdp-feed.tsx` | bản web cùng tên/props |
| `apps/web/src/components/layouts/pdp-layout.tsx` (mới) | khuôn lg: ảnh 440px + thông tin trong một thẻ trắng |
| `apps/web/src/app/san-pham/[slug]/page.tsx`, `apps/web/src/app/gio-hang/page.tsx` | ráp |
| `apps/e2e/tests/pdp-desktop.web.spec.ts` (mới) | nút "Thêm vào giỏ" `toBeInViewport` ở 1280×800 |

---

### Task 1: app-core `pdp-view` + chữ + kiểu

**Files:** Create `commerce/pdp-view.ts`, `commerce/pdp-view.spec.ts`; Modify `shop-copy.ts`, `shop-copy-budget.ts`, `api/flash-sale.ts`.

**Interfaces — Produces:**
```ts
export function lineCompareAt(l: { unitPrice: number; listUnitPrice?: number | null }): number | null; // listUnitPrice > unitPrice ? listUnitPrice : null
export function lineSaving(l: { unitPrice: number; listUnitPrice?: number | null; quantity: number }): number; // 0 khi không giảm
export function cartSaving(items: readonly Parameters<typeof lineSaving>[0][]): number;
export function pickQuickReviews<T extends { rating: number; comment: string | null; images: string[]; videoUrl: string | null; createdAt: string }>(items: readonly T[], n?: number): T[]; // n=2, có chữ mới tính; có ảnh/video trước, rồi mới nhất
export function pdpShelves<T extends { id: string }>(i: { currentId: string; boughtTogether: T[]; brand: T[]; feed: T[] }): { boughtTogether: T[]; brand: T[]; feed: T[] };
```
Khoá chữ: `pdp.offers` "Ưu đãi", `pdp.shipping` "Vận chuyển", `pdp.variation` "Phân loại", `pdp.reviews` "Đánh giá", `pdp.reviewsAll` "Xem tất cả ({n})", `pdp.alsoLike` "Có thể bạn cũng thích", `pdp.offerCount` "{n} mã giảm giá", `cart.saving` "Tiết kiệm {x}", `cart.couponRow` "{n} mã dùng được", `cart.freeDone` "Đã miễn phí giao hàng".

- [ ] **Step 1: test đỏ** `pdp-view.spec.ts`: `lineSaving({unitPrice:33000,listUnitPrice:50000,quantity:2})===34000`; `lineSaving` với `listUnitPrice` undefined/bằng/thấp hơn `unitPrice` → 0; `lineCompareAt` tương ứng `50000`/`null`; `cartSaving` cộng các dòng; `pickQuickReviews` bỏ đánh giá không chữ, đưa đánh giá có ảnh lên trước, cắt 2, mảng rỗng → `[]`; `pdpShelves` loại `currentId` khỏi mọi dải, `boughtTogether` < 3 món → `[]` (sàn của `pdp.boughtTogether`), `feed` bỏ món đã ở `boughtTogether` hoặc `brand`, cắt 20, dưới 4 món → `[]`.
- [ ] **Step 2:** `cd packages/app-core && npx vitest run src/commerce/pdp-view.spec.ts` → FAIL (module không có).
- [ ] **Step 3:** cài `pdp-view.ts`; `pdpShelves` dùng `applyShelfDedupe` với id `pdp.boughtTogether` và `pdp.related`, `brand` cắt 8 và bỏ món đã ở `boughtTogether`. Thêm khoá chữ vào `SHOP_COPY` và `SHOP_COPY_MAX`; `perUserLimit?: number` vào `FlashSaleActiveItem` (API chưa gửi, P12 gửi).
- [ ] **Step 4:** `npx vitest run src/commerce src/shop-copy.spec.ts` → PASS.
- [ ] **Step 5: Commit** `feat(app-core): pdp-view (tiết kiệm dòng giỏ, đánh giá nhanh, chống trùng dải PDP) + chữ PDP/giỏ`.

### Task 2: Mini `FlashPriceBar` + `PdpBundleSlots`

**Files:** Create `apps/miniapp/src/components/product/flash-price-bar.tsx` + `.spec.tsx`, `pdp-bundle-slots.tsx`.

**Interfaces — Produces:**
```ts
export interface FlashPriceBarProps { price: number; compareAt: number | null; pct: number; endAt: string; soldPct: number; soldOut?: boolean; perUserLimit?: number | null; onEnd?: () => void }
export function FlashPriceBar(p: FlashPriceBarProps): JSX.Element;
export function PdpBundleSlots(p: { combos?: ReactNode; addons?: ReactNode }): JSX.Element | null; // null khi cả hai rỗng
```
- [ ] **Step 1: test đỏ**: render `FlashPriceBar` với `endAt` sau 2 giờ 5 phút → có "Giờ vàng", "-30%", `getByRole('timer')` tên "Kết thúc sau 2 giờ 5 phút", `Đã bán 40%` (từ `FlashSoldBar`), `Mỗi khách tối đa 5` khi `perUserLimit=5` và không có dòng này khi `null`; giá có `color: var(--color-text-price-deal)`; `onEnd` gọi đúng một lần khi `endAt` đã qua. `PdpBundleSlots` không render gì khi không có con.
- [ ] **Step 2:** `cd apps/miniapp && npx vitest run src/components/product/flash-price-bar.spec.tsx` → FAIL.
- [ ] **Step 3:** cài: hàng trên "⚡ Giờ vàng" (Badge tone flash) + `Countdown mode="text"`; hàng giữa `PriceTag size="xl" tone="deal" compareAt` + `Badge -{pct}%`; hàng dưới `FlashSoldBar`; dòng `flash.limit` caption khi có giới hạn. Nền `--color-flash-bg`, cao tự nhiên (~88), không tràn: giá `whiteSpace: nowrap`, cho phép co hàng.
- [ ] **Step 4:** chạy lại → PASS. **Step 5: Commit** `feat(miniapp): FlashPriceBar cho PDP + chỗ Combo/Mua kèm`.

### Task 3: Mini PDP ráp

**Files:** Create `components/product/pdp-offers-sheet.tsx` (+spec), `pdp-quick-reviews.tsx`, `pdp-feed.tsx`; Modify `pages/product-detail.tsx`; sửa `product-detail-flash.spec.tsx`, `product-detail-coupons.spec.tsx`, `product-detail-chat.spec.tsx` theo thiết kế.

**Interfaces — Consumes:** Task 1, Task 2; `variationPricing` (flash-price); `VoucherTicket variant="row"`; `BottomSheet`; `ListRow`; `ProductGrid`; `ProductRail`.
- [ ] **Step 1: test đỏ** trong `product-detail-flash.spec.tsx` (sửa/ thêm): (a) "Kết thúc sau 2 giờ 0 phút" thay cho "Còn 2h 00m" và có `Đã bán 40%`; (b) chip phân loại: sản phẩm 2 phân loại, Giờ vàng ở `v2` giá 84.000 / niêm yết 120.000 → chip `v2` hiện `84.000đ`, không `120.000đ`; (c) `onEnd`: suất `endAt` = now+1,5s, `vi.useFakeTimers` tiến 2s → giá trên trang về `retailPrice`, không còn `Giờ vàng`. `pdp-offers-sheet.spec`: có 3 mã → dòng "Ưu đãi" ghi "3 mã giảm giá", bấm mở `dialog` "Mã giảm giá" có 3 `VoucherTicket`, mỗi cái một nút "Sao chép" chép đúng mã. `pdp-quick-reviews`: 2 mục + "Xem tất cả (27)"; không đánh giá → null.
- [ ] **Step 2:** `npx vitest run src/pages/product-detail-flash.spec.tsx src/components/product` → FAIL.
- [ ] **Step 3:** (i) trong `product-detail.tsx`: khi `flashItem && priceView.isFlash` vẽ `FlashPriceBar` ngay dưới `Gallery`, thay hàng giá + hàng badge cũ (giá thường vẫn `PriceTag tone` deal khi có sale); bỏ `useCountdown`. `onEnd` → `setFlashTick(t => t+1)` để `runningFlash` tính lại (giờ máy chủ), và `queryClient.invalidateQueries(['flash-sales','active'])`. (ii) chip phân loại gọi `variationPricing(v, flashList)`, hiện giá đó + "Giờ vàng" nhỏ khi `isFlash`. (iii) thay các khối rời bằng một thẻ trắng ba `ListRow trailing="chevron"`: Ưu đãi (`pdp.offerCount`, mở `PdpOffersSheet`), Vận chuyển (chữ giao hàng/freeship sẵn có), Phân loại (nhiều phân loại: tên đang chọn, mở `VariationSheet`); bỏ `shortDesc` khỏi khối đầu khi trùng `description`. (iv) sau dòng thông tin: `PdpBundleSlots`, `PdpQuickReviews` (2 đánh giá, "Xem tất cả" cuộn tới `ReviewsSection`). (v) dải "Thường mua kèm" đổi tên "Khách thường mua cùng" (`pdp.boughtTogether`), dải "Cùng nhà", cuối trang `PdpFeed` ("Có thể bạn cũng thích", `ProductGrid variant="grid"`, nguồn `fetchForYou`, qua `pdpShelves`).
- [ ] **Step 4:** chạy mọi `src/pages/product-detail*.spec.tsx` + `src/components/product` → PASS (spec cũ đỏ vì chữ cũ thì sửa theo thiết kế, ghi vào notes).
- [ ] **Step 5: Commit** (một commit mỗi mục i–v nếu tách được) `feat(miniapp): PDP FlashPriceBar, chip đúng giá Giờ vàng, dòng thông tin, đánh giá nhanh, dải gợi ý`.

### Task 4: Mini giỏ

**Files:** Create `apps/miniapp/src/pages/cart-footer.tsx`; Modify `pages/cart.tsx`, `pages/cart.spec.tsx`.

**Interfaces — Consumes:** `lineCompareAt`, `lineSaving`, `cartSaving` (Task 1); `Countdown mode="text"`; `PriceTag compareAt`.
- [ ] **Step 1: test đỏ** `cart.spec.tsx`: (a) dòng có `listUnitPrice 50000 > unitPrice 33000` hiện giá gạch `50.000đ` và chân hiện `Tiết kiệm 17.000đ`; `listUnitPrice` thiếu → không có "Tiết kiệm"; (b) dòng Giờ vàng có `flashEndAt` hiện `Kết thúc sau …` (role timer) và không còn `Đã bán 98%`; (c) chân dính có dòng mã (`Chọn mã giảm giá`/`{n} mã dùng được`) mở `VoucherSheet`, dòng miễn phí giao và hàng tổng + nút "Thanh toán (n)"; (d) `CouponBlock` không còn trong thân danh sách.
- [ ] **Step 2:** `npx vitest run src/pages/cart.spec.tsx` → FAIL.
- [ ] **Step 3:** dòng giỏ: [checkbox] [ảnh 72] [cột chữ: tên 2 dòng chừa 44 bên phải · phân loại · hàng đáy: `PriceTag` (+gạch) trái, `QuantitySelector size="sm"` phải]; thùng rác `IconButton` góc phải trên (vùng chạm 44). `cart-footer.tsx` (đủ ba hàng: mã, miễn phí giao có/không thanh, tổng + Tiết kiệm + nút ~160px) chứa `CouponBlock` cũ thu thành hàng 40. Giữ nguyên mọi logic chọn món/tính số hiện có.
- [ ] **Step 4:** chạy lại `cart.spec.tsx` + `src/utils` liên quan → PASS. **Step 5: Commit** `feat(miniapp): giỏ dòng gọn, giá gạch + Tiết kiệm, Countdown Giờ vàng, chân dính`.

### Task 5: Web PDP (khổ điện thoại + lg)

**Files:** Create `apps/web/src/components/mini/flash-price-bar.tsx` (+ export ở `mini/index.ts`), `components/layouts/pdp-layout.tsx` (+spec), `app/san-pham/[slug]/pdp-offers.tsx`, `pdp-quick-reviews.tsx`, `pdp-feed.tsx`; Modify `page.tsx`, `pdp-extras.tsx` (`PdpFlashMeta` → `FlashPriceBar`), `pdp-rails.tsx` (đổi tên dải), `components/add-to-cart.tsx` (chip giữ nguyên `variationPricing`, thêm dòng "Phân loại ›"), sửa `shop.web.spec.ts` chỗ chép mã.

**Interfaces — Produces:** `PdpLayout({ gallery, info, below, aside? }): JSX.Element` — dưới md xếp dọc nguyên con (không lớp `max-md:`); từ lg: lưới `[440px_minmax(0,1fr)]` trong một thẻ `rounded-card bg-[var(--color-bg-surface)] p-6`, không `sticky/overflow-y-auto`; hàng dưới `[minmax(0,1fr)_280px]`.
- [ ] **Step 1: test đỏ**: `pdp-layout.spec.tsx` (có slot gallery/info/below, lg có class lưới 440px, không có `overflow-y-auto`/`lg:sticky` ở cột info); `pdp-extras.spec.tsx`: `PdpFlashMeta` thay bằng `FlashPriceBar` (chữ "Kết thúc sau", "Đã bán n%"); `pdp-offers`: dòng "Ưu đãi" mở sheet; `page.spec.tsx` các ca cũ vẫn xanh.
- [ ] **Step 2:** `cd apps/web && npx vitest run "src/app/san-pham" src/components/layouts src/components/mini` → FAIL.
- [ ] **Step 3:** cài; web `Countdown` chỉ đọc giờ sau mount (đã có). `onEnd` đổi về giá thường qua `useActiveFlashSales` + một tick. Feed cuối trang nạp phía trình duyệt (`fetchForYou`), ẩn khi lỗi/rỗng.
- [ ] **Step 4:** chạy toàn bộ `src/app/san-pham`, `src/components` liên quan → PASS. **Step 5: Commit** `feat(web): PDP FlashPriceBar, dòng Ưu đãi/Vận chuyển/Phân loại, đánh giá nhanh, PdpLayout`.

### Task 6: Web giỏ

**Files:** Modify `apps/web/src/app/gio-hang/page.tsx`, specs `page.spec.tsx`, `cart-parity.spec.tsx`.
- [ ] **Step 1: test đỏ**: dòng có `listUnitPrice > unitPrice` hiện giá gạch + `Tiết kiệm`, dòng Giờ vàng có `Kết thúc sau`, không `Đã bán n%`; ở lg tóm tắt hiện "Tiết kiệm".
- [ ] **Step 2–4:** chạy `npx vitest run src/app/gio-hang` đỏ → sửa `page.tsx` dùng `lineCompareAt`/`cartSaving`, `Countdown` → xanh. **Step 5: Commit** `feat(web): giỏ giá gạch + Tiết kiệm, Countdown Giờ vàng`.

### Task 7: e2e web lg + ảnh

**Files:** Create `apps/e2e/tests/pdp-desktop.web.spec.ts`.
- [ ] Spec: 1280×800, mở PDP (sản phẩm có sẵn trong DB e2e, tự bỏ qua khi DB rỗng, mock phần trình duyệt như `pdp-mobile.web.spec.ts`), `await expect(page.getByRole('button', { name: /Thêm vào giỏ/ })).toBeInViewport()` và không phần tử trong `main` có `overflow-y:auto` mà `scrollHeight > clientHeight` (trừ sheet). Spec web cần API thật: chạy được thì chạy, không để CI.
- [ ] Chụp 375px Mini (Vite 3305) và web (Next 3306) PDP + giỏ vào `docs/2026-10-31-shop-redesign/screens/P8/`; so hai bản; tắt server.
- [ ] **Commit** `test(e2e): PDP web máy tính, nút mua trong khung 1280×800`.

### Task 8: gate

- [ ] Chạy gate đúng một lần: `bash docs/2026-10-28-review/tools/gate.sh <worktree> --base 2e52b9be9 --out <.../gate-P8.txt>`; rồi e2e Mini `cd apps/e2e && E2E_SCOPE=miniapp E2E_MINIAPP_PORT=3305 npx playwright test --workers=2 --reporter=line`. FAIL có sẵn từ base ghi "có sẵn"; FAIL do gói thì sửa.
