# parity-c2 (gl/1103-parity)

1 (P2, câu lý do lệch 16px): ĐÃ SỬA. Hằng miniRadioHintIndent ('pl-[3.25rem] md:pl-0' = 24+16+12) cạnh miniRadioGutter. Ca e2e mới (ví 50.000đ, đơn 149.000đ) đo x câu lý do so x nhãn và so Mini 70, dung sai 2px. Mã cũ (pl-9): đỏ "52 so với nhãn 68". Mã mới: xanh cả Mini lẫn web 375.
2 (P2, baseline nới): ĐÃ SỬA. Gutter viết 'mr-5 md:mr-0' / 'mr-4 md:mr-0', baseline mobile-ui về 37 (bằng gốc). ds-ratchet xanh.
3 (P2, "Chi tiết ›" + sheet): KHÔNG SỬA, cần điều phối chốt: (a) làm sheet "Chi tiết tính tiền" trên web 375 (giữ 1280), hay (b) ghi "chủ ý khác" vào brief và để ds-parity khẳng định. Đây là tính năng mới, không phải sửa lệch.
4 (P2, bằng chứng): MỘT PHẦN. Ảnh mới sau commit gutter, cùng mock hai nền: screens-parity/checkout-form-{miniapp,web}375.png và checkout-wallet-blocked-{miniapp,web}375.png (đã xem: nhãn và câu lý do thẳng cột ở web; Mini xếp hint sát nhãn, web cách dòng, chủ yếu khác khoảng dọc). CHƯA LÀM: persona returning/new, web 1280, before-after.mjs, vite build + bundle-report. Lý do: cần lane API thật, máy tải 50+, brief cấm. Còn nợ nếu điều phối cần.
5 (P3, nền câu đồng ý): KHÔNG SỬA, ghi chủ ý: brief giữ câu sát nút như web, nền khác là hệ quả; đổi nền dễ vỡ khoảng cách đã đo.
Kiểm: tsc web sạch; vitest web toàn bộ 152 file / 2852 test xanh (TZ=UTC, maxWorkers=2; có lỗi môi trường "webidl.util.markAsUncloneable" ở worker, không liên quan); ds-ratchet xanh; Playwright ds-parity "thanh toán" 6/6 xanh (workers=1). Next dev + Vite tạm đã tắt, config tạm đã xoá.
