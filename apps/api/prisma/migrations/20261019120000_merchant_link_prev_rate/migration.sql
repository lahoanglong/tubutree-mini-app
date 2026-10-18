-- Lưu % hoa hồng CTV của biến thể lúc liên kết "Tubu giao hộ" để gỡ liên kết khôi phục đúng giá trị.
ALTER TABLE "merchant_pancake_links"
  ADD COLUMN "affiliateRateAtLink" DECIMAL(65,30),
  ADD COLUMN "affiliateRateCaptured" BOOLEAN NOT NULL DEFAULT false;
