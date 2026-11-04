# Tiến độ đợt hoàn thiện 05/11 (hard/1105)

Kế hoạch: `PLAN.md`. Phát hiện và quyết định của chủ: `audit-1105-findings.md`. Luật chung cho mọi gói: `hard-1105-rules.md`. Brief từng gói: `brief-<gói>.md`.

## Nhánh
- Đợt 1 (xong): tích hợp `hard/1105`, dựng từ tip `sec/1104-audit` (3b021b59b, PR #167). Gói (gốc d79ceeb85): `hard/1105-ha`, `hard/1105-hb`, `hard/1105-hc`. Đã merge qua PR #168. Worktree và nhánh local đã dọn 05/11.
- Đợt 2: tích hợp `hard/1105-w2`, worktree `.claude/worktrees/hard-1105-w2`, gốc main 2da8b1337 (đã trên PROD). Gói: `hard/1105-hd1`, `hard/1105-hd2`, `hard/1105-hd3`.

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
- Gộp main c88ef883e (#167) ở 9472dad9a, sửa câu đếm runbook ở 4c6d615f4 và chữ 503 webhook cashback ("vui lòng") ở e6f778382. Mở PR #168.
- ce334ff55: 9 spec dựng server thử bằng `listen(0, '127.0.0.1')` (body-limits đỏ 404 khi chạy cùng Playwright, 4f báo).
- Gộp main 649753301 (#169 web/1105-int) ở 422b7a3e4. Xung đột:
  - `rbac.service.ts`: giữ `applyGrants(user)` + `applyGrantsWith` của main (markStale sau commit), thêm `reason` của ha.
  - `admin.service.ts`: `setUserRole` giữ `revokeGrantsAbove` trong tx (ha) và thêm `invalidateRegistry()` sau commit (main).
  - Opus APPROVE. Sửa thêm các điểm Opus nêu:
    - e395b9161: `applyGrants` chỉ markStale khi chính lượt này ghi vai trò.
    - f370ae891: `addGrant` lấy `applied` theo `changed`.
    - Opus APPROVE. Mỗi test mới đỏ trên bản cũ.
- Kiểm cục bộ ở 422b7a3e4:
  - gate 0 FAIL.
  - jest 577 suite / 13863 test; race 357 / 2796; migrate 0, drift 0.
  - vitest: app-core 2688, miniapp 6710 (cả UTC), web 10193.
  - Playwright: mini 475 passed; web 739 passed, 0 failed.
- Kiểm sau f370ae891: jest staff, admin, auth 1368 test; race quyền 38 suite / 403 test. CI 8/8 xanh.
- **PR #168 ĐÃ MERGE** (main 2da8b1337) và **ĐÃ DEPLOY** Vietnix 05/11 01:29–01:35 (phiên hard, chủ cho phép):
  - dep1: 0 FAIL. dep2: 6 migration (282 → 288), API ngừng 23 giây; seed thêm `staff.grant_invite_ttl_days` = 7.
  - dep3: 48 PASS / 18 WARN / 0 FAIL, smoke xanh. Route mới đã map. Có index `refresh_tokens_parentId_idx`. Log 15 phút không có lỗi.
  - Backup `/var/backups/tubutree/tubutree_20261105_013414.sql.gz`. Rollback = image `:prev-64975330`, không cần down migration.
  - `.golive-*` của lượt này ở `/root/golive-archive/2da8b133/`.

## Đã kiểm trên PROD trước deploy đợt 1 (chỉ đọc, chủ cho phép, 05/11 ~00:00)
- `refresh_tokens`: 119 dòng, 144 kB. Index của 20261105110000 dựng xong tức thì.
- Lời mời ADMIN đang mở cho số chưa có tài khoản: 0, nên 20261105100100 không thu hồi lời mời nào.
- `cashback_transactions`: 0 dòng, không có dòng Kế toán từ chối tay nào cần bảo vệ.
- Còn lại: Mini App bản cũ không gửi lý do khi cấp/thu quyền, nên sổ ghi "(không có lý do — Mini App bản cũ)". Gói he thêm ô lý do; DTO đổi về bắt buộc sau khi Mini App mới lên PROD.

## Đợt 2 (đang làm, gốc 2da8b1337)
- hd1 (index và truy vấn, PG 46534), hd2 (hàng đợi, timeout, breaker, PG 46535), hd3 (payload ảnh, cột nặng, PG 46536). Brief: `brief-hd1.md`, `brief-hd2.md`, `brief-hd3.md`.
- Giới hạn RAM (máy dùng chung với phiên web): jest `--maxWorkers=2`, vitest tối đa 2 luồng, Playwright `--workers=2`.
- Không chạm VPS tới khi phiên web báo #170 "dep3 xong".

## Đợt 3 (chưa giao)
- he (Mini App, PG 46537; sửa app-core phải hỏi điều phối), hf (admin web, PG 46538).
