-- Quà quá hạn nhận nay tự huỷ và hoàn điểm, không còn vào danh sách admin xem lại: sửa mô tả khoá cho khớp.
-- Chỉ đổi khi còn đúng câu seed cũ (admin đã chỉnh chữ thì giữ).
UPDATE "system_configs"
SET "description" = 'Số ngày khách được nhận quà bằng mã. Hết ngày hạn thì quà tự huỷ, hoàn điểm cho khách và báo khách một tin.'
WHERE "key" = 'waste.gift_claim_days'
  AND "description" = 'Số ngày khách được nhận quà bằng mã, quá hạn thì lượt đổi vào danh sách admin xem lại.';
