-- Tin thu hồi thưởng mốc CTV: thu được 0 điểm (số dư hết, toàn bộ thành nợ) thì không ghi "0 Điểm Xanh đã được thu lại".
-- Phần số điểm thu được chuyển vào biến {{taken_note}}. Chỉ UPDATE khi thân còn đúng chữ của migration
-- 20261103120000_ctv_milestone_revoke (admin đã sửa tay thì giữ nguyên); chạy lại không khớp dòng nào.
UPDATE "notification_templates"
SET "bodyTemplate" = 'Doanh số đã chốt tháng {{month}} của bạn không còn đạt {{milestone}} vì có đơn bị trả hoặc huỷ, nên {{taken_note}}{{debt_note}}.{{reclaim_note}}'
WHERE "code" = 'COMMISSION_MILESTONE_REVOKED'
  AND "bodyTemplate" = 'Doanh số đã chốt tháng {{month}} của bạn không còn đạt {{milestone}} vì có đơn bị trả hoặc huỷ, nên {{points}} Điểm Xanh thưởng mốc đã được thu lại{{debt_note}}.{{reclaim_note}}';
