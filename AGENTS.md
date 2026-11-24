# Tubu Tree: hướng dẫn cho agent

Monorepo pnpm + turbo: `apps/api` (NestJS), `apps/web` (Next.js), `apps/miniapp` (Zalo Mini App, Vite), `apps/e2e` (Playwright), `packages/*`.

## Hai nền tảng

Khách dùng cùng một cửa hàng qua Mini App và qua website. Hai bên phải có cùng chức năng.

- Logic gọi API (service, kiểu, cờ tính năng) nằm ở `packages/app-core`, kèm contract spec. Mini App và web chỉ cắm `HttpClient` riêng, không chép logic.
- Khả năng riêng nền tảng (chia sẻ, mở chat, gọi điện, lưu trữ, quét mã) đi qua `PlatformBridge`, không gọi thẳng `zmp-sdk` hay `window` trong app-core.
- Chức năng dành cho khách mới phải có màn Mini App và trang web trong cùng nhánh. Nếu cố ý không làm trên web, thêm dòng `skip` có lý do trong `packages/app-core/src/route-map.json`.
- `route-map.json` ghi mỗi `<Route>` của `apps/miniapp/src/components/app.tsx` một dòng, kèm route web đích, `private`, và `pending: true` khi route web chưa có file. Xong route nào thì xoá `pending` của dòng đó.
- Lệch cố ý mà route có ở cả hai nền tảng (cờ tính năng ẩn một lối vào, vd `SUBSCRIPTIONS_IN_MINIAPP`) ghi vào `gaps` của `route-map.json`: `id`, `flag` (`[file, tên cờ]`), `missingOn` (`miniapp` hoặc `web`), `reason`. `lint:parity` đỏ khi thiếu lý do hoặc cờ không còn trong file.
- Trước khi báo xong chạy `pnpm lint:parity` (`scripts/check-platform-parity.mjs`). Đỏ khi thiếu dòng, thừa dòng, `skip` thiếu lý do, hoặc dòng không `pending` mà web không có `page.tsx`/`route.ts`. `--strict` coi `pending` là lỗi.
- Thiết kế đầy đủ: `docs/2026-10-19-web-parity/01-thiet-ke.md`.

## Giao diện

- Trước khi làm hay sửa màn mua sắm (Mini App hoặc web), đọc `.claude/skills/tubu-ui/SKILL.md` và `DESIGN.md`: thành phần nào dùng cho nhu cầu nào, khai kệ, khuôn trang web, lệnh kiểm. Không dựng thẻ sản phẩm, tiêu đề khối, nhãn, giá hay phiếu mới khi `docs/design/ds-map.json` đã có thành phần.
- Chữ của màn gian hàng chỉ thêm vào `packages/app-core/src/shop-copy.ts`, kèm chỗ dùng và độ dài tối đa. Mô-đun nằm trong gói đầu Mini App (Trang chủ, thanh đáy, thẻ sản phẩm, giỏ…) dùng `fillBootCopy` và khoá ở `packages/app-core/src/shop-copy-boot.ts`: gọi `fillCopy` ở đó kéo cả bảng về entry (`mini-lazy-chunks.cjs` chặn). Chạy `terminology.spec` và `shop-copy.spec` trước khi mở PR.

## Trước khi đẩy nhánh wave hoặc release

- Chạy `node scripts/ci/wave-preflight/index.mjs` (vài giây, chỉ đọc tệp). Nó so nhánh với merge-base của `origin/main` và đỏ khi: GET mới phía client (tính riêng Mini App và web) thiếu mặc định trong fixture của `apps/e2e/tests/support/mock-api.ts`; `HEAVY_MIGRATIONS` lệch runbook deploy mục 1.0/3.1/3.2; `@Cron` thiếu nhãn `CRON_JOB_LABELS`; số "+N mới" của `reference-seed.race-spec.ts` lệch `NOTIFICATION_TEMPLATES`; tệp giao diện đổi làm tăng `ds-ratchet` hoặc luật có baseline của `ds-shop-rules`; route quản trị (`/admin`, `@Roles` ADMIN/STAFF, `@AllowStaff`) lệch bảng `staff-permissions.matrix.spec.ts`. Lỗi in kèm cách sửa; "nhắc" là việc phải tự kiểm (vd `ds-shop-guard.spec.ts`). GET chỉ gọi khi bấm (spec của nó tự mock) hoặc chỉ khi web dựng trang ở máy chủ thì đánh dấu `// wave-preflight-ignore mock-api-fallback: <lý do>` ngay trên lời gọi. Nhánh đã gộp vào main: truyền `--base <SHA gốc của wave>`.
