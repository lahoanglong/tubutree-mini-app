// Flash sale: nhiều user cùng mua 1 suất (perf_fsi_1: quota 50, perUserLimit 1) → đếm oversell.
// + Đặt trùng của CÙNG 1 user (double-submit) kiểm perUserLimit/idempotency.
// Mỗi vòng: snapshot → chạy → đối chiếu DB → dọn (đơn/giỏ/purchase) → trả soldCount/stock về cũ. Chỉ tubutree_perf + API 3301.
const crypto = require('crypto');
const fs = require('fs');
const { Client } = require('pg');
const { tokenFor, pgConf } = require('./lib.cjs');
const { BASE, fakeIp, pct } = require('./loadlib.cjs');
if (!/(localhost|127.0.0.1):3301/.test(BASE)) throw new Error('chỉ cổng 3301');

const ITEM = 'perf_fsi_1';
const VAR = 'perf_v_1_1';
const N_USERS = Number(process.env.FLASH_USERS || 200);
const U0 = 40001;
let ipc = 500000;

async function call(method, path, { token, body, headers } = {}) {
  const t = performance.now();
  try {
    const r = await fetch(BASE + path, {
      method,
      headers: { 'X-Forwarded-For': fakeIp(++ipc), ...(process.env.PERF_BYPASS ? { 'x-throttle-bypass': process.env.PERF_BYPASS } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    return { status: r.status, text, ms: performance.now() - t };
  } catch (e) {
    return { status: -1, text: String(e.message), ms: performance.now() - t };
  }
}

async function cleanup(c, userIds, since) {
  await c.query(`DELETE FROM flash_sale_purchases WHERE "flashSaleItemId"=$1`, [ITEM]);
  const o = await c.query(`SELECT id FROM orders WHERE "userId" = ANY($1) AND "createdAt" >= $2`, [userIds, since]);
  const ids = o.rows.map((r) => r.id);
  if (ids.length) {
    await c.query(`DELETE FROM order_status_history WHERE "orderId" = ANY($1)`, [ids]);
    await c.query(`DELETE FROM order_items WHERE "orderId" = ANY($1)`, [ids]);
    await c.query(`DELETE FROM orders WHERE id = ANY($1)`, [ids]);
  }
  await c.query(`DELETE FROM cart_items WHERE "cartId" IN (SELECT id FROM carts WHERE "userId" = ANY($1))`, [userIds]);
  await c.query(`DELETE FROM carts WHERE "userId" = ANY($1)`, [userIds]);
  return ids.length;
}

(async () => {
  const c = new Client(pgConf());
  await c.connect();
  const userIds = Array.from({ length: N_USERS }, (_, i) => 'perf_u_' + (U0 + i));
  const base = (await c.query(`SELECT "soldCount", quota FROM flash_sale_items WHERE id=$1`, [ITEM])).rows[0];
  const v0 = (await c.query(`SELECT stock, "reservedStock" FROM variations WHERE id=$1`, [VAR])).rows[0];
  console.log(`item ${ITEM}: quota=${base.quota} soldCount=${base.soldCount}; variation stock=${v0.stock} reserved=${v0.reservedStock}; ${N_USERS} user đồng thời`);
  const out = { item: ITEM, quota: base.quota, users: N_USERS, rounds: [] };

  for (let round = 1; round <= 3; round++) {
    const since = new Date(Date.now() - 1000).toISOString();
    await cleanup(c, userIds, since);
    await c.query(`UPDATE flash_sale_items SET "soldCount"=0 WHERE id=$1`, [ITEM]);
    await c.query(`UPDATE variations SET stock=$2, "reservedStock"=$3 WHERE id=$1`, [VAR, v0.stock, v0.reservedStock]);

    // Chuẩn bị: mỗi user có 1 flash item trong giỏ (không tính vào thời gian đo).
    await Promise.all(userIds.map((uid) => call('POST', '/cart/items', { token: tokenFor(uid), body: { variationId: VAR, quantity: 1 } })));

    // Bắn đồng loạt place-order.
    const lat = [];
    const t0 = performance.now();
    const rs = await Promise.all(userIds.map((uid, i) => call('POST', '/checkout/place-order', {
      token: tokenFor(uid), body: { addressId: 'perf_a_' + (U0 + i), paymentMethod: 'COD' }, headers: { 'Idempotency-Key': crypto.randomUUID() },
    }).then((r) => { lat.push(r.ms); return r; })));
    const wall = performance.now() - t0;
    const ok = rs.filter((r) => r.status === 200 || r.status === 201).length;
    const soldOut = rs.filter((r) => r.status === 400 && /PRICE_CHANGED|hết|FLASH/i.test(r.text)).length;
    const other = rs.filter((r) => !(r.status === 200 || r.status === 201) && !(r.status === 400 && /PRICE_CHANGED|hết|FLASH/i.test(r.text)));
    const after = (await c.query(`SELECT "soldCount" FROM flash_sale_items WHERE id=$1`, [ITEM])).rows[0].soldCount;
    const orders = (await c.query(`SELECT count(*)::int n, coalesce(sum(oi.quantity),0)::int q FROM order_items oi JOIN orders o ON o.id=oi."orderId" WHERE oi."flashSaleItemId"=$1 AND o."createdAt" >= $2`, [ITEM, since])).rows[0];
    const purchases = (await c.query(`SELECT count(*)::int n, coalesce(sum(quantity),0)::int q FROM flash_sale_purchases WHERE "flashSaleItemId"=$1`, [ITEM])).rows[0];
    const v1 = (await c.query(`SELECT stock, "reservedStock" FROM variations WHERE id=$1`, [VAR])).rows[0];
    const round_ = {
      round, wallMs: +wall.toFixed(0), httpOk: ok, soldOutOrPriceChanged: soldOut, otherFailures: other.length,
      otherSamples: other.slice(0, 3).map((r) => r.status + ' ' + r.text.slice(0, 100)),
      p50: +pct(lat, 50).toFixed(0), p95: +pct(lat, 95).toFixed(0), p99: +pct(lat, 99).toFixed(0),
      dbSoldCount: after, dbOrderItemsFlash: orders.n, dbOrderItemsQty: orders.q, dbPurchasesQty: purchases.q,
      stockDelta: v0.stock - v1.stock, reservedDelta: v1.reservedStock - v0.reservedStock,
      OVERSELL: Math.max(0, orders.q - base.quota), consistent: after === orders.q && orders.q === ok && purchases.q === orders.q,
    };
    out.rounds.push(round_);
    console.log(JSON.stringify(round_));
  }

  // Double-submit của CÙNG 1 user: 10 place-order song song (khác Idempotency-Key) với 1 món flash trong giỏ.
  await cleanup(c, userIds, new Date(Date.now() - 1000).toISOString());
  await c.query(`UPDATE flash_sale_items SET "soldCount"=0 WHERE id=$1`, [ITEM]);
  await c.query(`UPDATE variations SET stock=$2, "reservedStock"=$3 WHERE id=$1`, [VAR, v0.stock, v0.reservedStock]);
  const uid = userIds[0];
  await call('POST', '/cart/items', { token: tokenFor(uid), body: { variationId: VAR, quantity: 1 } });
  const dsSince = new Date(Date.now() - 1000).toISOString();
  const ds = await Promise.all(Array.from({ length: 10 }, () => call('POST', '/checkout/place-order', {
    token: tokenFor(uid), body: { addressId: 'perf_a_' + U0, paymentMethod: 'COD' }, headers: { 'Idempotency-Key': crypto.randomUUID() },
  })));
  const dsMsgs = [...new Set(ds.map((r) => r.text.slice(0, 80)))];
  const dsOrders = (await c.query(`SELECT count(*)::int n FROM orders WHERE "userId"=$1 AND "createdAt">=$2`, [uid, dsSince])).rows[0].n;
  out.doubleSubmitSameUser = { parallel: 10, httpOk: ds.filter((r) => r.status < 300).length, statuses: ds.map((r) => r.status), ordersCreated: dsOrders, messages: dsMsgs, soldCount: (await c.query(`SELECT "soldCount" FROM flash_sale_items WHERE id=$1`, [ITEM])).rows[0].soldCount };
  console.log('double-submit cùng user:', JSON.stringify(out.doubleSubmitSameUser));

  // Idempotency-Key TRÙNG: 10 request song song cùng key → đúng 1 đơn.
  await cleanup(c, userIds, dsSince);
  await c.query(`UPDATE flash_sale_items SET "soldCount"=0 WHERE id=$1`, [ITEM]);
  await c.query(`UPDATE variations SET stock=$2, "reservedStock"=$3 WHERE id=$1`, [VAR, v0.stock, v0.reservedStock]);
  await call('POST', '/cart/items', { token: tokenFor(uid), body: { variationId: VAR, quantity: 1 } });
  const idemSince = new Date(Date.now() - 1000).toISOString();
  const key = crypto.randomUUID();
  const idem = await Promise.all(Array.from({ length: 10 }, () => call('POST', '/checkout/place-order', {
    token: tokenFor(uid), body: { addressId: 'perf_a_' + U0, paymentMethod: 'COD' }, headers: { 'Idempotency-Key': key },
  })));
  const idemOrders = (await c.query(`SELECT count(*)::int n FROM orders WHERE "userId"=$1 AND "createdAt">=$2`, [uid, idemSince])).rows[0].n;
  out.sameIdempotencyKey = { parallel: 10, statuses: idem.map((r) => r.status), messages: [...new Set(idem.map((r) => r.text.slice(0, 80)))], ordersCreated: idemOrders };
  console.log('cùng Idempotency-Key:', JSON.stringify(out.sameIdempotencyKey));

  // Dọn sạch + trả trạng thái.
  const removed = await cleanup(c, userIds, idemSince);
  await c.query(`UPDATE flash_sale_items SET "soldCount"=$2 WHERE id=$1`, [ITEM, base.soldCount]);
  await c.query(`UPDATE variations SET stock=$2, "reservedStock"=$3 WHERE id=$1`, [VAR, v0.stock, v0.reservedStock]);
  fs.writeFileSync(__dirname + '/results/flash.json', JSON.stringify(out, null, 1));
  await c.end();
})().catch((e) => { console.error(e); process.exit(1); });
