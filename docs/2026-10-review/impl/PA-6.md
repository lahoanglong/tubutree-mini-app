# PA-6: SP ngừng bán + địa chỉ/gói định kỳ

Nhánh `hz3/PA-6`, tách từ `hardening/2026-10` @ `a2bf222`.

## C-007 (A5N-04; Q-14): SP ngừng bán/chưa duyệt vẫn đặt được. XONG

Commit: `c3ffe52` (API + race spec), `8b8b73f` (unit test), `ee1a2c8` (miniapp), `76b19fc` (web).

### Đã làm
- **Một hàm kiểm dùng chung**: `apps/api/src/modules/cart/sellable.ts`
  - `SELLABLE_VARIATION_WHERE` = `variation.isActive && product.isActive && product.approvalStatus = 'APPROVED'`
  - `isSellableVariation(v)` cho dữ liệu đã đọc
  - `assertVariationsSellable(tx, lines)` kiểm lại TRONG transaction tạo đơn
  - `productDiscontinuedError(name)` trả 400 `{ code: 'PRODUCT_DISCONTINUED', message: 'Sản phẩm "X" đã ngừng bán, vui lòng xoá khỏi đơn rồi đặt lại.' }`
  - `isProductDiscontinuedError(err)`
- **Giỏ** (`cart.service.ts`):
  - `getCart` tách dòng không bán được ra `unavailableItems[]` (id, variationId, productId, productName, variationName, slug, thumbnail, quantity). Các dòng này không vào `items`/`subtotal`/`itemCount`/coupon base/tra giá giờ vàng.
  - `addItem` dùng cùng hàm kiểm, nên chặn thêm cả trường hợp `Product.isActive=false`, trước đây chỉ kiểm variation.isActive + approvalStatus. Mua lại (`orders.repurchase`) đi qua `addItem` nên cũng được phủ.
- **Checkout** (`checkout.service.ts`):
  - `compute`: nếu khách chọn đích danh dòng ngừng bán (mua ngay hoặc tập con `itemIds`), hoặc giỏ chỉ còn toàn dòng ngừng bán, thì trả 400 PRODUCT_DISCONTINUED.
  - Đặt toàn giỏ thì bỏ qua dòng ngừng bán (giỏ đã báo khách).
  - `placeOrder` gọi `assertVariationsSellable` trong tx, trước bước giữ kho.
- **CTV lên đơn hộ** (`affiliate.placeOrderForCustomer`): kiểm thêm Product.isActive/approvalStatus (trước đây chỉ kiểm variation.isActive) và kiểm lại trong tx.
- **Đại lý** (`dealer.placeOrder`): trước đây không kiểm gì. Nay kiểm trước khi dựng giá và kiểm lại trong tx (Serializable với CREDIT). Không giữ kho, không ghi công nợ.
- **Gói định kỳ** (`subscriptions.service.ts`):
  - `create` chặn SP không bán được bằng PRODUCT_DISCONTINUED.
  - Lúc sinh đơn kỳ tới, kiểm trước và kiểm lại trong tx. SP ngừng bán thì gói chuyển `PAUSED`, gửi thông báo `SUBSCRIPTION_PAUSED` (`reason: 'Sản phẩm đã ngừng bán'`), ghi analytics `order_failed/inactive_product`, không sinh đơn, không trừ kho.
- **Miniapp** (`pages/cart.tsx`):
  - Khối `DiscontinuedNotice` hiện "N sản phẩm đã ngừng bán" kèm tên SP (gạch ngang) và nút "Xoá" từng dòng. Khối vẫn hiện khi giỏ chỉ còn dòng ngừng bán (cùng màn giỏ trống).
  - Thêm kiểu `UnavailableCartLine` và 3 chuỗi trong `vi.cart`.
- **Web** (`app/gio-hang/page.tsx`): khối thông báo tương tự kèm nút Xoá. File này nằm ngoài nhóm file khai báo ("miniapp trang giỏ"), nhưng yêu cầu ghi "Miniapp/web". Đã sửa tối thiểu: 1 khối JSX + 1 trường type.

### Test thêm (đỏ → xanh)
- Race spec Postgres thật `apps/api/test/integration-race/sellable-product.race-spec.ts`, 27 ca. Ba cách gỡ SP được chạy lần lượt qua từng đường: Product.isActive=false, Product REJECTED, Variation.isActive=false.
  - Giỏ: getCart lọc + `unavailableItems`; đặt toàn giỏ chỉ ra dòng còn bán, kho SP gỡ giữ nguyên 50; mua ngay dòng gỡ thì quote và place đều 400 PRODUCT_DISCONTINUED.
  - Checkout: SP bị gỡ giữa compute và tx thì bị chặn trong tx. 6 khách đặt song song với lúc admin gỡ SP: kho = 100 − số đơn. Sau khi gỡ, khách mới không đặt được. Trước khi sửa, ca này tạo được đơn.
  - CTV lên đơn hộ: cả 3 cách gỡ; SP PENDING_REVIEW (isActive=true); gỡ giữa chừng.
  - Đại lý: cả 3 cách gỡ; gỡ giữa chừng (sau khi dựng giá, trước tx).
  - Gói định kỳ: tạo gói bị chặn; đến kỳ thì PAUSED + báo, không đơn, không trừ kho; gỡ giữa lúc tính giá kỳ và lúc ghi đơn.
  - **Trước khi sửa**: `Tests: 26 failed, 1 passed, 27 total` (`Expected: "PRODUCT_DISCONTINUED" / Received: undefined`, `Expected: "PAUSED" / Received: "ACTIVE"`, ca "late" vẫn tạo được đơn).
  - **Sau khi sửa**: `Tests: 27 passed, 27 total`; log `[c007 checkout x6 + gỡ] fulfilled=1 rejected=6 orders=0`.
- Unit (jest):
  - cart: addItem chặn Product.isActive=false; getCart tách 4 kiểu dòng hỏng.
  - checkout: mua ngay dòng gỡ; giỏ chỉ còn dòng gỡ; kiểm lại trong tx rollback trước khi giữ kho.
  - affiliate: 3 kiểu SP cha hỏng.
  - dealer: 4 kiểu hỏng, không giữ kho, không tạo đơn.
  - subscriptions: create chặn 4 kiểu; kiểm lại trong tx dẫn tới PAUSED + báo.
  - Đã cập nhật mock cũ (thêm `product.isActive/approvalStatus`, `tx.variation.findMany`).
- Miniapp vitest `src/pages/cart.spec.tsx`, 3 ca: hiện thông báo + Xoá; giỏ chỉ còn dòng gỡ; API cũ thiếu trường thì không hiện. Spec này viết SAU khi sửa code, nên chưa được thấy chạy đỏ.

### Lệnh kiểm chứng (output thật)
```
# apps/api
DATABASE_URL=postgresql://tubu:tubu@localhost:5546/tubutree_it?schema=public npx jest -c test/integration-race/jest.config.js --runInBand commission-create dealer-credit-limit buy-flow-4a sellable-product
  Test Suites: 4 passed, 4 total
  Tests:       38 passed, 38 total
npx jest --maxWorkers=1 src/modules/cart src/modules/checkout src/modules/affiliate src/modules/dealer src/modules/subscriptions
  Test Suites: 14 passed, 14 total
  Tests:       382 passed, 382 total
npx tsc --noEmit -p tsconfig.json   -> (không lỗi)
npx eslint <12 file đã sửa>          -> (không lỗi)
# apps/miniapp
npx vitest run src/pages/cart.spec.tsx  -> Tests 3 passed (3)
npx tsc --noEmit                        -> (không lỗi); eslint: 1 warning consistent-type-imports (cùng mẫu orders.spec.tsx)
# apps/web
npx tsc --noEmit; npx eslint src/app/gio-hang/page.tsx src/lib/shop-client.ts -> (không lỗi)
```

### Migration
Không có.

### Giả định
- Dòng giỏ ngừng bán được GIỮ trong DB, không tự xoá. Nếu SP mở bán lại thì dòng tự hiện lại; khách tự bấm Xoá nếu muốn.
- Đặt TOÀN giỏ khi giỏ còn lẫn dòng ngừng bán thì đơn chỉ gồm dòng còn bán (Q-14 "lọc khỏi giỏ"), không chặn cả đơn. Chọn đích danh dòng ngừng bán thì báo lỗi rõ.
- Kiểm lại trong tx là đọc thường, không khoá dòng products. Lý do: tránh deadlock/chặn cập nhật SP khi nhiều đơn cùng SP. Một đơn commit đồng thời với lệnh gỡ SP được coi là "đặt trước lúc gỡ".
- Gói định kỳ gặp SP ngừng bán thì PAUSED (giữ hành vi cũ của nhánh isActive=false), không tự huỷ.

### Việc còn lại
- `dealer.pricelist` vẫn liệt kê SP ngừng bán. Đặt sẽ bị chặn, nhưng nên lọc bằng `SELLABLE_VARIATION_WHERE`. Ngoài phạm vi "chỉ placeOrder" của gói này.
- `analytics/order-error-classifier.ts` xếp lỗi PRODUCT_DISCONTINUED vào `VALIDATION`. Có thể thêm mã riêng; module analytics nằm ngoài nhóm file.
- Mẫu thông báo seed `SUBSCRIPTION_PAUSED` ghi "(sản phẩm hết hàng hoặc địa chỉ không hợp lệ)". Nên thêm "ngừng bán" vào câu chữ.
- Trang checkout (miniapp/web) chưa hiện `unavailableItems`. Lỗi 400 có message tiếng Việt hiển thị qua `getErrorMessage`.

## C-014 (A2-003; Q-12): xoá địa chỉ làm mất gói định kỳ. XONG

Commit `f415528`.

### Đã làm
- `users.service.ts` `deleteAddress`: trong một transaction, khoá dòng địa chỉ (`SELECT … FOR UPDATE`), tìm gói `ACTIVE`/`PAUSED` dùng địa chỉ này. Có gói thì trả 400, mã `ADDRESS_IN_USE_BY_SUBSCRIPTION`, câu "Địa chỉ đang dùng cho gói giao định kỳ "<tên SP>", hãy đổi địa chỉ của gói trước." Không có thì xoá các gói `CANCELLED` của địa chỉ (giống hành vi cũ) rồi xoá địa chỉ. Lỗi FK P2003 (lưới an toàn) cũng ra cùng lỗi 400.
- Đổi FK `subscriptions.addressId` từ CASCADE sang RESTRICT (schema + migration).
- `subscriptions.service.ts` `create`: địa chỉ bị xoá giữa lúc kiểm và lúc ghi gói thì FK báo P2003 trên `addressId`, nay đổi thành 400 "Địa chỉ không hợp lệ." thay vì lỗi FK thô.
- Miniapp `pages/addresses.tsx` đã hiện `getErrorMessage(e)` khi xoá lỗi, nên không cần sửa FE.

### Test thêm (đỏ → xanh)
`apps/api/test/integration-race/address-subscription.race-spec.ts` (Postgres thật, 7 test). Trước khi sửa: 4 đỏ (FK còn `c`; gói ACTIVE và PAUSED bị xoá theo địa chỉ; race báo tạo gói thành công nhưng gói biến mất). Sau khi sửa: 7 xanh.
- FK `subscriptions_addressId_fkey` có `confdeltype = 'r'`.
- Gói ACTIVE / PAUSED: xoá bị chặn, mã và câu lỗi đúng, gói và địa chỉ còn nguyên.
- Chỉ còn gói CANCELLED: xoá được. Địa chỉ không có gói: xoá bình thường.
- Race 20 vòng: cả hai bên qua bước đọc địa chỉ rồi mới ghi (`barrierOnFirstCalls`). Đúng một bên thắng, bên thua nhận `BadRequestException`. Không có gói nào "tạo thành công" mà biến mất, không có gói mồ côi. Cả hai kết cục đều xảy ra qua các lần chạy.
- 5 vòng tất định: gói đã INSERT nhưng chưa commit khi bắt đầu xoá. Xoá chờ khoá, sau đó bị chặn, gói còn nguyên.

### Lệnh kiểm chứng (output thật)
```
# apps/api
DATABASE_URL=postgresql://tubu:tubu@localhost:5546/tubutree_it?schema=public npx prisma migrate deploy
  All migrations have been successfully applied.
npx prisma migrate diff --from-url $DATABASE_URL --to-schema-datamodel prisma/schema.prisma --script
  -- This is an empty migration.
docker exec tubu_it_pa6 psql -U tubu -d tubutree_it -At -c "select confdeltype from pg_constraint where conname='subscriptions_addressId_fkey'"
  r
DATABASE_URL=... npx jest -c test/integration-race/jest.config.js --runInBand address-subscription   (chạy 2 lần)
  Tests:       7 passed, 7 total
DATABASE_URL=... npx jest -c test/integration-race/jest.config.js --runInBand sellable-product
  Tests:       27 passed, 27 total
npx jest --maxWorkers=1 src/modules/users src/modules/subscriptions
  Test Suites: 2 passed, 2 total
  Tests:       58 passed, 58 total
npx tsc --noEmit -p tsconfig.json   -> (không lỗi)
npx eslint users.service.ts subscriptions.service.ts address-subscription.race-spec.ts -> (không lỗi)
```
Thử tay trong transaction rồi ROLLBACK: xoá một user có địa chỉ và gói vẫn chạy được (CASCADE từ users xuống cả addresses lẫn subscriptions, RESTRICT không cản).

### Migration
`20261010020000_subscription_address_fk_restrict`: kiểm gói mồ côi trước (có thì `RAISE EXCEPTION`, không xoá gì), rồi DROP và ADD lại FK với `ON DELETE RESTRICT ON UPDATE CASCADE`. Không đụng dòng dữ liệu nào.

### Giả định
- Gói `CANCELLED` không chặn xoá địa chỉ, và bị xoá cùng địa chỉ như trước. Lý do: gói huỷ không sinh đơn, `list` cũng không hiện nó; nếu giữ thì khách không bao giờ xoá được địa chỉ cũ.
- Câu lỗi nêu tên SP (không kèm tên phân loại) cho khớp các câu lỗi khác của gói định kỳ.

### Việc còn lại
- Hiện chưa có API đổi địa chỉ của gói, nên "hãy đổi địa chỉ của gói trước" chỉ làm được bằng cách huỷ gói. Phần sửa gói thuộc gói việc khác (Q-13).
- `subscriptions.variationId` vẫn là CASCADE (A2-003 có nhắc). Ngoài phạm vi Q-12, để lại.
