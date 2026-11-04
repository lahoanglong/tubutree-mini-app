// C5: đại lý: giá sỉ theo bậc, đơn tối thiểu, phí giao, công nợ (hạn mức, quá hạn, báo CK, admin ghi nhận), hoa hồng giới thiệu của đại lý.
// Luật (SystemConfig + dealer_tiers): dealer.min_order_value_vnd=3.000.000, dealer.free_ship_threshold_vnd=5.000.000, dealer.shipping_fee_below_threshold_vnd=19.000,
// dealer.max_discount_pct=0.45, dealer.block_credit_when_overdue=true; bậc DEALER_2: chiết khấu 30%, hạn mức 20.000.000, NET 15. Mã: dealer.service.ts.
// Chạy sau c1-c4: node c5-dealer.mjs (từ gốc worktree uat-1104).
import { call, short, sql, exec, buy, orderRow, commissionOf, notifs, check, done, sleep, idk, varId, ensureAddress, webhook } from './common.mjs';

const T = (title, persona, step, expect) => ({ title, persona, size: 'API', journey: title, step, expect });
const D = 'uat_dealer';
const price = (retail) => Math.round(retail * 0.7);
const SH = 94_500; // HEC-SH-300: 135.000 × 0.7
const debt = async () => (await sql(`SELECT COALESCE(SUM(delta),0)::int s FROM dealer_credit_ledgers WHERE "userId"=$1`, D))[0].s;
const dOrder = async (sku, qty, paymentMethod, key, extra = {}) => {
  const addressId = await ensureAddress('dealer');
  return call('dealer', 'POST', '/dealer/orders', { items: [{ variationId: await varId(sku), quantity: qty }], paymentMethod, addressId, ...extra }, { 'idempotency-key': key ?? idk('l6dealer') });
};

await ensureAddress('dealer');

// ---------- hồ sơ + bảng giá ----------
{
  const me = await call('dealer', 'GET', '/dealer/me');
  const ok = me.body?.isDealer === true && me.body?.tier?.id === 'DEALER_2' && me.body?.tier?.creditLimit === 20_000_000 && me.body?.currentDebt === 0 && me.body?.orderRules?.minOrderValue === 3_000_000 && me.body?.orderRules?.freeShipThreshold === 5_000_000 && me.body?.orderRules?.shippingFee === 19_000;
  check('L6-G01', T('Trang đại lý: bậc, hạn mức, công nợ, luật đơn tối thiểu và phí giao', 'dealer', 'GET /dealer/me', 'tier DEALER_2 hạn mức 20.000.000, nợ 0, tối thiểu 3.000.000, miễn ship từ 5.000.000, phí 19.000 (dealer.* SystemConfig)'), ok, short(me.body, 500), 'API');
  const pl = await call('dealer', 'GET', '/dealer/pricelist');
  const rows = pl.body ?? [];
  const bad = rows.filter((r) => r.dealerPrice !== price(r.retailPrice));
  const raw = JSON.stringify(rows);
  check('L6-G02', T('Bảng giá sỉ theo bậc: mọi dòng = giá lẻ × (1 − 30%) làm tròn; không lộ giá vốn/hoa hồng', 'dealer', 'GET /dealer/pricelist', 'dealerPrice = round(retailPrice × 0.7) cho mọi dòng, discountPct=30'), rows.length > 20 && bad.length === 0 && rows.every((r) => r.discountPct === 30) && !/affiliateRate|costPrice/.test(raw), `${rows.length} dòng; lệch=${bad.length} ${short(bad.slice(0, 2), 200)}; mẫu=${short(rows.find((r) => r.sku === 'HEC-SH-300'), 260)}`, 'API');
  const c = await call('new', 'GET', '/dealer/pricelist');
  const k = await call('ctv', 'GET', '/dealer/pricelist');
  check('L6-G03', T('Khách thường và CTV không xem được giá sỉ', 'new', 'GET /dealer/pricelist', '403 "Tài khoản chưa được duyệt làm đại lý."'), c.status === 403 && k.status === 403 && c.body.message === 'Tài khoản chưa được duyệt làm đại lý.', `khách=${c.status} ${short(c.body, 160)}; CTV=${k.status}`, 'API');
}

// ---------- đơn tối thiểu + phí giao ----------
{
  const low = await dOrder('HEC-SH-300', 31, 'PREPAID'); // 2.929.500
  check('L6-G04', T('Đơn dưới mức tối thiểu 3.000.000đ bị chặn kèm số tiền thiếu', 'dealer', 'POST /dealer/orders 31×HEC-SH-300 (2.929.500đ)', '400 code DEALER_ORDER_BELOW_MIN, "Đơn đại lý tối thiểu 3.000.000đ tiền hàng, đơn của bạn mới 2.929.500đ. Bạn thêm hàng vào đơn nhé."'),
    low.status === 400 && low.body.code === 'DEALER_ORDER_BELOW_MIN' && low.body.message === 'Đơn đại lý tối thiểu 3.000.000đ tiền hàng, đơn của bạn mới 2.929.500đ. Bạn thêm hàng vào đơn nhé.', `${low.status} ${short(low.body, 300)}`, 'API');
  const o1 = await dOrder('HEC-SH-300', 32, 'PREPAID'); // 3.024.000 + 19.000
  const [r1] = o1.body?.code ? await sql(`SELECT subtotal, "shippingFee" ship, total, status::text st, "paymentMethod"::text pm, "paymentStatus"::text ps, type::text t FROM orders WHERE code=$1`, o1.body.code) : [];
  const ledger1 = o1.body?.id ? (await sql(`SELECT count(*)::int c FROM dealer_credit_ledgers WHERE "refId"=$1`, o1.body.id))[0].c : -1;
  check('L6-G05', T('Đơn vừa đủ tối thiểu (3.024.000đ), trả trước: phí giao 19.000đ, chờ thanh toán, không ghi công nợ', 'dealer', 'POST /dealer/orders 32×HEC-SH-300 PREPAID', 'subtotal 3.024.000 + ship 19.000 = 3.043.000; PENDING_PAYMENT/UNPAID, type DEALER; không có dòng công nợ'),
    o1.status === 201 && r1?.subtotal === 3_024_000 && r1?.ship === 19_000 && r1?.total === 3_043_000 && r1?.st === 'PENDING_PAYMENT' && r1?.ps === 'UNPAID' && r1?.t === 'DEALER' && ledger1 === 0, `${o1.status}; SQL=${short(r1)}; công nợ=${ledger1}`, 'SQL');
  const a = await dOrder('HEC-SH-300', 52, 'PREPAID'); // 4.914.000 → còn ship
  const b = await dOrder('HEC-SH-300', 53, 'PREPAID'); // 5.008.500 → miễn ship
  const [ra] = await sql(`SELECT subtotal, "shippingFee" ship, total FROM orders WHERE code=$1`, a.body?.code ?? '');
  const [rb] = await sql(`SELECT subtotal, "shippingFee" ship, total FROM orders WHERE code=$1`, b.body?.code ?? '');
  check('L6-G06', T('Ngưỡng miễn phí giao 5.000.000đ: 4.914.000đ còn phí 19.000đ, 5.008.500đ miễn phí', 'dealer', 'POST /dealer/orders 52 và 53 × HEC-SH-300', 'dealer.free_ship_threshold_vnd=5.000.000'), ra?.ship === 19_000 && rb?.ship === 0 && rb?.total === 5_008_500, `52: ${short(ra)}; 53: ${short(rb)}`, 'SQL');
  const items = await sql(`SELECT "unitPrice", quantity, total, "backorderedQty" bo FROM order_items WHERE "orderId"=$1`, b.body?.id ?? '');
  check('L6-G07', T('Dòng đơn đại lý chốt đúng giá sỉ', 'dealer', 'SQL order_items của đơn 53×HEC-SH-300', `unitPrice ${SH}đ, total ${SH * 53}đ`), items[0]?.unitPrice === SH && items[0]?.total === SH * 53, short(items), 'SQL');
}

// ---------- công nợ ----------
let creditOrder;
{
  const before = await debt();
  const key = idk('l6credit');
  const c1 = await dOrder('HEC-SH-300', 40, 'CREDIT', key); // 3.780.000 + 19.000 = 3.799.000
  const c1b = await dOrder('HEC-SH-300', 40, 'CREDIT', key);
  creditOrder = c1.body;
  const after = await debt();
  const [r] = await sql(`SELECT status::text st, total FROM orders WHERE code=$1`, c1.body?.code ?? '');
  const lines = await sql(`SELECT delta, "refType", "refId" FROM dealer_credit_ledgers WHERE "refId"=$1`, c1.body?.id ?? '');
  check('L6-G08', T('Đặt đơn ghi công nợ: CONFIRMED, sổ công nợ +tổng đơn đúng một dòng; gửi lại cùng Idempotency-Key trả cùng đơn, không ghi đôi', 'dealer', 'POST /dealer/orders CREDIT ×2 cùng khoá', 'đơn CONFIRMED 3.799.000đ; công nợ + 3.799.000; một dòng ORDER; lần 2 cùng mã đơn'),
    c1.status === 201 && c1b.body?.code === c1.body?.code && r?.st === 'CONFIRMED' && r?.total === 3_799_000 && after === before + 3_799_000 && lines.length === 1 && lines[0].refType === 'ORDER', `đơn=${c1.body?.code}/${c1b.body?.code}; ${short(r)}; nợ ${before}→${after}; sổ=${short(lines)}`, 'SQL');
  const me = await call('dealer', 'GET', '/dealer/me');
  const led = await call('dealer', 'GET', '/dealer/credit-ledger');
  check('L6-G09', T('Trang đại lý hiện công nợ khớp sổ', 'dealer', 'GET /dealer/me, /dealer/credit-ledger', `currentDebt = Σ sổ = ${after}`), me.body?.currentDebt === after && JSON.stringify(led.body).includes(String(3_799_000)), `currentDebt=${me.body?.currentDebt}; sổ API=${short(led.body, 300)}`, 'API + SQL');
  const over = await dOrder('HEC-SH-300', 300, 'CREDIT'); // 28.350.000 + dư nợ > 20.000.000
  const [ov] = await sql(`SELECT count(*)::int c FROM orders WHERE "userId"=$1 AND total > 28000000`, D);
  check('L6-G10', T('Đơn công nợ vượt hạn mức 20.000.000đ bị chặn, không tạo đơn/sổ', 'dealer', 'POST /dealer/orders CREDIT 28.350.000đ', '400 "Vượt hạn mức công nợ."; nợ không đổi'), over.status === 400 && over.body.message === 'Vượt hạn mức công nợ.' && ov.c === 0 && (await debt()) === after, `${over.status} ${short(over.body, 160)}; đơn >28tr=${ov.c}; nợ=${await debt()}`, 'SQL');
  // quá hạn NET 15
  await exec(`UPDATE dealer_credit_ledgers SET "createdAt" = now() - interval '16 days' WHERE "refId" = $1 AND "refType"='ORDER'`, c1.body.id);
  const blocked = await dOrder('HEC-SH-300', 32, 'CREDIT');
  const prepaid = await dOrder('HEC-SH-300', 32, 'PREPAID');
  check('L6-G11', T('Còn nợ quá hạn NET 15: chặn đơn công nợ mới, vẫn đặt được đơn trả trước', 'dealer', 'lùi đơn nợ 16 ngày rồi POST /dealer/orders CREDIT và PREPAID', 'CREDIT → 400 code DEALER_CREDIT_OVERDUE "Bạn còn nợ đơn ngày … đã quá hạn thanh toán (NET 15). …"; PREPAID → 201 (dealer.block_credit_when_overdue=true)'),
    blocked.status === 400 && blocked.body.code === 'DEALER_CREDIT_OVERDUE' && /đã quá hạn thanh toán \(NET 15\)/.test(blocked.body.message) && prepaid.status === 201, `CREDIT=${blocked.status} ${short(blocked.body, 360)}; PREPAID=${prepaid.status}`, 'API');
  // báo CK: không tự trừ nợ
  const rep = await call('dealer', 'POST', '/dealer/credit-payment', { amount: 1_000_000, note: 'CK lần 1' });
  const afterReport = await debt();
  const reports = await call('admin', 'GET', '/admin/dealer-credit-reports?status=REPORTED');
  const repId = (reports.body?.data ?? reports.body?.items ?? reports.body ?? []).find?.((x) => x.userId === D)?.id;
  check('L6-G12', T('Đại lý báo đã chuyển khoản: KHÔNG tự trừ nợ, tạo báo cáo cho kế toán', 'dealer', 'POST /dealer/credit-payment 1.000.000đ; admin GET /admin/dealer-credit-reports', 'nợ không đổi; báo cáo REPORTED xuất hiện'), rep.status < 300 && afterReport === after && !!repId, `báo=${rep.status} ${short(rep.body, 160)}; nợ=${afterReport}; báo cáo id=${repId}`, 'SQL + API');
  const ketoan = await call('ketoan', 'POST', `/admin/dealers/${D}/credit-payment`, { amount: 1_000_000, reportId: repId, note: 'Đã nhận CK' }, { 'idempotency-key': idk('l6pay') });
  const afterPay = await debt();
  const [pl] = await sql(`SELECT delta, "refType" FROM dealer_credit_ledgers WHERE "userId"=$1 AND "refType"='PAYMENT' ORDER BY "createdAt" DESC LIMIT 1`, D);
  check('L6-G13', T('Kế toán ghi nhận tiền về: nợ giảm đúng số, đóng báo cáo', 'ketoan', 'POST /admin/dealers/:id/credit-payment 1.000.000đ kèm reportId', `nợ ${after} → ${after - 1_000_000}; dòng PAYMENT −1.000.000`), ketoan.status < 300 && afterPay === after - 1_000_000 && pl?.delta === -1_000_000, `${ketoan.status} ${short(ketoan.body, 200)}; nợ=${afterPay}; dòng=${short(pl)}`, 'SQL');
  const over2 = await call('admin', 'POST', `/admin/dealers/${D}/credit-payment`, { amount: afterPay + 1 }, { 'idempotency-key': idk('l6pay') });
  check('L6-G14', T('Ghi nhận trả nợ vượt dư nợ bị chặn', 'admin', 'POST /admin/dealers/:id/credit-payment amount = dư nợ + 1', '400, nợ không đổi'), over2.status === 400 && (await debt()) === afterPay, `${over2.status} ${short(over2.body, 200)}; nợ=${await debt()}`, 'SQL');
  const full = await call('admin', 'POST', `/admin/dealers/${D}/credit-payment`, { amount: afterPay }, { 'idempotency-key': idk('l6pay') });
  const free = await dOrder('SOK-CT-150', 44, 'CREDIT'); // 3.049.200 + 19.000 = 3.068.200, hàng đủ tồn nên được đẩy Pancake
  check('L6-G15', T('Trả hết nợ quá hạn: đặt lại được đơn công nợ', 'dealer', 'admin ghi nhận trả đủ dư nợ rồi POST /dealer/orders CREDIT', 'nợ về 0; đơn CREDIT 201'), full.status < 300 && free.status === 201, `trả=${full.status}; nợ sau đơn mới=${await debt()}; đơn mới=${free.status} ${short(free.body?.code)}`, 'SQL');
  // huỷ đơn công nợ → sổ trừ lại
  const cancelCode = free.body?.code;
  const d0 = await debt();
  webhook(cancelCode, 'cancelled');
  await sleep(1500);
  const d1 = await debt();
  const [cl] = await sql(`SELECT delta, "refType" FROM dealer_credit_ledgers WHERE "userId"=$1 AND "refType"='ORDER_CANCEL' ORDER BY "createdAt" DESC LIMIT 1`, D);
  check('L6-G16', T('Huỷ đơn công nợ: công nợ được hoàn đúng số', 'dealer', 'webhook cancelled đơn CREDIT', 'dòng ORDER_CANCEL −tổng đơn, nợ giảm'), d1 === d0 - 3_068_200 && cl?.delta === -3_068_200, `nợ ${d0}→${d1}; dòng=${short(cl)}`, 'SQL');
}

// ---------- đối soát tồn kho giữ chỗ ----------
{
  const bo = await dOrder('HEC-SH-300', 400, 'PREPAID'); // vượt tồn → đặt trước
  const items = bo.body?.id ? await sql(`SELECT quantity, "backorderedQty" bo FROM order_items WHERE "orderId"=$1`, bo.body.id) : [];
  const [v] = await sql(`SELECT stock, "reservedStock" rs FROM variations WHERE sku='HEC-SH-300'`);
  check('L6-G17', T('Đại lý đặt vượt tồn: nhận đơn, phần thiếu ghi đặt trước (backorderedQty), tồn kho giữ chỗ không âm', 'dealer', 'POST /dealer/orders 400×HEC-SH-300 PREPAID', 'đơn 201, backorderedQty > 0, tồn và tồn giữ chỗ không âm'), bo.status === 201 && items[0]?.bo > 0 && v.stock >= 0 && v.rs >= 0, `${bo.status}; dòng=${short(items)}; tồn=${short(v)}`, 'SQL');
}

// ---------- hoa hồng giới thiệu của đại lý ----------
{
  const b = await buy('new', [['FUWA-GL-500', 2]], { paymentMethod: 'COD', referralCode: 'UATDEALER' });
  const o = await orderRow(b.code);
  const [c] = await commissionOf(b.code);
  const me = await call('dealer', 'GET', '/affiliate/me');
  check('L6-G18', T('Đại lý cũng hưởng hoa hồng khi khách mua qua mã của họ (affiliate.commission_eligible_roles gồm DEALER)', 'new', 'place-order referralCode=UATDEALER', 'ref=uat_dealer, hoa hồng floor(158.000×8%)=12.640đ; sau đó dealer có công cụ CTV (isAffiliate)'), o?.ref === D && c?.amount === 12_640 && me.body?.isAffiliate === true, `ref=${o?.ref}; commission=${short(c, 200)}; /affiliate/me.isAffiliate=${me.body?.isAffiliate}`, 'SQL + API');
  const vid = await varId('FUWA-GL-500');
  const ofc = await call('dealer', 'POST', '/affiliate/orders', { items: [{ variationId: vid, quantity: 1 }], paymentMethod: 'BANK_TRANSFER', customer: { recipient: 'Khách UAT', phone: '0901000099', province: 'Hồ Chí Minh', ward: 'Bến Nghé', street: '1 Lê Lợi', provinceCode: '79', wardCode: '26740' } });
  check('L6-G19', T('Đại lý không lên đơn hộ khách (chỉ CTV/admin)', 'dealer', 'POST /affiliate/orders (payload hợp lệ)', '400/403, câu "Chỉ CTV mới có thể lên đơn hộ khách."'), [400, 403].includes(ofc.status) && /Chỉ CTV/.test(JSON.stringify(ofc.body)), `${ofc.status} ${short(ofc.body, 160)}`, 'API');
}

// ---------- đại lý đăng ký + duyệt ----------
{
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const ap = await call('new', 'POST', '/dealer/apply', { businessName: 'Cửa hàng Xanh Thử', ownerName: 'Khách Mới', phone: '0901000001', address: '12 Lê Lợi, Quận 1', cccdFrontUrl: png, cccdBackUrl: png, monthlyVolumeEstimate: 20000000 });
  const me = await call('new', 'GET', '/dealer/me');
  check('L6-G20', T('Khách nộp hồ sơ đại lý: trạng thái chờ duyệt', 'new', 'POST /dealer/apply; GET /dealer/me', 'apply 201; me.status = PENDING (hoặc tương đương), isDealer=false'), ap.status === 201 && me.body?.isDealer === false && /PENDING|REVIEW/.test(me.body?.status ?? ''), `apply=${ap.status} ${short(ap.body, 160)}; me=${short({ isDealer: me.body?.isDealer, status: me.body?.status }, 120)}`, 'API');
}
await done();
