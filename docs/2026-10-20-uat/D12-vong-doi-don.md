# D12-vong-doi-don — Vòng đời đơn, hoàn tiền, giao hàng

## Tóm tắt

Đã lần theo vòng đời đơn cho mọi kịch bản trong brief. Không có P0. Phần lớn đường đi đứng vững, do thiết kế rõ hoặc đã có test:

- DELIVERED → CANCELLED bị bảng chuyển trạng thái chặn.
- Đánh dấu PAID hai lần bị chặn bằng guard nguyên tử trong markPaid, callback ZaloPay và luồng đại lý.
- Hiệu ứng khi giao (điểm, hoa hồng, thưởng giới thiệu) idempotent, chạy cả khi trạng thái nhảy bước, và có cron đồng bộ lại.
- Hoàn một phần trả theo dòng hàng với tổng luỹ kế, nên không vượt số đã trả.
- Đơn COD chưa giao không hoàn tiền.
- Webhook sai thứ tự bị bỏ qua hoặc gắn cờ vào "Cần xử lý Pancake".
- Đơn chuyển khoản đã hết hạn rồi mới được trả sẽ thành khoản hoàn LATE_PAYMENT, không mở lại.

Còn hai phát hiện thật, đều tái hiện bằng jest chạy từ scratchpad (không sửa file repo):

- D12-01 (P1): Pancake báo "Đã hoàn" (5) cho đơn COD mà Tubu đang ghi DELIVERED. Hệ thống tự hoàn toàn bộ tổng đơn vào Ví Tubu, vì coi DELIVERED là bằng chứng đã thu COD. Kho bấm nhầm "Đã nhận" rồi hàng quay về thì khách nhận tiền chưa từng trả. Tiền Ví có thể rút.
- D12-02 (P2): Khi huỷ hoặc trả hàng qua setStatus, các bước sau commit không có thử lại: hoàn Điểm Xanh STANDARD đã dùng, thu hồi điểm đã tích, thu hồi hoa hồng, báo khách, xếp lệnh huỷ Pancake. Một bước ném lỗi hoặc tiến trình chết lúc deploy thì lần gọi sau không làm gì vì trạng thái đã đặt. Khách mất vĩnh viễn điểm STANDARD đã dùng. Lệnh huỷ Pancake ở trạng thái DEFERRED không được cứu, vì retryCancels chỉ quét pancakeCancelStatus PENDING/FAILED.

DB UAT có 0 đơn nên không tái hiện trên dữ liệu. Chỉ truy vấn cấu hình: affiliate.hold_days=10.

Số phát hiện theo mức sau soát: P0=0 P1=1 P2=1 P3=0 REFUTED=0.

## Phạm vi đã đọc

Đọc đầy đủ:

- apps/api/src/modules/orders/: order-transition, order-status.service, delivered-effects, delivered-effects-resync.cron, order-reversal.service, order-returns.service, return-ledger, refund-allocation, refund-queue, refund-destination, dealer-credit-debit, customer-refunds.service, customer-refunds-admin.controller, pending-payment-expiry.cron, pending-payment-ttl (.ts).
- orders.service.ts (cancel, customerCancelBlock).
- integrations/pancake/: pancake.processor, pancake-status.map, pancake-events-reconcile.service, pancake-sync-hooks, pancake-attention, pancake-payment.util, pancake-total (.ts), cùng pancake-push-reconcile.service.ts (retryCancels).
- integrations/payment/zalopay.service.ts (callback, applyGatewayPayment, recordUnappliedPayment).
- admin.service.ts (updateOrderStatus, confirmOrderPayment); admin/order-actor-transitions.ts.
- dealer.service.ts confirmDealerOrderPayment.
- merchant-fulfilment.service.ts (transition, deliver, fail, cancel); merchant.service.ts updateMerchantOrderStatus.
- loyalty.service.ts creditOrderPoints, reverseOrderPoints, lockedOrderPoints.
- affiliate.service.ts lockCommissions, reverseCommissions, approveDueCommissions.
- reward-points.service.ts grantReferralOrderReward.
- wallet.service.ts withdraw (chỉ phần đầu).
- Gomdon: chỉ gomdon-webhook.service.ts tại các điểm gọi setStatus (SHIPPING/DELIVERED).

Chưa đọc: gomdon-order.service.ts, gomdon-reconcile.service.ts, pancake-order.service.ts (job đẩy/huỷ), lifecycle/**, bank-transfer.service.ts, zalopay-reconcile.cron.ts, giao diện admin web cho hoàn tiền.

Đã đối chiếu với findings-catalog, 02-tong-hop-va-ke-hoach và D1–D5 của đợt UAT này: hai phát hiện chưa từng được báo. D1-01/D1-02 nói về nhiệm vụ/voucher, không lặp lại ở đây.

Tái hiện: cấu hình /private/tmp/claude-501/-Users-longla-coding-tubutree-mini-app/290ef81c-34a8-4ce1-8b2c-51c8d5a19dd7/scratchpad/repro/jest.config.js, file cod-returned.repro.ts và reverse-retry.repro.ts (cả hai PASS, xác nhận lỗi). Truy cập chỉ đọc vào DB UAT qua Prisma $queryRawUnsafe (chỉ SELECT).

## Bảng phát hiện

| ID | Mức (sau soát) | Soát chéo | Nhóm | Vùng | Vị trí | Mô tả + kịch bản | Đề xuất sửa + test |
|---|---|---|---|---|---|---|---|
| D12-01 | P1 | CONFIRMED | cần chủ quyết | uat | apps/api/src/modules/integrations/pancake/pancake.processor.ts:497-503, 470, 493; apps/api/src/modules/orders/order-status.service.ts:322-324; apps/api/src/modules/orders/order-reversal.service.ts:153, 173-181, 211-213 | Pancake "Đã hoàn" (5) trên đơn COD đã DELIVERED tự hoàn toàn bộ tổng vào Ví, dù COD có thể chưa được thu. Đơn COD 300.000đ, không qua Gomdon. Kho bấm "Đã nhận" (3) nhầm hoặc hàng loạt. Tubu sang DELIVERED, cộng điểm, khoá hoa hồng. Hãng giao thất bại, hàng về kho, nhân viên đặt "Đã hoàn" (5). Kết quả: khách nhận +300.000đ Ví Tubu và tin "Đã hoàn 300.000đ vào Ví Tubu" dù đã trả 0đ. | Khuyến nghị (chủ quyết): trong PancakeProcessor.onStatusUpdated, khi action.kind==='returned', order.status==='DELIVERED' và paymentMethod==='COD', không gọi setStatus RETURNED. Gọi flagAttention ("Pancake báo Đã hoàn cho đơn COD đã giao — kiểm tra hãng đã thu COD chưa; khách đã trả tiền thì duyệt trả hàng trên Tubu, chưa thì huỷ/đối soát tay"). Phương án khác: chỉ tự hoàn khi payload Pancake chứng minh đã thu COD (trường cần đối chiếu payload thật). Test đỏ: sao chép pancake.processor.spec.ts:1112 với total 300000, paymentMethod COD; mong đợi không đổi RETURNED, không refundToWallet, có cờ attention. Giữ test xanh riêng cho đơn trả trước (vẫn tự RETURNED + hoàn). |
| D12-02 | P2 | chưa soát | agent sửa ngay | uat | apps/api/src/modules/orders/order-status.service.ts:195-204, 364-389; apps/api/src/modules/integrations/pancake/pancake-sync-hooks.ts:142-178; apps/api/src/modules/integrations/pancake/pancake-push-reconcile.service.ts:233-245; apps/api/src/modules/loyalty/loyalty.service.ts:187-200 | Sau commit CANCELLED/RETURNED không có thử lại: lỗi ở reverseOrderPoints/reverseCommissions làm mất khoản hoàn điểm STANDARD của khách và job huỷ Pancake DEFERRED. Đơn WALLET 100.000đ dùng 20.000 điểm STANDARD bị huỷ (admin, Pancake hoặc cron). Tx commit CANCELLED và hoàn Ví. Sau đó loyalty.reverseOrderPoints ném lỗi (P2024, đứt kết nối, SIGTERM lúc deploy). setStatus ném lỗi, bỏ qua dòng 366-389: reverseCommissionsForOrder, refundReportedUnderpayment, enqueueGomdonCancel, pancakeHooks.afterLocalCancel, báo merchant, báo khách. Với sự kiện Pancake, processor đánh FAILED và BullMQ thử lại. Lần thử lại setStatus thấy order.status === 'CANCELLED' và thoát ở dòng 195-204 (chỉ DELIVERED có nhánh resync). Khách mất vĩnh viễn 20.000 điểm STANDARD, không nhận tin huỷ. Nếu quyết định Pancake là DEFERRED thì pancakeCancelStatus không bao giờ thành PENDING, retryCancels chỉ quét PENDING/FAILED; đơn Pancake (CHỜ CHUYỂN KHOẢN) vẫn sống, không ai xếp lệnh huỷ; cờ "Cần xử lý" cũng thiếu vì nằm trong afterLocalCancel. | (1) Chuyển khoản hoàn điểm STANDARD đã dùng vào tx của reverseFinancials, như refundConvertedPoints. Giữ thu hồi điểm đã tích/hoa hồng sau commit, nhưng thêm cột đánh dấu (ví dụ reversalEffectsAt) và cron resync như DeliveredEffectsResyncCron; nhánh tự chuyển của setStatus chạy lại khi thiếu dấu. (2) Gọi afterLocalCancel/enqueueGomdonCancel trong finally, hoặc trước reverseOrderPoints. Mở rộng retryCancels cho đơn CANCELLED có pancakeOrderId (hoặc pancakePushClaimedAt) và pancakeCancelStatus IS NULL. Test đỏ: order-status.service.spec: reverseOrderPoints reject một lần thì setStatus CANCELLED lần hai phải gọi lại reverseOrderPoints và reverseCommissionsForOrder; với decision DEFERRED + reverseOrderPoints ném lỗi, afterLocalCancel vẫn phải được gọi. |

## Chi tiết P0/P1

### D12-01 (P1, CONFIRMED, cần chủ quyết, vùng uat)

Bằng chứng đầy đủ:

- Repro jest (scratchpad repro/cod-returned.repro.ts) chạy PancakeProcessor → OrderStatusService → OrderReversalService thật. Đơn: {paymentMethod:'COD', paymentStatus:'UNPAID', status:'DELIVERED', total:300000}. Gọi onStatusUpdated({id:'p1', status:5}).
- Output: flips [{"status":"RETURNED"},{"paymentStatus":"REFUNDED"}]; refundToWallet args [["u1",300000]]; notify ORDER_RETURNED refund_note " Đã hoàn 300.000đ vào Ví Tubu." — PASS.
- Mã: order-reversal.service.ts:153 `const isCodCollected = order.paymentMethod === 'COD' && order.status === 'DELIVERED';` coi DELIVERED là đã thu tiền. Đúng với khách trả hàng do admin duyệt, không đúng với tín hiệu "Đã hoàn" của Pancake.
- Test hiện có pancake.processor.spec.ts:1112-1117 chỉ kiểm trạng thái đích với total 0 ("phần hoàn tiền … spec riêng"). Ca COD có tiền chưa có test.
- order-status.service.ts:707-709 nêu thói quen kho bấm "hoàn thành" hàng loạt trên Pancake.

Lý do soát chéo (CONFIRMED, giữ P1):

- Đã lần toàn đường, không lớp nào chặn. pancake-status.map.ts:48 ánh xạ '5' thành {kind:'returned'}. pancake.processor.ts:497-503 targetStatus đưa đơn DELIVERED sang RETURNED.
- blockedByPartialReturn (pancake.processor.ts:510-515) chỉ chặn khi có ReturnRequest APPROVED với fullReturn=false, hoặc REQUESTED. Không có ReturnRequest thì cho qua.
- Guard Gomdon ở pancake.processor.ts:478 chỉ phủ đích SHIPPING/DELIVERED, không phủ RETURNED.
- setStatusFromPancake (pancake.processor.ts:572-574) gọi OrderStatusService.setStatus, không kiểm phương thức thanh toán. setStatus gọi reverseFinancials với ảnh chụp trước chuyển (order-status.service.ts:322-324).
- order-reversal.service.ts:153 đặt isCodCollected=true chỉ vì status==='DELIVERED'. Guard ở 173-181 chuyển COD UNPAID sang REFUNDED, nhánh mặc định ở 211-213 gọi refundToWallet toàn bộ số hoàn được. Comment 146-152 nói DELIVERED tương đương "tài xế đã thu COD". Comment ở order-status.service.ts:707-709 mâu thuẫn: kho bấm hoàn thành hàng loạt là thói quen đã biết. DELIVERED sớm chỉ bị chặn cho đơn Gomdon.
- Ca: đơn COD 300k không Gomdon bị bấm 3 hàng loạt, giao thất bại, rồi nhận 5. Khách có 300k Ví dù đã trả 0đ. Tiền Ví dùng được ngay cho đơn mới, không qua admin; chỉ rút tiền qua admin duyệt chi.
- Không bác bỏ được: không lớp nào kiểm COD đã thu thật chưa. Test sẵn có không phủ ca này.
- Vì sao P1 chứ không P0: cần "Đã nhận" (3) sai hoặc sớm trước. Luồng Pancake bình thường khi giao hỏng đi 2→4→5 và rơi vào CANCELLED, không hoàn gì cho COD. Khi 3→5 là trả hàng thật sau giao, khách đã trả COD và tự hoàn là đúng. Nên sửa là đánh đổi nghiệp vụ (tự hoàn so với duyệt tay mọi đơn COD trả về từ Pancake). Nhãn "cần chủ quyết" đúng.
- Tín hiệu cho chủ: Pancake '16' (Đã thu tiền) là trạng thái thu COD thật, nhưng map thành DELIVERED giống '3' (pancake-status.map.ts:44-45). Tubu không ghi nhận đã nhận cái nào nên hiện không phân biệt được.
- Người soát không chạy lại repro; xác nhận dựa trên đọc mã.

## Bỏ sót do soát chéo phát hiện

Không có.

## Đã bác bỏ

Không có.
