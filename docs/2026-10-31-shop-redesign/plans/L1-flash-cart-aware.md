# L1 flash-cart-aware: nút mua tính theo số đã có trong giỏ, hai MINOR nhỏ của K1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** nút "Thêm vào giỏ" ghi đúng số tiền giỏ tăng thật và nút "Mua ngay" ghi đúng số dòng sẽ thanh toán khi giỏ đã có sẵn cùng phân loại (máy chủ tính giá Giờ vàng trên CẢ dòng giỏ, không riêng phần thêm); sửa hai MINOR nhỏ K1 để lại ở chip phân loại web và khối Mua kèm web.

**Architecture:** `flashLinePreview`/`variationLinePreview` của app-core nhận thêm số đã có trong giỏ (`inCart`) và trả thêm `lineTotal` (cả dòng sau khi thêm, số "Mua ngay" thanh toán) bên cạnh `total` (tiền giỏ tăng, số "Thêm vào giỏ"); spec đối chiếu `priceFlashLine` bằng cách chạy chính file API. Hai app đọc giỏ họ đã có sẵn (React Query `getCart`, khoá `useCartKey()`) và truyền `cartLines` xuống bảng chọn phân loại. Giỏ chưa tải, lỗi hoặc khách chưa đăng nhập thì `inCart = 0` (như K1), không chặn nút. Không đổi luật máy chủ, không chặn số lượng.

**Tech Stack:** TypeScript, vitest (app-core, Mini, web), Playwright (Mini mock API; web cần API thật), React 18 + zmp-ui (Mini), Next 15 + Tailwind (web).

**Spec:** `docs/2026-10-31-shop-redesign/01-thiet-ke.md` (§4 là luật); nguồn việc: MINOR reviewer để lại ở `plans/K1-flash-sheet-price.md` (mục Self-review, "số lượng đã nằm sẵn trong giỏ: ghi ở notes") và `review/extra-critique-2.md` P1 #1.

## Global Constraints

- Node: `export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH`; worktree mới cần `pnpm install --frozen-lockfile --prefer-offline`, `pnpm --filter @tubutree/shared-types build` và `npx prisma generate` (trong `apps/api`).
- Chữ qua `shop-copy` (khoá thêm đặt cạnh khoá `flash.*`, ngân sách độ dài ở `shop-copy-budget.ts`), viết hoa "Giờ vàng", không dùng "Chỉ còn", không "Top"/"Freeship".
- Giá đang giảm màu `--color-text-price-deal`, không đỏ. Vùng chạm ≥44px, tương phản ≥4,5:1, axe 0 vi phạm ở 375px. Web dưới `md` ra cùng số đo Mini.
- Token semantic, không hex, không px viết tay mới. `pnpm lint:parity` (bánh cóc px và `max-md:` theo `scripts/uiux/ds-baseline.json`, file chưa có trong baseline phải bằng 0) và `pnpm lint:vars` xanh; hạ được số thì `node scripts/uiux/ds-ratchet.mjs --write` và commit baseline.
- Không sửa (phiên khác đang làm): `apps/web/src/components/home/flash-sale.tsx`, `apps/web/src/lib/flash-boot-script.ts`, `apps/miniapp/src/components/flash-sale.tsx`, `apps/web/src/app/page.tsx`, `apps/web/src/lib/home-initial.ts`, `packages/app-core/src/home-layout.ts`; gói song song: L2 (`thanh-toan/page.tsx`, `invoice-section.tsx`, `checkout.tsx`, `voucher-picker.ts`, `pdp-extras.tsx`, `coupon-card.tsx`), K4 (chữ API, `terminology.spec`, shop-copy addon, `pickerStockText` trong `variation-picker.ts`), K5 (`cart.service`, `cart.tsx`, `gio-hang/page.tsx`), K6 (CTV), K7 (`mini.css`, bottom-sheet hai app, `ui/sheet.tsx`).
- Không deploy, không push, không đọc/ghi PROD. Máy chung tải nặng: vitest theo file khi làm, gate đầy đủ một lần ở cuối, e2e `--workers=2`. Commit cuối message có `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Sự thật về đường tiền (đã đọc code)

- Thêm giỏ là `increment` (`apps/api/src/modules/cart/cart.service.ts:393`, `addItem`), nên dòng giỏ = số có sẵn + số thêm; giỏ tính `priceFlashLine(standing, CẢ SỐ LƯỢNG DÒNG, offer)` (`flash-line-price.ts`): `quantity <= allowance` thì `min(giá Giờ vàng, giá đang bán)`, vượt thì cả dòng giá đang bán. `allowance = min(suất còn lại, giới hạn mỗi khách trừ số đã MUA)` tính theo đơn đã đặt, không theo giỏ.
- "Mua ngay" thêm giỏ rồi chọn đúng DÒNG của phân loại đó, không phải phần vừa thêm: Mini `product-detail.tsx` (`buyNowMutation.onSuccess`: `updatedCart.items.find((l) => l.variationId === variationId)` → `rememberCheckoutSelection([line.id])`, `navigate('/checkout', { state: { itemIds } })`), web `add-to-cart.tsx` (`bought = cart.items.filter((l) => l.variationId === variationId)` → `rememberCheckoutSelection(ids)`); thanh toán lọc theo `itemIds` là id dòng giỏ (`checkout.service.ts` `checkoutLines`) nên trả cả `CartItem.quantity` của dòng. Vậy "Mua ngay" thanh toán `giá dòng(có sẵn + thêm)`.
- Hệ quả hai con số: `total` (nút "Thêm vào giỏ") = `giá dòng(có sẵn + thêm) − giá dòng(có sẵn)`; `lineTotal` (nút "Mua ngay") = `giá dòng(có sẵn + thêm)`. Giá dòng không giảm khi thêm số lượng (đơn giá chỉ nhảy một chiều Giờ vàng → thường), nên `total >= 0`.

## Review Focus

1. Dòng giỏ đã vượt suất sẵn (vd giới hạn 3, giỏ có 5 đang giá thường): thêm tiếp thì `total = qty × giá thường`, `lineTotal` cả dòng giá thường, `overLimit` bật (tổng vượt) và `total` không âm. Test: Task 1 (ca "đã vượt sẵn"), Task 2/3 (ghi chú).
2. Giỏ chưa tải xong, lỗi, hoặc khách chưa đăng nhập: `inCart = 0`, nút ghi số như K1, nút không bị chặn. Test: Task 1 (`inCartQuantity(undefined, id) = 0`), Task 2 và 3 (không truyền `cartLines`).
3. Giỏ có dòng của phân loại KHÁC (cùng sản phẩm, hoặc sản phẩm khác): không tính vào số đã có; chỉ khớp theo `variationId`. Test: Task 1 (`inCartQuantity`), Task 2 (sheet).
4. Thêm giỏ thành công rồi bảng/nút vẽ lại theo giỏ mới (không đếm hai lần, không giữ số cũ): cache giỏ được cập nhật bằng `setQueryData(cartKey(), cart)` nên `inCart` tăng; kiểm lại đúng một số sau thêm. Test: Task 2 (`product-detail-flash.spec`: sau add, "Mua ngay" ghi số mới), Task 3 (`add-to-cart.spec`).
5. Không biết giới hạn (API cũ không gửi `perUserLimit`/`quota`) hoặc giá Giờ vàng ≥ giá đang bán, kèm giỏ có sẵn: không ghi chú, `total = qty × đơn giá`, `lineTotal = (inCart + qty) × đơn giá`. Test: Task 1.

---

## File structure

| File | Việc |
|---|---|
| `packages/app-core/src/commerce/flash-line.ts` + `.spec.ts` | `inCart` cho `flashLinePreview`/`variationLinePreview`, trường `lineTotal`, `lineQuantity`, `inCart`; `inCartQuantity`; `overLimitNote` có nhánh giỏ |
| `packages/app-core/src/shop-copy.ts`, `shop-copy-budget.ts` | khoá `flash.sheetOverInCart` cạnh `flash.sheetOverQuota` |
| `apps/miniapp/src/components/variation-sheet.tsx` + `.spec.tsx` | prop `cartLines`, nhãn nút theo `total`/`lineTotal` |
| `apps/miniapp/src/pages/product-detail.tsx` + `product-detail-flash.spec.tsx` | `inCart` từ `cart.data?.items`, nút Mua ngay ghi `lineTotal`, ghi chú theo giỏ |
| `apps/web/src/components/variation-sheet.tsx` + `.spec.tsx`, `add-to-cart.tsx` + `.spec.tsx` | như Mini |
| `apps/web/src/components/variation-chip.tsx` | sửa comment số đo (MINOR b) |
| `apps/web/src/app/san-pham/[slug]/pdp-bundles.tsx` + `.spec.tsx` | dòng giữ chỗ Tiết kiệm theo thang Mini (MINOR c) |
| `apps/e2e/tests/flash-sheet-price.miniapp.spec.ts`, `flash-sheet-price.web.spec.ts` | ca giỏ có sẵn; web thêm đo khối Mua kèm |
| `scripts/uiux/ds-baseline.json` | chỉ khi bánh cóc hạ |

---

### Task 1: app-core, `inCart` và nhánh ghi chú theo giỏ

**Files:**
- Modify: `packages/app-core/src/commerce/flash-line.ts`, `packages/app-core/src/commerce/flash-line.spec.ts`, `packages/app-core/src/shop-copy.ts`, `packages/app-core/src/shop-copy-budget.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface FlashLinePreview {
    unitPrice: number;      // đơn giá của CẢ dòng giỏ sau khi thêm (priceFlashLine trên inCart + quantity)
    lineQuantity: number;   // inCart + quantity
    inCart: number;         // số đã có trong giỏ, đã chuẩn hoá (hữu hạn, nguyên, >= 0)
    lineTotal: number;      // unitPrice * lineQuantity: số "Mua ngay" thanh toán
    total: number;          // lineTotal - giá dòng(inCart): số giỏ tăng, "Thêm vào giỏ"; inCart = 0 thì bằng lineTotal
    overLimit: boolean;     // có giá Giờ vàng thật sự rẻ hơn giá đang bán VÀ lineQuantity > limit
  }
  export function flashLinePreview(i: { standing: number; flashPrice: number | null | undefined; quantity: number; limit: number | null | undefined; inCart?: number | null }): FlashLinePreview;
  export function variationLinePreview(v: { id: string; retailPrice: number; salePrice?: number | null }, flash: readonly FlashPriceItem[], quantity: number, inCart?: number | null): VariationLinePreview;
  export function inCartQuantity(lines: readonly { variationId: string; quantity: number }[] | null | undefined, variationId: string): number;
  // overLimitNote(line, quantity) giữ chữ ký; line.inCart > 0 thì dùng khoá 'flash.sheetOverInCart'.
  ```
  Khoá chữ mới: `'flash.sheetOverInCart': 'Giỏ đã có {n}. Thêm {qty} thì cả {total} sản phẩm tính giá thường.'` (ngân sách 90). `n` = `inCart`, `qty` = số đang chọn, `total` = `lineQuantity`. Nhánh giỏ thay cả hai câu `sheetOverLimit` và `sheetOverQuota` (câu giỏ không nêu nguyên nhân chặn).

- [ ] **Step 1: Viết spec đỏ** trong `flash-line.spec.ts`, cùng bộ `server = loadServerRule()` và `STANDING 35.000`, `FLASH 26.000`, `LIMIT 3`:
  - `describe('flashLinePreview với số đã có trong giỏ khớp priceFlashLine')`, `it.each`, mỗi ca so `unitPrice` với `server(STANDING, inCart + quantity, offer).unitPrice`, `lineTotal` với `unitPrice * (inCart + quantity)`, `total` với `lineTotal - server(STANDING, inCart, offer).unitPrice * inCart`, và `overLimit`:
    - `inCart 0, qty 2` → `total 52.000`, `lineTotal 52.000`, `overLimit false` (không đổi so với K1)
    - `inCart 1, qty 2` (tổng = limit) → `unitPrice 26.000`, `lineTotal 78.000`, `total 52.000`, `overLimit false`
    - `inCart 2, qty 2` (tổng = limit + 1, ví dụ của reviewer) → `unitPrice 35.000`, `lineTotal 140.000`, `total 88.000`, `overLimit true`
    - `inCart 3, qty 1` (giỏ đang đúng limit, thêm 1) → `lineTotal 140.000`, `total 62.000`, `overLimit true`
    - `inCart 5, qty 2` (đã vượt sẵn) → `lineTotal 245.000`, `total 70.000`, `overLimit true`
    - `limit null, inCart 2, qty 5` → `lineTotal 182.000`, `total 130.000`, `overLimit false`
    - `flashPrice 40.000 (>= giá bán), inCart 2, qty 5, limit 3` → `unitPrice 35.000`, `lineTotal 245.000`, `total 175.000`, `overLimit false`
    - `flashPrice null, inCart 2, qty 1` → `total 35.000`
  - `it('inCart không hợp lệ (undefined, null, NaN, -2, Infinity) coi là 0; số lẻ lấy phần nguyên')`: `inCart 2.9` cho cùng kết quả `inCart 2`.
  - `describe('variationLinePreview với inCart')`: ví dụ reviewer qua `variationLinePreview({ id: 'v1', retailPrice: 35.000 }, flash(perUserLimit 3), 2, 2)` → `{ inCart: 2, lineQuantity: 4, lineTotal: 140.000, total: 88.000, overLimit: true, allowance: 3, allowanceBy: 'perUser' }`; đợt gần hết suất (`quota 10, soldCount 8, perUserLimit 5`, `inCart 1, qty 1`) → `lineQuantity 2` bằng `allowance 2` thì `overLimit false`, `inCart 1, qty 2` thì `overLimit true`, `allowanceBy 'quota'`; không có suất Giờ vàng (`flash = []`) với `inCart 3, qty 2` → `total = lineTotal - 3 × 35.000 = 70.000`, `overLimit false`.
  - `describe('inCartQuantity')`: `[{variationId:'v1',quantity:2},{variationId:'v2',quantity:4}]` với `'v1'` → 2, `'v3'` → 0, `undefined`/`null`/`[]` → 0; dòng `quantity` NaN hoặc âm không tính.
  - `describe('overLimitNote với giỏ có sẵn')`: ví dụ reviewer ra đúng `'Giỏ đã có 2. Thêm 2 thì cả 4 sản phẩm tính giá thường.'`; `inCart 0` vẫn ra câu cũ `'Giá Giờ vàng tối đa 3 sản phẩm mỗi khách. Mua 5 thì cả dòng tính giá thường.'`; vượt do suất đợt (`allowanceBy 'quota'`) kèm `inCart 1` vẫn ra câu giỏ; trong giới hạn (`inCart 1, qty 2`, limit 3) → `null`; không có ghi chú chứa "Chỉ còn" hay "giờ vàng" viết thường.
- [ ] **Step 2: Chạy** `cd packages/app-core && npx vitest run src/commerce/flash-line.spec.ts src/shop-copy.spec.ts`. Expected: FAIL (tham số/hàm/khoá chưa có).
- [ ] **Step 3: Cài đặt** theo chữ ký. Hàm chuẩn hoá `inCart`: hữu hạn thì `Math.max(0, Math.floor(n))`, còn lại 0. `flashLinePreview` tính `lineQuantity`, `unitPrice` theo luật hiện có trên `lineQuantity`; đơn giá dòng có sẵn tính cùng luật trên `inCart` (khi `inCart > 0`), `total = lineTotal - existingUnit * inCart`; `overLimit = hasDeal && limit !== null && lineQuantity > limit`. Comment (tiếng Việt, vì sao): thêm giỏ là increment nên máy chủ giá cả dòng; "Mua ngay" chọn cả dòng; `total` không âm. `variationLinePreview` truyền `inCart` xuống. Thêm khoá và ngân sách cạnh `flash.sheetOverQuota`.
- [ ] **Step 4: Chạy lại** Expected: PASS; `npx tsc --noEmit -p packages/app-core`; `npx vitest run src/commerce src/terminology.spec.ts` (kiểm chữ mới qua thuật ngữ cấm).
- [ ] **Step 5: Commit** `feat(app-core): giá Giờ vàng tính theo số đã có trong giỏ (total giỏ tăng, lineTotal cả dòng), ghi chú giỏ đã có`.

### Task 2: Mini, bảng chọn phân loại và trang sản phẩm

**Files:**
- Modify: `apps/miniapp/src/components/variation-sheet.tsx`, `apps/miniapp/src/components/variation-sheet.spec.tsx`, `apps/miniapp/src/pages/product-detail.tsx`, `apps/miniapp/src/pages/product-detail-flash.spec.tsx`

**Interfaces:**
- Consumes: `variationLinePreview(v, flash, qty, inCart)`, `inCartQuantity`, `overLimitNote` (Task 1).
- Produces: `VariationSheet` thêm prop tùy chọn `cartLines?: readonly { variationId: string; quantity: number }[]` (không truyền = giỏ rỗng). Nút bảng: `mode === 'buy'` ghi `Mua ngay · ${formatVnd(line.lineTotal)}`, `mode === 'add'` ghi `Thêm vào giỏ · ${formatVnd(line.total)}`.

- [ ] **Step 1: Test đỏ**:
  - `variation-sheet.spec.tsx` (`renderSheet` nhận thêm `cartLines`), `describe('giỏ đã có sẵn cùng phân loại')`: `cartLines [{variationId:'v1',quantity:2}]`, `initialQty 2`, Giờ vàng 26.000/gốc 35.000/limit 3: mode `buy` nút ghi `Mua ngay · 140.000đ`; mode `add` ghi `Thêm vào giỏ · 88.000đ`; vùng `role=status` ghi `Giỏ đã có 2. Thêm 2 thì cả 4 sản phẩm tính giá thường.`; bấm "−" về qty 1 thì `Mua ngay · 78.000đ` và `status` rỗng; `cartLines` của phân loại khác (`v3`) không đổi gì so với không có giỏ (nút `Mua ngay · 52.000đ`, qty 2); không truyền `cartLines` ra số K1; chiều cao vùng ghi chú giữ nguyên khi chữ hiện (so `getBoundingClientRect` không dùng được ở jsdom nên kiểm `style.minHeight` vẫn có từ lúc mở).
  - `product-detail-flash.spec.tsx`: giỏ mock có dòng `variationId` của phân loại Giờ vàng `quantity 2` (đăng nhập), `perUserLimit 3`, chọn qty 2 trên trang: nút `Mua ngay` có `aria-label` `Mua ngay · 140.000đ` và hiện câu giỏ dưới hàng Số lượng; sau khi thêm giỏ thành công (mock `POST /cart/items` trả giỏ mới có dòng `quantity 4`) nút vẽ lại theo giỏ mới (qty 1 → `lineQuantity 5`, `aria-label` `Mua ngay · 175.000đ`); khách chưa đăng nhập (giỏ không tải) ra số K1.
- [ ] **Step 2: Chạy** `cd apps/miniapp && npx vitest run src/components/variation-sheet.spec.tsx src/pages/product-detail-flash.spec.tsx`. Expected: FAIL.
- [ ] **Step 3: Cài đặt**: `VariationSheet` thêm prop, gọi `variationLinePreview(selected, flash, shownQty, inCartQuantity(cartLines, selected.id))`, nhãn nút theo `mode` như Interfaces; `product-detail.tsx` tính `inCart = selected ? inCartQuantity(cart.data?.items, selected.id) : 0`, truyền vào `variationLinePreview`, nút `Mua ngay` (chữ `formatVnd` và `aria-label`) dùng `line.lineTotal`, truyền `cartLines={cart.data?.items}` cho `VariationSheet`; dòng `{ total: price * quantity, overLimit: false, ... }` dự phòng khi chưa chọn phân loại thêm `lineTotal`. `PointsEarnLine goods` giữ `line.total` (giá trị phần đang chọn thêm, cùng nghĩa với "Thêm vào giỏ"). Không thêm px viết tay.
- [ ] **Step 4: Chạy lại** Expected: PASS; chạy cả `npx vitest run src/pages/product-detail src/components/variation-sheet.spec.tsx src/components/ds-shop-guard.spec.ts`.
- [ ] **Step 5: Commit** `feat(miniapp): nút Thêm vào giỏ và Mua ngay ghi theo số đã có trong giỏ (cả dòng tính giá Giờ vàng một lần)`.

### Task 3: web, cùng thay đổi

**Files:**
- Modify: `apps/web/src/components/variation-sheet.tsx`, `apps/web/src/components/variation-sheet.spec.tsx`, `apps/web/src/components/add-to-cart.tsx`, `apps/web/src/components/add-to-cart.spec.tsx`

**Interfaces:**
- Consumes/Produces: như Task 2 (cùng tên prop `cartLines`, cùng nhãn nút).

- [ ] **Step 1: Test đỏ**: cùng bộ ca của Task 2 cho `VariationSheet` web; `add-to-cart.spec.tsx` với giỏ đã đăng nhập có dòng phân loại Giờ vàng `quantity 2` (`perUserLimit 3`, qty 2): nút máy tính `Thêm vào giỏ · 88.000đ`, nút `Mua ngay` ở thanh dưới có `aria-label` `Mua ngay · 140.000đ`, `[data-section="pdp-flash-limit"]` ghi câu giỏ; sau add thành công vẽ lại theo giỏ mới; chưa đăng nhập hoặc giỏ lỗi ra số K1 và không chặn nút.
- [ ] **Step 2: Chạy** `cd apps/web && npx vitest run src/components/variation-sheet.spec.tsx src/components/add-to-cart.spec.tsx`. Expected: FAIL.
- [ ] **Step 3: Cài đặt**: `add-to-cart.tsx` đã có `useQuery({ queryKey: useCartKey(), queryFn: getCart, enabled: phase === 'authenticated' })` cho `cartCount`: giữ một truy vấn, lấy cả `data?.items`. `inCart = selected ? inCartQuantity(cartQ.data?.items, selected.id) : 0` vào `variationLinePreview`; tách `addTotal = formatVnd(line?.total ?? 0)` (nhãn `Thêm vào giỏ · …` ở md) và `buyTotal = formatVnd(line?.lineTotal ?? 0)` (dòng giá và `aria-label` của `Mua ngay` ở thanh dưới); truyền `cartLines={cartQ.data?.items}` cho `VariationSheet`; web `variation-sheet.tsx` như Mini.
- [ ] **Step 4: Chạy lại** Expected: PASS; thêm `npx vitest run src/components/ds-shop-guard.spec.ts`.
- [ ] **Step 5: Commit** `feat(web): nút Thêm vào giỏ và Mua ngay ghi theo số đã có trong giỏ (cùng Mini)`.

### Task 4: hai MINOR nhỏ của K1 (comment chip, giữ chỗ Tiết kiệm web)

**Files:**
- Modify: `apps/web/src/components/variation-chip.tsx` (comment dòng 19), `apps/web/src/app/san-pham/[slug]/pdp-bundles.tsx` (dòng 198), `apps/web/src/app/san-pham/[slug]/pdp-bundles.spec.tsx`

- [ ] **Step 1: Test đỏ** (`pdp-bundles.spec.tsx`, cạnh ca `addon-save` đã có): phần tử `[data-testid="addon-save"]` luôn có trong DOM, mang đúng chuỗi lớp `phoneCaption` (`max-md:text-[length:var(--type-caption-size)]`, `max-md:leading-[var(--type-caption-lh)]`) để dưới `md` là chữ 13/20px như `Text variant="caption"` của Mini, và `min-h-5` (20px) dưới `md`, `md:min-h-4` (16px) từ `md`, không còn `min-h-4` trần; chữ vẫn rỗng khi chưa chọn món.
- [ ] **Step 2: Chạy** `cd apps/web && npx vitest run "src/app/san-pham/[slug]/pdp-bundles.spec.tsx"`. Expected: FAIL.
- [ ] **Step 3: Cài đặt**: `pdp-bundles.tsx` import `phoneCaption` từ `@/lib/phone-ui`, lớp `mb-2 mt-1 min-h-5 text-xs font-semibold tabular-nums … ${phoneCaption} md:min-h-4` (không viết `max-md:` mới trong file: file chưa có trong baseline `maxMd` nên phải bằng 0; `min-h-5` không phải px viết tay). `variation-chip.tsx`: câu "nên chip cao 61px ở cả hai app" thành nói cấu trúc: hai dòng (tên 14px/dòng 22px, giá 13px/dòng 20px như Mini), đệm dọc, viền 1,5px, nên chip cùng chiều cao ở hai app; không ghi số tuyệt đối vì viền 1,5px làm tròn theo mật độ điểm ảnh (như `tests/support/variation-chip.ts` đã ghi).
- [ ] **Step 4: Chạy lại** Expected: PASS; `npx vitest run src/components/ds-shop-guard.spec.ts`; từ gốc `pnpm lint:parity`.
- [ ] **Step 5: Commit** `fix(web): dòng giữ chỗ Tiết kiệm của Mua kèm theo thang Mini ở 375, sửa comment số đo chip phân loại`.

### Task 5: e2e, bánh cóc, ảnh, gate

**Files:**
- Modify: `apps/e2e/tests/flash-sheet-price.miniapp.spec.ts`, `apps/e2e/tests/flash-sheet-price.web.spec.ts`, `scripts/uiux/ds-baseline.json` (chỉ khi hạ)
- Output ngoài git: `docs/2026-10-31-shop-redesign/screens/L1/` (thư mục bị gitignore)

- [ ] **Step 1: e2e Mini** (`mockPage` thêm `api.get('/cart', …)` có dòng `variationId: 'var-1'` `quantity: 2`, giữ `PILOT_CART` làm khuôn): ca "giỏ đã có 2 gói var-1, giới hạn 3": mở bảng "Mua ngay", qty 2 → nút `Mua ngay · 140.000đ` và `status` ghi `Giỏ đã có 2. Thêm 2 thì cả 4 sản phẩm tính giá thường.`; đổi sang "Thêm vào giỏ" → nút `Thêm vào giỏ · 88.000đ`; qty 1 → `Mua ngay · 78.000đ`, ô Số lượng không nhảy quá 1px khi ghi chú hiện. Chạy `cd apps/e2e && E2E_SCOPE=miniapp E2E_MINIAPP_PORT=3531 npx playwright test tests/flash-sheet-price.miniapp.spec.ts --workers=2 --reporter=line`. Expected: PASS.
- [ ] **Step 2: e2e web** (cùng ca, đăng nhập giả `tubu_web_session` + `/auth/refresh` + `/me` và mock `GET /cart`; số tiền dùng `standing` và `FLASH_PRICE` của spec. Khối Mua kèm KHÔNG đo ở web: bộ mua kèm do máy chủ dựng sẵn từ DB thật nên mock trình duyệt không chen vào được; chiều cao 20px của `addon-save` đo ở Mini (`bundles.miniapp.spec.ts`), web khoá bằng lớp trong `pdp-bundles.spec.tsx`): chạy `E2E_API_PORT=3532 E2E_WEB_PORT=3533 E2E_MINIAPP_PORT=3534 bash apps/e2e/scripts/web-gate.sh tests/flash-sheet-price.web.spec.ts tests/pdp-mobile.web.spec.ts --workers=2 --reporter=line` (cần Docker; spec web `flash-sheet-price` chưa từng chạy cục bộ: chạy thật, nếu skip hay không chạy được thì ghi lý do và cách CI chạy vào notes).
- [ ] **Step 3: Bánh cóc**: `pnpm lint:parity`, `pnpm lint:vars`; hạ được số thì `node scripts/uiux/ds-ratchet.mjs --write`.
- [ ] **Step 4: Ảnh** 375px Mini (Vite dev cổng 3531) và web (Next dev cổng 3532, host localhost) của bảng "Mua ngay" khi giỏ có sẵn 2 gói và qty 2: `mini375-...png`, `web375-...png` vào `screens/L1/`; so hai bản (nút, ghi chú, chip); tắt server của mình khi xong.
- [ ] **Step 5: Gate** từ worktree: `bash docs/2026-10-28-review/tools/gate.sh /Users/longla/coding/tubutree-mini-app/.claude/worktrees/shop-L1 --base 4e95a0055 --out /Users/longla/coding/tubutree-mini-app/.claude/worktrees/gate-L1.txt`, một lần ở cuối; rồi bộ e2e Mini đầy đủ `cd apps/e2e && E2E_SCOPE=miniapp E2E_MINIAPP_PORT=3531 npx playwright test --workers=2 --reporter=line`. Bước FAIL phải so với base (worktree tạm hoặc log) để ghi "có sẵn".
- [ ] **Step 6: Commit** `test(e2e): nút giá khi giỏ đã có sẵn cùng phân loại (Mini, web); baseline bánh cóc nếu hạ`.

## Self-review

- Spec coverage: (a) nút theo giỏ, `Mua ngay` theo cả dòng, ghi chú qua shop-copy, giỏ lỗi coi rỗng: Task 1–3, 5; (b) comment chip: Task 4; (c) giữ chỗ Tiết kiệm theo thang Mini: Task 4; kiểm vitest và e2e theo danh sách của gói: Task 1–5; ảnh 375: Task 5.
- Tên nhất quán: `inCart`, `cartLines`, `inCartQuantity`, `lineTotal`, `lineQuantity`, `total`, `flash.sheetOverInCart` dùng như nhau ở các task.
- Lệch kế hoạch khi làm: `shop-copy.spec.ts` thêm biến `total` vào bảng giá trị xấu nhất (khoá mới có `{total}`); ca e2e web đo Mua kèm bỏ như trên.
- Chủ ý bỏ ngoài phạm vi (ghi notes): server tính `allowance` theo số ĐÃ MUA qua đơn nên client vẫn không biết `perUserLeft`; thêm giỏ vượt tồn kho khi cộng số có sẵn (`assertStock(currentQty + addQty)`) vẫn do máy chủ báo lỗi; trong chế độ "Mua ngay" với giỏ có sẵn nhưng chưa vượt suất, nút ghi số cả dòng mà chưa có chữ báo "thanh toán gộp" trước khi bấm (Mini có `mergeNote` sau khi bấm).
