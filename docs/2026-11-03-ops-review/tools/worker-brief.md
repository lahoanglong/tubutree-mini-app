# Đợt ops-1103: luật cho worker (03/11)

Phát hiện gốc (đã qua verifier đối kháng): `docs/2026-11-03-ops-review/10-review-wf1.json` ở worktree `ops-1103-docs`
(`/Users/longla/coding/tubutree-mini-app/.claude/worktrees/ops-1103-docs`). Mỗi mục có `files`, `evidence`, `failure_scenario`, `fix`, và `verify.reason`.
Đọc đúng mục của gói trước khi sửa; `verify.reason` có thể chỉnh lại kịch bản hoặc mức độ.

## Gốc, nhánh, môi trường
- Gốc: `origin/main` 52fd5cd65. PROD chạy 0aa8af5d1 (khác main chỉ ở tài liệu).
- Mỗi gói đã có worktree `.claude/worktrees/ops-1103-<gói>`, nhánh `ops/1103-<gói>`, đã `pnpm install`, `prisma generate`, build `@tubutree/shared-types`.
- Node: `export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH`. `npx prisma ...` chạy trong `apps/api`.
- Chỉ làm trong worktree của gói mình. Không đụng worktree khác.

## Ranh giới với phiên 2a (chạy song song)
- Phiên 2a giữ màn khách (`apps/miniapp`, `apps/web` ngoài `app/admin/**` và `components/admin/**`), `packages/app-core`, và các module API catalog, cart, checkout, orders, flash-sale, coupons, auth, notifications phía khách, support-chat phía khách.
- Chỉ được sửa file vùng 2a khi gói của bạn ghi rõ tên file đó. Cần sửa thêm file vùng 2a thì DỪNG và ghi vào `open_questions`.
- 2a có thể sửa phần trình bày của `apps/miniapp/src/pages/affiliate.tsx` và `apps/web/src/app/ctv/page.tsx`: chỉ sửa đúng các dòng gói của bạn cần, không định dạng lại file.

## Luật chung
- TDD: viết test đỏ trước (ghi lại lệnh và kết quả đỏ), rồi sửa, rồi xanh. Mỗi lỗi tiền/điểm/race cần race spec trên Postgres thật (`apps/api/test/integration-race`).
- Không đổi luật điểm, giá, phí, thể lệ, chữ pháp lý ngoài các quyết định ghi ở gói. Chữ mới cho khách hoặc admin: tiếng Việt, ngắn, không dùng "Vui lòng"/"vui lòng"/"chúng tôi" (bộ quét chữ cấm ở `apps/api/src` và màn khách).
- Migration: chỉ khi gói cho phép. Nếu cần mà gói không cho thì DỪNG, ghi vào `open_questions`.
- Comment chỉ giải thích "vì sao" không hiển nhiên; không viết comment kể lại thay đổi. Giữ phong cách file xung quanh.
- Màn admin: theo mẫu có sẵn trong `apps/web/src/components/admin/**` (`ui.tsx`, `confirm-dialog.tsx`, `ScrollRegion`, mẫu thẻ ở khổ hẹp của `waste-items-section.tsx`). Vùng bấm ≥ 44px ở 375. Giờ hiển thị và nhập theo giờ Việt Nam (`lib/format-date.ts`, `lib/admin-campaign-form.ts`).
- Màn khách (khi gói cho phép): gọi skill `tubu-ui` trước khi sửa.
- Commit nhỏ theo ý, thông điệp tiếng Việt kiểu `fix(<vùng>): ...`, kết thúc bằng dòng `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Không push, không mở PR, không merge (phiên điều phối làm).
- Không `git stash` trần, không `--no-verify`, không `push --force`, không giết tiến trình không do mình tạo, không ghi PROD.

## Kiểm (worker tự chạy trước khi báo xong)
- `cd apps/api && npx tsc --noEmit -p tsconfig.json`; jest các spec liên quan (`npx jest <đường dẫn>`).
- Đổi web: `cd apps/web && npx next typegen >/dev/null && npx tsc --noEmit`, `npx vitest run <file>`; eslint file đổi.
- Đổi app-core/Mini: `cd packages/app-core && npx tsc --noEmit && npx vitest run <file>`; `cd apps/miniapp && npx tsc --noEmit && npx vitest run <file>` (và `TZ=UTC`).
- Race spec: Postgres nhúng riêng của gói (bảng dưới).
  ```
  bash /Users/longla/coding/tubutree-mini-app/docs/2026-10-20-uat/tools/pg-native.sh start <cổng>
  cd apps/api
  echo "CREATE DATABASE tubutree_it;" | npx prisma db execute --url "postgresql://tubu@127.0.0.1:<cổng>/postgres" --stdin   # bỏ qua lỗi "already exists"
  DATABASE_URL="postgresql://tubu@127.0.0.1:<cổng>/tubutree_it" npx prisma migrate deploy
  DATABASE_URL="postgresql://tubu@127.0.0.1:<cổng>/tubutree_it" npx jest -c test/integration-race/jest.config.js <mẫu tên spec>
  ```
  Để Postgres chạy khi xong (phiên điều phối dừng). Không dùng cổng khác bảng.
- Không chạy cả bộ jest/vitest (phiên điều phối chạy `gate.sh`).

| Gói | Worktree | Race Postgres |
|---|---|---|
| ops | `.claude/worktrees/ops-1103-ops` | 46210 |
| admin | `.claude/worktrees/ops-1103-admin` | 46220 |
| ctv | `.claude/worktrees/ops-1103-ctv` | 46230 |
| game | `.claude/worktrees/ops-1103-game` | 46240 |
| recycle | `.claude/worktrees/ops-1103-recycle` | 46250 |

## Quyết định của chủ (03/11, phiên db)
- VX-01: phần thưởng Cao cấp của Season Pass chỉ mở khi khách có gói định kỳ ACTIVE đã giao ít nhất một đơn định kỳ (DELIVERED). Kiểm lại trong transaction lúc nhận.
- CTV-01: thu hồi điểm của mốc doanh số CTV khi đảo hoa hồng làm doanh số đã chốt của tháng đó rơi dưới ngưỡng mốc đã nhận. Thiếu số dư thì ghi nợ như thưởng giới thiệu. Báo CTV một tin.
- DR-01: thu hồi đổi rác mà thu được 0 điểm thì không gửi tin cho khách.
- DR-03: hạn giữ chỗ yêu cầu đổi rác là hết ngày D theo giờ Việt Nam ("Giữ chỗ tới D" đúng nghĩa trọn ngày D). Chỉ sửa API.
