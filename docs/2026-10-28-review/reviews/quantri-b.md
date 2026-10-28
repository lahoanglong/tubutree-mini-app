# quantri đợt B (worker)

Nhánh review/1028-quantri tip bfaf80f14

LƯỢT 2 gói quantri. Nhánh review/1028-quantri, tip bfaf80f14 (gốc 1384ff380). Cây sạch, không push.
COMMIT lượt 2: ed108f495 số Hôm nay khớp Báo cáo, hàng đợi chuyển khoản, hạn tự huỷ | f011168ba huy hiệu, ô ngày, số báo cáo, thẻ đổi rác, nút Cấu hình, ẩn thu ngân | 1678cac83 test race hộp việc | 91177387e tải lười 2 tab nặng | bfaf80f14 sửa tràn ngang 375 + spec e2e.

PHÁT HIỆN REVIEW
- P2 doanh thu Hôm nay: ĐÃ SỬA. LEFT JOIN LATERAL return_requests APPROVED, trừ hoàn một phần như Báo cáo.
- P2 đếm đơn/khách mới: ĐÃ SỬA. Đếm mọi đơn (không loại CANCELLED); khách mới dùng NEW_CUSTOMER_SQL (loại ADMIN/STAFF, dòng đã gộp, khách cũ gắn nguồn muộn). Lưu ý: NEW_CUSTOMER_SQL tính cả khách vãng lai guest_ như Báo cáo, nên "Khách mới hôm nay" có đếm họ (cùng định nghĩa, theo yêu cầu).
- P2 hoursLeft: ĐÃ SỬA. findFirst thêm autoCancelBlockedAt: null (có unit test).
- P2 thẻ chuyển khoản: ĐÃ SỬA. Thêm tham số API queue=bank_transfer_to_confirm (ListOrdersQuery/ExportOrdersQuery) dùng chung BANK_TRANSFER_TO_CONFIRM_WHERE với số đếm; web gửi queue, hiện dòng giải thích và nút Xoá bộ lọc. Race test: 1 đơn chuyển khoản đúng, loại ZaloPay/ví/đại lý/đã trả.
- P2 kiểm thử: ĐÃ LÀM. Race test mới admin-today-summary.race-spec.ts chạy getTodaySummary và revenueReport trên Postgres thật, so hôm nay/hôm qua/7 ngày (đơn, doanh thu, khách mới) và số cụ thể.
- P3 REAL_USER_WHERE: sửa bằng dạng OR rõ từng nhánh (zaloId null không còn biến mất). Không import bản common vì bản đó loại cả tài khoản ADMIN/STAFF không SĐT/zaloId khỏi danh sách.
- P3 huy hiệu tổng: ĐÃ SỬA (SP thiếu ảnh không cộng vào "Hôm nay", vẫn hiện ở mục Sản phẩm: ảnh 1280 cho "Hôm nay 3", "Sản phẩm 44").
- P3 huy hiệu nhóm Hay dùng đếm hai lần: ĐÃ SỬA bằng cờ total trên mục Hôm nay. Mục sáng ở hai nhóm: KHÔNG LÀM (nhóm lối tắt cố ý lặp mục).
- P3 InboxBadge 403: ĐÃ SỬA (prop enabled theo quyền inbox).
- P3 tab Báo cáo (n): ĐÃ SỬA ở web (lấy số từ hộp việc, "50+" nếu chưa có). Ở Mini: KHÔNG LÀM (ngoài phạm vi lượt này, không sửa file Mini).
- P3 VnDateInput: ĐÃ SỬA (3/10/2026 -> 03/10/2026, lỗi hiện chữ ra màn, nút lịch 44px trên điện thoại).
- P3 R-68 ảnh guest: ĐÃ CHỤP lại sau khi thêm 7 user guest_ vào DB lane 8: chip "Hiện cả khách vãng lai (7)" hiện ở users 375.
- Mục báo XONG nhưng thiếu: R-73 chip "Chưa có danh mục (n)" LÀM (truy vấn riêng lấy total). R-71 nút "Mở Cấu hình" LÀM. R-146 ẩn "Màn thu ngân" khi cờ loyalty.pos_credit_enabled tắt LÀM (chưa biết thì vẫn hiện). R-72 thẻ hẹp thay bảng món đổi rác LÀM bằng CSS (không nhân đôi DOM): ảnh tab-waste-items 375, overflow 0. MỘT PHẦN/KHÔNG LÀM: R-70 chip trạng thái đơn có số (cần API đếm theo trạng thái), R-148 ô lọc Đại lý thành chip có số, R-75 bộ tab chung với Mini, R-149 khung xương/staleTime (QueryClient dùng chung với app khách). Tất cả P3, chưa làm vì cần API mới hoặc đổi toàn cục.
- Lỗi mới tìm thấy khi chạy Playwright (do lượt 1): hàng chip trạng thái đơn tràn ngang 106px ở 375 -> sửa min-w-0; /admin First Load tăng.

KIỂM (số thật)
- tsc --noEmit: api, web, miniapp, app-core, e2e sạch.
- jest api toàn bộ: 484 suite, 11222 test xanh. Race (Postgres nhúng 35750, tubutree_it): admin-* và ops-* 24 suite, 124 test xanh sau khi sửa ops-health.race-spec (khoá communityReports/bankTransferToConfirm theo nhóm).
- vitest: web 442+ file xanh (chạy lại sau mọi sửa: src/app/admin 234 test xanh, src/components/admin 1133 xanh); app-core 917 xanh; miniapp (TZ=UTC) 4859 xanh. eslint file đã đổi: sạch. lint:parity xanh (0 pending).
- Playwright admin web-gate (cổng 3751-3755), 7 spec admin: 26 passed, 1 skipped (ảnh), EXIT 0. Đã sửa: mock-api thêm mặc định /admin/ops/inbox và member-card cho project Web Admin; admin-all-tabs (nhãn menu có huy hiệu, Hôm nay không tìm được qua ô tìm, tiêu đề ẩn trên điện thoại, mục chọn mặc định Hôm nay); admin.spec câu rỗng Đại lý mới.
- Playwright Mini App: KHÔNG chạy; không file apps/miniapp hay packages nào đổi trong cả hai lượt (git diff rỗng).
- Bundle: Mini App entry 711 KB, tổng 1911 KB raw / 737 gz = baseline, không đổi. Web /admin First Load: 356 kB (main) -> 362 sau lượt 1+2 -> 325 kB sau tải lười Đổi rác và Cộng đồng (next/dynamic); /admin/pos 144 không đổi.
- perf run-all.mjs: không chạy theo lệnh giao.
ẢNH (lane 8 đã dừng, không --drop; tiến trình/PG đã dừng): /Users/longla/coding/tubutree-mini-app/.claude/worktrees/review-1028/docs/2026-10-28-review/screens-quantri/admin375 và admin1280 (inbox, orders, users, waste, productCategories, community, coupons; thêm tab-waste-items 375). Đã xem: inbox, orders (375/1280), users, waste-items, productCategories. Không có ảnh ghép trước/sau (ảnh TRƯỚC ở screens/admin*).
CẦN CHỦ QUYẾT/LƯU Ý: bố cục Hôm nay (R-74) và DEFAULT_TAB vẫn là inbox như lượt 1. Tab Đổi rác/Cộng đồng giờ tải lười nên hiện "Đang tải…" một nhịp khi mở lần đầu. Mock e2e (apps/e2e/tests/support/mock-api.ts) và spec admin sửa ngoài danh sách phạm vi vì bắt buộc cho cổng Playwright.
