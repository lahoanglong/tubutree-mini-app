-- D1-05: ngân sách mã giảm giá theo ngày của nhân viên cộng mọi mã người đó tạo trong ngày (createdById + createdAt).
ALTER TABLE "coupons" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "coupons_createdById_createdAt_idx" ON "coupons"("createdById", "createdAt");
