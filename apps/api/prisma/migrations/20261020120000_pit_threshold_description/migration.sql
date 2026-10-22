-- Q2: ngưỡng thuế TNCN nay xét trên tổng hoa hồng rút trong tháng VN, không còn theo từng lần rút. Seed khai createOnly nên
-- DB đang chạy giữ mô tả cũ (admin đọc ngưỡng sai); chỉ đổi dòng còn nguyên chữ cũ, không đè mô tả admin đã tự sửa.
UPDATE "system_configs"
SET "description" = 'Tổng hoa hồng rút trong tháng (giờ VN) từ số tiền này trở lên thì khấu trừ thuế TNCN (đồng)'
WHERE "key" = 'affiliate.pit_withhold_threshold'
  AND "description" = 'Lần rút hoa hồng từ số tiền này trở lên thì khấu trừ thuế TNCN (đồng)';
