# K2 checkout: màn thanh toán hai app Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sửa màn thanh toán Mini App và web theo `review/extra-critique-2.md` (P1 #2, #3, #9; P2 #8, #9 phần thanh toán, #16, #17) mà không đổi cách tính tiền.

**Architecture:** Chữ và quyết định hiển thị (lý do khoá nút, ô tổng khi chưa có địa chỉ, gập dòng hàng) đặt ở `packages/app-core` kèm spec; hai trang chỉ vẽ. Web dưới `md` chỉnh theo số đo Mini bằng lớp mobile-first (không thêm `max-md:` vì bánh cóc), đo bằng một ca mới của `ds-parity.shop.spec.ts`.

**Tech Stack:** React 18, zmp-ui + Vite (Mini), Next 15 + Tailwind (web), vitest, Playwright.

**Spec:** `docs/2026-10-31-shop-redesign/01-thiet-ke.md` (§4 là luật); nguồn việc `review/extra-critique-2.md` (P1 #2, #3, #9; P2 #8, #9, #16, #17); bàn giao `plans/handoff-wave*.md`.

## Global Constraints

- `export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH` cho mọi lệnh. Worktree mới: `pnpm install --offline --frozen-lockfile`, `pnpm --filter @tubutree/shared-types build`, `npx prisma generate` (trong `apps/api`).
- Số khách trả do máy chủ báo giá: không đổi công thức, `quote`, `expectedTotal`, thứ tự giảm. Test tiền hiện có phải xanh.
- Chữ giao diện qua `packages/app-core/src/shop-copy.ts` (`fillCopy`, kèm ngân sách ở `shop-copy-budget.ts`); cấm "Vui lòng", "...", "Chỉ còn", "giờ vàng" thường (`FORBIDDEN_TERMS`).
- Token ngữ nghĩa, không `var(--stone/forest/clay-…)` hay lớp `stone-/forest-/clay-` trong trang thanh toán; không `fontSize` số.
- `pnpm lint:parity` (bánh cóc px và `max-md:`): không thêm px viết tay hay `max-md:` mới; hạ được thì `node scripts/uiux/ds-ratchet.mjs --write` và commit baseline. `pnpm lint:vars` xanh.
- Không sửa: `coupon-box.tsx` (K3) trừ nút "Đổi mã" tối thiểu ở Task 6 (ghi notes để gộp), `voucher-sheet.tsx`, `voucher.ts`, `coupon-view.ts`, `variation-*`, `add-to-cart.tsx`, `pdp-*`, `sheet.tsx`, `flash-sale.tsx`, `home-layout.ts`, `affiliate.tsx`, `ctv/page.tsx`.
- Vùng chạm ≥44px, tương phản ≥4,5:1, axe 0 vi phạm nặng ở 375px.
- Máy tải nặng: vitest theo file khi làm; gate đầy đủ một lần ở cuối; e2e `--workers=2`.

## Review Focus

1. Giỏ chỉ có một dòng hoặc đúng 5 dòng: không có nút "Xem thêm" thừa; 6 dòng thì "Xem thêm 1 sản phẩm" kèm tiền, bấm mở đủ và đổi sang "Thu gọn" (Task 1 spec `collapseCheckoutLines`, Task 6 spec trang).
2. Khách chưa có địa chỉ: không số nào đứng ở chỗ "Tổng cộng" như đã đủ, nút Đặt hàng khoá kèm lý do (Task 2, Task 4 spec).
3. Báo giá lỗi hoặc đang tính: nút khoá, lý do khác lý do thiếu địa chỉ, không hiện số cũ (Task 2).
4. Tên sản phẩm tiếng Việt dài có dấu, phân loại dài: tên cắt hai dòng, phân loại dòng riêng, không tràn ngang 375px (Task 4, Task 6, Task 9).
5. Đơn chọn một phần giỏ (`itemIds`): "Tạm tính" của các dòng thấy được vẫn là số báo giá, dòng "Đang thanh toán n/m sản phẩm" giữ (Task 6).

---

## File Structure

- Create `packages/app-core/src/commerce/checkout-display.ts` + `checkout-display.spec.ts`: ba hàm thuần (xem Task 1).
- Modify `packages/app-core/src/shop-copy.ts`, `shop-copy-budget.ts`: khoá `checkout.*`, `coupon.autoApplied`.
- Modify `packages/app-core/src/coupon-use.ts`: `couponAutoCopy.applied` đọc khoá mới.
- Modify `apps/miniapp/src/pages/checkout.tsx` (+ `checkout.spec.tsx`, `i18n/vi.ts`): Task 3, 4.
- Modify `apps/web/src/app/thanh-toan/page.tsx`, `invoice-section.tsx`, `apps/web/src/components/order-consent.tsx` (không đổi), `coupon-box.tsx` (nút Đổi mã): Task 5, 6, 7, 8.
- Modify `apps/e2e/tests/ds-parity.shop.spec.ts`, `support/ds-parity.ts`: ca thanh toán.
- Modify `packages/app-core/src/terminology.spec.ts`, `scripts/uiux/ds-baseline.json`.

---

### Task 1: app-core, chữ và hàm hiển thị thanh toán

**Files:**
- Create: `packages/app-core/src/commerce/checkout-display.ts`, `packages/app-core/src/commerce/checkout-display.spec.ts`
- Modify: `packages/app-core/src/shop-copy.ts`, `packages/app-core/src/shop-copy-budget.ts`, `packages/app-core/src/coupon-use.ts`, `packages/app-core/src/coupon-use.spec.ts`

**Interfaces:**
- Produces:
  - `checkoutPlaceHint(i: { hasAddress: boolean; quoteFailed: boolean }): string | null`: `!hasAddress` → `fillCopy('checkout.addressNeeded')`; `quoteFailed` → `fillCopy('checkout.quoteFailed')`; còn lại null (địa chỉ thiếu thắng lỗi báo giá).
  - `checkoutTotalText(i: { total: number | null; hasAddress: boolean }, formatMoney: (n: number) => string): string`: có `total` → số; có địa chỉ nhưng chưa có → `…`; chưa có địa chỉ → `fillCopy('checkout.totalPending')`.
  - `collapseCheckoutLines<T extends { total: number }>(lines: readonly T[], expanded: boolean, max?: number): { shown: T[]; hiddenCount: number; hiddenTotal: number }` (`max` mặc định `CHECKOUT_LINES_COLLAPSED` = 5; `lines.length <= max` hoặc `expanded` thì không gập).
  - Khoá `SHOP_COPY`: `checkout.addressNeeded` "Chọn địa chỉ giao hàng để đặt hàng.", `checkout.quoteFailed` "Chưa tính được tổng tiền. Bấm Thử lại ở phần tóm tắt rồi đặt hàng.", `checkout.totalPending` "Chưa tính", `checkout.shipNeedsAddress` "Nhập địa chỉ để tính phí", `checkout.calculating` "Đang tính…", `checkout.priceChangedHint` "Giá ưu đãi đã thay đổi. Bạn xem lại giỏ hàng trước khi đặt nhé.", `checkout.priceChangedBody` "Một số sản phẩm Giờ vàng đã hết suất hoặc hết giờ. Bạn xem lại giỏ hàng trước khi đặt nhé.", `checkout.invoiceIncomplete` "Bạn điền đủ MST, tên công ty, địa chỉ và email hợp lệ nhé.", `checkout.moreLines` "Xem thêm {n} sản phẩm", `checkout.fewerLines` "Thu gọn", `checkout.placeWith` "Đặt hàng · {total}", `coupon.autoApplied` "Tubu đã tự áp mã tốt nhất".

- [ ] **Step 1: Write the failing tests** `checkout-display.spec.ts`: `checkoutPlaceHint({hasAddress:false, quoteFailed:true})` = "Chọn địa chỉ giao hàng để đặt hàng."; `({true,true})` = câu quoteFailed; `({true,false})` = null. `checkoutTotalText({total:330000,hasAddress:true}, fmt)` = fmt(330000); `({null,true})` = "…"; `({null,false})` = "Chưa tính". `collapseCheckoutLines` với 5 dòng → `hiddenCount 0`; 6 dòng, `expanded=false` → `shown.length 5`, `hiddenCount 1`, `hiddenTotal` = tổng dòng thứ 6; 6 dòng, `expanded=true` → `shown.length 6`, `hiddenCount 0`. Thêm vào `coupon-use.spec.ts`: `couponAutoCopy.applied` = "Tubu đã tự áp mã tốt nhất".
- [ ] **Step 2: Run** `pnpm --filter @tubutree/app-core exec vitest run src/commerce/checkout-display.spec.ts src/coupon-use.spec.ts` → FAIL (thiếu module, chữ cũ "Đã tự áp").
- [ ] **Step 3: Implement** file mới theo chữ ký trên; thêm khoá vào `SHOP_COPY` thành một khối `// Thanh toán (K2)` ngay sau `cart.subtotalNet` và ngân sách tương ứng vào `SHOP_COPY_MAX` (câu dài `null`, `checkout.totalPending` 10, `checkout.moreLines` 24, `checkout.fewerLines` 10, `checkout.placeWith` 24, `coupon.autoApplied` 28); `couponAutoCopy.applied` = `SHOP_COPY['coupon.autoApplied']`.
- [ ] **Step 4: Run** lệnh Step 2 cộng `shop-copy.spec.ts` → PASS.
- [ ] **Step 5: Commit** `feat(app-core): chữ và hàm hiển thị thanh toán (lý do khoá nút, ô tổng, gập dòng hàng)`.

### Task 2: bỏ chữ cấm còn nợ ở thanh toán và dòng EXEMPT

**Files:**
- Modify: `apps/miniapp/src/pages/checkout.tsx` (1013, 1124, 1273), `apps/miniapp/src/i18n/vi.ts` (`flashSale.priceChangedBody`), `apps/web/src/app/thanh-toan/page.tsx` (472, 491), `apps/web/src/app/thanh-toan/invoice-section.tsx` (60), `packages/app-core/src/terminology.spec.ts`
- Test: `apps/web/src/app/thanh-toan/checkout-errors.spec.tsx`, `checkout-parity.spec.tsx`, `apps/miniapp/src/pages/checkout.spec.tsx`

**Interfaces:** Consumes khoá Task 1 (`checkout.invoiceIncomplete`, `checkout.priceChangedHint`, `checkout.priceChangedBody`, `checkout.calculating`).

- [ ] **Step 1: Update tests to the new text** (đỏ): `checkout-errors.spec.tsx:63` kỳ vọng `fillCopy('checkout.priceChangedBody')`; `checkout-parity.spec.tsx:197` kỳ vọng `fillCopy('checkout.invoiceIncomplete')`; trong `terminology.spec.ts` gỡ các dòng `EXEMPT`: `checkout.tsx` voice, `checkout.tsx` ellipsis, web `thanh-toan/page.tsx` voice, `invoice-section.tsx` voice, web `page.tsx` flash; giảm `max` của `vi.ts` voice (5 → 4) và flash (2 → 1).
- [ ] **Step 2: Run** `pnpm --filter @tubutree/app-core exec vitest run src/terminology.spec.ts` + hai spec web → FAIL.
- [ ] **Step 3: Implement**: thay chữ ở các dòng nêu trên bằng `fillCopy(...)`; `vi.flashSale.priceChangedBody` đọc cùng khoá (một nguồn chữ). Giữ nguyên chữ "Đang gửi đơn..." và placeholder ghi chú (ngoài phạm vi; ghi notes).
- [ ] **Step 4: Run** các lệnh Step 2 + `pnpm --filter @tubutree/miniapp exec vitest run src/pages/checkout.spec.tsx` → PASS.
- [ ] **Step 5: Commit** `fix(checkout): bỏ "Vui lòng", "Đang tính..." và "giờ vàng" thường ở thanh toán hai app`.

### Task 3: Mini, thiếu địa chỉ

**Files:**
- Modify: `apps/miniapp/src/pages/checkout.tsx` (khối tóm tắt 1105-1127, sheet chi tiết 1247-1285, thanh đặt hàng 1156-1181)
- Test: `apps/miniapp/src/pages/checkout.spec.tsx`

**Interfaces:** Consumes `checkoutPlaceHint`, `checkoutTotalText`, khoá `checkout.shipNeedsAddress`, `checkout.calculating`.

- [ ] **Step 1: Write the failing tests** (`describe('thiếu địa chỉ')`): không địa chỉ → trong thanh dính có text "Chọn địa chỉ giao hàng để đặt hàng." (`role="status"`) và nút "Đặt hàng" `disabled`; dòng phí ship ghi "Nhập địa chỉ để tính phí"; dòng "Tổng cộng" ghi "Chưa tính" và không có số tiền cuối; sheet "Chi tiết tính tiền" ghi "Chưa tính" ở "Tổng thanh toán". Báo giá lỗi (có địa chỉ): thanh dính ghi câu `checkout.quoteFailed`. Có địa chỉ và báo giá về: không có dòng lý do, nút ghi "Đặt hàng · {tổng}". Sửa các ca cũ đang đợi "Cần chọn địa chỉ giao hàng" và tổng xem trước (85.000đ, 81.000đ, 95.000đ) thành "Nhập địa chỉ để tính phí" và "Chưa tính"; các dòng giảm combo/mã/hạng và "Tạm tính" vẫn kiểm.
- [ ] **Step 2: Run** `pnpm --filter @tubutree/miniapp exec vitest run src/pages/checkout.spec.tsx` → FAIL.
- [ ] **Step 3: Implement**: bỏ `previewTotal`; hàng cuối của khối tóm tắt dự phòng và của sheet dùng `checkoutTotalText({ total: quote.data?.total ?? null, hasAddress: !!addressId }, formatVnd)`; phí ship `fillCopy('checkout.shipNeedsAddress')` / `checkout.calculating`; thanh dính truyền `summary` là `<Text role="status" size="xSmall">` với `checkoutPlaceHint({ hasAddress: !!addressId, quoteFailed: quote.isError })` khi khác null (thanh tự đo chiều cao).
- [ ] **Step 4: Run** lệnh Step 2 → PASS.
- [ ] **Step 5: Commit** `fix(miniapp): thanh toán thiếu địa chỉ ghi lý do cạnh nút Đặt hàng và "Chưa tính" thay tổng`.

### Task 4: Mini, tên hai dòng và token chip mã

**Files:**
- Modify: `apps/miniapp/src/pages/checkout.tsx` (dòng hàng 596-612, chip mã 644-677)
- Test: `apps/miniapp/src/pages/checkout.spec.tsx`, `apps/miniapp/src/css/contrast.spec.ts`

- [ ] **Step 1: Write the failing tests**: tên sản phẩm 70 ký tự có dấu: phần tử tên có `-webkit-line-clamp: 2` (style), không `white-space: nowrap`; phân loại nằm trong phần tử riêng sau tên; chip mã không có `fontSize` 11 và không chứa `var(--clay-`. `contrast.spec`: cặp `--color-promo-fg` trên `--color-promo-bg` ≥ 4,5 (thêm nếu chưa có).
- [ ] **Step 2: Run** `pnpm --filter @tubutree/miniapp exec vitest run src/pages/checkout.spec.tsx src/css/contrast.spec.ts` → FAIL.
- [ ] **Step 3: Implement**: tên `-webkit-box` 2 dòng; chip dùng `--color-promo-bg`, `--color-promo-solid-bg` (viền gạch), `--color-promo-fg`, chữ `var(--type-label-size)`; ô vuông icon dùng `--color-promo-bg` và `--color-promo-fg`.
- [ ] **Step 4: Run** lệnh Step 2 → PASS. `node scripts/uiux/ds-ratchet.mjs` không báo tăng.
- [ ] **Step 5: Commit** `fix(miniapp): thanh toán tên sản phẩm hai dòng, chip mã dùng token ngữ nghĩa`.

### Task 5: web, danh sách hàng đủ dòng và tên hai dòng

**Files:**
- Modify: `apps/web/src/app/thanh-toan/page.tsx` (667-704 khối `items`, `MobileItems`)
- Test: `apps/web/src/app/thanh-toan/checkout-lines.spec.tsx` (mới)

**Interfaces:** Consumes `collapseCheckoutLines`, `checkout.moreLines`, `checkout.fewerLines`.

- [ ] **Step 1: Write the failing tests** (giỏ 1 nơi giao): 6 dòng: vùng danh sách không có lớp `overflow-auto` hay `max-h-*`; chỉ 5 dòng chữ + nút "Xem thêm 1 sản phẩm" (`aria-expanded=false`) kèm tiền dòng ẩn; bấm → đủ 6 dòng, nút "Thu gọn", `aria-expanded=true`; tổng các dòng thấy được (kể cả tiền dòng gập) = "Tạm tính" của khối tóm tắt; 5 dòng thì không có nút. Mỗi dòng: tên `line-clamp-2`, phân loại ở phần tử riêng. Giỏ tách kiện (`split`) hiện đủ mọi kiện như cũ.
- [ ] **Step 2: Run** `pnpm --filter @tubutree/web exec vitest run src/app/thanh-toan/checkout-lines.spec.tsx` → FAIL.
- [ ] **Step 3: Implement**: bỏ `max-h-40 overflow-auto` và `tabIndex`; dùng `collapseCheckoutLines` với state `linesOpen`; hàng gập là nút `min-h-11` ghi chữ + tiền; `MobileItems` tên `line-clamp-2`. Khung dính ngoài (lg) giữ nguyên để nút Đặt hàng luôn trong màn (e2e `web-checkout` 1366×768); ghi notes lệch với DESIGN.md "không cột dính".
- [ ] **Step 4: Run** lệnh Step 2 + `checkout-split.spec.tsx`, `checkout-sticky.spec.tsx` → PASS.
- [ ] **Step 5: Commit** `fix(web): thanh toán 1280 hiện đủ dòng hàng, gập có nút "Xem thêm n sản phẩm"`.

### Task 6: web, nút Đặt hàng ghi số tiền, Đổi mã, token

**Files:**
- Modify: `apps/web/src/app/thanh-toan/page.tsx` (nút lg 828-835, 862-877, primitive stone/forest), `apps/web/src/components/coupon-box.tsx` (chỉ nút "Đổi mã ›" ở chip desktop và bỏ `md:hidden` của `#coupon-panel` khi có mã)
- Test: `checkout-sticky.spec.tsx`, `checkout-address-note.spec.tsx`, `apps/web/src/components/coupon-box.spec.tsx`, `apps/web/src/app/thanh-toan/coupon.spec.tsx`

- [ ] **Step 1: Write the failing tests**: nút lg ghi `fillCopy('checkout.placeWith', { total })` khi có báo giá, "Đặt hàng" khi chưa; mã đã áp ở khổ md+: có nút "Đổi mã" (`aria-expanded`), bấm mở bảng chọn mã có ô nhập, nhãn "Tubu đã tự áp mã tốt nhất" hiện khi mã tự áp. Cập nhật các `btn(c, 'Đặt hàng')`/`textContent === 'Đặt hàng'` sang tiền tố "Đặt hàng". Guard primitive: `grep -cE "(bg|text|border)-(stone|forest|clay)-" page.tsx` = 0.
- [ ] **Step 2: Run** các spec trên → FAIL.
- [ ] **Step 3: Implement**: nút Đổi mã dùng `setOpen` có sẵn; đổi lớp primitive sang `text-[color:var(--color-text-primary|secondary|brand)]`, `bg-[var(--color-bg-subtle)]`, `border-[var(--color-border-*)]`, `text-success-fg`, v.v.; viết mobile-first, không thêm `max-md:`.
- [ ] **Step 4: Run** các spec ở Step 2 + `pnpm lint:parity` → PASS.
- [ ] **Step 5: Commit** `feat(web): thanh toán 1280 đổi mã tại chỗ, nút Đặt hàng ghi số tiền, bỏ primitive màu`.

### Task 7: web 375 theo số đo Mini

**Files:**
- Modify: `apps/web/src/app/thanh-toan/page.tsx` (các khối `data-mini-block` address, items, payment, note, summary; thanh dính), `apps/web/src/app/thanh-toan/invoice-section.tsx` nếu lệch
- Modify: `apps/e2e/tests/support/ds-parity.ts`, `apps/e2e/tests/ds-parity.shop.spec.ts` (ca "Thanh toán": probe `checkout-address-card`, `checkout-summary-row`, `checkout-summary-total`, `checkout-block-title`, `checkout-note`)
- Test: `checkout-sticky.spec.tsx`, `checkout-parity.spec.tsx`, `checkout-mini.spec.tsx`

- [ ] **Step 1: Write the failing tests**: ca ds-parity (số đo Mini làm bảng chuẩn: thẻ địa chỉ cao 90, bước dòng tóm tắt 35, "Tổng cộng" 14/400, tiêu đề khối 14/500, ô ghi chú một dòng cao như `Input` Mini); vitest: ở điện thoại dòng đồng ý điều khoản nằm cuối nội dung (sau khối tóm tắt) chứ không trong thanh dính (`bar.contains(consent) === false`, còn một dòng ở khung tóm tắt lg), khách mới chưa có điểm thấy khối "Điểm Xanh" với chữ "Tích điểm từ đơn đầu tiên nhé" như Mini, lý do ví "Số dư chưa đủ" thụt lề như Mini.
- [ ] **Step 2: Run** vitest các spec trên → FAIL; ca ds-parity chạy ở Task 9.
- [ ] **Step 3: Implement**: "Mặc định" không xuống dòng (`flex-nowrap`, tên cắt `truncate`); `Row` tóm tắt `py-1.5` + `text-sm leading-[var(--type-body-sm-lh)]` ở khổ nhỏ; "Tổng cộng" 14/400 ở khổ nhỏ; ô ghi chú `rows={1}` cao bằng Mini; `OrderConsent` lên cuối nội dung (`lg:hidden`) và bỏ khỏi `StickyActionBar`; khối Điểm Xanh khách mới dùng chữ Mini (`vi.checkout.pointsNone` đưa sang app-core nếu cần một nguồn).
- [ ] **Step 4: Run** vitest các spec trên → PASS.
- [ ] **Step 5: Commit** `fix(web): thanh toán 375px theo số đo Mini (thẻ địa chỉ, dòng tóm tắt, ghi chú, điều khoản, Điểm Xanh khách mới)`.

### Task 8: bánh cóc và bảng chuẩn

**Files:** Modify `scripts/uiux/ds-baseline.json`.

- [ ] **Step 1:** `node scripts/uiux/ds-ratchet.mjs` (không tăng) rồi `node scripts/uiux/ds-ratchet.mjs --write` khi giảm.
- [ ] **Step 2: Run** `pnpm lint:parity && pnpm lint:vars` → PASS.
- [ ] **Step 3: Commit** `chore(ds): hạ baseline bánh cóc sau K2`.

### Task 9: chụp, e2e, gate

- [ ] **Step 1:** Vite Mini 3471 và Next web 3472 (API giả), chạy ca ds-parity thanh toán ở hai project; chụp mini375/web375/web1280 đầy đủ và thiếu địa chỉ, trước (base) và sau, lưu `docs/2026-10-31-shop-redesign/screens/K2/`.
- [ ] **Step 2:** `cd apps/e2e && E2E_SCOPE=miniapp E2E_MINIAPP_PORT=3471 npx playwright test --workers=2 --reporter=line` xanh (e2e cũ đỏ vì thiết kế thì sửa theo thiết kế, ghi notes).
- [ ] **Step 3:** `bash docs/2026-10-28-review/tools/gate.sh <worktree> --base 62a02f232 --out .../gate-K2.txt`; bước FAIL kiểm trên base.
- [ ] **Step 4: Commit** nếu có sửa theo kết quả.

## Self-Review

- P1 #2 → Task 5; P1 #3 → Task 2, 3; P1 #9 → Task 7 (+ Task 9 đo); P2 #8 → Task 1, 6; P2 #9 → Task 4, 6; P2 #16 → Task 4, 5; P2 #17 → Task 2. `pickerStockText` không thuộc gói.
- Tên dùng chung: `checkoutPlaceHint`, `checkoutTotalText`, `collapseCheckoutLines`, `CHECKOUT_LINES_COLLAPSED`, khoá `checkout.*` khớp giữa Task 1 và các task sau.
