// C11: nhiệm vụ gian hàng (thưởng Điểm Xanh), phân quyền API quản trị (admin/kế toán/nhân viên khác/CTV/đại lý/khách), chống truy cập chéo (IDOR) gian hàng.
// Luật: storefront-quest.service.ts (QUESTS 2.000/2.000/2.000/1.000/5.000 điểm; grant idempotent theo (userId, reason) refType QUEST),
// @Roles('ADMIN') + @AllowStaff('KE_TOAN') ở payout-admin / dealer-admin / commission-admin controller. Chạy sau c3, c4: node c11-quests-rbac-idor.mjs.
import { call, short, sql, check, done } from './common.mjs';

const T = (title, persona, step, expect) => ({ title, persona, size: 'API', journey: title, step, expect });

// ---------- nhiệm vụ gian hàng ----------
const P = 'uat_ctv_pending';
const ql = await call('ctv_pending', 'GET', '/storefront/me/quests');
const defs = ql.body?.quests ?? [];
const reward = { profile_complete: 2000, add_5_products: 2000, notes_3: 2000, publish: 1000, first_order: 5000 };
check('L6-Q01', T('Danh sách nhiệm vụ gian hàng: 5 nhiệm vụ, điểm thưởng đúng luật, tiến độ không vượt mục tiêu', 'ctv_pending', 'GET /storefront/me/quests', '5 nhiệm vụ (profile_complete 2.000, add_5_products 2.000, notes_3 2.000, publish 1.000, first_order 5.000 Điểm Xanh); 0 ≤ progress ≤ goal'),
  ql.status === 200 && defs.length === 5 && defs.every((d) => d.rewardPoints === reward[d.code] && d.progress >= 0 && d.progress <= d.goal) && ql.body.levelMax === 5, `${ql.status} ${short(defs.map((d) => `${d.code}:${d.rewardPoints}:${d.progress}/${d.goal}${d.claimed ? ':đã nhận' : d.done ? ':chờ nhận' : ''}`), 400)}`, 'API');

const claimable = defs.filter((d) => d.done && !d.claimed);
const notDone = defs.find((d) => !d.done);
const [b0] = await sql(`SELECT "pointsBalance"::int p FROM users WHERE id=$1`, P);
let c1;
if (notDone) {
  c1 = await call('ctv_pending', 'POST', `/storefront/me/quests/${notDone.code}/claim`, {});
  const [b] = await sql(`SELECT "pointsBalance"::int p FROM users WHERE id=$1`, P);
  check('L6-Q02', T('Nhận nhiệm vụ chưa đạt: bị từ chối, điểm không đổi', 'ctv_pending', `POST claim ${notDone.code}`, '400 "Bạn chưa hoàn thành nhiệm vụ này."; điểm không đổi'), c1.status === 400 && /chưa hoàn thành/.test(JSON.stringify(c1.body)) && b.p === b0.p, `${c1.status} ${short(c1.body?.message, 120)}; điểm ${b0.p}→${b.p}`, 'SQL');
} else {
  check('L6-Q02', T('Nhận nhiệm vụ chưa đạt', 'ctv_pending', 'không còn nhiệm vụ chưa đạt', 'n/a'), false, 'mọi nhiệm vụ đã đạt, không dựng được ca', 'API', 'BLOCKED');
}
const bad = await call('ctv_pending', 'POST', '/storefront/me/quests/khong_co/claim', {});
check('L6-Q03', T('Nhận nhiệm vụ không tồn tại', 'ctv_pending', 'POST claim khong_co', '400 "Nhiệm vụ không tồn tại."'), bad.status === 400 && /không tồn tại/.test(JSON.stringify(bad.body)), `${bad.status} ${short(bad.body?.message, 100)}`, 'API');

if (claimable.length) {
  const q = claimable[0];
  const [pre] = await sql(`SELECT "pointsBalance"::int p, COALESCE((SELECT SUM(delta) FROM points_transactions WHERE "userId"=$1 AND lot='STANDARD'),0)::int s FROM users WHERE id=$1`, P);
  const par = await Promise.all(Array.from({ length: 5 }, () => call('ctv_pending', 'POST', `/storefront/me/quests/${q.code}/claim`, {})));
  const [post] = await sql(`SELECT "pointsBalance"::int p, COALESCE((SELECT SUM(delta) FROM points_transactions WHERE "userId"=$1 AND lot='STANDARD'),0)::int s FROM users WHERE id=$1`, P);
  const [rows] = await sql(`SELECT count(*)::int n FROM points_transactions WHERE "userId"=$1 AND reason=$2`, P, `STOREFRONT_QUEST:${q.code}`);
  const granted = par.filter((r) => r.ok && r.body?.alreadyClaimed === false).length;
  check('L6-Q04', T('Nhận cùng một nhiệm vụ 5 lần song song: chỉ cộng điểm một lần', 'ctv_pending', `POST claim ${q.code} ×5 song song`, `đúng 1 dòng sổ điểm; điểm +${q.rewardPoints} một lần; số dư = Σ sổ`),
    rows.n === 1 && post.p - pre.p === q.rewardPoints && post.p === post.s && granted === 1, `trạng thái=${par.map((r) => `${r.status}${r.body?.alreadyClaimed ? 'x' : ''}`).join(',')}; dòng sổ=${rows.n}; điểm ${pre.p}→${post.p}; Σsổ=${post.s}; cấp=${granted}`, 'SQL');
  const again = await call('ctv_pending', 'POST', `/storefront/me/quests/${q.code}/claim`, {});
  check('L6-Q05', T('Nhận lại nhiệm vụ đã nhận: báo đã nhận, không cộng thêm', 'ctv_pending', 'POST claim lần nữa', 'alreadyClaimed=true; điểm không đổi'), again.ok && again.body?.alreadyClaimed === true && again.body?.pointsBalance === post.p, `${again.status} ${short(again.body, 200)}`, 'API');
} else {
  check('L6-Q04', T('Nhận nhiệm vụ song song', 'ctv_pending', 'không có nhiệm vụ đạt mà chưa nhận', 'n/a'), false, `không dựng được ca (đã nhận hết ${defs.filter((d) => d.claimed).length})`, 'API', 'BLOCKED');
}
const cus = await call('new', 'POST', '/storefront/me/quests/publish/claim', {});
check('L6-Q06', T('Khách không có gian hàng nhận nhiệm vụ: không được', 'new', 'POST claim publish', '404 "Chưa có gian hàng."'), cus.status === 404 && /Chưa có gian hàng/.test(JSON.stringify(cus.body)), `${cus.status} ${short(cus.body?.message, 100)}`, 'API');

// ---------- chống truy cập chéo gian hàng ----------
{
  const mine = (await call('ctv', 'GET', '/storefront/me')).body;
  const col = mine?.collections?.[0];
  const item = col?.items?.[0];
  if (!col || !item) {
    check('L6-R01', T('Truy cập chéo gian hàng', 'ctv_pending', 'cần gian hàng uat_ctv có khối và sản phẩm', 'n/a'), false, 'uat_ctv không có khối/sản phẩm để thử', 'API', 'BLOCKED');
  } else {
    const [before] = await sql(`SELECT note, "isHidden", "isPinned" FROM storefront_items WHERE id=$1`, item.id);
    const [colBefore] = await sql(`SELECT title FROM storefront_collections WHERE id=$1`, col.id);
    const tries = {
      'PATCH me/items/:id': await call('ctv_pending', 'PATCH', `/storefront/me/items/${item.id}`, { note: 'hack', isHidden: true }),
      'DELETE me/items/:id': await call('ctv_pending', 'DELETE', `/storefront/me/items/${item.id}`),
      'PATCH me/collections/:id': await call('ctv_pending', 'PATCH', `/storefront/me/collections/${col.id}`, { title: 'hack' }),
      'DELETE me/collections/:id': await call('ctv_pending', 'DELETE', `/storefront/me/collections/${col.id}`),
      'POST me/collections/:id/items': await call('ctv_pending', 'POST', `/storefront/me/collections/${col.id}/items`, { productId: item.productId ?? item.product?.id ?? 'x', note: 'hack' }),
    };
    const [after] = await sql(`SELECT note, "isHidden", "isPinned" FROM storefront_items WHERE id=$1`, item.id).catch(() => [null]);
    const [colAfter] = await sql(`SELECT title FROM storefront_collections WHERE id=$1`, col.id).catch(() => [null]);
    const statuses = Object.entries(tries).map(([k, r]) => `${k}=${r.status}`);
    check('L6-R01', T('CTV này không sửa/xoá khối và sản phẩm trong gian hàng của CTV khác (truy cập chéo)', 'ctv_pending', 'PATCH/DELETE/POST với id của khối và sản phẩm thuộc uat_ctv', 'tất cả 403/404; SQL ghi chú, ẩn/ghim, tên khối không đổi, dòng vẫn còn'),
      Object.values(tries).every((r) => [403, 404].includes(r.status)) && after && JSON.stringify(after) === JSON.stringify(before) && colAfter?.title === colBefore.title, `${statuses.join('; ')}; trước=${short(before)} sau=${short(after)}; khối "${colBefore.title}"→"${colAfter?.title}"`, 'API + SQL');
    const reorder = await call('ctv_pending', 'POST', '/storefront/me/collections/reorder', { orderedIds: [col.id] });
    const [still] = await sql(`SELECT count(*)::int n FROM storefront_collections WHERE "storefrontId" = (SELECT id FROM storefronts WHERE slug='uatctv')`);
    check('L6-R02', T('Sắp xếp lại khối bằng id của khối khác không làm đổi gian hàng kia', 'ctv_pending', 'POST me/collections/reorder với id khối của uat_ctv', 'không lỗi 500; khối uat_ctv không đổi'), reorder.status < 500 && still.n >= 1, `${reorder.status} ${short(reorder.body, 120)}; khối uat_ctv=${still.n}`, 'SQL');
  }
}

// ---------- ma trận quyền API quản trị ----------
const personas = ['admin', 'ketoan', 'cskh', 'kho', 'marketing', 'staff', 'ctv', 'dealer', 'brand', 'new', null];
const E = (method, p, allowed, body) => ({ method, p, allowed, body });
const endpoints = [
  E('GET', '/admin/payouts', ['admin', 'ketoan']),
  E('GET', '/admin/payouts/pit-report', ['admin', 'ketoan']),
  E('POST', '/admin/payouts/khong-co-id/approve', ['admin'], {}),
  E('POST', '/admin/payouts/khong-co-id/reject', ['admin'], { reason: 'x' }),
  E('POST', '/admin/payouts/khong-co-id/mark-paid', ['admin', 'ketoan'], {}),
  E('GET', '/admin/dealer-reward-claims', ['admin', 'ketoan']),
  E('POST', '/admin/dealer-reward-claims/khong-co-id/approve', ['admin'], {}),
  E('POST', '/admin/dealer-reward-claims/khong-co-id/mark-paid', ['admin', 'ketoan'], {}),
  E('POST', '/admin/dealer-orders/khong-co-id/confirm-payment', ['admin', 'ketoan'], {}),
  E('GET', '/admin/dealers/uat_dealer/credit-ledger', ['admin', 'ketoan']),
  E('POST', '/admin/dealers/uat_dealer/credit-payment', ['admin', 'ketoan'], {}),
  E('GET', '/admin/dealer-credit-reports', ['admin', 'ketoan']),
  E('GET', '/admin/dealers/accounts', ['admin', 'ketoan']),
  E('GET', '/admin/dealer-tiers/manage', ['admin']),
  E('GET', '/admin/commission-rates', ['admin']),
  E('GET', '/admin/storefronts', ['admin']),
  E('GET', '/admin/brands', ['admin']),
];
const wrong = [];
let n = 0;
for (const ep of endpoints) {
  for (const who of personas) {
    const r = await call(who, ep.method, ep.p, ep.body);
    n++;
    const allowedNow = ep.allowed.includes(who);
    const ok = who === null ? r.status === 401 : allowedNow ? r.status !== 401 && r.status !== 403 : r.status === 403;
    if (!ok) wrong.push(`${ep.method} ${ep.p} [${who ?? 'guest'}] → ${r.status} (mong ${who === null ? 401 : allowedNow ? 'không 401/403' : 403})`);
  }
}
check('L6-R03', T('Ma trận quyền API quản trị CTV/đại lý/nhãn/gian hàng: admin toàn quyền, kế toán chỉ các đường @AllowStaff(KE_TOAN), nhân viên khác, CTV, đại lý, chủ nhãn, khách đều 403; chưa đăng nhập 401', 'admin/ketoan/...', `${endpoints.length} đường × ${personas.length} vai trò = ${n} lượt gọi`, 'đúng @Roles(ADMIN) + @AllowStaff(KE_TOAN) của controller'), wrong.length === 0, wrong.length ? wrong.slice(0, 8).join(' | ') : `${n} lượt gọi đều đúng quyền`, 'API');

await done();
