-- Nhắc đổi sang gói Refill 21 ngày sau khi nhận chai (tubu-w11-03): sổ chống trùng một dòng mỗi đơn, hai cờ mặc định TẮT, mẫu tin chỉ
-- trong app. Chỉ thêm, không đổi dữ liệu cũ; dòng cấu hình và mẫu tin đã có thì giữ nguyên giá trị admin đặt.
CREATE TABLE "refill_reminders" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bottleProductId" TEXT,
    "refillProductId" TEXT,
    "outcome" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refill_reminders_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "refill_reminders_orderId_key" ON "refill_reminders"("orderId");

CREATE INDEX "refill_reminders_userId_createdAt_idx" ON "refill_reminders"("userId", "createdAt");

INSERT INTO "system_configs" ("key", "value", "description", "category", "updatedAt") VALUES
  ('retention.refill_21d_reminder_enabled', 'false'::jsonb, 'Nhắc đổi sang gói Refill: 21 ngày sau khi giao một đơn có chai đã ghép cặp Refill (thẻ admin Cặp Refill), khách nhận một tin "Nhắc mua lại" trong chuông thông báo, chạm mở trang gói Refill của chai đó. Mỗi đơn tối đa một tin; bỏ qua khách tắt tin khuyến mãi, bị khoá hay đã từ chối tin Zalo, khách đã đặt lại gói Refill đó trong 21 ngày; mỗi khách tối đa một tin mỗi 7 ngày, tối đa 300 đơn mỗi lượt (09:30 hằng ngày). Chỉ xét đơn giao từ 21 tới 28 ngày trước. Tắt thì không gửi tin nào.', 'retention', NOW()),
  ('retention.refill_21d_zns_enabled', 'false'::jsonb, 'Gửi thêm tin nhắc đổi sang gói Refill qua Zalo (ZNS) khi mẫu REORDER_REMINDER_REFILL đã gắn mã ZNS được Zalo duyệt; trần tin chủ động mỗi ngày/tuần và trần tin khuyến mãi mỗi tháng vẫn áp. Tắt thì tin chỉ vào chuông thông báo trong app.', 'retention', NOW())
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "notification_templates" ("id", "code", "channel", "bodyTemplate") VALUES
  ('nt-reorder-refill', 'REORDER_REMINDER_REFILL', 'INAPP', 'Đã 3 tuần từ khi bạn nhận {{bottle}}. Châm lại bằng {{product}} để tiết kiệm hơn và bớt một chai nhựa dùng một lần 🌿')
ON CONFLICT DO NOTHING;
