-- Lần đầu sản phẩm được duyệt bán: ảnh của sản phẩm đã từng công khai vẫn phát được (giỏ, đơn cũ) kể cả khi nó đang chờ duyệt lại.
ALTER TABLE "products" ADD COLUMN "approvedAt" TIMESTAMP(3);
UPDATE "products" SET "approvedAt" = "createdAt" WHERE "approvalStatus" = 'APPROVED';
