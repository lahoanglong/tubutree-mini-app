-- P0 A3-05 (phần voucher sinh nhật): cho phép mỗi hạng thành viên có mức voucher sinh nhật
-- riêng thay vì 1 mức chung cho mọi hạng. null = dùng voucher.birthday_amount (SystemConfig).
ALTER TABLE "membership_tiers" ADD COLUMN "birthdayVoucherAmount" INTEGER;
