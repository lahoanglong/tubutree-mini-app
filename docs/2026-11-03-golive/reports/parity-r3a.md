# parity-r3a
- P2 opacity-60 trong label Điểm Xanh: ĐÃ SỬA (commit trên gl/1103-parity). Label chỉ `md:opacity-60`; dưới md chỉ ô tick và 2 dòng tiêu đề/phụ đề mờ. Test mới đỏ với mã cũ, xanh sau sửa.
- P2 sheet "Chi tiết ›": KHÔNG SỬA, cần phiên điều phối chọn (a) làm sheet hay (b) ghi chủ ý khác; Mini vẫn có, web 375 chưa.
- P2 ảnh trước/sau, bundle: theo quyết định 23:40, ảnh do điều phối chụp tập trung, không còn chặn. Số First Load web chưa đo lại (chỉ đổi className).
- P3 e2e ds-parity 375: chưa chạy (cần lane); rủi ro thấp, chưa chạy lại.
- P3 aria-describedby đọc đôi: không sửa, giống Mini.
Test: vitest apps/web src/app/thanh-toan 28 file / 298 test xanh (maxWorkers=2); tsc web sạch.
