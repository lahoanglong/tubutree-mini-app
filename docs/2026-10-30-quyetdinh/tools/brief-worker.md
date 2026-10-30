# Luật chung cho worker đợt quyết định 30/10

Đọc hết file này trước khi làm. Prompt riêng cho biết gói, worktree, cổng. File gói `docs/2026-10-30-quyetdinh/goi/<gói>.md` cho biết việc.

## Bối cảnh
- Repo Tubu Tree. Đọc `AGENTS.md` ở gốc worktree (luật hai nền tảng, `route-map.json`, `pnpm lint:parity`).
- Mỗi gói làm trong worktree `/Users/longla/coding/tubutree-mini-app/.claude/worktrees/qd-<gói>`, nhánh `review/qd-<gói>`, dựng từ main d915f19b5. Gốc so sánh là `d915f19b5`. Chỉ sửa trong worktree của gói.
- Main d915f19b5 gồm PR #75, đã deploy PROD. PR #76–#78 và #83 đã merge nhưng chưa deploy.
- Việc của gói: làm các quyết định chủ đã chốt trưa 30/10. Nguyên văn ở `docs/2026-10-28-e2e/21-quyet-dinh.md` mục E; file gói chép lại và nói rõ phạm vi.
- Bối cảnh từng mục: backlog `docs/2026-10-28-e2e/20-backlog.md`, báo cáo nhóm `docs/2026-10-28-e2e/1x-*.md`. Dòng có thể lệch; khi lệch, tin mã.
- Mục này được đổi hành vi, đổi luật điểm hoặc thêm tin gửi khách, nhưng chỉ đúng như chủ đã chốt. Không làm quá phạm vi, không đổi thứ khác.

## Quyết định đã chốt từ trước (không làm ngược)
- Web khổ điện thoại phải giống Mini App cả giao diện; máy tính mở rộng hợp lý.
- Mini App:
  - cộng đồng chỉ đọc;
  - không link ra ngoài;
  - không rút tiền về ngân hàng (hoa hồng vào Ví Tubu);
  - thanh đáy gồm Trang chủ, Danh mục, Vườn Xanh, Ưu đãi, Cá nhân.
- KHÔNG đổi giá, phí, chữ pháp lý, cờ tính năng trên PROD. Luật điểm, thể lệ và tin gửi khách chỉ đổi đúng phần mục của gói yêu cầu.
- Không thêm thư viện mới. Mini App dùng zmp-ui; web dùng Tailwind + `@tubutree/design-tokens`.
- Chữ giao diện và chữ tin: tiếng Việt có dấu, ngắn, thân thiện, nói rõ khách cần làm gì. Câu tin gửi khách nào đã được chủ chốt thì dùng nguyên văn.
- Bundle:
  - Entry Mini App gốc là 709 KB raw / 222 KB gz. Không được tăng quá 0,3 KB gz. Ghi số đo thật trước và sau vào báo cáo.
  - Tổng gz Mini App được tăng tối đa 3 KB cho cả gói, và chỉ ở chunk lazy.
  - Web First Load của trang bị đổi được tăng tối đa 2 KB. Vượt thì ghi lý do.

## Tương thích và dữ liệu
- Bản Mini App Live trên Zalo có thể cũ hơn main (≥ V21). API mới phải để bản cũ chạy như trước:
  - chỉ thêm trường, không đổi nghĩa hay bỏ trường cũ;
  - trường mới trong DTO là tuỳ chọn.
- Migration chỉ dành cho gói có `migration: true`. Tên thư mục theo giờ được giao.
  - Chỉ thêm. Không xoá cột hay bảng, trừ khi file gói nói rõ.
  - Phải chạy được trên DB đã có dữ liệu.
  - Cập nhật mẫu tin hay cấu hình có sẵn thì chỉ ghi khi giá trị trên DB còn đúng bằng giá trị mặc định cũ, để không đè chỗ admin đã sửa. Theo mẫu migration `20261029040001_commission_reversed_template_neutral`.
  - Sau khi đổi schema, chạy lại `npx prisma generate` trong `apps/api`.
- Khoá cấu hình mới: theo cách các khoá hiện có đã làm.
  - Khai báo ở `apps/api/prisma/reference-data/config-selection.ts`.
  - Thêm validator ở `system-config.service.ts`.
  - Đưa vào `public-config.ts` nếu client cần đọc.
  - Test `reference-seed.race-spec.ts` cũng phải cập nhật.
  - Giá trị mặc định không được đổi hành vi PROD ngoài điều chủ chốt.
- Mẫu tin mới: theo mẫu đã có (mã tin trong `notification-variables.ts` / `*.codes.ts`, mẫu trong seed + migration chèn mẫu, route trong `packages/app-core/src/notification-route.ts`).
  - Chỉ gửi trong app, trừ khi file gói nói gửi ZNS.
  - Gửi đúng một lần cho mỗi sự kiện. Phải idempotent khi cron chạy lại hay hai tiến trình chạy cùng lúc.

## File của phiên khác (KHÔNG sửa)
Phiên b4 có PR #80, #81, #82 đang mở và đang sửa các file dưới đây. Mục nào buộc phải sửa một trong các file này thì để `skipped`, ghi lý do và cách làm đề xuất.
- apps/api/src/modules/loyalty/loyalty.service.ts (và spec)
- apps/api/src/modules/notifications/notifications.service.ts (và spec zns-queue)
- apps/api/src/modules/affiliate/affiliate.service.ts (và affiliate-auto-wallet.spec.ts)
- apps/miniapp/src/pages/affiliate.tsx, apps/web/src/app/ctv/page.tsx
- apps/miniapp/src/pages/home.tsx, apps/miniapp/src/components/home/member-card.tsx, apps/miniapp/src/hooks/use-home-customer-kind*
- apps/miniapp/src/utils/checkout-rules.ts, apps/miniapp/src/utils/points-lots.ts, apps/web/src/lib/checkout-points.ts, packages/app-core/src/points-lots.ts
- apps/web/src/app/admin/page.tsx, apps/web/src/components/admin/vn-date-input.tsx, apps/web/src/components/skeletons/route-skeleton.tsx
- apps/api/test/integration-race/tier-drop-notice-queue.race-spec.ts, zns-delivery.race-spec.ts; apps/e2e/tests/web-checkout.web.spec.ts

## Môi trường (bắt buộc)
- Đầu mọi lệnh shell: `export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH`. Shell là zsh: biến chứa nhiều đường dẫn phải để trong ngoặc kép.
- Worktree đã chạy `pnpm install` và `prisma generate`. Trước khi typecheck API, chạy `pnpm --filter @tubutree/shared-types build`.
- Web Next dùng host `localhost`, không dùng `127.0.0.1`.
- Cổng:
  - Chỉ dùng khối cổng prompt giao (B+1..B+5) và cổng Postgres race được giao.
  - Trước khi dùng một cổng, chạy `lsof -iTCP:<p> -sTCP:LISTEN`.
  - Cổng bận thì đợi 60 giây rồi thử lại, tối đa 10 lần. Vẫn bận thì ghi vào báo cáo.
- Playwright:
  - Mini App: `cd apps/e2e && E2E_SCOPE=miniapp E2E_MINIAPP_PORT=<B+3> npx playwright test [file]`.
  - Web: `cd apps/e2e && GATE_PG_PORT=<B+4> GATE_REDIS_PORT=<B+5> E2E_API_PORT=<B+1> E2E_WEB_PORT=<B+2> E2E_MINIAPP_PORT=<B+3> bash scripts/web-gate.sh [file]`.
  - Cả hai: `bash docs/2026-10-28-review/tools/pw-gate.sh <worktree> <B>`.
- Race test: bắt buộc khi đụng điểm, tiền, Ví, hoa hồng, đổi rác, kho, đơn, cron gửi tin.
  - Lệnh: `bash docs/2026-10-20-uat/tools/race-one.sh <worktree> <cổng race> <spec> <spec>...`. Mỗi spec là một tham số riêng.
  - Script dựng cụm Postgres riêng (DB `tubutree_it`) và tự tắt.
  - Spec đặt trong `apps/api/test/integration-race/`. Sửa luật thì viết spec mới hoặc sửa spec cũ.
- Bộ kiểm tĩnh một lệnh: `bash docs/2026-10-28-review/tools/gate.sh <worktree> --base d915f19b5 --out <worktree>/../gate-qd-<gói>.txt`.
- CẤM:
  - `pkill -f`, hay kill tiến trình không do mình tạo;
  - chạy `npx playwright test` trần (thiếu E2E_SCOPE hoặc không qua web-gate);
  - chạy Docker mà không có `--rm --tmpfs`;
  - push, merge, deploy, ghi vào PROD;
  - `git stash` trần, `--no-verify`;
  - sửa file ngoài worktree của gói;
  - đụng lane UAT (cổng 32xx), DB `tubutree_uat_*`, Postgres 25432, Redis 26379.
- Ca chập chờn có sẵn trên main. Không phải lỗi của gói: chạy lại riêng ca đó và ghi vào báo cáo.
  - Web: `payroll-admin-tab.spec.tsx` (lần mở đầu khung nạp lười).
  - Nhóm `/san-pham`, game quiz, recycle, wishlist: rớt khi load cao.
  - Ca đỏ khác: chạy lại riêng. Vẫn đỏ thì là lỗi của gói.
- Máy dùng chung với nhiều worker và phiên khác. Thấy timeout hàng loạt thì xem `sysctl -n vm.loadavg` trước khi nghi mã.

## Cách làm
1. Đọc file gói, các báo cáo liên quan và mã thật. Viết ra luật mới ở dạng ca cụ thể (đầu vào → kết quả) trước khi sửa.
2. Viết test trước: jest/vitest cạnh file; race spec cho tiền, điểm, cron. Thấy test đỏ rồi mới sửa.
3. Sửa Mini App và web trong cùng nhánh. Logic chung đặt ở `packages/app-core`. Đổi route thì cập nhật `route-map.json`.
4. Sửa theo phong cách mã xung quanh. Comment chỉ giải thích "vì sao" khi không hiển nhiên. Không viết comment kể lại thay đổi, không nhắc mã mục (E-x, R-x).
5. Commit:
   - Commit nhỏ, mỗi commit một ý. Tiêu đề tiếng Việt kiểu `feat(doi-rac): ...` hoặc `fix(...): ...`. Thân commit nói vì sao.
   - Cuối thân: một dòng trống, rồi `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
   - Không commit ảnh, log, hay file sinh lại của công cụ đo. Không push.
6. Mục không làm được hoặc mơ hồ: không đoán. Chọn cách an toàn nhất (không mất điểm/tiền của khách, không gửi tin thừa) và ghi rõ lựa chọn vào báo cáo.

## Kiểm trước khi báo xong (chạy thật, chép số thật)
- `gate.sh` của gói: 0 FAIL.
- Playwright: Mini App chạy toàn bộ. Web chạy spec của các màn đã đổi; đổi khung chung, điều hướng hay thanh toán thì chạy cả bộ.
- Race spec liên quan: chạy cả spec mới và spec cũ của vùng đã đụng.
- Mỗi mục logic có test mới. Ghi tên test và lệnh chứng minh test đỏ trước khi sửa.

## Báo cáo trả về (theo schema; tóm tắt tối đa 30 dòng)
- Nhánh, commit (hash và tiêu đề).
- Mỗi mục: done / partial / skipped, kèm lý do một dòng.
- Lệnh kiểm và số thật (suite/test pass/fail). Bundle trước và sau.
- Migration, khoá cấu hình, mẫu tin mới: tên và giá trị mặc định. Ghi thêm việc chủ phải làm sau deploy, ví dụ đặt cấu hình hay duyệt mẫu ZNS.
- Điều chưa kiểm, và chỗ đã chọn khác brief.
