// Đo GET /me/coupons ở N request song song (C-012). Dùng: PERF_PORT=3302 node coupons-me.cjs [concurrency] [perVu]
// Chỉ chạy với API riêng trỏ DB tubutree_perf (cổng khác 3000/3001).
const { tokenFor } = require('./lib.cjs');
const PORT = process.env.PERF_PORT || '3302';
if (['3000', '3001'].includes(PORT)) throw new Error('TỪ CHỐI: không đo vào cổng dev/prod ' + PORT);
const BASE = `http://127.0.0.1:${PORT}/api`;
const CONC = +(process.argv[2] || 8);
const PER = +(process.argv[3] || 40);
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };
const hit = async (userId, n) => {
  const s = performance.now();
  const r = await fetch(BASE + '/me/coupons', { headers: { Authorization: 'Bearer ' + tokenFor(userId), 'X-Forwarded-For': `10.77.${(n >> 8) & 255}.${n & 255}` } });
  const body = await r.text();
  return { ms: performance.now() - s, status: r.status, len: body.length };
};
(async () => {
  let n = Math.floor(Math.random() * 30000);
  for (let i = 0; i < 5; i++) await hit('perf_u_10004', n++);
  const seq = [];
  for (let i = 0; i < 20; i++) seq.push((await hit('perf_u_' + (10000 + (i % 50)), n++)).ms);
  const par = []; let bad = 0; let len = 0;
  const t0 = performance.now();
  await Promise.all(Array.from({ length: CONC }, async (_, v) => {
    for (let i = 0; i < PER; i++) {
      const r = await hit('perf_u_' + (10000 + ((v * 7 + i) % 50)), n++);
      par.push(r.ms); len = r.len; if (r.status !== 200) bad++;
    }
  }));
  const wall = (performance.now() - t0) / 1000;
  const f = (x) => x.toFixed(1);
  console.log(`port=${PORT} sequential(20): p50=${f(pct(seq, 50))}ms p95=${f(pct(seq, 95))}ms`);
  console.log(`port=${PORT} parallel x${CONC} (${par.length} req, ${f(par.length / wall)} rps): p50=${f(pct(par, 50))}ms p95=${f(pct(par, 95))}ms p99=${f(pct(par, 99))}ms max=${f(Math.max(...par))}ms non200=${bad} lastBodyBytes=${len}`);
})();
