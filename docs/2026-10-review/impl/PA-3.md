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

## Lượt 3 — C-024 yêu cầu 3 (web admin) + C-008 phần admin + C-050

### C-024 — yêu cầu 3 XONG (cả gói C-024: yêu cầu 1–4 XONG)

**API** (commit `1dbb21b`)
- `orders/order-transition.ts` `allowedNextStatuses(order)`: bảng `ORDER_TRANSITIONS` trừ chính nó, lọc qua
  `assertPaidBeforeFulfilment` (cùng luật `setStatus`); trạng thái lạ → `[]`.
- `AdminService.listOrders` trả thêm mỗi đơn `allowedTransitions` (đơn đại lý dùng cờ `dealerOnCredit` làm `onCredit`)
  và `canConfirmPayment` (RETAIL + BANK_TRANSFER + UNPAID + chưa CANCELLED/RETURNED — đúng điều kiện `confirmOrderPayment`).

**Web** (commit `9ac420b`)
- Component mới `components/admin/order-status-actions.tsx` thay khối nút cứng ở `app/admin/page.tsx` (cũ :832-899):
  nút trạng thái = đúng `allowedTransitions` (không có RETURNED — trả hàng đi tab Đổi/Trả); API cũ không có trường →
  không hiện nút. DELIVERED/CANCELLED vẫn hỏi xác nhận (giữ câu hỏi Gomdon). Khối "Đã nhận tiền" khi `canConfirmPayment`:
  ô mã giao dịch tuỳ chọn, `window.confirm` có mã đơn + số tiền, chống bấm dồn (ref), message API hiện nguyên văn.
- `lib/admin-client.ts`: `AdminOrder.allowedTransitions/canConfirmPayment`, `confirmOrderPayment()`.

### C-008 (A5N-03) phần admin — XONG (commit `2385ea8`, web ở `9ac420b`)
- `POST /admin/users/role`: `SetUserRoleDto.tierId?` (IsString, MaxLength 100). `AdminService.setUserRole(..., tierId)`:
  role DEALER thiếu/rỗng tierId → 400 "Cần chọn bậc đại lý…"; tier không tồn tại → 400; hợp lệ → `role` +
  `metadata.dealerTierId` merge vào metadata cũ (giống duyệt hồ sơ). Role khác bỏ qua tierId.
- Web `GrantRoleForm`: chọn DEALER thì hiện ô "Tier ID (bắt buộc)", nút khoá khi trống; `setUserRole` chỉ gửi tierId khi DEALER.

### C-050 (A5N-05) — XONG (API `9c4a291`, web `9ac420b`)
- `orders/dto/return-request.dto.ts` (tách khỏi `orders.controller.ts`): `images` mỗi phần tử phải là
  `https://res.cloudinary.com/...` (không user:pass) HOẶC `data:image/(png|jpeg|webp|gif);base64,...` ≤ 1.500.000 ký tự.
  Từ chối `javascript:`, `data:text/html`, `data:image/svg+xml`, `http:`, host lạ/`res.cloudinary.com.attacker…`, `//host`.
- Web `components/admin/evidence-images.tsx`: thay `<img onClick={() => window.open(img)}>`; chỉ render https (bọc
  `<a target=_blank rel="noopener noreferrer">`) và base64 raster (chỉ ảnh, không link); dòng cũ trong DB chứa URL xấu bị
  ẩn kèm dòng "Đã ẩn N ảnh không hợp lệ".

**Test thêm (đỏ → xanh)**
- `admin.service.spec.ts` +4 (C-008): trước khi sửa `Tests: 3 failed, 1 passed` (-t C-008); +3 (listOrders
  allowedTransitions/canConfirmPayment): trước khi sửa `3 failed`. `admin-recycling-config.spec.ts`: đổi `toEqual` →
  `toMatchObject` + kiểm đơn lẻ không có `dealerOnCredit` (đơn giờ có thêm 2 trường).
- `admin.controller.spec.ts` +2 (DTO nhận tierId qua ValidationPipe thật, chuyển xuống service; sai kiểu/quá dài → 400).
- `order-transition.spec.ts` +5 (`allowedNextStatuses`): trước khi có hàm `5 failed, 15 passed`.
- `return-request.dto.spec.ts` mới 14 test: chạy với DTO cũ (chỉ @IsString) → `12 failed, 2 passed`; sau sửa 14/14.
  `orders.controller.spec.ts` +1 (route dùng ReturnRequestDto).
- Web (vitest): `order-status-actions.spec.tsx` 9 test, `evidence-images.spec.tsx` 12 test — trước khi có component: suite FAIL
  (không import được); sau: xanh.

**Lệnh kiểm chứng + output thật**
```
cd apps/api
npx jest --maxWorkers=1 src/modules/admin src/modules/orders
  Test Suites: 15 passed, 15 total
  Tests:       370 passed, 370 total
npx tsc --noEmit -p tsconfig.json → exit 0 ; npx eslint <file api đã sửa> → exit 0
cd apps/web
npx vitest run src/components/admin src/lib src/app/admin
  Test Files  13 passed (13)
  Tests  170 passed (170)
npx tsc --noEmit → exit 0 ; npx eslint src/app/admin/page.tsx src/components/admin/{order-status-actions,evidence-images}*.tsx src/lib/admin-client.ts → exit 0
```

**Migration:** không có.

**File ngoài nhóm file của gói (giữ tối thiểu):** `apps/web/src/lib/admin-client.ts` (thêm 2 trường kiểu, hàm
`confirmOrderPayment`, tham số `tierId` cho `setUserRole`) — page.tsx gọi API qua file này; component mới
`apps/web/src/components/admin/{order-status-actions,evidence-images}.tsx` (file mới, không đụng file của gói khác);
`apps/api/src/modules/admin/admin-recycling-config.spec.ts` (sửa 1 assert do listOrders thêm trường).

**Giả định**
- C-050: đặc tả nói "chỉ https", nhưng ImageUpload của miniapp fallback sang ảnh base64 khi thiếu `VITE_CLOUDINARY_*` —
  repo chính không có biến này trong .env nào, nên PROD đang gửi ảnh đổi trả dạng `data:image/jpeg;base64`. Chặn hẳn sẽ làm
  mọi yêu cầu đổi trả có ảnh bị 400. Chọn: nhận https host Cloudinary + base64 ảnh raster (png/jpeg/webp/gif, không SVG);
  admin chỉ hiện base64 trong `<img>` (không chạy script) và không làm link. Khi bật Cloudinary có thể bỏ nhánh base64.
- Host upload hợp lệ = `res.cloudinary.com` (hằng `RETURN_IMAGE_HOSTS`); thêm CDN khác thì thêm vào hằng này.
- Web không hiện nút RETURNED dù API cho DELIVERED → RETURNED: trả hàng có hoàn tiền đi qua duyệt yêu cầu ở tab Đổi/Trả.
- "Xác nhận" (PENDING_PAYMENT → CONFIRMED khi chưa trả) vẫn hiện vì API cho phép (giả định lượt 1); khối "Đã nhận tiền" ghi
  rõ đơn chưa giao được tới khi xác nhận tiền.
- C-008: hạ DEALER sang vai trò khác không xoá `metadata.dealerTierId` (cấp lại DEALER vẫn bắt buộc chọn bậc).

**Việc còn lại**
- C-008 phần hạn mức trong `dealer.service` (creditLimit mặc định 0 khi không tier) — gói PA-4.
- Dữ liệu cũ: DB local có 1 DEALER không tier; sau deploy admin cần gán bậc qua form mới (cấp lại DEALER kèm Tier ID).
- Danh sách bậc vẫn nhập tay Tier ID (giống form duyệt hồ sơ); có thể đổi sang dropdown khi có endpoint liệt kê bậc.
- Deploy API trước web (web dựa vào `allowedTransitions`; API cũ → khối nút trống, không sai tiền).

## Review lượt 1 (reviewer độc lập: 1 major + 7 minor)

Commit: `c87d8bf` (major + minor 2), `458f27f` (minor 7), `7e5447e` (minor 4), `ee65130` (minor 5) + commit báo cáo này.

| # | Mức | Finding | Xử lý |
|---|-----|---------|-------|
| 1 | major | Đơn trả trước chưa trả ở PENDING_PAYMENT vẫn đi được sang CONFIRMED/PACKED (nút "Xác nhận" hiện cạnh "Đã nhận tiền"); cron chỉ quét PENDING_PAYMENT → kho/flash/coupon bị giữ vĩnh viễn | **ĐÃ SỬA** (`c87d8bf`) — xác minh đúng: `allowedNextStatuses` trả `['CONFIRMED','PACKED','CANCELLED']` cho đơn CK chưa trả (test cũ còn khẳng định điều đó). Chọn phương án (a) |
| 2 | minor | `onlyIfUnpaid` không giữ trạng thái lúc cron quét; admin đẩy đơn đi tiếp giữa `findMany` và `setStatus` thì cron vẫn huỷ | **ĐÃ SỬA** (`c87d8bf`) — thêm `expectedStatus` cho `setStatus`, cron truyền `'PENDING_PAYMENT'` |
| 3 | minor | `markPaid` là bản thứ 4 của logic lật PAID (ZaloPay, Pancake, dealer có bản riêng) | **KHÔNG SỬA** — ngoài nhóm file của gói (zalopay.service, pancake.processor thuộc PA-4, dealer.service thuộc PA-4). Việc tiếp: cho callback ZaloPay và `onPaymentReconcile` gọi `OrderStatusService.markPaid` với actor SYSTEM/PANCAKE |
| 4 | minor | Cron huỷ đơn ZALOPAY mà không tra trạng thái cổng; callback mất thì đơn khách đã trả bị huỷ lặng lẽ | **ĐÃ SỬA một phần** (`7e5447e`) — không có API tra cổng nên chưa thể tra. Đơn qua cổng (khác BANK_TRANSFER) có `PaymentAttempt` khi bị tự huỷ: ghi chú huỷ (hiện trong ghi chú + lịch sử đơn) ghi "đã mở lệnh ZALOPAY: đối chiếu ZALOPAY, đã trừ tiền thì hoàn thủ công" + `logger.warn`. Vẫn huỷ để nhả kho (giả định bên dưới) |
| 5 | minor | Webhook Pancake/Gomdon báo SHIPPING/DELIVERED cho đơn chưa trả bị chặn và nuốt êm, không phát lại sau khi tiền về | **ĐÃ SỬA** (`ee65130`) — `setStatus` với actor không phải người (PANCAKE/SYSTEM/không truyền) bị chặn vì chưa trả thì nối 1 dấu vào `orders.note` ("[Chờ thanh toán: vận chuyển đã báo DELIVERED — đẩy tay sau khi nhận tiền]"), chống lặp bằng `position()` trong cùng câu UPDATE; lỗi ghi dấu không thay lỗi gốc. Admin/merchant bấm tay vẫn chỉ nhận 400 |
| 6 | minor | DTO đổi trả vẫn nhận `data:image/...;base64` (lệch đặc tả "chỉ https") | **KHÔNG SỬA** — lệch có chủ đích, đã ghi ở Giả định lượt 3 (PROD chưa cấu hình Cloudinary, miniapp gửi base64; chặn sẽ làm mọi đổi trả có ảnh bị 400). Cần chủ dự án xác nhận; bỏ nhánh base64 khi bật Cloudinary |
| 7 | minor | `orders.pending_payment_ttl_hours` không có luật ghi → lưu 0/1000/1.5 thấy "đã lưu" nhưng cron chạy số khác | **ĐÃ SỬA** (`458f27f`) — `admin-config-rules`: số nguyên `MIN_TTL_HOURS..MAX_TTL_HOURS` (1..720) giờ, hằng xuất từ cron dùng chung |
| 8 | minor | Cron lọc `type: 'RETAIL'` bỏ cả đơn đại lý trả trước (không ghi công nợ) kẹt PENDING_PAYMENT | **KHÔNG SỬA, ghi rõ loại trừ** — đơn đại lý có luồng xác nhận riêng (`DealerPaymentPanel` / `confirmDealerOrderPayment`, gói PA-4), quan hệ đại lý thường trả chậm theo thoả thuận; tự huỷ đơn sỉ là quyết định nghiệp vụ chưa có trong Q-06 (Q-06 chỉ nói đơn khách lẻ/CTV). Câu hỏi mở cho chủ dự án |

### Finding 1 — vì sao chọn (a) chứ không mở rộng cron (b)
- Trước gói này admin **không có** nút "Đã nhận tiền": cách duy nhất xử lý đơn CK đã nhận tiền là bấm "Xác nhận" → PROD có
  thể đang có nhiều đơn `CONFIRMED/PACKED + UNPAID + BANK_TRANSFER` mà khách **đã trả thật**. Phương án (b) (cron quét cả
  CONFIRMED/PACKED quá 24 giờ) sẽ tự huỷ hàng loạt đơn đã trả ở lượt chạy đầu sau deploy. (a) không đụng dữ liệu cũ.
- Luật mới (`requiresPaymentBefore(from, to)`): đơn trả trước chưa PAID (không ghi công nợ) **không được rời PENDING_PAYMENT
  trừ sang CANCELLED**; lối ra duy nhất là `markPaid` / callback thanh toán (vốn tự lật PENDING_PAYMENT → CONFIRMED + PAID).
  Áp cho mọi actor (admin, merchant, webhook) vì cùng đi qua `setStatus`; web admin tự ẩn nút "Xác nhận"/"Đóng gói" vì đọc
  `allowedTransitions` từ API. Đơn tạo mới không bị ảnh hưởng: COD và đơn trả bằng ví/xu được tạo thẳng ở CONFIRMED
  (`checkout.service.ts:196`, `affiliate.service.ts:306`, `dealer.service.ts:232`), PENDING_PAYMENT luôn là trả trước chưa trả.
- Pancake báo "confirmed" cho đơn CK chưa đối soát giờ bị chặn và nuốt êm (có dấu ghi chú theo finding 5) — vô hại vì
  `onPaymentReconcile` lật PENDING_PAYMENT → CONFIRMED khi tiền về.
- Dữ liệu cũ CONFIRMED/PACKED + UNPAID: vẫn đi PACKED/CANCELLED được, bấm "Đã nhận tiền" để giao tiếp (khoá SHIPPING/DELIVERED
  giữ nguyên như lượt 1).

### Test thêm (đỏ → xanh)
- `order-transition.spec.ts`: rời PENDING_PAYMENT sang mốc tiến cần thanh toán; PENDING_PAYMENT chưa trả → CONFIRMED/PACKED
  ném `UnpaidPrepaidTransitionError` (BANK_TRANSFER, ZALOPAY); `allowedNextStatuses` của đơn PENDING_PAYMENT chưa trả = `['CANCELLED']`.
- `order-status.service.spec.ts`: setStatus PENDING_PAYMENT → CONFIRMED/PACKED bị chặn, không mở tx; đã PAID → CONFIRMED đi được
  với guard `paymentStatus=PAID`; `expectedStatus` lệch → không mở tx/không huỷ; webhook (PANCAKE/SYSTEM/không actor) bị chặn →
  ghi dấu 1 lần, admin → không ghi; ghi dấu lỗi → vẫn ném lỗi gốc.
- `pending-payment-expiry.cron.spec.ts`: cron truyền `expectedStatus: 'PENDING_PAYMENT'`; đơn ZALOPAY có PaymentAttempt → ghi
  chú đối chiếu + 1 warn, đơn không có lệnh / BANK_TRANSFER → không.
- `admin-config-rules.spec.ts`: TTL 1/24/720 nhận; 0, 721, 1.5, "24" bị 400.
- `admin.service.spec.ts`: cập nhật kỳ vọng `allowedTransitions` của đơn A (PENDING_PAYMENT chưa trả) thành `['CANCELLED']`.
- Race spec `test/integration-race/pending-payment-expiry.race-spec.ts` (Postgres thật):
  - (f) admin bấm "Xác nhận"/"Đóng gói" đơn CK chưa trả → `UnpaidPrepaidTransitionError`, đơn vẫn PENDING_PAYMENT, cron vẫn huỷ + hoàn kho 1 lần.
  - (g) đơn bị đẩy sang CONFIRMED giữa `findMany` của cron và `setStatus` → cron không huỷ, kho nguyên. **Đỏ khi bỏ
    `expectedStatus` khỏi cron** (`1 failed, 6 passed`), xanh khi có.
  - (h) 2 webhook DELIVERED song song + 1 lặp cho đơn PACKED chưa trả → cả 3 bị chặn, đơn giữ PACKED, ghi chú cũ giữ nguyên
    và có đúng 1 dấu (kiểm SQL `position()` thật).

### Lệnh kiểm chứng (output thật)
```
cd apps/api
npx jest --maxWorkers=1 src/modules/orders/order-transition.spec.ts src/modules/orders/order-status.service.spec.ts \
  src/modules/orders/pending-payment-expiry.cron.spec.ts src/modules/admin/admin.service.spec.ts   # trước sửa
  Tests:       10 failed, 139 passed, 149 total
  # sau sửa
  Tests:       149 passed, 149 total
npx jest --maxWorkers=1 src/modules/integrations/pancake/pancake.processor.spec.ts \
  src/modules/integrations/gomdon/gomdon-webhook.service.spec.ts src/modules/merchant src/modules/admin
  Tests:       255 passed, 255 total
npx jest --maxWorkers=1 src/modules/orders/order-status.service.spec.ts      → Tests: 50 passed, 50 total
npx jest --maxWorkers=1 src/modules/orders/pending-payment-expiry.cron.spec.ts → Tests: 14 passed, 14 total
DATABASE_URL=postgresql://tubu:tubu@localhost:5543/tubutree_it?schema=public \
  npx jest -c test/integration-race/jest.config.js --runInBand pending-payment-expiry admin-confirm-payment gomdon cod-return-refund
  Test Suites: 4 passed, 4 total
  Tests:       18 passed, 18 total
npx tsc --noEmit -p tsconfig.json → exit 0 ; npx eslint <các file đã sửa> → exit 0
```

**Migration:** không có (ghi chú dùng cột `orders.note` sẵn có).

**Giả định (lượt review)**
- Finding 4: vẫn tự huỷ đơn ZaloPay/VNPay quá hạn (nhả kho/coupon) thay vì giữ vô hạn; tiền có thể đã trừ thì xử lý bằng
  đối chiếu + hoàn thủ công theo ghi chú/log. Lý do: bỏ qua đơn có PaymentAttempt sẽ giữ kho mãi cho mọi lần khách mở cổng
  rồi bỏ ngang (trường hợp phổ biến nhất), và cũng không ai biết đơn đã trả.
- Finding 1: luật "chưa trả không rời PENDING_PAYMENT" áp cả đơn đại lý trả trước (cùng hàm, đại lý có nút xác nhận tiền riêng);
  đơn ghi công nợ được tạo thẳng CONFIRMED nên không bị ảnh hưởng.

**Việc còn lại (sau review)**
- Gom `markPaid` cho callback ZaloPay + Pancake `onPaymentReconcile` + `confirmDealerOrderPayment` (finding 3) — gói sau, ngoài phạm vi PA-3.
- API tra trạng thái ZaloPay trước khi tự huỷ (finding 4) — cần tích hợp mới.
- Chủ dự án quyết: (finding 6) bỏ nhánh base64 khi bật Cloudinary; (finding 8) có tự huỷ đơn đại lý trả trước kẹt PENDING_PAYMENT không.
- Runbook deploy: sau deploy, đơn CK chưa trả không còn nút "Xác nhận" — vận hành dùng "Đã nhận tiền"; ghi chú
  "[Chờ thanh toán: vận chuyển đã báo …]" trên đơn nghĩa là cần đẩy trạng thái tay sau khi nhận tiền.

## Review lượt 2 (reviewer độc lập: 1 major)

Commit: `6be7bbd` + commit báo cáo này.

| # | Mức | Finding | Xử lý |
|---|-----|---------|-------|
| 1 | major | Cổng chặn thanh toán của PA-3 làm hỏng đường Pancake chuyển khoản chính: `PancakeProcessor.handle()` chạy `onStatusUpdated` TRƯỚC `onPaymentReconcile` trong cùng sự kiện `orders`/`order.updated`. Nhân viên Pancake ghi nhận tiền + đổi trạng thái trong một lần lưu (status 1/2/3 kèm `bank_payment>=total`) → `setStatus` ném `UnpaidPrepaidTransitionError`, ghi dấu "[Chờ thanh toán: … đẩy tay sau khi nhận tiền]" sai, rồi đối soát mới lật PAID+CONFIRMED → đơn đã trả kẹt ở CONFIRMED với ghi chú sai | **ĐÃ SỬA** (`6be7bbd`) — xác minh đúng bằng race spec (đỏ: SHIPPING/PACKED nhận `CONFIRMED`). `handle()` giờ đối soát thanh toán TRƯỚC rồi mới áp trạng thái; ngoại lệ khi status Pancake map ra CANCELLED/RETURNED thì giữ thứ tự cũ |

**Vì sao giữ thứ tự cũ cho huỷ/trả:** đảo thứ tự cho mọi trạng thái thì sự kiện "huỷ + đã nhận tiền" sẽ lật PAID+CONFIRMED (kèm
thông báo ORDER_CONFIRMED cho khách) rồi huỷ ngay và tự hoàn tiền — đổi hành vi P1-3 hiện có (đơn huỷ nhận tiền → cảnh báo hoàn
tiền thủ công, không lật PAID). Phương án "bỏ dấu khi payload chứng minh đã trả" bị loại vì không giải được việc đơn kẹt ở CONFIRMED.

**Độc lập thứ tự / idempotent:** `onPaymentReconcile` và `onStatusUpdated` mỗi hàm tự đọc lại đơn (`findOrder`), không dùng
chung ảnh chụp; `onShippingUpdated` không đụng status/payment. Sự kiện lặp: đối soát no-op (đã PAID, guard `paymentStatus=UNPAID`
trong `updateMany`), `setStatus` no-op (cùng trạng thái). Status 0 (PENDING_PAYMENT) + tiền: đối soát lật CONFIRMED, status lùi
bị `InvalidOrderTransitionError` nuốt êm — cùng kết quả cuối với trước.

### Test thêm (đỏ → xanh)
- Race spec mới `test/integration-race/pancake-paid-status.race-spec.ts` (Postgres thật, `PancakeProcessor.process()` +
  `OrderStatusService` thật, không mock `setStatus`):
  - status=3 + `bank_payment=total` → SHIPPING + PAID, không có dấu; lịch sử đúng 1 dòng; gửi lại cùng sự kiện → không đổi, 1 `order_paid`.
  - status=2 + `bank_payment=total` → PACKED + PAID.
  - status=3 không có tiền → vẫn PENDING_PAYMENT + UNPAID, có dấu, event PROCESSED (không FAILED).
  - status=6 + `bank_payment=total` → CANCELLED + UNPAID (giữ đường hoàn tiền thủ công).
  - Trước sửa: `Tests: 2 failed, 2 passed, 4 total` (2 ca đã trả nhận `CONFIRMED`); sau sửa: `4 passed`.

### Lệnh kiểm chứng (output thật)
```
cd apps/api
DATABASE_URL=postgresql://tubu:tubu@localhost:5543/tubutree_it?schema=public \
  npx jest -c test/integration-race/jest.config.js --runInBand pancake-paid-status   # trước sửa
  Tests:       2 failed, 2 passed, 4 total
DATABASE_URL=... npx jest -c test/integration-race/jest.config.js --runInBand \
  pancake-paid-status cod-return-refund admin-confirm-payment pending-payment-expiry
  Tests:       19 passed, 19 total
npx jest --maxWorkers=1 src/modules/integrations/pancake src/modules/orders/order-status src/modules/orders/order-transition
  Test Suites: 10 passed ; Tests: 166 passed, 166 total
npx tsc --noEmit -p tsconfig.json → exit 0 ; npx eslint pancake.processor.ts pancake-paid-status.race-spec.ts → exit 0
```

**Ghi chú phạm vi:** `pancake.processor.ts` nằm ngoài nhóm file của PA-3 (thuộc PA-4) — sửa tối thiểu ở `handle()` vì lỗi do cổng
của PA-3 gây ra; PA-4 chỉ sửa `pancake-push-reconcile.service.ts` nên không xung đột.
