# L3 `minors-k4-k7` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sửa các MINOR reviewer để lại ở K4 (chữ), K5 (giỏ combo), K6 (CTV tier), K7 (sheet web), đã gộp ở nhánh tích hợp `shop/2026-10-31-redesign` (base `32a2898b5`).

**Architecture:** Không thêm màn. Logic mới nằm ở `packages/app-core` (hai hàm thuần `comboSavingPending`, `ownerTierPending`) để hai app dùng cùng luật; chữ API sửa tại nguồn; một token ngữ nghĩa mới `--color-bg-sheet-scrim` cho nền hai sheet web và `--zaui-mask-overlay-color` của hai app.

**Tech Stack:** TypeScript, vitest + jsdom (app-core, Mini, web), jest (API), Playwright, TanStack Query v5, Tailwind 3.

**Spec:** `docs/2026-10-31-shop-redesign/01-thiet-ke.md` (§4 là luật: Q5 thuật ngữ, Q16). Kế hoạch gốc: `plans/K4-copy-terms.md`, `K5-cart-combo.md`, `K6-ctv-tier.md`, `K7-sheet-desktop.md`; bàn giao `plans/handoff-wave6.md`.

## Global Constraints

- Node: `export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH` cho mọi lệnh. Worktree mới: `pnpm install --frozen-lockfile --offline`, `pnpm --filter @tubutree/shared-types build`, `npx prisma generate` (trong `apps/api`) trước gate.
- Chữ giao diện tiếng Việt, theo `01-thiet-ke.md` §4 Q5: "Miễn phí giao hàng", "Thương hiệu", "Giờ vàng" (hoa chữ G); không "Nhãn hàng", "Freeship", "Vui lòng", "HSD", "HOT". Câu lỗi nói "bạn", không "vui lòng".
- Token ngữ nghĩa ở trang mua sắm (không `bg-stone-*`, `divide-stone-*`); `pnpm lint:parity` và `pnpm lint:vars` xanh; hạ được baseline thì `node scripts/uiux/ds-ratchet.mjs --write` rồi commit.
- Web khổ điện thoại giống Mini App cả giao diện: sửa Mini thì web sửa y hệt, và ngược lại.
- KHÔNG đụng: `flash-sale.tsx` hai app, `flash-boot-script.ts`, `home-layout.ts`, `home-initial.ts`, `app/page.tsx`; nút "Chuyển vào Ví" (R-185) ở `affiliate.tsx`, `ctv/page.tsx`; file gói L1 (`flash-line.ts`, `add-to-cart.tsx`, `product-detail.tsx`, `variation-sheet`, `variation-chip.tsx`, `pdp-bundles` web) và L2 (`thanh-toan/page.tsx`, `invoice-section.tsx`, `voucher-picker.ts`, `pdp-extras.tsx`, `coupon-card.tsx`). File của L1/L2 mà bộ quét mới bắt: thêm dòng `EXEMPT` tạm, lý do "gói L1/L2 đang sửa, gỡ khi gộp".
- Không push, không deploy, không đọc/ghi PROD, không `git stash` trần. Comment chỉ giải thích "vì sao", tiếng Việt, theo mật độ file xung quanh.
- Máy thiếu RAM: chạy test theo file khi làm; gate đầy đủ đúng một lần ở cuối; e2e `--workers=2`.

## Review Focus

1. Khách chọn một phần giỏ, máy chủ chưa trả giá (debounce, đang tải, refetch sau +/−, `getCartSelection` lỗi): đầu nhóm combo không ghi số của cả giỏ, chỗ của số vẫn giữ (không đổi số dòng), tên đọc của khối không có số. Test: Task 5.
2. Mất mạng khi gian hàng đã có trong cache: trình dựng (Mini và web) dựng đủ, không huy hiệu bậc, không khung chờ vô hạn. Test: Task 8.
3. Gian hàng đã duyệt (`approved`): đầu xem trước ở trình dựng có dấu tích và huy hiệu "CTV tuyển chọn" y như trang khách; chưa duyệt thì không. Test: Task 7.
4. Đoạn giữa/cuối của chuỗi template có chữ cấm viết hoa (`${code} · HSD ${d}`, `${n} HOT`) bị bắt; mã định danh (`FREESHIP-${id}`, `GET ${path}`) không bị coi là chữ khách đọc. Test: Task 1.
5. `prefers-reduced-motion: no-preference`: sheet web thực sự có animation đang chạy (không chỉ có tên trong computed style). Test: Task 9.

---

## File Structure

| Việc | File |
|---|---|
| (a)(d) bộ quét thuật ngữ | `packages/app-core/src/terminology.spec.ts`, `DESIGN.md` |
| (b) | `apps/api/src/modules/storefront/identifier-validation.ts` (+ `.spec.ts`) |
| (c) | `apps/api/src/modules/coupons/coupon-notice.ts` (+ `.spec.ts`), `apps/api/src/modules/checkout/checkout.service.spec.ts` |
| (e) | `apps/api/src/modules/flash-sale/flash-sale.service.ts` (+ `.spec.ts`) |
| (f) | `packages/app-core/src/commerce/cart-combo.ts` (+ spec), `apps/miniapp/src/pages/cart.tsx`, `apps/web/src/app/gio-hang/page.tsx` (+ hai spec) |
| (g) | `apps/web/src/components/cart-combo-block.tsx`, `scripts/uiux/ds-shop-rules.mjs`, `scripts/uiux/ds-baseline.json` |
| (h)(j) | `apps/miniapp/src/utils/storefront-badge.ts` (mới), `pages/storefront-view.tsx`, `pages/storefront-builder.tsx`, `apps/web/src/components/affiliate/storefront-builder.tsx` (+ spec) |
| (i) | `packages/app-core/src/commerce/shop-page.ts` (+ spec), `pages/storefront-builder.tsx`, `apps/web/src/app/ctv/gian-hang/page.tsx` (+ spec) |
| (k) | `apps/e2e/tests/sheet-desktop.web.spec.ts` |
| (l) | `packages/design-tokens/src/tokens.css`, `tailwind-preset.ts` (+ hai spec), `apps/web/src/components/mini/mini.css`, `apps/miniapp/src/css/zaui-bridge.css`, `apps/web/src/components/ui/sheet.tsx` (+ spec) |

---

### Task 1: Bộ quét thuật ngữ xét mọi đoạn template (a)

**Files:**
- Modify: `packages/app-core/src/terminology.spec.ts` (hằng `ASCII_PROSE`, nhánh template của `displayStrings`, `EXEMPT`)
- Sửa chữ ở file thật mà bộ quét mới bắt.

**Interfaces:**
- Consumes: `displayStrings(source, fileName)`, `findHits(sources)` (trong spec, không export).
- Produces: hằng `TEMPLATE_TAIL_PROSE` dùng cho `ts.isTemplateMiddle` / `ts.isTemplateTail`: đoạn đứng sau một biểu thức nên chữ hoa viết tắt không còn ở đầu chuỗi.

- [ ] **Step 1: Viết ca đỏ** trong `describe('displayStrings')` (`bắt`) và `describe('findHits: chuỗi template...')`:
  - `` const label = `${code} · HSD ${d}`; `` → `texts` chứa `'· HSD'`; `` `${n} HOT` `` → chứa `'HOT'`; `` `${a} Freeship` `` → chứa `'Freeship'`.
  - `findHits` ``export const t = (c: string, d: string) => `${c} · HSD ${d}`;`` ra `['Hạn dùng hoặc Dùng đến']`.
  - Đối chứng: `` `FREESHIP-${id}-x` ``, `` `${a}/voucher/${b}` ``, `` `${a} GET ${b}` `` không ra hit (không có chữ cấm).
- [ ] **Step 2: Chạy đỏ.** `cd packages/app-core && npx vitest run src/terminology.spec.ts` → FAIL ở các ca mới.
- [ ] **Step 3: Sửa `displayStrings`:** thêm `TEMPLATE_TAIL_PROSE = /(?:^|[^A-Za-z0-9_-])(?:[A-Z][a-z]|[A-Z]{2,}(?:[ :]|$))/` và điều kiện `(ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) && TEMPLATE_TAIL_PROSE.test(n.text)` bên cạnh `ASCII_PROSE.test(n.text)`. Cập nhật comment `ASCII_PROSE` nói đúng phạm vi (đầu chuỗi) và chỉ sang hằng mới.
- [ ] **Step 4: Chạy cả spec trên cây thật.** Mỗi hit mới ngoài `EXEMPT`: sửa chữ tại chỗ ("Hạn dùng", bỏ "HOT"...); nếu file thuộc L1/L2 thì thêm dòng `EXEMPT` với `reason: 'gói L1/L2 đang sửa, gỡ khi gộp'`. Kết quả mong đợi: PASS.
- [ ] **Step 5: Commit** `test(app-core): terminology.spec xét cả đoạn giữa/cuối chuỗi template (K4 MINOR)`.

---

### Task 2: Câu lỗi tên gian hàng trùng thương hiệu (b)

**Files:**
- Modify: `apps/api/src/modules/storefront/identifier-validation.ts:88`
- Test: `apps/api/src/modules/storefront/identifier-validation.spec.ts:100-103`

- [ ] **Step 1: Sửa ca đã có** để đòi câu mới: `rejects.toThrow('"lamy" trùng tên một thương hiệu của Tubu Tree. Bạn chọn tên khác nhé.')` (và tên ca nói "thương hiệu").
- [ ] **Step 2:** `cd apps/api && npx jest src/modules/storefront/identifier-validation.spec.ts` → FAIL.
- [ ] **Step 3:** Đổi chuỗi ở dòng 88 thành `` `"${value}" trùng tên một thương hiệu của Tubu Tree. Bạn chọn tên khác nhé.` ``; comment dòng 79 "Tên nhãn hàng" → "Tên thương hiệu".
- [ ] **Step 4:** chạy lại → PASS.
- [ ] **Step 5: Commit** `fix(api): câu lỗi tên gian hàng trùng thương hiệu đúng thuật ngữ, bỏ "vui lòng" (K4 MINOR)`.

---

### Task 3: Một tên cho mã miễn phí giao (c)

**Files:**
- Modify: `apps/api/src/modules/coupons/coupon-notice.ts` (dòng 7-12, 15, 19, 28)
- Test: `apps/api/src/modules/coupons/coupon-notice.spec.ts`, `apps/api/src/modules/checkout/checkout.service.spec.ts` (dòng 2133, 2175-2176, 2225, 2277)

**Interfaces:**
- Consumes: `SHOP_COPY['coupon.freeship'] = 'Miễn phí giao hàng'` (nhãn chip của app). Giữa câu viết thường: "mã miễn phí giao hàng".
- Produces: bốn hằng/hàm giữ nguyên tên (`COUPON_FREESHIP_NOTHING_REASON`, `COUPON_FREESHIP_FIRST_ORDER_REASON`, `COUPON_FREESHIP_ALREADY_FREE_REASON`, `couponFreeshipThresholdReason`, `couponFreeshipTubuPartReason`), chỉ đổi chữ.

- [ ] **Step 1: Sửa kỳ vọng** (spec đỏ), chữ chuẩn:
  - NOTHING: `Mã miễn phí giao hàng chỉ áp cho phí giao của hàng Tubu Tree giao, và đơn này không có phí giao đó.`
  - FIRST_ORDER: `Đơn đầu đã được miễn phí giao, mã miễn phí giao hàng được giữ cho đơn sau.`; ALREADY_FREE và threshold tương tự (`... mã miễn phí giao hàng được giữ cho đơn sau.`).
  - TubuPart: `Phần hàng Tubu Tree giao đã được miễn phí giao{detail}, mã miễn phí giao hàng chỉ áp cho hàng Tubu Tree nên được giữ cho đơn sau.` (hết lặp "miễn phí giao hàng Tubu Tree"); trong `checkout.service.spec.ts` biến `TAIL` đổi theo.
  - Thêm một ca trong `coupon-notice.spec.ts`: mọi câu trên chứa "mã miễn phí giao hàng" và không chứa "mã miễn phí giao " theo sau bởi dấu phẩy/chấm hay "vận chuyển".
- [ ] **Step 2:** `cd apps/api && npx jest src/modules/coupons/coupon-notice.spec.ts src/modules/checkout/checkout.service.spec.ts -t "freeship|miễn phí giao|coupon-notice"` → FAIL.
- [ ] **Step 3:** Đổi chữ trong `coupon-notice.ts` (cả comment dòng 7, 11 gọi đúng tên "mã miễn phí giao hàng").
- [ ] **Step 4:** chạy lại hai spec đầy đủ → PASS; `terminology.spec` vẫn xanh (không còn "vận chuyển"/"freeship" trong chữ).
- [ ] **Step 5: Commit** `fix(api): ba tên của mã miễn phí giao thành "mã miễn phí giao hàng" như chip của app (K4 MINOR)`.

---

### Task 4: Phạm vi quét API ghi đúng, `setReminder` đúng thuật ngữ (d)(e)

**Files:**
- Modify: `DESIGN.md:192`, comment đầu `API_COPY_FILE` ở `terminology.spec.ts:16`, `apps/api/src/modules/flash-sale/flash-sale.service.ts:828`
- Test: `apps/api/src/modules/flash-sale/flash-sale.service.spec.ts` (ca `setReminder`), `terminology.spec.ts` (nếu quét được file)

- [ ] **Step 1 (docs):** DESIGN.md và comment ghi phạm vi thật của `API_COPY_FILE`: `*-notice.ts`, `*-notice.service.ts`, `*-price.ts`, `*-price.service.ts` trong `apps/api/src/modules` cộng `cart/cart.batch-error.ts` (`API_COPY_EXTRA`).
- [ ] **Step 2 (đỏ):** ca mới trong `flash-sale.service.spec.ts`: `setReminder` với item không có/biến thể ngưng bán → `rejects.toThrow('Không tìm thấy sản phẩm Giờ vàng.')`. Chạy `npx jest src/modules/flash-sale/flash-sale.service.spec.ts -t setReminder` → FAIL.
- [ ] **Step 3:** đổi chuỗi dòng 828 thành `Không tìm thấy sản phẩm Giờ vàng.` (hai chỗ quản trị ở dòng 774, 786 giữ nguyên: chữ của admin, có bảng chữ riêng).
- [ ] **Step 4:** thử đưa `flash-sale/flash-sale.service.ts` vào `API_COPY_EXTRA`; nếu bộ quét bắt thêm chữ quản trị ("đơn giờ vàng", "đợt flash" ở `removeItem`...) thì KHÔNG thêm, ghi vào notes. Chạy `terminology.spec` + spec flash-sale → PASS.
- [ ] **Step 5: Commit** `fix(api): "Không tìm thấy sản phẩm Giờ vàng" ở nút Nhắc tôi; ghi đúng phạm vi bộ quét API (K4 MINOR)`.

---

### Task 5: Đầu nhóm combo ẩn số khi chưa có giá phần chọn (f)

**Files:**
- Modify: `packages/app-core/src/commerce/cart-combo.ts`, `apps/miniapp/src/pages/cart.tsx:294`, `apps/web/src/app/gio-hang/page.tsx:448`
- Test: `packages/app-core/src/commerce/cart-combo.spec.ts`, `apps/miniapp/src/pages/cart.spec.tsx` (describe "chọn một phần giỏ"), `apps/web/src/app/gio-hang/page.spec.tsx`

**Interfaces:**
- Produces: `export function comboSavingPending(i: { editing?: boolean; partial: boolean; priced: boolean }): boolean` = `!!i.editing || (i.partial && !i.priced)`. `cartComboBlocks` giữ chữ ký; nơi gọi truyền kết quả vào tham số `pending` đã có.
- Consumes: `subsetSig` (`!== null` = chọn một phần), `priced` (kết quả `getCartSelection` đúng phần đang chọn, null khi debounce/đang tải/lỗi).

- [ ] **Step 1: Test app-core đỏ:** `comboSavingPending({partial:false,priced:false})===false`; `({partial:true,priced:false})===true`; `({partial:true,priced:true})===false`; `({editing:true,partial:false,priced:true})===true`.
- [ ] **Step 2: Test Mini đỏ** (giỏ `comboCart({ comboGroups: [{...GROUP, keyLineIds: ['ci-ok']}] })`, bỏ chọn "Dầu gội"): (1) ngay sau bấm, `cart-combo-saving` có `aria-hidden="true"`, `visibility: hidden`, tên khối `toHaveAccessibleName('Combo: Bộ giặt sạch')`; (2) `getCartSelection` trả `reject` → sau 2 giây số vẫn ẩn (không quay về số cả giỏ); (3) trả về nhóm giảm 6.000đ → số hiện `6.000đ`, không còn `aria-hidden`; (4) chọn lại cả giỏ → số 15.000đ hiện, không gọi `getCartSelection`. Web: cùng bốn ca với `state.selection`.
- [ ] **Step 3:** chạy ba file → FAIL.
- [ ] **Step 4:** thêm `comboSavingPending` (kèm comment vì sao: số đầu nhóm là số của cả giỏ, chỉ đúng khi chọn cả giỏ); Mini truyền `comboSavingPending({ editing: summary.comboPending, partial: subsetSig !== null, priced: priced !== null })`; web truyền `comboSavingPending({ partial: subsetSig !== null, priced: priced !== null })`.
- [ ] **Step 5:** chạy ba file đầy đủ + `apps/web/src/app/gio-hang/cart-parity.spec.tsx` → PASS.
- [ ] **Step 6: Commit** `fix(cart): đầu nhóm combo ẩn số khi chọn một phần giỏ mà máy chủ chưa trả giá phần đó (K5 MINOR)`.

---

### Task 6: `cart-combo-block` dùng token ngữ nghĩa; guard phủ thêm thành phần shop (g)

**Files:**
- Modify: `apps/web/src/components/cart-combo-block.tsx` (`md:divide-stone-200`), `scripts/uiux/ds-shop-rules.mjs` (`WEB_SHOP`, `MINI_SHOP`), `scripts/uiux/ds-baseline.json`
- Test: `apps/web/src/ds-shop-guard.spec.ts` (đã gọi `guardViolations`), `packages/app-core/src/ds-ratchet.spec.ts`

- [ ] **Step 1 (đỏ):** thêm `cart-combo-block|coupon-box|variation-chip|pdp-selection|pdp-stock` vào dòng `components/(flash-price|add-to-cart|variation-sheet)\.tsx` của `WEB_SHOP`; chạy `npx vitest run src/ds-shop-guard.spec.ts` (apps/web) → FAIL: `primitive-color: components/cart-combo-block.tsx: 1 chỗ, baseline 0`.
- [ ] **Step 2:** đổi `md:divide-stone-200` thành `md:divide-[color:var(--color-border-subtle)]` (= stone-200, cùng màu). Thêm `cart-combo-block` vào `MINI_SHOP` nếu guard Mini vẫn xanh.
- [ ] **Step 3:** guard hai app + `ds-ratchet.spec` → PASS; file L1/L2 (`add-to-cart`, `variation-sheet` đã ở sẵn trong phạm vi) không đổi. `sticky-action-bar.tsx` (2 chỗ primitive) và các thành phần khác không thêm: ghi notes. `node scripts/uiux/ds-ratchet.mjs --write` nếu notice yêu cầu.
- [ ] **Step 4: Commit** `fix(web): cart-combo-block dùng token đường kẻ; ds-shop-guard phủ thêm thành phần shop ở gốc components (K5 MINOR)`.

---

### Task 7: Đầu xem trước ở trình dựng có dấu tích và huy hiệu "CTV tuyển chọn"; nút "Thêm ảnh bìa" không có div trong button (h)(j)

**Files:**
- Create: `apps/miniapp/src/utils/storefront-badge.ts`
- Modify: `apps/miniapp/src/pages/storefront-view.tsx:32-38` (import thay hàm cục bộ), `apps/miniapp/src/pages/storefront-builder.tsx:633, 654`, `apps/web/src/components/affiliate/storefront-builder.tsx:506`
- Test: `apps/miniapp/src/pages/storefront-builder.spec.tsx` (describe "Đầu xem trước như khách thấy (K6)"), `apps/web/src/components/affiliate/storefront-builder.spec.tsx` (hoặc spec trang `ctv/gian-hang/page.spec.tsx` nơi đã có ca K6), `apps/miniapp/src/utils/storefront-badge.spec.ts`

**Interfaces:**
- Produces: `trustBadgeLabel(sf: { type: 'CTV' | 'BRAND' | 'MERCHANT'; approved?: boolean }): string | null` (chuyển nguyên từ `storefront-view.tsx`). Web dùng sẵn `storefrontBadgeLabel` (`@/lib/storefront-badge`).
- Cả hai trình dựng truyền `verified={Boolean(label)}` và `badges` gồm `<Badge tone="verified">` có `Sparkles` + nhãn rồi `TierBadge`, đúng thứ tự trang khách (`storefront-view.tsx:124-146`, `storefront-body.tsx:102-118`).

- [ ] **Step 1: Test đỏ.** Mini và web: `storefront({ approved: true })` → có chữ "CTV tuyển chọn" ở đầu xem trước và `CheckCircle2` có `aria-label="Đã được Tubu Tree duyệt"`; `approved: false`/vắng → không có cả hai; `approved: true` + bậc 2 → cả hai huy hiệu, "CTV tuyển chọn" đứng trước "CTV Đồng". Mini thêm: nút "Thêm ảnh bìa" không chứa phần tử `div` (`button.querySelector('div')` là null) và vẫn `display:block` cho chữ.
- [ ] **Step 2:** chạy hai spec → FAIL.
- [ ] **Step 3:** tạo `utils/storefront-badge.ts`; `storefront-view.tsx` import từ đó; hai trình dựng truyền `verified` + `badges`; nút "Thêm ảnh bìa" Mini đổi `<Text ... as="div">` thành `as="span"` kèm `style={{ display: 'block' }}` để hình giữ nguyên.
- [ ] **Step 4:** chạy hai spec đầy đủ + `storefront-view.spec.tsx` → PASS.
- [ ] **Step 5: Commit** `fix(storefront): đầu xem trước ở trình dựng có dấu tích và huy hiệu CTV tuyển chọn như trang khách; nút Thêm ảnh bìa dùng span (K6 MINOR)`.

---

### Task 8: Mất mạng không giữ khung chờ vô hạn ở trình dựng (i)

**Files:**
- Modify: `packages/app-core/src/commerce/shop-page.ts` (cạnh `ownerTierPreview`), `apps/miniapp/src/pages/storefront-builder.tsx:101`, `apps/web/src/app/ctv/gian-hang/page.tsx` (cổng `tiersQ.isPending`)
- Test: `packages/app-core/src/commerce/shop-page.spec.ts`, `storefront-builder.spec.tsx`, `apps/web/src/app/ctv/gian-hang/page.spec.tsx`

**Interfaces:**
- Produces: `export function ownerTierPending(q: { isPending: boolean; fetchStatus: 'fetching' | 'paused' | 'idle' }): boolean` = `q.isPending && q.fetchStatus !== 'paused'`. TanStack v5 giữ `status: 'pending'` khi mất mạng (`fetchStatus: 'paused'`), nên "paused" coi như xong: dựng không huy hiệu.

- [ ] **Step 1: Test đỏ.** app-core: `{isPending:true,fetchStatus:'fetching'}`→true; `'paused'`→false; `{isPending:false,...}`→false. Hai app: `QueryClient` có sẵn gian hàng CTV trong cache (`setQueryData`), `onlineManager.setOnline(false)` trước khi render → trình dựng (`shop-cover`) hiện, `getCtvTiers`/`/affiliate/tiers` chưa gọi, không có huy hiệu `/^CTV /`; `setOnline(true)` ở `afterEach`.
- [ ] **Step 2:** chạy → FAIL (khung chờ mãi).
- [ ] **Step 3:** thêm hàm; hai trang thay `tiersQ.isPending` bằng `ownerTierPending(tiersQ)`.
- [ ] **Step 4:** chạy ba spec đầy đủ → PASS (các ca "đang chờ bậc", "bậc về muộn" cũ vẫn xanh).
- [ ] **Step 5: Commit** `fix(storefront): trình dựng coi bậc ở trạng thái paused (mất mạng) như đã xong, không treo khung chờ (K6 MINOR)`.

---

### Task 9: e2e sheet kiểm animation thật (k)

**Files:**
- Modify: `apps/e2e/tests/sheet-desktop.web.spec.ts` (ca "hộp và nền mở bằng fade/scale")

- [ ] **Step 1:** thêm hàm `runningAnimations(dialog)`: `dialog.evaluate((el) => el.getAnimations({ subtree: true }).map((a) => (a as CSSAnimation).animationName))` (hộp và nền cùng `parentElement`) và hàm `hasKeyframes(page, names)` đọc CSSOM: duyệt `document.styleSheets`, `CSSKeyframesRule.name`.
- [ ] **Step 2:** ca no-preference: ngoài `animationNames` còn khẳng định `hasKeyframes(['tubu-dialog-pop','tubu-dialog-fade'])` đủ và, ngay sau khi mở, `runningAnimations` chứa cả hai tên (cho cả hai sheet). Ca reduce giữ `getAnimations().length === 0`.
- [ ] **Step 3:** `tsc` của `apps/e2e` xanh; chạy qua `web-gate.sh` nếu máy cho phép (cần API thật), không thì ghi notes.
- [ ] **Step 4: Commit** `test(e2e): sheet web kiểm animation đang chạy và @keyframes tồn tại, không chỉ animationName (K7 MINOR)`.

---

### Task 10: Một token nền cho hai sheet web, theo Mini App (l)

**Files:**
- Modify: `packages/design-tokens/src/tokens.css` (token mới + sửa comment `--color-bg-scrim`), `packages/design-tokens/src/tailwind-preset.ts`, `apps/web/src/components/mini/mini.css:50`, `apps/miniapp/src/css/zaui-bridge.css`, `apps/web/src/components/ui/sheet.tsx:103`
- Test: `packages/design-tokens/src/tokens.spec.ts` (cặp `['--color-bg-sheet-scrim', 'rgba(0, 0, 0, 0.7)']`), `tailwind-preset.spec.ts` (`colors['sheet-scrim']`), `apps/web/src/components/ui/sheet.spec.tsx` (backdrop có lớp `bg-sheet-scrim`, không `bg-stone-900/50`), `apps/web/src/components/mini/css.spec.ts` (`--zaui-mask-overlay-color: var(--color-bg-sheet-scrim)`)

**Interfaces:**
- Produces: `--color-bg-sheet-scrim: rgba(0, 0, 0, 0.7)` (= `#000000b3`, mặc định `--zaui-mask-overlay-color` của zmp-ui nên Mini App thật giữ nguyên màu); Tailwind `bg-sheet-scrim`.

- [ ] **Step 1: Test đỏ** (bốn ca ở trên). Chạy `pnpm --filter @tubutree/design-tokens test` và vitest hai file web → FAIL.
- [ ] **Step 2:** thêm token vào `tokens.css`; `--color-bg-scrim` giữ nguyên giá trị, sửa comment: dành cho khung cắt ảnh và lớp phủ ảnh ở Mini, còn nền sheet/hộp thoại là `--color-bg-sheet-scrim`. Preset thêm `'sheet-scrim': 'var(--color-bg-sheet-scrim)'`. `mini.css` và `zaui-bridge.css` đặt `--zaui-mask-overlay-color: var(--color-bg-sheet-scrim)`. `ui/sheet.tsx` đổi `bg-stone-900/50` thành `bg-sheet-scrim`.
- [ ] **Step 3:** chạy các spec + `pnpm lint:vars` + `pnpm lint:parity` → PASS.
- [ ] **Step 4:** chụp trước/sau hai sheet ở 375 và 1280 (web) vào `docs/2026-10-31-shop-redesign/screens/L3/`: trước = ảnh chụp ở commit trước Task 10 (`K7_LABEL=before`), sau = `K7_LABEL=after`, qua `K7_SHOTS_DIR` của `sheet-desktop.web.spec.ts`; đo màu nền bằng `getComputedStyle` của `[data-sheet-backdrop]` cả hai sheet cùng `rgba(0, 0, 0, 0.7)`.
- [ ] **Step 5: Commit** `fix(design): một token nền cho cả hai sheet web, theo màu zmp-ui của Mini App (K7 MINOR)`.

---

### Task 11: Gate cuối và ảnh so

- [ ] Chụp 375px Mini và web cho: giỏ combo chọn một phần (số ẩn), đầu xem trước trình dựng có huy hiệu duyệt, hai sheet; lưu `docs/2026-10-31-shop-redesign/screens/L3/`; tắt server của mình.
- [ ] `bash docs/2026-10-28-review/tools/gate.sh <worktree> --base 32a2898b5 --out <gate-L3.txt>`; bước FAIL thì so với base: có sẵn thì ghi, do gói thì sửa.
- [ ] e2e Mini đầy đủ: `cd apps/e2e && E2E_SCOPE=miniapp E2E_MINIAPP_PORT=3551 npx playwright test --workers=2 --reporter=line`.
