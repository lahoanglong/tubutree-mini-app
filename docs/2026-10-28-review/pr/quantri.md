TITLE: feat(quan-tri): trang Hôm nay, hộp việc đủ hàng đợi, ô ngày dd/mm/yyyy, đơn dạng thẻ trên 375

## Vấn đề
- Hộp "Việc cần xử lý" báo "Không còn việc nào" trong khi có đơn chuyển khoản chờ tiền và gian hàng chưa duyệt. Đơn không ai xác nhận sẽ tự huỷ sau 24 giờ (R-13).
- Mỗi thiết bị chưa đăng nhập tạo một user "Khách", làm danh sách Người dùng toàn dòng "Khách" và phình số người dùng (R-68).
- Tổng quan chỉ có số cộng dồn từ đầu, không có hôm nay hay 7 ngày, không có tỉ lệ khách mua lại (R-74).
- Ô ngày hiện `mm/dd/yyyy` theo trình duyệt, dễ nhập nhầm 03/10 thành 10/03 khi lọc đơn hay đặt hạn mã (R-69).
- Admin 375: danh sách đơn bắt đầu ở màn thứ hai, bảng cuộn ngang, bảng món đổi rác mất cột Trạng thái và nút Sửa, mỗi tab lặp tiêu đề và nút "Màn thu ngân" (R-70, R-72, R-146).
- Báo cáo vi phạm cộng đồng chỉ có ở Mini App, không có trên web admin (R-75).

## Đã làm
Chỉ đổi web admin và API quản trị. Không đổi Mini App.

Hôm nay và hộp việc:
- R-13: hộp việc thêm đơn chuyển khoản chờ tiền, gian hàng chờ duyệt, báo cáo cộng đồng, sản phẩm đang bán thiếu ảnh. Gian hàng chờ duyệt không đếm khi cờ yêu cầu duyệt đang tắt. Bấm thẻ chuyển khoản mở danh sách đơn đã lọc (tham số API `queue=bank_transfer_to_confirm`, dùng chung điều kiện với số đếm và file xuất). Điện thoại hiện dòng giải thích ngoài ngăn kéo Lọc. Hạn tự huỷ bỏ qua đơn đã bàn giao vận chuyển.
- R-74: trang "Hôm nay" (API `GET /admin/dashboard/today`, chỉ ADMIN): đơn, doanh thu, khách mới hôm nay và 7 ngày, tỉ lệ mua lại 30 ngày, việc chờ. Doanh thu trừ hoàn một phần, cùng định nghĩa với Báo cáo. Nhóm "Hay dùng" trong menu, huy hiệu số việc chờ (không cộng sản phẩm thiếu ảnh, không đếm hai lần).
- R-144, R-146: hộp việc gọn khi rỗng; ẩn tiêu đề lặp và nút "Màn thu ngân" khi tích điểm tại quầy tắt.

Người dùng:
- R-68: danh sách mặc định chỉ tài khoản thật, khách vãng lai đếm riêng và hiện bằng chip "Hiện cả khách vãng lai (n)". "Khách mới" ở Hôm nay và Báo cáo, cùng file CSV người dùng, đều bỏ khách vãng lai. Không xoá dữ liệu.

Đơn hàng và ô ngày:
- R-69: ô ngày `dd/mm/yyyy` cho Đơn, Mã giảm giá, Báo cáo. Nhận cả dán `yyyy-mm-dd`, báo "chưa áp dụng" khi gõ dở, báo "Ngày không có thật" với 31/02. Nút Tạo mã và Lưu hạn khoá khi ngày gõ dở hoặc Hết hạn sớm hơn Bắt đầu. Dòng nhắc xuống dòng trong bề rộng ô.
- Admin 375, Đơn: thẻ thay bảng, nút Lọc, chữ thanh toán bằng lời ("Chưa thanh toán" thay "Chưa TT"). Hàng chip trạng thái không còn làm trang tràn ngang.
- R-147: bỏ chữ kỹ thuật ở sản phẩm đối tác.

Mã giảm giá, đổi rác, sản phẩm:
- R-71: tab Mã giảm giá mở danh sách trước, có nút "Mở Cấu hình" thay tên khoá.
- R-72, R-145: món đổi rác dạng thẻ trên điện thoại, tách cột Giọt nước/Gram, ẩn mã máy; tab Đổi rác mở "Yêu cầu".
- R-73: chip "Chưa có danh mục (n)", thêm lối vào sản phẩm thiếu ảnh.

Cộng đồng và đại lý:
- R-75 (phần web): hàng "Báo cáo vi phạm" trên web, tab "Báo cáo (n)" lấy số từ hộp việc.
- R-148 (một phần): tab Đại lý có tiêu đề.

Hiệu năng: tab Đổi rác và Cộng đồng tải lười, First Load `/admin` giảm khi vào trang.

Kiểm thử: test race cho hộp việc và Hôm nay trên Postgres thật; spec route `dashboard/today` trong bảng quyền; mock e2e khung admin (commit 8f8f7afd0) cho mọi project web. Trước commit này `pro.web.spec` mở `/admin` trong project khách và lỗi 6 test.

## Làm một phần hoặc để sau
- R-70 (chip trạng thái đơn chưa có số): cần API đếm theo trạng thái. Chuyển gói sau.
- R-75 (bộ tab chung với Mini, tab "Báo cáo (n)" ở Mini): chuyển gói sau.
- R-148 (ô lọc Đại lý thành chip có số, chip "Chờ duyệt" có số): chuyển gói sau.
- R-149 (khung xương thay "Đang tải…", staleTime): QueryClient dùng chung với app khách, cần đổi toàn cục. Chuyển gói sau.
- R-166: Báo cáo nguồn khách mới không còn tính khách vãng lai đã mua trong "đơn đầu" và doanh thu 30 ngày theo nguồn (chỉ đổi chữ hiển thị, SQL giữ). Chủ cần biết.
- P3 do review lượt D ghi nhận, chưa sửa, đã vào backlog (R-167, R-168, R-169): dòng nhắc lỗi của ô ngày vẫn `absolute`, ở 375 che chữ nút "Tạo mã" khi nút đang khoá; khi Hết hạn sớm hơn Bắt đầu mà chưa rời ô thì nút khoá không kèm câu giải thích; ô ngày đã rời một lần thì gõ dở lại báo đỏ ngay; ảnh `state-coupon-chua-ap-dung` chụp trạng thái lỗi đỏ thay vì dòng xám "Chưa áp dụng".

## Quyết định của chủ áp dụng ở PR này
- R-68: tài khoản thật mới tính là người dùng; khách vãng lai tách riêng.
- R-74: trang đầu là "Hôm nay", nhóm "Hay dùng" trong menu. Trang vào mặc định vẫn là hộp việc.

## Số đo
- Bảng kiểm (`gates/quantri.txt`, FAIL 0): tsc (api, web, miniapp, app-core, e2e, shared-types) sạch; eslint api, miniapp, web sạch; vitest app-core 917, miniapp 4859 (cả TZ=UTC), web 7475; jest api 484 suite / 11224 test; lint:parity xanh; vite build xanh.
- Lần chạy lại sau commit cuối: `gates/quantri-g2.txt` sau `8f8f7afd0`, 0 FAIL: số test như trên, gói Mini entry 711/222 KB, tổng 1911/737 KB. Commit cuối `3a3b2e54e` chỉ sửa e2e; `tsc --noEmit` của e2e chạy lại sạch.
- Race test admin-*/ops-* (Postgres thật): 24 suite, 124 test xanh (theo báo cáo đợt D).
- Playwright: Mini App 205 đạt, 10 bỏ qua (1,4 phút, chạy trước commit cuối; commit đó chỉ đổi mock của project web); web gate 354 đạt, 38 bỏ qua (4,4 phút, chạy sau `3a3b2e54e`). 0 ca hỏng.
- Gói Mini App: không đổi. Entry 711 KB (222 gz) trước và sau. Tổng 1911,3 KB raw / 737,1 KB gz trước và sau (chênh 0,0). Không chunk nào đổi.
- First Load web:

| Trang | Trước | Sau |
|---|---|---|
| `/admin` | 356 kB | 325 kB (sau tải lười Đổi rác và Cộng đồng; báo cáo D đo lại 326 kB) |
| `/admin/pos` | 144 kB | 144 kB |

  Lượt đầu và lượt hai đẩy `/admin` lên 362 kB, rồi tải lười đưa xuống 325 kB.
- Review Opus: 4 lượt (lượt 1, lượt 2, lượt 3, D1). Kết luận cuối ở D1: "merge được". Lượt 3 từng chặn vì test e2e Mini sai chữ nút; đã sửa ở D1. Lượt cuối xem `8f8f7afd0` (mock e2e): "merge được", kèm một P3. Mock khung quản trị cho mọi project web che luôn `GET /me/loyalty/member-card` của trang khách. Đã sửa ở `3a3b2e54e`: chỉ project Web Admin mock khung quản trị, còn `pro.web.spec` tự gọi `adminShellDefaults` trong `beforeEach`. P3 còn lại đã vào backlog (R-167, R-168, R-169).

## Ảnh trước/sau
Báo cáo có ảnh: https://claude.ai/artifact/BAptEQ6qkPB2iABaL2byxi (bản riêng tư, chủ chia sẻ để người khác xem)
Ảnh ở `docs/2026-10-28-review/screens-quantri/before-after/` (ghép trước và sau, admin 375 và 1280). Không có cặp Mini 375 và web 375 vì gói chỉ đổi web admin.
- `tab-dashboard__admin__admin375__s1__ba.png`: trang Hôm nay trên điện thoại.
- `tab-inbox__admin__admin375__s1__ba.png`: hộp việc có hàng đợi mới.
- `tab-orders__admin__admin375__s1__ba.png`: đơn dạng thẻ và nút Lọc trên 375.
- `tab-users__admin__admin375__s1__ba.png`: Người dùng chỉ tài khoản thật, chip khách vãng lai.
- `tab-coupons__admin__admin375__s1__ba.png`: mã giảm giá mở danh sách trước, ô ngày dd/mm/yyyy.
- `tab-waste__admin__admin1280__s1__ba.png`: tab Đổi rác (món dạng thẻ, bỏ mã máy).
- Ảnh trạng thái mới (không ghép, ở `screens-quantri/admin375/`): `state-coupon-ngay-khong-co-that.png`, `state-orders-hang-doi-chuyen-khoan.png`.

## Cách kiểm
1. Vào `/admin` bằng tài khoản ADMIN. Mục "Hôm nay" hiện đơn, doanh thu, khách mới, tỉ lệ mua lại; so doanh thu với Báo cáo cùng khoảng ngày, hai số phải khớp.
2. Tạo một đơn chuyển khoản chưa thanh toán. Hộp việc phải đếm nó. Bấm thẻ thì danh sách đơn chỉ còn các đơn chuyển khoản chờ tiền.
3. Tab Người dùng: mặc định không có dòng "Khách"; bấm chip "Hiện cả khách vãng lai" mới thấy.
4. Tab Mã giảm giá: gõ ngày `31/02/2026` thấy "Ngày không có thật"; đặt Hết hạn sớm hơn Bắt đầu thì nút Tạo khoá.
5. Mở `/admin` ở khổ 375: Đơn dạng thẻ, không cuộn ngang trang, Đổi rác dạng thẻ. Mở tab Đổi rác và Cộng đồng lần đầu thấy "Đang tải…" một nhịp.
6. Chạy lại cổng: `docs/2026-10-28-review/tools/gate.sh /Users/longla/coding/tubutree-mini-app/.claude/worktrees/r1028-quantri` và `docs/2026-10-28-review/tools/pw-gate.sh /Users/longla/coding/tubutree-mini-app/.claude/worktrees/r1028-quantri <cổng gốc>`.

## Deploy và migration
Không có migration. Không có biến môi trường hay khoá cấu hình mới. Có thêm một route API `GET /admin/dashboard/today` và tham số `queue` cho danh sách và xuất đơn; deploy API cùng lúc với web.

## Thứ tự merge
1 doirac → 2 khampha → 3 muahang → 4 taikhoan → 5 diemxanh → 6 ctv → 7 quantri → 8 hieunang. Merge PR tài liệu `review/2026-10-28` trước. Nhánh gói tách từ ba commit tài liệu của PR đó, nên trước khi PR tài liệu được merge, diff sẽ có thêm `docs/2026-10-28-review/`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
