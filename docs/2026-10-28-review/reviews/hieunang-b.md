# hieunang đợt B (worker)

Nhánh review/1028-hieunang tip 76dbe6bc59f4329993b59598f98c72809dfe44b9

NHÁNH review/1028-hieunang, 13 commit trên 1384ff380, HEAD 76dbe6bc5. Cây sạch (đã hoàn harness, xoá params-l9, lane 9 dừng, không --drop).
Commit: 1cc8c1de3 R-80/85; a0a071844 spec; 306acedda R-78/79/84; b9abe395e R-76/83; a0dd12eda + d1c8e9cf2 R-5; 888a97f65 R-81; 40433b233 R-82; e2d3885bf R-77; 2710f031a; 33c85ed50; 626c33d8d (e2e home-h); 76dbe6bc5 (bỏ loading san-pham).
R-x:
- R-5 xong: /img sharp 0.35.5, allowlist host, chống SSRF ở DNS, rộng 160/320/640/960, webp/jpeg, ETag + immutable, cache đĩa có trần; Mini+web srcset 1x/2x + lá dự phòng. Có unit + 1 e2e ảnh mẫu.
- R-76 một phần: khung chờ theo hình trang cho tai-khoan + error.tsx. KHÔNG có loading.tsx cho san-pham: nó làm trang không tồn tại trả 200 thay 404 (web-customer.web.spec:41 đỏ). Đã bỏ, xoá 2 skeleton chết.
- R-77 một phần: entry 711 -> 699 KB (mục tiêu 600 chưa đạt); tải sau Onboarding + CouponClaimGate. Không làm lazy 3 khối home, tách vi.ts (loại trừ).
- R-78, R-79, R-80, R-83, R-84, R-85 xong.
- R-81 xong: không migration, cache thứ hạng 60s trong bộ nhớ (từng instance, không Redis).
- R-82 một phần: /cart còn 8 SQL (findUnique, _count đơn, không tạo giỏ khi đọc). /home/me CHƯA giảm (vẫn 18-19 trên lane 9).
KIỂM (số thật):
- tsc: miniapp, web, app-core, e2e, api sạch. pnpm lint:parity xanh.
- jest api 486 suite / 11257 test pass.
- vitest: app-core 72f/923; miniapp 314f/4870 (cả TZ=UTC); web 442f/7439.
- Playwright Mini toàn bộ: 205 pass, 10 skip, 0 fail.
- Web gate lượt 1 (6 spec): 177 pass/17 skip/3 flaky/3 fail. Sửa 404 -> chạy lại web-customer+web-checkout+shop: 98 pass, 11 skip, 1 flaky.
- Flaky còn lại: web-checkout.web.spec:133 (Mobile), nút "Quay lại" ở chi tiết đơn đôi khi về /tai-khoan/don-hang (lịch sử) thay vì /tai-khoan; qua ở retry. CHƯA so với base, chưa rõ có sẵn hay do tôi.
- Chưa chạy: next build + First Load web (chưa có số, rủi ro: staleTime/error.tsx; loading.tsx đã bỏ).
BUNDLE Mini (vite build + bundle-report): entry 711 -> 699 KB raw (gz 218); tổng JS+CSS+assets 1921 KB raw / 743 gz, tổng tăng khoảng +10 KB so với baseline (brief cấm tăng; do tách chunk, thêm route-shell, image-resize client). Cần chủ cân nhắc. Không chạy run-all.mjs (bên giao đo).
ẢNH: /Users/longla/coding/tubutree-mini-app/.claude/worktrees/review-1028/docs/2026-10-28-review/screens-hieunang/ (home, product-slug, cart, browse-category, trước/sau, đã xem từng ảnh). Layout giữ nguyên, web375 khớp Mini; dữ liệu lane chưa có ảnh nên thấy lá dự phòng. Ảnh loading/offline sau ở worktree r1028-hieunang/docs/2026-10-28-review/screens/{mini375,web375}-{loading,offline} (chưa ghép; offline home hiện "Chưa kết nối được tới Tubu Tree. Kiểm tra mạng rồi thử lại nhé." + Thử lại).
DEPLOY NOTE R-5: sharp là native, container alpine/musl (@img/sharp-linuxmusl-x64 có trong lock). Cache mặc định /tmp trong container (không cần volume, mất khi rebuild). Env: IMAGE_CACHE_DIR, IMAGE_CACHE_MAX_MB, IMAGE_RESIZE_EXTRA_HOSTS; chưa thêm vào env.validation/.env.production.example; docker-compose không đổi.
LỆCH BRIEF / CẦN CHỦ QUYẾT: (1) bỏ loading.tsx san-pham như trên (SEO 404). (2) AuthLoading footer xử lý bằng min-height, không ẩn footer. (3) Lane 9 trỏ DB mẫu nên tôi vá harness cục bộ để chạy, đã hoàn lại, không commit. (4) pnpm-lock có lệch nhỏ do install offline, nên xem lại diff lock. (5) Đo HP1 cần seed ảnh thật mới thấy lợi ích /img. (6) Test home-h chip: sửa test (scrollIntoView) vì GET công khai không chờ phiên làm chip nằm dưới thanh đáy.
