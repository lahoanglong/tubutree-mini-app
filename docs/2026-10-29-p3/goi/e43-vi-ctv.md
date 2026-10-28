# Gói e43-vi-ctv: thu hồi hoa hồng đã vào Ví khi đơn bị trả (E-43)

Chủ chốt sáng 29/10 (AskUserQuestion): **trừ thẳng Ví CTV**, số dư có thể âm. Thay cho cách cũ (chỉ báo kế toán). Gói đụng tiền thật: làm cẩn thận, có race test.

## Hiện trạng (mã trên main 815fa3c1e)
- `AffiliateService.reverseCommissionsForOrder` (`apps/api/src/modules/affiliate/affiliate.service.ts:~1115`): trả cả đơn hoặc huỷ chỉ đổi PENDING/LOCKED thành REJECTED, báo CTV (`CTV_NOTIFICATION.REVERSED`), rồi gọi `alertPaidCommissionOfReversedOrder` báo kế toán phần APPROVED/PAID.
- `OrderReversalService.reversePartialReturn` (`apps/api/src/modules/orders/order-reversal.service.ts:~500`): trả một phần cắt `amount` của hoa hồng PENDING/LOCKED theo dòng trả (`commissionByLine`, `lineAmounts`, mức % từng dòng). APPROVED/PAID không đụng. `OrderReturnsService` gọi `alertPaidCommissionOfReversedOrder(..., { returnRequestId })` ở nhánh không trả cả đơn.
- Hoa hồng APPROVED được cron chuyển vào Ví (dòng sổ `COMMISSION_PAYOUT`), rồi thành PAID. Xem chỗ ghi `COMMISSION_PAYOUT` và `payoutBatchId` để biết khi nào tiền thật đã vào Ví.
- Sổ Ví: `WalletLedgerService.applyDelta` / `applyWalletDelta` (`apps/api/src/modules/wallet/wallet-ledger.service.ts`). Chặn lệnh trừ làm âm (dòng ~64). Khoá chống trùng `(userId, type, refId)`.
- Gói `ctv` của đợt P3 (chạy song song, nhánh `review/p3-ctv`) đang sửa `alertPaidCommissionOfReversedOrder` để chỉ báo khi dòng trả thật sự có hoa hồng. Gói này thay hẳn đường đó; lúc gộp sẽ giữ bản của gói này. Đừng phụ thuộc vào thay đổi của gói ctv.

## Việc
1. Migration (chỉ thêm), thư mục `20261029040000_commission_wallet_reversal`: thêm giá trị `COMMISSION_REVERSAL` vào `WalletTxType`. Không thêm cột trừ khi thật cần (cần thì ghi lý do).
2. `applyWalletDelta`: thêm tuỳ chọn cho phép trừ làm âm, CHỈ dùng cho `COMMISSION_REVERSAL`. Mọi loại trừ khác (ORDER_PAY, XU_CONVERT, ...) vẫn chặn như cũ, kể cả khi số dư đang âm. Có test.
3. Trả cả đơn/huỷ (`reverseCommissionsForOrder`), với từng hoa hồng của đơn:
   - APPROVED chưa vào Ví (không có dòng `COMMISSION_PAYOUT` cho nó, không nằm trong lệnh rút đang chờ): đổi thành REJECTED như PENDING/LOCKED (chưa có tiền nào chuyển).
   - Đã vào Ví (PAID qua `COMMISSION_PAYOUT`): trừ Ví CTV đúng `amount` hiện tại của hoa hồng bằng dòng `COMMISSION_REVERSAL` (`refType 'COMMISSION'`, `refId` = id hoa hồng), đổi hoa hồng thành REJECTED. Cùng một transaction với việc đổi trạng thái; chạy lại không trừ hai lần.
   - Hoa hồng nằm trong lệnh rút ngân hàng cũ chưa xử lý (nếu còn loại này): không tự trừ, giữ báo kế toán như cũ. Ghi rõ trong báo cáo.
4. Trả một phần (`reversePartialReturn`): hoa hồng APPROVED/PAID cũng cắt theo đúng công thức dòng trả như PENDING/LOCKED (`commissionByLine`, giảm `amount` và `commissionableTotal`). Phần cắt của hoa hồng đã vào Ví thì trừ Ví bằng `COMMISSION_REVERSAL`, `refId` = `<commissionId>:<returnRequestId>` để mỗi yêu cầu trả trừ một lần. Trả món 0% thì không trừ gì. Hoa hồng APPROVED chưa vào Ví chỉ giảm `amount`.
5. Báo tin:
   - CTV: dùng mẫu sẵn có `CTV_NOTIFICATION.REVERSED` (không thêm mẫu ZNS mới), số tiền là phần đã trừ.
   - Kế toán: `alertPaidCommissionOfReversedOrder` đổi lời thành "đã trừ Ví CTV …" cho phần đã trừ, và chỉ còn báo "cần kế toán xử lý" cho phần không tự trừ được (mục 3, ý cuối). Nếu không còn gì cần xử lý tay thì không cần báo, hoặc báo một dòng thông tin; chọn cách ít ồn và ghi lý do.
6. Hiển thị:
   - Lịch sử Ví ở Mini App và web có nhãn tiếng Việt cho `COMMISSION_REVERSAL` (ví dụ "Thu hồi hoa hồng đơn #CODE").
   - Số dư âm hiển thị đúng dấu ("-50.000đ") ở Mini, web và trang quản trị.
   - Thanh toán bằng Ví và đổi Xu khi số dư âm: nút bị khoá kèm lời rõ ràng, không lỗi khó hiểu.
   - Kiểm mọi chỗ đọc `walletBalance` giả định không âm (grep), cả shared-types.
7. Lệch sổ: cron đối soát Ví (gói api-tin đợt 28/10) vẫn đúng với dòng mới (bất biến `walletBalance == SUM(delta)`).
8. Tài liệu: thêm vào runbook (`docs/launch/deploy-rollback-runbook.md`) một dòng ở mục 1.13: image cũ không biết `COMMISSION_REVERSAL` (enum Prisma lạ khi đọc lịch sử Ví), nên quay image sau khi đã có dòng này cần xem lại.

## Kiểm bắt buộc
- Unit: affiliate.service.spec, order-reversal/order-returns spec, wallet-ledger spec. Test đỏ trước rồi mới xanh.
- Race (Postgres thật, `race-one.sh`): trả cả đơn có hoa hồng đã vào Ví (trừ đúng, Ví có thể âm, chạy lại không trừ lần hai); trả một phần hai yêu cầu song song cùng đơn; trả đơn chạy song song với cron chuyển hoa hồng vào Ví (không mất, không trừ trùng, tổng sổ khớp); thanh toán bằng Ví khi số dư âm bị chặn. Chạy lại toàn bộ race spec có chữ `return`, `commission`, `wallet`, `payout`, `affiliate`.
- gate.sh 0 FAIL; Playwright Mini + web cho màn Ví/CTV.
