# L4 final-polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** sửa MINOR cuối của L1 (giá nút mua tính cả giỏ) và L2 (thanh toán, mã giảm) và thống nhất chữ tồn kho "Còn {n} sản phẩm" ở hai app.

**Architecture:** mọi sửa là phía client. Số tiền khách trả không đổi (máy chủ vẫn giá cả dòng); đổi ở đây là cái khách NHÌN THẤY lúc bấm mua, khi mở bảng chọn, khi đặt đơn lỗi, ở sheet Ưu đãi PDP và chữ tồn kho. Chữ tồn kho và ngưỡng "tồn thấp" lấy từ một nơi trong `packages/app-core`.

**Tech Stack:** React 18, Next 15 (web), zmp-ui + Vite (Mini), TanStack Query 5.100.14, vitest, Playwright.

**Spec:** `docs/2026-10-31-shop-redesign/01-thiet-ke.md` (§4 là luật); plan gốc `plans/L1-flash-cart-aware.md`, `plans/L2-checkout-voucher-polish.md`.

## Global Constraints

- `export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH` cho mọi lệnh; worktree mới đã chạy `pnpm install --offline --frozen-lockfile`, `pnpm --filter @tubutree/shared-types build`, `npx prisma generate` (trong `apps/api`).
- Đường tiền (chỉ phần hiển thị): thứ tự giảm Giờ vàng → combo → mã → hạng → điểm, chia về `OrderItem.paidTotal`; số khách trả không đổi, không sửa API.
- Giá giảm màu `--color-text-price-deal`; tồn thấp dùng token cảnh báo có sẵn (`--color-status-warning-fg` Mini, `text-warning-fg` web), không đỏ, không chữ giục ("Chỉ còn" nằm trong `FORBIDDEN_TERMS`).
- Chữ: "Còn {n} sản phẩm" cho mọi n > 0, "Tạm hết hàng" khi hết (K1). Không đổi chữ Đổi rác (`waste-labels`, `recycle-labels`: nghĩa khác) và câu lỗi máy chủ ("Chỉ còn N sản phẩm trong kho." từ API, ngoài gói).
- Web khổ điện thoại giống Mini App cả giao diện: mỗi sửa giao diện làm ở cả hai app cùng cách.
- Vùng chạm ≥ 44px, tương phản ≥ 4,5:1; `pnpm lint:parity` và `pnpm lint:vars` xanh; hạ được số thì `node scripts/uiux/ds-ratchet.mjs --write` và commit baseline.
- Không đụng: `apps/web/src/components/home/flash-sale.tsx`, `apps/web/src/lib/flash-boot-script.ts`, `apps/miniapp/src/components/flash-sale.tsx`, `apps/web/src/app/page.tsx`, `apps/web/src/lib/home-initial.ts`, `packages/app-core/src/home-layout.ts` (phiên 9b); `affiliate.tsx`, `ctv/page.tsx` (R-185); của gói L3: bộ quét template của `terminology.spec.ts` (gói này chỉ sửa dòng miễn `USE.stock`), `DESIGN.md` đoạn terminology.spec, `coupon-notice.ts`, `identifier-validation.ts`, `flash-sale.service.ts`, `cart-combo.ts`, `cart-combo-block.tsx`, `ds-shop-rules.mjs` WEB_SHOP, storefront-builder, `ui/sheet.tsx`, `mini.css` (màu nền).
- Không push, không đọc/ghi PROD. Máy chung thiếu RAM: chạy vitest theo file, gate đầy đủ một lần ở cuối, e2e `--workers=2`.
- Comment chỉ giải thích "vì sao" không hiển nhiên (tiếng Việt, theo mật độ của file).

## Review Focus

1. "Mua ngay" mà giỏ đã có đúng phân loại ấy (Giờ vàng có giới hạn): số nút, câu `role=status` và bản đọc màn hình giữ nguyên tới lúc rời trang; lỗi API thì nút trở về theo giỏ hiện tại. Test Task 1 (cả hai app).
2. Mở bảng chọn "Mua ngay" trước khi GET /cart về, hoặc khách chưa đăng nhập, hoặc giỏ lỗi: bảng không cao thêm khi giỏ về. Test Task 2.
3. Đặt đơn lỗi mà onError tải lại báo giá (giá/tổng/giỏ đổi): nút nhận focus khi báo giá về, không giật focus về nút ở lần vẽ lại sau (khách đang sửa ô hoá đơn). Test Task 3.
4. Mã 0đ ở PDP Giờ vàng: nút "Sao chép" bật, lý do ngữ cảnh PDP, xếp sau mã dùng được; bảng chọn mã thanh toán giữ nguyên (không đổi `pickerRows`). Test Task 4.
5. Tồn kho 1, 5, 6, 40 và hết: cùng một chữ ở bảng chọn, PDP, giỏ hai app; chỉ n ≤ 5 có màu cảnh báo. Test Task 5.

---

## File Structure

- `apps/web/src/components/add-to-cart.tsx`, `apps/miniapp/src/pages/product-detail.tsx`: giữ giỏ lúc bấm "Mua ngay" (Task 1); chữ tồn thấp (Task 5).
- `apps/web/src/components/variation-sheet.tsx`, `apps/miniapp/src/components/variation-sheet.tsx`: giữ chỗ ghi chú ở chế độ buy (Task 2); chữ tồn + màu cảnh báo (Task 5).
- `apps/web/src/app/thanh-toan/page.tsx`: yêu cầu focus chờ báo giá xong (Task 3).
- `packages/app-core/src/commerce/voucher-picker.ts`, `shop-copy.ts`, `shop-copy-budget.ts`: mã 0đ ở PDP (Task 4).
- `packages/app-core/src/commerce/stock-text.ts` (mới), `tile-copy.ts`, `variation-picker.ts`, `terminology.spec.ts` (dòng miễn), vi.ts Mini, `gio-hang/page.tsx`, `checkout-rules.ts`: chữ tồn kho (Task 5).

---

### Task 1: "Mua ngay" giữ số lúc bấm (đã tìm ra lỗi ở cả hai app)

**Files:**
- Modify: `apps/web/src/components/add-to-cart.tsx` (state `buyFreeze`, `cartLines` thay `cartData?.items` ở `variationLinePreview` và `VariationSheet`), `apps/miniapp/src/pages/product-detail.tsx` (như vậy, qua `onMutate` của `buyNowMutation`)
- Test: `apps/web/src/components/add-to-cart.spec.tsx`, `apps/miniapp/src/pages/product-detail-flash.spec.tsx`

**Interfaces:**
- Produces: không đổi chữ ký công khai. Nội bộ: `buyFreeze: { lines: CartLines } | null` với `type CartLines = readonly { variationId: string; quantity: number }[] | undefined`; `cartLines = buyFreeze ? buyFreeze.lines : liveCartItems`.

- [x] **Step 1: Test đỏ.** Web (describe "giỏ đã có sẵn cùng phân loại"): giỏ có 2, Giờ vàng giới hạn 3, `addToCart` trả giỏ 3, `router.push` là mock không đổi trang. Bấm Mua ngay ở thanh dính, `flush(3)`: `aria-label` còn `Đang xử lý… · 720.000đ` (không `1.200.000đ`), ghi chú `Giỏ đã có 2: Mua ngay thanh toán cả 3 sản phẩm.`, nút Thêm vào giỏ `Thêm vào giỏ · 240.000đ`. Ca thứ hai: API lỗi thì nhãn về `Mua ngay · 720.000đ`, rồi thêm giỏ thành công thì nút vẽ theo giỏ mới (`Mua ngay · 1.200.000đ`). Mini (`product-detail-flash.spec.tsx`, hoist `navigate`): cùng hai ca với `getByRole('button', { name: /^Mua ngay/ })` giữ `Mua ngay · 240.000đ`, `MERGE_2` còn, không có "Giỏ đã có 3".
- [x] **Step 2: Run** `cd apps/web && npx vitest run src/components/add-to-cart.spec.tsx -t "Mua ngay"`; `cd apps/miniapp && npx vitest run src/pages/product-detail-flash.spec.tsx -t "Mua ngay"` → FAIL (nhận `1.200.000đ` / `400.000đ`). Mini cũng có lỗi (route cũ còn mount trong hiệu ứng thoát).
- [x] **Step 3: Implement.** Bấm "Mua ngay" thì chụp `cartData?.items` vào `buyFreeze` (web: đầu `add` khi `buyNow`; Mini: `onMutate` của `buyNowMutation`); gỡ khi lỗi (web: `finally` khi không `leaving`; Mini: `onError`). Thành công thì giữ tới khi trang gỡ (web `router.push`, Mini hiệu ứng thoát rồi unmount nên không cần gỡ).
- [x] **Step 4: Run** hai file spec đầy đủ → PASS.
- [ ] **Step 5: Commit** `fix(shop): Mua ngay giữ số nút và câu ghi chú tới lúc rời trang, không nhảy theo giỏ vừa thêm (L4 1)`.

---

### Task 2: bảng chọn "Mua ngay" giữ chỗ ghi chú, không cao thêm khi giỏ về

**Files:**
- Modify: `apps/web/src/components/variation-sheet.tsx:84`, `apps/miniapp/src/components/variation-sheet.tsx:86` (`reserveNote`)
- Test: `apps/web/src/components/variation-sheet.spec.tsx`, `apps/miniapp/src/components/variation-sheet.spec.tsx`

**Interfaces:** không đổi props. `reserveNote = line?.allowance != null || mode === 'buy'`.

Chọn "luôn giữ chỗ ở chế độ buy" (không thêm prop `loggedIn`/`cartPending`): giữ có điều kiện thì giỏ về rỗng lại làm bảng thấp đi dưới ngón tay, vẫn nhảy; luôn giữ thì hết nhảy ở mọi trạng thái (đang tải, khách chưa đăng nhập, giỏ lỗi, giỏ rỗng). Giá phải trả là một dải trống 2 dòng caption trong bảng "Mua ngay" khi không có gì để ghi; chế độ add không đổi.

- [ ] **Step 1: Test đỏ.** Hai app, mỗi app: (a) `mode: 'buy'`, `flash: []`, `cartLines: undefined` → có `role=status` với `style.minHeight` khác rỗng và trống; (b) dựng lại cùng cây với `cartLines` có 2 của phân loại đang chọn → vẫn đúng một phần tử `role=status` (cùng nút DOM, `toBe`) nay có câu "Giỏ đã có 2: Mua ngay thanh toán cả 3 sản phẩm." (chứng tỏ chỗ có từ trước khi giỏ về); (c) `mode: 'add'`, `flash: []`, giỏ trống → không có `role=status` (giữ ca cũ).
- [ ] **Step 2: Run** hai file spec → FAIL ở (a), (b).
- [ ] **Step 3: Implement** `reserveNote` ở hai file; sửa comment ngay trên nó (nói chế độ buy luôn giữ chỗ và vì sao).
- [ ] **Step 4: Run** hai file spec, thêm `add-to-cart.spec.tsx` và `product-detail-flash.spec.tsx` → PASS (sửa ca cũ nào khẳng định không có vùng ở chế độ buy).
- [ ] **Step 5: Commit** `fix(shop): bảng chọn Mua ngay luôn giữ chỗ ghi chú, không cao thêm khi giỏ về muộn (L4 2)`.

---

### Task 3: thanh toán lg, đặt đơn lỗi thì nút nhận focus kể cả khi onError tải lại báo giá

**Files:**
- Modify: `apps/web/src/app/thanh-toan/page.tsx` (effect scroll+focus quanh dòng 340)
- Test: `apps/web/src/app/thanh-toan/checkout-lg-place.spec.tsx`

**Interfaces:** nội bộ: `placeFocusDue: MutableRefObject<boolean>`; `placeSettled = !quoteQ.isFetching && !cartQ.isFetching && !couponChanging`.

Nguyên nhân: query-core 5.100.14 `mutation.js` chạy `await options.onError` (gọi `invalidateQueries` báo giá/giỏ) rồi mới `#dispatch({type:'error'})`; lúc `place.isError` hiện ra báo giá đang tải nên `placeDisabled` đúng và `focus()` vào nút khoá bị bỏ qua.

- [x] **Step 1: Test đỏ.** Thêm `state.quoteDelay` cho mock `checkoutQuote`. Lỗi `PRICE_CHANGED` (onError làm tải lại báo giá), báo giá về sau 40ms: sau lỗi nút còn khoá; sau khi về, `document.activeElement` là nút và `scrollIntoView` gọi đúng 1 lần. Ca giữ: focus đã trả một lần, `blur()`, các lần vẽ lại sau đó không kéo focus về nút.
- [x] **Step 2: Run** `cd apps/web && npx vitest run src/app/thanh-toan/checkout-lg-place.spec.tsx` → FAIL (activeElement là body).
- [x] **Step 3: Implement.** Effect 1 (theo `place.isError`, `place.error`, `place.submittedAt`, chỉ từ lg): `scrollIntoView` và đặt `placeFocusDue.current = true`. Effect 2 (theo `placeSettled`, `place.error`, `place.submittedAt`): nếu có yêu cầu và `placeSettled` thì hạ cờ rồi `focus` nút nếu `!button.disabled` (đọc từ DOM vì hook phải đứng trước các `return` sớm, lúc đó `placeDisabled` chưa tính).
- [x] **Step 4: Run** file spec và `checkout-errors`, `checkout-race`, `checkout-sticky` → PASS.
- [ ] **Step 5: Commit** `fix(web): thanh toán lg trả focus về nút Đặt hàng sau khi báo giá tải lại xong, không bỏ sót khi onError làm nút khoá (L4 3)`.

---

### Task 4: sheet Ưu đãi PDP, mã 0đ vẫn chép được

**Files:**
- Modify: `packages/app-core/src/commerce/voucher-picker.ts` (`offerRows`, doc comment), `packages/app-core/src/shop-copy.ts` + `shop-copy-budget.ts` (khoá mới `coupon.zeroDiscountPdp`, thay `coupon.zeroDiscount` chỉ `offerRows` dùng)
- Test: `packages/app-core/src/commerce/voucher-picker.spec.ts`, `apps/miniapp/src/components/product/pdp-offers-sheet.spec.tsx`, `apps/web/src/app/san-pham/[slug]/pdp-extras.spec.tsx` (tên thật tra khi làm)

**Interfaces:**
- `OfferRow.group` giữ `'usable' | 'short' | 'blocked'`: `blocked` chỉ còn để xếp sau cùng và mang lý do, không còn nghĩa khoá nút. Hàng `blocked` có `view.state === 'saved'` (nút "Sao chép" bật), `reason === fillCopy('coupon.zeroDiscountPdp')` = "Không giảm cho sản phẩm Giờ vàng này". `pickerRows` (bảng chọn mã thanh toán, áp thẳng) KHÔNG đổi.
- Lý do không hứa "mua thêm thì dùng được" vì mã gắn riêng sản phẩm đó thì mua món khác không giúp; nút chép bật vì chép không gây hại và mã có đơn tối thiểu cùng cảnh này đã chép được.

- [ ] **Step 1: Test đỏ.** `voucher-picker.spec.ts` (describe "offerRows: món đang Giờ vàng"): `A20` có `group 'blocked'`, `view.state 'saved'`, `reason 'Không giảm cho sản phẩm Giờ vàng này'`, thứ tự vẫn `['FREE','MIN','A20']`; thêm ca `pickerRows` với preview `eligible:false, reason: 'Không có sản phẩm nào trong đơn được giảm theo mã này.'` vẫn `group 'blocked'`, `view.state 'ineligible'` (bảng thanh toán giữ như L2). Hai sheet PDP: món đang Giờ vàng + mã không đơn tối thiểu → nút "Sao chép" của hàng đó không `aria-disabled`, lý do hiện, bấm gọi `onCopy`/ghi vùng đọc.
- [ ] **Step 2: Run** `cd packages/app-core && npx vitest run src/commerce/voucher-picker.spec.ts` và hai spec sheet → FAIL.
- [ ] **Step 3: Implement.** `offerRows`: `voucherView({ ...coupon, claimed: true, ineligible: false }, now)` cho mọi hàng (hàng `nothing` vẫn `group 'blocked'`, `reason` khoá mới); xoá `coupon.zeroDiscount` nếu không còn ai dùng; ngân sách `coupon.zeroDiscountPdp: 40`; sửa doc comment nói đúng nghĩa.
- [ ] **Step 4: Run** `voucher-picker`, `shop-copy`, `terminology` (app-core) và hai spec sheet → PASS.
- [ ] **Step 5: Commit** `fix(app-core): sheet Ưu đãi PDP giữ nút Sao chép bật cho mã 0đ của món Giờ vàng, lý do hợp ngữ cảnh PDP (L4 4)`.

---

### Task 5: một chữ tồn kho "Còn {n} sản phẩm"

**Files:**
- Create: `packages/app-core/src/commerce/stock-text.ts`, `packages/app-core/src/commerce/stock-text.spec.ts`
- Modify: `packages/app-core/src/commerce/tile-copy.ts` (+ `'stock.left': 'Còn {n} sản phẩm'`), `shop-copy-budget.ts`, `packages/app-core/src/variation-picker.ts` (`pickerStockText` gọi `stockText`, bỏ hằng cục bộ), `apps/web/src/components/pdp-stock.ts` (`LOW_STOCK_NOTICE` lấy từ app-core), `apps/miniapp/src/pages/product-detail.tsx` (`LOW_STOCK_THRESHOLD` thành `LOW_STOCK_NOTICE`), `apps/web/src/components/add-to-cart.tsx:376`, `apps/web/src/app/gio-hang/page.tsx:300`, `apps/miniapp/src/pages/cart.tsx:596` + `i18n/vi.ts` (`stockLimited`, câu `overStock` ở dòng 252), `apps/web/src/lib/checkout-rules.ts:103`, `variation-sheet.tsx` hai app (màu cảnh báo), `packages/app-core/src/terminology.spec.ts` (xoá dòng miễn `USE.stock` của `add-to-cart.tsx`, `gio-hang/page.tsx`, `checkout-rules.ts`, `i18n/vi.ts`; giữ `waste-labels.ts`, `recycle-labels.ts`)
- Test: `variation-picker.spec.ts`, `stock-text.spec.ts`, `terminology.spec.ts`, spec cũ khớp chữ cũ (`gio-hang/page.spec.tsx`, `add-to-cart.spec.tsx`, `cart.spec.tsx` Mini, `checkout-rules.spec.ts`, `checkout-parity.spec.tsx`), `variation-sheet.spec.tsx` hai app

**Interfaces:**
```ts
// packages/app-core/src/commerce/stock-text.ts
export const LOW_STOCK_NOTICE = 5;
export function isLowStock(stock: number): boolean;      // 0 < stock <= LOW_STOCK_NOTICE
export function stockText(stock: number): string;        // <=0 → fillTileCopy('stock.out'); còn lại fillTileCopy('stock.left', { n })
```
`pickerStockText(stock)` = `stockText(stock)` (giữ tên đã có người import). Màu cảnh báo chỉ ở n ≤ `LOW_STOCK_NOTICE` (`isLowStock`), chữ không đổi theo mức.

- [ ] **Step 1: Test đỏ.** `stock-text.spec.ts`: `stockText(0)` "Tạm hết hàng", `stockText(1|5|6|40)` "Còn n sản phẩm" (không "Chỉ còn", không "Còn 6" trần), `isLowStock(0|1|5|6)` = false/true/true/false. `variation-picker.spec.ts`: `pickerStockText(6)` "Còn 6 sản phẩm", `(40)` "Còn 40 sản phẩm". `variation-sheet.spec.tsx` hai app: tồn 3 → dòng "Gói 80 tờ · Còn 3 sản phẩm" với phần "Còn 3 sản phẩm" có màu cảnh báo (`--color-status-warning-fg` / `text-warning-fg`), tồn 245 → không màu cảnh báo. Gỡ dòng miễn trong `terminology.spec.ts` thì spec đỏ trên các file còn "Chỉ còn".
- [ ] **Step 2: Run** `cd packages/app-core && npx vitest run src/commerce/stock-text.spec.ts src/variation-picker.spec.ts src/terminology.spec.ts` và hai `variation-sheet.spec.tsx` → FAIL.
- [ ] **Step 3: Implement** theo danh sách file. Câu `overStock` ("Sản phẩm "X" chỉ còn N sản phẩm. Vui lòng sửa số lượng…") thành "… hiện còn N sản phẩm. …" ở cả hai app (cùng một câu). Cập nhật comment `pdp-extras.tsx:272`, `pdp-stock.ts` không còn nhắc "Chỉ còn". Sửa spec cũ khớp chữ mới.
- [ ] **Step 4: Run** `pnpm --filter @tubutree/app-core test`, `cd apps/web && npx vitest run src/components/add-to-cart.spec.tsx src/app/gio-hang src/lib/checkout-rules.spec.ts src/app/thanh-toan/checkout-parity.spec.tsx src/components/variation-sheet.spec.tsx`, `cd apps/miniapp && npx vitest run src/pages/cart.spec.tsx src/components/variation-sheet.spec.tsx` → PASS; e2e grep không còn khớp "Chỉ còn" khách đọc: `grep -rn "Chỉ còn" apps/web/src apps/miniapp/src apps/e2e/tests | grep -v "spec\\.\\|waste\\|recycle"` chỉ còn comment.
- [ ] **Step 5: Commit** `fix(shop): một chữ tồn kho "Còn {n} sản phẩm" cho mọi n, tồn thấp chỉ nhấn bằng màu cảnh báo; gỡ dòng miễn USE.stock (L4 5)`.

---

### Task 6: ảnh, bánh cóc, e2e, gate, PROGRESS

- [ ] **Step 1:** dựng API giả như `handoff-wave2.md`; chụp (ẩn huy hiệu Next dev) vào `docs/2026-10-31-shop-redesign/screens/L4/`: sheet Ưu đãi PDP có món Giờ vàng (hàng mã 0đ, lý do, nút chép bật) mini375 và web375; bảng chọn mã thanh toán có lý do "Đơn tối thiểu … không tính hàng Giờ vàng và phần giảm combo" (Mini + web 375); nút mua khi tồn 3 (màu cảnh báo) ở PDP và bảng chọn, mini375 và web375. So hai bản 375, tắt server của mình.
- [ ] **Step 2:** `pnpm lint:parity && pnpm lint:vars`; hạ baseline thì `node scripts/uiux/ds-ratchet.mjs --write` và commit.
- [ ] **Step 3:** e2e Mini (lệnh trong đề gói) rồi `bash docs/2026-10-28-review/tools/gate.sh <worktree> --base 11ac10883 --out /Users/longla/coding/tubutree-mini-app/.claude/worktrees/gate-L4.txt`; bước FAIL kiểm trên base (worktree tạm hoặc so log). Rồi e2e Mini đầy đủ `--workers=2`. Sửa e2e khớp chữ tồn kho mới nếu có.
- [ ] **Step 4:** thêm mục "L4" vào `PROGRESS.md`, commit.

## Self-Review

- (1) Task 1; (2) Task 2; (3) Task 3; (4) Task 4; (5) Task 5; (6) Task 6. Kiểm Mini `product-detail.tsx` có cùng lỗi: có (test đỏ xác nhận), sửa cùng cách.
- Tên dùng chung: `stockText`, `isLowStock`, `LOW_STOCK_NOTICE` (app-core `commerce/stock-text.ts`), khoá `stock.left`, `coupon.zeroDiscountPdp`, `buyFreeze`, `placeFocusDue` khớp giữa các task.
- Chọn thay chủ: bảng "Mua ngay" luôn giữ dải ghi chú 2 dòng (đánh đổi một dải trống để bảng không nhảy); lý do mã 0đ ở PDP không hứa "mua thêm thì dùng được".
