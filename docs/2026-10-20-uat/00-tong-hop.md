# Tổng hợp review + UAT đêm 2026-10-20

Bản nháp. Nhánh uat/2026-10-20. Tổng hợp từ 15 báo cáo D1 đến D15, 98-cau-hoi.md, impl/dot1.md và ba workflow sửa (w4, w6, w7).

Tổng cộng 140 mục. Theo mức: P0 là 0, P1 là 11, P2 là 41, P3 là 88.

Cách đếm. Mỗi dòng bảng mục có mã Dx-nn trong bảng tóm tắt của từng báo cáo là một mục. D9 không có bảng, lấy mã từ phần "Phát hiện" (D9-01 đến D9-09). Mức lấy theo cột Mức (sau soát). D1-01 tính P2 vì đã hạ từ P1 khi soát. Mã chỉ nhắc chéo trong báo cáo khác (ví dụ D8-12 trong D6) không tính hai lần.

Đã đưa vào gói sửa: 87 mục. Đợt 1 là 25 mục (đã gộp). Đợt 2 là 18 mục (đang làm). Đợt 3 là 44 mục (đang làm). Một số mục chỉ vào gói một phần, ghi rõ ở cột Trạng thái.

Chưa có gói, hoãn đợt 4: 38 mục (gồm 9 mục đang chờ câu hỏi Q). Chuyển phiên web: 9 mục (D7-28 đến D7-36). Không sửa: D6-22, D10-09. Chỉ báo phiên web: D8-5, D15-05. Chủ tự làm, không có gói: D6-21, D8-17. D15-01 vừa vào gói đợt 2 (phần API), vừa có phần chuyển phiên web.

Theo nhóm: agent sửa ngay 110, cần chủ quyết 26, chủ tự làm 4. Nhóm lấy theo cột Nhóm của báo cáo, có chỉnh khi báo cáo ghi nhóm lẫn.

Mục không xếp được gói: không có. Hai chỗ suy từ mã, cần xác nhận. D8-16 xếp vào gói miniapp-logic vì cùng about-data.ts với D14-06. D7-03, D7-10 và D7-13 xếp qua D15-03 và D15-04 vì cùng nút ở admin/page.tsx.

## Bảng mục

| Mã | Mức | Tóm tắt | Nhóm | Gói/đợt | Trạng thái |
|---|---|---|---|---|---|
| D1-01 | P2 | Thưởng đánh giá và nhiệm vụ cấp ngay khi giao, trả đơn không thu hồi | agent sửa ngay | thuong-tra-hang | đợt 1 đã gộp |
| D1-02 | P1 | Voucher mốc chi tiêu cấp từ đơn còn trong hạn đổi trả | agent sửa ngay | voucher-moc | đợt 1 đã gộp |
| D1-03 | P2 | Đơn đại lý và đơn CTV lên hộ được tính vào hạng của đại lý/CTV | cần chủ quyết (Q1) | voucher-moc (chỉ phần voucher mốc; xét hạng chưa đổi) | đợt 1 đã gộp; xét hạng chờ Q1 |
| D1-04 | P2 | Ngưỡng TNCN 2 triệu xét từng lần rút, rút nhỏ nhiều lần không bị trừ | cần chủ quyết (Q2) | - | hoãn đợt 4 (chờ Q2) |
| D2-01 | P1 | Marketing vượt trần mã nhân viên qua flash sale (giảm 90%, tự mua) | cần chủ quyết (Q3) | flash-sale-staff | đợt 1 đã gộp |
| D2-02 | P1 | CSKH và Marketing ghim được bài cộng đồng, trái luật B8 | agent sửa ngay | quyen-admin | đợt 1 đã gộp |
| D2-03 | P3 | Hộp "Việc cần xử lý" không hiện hoá đơn VAT chờ cho kế toán | agent sửa ngay | quyen-admin | đợt 1 đã gộp |
| D2-04 | P3 | Kế toán dò lại SĐT đầy đủ bằng tìm chuỗi con trên danh sách đã che | cần chủ quyết | quyen-admin | đợt 1 đã gộp |
| D2-05 | P2 | Thiếu kiểm tra chủ sở hữu: nhân viên sửa hoặc bật lại sale/mã do ADMIN tạo | cần chủ quyết (liên quan Q3) | flash-sale-staff | đợt 1 đã gộp |
| D3-01 | P1 | Runbook và deploy.sh còn coi --with-business-defaults là chờ duyệt | agent sửa ngay | trien-khai | đợt 1 đã gộp |
| D3-02 | P3 | grant-admin.js không chuẩn hoá ADMIN_PHONE | agent sửa ngay | trien-khai | đợt 1 đã gộp |
| D3-03 | P3 | .env.production.example thiếu bốn khoá Zalo OA và cookie | agent sửa ngay | trien-khai | đợt 1 đã gộp |
| D3-04 | P3 | Bản xem trước cleanup-demo còn cảnh báo cũ về WELCOME30, FREESHIP, XANH10 | agent sửa ngay | trien-khai | đợt 1 đã gộp |
| D3-05 | P3 | Số kỳ vọng ở bước 7b trong runbook đã cũ | agent sửa ngay | trien-khai | đợt 1 đã gộp |
| D4-01 | P3 | Pancake push có thể tạo hai đơn vì đọc trạng thái trước khi claim | agent sửa ngay | race-p3 | đợt 1 đã gộp |
| D4-02 | P3 | Điểm danh Vườn Xanh ghi đè vé giữ lửa và chuỗi ngày từ lần đọc cũ | agent sửa ngay | race-p3 | đợt 1 đã gộp |
| D4-03 | P3 | Tính lại lương chạy không khoá, có thể ghi đè tháng đã chốt hoặc đã chi | agent sửa ngay | race-p3 | đợt 1 đã gộp |
| D4-04 | P3 | Giới hạn số nhóm mua chung mở mỗi người đếm ngoài giao dịch, request song song vượt qua | agent sửa ngay | zns | đợt 1 đã gộp |
| D4-05 | P3 | Tự trả lời Zalo OA bị gửi lại khi job BullMQ bị kẹt | agent sửa ngay | race-p3 | đợt 1 đã gộp |
| D5-01 | P1 | ZNS gửi SĐT dạng 0xxxxxxxxx, ví dụ Zalo dùng 84xxxxxxxxx | agent sửa ngay | zns | đợt 1 đã gộp |
| D5-02 | P2 | Không có giờ yên tĩnh và không có trần 2 tin hậu mãi mỗi khách mỗi tháng | cần chủ quyết (Q4) | zns | đợt 1 đã gộp |
| D5-03 | P2 | Tin câu trả lời hay nhất hứa Điểm Xanh dù không cộng | agent sửa ngay | tin-cong-dong | đợt 1 đã gộp |
| D5-04 | P2 | Tài liệu ZNS lệch mẫu đã chốt, GROUP_BUY_SUCCESS thiếu tham số | cần chủ quyết | zns | đợt 1 đã gộp |
| D5-05 | P3 | Webhook OA kiểm header x-webhook-token tự đặt, Zalo dùng chữ ký riêng | cần chủ quyết (Q5) | - | hoãn đợt 4 (chờ Q5) |
| D5-06 | P3 | Công tắc Vườn Xanh không chặn tin tặng nước và câu trả lời mới, không gộp 60 phút | cần chủ quyết (Q6) | tin-cong-dong | đợt 1 đã gộp |
| D5-07 | P3 | CASHBACK_PAID có thể gửi "Hoàn tiền 0đ" | agent sửa ngay | tin-cong-dong | đợt 1 đã gộp |
| D6-01 | P2 | Hàng tiêu đề màn chuyển khoản bị tách đôi, đệm trên chồng nhau | agent sửa ngay | - | hoãn đợt 4 |
| D6-02 | P2 | Lỗi hoặc offline ở màn chuyển khoản chỉ là chữ trơn, không hotline | agent sửa ngay | - | hoãn đợt 4 |
| D6-03 | P2 | Cảnh báo địa giới cũ nằm sau cả danh sách địa chỉ, không rõ thuộc thẻ nào | agent sửa ngay | ui-miniapp-1 | đợt 3 đang làm |
| D6-04 | P2 | Món "Sắp có" mờ 0,55 làm chữ dưới 4,5:1 | agent sửa ngay | ui-miniapp-1 (chỉ recycle.tsx:304) | đợt 3 đang làm; phần còn (recycle-new.tsx) hoãn đợt 4 |
| D6-05 | P2 | Cộng đồng: gần 380px đầu trang trước bài đầu, Xếp hạng/Sự kiện chỉ là icon | agent sửa ngay | ui-miniapp-1 | đợt 3 đang làm |
| D6-06 | P3 | Điểm Xanh ghi dấu chấm thập phân và "điểm Xanh" viết thường | agent sửa ngay | ui-miniapp-1 | đợt 3 đang làm |
| D6-07 | P2 | Gọi Vườn Xanh là "Vườn Cây", trái tên đã chốt | agent sửa ngay | ui-miniapp-1 | đợt 3 đang làm |
| D6-08 | P3 | Danh mục lỗi tải vẫn ghi "0 sản phẩm" | agent sửa ngay | ui-miniapp-1 | đợt 3 đang làm |
| D6-09 | P3 | Mọi danh mục cùng một icon, tên bị cắt một dòng | agent sửa ngay | ui-miniapp-1 | đợt 3 đang làm |
| D6-10 | P3 | Dòng sản phẩm chỉ có đơn giá, không có thành tiền khi số lượng lớn hơn 1 | agent sửa ngay | ui-miniapp-1 | đợt 3 đang làm |
| D6-11 | P3 | Số Điểm Xanh price-xl gãy dòng vì cột giữa hẹp | agent sửa ngay | - | hoãn đợt 4 |
| D6-12 | P3 | Hướng dẫn "Giữ nguyên nội dung" là chữ đỏ nhỏ như báo lỗi | agent sửa ngay | - | hoãn đợt 4 |
| D6-13 | P3 | Số điểm và tiền ở Cá nhân dùng font serif Fraunces | agent sửa ngay | ui-miniapp-1 | đợt 3 đang làm |
| D6-14 | P3 | Tên sản phẩm đang ẩn mờ 0,5, chữ 3,31:1 | agent sửa ngay | ui-miniapp-1 | đợt 3 đang làm |
| D6-15 | P3 | "Cần hỗ trợ?" lặp ngay trên SupportContact | agent sửa ngay | ui-miniapp-1 | đợt 3 đang làm |
| D6-16 | P3 | Ô tìm kiếm 42px và bóng gợi ý dưới 44px, bóng che nội dung | agent sửa ngay | ui-miniapp-1 | đợt 3 đang làm |
| D6-17 | P3 | Ba cách ghi "miễn phí ship/vận chuyển/giao" ở ba màn | agent sửa ngay | - | hoãn đợt 4 |
| D6-18 | P3 | Hai ngưỡng freeship 200.000đ và 199.000đ hiện ở hai màn | cần chủ quyết (Q12) | - | hoãn đợt 4 (chờ Q12) |
| D6-19 | P3 | Emoji còn làm icon ngoài game và hạng | agent sửa ngay | ui-miniapp-1 | đợt 3 đang làm |
| D6-20 | P3 | Thanh toán không có dòng "dự kiến giao", UAT để shippingEta null | agent sửa ngay; giá trị shippingEta chủ tự điền | ui-miniapp-1 | đợt 3 đang làm |
| D6-21 | P2 | Thiếu VITE_ZALO_OA_ID và VITE_CLOUDINARY_* thì mất icon Chat OA và đổi ảnh đại diện | chủ tự làm | - | chủ tự làm (không có gói) |
| D6-22 | P3 | Email CSKH công khai vẫn là tubutree@gmail.com | chủ tự làm | - | không sửa (không phải lỗi: B11 giữ tubutree@gmail.com) |
| D7-01 | P2 | Nút Duyệt lệnh rút tiền chạy ngay, không hỏi lại | agent sửa ngay | ui-admin-1 | đợt 3 đang làm |
| D7-02 | P2 | Đã chuyển và Đã thu ở đối soát đối tác không hỏi lại | agent sửa ngay | ui-admin-1 | đợt 3 đang làm |
| D7-03 | P2 | Từ chối hồ sơ đại lý chạy ngay, lý do cứng (cùng lỗi D15-03) | agent sửa ngay | admin-web | đợt 2 đang làm (qua D15-03) |
| D7-04 | P2 | Duyệt xoá tài khoản dùng window.confirm gốc | agent sửa ngay | ui-admin-1 | đợt 3 đang làm |
| D7-05 | P2 | Tab Hoàn tiền sàn ngoài hiện trạng thái tiếng Anh | agent sửa ngay | ui-admin-1 | đợt 3 đang làm |
| D7-06 | P2 | Dòng đổi/trả hiện mã kênh thanh toán thô (WALLET, BANK_TRANSFER) | agent sửa ngay | ui-admin-1 | đợt 3 đang làm |
| D7-07 | P2 | Cột Điểm Xanh hiện số không dấu chấm ngăn cách | agent sửa ngay | ui-admin-1 | đợt 3 đang làm |
| D7-08 | P2 | Tab Cấu hình liệt kê 209 khoá thành ô sửa JSON, không tìm, không chia nhóm | agent sửa ngay | - | hoãn đợt 4 |
| D7-09 | P2 | CSKH và Marketing ghim bài cộng đồng, trái luật chỉ ADMIN ghim (cùng D2-02) | cần chủ quyết | quyen-admin | đợt 1 đã gộp (qua D2-02) |
| D7-10 | P2 | Xoá khoá học và xoá món flash sale đang bật không hỏi lại (cùng D15-04) | agent sửa ngay | admin-web | đợt 2 đang làm (qua D15-04) |
| D7-11 | P3 | Badge vai trò hiện mã thô AFFILIATE, DEALER, STAFF | agent sửa ngay | ui-admin-1 | đợt 3 đang làm |
| D7-12 | P3 | Thông báo đổi vai trò và danh sách thưởng đại lý dùng mã thô | agent sửa ngay | - | hoãn đợt 4 |
| D7-13 | P3 | Nút xoá/gỡ/tắt chạy ngay (7 chỗ) | agent sửa ngay | admin-web (qua D15-04, 6 nút) | đợt 2 đang làm; phần còn (Tắt flash sale đang chạy, page.tsx:2446) hoãn đợt 4 |
| D7-14 | P3 | Từ chối đổi/trả và Đã nhận hàng về không hỏi lại | agent sửa ngay | ui-admin-1 | đợt 3 đang làm |
| D7-15 | P3 | Thao tác hàng loạt và chốt sổ không hỏi lại | agent sửa ngay | ui-admin-1 | đợt 3 đang làm |
| D7-16 | P3 | Hộp Đã chi không tông danger, thiếu tên và tài khoản nhận | agent sửa ngay | ui-admin-1 | đợt 3 đang làm |
| D7-17 | P3 | axe: dl chứa con sai chuẩn trên 13 trang | agent sửa ngay | ui-admin-1 | đợt 3 đang làm |
| D7-18 | P3 | axe: chữ #89847c trên #e7e2d6 chỉ 2.87:1 | agent sửa ngay | ui-admin-1 | đợt 3 đang làm |
| D7-19 | P3 | 28/41 tab chỉ hiện chữ đỏ khi lỗi, không có nút Thử lại | agent sửa ngay | - | hoãn đợt 4 |
| D7-20 | P3 | Không có link "Bỏ qua tới nội dung", Tab qua 41 mục menu | agent sửa ngay | ui-admin-1 | đợt 3 đang làm |
| D7-21 | P3 | Mở thẳng tab cuối menu thì mục đang chọn nằm ngoài khung nhìn | agent sửa ngay | ui-admin-1 | đợt 3 đang làm |
| D7-22 | P3 | Tab không có quyền rơi về tab đầu nhưng URL vẫn là ?tab=users | agent sửa ngay | - | hoãn đợt 4 |
| D7-23 | P3 | Kế toán không duyệt nhưng tab vẫn tên "Duyệt…", nhãn nhắc quà đổi điểm cũ | agent sửa ngay | - | hoãn đợt 4 |
| D7-24 | P3 | Giao diện ghi đường dẫn docs/GO-LIVE-KEYS.md nhân viên không mở được | agent sửa ngay | ui-admin-1 | đợt 3 đang làm |
| D7-25 | P3 | Ô nhập không có nhãn, gõ xong là mất placeholder | agent sửa ngay | - | hoãn đợt 4 |
| D7-26 | P3 | Ở 1440, tên khách và nút xuống dòng, cột mã đơn rộng thừa, bảng Đổi rác dồn cột | agent sửa ngay | - | hoãn đợt 4 |
| D7-27 | P3 | Hai tab thiếu h2, tab Danh mục hiện lỗi hai lần | agent sửa ngay | ui-admin-1 | đợt 3 đang làm |
| D7-28 | P3 | Hai trang dùng max-w-3xl, khung chỉ rộng 736px, lưới nhãn 2 cột | agent sửa ngay (phiên web) | - | chuyển phiên web (lô 1, 22:39) |
| D7-29 | P3 | Thẻ Mua lại lòi nửa dòng thứ 3 của tên sản phẩm | agent sửa ngay (phiên web) | - | chuyển phiên web (lô 1, 22:39) |
| D7-30 | P3 | Rail thẻ rộng cố định ở trang chủ web chỉ lấp 2/3 bề ngang | agent sửa ngay (phiên web) | - | chuyển phiên web (lô 1, 22:39) |
| D7-31 | P3 | Trang chủ web có hai ô tìm kiếm chồng nhau | agent sửa ngay (phiên web) | - | chuyển phiên web (lô 1, 22:39) |
| D7-32 | P3 | axe: ProgressBar của flash sale ở web không có tên | agent sửa ngay (phiên web) | - | chuyển phiên web (lô 1, 22:39) |
| D7-33 | P3 | Địa chỉ địa giới cũ có cảnh báo nhưng nút Đặt hàng vẫn bật | agent sửa ngay (phiên web) | - | chuyển phiên web (lô 1, 22:39) |
| D7-34 | P3 | Giỏ hàng: "Chọn tất cả" đếm dòng, "Thanh toán" đếm số lượng | agent sửa ngay (phiên web) | - | chuyển phiên web (lô 1, 22:39) |
| D7-35 | P3 | Thẻ đầu gian hàng web có khoảng trống lớn giữa tên và nút Chia sẻ | agent sửa ngay (phiên web) | - | chuyển phiên web (lô 1, 22:39) |
| D7-36 | P3 | Cộng đồng web: hai nút chỉ có icon, không chữ hay tooltip | agent sửa ngay (phiên web) | - | chuyển phiên web (lô 1, 22:39) |
| D8-1 | P2 | Chữ trắng trên gradient nhãn Fuwa3e, Pơ Lang, Visante, Sokfram chỉ 2,1 đến 3,8:1 | cần chủ quyết | ui-miniapp-1 | đợt 3 đang làm |
| D8-2 | P2 | Viền ô nhập, checkbox, radio 1,72:1 và nền công tắc tắt 1,39:1, dưới 3:1 | cần chủ quyết | ui-miniapp-1 | đợt 3 đang làm |
| D8-3 | P2 | Lỗi 401 hiện nguyên chữ "Unauthorized" | agent sửa ngay | perf-api | đợt 3 đang làm |
| D8-4 | P2 | Tóm tắt đổi trả cứng "7 ngày" và chỉ nói hoàn vào Ví Tubu | agent sửa ngay | ui-miniapp-1 | đợt 3 đang làm |
| D8-5 | P1 | Trang /chinh-sach/* còn [Tên công ty], [số ngày] vì legal.* rỗng | chủ tự làm | - | chỉ báo phiên web |
| D8-6 | P3 | Hàng bậc đang khoá làm mờ cả hàng, chữ 2,55:1 | agent sửa ngay | ui-miniapp-1 | đợt 3 đang làm |
| D8-7 | P3 | Sao rỗng màu stone-200, 1,39:1 trên nền trắng | agent sửa ngay | ui-miniapp-1 | đợt 3 đang làm |
| D8-8 | P3 | Vùng bấm div/Box/Text có onClick nhưng không role, không phím | agent sửa ngay | - | hoãn đợt 4 |
| D8-9 | P3 | Ô nhập chỉ có placeholder hoặc không có tên truy cập | agent sửa ngay | ui-miniapp-1 | đợt 3 đang làm |
| D8-10 | P3 | 70 ô nhập admin chỉ có placeholder | agent sửa ngay | ui-admin-1 (chỉ merchant-products-tab) | đợt 3 đang làm; page.tsx hoãn đợt 4 |
| D8-11 | P3 | Màn chủ ghi "Voucher chào mừng", thanh toán ghi "mã giảm giá" | agent sửa ngay | - | hoãn đợt 4 |
| D8-12 | P3 | Tiếng Anh và biệt ngữ ở game, nhân viên, CTV, thanh điều hướng admin | cần chủ quyết (Q16) | - | hoãn đợt 4 (chờ Q16) |
| D8-13 | P3 | Chính tả "Đắc Lắk", "giới hạn hạn mức", "hiện tại tại thời điểm" | agent sửa ngay | ui-miniapp-1 | đợt 3 đang làm |
| D8-14 | P3 | Trang chủ ghi "6 vùng đất", dữ liệu có 8 nhãn, 7 tỉnh | cần chủ quyết (Q14) | - | hoãn đợt 4 (chờ Q14) |
| D8-15 | P3 | Lẫn hai kiểu bỏ dấu: Hủy/Huỷ, Xóa/Xoá, khóa/khoá | cần chủ quyết (Q13) | - | hoãn đợt 4 (chờ Q13) |
| D8-16 | P3 | Câu "điểm quy đổi từ xu cũ" luôn hiện trong FAQ (cùng about-data.ts với D14-06) | cần chủ quyết | miniapp-logic (qua D14-06) | đợt 2 đang làm (qua D14-06) |
| D8-17 | P3 | Số hotline và email dự phòng viết cứng, chủ cần xác nhận là số thật | chủ tự làm | - | chủ tự làm (không có gói) |
| D8-18 | P3 | Hai câu i18n pointsUse, pointsAvailable không ai dùng | agent sửa ngay | - | hoãn đợt 4 |
| D9-01 | P2 | Báo cáo Khách mới theo nguồn chuyển kế hoạch generic, chạy bình phương | agent sửa ngay | perf-api | đợt 3 đang làm |
| D9-02 | P2 | POST /events ghi từng sự kiện một: N sự kiện thành N INSERT | agent sửa ngay | perf-api | đợt 3 đang làm |
| D9-03 | P2 | Bundle Mini App entry 685 KB, tăng 11% so với đo 09/10 | cần chủ quyết (Q15) | - | hoãn đợt 4 (chờ Q15) |
| D9-04 | P3 | bought-together quét toàn bộ dòng hàng 90 ngày mỗi lần xem, không cache | agent sửa ngay | perf-api | đợt 3 đang làm |
| D9-05 | P3 | repurchase dựng lại cả giỏ cho từng dòng, khoảng 28 truy vấn mỗi dòng | agent sửa ngay | perf-api | đợt 3 đang làm |
| D9-06 | P3 | Dashboard và báo cáo doanh thu admin quét toàn bảng orders | agent sửa ngay | - | hoãn đợt 4 |
| D9-07 | P3 | Đọc thừa cố định trên đường giỏ đến thanh toán | agent sửa ngay | - | hoãn đợt 4 |
| D9-08 | P3 | Logo Trang chủ PNG 1059×384 hiển thị ở 83×30 | agent sửa ngay | - | hoãn đợt 4 |
| D9-09 | P3 | Danh sách mã giảm giá admin quét bảng coupons 4 lần mỗi lượt | agent sửa ngay | - | hoãn đợt 4 |
| D10-01 | P1 | Build Mini App thiếu VITE_API_BASE_URL vẫn thoát 0 và nhúng localhost | agent sửa ngay; giá trị Cloudinary và OA chủ tự làm | ui-miniapp-1 | đợt 3 đang làm |
| D10-02 | P2 | Hai tài liệu ghi lệnh với docker-compose.prod.yml, VPS dùng file khác | agent sửa ngay | - | hoãn đợt 4 |
| D10-03 | P2 | Mẫu sinh mật khẩu Postgres bằng openssl base64 làm hỏng DATABASE_URL | agent sửa ngay | - | hoãn đợt 4 |
| D10-04 | P3 | Compose prod dự phòng lệch compose vietnix | agent sửa ngay | - | hoãn đợt 4 |
| D10-05 | P3 | Runbook mục 1.3 lệch mã (OPS_ALERT_EMAIL_TO, SMTP) | agent sửa ngay | - | hoãn đợt 4 |
| D10-06 | P3 | Runbook mục 0.2 đếm sai số migration | agent sửa ngay | - | hoãn đợt 4 |
| D10-07 | P3 | HEAVY_MIGRATIONS thiếu ba migration khoá bảng orders | agent sửa ngay | - | hoãn đợt 4 |
| D10-08 | P3 | Hành động gin của ops.yml gọi script với biến COMPOSE_FILE sai ngữ cảnh | agent sửa ngay | - | hoãn đợt 4 |
| D10-09 | P3 | Container API chạy bằng root, web chạy bằng node | cần chủ quyết | - | không sửa (chủ đã chốt để sau ra mắt) |
| D10-10 | P3 | File mẫu .env và khoá cấu hình lệch nhau | cần chủ quyết (mục e); còn lại agent sửa ngay | - | hoãn đợt 4 |
| D11-01 | P1 | Đơn sỉ không có tối thiểu 3 triệu, luôn miễn phí giao, không khoá mua chịu | cần chủ quyết (Q7) | dai-ly | đợt 2 đang làm |
| D11-02 | P1 | Thu hồi thưởng quý lấy cả đơn không nằm trong lần trả thưởng | agent sửa ngay | dai-ly | đợt 2 đang làm |
| D11-03 | P2 | Thưởng quý chốt một lần ngày 10, đơn chốt muộn mất thưởng vĩnh viễn | cần chủ quyết (Q8) | - | hoãn đợt 4 (chờ Q8) |
| D11-04 | P3 | Bậc giảm giá định kỳ đếm cả gói hẹn ngày xa, tạo gói ảo để lên 15% | cần chủ quyết (Q10) | - | hoãn đợt 4 (chờ Q10) |
| D11-05 | P3 | Mã mua chung tính 15% trên giá biến thể rẻ nhất, biến thể đắt giảm quá ít | agent sửa ngay | - | hoãn đợt 4 |
| D12-01 | P1 | Pancake "Đã hoàn" trên đơn COD đã giao tự hoàn toàn bộ vào Ví | cần chủ quyết (Q9) | pancake-hoan-cod | đợt 2 đang làm |
| D12-02 | P2 | Sau CANCELLED/RETURNED không thử lại, lỗi hoàn điểm làm mất khoản hoàn | agent sửa ngay | - | hoãn đợt 4 |
| D13-01 | P2 | API không ép luật hộp sữa và vỏ chai Tubu chỉ kho HCMC nhận | agent sửa ngay | doi-rac-kho | đợt 2 đang làm |
| D14-01 | P1 | Tích điểm đơn sàn: khách chưa có SĐT bị từ chối, không có nút chia sẻ SĐT | agent sửa ngay | miniapp-logic | đợt 2 đang làm |
| D14-02 | P2 | Màn QR chuyển khoản vẫn hiện QR sau khi đơn huỷ hoặc quá hạn | agent sửa ngay | miniapp-logic | đợt 2 đang làm |
| D14-03 | P2 | Rút Ví: lỗi quá thời gian vẫn đổi Idempotency-Key, bấm lại thành lệnh rút thứ hai | agent sửa ngay | miniapp-logic | đợt 2 đang làm |
| D14-04 | P3 | Refresh token lỗi mạng vẫn hạ phiên về idle | agent sửa ngay | miniapp-logic | đợt 2 đang làm |
| D14-05 | P3 | Đếm ngược giờ vàng theo đồng hồ điện thoại, không bù lệch giờ máy chủ | agent sửa ngay | miniapp-logic | đợt 2 đang làm |
| D14-06 | P3 | FAQ dự phòng nói "xu cũ" với mọi khách | cần chủ quyết | miniapp-logic | đợt 2 đang làm |
| D15-01 | P2 | Chủ nhãn chèn CSS tuỳ ý vào /brand/[slug] qua themeColor khuyến mãi | agent sửa ngay (API); trang web phiên web | admin-web (API + Mini App) | đợt 2 đang làm; trang /brand/[slug] chuyển phiên web (lô 1, 22:39) |
| D15-02 | P2 | Form cấp/đổi vai trò mặc định CUSTOMER, hạ vai trò không xác nhận | agent sửa ngay | admin-web | đợt 2 đang làm |
| D15-03 | P2 | Từ chối hồ sơ đại lý chạy ngay, lý do cứng "Không đạt yêu cầu" | agent sửa ngay | admin-web | đợt 2 đang làm |
| D15-04 | P3 | Nhiều nút xoá chạy ngay, kể cả Xoá khoá học xoá cả bài học | agent sửa ngay | admin-web | đợt 2 đang làm |
| D15-05 | P3 | CSP chỉ Report-Only, có unsafe-inline/unsafe-eval, chưa gửi HSTS | cần chủ quyết (Q11) | - | chỉ báo phiên web |
Ghi chú bảng. Cột Gói/đợt ghi tên gói trong tools/w4-fix-wave1.workflow.js, w6-fix-wave2.workflow.js, w7-fix-wave3-ui.workflow.js. Mã Dx-nn của gói lấy từ prompt của gói. "Đợt 1 đã gộp" theo impl/dot1.md.

## Mục P3 còn lại sau review đợt 1

Nguồn: mục "Mục còn lại sau review lượt 2" của từng gói trong impl/dot1.md. Nhóm "agent sửa ngay" là việc không đổi luật. Nhóm "cần chủ quyết" cần chủ chọn phương án. Nhóm "chuyển phiên web" thuộc vùng apps/web ngoài admin.

Gói voucher-moc
- apps/api/src/modules/vouchers/vouchers.service.ts:348-351, :386-389. Cron chỉ xét hai kỳ, đơn có yêu cầu trả APPROVED chưa nhận hàng về bị loại, nên có ca mất mã mốc vĩnh viễn. Nhóm: cần chủ quyết.
- Báo cáo worker (phần red/green). Race chạy ở cổng 25551, ngoài dải cấp cho phiên UAT; dọn ~/.cache/tubu-uat/data-25551 nếu còn. Nhóm: agent sửa ngay (dọn dẹp, lỗi quy trình).

Gói thuong-tra-hang
- apps/api/src/modules/reviews/reviews.service.ts:247-257. rewardAlreadyKept không tính dòng REVIEW_RETURN, nên mua lại sau khi trả bị báo đã nhận thưởng. Nhóm: cần chủ quyết.
- apps/api/src/modules/reviews/reviews.service.ts:94 và apps/miniapp/src/components/reviews-section.tsx:397. rewardAvailable không xét từng đơn, form gợi ý thưởng nhưng nhận 0. Nhóm: cần chủ quyết.
- apps/api/src/modules/reviews/reviews.service.ts:457 và apps/api/src/modules/auth/auth.service.ts:521. Khoá FOR SHARE mới có thể deadlock với gộp phiên khách, rất hiếm. Nhóm: cần chủ quyết (có thể để nguyên và ghi comment).
- apps/web/src/lib/ledger-labels.ts:66-67,91. Dòng REVIEW_RETURN hiện nhãn "Đánh giá sản phẩm". Nhóm: chuyển phiên web.
- apps/api/src/modules/game/game.service.ts:38. Câu MISSION_WAITING_NOTE chưa đúng khi đơn qua hạn nhưng còn yêu cầu trả REQUESTED. Nhóm: cần chủ quyết (chữ).

Gói flash-sale-staff
- apps/api/src/modules/flash-sale/flash-sale.service.ts:118-122, :441. Hai nhân viên vẫn tự giảm giá cho nhau qua sale của nhau; coupon có cùng khe hở. Nhóm: cần chủ quyết.
- apps/api/src/modules/flash-sale/flash-sale.service.ts:436. Trần 100.000đ kiểm theo từng món, không theo đơn. Nhóm: cần chủ quyết.
- apps/api/src/modules/admin/coupon-input-rules.ts:163-169 và apps/api/src/modules/flash-sale/flash-sale.service.ts:310-315. Món ADMIN thêm vào sale của nhân viên bị tính vào ngân sách ngày của nhân viên, và nhân viên bật lại được sale ADMIN đã tắt. Nhóm: cần chủ quyết.
- apps/api/src/modules/flash-sale/flash-sale.service.ts:122, :151-180. Nhân viên mua sale của chính mình bị mất giá flash mà không có thông báo. Nhóm: agent sửa ngay (tuỳ chọn, thêm thông báo).

Gói quyen-admin
- apps/web/src/components/admin/ops-inbox-tab.tsx:23, apps/web/src/app/admin/page.tsx:480, apps/web/src/components/admin/payout-admin-tab.tsx:48. ADMIN bấm thẻ "Lệnh rút tiền chờ chi" thấy danh sách trống vì tab lọc REQUESTED. Nhóm: cần chủ quyết.
- apps/api/src/modules/ops/ops-inbox.service.ts:100 và apps/api/src/modules/dealer/dealer-admin.controller.ts:49-53. Thưởng đại lý đã duyệt chờ chi không có khoá trong hộp việc của KE_TOAN. Nhóm: cần chủ quyết (có thể làm gói sau).
- apps/web/src/lib/admin-client.ts:1668. Gói sửa một dòng ở vùng phiên web (thêm payoutsToPay vào InboxKey). Nhóm: chuyển phiên web (báo trước khi gộp).

Gói trien-khai
- apps/api/test/integration-race/reference-seed.race-spec.ts:138 (mức P2). Race spec còn kiểm chữ cũ của seed-reference, đỏ sau commit c9aa3b86. Nhóm: agent sửa ngay.
- apps/api/src/config/grant-admin.spec.ts:147. Comment về tiến trình riêng không còn đúng. Nhóm: agent sửa ngay.
- docs/launch/deploy-rollback-runbook.md:655. Bước 7c còn gọi WELCOME30, FREESHIP, XANH10 là chưa duyệt, trái A4. Nhóm: agent sửa ngay.
- apps/api/src/modules/loyalty/loyalty.service.ts:407. Truy vấn OR có subplan hash trên mọi đơn DELIVERED, chậm dần theo số đơn. Nhóm: agent sửa ngay (chưa cần trước ra mắt).

Gói race-p3
- apps/api/src/modules/staff/payroll/payroll.service.ts:111. recomputeDay không còn nơi gọi, là mã chết. Nhóm: agent sửa ngay.
- apps/api/src/modules/staff/attendance/attendance.service.ts:327,337,357,380 và payroll.service.ts:373-375. Ba docblock không khớp luồng hiện tại. Nhóm: agent sửa ngay.
- apps/api/src/modules/staff/payroll/payroll.service.ts:405-416. reopen chạy updateMany ngoài withMonthLock, hai admin bấm cùng lúc thì tháng thành PAID. Nhóm: agent sửa ngay.
- apps/api/src/modules/staff/shifts/shifts.service.ts:226-236 và attendance.service.ts:232. Vài ghi đầu vào lương vẫn chạy ngoài khoá tháng. Nhóm: cần chủ quyết.

Gói zns
- apps/api/src/modules/notifications/notifications.service.ts:180, docs/GO-LIVE-KEYS.md:84,109. REVIEW_REQUEST bị tính vào trần 2 tin ZNS hậu mãi, tài liệu tự mâu thuẫn. Nhóm: cần chủ quyết.
- docs/launch/pilot-order-playbook.md:213-216. Playbook chưa nhắc giờ yên tĩnh, người thử có thể đánh "Không đạt" sai. Nhóm: agent sửa ngay.
- apps/api/src/modules/notifications/notifications.service.ts:253, :211. Trần đếm theo lúc tạo log, tin gửi 08:00 hôm sau có thể lệch sang tháng sau. Nhóm: agent sửa ngay (hoặc chấp nhận và ghi tài liệu).
- apps/api/src/modules/notifications/notifications.service.ts:196-214. quietDelayMs đọc cấu hình sau khi ghi log PENDING và ngoài try/catch, lỗi DB làm log kẹt PENDING. Nhóm: agent sửa ngay.

Gói tin-cong-dong
- apps/api/prisma/seed.ts:108, system-config.service.ts:104, migration 20261018100100_lr_community_templates_config/migration.sql:10. Mô tả khoá community.author_notify_interval_minutes chưa nói nó gộp cả tin câu trả lời mới. Nhóm: cần chủ quyết (0 có tắt tin trả lời không).

## Câu hỏi cho chủ

Đầy đủ phương án và việc đã làm tạm nằm ở docs/2026-10-20-uat/98-cau-hoi.md.

- Q1 (D1-03). Đơn đại lý và đơn CTV lên hộ có tính vào hạng của chính họ không.
- Q2 (D1-04, B17). Ngưỡng TNCN 2 triệu xét từng lần rút hay cộng dồn trong tháng.
- Q3 (D2-01). Trần mã nhân viên có áp cho flash sale của marketing không.
- Q4 (D5-02). Giờ gửi ZNS và trần 2 tin hậu mãi mỗi khách mỗi tháng.
- Q5 (D5-05). Webhook Zalo OA: bật tự trả lời lúc ra mắt hay viết kiểm chữ ký ngay.
- Q6 (D5-06). Tin tặng nước và câu trả lời mới có theo công tắc Vườn Xanh và gộp 60 phút không.
- Q7 (D11-01). Đơn sỉ dưới 5 triệu thu phí giao bao nhiêu, khoá mua chịu thế nào.
- Q8 (D11-03). Thưởng quý đại lý: trả bù đơn chốt muộn hay giữ chốt một lần.
- Q9 (D12-01). Pancake "Đã hoàn" trên đơn COD đã giao: tự hoàn vào Ví hay chờ người kiểm.
- Q10 (D11-04). Bậc giảm giá định kỳ có đếm gói hẹn ngày xa không.
- Q11 (D15-05). Web: bật HSTS ngay hay siết CSP ngay.
- Q12 (D6-18). Hai ngưỡng freeship 200.000đ và 199.000đ: thống nhất về mức nào.
- Q13 (D8-15). Chữ Mini App dùng kiểu "Huỷ, Xoá, Khoá" hay "Hủy, Xóa, Khóa".
- Q14 (D8-14). Trang chủ ghi "6 vùng đất": bỏ con số hay chủ đưa số đúng.
- Q15 (D9-03). Bundle Mini App 685 KB: giữ cho ra mắt hay thay axios bằng fetch.
- Q16 (D8-12). Việt hoá hết chữ tiếng Anh và biệt ngữ, hay giữ ở màn nhân viên và admin.

## Việc chủ tự làm

Danh sách theo thứ tự nên làm trước khi mở cho khách. Nguồn ghi trong ngoặc. Mục 1 đến 4 lấy từ trạng thái dự án trước đêm UAT và 00-brief.md, không từ báo cáo D. Mục 7 và 9 có phần suy từ báo cáo, cần chủ xác nhận.

1. Điền khoá Pancake thật (PANCAKE_API_KEY, PANCAKE_SHOP_ID) khi deploy. Chưa có khoá thì check-env.js thoát 1 (D10 mục 5 bước 4; trạng thái dự án).
2. Cấu hình DNS cho web và API. Subdomain gian hàng CTV vẫn tắt cho tới khi có DNS wildcard (00-brief.md).
3. Chạy QR UAT: chuyển khoản thật qua màn QR trên bản gần giống production (trạng thái dự án; liên quan D14-02).
4. Nhập FAQ ở tab Cấu hình. FAQ trống thì Mini App dùng bản dự phòng (trạng thái dự án; D14-06, D8-16).
5. Nhập nội dung đã duyệt cho bốn khoá legal.dieu-khoan, legal.bao-mat, legal.doi-tra, legal.van-chuyen: tên công ty, mã số thuế, địa chỉ, số ngày hoàn tiền và giao hàng. Trước đó /chinh-sach/* còn [Tên công ty], [số ngày] (D8-5).
6. Đặt VITE_ZALO_OA_ID và VITE_CLOUDINARY_* khi build Mini App. Thiếu thì mất icon Chat OA và không đổi được ảnh đại diện (D6-21, D10-01).
7. Đặt khoá Zalo OA và ZNS: ZALO_OA_REFRESH_TOKEN, ZALO_OA_WEBHOOK_SECRET, và mẫu ZNS đã duyệt (REVIEW_REQUEST, GROUP_BUY_SUCCESS, GROUP_BUY_FAILED) theo bảng tham số ở docs/GO-LIVE-KEYS.md (D3-03, D5-04, D5-01).
8. Khi có khoá OA, gửi thử một tin vào OA để kỹ thuật đọc header thật của webhook, rồi mới bật tự trả lời (D5-05, Q5).
9. Chạy lại grant-admin với ADMIN_PHONE đúng dạng sau khi sửa D3-02, và nạp seed với cờ --with-business-defaults theo runbook bước 7b (D3-01, D3-02).
10. Xác nhận số hotline và email CSKH là số thật; quyết định có đổi tubutree@gmail.com không (D8-17, D6-22; B11 hiện giữ tubutree@gmail.com).
11. Điền cấu hình shippingEta để màn thanh toán hiện dòng "Dự kiến giao" (D6-20).
12. Hỏi kế toán cách khấu trừ TNCN cho CTV rút nhiều lần (D1-04, Q2, B17).
13. Trả lời Q1 đến Q16 ở mục trên.
14. Khi có SSL: bật HSTS ở Caddy, giữ CSP Report-Only tuần đầu (D15-05, Q11).
