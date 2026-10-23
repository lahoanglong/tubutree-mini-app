// Thư viện chung cho các ca U2 (Điểm Xanh và sau mua). Dựng trên bộ khung tools/uat-harness: API/DB/Redis/Mini App thật của lane,
// chỉ giả Zalo, Pancake và ngân hàng. Lane mặc định 7 (lane 2 trùng cổng 3221-3223 của stack UAT chính đang chạy).
// Mọi ca ghi results/<ID>.json (kiểm tra + bằng chứng) và ảnh vào docs/2026-10-20-uat/uat/shots/U2-diem-xanh-sau-mua/.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { api, apiOk, closePrisma, findUser, lane, prismaFor, sleep, HARNESS } from '../../../tools/uat-harness/lib.mjs';
import { open } from '../../../tools/uat-harness/miniapp-session.mjs';
import { sendOrderStatus, sendPlatform, postWebhook } from '../../../tools/uat-harness/pancake-webhook.mjs';

export { api, apiOk, closePrisma, findUser, prismaFor, sleep, open, sendOrderStatus, sendPlatform, postWebhook, HARNESS };

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const RESULTS = path.join(HERE, 'results');
export const SHOTS = path.resolve(HERE, '../../shots/U2-diem-xanh-sau-mua');
fs.mkdirSync(RESULTS, { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });

const laneArg = process.argv.slice(2).find((a) => /^\d$/.test(a));
export const L = lane(laneArg ?? process.env.U2_LANE ?? 7);
export const prisma = prismaFor(L);
export const headless = !process.argv.includes('--headed');
const t0 = Date.now();

export function log(tag, msg, data) {
  console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${tag} ${msg}${data !== undefined ? ` ${JSON.stringify(data)}` : ''}`);
}

/** Một ca: gom kiểm tra + bằng chứng, ghi results/<id>.json, trả PASS/FAIL/BLOCKED. */
export function kase(id, title) {
  const checks = [];
  const evidence = {};
  let blocked = null;
  log(id, `== ${title}`);
  return {
    id,
    check(name, ok, detail) {
      checks.push({ name, ok: Boolean(ok), detail });
      log(id, `${ok ? 'OK  ' : 'FAIL'} ${name}`, detail);
      return Boolean(ok);
    },
    ev(key, value) {
      evidence[key] = value;
    },
    block(reason) {
      blocked = reason;
      log(id, `BLOCKED ${reason}`);
    },
    error(e) {
      checks.push({ name: 'ca chạy hết không lỗi', ok: false, detail: e instanceof Error ? `${e.message}\n${e.stack?.split('\n').slice(1, 4).join('\n')}` : String(e) });
      log(id, 'FAIL ca chạy hết không lỗi', e instanceof Error ? e.message : String(e));
    },
    finish() {
      const failed = checks.filter((c) => !c.ok);
      const verdict = blocked ? 'BLOCKED' : failed.length ? 'FAIL' : 'PASS';
      const out = { id, title, verdict, blocked, at: new Date().toISOString(), lane: L.n, checks, evidence };
      fs.writeFileSync(path.join(RESULTS, `${id}.json`), `${JSON.stringify(out, (_k, v) => (typeof v === 'bigint' ? Number(v) : v), 2)}\n`);
      log(id, `=> ${verdict}${failed.length ? ` (${failed.map((c) => c.name).join('; ')})` : ''}`);
      return out;
    },
  };
}

export async function q(sql, ...params) {
  return prisma.$queryRawUnsafe(sql, ...params);
}
export async function x(sql, ...params) {
  return prisma.$executeRawUnsafe(sql, ...params);
}

/** Sổ điểm của khách: số dư hai lô và tổng delta theo lô. */
export async function ledger(userId) {
  const [u] = await q(`SELECT "pointsBalance"::int AS bal, "pointsConvertedBalance"::int AS conv, "walletBalance"::int AS wallet, "tierId" FROM users WHERE id = $1`, userId);
  const lots = await q(`SELECT lot::text AS lot, COALESCE(SUM(delta),0)::int AS sum, COUNT(*)::int AS n FROM points_transactions WHERE "userId" = $1 GROUP BY lot`, userId);
  const [w] = await q(`SELECT COALESCE(SUM(delta),0)::int AS sum, COUNT(*)::int AS n FROM wallet_transactions WHERE "userId" = $1`, userId).catch(() => [{ sum: null, n: null }]);
  const std = lots.find((r) => r.lot === 'STANDARD') ?? { sum: 0, n: 0 };
  const conv = lots.find((r) => r.lot === 'CONVERTED') ?? { sum: 0, n: 0 };
  return { balance: u.bal, stdSum: std.sum, rows: std.n, converted: u.conv, convSum: conv.sum, wallet: u.wallet, walletSum: w.sum, walletRows: w.n, tierId: u.tierId, lots };
}

export async function rowsFor(userId, like) {
  return q(
    `SELECT delta::int AS delta, reason, lot::text AS lot, "refId", "createdAt", "expiresAt" FROM points_transactions WHERE "userId" = $1 AND reason LIKE $2 ORDER BY "createdAt"`,
    userId,
    like,
  );
}

/**
 * Khách cho ca U2: chèn dòng users như AuthService tạo khi đăng nhập Zalo lần đầu (bộ khung cũng chèn users thẳng — API không có
 * đường tạo user nào khác), rồi onboarding + địa chỉ mặc định HCM qua API thật. Idempotent.
 */
export async function ensureCustomer({ id, name, phone }) {
  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) {
    await prisma.user.create({
      data: {
        id,
        zaloId: `uat-zalo-${id.slice(4).replace(/_/g, '-')}`,
        fullName: name,
        phone,
        phoneVerifiedAt: phone ? new Date() : null,
        referralCode: `U2${id.slice(4).replace(/_/g, '').toUpperCase()}`.slice(0, 16),
        role: 'CUSTOMER',
      },
    });
    await apiOk(L, 'POST', '/me/onboarding', { user: id, body: { segments: ['home_clean', 'eco'] } });
  }
  return addressOf(id, name, phone);
}

export async function addressOf(userId, name = 'Khách U2', phone = null) {
  const a = await prisma.address.findFirst({ where: { userId, isDefault: true } });
  if (a) return a.id;
  const u = await prisma.user.findUnique({ where: { id: userId } });
  const r = await apiOk(L, 'POST', '/me/addresses', {
    user: userId,
    body: {
      recipient: name, phone: phone ?? u.phone ?? '0909000000', province: 'Thành phố Hồ Chí Minh', district: '', ward: 'Phường Bến Thành',
      street: '12 Lê Lợi', provinceCode: '84_VN79', districtCode: '', wardCode: '84_VN7926743', isDefault: true,
    },
  });
  return r.id;
}

export async function variation(sku) {
  const v = await prisma.variation.findUnique({ where: { sku }, select: { id: true, sku: true, stock: true, retailPrice: true, salePrice: true, product: { select: { slug: true, name: true } } } });
  if (!v) throw new Error(`không có sku ${sku}`);
  return v;
}

export async function clearCart(userId) {
  const cart = await api(L, 'GET', '/cart', { user: userId });
  for (const it of cart.body?.items ?? []) await api(L, 'DELETE', `/cart/items/${it.id}`, { user: userId });
  if (cart.body?.couponCode || cart.body?.coupon) await api(L, 'DELETE', '/cart/coupon', { user: userId });
  return cart.body?.items?.length ?? 0;
}

/** Bỏ hàng vào giỏ qua API giỏ của chính khách (bước chuẩn bị; đặt đơn đi qua UI Mini App). */
export async function fillCart(userId, lines, coupon) {
  await clearCart(userId);
  for (const [sku, qty] of lines) {
    const v = await variation(sku);
    await apiOk(L, 'POST', '/cart/items', { user: userId, body: { variationId: v.id, quantity: qty, addSource: 'pdp' } });
  }
  if (coupon) return api(L, 'POST', '/cart/coupon', { user: userId, body: { code: coupon } });
  return null;
}

/**
 * Đặt đơn trên Mini App thật: /cart → "Thanh toán (n)" → /checkout → (bật Điểm Xanh) → "Đặt hàng · …".
 * Trả báo giá cuối mà màn checkout dùng, mã đơn, ảnh, request API.
 */
export async function miniCheckout(userId, { usePoints = false, shot, payment } = {}) {
  const s = await open(L.n, userId, { headless, path: '/cart' });
  const p = s.page;
  try {
    const pay = p.getByRole('button', { name: /^Thanh toán \(\d+\)$/ });
    await pay.waitFor({ timeout: 20_000 });
    let lastQuote = null;
    p.on('response', async (r) => {
      if (r.url().endsWith('/api/checkout/quote') && r.request().method() === 'POST' && r.status() < 300) {
        lastQuote = await r.json().catch(() => lastQuote);
      }
    });
    await pay.click();
    await p.waitForURL(/\/checkout$/, { timeout: 15_000 });
    const place = p.getByRole('button', { name: /^Đặt hàng · / });
    await place.waitFor({ timeout: 20_000 });
    if (payment) await p.getByRole('radio', { name: payment }).click();
    if (usePoints) {
      const box = p.getByRole('checkbox', { name: /Điểm Xanh/ });
      await box.waitFor({ timeout: 10_000 });
      const before = lastQuote;
      await box.click();
      for (let i = 0; i < 40 && (lastQuote === before || !(lastQuote?.pointsUsed > 0)); i++) await sleep(250);
    }
    await sleep(800);
    await p.screenshot({ path: path.join(SHOTS, `${shot ?? userId}-checkout.png`) });
    const quote = lastQuote;
    const label = await place.textContent();
    const placedResp = p.waitForResponse((r) => r.url().endsWith('/api/checkout/place-order') && r.request().method() === 'POST', { timeout: 30_000 });
    await place.click();
    const placedR = await placedResp;
    const placed = await placedR.json();
    const code = placed.code ?? placed.order?.code ?? placed.orders?.[0]?.code;
    await p.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
    await p.screenshot({ path: path.join(SHOTS, `${shot ?? userId}-placed.png`) });
    const bad = s.requests.filter((r) => !r.mocked && !(r.status > 0 && r.status < 400));
    return { code, status: placedR.status(), placed, quote, label, bad, blocked: s.blocked };
  } finally {
    await s.close();
  }
}

/** Đặt đơn bằng API của chính khách (bước dựng dữ liệu, không phải bước đang kiểm). */
export async function apiPlace(userId, lines, { coupon, pointsToUse, paymentMethod = 'COD' } = {}) {
  await fillCart(userId, lines, coupon);
  const addressId = await addressOf(userId);
  const quote = await apiOk(L, 'POST', '/checkout/quote', { user: userId, body: { addressId, ...(pointsToUse ? { pointsToUse } : {}) } });
  const placed = await apiOk(L, 'POST', '/checkout/place-order', {
    user: userId,
    headers: { 'idempotency-key': randomUUID() },
    body: { addressId, paymentMethod, expectedTotal: quote.total, ...(pointsToUse ? { pointsToUse } : {}) },
  });
  const code = placed.code ?? placed.order?.code ?? placed.orders?.[0]?.code;
  return { code, quote, placed };
}

export async function waitPushed(code) {
  for (let i = 0; i < 40; i++) {
    const o = await prisma.order.findUnique({ where: { code }, select: { pancakeOrderId: true } });
    if (o?.pancakeOrderId) return o.pancakeOrderId;
    await sleep(500);
  }
  throw new Error(`đơn ${code} chưa lên giả Pancake`);
}

/** Pancake giao đơn: shipped rồi delivered (webhook thật tới API lane). */
export async function deliver(code) {
  await waitPushed(code);
  const a = await sendOrderStatus(L, code, 'shipped');
  const b = await sendOrderStatus(L, code, 'delivered');
  return { shipped: `${a.event?.status}/${a.order?.status}`, delivered: `${b.event?.status}/${b.order?.status}` };
}

/** Lùi mốc giao của đơn N ngày (đơn + dòng sổ của đơn), để luật thời gian có hiệu lực. */
export async function backdateOrder(code, days, { ledgerToo = false } = {}) {
  await x(
    `UPDATE orders SET "deliveredAt" = "deliveredAt" - ($2 || ' days')::interval, "shippedAt" = "shippedAt" - ($2 || ' days')::interval,
       "deliveredEffectsAt" = "deliveredEffectsAt" - ($2 || ' days')::interval, "createdAt" = "createdAt" - ($2 || ' days')::interval WHERE code = $1`,
    code,
    String(days),
  );
  if (ledgerToo) {
    const o = await prisma.order.findUnique({ where: { code }, select: { id: true } });
    await x(
      `UPDATE points_transactions SET "createdAt" = "createdAt" - ($2 || ' days')::interval, "expiresAt" = "expiresAt" - ($2 || ' days')::interval WHERE "refId" = $1`,
      o.id,
      String(days),
    );
  }
}

export function runJob(alias, args) {
  const argv = [path.join(HARNESS, 'run-job.mjs'), String(L.n), alias, ...(args ? ['--args', JSON.stringify(args)] : [])];
  try {
    const out = execFileSync('node', argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 20 * 1024 * 1024 });
    return JSON.parse(out);
  } catch (e) {
    // run-job đôi khi thoát mã ≠ 0 lúc đóng context vì ioredis "Connection is closed" (BullMQ đóng kết nối sau khi job đã chạy xong):
    // hạn chế của bộ khung, không phải của app. Job đã chạy thì stdout có JSON kết quả; không có thì ném lỗi thật.
    const out = String(e.stdout ?? '').trim();
    if (out.startsWith('{')) return { ...JSON.parse(out), harnessExitError: 'ioredis Connection is closed khi đóng context' };
    if (/Connection is closed/.test(String(e.stderr ?? '')) && /\[run-job\]/.test(String(e.stderr ?? ''))) {
      return { lane: L.n, job: alias, result: null, harnessExitError: 'ioredis Connection is closed khi đóng context (job đã chạy, xem log)' };
    }
    throw e;
  }
}

export async function setConfig(key, value) {
  return apiOk(L, 'PUT', '/admin/config', { user: 'uat_admin', body: { key, value } });
}

export async function loyaltyOf(userId) {
  return (await api(L, 'GET', '/me/loyalty', { user: userId })).body;
}

export const pct = (goods, p, mult) => Math.floor((Math.floor(goods) * Math.round(p * 100) * Math.round(mult * 100)) / 1_000_000);

export async function shotPage(userId, p, name, { wait = 1500, full = false } = {}) {
  const s = await open(L.n, userId, { headless, path: p });
  try {
    await sleep(wait);
    const file = path.join(SHOTS, `${name}.png`);
    await s.page.screenshot({ path: file, fullPage: full });
    const text = await s.page.evaluate(() => document.body.innerText);
    return { file: path.relative(path.resolve(HERE, '../..'), file), text, requests: s.requests };
  } finally {
    await s.close();
  }
}

export async function main(fn) {
  const results = [];
  try {
    await fn(results);
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    await closePrisma();
  }
  console.log('\nTÓM TẮT');
  for (const r of results) console.log(`${r.id}\t${r.verdict}\t${r.title}`);
  if (results.some((r) => r.verdict === 'FAIL')) process.exitCode = 1;
}
