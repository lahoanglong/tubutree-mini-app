# Gói qd khach: nhiệm vụ đơn đầu của CTV, tin xác nhận đơn đã thanh toán, mốc nhãn Mới

Gốc: main d915f19b5. Đọc kỹ luật chung `tools/brief-worker.md`. Gói đụng điểm thưởng và tin gửi khách nên phải có race spec, và được thêm migration.

## E-47: nhiệm vụ "Đơn hàng đầu tiên" của gian hàng CTV

Chủ chốt: "nhiệm vụ 'Đơn hàng đầu tiên' (5.000 điểm) chỉ tính đơn đã giao do chính khách đặt; không tính đơn CTV đặt hộ."

Hiện trạng:
- `apps/api/src/modules/storefront/storefront-quest.service.ts`: quest `first_order` (khoảng :61-67) đo `s.firstOrder`.
- Đợt trước đã loại hoa hồng REJECTED.
- Tìm chỗ tính `firstOrder` và cách hệ thống đánh dấu đơn CTV đặt hộ (đơn hộ, đặt thay khách). Grep `proxy`, `placedBy`, `onBehalf`, `đơn hộ` trong affiliate/checkout/orders. CHỈ ĐỌC `affiliate.service.ts`, không sửa: file này của phiên khác.

Luật mới:
- Chỉ tính đơn gắn với gian hàng hoặc mã của CTV, đã ở trạng thái DELIVERED, và do chính khách đặt.
- Không tính: đơn CTV đặt hộ, đơn huỷ, đơn trả (RETURNED), đơn chưa giao.
- Thưởng đã cấp theo luật cũ thì giữ nguyên, không thu hồi.
- Câu gợi ý (hint) của nhiệm vụ sửa cho khớp luật, ngắn gọn. Ví dụ: "Chia sẻ link, khi khách tự đặt và nhận hàng thành công bạn nhận thưởng!"
- Nhiệm vụ đạt sau khi đơn giao xong. Kiểm tra cấp thưởng vẫn idempotent: một CTV chỉ nhận một lần, kể cả khi có nhiều đơn giao cùng lúc.

Test:
- Unit cho hàm đo.
- Race spec cho các ca:
  - đơn khách tự đặt đã giao: đạt;
  - đơn hộ đã giao: không đạt;
  - đơn chưa giao, huỷ, trả: không đạt;
  - hai đơn giao cùng lúc: thưởng một lần.

## E-88: tin ORDER_CONFIRMED cho đơn đã thanh toán trước

Chủ chốt: "tin ORDER_CONFIRMED của đơn chuyển khoản đổi thành 'Tubu Tree đã nhận đủ thanh toán'; đơn COD giữ chữ cũ."

Hiện trạng:
- `apps/api/prisma/seed.ts:762` có mẫu `nt-confirmed`, mã `ORDER_CONFIRMED`, kênh ZNS nhưng chưa có `zaloTemplateId`. Thân mẫu: `Đơn {{order_code}} đã được xác nhận. Cảm ơn bạn đã mua sắm tại Tubu Tree 🌿`.
- Đơn chuyển khoản được xác nhận khi đánh dấu đã trả (`orders/order-status.service.ts` khoảng :720-742, chuyển PENDING_PAYMENT sang CONFIRMED).
- Biến tin khai ở `notifications/notification-variables.ts`.

Luật mới:
- Thêm biến, ví dụ `payment_note`.
  - Đơn có `paymentStatus = PAID` tại lúc gửi ORDER_CONFIRMED: biến là " Tubu Tree đã nhận đủ thanh toán." Gồm chuyển khoản, và cả ZaloPay nếu có vì cũng là trả trước. Ghi lựa chọn này vào báo cáo.
  - Đơn COD: biến rỗng.
- Thân mẫu mới: `Đơn {{order_code}} đã được xác nhận.{{payment_note}} Cảm ơn bạn đã mua sắm tại Tubu Tree 🌿`.
  - Sửa seed.
  - Migration chỉ cập nhật mẫu khi thân trên DB còn đúng bằng câu cũ (theo mẫu `20261029040001_commission_reversed_template_neutral`).
  - Kiểm bộ dựng tin xử lý biến rỗng không để thừa khoảng trắng hay dấu chấm.
- KHÔNG sửa `notifications.service.ts` (của phiên khác). Biến phải được truyền từ chỗ gọi gửi ORDER_CONFIRMED (checkout, order-status, zalopay, dealer: grep `ORDER_CONFIRMED`). Nếu buộc phải sửa file đó thì để `skipped` và ghi cách làm.
- Không gửi thêm tin nào. Không đổi kênh. Không động tới ZNS (mẫu chưa có zaloTemplateId). Báo cáo ghi: khi chủ đăng ký mẫu ZNS sau này, câu ZNS phải có cả hai dạng.

Test:
- Unit dựng tin cho đơn PAID và COD.
- Test migration: chỉ cập nhật khi thân còn là câu cũ.
- Race spec đang có cho luồng đánh dấu đã trả: chạy lại, và thêm một kiểm câu nếu dễ.

## Nhãn "Mới": mốc ngày mở bán

Chủ chốt: "PROD 30/10 có 111/111 SP đang bán tạo ngày 2026-10-25, nên thêm mốc cấu hình 'ngày mở bán': SP tạo trước mốc không gắn Mới."

Hiện trạng:
- `packages/app-core/src/product-badges.ts`: `isNewProduct(createdAt, now)` trả "Mới" cho sản phẩm tạo trong 30 ngày.
- Nơi dùng: web `components/mini/product-tile.tsx`, `components/new-product-badge.tsx`; Mini `components/ui/product-tile.tsx`.

Luật mới:
- Thêm khoá cấu hình công khai, ví dụ `catalog.launch_date`: chuỗi `YYYY-MM-DD`, hiểu theo giờ Việt Nam, hoặc rỗng/null.
  - Giá trị mặc định là rỗng: hành vi giữ như cũ cho tới khi chủ đặt ngày.
  - Validator chỉ nhận ngày hợp lệ hoặc rỗng.
- Sản phẩm tạo trước 00:00 giờ VN của ngày mở bán thì không gắn "Mới". Sản phẩm tạo từ mốc trở đi theo luật 30 ngày như cũ.
- `isNewProduct` nhận thêm tham số mốc, tuỳ chọn. Hai nền đọc mốc từ public config đã tải sẵn, không thêm lời gọi API.
- Admin đặt mốc ở trang cấu hình hiện có. Mô tả khoá phải nói rõ ý nghĩa.

Test: vitest app-core (trước, đúng, sau mốc; mốc rỗng; mốc sai dạng), vitest tile hai nền, validator, `reference-seed.race-spec.ts`.

## Báo cáo thêm cho chủ
- Câu tin mới của ORDER_CONFIRMED.
- Khoá `catalog.launch_date` và việc chủ đặt ngày mở bán sau deploy.
- Câu gợi ý mới của nhiệm vụ đơn đầu.
