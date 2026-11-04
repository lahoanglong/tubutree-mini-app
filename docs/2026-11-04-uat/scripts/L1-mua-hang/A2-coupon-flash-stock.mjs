// A2: mã giảm giá ngoại lệ, giờ vàng (flash sale), tồn kho, sửa giỏ, mua một phần giỏ, idempotency. API thật + SQL đối chiếu.
// Chạy sau A1 trên cùng lane:  node /Users/longla/coding/tubutree-mini-app/.claude/worktrees/gl-1103-docs/docs/2026-11-04-uat/scripts/L1-mua-hang/A2-coupon-flash-stock.mjs [lọc-id]
import { L, sql, sqlExec, rec, closePrisma, api, idem } from './lib.mjs';
import { V, who, fresh, fillCart, clearCart, quote, place, loadCfg, userFacts, oracle, diff, snapshot, reconcileOrder } from './kit.mjs';

const FILE = 'A2';
const only = process.argv[2];
const run = (id) => !only || id.startsWith(only);
const cfg = await loadCfg();
const msgOf = (r) => (Array.isArray(r.body?.message) ? r.body.message.join(' | ') : r.body?.message ?? JSON.stringify(r.body));
const adminTok = (await who('admin')).token;

// ---- chuẩn bị dữ liệu lane (SQL/endpoint admin, ghi lại để tái hiện) ----
// Mẫu dựng 25/10 có giờ vàng hết hạn 03/11 07:58Z: dời hạn để có giờ vàng đang chạy (README harness: dựng lại mẫu khi flash sale hết hạn).
await sqlExec(`update flash_sales set "startAt" = now() - interval '1 hour', "endAt" = now() + interval '5 days', "isActive" = true`);
await sqlExec(`update flash_sale_items set "soldCount" = 0`);
await sqlExec(`delete from flash_sale_purchases`);

const mk = async (code, extra = {}) => {
  const ex = (await sql(`select id from coupons where code = '${code}'`))[0];
  if (ex) await sqlExec(`delete from coupon_redemptions where "couponId" = '${ex.id}'`).catch(() => {});
  if (ex) await sqlExec(`delete from coupons where id = '${ex.id}'`);
  const body = { code, type: 'AMOUNT', value: 20000, minOrder: 0, startAt: new Date(Date.now() - 864e5).toISOString(), endAt: new Date(Date.now() + 30 * 864e5).toISOString(), perUserLimit: 5, scope: 'PUBLIC', ...extra };
  const r = await api(L, 'POST', '/admin/coupons', { token: adminTok, body });
  if (r.status >= 300) throw new Error(`tạo mã ${code}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};
await mk('UATEXP');
await sqlExec(`update coupons set "endAt" = now() - interval '2 days', "startAt" = now() - interval '5 days' where code = 'UATEXP'`);
await mk('UATFUT');
await sqlExec(`update coupons set "startAt" = now() + interval '3 days' where code = 'UATFUT'`);
const off = await mk('UATOFF');
await api(L, 'PATCH', `/admin/coupons/${off.id}`, { token: adminTok, body: { isActive: false } });
await mk('UATLIM1', { usageLimit: 1, perUserLimit: 1 });
await mk('UATBIG', { type: 'AMOUNT', value: 500000 });
await mk('UATX10', { type: 'PERCENT', value: 10, maxDiscount: 50000, minOrder: 250000, perUserLimit: 99 });

const cases = [];
const C = (id, fn) => cases.push([id, fn]);

// ---------- mã: chữ báo lỗi ----------
const applyErr = async (id, persona, lines, code, expectMsg, step) => {
  if (!run(id)) return;
  const w = await who(persona);
  await fillCart(w, lines);
  const r = await api(L, 'POST', '/cart/coupon', { token: w.token, body: { code } });
  const msg = msgOf(r);
  rec(FILE, { id, persona, surface: 'api', journey: 'mã giảm giá', step, expected: `400 "${expectMsg}"`, actual: `${r.status} "${msg}"`, status: r.status === 400 && msg === expectMsg ? 'PASS' : 'FAIL' });
};
await applyErr('A2-01', 'returning', [[V.LAUNDRY, 1]], 'UATEXP', 'Mã giảm giá đã hết hạn hoặc chưa hiệu lực.', 'mã hết hạn');
await applyErr('A2-02', 'returning', [[V.LAUNDRY, 1]], 'UATFUT', 'Mã giảm giá đã hết hạn hoặc chưa hiệu lực.', 'mã chưa tới ngày');
await applyErr('A2-03', 'returning', [[V.LAUNDRY, 1]], 'UATOFF', 'Mã giảm giá đã ngừng áp dụng.', 'mã đã tắt');

// hết lượt toàn cục: returning dùng UATLIM1 qua đơn thật, new gõ lại -> hết lượt
if (run('A2-04')) {
  const a = await who('returning');
  await fillCart(a, [[V.LAUNDRY, 1]]);
  const r1 = await api(L, 'POST', '/cart/coupon', { token: a.token, body: { code: 'UATLIM1' } });
  const q1 = await quote(a);
  const p1 = await place(a, { expectedTotal: q1.body.total });
  const u = (await sql(`select "usedCount" u, "usageLimit" l from coupons where code='UATLIM1'`))[0];
  rec(FILE, { id: 'A2-04a', persona: 'returning', surface: 'api', journey: 'mã giảm giá', step: 'dùng mã UATLIM1 (tổng 1 lượt) đặt đơn thật', expected: 'đặt được; usedCount=1', actual: `apply ${r1.status}, place ${p1.status}, usedCount=${u.u}/${u.l}`, evidence: `đơn ${p1.body.code}`, status: p1.status < 300 && u.u === 1 ? 'PASS' : 'FAIL' });
  const b = await who('new');
  await fillCart(b, [[V.LAUNDRY, 1]]);
  const r2 = await api(L, 'POST', '/cart/coupon', { token: b.token, body: { code: 'UATLIM1' } });
  const msg = msgOf(r2);
  rec(FILE, { id: 'A2-04b', persona: 'new', surface: 'api', journey: 'mã giảm giá', step: 'mã hết lượt toàn cục', expected: '400 "Mã giảm giá đã hết lượt sử dụng."', actual: `${r2.status} "${msg}"`, status: r2.status === 400 && msg === 'Mã giảm giá đã hết lượt sử dụng.' ? 'PASS' : 'FAIL' });
  // cùng người dùng lại mã 1 lượt/khách
  await fillCart(a, [[V.LAUNDRY, 1]]);
  const r3 = await api(L, 'POST', '/cart/coupon', { token: a.token, body: { code: 'UATLIM1' } });
  rec(FILE, { id: 'A2-04c', persona: 'returning', surface: 'api', journey: 'mã giảm giá', step: 'người đã dùng mã 1 lượt/khách gõ lại', expected: '400 (hết lượt, toàn cục hoặc cá nhân)', actual: `${r3.status} "${msgOf(r3)}"`, status: r3.status === 400 ? 'PASS' : 'FAIL' });
}

// hết lượt cá nhân: XANH10 perUserLimit 2
if (run('A2-05')) {
  const w = await who('returning');
  const used0 = (await sql(`select count(*)::int n from coupon_redemptions r join coupons c on c.id=r."couponId" where c.code='XANH10' and r."userId"='${w.userId}'`))[0].n;
  let placed = 0;
  let lastMsg = '';
  for (let i = 0; i < 3; i++) {
    await fillCart(w, [[V.LAUNDRY, 1], [V.HANDWASH, 1]]);
    const r = await api(L, 'POST', '/cart/coupon', { token: w.token, body: { code: 'XANH10' } });
    if (r.status >= 300) { lastMsg = msgOf(r); break; }
    const q = await quote(w);
    const p = await place(w, { expectedTotal: q.body.total });
    if (p.status < 300) placed++; else { lastMsg = msgOf(p); break; }
  }
  const used1 = (await sql(`select count(*)::int n from coupon_redemptions r join coupons c on c.id=r."couponId" where c.code='XANH10' and r."userId"='${w.userId}'`))[0].n;
  rec(FILE, { id: 'A2-05', persona: 'returning', surface: 'api', journey: 'mã giảm giá', step: 'XANH10 perUserLimit=2: dùng thêm cho tới khi chạm trần', expected: `tổng lượt của khách dừng ở 2 (đã có ${used0}); chữ "Bạn đã dùng hết lượt cho mã này."`, actual: `đặt thêm ${placed}, lượt SQL ${used1}, lỗi cuối "${lastMsg}"`, status: used1 === 2 && lastMsg === 'Bạn đã dùng hết lượt cho mã này.' ? 'PASS' : 'FAIL' });
}

// chuẩn hoá mã: chữ thường + khoảng trắng
if (run('A2-06')) {
  const w = await who('returning');
  await fillCart(w, [[V.LAUNDRY, 1], [V.SERUM30, 1]]);
  const r = await api(L, 'POST', '/cart/coupon', { token: w.token, body: { code: ' freeship ' } });
  rec(FILE, { id: 'A2-06', persona: 'returning', surface: 'api', journey: 'mã giảm giá', step: 'gõ " freeship " chữ thường + khoảng trắng', expected: '2xx, couponCode=FREESHIP (normalizeCouponCode)', actual: `${r.status} couponCode=${r.body?.couponCode} freeship=${r.body?.freeship}`, status: r.status < 300 && r.body?.couponCode === 'FREESHIP' ? 'PASS' : 'FAIL' });
}

// giảm lớn hơn tiền hàng: không âm
if (run('A2-07')) {
  const w = await who('new');
  await fillCart(w, [[V.MASK, 1]]);
  const r = await api(L, 'POST', '/cart/coupon', { token: w.token, body: { code: 'UATBIG' } });
  const q = await quote(w);
  const f = await userFacts(w.userId);
  const cp = (await sql(`select * from coupons where code='UATBIG'`))[0];
  const o = oracle({ lines: [{ unit: 25000, qty: 1, flash: false }], coupon: cp, cfg, facts: f });
  const got = { discount: q.body.discount, shippingFee: q.body.shippingFee, total: q.body.total };
  const exp = { discount: o.discount, shippingFee: o.ship, total: o.total };
  rec(FILE, { id: 'A2-07', persona: 'new', surface: 'api', journey: 'mã giảm giá', step: 'mã 500.000đ trên giỏ 25.000đ: giảm kẹp bằng tiền hàng, không âm', expected: JSON.stringify(exp), actual: JSON.stringify(got), evidence: `apply ${r.status}`, status: diff(exp, got) || q.body.total < 0 ? 'FAIL' : 'PASS' });
}

// ---------- giờ vàng ----------
const CGL = { variationId: 'cmqfv3q6h002lcgcou94v9rfl', flashPrice: 165000, retail: 220000, itemId: 'cmvrtogz8002lurfjwoulpmyl' };
const CW = { variationId: 'cmqfv2cns001nzxplvuhm8hyq', flashPrice: 119000, retail: 180000, sale: 159000, itemId: 'cmvrtogzd002ourfj5b915rzu' };
if (run('A2-10')) {
  const act = await api(L, 'GET', '/flash-sales/active', {});
  const items = act.body?.[0]?.items ?? act.body?.items ?? [];
  rec(FILE, { id: 'A2-10', persona: 'guest', surface: 'api', journey: 'giờ vàng', step: 'GET /flash-sales/active (không đăng nhập)', expected: '2xx, 3 sản phẩm giá giờ vàng 165.000/119.000/195.000', actual: `${act.status} ${JSON.stringify(act.body).slice(0, 400)}`, status: act.status === 200 && JSON.stringify(act.body).includes('165000') ? 'PASS' : 'FAIL' });
}
if (run('A2-11')) {
  const w = await who('returning');
  const f = await fillCart(w, [[CGL.variationId, 1]]);
  const it = f.cart.items[0];
  const ok = it.isFlash === true && it.unitPrice === CGL.flashPrice && it.listUnitPrice === CGL.retail;
  rec(FILE, { id: 'A2-11', persona: 'returning', surface: 'api', journey: 'giờ vàng', step: 'thêm sản phẩm giờ vàng vào giỏ', expected: `isFlash, unitPrice ${CGL.flashPrice}, listUnitPrice ${CGL.retail}`, actual: `isFlash=${it.isFlash} unit=${it.unitPrice} list=${it.listUnitPrice} soldPct=${it.soldPct} notice=${it.flashLimitNotice}`, status: ok ? 'PASS' : 'FAIL' });
  // vượt giới hạn mua mỗi khách (perUserLimit=2)
  const r = await api(L, 'PATCH', `/cart/items/${it.id}`, { token: w.token, body: { quantity: 3 } });
  const c2 = (await api(L, 'GET', '/cart', { token: w.token })).body;
  const q = await quote(w);
  const p = await place(w, { expectedTotal: q.body.total });
  rec(FILE, { id: 'A2-12', persona: 'returning', surface: 'api', journey: 'giờ vàng', step: 'mua 3 sản phẩm giờ vàng khi mỗi khách tối đa 2', expected: 'đặt đơn bị chặn bằng lỗi giới hạn mua (không tính giá giờ vàng cho suất thứ 3)', actual: `patch ${r.status}; cart line unit=${c2.items[0].unitPrice} qty=${c2.items[0].quantity} notice=${c2.items[0].flashLimitNotice}; quote total=${q.body.total}; place ${p.status} ${msgOf(p)}`, evidence: JSON.stringify({ quoteSub: q.body.subtotal }), status: 'CAN_CHU' });
  await fillCart(w, [[CGL.variationId, 2]]);
}
if (run('A2-13')) {
  const w = await who('returning');
  const snap0 = await snapshot(w.userId, [CGL.variationId]);
  const fi0 = (await sql(`select "soldCount" s from flash_sale_items where id='${CGL.itemId}'`))[0].s;
  await fillCart(w, [[CGL.variationId, 2]]);
  const q = await quote(w);
  const f = await userFacts(w.userId);
  const o = oracle({ lines: [{ unit: CGL.flashPrice, qty: 2, flash: true }], coupon: null, cfg, facts: f });
  const p = await place(w, { expectedTotal: q.body.total });
  const row = p.status < 300 ? (await reconcileOrder(p.body.code)) : null;
  const fi1 = (await sql(`select "soldCount" s from flash_sale_items where id='${CGL.itemId}'`))[0].s;
  const purchase = await sql(`select quantity from flash_sale_purchases where "flashSaleItemId"='${CGL.itemId}' and "userId"='${w.userId}'`);
  const items = p.status < 300 ? await sql(`select "unitPrice"::int up, quantity, "flashSaleItemId" fid from order_items where "orderId"='${row.row.id}'`) : [];
  const probs = [...(row?.problems ?? [])];
  if (q.body.total !== o.total) probs.push(`báo giá ${q.body.total} ≠ oracle ${o.total}`);
  if (fi1 - fi0 !== 2) probs.push(`soldCount +${fi1 - fi0}, mong +2`);
  if (purchase[0]?.quantity !== 2) probs.push(`flash_sale_purchases ${JSON.stringify(purchase)}, mong 2`);
  if (items[0]?.up !== CGL.flashPrice || items[0]?.fid !== CGL.itemId) probs.push(`dòng đơn ${JSON.stringify(items)}`);
  rec(FILE, { id: 'A2-13', persona: 'returning', surface: 'api', journey: 'giờ vàng', step: 'đặt 2 sản phẩm giờ vàng (đúng giới hạn)', expected: `tổng ${o.total}; soldCount +2; flash_sale_purchases qty 2; dòng đơn giá ${CGL.flashPrice}`, actual: `place ${p.status} ${p.status < 300 ? '' : msgOf(p)}; total=${row?.row.total}; soldCount ${fi0}→${fi1}`, evidence: probs.join(' | ') || 'khớp SQL', status: p.status < 300 && !probs.length ? 'PASS' : 'FAIL' });
  // mua thêm khi đã chạm giới hạn 2
  await fillCart(w, [[CGL.variationId, 1]]);
  const c = (await api(L, 'GET', '/cart', { token: w.token })).body;
  const q2 = await quote(w);
  const p2 = await place(w, { expectedTotal: q2.body.total });
  rec(FILE, { id: 'A2-14', persona: 'returning', surface: 'api', journey: 'giờ vàng', step: 'đã mua đủ 2, mua thêm 1 sản phẩm giờ vàng', expected: 'không được giá giờ vàng lần nữa: lỗi rõ ràng hoặc giá thường', actual: `giỏ unit=${c.items[0].unitPrice} isFlash=${c.items[0].isFlash} notice=${c.items[0].flashLimitNotice}; place ${p2.status} ${p2.status < 300 ? 'total=' + p2.body.total : msgOf(p2)}`, status: 'CAN_CHU' });
}
if (run('A2-15')) {
  // WELCOME30 + giỏ có giờ vàng: phần giờ vàng không tính vào điều kiện mã (khách mới tinh, chưa dùng mã nào)
  const w = await fresh('f15');
  const f0 = await fillCart(w, [[CW.variationId, 1], [V.DISH1L, 1]]);
  const r = await api(L, 'POST', '/cart/coupon', { token: w.token, body: { code: 'WELCOME30' } });
  const expect = 'Đơn tối thiểu 199.000đ để dùng mã này. Hàng Giờ vàng không được tính vào điều kiện của mã, phần được tính là 120.000đ.';
  rec(FILE, { id: 'A2-15', persona: 'new (mới tinh)', surface: 'api', journey: 'mã giảm giá', step: 'WELCOME30, giỏ = 1 giờ vàng 119.000 + 1 nước rửa chén 120.000 (tổng 239.000, phần thường 120.000)', expected: `400 "${expect}" (coupon-notice.ts couponRejectedWithFlash)`, actual: `${r.status} "${msgOf(r)}"`, evidence: `giỏ: ${f0.cart.items.map((i) => `${i.unitPrice}${i.isFlash ? ' flash' : ''}`).join(', ')}`, status: r.status === 400 && msgOf(r) === expect ? 'PASS' : 'FAIL' });
}
if (run('A2-16')) {
  // XANH10 + giờ vàng: mã chỉ tính phần thường; điểm tính trên cả nền (gồm giờ vàng)
  const w = await who('returning');
  await fillCart(w, [[CW.variationId, 1], [V.LAUNDRY, 1], [V.SERUM30, 1]]);
  await api(L, 'POST', '/cart/coupon', { token: w.token, body: { code: 'UATX10' } });
  const q = await quote(w, { pointsToUse: 100000 });
  const f = await userFacts(w.userId);
  const cp = (await sql(`select * from coupons where code='UATX10'`))[0];
  const lines = [{ unit: CW.flashPrice, qty: 1, flash: true }, { unit: 210000, qty: 1, flash: false }, { unit: 289000, qty: 1, flash: false }];
  const locked = (await sql(`select count(*)::int n from orders where "userId"='${w.userId}' and "deliveredAt" > now() - interval '8 days'`))[0].n;
  const o = oracle({ lines, coupon: cp, pointsToUse: 100000, cfg, facts: f, locked: locked ? 999999 : 0 });
  const got = { subtotal: q.body.subtotal, discount: q.body.discount, pointsUsed: q.body.pointsUsed, shippingFee: q.body.shippingFee, total: q.body.total, pointsEarned: q.body.pointsEarned };
  const exp = { subtotal: o.sub, discount: o.discount, pointsUsed: o.pointsUsed, shippingFee: o.ship, total: o.total, pointsEarned: o.pointsEarned };
  rec(FILE, { id: 'A2-16', persona: 'returning', surface: 'api', journey: 'dùng Điểm Xanh', step: 'XANH10 + giờ vàng + xin 100.000 điểm: mã chỉ tính hàng thường, trần điểm 20% trên cả giỏ sau mã', expected: JSON.stringify(exp), actual: JSON.stringify(got), evidence: `couponNotice=${q.body.couponNotice}`, status: diff(exp, got) ? 'FAIL' : 'PASS' });
}
if (run('A2-17')) {
  // hết suất giờ vàng: soldCount = quota -> giá về thường
  await sqlExec(`update flash_sale_items set "soldCount" = quota where id = '${CW.itemId}'`);
  const w = await who('new');
  const f = await fillCart(w, [[CW.variationId, 1]]);
  const it = f.cart?.items?.[0];
  rec(FILE, { id: 'A2-17', persona: 'new', surface: 'api', journey: 'giờ vàng', step: 'suất giờ vàng đã bán hết (soldCount = quota), thêm vào giỏ', expected: `giá thường ${CW.sale} (giá sale), không còn isFlash`, actual: `isFlash=${it?.isFlash} unit=${it?.unitPrice} list=${it?.listUnitPrice}`, status: it && !it.isFlash && it.unitPrice === CW.sale ? 'PASS' : 'FAIL' });
  await sqlExec(`update flash_sale_items set "soldCount" = 0 where id = '${CW.itemId}'`);
}
if (run('A2-18')) {
  // giờ vàng kết thúc khi khách đã có trong giỏ: đặt đơn không được tính giá giờ vàng
  const w = await who('new');
  await fillCart(w, [[CW.variationId, 1]]);
  await sqlExec(`update flash_sales set "endAt" = now() - interval '1 minute'`);
  const c = (await api(L, 'GET', '/cart', { token: w.token })).body;
  const q = await quote(w);
  const p = await place(w, { expectedTotal: 119000 + 19000 });
  const msg = p.status >= 300 ? msgOf(p) : `đơn ${p.body.code} tổng ${p.body.total}`;
  rec(FILE, { id: 'A2-18', persona: 'new', surface: 'api', journey: 'giờ vàng', step: 'giờ vàng hết giờ khi sản phẩm còn trong giỏ; khách xác nhận mức giá giờ vàng cũ', expected: 'giỏ về giá thường 159.000đ; đặt với tổng cũ bị chặn TOTAL_CHANGED (đắt hơn số khách đã thấy)', actual: `giỏ unit=${c.items[0].unitPrice} isFlash=${c.items[0].isFlash}; quote total=${q.body.total}; place ${p.status} "${msg}"`, status: c.items[0].unitPrice === 159000 && !c.items[0].isFlash && p.status === 400 && /Tổng tiền đơn vừa thay đổi/.test(msg) ? 'PASS' : 'FAIL' });
  await sqlExec(`update flash_sales set "startAt" = now() - interval '1 hour', "endAt" = now() + interval '5 days'`);
}

// ---------- tồn kho ----------
if (run('A2-20')) {
  const w = await who('new');
  await clearCart(w);
  const r = await api(L, 'POST', '/cart/items', { token: w.token, body: { variationId: V.SERUM50, quantity: 31 } });
  const st = (await sql(`select stock from variations where id='${V.SERUM50}'`))[0].stock;
  rec(FILE, { id: 'A2-20', persona: 'new', surface: 'api', journey: 'giỏ', step: `thêm 31 khi kho còn ${st}`, expected: `400 "Còn ${st} sản phẩm trong kho." (cart.service.ts:369)`, actual: `${r.status} "${msgOf(r)}"`, status: r.status === 400 && msgOf(r) === `Còn ${st} sản phẩm trong kho.` ? 'PASS' : 'FAIL' });
}
if (run('A2-21')) {
  const w = await who('new');
  await clearCart(w);
  await sqlExec(`update variations set stock = 0 where id = '${V.BUOI300}'`);
  const r = await api(L, 'POST', '/cart/items', { token: w.token, body: { variationId: V.BUOI300, quantity: 1 } });
  rec(FILE, { id: 'A2-21', persona: 'new', surface: 'api', journey: 'giỏ', step: 'thêm sản phẩm hết hàng (kho 0)', expected: '400 báo hết hàng bằng giọng cửa hàng', actual: `${r.status} "${msgOf(r)}"`, status: r.status === 400 ? 'PASS' : 'FAIL' });
  await sqlExec(`update variations set stock = 120 where id = '${V.BUOI300}'`);
}
if (run('A2-22')) {
  // kho tụt sau khi đã vào giỏ
  const w = await who('new');
  await fillCart(w, [[V.GAOLUT, 3], [V.KINH, 1]]);
  await sqlExec(`update variations set stock = 1 where id = '${V.GAOLUT}'`);
  const c = (await api(L, 'GET', '/cart', { token: w.token })).body;
  const q = await quote(w);
  const p = await place(w, { expectedTotal: q.body.total });
  const st = (await sql(`select stock, "reservedStock" r from variations where id='${V.GAOLUT}'`))[0];
  rec(FILE, { id: 'A2-22', persona: 'new', surface: 'api', journey: 'giỏ', step: 'khách có 3 gạo lứt trong giỏ, kho còn 1 lúc đặt', expected: 'đặt bị chặn: "Sản phẩm … không đủ tồn kho."; kho không bị trừ', actual: `giỏ stock=${c.items[0].stock} qty=${c.items[0].quantity}; quote ${q.status}; place ${p.status} "${msgOf(p)}"; kho ${st.stock}/giữ ${st.r}`, status: p.status === 400 && /không đủ tồn kho/.test(msgOf(p)) && st.r === 0 ? 'PASS' : 'FAIL' });
  await sqlExec(`update variations set stock = 220 where id = '${V.GAOLUT}'`);
}
// sửa số lượng, xoá dòng
if (run('A2-23')) {
  const w = await who('new');
  const f = await fillCart(w, [[V.HANDWASH, 1], [V.KINH, 1]]);
  const it = f.cart.items.find((i) => i.variationId === V.HANDWASH);
  const other = f.cart.items.find((i) => i.variationId === V.KINH);
  const r5 = await api(L, 'PATCH', `/cart/items/${it.id}`, { token: w.token, body: { quantity: 5 } });
  const rbig = await api(L, 'PATCH', `/cart/items/${it.id}`, { token: w.token, body: { quantity: 100000 } });
  const r0 = await api(L, 'PATCH', `/cart/items/${it.id}`, { token: w.token, body: { quantity: 0 } });
  const rnx = await api(L, 'PATCH', `/cart/items/khong-co-dong-nay`, { token: w.token, body: { quantity: 2 } });
  const del = await api(L, 'DELETE', `/cart/items/${other.id}`, { token: w.token });
  const okSub = r5.body.subtotal === 89000 * 5 + 79000;
  const ok = okSub && rbig.status === 400 && /999/.test(msgOf(rbig)) && r0.status === 200 && r0.body.items.length === 1 && rnx.status === 404 && msgOf(rnx) === 'Không tìm thấy mục giỏ hàng.' && del.status === 200 && del.body.items.length === 0;
  rec(FILE, { id: 'A2-23', persona: 'new', surface: 'api', journey: 'giỏ', step: 'sửa số lượng 5; 100000; 0 (= xoá); dòng không tồn tại; xoá dòng cuối', expected: 'qty 5 → subtotal 524.000; 100000 → 400 "…không được lớn hơn 999."; 0 → xoá dòng (cart.dto.ts UpdateItemDto "0 = xoá"); dòng lạ 404 "Không tìm thấy mục giỏ hàng."; xoá hết → giỏ rỗng', actual: `qty5 ${r5.status} sub=${r5.body.subtotal}; 100000 ${rbig.status} "${msgOf(rbig)}"; qty0 ${r0.status} còn ${r0.body.items?.length}; dòng lạ ${rnx.status} "${msgOf(rnx)}"; xoá ${del.status} còn ${del.body.items?.length}`, status: ok ? 'PASS' : 'FAIL' });
}
// mua một phần giỏ
if (run('A2-24')) {
  const w = await who('returning');
  const f = await fillCart(w, [[V.LAUNDRY, 1], [V.SERUM30, 1], [V.HANDWASH, 2]]);
  const ids = f.cart.items.slice(0, 2).map((i) => i.id);
  const rest = f.cart.items[2];
  await api(L, 'POST', '/cart/coupon', { token: w.token, body: { code: 'UATX10' } }).catch(() => {});
  const q = await quote(w, { itemIds: ids });
  const fct = await userFacts(w.userId);
  const cp = (await sql(`select * from coupons where code='UATX10'`))[0];
  const o = oracle({ lines: [{ unit: 210000, qty: 1 }, { unit: 289000, qty: 1 }], coupon: cp, cfg, facts: fct, locked: 0 });
  const snap0 = await snapshot(w.userId, [V.LAUNDRY, V.SERUM30, V.HANDWASH]);
  const p = await place(w, { itemIds: ids, expectedTotal: q.body.total });
  const after = (await api(L, 'GET', '/cart', { token: w.token })).body;
  const snap1 = await snapshot(w.userId, [V.LAUNDRY, V.SERUM30, V.HANDWASH]);
  const rc = p.status < 300 ? await reconcileOrder(p.body.code) : { problems: [msgOf(p)] };
  const probs = [...rc.problems];
  if (q.body.total !== o.total) probs.push(`báo giá ${q.body.total} ≠ oracle ${o.total}`);
  if (after.items.length !== 1 || after.items[0].id !== rest.id || after.items[0].quantity !== 2) probs.push(`giỏ còn lại ${JSON.stringify(after.items.map((i) => [i.productName, i.quantity]))}`);
  if (snap1.stock[V.HANDWASH].r !== snap0.stock[V.HANDWASH].r) probs.push('kho dòng không mua bị giữ chỗ');
  rec(FILE, { id: 'A2-24', persona: 'returning', surface: 'api', journey: 'giỏ', step: 'mua một phần giỏ: chọn 2/3 dòng (mã 10% trần 50.000đ đang giữ trong giỏ)', expected: `tổng ${o.total} theo dòng đã chọn; giỏ còn dòng rửa tay x2; kho dòng còn lại không giữ`, actual: `place ${p.status}; total=${rc.row?.total}; giỏ còn ${after.items.length} dòng`, evidence: probs.join(' | ') || 'khớp SQL', status: probs.length ? 'FAIL' : 'PASS' });
}
// idempotency, bấm đặt hai lần
if (run('A2-25')) {
  const w = await who('returning');
  await fillCart(w, [[V.HANDWASH, 2]]);
  const q = await quote(w, { pointsToUse: 5000 });
  const snap0 = await snapshot(w.userId, [V.HANDWASH]);
  const key = idem();
  const body = { pointsToUse: 5000, expectedTotal: q.body.total };
  const p1 = await place(w, body, key);
  const p2 = await place(w, body, key);
  const p3 = await place(w, body, idem());
  const snap1 = await snapshot(w.userId, [V.HANDWASH]);
  const n = (await sql(`select count(*)::int n from orders where "idempotencyKey" = '${key}'`))[0].n;
  const probs = [];
  if (p1.body.code !== p2.body.code) probs.push(`cùng key ra hai đơn ${p1.body.code} ≠ ${p2.body.code}`);
  if (n !== 1) probs.push(`đơn theo key: ${n}`);
  if (p3.body.code !== p1.body.code) probs.push(`lần 3 ra đơn ${p3.body.code}`);
  const wantPts = Math.min(5000, snap0.bal, Math.floor(178000 * 0.2));
  if (snap1.bal - snap0.bal !== -wantPts) probs.push(`điểm trừ ${snap1.bal - snap0.bal}, mong ${-wantPts}`);
  if (snap1.stock[V.HANDWASH].r - snap0.stock[V.HANDWASH].r !== 2) probs.push(`giữ kho +${snap1.stock[V.HANDWASH].r - snap0.stock[V.HANDWASH].r}, mong +2`);
  rec(FILE, { id: 'A2-25', persona: 'returning', surface: 'api', journey: 'đặt đơn COD', step: 'đặt 2 lần cùng Idempotency-Key + lần thứ 3 khác key sau khi giỏ đã dọn', expected: 'một đơn; điểm trừ một lần; kho giữ một lần; lần 3 (giỏ đã dọn) trả lại đúng đơn vừa đặt, không đặt thêm (recentlyPlacedOrder)', actual: `p1 ${p1.status} ${p1.body.code}; p2 ${p2.status} ${p2.body.code}; p3 ${p3.status} "${p3.status >= 300 ? msgOf(p3) : p3.body.code}"`, evidence: probs.join(' | ') || 'khớp SQL', status: probs.length ? 'FAIL' : 'PASS' });
}
// địa chỉ của người khác, phương thức không hợp lệ, expectedTotal thấp
if (run('A2-26')) {
  const a = await who('returning');
  const b = await who('new');
  await fillCart(b, [[V.LAUNDRY, 1]]);
  const r1 = await api(L, 'POST', '/checkout/place-order', { token: b.token, headers: { 'idempotency-key': idem() }, body: { addressId: a.addressId, paymentMethod: 'COD' } });
  const r2 = await api(L, 'POST', '/checkout/place-order', { token: b.token, headers: { 'idempotency-key': idem() }, body: { addressId: b.addressId, paymentMethod: 'XU' } });
  const r3 = await api(L, 'POST', '/checkout/place-order', { token: b.token, headers: { 'idempotency-key': idem() }, body: { addressId: b.addressId, paymentMethod: 'COD', expectedTotal: 1000 } });
  rec(FILE, { id: 'A2-26', persona: 'new', surface: 'api', journey: 'đặt đơn COD', step: 'địa chỉ của người khác / phương thức XU / expectedTotal nhỏ hơn thực tế', expected: '400 "Địa chỉ giao hàng không hợp lệ."; 400 DTO (isIn); 400 "Tổng tiền đơn vừa thay đổi từ 1.000đ thành 210.000đ…"', actual: `${r1.status} "${msgOf(r1)}" | ${r2.status} "${msgOf(r2)}" | ${r3.status} "${msgOf(r3)}"`, status: r1.status === 400 && msgOf(r1) === 'Địa chỉ giao hàng không hợp lệ.' && r2.status === 400 && r3.status === 400 && /^Tổng tiền đơn vừa thay đổi từ 1\.000đ thành 210\.000đ/.test(msgOf(r3)) ? 'PASS' : 'FAIL' });
}
// Điểm Xanh: vượt số dư, âm, khách guest/không SĐT
if (run('A2-27')) {
  const w = await who('returning');
  await fillCart(w, [[V.LAUNDRY, 2], [V.SERUM30, 1]]);
  const qn = await quote(w, { pointsToUse: -5 });
  const qbig = await quote(w, { pointsToUse: 99999999 });
  const f = await userFacts(w.userId);
  const o = oracle({ lines: [{ unit: 210000, qty: 2 }, { unit: 289000, qty: 1 }], coupon: null, pointsToUse: 99999999, cfg, facts: f, locked: 0 });
  rec(FILE, { id: 'A2-27', persona: 'returning', surface: 'api', journey: 'dùng Điểm Xanh', step: 'xin -5 điểm; xin 99.999.999 điểm (vượt số dư)', expected: `-5: 400 (DTO min 0); 99.999.999: kẹp về ${o.pointsUsed} (min số dư, trần 20% = ${Math.floor(709000 * 0.2)})`, actual: `-5: ${qn.status} "${msgOf(qn)}"; lớn: ${qbig.status} pointsUsed=${qbig.body.pointsUsed} total=${qbig.body.total}`, status: qn.status === 400 && qbig.body.pointsUsed === o.pointsUsed && qbig.body.total === o.total ? 'PASS' : 'FAIL' });
  const g = await who('guest');
  await fillCart(g, [[V.LAUNDRY, 1]]);
  const qg = await quote(g, { pointsToUse: 1000 });
  rec(FILE, { id: 'A2-28', persona: 'guest', surface: 'api', journey: 'dùng Điểm Xanh', step: 'khách vãng lai xin dùng 1.000 điểm (số dư 0)', expected: 'pointsUsed=0, pointsMax=0, tổng = tiền hàng', actual: `${qg.status} pointsUsed=${qg.body.pointsUsed} pointsMax=${qg.body.pointsMax} total=${qg.body.total}`, status: qg.body.pointsUsed === 0 && qg.body.total === 210000 ? 'PASS' : 'FAIL' });
}
await closePrisma();
