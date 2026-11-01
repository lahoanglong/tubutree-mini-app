# G2 `cart-display` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dọn nốt MINOR của F10b và bốn P2 về giỏ (`review/final-critique.md` P2 số 12–15) ở hiển thị giỏ Mini App và web: một nguồn giá gạch cho thẻ, chân dính giỏ 320px, `scroll-padding` theo chiều cao chân thật, "Tiết kiệm" cộng cả combo và một màu deal, một nhãn cho số tạm tính đã giảm, nút "−" web khoá ở số lượng 1, ô chọn Mini cột 24 + khoảng 12.

**Architecture:** Đường tiền KHÔNG đổi: không đụng `unitPrice`, `total`, `subtotal`, `discount`, `comboDiscount`, `tierDiscount`, báo giá, đặt đơn; mọi số mới chỉ là số hiển thị suy ra từ số đã có. `cardPricing` lấy `compareAt` từ `strikePrice` (shared-types) như `variationPricing` và API giỏ. "Tiết kiệm" của giỏ = giá gạch (`cartSaving`) + giảm combo đang hiển thị. Nhãn tạm tính vào `SHOP_COPY` (app-core) để hai app đọc cùng một chữ. Chân dính cho dòng cuối cùng xuống hàng có chủ đích bằng flex-wrap thay vì cắt hoặc tràn.

**Tech Stack:** pnpm + turbo, React 18 + zmp-ui + Vite (Mini), Next 15 + Tailwind (web), vitest, Playwright.

**Spec:** `docs/2026-10-31-shop-redesign/01-thiet-ke.md` (§4 Q1, Q2), `docs/2026-10-31-shop-redesign/02-ke-hoach.md` (Global Constraints, Review Focus), `review/final-critique.md` P2 #12–#15, `review/polish.md` PL-19, MINOR `[F10b]` ở `scratchpad/f10-minors.txt`, `plans/F10b-cart-pages.md` (chân dính, `--sticky-bar-h`).

## Global Constraints

- Node: `export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH`; worktree mới: `pnpm install --frozen-lockfile --offline`, `pnpm --filter @tubutree/shared-types build`, `cd apps/api && npx prisma generate` trước gate.
- ĐƯỜNG TIỀN CHỈ Ở HIỂN THỊ: số khách trả (tạm tính, giảm, phí, tổng, báo giá, đặt đơn) KHÔNG đổi; Task 1 và Task 2 có spec khẳng định giá thẻ/PDP/giỏ và tổng giỏ không đổi. Review như gói tiền.
- Giá giảm màu `--color-text-price-deal`; giá thường đen; không đỏ. Một màu deal cho mọi dòng "Tiết kiệm" (PDP: `combo-card.tsx`, `pdp-bundles.tsx`; giỏ).
- Chữ mua sắm đi qua `SHOP_COPY` + `shop-copy-budget.ts` (khoá thêm phải có ở cả hai, chữ ≤ ngân sách); không "Freeship", "Voucher", "Top".
- Vùng chạm ≥44px, tương phản ≥4,5:1, axe 0 vi phạm ở 375px; ô chọn Mini vẫn vùng chạm 44px (`tests/support/hit-area.ts` dùng cho chip, ô chọn đo bằng `elementFromPoint`).
- `pnpm lint:parity` chạy bánh cóc px và `max-md:` (`scripts/uiux/ds-baseline.json`): không thêm px viết tay hay `max-md:` mới; gói hạ được số thì `node scripts/uiux/ds-ratchet.mjs --write` và commit baseline.
- Mini ↔ web cùng khuôn (luật `AGENTS.md`). KHÔNG sửa file thuộc G1 (`voucher.ts`, `voucher-ticket.tsx`, Ưu đãi, `useMarkExpiringSeen`, `guest-points-note.tsx`, `GuestLinkCard`, `DailyCheckInCard`, `OffersPointsStrip`, `brand-view.tsx`, `shop-page.ts`, `--banner-ratio`) và G3 (PDP hai app, `pdp-bundles.tsx`, `flash-sold-bar.tsx`, `flash-price-bar.tsx`, `terminology.spec.ts`, `pdp-*.spec.ts`). `shop-copy.ts` + `shop-copy-budget.ts` được thêm khoá (gộp tay khi merge).
- Không deploy, không đọc/ghi PROD, không push, không `git stash` trần. Comment chỉ giải thích "vì sao" (tiếng Việt). Máy thiếu RAM: chỉ chạy vitest/e2e theo file khi làm; gate đầy đủ một lần ở cuối.

## Review Focus

1. Giỏ có giảm combo mà không có dòng nào giảm giá gạch (và ngược lại): "Tiết kiệm" vẫn ra đúng (chỉ combo, chỉ gạch, cả hai), không "0đ", không âm; chọn một phần giỏ mà giá phần chọn chưa về (`priced=null`) thì combo = 0, không mượn số combo của cả giỏ. Test: Task 2 `cart-saving.spec` + `cart.spec`.
2. Tổng 9–10 chữ số (123.456.789đ, 1.234.567.890đ) và "Tiết kiệm 12.345.000đ" ở 320px: không số nào bị cắt hay đè dưới nút Thanh toán; không bao giờ rút gọn số tiền khách trả. Nút xuống hàng riêng khi khối tổng không vừa. Test: Task 4 e2e 320px.
3. Món Giờ vàng không thắng (flash ≥ giá đang bán) và món có `repVariationId`/ghim phân loại: `compareAt` của thẻ vẫn bằng `strikePrice`; thẻ không đổi số tiền trả. Test: Task 1.
4. Số lượng 1 ở web: bấm "−" không gửi PATCH; số lượng 2 vẫn giảm được; dòng hết hàng không có bộ đếm. Test: Task 3.
5. Máy có vùng an toàn đáy (`--safe-bottom` 34px) và chân dính cao thêm (lời báo hết hàng): Tab tới ô cuối của dòng cuối vẫn nằm trên chân dính. Test: Task 5 e2e.

---

## File Structure

| File | Việc |
|---|---|
| `packages/app-core/src/flash-price.ts`, `commerce/strike-price.spec.ts`, `packages/shared-types/src/price.ts` | `cardPricing` gọi `strikePrice`, spec ghim, sửa docstring (T1) |
| `packages/app-core/src/commerce/pdp-view.ts` + spec, `commerce/cart-total.ts` (mới) + spec, `shop-copy.ts`, `shop-copy-budget.ts` | `cartSaving(items, combo)`, `cartTotalLabel` (T2, T3) |
| `apps/miniapp/src/pages/cart.tsx` + `cart.spec.tsx`, `apps/miniapp/src/i18n/vi.ts` + `freeship-copy.spec.ts` | Mini: tiết kiệm + nhãn (T2, T3), chân dính (T4), ô chọn + token (T7) |
| `apps/web/src/app/gio-hang/page.tsx` + `sticky-bar.spec.tsx`, `cart-mini.spec.tsx`, `cart-parity.spec.tsx` | web: tiết kiệm + nhãn, nút −, tên dòng (T2–T4) |
| `apps/miniapp/src/components/ui/sticky-action-bar.tsx` + spec | hàng cuối flex-wrap (T4) |
| `apps/miniapp/src/css/tokens.css`, `css/focus-scroll.spec.tsx` | `.tubu-scroll-pad-sticky-bar` theo `--sticky-bar-h` (T5) |
| `apps/miniapp/src/components/ui/form.tsx` + `form.spec.tsx` | `Checkbox` prop `flush` (T6) |
| `apps/e2e/tests/support/cart-footer-mocks.ts`, `cart-display.miniapp.spec.ts`, `cart-display.web.spec.ts` (mới) | e2e hiển thị giỏ hai app (T2–T6) |
| `scripts/uiux/ds-baseline.json` | hạ baseline nếu số px/guard giảm (T7) |

---

### Task 1: Một nguồn giá gạch cho thẻ (MINOR F10b #1)

**Files:**
- Modify: `packages/app-core/src/flash-price.ts` (`cardPricing`), `packages/shared-types/src/price.ts` (docstring)
- Test: `packages/app-core/src/commerce/strike-price.spec.ts`

**Interfaces:**
- Consumes: `strikePrice(i: { retailPrice: number; salePrice?: number | null; flashPrice?: number | null }): number` (`@tubutree/shared-types`).
- Produces: không đổi chữ ký. `cardPricing(...).compareAt` luôn bằng `discountView(price, strikePrice(...)).compareAt`; `standingOf` chỉ còn quyết suất nào thắng (giá khách trả), không còn tính giá gạch.

- [ ] **Step 1: test đỏ** trong `strike-price.spec.ts`, khối mới `describe('thẻ đọc strikePrice, không tự tính')`: dùng `vi.mock('@tubutree/shared-types', async (orig) => ({ ...(await orig()), strikePrice: vi.fn((await orig()).strikePrice) }))`; ca `.each` 5 hàng của bảng hiện có + một món có `salePrice` ở thẻ nhưng suất không có `retailPrice` (nhánh `standingOf` rơi về giá thẻ): đặt `vi.mocked(strikePrice).mockReturnValue(99_000)` rồi `expect(cardPricing(...).compareAt).toBe(99_000)` (flash và không flash) và `expect(vi.mocked(strikePrice)).toHaveBeenCalledWith({ retailPrice, salePrice, flashPrice })` với đúng ba số của ca. Thêm ca "tiền không đổi": với `strikePrice` bị mock trả 99.000, `cardPricing(...).price` vẫn bằng giá cũ của từng ca (33.000 / 50.000 / 59.000 theo bảng).
- [ ] **Step 2: chạy FAIL**: `cd packages/app-core && npx vitest run src/commerce/strike-price.spec.ts` → `compareAt` không phải 99.000 vì thẻ tự tính.
- [ ] **Step 3: cài** `cardPricing`: `compareAt` đi qua `discountView(price, strikePrice({ retailPrice, salePrice, flashPrice }))` với `retailPrice/salePrice` của suất khi suất có `retailPrice`, ngược lại của thẻ (`basePrice`, `salePrice`); suất thắng thì `flashPrice: item.flashPrice`, không thắng thì không truyền. Giữ nguyên chọn suất, `price`, `isFlash`, `flashVariationId`. Viết lại docstring `strikePrice` (price.ts): nói đúng bốn nơi đọc luật này (API giỏ `listUnitPrice`, `variationPricing`, `cardPricing`; `flashDisplay.was` được spec ghim bằng cùng số, không gọi hàm) và chỉ là số hiển thị.
- [ ] **Step 4: chạy PASS** spec trên + `npx vitest run src/flash-price.spec.ts src/commerce` (không hồi quy các spec giá thẻ).
- [ ] **Step 5: Commit** `refactor(app-core): cardPricing lấy giá gạch từ strikePrice, một nguồn cho thẻ, PDP và giỏ (G2)`

---

### Task 2: "Tiết kiệm" của giỏ cộng cả giảm combo, một màu deal (P2 #12)

**Files:**
- Modify: `packages/app-core/src/commerce/pdp-view.ts` (`cartSaving`), `apps/miniapp/src/pages/cart.tsx` (`StickySummary` khối `lead`, nơi truyền `saving`), `apps/web/src/app/gio-hang/page.tsx` (hai khối `cart-saving`, biến `saving`)
- Create: `apps/e2e/tests/cart-display.miniapp.spec.ts`, `apps/e2e/tests/cart-display.web.spec.ts`
- Test: `packages/app-core/src/commerce/pdp-view.spec.ts` (hoặc file spec sẵn có của `cartSaving`), `apps/miniapp/src/pages/cart.spec.tsx`, `apps/web/src/app/gio-hang/sticky-bar.spec.tsx`

**Interfaces:**
- Produces: `cartSaving(items: readonly { unitPrice: number; listUnitPrice?: number | null; quantity: number }[], comboDiscount = 0): number` = `Σ lineSaving + max(0, comboDiscount)`; `comboDiscount` không hợp lệ (NaN) coi như 0. Mã giảm giá và ưu đãi hạng KHÔNG cộng: đã có dòng riêng ngay trên và đổi theo lựa chọn của khách.
- Màu: `color: var(--color-text-price-deal)`, `fontWeight: 600`, cỡ `--type-caption-size` (đúng dòng "Tiết kiệm" của `ComboCard`/`pdp-bundles`), Tailwind web `text-[color:var(--color-text-price-deal)] font-semibold`.

- [ ] **Step 1: test đỏ** app-core: `cartSaving([{unitPrice:33_000,listUnitPrice:50_000,quantity:2}], 65_250)` = 99.250; chỉ combo (`listUnitPrice` bằng giá) → 65.250; chỉ gạch, combo 0/mặc định → như cũ; combo âm/NaN → bỏ qua; giỏ rỗng + combo 0 → 0. Spec tiền: tổng giỏ không đổi (`subtotal - combo - discount - tier` của một giỏ mẫu bằng nhau trước/sau vì `cartSaving` là hàm thuần chỉ đọc).
- [ ] **Step 2: test đỏ** Mini `cart.spec.tsx`: giỏ có combo 65.250 và dòng gạch lệch 17.000 → `cart-saving` có chữ `Tiết kiệm 82.250đ`; giỏ chỉ có combo → `Tiết kiệm 65.250đ` (trước đây không hiện); chọn một phần giỏ chưa có `priced` → combo không cộng; `getByTestId('cart-saving')` có `style.color` = `var(--color-text-price-deal)`. Web `sticky-bar.spec.tsx` (khối `cart-saving` ở chân dính) và `cart-mini.spec.tsx` (khung tóm tắt) cùng ca và class `text-[color:var(--color-text-price-deal)]`.
- [ ] **Step 3: chạy FAIL**: `cd packages/app-core && npx vitest run src/commerce/pdp-view.spec.ts`; `cd apps/miniapp && npx vitest run src/pages/cart.spec.tsx`; `cd apps/web && npx vitest run src/app/gio-hang/sticky-bar.spec.tsx src/app/gio-hang/cart-mini.spec.tsx`.
- [ ] **Step 4: cài** `cartSaving` (chữ ký trên); Mini: `saving={cartSaving(buyableSelected, comboDiscount)}` với đúng `comboDiscount` đang hiển thị (đã là 0 khi `priced=null`), nên `StickySummary` tính `saving` từ biến `comboDiscount` bên trong thay vì prop truyền từ ngoài (bỏ prop `saving`, thêm prop `selectedLines`); đổi màu `Text` sang token deal + `fontWeight: 600`. Web: `saving = cartSaving(buyableSelected, shownCombo)` (di chuyển xuống sau khi `shownCombo` xác định), hai khối `cart-saving` đổi màu như trên. Chú thích "vì sao": mã giảm giá và hạng đã có dòng riêng.
- [ ] **Step 5: e2e** `cart-display.miniapp.spec.ts` (375): giỏ `{ lines: 3, reached: true, combo: 6_000, deals: true }` → chân dính ghi `Tiết kiệm 54.000đ` (17.000 + 31.000 + 6.000), màu computed của `cart-saving` bằng màu computed của `cart-line-price` deal đầu tiên (đọc từ cùng trang, `rgb(154, 82, 0)`); `cart-display.web.spec.ts` cùng ca (dùng `openCart` kiểu `cart-footer.web.spec.ts`). Chạy Mini: `cd apps/e2e && E2E_SCOPE=miniapp E2E_MINIAPP_PORT=3385 npx playwright test tests/cart-display.miniapp.spec.ts --workers=1`.
- [ ] **Step 6: chạy PASS** các lệnh Step 3 + Step 5. `pnpm lint:parity`.
- [ ] **Step 7: Commit** `fix(cart): "Tiết kiệm" của giỏ cộng cả giảm combo, một màu deal như PDP (G2, P2 #12)`

---

### Task 3: Web 1280 một nhãn với 375; nút − khoá ở số lượng 1; tên dòng cùng độ đậm Mini (P2 #13, #14)

**Files:**
- Create: `packages/app-core/src/commerce/cart-total.ts`, `packages/app-core/src/commerce/cart-total.spec.ts`
- Modify: `packages/app-core/src/shop-copy.ts` (+ `shop-copy-budget.ts`), `apps/web/src/app/gio-hang/page.tsx` (hai hàng "Tổng", nhãn chân dính, nút −, tên dòng), `apps/miniapp/src/pages/cart.tsx` (nhãn), `apps/miniapp/src/i18n/vi.ts` (xoá `cart.subtotalAfterDiscount`), `apps/miniapp/src/i18n/freeship-copy.spec.ts`
- Test: `apps/web/src/app/gio-hang/cart-mini.spec.tsx`, `cart-parity.spec.tsx`, `sticky-bar.spec.tsx`, `apps/e2e/tests/cart-display.web.spec.ts`

**Interfaces:**
- Produces: khoá `cart.subtotal: 'Tạm tính'` (ngân sách 10) và `cart.subtotalNet: 'Tạm tính (đã giảm)'` (ngân sách 20) trong `SHOP_COPY` và `SHOP_COPY_MAX`; `cartTotalLabel(discountSum: number): string` (`commerce/cart-total.ts`): `discountSum > 0` → `'Tạm tính (đã giảm)'`, ngược lại `'Tạm tính'`. Cả hai app gọi hàm này cho số `subtotal − combo − mã − hạng`; `vi.cart.subtotal` của Mini giữ cho màn Thanh toán và Chi tiết đơn (số tiền hàng gộp).
- Web từ md: hàng "Tạm tính" trên cùng (số chưa giảm) chỉ vẽ khi có giảm; hàng cuối (trước đây "Tổng") dùng `cartTotalLabel`. Không còn chữ "Tổng" cho số chưa gồm phí giao.
- Web "−": `disabled={busy || it.quantity <= 1}`. Tên dòng ở 375: bỏ `max-md:font-semibold` (Mini đo được `font-weight: 500`, 14px, Inter), còn `font-medium`.

- [ ] **Step 1: test đỏ** `cart-total.spec.ts`: `cartTotalLabel(0)`, `cartTotalLabel(-1)`, `cartTotalLabel(NaN)` → `'Tạm tính'`; `cartTotalLabel(1)` → `'Tạm tính (đã giảm)'`; `SHOP_COPY['cart.subtotalNet']` có đúng chữ đó. Web `cart-mini.spec.tsx`: giỏ có giảm → khung tóm tắt (`cart-summary`) có hai nhãn `Tạm tính` rồi `Tạm tính (đã giảm)` (số `528.000đ`) và KHÔNG có "Tổng"; giỏ không giảm → chỉ MỘT nhãn `Tạm tính` trong khung. `cart-parity.spec.tsx`: ô "Giảm số lượng" `disabled` khi `quantity: 1`, không `disabled` khi `quantity: 2` và bấm gọi PATCH với `quantity: 1`; lớp tên dòng không chứa `max-md:font-semibold`.
- [ ] **Step 2: chạy FAIL**: `cd packages/app-core && npx vitest run src/commerce/cart-total.spec.ts`; `cd apps/web && npx vitest run src/app/gio-hang`.
- [ ] **Step 3: cài** `cart-total.ts` + hai khoá chữ (cả hai file); web: hai hàng "Tổng" (md và lg) và nhãn chân dính gọi `cartTotalLabel(shownCombo + shownDiscount + shownTier)`, hàng "Tạm tính" gộp chỉ khi tổng giảm > 0; Mini `cart.tsx` gọi hàm; xoá `subtotalAfterDiscount` khỏi `vi.ts`, đổi dòng spec tương ứng ở `freeship-copy.spec.ts` sang `SHOP_COPY['cart.subtotalNet']` (vẫn không chứa "ship"); nút − và tên dòng như Interfaces.
- [ ] **Step 4: e2e** (thêm vào `cart-display.web.spec.ts`): 1280×900, giỏ có combo: khung `cart-summary` ghi `Tạm tính (đã giảm)` cùng số với `cart-total-value` ở 375 (`207.750đ`); không có chữ "Tổng" làm nhãn; 375: số lượng 1 thì nút "Giảm số lượng …" `toBeDisabled()`, số lượng 2 thì không; `getComputedStyle(tên dòng).fontWeight` = `'500'`.
- [ ] **Step 5: chạy PASS** Step 2 + `cd packages/app-core && npx vitest run src/shop-copy*.spec.ts` + `cd apps/miniapp && npx vitest run src/pages/cart.spec.tsx src/i18n` + `pnpm lint:parity` (số `max-md:` của `gio-hang/page.tsx` giảm: chạy `node scripts/uiux/ds-ratchet.mjs --write` ở Task 7).
- [ ] **Step 6: Commit** `fix(cart): web dùng cùng nhãn "Tạm tính (đã giảm)" với Mini, nút − khoá ở số lượng 1, tên dòng cùng độ đậm (G2, P2 #13 #14)`

---

### Task 4: Chân dính giỏ 320px: khối tổng không tràn dưới nút (MINOR F10b #2)

**Files:**
- Modify: `apps/miniapp/src/components/ui/sticky-action-bar.tsx` (hàng cuối), `apps/miniapp/src/pages/cart.tsx` (khối `lead`), `apps/web/src/app/gio-hang/page.tsx` (hàng tổng + nút ở chân dính)
- Test: `apps/miniapp/src/components/ui/sticky-action-bar.spec.tsx`, `apps/e2e/tests/cart-display.miniapp.spec.ts`, `cart-display.web.spec.ts`

**Interfaces:**
- Hàng cuối chân dính (`lead` + nút) là flex-wrap: khối `lead` `flex: 1000 1 0` (min-width auto: nhỏ nhất là số/nhãn không ngắt), khối nút `flex: 1 0 9.25rem`. Chung hàng thì nút chiếm đúng 9.25rem (grow 1/1000 của phần dư ≈ 0); khối tổng rộng quá thì nút xuống hàng riêng và giãn hết bề ngang. Số tiền khách trả KHÔNG bao giờ rút gọn (`vndShort` không dùng cho tổng). Dòng "Tiết kiệm" được xuống dòng (`white-space: normal`) tại khoảng trắng, không bao giờ ngắt giữa số (`1.234.000đ` không có điểm ngắt); nhãn và số tổng giữ `nowrap`.

- [ ] **Step 1: test đỏ** Mini `sticky-action-bar.spec.tsx`: hàng chứa `lead` có `style.flexWrap === 'wrap'`; khối `lead` `flex: 1000 1 0`; khối nút `flex: 1 0 9.25rem`; khi không có `lead` giữ `flex: 1`, `minWidth: 0` như cũ. E2E Mini (320×640 và 375×812): `cart-display.miniapp.spec.ts`, ca A `{ lines: 3, reached: true, unit: 4_115_000, saving: 1_234_000 }` (tổng 12.345.000đ, tiết kiệm 1.234.000đ), ca B `{ lines: 3, reached: true, unit: 41_150_000, saving: 12_345_000 }` (tổng 123.450.000đ, tiết kiệm 12.345.000đ), ca C `{ ..., unit: 411_500_000 }` (tổng 1.234.500.000đ): với `total = cart-total-value`, `saving = cart-saving`, `pay` = nút Thanh toán: `scrollWidth <= clientWidth` của cả hai; `document.documentElement.scrollWidth <= viewport`; hoặc `pay` cùng hàng và `total.right <= pay.x` và `saving.right <= pay.x`, hoặc `pay.y >= max(total.bottom, saving.bottom)` (xuống hàng riêng); nút nằm trọn trong màn; ở 375 và `unit` nhỏ (ca bình thường 207.750đ) nút vẫn cùng hàng và rộng đúng 148px (không phình). Web `cart-display.web.spec.ts` cùng ba ca ở 320.
- [ ] **Step 2: chạy FAIL**: `cd apps/miniapp && npx vitest run src/components/ui/sticky-action-bar.spec.tsx`; `cd apps/e2e && E2E_SCOPE=miniapp E2E_MINIAPP_PORT=3385 npx playwright test tests/cart-display.miniapp.spec.ts --workers=1 -g "320"` → ca B hoặc C đè dưới nút.
- [ ] **Step 3: cài** Mini: `StickyActionBar` bọc hàng `display: flex, flexWrap: wrap, columnGap: 10, rowGap: 4`; `lead` `{ flex: '1000 1 0' }` (bỏ `minWidth: 0` khi có `lead`, giữ cho trường hợp khác), nút `{ flex: '1 0 9.25rem' }`; `cart.tsx` dòng `cart-saving` bỏ `whiteSpace: 'nowrap'`. Web: hàng `flex flex-wrap items-center gap-x-2.5 gap-y-1`, khối tổng `flex-[1000_1_0%]` (bỏ `min-w-0`, `whitespace-nowrap`; nhãn và số tổng thêm `whitespace-nowrap` riêng), nút `flex-[1_0_9.25rem]` thay `min-w-[9.25rem] shrink-0`. Không thêm `max-md:` và px.
- [ ] **Step 4: chạy PASS** Step 2 (không còn `-g`) + `cart-footer.miniapp.spec.ts` (đo lại chân ≤150/≤175px ở 375, không hồi quy) + web `cart-footer.web.spec.ts` + `cart-display.web.spec.ts` bằng `E2E_API_PORT=3386 E2E_WEB_PORT=3387 E2E_MINIAPP_PORT=3388 bash apps/e2e/scripts/web-gate.sh tests/cart-display.web.spec.ts tests/cart-footer.web.spec.ts` (nếu docker/RAM không cho: ghi vào notes, để CI).
- [ ] **Step 5: Commit** `fix(cart): khối tổng ở chân dính không tràn dưới nút Thanh toán ở 320px, nút xuống hàng riêng khi không vừa (G2)`

---

### Task 5: `scroll-padding` theo chiều cao chân dính thật (MINOR F10b #3)

**Files:**
- Modify: `apps/miniapp/src/css/tokens.css` (`.tubu-scroll-pad-sticky-bar`), `apps/miniapp/src/css/focus-scroll.spec.tsx`
- Test: `apps/e2e/tests/cart-display.miniapp.spec.ts`

**Interfaces:**
- Consumes: `--sticky-bar-h` (`StickyActionBar` Mini ghi vào `<html>`, đã gồm `--safe-bottom`).
- Produces: `scroll-padding-bottom: calc(var(--sticky-bar-h, calc(96px + var(--safe-bottom))) + 8px)`: chân thật cộng khe 8px; chưa có biến thì giữ 96px + vùng an toàn như cũ (cộng 8px).

- [ ] **Step 1: test đỏ** `focus-scroll.spec.tsx` đổi ca "trang có StickyActionBar tăng phần chừa đáy": giá trị đọc từ CSSOM chứa `var(--sticky-bar-h` và dự phòng `96px`. E2E Mini: giỏ 8 dòng `{ lines: 8, reached: true, outOfStock: false }` ở 375×812 và ở `--safe-bottom: 34px` (`setSafeBottom` như `cart-footer.miniapp.spec.ts`): cuộn đầu trang, nhấn Tab từ ô chọn đầu tiên tới khi focus ở nút "Tăng số lượng Sản phẩm thử 8" (`page.keyboard.press('Tab')`, tối đa 60 lần), rồi `box.y + box.height <= bar.y` của `sticky-bar`.
- [ ] **Step 2: chạy FAIL**: vitest `src/css/focus-scroll.spec.tsx`; e2e (`-g "Tab"`) → nút dưới chân dính vài chục px (chân ~140px so với 96px).
- [ ] **Step 3: cài** luật CSS như Interfaces, chú thích "vì sao" (chân giỏ cao 138–190px, số cố định 96px để Tab xuống dưới chân, WCAG 2.4.11).
- [ ] **Step 4: chạy PASS** hai lệnh; `cd apps/e2e && ... playwright test tests/cart-footer.miniapp.spec.ts tests/sticky-below-back.miniapp.spec.ts` (các trang có chân dính khác không hồi quy: `checkout.miniapp`, PDP không đo được vì G3 giữ).
- [ ] **Step 5: Commit** `fix(miniapp): scroll-padding đáy theo --sticky-bar-h, Tab tới ô cuối giỏ không nằm dưới chân dính (G2)`

---

### Task 6: Ô chọn giỏ Mini cột 24 + khoảng 12, token semantic (P2 #15, PL-19)

**Files:**
- Modify: `apps/miniapp/src/components/ui/form.tsx` (`Checkbox`, `hitArea`), `apps/miniapp/src/pages/cart.tsx` (`CartLineRow`; thanh freeship)
- Test: `apps/miniapp/src/components/ui/form.spec.tsx`, `hit-target-guard.spec.tsx`, `apps/e2e/tests/cart-display.miniapp.spec.ts`, `scripts/uiux/ds-baseline.json`

**Interfaces:**
- Produces: `Checkbox` thêm prop `flush?: boolean` (mặc định false, không ảnh hưởng chỗ khác): khung chạm 44×44 giữ nguyên nhưng chỉ chiếm 24px bề ngang trong dòng (`margin: 0 -10px`, `paddingLeft: 10`, `boxSizing: border-box`, `width: 44`), ô nằm đúng cột 24px, vùng chạm nhô ra 10px mỗi phía.
- `CartLineRow`: `gap` của dòng 12 (trước 10), ô chọn `flush`. Hệ quả: ô chọn x=24..48 trong dòng x=12, ảnh bắt đầu x=60 (trước 78).
- Thanh freeship: rãnh `var(--color-track)`, tô `linear-gradient(90deg, var(--color-action-secondary-border), var(--color-action-primary-bg))` (đúng hai màu cũ, đi qua token semantic) thay cho `--stone-200` và `--forest-200`.

- [ ] **Step 1: test đỏ** `form.spec.tsx`: `<Checkbox flush .../>` có khối `checkbox-hit-area` với `style.margin === '0px -10px'`, `style.paddingLeft === '10px'`, `style.minWidth === '44px'`; không `flush` thì không có `margin`. `hit-target-guard.spec.tsx`: thêm ca `Checkbox flush có nhãn` đạt 44×44. E2E Mini 375: dòng đầu của giỏ: `ctl = [role=checkbox] hoặc label.zaui-checkbox-wrapper > span`, `thumb = cart-line-thumb`: `thumb.x - (ô chọn.x + 24) === 12` (±1), `checkbox-hit-area` rộng 44 và cao ≥44, `document.elementFromPoint` ở hai điểm cách tâm ô ±20px theo chiều ngang thuộc `checkbox-hit-area` (cả `hit.contains(target)`), và bấm vào điểm đó đổi trạng thái chọn (ô "Chọn tất cả" chuyển bỏ chọn dòng đầu). Guard: `var(--color-track)` có trong style thanh `freeship-bar` (spec vitest `cart.spec.tsx`, ca chưa đạt miễn phí giao: `getByTestId('freeship-bar').style.background` chứa `var(--color-track)`).
- [ ] **Step 2: chạy FAIL**: `cd apps/miniapp && npx vitest run src/components/ui/form.spec.tsx src/components/ui/hit-target-guard.spec.tsx src/pages/cart.spec.tsx`; e2e `-g "ô chọn"`.
- [ ] **Step 3: cài** như Interfaces. Thay hai giá trị primitive của thanh freeship; baseline guard `primitive-color` của `pages/cart.tsx` giảm: chạy `node scripts/uiux/ds-ratchet.mjs --write` ở Task 7.
- [ ] **Step 4: chạy PASS** Step 2 + `cd apps/e2e && ... playwright test tests/cart-lines.miniapp.spec.ts tests/cart-footer.miniapp.spec.ts` (chiều ngang dòng tăng 18px: tên dòng có thể cao hơn, không hồi quy).
- [ ] **Step 5: Commit** `fix(miniapp): ô chọn dòng giỏ cột 24 + khoảng 12 (vùng chạm vẫn 44), thanh freeship dùng token semantic (G2, P2 #15)`

---

### Task 7: Baseline, ảnh trước/sau, gate cuối, ghi kết quả

- [ ] **Step 1: baseline**: `node scripts/uiux/ds-ratchet.mjs --write`; xem `git diff scripts/uiux/ds-baseline.json` chỉ có số GIẢM (`gio-hang/page.tsx` `max-md`, `pages/cart.tsx` `primitive-color`); commit `chore(ds): hạ baseline bánh cóc sau G2`.
- [ ] **Step 2: ảnh**: `docs/2026-10-31-shop-redesign/screens/G2/g2-shots.{miniapp,web}.spec.ts` (gitignore; chép vào `apps/e2e/tests/` khi chạy, xoá sau): ảnh "trước" đã chụp ở base vào `screens/G2/before/` (Mini 375 và 320, web 375, 320, 1280, ba ca: thường, tổng 12.345.000đ + tiết kiệm 1.234.000đ, cộng combo), chạy lại với `SHOTS_PHASE=after`. So hai app ở 375 và 320.
- [ ] **Step 3: gate**: tắt server chụp ảnh; `cd apps/e2e && E2E_SCOPE=miniapp E2E_MINIAPP_PORT=3385 npx playwright test --workers=2 --reporter=line`; rồi `bash docs/2026-10-28-review/tools/gate.sh <worktree> --base 7d2fbce40 --out .../gate-G2.txt`. Bước FAIL: chạy lại ở base để phân biệt "có sẵn".
- [ ] **Step 4: ghi** vào cuối plan này mục "Kết quả": commit, số đo chân dính 320px trước/sau, e2e cũ sửa theo thiết kế, đường dẫn ảnh; commit `docs(shop): G2 ghi kết quả`.
