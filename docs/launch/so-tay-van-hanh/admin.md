# Sổ tay Admin / chủ shop

Bạn thấy mọi màn. Việc của bạn: giữ cho hàng đợi trống, giao việc đúng người, giữ quyền truy cập gọn, canh tiền. Đọc [README](README.md) trước.
Ký hiệu: **⏳ đang làm** = chưa có chức năng, làm theo đường tạm. **(cần xác nhận)** = chưa kiểm thực tế.

Bạn dùng: web **Quản trị** (`app.tubutree.com/admin`), Mini App (**Cá nhân › Công việc › Quản trị nhân sự**), Pancake khi cần xem.

## Đầu ca (10 phút)

1. Mở **Quản trị › Tổng quan › Việc cần xử lý**. Trang tự làm mới mỗi phút. Thẻ có số lớn hơn 0 là việc đang chờ. Bấm thẻ để mở đúng màn. Dòng "Đang trống" là hàng đợi đã sạch.
2. Giao việc theo thẻ:

| Thẻ | Giao cho | Màn mở ra |
|---|---|---|
| Cần xử lý Pancake, Đơn chưa lên Pancake, Cần xử lý thu gom | Kho | Đơn hàng (đã lọc sẵn) |
| Yêu cầu đổi / trả chờ duyệt | CSKH | Đổi / Trả |
| Hàng trả chờ nhận về kho | Kho | Đổi / Trả |
| Hoàn tiền khách, Lệnh rút tiền chờ duyệt, Phiếu đối soát chờ chuyển / thu | Kế toán | Hoàn tiền khách, Duyệt yêu cầu rút tiền, Đơn đối tác & đối soát |
| Hồ sơ đại lý, Thưởng đại lý, Sản phẩm đối tác, Liên kết ký gửi, Đơn đối tác quá hạn, Gian hàng có khoản chờ lập phiếu | Quản lý đại lý–CTV | Đại lý, Thưởng đại lý, Duyệt SP đối tác, Đơn đối tác & đối soát |
| Đổi vỏ chai chờ duyệt | Nhân viên bất kỳ | Đổi vỏ chai |

3. Mở **Quản trị › Cấu hình & tích hợp › Sức khoẻ hệ thống**, bấm "Làm mới". Phải thấy: Pancake "Đã cấu hình"; "Đồng bộ danh mục" có giờ gần đây và không có chữ lỗi; "Webhook lỗi chưa xử lý" (tin Pancake báo về bị lỗi) bằng 0. Đỏ quá 15 phút: gọi kỹ thuật.
4. Hệ thống tự gửi email báo động khi đơn kẹt hoặc Pancake lỗi. Mở hộp thư báo động (cần xác nhận email nhận đã cài).

## Trong ca

**Cấp quyền nhân viên**
1. **Quản trị › Khách hàng › Người dùng**, ô "Cấp / đổi vai trò theo SĐT": nhập SĐT, chọn "Nhân viên", bấm "Cấp quyền".
2. Bấm tên người đó, ô "Nhóm việc nhân viên": tick "CSKH" hoặc "Kho", bấm "Lưu nhóm việc". Không tick nhóm nào: người đó chỉ dùng quầy thu ngân, đổi vỏ chai, chấm công.
3. Cấp "Quản trị" chỉ cho người thật sự tin cậy (hộp xác nhận sẽ hỏi lại). Marketing và kế toán hiện phải dùng vai trò này (**⏳ đang làm**: nhóm riêng).
4. Cách khác, trên Mini App: **Quản trị nhân sự › Nhân sự › Thêm**, chọn "Nhân viên" hoặc "Quản trị", bấm "Lưu quyền".

**Khoá tài khoản** (khách bom hàng, lạm dụng voucher): **Người dùng** › bấm "Khoá" cạnh tên › ghi lý do (ít nhất 3 ký tự). Người đó bị đăng xuất ngay. Mở lại bằng "Mở khoá".

**Sửa cấu hình**: **Cấu hình**, kéo xuống "Tất cả tham số (JSON)". Mỗi dòng có tên khoá, mô tả, ô giá trị, nút "Lưu". Khoá liên quan tiền có hộp xác nhận. Giá trị áp ngay cho mọi đơn, ví, điểm. Đổi sai sẽ ảnh hưởng khách thật: hỏi người phụ trách kỹ thuật nếu không chắc.

| Muốn đổi | Tìm khoá |
|---|---|
| Phí ship, ngưỡng miễn phí (mặc định 19.000đ dưới 200.000đ) | `shipping.flat_fee_below_threshold`, `shipping.free_threshold` |
| Số ngày khách được đổi/trả (mặc định 7) | `returns.window_days` |
| Giờ chờ thanh toán chuyển khoản trước khi tự huỷ (mặc định 24) | `orders.pending_payment_ttl_hours` |
| Số ngày giữ hoa hồng CTV (mặc định 10), mức rút tối thiểu (50.000đ) | `affiliate.hold_days`, `affiliate.min_withdraw_bank` |
| Số ngày giữ tiền đối tác trước đối soát (mặc định 7) | `merchant.settlement_hold_days` |
| Hotline hiển thị cho khách | `support.hotline` |
| Bật tích điểm tại quầy | Thẻ "Điểm Xanh — điểm danh & tích điểm tại quầy", công tắc "Bật tích điểm tại quầy (POS)" |

Tiền COD tối đa mỗi đơn là 5.000.000đ, nằm cứng trong hệ thống, không đổi được ở đây.

**Công cụ ở Sức khoẻ hệ thống** (khối "Công cụ vận hành"):
- "Đồng bộ danh mục Pancake": dùng khi vừa sửa giá hoặc sản phẩm trên Pancake và cần thấy ngay. Hộp xác nhận hiện, bấm "Đồng bộ".
- "Tính lại số đã bán": dùng khi số "đã bán" của sản phẩm trông sai.
- **Không** bấm "Đồng bộ + ghi đè tồn kho" nếu kỹ thuật chưa bảo.

**Nhân sự trên Mini App** (**Quản trị nhân sự**): tab "Duyệt ca" (Duyệt, Từ chối, "Duyệt tất cả"), tab "Lương" (Chốt, Đã chuyển, Mở lại, Đơn giá). Duyệt ca và lương chưa có trên web (**⏳ đang làm**). Chấm công đang chạy: **Quản trị › Nhân sự › Chấm công**, nút "Chốt ra ca".

**Bài cộng đồng chờ duyệt**: Mini App › **Quản trị nhân sự** › nút "Kiểm duyệt cộng đồng" (tab Chờ duyệt, Báo cáo, Sự kiện). Chỉ admin duyệt được, và chưa có trên web hay trong "Việc cần xử lý" (**⏳ đang làm**). Đường tạm: mở màn này 2 lần mỗi ngày.

## Cuối ca

1. Mở lại **Việc cần xử lý**. Còn thẻ nào, ghi tên người nhận bàn giao.
2. Xem **Tổng quan › Tổng quan KPI**: "Doanh thu đã thu", "COD chưa thu", số đơn chờ xử lý, số lệnh rút chờ duyệt. Các số này là cộng dồn từ đầu, không chọn được ngày.
3. Doanh thu theo ngày, theo kênh, theo sản phẩm, theo CTV: **⏳ đang làm**. Đường tạm: **Đơn hàng**, chọn "Từ ngày … đến …", bấm "Xuất CSV (Excel)", lọc tiếp trong Excel. File chưa có cột nền tảng, nguồn, CTV giới thiệu, và chưa có từng dòng hàng.

## Hằng tuần

- Xuất CSV đơn cả tuần, đưa kế toán.
- Mở **Duyệt ca** trên Mini App, duyệt hết ca tuần đó. Cuối tháng: chốt lương.
- Mở **Voucher** xem mã nào còn chạy, mã nào hết lượt. Tắt mã bị lộ bằng "Tắt mã".
- Rà danh sách nhân viên: ai nghỉ thì thu hồi quyền ngay.
- Gọi hỏi kỹ thuật về các việc ⏳ ở cuối trang này.

## Xử lý tình huống

| Tình huống | Làm |
|---|---|
| Nhân viên nghỉ việc | Mini App: **Quản trị nhân sự › Nhân sự › Thu hồi** (hộp xác nhận hỏi lại). Hoặc web: ô "Cấp / đổi vai trò theo SĐT", chọn "Khách hàng". |
| Khách chuyển khoản, sao kê đã có tiền, đơn vẫn "Chờ thanh toán" quá 15 phút | **Đơn hàng** › mở đơn › "Đã nhận tiền", ghi mã giao dịch. Chỉ bấm khi đã thấy tiền về tài khoản. Không hoàn tác được. |
| Đơn đã giao nhưng khách không thấy điểm | Mở đơn › "Chạy lại việc sau giao" (nút chỉ hiện khi đơn đã giao mà chưa xong việc sau giao). Chạy lại an toàn, không cộng hai lần. |
| Đã sửa giá trên Pancake, Tubu chưa đổi | Chờ 15 phút, hoặc "Đồng bộ danh mục Pancake". |
| Khách khoá nhầm | **Người dùng** › "Mở khoá". |
| CTV báo hoa hồng 0đ | Đúng: chưa nhập được % hoa hồng (**⏳ đang làm**). Xem [dai-ly-ctv.md](dai-ly-ctv.md). Chưa mở CTV cho khách thật khi chưa nhập xong. |
| Không đăng nhập được web Quản trị | Web chỉ đăng nhập bằng Zalo. Không có nút hoặc báo lỗi: gọi kỹ thuật (cần xác nhận cấu hình đăng nhập Zalo trên web). |
| Thẻ đỏ ở Sức khoẻ hệ thống, đơn kẹt | Xem mục "Khi hệ thống lỗi" trong [README](README.md). |
| Cần tặng mã đền bù cho một khách | **⏳ đang làm** (mã chỉ tạo được dạng công khai). Đường tạm: tạo Voucher với "Tổng lượt dùng" = 1, gửi mã riêng cho khách. |

## ⏳ Việc đang làm, đường tạm

| Việc | Đường tạm |
|---|---|
| Báo cáo theo ngày, kênh, sản phẩm, CTV | Xuất CSV đơn, làm Excel |
| Nhóm quyền Marketing, Kế toán | Cấp "Quản trị" cho người tin cậy |
| Sửa danh mục, sản phẩm nổi bật, banner | Nhờ kỹ thuật |
| Duyệt ca, lương trên web | Dùng Mini App |
| Nhật ký thao tác chung | Xem "Lịch sử trạng thái" trong từng đơn |
| Chọn nhiều dòng rồi duyệt hàng loạt | Duyệt từng dòng |
| Cảnh báo sản phẩm sắp hết hàng | Xem tồn trên Pancake |
