-- TK-04 bổ sung: 20261104070000 chỉ khớp bản "Điểm Xanh" viết hoa, nhưng PROD dựng từ bản thử cb92dc8 bằng prisma:seed, seed lúc
-- đó viết "điểm Xanh" thường (cb92dc8:apps/api/prisma/seed.ts dòng 705); 20261010150000 chèn sau đó bị ON CONFLICT bỏ qua. Nên PROD
-- không được đổi câu. Khớp cả hai bản mặc định cũ, từng byte. Bản admin đã sửa tay vẫn giữ nguyên. Idempotent.

UPDATE "notification_templates" SET "bodyTemplate" = 'Bạn có {{points}} Điểm Xanh hết hạn trong {{days}} ngày tới, sớm nhất vào {{date}}.'
WHERE "code" = 'POINTS_EXPIRING'
  AND "bodyTemplate" IN (
    '⏳ Bạn có {{points}} điểm Xanh sắp hết hạn vào {{date}}. Dùng để đổi ưu đãi trước khi lỡ nhé! 🌿',
    '⏳ Bạn có {{points}} Điểm Xanh sắp hết hạn vào {{date}}. Dùng để đổi ưu đãi trước khi lỡ nhé! 🌿'
  );
