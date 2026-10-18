# Tiến độ — đưa chức năng Mini App lên web

Phiên chạy: `tubutree-mini-app-8c` (Opus 5.5). Nền: `web/base` db9adca0. Nhánh tích hợp: `web/integration` (worktree `.claude/worktrees/web-parity`).

| Thời điểm | Bước | Trạng thái | Ghi chú |
|---|---|---|---|
| 2026-10-18 21:45 | 0. Nền | xong | `web/base` = `review/2026-10-18-launch` d2dcbe0b + `feat/recycle-rewards` ef5ad5ed, gộp không xung đột. `main` 1bc39757 không đổi |
| 2026-10-18 21:50 | 1. Khảo sát | xong phần quét | 5 báo cáo scout ở `khao-sat/`. Viết `00-ma-tran.md` (51 dòng: có 2, thiếu 12, mới 36, skip 1), `01-thiet-ke.md`, `02-ke-hoach.md` (đợt 0 core; đợt 1 shop/order/account/loyalty; đợt 2 community/affiliate/game/pro; đợt 3 recycle) |
| 2026-10-18 22:20 | 1. Review tài liệu | xong | Opus: 0 BLOCKER, 9 MAJOR, 7 MINOR; đã sửa 00–02 (mục 7 của 01). Thêm đợt 0b (core-api, core-shell, core-ui) |
| 2026-10-18 22:45 | 2. Đợt 0a `core` | xong, đã gộp | run `wf_3e2cabec-848`; gate xanh (app-core 48, web 3044, miniapp 4259); review 2 lượt: 1 MAJOR + 3 MINOR đã sửa, 1 MINOR mở (next build chưa nạp app-core trong mã thật). Gộp → `web/integration` 1e1d9859. Báo cáo `impl/core.md` |
| 2026-10-19 00:10 | 3a. `core-ui` | xong, đã gộp | gate xanh (web 3141, miniapp 4272); review 2 lượt: lượt 1 4 MAJOR + 4 MINOR, lượt 2 1 MAJOR + 2 MINOR, đều đã sửa; phiên chính đọc lại commit sửa MAJOR lượt 2 (06a70334, Sheet nhường bàn phím cho modal chồng): đúng. `web-gate.sh` chưa chạy lại e2e sau sửa (lần trước 20 passed). Gộp → d6e43f4f. 5 câu hỏi nhỏ về bridge ở `impl/core-ui.md` |
| 2026-10-18 23:15 | 3. Đợt 0b | xong (3a–3c) | `core-api` wf_af7597be-50c, `core-shell` wf_4ce37db6-335, `core-ui` wf_769c22c1-53a; nhánh từ 1e1d9859; workflow v2 `tools/web-lane.workflow.js`. Gate integration sau core (phiên chính tự chạy): XANH — app-core 48, web 3044 (cả TZ=UTC), miniapp 4259, typecheck/lint/lint:vars/build sạch |
| 2026-10-19 00:20 | 3b. `core-api` | xong, đã gộp | gate xanh (app-core 419, web 3044, miniapp 4259); review 2 lượt: 1 MAJOR (`ordersListQuery` bỏ `pageParam`) + 6 MINOR, đều đã sửa. Gộp → d65ea51d. Báo cáo `impl/core-api.md` (3 câu hỏi: hàm hiển thị thuần, chuyển service Mini App sang `coreHttp`, encode path param) |
| 2026-10-19 00:20 | 3c. `core-shell` | xong, đã gộp | gate gần xanh (app-core 63, web 3117, lint:parity 41 pending); miniapp-test 1 ca chập chờn `edit-profile.spec.tsx`, phiên chính chạy lại riêng: 15/15 xanh, lane không đụng file Mini App. Review 2 lượt: 5 MINOR đều sửa. Gộp → bf270b19 (xung đột `ds-v2-guest.spec.ts`: giữ cả primitive core-ui và file vỏ trong khối CORE). Báo cáo `impl/core-shell.md` (5 câu hỏi) |
| 2026-10-19 00:30 | Gộp đổi rác | xong | `feat/recycle-rewards` 07ac5aa1 (29 commit mới, gồm gỡ Refill) → ca595fc7; xung đột `apps/e2e/playwright.config.ts` giữa core-ui và recycle: giữ `WEB_COMMAND`/`MINIAPP_COMMAND`, `E2E_SCOPE=web-admin` của recycle cùng `E2E_SCOPE=web`. Sau đó 42113ba3: gỡ `api/refill`, `queries/refill` khỏi app-core (endpoint đã bị xoá), `/refill` sang khối skip của route map, lane loyalty bỏ `/doi-vo`, lane pro không làm lại tab Refill. app-core 429 test, lint:parity xanh (40 pending) |
| 2026-10-19 00:35 | 4. Đợt 1 | đang chạy | nhánh từ 42113ba3: `shop` wf_93c3d736-ef2, `order` wf_0a762ea4-6bf, `account` wf_5dcff4d1-cce, `loyalty` wf_4f3b33ae-93f. Gate integration sau đợt 0b (c9f889c1, `gate-logs/integration/after-wave0b`): XANH — app-core 429, web 3181 (cả TZ=UTC), miniapp 4214, typecheck/lint/lint:vars/lint:parity (40 pending)/build sạch |

## Nhánh nguồn cần theo dõi

- `review/2026-10-18-launch` đã gộp tới d2dcbe0b (`lr2/polish` 2cea7a1b chưa vào launch lúc tạo nền).
- `feat/recycle-rewards` đã gộp tới ef5ad5ed (`feat/recycle-L8` b2d54e77 chưa vào lúc tạo nền).
- 00:30: launch có 23 commit chưa vào nhánh đổi rác (tip 5913fd80); thử gộp (merge-tree) thì xung đột 4 file (`check-partial-indexes.ts`, `partial-unique-indexes.race-spec.ts`, `playwright.config.ts`, `app/thanh-toan/page.tsx`) giữa launch và đổi rác: để phiên đổi rác giải, chỉ gộp lại khi `feat/recycle-rewards` đã chứa launch.
- 23:10: gộp `feat/recycle-rewards` mới (đã chứa launch f58650f0) vào `web/integration` → 3d50df11; gộp trực tiếp launch thì xung đột `public-config.ts` (phiên đổi rác đã giải ở ef4f11b1), nên chỉ gộp nhánh đổi rác. tsc web/miniapp/api: 0 lỗi.

## Mốc test trên web/base (trước khi sửa)

- Typecheck web đỏ 65 lỗi khi `@tubutree/shared-types` chưa build (gói xuất `dist`); không phải lỗi code.
- Sau `pnpm --filter @tubutree/shared-types build`: `tsc --noEmit` web, miniapp, api đều 0 lỗi.
- Vitest web: `Test Files 190 passed (190)`, `Tests 3003 passed (3003)`.
- Vitest miniapp: `Test Files 281 passed (281)`, `Tests 4243 passed (4243)`. **Số test miniapp không được giảm dưới 4243.**
- 2026-10-19 00:55: sàn đổi thành **4214** từ 42113ba3. Nhánh đổi rác gỡ Refill (0b258d34, cc2d66f7) xoá `refill.spec.tsx` (44 ca), `refill-api.spec.ts` (2), bớt 11 ca trong `admin.spec.tsx`; lane web không có commit nào đụng Mini App. Lane mở từ giờ truyền `miniappFloor: 4214` vào workflow.

## Cách chạy lane (để làm tiếp nếu bị ngắt)

- Script workflow v2: `tools/web-lane.workflow.js` (bản chạy thật ở scratchpad phiên `bin/web-lane.workflow.js`, giống hệt). Args: `{lane, wt, branch, base, effort, reviewRounds, maxRounds, taskTitles, miniappFloor}` (`miniappFloor` mặc định 4243; lane mở sau 00:55 truyền 4214); prompt từng việc và `reviewFocus` đọc từ `lanes/<lane>.json`.
- Gate: `bash tools/lane-gate.sh <worktree> <outdir>`, log ở `.claude/worktrees/gate-logs/<lane>/runN`.
- Tạo lane: `git worktree add -b web/<lane> .claude/worktrees/web-<lane> web/integration`, `pnpm install --prefer-offline`, `pnpm --filter @tubutree/shared-types build`.
- Chạy lại một lane dở: `Workflow({scriptPath, args, resumeFromRunId})`.

## Lịch chạy (đổi lúc 2026-10-18 23:00)

Cuốn chiếu thay vì chờ hết đợt: luôn giữ tối đa 4 lane chạy (Q8); lane nào gộp xong thì lane kế tiếp theo thứ tự Q7 vào ngay. Hàng đợi sau đợt 0b: shop, order, account, loyalty, community, affiliate, game, pro, recycle. Lý do: kịp xong trước sáng 2026-10-19 theo yêu cầu chủ dự án.

## Việc chưa xong ở lane account

- Thông báo REORDER_REMINDER: Mini App mở ReorderSheet (tra purchased-items theo variation_id, chọn mặt hàng bằng pickReminderItem); web hiện chỉ có link tới trang sản phẩm vì ReorderSheet của lane order chưa gộp vào web/integration. Chưa ngang Mini App. Làm tiếp sau khi lane order gộp: nhánh 'reorder' trong `thong-bao/page.tsx` gọi purchased-items, mở sheet, có ref chặn bấm đúp, chỉ rơi về link khi không tìm thấy.
- Lỗi chung với Mini App (ngoài phạm vi lane): `edit-profile.tsx` của Mini App gửi `dob` ở mọi lần lưu; API chỉ cho đặt ngày sinh một lần nên khách đã có ngày sinh sẽ bị 400 và không lưu được tên/email. Web đã sửa (không gửi lại dob đã đặt); Mini App cần chủ duyệt sửa.
