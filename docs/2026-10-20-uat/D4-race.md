# D4-race — Đồng thời (race)

## Tóm tắt

Không có phát hiện P0 hoặc P1. Mọi luồng brief nêu đều có bảo vệ, và hầu hết đã có race spec trong `apps/api/test/integration-race`. Các luồng đó gồm: checkout và Idempotency-Key, webhook Pancake và đẩy Pancake, rút tiền (ví và hoa hồng), đổi điểm lấy quà, quay thưởng, điểm danh, điểm POS, mốc CTV, mốc giới thiệu, nhiệm vụ, season pass, nhận thẻ hộp (coupon CLAIM), quét mã tracking và đơn CSKH, đổi rác lấy quà (xác nhận, quà, lấy hàng), thưởng quý đại lý.

Các luồng trên dùng CAS updateMany, FOR UPDATE / FOR NO KEY UPDATE, advisory lock, unique index với ON CONFLICT DO NOTHING, hoặc Serializable.

Cron an toàn khi có nhiều instance. `CronLeaderService` (`common/cron-leader/cron-leader.service.ts`) giữ lease trong `cron_leases` bằng `now()` của Postgres, nên chỉ một instance chạy `@Cron`. Mọi cron liên quan tiền đều claim hàng nguyên tử, nên cùng cron chạy trên container cũ và mới lúc deploy không cộng tiền hay gửi tin hai lần. `API_CPUS=2` chỉ là hạn mức CPU cho một container (`docker-compose.vietnix.yml:78`).

Không có cache Redis. Redis chỉ dùng cho BullMQ và throttler. Cache trong bộ nhớ là SystemConfig (60s) và SessionState (5s); với một container thì không lệch.

BullMQ: ZNS retry kiểm tra trạng thái SENT trước khi gửi lại; Pancake retry tra đơn theo mã trước khi tạo.

Còn 5 vấn đề nhỏ, đều P3, đều nằm ở API (vùng phiên UAT), không có trong findings-catalog hay launch review. Xếp từ nặng đến nhẹ:
1. Đơn Pancake trùng do đọc cũ `pancakePushClaimedAt`.
2. Điểm danh Vườn Xanh ghi đè vé giữ lửa hoặc hồi sinh chuỗi vừa mua.
3. Payroll recompute ghi đè tổng của tháng đã FINALIZED/PAID.
4. Giới hạn số nhóm mua chung đang mở được kiểm tra ngoài lock.
5. Tự trả lời Zalo OA bị gửi lại khi job stalled.

Luồng chưa có race spec: waterTree, waterPlot, giftWater, answerQuiz, streak repair/freeze, adminRecordCreditPayment. Đọc mã: waterTree, waterPlot, adminRecordCreditPayment an toàn vì dùng Serializable. Các luồng còn lại là nước trong game, giá trị thấp.

Không chạy race spec nào (không dựng cluster tạm) vì mọi kết luận đến từ đọc mã và máy dùng chung đang bận (load khoảng 9–16).

## Phạm vi đã đọc

Đọc toàn bộ hoặc phần liên quan (`apps/api/src/...`):
- `common/cron-leader/cron-leader.service.ts`, `common/cron-leader/run-lease.ts`, `bootstrap.ts` (khởi động cron), mọi `@Cron` (46 job trong 36 file, đã liệt kê và kiểm tra claim).
- `modules/wallet/{wallet.service,wallet-ledger.service,reward-points.service}.ts`.
- `modules/loyalty/{loyalty.service (redeemReward, dailyCheckIn, creditPosPoints), loyalty-expiry.service (expirePoints), points-ledger}.ts`.
- `modules/game/{game.service (spin, waterTree, buyTree, claimMission), game-economy.service, game-garden.service, game-gift.service, game-quiz.service, game-collection.service, season-pass.service (claim)}.ts`.
- `modules/coupons/{coupon-claim.service, coupons.service redeem/release}.ts`.
- `modules/cashback/cashback.service.ts`.
- `modules/affiliate/affiliate.service.ts` (requestPayout, approve/reject/markPayoutPaid, claimMilestone, approveDueCommissions).
- `modules/dealer/dealer.service.ts` (adminRecordCreditPayment, payoutQuarterlyBonuses), `modules/dealer/dealer.cron.ts`.
- `modules/groupbuy/groupbuy.service.ts`.
- `modules/orders/customer-refunds.service.ts` (markPaid, chooseDestination).
- `modules/subscriptions/subscriptions.service.ts` (processDue).
- `modules/lifecycle/remarketing.service.ts`.
- `modules/flash-sale/flash-sale.service.ts` (cron thông báo).
- `modules/feed/community-reward.service.ts`, `modules/storefront/storefront-quest.service.ts`, `modules/brand/brand.service.ts` (follow).
- `modules/staff/payroll/payroll.service.ts`, `modules/staff/shifts/shifts.service.ts` (approve).
- `modules/waste-exchange/{catalog/waste-gift-redemptions.service, pickup/waste-pickup-attach, pickup/waste-pickup-hooks.service}.ts`.
- Phần diff PR #21 về checkout, auth, order-status, account-deletion.
- `modules/integrations/payment/bank-transfer.service.ts`.
- `modules/integrations/pancake/{pancake-push.processor, pancake-order.service pushOrder}.ts`.
- `modules/integrations/zalo-oa/{webhook.controller, events.processor}.ts`.
- `modules/notifications/{notifications.processor, notifications.service deliverZns}.ts`.
- `modules/auth/session-state.service.ts`, cache SystemConfig, migration unique index trên `points_transactions`.
- Grep mọi client gửi Idempotency-Key (web, miniapp, app-core), grep độ phủ race spec theo từng luồng, đối chiếu `findings-catalog.md` và `docs/2026-10-18-launch-review` (không có phát hiện nào trùng).

Chỉ đọc phác thảo (điểm đồng thời), không đọc từng dòng: `modules/external-points/*`, `modules/reviews/reviews.service.ts`.

Chưa đọc kịp: `merchant/*` (fulfilment, payouts), `order-reversal.service`, `order-returns.service`, toàn bộ `checkout.service` (chỉ đọc phần idempotency và pickup), toàn bộ `auth mergeGuestInto`, phần còn lại của waste-exchange (receiving/confirm/quota), `staff/attendance`, analytics, data-retention, catalog/pancake-sync stock. Các vùng này đã có nhiều race spec.

Chưa chạy: race spec, jest, truy vấn SELECT vào DB UAT. Mọi kết luận đến từ đọc mã.

## Bảng phát hiện

Chưa có kết quả soát chéo, nên mọi dòng ghi "chưa soát" và mức sau soát giữ nguyên mức gốc.

### P0

Không có.

### P1

Không có.

### P2

Không có.

### P3

| ID | Mức (sau soát) | Soát chéo | Nhóm | Vùng | Vị trí | Mô tả + kịch bản | Đề xuất sửa + test |
|---|---|---|---|---|---|---|---|
| D4-01 | P3 | chưa soát | agent sửa ngay | UAT | `apps/api/src/modules/integrations/pancake/pancake-order.service.ts:177`; `:237-251`; `:262-270`; `:274-281` | Pancake push: quyết định "đã thử trước đó thì tra đơn trước" dùng `pancakePushClaimedAt` đọc trước khi claim, nên có thể tạo đơn trùng trong kho. Đơn X chưa từng đẩy (claimedAt = null). Tiến trình A (job push) và B (cron pancake-push-reconcile hoặc "Đẩy lại Pancake" thủ công) cùng đọc X ở dòng 177 với claimedAt null. A claim trước (PUSHING, claimedAt=now), gọi createOrder, Pancake tạo đơn nhưng A gặp lỗi tạm (ECONNRESET/502). Catch ở dòng 274 đặt lại PENDING và giữ claimedAt. B tới claim ở dòng 237: trạng thái không còn PUSHING nên count=1. B kiểm tra `order.pancakePushClaimedAt` từ lần đọc cũ (null), bỏ qua findOnPancake (dòng 262) và gọi createOrder lần nữa. Kết quả: hai đơn Pancake cho một đơn Tubu, có thể đóng và giao hai lần. Cửa sổ hẹp, hậu quả giao hàng hai lần. | Sau khi claim thành công, quyết định tra đơn từ dữ liệu DB, không từ lần đọc cũ. Ví dụ đọc lại hàng và tra đơn khi `pancakePushAttempts > 1` (claim tăng attempts) hoặc `pancakePushClaimedAt` trong DB sớm hơn `now`. Hoặc claim bằng raw SQL `UPDATE ... RETURNING` lấy giá trị claimedAt cũ. Test race: mock client Pancake để createOrder lần đầu tạo đơn rồi ném lỗi tạm; chạy pushOrder thứ hai sau khi nó đọc nhưng trước khi A claim (hook vào variationsOf); kỳ vọng đúng 1 lần createOrder và 1 lần findOnPancake ở lần chạy thứ hai. |
| D4-02 | P3 | chưa soát | agent sửa ngay | UAT | `apps/api/src/modules/game/game-economy.service.ts:32`; `:95-109`; `:178-188`; `:197-200` | Điểm danh Vườn Xanh ghi `streakFreezes`/`streakDays` là giá trị tuyệt đối từ lần đọc trước update, xóa mất vé giữ lửa hoặc hồi sinh chuỗi người dùng vừa trả nước. (a) Người dùng bấm "Mua vé giữ lửa" và "Điểm danh" sát nhau. checkIn đọc streakFreezes=0 (dòng 32). buyStreakFreeze commit (−80 nước, streakFreezes=1). updateMany của checkIn (WHERE chỉ theo lastCheckInAt) vẫn khớp và ghi `streakFreezes: 0`: vé mất, 80 nước vẫn bị trừ. (b) Ngày sau khi chuỗi đứt (streakDays=1, brokenStreakDays=10), người dùng bấm "Hồi sinh chuỗi" và "Điểm danh" cùng lúc. repairStreak commit trước (−150 nước, streakDays=11, brokenStreakAt=null). checkIn tính từ p cũ (gap=1 thì streakDays=2), WHERE vẫn khớp nên ghi streakDays=2: trả 150 nước, chuỗi là 2 thay vì 12. Là nước trong game (không phải tiền), tác động thấp; lost update thật, chưa có race spec. | Đặt checkIn trong `$transaction` với `SELECT ... FROM game_profiles WHERE userId=$1 FOR UPDATE`, rồi tính streak từ hàng đã khóa. Hoặc thêm điều kiện CAS vào WHERE (`streakDays: p.streakDays, streakFreezes: p.streakFreezes, brokenStreakAt: p.brokenStreakAt`) và đọc lại/thử lại khi count=0 (làm tương tự cho repairStreak). Test race: chạy song song checkIn và buyStreakFreeze 20 lần; streakFreezes sau = trước + 1 − (1 nếu có dùng vé). |
| D4-03 | P3 | chưa soát | agent sửa ngay | UAT | `apps/api/src/modules/staff/payroll/payroll.service.ts:172-203`; `:207-209`; `:318-326` | Payroll recompute chạy không khóa, có thể ghi đè tổng của tháng đã FINALIZED/PAID. Nhân viên mở "Lương của tôi" (getMyPayroll gọi recomputeStaffMonth). Ở dòng 177 thấy tháng OPEN và bắt đầu tính lại ngày từ dữ liệu cũ. Trong lúc đó admin thêm điều chỉnh (ví dụ trừ 500.000đ) rồi bấm "Đã chi" (markPaid tính lại có điều chỉnh và chuyển PAID với net mới). Recompute của nhân viên xong sau đó, upsert ở dòng 198 (nhánh update không có điều kiện status) ghi lại gross/net tính không có điều chỉnh. Kết quả: tháng PAID có net trong DB khác số đã chuyển, và từ đó recompute bị chặn vì tháng đã PAID. Tương tự khi hai admin xem adminMonth (dòng 276) trong lúc admin khác finalize. | Đổi nhánh update của upsert thành `updateMany({ where: { staffId, year, month, status: 'OPEN' }, data: {...} })` (chỉ create khi hàng chưa tồn tại), và bảo vệ payrollDay.upsert tương tự; hoặc đặt recompute + markPaid/finalize dưới advisory lock theo (staffId, year, month). Test: mock hoặc xen kẽ getMyPayroll dừng sau dòng 177 trong khi markPaid chạy; net sau == net lúc đặt PAID. |
| D4-04 | P3 | chưa soát | agent sửa ngay | UAT | `apps/api/src/modules/groupbuy/groupbuy.service.ts:77-81`; `:93-105` | Giới hạn "số nhóm mở tối đa mỗi người" của mua chung được đếm ngoài transaction và lock, nên các request song song vượt qua. `groupbuy.max_open_per_user=3`. Tài khoản thật (có số điện thoại) gửi 10 request song song POST tạo nhóm (sản phẩm khác nhau hoặc giống nhau). Tất cả chạy count() trả 0..2 trước khi create nào commit, nên tạo ra 10 nhóm OPEN. Comment nói giới hạn để chặn spam tạo nhóm. Không mất tiền trực tiếp (thành viên vẫn phải là tài khoản thật, coupon chỉ áp cho sản phẩm của nhóm) nên P3. | Đặt count + create trong `$transaction` với `pg_advisory_xact_lock(hashtext('groupbuy.open:'||userId))` trước count. Test race: 10 lần tạo song song cùng một user; số nhóm OPEN == max_open_per_user. |
| D4-05 | P3 | chưa soát | agent sửa ngay | UAT | `apps/api/src/modules/integrations/zalo-oa/zalo-oa-events.processor.ts:30-46` | Tự trả lời Zalo OA bị gửi lại khi job BullMQ stalled sau sendText nhưng trước khi ghi trạng thái. Worker gửi trả lời (dòng 42) rồi tiến trình khởi động lại (deploy, OOM) trước khi update REPLIED ở dòng 43. BullMQ thấy job stalled và xử lý lại. Sự kiện vẫn là RECEIVED (dòng 32 qua) nên khách nhận cùng tin hai lần. Chỉ với tự trả lời theo từ khóa; lời chào đã được OaGreetedUser bảo vệ (khi retry, matchTemplate rơi xuống greetingIfFirstMessage, P2002, null, SKIPPED, nên lời chào không gửi hai lần). | Claim trước khi gửi: `updateMany({ where: { id, status: 'RECEIVED' }, data: { status: 'PROCESSING' } })`, chỉ gửi khi count=1 (chấp nhận mất một tin trả lời khi crash, phù hợp với auto-reply). Unit test: chạy process() hai lần trên cùng sự kiện; lần hai không được gọi sendText. |

## Chi tiết P0/P1

Không có phát hiện P0 hoặc P1.

## Bằng chứng các phát hiện P3 (tham khảo)

- D4-01: Dòng 177 `const order = await this.prisma.order.findUniqueOrThrow(...)` đọc một lần trước claim. Dòng 262 `if (order.pancakePushClaimedAt) { const found = await this.findOnPancake(order); ...}` dùng giá trị cũ dù claim ở dòng 237 chỉ thành công sau khi tiến trình khác đã đặt claimedAt. Dòng 279 giữ claimedAt khi lỗi tạm: `...(definite && !order.pancakePushClaimedAt ? { pancakePushClaimedAt: null } : {})`. Chưa kiểm tra `pancake-push.race-spec.ts` có phủ trường hợp hai pusher cùng đọc trước khi cái đầu claim hay không.
- D4-02: Dòng 95-108 `updateMany({ where: { userId, OR: [{ lastCheckInAt: null }, { lastCheckInAt: { lt: startOfDay } }] }, data: { totalSeeds: { increment: seeds }, streakDays, streakFreezes, longestStreak: ..., brokenStreakDays, brokenStreakAt } })`. `streakDays` và `streakFreezes` lấy từ `p`, đọc ngoài transaction ở dòng 32. buyStreakFreeze dòng 199 dùng `streakFreezes: { increment: 1 }`; repairStreak dòng 182 ghi `streakDays: newStreak`. Không có gì tuần tự hóa chúng với checkIn. Grep buyStreakFreeze/repairStreak trong integration-race không thấy gì.
- D4-03: Dòng 177 `if (existing && (existing.status === 'FINALIZED' || existing.status === 'PAID')) return existing;` chỉ kiểm tra một lần ở đầu. Dòng 198 `return this.prisma.payrollMonth.upsert({ where: {...}, update: { totalMinutes, gross, totalFines, net }, create: {...} })` không có điều kiện status. recomputeDay được gọi với `monthAlreadyChecked: true` (dòng 190) nên cũng không kiểm tra lại.
- D4-04: Dòng 78 `const openCount = await this.prisma.groupBuy.count({ where: { initiatorId: userId, status: 'OPEN', ... } })`, dòng 79 so sánh, dòng 93 `this.prisma.groupBuy.create(...)` không có transaction, lock hay ràng buộc unique giới hạn số lượng. Không có race spec cho groupbuy.create (chỉ có groupbuy-expiry-notify và partner-goods-rules). Launch review (`impl/democlean.md:165`) chỉ sửa điều kiện đếm, không sửa race.
- D4-05: Dòng 32 `if (!event || event.status !== 'RECEIVED') return;`, dòng 42 `const sent = await this.client.sendText(...)`, dòng 43 `update({ data: { status: sent ? 'REPLIED' : 'FAILED' } })`. Không có bước claim trung gian (RECEIVED sang PROCESSING).

## Bỏ sót do soát chéo phát hiện

Không có (chưa có dữ liệu soát chéo).

## Đã bác bỏ

Không có.
