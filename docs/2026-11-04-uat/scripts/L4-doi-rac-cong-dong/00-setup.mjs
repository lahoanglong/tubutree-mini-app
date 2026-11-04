// Bước dựng dữ liệu lane 4 cho Đổi rác: seed-data.mjs của đợt 28/10 không bật được waste.enabled vì khoá mới chặn khi thể lệ trống.
// Ở đây: nạp thể lệ từ bản nháp của chủ (Desktop/doi-rac-ban-nhap), bật cờ, tạo điểm đối tác (đại lý) + gắn chủ điểm.
import fs from 'node:fs';
import { call, sql, sleep, readParams, saveParams, closeDb, msg, short } from './l4lib.mjs';

const draft = fs.readFileSync('/Users/longla/Desktop/doi-rac-ban-nhap/01-the-le-waste.rules_text.txt', 'utf8');
const body = draft.split('=== BẮT ĐẦU NỘI DUNG DÁN VÀO ADMIN ===')[1].split('=== HẾT NỘI DUNG DÁN VÀO ADMIN ===')[0].trim().replace('[NGÀY BẮT ĐẦU]', '05/11/2026');
let params = {};
try { params = readParams(); } catch { /* lần đầu */ }

const cfg = async (key, value) => { const r = await call('admin', 'PUT', '/admin/config', { key, value }); console.log('PUT', key, r.status, r.ok ? '' : short(r.body)); return r; };
await cfg('waste.rules_text', body);
await cfg('waste.enabled', true);
await cfg('waste.lane_pickup_enabled', false); // theo thể lệ bản nháp: thu kèm đơn tắt; sẽ bật riêng khi thử
await cfg('chat.enabled', true);
await sleep(6000);

// Điểm kho + điểm đối tác
const pts = await call('admin', 'GET', '/admin/waste/points');
const list = pts.body.data ?? pts.body.items ?? pts.body;
params.whId = list.find((p) => p.kind === 'WAREHOUSE')?.id;
if (!params.whId) {
  const r = await call('admin', 'POST', '/admin/waste/points', { kind: 'WAREHOUSE', name: 'Kho Tubu Tree TP.HCM', addressLine: '12 Nguyễn Huệ', provinceCode: '79', provinceName: 'Thành phố Hồ Chí Minh', communeCode: '26734', communeName: 'Phường Bến Nghé', status: 'ACTIVE', phone: '0901234567' });
  console.log('create wh', r.status, short(r.body));
  params.whId = r.body.id;
}
// chủ điểm đối tác phải có gian hàng MERCHANT hoặc isPartner: bật isPartner cho gian hàng của persona ctv (dữ liệu lane, không phải mã)
await sql(`UPDATE storefronts SET "isPartner"=true WHERE "ownerUserId"='uat_ctv'`);
let partner = list.find((p) => p.kind === 'PARTNER');
if (!partner) {
  const r = await call('admin', 'POST', '/admin/waste/points', { kind: 'PARTNER', name: 'Cửa hàng đối tác Tạp hoá Xanh', addressLine: '45 Lê Lợi', provinceCode: '79', provinceName: 'Thành phố Hồ Chí Minh', communeCode: '26740', communeName: 'Phường Bến Thành', status: 'PENDING', phone: '0907654321', monthlyQuotaPoints: 100000, itemIds: ['wi-carton', 'wi-bubble-wrap'] });
  console.log('create partner', r.status, short(r.body));
  partner = r.body;
}
params.partnerId = partner.id;
const st = await call('admin', 'POST', `/admin/waste/points/${params.partnerId}/staff`, { userId: 'uat_ctv', role: 'OWNER' });
console.log('add owner', st.status, short(st.body));
const act = await call('admin', 'PATCH', `/admin/waste/points/${params.partnerId}`, { status: 'ACTIVE' });
console.log('activate', act.status, short(act.body));
saveParams(params);
const rows = await sql(`SELECT id, kind::text, name, status::text, "monthlyQuotaPoints" FROM waste_points`);
console.log(JSON.stringify(rows));
const links = await sql(`SELECT "pointId", "itemId" FROM waste_point_items`);
console.log(JSON.stringify(links));
const cf = await sql(`SELECT key, value::text FROM system_configs WHERE key IN ('waste.enabled','waste.rules_version','chat.enabled')`);
console.log(JSON.stringify(cf));
await closeDb();
