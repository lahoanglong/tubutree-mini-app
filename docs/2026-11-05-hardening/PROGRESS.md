# Tiến độ đợt hoàn thiện 05/11 (hard/1105)

Kế hoạch: `PLAN.md`. Phát hiện và quyết định của chủ: `audit-1105-findings.md`. Luật chung cho mọi gói: `hard-1105-rules.md`. Brief từng gói: `brief-<gói>.md`.

## Nhánh
- Tích hợp: `hard/1105`, worktree `.claude/worktrees/hard-1105`. Dựng từ tip `sec/1104-audit` (3b021b59b, PR #167). Gộp main sau khi #167 merge.
- Gói đợt 1 (gốc d79ceeb85): `hard/1105-ha`, `hard/1105-hb`, `hard/1105-hc`.

## Đợt 1
- hc (cashback): merge 43c464971. Opus APPROVE. Migration 20261105120000_cashback_admin_review_guard. Nit còn: cảnh báo ADMIN_OVERRIDE có thể mất trong cửa sổ vài ms.
- ha (quyền nhân sự, L1-05, L1-06): merge bbec41f47. Opus 3 vòng, vòng 3 APPROVE 0/0/0. Migration 20261105100000, 100100 (sửa tại chỗ: thu hồi lời mời ADMIN cho số chưa có tài khoản), 100200 admin_export_logs, 100300 commission_rate_history. NIT còn:
  - revokeGrant khoá gian hàng cả khi người bị thu hồi không mất gian hàng; có thể chờ createPayout, quá lock_timeout thì 503.
  - updateMany khoá grant theo index (phone, role), applyGrants theo id; hai grant mở cùng SĐT + refresh song song có thể 40P01. Gần như không xảy ra.
- hb (phiên, L1-04): merge 102a33dcb (giải 9 xung đột với ha). Opus 3 vòng + duyệt c6ab6b94a (mọi tx cắt phiên khoá dòng users rồi mới lấy mốc; ca latch 2 kiểm khe). Migration 20261105110000_refresh_token_parent. NIT còn: phiên vừa đăng nhập đúng lúc logout-all chưa commit có thể nhận 401 một lần.
- Review chéo cả nhánh (Opus): APPROVE 0/0/2/2. Hai MINOR sửa ở f111b2208 (Opus APPROVE):
  - SESSIONS_REVOKED lấy riêng 20 dòng, không đẩy lịch sử khoá/vai trò khỏi drawer.
  - Huỷ hoa hồng ghi kind `COMMISSION_FORFEIT`, drawer hiện "Huỷ hoa hồng chờ rút".
- Kiểm (worker, trước f111b2208): tsc api/web/miniapp 0; vitest web 10117/10117; DB sạch migrate deploy 0, drift 0; race 357 suite / 2796 test. jest api sau f111b2208: 13813/13813.

## Cần chủ biết trước deploy (đọc PROD cần chủ cho phép)
- `SELECT count(*) FROM refresh_tokens`: migration 20261105110000 dựng index trên refresh_tokens không CONCURRENTLY, chặn đăng nhập/refresh trong lúc dựng.
- `SELECT count(*) FROM role_grants g WHERE "revokedAt" IS NULL AND role='ADMIN' AND NOT EXISTS (SELECT 1 FROM users u WHERE u.phone=g.phone)`: migration 20261105100100 thu hồi một chiều các lời mời này. Rollback image không khôi phục. Người bị thu hồi đăng nhập một lần rồi chủ mời lại.
- hc: các dòng cashback Kế toán đã từ chối tay trên PROD trước bản này không được bảo vệ. Cần đọc PROD để kiểm trước deploy hc.
- Mini App bản cũ không gửi lý do khi cấp/thu quyền: sổ ghi "(không có lý do — Mini App bản cũ)". Gói he thêm ô lý do; DTO đổi về bắt buộc sau khi Mini App mới lên PROD.

## Đợt 2, đợt 3 (chưa giao)
- Đợt 2 dựng từ tip `hard/1105` sau khi đợt 1 gộp: hd1 (index và truy vấn, PG 46534), hd2 (hàng đợi, export, DATABASE_URL, PG 46535), hd3 (ảnh, payroll, PG 46536).
- Đợt 3: he (Mini App, PG 46537; sửa app-core phải hỏi điều phối), hf (admin web, PG 46538).
