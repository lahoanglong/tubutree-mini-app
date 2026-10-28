#!/usr/bin/env node
// Đo kích thước bản build và in JSON ra stdout, để so trước/sau từng gói sửa.
//   node docs/2026-10-28-review/tools/perf/bundle-report.mjs [--build-miniapp] [--build-web] [--only=miniapp|web]
// Chạy từ gốc repo. Cần PATH có Node 22.
//   --build-miniapp  build lại apps/miniapp (vite API, cùng vite.config.mts) kèm thống kê module theo chunk. Cần VITE_API_BASE_URL
//                    (mặc định script đặt https://api.tubutree.com/api nếu chưa có). Bỏ cờ này thì chỉ đọc apps/miniapp/www có sẵn.
//   --build-web      chạy `next build` trong apps/web (đặt NEXT_PUBLIC_API_BASE_URL/API_BASE_URL = http://localhost:3251/api nếu chưa có).
//                    Bỏ cờ này thì chỉ đọc apps/web/.next có sẵn.
// Số web: `nextFirstLoadKB` lấy từ bảng của chính `next build` (log lưu ở apps/web/.next/bundle-report-next-build.log; số chuẩn để so).
//   `manifestGzKB` tự cộng gzip chunk trong app-build-manifest: cao hơn số của Next ~20-35 KB (Next trừ chunk đã tính riêng), chỉ dùng xếp hạng thô.
// Số miniapp: raw/gzip tính như scripts/ci/bundle-budget.cjs; entry = file JS lớn nhất.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const only = (args.find((a) => a.startsWith('--only=')) || '').slice(7);
const kb = (b) => Math.round((b / 1024) * 10) / 10;
const gz = (buf) => zlib.gzipSync(buf).length;

const ENTRY_TARGET_KB = 450;
const ENTRY_WARN_KB = Number(process.env.MINIAPP_ENTRY_WARN_KB) || 700;
const TOTAL_WARN_KB = Number(process.env.MINIAPP_TOTAL_WARN_KB) || 2048;

async function buildMiniappStats() {
  const miniapp = path.join(ROOT, 'apps/miniapp');
  process.env.VITE_API_BASE_URL ||= 'https://api.tubutree.com/api';
  const require = createRequire(path.join(miniapp, 'package.json'));
  const viteDir = path.dirname(require.resolve('vite/package.json'));
  const { build } = await import(pathToFileURL(path.join(viteDir, 'dist/node/index.js')).href);
  const chunks = [];
  const plugin = {
    name: 'bundle-report-stats',
    generateBundle(_o, bundle) {
      for (const [file, c] of Object.entries(bundle)) {
        if (c.type !== 'chunk') continue;
        const byPkg = {};
        const srcFiles = [];
        for (const [id, m] of Object.entries(c.modules)) {
          const mm = id.match(/node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?((?:@[^/]+\/)?[^/]+)/);
          const key = mm ? mm[1] : '(app src)';
          byPkg[key] = (byPkg[key] || 0) + m.renderedLength;
          if (!mm) srcFiles.push([id.replace(ROOT + '/', ''), m.renderedLength]);
        }
        chunks.push({
          file,
          isEntry: c.isEntry,
          size: c.code.length,
          byPkg: Object.entries(byPkg).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => [k, Math.round(v / 1024)]),
          srcFiles,
          facade: c.facadeModuleId ? c.facadeModuleId.replace(ROOT + '/', '') : null,
        });
      }
    },
  };
  const origLog = console.log;
  const origCwd = process.cwd();
  console.log = () => {};
  process.chdir(miniapp); // zmp-vite-plugin đọc ./app-config.json theo cwd
  try {
    await build({ root: miniapp, configFile: path.join(miniapp, 'vite.config.mts'), plugins: [plugin], logLevel: 'silent' });
  } finally {
    process.chdir(origCwd);
    console.log = origLog;
  }
  return chunks;
}

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

function miniappReport(stats) {
  const dir = path.join(ROOT, 'apps/miniapp/www');
  if (!fs.existsSync(dir)) return { error: 'chưa có apps/miniapp/www, chạy với --build-miniapp' };
  const rows = walk(dir).map((p) => {
    const buf = fs.readFileSync(p);
    const compressible = /\.(js|css|html|json|svg|map)$/.test(p);
    return { file: path.relative(dir, p).split(path.sep).join('/'), raw: buf.length, gz: compressible ? gz(buf) : buf.length };
  });
  const sum = (re) => {
    const r = rows.filter((x) => re.test(x.file));
    return { files: r.length, rawKB: Math.round(r.reduce((s, x) => s + x.raw, 0) / 1024), gzKB: Math.round(r.reduce((s, x) => s + x.gz, 0) / 1024) };
  };
  const js = rows.filter((x) => x.file.endsWith('.js')).sort((a, b) => b.raw - a.raw);
  const entry = js[0];
  const total = sum(/./);
  const html = fs.existsSync(path.join(dir, 'index.html')) ? fs.readFileSync(path.join(dir, 'index.html'), 'utf8') : '';
  const out = {
    entry: { file: entry.file, rawKB: Math.round(entry.raw / 1024), gzKB: Math.round(entry.gz / 1024) },
    groups: { js: sum(/\.js$/), css: sum(/\.css$/), assets: sum(/\.(png|jpe?g|webp|gif|svg|woff2?|ttf)$/), total },
    top10: rows.slice().sort((a, b) => b.raw - a.raw).slice(0, 10).map((x) => ({ file: x.file, rawKB: Math.round(x.raw / 1024), gzKB: Math.round(x.gz / 1024) })),
    thresholds: { entryTargetKB: ENTRY_TARGET_KB, entryWarnKB: ENTRY_WARN_KB, totalWarnKB: TOTAL_WARN_KB },
    verdict: {
      entryOverTarget: Math.round(entry.raw / 1024) > ENTRY_TARGET_KB,
      entryOverWarn: Math.round(entry.raw / 1024) > ENTRY_WARN_KB,
      totalOverWarn: total.rawKB > TOTAL_WARN_KB,
      entryOverTargetByKB: Math.round(entry.raw / 1024) - ENTRY_TARGET_KB,
    },
    indexHtmlScripts: [...html.matchAll(/<(?:script|link)[^>]+(?:src|href)="([^"]+)"/g)].map((m) => m[1]),
  };

  // Route lazy hay nằm trong entry: đọc components/app.tsx.
  const appSrc = fs.readFileSync(path.join(ROOT, 'apps/miniapp/src/components/app.tsx'), 'utf8');
  const lazyPages = [...appSrc.matchAll(/const (\w+) = lazy\(\(\) => import\('\.\.\/pages\/([\w-]+)'\)\)/g)].map((m) => m[2]);
  const eagerPages = [...appSrc.matchAll(/^import (\w+) from '\.\.\/pages\/([\w-]+)';/gm)].map((m) => m[2]);
  out.routes = { lazyCount: lazyPages.length, lazy: lazyPages, eager: eagerPages };

  if (stats) {
    const e = stats.find((c) => c.isEntry);
    out.entryComposition = {
      byPackageKB: e.byPkg,
      appSrcModules: e.srcFiles.length,
      appSrcTop20KB: e.srcFiles.slice().sort((a, b) => b[1] - a[1]).slice(0, 20).map(([f, n]) => [f, Math.round((n / 1024) * 10) / 10]),
      appSrcPagesInEntry: e.srcFiles.filter(([f]) => /\/pages\//.test(f)).map(([f]) => f),
    };
    out.chunkCount = stats.length;
  }
  return out;
}

function webReport() {
  const dotNext = path.join(ROOT, 'apps/web/.next');
  const manifestPath = path.join(dotNext, 'app-build-manifest.json');
  if (!fs.existsSync(manifestPath)) return { error: 'chưa có apps/web/.next, chạy với --build-web' };
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).pages;
  const gzCache = new Map();
  const size = (f) => {
    if (!gzCache.has(f)) {
      const p = path.join(dotNext, f);
      gzCache.set(f, fs.existsSync(p) ? { raw: fs.statSync(p).size, gz: gz(fs.readFileSync(p)) } : { raw: 0, gz: 0 });
    }
    return gzCache.get(f);
  };
  const firstLoad = (key) => {
    const files = new Set();
    // Trang + mọi layout cha (`/a/b/page` -> `/a/b/layout`, `/a/layout`, `/layout`).
    const parts = key.replace(/\/page$/, '').split('/').filter(Boolean);
    const keys = [key];
    for (let i = parts.length; i >= 0; i--) keys.push('/' + [...parts.slice(0, i), 'layout'].filter(Boolean).join('/'));
    for (const k of keys) for (const f of manifest[k] || []) if (f.endsWith('.js')) files.add(f);
    let g = 0;
    for (const f of files) g += size(f).gz;
    return { gzKB: Math.round(g / 1024), jsFiles: files.size };
  };
  const routes = Object.keys(manifest)
    .filter((k) => k.endsWith('/page') || k.endsWith('/route'))
    .filter((k) => k.endsWith('/page'))
    .map((k) => ({ route: k.replace(/\/page$/, '') || '/', ...firstLoad(k) }))
    .sort((a, b) => b.gzKB - a.gzKB);
  const shared = new Set();
  const counts = new Map();
  for (const k of Object.keys(manifest)) {
    if (!k.endsWith('/page')) continue;
    for (const f of manifest[k]) if (f.endsWith('.js')) counts.set(f, (counts.get(f) || 0) + 1);
  }
  const nPages = Object.keys(manifest).filter((k) => k.endsWith('/page')).length;
  for (const [f, n] of counts) if (n >= nPages * 0.9) shared.add(f);
  const chunks = walk(path.join(dotNext, 'static/chunks'))
    .filter((p) => p.endsWith('.js'))
    .map((p) => {
      const rel = path.relative(dotNext, p).split(path.sep).join('/');
      const s = size(rel);
      return { file: rel, rawKB: Math.round(s.raw / 1024), gzKB: Math.round(s.gz / 1024), onNearlyEveryPage: shared.has(rel) };
    })
    .sort((a, b) => b.rawKB - a.rawKB);
  const nextReported = {};
  const logPath = path.join(dotNext, 'bundle-report-next-build.log');
  if (fs.existsSync(logPath)) {
    for (const line of fs.readFileSync(logPath, 'utf8').split('\n')) {
      const m = line.match(/^[├└┌] [○ƒ●] (\S+)\s+([\d.]+ [kM]?B)\s+([\d.]+) kB/);
      if (m) nextReported[m[1]] = { routeSize: m[2], firstLoadKB: Number(m[3]) };
    }
    const sh = fs.readFileSync(logPath, 'utf8').match(/First Load JS shared by all\s+([\d.]+) kB/);
    if (sh) nextReported['(shared by all)'] = { firstLoadKB: Number(sh[1]) };
  }
  const customer = ['/', '/san-pham', '/san-pham/[slug]', '/gio-hang', '/thanh-toan', '/tai-khoan', '/tai-khoan/diem-xanh', '/uu-dai', '/vuon-xanh', '/doi-rac', '/kho-qua', '/mua-chung', '/tai-khoan/don-hang', '/dang-nhap'];
  const byRoute = Object.fromEntries(routes.map((r) => [r.route, r]));
  return {
    buildId: fs.existsSync(path.join(dotNext, 'BUILD_ID')) ? fs.readFileSync(path.join(dotNext, 'BUILD_ID'), 'utf8') : null,
    customerRoutes: customer.map((r) => ({ route: r, nextFirstLoadKB: nextReported[r]?.firstLoadKB ?? null, routeOwnSize: nextReported[r]?.routeSize ?? null, manifestGzKB: byRoute[r]?.gzKB ?? null })),
    nextSharedByAllKB: nextReported['(shared by all)']?.firstLoadKB ?? null,
    nextAllRoutes: Object.entries(nextReported).map(([route, v]) => ({ route, ...v })).sort((a, b) => b.firstLoadKB - a.firstLoadKB).slice(0, 12),
    heaviest10: routes.slice(0, 10),
    medianGzKB: routes.length ? routes.map((r) => r.gzKB).sort((a, b) => a - b)[Math.floor(routes.length / 2)] : null,
    largestChunks: chunks.slice(0, 8),
    allRoutes: routes,
  };
}

const result = { generatedAt: new Date().toISOString() };
let stats = null;
if (only !== 'web') {
  if (flag('--build-miniapp')) stats = await buildMiniappStats();
  result.miniapp = miniappReport(stats);
}
if (only !== 'miniapp') {
  if (flag('--build-web')) {
    const env = { ...process.env };
    env.NEXT_PUBLIC_API_BASE_URL ||= 'http://localhost:3251/api';
    env.API_BASE_URL ||= 'http://localhost:3251/api';
    const log = execFileSync('npx', ['next', 'build'], { cwd: path.join(ROOT, 'apps/web'), env, stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 64 * 1024 * 1024 }).toString();
    fs.writeFileSync(path.join(ROOT, 'apps/web/.next/bundle-report-next-build.log'), log);
  }
  result.web = webReport();
}
console.log(JSON.stringify(result, null, 2));
