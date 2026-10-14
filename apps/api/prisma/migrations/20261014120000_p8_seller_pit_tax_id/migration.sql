-- SELLER-11: MST/CCCD của CTV để kê khai khấu trừ thuế TNCN; lệnh rút giữ bản chụp số đã kê khai. Cột mới, NULL cho dòng cũ.
ALTER TABLE "payouts" ADD COLUMN     "taxId" TEXT;

ALTER TABLE "users" ADD COLUMN     "personalTaxId" TEXT;
