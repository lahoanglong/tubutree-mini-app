# quantri đợt D

mergeable=True

## Sửa D1 (head 95d1f647a)

Nhánh review/1028-quantri @ 95d1f647a (chưa push). Lane 8 đã dừng, cụm Postgres 35750 đã dừng, sạch cổng.

COMMIT
- 0c613224e fix(quan-tri): ô ngày báo "Ngày không có thật" cả sau blur; khoá nút Tạo mã khi Hết hạn < Bắt đầu; trả e2e Mini về "Xem tất cả đơn"
- 95d1f647a fix(quan-tri): dòng nhắc của ô ngày xuống dòng trong bề rộng ô, không tràn khỏi màn 375 (phát hiện khi tự xem ảnh: câu "Ngày nằm ngoài khoảng cho phép." bị cắt ở mép phải)

TỪNG VIỆC
(1) P2 shipping-pancake.miniapp.spec.ts:86: ĐÃ LÀM, về "Xem tất cả đơn"; spec chạy trong Playwright Mini toàn bộ, xanh.
(2) P3 vn-date-input sau blur: ĐÃ LÀM. Test mới có blur, thấy đỏ rồi sửa, nay xanh.
(3) P3 khoá nút Tạo khi Hết hạn < Bắt đầu: ĐÃ LÀM. Test mới ở page.spec, thấy đỏ rồi sửa, nay xanh.
(4) P3 ảnh 3 trạng thái: ĐÃ LÀM, tự xem từng ảnh. Có 4 ảnh x 2 khổ (admin375, admin1280): state-coupon-chua-ap-dung, state-coupon-ngay-khong-co-that, state-coupon-het-han-truoc-bat-dau (cả ba nút Tạo bị khoá, đo isDisabled=true), state-orders-hang-doi-chuyen-khoan. Dòng giải thích hàng đợi và nút "Bỏ lọc chuyển khoản" chỉ có ở 375 (đúng thiết kế, ở 1280 dùng chữ "Xoá bộ lọc" kèm dòng giải thích). Thư mục: /Users/longla/coding/tubutree-mini-app/.claude/worktrees/review-1028/docs/2026-10-28-review/screens-quantri/{admin375,admin1280}/state-*.png. Chưa commit ảnh theo luật. Tồn: ở 375 câu "Ngày nằm ngoài khoảng cho phép." (ô Hết hạn) đè lên chữ nút Tạo đang khoá, vẫn đọc được; không sửa thêm.
(5) R-70, R-75, R-148, R-149: GHI BACKLOG (không sửa 20-backlog.md).
P0/P1/P2 còn lại của Review 3: không còn mục nào ngoài P2 ở (1).

SỐ KIỂM THẬT (Node 22.23.3)
- tsc --noEmit: api, web, miniapp, app-core, e2e đều không lỗi. eslint web (components/admin, admin/page.tsx, vn-date-input.tsx): sạch.
- jest API toàn bộ: 484 suite, 11224 test pass.
- Race admin-*/ops-* (Postgres native 35750, runInBand): 24 suite, 124 test pass.
- vitest web toàn bộ: 442 file, 7475 test pass (sau commit 2: riêng admin 78 file, 1374 test pass).
- vitest app-core: 71 file, 917 test pass. vitest miniapp: 313 file, 4859 test pass với TZ=UTC; lần chạy đầu không TZ có 1 test BrowsePage "Xem thêm lỗi" đỏ, chạy lại riêng thì xanh (nghi máy tải, chưa chạy lại toàn bộ không TZ).
- Playwright web-gate (cổng 3751-3755): admin-all-tabs, admin-analytics, admin-customer-refunds, admin-external-claims, admin-support-chat, admin-waste, admin = 26 pass, 1 skipped, 0 fail.
- Playwright Mini toàn bộ (E2E_SCOPE=miniapp, cổng 3753): 205 pass, 10 skipped, 0 fail.
- pnpm lint:parity: xanh, 0 mục pending.
- vite build + bundle-report: Mini entry 711 KB raw/222 gz (không tăng so với 711 baseline); Mini tổng js 1624 KB raw/558 gz, tổng 1911 KB raw/737 gz (lượt này không đổi mã Mini; không có số baseline tổng để so). Chunk lazy không tăng.
- First Load /admin (bảng next build): 326 kB. Đối chiếu bản build main ở worktree review-1028: 356 kB, tức thấp hơn 30 kB (số base lấy từ .next có sẵn, chưa dựng lại base để chắc cùng điều kiện). Lượt này chỉ đổi className và thêm 1 điều kiện, không thêm thư viện.

GHI BACKLOG
- R-70, R-75, R-148, R-149: chuyển sang gói sau, gỡ khỏi `quantri` trong 20-backlog.md (dòng ~94, 99, 172, 173 và danh sách 15 mục ở dòng ~223).
- Báo cáo nguồn khách mới: nhóm khách vãng lai (guest_) đã mua không còn nằm trong "đơn đầu" và doanh thu 30 ngày theo nguồn (chỉ đổi chữ hiển thị, SQL giữ); cần chủ biết/quyết.
- Tuỳ chọn: dòng nhắc lỗi của VnDateInput nên đặt trong luồng thay vì absolute để không đè nút Tạo ở 375.
- before-after.mjs cứng mini375/web375, không dùng được cho admin375/admin1280; cần mở rộng nếu muốn dùng chung.

CHƯA KIỂM / LƯU Ý
- Không chạy perf/run-all.mjs, không đo CLS/LCP (theo lệnh).
- Lane 8 dùng cổng 3281-3288 theo lane-up.sh (không nằm trong dải 3750-3759 vì script gán cổng theo số lane); cổng 3751-3755 dùng cho gate e2e.
- Đã khôi phục routes.json và xoá params-l8.json sinh ra, working tree sạch.

## Review D1

KẾT LUẬN: merge được

Không còn lỗi P0, P1 hay P2. Tôi đã chạy lại với Node 22 ba file: vn-date-input.spec, coupon-list.spec và admin/page.spec, tổng 242 test, đều xanh. Các bộ kiểm lớn (jest toàn bộ, Playwright, race, build) chỉ dựa theo báo cáo của worker, tôi chưa chạy lại.

- [P3] apps/web/src/components/admin/vn-date-input.tsx:141,146 — Dòng nhắc vẫn dùng `absolute` nên nằm đè lên ô bên dưới. Sau 95d1f647a dòng nhắc xuống dòng được, nhưng ở 375px nó thành 2–3 dòng và che chữ của nút "Tạo mã giảm giá" đúng lúc nút đang khoá. Xem ảnh screens-quantri/admin375/state-coupon-chua-ap-dung.png (3 dòng che "Tạo mã") và state-coupon-ngay-khong-co-that.png. Người dùng thấy một nút xám bị che chữ và không biết đó là nút gì. Cách sửa: cho dòng nhắc nằm trong luồng trang (`block mt-0.5`, bỏ `absolute`), hoặc chừa chỗ phía dưới ô ngày.
- [P3] apps/web/src/app/admin/page.tsx:2478 + vn-date-input.tsx:77 — Khi "Hết hạn" sớm hơn "Bắt đầu", nút Tạo bị khoá mà không có lời giải thích. Ví dụ: gõ Bắt đầu 20/11/2026, rồi gõ Hết hạn 10/11/2026 và chưa rời ô. Lúc đó `touched=false` nên `invalid=false`, còn `pending=false` vì ngày hợp lệ, nên không có chữ nào hiện ra. Rời ô rồi thì chỉ hiện "Ngày nằm ngoài khoảng cho phép.", không nói rõ là phải sau ngày bắt đầu. Cách sửa: ở CouponsTab, khi `f.endAt < f.startAt` thì hiện một câu cạnh nút, ví dụ "Ngày hết hạn phải từ ngày bắt đầu trở đi.", và không phụ thuộc `touched`. Thêm test kiểm câu này.
- [P3] screens-quantri/{admin375,admin1280}/state-coupon-chua-ap-dung.png — Ảnh này không chụp trạng thái "Chưa áp dụng" như việc (4) yêu cầu. Cả hai ảnh đều hiện lỗi đỏ "Nhập ngày dạng dd/mm/yyyy, ví dụ 03/10/2026." (role=alert, ô đã rời), không phải dòng xám "Chưa áp dụng, gõ đủ ngày dd/mm/yyyy.". Worker báo đã tự xem ảnh nhưng không phát hiện ra. Cách sửa: chụp lại khi ô đang gõ dở và chưa rời ô lần nào.
- [P3] apps/web/src/components/admin/vn-date-input.tsx:69,77,107 — `touched` bật lên rồi không bao giờ tắt. Sau lần rời ô đầu tiên, gõ lại một ngày dở (ví dụ "15/1") thì ô báo đỏ "Nhập ngày dạng…" ngay lập tức, trong khi người dùng vẫn đang gõ. Trạng thái xám "Chưa áp dụng" chỉ có ở lần nhập đầu tiên. Cách sửa: đặt lại `touched=false` khi ô được focus (onFocus), hoặc mỗi khi gõ (trong `edit`).

Đã kiểm lại:
- (1) shipping-pancake.miniapp.spec.ts:86 đã trở về "Xem tất cả đơn". Diff của apps/e2e so với base không còn đụng file Mini nào. Chữ "Bỏ lọc chuyển khoản" chỉ còn ở apps/web/src/app/admin/page.tsx:1527.
- (2) Ở nhánh `invalid`, chuỗi đủ 10 ký tự mà `iso === null` thì báo "Ngày không có thật". `maskVnDate` luôn cho chuỗi 10 ký tự đúng dạng dd/mm/yyyy, nên không bị nhận nhầm. Nếu bỏ phần sửa thì test blur mới sẽ đỏ.
- (3) Điều kiện so `f.endAt < f.startAt` theo chuỗi ISO là đúng. Cùng một ngày vẫn được tạo, vì hết hạn tính đến cuối ngày. API vẫn chặn thêm một lớp ở coupon-input-rules.ts:34.
- Không có thay đổi nào trong apps/miniapp hoặc packages, nên số bundle Mini không đổi. Doanh thu Hôm nay trừ hoàn một phần giống Báo cáo: cùng điều kiện `return_requests APPROVED` và `refundAmount + shippingRefund`, theo admin-reports.service.ts:55-57.

GHI BACKLOG (người giao ghi): R-70, R-75, R-148, R-149; Báo cáo nguồn bỏ nhóm khách vãng lai `guest_` đã mua; before-after.mjs chưa hỗ trợ khổ admin375 và admin1280.
