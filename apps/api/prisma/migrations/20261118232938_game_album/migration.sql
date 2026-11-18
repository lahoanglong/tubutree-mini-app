-- Sổ tay Xanh: bảng ván "Ôn 5 thẻ" (không thưởng, tách khỏi game_play_rounds) và cờ mặc định TẮT. Chỉ cộng: bảng mới, chỉ mục mới,
-- dòng cờ chỉ thêm khi chưa có (không đổi giá trị admin đã đặt). Ảnh cũ không đọc bảng này nên chạy được với DB mới.
CREATE TABLE "game_album_reviews" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dayKey" TEXT NOT NULL,
    "contentIds" TEXT[],
    "correctIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "questions" JSONB NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "correct" INTEGER,
    "total" INTEGER,

    CONSTRAINT "game_album_reviews_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "game_album_reviews_userId_dayKey_idx" ON "game_album_reviews"("userId", "dayKey");

ALTER TABLE "game_album_reviews" ADD CONSTRAINT "game_album_reviews_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "system_configs" ("key", "value", "description", "category", "updatedAt") VALUES
  ('game.album_enabled', 'false'::jsonb, 'Sổ tay Xanh trong Vườn Xanh: mỗi kiến thức đã gặp trong game mini thành một thẻ có nguồn, chế độ "Ôn 5 thẻ" không thưởng, 3 huy hiệu thuộc bài (0 điểm). Cần thêm game.mini.enabled. Tắt thì API sổ trả 404 và dòng lối vào ẩn.', 'game', NOW())
ON CONFLICT ("key") DO NOTHING;
