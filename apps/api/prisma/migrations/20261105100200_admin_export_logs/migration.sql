-- Bảng mới, chỉ thêm: không đụng dữ liệu cũ.
CREATE TABLE "admin_export_logs" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "filters" JSONB NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_export_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "admin_export_logs_actorId_createdAt_idx" ON "admin_export_logs"("actorId", "createdAt");

CREATE INDEX "admin_export_logs_createdAt_idx" ON "admin_export_logs"("createdAt");
