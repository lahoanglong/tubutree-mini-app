# Sổ tay Marketing và nội dung

Bạn chạy voucher, Flash Sale, nội dung bán hàng, thông báo, đánh giá, cộng đồng. Đọc [README](README.md) trước.
Ký hiệu: **⏳ đang làm** = chưa có chức năng, làm theo đường tạm. **(cần xác nhận)** = chưa kiểm thực tế.

Bạn dùng: web **Quản trị** (nhóm Khuyến mãi, Nội dung, Khách hàng), Mini App (kiểm duyệt cộng đồng), Pancake (giá, sản phẩm), Zalo OA Manager (gửi tin).
Hiện chưa có nhóm quyền Marketing (**⏳ đang làm**). Bạn đang dùng tài khoản vai trò "Quản trị": thấy mọi màn tiền bạc. Chỉ làm đúng việc trong sổ tay này.

## Đầu ca

1. **Quản trị › Khuyến mãi › Voucher.** Xem danh sách "Mã đã tạo", lọc trạng thái. Mã hết lượt hoặc hết hạn thì tắt hoặc gia hạn. Mã bị lộ ra ngoài: bấm "Tắt mã".
2. **Quản trị › Khuyến mãi › Flash Sale.** Đợt đang chạy có nhãn "Đang bật". Xem số đã bán so với "Số lượng bán (quota)". Đợt sắp hết quota thì quyết định thêm hay dừng.
3. **Quản trị › Khách hàng › Đánh giá.** Lọc "Đang hiện". Đánh giá có chữ xấu, quảng cáo, thông tin cá nhân: bấm "Ẩn đánh giá".
4. Mở Mini App › **Cá nhân › Công việc › Quản trị nhân sự** › "Kiểm duyệt cộng đồng", tab "Chờ duyệt". Duyệt hoặc từ chối bài mới. Chỉ vai trò Quản trị làm được, và chưa có trên web (**⏳ đang làm**). Đường tạm: mở màn này đầu ca và giữa ca.

## Trong ca

**Tạo voucher.** **Voucher** › ô "Mã", chọn loại ("% giảm", "Giảm tiền", "Freeship"), nhập "Giá trị". Điền thêm:
- "Đơn tối thiểu (đ)".
- "Giảm tối đa (đ)". **Mã % phải điền ô này.** Bỏ trống nghĩa là không giới hạn: mã 30% sẽ giảm hàng triệu cho đơn lớn.
- "Tổng lượt dùng" (bỏ trống là không giới hạn) và "Lượt / khách" (mặc định 1).
- Ngày bắt đầu và ngày hết hạn.
Bấm "Tạo voucher". Khách nhập mã ở ô "Nhập mã giảm giá" khi thanh toán, bấm "Áp dụng". Đổi ngày hết hạn ngay trong danh sách. Hệ thống chỉ tạo được mã công khai: mã riêng cho một khách (**⏳ đang làm**). Đường tạm: đặt "Tổng lượt dùng" bằng 1 rồi gửi mã riêng.

**Tạo Flash Sale** (khách thấy tên "Ưu đãi giờ vàng"). **Flash Sale** › "Tạo đợt Flash Sale": "Tên đợt", "Bắt đầu lúc", "Kết thúc lúc", bấm "Tạo đợt". Mở đợt vừa tạo, thêm từng sản phẩm: gõ tên (không cần dấu) hoặc SKU, chọn đúng biến thể, nhập "Giá flash (đ)", "Số lượng bán (quota)", "Giới hạn mỗi khách", bấm "Thêm SP". Có nút "Lưu thay đổi", "Tắt" hoặc "Bật", "Xoá đợt". Hết quota hoặc hết giờ thì khách thấy giá thường. Giá flash chỉ nằm ở Tubu, không đổi giá sản phẩm trên Pancake.

**Đổi giá thường, thêm sản phẩm mới, đổi ảnh, đổi mô tả.** Làm trên **Pancake**, không có ô sửa ở Tubu. Tubu cập nhật mỗi 15 phút. Giá bằng 0 thì sản phẩm bị ẩn. Cần thấy ngay: nhờ admin bấm "Đồng bộ danh mục Pancake".

**Nội dung bán hàng cho CTV.** **Nội dung › Content Kit CTV** › chọn sản phẩm, điền "Bài mẫu (mỗi dòng 1 caption)", "USP / điểm bán hàng (mỗi dòng 1 ý)", "Video URL (mỗi dòng 1 link)", FAQ, bấm "Lưu Content Kit". CTV mở trang sản phẩm trong Mini App, bấm "Nội dung bán hàng" và thấy bài mẫu đã gắn sẵn link giới thiệu của họ. Sản phẩm mới ra: làm Content Kit trong tuần đầu.

**Khoá học cho CTV.** **Nội dung › Academy** › "Tạo khoá học mới": tiêu đề, thứ tự, ảnh bìa, mô tả, "Tạo khoá học". Bấm "Quản lý" để thêm bài (bài viết hoặc video). Khoá ở trạng thái "Nháp" đến khi bấm "Đăng (publish)". CTV thấy trong Mini App mục "CTV Academy".

**Câu hỏi thường gặp.** **Nội dung › Câu hỏi thường gặp** › điền "Nhóm", "Câu hỏi", "Câu trả lời", "Thứ tự hiển thị", bấm "Thêm câu hỏi". Trợ lý tư vấn trong app dùng các câu này để trả lời khách: viết đúng, ngắn, không hứa quá.

**Mẫu thông báo.** **Nội dung › Mẫu thông báo.** Mỗi mẫu có "Kênh": "Trong app" hoặc "ZNS + trong app", "Mã mẫu ZNS" và "Nội dung trong app". Khách chỉ nhận tin Zalo khi mẫu là ZNS **và** có mã mẫu Zalo đã duyệt (duyệt 7 đến 14 ngày). Nhãn "Thiếu mã mẫu ZNS": mẫu đó chỉ hiện khi khách mở app. Duyệt xong mẫu thì nhập mã, bấm "Lưu".

**Nhãn hàng.** **Người bán › Nhãn hàng** › "Tạo nhãn" (tên, tagline). Bấm "Quản lý": "Đăng (publish)" hoặc "Ẩn (chuyển nháp)", "Cấp chính hãng", logo, ảnh bìa, nguồn gốc, câu chuyện thương hiệu. "Gán SP theo tên nhãn" gắn sản phẩm có tên khớp. Chỉ gán được, không sửa được các trường khác của sản phẩm.

**Nhiệm vụ Vườn Xanh.** **Khuyến mãi › Nhiệm vụ & quà đổi điểm.** Sửa tiêu đề, mô tả, "Điểm thưởng" (0 đến mức tối đa), bấm "Lưu". Điểm mới chỉ áp cho lượt nhận sau khi lưu. Danh mục quà đổi điểm cố định: muốn thêm quà hoặc đổi giá điểm, nhờ kỹ thuật.

**Sự kiện cộng đồng.** Màn "Kiểm duyệt cộng đồng" trên Mini App, tab "Sự kiện": nhập tên, mô tả, ảnh bìa, "Thưởng Điểm Xanh" (1 điểm = 1.000đ, tối đa 1.000 điểm), ngày, bấm "Tạo sự kiện". Hết hạn: "Chọn người thắng", "Đóng".

**Báo cáo vi phạm cộng đồng.** Cùng màn kiểm duyệt, tab "Báo cáo": đọc nội dung bị báo, bấm "Ẩn nội dung" nếu vi phạm, rồi "Đã xử lý".

## Cuối ca

1. Mở lại kiểm duyệt cộng đồng: không để bài chờ duyệt qua đêm.
2. **Voucher** và **Flash Sale**: chiến dịch ngày mai đã bật đúng giờ, đúng quota, đúng mã.
3. Ghi lại việc đang chờ kỹ thuật (banner, danh mục) vào danh sách chung.

## Hằng tuần

- Voucher: mã nào đã dùng, mã nào chưa ai dùng. Mã chưa ai dùng thì đổi cách quảng bá.
- **Mẫu thông báo**: còn mẫu "Thiếu mã mẫu ZNS" không, đã xin duyệt chưa.
- Xuất CSV khách để chọn nhóm gửi tin: **Người dùng › Xuất CSV người dùng** (cột Họ và tên, Số điện thoại, Vai trò, Điểm Xanh, Ngày tham gia). Lọc trong Excel, gửi bằng Zalo OA Manager.
- Gom câu khách hỏi lặp lại (từ CSKH) vào "Câu hỏi thường gặp".
- Content Kit và Academy: thêm cho sản phẩm hoặc bài học mới.

## Xử lý tình huống

**Muốn giảm giá một sản phẩm.** Ba cách, chọn một. Giá thường: đổi trên Pancake (giữ lâu dài). Ưu đãi có giờ: Flash Sale. Mã cho cả đơn: Voucher. Đừng chồng ba cách lên cùng sản phẩm trước khi hỏi admin hệ thống cộng dồn thế nào (cần xác nhận).

**Cần banner, sản phẩm nổi bật, danh mục.** **⏳ đang làm**: chưa có màn. Danh mục và sản phẩm nổi bật phải nhờ kỹ thuật. Banner chưa có. Trang chủ tự dựng từ sản phẩm.

**Muốn gửi tin cho nhóm khách.** Chưa có gửi hàng loạt trong Tubu (**⏳ đang làm**). Đường tạm: xuất CSV khách, gửi bằng Zalo OA Manager (cần xác nhận OA có gửi được tin chủ động cho nhóm này).

**Muốn lên lịch đăng nội dung.** Chưa có (**⏳ đang làm**). Đường tạm: đặt nhắc lịch riêng, đăng tay.

**Muốn biết kênh nào ra đơn.** Chưa có báo cáo theo kênh, nguồn khách, hay hiệu quả voucher theo doanh thu (**⏳ đang làm**). Đường tạm: **Đơn hàng › Xuất CSV (Excel)**, xem cột "Giảm giá (VNĐ)", "Tổng tiền (VNĐ)". File không có cột nguồn hay mã voucher.

**Khách khiếu nại voucher không dùng được.** Mở **Voucher**, tìm mã. Kiểm: còn hạn, còn lượt, "Đơn tối thiểu", "Lượt / khách" (khách dùng rồi thì hết). Đúng điều kiện mà vẫn lỗi: gửi mã và ảnh màn hình cho kỹ thuật.

**Tiêu chí duyệt bài cộng đồng.** Chưa có quy định bằng văn bản (cần xác nhận với chủ shop). Gợi ý tạm: từ chối bài quảng cáo, nói xấu, lộ thông tin cá nhân. Duyệt trong ngày. Bài bị từ chối: hệ thống chưa cho ghi lý do gửi tác giả (cần xác nhận).

**Chương trình CTV.** Chưa quảng bá CTV với khách thật khi hoa hồng còn 0đ (**⏳ đang làm**, xem [dai-ly-ctv.md](dai-ly-ctv.md)). Hỏi quản lý đại lý–CTV trước khi đăng.

**Hoàn tiền sàn ngoài ("Hoàn tiền sàn ngoài").** Chức năng này đang tắt với khách trong Mini App. Bỏ qua.
