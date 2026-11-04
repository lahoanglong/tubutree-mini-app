// Thư viện dùng chung của lane 4 (Đổi rác, Cộng đồng, Vườn Xanh). Chạy từ gốc worktree uat-1104 với Node 22 trong PATH.
// Mọi script: node <OUT>/scripts/L4-doi-rac-cong-dong/<file>.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const WT = '/Users/longla/coding/tubutree-mini-app/.claude/worktrees/uat-1104';
export const H = `${WT}/docs/2026-10-20-uat/tools/uat-harness`;
export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const OUT = path.resolve(HERE, '../..');
export const SHOTS = path.join(OUT, 'shots/L4-doi-rac-cong-dong');
export const RESULTS = path.join(HERE, 'results.jsonl');
const libUrl = `file://${H}/lib.mjs`;
export const lib = await import(libUrl);
export const L = lib.lane(4);
export const sleep = lib.sleep;

/** Gọi API lane; in một dòng tóm tắt. */
export async function call(user, method, p, body, headers = {}) {
  const r = await lib.api(L, method, p, { user, body, headers });
  return r;
}
export const idem = (tag) => ({ 'idempotency-key': `l4-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` });

const norm = (v) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? Number(x) : x)));
export async function sql(q) {
  const prisma = lib.prismaFor(L);
  const verb = q.trim().split(/\s+/)[0].toUpperCase();
  if (['SELECT', 'WITH'].includes(verb)) return norm(await prisma.$queryRawUnsafe(q));
  return { affected: await prisma.$executeRawUnsafe(q) };
}
export async function closeDb() { await lib.closePrisma(); }

export const vnToday = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);

/** Số dư và sổ điểm của một user (đối chiếu: users.pointsBalance = SUM(points_transactions.delta) theo lô). */
export async function pointsState(userId) {
  const [u] = await sql(`SELECT "pointsBalance" AS bal FROM users WHERE id='${userId}'`);
  const [s] = await sql(`SELECT COALESCE(SUM(delta),0) AS sum FROM points_transactions WHERE "userId"='${userId}'`);
  return { balance: u?.bal ?? null, ledgerSum: s?.sum ?? null };
}
export async function ledgerRows(userId, where = '') {
  return sql(`SELECT delta, reason, "refType", "refId", lot::text AS lot, "expiresAt", "createdAt" FROM points_transactions WHERE "userId"='${userId}' ${where} ORDER BY "createdAt", id`);
}

export function rec(entry) {
  const row = { at: new Date().toISOString(), ...entry };
  fs.appendFileSync(RESULTS, `${JSON.stringify(row)}\n`);
  const tag = row.status === 'PASS' ? 'PASS' : row.status;
  console.log(`[${tag}] ${row.id} ${row.title ?? ''} | ${typeof row.actual === 'string' ? row.actual.slice(0, 200) : JSON.stringify(row.actual).slice(0, 200)}`);
  return row;
}
/** Ghi ca: expected/actual để người đọc đối chiếu; status tự tính nếu truyền ok. */
export function check(id, meta, ok, actual, evidence) {
  return rec({ id, ...meta, actual, evidence, status: ok === 'BLOCKED' ? 'BLOCKED' : ok === 'NEEDOWNER' ? 'CẦN CHỦ' : ok ? 'PASS' : 'FAIL' });
}
export const short = (b, n = 300) => (typeof b === 'string' ? b : (JSON.stringify(b) ?? 'undefined')).slice(0, n);
export const msg = (r) => (Array.isArray(r.body?.message) ? r.body.message.join(' | ') : r.body?.message ?? '');

/** Văn phong đợt 8: không "Vui lòng", không "chúng tôi", không "...". */
export function toneIssues(text) {
  const t = String(text ?? '');
  const out = [];
  if (/vui lòng/i.test(t)) out.push('Vui lòng');
  if (/chúng tôi/i.test(t)) out.push('chúng tôi');
  if (/\.\.\.|…/.test(t)) out.push('dấu ...');
  return out;
}
export function readParams() { return JSON.parse(fs.readFileSync(path.join(HERE, 'params.json'), 'utf8')); }
export function saveParams(p) { fs.writeFileSync(path.join(HERE, 'params.json'), JSON.stringify(p, null, 2)); }
