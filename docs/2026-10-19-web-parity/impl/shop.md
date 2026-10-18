# Lane shop: ghi chú sau review lượt 1

## Đã sửa theo review lượt 1

- MAJOR link Trang chủ tới route pending (Cộng đồng, Tư vấn, Định kỳ, chuông): bọc `isWebRouteReady`, có spec mock pending.
- MINOR `/?page=N` chuyển 307 sang `/san-pham?page=N`; bỏ qua host gian hàng CTV bằng `missing: host` (cùng luật `tenant-subdomain.ts`).
- MINOR seed `?page=N` của Danh mục dùng khoá riêng và chỉ khi URL còn đúng trang đó.
- MINOR nút "Thêm vào giỏ" khoá sau khi thêm một phần (tránh nhân đôi số lượng).
- MINOR lời báo "Đã mở nhóm mua chung" qua cờ `?moi=1` (gỡ ngay sau khi hiện).
- MINOR `create.reset()` của SubscribeSheet khi đóng/mở.

## Câu hỏi cho chủ dự án và người tích hợp

1. Web chưa có tầng analytics (không có `trackEvent` hay endpoint `/analytics`). Mini App gửi `search_performed`, `search_result_clicked`, `filter_applied` ở `browse.tsx`. Web có cần gửi ba sự kiện này không, và gửi tới endpoint nào? Mặc định: không gửi gì cho tới khi có quyết định.
2. Hai bản mua lại song song: lane shop có `components/reorder/*` (PurchasedRail, ReorderSheet, useReorder), lane order có bản riêng ở `components/orders/*`. Khi gộp nên giữ một bản và xoá bản kia. Bản shop đã khoá CTA sau khi thêm một phần; bản còn lại cần cùng hành vi (không gửi lại `POST /orders/{code}/repurchase` cho cùng lựa chọn).
