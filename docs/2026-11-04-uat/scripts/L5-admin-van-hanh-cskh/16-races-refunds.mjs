// Hoàn tiền khách chạy ĐỒNG THỜI: verify, claim, mark-paid bị bấm nhiều lần / nhiều người cùng lúc. Một khoản chỉ hoàn một lần, ví không đổi (chi tay).
// Dùng: node 16-races-refunds.mjs
import { execFileSync } from 'node:child_process';
import { call, check, rec, save, short, sql, placeOrder, waitPancake, orderRow, userState, sleep } from './_lib.mjs';

const WT = '/Users/longla/coding/tubutree-mini-app/.claude/worktrees/uat-1104';
const HOOK = `${WT}/docs/2026-10-20-uat/tools/uat-harness/pancake-webhook.mjs`;
const env = { ...process.env, PATH: `${process.env.HOME}/.local/node/node-v22.23.3-darwin-arm64/bin:${process.env.PATH}` };
const hook = (code, st) => execFileSync('node', [HOOK, '5', code, st], { cwd: WT, env, encoding: 'utf8', timeout: 90000 });
const J = 'Hoàn tiền khách đồng thời';
const ok = (r) => r.status >= 200 && r.status < 300;
const refundOf = async (orderId) => (await sql(`SELECT id, status::text s, amount::int a FROM order_customer_refunds WHERE "orderId"=$1`, [orderId]))[0];

// A. COD trả hàng -> khoản UNVERIFIED; 4 request "verify" cùng lúc (Kế toán + Admin)
{
  const { code } = await placeOrder('returning', { method: 'COD' });
  await waitPancake(code);
  const o = await orderRow(code);
  await call('kho', 'PUT', `/admin/orders/${o.id}/status`, { status: 'PACKED' });
  hook(code, 'shipped'); hook(code, 'delivered');
  for (let i = 0; i < 30 && (await orderRow(code)).status !== 'DELIVERED'; i++) await sleep(500);
  hook(code, 'returned');
  for (let i = 0; i < 30 && (await orderRow(code)).status !== 'RETURNED'; i++) await sleep(500);
  const r0 = await refundOf(o.id);
  const u0 = await userState('uat_returning');
  rec('L5-RRF-00', 'ketoan', 'api', J, 'Chuẩn bị: COD giao rồi hoàn về', 'khoản UNVERIFIED', `khoản ${r0?.s} ${r0?.a}đ`, r0, r0?.s === 'UNVERIFIED' ? 'PASS' : 'BLOCKED');
  if (r0?.s === 'UNVERIFIED') {
    const rs = await Promise.all([1, 2, 3, 4].map((i) => call(i % 2 ? 'ketoan' : 'admin', 'POST', `/admin/customer-refunds/${r0.id}/verify`, { note: `race ${i}` })));
    const r1 = await refundOf(o.id);
    const hist = await sql(`SELECT count(*)::int n FROM order_status_history WHERE "orderId"=$1 AND note LIKE '%race%'`, [o.id]);
    const u1 = await userState('uat_returning');
    check('L5-RRF-01', 'ketoan', 'api', J, '4 request "Xác nhận hãng đã thu COD" cùng lúc', 'đúng 1 thành công, khoản PENDING một lần, Ví không đổi', rs.filter(ok).length === 1 && r1.s === 'PENDING' && u1.wallet === u0.wallet, `mã ${rs.map((r) => r.status).join(',')}; khoản ${r1.s}; ví ${u0.wallet} -> ${u1.wallet}`, { hist });
  }
}

// B. Huỷ đơn chuyển khoản đã trả, khách chọn ngân hàng -> PENDING; claim cùng lúc; mark-paid cùng lúc
{
  const { code } = await placeOrder('returning', { method: 'BANK_TRANSFER' });
  await waitPancake(code);
  const o = await orderRow(code);
  await call('ketoan', 'POST', `/admin/orders/${o.id}/confirm-payment`, { bankRef: 'UATRACEGD' });
  await call('returning', 'POST', `/orders/${code}/cancel`, { refundMethod: 'BANK', bankName: 'Vietcombank', accountNumber: '0011004567890', accountName: 'NGUYEN THI QUAY LAI', cancelReasonCode: 'CHANGED_MIND' });
  const r0 = await refundOf(o.id);
  const u0 = await userState('uat_returning');
  rec('L5-RRF-02a', 'returning', 'api', J, 'Chuẩn bị: huỷ đơn đã trả, chọn nhận về ngân hàng', 'khoản PENDING', `khoản ${r0?.s} ${r0?.a}đ`, r0, r0?.s === 'PENDING' ? 'PASS' : 'BLOCKED');
  if (r0?.s === 'PENDING') {
    const cl = await Promise.all([1, 2, 3, 4].map((i) => call(i % 2 ? 'ketoan' : 'admin', 'POST', `/admin/customer-refunds/${r0.id}/claim`, {})));
    const r1 = await refundOf(o.id);
    const [by] = await sql(`SELECT "claimedBy" c FROM order_customer_refunds WHERE id=$1`, [r0.id]).catch(() => [{}]);
    check('L5-RRF-02', 'ketoan', 'api', J, '4 request "Bắt đầu chuyển khoản" (claim) cùng lúc', 'đúng 1 người giữ khoản (PROCESSING), các request còn lại 4xx', cl.filter(ok).length === 1 && r1.s === 'PROCESSING', `mã ${cl.map((r) => r.status).join(',')}; khoản ${r1.s}; người giữ ${by.c ?? '?'}`, cl.map((r) => short(r.body, 80)));
    const winner = (cl.findIndex(ok) + 1) % 2 ? 'ketoan' : 'admin';
    const mp = await Promise.all([1, 2, 3, 4].map(() => call(winner, 'POST', `/admin/customer-refunds/${r0.id}/mark-paid`, { bankRef: 'UATRACEFT' })));
    const r2 = await refundOf(o.id);
    const u1 = await userState('uat_returning');
    const nt = await sql(`SELECT count(*)::int n FROM notification_logs WHERE "userId"='uat_returning' AND payload::text LIKE $1`, [`%${code}%`]).catch(() => [{ n: -1 }]);
    check('L5-RRF-03', winner, 'api', J, '4 request "Đã chi" cùng lúc từ người đang giữ khoản', 'đúng 1 thành công, COMPLETED, Ví không đổi (chi tay), sổ Ví = số dư', mp.filter(ok).length === 1 && r2.s === 'COMPLETED' && u1.wallet === u0.wallet && u1.wallet === u1.wsum, `mã ${mp.map((r) => r.status).join(',')}; khoản ${r2.s}; ví ${u0.wallet} -> ${u1.wallet}; thông báo cho khách của đơn: ${nt[0].n}`, mp.map((r) => short(r.body, 80)));
  }
}
const fin = await userState('uat_returning');
check('L5-RRF-04', 'returning', 'api', J, 'Cuối lượt: Ví và điểm khớp sổ', 'khớp', fin.wallet === fin.wsum && fin.points === fin.psum, `ví ${fin.wallet}/${fin.wsum}; điểm ${fin.points}/${fin.psum}`, fin);
save('16-races-refunds');
process.exit(0);
