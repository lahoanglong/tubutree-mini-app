# K3 `voucher-picker`: bảng chọn mã và phiếu mã (đợt 7b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** một bảng chọn mã giảm giá cùng dạng ở Mini App và web 375 (mỗi mã là `VoucherTicket variant="row"`, một bộ nhãn nút ở shop-copy), phiếu không dùng được không còn mờ cả thẻ, hết chữ "HSD", sheet Ưu đãi ở PDP xếp mã theo mức có lợi cho món đang xem.

**Architecture:** logic xếp và gắn nhãn mã đặt ở `packages/app-core/src/commerce/voucher-picker.ts` (hàm thuần, có spec); `VoucherPicker` (cùng tên, cùng props) là lớp vẽ mỏng trên `VoucherTicket` ở hai app; `VoucherSheet` (Mini) và `CouponBox` (web) giữ tên, props, truy vấn, đường áp/gỡ/tự áp mã, chỉ đổi cách vẽ danh sách. Web dưới `md` mở `BottomSheet` có sẵn (như Mini), từ `md` giữ panel tại chỗ.

**Tech Stack:** TypeScript, React 18 + zmp-ui + Vite (Mini), Next 15 + Tailwind (web), vitest + Testing Library, Playwright.

**Spec:** `docs/2026-10-31-shop-redesign/01-thiet-ke.md` (§4 là luật); nguồn việc: `docs/2026-10-31-shop-redesign/review/extra-critique-2.md` (P1 #4, #5, #8; P2 #4, #5, #6, #7, #9 phần mã, #10).

## Global Constraints

- Node: `export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH`; worktree mới cần `pnpm --filter @tubutree/shared-types build` và `npx prisma generate` (trong `apps/api`) trước gate.
- Chữ giao diện tiếng Việt lấy ở `packages/app-core/src/shop-copy.ts` (`fillCopy`), khoá mới kèm ngân sách độ dài; không dùng "HSD", "Vui lòng", "Freeship", "Kho voucher", "Top", "Nhãn hàng".
- Vùng chạm ≥44px, tương phản chữ ≥4,5:1, axe 0 vi phạm ở 375px trên màn đụng tới.
- Chỉ dùng token semantic/component: không hex, không `var(--stone-…)`/`--clay-…`, không `fontSize` số; `pnpm lint:parity` bánh cóc px và `max-md:` chỉ được giảm (`node scripts/uiux/ds-ratchet.mjs --write` khi hạ).
- Thông báo đi qua `useNotify` (Mini), không `useSnackbar/openSnackbar` trực tiếp.
- Đường tiền không đổi: API áp/gỡ mã, tự áp một lần ở thanh toán, xem trước `/checkout/coupon-previews`; một đơn một mã.
- Không sửa `apps/web/src/components/ui/sheet.tsx`, `thanh-toan/page.tsx`, `checkout.tsx` (K2), `variation-sheet`, `add-to-cart`, `variation-picker`, `pdp-bundles` (K1), file của 9b. Không deploy, không push, không đọc/ghi PROD.
- Comment chỉ giải thích "vì sao" không hiển nhiên (tiếng Việt), theo mật độ file xung quanh.

## Review Focus

1. Mã gắn sản phẩm khác với món trong giỏ, mã freeship khi phí giao đã 0, mã bị máy chủ chặn: hàng vẫn hiện, nút khoá `aria-disabled` kèm lý do bằng chữ, không bấm áp được. Test: `voucher-picker.spec.ts` (nhóm `blocked`) + `voucher-sheet.spec.tsx`.
2. Xem trước của máy chủ chưa về / lỗi / cũ (giỏ vừa đổi): không hiện "Giảm X cho đơn này", thứ tự và đủ điều kiện theo phép đoán phía máy như trước. Test: `voucher-picker.spec.ts` (không `previews`), spec cũ `VoucherSheet: số xem trước cũ` giữ xanh.
3. Mã `minOrder = 0` / `null`, tên admin rỗng, mã tự cấp có id khách (`MILESTONE…-CMV9…`): không ghi "Đơn tối thiểu 0đ", không lộ mã thô. Test: `voucher-picker.spec.ts` (`displayCode`), `voucher-sheet.spec.tsx`.
4. Hạn dùng đúng 00:00 giờ VN, khác năm hiện tại, hết hạn trong ngày: chữ hạn đúng ngày dùng được cuối. Test: `voucher.spec.ts` (`expiryText`).
5. Bấm "Dùng" hai lần liên tiếp, đang đổi mã ở trang chứa (`busy`): chỉ một lần áp, mọi nút khoá. Test: `voucher-sheet.spec.tsx`, `coupon-box.spec.tsx` (ca `busy`).

---

## File Structure

| File | Việc |
|---|---|
| `packages/app-core/src/commerce/voucher.ts` (+ spec) | sửa `expiryText` |
| `packages/app-core/src/commerce/voucher-picker.ts` (+ spec) | MỚI: `pickerRows`, `offerRows` |
| `packages/app-core/src/shop-copy.ts` | khoá `coupon.pick*`, `coupon.copied*` |
| `apps/miniapp/src/components/ui/voucher-ticket.tsx`, `apps/web/src/components/mini/voucher-ticket.tsx` (+ spec) | thêm `selected`, `saving`, `primary.ariaLabel`; `reason` hiện cả khi chưa khoá |
| `apps/miniapp/src/components/ui/voucher-picker.tsx`, `apps/web/src/components/mini/voucher-picker.tsx` | MỚI: `VoucherPicker` |
| `apps/miniapp/src/components/checkout/voucher-sheet.tsx` (+ spec) | vẽ lại danh sách, `useNotify` |
| `apps/web/src/components/coupon-box.tsx` (+ spec), `apps/web/src/lib/coupon-view.ts` | sheet dưới `md`, `VoucherPicker`, token ngữ nghĩa; xoá `coupon-view` |
| `apps/miniapp/src/components/product/pdp-offers-sheet.tsx`, `apps/web/src/app/san-pham/[slug]/pdp-extras.tsx` (+ spec) | xếp mã theo món, "Mua thêm x để dùng", web báo chép mã bằng thông báo nổi |
| `docs/design/ds-map.json`, `DESIGN.md`, `apps/miniapp/src/css/contrast.spec.ts`, `packages/app-core/src/terminology.spec.ts`, `scripts/uiux/ds-baseline.json` | khai thành phần, cặp màu, gỡ miễn, hạ baseline |

---

### Task 1: `expiryText` đúng ngày cuối, có năm (P2 #5)

**Files:** Modify `packages/app-core/src/commerce/voucher.ts:177-188`; Test `packages/app-core/src/commerce/voucher.spec.ts`.

**Interfaces:** Produces: `expiryText(endMs: number | null, now: number): string` (chữ ký không đổi).

- [ ] **Step 1: test đỏ** trong `voucher.spec.ts` (nhóm "chữ hạn"), `now = NOW` (2026-11-01 12:00 VN):
  - hạn `2026-12-31T17:00:00Z` (00:00 01/01/2027 VN) → `'Dùng đến 31/12'`;
  - hạn `2027-03-10T10:00:00Z` → `'Dùng đến 10/03/2027'`;
  - `now = 2026-12-31T16:00:00Z` (23:00 VN 31/12), hạn 00:00 VN 01/01/2027 → `'Hết hạn hôm nay'`;
  - `now = 2026-12-30T10:00:00Z`, hạn 00:00 VN 01/01/2027 → `'Còn 1 ngày'`;
  - hạn 00:00:00.500 VN (không tròn) vẫn tính ngày của chính nó.
- [ ] **Step 2:** chạy `cd packages/app-core && npx vitest run src/commerce/voucher.spec.ts` → đỏ.
- [ ] **Step 3:** ngày cuối dùng được = `vnDay(endMs - 1)` (hạn đúng nửa đêm lùi một ngày); `days` tính theo ngày đó; ngày ghi `dd/mm`, thêm `/yyyy` khi năm (giờ VN) của ngày cuối khác năm của `now`.
- [ ] **Step 4:** chạy lại → xanh, cả spec cũ của `expiry`.
- [ ] **Step 5: commit** `fix(app-core): expiryText lùi một ngày khi hạn đúng 00:00 giờ VN, ghi năm khi khác năm hiện tại (K3, P2 #5)`.

---

### Task 2: `VoucherTicket` mang trạng thái chọn mã (hai app)

**Files:** Modify `apps/miniapp/src/components/ui/voucher-ticket.tsx`, `apps/web/src/components/mini/voucher-ticket.tsx` (hai bản giống nhau từng dòng); Test `apps/miniapp/src/components/ui/voucher-ticket.spec.tsx`, `apps/web/src/components/mini/voucher-ticket.spec.tsx` (nếu chưa có thì thêm vào spec hiện có của thành phần); `apps/miniapp/src/css/contrast.spec.ts`.

**Interfaces:** Produces (thêm, không đổi tên cũ):
```ts
interface VoucherTicketProps {
  /* … cũ … */
  primary?: { label: string; onClick: () => void; busy?: boolean; ariaLabel?: string };
  /** Mã đang dùng cho đơn: hiện chữ `coupon.pickApplied` (không chỉ màu), nút chính là "Bỏ chọn" do nơi gọi truyền. */
  selected?: boolean;
  /** Mức giảm máy chủ báo cho đơn này ("Giảm 30.000đ cho đơn này"), tông thành công. */
  saving?: string;
}
```
`reason` hiện ở mọi trạng thái còn dùng được hoặc chưa đủ (không ở used/expired/soldout); nút chỉ khoá (`aria-disabled`) khi `state === 'ineligible'` hoặc `busy`.

- [ ] **Step 1: test đỏ** (cả hai spec): (a) `selected` hiện chữ "Đang dùng"; (b) `saving` hiện trong `data-testid="voucher-saving"`; (c) `reason` với `state: 'saved'` hiện chữ và nút VẪN bấm được; (d) `primary.ariaLabel` thành `aria-label` của nút; (e) `state: 'expired'` không hiện `reason`. Contrast: thêm cặp `['--color-status-warning-fg','--color-bg-surface']`, `['--color-text-tertiary','--color-bg-surface']`, `['--color-text-secondary','--color-action-primary-bg-disabled']`, `['--color-status-success-fg','--color-bg-surface']` vào `contrast.spec.ts` (đo trước: 6,33 / 5,59 / 5,38 / 5,25).
- [ ] **Step 2:** chạy spec hai app → đỏ (a–d).
- [ ] **Step 3:** cài đặt trong cả hai file; `describedBy` trỏ tới dòng `reason` khi có.
- [ ] **Step 4:** chạy lại hai spec + `voucher-center`/trang `/vouchers` spec đang dùng `VoucherTicket` → xanh.
- [ ] **Step 5: commit** `feat(ui): VoucherTicket có selected, saving, ariaLabel, reason cho mã còn dùng được (K3)`.

---

### Task 3: logic xếp và gắn nhãn mã (app-core)

**Files:** Create `packages/app-core/src/commerce/voucher-picker.ts`, `voucher-picker.spec.ts`; Modify `packages/app-core/src/shop-copy.ts` (+ `shop-copy-budget.ts` nếu spec đòi); Test `packages/app-core/src/shop-copy.spec.ts` (tự bắt khoá thiếu ngân sách).

**Interfaces:** Produces:
```ts
import type { CouponPreviewDTO } from '@tubutree/shared-types';
export type PickerGroup = 'applied' | 'usable' | 'short' | 'blocked';
export type PickerAction = 'use' | 'remove' | 'short' | 'blocked';
export interface PickerRow<T extends CouponDTO = CouponDTO> {
  coupon: T; view: VoucherView; group: PickerGroup; applied: boolean;
  action: PickerAction; label: string; ariaLabel: string;
  saving: string | null; reason: string | null;
}
export interface PickerContext {
  currentCode?: string | null; subtotal: number; shippingFee?: number | null;
  productIds?: readonly string[];
  previews: ReadonlyMap<string, CouponPreviewDTO>; // khoá viết hoa
  now: number;
  displayCode?: (code: string) => string | null;   // tên thân thiện của mã tự cấp
}
export function pickerRows<T extends CouponDTO>(coupons: readonly T[], ctx: PickerContext): PickerRow<T>[];

export interface OfferRow<T extends CouponDTO = CouponDTO> { coupon: T; view: VoucherView; reason: string | null }
export function offerRows<T extends CouponDTO>(coupons: readonly T[], o: { amount: number; now: number }): OfferRow<T>[];
```
Khoá shop-copy mới: `coupon.pickTitle` "Chọn mã giảm giá", `coupon.pickMine` "Mã giảm giá của bạn", `coupon.pickManual` "Nhập mã giảm giá khác", `coupon.pickPlaceholder` "Nhập mã", `coupon.pickApply` "Áp dụng", `coupon.pickEmptyTitle` "Bạn chưa có mã giảm giá trong ví", `coupon.pickEmptyBody` "Nhập mã giảm giá ở trên để áp dụng.", `coupon.pickUse` "Dùng", `coupon.pickRemove` "Bỏ chọn", `coupon.pickShort` "Chưa đủ", `coupon.pickBlocked` "Không áp dụng", `coupon.pickApplied` "Đang dùng", `coupon.pickUseAria` "Dùng mã {code}", `coupon.pickRemoveAria` "Bỏ chọn mã {code}", `coupon.pickShortAria` "Chưa đủ điều kiện dùng mã {code}", `coupon.pickBlockedAria` "Không áp dụng mã {code}", `coupon.saveOrder` "Giảm {x} cho đơn này", `coupon.saveShip` "Miễn phí giao hàng {x} cho đơn này", `coupon.shipAlreadyFree` "Đơn này đã miễn phí giao hàng", `coupon.scopeOnly` "Chỉ áp cho {names}", `coupon.copiedToast` "Đã chép mã {code} — mã đã có sẵn trong ví, chọn ở bước thanh toán", `coupon.copyShowToast` "Mã của bạn: {code} — chọn ở bước thanh toán".

Luật: `applied` = trùng `currentCode` (không phân biệt hoa thường). Có `preview` thì theo máy chủ; không thì phép đoán: `belowMin` (`minOrder != null && subtotal < minOrder`), `wrongProducts` (mã có `products`, có `productIds`, không giao nhau), `shipFree` (FREESHIP, `shippingFee === 0`). Nhóm: applied → `remove`/"Bỏ chọn"; còn dùng được → `use`/"Dùng"; thiếu tiền (client `subtotal < minOrder`, kể cả máy chủ chặn) → `short`/"Chưa đủ", `reason = fillCopy('coupon.needMore', { x: vndShort(minOrder - subtotal) })`; còn lại bị chặn → `blocked`/"Không áp dụng", `reason` = lý do máy chủ / "Đơn này đã miễn phí giao hàng" / "Chỉ áp cho …". Lý do máy chủ có dạng "Đơn tối thiểu …đ để dùng mã này." thì `view.condition = ''` (bỏ lặp). `view.state` = `'ineligible'` cho `short`/`blocked`, còn lại `'saved'`. Thứ tự: applied, usable (mức giảm giảm dần: số xem trước nếu có, không thì ước: AMOUNT `value`, PERCENT `min(round(subtotal·pct/100), maxDiscount)`, FREESHIP `shippingFee ?? 0`; hoà theo hạn sớm, rồi thứ tự vào), short (thiếu ít trước), blocked. `saving` chỉ lấy từ xem trước máy chủ.

`offerRows`: mã đủ điều kiện cho `amount` trước (lợi lớn trước, FREESHIP sau mã giảm tiền), mã chưa đủ sau (thiếu ít trước, `reason = needMore`), `view.state = 'saved'` cả hai.

- [ ] **Step 1: test đỏ** `voucher-picker.spec.ts`: (1) thứ tự applied > usable (mức giảm giảm dần) > short (thiếu ít trước) > blocked; (2) nhãn nút và `ariaLabel` từng nhóm; (3) máy chủ chặn với câu "Đơn tối thiểu 199.000đ để dùng mã này." và `subtotal < minOrder` → nhóm `short`, `reason` "Mua thêm 49k để dùng", không có câu máy chủ; máy chủ chặn câu đó khi `subtotal ≥ minOrder` → `blocked`, `view.condition === ''`; (4) `minOrder: 0` → `view.condition === ''`; (5) không `previews`: `saving === null`, cùng thứ tự đoán; (6) `shipFree` và `wrongProducts`; (7) `displayCode` thay `view.code` mà `coupon.code` giữ nguyên; (8) `offerRows`: 8 mã mẫu của `offers-sheet` (FREESHIP 99k, XANH10 250k tối đa 30k, GIAM20K không điều kiện…) với `amount = 120_000` → GIAM20K đứng đầu, FREESHIP kế, XANH10 cuối có `reason "Mua thêm 130k để dùng"`.
- [ ] **Step 2:** `npx vitest run src/commerce/voucher-picker.spec.ts` → đỏ (module chưa có).
- [ ] **Step 3:** cài `pickerRows`, `offerRows`, các khoá shop-copy.
- [ ] **Step 4:** chạy `voucher-picker.spec.ts`, `shop-copy.spec.ts`, `terminology.spec.ts` → xanh.
- [ ] **Step 5: commit** `feat(app-core): pickerRows/offerRows xếp mã theo lợi, nhãn nút và lý do một bộ (K3, P1 #4, P2 #6 #7)`.

---

### Task 4: `VoucherPicker` (hai app, cùng tên, cùng props)

**Files:** Create `apps/miniapp/src/components/ui/voucher-picker.tsx`, `apps/web/src/components/mini/voucher-picker.tsx` (+ `'use client'`, dòng nguồn như các file mirror khác), spec cho mỗi app; Modify `apps/web/src/components/mini/index.ts`, `docs/design/ds-map.json`, `DESIGN.md` (mục Thành phần, bảng Khuyến mãi và banner).

**Interfaces:** Consumes: `PickerRow`, `VoucherTicket` (Task 2, 3). Produces:
```ts
export interface VoucherPickerProps {
  rows: readonly PickerRow[];
  onUse: (code: string) => void;
  onRemove: () => void;
  /** Có thao tác đang chạy hoặc trang chứa đang đổi mã: mọi nút `aria-busy`, không bấm được. */
  busy?: boolean;
  /** Mã đang được áp (mã đó hiện nút xoay). */
  pendingCode?: string | null;
}
export function VoucherPicker(props: VoucherPickerProps): JSX.Element;
```
Mỗi hàng: `VoucherTicket variant="row" voucher={row.view} selected={row.applied} saving={row.saving ?? undefined} reason={row.reason ?? undefined} primary={{ label: row.label, ariaLabel: row.ariaLabel, busy: busy || pendingCode === coupon.code, onClick }}`; `use` → `onUse(coupon.code)`, `remove` → `onRemove()`, `short`/`blocked` không gọi gì. Khung `ul`/`li` không viền, không `opacity`.

- [ ] **Step 1: test đỏ** (mỗi app): 4 hàng một mỗi nhóm → chữ nút `Dùng`, `Bỏ chọn`, `Chưa đủ`, `Không áp dụng`; bấm từng nút gọi đúng callback (hai nút khoá không gọi); không phần tử nào có style `opacity` < 1; `busy` làm mọi nút `aria-busy`; hàng `applied` có chữ "Đang dùng".
- [ ] **Step 2:** chạy → đỏ. **Step 3:** cài đặt, xuất qua `mini/index.ts`, thêm mục `VoucherPicker` vào `ds-map.json` (`props: 'VoucherPickerProps'`, `screens: ['/cart', '/checkout']`) và chữ trong dấu huyền ở DESIGN.md. **Step 4:** chạy hai spec + `pnpm --filter @tubutree/app-core test -- design-docs ds-map-parity` (hoặc vitest theo file) → xanh.
- [ ] **Step 5: commit** `feat(ui): VoucherPicker dùng chung hai app (K3, P1 #4)`.

---

### Task 5: Mini `VoucherSheet` dùng `VoucherPicker`, `useNotify`

**Files:** Modify `apps/miniapp/src/components/checkout/voucher-sheet.tsx`; Test `voucher-sheet.spec.tsx`; Modify `packages/app-core/src/terminology.spec.ts` (gỡ dòng miễn `voucher-sheet.tsx` USE.expiry), `apps/miniapp/src/components/ds-shop-guard.spec.ts` (gỡ miễn `voucher-sheet.tsx` ở Badge style).

**Interfaces:** `VoucherSheetProps` giữ nguyên từng khoá (`visible, onClose, currentCode, subtotal, shippingFee, productIds, previewParams, previewKey, onCouponApplied, busy`).

- [ ] **Step 1:** sửa `voucher-sheet.spec.tsx` theo thiết kế mới (test đỏ trước): nút "Dùng" / "Bỏ chọn" / "Chưa đủ" / "Không áp dụng" (thay "Bỏ", "Chưa đủ" cũ), tên nhóm `getByRole('button', { name: 'Dùng mã X' })`; không còn `HSD`; mã `minOrder 0` không có "Đơn tối thiểu 0đ"; câu "Đơn tối thiểu … để dùng mã này." của máy chủ không còn lặp; thông báo lấy từ `useNotify` (mock `../../hooks/use-notify`); các ca áp/gỡ mã, xem trước cũ, `busy`, bấm đúp GIỮ NGUYÊN khẳng định về lệnh gọi API.
- [ ] **Step 2:** chạy `cd apps/miniapp && npx vitest run src/components/checkout/voucher-sheet.spec.tsx` → đỏ.
- [ ] **Step 3:** viết lại phần danh sách: `pickerRows(couponsQ.data, { currentCode, subtotal, shippingFee, productIds, previews, now: serverNow(), displayCode: autoCouponName })` → `<VoucherPicker/>`; `useNotify` thay `useSnackbar`; tiêu đề `fillCopy('coupon.pickTitle')`; chữ ô nhập, rỗng lấy khoá `coupon.pick*`; bỏ `formatCouponDesc`, `Badge`, `Ticket` tự dựng. Gỡ hai dòng miễn.
- [ ] **Step 4:** chạy spec file này, `ds-shop-guard.spec.ts`, `ds-c076-pc10c3.spec.ts`, `freeship-copy.spec.ts`, `terminology.spec.ts` → xanh.
- [ ] **Step 5: commit** `feat(miniapp): bảng chọn mã dùng VoucherPicker, useNotify, hết HSD (K3, P1 #4 #8, P2 #6 #7 #10)`.

---

### Task 6: web `CouponBox` mở sheet dưới `md`, dùng `VoucherPicker`

**Files:** Modify `apps/web/src/components/coupon-box.tsx`; Delete `apps/web/src/lib/coupon-view.ts`, `coupon-view.spec.ts` (không còn nơi dùng); Test `apps/web/src/components/coupon-box.spec.tsx`.

**Interfaces:** `CouponBox` giữ nguyên props và export (`COUPON_MUTATION_KEY`, `PREVIEW_DEBOUNCE_MS`, `useSettled`, `couponPreviewKey`, `forgetAutoCoupon`).

- [ ] **Step 1:** sửa `coupon-box.spec.tsx` (đỏ trước): `useMediaQuery('(max-width: 767px)')` mock `true` → bấm dòng mở `role="dialog"` tên "Chọn mã giảm giá"; mock `false` → panel tại chỗ có tối đa 3 mã + "Xem thêm n mã"; nhãn nút cùng bộ với Mini (Dùng/Bỏ chọn/Chưa đủ/Không áp dụng); không `HSD`; không lặp "Đơn tối thiểu"; mã đã áp có nút "Bỏ chọn" gọi `removeCoupon`; ca tự áp một lần, `busy`, thông báo `notice` giữ nguyên.
- [ ] **Step 2:** chạy `cd apps/web && npx vitest run src/components/coupon-box.spec.tsx` → đỏ.
- [ ] **Step 3:** (a) `const phone = useMediaQuery('(max-width: 767px)'); const asSheet = sheet || phone;` danh sách mã vẽ bằng `pickerRows` + `VoucherPicker`; (b) `BottomSheet` (có sẵn, không sửa) chứa `panelBody` khi `asSheet`, panel tại chỗ khi không; (c) dòng mở giữ nguyên số đo, đổi `aria-expanded/controls` thành `aria-haspopup="dialog"` khi `asSheet`; (d) đổi mọi `stone/forest/clay` còn lại sang token ngữ nghĩa (`--color-text-primary`, `--color-text-tertiary`, `--color-text-brand`, `--color-border-subtle`, `--color-promo-bg`, `--color-promo-fg`, `--color-voucher-edge`); (e) "Bỏ mã đang áp dụng" chỉ hiện khi mã đang áp không nằm trong danh sách.
- [ ] **Step 4:** chạy `coupon-box.spec.tsx`, `ds-v2-guest.spec.ts`, `ds-shop-guard.spec.ts` (web), `pnpm exec tsc --noEmit` cho web → xanh.
- [ ] **Step 5: commit** `feat(web): bảng chọn mã ở thanh toán và giỏ mở sheet như Mini, dùng VoucherPicker (K3, P1 #4 #5 #8, P2 #9)`.

---

### Task 7: sheet Ưu đãi ở PDP xếp theo món, chép mã không đẩy sheet cao thêm

**Files:** Modify `apps/miniapp/src/components/product/pdp-offers-sheet.tsx`, `apps/web/src/app/san-pham/[slug]/pdp-extras.tsx` (`PdpCoupons`), một dòng mỗi nơi gọi (`apps/miniapp/src/pages/product-detail.tsx` truyền `amount` và dùng khoá `coupon.copiedToast`, `apps/web/src/app/san-pham/[slug]/page.tsx` truyền `product`); Test `pdp-offers-sheet.spec.tsx`, `pdp-extras.spec.tsx`.

**Interfaces:** `PdpOffersSheetProps` thêm `amount: number` (giá × số lượng đang xem). `PdpCoupons` thêm `product: { basePrice: number; salePrice?: number | null; variations: { id: string; retailPrice: number; salePrice?: number | null }[] }` (cùng kiểu `PdpPointsEarn`).

- [ ] **Step 1: test đỏ**: Mini `PdpOffersSheet` với `amount 120_000` xếp GIAM20K, FREESHIP, XANH10 và XANH10 có "Mua thêm 130k để dùng", nút vẫn "Sao chép" bấm được; web `PdpCoupons`: cùng thứ tự; bấm "Sao chép" KHÔNG thêm phần tử `role="status"` vào trong dialog (chiều cao dialog không đổi) mà hiện thông báo nổi `GameNoticeBar` ngoài dialog với chữ `coupon.copiedToast`; clipboard lỗi → `coupon.copyShowToast`.
- [ ] **Step 2:** chạy hai spec → đỏ. **Step 3:** cài đặt bằng `offerRows`; web dùng `useGameNotice` + `GameNoticeBar` (thông báo nổi có sẵn, z trên sheet) thay `note`. **Step 4:** chạy hai spec + `product-detail.spec`/`page.spec` của PDP → xanh.
- [ ] **Step 5: commit** `feat(pdp): sheet Ưu đãi xếp mã theo món đang xem, web báo chép mã bằng thông báo nổi (K3, P2 #4)`.

---

### Task 8: chốt: ratchet, e2e Mini, ảnh trước/sau, gate

- [ ] **Step 1:** `node scripts/uiux/ds-ratchet.mjs --write` (hạ baseline `voucher-sheet`, `coupon-box`, `open-snackbar`), `pnpm lint:parity`, `pnpm lint:vars` xanh; commit baseline.
- [ ] **Step 2:** e2e Mini: spec `checkout.miniapp.spec.ts`/`cart-lines.miniapp.spec.ts` có sẵn giữ xanh (tiêu đề "Chọn mã giảm giá"); thêm ca mở bảng chọn mã ở thanh toán với mock: 3 mã (dùng được, chưa đủ, đã áp), chụp axe 0 serious/critical, chữ lý do đạt 4,5:1 (đọc `getComputedStyle` màu chữ và nền, tính tỉ lệ). Không thêm vào `ds-parity.shop.spec.ts`: bảng chuẩn ở đó chỉ đo thẻ sản phẩm và tiêu đề khối trên trang chạy hoàn toàn bằng mock trình duyệt ở cả hai app, còn bảng chọn mã web nằm ở giỏ/thanh toán cần phiên đăng nhập; hai app dùng chung `VoucherPicker` và `VoucherTicket` cùng props nên số đo theo từ một nguồn. Ca e2e thực tế là `apps/e2e/tests/voucher-picker.miniapp.spec.ts` (tấm của giỏ Mini, axe color-contrast thay cho phép tính tay).
- [ ] **Step 3:** chụp 375px Mini và web trước/sau: bảng chọn mã (khách mới, khách cũ) và sheet Ưu đãi PDP → `docs/2026-10-31-shop-redesign/screens/K3/`.
- [ ] **Step 4:** gate: `bash docs/2026-10-28-review/tools/gate.sh <worktree> --base 62a02f232 --out …/gate-K3.txt`, rồi e2e Mini `--workers=2`.

---

### Ghi chú bàn giao (sau review)

Chạm file thuộc gói khác, chỉ ở chỗ gọi bảng mã, không đụng vùng gói đó sửa (gộp sẽ không xung đột hunk):

- `apps/miniapp/src/pages/product-detail.tsx` (K1 sở hữu phần nút/sheet): truyền `amount` cho `PdpOffersSheet` bằng `offerAmount(price, quantity, priceView.isFlash)`, dùng khoá `coupon.copiedToast`/`coupon.copyShowToast` ở `copyCoupon`, thêm một import.
- `packages/app-core/src/terminology.spec.ts` (K2 sở hữu dòng EXEMPT thanh toán): gỡ dòng miễn `voucher-sheet.tsx` USE.expiry vì phiếu không còn chữ "HSD".
- `apps/web/src/components/game/game-notice.tsx`: thêm tone `info` (nền `bg-info-bg`) để báo "không chép được mã" giống snackbar info của Mini; thay đổi cộng thêm, không đổi hai tone cũ.
- `apps/web/src/components/game/game-notice.tsx`: thêm prop `visualOnly` (aria-hidden, không role) cho thông báo nổi ngoài hộp thoại aria-modal; sheet Ưu đãi giữ vùng live `sr-only` cố định để đọc câu chép mã.
- `apps/web/src/app/gio-hang/page.tsx` (một dòng truyền `productIds`) và `apps/web/src/lib/shop-client.ts` (thêm `productId?` vào `CartLine`, API đã trả sẵn): chỉ cộng thêm.
- `apps/miniapp/src/css/tokens.css`: lớp `.tubu-field-44 .zaui-input` (cao 44, bỏ lề 4px) cho ô nhập mã, để ô và nút Áp dụng cùng 44 như web.

Hành vi cần biết khi gộp:

- `pickerRows`: mã bị máy chủ chặn vì lý do khác đơn tối thiểu (khách mới, sản phẩm, hết lượt, hạn) luôn là `blocked` kèm câu của máy chủ và nhãn "Không áp dụng", kể cả khi giỏ dưới đơn tối thiểu. Máy chủ nói đúng câu "Đơn tối thiểu … để dùng mã này." (hoặc im lặng khi giỏ dưới đơn tối thiểu) thì là `short` / "Chưa đủ" kèm CHÍNH câu của máy chủ, KHÔNG tự đếm "Mua thêm": tiền hàng máy chủ tính không có dòng Giờ vàng và đã trừ combo, còn `subtotal` của giỏ/thanh toán gồm cả dòng Giờ vàng nên số tự đếm thấp hơn số khách phải mua thêm thật. Chỉ phép đoán (chưa có xem trước) còn ghi "Mua thêm … để dùng", con số là ước.
- `pickerRows`: mã đang áp không bao giờ có `view.state` hết hạn/đã dùng (VoucherTicket ẩn nút chính ở các trạng thái đó nên khách mất "Bỏ chọn"); hạn đọc bằng `serverNow()` ở cả hai bảng chọn mã.
- Web `CouponBox` nhận thêm `productIds` (xuất `couponProductIds`); chỉ `gio-hang/page.tsx` truyền. `thanh-toan/page.tsx` (K2) chưa truyền: một dòng `productIds={couponProductIds(...)}` ở chỗ gọi `CouponBox` là đủ, người gộp thêm nếu muốn thanh toán web cũng báo "Chỉ áp cho …" trước khi xem trước về.
- `offerAmount`: món đang ở giá Giờ vàng góp 0 vào tiền hàng của sheet Ưu đãi (máy chủ loại dòng Giờ vàng khỏi tiền hàng áp mã).
