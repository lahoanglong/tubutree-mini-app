# parity-c1 (sửa theo reviewer, gl/1103-parity)

Phát hiện 1 (P2, bộ đếm ghi chú): ĐÃ SỬA. Trả markup gốc (luôn render, `max-md:sr-only`, aria-describedby cố định), bỏ ORDER_NOTE_COUNT_FROM; hai spec unit đổi theo (khẳng định '36/500 ký tự' và '0/500 ký tự', đỏ với mã commit 1b058e180).
Phát hiện 2 (P2, lệch 375): ĐÃ SỬA phần ô tick và chữ radio: miniCheckboxGutter (mr-5), miniRadioGutter (mr-4) ở mobile-ui; e2e đo mép phải ô tick (339) và x chữ Ví Tubu (70) so Mini, dung sai 2px; cả hai nền xanh. KHÔNG SỬA "Chi tiết ›" (sheet chi tiết tính tiền): cần quyết định điều phối (làm sheet web hay ghi nhận có chủ ý).
Phát hiện 3 (P2, bằng chứng): ĐÃ SỬA phần mock/e2e: hai nền dùng cùng mock (ví 350.000đ, 50+50 điểm), so chuỗi đầy đủ pointsSubtext và nhãn ví. CHƯA LÀM ảnh trước/sau persona returning/new, web 1280, bundle-report (nặng, máy quá tải, cấm lane/ảnh).
Phát hiện 4 (P3): ĐÃ CHẠY LẠI phần web: tsc web sạch; vitest web thanh-toan 28 file/297 test xanh (TZ=UTC, maxWorkers=2). Chưa chạy toàn bộ vitest miniapp.
Kiểm: ds-ratchet xanh (baseline page.tsx 69, mobile-ui 39); Playwright ds-parity "thanh toán" 2 ca xanh trên Mini và Web Customer Mobile (workers=1). Next dev tạm và Vite đã tắt, config tạm đã xoá.
