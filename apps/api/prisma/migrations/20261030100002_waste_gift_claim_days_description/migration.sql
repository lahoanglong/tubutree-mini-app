-- Quà quá hạn nhận nay tự huỷ và hoàn điểm, trừ khách bị khoá, bị thu hồi điểm hoặc đã xoá tài khoản (admin xử lý ở hàng Quá hạn nhận): sửa mô tả khoá cho khớp.
-- Chỉ đổi khi còn đúng câu seed cũ (admin đã chỉnh chữ thì giữ).
UPDATE "system_configs"
SET "description" = 'Số ngày nhận quà bằng mã. Hết hạn thì quà tự huỷ và hoàn điểm, trừ khách bị khoá, bị thu hồi hoặc đã xoá tài khoản: admin xử lý.'
WHERE "key" = 'waste.gift_claim_days'
  AND "description" = 'Số ngày khách được nhận quà bằng mã, quá hạn thì lượt đổi vào danh sách admin xem lại.';
