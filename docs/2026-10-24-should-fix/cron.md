# Cron lỗi phải nhìn thấy được

## Thiết kế

- Mỗi `@Cron` có thêm `@TrackCron()` ngay bên dưới (`apps/api/src/common/cron-run/track-cron.ts`). Decorator bọc phương thức, đo thời gian, và báo kết quả cho `CronRunService` (`apps/api/src/modules/ops/cron-run.service.ts`), nơi upsert một dòng cho mỗi job vào bảng `cron_runs`.
- Tên job: `name` của `@Cron` nếu có, không thì `Lớp.phươngThức`.
- Không bọc tập trung ở `CronLeaderService` được: `ScheduleExplorer` đã bọc handler trong try/catch nuốt lỗi và `cron` bỏ promise của callback, nên từ `SchedulerRegistry` không thấy lỗi nào, và job không đặt `name` chỉ có tên uuid. `track-cron.spec.ts` chạy `@Cron` thật trên `@nestjs/schedule` + `cron` đã cài, và quét mã nguồn: thêm `@Cron` mà thiếu `@TrackCron()` thì CI đỏ.
- Mỗi lần chạy có kết quả: `THREW` (ném lỗi), `ERRORS` (chạy xong nhưng có ít nhất một log mức error), `SKIPPED` (thoát sớm vì chạy chồng, bị khoá advisory hoặc chưa cấu hình), `OK`. `@TrackCron` chạy phương thức trong một `AsyncLocalStorage`; `CronAwareLogger` (`common/cron-run/cron-aware-logger.ts`, gắn làm logger mặc định ở `bootstrap.ts`, in y hệt ConsoleLogger) đếm `error()`/`fatal()` trong ngữ cảnh đó. Ngoài cron thì không có gì thay đổi. Vì phần lớn cron tự `try/catch` rồi chỉ `logger.error`, đây là tín hiệu chính.
- Chỗ thoát sớm gọi `markCronSkipped(lý do)` (30 chỗ: `if (this.running)`, khoá `LOCKED`, chưa cấu hình). `SKIPPED` không đổi `consecutiveFailures`, `lastAlertedAt`, `lastSuccessAt`. Thêm cron mới có guard kiểu này thì phải gọi `markCronSkipped`, nếu không lần bỏ qua bị tính là `OK`.
- `consecutiveFailures` đếm các lần `THREW`/`ERRORS`. Lưu dòng đầu của lỗi (hoặc của log error đầu tiên), tối đa 300 ký tự, không stack; lỗi không phải `Error` chỉ ghi kiểu.
- Báo admin (`OPS_CRON_FAILED`, in-app) từ lần hỏng liên tiếp thứ 2, tối đa một lần mỗi job mỗi 6 giờ (giành quyền báo bằng một `UPDATE` có điều kiện). Không admin nào nhận được thì nhả mốc báo để lần hỏng sau thử lại. Chạy `OK` đặt chuỗi về 0 nhưng chỉ xoá mốc báo khi lần lỗi cuối đã hơn 1 giờ (job chập chờn không báo mỗi chu kỳ).
- Ghi nhận hỏng (DB) chỉ ghi log, không làm cron hỏng. Tải thêm: một upsert mỗi lần chạy (job nhanh nhất mỗi phút).
- Màn admin: `GET /admin/ops/health` trả thêm `cronJobs`; mục "Tác vụ nền (cron)" ở màn Sức khoẻ hệ thống: "OK", "Lỗi N lần ghi log", "Ném lỗi", "Bỏ qua"; "Thành công gần nhất" chỉ tính lần `OK`.

## Giới hạn cần biết

- Log error tính cho cả cron lẫn việc nó gọi trong cùng luồng bất đồng bộ; log của việc chạy nền còn sót sau khi cron trả về có thể không được tính.
- Cron chỉ `logger.warn` khi hỏng sẽ hiện `OK`. Quy ước: lỗi thật thì log mức `error`.
- Job chưa chạy lần nào (hoặc treo không bao giờ kết thúc) không có dòng trong `cron_runs`, nên chưa báo "cron im lặng quá lâu".
