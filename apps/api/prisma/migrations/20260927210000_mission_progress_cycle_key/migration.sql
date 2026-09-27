-- A1-02 (docs/audit-2026-09/01-ia-navigation.md): mission_progress tồn tại trong schema từ bản
-- init nhưng KHÔNG nơi nào trong code đọc/ghi — thẻ nhiệm vụ Vườn Xanh hiện "+20đ/+30đ/+50đ" và
-- dấu ✓ khi đạt điều kiện nhưng không có đường cộng thưởng nào. Migration này biến bảng thành khoá
-- idempotency thật cho GameService.claimMission().
--
-- cycleKey phân biệt các lượt NHẬN LẶP LẠI của nhiệm vụ isRepeatable (vd CHECKIN_7 — mỗi 7 ngày
-- streak mới lại được nhận 1 lần); nhiệm vụ không lặp lại dùng cycleKey cố định '0'. Bảng hiện có
-- 0 dòng (chưa từng được ghi) nên thêm cột NOT NULL DEFAULT + đổi index là an toàn tuyệt đối.
ALTER TABLE "mission_progress" ADD COLUMN     "cycleKey" TEXT NOT NULL DEFAULT '0';

-- DropIndex
DROP INDEX "mission_progress_userId_idx";

-- CreateIndex — unique(userId, missionId, cycleKey) là khoá double-claim THẬT: claimMission()
-- insert dòng này TRƯỚC khi cộng thưởng trong cùng transaction; request thua race (double-tap hoặc
-- 2 request đồng thời) ăn P2002 trên unique này → rollback toàn bộ tx → không cộng thưởng 2 lần.
CREATE UNIQUE INDEX "mission_progress_userId_missionId_cycleKey_key" ON "mission_progress"("userId", "missionId", "cycleKey");
