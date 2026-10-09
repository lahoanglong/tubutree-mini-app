// Đo ngưỡng 429: 1 IP (X-Forwarded-For cố định) gửi liên tiếp request tới /products — Throttler toàn cục 60 req/phút/IP.
const ip = '10.200.0.1';
(async () => {
  let ok = 0, thr = 0, firstThr = -1;
  for (let i = 1; i <= 80; i++) {
    const r = await fetch('http://localhost:3301/api/products?limit=1', { headers: { 'X-Forwarded-For': ip } });
    if (r.status === 429) { thr++; if (firstThr < 0) firstThr = i; } else if (r.status === 200) ok++;
  }
  console.log(JSON.stringify({ ok, throttled: thr, firstThrottledAtRequest: firstThr }));
})();
