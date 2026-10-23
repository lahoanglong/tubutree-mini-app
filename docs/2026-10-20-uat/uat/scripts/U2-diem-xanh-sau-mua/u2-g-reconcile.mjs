#!/usr/bin/env node
// U2-27..U2-28: chạy apps/api/scripts/reconcile-points.ts và reconcile-wallet.ts (DRY-RUN, không --apply) trên DB lane cuối phiên, kèm
// SQL tự đối chiếu số dư = SUM(delta) cho mọi user của lane. Dùng: node u2-g-reconcile.mjs [lane=7]
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { assertLaneDb } from '../../../tools/uat-harness/lib.mjs';
import { L, kase, main, q } from './u2lib.mjs';

const API = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../../../../apps/api');

function runTs(script) {
  assertLaneDb(L.databaseUrl);
  try {
    const out = execFileSync('node', ['node_modules/tsx/dist/cli.mjs', script], {
      cwd: API,
      encoding: 'utf8',
      env: { ...process.env, DATABASE_URL: L.databaseUrl },
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 10 * 1024 * 1024,
    });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

await main(async (results) => {
  {
    const c = kase('U2-27', 'reconcile-points.ts (DRY-RUN) trên DB lane: không user nào lệch lô STANDARD/CONVERTED; SQL tự đối chiếu cũng 0 lệch');
    try {
      const r = runTs('scripts/reconcile-points.ts');
      c.ev('output', r.out.trim().split('\n').slice(0, 30));
      c.check('thoát mã 0 và báo không lệch', r.code === 0 && /Không có user nào lệch/.test(r.out), { code: r.code });
      const drift = await q(`SELECT u.id, u."pointsBalance"::int AS bal, COALESCE(SUM(p.delta) FILTER (WHERE p.lot = 'STANDARD'),0)::int AS std, u."pointsConvertedBalance"::int AS conv, COALESCE(SUM(p.delta) FILTER (WHERE p.lot = 'CONVERTED'),0)::int AS cs
        FROM users u LEFT JOIN points_transactions p ON p."userId" = u.id GROUP BY u.id HAVING u."pointsBalance" <> COALESCE(SUM(p.delta) FILTER (WHERE p.lot = 'STANDARD'),0) OR u."pointsConvertedBalance" <> COALESCE(SUM(p.delta) FILTER (WHERE p.lot = 'CONVERTED'),0)`);
      const users = await q(`SELECT id, "pointsBalance"::int AS bal, "tierId" FROM users WHERE id LIKE 'uat_%' AND ("pointsBalance" <> 0 OR "tierId" IS NOT NULL) ORDER BY id`);
      c.ev('SQL lệch', drift);
      c.ev('số dư cuối các khách có điểm', users);
      c.check('SQL: 0 user có pointsBalance ≠ SUM(delta) theo lô', drift.length === 0, drift);
    } catch (e) {
      c.error(e);
    }
    results.push(c.finish());
  }
  {
    const c = kase('U2-28', 'reconcile-wallet.ts (DRY-RUN) trên DB lane: walletBalance = SUM(wallet_transactions) mọi user');
    try {
      const r = runTs('scripts/reconcile-wallet.ts');
      c.ev('output', r.out.trim().split('\n').slice(0, 30));
      const drift = await q(`SELECT u.id, u."walletBalance"::int AS bal, COALESCE(SUM(w.delta),0)::int AS sum FROM users u LEFT JOIN wallet_transactions w ON w."userId" = u.id GROUP BY u.id HAVING u."walletBalance" <> COALESCE(SUM(w.delta),0)`);
      const wallets = await q(`SELECT id, "walletBalance"::int AS wallet FROM users WHERE "walletBalance" <> 0 ORDER BY id`);
      c.ev('SQL lệch', drift);
      c.ev('ví khác 0', wallets);
      c.check('thoát mã 0', r.code === 0, { code: r.code });
      c.check('SQL: 0 user lệch ví', drift.length === 0, drift);
    } catch (e) {
      c.error(e);
    }
    results.push(c.finish());
  }
});
