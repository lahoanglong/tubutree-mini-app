# PB-4 — Vòng đời dữ liệu + analytics

## Mục 1/2: C-046 (job dọn log theo lô) — XONG

Module mới `apps/api/src/modules/data-retention/` (`DataRetentionService`, đăng ký trong `app.module.ts`).

- `@Cron('0 30 4 * * *', { timeZone: 'Asia/Ho_Chi_Minh' })`: sau cron retention 03:00 (cron này đọc `refresh_tokens` của hôm qua để tính DAU), trước giờ cao điểm.
- Khoá chống chạy chồng: cờ `running` trong instance + `pg_try_advisory_xact_lock(hashtext('cron:data-retention.cleanup'))` giữ bằng một transaction suốt lượt (cùng mẫu `PendingPaymentExpiryCron`); các lô DELETE chạy trên kết nối khác.
- Mỗi bảng: `DELETE ... WHERE id IN (SELECT id ... WHERE <quá hạn> LIMIT 5000)`, nghỉ 200 ms giữa các lô, dừng sớm sau 90 phút (phần còn lại để đêm sau). Một bảng lỗi không chặn bảng khác; `handleCron` không ném lỗi.
- TTL qua SystemConfig (seed `createOnly`, category `retention`): `retention.analytics_events_days` 395, `retention.notification_logs_days` 180, `retention.webhook_events_days` 90, `retention.refresh_tokens_days` 30. Có sàn (90/30/14/7 ngày) để gõ nhầm 0 không xoá sạch bảng; giá trị không phải số → mặc định.
- Bảng dọn: `analytics_events`, `notification_logs`, `pancake_webhook_events`, `gomdon_webhook_events`, `oa_inbound_messages`, `refresh_tokens` (thu hồi hoặc hết hạn quá 30 ngày).

### Test (xem báo cáo lượt cuối)
- Unit `src/modules/data-retention/data-retention.service.spec.ts` (12 test).
- Race spec Postgres thật `test/integration-race/data-retention.race-spec.ts` (3 test): xoá nhiều lô, giữ dòng còn hạn, chạy lại không xoá thêm, TTL từ SystemConfig + sàn, 2 instance đồng thời → 1 bên LOCKED. Đã làm đỏ thử bằng cách bỏ điều kiện snapshot: test 1 fail, trả lại thì xanh.

### Giả định / ghi chú
- Snapshot trước khi xoá analytics: chưa có job nào ghi `funnel_daily_snapshot`/`cohort_repeat_snapshot` từ `analytics_events` (và không có chỗ nào đọc sự kiện thô). Snapshot duy nhất do cron ghi là `retention_daily_snapshot`, nên `analytics_events` chỉ bị xoá khi NGÀY (giờ VN, theo `receivedAt`) đó đã có dòng `retention_daily_snapshot`; ngày thiếu snapshot thì giữ lại. Mốc là `receivedAt` vì `occurredAt` do client khai. Tổng hợp theo sự kiện (funnel/cohort) vẫn là việc chưa làm của dự án analytics; nếu cần giữ số đó thì phải có job trước khi dữ liệu thô tròn 13 tháng.
- "Webhook events Pancake/OA/ZaloPay": ZaloPay không có bảng log webhook (chỉ có `payment_attempts`, là chứng từ thanh toán nên giữ); đã dọn thêm `gomdon_webhook_events` cùng nhóm.
- Không migration: không thêm index (DELETE có LIMIT không ORDER BY dừng quét khi đủ dòng; lô cuối quét một lượt/bảng/đêm). `schema.prisma` không đụng để khỏi xung đột với PB-1.
- Dọn refresh token an toàn với DAU: DAU tính từ `refresh_tokens.createdAt` của đúng hôm qua lúc 03:00, token bị xoá đã quá 30 ngày.
