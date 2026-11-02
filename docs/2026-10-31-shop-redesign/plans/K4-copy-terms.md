# K4 `copy-terms` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sửa chữ khách đọc còn sai thuật ngữ (chữ do API trả, "Mua kèm deal sốc", "Chỉ còn n" của bảng chọn phân loại) và vá ba lỗ của lưới `terminology.spec` để lần sau spec đỏ thay vì cần người soát.

**Architecture:** Không đổi logic, chỉ chữ. Chữ API sửa tại nguồn (`coupon-notice.ts`, `flash-line-price.ts` và vài chuỗi lẻ trong `apps/api/src/modules`); spec khớp chữ cũ sửa theo. `addon.title` ở `shop-copy.ts` đổi một khoá, các spec trích chữ đó đổi theo. `terminology.spec.ts` đọc thêm file chữ khách đọc của API, coi chuỗi template bắt đầu bằng chữ hoa ASCII là chữ khách đọc, và mẫu `SỐC` không phân biệt hoa thường; chỗ bộ quét mới bắt được mà thuộc gói đang chạy song song (K2, K3) thì vào `EXEMPT` tạm.

**Tech Stack:** NestJS + jest (API), vitest (app-core, Mini, web), Playwright (e2e Mini).

**Spec:** `docs/2026-10-31-shop-redesign/01-thiet-ke.md` (§4 Q5 là luật chữ). Nguồn việc: `review/extra-critique-2.md` P1 #7, P2 #11, P2 #17 (phần `pickerStockText`), P2 #18. Mục "K4" không có trong `02-ke-hoach.md`; phạm vi lấy từ lệnh giao việc của gói.

## Global Constraints

- Node: `export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH` cho mọi lệnh. Worktree mới: `pnpm install --frozen-lockfile --offline`, `pnpm --filter @tubutree/shared-types build`, `npx prisma generate` (trong `apps/api`) trước gate.
- Chữ chuẩn: "Giờ vàng" luôn hoa chữ G; "Miễn phí giao hàng"; "Thương hiệu" (không "Nhãn hàng"); "Còn {n} sản phẩm" (không "Chỉ còn"); không chữ giục mua (HOT, SỐC, Nhanh tay). Bảng đầy đủ ở `DESIGN.md` mục "Chữ chuẩn và thuật ngữ cấm".
- Không đổi logic, tiền, route. Chỉ chuỗi hiển thị cho khách và test/doc đi kèm.
- Không sửa file của gói chạy song song: phiên 9b (`flash-sale.tsx` hai app, `flash-boot-script.ts`, `home-layout.ts`, `home-initial.ts`, `app/page.tsx`); K1 (`variation-sheet.tsx`, `add-to-cart.tsx`, `variation-picker.ts` TRỪ `pickerStockText`, `commerce/flash-line.ts`, `pdp-bundles.tsx` hai app); K2 (`thanh-toan/page.tsx`, `checkout.tsx`); K3 (`voucher-sheet.tsx`, `coupon-box.tsx`, `coupon-view.ts`, `voucher.ts`, `voucher-ticket` hai app, `pdp-extras.tsx` phần offers, `pdp-offers-sheet.tsx`); K5, K6, K7 (xem lệnh giao việc). Buộc đụng thì ghi vào notes.
- Không `max-md:` mới, không px viết tay mới (`pnpm lint:parity`); `pnpm lint:vars` xanh.
- Không push, không deploy, không đọc/ghi PROD, không `git stash` trần. Comment chỉ giải thích "vì sao", tiếng Việt.
- Máy thiếu RAM: chạy test theo file khi làm; gate đầy đủ đúng một lần ở cuối; e2e `--workers=2`.

## Review Focus

1. Chữ sửa mà test khác vẫn khớp chữ cũ (jest API, vitest Mini/web, e2e): grep chuỗi cũ trong `apps/api`, `apps/e2e`, `apps/miniapp`, `apps/web`, `packages` sau khi sửa; mỗi chuỗi còn lại phải là dữ liệu giả có chủ ý hoặc chữ không thuộc gói. Test: Task 1–4 chạy đúng các spec khớp chữ.
2. Bộ quét mới bắt nhầm mã định danh (`'FREESHIP'`, `'GET /x'`, tên khoá) thành chữ khách đọc. Test: Task 5 giữ nguyên danh sách "bỏ qua" cũ và thêm ca `'FREESHIP'` + chuỗi template không phải chữ hiển thị.
3. Quét file API làm vỡ vì file API chứa chữ cấm có chủ ý (log, quản trị). Test: Task 5 chỉ quét `*-notice.ts`, `*-price.ts` và một danh sách tên file ghi sẵn; ca "file API tên lạ không bị quét".
4. Spec xanh trên nhánh này nhưng đỏ khi gộp với K2/K3 (hai gói bỏ "HSD", "Vui lòng", "Đang tính..."). Test: dòng `EXEMPT` tạm có `max` bằng đúng số chỗ hiện có; spec "trần max bằng đúng số chữ cũ" đỏ báo người gộp gỡ dòng.
5. `/SỐC/i` bắt nhầm chữ thường hợp lệ ("sốc phản vệ" trong chữ y tế): kiểm cây thật không có hit mới ngoài `addon.title`. Test: Task 5 chạy cây thật.

---

## File Structure

| Việc | File |
|---|---|
| Chữ mã giảm giá và Giờ vàng của API | `apps/api/src/modules/coupons/coupon-notice.ts`, `apps/api/src/modules/flash-sale/flash-line-price.ts` (+ spec mới `coupon-notice.spec.ts`, `flash-line-price.spec.ts`) |
| Chữ API khác | `apps/api/src/modules/cart/cart.service.ts` (hai dòng "kho"), `cart/cart.batch-error.ts`, `brand/brand.service.ts`, `catalog/catalog.service.ts`, `affiliate/affiliate.service.ts` |
| Spec API khớp chữ cũ | `cart/cart.service.spec.ts`, `checkout/checkout.service.spec.ts`, `flash-sale/flash-sale.staff.spec.ts`, `affiliate/affiliate.service.spec.ts` nếu khớp, `apps/api/test/integration-race/*.race-spec.ts` khớp chữ |
| "Mua kèm giá tốt" | `packages/app-core/src/shop-copy.ts` (`addon.title`), spec trích chữ: `commerce/bundle-view.spec.ts`, Mini `pdp-bundles.spec.tsx`, `product-detail-info.spec.tsx`, web `pdp-bundles.spec.tsx`, `page.spec.tsx`, e2e `bundles.miniapp.spec.ts`, `bundles-cls.miniapp.spec.ts` |
| `pickerStockText` | `packages/app-core/src/variation-picker.ts` (chỉ hàm này), `variation-picker.spec.ts` |
| Lưới chặn chữ cấm | `packages/app-core/src/shop-copy.ts` (`FORBIDDEN_TERMS`), `packages/app-core/src/terminology.spec.ts`, `packages/app-core/src/shop-copy.spec.ts` |
| Tài liệu | `DESIGN.md` (đoạn terminology.spec + Nhật ký), `docs/2026-10-31-shop-redesign/01-thiet-ke.md` §5 |

---

### Task 1: Chữ mã giảm giá và Giờ vàng do API trả (P1 #7)

**Files:**
- Modify: `apps/api/src/modules/coupons/coupon-notice.ts`, `apps/api/src/modules/flash-sale/flash-line-price.ts`
- Test: `apps/api/src/modules/coupons/coupon-notice.spec.ts` (mới), `apps/api/src/modules/flash-sale/flash-line-price.spec.ts` (mới); sửa chữ trong `cart.service.spec.ts`, `checkout.service.spec.ts`, `flash-sale.staff.spec.ts`, race spec khớp chữ.

**Interfaces:**
- Consumes: không.
- Produces: các export giữ nguyên tên và chữ ký (`COUPON_FREESHIP_*`, `couponFreeshipThresholdReason(threshold)`, `couponFreeshipTubuPartReason(why)`, `couponNotAppliedNotice(reason, hasFlash, hasCombo)`, `couponFlashExcludedNotice(base)`, `couponRejectedWithFlash(reason, base)`, `COUPON_PRODUCT_FLASH_REASON`, `FLASH_OWN_SALE_NOTICE`, `flashLimitMessage(offer, quantity)`); chỉ đổi chuỗi trả về.

Chữ chốt (hàm không có sẵn mã đang xét nên dùng "mã miễn phí giao"):
- `Đơn đầu đã được miễn phí giao, mã miễn phí giao được giữ cho đơn sau.` (và hai câu tương tự: đơn đã miễn, đơn từ {ngưỡng})
- `…, mã miễn phí giao chỉ miễn phí giao hàng Tubu Tree nên được giữ cho đơn sau.`
- "hàng giờ vàng" thành "hàng Giờ vàng"; "Hàng giờ vàng" thành "Hàng Giờ vàng"; "giá giờ vàng" thành "giá Giờ vàng"; "khi giờ vàng kết thúc" thành "khi Giờ vàng kết thúc".
- `FLASH_OWN_SALE_NOTICE`: `Bạn tạo đợt Giờ vàng này nên không mua được giá Giờ vàng.`
- `Chỉ còn ${allowance} suất giờ vàng.` thành `Còn ${allowance} suất Giờ vàng.`; "suất giờ vàng", "giá giờ vàng" còn lại thành "Giờ vàng".

- [ ] **Step 1: Viết spec mới (đỏ).** `coupon-notice.spec.ts`: mỗi export trả đúng chuỗi chốt ở trên; một ca `it.each` khẳng định không chuỗi nào chứa `FREESHIP` hay `giờ vàng` (chữ thường). `flash-line-price.spec.ts`: `flashLimitMessage` ba nhánh (ownSale, allowance 0, quotaLeft ≤ perUserLeft, nhánh còn lại) trả đúng chuỗi; chuỗi nào cũng không chứa `giờ vàng` hay `Chỉ còn`.
- [ ] **Step 2: Sửa chuỗi cũ trong spec đang khớp** (cart, checkout, staff, race spec): thay đúng các chuỗi ở trên.
- [ ] **Step 3: Chạy đỏ.** `cd apps/api && npx jest src/modules/coupons/coupon-notice.spec.ts src/modules/flash-sale/flash-line-price.spec.ts src/modules/flash-sale/flash-sale.staff.spec.ts src/modules/cart/cart.service.spec.ts src/modules/checkout/checkout.service.spec.ts` → FAIL ở các ca chữ.
- [ ] **Step 4: Sửa chuỗi trong hai file nguồn** theo bảng chữ chốt; không đổi logic.
- [ ] **Step 5: Chạy lại lệnh Step 3** → PASS.
- [ ] **Step 6: Commit** `fix(api): chữ mã miễn phí giao và Giờ vàng đúng thuật ngữ (K4)`.

### Task 2: Chữ khách đọc khác của API

**Files:**
- Modify: `apps/api/src/modules/cart/cart.service.ts` (hai dòng "Chỉ còn n sản phẩm trong kho"), `cart/cart.batch-error.ts` (`batchStockMessage`), `brand/brand.service.ts` và `catalog/catalog.service.ts` ("Nhãn hàng không tồn tại" thành "Thương hiệu không tồn tại"), `affiliate/affiliate.service.ts` (câu "Giá giờ vàng của ... Vui lòng xem lại giá")
- Test: `cart.service.spec.ts`, `affiliate.service.spec.ts` nếu khớp.

**Interfaces:**
- Consumes: không. Produces: chuỗi mới `Còn ${n} sản phẩm trong kho.`, `${productName} còn ${stock} sản phẩm.`, `Thương hiệu không tồn tại hoặc chưa đăng.` / `Thương hiệu không tồn tại.`, `Giá Giờ vàng của "${productName}" vừa hết suất hoặc hết giờ. Bạn xem lại giá rồi tạo đơn lại nhé.`

- [ ] **Step 1: Đổi chuỗi cũ trong `cart.service.spec.ts`** (`rejects.toThrow('Chỉ còn 3 sản phẩm')` thành `'Còn 3 sản phẩm'`, hai ca `Chỉ còn 3`/`Chỉ còn 5`, ca batch `SP v1 còn 3 sản phẩm. Chưa có món nào được thêm vào giỏ.`) và spec affiliate nếu khớp.
- [ ] **Step 2: Chạy đỏ** `npx jest src/modules/cart/cart.service.spec.ts src/modules/affiliate/affiliate.service.spec.ts src/modules/brand src/modules/catalog` → FAIL ở các ca chữ.
- [ ] **Step 3: Sửa chuỗi** ở các file trên (không đổi logic; sáu dòng "Nhãn hàng" của `brand.service.ts` đều là 404 của trang công khai, theo dõi, bỏ theo dõi, trạng thái theo dõi).
- [ ] **Step 4: Chạy lại** → PASS.
- [ ] **Step 5: Commit** `fix(api): chữ khách đọc "Còn n sản phẩm", "Thương hiệu", Giờ vàng ở CTV (K4)`.

### Task 3: "Mua kèm deal sốc" thành "Mua kèm giá tốt" (P2 #11, quyết định thay chủ)

**Files:**
- Modify: `packages/app-core/src/shop-copy.ts` (`addon.title`), comment nhắc chữ cũ trong `commerce/bundle-view.ts`, `apps/api/src/modules/bundles/bundles.service.ts`, `pdp-bundle-slots.tsx` hai app
- Test: `commerce/bundle-view.spec.ts`, Mini `pdp-bundles.spec.tsx` + `product-detail-info.spec.tsx`, web `pdp-bundles.spec.tsx` + `page.spec.tsx`, e2e `bundles.miniapp.spec.ts` + `bundles-cls.miniapp.spec.ts`.

**Interfaces:** Produces `SHOP_COPY['addon.title'] === 'Mua kèm giá tốt'` (`bundleHoldTitle('addon.title', 'soldOut')` ra `Mua kèm giá tốt · Tạm hết hàng`).

- [ ] **Step 1: Đổi mọi chuỗi `Mua kèm deal sốc` trong spec/e2e sang `Mua kèm giá tốt`** (tiêu đề khối, aria-label, hộp vùng "region").
- [ ] **Step 2: Chạy đỏ** `cd packages/app-core && npx vitest run src/commerce/bundle-view.spec.ts` (FAIL: nhận "Mua kèm deal sốc").
- [ ] **Step 3: Đổi `addon.title` ở `shop-copy.ts`**; sửa comment cũ nhắc "deal sốc" ở file không thuộc K1.
- [ ] **Step 4: Chạy** vitest app-core `bundle-view.spec.ts shop-copy.spec.ts`; Mini `npx vitest run src/components/product/pdp-bundles.spec.tsx src/pages/product-detail-info.spec.tsx`; web `npx vitest run 'src/app/san-pham/[slug]/pdp-bundles.spec.tsx' 'src/app/san-pham/[slug]/page.spec.tsx'` → PASS.
- [ ] **Step 5: Commit** `fix(app-core): "Mua kèm giá tốt" thay "deal sốc" (K4, quyết định thay chủ)`.

### Task 4: `pickerStockText` bỏ "Chỉ còn n" (P2 #17 phần còn lại)

**Files:**
- Modify: `packages/app-core/src/variation-picker.ts` (CHỈ `pickerStockText` và comment của `LOW_STOCK_NOTICE`; K1 đang sửa phần khác của file)
- Test: `packages/app-core/src/variation-picker.spec.ts`

**Interfaces:** `pickerStockText(stock: number): string`: `≤0` → `'Hết hàng'` (giữ, K1 lo chữ hết hàng); `1..5` → `Còn ${stock} sản phẩm`; `>5` → `Còn ${stock}`.

- [ ] **Step 1: Sửa spec** `expect(pickerStockText(3)).toBe('Còn 3 sản phẩm')`.
- [ ] **Step 2: Chạy đỏ** `npx vitest run src/variation-picker.spec.ts` → FAIL.
- [ ] **Step 3: Sửa hàm** đúng theo bảng trên.
- [ ] **Step 4: Chạy** app-core `variation-picker.spec.ts`; Mini `npx vitest run src/components/variation-sheet.spec.tsx`; web `npx vitest run src/components/variation-sheet.spec.tsx` (nếu file có) → PASS.
- [ ] **Step 5: Commit** `fix(app-core): pickerStockText ghi "Còn n sản phẩm" (K4)`.

### Task 5: Vá ba lỗ của `terminology.spec` (P2 #18)

**Files:**
- Modify: `packages/app-core/src/terminology.spec.ts`, `packages/app-core/src/shop-copy.ts` (`FORBIDDEN_TERMS`: `/\bHOT\b|SỐC|Nhanh tay/` thành có cờ `i`)
- Test: chính `terminology.spec.ts`, `shop-copy.spec.ts`

**Interfaces:**
- `displayStrings(source, fileName)` giữ chữ ký; `ASCII_PROSE` thêm nhánh `^[A-Z]{2,} ` (chữ hoa ASCII rồi dấu cách) để template `HSD ${d}` (đầu template là `HSD `) bị coi là chữ khách đọc. Không dùng nhánh không có dấu cách: `'FREESHIP'` vẫn là mã định danh.
- `loadSources()` đọc thêm `apps/api/src/modules/**` chỉ với file khớp `API_COPY_FILE`: `/-(notice|price)\.ts$/` hoặc nằm trong `API_COPY_EXTRA = ['apps/api/src/modules/cart/cart.batch-error.ts']`.

- [ ] **Step 1: Viết ca đỏ.** (a) `it('quét file chữ khách đọc của API')`: `sources` có `coupon-notice.ts`, `flash-line-price.ts`, `cart.batch-error.ts`; một file API tên lạ (`apps/api/src/modules/x/x.service.ts`) không nằm trong `sources`; chữ cấm giả ở `apps/api/src/modules/x/x-notice.ts` ra đúng một hit. (b) `bắt`: `` const t = `HSD ${d}`; `` ra `HSD`; `findHits` template đó ra use `Hạn dùng hoặc Dùng đến`; ca `bỏ qua` thêm `` const k = `FREESHIP-${id}`; `` không ra chữ. (c) `CATCH` thêm `['Mua kèm deal sốc', 'bỏ chữ giục mua']`, `['Giá sốc', 'bỏ chữ giục mua']`.
- [ ] **Step 2: Chạy đỏ** `cd packages/app-core && npx vitest run src/terminology.spec.ts` → FAIL ở ba ca.
- [ ] **Step 3: Sửa** `ASCII_PROSE`, `loadSources`, `ROOTS` (thêm API theo bộ lọc), cờ `i` của `FORBIDDEN_TERMS`.
- [ ] **Step 4: Chạy cây thật.** Mỗi hit mới ngoài file của K2/K3 thì sửa chữ ở nguồn (Task 1–4 đã lo phần lớn). Hit thuộc K2/K3 (`apps/web/src/lib/coupon-view.ts` "HSD ${d}", Mini `voucher-sheet.tsx` "HSD", `thanh-toan/page.tsx`/`checkout.tsx` "Vui lòng", "Đang tính...") thì KHÔNG sửa file: thêm dòng `EXEMPT` tạm, lý do `gói K2/K3 đang sửa, gỡ khi gộp`, `max` đúng số hit.
- [ ] **Step 5: Chạy** `npx vitest run src/terminology.spec.ts src/shop-copy.spec.ts` → PASS.
- [ ] **Step 6: Commit** `test(app-core): terminology.spec quét chữ của API, template HSD, SỐC không phân biệt hoa thường (K4)`.

### Task 6: Tài liệu, ảnh, gate

**Files:**
- Modify: `DESIGN.md` (đoạn nói `terminology.spec` quét gì; một dòng Nhật ký quyết định), `docs/2026-10-31-shop-redesign/01-thiet-ke.md` §5 ("Mua kèm deal sốc" thành "Mua kèm giá tốt")
- Ảnh: `docs/2026-10-31-shop-redesign/screens/K4/` (gitignore): `mini375`/`web375`, trước/sau khối Mua kèm ở PDP.

- [ ] **Step 1: Ảnh "trước"** (chụp trước Task 3, mã gốc) và **ảnh "sau"** (sau Task 3): Mini PDP 375px khối `pdp-addons` bằng spec Playwright tạm (mock `mockDiscovery` + `mockPdpBundles`); web 375px bằng Next dev + API giả. Tắt server khi xong.
- [ ] **Step 2: Cập nhật tài liệu.**
- [ ] **Step 3: Gate** `bash docs/2026-10-28-review/tools/gate.sh <worktree> --base 07818cc2b --out /Users/longla/coding/tubutree-mini-app/.claude/worktrees/gate-K4.txt`; `pnpm lint:parity`, `pnpm lint:vars`; e2e Mini cả bộ `E2E_SCOPE=miniapp E2E_MINIAPP_PORT=3491 npx playwright test --workers=2 --reporter=line`.
- [ ] **Step 4: Commit** `docs(shop): ghi chữ chuẩn K4 vào DESIGN.md và thiết kế`.
