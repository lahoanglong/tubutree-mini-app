# L5 last-minors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** sửa 5 MINOR cuối reviewer để lại ở L3 và L4: focus nút Đặt hàng không giật, bảng "Mua ngay" của khách chưa đăng nhập không có dải trống, dòng tồn kho ở giỏ web theo Mini, bộ quét template `terminology.spec` bắt đủ từ hoa đứng riêng, huy hiệu "CTV tuyển chọn" ở trang khách Mini dùng cùng `Badge` với trình dựng và web.

**Architecture:** toàn bộ là phía client, số tiền khách trả không đổi, không sửa API. Luật dòng tồn kho giỏ nằm một nơi ở `packages/app-core/src/commerce/stock-text.ts` (`cartStockNote`), hai giỏ chỉ vẽ. Hai bảng chọn phân loại nhận thêm một prop để biết giỏ còn có thể về hay không.

**Tech Stack:** React 18, Next 15 (web), zmp-ui + Vite (Mini), TanStack Query, TypeScript compiler API (bộ quét), vitest, Playwright.

**Spec:** `docs/2026-10-31-shop-redesign/01-thiet-ke.md` (§4 là luật); kế hoạch gốc `plans/L3-minors-k4-k7.md`, `plans/L4-final-polish.md`.

## Global Constraints

- `export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH` cho mọi lệnh; worktree mới đã chạy `pnpm install --offline --frozen-lockfile`, `pnpm --filter @tubutree/shared-types build`, `npx prisma generate` (trong `apps/api`).
- Đường tiền (chỉ phần hiển thị): thứ tự giảm Giờ vàng → combo → mã → hạng → điểm, chia về `OrderItem.paidTotal`; số khách trả không đổi, không sửa API.
- Chữ tồn kho "Còn {n} sản phẩm" cho mọi n > 0 (K1, L4); tồn thấp (`isLowStock`, n ≤ `LOW_STOCK_NOTICE` = 5) chỉ nhấn bằng màu cảnh báo, không chữ giục ("Chỉ còn" nằm trong `FORBIDDEN_TERMS`); không đỏ.
- Web khổ điện thoại giống Mini App cả giao diện: sửa giao diện làm ở cả hai app cùng cách.
- Vùng chạm ≥ 44px, tương phản ≥ 4,5:1; `pnpm lint:parity` và `pnpm lint:vars` xanh; hạ được số thì `node scripts/uiux/ds-ratchet.mjs --write` và commit baseline.
- Không đụng: `apps/web/src/components/home/flash-sale.tsx`, `apps/web/src/lib/flash-boot-script.ts`, `apps/miniapp/src/components/flash-sale.tsx`, `apps/web/src/app/page.tsx`, `apps/web/src/lib/home-initial.ts`, `packages/app-core/src/home-layout.ts` (phiên 9b); khoá "Chuyển vào Ví" (R-185) ở `affiliate.tsx` và `ctv/page.tsx`.
- Không push, không đọc/ghi PROD. Máy chung thiếu RAM: chạy vitest theo file, gate đầy đủ một lần ở cuối, e2e `--workers=2`.
- Comment chỉ giải thích "vì sao" không hiển nhiên (tiếng Việt, theo mật độ của file).

## Review Focus

1. Khách đang gõ ở ô khác (ghi chú, hoá đơn, và cả ô nhập mã giảm giá, ô tick Điểm Xanh nằm trong khung "Đơn hàng") lúc báo giá tải lại xong: focus không bị kéo về nút Đặt hàng, Space/Enter kế tiếp không bấm nhầm nút. Test Task 1.
2. Khách chưa đăng nhập mở "Mua ngay" ở sản phẩm Giờ vàng có giới hạn: dải ghi chú vẫn có chỗ (câu mất giá Giờ vàng có thể hiện) dù giỏ không về. Test Task 2.
3. Giỏ: tồn 40 mà khách chọn 40 thì chữ thường (không cam); tồn 3 chọn 3 thì cam; chọn 50 mà tồn 40 (đang chặn thanh toán) vẫn cam; hết hàng không dùng dòng này. Test Task 3.
4. Bộ quét: `FREESHIP-${id}`, `${a}-FREESHIP`, `${base}/HOT/${id}`, `HOT_${x}` là mã định danh, không bị bắt; `(HSD ${d})`, `${n} HOT!` bị bắt. Test Task 4.
5. Gian hàng chưa được duyệt: không vẽ `Badge` rỗng. Test Task 5.

---

## File Structure

- `apps/web/src/app/thanh-toan/page.tsx` (Task 1).
- `apps/web/src/components/variation-sheet.tsx`, `apps/miniapp/src/components/variation-sheet.tsx` (prop `cartMayArrive`), nơi gọi chế độ buy: `apps/web/src/components/add-to-cart.tsx`, `apps/miniapp/src/pages/product-detail.tsx` (Task 2).
- `packages/app-core/src/commerce/stock-text.ts` (+ spec), `apps/web/src/app/gio-hang/page.tsx`, `apps/miniapp/src/pages/cart.tsx`, `apps/miniapp/src/i18n/vi.ts` (bỏ khoá `cart.stockLimited` không còn nơi dùng) (Task 3).
- `packages/app-core/src/terminology.spec.ts`, `DESIGN.md` (một câu về phạm vi bộ quét template) (Task 4).
- `apps/miniapp/src/pages/storefront-view.tsx` (Task 5).
- `docs/2026-10-31-shop-redesign/PROGRESS.md`, `scripts/uiux/ds-baseline.json` nếu hạ được (Task 6).

---

### Task 1: thanh toán lg, chỉ trả focus về nút khi khách chưa đi chỗ khác

**Files:**
- Modify: `apps/web/src/app/thanh-toan/page.tsx` (effect focus quanh dòng 352-358)
- Test: `apps/web/src/app/thanh-toan/checkout-lg-place.spec.tsx`

**Interfaces:** nội bộ, không đổi chữ ký. `focusIsFree` là biến cục bộ trong effect: đúng khi `active` là `null`/`document.body` hoặc chính `button`. Bản đầu của gói còn tính "nằm trong khung Đơn hàng" là tự do (`summaryRef`), reviewer chỉ ra khung đó chứa ô `#coupon-code` và ô tick Điểm Xanh (bung tại chỗ từ lg) nên lỗ cũ vẫn còn; đã bỏ `summaryRef`, mọi phần tử khác (kể cả liên kết cạnh nút, Enter trên đó là đi trang) được giữ focus.

- [ ] **Step 1: Test đỏ.** Trong `describe('/thanh-toan lg: lỗi đặt đơn thấy được (K2 d)')` thêm: (a) `lỗi TOTAL_CHANGED, báo giá tải lại 40ms, khách tab vào ô ghi chú rồi gõ: báo giá về thì focus ở lại ô ghi chú` (`state.placeError = new Error('TOTAL_CHANGED')` dạng `ApiError` có `code`; nếu mock không dựng được `ApiError` thì dùng `PRICE_CHANGED` như ca cũ): bấm nút, `flush(4)`, `textarea = c.querySelector('[data-mini-block="note"] textarea')`, `textarea.focus()`, đợi 80ms, `expect(document.activeElement).toBe(textarea)` và `expect(lgButton(c).disabled).toBe(false)`; (b) `focus đang ở body khi báo giá về: nút nhận focus` (giữ ca đang có, thêm `expect(document.activeElement).toBe(lgButton(c))` sau khi `blur()` mọi thứ); (c) `focus đang ở một nút khác trong khung Đơn hàng: vẫn trả về nút Đặt hàng` (focus nút đầu tiên khác `lgButton` nằm trong `part(c).closest('.h-fit')`; nếu khung không có nút nào focus được thì bỏ ca này và ghi vào notes); (d) sau (a), lần vẽ lại tiếp theo cũng không kéo focus (cờ đã hạ).
- [ ] **Step 2: Run** `cd apps/web && npx vitest run src/app/thanh-toan/checkout-lg-place.spec.tsx` → FAIL ở (a) (activeElement là nút Đặt hàng).
- [ ] **Step 3: Implement.** Effect 2: sau khi hạ cờ, đọc `document.activeElement`; chỉ gọi `button.focus({ preventScroll: true })` khi `!button.disabled && focusIsFree(...)`. Cập nhật comment ngay trên effect: nói cờ bị bỏ khi khách đã focus chỗ khác (kể cả trong khung Đơn hàng: ô mã giảm giá, ô Điểm Xanh), vì sao (Space/Enter kế tiếp bấm nhầm nút đặt hàng).
- [ ] **Step 4: Run** file spec trên và `checkout-errors`, `checkout-race`, `checkout-sticky`, `checkout-parity` (cùng thư mục) → PASS.
- [ ] **Step 5: Commit** `fix(web): thanh toán lg không giật focus về nút Đặt hàng khi khách đã focus chỗ khác ngoài khung Đơn hàng (L5 1)`.

---

### Task 2: bảng "Mua ngay" của khách chưa đăng nhập không giữ dải trống

**Files:**
- Modify: `apps/web/src/components/variation-sheet.tsx` (prop + `reserveNote`), `apps/miniapp/src/components/variation-sheet.tsx` (như vậy), `apps/web/src/components/add-to-cart.tsx` (truyền `cartMayArrive={phase !== 'guest'}`), `apps/miniapp/src/pages/product-detail.tsx` (truyền `cartMayArrive={status !== 'idle'}`)
- Test: `apps/web/src/components/variation-sheet.spec.tsx`, `apps/miniapp/src/components/variation-sheet.spec.tsx`

**Interfaces:**
- Produces: prop tuỳ chọn `cartMayArrive?: boolean` (mặc định `true`) của `VariationSheet` ở hai app. `true` khi `GET /cart` còn có thể về (đã đăng nhập, đang khôi phục phiên, mất mạng tạm thời); `false` chỉ cho khách chắc chắn chưa đăng nhập. Chỉ đọc ở chế độ `buy`, và chốt theo giá trị lúc mở bảng (state cập nhật ngay lúc vẽ khi `open` đổi): Mini mở bảng lúc `idle`, bấm xác nhận gọi `loginWithNotice()` đưa `status` sang `loading` khi bảng còn mở, giá trị chạy theo thì dải trống 2 dòng hiện (rồi ẩn khi huỷ) dưới ngón tay.
- `reserveNote = line?.allowance != null || (mode === 'buy' && (cartMayArrive || cartLines !== undefined))`. Có suất Giờ vàng giới hạn thì vẫn giữ chỗ (câu mất giá có thể hiện, không liên quan giỏ). `cartLines !== undefined` giữ chỗ cho giỏ đã có trong cache dù phiên đang lỗi.

Chọn prop thay vì suy ra từ `cartLines`: `cartLines === undefined` không phân biệt "giỏ chưa về" với "giỏ không bao giờ về" nên không dùng được.

- [ ] **Step 1: Test đỏ.** Hai app, mỗi app thêm vào nhóm đã có "Mua ngay mở trước khi GET /cart về": (a) `mode: 'buy'`, `flash: []`, `cartLines: undefined`, `cartMayArrive: false` → không có `role=status` (`queryByRole('status')` null / `status()` null); (b) cùng cấu hình nhưng `flash: flash()` (có giới hạn Giờ vàng) → vẫn có một `role=status` có `minHeight`; (c) `cartMayArrive: false` mà `cartLines: [{ variationId: 'v1', quantity: 2 }]` → vẫn có `role=status` với câu "Giỏ đã có 2: Mua ngay thanh toán cả 3 sản phẩm."; (d) không truyền `cartMayArrive` → như L4 (có dải trống, ca cũ không đổi); (e) `mode: 'add'` không đổi. Hai spec cũ không phải sửa.
- [ ] **Step 2: Run** `cd apps/web && npx vitest run src/components/variation-sheet.spec.tsx`; `cd apps/miniapp && npx vitest run src/components/variation-sheet.spec.tsx` → FAIL ở (a).
- [ ] **Step 3: Implement** prop, `reserveNote` và hai chỗ truyền ở nơi gọi buy; sửa comment trên `reserveNote` (mỗi app): buy giữ chỗ khi giỏ còn có thể về hoặc đã có, khách chưa đăng nhập thì không có gì để nhảy nên không giữ.
- [ ] **Step 4: Run** hai spec trên cùng `add-to-cart.spec.tsx` (web), `product-detail-flash.spec.tsx` (Mini) → PASS.
- [ ] **Step 5: Commit** `fix(shop): bảng Mua ngay của khách chưa đăng nhập không giữ dải ghi chú trống, khách đã đăng nhập vẫn không nhảy (L5 2)`.

---

### Task 3: dòng tồn kho ở giỏ, một luật cho hai app

**Files:**
- Modify: `packages/app-core/src/commerce/stock-text.ts`, `apps/web/src/app/gio-hang/page.tsx:300`, `apps/miniapp/src/pages/cart.tsx:593`
- Test: `packages/app-core/src/commerce/stock-text.spec.ts`, `apps/web/src/app/gio-hang/page.spec.tsx`, `apps/miniapp/src/pages/cart.spec.tsx`

**Interfaces:**
```ts
// packages/app-core/src/commerce/stock-text.ts
export interface CartStockNote { text: string; tone: 'warning' | 'neutral' }
/** null khi tồn <= 0 (chỗ gọi có câu hết hàng riêng) hoặc quantity < stock. */
export function cartStockNote(quantity: number, stock: number): CartStockNote | null;
```
Luật: `stock <= 0` → `null`; `quantity < stock` → `null`; `quantity > stock` → `{ text: stockText(stock), tone: 'warning' }` (đang chặn thanh toán); `quantity === stock` → `{ text: stockText(stock), tone: isLowStock(stock) ? 'warning' : 'neutral' }`.

Lựa chọn (ghi vào notes): giữ dòng ở `quantity === stock` vì nó giải thích nút `+` bị khoá (BUYERWEB-10 đã có test) và Mini cùng luật, thay vì bỏ dòng; màu thường ở tồn cao để cam chỉ còn nghĩa "sắp hết hoặc đang vượt". Dòng chỉ xuất hiện khi khách vừa bấm `+` tới trần nên không đổi hàng lúc tải. Mini so bằng số lượng cục bộ (`localQty`) để dòng hiện cùng lúc nút `+` khoá.

- [ ] **Step 1: Test đỏ.** `stock-text.spec.ts`: `cartStockNote(2, 5)` null; `(5, 0)` null; `(1, 1)`, `(3, 3)`, `(5, 5)` = `{ text: 'Còn n sản phẩm', tone: 'warning' }`; `(6, 6)` và `(40, 40)` = `{ text: 'Còn 40 sản phẩm', tone: 'neutral' }`; `(50, 40)` = `{ text: 'Còn 40 sản phẩm', tone: 'warning' }`; `(3, 1)` warning. Web `page.spec.tsx` (describe BUYERWEB-10): `tồn 40, chọn 40: dòng "Còn 40 sản phẩm" có màu chữ phụ, không lớp text-warning-fg`; `tồn 2, chọn 2` (ca cũ) có `text-warning-fg`; `tồn 3, chọn 5` vẫn cam. Mini `cart.spec.tsx`: `tồn 40, SL 40`: thấy "Còn 40 sản phẩm" với `style.color` chứa `--color-text-secondary` và không có icon cảnh báo trong dòng; `tồn 3, SL 3`: màu `--color-text-warning`; `tồn 1, SL 3` (ca cũ) giữ; `tồn 40, SL 2`: không có dòng.
- [ ] **Step 2: Run** `cd packages/app-core && npx vitest run src/commerce/stock-text.spec.ts`; web và Mini hai file spec trên → FAIL.
- [ ] **Step 3: Implement** `cartStockNote`; web: `const stockNote = soldOut ? null : cartStockNote(it.quantity, it.stock)` và lớp màu theo `tone` (`text-warning-fg` hoặc `text-[color:var(--color-text-secondary)]`); Mini: thay `overStock &&` bằng `stockNote` tính từ `localQty` cho `line.stock > 0`, giữ `vi.cart.outOfStock` cho tồn 0, icon `AlertTriangle` chỉ ở `tone: 'warning'`, màu thường `var(--color-text-secondary)`.
- [ ] **Step 4: Run** ba spec trên và `cart-out-of-stock.spec.tsx`, `cart-parity.spec.tsx`, `cart-mini.spec.tsx` (web), `cart-*.spec.tsx` cạnh `cart.tsx` (Mini) → PASS; `node scripts/uiux/ds-ratchet.mjs` không tăng baseline.
- [ ] **Step 5: Commit** `fix(shop): dòng tồn kho ở giỏ một luật cho hai app, chữ thường khi tồn cao, cam chỉ khi tồn thấp hoặc đang vượt (L5 3)`.

---

### Task 4: bộ quét template xét mọi đoạn có từ hoa đứng riêng

**Files:**
- Modify: `packages/app-core/src/terminology.spec.ts` (thay `TEMPLATE_TAIL_PROSE` bằng `TEMPLATE_WORD_PROSE`, dòng 72 trong `displayStrings`)
- Test: cùng file (`displayStrings`, `findHits: chuỗi template bắt đầu bằng chữ hoa ASCII`)

**Interfaces:** `const TEMPLATE_WORD_PROSE: RegExp` (nội bộ spec) áp cho mọi `TemplateHead`/`TemplateMiddle`/`TemplateTail` (không còn điều kiện `afterExpression`). Từ đứng riêng: không đứng sau ký tự mã (`A-Za-z0-9_`, `-`, `/`, `.`) và, với chữ hoa viết tắt (≥ 2 chữ), không đứng trước ký tự mã (`A-Za-z0-9_`, `-`, `/`); bất kỳ ký tự khác (khoảng trắng, dấu câu, ngoặc, `·`, hết đoạn) đều là ranh giới. `ASCII_PROSE` giữ nguyên cho chuỗi thường và đầu template.

- [ ] **Step 1: Test đỏ.** `displayStrings` `it.each` "bắt": ``const t = `(HSD ${d})`;`` → `'(HSD'`; ``const t = `${n} HOT!`;`` → `'HOT!'`; ``const t = `${n}, HSD.`;`` → `', HSD.'`; ``const t = `${n} (HOT)`;`` → `'(HOT)'`; ``const t = `${a} · HSD\n`;`` → `'· HSD'`; ``const t = `(Top ${n})`;`` → `'(Top'`. `findHits`: bốn dạng `' HOT!'`, `', HSD.'`, `' (HOT)'`, `' · HSD\n'` ở tail cho `use` 'bỏ chữ giục mua' / 'Hạn dùng hoặc Dùng đến'; head `(HSD ${d})` cho 'Hạn dùng hoặc Dùng đến'. Ca đối chứng không hit (thêm vào nhóm "đoạn giữa/cuối chỉ là mã định danh"): `FREESHIP-${id}`, `${a}-FREESHIP`, `FREESHIP-${id}-${n}-x`, `${a}/voucher/${b}`, `${a} GET ${b}`, `${base}/HOT/${id}`, `HOT_${x}`, `${a}_HSD`, `${a}.HOT`, `${a}-HSD-${b}` đều `[]`.
- [ ] **Step 2: Run** `cd packages/app-core && npx vitest run src/terminology.spec.ts` → FAIL (các ca mới không bắt).
- [ ] **Step 3: Implement** `TEMPLATE_WORD_PROSE` theo Interfaces (lookbehind/lookahead) và sửa comment hai hằng ngay trên nó; chạy phần "mã thật" của spec: nếu bộ quét mới bắt chỗ thật trong `apps/*/src` hoặc `packages/app-core/src` thì sửa chữ ở chỗ đó (dùng chữ thay thế trong `FORBIDDEN_TERMS`, không thêm dòng `EXEMPT` mới trừ khi là chữ không đổi được, kèm lý do).
- [ ] **Step 4: Run** `pnpm --filter @tubutree/app-core test` → PASS; chạy riêng `src/terminology.spec.ts` ở `apps/api` nếu spec đó có bản ở đó (`grep -rl "FORBIDDEN_TERMS" apps/*/src`).
- [ ] **Step 5: Commit** `test(app-core): bộ quét chữ cấm xét mọi đoạn template có từ hoa đứng riêng, không bắt nhầm mã định danh (L5 4)`.

---

### Task 5: huy hiệu "CTV tuyển chọn" ở trang khách Mini dùng `Badge`

**Files:**
- Modify: `apps/miniapp/src/pages/storefront-view.tsx` (~dòng 124-146: huy hiệu vẽ tay)
- Test: `apps/miniapp/src/pages/storefront-view.spec.tsx`

**Interfaces:** dùng `<Badge tone="verified" icon={Sparkles}>{badgeLabel}</Badge>` từ `../components/ui/badge`, cùng nhãn `trustBadgeLabel(sf)` (`utils/storefront-badge.ts`, đã dùng chung với trình dựng) như trình dựng (`storefront-builder.tsx:647`) và web (`shop-page/storefront-body.tsx:114`). Bỏ `style` ghi đè và `<Sparkles size={12} />` tự vẽ.

- [ ] **Step 1: Test đỏ.** Trong nhóm test "CTV tuyển chọn" của `storefront-view.spec.tsx`: gian hàng CTV đã duyệt → `badge = screen.getByText('CTV tuyển chọn')`; `badge.querySelector('svg')` có `width="14"`, `stroke-width="1.75"`, `aria-hidden="true"`; `badge.style.background` chứa `--color-verified-bg`; `badge.style.gap` là `4px` do `Badge` đặt (không còn do trang ghi đè: kiểm `badge.getAttribute('style')` không chứa hai lần `gap`). Gian hàng chưa duyệt: `queryByText('CTV tuyển chọn')` null và không có phần tử nào có `--color-verified-bg` trong thanh huy hiệu.
- [ ] **Step 2: Run** `cd apps/miniapp && npx vitest run src/pages/storefront-view.spec.tsx` → FAIL (icon 12).
- [ ] **Step 3: Implement** thay khối `{badgeLabel && (...)}` bằng `Badge` có `icon`; kiểm `Sparkles` còn được import và dùng.
- [ ] **Step 4: Run** `storefront-view.spec.tsx`, `storefront-builder.spec.tsx`, `storefront-view-not-found.spec.tsx` → PASS.
- [ ] **Step 5: Commit** `fix(miniapp): huy hiệu CTV tuyển chọn ở trang khách dùng Badge có icon như trình dựng và web (L5 5)`.

---

### Task 6: ảnh, bánh cóc, e2e, gate, PROGRESS

- [ ] **Step 1:** dựng API giả như `handoff-wave2.md` (Vite dev Mini cổng 3571, Next dev web cổng 3572, host localhost; ẩn huy hiệu Next dev); chụp vào `docs/2026-10-31-shop-redesign/screens/L5/` (thư mục bị gitignore) mini375 và web375, trước và sau: bảng "Mua ngay" khách chưa đăng nhập (sản phẩm không Giờ vàng, không dải trống), giỏ có dòng tồn kho (tồn 40 chọn 40 chữ thường; tồn 3 chọn 3 cam), huy hiệu "CTV tuyển chọn" trang khách Mini. So hai bản 375, tắt server của mình.
- [ ] **Step 2:** `pnpm lint:parity && pnpm lint:vars`; hạ baseline thì `node scripts/uiux/ds-ratchet.mjs --write` rồi commit.
- [ ] **Step 3:** e2e Mini: `cd apps/e2e && E2E_SCOPE=miniapp E2E_MINIAPP_PORT=3571 npx playwright test tests/flash-sheet-price.miniapp.spec.ts tests/storefront*.ts tests/cart*.ts --workers=2 --reporter=line`; web (nếu chạy được trên máy): `E2E_API_PORT=3572 E2E_WEB_PORT=3573 E2E_MINIAPP_PORT=3574 bash apps/e2e/scripts/web-gate.sh tests/web-checkout.web.spec.ts tests/flash-sheet-price.web.spec.ts tests/cart-display.web.spec.ts --workers=2 --reporter=line`. Rồi `bash docs/2026-10-28-review/tools/gate.sh <worktree> --base 2e89bde51 --out /Users/longla/coding/tubutree-mini-app/.claude/worktrees/gate-L5.txt`, rồi e2e Mini đầy đủ `--workers=2`. Bước FAIL kiểm trên base (worktree tạm hoặc so log); e2e đỏ vì chữ/luật mới thì sửa test theo thiết kế và ghi notes.
- [ ] **Step 4:** thêm mục "L5" ngắn vào `PROGRESS.md`, commit.

## Self-Review

- Spec coverage: (1) Task 1; (2) Task 2; (3) Task 3; (4) Task 4; (5) Task 5; ảnh, gate Task 6.
- Tên dùng chung khớp giữa các task: `cartMayArrive`, `cartStockNote`, `CartStockNote`, `TEMPLATE_WORD_PROSE`, `focusIsFree`.
- Chọn thay chủ: dòng tồn kho ở giỏ giữ ở `quantity === stock` (giải thích nút `+` khoá), chữ thường ở tồn cao, cam khi tồn thấp hoặc đang vượt, Mini cùng luật (Mini thêm dòng này ở `quantity === stock`); `cartMayArrive` là prop tuỳ chọn mặc định `true` để nơi gọi quên truyền thì giữ hành vi L4, chỉ hai nơi gọi chế độ buy truyền theo trạng thái đăng nhập.

## Sửa sau review (vòng 2)

- MAJOR (thanh toán lg, `focusIsFree`): khung "Đơn hàng" chứa ô `#coupon-code` và ô tick Điểm Xanh nên "trong khung là tự do" vẫn giật focus khỏi hai ô đó. Chọn cách hẹp nhất: tự do chỉ khi focus ở body/null hoặc ở chính nút (cả liên kết cạnh nút cũng giữ focus, vì Enter trên liên kết là đi trang, cùng loại lỗi). Test mới ở `checkout-lg-place.spec.tsx`: ô mã giảm giá (bung tại chỗ, `#coupon-code`), ô tick Điểm Xanh, liên kết "Đổi lựa chọn", liên kết Điều khoản sát nút giữ focus; body thì nút nhận focus. Kiểm đột biến: đưa lại luật "trong khung là tự do" thì ba ca đầu đỏ.
- MINOR (Mini `cartMayArrive`): chốt giá trị lúc mở trong chính `VariationSheet` (hai app, vì web cũng có thể đổi `phase` lúc bảng mở). Test sheet hai app (đổi prop khi mở, đóng rồi mở lại lấy giá trị mới) và Mini `product-detail-flash.spec.tsx` (idle sang loading sang idle khi bảng mở không có `role=status`; loading sang idle không co lại). Kiểm đột biến: bỏ chốt thì ba ca đỏ.
