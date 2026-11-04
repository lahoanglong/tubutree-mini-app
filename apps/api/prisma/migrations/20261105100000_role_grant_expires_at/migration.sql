-- Hạn của lời mời quyền theo SĐT chưa áp. Chỉ thêm cột nullable (image cũ vẫn chạy).
ALTER TABLE "role_grants" ADD COLUMN "expiresAt" TIMESTAMP(3);
