# Gói ha — vai trò, CTV bị thu hồi, nhân sự

- Worktree: `/Users/longla/coding/tubutree-mini-app/.claude/worktrees/hard-1105-ha`
- Nhánh: `hard/1105-ha`, gốc `d79ceeb85`
- Cổng PG: **46531**

Trước khi làm, đọc `hard-1105-rules.md` (cùng thư mục với brief này) và làm theo.

## Mục

### 1. Task A1, A2, A3
Làm theo đúng plan, mục `### Task A1` → `### Task A3` trong `plan-hardening-1105.md`.

A3: chủ đã chọn **(a) "Nút admin huỷ"**. Làm theo phần "Nếu chủ chọn (a)" của Task A3:
- `POST /admin/users/:id/forfeit-commissions`, chỉ ADMIN.
- Lý do bắt buộc, `MaxLength 500`.
- Trong tx: khoá dòng users trước, rồi khoá commissions.
- Người không có dấu `affiliateRevokedAt` → trả 409.
- Ghi sự kiện `WALLET_FORFEIT`.
- Kết quả trả về: `{ cancelled, amount }`.
- Race: chạy đồng thời với `requestPayout` và cron chuyển Ví → đúng một bên thắng, tổng tiền khớp.

### 2. L1-02
`revokeGrantsAbove` chạy trong cùng tx với `user.update`, đặt sau `lockAdminRoster`, và ném lỗi thay vì nuốt.

`applyGrants` (trong `issueTokens`):
- khoá dòng users (`FOR NO KEY UPDATE`);
- đọc lại grant rồi mới nâng quyền.

Race: `setUserRole(ADMIN→CUSTOMER)` chạy song song với 20 lần refresh của chính người đó. Kỳ vọng: cuối cùng role = CUSTOMER và không còn grant ADMIN active.

### 3. L1-05
Chủ chọn: "Hết hạn 7 ngày + cấm mời ADMIN số lạ".
- `RoleGrant` thêm `expiresAt`. Lời mời chưa áp được (SĐT chưa có user) có hạn 7 ngày; `applyGrants` lọc `expiresAt > now` hoặc `expiresAt IS NULL` (grant đã áp).
- Thêm key cấu hình `staff.grant_invite_ttl_days`, mặc định 7, nếu dự án có mẫu `system_configs` cho loại này. Không có mẫu thì dùng hằng.
- Mời ADMIN cho SĐT chưa có tài khoản → 400, câu: "Chỉ cấp quyền quản trị cho số điện thoại đã có tài khoản. Nhờ người đó đăng nhập Tubu Tree một lần trước."
- Tab Nhân sự (admin web) hiện các lời mời đang chờ: SĐT, vai trò, hạn, nút "Thu hồi".
- Grant cũ đang chờ trên PROD: migration đặt `expiresAt = now() + 7 ngày` cho grant chưa áp. Ghi lý do trong comment migration.

### 4. L1-06
Chủ chọn: "CSKH phải tìm mới thấy".

`GET /admin/users` khi người gọi là STAFF:
- bắt buộc có `search`, là một trong: SĐT đủ 10 số, id đúng, hoặc tên từ 3 ký tự;
- `page ≤ 5`, `limit ≤ 20`;
- vi phạm → 400, câu rõ ràng.

ADMIN không đổi. Thêm `@Throttle` riêng 30/phút cho route này.

UI admin: khi người xem là CSKH, ô tìm bắt buộc và có gợi ý.

### 5. L1-07
Bảng `admin_export_logs`: `actorId`, `route`, `filters` (Json), `rowCount`, `createdAt`.
- Ghi cho mọi route `*/export*` và các route `/admin/reports/exports/*`.
- Cách làm: interceptor, hoặc gắn trong `streamCsv`. Đếm số dòng thật đã ghi.
- Màn chi tiết nhân sự hiện 20 lần xuất gần nhất của người đó.

### 6. L1-08
- `reason` bắt buộc (`MinLength 3`, `MaxLength 500`) cho: `SetUserRoleDto`, `StaffPermissionsDto`, unblock, `GrantRoleDto`, `RevokeRoleDto`. Truyền vào `recordUserAdminEvent`.
- Bảng `commission_rate_history`: `variationId`, `fromPct`, `toPct`, `actorId`, `createdAt`. Ghi trong cùng tx với lần đổi %, gồm cả import.
- UI admin: các hộp thoại tương ứng hỏi lý do.

## File không đụng
- `apps/api/src/modules/auth/strategies/*`
- `session-state.service.ts`

Hai file này thuộc gói hb.

`admin.service.ts` và `apps/web/src/app/admin/page.tsx` được sửa, nhưng chỉ trong các hàm hoặc phần của các mục trên.
