# PB-2 - /me/coupons (C-012)

## Mục 1/2 (C-012, yêu cầu 1): lọc coupon của user trong SQL - XONG

- `LoyaltyService.getAvailableCoupons` (apps/api/src/modules/loyalty/loyalty.service.ts): thay `coupon.findMany` toàn bảng + lọc JS bằng một truy vấn `UNION ALL` lấy id (nhánh PUBLIC/TIER theo hạng của user; nhánh USER_GROUP theo `scopeMeta->>'userId'`), rồi `findMany({ id in })`. `isCouponEligible` và lọc `perUserLimit` giữ nguyên làm chốt chặn cuối nên list/apply vẫn dùng chung nguồn sự thật. API không đổi (không phân trang trước đó, response cùng trường).
- Thứ tự: trước không có ORDER BY (thứ tự heap), nay `ORDER BY id ASC` (cuid xấp xỉ thứ tự tạo) để ổn định.
- Migration `20261010040000_coupon_scope_partial_indexes` (additive, IF NOT EXISTS): `coupons_user_group_userId_idx` (biểu thức `scopeMeta->>'userId'` WHERE scope='USER_GROUP') và `coupons_scope_shared_endAt_idx` (`endAt` WHERE scope IN ('PUBLIC','TIER')). Không cần kiểm trùng vì không có unique. Index nằm ngoài schema.prisma (Prisma không biểu diễn partial/expression index).
- EXPLAIN (ANALYZE) trên Postgres tubu_it_pb2 với 100k coupon cá nhân tổng hợp (rollback): Index Scan + Bitmap Index Scan trên hai index mới, Execution Time 0.134 ms.
- Test: `apps/api/test/integration-race/my-coupons-query.race-spec.ts` (Postgres thật) so cũ-mới trên dữ liệu mẫu: user có hạng/không hạng/hạng khác, coupon hết hạn, chưa bắt đầu, perUserLimit=0, đã dùng, scopeMeta thiếu/null/số, TIER thiếu meta, BIRTHDAY/INVITE. Spec là kiểm tương đương (thuật toán cũ cũng xanh), không có bước đỏ; bằng chứng "đỏ" về hiệu năng nằm ở phần đo trước/sau (yêu cầu 3, lượt sau).
- Unit: `loyalty.service.spec.ts` cập nhật mock `$queryRaw`, thêm ca không có ứng viên.

### Giả định
- Số đo trên tubutree_perf (yêu cầu 3) và job dọn (yêu cầu 2) do lượt khác làm.

## Mục 2/2 (C-012, yêu cầu 2 + 3): job dọn coupon cá nhân hết hạn + đo trước/sau - XONG

### Job dọn (yêu cầu 2)
- `apps/api/src/modules/coupons/coupon-cleanup.cron.ts` (`CouponCleanupCron`, đăng ký trong `CouponsModule`): `@Cron('0 30 4 * * *', { timeZone: 'Asia/Ho_Chi_Minh' })`, xoá theo lô `DELETE ... WHERE id IN (SELECT ... LIMIT n FOR UPDATE SKIP LOCKED)`, mặc định lô 1000, tối đa 50 lô mỗi lượt (lượt sau xoá tiếp phần còn lại).
- Chống chạy chồng 2 tầng: cờ `running` trong instance + `pg_try_advisory_xact_lock(hashtext('cron:coupons.cleanup_personal_expired'))` (nhiều instance). Lỗi được bắt trong `handleCron`.
- Chỉ xoá coupon cá nhân = `scope='USER_GROUP'` và `scopeMeta->>'userId'` không null, `endAt < now - N ngày`, `usedCount = 0` và không có `CouponRedemption` (giữ lịch sử dùng; FK redemption cũng chặn xoá). N = config `coupons.personal_expired_retention_days`, mặc định 90, sàn 30 (giá trị rác/NaN rơi về 90).
- Test đỏ -> xanh: `apps/api/test/integration-race/coupon-cleanup.race-spec.ts` (Postgres thật, 5 ca: phạm vi xoá/giữ, ngưỡng cấu hình, config rác/sàn, giới hạn lô, khoá advisory do kết nối khác giữ). Bước đỏ = module chưa tồn tại ("Cannot find module coupon-cleanup.cron"), sau khi cài đặt 5/5 xanh. Unit `coupon-cleanup.cron.spec.ts` 5 ca (timezone, lô, LOCKED, RUNNING, lỗi DB).
- Không cần migration thêm: EXPLAIN (ANALYZE) một lô xoá 1000 trên tubutree_perf (105k coupon, 30k giả lập hết hạn, ROLLBACK) = 83.8 ms (seq scan coupons + hash anti join redemptions); tối đa 50 lô ~ vài giây mỗi đêm nên không thêm index cho job.

### Đo trước/sau (yêu cầu 3), DB tubutree_perf (105k coupon, 35.0k còn hạn), API riêng cổng 3302, Redis db 6, key tích hợp trống
Kịch bản `scripts/loadtest/coupons-me.cjs` (mới; 8 VU x 40 request = 320 request, user perf_u_10000..10049, X-Forwarded-For riêng mỗi request), `scripts/loadtest/start-api-3302.sh`.
- TRƯỚC (dist của repo chính = thuật toán cũ, chưa có index): tuần tự 20 req p50 1070.5 ms, p95 1291.8 ms; 8 song song p50 2791 ms, **p95 3908 ms**, p99 4157 ms, max 4522 ms, 2.8 rps, 0 lỗi. EXPLAIN truy vấn cũ: Seq Scan coupons, 35019 dòng trả về, 14.8 ms ở DB (phần còn lại là Prisma dựng 35k object + lọc JS).
- SAU (build worktree nhánh hz4/PB-2 + áp migration 20261010040000 lên perf DB): tuần tự p50 9.1-13.9 ms, p95 11.4-16.5 ms; 8 song song (2 lần chạy) p50 14.7/17.1 ms, **p95 20.7/31.0 ms**, p99 41.6/35.8 ms, max 61.0 ms, 509.6/429.0 rps, 0 lỗi. Đạt mục tiêu p95 < 50 ms (giảm ~190 lần ở p95 song song).
- EXPLAIN (ANALYZE) truy vấn mới: Append của Index Scan `coupons_scope_shared_endAt_idx` + Bitmap Index Scan `coupons_user_group_userId_idx`, 0.694 ms.
- Đã tắt instance 3302 sau đo (port không còn listen). Perf DB giờ có 2 index của migration (cố ý, để giữ trạng thái "sau"); không có dữ liệu coupon nào bị đổi (phần mô phỏng hết hạn nằm trong transaction ROLLBACK).

### Giả định / lưu ý
- Số "trước" dùng dist đã build sẵn của repo chính (thuật toán cũ trong getAvailableCoupons, cùng code cho đường /me/coupons); phần còn lại của dist có thể lệch nhẹ so với 5598f9b nhưng không nằm trên đường chạy endpoint này.
- Coupon cá nhân sinh theo reason tất định (WELCOME/BIRTHDAY-kỳ/WINBACK-ngày) có thể được cấp lại về lý thuyết nếu cron cấp chạy lại cho đúng kỳ cũ sau khi bị xoá; các cron đó chỉ xét kỳ hiện tại nên chấp nhận. Nhóm mua chung cấp lại chỉ khi `couponsGrantedAt` null và trong cửa sổ ngắn, xa hơn 90 ngày sau hết hạn.
- Chỉ dọn USER_GROUP có userId; BIRTHDAY/INVITE/PUBLIC/TIER không đụng.
