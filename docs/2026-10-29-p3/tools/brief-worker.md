# Luật chung cho worker đợt sửa P3 (2026-10-29)

Đọc hết file này trước khi làm. Prompt riêng cho biết gói, worktree, cổng; file gói `docs/2026-10-29-p3/goi/<gói>.md` cho biết việc.

## Bối cảnh
- Repo Tubu Tree. Đọc `AGENTS.md` ở gốc worktree (luật hai nền tảng, `route-map.json`, `pnpm lint:parity`).
- Gói làm trong worktree `/Users/longla/coding/tubutree-mini-app/.claude/worktrees/p3-<gói>`, nhánh `review/p3-<gói>`, dựng từ nhánh `review/e2e-p3-2026-10-29` (main 815fa3c1e, đã gồm PR #70 đợt end-to-end và #69, cộng tài liệu đợt này). Gốc so sánh: `git merge-base HEAD review/e2e-p3-2026-10-29`. Chỉ sửa trong worktree của gói.
- Việc: mọi mục trong file gói. Đây là đợt P3 (đánh bóng): mỗi sửa phải nhỏ, theo phong cách mã xung quanh. Mục cần đổi lớn (khoảng hơn 150 dòng) hoặc đụng `schema.prisma` thì skipped, ghi lý do và cách làm đề xuất. Backlog đầy đủ `docs/2026-10-28-e2e/20-backlog.md`, báo cáo nhóm `docs/2026-10-28-e2e/1x-*.md` (bằng chứng, file:dòng; có thể lệch dòng, tin mã). Quyết định thay chủ: `docs/2026-10-28-e2e/21-quyet-dinh.md`.
- Ảnh TRƯỚC của đợt 28/10 (main 9d0e95bd5, trước nhiều sửa): `docs/2026-10-28-review/screens/`.

## Quyết định đã chốt (không làm ngược)
- Web khổ điện thoại phải giống Mini App cả giao diện; máy tính mở rộng hợp lý.
- Mini App: cộng đồng chỉ đọc; không link ra ngoài; không rút tiền về ngân hàng (hoa hồng vào Ví Tubu); thanh đáy Trang chủ, Danh mục, Vườn Xanh, Ưu đãi, Cá nhân.
- KHÔNG đổi giá, luật điểm, phí, thể lệ, chữ pháp lý, cờ PROD, và không thêm việc gửi tin cho khách thật ngoài những gì mục yêu cầu. Mục ghi phần "chờ chủ" thì chỉ làm phần được giao.
- Không thêm thư viện mới (UI hay không). Dùng zmp-ui (Mini App), Tailwind + `@tubutree/design-tokens` (web).
- Chữ giao diện tiếng Việt có dấu, ngắn, thân thiện. Lời lỗi nói rõ khách cần làm gì.
- Bundle: entry Mini App KHÔNG tăng (gốc 706 KB raw / 220 KB gz); tổng gz Mini App tăng ≤ 3 KB cho cả gói, chỉ ở chunk lazy; web First Load trang đổi tăng ≤ 2 KB hoặc ghi lý do.

## Môi trường (bắt buộc)
- Mọi lệnh shell: `export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH`. Shell là zsh: không để biến nhiều đường dẫn không ngoặc kép.
- Worktree đã `pnpm install` + `prisma generate`. Đổi `schema.prisma`: chỉ gói có `migration: true` mới được; tạo migration mới (tên thư mục thời gian `20261029HHMMSS_<tên>`, chỉ thêm, không xoá cột), chạy lại `npx prisma generate` trong `apps/api`.
- Typecheck API cần `pnpm --filter @tubutree/shared-types build` trước.
- Web Next dùng host `localhost`, không `127.0.0.1`.
- Cổng: chỉ dùng khối cổng prompt giao (B+1..B+5) và cổng Postgres race được giao. Trước khi dùng cổng: `lsof -iTCP:<p> -sTCP:LISTEN`. Bận thì đợi 60 giây, thử lại tối đa 10 lần, rồi ghi vào báo cáo.
- Playwright Mini App: `cd apps/e2e && E2E_SCOPE=miniapp E2E_MINIAPP_PORT=<B+3> npx playwright test [file]`. Web: `cd apps/e2e && GATE_PG_PORT=<B+4> GATE_REDIS_PORT=<B+5> E2E_API_PORT=<B+1> E2E_WEB_PORT=<B+2> E2E_MINIAPP_PORT=<B+3> bash scripts/web-gate.sh [file]`. Hoặc cả hai: `bash docs/2026-10-28-review/tools/pw-gate.sh <worktree> <B>`.
- Race test (bắt buộc khi đụng điểm, tiền, Ví, hoa hồng, đổi rác, kho, đơn): `bash docs/2026-10-20-uat/tools/race-one.sh <worktree> <cổng race> <spec...>` (dựng cụm Postgres riêng, DB `tubutree_it`, tự tắt). Chọn spec liên quan bằng tên trong `apps/api/test/integration-race/`.
- Bộ kiểm tĩnh một lệnh: `bash docs/2026-10-28-review/tools/gate.sh <worktree> --base <gốc so sánh> --out <worktree>/../gate-p3-<gói>.txt`.
- CẤM: `pkill -f`; kill tiến trình không do mình tạo; `npx playwright test` trần (không E2E_SCOPE, không web-gate); Docker không `--rm --tmpfs`; push, merge, deploy, ghi PROD; `git stash` trần; `--no-verify`; sửa file ngoài worktree của gói; đụng lane UAT (cổng 32xx), DB `tubutree_uat_*`, Redis 26379.
- Ca chập chờn có sẵn trên main (không phải lỗi của gói, không sửa, chỉ ghi lại): `apps/e2e/tests/support-chat.web.spec.ts` (khoảng dòng 30) và `apps/e2e/tests/buy-flow-4b-browse.miniapp.spec.ts` (khoảng dòng 141): phiên khác đang sửa ở nhánh riêng, KHÔNG đụng hai file này; khoảng 10 ca chập chờn nhóm `/san-pham` (B-130). Ca đỏ khác: chạy lại riêng; còn đỏ thì là lỗi của gói.
- Máy dùng chung với nhiều worker và phiên khác. Timeout hàng loạt: `sysctl -n vm.loadavg` trước khi nghi mã; chạy lại riêng ca đó.

## Cách làm
1. Đọc file gói, báo cáo nhóm liên quan và mã thật. Làm theo thứ tự P0, P1, P2, P3.
2. Logic kiểm thử được thì viết test trước (jest/vitest cạnh file, race spec cho tiền/điểm), thấy đỏ rồi mới sửa.
3. Mini App và web sửa trong cùng nhánh. Logic chung đặt ở `packages/app-core`. Đổi route thì cập nhật `route-map.json`.
4. Sửa ít nhất có thể, theo phong cách mã xung quanh. Comment chỉ giải thích "vì sao" không hiển nhiên; không viết comment kể lại thay đổi hay nhắc mã mục (E-x, R-x).
5. Commit nhỏ theo ý, tiêu đề tiếng Việt kiểu `fix(gio-hang): ...`, thân nói vì sao. Cuối mỗi commit: dòng trống rồi `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Không commit ảnh, log, file sinh lại của công cụ đo. Không push.
6. Mục không làm được hoặc sai: không đoán; ghi lý do trong báo cáo.

## Kiểm trước khi báo xong (chạy thật, chép số thật)
- `gate.sh` của gói: 0 FAIL (tsc mọi app, eslint, vitest app-core/miniapp/miniapp-UTC/web, jest API, lint:parity, vite build, bundle).
- Playwright: Mini App toàn bộ; web gate cho spec của màn đã đổi (cả bộ nếu đổi khung chung, điều hướng, thanh đáy, thanh toán).
- Race spec liên quan nếu đụng tiền/điểm/đơn/kho.
- Test mới cho từng mục logic: tên test + chứng minh đỏ trước khi sửa (ghi lệnh).

## Báo cáo trả về (theo schema; tóm tắt ≤ 30 dòng)
- Nhánh, commit (hash + tiêu đề).
- Mỗi mục: done / partial / skipped + lý do một dòng.
- Lệnh kiểm và số thật (suite/test pass/fail). Bundle trước/sau.
- Điều chưa kiểm, chỗ chọn khác brief.
