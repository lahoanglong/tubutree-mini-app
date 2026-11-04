// Thư viện chung của lane 3 (L3-tai-khoan-diem-vi). Chạy từ gốc worktree uat-1104:
//   export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH
//   node /Users/longla/coding/tubutree-mini-app/.claude/worktrees/gl-1103-docs/docs/2026-11-04-uat/scripts/L3-tai-khoan-diem-vi/<ca>.mjs
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const WT = '/Users/longla/coding/tubutree-mini-app/.claude/worktrees/uat-1104';
export const H = `${WT}/docs/2026-10-20-uat/tools/uat-harness`;
export const OUT = '/Users/longla/coding/tubutree-mini-app/.claude/worktrees/gl-1103-docs/docs/2026-11-04-uat';
export const KEY = 'L3-tai-khoan-diem-vi';
export const SHOTS = `${OUT}/shots/${KEY}`;
export const RES = `${OUT}/scripts/${KEY}/results`;
fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(RES, { recursive: true });

const lib = await import(`${H}/lib.mjs`);
const hook = await import(`${H}/pancake-webhook.mjs`);
export const { api, lane, findUser, prismaFor, closePrisma, sleep, laneEnv } = lib;
export const { sendOrderStatus } = hook;
export const L = lane(3);
export const prisma = prismaFor(L);

export const sql = async (q, ...p) =>
  JSON.parse(JSON.stringify(await prisma.$queryRawUnsafe(q, ...p), (_k, v) => (typeof v === 'bigint' ? Number(v) : v)));
export const sql1 = async (q, ...p) => (await sql(q, ...p))[0];
export const exec = async (q, ...p) => prisma.$executeRawUnsafe(q, ...p);

/** Gọi API bằng persona (tự ký token) hoặc token sẵn. */
export const A = (user, method, p, body, headers = {}) => api(L, method, p, { user, body, headers });
export const idem = (tag) => ({ 'idempotency-key': `l3-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` });

const results = [];
export function makeRec(file) {
  const out = path.join(RES, `${file}.json`);
  const rec = (id, persona, khổ, journey, step, expected, actual, evidence, status) => {
    const row = { id, persona, khổ, journey, step, expected, actual, evidence, status };
    results.push(row);
    const mark = status === 'PASS' ? 'OK  ' : status;
    console.log(`[${mark}] ${id} ${persona}/${khổ} ${step} :: ${String(actual).slice(0, 200)}`);
    fs.writeFileSync(out, JSON.stringify(results, null, 2));
    return row;
  };
  const check = (id, persona, khổ, journey, step, expected, ok, actual, evidence) =>
    rec(id, persona, khổ, journey, step, expected, actual, evidence ?? actual, ok ? 'PASS' : 'FAIL');
  return { rec, check, results };
}

export function job(name, args) {
  const a = [`${H}/run-job.mjs`, '3', name, ...(args ? ['--args', JSON.stringify(args)] : [])];
  try {
    const out = execFileSync('node', a, { cwd: WT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 180_000 });
    return JSON.parse(out.slice(out.indexOf('{')));
  } catch (e) {
    return { error: String(e.stdout || e.message).slice(0, 400) };
  }
}

export function bankWebhook(code, amount, content) {
  const a = [`${H}/bank-webhook.mjs`, '3', code, String(amount), ...(content ? [content] : [])];
  try {
    return JSON.parse(execFileSync('node', a, { cwd: WT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000 }));
  } catch (e) {
    return { error: String(e.stdout || e.message).slice(0, 400) };
  }
}

export async function clearCart(user) {
  const c = await A(user, 'GET', '/cart');
  for (const it of c.body?.items ?? []) await A(user, 'DELETE', `/cart/items/${it.id}`);
}

export async function firstVariation(slug) {
  const p = await A('returning', 'GET', `/products/${slug}`);
  return p.body?.variations?.[0];
}

export async function ensureAddress(user, name = 'UAT Khách') {
  const list = (await A(user, 'GET', '/me/addresses')).body;
  const arr = Array.isArray(list) ? list : list?.data ?? list?.items ?? [];
  if (arr[0]) return arr[0].id;
  const phone = (await findUser(L, user)).phone ?? '0901000001';
  const r = await A(user, 'POST', '/me/addresses', {
    recipient: name,
    phone,
    province: 'Thành phố Hồ Chí Minh',
    district: '',
    ward: 'Phường Bến Thành',
    street: '12 Lê Lợi',
    provinceCode: '84_VN79',
    districtCode: '',
    wardCode: '84_VN7926743',
    isDefault: true,
  });
  if (!r.ok) throw new Error(`tạo địa chỉ ${user}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.id;
}

/** Đặt đơn: [{slug, qty}] → { quote, order }. */
export async function place(user, lines, { payment = 'COD', pointsToUse, tag = 'o' } = {}) {
  await clearCart(user);
  for (const l of lines) {
    const v = l.vid ?? (await firstVariation(l.slug)).id;
    const r = await A(user, 'POST', '/cart/items', { variationId: v, quantity: l.qty ?? 1 });
    if (!r.ok) throw new Error(`thêm giỏ ${l.slug}: ${r.status} ${JSON.stringify(r.body)}`);
  }
  const addressId = await ensureAddress(user);
  const quote = await A(user, 'POST', '/checkout/quote', { addressId, ...(pointsToUse !== undefined ? { pointsToUse } : {}) });
  const r = await A(user, 'POST', '/checkout/place-order', { addressId, paymentMethod: payment, ...(pointsToUse !== undefined ? { pointsToUse } : {}) }, idem(tag));
  return { quote: quote.body, quoteStatus: quote.status, placeStatus: r.status, order: r.ok ? r.body.order ?? r.body : null, raw: r.body };
}

export const codeOf = (o) => o?.code ?? o?.order?.code ?? o?.orders?.[0]?.code;

/** Đối soát sổ điểm của user: số dư từng lô và SUM(delta). */
export async function pointsLedger(userId) {
  return sql1(
    `SELECT u."pointsBalance"::int AS bal, u."pointsConvertedBalance"::int AS conv,
       COALESCE((SELECT SUM(delta) FROM points_transactions p WHERE p."userId"=u.id AND p.lot='STANDARD'),0)::int AS sum_std,
       COALESCE((SELECT SUM(delta) FROM points_transactions p WHERE p."userId"=u.id AND p.lot='CONVERTED'),0)::int AS sum_conv
     FROM users u WHERE u.id=$1`,
    userId,
  );
}
export async function walletLedger(userId) {
  return sql1(
    `SELECT u."walletBalance"::int AS bal, COALESCE((SELECT SUM(delta) FROM wallet_transactions w WHERE w."userId"=u.id),0)::int AS sum_w,
       (SELECT count(*)::int FROM wallet_transactions w WHERE w."userId"=u.id) AS n FROM users u WHERE u.id=$1`,
    userId,
  );
}

export async function waitPushed(code, ms = 40_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const r = await sql1(`SELECT "pancakeOrderId" id FROM orders WHERE code=$1`, code);
    if (r?.id) return true;
    await sleep(500);
  }
  return false;
}

export async function deliver(code) {
  const out = [];
  await waitPushed(code);
  for (const s of ['confirmed', 'packed', 'shipped', 'delivered']) {
    try {
      const r = await sendOrderStatus(L, code, s);
      out.push({ s, order: r.order?.status, event: r.event?.status });
    } catch (e) {
      out.push({ s, error: String(e.message).slice(0, 200) });
    }
  }
  return out;
}

export const money = (n) => `${Number(n).toLocaleString('vi-VN')}đ`;
export const done = async () => {
  await closePrisma();
};
