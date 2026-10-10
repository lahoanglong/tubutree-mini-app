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
