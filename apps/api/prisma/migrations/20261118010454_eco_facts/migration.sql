-- Sự thật xanh có nguồn của sản phẩm (wave tubu-w2-01): một bảng mới và hai cờ mặc định TẮT. Chỉ cộng, image cũ không đọc bảng này.

-- CreateEnum
CREATE TYPE "EcoFactKind" AS ENUM ('REFILL_PACK', 'PLASTIC_AVOIDED', 'RETURNABLE_PACKAGING', 'CERTIFICATION', 'INGREDIENT_ORIGIN');

-- CreateEnum
CREATE TYPE "EcoFactStatus" AS ENUM ('DRAFT', 'APPROVED', 'RETIRED');

-- CreateTable
CREATE TABLE "product_eco_facts" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variationId" TEXT,
    "kind" "EcoFactKind" NOT NULL,
    "valueGrams" INTEGER,
    "baselineText" VARCHAR(120),
    "label" VARCHAR(80),
    "co2Grams" INTEGER,
    "sourceUrl" VARCHAR(500) NOT NULL,
    "sourceNote" VARCHAR(300) NOT NULL,
    "status" "EcoFactStatus" NOT NULL DEFAULT 'DRAFT',
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_eco_facts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_eco_facts_status_productId_idx" ON "product_eco_facts"("status", "productId");

-- CreateIndex
CREATE INDEX "product_eco_facts_variationId_idx" ON "product_eco_facts"("variationId");

-- CreateIndex
CREATE UNIQUE INDEX "product_eco_facts_productId_variationId_kind_key" ON "product_eco_facts"("productId", "variationId", "kind");

-- Dòng cấp sản phẩm ("variationId" NULL): chỉ mục duy nhất ở trên coi hai NULL là khác nhau, nên giữ một dòng mỗi (sản phẩm, loại) bằng chỉ mục một phần.
CREATE UNIQUE INDEX "product_eco_facts_product_kind_null_variation_key" ON "product_eco_facts"("productId", "kind") WHERE "variationId" IS NULL;

-- AddForeignKey
ALTER TABLE "product_eco_facts" ADD CONSTRAINT "product_eco_facts_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_eco_facts" ADD CONSTRAINT "product_eco_facts_variationId_fkey" FOREIGN KEY ("variationId") REFERENCES "variations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hai cờ mặc định TẮT. Chỉ thêm dòng khi chưa có, không đổi giá trị admin đã đặt.
INSERT INTO "system_configs" ("key", "value", "description", "category", "updatedAt") VALUES
  ('eco.product_badges_enabled', 'false'::jsonb, 'Nhãn xanh có nguồn: thẻ sản phẩm mang tối đa 1 nhãn (Can refill, Giảm ~g nhựa, Trả vỏ đổi điểm) và trang sản phẩm có khối "Điểm cộng xanh" kèm link Nguồn. Chỉ sự thật đã duyệt ở admin "Sự thật xanh" mới hiện. Tắt thì thẻ và trang sản phẩm như cũ.', 'eco', NOW()),
  ('eco.passport_enabled', 'false'::jsonb, 'Hộ chiếu Xanh (chỉ web): GET /me/eco-passport tính tác động của khách từ đơn đã giao, Đổi rác và cây đã cam kết; lối vào ở Điểm Xanh và trang sản phẩm web. Không phát điểm, không huy hiệu. Tắt thì API trả 404 và lối vào ẩn.', 'eco', NOW())
ON CONFLICT ("key") DO NOTHING;
