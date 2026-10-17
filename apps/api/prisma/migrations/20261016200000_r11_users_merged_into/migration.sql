-- Dòng khách đã gộp trỏ tới tài khoản đích: mã giới thiệu cũ của khách quy về người đích. Cột nullable không default:
-- chỉ đổi metadata, không viết lại bảng.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "mergedIntoId" TEXT;
