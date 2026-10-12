-- Dọn dữ liệu do các lần chạy loadtest tạo ra trong tubutree_perf (id không bắt đầu bằng perf_), trả tồn kho/flash về cũ.
BEGIN;
-- trả tồn kho cho các đơn test (stock += qty, reservedStock -= qty)
UPDATE variations v SET stock = v.stock + s.q, "reservedStock" = GREATEST(0, v."reservedStock" - s.q)
FROM (SELECT oi."variationId" vid, SUM(oi.quantity)::int q FROM order_items oi JOIN orders o ON o.id=oi."orderId" WHERE o.id NOT LIKE 'perf\_%' GROUP BY 1) s
WHERE v.id = s.vid;
UPDATE flash_sale_items f SET "soldCount" = GREATEST(0, f."soldCount" - s.q)
FROM (SELECT oi."flashSaleItemId" fid, SUM(oi.quantity)::int q FROM order_items oi JOIN orders o ON o.id=oi."orderId" WHERE o.id NOT LIKE 'perf\_%' AND oi."flashSaleItemId" IS NOT NULL GROUP BY 1) s
WHERE f.id = s.fid;
DELETE FROM flash_sale_purchases WHERE id NOT LIKE 'perf\_%';
DELETE FROM order_status_history WHERE "orderId" IN (SELECT id FROM orders WHERE id NOT LIKE 'perf\_%');
DELETE FROM order_items WHERE "orderId" IN (SELECT id FROM orders WHERE id NOT LIKE 'perf\_%');
DELETE FROM orders WHERE id NOT LIKE 'perf\_%';
DELETE FROM cart_items WHERE id NOT LIKE 'perf\_%';
DELETE FROM carts WHERE id NOT LIKE 'perf\_%';
DELETE FROM analytics_events WHERE id NOT LIKE 'perf\_%';
DELETE FROM notification_logs WHERE id NOT LIKE 'perf\_%';
DELETE FROM refresh_tokens WHERE id NOT LIKE 'perf\_%';
DELETE FROM users WHERE id NOT LIKE 'perf\_%' AND "zaloId" LIKE 'guest\_perf-%';
COMMIT;
select (select count(*) from orders) o, (select count(*) from users) u, (select count(*) from carts) c, (select count(*) from analytics_events) a, (select "soldCount" from flash_sale_items where id='perf_fsi_1') sold, (select stock||'/'||"reservedStock" from variations where id='perf_v_1_1') v11;
