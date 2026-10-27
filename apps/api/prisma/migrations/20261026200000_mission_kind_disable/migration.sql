-- Nhiệm vụ do quản trị thêm: loại nhiệm vụ (cách chấm tiến độ), thời điểm tạm dừng và mốc bắt đầu tính. Ba cột đều cho phép NULL:
-- kind NULL = suy ra từ code như trước (4 nhiệm vụ seed), disabledAt NULL = đang bật, startsAt NULL = tính trọn đời.
ALTER TABLE "missions" ADD COLUMN "kind" TEXT;
ALTER TABLE "missions" ADD COLUMN "disabledAt" TIMESTAMP(3);
ALTER TABLE "missions" ADD COLUMN "startsAt" TIMESTAMP(3);
