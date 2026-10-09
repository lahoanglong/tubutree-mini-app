// So sánh client: http.Agent (keepAlive) vs fetch/undici với 16 request song song/vòng tới các endpoint Home thật (có token).
const http = require('http');
const { tokenFor } = require('./lib.cjs');
const t = tokenFor('perf_u_10005');
const paths = ['/products?limit=6&sort=best_seller', '/products?limit=12', '/products?limit=6&sort=newest', '/products/for-you', '/cart', '/orders/active-count', '/flash-sales/upcoming', '/flash-sales/active', '/me', '/me/notifications', '/me/purchased-items', '/brands', '/me/subscriptions', '/categories', '/me/wishlist/ids', '/orders?page=1&limit=1'];
let ip = 8000000;
const mode = process.argv[2] || 'http';
const agent = new http.Agent({ keepAlive: true, maxSockets: 64 });
function viaHttp(p) {
  return new Promise((res) => {
    const x = ip++;
    const r = http.request({ host: '127.0.0.1', port: 3301, path: '/api' + p, agent, headers: { Authorization: 'Bearer ' + t, 'X-Forwarded-For': `10.${(x >> 16) & 255}.${(x >> 8) & 255}.${x & 255}` } }, (resp) => { resp.resume(); resp.on('end', () => res(resp.statusCode)); });
    r.on('error', (e) => res(e.code || 'err')); r.end();
  });
}
function viaFetch(p) {
  const x = ip++;
  return fetch('http://127.0.0.1:3301/api' + p, { headers: { Authorization: 'Bearer ' + t, 'X-Forwarded-For': `10.${(x >> 16) & 255}.${(x >> 8) & 255}.${x & 255}` } }).then(async (r) => { await r.text(); return r.status; }, (e) => (e.cause && e.cause.code) || 'err');
}
(async () => {
  const stats = {}; const end = Date.now() + 15000; let loops = 0;
  const vu = async () => { while (Date.now() < end) { const rs = await Promise.all(paths.map(mode === 'http' ? viaHttp : viaFetch)); loops++; rs.forEach((s) => (stats[s] = (stats[s] || 0) + 1)); } };
  await Promise.all(Array.from({ length: 4 }, vu));
  console.log(mode, 'homes:', loops, JSON.stringify(stats));
})();
