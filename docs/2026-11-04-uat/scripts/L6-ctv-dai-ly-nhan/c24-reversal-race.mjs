// C24: Pancake gửi trùng webhook "returned" cho một đơn đã giao (ba lệnh chạy cùng lúc) khi hoa hồng CTV đã vào Ví:
// hoa hồng bị thu hồi đúng một lần (Ví −1 lần), đơn RETURNED một lần, điểm của khách và kho chỉ đảo một lần; kết quả giống hệt khi chỉ gửi một webhook.
// Cách chứng minh: đơn S trả bằng một webhook (đối chứng), đơn R trả bằng ba webhook song song; so Ví CTV, kho, điểm khách của hai đơn.
// Luật: order-reversal.service.ts (đảo hoa hồng, điểm, kho một lần), wallet_transactions unique (userId, type, refId), Pancake có thể gửi lại webhook.
// Chạy sau c1: node c24-reversal-race.mjs (từ gốc worktree uat-1104). Dùng referralCode UATCTV và khách persona new.
import { spawn } from 'node:child_process';
import { H, UAT, L, call, short, sql, exec, buy, commissionOf, check, done, webhook, runJob, sleep } from './common.mjs';

const CTV = 'uat_ctv';
const NEW = 'uat_new';
const SKU = 'FUWA-HW-500';
const T = (title, persona, step, expect) => ({ title, persona, size: 'API', journey: title, step, expect });
const wallet = async () => {
  const [u] = await sql(`SELECT "walletBalance"::int w FROM users WHERE id=$1`, CTV);
  const [l] = await sql(`SELECT COALESCE(SUM(delta),0)::int s FROM wallet_transactions WHERE "userId"=$1`, CTV);
  return { w: u.w, ledger: l.s };
};
const buyerPoints = async () => (await sql(`SELECT "pointsBalance"::int p FROM users WHERE id=$1`, NEW))[0].p;
const stock = async () => (await sql(`SELECT stock::int s FROM variations WHERE sku=$1`, SKU))[0].s;
const reversals = async () => (await sql(`SELECT count(*)::int c FROM wallet_transactions WHERE "userId"=$1 AND type='COMMISSION_REVERSAL'`, CTV))[0].c;
const spawnHook = (code) => new Promise((resolve) => {
  const p = spawn(process.execPath, [`${H}/pancake-webhook.mjs`, '6', code, 'returned'], { cwd: UAT, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  p.stdout.on('data', (d) => { out += d; });
  p.stderr.on('data', (d) => { out += d; });
  p.on('close', (c) => resolve({ code: c, out: out.slice(0, 200) }));
});

const makePaid = async () => {
  const b = await buy('new', [[SKU, 2]], { paymentMethod: 'COD', referralCode: 'UATCTV' });
  webhook(b.code, 'shipped');
  webhook(b.code, 'delivered');
  await exec(`UPDATE commissions SET "lockedAt" = now() - interval '11 days' WHERE "orderId" = (SELECT id FROM orders WHERE code=$1) AND status='LOCKED'`, b.code);
  runJob('AffiliateService.approveDueCommissions');
  runJob('AffiliateService.autoTransferApprovedToWallet');
  const c = (await commissionOf(b.code))[0];
  return { code: b.code, comm: c };
};

const S = await makePaid();
const R = await makePaid();
const paidOk = S.comm?.status === 'PAID' && R.comm?.status === 'PAID';

const sBefore = { wallet: await wallet(), pts: await buyerPoints(), stock: await stock(), rev: await reversals() };
webhook(S.code, 'returned');
await sleep(2000);
const sAfter = { wallet: await wallet(), pts: await buyerPoints(), stock: await stock(), rev: await reversals() };
const sd = { wallet: sAfter.wallet.w - sBefore.wallet.w, pts: sAfter.pts - sBefore.pts, stock: sAfter.stock - sBefore.stock, rev: sAfter.rev - sBefore.rev };

const rBefore = { wallet: await wallet(), pts: await buyerPoints(), stock: await stock(), rev: await reversals() };
const hooks = await Promise.all([spawnHook(R.code), spawnHook(R.code), spawnHook(R.code)]);
await sleep(2500);
const rAfter = { wallet: await wallet(), pts: await buyerPoints(), stock: await stock(), rev: await reversals() };
const rd = { wallet: rAfter.wallet.w - rBefore.wallet.w, pts: rAfter.pts - rBefore.pts, stock: rAfter.stock - rBefore.stock, rev: rAfter.rev - rBefore.rev };
const rc = (await commissionOf(R.code))[0];
const sc = (await commissionOf(S.code))[0];
const [rO] = await sql(`SELECT status::text s FROM orders WHERE code=$1`, R.code);
const [sO] = await sql(`SELECT status::text s FROM orders WHERE code=$1`, S.code);

check('L6-V18', T('Hai đơn có hoa hồng đã vào Ví và đã giao: đối chứng (một webhook returned) cho đơn S', 'ctv', 'tạo hai đơn FUWA-HW-500 ×2 qua UATCTV, giao, duyệt, chuyển Ví; trả đơn S bằng một webhook', 'hoa hồng PAID trước khi trả; sau trả REJECTED, đơn RETURNED, đúng một dòng COMMISSION_REVERSAL'),
  paidOk && sc?.status === 'REJECTED' && sO.s === 'RETURNED' && sd.rev === 1 && sd.wallet < 0, `PAID trước=${paidOk}; sau=${sc?.status}/${sO.s}; Δ Ví=${sd.wallet}, dòng đảo=${sd.rev}, Δ điểm khách=${sd.pts}, Δ kho=${sd.stock}`, 'SQL commissions/wallet_transactions/orders');
check('L6-V19', T('Ba webhook returned trùng nhau chạy song song cho đơn R: hoa hồng thu hồi đúng một lần, kết quả bằng đơn S', 'ctv', 'ba tiến trình pancake-webhook.mjs returned cùng lúc cho đơn R', 'Ví CTV, điểm khách, kho thay đổi đúng bằng đơn S; một dòng COMMISSION_REVERSAL; đơn RETURNED; hoa hồng REJECTED'),
  rc?.status === 'REJECTED' && rO.s === 'RETURNED' && rd.rev === 1 && rd.wallet === sd.wallet && rd.pts === sd.pts && rd.stock === sd.stock,
  `webhook thoát=${hooks.map((h) => h.code).join(',')}; Δ Ví R=${rd.wallet} (S=${sd.wallet}); dòng đảo=${rd.rev}; Δ điểm R=${rd.pts} (S=${sd.pts}); Δ kho R=${rd.stock} (S=${sd.stock}); đơn=${rO.s}; hoa hồng=${rc?.status}`, 'SQL commissions/wallet_transactions/users/variations');
const end = await wallet();
check('L6-V20', T('Sau hai đơn trả: Ví CTV bằng tổng sổ Ví', 'ctv', 'SQL users.walletBalance và Σ wallet_transactions.delta', 'bằng nhau'), end.w === end.ledger, `Ví=${end.w}; sổ=${end.ledger}`, 'SQL');
await done();
