#!/usr/bin/env node
// Chạy toàn bộ phép đo hiệu năng runtime, ghi MỘT file JSON. Mỗi gói sửa chạy lại để so với perf/baseline.json.
//   export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH
//   node docs/2026-10-28-review/tools/perf/run-all.mjs --out docs/2026-10-28-review/perf/after-<gói>.json
// Tuỳ chọn: --build-web (build lại web trước khi đo; dùng khi mã apps/web đã đổi)  --runs 3 (số lần mỗi số đo)  --duration 20 (giây autocannon)  --only web,lh,mini,api  --label <chữ>
// Điều kiện: lane 5 đang chạy (API 3251, Postgres 25432, Redis 26379). Script tự bật (và tự dừng) web `next start` 3601 và
// máy chủ tĩnh Mini App 3603 nếu chưa có; API phụ 3611 chỉ bật trong lúc đếm SQL.
// Bản build: web dùng apps/web/.next (nếu thiếu thì build với API lane 5); Mini App build riêng (VITE_API_BASE_URL=lane 5, --mode perf)
// vào uat-harness/state/perf-mini-www, build lại mỗi lần chạy (--no-build-mini để bỏ qua) vì gói sửa đổi mã.
// KHÔNG gọi PROD: bản build Mini App của repo trỏ api.tubutree.com nên không dùng.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { H, MINI_WWW, PORTS, WT, ensureServer, killPort, laneEnvVal, loadSnapshot, portUp } from './lib.mjs';
import { runWeb } from './web.mjs';
import { runMini } from './mini.mjs';
import { runApiLoad, runSqlCount } from './api.mjs';
import { runLighthouse } from './lighthouse.mjs';

const a = process.argv.slice(2);
const o = (k, d) => (a.includes(k) ? a[a.indexOf(k) + 1] : d);
const runs = Number(o('--runs', 3));
const only = new Set(String(o('--only', 'web,lh,mini,api')).split(','));
const outFile = o('--out');
const stops = [];
const log = (m) => console.error(`[perf ${new Date().toISOString().slice(11, 19)}] ${m}`);

if (!(await portUp(3251))) throw new Error('API lane 5 (3251) không chạy: $H/lane-up.sh 5 --web');
const NODE = process.execPath;
const git = (...x) => execFileSync('git', x, { cwd: WT, encoding: 'utf8' }).trim();

const result = { meta: { date: new Date().toISOString(), label: o('--label', ''), branch: git('rev-parse', '--abbrev-ref', 'HEAD'), commit: git('rev-parse', '--short', 'HEAD'), dirty: git('status', '--short', 'apps', 'packages').split('\n').filter(Boolean).length, lane: 5, runsPerMetric: runs, emulation: { web: 'Moto G 360x640, Slow 4G 1,6 Mbps/150 ms, CPU x4', mini: '375x812, Slow 4G 1,6 Mbps/150 ms, CPU x4, gzip', api: 'autocannon 10 kết nối', durationSec: Number(o('--duration', 20)) }, loadAtStart: loadSnapshot(), node: process.version } };

try {
  if (only.has('web') || only.has('lh')) {
    if (a.includes('--build-web') || !fs.existsSync(path.join(WT, 'apps/web/.next/BUILD_ID'))) {
      log('build web với API lane 5');
      killPort(PORTS.web);
      execFileSync('npx', ['next', 'build'], { cwd: path.join(WT, 'apps/web'), stdio: 'inherit', env: { ...process.env, NEXT_PUBLIC_API_BASE_URL: 'http://localhost:3251/api', API_BASE_URL: 'http://localhost:3251/api' } });
    }
    const s = await ensureServer('web', PORTS.web, NODE, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(PORTS.web)], { cwd: path.join(WT, 'apps/web'), env: { ...process.env, NEXT_PUBLIC_API_BASE_URL: 'http://localhost:3251/api', API_BASE_URL: 'http://localhost:3251/api', THROTTLE_BYPASS_TOKEN: laneEnvVal('THROTTLE_BYPASS_TOKEN'), NEXT_TELEMETRY_DISABLED: '1' } });
    stops.push(s.stop);
  }
  if (only.has('mini')) {
    if (!a.includes('--no-build-mini') || !fs.existsSync(path.join(MINI_WWW, 'index.html'))) {
      log('build Mini App (API lane 5)');
      execFileSync('npx', ['vite', 'build', '--mode', 'perf', '--outDir', MINI_WWW, '--emptyOutDir'], { cwd: path.join(WT, 'apps/miniapp'), stdio: 'ignore', env: { ...process.env, VITE_API_BASE_URL: 'http://localhost:3251/api' } });
    }
    const s = await ensureServer('mini', PORTS.mini, NODE, [path.join(path.dirname(new URL(import.meta.url).pathname), 'mini-static.mjs'), MINI_WWW, String(PORTS.mini)], { cwd: WT });
    stops.push(s.stop);
  }
  if (only.has('web')) { log('web'); result.web = await runWeb({ runs }); }
  if (only.has('lh')) { log('lighthouse'); result.lighthouse = await runLighthouse({ runs }); }
  if (only.has('mini')) { log('mini'); result.mini = await runMini({ runs }); }
  if (only.has('api')) {
    log('api sql'); result.apiSql = await runSqlCount();
    log('api load'); result.apiLoad = await runApiLoad({ runs, duration: Number(o('--duration', 20)) });
  }
  result.meta.loadAtEnd = loadSnapshot();
} finally {
  for (const s of stops) s();
}

const txt = JSON.stringify(result, null, 2);
if (outFile) { fs.writeFileSync(outFile, txt); log(`đã ghi ${outFile}`); } else console.log(txt);
