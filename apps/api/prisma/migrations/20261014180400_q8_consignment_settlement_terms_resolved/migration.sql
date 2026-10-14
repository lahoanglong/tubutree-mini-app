-- Q8 (review S1): lịch sử phí của gian hàng lưu phí sàn đã quy ra số. Dòng đang để NULL (gian hàng theo merchant.commission_pct)
-- nhận mặc định hiện tại (thiếu hoặc sai kiểu thì 15%), để đổi mặc định sau này không tính lại đơn giao hộ đã đặt. Chỉ cập nhật
-- dữ liệu, không đổi cấu trúc.
UPDATE "storefront_terms_history" h
   SET "commissionPct" = COALESCE(
         (SELECT CASE WHEN jsonb_typeof(c."value") = 'number'
                      THEN CASE WHEN (c."value"::text)::numeric BETWEEN 0 AND 1 THEN (c."value"::text)::numeric END
                 END
            FROM "system_configs" c
           WHERE c."key" = 'merchant.commission_pct'),
         0.15)
 WHERE h."commissionPct" IS NULL;
