-- Khử trùng lượt bấm link CTV từ route công khai: tối đa một dòng cho mỗi (mã link, IP băm, ngày giờ VN).
-- Dòng cũ và dòng ghi bằng đường khác để dedupeDay NULL; Postgres coi các NULL là khác nhau nên không đụng ràng buộc.
ALTER TABLE "affiliate_clicks" ADD COLUMN "dedupeDay" TEXT;
CREATE UNIQUE INDEX "affiliate_clicks_shortCode_ipHash_dedupeDay_key" ON "affiliate_clicks"("shortCode", "ipHash", "dedupeDay");
