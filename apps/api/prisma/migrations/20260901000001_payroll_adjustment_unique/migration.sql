-- Chặn tạo trùng khoản phạt LATE/LATE_CANCEL cho cùng 1 ca khi 2 request recompute payroll
-- (vd 2 tab GET /staff/payroll) chạy song song: cả 2 đọc "chưa có phạt" trước khi request đầu
-- commit → tạo 2 dòng → payroll.calc trừ phạt 2 lần, sai lương. ensureAdjustment() bắt P2002.
-- shiftId NULL (khoản MANUAL do admin `adjust()` tạo, không gắn ca) không bị chặn — Postgres
-- coi NULL khác nhau trong unique index, đúng ý: MANUAL vẫn tạo được nhiều dòng/ngày.
CREATE UNIQUE INDEX "payroll_adjustments_shift_type_key"
  ON "payroll_adjustments"("shiftId", "type");
