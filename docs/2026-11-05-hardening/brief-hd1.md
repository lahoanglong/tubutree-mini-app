# Gói hd1 — index và truy vấn

- Worktree: `/Users/longla/coding/tubutree-mini-app/.claude/worktrees/hard-1105-hd1`
- Nhánh: `hard/1105-hd1`, gốc: tip tích hợp ghi trong prompt giao việc (đã gồm đợt 1 ha/hb/hc và gói k).
- Cổng PG: **46534**

Trước khi làm, đọc `hard-1105-rules.md` (cùng thư mục với brief này) và làm theo.

## Cách tìm chỗ sửa
Các mục L3 trong `audit-1105-findings.md` đã viết gọn, nhiều mục không còn `path:line`. Tìm theo tên hàm/route bằng grep.
Nếu code thật đã khác mô tả (đã sửa, hoặc không phải vấn đề) thì không sửa. Ghi bằng chứng (đoạn code, EXPLAIN) vào báo cáo.

## Luật riêng cho index
- Index thường: thêm `@@index` vào `schema.prisma` và migration tương ứng.
- Index từng phần (`WHERE ...`): SQL thô trong migration, không có trong schema. Tiền lệ: `20261020120000_q19_reversal_effects_marker` (`orders_reversal_effects_pending_idx`), drift vẫn 0.
- `CREATE INDEX CONCURRENTLY`: theo đúng dạng của tiền lệ `20261018000100_n1_indexes`. Không dùng CONCURRENTLY thì xét tiêu chí HEAVY_MIGRATIONS + runbook §1.0 như luật chung.
- Mỗi index: dán `EXPLAIN (ANALYZE, BUFFERS)` trước và sau, trên DB race đã sinh dữ liệu (`generate_series`, bảng chính ≥ 50k dòng). Kỳ vọng: truy vấn đích dùng index mới, không còn Seq Scan trên bảng lớn.

## Mục
### L3-08 — `GET /me/coupons/history`
Seq Scan `coupons`: lọc `scopeMeta` bằng path (`#>`), cộng OR + EXISTS.
- Tách thành các truy vấn riêng, mỗi nhánh dùng được index. Gộp, sắp xếp, phân trang trong code.
- Hợp đồng response (trường, thứ tự, phân trang) giữ nguyên.
- Test: unit so kết quả với cách cũ trên cùng bộ dữ liệu (gồm phân trang trang 2); EXPLAIN.

### Thêm từ review gói hc — voucher mốc
`vouchers.service.ts` (`milestoneReceived`, ~445) lọc `code startsWith 'MILESTONE'` + `scopeMeta #>> '{reason}' LIKE '%-yyyy-mm'`. Cron chạy mỗi ngày, quét 4 kỳ.
- EXPLAIN trên DB race có ≥ 50k coupons. Seq Scan thì thêm index biểu thức `(("scopeMeta"->>'reason'))` (hoặc dạng khớp đúng truy vấn sau khi viết lại để dùng được index). Kiểm collation của cột `code` trước khi dựa vào index tiền tố.

### L3-09 — đếm toàn bảng users
`listUsers` và dashboard admin đếm toàn bảng `users` mỗi lượt.
- Cache count 60 s theo khoá bộ lọc; partial index cho điều kiện guest.
- `listUsers` vừa được gói ha sửa (L1-06, STAFF phải tìm). Chỉ đổi phần count, không đụng logic lọc/quyền.
- Test: hai lượt gọi liên tiếp chỉ đếm một lần; bộ lọc khác thì đếm riêng.

### L3-10, L3-11, L3-14 — index
- L3-10: `notification_logs` cho truy vấn in-app (kênh INAPP).
- L3-11: `points_transactions (userId, createdAt, id)`.
- L3-14: truy vấn feed.
- Với mỗi mục: tìm truy vấn thật trước, chọn cột index theo đúng WHERE + ORDER BY.

### L3-13 — reviews công khai
Thêm index cho truy vấn danh sách review công khai và `@PublicCache` cho route công khai (theo mẫu route công khai khác đang dùng decorator này).
- Kiểm: review vừa duyệt hiện ra chậm tối đa bằng TTL cache. Ghi TTL trong báo cáo.

### L3-15 — coupon dùng `usedCount`
Chỗ đang `count()` số lượt dùng mà bảng đã có `usedCount`: dùng cột.
- Trước khi đổi, chứng minh `usedCount` luôn được tăng/giảm ở mọi đường dùng/hoàn mã (liệt kê chỗ ghi). Có đường nào không cập nhật thì không đổi, báo lại.

### L3-16 — template `distinct`
Prisma `distinct` (lọc trong Node) đổi thành `DISTINCT ON` trong SQL.
- Test: kết quả giống hệt trước.

### L3-18 — phân trang offset sâu
DTO phân trang offset: `page ≤ 1000`, vượt thì 400 câu tiếng Việt. Tìm DTO dùng chung trước; không có thì sửa từng DTO có `page`.

### L3-19 — `recomputeSoldCounts`
Chỉ update dòng có số thay đổi, chia lô (≤ 500 dòng/lô).
- Test race: chạy song song với một đơn DELIVERED mới → số cuối đúng.

### L3-20 — external claims
Danh sách external claims chỉ select cột màn hình cần.

## File không đụng
- `ops-inbox.service.ts`, hàng/processor notifications, Redis enqueue, `streamCsv`, `flashUpcoming`: thuộc hd2.
- Truy vấn ảnh/sản phẩm đối tác, review admin, payroll/brands: thuộc hd3.
- Logic lọc/quyền trong `listUsers`: thuộc ha (đã gộp).
