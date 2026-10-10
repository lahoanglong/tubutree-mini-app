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

## Lượt 2 — C-024 yêu cầu 4: cron tự huỷ PENDING_PAYMENT quá hạn (+ race spec cron vs tiền về)

### C-024 — yêu cầu 4 XONG (yêu cầu 3 web, 5 C-008, 6 C-050 ở lượt sau)

**Guard "chỉ huỷ khi vẫn chưa trả"** (commit `98969e9`)
- `OrderStatusService.setStatus` thêm `opts.onlyIfUnpaid`: ảnh chụp đã không còn UNPAID → trả đơn nguyên trạng, không mở
  tx; ngược lại câu lật có thêm `paymentStatus: 'UNPAID'` trong `where`. Tiền về (markPaid / callback ZaloPay / Pancake)
  chen giữa lúc cron đọc và lúc cron lật → lần huỷ trượt, đơn giữ PAID. Không truyền cờ → hành vi cũ không đổi.

**Cron** (commit `3b33b7b`) — `orders/pending-payment-expiry.cron.ts` `PendingPaymentExpiryCron`, đăng ký ở `orders.module.ts`
- `@Cron('0 */10 * * * *', { name: 'orders.pending-payment-expiry', timeZone: 'Asia/Ho_Chi_Minh' })`, thân bọc try/catch.
- Quét `type=RETAIL` (khách lẻ + CTV lên đơn hộ), `status=PENDING_PAYMENT`, `paymentStatus=UNPAID`, `paymentMethod ∈
  PREPAID_METHODS` (mới export từ `order-transition.ts`, suy từ bảng `PREPAID_METHOD` — mọi phương thức trừ COD),
  `createdAt < now − TTL`; lô 200 đơn cũ nhất mỗi lượt (index `[status, createdAt]` có sẵn).
- Huỷ qua đường huỷ chuẩn `setStatus(id, 'CANCELLED', { actorType: 'SYSTEM', note: 'Tự huỷ: quá N giờ chưa thanh toán',
  onlyIfUnpaid: true })`: hoàn kho + quota flash + coupon (OrderReversalService), đảo điểm/hoa hồng, dòng
  `order_status_history` actor SYSTEM, báo khách `ORDER_CANCELLED`, huỷ vận đơn Gomdon nếu có. Một đơn lỗi không chặn đơn khác.
- Chống chạy chồng 2 lớp: cờ `running` trong instance + `pg_try_advisory_xact_lock(hashtext('cron:orders.pending_payment_expiry'))`
  trong một transaction giữ suốt lượt (nhiều instance API → chỉ một instance quét; bên kia trả `{skipped:'LOCKED'}`).
- Config `orders.pending_payment_ttl_hours` (mặc định 24) thêm vào `prisma/seed.ts` dạng upsert `createOnly` (không ghi
  đè giá trị admin). Cron kẹp giá trị vào [1, 720] giờ; không phải số → 24.

**Test thêm (đỏ → xanh)**
- `order-status.service.spec.ts` +3 (`onlyIfUnpaid`): trước khi sửa `Tests: 2 failed, 1 passed` (lọc -t), sau sửa 40/40.
- `pending-payment-expiry.cron.spec.ts` mới, 13 test (timeZone qua metadata `SCHEDULE_CRON_OPTIONS`, bộ lọc where, gọi
  setStatus đúng tham số, đơn được trả chen giữa không tính là huỷ, lỗi 1 đơn, kẹp TTL 0/−5/'abc'/null/100000, khoá advisory
  bị giữ, chạy chồng trong instance, handleCron nuốt lỗi): trước khi có file nguồn → suite FAIL (không import được).
- Race spec mới `test/integration-race/pending-payment-expiry.race-spec.ts` (Postgres thật, có order item + variation để đo kho):
  (a) cron đọc đơn, `markPaid` commit chen giữa → đơn CONFIRMED+PAID, kho giữ nguyên, không dòng CANCELLED, chỉ 1 thông báo
  ORDER_CONFIRMED; (b) tiền về chỉ lật paymentStatus (status vẫn PENDING_PAYMENT) chen giữa → không huỷ, không hoàn ví;
  (c) 8 đơn, cron + markPaid đồng thời → mỗi đơn hoặc PAID nguyên kho hoặc CANCELLED/UNPAID hoàn kho đúng 1 lần, markPaid
  thua trả `CLOSED`; (d) 2 instance cron cùng lúc → 1 `LOCKED`, mỗi đơn huỷ + báo khách đúng 1 lần; (e) đơn mới, đơn
  DEALER, COD, đã PAID không bị đụng.
  Kiểm đột biến: bỏ `paymentStatus:'UNPAID'` khỏi where của setStatus → (b) ĐỎ (`1 failed, 4 passed`); bỏ kiểm khoá
  advisory → (d) ĐỎ (`1 failed, 4 passed`); khôi phục → xanh.

**Lệnh kiểm chứng + output thật**
```
cd apps/api
npx jest --maxWorkers=1 src/modules/orders src/modules/admin src/modules/merchant src/modules/integrations/pancake src/modules/integrations/payment
  Test Suites: 26 passed, 26 total
  Tests:       499 passed, 499 total
DATABASE_URL=postgresql://tubu:tubu@localhost:5543/tubutree_it?schema=public npx jest -c test/integration-race/jest.config.js --runInBand \
  test/integration-race/pending-payment-expiry.race-spec.ts test/integration-race/admin-confirm-payment.race-spec.ts test/integration-race/order-cancel.race-spec.ts
  PASS pending-payment-expiry / admin-confirm-payment / order-cancel — Tests: 11 passed, 11 total
DATABASE_URL=<IT 5543> npx tsx prisma/seed.ts → "✅ Seed done."; system_configs: orders.pending_payment_ttl_hours|24|orders
npx tsc --noEmit -p tsconfig.json → exit 0 ; npx eslint <file đã sửa> → exit 0
```

**Migration:** không có (dùng index `orders(status, createdAt)` sẵn có; config là dữ liệu seed).

**Giả định**
- "Đơn trả trước của khách lẻ/CTV" = `type=RETAIL` + phương thức khác COD. Đơn DEALER không quét chút nào (kể cả đại lý trả
  trước chuyển khoản): đơn đại lý có backorder/công nợ và đã có luồng xác nhận riêng ở `/admin/dealer-orders`; an toàn hơn là
  không tự huỷ đơn đại lý.
- TTL tính từ `createdAt`; sàn 1 giờ để cấu hình nhầm (0) không huỷ đơn khách đang chuyển khoản. Trần 720 giờ. Không thêm
  khoá vào `SystemConfigService.RANGES` vì file đó ngoài nhóm file của gói — cron tự kẹp.
- Tiền về SAU khi cron đã huỷ: markPaid trả `CLOSED`, callback ZaloPay/Pancake log "CẦN HOÀN TIỀN THỦ CÔNG" (hành vi sẵn có) —
  không hồi sinh đơn đã nhả kho.
- Khoá advisory giữ 1 kết nối pool suốt lượt (timeout tx 15 phút, lô 200 đơn); mỗi lần huỷ dùng tx riêng trên kết nối khác.

**Việc còn lại**
- Yêu cầu 3 (web admin), 5 (C-008 phần admin), 6 (C-050) — các lượt sau.
- Sau deploy: chạy seed (hoặc thêm tay khoá `orders.pending_payment_ttl_hours`), nếu không cron dùng mặc định 24 giờ.
