# Pháp lý hiển thị cho khách: việc chủ shop phải làm

Nhánh `pb/legal`. Mọi giá trị sửa ở Quản trị, Cấu hình, không cần deploy. Trang web cập nhật trong tối đa 1 giờ (chân trang) và 5 phút (trang chính sách) nhờ bộ nhớ đệm.

## Khoá mới nhóm `company`

| Khoá | Điền gì | Bắt buộc |
|---|---|---|
| `company.legal_name` | Tên pháp lý theo giấy đăng ký kinh doanh | Có (go-live FAIL nếu trống) |
| `company.tax_code` | Mã số thuế | Có (go-live FAIL nếu trống) |
| `company.address` | Địa chỉ trụ sở đã đăng ký | Có (go-live FAIL nếu trống) |
| `company.bct_notice_url` | Link https tới trang đã thông báo với Bộ Công Thương | Không. Trống thì ẩn dòng "Đã thông báo Bộ Công Thương" |

Các dòng được tạo rỗng bởi `seed-reference` (nhóm `company` nằm trong danh sách nạp) và không bao giờ bị seed ghi đè sau khi bạn điền. Tab Cấu hình chỉ liệt kê dòng đã có trong DB, nên cần chạy `seed-reference` một lần sau khi deploy để bốn dòng xuất hiện; `go-live:check` coi dòng thiếu như trống.

## Chỗ hiển thị
- Chân trang web (cả bản đầy đủ và bản gọn trên điện thoại): "Đơn vị vận hành: tên · MST mã · địa chỉ", kèm link Bộ Công Thương.
- Trang Về Tubu Tree trong Mini App: cùng dòng và link.
- Bản nháp 4 trang chính sách trên web: điền vào `[Tên công ty]`, `[Mã số thuế]`, `[Địa chỉ trụ sở]`. Banner "BẢN NHÁP" không đổi: nó chỉ tắt khi bạn dán nội dung đã duyệt vào `legal.*`.
- Trường nào trống thì tự ẩn.

## Khoá có sẵn, nay được dùng để hiển thị
- `returns.window_days` (mặc định 7): dòng "Đổi trả trong N ngày nếu lỗi" ở trang sản phẩm (web và Mini App). Chưa đọc được cấu hình thì hiện "Đổi trả nếu sản phẩm lỗi", không số.
- `shipping.free_threshold` và `shipping.flat_fee_below_threshold` (mặc định 19.000): bản nháp chính sách vận chuyển nay nói đúng quy tắc thật: miễn phí từ ngưỡng, dưới ngưỡng phí cố định, không theo địa chỉ hay khối lượng.

## Kiểm tra
`pnpm go-live:check` trong apps/api có mục mới `db.company_identity` (FAIL khi thiếu tên, MST hoặc địa chỉ).
