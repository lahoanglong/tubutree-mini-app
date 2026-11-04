# parity-c3 (gl/1103-parity)
1 P1 K2 đỏ: ĐÃ SỬA. Nguyên nhân thật: node 20 ở shell làm worker vitest lỗi webidl che ca đỏ; dùng PATH node 22.23.3. Spec K2 viết lại theo cấu trúc mới.
2 P2 lý do ví: ĐÃ SỬA. Hint nằm trong span cột chữ cùng nhãn (md:hidden), bản dòng riêng (hidden md:block, aria-hidden) cho md+; chỉ nhãn và radio mờ. e2e đo y: Mini 2px, web 4px, dung sai 2.
3 P2 Điểm Xanh: ĐÃ SỬA. pointNotes: bên trong cột chữ ở 375 (mt-0.5, tertiary), phụ đề đổi tertiary; md+ giữ dòng riêng. e2e khẳng định không còn dòng riêng nhìn thấy.
4 P2 Chi tiết/sheet: KHÔNG SỬA, cần điều phối chốt (a) làm sheet hay (b) ghi chủ ý khác.
5 P2 ảnh before/after persona returning/new + bundle-report: KHÔNG LÀM (cần lane API thật, máy tải); nợ chặn deploy. Đã cập nhật 4 ảnh sau ở screens-parity.
6 P3 gutter: ĐÃ SỬA mr-[1.125rem] (18px, rem để qua px-ratchet); bỏ miniRadioHintIndent.
Kiểm: tsc web sạch; vitest web 562 file / 9575 test xanh, 0 lỗi worker (TZ=UTC, maxWorkers=2); ds-ratchet xanh (max-md 69→68, baseline hạ); Playwright ds-parity "thanh toán 375px" 4/4 xanh (Mini+web, workers=1) TRƯỚC chỉnh cuối đổi max-md:hidden → hidden md:block (chỉ lớp hiển thị); chưa chạy lại Playwright sau chỉnh đó.
