// Thư viện chung cho ca UAT lane 5 (admin + nội bộ). Dựa trên bộ khung docs/2026-10-20-uat/tools/uat-harness.
// Mọi ca ghi kết quả vào results/<script>.json để make-report.mjs dựng bảng báo cáo; ảnh vào uat/shots/U5-admin-noi-bo/.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as H from '../../../tools/uat-harness/lib.mjs';
import { sendOrderStatus, postWebhook } from '../../../tools/uat-harness/pancake-webhook.mjs';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SHOTS = path.resolve(HERE, '../../shots/U5-admin-noi-bo');
export const RESULTS = path.join(HERE, 'results');
export const HARNESS = H.HARNESS;
export const LANE = Number(process.env.U5_LANE ?? 5);
export const L = H.lane(LANE);
fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(RESULTS, { recursive: true });
export { H, sendOrderStatus, postWebhook };

export const prisma = () => H.prismaFor(L);
export const sleep = H.sleep;

/** SQL trên DB lane (chỉ tubutree_uat_l5 qua assertLaneDb của bộ khung). Trả mảng dòng, số bigint đổi sang Number. */
export async function q(sql, ...params) {
  const rows = await prisma().$queryRawUnsafe(sql, ...params);
  return JSON.parse(JSON.stringify(rows, (_k, v) => (typeof v === 'bigint' ? Number(v) : v)));
}
export async function exec(sql, ...params) {
  return prisma().$executeRawUnsafe(sql, ...params);
}

/** Gọi API lane với token ký tại chỗ cho user (bí danh) — kèm x-throttle-bypass. */
export const api = (method, p, opts = {}) => H.api(L, method, p, opts);
export async function apiOk(method, p, opts) {
  const r = await api(method, p, opts);
  if (!r.ok) throw new Error(`${method} ${p} → ${r.status}: ${JSON.stringify(r.body).slice(0, 500)}`);
  return r.body;
}
export const as = (user) => ({ user });

/** Rút gọn body response cho cột bằng chứng. */
export function brief(v, n = 220) {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s && s.length > n ? `${s.slice(0, n)}…` : s;
}

/** Bộ ghi kết quả ca: mỗi script một file JSON. */
export function recorder(name) {
  const file = path.join(RESULTS, `${name}.json`);
  // Chạy lại một phần (--only=…) chỉ thay đúng các ca đó, giữ kết quả các ca khác của lần chạy trước.
  let prev = [];
  try {
    prev = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    prev = [];
  }
  const cases = prev;
  const t0 = Date.now();
  const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
  return {
    log,
    cases,
    /** c: {id, role, journey, steps, expected, actual, evidence, verdict} */
    add(c) {
      const row = { ...c, at: new Date().toISOString() };
      const i = cases.findIndex((x) => x.id === row.id);
      if (i >= 0) cases.splice(i, 1, row);
      else cases.push(row);
      cases.sort((a, b) => a.id.localeCompare(b.id));
      log(`${row.verdict.padEnd(7)} ${row.id} ${row.journey} — ${brief(row.actual, 300)}`);
      fs.writeFileSync(file, `${JSON.stringify(cases, null, 2)}\n`);
      return row;
    },
    save() {
      fs.writeFileSync(file, `${JSON.stringify(cases, null, 2)}\n`);
      const by = cases.reduce((m, c) => ((m[c.verdict] = (m[c.verdict] ?? 0) + 1), m), {});
      console.log(`== ${name}: ${JSON.stringify(by)} → ${file}`);
    },
  };
}

/** Chạy một ca an toàn: lỗi ném ra thành FAIL/BLOCKED có ghi lỗi, không làm chết cả script. */
export async function runCase(rec, meta, fn) {
  try {
    const out = await fn();
    return rec.add({ ...meta, ...out });
  } catch (e) {
    return rec.add({ ...meta, actual: `Lỗi khi chạy ca: ${String(e?.message ?? e).slice(0, 400)}`, evidence: meta.evidence ?? '', verdict: meta.onError ?? 'FAIL' });
  }
}

export async function shot(page, name, opts = {}) {
  const file = path.join(SHOTS, `${name}.png`);
  await page.screenshot({ path: file, fullPage: opts.fullPage ?? false });
  return `shots/U5-admin-noi-bo/${name}.png`;
}

/** Địa chỉ mặc định của user (tạo nếu chưa có) — cùng mã địa giới đã dùng trong seed (geo giả Pancake). */
export async function ensureAddress(user, phone) {
  const u = await H.findUser(L, user);
  const [a] = await q(`SELECT id FROM addresses WHERE "userId" = $1 ORDER BY "isDefault" DESC LIMIT 1`, u.id);
  if (a) return a.id;
  const addr = await apiOk('POST', '/me/addresses', {
    user: u.id,
    body: {
      recipient: u.fullName || 'Khách UAT', phone: phone ?? u.phone ?? '0901000099', province: 'Thành phố Hồ Chí Minh', district: '', ward: 'Phường Bến Thành',
      street: '34 Lê Lợi', provinceCode: '84_VN79', districtCode: '', wardCode: '84_VN7926743', isDefault: true,
    },
  });
  return addr.id;
}

/** Dọn giỏ rồi thêm hàng theo SKU, báo giá, đặt đơn bằng chính API của khách. lines: [{sku, qty}] */
export async function placeOrder(user, { lines, paymentMethod = 'COD', invoiceRequest, pointsToUse, storefrontSlug, note = 'UAT lane 5' }) {
  const u = await H.findUser(L, user);
  const addressId = await ensureAddress(u.id);
  const cart = await api('GET', '/cart', { user: u.id });
  for (const it of cart.body?.items ?? []) await api('DELETE', `/cart/items/${it.id}`, { user: u.id });
  for (const ln of lines) {
    const [v] = await q(`SELECT id FROM variations WHERE sku = $1`, ln.sku);
    if (!v) throw new Error(`không có SKU ${ln.sku}`);
    await apiOk('POST', '/cart/items', { user: u.id, body: { variationId: v.id, quantity: ln.qty, addSource: 'pdp' } });
  }
  const quote = await apiOk('POST', '/checkout/quote', { user: u.id, body: { addressId, ...(pointsToUse ? { pointsToUse } : {}), ...(storefrontSlug ? { storefrontSlug } : {}) } });
  const placed = await apiOk('POST', '/checkout/place-order', {
    user: u.id,
    headers: { 'idempotency-key': randomUUID() },
    body: { addressId, paymentMethod, expectedTotal: quote.total, note, ...(invoiceRequest ? { invoiceRequest } : {}), ...(pointsToUse ? { pointsToUse } : {}), ...(storefrontSlug ? { storefrontSlug } : {}) },
  });
  const code = placed.code ?? placed.order?.code ?? placed.orders?.[0]?.code;
  const [o] = await q(`SELECT id, code, status, "paymentStatus", "paymentMethod", total::int, subtotal::int, "shippingFee"::int FROM orders WHERE code = $1`, code);
  return { code, order: o, quote, placed };
}

export async function waitPancake(code, tries = 40) {
  for (let i = 0; i < tries; i++) {
    const [o] = await q(`SELECT "pancakeOrderId" FROM orders WHERE code = $1`, code);
    if (o?.pancakeOrderId) return o.pancakeOrderId;
    await sleep(500);
  }
  throw new Error(`đơn ${code} chưa lên giả Pancake`);
}

/** Chạy run-job.mjs của bộ khung, trả JSON kết quả. */
export function runJob(job, args) {
  const a = [path.join(HARNESS, 'run-job.mjs'), String(L.n), job];
  if (args) a.push('--args', JSON.stringify(args));
  const out = execFileSync('node', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 20 * 1024 * 1024 });
  return JSON.parse(out.trim().split('\n').filter((l) => l.trim()).join('\n'));
}

export function bankWebhook(code, amount, content) {
  const a = [path.join(HARNESS, 'bank-webhook.mjs'), String(L.n), code, String(amount)];
  if (content) a.push(content);
  return JSON.parse(execFileSync('node', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
}

/** Trạng thái điểm/ví của user: số dư cột và tổng sổ. */
export async function money(userId) {
  const [r] = await q(
    `SELECT u."pointsBalance"::int AS points, u."walletBalance"::int AS wallet, u."cashbackPending"::int AS "cashbackPending",
       (SELECT COALESCE(SUM(delta),0)::int FROM points_transactions p WHERE p."userId" = u.id AND p.lot = 'STANDARD') AS "pointsLedger",
       (SELECT COALESCE(SUM(delta),0)::int FROM wallet_transactions w WHERE w."userId" = u.id) AS "walletLedger"
     FROM users u WHERE u.id = $1`,
    userId,
  );
  return r;
}

export const openWebSession = async (user, p, opts = {}) => {
  const { openWeb } = await import('../../../tools/uat-harness/web-session.mjs');
  return openWeb(L.n, user, { width: 1440, path: p, ...opts });
};
export const openMini = async (user, p, opts = {}) => {
  const { open } = await import('../../../tools/uat-harness/miniapp-session.mjs');
  return open(L.n, user, { path: p, headless: true, ...opts });
};

export async function done() {
  await H.closePrisma();
}
