# 06. Đi 6 luồng như khách thật trên web (lane 6, main 9d0e95bd5)

Khổ 375x812 (thêm Thanh toán và Cá nhân ở 1280x800). Script chạy lại được: `tools/flows/web-1.mjs` … `web-6.mjs`, `web-desk.mjs`, thư viện `flow-lib.mjs`, nạp hoa hồng `seed-ctv-order.mjs`. Ảnh: `screens/flows/web/<luồng>/<nn>-<bước>.png`. Không sửa mã sản phẩm.

## Cách đo và giới hạn (đọc trước)
- Chạm = mỗi lần bấm/chọn/tick (gõ một ô chữ = 1, Enter bàn phím = 1). Mở app, tải lại trang, trang tự đổi: 0 chạm.
- Chờ = từ lúc bấm tới khi request fetch/xhr/document cuối cùng xong (không tính khung hình vẽ). Chỉ ghi khi > 1 giây. Chạy trên `next dev` + API lane, máy dùng chung với agent khác, nên số dao động. Trong lần chạy cuối cả 6 luồng không có bước nào > 1 giây. Các lần chạy thử trước ghi được: mở `/ctv` lần đầu 6,3 giây; Tạo yêu cầu đổi rác 4,6 giây và 0,95 giây; mở trang chọn điểm nhận 3,1 giây; mở Vườn Xanh 3,1 giây; Chat 2,0 giây. Coi là nhiễu dev (biên dịch, tải máy), không phải số của production.
- Lane 6 bị agent khác dùng cùng lúc (cùng persona returning/new: đổi điểm, giỏ, vườn, đăng ký CTV). Vì vậy mỗi luồng dùng BẢN SAO persona do script tạo trong DB lane 6 (`uat_webret`, `uat_webrec`, `uat_webnew1`, `uat_webnew6`, `uat_webbuy`, sao từ returning/new, luôn role CUSTOMER). Bản sao không có đơn cũ: hạng Lộc Biếc và điểm là số gán, nên con số "Còn x triệu lên Đại Thụ" của bản sao không phản ánh persona gốc. Persona ctv, dealer, staff, guest, returning (chỉ đọc) dùng trực tiếp.
- Sự cố của tôi: lúc đầu tôi chạy thử trên chính persona returning, có xoá dòng điểm danh/đổi quà/giỏ hôm nay của returning và vài dòng điểm cùng ngày (loại DAILY_CHECKIN, LOYALTY_REDEEM_VOUCHER, GAME_) trên DB lane 6. Có thể làm lệch số liệu của agent kia. Từ đó trở đi mọi thao tác ghi dùng bản sao.
- Đẩy trạng thái đơn bằng `pancake-webhook.mjs` (kho/vận chuyển, không phải chạm của khách).
- Ẩn nút chỉ báo của next dev trong ảnh (nó che nút góc dưới trái, production không có).

## Tổng chạm
| Luồng | Tổng chạm | Ghi chú |
|---|---|---|
| 1 Khách mới | Để sau: 1; đi hết khảo sát: 9 | 7 việc: mỗi việc 1-2 chạm (new), bảng dưới |
| 2 Tìm và mua COD | 11 tới màn thành công | tính ô tìm, gõ, Enter. Có 12 nếu bấm tiếp Theo dõi đơn |
| 3 Theo dõi đơn, mua lại | 6 | xem đơn 3, quay lại 1, Mua lại tới giỏ 2. Từ màn thành công tới chi tiết đơn: 1 |
| 4 Điểm, hạng, Vườn Xanh | 10 | điểm danh 1; xem hạng 3; đổi quà 3; tưới cây 2 |
| 5 Đổi rác | khách 13 (10 tới lúc tạo xong); nhân viên 3 | |
| 6 CTV, đại lý | khách đăng ký CTV 5; CTV xem 4 (+2 tìm Ví Tubu); đại lý 7 | |

## Luồng 1. Khách mới vào lần đầu (new rồi guest)
Màn đầu của new: màn "Chào mừng đến Tubu Tree!" phủ kín, nền xanh đậm, chỉ có Bắt đầu và Để sau, không tự tắt sau 9 giây (`1-khach-moi/01-…`, `02-…`). Khảo sát 4 câu (quan tâm, loại da, mua cho ai, điều quan trọng), mỗi câu 2 chạm (chọn + Tiếp tục), tổng 9 chạm kể cả Bắt đầu. Guest không thấy màn chào mừng, vào thẳng trang chủ (`35-…`).
Trang chủ new: ô tìm, khối "Quà khách mới" (mã chào mừng 30.000đ, freeship, 2% Điểm Xanh), lưới 7 lối tắt: Đổi quà, Vườn Xanh, Đổi rác, Mua chung, Mã của tôi, Kiếm tiền, Cộng đồng (`04-…`).

Số chạm ít nhất cho 7 việc (từ trang chủ, bấm theo chữ hiển thị):
| Việc | new: chạm ít nhất | Đích (new) | guest: chạm | Guest thấy gì |
|---|---|---|---|---|
| Mua hàng | 1 | `/san-pham` | 1 | xem được, không cần đăng nhập (`/san-pham`) |
| Theo dõi đơn | 2 | `/tai-khoan/don-hang` | 1 | màn Đăng nhập (qua tab Cá nhân) (`/tai-khoan`) |
| Điểm Xanh và ưu đãi | 1 | `/uu-dai` | 1 | màn Đăng nhập (`/uu-dai`) |
| Vườn Xanh | 1 | `/vuon-xanh` | 1 | màn Đăng nhập (`/vuon-xanh`) |
| Đổi rác lấy quà | 1 | `/doi-rac` | 1 | xem được trang giới thiệu; nút tạo yêu cầu nằm cuối trang, đòi SĐT/đăng nhập (`/doi-rac`) |
| Chat CSKH | 2 | `/ho-tro/chat` | 1 | màn Đăng nhập (qua tab Cá nhân) (`/tai-khoan`) |
| CTV / đại lý | 2 | `/ctv` | 2 | màn Đăng nhập (`/ctv`) |

Returning có đơn đang giao: dòng "N đơn đang giao - Chạm để theo dõi đơn" ở trang chủ đưa thẳng tới danh sách đơn đang giao: 1 chạm (`54-…`).
Việc > 2 chạm: không có. Việc chỉ có 2 chạm: theo dõi đơn (new, qua Cá nhân), chat CSKH, CTV/đại lý. Không việc nào "không tìm thấy" với new. Guest: 5/7 việc dừng ở màn Đăng nhập.
Khựng: (a) chat CSKH không có ở trang chủ, phải qua Cá nhân (hotline có ở chân trang); (b) "Kiếm tiền" là hộp phải bấm 2 lần, tên không nói "CTV/đại lý"; (c) guest bấm tab Cá nhân chỉ thấy "Đăng nhập với Zalo", không thấy đơn/chat là gì (`40-…`); (d) chú thích "Trồng cây mỗi ngày, nhận quà thật" nổi trên nút Vườn Xanh vài giây đầu mỗi màn có thanh đáy, che chân trang/lưới (`05-…` sau 8 giây thì hết; ảnh ở các luồng khác chụp lúc còn). Chưa kiểm: sau "Để sau", lần mở sau màn chào mừng có hiện lại không.

| # | Bước | Chạm cộng dồn | Màn | Chờ | Ghi chú / ảnh |
|---|---|---|---|---|---|
| 1 | [new] Mở app lần đầu (new): màn chào mừng phủ kín màn hình | new: 0 | `/` | - | màn chào mừng chặn trang chủ, có Bắt đầu và Để sau (`1-khach-moi/01-mo-app-lan-dau-new-man-chao-mung-phu-kin-man-hin.png`) |
| 2 | [new] Màn đầu sau 9 giây không bấm gì | new: 0 | `/` | - | xem màn chào mừng có tự tắt không (`1-khach-moi/02-man-dau-sau-9-giay-khong-bam-gi.png`) |
| 3 | [new] Bấm Để sau | new: 1 | `/` | - |  (`1-khach-moi/03-bam-de-sau.png`) |
| 4 | [new] Trang chủ sau Để sau (nhìn đầu trang) | new: 1 | `/` | - | xem có ô tìm kiếm, ô Quà khách mới, lưới lối tắt (`1-khach-moi/04-trang-chu-sau-de-sau-nhin-dau-trang.png`) |
| 5 | [new] Trang chủ sau 8 giây: chú thích trên nút Vườn Xanh còn không? | new: 1 | `/` | - |  (`1-khach-moi/05-trang-chu-sau-8-giay-chu-thich-tren-nut-vuon-xan.png`) |
| 6 | [new] Mở app lần đầu (lần 2): đi hết khảo sát | new: 0 | `/` | - |  (`1-khach-moi/06-mo-app-lan-dau-lan-2-di-het-khao-sat.png`) |
| 7 | [new] Bấm Bắt đầu | new: 1 | `/` | - |  (`1-khach-moi/07-bam-bat-dau.png`) |
| 8 | [new] Câu 1 (Bạn quan tâm điều gì nhất? Chọn nhiều đá...): chọn "Chăm sóc da" | new: 2 | `/` | - |  (`1-khach-moi/08-cau-1-ban-quan-tam-dieu-gi-nhat-chon-nhieu-da-ch.png`) |
| 9 | [new] Câu 1: bấm Tiếp tục | new: 3 | `/` | - |  (`1-khach-moi/09-cau-1-bam-tiep-tuc.png`) |
| 10 | [new] Câu 2 (Làn da của bạn thế nào? Chọn 1 đáp án Nh...): chọn "Nhạy cảm" | new: 4 | `/` | - |  (`1-khach-moi/10-cau-2-lan-da-cua-ban-the-nao-chon-1-dap-an-nh-ch.png`) |
| 11 | [new] Câu 2: bấm Tiếp tục | new: 5 | `/` | - |  (`1-khach-moi/11-cau-2-bam-tiep-tuc.png`) |
| 12 | [new] Câu 3 (Bạn thường mua sắm cho ai? Chọn nhiều đá...): chọn "Bản thân" | new: 6 | `/` | - |  (`1-khach-moi/12-cau-3-ban-thuong-mua-sam-cho-ai-chon-nhieu-da-ch.png`) |
| 13 | [new] Câu 3: bấm Tiếp tục | new: 7 | `/` | - |  (`1-khach-moi/13-cau-3-bam-tiep-tuc.png`) |
| 14 | [new] Câu 4 (Điều gì quan trọng nhất khi chọn sản phẩ...): chọn "Thành phần thiên nhiên" | new: 8 | `/` | - |  (`1-khach-moi/14-cau-4-dieu-gi-quan-trong-nhat-khi-chon-san-pha-c.png`) |
| 15 | [new] Câu 4: bấm Hoàn tất | new: 9 | `/` | 51ms |  (`1-khach-moi/15-cau-4-bam-hoan-tat.png`) |
| 16 | [new] Sau khảo sát: màn tiếp theo | new: 9 | `/` | - | xem khảo sát kết thúc ở đâu (`1-khach-moi/16-sau-khao-sat-man-tiep-theo.png`) |
| 17 | [new] Mở app lần ba (đã làm khảo sát) | new: 0 | `/` | - |  (`1-khach-moi/17-mo-app-lan-ba-da-lam-khao-sat.png`) |
| 18 | [new] Mua hàng: Bấm "Chọn sản phẩm" | new: 1 | `/san-pham` | 180ms |  (`1-khach-moi/18-mua-hang-bam-chon-san-pham.png`) |
| 19 | [new] new / Mua hàng: tới đích sau 1 chạm | new: 1 | `/san-pham` | - | tìm thấy (`1-khach-moi/19-new-mua-hang-toi-dich-sau-1-cham.png`) |
| 20 | [new] Theo dõi đơn: Bấm tab Cá nhân | new: 2 | `/tai-khoan` | 146ms |  (`1-khach-moi/20-theo-doi-don-bam-tab-ca-nhan.png`) |
| 21 | [new] Theo dõi đơn: Bấm "Xem tất cả" (Đơn của tôi) | new: 3 | `/tai-khoan/don-hang` | 118ms |  (`1-khach-moi/21-theo-doi-don-bam-xem-tat-ca-don-cua-toi.png`) |
| 22 | [new] new / Theo dõi đơn: tới đích sau 2 chạm | new: 3 | `/tai-khoan/don-hang` | - | tìm thấy (`1-khach-moi/22-new-theo-doi-don-toi-dich-sau-2-cham.png`) |
| 23 | [new] Điểm Xanh và ưu đãi: Bấm tab Ưu đãi | new: 4 | `/uu-dai` | 146ms |  (`1-khach-moi/23-diem-xanh-va-uu-dai-bam-tab-uu-dai.png`) |
| 24 | [new] new / Điểm Xanh và ưu đãi: tới đích sau 1 chạm | new: 4 | `/uu-dai` | - | tìm thấy (`1-khach-moi/24-new-diem-xanh-va-uu-dai-toi-dich-sau-1-cham.png`) |
| 25 | [new] Vườn Xanh: Bấm tab Vườn Xanh | new: 5 | `/vuon-xanh` | 148ms |  (`1-khach-moi/25-vuon-xanh-bam-tab-vuon-xanh.png`) |
| 26 | [new] new / Vườn Xanh: tới đích sau 1 chạm | new: 5 | `/vuon-xanh` | - | tìm thấy (`1-khach-moi/26-new-vuon-xanh-toi-dich-sau-1-cham.png`) |
| 27 | [new] Đổi rác lấy quà: Bấm ô Đổi rác | new: 6 | `/doi-rac` | 129ms |  (`1-khach-moi/27-doi-rac-lay-qua-bam-o-doi-rac.png`) |
| 28 | [new] new / Đổi rác lấy quà: tới đích sau 1 chạm | new: 6 | `/doi-rac` | - | tìm thấy (`1-khach-moi/28-new-doi-rac-lay-qua-toi-dich-sau-1-cham.png`) |
| 29 | [new] Chat CSKH: Bấm tab Cá nhân | new: 7 | `/tai-khoan` | 157ms |  (`1-khach-moi/29-chat-cskh-bam-tab-ca-nhan.png`) |
| 30 | [new] Chat CSKH: Bấm "Chat với Tubu Tree" | new: 8 | `/ho-tro/chat` | 118ms |  (`1-khach-moi/30-chat-cskh-bam-chat-voi-tubu-tree.png`) |
| 31 | [new] new / Chat CSKH: tới đích sau 2 chạm | new: 8 | `/ho-tro/chat` | - | tìm thấy (`1-khach-moi/31-new-chat-cskh-toi-dich-sau-2-cham.png`) |
| 32 | [new] CTV / đại lý: Bấm ô Kiếm tiền | new: 9 | `/` | - |  (`1-khach-moi/32-ctv-dai-ly-bam-o-kiem-tien.png`) |
| 33 | [new] CTV / đại lý: Bấm Cộng tác viên (hoặc Đại lý) | new: 10 | `/ctv` | 102ms |  (`1-khach-moi/33-ctv-dai-ly-bam-cong-tac-vien-hoac-dai-ly.png`) |
| 34 | [new] new / CTV / đại lý: tới đích sau 2 chạm | new: 10 | `/ctv` | - | tìm thấy (`1-khach-moi/34-new-ctv-dai-ly-toi-dich-sau-2-cham.png`) |
| 35 | [guest] Mở app khi chưa đăng nhập (guest) | guest: 0 | `/` | - | xem màn đầu của guest (`1-khach-moi/35-mo-app-khi-chua-dang-nhap-guest.png`) |
| 36 | [guest] Mua hàng: Bấm "Chọn sản phẩm" | guest: 1 | `/san-pham` | 129ms |  (`1-khach-moi/36-mua-hang-bam-chon-san-pham.png`) |
| 37 | [guest] guest / Mua hàng: tới đích sau 1 chạm | guest: 1 | `/san-pham` | - | tìm thấy (`1-khach-moi/37-guest-mua-hang-toi-dich-sau-1-cham.png`) |
| 38 | [guest] Theo dõi đơn: Bấm tab Cá nhân | guest: 2 | `/tai-khoan` | 62ms |  (`1-khach-moi/38-theo-doi-don-bam-tab-ca-nhan.png`) |
| 39 | [guest] Theo dõi đơn: Bấm "Xem tất cả" (Đơn của tôi) | guest: 2 | `/tai-khoan` | 8.0s | KHÔNG BẤM ĐƯỢC: locator.click: Timeout 8000ms exceeded.  (`1-khach-moi/39-theo-doi-don-bam-xem-tat-ca-don-cua-toi.png`) |
| 40 | [guest] guest / Theo dõi đơn: tới đích sau 1 chạm | guest: 2 | `/tai-khoan` | - | KHÔNG tìm thấy, bị chặn bằng màn Đăng nhập (`1-khach-moi/40-guest-theo-doi-don-toi-dich-sau-1-cham.png`) |
| 41 | [guest] Điểm Xanh và ưu đãi: Bấm tab Ưu đãi | guest: 3 | `/uu-dai` | 57ms |  (`1-khach-moi/41-diem-xanh-va-uu-dai-bam-tab-uu-dai.png`) |
| 42 | [guest] guest / Điểm Xanh và ưu đãi: tới đích sau 1 chạm | guest: 3 | `/uu-dai` | - | tìm thấy, bị chặn bằng màn Đăng nhập (`1-khach-moi/42-guest-diem-xanh-va-uu-dai-toi-dich-sau-1-cham.png`) |
| 43 | [guest] Vườn Xanh: Bấm tab Vườn Xanh | guest: 4 | `/vuon-xanh` | 46ms |  (`1-khach-moi/43-vuon-xanh-bam-tab-vuon-xanh.png`) |
| 44 | [guest] guest / Vườn Xanh: tới đích sau 1 chạm | guest: 4 | `/vuon-xanh` | - | tìm thấy, bị chặn bằng màn Đăng nhập (`1-khach-moi/44-guest-vuon-xanh-toi-dich-sau-1-cham.png`) |
| 45 | [guest] Đổi rác lấy quà: Bấm ô Đổi rác | guest: 5 | `/doi-rac` | 106ms |  (`1-khach-moi/45-doi-rac-lay-qua-bam-o-doi-rac.png`) |
| 46 | [guest] guest / Đổi rác lấy quà: tới đích sau 1 chạm | guest: 5 | `/doi-rac` | - | tìm thấy, bị chặn bằng màn Đăng nhập (`1-khach-moi/46-guest-doi-rac-lay-qua-toi-dich-sau-1-cham.png`) |
| 47 | [guest] Chat CSKH: Bấm tab Cá nhân | guest: 6 | `/tai-khoan` | 66ms |  (`1-khach-moi/47-chat-cskh-bam-tab-ca-nhan.png`) |
| 48 | [guest] Chat CSKH: Bấm "Chat với Tubu Tree" | guest: 6 | `/tai-khoan` | 8.0s | KHÔNG BẤM ĐƯỢC: locator.click: Timeout 8000ms exceeded.  (`1-khach-moi/48-chat-cskh-bam-chat-voi-tubu-tree.png`) |
| 49 | [guest] guest / Chat CSKH: tới đích sau 1 chạm | guest: 6 | `/tai-khoan` | - | KHÔNG tìm thấy, bị chặn bằng màn Đăng nhập (`1-khach-moi/49-guest-chat-cskh-toi-dich-sau-1-cham.png`) |
| 50 | [guest] CTV / đại lý: Bấm ô Kiếm tiền | guest: 7 | `/` | - |  (`1-khach-moi/50-ctv-dai-ly-bam-o-kiem-tien.png`) |
| 51 | [guest] CTV / đại lý: Bấm Cộng tác viên (hoặc Đại lý) | guest: 8 | `/ctv` | 69ms |  (`1-khach-moi/51-ctv-dai-ly-bam-cong-tac-vien-hoac-dai-ly.png`) |
| 52 | [guest] guest / CTV / đại lý: tới đích sau 2 chạm | guest: 8 | `/ctv` | - | tìm thấy, bị chặn bằng màn Đăng nhập (`1-khach-moi/52-guest-ctv-dai-ly-toi-dich-sau-2-cham.png`) |
| 53 | [returning] Mở trang chủ returning (có đơn đang giao) | returning: 0 | `/` | - |  (`1-khach-moi/53-mo-trang-chu-returning-co-don-dang-giao.png`) |
| 54 | [returning] Bấm dòng "N đơn đang giao - Chạm để theo dõi đơn" | returning: 1 | `/tai-khoan/don-hang?tab=shipping` | 98ms |  (`1-khach-moi/54-bam-dong-n-don-dang-giao-cham-de-theo-doi-don.png`) |

## Luồng 2. Tìm và mua (webret, Lộc Biếc)
11 chạm tới màn đặt thành công: ô tìm 1, gõ 2, Enter 3, mở SP 4, phân loại 5, thêm giỏ 6, xem giỏ 7, mở mã giảm 8, dùng XANH10 9, Thanh toán 10, Đặt hàng 11 (COD đã chọn sẵn, địa chỉ mặc định có sẵn).
Khựng: (a) trang tìm hiện "Chưa có gợi ý, nhấn Tìm để xem kết quả" nhưng không có nút Tìm; thực ra có dòng "Tìm “…”" phía trên, chữ không chỉ vào nó (`02-…`, `03-…`); (b) ở PDP 375 không có biểu tượng giỏ trên đầu trang, giỏ chỉ ở nút nhỏ góc dưới trái và dòng "Đã thêm vào giỏ! Xem giỏ hàng →" nhỏ sát thanh dưới (`07-…`); (c) giỏ ghi "Thành tiền" đúng nhưng mã giảm phải mở bảng rồi bấm "Dùng mã" (2 chạm), mã đủ điều kiện không được gợi ý nổi bật ở giỏ.
Màn thành công tốt: mã đơn, tổng, điểm sẽ nhận, 3 bước tiếp theo, nút Theo dõi đơn (`14-…`). Kiểu Shopee: tìm → SP → chọn phân loại → giỏ → voucher → thanh toán cũng cỡ 10-12 chạm; chưa có số đo Shopee tại chỗ nên không so con số.

| # | Bước | Chạm cộng dồn | Màn | Chờ | Ghi chú / ảnh |
|---|---|---|---|---|---|
| 1 | Mở trang chủ (đã đăng nhập, Lộc Biếc) | 0 | `/` | - |  (`2-tim-mua/01-mo-trang-chu-da-dang-nhap-loc-biec.png`) |
| 2 | Chạm ô tìm kiếm "Bạn đang tìm gì hôm nay?" | 1 | `/san-pham` | 188ms |  (`2-tim-mua/02-cham-o-tim-kiem-ban-dang-tim-gi-hom-nay.png`) |
| 3 | Gõ "nước rửa chén" | 2 | `/san-pham` | - | chưa có gợi ý, chữ báo "nhấn Tìm để xem kết quả" (`2-tim-mua/03-go-nuoc-rua-chen.png`) |
| 4 | Bấm Enter (Tìm trên bàn phím) | 3 | `/san-pham?q=n%C6%B0%E1%BB%9Bc+r%E1%BB%ADa+ch%C` | 84ms | trang không có nút Tìm (`2-tim-mua/04-bam-enter-tim-tren-ban-phim.png`) |
| 5 | Mở "Nước rửa chén sinh học Fuwa3e" | 4 | `/san-pham/nuoc-rua-chen-fuwa3e` | 207ms |  (`2-tim-mua/05-mo-nuoc-rua-chen-sinh-hoc-fuwa3e.png`) |
| 6 | Chọn phân loại "Can 5L" | 5 | `/san-pham/nuoc-rua-chen-fuwa3e` | - |  (`2-tim-mua/06-chon-phan-loai-can-5l.png`) |
| 7 | Bấm Thêm vào giỏ | 6 | `/san-pham/nuoc-rua-chen-fuwa3e` | 43ms |  (`2-tim-mua/07-bam-them-vao-gio.png`) |
| 8 | Bấm "Xem giỏ hàng →" trong thông báo | 7 | `/gio-hang` | 426ms |  (`2-tim-mua/08-bam-xem-gio-hang-trong-thong-bao.png`) |
| 9 | Mở ô Mã giảm giá | 8 | `/gio-hang` | - |  (`2-tim-mua/09-mo-o-ma-giam-gia.png`) |
| 10 | Chọn mã XANH10 (Dùng mã) | 9 | `/gio-hang` | 50ms |  (`2-tim-mua/10-chon-ma-xanh10-dung-ma.png`) |
| 11 | Bấm Thanh toán | 10 | `/thanh-toan` | 187ms |  (`2-tim-mua/11-bam-thanh-toan.png`) |
| 12 | Màn thanh toán (xem phương thức mặc định) | 10 | `/thanh-toan` | - | COD đã chọn sẵn (`2-tim-mua/12-man-thanh-toan-xem-phuong-thuc-mac-dinh.png`) |
| 13 | Bấm Đặt hàng | 11 | `/thanh-toan` | 69ms |  (`2-tim-mua/13-bam-dat-hang.png`) |
| 14 | Màn đặt thành công | 11 | `/thanh-toan` | - |  (`2-tim-mua/14-man-dat-thanh-cong.png`) |
| 15 | (ngoài luồng) Bấm Theo dõi đơn ở màn thành công | 12 | `/tai-khoan/don-hang/TUBU2026102823840` | 212ms |  (`2-tim-mua/15-ngoai-luong-bam-theo-doi-don-o-man-thanh-cong.png`) |

## Luồng 3. Theo dõi đơn và mua lại
Từ trang chủ tới chi tiết đơn: 3 chạm (Cá nhân, Xem tất cả, mở đơn). Từ màn thành công: 1 chạm (Theo dõi đơn). Chi tiết đơn có dòng thời gian 4 mốc (Đã xác nhận, Đang đóng gói, Đang giao, Giao thành công) với giờ từng mốc đã qua; mốc chưa tới không có ngày/giờ dự kiến; không có "dự kiến giao ngày …" (`05-…`, `06-…`). Khi giao có hãng + mã vận đơn + Chép mã. Đơn đã giao có "Mua lại đơn này".
Mua lại: bấm Mua lại ở danh sách mở bảng (chọn dòng, số lượng, tạm tính), bấm Thêm vào giỏ mới tới giỏ: 2 chạm (`10-…`, `12-…`). Trang chủ cũng có dải "Mua lại" (chưa đo chạm riêng).
Khựng: (a) không có ngày giao dự kiến; (b) trong chi tiết đơn đang giao, khối Vận chuyển nằm dưới Sản phẩm/Thanh toán, phải cuộn; (c) trang tải lại thủ công mới thấy đơn đổi trạng thái (không kiểm tự cập nhật ở luồng này; ở luồng 5 trang yêu cầu không tự cập nhật).
Mẫu: Shopee có "Mua lại" ở đơn đã giao và ngày nhận hàng dự kiến ngay trên đơn đang giao.

| # | Bước | Chạm cộng dồn | Màn | Chờ | Ghi chú / ảnh |
|---|---|---|---|---|---|
| 1 | Mở trang chủ (có đơn vừa đặt TUBU2026102823840) | 0 | `/` | - |  (`3-theo-doi-mua-lai/01-mo-trang-chu-co-don-vua-dat-tubu2026102823840.png`) |
| 2 | Bấm tab Cá nhân | 1 | `/tai-khoan` | 155ms |  (`3-theo-doi-mua-lai/02-bam-tab-ca-nhan.png`) |
| 3 | Bấm Xem tất cả (Đơn của tôi) | 2 | `/tai-khoan/don-hang` | 112ms |  (`3-theo-doi-mua-lai/03-bam-xem-tat-ca-don-cua-toi.png`) |
| 4 | Mở đơn TUBU2026102823840 | 3 | `/tai-khoan/don-hang/TUBU2026102823840` | 124ms |  (`3-theo-doi-mua-lai/04-mo-don-tubu2026102823840.png`) |
| 5 | Chi tiết đơn lúc mới đặt (xem dòng thời gian) | 3 | `/tai-khoan/don-hang/TUBU2026102823840` | - | có dòng thời gian 4 mốc; chưa có ngày giao dự kiến (`3-theo-doi-mua-lai/05-chi-tiet-don-luc-moi-dat-xem-dong-thoi-gian.png`) |
| 6 | Kéo tải lại chi tiết đơn sau khi kho giao cho GHN (0 chạm, tải lại) | 3 | `/tai-khoan/don-hang/TUBU2026102823840` | - | xem có mã vận đơn, mốc, dự kiến giao (`3-theo-doi-mua-lai/06-keo-tai-lai-chi-tiet-don-sau-khi-kho-giao-cho-gh.png`) |
| 7 | Chi tiết đơn sau khi giao thành công (0 chạm, tải lại) | 3 | `/tai-khoan/don-hang/TUBU2026102823840` | - | xem nút Mua lại đơn này và mốc Giao thành công (`3-theo-doi-mua-lai/07-chi-tiet-don-sau-khi-giao-thanh-cong-0-cham-tai-.png`) |
| 8 | Bấm nút quay lại (<) về danh sách đơn | 4 | `/tai-khoan/don-hang` | 171ms |  (`3-theo-doi-mua-lai/08-bam-nut-quay-lai-ve-danh-sach-don.png`) |
| 9 | Danh sách đơn | 4 | `/tai-khoan/don-hang` | - |  (`3-theo-doi-mua-lai/09-danh-sach-don.png`) |
| 10 | Bấm Mua lại ở đơn TUBU2026102823840 (đã giao) | 5 | `/tai-khoan/don-hang` | - |  (`3-theo-doi-mua-lai/10-bam-mua-lai-o-don-tubu2026102823840-da-giao.png`) |
| 11 | Sau khi bấm Mua lại | 5 | `/tai-khoan/don-hang` | - | mở bảng Mua lại, chưa vào giỏ (`3-theo-doi-mua-lai/11-sau-khi-bam-mua-lai.png`) |
| 12 | Bấm "Thêm vào giỏ" trong bảng Mua lại | 6 | `/gio-hang` | 114ms |  (`3-theo-doi-mua-lai/12-bam-them-vao-gio-trong-bang-mua-lai.png`) |
| 13 | Sau khi thêm vào giỏ (xem đã tới giỏ chưa) | 6 | `/gio-hang` | - |  (`3-theo-doi-mua-lai/13-sau-khi-them-vao-gio-xem-da-toi-gio-chua.png`) |

## Luồng 4. Điểm Xanh, hạng, Vườn Xanh, điểm danh
Điểm danh ngay ở thẻ điểm trang chủ: 1 chạm, nút đổi thành "Đã điểm danh" và hiện "+1.000 Điểm Xanh · +60 giọt nước · +50 quà điểm danh đầu tiên" (`02-…`). Tiến độ lên hạng: thanh + chữ "Còn x triệu mua hàng lên Đại Thụ" có ở trang chủ, Ưu đãi, trang Hạng (`01-…`, `03-…`, `04-…`). Trang Hạng có điểm sắp hết hạn, bảng 4 hạng, lịch sử điểm, mã giảm của tôi.
Đổi quà: Kho quà → Đổi → hộp Xác nhận (hiện điểm còn lại) → Xác nhận đổi → hộp "Đổi quà thành công" có mã. Vườn Xanh: tab → "Tưới hết" 1 chạm → hộp "Thu hoạch thành công +2.000 Điểm Xanh" → Tuyệt vời!.
Khựng: (a) Kho quà vẫn bán "Miễn phí vận chuyển 20.000 điểm" cho hạng Lộc Biếc dù ngay dưới ghi "Hạng Lộc Biếc đã được miễn phí giao hàng cho đơn Tubu từ 99.000đ", nút Đổi vẫn bật (`06-…`); (b) "Xem ví mã" trong hộp thành công đi tới trang Hạng/Điểm Xanh (`/tai-khoan/diem-xanh`), không tới "Quà của tôi" (`09-…`); (c) lối vào trang Hạng là nút nhỏ "Lộc Biếc - Hạng và lịch sử điểm" trong trang Ưu đãi, 3 chạm từ trang chủ (bấm thẻ điểm, rồi nút đó).
Chưa kiểm: điểm danh từ trang Ưu đãi, vòng quay, câu đố.

| # | Bước | Chạm cộng dồn | Màn | Chờ | Ghi chú / ảnh |
|---|---|---|---|---|---|
| 1 | Mở trang chủ (thẻ điểm Lộc Biếc, tiến độ lên Đại Thụ) | 0 | `/` | - |  (`4-diem-xanh-vuon/01-mo-trang-chu-the-diem-loc-biec-tien-do-len-dai-t.png`) |
| 2 | Bấm Điểm danh ở thẻ điểm | 1 | `/` | 77ms |  (`4-diem-xanh-vuon/02-bam-diem-danh-o-the-diem.png`) |
| 3 | Bấm thẻ điểm (Chào ... · Lộc Biếc) | 2 | `/uu-dai` | 136ms |  (`4-diem-xanh-vuon/03-bam-the-diem-chao-loc-biec.png`) |
| 4 | Bấm "Lộc Biếc - Hạng và lịch sử điểm" | 3 | `/tai-khoan/diem-xanh` | 142ms |  (`4-diem-xanh-vuon/04-bam-loc-biec-hang-va-lich-su-diem.png`) |
| 5 | Bấm Kho quà (ở trang Hạng) | 4 | `/kho-qua` | 129ms |  (`4-diem-xanh-vuon/05-bam-kho-qua-o-trang-hang.png`) |
| 6 | Bấm Đổi ở "Miễn phí vận chuyển" (20.000 điểm) | 5 | `/kho-qua` | - |  (`4-diem-xanh-vuon/06-bam-doi-o-mien-phi-van-chuyen-20-000-diem.png`) |
| 7 | Bấm Xác nhận đổi | 6 | `/kho-qua` | 49ms |  (`4-diem-xanh-vuon/07-bam-xac-nhan-doi.png`) |
| 8 | Sau khi đổi quà | 6 | `/kho-qua` | - |  (`4-diem-xanh-vuon/08-sau-khi-doi-qua.png`) |
| 9 | Bấm Xem ví mã (trong hộp Đổi quà thành công) | 7 | `/tai-khoan/diem-xanh` | 104ms |  (`4-diem-xanh-vuon/09-bam-xem-vi-ma-trong-hop-doi-qua-thanh-cong.png`) |
| 10 | Bấm tab Vườn Xanh (thanh đáy) | 8 | `/vuon-xanh` | 133ms |  (`4-diem-xanh-vuon/10-bam-tab-vuon-xanh-thanh-day.png`) |
| 11 | Màn Vườn Xanh (đầu trang) | 8 | `/vuon-xanh` | - |  (`4-diem-xanh-vuon/11-man-vuon-xanh-dau-trang.png`) |
| 12 | Bấm Tưới hết (60 giọt nước) | 9 | `/vuon-xanh` | 77ms |  (`4-diem-xanh-vuon/12-bam-tuoi-het-60-giot-nuoc.png`) |
| 13 | Bấm Tuyệt vời! (hộp Thu hoạch thành công, +2.000 điểm) | 10 | `/vuon-xanh` | - |  (`4-diem-xanh-vuon/13-bam-tuyet-voi-hop-thu-hoach-thanh-cong-2-000-die.png`) |
| 14 | Vườn sau khi tưới cây | 10 | `/vuon-xanh` | - |  (`4-diem-xanh-vuon/14-vuon-sau-khi-tuoi-cay.png`) |

## Luồng 5. Đổi rác lấy quà
Khách: tile Đổi rác 1 → Đổi rác ngay 2 → +5 thùng 3 → Tiếp tục 4 → Mang tới điểm nhận 5 → Chọn điểm nhận 6 → thẻ điểm 7 → Chọn điểm này 8 → tick Thể lệ 9 → Tạo yêu cầu 10. Trang yêu cầu có mã TR-xxxxx, 4 mốc, Xem mã QR, Sửa món, Huỷ, Chat. Nhân viên (persona staff, `/doi-rac/quay` ở 375): gõ mã 1, Tra mã 2, Xác nhận đã nhận 3 (số lượng mặc định bằng khai báo). Khách tải lại thấy "Đã cộng 5.000 điểm"; bấm Xem kết quả cộng điểm 1 chạm (`19-…`, `20-…`: số dư mới 25.000, nút Đổi quà ngay).
Khựng: (a) trang yêu cầu của khách KHÔNG tự cập nhật: chờ 12 giây sau khi quầy xác nhận vẫn "Chờ bạn mang tới" (ngõ cụt nhẹ, không thông báo trong luồng này; chưa kiểm chuông thông báo); (b) nút Quay lại ở trang yêu cầu đưa về form "Đổi rác bước 1/2" trống chứ không về danh sách/Đổi rác (`22-…`, `23-…`); (c) bước 2 hiện cả thẻ "Gửi về kho Tubu HCM" kèm cảnh báo "Gói tối thiểu 15.000 điểm, cần thêm 10.000", rồi nút "Chọn Mang tới điểm nhận" lẻ loi; chưa chọn cách giao thì chữ "Chọn cách giao để tạo yêu cầu" (`05-…`, `06-…`); (d) chọn điểm nhận là một trang riêng: 3 chạm (Chọn điểm nhận, thẻ, Chọn điểm này) cho một điểm duy nhất; (e) list "Yêu cầu của tôi" mặc định tab "Đang xử lý 0", yêu cầu xong nằm ở "Đã đóng".
Ghi chú dữ liệu: điểm nhận "Tubu Quận 1" là kho nên nhận cả vỏ sữa/vỏ chai; staff đã được gắn sẵn vào điểm này trong DB lane (không phải do tôi).

| # | Bước | Chạm cộng dồn | Màn | Chờ | Ghi chú / ảnh |
|---|---|---|---|---|---|
| 1 | Mở trang chủ (khách có 20.000 điểm) | 0 | `/` | - |  (`5-doi-rac/01-mo-trang-chu-khach-co-20-000-diem.png`) |
| 2 | Bấm ô Đổi rác ở lưới lối tắt | 1 | `/doi-rac` | 267ms |  (`5-doi-rac/02-bam-o-doi-rac-o-luoi-loi-tat.png`) |
| 3 | Bấm Đổi rác ngay | 2 | `/doi-rac/tao` | 388ms |  (`5-doi-rac/03-bam-doi-rac-ngay.png`) |
| 4 | Bấm +5 ở Thùng carton cũ | 3 | `/doi-rac/tao` | - |  (`5-doi-rac/04-bam-5-o-thung-carton-cu.png`) |
| 5 | Bấm Tiếp tục | 4 | `/doi-rac/tao?step=method` | 120ms |  (`5-doi-rac/05-bam-tiep-tuc.png`) |
| 6 | Chọn cách giao: Mang tới điểm nhận | 5 | `/doi-rac/tao?step=method` | - |  (`5-doi-rac/06-chon-cach-giao-mang-toi-diem-nhan.png`) |
| 7 | Bấm Chọn điểm nhận | 6 | `/doi-rac/diem-nhan` | 268ms |  (`5-doi-rac/07-bam-chon-diem-nhan.png`) |
| 8 | Bấm thẻ Điểm nhận Tubu Quận 1 | 7 | `/doi-rac/diem-nhan` | - |  (`5-doi-rac/08-bam-the-diem-nhan-tubu-quan-1.png`) |
| 9 | Bấm Chọn điểm này | 8 | `/doi-rac/tao?step=method` | 103ms |  (`5-doi-rac/09-bam-chon-diem-nay.png`) |
| 10 | Tick đồng ý Thể lệ | 9 | `/doi-rac/tao?step=method` | - |  (`5-doi-rac/10-tick-dong-y-the-le.png`) |
| 11 | Bấm Tạo yêu cầu | 10 | `/doi-rac/yeu-cau/cmvrggod801qeisl0vnoseyv6` | 232ms |  (`5-doi-rac/11-bam-tao-yeu-cau.png`) |
| 12 | Yêu cầu TR-5VANV: trạng thái "Chờ bạn mang tới" | 10 | `/doi-rac/yeu-cau/cmvrggod801qeisl0vnoseyv6` | - | có Xem mã QR, Sửa món, Huỷ yêu cầu, Chat (`5-doi-rac/12-yeu-cau-tr-5vanv-trang-thai-cho-ban-mang-toi.png`) |
| 13 | [nhân viên] Mở màn quầy nhận hàng | nhân viên: 0 | `/doi-rac/quay` | - |  (`5-doi-rac/13-mo-man-quay-nhan-hang.png`) |
| 14 | [nhân viên] Gõ mã TR-5VANV | nhân viên: 1 | `/doi-rac/quay` | - |  (`5-doi-rac/14-go-ma-tr-5vanv.png`) |
| 15 | [nhân viên] Bấm Tra mã | nhân viên: 2 | `/doi-rac/quay` | 59ms |  (`5-doi-rac/15-bam-tra-ma.png`) |
| 16 | [nhân viên] Bấm Xác nhận đã nhận (đủ 5 thùng) | nhân viên: 3 | `/doi-rac/quay` | 62ms |  (`5-doi-rac/16-bam-xac-nhan-da-nhan-du-5-thung.png`) |
| 17 | [nhân viên] Kết quả xác nhận ở quầy | nhân viên: 3 | `/doi-rac/quay` | - |  (`5-doi-rac/17-ket-qua-xac-nhan-o-quay.png`) |
| 18 | Chờ 12 giây, không bấm gì: trang tự cập nhật? | 10 | `/doi-rac/yeu-cau/cmvrggod801qeisl0vnoseyv6` | - | trang KHÔNG tự cập nhật, vẫn "Chờ bạn mang tới" (cần tải lại) (`5-doi-rac/18-cho-12-giay-khong-bam-gi-trang-tu-cap-nhat.png`) |
| 19 | Khách mở lại trang yêu cầu sau khi quầy xác nhận (tải lại) | 10 | `/doi-rac/yeu-cau/cmvrggod801qeisl0vnoseyv6` | - | xem trạng thái và điểm cộng (`5-doi-rac/19-khach-mo-lai-trang-yeu-cau-sau-khi-quay-xac-nhan.png`) |
| 20 | Bấm Xem kết quả cộng điểm | 11 | `/doi-rac/xong/cmvrggod801qeisl0vnoseyv6` | 122ms |  (`5-doi-rac/20-bam-xem-ket-qua-cong-diem.png`) |
| 21 | Màn kết quả cộng điểm | 11 | `/doi-rac/xong/cmvrggod801qeisl0vnoseyv6` | - | khách thấy điểm cộng (`5-doi-rac/21-man-ket-qua-cong-diem.png`) |
| 22 | Bấm Quay lại (về yêu cầu) | 12 | `/doi-rac/yeu-cau/cmvrggod801qeisl0vnoseyv6` | 45ms |  (`5-doi-rac/22-bam-quay-lai-ve-yeu-cau.png`) |
| 23 | Bấm Quay lại (về Đổi rác lấy quà) | 13 | `/doi-rac/tao` | 416ms |  (`5-doi-rac/23-bam-quay-lai-ve-doi-rac-lay-qua.png`) |
| 24 | Trang Đổi rác lấy quà: số điểm hiện tại | 13 | `/doi-rac/tao` | - | xem Điểm Xanh của bạn (`5-doi-rac/24-trang-doi-rac-lay-qua-so-diem-hien-tai.png`) |

## Luồng 6. CTV và đại lý
Khách mới: Kiếm tiền 1 → Cộng tác viên 2 → màn "Trở thành CTV Tubu" (lợi ích + 4 điều khoản dài) → tick đồng ý 3 → Đăng ký miễn phí ngay 4 → bảng CTV; sau đó Gian hàng 5 thấy "Điều kiện mở gian hàng, Bước 1/4, Bạn đã là Cộng tác viên" (`10-…`). Ngay sau đăng ký có `GET /academy/courses` trả 403 và console lỗi (thẻ Học viện CTV).
CTV (đã mua qua mã UATCTV nên có hoa hồng chờ 9.520đ): bảng có hoa hồng tháng này, đang chờ, bậc "CTV Tân binh", 4 mốc thưởng, mã giới thiệu, lời đăng gợi ý, link chia sẻ, lịch sử. Gian hàng: trạng thái, thống kê 30 ngày, hành trình 0/5. Ví Tubu: bấm Cá nhân rồi Ví Tubu (2 chạm), có dòng Hoa hồng chờ duyệt và Hoa hồng có thể chuyển vào Ví (chưa thử chuyển).
Đại lý: Kiếm tiền → Đại lý 2 chạm → Kênh đại lý (bậc Cấp 2, công nợ 0đ, hạn mức 20 triệu, 4 tab Bảng giá, Đơn hàng, Công nợ, Báo cáo; Dán đơn ở tab Bảng giá).
Khựng: (a) ô "Chuyển vào Ví" mờ, bấm không được, không chữ nào giải thích (`17-…`/ghi chú); (b) hai nút "Chia sẻ" trên cùng một màn: ô đầu trang chỉ cuộn xuống thẻ Mã giới thiệu, nút thứ hai mới chia sẻ (`16-…`); (c) hero ghi "Hoa hồng tháng này 9.520đ" và "Hôm nay 9.520đ" dù tất cả đang chờ, "Đã chốt 0đ" (dễ hiểu nhầm đã có tiền); (d) CTV muốn Ví Tubu phải qua Cá nhân, trang CTV không có lối tới Ví ngoài ô mờ; (e) lỗi 403 academy sau đăng ký.
Bảng giá đại lý dài (cả danh mục, mỗi dòng giá sỉ -30%, số lượng) không có ô tìm ở đầu: chưa kiểm kỹ, chỉ thấy danh sách dài.

| # | Bước | Chạm cộng dồn | Màn | Chờ | Ghi chú / ảnh |
|---|---|---|---|---|---|
| 1 | [khách mới] Mở trang chủ (khách mới) | khách mới: 0 | `/` | - |  (`6-ctv-dai-ly/01-mo-trang-chu-khach-moi.png`) |
| 2 | [khách mới] Bấm Kiếm tiền (lưới lối tắt) | khách mới: 1 | `/` | - |  (`6-ctv-dai-ly/02-bam-kiem-tien-luoi-loi-tat.png`) |
| 3 | [khách mới] Hộp Kiếm tiền cùng Tubu: Cộng tác viên / Học viện / Đại lý | khách mới: 1 | `/` | - |  (`6-ctv-dai-ly/03-hop-kiem-tien-cung-tubu-cong-tac-vien-hoc-vien-d.png`) |
| 4 | [khách mới] Bấm Cộng tác viên | khách mới: 2 | `/ctv` | 123ms |  (`6-ctv-dai-ly/04-bam-cong-tac-vien.png`) |
| 5 | [khách mới] Màn Trở thành CTV Tubu (điều khoản, ô đồng ý) | khách mới: 2 | `/ctv` | - | phải tick ô đồng ý mới bấm được Đăng ký (`6-ctv-dai-ly/05-man-tro-thanh-ctv-tubu-dieu-khoan-o-dong-y.png`) |
| 6 | [khách mới] Tick ô đồng ý điều khoản hoa hồng và thuế | khách mới: 3 | `/ctv` | - |  (`6-ctv-dai-ly/06-tick-o-dong-y-dieu-khoan-hoa-hong-va-thue.png`) |
| 7 | [khách mới] Bấm Đăng ký miễn phí ngay | khách mới: 4 | `/ctv` | 91ms |  LỖI API: GET /academy/courses 403 (`6-ctv-dai-ly/07-bam-dang-ky-mien-phi-ngay.png`) |
| 8 | [khách mới] Sau khi đăng ký: bảng CTV (hoa hồng 0đ, chưa có link) | khách mới: 4 | `/ctv` | - |  (`6-ctv-dai-ly/08-sau-khi-dang-ky-bang-ctv-hoa-hong-0d-chua-co-lin.png`) |
| 9 | [khách mới] Bấm Gian hàng | khách mới: 5 | `/ctv/gian-hang` | 114ms |  LỖI API: GET /storefront/me 404 (`6-ctv-dai-ly/09-bam-gian-hang.png`) |
| 10 | [khách mới] Gian hàng của CTV mới | khách mới: 5 | `/ctv/gian-hang` | - |  (`6-ctv-dai-ly/10-gian-hang-cua-ctv-moi.png`) |
| 11 | [CTV] Mở trang chủ (CTV) | CTV: 0 | `/` | - |  (`6-ctv-dai-ly/11-mo-trang-chu-ctv.png`) |
| 12 | [CTV] Bấm Kiếm tiền (lưới lối tắt) | CTV: 1 | `/` | - |  (`6-ctv-dai-ly/12-bam-kiem-tien-luoi-loi-tat.png`) |
| 13 | [CTV] Bấm Cộng tác viên | CTV: 2 | `/ctv` | 154ms |  (`6-ctv-dai-ly/13-bam-cong-tac-vien.png`) |
| 14 | [CTV] Bảng CTV: hoa hồng tháng này, đang chờ, bậc | CTV: 2 | `/ctv` | - | có đơn mua qua mã UATCTV, hoa hồng đang chờ (`6-ctv-dai-ly/14-bang-ctv-hoa-hong-thang-nay-dang-cho-bac.png`) |
| 15 | [CTV] Bấm ô Chia sẻ (đầu trang) | CTV: 3 | `/ctv` | - |  (`6-ctv-dai-ly/15-bam-o-chia-se-dau-trang.png`) |
| 16 | [CTV] Sau khi bấm Chia sẻ | CTV: 3 | `/ctv` | - | trang chỉ cuộn xuống thẻ Mã giới thiệu, ở đó lại có nút Chia sẻ thứ hai (`6-ctv-dai-ly/16-sau-khi-bam-chia-se.png`) |
| 17 | [CTV] Ô Chuyển vào Ví ở đầu trang | CTV: 3 | `/ctv` | - | ô mờ (disabled): bấm không được, không chữ nào nói vì sao (chỉ có "Có thể chuyển vào Ví 0đ") (`6-ctv-dai-ly/17-o-chuyen-vao-vi-o-dau-trang.png`) |
| 18 | [CTV] Bấm Gian hàng | CTV: 4 | `/ctv/gian-hang` | 136ms |  (`6-ctv-dai-ly/18-bam-gian-hang.png`) |
| 19 | [CTV] Gian hàng của tôi (thống kê 30 ngày, hành trình) | CTV: 4 | `/ctv/gian-hang` | - |  (`6-ctv-dai-ly/19-gian-hang-cua-toi-thong-ke-30-ngay-hanh-trinh.png`) |
| 20 | [CTV] Mở lại trang chủ để tìm Ví Tubu | CTV: 0 | `/` | - |  (`6-ctv-dai-ly/20-mo-lai-trang-chu-de-tim-vi-tubu.png`) |
| 21 | [CTV] Bấm tab Cá nhân | CTV: 1 | `/tai-khoan` | 163ms |  (`6-ctv-dai-ly/21-bam-tab-ca-nhan.png`) |
| 22 | [CTV] Bấm Ví Tubu | CTV: 2 | `/tai-khoan/vi-tubu` | 96ms |  (`6-ctv-dai-ly/22-bam-vi-tubu.png`) |
| 23 | [CTV] Ví Tubu (số dư, hoa hồng chờ duyệt, lịch sử) | CTV: 2 | `/tai-khoan/vi-tubu` | - |  (`6-ctv-dai-ly/23-vi-tubu-so-du-hoa-hong-cho-duyet-lich-su.png`) |
| 24 | [đại lý] Mở trang chủ (đại lý) | đại lý: 0 | `/` | - |  (`6-ctv-dai-ly/24-mo-trang-chu-dai-ly.png`) |
| 25 | [đại lý] Bấm Kiếm tiền (lưới lối tắt) | đại lý: 1 | `/` | - |  (`6-ctv-dai-ly/25-bam-kiem-tien-luoi-loi-tat.png`) |
| 26 | [đại lý] Bấm Đại lý | đại lý: 2 | `/dai-ly` | 124ms |  (`6-ctv-dai-ly/26-bam-dai-ly.png`) |
| 27 | [đại lý] Kênh đại lý: bậc, công nợ, hạn mức, bảng giá | đại lý: 2 | `/dai-ly` | - |  (`6-ctv-dai-ly/27-kenh-dai-ly-bac-cong-no-han-muc-bang-gia.png`) |
| 28 | [đại lý] Bấm tab Đơn hàng | đại lý: 3 | `/dai-ly?tab=orders` | 75ms |  (`6-ctv-dai-ly/28-bam-tab-don-hang.png`) |
| 29 | [đại lý] Tab Đơn hàng | đại lý: 3 | `/dai-ly?tab=orders` | - |  (`6-ctv-dai-ly/29-tab-don-hang.png`) |
| 30 | [đại lý] Bấm tab Công nợ | đại lý: 4 | `/dai-ly?tab=credit` | 82ms |  (`6-ctv-dai-ly/30-bam-tab-cong-no.png`) |
| 31 | [đại lý] Tab Công nợ | đại lý: 4 | `/dai-ly?tab=credit` | - |  (`6-ctv-dai-ly/31-tab-cong-no.png`) |
| 32 | [đại lý] Bấm tab Báo cáo | đại lý: 5 | `/dai-ly?tab=report` | 88ms |  (`6-ctv-dai-ly/32-bam-tab-bao-cao.png`) |
| 33 | [đại lý] Tab Báo cáo | đại lý: 5 | `/dai-ly?tab=report` | - |  (`6-ctv-dai-ly/33-tab-bao-cao.png`) |
| 34 | [đại lý] Bấm tab Bảng giá | đại lý: 6 | `/dai-ly` | 66ms |  (`6-ctv-dai-ly/34-bam-tab-bang-gia.png`) |
| 35 | [đại lý] Bấm Dán đơn (ở tab Bảng giá) | đại lý: 7 | `/dai-ly` | - |  (`6-ctv-dai-ly/35-bam-dan-don-o-tab-bang-gia.png`) |
| 36 | [đại lý] Sau khi bấm Dán đơn | đại lý: 7 | `/dai-ly` | - |  (`6-ctv-dai-ly/36-sau-khi-bam-dan-don.png`) |

## Màn Thanh toán và Cá nhân ở 1280 (thêm cho luồng 2 và 4)
Thanh toán 1280: hai cột (địa chỉ, phương thức, ghi chú bên trái; tóm tắt đơn, mã giảm, tick dùng Điểm Xanh, Tổng cộng, nút Đặt hàng bên phải, luôn thấy ở 800px cao) (`desk-1280/06-…`). Điểm Xanh dùng được hiện rõ "Bạn có 28.400 Điểm Xanh", kèm lý do 9.600 điểm chưa dùng được. Cá nhân 1280: thanh bên Mua sắm/Điểm và quà/Tài khoản, thẻ 38.000 điểm, Ví Tubu, mã giảm, Đơn của tôi, Mời bạn bè, Kiếm tiền (`desk-1280/08-…`). Không thấy lối "Chat với Tubu Tree"/Hỗ trợ ở đầu trang Cá nhân 1280 (chỉ thấy phần đầu 800px, chưa cuộn).
Cá nhân 1280 vào bằng ô tên trên thanh đầu (1 chạm). Chưa so với Mini App 1280.

| # | Bước | Chạm cộng dồn | Màn | Chờ | Ghi chú / ảnh |
|---|---|---|---|---|---|
| 1 | PDP ở 1280 | 0 | `/san-pham/nuoc-rua-chen-fuwa3e` | - |  (`desk-1280/01-pdp-o-1280.png`) |
| 2 | Bấm Thêm vào giỏ | 1 | `/san-pham/nuoc-rua-chen-fuwa3e` | 65ms |  (`desk-1280/02-bam-them-vao-gio.png`) |
| 3 | Mở giỏ (Xem giỏ hàng) | 2 | `/gio-hang` | 335ms |  (`desk-1280/03-mo-gio-xem-gio-hang.png`) |
| 4 | Giỏ hàng ở 1280 | 2 | `/gio-hang` | - |  (`desk-1280/04-gio-hang-o-1280.png`) |
| 5 | Bấm Thanh toán | 3 | `/thanh-toan` | 470ms |  (`desk-1280/05-bam-thanh-toan.png`) |
| 6 | Màn Thanh toán ở 1280 | 3 | `/thanh-toan` | - | xem bố cục, nút Đặt hàng, tóm tắt đơn (`desk-1280/06-man-thanh-toan-o-1280.png`) |
| 7 | Bấm ô tên (N Lại) trên thanh đầu trang | 4 | `/tai-khoan` | 130ms |  (`desk-1280/07-bam-o-ten-n-lai-tren-thanh-dau-trang.png`) |
| 8 | Màn Cá nhân ở 1280 | 4 | `/tai-khoan` | - |  (`desk-1280/08-man-ca-nhan-o-1280.png`) |

## 8 chỗ khựng nặng nhất
1. Đổi rác: trang yêu cầu không tự cập nhật sau khi quầy xác nhận, và Quay lại rơi vào form tạo trống (luồng 5, `18-…`, `22-…`).
2. Guest: 5/7 việc dừng ở màn Đăng nhập, gồm theo dõi đơn, chat, Ưu đãi, Vườn Xanh, CTV; màn Cá nhân của guest không nói sẽ có gì (luồng 1, `40-…`, `44-…`).
3. Màn chào mừng phủ kín: khảo sát 9 chạm hoặc Để sau, chặn trang chủ, không tự tắt (luồng 1, `01-…`).
4. Chat CSKH sâu: không có ở trang chủ, 2 chạm qua Cá nhân; guest không vào được (luồng 1).
5. CTV: ô Chuyển vào Ví mờ không lý do, hai nút Chia sẻ, "Hôm nay 9.520đ" cho hoa hồng đang chờ (luồng 6).
6. Kho quà: bán mã freeship cho hạng đã được freeship; "Xem ví mã" đi sang trang Hạng (luồng 4, `06-…`, `09-…`).
7. Đơn không có ngày giao dự kiến, chỉ giờ các mốc đã qua (luồng 3).
8. Đăng ký CTV xong gặp `GET /academy/courses` 403 (luồng 6, `07-…`), và ô tìm không có nút Tìm dù chữ nhắc "nhấn Tìm" (luồng 2, `03-…`).

## Không đi hết / chưa kiểm
- Chuyển khoản (BANK_TRANSFER) không đi, chỉ COD.
- Chat CSKH: chỉ mở màn chat, chưa gửi tin.
- Gian hàng CTV: chưa đi 4 bước mở gian hàng; chưa tạo link chia sẻ.
- Đại lý: chưa đặt đơn sỉ, chưa dán đơn.
- Số "chờ" là mốc dev, xem mục đo.
- Mã cũ B-xx: chưa đối chiếu từng mục với `20-backlog.md`.
