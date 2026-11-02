# L2 checkout-voucher-polish: MINOR còn lại của K2 (thanh toán) và K3 (bảng chọn mã) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sửa các MINOR reviewer để lại ở gói K2 và K3 (đã gộp vào nhánh tích hợp): lý do khoá nút Đặt hàng ở lg, lỗi đặt đơn thấy được ở lg, chữ "Chưa đủ" gây khó hiểu khi máy chủ không tính hàng Giờ vàng, mã không giảm được món Giờ vàng, vùng đọc chép mã, token primitive còn sót, file chết `coupon-card`, và hai lỗ kiểm e2e.

**Architecture:** Quyết định chữ và xếp nhóm mã nằm ở `packages/app-core` (`voucher-picker.ts`, `shop-copy.ts`) kèm spec; hai app chỉ vẽ. Phần web thanh toán sửa tại `apps/web/src/app/thanh-toan/page.tsx` trong khung "Đơn hàng" hiện có, không thêm cột dính hay vùng cuộn riêng.

**Tech Stack:** TypeScript, React 18, Next 15 + Tailwind (web), zmp-ui + Vite (Mini), vitest + Testing Library, Playwright.

**Spec:** `docs/2026-10-31-shop-redesign/01-thiet-ke.md` (§4 là luật); `plans/K2-checkout.md` và `plans/K3-voucher-picker.md` (mục "Ghi chú sau review"); bàn giao `plans/handoff-wave*.md`. Mục L2 không có trong `02-ke-hoach.md`: danh sách việc (a) đến (k) lấy từ đề bài của gói, được đánh lại dưới đây.

## Global Constraints

- `export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH` cho mọi lệnh; worktree mới: `pnpm install --offline --frozen-lockfile`, `pnpm --filter @tubutree/shared-types build`, `npx prisma generate` (trong `apps/api`) trước gate.
- Số khách trả do máy chủ báo giá: không đổi công thức, `quote`, `expectedTotal`, thứ tự giảm Giờ vàng → combo → mã → hạng → điểm.
- Chữ giao diện qua `packages/app-core/src/shop-copy.ts` (`fillCopy`), khoá mới đặt cạnh khoá cùng nhóm (`coupon.*`), kèm ngân sách ở `shop-copy-budget.ts`; cấm "Vui lòng", "...", "Chỉ còn", "giờ vàng" thường (`FORBIDDEN_TERMS`).
- Token ngữ nghĩa, không `var(--stone/forest/clay-…)` hay lớp primitive `stone-/forest-/clay-` trong màn mua sắm.
- `pnpm lint:parity` và `pnpm lint:vars` xanh; hạ được số thì `node scripts/uiux/ds-ratchet.mjs --write` và commit baseline; không thêm px viết tay hay `max-md:` mới.
- Vùng chạm ≥44px, tương phản ≥4,5:1, axe 0 vi phạm nặng ở 375px.
- Không sửa file gói khác: 9b (`flash-sale.tsx`, `flash-boot-script.ts`, `home-*`), L1 (`flash-line.ts`, `add-to-cart.tsx`, `product-detail.tsx`, `variation-sheet`, `variation-chip`, `pdp-bundles`), K4 (chữ API, bộ quét của `terminology.spec.ts`, `pickerStockText`), K5 (`cart.service`, `cart.tsx`, `gio-hang/page.tsx`), K6 (CTV), K7 (`mini.css`, bottom-sheet hai app, `ui/sheet.tsx`). Ở `terminology.spec.ts` chỉ xoá đúng dòng miễn của `coupon-card.tsx`.
- Máy tải nặng: vitest theo file khi làm; gate đầy đủ một lần ở cuối; e2e `--workers=2`. Không push, không đọc/ghi PROD.

## Review Focus

1. Mã `minOrder` thật sự chưa đủ (tạm tính dưới ngưỡng) mà máy chủ báo "Đơn tối thiểu": vẫn "Chưa đủ" kèm đúng câu máy chủ, không bị đổi chữ nhầm thành lý do Giờ vàng (Task 1).
2. Mã FREESHIP trên món Giờ vàng (số giảm tiền 0 nhưng máy chủ vẫn cho dùng): không bị xếp vào "không dùng được" (Task 1).
3. Lỗi đặt đơn do giá đổi hoặc giỏ cần sửa (banner ở đầu trang, xa nút ở lg): lý do vẫn hiện cạnh nút Đặt hàng, không thêm vùng `role="alert"` thứ hai (Task 3).
4. Khổ điện thoại: thanh dính đáy giữ nguyên, phần thêm ở lg không lộ ra dưới `lg` (Task 3, e2e 375 của `web-checkout.web.spec.ts`).
5. Chép cùng một mã hai lần liền trong 4 giây, rồi chép mã khác: trình đọc màn hình nghe cả hai lần (Task 2).

---

## File Structure

- Modify `packages/app-core/src/commerce/voucher-picker.ts` (+ `voucher-picker.spec.ts`), `packages/app-core/src/shop-copy.ts`, `packages/app-core/src/shop-copy-budget.ts`: Task 1.
- Modify `apps/web/src/app/san-pham/[slug]/pdp-extras.tsx` (+ `pdp-extras.spec.tsx`): Task 2.
- Modify `apps/web/src/app/thanh-toan/page.tsx` (+ `checkout-lg-place.spec.tsx` mới), `apps/e2e/tests/web-checkout.web.spec.ts`: Task 3.
- Modify `apps/web/src/app/thanh-toan/invoice-section.tsx`, `apps/web/src/components/catalog/filter-sidebar.tsx`, `apps/web/src/components/reorder/reorder-sheet.tsx` (một lớp `accent-` mỗi file), `scripts/uiux/ds-shop-rules.mjs`, `apps/web/src/components/ds-shop-guard.spec.ts`: Task 4.
- Delete `apps/miniapp/src/components/loyalty/coupon-card.tsx`, `coupon-card.spec.tsx`; Modify `packages/app-core/src/terminology.spec.ts`, `scripts/uiux/ds-baseline.json`: Task 5.
- Task 6 chỉ điều tra (không file) trừ khi lỗi do mã shop.
- Task 7 chạy e2e và đối chiếu base; Task 8 chụp ảnh, bánh cóc, gate.

---

### Task 1: voucher-picker, hai lý do máy chủ thật sự làm (f, h)

**Files:**
- Modify: `packages/app-core/src/commerce/voucher-picker.ts` (`pickerRows` nhánh `preview` không eligible; `offerRows`), `packages/app-core/src/shop-copy.ts`, `packages/app-core/src/shop-copy-budget.ts`
- Test: `packages/app-core/src/commerce/voucher-picker.spec.ts`

**Interfaces:**
- Produces (chữ ký không đổi): `pickerRows`, `offerRows`, `OfferRow<T>`. `OfferRow` thêm `group: 'usable' | 'short' | 'blocked'`; `view.state` là `'ineligible'` khi `blocked`.
- Khoá `SHOP_COPY` mới (cạnh `coupon.shipAlreadyFree`): `coupon.minOrderBase` "Đơn tối thiểu {min} không tính hàng Giờ vàng và phần giảm combo", `coupon.zeroDiscount` "Không có sản phẩm nào trong đơn được giảm theo mã này". Luật máy chủ: `couponBase` (checkout.service.ts) loại dòng Giờ vàng và trừ combo trước `validateAndCompute`; `couponScopedSubtotal` so `minOrder` trên phần đó; `previewMany` trả `COUPON_ZERO_DISCOUNT_REASON` khi giảm 0 mà không phải FREESHIP.

- [ ] **Step 1: Write the failing tests** trong `voucher-picker.spec.ts`:
  - Sửa ca "máy chủ chặn câu đơn tối thiểu dù tiền hàng đủ": `subtotal 250_000`, `minOrder 199_000`, máy chủ `MIN_SENTENCE` → `group 'short'`, `label 'Chưa đủ'`, `reason === 'Đơn tối thiểu 199k không tính hàng Giờ vàng và phần giảm combo'`, `reason` không chứa `'Đơn tối thiểu 199.000đ để dùng mã này'`, `view.condition === ''`.
  - Giữ nguyên các ca `subtotal < minOrder` (câu máy chủ nguyên văn, không "Mua thêm"). Thêm ca biên `subtotal === minOrder` (199_000) cũng ra câu mới, và ca `subtotal 198_999` ra câu máy chủ.
  - Mã gắn sản phẩm (`products`) đủ tạm tính, máy chủ báo câu đơn tối thiểu: dòng điều kiện vẫn "Chỉ áp cho Hạt chia" (ca hiện có đổi `reason` sang câu mới).
  - `offerRows` (mới, nhóm "món Giờ vàng"): `amount 0` (`offerAmount(250_000, 1, true)`) với `[c('A20'), c('FREE', { type: 'FREESHIP', value: 0 }), c('MIN', { minOrder: 199_000 })]` → thứ tự `['FREE', 'MIN', 'A20']`; `A20` có `group 'blocked'`, `view.state 'ineligible'`, `reason === 'Không có sản phẩm nào trong đơn được giảm theo mã này'`; `FREE` `group 'usable'` `reason null`; `MIN` `group 'short'` `reason 'Mua thêm 199k để dùng'`. Với `amount 120_000` mọi mã không đơn tối thiểu vẫn `usable` (ca "mã đủ điều kiện cho món trước" hiện có xanh).
- [ ] **Step 2: Run** `cd packages/app-core && npx vitest run src/commerce/voucher-picker.spec.ts` → FAIL (chữ cũ, thiếu `group`).
- [ ] **Step 3: Implement.** `pickerRows`: trong nhánh `preview` không eligible, khi `serverReason` khớp `MIN_ORDER_SENTENCE` và `coupon.minOrder != null && ctx.subtotal >= coupon.minOrder` thì `reason = fillCopy('coupon.minOrderBase', { min: vndShort(coupon.minOrder) })`, nhóm vẫn `short`; chỗ tính `duplicatesMin` nhận ra cả câu mới (đừng vẽ "Đơn từ …" hai lần). `offerRows`: mã không FREESHIP, `amount <= 0`, không có đơn tối thiểu → `blocked`; xếp usable, short, blocked (trong nhóm giữ luật cũ); `view.state = 'ineligible'` cho `blocked`, còn lại `saved`. Thêm hai khoá shop-copy và ngân sách (`coupon.minOrderBase` 70, `coupon.zeroDiscount` null).
- [ ] **Step 4: Run** lệnh Step 2 cộng `npx vitest run src/shop-copy.spec.ts src/terminology.spec.ts` → PASS.
- [ ] **Step 5: Commit** `fix(app-core): bảng chọn mã nói đúng lý do khi máy chủ không tính hàng Giờ vàng và khi món Giờ vàng không được giảm theo mã (L2 f, h)`.

---

### Task 2: vùng đọc chép mã đọc lần nào cũng đọc (g)

**Files:**
- Modify: `apps/web/src/app/san-pham/[slug]/pdp-extras.tsx` (`PdpCoupons`, vùng `data-testid="pdp-coupon-live"`)
- Test: `apps/web/src/app/san-pham/[slug]/pdp-extras.spec.tsx`

**Interfaces:** Consumes `useGameNotice()` (notice có `id` tăng mỗi lần `notify`). Vùng live vẫn là một phần tử `p` cố định, có mặt và trống lúc mở sheet.

- [ ] **Step 1: Write the failing test** `it('chép cùng một mã hai lần liền: vùng đọc nhận nút chữ mới mỗi lần (trình đọc nghe lại)')`: mở sheet, gắn `MutationObserver` lên `[data-testid="pdp-coupon-live"]` (`childList`, `subtree`, `characterData`), bấm "Sao chép" lần một rồi `flush`, ghi số bản ghi `addedNodes`; bấm lần hai (cùng mã, trong 4 giây) rồi `flush`: `textContent` của vùng giữ nguyên chữ `Đã chép mã ALL — …` và có thêm ít nhất một bản ghi `addedNodes` so với sau lần một; `dialog()!.querySelector('[data-testid="pdp-coupon-live"]')` vẫn là chính phần tử `live` cũ; vẫn chỉ một vùng `role="status"` trong trang.
- [ ] **Step 2: Run** `cd apps/web && npx vitest run "src/app/san-pham/[slug]/pdp-extras.spec.tsx" -t "hai lần liền"` → FAIL (React không đổi DOM khi chữ trùng).
- [ ] **Step 3: Implement:** trong `<p role="status">`, vẽ `{notice && <span key={notice.id}>{notice.text}</span>}` thay cho chuỗi trần (khoá theo lần bấm: phần tử con gắn lại mỗi lần nên trình đọc nghe lại).
- [ ] **Step 4: Run** cả file `pdp-extras.spec.tsx` → PASS (ca `live.textContent` hiện có vẫn xanh).
- [ ] **Step 5: Commit** `fix(web): vùng đọc chép mã ở sheet Ưu đãi đọc lại khi chép cùng mã hai lần (L2 g)`.

---

### Task 3: web thanh toán lg, lý do cạnh nút, lỗi thấy được, comment đúng (a, b-page, c, d)

**Files:**
- Modify: `apps/web/src/app/thanh-toan/page.tsx` (comment 803 và 806, khối `data-mini-part="place-order"`, lớp `accent-forest-600` ở ô "Thu kèm rác")
- Test: `apps/web/src/app/thanh-toan/checkout-lg-place.spec.tsx` (mới, dựng như `checkout-sticky.spec.tsx`), `apps/e2e/tests/web-checkout.web.spec.ts`

**Interfaces:** Consumes `checkoutPlaceHint`, `barNote`, `barError`, `placeDisabled` đã có trong `page.tsx`. Thêm trong khối place-order (chỉ từ lg, `hidden lg:block`): `<p role="status" data-testid="place-note-lg">` luôn có mặt, mang `barNote` (nhiều khi rỗng, khi đó `sr-only`) và `<p data-testid="place-error-lg" aria-hidden="true">` mang `barError` khi lỗi là loại đã có banner đầu trang (giá đổi, giỏ cần sửa) để lý do nằm cạnh nút mà không thêm `role="alert"` thứ hai; lỗi đặt đơn thường giữ khối `role="alert"` hiện có. Nút lg có `ref`; effect khi `place.isError`: `scrollIntoView({ block: 'nearest' })` trên khối place-order rồi `focus({ preventScroll: true })` lên nút.

- [ ] **Step 1: Write the failing tests** (`checkout-lg-place.spec.tsx`): (1) chưa có địa chỉ: trong khối place-order có `[data-testid="place-note-lg"]` `role="status"` với chữ `Chọn địa chỉ giao hàng để đặt hàng.`, nút Đặt hàng `disabled`; (2) báo giá lỗi (có địa chỉ): vùng ghi `fillCopy('checkout.quoteFailed')`; (3) đủ địa chỉ và báo giá: vùng có mặt nhưng trống (`sr-only`), không cạnh nút nào ghi lý do; (4) đặt đơn lỗi thường: `scrollIntoView` (mock `Element.prototype.scrollIntoView`) được gọi một lần và `document.activeElement` là nút Đặt hàng của khối place-order; bấm lần hai lỗi tiếp thì gọi lần hai; (5) lỗi `PRICE_CHANGED`: `[data-testid="place-error-lg"]` ghi `fillCopy('checkout.priceChangedHint')`, trong cả trang chỉ có đúng một `role="alert"` cho giá đổi (banner đầu trang), không có alert nào thêm trong khối place-order. Thêm test đọc nguồn: không còn các cụm `từ lg giữ ở khung tóm tắt dính bên phải` và `Con trực tiếp của khung cuộn` trong `page.tsx`.
- [ ] **Step 2: Run** `cd apps/web && npx vitest run src/app/thanh-toan/checkout-lg-place.spec.tsx` → FAIL.
- [ ] **Step 3: Implement** theo khối Interfaces. Viết lại hai comment: khung "Đơn hàng" không dính và không cuộn riêng; chỉ dải tổng + nút Đặt hàng dính đáy màn trong khung (`lg:sticky lg:bottom-0`), nút đứng ngay dưới lý do khoá và lỗi để khách thấy vì sao. Đổi `accent-forest-600` ở ô "Thu kèm rác" thành `accent-[color:var(--color-action-primary-bg)]`.
- [ ] **Step 4: Run** lệnh Step 2 + `checkout-sticky.spec.tsx`, `checkout-errors.spec.tsx`, `checkout-parity.spec.tsx`, `checkout-address-note.spec.tsx`, `checkout-waste.spec.tsx`, `total-changed.spec.tsx` → PASS (ca cũ đang `getByText` đúng một chữ thì đổi sang `within(...)` của thanh dính hoặc khối place-order).
- [ ] **Step 5: e2e web 1280** trong `web-checkout.web.spec.ts`: ca "1280: khách chưa có địa chỉ, nút Đặt hàng khoá và lý do hiện ngay cạnh nút": `api.get('/me/addresses', [])`, `setViewportSize 1280×800`, `goto('/thanh-toan')`, trong `[data-mini-part="place-order"]` có `getByRole('status')` chứa `Chọn địa chỉ giao hàng để đặt hàng.`, nút `^Đặt hàng` `toBeDisabled()`, và `toBeInViewport()` của dòng lý do. Chạy ở Task 7.
- [ ] **Step 6: Commit** `fix(web): thanh toán 1280 ghi lý do khoá ngay cạnh nút Đặt hàng, lỗi đặt đơn thấy được và nút nhận focus, sửa comment bố cục cũ (L2 a, b, c, d)`.

---

### Task 4: token ngữ nghĩa còn sót và bộ chặn bắt thêm tiền tố (b)

**Files:**
- Modify: `apps/web/src/app/thanh-toan/invoice-section.tsx` (dòng 36: `text-stone-900`; dòng 47: `text-stone-700`), `apps/web/src/components/catalog/filter-sidebar.tsx:150` và `apps/web/src/components/reorder/reorder-sheet.tsx:143` (mỗi nơi một `accent-forest-600`, là hai chỗ mới lọt vào luật mở rộng), `scripts/uiux/ds-shop-rules.mjs` (`WEB_PRIMITIVE`)
- Test: `apps/web/src/components/ds-shop-guard.spec.ts`, `packages/app-core/src/ds-ratchet.spec.ts` (nếu có ca đọc `WEB_PRIMITIVE`)

**Interfaces:** `WEB_PRIMITIVE` thêm tiền tố `accent`, `caret`, `shadow`, `ring-offset`, `border-{x,y,t,b,l,r,s,e}`; vẫn bắt `bg|text|border|ring|from|to|via|fill|stroke|divide|outline|decoration|placeholder`.

- [ ] **Step 1: Write the failing test:** trong `ds-shop-guard.spec.ts` thêm các dòng `it.each` cho `primitive-color` ở `app/thanh-toan/x.tsx`: `accent-forest-600`, `caret-clay-500`, `shadow-forest-200`, `ring-offset-stone-100`, `border-t-stone-200`, `hover:accent-forest-700`; dòng hợp lệ: `accent-[color:var(--color-action-primary-bg)]` và `text-[color:var(--color-text-primary)]` không bị bắt.
- [ ] **Step 2: Run** `cd apps/web && npx vitest run src/components/ds-shop-guard.spec.ts` → FAIL ở các dòng mới.
- [ ] **Step 3: Implement:** mở rộng regex; đổi `text-stone-900` thành `text-[color:var(--color-text-primary)]`, `text-stone-700` thành `text-[color:var(--color-text-secondary)]`; hai `accent-forest-600` còn lại thành `accent-[color:var(--color-action-primary-bg)]`.
- [ ] **Step 4: Run** `ds-shop-guard.spec.ts`, `a11y-input-labels.spec.ts`, spec của hai component đổi (`filter-sidebar`, `reorder-sheet`, `checkout-parity`) và `cd ../.. && node scripts/uiux/ds-ratchet.mjs` → PASS, baseline `guards.web` không tăng (hạ được `app/thanh-toan/invoice-section.tsx` từ 2 về 0: `node scripts/uiux/ds-ratchet.mjs --write`).
- [ ] **Step 5: Commit** `fix(web): thanh toán dùng token ngữ nghĩa, bộ chặn primitive bắt cả accent-, caret-, shadow-, ring-offset-, border-{t,b,…} (L2 b)`.

---

### Task 5: xoá `coupon-card` chết (i)

**Files:**
- Delete: `apps/miniapp/src/components/loyalty/coupon-card.tsx`, `apps/miniapp/src/components/loyalty/coupon-card.spec.tsx`
- Modify: `packages/app-core/src/terminology.spec.ts` (đúng dòng 219: miễn `coupon-card.tsx`), `scripts/uiux/ds-baseline.json` (qua `ds-ratchet --write`), `apps/miniapp/src/ds-primitive-refs.spec.ts` và `packages/app-core/src/commerce/voucher.ts` (chỉ comment nhắc file đã xoá)

- [ ] **Step 1: Xác nhận không ai import:** `grep -rn "coupon-card\|CouponCard" apps packages docs/design DESIGN.md --include='*.ts' --include='*.tsx' --include='*.json' --include='*.md'` chỉ còn comment và chính spec của nó. Ghi kết quả vào commit message.
- [ ] **Step 2: Run** `cd packages/app-core && npx vitest run src/terminology.spec.ts` → PASS trước khi xoá; sau khi gỡ dòng miễn mà file còn → FAIL (trần ép đúng số, bắt "HSD" trong `coupon-card.tsx`).
- [ ] **Step 3: Implement:** xoá hai file, gỡ dòng 219, sửa hai comment, `node scripts/uiux/ds-ratchet.mjs --write`.
- [ ] **Step 4: Run** `terminology.spec.ts`, `cd ../../apps/miniapp && npx vitest run src/ds-primitive-refs.spec.ts src/components/ds-shop-guard.spec.ts`, `pnpm lint:parity` → PASS.
- [ ] **Step 5: Commit** `chore(miniapp): xoá coupon-card không ai dùng (còn "HSD") và dòng miễn của nó (L2 i)`.

---

### Task 6: lớp phủ Next dev "1 Issue" ở /thanh-toan 1280 (e)

**Files:** không có nếu lỗi không thuộc mã shop; nếu thuộc thì `apps/web/src/app/thanh-toan/page.tsx` (hoặc nơi lỗi chỉ ra) kèm test đỏ trước.

- [ ] **Step 1:** dựng API giả (`/api/health` 200, `/api/products` `{data:[],meta}`), chạy `next dev` cổng 3542; mở `/thanh-toan` 1280×800 với phiên giả và `/me/addresses` rỗng (mock phía trình duyệt như `mockBuyer`), ghi `console` và `pageerror` của Playwright, đọc nội dung lớp phủ Next (`nextjs-portal`).
- [ ] **Step 2:** nếu là lỗi hydration hoặc React của mã shop: viết test vitest tái hiện, sửa, chạy lại. Nếu do mock/dev (ví dụ yêu cầu chưa mock) hoặc mã ngoài gói: ghi nguồn vào notes.
- [ ] **Step 3: Commit** chỉ khi có sửa: `fix(web): <lỗi cụ thể> ở /thanh-toan (L2 e)`.

---

### Task 7: e2e đầy đủ và ba ca a11y đối chiếu base (j)

- [ ] **Step 1:** `E2E_API_PORT=3542 E2E_WEB_PORT=3543 E2E_MINIAPP_PORT=3544 bash apps/e2e/scripts/web-gate.sh tests/web-checkout.web.spec.ts tests/a11y-shop.web.spec.ts tests/ds-parity.shop.spec.ts --workers=2 --reporter=line` (từ worktree), ghi số passed/failed.
- [ ] **Step 2:** ca nào đỏ: chạy lại đúng ca đó ở base `07818cc2b` (`git worktree add` vào scratchpad, `pnpm install --offline --frozen-lockfile`, build shared-types, `prisma generate`, dọn sau). Đỏ do gói shop thì sửa (test đỏ trước); đỏ có sẵn thì ghi lỗi axe cụ thể (id luật, selector) vào notes.
- [ ] **Step 3:** Mini: `cd apps/e2e && E2E_SCOPE=miniapp E2E_MINIAPP_PORT=3541 npx playwright test tests/checkout*.ts tests/voucher*.ts --workers=2 --reporter=line`.
- [ ] **Step 4: Commit** các sửa nếu có.

---

### Task 8: ảnh, bánh cóc, gate

- [ ] **Step 1:** chụp (ẩn huy hiệu Next dev) vào `docs/2026-10-31-shop-redesign/screens/L2/`: sheet Ưu đãi PDP mini375 và web375; thanh toán web1280 thiếu địa chỉ và đầy đủ; web375 thanh toán. So hai bản 375 với nhau, tắt server của mình khi xong.
- [ ] **Step 2:** `pnpm lint:parity && pnpm lint:vars`; hạ baseline nếu giảm (`node scripts/uiux/ds-ratchet.mjs --write`), commit.
- [ ] **Step 3:** `bash docs/2026-10-28-review/tools/gate.sh <worktree> --base 4e95a0055 --out /Users/longla/coding/tubutree-mini-app/.claude/worktrees/gate-L2.txt` một lần; bước FAIL kiểm trên base. Rồi e2e Mini đầy đủ: `cd apps/e2e && E2E_SCOPE=miniapp E2E_MINIAPP_PORT=3541 npx playwright test --workers=2 --reporter=line`.
- [ ] **Step 4:** thêm mục "L2" vào `PROGRESS.md` và commit.

## Self-Review

- (a) Task 3; (b) Task 3 (page.tsx) và Task 4 (invoice-section, bộ chặn); (c) Task 3 Step 1 (1)(2) + e2e; (d) Task 3 (4)(5); (e) Task 6; (f) Task 1; (g) Task 2; (h) Task 1; (i) Task 5; (j) Task 7; (k) Task 8.
- Tên dùng chung: khoá `coupon.minOrderBase`, `coupon.zeroDiscount`; `data-testid` `place-note-lg`, `place-error-lg`; `OfferRow.group` khớp giữa Task 1 và các spec.
- Chọn thay chủ: ở lg khung tóm tắt không dính (K2 đã bỏ cột dính); chỉ dải tổng và nút Đặt hàng dính đáy màn trong khung. "Chưa đủ" giữ nhóm `short` khi máy chủ đòi đơn tối thiểu mà tạm tính đã đạt, vì khách mua thêm hàng thường thì dùng được.
