-- Chặn 2 request answerQuiz() cùng userId+quizId trả lời trùng trong ngày chạy song song
-- (race: cả 2 đều đọc "chưa trả lời hôm nay" trước khi request đầu commit → cả 2 cùng được
-- cộng waterReward → cày nước bất thường). answerQuiz() bắt P2002 khi tạo GameQuizAttempt với
-- dayKey (UTC+7) → trả đúng lỗi nghiệp vụ cũ ("Bạn đã trả lời câu này hôm nay.").
-- dayKey nullable: bản ghi cũ (trước migration này) giữ NULL, không bị chặn bởi unique index
-- (Postgres coi mỗi NULL là 1 giá trị riêng biệt) — chỉ áp dụng cho các lần trả lời MỚI.
ALTER TABLE "game_quiz_attempts" ADD COLUMN "dayKey" TEXT;
CREATE UNIQUE INDEX "game_quiz_attempts_userId_quizId_dayKey_key" ON "game_quiz_attempts"("userId", "quizId", "dayKey");
