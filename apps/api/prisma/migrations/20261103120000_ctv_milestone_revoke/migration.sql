-- CTV-01: thu hồi thưởng mốc doanh số khi đảo hoa hồng làm doanh số tháng rơi dưới ngưỡng.
ALTER TABLE "ctv_milestone_claims"
  ADD COLUMN "revokedAt" TIMESTAMP(3),
  ADD COLUMN "revokeCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "revokeDebt" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "revokeTaken" INTEGER NOT NULL DEFAULT 0;

-- Mẫu thông báo cho CTV: thu hồi thưởng mốc (CTV-01), chưa tự chuyển được vào Ví vì thiếu mã số thuế (CTV-02).
INSERT INTO "notification_templates" ("id", "code", "channel", "bodyTemplate") VALUES
  ('nt-ctv-milestone-revoked', 'COMMISSION_MILESTONE_REVOKED', 'INAPP', 'Doanh số đã chốt tháng {{month}} của bạn không còn đạt {{milestone}} vì có đơn bị trả hoặc huỷ, nên {{taken_note}}{{debt_note}}.{{reclaim_note}}'),
  ('nt-ctv-tax-id-needed', 'COMMISSION_TAX_ID_NEEDED', 'INAPP', 'Hoa hồng {{amount}} của bạn chưa tự vào Ví được: tổng hoa hồng tháng {{month}} đã tới mức khấu trừ thuế TNCN nên cần mã số thuế cá nhân hoặc số CCCD. Bạn mở mục Hoa hồng, nhập mã số thuế rồi bấm Chuyển vào Ví nhé.')
ON CONFLICT DO NOTHING;
