// Lighthouse mobile (mô phỏng Moto G Power, Slow 4G, CPU x4 mặc định của Lighthouse 13) cho 3 trang công khai của web, khách chưa đăng nhập.
// Thanh toán cần đăng nhập nên chỉ đo bằng web.mjs. Mỗi trang 3 lần, trung vị.
// Dùng: node lighthouse.mjs [--runs 3] [--out file.json]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WEB_URL, loadSnapshot, median, round } from './lib.mjs';

export const LH_PAGES = [
  { key: 'home', path: '/' },
  { key: 'list', path: '/san-pham' },
  { key: 'detail', path: '/san-pham/mat-ong-rung-bhnong' },
];

function chromePath() {
  const base = path.join(os.homedir(), 'Library/Caches/ms-playwright');
  const dirs = fs.readdirSync(base).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse();
  for (const d of dirs) {
    const p = path.join(base, d, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
    if (fs.existsSync(p)) return p;
  }
  throw new Error('không thấy Chromium của Playwright');
}

export async function runLighthouse({ runs = 3 } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-'));
  const out = {};
  for (const pg of LH_PAGES) {
    const rs = [];
    const loads = [];
    for (let i = 0; i < runs; i++) {
      loads.push(loadSnapshot());
      const f = path.join(tmp, `${pg.key}-${i}.json`);
      execFileSync('npx', ['--yes', 'lighthouse@13.6.0', `${WEB_URL}${pg.path}`, '--only-categories=performance', '--form-factor=mobile', '--chrome-flags=--headless=new --no-sandbox', '--output=json', `--output-path=${f}`, '--quiet'], { env: { ...process.env, CHROME_PATH: chromePath() }, stdio: 'ignore' });
      const j = JSON.parse(fs.readFileSync(f, 'utf8'));
      const a = j.audits;
      rs.push({ score: j.categories.performance.score * 100, fcp: a['first-contentful-paint'].numericValue, lcp: a['largest-contentful-paint'].numericValue, tbt: a['total-blocking-time'].numericValue, cls: a['cumulative-layout-shift'].numericValue, si: a['speed-index'].numericValue, tti: a.interactive.numericValue, lcpEl: a['largest-contentful-paint-element']?.details?.items?.[0]?.items?.[0]?.node?.snippet?.slice(0, 80) ?? null });
    }
    const med = (k) => round(median(rs.map((r) => r[k])), 3);
    out[pg.key] = { path: pg.path, score: med('score'), fcp: med('fcp'), lcp: med('lcp'), tbt: med('tbt'), cls: med('cls'), si: med('si'), tti: med('tti'), lcpEl: rs[0].lcpEl, runs: rs.map(({ lcpEl, ...x }) => x), loadBefore: loads };
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const a = process.argv.slice(2);
  const o = (k, d) => (a.includes(k) ? a[a.indexOf(k) + 1] : d);
  const res = await runLighthouse({ runs: Number(o('--runs', 3)) });
  const txt = JSON.stringify(res, null, 2);
  if (o('--out')) fs.writeFileSync(o('--out'), txt);
  else console.log(txt);
}
