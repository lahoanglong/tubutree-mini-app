// Quyền theo vai trò trên các đường quản trị Đổi rác / Cộng đồng / Vườn Xanh (đối chiếu quy tắc: chỉ ADMIN thu hồi/cấu hình; quầy chỉ xác nhận ở điểm của mình).
// Chạy sau 60-race.mjs trên cùng lane. Chạy: node 70-perm.mjs
import { call, sql, check, short, msg, closeDb } from './l4lib.mjs';

const mk = (journey, step, expected, persona = '') => ({ persona, viewport: 'API', journey, step, expected });
const done = (await sql(`SELECT id FROM waste_requests WHERE status='COMPLETED' ORDER BY "createdAt" DESC LIMIT 1`))[0]?.id;
const open = (await sql(`SELECT id FROM waste_requests WHERE status='OPEN' ORDER BY "createdAt" DESC LIMIT 1`))[0]?.id;
const roles = ['returning', 'new_nophone', 'staff', 'ketoan', 'kho', 'dealer', 'ctv', 'marketing', 'cskh'];

// Cấu hình / danh mục / báo cáo Đổi rác: chỉ ADMIN
for (const path of ['/admin/waste/gifts', '/admin/waste/items', '/admin/waste/points', '/admin/waste/overview']) {
  const bad = [];
  for (const u of roles) {
    const r = await call(u, 'GET', path);
    if (r.status !== 403 && r.status !== 401) bad.push(`${u}=${r.status}`);
  }
  const ad = await call('admin', 'GET', path);
  check(`P-W${path.split('/').pop()}`, mk('Quyền', `GET ${path} với 9 vai trò không phải ADMIN`, 'Mọi vai trò khác ADMIN nhận 403; ADMIN 200', 'nhiều vai trò'), bad.length === 0 && ad.status === 200, `ngoài ADMIN lọt: ${bad.join(', ') || 'không'}; admin ${ad.status}`);
}

// Danh sách yêu cầu (hỗ trợ khách): ai xem được
{
  const out = [];
  for (const u of roles) out.push(`${u}=${(await call(u, 'GET', '/admin/waste/requests')).status}`);
  check('P-W01', mk('Quyền', 'GET /admin/waste/requests với từng vai trò', 'Khách thường, nhân viên không nhóm, đại lý, CTV phải bị chặn; vai trò hỗ trợ (CSKH) được xem', 'nhiều vai trò'),
    out.find((x) => x.startsWith('returning=')) === 'returning=403' && out.find((x) => x.startsWith('dealer=')) === 'dealer=403' && out.find((x) => x.startsWith('ctv=')) === 'ctv=403' && out.find((x) => x.startsWith('cskh=')) === 'cskh=200', out.join(' '));
}

// Thu hồi, xác nhận qua đường admin: chỉ ADMIN
{
  const bad = [];
  for (const u of roles) {
    const r = await call(u, 'POST', `/admin/waste/requests/${done}/reverse`, { reason: 'UAT thử quyền' });
    if (r.status !== 403) bad.push(`${u}=${r.status}`);
  }
  const state = (await sql(`SELECT status::text AS s FROM waste_requests WHERE id='${done}'`))[0].s;
  check('P-W02', mk('Quyền', 'Thu hồi điểm bằng 9 vai trò không phải ADMIN', 'Tất cả 403, yêu cầu vẫn COMPLETED', 'nhiều vai trò'), bad.length === 0 && state === 'COMPLETED', `lọt: ${bad.join(', ') || 'không'}; trạng thái ${state}`);
  // Quy tắc nguồn: waste-admin-requests.controller.ts @Roles('STAFF','ADMIN') — mọi tài khoản role STAFF (kể cả nhóm KẾ TOÁN/MARKETING/CSKH) được xác nhận cân. Có phải ý chủ không?
  const out = [];
  for (const u of ['returning', 'dealer', 'ctv']) {
    const r = await call(u, 'POST', `/admin/waste/requests/${open}/confirm`, { lines: [{ itemId: 'wi-carton', declaredQty: 5, receivedQty: 5 }] });
    out.push(`${u}=${r.status}`);
  }
  const st2 = (await sql(`SELECT status::text AS s FROM waste_requests WHERE id='${open}'`))[0].s;
  check('P-W03', mk('Quyền', 'Khách thường, đại lý, CTV xác nhận cân qua đường admin', 'Tất cả 403; yêu cầu vẫn OPEN', 'nhiều vai trò'), out.every((x) => x.endsWith('=403')) && st2 === 'OPEN', `${out.join(' ')}; trạng thái ${st2}`);
  const fresh = await call('brand', 'POST', '/waste/requests', { consent: true, method: 'DROP_OFF', pointId: (await sql(`SELECT id FROM waste_points WHERE kind='WAREHOUSE' LIMIT 1`))[0].id, lines: [{ itemId: 'wi-bubble-wrap', declaredQty: 1 }] }, { 'idempotency-key': `l4-perm-${Date.now()}` });
  const r = await call('marketing', 'POST', `/admin/waste/requests/${fresh.body?.id}/confirm`, { lines: [{ itemId: 'wi-bubble-wrap', declaredQty: 1, receivedQty: 1 }] });
  const st3 = (await sql(`SELECT status::text AS s, "pointsAwarded" AS p FROM waste_requests WHERE id='${fresh.body?.id}'`))[0];
  check('P-W05', mk('Quyền', 'Tài khoản STAFF nhóm MARKETING (không phải kho) xác nhận cân cho khách qua /admin/waste/requests/:id/confirm', 'CẦN CHỦ: code cho mọi role STAFF làm được; chưa có quy tắc nói nhóm nào được cộng điểm Đổi rác', 'marketing'), 'NEEDOWNER', `${r.status} ${msg(r)}; yêu cầu ${short(st3, 100)}`);
}

// Quầy: chỉ ai có quyền quầy
{
  const out = [];
  const bad = [];
  for (const u of ['returning', 'new_nophone', 'ketoan', 'marketing', 'cskh', 'brand']) {
    const r = await call(u, 'GET', '/waste/desk/points');
    const n = Array.isArray(r.body) ? r.body.length : Array.isArray(r.body?.points) ? r.body.points.length : Array.isArray(r.body?.rows) ? r.body.rows.length : -1;
    out.push(`${u}=${r.status}/${n}`);
    if (!(r.status === 403 || (r.status === 200 && n === 0))) bad.push(u);
  }
  const ok = await call('staff', 'GET', '/waste/desk/points');
  const leakCustomers = bad.filter((u) => ['returning', 'new_nophone', 'brand'].includes(u));
  check('P-W04', mk('Quyền', 'Mở danh sách điểm của quầy: khách thường/nhãn phải bị chặn; nhóm kế toán/marketing/CSKH (role STAFF) mở được quầy kho?', 'Khách thường, nhãn: 403 hoặc rỗng. Nhóm STAFF không phải kho: CẦN CHỦ (code cho mọi role STAFF)', 'nhiều vai trò'),
    leakCustomers.length > 0 ? false : bad.length === 0 && ok.status === 200 ? true : 'NEEDOWNER', `${out.join(' ')}; staff ${ok.status} ${short(ok.body, 120)}; vai trò STAFF khác quầy vẫn thấy điểm: ${bad.join(', ') || 'không'}`);
}

// Vườn Xanh: không đăng nhập
{
  const out = [];
  for (const [m, p] of [['GET', '/game/profile'], ['POST', '/game/spin'], ['POST', '/game/dew/collect'], ['POST', '/game/streak-freeze/buy'], ['POST', '/game/streak/repair'], ['POST', '/game/missions/CHECKIN_7/claim'], ['GET', '/game/quiz/today'], ['POST', '/me/daily-check-in'], ['GET', '/waste/me'], ['POST', '/waste/requests']]) {
    const r = await call(undefined, m, p, m === 'POST' ? {} : undefined);
    out.push(`${m} ${p}=${r.status}`);
  }
  check('P-G01', mk('Quyền', 'Gọi các đường Vườn Xanh, điểm danh, Đổi rác khi chưa đăng nhập', 'Tất cả 401', 'guest'), out.every((x) => x.endsWith('=401')), out.join('; '));
}

// Cộng đồng: xoá bài của người khác (dùng bài riêng để không đụng bài khác)
{
  const catId = (await call('returning', 'GET', '/feed/categories')).body?.[0]?.id;
  const mkp = await call('returning', 'POST', '/feed', { categoryId: catId, kind: 'MANUAL', body: 'Bài thử quyền xoá của người khác.' });
  const post = mkp.body?.id;
  const out = [];
  for (const u of ['new_nophone', 'staff', 'ketoan', 'marketing']) out.push(`${u}=${(await call(u, 'DELETE', `/feed/${post}`)).status}`);
  const still = (await sql(`SELECT status::text AS s FROM feed_posts WHERE id='${post}'`))[0].s;
  check('P-C01', mk('Quyền', 'Khách thường, staff không nhóm, kế toán, marketing xoá bài của khách khác', 'Khách thường, staff, kế toán 403 (không có quyền); bài vẫn PUBLISHED nếu cả 4 đều bị chặn', 'nhiều vai trò'), out.slice(0, 3).every((x) => x.endsWith('=403')), `${out.join(' ')}; trạng thái bài ${still}`);
  const cs = await call('cskh', 'DELETE', `/feed/${post}`);
  const after = (await sql(`SELECT status::text AS s FROM feed_posts WHERE id='${post}'`))[0].s;
  check('P-C02', mk('Quyền', 'CSKH xoá bài của khách khác bằng đường xoá của tác giả', 'Không có quy tắc rõ: CSKH dùng đường ẩn/từ chối (/feed/admin/:id/hide); ghi nhận hành vi thực tế', 'cskh'), 'NEEDOWNER', `${cs.status} ${msg(cs)}; trạng thái bài sau ${after}`);
}
await closeDb();
