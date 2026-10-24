# Cron lỗi phải nhìn thấy được

## Thiết kế

- Mỗi `@Cron` có thêm `@TrackCron()` ngay bên dưới (`apps/api/src/common/cron-run/track-cron.ts`). Decorator bọc phương thức, đo thời gian, và báo kết quả cho `CronRunService` (`apps/api/src/modules/ops/cron-run.service.ts`), nơi upsert một dòng cho mỗi job vào bảng `cron_runs`.
- Tên job: `name` của `@Cron` nếu có, không thì `Lớp.phươngThức`.
- Không bọc tập trung ở `CronLeaderService` được: `ScheduleExplorer` đã bọc handler trong try/catch nuốt lỗi và `cron` bỏ promise của callback, nên từ `SchedulerRegistry` không thấy lỗi nào, và job không đặt `name` chỉ có tên uuid. `track-cron.spec.ts` chạy `@Cron` thật trên `@nestjs/schedule` + `cron` đã cài, và quét mã nguồn: thêm `@Cron` mà thiếu `@TrackCron()` thì CI đỏ.
- Lỗi: ghi `Tên lớp lỗi: dòng đầu thông điệp` (tối đa 300 ký tự, không stack; lỗi không phải `Error` chỉ ghi kiểu), tăng `consecutiveFailures`, báo admin bằng template in-app `OPS_CRON_FAILED`. Tối đa một báo mỗi job mỗi 6 giờ khi còn lỗi (giành quyền báo bằng một `UPDATE ... WHERE lastAlertedAt IS NULL OR < now-6h`); chạy thành công thì về 0 và xoá mốc báo.
- Ghi nhận hỏng (DB) chỉ ghi log, không làm cron hỏng. Tải thêm: một upsert mỗi lần chạy (job nhanh nhất mỗi phút).
- Màn admin: `GET /admin/ops/health` trả thêm `cronJobs`; mục "Tác vụ nền (cron)" ở màn Sức khoẻ hệ thống (job lỗi lên đầu).

## Giới hạn cần biết

`@TrackCron()` chỉ thấy lỗi mà phương thức NÉM RA. Nhiều cron tự `try/catch` rồi chỉ log (ví dụ `OpsHealthService.handleCron`, các bước trong `BridgeHealthCron`, các cron "đã bọc" ở dealer/loyalty/groupbuy/cashback/flash-sale): với chúng cột "thành công" vẫn nhảy dù bên trong lỗi. Muốn thấy các lỗi đó, mỗi cron phải để lỗi nổi lên (hoặc báo riêng); việc này chưa làm vì đổi hành vi từng cron.

Job chưa chạy lần nào (hoặc cron bị treo không bao giờ kết thúc) không có dòng trong `cron_runs`, nên chưa báo "cron im lặng quá lâu".
