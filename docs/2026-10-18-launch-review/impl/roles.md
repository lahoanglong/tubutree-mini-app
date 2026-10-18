# Gói `roles` — nhóm việc MARKETING và KE_TOAN (D1-05)

Nhánh `lr/roles`, worktree `.claude/worktrees/lr-roles`. Chưa push. Mặc định câu 5 (D1 mục 6): kế toán và marketing là người riêng, là STAFF có nhóm việc, không cấp ADMIN.

## 1. Đã làm

**API (quyền kiểm ở server, mặc định từ chối).**
- `apps/api/src/common/staff-permissions.ts`: `STAFF_PERMISSIONS = ['CSKH', 'KHO', 'MARKETING', 'KE_TOAN']`. Thêm `COMMUNITY_MODERATORS = ['CSKH', 'MARKETING']`, dùng chung cho route kiểm duyệt, quyền xem ảnh bài chưa đăng (`community-feed.service.ts` getImage) và "Việc cần xử lý".
- Gắn `@AllowStaff` (theo route, hoặc ở lớp khi cả controller cùng một việc):
  - **MARKETING:** `admin/coupons` (3 route), `admin/coupon-batches` (lớp), `admin/flash-sales` (lớp), `admin/faqs` (lớp), `admin/content-kits` (lớp), `admin/academy` (lớp), `admin/notification-templates` (lớp), 9 route kiểm duyệt `/feed/admin/*` (cùng CSKH), `GET admin/reports/sources`, `GET admin/products/search` và `GET admin/variations/lookup` (ô chọn sản phẩm của Flash Sale và Content Kit), `GET admin/ops/inbox`.
  - **KE_TOAN:** `admin/customer-refunds` (lớp, cả 6 route theo luật hiện có: nhận, trả lại, xác nhận/không phải tiền dư, đã chi); `GET admin/payouts`, `GET admin/payouts/pit-report`, `POST admin/payouts/:id/mark-paid`; đối soát gian hàng đối tác `admin/merchant-fulfilment` overview, statements, payouts (xem, lập phiếu, đã chuyển/đã thu, huỷ); `GET admin/reports/revenue`, `order-items/export`, `exports/{tax,payouts,refunds}`; `GET admin/orders/export`; `GET admin/ops/inbox`.
  - **Giữ chỉ ADMIN:** cấp/thu vai trò, `admin/config`, khoá/mở khoá, gán nhóm việc, `admin/commission-rates`, `admin/dealer-prices/import`, lương/ca/chấm công (D1-15: lương chỉ có ở miniapp, để nguyên), duyệt/từ chối rút tiền, sửa phí đối tác, xác nhận hàng ký gửi, sự kiện cộng đồng và chọn người thắng.
- `order-actor-transitions.ts`: MARKETING và KE_TOAN không có nút trạng thái đơn nào (`[]`).
- "Việc cần xử lý" (`ops-inbox.service.ts`): MARKETING thấy `communityPending`, `communityUnanswered`. KE_TOAN thấy `customerRefunds`, `merchantToSettle`, `merchantPayoutsPending`. Rút tiền chờ DUYỆT (`payouts`) vẫn chỉ ADMIN.
- Sửa lỗi lộ ra khi có nhóm mới (`admin.service.ts` setStaffPermissions): thứ tự lưu theo `STAFF_PERMISSIONS` (MARKETING trước KE_TOAN) khác thứ tự chữ cái. Vì vậy gán lại đúng tập cũ vẫn báo "đã đổi" và ghi một dòng sổ rỗng. Giờ so sánh theo tập đã sắp xếp.
- CSKH/KHO: không đổi quyền nào. Bảng duyệt sinh từ metadata trước khi sửa, các dòng CSKH/KHO giữ nguyên.

**Test duyệt bảng quyền** (`apps/api/src/common/staff-permissions.matrix.spec.ts`, viết lại):
- Đọc metadata `@Roles`/`@AllowStaff` thật của mọi controller trong đồ thị `AppModule`. Phạm vi gồm route `@Roles('ADMIN')`, route có STAFF, và route có `@AllowStaff`; tổng 216 route. Kết quả phải `toEqual` bảng `EXPECTED`. Thêm route quản trị mới mà không khai vào bảng, hoặc thêm/bớt một `@AllowStaff`, thì spec đỏ.
- Đọc cả handler kế thừa từ lớp cha và route khai nhiều đường dẫn. Route có đoạn `/admin` ở bất kỳ vị trí nào (`/admin/*`, `/feed/admin/*`, `/refill/admin/*`) mà thiếu `@Roles` (thành công khai) làm spec đỏ; đã thử gỡ `@Roles` ở một controller và spec đỏ đúng chỗ.
- Kiểm `@AllowStaff` chỉ dùng tên nhóm có thật. Có regex chặn: không nhóm nào chạm cấu hình, phân quyền, khoá tài khoản, % hoa hồng/giá sỉ, lương/ca, duyệt rút tiền, xuất người dùng.
- 36 route ghi tiền chạy qua `RolesGuard` thật với từng nhóm. Gồm hoàn tiền, "Đã chi" CTV/đối tác/thưởng đại lý, ghi nhận công nợ, "Đã nhận tiền", huỷ đơn, duyệt trả hàng, lương, cashback, thưởng sự kiện, % hoa hồng, giá sỉ. Nhóm không được phép phải bị 403, kể cả STAFF có mọi nhóm còn lại cùng lúc.

**Web admin:**
- `lib/admin-client.ts`: `StaffPermission` có thêm 2 nhóm, kèm nhãn. Ngăn chi tiết nhân viên (`user-detail-drawer.tsx`) tự hiện ô Marketing và Kế toán.
- `app/admin/page.tsx` (diff +7/−5): 2 dòng `STAFF_TABS`; huy hiệu "Hoàn tiền khách" hiện với mọi ai thấy mục đó (ADMIN, KE_TOAN); truyền `canReview={isAdmin}` cho Rút tiền, `sections` cho Báo cáo, `canEditAll={isAdmin}` cho Mẫu thông báo.
- `reports-tab.tsx`: thêm `reportSectionsFor()`. KE_TOAN thấy doanh thu và file tài chính, MARKETING thấy nguồn khách; phần không có quyền thì không render và không gọi API.
- `payout-admin-tab.tsx`: kế toán không có nút Duyệt/Từ chối, có dòng "Chờ quản trị viên duyệt…", mặc định lọc APPROVED.
- `merchant-fulfilment-tab.tsx`: người không phải ADMIN không thấy "Sửa phí" và lối sang "Xác nhận hàng ký gửi".

**Sau review (opus) — chặn ở service, chỉ áp cho STAFF, ADMIN giữ nguyên:**
- **Hoàn tiền khách** (`customer-refunds.service.ts`): kế toán không thay tài khoản nhận khách đã có, vì đổi tài khoản là đổi người nhận tiền. (Lượt 2: khoản chưa có tài khoản thì kế toán cũng không nhập, xem mục dưới.) Kế toán không nhận, chi, xác nhận hay bỏ qua khoản hoàn của chính mình. Controller lấy `byStaff` từ `@CurrentUser('role')`, vai trò đọc lại từ DB mỗi request.
- **Mẫu thông báo:** marketing chỉ sửa nội dung 24 mẫu khuyến mãi / tương tác (`MARKETING_TEMPLATE_CODES`: voucher, flash sale, giỏ bỏ quên, giảm giá, nhắc điểm, game, cộng đồng). Mẫu đơn hàng, hoàn tiền, hoa hồng, đối tác và vận hành chỉ ADMIN sửa, vì sửa thành "chuyển khoản vào STK…" là lừa đảo qua kênh chính thức. Đổi kênh hay mã mẫu ZNS (tính phí) cũng chỉ ADMIN. Mỗi lần sửa ghi log người sửa. Web chỉ hiện mẫu sửa được và khoá ô kênh/mã ZNS. Có spec bảo đảm mọi mã trong danh sách có trong seed và không mã nào thuộc nhóm giao dịch.
- **Voucher:** marketing không tạo hay gia hạn mã cá nhân (USER_GROUP) của chính mình. Tạo hay sửa mã, tạo lô mã đều ghi log người làm. (Lượt 2: thêm cột người tạo/sửa và trần, xem mục dưới.)
- **Chi tiền:** kế toán không bấm "Đã thu" phiếu âm (gian hàng nợ Tubu), vì đó là xoá nợ, giống "Đã nhận tiền" chỉ ADMIN; web ẩn nút này với người không phải ADMIN. Kế toán cũng không chi phiếu của gian hàng mình làm chủ, không chi lệnh rút CTV của chính mình.
- **Thẻ hộp hàng:** thêm `GET admin/coupon-batches/claim-url-base` (MARKETING) trả link gốc Mini App. Trước đây panel gọi `GET admin/config` (chỉ ADMIN), nên marketing nhận 403 và mất link in QR.
- Review opus lượt 2 cho 6 commit sửa (b9a3cc0c..b305e943): **APPROVE với sửa**, các việc sửa ở mục dưới.
- Đã rà mọi API mà các tab của MARKETING/KE_TOAN gọi. Ngoài các nút đã ẩn theo ADMIN (Sửa phí, đối tác, duyệt rút), không còn lời gọi nào bị 403.

**Sửa sau review lượt 2 (APPROVE với sửa). Mỗi việc một commit, TDD; "nhân viên" ở đây = người làm không phải ADMIN:**
- **0. Gộp nhánh:** `029d773e` gộp `review/2026-10-18-launch` mới nhất.
- **1. Hoàn tiền, MAJOR** (`4c35eded`, `customer-refunds.service.ts`):
  - Nhân viên gõ bất kỳ trường tài khoản nhận nào ở `claim`/`mark-paid` thì bị 403: "Nhân viên không nhập tài khoản nhận. Khách chưa chọn tài khoản nhận — nhờ quản trị viên nhập." Áp cho mọi loại dòng, kể cả END_CUSTOMER.
  - Dòng chưa có tài khoản thì nhân viên không nhận, không chi (403, cùng câu hướng dẫn). Kế toán chỉ xử lý dòng đã có tài khoản do khách lưu trong app hoặc do ADMIN nhập. **Hệ quả:** dòng END_CUSTOMER chưa có tài khoản giờ chỉ ADMIN xử lý được.
  - Race ở `claim`: khi ADMIN gõ tài khoản, điều kiện ghi có thêm `bankAccountNo` bằng giá trị đã đọc. Nếu khách vừa lưu tài khoản thì trả 409 và không ghi đè. Đã thử bỏ điều kiện này: race spec đỏ.
  - "Khoản của chính mình" so cả `row.phone` với SĐT của người làm (chuẩn hoá `toLocalPhone`).
  - Web (`customer-refund-paid-dialog.tsx`): nhân viên mở dòng chưa có tài khoản thì không thấy ô nhập; thấy câu hướng dẫn và nút xác nhận bị khoá.
  - Test: service, controller (`DEALER` cũng tính là nhân viên), 4 race mới trong `q1-money-refunds`, vitest dialog.
- **2. Trần mã giảm giá, CAO** (`e44eb7c5`):
  - Khoá SystemConfig `coupon.staff_max_percent` = 50 và `coupon.staff_max_amount_vnd` = 200000. Có trong `seed.ts` (createOnly), tiền tố `coupon` có trong `REFERENCE_CONFIG_PREFIXES`, `APPROVED_LOADED_KEYS` và luật sửa ở `admin-config-rules.ts` (1–100%, 1.000–100.000.000đ).
  - Nhân viên tạo hoặc sửa mã, kể cả từng mã trong lô: mã % không quá trần % và phải có "Giảm tối đa" không quá trần tiền; mã giảm tiền không quá trần tiền; bắt buộc có tổng lượt dùng > 0. Sai thì 403 kèm câu tiếng Việt.
  - Migration `20261018160000_coupon_actor` thêm `coupons.createdById`, `updatedById` (nullable, không FK). Hai cột được ghi ở mọi lần tạo/sửa, kể cả `setActive` của lô; `logger.warn` giữ nguyên.
  - `PATCH` mã và lô: nhân viên chỉ sửa được mã do nhân viên tạo. Mã cũ chưa có người tạo, hoặc do ADMIN tạo, thì 403. Kết quả sau sửa cũng phải qua trần; riêng tắt mã thì không kiểm trần.
  - Chặn tự dùng trong module `coupons`: người tạo không phải ADMIN không xem, nhận hay áp mã mình tạo ("Mã do chính bạn tạo ở trang quản trị — không dùng cho đơn của mình."). Không sửa `modules/checkout/*`.
  - Race mới: `staff-coupons.race-spec.ts` (4 ca).
  - `reference-seed`: khoá mới nằm trong `seed.ts` giống `flashsale.max_discount_pct`, nên `extraKeys` không đổi; race spec xanh. Không thêm INSERT trong migration: code tự dùng giá trị mặc định khi thiếu khoá.
- **3. CSV đơn, TRUNG BÌNH** (`5587f6f3`): `GET admin/orders/export` do người không phải ADMIN xuất thì SĐT khách, người nhận và CTV chỉ giữ 3 số cuối (`*******123`). Họ tên giữ nguyên. CSV tài chính (tax/payouts/refunds) không đổi.
- **4. Mẫu thông báo, THẤP** (`a4391474`):
  - Nhân viên sửa nội dung thì bị từ chối (400, câu tiếng Việt) nếu có dãy từ 8 chữ số, kể cả xen dấu cách hoặc chấm.
  - Cũng bị từ chối nếu có link `http(s)://`, `www.` hay `zalo.me` ngoài `tubutree.com|vn|com.vn`, Zalo OA của shop (`ZALO_OA_ID`) và Mini App (`app.miniapp_base_url`).
  - ADMIN không bị lọc.
  - Bug ZNS kẹt: chỉ kiểm "ZNS cần mã mẫu" khi lần sửa có đổi kênh hoặc mã mẫu.
- **5. THẤP** (`157f69cf`):
  - `payouts/:id/mark-paid`, `merchant-fulfilment/payouts/:id/paid`, `notification-templates/:code` dùng `role !== 'ADMIN'` (có spec controller).
  - Matrix spec đưa mọi route có `/admin` ở bất kỳ vị trí nào vào bảng, kể cả khi `@Roles` có trộn vai trò khác. Mọi route như vậy phải có trong `EXPECTED`.
  - Hiện các route đó đều đã có trong bảng. Đã thử: đổi `@Roles` của `GET /feed/admin/events` thành `('ADMIN','DEALER')` và bỏ dòng khỏi bảng. Spec cũ vẫn xanh; spec mới đỏ ở 2 test.

## 2. Bảng quyền (ADMIN luôn ✓; "mọi NV" = route `@Roles` có STAFF, nhân viên chưa có nhóm cũng vào)

Nguồn sự thật: `EXPECTED` trong `staff-permissions.matrix.spec.ts` (spec xanh = bảng khớp mã).

### 2a. Route nhân viên vào được (106)
| Route | CSKH | KHO | MARKETING | KE_TOAN |
|---|:-:|:-:|:-:|:-:|
| `GET /academy/courses` | mọi NV | mọi NV | mọi NV | mọi NV |
| `GET /academy/courses/:id` | mọi NV | mọi NV | mọi NV | mọi NV |
| `POST /academy/lessons/:id/complete` | mọi NV | mọi NV | mọi NV | mọi NV |
| `GET /admin/academy/courses` |  |  | ✓ |  |
| `POST /admin/academy/courses` |  |  | ✓ |  |
| `DELETE /admin/academy/courses/:id` |  |  | ✓ |  |
| `PATCH /admin/academy/courses/:id` |  |  | ✓ |  |
| `POST /admin/academy/courses/:id/lessons` |  |  | ✓ |  |
| `DELETE /admin/academy/lessons/:id` |  |  | ✓ |  |
| `PATCH /admin/academy/lessons/:id` |  |  | ✓ |  |
| `GET /admin/content-kits/:productId` |  |  | ✓ |  |
| `PUT /admin/content-kits/:productId` |  |  | ✓ |  |
| `GET /admin/coupon-batches` |  |  | ✓ |  |
| `POST /admin/coupon-batches` |  |  | ✓ |  |
| `PATCH /admin/coupon-batches/:batch` |  |  | ✓ |  |
| `GET /admin/coupon-batches/:batch/codes` |  |  | ✓ |  |
| `GET /admin/coupon-batches/claim-url-base` |  |  | ✓ |  |
| `GET /admin/coupons` |  |  | ✓ |  |
| `POST /admin/coupons` |  |  | ✓ |  |
| `PATCH /admin/coupons/:id` |  |  | ✓ |  |
| `GET /admin/customer-refunds` |  |  |  | ✓ |
| `POST /admin/customer-refunds/:id/claim` |  |  |  | ✓ |
| `POST /admin/customer-refunds/:id/dismiss` |  |  |  | ✓ |
| `POST /admin/customer-refunds/:id/mark-paid` |  |  |  | ✓ |
| `POST /admin/customer-refunds/:id/release` |  |  |  | ✓ |
| `POST /admin/customer-refunds/:id/verify` |  |  |  | ✓ |
| `GET /admin/faqs` |  |  | ✓ |  |
| `POST /admin/faqs` |  |  | ✓ |  |
| `DELETE /admin/faqs/:id` |  |  | ✓ |  |
| `PATCH /admin/faqs/:id` |  |  | ✓ |  |
| `GET /admin/flash-sales` |  |  | ✓ |  |
| `POST /admin/flash-sales` |  |  | ✓ |  |
| `DELETE /admin/flash-sales/:id` |  |  | ✓ |  |
| `PATCH /admin/flash-sales/:id` |  |  | ✓ |  |
| `POST /admin/flash-sales/:id/items` |  |  | ✓ |  |
| `DELETE /admin/flash-sales/items/:itemId` |  |  | ✓ |  |
| `POST /admin/gomdon/alerts/:alertId/resolve` |  | ✓ |  |  |
| `GET /admin/merchant-fulfilment/overview` |  |  |  | ✓ |
| `GET /admin/merchant-fulfilment/payouts` |  |  |  | ✓ |
| `POST /admin/merchant-fulfilment/payouts` |  |  |  | ✓ |
| `POST /admin/merchant-fulfilment/payouts/:id/cancel` |  |  |  | ✓ |
| `POST /admin/merchant-fulfilment/payouts/:id/paid` |  |  |  | ✓ |
| `GET /admin/merchant-fulfilment/statements/:storefrontId` |  |  |  | ✓ |
| `GET /admin/notification-templates` |  |  | ✓ |  |
| `PATCH /admin/notification-templates/:code` |  |  | ✓ |  |
| `GET /admin/ops/access` | mọi NV | mọi NV | mọi NV | mọi NV |
| `GET /admin/ops/inbox` | ✓ | ✓ | ✓ | ✓ |
| `GET /admin/orders` | ✓ | ✓ |  |  |
| `POST /admin/orders/:id/gomdon/cancel-waybill` |  | ✓ |  |  |
| `POST /admin/orders/:id/gomdon/mark-handled` |  | ✓ |  |  |
| `POST /admin/orders/:id/gomdon/retry` |  | ✓ |  |  |
| `POST /admin/orders/:id/pancake-attention/resolve` |  | ✓ |  |  |
| `PUT /admin/orders/:id/status` | ✓ | ✓ |  |  |
| `GET /admin/orders/:id/status-history` | ✓ | ✓ |  |  |
| `GET /admin/orders/export` |  |  |  | ✓ |
| `POST /admin/pancake/orders/:id/push` |  | ✓ |  |  |
| `GET /admin/payouts` |  |  |  | ✓ |
| `POST /admin/payouts/:id/mark-paid` |  |  |  | ✓ |
| `GET /admin/payouts/pit-report` |  |  |  | ✓ |
| `GET /admin/products/search` |  |  | ✓ |  |
| `GET /admin/quick-replies` | ✓ |  |  |  |
| `POST /admin/quick-replies` | ✓ |  |  |  |
| `DELETE /admin/quick-replies/:id` | ✓ |  |  |  |
| `PATCH /admin/quick-replies/:id` | ✓ |  |  |  |
| `GET /admin/reports/exports/payouts` |  |  |  | ✓ |
| `GET /admin/reports/exports/refunds` |  |  |  | ✓ |
| `GET /admin/reports/exports/tax` |  |  |  | ✓ |
| `GET /admin/reports/order-items/export` |  |  |  | ✓ |
| `GET /admin/reports/revenue` |  |  |  | ✓ |
| `GET /admin/reports/sources` |  |  | ✓ |  |
| `GET /admin/return-requests` | ✓ | ✓ |  |  |
| `GET /admin/return-requests/:id/preview` | ✓ |  |  |  |
| `POST /admin/return-requests/:id/received` |  | ✓ |  |  |
| `POST /admin/return-requests/:id/review` | ✓ |  |  |  |
| `GET /admin/users` | ✓ |  |  |  |
| `GET /admin/users/:id/detail` | ✓ |  |  |  |
| `GET /admin/variations/lookup` |  |  | ✓ |  |
| `GET /affiliate/content-kit/:slug` | mọi NV | mọi NV | mọi NV | mọi NV |
| `POST /feed/admin/:id/approve` | ✓ |  | ✓ |  |
| `POST /feed/admin/:id/hide` | ✓ |  | ✓ |  |
| `POST /feed/admin/:id/pin` | ✓ |  | ✓ |  |
| `POST /feed/admin/:id/reject` | ✓ |  | ✓ |  |
| `GET /feed/admin/pending` | ✓ |  | ✓ |  |
| `GET /feed/admin/published` | ✓ |  | ✓ |  |
| `GET /feed/admin/reports` | ✓ |  | ✓ |  |
| `POST /feed/admin/reports/:id/resolve` | ✓ |  | ✓ |  |
| `GET /feed/admin/unanswered` | ✓ |  | ✓ |  |
| `POST /loyalty/staff/pos-credit` | mọi NV | mọi NV | mọi NV | mọi NV |
| `POST /loyalty/staff/scan-member` | mọi NV | mọi NV | mọi NV | mọi NV |
| `POST /refill/admin/:id/approve` | mọi NV | mọi NV | mọi NV | mọi NV |
| `POST /refill/admin/:id/reject` | mọi NV | mọi NV | mọi NV | mọi NV |
| `GET /refill/admin/pending` | mọi NV | mọi NV | mọi NV | mọi NV |
| `POST /staff/attendance/checkin` | mọi NV | mọi NV | mọi NV | mọi NV |
| `POST /staff/attendance/checkout` | mọi NV | mọi NV | mọi NV | mọi NV |
| `POST /staff/attendance/heartbeat` | mọi NV | mọi NV | mọi NV | mọi NV |
| `GET /staff/attendance/history` | mọi NV | mọi NV | mọi NV | mọi NV |
| `GET /staff/attendance/status` | mọi NV | mọi NV | mọi NV | mọi NV |
| `PUT /staff/bank` | mọi NV | mọi NV | mọi NV | mọi NV |
| `GET /staff/payroll` | mọi NV | mọi NV | mọi NV | mọi NV |
| `GET /staff/shift-templates` | mọi NV | mọi NV | mọi NV | mọi NV |
| `GET /staff/shifts` | mọi NV | mọi NV | mọi NV | mọi NV |
| `POST /staff/shifts` | mọi NV | mọi NV | mọi NV | mọi NV |
| `DELETE /staff/shifts/:id` | mọi NV | mọi NV | mọi NV | mọi NV |
| `PATCH /staff/shifts/:id` | mọi NV | mọi NV | mọi NV | mọi NV |
| `POST /staff/shifts/:id/cancel` | mọi NV | mọi NV | mọi NV | mọi NV |
| `POST /staff/shifts/copy-week` | mọi NV | mọi NV | mọi NV | mọi NV |

### 2b. Chỉ ADMIN (110), theo nhóm đường dẫn
- **/admin/account-deletion-requests**: `GET /admin/account-deletion-requests`, `POST /admin/account-deletion-requests/:id/process`
- **/admin/analytics**: `GET /admin/analytics/retention-daily`
- **/admin/attendance**: `GET /admin/attendance/live`, `POST /admin/attendance/manual-checkout`, `POST /admin/attendance/session`, `POST /admin/attendance/session/:id/edit`
- **/admin/brands**: `GET /admin/brands`, `POST /admin/brands`, `PATCH /admin/brands/:id`, `POST /admin/brands/:id/link-by-name`, `DELETE /admin/brands/:id/products`, `GET /admin/brands/:id/products`, `POST /admin/brands/:id/products`, `GET /admin/brands/:id/promotions`, `POST /admin/brands/:id/promotions`, `PATCH /admin/brands/:id/verify`
- **/admin/cashback**: `GET /admin/cashback/transactions`, `POST /admin/cashback/transactions/:id/review`
- **/admin/commission-rates**: `GET /admin/commission-rates`, `POST /admin/commission-rates/fill-missing`, `POST /admin/commission-rates/import/apply`, `POST /admin/commission-rates/import/preview`, `PUT /admin/commission-rates/products/:id`, `PUT /admin/commission-rates/variations/:id`
- **/admin/config**: `GET /admin/config`, `PUT /admin/config`
- **/admin/dashboard**: `GET /admin/dashboard/stats`
- **/admin/dealer-applications**: `GET /admin/dealer-applications`, `POST /admin/dealer-applications/:id/review`
- **/admin/dealer-orders**: `POST /admin/dealer-orders/:id/confirm-payment`
- **/admin/dealer-prices**: `GET /admin/dealer-prices/history`, `POST /admin/dealer-prices/import`, `POST /admin/dealer-prices/import/preview`
- **/admin/dealer-reward-claims**: `GET /admin/dealer-reward-claims`, `POST /admin/dealer-reward-claims/:id/approve`, `POST /admin/dealer-reward-claims/:id/mark-paid`, `POST /admin/dealer-reward-claims/:id/reject`, `POST /admin/dealer-reward-claims/:id/reopen`
- **/admin/dealer-rewards**: `GET /admin/dealer-rewards`, `POST /admin/dealer-rewards`, `DELETE /admin/dealer-rewards/:id`, `PATCH /admin/dealer-rewards/:id`
- **/admin/dealer-tiers**: `GET /admin/dealer-tiers`
- **/admin/dealers**: `GET /admin/dealers/:userId/credit-ledger`, `POST /admin/dealers/:userId/credit-payment`
- **/admin/engagement**: `GET /admin/engagement/missions`, `PATCH /admin/engagement/missions/:id`, `GET /admin/engagement/rewards`
- **/admin/gomdon**: `POST /admin/gomdon/check-connection`, `GET /admin/gomdon/status`
- **/admin/loyalty**: `GET /admin/loyalty/pos-credits`
- **/admin/merchant-fulfilment**: `POST /admin/merchant-fulfilment/links/:id/confirm-consignment`, `PATCH /admin/merchant-fulfilment/stores/:storefrontId/terms`
- **/admin/merchant-products**: `POST /admin/merchant-products/:id/review`, `POST /admin/merchant-products/:id/unlink`, `GET /admin/merchant-products/linked`, `GET /admin/merchant-products/pending`
- **/admin/ops**: `POST /admin/ops/alert-email/test`, `GET /admin/ops/health`, `POST /admin/ops/webhook-events/:source/:id/dismiss`, `POST /admin/ops/webhook-events/:source/:id/retry`
- **/admin/orders**: `POST /admin/orders/:id/confirm-payment`, `POST /admin/orders/:id/issue-invoice`, `GET /admin/orders/:id/referral`, `POST /admin/orders/:id/resync-delivered-effects`
- **/admin/pancake**: `POST /admin/pancake/sync`
- **/admin/payouts**: `POST /admin/payouts/:id/approve`, `POST /admin/payouts/:id/reject`
- **/admin/payroll**: `GET /admin/payroll`, `GET /admin/payroll/:staffId/detail`, `POST /admin/payroll/:staffId/finalize`, `POST /admin/payroll/:staffId/mark-paid`, `POST /admin/payroll/:staffId/recompute`, `POST /admin/payroll/:staffId/reopen`, `POST /admin/payroll/adjust`
- **/admin/products**: `POST /admin/products/recompute-sold`, `POST /admin/products/sold-external`
- **/admin/promotions**: `DELETE /admin/promotions/:id`, `PATCH /admin/promotions/:id`
- **/admin/refill-locations**: `GET /admin/refill-locations`, `POST /admin/refill-locations`, `PATCH /admin/refill-locations/:id`, `PUT /admin/refill-locations/order`
- **/admin/reviews**: `GET /admin/reviews`
- **/admin/shift-templates**: `GET /admin/shift-templates`, `POST /admin/shift-templates`, `DELETE /admin/shift-templates/:id`, `PATCH /admin/shift-templates/:id`
- **/admin/shifts**: `GET /admin/shifts`, `POST /admin/shifts/:id/approve`, `POST /admin/shifts/:id/reject`, `POST /admin/shifts/bulk-approve`
- **/admin/staff**: `GET /admin/staff`, `PUT /admin/staff/:userId/rate`, `POST /admin/staff/grant`, `POST /admin/staff/revoke`
- **/admin/storefronts**: `POST /admin/storefronts/:id/partner`
- **/admin/subscriptions**: `GET /admin/subscriptions`
- **/admin/users**: `POST /admin/users/:id/block`, `PUT /admin/users/:id/staff-permissions`, `POST /admin/users/:id/unblock`, `GET /admin/users/export`, `POST /admin/users/role`
- **/feed/admin**: `GET /feed/admin/events`, `GET /feed/admin/events/:id/participants`
- **/feed/events**: `POST /feed/events`, `POST /feed/events/:id/close`, `POST /feed/events/:id/winner`
- **/reviews/:id**: `POST /reviews/:id/visibility`

## 3. Kiểm chứng
Chạy bằng Node 22 (`$HOME/.local/node/node-v22.23.3-darwin-arm64/bin`), sau lượt sửa 2, trên tip của nhánh.
- DB riêng `tubutree_it` (container `lr-roles-pg`, cổng 5576), tạo mới: `prisma migrate deploy` báo "All migrations have been successfully applied."; `migrate diff --from-url … --to-schema-datamodel` báo "No difference detected."
- Race (Postgres thật, `tubutree_it` mới migrate): `q1-money-refunds`, `staff-coupons`, `reference-seed`, `p5-refunds-returns`, `r5-money`, `merchant-payout-cancel`, `coupon-preview-equals-quote`, `split-coupon-release`, `p6-promo-abuse`, `claim-first-order`, `admin-orders-r6`, `admin-user-detail`, `ops-health`, `feed-images`, `merchant-admin-todo`, `ctv-notifications`: `Test Suites: 16 passed, 16 total` · `Tests: 130 passed, 130 total`.
- API jest `src/common src/modules/{admin,coupons,orders,notifications,affiliate,merchant} prisma/reference-data src/modules/system-config`: `Test Suites: 128 passed, 128 total` · `Tests: 2739 passed, 2739 total`.
- Web vitest `src/app/admin src/components/admin src/lib`: `Test Files 98 passed (98)` · `Tests 1455 passed (1455)`.
- `npx tsc --noEmit` api và web: exit 0. `npx eslint` trên 38 file api và 4 file web đổi ở lượt 2: exit 0.
- Có đổi schema: một migration `20261018160000_coupon_actor` (2 cột nullable).

## 4. Chưa làm / cố ý để lại
- **D1-15 Lương:** chỉ có trên miniapp và chỉ ADMIN. Để nguyên, các route `admin/payroll*` vẫn chỉ ADMIN. Khi chuyển tab Lương sang web mới gắn KE_TOAN.
- **Inbox chưa có khoá "lệnh rút đã duyệt chờ chi"** cho kế toán. Khoá `payouts` hiện đếm lệnh REQUESTED, là việc của ADMIN. Kế toán vào thẳng tab Rút tiền, tab đã mặc định lọc APPROVED.
- Nhãn menu "Duyệt yêu cầu rút tiền" giữ nguyên, kể cả khi kế toán chỉ chi. Đổi nhãn thì phải sửa thêm `page.tsx`.
- `OrderStatusHistory.actorType` vẫn ghi `'ADMIN'` kèm `actorId` khi STAFF KE_TOAN thao tác hoàn tiền. CSKH/KHO hiện cũng ghi như vậy; `actorId` vẫn chỉ đúng người làm.
- **Không phát hiện lỗ hổng rõ ràng ở CSKH/KHO.** Ghi lại để hỏi (câu 7): mọi STAFF, kể cả nhóm mới, vẫn duyệt được đổi vỏ chai (cộng điểm) và tích điểm tại quầy. Đây là quyền "mọi nhân viên" có từ trước.
- **Gói song song, điều phối viên xử lý sau merge (không sửa file của họ):**
  - `lr/storefront` thêm `admin/storefronts` gồm `GET`, `GET :id`, `POST :id/take-down`, `POST :id/reinstate`, `POST :id/approval` (chỉ ADMIN) và tab `storefronts`. Sau merge, `staff-permissions.matrix.spec.ts` sẽ đỏ cho tới khi thêm 5 dòng vào `EXPECTED`. Mặc định để `ADMIN_ONLY`. Nếu chủ dự án muốn marketing duyệt gian hàng thì gắn `@AllowStaff('MARKETING')` và thêm `'storefronts'` vào `STAFF_TABS.MARKETING`.
  - `lr/orders`: hiện chỉ thêm tham số lọc cho `GET admin/orders`, không có route mới. Nếu thêm route "danh sách đại lý / công nợ" thì khai vào `EXPECTED`; đề xuất `ADMIN_ONLY`, hoặc `KE_TOAN` nếu chỉ đọc. Bộ lọc đơn mới chỉ hiện với ai có tab Đơn hàng (CSKH/KHO), không cần quyền mới.

## 5. Câu hỏi cho chủ dự án (kèm mặc định đã dùng)
1. **Kế toán bấm "Đã chi"** cho lệnh rút CTV (`payouts/:id/mark-paid`) và phiếu đối soát đối tác (`merchant-fulfilment/payouts/:id/paid`)? **Mặc định: CÓ.** Duyệt/từ chối rút tiền vẫn chỉ ADMIN, nên người duyệt khác người chi. Kế toán cũng lập và huỷ phiếu đối soát đối tác. Muốn tắt: bỏ `@AllowStaff('KE_TOAN')` ở các route đó và sửa bảng.
2. **Việc kế toán hằng ngày còn chỉ ADMIN:** "Đã nhận tiền" đơn chuyển khoản (`orders/:id/confirm-payment`, `dealer-orders/:id/confirm-payment`), xuất hoá đơn VAT (`orders/:id/issue-invoice`), ghi nhận công nợ đại lý (`dealers/:userId/credit-payment`), chi thưởng đại lý (`dealer-reward-claims/:id/mark-paid`), duyệt hoàn tiền sàn ngoài (`cashback`). Có mở cho KE_TOAN không? **Mặc định: chưa mở.** Prompt không liệt kê các việc này. Muốn mở thì còn phải cho kế toán vào tab Đơn hàng và tách nút theo nhóm trong `OrdersTab`.
3. **Kế toán có cần xem danh sách đơn** (`GET admin/orders`)? **Mặc định: không.** Kế toán đã có CSV đơn và dòng hàng ở tab Báo cáo.
4. **Academy cho marketing:** đã mở theo ma trận D1 mục 3 ("FAQ, Content Kit, Academy, mẫu thông báo"), dù prompt không ghi. Muốn bỏ thì gỡ `@AllowStaff` ở lớp `academy-admin.controller.ts` và bỏ `'academy'` khỏi `STAFF_TABS.MARKETING`.
5. **Marketing còn thiếu các quyền sau, đang chỉ ADMIN:** nhiệm vụ & quà đổi điểm (`admin/engagement`, file phiên đổi-rác đang sửa), sự kiện cộng đồng và chọn người thắng (có thưởng Điểm Xanh), nhãn hàng/khuyến mãi nhãn hàng, Retention & North-star, báo cáo doanh thu. Có mở không? **Mặc định: không.**
6. **Trần mã giảm giá do nhân viên tạo hoặc sửa: mặc định 50% / 200.000đ** (`coupon.staff_max_percent` = 50, `coupon.staff_max_amount_vnd` = 200000, sửa ở Cấu hình). Mã % phải có "Giảm tối đa" ≤ 200.000đ, mọi mã phải có tổng lượt dùng. Mức này đã hợp với khuyến mãi thật chưa? Cần mức cao hơn thì ADMIN tạo mã, vì ADMIN không bị trần. Cũng cần xác nhận: dòng hoàn tiền khách (END_CUSTOMER) chưa có tài khoản nhận giờ chỉ ADMIN xử lý được, có đúng ý không?
7. **Mọi nhân viên duyệt đổi vỏ chai và tích điểm tại quầy**, kể cả marketing và kế toán. Quyền này có từ trước. Có giới hạn theo nhóm không? **Mặc định: giữ nguyên.**
8. **Danh sách 24 mẫu thông báo marketing sửa được** (`MARKETING_TEMPLATE_CODES` trong `notification-templates-admin.service.ts`) đã đúng chưa? **Mặc định:** gồm voucher, flash sale, giỏ bỏ quên, giảm giá, nhắc mua lại, nhắc đánh giá, nhắc điểm, game, gian hàng nổi bật và cộng đồng. Không gồm `COMMUNITY_EVENT_WINNER` (có thưởng), mua chung và các mẫu tiền. Mẫu mới mặc định chỉ ADMIN sửa.
