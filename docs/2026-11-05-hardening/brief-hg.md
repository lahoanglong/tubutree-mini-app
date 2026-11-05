# Gói hg — log ZNS kẹt PENDING/RETRYING khi job đã chết

- Worktree: `/Users/longla/coding/tubutree-mini-app/.claude/worktrees/hard-1105-hg`
- Nhánh: `hard/1105-hg`, gốc: tip tích hợp ghi trong prompt giao việc.
- Cổng PG: **46539**. Redis cho test (nếu cần): `docker run --rm -d --tmpfs /data -p 46549:6379 redis:7-alpine`. Container tự tạo thì tự dừng.

Trước khi làm, đọc `hard-1105-rules.md` (cùng thư mục với brief này) và làm theo. Đây là đường tin gửi khách: mọi nhánh quyết định phải có test.

## Lỗi
Log ZNS có `dedupeKey`, đang `PENDING` hoặc `RETRYING`, mà job BullMQ `zns-<logId>` đã chết hẳn thì chặn mãi tin sau cùng khoá:
- `dedupeWhere(..., 'ZNS')` (`apps/api/src/modules/notifications/notifications.service.ts`) đếm PENDING/RETRYING/SENT là "đã gửi", nên `notify()` lần sau cùng khoá không tạo log mới.
- `claimUnderDedupeLock` của log mới cùng khoá thấy log kia RETRYING, nên hoãn tới lượt cuối rồi đóng FAILED.

Các đường job chết mà không ai ghi kết cục vào log:
1. `deliverZns` ném lỗi bất ngờ (ví dụ DB lỗi) ở lượt cuối. BullMQ chuyển job sang failed. Processor không ghi log.
2. Job stalled quá `maxStalledCount`. BullMQ chuyển job sang failed ("job stalled more than allowable limit"). `process()` không chạy lượt nào nữa.
3. Job không còn trong Redis (xoá tay, mất dữ liệu, bị cắt bởi `removeOnFail` 1000 sau khi failed).

Không phải chết (không được đụng):
- Job đang `waiting`, `delayed`, `active`, `prioritized`, `waiting-children`, `paused`. Job ZNS có thể bị dời tới hết giờ yên tĩnh, tức là nằm `delayed` tới khoảng 11 giờ. Vì vậy không được xét chết chỉ theo tuổi `sentAt`.
- Job `completed` mà log còn RETRYING: thường là Zalo đã nhận tin nhưng `markZnsSent` ghi SENT lỗi rồi nuốt lỗi. Đóng FAILED ở đây sẽ mở đường gửi đôi. Không đóng FAILED.

## Sửa
1. **Bắt sự kiện job hỏng hẳn.** Processor ZNS nghe sự kiện `failed` của worker (`@OnWorkerEvent('failed')` của `@nestjs/bullmq`), chỉ cho job `zns-send`.
   - Chỉ xử lý khi job sẽ không chạy lại nữa: hết lượt (`attemptsMade >= opts.attempts`) hoặc lỗi stalled.
   - Gọi một hàm mới của `NotificationsService`. Hàm này đóng log bằng CAS: `updateMany({ where: { id, status: { in: ['PENDING', 'RETRYING'] } }, data: { status: 'FAILED', error } })`.
   - `error` là câu tiếng Việt, nêu lý do BullMQ.
   - Log FAILED đã không chặn `dedupeWhere`/`claimUnderDedupeLock`. Nếu thấy cần nhả `dedupeKey` (`releasedZnsDedupeKey`), ghi lý do trong báo cáo.
   - Handler không được ném lỗi: lỗi chỉ ghi log và `captureServerError`.
2. **Cron quét log kẹt**, cho các đường mà sự kiện không tới (API chết đúng lúc job failed, job mất khỏi Redis).
   - Đặt cạnh các cron vận hành hiện có, theo mẫu `runExclusive`. Chu kỳ 30 phút.
   - Lấy log `channel = 'ZNS'`, `status in (PENDING, RETRYING)`, `sentAt` cũ hơn 1 giờ, tối đa 200 dòng cũ nhất mỗi lượt.
   - Mỗi log: đọc job `zns-<id>` trong `QUEUE_NOTIFICATIONS`.
     - Job không còn, hoặc state `failed`: đóng FAILED bằng đúng hàm ở mục 1, với lý do riêng.
     - State `completed`: không đóng FAILED. Nếu bạn cho processor trả kết cục làm `returnvalue` của job và giá trị đó là `'SENT'`, thì ghi SENT (CAS từ RETRYING). Còn lại giữ nguyên và đếm vào số "mơ hồ".
     - State khác: job còn sống, bỏ qua.
   - Kết quả trả số `{ scanned, closed, sent, ambiguous, alive }`. Ghi một dòng log khi `closed + sent + ambiguous > 0`.
   - Không có queue (test, chạy không Redis): cron không làm gì.
   - Đọc Redis lỗi hoặc quá hạn: bỏ lượt, không đóng log nào.
3. Hai đường cùng đóng một log (sự kiện và cron, hoặc hai bản API) phải ra đúng một lần ghi. Dùng CAS ở mục 1.

## Test
- Unit processor: sự kiện `failed` ở lượt cuối thì đóng log. Ở lượt chưa cuối thì không đóng. Lỗi stalled thì đóng. Job không phải `zns-send` thì bỏ qua. Hàm đóng ném lỗi thì handler không ném ra ngoài.
- Unit cron: đủ các nhánh state (null, failed, completed có `'SENT'`, completed không có, waiting, delayed, active). Log mới hơn 1 giờ không bị quét. Đọc Redis lỗi thì không đóng gì.
- Race-spec (`apps/api/test/integration-race/`): hai lượt đóng song song cùng một log chỉ ra một lần ghi. Log đã SENT không bị đổi.
- Test hồi quy: sau khi log kẹt bị đóng, `notify()` cùng `dedupeKey` tạo được log mới và `claimUnderDedupeLock` của log mới nhận được.

## Kiểm thêm
- Mục go-live hoặc ops health có sẵn về ZNS: nếu có chỗ đếm log kẹt hợp lý, thêm số "mơ hồ". Không bắt buộc; ghi vào báo cáo nếu bỏ.
- Runbook: nếu thêm cron, ghi một dòng vào `docs/launch/deploy-rollback-runbook.md` mục 1.20 (hàng thông báo và ZNS).

## File không đụng
- `apps/miniapp`, `apps/web`: thuộc he, hf.
- `ZNS_REQUEST_TIMEOUT_MS` giữ 25 giây (chủ chốt).
