-- Mẫu đơn đại lý lưu sẵn (#64)
CREATE TABLE "dealer_order_templates" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "dealer_order_templates_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "dealer_order_templates_userId_idx" ON "dealer_order_templates"("userId");

ALTER TABLE "dealer_order_templates" ADD CONSTRAINT "dealer_order_templates_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
