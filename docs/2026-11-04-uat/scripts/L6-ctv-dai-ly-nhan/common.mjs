// Bộ hàm dùng chung của lane 6 (L6-ctv-dai-ly-nhan). Chạy từ gốc worktree uat-1104 với Node 22.
// Mọi script import file này; kết quả mỗi ca ghi nối vào results.jsonl cùng thư mục.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const UAT = '/Users/longla/coding/tubutree-mini-app/.claude/worktrees/uat-1104';
export const H = `${UAT}/docs/2026-10-20-uat/tools/uat-harness`;
export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SHOTS = path.resolve(HERE, '../../shots/L6-ctv-dai-ly-nhan');
export const RESULTS = path.join(HERE, 'results.jsonl');
export const LANE_N = 6;
const lib = await import(`${H}/lib.mjs`);
export const L = lib.lane(LANE_N);
export const { api, sleep, closePrisma, prismaFor } = lib;
export const prisma = lib.prismaFor(L);
export const NODE = process.execPath;

/** SQL đọc trên DB lane (trả mảng dòng; bigint → number). */
export async function sql(q, ...params) {
  let rows;
  try { rows = await prisma.$queryRawUnsafe(q, ...params); } catch (e) { throw new Error(`SQL lỗi: ${String(e.meta?.message ?? e.message).slice(0, 300)} :: ${q.slice(0, 200)}`); }
  return JSON.parse(JSON.stringify(rows, (_k, v) => (typeof v === 'bigint' ? Number(v) : v)));
}
export async function exec(q, ...params) {
  try { return await prisma.$executeRawUnsafe(q, ...params); } catch (e) { throw new Error(`SQL lỗi: ${String(e.meta?.message ?? e.message).slice(0, 300)} :: ${q.slice(0, 200)}`); }
}

export function rec(r) {
  const row = { at: new Date().toISOString(), ...r };
  fs.appendFileSync(RESULTS, JSON.stringify(row) + '\n');
  const tag = row.verdict === 'PASS' ? 'PASS' : row.verdict;
  console.log(`[${tag}] ${row.id} ${row.title ?? ''} :: ${String(row.actual ?? '').slice(0, 240)}`);
  return row;
}
/** So khớp: eq(a,b) ghi PASS/FAIL. */
export function check(id, meta, ok, actual, evidence, verdict) {
  return rec({ id, ...meta, actual, evidence, verdict: verdict ?? (ok ? 'PASS' : 'FAIL') });
}

export const call = async (user, method, p, body, headers) => {
  const r = await api(L, method, p, { user, body, headers });
  return r;
};
export const short = (v, n = 400) => JSON.stringify(v)?.slice(0, n);

export function sh(file, args, opts = {}) {
  return execFileSync(NODE, [`${H}/${file}`, ...args], { cwd: UAT, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, ...opts });
}
export function runJob(job, args) {
  const a = [`${LANE_N}`, job];
  if (args) a.push('--args', JSON.stringify(args));
  // run-job.mjs đôi khi thoát mã 1 sau khi đã in kết quả (worker BullMQ gặp "Connection is closed" lúc đóng Redis): đọc stdout, thử lại tối đa 3 lần.
  let last;
  for (let i = 0; i < 3; i++) {
    let out = '';
    try {
      out = execFileSync(NODE, [`${H}/run-job.mjs`, ...a], { cwd: UAT, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      out = String(e.stdout ?? '');
      last = e;
    }
    try { return JSON.parse(out); } catch { if (out.trim()) return out; }
  }
  throw last;
}
export function webhook(code, status, extra = []) {
  return sh('pancake-webhook.mjs', [`${LANE_N}`, code, status, ...extra]);
}
export function bankPay(code, amount, content) {
  return sh('bank-webhook.mjs', [`${LANE_N}`, code, `${amount}`, content ?? `${code} thanh toan`]);
}

let idem = 0;
export const idk = (p = 'l6') => `${p}-${Date.now()}-${++idem}`;

/** Bảo đảm user có một địa chỉ (copy dạng của returning). Trả addressId. */
export async function ensureAddress(user) {
  const list = (await call(user, 'GET', '/me/addresses')).body;
  const arr = Array.isArray(list) ? list : list.data ?? list.items ?? [];
  if (arr[0]) return arr[0].id;
  const r = await call(user, 'POST', '/me/addresses', {
    recipient: `Khách ${user}`, phone: '0901000099', province: 'Thành phố Hồ Chí Minh', district: '', ward: 'Phường Bến Thành', street: '12 Lê Lợi',
    provinceCode: '84_VN79', districtCode: '', wardCode: '84_VN7926743', isDefault: true,
  });
  if (!r.ok) throw new Error(`tạo địa chỉ ${user}: ${r.status} ${short(r.body)}`);
  return r.body.id;
}

export async function varId(sku) {
  const [r] = await sql('SELECT id FROM variations WHERE sku = $1', sku);
  if (!r) throw new Error(`không có biến thể ${sku}`);
  return r.id;
}

export async function clearCart(user) {
  const cart = (await call(user, 'GET', '/cart')).body;
  for (const it of cart?.items ?? []) await call(user, 'DELETE', `/cart/items/${it.id}`);
}

/**
 * Mua hàng như khách: xoá giỏ, thêm hàng, đặt đơn. opts: referralCode, storefrontSlug, paymentMethod (COD|BANK_TRANSFER).
 * Trả { ok, status, code, order, body }.
 */
export async function buy(user, lines, opts = {}) {
  await clearCart(user);
  for (const [sku, qty] of lines) {
    const r = await call(user, 'POST', '/cart/items', { variationId: await varId(sku), quantity: qty });
    if (!r.ok) return { ok: false, step: 'cart', status: r.status, body: r.body };
  }
  const addressId = await ensureAddress(user);
  const body = { addressId, paymentMethod: opts.paymentMethod ?? 'COD' };
  if (opts.referralCode) body.referralCode = opts.referralCode;
  if (opts.storefrontSlug) body.storefrontSlug = opts.storefrontSlug;
  if (opts.pointsToUse) body.pointsToUse = opts.pointsToUse;
  const r = await call(user, 'POST', '/checkout/place-order', body, { 'idempotency-key': idk('l6buy') });
  const order = r.body?.order ?? r.body;
  return { ok: r.ok, status: r.status, code: order?.code, order, body: r.body };
}

export async function orderRow(code) {
  const [o] = await sql(`SELECT id, code, status, "paymentStatus" ps, "paymentMethod" pm, "userId", "referrerUserId" ref, "storefrontSlug" sf, subtotal, discount, "shippingFee" ship, total, "placedForCustomer" pfc FROM orders WHERE code = $1`, code);
  return o;
}
export async function commissionOf(code) {
  return sql(`SELECT c.id, c.status, c.amount, c."orderTotal", c."commissionableTotal" base, c.rate::float rate, c."lineAmounts", c."lockedAt", c."approvedAt", c."paidAt", c."walletPayoutId", c."affiliateUserId" uid FROM commissions c JOIN orders o ON o.id = c."orderId" WHERE o.code = $1`, code);
}
export async function notifs(userId, codeLike, since) {
  return sql(`SELECT id, "templateCode" code, channel, status, error, "sentAt", payload FROM notification_logs WHERE "userId" = $1 AND "templateCode" LIKE $2 ${since ? `AND "sentAt" >= '${since}'` : ''} ORDER BY "sentAt"`, userId, codeLike);
}
export const vnd = (n) => `${Number(n).toLocaleString('vi-VN')}đ`;
export const done = async () => { await closePrisma(); };
