-- Huy hiệu ghi nhận (0 điểm): mỗi (khách, huy hiệu) một dòng, cấp bằng INSERT ... ON CONFLICT DO NOTHING.
CREATE TABLE "user_badges" (
    "userId" TEXT NOT NULL,
    "badge" TEXT NOT NULL,
    "earnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_badges_pkey" PRIMARY KEY ("userId","badge")
);

ALTER TABLE "user_badges" ADD CONSTRAINT "user_badges_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Nhiệm vụ hằng ngày: dòng mẫu trong "missions" để "mission_progress" (userId, missionId, cycleKey = ngày VN) làm khoá nhận thưởng.
-- "disabledAt" luôn có giá trị: image cũ chỉ đọc nhiệm vụ "disabledAt" IS NULL, nên không vẽ các dòng này thành nhiệm vụ một lần và
-- không cho nhận qua đường cũ. Bật/tắt bằng cờ engagement.daily_missions_enabled. Thưởng không nằm ở "rewardPoints" mà đi qua sổ
-- ngày game mini (game_daily_ledger).
INSERT INTO "missions" ("id", "code", "title", "description", "rewardPoints", "goal", "isRepeatable", "kind", "disabledAt") VALUES
  ('daily-quiz', 'DAILY_QUIZ', 'Hôm nay: Đố Xanh', 'Làm xong Đố Xanh hôm nay', 0, 1, true, 'DAILY_QUIZ', '2026-11-17 00:00:00'),
  ('daily-play', 'DAILY_PLAY', 'Hôm nay: chơi một trò', 'Chơi xong một trò bất kỳ ở Vườn Xanh hôm nay', 0, 1, true, 'DAILY_PLAY', '2026-11-17 00:00:00'),
  ('daily-story', 'DAILY_STORY', 'Hôm nay: xem một sản phẩm', 'Mở trang một sản phẩm bất kỳ hôm nay', 0, 1, true, 'DAILY_STORY', '2026-11-17 00:00:00'),
  ('daily-wishlist', 'DAILY_WISHLIST', 'Hôm nay: thêm vào yêu thích', 'Thêm một món vào Yêu thích hôm nay', 0, 1, true, 'DAILY_WISHLIST', '2026-11-17 00:00:00'),
  ('daily-water', 'DAILY_WATER', 'Hôm nay: tưới cây', 'Tưới cây ở Vườn Xanh hôm nay', 0, 1, true, 'DAILY_WATER', '2026-11-17 00:00:00'),
  ('daily-bonus', 'DAILY_BONUS', 'Hôm nay: xong cả 3 nhiệm vụ', 'Thưởng thêm khi nhận đủ 3 nhiệm vụ của ngày', 0, 1, true, 'DAILY_BONUS', '2026-11-17 00:00:00')
ON CONFLICT DO NOTHING;

-- Cờ mặc định TẮT. Chỉ thêm khi chưa có dòng, không đổi giá trị admin đã đặt.
INSERT INTO "system_configs" ("key", "value", "description", "category", "updatedAt") VALUES
  ('engagement.daily_missions_enabled', 'false'::jsonb, 'Bật 3 nhiệm vụ hằng ngày ở thẻ Nhiệm vụ (Vườn Xanh) và chấm nhắc ở thanh đáy. Chỉ chạy khi game.mini.enabled cũng bật: thưởng 💧 và Điểm Xanh tính chung trần, tuổi tài khoản tối thiểu và công tắc tổng của game mini.', 'engagement', NOW()),
  ('engagement.badges_enabled', 'false'::jsonb, 'Bật hàng 8 huy hiệu ở màn Cá nhân (0 điểm, chỉ ghi nhận). Tắt thì không cấp huy hiệu mới và không hiện hàng.', 'engagement', NOW())
ON CONFLICT ("key") DO NOTHING;
