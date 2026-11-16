-- W178: phần phí lấy rác tận nhà trả trước bằng tiền (Ví Tubu hoặc chuyển khoản VietQR xác nhận tay), cấm thu hộ COD.
-- Chỉ THÊM giá trị enum, kiểu enum, cột nullable, ràng buộc CHECK NOT VALID và dòng cấu hình mặc định (tương thích ngược).
ALTER TYPE "WalletTxType" ADD VALUE IF NOT EXISTS 'WASTE_FEE_PAY';
ALTER TYPE "WalletTxType" ADD VALUE IF NOT EXISTS 'WASTE_FEE_REFUND';
ALTER TYPE "WasteCloseReason" ADD VALUE IF NOT EXISTS 'FEE_UNPAID';

CREATE TYPE "WasteFeeCashMethod" AS ENUM ('WALLET', 'BANK_TRANSFER');

ALTER TABLE "waste_requests"
  ADD COLUMN "shipFeeCashVnd" INTEGER,
  ADD COLUMN "shipFeeCashMethod" "WasteFeeCashMethod",
  ADD COLUMN "shipFeeCashPaidAt" TIMESTAMP(3),
  ADD COLUMN "shipFeeCashRefundedVnd" INTEGER,
  ADD COLUMN "shipFeeBankRef" TEXT;

DO $$ BEGIN
  ALTER TABLE "waste_requests" ADD CONSTRAINT "waste_fee_split_ck"
    CHECK (
      "shipFeeVnd" IS NULL OR (
        COALESCE("shipFeePointsUsed", 0) >= 0
        AND COALESCE("shipFeeCashVnd", 0) >= 0
        AND COALESCE("shipFeeCodVnd", 0) >= 0
        AND "shipFeeVnd" = COALESCE("shipFeePointsUsed", 0) + COALESCE("shipFeeCashVnd", 0) + COALESCE("shipFeeCodVnd", 0)
      )
    ) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "waste_requests" ADD CONSTRAINT "waste_fee_cash_refund_ck"
    CHECK (
      "shipFeeCashRefundedVnd" IS NULL OR (
        "shipFeeCashPaidAt" IS NOT NULL
        AND "shipFeeCashVnd" > 0
        AND "shipFeeCashRefundedVnd" = "shipFeeCashVnd"
      )
    ) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "waste_requests" ADD CONSTRAINT "waste_fee_cod_zero_ck"
    CHECK ("createdAt" < TIMESTAMPTZ '2026-11-16 05:00:00+00' OR COALESCE("shipFeeCodVnd", 0) = 0) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

INSERT INTO "system_configs" ("key", "value", "description", "category", "updatedAt") VALUES
  ('waste.home_pickup_bank_transfer_enabled', 'false'::jsonb, 'Bật cách chuyển khoản VietQR cho phần phí lấy rác tận nhà còn thiếu sau khi trừ Điểm Xanh, xác nhận tay bởi kế toán.', 'waste', NOW()),
  ('waste.fee_payment_ttl_hours', '24'::jsonb, 'Số giờ giữ yêu cầu lấy rác tận nhà chờ khách chuyển khoản phí còn thiếu, quá hạn thì tự đóng.', 'waste', NOW())
ON CONFLICT ("key") DO NOTHING;
