-- Khoá home.new_customer_layout không client nào đọc nên bỏ khỏi mã; xoá dòng cấu hình còn sót trong DB đang chạy.
-- system_configs không có khoá ngoại nào trỏ tới; system_config_history lưu key dạng chuỗi, không FK, và được giữ nguyên làm lịch sử.
-- Chạy lại an toàn: lần sau không còn dòng khớp.
DELETE FROM "system_configs" WHERE "key" = 'home.new_customer_layout';
