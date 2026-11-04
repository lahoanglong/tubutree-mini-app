# Luật chung cho mọi gói hard/1105

## Nguồn
- Kế hoạch: `PLAN.md` (cùng thư mục). Đọc các mục Global Constraints và Review Focus.
- Phát hiện kèm quyết định của chủ: `audit-1105-findings.md` (cùng thư mục).
  - Mỗi mục có `path:line`, kịch bản, hướng sửa và test.
  - Mã nguồn gốc là `d79ceeb85`. Số dòng có thể đã lệch: tìm lại theo tên hàm.

## Chuẩn bị
1. `export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH`
2. `pnpm install --frozen-lockfile --offline`
3. `cd apps/api && npx prisma generate`

## Cách làm
- TDD: viết test đỏ trước, chạy cho thấy đỏ, sửa, rồi chạy cho thấy xanh.
- Mỗi mục (ID trong findings hoặc Task) là một commit riêng.
- Đường tiền và đường quyền phải an toàn khi chạy đồng thời. Dùng một trong hai cách:
  - CAS bằng `updateMany` với điều kiện trạng thái cũ, rồi kiểm `count`;
  - khoá dòng (`FOR NO KEY UPDATE` / `FOR UPDATE`) trước khi đọc rồi ghi.

  Thao tác thua cuộc trả 409 kèm câu rõ ràng bằng tiếng Việt.
- Migration chỉ được mở rộng (thêm cột, bảng, index), không xoá.
  - Tên: `YYYYMMDDHHMMSS_<ten>`, với thời điểm sau `20261104180000`.
  - Đặt tên theo gói để không trùng: gói `ha` dùng `202611051000xx`, `hb` dùng `202611051100xx`, `hc` dùng `202611051200xx`, `hd1` dùng `202611051300xx`, `hd2` dùng `202611051400xx`, `hd3` dùng `202611051500xx`, `he` dùng `202611051600xx`, `hf` dùng `202611051700xx`, `hg` dùng `202611051800xx`.
  - Migration nặng (backfill, index trên bảng lớn) thì thêm vào `HEAVY_MIGRATIONS` (`apps/api/src/config/go-live/db-checks.ts`) và vào bảng §1.0 của `docs/launch/deploy-rollback-runbook.md`, kèm câu đếm trước deploy.
- Route mới: cập nhật `EXPECTED` trong `apps/api/src/common/staff-permissions.matrix.spec.ts`.
- Chuỗi mới hiện cho người dùng:
  - Viết tiếng Việt có dấu, theo `apps/web/src/app/admin/terminology.spec.ts` và các spec thuật ngữ của Mini App.
  - Trước khi sửa giao diện trong `apps/miniapp` hoặc trang khách của `apps/web`, gọi skill `tubu-ui`.

## Tự kiểm trước khi báo (dán đuôi output thật)
1. `tsc --noEmit` cho mọi app bị đổi.
2. eslint cho mọi app bị đổi.
3. jest apps/api TOÀN BỘ, không chỉ thư mục đã đổi. Máy dùng chung: luôn `npx jest --silent --maxWorkers=2`.
4. Chạy race TOÀN BỘ trên DB mới, cổng `<PORT>` ghi trong brief của gói:

   ```bash
   bash docs/2026-10-20-uat/tools/pg-native.sh start <PORT>
   bash docs/2026-10-20-uat/tools/pg-native.sh createdb <PORT> tubutree_it
   cd apps/api
   export DATABASE_URL="postgresql://tubu@127.0.0.1:<PORT>/tubutree_it?schema=public"
   npx prisma migrate deploy
   npx jest -c test/integration-race/jest.config.js --runInBand
   ```

5. Kiểm drift:

   ```bash
   npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --exit-code
   ```

   Không pipe lệnh này, vì pipe làm mất exit code. Kỳ vọng exit 0.
6. Dừng DB: `bash docs/2026-10-20-uat/tools/pg-native.sh stop <PORT>`.
7. vitest cho mọi app frontend bị đổi, chạy với `VITEST_MIN_FORKS=1 VITEST_MAX_FORKS=2 VITEST_MIN_THREADS=1 VITEST_MAX_THREADS=2` (đặt MAX mà thiếu MIN thì vitest báo "minThreads and maxThreads must not conflict" và không chạy test nào).

Không chạy `gate.sh` hay `pw-gate.sh`: người điều phối tự chạy.

## Cấm
- Không push, amend, rebase.
- Không dùng `git stash` trần.
- Không dùng `--no-verify`.
- Không sửa các file dùng chung:
  - `packages/app-core`
  - `packages/shared-types`
  - `apps/e2e/playwright.config*`
  - `apps/web/next.config.*`
  - `apps/web/src/middleware.ts`
  - CSP

  Nếu buộc phải sửa, dừng lại và ghi vào báo cáo.
- Không đọc hay ghi PROD. Không kill process mình không tạo.
- Chỉ làm trong worktree của gói mình.
- Comment bằng tiếng Việt, chỉ giải thích "vì sao" không hiển nhiên. Không viết comment kể lại thay đổi. Không ghi "chủ nói..." vào mã.
- Mọi commit kết thúc bằng dòng `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Báo cáo
- Danh sách commit (sha + tiêu đề).
- Danh sách file đổi.
- Output thật của các bước tự kiểm.
- Chỗ lệch so với brief, kèm lý do.
- Câu hỏi còn mở.
