# Lane core (đợt 0a)

## Chứng minh `next build` nạp được `@tubutree/app-core`

Hai adapter web (`core-http.ts`, `core-http-server.ts`) chỉ `import type` từ app-core nên bị xoá lúc biên dịch, và chưa trang nào dùng chúng. Vì vậy `next build` thường chưa biên dịch file nào của `packages/app-core`. Lane core không sửa trang của lane khác để thêm import chỉ vì mục đích chứng minh, nên đã chứng minh bằng một trang thăm dò tạm, không commit:

- Trang `apps/web/src/app/zz-probe/page.tsx` có `import { CASHBACK_ENABLED } from '@tubutree/app-core/features'` và render `String(CASHBACK_ENABLED)`.
- `pnpm --filter @tubutree/web build` qua. Route `/zz-probe` được dựng; `.next/server/app/zz-probe/page.js` chứa `children:String(!1)` (giá trị `false` lấy từ `packages/app-core/src/features.ts`), và `page.js.nft.json` liệt kê `packages/app-core/package.json`.
- Đã xoá trang thăm dò và `.next` sau khi kiểm.

Kết luận: `transpilePackages: ['@tubutree/app-core']` cùng `exports: { './*': './src/*.ts' }` và `type: module` chạy được với webpack/SWC của Next 14.2.35. Phía Mini App đã chứng minh bằng `vite build` (bundle `utils/features.ts` qua re-export).

Hoãn cho lane sau: chưa có import giá trị thật của app-core trong bản build web. Lane `core-api` hoặc `shop` thêm import giá trị đầu tiên vào trang sẽ tự chạy `pnpm --filter @tubutree/web build` trong gate của mình, và đó là lần kiểm chứng đầu tiên trong mã thật (giả định hợp lệ vì đã có bằng chứng thăm dò ở trên).
