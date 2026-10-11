-- PD-3 (spec 3.4): khoá TubuXu ở DB sau khi mọi đường ghi xu đã gỡ (checkout XU, hoàn đơn XU, mở lô,
-- góp quỹ, đổi Ví → xu, thưởng). Đường ghi xu nào còn sót sẽ nổ 23514 trong tx và rollback cả thao tác,
-- thay vì âm thầm sinh xu mới. Chỉ THÊM ràng buộc, không đổi/xoá dữ liệu.
--
-- Ràng buộc kiểm mọi dòng hiện có: còn user coinsBalance <> 0 (migration B không quy đổi được, xem báo cáo
-- PD-3 L1 "Khác spec" 1) thì migration dừng deploy cho tới khi đối soát tay — cố ý, cùng kiểu RAISE của B.
--
-- Kiểm tồn tại theo bảng ("users"::regclass theo search_path) chứ không theo tên toàn DB: pg_constraint
-- không lọc schema, chỉ lọc conname thì schema khác có cùng tên ràng buộc làm khối này bỏ qua nhầm.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'users_coins_frozen' AND conrelid = '"users"'::regclass
  ) THEN
    ALTER TABLE "users" ADD CONSTRAINT "users_coins_frozen" CHECK ("coinsBalance" = 0);
  END IF;
END $$;
