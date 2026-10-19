// Build Mini App bằng API của Vite (cùng cấu hình vite.config.mts) và ghi thống kê module theo chunk.
// Chạy: cd apps/miniapp && node ../../docs/2026-10-20-uat/tools/perf/build-stats.mjs
// Ghi: docs/2026-10-20-uat/perf-data/miniapp-chunks.json. Không sửa mã nguồn; đầu ra build ở apps/miniapp/www (đã gitignore).
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const MINIAPP = process.cwd();
const require = createRequire(path.join(MINIAPP, 'package.json'));
const viteDir = path.dirname(require.resolve('vite/package.json'));
const { build } = await import(pathToFileURL(path.join(viteDir, 'dist/node/index.js')).href);

const OUT = path.resolve(MINIAPP, '../../docs/2026-10-20-uat/perf-data/miniapp-chunks.json');
const statsPlugin = {
  name: 'uat-chunk-stats',
  generateBundle(_o, bundle) {
    const chunks = [];
    for (const [file, c] of Object.entries(bundle)) {
      if (c.type !== 'chunk') continue;
      const mods = Object.entries(c.modules).map(([id, m]) => ({ id: id.replace(MINIAPP, '.'), rendered: m.renderedLength }));
      mods.sort((a, b) => b.rendered - a.rendered);
      const byPkg = {};
      for (const m of mods) {
        const mm = m.id.match(/node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?((?:@[^/]+\/)?[^/]+)/);
        const key = mm ? mm[1] : '(app src)';
        byPkg[key] = (byPkg[key] || 0) + m.rendered;
      }
      chunks.push({
        file,
        isEntry: c.isEntry,
        isDynamicEntry: c.isDynamicEntry,
        size: c.code.length,
        imports: c.imports,
        dynamicImports: c.dynamicImports,
        byPkg: Object.entries(byPkg).sort((a, b) => b[1] - a[1]).slice(0, 15),
        topModules: mods.slice(0, 40),
      });
    }
    chunks.sort((a, b) => b.size - a.size);
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(chunks, null, 1));
  },
};

const t0 = Date.now();
await build({ configFile: path.join(MINIAPP, 'vite.config.mts'), plugins: [statsPlugin], logLevel: 'info' });
console.log(`build xong trong ${((Date.now() - t0) / 1000).toFixed(1)} s`);
