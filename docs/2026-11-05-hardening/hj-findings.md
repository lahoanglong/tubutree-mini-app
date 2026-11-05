## Ghi chú tương thích khi web và API lệch bản (gói hj)

Gói hj đổi hợp đồng lưu chiến dịch: `POST /admin/campaigns` và `PATCH /admin/campaigns/:id` nhận thêm `productIds` và `couponCodes` (thay hết danh sách trong cùng một giao dịch), mọi đường lưu (POST, PATCH, PUT sản phẩm, PUT mã) dùng chung một luật phán quyết `saveVerdict`, và `POST /admin/campaigns/check` trả thêm `verdict`. Web và API phải lên hoặc quay lại cùng một cặp image (runbook §1.23). Hai trường hợp lệch bản dưới đây chỉ nên kéo dài vài giây lúc deploy.

### Web mới + API cũ (vài giây lúc deploy)

- Lệnh lưu của web mới có kèm `productIds`/`couponCodes` (khi danh sách đổi): API cũ trả 400 vì whitelist từ chối trường lạ. Không ghi gì. Bấm Lưu lại sau khi API lên bản mới là được.
- Khối "Kiểm trước khi bật" gọi `POST /admin/campaigns/check` (API cũ chưa có thì 404, hoặc chưa trả `verdict`): khối hiện trạng thái lỗi/không có phán quyết, nút Lưu KHÔNG khoá (máy chủ quyết lúc lưu). Danh sách không có `health` thì coi như 0/0.

### Web cũ + API mới (quay lại web cũ mà giữ API mới)

Web cũ lưu chiến dịch bằng nhiều lệnh: PATCH/POST trường trước, rồi PUT sản phẩm, rồi PUT mã. API mới áp `saveVerdict` ở TỪNG lệnh:
- Tạo mới đang bật với đích CAMPAIGN_PAGE chưa có sản phẩm hay mã: 400 (trang trống), chưa ghi dòng nào.
- Ba ca dưới đây chỉ xảy ra khi trang chiến dịch HIỆN CHƯA có sản phẩm khách thấy được và chưa có mã dùng được (đã có một trong hai thì bước 1 qua, thêm sau vẫn ổn). Cả ba bị chặn ở bước 1, chưa ghi gì: sửa chiến dịch đang tắt, bật lên kèm thêm sản phẩm; gia hạn chiến dịch đã hết hạn kèm thêm sản phẩm; đổi đích sang CAMPAIGN_PAGE kèm thêm sản phẩm.
- Dời giờ bắt đầu của trang đang chạy kèm thêm mã hoặc sản phẩm: PATCH dời giờ bị 400 ở bước 1 (chưa ghi gì) khi trang chỉ còn mã hết hạn trước mốc bắt đầu mới, vì mã đó không còn dùng được tại mốc mới.
- Thay danh sách của trang đang chạy bằng lệnh PUT riêng: PUT bị 400 khi lệnh đó làm trang thành trống (gỡ sản phẩm cuối mà không còn mã dùng được, hoặc thay mã bằng mã chưa mở mà không còn sản phẩm). Khi đó trường chiến dịch (PATCH) có thể đã ghi còn danh sách chưa đổi: hỏng giữa chừng, mở lại chiến dịch để thấy trạng thái thật.

Cách lách chung: lần 1 lưu ở trạng thái tắt (hoặc giữ ngày và đích cũ) và gắn sản phẩm/mã, luôn giữ ít nhất một món dùng được trên trang đang chạy; lần 2 mới bật, gia hạn, đổi đích hoặc dời giờ.

Mini App không đổi.
