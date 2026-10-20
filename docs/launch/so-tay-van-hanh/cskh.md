# Sổ tay CSKH

Bạn trả lời khách, tra đơn, huỷ đơn theo yêu cầu, duyệt đổi/trả. Đọc [README](README.md) trước (nhất là mục 3, 4, 5).
Ký hiệu: **⏳ đang làm** = chưa có chức năng, làm theo đường tạm. **(cần xác nhận)** = chưa kiểm thực tế.

Bạn dùng: web **Quản trị** (nhóm việc CSKH thấy: Việc cần xử lý, Đơn hàng, Đổi / Trả, Người dùng, CSKH mẫu tin nhanh), Zalo OA Manager hoặc Pancake để chat.

## Đầu ca

1. **Quản trị › Tổng quan › Việc cần xử lý.** Bạn thấy thẻ "Yêu cầu đổi / trả chờ duyệt". Bấm thẻ đổi/trả để mở danh sách.
2. Mở **Quản trị › Hoàn tiền & đổi trả › Đổi / Trả**, bộ lọc "Chờ duyệt". Yêu cầu cũ nhất nằm trên cùng. Hệ thống đã hứa với khách "phản hồi trong 24h": không để yêu cầu nào quá 24 giờ.
3. Mở hộp tin Zalo OA. Chat chưa nằm trong Tubu (chat bằng OA Manager hay Pancake: cần xác nhận với chủ shop).

## Trong ca

**Tra đơn.** **Quản trị › Đơn hàng.** Gõ vào ô tìm: mã đơn, mã vận đơn, mã Pancake, SĐT, tên khách hoặc tên người nhận, bấm "Tìm kiếm". Lọc thêm theo "Tất cả trạng thái" và "Từ ngày … đến …". Bấm "Xem & Sửa" (trên điện thoại: bấm mã đơn). Bạn thấy:
- Sản phẩm trong đơn, "Ghi chú từ khách".
- "Địa chỉ giao hàng", nút "Chép SĐT", "Chép địa chỉ".
- "Vận chuyển": hãng, mã vận đơn, trạng thái giao.
- "Lịch sử trạng thái": ai đổi, từ đâu sang đâu, lúc nào.

"Xem & Sửa" **không** sửa được địa chỉ hay món. Đừng tìm nút sửa. Danh sách chưa lọc được theo phương thức thanh toán, loại đơn, nguồn, CTV giới thiệu (**⏳ đang làm**): nhờ admin xuất CSV rồi lọc trong Excel.

**Tra khách.** **Quản trị › Khách hàng › Người dùng**, gõ SĐT, tên hoặc mã. Bấm tên khách: Hồ sơ (SĐT, hạng, số dư ví, Điểm Xanh), Đơn hàng mới nhất, Sổ ví, Điểm Xanh (từng dòng cộng/trừ, hạn dùng). Bạn chỉ xem. Khoá tài khoản là việc của admin. Chưa có địa chỉ, tổng chi tiêu, nhãn khách (**⏳ đang làm**): xem địa chỉ trong từng đơn.

**Huỷ đơn theo yêu cầu khách** (chỉ khi đơn chưa bàn giao vận chuyển):
1. Mở đơn, bấm "Hủy đơn".
2. Đọc hộp xác nhận. Hộp ghi rõ hệ quả: có hoàn tiền không, trả lại bao nhiêu Điểm Xanh, có huỷ cả bên Pancake không.
3. Ô "Lý do huỷ (tuỳ chọn)": khách đọc được trong thông báo huỷ. Nên ghi lý do thật, lịch sự.
4. Bấm "Huỷ đơn". Đơn đã bàn giao hãng vận chuyển thì hệ thống từ chối. Xem "Xử lý tình huống".

Đơn đã trả tiền mà **bạn** huỷ: tiền về **Ví Tubu** của khách ngay. Muốn tiền về ngân hàng, khách phải tự huỷ trong app và chọn "Tài khoản ngân hàng". Hỏi khách muốn cách nào trước khi huỷ.

**Duyệt đổi/trả.** Trong **Đổi / Trả**, mỗi yêu cầu cho thấy: đơn, khách, dòng khách trả và số lượng, lý do, ảnh khách gửi.
1. Xem ảnh và lý do. Gõ ghi chú nếu cần.
2. Bấm "Duyệt hoàn tiền". Màn hiện số tiền hệ thống tính sẵn (tiền hàng, phí ship hoàn, tổng hoàn), nơi tiền về (Ví Tubu hoặc ngân hàng), Điểm Xanh trả lại/thu hồi.
3. Tick "Lỗi do Tubu" nếu lỗi thuộc về shop: hoàn cả phí ship dù khách chỉ trả một phần. Lý do khách chọn "lỗi, giao sai, bể vỡ, hết hạn" thì ô tự tick.
4. Bấm "Xác nhận hoàn …". Tiền về Ví Tubu ngay. Khách chọn ngân hàng thì yêu cầu sang **Hoàn tiền khách** cho kế toán.
5. Đơn giao qua Pancake: màn nhắc "tạo phiếu trả/nhận hàng về trên Pancake". Báo kho làm.
6. Từ chối: ghi lý do (ít nhất 3 ký tự, khách đọc được), bấm "Từ chối".

Hệ thống chỉ **hoàn tiền**. Khách muốn đổi sang sản phẩm khác: duyệt trả, bảo khách đặt đơn mới.

**Mẫu tin nhanh.** **Quản trị › Nội dung › CSKH mẫu tin nhanh.** Đây là tin bot Zalo OA tự trả lời khách (theo từ khoá, hoặc lời chào cho tin đầu tiên). Không phải kho câu để bạn sao chép. Thêm mẫu: nhóm, tên nội bộ, từ khoá cách nhau dấu phẩy, nội dung, "Thêm mẫu tin". Bạn **chưa** xem được bot đã trả lời khách câu gì (**⏳ đang làm**): hỏi lại khách trước khi trả lời, tránh trả trùng hoặc ngược với bot.

## Cuối ca

1. **Đổi / Trả** "Chờ duyệt" phải hết hoặc còn dưới 24 giờ tuổi.
2. Đơn đang chờ khách phản hồi: ghi tên đơn và việc cần làm, gửi người ca sau. Chưa có ghi chú nội bộ trên khách và đơn (**⏳ đang làm**). Đường tạm: ghi vào nhóm Zalo nội bộ hoặc file Excel chung.

## Hằng tuần

- Gom câu khách hỏi lặp lại, gửi marketing để bổ sung "Câu hỏi thường gặp".
- Xem lại "CSKH mẫu tin nhanh": từ khoá nào bot trả sai thì sửa.
- Đếm số đổi/trả theo lý do, báo admin nếu một sản phẩm bị trả nhiều.

## Xử lý tình huống

**Đơn hiện lý do "Tổng tiền Pancake lệch với Tubu".** Kho hoặc ai đó đã sửa đơn trên Pancake (thêm bớt món, đổi giảm giá, phí ship). Khách vẫn thấy và vẫn được tính tiền, hoàn tiền, hoa hồng theo tổng của Tubu. Gọi khách xác nhận nội dung đúng, rồi huỷ đơn ở Tubu cho khách đặt lại, hoặc nhờ kho trả đơn Pancake về đúng đơn Tubu. Không tự sửa số trên Pancake để "cho khớp" mà không hỏi khách.

**Khách gọi đổi địa chỉ.** Hệ thống không sửa được địa chỉ đơn (**⏳ đang làm**). **Không sửa trên Pancake.**
- Đơn chưa có mã vận đơn (Chờ thanh toán, Đã xác nhận, Đã đóng gói): báo khách "Tubu huỷ đơn cũ, bạn đặt lại với địa chỉ mới". Bạn bấm "Hủy đơn". Nếu khách đã trả tiền, tiền về Ví Tubu và khách dùng ví trả đơn mới. Bạn chưa đặt hộ được (**⏳ đang làm**): gửi link sản phẩm, hướng dẫn khách đặt trong app.
- Đơn đã có mã vận đơn hoặc "Đang vận chuyển": Tubu không huỷ được. Gọi hãng vận chuyển theo mã vận đơn (nhìn dòng "Vận chuyển" ở chi tiết đơn) để xin đổi địa chỉ giao (cần xác nhận hãng có đổi được không). Không đổi được thì khách từ chối nhận, hàng hoàn về kho, đơn tự huỷ.

**Khách hỏi điểm.** Mở **Người dùng**, tìm khách, xem ô "Điểm Xanh". Nói với khách (số mặc định, admin có thể đổi):
- Điểm cộng khi đơn "Đã giao hàng". Điểm của đơn dùng được sau khi hết hạn đổi/trả (mặc định 7 ngày). Trong lúc chờ, điểm hiện trong số dư nhưng chưa tiêu được.
- 1 Điểm Xanh = 1đ. Đơn đặt trong Mini App tích 2% tiền hàng (sau giảm giá, không tính phí giao), nhân hệ số hạng (×1, ×1,2, ×1,5, ×2). Dùng tối đa 20% giá trị đơn. Điểm hết hạn sau 12 tháng.
- Khách tự xem: Mini App › **Cá nhân › Hạng thành viên & Điểm Xanh**.
- Đơn tạo thẳng trên Pancake **không có điểm**. Trả hàng thì điểm của đơn đó bị thu hồi.
- Cộng điểm tay chưa có (**⏳ đang làm**). Muốn đền bù, nhờ admin tạo voucher dùng một lần.

**Đơn COD khách không nhận (hoàn).** Pancake báo "Đang hoàn", đơn hiện nhãn "Pancake: cần xử lý".
1. Gọi khách (nút "Chép SĐT"), hỏi lý do, hỏi có muốn giao lại không.
2. Báo kho. Khi kho nhận hàng về, Pancake báo "Đã hoàn", đơn Tubu tự thành "Đã hủy" (đơn chưa giao) hoặc "Đã trả hàng", kho tự cộng lại. COD chưa thu tiền nên không có tiền hoàn.
3. Nút "Đã xử lý" của khối "Cần xử lý Pancake" là việc của kho hoặc admin.
4. Khách bom hàng nhiều lần: báo admin khoá tài khoản.

**Khách khiếu nại hàng lỗi, thiếu, giao sai.**
1. Xin ảnh. Kiểm đơn: đã "Đã giao hàng" chưa, còn trong hạn đổi/trả (mặc định 7 ngày kể từ khi nhận) chưa.
2. Hướng dẫn khách: Mini App › Đơn hàng › mở đơn › "Yêu cầu đổi/trả", chọn dòng, lý do, đính ảnh. Bạn chưa tạo hộ được (**⏳ đang làm**). Khách không dùng được app: ghi SĐT và mã đơn, báo admin (cần xác nhận cách xử lý).
3. Duyệt như mục "Duyệt đổi/trả". Hàng lỗi do shop: tick "Lỗi do Tubu".
4. Quá hạn 7 ngày: hệ thống không nhận yêu cầu. Chủ shop quyết định có hỗ trợ ngoại lệ không (cần xác nhận).
5. Khách nhận thiếu một phần mà Pancake báo "Hoàn một phần": **không hoàn tay**. Bảo khách gửi yêu cầu trả đúng dòng đó, bạn duyệt, hệ thống tự hoàn tiền và điểm.

**Khách hỏi bao giờ nhận tiền hoàn.** Mở đơn, xem dòng thanh toán: "Đang hoàn tiền" nghĩa là tiền chưa về khách. Về Ví Tubu: ngay lúc duyệt hoặc huỷ. Về ngân hàng: kế toán chuyển, 1 đến 3 ngày làm việc, miễn phí. Bạn chưa mở được hàng đợi hoàn tiền (**⏳ đang làm**): hỏi kế toán theo mã đơn.

**Khách chuyển khoản mà đơn vẫn "Chờ thanh toán".** Chờ 15 phút (Pancake tự đối chiếu với ngân hàng). Quá 15 phút: chuyển kế toán/admin đối chiếu sao kê rồi bấm "Đã nhận tiền". Đơn chuyển khoản chưa trả tự huỷ sau 24 giờ (mặc định). Khách chuyển thiếu: đơn hiện cảnh báo "Khách chuyển thiếu", báo khách chuyển nốt hoặc huỷ.

**Khách muốn đặt hàng qua chat hoặc điện thoại.** "Lên đơn hộ" chưa có (**⏳ đang làm**). Ưu tiên gửi link sản phẩm cho khách tự đặt trong app (được Điểm Xanh). Chỉ tạo tay trên Pancake khi khách không dùng được app, và nói rõ "đơn này không tích điểm" (cần xác nhận với chủ shop).

**Khách hỏi hoá đơn VAT.** Khách tick yêu cầu VAT lúc đặt. Chuyển kế toán: họ xuất hoá đơn rồi bấm "Đã xuất hoá đơn", khách nhận thông báo.

**Khách hỏi phí ship.** Mặc định miễn phí từ 199.000đ, dưới đó 19.000đ, một số hạng thành viên được miễn sớm hơn. Hỏi admin mức đang áp dụng.

**Khách đánh giá xấu.** Chỉ admin ẩn được (nút "Ẩn đánh giá"). Phản hồi đánh giá chưa có (**⏳ đang làm**). Liên hệ khách riêng.
