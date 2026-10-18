# Tubu Tree: hướng dẫn cho agent

Monorepo pnpm + turbo: `apps/api` (NestJS), `apps/web` (Next.js), `apps/miniapp` (Zalo Mini App, Vite), `apps/e2e` (Playwright), `packages/*`.

## Hai nền tảng

Khách dùng cùng một cửa hàng qua Mini App và qua website. Hai bên phải có cùng chức năng.

- Logic gọi API (service, kiểu, cờ tính năng) nằm ở `packages/app-core`, kèm contract spec. Mini App và web chỉ cắm `HttpClient` riêng, không chép logic.
- Khả năng riêng nền tảng (chia sẻ, mở chat, gọi điện, lưu trữ, quét mã) đi qua `PlatformBridge`, không gọi thẳng `zmp-sdk` hay `window` trong app-core.
- Chức năng dành cho khách mới phải có màn Mini App và trang web trong cùng nhánh. Nếu cố ý không làm trên web, thêm dòng `skip` có lý do trong `packages/app-core/src/route-map.json`.
- `route-map.json` ghi mỗi `<Route>` của `apps/miniapp/src/components/app.tsx` một dòng, kèm route web đích, `private`, và `pending: true` khi route web chưa có file. Xong route nào thì xoá `pending` của dòng đó.
- Trước khi báo xong chạy `pnpm lint:parity` (`scripts/check-platform-parity.mjs`). Đỏ khi thiếu dòng, thừa dòng, `skip` thiếu lý do, hoặc dòng không `pending` mà web không có `page.tsx`/`route.ts`. `--strict` coi `pending` là lỗi.
- Thiết kế đầy đủ: `docs/2026-10-19-web-parity/01-thiet-ke.md`.
