-- Lõi game mini (5 game "Lượt chơi có thưởng"): chỉ CỘNG bảng/cột/chỉ mục mới và dòng cấu hình mặc định TẮT.
-- Ảnh cũ chạy được với DB này (không đổi bảng cũ ngoài 2 cột nullable của game_quizzes).

-- AlterTable
ALTER TABLE "game_quizzes" ADD COLUMN     "productSlug" TEXT,
ADD COLUMN     "sourceUrl" TEXT;

-- CreateTable
CREATE TABLE "game_play_rounds" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "game" TEXT NOT NULL,
    "dayKey" TEXT NOT NULL,
    "slot" INTEGER,
    "contentIds" TEXT[],
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "correct" INTEGER,
    "total" INTEGER,
    "correctIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "waterAwarded" INTEGER NOT NULL DEFAULT 0,
    "pointsAwarded" INTEGER NOT NULL DEFAULT 0,
    "cappedBy" TEXT,
    "deviceHash" TEXT,

    CONSTRAINT "game_play_rounds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_content_items" (
    "id" TEXT NOT NULL,
    "game" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "explanation" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "sourceCheckedAt" DATE,
    "productSlug" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "game_content_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_daily_ledger" (
    "userId" TEXT NOT NULL,
    "dayKey" TEXT NOT NULL,
    "waterFromGames" INTEGER NOT NULL DEFAULT 0,
    "pointsFromGames" INTEGER NOT NULL DEFAULT 0,
    "rewardedRounds" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "game_daily_ledger_pkey" PRIMARY KEY ("userId","dayKey")
);

-- CreateTable
CREATE TABLE "game_device_daily" (
    "deviceHash" TEXT NOT NULL,
    "dayKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "game_device_daily_pkey" PRIMARY KEY ("deviceHash","dayKey","userId")
);

-- CreateTable
CREATE TABLE "game_global_daily" (
    "dayKey" TEXT NOT NULL,
    "pointsMinted" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "game_global_daily_pkey" PRIMARY KEY ("dayKey")
);

-- CreateIndex
CREATE INDEX "game_play_rounds_userId_dayKey_game_idx" ON "game_play_rounds"("userId", "dayKey", "game");

-- CreateIndex
CREATE INDEX "game_play_rounds_game_dayKey_idx" ON "game_play_rounds"("game", "dayKey");

-- CreateIndex
CREATE INDEX "game_content_items_game_active_idx" ON "game_content_items"("game", "active");

-- AddForeignKey
ALTER TABLE "game_play_rounds" ADD CONSTRAINT "game_play_rounds_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_daily_ledger" ADD CONSTRAINT "game_daily_ledger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_device_daily" ADD CONSTRAINT "game_device_daily_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Số đếm không bao giờ âm; slot đánh từ 1.
ALTER TABLE "game_play_rounds" ADD CONSTRAINT "game_play_rounds_slot_positive" CHECK ("slot" IS NULL OR "slot" >= 1);
ALTER TABLE "game_play_rounds" ADD CONSTRAINT "game_play_rounds_awards_nonneg" CHECK ("waterAwarded" >= 0 AND "pointsAwarded" >= 0);
ALTER TABLE "game_daily_ledger" ADD CONSTRAINT "game_daily_ledger_nonneg" CHECK ("waterFromGames" >= 0 AND "pointsFromGames" >= 0 AND "rewardedRounds" >= 0);
ALTER TABLE "game_global_daily" ADD CONSTRAINT "game_global_daily_nonneg" CHECK ("pointsMinted" >= 0);

-- Mỗi ô ván có thưởng (user, game, ngày VN, slot) chỉ một ván. Ván không thưởng (slot NULL) không giới hạn.
CREATE UNIQUE INDEX "game_play_rounds_reward_slot_key" ON "game_play_rounds" ("userId", "game", "dayKey", "slot") WHERE "slot" IS NOT NULL;

-- Điểm Xanh game mini: tối đa một dòng sổ cho mỗi ván (refId = id ván). Lệnh cộng dùng ON CONFLICT DO NOTHING trên chỉ mục này.
CREATE UNIQUE INDEX "points_transactions_game_mini_ref_key" ON "points_transactions" ("refType", "refId") WHERE "refType" = 'GAME_MINI';

-- Cờ và trần mặc định. Chỉ thêm khi chưa có dòng, không đổi giá trị admin đã đặt.
INSERT INTO "system_configs" ("key", "value", "description", "category", "updatedAt") VALUES
  ('game.mini.enabled', 'false'::jsonb, 'Bật 5 game mini có thưởng (Đúng Thùng, Đố Xanh, Ghép Cặp, Đoán Xuất Xứ, Giỏ Đúng Việc). Tắt thì API trả 404 GAME_DISABLED và lối vào ẩn.', 'game', NOW()),
  ('game.mini.sort.enabled', 'false'::jsonb, 'Bật game Đúng Thùng (phân loại rác); cần thêm game.mini.enabled.', 'game', NOW()),
  ('game.mini.daily_quiz.enabled', 'false'::jsonb, 'Bật game Đố Xanh Mỗi Ngày; làm xong tính là điểm danh của ngày. Cần thêm game.mini.enabled.', 'game', NOW()),
  ('game.mini.match.enabled', 'false'::jsonb, 'Bật game Ghép Cặp Nguyên Liệu – Công Dụng; cần thêm game.mini.enabled.', 'game', NOW()),
  ('game.mini.origin.enabled', 'false'::jsonb, 'Bật game Đoán Xuất Xứ; cần thêm game.mini.enabled.', 'game', NOW()),
  ('game.mini.basket.enabled', 'false'::jsonb, 'Bật game Giỏ Đúng Việc; cần thêm game.mini.enabled.', 'game', NOW()),
  ('game.mini.rounds_per_game_per_day', '2'::jsonb, 'Số ván có thưởng mỗi game mỗi ngày (Đố Xanh tối đa 1 vì cùng bộ câu cả ngày); chơi tiếp vẫn được, không thưởng. 0–10.', 'game', NOW()),
  ('game.mini.water_daily_cap', '40'::jsonb, 'Tổng 💧 từ 5 game mini mỗi tài khoản mỗi ngày. 0–200.', 'game', NOW()),
  ('game.mini.points_daily_cap', '100'::jsonb, 'Tổng Điểm Xanh từ 5 game mini mỗi tài khoản mỗi ngày (1 điểm = 1đ). 0–500.', 'game', NOW()),
  ('game.mini.accounts_per_device_per_day', '2'::jsonb, 'Số tài khoản được thưởng game mini trên cùng một thiết bị mỗi ngày (lớp ma sát: mã thiết bị do ứng dụng gửi). 1–10.', 'game', NOW()),
  ('game.mini.global_points_daily_budget', '200000'::jsonb, 'Tổng Điểm Xanh game mini phát cho mọi tài khoản mỗi ngày; chạm trần thì các ván sau chỉ nhận 💧. 0–1.000.000.', 'game', NOW()),
  ('game.mini.min_account_age_hours', '0'::jsonb, 'Tài khoản tạo chưa đủ số giờ này thì chơi game mini không có thưởng (0 = không chặn). 0–720.', 'game', NOW())
ON CONFLICT ("key") DO NOTHING;
