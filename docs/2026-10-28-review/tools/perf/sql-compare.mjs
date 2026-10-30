// Đếm câu SQL và chụp thân JSON của /cart và /home/me theo persona, cho một lane (không chạm lane 5).
// Dùng: node sql-compare.mjs --lane 4 --port 3249 --out <file.json> [--personas returning,new,...]
// Bật API phụ cổng --port từ apps/api/dist của worktree này (preload prisma-query-log.cjs). So trước/sau bằng `--diff a.json b.json`.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WT = path.resolve(HERE, '../../../..');
const H = path.join(WT, 'docs/2026-10-20-uat/tools/uat-harness');
const a = process.argv.slice(2);
const opt = (k, d) => (a.includes(k) ? a[a.indexOf(k) + 1] : d);

if (a.includes('--diff')) {
  const [x, y] = [a[a.indexOf('--diff') + 1], a[a.indexOf('--diff') + 2]].map((f) => JSON.parse(fs.readFileSync(f, 'utf8')));
  let bad = 0;
  for (const k of Object.keys(x)) {
    const same = JSON.stringify(x[k].body) === JSON.stringify(y[k]?.body) && x[k].status === y[k]?.status;
    console.log(`${same ? 'GIỐNG ' : 'KHÁC  '} ${k}  sql ${x[k].second.sql} -> ${y[k]?.second.sql}  (lần 1: ${x[k].first.sql} -> ${y[k]?.first.sql})`);
    if (!same) bad++;
  }
  process.exit(bad ? 1 : 0);
}

const laneN = opt('--lane', '4');
const port = Number(opt('--port', '3249'));
const out = opt('--out');
const personas = opt('--personas', 'returning,new,new_nophone').split(',');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const up = (p) => new Promise((res) => { const s = net.connect(p, '127.0.0.1'); s.on('connect', () => { s.destroy(); res(true); }); s.on('error', () => res(false)); });
const envf = fs.readFileSync(path.join(H, `state/lane-${laneN}/lane.env`), 'utf8');
const env = {};
for (const l of envf.split('\n')) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2]; }
const logFile = path.join(H, `state/perf-api-sql-l${laneN}-probe.log`);
fs.writeFileSync(logFile, '');
const fd = fs.openSync(logFile, 'a');
const child = spawn(process.execPath, ['-r', path.join(HERE, 'prisma-query-log.cjs'), 'dist/main.js'], {
  cwd: path.join(WT, 'apps/api'),
  env: { ...process.env, ...env, PORT: String(port), PERF_SQL_LOG: logFile, PERF_API_DIR: path.join(WT, 'apps/api'), NODE_ENV: 'development' },
  stdio: ['ignore', fd, fd],
});
const tokens = {};
for (const p of personas) {
  const r = await new Promise((res) => { const c = spawn(process.execPath, [path.join(H, 'mint-token.mjs'), laneN, p]); let o = ''; c.stdout.on('data', (d) => (o += d)); c.on('close', () => res(o.trim())); });
  tokens[p] = r;
}
const result = {};
try {
  for (let i = 0; i < 90 && !(await up(port)); i++) await sleep(500);
  await sleep(3000);
  for (const p of personas) {
    for (const ep of ['/cart', '/home/me?purchasedLimit=10']) {
      const key = `${p} ${ep}`;
      result[key] = {};
      for (const pass of ['first', 'second']) {
        await sleep(1500);
        const before = fs.statSync(logFile).size;
        const r = await fetch(`http://localhost:${port}/api${ep}`, { headers: { authorization: `Bearer ${tokens[p]}`, 'x-throttle-bypass': env.THROTTLE_BYPASS_TOKEN ?? '' } });
        const txt0 = await r.text();
        await sleep(700);
        const q = fs.readFileSync(logFile, 'utf8').slice(before).split('\n').filter((l) => l.startsWith('Q ')).map((l) => l.slice(2));
        const real = q.filter((s) => !/^(BEGIN|COMMIT|ROLLBACK|SET )/i.test(s));
        result[key][pass] = { sql: real.length, write: real.filter((s) => /^(INSERT|UPDATE|DELETE)/i.test(s)).length };
        result[key].status = r.status;
        try { result[key].body = JSON.parse(txt0); } catch { result[key].body = txt0.slice(0, 200); }
        if (pass === 'second') result[key].sample = real.map((s) => s.slice(0, 140));
      }
    }
  }
} finally {
  child.kill('SIGTERM');
}
fs.writeFileSync(out, JSON.stringify(result, null, 2));
for (const [k, v] of Object.entries(result)) console.log(k, v.status, 'lần1', v.first.sql, 'lần2', v.second.sql, 'ghi', v.second.write);
