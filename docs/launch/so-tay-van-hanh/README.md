# Sổ tay vận hành Tubu Tree

Dành cho nhân viên: chủ shop/admin, CSKH, kho, marketing, quản lý đại lý–CTV, kế toán. Mở file của vai trò mình và làm theo từng mục. Đọc hết trang này trước (5 phút).

Viết theo hệ thống ngày 17/10/2026, đối chiếu với mã nguồn. Hai ký hiệu dùng khắp sổ tay:
- **⏳ đang làm**: hệ thống chưa có chức năng này, đang được bổ sung. Làm theo "đường tạm" ghi ngay bên cạnh.
- **(cần xác nhận)**: chưa ai kiểm thực tế. Hỏi chủ shop trước khi làm.

| File | Vai trò |
|---|---|
| [admin.md](admin.md) | Chủ shop / quản trị |
| [cskh.md](cskh.md) | Chăm sóc khách hàng |
| [kho.md](kho.md) | Kho, đóng gói, quầy |
| [marketing.md](marketing.md) | Marketing, nội dung |
| [dai-ly-ctv.md](dai-ly-ctv.md) | Quản lý đại lý, CTV, đối tác |
| [ke-toan.md](ke-toan.md) | Kế toán, đối soát |

## 1. Năm nơi làm việc

| Nơi | Vào bằng | Dùng để |
|---|---|---|
| **Web Quản trị** | `app.tubutree.com/admin`, đăng nhập bằng Zalo | Đơn, đổi/trả, hoàn tiền, rút tiền, người dùng, voucher, cấu hình. Menu trái chia 9 nhóm, 30 mục. Sổ tay ghi tắt **Quản trị › Nhóm › Mục**. Dùng được trên điện thoại, nhưng làm trên máy tính thì dễ hơn. |
| **Mini App Zalo, màn nhân sự** | Mở Mini App › **Cá nhân** › nhóm **Công việc** | Nhân viên: "Ca làm & chấm công", "Lương của tôi". Admin thêm "Quản trị nhân sự": Nhân sự, Duyệt ca, Lương, Kiểm duyệt cộng đồng. |
| **Pancake POS** | Tài khoản Pancake của kho | Sản phẩm, giá, tồn, nhập hàng, in vận đơn, đóng gói, giao hãng, bán tại quầy, đối soát COD. |
| **Cổng người bán** | `app.tubutree.com/merchant` | Của đại lý và đối tác tự bán. Nhân viên không dùng, nhưng phải biết để hướng dẫn họ. Mini App chưa có nút dẫn tới đây. |
| **Zalo OA Manager** | Zalo OA của Tubu Tree | Chat với khách, tin ZNS. Hệ thống chưa thay thế phần chat. |

## 2. Ai thấy tab nào

- **Admin** (vai trò "Quản trị") thấy cả 30 mục.
- **Nhân viên nhóm CSKH** thấy: Việc cần xử lý, Đơn hàng, Đổi / Trả, Người dùng, CSKH mẫu tin nhanh.
- **Nhân viên nhóm Kho** thấy: Việc cần xử lý, Đơn hàng, Đổi / Trả.
- **Mọi nhân viên** thấy thêm: Đổi rác, Màn thu ngân (tích điểm tại quầy), Ca làm & chấm công.
- **Marketing, kế toán, quản lý đại lý–CTV** chưa có nhóm riêng. **⏳ đang làm.** Đường tạm: cấp vai trò "Quản trị" cho đúng người tin cậy. Admin cấp quyền được cho người khác, sửa mọi cấu hình, bấm "Đã chuyển khoản", nên đừng cấp rộng.
- Cấp nhóm: **Quản trị › Khách hàng › Người dùng**, ô "Cấp / đổi vai trò theo SĐT", chọn "Nhân viên". Rồi bấm tên người đó, ô "Nhóm việc nhân viên", tick CSKH hoặc Kho, bấm "Lưu nhóm việc". Nên cho người đó mở Mini App một lần trước, để tìm thấy tên trong danh sách.

## 3. Ranh giới Tubu và Pancake

Pancake là **kho**. Tubu là **cửa hàng online và sổ tiền, điểm, hoa hồng**. Mỗi việc làm đúng một nơi.

| Việc | Làm ở | Có tự về Tubu không |
|---|---|---|
| Tạo, sửa sản phẩm, giá, ảnh, mô tả | Pancake | Có. Hệ thống tự cập nhật mỗi 15 phút, và quét lại toàn bộ lúc 3 giờ 30 sáng. Giá bằng 0 thì sản phẩm bị ẩn. Xoá trên Pancake thì Tubu tắt bán. |
| Nhập hàng, kiểm kho, tồn kho | Pancake | Có. Tồn tự cập nhật cùng nhịp 15 phút. |
| Khách đặt hàng | Tubu (Mini App, web) | Tubu tự đẩy đơn sang Pancake trong khoảng 1 phút. |
| Xác nhận, in vận đơn, đóng gói, giao hãng | Pancake | Có. Trạng thái, hãng, mã vận đơn tự về Tubu. |
| Khách chuyển khoản | Khách quét QR | Pancake tự đối chiếu ngân hàng, đơn tự thành "Đã thanh toán". Dự phòng: nút "Đã nhận tiền" ở Tubu. |
| Huỷ đơn | **Tubu** | Tubu tự huỷ bên Pancake. Đơn đã bàn giao cho hãng vận chuyển thì Tubu không cho huỷ. |
| Đổi/trả, hoàn tiền khách | Tubu (Đổi / Trả, Hoàn tiền khách) | Không đẩy sang Pancake. Phiếu trả hàng ở Pancake tạo bằng tay. |
| Voucher, Flash Sale, Điểm Xanh, hoa hồng CTV, đối soát đối tác | Tubu | Pancake không biết. |
| Danh mục, sản phẩm nổi bật, banner | Tubu | **⏳ đang làm**: chưa có màn. Nhờ kỹ thuật. |
| Hoá đơn VAT | Pancake hoặc phần mềm hoá đơn điện tử | Ghi nhận ở Tubu bằng nút "Đã xuất hoá đơn". Nếu hoá đơn xuất từ Pancake, Pancake báo về và Tubu tự ghi (cần xác nhận shop có bật hoá đơn trên Pancake). |
| Đối soát COD với hãng vận chuyển | Pancake | Tubu chỉ hiện số "COD chưa thu". |

## 4. Những gì KHÔNG về Tubu, và hậu quả

1. **Sửa địa chỉ, thêm bớt món, đổi tổng tiền của đơn trên Pancake.** Tubu giữ số cũ. Khách thấy sai địa chỉ và sai tổng. Hoàn tiền, hoa hồng, đối soát tính theo số cũ. Khi **tổng tiền** trên Pancake khác tổng của Tubu, đơn tự vào hàng đợi "Cần xử lý Pancake" với lý do "Tổng tiền Pancake lệch với Tubu" kèm số lệch. Hệ thống chỉ báo, không tự sửa đơn Tubu. Sửa địa chỉ, hoặc đổi món mà tổng không đổi, thì hệ thống không thấy được.
2. **Đơn tạo thẳng trên Pancake** (khách gọi, chat). Tubu bỏ qua đơn này: không Điểm Xanh, không lịch sử đơn của khách, không hoa hồng CTV, doanh thu app thiếu. Chức năng "Lên đơn hộ" cho CSKH: **⏳ đang làm**.
3. **Khách mua tại quầy trên Pancake POS.** Không vào Tubu. Muốn cộng Điểm Xanh thì dùng Màn thu ngân.
4. **Thông tin khách** (tên, SĐT, ghi chú) nhập trên Pancake. Không về Tubu.
5. **Pancake báo "Hoàn một phần" hoặc "Đã xoá đơn".** Hệ thống không tự xử lý, chỉ đưa đơn vào hàng đợi "Cần xử lý Pancake".

## 5. Quy tắc vàng

1. **Không sửa đơn trên Pancake. Huỷ ở Tubu và đặt lại.** Lỡ sửa rồi và thấy lý do "Tổng tiền Pancake lệch với Tubu": huỷ đơn ở Tubu rồi đặt lại, hoặc trả đơn Pancake về đúng nội dung đơn Tubu (lý do tự biến mất khi Pancake báo lại đơn đúng tổng). Ngoại lệ duy nhất: khi hàng đợi "Cần xử lý Pancake" ghi rõ bảo bạn sửa tay (ví dụ báo đã thu tiền để shipper không thu lần nữa).
2. **Đơn tạo thẳng trên Pancake không tích điểm.** Nói rõ với khách. Chỉ tạo tay khi khách không dùng được app, và khi chủ shop đồng ý (cần xác nhận).
3. **Huỷ đơn ở Tubu**, không huỷ ở Pancake. Chỉ huỷ tay ở Pancake khi Tubu báo "Pancake: chưa huỷ được".
4. **Không giao đơn có ghi chú "CHỜ CHUYỂN KHOẢN … CHƯA GIAO"** trên Pancake. Chờ ghi chú đổi thành "ĐÃ THANH TOÁN".
5. **Chỉ chuyển "Đã nhận" hoặc "Đã thu tiền" trên Pancake khi hàng đã giao thật.** Không bấm hoàn thành hàng loạt. Tubu sẽ cộng Điểm Xanh cho khách, bắt đầu giữ hoa hồng CTV, và đơn không huỷ được nữa.
6. **Sửa sản phẩm, giá, tồn ở Pancake**, không tìm ở Tubu. Chờ tối đa 15 phút.
7. **Tubu chỉ ghi sổ tiền.** Hoàn tiền, rút tiền, đối soát: chuyển tiền thật ở ngân hàng rồi mới bấm "Đã chuyển khoản".
8. **Hoàn một phần: dùng Đổi / Trả**, không hoàn tay. Hệ thống tự tính tiền và điểm.
9. **Không dán mã đơn Tubu (TUBU…) vào đơn Pancake tạo tay.** Hệ thống sẽ nhầm đơn.
10. **Không sửa thẳng dữ liệu hệ thống.** Thấy số sai thì chụp màn hình, ghi mã đơn, gọi kỹ thuật.

## 6. Khi hệ thống lỗi

- Mở **Quản trị › Cài đặt › Sức khoẻ hệ thống**, bấm "Làm mới". Đỏ quá 15 phút, hoặc "Tin báo lỗi chưa xử lý" (tin Pancake báo về bị lỗi) lớn hơn 0 và không tự về 0 sau 10 phút: gọi kỹ thuật. Người phụ trách kỹ thuật: ____________
- Số tiền sai, tiền trừ hai lần, ví âm: ngừng thao tác, chụp màn hình, gọi kỹ thuật và chủ shop.
- Pancake không vào được: người phụ trách Pancake: ____________

Hướng dẫn thử đơn thật trước ngày mở bán: [../pilot-order-playbook.md](../pilot-order-playbook.md). Danh sách việc còn làm ngoài hệ thống: [../../2026-10-18-launch-review/D1-ops-admin.md](../../2026-10-18-launch-review/D1-ops-admin.md).
