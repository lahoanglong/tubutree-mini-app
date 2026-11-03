-- DR-03: hạn giữ chỗ là hết ngày D giờ VN, nên tin nhắc nói "hạn chót là hết ngày D" thay vì "trước ngày đó".
-- Chỉ đổi khi nội dung vẫn đúng bản mặc định cũ, để không đè bản admin đã sửa. Idempotent. Lời mới trùng từng chữ với prisma/seed.ts.

UPDATE "notification_templates" SET "bodyTemplate" = 'Yêu cầu {{code}} sắp hết hạn giữ chỗ, hạn chót là hết ngày {{until}}. Bạn nhớ {{next_step}} đến hết ngày đó nhé.'
WHERE "code" = 'WASTE_REQUEST_EXPIRING'
  AND "bodyTemplate" = 'Yêu cầu {{code}} sắp hết hạn giữ chỗ vào ngày {{until}}. Bạn nhớ {{next_step}} trước ngày đó nhé.';
