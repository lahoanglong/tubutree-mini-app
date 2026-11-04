// Z: đối soát cuối lane: SQL toàn bộ user + chạy hai script đối soát của API trên DB lane 3 (chế độ chỉ xem).
import { execSync } from 'node:child_process';
import { makeRec, sql, sql1, done, WT, H } from './lib3.mjs';
const { rec, check } = makeRec('z-reconcile');
const J = 'Đối soát cuối lane';
const pts = await sql(`SELECT u.id, u."pointsBalance"::int bal, COALESCE(SUM(p.delta) FILTER (WHERE p.lot='STANDARD'),0)::int std, u."pointsConvertedBalance"::int conv, COALESCE(SUM(p.delta) FILTER (WHERE p.lot='CONVERTED'),0)::int cv FROM users u LEFT JOIN points_transactions p ON p."userId"=u.id GROUP BY u.id HAVING u."pointsBalance" <> COALESCE(SUM(p.delta) FILTER (WHERE p.lot='STANDARD'),0) OR u."pointsConvertedBalance" <> COALESCE(SUM(p.delta) FILTER (WHERE p.lot='CONVERTED'),0)`);
check('Z-1', 'mọi user', 'SQL', J, 'users.pointsBalance = SUM(delta) lô STANDARD và pointsConvertedBalance = SUM(delta) lô CONVERTED, cho mọi user của lane', 'points-ledger.ts; points-reconcile.ts', pts.length === 0, `số user lệch=${pts.length} ${JSON.stringify(pts)}`);
const wal = await sql(`SELECT u.id, u."walletBalance"::int bal, COALESCE(SUM(w.delta),0)::int s FROM users u LEFT JOIN wallet_transactions w ON w."userId"=u.id GROUP BY u.id HAVING u."walletBalance" <> COALESCE(SUM(w.delta),0)`);
check('Z-2', 'mọi user', 'SQL', J, 'users.walletBalance = SUM(wallet_transactions.delta), cho mọi user của lane', 'wallet-ledger.service.ts applyWalletDelta', wal.length === 0, `số user lệch=${wal.length} ${JSON.stringify(wal)}`);
const neg = await sql1(`SELECT count(*)::int n FROM users WHERE "walletBalance"<0 OR "pointsBalance"<0 OR "pointsConvertedBalance"<0`);
check('Z-3', 'mọi user', 'SQL', J, 'không user nào có ví hoặc điểm âm', 'applyWalletDelta; points-ledger.ts', neg.n === 0, `số user âm=${neg.n}`);
const env = execSync(`grep ^DATABASE_URL= ${H}/state/lane-3/lane.env | cut -d= -f2-`, { encoding: 'utf8' }).trim();
for (const [id, script] of [['Z-4', 'reconcile-points.ts'], ['Z-5', 'reconcile-wallet.ts']]) {
  let out, code = 0;
  try {
    out = execSync(`npx tsx scripts/${script}`, { cwd: `${WT}/apps/api`, env: { ...process.env, DATABASE_URL: env }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 200_000 });
  } catch (e) {
    code = e.status ?? 1;
    out = String(e.stdout || e.message);
  }
  check(id, 'DB lane 3', 'script', J, `apps/api/scripts/${script} (chỉ xem): 0 user lệch, thoát mã 0`, `apps/api/scripts/${script}`, code === 0 && /0 user lệch|Không có user nào lệch|User bị lệch   : 0/.test(out), `mã thoát=${code}; ${out.replace(/\s+/g, ' ').slice(0, 300)}`);
}
await done();
