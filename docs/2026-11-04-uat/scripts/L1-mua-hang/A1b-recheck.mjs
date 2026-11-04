// A1b: chấm lại 4 ca đặt đơn của A1 đã bị chấm FAIL do kỳ vọng usedCount sai trong oracle (luật thật: redeemInTx chỉ tăng usedCount khi mã có usageLimit,
// apps/api/src/modules/coupons/coupons.service.ts:361; admin.service.ts:1707). Không đặt đơn mới: đọc lại số liệu đã ghi và đối chiếu SQL.
// Chạy:  node /Users/longla/coding/tubutree-mini-app/.claude/worktrees/gl-1103-docs/docs/2026-11-04-uat/scripts/L1-mua-hang/A1b-recheck.mjs
import fs from 'node:fs';
import path from 'node:path';
import { RESULTS, sql, rec, closePrisma } from './lib.mjs';
import { reconcileOrder } from './kit.mjs';

const latest = new Map();
for (const l of fs.readFileSync(path.join(RESULTS, 'A1.jsonl'), 'utf8').split('\n').filter(Boolean)) {
  const r = JSON.parse(l);
  latest.set(r.id, r);
}
for (const id of ['A1-07-place', 'A1-21-place', 'A1-23-place', 'A1-30-place']) {
  const r = latest.get(id);
  if (!r?.code) continue;
  const rc = await reconcileOrder(r.code);
  const o = rc.row;
  const cp = o.couponCode ? (await sql(`select code, "usageLimit", "usedCount"::int uc from coupons where code = '${o.couponCode}'`))[0] : null;
  const redeemed = rc.redeem;
  const sameNumbers = r.expected === r.actual;
  const usedOk = !cp || cp.usageLimit == null || cp.uc >= 1;
  const ok = sameNumbers && rc.ok && redeemed === (o.couponCode ? 1 : 0) && usedOk;
  rec('A1', {
    id,
    persona: r.persona,
    surface: r.surface,
    journey: r.journey,
    step: r.step,
    expected: r.expected,
    actual: r.actual,
    evidence: `chấm lại bằng SQL: đơn ${r.code} số học khớp=${rc.ok}; coupon_redemptions=${redeemed}; mã ${cp ? `${cp.code} usageLimit=${cp.usageLimit} usedCount=${cp.uc}` : 'không'}. usedCount chỉ tăng khi mã có usageLimit (coupons.service.ts:361), nên +0 đúng luật; kỳ vọng cũ của oracle sai.`,
    status: ok ? 'PASS' : 'FAIL',
    code: r.code,
  });
}
await closePrisma();
