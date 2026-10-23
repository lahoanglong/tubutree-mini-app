# D11-tien-don-si-dinh-ky — Tiền: đại lý, định kỳ, mua chung, cashback, đối soát đối tác

## Tóm tắt

Góc TIỀN lượt 2. Không có P0.

- Có 1 lỗi tiền mới, đã tái hiện bằng test (D11-02, P1). Thu hồi thưởng quý của đại lý dựa trên doanh số tính lại lúc huỷ, không dựa trên doanh số lúc trả thưởng. Một đơn không góp vào thưởng (lên PACKED sau ngày 10) mà bị trả thì kéo theo cả khoản thưởng của đơn khác. Test lẻ cho `clawbackQuarterBonusForOrder` ra `clawedBack = 3.600.000`, đúng ra phải là 0.
- Mục còn mở từ trước: D11-01 = D3-05 (launch review). Đơn sỉ tối thiểu 3 triệu, miễn phí giao từ 5 triệu, khoá mua chịu khi quá hạn chưa có trong mã. Nhóm C của 03-cau-hoi-sang ghi như đã chốt.
- D11-03 (P2, cần chủ quyết): đơn quý trước đến ngày 10 chưa chốt thì mất thưởng quý vĩnh viễn.
- 2 mục P3: định kỳ lách bậc giảm giá bằng gói ảo (D11-04); mã mua chung tính 15% trên giá biến thể rẻ nhất (D11-05).
- Các phần còn lại đã có bảo vệ, không thấy lỗi: định kỳ (giá, kho, ví, COD, khoá dòng); mua chung (mã theo người và sản phẩm, không thu tiền nên không phải hoàn); cashback (CAS theo trạng thái, webhook so token, kế toán không duyệt của chính mình); phiếu đối soát đối tác và hàng ký gửi (luỹ kế rồi lấy hiệu, khoá theo gian hàng, unique dòng); trừ/hoàn suất flash; thưởng giới thiệu; công nợ đại lý (Serializable, idempotency, đảo khi huỷ, chặn trả một phần đơn đại lý); khoá cấu hình (subscribe.*, cashback.merchant_user_share, groupbuy.discount_pct, merchant.commission_pct đều có RANGES/JSON_RULES).
- Mục marketing lách trần qua flash sale đã có ở D2-01, không báo lại.
- Không sửa file nào trong repo. File test tái hiện chỉ nằm ở scratchpad: `/private/tmp/claude-501/-Users-longla-coding-tubutree-mini-app/290ef81c-34a8-4ce1-8b2c-51c8d5a19dd7/scratchpad/jt/clawback-late.spec.ts`.

## Phạm vi đã đọc

Đọc hết:
- `apps/api/src/modules/dealer/dealer.service.ts` (1-1523), `dealer-config.ts`, `dealer-admin.controller.ts`, `dealer.controller.ts`, `dealer.cron.ts`, `dealer-backorder.service.ts`, `dto/dealer.dto.ts`, phần `listAccounts` của `dealer-accounts-admin.service.ts`.
- `subscriptions/subscriptions.service.ts` (toàn bộ).
- `groupbuy/groupbuy.service.ts`, `groupbuy.cron.ts`, `groupbuy.controller.ts`.
- `cashback/cashback.service.ts`, `cashback.controller.ts`, `cashback-admin.controller.ts`, `providers/access-trade.provider.ts`.
- `merchant/merchant-fulfilment.service.ts` dòng 140-380 và 590-1225 (saleLineOf, partialReversalLinesOf, reversalLineOf, statementFor, consignmentStatement, createPayout/markPayoutPaid/cancelPayout), `merchant-consignment.ts`, `merchant-line-base.ts`, `merchant-config.ts`, `merchant.service.ts` dòng 940-1104.
- `flash-sale/flash-sale.service.ts` dòng 1-420 (resolveEffective, consumeQuotas, restore, addItem), quyền của `flash-sale-admin.controller.ts`.
- `wallet/referral-reward.ts` (toàn bộ), `wallet/reward-points.service.ts` dòng 200-336.

Đọc kèm: `orders/order-reversal.service.ts` dòng 90-345 và 755-810, `orders/order-returns.service.ts` dòng 195-240, `orders/dealer-credit-debit.ts`, `pending-payment-expiry.cron.ts` (chỗ lọc), `pricing.calcShippingFee`, `coupons.service.ts` dòng 60-130, `admin-config-rules.ts`, `system-config.service.ts` (assertInRange/RANGES/JSON_RULES).

Đã chạy:
- `npx jest src/modules/dealer/dealer.service.spec.ts -t "giá tính đủ 100%"`: 1 đạt; xác nhận đơn đại lý 320.000đ được tạo.
- 1 spec tái hiện ngoài repo bằng config jest riêng ở scratchpad: đỏ đúng như mô tả D11-02.
- SELECT trên DB UAT: dealer_tiers, system_configs (dealer/merchant/groupbuy/cashback/flash/referral/subscribe/shipping/loyalty), so giá products/variations.

Chưa đọc kịp: `merchant.service.ts` dòng 1-940 (tạo/sửa sản phẩm đối tác, gian hàng), `merchant-pancake-link.ts`, `consignment-link-sql.ts`, `merchant-sla.cron.ts`, `dealer-accounts-admin.service.ts` dòng 1-180 (CRUD bậc), `flash-sale.service.ts` dòng 420-591 (nhắc giờ vàng), cashback reconcile/fetchTransactions chạy thật. Chưa chạy race test nào.

## Bảng phát hiện

| ID | Mức (sau soát) | Soát chéo | Nhóm | Vùng | Vị trí | Mô tả + kịch bản | Đề xuất sửa + test |
|---|---|---|---|---|---|---|---|
| D11-01 | P1 | CONFIRMED | cần chủ quyết | uat | `apps/api/src/modules/dealer/dealer.service.ts:207`, `:237-241`, `:258-268`, `:277-281`, `:303-307` | Đơn sỉ không có tối thiểu 3 triệu, luôn miễn phí giao, không khoá mua chịu khi quá hạn. Đại lý Cấp 1 đặt 1 chai 100.000đ → đơn 80.000đ, shippingFee 0. Đại lý Cấp 2 nợ quá hạn vẫn đặt thêm đơn CREDIT. Trùng D3-05, còn mở. | Hỏi chủ về mức phí dưới 5 triệu và khoá CREDIT quá hạn. Test: 'đơn 2.999.999đ → 400', 'đơn 4.000.000đ → shippingFee > 0', 'nợ NET 15 quá 16 ngày → CREDIT bị 400, PREPAID vẫn được'. |
| D11-02 | P1 | CONFIRMED | agent sửa ngay | uat | `dealer.service.ts:1367-1376`, `:1409-1422`, `:1262-1267`; `orders/order-reversal.service.ts:244-257` | Thu hồi thưởng quý lấy cả đơn không nằm trong lần trả thưởng. Đơn chốt muộn bị trả → mất thưởng của đơn khác (đúng ra thu 0, code thu 3.600.000). | Lưu snapshot doanh số lúc payout; đơn không có trong snapshot thì clawedBack = 0; `others` lấy từ snapshot. Test: `dealer-bonus-clawback.spec.ts` hai ca + race-spec Postgres. |
| D11-03 | P2 | chưa soát | cần chủ quyết | uat | `dealer.service.ts:1222-1228`, `:1256-1264`; `dealer.cron.ts:268` | Thưởng quý chốt một lần ngày 10. Đơn quý trước chốt muộn (đặt trước chờ hàng, kho đóng gói chậm) mất thưởng vĩnh viễn. Đại lý thiệt 4.800.000đ trong ví dụ. | Chủ chọn: giữ và ghi rõ thể lệ, hoặc thêm lượt bù QUARTER_BONUS_TOPUP (sửa D11-02 trước). Test: 'đơn B PACKED sau ngày 10 → lượt bù cộng 4.800.000'. |
| D11-04 | P3 | chưa soát | cần chủ quyết | uat | `apps/api/src/modules/subscriptions/subscriptions.service.ts:444-452`, `:867-880`, `:508-514` | Bậc giảm giá định kỳ đếm cả gói hẹn ngày xa chưa ra đơn. Tạo 4 gói ảo (startDate +60 ngày) để nâng 12% lên 15%; 'Bỏ qua kỳ' lặp mãi không tốn gì. | Chỉ đếm gói ACTIVE đã có đơn kỳ còn hiệu lực hoặc có nextRunAt trong 1 chu kỳ. Test: '4 gói hẹn +60 ngày + 1 gói giao ngay → discountPct 0.12'. |
| D11-05 | P3 | chưa soát | agent sửa ngay | uat | `apps/api/src/modules/groupbuy/groupbuy.service.ts:88-89`, `:205`, `:390-402`; `coupons/coupons.service.ts:86-95` | Mã mua chung tính 15% trên giá sản phẩm (= giá biến thể rẻ nhất). Biến thể 430.000đ chỉ được giảm 18.000đ (4,2%), trang nhóm ghi 15%. | Mở nhóm theo biến thể, hoặc cấp mã PERCENT 15 kèm maxDiscount và minOrder. Test: 'sản phẩm 2 biến thể 120k/430k → mã PERCENT 15' hoặc 'nhóm theo biến thể 430k → mã 64.500'. |

## Chi tiết P0/P1

### D11-02 — Thu hồi thưởng quý lấy cả đơn không nằm trong lần trả thưởng (P1, CONFIRMED)

Vị trí: `apps/api/src/modules/dealer/dealer.service.ts:1367-1376`, `:1409-1422`, `:1262-1267`; `apps/api/src/modules/orders/order-reversal.service.ts:244-257`. Nhóm: agent sửa ngay. Vùng: uat. Tiền sử: mới.

Kịch bản: Đại lý VIP, Q1/2026.
- Đơn A 120.000.000đ PAID, DELIVERED tháng 2.
- Đơn B 90.000.000đ tạo 28/3, đã PAID nhưng vẫn CONFIRMED vì đặt trước chờ hàng.
- 10/4 cron `payoutQuarterlyBonuses` chỉ thấy A đã chốt, ghi QUARTER_BONUS −3.600.000 (120 tr × 3%).
- 16/4 B lên PACKED, 20/4 DELIVERED, rồi đại lý trả cả đơn (hoặc admin huỷ lúc PACKED).
- Trong tx đảo, `wasCountedBeforeReversal` xét trạng thái hiện tại (DELIVERED + PAID), coi như B đã được tính.
- others = 120 tr, before = 210 tr, marginal = bonus(210 tr) − bonus(120 tr) = 8.400.000 − 3.600.000 = 4.800.000.
- clawback = min(3.600.000 thưởng còn giữ, 4.800.000) = 3.600.000.
- Kết quả: công nợ đại lý tăng 3.600.000đ, mất trọn thưởng của đơn A, dù B chưa bao giờ góp vào số đã trả. Đúng ra thu 0.

Bằng chứng:
- `dealer.service.ts:1367`: `if (!(await this.wasCountedBeforeReversal(tx, order, opts.paidBeforeReversal)))`.
- `wasCountedBeforeReversal` (1414-1421) chỉ xem `order.status` thuộc PACKED/SHIPPING/DELIVERED và PAID/ghi nợ tại lúc huỷ, không so với thời điểm ghi dòng QUARTER_BONUS.
- `dealer.service.ts:1371-1375`: `const others = (await this.dealerVolume(order.userId, qStart, qEnd, tx, order.id)).settled; const before = others + order.total; ... const clawback = Math.min(heldBonus, marginal);` tính doanh số theo hiện tại.
- Dòng QUARTER_BONUS (1265-1267) không lưu đơn nào hay mốc doanh số nào đã được tính.
- Spec tái hiện `/private/tmp/claude-501/-Users-longla-coding-tubutree-mini-app/290ef81c-34a8-4ce1-8b2c-51c8d5a19dd7/scratchpad/jt/clawback-late.spec.ts` gọi `clawbackQuarterBonusForOrder` với bonusDelta −3.600.000, others = [A 120 tr DELIVERED PAID], orderB 90 tr DELIVERED, paidBeforeReversal = true. Output: `{"quarter":"Q1/2026","clawedBack":3600000}`, createMany ghi QUARTER_BONUS_ADJ delta +3.600.000 refId `Q1/2026:oB`. Mong đợi 0, nhận 3.600.000 (test đỏ).

Đề xuất sửa:
- Lúc payout, lưu snapshot doanh số đã tính: tổng settled + danh sách id đơn (bảng/JSON gắn với dòng QUARTER_BONUS, hoặc ít nhất mốc thời gian payout).
- Trong clawback: (1) đơn không có trong snapshot thì clawedBack = 0; (2) others = doanh số snapshot − các đơn đã bị thu trước đó, không dùng `dealerVolume` hiện tại.
- Nếu không thêm cột: coi đơn là đã được tính chỉ khi lần lật sang PACKED (order_status_history) và paidAt/dòng ghi nợ đều trước `createdAt` của dòng QUARTER_BONUS, và tính others bằng cùng điều kiện.
- Test đỏ (`dealer-bonus-clawback.spec.ts`): 'đơn lên PACKED sau ngày trả thưởng bị trả → clawedBack 0'; 'đơn A đã tính bị trả trong khi có đơn C chốt muộn → chỉ thu phần biên theo snapshot'. Race-spec Postgres: payout → B PACKED → trả B → SUM(delta) công nợ không đổi.

Lý do soát chéo (CONFIRMED, giữ P1):
- Không bác bỏ được. `wasCountedBeforeReversal` chỉ xem trạng thái và thanh toán của đơn ngay trước lúc đảo, không kiểm tra đơn có trong doanh số đã chốt ngày payout hay không. Dòng QUARTER_BONUS chỉ lưu số tiền.
- `order-reversal.service.ts:244-257` truyền snapshot trước khi lật và `paidBeforeReversal`, không nói gì về thời điểm payout.
- Không có commit sau đó sửa; findings-catalog và launch-review không có mục này (`docs/2026-09-27-wip-completion-deploy-notes.md:617` chỉ mô tả công thức marginal).
- Chạy lại spec tái hiện: `{"quarter":"Q1/2026","clawedBack":3600000}`, ADJ +3.600.000 refId `Q1/2026:oB`. Mong đợi 0, nhận 3.600.000, test đỏ.
- Biến thể phổ biến hơn: đơn tạo 28/3 chuyển khoản, kế toán xác nhận tiền 12/4 (sau payout ngày 10) cũng gây lỗi này.
- Biến thể thứ hai không giới hạn ở đơn chốt muộn: đơn chốt muộn làm tăng `others` (`dealer.service.ts:1371`), thu quá tay khi đơn khác bị trả. Ví dụ: A 120 tr + A2 60 tr được tính lúc payout (180 tr → 3% = 5,4 tr), sau đó C 30 tr chốt muộn. Trả A2 cho others = 150 tr → 4,5 tr, before = 210 tr → 8,4 tr, marginal = 3,9 tr, clawback = min(5,4; 3,9) = 3,9 tr. Số đúng là bonus(180) − bonus(120) = 1,8 tr, nên thu thừa 2,1 tr.
- Sai ở sổ công nợ đại lý, không phải khách, cần đúng thời điểm, nên mức P1.

### D11-01 — Đơn sỉ không có tối thiểu 3 triệu, luôn miễn phí giao, không khoá mua chịu khi quá hạn (P1, CONFIRMED)

Vị trí: `apps/api/src/modules/dealer/dealer.service.ts:207`, `:237-241`, `:258-268`, `:277-281`, `:303-307`. Nhóm: cần chủ quyết. Vùng: uat. Tiền sử: D3-05 (`docs/2026-10-18-launch-review/D3-dealer-ctv-storefront.md:112`), còn mở.

Kịch bản:
- (a) Đại lý Cấp 1 (DB UAT: DEALER_1, giảm 20%, PREPAID) đặt 1 chai giá lẻ 100.000đ. API tạo đơn 80.000đ, shippingFee 0, đẩy Pancake. Tubu chịu phí giao cho đơn sỉ 80.000đ, trái mục 'Đơn sỉ tối thiểu 3 triệu. Miễn phí giao từ 5 triệu' ở nhóm C.
- (b) Đơn 3–5 triệu cũng được miễn phí giao.
- (c) Đại lý Cấp 2 (NET 15, hạn mức 20.000.000) nợ 15.000.000 từ 60 ngày trước, chưa trả đồng nào, vẫn đặt thêm đơn CREDIT 5.000.000 vì chỉ có kiểm hạn mức, không có kiểm quá hạn. Thưởng quý còn tính cả doanh số đơn ghi nợ chưa trả (`dealerVolume:662`), nên khoản nợ quá hạn còn được thưởng.

Bằng chứng:
- `placeOrder` chỉ chặn đơn trống (207) và trần 2 tỷ (237). Đơn ghi `shippingFee: 0, total: subtotal` (306-307).
- Mục CREDIT chỉ kiểm `debt + subtotal > creditLimit` (267, 280), không đọc paymentTerms hay tuổi nợ.
- grep min_order/overdue/freeShip trong `modules/dealer` không có kết quả (ngoài trường `minOrderVolume` chỉ dùng ở admin).
- `npx jest src/modules/dealer/dealer.service.spec.ts -t "giá tính đủ 100%"`: 1 passed. Spec này tạo đơn đại lý 320.000đ (4 × 80.000đ) thành công.
- DB UAT dealer_tiers: DEALER_1 minOrderVolume 10.000.000 PREPAID, DEALER_2 NET 15 hạn mức 20.000.000, DEALER_3/VIP NET 30.
- `docs/2026-10-18-launch-review/03-cau-hoi-sang.md:142`: 'Đơn sỉ tối thiểu 3 triệu. Miễn phí giao từ 5 triệu. Khoá mua chịu khi quá hạn.' Nhưng `:160` ghi 'Điều kiện thanh toán của bậc đại lý ... chỉ hiển thị, chưa chặn đơn'. `02-tong-hop-va-ke-hoach.md:143` xếp D3-04/05 vào 'Chưa làm (cần chủ dự án quyết)'.

Đề xuất sửa: Hỏi chủ (2 dòng nhóm C mâu thuẫn): (1) chặn đơn sỉ < 3.000.000đ (khoá cấu hình `dealer.min_order_value`); (2) đơn < 5.000.000đ thu phí giao (mức nào: phí phẳng `shipping.flat_fee_below_threshold` hay bảng riêng); (3) khoá CREDIT khi có dòng ORDER chưa trả đủ quá N ngày theo paymentTerms (NET 15/30). Sau khi chốt, sửa trong `placeOrder` (kiểm ngoài tx để báo lỗi sớm, kiểm lại trong tx Serializable cho phần quá hạn). Test đỏ: 'đơn 2.999.999đ → 400', 'đơn 4.000.000đ → shippingFee > 0, total = subtotal + phí', 'nợ NET 15 quá 16 ngày → CREDIT bị 400, PREPAID vẫn được'.

Lý do soát chéo (CONFIRMED, giữ P1, không nâng P0):
- Mã khớp: `placeOrder` chỉ chặn đơn trống (206) và trên `DEALER_ORDER_TOTAL_MAX` (237); ghi `shippingFee: 0`, `total: subtotal` (306-307); CREDIT chỉ kiểm `debt + subtotal > creditLimit`, không đọc paymentTerms hay tuổi nợ.
- grep `minOrderVolume`/`min_order` trong apps/api, apps/miniapp, apps/web chỉ thấy ở trang admin (`dealer-tiers-section.tsx`, `dealer-accounts-client.ts`). Không có lớp phía client nào bắt buộc mức tối thiểu.
- `03-cau-hoi-sang.md:55` (mục đã chốt) ghi 'C | Đồng ý toàn bộ Nhóm C', gồm dòng 142. Nên mức tối thiểu 3 triệu và miễn phí giao từ 5 triệu là luật đã chốt nhưng chưa làm, agent có thể làm mức tối thiểu 3 triệu mà không cần hỏi.
- Chỉ hai điểm cần chủ: (1) phí giao cho đơn dưới 5 triệu chưa được nêu; (2) khoá mua chịu quá hạn mâu thuẫn với dòng 160 'chỉ hiển thị, chưa chặn đơn'.
- Giữ P1: thiệt hại là phí giao của đơn sỉ nhỏ, đại lý được duyệt thủ công.
- Không kiểm được số liệu dealer_tiers UAT vì máy không có psql; dữ liệu bậc được D3-05 (`seed.ts:337-341`) hỗ trợ.

## Bỏ sót do soát chéo phát hiện

1. `apps/api/src/modules/dealer/dealer.service.ts:1255-1267` (P2, cần chủ quyết): `payoutQuarterlyBonuses` idempotent theo (userId, QUARTER_BONUS, quarter) và mã không có đường bù ('Không bao giờ điều chỉnh tăng', 1321). Đơn tạo trong quý nhưng chỉ chốt (PACKED + PAID, hoặc có dòng ghi nợ) sau ngày 10 của tháng kế tiếp thì không bao giờ được tính. Ví dụ: VIP, Q1. A 120 tr đã chốt → payout 3,6 tr (3%). B 90 tr tạo 28/3 bằng chuyển khoản, kế toán xác nhận tiền 12/4 → doanh số thật 210 tr, đáng được 4% = 8,4 tr. Đại lý mất vĩnh viễn 4,8 tr, không có ghi nhận. Trong Q1, `quarterlyReport` hiện B ở `pendingRevenue` nên đại lý kỳ vọng B được tính. Hướng sửa: trả bù khi đơn trễ chốt (ngược với clawback) hoặc báo rõ ngày chốt cho đại lý. Đây cũng là gốc làm D11-02 thu thừa. (Cùng gốc với D11-03.)
2. `apps/api/src/modules/dealer/dealer.service.ts:1371-1375` (P1, thuộc D11-02 nhưng kịch bản khác): `others` lấy từ `dealerVolume` hiện tại, nên đơn chốt muộn đẩy bậc của các đơn khác lên và làm clawback quá lớn, kể cả khi đơn bị trả đã được tính lúc payout. A 120 tr + A2 60 tr lúc payout = 180 tr → 5,4 tr. C 30 tr chốt muộn. Trả A2 thu min(5,4; bonus(210) − bonus(150) = 3,9) = 3,9 tr, số đúng 1,8 tr. Đại lý bị thu thừa 2,1 tr. Test thêm khi sửa D11-02 phải phủ ca này.

## Đã bác bỏ

Không có phát hiện nào bị bác bỏ (REFUTED = 0).
