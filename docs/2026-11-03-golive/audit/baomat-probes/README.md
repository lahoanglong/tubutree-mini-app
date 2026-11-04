# Probe baomat (gl-1103)

Chạy từ thư mục này, Node 22 (`export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH`), API lane 6 (`API=http://localhost:3261/api`, mặc định trong `lib.mjs`).
CẢNH BÁO: `dos1.mjs`, `dos2.mjs`, `dos3.mjs` làm API đứng vài giây (đã cắt cỡ so với bản đã dùng khi đo); đừng nâng cỡ: 1 MB làm lane 6 đứng ~10 phút (xem BAOMAT-01).
- `lib.mjs`: `req`, `guest` (tạo khách bằng `/auth/guest`, mỗi IP tối đa 30 khách mới/phút).
- `dump-routes.cjs` (cần `NODE_PATH=apps/api/node_modules`, đặt `WORKTREE=<đường dẫn worktree>`) + `sweep2.mjs <token>`: quét 612 route với và không có token.
- `idor1-3.mjs`: IDOR đơn/địa chỉ/giỏ/đổi trả/hoàn tiền giữa hai khách tự tạo.
- `nul.mjs`: ký tự NUL gây 500. `feed1-3.mjs`: ảnh base64 từ khách. `hdr.mjs`: header/cache. `thr1.mjs`: giới hạn tốc độ. `auth1.mjs`: xoay refresh token, JWT giả.
