# pdp-ci: sửa CI đỏ PR #139 (run 41675697543), nhánh gl/1103-pdp

Commit: xem `git log -1` trên gl/1103-pdp (test(e2e): sửa hai spec PDP/phiếu đỏ trên CI Linux). Chỉ sửa test, không đổi giao diện.

## Nguyên nhân và bằng chứng
1. pdp-flash-note-cls.miniapp (perUserLeft 0): đỏ cả trên máy Mac khi tải cao (129px), không phải riêng Linux. Test đo "trước" ngay khi giá Giờ vàng hiện, lúc đăng nhập khôi phục chưa xong: vùng ghi chú chưa giữ chỗ (cao 0, `reserveFlashNote` cần status authenticated) và một khối 76px phía trên chưa vào. Khi đăng nhập xong, các thay đổi đó (53px + 76px) bị tính nhầm cho ghi chú. In DOM trước/sau: slot h0 -> h53, khối mới 76px trên slot. Đây là lần đổi pha đăng nhập (đã ghi nhận ở pdp-c1 P3), không phải ghi chú.
2. voucher-ticket-height.web x4 (TUBU99, rồi NHANLOCXANH2026 ở ca Nhận mã): fixture TUBU99 "Giảm 99%, tối đa 999k" chỉ vừa khít cột nội dung 159,5px trên Mac (hàng đáy 158,7/159,5px, đo local), dư chưa tới 1px. Trên Linux (hinting khác, và ngày hạn đổi theo ngày chạy) nhãn gãy 2 dòng + hàng đáy gãy: 120px. Trace CI xác nhận Inter đã tải (không phải lỗi chờ phông) và hàng đáy gãy thật ("Dùng đến 13/12 ·" / "TUBU99"). Ép Chromium `--disable-font-subpixel-positioning` trên Mac vẫn xanh nên không tái hiện được trực tiếp; kết luận dựa trên số đo dư chỗ + khớp số đo CI (120 = 98 + 22 của một dòng nhãn). Giả thuyết này là suy luận, chưa chạy được Linux thật.

## Sửa
- pdp-flash-note-cls.miniapp.spec.ts: chờ phông, chờ vùng ghi chú có chiều cao (đăng nhập xong) trước khi đo; đo khoảng cách tương đối khối neo - vùng ghi chú; CLS bằng `readShiftBelow` (chỉ phần do ghi chú).
- support/voucher-ticket-checks.ts: TUBU99 maxDiscount 999_000 -> 99_000 (nhãn "tối đa 99k", dư ~8px). Ngưỡng 88/96/104 giữ nguyên. Bộ mock dùng chung với Mini spec.

## Kiểm
- Mini pdp-flash-note-cls: trước sửa đỏ 129px; sau sửa 3/3 xanh x3 lần liên tiếp. Làm hỏng có chủ đích (bỏ minHeight giữ chỗ) -> 2 ca đỏ; hoàn lại.
- Web voucher-ticket-height (web-gate, 2 project, --repeat-each=3): 24 passed. Làm hỏng có chủ đích (đệm phải thân phiếu 40px) -> đỏ NHAN10 120px và NHANLOCXANH2026 158px; hoàn lại.
- Mini voucher-ticket-height.miniapp: 4 passed. tsc e2e sạch.
- Lane 3 không bật (chạy qua web-gate cổng 3921-3925, đã dừng). Chưa chạy Linux thật: cần CI để xác nhận.

## Lượt 2 (run 41685346841: còn đỏ voucher-ticket-height.web:43, NHANLOCXANH2026 158px, hàng đáy 60px)
- Nguyên nhân (đã tái hiện): KHÔNG phải riêng web. Hàng đáy phiếu "Dùng đến 09/11 · | Còn 3 lượt · | NHANLOCXANH2026" nằm trong cột 179,4px (cả Mini và web: nút "Lưu mã" 67px). Hạn+lượt = 102,2 + 4 (gap) + 71,3 = 177,5px: dư 1,9px. Chữ Linux Chromium rộng hơn vài phần trăm thì lượt rớt dòng: 3 dòng. Trace CI + ảnh xác nhận 3 dòng ("Dùng đến 09/11 ·" / "Còn 3 lượt ·" / mã), không có phông mono, không phải nút. Mini WebKit trên CI vẫn xanh vì còn vừa khít, không vì khác thiết kế.
- Tái hiện trên Mac: thêm letter-spacing 0,1px cho hàng đáy vào chính spec Mini cho đúng thông báo CI (158px, hàng đáy 60px). Bản cũ đỏ ở 0,1px; bản sửa xanh tới 0,3px, đỏ ở 0,4px (dung sai ~4% chữ rộng hơn, trước ~1%).
- Sửa (cả hai bản component, vẫn giống nhau): đệm phải thân phiếu 10 -> 4px, cách giữa các mục hàng đáy 4 -> 2px (`--p-space-1`): thêm 8px chỗ. Không đổi mock.
- Kiểm: Mini voucher-ticket-height + vouchers.miniapp 33 passed (x3); web-gate voucher-ticket-height 24 passed (2 project x3); vitest miniapp 68 + web 426 xanh; tsc miniapp, web sạch; lint:parity xanh. Ảnh 375 web vs Mini: chưa chụp (cùng component, đổi 6px đệm). Chưa có Linux thật: chờ CI.
