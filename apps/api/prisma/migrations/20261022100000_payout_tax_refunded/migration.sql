-- Q2b: admin từ chối một lệnh rút hoa hồng làm thuế TNCN cộng dồn của tháng giảm thì phần thuế đã giữ dư ở các lệnh khác trong
-- tháng tự hoàn. Lệnh đã duyệt/đã chi hoàn vào Ví Tubu (loại sổ PIT_REFUND) và ghi vào payouts."taxRefunded"; lệnh còn "Yêu cầu"
-- giảm thẳng taxWithheld. Additive: cột có default hằng (Postgres 11+ không viết lại bảng), thêm một giá trị enum; image cũ
-- không đọc cột mới và không bao giờ ghi giá trị enum mới.
ALTER TYPE "WalletTxType" ADD VALUE 'PIT_REFUND';

ALTER TABLE "payouts" ADD COLUMN "taxRefunded" INTEGER NOT NULL DEFAULT 0;
