-- AlterTable
ALTER TABLE "storefronts" ADD COLUMN "ordersPausedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "merchant_pancake_links" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "storefrontId" TEXT NOT NULL,
    "variationId" TEXT NOT NULL,
    "originProductId" TEXT,
    "originDeactivated" BOOLEAN NOT NULL DEFAULT false,
    "takeover" BOOLEAN NOT NULL DEFAULT false,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "linkedBy" TEXT,
    "unlinkedAt" TIMESTAMP(3),
    "unlinkedBy" TEXT,
    "unlinkReason" TEXT,

    CONSTRAINT "merchant_pancake_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "merchant_pancake_links_productId_idx" ON "merchant_pancake_links"("productId");

-- CreateIndex
CREATE INDEX "merchant_pancake_links_storefrontId_idx" ON "merchant_pancake_links"("storefrontId");

-- CreateIndex
CREATE INDEX "merchant_pancake_links_variationId_idx" ON "merchant_pancake_links"("variationId");

-- CreateIndex
CREATE INDEX "merchant_pancake_links_originProductId_idx" ON "merchant_pancake_links"("originProductId");

-- AddForeignKey
ALTER TABLE "merchant_pancake_links" ADD CONSTRAINT "merchant_pancake_links_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_pancake_links" ADD CONSTRAINT "merchant_pancake_links_variationId_fkey" FOREIGN KEY ("variationId") REFERENCES "variations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_pancake_links" ADD CONSTRAINT "merchant_pancake_links_originProductId_fkey" FOREIGN KEY ("originProductId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Mỗi biến thể Pancake chỉ đang liên kết với một sản phẩm đối tác: hai lần duyệt cùng mã không cùng ghi được dòng mở.
CREATE UNIQUE INDEX "merchant_pancake_links_variationId_open_key"
  ON "merchant_pancake_links"("variationId") WHERE "unlinkedAt" IS NULL;

-- Liên kết đã duyệt trước bản này: không biết sản phẩm gốc (NULL) và lấy mốc sửa cuối của sản phẩm làm mốc liên kết
-- (muộn hơn hoặc bằng mốc thật: gian hàng chỉ thấy ít đơn hơn, không thấy đơn trước khi liên kết). Chạy lại không thêm dòng.
INSERT INTO "merchant_pancake_links" ("id", "productId", "storefrontId", "variationId", "linkedAt")
SELECT 'mpl-' || v."id", p."id", p."storefrontId", v."id", p."updatedAt"
  FROM "products" p
  JOIN "variations" v ON v."productId" = p."id" AND v."pancakeId" = p."pancakeLinkCode"
 WHERE p."storefrontId" IS NOT NULL
   AND p."pancakeLinkCode" IS NOT NULL
   AND p."fulfilment" = 'TUBU'
   AND NOT EXISTS (SELECT 1 FROM "merchant_pancake_links" l WHERE l."variationId" = v."id" AND l."unlinkedAt" IS NULL)
ON CONFLICT DO NOTHING;

INSERT INTO "system_configs" ("key", "value", "description", "category", "updatedAt") VALUES
  ('merchant.negative_payout_due_days', '7'::jsonb, 'Số ngày đối tác phải nộp lại Tubu khoản của phiếu đối soát âm (đơn COD đối tác đã tự thu tiền), tính từ ngày lập phiếu', 'merchant', now())
ON CONFLICT DO NOTHING;

INSERT INTO "notification_templates" ("id", "code", "channel", "bodyTemplate") VALUES
  ('nt-merchant-return-requested', 'MERCHANT_RETURN_REQUESTED', 'INAPP', 'Khách gửi yêu cầu trả hàng đơn {{order_code}} ({{items}}): "{{reason}}". Tubu đang xem xét; xem ảnh khách gửi ở Cổng người bán → Hàng trả về.'),
  ('nt-order-merchant-delayed', 'ORDER_MERCHANT_DELAYED', 'INAPP', 'Đơn {{order_code}} do {{store}} giao đang chậm {{step}}. Tubu đã nhắc gian hàng. Nếu không muốn chờ, bạn huỷ được đơn trong mục Đơn hàng khi hàng chưa gửi đi, tiền đã trả được hoàn đủ.'),
  ('nt-merchant-product-unlinked', 'MERCHANT_PRODUCT_UNLINKED', 'INAPP', 'Sản phẩm "{{product_name}}" đã gỡ liên kết mã Pancake (Tubu giao hộ) và tạm ngừng bán: {{reason}}. Liên hệ Tubu nếu bạn cần liên kết lại.')
ON CONFLICT DO NOTHING;
