-- AddForeignKey: storefront_items.productId → products.id
ALTER TABLE "storefront_items" ADD CONSTRAINT "storefront_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "storefront_items_productId_idx" ON "storefront_items"("productId");
