-- Lịch sử điểm của khách (LoyaltyService.getPointsTransactions): WHERE userId ORDER BY createdAt DESC, id DESC LIMIT n.
-- Index (userId) và (userId, refId) hiện có buộc sắp lại toàn bộ dòng của khách rồi lấy n dòng đầu; khách tích điểm lâu năm
-- có hàng chục nghìn dòng. Không CONCURRENTLY vì migration chạy trong transaction: khoá chặn ghi sổ điểm lúc dựng.
CREATE INDEX IF NOT EXISTS "points_transactions_userId_createdAt_id_idx"
  ON "points_transactions" ("userId", "createdAt" DESC, "id" DESC);
