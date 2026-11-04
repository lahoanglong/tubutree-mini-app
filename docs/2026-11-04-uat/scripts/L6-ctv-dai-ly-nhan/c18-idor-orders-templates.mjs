// C18: (1) CTV không đọc/huỷ/yêu cầu trả được đơn của khách mà mình giới thiệu, đơn đại lý, hay đơn lên hộ của CTV khác (không lộ SĐT/địa chỉ khách);
//      (2) danh sách hoa hồng chỉ có của chính CTV; (3) mẫu đơn của đại lý: lưu, liệt kê, xoá, mẫu trống bị chặn, người khác vai không đụng được.
// Luật: orders.service.ts detailView/cancel/returns.request kiểm userId; dealer.service.ts saveTemplate/deleteTemplate (deleteMany theo id+userId, dealerContext).
// Chạy sau c10 và c5 (cần có đơn khách giới thiệu, đơn lên hộ và đơn đại lý): node c18-idor-orders-templates.mjs (từ gốc worktree uat-1104).
import { call, short, sql, check, done, varId, ensureAddress } from './common.mjs';

const T = (title, persona, step, expect) => ({ title, persona, size: 'API', journey: title, step, expect });
const pickOrder = async (where) => (await sql(`SELECT o.code, o.status::text s, o."userId" uid, o."referrerUserId" ref, o."placedForCustomer" pfc, o.type::text t FROM orders o WHERE ${where} ORDER BY o."createdAt" DESC LIMIT 1`))[0];

const refOrder = await pickOrder(`o."referrerUserId"='uat_ctv' AND o."userId" <> 'uat_ctv'`);
const dealerOrder = await pickOrder(`o.type::text='DEALER'`);
const assisted = await pickOrder(`o."placedForCustomer" = true AND o."userId"='uat_returning'`);
const phones = (await sql(`SELECT phone FROM users WHERE id IN ('uat_new','uat_returning','uat_dealer') AND phone IS NOT NULL`)).map((r) => r.phone);

const probe = async (user, o, label) => {
  const get = await call(user, 'GET', `/orders/${o.code}`);
  const cancel = await call(user, 'POST', `/orders/${o.code}/cancel`, {});
  const ret = await call(user, 'POST', `/orders/${o.code}/return-request`, { items: [], reason: 'UAT' });
  const body = JSON.stringify(get.body);
  const leak = phones.filter((p) => body.includes(p));
  const [after] = await sql(`SELECT status::text s FROM orders WHERE code=$1`, o.code);
  return { label, get: get.status, cancel: cancel.status, ret: ret.status, leak, unchanged: after.s === o.s, msg: short(get.body?.message, 80) };
};
const bad = (r) => ![403, 404].includes(r.get) || ![400, 403, 404].includes(r.cancel) || ![400, 403, 404].includes(r.ret) || r.leak.length > 0 || !r.unchanged;

const r1 = refOrder ? await probe('ctv', refOrder, 'đơn khách do CTV giới thiệu') : null;
const r2 = dealerOrder ? await probe('ctv', dealerOrder, 'đơn đại lý') : null;
const r3 = assisted ? await probe('ctv', assisted, 'đơn lên hộ của CTV khác') : null;
const rows = [r1, r2, r3].filter(Boolean);
check('L6-R04', T('CTV không xem, huỷ hay yêu cầu trả được đơn của người khác (khách mình giới thiệu, đơn đại lý, đơn lên hộ của CTV khác); không lộ SĐT', 'ctv', 'GET /orders/:code, POST /orders/:code/cancel, POST /orders/:code/return-request bằng persona ctv trên đơn của người khác', 'xem 403/404; huỷ và trả 400/403/404; trạng thái đơn không đổi; thân phản hồi không chứa SĐT người mua'),
  rows.length === 3 && rows.every((r) => !bad(r)), rows.map((r) => `${r.label}: xem=${r.get} huỷ=${r.cancel} trả=${r.ret} lộ SĐT=${r.leak.length} giữ nguyên=${r.unchanged}`).join(' | ') || 'thiếu dữ liệu đơn để thử', 'API + SQL orders');

const me = (await sql(`SELECT id FROM users WHERE id='uat_returning'`))[0];
const comm = await call('returning', 'GET', '/affiliate/commissions');
const list = Array.isArray(comm.body) ? comm.body : comm.body?.items ?? comm.body?.data ?? [];
const sqlN = (await sql(`SELECT count(*)::int n FROM commissions WHERE "affiliateUserId"=$1`, me.id))[0].n;
const foreignCodes = (await sql(`SELECT o.code FROM commissions c JOIN orders o ON o.id=c."orderId" WHERE c."affiliateUserId" <> $1`, me.id)).map((r) => r.code);
const leaked = foreignCodes.filter((c) => JSON.stringify(list).includes(c));
check('L6-R05', T('Danh sách hoa hồng của CTV chỉ có đơn của chính CTV, số dòng khớp SQL', 'returning', 'GET /affiliate/commissions rồi so với bảng commissions', `không mã đơn nào thuộc hoa hồng của CTV khác; số dòng API = SQL (${sqlN})`),
  comm.status === 200 && leaked.length === 0 && (comm.body?.total ?? list.length) === sqlN, `${comm.status}; API ${comm.body?.total ?? list.length} dòng, SQL ${sqlN}; mã đơn của CTV khác xuất hiện=${leaked.length}`, 'API + SQL commissions');

const dealerVid = await varId('SOK-CT-150');
await ensureAddress('dealer');
const save = await call('dealer', 'POST', '/dealer/templates', { name: 'Mẫu UAT', items: [{ variationId: dealerVid, quantity: 40 }] });
const empty = await call('dealer', 'POST', '/dealer/templates', { name: 'Trống', items: [] });
const list1 = await call('dealer', 'GET', '/dealer/templates');
const tid = save.body?.id;
const byCtv = await call('ctv', 'DELETE', `/dealer/templates/${tid}`);
const byGuest = await call(null, 'DELETE', `/dealer/templates/${tid}`);
const stillThere = (await sql(`SELECT count(*)::int n FROM dealer_order_templates WHERE id=$1`, tid))[0].n;
const del = await call('dealer', 'DELETE', `/dealer/templates/${tid}`);
const del2 = await call('dealer', 'DELETE', `/dealer/templates/${tid}`);
const gone = (await sql(`SELECT count(*)::int n FROM dealer_order_templates WHERE id=$1`, tid))[0].n;
check('L6-G21', T('Mẫu đơn đại lý: lưu và liệt kê; mẫu trống bị chặn; CTV và khách chưa đăng nhập không xoá được; đại lý xoá được một lần', 'dealer', 'POST/GET/DELETE /dealer/templates', 'lưu 201; mẫu trống 400 (DTO báo "Trường «items» không được để trống."); CTV 403; khách chưa đăng nhập 401; sau đó mẫu còn; đại lý xoá 200; xoá lại 400 "Không tìm thấy mẫu đơn."; SQL còn 0'),
  save.status === 201 && empty.status === 400 && /items|Mẫu đơn trống/.test(JSON.stringify(empty.body?.message ?? '')) && JSON.stringify(list1.body).includes(tid) && byCtv.status === 403 && byGuest.status === 401 && stillThere === 1 && del.status === 200 && del2.status === 400 && /Không tìm thấy mẫu đơn/.test(del2.body?.message ?? '') && gone === 0,
  `lưu=${save.status}; trống=${empty.status} ${short(empty.body?.message, 60)}; CTV xoá=${byCtv.status}; khách xoá=${byGuest.status}; còn sau thử=${stillThere}; xoá=${del.status}; xoá lại=${del2.status} ${short(del2.body?.message, 60)}; còn=${gone}`, 'API + SQL dealer_order_templates');
await done();
