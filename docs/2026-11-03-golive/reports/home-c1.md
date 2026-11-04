# home-c1: sửa phát hiện reviewer đợt 1 (nhánh gl/1103-home, tip ba233e6a1, chưa push)

Commit sửa (trên 180b0f16b): 73508ccb5, be5f4f1d3, fd113ee80, ba233e6a1. Worktree sạch.

- KHAMPHA-01 (P1) đã sửa: SuggestFeed dựng ngay từ cache trang 1; hook cuộn Mini thử lại tới khi đủ cao, ngừng khi khách chạm/cuộn, kiểm lại sau một nhịp cho nạp lười. Test mount lại với cache nhiều trang. Web: hook cuộn riêng đã thử rồi gỡ (không cần, trình duyệt tự khôi phục), không có test Back thật trên web 375 (chưa chạy Playwright).
- HIEUNANG-03 (P2) đã sửa: giữ chỗ Việc cần làm sau khi đặt đơn (rememberActiveOrder ở checkout Mini và thanh-toan web, nằm ở home-todo-rows). Test home-layout/checkout.
- KHAMPHA-06 (P2) đã sửa: câu Quà khách mới chiếm cả hàng, nút xuống hàng riêng, khung chờ khớp. Test cả Mini và web.
- ShortcutGrid web (P2) đã sửa: dựng từ initial.publicConfig phía server, khung trơn có bleed. Test shortcut-grid.
- Entry Mini (P2) đã sửa: chuyển rememberActiveOrder sang home-todo-rows; đo vite build: entry 675836 B raw (660 KiB) / 209365 B gz (204.5 KiB), tức không cao hơn mốc 659/205 trước đợt.
- Thiếu bằng chứng (P2): KHÔNG làm (ảnh 375, CLS trước/sau, Playwright web, axe KHAMPHA-16). Lý do: máy quá tải, lệnh buộc không bật lane. Còn nợ cho lượt có lane.
- P3 chân trang trong dialog: sửa (:not([role=dialog] *)). P3 member-card: sửa, test Mini+web. P3 gộp import purchased-rail: sửa, thêm spec nhánh ẩn.
- Chưa làm: assert `ready`=false khi còn tải trong home.spec (P3 phụ, rẻ nhưng không gây lỗi).

Kiểm (Node 22.23.3, --minWorkers=1 --maxWorkers=2; --maxWorkers=2 đơn lẻ lỗi minThreads):
- miniapp vitest: 416 file / 6543 test xanh
- web vitest: 562 file / 9581 test xanh
- app-core vitest: 166 file / 2601 test xanh
- tsc --noEmit miniapp và web: sạch
