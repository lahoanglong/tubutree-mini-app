-- Đơn bị trả mà hoa hồng đã vào Ví Tubu của CTV thì trừ thẳng Ví (số dư có thể âm) bằng dòng sổ loại COMMISSION_REVERSAL.
-- Additive: thêm một giá trị enum và một cột rỗng. Image cũ KHÔNG đọc được dòng sổ ví loại COMMISSION_REVERSAL (Prisma báo
-- enum lạ khi đọc sao kê/số dư), và giá trị enum đã thêm không gỡ được: khi đã có dòng này thì quay image không an toàn, đường
-- quay lại là khôi phục backup (runbook 7.3). Vì vậy migration này không nằm trong IMAGE_COMPATIBLE_MIGRATIONS.
ALTER TYPE "WalletTxType" ADD VALUE 'COMMISSION_REVERSAL';

-- Lệnh chuyển hoa hồng vào Ví (payouts) đã chứa hoa hồng này. Khi đơn bị trả, Ví CTV chỉ bị trừ phần thực nhận của hoa hồng (sau thuế
-- TNCN khấu trừ của lệnh chuyển gốc), nên cần biết lệnh nào. Hoa hồng PAID cũ để NULL: mã tra lệnh chuyển Ví gần nhất trước lúc PAID.
ALTER TABLE "commissions" ADD COLUMN "walletPayoutId" TEXT;
