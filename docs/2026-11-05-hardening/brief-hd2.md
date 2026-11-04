# Gói hd2 — runtime (hộp việc, timeout, hàng đợi, breaker)

- Worktree: `/Users/longla/coding/tubutree-mini-app/.claude/worktrees/hard-1105-hd2`
- Nhánh: `hard/1105-hd2`, gốc: tip tích hợp ghi trong prompt giao việc (đã gồm đợt 1 ha/hb/hc và gói k).
- Cổng PG: **46535**

Trước khi làm, đọc `hard-1105-rules.md` (cùng thư mục với brief này) và làm theo.
Các mục L3 trong `audit-1105-findings.md` đã viết gọn: tìm chỗ bằng tên hàm. Code thật đã khác mô tả thì không sửa, ghi bằng chứng vào báo cáo.

## Mục
### L3-04 — `GET /admin/ops/inbox`
Khoảng 35 count song song, không cache. Nhiều tab admin mở thì pool cạn, checkout dính P2028.
- Cache kết quả 20 s. Khoá cache phải gồm phạm vi người xem: ADMIN thấy mọi hộp, staff chỉ thấy hộp theo quyền (`audience`). Hai người khác quyền không được dùng chung kết quả.
- Giới hạn song song 4 (p-limit hoặc tương đương đã có trong repo; không thêm thư viện mới nếu repo đã có cách).
- Partial index `payouts` theo trạng thái chờ duyệt.
- `countStoresToSettle`: cache 60 s riêng, vì gọi `statementFor` tuần tự cho từng gian hàng.
- TTL đọc từ env (mặc định 20 s / 60 s). Test e2e/Playwright đọc số hộp việc ngay sau thao tác thì phải vẫn xanh: grep `apps/e2e` trước. Cần thì đặt TTL 0 cho môi trường test qua env, không sửa `playwright.config*` (file dùng chung): báo lại nếu buộc phải sửa.
- Test: unit cùng phạm vi gọi 2 lần chỉ đếm 1 lần; phạm vi khác đếm riêng; hết TTL đếm lại.

### L3-05 — timeout Postgres
Chủ chọn: đưa options vào `DATABASE_URL`, 4f áp khi deploy.
- Code: `maxWait` 5000 cho `$transaction` mặc định (PrismaService `transactionOptions`). Giữ các chỗ đã tự đặt `maxWait`/`timeout` riêng.
- Runbook `docs/launch/deploy-rollback-runbook.md`: thêm mục hướng dẫn 4f gắn vào `DATABASE_URL`:
  - `statement_timeout=30s`
  - `lock_timeout=10s`
  - `idle_in_transaction_session_timeout=30s`
  - Ghi dạng URL-encoded đúng (`options=-c%20statement_timeout%3D30s%20...`) và câu kiểm sau deploy (`SHOW statement_timeout;` qua app role).
- **Migration:** `apps/api/Dockerfile` chạy `prisma migrate deploy && node dist/main.js` bằng cùng `DATABASE_URL`. Index/backfill dài sẽ bị cắt 30 s. Chọn một và ghi rõ trong runbook:
  - bước migrate riêng (runbook mục 5) dùng URL không có options;
  - hoặc migration nặng tự `SET LOCAL statement_timeout` cao hơn.
  - Không sửa Dockerfile hay docker-compose: đó là của 4f. Nếu phải đổi thì ghi đề xuất vào báo cáo.
- Liệt kê job/truy vấn có thể chạy > 30 s (xuất CSV, recompute, backfill cron, go-live collect, demo-data cleanup). Mỗi chỗ: thêm `SET LOCAL statement_timeout` cao hơn trong tx, hoặc giải thích vì sao không cần.
- Test: unit `transactionOptions`; race chạy với `DATABASE_URL` có options trên DB 46535 và vẫn xanh (ghi số).

### L3-06 — hàng notifications
- Tách `INAPP_RETRY_JOB` sang hàng riêng.
- Concurrency hàng ZNS 5, kèm limiter theo hạn mức Zalo (ghi số và nguồn).
- ZNS HTTP timeout 10 s.
- Gửi song song không được gửi đôi: kiểm `dedupeKey` / trạng thái log trước khi gửi. `markZnsSent` vừa được gói hc sửa (retry ghi SENT rồi nuốt lỗi): giữ nguyên hành vi đó.
- **Rollback:** job `inapp-retry` cũ còn trong hàng cũ lúc deploy phải có người xử lý. Hoặc giữ processor cũ đọc cả hai hàng một thời gian, hoặc ghi bước xả trong runbook.
- Test: unit processor; race 2 job cùng `dedupeKey` song song chỉ gửi 1 lần.

### L3-07 — Redis sập
- Mỗi notify/enqueue đang chờ đủ 2 s khi Redis sập. Thêm breaker: lỗi liên tiếp thì mở 30 s, trong lúc mở thì đi đường dự phòng sẵn có (ghi log, không chờ).
- Cron nhắc giờ vàng chạy chồng: bọc `runExclusive` (mẫu có sẵn trong repo), xét hạn theo từng dòng thay vì sau mỗi trang 500.
- Test: unit breaker mở/đóng; cron chạy hai lượt chồng chỉ một lượt làm việc.

### L3-12 — `flashUpcoming`
Thêm `take` và giới hạn thời gian phía trước (ghi số chọn). Kiểm màn Mini App/web hiện flash sắp tới vẫn đủ dữ liệu.

### L3-21 — `streamCsv`
Đã chuyển sang gói ha (vòng 2, m6: `res.end()` trước, nghe `close`, dừng đọc lô sau). Chỉ kiểm lại trên tip tích hợp; còn thiếu thì báo, không sửa trùng.

## File không đụng
- Index/truy vấn của hd1 (coupons history, users count, notification_logs, points_transactions, feed, reviews, templates, recomputeSoldCounts, external claims).
- Ảnh/sản phẩm đối tác/review admin/payroll/brands: hd3.
- `Dockerfile`, `docker-compose*`: của 4f.
