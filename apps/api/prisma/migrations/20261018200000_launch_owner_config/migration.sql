-- Giá trị chủ dự án chốt cho đợt ra mắt. Mỗi UPDATE chỉ chạm dòng còn đúng giá trị cũ do migration trước chèn,
-- nên giá trị admin đã đặt không bị ghi đè; DB chưa có dòng thì không có gì để sửa.

UPDATE "system_configs" SET "value" = '"8386790906"'::jsonb, "updatedAt" = now()
 WHERE "key" = 'payment.bank_account_no' AND "value" = '"9984606774"'::jsonb;
UPDATE "system_configs" SET "value" = '"CONG TY TNHH TUBU TREE"'::jsonb, "updatedAt" = now()
 WHERE "key" = 'payment.bank_account_name' AND "value" = '"CONG TY TUBU TREE"'::jsonb;
UPDATE "system_configs" SET "value" = '"Ngân hàng TMCP Kỹ Thương Việt Nam"'::jsonb, "updatedAt" = now()
 WHERE "key" = 'payment.bank_name' AND "value" = '"Techcombank"'::jsonb;

UPDATE "system_configs" SET "value" = 'true'::jsonb, "updatedAt" = now()
 WHERE "key" = 'shipping.first_order_free_enabled' AND "value" = 'false'::jsonb;
UPDATE "system_configs" SET "value" = '199000'::jsonb, "updatedAt" = now()
 WHERE "key" = 'shipping.first_order_free_min_subtotal' AND "value" = '0'::jsonb;

UPDATE "system_configs"
   SET "value" = jsonb_set("value", '{defaultWarehouse,phone}', '"0899149229"'::jsonb), "updatedAt" = now()
 WHERE "key" = 'shipping.gomdon.config' AND "value" #>> '{defaultWarehouse,phone}' = '0965573541';
