-- Vườn Xanh 2.0 — Lô đất / mở rộng vườn (§6.7).
-- Lô nhà (slot 0) vẫn là cây trong game_profiles; bảng này lưu các lô PHỤ (slot 1..).
-- Mỗi lô là 1 cây độc lập (progress/target/treeStage) tưới & thu hoạch riêng.

CREATE TABLE "garden_plots" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "slot" INTEGER NOT NULL,
    "treeType" TEXT NOT NULL DEFAULT 'Cây Dứa Fuwa3e',
    "speciesId" TEXT,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "target" INTEGER NOT NULL DEFAULT 600,
    "treeStage" INTEGER NOT NULL DEFAULT 1,
    "treesPlanted" INTEGER NOT NULL DEFAULT 0,
    "lastWateredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "garden_plots_pkey" PRIMARY KEY ("id")
);

-- Mỗi user mỗi slot chỉ 1 lô (chống mở trùng slot khi 2 lệnh song song).
CREATE UNIQUE INDEX "garden_plots_userId_slot_key" ON "garden_plots"("userId", "slot");
CREATE INDEX "garden_plots_userId_idx" ON "garden_plots"("userId");

ALTER TABLE "garden_plots" ADD CONSTRAINT "garden_plots_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
