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

## Mục 2/2: C-030 (POST /events) và C-101 (cron retention) — XONG

### C-030: POST /events không còn nhận tên sự kiện tuỳ ý
- Hằng số dùng chung `packages/shared-types/src/analytics.ts`: `CLIENT_EVENT_NAMES` (12 tên miniapp đang phát: app_opened, screen_viewed, client_error, product_viewed, checkout_started, notification_opened, reorder_clicked, reorder_completed, reorder_reminder_cta, search_performed, search_result_clicked, filter_applied) và `SERVER_EVENT_NAMES` (10 tên do server ghi: add_to_cart, coupon_applied, engagement_action, notification_sent, order_paid, order_place_failed, order_placed, order_status_changed, referral_touched, subscription_changed). Danh sách lấy bằng grep mọi `trackEvent(` ở miniapp và mọi `eventName:` ở api.
- `EventEnvelopeDto.eventName` là `@IsIn(CLIENT_EVENT_NAMES)`: client gửi order_paid/order_placed/... hoặc tên lạ thì cả lô bị 400 (chọn 400 thay vì bỏ qua im lặng, theo tiêu chí nghiệm thu của lộ trình). Sự kiện server-side vẫn ghi qua `AnalyticsEventsService.record*` như cũ, không đi qua DTO.
- Giới hạn: tối đa 50 sự kiện/lô (đã có), `props` tối đa 30 khoá và 4096 byte JSON (validator tuỳ biến `IsBoundedProps`), chuỗi định danh có `MaxLength`. `main.ts` thêm parser JSON riêng 256kb cho `/api/events` đặt trước parser 10mb (kiểm bằng express thật: body 400KB tới /api/events trả 413, tới route khác trả 200).
- Throttle: bỏ `getTracker` theo `x-device-id` trong controller; chỉ còn `@Throttle({ default: { ttl: 60000, limit: 120 } })`, khoá đếm do `AppThrottlerGuard` toàn cục quyết định (`u:<userId>` khi có JWT, `ip:` khi chưa). Test khẳng định metadata THROTTLER:TRACKER của handler là undefined.
- Miniapp: `trackEvent` đổi kiểu tham số `eventName` thành `ClientEventName` (type-only import) để thêm tên mới mà quên whitelist thì lỗi lúc biên dịch.
- Test (đỏ trước: 16 fail, rồi xanh): `analytics.controller.spec.ts` thêm 19 test (từng tên server-side bị chặn, tên lạ, lô lẫn, props 4KB/30 khoá, chuỗi dài, lô 51 sự kiện, throttle).
- Commit: 4cd389d.

### C-101: cron retention không còn quét toàn bộ orders
- `analytics-aggregation.service.ts` viết lại `computeRetentionSnapshot`, KẾT QUẢ GIỮ NGUYÊN định nghĩa cũ (khách = endCustomerKey đơn lên hộ > SĐT chuẩn hoá > userId; đơn RETAIL chưa huỷ/trả; ngày VN):
  - Đơn của ngày và luỹ kế tháng đọc theo khoảng `createdAt` (VN -> UTC, không bọc cột trong hàm) qua index `orders_status_createdAt_idx`; danh sách trạng thái lấy từ enum `OrderStatus` trừ CANCELLED/RETURNED để dùng được index đó.
  - "Khách mới": bỏ `ROW_NUMBER() OVER (PARTITION BY ...)` trên mọi đơn; thay bằng tra các khoá khách CỦA NGÀY trong lịch sử: đơn lên hộ theo `endCustomerKey`; SĐT qua các tài khoản cùng SĐT chuẩn hoá rồi tra `orders` theo danh sách userId (index `orders_userId_status_idx`); khách không SĐT theo userId.
  - DAU proxy đổi sang khoảng `createdAt` (sargable).
- Không migration, không đụng schema.prisma.
- Test: race spec Postgres thật `test/integration-race/retention-snapshot.race-spec.ts` (3 test) viết TRƯỚC khi refactor và xanh trên code cũ (khoá ngữ nghĩa: SĐT khác định dạng gộp một khách, đơn trước đã huỷ không tính, đơn lên hộ nhiều CTV cùng người nhận, ranh giới 00:00/23:59:59 VN, luỹ kế tháng, loại DEALER); xanh lại trên code mới. Unit test mock viết lại (5 test) kiểm tra: phân loại khách mới theo từng loại khoá, bỏ qua truy vấn tra cứu khi không có khoá loại đó, không còn window function/bọc cột createdAt, tham số trạng thái.
- Đối chiếu trên DB lớn `tubutree_perf` (tubu_pg:5434, 200k đơn, chỉ SELECT; upsert snapshot được stub): so cũ/mới 6 ngày (2025-05-02 .. 2026-10-09) -> cả 6 ngày KẾT QUẢ BẰNG NHAU (newBuyers, activeBuyers, ordersCount, ordersPerBuyerMtd, dau).
- Đo (máy đang tải bởi gói khác nên số tuyệt đối dao động; lấy EXPLAIN ANALYZE lúc ổn định):
  - Truy vấn ngày: trước 452 ms (Seq Scan orders 158k dòng, sort ngoài đĩa 7,3 MB) -> sau 44 ms (Bitmap Index Scan `orders_status_createdAt_idx`, 1.578 dòng).
  - Luỹ kế tháng: trước 99 ms (Parallel Seq Scan orders) -> sau 73 ms (index, 8.457 dòng của tháng; tăng theo kích thước tháng chứ không theo tổng đơn).
  - Tra khách cũ theo userId: 26 ms (Bitmap Index Scan `orders_userId_status_idx`); bản đầu tra qua EXISTS bị planner chọn Seq Scan orders 68 ms nên đã tách thành 2 bước.
  - DAU: 77 ms -> 24 ms.
  - Toàn job (đo từ jest, 7 lần, cả round trip): cũ 960-1610 ms, mới 150-620 ms; cùng kết quả.

### Giả định / còn lại
- Còn một phần tuyến tính theo kích thước BẢNG (không theo orders): quét `users` có regexp SĐT (~27 ms ở 50k user) để gộp tài khoản cùng SĐT khác định dạng; và nhánh đơn lên hộ quét `orders` có lọc `placedForCustomer` (chỉ chạy khi ngày đó có đơn lên hộ; perf DB không có đơn lên hộ nên chưa đo). Muốn xoá hẳn cần index hàm trên SĐT chuẩn hoá hoặc partial index `orders(endCustomerKey) WHERE placedForCustomer` hoặc lưu `customerKey`/`firstOrderAt` trên bảng; để dự án analytics sau, vì đụng schema.prisma và bảng orders (PB-1 đang sửa song song).
- `refresh_tokens` không có index createdAt: DAU vẫn Seq Scan nhưng bảng đã bị C-046 giới hạn ~30 ngày sau hết hạn.
- Sự kiện lạ từ client bị 400 cả lô. Chấp nhận vì miniapp chỉ phát tên trong danh sách và gửi best-effort; nếu một bản miniapp cũ phát tên ngoài danh sách thì lô đó mất (không ảnh hưởng nghiệp vụ).
- Cohort 30/60/90 và funnel (nhắc trong TODO của service) chưa có job; không thuộc C-101.
