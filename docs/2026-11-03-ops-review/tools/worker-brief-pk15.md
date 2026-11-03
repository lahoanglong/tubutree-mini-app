# Brief gói pk15 (đường tiền): Pancake 5 sau một lần 15 không có yêu cầu trả → tiền chờ Kế toán

Đọc trước luật chung ở `worker-brief.md` và `worker-brief-r2.md` cùng thư mục: ranh giới vùng 2a, commit trailer, không push, không ghi PROD.

## Quyết định của chủ (2026-11-04, AskUserQuestion)

Chủ chọn "Chờ Kế toán".

Khi Pancake báo "Đã hoàn" (5) cho một đơn mà trước đó Pancake đã báo "Hoàn một phần" (15) trong lúc Tubu KHÔNG có yêu cầu trả nào (nhánh "hoàn tay"):
- Đơn vẫn sang "Đã trả hàng" (RETURNED).
- Tiền KHÔNG tự vào Ví/không tự hoàn.
- Tạo một khoản hoàn chờ Kế toán đối soát (UNVERIFIED), giống đơn COD chưa thu.
- Kế toán trừ phần nhân viên đã hoàn tay ngoài hệ thống. Luồng sẵn có cho phép "chỉ xác nhận một phần": phần còn lại thành DISMISSED.

Điểm/hoa hồng/kho vẫn đảo như cũ. Chỉ phần tiền bị giữ lại.

## Hiện trạng (mã trên nhánh gốc)

- `pancake.processor.ts`, `onPartialReturned`: nhánh không có yêu cầu trả gọi `flagAttention(order, manualReason, …, onlyOpenOrder=true)`. Nhánh này KHÔNG ghi `orderStatusHistory`, nên không còn dấu vết bền nào ngoài chữ trong ô `pancakeAttention`, mà nhân viên có thể bấm "Đã xử lý" để xoá chữ đó.
- `pancake.processor.ts`, `setStatusFromPancake`: `withholdCodRefund` chỉ áp cho đơn COD chưa PAID.
- `order-status.service.ts` khoảng dòng 358–380: `withholdCod` → `reverseFinancials(…, { withholdCodRefund })`, rồi `recordCodReturnUnverified(tx, order, total - prior.money)`, rồi nối dòng `ATTENTION_COD_RETURN_UNVERIFIED` vào ô.
- `order-reversal.service.ts`, `reverseFinancials`: `isCodCollected` tôn trọng `withholdCodRefund`. Đơn trả trước (`isPrepaidRefundable`) luôn hoàn qua guard `PAID → REFUNDED`.
- `refund-queue.ts`, `recordCodReturnUnverified`: dùng refKey `COD_RETURN_UNVERIFIED_REF`.
- `customer-refunds.service.ts`, `verifyOverpayment`/`dismissOverpayment`: Kế toán xác nhận (toàn bộ hoặc một phần) hoặc bỏ qua. Câu chữ hiện nói về "hãng đã thu COD".

## Việc cần làm

1. Dấu vết bền cho 15 nhánh hoàn tay: ghi một dòng `orderStatusHistory` (actorType PANCAKE, note có hằng tiền tố riêng, idempotent như nhánh ACK). Không dựa vào chữ trong ô.
2. Trong `setStatusFromPancake`, khi lật RETURNED do 5 (`returnedToSender`): nếu đơn có dấu vết ở mục 1, hoặc ô còn chứa `PANCAKE_PARTIAL_RETURN_PREFIX` (dữ liệu trước bản này), và đơn không có returnRequest APPROVED, thì giữ tiền lại cho mọi phương thức:
   - Trả trước: không chạy guard `PAID → REFUNDED`, không cộng Ví, không tạo khoản chuyển khoản. Thay vào đó ghi khoản UNVERIFIED `total - prior.money` với refKey riêng (không dùng chung refKey COD; unique `(orderId, kind, refKey)`).
   - COD chưa thu: giữ như cũ (đã chờ Kế toán).
   - Dòng "Cần xử lý" riêng, mở đầu bằng hằng mới, nói rõ: Pancake đã báo hoàn một phần rồi đã hoàn cả đơn; nhân viên có thể đã hoàn tay; Kế toán trừ phần đã hoàn tay rồi xác nhận phần còn lại ở "Hoàn tiền khách".
   - Báo ADMIN như COD.
3. Kế toán: `verifyOverpayment`/`dismissOverpayment` nhận cả refKey mới. Câu chữ ở API và màn admin (`apps/web/src/components/admin/**`) đúng cho cả hai loại: không nói "hãng đã thu COD" với đơn trả trước. Khi xác nhận, đơn trả trước hoàn theo đúng đường của luồng PENDING (khách/Kế toán chọn nơi nhận) như COD. Kiểm `paymentStatus` cuối cùng hợp lệ (REFUNDED khi đã hoàn).
   - Gỡ dòng "Cần xử lý" mới bằng `removeAttentionReason` như dòng COD.
   - Bất biến COD hiện có (`writePancakeAttention` không đè, KHO không gỡ việc của Kế toán) phải áp cho cả dòng mới. `resolvePancakeAttention` ở `admin.service.ts` phải chặn KHO khi còn khoản UNVERIFIED loại mới.
4. Không đổi luồng khi Tubu CÓ yêu cầu trả (`blockedByPartialReturn`, nhánh ACK).
5. Test:
   - Race spec trên Postgres thật, cả đơn trả trước và COD: 15 (không yêu cầu) rồi 5, kết quả Ví không đổi, có khoản UNVERIFIED đúng số tiền, ô có dòng mới.
   - Kế toán xác nhận một phần thì khách nhận đúng phần đó.
   - Ca job thử lại và 5 gửi lại không tạo khoản thứ hai.
   - 15 rồi admin lật RETURNED bằng tay thì giữ như cũ (đường admin không đổi, chỉ có cảnh báo).
   - Mỗi test phải đỏ với mã cũ. Chạy race `--runInBand`.
6. Migration: không cần nếu dùng refKey mới trong bảng có sẵn. Cần đổi cột thì hỏi phiên điều phối trước.

## Ranh giới

`order-status.service.ts`, `order-reversal.service.ts`, `refund-queue.ts`, `customer-refunds.service.ts` là vùng orders. 2a đã đồng ý cho db sửa đường này; chỉ chạm đúng phần cần.

## Sửa kèm (P3 do 2 reviewer Opus vòng 2 của r2 nêu, cùng vùng mã)

Hai reviewer APPROVE `cc4ad9eaa`. Các điểm P3 dưới đây để lại cho gói này vì nằm đúng chỗ gói sửa. Mỗi điểm cần test đỏ với mã cũ.

1. **Settle lỗi vẫn ghi mốc** (`order-status.service.ts`, `settleClosedOrderAlerts` nuốt lỗi; `markReversalEffectsDone` vẫn chạy). Lỗi DB thoáng qua thì lời "hoàn tay" kẹt mãi, có nguy cơ hoàn hai lần. Sửa: settle trả true/false; false thì `swallowedFailure = true` để chưa ghi mốc, cron chạy lại. Sửa luôn chú thích "phủ lần job thử lại".
2. **`kept` đọc ngoài tx** (`order-status.service.ts` nhánh COD, `appendAttentionReason(kept, COD)` rồi `updateMany` ghi đè cả ô). 15 commit chen giữa thì lời 15 mất, không thành SETTLED. Sửa: đọc lại ô bằng `tx.order.findUnique` sau lần lật (đã giữ khoá dòng), bỏ tiền tố ĐANG HOÀN, thay dòng 15, rồi nối dòng COD/dòng mới của gói này.
3. **Duyệt trả cả đơn không qua settle** (`order-returns.service.ts` `review()` khoảng 436–446; `flagPancakeReturn` return sớm khi `!order.pancakeOrderId`, và khi có thì ghi đè cả ô). Sửa: gọi `replaceAttentionReasonsByPrefix(…, PANCAKE_PARTIAL_RETURN_PREFIX, ATTENTION_PARTIAL_RETURN_SETTLED)` sau lần lật cả đơn; `flagPancakeReturn` nối thay vì đè. Hoặc đưa settle thành helper dùng chung.
4. **Nhánh `attention` của processor không truyền `onlyOpenOrder`** (`pancake.processor.ts` khoảng 453–456): Pancake 4 tới trễ đè lời SETTLED trên đơn đã đóng. Sửa: `onlyOpenOrder=true`.
5. **Kế toán nhận 500** khi `removeAttentionReason` hết 10 lượt (`pancake-attention.ts`, ném `Error`). Sửa: `ConflictException` với chữ "Ô Cần xử lý vừa đổi, bạn bấm lại nhé".
6. **Chữ `ATTENTION_PARTIAL_RETURN_SETTLED` chỉ đúng một phần**: câu trong ngoặc về "Hoàn tiền khách" sai với COD admin lật RETURNED (đã tự hoàn vào Ví) và đơn huỷ chưa giao. Với quyết định "Chờ Kế toán" của gói này, viết lại theo trạng thái đóng: lời cho trường hợp có khoản chờ Kế toán, và lời cho trường hợp đã tự hoàn.
7. **Báo ADMIN dòng COD 2 lần** khi hai instance cùng xử lý một sự kiện 5 (`pancake.processor.ts` khoảng 574–577, bên thua vẫn thấy điều kiện đúng). Sửa: chỉ báo khi lần lật thắng (`setStatus` trả cờ thắng/thua).
8. **Idempotent của lần gửi lại**: ca cuối `closed-order-effects.race-spec.ts` không kiểm được gì vì nhánh idempotent không gọi settle. Thay bằng ca kiểm thật: cron `resyncReversalEffects` chạy 3 lần giữ nguyên ô, không báo lại.

Không làm trong gói này: P3-5 (vòng ghi lại lý do R khi KHO gỡ chen giữa, cửa sổ vài ms, không chạm tiền), khách tự huỷ (gần như không xảy ra sau 15), 3 chỗ ghi đè cả ô khác (`zalopay.service.ts`, `refund-queue.ts`, `order-returns.service.ts`) là phần 2a nhận sau r2.

Đơn đã đóng trên PROD còn lời 15 cũ: không backfill tự động. Nếu cần, chủ cho phép đọc PROD thì chạy truy vấn đọc `status IN ('CANCELLED','RETURNED') AND "pancakeAttention" LIKE '%Pancake báo HOÀN MỘT PHẦN%'`.

## Ràng buộc bắt buộc (phiên điều phối thêm)

- **Không hoàn hai lần khi chạy lại.** Đơn trả trước bị giữ tiền thì guard `PAID → REFUNDED` không chạy. Chứng minh bằng race test:
  - `reverseFinancials`/`reverseClosedOrderEffects` chạy lại (job thử lại, cron `resyncReversalEffects`, 5 gửi lại) không cộng Ví và không tạo khoản thứ hai;
  - sau khi Kế toán xác nhận một phần, chạy lại cũng không hoàn thêm.
  Kiểm `prior.money` có tính khoản UNVERIFIED/PENDING/DISMISSED không; không tính thì phải chặn bằng cách khác.
- **Khách không thấy "Đã hoàn tiền" trước khi Kế toán xác nhận.** Chọn cách xử lý `paymentStatus` cho đơn trả trước bị giữ tiền, kiểm các nơi hiển thị (Mini + web, chi tiết đơn, danh sách đơn, admin), và giải thích lựa chọn trong báo cáo.
- `verifyOverpayment` hiện coi mọi `kind === 'RETURN'` là COD (`codReturn`). Tách chữ theo refKey: không nói "hãng đã thu COD" với đơn trả trước.
- `isUnverifiedRefundRow` (`refund-queue.ts`) phải nhận refKey mới, nếu không Kế toán không bấm được.
- `admin.service.ts` khoảng dòng 1397 (`resolvePancakeAttention`) chỉ tra refKey COD: thêm refKey mới.

## Nơi làm

- Worktree mới `/Users/longla/coding/tubutree-mini-app/.claude/worktrees/ops-1103-pk15`, nhánh `ops/1103-pk15` từ `ops/1103-r2m` (tip `2ad49030f`). Phiên điều phối tạo sẵn.
- Postgres cho race: `postgresql://tubu@127.0.0.1:46330/tubutree_it?` (chạy `npx prisma migrate deploy` trước). Không dùng cổng khác.
- Commit nhỏ theo từng bước, trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Không push.
- Báo cáo cuối: danh sách commit, lệnh test đã chạy và kết quả, mỗi test mới đỏ với mã cũ ra sao, các quyết định đã chọn (marker, `paymentStatus`, chữ), câu hỏi còn mở.
