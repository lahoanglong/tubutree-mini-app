ALTER TABLE "orders" ADD COLUMN "storefrontSlug" TEXT;
CREATE INDEX "orders_storefrontSlug_idx" ON "orders"("storefrontSlug");
