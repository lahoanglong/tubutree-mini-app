# extorders bước 1: nhận đơn Pancake ngoài app (chưa cộng điểm)

Nhánh `lr2/extorders`, kế hoạch gốc `extpoints-plan.md`. Bước 2 (claim, cron, miniapp) và bước 3 (B9) chưa làm.

## Đã làm

- Migration `20261019100000_external_orders`: 4 enum, 3 bảng (`external_orders`, `external_points_claims`, `external_claim_attempts`), các index trong plan, và unique sổ điểm `points_transactions_external_order_key` ON (reason, refId) WHERE refType='EXTERNAL_ORDER'. Bước 2/3 không cần đổi schema. `userId` ở bảng claim/attempt là chuỗi thường, không có khoá ngoại tới `users` (không đụng model User).
- `apps/api/src/modules/external-points/`:
  - `external-order.mapper.ts`: `classifyPancakeOrder`, `sourceKeyOf`, `extractTrackingCodes`, `normalizeTrackingCode`, `goodsValue`, `deliveredAt`, `pancakeTime`, `buyerPhone`, `externalStatusOf`.
  - `external-order.config.ts`: khoá `pancake.external_capture_enabled`, `pancake.order_source_map`, mặc định, validator.
  - `external-order.ingest.ts`: `ingestExternalOrder` (createMany skipDuplicates, rồi updateMany có điều kiện `updated_at`).
  - `external-orders-admin.{service,controller}.ts`, `external-points.module.ts`: API chỉ đọc.
- `pancake.processor.ts` `handle()`: đơn không khớp đơn Tubu và không `foreign` thì nạp; kết quả khác `NOT_EXTERNAL` là `PROCESSED`.
- Web: tab "Đơn ngoài app" (nhóm "Đơn hàng & giao vận"), bảng "Nguồn đã thấy", nút xem payload chỉ cho ADMIN.
- Runbook `docs/launch/deploy-rollback-runbook.md`: "Bước 15. Bắt payload thật của đơn ngoài app".

## Phân loại đơn

1. APP (không bao giờ lưu): mã Tubu từ `pancakeEventOrderCode` (extension.external_order_id hoặc "Order code:" trong note), `custom_id` khớp `^(TUBU|TUBUSUB|DLR)\d+$`, hoặc tag `MINIAPP`/`WEB` (tags là mảng chuỗi, mảng `{name}` hoặc một chuỗi phân tách bằng phẩy, không phân biệt hoa thường).
2. MARKETPLACE: `marketplace_id` có trong `marketplaceIds` (mặc định -3 shopee, -4 lazada, -9 tiktok), hoặc `is_from_ecommerce === true` (channel null nếu id lạ).
3. CHAT: `sourceKey` (`order_sources|account|marketplace_id`) nằm trong `chatSources` (mặc định rỗng).
4. UNKNOWN: còn lại. Vẫn lưu để bảng "Nguồn đã thấy" lộ ra khoá cần xếp, nhưng sự kiện giữ UNMATCHED (cron ghép lại như cũ, nạp lại idempotent). Khi lần sau ghép được đơn Tubu thì dòng UNKNOWN cùng pancakeOrderId bị xoá. Chỉ MARKETPLACE và CHAT là PROCESSED.

Chỉ sự kiện mang nguyên object đơn (`orders`, `order`, `order.updated`, `order.status_updated`) được nạp; `order.cancelled`, `order.shipping_updated`, `invoice.issued` giữ hành vi cũ (UNMATCHED) vì payload có thể một phần và sẽ làm sai nguồn đã lưu.

## Ghi đè an toàn

- Cập nhật chỉ áp khi `pancakeUpdatedAt` lưu là null hoặc không lớn hơn mốc mới (Pancake so Pancake); bản cũ hơn trả STALE, sự kiện vẫn PROCESSED.
- Payload thiếu field không xoá thứ đã biết: SĐT, mã vận đơn, mã đơn sàn, status, mốc chỉ ghi đè khi có giá trị mới. `goodsValue` luôn ghi theo bản mới nhất (null nếu lệch).
- `deliveredAt`: mốc sớm nhất status 3/16 trong `status_history` (chuỗi không múi giờ đọc là +07:00); không có thì giờ máy chủ lúc lần đầu thấy đã giao (UPDATE ... WHERE deliveredAt IS NULL). `closedAt` tương tự cho hoàn/huỷ/xoá.

## API admin (chỉ đọc)

`GET /admin/external-orders?q=&source=&status=&page=&limit=`, `GET /admin/external-orders/sources`, `GET /admin/external-orders/:id`. Quyền ADMIN và nhóm CSKH. `q` thử mã đơn Pancake, mã vận đơn/mã đơn sàn (chuẩn hoá), SĐT đầy đủ. SĐT luôn qua `maskPhoneOrNull`; `lastPayload` chỉ có ở `:id` khi `role === 'ADMIN'`.

## Giới hạn đã biết

- Đơn lưu trước khi sửa `order_source_map` giữ loại cũ cho tới khi Pancake gửi cập nhật mới của chính đơn đó (chưa có nút phân loại lại; `lastPayload` đủ để bước sau làm).
- Đơn app thiếu dấu và tới trước khi lưu pancakeOrderId: lưu UNKNOWN, giữ UNMATCHED, cron ghép lại rồi dọn dòng UNKNOWN. Đơn app không bao giờ ghép được sẽ ở lại là UNKNOWN (thấy ở tab, không cộng điểm).
- `goodsValue` theo công thức plan; `total_price` được giả định là tổng sau giảm theo dòng (để `total_price − total_discount` đối chiếu được). Chưa kiểm bằng payload thật; sai thì đơn ra "chưa tính được" chứ không cộng sai.
- Dữ liệu kiểm thử là tự dựng: `apps/api/test/fixtures/pancake/synthetic-*.json`.

## Sau review (F1-F7)

- F1: webhook một phần không đè source/channel/sourceKey (chỉ khi loại mới khác UNKNOWN hoặc payload có marketplace_id/order_sources), goodsValue (chỉ khi khác null), lastPayload (chỉ khi payload có items). `chatSources` từ chối khoá chỉ toàn dấu `|` hay rỗng.
- F2/F6: dọn dòng UNKNOWN chỉ xoá dòng chưa có claim (`claim: { is: null }`), bọc try/catch + log warn, chạy bất kể cờ nạp.
- F3: `lastPayload` lưu bản đã lọc (`payloadForStorage`): không SĐT, tên, địa chỉ, ghi chú, tên sản phẩm. Retention: thêm vào mục `webhook_events` (cùng khoá `retention.webhook_events_days`, mặc định 90, sàn 14) một lượt UPDATE xoá `external_orders.phone` của dòng quá hạn không còn claim PENDING/REVIEW/HELD_NO_MEMBER. Lý do: SĐT không được sống lâu hơn payload gốc ở `pancake_webhook_events` cùng hạn 90 ngày; dòng đơn (mã vận đơn, trạng thái, tiền hàng) giữ lại vì không có PII. Bước 3 cần SĐT cho claim chờ nên claim chờ được loại trừ.
- F4: sự kiện không có `updated_at` chỉ áp lên dòng chưa có mốc Pancake.
- F5: `goodsValue` và `pancakeStatus` vượt Int4 (hoặc status âm) thành null.
- F7: khoá `marketplaceIds` phải ở dạng chuẩn `String(Number(id)) === id` (từ chối "03", "-0", "+3").

## Giả định phải kiểm bằng payload thật

- Múi giờ `pancakeTime`: chuỗi không múi giờ đang đọc là +07:00; có thể Pancake gửi UTC không hậu tố. Sai thì `deliveredAt` lệch 7 giờ (ảnh hưởng mốc cộng điểm ở bước 2) và so `updated_at` vẫn nhất quán nhưng mốc giao sai.
- `total_discount` có thể đã gồm `discount_each_product` (giảm theo dòng); công thức hiện tại trừ cả hai nên có thể tính hụt, và đối chiếu 1% với `total_price − total_discount` sẽ cho null (vào REVIEW) chứ không cộng sai.
- Mã `marketplace_id` -3/-4/-9 cho Shopee/Lazada/TikTok chỉ là mặc định theo yêu cầu, chưa thấy trên payload thật.
