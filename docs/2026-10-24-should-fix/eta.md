# Ngày giao dự kiến

Màn thanh toán (web và Mini App) hiện dòng "Giao dự kiến 02/10 – 04/10" ngay trước khi khách bấm Đặt hàng, và lặp lại ở màn đặt thành công. Dòng này chỉ hiện khi chủ shop đã đặt khoảng ngày; chưa đặt thì ẩn hẳn, không hứa ngày nào.

## Việc cần làm

Vào Quản trị, Cấu hình, nhóm shipping và đặt hai khoá:

| Khoá | Ý nghĩa | Ví dụ |
| --- | --- | --- |
| `shipping.eta_min_days` | Số ngày giao nhanh nhất, tính từ hôm nay | `2` |
| `shipping.eta_max_days` | Số ngày giao chậm nhất | `4` |

Ví dụ trên: đặt ngày 30/09 thì khách thấy "02/10 – 04/10". Hai khoá bằng nhau thì hiện một ngày.

## Quy tắc

- Cả hai khoá phải là số nguyên từ 0 đến 60, và max không nhỏ hơn min. Sai một trong các điều kiện (hoặc chỉ đặt một khoá) thì dòng vẫn ẩn.
- Một khoảng chung cho cả nước, chưa tách theo tỉnh. Nếu vùng xa giao lâu hơn, đặt max theo vùng xa nhất.
- Đổi cấu hình có hiệu lực ngay với khách mở màn thanh toán sau đó, không cần deploy.
- Khoá mặc định là trống (seed), nên sau khi deploy mà chưa đặt thì khách chưa thấy dòng này.

## Kiểm tra

Lệnh `go-live:check` trong `apps/api` có dòng "Ngày giao dự kiến" mức WARN khi hai khoá chưa đặt hoặc không hợp lệ, PASS khi đã đặt đúng.
