-- Mốc lần cuối nhắc CTV thêm sản phẩm nổi bật còn thiếu vào gian hàng
-- (storefront-reminder.service.ts) — guard chống gửi trùng khi cron chạy chồng/chạy lại trong
-- tuần. Nullable, không backfill: gian hàng cũ = chưa từng nhắc, đúng nghĩa.
-- AlterTable
ALTER TABLE "storefronts" ADD COLUMN     "lastReminderAt" TIMESTAMP(3);
