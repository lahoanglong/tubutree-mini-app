-- PD-3: đo TRƯỚC khi deploy, chạy trên BẢN SAO PROD (chỉ SELECT, không ghi). Nguồn: docs/2026-10-review/impl/PD-3-SPEC.md mục 3.3.
-- Cách chạy: psql "$COPY_DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/api/prisma/manual/pd3_measure_before_deploy.sql
-- Ghi kết quả vào Bảng 3 của docs/2026-10-review/impl/PD-3.md (ô "Kết quả trên bản sao PROD").
-- Chặn deploy nếu: (b) negative_users hoặc coin_drift_users <> 0, (c) points_drift_users <> 0,
-- (f) rate_value có mà khác 1000. Migration B tự RAISE ở các trường hợp (b) và (f).

\echo '--- (a) Chi phí làm tròn lên và tổng giá trị quy đổi (rounding_cost_vnd = tiền Tubu "tặng thêm" do làm tròn lên)'
SELECT count(*)                                                        AS users_with_xu,
       COALESCE(sum("coinsBalance"), 0)                                AS total_xu,
       COALESCE(sum(("coinsBalance"::bigint + 999) / 1000), 0)         AS total_points,
       COALESCE(sum(("coinsBalance"::bigint + 999) / 1000) * 1000 - sum("coinsBalance"), 0) AS rounding_cost_vnd,
       COALESCE(max(("coinsBalance"::bigint + 999) / 1000), 0)         AS max_points_one_user
  FROM "users" WHERE "coinsBalance" > 0;

\echo '--- (b) Điều kiện chặn của migration B (cả hai phải = 0)'
SELECT count(*) AS negative_users FROM "users" WHERE "coinsBalance" < 0;
SELECT count(*) AS coin_drift_users FROM "users" u
 WHERE u."coinsBalance" <> COALESCE((SELECT sum(delta) FROM "coin_transactions" c WHERE c."userId" = u."id"), 0);

\echo '--- (c) Bất biến Điểm Xanh hiện tại (phải = 0 trước khi đổi nghĩa thành "lô STANDARD")'
SELECT count(*) AS points_drift_users FROM "users" u
 WHERE u."pointsBalance" <> COALESCE((SELECT sum(delta) FROM "points_transactions" p WHERE p."userId" = u."id"), 0);

\echo '--- (d) Đơn XU còn huỷ/trả được sau gộp (hoàn bằng Điểm Xanh lô quy đổi, làm tròn lên từng đơn)'
SELECT status, "paymentStatus", count(*) AS orders, sum(total) AS total_xu,
       sum((total + 999) / 1000) AS refund_points_if_all_reversed,
       sum(((total + 999) / 1000) * 1000 - total) AS rounding_cost_vnd
  FROM "orders" WHERE "paymentMethod" = 'XU' AND status NOT IN ('CANCELLED', 'RETURNED')
 GROUP BY 1, 2;

\echo '--- (e) Thưởng giới thiệu bằng xu còn có thể bị thu hồi (đơn trong cửa sổ trả hàng 30 ngày)'
SELECT count(*) AS rows, COALESCE(sum(delta), 0) AS total_xu FROM "coin_transactions"
 WHERE "refType" = 'REFERRAL' AND "reason" LIKE 'REFERRAL_ORDER2:%' AND "createdAt" > now() - interval '30 days';

\echo '--- (f) Tỉ giá điểm: không có dòng (dùng mặc định 1000) hoặc value = 1000; khác thì migration B dừng'
SELECT (SELECT count(*) FROM "system_configs" WHERE "key" = 'loyalty.vnd_per_point_redeem') AS rate_rows,
       (SELECT "value" FROM "system_configs" WHERE "key" = 'loyalty.vnd_per_point_redeem')  AS rate_value;
