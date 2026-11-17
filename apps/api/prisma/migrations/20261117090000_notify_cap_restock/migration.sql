-- Trần tin chủ động mỗi khách, báo hàng về, bằng chứng đồng ý nhận tin (wave tubu-notify-cap-restock). Chỉ cộng: cột có mặc định
-- hoặc NULL, bảng mới, chỉ mục mới, dòng cấu hình và mẫu tin mới (ON CONFLICT DO NOTHING).
-- Ảnh cũ chạy trên DB mới: ảnh cũ không đọc các cột/bảng này và vẫn đọc "notifyGarden" như trước; INSERT users lấy mặc định.
-- Hai cờ mới mặc định TẮT: không bảng mới nào được ghi, hành vi gửi tin không đổi.

ALTER TABLE "users" ADD COLUMN     "notifyGardenAt" TIMESTAMP(3),
ADD COLUMN     "notifyGardenSource" TEXT,
ADD COLUMN     "notifyGardenTextVersion" TEXT,
ADD COLUMN     "notifyPromoAt" TIMESTAMP(3),
ADD COLUMN     "notifyPromoSource" TEXT,
ADD COLUMN     "notifyPromoTextVersion" TEXT,
ADD COLUMN     "notifySocial" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notifySocialAt" TIMESTAMP(3),
ADD COLUMN     "notifySocialSource" TEXT,
ADD COLUMN     "notifySocialTextVersion" TEXT;

-- Công tắc "Tương tác bài viết" tách khỏi "Nhắc Vườn Xanh": giữ đúng lựa chọn cũ của từng khách (công tắc gộp). Chạy lại được:
-- khách đã tự đổi công tắc mới ("notifySocialAt" có giá trị) thì không bị ghi đè.
UPDATE "users" SET "notifySocial" = "notifyGarden"
 WHERE "notifySocialAt" IS NULL AND "notifySocial" IS DISTINCT FROM "notifyGarden";

-- Ảnh cũ (trước wave) chỉ biết công tắc gộp và chỉ ghi "notifyGarden" (rollback ảnh, hoặc quãng ảnh cũ còn chạy sau migration): giữ
-- "notifySocial" cùng giá trị như công tắc gộp khách thấy. Ảnh mới luôn ghi kèm "notifyGardenAt" khi đổi "notifyGarden" nên không bị đụng.
CREATE OR REPLACE FUNCTION users_notify_social_follow_legacy() RETURNS trigger
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $fn$
BEGIN
  IF NEW."notifyGarden" IS DISTINCT FROM OLD."notifyGarden" AND NEW."notifyGardenAt" IS NOT DISTINCT FROM OLD."notifyGardenAt" THEN
    NEW."notifySocial" := NEW."notifyGarden";
  END IF;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS users_notify_social_follow_legacy ON "users";
CREATE TRIGGER users_notify_social_follow_legacy
BEFORE UPDATE OF "notifyGarden" ON "users"
FOR EACH ROW EXECUTE FUNCTION users_notify_social_follow_legacy();

ALTER TABLE "users" ADD CONSTRAINT "users_notify_consent_source_check" CHECK (
  ("notifyPromoSource" IS NULL OR "notifyPromoSource" IN ('settings', 'onboarding', 'unsubscribe_link'))
  AND ("notifyGardenSource" IS NULL OR "notifyGardenSource" IN ('settings', 'onboarding', 'unsubscribe_link'))
  AND ("notifySocialSource" IS NULL OR "notifySocialSource" IN ('settings', 'onboarding', 'unsubscribe_link'))
);

CREATE TABLE "restock_alerts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "variationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notifiedAt" TIMESTAMP(3),
    "roundId" TEXT,

    CONSTRAINT "restock_alerts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "restock_alert_rounds" (
    "id" TEXT NOT NULL,
    "variationId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stockAtStart" INTEGER NOT NULL,

    CONSTRAINT "restock_alert_rounds_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "notification_proactive_counters" (
    "userId" TEXT NOT NULL,
    "dayKey" DATE NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "notification_proactive_counters_pkey" PRIMARY KEY ("userId","dayKey"),
    CONSTRAINT "notification_proactive_counters_count_check" CHECK ("count" >= 0)
);

CREATE INDEX "restock_alerts_variationId_notifiedAt_createdAt_idx" ON "restock_alerts"("variationId", "notifiedAt", "createdAt");

CREATE INDEX "restock_alerts_userId_notifiedAt_idx" ON "restock_alerts"("userId", "notifiedAt");

CREATE INDEX "restock_alerts_notifiedAt_idx" ON "restock_alerts"("notifiedAt");

-- Một đăng ký đang chờ cho mỗi (khách, biến thể); đăng ký đã gửi tin không chặn lần đăng ký sau. Prisma không biểu diễn được WHERE.
CREATE UNIQUE INDEX "restock_alerts_pending_user_variation_key" ON "restock_alerts"("userId", "variationId") WHERE "notifiedAt" IS NULL;

CREATE INDEX "restock_alert_rounds_variationId_startedAt_idx" ON "restock_alert_rounds"("variationId", "startedAt");

CREATE INDEX "notification_proactive_counters_dayKey_idx" ON "notification_proactive_counters"("dayKey");

ALTER TABLE "restock_alerts" ADD CONSTRAINT "restock_alerts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "restock_alerts" ADD CONSTRAINT "restock_alerts_variationId_fkey" FOREIGN KEY ("variationId") REFERENCES "variations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "restock_alert_rounds" ADD CONSTRAINT "restock_alert_rounds_variationId_fkey" FOREIGN KEY ("variationId") REFERENCES "variations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "notification_proactive_counters" ADD CONSTRAINT "notification_proactive_counters_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "system_configs" ("key", "value", "description", "category", "updatedAt") VALUES
  ('notify.proactive_cap_enabled', 'false'::jsonb, 'Trần tin chủ động mỗi khách trên kênh ngoài app (ZNS): nhắc giỏ, mua lại, điểm sắp hết hạn, nhắc chuỗi, hàng về, khuyến mãi. Tin đơn hàng, thanh toán, đổi trả, đổi rác, bảo mật không bao giờ bị trần. Tắt thì gửi như cũ.', 'notify', NOW()),
  ('notify.proactive_per_day', '1'::jsonb, 'Số tin chủ động ngoài app tối đa mỗi khách mỗi ngày (giờ Việt Nam) khi trần tin chủ động bật. Số nguyên từ 1.', 'notify', NOW()),
  ('notify.proactive_per_week', '4'::jsonb, 'Số tin chủ động ngoài app tối đa mỗi khách trong 7 ngày gần nhất khi trần tin chủ động bật. Số nguyên từ 1.', 'notify', NOW()),
  ('catalog.restock_alert_enabled', 'false'::jsonb, 'Trang sản phẩm có nút "Báo tôi khi có hàng" khi biến thể hết hàng, và gửi một tin cho mỗi đăng ký khi hàng về. Tắt thì nút xám "Tạm hết hàng" như cũ, không gửi tin.', 'catalog', NOW())
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "notification_templates" ("id", "code", "channel", "bodyTemplate") VALUES
  ('nt-restock', 'RESTOCK_AVAILABLE', 'INAPP', 'Hàng về rồi: {{product}} đã có hàng trở lại. Đặt sớm kẻo hết nhé 🌿')
ON CONFLICT DO NOTHING;
