# parity r3-2 (sửa theo reviewer Opus), nhánh gl/1103-parity, commit 631e93e2a

1. P2 ô Điểm Xanh khoá mờ chữ (page.tsx 782-783): ĐÃ SỬA. Bỏ max-md:opacity-60 ở tiêu đề và phụ đề; chỉ ô tick (miniCheckboxWrap) mờ ở 375, md:opacity-60 ở label giữ cho 1280. Ca mới trong points-label.spec.tsx đỏ với mã cũ (class "max-md:opacity-60" còn trên span tiêu đề), xanh sau sửa.
2. P2 thiếu nút "Chi tiết ›" + sheet chi tiết tính tiền ở web 375: CHƯA SỬA, cần điều phối chốt (a) thêm nút + sheet dưới md, hoặc (b) ghi "chủ ý khác" vào brief kèm ca ds-parity. Chưa chốt thì không merge.
3. P2 bằng chứng:
   - Playwright ds-parity.shop.spec.ts -g "thanh toán 375", Web Customer Mobile, qua web-gate.sh (cổng 3940/3941/3942, --workers=1): 2 passed. Mini (Zalo Mini App, mock): 2 passed.
   - next build web /thanh-toan First Load: gốc 52fd5cd65 = 245 kB (route 20.6 kB), nhánh = 246 kB (route 20.6 kB); shared 103 kB gốc, 104 kB nhánh (làm tròn; chênh ~1 kB, dưới ngưỡng +2 KB).
4. P3 mờ phương thức thanh toán khoá: ĐÃ SỬA. radio và nhãn: max-md:opacity-[0.45] md:opacity-60 (Mini 0.45).
5. P3 đọc hai lần câu lý do ví: KHÔNG SỬA, Mini làm giống hệt (không lệch), thêm aria-label đổi tên truy cập của radio so với Mini; ghi nhận.

Test: vitest web src/app/thanh-toan 28 file / 299 test xanh (forks max 2, Node 22.23.3); tsc --noEmit web sạch.
Dọn: worktree gốc tạm, docker gate, cổng 3940-3942 đã tắt.
