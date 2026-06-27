-- AddColumn: số "đã bán" gom từ sàn ngoài (admin nhập) + đơn trong app (cron tính)
ALTER TABLE "products" ADD COLUMN "soldExternal" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "products" ADD COLUMN "soldApp" INTEGER NOT NULL DEFAULT 0;
