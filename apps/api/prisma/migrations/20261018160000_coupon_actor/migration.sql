-- D1-05: ai tạo / sửa mã giảm giá qua trang quản trị. Nhân viên Marketing chỉ sửa mã do nhân viên tạo, không dùng mã của chính mình.
ALTER TABLE "coupons" ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "updatedById" TEXT;
