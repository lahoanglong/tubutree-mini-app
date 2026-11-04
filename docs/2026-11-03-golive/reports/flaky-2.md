# flaky-2 (gl/1103-flaky, commit f76016bc6)

Đã sửa
- P1 bundles-cls: auxiliaryBeforeProduct trả promise `productServed` (resolve ngay trước khi trả sản phẩm); ca "bộ về chậm" dùng `hold: productServed, delayMs: 50`. Không dùng waitForCall như gợi ý vì nó resolve lúc request TỚI (trước khi sản phẩm được trả), nên bộ vẫn về trước sản phẩm.
  Phép thử bỏ khung chờ (use-product-bundles.ts `return false`, đã khôi phục): ca ĐỎ 4/4 (CLS 0,0764). Đã khôi phục tệp, git status sạch.
- P3 add-to-cart.spec: beforeAll nạp variation-sheet trong describe P8 + vòng chờ có hạn 5 s thay một flush(). vitest -t "nhiều phân loại: không có dòng": 1 pass; cả file 96/96 (Node 22.23.3).
- P3 mock 404: `productDetail(slug) ?? reply(404, ...)`.

Chưa đạt (P2), báo lại theo brief
- Máy quá tải (load avg 60-83 suốt phiên, page.goto của ca nền cũng quá 30 s; phải --timeout=150000).
- Mã thật, không đột biến, không throttle: ca "bộ chậm" xanh 2/5, đỏ 3/5 với CLS 0,0764.
- E2E_CPU_THROTTLE=6, --repeat-each=10: ca "bộ chậm" đỏ 10/10 (CLS ở dòng 91); ca nền đỏ 1 lần.
- Nguyên nhân nghi: hạn chờ PDP_BUNDLES_WAIT_MS=300 tính từ lúc gắn trang; ở ca này bộ về = (3 request phụ + 50 ms) + 50 ms, nên máy chậm quá 300 ms thì khối chèn sau = CLS thật của cấu hình này, không phải do thứ tự mock. Chưa chứng minh được khi máy rảnh; cần chạy lại `E2E_CPU_THROTTLE=6 --repeat-each=10 --workers=1` lúc `top` load thấp. Nếu vẫn đỏ: hoặc nới/đổi mốc 300 ms (quyết định sản phẩm), hoặc đổi ca đo bằng đồng hồ giả.

Không sửa / ghi chú
- P3 flaky-1.md mục 3 (run 41408170301): đúng, job bị cắt ở timeout-minutes 60 (bước Playwright 07:46-08:39, ~55 phút; các lượt xanh 28-37 phút) = hết giờ job, nghi một spec treo. Đề xuất cho phiên điều phối: đặt globalTimeout < 60 phút trong playwright.config để lượt treo vẫn in tên ca và upload báo cáo. Chưa sửa flaky-1.md (ngoài nhánh code; ghi ở đây).
