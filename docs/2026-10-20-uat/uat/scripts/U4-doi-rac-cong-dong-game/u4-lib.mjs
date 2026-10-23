// Thư viện chung của các script ca UAT lane 4 (đổi rác, cộng đồng, Vườn Xanh, thông báo).
// Mọi bước đi qua API lane thật hoặc UI thật (Mini App Vite / web next dev) của bộ khung uat-harness.
// Mỗi script ghi kết quả vào results/<tên>.json; report.mjs dựng bảng markdown từ các file đó.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { api, closePrisma, lane, prismaFor, sleep } from '../../../tools/uat-harness/lib.mjs';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SHOTS = path.resolve(HERE, '../../shots/U4-doi-rac-cong-dong-game');
export const RESULTS = path.join(HERE, 'results');
fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(RESULTS, { recursive: true });

export const LANE_N = Number(process.env.U4_LANE ?? process.argv[2] ?? 4);
export const L = lane(LANE_N);
export const prisma = () => prismaFor(L);
export const headless = !process.argv.includes('--headed');

const t0 = Date.now();
export const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

/** Một ca = một dòng bảng. checks: các kiểm tra con; ca PASS khi mọi kiểm tra đạt (trừ khi đặt status tay: BLOCKED). */
export class Case {
  constructor(id, { role, journey, steps, expected }) {
    Object.assign(this, { id, role, journey, steps, expected, checks: [], evidence: [], actualParts: [], status: null, notes: [] });
  }
  check(name, ok, detail) {
    this.checks.push({ name, ok: Boolean(ok), detail });
    log(ok ? 'OK  ' : 'FAIL', this.id, name, detail === undefined ? '' : JSON.stringify(detail).slice(0, 400));
    return Boolean(ok);
  }
  actual(s) {
    this.actualParts.push(s);
  }
  ev(s) {
    this.evidence.push(typeof s === 'string' ? s : JSON.stringify(s));
  }
  block(reason) {
    this.status = 'BLOCKED';
    this.actualParts.push(reason);
  }
  get result() {
    if (this.status) return this.status;
    if (this.checks.length === 0) return 'BLOCKED';
    return this.checks.every((c) => c.ok) ? 'PASS' : 'FAIL';
  }
  toJSON() {
    return {
      id: this.id,
      role: this.role,
      journey: this.journey,
      steps: this.steps,
      expected: this.expected,
      actual: this.actualParts.join(' '),
      evidence: this.evidence,
      checks: this.checks,
      status: this.result,
    };
  }
}

export function saveResults(name, cases) {
  const file = path.join(RESULTS, `${name}.json`);
  fs.writeFileSync(file, JSON.stringify(cases.map((c) => c.toJSON()), null, 2));
  const by = cases.reduce((m, c) => ((m[c.result] = (m[c.result] ?? 0) + 1), m), {});
  console.log(`${name}: ${JSON.stringify(by)} → ${file}`);
}

/** Chạy thân ca, bắt lỗi ném ra thành kiểm tra FAIL "ca chạy hết" để ca không kẹt kết quả rỗng. */
export async function runCase(c, fn) {
  try {
    await fn(c);
  } catch (e) {
    c.check('ca chạy hết không ném lỗi', false, e instanceof Error ? e.message.slice(0, 500) : String(e));
  }
  return c;
}

export const call = (method, p, user, body, headers) => api(L, method, p, { user, body, headers });
export const idem = () => ({ 'idempotency-key': randomUUID() });

/** Sổ điểm của một user: số dư users.pointsBalance và SUM(delta) sổ STANDARD (lô quy đổi tách riêng). */
export async function ledger(userId) {
  const db = prisma();
  const [u] = await db.$queryRawUnsafe(`SELECT "pointsBalance"::int AS balance FROM users WHERE id = $1`, userId);
  const [s] = await db.$queryRawUnsafe(
    `SELECT COALESCE(SUM(delta),0)::int AS sum, COUNT(*)::int AS n FROM points_transactions WHERE "userId" = $1 AND lot = 'STANDARD'`,
    userId,
  );
  return { balance: u.balance, ledgerSum: s.sum, rows: s.n };
}

export async function ledgerRows(userId, reasonLike) {
  return prisma().$queryRawUnsafe(
    `SELECT delta::int AS delta, reason, "refType", "refId", lot, "expiresAt" FROM points_transactions WHERE "userId" = $1 AND reason LIKE $2 ORDER BY "createdAt"`,
    userId,
    reasonLike,
  );
}

export async function notifs(userId, templateCode) {
  return prisma().$queryRawUnsafe(
    `SELECT id, "templateCode", channel, status, payload->>'body' AS body, "sentAt" FROM notification_logs WHERE "userId" = $1 AND ($2::text IS NULL OR "templateCode" = $2) ORDER BY "sentAt"`,
    userId,
    templateCode ?? null,
  );
}

export async function q(sql, ...args) {
  return prisma().$queryRawUnsafe(sql, ...args);
}

export async function setConfig(key, value) {
  const r = await call('PUT', '/admin/config', 'admin', { key, value });
  if (!r.ok) throw new Error(`PUT /admin/config ${key} → ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
  return r;
}

/** Cấu hình API được cache (SystemConfigService); chờ cho chắc bản mới có hiệu lực. */
export async function waitConfig(key, want, tries = 20) {
  for (let i = 0; i < tries; i++) {
    const r = await call('GET', '/config/public', null);
    const flat = JSON.stringify(r.body ?? {});
    if (want(r.body, flat)) return true;
    await sleep(500);
  }
  return false;
}

export const short = (v, n = 300) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > n ? `${s.slice(0, n)}…` : s;
};

export const shot = (name) => path.join(SHOTS, `${name}.png`);
export const relShot = (name) => `shots/U4-doi-rac-cong-dong-game/${name}.png`;

export { sleep, closePrisma };
