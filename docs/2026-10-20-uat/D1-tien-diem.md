# D1-tien-diem — Tiền, điểm, ví, hoa hồng

## Tóm tắt

Rà góc tiền, điểm, ví và hoa hồng trên nhánh uat/2026-10-20 (05e6ae97). Các đường lõi đã được nhiều đợt review trước làm kỹ. Lần này không tìm ra lỗi mới ở đó.

Đã đọc các phần sau.
- Công thức tích điểm: 2% × hệ số hạng, tính bằng số nguyên. Ví dụ 199.000đ ra 3.980 điểm.
- Trần 20%, chia lô STANDARD/CONVERTED, trừ điểm nguyên tử trong tx kèm lockedOrderPoints.
- Cộng/đảo điểm đơn đều idempotent, có unique index.
- Hoàn tiền, điểm, mã, kho, suất flash khi huỷ và khi trả một phần.
- Hoa hồng: 8% mặc định, chỉ AFFILIATE/DEALER, hàng gian hàng đối tác ra 0, giữ 10 ngày, chỉ chốt khi đơn còn DELIVERED.
- Rút ví và rút hoa hồng: chống âm, chống rút trùng, idempotency.
- Webhook Pancake chuyển khoản: thiếu tiền, thừa tiền, tiền về muộn.
- Đơn sàn 1% không hệ số, không tính hạng. Đơn CSKH B9 theo SĐT giữ 30 ngày.
- Đổi rác cộng/thu hồi. Thẻ hộp hàng sàn. Migration points_1d nhân 1.000.
- Số liệu cấu hình trên DB UAT khớp các quyết định A6, A7, A8, B9.

Lỗi thật nằm ở chỗ các nhóm trên chưa phủ: các khoản thưởng không gắn với sổ điểm của đơn nhưng xét điều kiện bằng đơn DELIVERED. Đó là thưởng đánh giá, nhiệm vụ FIRST_ORDER/REVIEW_3 và voucher mốc chi tiêu. Ba khoản này cấp ngay khi đơn vừa giao (còn trong 7 ngày đổi trả). Điểm tiêu được ngay. Trả cả đơn thì không thu hồi. Đã tra findings-catalog và launch-review: chưa ai báo.

Thêm hai mục cần chủ quyết: đơn đại lý và đơn CTV lên hộ đang tính vào hạng và mốc chi tiêu; ngưỡng TNCN 2 triệu xét từng lần rút.

Chưa chạy test nào. Mọi kịch bản suy từ mã (có path:line), chưa tái hiện trên DB. DB UAT trống: 0 user, 0 đơn. Các truy vấn đối soát sổ điểm và sổ ví trả 0 dòng lệch, nhưng chỉ vì DB chưa có dữ liệu.

## Phạm vi đã đọc

Đã đọc kỹ:
- checkout/checkout.service.ts (placeOrder, compute, shipmentTerms), checkout-split.ts (chặn phương thức thanh toán)
- pricing/pricing.service.ts, pricing/points-earn.ts, loyalty/earn-rates.ts
- loyalty/loyalty.service.ts (creditOrderPoints, reverseOrderPoints, recalcTier, spending12m, tierPoints, lockedOrderPoints), loyalty-expiry.service.ts (luật lô), points-expiry-date.ts, points-reconcile.ts + scripts/reconcile-points.ts
- wallet/wallet.service.ts (withdraw), wallet-ledger.service.ts, reward-points.service.ts (grant)
- affiliate/affiliate.service.ts (createCommissionForOrder, reverse, requestPayout, approveDueCommissions, personalIncomeTax, claimMilestone, productCommissionBreakdown, placeOrderForCustomer), commission-rate.ts, commission-eligibility.ts, commission-base.ts
- orders/order-reversal.service.ts (reverseFinancials, releaseCoupon), order-returns.service.ts (request)
- coupons/coupons.service.ts (validateAndCompute, redeemInTx, release), coupon-claim.service.ts, admin/admin-coupon-batch.service.ts
- vouchers/vouchers.service.ts (grant, milestoneVouchers)
- integrations/payment/{bank-transfer,payment.controller,vietqr}.ts; integrations/pancake/{pancake-payment.util,pancake-total}.ts, pancake.processor.ts:560-760 (đối soát chuyển khoản)
- external-points/{external-chat.rules,external-chat.config,external-points-rate,external-claim.rules,external-claim-release}.ts, external-chat.claim.ts:1-140
- waste-exchange/{waste-points.ts, receiving/waste-confirm.service.ts, receiving/waste-reverse.service.ts, receiving/waste-quota.ts}
- game/game.service.ts (nhiệm vụ, góp quỹ cây), game-economy.service.ts (streak)
- reviews/reviews.service.ts (thưởng/thu hồi), review-eligibility.ts
- merchant/{merchant-line-base,merchant-consignment,consignment-link-sql}.ts, cart/partner-goods.ts
- migration 20261018210000_points_1d
- DB UAT (chỉ SELECT qua Prisma trong tx READ ONLY): system_configs, membership_tiers, coupons, variations.affiliateRate, missions, waste_items, waste_gifts, truy vấn lệch sổ điểm/ví (DB trống).

Chưa đọc kịp / chỉ lướt:
- dealer (công nợ, thưởng quý; chỉ xem chỗ tạo đơn đại lý)
- subscriptions
- flash-sale.service (consume/restore suất; chỉ đọc chỗ gọi)
- groupbuy (chỉ lướt)
- cashback (chỉ lướt)
- merchant.service (phiếu đối soát)
- zalopay.service, gomdon
- external-claim.service / external-claims-admin (đường duyệt tay)
- waste-hold / waste-receive / waste-requests
- order-status.service, delivered-effects
- referral-reward.ts

Chưa chạy jest/race nào.

## Bảng phát hiện

| ID | Mức (sau soát) | Soát chéo | Nhóm | Vùng | Vị trí | Mô tả + kịch bản | Đề xuất sửa + test |
|---|---|---|---|---|---|---|---|
| D1-02 | P1 | CONFIRMED | agent sửa ngay | uat | apps/api/src/modules/vouchers/vouchers.service.ts:332-389 (352, 373, 384-386) | Voucher mốc chi tiêu (tới 200.000đ, không có đơn tối thiểu) cấp từ đơn còn trong hạn đổi trả. Đơn 5.000.000đ giao ngày D. 05:00 D+1 cron cấp mã 200.000đ. D+3 khách trả cả đơn, được hoàn đủ. Mã không bị thu hồi. Lặp mỗi tháng. Đơn 1.000.000đ được 30.000đ, 3.000.000đ được 100.000đ. | Chỉ đếm đơn đã qua returns.window_days và không có return_request REQUESTED. Đơn giao cuối tháng: chốt kỳ theo deliveredAt hoặc quét lại tháng trước. Có thể thêm minOrder (chủ quyết). Test: đơn 5.000.000đ deliveredAt = now-1 ngày thì chưa có coupon MILESTONE*; now-8 ngày thì có. |
| D1-01 | P2 (gốc P1, hạ khi soát) | CONFIRMED | agent sửa ngay | uat | apps/api/src/modules/reviews/reviews.service.ts:183,208; review-eligibility.ts:9-13; game/game.service.ts:545,616-650; loyalty/loyalty.service.ts:560; orders/order-reversal.service.ts:102-271 | Thưởng đánh giá và nhiệm vụ FIRST_ORDER/REVIEW_3 cấp ngay khi đơn DELIVERED. Không khoá theo cửa sổ đổi trả. Trả cả đơn không thu hồi. Ví dụ đơn 64.000đ: +30.000 đánh giá, +15.000 REVIEW_3, +20.000 FIRST_ORDER = 65.000 điểm dùng ngay. Sau khi trả đơn khách vẫn giữ 65.000 điểm. | Cách 1: chỉ cho nhận khi đơn qua cửa sổ đổi trả và không có yêu cầu trả REQUESTED. Cách 2: thu hồi lô REVIEW và MISSION:FIRST_ORDER trong reverseFinancials. Cách 3: tính REVIEW và MISSION vào lockedOrderPoints. Test: game.service.spec claimMission('FIRST_ORDER') với đơn giao 1 ngày trước, window_days=7, phải ném lỗi. Race-spec: đánh giá có ảnh, duyệt trả cả đơn, pointsBalance quay về số trước đặt đơn và có dòng thu hồi REVIEW:<id>. |
| D1-03 | P2 | chưa soát | cần chủ quyết | uat | loyalty/loyalty.service.ts:352-359; vouchers/vouchers.service.ts:373; dealer/dealer.service.ts:298-310; affiliate/affiliate.service.ts:748-765 | Đơn đại lý (DEALER) và đơn CTV lên hộ được tính vào chi tiêu xét hạng và voucher mốc chi tiêu của chính đại lý/CTV. Đại lý nhập sỉ 50.000.000đ/12 tháng lên Cổ Thụ. Đại lý nhập 5.000.000đ/tháng nhận mã 200.000đ mỗi tháng. CTV lên hộ 1.500.000đ lên Lộc Biếc bằng tiền của khách khác. | Nếu chủ đồng ý hạng chỉ cho mua lẻ: thêm type: 'RETAIL', placedForCustomer: false vào spendWhere (loyalty.service.ts:352) và SQL milestoneVouchers. Test: loyalty.service.spec 50.000.000đ đơn DEALER, recalcTier ra MAM_XANH; vouchers.service.spec chỉ đơn DEALER thì không cấp mã mốc. |
| D1-04 | P2 | chưa soát | cần chủ quyết | uat | affiliate/affiliate.service.ts:546-553, 1078-1150, 1216-1245 | Ngưỡng TNCN 2.000.000đ xét theo từng lần rút. CTV ~6.000.000đ/tháng rút nhỏ vào Ví (WALLET_BALANCE, không mức tối thiểu), mỗi lần dưới 2.000.000đ nên taxWithheld = 0. Rút Ví về ngân hàng không có TNCN. Cả tháng không bị trừ. Rút một lần 6.000.000đ thì bị giữ 600.000đ. pitReport ra 0. | Hỏi kế toán (B17 đang chờ). Nếu ngưỡng theo tháng: cộng grossAmount các payout PAID/REQUESTED trong tháng VN với lần này rồi khấu trừ trên phần lũy kế. Test: affiliate.service.spec hai lần rút WALLET_BALANCE 1.500.000đ cùng tháng, tổng taxWithheld > 0 (theo công thức kế toán chốt). |

Số phát hiện theo mức sau soát: P0=0, P1=1, P2=3, P3=0.

## Chi tiết P0/P1

### D1-02 (P1, CONFIRMED) — Voucher mốc chi tiêu cấp từ đơn còn trong hạn đổi trả

Vị trí: apps/api/src/modules/vouchers/vouchers.service.ts:332-389.

Kịch bản: khách đặt đơn 5.000.000đ (COD hoặc chuyển khoản), giao ngày D trong tháng. 05:00 D+1 cron milestoneVouchers cộng mọi đơn DELIVERED tạo trong tháng. spent = 5.000.000 >= mốc 5.000.000. Cấp mã MILESTONE5000000-yyyy-mm loại AMOUNT 200.000đ, hạn 30 ngày, minOrder null. Ngày D+3 khách trả cả đơn, được hoàn đủ 5.000.000đ. Mã không bị thu hồi (comment dòng 352 nói rõ). Khách dùng mã mua một món 200.000đ, chỉ trả phí giao. Lặp mỗi tháng vì khoá chống trùng theo tháng. Cùng lỗi mức nhỏ hơn: 1.000.000đ được 30.000đ, 3.000.000đ được 100.000đ.

Bằng chứng:
- vouchers.service.ts:373: `WHERE o.status::text = 'DELIVERED' AND o."createdAt" >= ${since} ...`. Không lọc deliveredAt theo returns.window_days, không loại đơn có yêu cầu trả REQUESTED. Chỉ phần trả một phần đã APPROVED được trừ (dòng 365-370).
- vouchers.service.ts:384-386: `userId, reason: `MILESTONE${hit.spend}-${period}`, type: 'AMOUNT', value: hit.reward, validDays: 30, templateCode: 'MILESTONE_VOUCHER'`. Không truyền minOrder.
- grant() ở vouchers.service.ts:63-97 đặt `minOrder: opts.minOrder ?? null`.
- DB UAT: voucher.milestones = [{1000000,30000},{3000000,100000},{5000000,200000}], returns.window_days = 7.
- Cron chạy '0 5 * * *' (dòng 332).
- Hoa hồng CTV chờ APPROVED sau 10 ngày giữ. Voucher mốc khách không chờ gì.

Lý do soát chéo (CONFIRMED, giữ P1): điều kiện ở dòng 372-373 chỉ có status DELIVERED và createdAt. Cron 05:00 cấp mã sáng D+1 trong khi khách còn quyền trả tới D+7. Khách gửi yêu cầu trả ngay ngày D thì sáng D+1 vẫn được cấp. Lời gọi ở dòng 384-386 không truyền minOrder nên mã 200.000đ không có đơn tối thiểu. Grep MILESTONE/scopeMeta trong coupons, checkout, orders không ra chốt chặn nào; coupon-scope.ts chỉ kiểm userId. A7 chỉ chốt số tiền, không chốt việc cấp trong cửa sổ đổi trả. Giữ P1: mã tương đương tiền tới 200.000đ, tự động, lặp mỗi tháng.

### D1-01 (gốc P1, sau soát P2, CONFIRMED) — Thưởng đánh giá và nhiệm vụ không thu hồi khi trả đơn

Bằng chứng đầy đủ:
- game.service.ts:545: `this.prisma.order.count({ where: { userId, status: 'DELIVERED', type: 'RETAIL', placedForCustomer: false } })`. Không lọc deliveredAt theo returns.window_days.
- game.service.ts:650: `await this.creditPoints(userId, mission.rewardPoints, `MISSION:${mission.code}:${cycleKey}`, ...)`.
- DB UAT: missions FIRST_ORDER 20000, REVIEW_3 15000, isRepeatable = false.
- reviews.service.ts:183: `const rewardPoints = hasVideo ? 15_000 : hasImages ? 10_000 : 5_000;`. REVIEWABLE_ORDER = { status: 'DELIVERED', ... }, không có điều kiện thời gian.
- loyalty.service.ts:560: `AND pt."reason" LIKE 'ORDER_DELIVERED:%'`. Khoá chỉ áp cho điểm đơn.
- grep `MISSION:` trong apps/api/src chỉ ra một chỗ ghi (game.service.ts:650), không có chỗ thu hồi. Thu hồi điểm đánh giá chỉ có ở reviews.service.ts remove() (lúc xoá đánh giá). order-reversal.service.ts không đụng review hay mission.
- Đã tra findings-catalog.md, 02-tong-hop, impl/*.md, 99-release-readiness (PF-3, PF-5a): chưa ai báo.

Lý do soát chéo (CONFIRMED, hạ xuống P2): dựng lại kịch bản bằng mã, không bác bỏ được. missionMetrics đếm mọi đơn DELIVERED/RETAIL/không đặt hộ, không xét deliveredAt (game.service.ts:545). REVIEW_3 groupBy đánh giá có ảnh, không xét đơn gốc còn DELIVERED (game.service.ts:548-551). claimMission cộng thẳng qua creditPoints (game.service.ts:650, 696-717), không có trần. Comment ở getMissions (khoảng dòng 589-590) nhắc "chỉ số thô có thể tụt sau lúc nhận (đơn trả...)", nhưng đó chỉ là luật hiển thị thẻ, không phải luật kinh doanh đã chốt về việc giữ thưởng. Hạ P2 vì muốn có lợi phải gửi trả hàng thật, cần admin duyệt, có thể tốn phí gửi trả. Điểm chỉ trừ tối đa 20% mỗi đơn hoặc đổi quà. FIRST_ORDER và REVIEW_3 mỗi tài khoản một lần, nên mỗi lượt lạm dụng lợi vài chục nghìn điểm. Rò nhẹ hơn: trả MỘT PHẦN đúng sản phẩm đã đánh giá thì điểm đánh giá cũng không bị thu hồi.

## Bỏ sót do soát chéo phát hiện

- apps/api/src/modules/vouchers/vouchers.service.ts:372-373 (P2, cần chủ quyết nếu cố ý). Câu SQL voucher mốc chi tiêu không lọc `o.type = 'RETAIL' AND o."placedForCustomer" = false`. Voucher đơn thứ 2 ở cùng file có lọc (vouchers.service.ts:452-453). REVIEWABLE_ORDER và FIRST_ORDER cũng loại hai loại đơn này.
  - Kịch bản A, đại lý: đặt đơn buôn DEALER 5.000.000đ, total = subtotal (dealer.service.ts:298-306). Đơn tới DELIVERED (DEALER_SETTLED_STATUSES, dealer.service.ts:36). Tài khoản có SĐT nên lọt REAL_USER_SQL. Sáng hôm sau cron cấp mã MILESTONE5000000-yyyy-mm 200.000đ, không có đơn tối thiểu. Lặp mỗi tháng đại lý nhập đủ 5 triệu.
  - Kịch bản B, CTV: đơn CTV lên hộ mang userId = CTV (affiliate.service.ts:753, placedForCustomer: true ở dòng 767). CTV lên hộ khách tổng 5.000.000đ/tháng nhận mã 200.000đ cho chính mình, cộng hoa hồng 8%, trong khi tiền là của khách cuối.
  - Sửa: thêm hai điều kiện lọc vào WHERE ở dòng 373. Test spec/race cho đơn DEALER và đơn placedForCustomer = true tổng >= 5 triệu thì không có coupon MILESTONE*.

## Đã bác bỏ

Không có.
