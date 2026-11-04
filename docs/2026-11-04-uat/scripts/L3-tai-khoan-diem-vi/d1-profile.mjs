// D1: hồ sơ, ngày sinh (đặt một lần, giờ VN), sổ địa chỉ, thông báo (danh sách, đã đọc, đọc tất cả, cài đặt nhận tin).
import { A, makeRec, sql, sql1, done, L, ensureAddress } from './lib3.mjs';
const { rec, check } = makeRec('d1-profile');
const J = 'Hồ sơ, địa chỉ, thông báo';
const U = 'new_nophone', uid = 'uat_new_nophone';
const me0 = (await A(U, 'GET', '/me')).body;
check('D1-1', U, 'API', J, 'GET /me khách mới chưa SĐT: dob null, điểm 0, ví 0, hạng chưa có', 'users.service.serialize', me0.dob === null && me0.pointsTotal === 0 && me0.walletBalance === 0 && !me0.phone, `me=${JSON.stringify(me0)}`);
// sửa tên + email
const up = await A(U, 'PATCH', '/me', { fullName: 'Trần Chưa Số (đã sửa)', email: 'chuaso@example.com' });
check('D1-2', U, 'API', J, 'sửa tên + email', 'PATCH /me', up.ok && up.body.fullName === 'Trần Chưa Số (đã sửa)' && up.body.email === 'chuaso@example.com', `PATCH=${up.status} ${JSON.stringify(up.body).slice(0, 250)}; SQL=${JSON.stringify(await sql1(`SELECT "fullName", email FROM users WHERE id=$1`, uid))}`);
const html = await A(U, 'PATCH', '/me', { fullName: 'Tên <b>x</b>' });
check('D1-3', U, 'API', J, 'tên chứa < > bị chặn, lời tiếng Việt', 'users.service.ts:updateMe', html.status === 400 && /Tên không được chứa ký tự/.test(JSON.stringify(html.body)), `PATCH=${html.status} ${JSON.stringify(html.body)}`);
const bad = await A(U, 'PATCH', '/me', { email: 'khong-phai-email' });
check('D1-4', U, 'API', J, 'email sai định dạng: 400', 'UpdateMeDto @IsEmail', bad.status === 400, `PATCH=${bad.status} ${JSON.stringify(bad.body)}`);
// ngày sinh
for (const [i, v] of [['5', '2024-02-30'], ['6', '2024-13-01'], ['7', '31/01/2000']]) {
  const r = await A(U, 'PATCH', '/me', { dob: v });
  check(`D1-${i}`, U, 'API', J, `ngày sinh không hợp lệ "${v}": 400`, 'users.service.ts:updateMe round-trip ISO', r.status === 400 && !(await sql1(`SELECT dob FROM users WHERE id=$1`, uid)).dob, `PATCH=${r.status} ${JSON.stringify(r.body)}`);
}
const d = await A(U, 'PATCH', '/me', { dob: '2000-01-01' });
const row = await sql1(`SELECT dob, dob::text dob_text, (dob AT TIME ZONE 'UTC')::text utc FROM users WHERE id=$1`, uid);
check('D1-8', U, 'API', J, 'đặt ngày sinh 2000-01-01 (sát nửa đêm: kiểm lệch múi giờ VN/UTC): GET /me trả đúng 2000-01-01', 'users.service.ts serialize toISOString().slice(0,10); dob lưu 00:00 UTC', d.ok && d.body.dob === '2000-01-01', `PATCH=${d.status} dob=${d.body.dob}; SQL dob=${JSON.stringify(row)} ; GET /me.dob=${(await A(U, 'GET', '/me')).body.dob}`);
const d2 = await A(U, 'PATCH', '/me', { dob: '2000-01-02' });
check('D1-9', U, 'API', J, 'đặt lại ngày sinh: bị chặn, câu "Ngày sinh chỉ có thể đặt một lần..."', 'users.service.ts A3-04: dob chỉ đặt một lần', d2.status === 400 && /Ngày sinh chỉ có thể đặt một lần/.test(JSON.stringify(d2.body)), `PATCH=${d2.status} ${JSON.stringify(d2.body)}; dob vẫn=${(await sql1(`SELECT dob::text FROM users WHERE id=$1`, uid)).dob}`);
// sổ địa chỉ
const base = { recipient: 'Trần Chưa Số', phone: '0912345678', province: 'Thành phố Hồ Chí Minh', district: '', ward: 'Phường Bến Thành', street: '1 Nguyễn Huệ', provinceCode: '84_VN79', districtCode: '', wardCode: '84_VN7926743' };
const a1 = await A(U, 'POST', '/me/addresses', base);
check('D1-10', U, 'API', J, 'địa chỉ đầu tiên tự thành mặc định', 'users.service.ts createAddress: makeDefault = count === 0', a1.ok && a1.body.isDefault === true, `POST=${a1.status} ${JSON.stringify(a1.body).slice(0, 250)}`);
const a2 = await A(U, 'POST', '/me/addresses', { ...base, street: '2 Lê Lợi', isDefault: true });
const list = (await A(U, 'GET', '/me/addresses')).body;
check('D1-11', U, 'API', J, 'đặt địa chỉ thứ hai làm mặc định: đúng 1 mặc định, mặc định đứng đầu', 'lockAddressBook; listAddresses isDefault desc', list.filter((x) => x.isDefault).length === 1 && list[0].id === a2.body.id, `list=${JSON.stringify(list.map((x) => ({ id: x.id.slice(-5), street: x.street, isDefault: x.isDefault })))}`);
const sdt = await A(U, 'POST', '/me/addresses', { ...base, phone: '12345' });
check('D1-12', U, 'API', J, 'SĐT địa chỉ sai: 400, lời tiếng Việt', 'address.dto.ts PHONE_MSG', sdt.status === 400 && /Số điện thoại không hợp lệ/.test(JSON.stringify(sdt.body)), `POST=${sdt.status} ${JSON.stringify(sdt.body)}`);
const lt = await A(U, 'POST', '/me/addresses', { ...base, street: 'x<script>' });
check('D1-13', U, 'API', J, 'địa chỉ chứa < >: 400', 'address.dto.ts NO_HTML', lt.status === 400, `POST=${lt.status} ${JSON.stringify(lt.body)}`);
const oldGeo = await A(U, 'POST', '/me/addresses', { ...base, provinceCode: '79' });
check('D1-14', U, 'API', J, 'mã tỉnh cũ (không theo địa giới mới): 400 "Tỉnh/thành chưa theo địa giới mới"', 'address.dto.ts GEO_MSG', oldGeo.status === 400, `POST=${oldGeo.status} ${JSON.stringify(oldGeo.body)}`);
const del = await A(U, 'DELETE', `/me/addresses/${a2.body.id}`);
const list2 = (await A(U, 'GET', '/me/addresses')).body;
check('D1-15', U, 'API', J, 'xoá địa chỉ mặc định: địa chỉ còn lại lên mặc định', 'users.service.ts deleteAddress', del.ok && list2.length === 1 && list2[0].isDefault === true, `DELETE=${del.status} list=${JSON.stringify(list2.map((x) => ({ street: x.street, isDefault: x.isDefault })))}`);
const other = await A('returning', 'GET', '/me/addresses');
const steal = await A(U, 'DELETE', `/me/addresses/${other.body[0].id}`);
check('D1-16', U, 'API', J, 'xoá địa chỉ của người khác: bị chặn (403), địa chỉ còn nguyên', 'users.service.ts assertOwner', steal.status === 403 && !!(await sql1(`SELECT id FROM addresses WHERE id=$1`, other.body[0].id)), `DELETE=${steal.status} ${JSON.stringify(steal.body)}`);
const patchOther = await A(U, 'PATCH', `/me/addresses/${other.body[0].id}`, { street: 'hack' });
check('D1-17', U, 'API', J, 'sửa địa chỉ của người khác: 403', 'assertOwner', patchOther.status === 403, `PATCH=${patchOther.status} ${JSON.stringify(patchOther.body)}`);
let n = 0; let last;
for (; n < 22; n++) { last = await A(U, 'POST', '/me/addresses', { ...base, street: `${n + 3} Trần Hưng Đạo` }); if (!last.ok) break; }
check('D1-18', U, 'API', J, 'sổ địa chỉ tối đa 20: lần thứ 21 bị chặn, câu đúng', 'users.service.ts MAX_ADDRESSES_PER_USER=20', last.status === 400 && /đủ 20 địa chỉ/.test(JSON.stringify(last.body)), `đã thêm thành công ${n} địa chỉ nữa; lỗi=${last.status} ${JSON.stringify(last.body)}; tổng=${(await A(U, 'GET', '/me/addresses')).body.length}`);

// thông báo
const R = 'returning';
const un0 = (await A(R, 'GET', '/me/notifications/unread-count')).body.count;
const list3 = (await A(R, 'GET', '/me/notifications')).body;
const first = list3.find((x) => x.status !== 'READ');
const mr = await A(R, 'POST', `/me/notifications/${first.id}/read`);
const un1 = (await A(R, 'GET', '/me/notifications/unread-count')).body.count;
check('D1-19', R, 'API', J, 'đánh dấu một tin đã đọc: chưa đọc giảm 1, SQL status=READ', 'notifications.service.ts markRead', mr.body?.ok === true && un1 === un0 - 1 && (await sql1(`SELECT status FROM notification_logs WHERE id=$1`, first.id)).status === 'READ', `chưa đọc ${un0} -> ${un1}; read=${JSON.stringify(mr.body)}`);
const mrOther = await A('new', 'POST', `/me/notifications/${first.id}/read`);
check('D1-20', 'new', 'API', J, 'đánh dấu tin của người khác: ok=false, không đổi gì', 'markRead where {id,userId}', mrOther.body?.ok === false, `read=${JSON.stringify(mrOther.body)}`);
const all = await A(R, 'POST', '/me/notifications/read-all');
const un2 = (await A(R, 'GET', '/me/notifications/unread-count')).body.count;
check('D1-21', R, 'API', J, 'đọc tất cả: chưa đọc về 0, count = số tin chưa đọc trước đó', 'markAllRead', un2 === 0 && all.body.count === un1, `read-all=${JSON.stringify(all.body)} chưa đọc sau=${un2}`);
const all2 = await A(R, 'POST', '/me/notifications/read-all');
check('D1-22', R, 'API', J, 'đọc tất cả lần hai: count 0', 'markAllRead', all2.body.count === 0, `read-all=${JSON.stringify(all2.body)}`);
const pf = await A(R, 'PATCH', '/me/notifications/prefs', { notifyPromo: false });
const pf2 = (await A(R, 'GET', '/me/notifications/prefs')).body;
check('D1-23', R, 'API', J, 'tắt nhận tin khuyến mãi: lưu được', 'notification prefs', pf.ok && pf2.notifyPromo === false, `PATCH=${pf.status} prefs=${JSON.stringify(pf2)}`);
await A(R, 'PATCH', '/me/notifications/prefs', { notifyPromo: true });
// không có token
const noauth = await (await fetch(`${L.apiUrl127}/me/notifications`)).status;
check('D1-24', 'guest', 'API', J, 'không đăng nhập gọi /me/notifications: 401', 'JwtAuthGuard', noauth === 401, `status=${noauth}`);
// thời gian thông báo là ISO UTC (UI đổi sang giờ VN) -> kiểm ở UI
await done();
