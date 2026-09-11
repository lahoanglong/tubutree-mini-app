# P0-3 — Pancake sync ghi đè tồn kho: brief để chốt kiến trúc

Trạng thái: **chưa chốt được bằng code** — phụ thuộc 1 sự thật về hệ thống ngoài mà repo không
trả lời được. Tài liệu này gói gọn mọi thứ cần để quyết trong ~15 phút khi có câu trả lời.

## Vấn đề

`pancake-sync.service.ts` ghi `stock: v.remain_quantity ?? 0` **tuyệt đối** cho mọi variation
mỗi 15 phút. Nếu Pancake trả số cũ hơn thời điểm đơn cục bộ trừ kho, số đã bán bị "hồi sinh"
→ bán vượt tồn (oversell).

## Đã làm (an toàn, không phụ thuộc câu hỏi chưa chốt)

Cú quét lúc boot (`onModuleInit`) không truyền `updatedSince` nên đụng **toàn bộ catalog**, và
chạy lại mỗi lần restart/deploy — đây là chỗ ghi đè nguy hiểm nhất. Đã đổi thành chế độ
`skipStock`: boot chỉ đồng bộ giá/metadata, không chạm cột `stock`. Variation MỚI vẫn lấy tồn
kho ban đầu (chưa thể có đơn cục bộ nào để mất). Sync tăng dần 15 phút và webhook giữ nguyên.

Việc này thu hẹp rủi ro nhưng **chưa đóng** nó: cú sync 15 phút vẫn ghi đè tuyệt đối.

## Câu hỏi chặn (cần trả lời trước khi code tiếp)

> **Khi ta tạo đơn qua Pancake API (`POST /shops/:id/orders`), Pancake có tự trừ
> `remain_quantity` của variation không?**

Repo không trả lời được: không có tài liệu Pancake trong repo, và bảng `pancake_webhook_events`
ở DB dev **trống 0 dòng** (chưa từng nhận webhook thật) nên không có bằng chứng hành vi.

### Cách chốt (chọn 1)

- **A — Tra tài liệu Pancake POS** phần tạo đơn: có nói trừ tồn khi tạo đơn/khi xác nhận không.
- **B — Thí nghiệm trên prod (30 phút, không phá dữ liệu)**: chọn 1 variation ít bán, ghi lại
  `remain_quantity` qua API Pancake → tạo 1 đơn thật số lượng 1 qua miniapp → đọc lại
  `remain_quantity` ngay sau khi đơn được đẩy (kiểm tra `orders.pancakeOrderId` đã có giá trị).
  So 2 số. Nhớ huỷ đơn test sau đó.

## Hai hướng, chọn theo câu trả lời

### Nếu Pancake CÓ tự trừ tồn → Hướng 1: Pancake là nguồn chân lý + chống ghi-đè-số-cũ

Bản chất vấn đề chỉ còn là **độ trễ**: giữa lúc ta trừ kho cục bộ và lúc Pancake phản ánh, một
cú sync đang bay có thể mang số cũ về.

Sửa: thêm cột `Variation.stockUpdatedAt DateTime?`, set mỗi khi **code cục bộ** đổi stock
(checkout, reversal/restock, CTV lên đơn hộ, subscription cron). Sync ghi `stock` chỉ khi
`stockUpdatedAt IS NULL OR stockUpdatedAt < <mốc fetch trang đó từ Pancake>`. Bỏ qua thì chu kỳ
sau tự đúng (self-healing) vì lúc đó Pancake đã phản ánh đơn.

- Chi phí: 1 migration + sửa ~4 chỗ ghi stock + sửa sync. Rủi ro thấp.
- KHÔNG giải quyết được trường hợp Pancake không trừ tồn (số cũ vẫn về sau 1 chu kỳ).

### Nếu Pancake KHÔNG tự trừ tồn → Hướng 2: tách tồn kho giữ chỗ (reserved stock)

Không heuristic nào phía sync cứu được, vì số Pancake **vĩnh viễn** không biết về đơn của ta.

Sửa: thêm `Variation.reservedStock Int @default(0)`.
- `stock` = số của Pancake, sync ghi tự do (hết lo ghi đè).
- `reservedStock` += khi tạo đơn cục bộ; -= khi đơn bị huỷ/hoàn, hoặc khi Pancake đã ghi nhận
  đơn (đơn có `pancakeOrderId` và kho vật lý đã trừ — cần mốc xác nhận rõ ràng).
- Mọi chỗ kiểm tồn/hiển thị dùng `stock - reservedStock`.

- Chi phí: cao. Chạm toàn bộ đường tiền: guard oversell ở checkout, hiển thị giỏ/PDP, flash
  sale, CTV lên đơn hộ, subscription, reversal. Cần cả cron đối soát để nhả reservation treo.
- Bắt buộc làm cẩn thận với test cho từng đường — đây là lý do phiên trước và phiên này đều
  KHÔNG làm vội.

## Ghi chú liên quan

- `pancake.processor.onStockChanged` (webhook `variation.stock_changed`) cũng ghi đè tuyệt đối.
  Webhook gần real-time nên rủi ro nhỏ hơn sync định kỳ, nhưng **cùng lớp lỗi** — chọn hướng
  nào thì áp cùng cách cho chỗ này.
- Đơn subscription và đơn dealer hiện **không đẩy Pancake** (P1-4, chưa sửa). Ở Hướng 1 thì
  những đơn này Pancake vĩnh viễn không biết → tồn kho của chúng sẽ bị ghi đè ngược. Nếu chọn
  Hướng 1, phải đẩy Pancake cho 2 luồng đó trước/cùng lúc.
