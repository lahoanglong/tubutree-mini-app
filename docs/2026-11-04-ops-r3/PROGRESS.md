# Đợt 3 rà Ops/Admin (04/11): Admin, CTV, Tài chính/Đối soát, Kho/hết hạn, bảo mật API

Phiên `db`. Worktree `.claude/worktrees/ops-1104-r3`, nhánh `ops/1104-r3` từ `origin/main` `0a72aa870` (= bản PROD 2a deploy đêm 04/11).
Không đụng lane 1/3/4/5/6 của 2a (cổng 32N1–32N8, DB `tubutree_uat_lN`). Phiên db dùng Postgres nhúng 462xx (race: 46271), API 40xx.
Quy tắc: đường tiền/điểm cần 2 lượt reviewer Opus APPROVE; gate.sh + race + Playwright xanh; mở PR, CI xanh thì báo 2a gộp + deploy. Không tự deploy, không ghi PROD.

| Giờ | Việc | Trạng thái |
|---|---|---|
| 04:3x | Workflow rà `wf_0f625201-fb3`: 6 chiều (rbac, errux, race, money, tz, kho) × reviewer Opus, 3 verifier đối kháng (mỗi verifier 2 chiều). Postgres race 46271 đã migrate 267 | đang chạy |
| 04:5x | Rà xong: 22 phát hiện, verifier xác nhận cả 22 (`10-audit-r3.json`). P1: TZ-01 gói định kỳ trễ 1 ngày (vùng 2a, đã hỏi), ERR-01 trừ công nợ đại lý hai lần khi bấm lại sau lỗi mạng. P2: RC-01, RC-02, RB-02, TK-01, TK-02, TK-03, ERR-02, TZ-02 (màn khách, chuyển 2a). Chiều làm tròn tiền/điểm: không thấy lỗi | xong |
| 04:5x | Chia gói: A1 công nợ + mã GD (ERR-01, RB-01, RB-03), A2 hoàn tiền/đối soát (RC-01, RC-02 phần 409, RB-02, RB-05, RC-04), B nhân sự (RC-03, RC-05, RC-06), C tồn kho (TK-01, TK-02, TK-03), D lỗi tiếng Việt (ERR-02, ERR-03), E nhắc/xuất (TK-04, TK-05, TK-06, + TZ-01 nếu 2a đồng ý). Chờ chủ: RC-02 bước nhận việc, RB-04 danh sách host hoá đơn | đang làm |
| 05:0x | 2a chốt: TZ-01 phiên db làm (2 lượt Opus, thêm ca chữ "Lần kế" Mini/web), TZ-02 2a nhận. Push `ops/1104-r3`. Workflow sửa `wf_5425ed87-026`: 6 worker Sonnet, worktree `ops-1104-{a1,a2,b,c,d,e}`, Postgres 46272–46276 | đang chạy |
