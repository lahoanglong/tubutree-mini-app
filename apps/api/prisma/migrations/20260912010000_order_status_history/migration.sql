-- Sổ ghi vết đổi trạng thái đơn hàng.
--
-- Trước đây đổi trạng thái chỉ để lại một dòng log ứng dụng (xoay vòng theo container) và một
-- chuỗi note nối thêm, không có actor. Một tài khoản admin bị chiếm chuyển 50 đơn đã giao sang
-- CANCELLED là mỗi đơn tự động hoàn tổng tiền vào ví khách, mà sau đó không truy được admin nào
-- thao tác đơn nào.
--
-- An toàn với dữ liệu hiện có: chỉ TẠO MỚI bảng, không sửa/xoá cột nào. Lịch sử cũ không có nên
-- bảng bắt đầu rỗng; mọi lần đổi trạng thái từ sau khi deploy đều được ghi.
CREATE TABLE IF NOT EXISTS "order_status_history" (
  "id"         TEXT NOT NULL,
  "orderId"    TEXT NOT NULL,
  "fromStatus" TEXT NOT NULL,
  "toStatus"   TEXT NOT NULL,
  "actorType"  TEXT NOT NULL,
  "actorId"    TEXT,
  "note"       TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "order_status_history_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "order_status_history_orderId_createdAt_idx"
  ON "order_status_history" ("orderId", "createdAt");
