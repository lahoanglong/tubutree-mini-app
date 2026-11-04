import { call, sql, short, placeOrder, orderRow, sleep } from './_lib.mjs';
for (const who of ['cskh', 'admin']) {
  const { code } = await placeOrder('returning', { method: 'COD' });
  const o = await orderRow(code);
  const p = await call('kho', 'PUT', `/admin/orders/${o.id}/status`, { status: 'PACKED' });
  const c = await call(who, 'PUT', `/admin/orders/${o.id}/status`, { status: 'CANCELLED', note: 'UAT huỷ sau khi đóng gói' });
  const o1 = await orderRow(code);
  const hist = await sql(`SELECT "fromStatus" f, "toStatus" t, "actorId" a, note FROM order_status_history WHERE "orderId"=$1 ORDER BY "createdAt"`, [o.id]);
  console.log(who, 'pack', p.status, 'cancel', c.status, 'bodyStatus', c.body?.status, 'final', o1.status, JSON.stringify(hist), short(c.body, 200));
}
process.exit(0);
