// C28: hai đại lý không thấy hay đụng được dữ liệu của nhau. Đại lý thứ hai = persona `new` được đổi vai thành DEALER bậc DEALER_1 rồi trả về CUSTOMER cuối script.
// Kiểm: danh sách đơn, sổ công nợ, mẫu đơn của đại lý thứ hai không có dữ liệu của `uat_dealer`; xem, huỷ đơn của đại lý kia và xoá mẫu đơn của họ đều bị từ chối;
// đơn, mẫu đơn trong SQL không đổi.
// Luật: dealer.service.ts (dealerContext theo userId, deleteTemplate deleteMany theo id + userId), orders.service.ts detailView/cancel kiểm userId.
// Chạy sau c19 và c23: node c28-dealer-idor.mjs (từ gốc worktree uat-1104).
import { call, short, sql, exec, check, done, sleep, varId, ensureAddress } from './common.mjs';

const D = 'uat_dealer';
const D2 = 'uat_new';
const PHONE2 = '0901000001';
const T = (title, persona, step, expect) => ({ title, persona, size: 'API', journey: title, step, expect });

const promote = await call('admin', 'POST', '/admin/users/role', { phone: PHONE2, role: 'DEALER', tierId: 'DEALER_1' });
await sleep(6500);
try {
  const me2 = await call('new', 'GET', '/dealer/me');
  check('L6-R06', T('Đại lý thứ hai được cấp vai DEALER bậc DEALER_1', 'new', 'POST /admin/users/role rồi GET /dealer/me', 'isDealer=true, bậc DEALER_1'), promote.status < 300 && me2.body?.isDealer === true && me2.body?.tier?.id === 'DEALER_1', `cấp=${promote.status}; me=${short({ isDealer: me2.body?.isDealer, tier: me2.body?.tier?.id, debt: me2.body?.currentDebt }, 200)}`, 'API');

  await ensureAddress('dealer');
  const save = await call('dealer', 'POST', '/dealer/templates', { name: 'Mẫu của đại lý 1', items: [{ variationId: await varId('SOK-CT-150'), quantity: 40 }] });
  const tid = save.body?.id;
  const [order] = await sql(`SELECT id, code, status::text s FROM orders WHERE "userId"=$1 AND type::text='DEALER' ORDER BY "createdAt" DESC LIMIT 1`, D);
  const [ledgerN] = await sql(`SELECT count(*)::int n FROM dealer_credit_ledgers WHERE "userId"=$1`, D);

  const list = await call('new', 'GET', '/dealer/orders');
  const rows = Array.isArray(list.body) ? list.body : list.body?.data ?? list.body?.items ?? [];
  const leakedOrders = rows.filter((r) => r.id === order.id || r.code === order.code || r.userId === D);
  const led = await call('new', 'GET', '/dealer/credit-ledger');
  const ledRows = Array.isArray(led.body) ? led.body : led.body?.data ?? led.body?.items ?? led.body?.entries ?? [];
  const tpl = await call('new', 'GET', '/dealer/templates');
  const tplRows = Array.isArray(tpl.body) ? tpl.body : tpl.body?.data ?? tpl.body?.items ?? [];
  check('L6-R07', T('Đại lý thứ hai xem danh sách đơn, sổ công nợ và mẫu đơn: không thấy dữ liệu của đại lý thứ nhất', 'new', 'GET /dealer/orders, /dealer/credit-ledger, /dealer/templates', `không có đơn ${order.code}; sổ không có ${ledgerN.n} dòng của uat_dealer; không có mẫu ${tid}`),
    list.status === 200 && leakedOrders.length === 0 && led.status === 200 && ledRows.length === 0 && tpl.status === 200 && !JSON.stringify(tplRows).includes(tid),
    `đơn=${list.status} (${rows.length} dòng, lộ ${leakedOrders.length}); sổ=${led.status} (${ledRows.length} dòng; đại lý 1 có ${ledgerN.n}); mẫu=${tpl.status} (${tplRows.length} dòng, lộ=${JSON.stringify(tplRows).includes(tid)})`, 'API + SQL');

  const view = await call('new', 'GET', `/orders/${order.id}`);
  const viewByCode = await call('new', 'GET', `/orders/by-code/${order.code}`);
  const cancel = await call('new', 'POST', `/orders/${order.id}/cancel`, {});
  const delTpl = await call('new', 'DELETE', `/dealer/templates/${tid}`);
  const [after] = await sql(`SELECT status::text s FROM orders WHERE id=$1`, order.id);
  const [tplStill] = await sql(`SELECT count(*)::int n FROM dealer_order_templates WHERE id=$1`, tid);
  check('L6-R08', T('Đại lý thứ hai xem chi tiết, huỷ đơn và xoá mẫu đơn của đại lý thứ nhất: bị từ chối, dữ liệu không đổi', 'new', 'GET /orders/:id, GET /orders/by-code/:code, POST /orders/:id/cancel, DELETE /dealer/templates/:id', `4xx cho cả bốn lệnh, không lộ SĐT hay địa chỉ trong thân phản hồi; đơn vẫn ${order.s}; mẫu còn trong SQL`),
    view.status >= 400 && view.status < 500 && viewByCode.status >= 400 && viewByCode.status < 500 && cancel.status >= 400 && cancel.status < 500 && (delTpl.status >= 400 || tplStill.n === 1) && after.s === order.s && tplStill.n === 1
      && !/0901000006|địa chỉ|phone/i.test(JSON.stringify([view.body, viewByCode.body, cancel.body])),
    `xem=${view.status}; xem theo mã=${viewByCode.status}; huỷ=${cancel.status} ${short(cancel.body?.message, 80)}; xoá mẫu=${delTpl.status}; đơn ${order.s}→${after.s}; mẫu còn=${tplStill.n}`, 'API + SQL orders/dealer_order_templates');

  await call('dealer', 'DELETE', `/dealer/templates/${tid}`);
} finally {
  const back = await call('admin', 'POST', '/admin/users/role', { phone: PHONE2, role: 'CUSTOMER' });
  await sleep(6500);
  const [u] = await sql(`SELECT role::text r FROM users WHERE id=$1`, D2);
  if (u.r !== 'CUSTOMER') await exec(`UPDATE users SET role='CUSTOMER' WHERE id=$1`, D2);
  const [u2] = await sql(`SELECT role::text r FROM users WHERE id=$1`, D2);
  check('L6-R09', T('Trả persona new về CUSTOMER sau khi thử', 'admin', 'POST /admin/users/role CUSTOMER', 'role = CUSTOMER'), u2.r === 'CUSTOMER', `trả=${back.status}; role=${u2.r}`, 'SQL users.role');
}
await done();
