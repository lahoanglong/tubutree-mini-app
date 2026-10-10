# PA-1 — Tiền đơn CTV lên hộ + hoa hồng

Nhánh `hz3/PA-1` (tách từ `hardening/2026-10` @ 015c5fb). Quyết định áp dụng: Q-01.

## Lượt 1 — C-001 (yêu cầu 1-4 của gói)

**Trạng thái: XONG** cho yêu cầu 1, 2, 3, 4. Yêu cầu 5 (userId = khách cuối), 6 (C-028), 7 (C-002) thuộc các lượt sau.

### Đã làm

1. **Tiền đơn hộ không bao giờ về ví CTV.** Mọi đường hoàn của đơn (khách tự huỷ `orders.cancel`, admin/merchant/Pancake qua `OrderStatusService.setStatus` CANCELLED/RETURNED, admin duyệt trả hàng `admin.reviewReturn`, COD đã giao rồi trả) đều đi qua một chỗ: `OrderReversalService.reverseFinancials`. Grep `walletBalance: { increment` / `coinsBalance: { increment` trong `apps/api/src` xác nhận không có đường hoàn đơn nào khác. Với `placedForCustomer = true`, sau khi guard PAID→REFUNDED (hoặc COD UNPAID→REFUNDED) thắng, tiền đi `refundEndCustomer` thay vì `order.userId`.
2. **Đích hoàn** (`order-reversal.service.ts`, `refundEndCustomer`):
   - Đơn đã ghi `userId` khác CTV (thiết kế yêu cầu 5) → ví `order.userId`.
   - Không thì khớp `User.phone` = `endCustomerKey` (hoặc SĐT snapshot chuẩn hoá 84→0) → ví khách đó.
   - Không khớp được, tài khoản bị khoá, hoặc tài khoản khớp chính là CTV (CTV nhập SĐT của mình) → dòng `MANUAL_TRANSFER` / `PENDING` cho admin chuyển khoản tay.
   - Mọi lần hoàn đơn hộ đều ghi một dòng `order_customer_refunds` (cả WALLET/COMPLETED) để giữ vết: mã đơn, SĐT, tên người nhận, số tiền, lý do (CANCELLED/RETURNED). `orderId` unique → không thể hoàn 2 lần cho một đơn.
   - `moneyRefunded` (dùng để báo "đã hoàn vào Ví" cho `order.userId`) chỉ true khi chính ví đó được cộng — CTV không nhận thông báo sai.
   - Admin xử lý hàng đợi: `GET /admin/customer-refunds?status=PENDING`, `POST /admin/customer-refunds/:id/mark-paid {bankRef?, note?}` (PENDING→COMPLETED atomic, một lần).
3. **CTV không tự huỷ đơn hộ đã PAID** (`orders.service.ts` `assertCustomerCancellable`, kiểm cả ảnh chụp lẫn bản đọc lại dưới `FOR UPDATE`): trả 400 "Đơn lên hộ khách đã thanh toán, CTV không tự huỷ được…". Đơn hộ chưa thanh toán CTV vẫn huỷ được. Miniapp `order-detail.tsx` ẩn nút "Hủy đơn" khi đơn hộ đã PAID và người xem là CTV giới thiệu.
4. **Thu hồi hoa hồng**: không đổi logic (`reverseCommissionsForOrder` vẫn chạy sau mọi đường huỷ/trả); race spec xác nhận hoa hồng PENDING (huỷ) và LOCKED (trả hàng) của đơn hộ chuyển REJECTED.

### Test thêm (đỏ → xanh)

`apps/api/test/integration-race/ctv-assisted-refund.race-spec.ts` (Postgres riêng `tubu_it_pa1:5541`), 10 ca:
- admin huỷ đơn hộ BANK_TRANSFER PAID, khách có tài khoản → ví khách +total, ví CTV 0, hoa hồng REJECTED
- khách không có tài khoản → yêu cầu hoàn thủ công PENDING (SĐT, tên, số tiền, mã đơn)
- CTV nhập SĐT của chính mình → không về ví CTV, thành hoàn thủ công
- CTV tự huỷ đơn hộ PAID → 400, đơn/tiền giữ nguyên
- CTV tự huỷ đơn hộ chưa thanh toán → huỷ được, không có khoản hoàn, hoa hồng REJECTED
- admin duyệt trả hàng đơn hộ COD đã giao → ví khách +total, ví CTV 0, hoa hồng LOCKED → REJECTED
- COD đã giao rồi admin setStatus RETURNED → hoàn thủ công, ví CTV 0
- 3 admin huỷ đồng thời → đúng 1 dòng hoàn, ví khách cộng 1 lần
- admin mark-paid đồng thời 2 lần → 1 thắng, COMPLETED có bankRef
- đơn thường vẫn hoàn vào ví người đặt như cũ

Lần chạy đỏ (trước khi sửa): `Tests: 7 failed, 2 passed, 9 total` — `Expected: 0 / Received: 200000` (ví CTV nhận tiền), `Received promise resolved instead of rejected` (CTV huỷ được đơn PAID).

### Lệnh kiểm chứng (output thật)

```
cd apps/api
DATABASE_URL=postgresql://tubu:tubu@localhost:5541/tubutree_it?schema=public npx jest -c test/integration-race/jest.config.js --runInBand ctv-assisted-refund cod-return-refund order-cancel dealer-bonus buy-flow-4a
  PASS ctv-assisted-refund / cod-return-refund / order-cancel / dealer-bonus / buy-flow-4a
  Tests: 24 passed, 24 total
npx jest --maxWorkers=1 src/modules/orders src/modules/admin/admin.service src/modules/affiliate
  Tests: 311 passed, 311 total
npx tsc --noEmit -p tsconfig.json        (apps/api)      -> không lỗi
npx tsc --noEmit                         (apps/miniapp)  -> không lỗi
npx eslint <file đã sửa>                                 -> không lỗi
npx vitest run src/ds-legacy-vars-4a.spec.ts src/ds-legacy-vars-4b.spec.ts (miniapp) -> 76 passed
```

### Migration

`apps/api/prisma/migrations/20261010003425_order_customer_refunds` — additive: 2 enum mới (`CustomerRefundMethod`, `CustomerRefundStatus`), bảng `order_customer_refunds` (unique `orderId`, index `(status, createdAt)`, FK → orders). Không đụng dữ liệu cũ, không cần backfill. Đã áp bằng `prisma migrate deploy` trên Postgres riêng.

### Giả định

- Đích hoàn của khách có tài khoản là **Ví Tubu** của khách (giống mọi đơn thường), không phải hoàn về ngân hàng.
- Tài khoản khớp SĐT nhưng bị khoá (`isBlocked`) hoặc chính là CTV → không cộng ví, đi đường chuyển khoản tay để admin xác minh người trả thật (an toàn tiền nhất).
- Đơn đang DELIVERED lúc đảo nghĩa là lần đảo là RETURNED (bảng chuyển trạng thái chỉ cho DELIVERED→RETURNED), dùng để ghi `reason`.
- Đơn hộ đã PAID: khách cuối (khi sau này đơn ghi `userId` = khách) vẫn được tự huỷ qua API — chỉ chặn khi người huỷ là CTV giới thiệu. Miniapp cũng chỉ ẩn nút với CTV.

### Việc còn lại

- Màn admin web cho hàng đợi `/admin/customer-refunds` (API đã có; web admin thuộc gói khác đang sửa `admin/page.tsx`).
- Thông báo cho khách cuối khi tiền đã vào ví (hiện chỉ log; `NotificationsService` không có trong `OrderReversalService`, và nên gửi sau tx).
- Hoa hồng đã APPROVED/PAID của đơn bị trả muộn (admin setStatus RETURNED sau hold) chưa bị thu hồi — có từ trước, ngoài phạm vi C-001; hold_days ≥ cửa sổ đổi trả nên đường khách thường không chạm.
- `prisma/migrations/migration_lock.toml` hiện báo "modified" chỉ vì Prisma đổi xuống dòng (LF/CRLF), không có thay đổi nội dung — không commit.
- Yêu cầu 5, 6 (C-028), 7 (C-002): lượt sau.
