// Thử nghiệm đo: build Mini App với manualChunks tách thư viện (cấu hình chỉ nằm trong script, KHÔNG sửa vite.config.mts)
// để biết mỗi nhóm thư viện nặng bao nhiêu byte SAU nén tối thiểu. Đầu ra ghi ra thư mục tạm, không đụng www/.
// Chạy: cd apps/miniapp && node ../../docs/2026-10-20-uat/tools/perf/build-split.mjs <thư-mục-ra>
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { pathToFileURL } from 'node:url';
const MINIAPP = process.cwd();
const outDir = path.resolve(process.argv[2]);
const require = createRequire(path.join(MINIAPP, 'package.json'));
const viteDir = path.dirname(require.resolve('vite/package.json'));
const { build } = await import(pathToFileURL(path.join(viteDir, 'dist/node/index.js')).href);
const groups = [
  ['react-dom', /node_modules\/(\.pnpm\/[^/]+\/node_modules\/)?(react-dom|scheduler)\//],
  ['zmp-sdk', /node_modules\/(\.pnpm\/[^/]+\/node_modules\/)?zmp-sdk\//],
  ['axios', /node_modules\/(\.pnpm\/[^/]+\/node_modules\/)?axios\//],
  ['zmp-ui-stack', /node_modules\/(\.pnpm\/[^/]+\/node_modules\/)?(zmp-ui|@react-spring|@use-gesture|resize-observer-polyfill|react-transition-group|react-is)\//],
  ['query', /node_modules\/(\.pnpm\/[^/]+\/node_modules\/)?@tanstack\//],
  ['router', /node_modules\/(\.pnpm\/[^/]+\/node_modules\/)?(react-router|react-router-dom|@remix-run)\//],
  ['icons', /node_modules\/(\.pnpm\/[^/]+\/node_modules\/)?lucide-react\//],
  ['zustand', /node_modules\/(\.pnpm\/[^/]+\/node_modules\/)?zustand\//],
];
await build({
  configFile: path.join(MINIAPP, 'vite.config.mts'),
  logLevel: 'warn',
  build: { outDir, emptyOutDir: true, rollupOptions: { output: { manualChunks(id) { for (const [name, rx] of groups) if (rx.test(id)) return 'v-' + name; if (id.includes('node_modules')) return 'v-other'; } } } },
});
const rows = [];
for (const f of fs.readdirSync(path.join(outDir, 'assets'))) {
  if (!f.startsWith('v-') && !f.startsWith('index.')) continue;
  const b = fs.readFileSync(path.join(outDir, 'assets', f));
  rows.push([f, b.length, zlib.gzipSync(b).length]);
}
rows.sort((a, b) => b[1] - a[1]);
for (const [f, r, g] of rows.slice(0, 14)) console.log(f.padEnd(34), String(Math.round(r / 1024)).padStart(5), 'KB raw', String(Math.round(g / 1024)).padStart(5), 'KB gz');
