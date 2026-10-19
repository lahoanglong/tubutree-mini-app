// Đếm truy vấn SQL của POST /cart/items, quote và place-order (COD) theo số dòng giỏ K. Ghi DB tubutree_perf.
//   DATABASE_URL=...tubutree_perf JWT_ACCESS_SECRET=... node place-order-probe.cjs
const path = require('path'); const crypto = require('crypto'); const fs = require('fs');
const { PrismaClient } = require(require.resolve('@prisma/client', { paths: [path.resolve(__dirname, '../../../../apps/api')] }));
const BASE = 'http://127.0.0.1:3229/api'; const SECRET = process.env.JWT_ACCESS_SECRET;
if (!/tubutree_perf/.test(process.env.DATABASE_URL || '')) throw new Error('chỉ tubutree_perf');
const b64 = (x) => Buffer.from(x).toString('base64url');
const sign = (pl) => { const now = Math.floor(Date.now() / 1000); const h = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' })); const d = b64(JSON.stringify({ ...pl, iat: now, exp: now + 3000 })); return `${h}.${d}.${crypto.createHmac('sha256', SECRET).update(`${h}.${d}`).digest('base64url')}`; };
const NOISE = /cron_leases|pg_advisory|pg_stat_statements|pg_database|^SELECT version|^SET /i;
(async () => {
  const p = new PrismaClient();
  // Khách riêng để không đụng giỏ/đơn của C: perf-u-5
  const uid = 'perf-u-5';
  await p.$executeRawUnsafe(`update users set phone='0912345005', "zaloId"='perf-z-5' where id='${uid}'`);
  await p.$executeRawUnsafe(`insert into addresses (id,"userId",recipient,phone,province,district,ward,street,"isDefault","provinceCode","districtCode","wardCode") values ('perf-addr-5','${uid}','A','0912345005','TP. Hồ Chí Minh','','Phường Bến Nghé','1 Lê Lợi',true,'84_VN79','','84_VN7926743') on conflict do nothing`);
  await p.$executeRawUnsafe(`update variations set stock=1000, "reservedStock"=0 where "isActive"`);
  const vars = await p.$queryRawUnsafe(`select v.id from variations v join products p on p.id=v."productId" where v."isActive" and p."isActive" order by v.id limit 12`);
  const tok = sign({ sub: uid, role: 'CUSTOMER', zaloId: 'perf-z-5' });
  let xff = 5000 + Math.floor(Math.random() * 30000);
  const call = async (method, urlPath, body, extra = {}) => {
    const r = await fetch(BASE + urlPath, { method, headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json', 'x-forwarded-for': `10.7.${(xff >> 8) & 255}.${xff++ & 255}`, ...extra }, body: body ? JSON.stringify(body) : undefined });
    const t0 = Date.now(); const txt = await r.text(); return { status: r.status, txt, ms: Date.now() - t0 };
  };
  const stats = async () => (await p.$queryRawUnsafe(`select query, calls::int calls from pg_stat_statements where dbid=(select oid from pg_database where datname=current_database())`)).filter((r) => !NOISE.test(r.query));
  const reset = () => p.$queryRawUnsafe('select pg_stat_statements_reset()::text as r');
  const out = [];
  for (const K of [1, 4, 8, 12]) {
    await p.$executeRawUnsafe(`delete from cart_items where "cartId" in (select id from carts where "userId"='${uid}')`);
    // thêm K dòng, đếm truy vấn của lần thêm thứ K (giỏ đã có K-1 dòng)
    let addSql = 0, addMs = 0;
    for (let i = 0; i < K; i++) {
      await reset(); const t = Date.now();
      const r = await call('POST', '/cart/items', { variationId: vars[i].id, quantity: 1 });
      addMs = Date.now() - t; if (r.status >= 300) throw new Error('add ' + r.status + r.txt.slice(0, 200));
      addSql = (await stats()).reduce((a, x) => a + x.calls, 0);
    }
    await reset(); const q = await call('POST', '/checkout/quote', { addressId: 'perf-addr-5' });
    const quoteSql = (await stats()).reduce((a, x) => a + x.calls, 0);
    await reset(); const t0 = Date.now();
    const o = await call('POST', '/checkout/place-order', { addressId: 'perf-addr-5', paymentMethod: 'COD' }, { 'idempotency-key': crypto.randomUUID() });
    const ms = Date.now() - t0;
    await new Promise((r) => setTimeout(r, 1500));
    const s = await stats(); const total = s.reduce((a, x) => a + x.calls, 0);
    const rep = s.filter((x) => x.calls > 1).sort((a, b) => b.calls - a.calls).slice(0, 8).map((x) => `x${x.calls} ${x.query.replace(/\s+/g, ' ').slice(0, 110)}`);
    out.push({ K, addSqlAtK: addSql, addMsAtK: addMs, quoteStatus: q.status, quoteSql, placeStatus: o.status, placeMs: ms, placeSql: total, repeated: rep, err: o.status >= 300 ? o.txt.slice(0, 200) : undefined });
    console.log(JSON.stringify(out[out.length - 1]));
    await new Promise((r) => setTimeout(r, 12000)); // né throttle place-order 10/phút
  }
  fs.writeFileSync(path.resolve(__dirname, '../../perf-data/place-order-probe.json'), JSON.stringify(out, null, 1));
  await p.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
