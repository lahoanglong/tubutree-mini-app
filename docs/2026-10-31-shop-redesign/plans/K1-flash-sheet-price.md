# K1 flash-sheet-price: giá Giờ vàng trong sheet chọn phân loại và nút mua Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** nút "Mua ngay", "Thêm vào giỏ" và tổng trong sheet phân loại ghi đúng số tiền máy chủ sẽ tính khi mua quá giới hạn Giờ vàng mỗi khách, và sheet nói rõ giá đang là Giờ vàng.

**Architecture:** một hàm app-core `flashLinePreview` chép đúng luật `priceFlashLine` của API (số lượng ≤ suất thì đơn giá = min(giá Giờ vàng, giá đang bán), vượt thì CẢ DÒNG giá thường); spec chạy cả hai trên cùng bộ ca. `variationLinePreview` ghép hàm đó với `variationPricing` cho một phân loại. Sheet và nút mua của hai app dùng nó; chip phân loại thành một thành phần dùng chung giữa trang chi tiết và sheet. Không đổi luật máy chủ, không chặn số lượng.

**Tech Stack:** TypeScript, vitest (app-core, Mini, web), Playwright (Mini mock API), React 18 + zmp-ui (Mini), Next 15 + Tailwind (web).

**Spec:** `docs/2026-10-31-shop-redesign/01-thiet-ke.md` (§4 là luật), nguồn việc `docs/2026-10-31-shop-redesign/review/extra-critique-2.md` P1 #1, P1 #6, P2 #1, P2 #12.

## Global Constraints

- Node: `export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH`; worktree mới cần `pnpm --filter @tubutree/shared-types build` và `npx prisma generate` (trong `apps/api`).
- Chữ qua `shop-copy` (khoá + ngân sách độ dài ở `shop-copy-budget.ts`), viết hoa "Giờ vàng", không dùng "Chỉ còn". Hết hàng ghi "Tạm hết hàng" (`stock.out` của `commerce/tile-copy.ts`).
- Giá đang giảm màu `--color-text-price-deal` (`PriceTag tone="deal"`), không đỏ. Tiêu đề khối Inter 16/700.
- Vùng chạm ≥44px, tương phản ≥4,5:1, axe 0 vi phạm ở 375px. Web dưới `md` ra cùng số đo Mini.
- Token semantic, không hex, không `var(--stone-…)`. `pnpm lint:parity` (bánh cóc px và `max-md:` theo `scripts/uiux/ds-baseline.json`) và `pnpm lint:vars` xanh; thêm px viết tay mới là đỏ.
- Không sửa: `apps/web/src/components/ui/sheet.tsx`, `flash-sale.tsx` hai app, `home-layout.ts`, `affiliate.tsx`, `ctv/page.tsx`, `checkout.tsx`, `thanh-toan/page.tsx`, `coupon-box.tsx`, `voucher-sheet.tsx`, game-wheel, brand chip.
- Không deploy, không push, không đọc/ghi PROD. Commit cuối message có `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Số lượng đúng bằng giới hạn (qty = limit) vẫn giá Giờ vàng; limit+1 thì cả dòng giá thường. Test: Task 1 (spec đối chiếu `priceFlashLine`), Task 3, 4 (nút).
2. Giá Giờ vàng cao hơn hoặc bằng giá đang bán (giá niêm yết hạ sau khi tạo đợt): đơn giá luôn là giá đang bán, không hiện ghi chú vượt giới hạn vì khách không mất gì. Test: Task 1.
3. Client không biết giới hạn (API cũ không gửi `perUserLimit`, hoặc 0): coi như không giới hạn, không ghi chú, không bịa số. Test: Task 1, Task 3.
4. Hết giờ khi khách đang mở sheet: `flash` lọc theo giờ chạy ở trang cha nên sheet về giá thường, tổng và ghi chú biến mất. Test: Task 3 (render lại với `flash=[]`).
5. Gõ tăng số lượng trong sheet không làm ô số lượng nhảy khi ghi chú vượt giới hạn hiện: ghi chú có chỗ giữ cố định khi phân loại đang Giờ vàng có giới hạn. Test: Task 3, 4 (ghi chú luôn nằm trong DOM với chiều cao cố định).

---

## File structure

| File | Việc |
|---|---|
| `packages/app-core/src/commerce/flash-line.ts` (mới) + `.spec.ts` | `flashLinePreview`, `variationLinePreview`, `flashLimitFor` |
| `packages/app-core/src/flash-price.ts` | `FlashPriceItem.perUserLimit?: number \| null` |
| `packages/app-core/src/commerce/tile-copy.ts` không đổi; `shop-copy.ts`, `shop-copy-budget.ts` | khoá `flash.sheetOverLimit` |
| `packages/app-core/src/variation-picker.ts` + spec | `pickerStockText` "Tạm hết hàng", bỏ "Chỉ còn" |
| `packages/app-core/src/terminology.spec.ts` | gỡ dòng miễn của `variation-picker.ts` |
| `apps/miniapp/src/components/product/variation-chip.tsx` (mới) | chip phân loại dùng chung PDP và sheet (dời từ `product-detail.tsx`) |
| `apps/miniapp/src/components/variation-sheet.tsx`, `pages/product-detail.tsx`, `i18n/vi.ts` | sheet, nút mua, ghi chú, chữ hết hàng |
| `apps/web/src/components/variation-chip.tsx` (mới) | như trên cho web (dời từ `add-to-cart.tsx`) |
| `apps/web/src/components/variation-sheet.tsx`, `add-to-cart.tsx` | như Mini |
| `apps/miniapp/src/components/product/pdp-bundles.tsx`, `apps/web/src/app/san-pham/[slug]/pdp-bundles.tsx` | giữ chỗ dòng "Tiết kiệm" |
| `apps/e2e/tests/flash-sheet-price.miniapp.spec.ts` (mới), `flash-sheet-price.web.spec.ts` (mới) | đo nút giá khi vượt giới hạn |
| `scripts/uiux/ds-baseline.json` | hạ/ghi nhận bánh cóc |

---

### Task 1: `flashLinePreview` khớp luật máy chủ

**Files:**
- Create: `packages/app-core/src/commerce/flash-line.ts`, `packages/app-core/src/commerce/flash-line.spec.ts`
- Modify: `packages/app-core/src/flash-price.ts` (`FlashPriceItem`)

**Interfaces:**
- Produces:
  ```ts
  export interface FlashLinePreview { unitPrice: number; total: number; overLimit: boolean }
  export function flashLinePreview(i: { standing: number; flashPrice: number | null | undefined; quantity: number; limit: number | null | undefined }): FlashLinePreview;
  export function flashLimitFor(item: { perUserLimit?: number | null } | null | undefined): number | null; // số hữu hạn > 0, ngược lại null
  export interface VariationLinePreview extends FlashLinePreview { pricing: VariationPricingResult; limit: number | null }
  export function variationLinePreview(v: { id: string; retailPrice: number; salePrice?: number | null }, flash: readonly FlashPriceItem[], quantity: number): VariationLinePreview;
  ```
  `limit` (giới hạn mỗi khách, để vẽ nhãn) và `allowance` (min với suất còn lại của đợt, để tính tiền và ghi chú) của `VariationLinePreview` chỉ có khi phân loại đang Giờ vàng (`pricing.isFlash`); `overLimit` = có giá Giờ vàng thật sự rẻ hơn giá đang bán VÀ `quantity > allowance`. `overLimitNote(line, quantity)` ra câu ghi chú đúng loại (`flash.sheetOverLimit` hoặc `flash.sheetOverQuota`).

- [ ] **Step 1: Viết spec đỏ** (`flash-line.spec.ts`): đối chiếu `priceFlashLine` bằng cách chuyển mã file API bằng `ts.transpileModule` (CommonJS, `import type` bị bỏ nên không kéo cả service) rồi chạy trên cùng bộ ca. Bộ ca (standing 35.000, flashPrice 26.000, limit 3): qty 1, 3 (= limit), 4 (limit+1), 5; không giới hạn (`limit` null/undefined/0/NaN → coi như đủ suất); flashPrice 40.000 > standing 35.000 (qty ≤ limit và qty > limit đều ra 35.000, `overLimit` false); flashPrice null (không Giờ vàng). Với mỗi ca: `flashLinePreview(...).unitPrice` bằng `priceFlashLine(standing, qty, offer).unitPrice` với `offer = { flashPrice, allowance: limit }`; `total = unitPrice * qty`; `overLimit` đúng như bảng ở Review Focus 1–2. Thêm ca `variationLinePreview`: có `perUserLimit: 3` ở item thì `limit` = 3; không có item thì `limit` null và `overLimit` false.
- [ ] **Step 2: Chạy** `cd packages/app-core && npx vitest run src/commerce/flash-line.spec.ts`. Expected: FAIL (module chưa có).
- [ ] **Step 3: Cài đặt** `flash-line.ts` theo chữ ký trên (và thêm `perUserLimit?: number | null` có comment vì sao vào `FlashPriceItem`). `unitPrice` = `flashPrice != null && limit hợp lệ && quantity > limit ? standing : Math.min(flashPrice ?? standing, standing)`.
- [ ] **Step 4: Chạy lại** Expected: PASS. Chạy `npx tsc --noEmit -p packages/app-core`.
- [ ] **Step 5: Commit** `feat(app-core): flashLinePreview chép luật priceFlashLine của máy chủ (vượt giới hạn Giờ vàng thì cả dòng giá thường)`.

### Task 2: chữ và `variation-picker`

**Files:**
- Modify: `packages/app-core/src/shop-copy.ts`, `packages/app-core/src/shop-copy-budget.ts`, `packages/app-core/src/variation-picker.ts`, `packages/app-core/src/variation-picker.spec.ts`, `packages/app-core/src/terminology.spec.ts`

**Interfaces:**
- Produces: khoá `flash.sheetOverLimit` = `'Giá Giờ vàng tối đa {n} sản phẩm mỗi khách. Mua {qty} thì cả dòng tính giá thường.'` (ngân sách 90); `pickerStockText(stock)`: `<= 0` → "Tạm hết hàng", `<= 5` → `Còn ${stock} sản phẩm`, còn lại `Còn ${stock}`.

- [ ] **Step 1: Test đỏ**: `variation-picker.spec.ts` sửa kỳ vọng (`pickerStockText(0)` = "Tạm hết hàng", `(3)` = "Còn 3 sản phẩm"); `shop-copy.spec.ts` tự kiểm khoá mới có ngân sách (chạy cả file); thêm ca `fillCopy('flash.sheetOverLimit', { n: 3, qty: 5 })` đúng câu.
- [ ] **Step 2: Chạy** `npx vitest run src/variation-picker.spec.ts src/shop-copy.spec.ts src/terminology.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Cài đặt** khoá và hàm (hết hàng lấy `fillTileCopy('stock.out')`); gỡ dòng miễn `variation-picker.ts` trong `terminology.spec.ts`.
- [ ] **Step 4: Chạy lại** Expected: PASS.
- [ ] **Step 5: Commit** `feat(app-core): chữ ghi chú vượt giới hạn Giờ vàng, "Tạm hết hàng" ở bảng chọn phân loại`.

### Task 3: Mini, chip dùng chung, sheet, nút mua

**Files:**
- Create: `apps/miniapp/src/components/product/variation-chip.tsx`, `apps/miniapp/src/components/variation-sheet.spec.tsx`
- Modify: `apps/miniapp/src/components/variation-sheet.tsx`, `apps/miniapp/src/pages/product-detail.tsx` (chip dời ra, nút `Mua ngay`, `PointsEarnLine`, ghi chú dưới Số lượng), `apps/miniapp/src/i18n/vi.ts` (`product.outOfStock` → "Tạm hết hàng")

**Interfaces:**
- Consumes: `variationLinePreview`, `flashLimitFor`, `pickerStockText` (Task 1, 2).
- Produces: `VariationChip({ variation: { name: string; stock: number }; pricing: { price: number; isFlash: boolean }; active: boolean; onClick(): void })`; hết hàng ghi `fillTileCopy('stock.out')`, Giờ vàng có icon tia chớp và chữ đọc.

- [ ] **Step 1: Test đỏ** (`variation-sheet.spec.tsx`, render `VariationSheet`): (a) phân loại Giờ vàng giá 26.000 gốc 35.000 limit 3: có nhãn "Giờ vàng" và "Tối đa 3/khách", giá màu `--color-text-price-deal`; (b) qty 3 nút ghi `Mua ngay · 78.000đ`, bấm "+" tới 5 nút ghi `Mua ngay · 175.000đ` và hiện câu `flash.sheetOverLimit` (n 3, qty 5), về 3 thì câu biến mất; (c) không có `perUserLimit` thì qty 5 ra 130.000đ và không có ghi chú; (d) chip "Combo 3 gói" hết hàng ghi "Tạm hết hàng", nút hết hàng ghi "Tạm hết hàng"; (e) render lại `flash=[]` (hết giờ) thì giá thường, không nhãn, không ghi chú. Thêm vào spec trang chi tiết (`product-detail-flash.spec.tsx`) ca nút `Mua ngay` ghi tổng đúng khi qty vượt `perUserLimit: 3`.
- [ ] **Step 2: Chạy** `cd apps/miniapp && npx vitest run src/components/variation-sheet.spec.tsx src/pages/product-detail-flash.spec.tsx`. Expected: FAIL.
- [ ] **Step 3: Cài đặt**: dời `VariationChip` sang file mới (đổi chữ hết hàng, giữ số đo chip 44px), sheet dùng chip đó; phần đầu sheet: `PriceTag tone="deal"` khi `pricing.isFlash`, hàng nhãn `Badge tone="flash"` "Giờ vàng" + `fillCopy('flash.limitShort')` (người đọc nghe `flash.limitSpoken` qua `aria-label`/chữ ẩn); nút và tổng lấy `variationLinePreview(...).total`; dưới ô Số lượng một vùng `role="status"` có chiều cao giữ chỗ (2 dòng caption) khi phân loại đang Giờ vàng có giới hạn, hiện `flash.sheetOverLimit` chỉ khi `overLimit`. `product-detail.tsx`: nút `Mua ngay` (chữ và `aria-label`) và `PointsEarnLine` dùng `variationLinePreview(selected, flashList, quantity).total`; ghi chú vượt giới hạn dưới hàng Số lượng (không giữ chỗ: chỉ đẩy phần bên dưới). Không thêm px viết tay: dùng token và khoảng cách đã có.
- [ ] **Step 4: Chạy lại** Expected: PASS; chạy cả `npx vitest run src/pages/product-detail* src/components/ds-shop-guard.spec.ts src/css`.
- [ ] **Step 5: Commit** `feat(miniapp): sheet phân loại và nút mua ghi đúng giá Giờ vàng máy chủ tính, chip dùng chung, "Tạm hết hàng"`.

### Task 4: web, cùng thay đổi

**Files:**
- Create: `apps/web/src/components/variation-chip.tsx`, `apps/web/src/components/variation-sheet.spec.tsx`
- Modify: `apps/web/src/components/variation-sheet.tsx`, `apps/web/src/components/add-to-cart.tsx`, `apps/web/src/components/add-to-cart.spec.tsx` (kỳ vọng "Hết hàng" → "Tạm hết hàng")

**Interfaces:**
- Consumes/Produces: như Task 3 (cùng tên `VariationChip`, cùng props; chip web giữ cả bố cục máy tính "tên · giá" một dòng).

- [ ] **Step 1: Test đỏ**: cùng bộ ca (a) đến (e) của Task 3 cho `VariationSheet` web; `add-to-cart.spec.tsx`: nút "Mua ngay" (`aria-label` `Mua ngay · tổng`) và nút "Thêm vào giỏ · tổng" ghi 175.000đ khi qty 5 vượt `perUserLimit: 3`, ghi chú `flash.sheetOverLimit` hiện dưới ô Số lượng.
- [ ] **Step 2: Chạy** `cd apps/web && npx vitest run src/components/variation-sheet.spec.tsx src/components/add-to-cart.spec.tsx`. Expected: FAIL.
- [ ] **Step 3: Cài đặt** như Task 3; chip dời nguyên từ `add-to-cart.tsx` (đổi chữ hết hàng), ghi chú nằm ngay sau khối Số lượng cùng `order` ở điện thoại.
- [ ] **Step 4: Chạy lại** Expected: PASS; thêm `npx vitest run src/components/ds-shop-guard.spec.ts`.
- [ ] **Step 5: Commit** `feat(web): sheet phân loại và nút mua ghi đúng giá Giờ vàng máy chủ tính, chip dùng chung, "Tạm hết hàng"`.

### Task 5: Mua kèm không đẩy nội dung khi chọn món (P2 #12)

**Files:**
- Modify: `apps/miniapp/src/components/product/pdp-bundles.tsx`, `apps/web/src/app/san-pham/[slug]/pdp-bundles.tsx`, hai spec `pdp-bundles` của hai app

- [ ] **Step 1: Test đỏ**: dòng "Tiết kiệm" (`data-testid="addon-save"`) luôn có trong DOM; chưa chọn món thì chữ rỗng nhưng cùng chiều cao `--type-caption-lh`; chọn món thì có chữ `combo.save`, bỏ chọn thì rỗng lại. Phần tử mang `aria-live="polite"`.
- [ ] **Step 2: Chạy** vitest hai file spec. Expected: FAIL.
- [ ] **Step 3: Cài đặt**: bỏ điều kiện `summary.count > 0` bao dòng; chữ rỗng khi chưa chọn; bỏ `marginTop` điều kiện của nút.
- [ ] **Step 4: Chạy lại** Expected: PASS.
- [ ] **Step 5: Commit** `fix(pdp): giữ chỗ dòng Tiết kiệm của Mua kèm, chọn món không đẩy nút 22px (hai app)`.

### Task 6: e2e, bánh cóc, ảnh, gate

**Files:**
- Create: `apps/e2e/tests/flash-sheet-price.miniapp.spec.ts`, `apps/e2e/tests/flash-sheet-price.web.spec.ts`
- Modify: `scripts/uiux/ds-baseline.json`

- [ ] **Step 1: Viết e2e** Mini (mock API: sản phẩm 2 phân loại, phân loại Giờ vàng giá 26.000 gốc 35.000 `perUserLimit` 3, "Combo 3 gói" hết hàng): mở sheet "Mua ngay", đọc chữ nút ở qty 3 (`Mua ngay · 78.000đ`), 4 (`140.000đ`), 5 (`175.000đ`), kiểm ghi chú; chip hết hàng ghi "Tạm hết hàng". Web (cùng ca, mock như `pdp-mobile.web.spec.ts`). Chạy Mini: `cd apps/e2e && E2E_SCOPE=miniapp E2E_MINIAPP_PORT=3461 npx playwright test flash-sheet-price --workers=2 --reporter=line`. Expected: PASS.
- [ ] **Step 2: Bánh cóc**: `pnpm lint:parity`; hạ được thì `node scripts/uiux/ds-ratchet.mjs --write`.
- [ ] **Step 3: Ảnh** 375px Mini và web trước/sau sheet qty 5 vào `docs/2026-10-31-shop-redesign/screens/K1/`; so hai bản.
- [ ] **Step 4: Gate** `bash docs/2026-10-28-review/tools/gate.sh <worktree> --base 62a02f232 --out /Users/longla/coding/tubutree-mini-app/.claude/worktrees/gate-K1.txt` một lần ở cuối, thêm bộ e2e Mini đầy đủ (`--workers=2`).
- [ ] **Step 5: Commit** `test(e2e): đo nút giá sheet phân loại khi vượt giới hạn Giờ vàng; baseline bánh cóc`.

## Self-review

- Spec coverage: P1 #1 (Task 1, 3, 4, 6), P1 #6 (Task 3, 4), P2 #1 (Task 2, 3, 4), P2 #12 (Task 5), ảnh trước/sau (Task 6). Không có việc API.
- Số suất client biết: `allowance` = min(giới hạn mỗi khách `perUserLimit`, suất còn lại của đợt `quota - soldCount` theo danh sách Giờ vàng đang giữ, có thể cũ vài chục giây). Client không biết phần khách đã mua (`perUserLeft` = giới hạn trừ số đã mua) và số lượng đã nằm sẵn trong giỏ: ghi ở notes. Đợt gần hết suất dùng câu riêng `flash.sheetOverQuota` ("Giờ vàng còn {n} suất…"), nhãn "Tối đa n/khách" vẫn là giới hạn của khách.
- Tên nhất quán: `flashLinePreview`, `variationLinePreview`, `flashLimitFor`, `VariationChip`, `flash.sheetOverLimit` dùng như nhau ở các task.
