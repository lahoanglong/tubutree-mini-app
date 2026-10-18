# Brief chung cho agent code (đợt launch review 2026-10-18)

Đọc kèm `00-brief.md` (mục tiêu, phạm vi loại trừ) và báo cáo D1–D6 cùng thư mục: mỗi gói trích ID phát hiện (vd D1-01) và báo cáo có bằng chứng `path:line`.

## Môi trường của gói
- Worktree riêng của gói: `/Users/longla/coding/tubutree-mini-app/.claude/worktrees/lr-<gói>`, nhánh `lr/<gói>`, tách từ `review/2026-10-18-launch`. Chỉ làm trong worktree này. Không `cd` sang worktree khác. Không git stash/reset/checkout lên file không phải của mình. Không push.
- Khởi tạo một lần:
  ```bash
  export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH
  cd <worktree> && pnpm install --frozen-lockfile --prefer-offline
  pnpm --filter @tubutree/shared-types build
  cp /Users/longla/coding/tubutree-mini-app/apps/api/.env apps/api/.env   # gitignored
  (cd apps/api && npx prisma generate)
  ```
- Race test (Postgres thật) chỉ chạy được trên DB tên `tubutree_it`. Mỗi gói dựng container riêng, cổng riêng (ghi trong prompt của gói):
  ```bash
  docker run -d --rm --name lr-<gói>-pg --tmpfs /var/lib/postgresql/data -p <cổng>:5432 \
    -e POSTGRES_USER=tubu -e POSTGRES_PASSWORD=tubu -e POSTGRES_DB=tubutree_it postgres:16-alpine
  export DATABASE_URL="postgresql://tubu:tubu@localhost:<cổng>/tubutree_it?schema=public"
  (cd apps/api && npx prisma migrate deploy)
  (cd apps/api && npx jest -c test/integration-race/jest.config.js --runInBand <file spec>)
  ```
  Xong gói thì `docker rm -f -v lr-<gói>-pg`.
- Đổi `schema.prisma` thì viết migration mới (thư mục `prisma/migrations/2026101800xxxx_<tên>`), áp trên DB race của gói, kiểm drift:
  `npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --exit-code`. Không bao giờ chạy lên DB `tubutree` dev hay PROD.

## Cách làm
- TDD: test đỏ trước, rồi mã, rồi test xanh. Mỗi mục một commit nhỏ, message tiếng Việt kiểu `feat(admin): ...`, kết thúc bằng dòng `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Viết mã giống mã xung quanh (tên, comment, idiom). Comment chỉ giải thích "vì sao" không hiển nhiên; không comment kể lại thay đổi.
- Chữ hiển thị tiếng Việt có dấu, dùng i18n/chữ sẵn có của app. Miniapp dùng token design system v2 (không hex/px rời), vùng chạm ≥ 44px, có trạng thái tải/lỗi/rỗng.
- Tham số kinh doanh (%, số tiền, ngưỡng, bật/tắt) phải là SystemConfig có giá trị mặc định trong mã. Chủ dự án chưa quyết thì mặc định = hành vi hiện tại (tắt / 0), không tự đặt số kinh doanh.
- File đang bị phiên đổi-rác sửa: `apps/web/src/app/admin/page.tsx`, `components/admin/engagement-tab.tsx`, `apps/api/src/modules/checkout/*`, `apps/miniapp/src/components/app.tsx`, `pages/checkout.tsx`, `pages/loyalty.tsx`, `pages/game.tsx`, `modules/refill`, `modules/game` (phần cây), `prisma/seed.ts`. Chỉ chạm khi gói bắt buộc; nếu chạm thì diff tối thiểu (vd 2 dòng thêm tab vào `page.tsx`), viết phần lớn ở file mới.
- Không chạy full suite. Chỉ chạy test liên quan: `npx jest <đường dẫn>` (api), `npx vitest run <đường dẫn>` (miniapp/web), `npx tsc --noEmit` của app đã sửa, `npx eslint <file đã sửa> --max-warnings=0`, `npm run -s lint:vars` ở gốc nếu sửa CSS/biến. Máy 15,5 GB RAM có nhiều phiên khác: không build, không Playwright.
- Không thêm thư viện mới nếu không thật cần; nếu cần thì ghi lý do trong báo cáo.

## Khi xong
Ghi báo cáo ngắn `docs/2026-10-18-launch-review/impl/<gói>.md` trong worktree của gói (commit cùng nhánh):
1. Đã làm gì (theo ID phát hiện), file chính.
2. Lệnh kiểm chứng đã chạy và kết quả (dán dòng tổng kết test).
3. Phần chưa làm hoặc cố ý để lại, kèm lý do.
4. Câu hỏi cho chủ dự án (nếu có), kèm mặc định đã dùng.
Trả về cho điều phối viên: ≤ 15 dòng + tip commit.
