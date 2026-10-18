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

## Sửa sau review lượt 1

Reviewer Opus kết luận bản 1d042dc0 gộp được khi cờ tắt nhưng chưa đủ để bật cờ: 2 lỗi chặn về tiền (đã chứng minh trên Postgres thật) và 5 lỗ hổng. Làm theo thứ tự: thêm cột (chỉ cộng thêm), viết test trước, chạy đỏ, rồi sửa.

### Kết quả đỏ trước khi sửa

Test mới ở `test/integration-race/external-chat-review1.race-spec.ts` (17 ca). Chạy trên mã nguồn của 1d042dc0 (chỉ có thêm các cột mới để test biên dịch được, hành vi chưa đổi): `Tests: 15 failed, 2 passed, 17 total`. Hai ca xanh là ca đối chứng (thành viên có sẵn, tiền hàng tăng thì REVIEW lúc cộng; `ensureChatClaim` idempotent). Các lỗi chặn đúng như reviewer:
- C1 (đơn 1.000.000 đổi thành 100.000.000 trước khi liên kết): `Expected: not "CREDITED"`, claim được cộng thẳng.
- C2 (hai claim 100.000, trần 200.000, thành viên hạng x2): `Expected: <= 200000, Received: 400000`.
- N1 `PHONE_CHANGED` không có (`Received array: ["CLAIM_CREATED", "TO_REVIEW"]`), N3 hạng nhảy lên hạng cao, N5 `Expected: "REVIEW", Received: "PENDING"`, claim mất SĐT `Expected: "CREDITED", Received: "SKIPPED"`.

Sau khi sửa: `Tests: 17 passed, 17 total`.

### Thay đổi theo từng mục

- **C1 và C2** (`external-chat.claim.ts`, `linkClaimsByPhone`): liên kết không còn ghi đè `points`. Mỗi claim được chạy lại `evaluateChatClaim` với thành viên mới (nhân viên, SĐT nhân viên, ngưỡng tự duyệt, status 16, trần theo người tạo) và quyết REVIEW nếu có lý do. Điểm tăng vì hệ số hạng thì chốt bằng `settlePoints` theo `chatMonthPoints` của chính thành viên (không dưới điểm đã kiểm, không vượt phần trần còn lại). Claim vào REVIEW giữ nguyên điểm đã kiểm, để `approve` tính lại và chốt trần theo mức đó. Tách "điểm đã kiểm" khỏi "điểm hiện tại": `points` của claim luôn là điểm đã kiểm (mọi đường ghi đều kiểm trước khi ghi), nên `releaseClaim` kiểm lại khi điểm lúc cộng vượt `points`. Không thêm cột `checkedPoints` riêng vì hai số không có đường nào để lệch nhau nữa; ca C1, C2 canh điều này.
- **N1** (SĐT trên đơn đổi): cột `external_points_claims.orderPhone` lưu SĐT lúc tạo claim. Liên kết, trần tháng, lapse, khoá advisory đều dùng cột này thay cho `external_orders.phone`. Webhook đổi SĐT: `ensureChatClaim` (nhánh claim đã có) chuyển PENDING/HELD_NO_MEMBER sang REVIEW với sự kiện `PHONE_CHANGED` ("đuôi 123 thành 456"), không liên kết. `linkClaimsByPhone` và `releaseClaim` cũng kiểm lúc chạy (cho trường hợp SĐT bị đổi thẳng trong DB). Claim đã có người duyệt thì không đảo. `orderPhone` xoá theo luật retention (xem dưới). Ghi thêm: để hai giao dịch đổi chéo SĐT không khoá ngược chiều, các SĐT được khoá theo thứ tự chữ.
- **N2** (status 16 không vận đơn): `evaluateChatClaim` đưa vào REVIEW ("giao không qua vận chuyển, cần kiểm") khi status 16 mà không có `extend_code` và không có mã vận đơn nào. Chỉ áp khi `loyalty.chat_order_require_carrier` bật.
- **N3** (hạng nhảy khi sửa tiền hàng): cột `creditedGoodsValue` ghi tiền hàng lúc cộng; `chatSpending12m` dùng cột này thay cho `goodsValue` hiện tại của đơn.
- **N4** (SĐT bị cấp lại): cột `users.phoneVerifiedAt`. `AuthService` (mọi nhánh Zalo trả số) làm mới mốc khi Zalo trả đúng số đang lưu; số khác số đang lưu thì đổi sang số mới nếu chưa thuộc ai (ghi log), nếu đã thuộc người khác thì giữ nguyên (ghi log). `verifiedMemberPhone` và `resolveMemberByPhone` chỉ nhận số có `phoneVerifiedAt` trong `loyalty.chat_phone_verified_max_days` (180) ngày; quá hạn thì claim giữ `userId` null như chưa là thành viên. Cron `linkWaitingClaims` chỉ chọn thành viên đủ điều kiện và claim còn liên kết được, xếp theo claim chờ lâu nhất.
- **N5** (người tạo đơn): khoá `pancake.staff_map` (JSON id Pancake sang userId, có validator) dùng cho (a) chặn người duyệt trùng nhân viên map, (b) REVIEW khi thành viên nhận điểm chính là nhân viên tạo đơn (hay nhân viên đó có SĐT trùng SĐT đơn), và `loyalty.chat_order_creator_monthly_points` (mặc định 1.000.000): tổng điểm tự cộng (không REVIEW, không do người duyệt) của cùng `creator.id` trong tháng; vượt thì đơn kế tiếp REVIEW. Cột `creatorRef` lưu `creator.id`. Giới hạn: payload không có `creator.id` thì không áp trần (và `staff_map` chưa khai báo thì chỉ so tên).
- **Lỗi nhỏ**: `releaseClaim` không còn bỏ qua claim đã gắn thành viên mà đơn mất SĐT (khoá theo `orderPhone` hay SĐT thành viên; claim chưa có chủ và không còn SĐT đi HELD rồi LAPSED, không kẹt lô); tiền tố sổ điểm và sổ đảo theo `claim.kind`, không theo `order.source`; `linkWaitingClaims` có ORDER BY và lọc; `backfillChatClaims` đánh dấu đơn đã xét bằng cột `external_orders.chatCheckedAt = updatedAt` (SQL tay, không đẩy `updatedAt`), đơn đã bị bỏ qua chỉ xét lại khi đổi, lỗi tạm (`ERROR`) thì xét lại lượt sau.

### Cột và migration mới (vị trí trong schema)

Migration `20261019170000_chat_review1` (sau `20261019160000`, trước `20261020000000`). Không thêm model; mọi cột nằm trong model sẵn có và có thể null:
- `User.phoneVerifiedAt` (ngay sau `phone`).
- `ExternalOrder.chatCheckedAt` (sau `updatedAt`, trong khối external).
- `ExternalPointsClaim.orderPhone`, `creatorRef`, `creditedGoodsValue` (sau `decidedById`), kèm 2 chỉ mục: `(orderPhone)` và `(creatorRef, createdAt)`.
- Migration điền sẵn `orderPhone`, `creditedGoodsValue` cho claim PHONE đã có và đặt `phoneVerifiedAt = now()` cho mọi user đang có SĐT (số hiện có đều từ Zalo; không biết mốc thật nên đồng hồ 180 ngày bắt đầu từ lúc deploy).
- Khoá cấu hình mới: `loyalty.chat_phone_verified_max_days` (180), `loyalty.chat_order_creator_monthly_points` (1.000.000), `pancake.staff_map` ({}), nạp qua `EXTRA_CONFIGS`. Sự kiện claim mới: `PHONE_CHANGED`.
- Retention: `external_points_claims.order_phone` (`UPDATE ... SET "orderPhone" = NULL` khi claim ở trạng thái cuối quá 7 ngày hoặc đơn đã mất SĐT).

### Ai khác đang dùng `users.phone` (kiểm khi cho phép đổi số)

- `rbac.applyGrants` (grant quyền theo SĐT): trước đây chỉ tài khoản MỚI nhận số thì mới được nâng quyền; giờ tài khoản đã có mà Zalo trả số khác cũng sẽ được nâng nếu số mới có grant còn hiệu lực. Mức tin cậy giống tạo tài khoản mới bằng số đó (cũng chỉ cần Zalo trả số), nhưng là một đường mới: chủ shop cần thu hồi grant (`revokedAt`) khi nhân viên nghỉ và đổi số.
- `notifications.service` gửi ZNS theo `user.phone` hiện tại: sau khi đổi số tin đi số mới (đúng ý muốn).
- Địa chỉ giao và đơn hàng lưu SĐT riêng (snapshot), không bị đổi theo.
- `analytics-aggregation` ghép theo số điện thoại: doanh thu từ đây tính theo số mới, không ghép lại đơn cũ.
- `order-reversal.service` tìm người theo SĐT khi hoàn: chỉ đọc số hiện tại.
- Gom đơn (gomdon) và export admin không dùng `users.phone` làm khoá. Không tìm thấy chỗ nào khác bị hỏng khi số đổi.

### Giới hạn đã biết thêm

- Test canh nguồn ghi `users.phone` (`external-chat-phone-source.spec.ts`) quét mã TypeScript và không bắt được SQL tay (`$executeRaw`, migration).
- `phoneVerifiedAt` chỉ được làm mới khi Mini App gửi `phoneToken`, mà Mini App không xin lại số khi tài khoản đã có số (`apps/miniapp/src/store/auth.ts:210`). Luật đã sửa ở review lượt 2 (B1): mốc quá `loyalty.chat_phone_verified_max_days` KHÔNG còn làm claim mất chủ. Câu cũ "điểm vẫn giữ theo HELD_NO_MEMBER" sai (30 ngày sau là LAPSED, mất điểm). Xem mục "Sửa sau review lượt 2".
- Trần theo người tạo cần `creator.id` đúng tên trường trong payload thật (chưa kiểm, xem giả định ở trên).

## Sửa sau review lượt 2

Reviewer xác nhận C1, C2, N1, N3 và tiền tố sổ điểm đã đúng; còn 2 lỗi chặn bật cờ và 3 mục nên sửa. Cách làm như lượt 1: viết test, chạy đỏ trên ffb2ce1d, rồi sửa.

### Kết quả đỏ trước khi sửa (mã nguồn ffb2ce1d)

Test mới `test/integration-race/external-chat-review2.race-spec.ts` (7 ca) và `test/integration-race/auth-phone-change.race-spec.ts` (5 ca), cộng ca N4 của `external-chat-review1.race-spec.ts` được viết lại theo luật mới. Chạy cùng lượt: `Tests: 11 failed, 18 passed, 29 total` (log `red2.log`). Các ca đỏ:
- B1: claim của thành viên có xác minh cũ/chưa có vẫn `userId` null; liên kết và cron không gắn.
- B2: đơn tăng tiền hàng lúc cộng vẫn `CREDITED` thay vì `TO_REVIEW` (Expected "TO_REVIEW", Received "CREDITED").
- N-B: hai lần liên kết song song với hai người tạo đơn theo thứ tự ngược nhau không liên kết đủ (deadlock 40P01), ca đỏ.
- N-C: liên kết gặp SKIP (đơn quá tuổi) vẫn để claim PENDING (cộng thô), không REVIEW.
- Nhỏ: claim mất cả chủ lẫn SĐT đi HELD (Expected "TO_REVIEW", Received "HELD").
- Auth: số mới có grant STAFF thì tài khoản CUSTOMER đổi số và lên STAFF (Expected "CUSTOMER", Received "STAFF"); STAFF vẫn bị đổi số; số cũ có grant vẫn đổi.
Ca xanh sẵn là ca đối chứng (hai tài khoản đua nhận số tự do: đúng một người nhận; CUSTOMER đổi số bình thường).

Sau khi sửa: cả nhóm chat + auth-phone-change xanh (xem số liệu ở báo cáo).

### Luật mới

- **B1**: thành viên có SĐT khớp mà `phoneVerifiedAt` quá `loyalty.chat_phone_verified_max_days` (hay chưa có) vẫn là người nhận: claim gắn `userId` của họ nhưng vào REVIEW, lý do "SĐT xác minh đã cũ, cần kiểm người nhận". Áp như nhau cho tạo claim (`ensureChatClaim`), liên kết lúc đăng nhập (`linkClaimsByPhone`) và cron (`linkWaitingClaims`, không còn lọc theo mốc xác minh). `resolveMemberByPhone` trả `phoneStale`, `linkableMemberPhone` thay `verifiedMemberPhone` ở đường liên kết (`verifiedMemberPhone` còn nguyên, nghiêm ngặt, hiện chỉ test dùng). Không sửa Mini App.
- **B2**: `releaseClaim` với claim PHONE mà điểm tính lúc cộng lớn hơn `points` đã kiểm vào REVIEW ("Tiền hàng tăng sau khi kiểm ..."), không chốt tự động. Claim đơn sàn (SCAN) giữ hành vi cũ (ngưỡng và chốt theo trần). Hệ quả: hạng thành viên tăng giữa lúc kiểm và lúc cộng cũng đưa claim vào REVIEW; chấp nhận vì ít gặp và người kiểm xử lý được.
- **N-A (auth)**, `zaloPhoneFields`: không tự đổi `users.phone` của tài khoản đang có số khi tài khoản không phải CUSTOMER, bị khoá, số cũ hoặc số mới đang có grant quyền còn hiệu lực, hay số mới thuộc người khác (chỉ ghi log, không đổi gì kể cả `phoneVerifiedAt`). Lệch so với yêu cầu: không "bỏ qua `applyGrants` cho số mới" mà chặn việc đổi sang số có grant, vì `applyGrants` chạy ở mọi đăng nhập/refresh nên không có cách chỉ bỏ qua cho một lần; kết quả (tài khoản đang có số không lên quyền nhờ đổi số, chỉ tài khoản được gắn số lần đầu mới có đường này như cũ) giống nhau. `mergeGuestInto`: SĐT đích ghi SAU transaction gộp, trùng (P2002) chỉ bỏ qua phần số, không làm hỏng lần gộp.
- **N-B**: `linkClaimsByPhone` khoá người tạo của MỌI claim ngay sau khoá SĐT, đã sắp xếp và bỏ trùng, trước vòng lặp. Đã rà các chỗ khác: `ensureChatClaim` chỉ lấy một khoá người tạo (sau khoá SĐT đã sắp xếp), `releaseClaim` và `approve` không lấy khoá người tạo, nên không còn chỗ lấy nhiều khoá không sắp xếp. Thứ bậc khoá: SĐT (sắp xếp) rồi người tạo (sắp xếp), nhất quán ở mọi đường.
- **N-C**: liên kết mà `evaluateChatClaim` trả SKIP thì claim vào REVIEW với lý do "Kiểm lại khi liên kết SĐT: ..." (`CHAT_SKIP_TEXT`), điểm giữ mức đã kiểm, không cộng thô.
- **Nhỏ**: claim chưa có chủ mà `orderPhone` đã bị xoá (retention) khi tới hạn cộng vào REVIEW ("không còn SĐT để liên kết"), không HELD rồi LAPSED. Thay luật lượt 1 cho trường hợp này.

### Schema

Không thêm cột, không thêm migration (không có `20261019180000_*`).

### Giới hạn ghi thêm

- Điều kiện "có vận đơn" cho status 16 chỉ cần một phần tử `trackingCodes` dài 8 đến 30 ký tự là qua. Việc nhân viên có tự gõ được trường này trên Pancake hay không chưa kiểm, nên đây là rào cản yếu hơn vẻ ngoài.
- Liên kết đánh giá lại cả claim đã có người duyệt (`decidedById`): người duyệt chỉ miễn kiểm đổi SĐT, không miễn kiểm nhân viên, ngưỡng, người tạo đơn và SKIP, nên claim đã duyệt vẫn có thể quay lại REVIEW lúc liên kết.

### Ghi chú kiểm chứng lượt 2

`r12-merge-four-guests.race-spec.ts` (khớp pattern `merge`) đỏ không ổn định khi máy quá tải (load trung bình 30 đến 39): `ServiceUnavailableException` do thua tranh khoá gộp. Cùng spec, cùng DB, chạy hai lần liên tiếp thì lần đỏ lần xanh; với `auth.service.ts` của 99452048 (trước chatpts) và của bản này đều từng xanh, khi chạy riêng xanh 8 lần. Phần gộp khách không đọc `phone` khi Zalo không trả số (spec này luôn trả null), nên không có đường nào từ thay đổi lượt 2 tới ca đó. Coi là flake do tải, chưa chứng minh được nguyên nhân gốc.

## Sửa sau review lượt 3

Mã nguồn gốc của kết quả đỏ: 7234d1dc. Race mới `test/integration-race/external-chat-review3.race-spec.ts` (9 ca), chạy trên Postgres thật, đỏ 7/9 trước khi sửa (hai ca xanh là ca đã đúng sẵn: "tiền hàng tăng SAU duyệt" và "REVIEW vì lý do khác, duyệt không cần ghi chú").

### Kết quả đỏ trước khi sửa

- R5 (hạng tăng x2 sau khi qua kiểm): `releaseClaim` trả TO_REVIEW thay vì cộng 10.000. Kết hợp tiền hàng tăng với hạng tăng thì duyệt (dùng hệ số cũ) rồi cộng (hệ số mới) lại vào REVIEW: vòng REVIEW, PENDING, REVIEW.
- R6 (claim bị chốt trần 100.000 lúc liên kết, hạng x2 tính lại 200.000): TO_REVIEW thay vì cộng 100.000.
- "Tiền hàng và hạng cùng tăng": đỏ vì duyệt không lưu hệ số mới.
- "Tiền hàng giảm": `creditedGoodsValue` null sau khi tạo (cột mới chỉ được ghi lúc cộng).
- L2: danh sách thiếu trường thành viên; duyệt claim lý do SĐT cũ không có ghi chú vẫn qua.
- L3a: mốc xác minh cũ đi giữa lúc chờ, vẫn CREDITED.

### Luật mới (L1)

- Điểm chốt ở lần kiểm gần nhất (tạo, liên kết, duyệt) là điểm được cộng. `releaseClaim` không tính lại lên: hệ số lúc cộng = `min(hệ số hạng hiện tại, hệ số đã kiểm)`, điểm cộng = `min(điểm tính lại, điểm đã kiểm)`. Hạng giảm hay tiền hàng giảm thì điểm hạ theo; hạng tăng thì không.
- Chỉ vào REVIEW khi tiền hàng hiện tại của đơn lớn hơn tiền hàng đã kiểm. Mốc đã kiểm lưu ở cột có sẵn `creditedGoodsValue`, ghi ở `ensureChatClaim`, `linkClaimsByPhone` và `approve` (duyệt dùng tiền hàng và hạng HIỆN TẠI, lưu cả `multiplier`). Lúc cộng cột này ghi tiền hàng đã cộng (bằng hoặc thấp hơn mốc đã kiểm), nên `chatSpending12m` (chỉ đọc claim CREDITED) giữ nguyên nghĩa. Không thêm cột, không migration. Claim PHONE cũ có `creditedGoodsValue` null (không có trên PROD vì chưa deploy) rơi về luật cũ (điểm tính lại lớn hơn điểm đã kiểm thì REVIEW).
- Claim đơn sàn (SCAN) không đổi.

### Thông tin người nhận cho người duyệt (L2)

- `GET /admin/external-claims` và `/:id` thêm cho claim PHONE đã có chủ: `memberPhoneVerifiedAt`, `memberPhoneStale`, `memberCreatedAt`, `memberDeliveredAppOrders` (null với claim không phải PHONE hay chưa có chủ); tên thành viên là `userName` có sẵn. Kiểu thêm vào `AdminExternalClaimRow` (shared-types) ở dạng tuỳ chọn để không làm gãy chỗ khác dựng dữ liệu mẫu.
- `POST /admin/external-claims/:id/approve` nhận body tuỳ chọn `{ note }`. Claim có lý do "SĐT xác minh đã cũ" mà mốc còn cũ lúc duyệt: thiếu `note` thì 400 `NOTE_REQUIRED`; có thì ghi vào sự kiện APPROVE kèm dấu "SĐT xác minh cũ".
- Tab web: xem mục "Phần web của L2" bên dưới (làm sau khi gộp tip review).

### L3

- (a) Lúc cộng claim PHONE kiểm lại mốc xác minh của thành viên: cũ và claim chưa được duyệt kèm ghi chú sau lý do SĐT cũ thì vào REVIEW với lý do đó. Duyệt kèm ghi chú (dấu trong sự kiện APPROVE) thì cộng, không vòng lại.
- (b) Chỉ ghi nhận, không sửa: `applyGrants` (đăng nhập, `auth.service.ts` quanh dòng 368 đến 378) có thể chạy trên số cũ trong lúc người dùng đổi số, nên một grant theo số cũ có thể được cấp cho tài khoản vừa rời số đó.

### Giới hạn đã biết thêm

- Đơn tạo trước khi hạng tăng không được hệ số mới: điểm đã chốt ở hệ số lúc kiểm.
- Claim đã duyệt mà trước lúc cộng mốc xác minh SĐT mới cũ đi, và duyệt không phải vì lý do SĐT cũ, vẫn quay lại REVIEW một lần (duyệt lại thì cần ghi chú).

### Cần chủ quyết

- Mini App có nên xin lại SĐT định kỳ (để mốc `phoneVerifiedAt` không tự cũ sau 180 ngày) không? Hiện không đổi Mini App: mốc chỉ mới lại khi Zalo trả số, nên thành viên lâu không xin số lại sẽ luôn vào REVIEW chờ ghi chú.

### Phần web của L2 (sau khi gộp `review/2026-10-18-launch` tip 434afbf3)

Gộp không có xung đột; thứ tự migration giữ nguyên (`20261019150000_external_claim_event_order_status`, rồi `20261019160000_chat_order_points`, `20261019170000_chat_review1`, trước `20261020000000`).

- `apps/web/src/components/admin/external-claims-tab.tsx`: claim PHONE có chủ hiện dòng "Người nhận" (mốc xác minh SĐT giờ VN, ngày tạo tài khoản, số đơn app đã giao) cạnh lý do review; `memberPhoneStale` gắn nhãn cảnh báo "SĐT xác minh đã cũ, kiểm người nhận". Duyệt claim có lý do SĐT cũ (mốc vẫn cũ) mở hộp thoại ghi chú bắt buộc và gửi `{note}`; claim PHONE khác duyệt như cũ (không body). 400 `NOTE_REQUIRED` hiện câu tiếng Việt có sẵn.
- `lib/external-claims.ts`: `approveNeedsNote`, `PHONE_STALE_LABEL`, câu cho `PANCAKE_CREATOR_SELF` (mã lỗi đã có trong shared-types nhưng bảng câu chưa có, tsc đỏ sau khi gộp), nhãn sự kiện LINK_PHONE, HOLD_NO_MEMBER, LAPSE, PHONE_CHANGED. `lib/admin-client.ts`: `approveExternalClaim(id, note?)`.
- Vitest: 6 ca ở tab (hiện thông tin và nhãn, mốc mới, SCAN và chưa có chủ, duyệt kèm ghi chú, duyệt PHONE thường, 400 NOTE_REQUIRED) và 1 ca `approveNeedsNote`; chạy cả giờ VN lẫn `TZ=UTC`.
- Không chụp màn hình tab.

