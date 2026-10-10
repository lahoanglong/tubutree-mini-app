# PA-3 — Admin đơn chuyển khoản + trạng thái + XSS

Nhánh `hz3/PA-3` (từ `hardening/2026-10` @ `015c5fb`).

## Lượt 1 — C-024 yêu cầu 1 + 2 (+ race spec)

### C-024 (A1-006, A4-007) — MỘT PHẦN (xong yêu cầu 1, 2; yêu cầu 3 web, 4 cron làm ở lượt sau)

**Yêu cầu 2 — chặn giao đơn trả trước chưa PAID** (commit `5f70cbf`)
- `orders/order-transition.ts`: `requiresPaymentBefore` (SHIPPING, DELIVERED), `isPrepaidMethod` (bảng
  `Record<PaymentMethod, boolean>` đủ enum: mọi phương thức trừ COD là trả trước; thêm phương thức mới
  thì tsc buộc xếp loại), `assertPaidBeforeFulfilment`, lỗi `UnpaidPrepaidTransitionError`
  (kế thừa `InvalidOrderTransitionError` → admin/merchant nhận 400, webhook Pancake/Gomdon bỏ qua êm như
  mọi chuyển trạng thái không hợp lệ).
- `orders/order-status.service.ts` `setStatus`: chặn trước khi mở tx; đơn đại lý ghi công nợ (có dòng
  `DealerCreditLedger refType=ORDER`) được miễn; khi đơn đã PAID lúc đọc, lần lật có thêm guard
  `paymentStatus='PAID'`. Bảng chặn chuyển lùi giữ nguyên.

**Yêu cầu 1 — "Đã nhận tiền"** (commit `f064808`)
- Hàm dùng chung `OrderStatusService.markPaid(idOrCode, {actorType, actorId, note})`: guard atomic
  `updateMany where {paymentStatus:'UNPAID', status:<vừa đọc>}`, `paidAt`, PENDING_PAYMENT → CONFIRMED,
  dòng `order_status_history` (actor + ghi chú) và event `order_paid` trong CÙNG tx; sau commit đặt vận
  đơn thu gom Gomdon (nếu có) + báo khách `ORDER_CONFIRMED`. Kết quả: `PAID | ALREADY_PAID | CLOSED |
  NOT_PAYABLE`; thua race thì đọc lại (tối đa 3 lần) chứ không ném lỗi.
- `POST /api/admin/orders/:id/confirm-payment` (`@Roles('ADMIN')`, body `{bankRef?, note?}` có
  MaxLength) → `AdminService.confirmOrderPayment`: chỉ đơn RETAIL `BANK_TRANSFER` (khách lẻ và CTV lên
  đơn hộ); đơn DEALER → 400 chỉ sang endpoint đại lý (luật loại đơn ghi công nợ ở đó); đã PAID → 200
  `alreadyPaid:true`; đơn huỷ/trả → 400 "cần hoàn tiền thủ công"; REFUNDED/FAILED → 400.

**Test thêm (đỏ → xanh)**
- `order-transition.spec.ts` +6, `order-status.service.spec.ts` +10 (chặn giao) +11 (`markPaid`):
  chạy trước khi sửa → `Tests: 13 failed, 28 passed` rồi `11 failed, 26 passed`; sau khi sửa xanh.
- `admin.service.spec.ts` +2 (`updateOrderStatus` BANK_TRANSFER UNPAID → SHIPPING/DELIVERED = 400,
  không cộng điểm/hoa hồng) +9 (`confirmOrderPayment`: đỏ `9 failed` trước khi có hàm).
- `admin.controller.spec.ts` +2 (route POST, chỉ ADMIN, DTO validate).
- Race spec mới `test/integration-race/admin-confirm-payment.race-spec.ts` (Postgres thật):
  (a) 2 admin cùng qua bước đọc "chưa trả" (rào tất định) → 1 lần PAID, 1 dòng lịch sử, 1 `order_paid`,
  1 thông báo, bên kia `alreadyPaid`; (b) 6 đơn × 4 admin đồng thời; (c) bấm lại; (d) DELIVERED bị chặn
  khi chưa trả, giao được sau "Đã nhận tiền".
  Kiểm đột biến: bỏ guard `paymentStatus/status` trong `markPaid` → (a), (b) ĐỎ; khôi phục → xanh.

**Lệnh kiểm chứng + output thật**
```
cd apps/api
npx jest --maxWorkers=1 src/modules/admin src/modules/orders src/modules/integrations/pancake src/modules/integrations/gomdon src/modules/merchant
  Test Suites: 30 passed, 30 total
  Tests:       612 passed, 612 total
DATABASE_URL=postgresql://tubu:tubu@localhost:5543/tubutree_it?schema=public npx jest -c test/integration-race/jest.config.js --runInBand
  (11 file race, gồm admin-confirm-payment) Tests: 43 passed, 43 total
npx tsc --noEmit -p tsconfig.json   → exit 0
npx eslint <các file đã sửa>         → exit 0
```

**Migration:** không có.

**Giả định**
- "Trả trước" = mọi phương thức trừ COD (WALLET/XU vốn PAID ngay lúc đặt nên không bị ảnh hưởng).
- Chỉ chặn SHIPPING/DELIVERED (đúng đặc tả); PENDING_PAYMENT → CONFIRMED/PACKED bằng tay vẫn được (luồng
  "xác nhận trước khi tiền về" mà webhook Pancake đang hỗ trợ).
- Webhook Pancake/Gomdon báo SHIPPING/DELIVERED cho đơn trả trước chưa PAID bị bỏ qua (log warn) — an
  toàn tiền hơn là cộng điểm/hoa hồng cho đơn chưa ai trả; khi tiền về, admin bấm "Đã nhận tiền" rồi
  chuyển trạng thái.
- Endpoint mới chỉ nhận BANK_TRANSFER; ZaloPay/VNPay vẫn chỉ do callback cổng thanh toán ghi nhận.

**Việc còn lại**
- Hợp nhất webhook về `OrderStatusService.markPaid`: `pancake.processor.onPaymentReconcile`,
  `zalopay.service` callback và `DealerService.confirmDealerOrderPayment` vẫn giữ bản lật PAID riêng
  (cùng guard/hệ quả). Không sửa ở lượt này vì `api/integrations/pancake` và `api/dealer` thuộc gói PA-4
  đang sửa song song; nên đổi sau khi merge A1 (thay khối lật bằng một lời gọi `markPaid`, chỉnh spec
  `pancake.processor.spec.ts` / `zalopay.service.spec.ts` theo shape `where` mới).
- Yêu cầu 3 (web admin: nút trạng thái hợp lệ + nút "Đã nhận tiền"), 4 (cron huỷ PENDING_PAYMENT),
  5 (C-008 phần admin), 6 (C-050) — các lượt sau.
