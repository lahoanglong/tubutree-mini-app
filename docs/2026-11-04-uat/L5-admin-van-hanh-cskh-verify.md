# Kiểm lại lane 5 (L5-admin-van-hanh-cskh): reviewer đối kháng

Mã: worktree `uat-1104`, HEAD `98803f006` (= PROD). Lane 5 đang chạy lúc kiểm (API 3251, web 3252). Ngày 04/11/2026.

| ID | Kết luận | Mức | Tái hiện |
|---|---|---|---|
| L5-B01 | CONFIRMED | P2 (giữ nguyên) | 6/6 |

## L5-B01: "Huỷ đơn" thua cuộc đua với "Đã nhận tiền", API trả 200, đơn vẫn CONFIRMED/PAID

**1. Chạy lại repro.** `node .../scripts/L5-admin-van-hanh-cskh/repro-L5-B01-cancel-race.mjs` (từ `uat-1104`) thoát mã 1 và in `TÁI HIỆN 6/6`.
Cả 6 đơn có kết quả giống nhau: `Đã nhận tiền 201; Huỷ 200 (body.status=CONFIRMED); đơn cuối CONFIRMED/PAID`.
Script chỉ gọi hai request thật cùng lúc bằng `Promise.all` (Kế toán `POST /admin/orders/:id/confirm-payment`, CSKH `PUT /admin/orders/:id/status` CANCELLED). Script không ghi gì thẳng vào DB.

Đối chiếu SQL trên DB lane 5 (đơn `TUBU2026110392344`, `TUBU2026110345315`):
- `status=CONFIRMED`, `paymentStatus=PAID`, `pancakeCancelStatus=CANCELLED`
- `pancakeAttention` = "Pancake đã huỷ nhưng đơn Tubu còn hiệu lực (đơn Pancake #96001xx; đơn đổi trạng thái/thanh toán/vận đơn trong lúc huỷ, nay CONFIRMED + PAID) — kho sẽ KHÔNG giao"
- `order_status_history` chỉ có một dòng `PENDING_PAYMENT>CONFIRMED/ADMIN` (Kế toán). Lần huỷ không để lại dòng nào.

Vậy CSKH nhận 200 trong khi đơn không bị huỷ. Pancake (giả) đã nhận lệnh huỷ, nên kho sẽ không giao một đơn đã trả tiền.
Cờ "Cần xử lý Pancake" vẫn được ghi, vì vậy không có tiền bị mất âm thầm.

**2. Mã thật.**
- `apps/api/src/modules/orders/order-status.service.ts:389-401`: ở nhánh `if (!won)`, hàm đọc lại đơn và gọi `flagPancakeCancelDivergence`. Hàm chỉ ném lỗi trong hai trường hợp: đơn đã bàn giao (`CancelAfterHandoverError`), hoặc đơn đã đóng mà đích là SHIPPING/DELIVERED. Mọi trường hợp còn lại đi tới `return current;` (dòng 400).
  Hành vi "thua thì bail êm" là cố ý cho webhook và cron (spec `order-status.service.spec.ts:621`, "thua race (flip count=0) → bail êm"). Vì vậy không nên đổi chung ở đây.
- `apps/api/src/modules/admin/admin.service.ts:1088-1111` (`updateOrderStatus`) trả thẳng đơn mà `setStatus` trả về. Hàm không so `updated.status` với `status` được yêu cầu. Đây mới là chỗ sai cho người bấm.
- `apps/web/src/components/admin/order-status-actions.tsx:161-164`: `onSuccess: refresh` không báo gì. Màn đã hiện lỗi của `statusMut` (dòng 349-351), nên chỉ cần API trả 4xx là CSKH thấy câu báo.

**3. Luật.** Không có luật đã chốt nào (AGENTS.md, brief go-live 03/11) cho phép báo thành công khi trạng thái không đổi.
Cùng hàm đã ném lỗi rõ cho các nhánh thua khác: `CancelAfterHandoverError`, `InvalidOrderTransitionError` (R3-CANCEL-5).
`markPaid` thua race cũng trả mã rõ (`ALREADY_PAID`, `NOT_PAYABLE`, `CLOSED`). Kỳ vọng của lane (huỷ được, hoặc báo lỗi rõ) đúng tinh thần mã hiện có.

**4. Kết luận: CONFIRMED, P2.** Không mất tiền, không lộ dữ liệu, và đơn được đưa vào "Cần xử lý Pancake" kèm câu hướng dẫn. Vì vậy chưa tới P1.
Tuy vậy, người bấm được báo sai là đã huỷ, và đơn đã trả tiền mà kho Pancake sẽ không giao. Ca L5-RACE-06 (Kho đóng gói thắng) có cùng gốc.

**Đề xuất sửa:** trong `AdminService.updateOrderStatus`, sau `setStatus`, nếu `updated.status !== status` thì ném `ConflictException` 409 bằng tiếng Việt, ví dụ:
"Đơn vừa chuyển sang <nhãn trạng thái> trong lúc bạn thao tác nên chưa đổi được. Tải lại đơn rồi thử lại."
Khi đích là CANCELLED và đơn có cờ Pancake, nối thêm "Đơn đã vào Cần xử lý Pancake."
Giữ nguyên `setStatus` (webhook/cron cần bail êm). Thêm spec admin cho trường hợp flipCount=0 phải ra 409, cùng một ca e2e chạy repro trên.

## Cuối việc
Đã chạy `lane-down.sh 5` (không `--drop`).
