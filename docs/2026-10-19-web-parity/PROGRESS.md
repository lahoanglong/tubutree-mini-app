# Tiến độ — đưa chức năng Mini App lên web

Phiên chạy: `tubutree-mini-app-8c` (Opus 5.5). Nền: `web/base` db9adca0. Nhánh tích hợp: `web/integration` (worktree `.claude/worktrees/web-parity`).

| Thời điểm | Bước | Trạng thái | Ghi chú |
|---|---|---|---|
| 2026-10-18 21:45 | 0. Nền | xong | `web/base` = `review/2026-10-18-launch` d2dcbe0b + `feat/recycle-rewards` ef5ad5ed, gộp không xung đột. `main` 1bc39757 không đổi |
| 2026-10-18 21:50 | 1. Khảo sát | xong phần quét | 5 báo cáo scout ở `khao-sat/`. Viết `00-ma-tran.md` (51 dòng: có 2, thiếu 12, mới 36, skip 1), `01-thiet-ke.md`, `02-ke-hoach.md` (đợt 0 core; đợt 1 shop/order/account/loyalty; đợt 2 community/affiliate/game/pro; đợt 3 recycle) |
| 2026-10-18 22:20 | 1. Review tài liệu | xong | Opus: 0 BLOCKER, 9 MAJOR, 7 MINOR; đã sửa 00–02 (mục 7 của 01). Thêm đợt 0b (core-api, core-shell, core-ui) |
| 2026-10-18 22:45 | 2. Đợt 0a `core` | đang chạy | worktree `.claude/worktrees/web-core`, nhánh `web/core` từ 879dd371. Workflow run `wf_3e2cabec-848` |

## Nhánh nguồn cần theo dõi

- `review/2026-10-18-launch` đã gộp tới d2dcbe0b (`lr2/polish` 2cea7a1b chưa vào launch lúc tạo nền).
- `feat/recycle-rewards` đã gộp tới ef5ad5ed (`feat/recycle-L8` b2d54e77 chưa vào lúc tạo nền).
- 23:10: gộp `feat/recycle-rewards` mới (đã chứa launch f58650f0) vào `web/integration` → 3d50df11; gộp trực tiếp launch thì xung đột `public-config.ts` (phiên đổi rác đã giải ở ef4f11b1), nên chỉ gộp nhánh đổi rác. tsc web/miniapp/api: 0 lỗi.

## Mốc test trên web/base (trước khi sửa)

- Typecheck web đỏ 65 lỗi khi `@tubutree/shared-types` chưa build (gói xuất `dist`); không phải lỗi code.
- Sau `pnpm --filter @tubutree/shared-types build`: `tsc --noEmit` web, miniapp, api đều 0 lỗi.
- Vitest web: `Test Files 190 passed (190)`, `Tests 3003 passed (3003)`.
- Vitest miniapp: `Test Files 281 passed (281)`, `Tests 4243 passed (4243)`. **Số test miniapp không được giảm dưới 4243.**

## Cách chạy lane (để làm tiếp nếu bị ngắt)

- Script workflow lane dùng chung: `/Users/longla/.claude/projects/-Users-longla-coding-tubutree-mini-app/9e3e1e72-df67-4778-878f-c97b54c7b02f/workflows/scripts/web-lane-wf_3e2cabec-848.js` (args: lane, wt, branch, base, effort, reviewRounds, maxRounds, reviewFocus, gate, tasks).
- Args từng lane ở `lanes/<lane>.json` (thêm `base` = tip `web/integration` lúc tạo nhánh lane).
- Chạy lại một lane dở: `Workflow({scriptPath, args, resumeFromRunId})`.

## Lịch chạy (đổi lúc 2026-10-18 23:00)

Cuốn chiếu thay vì chờ hết đợt: luôn giữ tối đa 4 lane chạy (Q8); lane nào gộp xong thì lane kế tiếp theo thứ tự Q7 vào ngay. Hàng đợi sau đợt 0b: shop, order, account, loyalty, community, affiliate, game, pro, recycle. Lý do: kịp xong trước sáng 2026-10-19 theo yêu cầu chủ dự án.
