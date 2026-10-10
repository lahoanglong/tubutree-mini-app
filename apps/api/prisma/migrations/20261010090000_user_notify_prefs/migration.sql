-- Additive: mặc định true giữ nguyên hành vi gửi hiện tại cho khách chưa từng tắt.
ALTER TABLE "users" ADD COLUMN "notifyPromo" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "users" ADD COLUMN "notifyGarden" BOOLEAN NOT NULL DEFAULT true;
