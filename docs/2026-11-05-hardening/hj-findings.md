
## Ghi chú rollback: web cũ + API mới

Nếu quay web về bản trước gói hj mà giữ API mới: form tạo chiến dịch của web cũ tạo thẳng chiến dịch đang bật với đích CAMPAIGN_PAGE chưa có sản phẩm, API trả 400 PAGE_EMPTY. Cách xử lý: tạo chiến dịch ở trạng thái tắt, gắn sản phẩm hoặc mã, rồi bật.

Web cũ cũng gặp 400 ở các ca sau, vì web cũ lưu chiến dịch (PATCH) trước rồi mới gắn sản phẩm/mã:
- Sửa chiến dịch đang tắt, bật lên kèm thêm sản phẩm: 400 ở bước 1, chưa ghi gì.
- Gia hạn chiến dịch đã hết hạn kèm thêm sản phẩm: 400 ở bước 1, chưa ghi gì.
- Đổi đích sang CAMPAIGN_PAGE kèm thêm sản phẩm: 400 ở bước 1, chưa ghi gì.
- Thay toàn bộ sản phẩm bằng món ẩn cùng mã trên trang đang chạy: hỏng giữa chừng (PATCH đã ghi, PUT sản phẩm bị từ chối).

Cách lách chung: lần 1 lưu tắt (hoặc giữ ngày và đích cũ) và gắn sản phẩm/mã; lần 2 mới bật, gia hạn hoặc đổi đích.

Ngược lại (web mới + API cũ) thì panel kiểm gọi `POST /admin/campaigns/check` sẽ 404; panel ở trạng thái lỗi không khoá nút lưu, danh sách không có `health` thì coi như 0/0.
