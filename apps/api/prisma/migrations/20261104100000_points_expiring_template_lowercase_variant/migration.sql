-- TK-04 bổ sung: 20261104070000 chỉ khớp bản "Điểm Xanh" viết hoa, nhưng PROD đã áp 20261010150000 từ trước khi file đó được sửa
-- sang chữ hoa (C-053), nên PROD còn bản "điểm Xanh" viết thường và không được đổi câu. Khớp cả hai bản mặc định cũ, từng byte
-- như bản migration đã chèn. Bản admin đã sửa tay vẫn giữ nguyên. Idempotent.

UPDATE "notification_templates" SET "bodyTemplate" = 'Bạn có {{points}} Điểm Xanh hết hạn trong {{days}} ngày tới, sớm nhất vào {{date}}.'
WHERE "code" = 'POINTS_EXPIRING'
  AND "bodyTemplate" IN (
    '⏳ Bạn có {{points}} điểm Xanh sắp hết hạn vào {{date}}. Dùng để đổi ưu đãi trước khi lỡ nhé! 🌿',
    '⏳ Bạn có {{points}} Điểm Xanh sắp hết hạn vào {{date}}. Dùng để đổi ưu đãi trước khi lỡ nhé! 🌿'
  );
