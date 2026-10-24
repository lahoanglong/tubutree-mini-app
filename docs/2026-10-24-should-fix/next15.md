# Nâng Next 14.2.35 lên 15.5.28 (apps/web)

Nhánh `ns/next15`, tách từ 99e3b5ef (đầu PR #33).

## Phiên bản và audit
- `next` 15.5.28 (bản 15.5.x mới nhất), `react`/`react-dom` 19.3.1, `@types/react(-dom)` 19.3.0, `eslint-config-next` 15.5.28. Chỉ apps/web; miniapp giữ React 18.
- `pnpm audit --prod`, advisory của `next`: trước 3 critical, 9 high, 11 moderate, 2 low; sau 0.
- Hai bản React trong một repo (web 19, miniapp 18). Ba chốt để mỗi app chỉ nạp một bản:
  - `pnpm.packageExtensions` (package.json gốc): `next`, `@tanstack/react-query`, `lucide-react`, `react-router`, `react-router-dom` khai peer tuỳ chọn `@types/react`; `zmp-ui` khai peer bắt buộc `react`, `react-dom` ^18 (gói này import React mà không khai báo).
  - `.npmrc`: không hoist `react`, `react-dom`, `@types/react`, `@types/react-dom` vào `.pnpm/node_modules`. Gói nào import React mà không khai báo sẽ lỗi ngay thay vì lặng lẽ lấy bản 19.
  - `resolve.dedupe: ['react', 'react-dom']` trong vite và vitest config của miniapp.
  - Thiếu các chốt này: zmp-ui lấy React 19 trong khi app chạy React 18, mọi màn Mini App trắng (`Cannot read properties of null (reading 'useState')`), tsc miniapp 133 lỗi.
- Máy đã có `node_modules` cũ: chạy `rm -rf node_modules` trước `pnpm install`, vì đổi hoist-pattern làm pnpm hỏi xác nhận xoá. CI không bị.

## Thay đổi mã
- next.config.mjs: bỏ `experimental.instrumentationHook`; `serverComponentsExternalPackages` thành `serverExternalPackages`; `outputFileTracingIncludes` và `outputFileTracingRoot` lên cấp cao nhất. Giữ `images.unoptimized: true`, `output: 'standalone'`.
- Async request API: mã đã dùng `await params`/`searchParams` ở hầu hết nơi. Sửa thêm: `tai-khoan/don-hang/[code]/layout.tsx` (generateMetadata), 3 page `doi-rac/.../[id]`, kiểu `Ctx` của `product/[slug]/route.ts`. Không có `cookies()/headers()/draftMode()`.
- Cache fetch: mọi fetch phía server (`lib/api.ts`, `lib/core-http-server.ts`) đã có `next: { revalidate }` tường minh nên không đổi. `fetch` trong `lib/og-image-fetch.ts` (ảnh OG, route động) không có tuỳ chọn cache, Next 15 không cache nữa: chấp nhận được. Route handler `product/[slug]` đọc `request` nên vốn động; robots/sitemap giữ như cũ.
- React 19: `RefObject<T | null>` ở `use-modal-a11y.ts`; `React.JSX.Element` trong 2 spec; một thẻ `<a href="/">` sang `Link` (luật `no-html-link-for-pages` thành error ở eslint-config-next 15). Nút "Về trang chủ" ở `dang-nhap/callback` giữ `<a>` (tắt luật đúng một dòng): đổi mã đăng nhập lỗi để trạng thái là chưa đăng nhập, tải lại hẳn trang mới khôi phục phiên còn hạn từ cookie.
- `apps/web/next-env.d.ts` của Next 15 tham chiếu `.next/types/routes.d.ts`. Script `typecheck` của web chạy `next typegen` trước `tsc`, để CI (typecheck trước build) không lỗi TS6053 khi chưa có `.next`.
- Test: cart-parity bọc `act` quanh timer giả; chat/page.spec cho `markRead` bị từ chối trễ 30ms (React 19 render lại trước khi promise lỗi quay về nên bản cũ gửi lần hai ngay); bỏ ca "params đồng bộ" của route sản phẩm; spec gate dựng thẳng component thay vì page async.
- instrumentation.ts và Dockerfile: sửa comment.

## Build, so sánh với baseline
Loại route (tĩnh/động) của cả 68 dòng không đổi. Khác biệt:
- First Load JS dùng chung 87.6 kB thành 103 kB (React 19 + runtime Next 15); mỗi trang tăng khoảng +9 đến +10 kB.
- Cột Revalidate/Expire mới của Next 15 (trang tĩnh gói `revalidate` của fetch trong layout, 1h; `/` 5m).
- Middleware 27.2 kB thành 35 kB.

## Smoke `next start` (API không với tới được)
32 URL, mã trạng thái giống hệt baseline (`diff` rỗng). Gồm: `/`, `/san-pham` 200; `/san-pham/abc` 500 và `/chinh-sach/dieu-khoan`, `/s/demo`, `/brand/abc` 500 (cần API, giống baseline); `/product/abc` 307; `/_next/image` 404 (tối ưu ảnh tắt); `/s/demo/opengraph-image`, robots.txt, sitemap.xml, opengraph-image.png, icon.png, admin, tai-khoan, 200.

## Việc để lại
- Bật lại tối ưu ảnh (remotePatterns + đo tải).
- Next 15 có `onRequestError` trong instrumentation.ts: lỗi render server lên Sentry (docs/2026-10-24-prod-blockers/sentry.md nói chưa có).
- Cảnh báo "inferred workspace root" khi build trong worktree là do lockfile thứ hai của worktree, không xảy ra ở repo thường.
- `@opentelemetry/api` unmet peer của `@sentry/node` đã có từ trước.
