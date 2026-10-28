# taikhoan đợt B (worker)

Nhánh review/1028-taikhoan tip 1f17509681359987361115e3df26a81b6391260f

GÓI taikhoan, LƯỢT 2. Nhánh review/1028-taikhoan, tip 1f1750968. Commit lượt 2:
45ccc15a1 fix(tai-khoan): ngày giao dự kiến từ giờ đặt, ẩn khi quá hạn/đặt trước/đối tác; khối hỗ trợ cuối trang; nhãn đơn; BestSellerRail tải trễ
fd127fce6 test(e2e): web 375 thứ tự Vận chuyển trước Cần hỗ trợ; hồ sơ kiểm chữ cái đầu avatar
1f1750968 perf(tai-khoan): màn trống sổ địa chỉ tải trễ
(lượt 1: d0b735fda..2a558ac8f)

PHÁT HIỆN REVIEW LƯỢT 1:
- P1 order-13 không có trong Tailwind: ĐÃ SỬA bằng max-md:order-last (don-hang/[code]/page.tsx). Có Playwright 375 so Y của "Vận chuyển" với "Cần hỗ trợ?" (order.web.spec.ts); đã xem ảnh web 375 sau: khối hỗ trợ ở cuối, khớp Mini. Chưa chạy bản đỏ (hoàn order-13) để chứng minh test bắt lỗi.
- P2 nhãn hàng đơn tràn: ĐÃ SỬA, "Đang xử lý" rút thành "Xử lý" (aria vẫn nhãn đầy đủ). Đo web 360 và 375: không đè; "Đang giao" rộng 64px vượt ô 57-60px nhưng cách "Đã giao" 6px ở 360. Ảnh orders-row-web360/375.png.
- P2 ETA (R-9): ĐÃ SỬA. orderDeliveryEtaLabel tính từ createdAt (cùng gốc màn thanh toán), theo ngày VN; ẩn khi ngày max đã qua, khi có món backorderedQty>0, khi fulfilment MERCHANT, khi cấu hình trống. Thêm tham số now. 6 test mới. Ảnh đơn SHIPPING có dòng ETA: screens-taikhoan/eta/ (hero + bước cuối "Dự kiến giao 29/10 – 31/10"). Đơn mẫu đã khôi phục DELIVERED.
- P2 First Load: ĐÃ SỬA phần lớn. BestSellerRail và EmptyState của dia-chi dùng next/dynamic ssr:false. Trước/sau (baseline): /tai-khoan 170->172; dia-chi 140->141; don-hang 184->186 (+2); don-hang/[code] 191->194 (+3, VƯỢT +2 KB 1 KB, do ETA/ảnh món/Ghi chú/màn lỗi/khung chờ; chưa cắt); ho-so 144->145.
- P3 R-110 ô ngày sinh dd/mm khi chưa có ngày: KHÔNG LÀM, vẫn MỘT PHẦN (thay type=date bằng ô chữ có mặt nạ đổi dữ liệu yyyy-mm-dd và nhiều test, không rẻ).
- P3 R-111: MỘT PHẦN, "Xoá tài khoản" vẫn ở Giới thiệu (cần dời test); Đăng xuất đã chuyển.
- P3 R-113: đã đọc mã: API getNewCustomerOffer chỉ trả voucher khi có coupon WELCOME cá nhân của user; persona seed "new" không có nên welcomeVoucher null. Là dữ liệu seed, không phải lỗi mã; chưa chạy kiểm sinh mã khi đăng ký trên môi trường thật. Phần "hàng bán chạy" đã làm (R-113 xong phần đó).
- P3 about-view.tsx ngoài vùng file gói: giữ, GHI VÀO PR để người giữ gioi-thieu biết (bản sao Mini, bỏ Đăng xuất).
- P3 assert e2e vô nghĩa: ĐÃ SỬA, nay kiểm profile-avatar-initial = "N".
- P3 ETA gốc xác nhận vs đặt: ĐÃ SỬA (dùng createdAt).
- "Hỏi chủ ẩn đơn MERCHANT": đã ẩn theo brief giao việc.

KIỂM (số thật):
tsc --noEmit app-core, miniapp, web, e2e: sạch. next lint web (file đổi) và eslint miniapp (profile, order-detail): sạch.
vitest app-core 925/925; miniapp 4872/4872 (cả TZ=UTC 4872/4872); web 7449/7449 (441 file; sau đó chạy lại src/app/tai-khoan 400/400 sau đổi dia-chi).
Playwright Mini toàn bộ (E2E_SCOPE=miniapp, cổng 3723): 205 passed, 10 skipped, 0 fail. Web gate order.web + account.web: lần 1 52 passed, 2 fail của test mới do mock thiếu support; thêm mock, order.web chạy lại 26/26 passed.
lint:parity: xanh, 0 pending. jest API: không chạy (không đụng API). Race: không cần.
Bundle Mini: entry 711 KB (= baseline 711), tổng 1917 KB raw/740 gz so với baseline 1911/737 (+6 raw, +3 gz, tăng ở chunk lazy do tính năng mới; entry không tăng).
perf run-all.mjs: không chạy theo yêu cầu.

ẢNH: /Users/longla/coding/tubutree-mini-app/.claude/worktrees/review-1028/docs/2026-10-28-review/screens-taikhoan/ (returning-s1,s2, new-s1,s2, guest-s1,s2, error500, offline, eta/, orders-row-web360.png, orders-row-web375.png). Đã Read: profile (returning), eta web s1/s2, eta mini s2, addresses new, orders new, hàng đơn 360. Chưa Read lại: settings, about, guest, offline, error500 lượt 2.
Lưu ý: ảnh order-code trong screens-taikhoan/*-s* chụp khi đơn mẫu đang SHIPPING (đã khôi phục sau đó), nên khác bản delivered.

CHƯA KIỂM / CẦN CHỦ: ETA chỉ hiện trên PROD khi chủ đặt shipping.eta_min/max_days; ô ngày sinh native vẫn mm/dd/yyyy ở Chromium en-US; Playwright web chỉ chạy order.web + account.web (không chạy cả bộ web). Lane 3 đã dừng (không --drop); params-l3.json chưa commit.
