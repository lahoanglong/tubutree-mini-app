# khampha đợt B (worker)

Nhánh review/1028-khampha tip 950431bbb51b0f91c95af719b42ce098962fb6b7

Worktree: /Users/longla/coding/tubutree-mini-app/.claude/worktrees/r1028-khampha (base 1384ff380). Chưa push.
COMMIT (mới -> cũ):
950431bbb khung chờ Giờ vàng 300px, h2 Danh mục web ẩn trên md (R-2, R-89)
46aa42804 test(e2e) theo màn đầu gọn, tên Danh mục, danh sách đầu dựng sẵn
86f3326b8 fix(danh-muc) /san-pham máy chủ hết lấy PAGE_LIMIT từ file client (R-17)
cff059f15 perf(trang-chu) web gọi /flash-sales/active một lần (R-16 bước 1)
f7d67f741 fix(cau-chuyen) ghim 8 nhãn đúng mảnh tỉnh (R-20)
2d59b87c1 fix(nhan-hang) "Không tìm thấy nhãn hàng" (R-19)
36af8905c fix(danh-muc) web 375 có tiêu đề, chip, ô tìm dính (R-89)
27ede421c fix(danh-muc) Mini: tiêu đề, chip đổi danh mục, lối sang nhãn, ô tìm dính, chip dài không che X
1aa908857 fix(tim-kiem) gợi ý báo lỗi + Thử lại + khung chờ (R-14)
ab28cc634 fix(trang-chu) tắt khảo sát lúc mở, bong bóng Vườn Xanh hiện một lần, tự tắt (R-4)
a631af58a feat(trang-chu) màn đầu gọn, món hàng lên đầu, giữ chỗ (R-2,3,15,18,21,87,88)
TRẠNG THÁI TỪNG R:
R-3/R-4, R-14, R-15, R-17, R-18, R-19, R-20, R-21, R-87..R-91: làm xong, có test.
R-2 (CLS): chưa đạt hết. Mini khách mới 0.0375, Mini khách cũ 0.074 (đạt < 0.1). Web khách mới 0.2383, web khách cũ 0.1167 (chưa đạt; đo ở next dev, API chậm giả lập).
  Nguyên nhân web: HTML máy chủ không có khối Giờ vàng (~298px), sau hydrate khối hiện ra đẩy Bán chạy/Danh mục xuống. Cách sửa dự kiến: tải /flash-sales/active ở loadHomeInitial rồi đưa vào initialData của FlashSale. Chưa làm, hết lượt.
R-16: mới bước 1 (một lần gọi flash-sales). Bước 2 (web dùng /home + /home/me) chưa làm.
KIỂM TRA (số thật, cuối lượt):
- app-core vitest: 917/917 pass.
- web vitest: 441 file, 7441/7441 pass.
- miniapp vitest: 313 file, 4872/4872 pass.
- tsc web + miniapp: sạch (không lỗi).
- e2e miniapp/web gate: đã sửa spec theo thiết kế mới (46aa42804). Lần chạy gate web cuối (webgate3) bị tôi dừng, KHÔNG có số pass/fail cuối. Chưa kiểm.
BUNDLE (bundle-report.mjs --build-miniapp --build-web):
- Mini entry: 711/222 KB (raw/gz, trước) -> 715/223 KB (sau): +4 KB raw.
- Web First Load: "/" 204 -> 205 KB (+1, đạt); /san-pham 157 -> 167 KB (+10, VƯỢT mức +2 KB). Route-riêng /san-pham giảm 15.9 -> 14.2 KB nên chunk dùng chung đổi; chưa tìm nguyên nhân. Dùng chung mọi trang 103 KB không đổi.
PERF: không chạy run-all.mjs (đúng lệnh). Chỉ đo CLS bằng cls-probe tạm (số ở R-2).
ẢNH: /Users/longla/coding/tubutree-mini-app/.claude/worktrees/review-1028/docs/2026-10-28-review/screens-khampha/ (7 màn: home, browse, browse-category, browse-search, browse-brand, brand-slug, brand-story; persona returning, state ok). Ảnh "sau" lấy từ lần chụp trước đó trong lượt, chưa chụp lại sau commit cuối; không chụp slow5s/error500.
DỌN: lane 2 đã dừng, cổng 3761-3765 trống, routes.json đã khôi phục. Còn file chưa commit (cố ý, không commit): docs/2026-10-28-review/tools/{cls-probe,h-probe,h2-probe,ssr-probe}.tmp.mjs, params-l2.json.
CHƯA KIỂM / CẦN CHỦ QUYẾT:
- CLS web chưa đạt; cần lượt sau làm SSR flash (cách ở trên) hoặc chủ chấp nhận.
- /san-pham First Load +10 KB cần điều tra.
- Kết quả e2e gate web cuối chưa có.
- Không có đổi điểm/giá/phí/chữ pháp lý.
