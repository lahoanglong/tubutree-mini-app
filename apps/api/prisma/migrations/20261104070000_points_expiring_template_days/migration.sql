-- TK-04: tin nhắc cộng mọi lô Điểm Xanh hết hạn trong cửa sổ nhắc nhưng chỉ ghi ngày của lô sớm nhất, nên câu cũ
-- "sắp hết hạn vào {{date}}" khiến khách hiểu cả số điểm hết hạn cùng ngày đó. Câu mới nói rõ tổng trong {{days}} ngày tới.
-- Chỉ đổi khi nội dung vẫn đúng bản mặc định cũ, để không đè bản admin đã sửa. Idempotent. Lời mới trùng từng chữ với prisma/seed.ts.

UPDATE "notification_templates" SET "bodyTemplate" = 'Bạn có {{points}} Điểm Xanh hết hạn trong {{days}} ngày tới, sớm nhất vào {{date}}.'
WHERE "code" = 'POINTS_EXPIRING'
  AND "bodyTemplate" = '⏳ Bạn có {{points}} Điểm Xanh sắp hết hạn vào {{date}}. Dùng để đổi ưu đãi trước khi lỡ nhé! 🌿';
