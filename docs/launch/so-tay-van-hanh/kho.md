# Sổ tay Kho

Bạn nhận đơn, đóng gói, giao hãng, nhận hàng trả. Việc chính làm trên **Pancake**. Tubu chỉ theo dõi và nhắc việc. Đọc [README](README.md) trước (nhất là mục 3, 4, 5).
Ký hiệu: **⏳ đang làm** = chưa có chức năng, làm theo đường tạm. **(cần xác nhận)** = chưa kiểm thực tế.

Bạn dùng: Pancake, web **Quản trị** (nhóm việc Kho thấy: Việc cần xử lý, Đơn hàng, Đổi / Trả), Mini App (**Cá nhân › Ca làm & chấm công**).

## Đầu ca

1. Mở **Quản trị › Tổng quan › Việc cần xử lý**. Thẻ của bạn: "Cần xử lý Pancake", "Đơn chưa lên Pancake", "Cần xử lý thu gom", "Hàng trả chờ nhận về kho". Bấm thẻ để mở đúng danh sách.
2. Đơn nhãn **"Pancake: đẩy lỗi"** hoặc **"quá hạn tự đẩy"** là đơn chưa tới Pancake. Mở đơn, mục "Kho Pancake", bấm "Đẩy lại Pancake". Hệ thống tra theo mã đơn trước nên không tạo trùng. **Chỉ bấm khi bạn chưa tạo tay đơn đó trên Pancake.**
3. Hai nhãn này là bình thường, không làm gì: "Pancake: chờ thanh toán" (khách trả qua cổng, chưa trả xong) và "Pancake: chờ đủ hàng" (đơn đại lý đặt trước).
4. Mở Pancake, lọc đơn mới. Đơn từ Tubu có thẻ **MINIAPP** hoặc **WEB**.
5. Xem tồn các sản phẩm chạy mạnh trên Pancake. Tubu chưa có cảnh báo sắp hết hàng (**⏳ đang làm**).
6. Vào ca trên Mini App: **Ca làm & chấm công**.

## Trong ca

**Đọc ghi chú đơn trước khi giao.** Hệ thống ghi sẵn trên đơn Pancake:

| Ghi chú hoặc thẻ | Việc của bạn |
|---|---|
| `[THU COD …đ]` (thẻ COD) | Shipper thu đúng số này khi giao. |
| `[ĐÃ THANH TOÁN … - KHÔNG THU COD]` (thẻ DA_THANH_TOAN) | Không thu tiền. |
| `[ĐẠI LÝ GHI CÔNG NỢ - KHÔNG THU COD]` (thẻ CONG_NO, DEALER) | Không thu tiền, đơn đại lý ghi nợ. |
| `[CHỜ CHUYỂN KHOẢN … - CHƯA GIAO, CHỜ TUBU XÁC NHẬN ĐÃ NHẬN TIỀN]` (thẻ CHO_CHUYEN_KHOAN) | **Không đóng gói, không giao.** Chờ ghi chú đổi thành "ĐÃ THANH TOÁN" (Pancake tự đối chiếu ngân hàng, thường trong 15 phút). |
| Thẻ RECYCLING | Khách gửi vỏ hoặc vật liệu tái chế đi kèm. Đọc "Khách gửi kèm" ở chi tiết đơn Tubu. |
| Thẻ GOMDON | Đơn giao bằng vận đơn Gomdon (BestExpress). Xem mục "Thu gom" dưới đây. |

Chữ "đã thanh toán", "không thu COD" do khách tự gõ trong ghi chú bị hệ thống ẩn đi. Chỉ tin dấu `[ ]` hệ thống ghi.

**Làm đơn trên Pancake như thường lệ.** Xác nhận, in vận đơn, đóng hàng, giao hãng đều trên Pancake. Tubu tự đổi trạng thái theo, chậm nhất vài phút:

| Bạn đặt trên Pancake | Tubu hiện |
|---|---|
| Đã xác nhận | Đã xác nhận |
| Chờ in, Đã in, Đang đóng hàng, Chờ chuyển hàng | Đã đóng gói |
| Đã gửi hàng | Đang vận chuyển (kèm hãng, mã vận đơn) |
| Đã nhận, Đã thu tiền | Đã giao hàng (cộng Điểm Xanh, bắt đầu giữ hoa hồng) |
| Đã hủy | Đã hủy |
| Đang hoàn, Hoàn một phần, Đã xoá | Nhãn đỏ "Pancake: cần xử lý" |
| Bạn sửa món, giảm giá hoặc phí ship của đơn khiến tổng tiền đổi | Nhãn đỏ "Pancake: cần xử lý", lý do "Tổng tiền Pancake lệch với Tubu" kèm số lệch. Tubu không đổi tổng đơn của khách. |
| Đã hoàn | Đơn tự huỷ (chưa giao) hoặc "Đã trả hàng" (đã giao); tồn kho cộng lại |

**Chỉ bấm "Đã nhận" hoặc "Đã thu tiền" khi hàng đã giao thật.** Không bấm hoàn thành hàng loạt: khách nhận điểm, hoa hồng bắt đầu giữ, đơn không huỷ được nữa.

**Dự phòng trên Tubu.** Pancake chưa báo về mà cần ghi "Đã đóng gói": **Quản trị › Đơn hàng** › mở đơn › "Đã đóng gói". Nút này chỉ ghi ở Tubu, không đổi trạng thái trên Pancake (cần xác nhận). Kho không có quyền bấm "Giao vận" hay "Đã giao hàng" trên Tubu: việc đó do Pancake báo về hoặc admin làm.

**Sản phẩm, giá, tồn kho.** Làm hết trên Pancake. Tubu tự cập nhật mỗi 15 phút và quét lại toàn bộ lúc 3 giờ 30 sáng.
- Nhập hàng, kiểm kho: sửa tồn trên Pancake. Tubu theo sau tối đa 15 phút. Cần thấy ngay: nhờ admin bấm "Đồng bộ danh mục Pancake".
- Ngừng bán một sản phẩm: đặt giá bằng 0 (Tubu ẩn), hoặc xoá trên Pancake (Tubu tắt bán).
- Tồn trên Tubu có thể thấp hơn Pancake vài đơn vị, vì Tubu trừ ngay khi khách đặt (cần xác nhận Pancake có tự trừ tồn khi nhận đơn từ Tubu không).

**Nhận hàng trả (khách trả hàng đã duyệt).**
1. CSKH duyệt trong Tubu. Đơn hiện nhãn đỏ "Pancake: cần xử lý" với lời nhắc "Khách trả cả đơn" hoặc "Khách trả một phần đơn".
2. Trên Pancake tạo phiếu: trả cả đơn thì tạo phiếu trả hàng. Trả một phần thì tạo phiếu **"Hoàn một phần"**, **không** dùng "Đã hoàn" cho cả đơn.
3. Hàng về, kiểm số lượng và tình trạng. Mở **Quản trị › Hoàn tiền & đổi trả › Đổi / Trả**, bộ lọc "Chờ nhận hàng về" (kho mở sẵn bộ lọc này). Bấm **"Đã nhận hàng về"**. Mỗi yêu cầu bấm một lần. Tubu cộng tồn.
4. Lời nhắc tự mất khi hàng đã nhận. Không tự mất thì mở đơn, ghi chú, bấm "Đã xử lý".
5. Không hoàn tiền tay. Tiền và điểm do hệ thống tính lúc CSKH duyệt.

**Thu kèm rác (Gomdon).** Đơn có thẻ GOMDON giao bằng vận đơn Gomdon (BestExpress). Mã vận đơn nằm ở chi tiết đơn Tubu, khối "Thu kèm rác (Gomdon)". Trạng thái giao theo Gomdon: bấm "Đã thu tiền" trên Pancake không chốt được đơn. Thẻ "Cần xử lý thu gom" là đơn có vận đơn lỗi. Mở đơn, đọc dòng giải thích trong mục này, rồi chọn:
- "Tạo lại vận đơn Gomdon": vận đơn lỗi hoặc chưa tạo.
- "Huỷ vận đơn Gomdon": đơn đã huỷ mà vận đơn còn sống.
- "Đã xử lý tay" (ghi chú): bạn đã xử lý ngoài hệ thống, ví dụ gọi hãng tạo vận đơn riêng.
Báo động Gomdon hiện ngay trong chi tiết đơn, bấm "Đã xử lý" sau khi xong.

**Đổi rác** (mọi nhân viên): **Quản trị › Khách hàng › Đổi rác › Yêu cầu**. Hai thẻ ở "Việc cần xử lý" mở thẳng tới đây: "Kiện đổi rác chờ đếm" và "Kiện không rõ chủ".
- Mở yêu cầu: gõ mã vào ô "Mã yêu cầu, mã đơn hoặc mã vận đơn", bấm "Tra", rồi bấm "Mở" ở dòng kết quả.
- Nhận kiện gửi về kho hoặc kiện thu kèm đơn: bấm "Nhận kiện", gõ "Mã TR- trên kiện", bấm "Xác nhận đã nhận kiện". Nhận theo mã TR-, không theo mã vận đơn của hãng. Kiện còn cước thu thì bấm "Từ chối tại cửa (chưa trả cước)".
- Đếm: ở khối "Đếm hàng thực nhận", gõ số thực nhận của từng món (nhận thiếu thì chọn lý do), bấm "Xác nhận số đếm". Điểm cộng theo số thực nhận, không theo số khách khai.
- Pin đã dùng: chỉ nhận khi khách mang tới điểm nhận, không nhận qua đường gửi hay thu kèm đơn. Kho TP.HCM nhận pin ngay khi món được bật (kho nhận mọi món đang nhận); điểm đối tác chỉ nhận khi admin hoặc chủ điểm đã gắn pin vào điểm đó. Cất riêng vào thùng kín, không để lẫn rác khác, rồi giao cho đơn vị xử lý chất thải nguy hại có hợp đồng. Pin phồng, chảy nước, pin xe điện, ắc quy: không đếm, ở quầy chọn lý do nhận thiếu "Hỏng" hoặc "Sai loại".
- Kiện không khớp yêu cầu nào: bấm "Hàng không rõ chủ", điền "Mô tả kiện", bấm "Ghi kiện". Chỉ mô tả kiện, không ghi tên hay số điện thoại người gửi.

**Khách mua tại quầy.** Pancake POS không tự cộng Điểm Xanh. Bấm link **"Màn thu ngân (tích điểm tại quầy)"** góc trên bên phải trang Quản trị. Quét thẻ hoặc nhập SĐT, "Tra cứu". Nhập "Tổng tiền hoá đơn" và "Mã hoá đơn POS", bấm "Tích điểm". Mỗi hoá đơn tích một lần, không tự tích cho chính mình. Màn báo "đang TẮT": nhờ admin bật.

## Cuối ca

1. Mở **Việc cần xử lý**: không còn thẻ đỏ của kho thì đóng ca. Còn thì ghi tên đơn gửi ca sau.
2. Trên Pancake: mọi đơn "chờ chuyển khoản" đã quá một ngày còn nằm đó, báo CSKH (Tubu tự huỷ đơn chuyển khoản chưa trả sau 24 giờ, đại lý 72 giờ, và tự huỷ bên Pancake).
3. Ra ca trên Mini App.

## Hằng tuần

- Kiểm kho thực tế, sửa tồn trên Pancake.
- Đối soát COD với hãng vận chuyển trên Pancake. Tubu chỉ hiện "COD chưa thu".
- Báo CSKH các sản phẩm hay bị trả vì bể vỡ, thiếu, giao sai.
- Quét lại danh sách "Cần xử lý Pancake": đơn nào treo quá 3 ngày, hỏi admin.

## Xử lý tình huống

**Đơn có món hết hàng ngoài kho.** Kho không huỷ được đơn trên Tubu (chỉ CSKH và admin huỷ). Báo CSKH: huỷ đơn ở Tubu, ghi lý do "hết hàng", tiền về Ví Tubu của khách. Hệ thống chưa có "bỏ một món khỏi đơn" (**⏳ đang làm**): khách đặt lại phần còn hàng. Sửa tồn trên Pancake để Tubu ngừng nhận đơn.

**Thấy lý do "Tổng tiền Pancake lệch với Tubu".** Ai đó đã sửa đơn này trên Pancake. **Không sửa tiếp.** Báo CSKH hoặc admin: huỷ đơn ở Tubu và khách đặt lại, hoặc bạn trả đơn Pancake về đúng nội dung đơn Tubu (lý do tự biến mất khi Pancake báo lại đơn đúng tổng). Bấm "Đã xử lý" khi xong.

**Khách gọi đổi địa chỉ.** **Không sửa địa chỉ trên Pancake**, Tubu không biết và hoàn tiền, đối soát theo địa chỉ cũ. Chưa giao hãng: báo CSKH huỷ và khách đặt lại. Đã giao hãng: gọi hãng, nhờ CSKH báo khách. Xem [cskh.md](cskh.md).

**COD khách không nhận.** Pancake báo "Đang hoàn", đơn hiện nhãn đỏ. CSKH gọi khách. Hàng về kho thì đặt "Đã hoàn" trên Pancake. Tubu tự huỷ đơn và cộng tồn. Không cần hoàn tiền vì COD chưa thu. Nút "Đã xử lý" bấm sau khi xong.

**Pancake báo "Hoàn một phần" mà không có yêu cầu trả trên Tubu.** Nhãn đỏ cho biết chưa có yêu cầu. Báo CSKH: khách gửi yêu cầu trả đúng dòng trong app, CSKH duyệt, hệ thống tự hoàn tiền và điểm. Không hoàn tay.

**Đơn bị xoá trên Pancake ("Đã xoá").** Tubu không tự huỷ. Xác nhận với người xoá. Xoá nhầm: báo admin (cần xác nhận cách khôi phục). Xoá đúng: nhờ CSKH huỷ đơn trên Tubu để hoàn tiền và tồn.

**Giao nhầm hoặc thiếu hàng.** Giữ ảnh, báo CSKH. Khách tự gửi yêu cầu trả trong app, hoặc CSKH hướng dẫn.

**Đơn lên Pancake sai (thiếu món, sai SĐT).** Do khách đặt sai. Không sửa trên Pancake. Báo CSKH: huỷ và đặt lại.

**Đơn đã tạo tay trên Pancake theo yêu cầu khách gọi.** Tubu bỏ qua, không Điểm Xanh, không hoa hồng. Chỉ làm khi CSKH báo và chủ shop đồng ý. Không dán mã TUBU… vào đơn tạo tay.
