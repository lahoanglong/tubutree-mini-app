
## Ghi chú rollback: web cũ + API mới

Nếu quay web về bản trước gói hj mà giữ API mới: form tạo chiến dịch của web cũ tạo thẳng chiến dịch đang bật với đích CAMPAIGN_PAGE chưa có sản phẩm, API trả 400 PAGE_EMPTY. Cách xử lý: tạo chiến dịch ở trạng thái tắt, gắn sản phẩm hoặc mã, rồi bật. Ngược lại (web mới + API cũ) thì panel kiểm gọi `POST /admin/campaigns/check` sẽ 404; web chỉ hiện panel lỗi, vẫn lưu được.
