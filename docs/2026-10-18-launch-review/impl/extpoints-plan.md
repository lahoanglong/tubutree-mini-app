# Kế hoạch tích điểm đơn ngoài app (B6 đơn sàn, B9 đơn chat/điện thoại trên Pancake)

Quyết định của chủ dự án: `03-cau-hoi-sang.md`, mục "Điểm Xanh kiểu mới" và B9. Bản thiết kế do agent Plan đọc mã và tài liệu Pancake POS (docs.pancake.biz/pos/api/openapi.json). Chưa có payload webhook thật, nên mọi việc cộng điểm nằm sau cờ tắt.

## Quyết định thiết kế đã chốt

- Một bảng `external_orders` (khoá `pancakeOrderId`) cho cả đơn sàn và đơn chat. Điểm chờ nằm ở `external_points_claims`. Chỉ khi tới hạn mới ghi đúng một dòng vào `points_transactions`, nên số dư, `lockedOrderPoints` và cron hết hạn không đổi.
- Ánh xạ nguồn đơn là khoá JSON `pancake.order_source_map`. Ghi lại đơn lạ bật ngay (`pancake.external_capture_enabled` = true). Cộng điểm tắt tới khi có payload thật.
- B9 (đơn chat) tính vào xét hạng. Đơn sàn không tính hạng.
- 30 ngày giữ điểm của B9 tính từ lúc điểm đáng lẽ được cộng (giao + 14 ngày).
- SĐT lưu dạng thường (0xxxxxxxxx) để ghép thành viên, không bao giờ trả thô qua API (`maskPhoneOrNull`), xoá về null 7 ngày sau khi claim về trạng thái cuối (giữ `phoneLast3`).
- Chống lạm dụng B6: ai gửi trước được, trần ngày/tháng, giới hạn tuổi đơn, REVIEW khi vượt ngưỡng; admin có "Huỷ và mở lại mã".

## Nhận biết loại đơn (hàm thuần `apps/api/src/modules/external-points/external-order.mapper.ts`)

- `classifyPancakeOrder(data, map)` → `APP | MARKETPLACE(shopee|lazada|tiktok) | CHAT | UNKNOWN`.
  - APP (không bao giờ là đơn ngoài): `pancakeEventOrderCode(data)` khác null, hoặc `custom_id` khớp `/^(TUBU|TUBUSUB|DLR)\d+$/`, hoặc tag `MINIAPP`/`WEB` (tag là chuỗi hoặc `{name}`).
  - MARKETPLACE: `marketplace_id ∈ map.marketplaceIds` (mặc định `{-3: shopee, -4: lazada, -9: tiktok}`) hoặc `is_from_ecommerce === true`.
  - CHAT: `sourceKey ∈ map.chatSources` (mặc định rỗng).
  - Còn lại UNKNOWN. Lưu `sourceKey = "${order_sources}|${account}|${marketplace_id}"`.
- `extractTrackingCodes(data)`: `partner.extend_code`, `partner.extend_update[].tracking_id`, `order_number_vtp`, `invoice_info_list[].order_sn`, `tracking_number`. Chuẩn hoá: chữ hoa, bỏ khoảng trắng và gạch, chỉ A-Z0-9, dài 8–30.
- `goodsValue(data)`: Σ qty × (retail_price − discount_each_product) − total_discount, không cộng ship. Đối chiếu `total_price − total_discount`; thiếu số hoặc lệch quá 1% thì null (đơn vào REVIEW).
- `deliveredAt(data)`: mốc đầu tiên trong `status_history` có status 3 hoặc 16 (giờ +07:00, cần kiểm bằng payload thật); không có thì giờ máy chủ lúc đầu tiên thấy trạng thái đã giao.
- `buyerPhone(data)`: `bill_phone_number`, rồi `shipping_address.phone_number`, qua `parseTypedVnPhone`; số bị che cho null.

## Mô hình dữ liệu (một migration, tên sau mọi migration hiện có)

- Enum: `ExternalOrderSource {MARKETPLACE, CHAT, UNKNOWN}`, `ExternalOrderStatus {OPEN, DELIVERED, RETURNING, RETURNED, CANCELLED, PARTIAL_RETURN, DELETED}`, `ExternalClaimKind {SCAN, PHONE}`, `ExternalClaimState {PENDING, REVIEW, HELD_NO_MEMBER, CREDITED, VOIDED, REVERSED, LAPSED}`.
- `external_orders`: `pancakeOrderId` unique, `source`, `channel?`, `sourceKey`, `trackingCode?`, `trackingCodes String[]`, `marketplaceOrderSn?`, `phone?`, `phoneLast3?`, `goodsValue Int?`, `pancakeStatus Int?`, `status`, `pancakeInsertedAt?`, `pancakeUpdatedAt?`, `deliveredAt?`, `closedAt?`, `lastPayload Json`, `firstSeenAt`, `updatedAt`. Index: btree `trackingCode`, GIN `trackingCodes`, `(phone) WHERE phone IS NOT NULL`, `(source, status)`.
- `external_points_claims`: `externalOrderId` unique, `userId?`, `kind`, `state`, `ratePct Decimal`, `multiplier Decimal`, `points Int`, `countsForTier Bool`, `claimedCode?`, `releaseAt?`, `holdUntil?`, `creditedAt?`, `pointsTxId?`, `voidReason?`, `reviewReason?`, `decidedById?`, `dayKey`, timestamps. Unique một phần `("claimedCode") WHERE "claimedCode" IS NOT NULL`. Index `(state, releaseAt)`, `(state, holdUntil)`, `(userId, createdAt)`, `(userId, dayKey)`.
- `external_claim_attempts`: `userId`, `code`, `result` (`MATCHED | UNMATCHED | REJECTED_*`), `externalOrderId?`, `dayKey`, `resolvedAt?`, `resolvedById?`, `note?`. Unique một phần `(code) WHERE result='UNMATCHED' AND "resolvedAt" IS NULL`.
- Sổ điểm: unique một phần `("reason","refId") WHERE "refType"='EXTERNAL_ORDER'` (cùng kiểu `20260623010000_loyalty_credit_unique`). `refId` = id claim. Reason: `MARKETPLACE_ORDER:<pancakeId>` / `MARKETPLACE_ORDER_REVERSED:<pancakeId>`, `PANCAKE_CHAT_ORDER:<pancakeId>` / `PANCAKE_CHAT_ORDER_REVERSED:<pancakeId>`.

## Nạp đơn

- `pancake.processor.ts` `handle()` sau `resolveOrder`: không khớp đơn Tubu và không phải `foreign` → `ingestExternalOrder(...)` (hàm thuần, không tạo vòng module). Kết quả khác `NOT_EXTERNAL` → `PROCESSED`; payload APP vẫn `UNMATCHED` như cũ.
- Upsert theo `pancakeOrderId`; sự kiện có `updated_at` cũ hơn thì bỏ qua (so mốc Pancake với mốc Pancake, quy ước R5-SYNC-3). Đổi trạng thái thì gọi `applyStatusToClaim` (bước 2).
- `pancake_webhook_events` bị data-retention xoá theo hạn; `external_orders.lastPayload` giữ bản mới nhất.

## Bước 2 (sau gói points-1d): B6 tích điểm đơn sàn, cờ `loyalty.marketplace_claim_enabled` = false

- `POST /me/external-points/claims {code}` (`@Throttle 10/phút`), thứ tự luật: cờ bật + `isRealUser` có SĐT, không khoá → chuẩn hoá mã (400 nếu sai) → dưới `pg_advisory_xact_lock(hashtext('ext-claim:'+userId))`: số lần gửi/ngày ≤ `loyalty.marketplace_claim_daily_attempts` (10), 5 lần không tìm thấy trong 24h thì khoá 24h → mã trùng `orders.shippingCode`/`gomdonPartnerCode` thì "đơn mua trong Mini App" → CHAT thì "tự cộng theo SĐT", UNKNOWN thì attempt + REVIEW → `inserted_at` ≥ `loyalty.external_since` và không cũ hơn `loyalty.marketplace_claim_max_age_days` (60); CANCELLED/RETURNED từ chối → khoá dòng `external_orders` FOR UPDATE, insert claim, P2002 → "mã đã được tích" → claim thành công/ngày ≤ `loyalty.marketplace_claim_daily_max` (3), điểm/tháng ≤ `loyalty.marketplace_claim_monthly_points_cap` (200.000) → REVIEW khi `goodsValue` null, > `loyalty.marketplace_claim_review_above_vnd` (2.000.000), hoặc 3 số cuối SĐT lộ ra khác thành viên → phản hồi chỉ gồm sàn, điểm chờ, mốc dự kiến.
- Tra Pancake khi mã chưa có (cờ `pancake.external_lookup_enabled` = false): `searchOrders(code, 5s)`, lọc đúng mã, ingest; ngắt mạch 3 lỗi → nghỉ 5 phút; không thấy → attempt UNMATCHED, cron 30 phút thử ghép lại trong 3 ngày (tối đa 50/lượt), hết hạn vào "Cần xử lý".
- Kéo dự phòng (cờ `pancake.external_poll_enabled` = false): `GET /orders?updateStatus=updated_at&startDateTime=now-2h` với `order_sources[]` của sàn, tối đa 20 trang, `RunLease`.
- Điểm: `external-points-rate.ts` (không sửa `points-earn.ts`): `floor(goodsValue × ratePct × multiplier)`; sàn `loyalty.marketplace_earn_pct` = 0.01, hệ số 1; còn PENDING thì tính lại theo `goodsValue` mới nhất, tới lúc cộng thì chốt.
- Cron `@Cron('0 */30 * * * *')` + `pg_try_advisory_xact_lock('external-points.release')`: claim PENDING có đơn DELIVERED và `deliveredAt + loyalty.external_pending_days (14) ≤ now` → mỗi claim một transaction, khoá claim rồi users; `UPDATE … SET state='CREDITED' WHERE id AND state='PENDING'`; kiểm lại đơn vẫn DELIVERED; `applyPointsDelta(tx, { skipDuplicates: true, reason, refType: 'EXTERNAL_ORDER', refId: claim.id, expiresAt: pointsExpiresAt(now) })`; sau commit notify (`dedupeKey: 'ext-credit:'+claimId`) và `recalcTier` nếu `countsForTier`.
- `applyStatusToClaim`: 4 đang hoàn → giữ; 5/6/7 → PENDING/REVIEW/HELD thành VOIDED (+ thông báo), CREDITED thành REVERSED trừ `min(points, lotRecoverable, số dư)` theo PF-3 như `reverseOrderPoints`; 15 hoàn một phần → chưa cộng thì REVIEW, đã cộng thì vào hàng cần xử lý; giao sau khi huỷ → REVIEW.
- Sổ lô: thêm `EXTERNAL_RULE` vào `loyalty-expiry.service.ts`: dòng dương `refType='EXTERNAL_ORDER'` tạo lô `EXTERNAL:<refId>`, dòng `*_REVERSED:` cùng refId thu hồi đúng lô (thiếu luật này khách mất điểm hai lần).
- Mẫu thông báo `EXTERNAL_POINTS_PENDING | CREDITED | VOIDED | CLAIM_NOT_FOUND`: INAPP ngay, ZNS khi Zalo duyệt mẫu. Không dùng tin OA chữ tự do (chỉ gửi được trong 48h sau tương tác).
- Miniapp: trang `/points/scan` (`pages/external-points.tsx`, `services/external-points-api.ts`). Ô nhập tay là đường chính (`scanQRCode` của zmp-sdk 2.51.4 chỉ trả `{content}`, chưa rõ đọc được mã vạch 1D), nút quét là phụ; dải "Mua trong Mini App được tích gấp đôi" (Đơn sàn 1% · Đơn trong Mini App từ 2%, nhân theo hạng; số từ public config); danh sách "Đơn ngoài app của bạn". Lối vào ở `profile.tsx` nhóm "Tài sản", chỉ hiện khi `publicConfig.marketplaceClaimEnabled`.
- Admin: thao tác duyệt REVIEW, huỷ có lý do, "Huỷ và mở lại mã", gắn/từ chối attempt UNMATCHED. CSKH duyệt và huỷ claim chưa cộng; chỉ ADMIN đảo điểm đã cộng. Khoá `externalPoints` trong `ops-inbox.service.ts`.

## Bước 3 (sau bước 2): B9 đơn chat, cờ `loyalty.chat_order_points_enabled` = false

- Nạp đơn CHAT có SĐT: có thành viên (theo `mergedIntoId`, không khoá) → claim PHONE PENDING, hệ số hạng hiện tại, `countsForTier = true`; chưa có → claim `userId = null`, hệ số 1; tới hạn mà chưa có thành viên → HELD_NO_MEMBER, `holdUntil = releaseAt + loyalty.chat_unclaimed_hold_days (30)`; quá hạn → LAPSED, không ghi sổ.
- Tỉ lệ: `loyalty.chat_order_earn_pct` (null = tỉ lệ đơn app của gói points-1d).
- Tự nhận: cron mỗi 30 phút tìm `users.phone` khớp; thêm móc `externalPoints?.linkByPhone(user)` (inject `@Optional`) sau `rbac.applyGrants` trong `AuthService.issueTokens`. An toàn song song nhờ `UPDATE … WHERE "userId" IS NULL` và unique sổ điểm.
- Chống nhân viên tạo đơn giả: chỉ cộng khi đơn có `partner.extend_code` hoặc status 16 (`loyalty.chat_order_require_carrier` = true); REVIEW khi `goodsValue > loyalty.chat_order_review_above_vnd` (5.000.000) hoặc thành viên là STAFF/ADMIN; trần điểm theo SĐT mỗi tháng.
- Hạng: whitelist `tierPoints` thêm `PANCAKE_CHAT_ORDER:` và tiền tố đảo; `spent12m` trong `recalcTier` cộng `goodsValue` của claim chat CREDITED chưa REVERSED trong 12 tháng.
- Kéo dự phòng và xoá SĐT về null làm ở bước này.

## Việc chủ dự án làm ngay sau khi gộp bước 1 (bắt payload thật)

1. Có ít nhất: 1 đơn Shopee, 1 Lazada, 1 TikTok, 1 đơn CSKH qua Facebook/Zalo, 1 đơn gọi điện, 1 đơn app (và 1 đơn bán tại quầy nếu quầy dùng Pancake POS). Theo dõi tới đã giao, và 1 đơn hoàn hoặc huỷ.
2. Agent (chỉ khi chủ dự án cho phép đọc PROD) lấy `rawPayload` từ `pancake_webhook_events` / `external_orders.lastPayload`, xoá PII, lưu `apps/api/test/fixtures/pancake/*.json`; chụp thêm `GET /orders/{id}` để so.
3. Sửa `pancake.order_source_map` và viết test ánh xạ theo fixture.

## Ẩn số chặn việc BẬT cờ (không chặn việc viết mã)

1. Payload thật của đơn sàn: có `marketplace_id`/`is_from_ecommerce` không; mã vận đơn ở field nào; múi giờ của `status_history`; Pancake có gửi webhook cho đơn sàn và có cập nhật trạng thái giao/hoàn không.
2. Giá trị `order_sources`/`account` của đơn CSKH chat/điện thoại; quầy có dùng Pancake POS không (nếu có phải loại nguồn đó để không cộng hai lần với tích điểm tại quầy).
3. `search` của `GET /orders` có tìm theo mã vận đơn không.
