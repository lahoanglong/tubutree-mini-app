// D2: đặt hàng định kỳ: tạo (giao ngay / hẹn ngày), trùng gói, sửa kỳ, bỏ qua kỳ, tạm dừng/bật lại, huỷ, cron đến hạn, địa chỉ đang dùng.
import { A, makeRec, sql, sql1, done, L, job, ensureAddress, waitPushed, walletLedger } from './lib3.mjs';
const { rec, check } = makeRec('d2-subscriptions');
const J = 'Đặt hàng định kỳ';
const U = 'ctv_pending', uid = 'uat_ctv_pending'; // chưa có đơn nào, không ảnh hưởng ca khác
const vDW = (await sql1(`SELECT id FROM variations WHERE sku='FUWA-DW-1L'`)).id;
const vGL = (await sql1(`SELECT id FROM variations WHERE sku='FUWA-GL-500'`)).id;
const vIL = (await sql1(`SELECT id FROM variations WHERE sku='FUWA-HW-500'`)).id;
const addr = await ensureAddress(U, 'Võ Thị Chờ Duyệt');
const addr2 = (await A(U, 'POST', '/me/addresses', { recipient: 'Võ Thị Chờ Duyệt', phone: '0901000005', province: 'Thành phố Hồ Chí Minh', district: '', ward: 'Phường Bến Thành', street: '99 Pasteur', provinceCode: '84_VN79', districtCode: '', wardCode: '84_VN7926743' })).body.id;
const day = (n) => new Date(Date.now() + 7 * 3600e3 + n * 864e5).toISOString().slice(0, 10);

const bad = await A(U, 'POST', '/me/subscriptions', { variationId: vDW, quantity: 1, intervalWeeks: 3, addressId: addr });
check('D2-1', U, 'API', J, 'chu kỳ 3 tuần bị chặn (chỉ 4/6/8/10)', 'SUBSCRIPTION_INTERVAL_WEEKS=[4,6,8,10]', bad.status === 400, `POST=${bad.status} ${JSON.stringify(bad.body)}`);
const past = await A(U, 'POST', '/me/subscriptions', { variationId: vDW, quantity: 1, intervalWeeks: 4, addressId: addr, startDate: day(-1) });
check('D2-2', U, 'API', J, 'ngày bắt đầu đã qua: 400 "Ngày bắt đầu giao đã qua, bạn chọn lại nhé."', 'subscriptions.service.ts parseStartDate', past.status === 400 && /đã qua/.test(JSON.stringify(past.body)), `POST=${past.status} ${JSON.stringify(past.body)}`);
const far = await A(U, 'POST', '/me/subscriptions', { variationId: vDW, quantity: 1, intervalWeeks: 4, addressId: addr, startDate: day(61) });
check('D2-3', U, 'API', J, 'ngày bắt đầu quá 60 ngày: 400', 'MAX_START_DAYS_AHEAD=60', far.status === 400, `POST=${far.status} ${JSON.stringify(far.body)}`);
const q0 = await A(U, 'POST', '/me/subscriptions', { variationId: vDW, quantity: 1000, intervalWeeks: 4, addressId: addr });
check('D2-4', U, 'API', J, 'số lượng 1000: 400', 'MAX_SUBSCRIPTION_QUANTITY=999', q0.status === 400, `POST=${q0.status} ${JSON.stringify(q0.body)}`);
// Tạo giao ngay
const s1 = await A(U, 'POST', '/me/subscriptions', { variationId: vDW, quantity: 2, intervalWeeks: 4, addressId: addr });
const sub1 = s1.body;
const fo = sub1.firstOrder;
const row1 = await sql1(`SELECT status, "intervalWeeks" iw, quantity q, "nextRunAt" nx, "lastOrderId" lo FROM subscriptions WHERE id=$1`, sub1.id);
const days = (new Date(row1.nx).getTime() - Date.now()) / 864e5;
check('D2-5', U, 'API', J, 'tạo gói giao ngay: gói ACTIVE, có đơn đầu COD, kỳ kế sau 4 tuần (28 ngày)', 'subscriptions.service.ts create+placeFirstOrder; addWeeks', s1.status === 201 && row1.status === 'ACTIVE' && !!fo?.code && days > 27.9 && days < 28.1, `POST=${s1.status} firstOrder=${JSON.stringify(fo)} SQL=${JSON.stringify(row1)} kỳ kế còn ${days.toFixed(2)} ngày`);
const fo1 = fo ? await sql1(`SELECT type, status, "paymentMethod" pm, total::int, "pointsEarned"::int pe FROM orders WHERE code=$1`, fo.code) : null;
rec('D2-5b', U, 'API', J, 'đơn đầu của gói', 'SQL orders', JSON.stringify(fo1), `SQL orders=${JSON.stringify(fo1)}`, fo1 ? 'PASS' : 'FAIL');
const dup = await A(U, 'POST', '/me/subscriptions', { variationId: vDW, quantity: 2, intervalWeeks: 4, addressId: addr });
check('D2-6', U, 'API', J, 'tạo trùng gói (cùng sản phẩm + địa chỉ): trả lại gói đang có hoặc 409 SUBSCRIPTION_DUPLICATE, KHÔNG tạo gói thứ hai', 'subscriptions.service.ts resolveDuplicate; partial unique', (await sql1(`SELECT count(*)::int n FROM subscriptions WHERE "userId"=$1 AND "variationId"=$2 AND "addressId"=$3 AND status IN ('ACTIVE','PAUSED')`, uid, vDW, addr)).n === 1, `POST=${dup.status} ${JSON.stringify(dup.body).slice(0, 300)}`);
const dup2 = await A(U, 'POST', '/me/subscriptions', { variationId: vDW, quantity: 5, intervalWeeks: 6, addressId: addr });
check('D2-7', U, 'API', J, 'tạo trùng nhưng khác số lượng/chu kỳ: 409 SUBSCRIPTION_DUPLICATE kèm câu "hãy sửa gói đó"', 'subscriptions.service.ts subscriptionDuplicateError', dup2.status === 409 && dup2.body.code === 'SUBSCRIPTION_DUPLICATE', `POST=${dup2.status} ${JSON.stringify(dup2.body).slice(0, 300)}`);
// Sửa kỳ + số lượng
const up = await A(U, 'PATCH', `/me/subscriptions/${sub1.id}`, { intervalWeeks: 6, quantity: 3 });
const row2 = await sql1(`SELECT "intervalWeeks" iw, quantity q, "nextRunAt" nx FROM subscriptions WHERE id=$1`, sub1.id);
check('D2-8', U, 'API', J, 'sửa chu kỳ 4->6 tuần, số lượng 2->3', 'subscriptions.service.ts update/intervalPatch', up.ok && row2.iw === 6 && row2.q === 3, `PATCH=${up.status} ${JSON.stringify(up.body).slice(0, 200)} SQL trước=${JSON.stringify(row1)} sau=${JSON.stringify(row2)} (nextRunAt ${row1.nx} -> ${row2.nx})`);
const badUp = await A(U, 'PATCH', `/me/subscriptions/${sub1.id}`, { intervalWeeks: 5 });
check('D2-9', U, 'API', J, 'sửa chu kỳ 5 tuần: 400', 'DTO IsIn', badUp.status === 400, `PATCH=${badUp.status} ${JSON.stringify(badUp.body)}`);
const otherU = await A('new', 'PATCH', `/me/subscriptions/${sub1.id}`, { quantity: 1 });
check('D2-10', 'new', 'API', J, 'sửa gói của người khác: 404', 'subscriptions.service.ts update', otherU.status === 404, `PATCH=${otherU.status} ${JSON.stringify(otherU.body)}`);
// Địa chỉ đang dùng không xoá được
const delA = await A(U, 'DELETE', `/me/addresses/${addr}`);
check('D2-11', U, 'API', J, 'xoá địa chỉ đang dùng cho gói ACTIVE: 400 ADDRESS_IN_USE_BY_SUBSCRIPTION', 'users.service.ts Q-12 (C-014)', delA.status === 400 && delA.body.code === 'ADDRESS_IN_USE_BY_SUBSCRIPTION', `DELETE=${delA.status} ${JSON.stringify(delA.body)}`);
// Bỏ qua kỳ
const before = new Date(row2.nx).getTime();
const sk = await A(U, 'POST', `/me/subscriptions/${sub1.id}/skip`);
const row3 = await sql1(`SELECT "nextRunAt" nx, status FROM subscriptions WHERE id=$1`, sub1.id);
const delta = (new Date(row3.nx).getTime() - before) / 864e5;
check('D2-12', U, 'API', J, 'bỏ qua kỳ: nextRunAt lùi đúng 1 chu kỳ (6 tuần = 42 ngày), vẫn ACTIVE, KHÔNG sinh đơn', 'subscriptions.service.ts skipCycle', sk.ok && Math.abs(delta - 42) < 0.01 && row3.status === 'ACTIVE' && (await sql1(`SELECT count(*)::int n FROM orders WHERE "userId"=$1`, uid)).n === 1, `skip=${sk.status} nextRunAt ${row2.nx} -> ${row3.nx} (+${delta} ngày) số đơn của user=${(await sql1(`SELECT count(*)::int n FROM orders WHERE "userId"=$1`, uid)).n}`);
// Tạm dừng / bỏ qua khi dừng / bật lại
const pz = await A(U, 'POST', `/me/subscriptions/${sub1.id}/status`, { status: 'PAUSED' });
const skp = await A(U, 'POST', `/me/subscriptions/${sub1.id}/skip`);
check('D2-13', U, 'API', J, 'tạm dừng; bỏ qua kỳ khi đang dừng: 400 "Chỉ bỏ qua kỳ khi lịch đang chạy."', 'skipCycle sub.status !== ACTIVE', pz.ok && skp.status === 400 && /Chỉ bỏ qua kỳ khi lịch đang chạy/.test(JSON.stringify(skp.body)), `pause=${pz.status} skip=${skp.status} ${JSON.stringify(skp.body)}`);
// Cron đến hạn không chạy gói PAUSED
await sql(`UPDATE subscriptions SET "nextRunAt" = now() - interval '1 hour' WHERE id=$1 RETURNING id`, sub1.id);
const j0 = job('subscriptions.process-due');
const nOrders0 = (await sql1(`SELECT count(*)::int n FROM orders WHERE "userId"=$1`, uid)).n;
check('D2-14', U, 'API', J, 'job đến hạn KHÔNG sinh đơn cho gói tạm dừng', 'processDue where status ACTIVE', nOrders0 === 1, `job=${JSON.stringify(j0.result ?? j0)} số đơn=${nOrders0}`);
const rs = await A(U, 'POST', `/me/subscriptions/${sub1.id}/status`, { status: 'ACTIVE' });
const row4 = await sql1(`SELECT status, "nextRunAt" nx FROM subscriptions WHERE id=$1`, sub1.id);
const d4 = (new Date(row4.nx).getTime() - Date.now()) / 864e5;
check('D2-15', U, 'API', J, 'bật lại khi nextRunAt đã quá hạn: dời tới chu kỳ kế (6 tuần)', 'subscriptions.service.ts setStatus', rs.ok && row4.status === 'ACTIVE' && d4 > 41.9 && d4 < 42.1, `resume=${rs.status} SQL=${JSON.stringify(row4)} còn ${d4.toFixed(2)} ngày`);
// Cron: đưa nextRunAt về quá khứ, chạy job -> sinh đơn kỳ, dời chu kỳ
await sql(`UPDATE subscriptions SET "nextRunAt" = now() - interval '1 hour' WHERE id=$1 RETURNING id`, sub1.id);
const j1 = job('subscriptions.process-due');
const ords = await sql(`SELECT code, status, "paymentMethod" pm, total::int FROM orders WHERE "userId"=$1 ORDER BY "createdAt"`, uid);
const row5 = await sql1(`SELECT "nextRunAt" nx, "lastOrderId" lo FROM subscriptions WHERE id=$1`, sub1.id);
const d5 = (new Date(row5.nx).getTime() - Date.now()) / 864e5;
check('D2-16', U, 'API', J, 'job đến hạn sinh đúng 1 đơn kỳ mới, kỳ kế dời 6 tuần', 'processDue claim + runCycle', ords.length === 2 && d5 > 41.9 && d5 < 42.1, `job=${JSON.stringify(j1.result ?? j1)} đơn=${JSON.stringify(ords)} nextRunAt=${row5.nx} (còn ${d5.toFixed(2)} ngày)`);
const j2 = job('subscriptions.process-due');
check('D2-17', U, 'API', J, 'chạy job lần hai: không sinh thêm đơn', 'claim atomic nextRunAt', (await sql1(`SELECT count(*)::int n FROM orders WHERE "userId"=$1`, uid)).n === 2, `số đơn=${(await sql1(`SELECT count(*)::int n FROM orders WHERE "userId"=$1`, uid)).n}`);
// Gói hẹn ngày + ví
const s2 = await A(U, 'POST', '/me/subscriptions', { variationId: vGL, quantity: 1, intervalWeeks: 8, addressId: addr2, startDate: day(10), paymentMethod: 'WALLET' });
const row6 = s2.ok ? await sql1(`SELECT status, "nextRunAt" nx, "paymentMethod" pm, "lastOrderId" lo FROM subscriptions WHERE id=$1`, s2.body.id) : null;
const d6 = row6 ? (new Date(row6.nx).getTime() - Date.now()) / 864e5 : null;
check('D2-18', U, 'API', J, 'tạo gói hẹn ngày bắt đầu sau 10 ngày, trả bằng Ví: chưa sinh đơn đầu, nextRunAt = 0h ngày đó giờ VN', 'parseStartDate: `${startDate}T00:00:00+07:00`', s2.status === 201 && !s2.body.firstOrder && row6?.lo === null && new Date(row6.nx).toISOString() === new Date(`${day(10)}T00:00:00+07:00`).toISOString(), `POST=${s2.status} SQL=${JSON.stringify(row6)} kỳ đầu mong ${new Date(`${day(10)}T00:00:00+07:00`).toISOString()}`);
// Giao ngay mà ví không đủ: rollback cả gói
const sW = await A(U, 'POST', '/me/subscriptions', { variationId: vIL, quantity: 1, intervalWeeks: 4, addressId: addr, paymentMethod: 'WALLET' });
const cnt = (await sql1(`SELECT count(*)::int n FROM subscriptions WHERE "userId"=$1 AND "variationId"=$2`, uid, vIL)).n;
check('D2-19', U, 'API', J, 'giao ngay trả bằng Ví nhưng ví 0đ: 400 "Số dư Ví Tubu không đủ...", không để lại gói', 'subscriptions.service.ts placeFirstOrder SubscriptionWalletShortError', sW.status === 400 && cnt === 0, `POST=${sW.status} ${JSON.stringify(sW.body)} số gói đã tạo=${cnt}`);
// Huỷ
const cx = await A(U, 'POST', `/me/subscriptions/${sub1.id}/status`, { status: 'CANCELLED' });
const upc = await A(U, 'PATCH', `/me/subscriptions/${sub1.id}`, { quantity: 1 });
check('D2-20', U, 'API', J, 'huỷ gói; sửa gói đã huỷ: 400 "Gói định kỳ đã huỷ, không sửa được nữa."', 'subscriptions.service.ts update', cx.ok && upc.status === 400 && /đã huỷ/.test(JSON.stringify(upc.body)), `cancel=${cx.status} update=${upc.status} ${JSON.stringify(upc.body)}`);
const sk2 = await A(U, 'POST', `/me/subscriptions/${sub1.id}/skip`);
check('D2-21', U, 'API', J, 'bỏ qua kỳ gói đã huỷ: 400', 'skipCycle', sk2.status === 400, `skip=${sk2.status} ${JSON.stringify(sk2.body)}`);
await sql(`UPDATE subscriptions SET "nextRunAt" = now() - interval '1 hour' WHERE id=$1 RETURNING id`, sub1.id);
job('subscriptions.process-due');
check('D2-22', U, 'API', J, 'job đến hạn không sinh đơn cho gói đã huỷ', 'processDue where ACTIVE', (await sql1(`SELECT count(*)::int n FROM orders WHERE "userId"=$1`, uid)).n === 2, `số đơn=${(await sql1(`SELECT count(*)::int n FROM orders WHERE "userId"=$1`, uid)).n}`);
const lst = (await A(U, 'GET', '/me/subscriptions')).body;
rec('D2-23', U, 'API', J, 'GET /me/subscriptions', 'list', JSON.stringify(lst).slice(0, 300), JSON.stringify((lst.items ?? lst.data ?? lst).map?.((x) => ({ id: x.id?.slice(-5), status: x.status, intervalWeeks: x.intervalWeeks, quantity: x.quantity })) ?? lst).slice(0, 400), 'PASS');
rec('D2-state', U, 'API', J, 'ghi lại gói còn mở cho ca xoá tài khoản', '', `sub2=${s2.body?.id}`, `sub hẹn ngày id=${s2.body?.id}`, 'PASS');
await done();
