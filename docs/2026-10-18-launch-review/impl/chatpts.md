# chatpts (B9 bước 3): tự cộng Điểm Xanh cho đơn chat/điện thoại theo SĐT

Đơn CSKH tạo trên Pancake (nguồn nằm trong `pancake.order_source_map.chatSources`) tự cộng Điểm Xanh theo số điện thoại, khách không cần quét mã. SĐT chưa là thành viên thì điểm được giữ 30 ngày.

## Quyết định SĐT đã xác minh

Cột `users.phone` chỉ được ghi từ `AuthService` qua `zalo.resolvePhoneNumber` (số Zalo giải mã bằng phoneToken), hoặc xoá về null khi xoá tài khoản. Không có DTO nào cho khách tự gõ số. Vì vậy `users.phone` được coi là số đã xác minh và dùng để tự liên kết. Test canh (`external-chat-phone-source.spec.ts`) đỏ nếu có đường ghi `users.phone` mới: người thêm phải thêm cờ xác minh vào `verifiedMemberPhone` (`external-chat.rules.ts`) trước khi bật cờ.

## Cờ và cấu hình

| Khoá | Mặc định |
|---|---|
| `loyalty.chat_order_points_enabled` | false (tắt thì không đường nào tạo hay cộng claim PHONE) |
| `loyalty.chat_order_earn_pct` | null (dùng `loyalty.earn_pct`) |
| `loyalty.chat_order_monthly_points_cap` | 200000 điểm/SĐT/tháng VN |
| `loyalty.chat_order_review_above_vnd` | 5000000 |
| `loyalty.chat_order_require_carrier` | true |
| `loyalty.chat_unclaimed_hold_days` | 30 |

Thành viên nhân hệ số hạng hiện tại, không phải thành viên nhân 1. `countsForTier = true`.

## Luồng

- Ingest (webhook, poll): `ensureChatClaim` tạo claim PHONE (không cần schema mới), sự kiện `CLAIM_CREATED`.
- Cộng: cron 30 phút (`releaseDueClaims`) và duyệt tay. Thứ tự khoá: advisory SĐT, `external_orders` FOR SHARE, claim FOR UPDATE, `users` FOR UPDATE.
- Chưa có thành viên khi đến hạn: `HELD_NO_MEMBER`, `holdUntil = releaseAt + hold_days`. Quá hạn: `LAPSED` (không có ledger, có sự kiện `LAPSE`).
- Liên kết: `AuthService.issueTokens` gọi `linkByPhone` sau `rbac.applyGrants` (không bao giờ chặn đăng nhập), cộng cron quét. `UPDATE ... WHERE "userId" IS NULL` + khoá advisory SĐT nên song song an toàn. Thông báo INAPP `CHAT_ORDER_POINTS_LINKED` khi có điểm đang chờ, `CHAT_ORDER_POINTS_CREDITED` khi cộng.
- Chống gian: chỉ cộng khi có `partner.extend_code` hoặc status 16. REVIEW khi: tiền hàng thiếu, thành viên STAFF/ADMIN, SĐT đơn trùng SĐT nhân viên (kể cả RoleGrant), vượt ngưỡng, trả một phần, vượt trần tháng, SĐT thành viên khác SĐT đơn lúc cộng. Người duyệt không được trùng tên người tạo đơn Pancake (`PANCAKE_CREATOR_SELF`).
- Hạng: `tierPoints` whitelist `PANCAKE_CHAT_ORDER:` và tiền tố đảo; `spent12m` cộng goodsValue claim PHONE CREDITED chưa REVERSED trong 12 tháng. Mọi đường cộng hay đảo (cron, webhook hoàn, admin reverse) gọi `recalcTier`. Hạng tụt theo chính sách ân hạn sẵn có của `decideTier`.
- Dữ liệu cá nhân: `external_orders.phone` về null sau 7 ngày kể từ khi claim ở trạng thái cuối (giữ `phoneLast3`), trong `data-retention.service.ts` (`external_orders.phone_after_final`).
- Admin: `/admin/external-claims?kind=SCAN|PHONE`, SĐT luôn che. Khách: `GET /me/external-points/claims?kind=PHONE`.

## Schema và hợp đồng kiểu

- Schema: không đổi bảng/cột. Migration `20261019160000_chat_order_points` chỉ thêm 2 mẫu thông báo INAPP và dòng `loyalty.chat_order_earn_pct = null`. `seed.ts` thêm 2 mẫu (sửa tối thiểu).
- `packages/shared-types/src/external-points.ts`: `ExternalClaimKind`, `kind` và `holdUntil` trên `MyExternalClaimItem` và `AdminExternalClaimRow`, mã lỗi `PANCAKE_CREATOR_SELF`, tham số `kind`.
- `SystemConfigService.NULLABLE_KEYS` thêm `loyalty.chat_order_earn_pct` để admin đặt lại null.

## Giả định chưa kiểm với payload thật

- Tên trường `creator`, `assigning_seller`, `assigning_care`, `partner.extend_code`, status 16, múi giờ `status_history`, `order_sources` (poll CHAT).
- Kiểm người tạo đơn chỉ so tên (chưa có ánh xạ nhân viên Tubu với tài khoản Pancake); payload không có thông tin người tạo thì không chặn được. Đây là giới hạn đã biết.
- `updatedAt` của claim dùng làm mốc "trạng thái cuối" để xoá SĐT.
- Backfill dùng bộ lọc vận đơn thô, 50 claim mỗi lượt.
- Poll dự phòng CHAT chỉ nối qua tiền tố `order_sources` của `chatSources` (dạng số).

## Kiểm thử

- Đơn vị: `external-chat.rules.spec.ts` (36), `external-chat.config.spec.ts`, `external-chat-phone-source.spec.ts`, khoá cấu hình trong `config-numeric-ranges.spec.ts`.
- Race trên Postgres thật (`test/integration-race/external-chat-points.race-spec.ts`, 36 ca): ingest vs link, hai link cùng lúc, trần tháng song song, cron vs webhook hoàn, hạng lên/xuống, lô EXTERNAL không trừ hai lần, SĐT chưa xác minh bị bỏ qua, cờ tắt chặn mọi đường. Đã đột biến thử: bỏ sửa loyalty hay bỏ khoá SĐT thì ca tương ứng đỏ.

## Vị trí schema

Không thêm model hay cột. `schema.prisma` chỉ sửa dòng chú thích `action` của `ExternalClaimEvent` (thêm LINK_PHONE, HOLD_NO_MEMBER, LAPSE). Migration `20261019160000_chat_order_points` xếp sau `20261019150000`, trước `20261020000000`.

## Kết quả kiểm chứng và lỗi có sẵn

- tsc api, tsc web, `pnpm lint` (5/5), jest toàn api (369 suite, 8040 test), `system-config` + `prisma/reference-data` (321 test) đều xanh. `migrate deploy` trên DB trống rồi `migrate diff --exit-code`: không lệch.
- Race `--runInBand` cả nhóm (external|chat|reference-seed|partial-unique|loyalty|tier): lần đầu 15 test đỏ ở 5-6 suite. Một là của mình (`reference-seed` đếm khoá bổ sung 27 thành 32: đã thêm 5 khoá chat vào danh sách, xanh). Còn lại là DB dùng chung bị nhiễm dữ liệu của spec khác (hạng `itcp-tier-*`/`IT-BD-C-*` còn sót làm `external-claims (e)` đỏ; ctv-assisted, coupon-preview). Trên DB mới migrate, các suite đó xanh khi chạy riêng, trừ `ops-health`.
- `ops-health.race-spec.ts` đỏ trên DB trống, không do chatpts: hộp việc có thêm hàng đợi `externalPoints` từ các commit extclaim đã có trong nhánh (spec chưa cập nhật danh sách). Chưa sửa vì ngoài phạm vi.
