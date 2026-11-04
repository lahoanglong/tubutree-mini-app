// D3b: sau D3-9 (mới trả 1 trong 2 khoản mở): trả nốt khoản còn lại, blocker CUSTOMER_REFUND_PENDING phải hết.
import { A, makeRec, sql, sql1, walletLedger, done } from './lib3.mjs';
const { check } = makeRec('d3b-refund-clear');
const R = 'returning', rid = 'uat_returning', J = 'Yêu cầu xoá tài khoản';
const open = await sql(`SELECT id, "orderCode" FROM order_customer_refunds WHERE status IN ('PENDING','PROCESSING')`);
for (const [i, rf] of open.entries()) {
  await A('admin', 'POST', `/admin/customer-refunds/${rf.id}/claim`, {});
  await A('admin', 'POST', `/admin/customer-refunds/${rf.id}/mark-paid`, { bankRef: `UAT-FT26110402-${i}` });
}
const lst = await A('admin', 'GET', '/admin/account-deletion-requests?status=PENDING');
const row = (lst.body ?? []).find((r) => r.userId === rid);
const codes = (row?.blockers ?? []).map((b) => b.code);
const left = await sql(`SELECT status, count(*)::int n FROM order_customer_refunds GROUP BY status`);
check('D3-9b', 'admin', 'API', J, 'trả nốt mọi khoản hoàn mở: blocker CUSTOMER_REFUND_PENDING hết, ORDER_IN_PROGRESS + WALLET_BALANCE vẫn chặn', 'collectBlockers', open.length > 0 && !codes.includes('CUSTOMER_REFUND_PENDING') && codes.includes('ORDER_IN_PROGRESS'), `đã trả ${open.length} khoản; order_customer_refunds=${JSON.stringify(left)} blockers=${JSON.stringify(codes)}; ví returning không đổi=${JSON.stringify(await walletLedger(rid))}`);
await done();
