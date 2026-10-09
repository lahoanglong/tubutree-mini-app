// Mô phỏng bot/khách mở 120 trang SP khác nhau trong ~vài giây trên web (next start, bản build thật).
// SSR của web gọi API từ cùng 1 IP → ThrottlerGuard 60 req/phút/IP có thể trả 429 → getProduct() ra null → trang 404?
const { Client } = require('pg'); const { pgConf } = require('./lib.cjs');
(async () => {
  const c = new Client(pgConf()); await c.connect();
  const slugs = (await c.query(`SELECT slug FROM products WHERE "isActive" AND "approvalStatus"='APPROVED' AND id LIKE 'perf_p_%' ORDER BY id DESC LIMIT 120`)).rows.map((r) => r.slug);
  await c.end();
  const st = {}; const t0 = Date.now(); const bad = [];
  for (const s of slugs) {
    const r = await fetch('http://localhost:3398/san-pham/' + s); await r.text();
    st[r.status] = (st[r.status] || 0) + 1; if (r.status !== 200) bad.push(s);
  }
  console.log(JSON.stringify({ pages: slugs.length, statuses: st, seconds: (Date.now() - t0) / 1000 }));
  await new Promise((r) => setTimeout(r, 1000));
  const again = await fetch('http://localhost:3398/san-pham/' + (bad[0] || slugs[0])); await again.text();
  console.log('mở lại 1 trang đã lỗi:', again.status, bad.slice(0, 3));
})();
