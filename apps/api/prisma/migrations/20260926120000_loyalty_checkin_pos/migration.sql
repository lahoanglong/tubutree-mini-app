-- Loyalty: điểm danh hằng ngày + tích điểm hoá đơn tại quầy (POS) — hardening bản WIP "CNV Loyalty Parity".
--
-- 1) loyalty_check_ins: trạng thái điểm danh RIÊNG của loyalty. Bản WIP ghi thẳng vào
--    game_profiles.lastCheckInAt/streakDays (của điểm danh Vườn Xanh, game-economy.service.ts) →
--    điểm danh bên này chặn bên kia trong ngày, vòng 7 ngày ghi đè chuỗi game (mất vé giữ lửa /
--    hồi sinh chuỗi), và KHÔNG có ràng buộc DB nào nên 10 request song song = cộng điểm 10 lần.
--    Unique (userId, dayKey) — dayKey 'YYYY-MM-DD' theo giờ VN — là chốt chặn cứng.
--
-- 2) pos_point_credits: sổ ghi vết mỗi lần nhân viên tích điểm hoá đơn tại quầy (ai cộng, cho ai,
--    hoá đơn nào, bao nhiêu). receiptId unique = khoá idempotency (retry mạng/bấm đúp không cộng lần 2).
--
-- 3) Partial unique trên points_transactions (phòng thủ nhiều lớp, cùng kiểu
--    coin_transactions_convert_ref_key):
--    - CHECKIN: ("userId","refId") với refId = dayKey → tối đa 1 dòng điểm danh/user/ngày.
--    - POS:     ("refId") với refId = pos_point_credits.id → 1 lần tích POS đúng 1 dòng điểm.
--
-- An toàn với dữ liệu hiện có: chỉ TẠO MỚI bảng/index. Chưa có dòng points_transactions nào mang
-- refType 'CHECKIN'/'POS' (bản WIP chưa từng deploy và ghi refType NULL; game dùng 'GAME') nên
-- partial unique không thể đụng dữ liệu cũ. IF NOT EXISTS để chạy lại an toàn.
-- KHÔNG đọc/ghi game_profiles.

CREATE TABLE IF NOT EXISTS "loyalty_check_ins" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dayKey" TEXT NOT NULL,
    "cycleDay" INTEGER NOT NULL,
    "streakDays" INTEGER NOT NULL,
    "points" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loyalty_check_ins_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "pos_point_credits" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "staffUserId" TEXT NOT NULL,
    "orderTotal" INTEGER NOT NULL,
    "points" INTEGER NOT NULL,
    "multiplier" DECIMAL(65,30) NOT NULL,
    "note" TEXT,
    "dayKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pos_point_credits_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "loyalty_check_ins_userId_dayKey_key"
  ON "loyalty_check_ins"("userId", "dayKey");

CREATE UNIQUE INDEX IF NOT EXISTS "pos_point_credits_receiptId_key"
  ON "pos_point_credits"("receiptId");

CREATE INDEX IF NOT EXISTS "pos_point_credits_staffUserId_dayKey_idx"
  ON "pos_point_credits"("staffUserId", "dayKey");

CREATE INDEX IF NOT EXISTS "pos_point_credits_memberId_dayKey_idx"
  ON "pos_point_credits"("memberId", "dayKey");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'loyalty_check_ins_userId_fkey') THEN
    ALTER TABLE "loyalty_check_ins" ADD CONSTRAINT "loyalty_check_ins_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_point_credits_memberId_fkey') THEN
    ALTER TABLE "pos_point_credits" ADD CONSTRAINT "pos_point_credits_memberId_fkey"
      FOREIGN KEY ("memberId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_point_credits_staffUserId_fkey') THEN
    ALTER TABLE "pos_point_credits" ADD CONSTRAINT "pos_point_credits_staffUserId_fkey"
      FOREIGN KEY ("staffUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "points_transactions_checkin_day_key"
  ON "points_transactions"("userId", "refId")
  WHERE "refType" = 'CHECKIN' AND "refId" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "points_transactions_pos_ref_key"
  ON "points_transactions"("refId")
  WHERE "refType" = 'POS' AND "refId" IS NOT NULL;
