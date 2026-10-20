# Lane mv-success: màn đặt hàng thành công ở điện thoại

Nguồn so: `apps/miniapp/src/components/checkout/order-success.tsx`. Bản `uat/int` (4d71b653) giống hệt main, không có chữ nào khác.
Web: `apps/web/src/components/checkout/order-success.tsx` (mới), gọi từ `app/thanh-toan/page.tsx` khối `if (placed)`. Dưới md vẽ như Mini App (khối `md:hidden`), từ md giữ màn máy tính (khối `max-md:hidden`) kèm dòng thông tin mới.

| Khối Mini App (điều kiện hiện) | Web trước | Web sau | Test |
|---|---|---|---|
| Vòng tròn dấu tích, h1 "Cảm ơn bạn đã chọn Tubu", "Đơn hàng của bạn đã được ghi nhận" | h2 "Đặt hàng thành công!" | giống Mini ở < md; md+ giữ "Đặt hàng thành công!" | order-success.spec "lời cảm ơn..." |
| Thẻ Mã đơn hàng, mã in đậm, nút Sao chép mã đơn (báo đã chép / "Không sao chép được — mã đơn: …") | chỉ dòng "Mã đơn X · tổng" | có, báo bằng dòng role=status thay snackbar | "sao chép mã" |
| Tổng thanh toán (hoặc "Tổng N đơn" khi tách, cộng cả lần đặt) | tổng đơn đầu | giống Mini | "lời cảm ơn", "đơn tách" |
| COD: "Chuẩn bị tiền mặt khi nhận hàng" | không có | có (mọi khổ) | "COD" |
| Điểm Xanh sẽ nhận khi pointsEarned > 0 (cộng dồn đơn tách nếu đủ dữ liệu) + dòng "sẽ về tay khi đơn giao thành công" | không có | có (mọi khổ) | "Điểm Xanh" |
| Giao dự kiến khi cấu hình công khai đã tải và có shippingEta | không có | có, dùng `shippingEtaLabel` qua `etaLabel` của trang (cùng query `public-config` trang đã tải); ẩn khi chưa tải/thiếu | "Giao dự kiến" |
| Khối đơn tách (tiêu đề, dòng phụ, từng đơn bấm vào xem) | danh sách link | giống Mini ở < md (nút bấm, aria-label "Xem đơn …"); md+ giữ danh sách link | "đơn tách" |
| 3 bước Tiếp theo | không có | có ở < md | "3 bước" |
| Nút Theo dõi đơn / Tiếp tục mua sắm | Xem chi tiết đơn / Đơn của tôi / Tiếp tục mua sắm | < md như Mini (điều hướng sang chi tiết đơn, trang chủ); md+ giữ ba link | "lời cảm ơn" |
| Gợi ý Đặt định kỳ | không có | CHƯA làm: cần tải sản phẩm + SubscribeSheet, ngoài phạm vi chữ/dòng đã nêu | |
| Tiếp tục mua sắm về gian hàng `/s/<slug>` khi đang ở storefront | về `/` | chưa làm (về `/`) | |

`BankTransferPanel` và điều kiện hiện giữ nguyên; thêm đệm ngang 16px ở điện thoại. Không đổi luồng đặt hàng, body, Idempotency-Key. Màn thành công ở điện thoại ẩn PageHeader "Thanh toán" (Mini không có thanh tiêu đề ở màn này); `Shell bare`.
Sửa `checkout-split.spec.tsx`: chọn `li` trong khối máy tính vì DOM nay có thêm khối điện thoại.

Chụp ảnh: không thêm bước vào tour (tour theo route, màn này là trạng thái sau khi bấm Đặt hàng, cần mock place-order và click qua form); orchestrator chụp bằng luồng `web-checkout.web.spec.ts` ở viewport 375px. Spec e2e giữ nguyên (heading "Đặt hàng thành công!" vẫn là khối máy tính).
Kiểm chứng: vitest web 396 file / 6674 test xanh (cả `TZ=UTC`), tsc, eslint, `next build`, lint:vars, lint:parity xanh. Cần build `packages/shared-types` (tsc) cục bộ để tsc web chạy.
