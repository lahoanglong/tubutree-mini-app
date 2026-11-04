// C25: kế toán bấm "Ghi nhận tiền về" nhiều lần cùng lúc cho một báo cáo chuyển khoản của đại lý (và cùng một Idempotency-Key): công nợ chỉ giảm một lần,
// báo cáo đóng một lần, các lệnh còn lại nhận lại kết quả hoặc lỗi 4xx rõ ràng (không 500).
// Luật: dealer.service.ts recordCreditPayment (đóng báo cáo và ghi sổ trong một transaction Serializable; kẻ thua P2002 nhận lại kết quả), unique (userId, refType, refId).
// Chạy sau c23: node c25-credit-payment-race.mjs (từ gốc worktree uat-1104). Cuối script trả hết nợ còn lại; đơn công nợ dùng làm nền vẫn CONFIRMED (đã thanh toán).
import { call, short, sql, check, done, idk, varId, ensureAddress } from './common.mjs';

const D = 'uat_dealer';
const T = (title, persona, step, expect) => ({ title, persona, size: 'API', journey: title, step, expect });
const debt = async () => (await sql(`SELECT COALESCE(SUM(delta),0)::int s FROM dealer_credit_ledgers WHERE "userId"=$1`, D))[0].s;
const label = (r) => `${r.status}${r.status >= 400 ? `:${String(r.body?.message).slice(0, 50)}` : ''}`;

const d0 = await debt();
if (d0 > 0) await call('admin', 'POST', `/admin/dealers/${D}/credit-payment`, { amount: d0, note: 'UAT dọn nợ trước thử ghi nhận song song' }, { 'idempotency-key': idk('l6pay') });
const addressId = await ensureAddress('dealer');
const base = await call('dealer', 'POST', '/dealer/orders', { items: [{ variationId: await varId('HEC-SH-300'), quantity: 33 }], paymentMethod: 'CREDIT', addressId }, { 'idempotency-key': idk('l6base') });
const debtBase = await debt();

const rep = await call('dealer', 'POST', '/dealer/credit-payment', { amount: 1_000_000, note: 'CK thử song song' });
const reports = await call('admin', 'GET', '/admin/dealer-credit-reports?status=REPORTED');
const repId = (reports.body?.data ?? reports.body?.items ?? reports.body ?? []).find?.((x) => x.userId === D)?.id;

const paid = await Promise.all([1, 2, 3].map((i) => call('ketoan', 'POST', `/admin/dealers/${D}/credit-payment`, { amount: 1_000_000, reportId: repId, note: `Đã nhận CK lần ${i}` }, { 'idempotency-key': idk('l6par') })));
const afterReport = await debt();
const [closed] = repId ? await sql(`SELECT status::text s FROM dealer_credit_payment_reports WHERE id=$1`, repId) : [];
const payRows = await sql(`SELECT delta::int d FROM dealer_credit_ledgers WHERE "userId"=$1 AND "refType"='PAYMENT' AND "createdAt" > now() - interval '2 minutes'`, D);
check('L6-V21', T('Ba lệnh Ghi nhận tiền về cùng một báo cáo chạy song song: nợ giảm đúng một lần 1.000.000đ, báo cáo đóng một lần, không 500', 'ketoan', 'đại lý báo CK 1.000.000đ; ketoan bắn 3 POST /admin/dealers/:id/credit-payment cùng reportId, khoá khác nhau', `nợ ${debtBase} → ${debtBase - 1_000_000}; báo cáo RECORDED; đúng một dòng PAYMENT −1.000.000; không lệnh nào 500`),
  base.status === 201 && rep.status < 300 && !!repId && afterReport === debtBase - 1_000_000 && closed?.s === 'RECORDED' && payRows.length === 1 && payRows[0].d === -1_000_000 && paid.every((r) => r.status < 500),
  `đơn nền=${base.status}; báo=${rep.status}; kết quả=${paid.map(label).join(' | ')}; nợ ${debtBase}→${afterReport}; báo cáo=${closed?.s}; dòng PAYMENT=${payRows.length}`, 'SQL dealer_credit_ledgers/dealer_credit_payment_reports');

const key = idk('l6same');
const same = await Promise.all([1, 2, 3].map(() => call('admin', 'POST', `/admin/dealers/${D}/credit-payment`, { amount: 500_000, note: 'Ghi nhận cùng khoá' }, { 'idempotency-key': key })));
const afterSame = await debt();
const sameRows = await sql(`SELECT count(*)::int c FROM dealer_credit_ledgers WHERE "userId"=$1 AND "refType"='PAYMENT' AND "refId"=$2`, D, key);
check('L6-V22', T('Ba lệnh Ghi nhận tiền về cùng Idempotency-Key chạy song song (không báo cáo): nợ giảm đúng một lần 500.000đ, không 500', 'admin', 'bắn 3 POST /admin/dealers/:id/credit-payment 500.000đ cùng khoá cùng lúc', `nợ ${afterReport} → ${afterReport - 500_000}; một dòng PAYMENT theo khoá; không lệnh nào 500`),
  afterSame === afterReport - 500_000 && sameRows[0].c === 1 && same.every((r) => r.status < 500), `kết quả=${same.map(label).join(' | ')}; nợ ${afterReport}→${afterSame}; dòng theo khoá=${sameRows[0].c}`, 'SQL dealer_credit_ledgers');

const rest = await debt();
const clear = rest > 0 ? await call('admin', 'POST', `/admin/dealers/${D}/credit-payment`, { amount: rest, note: 'UAT trả hết nợ nền' }, { 'idempotency-key': idk('l6pay') }) : { ok: true, status: 0 };
check('L6-V23', T('Trả hết nợ còn lại của đơn nền: nợ về 0', 'admin', 'POST /admin/dealers/:id/credit-payment bằng dư nợ', 'nợ = 0'), clear.ok && (await debt()) === 0, `trả=${clear.status}; nợ=${await debt()}`, 'SQL dealer_credit_ledgers');
await done();
