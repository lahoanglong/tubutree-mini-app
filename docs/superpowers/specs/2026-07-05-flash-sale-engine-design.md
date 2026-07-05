# Flash Sale Engine — Design

Ngày: 2026-07-05. Trạng thái: đã duyệt thiết kế (Lã Hoàng Long). Thuộc Phase 1 (Mảng 2 — chuyển đổi người mua),
xem [retention-ctv-conversion-research](../../2026-07-05-retention-ctv-conversion-research.md) §5bis.

## Mục tiêu
Xây **engine flash sale theo khung giờ** thật sự: giá ưu đãi có **thời gian hiệu lực (start/end)**, **quota
(số suất giá flash)**, **giới hạn mua/user**, countdown realtime + "đã bán X%". Thay cho hiện trạng chỉ có
giảm giá tĩnh (`Variation.salePrice`/`Product.salePrice`) và một component FE lọc `salePrice < basePrice`.

## Bối cảnh hiện trạng (giữ nguyên nền)
- **Giá đơn vị** resolve tại `cart.service.ts` (dòng ~32): `it.variation.salePrice ?? it.variation.retailPrice`.
  `salePrice` là markdown **tĩnh** (không time-box).
- **Stock**: `Variation.stock`, trừ **atomic** (`updateMany` guard `gte`) trong `$transaction` của
  `checkout.placeOrder` — chống oversell (2 đơn grab suất cuối → chỉ 1 thắng).
- **Checkout** (`checkout.service.ts`) tính: subtotal → combo → coupon (`coupons.validateAndCompute`) →
  điểm (`pricing.resolvePointsRedemption`, trần 20%) → ship (`pricing.calcShippingFee`); điểm tích +
  hoa hồng CTV tính trên **goods sau giảm**.
- **FE** `apps/miniapp/src/components/flash-sale.tsx` — chỉ lọc sản phẩm `salePrice < basePrice`, countdown
  tới **hết ngày** (không phải end thật của sự kiện).
- `BrandPromotion` (có `couponCode`/`startAt`/`endAt`) chỉ là **banner khuyến mãi**, KHÔNG phải engine giá.

## Quyết định nghiệp vụ (user chốt 2026-07-05)
1. **Ai tạo:** chỉ **admin (sàn)** — MVP. Flash sale theo brand/CTV storefront: ngoài phạm vi.
2. **Stack giảm giá:** giá flash **KHÔNG** stack coupon (item flash loại khỏi base coupon) — **vẫn cho dùng
   điểm + freeship** trên toàn đơn.
3. **Giới hạn mua:** **có** `perUserLimit`/item (configurable).
4. **Điểm + hoa hồng CTV:** tính trên **giá flash thực trả** (nhất quán logic "goods sau giảm").

## Kiến trúc
Tách 2 tầng + 1 bảng đếm mua; thêm 1 service resolve giá; hook vào 3 điểm đọc giá.
*(Phương án loại: thêm `flashStartAt/flashEndAt` vào `Variation` tái dùng `salePrice` — không hỗ trợ
quota/giới-hạn-mua/nhiều đợt song song → không đủ.)*

### Schema (Prisma) + migration tay

```prisma
model FlashSale {
  id        String          @id @default(cuid())
  title     String
  startAt   DateTime
  endAt     DateTime
  isActive  Boolean         @default(true) // admin bật/tắt; ACTIVE = isActive && startAt<=now<endAt
  createdBy String          // adminId
  createdAt DateTime        @default(now())
  updatedAt DateTime        @updatedAt
  items     FlashSaleItem[]

  @@index([isActive, startAt, endAt]) // query "đang active"
  @@map("flash_sales")
}

model FlashSaleItem {
  id           String              @id @default(cuid())
  flashSaleId  String
  flashSale    FlashSale           @relation(fields: [flashSaleId], references: [id], onDelete: Cascade)
  variationId  String
  variation    Variation           @relation(fields: [variationId], references: [id])
  flashPrice   Int
  quota        Int                 // số suất bán ở giá flash (<= stock lúc tạo)
  soldCount    Int                 @default(0)
  perUserLimit Int                 // configurable (default flashsale.default_per_user_limit)
  purchases    FlashSalePurchase[]

  @@unique([flashSaleId, variationId]) // 1 variation / 1 đợt
  @@index([variationId])
  @@map("flash_sale_items")
}

model FlashSalePurchase {
  id              String        @id @default(cuid())
  flashSaleItemId String
  item            FlashSaleItem @relation(fields: [flashSaleItemId], references: [id], onDelete: Cascade)
  userId          String
  quantity        Int           @default(0) // tổng đã mua ở giá flash — guard perUserLimit
  updatedAt       DateTime      @updatedAt

  @@unique([flashSaleItemId, userId])
  @@map("flash_sale_purchases")
}
```
- Thêm quan hệ ngược trên `Variation`: `flashSaleItems FlashSaleItem[]`.
- Migration tay: tạo 3 bảng + index; không back-fill.

### Service mới: `FlashSaleService`
- **`resolveEffective(variationIds: string[], now)`** → `Map<variationId, { price, item?: {id, endAt, soldCount, quota} }>`:
  tìm `FlashSaleItem` của các variation thuộc `FlashSale` **ACTIVE** (`isActive && startAt<=now<endAt`) và
  `soldCount < quota`. Có → giá flash + metadata; không → **caller tự fallback** `salePrice ?? retailPrice`
  (service chỉ trả những variation đang có flash). Batch 1 query (in `variationIds`).
- **`listActive(now)`** → danh sách item đang ACTIVE (kèm product/variation, `flashPrice`, `retailPrice`,
  `soldCount`, `quota`, `endAt`) cho FE trang chủ.
- **`consumeQuota(tx, itemId, userId, qty, perUserLimit)`** (dùng trong tx checkout):
  1. Trừ quota atomic: `updateMany where id=itemId AND soldCount+qty<=quota → increment soldCount`
     → `count===0` ⇒ throw `BadRequestException('Hết suất ưu đãi.')` (mirror oversell).
  2. Chặn perUserLimit atomic: upsert `FlashSalePurchase` + guard tổng `quantity<=perUserLimit`
     (`updateMany where flashSaleItemId+userId AND quantity+qty<=perUserLimit → increment`; nếu chưa có row
     thì create với guard `qty<=perUserLimit`) → không thoả ⇒ throw `('Vượt giới hạn mua ưu đãi.')`.
- **`restore(tx, itemId, userId, qty)`** (dùng khi huỷ/hoàn): `decrement soldCount` + `decrement
  FlashSalePurchase.quantity` (guard `gte`, không âm).

### Hook vào các điểm đọc giá
1. **`cart.service.getCart`** — thay `salePrice ?? retailPrice` bằng resolve batch qua `FlashSaleService`;
   trả thêm `isFlash`, `flashEndAt`, `soldPct` cho line để FE hiển thị. **Coupon base ở cart cũng loại flash
   item** (giống checkout) → số giảm hiển thị ở giỏ khớp số chốt ở checkout, tránh user thấy giảm nhiều hơn
   thực tế. (Giá trị "đúng" vẫn chốt server-authoritative ở checkout.)
2. **`checkout.service` (computePricing + placeOrder)** — **server-authoritative**:
   - Resolve giá flash cho từng line tại thời điểm đặt đơn (KHÔNG tin giá client/giá cart cũ).
   - **Coupon base loại flash**: `goodsEligibleForCoupon = Σ(line không-flash) sau combo`. Truyền số này vào
     `coupons.validateAndCompute` thay cho toàn subtotal. (Combo cũng bỏ qua line flash — xem Bất biến.)
   - **Điểm**: `resolvePointsRedemption` dùng `orderValue` = tổng đơn **gồm** flash (trần 20% trên toàn đơn) —
     đúng quyết định "vẫn cho dùng điểm".
   - **Điểm tích + hoa hồng**: `goodsAfterAll` (đã gồm giá flash thực trả) → giữ nguyên `calcPointsEarned` +
     tính commission như hiện tại → tự động "trên giá flash".
   - **Trong `$transaction` đặt đơn** (cạnh trừ stock): với mỗi line flash gọi `consumeQuota(tx,...)`. Nếu
     `consumeQuota` throw (hết suất / vượt giới hạn) ⇒ rollback cả đơn (fail-fast, đặt cùng chỗ trừ stock).
   - **Snapshot** đơn giá flash vào `OrderItem` (giá đã chốt) để hoàn/đối soát về sau không phụ thuộc đợt flash.
   - **Giá đổi giữa chừng**: nếu lúc checkout item KHÔNG còn ACTIVE/hết quota → dùng giá thường; nếu tổng thay
     đổi so với giá client thấy, trả lỗi mềm `PRICE_CHANGED` (kèm giá mới) để FE hỏi lại — **không âm thầm tính
     giá cao hơn**. (Client gửi kèm `expectedTotal`; lệch ⇒ 409 + payload giá mới.)
3. **`orders.service` cancel + `admin.service` reviewReturn (RETURNED)** — nếu OrderItem có `flashSaleItemId`
   → gọi `FlashSaleService.restore(...)` trong cùng tx hoàn tiền (mirror khôi phục stock).

### OrderItem — trường mới
- `flashSaleItemId String?` (snapshot line nào mua ở giá flash → phục vụ restore khi huỷ/hoàn). Giá đã lưu
  ở `unitPrice` sẵn có.

### Controller / API
- **Public/user:** `GET /flash-sales/active` → `listActive`. (Giá flash cho product-detail/cart lấy qua
  luồng cart/catalog đã hook, không cần endpoint riêng.)
- **Admin** (`admin` module hoặc module `flash-sale` với guard ADMIN):
  - `POST /admin/flash-sales` (title/startAt/endAt) · `PATCH /admin/flash-sales/:id` (sửa/bật-tắt) ·
    `GET /admin/flash-sales` (list + soldCount).
  - `POST /admin/flash-sales/:id/items` (variationId, flashPrice, quota, perUserLimit?) ·
    `DELETE /admin/flash-sales/items/:itemId`.
  - **Validate lúc tạo item:** `flashPrice < variation.retailPrice` (giảm thật, ≥ `flashsale.min_discount_pct`
    nếu bật) · `quota ≤ variation.stock` · **không trùng** đợt flash ACTIVE khác cho cùng variation ·
    `startAt < endAt`.

### FE
- **`flash-sale.tsx`** viết lại: gọi `GET /flash-sales/active`; countdown tới **`endAt` thật** (giữ tông calm
  §3.2 — cập nhật 30s); progress "đã bán X%" (`soldCount/quota`); badge `-pct%`. Ẩn khi không có item active.
- **product-detail**: khi variation đang flash → hiện giá flash + giá gạch + countdown + "đã bán X%" + còn suất.
- **cart/checkout**: dùng giá flash; nếu nhận `PRICE_CHANGED` (409) → hiện sheet "Giá ưu đãi đã kết thúc, giá
  mới là …" cho user xác nhận trước khi đặt.
- **web-admin `/admin`**: thêm tab **"Flash Sale"** — CRUD sự kiện + item, xem đã bán, bật/tắt.

### Config (SystemConfig, chỉnh runtime)
- `flashsale.default_per_user_limit` = 5
- `flashsale.min_discount_pct` = 0 (tắt validate mức giảm tối thiểu; >0 để bắt buộc)

## Bất biến (không đổi / phải giữ)
- **Chống oversell + hết-suất**: mọi thay đổi `stock` và `soldCount` atomic bằng `updateMany` guard trong
  cùng `$transaction` đặt đơn; kẻ thua race thấy `count===0` → throw rollback.
- **perUserLimit** enforce atomic (guard `quantity+qty<=limit`), không tin đọc-rồi-ghi.
- **Server-authoritative giá**: giá tính lại ở checkout, không tin giá client/cart cũ.
- **Coupon KHÔNG áp lên flash item** (loại khỏi base); **combo KHÔNG gộp flash item** (tránh chồng giảm);
  **điểm + freeship** vẫn áp trên toàn đơn.
- **Điểm tích + hoa hồng** trên giá thực trả (flash).
- **Huỷ/hoàn** → restore `soldCount` + `FlashSalePurchase.quantity` (mirror khôi phục stock).
- `OrderItem.unitPrice` là giá đã chốt (snapshot) — hoàn tiền/đối soát dùng giá này.

## Testing
- `flash-sale.service.spec`: resolveEffective (ACTIVE còn quota → flash; hết quota / ngoài giờ / isActive=false
  → fallback); listActive lọc đúng.
- consumeQuota: 2 đơn đua suất cuối → chỉ 1 thắng (count===0 kẻ thua); vượt perUserLimit → throw; cộng dồn
  nhiều đơn cùng user chạm limit.
- restore: huỷ/hoàn trả lại soldCount + purchase.quantity (không âm).
- checkout: coupon loại flash item khỏi base; điểm áp toàn đơn (trần 20%); điểm tích + commission trên giá
  flash; `PRICE_CHANGED` khi flash hết giữa chừng (không tính giá cao hơn).
- admin validate: flashPrice ≥ retail → reject; quota > stock → reject; trùng đợt ACTIVE → reject.

## Ngoài phạm vi (MVP)
- Flash sale theo **brand/CTV storefront** (chỉ admin sàn).
- **"Nhắc tôi" + push/ZNS** trước giờ mở bán (Phase 3).
- Stack coupon lên giá flash; flash trong combo.
- Thông báo tự động khi bắt đầu/sắp hết.
- Giá bí mật tới giờ mở bán (hiện hiển thị luôn giá flash khi ACTIVE).

## Phạm vi file dự kiến chạm
- MỚI: `apps/api/src/modules/flash-sale/` (`flash-sale.module.ts`, `flash-sale.service.ts`,
  `flash-sale.controller.ts`, `admin` endpoints hoặc gộp vào `admin` module), spec test.
- `apps/api/prisma/schema.prisma` (3 model + quan hệ Variation + `OrderItem.flashSaleItemId`) + migration tay + seed 2 config.
- `apps/api/src/modules/cart/cart.service.ts` (resolve giá flash + field FE).
- `apps/api/src/modules/checkout/checkout.service.ts` (giá server-authoritative, coupon base loại flash,
  consumeQuota trong tx, PRICE_CHANGED).
- `apps/api/src/modules/orders/orders.service.ts` + `admin/admin.service.ts` (restore khi huỷ/hoàn).
- FE: `apps/miniapp/src/components/flash-sale.tsx` (viết lại), product-detail, cart/checkout (PRICE_CHANGED),
  `apps/web/src/app/admin/page.tsx` (tab Flash Sale) + `apps/web/src/lib/admin-client.ts`.
- `apps/api/prisma/seed.ts` (2 config flashsale.*).
