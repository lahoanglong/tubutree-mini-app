// C10: CTV lên đơn hộ khách (POST /affiliate/orders/quote, /affiliate/orders): giá, COD/chuyển khoản, chống double-submit, hoa hồng, quyền.
// Luật: affiliate.service.ts (placeOrderForCustomer, priceCustomerOrder, ctvCodBlockReason COD ≤ 5.000.000đ, SĐT khách ≠ SĐT CTV),
// affiliate-access.ts (canPlaceOrderForCustomer: AFFILIATE, ADMIN). Dùng CTV uat_returning (đăng ký ở c4). Chạy sau c8: node c10-order-for-customer.mjs.
import { call, short, sql, check, done, commissionOf, webhook, idk, varId } from './common.mjs';

const T = (title, persona, step, expect) => ({ title, persona, size: 'API', journey: title, step, expect });
const CTV = 'uat_returning';
const [role] = await sql(`SELECT role::text r FROM users WHERE id=$1`, CTV);
if (role.r !== 'AFFILIATE') await call('returning', 'POST', '/affiliate/register', { termsVersion: '2026-11-t1' });

const customer = { recipient: 'Khách Của CTV', phone: '0901000088', province: 'Thành phố Hồ Chí Minh', ward: 'Phường Bến Thành', street: '12 Lê Lợi', provinceCode: '84_VN79', wardCode: '84_VN7926743' };
const vGL = await varId('FUWA-GL-500');
const stockOf = async (id) => (await sql(`SELECT stock::int s, "reservedStock"::int r FROM variations WHERE id=$1`, id))[0];

// ---------- báo giá ----------
const q = await call('returning', 'POST', '/affiliate/orders/quote', { items: [{ variationId: vGL, quantity: 2 }] });
const [vp] = await sql(`SELECT "retailPrice"::int p, "salePrice"::int sp FROM variations WHERE id=$1`, vGL);
const unit = q.body?.items?.[0]?.unitPrice;
check('L6-M01', T('Báo giá đơn hộ: đúng giá đang bán, tổng = hàng + phí giao, không khoá COD khi ≤ 5.000.000đ', 'returning', 'POST /affiliate/orders/quote 2×FUWA-GL-500', `unitPrice là giá đang bán (${vp.sp ?? vp.p}); goods = 2×giá; total = goods + shippingFee; blockedPaymentMethods rỗng`),
  q.status === 201 && [vp.p, vp.sp].includes(unit) && q.body.goods === unit * 2 && q.body.total === q.body.goods + q.body.shippingFee && Object.keys(q.body.blockedPaymentMethods ?? {}).length === 0, `${q.status} ${short(q.body, 300)}; SQL giá=${vp.p}/${vp.sp}`, 'SQL', undefined);

const big = await call('returning', 'POST', '/affiliate/orders/quote', { items: [{ variationId: await varId('POLANG-SP-500'), quantity: 25 }] });
check('L6-M02', T('Báo giá đơn trên 5.000.000đ: khoá COD, nói rõ lý do', 'returning', 'POST quote 25×POLANG-SP-500 (6.125.000đ)', 'blockedPaymentMethods.COD = "Thanh toán khi nhận hàng (COD) chỉ nhận đơn tối đa 5.000.000đ, ... Bạn chọn chuyển khoản nhé."'),
  big.status === 201 && big.body.total > 5_000_000 && /tối đa 5\.000\.000đ/.test(big.body.blockedPaymentMethods?.COD ?? '') && /chuyển khoản nhé/.test(big.body.blockedPaymentMethods?.COD ?? ''), `${big.status} total=${big.body?.total} ${short(big.body?.blockedPaymentMethods, 260)}`, 'API');

// ---------- tạo đơn COD ----------
const s0 = await stockOf(vGL);
const key = idk('l6m');
const body = { items: [{ variationId: vGL, quantity: 2 }], customer, paymentMethod: 'COD', expectedTotal: q.body.total };
const o1 = await call('returning', 'POST', '/affiliate/orders', body, { 'idempotency-key': key });
const code = o1.body?.code ?? o1.body?.order?.code;
const [row] = code ? await sql(`SELECT status::text st, "userId", "referrerUserId" ref, "placedForCustomer" pfc, source, total, subtotal, "shippingFee" ship, "pointsEarned" pe, "pointsUsed" pu, "endCustomerKey" ek, "paymentMethod"::text pm FROM orders WHERE code=$1`, code) : [];
const [cm] = code ? await commissionOf(code) : [];
const s1 = await stockOf(vGL);
check('L6-M03', T('CTV lên đơn hộ COD: đơn mang tên CTV, ghi công CTV, hoa hồng 8%, trừ kho đúng 1 lần', 'returning', 'POST /affiliate/orders COD 2×FUWA-GL-500', `201; CONFIRMED, placedForCustomer, source ctv_assisted, endCustomerKey = SĐT khách; total = báo giá ${q.body?.total}; hoa hồng PENDING = floor(${q.body?.goods}×8%) = ${Math.floor((q.body?.goods ?? 0) * 0.08)}; tồn −2`),
  o1.status === 201 && row?.st === 'CONFIRMED' && row.userId === CTV && row.ref === CTV && row.pfc === true && row.source === 'ctv_assisted' && row.ek === '0901000088' && row.total === q.body.total && row.pe === 0 && row.pu === 0 && cm?.status === 'PENDING' && cm.amount === Math.floor(q.body.goods * 0.08) && s0.s - s1.s === 2, `${o1.status}; đơn=${short(row, 300)}; commission=${short({ s: cm?.status, a: cm?.amount, base: cm?.base })}; tồn ${s0.s}→${s1.s}`, 'SQL');

// ---------- gửi lại cùng Idempotency-Key ----------
const o2 = await call('returning', 'POST', '/affiliate/orders', body, { 'idempotency-key': key });
const code2 = o2.body?.code ?? o2.body?.order?.code;
const [nOrd] = await sql(`SELECT count(*)::int n FROM orders WHERE "idempotencyKey"=$1`, key);
const [nCm] = await sql(`SELECT count(*)::int n FROM commissions WHERE "orderId"=(SELECT id FROM orders WHERE code=$1)`, code);
const s2 = await stockOf(vGL);
check('L6-M04', T('Bấm lại / mạng chập chờn (cùng Idempotency-Key): trả lại đơn cũ, không trừ kho hay tạo hoa hồng lần hai', 'returning', 'POST /affiliate/orders lần 2 cùng key', 'cùng mã đơn; 1 đơn; 1 commission; tồn không đổi'), o2.ok && code2 === code && nOrd.n === 1 && nCm.n === 1 && s2.s === s1.s, `${o2.status}; ${code2}/${code}; đơn=${nOrd.n}; commission=${nCm.n}; tồn ${s1.s}→${s2.s}`, 'SQL');

// ---------- song song 5 lần cùng key ----------
const key2 = idk('l6mp');
const par = await Promise.all(Array.from({ length: 5 }, () => call('returning', 'POST', '/affiliate/orders', { ...body, expectedTotal: undefined }, { 'idempotency-key': key2 })));
const [nPar] = await sql(`SELECT count(*)::int n FROM orders WHERE "idempotencyKey"=$1`, key2);
const s3 = await stockOf(vGL);
check('L6-M05', T('Năm yêu cầu song song cùng Idempotency-Key: chỉ một đơn, kho chỉ trừ một lần', 'returning', 'POST /affiliate/orders ×5 song song', 'đúng 1 đơn trong DB; tồn giảm 2 (không 10)'), nPar.n === 1 && s2.s - s3.s === 2, `trạng thái=${par.map((r) => r.status).join(',')}; đơn=${nPar.n}; tồn ${s2.s}→${s3.s}`, 'SQL');

// ---------- luật chặn ----------
const own = await call('returning', 'POST', '/affiliate/orders', { ...body, customer: { ...customer, phone: '0901000003' } }, { 'idempotency-key': idk('l6m') });
check('L6-M06', T('Không lên đơn hộ bằng SĐT của chính CTV', 'returning', 'POST /affiliate/orders với phone = SĐT CTV', '400 "Không thể lên đơn hộ với SĐT của chính bạn. ..."'), own.status === 400 && /SĐT của chính bạn/.test(JSON.stringify(own.body)), `${own.status} ${short(own.body?.message, 200)}`, 'API');

const cod = await call('returning', 'POST', '/affiliate/orders', { items: [{ variationId: await varId('POLANG-SP-500'), quantity: 25 }], customer, paymentMethod: 'COD' }, { 'idempotency-key': idk('l6m') });
const bank = await call('returning', 'POST', '/affiliate/orders', { items: [{ variationId: await varId('POLANG-SP-500'), quantity: 25 }], customer, paymentMethod: 'BANK_TRANSFER' }, { 'idempotency-key': idk('l6m') });
const bcode = bank.body?.code ?? bank.body?.order?.code;
const [brow] = bcode ? await sql(`SELECT status::text st, "paymentStatus"::text ps, total FROM orders WHERE code=$1`, bcode) : [];
check('L6-M07', T('Đơn hộ trên 5.000.000đ: COD bị từ chối, chuyển khoản được và chờ thanh toán', 'returning', 'POST /affiliate/orders COD rồi BANK_TRANSFER cho 25×POLANG-SP-500', 'COD 400 PAYMENT_METHOD_NOT_ALLOWED; chuyển khoản 201 PENDING_PAYMENT/UNPAID'), cod.status === 400 && /PAYMENT_METHOD_NOT_ALLOWED/.test(JSON.stringify(cod.body)) && bank.status === 201 && brow?.st === 'PENDING_PAYMENT' && brow.ps === 'UNPAID', `COD ${cod.status} ${short(cod.body?.message, 140)}; CK ${bank.status} ${short(brow)}`, 'SQL');

const stale = await call('returning', 'POST', '/affiliate/orders', { ...body, expectedTotal: 1000 }, { 'idempotency-key': idk('l6m') });
check('L6-M08', T('Giá đã báo với khách thấp hơn giá hiện tại: từ chối, không âm thầm ghi đơn đắt hơn', 'returning', 'POST /affiliate/orders expectedTotal=1000', '400 báo tổng đã đổi'), stale.status === 400 && /PRICE_CHANGED|tổng/i.test(JSON.stringify(stale.body)), `${stale.status} ${short(stale.body, 260)}`, 'API');

const cust = await call('new', 'POST', '/affiliate/orders', body, { 'idempotency-key': idk('l6m') });
const guest = await call(null, 'POST', '/affiliate/orders', body);
const dealer = await call('dealer', 'POST', '/affiliate/orders', body, { 'idempotency-key': idk('l6m') });
check('L6-M09', T('Khách thường, đại lý và khách chưa đăng nhập không lên đơn hộ được', 'new', 'POST /affiliate/orders', 'khách thường/đại lý 400 "Chỉ CTV mới có thể lên đơn hộ khách."; chưa đăng nhập 401'), cust.status === 400 && dealer.status === 400 && /Chỉ CTV/.test(JSON.stringify(cust.body)) && /Chỉ CTV/.test(JSON.stringify(dealer.body)) && guest.status === 401, `khách ${cust.status}; đại lý ${dealer.status}; guest ${guest.status}`, 'API');

// ---------- giao hàng: điểm CTV không đổi, hoa hồng LOCKED ----------
const [pb0] = await sql(`SELECT "pointsBalance"::int p FROM users WHERE id=$1`, CTV);
webhook(code, 'shipped'); webhook(code, 'delivered');
const [cm2] = await commissionOf(code);
const [pb1] = await sql(`SELECT "pointsBalance"::int p FROM users WHERE id=$1`, CTV);
check('L6-M10', T('Đơn hộ giao thành công: hoa hồng sang LOCKED, CTV không được cộng Điểm Xanh mua hàng (đơn hộ không tích điểm)', 'returning', 'webhook shipped + delivered', 'commission LOCKED; điểm CTV không đổi'), cm2?.status === 'LOCKED' && pb1.p === pb0.p, `commission=${cm2?.status}; điểm ${pb0.p}→${pb1.p}`, 'SQL');

// ---------- trả cả đơn hộ: hoa hồng bị thu hồi ----------
webhook(code, 'returned');
const [cm3] = await commissionOf(code);
const [os] = await sql(`SELECT status::text s FROM orders WHERE code=$1`, code);
check('L6-M11', T('Đơn hộ bị trả: hoa hồng REJECTED, đơn RETURNED', 'returning', 'webhook returned', 'commission REJECTED; đơn RETURNED'), cm3?.status === 'REJECTED' && os.s === 'RETURNED', `commission=${cm3?.status}; đơn=${os.s}`, 'SQL');

await done();
