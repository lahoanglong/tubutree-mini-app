# PA-4 — Toàn vẹn đại lý / Pancake / lộ dữ liệu

## C-008 (phần dealer) — XONG
- `dealer.service.ts` `placeOrder`: hạn mức = `tier?.creditLimit ?? 0`, kiểm tra cả ở fast-fail lẫn trong transaction Serializable (bỏ nhánh `&& tier`). Không tier -> từ chối CREDIT với thông báo "chưa được gán bậc"; có tier giữ nguyên "Vượt hạn mức công nợ.". PREPAID không bị ảnh hưởng.
- Test: `dealer.service.spec.ts` (describe "hạn mức công nợ (C-008)", 4 ca; ca không-tier ĐỎ trước khi sửa: "Received promise resolved instead of rejected"); race spec `test/integration-race/dealer-credit-limit.race-spec.ts` (Postgres thật: không tier 4 đơn đồng thời -> 0 đơn, nợ 0; có tier 160k/5 đơn 80k -> 1 thành công, nợ 80k).
- Giả định: không đổi đường ghi công nợ (vẫn Serializable); bắt buộc tier khi gán role thuộc PA-3.

## C-011 — XONG
- `pancake-push-reconcile.service.ts`: where có `NOT: { type: 'DEALER', items: { some: { backorderedQty: { gt: 0 } } } }` (không chiếm lô BATCH_SIZE) + guard trong vòng lặp. Đơn khách lẻ giữ hành vi cũ. Đơn đại lý được đẩy khi DealerBackorderService lấp đủ.
- Test: 4 ca mới trong `pancake-push-reconcile.service.spec.ts` (2 ca ĐỎ trước khi sửa).
