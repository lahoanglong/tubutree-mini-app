-- ENGAGE-11: CHECKIN_7 nhận một lần (trước đây lặp mỗi 7 ngày chuỗi, 30 Điểm Xanh/tuần chỉ nhờ bấm điểm danh).
-- Dòng mission_progress cũ (cycleKey 1, 2, ...) vẫn giữ; GameService coi nhiệm vụ không lặp lại có dòng bất kỳ là đã nhận.
UPDATE "missions"
SET "isRepeatable" = false,
    "description" = 'Điểm danh Vườn Xanh 7 ngày liên tiếp (nhận một lần)'
WHERE "code" = 'CHECKIN_7';

-- ENGAGE-1: mô tả khớp điều kiện mới (đơn đã giao; lượt giới thiệu thành công).
UPDATE "missions" SET "description" = 'Nhận thành công đơn hàng đầu tiên' WHERE "code" = 'FIRST_ORDER';
UPDATE "missions" SET "description" = 'Mời 3 bạn mua hàng thành công qua mã giới thiệu' WHERE "code" = 'INVITE_3';

-- ENGAGE-10: voucher vòng quay cần đơn tối thiểu = giá trị × hệ số.
INSERT INTO "system_configs" ("key", "value", "category", "description", "updatedAt")
VALUES (
  'game.spin_voucher_min_order_multiplier',
  '6'::jsonb,
  'game',
  'Voucher trúng vòng quay dùng cho đơn từ (giá trị × hệ số này); 6 = như quà đổi điểm 50.000đ/300.000đ',
  NOW()
)
ON CONFLICT ("key") DO NOTHING;
