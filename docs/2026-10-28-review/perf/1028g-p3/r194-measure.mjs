// R-194: đếm SQL GET /home/me (lần 2, ấm) qua API phụ 3946 cho khách có đơn SHIPPING (new) và không có (returning). Dùng: node r194-measure.mjs <nhãn>
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const WT = '/Users/longla/coding/tubutree-mini-app/.claude/worktrees/r1028g-p3';
const label = process.argv[2] || 'run';
const D = new URL('.', import.meta.url).pathname;
const h = await import(WT + '/docs/2026-10-20-uat/tools/uat-harness/lib.mjs');
const L = h.lane(1);
const envf = fs.readFileSync(WT + '/docs/2026-10-20-uat/tools/uat-harness/state/lane-1/lane.env', 'utf8');
const envObj = Object.fromEntries(envf.split('\n').filter((l) => /^[A-Z_0-9]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const log = D + `r194-${label}-sql.log`;
fs.writeFileSync(log, '');
const fd = fs.openSync(log, 'a');
const child = spawn(process.execPath, ['-r', WT + '/docs/2026-10-28-review/tools/perf/prisma-query-log.cjs', 'dist/main.js'], { cwd: WT + '/apps/api', env: { ...process.env, ...envObj, PORT: '3946', PERF_SQL_LOG: log, PERF_API_DIR: WT + '/apps/api', NODE_ENV: 'development' }, stdio: ['ignore', fd, fd], detached: true });
child.unref();
for (let i = 0; i < 120; i++) { try { await fetch('http://localhost:3946/api/config/public'); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }
await new Promise((r) => setTimeout(r, 3000));
const res = {};
for (const [who, key] of [['shipping', 'new'], ['noShipping', 'returning']]) {
  const token = (await h.mintAccessFor(L, key, 3600)).token;
  const hdr = { 'x-throttle-bypass': envObj.THROTTLE_BYPASS_TOKEN, authorization: `Bearer ${token}` };
  for (const pass of ['first', 'second']) {
    await new Promise((r) => setTimeout(r, 1500));
    const before = fs.statSync(log).size;
    const r = await fetch('http://localhost:3946/api/home/me', { headers: hdr });
    const body = await r.json();
    await new Promise((r) => setTimeout(r, 800));
    const q = fs.readFileSync(log, 'utf8').slice(before).split('\n').filter((l) => l.startsWith('Q ')).map((l) => l.slice(2)).filter((s) => !/^(BEGIN|COMMIT|ROLLBACK|SET )/i.test(s));
    res[`${who}-${pass}`] = { status: r.status, sql: q.length, hasShippingKey: 'shippingOrders' in body, orderSelects: q.filter((s) => /FROM "?(public"\."|)?"?orders/i.test(s)).length, stmts: q.map((s) => s.slice(0, 140)) };
  }
}
try { process.kill(-child.pid); } catch {}
console.log(JSON.stringify(Object.fromEntries(Object.entries(res).map(([k, v]) => [k, { status: v.status, sql: v.sql, orderSelects: v.orderSelects, hasShippingKey: v.hasShippingKey }]))));
fs.writeFileSync(D + `r194-${label}-sql.json`, JSON.stringify(res, null, 1));
