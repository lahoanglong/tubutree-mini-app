-- D9-09: tab Voucher của admin liệt kê mã mặc định ẩn voucher cá nhân sinh tự động (scope USER_GROUP: chào mừng, sinh nhật,
-- mua chung, vòng quay; hàng nghìn dòng, thêm mỗi khách mới) và mã thuộc lô thẻ. Không có index thì findMany (sắp theo startAt)
-- và count đều quét tuần tự cả bảng coupons. Partial index chỉ chứa mã còn lại, đúng vị từ của truy vấn trong
-- AdminService.listCoupons nên bảng càng nhiều mã cá nhân, index vẫn nhỏ.
-- Additive, không đổi dữ liệu. Prisma không biểu diễn được partial index: đừng `db push`.
CREATE INDEX IF NOT EXISTS "coupons_admin_list_idx"
  ON "coupons" ("startAt" DESC)
  WHERE "scope" <> 'USER_GROUP' AND "batch" IS NULL;
