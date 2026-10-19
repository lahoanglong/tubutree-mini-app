-- extclaim sửa sau review lượt 3: ghi trạng thái đơn lúc duyệt/gắn để biết quyết định có phải cho đơn hoàn một phần không (R3).
ALTER TABLE "external_claim_events" ADD COLUMN "orderStatus" TEXT;
