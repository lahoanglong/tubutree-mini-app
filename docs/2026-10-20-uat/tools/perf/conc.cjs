// Tải đồng thời nhẹ lên API 3229: mỗi "khách ảo" mở Trang chủ (GET /home song song GET /home/me) liên tục trong SEC giây.
//   DATABASE_URL=...tubutree_perf JWT_ACCESS_SECRET=... node conc.cjs <nhãn> [C1,C2,...] [giây]
// Mỗi vòng dùng token của một khách bulk khác nhau (throttle đếm theo userId). Ghi perf-data/conc-<nhãn>.json.
const path = require('path'); const crypto = require('crypto'); const fs = require('fs');
const SECRET = process.env.JWT_ACCESS_SECRET; const BASE = 'http://127.0.0.1:3229/api';
if (!/3229/.test(BASE)) throw new Error('chỉ API 3229');
const label = process.argv[2] || 'run'; const levels = (process.argv[3] || '1,8,32').split(',').map(Number); const SEC = Number(process.argv[4] || 6);
const b64 = (x) => Buffer.from(x).toString('base64url');
const sign = (sub) => { const now = Math.floor(Date.now() / 1000); const h = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' })); const d = b64(JSON.stringify({ sub, role: 'CUSTOMER', zaloId: 'z-' + sub, iat: now, exp: now + 3000 })); return `${h}.${d}.${crypto.createHmac('sha256', SECRET).update(`${h}.${d}`).digest('base64url')}`; };
const tokens = Array.from({ length: 400 }, (_, i) => sign('perf-ub-' + (i + 1)));
const pct = (a, q) => a.length ? a[Math.min(a.length - 1, Math.floor(a.length * q))] : null;
(async () => {
  const res = [];
  for (const C of levels) {
    const lat = []; const latMe = []; let err = 0, r429 = 0, n = 0; let ip = 1 + Math.floor(Math.random() * 50000); let ti = 0;
    const end = Date.now() + SEC * 1000;
    const worker = async () => {
      while (Date.now() < end) {
        const tok = tokens[ti++ % tokens.length]; const h = { authorization: `Bearer ${tok}`, 'x-forwarded-for': `10.6.${(ip >> 8) & 255}.${ip++ & 255}` };
        const t0 = performance.now();
        const [a, b] = await Promise.all([fetch(BASE + '/home', { headers: h }), fetch(BASE + '/home/me', { headers: h })].map((p) => p.then(async (r) => { const t = performance.now(); await r.arrayBuffer(); return { s: r.status, t: t - t0 }; }, () => ({ s: 0, t: 0 }))));
        n++; for (const x of [a, b]) { if (x.s === 429) r429++; else if (x.s !== 200) err++; }
        lat.push(Math.max(a.t, b.t)); latMe.push(b.t);
      }
    };
    await Promise.all(Array.from({ length: C }, worker));
    lat.sort((x, y) => x - y); latMe.sort((x, y) => x - y);
    const r = { C, opens: n, opensPerSec: +(n / SEC).toFixed(1), p50: +pct(lat, 0.5).toFixed(1), p95: +pct(lat, 0.95).toFixed(1), p99: +pct(lat, 0.99).toFixed(1), meP50: +pct(latMe, 0.5).toFixed(1), err, r429 };
    res.push(r); console.log(JSON.stringify(r));
    await new Promise((r2) => setTimeout(r2, 1500));
  }
  fs.writeFileSync(path.resolve(__dirname, `../../perf-data/conc-${label}.json`), JSON.stringify({ label, sec: SEC, res }, null, 1));
})();
