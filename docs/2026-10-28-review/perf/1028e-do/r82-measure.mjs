// R-82: đếm SQL /cart (lần 2) qua API phụ 3966 + autocannon 50 kết nối 20 s trên API lane 3. Dùng: node r82-measure.mjs <nhãn>
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
const WT = '/Users/longla/coding/tubutree-mini-app/.claude/worktrees/r1028e-do';
const label = process.argv[2] || 'run';
const D = new URL('.', import.meta.url).pathname;
const h = await import(WT + '/docs/2026-10-20-uat/tools/uat-harness/lib.mjs');
const L = h.lane(3);
const envf = fs.readFileSync(WT + '/docs/2026-10-20-uat/tools/uat-harness/state/lane-3/lane.env', 'utf8');
const envObj = Object.fromEntries(envf.split('\n').filter((l) => /^[A-Z_0-9]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const token = (await h.mintAccessFor(L, 'returning', 3600)).token;
const bypass = envObj.THROTTLE_BYPASS_TOKEN;
const hdr = { 'x-throttle-bypass': bypass, authorization: `Bearer ${token}` };
const log = D + `r82-${label}-sql.log`;
fs.writeFileSync(log, '');
const fd = fs.openSync(log, 'a');
const child = spawn(process.execPath, ['-r', WT + '/docs/2026-10-28-review/tools/perf/prisma-query-log.cjs', 'dist/main.js'], { cwd: WT + '/apps/api', env: { ...process.env, ...envObj, PORT: '3966', PERF_SQL_LOG: log, PERF_API_DIR: WT + '/apps/api', NODE_ENV: 'development' }, stdio: ['ignore', fd, fd], detached: true });
child.unref();
for (let i = 0; i < 120; i++) { try { await fetch('http://localhost:3966/api/config/public'); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }
await new Promise((r) => setTimeout(r, 3000));
const res = {};
for (const pass of ['first', 'second']) {
  await new Promise((r) => setTimeout(r, 1500));
  const before = fs.statSync(log).size;
  const r = await fetch('http://localhost:3966/api/cart', { headers: hdr });
  const body = await r.text();
  await new Promise((r) => setTimeout(r, 800));
  const q = fs.readFileSync(log, 'utf8').slice(before).split('\n').filter((l) => l.startsWith('Q ')).map((l) => l.slice(2)).filter((s) => !/^(BEGIN|COMMIT|ROLLBACK|SET )/i.test(s));
  res[pass] = { status: r.status, sql: q.length, select: q.filter((s) => /^SELECT/i.test(s)).length, write: q.filter((s) => /^(INSERT|UPDATE|DELETE)/i.test(s)).length, stmts: q.map((s) => s.slice(0, 140)) };
  if (pass === 'second') fs.writeFileSync(D + `r82-${label}-body.json`, body);
}
try { process.kill(-child.pid); } catch {}
console.log(JSON.stringify({ first: res.first.sql, second: res.second.sql, select: res.second.select, write: res.second.write }));
fs.writeFileSync(D + `r82-${label}-sql.json`, JSON.stringify(res, null, 1));
if (process.env.SKIP_LOAD) process.exit(0);
const out = execFileSync('npx', ['--yes', 'autocannon@8.0.0', '-c', '50', '-d', '20', '-j', '-H', `x-throttle-bypass: ${bypass}`, '-H', `authorization: Bearer ${token}`, 'http://localhost:3231/api/cart'], { maxBuffer: 1e8 }).toString();
const j = JSON.parse(out);
const sum = { reqPerSec: j.requests.average, p50: j.latency.p50, p90: j.latency.p90, p97_5: j.latency.p97_5, p99: j.latency.p99, non2xx: j.non2xx, errors: j.errors };
console.log(JSON.stringify(sum));
fs.writeFileSync(D + `r82-${label}-load.json`, JSON.stringify(sum, null, 1));
