-- Items that only the Tubu warehouse accepts (launch decision 2026-10-19): partner points never take them.
-- The default is false so a new item behaves as before; the UPDATE flags the two seeded items on databases that already hold them.
ALTER TABLE "waste_items" ADD COLUMN "warehouseOnly" BOOLEAN NOT NULL DEFAULT false;

UPDATE "waste_items" SET "warehouseOnly" = true WHERE "code" IN ('MILK_CARTON', 'TUBU_BOTTLE');
