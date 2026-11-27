#!/usr/bin/env node
/**
 * Do cac duong nong cua API tren DB perf (seed-large.ts), qua pg-latency-proxy.cjs:
 * so cau SQL, do sau tuan tu va p50 thoi gian tung endpoint, o do tre 0 ms va LATENCY ms moi vong hoi-dap.
 *
 * Dung Nest trong cung tien trinh (dist da build) de: tat moi @Cron truoc khi do (khong lan cau SQL cua cron vao so dem),
 * va (--cold) xoa cache RAM cua cac service truoc moi lan do, de thay chi phi that khi cache het han.
 *
 *   node scripts/perf/pg-latency-proxy.cjs &   # PG_TARGET=127.0.0.1:<cong DB perf>
 *   BENCH_DB_URL='postgresql://u:p@127.0.0.1:5573/tubutree_perf?schema=public&connection_limit=20' \
 *   BENCH_REDIS_URL=redis://127.0.0.1:6391/0 API_DIR=apps/api \
 *   node scripts/perf/api-bench.cjs --out=before.json [--only=home,pdp] [--n=11] [--latency=30] [--cold]
 *   [--dump=<thu muc>] ghi body tung endpoint de so truoc/sau khi sha lech
 *   --crons [--only=Lop.ham,...]: goi tung ham @Cron mot lan va do (xem runCrons)
 *
 * In bang: endpoint | stmts | depth | p50 @0ms | p50 @Lms. KHONG chay vao DB that (tu choi neu ten DB khac tubutree_perf).
 */
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? '1'];
  }),
);
const N = Number(args.n || 11);
const WARM = Number(args.warm || 3);
const LAT = Number(args.latency || 30);
const COLD = args.cold === '1';
const CONTROL = `http://127.0.0.1:${process.env.CONTROL_PORT || 5574}`;
const PORT = Number(process.env.BENCH_PORT || 3311);
const API_DIR = path.resolve(process.env.API_DIR || path.join(__dirname, '../../apps/api'));
const DB_URL = process.env.BENCH_DB_URL || '';
if (!/\/tubutree_perf(\?|$)/.test(DB_URL)) {
  console.error('TU CHOI: BENCH_DB_URL phai tro toi database "tubutree_perf".');
  process.exit(2);
}

const secret = crypto.randomBytes(24).toString('hex');
Object.assign(process.env, {
  NODE_ENV: process.env.BENCH_NODE_ENV || 'development',
  PORT: String(PORT),
  DATABASE_URL: DB_URL,
  REDIS_URL: process.env.BENCH_REDIS_URL || 'redis://127.0.0.1:6391/0',
  JWT_ACCESS_SECRET: secret,
  JWT_REFRESH_SECRET: crypto.randomBytes(24).toString('hex'),
  THROTTLE_BYPASS_TOKEN: crypto.randomBytes(24).toString('hex'),
  LOG_LEVEL: 'warn',
});
for (const k of ['ZALO_OA_ACCESS_TOKEN', 'ZALO_OA_REFRESH_TOKEN', 'ZALO_APP_SECRET', 'DEEPSEEK_API_KEY', 'GEMINI_API_KEY', 'PANCAKE_API_KEY', 'SENTRY_DSN', 'MSS_BASE_URL']) process.env[k] = '';

const b64 = (b) => Buffer.from(b).toString('base64url');
function tokenFor(sub, role = 'CUSTOMER') {
  const now = Math.floor(Date.now() / 1000);
  const h = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64(JSON.stringify({ sub, role, affiliateEnabled: false, dealerEnabled: false, iat: now, exp: now + 6 * 3600 }));
  return `${h}.${p}.${crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url')}`;
}

const ctl = (p) => fetch(CONTROL + p).then((r) => r.json());
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : NaN;
};

/** Xoa cache RAM cua service (Map, o nho {expiresAt}, slot {value, inflight}) de do duong "cache het han". */
function bustCaches(app, classes) {
  for (const C of classes) {
    let inst;
    try {
      inst = app.get(C, { strict: false });
    } catch {
      continue;
    }
    for (const key of Object.keys(inst)) {
      const v = inst[key];
      if (v instanceof Map) v.clear();
      else if (v && typeof v === 'object' && 'expiresAt' in v) inst[key] = null;
      else if (v && typeof v === 'object' && 'inflight' in v && 'value' in v) {
        v.value = null;
        v.inflight = null;
      }
    }
  }
}

/**
 * --crons: goi MOT lan moi ham @Cron (tim qua metadata, khong qua lich) o do tre hien tai cua proxy, ghi thoi gian, so cau SQL, so vong va
 * loi. Cron GHI vao DB perf: chup DB truoc (createdb -T) neu con can so API sau do. Cron goi dich vu ngoai se loi som vi token/URL de trong.
 */
async function runCrons(app, req) {
  const { DiscoveryService } = req('@nestjs/core');
  const discovery = app.get(DiscoveryService, { strict: false });
  const only = args.only ? new Set(args.only.split(',')) : null;
  const jobs = [];
  for (const w of discovery.getProviders()) {
    const inst = w.instance;
    if (!inst || typeof inst !== 'object') continue;
    const proto = Object.getPrototypeOf(inst);
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (name === 'constructor') continue;
      const fn = Object.getOwnPropertyDescriptor(proto, name)?.value;
      if (typeof fn !== 'function') continue;
      const opt = Reflect.getMetadata('SCHEDULE_CRON_OPTIONS', fn);
      if (!opt) continue;
      const id = `${proto.constructor.name}.${name}`;
      if (only && !only.has(id)) continue;
      jobs.push({ id, cron: String(opt.cronTime), call: () => fn.call(inst) });
    }
  }
  jobs.sort((a, b) => a.id.localeCompare(b.id));
  await fetch(`${CONTROL}/latency?ms=${args.latency ?? 0}`);
  const results = {};
  for (const j of jobs) {
    await fetch(`${CONTROL}/reset`);
    const t0 = performance.now();
    let error = null;
    try {
      await Promise.race([j.call(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout 120s')), 120_000))]);
    } catch (e) {
      error = String(e?.message || e).slice(0, 160);
    }
    const ms = Math.round(performance.now() - t0);
    const st = await (await fetch(`${CONTROL}/stats`)).json();
    results[j.id] = { cron: j.cron, ms, statements: st.statements, roundTrips: st.roundTrips, depth: st.depth, error };
    console.log(`${j.id.padEnd(58)} ${j.cron.padEnd(22)} ${String(ms).padStart(6)}ms stmts=${String(st.statements).padStart(5)} depth=${String(st.depth).padStart(4)}${error ? ' ERR ' + error : ''}`);
  }
  if (args.out) fs.writeFileSync(args.out, JSON.stringify({ at: new Date().toISOString(), latency: (await (await fetch(`${CONTROL}/stats`)).json()).latency, results }, null, 2));
  await app.close();
  process.exit(0);
}

async function main() {
  const req = createRequire(path.join(API_DIR, 'package.json'));
  req('reflect-metadata');
  const { bootstrap } = require(path.join(API_DIR, 'dist/bootstrap.js'));
  const { AppModule } = require(path.join(API_DIR, 'dist/app.module.js'));
  const { SchedulerRegistry } = req('@nestjs/schedule');
  const app = await bootstrap(AppModule, { port: PORT });
  if (!app) throw new Error('bootstrap that bai');
  const reg = app.get(SchedulerRegistry);
  for (const [, job] of reg.getCronJobs()) job.stop();
  for (const name of reg.getIntervals()) clearInterval(reg.getInterval(name));
  const cacheClasses = [];
  for (const [file, name] of [
    ['modules/catalog/home.service.js', 'HomeService'],
    ['modules/catalog/catalog.service.js', 'CatalogService'],
    ['modules/system-config/system-config.service.js', 'SystemConfigService'],
    ['modules/auth/session-state.service.js', 'SessionStateService'],
    ['modules/flash-sale/flash-sale.service.js', 'FlashSaleService'],
  ]) {
    try {
      cacheClasses.push(require(path.join(API_DIR, 'dist', file))[name]);
    } catch {}
  }

  const prisma = app.get(require(path.join(API_DIR, 'dist/prisma/prisma.service.js')).PrismaService);
  const pick = async (sql) => (await prisma.$queryRawUnsafe(sql))[0] ?? {};
  if (args.crons) return runCrons(app, req);
  // --trace: in tung cau Prisma cua MOT lan goi (moc bat dau/ket thuc, model.action, khung goi trong dist) de thay chuoi tuan tu.
  let traceT0 = null;
  const traceLog = [];
  if (args.trace) {
    prisma.$use(async (params, next) => {
      if (traceT0 === null) return next(params);
      const s = performance.now() - traceT0;
      const frames = (new Error().stack || '')
        .split('\n')
        .filter((l) => l.includes('/dist/') && !l.includes('prisma.service'))
        .slice(0, 3)
        .map((l) => l.replace(/^.*\/dist\//, '').replace(/\)$/, ''))
        .join(' < ');
      try {
        return await next(params);
      } finally {
        traceLog.push(`${s.toFixed(0).padStart(5)}-${(performance.now() - traceT0).toFixed(0).padStart(5)}ms ${params.model ?? ''}.${params.action}  ${frames}`);
      }
    });
  }
  const typical = 'perf_u_200';
  const whale = 'perf_u_1';
  const cartUser = await pick(
    `SELECT c."userId" AS id, min(a.id) AS "addressId" FROM carts c JOIN addresses a ON a."userId" = c."userId" JOIN cart_items ci ON ci."cartId" = c.id WHERE c."userId" LIKE 'perf_u_%' GROUP BY c."userId" ORDER BY count(*) DESC, c."userId" LIMIT 1`,
  );
  const order = await pick(`SELECT code FROM orders WHERE "userId" = '${typical}' ORDER BY "createdAt" DESC LIMIT 1`);
  const slug = (await pick(`SELECT slug FROM products WHERE id = 'perf_p_7'`)).slug ?? 'perf-san-pham-7';
  const cat = (await pick(`SELECT c.id FROM products p, unnest(p."categoryIds") cid JOIN categories c ON c.id = cid GROUP BY c.id ORDER BY count(*) DESC LIMIT 1`)).id;
  const admin = (await pick(`SELECT id FROM users WHERE role = 'ADMIN' ORDER BY "createdAt" LIMIT 1`)).id || whale;

  const T = { u: tokenFor(typical), w: tokenFor(whale), c: tokenFor(cartUser.id || typical), a: tokenFor(admin, 'ADMIN') };
  const S = [
    ['home', 'GET', '/home'],
    ['home_me', 'GET', '/home/me?purchasedLimit=10', 'u'],
    ['home_me_whale', 'GET', '/home/me?purchasedLimit=10', 'w'],
    ['config_public', 'GET', '/config/public'],
    ['products_list', 'GET', '/products?page=1&limit=20'],
    ['products_cat', 'GET', `/products?category=${encodeURIComponent(cat || 'x')}&page=1&limit=20`],
    ['products_search', 'GET', `/products?q=${encodeURIComponent('chậu cây')}&limit=20`],
    ['search_suggest', 'GET', `/search/suggest?q=${encodeURIComponent('san')}`],
    ['pdp', 'GET', `/products/${slug}`],
    ['pdp_related', 'GET', `/products/${slug}/related`],
    ['pdp_bought_together', 'GET', `/products/${slug}/bought-together`],
    ['categories', 'GET', '/categories'],
    ['brands', 'GET', '/brands'],
    ['flash_active', 'GET', '/flash-sales/active'],
    ['me_summary', 'GET', '/me/summary', 'u'],
    ['cart', 'GET', '/cart', 'c'],
    ['checkout_quote', 'POST', '/checkout/quote', 'c', { addressId: cartUser.addressId }],
    ['orders_list', 'GET', '/orders?page=1&limit=10', 'u'],
    ['orders_list_whale', 'GET', '/orders?page=1&limit=10', 'w'],
    ['order_detail', 'GET', `/orders/${order.code}`, 'u'],
    ['orders_home_todo', 'GET', '/orders/home-todo', 'u'],
    ['orders_status_counts', 'GET', '/orders/status-counts', 'u'],
    ['loyalty', 'GET', '/me/loyalty', 'u'],
    ['loyalty_whale', 'GET', '/me/loyalty', 'w'],
    ['points_tx', 'GET', '/me/points/transactions', 'w'],
    ['coupons_me', 'GET', '/me/coupons', 'u'],
    ['notifications', 'GET', '/me/notifications', 'w'],
    ['notifications_unread', 'GET', '/me/notifications/unread-count', 'w'],
    ['admin_orders', 'GET', '/admin/orders?page=1&limit=20', 'a'],
    ['admin_users', 'GET', '/admin/users?page=1&limit=20', 'a'],
    ['admin_dash_today', 'GET', '/admin/dashboard/today', 'a'],
    ['admin_command_center', 'GET', '/admin/dashboard/command-center', 'a'],
    ['admin_ops_counts', 'GET', '/admin/orders/ops-counts', 'a'],
  ];
  const only = args.only ? new Set(args.only.split(',')) : null;
  const base = `http://127.0.0.1:${PORT}/api`;
  let ip = 0;

  async function once([, method, p, tok, body]) {
    ip++;
    const headers = { 'x-forwarded-for': `10.9.${(ip >> 8) & 255}.${ip & 255}`, 'x-throttle-bypass': process.env.THROTTLE_BYPASS_TOKEN };
    if (tok) headers.authorization = `Bearer ${T[tok]}`;
    if (body) headers['content-type'] = 'application/json';
    if (COLD) bustCaches(app, cacheClasses);
    await ctl('/reset');
    const t0 = performance.now();
    const r = await fetch(base + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const text = await r.text();
    const ms = performance.now() - t0;
    const st = await ctl('/stats');
    return { status: r.status, ms, bytes: text.length, statements: st.statements, roundTrips: st.roundTrips, depth: st.depth, body: text };
  }

  if (args.trace) {
    await ctl(`/latency?ms=${LAT}`);
    for (const sc of S) {
      if (only && !only.has(sc[0])) continue;
      for (let i = 0; i < WARM; i++) await once(sc);
      traceLog.length = 0;
      traceT0 = performance.now();
      const r = await once(sc);
      traceT0 = null;
      console.log(`\n### ${sc[0]} ${r.status} ${r.ms.toFixed(0)}ms stmts=${r.statements} depth=${r.depth}`);
      for (const l of traceLog.sort()) console.log(l);
    }
    await ctl('/latency?ms=0');
    await app.close();
    process.exit(0);
  }

  const results = {};
  for (const sc of S) {
    if (only && !only.has(sc[0])) continue;
    const row = {};
    for (const lat of [0, LAT]) {
      await ctl(`/latency?ms=${lat}`);
      for (let i = 0; i < WARM; i++) await once(sc);
      const runs = [];
      for (let i = 0; i < N; i++) runs.push(await once(sc));
      row[`p50_${lat}`] = Math.round(median(runs.map((r) => r.ms)));
      if (lat === LAT) {
        row.statements = median(runs.map((r) => r.statements));
        row.roundTrips = median(runs.map((r) => r.roundTrips));
        row.depth = median(runs.map((r) => r.depth));
        row.status = runs[0].status;
        row.bytes = runs[0].bytes;
        if (args.show && row.status >= 400) console.log(sc[0], runs[0].body.slice(0, 300));
        row.sha = crypto.createHash('sha1').update(runs[0].body.replace(/"serverNow":"[^"]*"/g, '')).digest('hex').slice(0, 10);
        if (args.dump) fs.writeFileSync(path.join(args.dump, `${sc[0]}.json`), runs[0].body);
      }
    }
    results[sc[0]] = row;
    console.log(
      `${sc[0].padEnd(22)} ${String(row.status).padStart(3)} stmts=${String(row.statements).padStart(3)} rt=${String(row.roundTrips).padStart(3)} depth=${String(row.depth).padStart(3)} p50@0=${String(row['p50_0']).padStart(4)}ms p50@${LAT}=${String(row[`p50_${LAT}`]).padStart(5)}ms ${row.bytes}B`,
    );
  }
  if (args.out) fs.writeFileSync(args.out, JSON.stringify({ at: new Date().toISOString(), cold: COLD, latency: LAT, n: N, results }, null, 2));
  await ctl('/latency?ms=0');
  await app.close();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
