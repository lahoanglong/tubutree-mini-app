-- Dấu thu hồi quyền CTV/đại lý (admin hạ về khách). Chỉ thêm cột nullable.
ALTER TABLE "users" ADD COLUMN "affiliateRevokedAt" TIMESTAMP(3);
