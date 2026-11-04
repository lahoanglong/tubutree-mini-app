# Brief chung cho worker đợt Security + Performance 2026-11-04

Đọc file này trước. Danh sách phát hiện đầy đủ: `docs/2026-11-04-sec-perf/PROGRESS.md` trong worktree `.claude/worktrees/sec-1104`.

## Môi trường
- Mọi lệnh shell: `export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH`.
- Worktree của bạn mới tạo, chưa có node_modules: chạy `pnpm install --frozen-lockfile --prefer-offline` ở gốc worktree, rồi `cd apps/api && npx prisma generate`.
- Đổi `schema.prisma` thì chạy lại `npx prisma generate` trong `apps/api` (không chạy ở gốc repo).
- Postgres thật cho race spec: `bash docs/2026-10-20-uat/tools/pg-native.sh start <cổng>` rồi `bash docs/2026-10-20-uat/tools/pg-native.sh createdb <cổng> tubutree_it`, rồi `cd apps/api && DATABASE_URL="postgresql://tubu@127.0.0.1:<cổng>/tubutree_it?schema=public" npx prisma migrate deploy`. URL phải có `?schema=public` vì vài spec nối thêm `&connection_limit=`.
- Chạy race: `cd apps/api && DATABASE_URL="postgresql://tubu@127.0.0.1:<cổng>/tubutree_it?schema=public" npx jest -c test/integration-race/jest.config.js --runInBand <mẫu>`.
- Xong việc: `bash docs/2026-10-20-uat/tools/pg-native.sh stop <cổng>` (chỉ cổng của bạn).
- Jest unit api: `cd apps/api && npx jest <đường dẫn>`. Vitest: `cd apps/miniapp && npx vitest run <đường dẫn>` (chạy thêm `TZ=UTC` nếu test có ngày giờ). Web: `cd apps/web && npx vitest run <đường dẫn>`.
- Máy dùng chung, đang tải cao: đừng chạy cả bộ jest/vitest/race; chỉ chạy file liên quan. Không `pkill`; chỉ kill PID mình tạo.

## Luật
- KHÔNG push, KHÔNG mở PR, KHÔNG đụng PROD, KHÔNG deploy, KHÔNG sửa ngoài phạm vi file của gói.
- Không sửa `packages/app-core`, `packages/shared-types`, `apps/e2e/playwright.config.*`, `apps/web/next.config.*`, `apps/web/src/middleware.ts`, và trang web public ngoài `apps/web/src/app/admin/**`, `apps/web/src/components/admin/**`, trừ khi gói ghi rõ được phép. Cần thì dừng và ghi vào báo cáo.
- Không `git stash` trần, không `--no-verify`, không amend, không force.
- TDD: viết test trước, chạy cho thấy ĐỎ trên code cũ, rồi sửa cho XANH. Ghi lại lệnh và kết quả đỏ/xanh trong báo cáo.
- Comment chỉ giải thích "vì sao" không hiển nhiên. Không viết comment kể chuyện thay đổi ("đã sửa", "thêm cho SEC-xx", "trước đây…"). Mã phát hiện (SEC-V1…) để ở commit message, không để trong code.
- Lỗi trả cho người dùng bằng tiếng Việt, cùng giọng với chỗ tương tự trong code.
- Migration mới: thư mục `apps/api/prisma/migrations/20261104HHMMSS_<tên>` với giờ sau 20261104120000. Index trên bảng có thể lớn: `CREATE INDEX IF NOT EXISTS` (Prisma chạy migration trong transaction nên không dùng được CONCURRENTLY). Thêm `@@index` vào `schema.prisma` nếu Prisma biểu diễn được; index partial/BRIN thì ghi comment trong schema như các index partial đã có.
- Đổi hành vi có thể ảnh hưởng khách thật mà chưa chắc: làm theo đề xuất an toàn nhất, ghi rõ ở báo cáo mục "cần chủ quyết".
- Commit theo từng phát hiện hoặc nhóm nhỏ, message tiếng Việt kiểu `fix(<phạm vi>): ...`, mã phát hiện ở thân. Kết thúc message bằng dòng:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

## Kiểm trước khi báo xong
- `cd apps/api && npx tsc --noEmit -p tsconfig.json` (gói api), `cd apps/miniapp && npx tsc --noEmit` (gói miniapp), `cd apps/web && npx tsc --noEmit` (gói admin; chạy `npx next typegen` trước nếu cần).
- `npx eslint --max-warnings=0 <các file đã đổi>` trong app tương ứng.
- Test của mọi file đã đổi, cộng spec cùng thư mục.
- Ghép test chặn chung nếu có (vd `notification-variables.spec.ts`, `di-paramtypes.spec.ts`, `common/input-limits.spec.ts`).

## Báo cáo cuối (tiếng Việt, ngắn)
- Mỗi phát hiện: đã sửa / không sửa (lý do), file:line chính, test thêm, kết quả ĐỎ trước → XANH sau (lệnh + số test).
- Commit SHA theo thứ tự.
- Mục "cần chủ quyết" và "rủi ro khi deploy" (migration, đổi hành vi với khách).
