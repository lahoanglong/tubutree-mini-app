// Số trên "Việc cần xử lý" (GET /admin/ops/inbox) phải bằng số dòng khi mở đúng danh sách mà thẻ trỏ tới, và bằng SQL đếm lại.
// Nguồn luật: ops-inbox.service.ts (mỗi khoá có điều kiện where riêng); web customer-refunds-admin.ts:10-12 ("bấm thẻ số mấy thì thấy đúng ngần ấy dòng").
// Dùng: node 23-inbox-counts.mjs
import { check, rec, save, short, call, sql } from './_lib.mjs';

const J = 'Số Việc cần xử lý khớp danh sách';
const inbox = async (who) => {
  const r = await call(who, 'GET', '/admin/ops/inbox');
  return Object.fromEntries((r.body.items ?? []).map((i) => [i.key, i.count]));
};
const total = (r) => r.body?.meta?.total ?? r.body?.total ?? (Array.isArray(r.body?.data) ? r.body.data.length : undefined) ?? (Array.isArray(r.body) ? r.body.length : undefined);

const [ad, kt, cs, kh] = [await inbox('admin'), await inbox('ketoan'), await inbox('cskh'), await inbox('kho')];

const pk = await call('kho', 'GET', '/admin/orders?pancake=attention&limit=1');
const [pkDb] = await sql(`SELECT count(*)::int n FROM orders WHERE "pancakeAttentionAt" IS NOT NULL`);
check('L5-INB-01', 'kho', 'api', J, 'Thẻ "Cần xử lý Pancake" của Kho = danh sách ?pancake=attention = SQL', 'ba số bằng nhau (ops-inbox.service.ts:116)', kh.pancakeAttention === total(pk) && kh.pancakeAttention === pkDb.n, `thẻ Kho ${kh.pancakeAttention}; thẻ Admin ${ad.pancakeAttention}; danh sách ${total(pk)}; SQL ${pkDb.n}`, null);
check('L5-INB-01b', 'admin', 'api', J, 'Thẻ Pancake của Admin = của Kho', 'bằng nhau', ad.pancakeAttention === kh.pancakeAttention, `Admin ${ad.pancakeAttention}; Kho ${kh.pancakeAttention}`, null);

const cr = await call('ketoan', 'GET', '/admin/customer-refunds?status=OPEN&limit=1');
const [crDb] = await sql(`SELECT count(*)::int n FROM order_customer_refunds WHERE status IN ('UNVERIFIED','PENDING','PROCESSING')`);
check('L5-INB-02', 'ketoan', 'api', J, 'Thẻ "Hoàn tiền khách" = danh sách "Đang mở" = SQL', 'ba số bằng nhau (ops-inbox.service.ts:119)', kt.customerRefunds === total(cr) && kt.customerRefunds === crDb.n, `thẻ ${kt.customerRefunds}; danh sách ${total(cr)}; SQL (UNVERIFIED+PENDING+PROCESSING) ${crDb.n}`, null);

const rp = await call('cskh', 'GET', '/admin/return-requests?status=REQUESTED&limit=1');
const [rpDb] = await sql(`SELECT count(*)::int n FROM return_requests WHERE status='REQUESTED'`);
check('L5-INB-03', 'cskh', 'api', J, 'Thẻ "Đổi/trả chờ duyệt" của CSKH = danh sách REQUESTED = SQL', 'ba số bằng nhau (ops-inbox.service.ts:121)', cs.returnsPending === total(rp) && cs.returnsPending === rpDb.n, `thẻ ${cs.returnsPending}; danh sách ${total(rp)}; SQL ${rpDb.n}`, null);

const rr = await call('kho', 'GET', '/admin/return-requests?status=TO_RECEIVE&limit=1');
const [rrDb] = await sql(`SELECT count(*)::int n FROM return_requests rr JOIN orders o ON o.id=rr."orderId" WHERE rr.status='APPROVED' AND rr."receivedAt" IS NULL`);
check('L5-INB-04', 'kho', 'api', J, 'Thẻ "Hàng trả chờ nhận" của Kho = danh sách TO_RECEIVE', 'bằng nhau (ops-inbox.service.ts:127; SQL tham khảo: APPROVED chưa receivedAt)', kh.returnsToReceive === total(rr), `thẻ ${kh.returnsToReceive}; danh sách ${total(rr)}; SQL tham khảo ${rrDb.n} (luật thẻ có thêm điều kiện về đơn/kho trả)`, null);

const bt = await call('ketoan', 'GET', '/admin/orders?status=PENDING_PAYMENT&queue=bank_transfer_to_confirm&limit=1');
check('L5-INB-05', 'ketoan', 'api', J, 'Thẻ "Chuyển khoản chờ tiền" = danh sách queue=bank_transfer_to_confirm', 'bằng nhau (ops-inbox.service.ts:141)', kt.bankTransferToConfirm === total(bt), `thẻ ${kt.bankTransferToConfirm}; danh sách ${total(bt)}`, null);

const iv = await call('ketoan', 'GET', '/admin/orders?invoice=pending&limit=1');
check('L5-INB-06', 'ketoan', 'api', J, 'Thẻ "Hoá đơn VAT chờ xuất" = danh sách invoice=pending', 'bằng nhau (ops-inbox.service.ts:214)', kt.invoicePending === total(iv), `thẻ ${kt.invoicePending}; danh sách ${total(iv)}`, null);

const pt = await call('ketoan', 'GET', '/admin/payouts?status=APPROVED&limit=1');
const [ptDb] = await sql(`SELECT count(*)::int n FROM payouts WHERE status='APPROVED'`);
check('L5-INB-07', 'ketoan', 'api', J, 'Thẻ "Lệnh rút chờ chi" của Kế toán = danh sách APPROVED = SQL', 'ba số bằng nhau (ops-inbox.service.ts:201)', kt.payoutsToPay === total(pt) && kt.payoutsToPay === ptDb.n, `thẻ ${kt.payoutsToPay}; danh sách ${total(pt)}; SQL ${ptDb.n}`, null);

const pa = await call('admin', 'GET', '/admin/payouts?status=REQUESTED&limit=1');
const [paDb] = await sql(`SELECT count(*)::int n FROM payouts WHERE status='REQUESTED'`);
check('L5-INB-08', 'admin', 'api', J, 'Thẻ "Lệnh rút chờ duyệt" của Admin = danh sách REQUESTED = SQL', 'ba số bằng nhau (ops-inbox.service.ts:199)', ad.payouts === total(pa) && ad.payouts === paDb.n, `thẻ ${ad.payouts}; danh sách ${total(pa)}; SQL ${paDb.n}`, null);

const [imDb] = await sql(`SELECT count(*)::int n FROM products WHERE "isActive"=true AND cardinality(images)=0`);
check('L5-INB-09', 'admin', 'api', J, 'Thẻ "Sản phẩm thiếu ảnh" của Admin = SQL', 'bằng nhau (ops-inbox.service.ts:180)', ad.productsMissingImage === imDb.n, `thẻ ${ad.productsMissingImage}; SQL ${imDb.n}`, null);

const own = ['pancakeAttention', 'customerRefunds', 'returnsPending', 'returnsToReceive', 'bankTransferToConfirm', 'invoicePending', 'payoutsToPay'];
const leaks = { cskh: ['customerRefunds', 'pancakeAttention', 'invoicePending', 'payoutsToPay', 'bankTransferToConfirm'].filter((k) => k in cs), kho: ['customerRefunds', 'invoicePending', 'payoutsToPay', 'bankTransferToConfirm', 'returnsPending'].filter((k) => k in kh), ketoan: ['pancakeAttention', 'returnsPending', 'returnsToReceive'].filter((k) => k in kt) };
check('L5-INB-10', 'cskh', 'api', J, 'Mỗi vai chỉ thấy thẻ của mình (CSKH không thấy tiền/hoá đơn/Pancake; Kho không thấy tiền, duyệt đổi/trả; Kế toán không thấy Pancake, đổi/trả)', 'không rò thẻ của vai khác (ops-inbox.service.ts: audience)', Object.values(leaks).every((l) => l.length === 0), `thẻ rò: ${JSON.stringify(leaks)}`, { cskh: Object.keys(cs), kho: Object.keys(kh), ketoan: Object.keys(kt) });
void own; void rec; void short;
save('23-inbox-counts');
process.exit(0);
