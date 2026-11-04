// C23: đại lý bấm đặt nhiều đơn Ghi công nợ cùng lúc (khác Idempotency-Key) khi hạn mức chỉ đủ cho hai đơn: tổng nợ không bao giờ vượt hạn mức,
// mọi đơn bị từ chối trả lỗi 4xx có chữ rõ (không 500), sổ công nợ khớp các đơn đã tạo. Sau đó huỷ hết đơn thử và kiểm nợ về như trước.
// Luật: dealer.service.ts createOrder (kiểm hạn mức trong transaction Serializable), bậc DEALER_2 hạn mức 20.000.000đ, copy lỗi đợt 8 ("Đã có lỗi xảy ra. Bạn thử lại nhé.").
// Chạy sau c19: node c23-dealer-credit-race.mjs (từ gốc worktree uat-1104).
import { call, short, sql, check, done, idk, varId, ensureAddress } from './common.mjs';

const D = 'uat_dealer';
const T = (title, persona, step, expect) => ({ title, persona, size: 'API', journey: title, step, expect });
const debt = async () => (await sql(`SELECT COALESCE(SUM(delta),0)::int s FROM dealer_credit_ledgers WHERE "userId"=$1`, D))[0].s;
const LIMIT = 20_000_000;
const SH = 94_500;
const QTY = 79;
const ONE = SH * QTY;

const addressId = await ensureAddress('dealer');
const variationId = await varId('HEC-SH-300');
const d0 = await debt();
if (d0 > 0) await call('admin', 'POST', `/admin/dealers/${D}/credit-payment`, { amount: d0, note: 'UAT dọn nợ trước thử song song' }, { 'idempotency-key': idk('l6pay') });
const base = await debt();

const fire = () => call('dealer', 'POST', '/dealer/orders', { items: [{ variationId, quantity: QTY }], paymentMethod: 'CREDIT', addressId }, { 'idempotency-key': idk('l6race') });
const res = await Promise.all([fire(), fire(), fire(), fire()]);
const okOrders = res.filter((r) => r.status === 201);
const bad = res.filter((r) => r.status !== 201);
const after = await debt();
const rows = okOrders.length ? await sql(`SELECT "refId" r, delta::int d FROM dealer_credit_ledgers WHERE "userId"=$1 AND "refType"='ORDER' AND "refId" = ANY($2::text[])`, D, okOrders.map((r) => r.body.id)) : [];

check('L6-V11', T('Bốn đơn Ghi công nợ song song (mỗi đơn 7.465.500đ, hạn mức 20.000.000đ): tổng nợ không vượt hạn mức, mỗi đơn tạo thành công có đúng một dòng sổ', 'dealer', 'xoá nợ về 0 rồi bắn 4 POST /dealer/orders CREDIT cùng lúc, khoá khác nhau', `tối đa 2 đơn 201; nợ = số đơn × ${ONE} và ≤ ${LIMIT}; mỗi đơn 201 có một dòng ORDER +${ONE}`),
  okOrders.length <= 2 && okOrders.length >= 1 && after === base + okOrders.length * ONE && after <= LIMIT && rows.length === okOrders.length && rows.every((x) => x.d === ONE),
  `nợ trước=${base}; trạng thái=${res.map((r) => r.status).join(',')}; nợ sau=${after}; dòng sổ=${short(rows, 200)}`, 'SQL dealer_credit_ledgers');

const msgs = bad.map((r) => `${r.status}:${String(r.body?.message ?? '').slice(0, 80)}`);
check('L6-V12', T('Đơn bị từ chối do vượt hạn mức khi bấm song song: lỗi 4xx có chữ rõ ràng, không 500, không đơn mồ côi', 'dealer', 'xem trạng thái và chữ lỗi của các lệnh không được 201 trong ca V11', 'mọi lệnh bị từ chối là 4xx có message tiếng Việt (không "Vui lòng", không 500); không có đơn DEALER nào ngoài các đơn 201'),
  bad.every((r) => r.status >= 400 && r.status < 500 && typeof r.body?.message === 'string' && !/Vui lòng/.test(r.body.message)),
  `từ chối=${short(msgs, 300)}`, 'API');

const orphans = await sql(`SELECT count(*)::int c FROM orders WHERE "userId"=$1 AND type::text='DEALER' AND "paymentMethod"::text='BANK_TRANSFER' AND status::text NOT IN ('CANCELLED') AND id <> ALL($2::text[]) AND "createdAt" > now() - interval '2 minutes'`, D, okOrders.map((r) => r.body.id).concat(['x']));
check('L6-V13', T('Không có đơn đại lý nào ngoài các đơn 201 vừa tạo (không đơn nửa vời sau lỗi Serializable)', 'dealer', 'SQL đếm đơn DEALER tạo trong 2 phút gần nhất ngoài các đơn trả 201', 'bằng 0'), orphans[0].c === 0, `đơn lạ=${orphans[0].c}`, 'SQL orders');

const cancels = [];
for (const r of okOrders) cancels.push(await call('admin', 'PUT', `/admin/orders/${r.body.id}/status`, { status: 'CANCELLED', note: 'UAT dọn đơn thử song song' }));
const end = await debt();
check('L6-V14', T('Huỷ các đơn thử song song: nợ về như trước khi thử', 'admin', 'admin PUT /admin/orders/:id/status CANCELLED', `nợ = ${base}`), cancels.every((r) => r.ok) && end === base, `huỷ=${cancels.map((r) => r.status).join(',')}; nợ ${after}→${end} (kỳ vọng ${base})`, 'SQL dealer_credit_ledgers');
const mk = (qty, key, paymentMethod = 'CREDIT') => call('dealer', 'POST', '/dealer/orders', { items: [{ variationId, quantity: qty }], paymentMethod, addressId }, { 'idempotency-key': key });
const label = (r) => `${r.status}:${r.status === 201 ? r.body.code : String(r.body?.message).slice(0, 60)}`;
const clean = (r) => r.status === 201 || (r.status >= 400 && r.status < 500 && r.status !== 429) || r.status === 503;
const made = [];
const take = (rs) => rs.forEach((r) => { if (r.status === 201) made.push(r.body.id); });

const A = await Promise.all([mk(33, idk('l6A')), mk(33, idk('l6A'))]);
take(A);
check('L6-V15', T('Hai đơn Ghi công nợ song song, khác khoá, cùng sản phẩm, tổng vẫn trong hạn mức (mỗi đơn 3.118.500đ): cả hai thành công hoặc bên thua nhận lỗi thử lại được, không 500', 'dealer', 'bắn 2 POST /dealer/orders CREDIT 33×HEC-SH-300 cùng lúc, khoá khác nhau', 'không lệnh nào 500; nợ khớp số đơn 201'),
  A.every(clean), `kết quả=${A.map(label).join(' | ')}`, 'API');

const key = idk('l6B');
const B = await Promise.all([mk(33, key), mk(33, key)]);
take(B);
const okB = B.filter((r) => r.status === 201);
check('L6-V16', T('Bấm đúp "Ghi công nợ" (hai lệnh cùng Idempotency-Key chạy song song): chỉ một đơn, lệnh còn lại nhận lại chính đơn đó, không 500', 'dealer', 'bắn 2 POST /dealer/orders CREDIT cùng khoá cùng lúc', 'không lệnh nào 500; nếu cả hai 201 thì cùng mã đơn; chỉ một đơn trong SQL'),
  B.every(clean) && (okB.length < 2 || okB[0].body.code === okB[1].body.code), `kết quả=${B.map(label).join(' | ')}`, 'API');

const uniq = [...new Set(made)];
const cl2 = [];
for (const id of uniq) cl2.push(await call('admin', 'PUT', `/admin/orders/${id}/status`, { status: 'CANCELLED', note: 'UAT dọn đơn thử song song' }));
const end2 = await debt();
check('L6-V17', T('Huỷ các đơn thử V15, V16: nợ về như trước', 'admin', 'admin PUT /admin/orders/:id/status CANCELLED', `nợ = ${base}`), cl2.every((r) => r.ok) && end2 === base, `đơn=${uniq.length}; huỷ=${cl2.map((r) => r.status).join(',')}; nợ=${end2}`, 'SQL dealer_credit_ledgers');
await done();
