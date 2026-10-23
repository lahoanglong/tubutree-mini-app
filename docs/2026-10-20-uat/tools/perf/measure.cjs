// Đo số truy vấn SQL (pg_stat_statements) và thời gian p50/p95 (20 lần gọi tuần tự) cho các endpoint màn chính.
//   DATABASE_URL=<tubutree_perf @25434> JWT_ACCESS_SECRET=... node measure.cjs <nhãn> [lọc-tên]
// Ghi docs/2026-10-20-uat/perf-data/measure-<nhãn>.json. Chỉ GET và POST /checkout/quote (không ghi DB).
// Đếm truy vấn: reset pg_stat_statements -> gọi 1 request -> cộng calls. Lấy trung vị của 3 lần gọi (đã ấm).
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { PrismaClient } = require(require.resolve('@prisma/client', { paths: [path.resolve(__dirname, '../../../../apps/api')] }));

const BASE = process.env.PERF_BASE || 'http://127.0.0.1:3229/api';
const SECRET = process.env.JWT_ACCESS_SECRET;
const label = process.argv[2] || 'run';
const only = process.argv[3];
if (!SECRET) throw new Error('thiếu JWT_ACCESS_SECRET');
if (!/tubutree_perf/.test(process.env.DATABASE_URL || '') || !/3229/.test(BASE)) throw new Error('chỉ chạy với tubutree_perf + API 3229');

const b64 = (x) => Buffer.from(x).toString('base64url');
const sign = (payload) => {
  const now = Math.floor(Date.now() / 1000);
  const h = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const d = b64(JSON.stringify({ ...payload, iat: now, exp: now + 3000 }));
  return `${h}.${d}.${crypto.createHmac('sha256', SECRET).update(`${h}.${d}`).digest('base64url')}`;
};

const NOISE = /cron_leases|pg_advisory|pg_stat_statements|pg_database|^SELECT version|^SET /i;

(async () => {
  const p = new PrismaClient();
  const cust = (await p.$queryRawUnsafe(`select id from users where "zaloId"='dev-test-user'`))[0].id;
  const adminId = (await p.$queryRawUnsafe(`select id from users where id='perf-admin'`))[0].id;
  const tokens = { cust: sign({ sub: cust, role: 'AFFILIATE', zaloId: 'dev-test-user' }), admin: sign({ sub: adminId, role: 'ADMIN', zaloId: 'dev-admin-user' }), pub: null };
  const slug = (await p.$queryRawUnsafe(`select p.slug from products p join variations v on v."productId"=p.id where p."isActive" group by p.slug order by count(*) desc, p.slug limit 1`))[0].slug;
  const orderCode = (await p.$queryRawUnsafe(`select code from orders where "userId"='${cust}' order by "createdAt" desc limit 1`))[0]?.code;
  const orderCodeBig = (await p.$queryRawUnsafe(`select o.code from orders o join order_items i on i."orderId"=o.id where o."userId"='${cust}' group by o.code order by count(*) desc limit 1`))[0]?.code;
  const feedPost = (await p.$queryRawUnsafe(`select id from feed_posts order by "createdAt" desc limit 1`))[0]?.id;
  const sf = (await p.$queryRawUnsafe(`select slug from storefronts where "isPublished" order by "createdAt" limit 1`))[0]?.slug;
  const addr = (await p.$queryRawUnsafe(`select id from addresses where "userId"='${cust}' limit 1`))[0]?.id;
  const cartItemIds = (await p.$queryRawUnsafe(`select ci.id from cart_items ci join carts c on c.id=ci."cartId" where c."userId"='${cust}'`)).map((r) => r.id);

  const evs = (n) => Array.from({ length: n }, () => ({ eventId: crypto.randomUUID(), eventName: 'screen_viewed', occurredAt: new Date().toISOString(), platform: 'miniapp', anonymousId: 'perf-anon', sessionId: 'perf-sess', props: { screen: 'home' } }));
  const E = [
    // Trang chủ và catalog
    ['home', 'GET', '/home', 'pub'],
    ['home-me', 'GET', '/home/me', 'cust'],
    ['products-l20', 'GET', '/products?limit=20', 'pub'],
    ['products-l1', 'GET', '/products?limit=1', 'pub'],
    ['products-sort-best', 'GET', '/products?limit=20&sort=best_seller', 'pub'],
    ['products-search', 'GET', '/products?limit=20&q=tui', 'pub'],
    ['products-for-you', 'GET', '/products/for-you', 'cust'],
    ['product-detail', 'GET', `/products/${slug}`, 'pub'],
    ['product-related', 'GET', `/products/${slug}/related`, 'pub'],
    ['product-bought-together', 'GET', `/products/${slug}/bought-together`, 'pub'],
    ['product-reviews', 'GET', `/products/${slug}/reviews`, 'pub'],
    ['categories', 'GET', '/categories', 'pub'],
    ['brands', 'GET', '/brands', 'pub'],
    ['search-suggest', 'GET', '/search/suggest?q=tui', 'pub'],
    ['flash-active', 'GET', '/flash-sales/active', 'pub'],
    ['flash-upcoming', 'GET', '/flash-sales/upcoming', 'cust'],
    // Giỏ, thanh toán, đơn
    ['cart', 'GET', '/cart', 'cust'],
    ['checkout-quote', 'POST', '/checkout/quote', 'cust', { addressId: addr }],
    ['checkout-quote-selected', 'POST', '/checkout/quote', 'cust', { addressId: addr, itemIds: cartItemIds }],
    ['checkout-coupon-previews', 'POST', '/checkout/coupon-previews', 'cust', { addressId: addr }],
    ['orders-l20', 'GET', '/orders?limit=20', 'cust'],
    ['orders-l1', 'GET', '/orders?limit=1', 'cust'],
    ['orders-group-processing', 'GET', '/orders?group=processing&limit=20', 'cust'],
    ['orders-active-count', 'GET', '/orders/active-count', 'cust'],
    ['order-detail', 'GET', `/orders/${orderCode}`, 'cust'],
    ['order-detail-big', 'GET', `/orders/${orderCodeBig}`, 'cust'],
    ['purchased-items', 'GET', '/me/purchased-items', 'cust'],
    // Tài khoản, điểm, ví
    ['me', 'GET', '/me', 'cust'],
    ['me-loyalty', 'GET', '/me/loyalty', 'cust'],
    ['me-points-tx', 'GET', '/me/points/transactions', 'cust'],
    ['me-coupons', 'GET', '/me/coupons', 'cust'],
    ['me-new-customer-offer', 'GET', '/me/new-customer-offer', 'cust'],
    ['me-wallet', 'GET', '/me/wallet', 'cust'],
    ['me-notifications', 'GET', '/me/notifications', 'cust'],
    ['me-wishlist', 'GET', '/me/wishlist', 'cust'],
    ['me-wishlist-ids', 'GET', '/me/wishlist/ids', 'cust'],
    ['me-subscriptions', 'GET', '/me/subscriptions', 'cust'],
    ['me-addresses', 'GET', '/me/addresses', 'cust'],
    // Cộng đồng
    ['feed', 'GET', '/feed', 'cust'],
    ['feed-popular', 'GET', '/feed?sort=popular', 'cust'],
    ['feed-leaderboard', 'GET', '/feed/leaderboard', 'cust'],
    ['feed-events', 'GET', '/feed/events', 'cust'],
    feedPost && ['feed-post', 'GET', `/feed/${feedPost}`, 'cust'],
    feedPost && ['feed-comments', 'GET', `/feed/${feedPost}/comments`, 'cust'],
    // Gian hàng, CTV
    ['storefront-public-list', 'GET', '/storefront/public-list', 'pub'],
    sf && ['storefront-public', 'GET', `/storefront/public/${sf}`, 'pub'],
    ['storefront-me', 'GET', '/storefront/me', 'cust'],
    ['storefront-me-stats', 'GET', '/storefront/me/stats', 'cust'],
    ['affiliate-me', 'GET', '/affiliate/me', 'cust'],
    ['affiliate-dashboard', 'GET', '/affiliate/dashboard', 'cust'],
    ['affiliate-commissions', 'GET', '/affiliate/commissions', 'cust'],
    ['affiliate-links', 'GET', '/affiliate/links', 'cust'],
    // Ghi vào DB perf (chỉ khi MUT=1)
    ...(process.env.MUT === '1' ? [
      ['events-b1', 'POST', '/events', 'cust', () => ({ events: evs(1) })],
      ['events-b10', 'POST', '/events', 'cust', () => ({ events: evs(10) })],
      ['events-b50', 'POST', '/events', 'cust', () => ({ events: evs(50) })],
      orderCodeBig && ['repurchase-4lines', 'POST', `/orders/${orderCodeBig}/repurchase`, 'cust', {}],
    ] : []),
    // Admin
    ['admin-dashboard', 'GET', '/admin/dashboard/stats', 'admin'],
    ['admin-orders-l20', 'GET', '/admin/orders?limit=20', 'admin'],
    ['admin-orders-l1', 'GET', '/admin/orders?limit=1', 'admin'],
    ['admin-orders-status', 'GET', '/admin/orders?limit=20&status=CONFIRMED', 'admin'],
    ['admin-orders-search', 'GET', '/admin/orders?limit=20&search=PERFA0001', 'admin'],
    ['admin-users', 'GET', '/admin/users?limit=20', 'admin'],
    ['admin-coupons', 'GET', '/admin/coupons', 'admin'],
    ['admin-reviews', 'GET', '/admin/reviews', 'admin'],
    ['admin-subscriptions', 'GET', '/admin/subscriptions', 'admin'],
    ['admin-payouts', 'GET', '/admin/payouts', 'admin'],
    ['admin-reports-revenue', 'GET', '/admin/reports/revenue', 'admin'],
    ['admin-reports-sources', 'GET', '/admin/reports/sources', 'admin'],
  ].filter(Boolean).filter((e) => !(e[0] === 'admin-dashboard' && false));

  const stats = async () => {
    const rows = await p.$queryRawUnsafe(
      `select query, calls::int calls, rows::int rows, round(total_exec_time::numeric,3)::float ms from pg_stat_statements where dbid=(select oid from pg_database where datname=current_database()) order by calls desc`,
    );
    return rows.filter((r) => !NOISE.test(r.query));
  };
  const reset = () => p.$queryRawUnsafe('select pg_stat_statements_reset()::text as r');
  let xff = 1000 + Math.floor(Math.random() * 50000);
  const call = async (method, urlPath, role, body) => {
    const headers = { 'x-forwarded-for': `10.${(xff >> 16) & 255}.${(xff >> 8) & 255}.${xff++ & 255}`, 'content-type': 'application/json' };
    if (tokens[role]) headers.authorization = `Bearer ${tokens[role]}`;
    const t0 = process.hrtime.bigint();
    const res = await fetch(BASE + urlPath, { method, headers, body: body ? JSON.stringify(typeof body === 'function' ? body() : body) : undefined });
    const buf = Buffer.from(await res.arrayBuffer());
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    return { status: res.status, ms, bytes: buf.length, text: buf.toString('utf8') };
  };
  const rowCount = (txt) => {
    try {
      const j = JSON.parse(txt);
      if (Array.isArray(j)) return j.length;
      for (const k of ['items', 'data', 'orders', 'posts', 'products', 'results', 'rows']) if (Array.isArray(j[k])) return j[k].length;
      return null;
    } catch { return null; }
  };

  if (process.env.SEQ === '1') {
    // Mỗi endpoint: quét tuần tự (seq_scan) bao nhiêu lần trên các bảng lớn trong 1 lần gọi (sau khi gọi nóng 1 lần).
    const snap = async () => {
      await new Promise((r) => setTimeout(r, 1200));
      const rows = await p.$queryRawUnsafe(`select relname, seq_scan::int s, seq_tup_read::bigint t from pg_stat_user_tables where n_live_tup>1000`);
      return Object.fromEntries(rows.map((r) => [r.relname, [r.s, Number(r.t)]]));
    };
    const res = [];
    for (const [name, method, urlPath, role, body] of E) {
      if (only && !name.includes(only)) continue;
      await call(method, urlPath, role, body);
      const a = await snap(); await call(method, urlPath, role, body); const b = await snap();
      const d = Object.keys(b).map((k) => [k, b[k][0] - (a[k]?.[0] ?? 0), b[k][1] - (a[k]?.[1] ?? 0)]).filter((x) => x[1] > 0);
      res.push({ name, seq: d });
      console.log(name.padEnd(28), d.map((x) => `${x[0]}:${x[1]}x/${x[2]}rows`).join(' ') || '-');
    }
    fs.writeFileSync(path.resolve(__dirname, '../../perf-data/seqscan.json'), JSON.stringify(res, null, 1));
    await p.$disconnect();
    return;
  }
  const out = [];
  for (const [name, method, urlPath, role, body] of E) {
    if (only && !name.includes(only)) continue;
    const first = await call(method, urlPath, role, body); // nguội: lần đầu của tiến trình/ca
    const counts = [];
    let sample = null;
    for (let i = 0; i < 3; i++) {
      await reset();
      const r = await call(method, urlPath, role, body);
      const s = await stats();
      counts.push({ total: s.reduce((a, x) => a + x.calls, 0), distinct: s.length, rows: s, status: r.status });
      sample = { r, s };
    }
    const times = [];
    let bad = 0;
    for (let i = 0; i < 20; i++) { const c = await call(method, urlPath, role, body); if (c.status >= 400) bad++; times.push(c.ms); }
    times.sort((a, b) => a - b);
    const med = counts.map((c) => c.total).sort((a, b) => a - b)[1];
    const pick = counts.find((c) => c.total === med) || counts[0];
    const rec = {
      name, method, path: urlPath.replace(slug, ':slug'), role, status: sample.r.status, bytes: sample.r.bytes, rows: rowCount(sample.r.text),
      sqlCold: null, sqlWarm: med, sqlWarmAll: counts.map((c) => c.total), distinct: pick.distinct,
      timedNon2xx: bad, p50: +times[10].toFixed(1), p95: +times[18].toFixed(1), min: +times[0].toFixed(1), max: +times[19].toFixed(1), firstMs: +first.ms.toFixed(1),
      sql: pick.rows.map((x) => ({ calls: x.calls, rows: x.rows, ms: x.ms, q: x.query.replace(/\s+/g, ' ').slice(0, 400) })),
    };
    out.push(rec);
    console.log(`${name.padEnd(28)} ${String(rec.status).padEnd(4)} sql=${String(med).padStart(3)} (${counts.map((c) => c.total).join('/')}) p50=${rec.p50}ms p95=${rec.p95}ms ${rec.bytes}B${bad ? ' NON2XX=' + bad : ''} rows=${rec.rows}`);
  }
  if (process.env.COLD === '1') {
    // Cache RAM của API (home 20 s, brands/categories 60 s): chờ hết hạn rồi đếm số truy vấn của lần dựng lại.
    console.log('chờ 62 s cho cache hết hạn...');
    await new Promise((r) => setTimeout(r, 62000));
    for (const [name, method, urlPath, role, body] of E.filter((e) => ['home', 'categories', 'brands', 'flash-active'].includes(e[0]))) {
      await reset();
      const r = await call(method, urlPath, role, body);
      const s = await stats();
      const rec = out.find((o) => o.name === name);
      const total = s.reduce((a, x) => a + x.calls, 0);
      if (rec) { rec.sqlCold = total; rec.sqlColdRows = s.map((x) => ({ calls: x.calls, rows: x.rows, ms: x.ms, q: x.query.replace(/\s+/g, ' ').slice(0, 400) })); rec.coldMs = +r.ms.toFixed(1); }
      console.log(`COLD ${name.padEnd(20)} sql=${total} ${r.ms.toFixed(1)}ms`);
    }
  }
  const dir = path.resolve(__dirname, '../../perf-data');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `measure-${label}${only ? '-' + only : ''}.json`), JSON.stringify({ label, at: new Date().toISOString(), base: BASE, slug, out }, null, 1));
  await p.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
