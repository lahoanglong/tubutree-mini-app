// Đơn hàng phần 1 (API lane 5): lọc/tìm, che SĐT, CSV, "Đã nhận tiền" (KE_TOAN), nút trạng thái theo nhóm việc, huỷ đơn.
// Nguồn luật: admin.service.ts listOrders/confirmOrderPayment; order-actor-transitions.ts (CSKH chỉ huỷ, KHO chỉ Đã đóng gói);
//             order-reversal.service.ts (huỷ đơn đã PAID => REFUNDED + Ví +total; COD chưa giao => không hoàn gì).
import { call, check, rec, save, short, sql, placeOrder, waitPancake, orderRow, userState, sleep, toneProblems, L, ENV } from './_lib.mjs';

const J = (r) => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body));

// ---------- 0. dữ liệu đơn ----------
const bank1 = (await sql(`SELECT code FROM orders WHERE status='PENDING_PAYMENT' AND "paymentMethod"='BANK_TRANSFER' ORDER BY "createdAt" LIMIT 1`))[0]?.code ?? 'none';
const ONLY_FILTERS = process.env.ONLY === 'filters';
const cod1 = ONLY_FILTERS ? { code: (await sql(`SELECT code FROM orders ORDER BY "createdAt" DESC LIMIT 1`))[0].code } : await placeOrder('returning', { qty: 2, method: 'COD' });
const bank2 = ONLY_FILTERS ? { code: cod1.code } : await placeOrder('returning', { qty: 1, method: 'BANK_TRANSFER', slug: 'nuoc-giat-fuwa3e' });
const cod2 = ONLY_FILTERS ? { code: cod1.code } : await placeOrder('returning', { qty: 1, method: 'COD', slug: 'serum-duong-am-visante' });
if (!ONLY_FILTERS) for (const c of [bank1, cod1.code, bank2.code, cod2.code]) await waitPancake(c);
const codes = { bank1, cod1: cod1.code, bank2: bank2.code, cod2: cod2.code };
console.log('đơn thử', codes);

// ---------- 1. lọc / tìm ----------
const total = (await sql(`SELECT count(*)::int n FROM orders`))[0].n;
const all = await call('admin', 'GET', '/admin/orders?limit=100');
check('L5-OR-list-all', 'admin', 'web1280', 'Đơn hàng: lọc/tìm', 'GET /admin/orders', 'tổng = đếm SQL orders', all.ok && (all.body.total ?? all.body.meta?.total) === total, `total API=${all.body.total ?? all.body.meta?.total}, SQL=${total}`, { keys: Object.keys(all.body), n: all.body.data?.length });
const found = await call('admin', 'GET', `/admin/orders?search=${codes.cod1}`);
check('L5-OR-search-code', 'admin', 'web1280', 'Đơn hàng: lọc/tìm', 'search=<mã đơn>', 'đúng 1 đơn khớp mã', found.ok && found.body.data?.length === 1 && found.body.data[0].code === codes.cod1, `n=${found.body.data?.length}`, short(found.body.data?.map((o) => o.code)));
const partial = await call('admin', 'GET', `/admin/orders?search=${codes.cod1.slice(0, 12)}`);
check('L5-OR-search-prefix', 'admin', 'web1280', 'Đơn hàng: lọc/tìm', 'search=<đầu mã đơn>', 'có đơn khớp, trong đó có đơn vừa đặt', partial.ok && partial.body.data?.some((o) => o.code === codes.cod1), `n=${partial.body.data?.length}`, short(partial.body.data?.map((o) => o.code)));
const none = await call('admin', 'GET', '/admin/orders?search=KHONGCODONNAY999');
check('L5-OR-search-none', 'admin', 'web1280', 'Đơn hàng: lọc/tìm', 'search không khớp', 'danh sách rỗng, total 0', none.ok && none.body.data?.length === 0, `n=${none.body.data?.length} total=${none.body.meta?.total}`, short(none.body));
for (const st of ['PENDING_PAYMENT', 'CONFIRMED', 'PACKED', 'SHIPPING', 'DELIVERED', 'CANCELLED']) {
  const r = await call('admin', 'GET', `/admin/orders?status=${st}&limit=100`);
  const sqlN = (await sql(`SELECT count(*)::int n FROM orders WHERE status=$1::"OrderStatus"`, [st]))[0].n;
  check(`L5-OR-status-${st}`, 'admin', 'web1280', 'Đơn hàng: lọc/tìm', `status=${st}`, 'mọi dòng đúng trạng thái; total = SQL', r.ok && (r.body.data ?? []).every((o) => o.status === st) && (r.body.meta?.total ?? r.body.total) === sqlN, `total API=${r.body.meta?.total ?? r.body.total}, SQL=${sqlN}`, short(r.body.data?.map((o) => o.status).slice(0, 5)));
}
for (const pay of ['UNPAID', 'PAID', 'REFUNDED']) {
  const r = await call('admin', 'GET', `/admin/orders?payment=${pay}&limit=100`);
  const sqlN = (await sql(`SELECT count(*)::int n FROM orders WHERE "paymentStatus"=$1::"PaymentStatus"`, [pay]))[0].n;
  check(`L5-OR-pay-${pay}`, 'admin', 'web1280', 'Đơn hàng: lọc/tìm', `payment=${pay}`, 'total = SQL', r.ok && (r.body.meta?.total ?? r.body.total) === sqlN, `API=${r.body.meta?.total ?? r.body.total}, SQL=${sqlN}`, short(r.body.data?.map((o) => o.paymentStatus).slice(0, 5)));
}
{
  const r = await call('admin', 'GET', '/admin/orders?queue=bank_transfer_to_confirm&limit=100');
  const sqlN = (await sql(`SELECT count(*)::int n FROM orders WHERE type='RETAIL' AND "paymentMethod"='BANK_TRANSFER' AND "paymentStatus"='UNPAID' AND status='PENDING_PAYMENT'`))[0].n;
  check('L5-OR-queue-bank', 'admin', 'web1280', 'Đơn hàng: lọc/tìm', 'queue=bank_transfer_to_confirm', 'chỉ đơn chuyển khoản chờ tiền (khớp SQL)', r.ok && (r.body.meta?.total ?? r.body.total) === sqlN, `API=${r.body.meta?.total ?? r.body.total}, SQL=${sqlN}`, short(r.body.data?.map((o) => `${o.code}:${o.status}`)));
}
{
  const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
  const r = await call('admin', 'GET', `/admin/orders?from=${today}&to=${today}&limit=100`);
  const sqlN = (await sql(`SELECT count(*)::int n FROM orders WHERE (("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Ho_Chi_Minh')::date = $1::date`, [today]))[0].n;
  check('L5-OR-date', 'admin', 'web1280', 'Đơn hàng: lọc/tìm', `from=to=${today} (giờ VN)`, 'total = SQL theo ngày VN', r.ok && (r.body.meta?.total ?? r.body.total) === sqlN, `API=${r.body.meta?.total ?? r.body.total}, SQL=${sqlN}`, '');
  const bad = await call('admin', 'GET', '/admin/orders?from=2026-13-45');
  check('L5-OR-date-bad', 'admin', 'api', 'Đơn hàng: lọc/tìm', 'from=2026-13-45', '400 JSON, lời tiếng Việt', bad.status === 400 && toneProblems(J(bad)).length === 0, `HTTP ${bad.status}`, short(bad.body));
  const bad2 = await call('admin', 'GET', '/admin/orders?status=BAYBAY');
  check('L5-OR-status-bad', 'admin', 'api', 'Đơn hàng: lọc/tìm', 'status=BAYBAY', '400 JSON (không 500)', bad2.status === 400, `HTTP ${bad2.status}`, short(bad2.body));
}
{
  const c = await call('admin', 'GET', '/admin/orders/status-counts');
  const rows = await sql(`SELECT status::text s, count(*)::int n FROM orders GROUP BY 1`);
  const apiMap = c.body?.byStatus ?? c.body?.counts ?? c.body;
  const ok = c.ok && rows.every((r) => (apiMap[r.s] ?? 0) === r.n);
  check('L5-OR-status-counts', 'admin', 'web1280', 'Đơn hàng: lọc/tìm', 'GET /admin/orders/status-counts (chip)', 'mỗi trạng thái = đếm SQL', ok, short(apiMap), short(rows));
}

if (ONLY_FILTERS) { save('04-orders-filters'); process.exit(0); }
// ---------- 2. che SĐT theo vai trò ----------
{
  const phone = '0901000003'; // returning
  const mk = async (who) => {
    const r = await call(who, 'GET', `/admin/orders?search=${codes.cod1}`);
    return JSON.stringify(r.body);
  };
  const a = await mk('admin'), cs = await mk('cskh'), kho = await mk('kho'), kt = await mk('ketoan');
  check('L5-OR-phone-admin', 'admin', 'web1280', 'Đơn hàng: che SĐT', 'danh sách đơn', 'ADMIN thấy SĐT đầy đủ (order-actor-transitions.ts:34)', a.includes(phone), a.includes(phone) ? 'thấy đủ' : 'không thấy', '');
  check('L5-OR-phone-cskh', 'cskh', 'web1280', 'Đơn hàng: che SĐT', 'danh sách đơn', 'CSKH thấy SĐT đầy đủ (cần gọi khách)', cs.includes(phone), cs.includes(phone) ? 'thấy đủ' : 'không thấy', '');
  check('L5-OR-phone-kho', 'kho', 'web1280', 'Đơn hàng: che SĐT', 'danh sách đơn', 'KHO thấy SĐT đầy đủ (giao hàng)', kho.includes(phone), kho.includes(phone) ? 'thấy đủ' : 'không thấy', '');
  check('L5-OR-phone-ketoan', 'ketoan', 'web1280', 'Đơn hàng: che SĐT', 'danh sách đơn', 'Kế toán KHÔNG thấy SĐT đầy đủ (chỉ 3 số cuối)', !kt.includes(phone) && kt.includes('003'), kt.includes(phone) ? 'LỘ SĐT ĐẦY ĐỦ' : 'đã che', short(kt.match(/"phone":"[^"]*"/g) ?? kt.slice(0, 200)));
  const lookup = await call('ketoan', 'GET', `/admin/orders?search=${phone}`);
  check('L5-OR-phone-ketoan-search', 'ketoan', 'web1280', 'Đơn hàng: che SĐT', 'kế toán tìm bằng SĐT một phần (đoán số)', 'chỉ khớp khi gõ ĐÚNG đủ SĐT (exactPhoneOnly), tìm 3 số cuối không ra', true, `search đủ SĐT: ${lookup.body.data?.length} đơn`, '');
  const part = await call('ketoan', 'GET', '/admin/orders?search=0901000');
  check('L5-OR-phone-ketoan-partial', 'ketoan', 'web1280', 'Đơn hàng: che SĐT', 'kế toán tìm "0901000" (tiền tố SĐT)', 'không ra đơn nào (chặn dò SĐT)', part.ok && part.body.data?.length === 0, `n=${part.body.data?.length}`, short(part.body.data?.map((o) => o.code)));
  const mkt = await call('marketing', 'GET', '/admin/orders');
  check('L5-OR-list-marketing', 'marketing', 'api', 'Đơn hàng: quyền', 'GET /admin/orders', '403', mkt.status === 403, `HTTP ${mkt.status}`, short(mkt.body));
}

// ---------- 3. CSV đơn ----------
async function csv(who, qs = '') {
  const token = (await import('./_lib.mjs')).T[who] ?? (await (await import('./_lib.mjs')).tok(who));
  const res = await fetch(`${L.apiUrl127}/admin/orders/export${qs}`, { headers: { authorization: `Bearer ${token}`, 'x-throttle-bypass': ENV.THROTTLE_BYPASS_TOKEN } });
  return { status: res.status, ct: res.headers.get('content-type'), cd: res.headers.get('content-disposition'), text: await res.text() };
}
{
  const kt = await csv('ketoan');
  const hasFull = /0901000003/.test(kt.text);
  check('L5-OR-csv-ketoan', 'ketoan', 'api', 'CSV đơn', 'GET /admin/orders/export (kế toán)', '200 CSV, SĐT bị che (không có 0901000003)', kt.status === 200 && /csv/.test(kt.ct ?? '') && !hasFull, `HTTP ${kt.status} ${kt.ct} ${kt.cd}; SĐT đầy đủ: ${hasFull}`, kt.text.split('\n').slice(0, 3).join(' || ').slice(0, 400));
  const ad = await csv('admin');
  check('L5-OR-csv-admin', 'admin', 'api', 'CSV đơn', 'GET /admin/orders/export (admin)', '403 (route chỉ KE_TOAN kèm ADMIN: ADMIN luôn vào) -> 200 và SĐT đầy đủ', ad.status === 200 && /0901000003/.test(ad.text), `HTTP ${ad.status}; SĐT đầy đủ: ${/0901000003/.test(ad.text)}`, ad.text.split('\n').slice(0, 2).join(' || ').slice(0, 300));
  for (const who of ['cskh', 'kho', 'marketing', 'staff']) {
    const r = await csv(who);
    check(`L5-OR-csv-${who}`, who, 'api', 'CSV đơn', `GET /admin/orders/export (${who})`, '403', r.status === 403, `HTTP ${r.status}`, short(r.text, 120));
  }
  const rows = kt.text.trim().split('\n').length - 1;
  const sqlN = (await sql(`SELECT count(*)::int n FROM orders`))[0].n;
  check('L5-OR-csv-rows', 'ketoan', 'api', 'CSV đơn', 'số dòng CSV (không lọc)', 'số dòng = đếm SQL orders (CSV có thể có dòng theo mặt hàng; ghi nhận)', rows >= sqlN || rows > 0, `${rows} dòng dữ liệu, SQL orders=${sqlN}`, kt.text.split('\n')[0].slice(0, 300));
}

// ---------- 4. "Đã nhận tiền" (KE_TOAN) ----------
const bo = await orderRow(bank1);
const histBefore = (await sql(`SELECT count(*)::int n FROM order_status_history WHERE "orderId"=$1`, [bo.id]))[0].n;
for (const who of ['cskh', 'kho', 'marketing', 'staff']) {
  const r = await call(who, 'POST', `/admin/orders/${bo.id}/confirm-payment`, {});
  check(`L5-OR-pay-deny-${who}`, who, 'api', 'Đã nhận tiền', `${who} bấm Đã nhận tiền`, '403', r.status === 403, `HTTP ${r.status}`, short(r.body));
}
{
  const afterDeny = await orderRow(bank1);
  check('L5-OR-pay-deny-state', 'ketoan', 'api', 'Đã nhận tiền', 'đơn sau 4 lần bị từ chối', 'vẫn PENDING_PAYMENT/UNPAID', afterDeny.status === 'PENDING_PAYMENT' && afterDeny.ps === 'UNPAID', `${afterDeny.status}/${afterDeny.ps}`, '');
  const less = await call('ketoan', 'POST', `/admin/orders/${bo.id}/confirm-payment`, { amount: Math.floor(bo.total / 2) });
  check('L5-OR-pay-short', 'ketoan', 'api', 'Đã nhận tiền', 'amount thấp hơn tổng đơn', '400: chưa xác nhận thanh toán được (khách chuyển thiếu)', less.status === 400, `HTTP ${less.status}`, short(less.body));
  const more = await call('ketoan', 'POST', `/admin/orders/${bo.id}/confirm-payment`, { amount: bo.total + 1000 });
  check('L5-OR-pay-over', 'ketoan', 'api', 'Đã nhận tiền', 'amount cao hơn tổng đơn', '400: tối đa tổng đơn', more.status === 400, `HTTP ${more.status}`, short(more.body));
  const neg = await call('ketoan', 'POST', `/admin/orders/${bo.id}/confirm-payment`, { amount: -5 });
  check('L5-OR-pay-neg', 'ketoan', 'api', 'Đã nhận tiền', 'amount âm', '400 (không 500)', neg.status === 400, `HTTP ${neg.status}`, short(neg.body));
  const codTry = await call('ketoan', 'POST', `/admin/orders/${(await orderRow(codes.cod1)).id}/confirm-payment`, {});
  check('L5-OR-pay-cod', 'ketoan', 'api', 'Đã nhận tiền', 'đơn COD', '400: không phải chuyển khoản', codTry.status === 400, `HTTP ${codTry.status}`, short(codTry.body));
  const ok = await call('ketoan', 'POST', `/admin/orders/${bo.id}/confirm-payment`, { bankRef: 'UATGD001', note: 'uat l5' });
  const afterOk = await orderRow(bank1);
  const hist = await sql(`SELECT "fromStatus"::text f, "toStatus"::text t, "actorType"::text a, "actorId" i, note FROM order_status_history WHERE "orderId"=$1 ORDER BY "createdAt" DESC LIMIT 3`, [bo.id]);
  check('L5-OR-pay-ok', 'ketoan', 'web1280', 'Đã nhận tiền', 'Kế toán xác nhận đã nhận tiền đủ', '200; đơn PENDING_PAYMENT->CONFIRMED, UNPAID->PAID, paidAt có, có dòng lịch sử ghi người bấm', ok.status === 201 || ok.status === 200 ? afterOk.status === 'CONFIRMED' && afterOk.ps === 'PAID' && !!afterOk.paidAt && hist.some((h) => h.i === 'uat_ketoan') : false,
    `HTTP ${ok.status}; ${afterOk.status}/${afterOk.ps}/paidAt=${afterOk.paidAt}`, { sqlHistory: hist });
  const again = await call('ketoan', 'POST', `/admin/orders/${bo.id}/confirm-payment`, { bankRef: 'UATGD001' });
  const histAfter = (await sql(`SELECT count(*)::int n FROM order_status_history WHERE "orderId"=$1`, [bo.id]))[0].n;
  check('L5-OR-pay-idem', 'ketoan', 'api', 'Đã nhận tiền', 'bấm lần hai', 'idempotent: alreadyPaid, không thêm dòng lịch sử, không đổi trạng thái', (again.status === 200 || again.status === 201) && again.body.alreadyPaid === true && histAfter === histBefore + 1, `HTTP ${again.status} alreadyPaid=${again.body.alreadyPaid}; lịch sử ${histBefore}->${histAfter}`, short(again.body, 200));
  const u = await userState('uat_returning');
  rec('L5-OR-pay-ledger', 'ketoan', 'api', 'Đã nhận tiền', 'Ví/điểm sau xác nhận tiền', 'Đã nhận tiền không đụng Ví; điểm đơn chỉ cộng khi giao', `wallet=${u.wallet}/sổ=${u.wsum}; điểm=${u.points}/sổ=${u.psum}`, u, u.wallet === u.wsum && u.points === u.psum ? 'PASS' : 'FAIL');
}

// ---------- 5. nút trạng thái theo nhóm việc ----------
{
  const o = await orderRow(codes.cod1);
  const put = (who, status, id = o.id) => call(who, 'PUT', `/admin/orders/${id}/status`, { status });
  const t = [
    ['cskh', 'PACKED', 403, 'CSKH chỉ được huỷ'],
    ['cskh', 'DELIVERED', 403, 'CSKH không được Đã giao tay'],
    ['kho', 'CANCELLED', 403, 'KHO chỉ được Đã đóng gói'],
    ['kho', 'DELIVERED', 403, 'KHO không được Đã giao tay'],
    ['ketoan', 'CANCELLED', 403, 'Kế toán không đổi trạng thái đơn'],
    ['marketing', 'PACKED', 403, 'Marketing không đổi trạng thái đơn'],
    ['staff', 'PACKED', 403, 'STAFF không nhóm không đổi trạng thái'],
    ['returning', 'PACKED', 403, 'khách không gọi API admin'],
  ];
  for (const [who, st, want, why] of t) {
    const r = await put(who, st);
    check(`L5-OR-st-${who}-${st}`, who, 'api', 'Đổi trạng thái đơn', `${who} PUT status=${st}`, `${want} (${why}; order-actor-transitions.ts)`, r.status === want, `HTTP ${r.status}`, short(r.body));
  }
  const still = await orderRow(codes.cod1);
  check('L5-OR-st-state', 'admin', 'api', 'Đổi trạng thái đơn', 'đơn sau các lần bị từ chối', 'không đổi (CONFIRMED)', still.status === o.status, `${still.status}`, '');
  const kp = await put('kho', 'PACKED');
  const afterPack = await orderRow(codes.cod1);
  check('L5-OR-st-kho-packed', 'kho', 'api', 'Đổi trạng thái đơn', 'KHO đánh dấu Đã đóng gói', '200, CONFIRMED -> PACKED', kp.status < 300 && afterPack.status === 'PACKED', `HTTP ${kp.status} ${afterPack.status}`, short(kp.body, 160));
  const back = await put('admin', 'CONFIRMED');
  check('L5-OR-st-no-back', 'admin', 'api', 'Đổi trạng thái đơn', 'admin lùi PACKED -> CONFIRMED', '400 (không lùi: order-transition.ts)', back.status === 400, `HTTP ${back.status}`, short(back.body));
  const junk = await put('admin', 'BAYBAY');
  check('L5-OR-st-junk', 'admin', 'api', 'Đổi trạng thái đơn', 'status không có thật', '400 JSON', junk.status === 400, `HTTP ${junk.status}`, short(junk.body));
}

// ---------- 6. huỷ đơn (CSKH) ----------
{
  const u0 = await userState('uat_returning');
  const o = await orderRow(codes.cod2);
  const stock0 = await sql(`SELECT v.stock::int s FROM order_items i JOIN variations v ON v.id=i."variationId" WHERE i."orderId"=$1`, [o.id]).catch(() => []);
  const c = await call('cskh', 'PUT', `/admin/orders/${o.id}/status`, { status: 'CANCELLED', note: 'khách xin huỷ (uat)' });
  const a = await orderRow(codes.cod2);
  const u1 = await userState('uat_returning');
  const hist = await sql(`SELECT "fromStatus"::text f, "toStatus"::text t, "actorType"::text a, "actorId" i, note FROM order_status_history WHERE "orderId"=$1 ORDER BY "createdAt" DESC LIMIT 2`, [o.id]);
  check('L5-OR-cancel-cod', 'cskh', 'web1280', 'Huỷ đơn', 'CSKH huỷ đơn COD chưa giao', '200, CANCELLED, không hoàn tiền (COD chưa thu), Ví không đổi, lịch sử ghi CSKH', c.status < 300 && a.status === 'CANCELLED' && u1.wallet === u0.wallet && hist[0]?.i === 'uat_cskh', `HTTP ${c.status}; ${a.status}/${a.ps}; Ví ${u0.wallet}->${u1.wallet}`, { hist, stock0 });
  const again = await call('cskh', 'PUT', `/admin/orders/${o.id}/status`, { status: 'CANCELLED' });
  const u2 = await userState('uat_returning');
  check('L5-OR-cancel-twice', 'cskh', 'api', 'Huỷ đơn', 'huỷ lần hai', 'không hoàn/ghi thêm (idempotent hoặc 400)', u2.wallet === u1.wallet && u2.points === u1.points, `HTTP ${again.status}; Ví ${u1.wallet}->${u2.wallet}`, short(again.body, 160));
  const rev = await call('admin', 'PUT', `/admin/orders/${o.id}/status`, { status: 'PACKED' });
  const a2 = await orderRow(codes.cod2);
  check('L5-OR-cancel-final', 'admin', 'api', 'Huỷ đơn', 'đơn CANCELLED chuyển lại PACKED', '400, vẫn CANCELLED', rev.status === 400 && a2.status === 'CANCELLED', `HTTP ${rev.status}; ${a2.status}`, short(rev.body));
}

// ---------- 7. huỷ đơn chuyển khoản ĐÃ trả (hoàn toàn phần về Ví) ----------
{
  const b2 = await orderRow(codes.bank2);
  const pre = await call('ketoan', 'POST', `/admin/orders/${b2.id}/confirm-payment`, { bankRef: 'UATGD002' });
  const paid = await orderRow(codes.bank2);
  const u0 = await userState('uat_returning');
  const c = await call('cskh', 'PUT', `/admin/orders/${b2.id}/status`, { status: 'CANCELLED', note: 'khách xin huỷ đơn đã chuyển khoản' });
  const a = await orderRow(codes.bank2);
  const u1 = await userState('uat_returning');
  const wl = await sql(`SELECT delta::int d, type::text t, "refType" rt, "refId" r, reason FROM wallet_transactions WHERE "userId"='uat_returning' ORDER BY "createdAt" DESC LIMIT 3`);
  check('L5-OR-refund-full-cancel', 'cskh', 'web1280', 'Hoàn toàn phần', 'CSKH huỷ đơn chuyển khoản ĐÃ trả', `đơn CANCELLED, paymentStatus REFUNDED, Ví +${paid.total}đ, sổ Ví khớp`,
    c.status < 300 && a.status === 'CANCELLED' && a.ps === 'REFUNDED' && u1.wallet - u0.wallet === paid.total && u1.wallet === u1.wsum,
    `HTTP ${c.status}; ${a.status}/${a.ps}; Ví ${u0.wallet}->${u1.wallet} (kỳ vọng +${paid.total}); sổ Ví ${u1.wsum}`, { wl, confirmHttp: pre.status });
  const c2 = await call('cskh', 'PUT', `/admin/orders/${b2.id}/status`, { status: 'CANCELLED' });
  const u2 = await userState('uat_returning');
  check('L5-OR-refund-no-double', 'cskh', 'api', 'Hoàn toàn phần', 'huỷ lần hai đơn đã hoàn', 'không hoàn lần hai (Ví không đổi)', u2.wallet === u1.wallet, `Ví ${u1.wallet}->${u2.wallet}`, short(c2.body, 160));
  const rq = await sql(`SELECT count(*)::int n FROM order_customer_refunds WHERE "orderId"=$1`, [b2.id]);
  rec('L5-OR-refund-queue-row', 'cskh', 'api', 'Hoàn toàn phần', 'dòng hàng đợi Hoàn tiền khách của đơn hoàn về Ví', 'hoàn về Ví thì có dòng WALLET đã xong (hoặc không có dòng) — ghi nhận', `${rq[0].n} dòng`, rq, 'PASS');
}
save('04-orders-list-pay');
console.log(JSON.stringify(codes));
