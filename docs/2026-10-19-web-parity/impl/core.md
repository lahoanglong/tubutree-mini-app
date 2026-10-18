# Lane core (đợt 0a)

## 1. Đã làm

| Mục | Commit | File chính |
|---|---|---|
| Gói app-core, cờ tính năng chuyển vào gói, Mini App re-export | 06028ebe | `packages/app-core/{package,tsconfig,vitest.config}`, `src/http.ts`, `src/features.ts`, `src/route-map.json`, `src/forbidden-imports.spec.ts`, `apps/miniapp/src/utils/features.ts`, `apps/web/next.config.mjs` |
| Adapter HttpClient client (bọc `apiFetch`) + dựng query giống axios | 14e44a8e | `apps/web/src/lib/core-http.ts`, `core-query.ts` |
| Adapter HttpClient server component | c8d99670 | `apps/web/src/lib/core-http-server.ts` |
| Adapter HttpClient Mini App (bọc axios) | 03b6b268 | `apps/miniapp/src/services/core-http.ts` |
| Review 1: danh sách rỗng khi build lúc API chưa lên | c32ed29f | `core-http-server.ts` (`getListOrEmptyAtBuild`) |
| Review 1: adapter client luôn trả promise bị từ chối, spec qua `apiFetch` thật | 79e90f30 | `core-http.ts`, `core-http-client-api.spec.ts` |
| Review 1: siết spec cấm import | 1994b7cf | `packages/app-core/src/forbidden-imports.spec.ts` |
| Bằng chứng `next build` nạp app-core, kết quả gate | 6f8d0f85, 2cfbe05e | file này |

Test thêm: app-core 48; web thêm 5 spec adapter (41 test); Mini App 4243 -> 4259.

## 2. Kiểm chứng

```
export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH
pnpm install --prefer-offline
pnpm --filter @tubutree/shared-types build
pnpm --filter @tubutree/app-core typecheck && pnpm --filter @tubutree/app-core test
pnpm --filter @tubutree/web typecheck && pnpm --filter @tubutree/web lint && pnpm --filter @tubutree/web test
(cd apps/web && TZ=UTC npx vitest run)
pnpm --filter @tubutree/miniapp typecheck && pnpm --filter @tubutree/miniapp lint && pnpm --filter @tubutree/miniapp test
pnpm lint:vars
pnpm --filter @tubutree/web build && pnpm --filter @tubutree/miniapp build
```

- install: up to date
- app-core: typecheck 0 lỗi; Test Files 2 passed, Tests 48 passed
- web: typecheck 0 lỗi; lint "No ESLint warnings or errors"; Test Files 195 passed, Tests 3044 passed (cả `TZ=UTC`)
- miniapp: typecheck, lint sạch; Test Files 282 passed, Tests 4259 passed (>= 4243)
- lint:vars: OK every var(--x) reference is defined
- web build qua; miniapp build "built in 12.08s"

Bằng chứng `next build` nạp app-core: trang thăm dò tạm `zz-probe` import `CASHBACK_ENABLED` từ `@tubutree/app-core/features`; build qua, `page.js` chứa `children:String(!1)`, `page.js.nft.json` liệt kê `packages/app-core/package.json`. Đã xoá trang thăm dò và `.next`, không commit.

## 3. Review

Lượt 1:
- MAJOR adapter server mất nhánh build-time của `fetchList`: đã sửa ở c32ed29f.
- MINOR `call` ném đồng bộ với URIError: sửa ở 79e90f30.
- MINOR spec cấm import thủng (.tsx, `react/*`, global khác): sửa ở 1994b7cf.
- MINOR spec adapter mock cả `apiFetch`: sửa ở 79e90f30 (spec qua `apiFetch` thật).
- MINOR `next build` chưa nạp app-core: xem lượt 2.

Lượt 2:
- MINOR còn lại (nạp app-core trong build web): chưa thêm import giá trị vào mã thật vì trang cần cờ thuộc lane khác; đã chứng minh bằng trang thăm dò (6f8d0f85) và ghi hoãn ở trên.
- Ghi nhận: `src/pages/profile-hub.spec.tsx` của Mini App chập chờn (vài lần trong ba chạy riêng lẻ), có trước lane này; không sửa test Mini App.

## 4. Chưa làm, cố ý để lại, chưa kiểm chứng

- `route-map.json` chỉ là stub `{ routes: [], features: [] }`.
- `core-http-server.ts` chép lại `BASE` và logic header bypass của `lib/api.ts` (không export, file thuộc lane khác). Muốn một nguồn thì lane sở hữu `api.ts` export rồi adapter import lại.
- Chưa có import giá trị app-core trong mã web thật; lane `core-api` hoặc `shop` là lần kiểm chứng đầu tiên.
- Script `lint` của app-core là `tsc --noEmit`.
- Không chạy Playwright.
- `apps/miniapp/package.json`, `apps/web/package.json` đã sửa; lane khác sửa hai file này cần rebase theo 06028ebe.

## 5. Câu hỏi cho chủ dự án

Không có.
