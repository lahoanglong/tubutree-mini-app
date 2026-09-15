-- Bug 1 (race condition, getOrCreateStore): trước đây KHÔNG có unique constraint trên
-- ownerUserId — 2 request đồng thời (double-tap "Mở gian hàng") có thể tạo 2 Storefront cho
-- cùng 1 user (findFirst rồi create, không transaction/lock). Thêm unique constraint chặn ở
-- tầng DB; Postgres cho phép nhiều NULL trên unique index nên không ảnh hưởng storefront chưa
-- có owner (brand storefront...) nếu có. merchant.service.ts bắt P2002 khi đụng constraint này
-- và đọc lại bản ghi mà request thắng vừa tạo thay vì throw lỗi.

-- CreateIndex
CREATE UNIQUE INDEX "storefronts_ownerUserId_key" ON "storefronts"("ownerUserId");
