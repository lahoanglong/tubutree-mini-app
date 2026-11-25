#!/usr/bin/env node
// Phục vụ bản build Mini `apps/miniapp/www` bằng `vite preview` dưới /zapps/<id>/ như ZMPRouter production (basename `/zapps/${APP_ID}`, APP_ID
// không có khi chạy ngoài Zalo nên là /zapps/undefined). Bản build dùng `base: ''` (asset tương đối): trang /zapps/undefined/order/X xin
// ./assets/a.js thành /zapps/undefined/order/assets/a.js, nên mọi đường dẫn bỏ tiền tố /zapps/<id> và gom `…/assets/` về /assets/ trước khi tới
// bộ phục vụ tĩnh của Vite; đường không có tệp rơi về index.html (appType spa). Dùng bởi playwright.mini-www.config.ts.
//   node apps/e2e/scripts/serve-mini-www.mjs [port]
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const miniDir = path.resolve(here, '../../miniapp');
const www = path.join(miniDir, 'www');
if (!existsSync(path.join(www, 'index.html'))) {
  console.error(`thiếu ${path.join(www, 'index.html')}: build Mini trước (pnpm --filter @tubutree/miniapp build)`);
  process.exit(2);
}
const port = Number(process.argv[2] ?? process.env.E2E_MINI_WWW_PORT ?? 3123);
const requireFromMini = createRequire(path.join(miniDir, 'package.json'));
const viteDir = path.dirname(requireFromMini.resolve('vite/package.json'));
const { preview } = await import(pathToFileURL(path.join(viteDir, 'dist/node/index.js')).href);

function rewrite(url) {
  const u = new URL(url, 'http://localhost');
  const p = (u.pathname.replace(/^\/zapps\/[^/]+(?=\/|$)/, '') || '/').replace(/^.*\/assets\//, '/assets/');
  return p + u.search;
}

const server = await preview({
  configFile: false,
  root: miniDir,
  logLevel: 'warn',
  build: { outDir: 'www' },
  preview: { host: 'localhost', port, strictPort: true, open: false },
  plugins: [
    {
      name: 'tubu-zapps-base',
      configurePreviewServer(s) {
        s.middlewares.use((req, _res, next) => {
          req.url = rewrite(req.url ?? '/');
          next();
        });
      },
    },
  ],
});
server.printUrls();
