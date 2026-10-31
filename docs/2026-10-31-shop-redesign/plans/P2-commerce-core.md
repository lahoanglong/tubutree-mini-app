# P2 `commerce-core` Implementation Plan

> **Cho agent làm:** BẮT BUỘC dùng superpowers:subagent-driven-development hoặc superpowers:executing-plans. Bước dùng checkbox `- [ ]`.

**Mục tiêu:** đặt logic thẻ sản phẩm, nhãn, chữ, đồng hồ, mã giảm giá, bố cục bộ sưu tập, luật kệ và bảng chữ mua sắm vào `packages/app-core` để Mini App và web chỉ vẽ.

**Kiến trúc:** file thuần TypeScript (không React, không `window`) ở `packages/app-core/src/commerce/`, `merch/shelves.ts`, `shop-copy.ts`; mọi chữ hiển thị của `commerce/*` lấy từ `SHOP_COPY` qua `fillCopy`, không viết thẳng. Bản cũ của `couponLabel`, `formatSold`, `formatCountdown` thành re-export.

**Tech stack:** TypeScript, vitest (`packages/app-core`), pnpm. Chạy trong worktree `shop-P2`, nhánh `shop/P2-commerce-core`.

**Spec:** `docs/2026-10-31-shop-redesign/01-thiet-ke.md` (§4 là luật); chữ ký ở `02-ke-hoach.md` mục "Giao diện dùng chung / app-core" và mục P2. Nguồn: `review/design-system.md` B2–B3, `review/ia-merch.md` C1 + F, `review/ux-copy.md` B + D, `review/a11y.md` P1 (giá/nhãn đọc).

## Global Constraints

- Node: `export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH` cho mọi lệnh.
- Giữ đúng tên, chữ ký, đường import `@tubutree/app-core/commerce/<file>`, `@tubutree/app-core/merch/shelves`, `@tubutree/app-core/shop-copy`. Thêm trường optional hoặc export phụ được; không đổi/đổi tên cái đã chốt.
- Chữ: "Bán chạy nhất", "Miễn phí giao hàng", "Được yêu thích", "Tubu chọn", "Mã giảm giá", "Thương hiệu", "Tạm hết hàng", "Ngừng bán", "Kết thúc sau {t}". Không "Top", "Freeship", "Kho voucher", "Nhãn hàng". Chữ Giờ vàng theo `02-ke-hoach.md` (Vừa mở bán / Đã bán n% / Sắp hết / Đã bán hết), thắng `ux-copy.md` B1 khi khác.
- Giá giảm = `isDeal` (cam đậm do app vẽ); không có màu trong app-core.
- Không đụng file của gói khác: P1 (design-tokens, miniapp css, ui/badge|chip|button|bottom-sheet|icon, bottom-nav, use-notify, app.tsx, product-detail.tsx qua useNotify) và P3a/P3b (api, `api/catalog.ts` ngoài hai trường của P2, `api/brand|cart|storefront|flash-sale.ts`). `product-detail.tsx` giữ `couponLabel` cục bộ; ghi vào notes.
- Comment chỉ giải thích "vì sao", tiếng Việt, mật độ như file quanh đó. Không `git stash` trần, không push, không PROD.
- Máy thiếu RAM: chạy vitest theo file; gate đầy đủ đúng một lần ở cuối.

## Review Focus

1. Giờ vàng hết giờ khi khách đang xem: `now >= endAt` thì `isFlash=false`, không nhãn flash, giá thường. Ở T6.
2. Thiếu sao, thiếu đã bán, số rác (`NaN`, 0, âm): meta là `null` hoặc chỉ một nửa, không "★ NaN", không "Đã bán 0". Ở T2.
3. Kệ dưới `minItems` rồi một kệ xếp sau chứa cùng món: kệ bị ẩn không được "giữ" món, kệ sau vẫn hiện món đó; id lạ báo lỗi to. Ở T8.
4. Hết hàng: ẩn mọi nhãn nhưng giữ hạng và giá; nhãn Miễn phí giao hàng không bao giờ gắn khi chưa biết `fulfiller` hoặc chưa có ngưỡng. Ở T6.
5. Đồng hồ âm, `NaN`, đúng ranh giới 1 giờ / 24 giờ / 1 phút: không ném lỗi, không "00:60", không "0 giờ". Ở T3.

---

## File Structure

| File | Việc |
|---|---|
| `packages/app-core/src/shop-copy.ts` | `SHOP_COPY`, `SHOP_COPY_MAX`, `FORBIDDEN_TERMS`, `fillCopy` |
| `packages/app-core/src/commerce/card-meta.ts` | `formatRating`, `formatSoldShort`, `cardMetaLine` (+ `soldCountText` phụ) |
| `packages/app-core/src/commerce/countdown.ts` | `countdownClock`, `countdownText`, `countdownSpoken`, `formatCountdown` (chuyển từ `countdown-format.ts`) |
| `packages/app-core/src/commerce/flash-sold.ts` | `flashSoldText` |
| `packages/app-core/src/commerce/money.ts` | `vnd`, `vndShort` (phụ, dùng nội bộ) |
| `packages/app-core/src/commerce/voucher.ts` | `couponLabel`, `VoucherView`, `voucherView`, `sortVouchers` |
| `packages/app-core/src/commerce/product-card-view.ts` | `productCardView` và kiểu |
| `packages/app-core/src/commerce/collection-view.ts` | `SECTION_BUDGET`, `SHOP_MAX_SECTIONS`, `collectionView` |
| `packages/app-core/src/commerce/shop-stats.ts` | `shopStats` |
| `packages/app-core/src/merch/shelves.ts` | `SHELVES`, `shelf`, `applyShelfDedupe` |
| `packages/app-core/src/api/catalog.ts` | thêm `fulfiller?`, `isLoved?` vào `ProductCard` |
| `apps/miniapp/src/utils/format.ts`, `apps/web/src/lib/api.ts` | `formatSold` thành re-export |
| `apps/miniapp/src/components/loyalty/coupon-card.tsx`, `apps/web/src/lib/pdp-logic.ts`, `apps/web/src/app/uu-dai/page.tsx` | `couponLabel` thành re-export/import |
| `packages/app-core/src/countdown-format.ts` | thành re-export `formatCountdown` |

Mỗi `*.spec.ts` nằm cạnh file của nó. Lệnh kiểm một file: `cd packages/app-core && npx vitest run src/<đường dẫn>.spec.ts`.

---

### Task 1: `shop-copy.ts` (nguồn chữ + bảng thuật ngữ cấm)

**Files:** Create `src/shop-copy.ts`, `src/shop-copy.spec.ts`.

**Interfaces:**
- Produces:
  - `SHOP_COPY: Record<string, string>`: khoá `nhóm.tên`, mẫu có `{tên}`.
  - `SHOP_COPY_MAX: Record<string, number | null>`: số ký tự tối đa khi điền giá trị xấu nhất (`null` = câu dài, không giới hạn). Cùng tập khoá với `SHOP_COPY`.
  - `FORBIDDEN_TERMS: readonly { pattern: RegExp; use: string }[]`.
  - `fillCopy(key: string, vars?: Record<string, string | number>): string`: ném lỗi khi khoá lạ hoặc thiếu biến.

- [ ] **Step 1: Viết spec đỏ** `shop-copy.spec.ts`:
  - `SHOP_COPY` và `SHOP_COPY_MAX` cùng tập khoá; không khoá rỗng.
  - Với mỗi khoá có max: `fillCopy(key, WORST).length <= max`, `WORST = { t:'23:59:59', time:'12:00', day:'02/11', n:'99', pct:'99', d:'99', h:'23', m:'59', price:'999.999đ', save:'999.999đ', x:'999k', min:'999k', max:'999k', amount:'999.999đ', date:'31/12', avg:'5,0', i:'9', clock:'03:15' }`. Biến mang chữ tự do (`name`, `title`, `a`, `b`, `when`) chỉ dùng ở khoá `max: null`.
  - Không giá trị nào khớp `FORBIDDEN_TERMS`; không giá trị chứa `!`.
  - Bảng đối chứng `FORBIDDEN_TERMS`: bắt "Nhãn hàng", "Top bán chạy", "Freeship", "Kho voucher", "Flash sale", "ưu đãi giờ vàng", "HSD", "Chỉ còn 3", "Vui lòng", "chúng tôi", "cửa hàng", "...", "2h 05m"; bỏ qua "Giờ vàng", "Bán chạy nhất", "Topping", "Miễn phí giao hàng", "Hạn dùng", "Còn 3 sản phẩm", "…".
  - Giá trị chốt: `rank.title==='Bán chạy nhất'`, `badge.freeship==='Miễn phí giao hàng'`, `badge.loved==='Được yêu thích'`, `badge.featured==='Tubu chọn'`, `coupon.title==='Mã giảm giá'`, `brand.title==='Thương hiệu'`, `stock.out==='Tạm hết hàng'`, `stock.discontinued==='Ngừng bán'`, `fillCopy('flash.endsIn',{t:'02:05:33'})==='Kết thúc sau 02:05:33'`, `flash.justOpened==='Vừa mở bán'`, `flash.almostGone==='Sắp hết'`, `flash.soldOut==='Đã bán hết'`.
  - `fillCopy` ném với khoá lạ và với biến thiếu; thay mọi lần xuất hiện của một biến.
- [ ] **Step 2:** `npx vitest run src/shop-copy.spec.ts`, mong đợi FAIL (module chưa có).
- [ ] **Step 3: Cài đặt** `shop-copy.ts`: một bảng `ENTRIES: Record<string, readonly [text: string, max: number | null]>`, `SHOP_COPY` và `SHOP_COPY_MAX` suy ra từ đó (thêm khoá chỉ ở một chỗ). Khoá và chữ chép đúng `review/ux-copy.md` mục B1–B7 (tên khoá giữ nguyên, hàm `x(a)` thành mẫu `{a}`), cộng nhóm phụ P2 cần: `badge.discount` (`-{pct}%`), `badge.new`, `badge.featured`, `badge.loved`, `badge.freeship`, `badge.flashSpoken`, `badge.discountSpoken`, `stock.out`, `stock.discontinued`, `price.spoken`, `price.flashSpoken`, `price.compareSpoken`, `meta.rating`, `meta.sold`, `stats.*`, `time.*` (`days`, `daysHours`, `hoursMinutes`, `hours`, `minutes`, `underMinute`, `daysClock`), `coupon.freeship|amount|percent|percentMax|tabClaim|tabMine|tabHistory|title|oneCodeHint`, `brand.title`. Ngoại lệ so với ux-copy: chữ Giờ vàng theo `02-ke-hoach.md` ở Global Constraints. `max` lấy ở cột "Tối đa" của ux-copy; chỗ đo thực tế vượt thì ghi số đo thực (ví dụ `flash.startsAtDay` 23). `FORBIDDEN_TERMS` theo bảng D2 của ux-copy và Q5.
- [ ] **Step 4:** chạy lại spec, mong đợi PASS.
- [ ] **Step 5: Commit** `feat(app-core): shop-copy, bảng chữ mua sắm và thuật ngữ cấm`.

---

### Task 2: `card-meta.ts` + gộp hai bản `formatSold`

**Files:** Create `src/commerce/card-meta.ts`, `src/commerce/card-meta.spec.ts`. Modify `apps/miniapp/src/utils/format.ts:60-71`, `apps/web/src/lib/api.ts:444-454`.

**Interfaces:**
- Consumes: `fillCopy` (T1), `formatVnNumber` (`number-format.ts`).
- Produces: `formatRating(avg: number): string`; `formatSoldShort(n: number | null | undefined): string | null`; `cardMetaLine(p: Pick<ProductCard,'ratingAvg'|'sold'>): string | null`; `soldCountText(n): string | null` ("1,2k+", không tiền tố "Đã bán", `shop-stats` dùng).

- [ ] **Step 1: Spec đỏ.**
  - `formatRating(4.8)==='4,8'`, `(5)==='5,0'`, `(5.7)==='5,0'` (kẹp 5), `(NaN)===''`, `(0)===''`, `(-1)===''`.
  - `formatSoldShort`: bảng ca của `apps/miniapp/src/utils/format.spec.ts:205-235` (null/undefined/0/-5/NaN → `null`; 1 → "Đã bán 1"; 999; 1000 → "Đã bán 1k+"; 1200 và 1234 → "Đã bán 1,2k+"; 999_999 → "Đã bán 1000k+"; 1_000_000 → "Đã bán 1tr+"; 2_500_000 → "Đã bán 2,5tr+"). Giữ nguyên hành vi, hai spec cũ là chứng minh không hồi quy.
  - `cardMetaLine({ratingAvg:4.8,sold:1234})==='★ 4,8 · Đã bán 1,2k+'`; `({ratingAvg:4.8})==='★ 4,8'`; `({sold:12})==='Đã bán 12'`; `({})===null`; `({ratingAvg:0,sold:0})===null`; `({ratingAvg:NaN,sold:5})==='Đã bán 5'` (Review Focus 2); `cardMetaLine({ratingAvg:5,sold:99_900}).length <= 22` (ux-copy ước 20; số đo thực của "★ 5,0 · Đã bán 99,9k+" là 21).
- [ ] **Step 2:** chạy spec, mong đợi FAIL.
- [ ] **Step 3: Cài đặt** như chữ ký trên; thân `formatSoldShort` chuyển nguyên từ bản miniapp, chữ qua `fillCopy('meta.sold',{n})`. Sau đó đổi `formatSold` ở hai app thành `export { formatSoldShort as formatSold } from '@tubutree/app-core/commerce/card-meta'` (xoá thân cũ và comment "Bản sao của…").
- [ ] **Step 4:** chạy `card-meta.spec`, rồi `cd apps/miniapp && npx vitest run src/utils/format.spec.ts` và `cd apps/web && npx vitest run src/lib/api.spec.ts`, mong đợi PASS cả ba.
- [ ] **Step 5: Commit** `feat(app-core): card-meta, formatSold dùng chung cho Mini App và web`.

---

### Task 3: `countdown.ts` + chuyển `formatCountdown`

**Files:** Create `src/commerce/countdown.ts`, `src/commerce/countdown.spec.ts`. Modify `src/countdown-format.ts` (còn `export { formatCountdown } from './commerce/countdown'`).

**Interfaces:**
- Consumes: `fillCopy` (`time.*`).
- Produces: `countdownClock(ms): string`; `countdownText(ms): string`; `countdownSpoken(ms): string`; `formatCountdown(ms): string` (giữ nguyên hành vi cũ).

- [ ] **Step 1: Spec đỏ.**
  - `countdownClock`: `7_533_000→'02:05:33'`; `333_000→'05:33'`; `2*86_400_000+11_700_000→'2 ngày 03:15'`; `86_400_000→'1 ngày 00:00'`; `3_600_000→'01:00:00'`; `3_599_000→'59:59'`; `500→'00:01'` (làm tròn LÊN giây, chưa hết giờ không hiện 00:00); `0`, `-5`, `NaN` → `'00:00'`; `86_399_500→'1 ngày 00:00'` (không "00:60").
  - `countdownText`: `7_500_000→'2 giờ 05 phút'`; `3_600_000→'1 giờ 00 phút'`; `60_000→'1 phút'`; `59_000→'dưới 1 phút'`; `90_000_000→'1 ngày 1 giờ'`; `86_400_000→'1 ngày'`; `0`, `-1`, `NaN` → `''`.
  - `countdownSpoken`: `7_500_000→'2 giờ 5 phút'`; `7_200_000→'2 giờ'`; `300_000→'5 phút'`; `30_000→'dưới 1 phút'`; `90_000_000→'1 ngày 1 giờ'`; `0→''`.
  - `formatCountdown`: bảng ca của `src/countdown-format.spec.ts` vẫn xanh (không sửa file đó).
- [ ] **Step 2:** chạy spec, mong đợi FAIL.
- [ ] **Step 3: Cài đặt.** `countdownClock` tính theo giây làm tròn lên, nhánh ≥ 86 400 giây dùng phút làm tròn XUỐNG (tránh tràn 60). `countdownText`/`countdownSpoken` tính theo phút làm tròn xuống; khác nhau ở độ đệm (`05` và `5`) và bỏ phần 0 ở bản đọc. Chuyển thân `formatCountdown` nguyên văn.
- [ ] **Step 4:** chạy `commerce/countdown.spec.ts` và `countdown-format.spec.ts`; mong đợi PASS. Chạy thêm `cd apps/miniapp && npx vitest run src/hooks/use-countdown.spec.tsx` và `cd apps/web && npx vitest run src/lib/use-countdown.spec.tsx`.
- [ ] **Step 5: Commit** `feat(app-core): countdown clock/text/spoken, chuyển formatCountdown`.

---

### Task 4: `flash-sold.ts`

**Files:** Create `src/commerce/flash-sold.ts`, `src/commerce/flash-sold.spec.ts`.

**Interfaces:** Produces `flashSoldText(pct: number, soldOut: boolean): string`. Consumes `fillCopy`.

- [ ] **Step 1: Spec đỏ.** `(0,false)→'Vừa mở bán'`; `(1,false)→'Đã bán 1%'`; `(68,false)→'Đã bán 68%'`; `(89,false)→'Đã bán 89%'`; `(90,false)→'Sắp hết'`; `(92,false)→'Sắp hết'`; `(150,false)→'Sắp hết'`; `(100,true)→'Đã bán hết'`; `(0,true)→'Đã bán hết'` (hết suất thắng); `(NaN,false)` và `(-5,false)` → `'Vừa mở bán'`; `(0.4,false)→'Vừa mở bán'`, `(89.6,false)→'Sắp hết'` (làm tròn trước khi chia khoảng).
- [ ] **Step 2:** chạy, mong đợi FAIL.
- [ ] **Step 3: Cài đặt** như chữ ký; làm tròn `pct` rồi chia khoảng 0 / 1–89 / ≥90.
- [ ] **Step 4:** chạy, mong đợi PASS.
- [ ] **Step 5: Commit** `feat(app-core): flashSoldText`.

---

### Task 5: `money.ts` + `voucher.ts` + gộp bốn bản `couponLabel`

**Files:** Create `src/commerce/money.ts`, `src/commerce/voucher.ts`, `src/commerce/voucher.spec.ts`. Modify `apps/miniapp/src/components/loyalty/coupon-card.tsx:14-18`, `apps/web/src/lib/pdp-logic.ts:22-28`, `apps/web/src/app/uu-dai/page.tsx:36-40`. Không sửa `apps/miniapp/src/pages/product-detail.tsx` (P1 đang sửa; notes).

**Interfaces:**
- Consumes: `CouponDTO` (`api/loyalty.ts`), `formatVnNumber`, `fillCopy`.
- Produces:
  - `vnd(n: number): string` → "39.000đ"; `vndShort(n: number): string` → "50k", "1,5tr", số lẻ không tròn thì dạng đầy đủ (cùng luật `formatVndShort` của Mini App).
  - `couponLabel(c: Pick<CouponDTO,'type'|'value'|'maxDiscount'>): string`: giữ chữ hiện có của bốn bản ("Miễn phí giao hàng", "Giảm 10%", "Giảm 10% (tối đa 30.000đ)", "Giảm 20.000đ"). Đổi sang "Giảm 10%, tối đa 50k" (ux-copy `coupon.value`) là việc P14.
  - `VoucherView`, `voucherView(c: CouponDTO & VoucherFlags, now: number): VoucherView`, với `VoucherFlags = { claimed?: boolean; used?: boolean; soldOut?: boolean; ineligible?: boolean }` (tất cả optional, nên gọi với `CouponDTO` thuần vẫn đúng chữ ký đã chốt). Mặc định coi là mã trong ví (`claimed` thiếu = đã lưu).
  - `sortVouchers<T extends { expiresAt?: string | null }>(list: T[], now: number): T[]`.

- [ ] **Step 1: Spec đỏ.**
  - `couponLabel`: bốn ca của `apps/web/src/lib/pdp-logic.spec.ts:29-32`.
  - `vnd(39000)==='39.000đ'`; `vndShort`: `50000→'50k'`, `1_500_000→'1,5tr'`, `199_000→'199k'`, `12_345→'12.345đ'`.
  - `voucherView` với `now` cố định: AMOUNT 30 000, `minOrder` 199 000, hết hạn sau 10 ngày → `{ kind:'discount', title:'Giảm 30.000đ', condition:'Đơn từ 199k', expiry:'Dùng đến <dd/mm giờ Việt Nam>', state:'saved' }`; `minOrder` null → `condition===''`; FREESHIP → `kind:'freeship'`; `products` có phần tử → `kind:'shop'` (comment: API chưa trả phạm vi gian hàng, P14 tinh chỉnh); `endAt <= now` → `state:'expired'`; còn dưới 24 giờ → `expiry:'Hết hạn hôm nay'`; còn 2 ngày → `'Còn 2 ngày'`; ưu tiên `used` > `expired` > `soldout` > `ineligible` > `collectable` (`claimed:false`) > `saved`.
  - `sortVouchers`: hết hạn sớm nhất trước, không hạn sau các mã còn hạn, mã đã hết hạn cuối cùng, ổn định khi hoà, không đổi mảng vào.
- [ ] **Step 2:** chạy `voucher.spec.ts`, mong đợi FAIL.
- [ ] **Step 3: Cài đặt** như chữ ký; ngày đọc theo UTC+7 cố định (cộng 7 giờ rồi `getUTC*`), cùng cách `utils/format.ts` của Mini App. Hai app: `coupon-card.tsx` và `pdp-logic.ts` thay thân bằng `export { couponLabel } from '@tubutree/app-core/commerce/voucher'`; `uu-dai/page.tsx` xoá hàm cục bộ và import.
- [ ] **Step 4:** chạy `voucher.spec.ts`; `cd apps/web && npx vitest run src/lib/pdp-logic.spec.ts`; `cd apps/miniapp && npx vitest run src/components/loyalty`, mong đợi PASS.
- [ ] **Step 5: Commit** `feat(app-core): voucher view, couponLabel dùng chung (3 bản gộp)`.

---

### Task 6: `productCardView` + hai trường mới của `ProductCard`

**Files:** Create `src/commerce/product-card-view.ts`, `src/commerce/product-card-view.spec.ts`. Modify `src/api/catalog.ts` (`ProductCard`, sau `createdAt`).

**Interfaces:**
- Consumes: `cardPricing`, `isFlashRunning` (`flash-price.ts`), `isNewProduct` (`product-badges.ts`), `cardMetaLine` (T2), `vnd` (T5), `fillCopy` (T1).
- Produces: đúng các kiểu và hàm ở `02-ke-hoach.md` ("commerce/product-card-view.ts"), kèm hai trường optional thêm vào `ProductCardInput`: `launchDate?: string | null` (để "Mới" giữ luật `catalog.launch_date` như `ProductTile` hiện nay; thiếu thì luật 30 ngày). `ProductCard` thêm `fulfiller?: ProductFulfiller; isLoved?: boolean`.

Quy tắc (nguồn design-system B2–B3, ux-copy B3):
- Giá: `cardPricing(product, flash ? [flash] : [], now)`; `isDeal = isFlash || discountPct > 0`; `compareAt`, `discountPct` lấy từ đó.
- Khe theo biến thể: `grid` ảnh+nhãn; `rail-md` ảnh+nhãn; `rail-sm` không; `flash` chỉ ảnh và chỉ khi `isFlash`; `rank` ảnh, không nhãn; `line` không. `brandLine` chỉ ở `grid` và `rail-md` và khi `showBrand !== false`.
- `imageBadge`: `isFlash` → `{kind:'flash', text:'Giờ vàng -x%' (chỉ '-x%' ở rail-sm và flash), spoken:'Giờ vàng giảm x%'}`; không thì `discountPct>0` → `{kind:'discount', text:'-x%', spoken:'Giảm x%'}`.
- `label` ưu tiên combo (`inCombo`) > featured (`isFeatured`) > loved (`isLoved`) > new (`isNewProduct`) > freeship (`fulfiller?.kind==='TUBU'` và `freeShipThreshold != null` và `price >= freeShipThreshold`).
- Hết hàng (`inStock===false`): `imageBadge=null`, `label=null`, `stock='out'`, `stockText='Tạm hết hàng'`; `rank` và giá giữ.
- `spoken.price`: "Giá 39.000đ" / "Giá Giờ vàng 39.000đ" + ", giá gốc 52.000đ" khi có `compareAt`; `spoken.stock`: `stockText`; `spoken.badges`: các `spoken` của `imageBadge` rồi `label` nối ", ", hoặc `null`.

- [ ] **Step 1: Spec đỏ** (fixture `ProductCard` có `fulfiller`, `isLoved`, nên `tsc` cũng kiểm kiểu mới):
  - Flash đang chạy (`endAt` > `now`, `flashPrice` < giá bán) → `isFlash`, `imageBadge.kind==='flash'`, `isDeal`, `price===flashPrice`, `compareAt` là giá đang bán.
  - `now > endAt` và `now === endAt` → `isFlash=false`, `imageBadge.kind` là `'discount'` hoặc `null`, giá thường (Review Focus 1). Flash của slug khác, hoặc `flashPrice >=` giá bán, bị bỏ qua.
  - Hết hàng: `label===null`, `imageBadge===null`, `stockText==='Tạm hết hàng'`, `stock==='out'`, `rank` còn nguyên (Review Focus 4).
  - Ưu tiên nhãn: bật dần từng điều kiện theo thứ tự ngược (freeship, new, loved, featured, combo) rồi kiểm `label.kind` đổi đúng.
  - Freeship: `fulfiller.kind==='TUBU'` và `price>=threshold` → có; `price<threshold` → không; `threshold` null/undefined → không; `fulfiller` thiếu hoặc `MERCHANT` → không.
  - "Mới": `createdAt` trong 30 ngày → `label.kind==='new'`; kèm `launchDate` sau `createdAt` → không.
  - `variant`: `rail-sm` → `imageBadge` và `label` null, `brandLine` null; `grid` + `showBrand:false` → `brandLine` null; `flash` không flash → `imageBadge` null; `line` → cả hai null.
  - `meta` bằng `cardMetaLine`; `spoken.price` hai dạng; `spoken.badges` ghép đúng; `rank` truyền qua.
- [ ] **Step 2:** chạy spec, mong đợi FAIL.
- [ ] **Step 3: Cài đặt** `productCardView(input: ProductCardInput): ProductCardView` theo bảng quy tắc; thêm hai trường vào `ProductCard`.
- [ ] **Step 4:** chạy spec, rồi `cd packages/app-core && npx tsc --noEmit`, mong đợi PASS.
- [ ] **Step 5: Commit** `feat(app-core): productCardView, ProductCard thêm fulfiller và isLoved`.

---

### Task 7: `collectionView` + `shopStats`

**Files:** Create `src/commerce/collection-view.ts`, `src/commerce/collection-view.spec.ts`, `src/commerce/shop-stats.ts`, `src/commerce/shop-stats.spec.ts`.

**Interfaces:**
- `SECTION_BUDGET = { rail: 10, grid: 6, line: 5 } as const`; `SHOP_MAX_SECTIONS = 6`; `SectionView<T>`; `collectionView<T>(c)` đúng chữ ký đã chốt.
- `ShopStat`, `shopStats(i): ShopStat[]` đúng chữ ký đã chốt. Consumes `formatRating`, `soldCountText`, `fillCopy('stats.*')`.

- [ ] **Step 1: Spec đỏ.**
  - `collectionView`: CAROUSEL 14 món → `layout:'rail'`, 10 món, `total:14`, `hasMore:true`; CAROUSEL 10 món → `hasMore:false`; GRID 9 → `grid`, 6 món, `hasMore:true`; STACK 8 → `line`, 5 món; `kind:'COMBO'` → `layout:'combo'`, đủ món, `comboPct` bằng `comboDiscountPct`, `hasMore:false`; COMBO với pct `null`, 0 hoặc `NaN` → `comboPct:null`; không COMBO → `comboPct:null`; `items:[]` → `items:[]`, `total:0`, `hasMore:false` (Review Focus, bộ sưu tập rỗng); `layout` lạ → `grid`; không đổi mảng vào.
  - `shopStats`: `{productCount:124, ratingAvg:4.8, sold:1234}` → 3 mục `Sản phẩm/124/'124 sản phẩm'`, `Đánh giá/'4,8'/'4,8 sao'`, `Đã bán/'1,2k+'/'Đã bán hơn 1.200'`; thiếu `ratingAvg` hoặc `sold` < 1 → bỏ mục đó; `productCount:0` vẫn hiện mục Sản phẩm.
- [ ] **Step 2:** chạy hai spec, mong đợi FAIL.
- [ ] **Step 3: Cài đặt** như chữ ký; cắt theo `SECTION_BUDGET[layout]`; bản đọc số bán: dưới 1000 đọc nguyên số, từ 1000 "hơn" số tròn trăm (nghìn) hoặc tròn trăm nghìn (triệu).
- [ ] **Step 4:** chạy, mong đợi PASS.
- [ ] **Step 5: Commit** `feat(app-core): collectionView và shopStats`.

---

### Task 8: `merch/shelves.ts` + `shelves.spec.ts`

**Files:** Create `src/merch/shelves.ts`, `src/merch/shelves.spec.ts`.

**Interfaces:**
- Produces: `ShelfScreen`, `ShelfSpec`, `SHELVES`, `shelf(id)`, `applyShelfDedupe` đúng chữ ký đã chốt. Id kệ có tiền tố màn (`home.flash`, `browse.bestSellers`, `offers.flash`...) vì `flash` và `bestSellers` xuất hiện ở hai màn mà `shelf(id)` chỉ nhận id.
- `SHELVES` (id: layout, max, min, dedupeRank, seeAllRoute):
  - `home.flash`: rail, 8, 3, 1, `/flash-sale`; `home.purchased`: line, 10, 1, 2, `/orders`; `home.combos`: rail, 4, 2, 3, null; `home.bestSellers`: rail, 10, 3, 4, `/best-sellers`; `home.suggest`: feed, 100, 4, 6, `/browse`.
  - `browse.recent`: rail, 10, 1, null, null; `browse.bestSellers`: rail, 10, 3, 4, `/best-sellers`.
  - `pdp.combos`: rail, 2, 1, null, null; `pdp.addons`: line, 3, 1, null, null; `pdp.boughtTogether`: rail, 6, 3, 4, null; `pdp.related`: feed, 20, 4, 6, null.
  - `shop.section`: rail, `SECTION_BUDGET.rail`, 1, null, null (layout thật theo `collectionView`).
  - `offers.flash`: rail, 4, 1, 1, `/flash-sale`.
  - `intent` mỗi kệ khác nhau trong một màn (chữ ngắn: "deal có hạn", "mua lại", "mua nhiều tiết kiệm", "xã hội chứng thực", "khám phá", "quay lại món đã xem", "mua kèm", "khách thường mua cùng", "bộ sưu tập của shop").
- `applyShelfDedupe`: xử lý theo `dedupeRank` tăng dần (null không tham gia, chỉ cắt `maxItems`); mỗi kệ bỏ id đã bị kệ hạng cao hơn chiếm và id lặp trong chính nó, rồi cắt `maxItems`, rồi nếu `< minItems` trả `[]` và KHÔNG chiếm id; trả về theo thứ tự đầu vào; id không có trong `SHELVES` thì ném lỗi. Hạng 5 để dành cho kệ "Mới về" (chưa có).

- [ ] **Step 1: Spec đỏ** `shelves.spec.ts`:
  - Mọi kệ: `maxItems` và `minItems` là số nguyên dương, `minItems <= maxItems`, `maxItems <=` trần theo layout (`rail 10, line 10, grid 12, feed 100`); id duy nhất; `shelf(id)` trả đúng, id lạ ném.
  - `seeAllRoute` có trong `src/route-map.json` (đọc `routes[].items[].miniapp`), trừ `PLANNED_ROUTES = ['/flash-sale','/best-sellers']` (P12, P13 tạo; comment ghi gói và "xoá dòng này khi route vào route-map").
  - Không màn nào có hai kệ cùng `intent`.
  - Trang chủ: số kệ `layout !== 'feed'` ≤ 4 cho khách cũ (đủ 4) và khách mới (không tính `home.purchased`, còn 3).
  - `applyShelfDedupe`: món ở `home.flash` bị loại khỏi `home.bestSellers` và `home.suggest`; kệ cao hơn chiếm trước dù đứng sau trong mảng đầu vào; kết quả giữ thứ tự đầu vào; cắt `maxItems`; id lặp trong một kệ chỉ giữ một; kệ dưới `minItems` → `[]` và món của nó vẫn hiện ở kệ xếp sau (Review Focus 3); kệ `dedupeRank:null` không loại và không chiếm; mảng rỗng → `[]`; id lạ ném; không đổi mảng vào.
- [ ] **Step 2:** `npx vitest run src/merch/shelves.spec.ts`, mong đợi FAIL.
- [ ] **Step 3: Cài đặt** `shelves.ts` theo bảng trên. Comment "vì sao" cho id tiền tố, hạng 5, kệ ẩn không chiếm id.
- [ ] **Step 4:** chạy, mong đợi PASS.
- [ ] **Step 5: Commit** `feat(app-core): merch/shelves, sổ kệ và chống trùng`.

---

### Task 9: Chốt gói

- [ ] **Step 1:** `cd packages/app-core && npx tsc --noEmit && npx vitest run` (toàn bộ app-core một lần). Mong đợi 0 lỗi kiểu, mọi spec xanh (nền là 106 file / 1335 test, cộng spec mới).
- [ ] **Step 2:** `cd apps/miniapp && npx tsc --noEmit`; `cd apps/web && npx next typegen >/dev/null && npx tsc --noEmit`; `pnpm lint:parity`. Mong đợi xanh.
- [ ] **Step 3:** từ worktree: `bash docs/2026-10-28-review/tools/gate.sh /Users/longla/coding/tubutree-mini-app/.claude/worktrees/shop-P2 --base 64abdc5e5 --out /Users/longla/coding/tubutree-mini-app/.claude/worktrees/gate-P2.txt` đúng một lần. Bước FAIL: so với base; có sẵn thì ghi "có sẵn", do gói thì sửa tới PASS.
- [ ] **Step 4:** tự rà theo bảng dưới; mọi thứ commit (gate đọc `BASE..HEAD`).

## Self-review (đã đối chiếu)

| Yêu cầu của mục P2 | Task |
|---|---|
| Tạo đúng file + chữ ký "Giao diện dùng chung" | T1–T8 |
| Chuyển `couponLabel` (4 bản), `formatSold` (2 bản), `formatCountdown`; bản cũ re-export | T5 (3/4 bản, bản `product-detail.tsx` ghi notes), T2, T3 |
| `SHELVES` khai đủ + `shelves.spec` chặn bốn luật | T8 |
| `SHOP_COPY`, `FORBIDDEN_TERMS`, `shop-copy.spec` (ngân sách độ dài) | T1 |
| Test chứng minh: `productCardView`, `cardMetaLine`, `countdownClock`, `flashSoldText`, `applyShelfDedupe`, `collectionView` | T6, T2, T3, T4, T8, T7 |
| `ProductCard` thêm `fulfiller?`, `isLoved?` | T6 |

Lệch có chủ ý (ghi vào deviations): id kệ có tiền tố màn; `ProductCardInput.launchDate?` thêm; `voucherView` nhận thêm cờ optional; `couponLabel` giữ chữ cũ; chữ Giờ vàng theo `02-ke-hoach.md`; `product-detail.tsx` giữ bản cục bộ.
