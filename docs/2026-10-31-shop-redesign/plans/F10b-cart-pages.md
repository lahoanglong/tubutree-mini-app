# F10b `cart-pages` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sửa bốn lỗi P1 của review hình bước chốt (`review/final-critique.md` số 5, 6, 7, 8): trang Mini thừa 48px đầu, hai "giá gốc" của món Giờ vàng ở giỏ, chân dính giỏ cao 265px, gợi ý mã bị cắt.

**Architecture:** (5) bỏ lớp `page` ở 4 trang Mini như `cart.tsx`, thanh dính dùng `sticky-below-back`. (6) một hàm thuần `strikePrice` ở `packages/shared-types` là nguồn duy nhất của giá gạch; API giỏ (`listUnitPrice`) và `variationPricing` của app-core cùng gọi nó, `cardPricing`/`flashDisplay` được spec ghim bằng nó. Chỉ đổi trường hiển thị, không đổi số tiền khách trả. (7) `StickyActionBar` Mini nhận `lead` + `dense`, web bố trí lại chân dính cùng một khuôn: hàng mã, một dòng miễn phí giao (có thanh chỉ khi chưa đạt), hàng tổng + nút. (8) `couponHintShort` ở app-core cho hàng mã trong giỏ hai app.

**Tech Stack:** pnpm + turbo, React 18 + zmp-ui + Vite (Mini), Next 15 + Tailwind (web), NestJS + jest, vitest, Playwright.

**Spec:** `docs/2026-10-31-shop-redesign/01-thiet-ke.md` (§4 Q2, Q3, §5 "Giỏ"), `docs/2026-10-31-shop-redesign/02-ke-hoach.md` (Global Constraints, F10b), `review/final-critique.md` P1 #5–#8, `review/critique-shop.md` CT-04.

## Global Constraints

- Node: `export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH`; worktree mới: `pnpm --filter @tubutree/shared-types build` và `cd apps/api && npx prisma generate` trước gate (rebuild shared-types sau Task 2).
- Giá giảm màu `--color-text-price-deal`; giá thường đen; không đỏ. Vùng chạm ≥44px, tương phản ≥4,5:1.
- Chữ mua sắm đi qua `SHOP_COPY` + `shop-copy-budget.ts` (khoá thêm phải có ở cả hai file, chữ ≤ ngân sách); không dùng "Freeship", "Voucher", "Top".
- ĐƯỜNG TIỀN: số khách trả (`unitPrice`, `total`, `subtotal`, giảm combo/mã/hạng, tổng) KHÔNG đổi; chỉ `listUnitPrice` (hiển thị) đổi. Review như gói tiền.
- Mini ↔ web cùng khuôn (luật `AGENTS.md`); không sửa file thuộc F10a/F10c/F10d: `scroll-row.tsx`, `product-tile.tsx`, `tile-metrics.ts`, `card-meta.ts`, `flash-slots.ts`, PDP web, `offers*`, `voucher-ticket.tsx`, `voucher.ts`, `check-in`, `GuestLinkCard`, `ctv/gian-hang`, `storefront-section-detail.tsx`.
- Không deploy, không đọc/ghi PROD, không push, không `git stash` trần. Comment chỉ giải thích "vì sao" (tiếng Việt).
- Máy thiếu RAM: chỉ chạy vitest/jest theo file khi làm; gate đầy đủ một lần ở cuối.

## Review Focus

1. Món Giờ vàng mà giá Giờ vàng ≥ giá đang bán (không thắng), hoặc vượt giới hạn suất (giỏ tính giá thường): giá gạch về giá niêm yết, không bao giờ gạch giá thấp hơn giá bán. Test: Task 2 `strike-price.spec` + `cart.service.spec`.
2. Giỏ chưa chọn dòng nào, chọn một phần, có dòng hết hàng (`payHint`): chân dính vẫn một hàng tổng + nút (nút khoá), nội dung cuối không bị che dù chân cao thêm. Test: Task 3 e2e `cart-footer` (ca 8 dòng + hết hàng), vitest `cart.spec`.
3. Màn 320px: tổng và nút không tràn ngang, nút không rớt hàng. Test: Task 3 e2e ở 320.
4. Tai thỏ/đáy (`--safe-bottom` 34px): chân cao đúng base + safe-bottom, dòng cuối vẫn cuộn ra khỏi chân. Test: Task 3 e2e.
5. Gợi ý mã dài (9 mã, số lẻ 123.456đ) hoặc không có số tiền: vừa một dòng, không đẩy "Chọn mã" ra ngoài. Test: Task 4.

---

## File Structure

| File | Việc |
|---|---|
| `apps/miniapp/src/pages/{best-sellers,flash-sale,campaign,vouchers}.tsx` | bỏ `className="page"`, đổi offset dính (T1) |
| `apps/e2e/tests/page-title-row.miniapp.spec.ts` (mới) | đo vị trí tiêu đề 4 trang (T1) |
| `packages/shared-types/src/price.ts` (mới) + `index.ts` | `strikePrice` (T2) |
| `packages/app-core/src/flash-price.ts`, `commerce/strike-price.spec.ts` (mới), `api/cart.ts` | `variationPricing` dùng `strikePrice`, spec khớp thẻ ↔ giỏ (T2) |
| `apps/api/src/modules/cart/cart.service.ts` + `.spec.ts`, `test/integration-race/cart-combo-equals-quote.race-spec.ts` | `listUnitPrice` theo `strikePrice`, spec tiền không đổi (T2) |
| `apps/miniapp/src/components/ui/sticky-action-bar.tsx` + spec, `pages/cart.tsx` + `cart.spec.tsx` | chân dính gọn Mini (T3) |
| `apps/web/src/app/gio-hang/page.tsx` + `page.spec.tsx` | chân dính gọn web (T3) |
| `apps/e2e/tests/cart-footer.miniapp.spec.ts`, `cart-footer.web.spec.ts` (mới) | đo chân dính (T3, T4) |
| `packages/app-core/src/coupon-use.ts` + spec, `shop-copy.ts`, `shop-copy-budget.ts` | `couponHintShort` (T4) |
| `apps/web/src/components/coupon-box.tsx` + spec | hàng mã dùng chữ gọn (T4) |

---

### Task 1: Mini bỏ lớp `page` ở 4 trang (P1 #5)

**Files:**
- Modify: `apps/miniapp/src/pages/best-sellers.tsx:26-35,69`, `flash-sale.tsx:48-62,321`, `campaign.tsx:94`, `vouchers.tsx:28-34,134`
- Create: `apps/e2e/tests/page-title-row.miniapp.spec.ts`

**Interfaces:**
- Consumes: `PageHeader` (đệm `12px + --safe-top`, chừa trái 48px khi có nút lùi), lớp CSS `sticky-below-back` (`body.with-back-btn .sticky-below-back { top: calc(var(--safe-top) + 56px) !important }`).
- Produces: không đổi tên/prop; mỗi trang là `<Page style=...>` không `className="page"`.

- [ ] **Step 1: test đỏ** `page-title-row.miniapp.spec.ts` (375×812, `--safe-top` 0 và 47 như `sticky-below-back.miniapp.spec.ts`): với `/best-sellers`, `/flash-sale`, `/campaign/<slug>`, `/vouchers` (mock có sẵn của `best-sellers.miniapp`, `flash-slot-mocks`, `campaign-mocks`, `voucher-mocks`), vào bằng `state.from` để có nút lùi (điều hướng từ `/` bằng nút/`history`): `h1.boundingBox().y + height/2` nằm trong dải thanh lùi (`< 56 + safe`), `|tâm h1 − tâm nút Quay lại| ≤ 12`, `h1.x ≥ 56`. Thêm ca cuộn: sau khi cuộn hết, hàng dính (`getByTestId('flash-sticky')`, tablist của best-sellers/vouchers) có `y` = `56 + safe` (không hở, không chồng).
- [ ] **Step 2: chạy thấy FAIL**: `cd apps/e2e && E2E_SCOPE=miniapp E2E_MINIAPP_PORT=3369 npx playwright test tests/page-title-row.miniapp.spec.ts --workers=1 --reporter=line` → tiêu đề `y` ~ 60+ (hàng hai).
- [ ] **Step 3: sửa**: bỏ `className="page"` ở 4 trang. Thanh dính: `flash-sale.tsx` `STICKY` đổi `top` thành `'var(--safe-top)'` và gắn `className="sticky-below-back"` ở `data-testid="flash-sticky"`, xoá `PAGE_TOP_PADDING` và phần chú thích cũ nói trừ đệm; `best-sellers.tsx` `TABS_BAR`, `vouchers.tsx` `STICKY_BAR` cùng đổi `top: 'var(--safe-top)'` + `className="sticky-below-back"`, viết lại chú thích (trang không có đệm `.page` nên `top` đo từ mép trên vùng cuộn, lớp `sticky-below-back` đẩy xuống dưới thanh lùi khi có nút lùi, giống `game.tsx:179`).
- [ ] **Step 4: chạy PASS** spec trên + `flash-slots.miniapp`, `best-sellers.miniapp`, `vouchers.miniapp`, `campaigns.miniapp`, `sticky-below-back.miniapp` (không hồi quy) và vitest `flash-sale.spec.tsx best-sellers.spec.tsx vouchers.spec.tsx campaign.spec.tsx` của Mini.
- [ ] **Step 5: Commit** `fix(miniapp): bốn trang mua sắm bỏ lớp page, tiêu đề cùng hàng nút lùi`

---

### Task 2: Một nguồn giá gạch cho thẻ, trang Giờ vàng và giỏ (P1 #6)

**Files:**
- Create: `packages/shared-types/src/price.ts`; `packages/app-core/src/commerce/strike-price.spec.ts`
- Modify: `packages/shared-types/src/index.ts`, `packages/app-core/src/flash-price.ts` (`variationPricing`), `packages/app-core/src/api/cart.ts` (chú thích `listUnitPrice`), `apps/api/src/modules/cart/cart.service.ts:200-208`, `apps/api/src/modules/cart/cart.service.spec.ts:639-670`, `apps/api/test/integration-race/cart-combo-equals-quote.race-spec.ts`

**Interfaces:**
- Produces: `export function strikePrice(i: { retailPrice: number; salePrice?: number | null; flashPrice?: number | null }): number` trong `@tubutree/shared-types`. Luật (đúng `flash-price.ts` đầu file): Giờ vàng thắng (`flashPrice != null && flashPrice < salePrice ?? retailPrice`) → trả giá đang bán (`salePrice ?? retailPrice`); ngược lại trả `retailPrice`. Màn đọc `discountView(price, strikePrice)` như cũ nên giá gạch không cao hơn giá bán thì không vẽ.
- `CartLine.listUnitPrice` (API) đổi nghĩa thành "giá gạch của dòng theo `strikePrice`", `lineCompareAt/lineSaving/cartSaving` (`commerce/pdp-view.ts`) giữ nguyên.

- [ ] **Step 1: test đỏ** `strike-price.spec.ts` (app-core): bảng (retail, sale, flash) gồm (59000, 50000, 33000) → 50000; (59000, null, 33000) → 59000; (59000, 50000, null) → 59000; (59000, 50000, 50000) và flash 60000 (không thắng) → 59000; sale null, flash null → retail. Ca khớp: với mỗi hàng bảng, `variationPricing({id, retailPrice, salePrice}, flash).compareAt`, `cardPricing({slug, basePrice: retail, salePrice: sale}, [flash]).compareAt` và `lineCompareAt({ unitPrice: price, listUnitPrice: strikePrice(...) })` bằng nhau (cùng `null` hoặc cùng số).
- [ ] **Step 2: chạy FAIL** (`pnpm --filter @tubutree/shared-types build` rồi `cd packages/app-core && npx vitest run src/commerce/strike-price.spec.ts`): thiếu `strikePrice`.
- [ ] **Step 3: cài** `price.ts` + export; `variationPricing` đọc `strikePrice` thay hai nhánh `isFlash ? standing : retail`; chú thích `listUnitPrice` ở `api/cart.ts` nói đúng luật.
- [ ] **Step 4: test đỏ API** `cart.service.spec.ts`: sửa ca "đang Giờ vàng" kỳ vọng `listUnitPrice: 42000` (giá đang bán); thêm ca Giờ vàng không thắng (flash 45000 với sale 42000) → `listUnitPrice: 50000`; thêm ca "tiền không đổi": dòng retail 59000, sale 50000, flash 33000, SL 2 → `unitPrice 33000`, `total 66000`, `cart.subtotal 66000`, `discount 0`, `comboDiscount 0`, và `toEqual` các trường tiền của cùng giỏ khi `listUnitPrice` bị bỏ khỏi so sánh với giỏ không Giờ vàng cùng giá bán (chứng minh tổng độc lập `listUnitPrice`).
- [ ] **Step 5: cài** `cart.service.ts`: `listUnitPrice: strikePrice({ retailPrice, salePrice, flashPrice: flash?.flashPrice })` (cần `flash` thắng theo `priceFlashLine`; `flash` null khi vượt suất thì không truyền flashPrice), sửa chú thích dòng 206. Chạy `cd apps/api && npx jest src/modules/cart src/modules/checkout` PASS.
- [ ] **Step 6: race**: thêm ca vào `cart-combo-equals-quote.race-spec.ts` — sản phẩm retail 59.000, sale 50.000, Giờ vàng 33.000 (suất còn): `c.items[0]` có `listUnitPrice 50_000`, `unitPrice 33_000`; `cartQuoteOrder` cho `numbers` giỏ = báo giá = đơn; so `cardPricing` của chính sản phẩm đó (`compareAt`) bằng `listUnitPrice`. Chạy trên cụm riêng: `bash docs/2026-10-20-uat/tools/pg-native.sh start 25557`, tạo DB `tubutree_it`, `DATABASE_URL=postgresql://tubu@127.0.0.1:25557/tubutree_it npx prisma migrate deploy`, rồi `npx jest -c test/integration-race/jest.config.js --runInBand test/integration-race/cart-combo-equals-quote.race-spec.ts test/integration-race/cart-batch.race-spec.ts`; xong `pg-native.sh stop 25557`.
- [ ] **Step 7: Commit** `fix(api): giá gạch dòng giỏ theo một luật với thẻ và trang Giờ vàng (strikePrice), tiền không đổi`

---

### Task 3: Chân dính giỏ gọn, hai app (P1 #7)

**Files:**
- Modify: `apps/miniapp/src/components/ui/sticky-action-bar.tsx`, `apps/miniapp/src/pages/cart.tsx` (`StickySummary`, `CouponRow` giữ, `Page` `paddingBottom`), `apps/web/src/app/gio-hang/page.tsx` (khối `StickyActionBar` cuối file, `showFreeship`)
- Modify (test): `apps/miniapp/src/pages/cart.spec.tsx`, `apps/web/src/app/gio-hang/page.spec.tsx`
- Create: `apps/e2e/tests/cart-footer.miniapp.spec.ts`, `apps/e2e/tests/cart-footer.web.spec.ts`

**Interfaces:**
- Produces (Mini): `StickyActionBarProps` thêm `lead?: ReactNode` (cùng hàng với nút chính, bên trái, `flex:1; minWidth:0`) và `dense?: boolean` (đệm `8px 16px calc(8px + var(--safe-bottom))`, khe `4px`); nút chính trong hàng đó `flex: 0 0 auto; minWidth: 148`. Thanh ghi chiều cao của nó vào `--sticky-bar-h` ở `document.documentElement` (ResizeObserver, bỏ khi không có API) để trang chừa đáy.
- Bố cục (hai app, từ trên xuống): hàng mã 44px · dòng miễn phí giao (đạt: một dòng chữ, KHÔNG thanh; chưa đạt: chữ + thanh 4px; `data-testid="freeship-bar"` chỉ khi có thanh) · dòng giảm combo/mã/hạng gọn (đệm dọc 1px) · hàng cuối: trái `Tạm tính`/`Tạm tính (đã giảm)` (nhãn caption) + số tiền 18/700 + `Tiết kiệm {x}` (`data-testid="cart-saving"`), phải nút `Thanh toán (n)`. Nhãn và số tiền cùng một phần tử cha (spec cũ đọc `getByText('Tạm tính').parentElement`).
- Mục tiêu đo ở 375px, `--safe-bottom` 0: chân ≤150px khi đạt miễn phí giao và không có dòng giảm; ≤175px khi có thêm một dòng giảm combo và chưa đạt miễn phí giao (số thật ghi vào PROGRESS).

- [ ] **Step 1: test đỏ e2e Mini** `cart-footer.miniapp.spec.ts` (mock `/cart` như `cart-lines.miniapp.spec`): (a) đạt miễn phí giao, không giảm: `sticky-bar` cao ≤150, không có `freeship-bar`, tâm số tiền và tâm nút lệch ≤12px, nút nằm bên phải số tiền; (b) có `comboDiscount` và chưa đạt miễn phí giao: ≤175, có `freeship-bar`; (c) giỏ 8 dòng, có một dòng hết hàng (hiện `payHint`): cuộn hết, đáy dòng cuối ≤ đỉnh `sticky-bar`; lặp với `--safe-bottom: 34px` (cao = base + 34); (d) 320×640: `document.documentElement.scrollWidth ≤ 320` và nút không rớt dưới số tiền. Spec web `cart-footer.web.spec.ts` cùng ca (a)–(d) với mock trong trình duyệt như `cart-lines.web.spec.ts`.
- [ ] **Step 2: chạy FAIL** (Mini `E2E_SCOPE=miniapp E2E_MINIAPP_PORT=3369 npx playwright test tests/cart-footer.miniapp.spec.ts --workers=1`): chân ~265px.
- [ ] **Step 3: cài Mini**: `StickyActionBar` thêm `lead`, `dense`, `--sticky-bar-h`; `StickySummary` dựng bố cục trên (`summary` = hàng mã + freeship + dòng giảm; `lead` = khối tổng; `primary` = nút); `<Page>` `paddingBottom: 'calc(var(--sticky-bar-h, 150px) + 16px)'` thay `260`; thanh có `data-testid="freeship-bar"`.
- [ ] **Step 4: sửa vitest Mini** `cart.spec.tsx` theo bố cục mới (đạt miễn phí giao: có chữ `Bạn được miễn phí giao hàng 🌿`, `queryByTestId('freeship-bar')` null; chưa đạt: có thanh; `Tạm tính` và số tiền chung cha; `Tiết kiệm 34.000đ` trong `sticky-bar`); thêm spec `sticky-action-bar.spec.tsx`: `lead` nằm cùng hàng với `primary`, `dense` đổi đệm, thiếu ResizeObserver không ném lỗi. Chạy `cd apps/miniapp && npx vitest run src/pages/cart.spec.tsx src/components/ui/sticky-action-bar.spec.tsx`.
- [ ] **Step 5: cài web**: khối `StickyActionBar` ở `gio-hang/page.tsx` theo cùng bố cục (Tailwind: hàng cuối `flex items-center gap-3`, nút `uiBar.primary` bỏ `mt-2 w-full`, thêm `min-w-[9.25rem] shrink-0`; thanh freeship chỉ khi `!freeshipReached`, thêm `data-testid="freeship-bar"`; `KeyValueRow` dòng giảm truyền `style={{ padding: '1px 0' }}`). Sửa `page.spec.tsx` tương ứng (đã có `freeship-fill`: đổi sang `freeship-bar`).
- [ ] **Step 6: chạy PASS** e2e Mini 4 ca; e2e web `E2E_API_PORT=3370 E2E_WEB_PORT=3371 E2E_MINIAPP_PORT=3372 bash apps/e2e/scripts/web-gate.sh tests/cart-footer.web.spec.ts tests/cart-lines.web.spec.ts` (nếu docker/RAM không cho thì chạy với API giả như `handoff-wave3` "Bẫy môi trường" và ghi vào notes); vitest web `cd apps/web && npx vitest run src/app/gio-hang/page.spec.tsx`; e2e Mini cũ `cart-lines.miniapp`, `bundles.miniapp`, `checkout.miniapp` không hồi quy.
- [ ] **Step 7: Commit** `feat(cart): chân dính giỏ gọn còn ~140px ở Mini và web, tổng và nút cùng một hàng`

---

### Task 4: Gợi ý mã trong giỏ vừa một dòng (P1 #8)

**Files:**
- Modify: `packages/app-core/src/coupon-use.ts` (+ `coupon-use.spec.ts`), `packages/app-core/src/shop-copy.ts`, `packages/app-core/src/shop-copy-budget.ts`, `apps/miniapp/src/pages/cart.tsx:659`, `apps/web/src/components/coupon-box.tsx:393` (+ `coupon-box.spec.tsx`), `apps/miniapp/src/pages/cart.spec.tsx:698`
- Modify (test): `apps/e2e/tests/cart-footer.miniapp.spec.ts`, `cart-footer.web.spec.ts`

**Interfaces:**
- Produces: `export function couponHintShort(hint: CouponHint): string` (`coupon-use.ts`): `maxSaving > 0` → `fillCopy('coupon.hintShort', { n, x: vnd(maxSaving) })` = `"{n} mã · giảm đến {x}"`; ngược lại `fillCopy('coupon.hintShortPlain', { n })` = `"{n} mã dùng được"`. Hai khoá mới trong `SHOP_COPY` và `SHOP_COPY_MAX` (ngân sách 24 và 15). `couponHintText` giữ nguyên cho thanh toán và khung mở rộng của web.

- [ ] **Step 1: test đỏ** `coupon-use.spec.ts`: `couponHintShort({count:6,maxSaving:60_000})==='6 mã · giảm đến 60.000đ'`; `{count:1,maxSaving:0}` → `'1 mã dùng được'`; `shop-copy.spec` (ngân sách) đỏ vì thiếu khoá. E2E (thêm vào `cart-footer.*`): mock xem trước mã 6 mã dùng được giảm 60.000đ, giỏ chưa có mã: chữ gợi ý có `scrollWidth ≤ clientWidth` (không cắt) và `Chọn mã ›` nằm trọn trong màn; ca 9 mã, 123.456đ: hoặc vừa hoặc cắt bằng dấu "…" nhưng `Chọn mã` vẫn trong màn.
- [ ] **Step 2: chạy FAIL**: `cd packages/app-core && npx vitest run src/coupon-use.spec.ts src/shop-copy.spec.ts`.
- [ ] **Step 3: cài**: thêm `couponHintShort` + hai khoá chữ (hai file); Mini `CouponRow` và web `sheetRow` gọi `couponHintShort(hint)`.
- [ ] **Step 4: sửa test cũ**: `cart.spec.tsx` (Mini) và các ca `coupon-box.spec.tsx` đọc hàng thu gọn của giỏ (`Bạn có 2 mã dùng được · giảm đến …` ở hàng `sheet`) đổi sang chữ gọn; ca khung mở rộng và thanh toán giữ `couponHintText`. Chạy `cd apps/web && npx vitest run src/components/coupon-box.spec.tsx`, Mini `cart.spec.tsx`.
- [ ] **Step 5: chạy PASS** e2e `cart-footer` (cả hai) + `pnpm lint:parity`.
- [ ] **Step 6: Commit** `fix(cart): gợi ý mã trong giỏ rút còn "{n} mã · giảm đến {x}", vừa một dòng ở 375px`

---

### Task 5: Chụp 375px trước/sau, gate cuối, ghi chú

- [ ] **Step 1: chụp "trước"** (làm TRƯỚC Task 1, trên mã base): spec tạm ở `docs/2026-10-31-shop-redesign/screens/F10b/` (thư mục gitignore; chép vào `apps/e2e/tests/` khi chạy, xoá sau) chụp Mini `/cart`, `/best-sellers`, `/flash-sale`, `/vouchers`, `/campaign/:slug` và web `/gio-hang` ở 375×812 vào `screens/F10b/before/`. Sau cùng chạy lại vào `after/`.
- [ ] **Step 2: gate**: `cd apps/e2e && E2E_SCOPE=miniapp E2E_MINIAPP_PORT=3369 npx playwright test --workers=2 --reporter=line` (tắt server chụp ảnh trước), rồi `bash docs/2026-10-28-review/tools/gate.sh <worktree> --base 201046ff2 --out /Users/longla/coding/tubutree-mini-app/.claude/worktrees/gate-F10b.txt`. Bước FAIL: chạy lại ở base để phân biệt "có sẵn".
- [ ] **Step 3: ghi** số đo chân dính trước/sau, đường dẫn ảnh, e2e cũ sửa theo thiết kế, vào phần cuối plan này; commit `docs(shop): F10b ghi kết quả`.

---

## Kết quả (ghi sau khi làm xong)

**Commit:** 612249f5e (plan), 689e5631b (T1 bốn trang bỏ lớp `page`), c468f1a92 (T2 `strikePrice`), 5b2b326d1 (T3 chân dính gọn), f29580c86 (T4 gợi ý mã ngắn).

**Số đo chân dính 375×812 (Playwright, `cart-footer.*`):**

| Ca | Trước | Sau |
| --- | --- | --- |
| Mini, 3 dòng, đã đạt miễn phí giao, không giảm | 215px | 138px (≤150) |
| Mini, đạt + dòng Giờ vàng + Tiết kiệm | không đo | 148px |
| Mini, chưa đạt + dòng giảm combo | không đo | 173,5px (≤175) |
| Mini, 8 dòng + dòng hết hàng | 263px | ≤190px (dòng cuối nằm trên chân, cả khi `--safe-bottom` 34px) |
| Web, 3 dòng, đã đạt miễn phí giao, không giảm | 198px | ≤150px |
| Web, chưa đạt + giảm combo | không đo | ≤180px (web hơn Mini ~5px vì thanh dùng chung có viền 1px + đệm 12px) |

**Ảnh 375px** (gitignore): `docs/2026-10-31-shop-redesign/screens/F10b/before/` và `after/`: `mini-cart`, `mini-cart-not-reached`, `mini-best-sellers`, `mini-flash-sale`, `mini-vouchers`, `mini-campaign`, `web-cart`, `web-cart-not-reached`. Ảnh web "trước" chụp bằng cách tạm đặt `page.tsx` + `coupon-box.tsx` của base `201046ff2` rồi khôi phục. Spec chụp tạm lưu ở cùng thư mục (`f10b-shots.*.spec.ts`), bản trong `apps/e2e/tests/` đã xoá.

**Tiền không đổi (P1 #6):** `cart.service.spec.ts` ca "tiền không đổi" (unitPrice 33.000, tổng 66.000, tạm tính 66.000, giảm 0, combo 0) và `cart-combo-equals-quote.race-spec.ts` ca Giờ vàng thắng giá sale (cart = quote = order = 66.000, `listUnitPrice` 50.000). Chỉ `listUnitPrice` (giá gạch, chỉ hiển thị) đổi từ giá niêm yết 59.000 sang giá đang bán 50.000.

**Test cũ sửa theo thiết kế mới:** `flash-slots.miniapp.spec.ts` (bỏ so `topBefore`: hàng dính nay bằng đúng vị trí tự nhiên), `flash-sale.spec.tsx` (`top` là `var(--safe-top)`), `cart.service.spec.ts` (ca Giờ vàng kỳ vọng `listUnitPrice` 50.000), `cart.spec.tsx` Mini và `coupon-box.spec.tsx` web (chữ gợi ý bản ngắn). Không có test nào hỏng vì hồi quy.

**E2E Mini cả bộ** (`E2E_SCOPE=miniapp --workers=2`): 354 passed, 10 skipped, 0 failed.

**Gate** (`gate.sh ... --base 201046ff2`, log ở `.claude/worktrees/gate-F10b.txt`): PASS shared-types, tsc-api/web/miniapp/app-core, eslint-api/miniapp/web, vitest-app-core 2115, vitest-web 9160, jest-api 539 suite / 12562 ca, lint-parity, vite-build, bundle-mini entry 645/201 KB (trần 700).
- FAIL tsc-e2e: lỗi thật của gói (`s.sticky` có thể undefined trong closure ở `page-title-row.miniapp.spec.ts`), đã sửa ở c0e86828f, `tsc --noEmit` e2e chạy lại xanh.
- FAIL vitest-miniapp (5 file, 7 ca) và vitest-miniapp-utc (7 file, 10 ca): hai lần hỏng KHÁC bộ file, đều dạng hết hạn 5000ms/đồng hồ giả lúc máy hết RAM; không file nào do gói đụng tới. Chạy lại riêng 9 file đã hỏng (flash-sale, suggest-feed, shop-products-tab, subscriptions-panel, product-detail-info, brand-view, loyalty-behavior, offers, storefront-builder) ở múi giờ máy và `TZ=UTC`: 9/9 file, 312/312 ca xanh. Chưa chạy lại cả bộ Mini lần hai (hết RAM).
- Race (cụm riêng 25557): 4 suite / 29 ca xanh ở Task 2 (cart-combo-equals-quote có ca Giờ vàng thắng giá sale, cart-batch, cart-batch-checkout, catalog-flash-card-price); cụm đã tắt.
- e2e web `cart-footer.web.spec.ts` (6 ca) chạy với API giả (`/api/health`, `/products`, `/categories`, `/brands`) + `next dev` cổng 3370/3371, project "Web Customer Mobile": xanh. Chưa chạy qua `web-gate.sh` (cần DB + Docker): để CI.

## Sửa sau review (vòng 1)

- **MAJOR, `--sticky-bar-h` bị xoá khi trang cũ tháo (Mini):** AnimationRoutes gắn trang mới trước, tháo trang cũ sau hiệu ứng thoát, nên thanh của Thanh toán/PDP tháo SAU thanh của Giỏ và xoá biến vô điều kiện; Giỏ rơi về số dự phòng 150px (+16) thấp hơn chân thật (138px + `--safe-bottom` 34px = 172px). `components/ui/sticky-action-bar.tsx` nay giữ danh sách thanh đang gắn theo thứ tự gắn: chỉ thanh gắn sau cùng ghi biến (cả ở ResizeObserver), thanh nào tháo thì biến trả về thanh còn lại, hết thanh mới xoá. Test: `sticky-action-bar.spec.tsx` ba ca (tháo thanh gắn trước, tháo thanh gắn sau, thanh dưới đổi cỡ không ghi đè), chạy lại trên bản cũ thì 3 ca đỏ; e2e `cart-footer.miniapp.spec.ts` ca "vào lại giỏ từ trang Thanh toán bằng Quay lại" (`--safe-bottom` 34px, giỏ 8 dòng): `--sticky-bar-h` bằng chiều cao chân thật và dòng cuối nằm trên chân, trên bản cũ đỏ vì biến rỗng. Bản web không bị: Next gỡ cây cũ và chạy mọi cleanup trước khi chạy effect của cây mới trong cùng một commit.
- **MINOR, px viết tay (ds-ratchet P17b):** chữ nhãn và số tiền của khối tổng dùng `--type-label-*` và `--type-title-md-*`, bề rộng nút `9.25rem` thay `148`/`min-w-[148px]`, hàng gợi ý mã `lineHeight: var(--type-label-lh)`. Đếm bằng `countPx` của ds-ratchet trên nhánh P17b: cart.tsx 51 → 48 (base 51), gio-hang/page.tsx 10 → 8 (base 10), hai `sticky-action-bar.tsx` 4 → 4. Không file nào vượt baseline khi P17b gộp.
- **MINOR, gợi ý mã không phủ hết số lẻ:** `couponHintShort` làm tròn XUỐNG tròn nghìn (dưới 1 triệu) hay tròn trăm nghìn (từ 1 triệu): `123.456đ` → `123k`, `1.234.567đ` → `1,2tr`, dưới 1.000đ ghi đủ. "Giảm đến" chỉ nói thấp hơn mức giảm thật, không bao giờ cao hơn; câu đầy đủ với số tiền chính xác vẫn ở `couponHintText` (thanh toán, khung mở rộng). Ngân sách `coupon.hintShort` hạ 25 → 24, `shop-copy.spec.ts` có giá trị xấu nhất riêng `999,9tr`; `coupon-use.spec.ts` quét 14 mức tiền: giá trị rút gọn ≤ mức giảm thật, > 0, chữ ≤ 24 ký tự. e2e hai app thêm ca `99 mã · giảm đến 1,2tr` và đòi một dòng cho mọi số lẻ.
- **MINOR, token hai app khác nhau (web):** nhãn `text-label text-stone-600` và số tiền `text-[length:var(--type-title-md-size)] leading-[var(--type-title-md-lh)]` cùng token với Mini (`--color-text-secondary` và `--stone-600` là cùng một giá trị, `tokens.css:109`). Chân dính web vẫn cao hơn Mini khoảng 5px (thanh dùng chung của web có viền 1px và đệm 12px, Mini dense đệm 10px): CHẤP NHẬN, vì thanh web dùng chung với trang Thanh toán và Tư vấn, đổi đệm ở đó là ngoài phạm vi F10b.
- **e2e web qua `web-gate.sh`** (cổng 3370/3371/3372): `cart-footer.web.spec.ts` 14 ca (hai project) xanh.

**Gate sau sửa vòng 1** (`gate.sh ... --base 201046ff2`, log `.claude/worktrees/gate-F10b.txt`): PASS shared-types, tsc-api/web/miniapp/app-core/e2e, eslint-api/miniapp/web, vitest-app-core 2117, vitest-miniapp-utc 6215, vitest-web 9160, jest-api 539 suite / 12562 ca, lint-parity, vite-build, bundle-mini entry 645/201 KB. FAIL vitest-miniapp: 1 ca `edit-profile.spec.tsx` ("mỗi ô nhập có nhãn gắn với ô", `findByLabelText` hết hạn lúc máy tải nặng), file gói không đụng tới, chạy riêng 29/29 xanh và bộ `TZ=UTC` cùng lần gate 6215/6215. e2e Mini `cart-lines`, `checkout`, `cart-footer`, `page-title-row`, `design-system-pilot`: 42 xanh; web qua `web-gate.sh` `cart-footer.web`: 14 xanh. Không đụng API vòng này nên không chạy race.
