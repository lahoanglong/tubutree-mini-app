-- Dữ liệu tham chiếu của Đổi rác lấy quà: quà hiện vật tặng kèm đơn kế tiếp, mở nhận pin, gắn mặt hàng vào kho.
-- Chạy lại không đổi gì: quà dùng ON CONFLICT DO NOTHING (không ghi đè chữ/giá/tồn admin đã sửa), pin chỉ bật khi còn "Sắp nhận",
-- gắn mặt hàng bỏ qua cặp đã có. Không tạo điểm nhận nào: kho chưa có thì phần gắn mặt hàng không làm gì.
-- BEGIN WASTE W168 SEED
INSERT INTO "waste_gifts" ("id", "kind", "name", "description", "label", "pointsCost", "status", "sortOrder", "stock", "voucherType", "voucherValue", "voucherMinOrder", "voucherMaxDiscount", "voucherValidDays", "updatedAt") VALUES
  ('gift-seed-pack', 'SEED_PACK', 'Gói hạt giống rau mầm Xanh', 'Gói hạt giống dễ gieo tại nhà.', NULL, 5000, 'ACTIVE', 60, 200, NULL, NULL, NULL, NULL, NULL, NOW()),
  ('gift-loofah-pad', 'GIFT', 'Miếng xơ mướp rửa chén tự nhiên', 'Xơ mướp hữu cơ, phân huỷ sinh học.', NULL, 12000, 'ACTIVE', 70, 100, NULL, NULL, NULL, NULL, NULL, NOW()),
  ('gift-canvas-bag', 'GIFT', 'Túi vải Canvas Tubu Sống Xanh', 'Túi vải bố dày dặn, dùng lại nhiều lần.', NULL, 35000, 'ACTIVE', 80, 50, NULL, NULL, NULL, NULL, NULL, NOW())
ON CONFLICT ("id") DO NOTHING;

UPDATE "waste_items" SET "status" = 'ACTIVE', "updatedAt" = NOW() WHERE "code" = 'BATTERY' AND "status" = 'COMING_SOON';

INSERT INTO "waste_point_items" ("pointId", "itemId")
SELECT p."id", i."id"
FROM "waste_points" p
CROSS JOIN "waste_items" i
WHERE p."kind" = 'WAREHOUSE' AND p."status" = 'ACTIVE'
  AND i."code" IN ('CARTON', 'BUBBLE_WRAP', 'MILK_CARTON', 'TUBU_BOTTLE', 'BATTERY') AND i."status" = 'ACTIVE'
ON CONFLICT ("pointId", "itemId") DO NOTHING;
-- END WASTE W168 SEED
