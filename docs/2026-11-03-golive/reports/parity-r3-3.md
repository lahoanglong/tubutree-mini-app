# parity r3-3

Phát hiện P2 (thanh-toan/page.tsx: thiếu "Chi tiết ›" và sheet ở 375): ĐÃ SỬA theo cách (a) vì quyết định 23:40 giữ lệch 375 là P2.
- Dưới md: tiêu đề "Tóm tắt đơn hàng" có nút "Chi tiết ›" (màu brand, min-h 44px) mở Sheet "Chi tiết tính tiền đơn hàng" cùng nhãn dòng và nút "Đã hiểu" như Mini; từ md giữ như cũ.
- Test đỏ với mã cũ (checkout-mini.spec.tsx, ca mới), xanh sau sửa.
- vitest apps/web/src/app/thanh-toan: 28 file, 300 test xanh. tsc web xanh, check-platform-parity và check-ds-parity xanh.
- Ghi chú: ds-ratchet max-md của thanh-toan/page.tsx đã đỏ từ trước (71 so với baseline 68, do các commit r3-2); thay đổi này net 0 (max-md:block thành max-md:flex). Chưa hạ.
- Không chạy Playwright/lane.
