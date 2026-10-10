# PA-4 — Toàn vẹn đại lý / Pancake / lộ dữ liệu

## C-008 (phần dealer) — XONG
- `dealer.service.ts` `placeOrder`: hạn mức = `tier?.creditLimit ?? 0`, kiểm tra cả ở fast-fail lẫn trong transaction Serializable (bỏ nhánh `&& tier`). Không tier -> từ chối CREDIT với thông báo "chưa được gán bậc"; có tier giữ nguyên "Vượt hạn mức công nợ.". PREPAID không bị ảnh hưởng.
- Test: `dealer.service.spec.ts` (describe "hạn mức công nợ (C-008)", 4 ca; ca không-tier ĐỎ trước khi sửa: "Received promise resolved instead of rejected"); race spec `test/integration-race/dealer-credit-limit.race-spec.ts` (Postgres thật: không tier 4 đơn đồng thời -> 0 đơn, nợ 0; có tier 160k/5 đơn 80k -> 1 thành công, nợ 80k).
- Giả định: không đổi đường ghi công nợ (vẫn Serializable); bắt buộc tier khi gán role thuộc PA-3.

## C-011 — XONG
- `pancake-push-reconcile.service.ts`: where có `NOT: { type: 'DEALER', items: { some: { backorderedQty: { gt: 0 } } } }` (không chiếm lô BATCH_SIZE) + guard trong vòng lặp. Đơn khách lẻ giữ hành vi cũ. Đơn đại lý được đẩy khi DealerBackorderService lấp đủ.
- Test: 4 ca mới trong `pancake-push-reconcile.service.spec.ts` (2 ca ĐỎ trước khi sửa).

## C-013 — XONG
- `merchant.service.ts` `listMerchantOrders`: `include` thay bằng `select: MERCHANT_ORDER_SELECT` (whitelist) cho mọi role. Đơn: id, code, status, subtotal/discount/shippingFee/total, paymentMethod/Status, shippingAddress (vẫn che với non-admin như cũ), shippingPartner/Code/Status, trackingLink, createdAt/updatedAt; items: id, productName/Slug, variationName, unitPrice, quantity, total, backorderedQty; user: chỉ fullName + phone (đã che). KHÔNG còn: invoiceRequest/Url/Status, note, userId, referrerUserId, endCustomerKey, idempotencyKey, pancakeOrderId, paymentTxnId, commission, user.id, item.variationId/flashSaleItemId.
- FE: grep `apps/web` (chỉ `merchant/page.tsx` + `merchant-client.ts` gọi endpoint này; miniapp không gọi) — page dùng code/id/status/user.fullName/phone/shippingAddress/items(id, productName, variationName, unitPrice, quantity, backorderedQty): đều còn. Bỏ `note` và `user.id` khỏi type `MerchantOrder` (không dùng).
- Test: `merchant.service.spec.ts` describe "C-013" (5 ca; ĐỎ trước khi sửa: 5 failed — thiếu `select`).
- Giả định: ADMIN gọi qua cổng /merchant cũng dùng cùng whitelist (không cần note/hoá đơn ở cổng này; admin có /admin riêng).

## C-036 — XONG
- `catalog.service.ts` `getBySlug`: destructure bỏ `pancakeId` của product (include trả mọi cột scalar). Variations đã dùng `publicVariationSelect` không có pancakeId (test khoá lại). FE (miniapp/web/packages) không tham chiếu `pancakeId`.
- Test: `catalog.service.spec.ts` describe "C-036" (2 ca; ca product ĐỎ trước khi sửa).
