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

## C-038 — Tìm không dấu có index, suggest giới hạn độ dài — XONG

### Đã làm
- Migration `20261010053812_catalog_name_search_index` (additive):
  - Cột `products."nameSearch" TEXT NOT NULL DEFAULT ''` (khai báo trong `schema.prisma`, không drift: `prisma migrate diff --from-migrations --to-schema-datamodel` ra "No difference detected.").
  - Hàm `vn_search_fold(text)` (SQL, IMMUTABLE): `btrim(regexp_replace(lower(translate(t, FROM, TO)), WS_RE, ' ', 'g'))`, chép nguyên văn hằng `VN_FOLD_FROM/VN_FOLD_TO/SQL_WHITESPACE_RE` của `search-text.ts` (8 dấu kết hợp NFD viết bằng escape trong chuỗi `E''`).
  - Backfill `UPDATE products SET "nameSearch" = vn_search_fold(name)`.
  - Trigger `products_name_search_sync` BEFORE INSERT OR UPDATE OF name, "nameSearch": cột luôn là hàm của `name`, kể cả khi sync Pancake / SQL tay ghi thẳng. Prisma không diff trigger/hàm nên `migrate dev` không sinh DROP.
  - `CREATE INDEX "products_nameSearch_trgm_idx" USING GIN ("nameSearch" gin_trgm_ops)` (cần pg_trgm, đã tạo ở migration C-027).
- `catalog.service.ts`: câu SQL tách thành `textMatchSql(raw)` (export để race test EXPLAIN đúng câu thật). So `p."nameSearch" LIKE '%<từ khoá gấp ở TS>%' ESCAPE '!'` thay vì gấp dấu từng dòng; tag đổi `= ANY(p.tags)` sang `p.tags @> ARRAY[tag]` (cùng nghĩa) để BitmapOr với `products_tags_gin`. Vẫn lùi về `contains` khi SQL lỗi (vd DB chưa migrate).
- `GET /search/suggest`: DTO `SuggestQuery` (`@IsString @MaxLength(100)`, q lặp thành mảng cũng bị 400); service trả `[]` không chạm DB khi từ khoá sau gấp dấu < 2 ký tự (khớp `SUGGEST_MIN_CHARS = 2` của ô tìm miniapp). `GET /products?q=` cũng `@MaxLength(100)`.

### Test (đỏ → xanh)
- `test/integration-race/catalog-search-index.race-spec.ts` (Postgres thật, 6 test): hàm DB gấp giống hệt `foldVietnamese` (cả bảng ký tự, NFD, mọi khoảng trắng JS); trigger khi tạo / đổi tên qua Prisma / SQL tay ghi đè `nameSearch`; backfill không lệch; plan của `textMatchSql` là BitmapOr `products_nameSearch_trgm_idx` + `products_tags_gin` (DB test chỉ ~100 SP nên tắt seqscan và tạm DROP 2 index trạng thái trong transaction rồi ROLLBACK, test kiểm lại 2 index vẫn còn); tìm qua service không lùi về contains; suggest < 2 ký tự không gọi DB. Trước khi sửa: 5 đỏ / 1 xanh.
- `src/modules/catalog/dto/suggest-query.dto.spec.ts` (3 test): trước khi sửa đỏ (chưa có DTO).
- `catalog.service.spec.ts`: cập nhật theo câu SQL mới (`Prisma.Sql`), thêm test suggest < 2 ký tự.
- `buy-flow-4b.race-spec.ts` (tiếng Việt / HOA / NFD / NBSP / escape `% _ ! \`, tag, suggest, bộ lọc) chạy lại trên đường mới: xanh, không test nào phải sửa.

```
$ npx jest --maxWorkers=1 src/modules/catalog
Test Suites: 5 passed, 5 total
Tests:       86 passed, 86 total
$ DATABASE_URL=postgresql://tubu:tubu@localhost:5551/tubutree_it?schema=public npx jest -c test/integration-race/jest.config.js --runInBand catalog-search-index buy-flow-4b
PASS test/integration-race/catalog-search-index.race-spec.ts
PASS test/integration-race/buy-flow-4b.race-spec.ts
Tests:       19 passed, 19 total
$ npx tsc --noEmit -p tsconfig.json   -> exit 0
$ npx eslint <7 file catalog + race spec>   -> sạch
```

### EXPLAIN (ANALYZE) trước/sau — 3044 SP
"Trước": câu cũ trên `tubutree_perf` (chỉ đọc). "Sau": câu mới trên bản sao `tubutree_pb1_copy` đã `migrate deploy` + ANALYZE. Mỗi câu 3 lần.

| Từ khoá | Trước (Seq Scan + translate/regexp_replace mỗi dòng) | Sau (BitmapOr trigram + tags GIN) |
|---|---|---|
| `hat giong rau` (300 khớp) | 82,2 / 62,9 / 63,6 ms | 4,3 / 2,9 / 2,5 ms |
| `binh tuoi nuoc 2247` (1 khớp) | 61,3 / 63,0 / 65,9 ms | 0,94 / 0,99 / 1,17 ms |
| `zzz khong co` (0 khớp) | 67,6 / 67,6 / 85,2 ms | 0,59 / 0,57 / 0,61 ms |

### Migration — áp thử
- DB trống: `prisma migrate diff --from-migrations` dựng lại toàn bộ 109 migration trên shadow DB trống (`pb1_shadow` trong `tubu_it_pb1`) thành công, sau đó DROP.
- `tubutree_it` (pb1): `migrate deploy` OK; race test xác nhận backfill khớp.
- Bản sao dữ liệu: `pg_dump tubutree_perf | psql tubutree_pb1_copy` (75 s), `migrate deploy` áp 6 migration còn thiếu tổng 12 s; riêng migration này **342 ms** (backfill 3044 dòng + index 296 kB); `nameSearch` lệch `vn_search_fold(name)` = 0 dòng. Đã `DROP DATABASE tubutree_pb1_copy`. Không ghi gì vào `tubutree_perf`.
- Khoá bảng: UPDATE backfill + CREATE INDEX giữ khoá ghi trên `products` trong lúc migration chạy (~0,3 s với 3k SP). Bảng nhỏ, chấp nhận được.

### Giả định
- Suggest < 2 ký tự (sau gấp dấu) trả `[]` thay vì 400, để ô gợi ý không báo lỗi. Ô chọn SP của cộng đồng / CTV lên-đơn-hộ (miniapp gọi từ 1 ký tự) giờ ra rỗng ở ký tự đầu, có kết quả từ ký tự thứ 2.
- Max 100 ký tự cho cả `/products?q=`: vượt thì 400 (tên SP thực tế ngắn hơn nhiều).
- Từ khoá 1–2 ký tự ở `/products?q=` không dùng được trigram, nên Postgres có thể quét bảng `products`. Vẫn đúng kết quả, và bảng chỉ vài nghìn dòng.

### Việc còn lại
- Ai đổi bảng ký tự trong `search-text.ts` phải thêm migration `CREATE OR REPLACE FUNCTION vn_search_fold` và backfill lại. Nếu quên, `catalog-search-index.race-spec.ts` sẽ đỏ.
- Miniapp `product-picker.tsx` / `ctv-order-sheet.tsx` vẫn gọi suggest từ 1 ký tự (ngoài nhóm file PB-1). Có thể nâng lên 2 cho đồng bộ.

## C-045 — Webhook Pancake: dedupe, claim nguyên tử, cron cứu sự kiện kẹt — XONG

### Đã làm
- Migration `20261010070000_pancake_webhook_dedupe` (additive): cột `dedupeKey TEXT NULL` + unique, `claimedAt TIMESTAMP(3) NULL`, index `(status, receivedAt)` cho cron. Không backfill: dòng cũ để `dedupeKey` NULL (Postgres cho nhiều NULL trong unique) nên unique không thể vỡ trên dữ liệu PROD có sẵn, kể cả khi đã có sự kiện trùng. SQL khớp đúng `prisma migrate diff` (không drift).
- `pancake-webhook-dedupe.ts`: `pancakeDedupeKey(eventType, body)` = `eventType|sha256(JSON chuẩn hoá thứ tự key)`; hằng trạng thái `RECEIVED|PROCESSING|PROCESSED|FAILED`.
- `PancakeWebhookController`: INSERT kèm `dedupeKey`, không đọc trước. P2002 thì: sự kiện cũ đã PROCESSED trả `{received:true, duplicate:true}` và không enqueue; chưa xong thì enqueue lại đúng event cũ. Enqueue lỗi (Redis chập) thì vẫn trả 200 vì sự kiện đã lưu RECEIVED, cron sẽ cứu. Trước đây trả 500 và Pancake gửi lại, tạo thêm một dòng mới.
- `PancakeProcessor.process`: claim bằng `updateMany` → PROCESSING (+`attempts`, +`claimedAt`). Chỉ claim được khi status khác PROCESSED/PROCESSING, hoặc PROCESSING quá 15 phút (worker đã chết). `count = 0` thì bỏ qua: một sự kiện chỉ chạy handler một lần dù tới từ BullMQ retry/stalled, cron, hay Pancake gửi lại. `attempts` tăng lúc claim, nên worker chết giữa chừng vẫn bị tính lượt.
- `PancakeEventsReconcileService` (mới, `@Cron('45 */10 * * * *')`): quét RECEIVED/FAILED đã quá 5 phút, cộng PROCESSING có claim quá hạn. Giới hạn: `attempts < 15`, nhận trong 24 giờ, bỏ `variation.stock_changed`, mỗi lô 100, cũ trước. Enqueue lại bằng `addGomdonJob` (xoá job completed/failed cùng jobId rồi add, vì BullMQ giữ hash job cũ nên add trơn là no-op). Chống chạy chồng: cờ `running` trong process + `pg_try_advisory_xact_lock(hashtext('pancake.events-reconcile'))`, nên nhiều instance cùng lịch thì chỉ một instance quét. Toàn thân bọc try/catch.

### Test (đỏ → xanh)
- `test/integration-race/pancake-webhook-dedupe.race-spec.ts` (Postgres thật, 6 test). Trước khi sửa: đỏ (chưa có cột/module, suite không biên dịch được).
  - (a) cùng payload gửi đồng thời 5 lần: 5 INSERT, chỉ 1 dòng, mọi enqueue cùng jobId.
  - (b) đảo thứ tự key vẫn trùng khoá; đổi status là sự kiện riêng.
  - (c) gửi lại sự kiện đã PROCESSED thì không enqueue.
  - (d) 5 worker cùng `process()` một sự kiện: handler chạy đúng 1 lần, attempts = 1.
  - (e) lỗi chuyển sang FAILED, lần sau claim lại được (attempts = 2); PROCESSING mới claim thì worker khác không chạy.
  - (f) cron chỉ enqueue 3 sự kiện đủ điều kiện, bỏ 5 sự kiện còn lại (mới nhận, hết lượt, quá 24 giờ, đang PROCESSING, tồn kho). 2 instance chạy đồng thời thì 1 instance trả `LOCKED`.
- `pancake-webhook.controller.spec.ts` (+3 test: P2002 với PROCESSED/FAILED, enqueue lỗi vẫn 200). `pancake.processor.spec.ts` (+1 test: claim thua thì không chạy handler; mock thêm `updateMany`).
- `pancake-paid-status.race-spec.ts` và `cod-return-refund.race-spec.ts` vẫn xanh. Spec cũ tạo event status `PENDING`, nên claim nhận mọi status khác PROCESSED/PROCESSING.

```
$ DATABASE_URL=postgresql://tubu:tubu@localhost:5551/tubutree_it?schema=public npx jest -c test/integration-race/jest.config.js --runInBand pancake-webhook-dedupe pancake-paid-status cod-return-refund
      [a] fulfilled=5 rejected=0 inserts=5 rows=1 errors=[]
      [d] handleCalls=1 status=PROCESSED attempts=1 errors=[]
      [f] r1={"enqueued":3} r2={"skipped":"LOCKED"} enqueued=3
Test Suites: 3 passed, 3 total
Tests:       13 passed, 13 total
$ npx jest --maxWorkers=1 src/modules/integrations/pancake
Test Suites: 8 passed, 8 total
Tests:       102 passed, 102 total
$ npx tsc --noEmit -p tsconfig.json   -> exit 0
$ npx eslint src/modules/integrations/pancake/ test/integration-race/pancake-webhook-dedupe.race-spec.ts   -> sạch
```

### Migration — áp thử
- DB trống (`pb1_empty` trong `tubu_it_pb1`): `migrate deploy` áp đủ 110 migration, có đủ 3 index `pancake_webhook_events_{pkey,dedupeKey_key,status_receivedAt_idx}`. Đã DROP sau khi thử.
- `tubutree_it` (pb1): `migrate deploy` OK.
- Bản sao dữ liệu: `tubutree_perf` có 0 dòng `pancake_webhook_events`. Sau khi `pg_dump | psql` sang `tubutree_pb1_copy` (22 s), mình chèn thêm **200.000 sự kiện giả** vào bản sao, trong đó chỉ có 50.000 payload khác nhau (cố ý trùng, 10% FAILED). `migrate deploy` áp 7 migration còn thiếu trong 4,7 s; riêng migration này **229 ms**. Unique không vỡ: 200.000 dòng giữ `dedupeKey` NULL. Kích thước index: `dedupeKey_key` 4,4 MB, `status_receivedAt` 7,8 MB. Câu quét của cron trên 200k dòng: Bitmap Index Scan `pancake_webhook_events_status_receivedAt_idx`, **4,5 ms**. Đã `DROP DATABASE tubutree_pb1_copy`. Không ghi gì vào `tubutree_perf`.
- Khoá bảng: ALTER ADD COLUMN nullable không ghi lại bảng. CREATE INDEX thì chặn webhook ghi vào `pancake_webhook_events` khoảng 0,2 s ở cỡ 200k dòng. Chấp nhận được.

### Giả định
- Khoá dedupe băm TOÀN BỘ payload chứ không dùng (id đơn, updated_at): Pancake không công bố id sự kiện. Nếu gộp nhầm hai lần sửa đơn khác nhau thì mất hẳn một cập nhật tiền/trạng thái, nên chỉ gộp lần gửi lại y hệt. Nếu Pancake chèn field thay đổi theo từng lần gửi (vd giờ gửi), lần gửi lại sẽ thành dòng mới. Khi đó vẫn an toàn tiền vì handler idempotent (setStatus có guard, lật PAID dùng `updateMany` có guard, hoá đơn có guard ISSUED).
- Cron không cứu sự kiện quá 24 giờ, và không bao giờ cứu `variation.stock_changed`: áp số tồn kho cũ muộn có thể hồi sinh hàng đã bán, còn `PancakeSyncService` vẫn đồng bộ tồn kho mỗi 15 phút. Sự kiện hết 15 lượt hoặc quá 24 giờ nằm lại ở FAILED/RECEIVED, có cột `error`, để vận hành xử lý tay.
- Claim PROCESSING quá hạn = 15 phút. Handler thường xong trong vài giây.
- Dùng lại `addGomdonJob` (gomdon-queue.ts, chỉ import, không sửa) vì nó đúng là helper "xoá job đã xong rồi add" cần ở đây.

### Việc còn lại
- Chưa có màn admin xem/đẩy tay sự kiện Pancake FAILED đã hết lượt. Hiện chỉ có log `warn` của cron và dữ liệu trong bảng.
- Dòng cũ trước migration không có `dedupeKey`. Chỉ sự kiện nhận sau deploy mới được dedupe.
