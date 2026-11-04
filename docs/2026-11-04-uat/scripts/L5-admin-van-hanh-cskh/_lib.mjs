// Thư viện chung cho script lane L5 (admin, vận hành, CSKH). Chạy từ gốc worktree uat-1104:
//   export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH
//   node <đường dẫn script>.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WT = '/Users/longla/coding/tubutree-mini-app/.claude/worktrees/uat-1104';
const H = `${WT}/docs/2026-10-20-uat/tools/uat-harness`;
export const harness = await import(`${H}/lib.mjs`);
export const { api, lane, laneEnv, prismaFor, closePrisma, sleep, mintAccessFor, findUser } = harness;
export const L = lane(5);
export const ENV = laneEnv(L);
export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const OUT = path.resolve(HERE, '../..');
export const SHOTS = path.join(OUT, 'shots/L5-admin-van-hanh-cskh');
export const RESULTS = path.join(HERE, 'results');
fs.mkdirSync(RESULTS, { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });

export const rows = [];
/** Ghi một ca. verdict: PASS | FAIL | BLOCKED | CAN_CHU. */
export function rec(id, persona, size, journey, step, expect, actual, evidence, verdict) {
  const r = { id, persona, size, journey, step, expect, actual, evidence, verdict };
  rows.push(r);
  console.log(`[${verdict}] ${id} | ${persona} | ${journey} | ${step}\n   kỳ vọng: ${expect}\n   thực tế: ${actual}\n   bằng chứng: ${typeof evidence === 'string' ? evidence : JSON.stringify(evidence)}`);
  return r;
}
export function check(id, persona, size, journey, step, expect, cond, actual, evidence, failVerdict = 'FAIL') {
  return rec(id, persona, size, journey, step, expect, actual, evidence, cond ? 'PASS' : failVerdict);
}
export function save(name) {
  fs.writeFileSync(path.join(RESULTS, `${name}.json`), JSON.stringify(rows, null, 2));
  const c = rows.reduce((a, r) => ((a[r.verdict] = (a[r.verdict] ?? 0) + 1), a), {});
  console.log(`\n== ${name}: ${JSON.stringify(c)}`);
}

export const short = (v, n = 240) => (typeof v === 'string' ? v : (JSON.stringify(v) ?? String(v))).slice(0, n);
export const T = {};
/** Token theo bí danh persona (cache). */
export async function tok(alias) {
  if (!T[alias]) T[alias] = (await mintAccessFor(L, alias)).token;
  return T[alias];
}
export const call = async (alias, method, p, body, headers) => {
  const token = alias ? await tok(alias) : undefined;
  return api(L, method, p, { token, body, headers });
};
export const sql = async (q, params = []) => {
  const prisma = prismaFor(L);
  const out = await prisma.$queryRawUnsafe(q, ...params);
  return JSON.parse(JSON.stringify(out, (_k, v) => (typeof v === 'bigint' ? Number(v) : v)));
};
export const idem = () => `uat-l5-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

/** Quy tắc giọng đợt 8 (brief): không "Vui lòng", không "chúng tôi", không "...". */
export function toneProblems(text) {
  const t = typeof text === 'string' ? text : JSON.stringify(text);
  const out = [];
  if (/vui lòng/i.test(t)) out.push('có "Vui lòng"');
  if (/chúng tôi/i.test(t)) out.push('có "chúng tôi"');
  if (/\.\.\.|…/.test(t)) out.push('có "..."');
  return out;
}

/** Đặt đơn bằng API thật dưới danh nghĩa persona. Trả mã đơn. opts: {slug, qty, method, usePoints} */
export async function placeOrder(alias, { slug = 'nuoc-rua-chen-fuwa3e', qty = 1, method = 'COD', extra = {} } = {}) {
  const cart = (await call(alias, 'GET', '/cart')).body;
  for (const it of cart.items ?? []) await call(alias, 'DELETE', `/cart/items/${it.id}`);
  const pr = (await call(alias, 'GET', `/products/${slug}`)).body;
  const add = await call(alias, 'POST', '/cart/items', { variationId: pr.variations[0].id, quantity: qty });
  if (!add.ok) throw new Error(`thêm giỏ lỗi ${add.status} ${short(add.body)}`);
  const addrs = (await call(alias, 'GET', '/me/addresses')).body;
  const addressId = (Array.isArray(addrs) ? addrs : addrs.data ?? addrs.items ?? [])[0]?.id;
  const r = await call(alias, 'POST', '/checkout/place-order', { addressId, paymentMethod: method, ...extra }, { 'idempotency-key': idem() });
  if (!r.ok) throw new Error(`đặt đơn lỗi ${r.status} ${short(r.body)}`);
  const code = r.body.code ?? r.body.order?.code ?? r.body.orders?.[0]?.code;
  return { code, res: r.body };
}
export async function waitPancake(code, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const [o] = await sql(`SELECT "pancakeOrderId" p FROM orders WHERE code=$1`, [code]);
    if (o?.p) return o.p;
    await sleep(500);
  }
  return null;
}
export const orderRow = async (code) => (await sql(`SELECT id, code, status, "paymentMethod" pm, "paymentStatus" ps, total, "pointsUsed" pu, "pointsEarned" pe, "pancakeOrderId" pk, "paidAt", "deliveredAt", "pancakeAttention" pa FROM orders WHERE code=$1`, [code]))[0];
export const userState = async (id) => (await sql(`SELECT "walletBalance"::int wallet, "pointsBalance"::int points, (SELECT COALESCE(SUM(delta),0)::int FROM wallet_transactions w WHERE w."userId"=u.id) wsum, (SELECT COALESCE(SUM(delta),0)::int FROM points_transactions p WHERE p."userId"=u.id AND p.lot='STANDARD') psum FROM users u WHERE id=$1`, [id]))[0];
