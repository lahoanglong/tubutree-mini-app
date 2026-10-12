// Đọc pg-statements.raw (log_statement=all của DB tubutree_perf khi gọi capture), gom các SELECT
// theo thứ tự, chạy EXPLAIN (ANALYZE, BUFFERS) (trong transaction ROLLBACK, chỉ SELECT) và ghi tóm tắt.
const fs = require('fs');
const { Client } = require('pg');
const { pgConf } = require('./lib.cjs');
const raw = fs.readFileSync(__dirname + '/results/pg-statements.raw', 'utf8').split(/\r?\n/);
const stmts = [];
let cur = null;
for (const line of raw) {
  let m = line.match(/^\d{4}-\d\d-\d\d [\d:.]+ UTC \[\d+\] (LOG|DETAIL|ERROR|STATEMENT):\s+(.*)$/);
  if (m) {
    const [, kind, body] = m;
    if (kind === 'LOG') {
      const e = body.match(/^(?:execute [^:]*|statement): (.*)$/);
      cur = e ? { sql: e[1], params: null } : null;
      if (cur) stmts.push(cur);
    } else if (kind === 'DETAIL' && cur && /^parameters:/.test(body)) {
      cur.params = body.replace(/^parameters:\s*/, '');
    } else cur = null;
  } else if (cur && !cur.params) cur.sql += '\n' + line;
}
function bind(s) {
  if (!s.params) return s.sql;
  const vals = {};
  const re = /\$(\d+) = ('(?:[^']|'')*'|NULL)/g;
  let m;
  while ((m = re.exec(s.params))) vals[m[1]] = m[2];
  return s.sql.replace(/\$(\d+)/g, (_, n) => (vals[n] !== undefined ? vals[n] : '$' + n));
}
(async () => {
  const c = new Client(pgConf());
  await c.connect();
  const out = [];
  let i = 0;
  const seen = new Set();
  for (const s of stmts) {
    const sql = bind(s);
    if (!/^\s*(SELECT|WITH)/i.test(sql)) continue;
    if (/^SELECT 1$/.test(sql.trim())) continue;
    i++;
    const shape = sql.replace(/'[^']*'/g, '?').replace(/\d+/g, 'N').slice(0, 300);
    const key = shape;
    try {
      await c.query('BEGIN');
      const r = await c.query('EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ' + sql);
      await c.query('ROLLBACK');
      const plan = r.rows.map((x) => x['QUERY PLAN']).join('\n');
      const exec = (plan.match(/Execution Time: ([\d.]+) ms/) || [])[1];
      const plan_t = (plan.match(/Planning Time: ([\d.]+) ms/) || [])[1];
      out.push({ n: i, exec, plan_t, sql: sql.replace(/\s+/g, ' ').slice(0, 900), plan, dup: seen.has(key) });
      seen.add(key);
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      out.push({ n: i, err: e.message, sql: sql.slice(0, 300) });
    }
  }
  fs.writeFileSync(__dirname + '/results/explain-all.json', JSON.stringify(out, null, 1));
  for (const o of out) console.log(o.n, o.err ? 'ERR ' + o.err : (o.exec + 'ms plan ' + o.plan_t + 'ms'), '|', o.sql.slice(0, 160).replace(/"public"\."[a-zA-Z_]+"\./g, ''));
  await c.end();
})();
