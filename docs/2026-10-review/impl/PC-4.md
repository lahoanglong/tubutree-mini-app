# PC-4 — Báo cáo thực thi

## C-016 — Xoá tài khoản: màn admin xử lý + ẩn danh dữ liệu cá nhân — XONG

Commit: `74ca61c` (service + race spec), `73ae344` (API admin), `28cf5fb` (web admin), `1a6e292` (chú thích).

### Đã làm
- `apps/api/src/modules/users/account-deletion.service.ts` (mới):
  - `process(requestId, adminId, note?)`: một transaction, khoá `FOR UPDATE` dòng yêu cầu rồi dòng user. Yêu cầu đã RESOLVED → trả `alreadyProcessed: true` (idempotent; 2 admin cùng bấm chỉ xử lý một lần). Không còn user → chỉ đóng yêu cầu.
  - Chặn (400, `code: ACCOUNT_DELETION_BLOCKED`, `message` tiếng Việt liệt kê đủ lý do, `blockers[]`) khi: quyền ADMIN/STAFF; Ví Tubu ≠ 0; còn xu; hoàn tiền mua sắm chờ (`cashbackPending` hoặc CashbackTransaction PENDING/CONFIRMED); đơn PENDING_PAYMENT/CONFIRMED/PACKED/SHIPPING; lệnh rút REQUESTED/APPROVED; đổi trả REQUESTED; OrderCustomerRefund PENDING; gói định kỳ ACTIVE/PAUSED; hoa hồng PENDING/LOCKED/APPROVED chưa vào lô trả; tổng công nợ đại lý ≠ 0. Bị chặn thì rollback, yêu cầu giữ PENDING.
  - Ẩn danh: users (fullName = "Người dùng đã xoá"; phone/email/dob/avatarUrl/zaloId/zalo token = null; metadata chỉ còn `anonymizedAt` + `deletionRequestId`; `isBlocked = true`); mọi địa chỉ (recipient/phone/street; giữ dòng vì FK RESTRICT từ gói đã huỷ); `orders.shippingAddress` (recipient/phone/street, giữ tỉnh/huyện/xã + mã) và `note`/`recyclingNote` = null; thu hồi mọi refresh token; hồ sơ đại lý (ownerName/phone/address/ảnh CCCD/ảnh cửa hàng); gian hàng (gỡ xuất bản, xoá tài khoản ngân hàng + địa chỉ/SĐT kho). Đóng mọi yêu cầu PENDING trùng của cùng khách.
  - KHÔNG xoá/sửa: đơn (tổng tiền, trạng thái, userId), hoa hồng, sổ Ví, lệnh rút, sổ công nợ đại lý, xu/điểm.
  - `list(status)`: tối đa 100 yêu cầu + thông tin khách + lý do chặn hiện tại (gom bằng groupBy, cố định 8 truy vấn cho cả danh sách).
- `admin-account-deletion.controller.ts` (mới, `@Roles('ADMIN')`): `GET /admin/account-deletion-requests?status=PENDING|RESOLVED|ALL`, `POST /admin/account-deletion-requests/:id/process` body `{ note? }` (≤500 ký tự). Đăng ký trong `users.module.ts`.
- Web admin: `apps/web/src/components/admin/account-deletion-panel.tsx` (mới): khối "Yêu cầu xoá tài khoản" hiển thị dưới tab **Người dùng**: lọc Chờ xử lý/Đã xử lý/Tất cả, xem lý do chặn, ô ghi chú, nút "Xử lý (ẩn danh)" (khoá khi còn lý do chặn, hỏi xác nhận, hiện lỗi server). `page.tsx` chỉ thêm 2 dòng (import + một dòng render) để tránh đụng PC-8.

### Test (đỏ → xanh)
- `apps/api/test/integration-race/account-deletion.race-spec.ts` (Postgres thật, 11 test): ẩn danh đúng + giữ đơn/hoa hồng/sổ Ví/đơn khách khác; chặn ví, xu, hoàn tiền, đơn đang giao, lệnh rút, hoa hồng+đổi trả+công nợ đại lý (liệt kê đủ), quyền STAFF; 404; 6 lần gọi đồng thời → đúng 1 lần xử lý; đóng yêu cầu trùng; danh sách có lý do chặn. Đỏ trước khi có service (không tìm thấy module). Kiểm thêm: bỏ 2 câu `FOR UPDATE` thì test đồng thời đỏ (`Expected length: 1, Received length: 6`), khôi phục thì xanh.
- `apps/api/src/modules/users/admin-account-deletion.controller.spec.ts` (3 test): chỉ ADMIN, không public; chuyển tham số; từ chối status lạ.
- `apps/web/src/components/admin/account-deletion-panel.spec.tsx` (5 test).

### Lệnh kiểm chứng + output
```
cd apps/api && DATABASE_URL=postgresql://tubu:tubu@localhost:5564/tubutree_it?schema=public npx jest -c test/integration-race/jest.config.js --runInBand account-deletion address-subscription
PASS test/integration-race/account-deletion.race-spec.ts
PASS test/integration-race/address-subscription.race-spec.ts
Tests:       18 passed, 18 total
cd apps/api && npx jest --maxWorkers=1 src/modules/users      -> Tests: 23 passed, 23 total
cd apps/web && npx vitest run src/components/admin/account-deletion-panel.spec.tsx   -> Tests 5 passed (5)
npx tsc --noEmit -p tsconfig.json (api), npx tsc --noEmit (web): không lỗi
npx eslint <các file đã sửa> (api + web): không lỗi
```

### Migration
Không cần: bảng `account_deletion_requests` đã có `status/adminNote/reviewedBy/reviewedAt`.

### Giả định
- Ẩn danh thay vì xoá cứng; đơn, hoa hồng, sổ Ví, lệnh rút (kể cả `bankInfo` của lệnh đã trả), công nợ đại lý giữ cho kế toán/đối soát.
- Còn xu cũng chặn (xu là tiền khách đã trả, không tự huỷ thay khách); Điểm Xanh không chặn (không quy ra tiền).
- `invoiceRequest` (MST, tên công ty, email nhận hoá đơn) giữ nguyên: là chứng từ hoá đơn VAT của doanh nghiệp.
- Giữ `referralCode`, `pancakeCustomerId` (định danh nội bộ/đối soát, không phải dữ liệu cá nhân trực tiếp).
- Không báo khách sau khi xử lý: zaloId/SĐT đã xoá nên không còn kênh; CSKH liên hệ khách trước khi bấm (ghi vào ô ghi chú).

### Việc còn lại (ngoài nhóm file của gói)
- `JwtAuthGuard` không kiểm `isBlocked`: access token cũ còn dùng được tới hết `JWT_ACCESS_TTL` (15 phút) sau khi ẩn danh; refresh đã bị chặn. Nên kiểm `isBlocked` ở guard hoặc checkout.
- Link CTV/`referralCode` của tài khoản đã ẩn danh vẫn gắn được hoa hồng cho đơn mới (affiliate/checkout không kiểm `isBlocked` của người giới thiệu).
- Dữ liệu đã đẩy sang Pancake, ảnh CCCD/ảnh trong kho lưu trữ, nội dung bài viết cộng đồng do khách tự viết không bị xoá (cần quy trình xoá ở dịch vụ ngoài / storage).
