\timing off
\echo '=== C1 retention daily (CUSTOMER_KEY window) ==='
EXPLAIN (ANALYZE, BUFFERS)
WITH v AS (
  SELECT COALESCE(CASE WHEN o."placedForCustomer" THEN o."endCustomerKey" END, NULLIF(regexp_replace(COALESCE(u.phone, ''), '\D', '', 'g'), ''), o."userId") AS customer_key,
         ((o."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS d,
         ROW_NUMBER() OVER (PARTITION BY COALESCE(CASE WHEN o."placedForCustomer" THEN o."endCustomerKey" END, NULLIF(regexp_replace(COALESCE(u.phone, ''), '\D', '', 'g'), ''), o."userId") ORDER BY o."createdAt", o.id) AS n
  FROM orders o JOIN users u ON u.id = o."userId"
  WHERE o.type = 'RETAIL' AND o.status NOT IN ('CANCELLED', 'RETURNED'))
SELECT COUNT(*) FILTER (WHERE d = '2026-10-08'::date AND n = 1), COUNT(DISTINCT customer_key) FILTER (WHERE d = '2026-10-08'::date), COUNT(*) FILTER (WHERE d = '2026-10-08'::date) FROM v;
\echo '=== C2 welcomeVouchers scan users 24h ==='
EXPLAIN (ANALYZE, BUFFERS) SELECT id FROM users u WHERE u."createdAt" >= now() - interval '24 hours' AND u.role='CUSTOMER' AND NOT EXISTS (SELECT 1 FROM orders o WHERE o."userId"=u.id) ORDER BY u.id LIMIT 200;
\echo '=== C3 expirePoints candidates ==='
EXPLAIN (ANALYZE, BUFFERS) SELECT DISTINCT "userId" FROM points_transactions WHERE delta > 0 AND "expiresAt" <= now() ORDER BY "userId" LIMIT 500;
\echo '=== C4 cart abandon ==='
EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM carts c WHERE c."updatedAt" <= now() - interval '6 hours' AND c."updatedAt" >= now() - interval '72 hours' AND EXISTS (SELECT 1 FROM cart_items ci WHERE ci."cartId"=c.id) LIMIT 200;
\echo '=== C5 recalcAllTiers page ==='
EXPLAIN (ANALYZE, BUFFERS) SELECT id FROM users WHERE "tierId" IS NOT NULL ORDER BY id LIMIT 500;
\echo '=== C6 analytics funnel-ish: events by name + day ==='
EXPLAIN (ANALYZE, BUFFERS) SELECT "eventName", count(*) FROM analytics_events WHERE "occurredAt" >= now() - interval '7 days' GROUP BY 1;
\echo '=== C7 cohort repeat 30/60/90 (customer first order -> later orders) ==='
EXPLAIN (ANALYZE, BUFFERS)
WITH first_o AS (SELECT "userId", min("createdAt") f FROM orders WHERE status NOT IN ('CANCELLED','RETURNED') GROUP BY 1)
SELECT date_trunc('month', f) m, count(*) cohort, count(*) FILTER (WHERE EXISTS (SELECT 1 FROM orders o2 WHERE o2."userId"=first_o."userId" AND o2."createdAt" > f AND o2."createdAt" <= f + interval '90 days' AND o2.status NOT IN ('CANCELLED','RETURNED'))) repeat90
FROM first_o GROUP BY 1;
\echo '=== C8 flash/admin orders search by code/phone (buildAdminOrderWhere) ==='
EXPLAIN (ANALYZE, BUFFERS) SELECT id FROM orders WHERE code ILIKE '%2026100%' ORDER BY "createdAt" DESC LIMIT 20;
\echo '=== C9 orders by user createdAt (list orders) whale ==='
EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM orders WHERE "userId"='perf_u_1' ORDER BY "createdAt" DESC LIMIT 10;
\echo '=== C10 notifications user ==='
EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM notification_logs WHERE "userId"='perf_u_10004' AND channel='INAPP' ORDER BY "sentAt" DESC LIMIT 50;
\echo '=== C11 refresh_token cleanup (expired) ==='
EXPLAIN (ANALYZE, BUFFERS) SELECT count(*) FROM refresh_tokens WHERE "expiresAt" < now();
