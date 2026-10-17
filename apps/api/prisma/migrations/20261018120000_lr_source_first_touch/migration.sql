-- Nguồn khách: chạm đầu của tài khoản (ghi một lần) và chiến dịch của từng sự kiện analytics.
-- Cột nullable, không giá trị mặc định: ALTER chỉ đổi catalog, không viết lại bảng.
ALTER TABLE "users"
  ADD COLUMN "firstTouchSource" TEXT,
  ADD COLUMN "firstTouchCampaign" TEXT,
  ADD COLUMN "firstTouchAt" TIMESTAMP(3);

ALTER TABLE "analytics_events" ADD COLUMN "campaign" TEXT;
