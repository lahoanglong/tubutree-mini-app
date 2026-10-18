# Tiến độ — đưa chức năng Mini App lên web

Phiên chạy: `tubutree-mini-app-8c` (Opus 5.5). Nền: `web/base` db9adca0. Nhánh tích hợp: `web/integration` (worktree `.claude/worktrees/web-parity`).

| Thời điểm | Bước | Trạng thái | Ghi chú |
|---|---|---|---|
| 2026-10-18 21:45 | 0. Nền | xong | `web/base` = `review/2026-10-18-launch` d2dcbe0b + `feat/recycle-rewards` ef5ad5ed, gộp không xung đột. `main` 1bc39757 không đổi |
| 2026-10-18 21:50 | 1. Khảo sát | xong phần quét | 5 báo cáo scout ở `khao-sat/`. Viết `00-ma-tran.md` (51 dòng: có 2, thiếu 12, mới 36, skip 1), `01-thiet-ke.md`, `02-ke-hoach.md` (đợt 0 core; đợt 1 shop/order/account/loyalty; đợt 2 community/affiliate/game/pro; đợt 3 recycle) |
| 2026-10-18 22:20 | 1. Review tài liệu | đang chạy | reviewer Opus đọc 00–02 |

## Nhánh nguồn cần theo dõi

- `review/2026-10-18-launch` đã gộp tới d2dcbe0b (`lr2/polish` 2cea7a1b chưa vào launch lúc tạo nền).
- `feat/recycle-rewards` đã gộp tới ef5ad5ed (`feat/recycle-L8` b2d54e77 chưa vào lúc tạo nền).

## Mốc test trên web/base (trước khi sửa)

- Typecheck web đỏ 65 lỗi khi `@tubutree/shared-types` chưa build (gói xuất `dist`); không phải lỗi code. Đo lại sau khi build gói.
