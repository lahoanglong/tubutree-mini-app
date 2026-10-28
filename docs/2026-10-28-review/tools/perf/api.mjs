// Đo API lane 5 (3251): autocannon (10 kết nối, 20 s, 3 lần, trung vị) + đếm câu SQL mỗi request qua API phụ cổng 3611.
// autocannon chỉ trả p50, p90, p97.5, p99 (không có p95): ghi p97.5 làm cận trên của p95.
// Dùng: node api.mjs [--runs 3] [--duration 20] [--out file.json] [--skip-load] [--skip-sql]
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { API, H, HERE, LANE_N, PORTS, WT, killPort, laneEnvVal, lib, loadSnapshot, median, portUp, round, sleep } from './lib.mjs';

const PRODUCT_SLUG = 'mat-ong-rung-bhnong';
export const API_ENDPOINTS = [
  { key: 'home', path: '/home', note: 'Mini App mở trang chủ (khách và returning)' },
  { key: 'products_list', path: '/products?limit=12' },
  { key: 'products_best_seller', path: '/products?sort=best_seller&limit=12', note: 'kệ Bán chạy của trang chủ' },
  { key: 'product_detail', path: `/products/${PRODUCT_SLUG}` },
  { key: 'config_public', path: '/config/public' },
  { key: 'home_me', path: '/home/me?purchasedLimit=10', auth: 'returning', note: 'phần cá nhân của trang chủ (token returning)' },
  { key: 'me', path: '/me', auth: 'returning' },
  { key: 'cart', path: '/cart', auth: 'returning' },
];

function autocannon(url, headers, duration) {
  const args = ['--yes', 'autocannon@8.0.0', '-c', '10', '-d', String(duration), '-j', ...Object.entries(headers).flatMap(([k, v]) => ['-H', `${k}: ${v}`]), url];
  const out = execFileSync('npx', args, { encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] });
  const j = JSON.parse(out);
  return { p50: j.latency.p50, p90: j.latency.p90, p97_5: j.latency.p97_5, p99: j.latency.p99, avg: j.latency.average, max: j.latency.max, rps: j.requests.average, non2xx: j.non2xx, errors: j.errors, timeouts: j.timeouts, total: j.requests.total };
}

export async function runApiLoad({ runs = 3, duration = 20 } = {}) {
  const h = await lib();
  const L = h.lane(LANE_N);
  const token = (await h.mintAccessFor(L, 'returning', 4 * 3600)).token;
  await h.closePrisma?.();
  const bypass = laneEnvVal('THROTTLE_BYPASS_TOKEN');
  const out = {};
  for (const ep of API_ENDPOINTS) {
    const headers = { 'x-throttle-bypass': bypass, ...(ep.auth ? { authorization: `Bearer ${token}` } : {}) };
    const rs = [];
    const loads = [];
    for (let i = 0; i < runs; i++) {
      loads.push(loadSnapshot());
      rs.push(autocannon(`${API}${ep.path}`, headers, duration));
    }
    const med = (k) => round(median(rs.map((r) => r[k])), 2);
    out[ep.key] = { path: ep.path, note: ep.note, p50: med('p50'), p90: med('p90'), p97_5: med('p97_5'), p99: med('p99'), avg: med('avg'), max: med('max'), rps: med('rps'), non2xx: rs.reduce((s, r) => s + r.non2xx, 0), errors: rs.reduce((s, r) => s + r.errors, 0), runs: rs, loadBefore: loads };
  }
  return out;
}

function parseEnvFile(file) {
  const env = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

/** Bật API phụ 3611 cùng DB/Redis lane 5 với preload prisma-query-log.cjs (bọc PrismaClient, ghi mỗi câu SQL), gọi từng endpoint hai lần. */
export async function runSqlCount() {
  const h = await lib();
  const L = h.lane(LANE_N);
  const token = (await h.mintAccessFor(L, 'returning', 3600)).token;
  await h.closePrisma?.();
  const logFile = path.join(H, 'state/perf-api-sql.log');
  fs.writeFileSync(logFile, '');
  const fd = fs.openSync(logFile, 'a');
  const env = { ...process.env, ...parseEnvFile(path.join(H, 'state/lane-5/lane.env')), PORT: String(PORTS.apiSql), PERF_SQL_LOG: logFile, PERF_API_DIR: path.join(WT, 'apps/api'), NODE_ENV: 'development' };
  const child = spawn(process.execPath, ['-r', path.join(HERE, 'prisma-query-log.cjs'), 'dist/main.js'], { cwd: path.join(WT, 'apps/api'), env, stdio: ['ignore', fd, fd], detached: true });
  child.unref();
  try {
    for (let i = 0; i < 90 && !(await portUp(PORTS.apiSql)); i++) await sleep(500);
    if (!(await portUp(PORTS.apiSql))) throw new Error('API phụ 3611 không lên');
    await sleep(3000);
    const base = `http://localhost:${PORTS.apiSql}/api`;
    const headers = { 'x-throttle-bypass': laneEnvVal('THROTTLE_BYPASS_TOKEN') };
    const res = {};
    for (const ep of API_ENDPOINTS) {
      const hh = { ...headers, ...(ep.auth ? { authorization: `Bearer ${token}` } : {}) };
      res[ep.key] = { path: ep.path };
      for (const pass of ['first', 'second']) {
        await sleep(1500); // chờ cron/nền lặng
        const before = fs.statSync(logFile).size;
        const r = await fetch(base + ep.path, { headers: hh });
        await r.arrayBuffer();
        await sleep(700);
        const txt = fs.readFileSync(logFile, 'utf8').slice(before);
        const q = txt.split('\n').filter((l) => l.startsWith('Q ')).map((l) => l.slice(2));
        const real = q.filter((s) => !/^(BEGIN|COMMIT|ROLLBACK|SET )/i.test(s));
        res[ep.key][pass] = { status: r.status, sql: real.length, sqlWithTx: q.length, select: real.filter((s) => /^SELECT/i.test(s)).length, write: real.filter((s) => /^(INSERT|UPDATE|DELETE)/i.test(s)).length };
        if (pass === 'first') res[ep.key].sample = real.slice(0, 40).map((s) => s.replace(/\s+/g, ' ').slice(0, 160));
      }
    }
    return res;
  } finally {
    killPort(PORTS.apiSql);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const a = process.argv.slice(2);
  const o = (k, d) => (a.includes(k) ? a[a.indexOf(k) + 1] : d);
  const res = {};
  if (!a.includes('--skip-sql')) res.sql = await runSqlCount();
  if (!a.includes('--skip-load')) res.load = await runApiLoad({ runs: Number(o('--runs', 3)), duration: Number(o('--duration', 20)) });
  const txt = JSON.stringify(res, null, 2);
  if (o('--out')) fs.writeFileSync(o('--out'), txt);
  else console.log(txt);
}
