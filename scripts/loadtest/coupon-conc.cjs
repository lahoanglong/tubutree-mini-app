// /me/coupons với 100k coupon: 8 request song song x 3 vòng (đo độ trễ khi đồng thời).
const { tokenFor } = require('./lib.cjs');
(async () => {
  for (let round = 0; round < 3; round++) {
    const t0 = Date.now();
    const lat = await Promise.all(Array.from({ length: 8 }, async (_, i) => {
      const s = Date.now();
      const r = await fetch('http://127.0.0.1:3301/api/me/coupons', { headers: { ...(process.env.PERF_BYPASS ? { 'x-throttle-bypass': process.env.PERF_BYPASS } : {}), Authorization: 'Bearer ' + tokenFor('perf_u_' + (10010 + i)), 'X-Forwarded-For': '10.77.' + round + '.' + i } });
      await r.text();
      return [r.status, Date.now() - s];
    }));
    console.log('vòng', round + 1, 'wall', Date.now() - t0 + 'ms', JSON.stringify(lat));
  }
})();
