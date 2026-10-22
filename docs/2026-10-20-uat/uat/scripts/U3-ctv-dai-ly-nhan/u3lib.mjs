// Thư viện chung cho các ca UAT lane 3 (CTV, đại lý, chủ nhãn). Dựa trên bộ khung tools/uat-harness.
// Mọi lời gọi tới API lane thật; DB chỉ đọc để đối chiếu, trừ các bước lùi ngày/dựng dữ liệu ghi rõ trong từng ca.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const HARNESS = path.resolve(HERE, '../../../tools/uat-harness');
const H = await import(path.join(HARNESS, 'lib.mjs'));
const MS = await import(path.join(HARNESS, 'miniapp-session.mjs'));
const WS = await import(path.join(HARNESS, 'web-session.mjs'));
const PW = await import(path.join(HARNESS, 'pancake-webhook.mjs'));

export const LANE = Number(process.env.UAT_LANE ?? 3);
export const L = H.lane(LANE);
export const SHOTS = path.resolve(HERE, '../../shots/U3-ctv-dai-ly-nhan');
export const OUT = path.join(HERE, 'out');
fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

export const { api, apiOk, findUser, sleep, realLogin } = H;
export const openMini = (user, opts = {}) => MS.open(LANE, user, { headless: true, ...opts });
export const openWeb = (user, opts = {}) => WS.openWeb(LANE, user, { headless: true, ...opts });
export const sendOrderStatus = (code, status, opts) => PW.sendOrderStatus(L, code, status, opts);

export const prisma = () => H.prismaFor(L);
export const closeDb = () => H.closePrisma();

/** SQL đọc/ghi trên DB lane, BigInt → Number. */
export async function sql(q, ...params) {
  const rows = await prisma().$queryRawUnsafe(q, ...params);
  return JSON.parse(JSON.stringify(rows, (_k, v) => (typeof v === 'bigint' ? Number(v) : v)));
}
export async function exec(q, ...params) {
  return prisma().$executeRawUnsafe(q, ...params);
}

const t0 = Date.now();
export const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))));

/** Bộ ghi kết quả ca: mỗi script ghi out/<tên>.json để dựng bảng báo cáo. */
export function recorder(name) {
  const cases = [];
  const file = path.join(OUT, `${name}.json`);
  return {
    cases,
    add(c) {
      const row = { at: new Date().toISOString(), ...c };
      cases.push(row);
      console.log(`${c.status.padEnd(7)} ${c.id} ${c.title ?? ''}`);
      if (c.status !== 'PASS') console.log('        thực tế:', typeof c.actual === 'string' ? c.actual : JSON.stringify(c.actual));
      fs.writeFileSync(file, JSON.stringify(cases, null, 2));
    },
    save() {
      fs.writeFileSync(file, JSON.stringify(cases, null, 2));
      const by = cases.reduce((m, c) => ((m[c.status] = (m[c.status] ?? 0) + 1), m), {});
      console.log(`== ${name}: ${JSON.stringify(by)} → ${file}`);
    },
  };
}

export async function shot(page, name) {
  const p = path.join(SHOTS, `${name}.png`);
  await page.screenshot({ path: p, fullPage: false }).catch(() => undefined);
  return path.relative(path.resolve(HERE, '../..'), p);
}

/**
 * run-job.mjs đôi khi in xong JSON kết quả rồi mới chết vì ioredis "Connection is closed" lúc đóng context (exit 1):
 * job đã chạy xong, nên đọc JSON từ stdout dù mã thoát khác 0 và ghi lại để báo ở mục "Hạn chế bộ khung".
 */
export const jobExitIssues = [];
export function runJob(job, args) {
  const a = [path.join(HARNESS, 'run-job.mjs'), String(LANE), job];
  if (args) a.push('--args', JSON.stringify(args));
  const r = spawnSync('node', a, { encoding: 'utf8', timeout: 180_000 });
  const m = (r.stdout ?? '').match(/\{[\s\S]*\}\s*$/);
  if (r.status !== 0) jobExitIssues.push({ job, status: r.status, tail: (r.stderr ?? '').split('\n').filter((l) => /Error|error/.test(l)).slice(0, 2) });
  if (!m) throw new Error(`run-job ${job} không in kết quả (exit ${r.status}): ${(r.stderr ?? '').slice(-400)}`);
  return JSON.parse(m[0]);
}

/**
 * Khách mới thêm cho lane 3 (giống seed-roles.mjs upsertUsers: chỉ dòng users chèn thẳng, phần còn lại qua API).
 * Khách mới phải "mới thật" ở từng ca đơn đầu, nên mỗi ca dùng một id riêng.
 */
export async function ensureUser(id, { phone, name, onboard = true } = {}) {
  const p = prisma();
  const zaloId = `uat-zalo-${id.slice(4).replace(/_/g, '-')}`;
  const ref = `UAT${id.slice(4).replace(/_/g, '').toUpperCase()}`.slice(0, 16);
  await p.user.upsert({
    where: { id },
    update: {},
    create: { id, zaloId, fullName: name ?? `Khách ${id}`, phone, phoneVerifiedAt: phone ? new Date() : null, referralCode: ref, role: 'CUSTOMER' },
  });
  if (onboard) {
    const u = await p.user.findUnique({ where: { id } });
    if (!(u.metadata && u.metadata.onboardedAt)) await apiOk(L, 'POST', '/me/onboarding', { user: id, body: { segments: ['home_clean', 'eco'] } });
  }
  return p.user.findUnique({ where: { id } });
}

/** Địa chỉ mặc định HCM (cùng mã địa giới seed-roles dùng cho khách quay lại, có trong fixtures/geo.json của giả Pancake). */
export async function ensureAddress(userId, phone) {
  const list = await apiOk(L, 'GET', '/me/addresses', { user: userId });
  const arr = Array.isArray(list) ? list : (list.items ?? []);
  if (arr.length) return arr.find((a) => a.isDefault) ?? arr[0];
  return apiOk(L, 'POST', '/me/addresses', {
    user: userId,
    body: {
      recipient: `Người nhận ${userId}`, phone, province: 'Thành phố Hồ Chí Minh', district: '', ward: 'Phường Bến Thành',
      street: '12 Lê Lợi', provinceCode: '84_VN79', districtCode: '', wardCode: '84_VN7926743', isDefault: true,
    },
  });
}

export async function clearCart(userId) {
  const cart = await api(L, 'GET', '/cart', { user: userId });
  for (const it of cart.body?.items ?? []) await api(L, 'DELETE', `/cart/items/${it.id}`, { user: userId });
}

export async function variationBySku(sku) {
  const v = await prisma().variation.findFirst({ where: { sku }, include: { product: true } });
  if (!v) throw new Error(`không thấy SKU ${sku}`);
  return v;
}

/** Đơn app qua API thật (giỏ → báo giá → đặt), trả {code, quote, placed}. */
export async function placeOrderApi(userId, items, { paymentMethod = 'COD', referralCode, storefrontSlug, addressPhone } = {}) {
  const u = await findUser(L, userId);
  const addr = await ensureAddress(userId, addressPhone ?? u.phone ?? '0900000000');
  await clearCart(userId);
  for (const it of items) await apiOk(L, 'POST', '/cart/items', { user: userId, body: { variationId: it.variationId, quantity: it.quantity, addSource: 'pdp' } });
  const quote = await apiOk(L, 'POST', '/checkout/quote', { user: userId, body: { addressId: addr.id, ...(storefrontSlug ? { storefrontSlug } : {}) } });
  const placed = await api(L, 'POST', '/checkout/place-order', {
    user: userId,
    headers: { 'idempotency-key': `u3-${userId}-${Date.now()}` },
    body: { addressId: addr.id, paymentMethod, expectedTotal: quote.total, ...(referralCode ? { referralCode } : {}), ...(storefrontSlug ? { storefrontSlug } : {}) },
  });
  if (!placed.ok) throw new Error(`place-order ${placed.status}: ${JSON.stringify(placed.body).slice(0, 400)}`);
  const b = placed.body;
  const code = b.code ?? b.order?.code ?? b.orders?.[0]?.code;
  return { code, codes: (b.orders ?? []).map((o) => o.code), quote, placed: b };
}

export async function waitPancake(code, tries = 60) {
  for (let i = 0; i < tries; i++) {
    const o = await prisma().order.findUnique({ where: { code }, select: { pancakeOrderId: true } });
    if (o?.pancakeOrderId) return o.pancakeOrderId;
    await sleep(500);
  }
  return null;
}

/** Giao xong qua webhook Pancake thật của lane (shipped → delivered). */
export async function deliver(code) {
  const pid = await waitPancake(code);
  if (!pid) throw new Error(`đơn ${code} chưa lên giả Pancake`);
  const s = await sendOrderStatus(code, 'shipped');
  const d = await sendOrderStatus(code, 'delivered');
  return { shipped: s.order?.status, delivered: d.order?.status, event: d.event?.status };
}

export const commissionsOf = (orderCode) =>
  sql(
    `SELECT c.id, c."affiliateUserId", c.status::text AS status, c.amount::int AS amount, c."orderTotal"::int AS "orderTotal",
            c."commissionableTotal"::int AS "commissionableTotal", c.rate::float AS rate, c."lineAmounts", c."lockedAt", c."approvedAt", c."paidAt", c."payoutBatchId"
       FROM commissions c JOIN orders o ON o.id = c."orderId" WHERE o.code = $1`,
    orderCode,
  );

export const orderRow = async (code) =>
  (await sql(`SELECT id, code, "userId", "referrerUserId", "storefrontSlug", status::text AS status, "paymentMethod"::text AS pm, "paymentStatus"::text AS ps,
              subtotal::int AS subtotal, discount::int AS discount, "shippingFee"::int AS "shippingFee", total::int AS total, type::text AS type FROM orders WHERE code = $1`, code))[0];

export const itemsOf = (code) =>
  sql(`SELECT oi.id, v.sku, oi.quantity::int AS q, oi."unitPrice"::int AS unit, oi.total::int AS total, oi."paidTotal"::int AS "paidTotal", p."storefrontId"
         FROM order_items oi JOIN orders o ON o.id = oi."orderId" JOIN variations v ON v.id = oi."variationId" JOIN products p ON p.id = v."productId" WHERE o.code = $1`, code);

/** Dòng hàng Tubu (không giờ vàng, không đối tác) đủ tiền hàng ≥ target, chừa 10 tồn mỗi SKU cho ca khác. */
export async function itemsForGoods(target, skus = ['FUWA-LD-2L', 'VIS-EYE-15', 'VIS-SR-30', 'VIS-CR-100', 'POLANG-SP-500', 'LP-ARA-250', 'POLANG-BW-500', 'POLANG-SP-300']) {
  const out = [];
  let left = target;
  for (const sku of skus) {
    if (left <= 0) break;
    const v = await variationBySku(sku);
    const price = v.salePrice ?? v.retailPrice;
    const q = Math.min(Math.max(0, v.stock - 10), Math.ceil(left / price), 999);
    if (q <= 0) continue;
    out.push({ variationId: v.id, quantity: q, sku, price });
    left -= q * price;
  }
  if (left > 0) throw new Error(`không đủ tồn để dựng ${target}đ tiền hàng (thiếu ${left}đ)`);
  return out;
}

/** Khách chuyển khoản đúng nội dung = mã đơn (bank-webhook.mjs đóng vai ngân hàng + Pancake đối soát). */
export function bankPay(code, amount, content) {
  const a = [path.join(HARNESS, 'bank-webhook.mjs'), String(LANE), code, String(amount), ...(content ? [content] : [])];
  const r = spawnSync('node', a, { encoding: 'utf8', timeout: 120_000 });
  const m = (r.stdout ?? '').match(/\{[\s\S]*\}\s*$/);
  if (!m) throw new Error(`bank-webhook ${code} lỗi (exit ${r.status}): ${(r.stderr ?? '').slice(-400)}`);
  return JSON.parse(m[0]);
}

/** Lùi hoa hồng LOCKED của đơn quá 10 ngày rồi chạy job duyệt (giữ 10 ngày đã kiểm riêng ở U3-06). */
export async function matureCommissions(orderCode) {
  await exec(
    `UPDATE commissions SET "lockedAt" = now() - interval '10 days 5 minutes' WHERE status = 'LOCKED' AND "orderId" = (SELECT id FROM orders WHERE code = $1)`,
    orderCode,
  );
  return runJob('commissions.approve-due');
}

export function short(v, n = 600) {
  const s = typeof v === 'string' ? v : (JSON.stringify(v) ?? String(v));
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
