-- Thu hồi thưởng đánh giá khi dòng hàng được đánh giá bị trả (order-reversal.service.ts, review-reward-reversal.ts).
-- Ràng buộc viết tay (Prisma không biểu diễn được index unique có điều kiện), chạy lại không lỗi: mỗi đánh giá tối đa một
-- dòng thu hồi, reason = REVIEW_RETURN:<id đánh giá>. Lớp hai sau khoá advisory theo cặp (khách, sản phẩm) và khoá dòng user.
CREATE UNIQUE INDEX IF NOT EXISTS "points_transactions_review_return_key"
ON "points_transactions" ("reason")
WHERE "refType" = 'REVIEW' AND "reason" LIKE 'REVIEW_RETURN:%';
