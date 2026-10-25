# Sổ tay Quản lý đại lý, CTV, đối tác

Bạn duyệt đại lý và sản phẩm đối tác, theo dõi thưởng, đơn đối tác, lập phiếu đối soát, trả lời CTV và đại lý. Đọc [README](README.md) trước.
Ký hiệu: **⏳ đang làm** = chưa có chức năng, làm theo đường tạm. **(cần xác nhận)** = chưa kiểm thực tế.

Bạn dùng: web **Quản trị** (nhóm Người bán, Đơn hàng & giao vận). Chưa có nhóm quyền riêng (**⏳ đang làm**): bạn đang dùng vai trò "Quản trị", thấy cả màn tiền bạc. Đừng bấm vào màn của kế toán.
Chuyển tiền thật ở ngân hàng là việc của [kế toán](ke-toan.md).

## Ba loại người bán

| Loại | Đăng ký | Hưởng gì | Làm ở đâu |
|---|---|---|---|
| **CTV** | Mini App › **Cá nhân › Hợp tác › Cộng tác viên**, tick điều khoản, xong ngay. Không ai duyệt. | Hoa hồng trên đơn khách mua qua mã hoặc gian hàng của CTV | Mini App. Tubu giao hàng. |
| **Đại lý** | Mini App › **Cá nhân › Hợp tác › Đăng ký đại lý**, nộp hồ sơ và ảnh CCCD hai mặt. Bạn duyệt. | Mua sỉ theo bậc. Thưởng theo doanh số. | Mini App › **Cá nhân › Hợp tác › Kênh đại lý** (bảng giá sỉ, công nợ). |
| **Đối tác tự giao** | Đại lý được duyệt hoặc admin bật "Bật đối tác" | Tiền hàng trừ phí sàn (mặc định 15%) | Cổng người bán `app.tubutree.com/merchant`, đăng nhập Zalo trên web |

Mini App chưa có nút dẫn tới Cổng người bán. Gửi link cho đối tác khi họ được duyệt.

## Đầu ca

1. **Quản trị › Tổng quan › Việc cần xử lý.** Thẻ của bạn: "Hồ sơ đại lý", "Thưởng đại lý", "Sản phẩm đối tác", "Liên kết ký gửi", "Đơn đối tác quá hạn", "Gian hàng có khoản chờ lập phiếu". Bấm thẻ để mở màn.
2. Thẻ "Hoàn tiền khách", "Lệnh rút tiền", "Phiếu đối soát chờ chuyển / thu" là của kế toán. Không làm thay.

## Trong ca

**Duyệt hồ sơ đại lý.** **Quản trị › Người bán › Đại lý** (mở sẵn bộ lọc chờ duyệt, hồ sơ cũ nhất trên cùng).
1. Đọc tên doanh nghiệp, người đại diện, SĐT, địa chỉ. Mở ảnh "CCCD trước", "CCCD sau": đối chiếu tên với người đại diện. Hệ thống không tự kiểm, bạn kiểm bằng mắt.
2. Chọn bậc ở ô bậc đại lý, bấm "Duyệt". Chưa chọn bậc thì nút bị mờ.
3. Không duyệt thì bấm "Từ chối". Lý do ghi lại luôn là "Không đạt yêu cầu", chưa nhập lý do riêng được. Nên gọi đại lý giải thích.

Bậc mặc định (đổi chiết khấu, hạn mức: nhờ kỹ thuật, **⏳ đang làm**):

| Bậc | Giảm giá sỉ | Hạn mức nợ | Thanh toán |
|---|---|---|---|
| Đại lý Cấp 1 | 20% | 0 | Trả trước |
| Đại lý Cấp 2 | 30% | 20 triệu | NET 15 |
| Đại lý Cấp 3 | 38% | 50 triệu | NET 30 |
| Đại lý VIP | 45% | 150 triệu | NET 30 |

Chưa có màn nhập bảng giá sỉ riêng cho từng đại lý và chưa có danh sách đại lý kèm công nợ từng người (**⏳ đang làm**). Màn **Người bán › Lịch sử giá đại lý** chỉ để xem. Hệ thống **không** tự kiểm đơn sỉ tối thiểu, **không** tự nhắc nợ quá hạn NET, và phí giao đơn sỉ luôn bằng 0 (**⏳ đang làm**, chờ chủ shop quyết). Đường tạm: ghi sổ riêng ngày đến hạn của từng đại lý, gọi nhắc trước hạn.

Sau khi duyệt, nhắn đại lý: mở **Kênh đại lý**, xem bảng giá sỉ, đặt hàng, xem công nợ. Muốn bán online: vào Cổng người bán.

**Thưởng đại lý.** **Người bán › Thưởng đại lý.** Đại lý đạt mốc doanh số quý hoặc năm sẽ gửi yêu cầu (trong 30 ngày sau khi kỳ kết thúc). Mở yêu cầu "Đang chờ duyệt": bấm "Duyệt", hoặc "Từ chối" (bắt buộc ghi lý do, đại lý đọc được). Trao thưởng (tour, quà) ngoài hệ thống, rồi bấm "Đã trao thưởng". Từ chối nhầm: bấm "Mở lại". Lỗi doanh số tụt dưới mốc (có đơn huỷ/trả sau khi gửi) hiện nguyên văn: đọc, giải thích cho đại lý. Thưởng quý trừ thẳng vào công nợ.

**Duyệt sản phẩm đối tác.** **Người bán › Duyệt SP đối tác.** Đọc tên, mô tả, thành phần, chứng nhận, tiêu chí xanh, ảnh. Bấm "Duyệt xuất bản" (sản phẩm mới) hoặc "Duyệt bản sửa". Không đạt thì ghi lý do rồi bấm "Từ chối". Khách vẫn thấy bản cũ cho tới khi bạn duyệt bản sửa.
- Sản phẩm "Tubu giao hộ" (đối tác dùng mã Pancake của Tubu): màn hiện hộp so sánh với sản phẩm đang bán. Đọc, tick "Tôi đã xem sản phẩm đang bán… đồng ý chuyển", rồi duyệt. Biến thể sẽ chuyển sang gian hàng đối tác.
- Mở mục "Liên kết chờ xác nhận hàng ký gửi" (chip **"Chờ xác nhận ký gửi"**). Đối chiếu tồn trên Pancake trước. Chỉ bấm "Xác nhận ký gửi" khi đúng là hàng ký gửi của đối tác, không phải hàng Tubu đã mua. Đơn từ mốc đó mới vào đối soát.
- Gỡ liên kết: bấm "Gỡ liên kết", ghi lý do gửi đối tác. Biến thể về sản phẩm gốc, sản phẩm đối tác ngừng bán.

**Theo dõi đơn đối tác.** **Đơn hàng & giao vận › Đơn đối tác & đối soát.** Bảng "Gian hàng đối tác" và "Đơn quá hạn". Hạn mặc định: xác nhận 24 giờ, gửi hàng 48 giờ, giao xong 7 ngày. Hệ thống tự nhắc đối tác mỗi giờ. Đơn quá hạn: gọi đối tác. Quá hạn nhiều: báo chủ shop.

**Lập phiếu đối soát.** Cùng màn. Tiền chỉ vào bảng kê 7 ngày sau khi giao đơn (bằng hạn đổi/trả). Mỗi gian hàng: bấm "Xem khoản" để xem, "Lập phiếu đối soát" để tạo phiếu (nút mờ nghĩa là chưa có khoản). "Sửa phí" đổi "Phí sàn riêng (%)" hoặc phí Tubu giao hộ cho từng gian hàng. Nên lập phiếu mỗi tuần (gợi ý, chủ shop quyết). Kế toán chuyển tiền và bấm "Đã chuyển". Phiếu lập nhầm: "Huỷ phiếu", ghi lý do (đối tác đọc được). Đơn COD đối tác tự thu thì phiếu âm: đối tác nộp lại Tubu trong 7 ngày, kế toán bấm "Đã thu".

**CTV: luật hoa hồng (nói đúng với CTV).**
- Hoa hồng tính theo từng sản phẩm. Hiện **chưa nhập được %** (**⏳ đang làm**) nên mọi sản phẩm thật cho 0đ. Xem "Xử lý tình huống".
- Ghi công đơn theo thứ tự: mã giới thiệu khách nhập, rồi gian hàng CTV khách đang xem, rồi lần bấm link CTV trong 7 ngày gần nhất.
- Đơn "Đã giao hàng" thì hoa hồng ở trạng thái "Đang chờ · đang giữ" trong 10 ngày (hoặc hết hạn đổi/trả nếu dài hơn). Sau đó thành "Có thể rút". Khách trả hàng thì hoa hồng bị thu hồi.
- Hoa hồng chỉ chuyển vào **Ví Tubu**: có ngay. Ví Tubu chỉ dùng để trả tiền hàng, không rút về ngân hàng. Lệnh rút ngân hàng tạo từ trước vẫn đi qua "Chờ duyệt", "Đã duyệt · chờ chuyển", "Đã chuyển" (kế toán xử lý cho xong), không tạo lệnh mới.
- Các lần chuyển hoa hồng vào Ví trong cùng một tháng (giờ Việt Nam) được cộng dồn. Khi tổng từ 5.000.000đ trở lên (Nghị định 253/2026/NĐ-CP), thuế TNCN 10% tính trên tổng tháng; thuế của các lần chuyển trước trong tháng chưa bị trừ sẽ được trừ bù vào lần chuyển sau (tối đa bằng số tiền lần chuyển đó, phần còn thiếu dồn sang lần kế tiếp). Nếu một lệnh rút trong tháng bị từ chối làm tổng tháng giảm, phần thuế đã giữ dư ở các lệnh khác được tự hoàn: lệnh đang chờ duyệt tăng số thực nhận, lệnh đã duyệt hoặc đã chi được cộng vào Ví Tubu (dòng "Hoàn thuế TNCN giữ dư"). CTV khai mã số thuế hoặc CCCD một lần.

**Danh sách CTV và doanh số.** Chưa có màn "CTV" (**⏳ đang làm**). Đường tạm: **Khách hàng › Người dùng › Xuất CSV người dùng**, lọc cột "Vai trò". Doanh số từng CTV chưa có. Hỏi kỹ thuật khi cần.

**Gian hàng CTV.** CTV đăng ký xong có trang công khai ngay, có dấu tích xanh và "100% Chính hãng". Không ai duyệt, bạn không gỡ được, và khoá tài khoản không ẩn gian hàng (**⏳ đang làm**). Phát hiện gian hàng vi phạm: chụp màn hình, gửi kỹ thuật gỡ. Tên miền con `ten-ban.tubutree.com` chưa chạy: đừng hứa với CTV.

**Content Kit, Academy cho CTV:** marketing soạn. Xem [marketing.md](marketing.md).

## Cuối ca

1. Các thẻ của bạn đã hết chưa. Còn thì ghi người nhận ca sau.
2. Đại lý nào đến hạn nợ trong 3 ngày tới: nhắn nhắc.

## Hằng tuần

- Lập phiếu đối soát cho các gian hàng có khoản.
- Rà "Đơn quá hạn", nhắc đối tác.
- Rà hồ sơ đại lý chờ duyệt quá 3 ngày.
- Tra "Công nợ đại lý": mở chi tiết bất kỳ đơn của đại lý đó (**Đơn hàng**), cuộn tới khối "Công nợ đại lý". Đại lý nào nợ quá hạn, báo chủ shop.
- Xuất CSV người dùng, đếm CTV mới.

## Xử lý tình huống

**CTV hỏi "hoa hồng sao bằng 0đ".** Đúng: hệ thống chưa nhập % hoa hồng (**⏳ đang làm**). Không hứa số tiền. Không tự bù đơn đã giao trước đó (cần xác nhận khi có % thì có bù không). Báo chủ shop. Chưa mời thêm CTV khi chưa sửa xong.

**CTV hỏi vì sao chưa rút được.** Mở **Cá nhân › Hợp tác › Cộng tác viên**. "Đang chờ · đơn chưa giao": khách chưa nhận hàng. "Đang giữ": chờ đủ 10 ngày. "Có thể rút": chuyển được vào Ví Tubu. Đơn bị trả thì hoa hồng mất.

**CTV nói khách mua nhưng không có hoa hồng.** Hỏi khách có nhập mã không, có mở link của CTV trong 7 ngày không. Chưa có công cụ tra người giới thiệu của một đơn hay gán lại (**⏳ đang làm**). Ghi mã đơn và tên CTV, gửi kỹ thuật.

**CTV hỏi lệnh rút ngân hàng cũ chưa nhận.** Chỉ còn lệnh tạo trước khi bỏ rút ngân hàng. Hỏi trạng thái: "Chờ duyệt" hoặc "Đã duyệt · chờ chuyển" nghĩa là kế toán chưa chuyển. Báo kế toán theo tên CTV và số tiền. CTV muốn rút tiền mới về ngân hàng: không có, hoa hồng chỉ vào Ví Tubu để trả tiền hàng.

**Khách có tiền trong Ví xin xoá tài khoản.** Khách phải đồng ý bỏ số dư Ví (tick đồng ý, số dư hiển thị đúng lúc gửi). Hệ thống trừ Ví về 0 bằng bút toán điều chỉnh khi xoá. Khách chưa đồng ý hoặc lệch số: quản trị báo "khách chưa đồng ý bỏ số dư Ví", CSKH gọi khách xin đồng ý rồi khách gửi lại yêu cầu. Còn đơn đã giao trong hạn đổi/trả cũng bị chặn xoá, quản trị ghi ngày hết hạn sớm nhất.

**CTV hỏi thuế.** TNCN 10% tính trên tổng hoa hồng chuyển vào Ví trong tháng khi tổng từ 5.000.000đ. Số này hiện sẵn trên màn chuyển vào Ví. Chứng từ khấu trừ: hỏi kế toán (cần xác nhận).

**Đại lý lên đại lý rồi không thấy màn hoa hồng.** Lỗi đã biết (**⏳ đang làm**). Hoa hồng vẫn cộng nhưng chưa xem và rút được. Ghi tên đại lý, gửi kỹ thuật.

**Đại lý nói "đã chuyển khoản trả nợ".** Nút "Báo đã CK" của đại lý chỉ gửi thông báo, **không trừ nợ**. Nợ chỉ giảm khi kế toán đối chiếu sao kê và bấm "Xác nhận đã nhận, giảm nợ" ở khối "Công nợ đại lý". Báo kế toán.

**Đại lý đặt hàng mà thiếu hàng.** Đơn hiện "Pancake: chờ đủ hàng", chưa lên kho. Đơn lên Pancake khi đủ hàng. Báo đại lý chờ.

**Đối tác hỏi bao giờ nhận tiền.** Khoản vào bảng kê sau 7 ngày kể từ khi giao. Bạn lập phiếu, kế toán chuyển. Nói đúng mốc, không hứa ngày.

**Đối tác nhận hàng trả.** Hàng trả của đơn đối tác tự giao về đối tác, không về kho Tubu. Đối tác tự bấm nhận ở Cổng người bán, mục "Hàng trả về". Khoản đã quyết toán bị trừ ở kỳ sau.

**Đại lý hỏi bán lại hàng Tubu trên gian hàng của mình.** Hiện Tubu giao và thu tiền, đại lý không được ghi công (**⏳ đang làm**, chờ chủ shop chốt mô hình). Không hứa lợi nhuận.
