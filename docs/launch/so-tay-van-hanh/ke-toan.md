# Sổ tay Kế toán, đối soát

Bạn đối chiếu sao kê, chuyển tiền hoàn cho khách, duyệt rút tiền CTV, đối soát đối tác, theo dõi công nợ đại lý, ghi nhận hoá đơn VAT. Đọc [README](README.md) trước, nhất là quy tắc 7.
**Tubu chỉ ghi sổ, không tự chuyển tiền.** Mọi lần chuyển: chuyển ở ngân hàng trước, rồi mới bấm "Đã chuyển khoản" hoặc "Đã chuyển" trong Tubu, kèm mã giao dịch.
Ký hiệu: **⏳ đang làm** = chưa có chức năng, làm theo đường tạm. **(cần xác nhận)** = chưa kiểm thực tế.

Bạn dùng: web **Quản trị**, sao kê ngân hàng, Pancake (đối soát COD với hãng vận chuyển), phần mềm hoá đơn điện tử.
Chưa có nhóm quyền Kế toán (**⏳ đang làm**): bạn đang dùng vai trò "Quản trị", sửa được cả cấu hình. Chỉ làm việc trong sổ tay này.

## Đầu ca

1. **Quản trị › Tổng quan › Việc cần xử lý.** Thẻ của bạn: "Hoàn tiền khách", "Lệnh rút tiền chờ duyệt", "Phiếu đối soát chờ chuyển / thu". Bấm thẻ để mở màn.
2. Mở sao kê ngân hàng. Mỗi khoản khách chuyển cho đơn phải thành "Đã thanh toán" (Pancake tự đối chiếu, thường trong 15 phút). Khoản nào chưa lên, xem "Xử lý tình huống".
3. **Đơn hàng**, bộ lọc "VAT chờ xuất": xử lý hoá đơn tồn.

## Trong ca

**Hoàn tiền cho khách.** **Quản trị › Hoàn tiền & đổi trả › Hoàn tiền khách.** Mặc định xem "Đang mở". Lọc loại khoản: "Huỷ đơn", "Trả hàng", "Tiền về muộn", "Tiền trả dư", "Đơn CTV lên hộ". Khoản khách chọn **Ví Tubu** được cộng ngay, bạn không chuyển. Bạn chỉ chuyển khoản khách chọn **tài khoản ngân hàng**.
1. Mở mục "Chờ chuyển khoản". Khách chưa chọn nơi nhận thì chờ. Khách gửi số tài khoản qua CSKH: nhập lúc bấm "Bắt đầu chuyển khoản".
2. Bấm **"Bắt đầu chuyển khoản"**. Khách không đổi sang Ví được nữa. Khoản sang mục "Đang chuyển khoản".
3. Chuyển tiền ở ngân hàng đúng số tiền, đúng tài khoản trên màn (miễn phí cho khách). Đơn CTV lên hộ: chuyển theo SĐT khách cuối, nút "Chép SĐT".
4. Bấm **"Đã chuyển khoản"**, nhập "Mã giao dịch ngân hàng". Khách nhận thông báo.
5. Khoản người khác đang giữ: nút "Trả về hàng chờ", ghi lý do (ít nhất 5 ký tự). Chỉ bấm khi chắc người đó chưa chuyển, nếu không tiền bị hoàn hai lần.
Khách hứa được nhận tiền sau 1 đến 3 ngày làm việc. Giữ đúng hạn này.

**Tiền trả dư.** Mục "Chờ đối soát": Pancake báo khách chuyển nhiều hơn tổng đơn. Khách chưa thấy khoản này. Đối chiếu sao kê.
- Có khoản dư thật: nhập "Số tiền dư thực nhận" (không vượt số Pancake báo), bấm "Xác nhận tiền dư". Khách được báo chọn Ví hoặc ngân hàng.
- Không có (cùng một lần chuyển, hoặc kho sửa đơn trên Pancake): bấm "Không phải tiền dư", ghi lý do (ít nhất 5 ký tự).

**Tiền về muộn** (đơn đã huỷ mà khách vẫn chuyển). Pancake báo thì khoản tự hiện loại "Tiền về muộn" trong "Hoàn tiền khách". Sau 15 phút không thấy: **Đơn hàng** › mở đơn đã huỷ › khối "Ghi nhận tiền về muộn". Nhập "Số tiền thực nhận" đúng như sao kê, mã giao dịch, bấm "Ghi nhận tiền về muộn". Khoản sang "Hoàn tiền khách". Đơn vẫn giữ trạng thái huỷ.

**Xác nhận đã nhận chuyển khoản.** Dự phòng khi Pancake chưa tự báo. **Đơn hàng** › mở đơn "Chờ thanh toán" › "Đã nhận tiền" (mã giao dịch tuỳ chọn). **Chỉ bấm khi thấy tiền về tài khoản.** Không hoàn tác được. Khách chuyển thiếu: đơn hiện cảnh báo "Khách chuyển thiếu", không bấm.

**Duyệt rút tiền.** **Quản trị › Người bán › Duyệt yêu cầu rút tiền.** Mặc định "Đang chờ duyệt". Chỉ còn lệnh rút ngân hàng tạo trước khi bỏ tính năng này (hoa hồng CTV và rút từ Ví Tubu, phí 3.000đ, số chuyển là số thực nhận đã trừ phí). Không còn lệnh mới: hoa hồng chỉ vào Ví Tubu và Ví chỉ dùng trả tiền hàng. Duyệt và chuyển cho xong các lệnh cũ.
1. Đọc người nhận, ngân hàng, số tài khoản, chủ tài khoản. Dòng "Hoa hồng … · khấu trừ thuế TNCN …" cho biết thuế đã trừ.
2. Bấm "Duyệt" (ghi chú tuỳ chọn). Lệnh thành "Đã duyệt, chờ chuyển khoản".
3. Chuyển đúng **số tiền hiện trên lệnh**. Nếu màn báo "Số thực nhận của lệnh đã đổi từ … thành …" (một lệnh khác cùng tháng vừa bị từ chối, thuế giữ dư được hoàn ngay trên lệnh này), chưa duyệt hoặc chưa chi: màn tự tải lại, đọc số mới rồi làm lại, không chuyển theo số cũ. Rồi nhập "Mã giao dịch NH", bấm "Đã chuyển khoản".
4. Từ chối: ghi lý do (CTV đọc được), bấm "Từ chối". Tiền hoặc hoa hồng tự hoàn lại cho CTV, không cần làm gì thêm.
Thời gian từ lúc đơn giao đến lúc CTV có tiền ngân hàng thường khoảng hai tuần (giữ hoa hồng 10 ngày). Tubu chưa xuất được file chuyển khoản hàng loạt (**⏳ đang làm**): chuyển từng lệnh.

**Thuế TNCN của CTV.** Cuối màn "Duyệt yêu cầu rút tiền": khối **"Khấu trừ thuế TNCN theo tháng"**. Chọn "Tháng báo cáo". Bảng: Người nhận, MST/CCCD, Số lần chi, Thu nhập, Thuế đã khấu trừ, Thực nhận. Hệ thống cộng dồn các lần rút hoa hồng trong cùng tháng (giờ Việt Nam, tính theo ngày CTV gửi lệnh). Khi tổng từ 5.000.000đ (Nghị định 253/2026/NĐ-CP), hệ thống trừ 10% trên tổng tháng, trừ phần đã khấu trừ ở các lần trước (truy thu phần các lần nhỏ trước đó). Nếu phần truy thu lớn hơn số tiền của lần rút này thì chỉ trừ tối đa bằng lần này, phần còn lại trừ ở lần sau trong tháng. Lệnh bị từ chối không tính vào các lần tính sau. Khi admin từ chối một lệnh, hệ thống tính lại thuế của cả tháng đó và tự hoàn phần đã giữ dư ở các lệnh khác, không cần kế toán xử lý tay: lệnh còn "Yêu cầu" được giảm thuế và tăng số thực nhận ngay trên lệnh (tiền chưa chi, nên chuyển đúng số mới); lệnh đã duyệt, đã chuyển khoản hoặc rút về Ví được cộng phần dư vào Ví Tubu của CTV, dòng sổ ví "Hoàn thuế TNCN giữ dư tháng …", và ghi số đã hoàn vào lệnh (cột "Thuế đã hoàn về Ví" trong file Excel danh sách rút tiền). Hoàn chia cho lệnh mới nhất trước, mỗi lệnh tối đa số thuế lệnh đó đã giữ. Nếu sau khi từ chối mà tháng còn thiếu thuế thì lần rút sau trong tháng truy thu như thường. Báo cáo thuế theo tháng và file Excel TNCN dùng thuế thực giữ (đã trừ phần hoàn), nên thu nhập = thuế thực giữ + thực nhận (gồm phần hoàn về Ví). Lệnh rút Ví về ngân hàng bị từ chối chỉ hoàn tiền về Ví, không đụng thuế. Phần hoàn làm giảm "Thuế đã khấu trừ" ở tháng của NGÀY CHI của lệnh được hoàn (không phải tháng của lệnh bị từ chối, cũng không phải tháng ngày CTV gửi lệnh). Vì lệnh bị từ chối có thể đến muộn, báo cáo của một tháng đã kê khai có thể đổi số khi chạy lại: kế toán điều chỉnh ở kỳ kê khai sau, không sửa kỳ đã nộp. Lần rút bị truy thu hết số tiền sẽ có lệnh 0đ (lệnh ngân hàng 0đ vẫn nằm trong hàng chờ): bấm "Đã chuyển khoản" không cần chuyển tiền, ghi chú "0đ, trừ thuế TNCN". Lưu ý: cộng dồn tính theo ngày CTV gửi lệnh, còn bảng "Tháng báo cáo" nhóm theo ngày chi, nên lệnh gửi cuối tháng mà chi đầu tháng sau nằm ở bảng tháng sau; kế toán đối chiếu khi kê khai (cách tính đã chọn chờ kế toán xác nhận). Dòng "Thiếu MST/CCCD": liên hệ CTV. Dùng bảng này kê khai. Cấp chứng từ khấu trừ cho CTV làm ngoài Tubu (cần xác nhận mẫu và hạn).

**Đối soát đối tác.** **Đơn hàng & giao vận › Đơn đối tác & đối soát**, mục "Phiếu đối soát". Quản lý đại lý–CTV lập phiếu. Bạn chuyển tiền:
- Phiếu chuyển cho đối tác: chuyển vào tài khoản hiện trên phiếu, nhập "Mã giao dịch ngân hàng" (bắt buộc), bấm "Đã chuyển". Đối tác chưa khai tài khoản: nhắc họ khai, chưa chuyển.
- Phiếu âm (đối tác tự thu COD, phải nộp lại Tubu): đối chiếu sao kê, nhập "Mã giao dịch đối tác nộp", bấm "Đã thu". Phiếu quá hạn nộp (mặc định 7 ngày) hiện nhãn "Quá hạn nộp".
- Phiếu lập nhầm: "Huỷ phiếu", ghi lý do. Đối tác đọc được.

**Đại lý trả trước và công nợ.** Mở đơn của đại lý (**Đơn hàng**).
- Khối "Đơn đại lý trả trước — chờ chuyển khoản": đối chiếu sao kê, nhập mã giao dịch, bấm "Xác nhận đã nhận chuyển khoản". Đơn thành "Đã xác nhận", tính vào doanh số đại lý. Đơn đại lý có hàng đặt trước không lên Pancake, nên Pancake không tự đối chiếu: bạn bấm tay.
- Khối "Công nợ đại lý": xem "Dư nợ hiện tại" và sổ phát sinh. Đại lý trả nợ: nhập "Số tiền đã nhận (đ)", mã giao dịch, bấm "Xác nhận đã nhận, giảm nợ". "Báo đã CK" của đại lý chỉ là thông báo, **không trừ nợ**.
- Hệ thống không nhắc nợ đến hạn và không khoá mua chịu khi quá hạn (**⏳ đang làm**). Ghi sổ riêng ngày đến hạn theo bậc (NET 15, NET 30).

**Hoá đơn VAT.** **Đơn hàng** › bộ lọc "VAT chờ xuất" › mở đơn › khối "Hoá đơn VAT" (Mã số thuế, Công ty, Địa chỉ, Email nhận hoá đơn).
1. Xuất hoá đơn trên phần mềm hoá đơn điện tử hoặc trên Pancake (Tubu không tự phát hành hoá đơn).
2. Dán link hoá đơn (tuỳ chọn), bấm "Đã xuất hoá đơn". Khách nhận thông báo trong Mini App. Chỉ bấm khi hoá đơn đã phát hành.
Đơn huỷ hoặc trả: không xuất. "VAT đã xuất" để tra lại. Hoá đơn xuất từ Pancake thì Pancake báo về, đơn tự thành "Đã xuất hoá đơn" và khách được báo (cần xác nhận shop có bật hoá đơn trên Pancake).

## Cuối ca

1. Mục "Đang chuyển khoản" của Hoàn tiền khách và "Đã duyệt, chờ chuyển khoản" của rút tiền: không còn khoản bạn bắt đầu mà chưa chuyển.
2. Ghi sổ số tiền đã chuyển hôm nay, khớp với mã giao dịch đã nhập.
3. Chưa có báo cáo doanh thu theo ngày (**⏳ đang làm**). Đường tạm: **Đơn hàng**, chọn "Từ ngày … đến ngày", bấm "Xuất CSV (Excel)". File có: Mã đơn, Ngày đặt, Phương thức TT, Trạng thái TT, Trạng thái đơn, Tạm tính, Giảm giá, Phí ship, Điểm đã dùng, Tổng tiền, Hãng vận chuyển, Mã vận đơn, Mã đơn Pancake, Ngày giao. File **không có** cột hoàn tiền, hoa hồng, nền tảng, nguồn khách, mã voucher, từng dòng hàng.

## Hằng tuần

- Xuất CSV đơn cả tuần, đối chiếu với tiền thực về tài khoản.
- Đối soát COD với hãng vận chuyển trên **Pancake**. Tubu chỉ hiện "COD chưa thu" ở **Tổng quan KPI**, và con số này là cộng dồn từ đầu.
- Rà các khoản "Chờ chuyển khoản", "Chờ đối soát" tồn quá 3 ngày.
- Rà phiếu đối soát đang chờ. Nhắc đối tác chưa nộp phiếu âm.
- Cuối tháng: mở báo cáo "Khấu trừ thuế TNCN theo tháng", kê khai.

## Xử lý tình huống

**Khách báo đã chuyển khoản mà đơn vẫn "Chờ thanh toán".** Tìm khoản trên sao kê theo số tiền và nội dung. Có tiền, quá 15 phút: **Đơn hàng** › "Đã nhận tiền". Chưa thấy tiền: bảo khách gửi ảnh giao dịch, không bấm. Đơn chưa trả tự huỷ sau 24 giờ.

**Khách chuyển sau khi đơn đã huỷ.** Dùng "Ghi nhận tiền về muộn". Khách chọn Ví hoặc ngân hàng.

**Chuyển nhầm số tiền hoặc nhầm tài khoản.** Dừng. Chụp màn hình sao kê và màn Tubu. Gọi chủ shop và kỹ thuật. Tubu không có nút huỷ lệnh đã bấm "Đã chuyển khoản".

**Khách hỏi bao giờ nhận tiền hoàn.** Về Ví Tubu: ngay. Về ngân hàng: 1 đến 3 ngày làm việc từ lúc khoản vào "Chờ chuyển khoản". Tra theo mã đơn trong "Hoàn tiền khách" (bộ lọc "Tất cả" hoặc "Đã chuyển").

**CTV hỏi vì sao rút chưa về.** Xem lệnh cũ: "Đang chờ duyệt", "Đã duyệt, chờ chuyển khoản" nghĩa là bạn chưa chuyển. Trả lời theo trạng thái. Hoa hồng mới vào Ví Tubu có ngay, không rút ngân hàng.

**Xoá tài khoản khi Ví còn tiền.** Khách phải đồng ý bỏ số dư; hệ thống trừ Ví về 0 bằng bút toán ADJUST (nguồn "Xoá tài khoản") trong giao dịch xoá, có sự kiện "WALLET_FORFEIT" trong lịch sử người dùng. Không hoàn tiền mặt cho số dư này. Chưa đồng ý hoặc lệch số thì yêu cầu bị chặn, CSKH gọi khách.

**Đối tác hỏi bao giờ nhận tiền đối soát.** Khoản vào bảng kê 7 ngày sau khi giao. Phiếu do quản lý đại lý–CTV lập. Bạn chuyển khi phiếu "Đang chờ".

**Hãng vận chuyển trả COD thiếu.** Đối soát trên Pancake, không ở Tubu. Ghi chênh lệch theo mã vận đơn, báo kho và chủ shop. Không sửa số trong Tubu.

**Đối soát thưởng quý đại lý khi có trả bù.** Thưởng quý chốt ngày 10 sau quý; đơn chốt muộn hơn được trả bù thành dòng riêng trong "Công nợ đại lý" (mặc định trong 60 ngày sau ngày cuối quý). Mốc "doanh số đã tính" của đại lý lấy từ giờ ghi dòng thưởng; hiếm khi một đơn commit đúng khoảng mili giây sau lúc hệ thống đọc doanh số mà giờ tiền về lại sớm hơn giờ ghi dòng bù, thì đơn đó không được bù và bị tính nhầm là đã tính. Xác suất rất thấp, chấp nhận: cuối cửa sổ, đối chiếu tay doanh số đã chốt của quý với thưởng đã ghi, thiếu thì báo kỹ thuật.

**Đơn Pancake sửa tổng tiền, Tubu giữ số cũ.** Tubu và sao kê lệch. Hoàn tiền, hoa hồng, đối soát vẫn tính theo số cũ. Hỏi kho. Nên huỷ và đặt lại theo quy tắc vàng (xem README).

**Khách hỏi hoá đơn đã xuất chưa.** **Đơn hàng**, tìm mã đơn, xem khối "Hoá đơn VAT": đã xuất sẽ có link, chưa xuất còn nút "Đã xuất hoá đơn".
