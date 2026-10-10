# PB-1 — Migration index / kiểu dữ liệu / dedupe

Nhánh `hz4/PB-1` (từ `hardening/2026-10` @ `5598f9b`). Mỗi mục ghi theo lượt làm.

## C-027 + C-052 — Index theo truy vấn thực dùng (admin đơn/dashboard, cron/inbox) — XONG

### Đã làm
- Migration `20261010042435_admin_cron_query_indexes` (chỉ thêm index, không đổi dữ liệu):
  - `CREATE EXTENSION IF NOT EXISTS pg_trgm`.
  - `orders(createdAt)`: danh sách đơn admin không lọc + đơn mới nhất của dashboard.
  - GIN trigram: `orders.code`, `orders.gomdonPartnerCode`, `users.phone`, `users.fullName` (tìm đơn admin `LIKE/ILIKE '%x%'`).
  - `notification_logs(userId, sentAt)` thay cho `(userId)` (index cũ là prefix của index mới, không truy vấn nào mất index); `notification_logs(templateCode, sentAt)`.
  - `cashback_transactions(status, confirmedAt)`, `commissions(status, lockedAt)`, `refresh_tokens(createdAt)`.
  - Tất cả khai báo trong `schema.prisma` (GIN dùng `ops: raw("gin_trgm_ops")`) để `prisma migrate dev` không coi là drift rồi sinh DROP. `prisma migrate diff --from-migrations --to-schema-datamodel` ra "No difference detected."
- Tìm đơn admin (`admin.service.ts` `findSearchUserIds` + `admin-order-filter.ts`): Prisma dựng lọc theo quan hệ `user` thành `LEFT JOIN users` hai lần, kèm OR xuyên hai bảng, nên Postgres phải quét toàn bảng orders. Giờ khi chuỗi tìm dài từ 3 ký tự, API tra trước id khách khớp SĐT/tên (dùng index trigram trên users), rồi lọc `code ILIKE OR gomdonPartnerCode ILIKE OR userId IN (...)`, nên cả 3 nhánh đều dùng index (BitmapOr). Kết quả tìm vẫn giữ như trước:
  - Chuỗi tìm < 3 ký tự (trigram không dùng được) → giữ nguyên lọc theo quan hệ như cũ.
  - Khớp > 1000 khách (tìm quá chung) → giữ lọc theo quan hệ, không cắt bớt kết quả.
  - Không khách nào khớp → chỉ còn nhánh mã đơn / mã Gomdon.

### Test (đỏ → xanh)
- `src/modules/admin/admin.service.spec.ts` thêm 4 test cho `listOrders` search. Trước khi sửa: 2 test đỏ (tra trước khách, không khách khớp). Sau khi sửa: cả nhóm admin xanh.
- `test/integration-race/admin-order-search.race-spec.ts` (Postgres thật):
  - (1) đủ 10 index với đúng định nghĩa: trước migration đỏ ("orders_createdAt_idx: (không có)" ... 10 dòng), sau migration xanh.
  - (2), (3) tìm theo mã đơn / mã Gomdon (chữ thường) / SĐT đủ và một phần / tên khách viết hoa có dấu (`NGUYỄN THỊ x`) / chuỗi ngắn: xanh cả trước lẫn sau khi sửa, tức là kết quả tìm giữ nguyên.

```
$ npx jest --maxWorkers=1 src/modules/admin
Test Suites: 5 passed, 5 total
Tests:       158 passed, 158 total
$ DATABASE_URL=postgresql://tubu:tubu@localhost:5551/tubutree_it?schema=public npx jest -c test/integration-race/jest.config.js --runInBand admin-order-search
Tests:       3 passed, 3 total
$ npx tsc --noEmit -p tsconfig.json   -> exit 0
$ npx eslint <5 file admin + race spec>   -> sạch
```

### EXPLAIN (ANALYZE) trước/sau — dữ liệu `tubutree_perf` (200k đơn, 50k user, 500k notification_logs, 300k refresh_tokens)
"Trước" chạy trên `tubutree_perf` (chỉ đọc). "Sau" chạy trên bản sao `tubutree_pb1_copy` đã `migrate deploy`. Số đo lấy ở lần chạy ấm (lần 2–3). Máy đang chạy song song nhiều agent nên số ms dao động, nhưng thay đổi kiểu plan là ổn định.

| Truy vấn | Trước | Sau |
|---|---|---|
| E1 danh sách đơn admin không lọc, trang 1 (#85) | 109 ms, Parallel Seq Scan | 0,40 ms, Index Scan Backward `orders_createdAt_idx` |
| E1c cùng truy vấn, OFFSET 1000 | 147 ms, Seq Scan | 2,9 ms, Index Scan Backward |
| E2 6 đơn mới nhất của dashboard + join users (#97) | 145 ms, Seq Scan orders + users | 2,2 ms, Index Scan Backward + users_pkey |
| E4 `code ILIKE '%2026100%'` (C8) | 74 ms, Parallel Seq Scan | 0,79 ms, Bitmap `orders_code_trgm_idx` |
| E5 tìm đơn admin "0912", câu Prisma cũ (findMany) | 402 ms, Seq Scan orders + 2× users | — (câu cũ chạy trên DB có index vẫn 268–337 ms: index không cứu được JOIN + OR) |
| S0+S1 tìm "0912", cách mới (tra khách + findMany) | — | 0,40 + 2,9 ms, BitmapOr (code_trgm, partner_trgm, userId_status) |
| S2 đếm tổng của tìm "0912", cách mới | 347 ms (câu cũ) | 0,63 ms |
| Tìm SĐT đủ `0900012345`, cách mới | 309 ms (câu cũ) | 3,1 + 7,1 ms |
| Tìm tên `Perf 1234`, cách mới | 215 ms (câu cũ) | 2,9 + 0,9 ms |
| Tìm mã đơn `PERF00012345`, cách mới | 206 ms (câu cũ) | 0,8 + 14,9 ms |
| N1 inbox (userId + INAPP ORDER BY sentAt DESC) | 0,27 ms (userId_idx) | 0,20 ms (`userId_sentAt_idx`) |
| N2 game-reminder (templateCode + sentAt ≥ 3 ngày) | 48 ms, Parallel Seq Scan | 0,17 ms, Index Scan `templateCode_sentAt_idx` |
| N2b cùng câu, mẫu có 100k dòng | 57 ms, Seq Scan | 1,9 ms, Bitmap |
| N3 loyalty-expiry dedupe | 0,19 ms | 0,15 ms, Index Scan `userId_sentAt_idx` |
| R1b DAU viết dạng khoảng `createdAt` | 30 ms, Seq Scan | 3,3 ms, Bitmap `refresh_tokens_createdAt_idx` |
| R1 DAU câu hiện tại (bọc `createdAt` trong biểu thức) | 86 ms | 88 ms (không dùng được index, xem "việc còn lại") |
| E3 dashboard `SUM(total)` theo 4 trạng thái (#100) | 40 ms, Seq Scan | 35 ms, Seq Scan (không đổi, xem "việc còn lại") |
| E1b `COUNT(*)` toàn bảng orders | 33 ms | 24 ms (Index Only Scan, giới hạn của COUNT không lọc) |

`commissions` và `cashback_transactions` trong `tubutree_perf` rỗng nên phải đo trên DB riêng `tubutree_it` (pb1): nạp tạm 200k commission (10% LOCKED) và 100k cashback (10% CONFIRMED). "Trước" đo bằng `BEGIN; DROP INDEX ...; EXPLAIN ...; ROLLBACK`. Đo xong đã xoá dữ liệu nạp tạm.

| Cron | Trước | Sau |
|---|---|---|
| K1 `approveDueCommissions` (LOCKED, lockedAt ≤ mốc) | 17 ms, quét cả index `affiliateUserId_status` (20k mục) | 10,9 ms, Bitmap `commissions_status_lockedAt_idx` (đọc đúng 9.999 mục) |
| K2 settle cashback (CONFIRMED, confirmedAt ≤ mốc) | 10,1 ms, quét cả index `userId_status` | 7,6 ms, Bitmap `status_confirmedAt_idx` |

### Migration — áp thử
- DB trống (`pb1_empty` trong `tubu_it_pb1`, postgres:16-alpine): `prisma migrate deploy` áp đủ 108 migration, đủ 10 index, `pg_trgm 1.6`. Đã DROP sau khi thử.
- Bản sao dữ liệu: `CREATE DATABASE tubutree_pb1_copy` rồi `pg_dump tubutree_perf | psql`, mất 57 s cho 1033 MB. Chạy `migrate deploy` áp 5 migration còn thiếu: tổng 8,9 s; riêng migration này mất **3.752 ms** (`finished_at - started_at`). Kích thước index: `notification_logs_*` 19–20 MB mỗi cái, `refresh_tokens_createdAt` 6,6 MB, `orders_code_trgm` 5,8 MB, `orders_createdAt` 4,4 MB, trigram trên users 1,2–1,6 MB. Đã `DROP DATABASE tubutree_pb1_copy`. Không ghi gì vào `tubutree_perf`.
- Extension: `CREATE EXTENSION pg_trgm` chạy được bằng role **không phải superuser** nếu role đó là chủ DB (đã thử với role `pb1_owner`, `rolsuper = f`, vì pg_trgm là extension "trusted" từ PG13). **Yêu cầu cho PROD:** Postgres ≥ 13 và có gói contrib (image `postgres` chính thức có sẵn; Debian/Ubuntu là `postgresql-contrib`). Trước khi deploy, chạy `SELECT name FROM pg_available_extensions WHERE name = 'pg_trgm'` trên PROD. Nếu không có dòng nào, migration sẽ lỗi và cả transaction rollback (không để lại index dở).

### Rủi ro khoá bảng (CREATE INDEX thường)
Prisma chạy mỗi migration trong một transaction nên không dùng được `CREATE INDEX CONCURRENTLY`. `CREATE INDEX` giữ khoá SHARE: ai đọc vẫn đọc được, nhưng ghi vào `orders`/`users`/`notification_logs`/`refresh_tokens`/`commissions`/`cashback_transactions` phải chờ tới khi commit. Trên bản sao (200k đơn, 500k notification_logs, 300k refresh_tokens), cả migration mất ~3,8 s, tức là đặt đơn / đăng nhập (ghi refresh_tokens) bị treo tối đa chừng ấy. PROD hiện nhỏ hơn nhiều, nhưng vẫn nên deploy vào giờ thấp điểm. Nếu sau này bảng lớn hơn vài triệu dòng: tạo trước bằng `CREATE INDEX CONCURRENTLY IF NOT EXISTS ...` ngoài Prisma, sửa migration sang `IF NOT EXISTS`, rồi mới `migrate deploy`.

### Giả định
- Bỏ `notification_logs_userId_idx` (không phải thuần additive) vì `(userId, sentAt)` phủ mọi truy vấn chỉ lọc `userId`. Không mất dữ liệu, chỉ bớt chi phí ghi cho bảng 500k dòng.
- Ngưỡng 1000 khách khớp và độ dài tối thiểu 3 ký tự cho đường tra trước là phương án an toàn: vượt ngưỡng thì quay về cách lọc cũ (đúng nhưng chậm) chứ không cắt bớt kết quả.
- Không đổi hình dạng response của `GET /admin/orders` (vẫn `include items`), để web admin không phải sửa.

### Việc còn lại (ngoài nhóm file PB-1 hoặc ngoài phạm vi lượt này)
- **analytics (PB-4):** câu DAU `analytics-aggregation.service.ts:84-87` bọc `createdAt` trong biểu thức, nên index mới không dùng được (86 ms). Cần viết lại thành `"createdAt" >= $start AND "createdAt" < $end` (mốc giờ VN đổi sang UTC); khi đó R1b đo được 3,3 ms.
- **refresh_tokens(expiresAt)** cho cron dọn token (C-046) thuộc PB-4. Lượt này không thêm, để tránh tạo trùng index với gói đó.
- **coupons** (`ownerUserId` + index, A7-09) thuộc C-012/PB-2.
- Dashboard: `SUM(total)` toàn bảng (35–40 ms) và `COUNT(*)` không lọc (24–33 ms) tăng tuyến tính theo số đơn. Nên cache ngắn (30–60 s) hoặc dùng bảng tổng hợp, chưa làm vì thay đổi độ tươi của số liệu.
- `GET /admin/orders` vẫn trả `items` của 20 đơn (~34 KB). Nếu chuyển sang `select` hẹp thì phải sửa cùng web admin.
- **KHÔNG BAO GIỜ dùng `prisma db push` cho DB thật:** nó bỏ qua lịch sử migration và xoá các index/constraint không khai báo được trong schema (partial unique index, C-109). Mọi thay đổi schema phải đi bằng `prisma migrate deploy`.
