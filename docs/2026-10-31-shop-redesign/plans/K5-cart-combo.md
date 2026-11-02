# K5 `cart-combo` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Giỏ gom các món của một combo dưới đầu nhóm "Combo: {tên} · Tiết kiệm {số}", báo trước khi khách bỏ món làm bộ mất giảm, ở Mini App và web 375px giống nhau; API giỏ trả danh sách combo đã khớp lấy đúng từ lần khớp đang tính `comboDiscount`.

**Architecture:** Hai bộ khớp combo hiện có (combo gian hàng `allocateComboDiscounts`, bundle toàn sàn `allocateBundleDiscounts`) gộp "mỗi dòng lấy khoản lớn nhất" bằng `mergeMaxPerLine`. Gói này thêm bản "có chủ" của đúng các hàm đó (`OwnedDiscount` = `perLine` + `owner[variationId]` là bộ giữ khoản lớn nhất) và cho bản cũ gọi bản mới rồi bỏ `owner`, nên chỉ còn MỘT cài đặt tính tiền; nhóm combo của giỏ là `perLine` gộp theo `owner`, nên tổng giảm các nhóm bằng `comboDiscount` theo cấu trúc. Số khách trả không đổi. app-core giữ logic chia dòng giỏ thành khối combo + dòng lẻ và câu báo bỏ món; hai app chỉ vẽ.

**Tech Stack:** NestJS + Prisma + jest (API), TypeScript, vitest (app-core, Mini, web), React 18 + zmp-ui (Mini), Next 15 + Tailwind (web), Playwright.

**Spec:** `docs/2026-10-31-shop-redesign/01-thiet-ke.md` (§3 đường tiền, §4 Q4/Q15 là luật), `review/extra-critique-2.md` P1 #10 (ảnh `screens/extra2/pairs/cart-combo__returning__pair__p1.png`, `p2.png`), `plans/P15-bundles.md`, `plans/G2-cart-display.md`, `plans/handoff-wave6.md`.

## Global Constraints

- Node: `export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH` cho mọi lệnh; worktree mới đã chạy `pnpm install --frozen-lockfile --offline`, `pnpm --filter @tubutree/shared-types build`, `cd apps/api && npx prisma generate`. Đổi `packages/shared-types` thì build lại trước khi chạy tsc/jest.
- ĐƯỜNG TIỀN: `comboDiscount`, `perLine` của combo, `subtotal`, `discount`, `tierDiscount`, báo giá, đặt đơn KHÔNG đổi một đồng. Mọi spec cũ của `combo.service`, `bundle-rules`, `cart.service`, race `cart-combo-equals-quote`, `bundle-price-parity` giữ nguyên và xanh. Gói đụng tiền: race suite liên quan chạy trên Postgres riêng (`pg-native.sh start 25575`, DB `tubutree_it`).
- Thứ tự giảm Giờ vàng → combo → mã → hạng → điểm; dòng Giờ vàng không nhận combo và không tính vào điều kiện đủ bộ; hàng đối tác bị loại khỏi combo (luật hiện có, không đổi).
- Chữ qua `shop-copy.ts` (`fillCopy`) kèm ngân sách ở `shop-copy-budget.ts`; không "Freeship", "Voucher", "Top", "Vui lòng", không dấu chấm than. Chữ mới chỉ thêm khoá `cart.combo*` (gộp tay với K4 khi merge).
- Giá giảm/Tiết kiệm màu `--color-text-price-deal`; không đỏ. Chỉ token: không hex, không `var(--stone-…)`, không `fontSize` số, không thêm px viết tay (`pnpm lint:parity` bánh cóc `ds-baseline.json`), không thêm `max-md:` (web viết lớp cho md trở lên bằng `md:`/không tiền tố; điện thoại là mặc định).
- Mini ↔ web cùng khuôn: web 375px phải ra cùng bố cục và số đo với Mini (`tests/ds-parity.shop.spec.ts`, ảnh 375px cặp đôi).
- Vùng chạm ≥44px, tương phản ≥4,5:1, axe 0 vi phạm ở 375px màn giỏ; nút mới vào `hit-target-guard.spec.tsx` (Mini) nếu là nút ngoài `Button`/`IconButton`.
- Không sửa file của gói khác: `flash-sale.tsx`, `flash-boot-script.ts`, `home-layout.ts` (9b); `variation-sheet.tsx`, `add-to-cart.tsx`, `variation-picker.ts`, `pdp-bundles.tsx`, `commerce/flash-line.ts` (K1); `thanh-toan/page.tsx`, `checkout.tsx` (K2); voucher/coupon/offers (K3); `terminology.spec.ts`, `coupon-notice.ts`, `flash-line-price.ts` (K4); tier-badge, storefront-builder, milestone (K6); `mini.css .mini-sheet-*`, `bottom-sheet.tsx`, `ui/sheet.tsx` (K7). Chỉ IMPORT `ConfirmSheet`/`Sheet`/`BottomSheet`.
- Không deploy, không đọc/ghi PROD, không push, không `git stash` trần. Comment chỉ giải thích "vì sao" (tiếng Việt). Máy thiếu RAM: chạy test theo file; gate đầy đủ một lần ở cuối; e2e `--workers=2`.

## Review Focus

1. Tổng giảm của các nhóm ≠ `comboDiscount` (làm lệch dòng "Giảm giá combo" ở chân): mỗi ca của Task 2/3 khẳng định `Σ groups.discount === total`, gồm một món thuộc hai combo (lấy % cao nhất, chỉ một chủ), số lượng lẻ (floor, `maxQty`), combo khớp một phần (thiếu một sản phẩm thì không có nhóm), bộ của nhân viên bị kẹp trần.
2. Khách bỏ món KHÓA của bộ (sản phẩm duy nhất của mục, hoặc sản phẩm chính của "mua kèm" không nằm trong nhóm) mà không được báo: Task 2 `keyVariationIds`, Task 5 `comboRemovalNotice`, Task 7/8 nhấn thùng rác ra hộp xác nhận. Món của bộ có hai phân loại: bỏ một phân loại không báo (bộ vẫn khớp).
3. Chọn một phần giỏ (bỏ chọn một món khóa): tiêu đề nhóm không ghi "Tiết kiệm" sai; giá phần chọn của máy chủ (`GET /cart?itemIds=`) vẫn là nguồn của dòng ở chân. Task 5 `cartComboBlocks` + Task 7 vitest.
4. Giỏ cũ/API cũ không có `comboGroups`, hoặc nhóm tham chiếu dòng không còn (sửa optimistic): giỏ vẫn vẽ như trước, không crash, không dòng nào bị mất hay vẽ hai lần. Task 5 (mỗi dòng đúng một chỗ), Task 6 `recompute`.
5. Tiêu đề nhóm dài (tên combo tiếng Việt có dấu, số 9 chữ số) ở 320–375px: xuống dòng, không tràn ngang, không che nút. Task 9 e2e đo `scrollWidth`.

---

## File Structure

| File | Việc |
|---|---|
| `packages/shared-types/src/cart.ts` | `CartComboKind`, `CartComboGroup` (T1) |
| `apps/api/src/modules/bundles/bundle-rules.ts` + spec | `OwnedDiscount`, `mergeMaxOwned`, bản `Owned` của allocate/capped/clamp, `bundleKeyVariationIds`; bản cũ gọi bản mới (T1) |
| `apps/api/src/modules/bundles/bundle-read.ts` | `LIVE_SELECT` thêm `title`, `LiveBundle.title` (T1) |
| `apps/api/src/modules/storefront/combo.service.ts` + spec | `allocateComboDiscountsOwned`, `ComboGroup`, `buildComboGroups`, `computeWithGroups` (T2) |
| `apps/api/src/modules/cart/cart.service.ts` + spec | `comboGroups` trong `priceCart` (T3) |
| `apps/api/test/integration-race/cart-combo-equals-quote.race-spec.ts` | khẳng định nhóm = `comboDiscount` = báo giá, DB thật (T4) |
| `packages/app-core/src/api/cart.ts`, `commerce/cart-combo.ts` (mới) + spec, `shop-copy.ts`, `shop-copy-budget.ts` | kiểu, chia khối, câu báo bỏ món, chữ (T5) |
| `apps/miniapp/src/services/shop-api.ts`, `apps/web/src/lib/shop-client.ts`, `apps/miniapp/src/utils/cart-rules.ts` + spec | kiểu client, `recompute` giữ nhóm (T6) |
| `apps/miniapp/src/pages/cart.tsx` + `cart.spec.tsx` | khối combo + `ConfirmSheet` (T7) |
| `apps/web/src/app/gio-hang/page.tsx` + spec | khối combo + hộp xác nhận (T8) |
| `apps/e2e/tests/support/cart-combo-mocks.ts` (mới), `cart-combo.miniapp.spec.ts`, `cart-combo.web.spec.ts` (mới), `a11y-shop.*.spec.ts` | giỏ có combo, đo 375px, axe (T9) |
| `DESIGN.md` | dòng nhật ký + mô tả khối combo ở giỏ (T10) |

---

### Task 1: Khớp combo bundle "có chủ" (cùng một cài đặt, thêm `owner`)

**Files:**
- Modify: `apps/api/src/modules/bundles/bundle-rules.ts`, `apps/api/src/modules/bundles/bundle-read.ts`, `packages/shared-types/src/cart.ts`
- Test: `apps/api/src/modules/bundles/bundle-rules.spec.ts`

**Interfaces:**
- Produces (bundle-rules.ts):
  - `interface OwnedDiscount extends BundleDiscount { owner: Record<string, string> }` — `owner[variationId]` là id nguồn giữ khoản giảm lớn nhất của dòng đó; chỉ có key cho dòng có `perLine > 0`.
  - `mergeMaxOwned(a: OwnedDiscount, b: OwnedDiscount): OwnedDiscount` — như `mergeMaxPerLine` (mỗi dòng lấy lớn nhất, `total` tính lại từ `perLine`); bằng nhau thì `a` giữ.
  - `allocateBundleDiscountsOwned(bundles: readonly LiveBundle[], lines: readonly BundleLine[], maxPct: number): OwnedDiscount` — owner là `bundle:${b.id}`; bộ trước thắng khi bằng nhau.
  - `allocateBundleDiscountsCappedOwned(bundles, lines, maxPct, cap: StaffBundleCap): OwnedDiscount` — cùng luật trần nhân viên của `allocateBundleDiscountsCapped`; dòng bị cắt về 0 mất `owner`.
  - `bundleKeyVariationIds(b: LiveBundle, lines: readonly BundleLine[]): string[]` — phân loại mà bỏ MỘT mình nó thì bộ không còn khớp: BUNDLE_PCT = dòng duy nhất của một mục (`matching(...)` có đúng 1 dòng); ADDON = dòng duy nhất của sản phẩm chính (`anchorProductId`). Bộ không khớp giỏ thì `[]`. Đã sắp tăng dần.
  - `allocateBundleDiscounts` và `allocateBundleDiscountsCapped` giữ chữ ký và kết quả, thân chỉ gọi bản `Owned` rồi trả `{ total, perLine }`. `mergeMaxPerLine` giữ nguyên.
  - `LiveBundle.title?: string`; `loadLiveBundles` chọn `title`.
- Produces (shared-types `cart.ts`): `type CartComboKind = 'STOREFRONT' | 'BUNDLE_PCT' | 'ADDON'`; `interface CartComboGroup { id: string; kind: CartComboKind; title: string; discount: number; lineIds: string[]; keyLineIds: string[] }`.

- [ ] **Step 1: test đỏ** trong `bundle-rules.spec.ts`, khối `describe('khớp có chủ (K5)')`:
  - `mergeMaxOwned` với hai nguồn cùng dòng: chủ là nguồn lớn hơn; bằng nhau thì `a`; `total` = tổng `perLine`.
  - Bảng `it.each` ≥6 ca (BUNDLE_PCT hai mục; một món hai bộ với % khác; ADDON; số lượng 3 với `maxQty` 1; hai phân loại cùng sản phẩm; bộ khớp một phần): `allocateBundleDiscountsOwned(...)` có `{ total, perLine }` `toEqual` đúng kết quả của `allocateBundleDiscounts` cùng đầu vào, mọi key `perLine` có `owner`, không key thừa.
  - `allocateBundleDiscountsCappedOwned` với bộ nhân viên vượt trần 10.000: `perLine/total` bằng `allocateBundleDiscountsCapped`; dòng bị cắt về 0 không có `owner`.
  - `bundleKeyVariationIds`: BUNDLE_PCT [A: 1 dòng v1; B: 2 dòng v2a, v2b] → `['v1']`; ADDON có sản phẩm chính 1 dòng → `[vAnchor]` (dòng này không có trong `perLine`); bộ thiếu một mục → `[]`.
- [ ] **Step 2: chạy FAIL**: `cd apps/api && npx jest src/modules/bundles/bundle-rules.spec.ts` → "is not a function" / không export.
- [ ] **Step 3: cài** các hàm trên trong `bundle-rules.ts`: `allocateBundleDiscountsOwned` lặp bộ, gán `owner` bằng `bundle:${id}` cho mọi dòng của kết quả riêng của bộ (`percentBundle`/`addonBundle` sẵn có) rồi `mergeMaxOwned`; `…CappedOwned` tách nhân viên/ADMIN như bản cũ, kẹp bằng `clampDiscountTotal` (sẵn có) rồi lọc `owner` theo key còn lại; viết lại hai hàm cũ gọi bản `Owned`. Thêm `title` vào `LIVE_SELECT` và phần map của `loadLiveBundles`.
- [ ] **Step 4: chạy PASS** `npx jest src/modules/bundles` (toàn bộ spec bundle, gồm spec cũ không sửa), rồi `cd ../.. && pnpm --filter @tubutree/shared-types build`.
- [ ] **Step 5: Commit** `feat(api): khớp bundle có chủ (OwnedDiscount) cho nhóm combo của giỏ, bản cũ gọi bản mới (K5)`

---

### Task 2: `ComboService.computeWithGroups`: nhóm combo từ cùng lần khớp

**Files:**
- Modify: `apps/api/src/modules/storefront/combo.service.ts`
- Test: `apps/api/src/modules/storefront/combo.service.spec.ts`

**Interfaces:**
- Consumes: Task 1 (`OwnedDiscount`, `mergeMaxOwned`, `allocateBundleDiscountsOwned`, `allocateBundleDiscountsCappedOwned`, `bundleKeyVariationIds`).
- Produces:
  - `interface ComboGroup { id: string; kind: 'STOREFRONT' | 'BUNDLE_PCT' | 'ADDON'; title: string; discount: number; variationIds: string[]; keyVariationIds: string[] }` — `id` là `collection:<id>` hoặc `bundle:<id>`; `variationIds` là phân loại mang khoản giảm của nhóm (sắp tăng dần).
  - `interface ComboMatch extends ComboResult { groups: ComboGroup[] }` — nhóm sắp theo `id`; `Σ groups.discount === total`.
  - `allocateComboDiscountsOwned(combos: { id: string; pct: number; productIds: string[] }[], lines: ComboLine[]): OwnedDiscount` — luật y hệt `allocateComboDiscounts` (cùng điều kiện đủ bộ, `MIN_COMBO_PRODUCTS`, floor, kẹp 100%), chủ của sản phẩm là combo cho % cao nhất, bằng nhau thì combo đứng trước; `allocateComboDiscounts` giữ chữ ký, gọi bản này (id là chỉ số) rồi bỏ `owner`.
  - `comboKeyVariationIds(productIds: string[], lines: ComboLine[]): string[]` — dòng duy nhất của một sản phẩm của combo (đã khớp), sắp tăng dần.
  - `buildComboGroups(merged: OwnedDiscount, sources: ReadonlyMap<string, { kind: ComboGroup['kind']; title: string; keyVariationIds: string[] }>): ComboGroup[]` — gộp `perLine` theo `owner`; chủ không có trong `sources` thì nhóm dự phòng `{ kind: 'BUNDLE_PCT', title: 'Combo' }` để tổng vẫn khớp.
  - `ComboService.computeWithGroups(slug, lines, buyerId?, now?): Promise<ComboMatch>`; `computeForStorefront` giữ chữ ký, gọi nó rồi trả `{ total, perLine }`.
  - Truy vấn gian hàng chọn thêm `id`, `title` của collection (không đổi điều kiện).

- [ ] **Step 1: test đỏ** (`combo.service.spec.ts`), dựng prisma giả như các khối sẵn có:
  - Combo gian hàng 10% hai sản phẩm p1,p2 (collection `c1` "Bộ giặt sạch"): `groups` = 1 nhóm `collection:c1`, `title` "Bộ giặt sạch", `variationIds` ['v1','v2'], `discount === out.total`, `keyVariationIds` ['v1','v2'].
  - Khớp một phần: giỏ chỉ có p1 → `groups: []`, `total: 0`.
  - Một món hai combo: A {p1,p2} 10% và B {p2,p3} 20%, giỏ p1,p2,p3 → p1 thuộc A, p2 và p3 thuộc B, `Σ discount === total`, `perLine` bằng kết quả của `allocateComboDiscounts` cùng đầu vào.
  - Combo gian hàng 10% và bundle 20% cùng dòng: bundle giữ nhóm, nhóm combo gian hàng không xuất hiện khi mọi dòng của nó thua; bằng nhau thì combo gian hàng (đứng trước).
  - Số lượng lẻ: dòng total 99.999 quantity 3, pct 10 → floor 9.999; `Σ === total`. BUNDLE_PCT `maxQty` 1 với quantity 3 → chỉ 1 đơn vị được giảm.
  - ADDON: sản phẩm chính 1 dòng + món kèm → nhóm kind `ADDON`, `variationIds` chỉ món kèm, `keyVariationIds` là dòng sản phẩm chính.
  - Bộ nhân viên vượt trần (cấu hình `coupon.staff_max_amount_vnd` thấp): `Σ discount === total` sau kẹp, dòng bị cắt về 0 không nằm trong nhóm.
  - Bất biến: với mọi ca trên, `computeForStorefront(...)` trả `toEqual({ total, perLine })` đúng của `computeWithGroups`; spec cũ của file không sửa vẫn xanh.
- [ ] **Step 2: chạy FAIL**: `cd apps/api && npx jest src/modules/storefront/combo.service.spec.ts -t "nhóm"` → `computeWithGroups is not a function`.
- [ ] **Step 3: cài** theo Interfaces. `storefrontCombo` trả `{ owned, sources }` (combo gian hàng đã lọc `productIds`, id `collection:${c.id}`, tên `c.title`). Đường tính bundle giữ nguyên điều kiện hiện có (`raw.total <= staffMax ? raw : capped`) nhưng dùng bản `Owned`. `NO_COMBO`/giỏ rỗng trả `{ total: 0, perLine: {}, groups: [] }`.
- [ ] **Step 4: chạy PASS** `npx jest src/modules/storefront/combo.service.spec.ts src/modules/bundles src/modules/checkout/checkout.service.spec.ts` + `npx tsc --noEmit -p tsconfig.json` (apps/api).
- [ ] **Step 5: Commit** `feat(api): ComboService.computeWithGroups, nhóm combo lấy từ chính lần khớp tính comboDiscount (K5)`

---

### Task 3: Giỏ trả `comboGroups`

**Files:**
- Modify: `apps/api/src/modules/cart/cart.service.ts` (`couponBaseAfterCombo`, `priceCart`)
- Test: `apps/api/src/modules/cart/cart.service.spec.ts`

**Interfaces:**
- Consumes: `ComboService.computeWithGroups` (Task 2), `CartComboGroup` (Task 1).
- Produces: `priceCart` (và `getCart`, `getCartSelection`, `getCartForCheckout`) trả thêm `comboGroups: CartComboGroup[]`; `lineIds`/`keyLineIds` là `CartLine.id` theo thứ tự dòng trong giỏ; chỉ dòng đang được tính (đã lọc theo `itemIds`); `comboDiscount` vẫn là `combo.total`. Giỏ rỗng/không combo: `[]`.

- [ ] **Step 1: test đỏ** (`cart.service.spec.ts`): đổi stub chung `combo` thành `{ computeForStorefront, computeWithGroups }` (cả hai mặc định không giảm, `computeWithGroups` trả `{ total: 0, perLine: {}, groups: [] }`); ca mới: `computeWithGroups` trả 65.250 với một nhóm `{ id:'bundle:b1', kind:'BUNDLE_PCT', title:'Bộ giặt sạch Fuwa3e', discount: 65_250, variationIds:['v1','v2'], keyVariationIds:['v1','v2'] }` cho giỏ 3 dòng (id `i1`,`i2`,`i3`; v1,v2 thuộc nhóm) → `getCart` có `comboDiscount: 65_250` và `comboGroups` = `[{ id, kind, title, discount: 65_250, lineIds:['i1','i2'], keyLineIds:['i1','i2'] }]`, `Σ comboGroups.discount === comboDiscount`; chọn phần giỏ (`getCartSelection`) chỉ còn `i1`,`i3` → stub trả nhóm rỗng → `comboGroups: []`; stub cũ thiếu `groups` (API cũ) không làm giỏ lỗi: `comboGroups: []`.
- [ ] **Step 2: chạy FAIL**: `cd apps/api && npx jest src/modules/cart/cart.service.spec.ts -t "comboGroups"` → `comboGroups` undefined.
- [ ] **Step 3: cài**: `couponBaseAfterCombo` gọi `computeWithGroups`; `priceCart` ánh xạ `variationId → CartLine.id` rồi dựng `comboGroups` (bỏ nhóm không còn dòng nào). Không đổi dòng nào của phần tính tiền.
- [ ] **Step 4: chạy PASS** `npx jest src/modules/cart src/modules/checkout` + `npx tsc --noEmit`.
- [ ] **Step 5: Commit** `feat(api): giỏ trả comboGroups (id, tên, dòng, số giảm) khớp comboDiscount (K5)`

---

### Task 4: Race spec: nhóm = comboDiscount = báo giá (Postgres thật)

**Files:**
- Modify: `apps/api/test/integration-race/cart-combo-equals-quote.race-spec.ts`

**Interfaces:** Consumes Task 3; không tạo gì mới.

- [ ] **Step 1: test đỏ**: thêm ca vào spec sẵn có (dựng bằng helper của file): giỏ có combo gian hàng + bundle BUNDLE_PCT chạm một sản phẩm chung, kèm một món lẻ không thuộc bộ nào: `cart.comboGroups` đủ nhóm, `Σ discount === cart.comboDiscount === quote.comboDiscount`, mỗi `lineIds` là dòng có `perLine > 0`, món lẻ không nằm nhóm nào; chạy lại sau khi hết hạn bundle (đổi `endAt` về quá khứ): `comboGroups: []`.
- [ ] **Step 2: chạy FAIL** (trên DB riêng): `bash docs/2026-10-20-uat/tools/pg-native.sh start 25575`; tạo DB `tubutree_it`; `DATABASE_URL=postgresql://tubu@127.0.0.1:25575/tubutree_it npx prisma migrate deploy` (trong `apps/api`); `npx jest -c test/integration-race/jest.config.js --runInBand cart-combo-equals-quote` → ca mới đỏ khi chưa có `comboGroups` (viết test trước Task 3 hoặc kiểm bằng cách tạm bỏ dòng ánh xạ ở Task 3); spec cũ trong file xanh.
- [ ] **Step 3: chạy PASS** cùng lệnh + `bundle-price-parity`, `split-checkout`; sau cùng `pg-native.sh stop 25575`.
- [ ] **Step 4: Commit** `test(api): race giỏ có combo, comboGroups cộng bằng comboDiscount và báo giá (K5)`

---

### Task 5: app-core: kiểu, chữ, chia khối combo, câu báo bỏ món

**Files:**
- Create: `packages/app-core/src/commerce/cart-combo.ts`, `packages/app-core/src/commerce/cart-combo.spec.ts`
- Modify: `packages/app-core/src/api/cart.ts`, `packages/app-core/src/shop-copy.ts`, `packages/app-core/src/shop-copy-budget.ts`

**Interfaces:**
- Produces (cart.ts): `CartSummary.comboGroups?: CartComboGroup[]` (import type từ `@tubutree/shared-types`); re-export `CartComboGroup`.
- Produces (cart-combo.ts):
  - `interface ComboBlock<L extends { id: string }> { group: CartComboGroup; lines: L[]; applied: boolean; title: string; saving: string | null; hint: string | null }`
  - `cartComboBlocks<L extends { id: string }>(lines: readonly L[], groups: readonly CartComboGroup[] | undefined, deselected?: ReadonlySet<string>): { blocks: ComboBlock<L>[]; loose: L[] }` — mỗi dòng đúng MỘT chỗ (dòng thuộc nhiều nhóm thì nhóm đứng trước giữ); khối theo thứ tự dòng đầu tiên trong `lines`, dòng trong khối theo thứ tự `lines`; nhóm không còn dòng nào trong `lines` bị bỏ; `applied` = không dòng khóa nào của nhóm nằm trong `deselected`; `saving` = `Tiết kiệm {vnd}` chỉ khi `applied` và khối có đủ mọi `lineIds` của nhóm, ngược lại `null`; `hint` = "Chọn đủ các món để được giảm {vnd}" khi `!applied`, ngược lại `null`; `title` = `Combo: {tên}`.
  - `comboHeadingText(block): string` — `title` nối ` · ` với `saving` khi có (đọc cho trình đọc màn hình và e2e).
  - `interface ComboRemovalNotice { title: string; message: string; confirmLabel: string; keepLabel: string; discount: number }`
  - `comboRemovalNotice(groups: readonly CartComboGroup[] | undefined, lineId: string, nextQuantity?: number): ComboRemovalNotice | null` — chỉ khi `nextQuantity` (mặc định 0) < 1 và `lineId` nằm trong `keyLineIds` của ít nhất một nhóm; nhiều nhóm thì cộng `discount`, tên nối ", ". Giảm số lượng còn ≥ 1 không báo (luật khớp hiện tại chỉ cần số lượng ≥ 1).
- Khoá chữ (`SHOP_COPY`, ngân sách): `cart.comboTitle` "Combo: {name}" (null), `cart.comboSaving` "Tiết kiệm {x}" (20), `cart.comboNeedAll` "Chọn đủ các món để được giảm {x}" (null), `cart.comboRemoveTitle` "Bỏ món khỏi combo?" (22), `cart.comboRemoveBody` "Bộ {name} sẽ mất giảm {x} nếu bạn bỏ món này." (null), `cart.comboRemoveConfirm` "Vẫn bỏ" (10), `cart.comboRemoveKeep` "Giữ lại" (10). Nút xác nhận KHÔNG ghi "Xoá" để không lặp nhãn thùng rác.

- [ ] **Step 1: test đỏ** `cart-combo.spec.ts`:
  - 3 dòng i1,i2,i3 + nhóm `{lineIds:['i1','i2'], keyLineIds:['i1','i2'], discount:65_250, title:'Bộ giặt sạch Fuwa3e'}` → `blocks[0].lines` = [i1,i2], `loose` = [i3], `blocks[0].title` = 'Combo: Bộ giặt sạch Fuwa3e', `saving` = 'Tiết kiệm 65.250đ', `comboHeadingText` = 'Combo: Bộ giặt sạch Fuwa3e · Tiết kiệm 65.250đ'.
  - Bỏ chọn i1 (khóa) → `applied=false`, `saving=null`, `hint='Chọn đủ các món để được giảm 65.250đ'`; bỏ chọn một dòng không khóa → vẫn `applied`.
  - Hai nhóm cùng chứa i2 → i2 chỉ ở nhóm đầu, mọi dòng xuất hiện đúng một lần (`blocks.flatMap(lines).concat(loose)` là hoán vị của `lines`).
  - `groups` undefined/rỗng → `blocks=[]`, `loose=lines` (API cũ).
  - Nhóm chỉ có dòng ở nơi giao khác (không còn dòng trong `lines`) bị bỏ; nhóm thiếu một dòng trong `lines` → khối có `saving=null`.
  - `comboRemovalNotice`: xoá i1 → message "Bộ Bộ giặt sạch Fuwa3e sẽ mất giảm 65.250đ nếu bạn bỏ món này." (đổi chữ mẫu thành "Bộ {name}" không lặp "Bộ" khi tên bắt đầu bằng "Bộ" là việc của dữ liệu, không xử lý), `discount` 65.250; xoá i3 (lẻ) → `null`; xoá dòng khóa-mà-không-trong-lineIds (sản phẩm chính ADDON) → có báo; `nextQuantity=2` → `null`; hai nhóm cùng khóa i2 → `discount` là tổng, tên "A, B".
  - Chữ: `shop-copy.spec` xanh (ngân sách, không thuật ngữ cấm).
- [ ] **Step 2: chạy FAIL**: `cd packages/app-core && npx vitest run src/commerce/cart-combo.spec.ts src/shop-copy.spec.ts`.
- [ ] **Step 3: cài** theo Interfaces; dùng `vnd` của `commerce/money.ts`, `fillCopy`. Khoá chữ thêm sát `'cart.subtotalNet'`.
- [ ] **Step 4: chạy PASS** `npx vitest run src/commerce src/shop-copy.spec.ts src/terminology.spec.ts src/design-docs.spec.ts`.
- [ ] **Step 5: Commit** `feat(app-core): chia khối combo ở giỏ và câu báo bỏ món làm mất giảm (K5)`

---

### Task 6: Kiểu client hai app và optimistic giữ nhóm

**Files:**
- Modify: `apps/miniapp/src/services/shop-api.ts` (`CartSummary`), `apps/web/src/lib/shop-client.ts` (`CartSummary`), `apps/miniapp/src/utils/cart-rules.ts`
- Test: `apps/miniapp/src/utils/cart-rules.spec.ts`

**Interfaces:**
- Produces: `CartSummary.comboGroups?: CartComboGroup[]` ở hai file (import type từ `@tubutree/shared-types`); `recompute(cart, items, editedId?)` giữ `comboGroups` nhưng bỏ dòng đã xoá khỏi `lineIds`/`keyLineIds` và bỏ nhóm có dòng khóa bị xoá hoặc hết dòng; `comboDiscount` vẫn về 0 như cũ (tiền chờ máy chủ), số lượng đổi không làm nhóm biến mất (tránh khối nhảy mỗi lần bấm +/−).

- [ ] **Step 1: test đỏ** (`cart-rules.spec.ts`): giỏ có nhóm {i1,i2} khóa {i1,i2}; `recompute(cart, items bỏ i3)` giữ nhóm nguyên; `recompute(cart, items bỏ i1)` → `comboGroups: []`; `recompute(cart, items, 'i2')` (đổi số lượng) giữ nhóm; `comboDiscount: 0` ở cả ba; giỏ không có `comboGroups` → `comboGroups` vẫn `undefined`/rỗng, không lỗi.
- [ ] **Step 2: chạy FAIL**: `cd apps/miniapp && npx vitest run src/utils/cart-rules.spec.ts`.
- [ ] **Step 3: cài** `recompute` + hai kiểu.
- [ ] **Step 4: chạy PASS** cùng lệnh + `npx tsc --noEmit -p apps/miniapp` và web.
- [ ] **Step 5: Commit** `feat(miniapp,web): CartSummary.comboGroups, optimistic giữ nhóm combo (K5)`

---

### Task 7: Giỏ Mini App: khối combo + hộp xác nhận bỏ món

**Files:**
- Modify: `apps/miniapp/src/pages/cart.tsx`
- Test: `apps/miniapp/src/pages/cart.spec.tsx`, `apps/miniapp/src/components/ui/hit-target-guard.spec.tsx` (nếu có nút mới)

**Interfaces:**
- Consumes: `cartComboBlocks`, `comboHeadingText`, `comboRemovalNotice` (Task 5), `ConfirmSheet` (`components/ui/confirm-sheet.tsx`), `Heading` (`components/ui/text`).
- Produces: trong mỗi phần nơi giao, các dòng của combo nằm trong `<section aria-label={comboHeadingText(block)} data-testid="cart-combo-group">` có đầu nhóm `<h3 data-testid="cart-combo-heading">` (tên + " · " + Tiết kiệm màu `--color-text-price-deal`) và `hint` (nếu có) dưới đầu nhóm; dòng lẻ vẽ như cũ sau các khối. Thùng rác của dòng có `comboRemovalNotice(...)` mở `ConfirmSheet` (tone default, "Vẫn bỏ" / "Giữ lại"); xác nhận mới gọi `handleRemove`. Dòng lẻ xoá ngay như cũ.

- [ ] **Step 1: test đỏ** (`cart.spec.tsx`, theo cách dựng giỏ của file): giỏ 3 dòng, `comboGroups` nhóm {i1,i2}, `comboDiscount: 65_250` → có đúng một `cart-combo-group` tên 'Combo: Bộ giặt sạch Fuwa3e · Tiết kiệm 65.250đ' chứa hai dòng, dòng i3 ngoài nhóm; chân dính vẫn có 'Giảm giá combo' `-65.250đ` (`getByText('-65.250đ')`); bỏ chọn một dòng nhóm (ô chọn) → đầu nhóm chỉ còn 'Combo: …' và có 'Chọn đủ các món để được giảm 65.250đ'; bấm "Xoá {tên i1}" → hộp xác nhận có 'Bộ Bộ giặt sạch Fuwa3e sẽ mất giảm 65.250đ nếu bạn bỏ món này.', `removeCartItem` CHƯA gọi; bấm "Giữ lại" → không gọi; bấm "Vẫn bỏ" → `removeCartItem('i1')` được gọi; bấm xoá i3 (lẻ) → gọi ngay, không hộp; giỏ không có `comboGroups` → không có `cart-combo-group`, mọi dòng như cũ (các spec cũ của file không sửa).
- [ ] **Step 2: chạy FAIL**: `cd apps/miniapp && npx vitest run src/pages/cart.spec.tsx`.
- [ ] **Step 3: cài** theo Interfaces. Khối: nền `--color-bg-subtle`, viền `--color-border-subtle`, bo `--radius-card`, đệm/khe bằng `--space-*` token (không số px mới); dòng bên trong là `CartLineRow` hiện có (giữ `data-testid="cart-line"`); đầu nhóm cỡ chữ token `--type-label-size`/đậm 600, được xuống dòng, không cắt. Giữ `<Box p={3} …>` của phần nơi giao.
- [ ] **Step 4: chạy PASS** `npx vitest run src/pages/cart.spec.tsx src/components/ui/hit-target-guard.spec.tsx src/components/ds-shop-guard.spec.ts` + `cd ../.. && pnpm lint:parity && pnpm lint:vars`.
- [ ] **Step 5: Commit** `feat(miniapp): giỏ gom món combo dưới đầu nhóm, báo trước khi bỏ món làm mất giảm (K5)`

---

### Task 8: Giỏ web: cùng khối, cùng hộp xác nhận (375px giống Mini)

**Files:**
- Modify: `apps/web/src/app/gio-hang/page.tsx`
- Test: `apps/web/src/app/gio-hang/page.spec.tsx`, `apps/web/src/app/gio-hang/cart-parity.spec.tsx`

**Interfaces:**
- Consumes: như Task 7; hộp xác nhận dựng từ `Sheet` (`@/components/ui/sheet`, đúng API `open/onClose/title/footer`) với hai nút `ui.btnPrimary` / `ui.btnSecondary`-tương-đương có sẵn trong `@/lib/guest-ui`, hoặc `ConfirmDialog` của admin nếu không phụ thuộc admin: ưu tiên `Sheet` (cùng giao diện sheet đáy trên điện thoại).
- Produces: cùng `data-testid` (`cart-combo-group`, `cart-combo-heading`) và cùng chữ như Mini; điện thoại không dùng `max-md:` mới (khối là mặc định; từ md bỏ nền khối bằng lớp `md:`).

- [ ] **Step 1: test đỏ** (`page.spec.tsx`, theo cách mock `getCart` của file): cùng bảy ca của Task 7 (nhóm, chân dính còn dòng combo, bỏ chọn khóa → gợi ý, xoá dòng khóa mở hộp và chưa gọi `removeCartItem`, Giữ lại, Vẫn bỏ gọi `removeCartItem`, dòng lẻ xoá ngay, API cũ không nhóm). `cart-parity.spec.tsx`: thêm ca khẳng định chữ đầu nhóm web === chữ Mini cho cùng giỏ (cùng `comboHeadingText`).
- [ ] **Step 2: chạy FAIL**: `cd apps/web && npx vitest run src/app/gio-hang/page.spec.tsx src/app/gio-hang/cart-parity.spec.tsx`.
- [ ] **Step 3: cài** theo Interfaces; `removeWithUndo` giữ nguyên, chỉ gọi sau xác nhận. Thùng rác dòng khóa có `aria-haspopup="dialog"`.
- [ ] **Step 4: chạy PASS** cả thư mục `src/app/gio-hang` + `src/components/ds-shop-guard.spec.ts`, `pnpm lint:parity`, `pnpm lint:vars`.
- [ ] **Step 5: Commit** `feat(web): giỏ gom món combo và báo trước khi bỏ món, giống Mini App (K5)`

---

### Task 9: e2e: giỏ có combo, đo 375px hai app, axe

**Files:**
- Create: `apps/e2e/tests/support/cart-combo-mocks.ts`, `apps/e2e/tests/cart-combo.miniapp.spec.ts`, `apps/e2e/tests/cart-combo.web.spec.ts`
- Modify: `apps/e2e/tests/support/cart-footer-mocks.ts` (thêm tuỳ chọn `comboGroups` vào `FooterCartOptions`/`footerCart`, không đổi mặc định), `apps/e2e/tests/a11y-shop.miniapp.spec.ts`, `apps/e2e/tests/a11y-shop.web.spec.ts` (thêm màn "Giỏ có combo")

**Interfaces:**
- Produces: `comboCart(o?: { title?: string }): CartSummary` — giỏ 3 dòng, hai dòng thuộc nhóm `bundle:e2e-combo` "Bộ giặt sạch Fuwa3e" (giảm 65.250), một dòng lẻ, `comboDiscount: 65_250`, `comboGroups` đúng Task 3; `mockComboCart(api: MockApi, o?)` cho Mini; web dùng `comboCart()` với cùng cách mock của `cart-display.web.spec.ts`. Mock trả giỏ MỚI (bộ biến mất, `comboDiscount: 0`) sau khi `DELETE /cart/items/:id` của dòng khóa để kiểm luồng.

- [ ] **Step 1: test (đỏ khi chưa có UI)** Mini `cart-combo.miniapp.spec.ts`: 375px: có `cart-combo-group` với đầu nhóm 'Combo: Bộ giặt sạch Fuwa3e · Tiết kiệm 65.250đ', hai dòng trong nhóm, dòng lẻ nằm ngoài (toạ độ y sau nhóm), chân dính 'Giảm giá combo' `-65.250đ`; `scrollWidth <= 375` ở 375 và 320 với tên combo dài 60 ký tự; bấm Xoá dòng khóa → hộp xác nhận → "Giữ lại" thì dòng còn; "Vẫn bỏ" thì dòng biến mất và nhóm biến mất. Web `cart-combo.web.spec.ts`: cùng ca ở 375 và 1280 (1280 chỉ kiểm nhóm + hộp xác nhận), cộng so số đo Mini ↔ web ở 375: `boundingBox` rộng và cao của `cart-combo-heading` và `cart-combo-group` chênh ≤1px (đo bằng `expect.poll`/`toBeCloseTo` theo mẫu `ds-parity.ts`). `a11y-shop.*`: một màn giỏ có combo, axe không serious/critical.
- [ ] **Step 2: chạy FAIL/xanh theo từng app**: Mini `cd apps/e2e && E2E_SCOPE=miniapp E2E_MINIAPP_PORT=3501 npx playwright test tests/cart-combo.miniapp.spec.ts tests/a11y-shop.miniapp.spec.ts --workers=2 --reporter=line`; web `E2E_API_PORT=3502 E2E_WEB_PORT=3503 E2E_MINIAPP_PORT=3504 bash apps/e2e/scripts/web-gate.sh tests/cart-display*.ts tests/cart-combo.web.spec.ts tests/a11y-shop.web.spec.ts tests/ds-parity.shop.spec.ts --workers=2 --reporter=line` (cần Docker; không có Docker thì ghi "chưa chạy, để CI").
- [ ] **Step 3: sửa mã (không sửa test) tới khi PASS**; spec cũ của file giỏ (`cart-display`, `cart-footer`, `cart-lines`) chạy lại, xanh.
- [ ] **Step 4: Commit** `test(e2e): giỏ có combo ở Mini và web 375px, axe (K5)`

---

### Task 10: Ảnh trước/sau, tài liệu, gate

**Files:**
- Modify: `DESIGN.md` (mục nhật ký quyết định + một dòng ở phần giỏ), `docs/2026-10-31-shop-redesign/PROGRESS.md` không sửa (phiên chính ghi)
- Ảnh (không commit, thư mục bị gitignore): `docs/2026-10-31-shop-redesign/screens/K5/{before,after}/{mini375,web375,web1280}-cart-combo.png`

- [ ] **Step 1: ảnh "trước"**: ở worktree đã checkout lại commit gốc (`git worktree add` tạm hoặc `git stash`-free: chụp trước Task 7 ở cổng 3501 Vite dev Mini và 3502 `next dev` web, dùng `comboCart()` làm mock qua `page.route`), ba khổ; "sau": cùng kịch bản sau Task 8. Tắt server của mình.
- [ ] **Step 2: so hai bản 375px** (Mini vs web), ghi chênh lệch còn lại vào notes.
- [ ] **Step 3: ghi `DESIGN.md`** một dòng nhật ký: "Giỏ: món của combo gom dưới 'Combo: {tên} · Tiết kiệm {số}'; bỏ món khóa của bộ hỏi xác nhận" kèm lý do; `pnpm --filter @tubutree/app-core test -- design-docs` xanh.
- [ ] **Step 4: gate đầy đủ** từ worktree: `bash docs/2026-10-28-review/tools/gate.sh <worktree> --base 07818cc2b --out <gate-K5.txt>`; thêm race `cart-combo-equals-quote`, `bundle-price-parity` (Postgres 25575); e2e Mini cả bộ `cd apps/e2e && E2E_SCOPE=miniapp E2E_MINIAPP_PORT=3501 npx playwright test --workers=2 --reporter=line`. Bước FAIL kiểm trên base để ghi "có sẵn".
- [ ] **Step 5: Commit** `docs(design): nhật ký K5, giỏ gom combo (K5)`

---

## Self-review

- **Spec coverage:** (1) API danh sách combo + tổng bằng `comboDiscount` + shared-types + client hai app: T1–T3, T6; ca một món hai combo, số lượng lẻ, khớp một phần: T2. (2) Nhóm Mini + web: T5, T7, T8. (3) Báo trước khi bỏ món: T5 `comboRemovalNotice`, T7, T8; không chặn (có "Vẫn bỏ"). (4) Dòng "Giảm giá combo" ở chân giữ: T7/T8 khẳng định. Checkout giữ nguyên (không sửa file K2). Kiểm: jest cart/combo, race, vitest hai app, e2e: T4, T9, T10. Ảnh: T10.
- **Type consistency:** `OwnedDiscount`, `ComboGroup` (`variationIds`, `keyVariationIds`) ở API; `CartComboGroup` (`lineIds`, `keyLineIds`) ở shared-types và app-core, ánh xạ ở T3; `comboHeadingText`/`cartComboBlocks`/`comboRemovalNotice` cùng tên ở T5, T7, T8.
- **Giới hạn đã biết (ghi vào notes):** (a) số "mất giảm" khi bỏ món là `discount` của nhóm; với hai combo chồng một sản phẩm, bỏ món có thể chỉ mất ít hơn vì dòng còn lại rơi về combo kia, nên số là cận trên. (b) Bỏ chọn một phân loại không-khóa của bộ vẫn ghi "Tiết kiệm" đầy đủ trong khi phần chọn giảm ít hơn; dòng "Giảm giá combo" ở chân (máy chủ tính theo phần chọn) là số đúng.
