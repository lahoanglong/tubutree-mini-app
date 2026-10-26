-- Nhiệm vụ do quản trị thêm: loại nhiệm vụ (cách chấm tiến độ) và thời điểm tạm dừng. Hai cột đều cho phép NULL:
-- kind NULL = suy ra từ code như trước (4 nhiệm vụ seed), disabledAt NULL = đang bật.
ALTER TABLE "missions" ADD COLUMN "kind" TEXT;
ALTER TABLE "missions" ADD COLUMN "disabledAt" TIMESTAMP(3);
