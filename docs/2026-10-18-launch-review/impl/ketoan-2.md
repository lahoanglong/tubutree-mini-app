# ketoan-2: mở quyền Kế toán theo quyết định B18

Nhánh lr2/ketoan. Thay mặc định cũ "Kế toán không xem danh sách đơn".

## Bảng route trước / sau

| Route | Trước | Sau |
|---|---|---|
| GET /admin/orders | CSKH, KHO | CSKH, KHO, KE_TOAN |
| GET /admin/orders/:id/status-history | CSKH, KHO | CSKH, KHO, KE_TOAN |
| POST /admin/orders/:id/confirm-payment | ADMIN | ADMIN, KE_TOAN |
| POST /admin/orders/:id/issue-invoice | ADMIN | ADMIN, KE_TOAN |
| POST /admin/dealer-orders/:id/confirm-payment | ADMIN | ADMIN, KE_TOAN |
| GET /admin/dealers/accounts | ADMIN | ADMIN, KE_TOAN |
| GET /admin/dealers/:userId/credit-ledger | ADMIN | ADMIN, KE_TOAN |
| POST /admin/dealers/:userId/credit-payment | ADMIN | ADMIN, KE_TOAN |
| GET /admin/dealer-reward-claims | ADMIN | ADMIN, KE_TOAN |
| POST /admin/dealer-reward-claims/:id/mark-paid | ADMIN | ADMIN, KE_TOAN |
| GET /admin/cashback/transactions | ADMIN | ADMIN, KE_TOAN |
| POST /admin/cashback/transactions/:id/review | ADMIN | ADMIN, KE_TOAN |

Vẫn chỉ ADMIN (KE_TOAN nhận 403): PUT /admin/orders/:id/status (CSKH/KHO, KE_TOAN không có nút nào, `STAFF_TRANSITIONS.KE_TOAN = []`), dealer-reward-claims approve/reject/reopen, dealer-tiers/*, dealer-applications, payouts approve/reject, orders/:id/referral, resync-delivered-effects, config, commission-rates. MARKETING, CSKH, KHO, STAFF trống: không đổi (spec ma trận kiểm từng nhóm trên các route ghi tiền).

## Phân tách nhiệm vụ và vết người làm
- "Đã nhận tiền" đơn lẻ và đơn đại lý: Kế toán không xác nhận đơn do chính mình đặt (403). Ghi chú lịch sử đơn ghi "Kế toán xác nhận" kèm actorId (order_status_history, actorType ADMIN như cũ).
- Chi thưởng đại lý: chỉ APPROVED -> PAID; duyệt vẫn chỉ ADMIN. Kế toán bị chặn nếu chính mình là người duyệt (reviewedBy) hoặc chủ yêu cầu. paidBy ghi actor.
- Duyệt hoàn tiền sàn ngoài: Kế toán không duyệt giao dịch của chính mình; log ghi "Kế toán <id>" và raw.adminReview.adminId.
- Ghi nhận tiền trả nợ đại lý: role phải là DEALER nên nhân viên không tự là đối tượng; vết ledger như cũ.
- Hoá đơn VAT: chỉ ghi log máy chủ kèm actor id như ADMIN (không có bảng lịch sử).

## Kế toán thấy gì
- Danh sách đơn và lịch sử trạng thái: đầy đủ thông tin tiền, sản phẩm, hoá đơn; mã giao dịch ngân hàng, số tiền, mã đơn trong ghi chú KHÔNG bị che. SĐT khách, SĐT người nhận (shippingAddress.phone), SĐT khách cuối đơn CTV (endCustomerKey), SĐT dạng chữ trong ghi chú đơn, recyclingNote, cảnh báo Gomdon, ghi chú lịch sử và SĐT người thao tác bị che còn 3 số cuối (chữ tự do chỉ che dãy dạng SĐT VN: đầu 0/84/+84, 9-10 số, cho dấu cách . -; `maskVnPhonesInText`) (`seesFullOrderPhones`: chỉ ADMIN, CSKH, KHO thấy đủ; người có KE_TOAN và KHO/CSKH thấy đủ vì công việc kia cần). Cùng quy ước CSV đơn.
- Danh sách cashback: SĐT khách che 3 số cuối.
- Đại lý và công nợ, thưởng đại lý: SĐT đại lý hiện đủ (cần nhận diện người nhận tiền/thưởng; không phải khách lẻ).
- Danh sách đơn còn nút "Đã nhận tiền" (canConfirmPayment), Xuất CSV, hoá đơn VAT, khối công nợ/xác nhận chuyển khoản trên đơn đại lý; không còn nút đổi trạng thái, thao tác kho, đồng bộ lại sau giao, thông tin giới thiệu CTV.
- Web: menu Kế toán thêm Đơn hàng, Hoàn tiền sàn ngoài, Thưởng đại lý, Đại lý & công nợ (10 mục). Đại lý & công nợ ẩn lọc bậc và phần sửa bậc (API bậc chỉ ADMIN). Thưởng đại lý chỉ hiện nút "Đã trao thưởng" trên yêu cầu đã duyệt.

## Rủi ro còn lại
- Tìm đơn bằng SĐT vẫn khớp được dù kết quả bị che (mã đơn dạng số trùng định dạng SĐT nên không chặn được); đoán trúng SĐT đầy đủ mới xác nhận được.
- Địa chỉ giao hàng chưa che (CSV cũng không che).

## File chạm
API: admin.controller.ts, admin.service.ts, order-actor-transitions.ts, dealer-admin.controller.ts, dealer-accounts-admin.controller.ts, dealer.service.ts, cashback-admin.controller.ts, cashback.service.ts, staff-permissions.ts và các spec liên quan. Web: app/admin/page.tsx (menu, truyền cờ), dealer-claims-tab.tsx, dealer-accounts-tab.tsx, lib/admin-client.ts (nhãn nhóm).

## Kiểm
- `cd apps/api && npx jest src/common src/modules/admin src/modules/ops src/modules/dealer src/modules/cashback src/modules/affiliate/payout`: 84 suites, 1585 tests pass.
- `cd apps/web && npx vitest run src/app/admin/page.spec.tsx src/components/admin/dealer-accounts-tab.spec.tsx src/components/admin/dealer-claims-tab.spec.tsx src/components/admin/order-status-actions.spec.tsx`: pass.
- tsc api và web sạch. Race spec DB chưa chạy.

## Sửa sau review Opus
- Tiền về muộn: Kế toán gọi confirm-payment trên đơn CANCELLED/RETURNED bị 403 trước markPaid; nếu markPaid trả CLOSED (đơn bị huỷ giữa chừng) cũng 403 và không tạo khoản hoàn LATE_PAYMENT. Chỉ ADMIN ghi nhận tiền về muộn. Web ẩn nút "Ghi nhận tiền về muộn" với non-ADMIN (`canRecordLate`).
- "Đơn của chính mình" nay gồm cả đơn CTV đặt hộ có endCustomerKey hoặc shippingAddress.phone trùng SĐT nhân viên (`isStaffOwnOrder`, chuẩn hoá bằng toLocalPhone), cho đơn lẻ và đơn đại lý.
- Sổ công nợ đại lý: ghi chú "Kế toán <id> xác nhận…" khi Kế toán ghi, "Admin <id>" khi ADMIN.
- Kiểm thêm: race spec admin-confirm-payment, admin-invoice, dealer-claim-reopen, dealer-credit-limit, dealer-accounts-admin, dealer-bonus: 6 suites, 34 tests pass trên Postgres tạm cổng 5564 (đã xoá container). jest API 84 suites, 1591 tests pass.
