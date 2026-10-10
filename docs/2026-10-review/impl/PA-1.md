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

## Lượt 2 — Yêu cầu 5 (đơn hộ thuộc khách cuối, CTV là người giới thiệu)

**Trạng thái: BỎ (dừng ở mức an toàn tiền)** — không sửa code. Đổi `Order.userId` của đơn hộ sang khách cuối kéo theo sửa nhiều file ngoài nhóm file của gói (có file gói PA-3 đang giữ), làm dở sẽ làm hỏng luồng CTV đang chạy. Phần tiền của yêu cầu 5 đã được lượt 1 chuẩn bị sẵn: `refundEndCustomer` hoàn về `order.userId` khi `userId` ≠ CTV, nên đổi chủ đơn sau này không phải sửa lại đường hoàn tiền.

### Vì sao dừng (bằng chứng)

Hiện CTV dùng đơn hộ qua chính quyền "chủ đơn" (`userId = CTV`). Ghi `userId = khách cuối` khi khớp SĐT sẽ làm:
- `ctv-order-sheet.tsx` mở `/order/:code` và `/bank-payment/:code` ngay sau khi tạo đơn → `orders.service.ts:98` (`detail`) và `bank-transfer.service.ts:21` (`getBankQr`) trả 404 cho CTV: CTV mất QR để gửi khách chuyển khoản. `zalopay.service.ts:60` cũng chặn tương tự.
- Tab "Đơn hàng" của CTV (`orders.service.ts:71` `list` lọc `userId`) không còn thấy đơn hộ; CTV không tự huỷ được đơn hộ chưa thanh toán (đường `cancel` đi qua `detail`).
- Thông báo trạng thái chuyển sang khách: `order-status.service.ts:155` (file gói PA-3 giữ — CẤM sửa), `pancake.processor.ts:216,358`, `zalopay.service.ts:192`. Khách nhận thông báo về một đơn họ không tự đặt — cần duyệt nội dung.
- Hạng thành viên: `loyalty.service.ts:211` `recalcTier` cộng chi tiêu theo `order.userId` → doanh số đơn hộ chuyển từ CTV sang khách (đúng ý Q-01, nhưng hạng của CTV hiện có sẽ tụt — cần chủ dự án biết trước).
- Thống kê CTV **không** phụ thuộc `userId`: dashboard/hoa hồng đọc `commission.affiliateUserId`, analytics gian hàng đọc `referrerUserId` (`affiliate.service.ts:812`), `analytics-aggregation.service.ts:19` gộp khách theo `endCustomerKey`. Phần này đổi được mà không gãy.

### Thiết kế đề xuất (cho một gói riêng, sau khi PA-3 merge)

1. **Schema (additive):** thêm `Order.placedByUserId String?` + index `(placedByUserId, createdAt)`. Backfill: `UPDATE orders SET "placedByUserId" = "userId" WHERE "placedForCustomer"`. Giữ `referrerUserId` = CTV (người hưởng hoa hồng) như hiện tại.
2. **Tạo đơn** (`affiliate.placeOrderForCustomer`): tìm `User` theo `phone = endCustomerKey`, không bị khoá, khác CTV → `userId = khách`; không khớp → `userId = CTV` như cũ (không tạo tài khoản ma). Luôn ghi `placedByUserId = CTV`. Kiểm idempotency theo `placedByUserId` thay vì `userId`.
3. **Quyền xem/thanh toán:** một helper dùng chung `canActOnOrder(order, actorId) = order.userId === actorId || (order.placedForCustomer && order.placedByUserId === actorId)` cho `orders.detail`, `bank-transfer.getBankQr`, `zalopay` tạo phiên. Huỷ: CTV chỉ huỷ được khi chưa PAID (đã có ở `assertCustomerCancellable`), khách cuối huỷ theo luật khách thường.
4. **Màn CTV:** endpoint mới `GET /affiliate/assisted-orders` lọc `placedByUserId = me` (phân trang, trạng thái, tổng), miniapp trang affiliate thêm danh sách "Đơn lên hộ" đọc endpoint này thay cho tab Đơn hàng. Dashboard/hoa hồng giữ nguyên (đã đọc theo `affiliateUserId`).
5. **Hoa hồng:** `createCommissionForOrder` / `reverseCommissionsForOrder` — khi `userId ≠ referrerUserId` đơn hộ đi nhánh giới thiệu thường; điều kiện `placedForCustomer` vẫn giữ cho trường hợp không khớp tài khoản. Chặn C-028 (SĐT trùng CTV) phải chạy TRƯỚC bước khớp tài khoản.
6. **Thông báo:** đơn hộ gửi cho cả khách (nếu `userId` là khách) và CTV (`placedByUserId`) — sửa ở `order-status.service.ts` nên phải làm sau PA-3.
7. **Race spec cần có:** tạo đơn hộ với SĐT khớp khách → `userId = khách`, `placedByUserId = CTV`; CTV xem được chi tiết + QR; khách huỷ đơn PAID → ví khách; CTV huỷ đơn PAID → 400; hạng CTV không cộng đơn hộ.

### Lệnh kiểm chứng (lượt này, output thật)

```
cd apps/api
DATABASE_URL=postgresql://tubu:tubu@localhost:5541/tubutree_it?schema=public npx jest -c test/integration-race/jest.config.js --runInBand ctv-assisted-refund
  PASS test/integration-race/ctv-assisted-refund.race-spec.ts
  Tests: 10 passed, 10 total
```

### Giả định

- "Không để nửa vời làm hỏng màn CTV" được ưu tiên hơn việc làm xong yêu cầu 5 trong gói này.

## C-028 — Chặn CTV lên đơn hộ với SĐT của chính mình — XONG

- `affiliate.service.ts` `placeOrderForCustomer`: sau kiểm vai trò, chuẩn hoá SĐT tài khoản CTV và SĐT người nhận về dạng `0xxxxxxxxx` (cùng `normalizeToLocalPhone` dùng cho `endCustomerKey`); trùng → `400 "Không thể lên đơn hộ với SĐT của chính bạn..."` TRƯỚC khi giữ kho, tạo đơn, tạo hoa hồng. Miniapp `ctv-order-sheet.tsx` đã hiện thông báo lỗi API qua snackbar (`getErrorMessage`) nên không cần sửa FE.
- Đơn cũ đã lỡ tạo với SĐT CTV: đường hoàn tiền đã xử lý ở C-001 (race spec `ctv-assisted-refund` ca "CTV nhập SĐT của chính mình" → hoàn thủ công, không vào ví CTV).

### Test (đỏ → xanh)

`affiliate.service.spec.ts` thêm 4 ca: trùng SĐT dạng `0x`/`0x`, tài khoản `0x` + nhập `+84 ...`, tài khoản `84x` + nhập `090.123.4567` → BadRequest, không gọi `$executeRaw`/`order.create`/`commission.create`; CTV chưa có SĐT → lên đơn bình thường.

```
cd apps/api
npx jest --maxWorkers=1 src/modules/affiliate/affiliate.service.spec.ts -t placeOrderForCustomer   # trước khi sửa
  Tests: 3 failed, 67 skipped, 19 passed, 89 total
npx jest --maxWorkers=1 src/modules/affiliate                                                      # sau khi sửa
  Test Suites: 3 passed, 3 total
  Tests: 110 passed, 110 total
npx tsc --noEmit -p tsconfig.json   -> exit 0
npx eslint src/modules/affiliate/affiliate.service.ts src/modules/affiliate/affiliate.service.spec.ts   -> exit 0
```

Migration: không.

### Giả định

- "SĐT trùng tài khoản CTV" hiểu là SĐT của chính tài khoản CTV đang lên đơn (`User.phone`). Không chặn SĐT của CTV KHÁC: người đó là người mua thật (đổi chéo giữa 2 CTV là thông đồng, cần luật nghiệp vụ riêng — để chủ dự án quyết).
- Áp dụng cả khi người lên đơn là ADMIN (cùng endpoint, cùng rủi ro tự hưởng hoa hồng).
- CTV chưa khai SĐT thì không có gì để so — vẫn cho lên đơn.

### Việc còn lại

- Khi làm thiết kế "userId = khách cuối" (yêu cầu 5), bước chặn này phải chạy trước bước khớp tài khoản theo SĐT (đã ghi ở mục 5 của thiết kế).
