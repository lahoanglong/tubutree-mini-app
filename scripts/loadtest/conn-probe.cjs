// Chẩn đoán ECONNRESET: bắn N request song song tới /categories (rẻ nhất, có cache) nhiều vòng, đếm lỗi.
const N = Number(process.argv[2] || 128), ROUNDS = Number(process.argv[3] || 20);
let ip = 7000000, fail = 0, ok = 0, codes = {};
(async () => {
  for (let r = 0; r < ROUNDS; r++) {
    await Promise.all(Array.from({ length: N }, async () => {
      try { const x = await fetch('http://localhost:3301/api/categories', { headers: { 'X-Forwarded-For': '10.' + ((++ip >> 16) & 255) + '.' + ((ip >> 8) & 255) + '.' + (ip & 255) } }); await x.text(); ok++; }
      catch (e) { fail++; const c = (e.cause && (e.cause.code || e.cause.message)) || e.message; codes[c] = (codes[c] || 0) + 1; }
    }));
  }
  console.log(JSON.stringify({ parallel: N, rounds: ROUNDS, ok, fail, codes }));
})();
