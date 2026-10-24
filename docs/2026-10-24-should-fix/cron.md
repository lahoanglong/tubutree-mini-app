# Cron lỗi phải nhìn thấy được

## Thiết kế

- Mỗi `@Cron` có thêm `@TrackCron()` ngay bên dưới (`apps/api/src/common/cron-run/track-cron.ts`). Decorator bọc phương thức, đo thời gian, và báo kết quả cho `CronRunService` (`apps/api/src/modules/ops/cron-run.service.ts`), nơi upsert một dòng cho mỗi job vào bảng `cron_runs`.
- Tên job: `name` của `@Cron` nếu có, không thì `Lớp.phươngThức`.
- Không bọc tập trung ở `CronLeaderService` được: `ScheduleExplorer` đã bọc handler trong try/catch nuốt lỗi và `cron` bỏ promise của callback, nên từ `SchedulerRegistry` không thấy lỗi nào, và job không đặt `name` chỉ có tên uuid. `track-cron.spec.ts` chạy `@Cron` thật trên `@nestjs/schedule` + `cron` đã cài, và quét mã nguồn: thêm `@Cron` mà thiếu `@TrackCron()` thì CI đỏ.
- Mỗi lần chạy có kết quả: `THREW` (ném lỗi), `ERRORS` (chạy xong nhưng có ít nhất một log mức error), `SKIPPED` (thoát sớm vì chạy chồng, bị khoá advisory hoặc chưa cấu hình), `OK`. `@TrackCron` chạy phương thức trong một `AsyncLocalStorage`; `CronAwareLogger` (`common/cron-run/cron-aware-logger.ts`, gắn làm logger mặc định ở `bootstrap.ts`, in y hệt ConsoleLogger) đếm `error()`/`fatal()` trong ngữ cảnh đó. Ngoài cron thì không có gì thay đổi. Vì phần lớn cron tự `try/catch` rồi chỉ `logger.error`, đây là tín hiệu chính.
- Chỗ thoát sớm gọi `markCronSkipped(lý do)` (34 chỗ: `if (this.running)`, khoá `LOCKED`, chưa cấu hình). Lý do bỏ qua: `RUNNING`, `LOCKED`, `NOT_CONFIGURED`, `BUSY` (replica khác đang giữ khoá đồng bộ Pancake; cờ `running` cục bộ kẹt thì báo `RUNNING` để phát hiện treo áp dụng). `SKIPPED` không đổi `consecutiveFailures`, `lastAlertedAt`, `lastSuccessAt`. Thêm cron mới có guard kiểu này thì phải gọi `markCronSkipped`, nếu không lần bỏ qua bị tính là `OK`.
- `consecutiveFailures` đếm các lần `THREW`/`ERRORS`. Lưu dòng đầu của lỗi (hoặc của log error đầu tiên), tối đa 300 ký tự, không stack; lỗi không phải `Error` chỉ ghi kiểu.
- Báo admin (`OPS_CRON_FAILED`, in-app) từ lần hỏng đầu tiên (`@TrackCron()` mặc định `alertAfter` 1, để job hằng ngày/tuần/quý không báo trễ một chu kỳ); job chạy mỗi 30 phút hoặc dày hơn dùng `@TrackCron({ alertAfter: 2 })` để một lần lỗi lẻ chưa báo. Danh sách `alertAfter: 2`: flash-sale `notifyStartedFlashSales` (mỗi phút), `BridgeHealthCron.everyMinute`, `GroupbuyCron.sweep`, `DealerBackorderService.reconcile`, `WastePickupSweepCron`, `PancakeEventsReconcileService`, `PancakePushReconcileService`, `PancakeSyncService.scheduledSync`, `ZalopayReconcileCron`, `GomdonReconcileService`, `ExternalClaimCron` (cả hai), `ReferralNoticeReconcileCron`, `OpsHealthService.handleCron`, `AttendanceJob.sweep`, `DeliveredEffectsResyncCron`, `PendingPaymentExpiryCron`, `ReversalEffectsResyncCron`. Tối đa một lần mỗi job mỗi 6 giờ (giành quyền báo bằng một `UPDATE` có điều kiện). Không admin nào nhận được thì nhả mốc báo để lần hỏng sau thử lại. Chạy `OK` đặt chuỗi về 0 nhưng chỉ xoá mốc báo khi lần lỗi cuối đã hơn 1 giờ (job chập chờn không báo mỗi chu kỳ).
- Chống treo: nếu lượt trước còn chạy quá `hangAfterMs` (mặc định 2 giờ, đặt theo job trong `@TrackCron({ hangAfterMs })`) mà lượt sau bị bỏ qua vì `RUNNING`, lượt sau được ghi là hỏng với dòng "Đang chạy treo từ HH:mm dd/MM/yyyy" để đường báo động chạy. Theo dõi lượt đang dở trong bộ nhớ của tiến trình (guard `this.running` cũng theo tiến trình), nên không tốn thêm ghi DB lúc bắt đầu mỗi lần chạy.
- Ghi nhận hỏng (DB) chỉ ghi log, không làm cron hỏng. Tải thêm: một upsert mỗi lần chạy (job nhanh nhất mỗi phút).
- Màn admin: `GET /admin/ops/health` trả thêm `cronJobs`; mục "Tác vụ nền (cron)" ở màn Sức khoẻ hệ thống: "OK", "Lỗi N lần ghi log", "Ném lỗi", "Bỏ qua"; có cột bắt đầu/xong của lần chạy gần nhất; "Thành công gần nhất" chỉ tính lần `OK`.

## Giới hạn cần biết

- Log error tính cho cả cron lẫn việc nó gọi trong cùng luồng bất đồng bộ; log của việc chạy nền còn sót sau khi cron trả về có thể không được tính.
- Cron chỉ `logger.warn` khi hỏng sẽ hiện `OK`. Quy ước: lỗi thật thì log mức `error`.
- Job chưa chạy lần nào (hoặc treo không bao giờ kết thúc) không có dòng trong `cron_runs`, nên chưa báo "cron im lặng quá lâu".

## Quét đêm Pancake

`PancakeSyncService.nightlyFullSync` chạy 03:37 (trước là 03:30, trùng giây với `scheduledSync` trên lưới 15 phút nên một bên luôn thua cờ `running`). Gặp lượt khác đang chạy thì nó ghi log error ("Quét đêm danh mục Pancake không chạy được...") và tính là hỏng, không phải bỏ qua, vì đây là lượt duy nhất thấy hàng bị xoá khỏi Pancake. Không tài liệu hay code nào khác phụ thuộc mốc 03:30.

Màn admin: lần chạy `SKIPPED` hiện "Bỏ qua lúc ..." thay vì cặp bắt đầu/xong (`lastStartedAt` luôn là lần chạy thật gần nhất).
