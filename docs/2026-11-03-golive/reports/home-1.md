# Báo cáo gói home, lượt 1 (nhánh gl/1103-home, gốc 52fd5cd65)

## Commit (chưa push)
- 601035a43 fix(home): giữ vị trí cuộn Trang chủ Mini, giữ chỗ lối tắt và dải Việc cần làm
- dd456f4c4 fix(web): ẩn chân trang gọn khi khung chờ của trang đang hiện (CLS web 375)
- 180b0f16b fix(home): placeholder ô tìm vừa 375px, tên bậc và câu quà không cắt, một Thử lại khi lỗi trang, vùng chạm logo web

## Từng mục
- KHAMPHA-01 (Mini): `pages/home.tsx` gọi `useScrollRestoration('home', ready)`, ready = hết khung chờ chung, phiên đã khôi phục, Danh mục và Bán chạy đã tải. Web 375: chưa kiểm được (không có lane/Playwright web), không sửa web.
- KHAMPHA-04 (Mini + web): `usePublicConfig` thêm `isPending`; lưới lối tắt hiện khung trơn cao 84px tới khi cấu hình về (lỗi thì dựng lưới với cờ tắt, không treo khung).
- HIEUNANG-03 (Mini + web): TodoStrip đang tải mà chưa nhớ số dòng và /me/summary báo active>0: giữ chỗ 1 dòng 64px. active = PENDING_PAYMENT/CONFIRMED/PACKED/SHIPPING, khớp ba nhóm của home-todo nên khung 1 dòng ít khi sụp. Không làm đề xuất (a) ghi số dòng ở màn đặt đơn (đụng checkout của đợt 1).
- HIEUNANG-04 (web): đúng như ghi chú người xác minh, chẩn đoán auditor sai. Sửa bằng một rule trong globals.css (dưới 768px): ẩn `footer[data-compact-footer]` khi trong trang có div/section/ul/ol/main `aria-busy="true"` (không tính nút/ô nhập). Phủ GameSkeleton, offers-page-loading, v.v. mà không sửa file màn của vùng db. Chưa đo CLS trước/sau (xem Rủi ro).
- KHAMPHA-06 (Mini + web): câu lợi ích Quà khách mới kẹp 3 dòng thay vì 2 (chữ không đổi). Thẻ có thể cao hơn 64px khoảng 8px khi câu dài.
- KHAMPHA-08 (Mini + web): placeholder "Bạn đang tìm gì hôm nay?" -> "Bạn tìm gì hôm nay?" (vi.ts và home-text.ts); cập nhật spec/e2e có tên truy cập cũ.
- KHAMPHA-09 (Mini + web): span tên bậc co được (ellipsis) thay vì flex 0 0 auto.
- KHAMPHA-10 (Mini + web): khi Trang chủ đã có dải lỗi cấp trang (context HomeBlockErrorSuppressed), thẻ thành viên không hiện dòng lỗi cắt chữ và nút Thử lại, kệ Mua lại không hiện khối lỗi + Thử lại. Còn đúng một Thử lại.
- KHAMPHA-13 (web): link logo giữ hình 20x30, vùng chạm nới bằng `::after` (44x46) không đè ô tìm; hạ baseline px của home-header 3 -> 2.
- KHAMPHA-16: KHÔNG làm. Không tái hiện được axe (không bật được lane/web), đọc mã chưa thấy landmark trùng ở 375 (SiteSearch ẩn dưới md). Cần chạy axe thật trên /san-pham persona returning.

## Kiểm (số thật)
- tsc: apps/miniapp 0 lỗi, apps/web 0 lỗi. eslint file đã sửa: sạch cả hai app.
- vitest miniapp toàn bộ (TZ=UTC): 6532/6535 qua; 3 ca đỏ (flash-sale, browse, offers) là timeout do tải máy ~70-95, chạy lại riêng 3 file: 134/134 xanh.
- vitest web toàn bộ: 562 file, 9576/9576 xanh.
- Test mới/đổi: shortcut-grid (2 app), member-card (Mini, đỏ với mã cũ vì có nút Thử lại), purchased-rail (Mini), home.spec (khoá cuộn 'home'), todo-strip (2 app, đổi từ "im lặng" sang "giữ chỗ 1 dòng"). 8 spec trang home của Mini mock hook cuộn vì không dựng Router.
- pnpm lint:parity: xanh (sau khi giảm px của shortcut-grid Mini và hạ baseline home-header).
- Playwright Mini (home-h, home-merged, home-p6-cls, home-p6; cổng 3983): 16 xanh, 5 chập chờn (timeout do tải, qua ở lần thử lại), 0 đỏ.
- Playwright web (home-merged.web.spec qua web-gate.sh, hai lần): KHÔNG chạy được, webServer quá hạn 600s/180s do máy tải 70-95.

## Bundle Mini (vite build, bundle-report)
- Trước (52fd5cd65): entry 659 KB raw / 205 KB gz; JS tổng 681 KB gz; tổng 862 KB gz.
- Sau: entry 661 KB raw / 206 KB gz; JS tổng 681 KB gz; tổng 862 KB gz.
- Entry tăng 2 KB raw (+1 KB gz) vì Home nằm trong gói đầu nên hook cuộn từ chunk lười chuyển vào entry. Brief ghi "entry không được tăng": đây là chỗ lệch, tổng không đổi. Nếu cần giữ entry, phải nội tuyến hook gọn hơn hoặc chấp nhận.

## Chưa làm / rủi ro
- Lane 6: lệnh `lane-down.sh 6` bị bộ phân loại quyền chặn (lane chạy mã main, không phải của tôi), nên không bật lại được: không có ảnh trước/sau (screens-home trống), không đo CLS trước/sau, không kiểm cuộn thật bằng Back (chỉ test đơn vị + spy khoá).
- KHAMPHA-01 cuộn sâu trong lưới Gợi ý (4529px) có thể bị kẹp nếu lưới chưa dựng đủ lúc khôi phục (hook chỉ khôi phục một lần).
- Web: footer ẩn khi aria-busy ở mọi trang dưới md; chưa kiểm bằng ảnh.
- a11y-shop / ds-parity Playwright không chạy.
