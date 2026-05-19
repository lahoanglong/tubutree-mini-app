# Sub-project A — User Roles & Capabilities

**Date:** 2026-05-19
**Status:** Approved, in implementation
**Part of roadmap:** A → B → C → D → E → F (Roles → Points → Affiliate → Wholesale → Wallet → Voucher)

## Goal
Foundation layer cho mọi feature multi-role: cộng tác viên (CTV) chia sẻ link kiếm hoa hồng, đại lý nhập sỉ. Mọi sub-project sau (B/C/D/E) đều dựa trên capability flag từ A.

## Decisions
| # | Quyết định |
|---|------------|
| 1 | Role model: 1 base `CUSTOMER` + 2 capabilities song song (`affiliate_enabled`, `agent_enabled`). User có thể bật cả hai. |
| 2 | Approval flow: admin duyệt thủ công cả CTV và Đại lý (status PENDING/APPROVED/REJECTED/SUSPENDED). |
| 3 | KYC AFFILIATE: bank info + số CCCD + ảnh CCCD mặt trước. |
| 4 | KYC AGENT: CCCD 2 mặt + selfie + warehouse_address + expected_monthly_revenue + bank info. Optional (không bắt buộc): company_name, tax_code, business_license_url, representative_name — UI ghi rõ "không bắt buộc". |
| 5 | Storage: local filesystem `/uploads/kyc/{user_id}/...`. Docker named volume `uploads_data` để bền. Max 5MB/ảnh, mime whitelist jpg/png. UUID filename. |
| 6 | Admin auth: env whitelist `ADMIN_ZALO_UIDS`. Sync `User.is_admin` mỗi lần login. |
| 7 | Schema: 2 application table riêng (`AffiliateApplication`, `AgentApplication`) — typed KYC, audit history, cho phép re-apply sau reject. |
| 8 | Ban toàn diện user: `User.is_banned` + cascade SUSPEND 2 capabilities. Unban không tự khôi phục capability. Admin không thể ban chính mình. |
| 9 | `AdminAuditLog`: ghi mọi action admin (approve/reject/suspend/restore/ban/unban). |

## Defaults cho phần chưa hỏi chi tiết
- **State machine:** PENDING → APPROVED/REJECTED. APPROVED → SUSPENDED → APPROVED (restore). REJECTED → user có thể sửa & nộp lại (tạo record mới, record cũ giữ history). Chỉ 1 application `is_active=true` mỗi loại mỗi user.
- **User tự rút khỏi CTV/Đại lý:** chưa làm trong A — defer sang phase sau (nếu cần). Hiện tại chỉ admin có thể SUSPEND.
- **Rate limit:** 1 user chỉ được nộp đơn 1 lần / 24h cho mỗi capability (chống spam).
- **Validate:** CCCD 12 số, SĐT chuẩn VN, tài khoản NH số (regex), email RFC.
- **Soft-delete:** không cần — giữ history qua `is_active` flag.

## Data Model
Xem `prisma/schema.prisma` — thêm 3 bảng: `AffiliateApplication`, `AgentApplication`, `AdminAuditLog`. Bảng `User` thêm 6 cột: `affiliate_enabled`, `agent_enabled`, `is_admin`, `is_banned`, `banned_at`, `banned_by_uid`, `ban_reason`.

## Endpoints (22)

### User-facing (10)
- `POST /api/affiliate/applications` — multipart submit
- `GET /api/affiliate/applications/me`
- `PUT /api/affiliate/applications/me` — sửa khi PENDING / nộp lại sau REJECTED
- `POST /api/agent/applications`
- `GET /api/agent/applications/me`
- `PUT /api/agent/applications/me`
- `GET /api/me/capabilities`
- `PUT /api/me/affiliate/bank` — update bank info khi đã APPROVED
- `GET /api/uploads/kyc/:userId/:filename` — owner hoặc admin mới đọc được

### Admin (11)
- AFFILIATE: list, detail, approve, reject, suspend, restore (6)
- AGENT: list, detail, approve, reject, suspend, restore (6)
- Users: list, detail, ban, unban (4)

(Một số endpoint dùng chung pattern; tổng unique routes ~21-22.)

## Middlewares
- `auth` (đã có) — verify JWT, load user, **mở rộng:** sync `is_admin` từ env, check `is_banned` → 403 nếu banned.
- `requireAdmin` — sau `auth`, check `user.is_admin`.
- `requireCapability("affiliate" | "agent")` — sau `auth`, check `user.affiliate_enabled` / `agent_enabled`. (Dùng cho sub-project B/C/D sau.)
- `uploadKYC` — multer single/multi file, max 5MB, mime whitelist, lưu vào `/uploads/kyc/{user_id}/`.

## Frontend pages
- `pages/become-affiliate.tsx` — form đăng ký CTV (bank + CCCD ảnh + email)
- `pages/become-agent.tsx` — form đăng ký Đại lý (KYC đầy đủ + optional company)
- `pages/my-capabilities.tsx` — xem trạng thái CTV/Đại lý + history
- `pages/admin/applications.tsx` — admin tab, tabs: Pending Affiliate / Pending Agent / All. Approve/Reject inline.
- `pages/admin/users.tsx` — admin search user, ban/unban.
- `components/admin-link.tsx` — show "Admin" tab nếu `is_admin = true`.

## Error handling
- Submit application khi đã có app `is_active` cùng loại → 409 `ALREADY_APPLIED`.
- Submit lần 2 trong 24h → 429 `TOO_FREQUENT`.
- File quá lớn → 413. Mime sai → 400.
- Admin endpoint khi không phải admin → 403 `NOT_ADMIN`.
- Action vào application không tồn tại → 404.
- Ban chính mình → 400 `CANNOT_BAN_SELF`.

## Test plan (manual smoke)
1. User mới login → `/api/me/capabilities` trả `{affiliate_enabled:false, agent_enabled:false, is_admin:false}`.
2. Nộp đơn CTV (multipart với 1 file CCCD) → status PENDING.
3. Set Zalo UID của mình vào `ADMIN_ZALO_UIDS` → login lại → `is_admin=true`.
4. Vào tab Admin → thấy đơn PENDING → Approve.
5. User refetch `/api/me/capabilities` → `affiliate_enabled:true`.
6. Admin ban user → user gọi bất kỳ endpoint nào → 403 ACCOUNT_BANNED.
7. Admin unban → user gọi `/api/me/capabilities` → `affiliate_enabled:false` (vẫn cần restore).
8. Admin restore application → user lại `affiliate_enabled:true`.

## Out of scope (sang sub-project khác)
- Tính/trả hoa hồng → sub-project C
- Giá sỉ theo cấp đại lý → sub-project D
- Loyalty points → sub-project B
- Ví / rút tiền → sub-project E
- Admin web panel riêng (Next.js) — vẫn dùng admin tab trong Mini App
