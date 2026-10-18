-- extclaim sửa sau review lượt 1: nhật ký chỉ thêm của claim đơn ngoài app (A1).
CREATE TABLE "external_claim_events" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorId" TEXT,
    "fromState" TEXT,
    "toState" TEXT,
    "userIdBefore" TEXT,
    "userIdAfter" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "external_claim_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "external_claim_events_claimId_createdAt_idx" ON "external_claim_events"("claimId", "createdAt");

-- Chỉ thêm: không dòng nào được sửa sau khi ghi. Xoá vẫn được (data-retention, dọn dữ liệu thử).
CREATE FUNCTION "external_claim_events_no_update"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'external_claim_events chỉ được thêm, không được sửa';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "external_claim_events_no_update" BEFORE UPDATE ON "external_claim_events"
  FOR EACH ROW EXECUTE FUNCTION "external_claim_events_no_update"();
