# Luật chung cho worker GĐ3 (review 2026-10-28)

Đọc hết file này trước khi làm. Prompt riêng nói gói, worktree, lane, cổng; file này nói luật chung.

## Bối cảnh
- Repo Tubu Tree. Đọc `AGENTS.md` ở gốc worktree của gói (luật hai nền tảng, `route-map.json`, `pnpm lint:parity`).
- Mỗi gói một worktree `.claude/worktrees/r1028-<gói>` và nhánh `review/1028-<gói>`, dựng từ nhánh `review/2026-10-28` (main 9d0e95bd5 + một commit tài liệu và công cụ đo). Chỉ sửa trong worktree của gói.
- Việc cần làm: các mục R-x của gói trong `docs/2026-10-28-review/20-backlog.md` (bảng mục và mục `## Gói`). Bằng chứng và file:dòng ở báo cáo nhóm `docs/2026-10-28-review/10-review-<nhóm>.md` (nguồn ghi ở cột Nguồn, ví dụ KP-03). Báo cáo có thể lệch dòng; tin mã.
- Ảnh TRƯỚC (main, lane 5) ở `/Users/longla/coding/tubutree-mini-app/.claude/worktrees/review-1028/docs/2026-10-28-review/screens/` (gọi là `BEFORE`). Số đo TRƯỚC: `.../review-1028/docs/2026-10-28-review/perf/baseline.json`.
- Phạm vi file của gói ghi ở mục `## Gói`. Không sửa file của gói khác. File chung (`apps/miniapp/src/i18n/vi.ts`): chỉ thêm hoặc sửa khoá của màn mình, không sắp xếp lại.

## Quyết định đã chốt (không làm ngược)
- Web khổ điện thoại phải giống Mini App cả giao diện; máy tính mở rộng hợp lý.
- Mini App: cộng đồng chỉ đọc; không link ra ngoài; không rút tiền về ngân hàng (hoa hồng vào Ví Tubu); thanh đáy Trang chủ, Danh mục, Vườn Xanh, Ưu đãi, Cá nhân.
- KHÔNG đổi luật điểm, giá, phí, thể lệ, nội dung pháp lý. Mục ghi "CẦN CHỦ QUYẾT" chỉ làm phần prompt cho phép; phần còn lại bỏ, ghi vào báo cáo.
- Không thêm thư viện UI mới. Dùng zmp-ui (Mini App), Tailwind + `@tubutree/design-tokens` (web), token trong `packages/design-tokens`.
- Chữ giao diện tiếng Việt có dấu, ngắn, thân thiện. Lời lỗi nói rõ khách cần làm gì.

## Môi trường (bắt buộc)
- Mọi lệnh shell: `export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH`.
- Worktree đã `pnpm install` và `prisma generate` sẵn. Đổi `schema.prisma` thì phải có migration mới và chạy lại `npx prisma generate` trong `apps/api` (gói nào cần migration phải dừng hỏi trước, trừ khi prompt cho phép).
- Typecheck API cần build `@tubutree/shared-types` trước (`pnpm --filter @tubutree/shared-types build`).
- Web Next dùng host `localhost`, không dùng `127.0.0.1`.
- Chỉ dùng cổng và lane được giao. Lane: `docs/2026-10-20-uat/tools/uat-harness/` (README) và `docs/2026-10-28-review/tools/LANES.md` (Postgres 25432, Redis 26379 container `tubu-uat-redis` dùng chung; DB lane copy từ mẫu `tubutree_uat_tpl` rồi `npx prisma migrate deploy`; nạp dữ liệu `node docs/2026-10-28-review/tools/seed-data.mjs --lane N all`). `CREATE DATABASE ... TEMPLATE` bị từ chối khi phiên khác đang copy mẫu: đợi 20 giây rồi thử lại, tối đa 10 lần. Lane bật từ CHÍNH worktree của gói (chạy `lane-up.sh` trong worktree đó) để chạy mã của gói.
- CẤM: `pkill -f`; kill tiến trình không do mình tạo (chỉ `lsof -ti tcp:<cổng của mình> -sTCP:LISTEN | xargs kill`); `npx playwright test` trần; Docker không `--rm --tmpfs`; push, merge, deploy, ghi PROD; `git stash` trần; `--no-verify`; sửa file ngoài worktree của gói (trừ ảnh vào thư mục được giao); đụng lane 5, 6 và lane của gói khác.
- Playwright Mini App: `cd apps/e2e && E2E_SCOPE=miniapp E2E_MINIAPP_PORT=<cổng> npx playwright test <file>`. Web: `apps/e2e/scripts/web-gate.sh <file>` với `GATE_PG_PORT`, `GATE_REDIS_PORT`, `E2E_API_PORT`, `E2E_WEB_PORT`, `E2E_MINIAPP_PORT` trong dải cổng của gói.
- Race test (đụng điểm, tiền, ví, hoa hồng, đổi rác): Postgres nhúng theo công thức trong `/Users/longla/.claude/projects/-Users-longla-coding-tubutree-mini-app/memory/env-lessons-tubutree.md` (mục "Postgres chạy thẳng trên máy", hoặc `docs/2026-10-20-uat/tools/pg-native.sh start <cổng>` rồi `createdb`), cổng trong dải của gói, DB `tubutree_it`, `DATABASE_URL` dùng `127.0.0.1` và `?schema=public`. Dừng cụm khi xong.
- Máy dùng chung với 4–7 worker khác. Test chậm hoặc timeout hàng loạt: `top -l 1 -n 0` trước khi nghi mã; chạy lại riêng ca đó.

## Cách làm
1. Đọc mục R-x của gói, báo cáo nhóm và mã thật. Làm theo thứ tự P0, P1, P2; P3 chỉ khi rẻ và nằm trong file của gói.
2. Logic có kiểm thử được thì viết test trước (vitest/jest cạnh file), thấy đỏ rồi mới sửa.
3. Mini App và web sửa trong cùng nhánh. Logic chung đặt ở `packages/app-core`. Đổi route thì cập nhật `route-map.json`.
4. Sửa ít nhất có thể, theo phong cách mã xung quanh. Comment chỉ giải thích "vì sao" không hiển nhiên; không viết comment kể lại thay đổi.
5. Commit nhỏ theo ý, tiêu đề tiếng Việt kiểu `fix(trang-chu): ...`, cuối mỗi commit có dòng `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Không commit ảnh, không commit `docs/2026-10-28-review/tools/routes.json` hay `params-l*.json` sinh lại cho lane của gói (khôi phục bằng `git checkout -- <file>` trước khi commit). Không push.

## Kiểm trước khi báo xong (chạy thật, chép số thật vào báo cáo)
- `tsc --noEmit` cho mọi app/gói đã sửa (`apps/api`: `pnpm typecheck`; web, miniapp, app-core, e2e).
- eslint cho file đã sửa (theo cấu hình từng app).
- jest API toàn bộ (`npx jest` trong `apps/api`) nếu đụng API; race test liên quan nếu đụng điểm/tiền.
- vitest TOÀN BỘ `packages/app-core`, `apps/miniapp` (thêm một lần `TZ=UTC`), `apps/web`.
- Playwright: Mini App toàn bộ (`E2E_SCOPE=miniapp`), web gate cho spec của màn đã đổi (cả bộ nếu đổi khung chung).
- `pnpm lint:parity` ở gốc.
- `vite build` Mini App, rồi `node docs/2026-10-28-review/tools/perf/bundle-report.mjs` (đọc đầu file để biết tham số): entry và tổng Mini App không được tăng so với baseline (entry 711 KB raw); web First Load các trang đã đổi không tăng quá 2 KB. Ghi số trước/sau.
- Ảnh: bật lane của gói, nạp dữ liệu, `node docs/2026-10-28-review/tools/build-routes.mjs --lane N`, chụp màn đã đổi bằng `capture.mjs --lane N --phase mini375,web375 --keys <khoá> --force` (thêm trạng thái nếu gói đổi trạng thái tải/lỗi), rồi `node docs/2026-10-28-review/tools/before-after.mjs --before <BEFORE> --after docs/2026-10-28-review/screens --out <thư mục ảnh của gói> --keys <khoá>`. Thư mục ảnh của gói: `/Users/longla/coding/tubutree-mini-app/.claude/worktrees/review-1028/docs/2026-10-28-review/screens-<gói>/`. Tự mở xem TỪNG ảnh trước/sau bằng Read; ảnh sau phải cho thấy đúng sửa đổi và web 375 giống Mini App.
- Gói đụng hiệu năng: đo trước/sau bằng `docs/2026-10-28-review/tools/perf/run-all.mjs` (đọc đầu file) với `--label <gói>`, ghi `perf/after-<gói>.json` trong thư mục ảnh của gói.
- Dừng lane và mọi tiến trình của mình khi xong (`lane-down.sh N`; không `--drop` để còn chụp lại khi sửa lượt sau).

## Báo cáo trả về (tối đa 40 dòng)
- Nhánh, danh sách commit (hash + tiêu đề).
- Mỗi mục R-x: đã làm / không làm, lý do một dòng.
- Lệnh kiểm và số thật (suite/test pass/fail) cho từng mục kiểm ở trên.
- Bundle trước/sau; số đo hiệu năng trước/sau nếu có.
- Đường dẫn ảnh trước/sau.
- Điều chưa kiểm, điều cần chủ quyết, chỗ chọn khác brief.
