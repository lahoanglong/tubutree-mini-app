import { call, sql, short, placeOrder, orderRow, userState, sleep } from './_lib.mjs';
const dist = {};
const bad = [];
for (let i = 0; i < 12; i++) {
  const { code } = await placeOrder('returning', { method: 'BANK_TRANSFER' });
  const o = await orderRow(code);
  const u0 = await userState('uat_returning');
  const cancelWho = i % 2 ? 'cskh' : 'returning';
  const cancelCall = cancelWho === 'returning' ? call('returning', 'POST', `/orders/${code}/cancel`, { reason: 'UAT race' }) : call('cskh', 'PUT', `/admin/orders/${o.id}/status`, { status: 'CANCELLED', note: 'UAT race' });
  const [pay, can] = await Promise.all([call('ketoan', 'POST', `/admin/orders/${o.id}/confirm-payment`, {}), cancelCall]);
  await sleep(1500);
  const o1 = await orderRow(code);
  const u1 = await userState('uat_returning');
  const rf = await sql(`SELECT status::text s, source::text src, amount::int a, "destination"::text d FROM customer_refunds WHERE "orderId"=$1`, [o.id]).catch(() => []);
  const key = `${cancelWho}: pay ${pay.status}, cancel ${can.status} -> ${o1.status}/${o1.ps}, ví +${u1.wallet - u0.wallet}, refunds ${JSON.stringify(rf.map((r) => r.s + ':' + r.src))}`;
  dist[key] = (dist[key] ?? 0) + 1;
  const walletOk = u1.wallet === u1.wsum;
  const paidAndCancelledNoRefund = o1.status === 'CANCELLED' && o1.paidAt && o1.ps === 'PAID' && u1.wallet - u0.wallet === 0 && rf.length === 0;
  if (!walletOk || paidAndCancelledNoRefund) bad.push({ code, key });
}
console.log(JSON.stringify(dist, null, 1));
console.log('BAD', JSON.stringify(bad));
process.exit(0);
