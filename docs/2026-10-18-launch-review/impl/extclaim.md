# extclaim: B6 bước 2, phần API (tích điểm đơn sàn bằng mã vận đơn)

Nhánh `lr2/extclaim` (từ `3552c368`). Kế hoạch gốc `extpoints-plan.md`, bước 1 ở `extorders-1.md`. Phạm vi gói này là API: không có UI miniapp và UI web admin (gói sau). Mọi đường cộng điểm nằm sau `loyalty.marketplace_claim_enabled` = false.

## Đã làm

- Hợp đồng kiểu cho UI: `packages/shared-types/src/external-points.ts` (request/response miniapp và admin, mã từ chối ổn định `ExternalClaimRejectCode`).
- Public config: `loyalty.marketplaceClaimEnabled` (chỉ boolean true thật mới bật) và `loyalty.marketplaceEarnPct` (cạnh `earnPct`, hỏng thì 1).
- Luật claim (hàm thuần `external-claim.rules.ts`, `evaluateClaimRules`): cờ, khách đủ điều kiện (thật, có SĐT, không khoá), khoá 24h sau 5 lần không tìm thấy, lần thử/ngày, mã trùng `orders.shippingCode`/`gomdonPartnerCode`, có đơn không (UNMATCHED), loại đơn (CHAT từ chối, UNKNOWN vào hàng admin), `external_since` rồi tuổi đơn, trạng thái đơn, mã đã được tích, trần claim/ngày, trần điểm/tháng, rồi REVIEW (thiếu tiền hàng, vượt ngưỡng, 3 số cuối SĐT khác) hoặc PENDING. Luật đứng trước thắng.
- `ExternalClaimService.submit`: toàn bộ luật chạy trong một transaction giữ `pg_advisory_xact_lock(hashtext('ext-claim:'+userId))`, khoá dòng `external_orders` FOR UPDATE trước khi đọc claim, claim chèn bằng `createManyAndReturn({skipDuplicates})` (không dùng bắt P2002 trong transaction, tránh 25P02). Lỗi nghiệp vụ trả ra từ transaction rồi mới ném, nên attempt `REJECTED_*` được commit. Cờ tắt, khách không đủ điều kiện, khoá 24h, hết lần/ngày không ghi attempt.
- Tra Pancake khi chưa có mã (`ExternalClaimLookupService`, cờ `pancake.external_lookup_enabled` = false): `searchOrders(code, 5s)` NGOÀI transaction, chỉ nhận đơn mang đúng mã, ngắt mạch 3 lỗi thì nghỉ 5 phút (trong bộ nhớ).
- Cron ghép lại attempt UNMATCHED (`rematchUnmatched`, 3 ngày, 50 mỗi lượt): khớp thì tạo claim, không đủ điều kiện thì đóng attempt và báo `EXTERNAL_POINTS_CLAIM_NOT_FOUND`. Quá 3 ngày không ghép được thì ngừng thử và hiện ở "Cần xử lý".
- Kéo dự phòng (`ExternalClaimPollService`, cờ `pancake.external_poll_enabled` = false, `RunLease`, tối đa 20 trang, mỗi 10 phút) với `PancakeClient.listUpdatedOrders`.
- Cron cộng điểm 30 phút (`external-claim-release.ts`): `pg_try_advisory_xact_lock('external-points.release')`, mỗi claim một transaction (khoá claim rồi users), `PENDING -> CREDITED` có điều kiện, kiểm lại đơn DELIVERED đủ `loyalty.external_pending_days`, tính lại điểm theo tiền hàng mới nhất rồi chốt, `applyPointsDelta(skipDuplicates)` với `refType='EXTERNAL_ORDER'`, `refId = id claim`, hạn theo `loyalty.point_expire_months`. Tiền hàng mất, tài khoản khoá hay đã xoá thì chuyển REVIEW, không cộng.
- `applyStatusToClaim` (`external-claim-status.ts`) nối vào mọi đường nạp qua `ingestAndApply` (webhook ở `pancake.processor.ts`, tra theo mã, kéo dự phòng). 4 giữ; 5/6/7 chưa cộng thì VOIDED, đã cộng thì REVERSED (thu hồi `min(điểm, lotRecoverable, số dư)`); 15 chưa cộng thì REVIEW, đã cộng thì gắn cờ vào "Cần xử lý"; giao sau khi hệ thống tự huỷ thì REVIEW; giao thì đồng bộ `releaseAt`. Không bao giờ ném ra đường webhook.
- `EXTERNAL_RULE` trong `loyalty-expiry.service.ts`: dòng dương `refType='EXTERNAL_ORDER'` (`MARKETPLACE_ORDER:`, `PANCAKE_CHAT_ORDER:`) tạo lô `EXTERNAL:<refId>`, dòng `*_REVERSED:` cùng refId thu hồi đúng lô.
- Thông báo INAPP `EXTERNAL_POINTS_PENDING | CREDITED | VOIDED | CLAIM_NOT_FOUND` (migration `20261019130000_external_claims` và `prisma/seed.ts`, sửa tối thiểu: 4 dòng mẫu).
- Hàng "Cần xử lý": khoá `externalPoints` trong `ops-inbox.service.ts` (nhóm CSKH; ADMIN thấy hết) = claim REVIEW + attempt UNMATCHED quá 3 ngày hoặc đã thấy đơn nguồn lạ + claim đã cộng mà đơn hoàn một phần. Web hiện bỏ qua khoá lạ nên chưa đổi UI.

## API

Miniapp (đăng nhập, không `@Roles`):
- `POST /me/external-points/claims {code}` (`@Throttle` 10/phút). 200 với `status` `CLAIMED | REVIEW | SEARCHING` và chỉ trả sàn, mã che, điểm chờ, `expectedCreditAt`. Từ chối là `HttpException` có `code` (404 DISABLED, 403 NOT_ELIGIBLE_USER, 400 INVALID_CODE/TOO_OLD/BEFORE_SINCE/CLOSED/ZERO_POINTS, 409 APP_ORDER/CHAT_ORDER/ALREADY_CLAIMED, 429 LOCKED/DAILY_ATTEMPTS/DAILY_MAX/MONTHLY_CAP) kèm `message` tiếng Việt.
- `GET /me/external-points/claims?page=&limit=` (`MyExternalClaimsResponse`: sàn, mã che, điểm, trạng thái, mốc dự kiến cộng; trang 1 kèm `searching`). Không SĐT, không payload.

Admin (`/admin/external-claims`, ADMIN hoặc nhóm CSKH; KE_TOAN chỉ GET):
- `GET /`, `GET /attempts`, `GET /:id` (CSKH, KE_TOAN; SĐT qua `maskPhoneOrNull`).
- `POST /:id/approve` (REVIEW sang PENDING, tính lại điểm theo tiền hàng đơn), `POST /:id/void {reason}`, `POST /:id/void-and-reopen {reason}`, `POST /attempts/:id/attach {pancakeOrderId}`, `POST /attempts/:id/reject {note?}` (CSKH).
- `POST /:id/reverse {reason}`: chỉ ADMIN (`@AllowStaff()` rỗng ở handler ghi đè nhóm của lớp). Cập nhật ma trận quyền ở `staff-permissions.matrix.spec.ts` (bảng route và `MONEY_WRITES`).
- "Huỷ và mở lại mã": claim VOIDED với `claimedCode = null` và `decidedById` có giá trị; lần gửi mã kế tiếp (của bất kỳ khách) tái sử dụng chính dòng claim đó (vì `externalOrderId` unique). Huỷ thường giữ `claimedCode` nên chặn mã.
- Gắn attempt: nhân viên đã xác minh nên bỏ qua trần ngày/tháng và tuổi đơn, claim vào thẳng PENDING; đơn UNKNOWN được nâng thành MARKETPLACE.

## Khoá cấu hình mới (reference-data, `config-selection.ts`)

| Khoá | Mặc định |
| --- | --- |
| `loyalty.marketplace_claim_enabled` | false |
| `loyalty.marketplace_earn_pct` | 1 (phần trăm, như `loyalty.earn_pct`) |
| `loyalty.marketplace_claim_daily_attempts` | 10 |
| `loyalty.marketplace_claim_daily_max` | 3 |
| `loyalty.marketplace_claim_monthly_points_cap` | 200000 |
| `loyalty.marketplace_claim_max_age_days` | 60 |
| `loyalty.marketplace_claim_review_above_vnd` | 2000000 |
| `loyalty.external_pending_days` | 14 |
| `loyalty.external_since` | null (dòng tạo bằng migration vì EXTRA_CONFIGS không nạp được null; để null thì chỉ áp tuổi đơn tối đa) |
| `pancake.external_lookup_enabled` | false |
| `pancake.external_poll_enabled` | false |

Có luật ghi (boolean chặt, khoảng số) ở `system-config.service.ts`. Điểm = `pointsForGoods(goodsValue, marketplaceEarnPct, 1)`, không nhân hệ số hạng. Đơn sàn không vào `tierPoints` (whitelist chỉ `ORDER_DELIVERED:`) nên không đổi hạng; claim ghi `countsForTier = false`.

## Schema (bước 1) và thay đổi sau review

Bước 1 đã tạo `external_points_claims`, `external_claim_attempts` và unique sổ điểm `("reason","refId") WHERE "refType"='EXTERNAL_ORDER'`. Migration `20261019130000_external_claims` chỉ thêm mẫu thông báo và dòng `loyalty.external_since`.

## Giả định chưa kiểm bằng payload thật

- `search` của `GET /orders` có tìm theo mã vận đơn không (tra theo mã chỉ hoạt động nếu có).
- `listUpdatedOrders`: tham số `updateStatus=updated_at`, `startDateTime` (đang gửi epoch GIÂY), `order_sources[]` theo Open API, chưa thấy phản hồi thật; phản hồi không có `data` là lỗi tạm.
- Mọi giả định của bước 1 (múi giờ `status_history`, công thức `goodsValue`, `marketplace_id` -3/-4/-9) quyết định mốc cộng và số điểm.
- Mã vận đơn so với `orders.shippingCode`/`gomdonPartnerCode` bằng `equals` không phân biệt hoa thường trên giá trị đã chuẩn hoá (chữ hoa, bỏ khoảng trắng và gạch). Mã lưu có gạch trong bảng đơn app sẽ không khớp.

## Giới hạn

- Gộp phiên khách (`mergedIntoId`) chưa xử lý cho claim: claim đi theo `userId` ghi lúc claim; khách thật có SĐT không bị gộp trong luồng hiện tại. Tài khoản đã xoá thì claim chuyển REVIEW lúc cộng.
- Ngắt mạch tra Pancake giữ trong bộ nhớ từng instance.
- Claim `HELD_NO_MEMBER`, `LAPSED`, kind `PHONE` và đơn CHAT thuộc bước 3, chưa có đường tạo.
- Xoá SĐT về null 7 ngày sau claim cuối thuộc bước 3.
- UNKNOWN qua `submit` không tạo claim: ghi attempt UNMATCHED kèm `externalOrderId` để hiện ở "Cần xử lý", nhân viên gắn tay.
- Chưa có kiểm thử kết nối Pancake thật; unit test mock client.
- `note` của nhân viên (attach, keep-points, lý do huỷ) có thể chứa SĐT hoặc tên và nhật ký `external_claim_events` không bị xoá khi xoá tài khoản.
- Hai CSKH thông đồng (một người gắn hoặc mở lại mã, người kia duyệt) thì không chặn được; nhật ký ghi đủ người và thời điểm để truy.
- Web lint đang đỏ sẵn ở `apps/web/src/components/admin/commission-rates-tab.tsx:452` (file không thuộc gói này, đỏ cả ở `3552c368`).

## Kiểm thử

- Unit: `external-claim.rules.spec.ts` (thứ tự luật, khoá 24h), `external-points-rate.spec.ts` (biên làm tròn, goodsValue null), `external-claim-status.spec.ts` (4/5/6/7/15, giao sau huỷ), `external-claims-admin.spec.ts` (phân quyền), `external-claim.service.spec.ts`, `external-claim.config.spec.ts`, mở rộng `loyalty-expiry.service.spec.ts`, `ops-inbox.service.spec.ts`, ma trận quyền, public config.
- Race trên Postgres thật `test/integration-race/external-claims.race-spec.ts`: hai (sáu) khách cùng mã đúng một claim; một khách tám mã song song đúng 3 claim (trần ngày) và trần tháng đúng; cron cộng hai lần song song cộng sáu lượt `releaseClaim` đúng một dòng sổ; cộng rồi hoàn đảo đúng `min(...)` (đủ số dư, đã tiêu bớt, lô đã hết hạn cron đã trừ, đảo trước rồi hết hạn); đơn sàn không đổi `tierPoints`; webhook nối vào claim; ghép lại; admin huỷ, mở lại mã, đảo điểm, gắn attempt.

## Sửa sau review lượt 1

Schema đổi: thêm model `ExternalClaimEvent` (bảng `external_claim_events`) ngay sau `ExternalClaimAttempt`, migration `20261019140000_external_claim_events`. Repo chưa có cơ chế nhật ký chung cho loại việc này (chỉ có `SystemConfigHistory`, `OrderStatusHistory`...), nên tạo bảng chỉ-thêm riêng: có trigger chặn UPDATE. Không có khoá ngoại để nhật ký còn sau khi xoá claim. Mỗi dòng: claimId, action, actorId, fromState/toState, userIdBefore/userIdAfter, note, createdAt. Ghi trong CÙNG transaction với thay đổi claim. Các action: CLAIM_CREATED, REOPEN_CLAIM (khách nhận lại mã đã mở), ATTACH, APPROVE, VOID, VOID_REOPEN, REVERSE, KEEP_POINTS, CREDIT (cron), AUTO_VOID, AUTO_REVERSE, TO_REVIEW, FLAG_PARTIAL. `GET /admin/external-claims/:id` trả thêm `events`.

- A1 gắn đơn: mã của lần gửi (đã chuẩn hoá) phải nằm trong `trackingCodes`/`trackingCode`/`marketplaceOrderSn` của đơn; không trùng thì chỉ ADMIN và bắt buộc `note` (`ATTACH_ADMIN_ONLY`, `NOTE_REQUIRED`). Đơn UNKNOWN cũng chỉ ADMIN + note và KHÔNG đổi `source` của dòng đơn. Chạy đủ luật gửi mã (tuổi, `external_since`, trần claim/ngày, trần tháng từ chối, ngưỡng 2.000.000, 3 số cuối SĐT, thành viên là nhân viên) trừ lần thử/ngày; REVIEW giữ REVIEW và `decidedById` chỉ đặt khi vào thẳng PENDING. Người làm trùng chủ claim bị chặn ở attach, approve, void, void-and-reopen, reverse, keep-points (`SELF_ACTION`). Người duyệt không được là người gắn hoặc người đưa claim vào REVIEW (`SAME_INTRODUCER`, đọc từ nhật ký). STAFF/ADMIN tự gửi mã của mình vào REVIEW với lý do riêng. Duyệt kiểm lại trần tháng.
- A2 thứ tự khoá: đơn (FOR SHARE hoặc UPDATE) trước, claim sau, user cuối, ở mọi đường. `releaseClaim` khoá đơn rồi mới kiểm tới hạn/trạng thái; `applyStatusToClaim` chạy trong transaction (khoá, đọc lại, quyết định, thử lại tối đa 3 lần), claim CREDITED đi nhánh đảo điểm. "Cần xử lý" thêm mục "đã cộng mà đơn đã đóng". Race `external-claims-close-race.race-spec.ts` (30 vòng x RETURNED/CANCELLED): đỏ ở mã cũ (CREDITED + đơn đóng không ai đảo), xanh sau sửa.
- B1: duyệt claim của đơn PARTIAL_RETURN đặt `releaseAt = bây giờ + external_pending_days`; cron cộng claim có người duyệt khi đơn DELIVERED hoặc PARTIAL_RETURN, điểm theo tiền hàng mới nhất. Claim PENDING không ai duyệt của đơn hoàn một phần không được cộng.
- B2: `POST /admin/external-claims/:id/keep-points` (ADMIN, `note` bắt buộc): gỡ cờ, ghi KEEP_POINTS, không thu hồi một phần, không bị gắn cờ lại.
- B3: lúc cộng, nếu điểm tính lại lớn hơn điểm đã qua kiểm và (tiền hàng vượt ngưỡng REVIEW hoặc cộng thêm vượt trần tháng) thì claim chuyển REVIEW thay vì cộng.
- C1: `loyalty.external_since` dạng `YYYY-MM-DD` là 00:00 giờ Việt Nam (+07:00).
- C2: gửi lại mã của chính mình (claim PENDING/REVIEW/CREDITED hoặc mã đang chờ ghép) trả trạng thái hiện có, không ghi NOT_FOUND, không tính vào khoá 24h.
- C3: cron ghép lại gặp ALREADY_CLAIMED với claim của chính khách thì đóng lần thử, không báo "chưa tìm thấy".
- C5: chặn trùng theo mã: có claim còn hiệu lực (khác VOIDED) trên đơn khác cùng mã vận đơn/mã đơn sàn thì ALREADY_CLAIMED.

Kiểm thử thêm: `external-claims-review.race-spec.ts` (A1, tự xử lý, nhật ký chỉ-thêm và dấu vết mở lại mã, B1, B2, B3, C5), mở rộng rules/service/config/admin/ma trận quyền/ops-inbox spec. Chỉ A2 được chứng minh đỏ trước khi sửa; các test A1/B/C viết cùng lúc với sửa, chưa chạy lại trên mã cũ.

## Sửa sau review lượt 2

Không đổi schema, không đổi hợp đồng kiểu (không thêm giá trị enum); lý do REVIEW mới chỉ là chuỗi `reviewReason`.

- N1: người làm VOID_REOPEN được tính là người đưa claim vào (`claimIntroducers`), nên không duyệt được claim đó. Nhận lại mã đã mở lại luôn vào REVIEW ("Mã được nhân viên mở lại, cần người khác duyệt"), kể cả đơn không có 3 số cuối; luật này dùng chung cho gắn đơn.
- N2: gửi mã hoặc gắn vào đơn PARTIAL_RETURN thì claim vào REVIEW, duyệt đặt `releaseAt` như B1. Rà trạng thái khác và thêm lưới an toàn vào "Cần xử lý" cho claim PENDING không có đường tới hạn: đơn OPEN/RETURNING quá 60 ngày kể từ lúc claim, đơn DELIVERED thiếu `deliveredAt`, đơn PARTIAL_RETURN chưa ai duyệt hoặc thiếu `releaseAt`.
- N3: `settlePoints = min(điểm mới, max(điểm đã kiểm, trần - điểm các claim khác))`; điểm của chính claim không bị tính hai lần vì tổng tháng loại trừ claim này. Lúc cộng: chỉ vượt trần (không vượt ngưỡng REVIEW) thì cộng ở mức chốt; vượt ngưỡng REVIEW vẫn REVIEW. Lúc duyệt: duyệt ở mức chốt, chỉ ném MONTHLY_CAP khi không còn chỗ (chốt = 0). Mức chốt ghi vào nhật ký (CREDIT/APPROVE).
- C5: chỉ so mã khách gửi (không còn so cả `trackingCodes` của chính đơn); bỏ qua khi hai đơn đều có `marketplaceOrderSn` và khác nhau.
- `forbidSelf` và kiểm người duyệt quy hai phía qua `mergedIntoId` về user gốc (tối đa 5 bước).

Test đỏ trước khi sửa (chạy trên mã của commit `ac4b0a9b`, `external-claims-review.race-spec.ts`, nhóm "review lượt 2"): 7 test đỏ, đủ cho N1, N2 (REVIEW và lưới an toàn), N3 (cộng và duyệt), C5 và mergedIntoId. Sau sửa: 40/40 test của `external-claims*` xanh. Hai test cũ đổi kỳ vọng theo hành vi mới: (h) nhận lại mã mở lại giờ vào REVIEW; B3 vượt trần giờ cộng ở mức chốt 3.000 thay vì REVIEW.

