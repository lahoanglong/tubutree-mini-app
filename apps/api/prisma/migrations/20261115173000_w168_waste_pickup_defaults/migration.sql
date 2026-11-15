-- Hạ ngưỡng thu kèm đơn 10.000 -> 3.000 điểm và khoá thu kèm sau 2 lần thiếu liền nhau (mặc định mới của code).
-- Chỉ đổi hàng còn đúng giá trị mặc định cũ do migration gieo; giá trị admin đã chỉnh giữ nguyên.
UPDATE "system_configs" SET "value" = '3000'::jsonb, "updatedAt" = NOW()
WHERE "key" = 'waste.pickup_min_points' AND "value" = '10000'::jsonb;

UPDATE "system_configs" SET "value" = '2'::jsonb, "updatedAt" = NOW()
WHERE "key" = 'waste.shortfall_lock_streak' AND "value" = '3'::jsonb;
