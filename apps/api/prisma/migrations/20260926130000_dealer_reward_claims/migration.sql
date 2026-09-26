-- Yêu cầu nhận thưởng mốc đại lý (DealerRewardClaim): PENDING → APPROVED | REJECTED; APPROVED → PAID.
-- Trước đây POST /dealer/rewards/:id/claim chỉ ghi 1 dòng log rồi báo "đã ghi nhận" — không lưu
-- gì, không ai được báo, bấm lại vô hạn. Unique (userId, periodKey, rewardId) làm yêu cầu idempotent.

-- CreateEnum
CREATE TYPE "DealerRewardClaimStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'PAID');

-- CreateTable
CREATE TABLE "dealer_reward_claims" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rewardId" TEXT,
    "periodKey" TEXT NOT NULL,
    "rewardTitle" TEXT NOT NULL,
    "rewardType" "DealerRewardType" NOT NULL,
    "rewardPeriod" TEXT NOT NULL,
    "threshold" INTEGER NOT NULL,
    "volumeAtClaim" INTEGER NOT NULL,
    "note" TEXT,
    "status" "DealerRewardClaimStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "paidBy" TEXT,
    "paidAt" TIMESTAMP(3),
    "adminNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dealer_reward_claims_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "dealer_reward_claims_status_createdAt_idx" ON "dealer_reward_claims"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "dealer_reward_claims_userId_periodKey_rewardId_key" ON "dealer_reward_claims"("userId", "periodKey", "rewardId");

-- AddForeignKey
ALTER TABLE "dealer_reward_claims" ADD CONSTRAINT "dealer_reward_claims_rewardId_fkey" FOREIGN KEY ("rewardId") REFERENCES "dealer_rewards"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Dữ liệu vận hành cho PROD (prod KHÔNG chạy `prisma db seed`) — idempotent:
-- config DO NOTHING (không ghi đè giá trị admin đã chỉnh), template DO UPDATE (đảm bảo nội dung đúng).
INSERT INTO "system_configs" ("key", "value", "description", "category", "updatedAt") VALUES
  ('dealer.reward_claim_grace_days', '30'::jsonb, 'Số ngày sau khi kỳ (quý/năm) kết thúc mà đại lý vẫn được gửi yêu cầu nhận thưởng mốc đã đạt trong kỳ đó', 'dealer', now())
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "notification_templates" ("id", "code", "channel", "bodyTemplate") VALUES
  ('nt-dealer-reward-claim-new', 'DEALER_REWARD_CLAIM_NEW', 'INAPP', '📥 Đại lý {{dealer}} yêu cầu nhận thưởng "{{reward}}" ({{period}}, doanh số đã chốt {{volume}}đ). Vào trang quản trị để duyệt.'),
  ('nt-dealer-reward-claim-approved', 'DEALER_REWARD_CLAIM_APPROVED', 'INAPP', '✅ Yêu cầu nhận thưởng "{{reward}}" ({{period}}) đã được duyệt. Tubu Tree sẽ liên hệ để trao thưởng cho bạn 🌿'),
  ('nt-dealer-reward-claim-rejected', 'DEALER_REWARD_CLAIM_REJECTED', 'INAPP', 'Yêu cầu nhận thưởng "{{reward}}" ({{period}}) chưa được duyệt. Lý do: {{reason}}. Cần hỗ trợ, bạn nhắn Zalo OA Tubu Tree nhé.'),
  ('nt-dealer-reward-claim-paid', 'DEALER_REWARD_CLAIM_PAID', 'INAPP', '🎁 Tubu Tree đã trao thưởng "{{reward}}" ({{period}}) cho bạn. Cảm ơn bạn đã đồng hành 🌿')
ON CONFLICT ("id") DO UPDATE SET "code" = EXCLUDED."code", "channel" = EXCLUDED."channel", "bodyTemplate" = EXCLUDED."bodyTemplate";
