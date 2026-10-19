# KỊCH BẢN ĐƠN THỬ THẬT

Dành cho chủ shop và người giúp việc làm theo từng bước, trên hệ thống thật, TRƯỚC khi mở bán cho khách. Mọi tên màn hình, nút, trạng thái và câu chữ trong tài liệu này lấy từ mã nguồn hiện tại (ngày 15/10/2026), không phải từ trí nhớ. Chỗ nào chỉ một cuộc gọi thật tới Pancake, Gomdon, Zalo hay ngân hàng mới trả lời được thì có khung "Giả định cần xác nhận" ngay dưới bước đó.

Làm sau khi đã deploy xong theo [deploy-rollback-runbook.md](deploy-rollback-runbook.md) và `go-live:check` sau deploy không còn FAIL.

Tổng thời gian: khoảng 1,5 ngày làm việc, cộng các mốc chờ ngoài (hoàn tiền ngân hàng 1 đến 3 ngày, đối soát đối tác ngày +7).

## A. Đọc trước

### A.1 Mỗi bước được viết theo mẫu này

- **Ai**: người làm. **Ở đâu**: màn hình hoặc ứng dụng nào.
- **Làm**: thao tác chính xác.
- **Đúng là**: điều phải thấy (giao diện), kèm **Bằng chứng** (màn Quản trị nào, hoặc câu SQL ở Phụ lục).
- **Hoàn tác / lấy lại tiền**: cách rút lại bước đó hoặc lấy tiền về.
- **Giả định cần xác nhận**: khung chỉ ra điều chưa ai kiểm chứng được nếu chưa gọi thật. Ghi kết quả thật vào ô "Ghi chú" của bảng kết quả (mục 11).
- Cuối mỗi bước có ô để tick: `[ ] Đạt  [ ] Không đạt  Mã đơn: ______`. Bảng tổng hợp để chủ shop điền nằm ở mục 11.

### A.2 Ai là ai

| Vai | Làm gì | Thiết bị |
|---|---|---|
| **Người thử** (thường là chủ shop) | Đặt đơn, huỷ đơn, viết đánh giá như một khách thật, bằng Zalo của chính mình | Điện thoại có Zalo bản mới, app ngân hàng; một máy tính để thử web |
| **Quản trị** (chủ shop hoặc người được giao) | Làm trên web Quản trị `https://app.tubutree.com/admin` | Máy tính |
| **Kho** | Làm trên Pancake POS: xác nhận, đóng gói, giao hãng, đổi trạng thái đơn | Máy tính của kho |
| **Đối tác thử** | Làm trên Cổng người bán (web `https://app.tubutree.com/merchant`) với một tài khoản Zalo KHÁC tài khoản Người thử | Máy tính |
| **Người gõ lệnh** | Chạy câu SQL chỉ-đọc trong Phụ lục trên VPS (không bắt buộc, chỉ để lấy bằng chứng sâu) | Terminal SSH vào VPS |
| **Người theo dõi** | Mở sẵn màn Quản trị, Sức khoẻ hệ thống và Việc cần xử lý trong suốt buổi thử; báo ngay khi có dòng đỏ | Máy tính |

Mọi thao tác "Quản trị" trên Quản trị cần tài khoản có quyền ADMIN. Thao tác của nhân viên kho trên Tubu (không phải Pancake) cần quyền KHO.

### A.3 Cách xem bằng chứng

1. **Màn Quản trị** (đủ cho 90% việc). Các mục dùng trong tài liệu này, theo đúng tên trên menu: Việc cần xử lý, Đơn hàng, Đơn đối tác & đối soát, Đổi / Trả, Hoàn tiền khách, Duyệt SP đối tác, Đánh giá, Đổi rác, Mẫu thông báo, Cấu hình, Sức khoẻ hệ thống. Mở một đơn trong tab Đơn hàng để thấy khối "Kho Pancake", "Thu kèm rác (Gomdon)" và lịch sử trạng thái.
2. **Câu SQL chỉ-đọc** (Phụ lục P). Chỉ làm khi có người quen dòng lệnh. Mỗi câu chỉ `SELECT`. Cần `psqlq` đã định nghĩa ở mục 0.4 của [deploy-rollback-runbook.md](deploy-rollback-runbook.md).
3. **Pancake POS**: màn đơn hàng của Pancake. Đơn do Tubu đẩy sang có `custom_id` bằng mã đơn Tubu, ghi chú bắt đầu bằng `Order code: <mã đơn>`, kèm tag nền tảng (`MINIAPP` hoặc `WEB`), `RETAIL`, và một tag tiền: `COD`, `DA_THANH_TOAN` (đã trả trước, KHÔNG thu COD), `CHO_CHUYEN_KHOAN` hoặc `CONG_NO`. Đơn thu gom tái chế có thêm tag `RECYCLING`, và `GOMDON` khi đã có vận đơn.

### A.4 Quy tắc an toàn khi thử

- Chỉ dùng **sản phẩm rẻ nhất** (gọi tắt SP-MIN, mục B.3) và tài khoản của chính bạn. Không thử bằng đơn của khách thật.
- Tổng đơn nhỏ nhưng là tiền THẬT: mọi khoản chuyển khoản bạn bỏ ra đều phải lấy lại được qua Ví Tubu hoặc hàng đợi Hoàn tiền khách. Ghi lại số dư trước và sau (bảng ở mục B.5).
- Không bấm nút nào ở Quản trị mà bước này không yêu cầu.
- Gặp một điều kiện ở mục C: dừng ngay, không cố làm tiếp.

## B. Chuẩn bị trước giờ G

### B.1 Hệ thống

- [ ] Đã deploy xong theo runbook; `pnpm run go-live:check` (sau deploy) không còn FAIL; các dòng WARN đã đọc và chốt "chấp nhận" hoặc đã sửa. Ghi lại: ______
- [ ] Làm TRƯỚC khi mở bán cho khách thật. Nếu buộc phải làm khi đã có khách: báo kho riêng các mã đơn thử, và người theo dõi lọc đơn theo SĐT của Người thử.
- [ ] Đã có bản sao lưu DB gần nhất (runbook, mục 5 bước 6) hoặc bản 02:00 sáng nay.
- [ ] Sức khoẻ hệ thống: Pancake "Đã cấu hình"; Gomdon "Đã cấu hình" nếu làm Phần 3.

### B.2 Người và thiết bị

- [ ] Người thử: Zalo cá nhân, SĐT thật, địa chỉ nhận hàng thật trong vùng giao của Gomdon (Phần 3). Tên: ______ SĐT: ______
- [ ] Người thử chưa có yêu cầu Đổi rác nào còn mở và chưa có yêu cầu nào trong tháng này (Mini App, Đổi rác, Yêu cầu của tôi). Bảng gói rác ở B.7 tính trần 3 yêu cầu mở cùng lúc, trần 60.000 điểm một tháng và trần từng món từ mức không; yêu cầu cũ chưa huỷ, kể cả đã hoàn tất, làm các con số đó sai. Đã có thì dùng tài khoản Zalo khác làm Người thử.
- [ ] Quản trị: tên ______
- [ ] Kho Pancake đã được báo: "các đơn của SĐT ______ trong hai ngày tới là đơn thử, làm đúng theo yêu cầu từng bước". Tên người kho: ______
- [ ] Đối tác thử: tài khoản Zalo thứ hai, đã có gian hàng đã xuất bản (Phần 6). Tên: ______
- [ ] Người theo dõi: tên ______ (mở sẵn hai tab: Sức khoẻ hệ thống, Việc cần xử lý)
- [ ] Người gõ lệnh (nếu có): tên ______

### B.3 Sản phẩm rẻ nhất (SP-MIN)

Chọn một sản phẩm Tubu giao (không phải hàng đối tác) thoả đủ:

- [ ] giá rẻ nhất trong danh mục đang bán (đơn dưới 200.000đ còn cộng phí giao 19.000đ theo `shipping.flat_fee_below_threshold`)
- [ ] có đúng một biến thể, không phải combo, không đang Flash Sale, không áp mã giảm giá tự động
- [ ] tồn kho Tubu đủ cho cả hai mức, lấy mức lớn hơn: từ 10 trở lên (khoảng 8 đơn vị cho T1 đến T12 cùng lúc), và từ 2 + (99.000đ chia giá, làm tròn lên) trở lên (lúc làm 7.4, T2 và T3 giao thật đã lấy 2 đơn vị, các đơn huỷ đã trả lại tồn, và đơn T13 cần số đơn vị để giỏ đạt 99.000đ)
- [ ] có khai báo cân nặng (Gomdon tính theo gram, thiếu thì lấy 500 g)

Ghi lại: tên ______ giá ______ tồn Tubu ______ tồn Pancake ______

### B.4 Tiền

- [ ] Tài khoản ngân hàng cá nhân của Người thử có tối thiểu 300.000đ để chuyển khoản qua lại. Các khoản này hoàn lại được ở Phần 4.
- [ ] Tài khoản nhận tiền hoàn (tên ngân hàng, số tài khoản, chủ tài khoản) của Người thử đã sẵn sàng để nhập ở bước 4.3.

### B.5 Ghi số "trước" (đối chiếu "sau" ở mục 10)

| Số | Trước | Sau | Cách xem |
|---|---|---|---|
| Tồn Tubu của SP-MIN | | | Phụ lục P3 |
| Tồn Pancake của SP-MIN | | | Pancake POS |
| Số dư Ví Tubu của Người thử | | | Mini App, Ví Tubu |
| Điểm Xanh của Người thử | | | Mini App, Điểm Xanh |
| Số dư ngân hàng của Người thử | | | App ngân hàng |
| Số đơn trong tab Đơn hàng | | | Quản trị |

### B.6 Lịch gợi ý

| Mốc | Việc |
|---|---|
| Sáng ngày 1 | B (chuẩn bị), Phần 1, 2.1 đến 2.4 (đơn T1), đặt T3 và T4 sớm (Phần 3) để bưu tá kịp tới lấy trong ngày |
| Trưa ngày 1 | T2 (2.5 đến 2.7), Phần 4 (T5, T6, T7, T8), Phần 5, Phần 9 |
| Chiều ngày 1 | Phần 2.9 và 2.10, Phần 6.1 đến 6.4 và 6.6, Phần 7.1 và 7.2 (tạo yêu cầu và gửi kiện) |
| Ngày 2 | Phần 3.3 (giao thật), Phần 7.2 (kho đếm khi kiện về), 7.3 (kho đếm khi kiện thu kèm về), 7.4 (khi kho đã đếm 7.1 và 7.2), Phần 8 (cần T2 và T3 đã giao), Phần 4.3 (xác nhận tiền hoàn ngân hàng về). 7.5 làm sau cùng, khi kho đã đếm cả 7.2 và 7.3 (nếu có làm 7.3; có thể sang ngày sau nếu kiện chưa về kho), vì 7.5 khoá tài khoản Người thử |
| Ngày +7 | Phần 6.5 và 6.7 (lập phiếu và chi đối soát). Điền ngày hẹn: ______ |
| Sau cùng | Phần 10 (dọn dẹp) và điền mục 11 |

### B.7 Bảng đơn thử (ghi mã đơn vào cột cuối khi đặt)

| Mã | Mua gì | Thanh toán | Dùng để thử | Kết cục | Mã đơn thật |
|---|---|---|---|---|---|
| T1 | SP-MIN x1 | COD | Đẩy Pancake, huỷ TRƯỚC bàn giao, ZNS xác nhận | Huỷ | |
| T2 | SP-MIN x1 | COD | Webhook trạng thái, bàn giao rồi KHÔNG huỷ được, giao thật | Giao | |
| T3 | SP-MIN x1, kèm yêu cầu Thu kèm đơn 10 thùng carton (gói T3 ở bảng dưới), bật công tắc Thu kèm rác ở thanh toán | COD | Vận đơn Gomdon, webhook, giao thật | Giao | |
| T4 | SP-MIN x1, kèm yêu cầu Thu kèm đơn 50 vỏ hộp sữa (gói T4 ở bảng dưới), bật công tắc Thu kèm rác ở thanh toán | COD | Huỷ rồi tạo lại vận đơn, huỷ cả đơn | Huỷ | |
| T5 | SP-MIN x1 | Chuyển khoản, trả thật | Pancake xác nhận tiền, huỷ rồi hoàn về Ví Tubu | Huỷ, tiền về Ví | |
| T6 | SP-MIN x1 | Chuyển khoản, trả thật | Huỷ rồi hoàn về ngân hàng (hàng đợi admin) | Huỷ, tiền về ngân hàng | |
| T7 | SP-MIN x1 | Chuyển khoản, CHƯA trả | Huỷ, rồi chuyển tiền muộn | Huỷ, hoàn | |
| T8 (tuỳ chọn) | SP-MIN x1 | Chuyển khoản, trả THIẾU | Cảnh báo "Khách chuyển thiếu", báo động vận hành | Huỷ, hoàn số đã nhận | |
| T9 (tuỳ chọn) | SP-MIN x1 | COD | Kho huỷ đơn bên Pancake | Huỷ | |
| T10 | Hàng đối tác tự giao x1 | Ví Tubu | Đơn đối tác, đối soát | Giao | |
| T11 | Hàng đối tác "Tubu giao hộ" x1 | COD | Ký gửi, kho Tubu giao, đối soát | Giao | |
| T12 (tuỳ chọn) | Nhiều hàng, sát 5.000.000đ | COD | Trần COD | Huỷ ngay | |
| T13 | SP-MIN, số lượng để giỏ nằm từ 99.000đ đến dưới 200.000đ (bước 7.4) | COD | Dùng voucher "Miễn phí vận chuyển" đã đổi bằng Điểm Xanh | Huỷ hoặc Giao | |

**Gói rác của các yêu cầu Đổi rác thử.** Thu kèm đơn cần ít nhất 10.000 điểm ước tính (`waste.pickup_min_points` = 10.000) và Gửi về kho cần ít nhất 15.000 (`waste.mailin_min_points` = 15.000); dưới mức đó máy chủ từ chối ngay khi tạo yêu cầu. Điểm ước tính của một món = phần nguyên của (số lượng chia số đơn vị mỗi nhóm) nhân điểm mỗi nhóm.

| Bước | Cách giao | Gói | Tính | Điểm ước tính |
|---|---|---|---|---|
| T3 (3.2) | Thu kèm đơn | 10 thùng Thùng carton cũ | 10 chia 1 = 10 nhóm, nhân 1.000 | 10.000 |
| T4 (3.4) | Thu kèm đơn | 50 vỏ Vỏ hộp sữa sạch | 50 chia 5 = 10 nhóm, nhân 1.000 | 10.000 |
| 7.1 | Mang tới điểm nhận | 3 túi lớn Nilon chống sốc | 3 chia 1 = 3 nhóm, nhân 1.000 | 3.000 |
| 7.2 | Gửi về kho | 20 thùng Thùng carton cũ | 20 chia 1 = 20 nhóm, nhân 1.000 | 20.000 |

Vì sao chọn như vậy: (1) trần ngày của món (carton 10 thùng, nilon 10 túi, vỏ sữa 50 vỏ) chỉ được kiểm khi tạo yêu cầu Mang tới điểm nhận, nhưng số đã dùng trong ngày gồm yêu cầu của mọi cách giao; T3 đã dùng hết 10 thùng carton của ngày, nên bước 7.1 dùng món khác (nilon, T3 và T4 không đụng tới). (2) Tổng điểm ước tính cả đợt thử là 10.000 + 10.000 + 3.000 + 20.000 = 43.000, dưới trần `waste.customer_monthly_cap_points` = 60.000 của một khách trong tháng (T4 bị huỷ ở 3.5 thì phần 10.000 được trả lại). (3) Carton dùng 10 + 20 = 30 thùng trên trần tháng 60 thùng; vỏ sữa 50 trên 300; nilon 3 trên 60. (4) Một khách mở tối đa 3 yêu cầu cùng lúc (`waste.max_open_requests` = 3): T3, T4 và một yêu cầu thử khác chạy cùng nhau vẫn vừa; làm 7.2 sau 7.1 vì yêu cầu 7.1 đã hoàn tất tại quầy. (5) 7.2 lấy 20 thùng, nhiều hơn mức tối thiểu 15.000, để 7.1 và 7.2 cộng lại 23.000 điểm: đủ đổi voucher rẻ nhất (20.000 điểm) ở 7.4 mà không cần chờ Thu kèm đơn ở 7.3, kể cả khi quầy đếm ít hơn số khai vài thùng.

Nếu chủ shop đã bỏ món "Vỏ hộp sữa sạch" khỏi giai đoạn 1 (checklist mục 3): T4 dùng 10 túi lớn Nilon chống sốc (10 chia 1 = 10 nhóm, nhân 1.000 = 10.000 điểm), và ghi chú vận đơn của T4 ở bước 3.4 là "Nilon chống sốc: 10 túi lớn". Khi đó carton (T3) và nilon (T4) đều hết trần ngày trong lúc T4 còn mở, nên làm bước 7.1 sau khi T4 đã huỷ ở 3.5 (huỷ đơn trả lại phần trần ngày của nilon), hoặc vào ngày hôm sau (trần ngày tính theo ngày tạo yêu cầu, giờ Việt Nam).

## C. Điều kiện DỪNG và gọi ai

Gặp bất kỳ dòng nào dưới đây: DỪNG, chụp màn hình, ghi mã đơn, rồi gọi. Không sửa tay trong Cơ sở dữ liệu.

| Nếu thấy | Làm |
|---|---|
| Tiền bị trừ hai lần, hoặc Ví Tubu hay Hoàn tiền khách ra số khác với số khách đã trả | Dừng cả buổi thử. Gọi Tech lead và Chủ shop |
| Số dư Ví Tubu của Người thử bị ÂM, hoặc một đơn có hai khoản hoàn cùng loại | Dừng. Gọi Tech lead |
| Cùng một mã đơn xuất hiện hai lần trên Pancake POS, hoặc hai vận đơn Gomdon cho một đơn | Dừng đặt đơn mới. Kho không giao. Gọi Tech lead |
| Đơn hiện "Đã thanh toán" nhưng tiền KHÔNG có trong sao kê ngân hàng | Dừng Phần 4. Gọi Tech lead |
| Pancake báo "Đã xác nhận" hay "Đã gửi hàng" cho một đơn mà Tubu vẫn "Chờ thanh toán" quá 30 phút | Dừng. Gọi Tech lead |
| Màn Sức khoẻ hệ thống đỏ quá 15 phút, hoặc "Webhook lỗi chưa xử lý" lớn hơn 0 mà không tự về 0 sau 10 phút | Dừng. Gọi Tech lead |
| "Gomdon từ chối đăng nhập" hoặc nút Kiểm tra kết nối báo "Không đăng nhập được Gomdon" | Dừng Phần 3 (đừng bấm thử liên tiếp, tài khoản có thể bị khoá). Gọi Tech lead |
| Khách thật (không phải Người thử) đặt hàng giữa lúc thử | Báo kho tách đơn thật khỏi đơn thử. Tiếp tục nếu không ảnh hưởng, dừng nếu đụng tồn kho |
| ZNS gửi tới số điện thoại không phải của Người thử | Dừng. Gọi Tech lead |

| Việc | Gọi |
|---|---|
| Lỗi hệ thống, số tiền sai, cần quyết định dừng | Tech lead: ____________ |
| Quyết định dừng, đổi cấu hình giữ nguyên (ví dụ `merchant.settlement_hold_days`) | Chủ shop: ____________ |
| Pancake POS không vào được, kho không thao tác được | Người phụ trách Pancake: ____________ |
| Gomdon, BestExpress (bưu tá, vận đơn) | Đầu mối Gomdon: ____________ |

---

## Phần 1. Zalo: đăng nhập và mẫu ZNS

### 1.1 Đăng nhập Mini App bằng Zalo thật

- **Ai**: Người thử. **Ở đâu**: điện thoại, Zalo, mở Mini App Tubu Tree (từ mã QR kênh test hoặc từ OA).
- **Làm**: mở Mini App lần đầu bằng tài khoản Zalo của mình. Thêm SP-MIN vào giỏ, vào thanh toán, bấm đặt hàng (chưa cần đặt thật, dừng ở hộp xin quyền nếu thấy). Nếu Zalo hiện hộp xin quyền số điện thoại: cho phép (ZNS và SĐT nhận hàng cần số này).
- **Đúng là**: vào thẳng trang chủ, không bị đẩy ra đăng nhập lặp lại; Hồ sơ hiện tên hoặc ảnh Zalo. Ghi lại xem hộp xin số điện thoại có hiện không và hiện ở bước nào: ______
- **Bằng chứng**: Quản trị, Người dùng, tìm theo tên: có người dùng mới với SĐT dạng `0xxxxxxxxx`.
- **Hoàn tác**: không cần.
- Kiểm chi tiết các ô khác (ô chọn ngày, chia sẻ, thao tác trên máy thật) ở [UAT-ZALO.md](../2026-10-review/UAT-ZALO.md) mục 1; không lặp lại ở đây.

> **Giả định cần xác nhận:** Mini App chạy trong WebView Zalo thật lần đầu (toàn bộ kiểm thử trước đó dùng trình duyệt giả lập). Ghi máy và bản Zalo: ______

`[ ] Đạt  [ ] Không đạt`

### 1.2 Đăng nhập web bằng Zalo

- **Ai**: Người thử. **Ở đâu**: trình duyệt điện thoại và một máy tính, `https://app.tubutree.com/dang-nhap`.
- **Làm**: bấm "Đăng nhập với Zalo", đồng ý cấp quyền. Thử một lần nữa và bấm "Từ chối".
- **Đúng là**: đồng ý thì về `app.tubutree.com` và đã đăng nhập (thấy tên); từ chối thì về trang đăng nhập với câu giải thích bằng tiếng Việt và nút thử lại.
- **Bằng chứng**: cùng người dùng ở bước 1.1 (cùng tài khoản Zalo thì không tạo người thứ hai).
- **Hoàn tác**: đăng xuất.
- Danh sách đầy đủ (về đúng trang giỏ hàng, gian hàng subdomain, đóng trình duyệt vẫn đăng nhập) ở [UAT-ZALO.md](../2026-10-review/UAT-ZALO.md) mục 12.

> **Giả định cần xác nhận:** (1) Zalo chấp nhận Callback URL `https://app.tubutree.com/dang-nhap/callback` và ứng dụng Zalo đã ở trạng thái công khai (chế độ phát triển thường chỉ cho tài khoản được thêm làm người thử đăng nhập). (2) Zalo có chấp nhận `redirect_uri` ở subdomain gian hàng CTV hay không: chưa có bằng chứng ([GO-LIVE-KEYS.md](../GO-LIVE-KEYS.md) mục 2, Bước E).

`[ ] Đạt  [ ] Không đạt`

### 1.3 Kiểm tra mẫu ZNS đã được Zalo duyệt

> **Lưu ý theo quyết định đã chốt:** chủ chỉ nộp 3 mẫu `REVIEW_REQUEST`, `GROUP_BUY_SUCCESS`, `GROUP_BUY_FAILED` (bảng khoá tham số ở [GO-LIVE-KEYS.md](../GO-LIVE-KEYS.md) mục 2, Bước D). `ORDER_CONFIRMED` và `ORDER_SHIPPING` chưa nộp nên các bước 1.3 đến 1.6 và 2.2, 2.5 dưới đây, viết cho hai mẫu đó, chỉ chạy được khi chủ đã quyết nộp thêm; nếu chưa, bỏ qua 1.5 và 1.6 và thử ZNS bằng một trong 3 mẫu đã nộp.

- **Ai**: Quản trị. **Ở đâu**: Zalo OA, mục ZNS, danh sách mẫu của OA Tubu Tree.
- **Làm**: mở hai mẫu `ORDER_CONFIRMED` ("Đơn {{order_code}} đã được xác nhận…") và `ORDER_SHIPPING` ("Đơn {{order_code}} đang được giao…"). Kiểm tra trạng thái, ghi lại Template ID (một dãy số).
- **Đúng là**: trạng thái **đã duyệt**; mẫu có đúng một tham số tên `order_code`. Nếu mẫu đang chờ duyệt thì chưa làm tiếp bước 1.4; Template ID chỉ có sau khi duyệt ([GO-LIVE-KEYS.md](../GO-LIVE-KEYS.md) mục 2, Bước D, lead time 7 đến 14 ngày).
- **Bằng chứng**: ảnh chụp màn hình mẫu và ID.
- **Hoàn tác**: không cần.

> **Giả định cần xác nhận:** (1) Tên tham số trong mẫu Zalo duyệt phải GIỐNG HỆT khoá mà Tubu gửi. Tubu gửi `order_code` cho cả `ORDER_CONFIRMED` lẫn `ORDER_SHIPPING`. Nếu mẫu duyệt dùng tên khác thì Zalo từ chối (lỗi tham số), tin sẽ lỗi cho tới khi đổi mẫu hoặc sửa mã. (2) OA đã xác minh, còn hạn mức và số dư ZNS (mã lỗi nhóm hạn mức và ví ZBS được Tubu coi là lỗi vĩnh viễn, không thử lại). (3) Zalo có cho gửi mẫu tới số bất kỳ hay chỉ số đã đăng ký thử: chưa biết.

`[ ] Đạt  [ ] Không đạt  Template ID ORDER_CONFIRMED: ______  ORDER_SHIPPING: ______`

### 1.4 Nhập mã mẫu vào Quản trị

- **Ai**: Quản trị. **Ở đâu**: Quản trị, Mẫu thông báo.
- **Làm**: mở dòng `ORDER_CONFIRMED`. Ô "Kênh" chọn "ZNS + trong app". Ô "Mã mẫu ZNS" nhập Template ID (chỉ số, tối đa 20 chữ số). Lưu. Làm tương tự cho `ORDER_SHIPPING`.
- **Đúng là**: nhãn của dòng đổi thành "Gửi ZNS + trong app". Nếu thấy "Thiếu mã mẫu ZNS" nghĩa là chưa nhập mã.
- **Bằng chứng**: dòng trong Mẫu thông báo; hoặc Phụ lục P11.
- **Hoàn tác**: đặt lại ô "Kênh" là "Trong app": khách chỉ còn nhận thông báo trong app.

`[ ] Đạt  [ ] Không đạt`

### 1.5 Nhận ZNS "đã xác nhận" (làm cùng bước 2.2)

- **Ai**: Người thử. **Ở đâu**: Zalo trên điện thoại.
- **Làm**: đặt đơn T1 theo bước 2.2.
- **Đúng là**: đặt đơn trong khung 08:00 đến 21:00 giờ VN thì trong khoảng 1 đến 2 phút, tin ZNS "Đơn TUBU… đã được xác nhận" tới Zalo của Người thử (COD thì tin tới ngay lúc đặt, vì COD vào thẳng "Đã xác nhận"). Đặt đơn từ 21:00 tới 08:00 thì tin ZNS được hoãn tới 08:00 sáng hôm sau, không bỏ: đó là giờ yên tĩnh, KHÔNG phải lỗi. Khung giờ đọc từ hai khoá Cấu hình `notifications.zns_quiet_start_hour` (mặc định 21) và `notifications.zns_quiet_end_hour` (mặc định 8); hai giá trị bằng nhau là tắt giờ yên tĩnh. Muốn thử ban đêm thì đặt hai khoá bằng nhau (vd cùng 8) rồi trả về 21 và 8 sau khi thử. Tin trong app vẫn lưu ngay.
- **Bằng chứng**: Mẫu thông báo, dòng `ORDER_CONFIRMED`: số "lượt / 30 ngày" của dòng đó tăng 1 (nếu lỗi, dòng báo "<N> lượt ZNS lỗi trong 30 ngày, khách chưa nhận tin Zalo"); Phụ lục P4: dòng mới `channel = ZNS`, `status = SENT`. Lỗi thì `status = FAILED` hoặc `RETRYING`, cột `error` ghi "ZNS lỗi <mã>: <lời của Zalo>".
- **Hoàn tác**: không có (tin đã gửi).

> **Giả định cần xác nhận:** (1) **Định dạng số điện thoại.** Tubu lưu SĐT dạng `0xxxxxxxxx` và đổi sang `84xxxxxxxxx` (0 + 9 số thành 84 + 9 số) ngay trước khi gửi Zalo, theo ví dụ của Zalo; log và bản lưu vẫn giữ số gốc. Chưa kiểm chứng với Zalo thật. Nếu lỗi ghi về số điện thoại không hợp lệ thì đây là việc phải sửa mã (`zns.client.ts`), không phải lỗi mẫu. (2) `error = 0` từ Zalo nghĩa là Zalo nhận lệnh gửi, chưa chắc khách đã nhận được tin (khách không dùng Zalo hoặc tắt nhận thông báo vẫn có thể báo thành công). Đối chiếu bằng mắt trên điện thoại.

`[ ] Đạt  [ ] Không đạt  Mã đơn: ______`

### 1.6 Nhận ZNS "đang giao" (làm cùng bước 2.5)

- Giống bước 1.5 nhưng cho `ORDER_SHIPPING`: tin tới khi đơn T2 chuyển sang "Đang giao".
- **Bằng chứng**: Phụ lục P4, dòng `ORDER_SHIPPING`.

`[ ] Đạt  [ ] Không đạt  Mã đơn: ______`

---

## Phần 2. Pancake: đẩy đơn, webhook, tồn kho, huỷ, danh mục, "Tubu giao hộ"

Nguồn: [GO-LIVE-KEYS.md](../GO-LIVE-KEYS.md) mục 6. Webhook vào Tubu: `https://api.tubutree.com/api/webhooks/pancake`, header `x-webhook-token`. Pancake gửi nguyên object đơn hàng (`type = orders`), mã trạng thái số: 1 Đã xác nhận, 8/9/12/13 các bước đóng gói (Tubu coi là Đang đóng gói), 2 Đã gửi hàng, 3 Đã nhận, 16 Đã thu tiền (hai mã 3 và 16 đều thành "Đã giao"), 6 Đã hủy, 4 Đang hoàn, 5 Đã hoàn, 15 Hoàn một phần, 7 Đã xoá.

### 2.1 Kết nối và webhook

- **Ai**: Quản trị. **Ở đâu**: Quản trị, Sức khoẻ hệ thống, phần Pancake.
- **Làm**: mở màn; bấm "Làm mới".
- **Đúng là**: "Cấu hình: Đã cấu hình"; "Đồng bộ danh mục" có mốc giờ gần đây, không có chữ lỗi; "Webhook lỗi chưa xử lý" và "Webhook kẹt chưa xử lý" đều 0; "Đơn cần xử lý theo Pancake" là 0.
- **Bằng chứng**: chụp màn hình. Phụ lục P5 cho 10 webhook gần nhất.
- **Hoàn tác**: không cần.

> **Giả định cần xác nhận:** Webhook đã được đăng ký đúng URL và header ở Pancake POS (mục Webhook/API). Chưa nhận được webhook thật nào cho tới khi có đơn đầu tiên (bảng `pancake_webhook_events` từng trống ở môi trường thử). "Nhận webhook gần nhất" sẽ chỉ có giá trị sau bước 2.2.

`[ ] Đạt  [ ] Không đạt`

### 2.2 Đặt đơn T1 và đẩy sang Pancake

- **Ai**: Người thử. **Ở đâu**: Mini App.
- **Làm**: ghi tồn SP-MIN ở Pancake POS và ở Phụ lục P3 (số "trước"). Rồi trong Mini App: mở SP-MIN, thêm vào giỏ, vào thanh toán, chọn địa chỉ thật, chọn "Thanh toán khi nhận hàng (COD)", đặt hàng. Ghi mã đơn vào bảng B.7.
- **Đúng là**: đơn hiện ở "Đơn hàng", trạng thái "Đã xác nhận". Trong khoảng 1 phút:
  - Quản trị, Đơn hàng, mở đơn: khối "Kho Pancake" có nhãn "Đã lên Pancake".
  - Pancake POS: có đơn mới, `custom_id` = mã đơn, ghi chú bắt đầu `Order code: <mã> | [THU COD <số tiền>]`, tag `COD`, `MINIAPP`, `RETAIL`.
- **Bằng chứng**: Phụ lục P1: `pancakePushStatus = SYNCED`, `pancakeOrderId` có giá trị.
- **Hoàn tác**: bước 2.4.
- Đồng thời làm bước 1.5.

> **Giả định cần xác nhận:** Phản hồi tạo đơn của Pancake có trả mã đơn Pancake (nếu không, `pancakeOrderId` rỗng và đơn kẹt "Đã lên Pancake"; xem [GO-LIVE-KEYS.md](../GO-LIVE-KEYS.md) mục 6, "Kiểm sau khi đặt key").

`[ ] Đạt  [ ] Không đạt  Mã đơn: ______`

### 2.3 Tồn kho sau khi đặt

- **Ai**: Người gõ lệnh hoặc Quản trị. **Ở đâu**: Phụ lục P3 (SQL) và Pancake POS.
- **Làm**: ghi lại ngay sau khi đặt T1 và sau khi bấm "Đồng bộ danh mục Pancake" ở Quản trị, Sức khoẻ hệ thống (hộp xác nhận ghi rõ "Tồn kho cập nhật theo chênh lệch").
- **Đúng là**: tồn Tubu (`stock`) giảm đúng 1 ngay khi đặt. Sau đồng bộ, `stock` vẫn đúng một lần trừ, không bị trừ hai lần và không "hồi sinh" hàng đã bán. Một trong hai là bình thường (thiết kế chịu được cả hai): Pancake tự trừ tồn khi nhận đơn (`pancakeStock` giảm, `reservedStock` về 0) hoặc Pancake KHÔNG tự trừ (`pancakeStock` đứng yên, `reservedStock` giữ 1).
- **Hoàn tác**: bước 2.4 (huỷ đơn trả lại hàng).

> **Giả định cần xác nhận:** **Pancake có tự trừ tồn khi nhận đơn qua API hay không.** Câu hỏi này đã được thiết kế né ([2026-09-11-P0-3-pancake-stock-decision-brief.md](../2026-09-11-P0-3-pancake-stock-decision-brief.md), mục "Cách đã chốt"), nhưng chưa có số thật. Ghi: tồn Pancake trước ______, sau khi Tubu đẩy đơn ______. Và: Pancake có gửi webhook tồn kho (Tubu đang đọc loại `variation.stock_changed`) hay chỉ gửi webhook đơn hàng? Nếu chỉ có webhook đơn thì tồn kho chỉ cập nhật qua lượt đồng bộ 15 phút.

`[ ] Đạt  [ ] Không đạt  Tồn Tubu trước/sau: ____ / ____  Tồn Pancake trước/sau: ____ / ____`

### 2.4 Huỷ TRƯỚC khi bàn giao (D1)

- **Ai**: Người thử. **Ở đâu**: Mini App, Đơn hàng, mở đơn T1.
- **Làm**: bấm "Hủy đơn", bấm xác nhận "Hủy đơn" (đơn COD không có lựa chọn nơi nhận tiền vì chưa trả).
- **Đúng là**: đơn thành "Đã huỷ". Trong khoảng 1 phút Pancake POS hiện đơn "Đã hủy". Quản trị, mở đơn: khối "Kho Pancake" nhãn "Pancake: đã huỷ". Tồn Tubu tăng lại 1.
- **Bằng chứng**: Phụ lục P1: `pancakeCancelStatus = CANCELLED`, `status = CANCELLED`; Phụ lục P2 (lịch sử trạng thái).
- **Hoàn tác / xử lý lỗi**: nếu sau 5 phút Pancake vẫn chưa huỷ thì Quản trị, Việc cần xử lý sẽ có dòng "Đã huỷ ở Tubu nhưng CHƯA huỷ được trên Pancake": nhờ Kho huỷ tay trên Pancake POS, rồi báo Tech lead (đây là cảnh báo thật nên cũng dùng làm bằng chứng cho Phần 9).

> **Giả định cần xác nhận:** Pancake chỉ cho huỷ khi đơn chưa "Đã gửi hàng" (trạng thái nhỏ hơn 2) và huỷ luôn vận đơn gắn với đơn đó. Phản hồi huỷ của Pancake chưa kiểm chứng ở bản thật.

`[ ] Đạt  [ ] Không đạt  Mã đơn: ______`

### 2.5 Trạng thái đơn đi qua webhook: T2 tới "Đang giao"

- **Ai**: Người thử đặt T2 (giống 2.2); Kho làm tiếp trên Pancake POS.
- **Làm**: sau khi T2 lên Pancake, Kho lần lượt: Xác nhận, Đóng hàng, rồi đặt hãng vận chuyển và đổi sang "Đã gửi hàng" (mã vận đơn của hãng thật). Sau mỗi bước chờ 1 phút rồi nhìn Tubu.
- **Đúng là**: Mini App và Quản trị lần lượt thấy "Đã xác nhận", "Đang đóng gói", "Đang giao"; Quản trị, mở đơn: có hãng và mã vận đơn. Tin ZNS `ORDER_SHIPPING` về điện thoại (bước 1.6). Sức khoẻ hệ thống: "Nhận webhook gần nhất" và "Xử lý webhook gần nhất" đều vừa mới đây.
- **Bằng chứng**: Phụ lục P5: các dòng `status = PROCESSED`; Phụ lục P1: `shippingPartner`, `shippingCode`; Phụ lục P2.
- **Hoàn tác**: không có; sang 2.6.

> **Giả định cần xác nhận:** (1) Webhook đơn của Pancake có đủ trường `status` số và mã đơn để Tubu khớp (payload thật chưa từng được đối chiếu). (2) Pancake ghi hãng và mã vận đơn vào chính đơn khi kho đặt hãng, và Tubu đọc được từ webhook. (3) Webhook từ Pancake không đảm bảo thứ tự: nếu hai sự kiện đảo thứ tự, Tubu không lùi trạng thái (đã có luật chặn); thấy trạng thái nhảy ngược là lỗi.

`[ ] Đạt  [ ] Không đạt  Mã đơn: ______`

### 2.6 Sau bàn giao KHÔNG huỷ được (D1)

- **Ai**: Người thử, rồi Quản trị. **Ở đâu**: Mini App; Quản trị, Đơn hàng, đơn T2.
- **Làm**: làm hai lần để thấy cả hai lớp chặn.
  1. **Màn cũ.** Khi T2 còn "Đã xác nhận" hoặc "Đang đóng gói", Người thử mở đơn T2 trong Mini App (đang thấy nút "Hủy đơn") và KHÔNG đóng màn đó. Kho đổi T2 sang "Đã gửi hàng" trên Pancake. Người thử bấm "Hủy đơn" trên màn cũ rồi xác nhận.
  2. **Màn mới.** Sau khi T2 đã "Đang giao" trên Tubu: Người thử mở lại đơn T2. Quản trị mở đơn T2 và thử bấm "Hủy đơn".
- **Đúng là**: (1) lệnh huỷ bị từ chối với câu "Đơn đã bàn giao cho đơn vị vận chuyển, vui lòng liên hệ CSKH" (Tubu hỏi Pancake mỗi lần có người bấm huỷ đơn đã lên Pancake) và trạng thái đơn được đồng bộ lại thành "Đang giao". Nếu Pancake không trả lời: "Kho chưa phản hồi, vui lòng thử lại sau ít phút" và đơn KHÔNG bị huỷ (cố ý). (2) Mini App không còn nút "Hủy đơn" (chỉ còn nút xem tất cả đơn). Quản trị bấm "Hủy đơn" nhận câu "Đơn <mã> đã bàn giao vận chuyển (<chi tiết>) — không huỷ được nữa. Liên hệ đơn vị vận chuyển để chặn giao/hoàn hàng…". Với đơn đã có mã vận đơn hãng nhưng chưa "Đang giao", câu cho khách là "Đơn đã bàn giao cho đơn vị vận chuyển, vui lòng liên hệ hotline hoặc Zalo OA của Tubu để được hỗ trợ." Đơn giữ nguyên "Đang giao", Pancake không bị huỷ.
- **Bằng chứng**: Phụ lục P1: `status = SHIPPING`, `pancakeCancelStatus` rỗng. Phụ lục P2: không có dòng sang `CANCELLED`.
- **Hoàn tác**: không có gì để hoàn tác (đơn giữ nguyên).
- Sau bàn giao chỉ còn luồng trả hàng, hoàn tiền (tab Đổi / Trả).

> **Giả định cần xác nhận:** Dấu hiệu bàn giao Tubu dùng: đơn đã "Đang giao", HOẶC đã có mã vận đơn hãng (kho đặt hãng trong Pancake), HOẶC bưu tá Gomdon đã lấy hàng. Cần xác nhận kho Pancake thật có ghi mã vận đơn vào đơn ngay khi đặt hãng (nếu chỉ ghi khi giao thì cửa sổ huỷ rộng hơn dự tính).

`[ ] Đạt  [ ] Không đạt  Mã đơn: ______`

### 2.7 Giao xong

- **Ai**: Kho/hãng giao thật tới địa chỉ Người thử; hoặc Kho đổi trạng thái "Đã nhận" trên Pancake nếu hàng đã giao thật.
- **Đúng là**: T2 thành "Đã giao". Người thử nhận Điểm Xanh của đơn (cộng khi đơn Đã giao; điểm đơn này chưa tiêu được tới hết hạn đổi trả, mặc định 7 ngày: xem [UAT-ZALO.md](../2026-10-review/UAT-ZALO.md) mục 5). Tin ZNS/trong app "đã giao".
- **Bằng chứng**: Phụ lục P1 (`status = DELIVERED`, có `deliveredAt` nếu cột có), P2, và Phụ lục P7 (Điểm Xanh).
- **Hoàn tác**: không có. Nếu hàng không giao thật mà Kho chỉ đổi trạng thái để thử, Kho phải chỉnh lại tồn trên Pancake sau bước thử.

> **Giả định cần xác nhận:** Mã 3 "Đã nhận" và 16 "Đã thu tiền" của Pancake đều được Tubu coi là giao xong. Cần xác nhận kho thật báo bằng mã nào.

`[ ] Đạt  [ ] Không đạt  Mã đơn: ______`

### 2.8 (Tuỳ chọn) Kho huỷ đơn bên Pancake trước bàn giao: T9

- **Ai**: Người thử đặt T9 (COD); Kho huỷ đơn trên Pancake POS khi đơn còn ở trạng thái trước "Đã gửi hàng".
- **Đúng là**: trong khoảng 1 đến 2 phút Tubu chuyển đơn sang "Đã huỷ", tồn Tubu tăng lại, Người thử nhận tin huỷ. COD thì không có khoản hoàn.
- **Bằng chứng**: Phụ lục P1, P2 (dòng đổi trạng thái do hệ thống, ghi chú nhắc Pancake), Phụ lục P5.
- **Hoàn tác**: không (đơn huỷ là trạng thái cuối).
- KHÔNG làm bước này trên đơn đã giao thật: Pancake báo huỷ sau bàn giao sẽ thành "Pancake báo HUỶ nhưng đơn đã bàn giao vận chuyển" ở Việc cần xử lý, và Tubu không huỷ.

`[ ] Đạt  [ ] Không đạt  [ ] Bỏ qua  Mã đơn: ______`

### 2.9 Đồng bộ danh mục

- **Ai**: Kho (Pancake POS), rồi Quản trị.
- **Làm**:
  1. Kho tạo một sản phẩm thử trên Pancake POS tên "SP-THỬ", một biến thể, **giá bán bằng 0**, tồn 5.
  2. Quản trị: Sức khoẻ hệ thống, "Công cụ vận hành", "Đồng bộ danh mục Pancake", xác nhận "Đồng bộ".
  3. Kiểm tra SP-THỬ có trong Tubu nhưng KHÔNG hiện ở Mini App (chưa có giá).
  4. Kho đặt giá 10.000đ trên Pancake POS. Đồng bộ lại (hoặc đợi tối đa 15 phút: cron tự chạy).
  5. Mở Mini App, tìm SP-THỬ: phải thấy với giá 10.000đ.
- **Đúng là**: bước 3: Phụ lục P3 cho tên SP-THỬ có `stock`; sản phẩm `isActive = false` và `pancakeHold = NO_PRICE` (kiểm bằng Phụ lục P3b). Bước 5: hiện, `pancakeHold` rỗng. Sức khoẻ hệ thống: "Đồng bộ danh mục" có mốc giờ mới, không báo lỗi.
- **Hoàn tác**: Kho xoá sản phẩm SP-THỬ trên Pancake POS và đồng bộ lại: Tubu tắt bán và ghi `pancakeHold = REMOVED`. KHÔNG xoá hàng loạt trên Pancake: nếu hơn một nửa danh mục "biến mất" trong một lượt quét, Tubu không tắt gì và chỉ ghi lỗi (chống lỗi phân trang).
- Giữ SP-THỬ (đang giá 10.000đ, đang bán) cho bước 2.10; dọn ở Phần 10.

> **Giả định cần xác nhận:** (1) Pancake trả về sản phẩm giá 0 và cờ xoá (`is_removed`) đúng dạng Tubu đang đọc. (2) Sản phẩm mới của Pancake có giá sẽ TỰ HIỆN trên Mini App mà không cần duyệt: đúng với mã hiện tại nên chỉ làm khi chưa mở bán cho khách.

`[ ] Đạt  [ ] Không đạt`

### 2.10 Duyệt "Tubu giao hộ" (tiếp quản biến thể Pancake)

- **Ai**: Đối tác thử (Cổng người bán), rồi Quản trị.
- **Làm**:
  1. Đối tác thử: Cổng người bán, tab "Sản phẩm", thêm sản phẩm, điền "Mã Pancake" bằng mã biến thể SP-THỬ (có nút kiểm tra mã trong form), gửi duyệt.
  2. Quản trị: tab "Duyệt SP đối tác". Dòng sản phẩm hiện "Chờ duyệt", ghi "Tubu giao hộ · mã Pancake <mã>". Khung Pancake hiện thông báo vàng "Duyệt sẽ chuyển biến thể đang bán của <SP-THỬ>… sang gian hàng…" (trạng thái TAKEOVER: vì SP-THỬ đang bán).
  3. Chọn ô "Tôi đã xem sản phẩm đang bán ở dưới và đồng ý chuyển nó sang gian hàng này", rồi bấm "Duyệt xuất bản".
  4. Vẫn ở tab này, cuộn tới "Liên kết chờ xác nhận hàng ký gửi" / "Đang liên kết mã Pancake": dòng mới ghi "Nhận lại mã của sản phẩm Tubu đang bán". Bấm "Xác nhận hàng ký gửi", rồi "Xác nhận ký gửi" (KHÔNG hoàn tác được: từ lúc này đơn đặt sau đó vào đối soát của đối tác).
- **Đúng là**: bước 3: sản phẩm của đối tác lên bán; SP-THỬ gốc bị tắt bán (vì không còn biến thể nào); tồn khớp. Bước 4: dòng ghi "Đã xác nhận hàng ký gửi <ngày> — đơn đặt từ mốc này vào đối soát của <gian hàng>".
- **Bằng chứng**: Mini App thấy sản phẩm của đối tác, không còn SP-THỬ gốc; Phụ lục P3b (`storefrontId` của sản phẩm).
- **Hoàn tác**: "Gỡ liên kết" (nút ở dòng "Đang liên kết mã Pancake"): trả biến thể về sản phẩm gốc và tắt bán sản phẩm đối tác. Riêng "Xác nhận ký gửi" không hoàn tác được; vì vậy chỉ làm với SP-THỬ, không làm với hàng thật.
- Dùng sản phẩm này làm đơn T11 ở Phần 6.

> **Giả định cần xác nhận:** (1) "Mã Pancake" là mã biến thể Pancake (`variations.pancakeId`): xác nhận mã hiển thị trên Pancake POS trùng mã mà form "Kiểm tra mã" chấp nhận. (2) Phải mở tab Quản trị MỚI (tải lại cứng) trước khi duyệt: với dòng không có mã Pancake, web mới gửi chuỗi rỗng còn tab cũ gửi `null`, và API mới coi `null` là "không nói gì" nên duyệt theo mã đang lưu (xem [deploy-rollback-runbook.md](deploy-rollback-runbook.md), bước 12).

`[ ] Đạt  [ ] Không đạt`

---

## Phần 3. Gomdon: vận đơn thu gom tái chế

Nguồn: [docs/integrations/gomdon.md](../integrations/gomdon.md) (đối chiếu hợp đồng, 15 điều chưa kiểm chứng ở mục 5) và [GO-LIVE-KEYS.md](../GO-LIVE-KEYS.md) mục 7. Gomdon không có môi trường thử: mọi lệnh ở đây là THẬT, đặt bưu tá thật. Webhook vào Tubu: `https://api.tubutree.com/api/webhooks/gomdon` (header `x-webhook-token`, hoặc secret nằm trong đường dẫn), Gomdon thử lại tối đa 3 lần cách 30 giây rồi bỏ.

### 3.1 Kết nối và công tắc

- **Ai**: Quản trị. **Ở đâu**: Quản trị, Cấu hình, thẻ "Thu kèm rác qua Gomdon (kỹ thuật)".
- **Làm**: (1) bấm "Kiểm tra kết nối" (đăng nhập thật, không tạo đơn). (2) Kiểm tra "Kho lấy hàng (người gửi trên vận đơn)": tên, SĐT, địa chỉ, phường, quận, tỉnh là địa chỉ kho THẬT theo địa giới hành chính hiện hành. (3) Bật ô "Công tắc kỹ thuật Gomdon".
- **Đúng là**: (1) báo đăng nhập được; không có chữ "từ chối". (3) hiện "Đã BẬT công tắc kỹ thuật Gomdon." Công tắc này một mình chưa làm khách thấy gì. Khi waste.enabled và waste.lane_pickup_enabled cũng bật, dòng "Khách ĐANG thấy lựa chọn thu gom" hiện và bước thanh toán Mini App hiện công tắc "Thu kèm rác" cho khách có yêu cầu Thu kèm đơn chưa gắn đơn.
- **Bằng chứng**: chụp thẻ; Phụ lục P11 cho khoá `shipping.gomdon.recycling_enabled` phải là `true` (kiểu boolean).
- **Hoàn tác**: tắt lại ô công tắc.

Trước khi sang 3.2, bật thêm hai công tắc của khách để thẻ "Thu kèm đơn mua" hiện ra (cho lần chạy nội bộ này):

- **Ai**: Quản trị. **Ở đâu**: Quản trị, Khách hàng, Đổi rác, Cấu hình chung.
- **Trước khi làm**: kho HCMC đã đăng ký ở Quản trị, Khách hàng, Đổi rác, Điểm nhận (loại "Kho Tubu", luôn ở trạng thái "Đang nhận", ô "Số điện thoại" có số thật; checklist mục 2). Chưa có kho mà bật `waste.enabled` thì `go-live:check` báo FAIL `db.waste_point`, và 3.2 bị từ chối với câu "Điểm nhận đang tạm ngừng, hãy chọn điểm khác".
- **Làm**: bật "Bật chương trình với khách" (`waste.enabled`) và "Cách Thu kèm đơn (còn cần cờ Gomdon)" (`waste.lane_pickup_enabled`), rồi lưu và xác nhận. Cả hai là cờ toàn cục: chỉ bật trên bản chưa mở cho khách thật (checklist mục 1 và mục 5). `waste.enabled` còn mở luôn hai cách Mang tới điểm nhận và Gửi về kho (mặc định đang bật), nên nếu bản này đã mở cho khách thật thì mọi khách thấy cả ba cách, không chỉ Thu kèm đơn.
- **Đúng là**: thẻ "Thu kèm rác qua Gomdon (kỹ thuật)" hiện dòng "Khách ĐANG thấy lựa chọn thu gom"; ở Mini App, bước chọn cách giao có thẻ "Thu kèm đơn mua". Thiếu một trong ba công tắc (hai công tắc này và công tắc kỹ thuật Gomdon) thì thẻ không hiện và 3.2 không làm được.
- **Hoàn tác**: mục 10 (dọn dẹp). Nếu Gomdon chưa trả lời bằng văn bản, hoặc T3 chưa đạt, thì tắt lại ngay sau 3.3 (checklist mục 4), không chờ tới cuối.

> **Giả định cần xác nhận:** (1) Địa chỉ kho mặc định trong hệ thống là "Thành phố Thủ Đức" (địa giới cũ): phải đổi theo địa giới mới trước khi bật (UAT GOMDON-7, [gomdon.md](../integrations/gomdon.md) mục 5, điều 6). (2) Gomdon có chấp nhận địa chỉ hai cấp (không quận): Tubu gửi tên phường vào ô quận. Cách kiểm: đặt T3 bằng địa chỉ hai cấp. Nếu Gomdon từ chối thì đơn thành "Tạo vận đơn thất bại" ngay lần thử đầu.

`[ ] Đạt  [ ] Không đạt`

### 3.2 Tạo vận đơn: đặt T3

- **Ai**: Người thử. **Ở đâu**: Mini App.
- **Làm**: tạo một yêu cầu Đổi rác cách Thu kèm đơn (Mini App, Đổi rác, Đổi rác ngay, chọn 10 thùng carton, cách giao "Thu kèm đơn mua"; gói này ước tính 10.000 điểm, đúng bằng mức tối thiểu của Thu kèm đơn, ít hơn thì máy chủ không cho tạo yêu cầu), thêm SP-MIN vào giỏ, vào thanh toán, bật công tắc "Thu kèm rác" (thẻ tóm tắt hiện mã TR-), chọn COD, đặt hàng. Ghi mã đơn và mã TR-.
- **Đúng là**: trong khoảng 1 phút, Quản trị, mở đơn: khối "Thu kèm rác (Gomdon)" ghi trạng thái "Tạo đơn thành công" (mã 1) và có dòng "Mã vận đơn BestExpress:" kèm mã. Pancake POS: đơn có tag `RECYCLING` và `GOMDON`; kho KHÔNG đặt thêm hãng khác. Ghi chú vận đơn do máy chủ dựng: mã TR- và "Thùng carton cũ: 10 thùng", không có chữ khách gõ (nhiều món thì nối bằng dấu phẩy và một dấu cách).
- **Bằng chứng**: Phụ lục P1: `gomdonStatus = 1`, `gomdonOrderId` và `gomdonPartnerCode` có giá trị, `shippingPartner = BestExpress`.
- **Hoàn tác**: bước 3.4 và 3.5 (T3 thì để giao thật, T4 dùng để thử huỷ).

> **Giả định cần xác nhận:** phản hồi tạo vận đơn thật của Gomdon có trả `partner_code` ngay không ([gomdon.md](../integrations/gomdon.md) mục 5, điều 9); nếu chỉ có mã số nội bộ thì Tubu tạm lưu mã số và webhook sau thay bằng mã vận đơn thật. Cân nặng gửi lên theo gram.

`[ ] Đạt  [ ] Không đạt  Mã đơn: ______`

### 3.3 Webhook theo hành trình và giao thật

- **Ai**: Bưu tá BestExpress làm thật; Người theo dõi nhìn Quản trị.
- **Làm**: không có thao tác của bạn: để bưu tá tới lấy hàng ở kho, giao tới Người thử và lấy lại vật liệu tái chế (nếu có đưa). Sau mỗi mốc, nhìn lại đơn.
- **Đúng là**: đơn lần lượt thấy "Đã lấy hàng" (3, đơn Tubu chuyển "Đang giao"), "Đang vận chuyển đến bưu cục nhận" (4), "Đang đi giao hàng" (5), "Giao thành công" (7, đơn COD chuyển "Đã giao"). Sức khoẻ hệ thống, phần Gomdon: "Nhận webhook gần nhất" mới; "Webhook lỗi chưa xử lý" 0. Webhook cho vận đơn không thuộc đơn nào của ta sẽ ghi `IGNORED`: bình thường.
- **Bằng chứng**: Phụ lục P6 (các dòng `status = PROCESSED`, `gomdonStatus` 1, 3, 5, 7), Phụ lục P1, P2.
- **Hoàn tác**: không có.
- **Nếu không thấy webhook nào sau khi bưu tá đã lấy hàng**: không có cách hỏi lại Gomdon bằng mã (Gomdon không có API tra đơn). Đối chiếu tay trên cổng Gomdon, báo Tech lead, và nhờ Gomdon bắn lại webhook (gomdon.md, mục 3, điều 5).

> **Giả định cần xác nhận:** (1) Gomdon có cho đặt header webhook hay chỉ nhập URL có secret trong đường dẫn; webhook gửi từ IP nào; Content-Type thực tế (mẫu là JSON; Tubu nhận cả JSON, urlencoded và multipart). (2) **Chuỗi trạng thái của vận đơn "đổi hàng" (loại 3).** Chiều mang vật liệu tái chế về kho có báo trên CÙNG vận đơn không (mã 6/8 sau mã 7?). Tubu coi mã 7 là mốc cuối nên mã sau 7 bị bỏ qua; nếu Gomdon báo 6/8 thay cho 7, Quản trị sẽ nhận báo "chuyển hoàn" nhầm và đơn không tự "Đã giao". (3) Gomdon có gửi webhook cho mã 1, và có gửi khi chỉ đổi phí hay cân nặng không.

`[ ] Đạt  [ ] Không đạt  Mã đơn: ______`

### 3.4 Huỷ vận đơn bằng tay (admin), rồi tạo lại: T4

- **Ai**: Người thử đặt T4 (giống 3.2 nhưng gói là 50 vỏ Vỏ hộp sữa sạch, ước tính 10.000 điểm, và ghi chú vận đơn sẽ là "Vỏ hộp sữa sạch: 50 vỏ"; tạo một yêu cầu Thu kèm đơn mới rồi bật công tắc Thu kèm rác ở thanh toán; T4 cần yêu cầu riêng vì yêu cầu của T3 đã gắn vào đơn T3). Quản trị làm tiếp.
- **Làm**: khi T4 đã có "Tạo đơn thành công" và bưu tá CHƯA tới lấy: Quản trị mở đơn T4, khối "Thu kèm rác (Gomdon)", bấm "Huỷ vận đơn Gomdon", xác nhận. Xem trạng thái. Rồi đánh dấu ô "Tôi đã kiểm tra Pancake/Gomdon: kho CHƯA tạo vận đơn tay cho đơn này." và bấm "Tạo lại vận đơn Gomdon".
- **Đúng là**: sau khi huỷ, trạng thái thành "Đơn hủy" (mã 2) và đơn Tubu vẫn còn hiệu lực. Sau "Tạo lại vận đơn Gomdon", có mã vận đơn MỚI (khác mã cũ).
- **Bằng chứng**: Phụ lục P1: `gomdonCancelStatus` (CANCELLED), `gomdonAttempt` tăng 1; Phụ lục P6.
- **Hoàn tác**: bước 3.5 (huỷ cả đơn sẽ huỷ luôn vận đơn mới).
- Nếu Gomdon báo "Không tìm thấy đơn hàng" khi huỷ: đơn vào "Cần xử lý thu gom", kiểm tra trên cổng Gomdon rồi "Đã xử lý tay".

> **Giả định cần xác nhận:** (1) Khi tạo lại, Tubu gửi `order_customer_id` dạng `<mã đơn>-R1`: Gomdon có chấp nhận hậu tố (độ dài, ký tự) không ([gomdon.md](../integrations/gomdon.md) mục 5, điều 1). Nếu từ chối, vận đơn tạo lại sẽ lỗi: đây là kết quả cần ghi lại. (2) Gomdon có coi đơn ĐÃ huỷ là "đã có mã" khi kiểm trùng không.

`[ ] Đạt  [ ] Không đạt  Mã đơn: ______  Mã vận đơn mới: ______`

### 3.5 Huỷ cả đơn: vận đơn bị huỷ theo

- **Ai**: Người thử. **Ở đâu**: Mini App, đơn T4.
- **Làm**: bấm "Hủy đơn" và xác nhận khi bưu tá CHƯA lấy hàng.
- **Đúng là**: đơn "Đã huỷ". Quản trị, mở đơn: `gomdonCancelStatus` thành CANCELLED, trạng thái vận đơn "Đơn hủy". Pancake đã huỷ như bước 2.4.
- **Bằng chứng**: Phụ lục P1, P6.
- **Hoàn tác**: không (cuối).
- Cũng nhìn trên T3 sau khi bưu tá ĐÃ lấy hàng (mã 3 trở đi): Mini App không còn nút "Hủy đơn". Nếu một màn đơn cũ còn mở từ trước lúc bưu tá lấy hàng mà Người thử bấm huỷ, lệnh bị từ chối với câu "Đơn đã được bưu tá lấy hàng, vui lòng liên hệ hotline hoặc Zalo OA của Tubu để được hỗ trợ.". Đơn T3 phải giữ nguyên để giao thật.

`[ ] Đạt  [ ] Không đạt  Mã đơn: ______`

### 3.6 Trạng thái "Gomdon từ chối tài khoản"

KHÔNG thử cố ý trên tài khoản thật (sai mật khẩu nhiều lần có thể làm Gomdon khoá tài khoản). Biết sẵn để nhận ra và xử lý nếu xảy ra thật:

- **Dấu hiệu**: thẻ Gomdon ở Cấu hình báo "Gomdon từ chối…"; công tắc Thu kèm rác ở thanh toán tự ẩn; Sức khoẻ hệ thống, "Kết nối Gomdon" báo lỗi; báo động vận hành `gomdon.credentials` ("Gomdon từ chối đăng nhập — khách không chọn được thu gom") qua email/webhook.
- **Việc cần làm**: Tech lead sửa `GOMDON_PHONE`/`GOMDON_PASSWORD` trong `/opt/tubutree/.env` rồi tạo lại container API (sửa env rồi khởi động lại là gỡ cờ vì API đăng nhập thử lúc khởi động); hoặc bấm "Kiểm tra kết nối" khi đã đúng. Cron cũng thử lại mỗi 30 phút.
- **Đúng là sau khi sửa**: "Kiểm tra kết nối" báo thành công, công tắc Thu kèm rác ở thanh toán hiện lại.

> **Giả định cần xác nhận:** Mã HTTP Gomdon trả cho sai tài khoản (Tubu coi mọi 4xx trừ 429, và `result:false`, là "từ chối"): [gomdon.md](../integrations/gomdon.md) mục 5, điều 14.

`[ ] Đã đọc, hiểu cách xử lý`

---

## Phần 4. Thanh toán online: trả tiền, hoàn Ví hay ngân hàng, tiền về muộn, ZaloPay

### 4.0 Đọc trước: ZaloPay đang bị ẩn

Cả Mini App lẫn web hiện CHỈ có ba cách trả: COD, Chuyển khoản ngân hàng, Ví Tubu. ZaloPay không có nút ở giao diện nào; mã còn nguyên nhưng chưa ai gọi (xem [ZALOPAY-SETUP.md](../ZALOPAY-SETUP.md): "không bắt buộc cho launch"). Thanh toán online thật khi mở bán là **chuyển khoản VietQR**: khách quét mã, nội dung chuyển khoản là mã đơn, Pancake POS (đã liên kết tài khoản ngân hàng của Tubu) tự đối soát rồi bắn webhook, Tubu lật đơn sang "Đã thanh toán". Vì vậy Phần 4 chạy trên chuyển khoản và Ví Tubu; ZaloPay chỉ ở bước 4.6 (nhà phát triển, tuỳ chọn).

Hoàn tiền: Tubu KHÔNG gọi API hoàn tiền của cổng nào. Tiền hoàn đi hai đường: về Ví Tubu (ngay), hoặc vào hàng đợi Hoàn tiền khách để Quản trị chuyển khoản tay (miễn phí, không giới hạn số tiền). Khách chọn nơi nhận khi tự huỷ đơn đã trả; admin/hệ thống huỷ luôn hoàn về Ví.

### 4.1 Trả tiền chuyển khoản: T5

- **Ai**: Người thử. **Ở đâu**: Mini App.
- **Làm**: ghi số dư Ví Tubu và ngân hàng (B.5). Đặt SP-MIN, chọn "Chuyển khoản ngân hàng", đặt hàng. Màn thanh toán `/bank-payment/<mã đơn>` hiện mã QR. Mở app ngân hàng, quét QR, chuyển ĐÚNG số tiền, giữ nguyên nội dung chuyển khoản (mã đơn).
- **Đúng là**: ngay sau khi đặt: "Chờ thanh toán", nhận thông báo "đơn chờ thanh toán" kèm hạn (mặc định 24 giờ). Sau khi chuyển, trong vài phút: đơn thành "Đã xác nhận" và đã thanh toán; tin xác nhận về điện thoại. Pancake POS: đơn mang tag `CHO_CHUYEN_KHOAN` lúc đầu, sau đó ghi nhận đã trả.
- **Bằng chứng**: Phụ lục P1: `paymentStatus = PAID`, `status = CONFIRMED`, `paidAt` có giá trị; Phụ lục P5: webhook đơn sau lúc chuyển; sao kê ngân hàng có khoản tiền.
- **Hoàn tác**: 4.2.
- **Nếu sau 15 phút vẫn "Chờ thanh toán" dù sao kê đã có tiền**: Quản trị mở đơn, bấm "Đã nhận tiền" và ghi mã giao dịch (đường dự phòng thủ công); báo Tech lead.

> **Giả định cần xác nhận:** (1) **Pancake POS tự đối soát chuyển khoản theo nội dung là mã đơn và gửi webhook với số tiền đã nhận**: bình luận trong mã nói rõ hợp đồng trường `prepaid`/`bank_payment` của Pancake chưa từng đối chiếu với payload thật. Đây là điều quan trọng nhất của Phần 4. Ghi: độ trễ từ lúc chuyển tới lúc đơn lật "Đã thanh toán": ______ phút. (2) Tài khoản ngân hàng hiển thị trên QR (`payment.bank_bin`, `payment.bank_account_no`) đúng tài khoản thật của Tubu (đã kiểm ở go-live check, nhưng nhìn bằng mắt).

`[ ] Đạt  [ ] Không đạt  Mã đơn: ______  Độ trễ: ____ phút`

### 4.2 Huỷ đơn đã trả, chọn hoàn về Ví Tubu: T5

- **Ai**: Người thử. **Ở đâu**: Mini App, Đơn hàng, đơn T5 (còn trước bàn giao).
- **Làm**: bấm "Hủy đơn". Ở "Nhận lại <số tiền> về" chọn "Ví Tubu" (dòng ghi "Cộng ngay, dùng mua đơn tiếp theo hoặc rút về ngân hàng"). Xác nhận.
- **Đúng là**: đơn "Đã huỷ". Mini App, Ví Tubu: số dư tăng đúng bằng tổng đơn, có dòng lịch sử. Quản trị, Hoàn tiền khách: dòng loại "huỷ", nơi nhận Ví, trạng thái đã xong.
- **Bằng chứng**: Phụ lục P8 (ví) và P9 (hoàn tiền): `kind = CANCEL`, `method = WALLET`, `status = COMPLETED`; `paymentStatus = REFUNDED`. Tồn Tubu tăng lại; Pancake huỷ như 2.4.
- **Hoàn tác / lấy tiền ra**: dùng Ví Tubu trả đơn T10 (miễn phí). Muốn rút về ngân hàng: Mini App, Ví Tubu, "Rút ngân hàng"; tối thiểu 100.000đ và phí chuyển 3.000đ mỗi lần (khoá `wallet.withdraw_min`, `wallet.withdraw_fee`), nên số nhỏ nên để trả đơn. Muốn tiền về ngân hàng MIỄN PHÍ thì chọn "Tài khoản ngân hàng" lúc huỷ (bước 4.3).

> **Giả định cần xác nhận:** số tiền về Ví đúng bằng tổng đơn đã trả (gồm phí giao).

`[ ] Đạt  [ ] Không đạt  Mã đơn: ______  Số dư Ví sau: ______`

### 4.3 Huỷ đơn đã trả, chọn hoàn về ngân hàng: T6

- **Ai**: Người thử, rồi Quản trị. **Ở đâu**: Mini App; Quản trị, Hoàn tiền khách.
- **Làm**:
  1. Người thử đặt T6 chuyển khoản và trả đúng tiền như 4.1. Rồi "Hủy đơn" và chọn "Tài khoản ngân hàng". Nhập "Tên ngân hàng", "Số tài khoản" (chỉ số, 6 đến 24 số), "Chủ tài khoản". Xác nhận.
  2. Quản trị: Hoàn tiền khách, bộ lọc "Đang mở". Thấy dòng đơn T6, loại "huỷ", trạng thái chờ chuyển. Bấm "Bắt đầu chuyển khoản" (khoá nơi nhận: từ giờ khách không đổi sang Ví được nữa). Nút "Chép STK" để dán số tài khoản.
  3. Người gõ lệnh/Quản trị chuyển tiền thật từ tài khoản ngân hàng của Tubu tới tài khoản vừa nhập. Màn Quản trị CHỈ ghi sổ, không chuyển tiền thật.
  4. Quản trị bấm "Đã chuyển khoản", nhập mã giao dịch ngân hàng, xác nhận.
- **Đúng là**: khoản chuyển sang "đã xong", khách nhận thông báo có mã giao dịch; tiền về tài khoản Người thử trong 1 đến 3 ngày làm việc (tiếp tục kiểm vào ngày 2).
- **Bằng chứng**: Phụ lục P9: `kind = CANCEL`, `method = MANUAL_TRANSFER`, `status` đi PENDING, PROCESSING, COMPLETED, có `bankRef`; sao kê ngân hàng. Thông báo cho khách.
- **Hoàn tác**: trước khi chuyển tiền thật: bấm "Trả về hàng chờ" (khoản về PENDING, khách lại đổi được nơi nhận). Sau khi đã chuyển thật thì không hoàn tác được.
- Khoản đang do một admin giữ mà admin khác muốn tiếp quản: có hộp thoại bắt nhập lý do tiếp quản.

> **Giả định cần xác nhận:** thời gian ngân hàng báo có (1 đến 3 ngày làm việc) và phí chuyển (đang coi là miễn phí).

`[ ] Đạt  [ ] Không đạt  Mã đơn: ______  Tiền về ngày: ______`

### 4.4 Tiền về muộn sau khi đơn đã huỷ: T7

- **Ai**: Người thử, rồi Quản trị.
- **Làm**:
  1. Người thử đặt T7 chuyển khoản, KHÔNG chuyển tiền. Bấm "Hủy đơn". Hộp xác nhận có ghi chú vàng: "Nếu bạn vừa chuyển khoản, Tubu có thể cần vài phút để ghi nhận — hãy chờ thêm thay vì huỷ. Tiền về sau khi huỷ vẫn được hoàn…". Xác nhận huỷ.
  2. Người thử CHUYỂN KHOẢN đúng số tiền của T7 vào tài khoản Tubu với nội dung là mã đơn T7 (tức là tiền về MUỘN, sau khi đơn đã huỷ).
  3. Đợi vài phút. Nếu Pancake báo, Quản trị, Hoàn tiền khách sẽ tự có dòng loại "tiền về muộn". Nếu sau 15 phút không có: Quản trị, Đơn hàng, mở đơn T7: khối "Ghi nhận tiền về muộn" (hiện cho đơn đã huỷ khi chưa nhận tiền): nhập số tiền thực nhận và mã giao dịch, bấm "Ghi nhận tiền về muộn" rồi "Đã nhận tiền".
  4. Người thử mở đơn T7: chọn nhận về Ví Tubu hoặc ngân hàng (như 4.2 hoặc 4.3); Quản trị hoàn tất.
- **Đúng là**: đơn KHÔNG hồi sinh (vẫn "Đã huỷ"); có khoản hoàn loại "tiền về muộn" (`LATE_PAYMENT`), khách được báo, và đi hết đường hoàn như 4.2/4.3. Chỉ MỘT khoản hoàn cho một lần tiền về (nếu cả Pancake lẫn admin cùng ghi thì không thành hai khoản).
- **Bằng chứng**: Phụ lục P9: `kind = LATE_PAYMENT`; Phụ lục P1: `status = CANCELLED`.
- **Hoàn tác**: như 4.3 (trả về hàng chờ trước khi chuyển thật).

> **Giả định cần xác nhận:** Pancake có còn tự đối soát và bắn webhook cho một đơn đã bị huỷ (huỷ ở cả Pancake) hay không; nếu không thì tiền về muộn chỉ phát hiện bằng đối chiếu sao kê và ghi tay như bước 3. Ghi kết quả thật: ______

`[ ] Đạt  [ ] Không đạt  Mã đơn: ______`

### 4.5 (Tuỳ chọn) Chuyển THIẾU tiền: T8

- **Ai**: Người thử, Quản trị.
- **Làm**: đặt T8 chuyển khoản, chuyển chỉ khoảng một nửa số tiền (nội dung là mã đơn). Đợi vài phút. Sau khi quan sát (và dùng cho Phần 9), Người thử bấm "Hủy đơn".
- **Đúng là**: đơn vẫn "Chờ thanh toán"; Quản trị, Việc cần xử lý và đơn: "Khách chuyển thiếu: Pancake ghi nhận <đã nhận>/<tổng>, còn thiếu <số> — chưa xác nhận thanh toán…"; khách nhận thông báo `ORDER_UNDERPAID` (có số đã nhận, số còn thiếu, tổng đơn); báo động vận hành `pancake.attention` (Phần 9). Sau khi huỷ: tin huỷ đơn có thêm câu "Tubu đã nhận <số> chuyển khoản của đơn này — vào chi tiết đơn để chọn nhận lại về Ví Tubu (ngay) hoặc tài khoản ngân hàng.", và có đúng MỘT khoản hoàn loại "tiền về muộn" cho số đã nhận (Phụ lục P9); Người thử chọn Ví hay ngân hàng như 4.2 hoặc 4.3.
- **Hoàn tác**: huỷ đơn như trên; hoặc khách chuyển nốt phần thiếu.

> **Giả định cần xác nhận:** Pancake POS có ghi nhận chuyển khoản MỘT PHẦN và bắn webhook mang số đã nhận. Nếu không, bước này không tạo cảnh báo; ghi lại để biết và dùng cách khác cho bước 9.4.

`[ ] Đạt  [ ] Không đạt  [ ] Bỏ qua  Mã đơn: ______`

### 4.6 (Tuỳ chọn, nhà phát triển) ZaloPay trên môi trường thử

Chỉ làm nếu chủ shop quyết định bật ZaloPay trước khi mở bán, và CHỈ trên bản thử có khoá sandbox (endpoint `https://sb-openapi.zalopay.vn/v2`), KHÔNG làm với khoá thật trên production.

1. Nhà phát triển đặt đơn qua API với `paymentMethod: "ZALOPAY"` (DTO chấp nhận), rồi gọi `POST /api/payments/zalopay/create` với `orderCode`; mở `order_url`, thanh toán bằng ứng dụng ZaloPay sandbox.
2. ZaloPay gọi `POST /api/webhooks/zalopay`; Tubu kiểm chữ ký bằng Key2. Đơn thành "Đã thanh toán" và "Đã xác nhận" ([ZALOPAY-SETUP.md](../ZALOPAY-SETUP.md) mục 3). Gửi callback giả sai chữ ký phải trả `return_code = -1`.
3. Cron đối soát 5 phút hỏi ZaloPay cho lệnh mất callback (chỉ lệnh 3 phút đến 48 giờ tuổi).
4. Tiền về muộn qua ZaloPay (đơn đã huỷ rồi mới thanh toán) và trả hai lần được ghi thành khoản hoàn như 4.4; không có gọi hoàn tiền tới cổng, nên admin chuyển khoản tay hoặc hoàn Ví.
- **Bằng chứng**: bảng `payment_attempts` (cột `provider`, `appTransId`, `succeededAt`); Phụ lục P1.
- **Hoàn tác**: huỷ đơn như 4.2.

> **Giả định cần xác nhận:** toàn bộ luồng ZaloPay chưa từng chạy với cổng thật (chưa có khoá). Khoá thật cần pháp nhân và thời gian duyệt (vài ngày làm việc). Hợp đồng MAC, `return_code`, và thời hạn lệnh đều là điều chỉ cổng ZaloPay mới xác nhận.

`[ ] Đạt  [ ] Không đạt  [ ] Bỏ qua (ZaloPay chưa bật cho launch)`

---

## Phần 5. COD tới trần 5.000.000đ cho mỗi đơn con

Quy tắc: COD chỉ nhận mỗi ĐƠN CON tối đa 5.000.000đ (hằng số trong mã, không có khoá cấu hình để đổi). Giỏ có hàng của nhiều nơi giao (Tubu và gian hàng đối tác) bị TÁCH thành nhiều đơn con, và trần xét cho từng đơn con, không xét tổng giỏ. Hàng của gian hàng đối tác tự giao chỉ trả được COD hoặc Ví Tubu. Các bước 5.1 và 5.2 chỉ xem báo giá, KHÔNG đặt đơn.

### 5.1 Một đơn con vượt trần thì COD bị chặn

- **Ai**: Người thử. **Ở đâu**: Mini App (hoặc web), giỏ hàng, rồi màn thanh toán.
- **Làm**: bỏ vào giỏ hàng Tubu giao (nhiều sản phẩm hoặc số lượng lớn) để TỔNG ĐƠN vượt 5.000.000đ (tồn kho phải đủ). Vào thanh toán. Xem ô "Thanh toán khi nhận hàng (COD)".
- **Đúng là**: COD bị khoá, có lý do: "Thanh toán khi nhận hàng (COD) chỉ nhận đơn tối đa 5.000.000đ, đơn này là <số>. Vui lòng chuyển khoản hoặc trả bằng Ví Tubu." Chuyển khoản vẫn chọn được.
- **Bằng chứng**: ảnh màn thanh toán. Không có đơn mới trong tab Đơn hàng.
- **Hoàn tác**: xoá bớt hàng khỏi giỏ.

`[ ] Đạt  [ ] Không đạt`

### 5.2 Giỏ nhiều nơi giao: tính trần theo từng đơn con

- **Ai**: Người thử. **Làm**: giỏ gồm hàng Tubu giao (dưới 5.000.000đ) cộng hàng của gian hàng đối tác tự giao (cũng dưới 5.000.000đ), tổng hai phần trên 5.000.000đ. Vào thanh toán.
- **Đúng là**: COD CHỌN ĐƯỢC (mỗi đơn con còn trong trần). Chuyển khoản bị khoá với lý do "Đơn gồm hàng do nhiều nơi giao nên chỉ thanh toán được khi nhận hàng (COD) hoặc bằng Ví Tubu. Muốn chuyển khoản, hãy đặt riêng phần hàng Tubu Tree giao."
- Làm tiếp: nâng riêng phần đối tác lên trên 5.000.000đ: COD bị khoá, và lý do nêu tên gian hàng ("đơn do <gian hàng> giao là <số>") cùng cách xử lý (trả Ví, hoặc bớt số lượng).
- **Bằng chứng**: ảnh màn thanh toán.
- **Hoàn tác**: xoá giỏ.

> **Giả định cần xác nhận:** cần một gian hàng đối tác thử có sản phẩm đủ giá/số lượng; không cần đặt đơn.

`[ ] Đạt  [ ] Không đạt`

### 5.3 (Tuỳ chọn) Đơn COD sát trần: T12

- **Ai**: Người thử, Kho.
- **Làm**: báo Kho TRƯỚC: "đơn <mã> là đơn thử lớn, không nhặt hàng, tôi sẽ huỷ ngay". Đặt một đơn COD tổng khoảng 4.9xx.xxx đ. Mở đơn, ghi tổng; rồi huỷ ngay như 2.4.
- **Đúng là**: đặt được (dưới trần); trên Pancake có `[THU COD <số>]` khớp tổng; huỷ xong tồn trả lại đủ.
- **Bằng chứng**: Phụ lục P1; Pancake POS.
- **Hoàn tác**: huỷ ngay (bước 2.4).

> **Giả định cần xác nhận:** trần 5.000.000đ lấy từ ví dụ lỗi của Gomdon (`collect_amount` 0 đến 5.000.000, [gomdon.md](../integrations/gomdon.md) mục 2.3). Hãng giao khác mà kho đặt qua Pancake có thể có trần COD khác; hỏi Kho.

`[ ] Đạt  [ ] Không đạt  [ ] Bỏ qua  Mã đơn: ______`

---

## Phần 6. Đơn đối tác (tự giao và ký gửi) và 7 ngày giữ tiền đối soát

Quy tắc: đơn của gian hàng đối tác TỰ GIAO không bao giờ lên Pancake (kho Tubu không giao). Đối tác xác nhận, đóng gói, nhập hãng và mã vận đơn, bấm "Khách đã nhận hàng". Hàng "Tubu giao hộ" (ký gửi) do kho Tubu giao qua Pancake, tiền khách luôn về Tubu. Tiền của đối tác chỉ vào bảng kê sau **7 ngày** kể từ ngày giao (khoá `merchant.settlement_hold_days`, đồng bộ với hạn đổi trả). Phí sàn mặc định 15% (`merchant.commission_pct`); phí giao mặc định 30.000đ (`merchant.default_shipping_fee`). Thiết kế: [2026-10-14-merchant-fulfilment-design.md](../2026-10-14-merchant-fulfilment-design.md).

### 6.1 Chuẩn bị đối tác thử

- **Ai**: Đối tác thử, Quản trị.
- **Làm**: tài khoản đối tác thử (vai trò đại lý hoặc cộng tác viên) vào Cổng người bán. Điền "Gian hàng & Subdomain" và bấm xuất bản; khai "Giao hàng & liên hệ" (kho gửi) và "Tài khoản nhận đối soát". Thêm một sản phẩm TỰ GIAO giá nhỏ, tồn từ 2. Quản trị duyệt ở "Duyệt SP đối tác" ("Duyệt xuất bản").
- **Đúng là**: sản phẩm của đối tác hiện trên Mini App với tên gian hàng.
- **Hoàn tác**: đối tác "tạm nghỉ" gian hàng, hoặc xoá sản phẩm.

> **Giả định cần xác nhận:** chưa kiểm tài khoản chủ gian hàng đặt hàng chính gian hàng của mình (mã hiện tại không chặn); dùng hai tài khoản Zalo KHÁC nhau để tránh lẫn.

`[ ] Đạt  [ ] Không đạt`

### 6.2 Đặt hàng đối tác tự giao bằng Ví Tubu: T10

- **Ai**: Người thử. **Ở đâu**: Mini App.
- **Làm**: Ví Tubu của Người thử cần đủ tiền (lấy từ bước 4.2). Đặt sản phẩm tự giao của đối tác, ở thanh toán chọn "Ví Tubu". (Thử cả chọn "Chuyển khoản": phải bị khoá với "Hàng do gian hàng đối tác tự giao chỉ thanh toán được khi nhận hàng (COD) hoặc bằng Ví Tubu.")
- **Đúng là**: đơn "Đã xác nhận" và đã thanh toán, ví trừ đúng tổng. Trên Quản trị, mở đơn: nơi giao là gian hàng đối tác. **Pancake POS KHÔNG có đơn này** (đơn tự giao không lên Pancake). Đối tác nhận thông báo có đơn mới.
- **Bằng chứng**: Phụ lục P1: `fulfiller = MERCHANT`, `pancakeOrderId` rỗng; Pancake POS không có mã đơn.
- **Hoàn tác**: Người thử huỷ trước khi đối tác gửi hàng ("Hủy đơn"): hoàn về Ví Tubu. Sau khi đối tác báo "đã gửi hàng" thì không huỷ được (D1, dấu hiệu `shippedAt`).

`[ ] Đạt  [ ] Không đạt  Mã đơn: ______`

### 6.3 Đối tác xử lý và giao

- **Ai**: Đối tác thử. **Ở đâu**: Cổng người bán, tab "Đơn cần giao".
- **Làm**: đơn ở "Chờ xử lý": bấm "Xác nhận đơn", rồi "Đã đóng gói", rồi "Nhập mã vận đơn" (điền "Đơn vị vận chuyển" và "Mã vận đơn", ví dụ GHN) và "Xác nhận đã gửi hàng". Khi hàng tới Người thử: bấm "Khách đã nhận hàng".
- **Đúng là**: đơn lần lượt "Đã xác nhận", "Đang đóng gói", "Đang giao", "Đã giao". Người thử thấy hãng và mã vận đơn của đối tác. Người thử nhận Điểm Xanh khi "Đã giao".
- **Bằng chứng**: Phụ lục P2; Quản trị, Đơn đối tác & đối soát: số "Đang xử lý" đổi theo.
- **Hoàn tác**: "Huỷ đơn" hoặc "Giao không thành công" ở Cổng người bán khi hàng chưa giao xong (có hộp nhập lý do).

> **Giả định cần xác nhận:** SLA nhắc việc (xác nhận trong 24 giờ, giao hãng trong 48 giờ, đang giao quá 7 ngày) chỉ cần quan sát nếu đối tác chậm.

`[ ] Đạt  [ ] Không đạt  Mã đơn: ______`

### 6.4 Giữ tiền 7 ngày

- **Ai**: Quản trị và Đối tác thử. Ngay sau khi T10 "Đã giao".
- **Làm**: Quản trị, Đơn đối tác & đối soát: nhìn dòng gian hàng. Cổng người bán, tab "Đối soát": nhìn khoản của đơn T10.
- **Đúng là**: chưa lập phiếu được cho đơn T10 (chưa hết 7 ngày): ở dòng gian hàng, cột "Chờ đối soát" hiện "—" và hai nút "Lập phiếu đối soát", "Xem khoản" mờ, không bấm được (nếu gian hàng chưa có khoản nào khác đủ hạn). Ở Cổng người bán, tab "Đối soát", đơn T10 nằm ở mục "Sắp đủ hạn", cột "Đối soát từ" bằng ngày giao cộng 7. Công thức một dòng đối soát đơn tự giao: **tiền hàng khách thực trả + phí giao − phí sàn − tiền COD đối tác đã tự thu** (phí sàn tính trên tiền hàng, theo mức chốt lúc khách đặt). Ví dụ: hàng 50.000đ, phí giao 30.000đ, phí sàn 15% = 7.500đ. Đơn trả bằng Ví: Tubu trả đối tác 50.000 + 30.000 − 7.500 = 72.500đ. Đơn COD: đối tác đã thu 80.000đ tiền mặt nên dòng là 80.000 − 7.500 − 80.000 = −7.500đ (đối tác nộp lại phí sàn cho Tubu).
- **Bằng chứng**: Quản trị (màn trên). Chưa có dòng trong Phụ lục P10 (chỉ có sau khi lập phiếu).
- **Hoàn tác**: không có.
- **Cách thử nhanh, chỉ khi Chủ shop đồng ý bằng lời**: đặt `merchant.settlement_hold_days` về 0 trong Quản trị, Cấu hình, làm 6.5, rồi **ĐẶT LẠI VỀ 7**. Quên đặt lại thì đối tác thật được đối soát ngay không chờ đổi trả; `go-live:check` sẽ báo WARN `db.settlement_hold`.

`[ ] Đạt  [ ] Không đạt  Mã đơn: ______`

### 6.5 Lập phiếu và chi (ngày +7)

- **Ai**: Quản trị. **Ở đâu**: Quản trị, Đơn đối tác & đối soát.
- **Làm**: khi "Lập phiếu đối soát" bật: bấm "Xem khoản" để kiểm số; bấm "Lập phiếu đối soát". Phiếu hiện ở "Phiếu đối soát", trạng thái chờ xử lý. Nhập mã giao dịch ngân hàng, chuyển tiền thật tới tài khoản nhận của đối tác (hoặc, với phiếu ÂM, ghi nhận đối tác nộp lại Tubu), bấm "Đã chuyển" (hoặc "Đã thu").
- **Đúng là**: tổng phiếu khớp công thức ở 6.4. Phiếu "Đã chuyển"/"Đã thu"; đối tác thấy trong Cổng người bán, tab Đối soát.
- **Bằng chứng**: Phụ lục P10: các dòng `merchant_payout_lines` của đơn, đủ `goodsAmount`, `shippingFee`, `commissionAmount`, `netAmount`.
- **Hoàn tác**: "Huỷ phiếu" (bắt buộc nhập lý do, đối tác đọc được): các khoản quay lại bảng kê để lập phiếu mới. Sau khi đã chuyển tiền thật thì không huỷ.
- Phiếu âm: đối tác phải nộp trong 7 ngày (`due` hiện ở phiếu); quá hạn có nhãn "Quá hạn nộp".

> **Giả định cần xác nhận:** chỉ làm đúng khi hết hạn giữ 7 ngày (hoặc đã chỉnh `merchant.settlement_hold_days`); hạn đổi trả (`returns.window_days`) mặc định cũng 7 ngày.

`[ ] Đạt  [ ] Không đạt  Ngày làm: ______`

### 6.6 Đơn "Tubu giao hộ" (ký gửi): T11

- **Ai**: Người thử, Kho, Quản trị. Điều kiện: đã làm 2.10 (đã "Xác nhận ký gửi").
- **Làm**: Người thử đặt sản phẩm của đối tác gắn mã Pancake (từ SP-THỬ), thanh toán COD. Kho xử lý như đơn Tubu bình thường (2.5, 2.7).
- **Đúng là**: đơn **lên Pancake** (khác T10) và Kho giao; tiền khách luôn về Tubu; đơn được tính cho gian hàng đối tác (đối tác thấy trong "Đơn qua gian hàng").
- **Bằng chứng**: Phụ lục P1: `pancakeOrderId` có giá trị. Pancake POS có đơn.
- **Hoàn tác**: huỷ trước bàn giao (2.4).

> **Giả định cần xác nhận:** đơn đặt TRƯỚC mốc `merchant.consignment_settle_from` hoặc trước lúc bấm "Xác nhận ký gửi" KHÔNG vào đối soát tự động (cố ý). Đảm bảo đặt SAU cả hai.

`[ ] Đạt  [ ] Không đạt  Mã đơn: ______`

### 6.7 Đối soát hàng ký gửi

- Sau khi T11 "Đã giao" và hết 7 ngày: Quản trị, Đơn đối tác & đối soát: dòng của gian hàng có "trong đó N khoản Tubu giao hộ". Công thức một dòng ký gửi: **tiền khách thực trả cho món − phí sàn − phí Tubu giao hộ** (phí giao hộ gồm phần trăm trên tiền món, cộng một khoản cố định mỗi đơn, nếu Quản trị có đặt). Phí giao KHÔNG vào tiền đối tác (Tubu giữ). Chỉ đơn Tubu đã thu được tiền (đã trả trước hoặc COD) mới vào. Lập phiếu như 6.5.
- **Bằng chứng**: Phụ lục P10 (`kind` là SALE, `orderItemId` có giá trị cho dòng ký gửi, `shippingFee` bằng 0; trả hàng sau đối soát sinh dòng REVERSAL âm).
- **Hoàn tác**: như 6.5; trả hàng sau khi đã đối soát sinh dòng đảo (âm) ở phiếu kế.

`[ ] Đạt  [ ] Không đạt  Ngày làm: ______`

---

## Phần 7. Đổi rác lấy quà (chạy nội bộ)

Quy tắc: khách khai món rác trong Mini App (Đổi rác), chọn cách đưa rác tới Tubu; Điểm Xanh chỉ được cộng khi kho hoặc điểm nhận đếm thực nhận và xác nhận. Dữ liệu nằm ở các bảng `waste_points`, `waste_requests`, `waste_events`. Các số mặc định là đề xuất cho giai đoạn thử. Đường Thu kèm đơn chỉ thử theo thứ tự ở [recycle-rewards-launch-checklist.md](recycle-rewards-launch-checklist.md) mục 4 (bật để thử trên bản chưa mở cho khách, tắt lại nếu Gomdon chưa trả lời bằng văn bản) và chỉ để bật lâu dài khi đủ các dòng còn lại của mục 4. Chạy nội bộ: chỉ Tubu staff, build chưa mở cho khách thật (checklist mục 5). Cần "Bật chương trình với khách" (`waste.enabled`) đang bật và kho HCMC đã đăng ký (checklist mục 2): bật như ở bước 3.1; riêng "Cách Thu kèm đơn" chỉ bật để chạy T3 ở 3.1 và 3.2 (T3 chính là nguồn của 7.3).

### 7.1 Mang tới kho (xác nhận tại quầy)

- **Ai**: Người thử và nhân viên kho. **Ở đâu**: Mini App, Đổi rác; Quản trị, Khách hàng, Đổi rác.
- **Làm**: Người thử tạo yêu cầu "Mang tới điểm nhận" cho kho HCMC với 3 túi lớn Nilon chống sốc (không dùng carton vì T3 đã dùng hết trần ngày của carton). Nhân viên kho mở yêu cầu theo mã, đếm thực nhận và xác nhận tại quầy.
- **Đúng là**: yêu cầu chuyển sang hoàn tất (COMPLETED) ngay sau khi nhân viên xác nhận; Điểm Xanh được cộng đúng theo số thực nhận (không theo số khai); khách thấy số điểm trong lịch sử.
- **Bằng chứng**: Phụ lục P12 (`status`, `pointsAwarded`, sự kiện trong `waste_events`).
- **Hoàn tác**: thu hồi điểm (7.5).

`[ ] Đạt  [ ] Không đạt`

### 7.2 Gửi về kho (mã TR- và vận đơn)

- **Ai**: Người thử và nhân viên kho. **Ở đâu**: Mini App, Đổi rác, cách "Gửi về kho Tubu HCM".
- **Trước khi làm**: kho HCMC phải có số điện thoại thật ở ô "Số điện thoại" (Quản trị, Khách hàng, Đổi rác, Điểm nhận). Đó là số người nhận trên nhãn kiện. Để trống thì màn yêu cầu chỉ hiện tên và địa chỉ kho, và nút "Sao chép" không chép số nào.
- **Làm**: tạo yêu cầu "Gửi về kho Tubu HCM" với 20 thùng carton (ước tính 20.000 điểm; mức tối thiểu của Gửi về kho là 15.000), ghi mã TR- hiện trên màn, dán mã đó lên kiện, gửi bằng hãng thường, nhập mã vận đơn vào yêu cầu. Kho nhận kiện theo mã TR- (không theo mã vận đơn của hãng), đếm và xác nhận.
- **Đúng là**: khối người nhận trên màn có tên, số điện thoại và địa chỉ kho; yêu cầu có mã TR- và mã vận đơn; sau khi kho xác nhận, Điểm Xanh được cộng theo số thực nhận.
- **Bằng chứng**: Phụ lục P12.
- **Hoàn tác**: kho từ chối kèm lý do (khách thấy lý do, không cộng điểm).

`[ ] Đạt  [ ] Không đạt`

### 7.3 Thu kèm đơn (theo checklist mục 4)

- **Làm**: bước này là chính đơn T3 và yêu cầu Thu kèm đơn của nó (làm theo Phần 3, bước 3.1 và 3.2 từ ngày 1; không tạo thêm đơn hay yêu cầu mới; cần `waste.enabled` và `waste.lane_pickup_enabled` cùng bật; các cờ này là cờ toàn cục, nên chỉ bật để thử trên bản chưa mở cho khách thật, và tắt lại nếu Gomdon chưa trả lời bằng văn bản). Khi kho nhận kiện thu kèm, đếm và xác nhận.
- **Đúng là**: ghi chú vận đơn là `Thu kèm rác TR-…: Thùng carton cũ: 10 thùng`; điểm chỉ được cộng khi kho đếm.
- **Hoàn tác**: huỷ đơn mua trước khi bưu tá lấy hàng (bước 3.5); yêu cầu thu kèm tự đóng theo đơn. Yêu cầu đã gắn đơn thì khách không huỷ riêng được.

`[ ] Đạt  [ ] Không đạt`

### 7.4 Quà (voucher và cây qua Vườn Xanh)

- **Ai**: Người thử. **Ở đâu**: Mini App, Quà (`/rewards`), Quà của tôi (`/rewards/mine`).
- **Trước khi làm**: kiểm số Điểm Xanh của Người thử (bảng B.5, Mini App, Điểm Xanh). Điểm chỉ có sau khi kho đếm và xác nhận: 7.1 cộng 3.000 ngay trong ngày; 7.2 cộng 20.000 khi kiện về tới kho (vài ngày sau); 7.3 cộng thêm 10.000 khi kiện thu kèm về kho. Voucher rẻ nhất trong danh mục gieo sẵn là "Miễn phí vận chuyển", giá 20.000 điểm: đủ sau khi kho đã đếm 7.1 và 7.2 (23.000 điểm), nên làm 7.4 sau khi kiện của 7.2 đã về kho; chưa đủ điểm thì để 7.4 sang lúc đó, đừng bỏ qua. Quà TREE có giá `game.tree_points_price` (mặc định 50.000 điểm, sửa ở Quản trị, Cấu hình; ở Quản trị, Khách hàng, Đổi rác, Quà chỉ xem được), nên tối đa 33.000 điểm của 7.1 đến 7.3 chưa đủ: chỉ đổi TREE khi số dư đủ giá, nếu không thì ghi "không thử TREE: thiếu điểm" ở bảng kết quả. Giá của các quà khác do admin đặt ở Quản trị, Khách hàng, Đổi rác, Quà: xem lại trước khi làm.
- **Làm**: đổi một voucher bằng Điểm Xanh và dùng ở thanh toán. Voucher "Miễn phí vận chuyển" chỉ dùng cho giỏ từ 99.000đ (giỏ dưới mức đó bị từ chối), còn đơn từ 200.000đ vốn đã miễn phí giao: tăng số lượng SP-MIN cho đơn này để giỏ nằm từ 99.000đ đến dưới 200.000đ thì mới thấy mã có tác dụng. Ghi mã đơn vào dòng T13 của B.7. Khi T13 còn mở, thử dùng lại đúng mã voucher đó ở màn thanh toán của một giỏ khác từ 99.000đ (không cần đặt đơn): phải bị từ chối với câu "Bạn đã dùng hết lượt cho mã này." Sau đó mới đưa T13 tới trạng thái cuối (Đã giao hoặc Đã huỷ). Đổi quà TREE: cây được trồng trong Vườn Xanh.
- **Đúng là**: điểm bị trừ đúng giá quà; voucher dùng được một lần (kiểm khi T13 còn mở); quà TREE xuất hiện ở Vườn Xanh.
- **Bằng chứng**: Phụ lục P7 (`points_transactions` của người thử: dòng điểm trừ cho từng quà).
- **Hoàn tác**: không hoàn tác được voucher và quà TREE: voucher thành coupon ngay, quà TREE đi qua Vườn Xanh, nên không bao giờ ở trạng thái chờ nhận. Điểm đã trừ là chi phí thử, ghi vào cột "Sau" của bảng B.5. Huỷ T13 thì hệ thống trả lượt dùng, mã quay lại tài khoản Người thử và dùng lại được: tắt mã đó ở Quản trị, Khuyến mãi, Voucher, nút "Tắt mã". Muốn thử huỷ có hoàn điểm thì đổi thêm một quà loại "Gói hạt giống" hoặc "Quà tặng" (hiện ở trạng thái "Chờ nhận"), rồi huỷ ở Quản trị, Khách hàng, Đổi rác, Quà với `refundPoints` (checklist mục 7).

`[ ] Đạt  [ ] Không đạt`

### 7.5 Thu hồi điểm

- **Ai**: Quản trị. **Ở đâu**: Quản trị, Khách hàng, Đổi rác, Yêu cầu.
- **Trước khi làm**: làm bước này sau cùng của Phần 7, khi kho đã đếm và xác nhận cả 7.2 và 7.3 (nếu có làm 7.3). Thứ tự xử lý gian lận ở checklist mục 7 có bước "Khoá đổi rác"; khi Người thử đã bị khoá thì không ai xác nhận được yêu cầu của họ (máy chủ báo "Khách đang bị khoá, không cộng điểm được", hoặc "Yêu cầu này đang chờ Tubu xử lý, chưa xác nhận được tại điểm" khi người xác nhận là nhân viên điểm nhận), nên khoá trước khi 7.2 hoặc 7.3 được đếm là làm hỏng hai bước đó.
- **Làm**: mở yêu cầu đã cộng điểm ở 7.1, bấm thu hồi và nhập lý do. Làm đúng thứ tự xử lý gian lận ở checklist mục 7.
- **Đúng là**: yêu cầu đóng với lý do thu hồi; số điểm đã cộng bị trừ lại (chỉ thu tối đa số Điểm Xanh thường khách còn; phần không thu được ghi ở reversalShortfallPoints; số dư không bao giờ âm).
- **Hoàn tác**: điểm đã thu hồi không trả lại được. Phải mở khoá cho Người thử khi xong: Quản trị, Khách hàng, Người dùng, mở khách, mục "Đổi rác", bấm "Mở khoá đổi rác" và nhập lý do.

`[ ] Đạt  [ ] Không đạt`

---

## Phần 8. Đánh giá theo từng lần mua và quy tắc điểm

Quy tắc: mỗi LẦN MUA một đánh giá (khoá duy nhất theo khách, sản phẩm, đơn). Chỉ đơn **đã giao**, mua lẻ (không phải đơn đại lý) và không phải đơn CTV lên hộ mới tính. **Điểm thưởng chỉ cho đánh giá đầu tiên của cặp (khách, sản phẩm)**: 5 điểm nếu chỉ chữ, 10 nếu có ảnh, 15 nếu có video. Điểm có hạn dùng 12 tháng.

Cần: Người thử có HAI đơn đã giao của CÙNG MỘT sản phẩm (T2 và T3 đều SP-MIN).

### 8.1 Điều kiện hiển thị

- **Ai**: Người thử. **Ở đâu**: Mini App, chi tiết sản phẩm SP-MIN, và chi tiết đơn T2.
- **Đúng là**: chi tiết đơn T2 (đã giao) có nút "Viết đánh giá" ở dòng sản phẩm. Chi tiết sản phẩm: khối Đánh giá có nút "Viết đánh giá". Các đơn T1 (huỷ), T10 chưa giao: KHÔNG có nút.
- **Bằng chứng**: ảnh màn.

`[ ] Đạt  [ ] Không đạt`

### 8.2 Đánh giá đầu tiên có thưởng

- **Làm**: bấm "Viết đánh giá" ở đơn T2, chọn số sao, viết chữ và thêm một ảnh, bấm "Gửi đánh giá".
- **Đúng là**: đánh giá hiện; Điểm Xanh của Người thử tăng 10 (có ảnh) và thông báo sau khi gửi khớp.
- **Bằng chứng**: Phụ lục P13: `pointsEarned = 10`, `orderId` của T2; Phụ lục P7: dòng `reason = REVIEW:<slug>`; Quản trị, Đánh giá có đánh giá đó.
- **Hoàn tác**: khách không có nút xoá đánh giá ở giao diện nào. Quản trị chỉ ẩn được (8.5: không thu hồi điểm). Xoá thật chỉ qua API, do nhà phát triển (8.6).

`[ ] Đạt  [ ] Không đạt  Điểm sau: ______`

### 8.3 Đánh giá lần hai (đơn khác, cùng sản phẩm): không thưởng

- **Làm**: viết đánh giá cho đơn T3 (cùng SP-MIN).
- **Đúng là**: gửi được (đây là điều mới: nhiều đánh giá cho một sản phẩm). Điểm KHÔNG tăng thêm (`pointsEarned = 0`). Trang sản phẩm hiện cả hai đánh giá của cùng khách.
- **Bằng chứng**: Phụ lục P13: hai dòng, một dòng `pointsEarned = 10`, một dòng `0`.
- **Hoàn tác**: ẩn bằng 8.5 nếu không muốn giữ đánh giá thử trên trang sản phẩm.

`[ ] Đạt  [ ] Không đạt`

### 8.4 Sửa và gửi lại đánh giá cùng một đơn

- **Làm**: bấm "Sửa đánh giá" ở đơn T2, đổi nội dung, bấm "Lưu đánh giá". Rồi thử gửi lại đánh giá mới cho CÙNG đơn T2 từ khối đánh giá của sản phẩm.
- **Đúng là**: cả hai trường hợp chỉ SỬA đánh giá cũ (không tạo đánh giá thứ hai cho cùng đơn) và KHÔNG cộng thêm điểm.
- **Bằng chứng**: Phụ lục P13: vẫn một dòng cho T2; Phụ lục P7 không có dòng điểm mới.

`[ ] Đạt  [ ] Không đạt`

### 8.5 Quản trị ẩn và hiện lại một đánh giá

- **Ai**: Quản trị. **Ở đâu**: Quản trị, Đánh giá.
- **Làm**: ở đánh giá của T3 bấm "Ẩn đánh giá", xác nhận "Ẩn đánh giá". Mở trang sản phẩm. Rồi quay lại bấm "Hiện lại".
- **Đúng là**: sau khi ẩn, đánh giá biến khỏi trang sản phẩm và không còn tính vào điểm sao. Điểm Xanh của Người thử KHÔNG đổi (ẩn không thu hồi điểm). Bấm "Hiện lại" thì hiện công khai trở lại.
- **Bằng chứng**: Phụ lục P13: cột `isVisible` đổi false rồi true; Phụ lục P7 không có dòng mới.
- **Hoàn tác**: bấm "Hiện lại".

`[ ] Đạt  [ ] Không đạt`

### 8.6 (Nhà phát triển, tuỳ chọn) Xoá đánh giá qua API rồi viết lại

Không có nút xoá đánh giá ở Mini App, web hay Quản trị: chỉ có API `DELETE /api/reviews/<id>` (chủ đánh giá hoặc ADMIN). Chủ shop có thể BỎ QUA bước này; quy tắc dưới đây đã có test tự động.

- **Làm**: nhà phát triển xoá đánh giá của T2 bằng API với đăng nhập của Người thử hoặc của ADMIN. Rồi Người thử viết lại đánh giá cho T2 ("Viết đánh giá" hiện lại ở đơn).
- **Đúng là**: điểm thưởng đã cấp bị thu hồi (không bao giờ làm số dư âm: nếu đã tiêu một phần thì chỉ thu hồi phần còn lại). Viết lại chỉ được thưởng lại khi lần xoá đã thu hồi ĐỦ điểm đã thưởng (tạo, xoá, tạo lại ra đúng một lần thưởng, không phải hai); nếu điểm đã tiêu hoặc đã hết hạn thì viết lại không được thưởng.
- **Bằng chứng**: Phụ lục P7: dòng `REVIEW_DELETE:<id sản phẩm>` âm; Phụ lục P13.
- **Hoàn tác**: không có cho điểm đã thu hồi.

> **Giả định cần xác nhận:** quy tắc "xoá rồi viết lại chỉ thưởng khi đã thu hồi đủ" là quyết định đã duyệt; chủ shop xác nhận đúng ý.

`[ ] Đạt  [ ] Không đạt  [ ] Bỏ qua`

---

## Phần 9. Cảnh báo vận hành: email và webhook

Cron 5 phút của API so tình trạng Pancake, Gomdon và hàng đợi với ngưỡng trong Cấu hình (`ops.alert_unsynced_minutes` 30, `ops.alert_stuck_orders` 1, `ops.alert_webhook_failed` 1, `ops.alert_queue_failed_1h` 5, `ops.alert_repeat_hours` 6, `ops.alert_gomdon_backlog_minutes` 15). Có sự cố mới thì báo MỘT lần (nhắc lại sau 6 giờ nếu chưa hết), hết thì báo "Vận hành đã ổn trở lại". Kênh: thông báo trong app cho admin (luôn có), webhook `OPS_ALERT_WEBHOOK_URL` (Slack, Google Chat, n8n...) và email SMTP. Chi tiết: [GO-LIVE-KEYS.md](../GO-LIVE-KEYS.md) mục 8.

### 9.1 Kênh email đã bật

- **Ai**: Quản trị. **Ở đâu**: Quản trị, Sức khoẻ hệ thống, thẻ "Báo động qua email".
- **Đúng là**: "Trạng thái: Đang bật", "Người nhận: N địa chỉ". Nếu "Cấu hình chưa đủ" hoặc "Chưa bật": sửa `.env` theo [GO-LIVE-KEYS.md](../GO-LIVE-KEYS.md), chưa làm tiếp.
- **Bằng chứng**: chụp thẻ.

`[ ] Đạt  [ ] Không đạt`

### 9.2 Gửi email thử

- **Ai**: Quản trị (chỉ ADMIN). **Làm**: bấm "Gửi email thử", xác nhận.
- **Đúng là**: thẻ báo "Đã gửi email thử tới N địa chỉ nhận". Trong vài phút mỗi hộp thư nhận email tiêu đề `[Tubu Tree · <môi trường>] Email thử báo động vận hành` (xem cả thư rác). Dòng "Lần gửi gần nhất" chuyển "OK … trước". Bấm quá 5 lần trong một phút bị chặn (thông báo "Đã bấm gửi thử quá nhiều lần").
- **Lỗi**: "Lỗi xác thực SMTP — kiểm tra SMTP_USER/SMTP_PASS" hoặc "máy chủ từ chối": sửa `.env` rồi tạo lại container API. Đừng bấm liên tục (sai mật khẩu nhiều lần có thể khoá tài khoản gửi).
- **Hoàn tác**: không (email thử không đụng trí nhớ chống báo lặp).

> **Giả định cần xác nhận:** máy chủ SMTP thật (Gmail/Workspace hay nhà cung cấp khác) có chấp nhận gửi từ địa chỉ `SMTP_FROM`; email không vào thư rác.

`[ ] Đạt  [ ] Không đạt`

### 9.3 Kiểm tra kênh webhook từ máy chủ

Nút trong app chỉ thử email; webhook chưa có nút thử. Kiểm kênh nhận bằng một tin thử tay (KHÔNG in địa chỉ webhook ra màn hình):

- **Ai**: Người gõ lệnh, trên VPS trong `/opt/tubutree`.
- **Làm**:

```bash
WEBHOOK_URL=$(grep -E '^OPS_ALERT_WEBHOOK_URL=' .env | cut -d= -f2-)
[ -n "$WEBHOOK_URL" ] && curl -sS -o /dev/null -w 'HTTP %{http_code}\n' -X POST -H 'Content-Type: application/json' -d '{"text":"[Tubu Tree] Tin thử kênh báo động, bỏ qua."}' "$WEBHOOK_URL"
```

- **Đúng là**: in `HTTP 200`; tin xuất hiện trong kênh Slack/Google Chat. Dòng lệnh trống không in gì nghĩa là `OPS_ALERT_WEBHOOK_URL` chưa đặt (sửa `.env`).
- **Hoàn tác**: không cần (xoá tin thử trong kênh nếu muốn).

> **Giả định cần xác nhận:** tin thử này chỉ chứng minh kênh NHẬN được; định dạng tin thật của Tubu (Slack/Google Chat chỉ `{"text": "..."}`; URL khác mang JSON đầy đủ) kiểm ở bước 9.4.

`[ ] Đạt  [ ] Không đạt`

### 9.4 Báo động thật và "ổn trở lại"

- **Cần một sự cố thật nhưng vô hại.** Dùng bất kỳ cảnh báo "Cần xử lý Pancake" nào phát sinh tự nhiên ở các bước trước. Gợi ý chắc chắn nhất: T8 (4.5, khách chuyển thiếu); hoặc bước 2.4 nếu Pancake chậm huỷ. Không có sự cố tự nhiên: ghi "chưa thử được", để các tuần đầu mở bán theo dõi kỹ.
- **Làm**: ngay khi cảnh báo xuất hiện trong Việc cần xử lý, bắt đầu bấm giờ.
- **Đúng là**: trong tối đa khoảng 5 đến 10 phút (cron 5 phút): có thông báo trong app cho admin, tin ở kênh webhook, và email, nội dung nêu số lượng và mã đơn cũ nhất ("N đơn cần xử lý tay trên Pancake…"). Trong 30 phút KHÔNG có tin thứ hai cho cùng sự cố. Sau khi xử lý xong (huỷ đơn T8, hoặc kho huỷ tay) thì trong 5 đến 10 phút có tin "Vận hành đã ổn trở lại". Email không chứa tên, SĐT hay địa chỉ khách; không chứa khoá hay mật khẩu.
- **Bằng chứng**: ba tin (app, webhook, email) kèm giờ nhận; ảnh.
- **Hoàn tác**: xử lý nguyên nhân (đó chính là việc của bước).

> **Giả định cần xác nhận:** kênh webhook nhận định dạng Tubu gửi; email không lọt thư rác; thời gian thật từ sự cố tới tin (ghi: ______ phút).

`[ ] Đạt  [ ] Không đạt  [ ] Chưa thử được`

---

## 10. Dọn dẹp sau khi thử

Không bỏ sót: để lại cấu hình thử là rủi ro thật.

- [ ] Mọi đơn T1 đến T13 ở trạng thái cuối (Đã giao, Đã huỷ). Không còn đơn "Chờ thanh toán" nào của Người thử.
- [ ] Quản trị, Hoàn tiền khách, bộ lọc "Đang mở": không còn khoản nào của các đơn thử.
- [ ] Quản trị, Việc cần xử lý: không còn dòng nào của đơn thử.
- [ ] Trước khi mở bán cho khách thật, "Bật chương trình với khách" (`waste.enabled`) và "Cách Thu kèm đơn" (`waste.lane_pickup_enabled`) ở Quản trị, Khách hàng, Đổi rác, Cấu hình chung đã tắt lại (mặc định của cả hai là tắt; cả hai là cờ toàn cục). Chỉ để `waste.enabled` bật khi các mục phần 3 của checklist đã xong (trừ Gomdon) hoặc chủ dự án đã chấp nhận rủi ro bằng văn bản (checklist mục 5), và chỉ để `waste.lane_pickup_enabled` bật khi đủ mọi dòng của checklist mục 4 (văn bản của Gomdon, đơn thử T3 đạt, bảng phí gửi về kho đã chỉnh, chủ dự án đồng ý).
- [ ] Cấu hình: `merchant.settlement_hold_days` về **7** (nếu đã đổi ở 6.4); `shipping.gomdon.recycling_enabled` đúng ý định mở bán; mẫu ZNS giữ nguyên.
- [ ] Pancake POS: các đơn huỷ đã huỷ hẳn; hàng thử đã giao thật; tồn Pancake và tồn Tubu khớp (chạy "Đồng bộ danh mục Pancake" nếu lệch, KHÔNG dùng "Đồng bộ + ghi đè tồn kho" trừ khi Tech lead đồng ý).
- [ ] SP-THỬ: "Gỡ liên kết" nếu muốn trả biến thể; sản phẩm đối tác thử tạm nghỉ hoặc xoá; xoá SP-THỬ trên Pancake POS và đồng bộ lại.
- [ ] Gian hàng đối tác thử: tạm nghỉ hoặc huỷ xuất bản nếu không phải đối tác thật.
- [ ] Đánh giá thử: giữ hoặc ẩn ở Quản trị, Đánh giá.
- [ ] Mã đơn thử đã ghi đủ ở B.7 để loại khỏi báo cáo doanh số/chuyển đổi (hệ thống không có cờ "đơn thử").
- [ ] Nếu T13 đã huỷ: mã voucher "Miễn phí vận chuyển" của Người thử đã tắt (Quản trị, Khuyến mãi, Voucher, nút "Tắt mã"), vì huỷ đơn trả lại lượt dùng của mã.
- [ ] Người thử không còn bị khoá Đổi rác (bước 7.5 đã khoá): Quản trị, Khách hàng, Người dùng, mở khách, mục "Đổi rác" hiện nút "Khoá đổi rác" và không hiện "Mở khoá đổi rác".
- [ ] Số dư Ví Tubu, Điểm Xanh, ngân hàng đối chiếu với bảng B.5 (cột "Sau"). Chênh lệch phải giải thích được bằng chính các đơn thử, điểm Đổi rác đã cộng ở 7.1 đến 7.3 và đã thu hồi ở 7.5, điểm thưởng đánh giá ở 8.2, và các quà đã đổi ở 7.4 (voucher và quà TREE không hoàn lại điểm).

## 11. Bảng kết quả (chủ shop điền)

Ngày làm: ______  Người làm: ______  Phiên bản (SHA): ______

| Bước | Nội dung | Đạt | Không đạt | Mã đơn | Bằng chứng / ghi chú |
|---|---|---|---|---|---|
| 1.1 | Đăng nhập Mini App | [ ] | [ ] | | |
| 1.2 | Đăng nhập web | [ ] | [ ] | | |
| 1.3 | Mẫu ZNS đã duyệt | [ ] | [ ] | | |
| 1.4 | Nhập mã mẫu ZNS | [ ] | [ ] | | |
| 1.5 | ZNS "đã xác nhận" | [ ] | [ ] | | |
| 1.6 | ZNS "đang giao" | [ ] | [ ] | | |
| 2.1 | Kết nối, webhook Pancake | [ ] | [ ] | | |
| 2.2 | Đẩy đơn T1 sang Pancake | [ ] | [ ] | | |
| 2.3 | Tồn kho sau khi đặt | [ ] | [ ] | | |
| 2.4 | Huỷ trước bàn giao | [ ] | [ ] | | |
| 2.5 | Trạng thái qua webhook (T2) | [ ] | [ ] | | |
| 2.6 | Sau bàn giao không huỷ được | [ ] | [ ] | | |
| 2.7 | Giao xong, Điểm Xanh | [ ] | [ ] | | |
| 2.8 | Kho huỷ bên Pancake (T9) | [ ] | [ ] | | |
| 2.9 | Đồng bộ danh mục | [ ] | [ ] | | |
| 2.10 | Duyệt "Tubu giao hộ" | [ ] | [ ] | | |
| 3.1 | Gomdon kết nối và công tắc | [ ] | [ ] | | |
| 3.2 | Tạo vận đơn (T3) | [ ] | [ ] | | |
| 3.3 | Webhook hành trình và giao | [ ] | [ ] | | |
| 3.4 | Huỷ và tạo lại vận đơn (T4) | [ ] | [ ] | | |
| 3.5 | Huỷ cả đơn, vận đơn bị huỷ | [ ] | [ ] | | |
| 3.6 | Biết xử lý "từ chối tài khoản" | [ ] | [ ] | | |
| 4.1 | Trả chuyển khoản (T5) | [ ] | [ ] | | |
| 4.2 | Hoàn về Ví Tubu (T5) | [ ] | [ ] | | |
| 4.3 | Hoàn về ngân hàng (T6) | [ ] | [ ] | | |
| 4.4 | Tiền về muộn (T7) | [ ] | [ ] | | |
| 4.5 | Chuyển thiếu (T8) | [ ] | [ ] | | |
| 4.6 | ZaloPay sandbox (dev) | [ ] | [ ] | | |
| 5.1 | COD bị chặn trên 5.000.000đ | [ ] | [ ] | | |
| 5.2 | Giỏ nhiều nơi, trần theo đơn con | [ ] | [ ] | | |
| 5.3 | COD sát trần (T12) | [ ] | [ ] | | |
| 6.1 | Chuẩn bị đối tác | [ ] | [ ] | | |
| 6.2 | Đơn đối tác bằng Ví (T10) | [ ] | [ ] | | |
| 6.3 | Đối tác xử lý và giao | [ ] | [ ] | | |
| 6.4 | Giữ tiền 7 ngày | [ ] | [ ] | | |
| 6.5 | Lập phiếu, chi (ngày +7) | [ ] | [ ] | | |
| 6.6 | Đơn ký gửi (T11) | [ ] | [ ] | | |
| 6.7 | Đối soát ký gửi | [ ] | [ ] | | |
| 7.1 | Mang tới kho | [ ] | [ ] | | |
| 7.2 | Gửi về kho | [ ] | [ ] | | |
| 7.3 | Thu kèm đơn | [ ] | [ ] | | |
| 7.4 | Quà | [ ] | [ ] | | |
| 7.5 | Thu hồi điểm | [ ] | [ ] | | |
| 8.1 | Điều kiện hiển thị đánh giá | [ ] | [ ] | | |
| 8.2 | Đánh giá đầu, có thưởng | [ ] | [ ] | | |
| 8.3 | Đánh giá lần hai, không thưởng | [ ] | [ ] | | |
| 8.4 | Sửa, gửi lại cùng đơn | [ ] | [ ] | | |
| 8.5 | Quản trị ẩn, hiện lại đánh giá | [ ] | [ ] | | |
| 8.6 | Xoá qua API rồi viết lại (dev, tuỳ chọn) | [ ] | [ ] | | |
| 9.1 | Kênh email đã bật | [ ] | [ ] | | |
| 9.2 | Email thử | [ ] | [ ] | | |
| 9.3 | Kênh webhook nhận tin thử | [ ] | [ ] | | |
| 9.4 | Báo động thật và "ổn trở lại" | [ ] | [ ] | | |
| 10 | Dọn dẹp xong | [ ] | [ ] | | |

**Kết luận của chủ shop** (đánh dấu một ô): [ ] Đủ điều kiện mở bán  [ ] Mở bán nhưng theo dõi kỹ các mục: ______  [ ] Chưa mở bán, cần sửa: ______

Chữ ký/ngày: ______

---

## Phụ lục P. Câu SQL chỉ-đọc để lấy bằng chứng

Chỉ có `SELECT`. Chạy trên VPS sau khi định nghĩa `psqlq` (mục 0.4 của [deploy-rollback-runbook.md](deploy-rollback-runbook.md)). Đặt trước: mã đơn `M`, SĐT Người thử `SDT` (dạng `0xxxxxxxxx`), tên sản phẩm `TEN`.

```bash
M=TUBU0000000; SDT=0900000000; TEN='tên sản phẩm'
```

**P1. Một đơn: thanh toán, Pancake, Gomdon**

```bash
psqlq <<SQL
SELECT code, status, "paymentMethod", "paymentStatus", total, fulfiller,
       "pancakeOrderId", "pancakePushStatus", "pancakeCancelStatus", "pancakeAttention",
       "shippingPartner", "shippingCode",
       "gomdonStatus", "gomdonCancelStatus", "gomdonAttempt", "gomdonPartnerCode"
FROM orders WHERE code = '$M';
SQL
```

**P2. Lịch sử trạng thái của đơn**

```bash
psqlq <<SQL
SELECT h."createdAt", h."fromStatus", h."toStatus", h."actorType", left(h.note, 80) AS note
FROM order_status_history h JOIN orders o ON o.id = h."orderId"
WHERE o.code = '$M' ORDER BY h."createdAt";
SQL
```

**P3. Tồn kho của một sản phẩm (Tubu, Pancake, đang giữ chỗ)**

```bash
psqlq <<SQL
SELECT p.name, v.name AS bien_the, v.stock, v."pancakeStock", v."reservedStock", v."isActive", v."pancakeHold"
FROM variations v JOIN products p ON p.id = v."productId"
WHERE p.name ILIKE '%$TEN%';
SQL
```

**P3b. Sản phẩm (hiện/ẩn, thuộc gian hàng nào)**

```bash
psqlq <<SQL
SELECT name, "isActive", "pancakeHold", "approvalStatus", "storefrontId", "pancakeLinkCode"
FROM products WHERE name ILIKE '%$TEN%';
SQL
```

**P4. Thông báo ZNS gần đây**

```bash
psqlq <<SQL
SELECT "sentAt", "templateCode", channel, status, left(error, 120) AS error
FROM notification_logs WHERE channel = 'ZNS' ORDER BY "sentAt" DESC LIMIT 10;
SQL
```

**P5. Webhook Pancake gần đây**

```bash
psqlq <<SQL
SELECT "receivedAt", "eventType", status, attempts, left(error, 80) AS error
FROM pancake_webhook_events ORDER BY "receivedAt" DESC LIMIT 10;
SQL
```

**P6. Webhook Gomdon gần đây** (trạng thái `IGNORED` cho vận đơn lạ là bình thường)

```bash
psqlq <<SQL
SELECT "receivedAt", "orderCode", "gomdonStatus", status, attempts, left(error, 80) AS error
FROM gomdon_webhook_events ORDER BY "receivedAt" DESC LIMIT 10;
SQL
```

**P7. Điểm Xanh gần đây của Người thử**

```bash
psqlq <<SQL
SELECT p."createdAt", p.delta, p.reason, p."expiresAt"
FROM points_transactions p JOIN users u ON u.id = p."userId"
WHERE u.phone = '$SDT' ORDER BY p."createdAt" DESC LIMIT 10;
SQL
```

**P8. Ví Tubu của Người thử**

```bash
psqlq <<SQL
SELECT u."walletBalance", w."createdAt", w.delta, w.type, w."refType", w.reason
FROM wallet_transactions w JOIN users u ON u.id = w."userId"
WHERE u.phone = '$SDT' ORDER BY w."createdAt" DESC LIMIT 6;
SQL
```

**P9. Khoản hoàn tiền của một đơn** (chỉ in 4 số cuối tài khoản)

```bash
psqlq <<SQL
SELECT "createdAt", "orderCode", kind, method, status, amount, "bankName",
       right("bankAccountNo", 4) AS stk_4_so_cuoi, "bankRef", "completedAt"
FROM order_customer_refunds WHERE "orderCode" = '$M' ORDER BY "createdAt";
SQL
```

**P10. Dòng đối soát đối tác của một đơn** (chỉ có sau khi lập phiếu)

```bash
psqlq <<SQL
SELECT "orderCode", kind, "goodsAmount", "shippingFee", "commissionAmount", "opsFeeAmount",
       "codCollected", "netAmount", "payoutId"
FROM merchant_payout_lines WHERE "orderCode" = '$M';
SQL
```

**P11. Cấu hình chính của bản thử**

```bash
psqlq <<SQL
SELECT key, value FROM system_configs
WHERE key IN ('shipping.gomdon.recycling_enabled', 'merchant.settlement_hold_days',
              'merchant.commission_pct', 'merchant.default_shipping_fee',
              'merchant.consignment_settle_from', 'waste.enabled', 'waste.lane_pickup_enabled', 'waste.customer_monthly_cap_points',
              'orders.pending_payment_ttl_hours', 'ops.alert_repeat_hours')
ORDER BY key;
SELECT code, channel, "zaloTemplateId" FROM notification_templates WHERE channel = 'ZNS' ORDER BY code;
SQL
```

**P12. Điểm nhận và yêu cầu Đổi rác gần đây**

```bash
psqlq <<SQL
SELECT key, value FROM system_configs WHERE key LIKE 'waste.%' ORDER BY key;
SELECT kind, name, status, "provinceName", "monthlyQuotaPoints" FROM waste_points ORDER BY kind, "sortOrder";
SELECT "createdAt", code, method, status, "estimatedPoints", "pointsAwarded", "closeReason" FROM waste_requests ORDER BY "createdAt" DESC LIMIT 20;
SELECT "createdAt", kind, "requestId", "actorRole" FROM waste_events ORDER BY "createdAt" DESC LIMIT 50;
SQL
```

**P13. Đánh giá của Người thử**

```bash
psqlq <<SQL
SELECT r."createdAt", o.code AS ma_don, r.rating, r."pointsEarned", r."isVisible"
FROM reviews r JOIN orders o ON o.id = r."orderId" JOIN users u ON u.id = r."userId"
WHERE u.phone = '$SDT' ORDER BY r."createdAt" DESC LIMIT 10;
SQL
```

## Tham chiếu

- [deploy-rollback-runbook.md](deploy-rollback-runbook.md): deploy, rollback, định nghĩa `psqlq`.
- [GO-LIVE-KEYS.md](../GO-LIVE-KEYS.md): khoá và webhook của Zalo, Pancake, Gomdon, báo động vận hành.
- [integrations/gomdon.md](../integrations/gomdon.md): hợp đồng Gomdon và 15 điều chưa kiểm chứng.
- [ZALOPAY-SETUP.md](../ZALOPAY-SETUP.md): ZaloPay và cảnh báo hoàn tiền hai lần.
- [2026-10-review/UAT-ZALO.md](../2026-10-review/UAT-ZALO.md): kiểm trên Zalo thật (đăng nhập, giao diện).
- [2026-10-14-merchant-fulfilment-design.md](../2026-10-14-merchant-fulfilment-design.md): thiết kế đơn đối tác, ký gửi, đối soát.
- [2026-09-11-P0-3-pancake-stock-decision-brief.md](../2026-09-11-P0-3-pancake-stock-decision-brief.md): thiết kế tồn kho giữ chỗ.
