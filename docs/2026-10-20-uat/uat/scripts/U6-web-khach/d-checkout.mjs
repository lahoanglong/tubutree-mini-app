// Nhóm D: thanh toán trên web. COD, Điểm Xanh, voucher, chuyển khoản QR + giả webhook ngân hàng, bấm đúp, phí ship, hết hàng, Ví Tubu, gian hàng CTV.
// Mọi ca tiền/điểm đối chiếu DB (orders, order_items, points_transactions, users.pointsBalance, variations.stock, coupons, commissions).
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import {
  L, HARNESS_DIR, Recorder, finish, openWeb, nav, bodyText, badReqs, overflowX, sql, call, clearCart, cartRows, addViaPdp, digits, vnd, sleep,
  ledger, ledgerRows, sendOrderStatus, variantId, seedWallet,
} from './_lib.mjs';

const rec = new Recorder('d-checkout');
const WIDTHS = [390, 1440];
const cli = (file, args) => {
  const out = execFileSync('node', [path.join(HARNESS_DIR, file), '6', ...args], { encoding: 'utf8', env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    return JSON.parse(out);
  } catch {
    return out;
  }
};

async function quoteWatcher(s) {
  s.lastQuote = null;
  s.page.on('response', async (r) => {
    if (r.url().endsWith('/checkout/quote') && r.request().method() === 'POST' && r.status() < 300) s.lastQuote = await r.json().catch(() => null);
  });
}

async function openCouponBox(s) {
  const toggle = s.page.getByRole('button', { name: /Bạn có \d+ mã|Mã giảm giá|Thêm mã/ }).first();
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await s.page.waitForTimeout(400);
}
const placeBtn = (s) => s.page.getByRole('button', { name: /^Đặt hàng/ }).first();

async function openCheckout(s) {
  await nav(s, '/gio-hang', { wait: 600 });
  await s.page.getByRole('link', { name: /Thanh toán/ }).first().click();
  await s.page.waitForURL(/\/thanh-toan$/, { timeout: 30_000 });
  await waitReady(s);
}

async function waitReady(s) {
  await s.page.waitForFunction(() => {
    const t = document.body.innerText;
    return !/Tổng cộng\s*\n?…/.test(t) && !/Tổng cộng\s*\n?Chưa tính/.test(t);
  }, null, { timeout: 40_000 }).catch(() => undefined);
  await s.page.waitForTimeout(1000);
}

async function place(s) {
  const respP = s.page.waitForResponse((r) => r.url().endsWith('/checkout/place-order') && r.request().method() === 'POST', { timeout: 40_000 });
  await placeBtn(s).click();
  const resp = await respP;
  const body = await resp.json().catch(() => null);
  await s.page.waitForTimeout(1500);
  return { status: resp.status(), body, code: body?.code ?? body?.orders?.[0]?.code ?? body?.splitOrders?.[0]?.code };
}

const stockOf = async (sku) => (await sql(`SELECT stock::int, "reservedStock"::int AS reserved FROM variations WHERE sku = $1`, sku))[0];
const orderRow = async (code) =>
  (await sql(
    `SELECT code, status, "paymentMethod", "paymentStatus", subtotal::int, discount::int, "shippingFee"::int, total::int, "pointsEarned"::int, "pointsUsed"::int, "pointsDiscount"::int, "couponCode", "couponDiscount"::int, "tierDiscount"::int, "comboDiscount"::int, "userId", "storefrontSlug", "referrerUserId", "pancakeOrderId", "paidAt", "deliveredAt" FROM orders WHERE code = $1`,
    code,
  ))[0];
const itemRows = (code) => sql(`SELECT v.sku, oi.quantity::int AS qty, oi."unitPrice"::int AS unit, oi.total::int AS total FROM order_items oi JOIN orders o ON o.id = oi."orderId" JOIN variations v ON v.id = oi."variationId" WHERE o.code = $1 ORDER BY v.sku`, code);
const pancakeOrder = async (code) => {
  for (let i = 0; i < 30; i++) {
    const f = await (await fetch(`${L.pancakeUrl}/__uat/find?code=${code}`)).json().catch(() => null);
    if (f?.kind === 'app') return f.order;
    await sleep(500);
  }
  return null;
};
const ledgerOk = async (c, label, uid) => {
  const l = await ledger(uid);
  c.ok(`${label}: users.pointsBalance = SUM(sổ STANDARD)`, l.balance === l.ledgerSum, l);
  return l;
};

// ───────────── U6-30 đơn COD của khách quay lại (Lộc Biếc) rồi giao xong → cộng điểm
for (const w of WIDTHS) {
  await rec.run(`U6-30-${w}`, { role: 'Khách quay lại (Lộc Biếc, 34.400 điểm)', journey: 'Thanh toán COD', steps: `Thêm nước rửa tay ×2 (178.000đ) → /gio-hang → Thanh toán → COD → Đặt hàng (${w}px)${w === 390 ? '; Pancake báo giao xong; đối chiếu sổ điểm' : ''}`, expected: 'Báo giá: tạm tính 178.000đ, ship Miễn phí (Lộc Biếc freeship từ 99.000đ), tổng 178.000đ, +4.272 điểm (178.000 × 2% × 1,2). Đơn COD CONFIRMED, tổng DB = báo giá, tồn kho được giữ, giả Pancake nhận đơn cod=178.000, giỏ sạch' + (w === 390 ? '; sau giao: đúng 1 dòng sổ ORDER_DELIVERED:<mã> +4.272, pointsBalance = trước + 4.272 = SUM(sổ)' : '') }, async (c) => {
    const U = 'returning';
    const UID = 'uat_returning';
    await clearCart(U);
    const s = await openWeb(U, { width: w, path: '/' });
    await quoteWatcher(s);
    const before = await ledger(UID);
    const stock0 = await stockOf('FUWA-HW-500');
    c.ev('sổ điểm trước', before);
    c.ev('tồn trước', stock0);
    await addViaPdp(s, 'nuoc-rua-tay-fuwa3e', { qty: 2 });
    await openCheckout(s);
    const q = s.lastQuote;
    c.ev('báo giá', q && { subtotal: q.subtotal, shippingFee: q.shippingFee, total: q.total, pointsEarned: q.pointsEarned });
    c.ok('báo giá: tạm tính 178.000đ, ship 0, tổng 178.000đ', q?.subtotal === 178000 && q?.shippingFee === 0 && q?.total === 178000, q && { s: q.subtotal, f: q.shippingFee, t: q.total });
    c.ok('báo giá: điểm = floor(178.000 × 2% × 1,2) = 4.272', q?.pointsEarned === Math.floor(178000 * 0.02 * 1.2), { got: q?.pointsEarned, expect: Math.floor(178000 * 0.02 * 1.2) });
    const t = await bodyText(s.page);
    c.ok('trang hiện Miễn phí vận chuyển + tổng 178.000đ', /Miễn phí/.test(t) && t.includes('178.000đ'));
    const radios = await s.page.getByRole('radio').evaluateAll((els) => els.map((e) => ({ checked: e.checked, label: e.closest('label')?.innerText?.trim() })));
    c.ok('COD đang được chọn sẵn', radios.find((r) => /COD/.test(r.label ?? ''))?.checked === true, radios);
    const ox = await overflowX(s.page);
    c.ok('không tràn ngang', ox.sw <= ox.iw + 1, ox);
    await c.shot(s.page, `thanh-toan-cod-${w}`);
    const r = await place(s);
    c.ok('POST /checkout/place-order → 201', r.status === 201 && !!r.code, { status: r.status, code: r.code, body: r.status >= 300 ? r.body : undefined });
    const code = r.code;
    const tt = await bodyText(s.page);
    c.ok('màn thành công hiện "Đặt hàng thành công!" + mã đơn + 178.000đ', /Đặt hàng thành công/.test(tt) && tt.includes(code) && tt.includes('178.000đ'), tt.slice(0, 300));
    await c.shot(s.page, `dat-hang-thanh-cong-${w}`);
    const o = await orderRow(code);
    c.ev('orders', o);
    c.ok('DB: COD CONFIRMED, UNPAID, của uat_returning', o?.paymentMethod === 'COD' && o.status === 'CONFIRMED' && o.userId === UID, o);
    c.ok('DB: tổng = báo giá (178.000đ), ship 0, giảm 0', o?.total === q.total && o.subtotal === 178000 && o.shippingFee === 0 && o.discount === 0, o);
    c.ok('DB: pointsEarned = báo giá', o?.pointsEarned === q.pointsEarned, { db: o?.pointsEarned, quote: q.pointsEarned });
    const items = await itemRows(code);
    c.ok('DB: 1 dòng FUWA-HW-500 × 2 × 89.000 = 178.000', items.length === 1 && items[0].sku === 'FUWA-HW-500' && items[0].qty === 2 && items[0].unit === 89000 && items[0].total === 178000, items);
    const stock1 = await stockOf('FUWA-HW-500');
    c.ev('tồn sau', stock1);
    c.ok('DB: tồn kho bị giữ/trừ đúng 2 (stock + reserved không lệch)', stock1.stock + stock1.reserved === stock0.stock + stock0.reserved - 2 || (stock1.stock === stock0.stock && stock1.reserved === stock0.reserved + 2) || stock1.stock === stock0.stock - 2, { before: stock0, after: stock1 });
    const pk = await pancakeOrder(code);
    c.ev('đơn trên giả Pancake', pk && { id: pk.id, custom_id: pk.custom_id, total_price: pk.total_price, total_price_after_sub_discount: pk.total_price_after_sub_discount, cod: pk.cod, shipping_fee: pk.shipping_fee, status: pk.status });
    c.ok('giả Pancake nhận đơn của khách', !!pk, pk && { id: pk.id });
    c.ok('giỏ trống sau khi đặt', (await cartRows(UID)).length === 0);
    const bad = badReqs(s.requests);
    c.ok('không request API lỗi trong cả chuỗi', bad.length === 0, bad);
    if (w === 390) {
      // Chi tiết đơn trên web
      await nav(s, `/tai-khoan/don-hang/${code}`);
      const dt = await bodyText(s.page);
      c.ok('chi tiết đơn: mã, 178.000đ, COD, địa chỉ 12 Lê Lợi', dt.includes(code) && dt.includes('178.000đ') && /COD|Thanh toán khi nhận hàng/.test(dt) && /12 Lê Lợi/.test(dt), dt.slice(0, 400));
      await c.shot(s.page, `chi-tiet-don-cod-${w}`);
      // Giao xong
      const sh = await sendOrderStatus(L, code, 'shipped');
      c.ok('webhook shipped xử lý xong → đơn SHIPPING', sh.event?.status === 'PROCESSED' && sh.order?.status === 'SHIPPING', { ev: sh.event, st: sh.order?.status });
      const dl = await sendOrderStatus(L, code, 'delivered');
      c.ok('webhook delivered xử lý xong → đơn DELIVERED', dl.event?.status === 'PROCESSED' && dl.order?.status === 'DELIVERED', { ev: dl.event, st: dl.order?.status });
      await sleep(1500);
      const rows = await ledgerRows(UID, `ORDER_DELIVERED:${code}`);
      c.ev('dòng sổ điểm', rows);
      c.ok('sổ điểm: đúng 1 dòng ORDER_DELIVERED:<mã> = +4.272', rows.length === 1 && rows[0].delta === q.pointsEarned, rows);
      const after = await ledgerOk(c, 'sau giao', UID);
      c.ok('pointsBalance = trước + 4.272', after.balance === before.balance + q.pointsEarned, { before: before.balance, after: after.balance });
      await nav(s, '/tai-khoan/diem-xanh');
      const pt = await bodyText(s.page);
      const shownBal = vnd(after.balance).replace('đ', '');
      c.ok(`trang Điểm Xanh hiện số dư ${shownBal}`, pt.includes(shownBal), pt.slice(0, 300));
      await c.shot(s.page, `diem-xanh-sau-giao-${w}`);
    }
    await s.close();
  });
}

// ───────────── U6-31 dùng Điểm Xanh khi thanh toán, rồi huỷ đơn → hoàn điểm
await rec.run('U6-31', { role: 'Khách quay lại (Lộc Biếc)', journey: 'Điểm Xanh khi thanh toán', steps: 'Giỏ nước rửa chén 1L (120.000đ) → Thanh toán → tick "Bạn có … Điểm Xanh" → Đặt hàng COD → vào đơn bấm Huỷ đơn (390px)', expected: 'Điểm dùng = min(điểm dùng được, 20% × 120.000 = 24.000); tổng giảm đúng số đó; DB: orders.pointsUsed=24.000, sổ có dòng −24.000, pointsBalance giảm đúng 24.000 = SUM(sổ); huỷ đơn thì hoàn lại +24.000 (sổ + số dư) và trả tồn kho' }, async (c) => {
  const U = 'returning';
  const UID = 'uat_returning';
  await clearCart(U);
  const s = await openWeb(U, { width: 390, path: '/' });
  await quoteWatcher(s);
  const lp = await call(U, 'GET', '/me/loyalty');
  c.ev('/me/loyalty', lp.body);
  const before = await ledger(UID);
  await addViaPdp(s, 'nuoc-rua-chen-fuwa3e', { qty: 1, variantRe: /1L/ });
  const stock0 = await stockOf('FUWA-DW-1L');
  await openCheckout(s);
  const cb = s.page.getByRole('checkbox', { name: /Điểm Xanh/ });
  c.ok('có ô "Bạn có … Điểm Xanh"', (await cb.count()) > 0, (await bodyText(s.page)).slice(0, 200));
  await cb.check();
  await waitReady(s);
  await s.page.waitForTimeout(1500);
  const q = s.lastQuote;
  c.ev('báo giá khi dùng điểm', q && { subtotal: q.subtotal, shippingFee: q.shippingFee, pointsUsed: q.pointsUsed, pointsDiscount: q.pointsDiscount, total: q.total, pointsEarned: q.pointsEarned });
  const cap = Math.floor(0.2 * 120000);
  const usable = lp.body.redeemablePoints;
  c.ok('điểm dùng = min(dùng được, 20% giá trị đơn)', q?.pointsUsed === Math.min(usable, cap), { used: q?.pointsUsed, usable, cap });
  c.ok('giảm = điểm dùng (1 điểm = 1đ)', q?.pointsDiscount === q?.pointsUsed, { d: q?.pointsDiscount, u: q?.pointsUsed });
  c.ok('tổng = tạm tính − giảm điểm + ship', q?.total === q.subtotal - q.pointsDiscount + q.shippingFee, { total: q?.total, sub: q?.subtotal, pd: q?.pointsDiscount, fee: q?.shippingFee });
  const t = await bodyText(s.page);
  c.ok('trang hiện dòng "Dùng 24.000 Điểm Xanh — giảm 24.000đ"', /Dùng 24\.000 Điểm Xanh/.test(t), t.slice(t.indexOf('Mã giảm giá'), t.indexOf('Mã giảm giá') + 300));
  await c.shot(s.page, 'dung-diem');
  const r = await place(s);
  c.ok('đặt hàng → 201', r.status === 201 && !!r.code, { status: r.status, body: r.status >= 300 ? r.body : undefined });
  const code = r.code;
  const o = await orderRow(code);
  c.ev('orders', o);
  c.ok('DB: pointsUsed = pointsDiscount = 24.000 và tổng khớp báo giá', o?.pointsUsed === 24000 && o.pointsDiscount === 24000 && o.total === q.total, o);
  const rowsUse = await sql(`SELECT delta::int, reason, lot FROM points_transactions WHERE "userId" = $1 AND ("refId" = $2 OR "refId" IN (SELECT id FROM orders WHERE code = $2) OR reason LIKE '%' || $2 || '%') ORDER BY "createdAt"`, UID, code);
  c.ev('sổ điểm của đơn', rowsUse);
  c.ok('sổ có dòng trừ −24.000', rowsUse.some((x) => x.delta === -24000), rowsUse);
  const mid = await ledgerOk(c, 'sau đặt', UID);
  c.ok('pointsBalance = trước − 24.000', mid.balance === before.balance - 24000, { before: before.balance, mid: mid.balance });
  // Huỷ đơn bằng giao diện
  await nav(s, `/tai-khoan/don-hang/${code}`);
  await s.page.getByRole('button', { name: 'Hủy đơn' }).first().click();
  await s.page.waitForTimeout(500);
  await c.shot(s.page, 'huy-don-hoi-lai');
  const cancelP = s.page.waitForResponse((x) => /\/orders\/.*\/cancel$/.test(x.url()), { timeout: 20_000 }).catch(() => null);
  await s.page.getByRole('alertdialog').getByRole('button', { name: 'Hủy đơn' }).click();
  const cr = await cancelP;
  c.ok('POST /orders/:code/cancel → 2xx', cr && cr.status() < 300, cr && cr.status());
  await s.page.waitForTimeout(2000);
  const o2 = await orderRow(code);
  c.ok('DB: đơn CANCELLED', o2?.status === 'CANCELLED', o2?.status);
  const end = await ledgerOk(c, 'sau huỷ', UID);
  c.ok('hoàn điểm: pointsBalance về đúng số ban đầu', end.balance === before.balance, { before: before.balance, after: end.balance });
  const rowsEnd = await sql(`SELECT delta::int, reason, lot FROM points_transactions WHERE "userId" = $1 AND ("refId" = $2 OR "refId" IN (SELECT id FROM orders WHERE code = $2) OR reason LIKE '%' || $2 || '%') ORDER BY "createdAt"`, UID, code);
  c.ev('sổ điểm sau huỷ', rowsEnd);
  const stock1 = await stockOf('FUWA-DW-1L');
  c.ok('tồn kho trả lại sau huỷ', stock1.stock === stock0.stock && stock1.reserved === stock0.reserved, { before: stock0, after: stock1 });
  const tt = await bodyText(s.page);
  c.ok('trang báo "Đã hủy đơn hàng"', /Đã hủy đơn hàng|Đã hủy/.test(tt), tt.slice(0, 250));
  await c.shot(s.page, 'sau-huy-don');
  await s.close();
});

// ───────────── U6-32 voucher
await rec.run('U6-32', { role: 'Khách quay lại (Lộc Biếc)', journey: 'Voucher', steps: 'Giỏ Vitamin C Visante (329.000đ): mã sai, WELCOME30, XANH10; đặt đơn với XANH10; huỷ đơn; (390px)', expected: 'Mã sai báo lỗi dễ hiểu; WELCOME30 −30.000đ; XANH10 −10% tối đa 50.000đ = −32.900đ; đơn lưu couponCode/couponDiscount đúng; huỷ đơn trả lại mã dùng được' }, async (c) => {
  const U = 'returning';
  await clearCart(U);
  const s = await openWeb(U, { width: 390, path: '/' });
  await quoteWatcher(s);
  await addViaPdp(s, 'tinh-chat-vitamin-c-visante', { qty: 1 });
  await openCheckout(s);
  await openCouponBox(s);
  const input = s.page.getByPlaceholder('Nhập mã giảm giá');
  await input.fill('SAIMA123');
  await s.page.getByRole('button', { name: 'Áp dụng' }).click();
  await s.page.waitForTimeout(1500);
  let t = await bodyText(s.page);
  c.ev('lời báo mã sai', t.slice(t.indexOf('Mã giảm giá'), t.indexOf('Mã giảm giá') + 350));
  c.ok('mã sai hiện lời báo (không im lặng, không lỗi kỹ thuật)', /không (hợp lệ|tồn tại|đúng)|không áp dụng|hết hạn|không tìm thấy/i.test(t), t.slice(0, 200));
  await c.shot(s.page, 'ma-sai');
  await s.page.getByRole('button', { name: /Dùng mã WELCOME30/ }).click();
  await waitReady(s);
  await s.page.waitForTimeout(1200);
  let q = s.lastQuote;
  c.ok('WELCOME30: discount 30.000đ, tổng 299.000đ', q?.discount === 30000 && q?.total === 299000, q && { d: q.discount, t: q.total });
  t = await bodyText(s.page);
  c.ok('trang hiện dòng Giảm giá (WELCOME30) −30.000đ', /Giảm giá \(WELCOME30\)/.test(t) && t.includes('-30.000đ'), t.slice(0, 100));
  await c.shot(s.page, 'welcome30');
  // bỏ WELCOME30 (nút X) rồi dùng XANH10
  await s.page.getByRole('button', { name: /Bỏ mã giảm giá WELCOME30/ }).click();
  await waitReady(s);
  await s.page.waitForTimeout(1200);
  c.ok('bỏ mã: giảm giá về 0, tổng 329.000đ', (s.lastQuote?.discount ?? 0) === 0 && s.lastQuote?.total === 329000, s.lastQuote && { d: s.lastQuote.discount, t: s.lastQuote.total });
  await openCouponBox(s);
  await s.page.getByRole('button', { name: /Dùng mã XANH10/ }).click();
  await waitReady(s);
  await s.page.waitForTimeout(1500);
  q = s.lastQuote;
  c.ev('báo giá XANH10', q && { subtotal: q.subtotal, discount: q.discount, total: q.total, shipping: q.shippingFee });
  c.ok('XANH10: 10% × 329.000 = 32.900đ (trần 50.000đ)', q?.discount === 32900, q && { discount: q.discount });
  const r = await place(s);
  c.ok('đặt hàng với XANH10 → 201', r.status === 201 && !!r.code, { status: r.status, body: r.status >= 300 ? r.body : undefined });
  const o = await orderRow(r.code);
  c.ev('orders', o);
  c.ok('DB: couponCode XANH10, couponDiscount 32.900, tổng = subtotal − 32.900 + ship', o?.couponCode === 'XANH10' && o.couponDiscount === 32900 && o.total === o.subtotal - 32900 + o.shippingFee, o);
  const red = () => sql(`SELECT r.id FROM coupon_redemptions r JOIN coupons c ON c.id = r."couponId" WHERE c.code = 'XANH10' AND r."userId" = 'uat_returning'`);
  const r1 = await red();
  c.ev('coupon_redemptions XANH10 của returning sau đặt', r1);
  c.ok('DB: có đúng 1 dòng coupon_redemptions gắn đơn (XANH10 không có usageLimit nên usedCount không đếm, xem coupons.service.ts:328)', r1.length === 1, r1);
  const my1 = await call(U, 'GET', '/me/coupons');
  c.ok('XANH10 (perUserLimit 2) vẫn còn trong ví mã sau 1 lần dùng', (my1.body ?? []).some((x) => x.code === 'XANH10'), (my1.body ?? []).map((x) => x.code));
  // huỷ đơn
  await nav(s, `/tai-khoan/don-hang/${r.code}`);
  await s.page.getByRole('button', { name: 'Hủy đơn' }).first().click();
  await s.page.getByRole('alertdialog').getByRole('button', { name: 'Hủy đơn' }).click();
  await s.page.waitForTimeout(2500);
  const o2 = await orderRow(r.code);
  c.ok('đơn CANCELLED', o2?.status === 'CANCELLED', o2?.status);
  const r2 = await red();
  c.ev('coupon_redemptions sau huỷ', r2);
  c.ok('huỷ đơn: dòng redemption bị gỡ (lượt dùng trả lại)', r2.length === 0, r2);
  await s.close();
});

// ───────────── U6-33 mã hộp sàn HOPSAN + chuyển khoản QR + giả webhook ngân hàng (khách mới)
await rec.run('U6-33', { role: 'Khách mới (uat_new, chưa đơn, chưa có địa chỉ)', journey: 'Chuyển khoản QR', steps: 'Giỏ 199.000đ (Pơ Lang tinh dầu 110.000 + dầu tràm bé 89.000): thêm địa chỉ trong form thanh toán (thử bỏ trống/SĐT sai), áp mã HOPSAN, chọn Chuyển khoản, Đặt hàng; QR; ngân hàng: sai nội dung, chuyển thiếu, chuyển đủ; giao xong (390px)', expected: 'Form địa chỉ báo từng ô sai; HOPSAN −30.000đ (đơn từ 199.000đ, khách mới); trang QR: STK 8386790906, CONG TY TNHH TUBU TREE, Techcombank, nội dung = mã đơn, số tiền = tổng đơn; sai nội dung/thiếu tiền không lên PAID; đủ tiền thì PAID và trang tự cập nhật "Đã nhận thanh toán!"; điểm sau giao = 2% × tiền hàng sau giảm × 1 (Mầm Xanh)' }, async (c) => {
  const U = 'new';
  const UID = 'uat_new';
  await sql(`DELETE FROM addresses WHERE "userId" = $1`, UID);
  await clearCart(U);
  const [free] = await sql(`SELECT code FROM coupons WHERE code LIKE 'HOPSAN-%' AND "usedCount" = 0 AND "isActive" = true ORDER BY code LIMIT 1`);
  const hopsan = free.code;
  const s = await openWeb(U, { width: 390, path: '/' });
  await quoteWatcher(s);
  await addViaPdp(s, 'tinh-dau-sa-chanh-po-lang', { qty: 1 });
  await addViaPdp(s, 'dau-tram-be-cobote', { qty: 1 });
  await openCheckout(s);
  let t = await bodyText(s.page);
  c.ok('chưa có địa chỉ: hiện form/nhắc thêm địa chỉ', /Thêm địa chỉ|Người nhận/.test(t), t.slice(0, 300));
  if (!(await s.page.getByRole('form', { name: /Thêm địa chỉ mới/ }).count())) await s.page.getByRole('button', { name: /Thêm địa chỉ mới/ }).click();
  const form = s.page.getByRole('form', { name: /Thêm địa chỉ mới/ });
  await form.getByRole('button', { name: 'Lưu địa chỉ' }).click();
  await s.page.waitForTimeout(600);
  t = await bodyText(s.page);
  c.ev('lỗi khi bỏ trống', t.slice(t.indexOf('Thêm địa chỉ mới'), t.indexOf('Thêm địa chỉ mới') + 500));
  c.ok('bỏ trống: báo lỗi từng ô (tên, SĐT, tỉnh, phường, đường)', (await form.locator('[aria-invalid="true"]').count()) >= 3, await form.locator('[aria-invalid="true"]').count());
  await c.shot(s.page, 'dia-chi-loi-bo-trong');
  await form.getByLabel('Người nhận').fill('Lê Thu Mới');
  await form.getByLabel('Số điện thoại').fill('12345');
  await form.getByLabel('Số điện thoại').blur();
  await s.page.waitForTimeout(400);
  t = await bodyText(s.page);
  c.ok('SĐT "12345" bị báo sai định dạng', /SĐT|số điện thoại|không hợp lệ/i.test(t.slice(t.indexOf('Số điện thoại'))) && (await form.getByLabel('Số điện thoại').getAttribute('aria-invalid')) === 'true', t.slice(t.indexOf('Số điện thoại'), t.indexOf('Số điện thoại') + 200));
  await form.getByLabel('Số điện thoại').fill('0901000001');
  await form.getByLabel('Tỉnh/thành').selectOption({ label: 'Thành phố Hồ Chí Minh' });
  await s.page.waitForTimeout(800);
  await form.getByLabel('Phường/xã').selectOption({ label: 'Phường Bến Thành' });
  await form.getByLabel('Số nhà, đường').fill('45 Nguyễn Huệ');
  await form.getByRole('button', { name: 'Lưu địa chỉ' }).click();
  await waitReady(s);
  await s.page.waitForTimeout(1500);
  const addrs = await sql(`SELECT recipient, phone, province, ward, street, "isDefault" FROM addresses WHERE "userId" = $1`, UID);
  c.ev('DB addresses', addrs);
  c.ok('DB: địa chỉ mới lưu đúng và là mặc định (địa chỉ đầu tiên)', addrs.length === 1 && addrs[0].street === '45 Nguyễn Huệ' && addrs[0].isDefault === true, addrs);
  let q;
  c.ok('báo giá: tạm tính 199.000đ', s.lastQuote?.subtotal === 199000, s.lastQuote && { subtotal: s.lastQuote.subtotal, ship: s.lastQuote.shippingFee });
  c.ev('báo giá chưa mã', s.lastQuote && { subtotal: s.lastQuote.subtotal, shippingFee: s.lastQuote.shippingFee, total: s.lastQuote.total, pointsEarned: s.lastQuote.pointsEarned });
  c.ok('khách mới đơn đầu 199.000đ: miễn phí ship (shipping.first_order_free_min_subtotal = 199.000)', s.lastQuote?.shippingFee === 0, s.lastQuote?.shippingFee);
  // áp mã HOPSAN
  await openCouponBox(s);
  await s.page.getByPlaceholder('Nhập mã giảm giá').fill(hopsan);
  await s.page.getByRole('button', { name: 'Áp dụng' }).click();
  await waitReady(s);
  await s.page.waitForTimeout(1500);
  q = s.lastQuote;
  c.ev('báo giá có HOPSAN', q && { subtotal: q.subtotal, discount: q.discount, shippingFee: q.shippingFee, total: q.total, pointsEarned: q.pointsEarned });
  c.ok('HOPSAN: giảm 30.000đ', q?.discount === 30000, q && q.discount);
  const goods = 199000 - 30000;
  c.ok('điểm báo giá = floor(2% × tiền hàng sau giảm 169.000 × 1) = 3.380', q?.pointsEarned === Math.floor(goods * 0.02), { got: q?.pointsEarned, expect: Math.floor(goods * 0.02) });
  c.ok('còn miễn phí ship sau khi trừ mã (đơn đầu, tạm tính vẫn 199.000đ)', q?.shippingFee === 0, { ship: q?.shippingFee, total: q?.total });
  await c.shot(s.page, 'hopsan-ap-dung');
  await s.page.getByRole('radio', { name: /Chuyển khoản/ }).check();
  await waitReady(s);
  const r = await place(s);
  c.ok('đặt hàng → 201', r.status === 201 && !!r.code, { status: r.status, body: r.status >= 300 ? r.body : undefined });
  const code = r.code;
  await s.page.waitForURL(new RegExp(`/thanh-toan/chuyen-khoan/${code}`), { timeout: 20_000 }).catch(() => undefined);
  await s.page.waitForTimeout(2500);
  c.ok('chuyển sang trang QR /thanh-toan/chuyen-khoan/<mã>', s.page.url().includes(`/thanh-toan/chuyen-khoan/${code}`), s.page.url());
  let o = await orderRow(code);
  c.ev('orders', o);
  c.ok('DB: BANK_TRANSFER, PENDING_PAYMENT, UNPAID, tổng = báo giá', o?.paymentMethod === 'BANK_TRANSFER' && o.status === 'PENDING_PAYMENT' && o.paymentStatus === 'UNPAID' && o.total === q.total, o);
  c.ok('DB: couponCode HOPSAN, giảm 30.000', o?.couponCode === hopsan && o.couponDiscount === 30000, { code: o?.couponCode, d: o?.couponDiscount });
  t = await bodyText(s.page);
  c.ok('trang QR: số tài khoản 8386790906', t.includes('8386790906'));
  c.ok('trang QR: chủ TK CONG TY TNHH TUBU TREE', t.includes('CONG TY TNHH TUBU TREE'));
  c.ok('trang QR: ngân hàng Techcombank / Kỹ Thương', /Techcombank|Kỹ Thương/.test(t));
  c.ok('trang QR: nội dung CK = mã đơn', t.includes(code) && new RegExp(`Nội dung CK[\\s\\S]{0,40}${code}`).test(t), t.slice(t.indexOf('Nội dung')));
  c.ok(`trang QR: số tiền = tổng đơn (${vnd(o.total)})`, t.includes(vnd(o.total)), vnd(o.total));
  const qrSrc = await s.page.locator('img[alt="VietQR"]').getAttribute('src');
  c.ev('src ảnh QR', qrSrc);
  c.ok('URL ảnh QR chứa STK, số tiền và nội dung = mã đơn', !!qrSrc && qrSrc.includes('8386790906') && qrSrc.includes(String(o.total)) && qrSrc.includes(code), qrSrc);
  const ox = await overflowX(s.page);
  c.ok('trang QR không tràn ngang', ox.sw <= ox.iw + 1, ox);
  await c.shot(s.page, 'qr-cho-thanh-toan');
  // ngân hàng: nội dung sai
  const wrong = cli('bank-webhook.mjs', [code, String(o.total), 'chuyen tien hang']);
  c.ok('CK sai nội dung: Pancake không ghép được (matched=false)', wrong.matched === false, wrong.reason ?? wrong);
  await sleep(5500);
  o = await orderRow(code);
  c.ok('CK sai nội dung: đơn vẫn UNPAID/PENDING_PAYMENT', o.paymentStatus === 'UNPAID' && o.status === 'PENDING_PAYMENT', { st: o.status, pay: o.paymentStatus });
  // thiếu tiền
  const part = cli('bank-webhook.mjs', [code, '100000', `${code} thanh toan`]);
  c.ev('CK thiếu', part.event ? { event: part.event, after: part.orderAfter } : part);
  await sleep(5500);
  o = await orderRow(code);
  c.ok('CK thiếu 100.000đ: đơn chưa PAID', o.paymentStatus !== 'PAID' && o.status === 'PENDING_PAYMENT', { st: o.status, pay: o.paymentStatus });
  t = await bodyText(s.page);
  c.ok('trang QR vẫn hiện "Đang chờ thanh toán" (không báo đã nhận)', /Đang chờ thanh toán|Đang kiểm tra/.test(t) && !/Đã nhận thanh toán/.test(t), t.slice(-300));
  // đủ tiền
  const rest = o.total - 100000;
  const full = cli('bank-webhook.mjs', [code, String(rest), `${code} thanh toan not`]);
  c.ok('CK nốt phần còn lại: webhook xử lý xong', full.event?.status === 'PROCESSED', full.event);
  let paidShown = false;
  for (let i = 0; i < 12 && !paidShown; i++) {
    await sleep(1500);
    paidShown = /Đã nhận thanh toán/.test(await bodyText(s.page));
  }
  o = await orderRow(code);
  c.ev('orders sau CK đủ', o);
  c.ok('DB: PAID + CONFIRMED + paidAt', o.paymentStatus === 'PAID' && o.status === 'CONFIRMED' && !!o.paidAt, { st: o.status, pay: o.paymentStatus, paidAt: o.paidAt });
  c.ok('trang QR tự cập nhật "Đã nhận thanh toán!" (không cần tải lại)', paidShown, (await bodyText(s.page)).slice(0, 200));
  await c.shot(s.page, 'qr-da-nhan-tien');
  // giao xong → điểm
  const before = await ledger(UID);
  await sendOrderStatus(L, code, 'shipped');
  const dl = await sendOrderStatus(L, code, 'delivered');
  c.ok('delivered xử lý xong', dl.event?.status === 'PROCESSED' && dl.order?.status === 'DELIVERED', dl.event);
  await sleep(1500);
  const rows = await ledgerRows(UID, `ORDER_DELIVERED:${code}`);
  c.ev('sổ điểm', rows);
  c.ok('sổ: đúng 1 dòng ORDER_DELIVERED +3.380 (2% × 169.000 × hệ số Mầm Xanh 1)', rows.length === 1 && rows[0].delta === 3380, rows);
  const after = await ledgerOk(c, 'sau giao', UID);
  c.ok('pointsBalance = trước + 3.380', after.balance === before.balance + 3380, { before: before.balance, after: after.balance });
  // mã dùng một lần: khách khác không dùng lại được
  await clearCart('new_nophone');
  await call('new_nophone', 'POST', '/cart/items', { variationId: await variantId('POLANG-LG-10'), quantity: 1 });
  await call('new_nophone', 'POST', '/cart/items', { variationId: await variantId('COBOTE-TR-50'), quantity: 1 });
  const c2 = await call('new_nophone', 'POST', '/cart/coupon', { code: hopsan });
  c.ev('khách khác áp lại mã đã dùng', { status: c2.status, body: c2.body });
  c.ok('khách khác không áp lại được mã HOPSAN đã dùng (4xx)', c2.status >= 400 && c2.status < 500, { status: c2.status, body: c2.body });
  await clearCart('new_nophone');
  const cu = (await sql(`SELECT "usedCount"::int AS used, "usageLimit"::int AS lim FROM coupons WHERE code = $1`, hopsan))[0];
  c.ok('DB: mã HOPSAN usedCount = 1 (mỗi mã dùng 1 lần)', cu.used === 1, cu);
  await s.close();
});

// ───────────── U6-34 bấm đúp "Đặt hàng"
await rec.run('U6-34', { role: 'Khách quay lại (Lộc Biếc)', journey: 'Chống đặt trùng', steps: 'Giỏ 1 sản phẩm; bấm "Đặt hàng" hai lần trong cùng một tick (bấm đúp/mạng chậm) (390px)', expected: 'Chỉ tạo đúng 1 đơn (DB đếm theo user + thời điểm), tồn kho chỉ giữ 1 lần, điểm/mã không bị trừ hai lần' }, async (c) => {
  const U = 'returning';
  const UID = 'uat_returning';
  await clearCart(U);
  const s = await openWeb(U, { width: 390, path: '/' });
  await addViaPdp(s, 'phan-rom-thao-duoc-cobote', { qty: 1 });
  await openCheckout(s);
  const stock0 = await stockOf('COBOTE-PW-100');
  const n0 = (await sql(`SELECT count(*)::int AS n FROM orders WHERE "userId" = $1`, UID))[0].n;
  const posts = [];
  s.page.on('request', (r) => {
    if (r.url().endsWith('/checkout/place-order') && r.method() === 'POST') posts.push(r.headers()['idempotency-key'] ?? r.headers()['x-idempotency-key'] ?? '(không có header)');
  });
  await placeBtn(s).evaluate((el) => {
    el.click();
    el.click();
    el.click();
  });
  await s.page.waitForTimeout(6000);
  const n1 = (await sql(`SELECT count(*)::int AS n FROM orders WHERE "userId" = $1`, UID))[0].n;
  const stock1 = await stockOf('COBOTE-PW-100');
  c.ev('số request place-order trình duyệt gửi', posts);
  c.ev('đơn trước/sau', { n0, n1 });
  c.ok('DB: chỉ +1 đơn', n1 === n0 + 1, { n0, n1 });
  c.ok('tồn kho chỉ bị giữ 1 lần', stock0.stock - stock1.stock === 1 || stock1.reserved - stock0.reserved === 1, { stock0, stock1 });
  const t = await bodyText(s.page);
  c.ok('hiện "Đặt hàng thành công!"', /Đặt hàng thành công/.test(t), t.slice(0, 200));
  const last = (await sql(`SELECT code FROM orders WHERE "userId" = $1 ORDER BY "createdAt" DESC LIMIT 1`, UID))[0];
  // dọn: huỷ đơn để trả tồn
  await call(U, 'POST', `/orders/${last.code}/cancel`, {});
  await s.close();
});

// ───────────── U6-35 phí ship theo luật (API báo giá làm chuẩn, trang hiển thị đúng)
await rec.run('U6-35', { role: 'Khách mới chưa từng đặt (uat_new_nophone, không SĐT) và khách quay lại', journey: 'Phí vận chuyển', steps: 'Báo giá cho giỏ: (khách mới) 199.000 / 110.000; (Lộc Biếc) 110.000 / 89.000; đọc dòng "Phí vận chuyển" trên trang thanh toán (390px)', expected: 'Khách mới đơn đầu: từ 199.000đ miễn phí, dưới đó 19.000đ; Lộc Biếc: freeship từ 99.000đ (shipping.tier_freeship_overrides), dưới đó 19.000đ; trang hiển thị đúng số của báo giá; khách không có SĐT vẫn đặt được trên web (Q2)' }, async (c) => {
  const matrix = [
    { u: 'new_nophone', uid: 'uat_new_nophone', skus: [['tinh-dau-sa-chanh-po-lang', 1], ['dau-tram-be-cobote', 1]], sub: 199000, fee: 0, why: 'đơn đầu ≥ 199.000đ' },
    { u: 'new_nophone', uid: 'uat_new_nophone', skus: [['tinh-dau-sa-chanh-po-lang', 1]], sub: 110000, fee: 19000, why: 'đơn đầu < 199.000đ' },
    { u: 'returning', uid: 'uat_returning', skus: [['tinh-dau-sa-chanh-po-lang', 1]], sub: 110000, fee: 0, why: 'Lộc Biếc freeship từ 99.000đ' },
    { u: 'returning', uid: 'uat_returning', skus: [['dau-tram-be-cobote', 1]], sub: 89000, fee: 19000, why: 'Lộc Biếc dưới 99.000đ' },
  ];
  const has = (await sql(`SELECT count(*)::int n FROM addresses WHERE "userId" = 'uat_new_nophone'`))[0].n;
  if (!has) {
    await sql(`INSERT INTO addresses (id, "userId", recipient, phone, province, district, ward, street, "isDefault", "provinceCode", "districtCode", "wardCode") SELECT md5(random()::text || clock_timestamp()::text), 'uat_new_nophone', 'Khách Chưa SĐT', '0901000099', province, district, ward, street, true, "provinceCode", "districtCode", "wardCode" FROM addresses WHERE "userId" = 'uat_returning' ORDER BY "isDefault" DESC LIMIT 1`);
    c.note('đã nhân bản địa chỉ mặc định của returning cho uat_new_nophone (SQL) vì ca này chỉ kiểm phí ship');
  }
  const prior = (await sql(`SELECT count(*)::int n FROM orders WHERE "userId" = 'uat_new_nophone'`))[0].n;
  c.ev('số đơn cũ của uat_new_nophone', prior);
  for (const m of matrix) {
    await clearCart(m.u);
    const s = await openWeb(m.u, { width: 390, path: '/' });
    await quoteWatcher(s);
    for (const [slug, qty] of m.skus) await addViaPdp(s, slug, { qty });
    await openCheckout(s);
    const q = s.lastQuote;
    const t = await bodyText(s.page);
    c.ok(`${m.u} ${vnd(m.sub)} (${m.why}): báo giá ship ${vnd(m.fee)}`, q?.subtotal === m.sub && q?.shippingFee === m.fee, q && { subtotal: q.subtotal, ship: q.shippingFee });
    const shown = m.fee === 0 ? /Phí vận chuyển\s*\n?Miễn phí/.test(t) : new RegExp(`Phí vận chuyển\\s*\\n?${vnd(m.fee).replace('.', '\\.')}`).test(t);
    c.ok(`${m.u} ${vnd(m.sub)}: trang hiển thị phí ship đúng`, shown, t.slice(t.indexOf('Phí vận chuyển'), t.indexOf('Phí vận chuyển') + 60));
    if (m.sub === 110000 && m.u === 'new_nophone') {
      c.ok('khách không SĐT vẫn thấy nút "Đặt hàng" bấm được (Q2: web không bắt xác minh SĐT)', await placeBtn(s).isEnabled());
      await c.shot(s.page, 'ship-19k-khach-moi-khong-sdt');
    }
    await s.close();
    await clearCart(m.u);
  }
});

// ───────────── U6-36 hết hàng giữa lúc thanh toán
await rec.run('U6-36', { role: 'Khách quay lại (Lộc Biếc)', journey: 'Hết hàng khi thanh toán', steps: 'Mở trang thanh toán với 2 chiếc nước lau kính; đặt tồn FUWA-GL-500 = 1 (SQL); bấm Đặt hàng (390px)', expected: 'Không tạo đơn; trang báo "còn lại 1 sản phẩm"/hết hàng bằng câu dễ hiểu kèm nút "Về giỏ hàng để sửa"; DB không có đơn mới, tồn không âm' }, async (c) => {
  const U = 'returning';
  const UID = 'uat_returning';
  await clearCart(U);
  const s = await openWeb(U, { width: 390, path: '/' });
  await addViaPdp(s, 'nuoc-lau-kinh-fuwa3e', { qty: 2 });
  await openCheckout(s);
  const n0 = (await sql(`SELECT count(*)::int AS n FROM orders WHERE "userId" = $1`, UID))[0].n;
  const old = (await stockOf('FUWA-GL-500')).stock;
  await sql(`UPDATE variations SET stock = 1 WHERE sku = 'FUWA-GL-500'`);
  try {
    const respP = s.page.waitForResponse((r) => r.url().endsWith('/checkout/place-order'), { timeout: 30_000 }).catch(() => null);
    await placeBtn(s).click();
    const resp = await respP;
    await s.page.waitForTimeout(2500);
    c.ev('phản hồi place-order', resp && { status: resp.status(), body: await resp.json().catch(() => null) });
    c.ok('API từ chối (4xx)', resp && resp.status() >= 400 && resp.status() < 500, resp && resp.status());
    const t = await bodyText(s.page);
    c.ok('trang báo hết hàng/còn lại 1 bằng câu tiếng Việt', /(còn|Chỉ còn).{0,20}1|hết hàng/i.test(t), t.slice(0, 500));
    c.ok('có nút "Về giỏ hàng để sửa"', /Về giỏ hàng để sửa/.test(t));
    const n1 = (await sql(`SELECT count(*)::int AS n FROM orders WHERE "userId" = $1`, UID))[0].n;
    c.ok('DB: không có đơn mới', n1 === n0, { n0, n1 });
    const st = await stockOf('FUWA-GL-500');
    c.ok('tồn kho không âm', st.stock >= 0 && st.reserved >= 0, st);
    await c.shot(s.page, 'het-hang-khi-dat');
  } finally {
    await sql(`UPDATE variations SET stock = $1 WHERE sku = 'FUWA-GL-500'`, old);
    await clearCart(U);
  }
  await s.close();
});

// ───────────── U6-37 phương thức thanh toán hiển thị trên web (Q4)
await rec.run('U6-37', { role: 'Khách quay lại (Lộc Biếc)', journey: 'Phương thức thanh toán', steps: 'Mở /thanh-toan với 1 sản phẩm, liệt kê các lựa chọn thanh toán (390 và 1440px)', expected: 'Q4: web chỉ có chuyển khoản QR + COD (không ZaloPay, không cổng khác)' }, async (c) => {
  const U = 'returning';
  await clearCart(U);
  for (const w of WIDTHS) {
    const s = await openWeb(U, { width: w, path: '/' });
    await addViaPdp(s, 'phan-rom-thao-duoc-cobote', { qty: 1 });
    await openCheckout(s);
    const labels = await s.page.getByRole('radio').evaluateAll((els) => els.filter((e) => e.name === 'pay').map((e) => e.closest('label')?.innerText?.trim()));
    c.ev(`${w}: các lựa chọn thanh toán`, labels);
    c.ok(`${w}: có COD và Chuyển khoản`, labels.some((x) => /COD/.test(x)) && labels.some((x) => /Chuyển khoản/.test(x)), labels);
    c.ok(`${w}: chỉ 2 phương thức theo Q4 (không có Ví Tubu/ZaloPay)`, labels.length === 2, labels);
    await c.shot(s.page, `phuong-thuc-${w}`);
    await s.close();
  }
  await clearCart(U);
});

// ───────────── U6-38 Ví Tubu khi thanh toán trên web
await rec.run('U6-38', { role: 'Khách quay lại (Lộc Biếc)', journey: 'Ví Tubu', steps: 'Cấp ví 200.000đ cho uat_returning (SQL + dòng wallet_transactions); đặt đơn 89.000đ bằng Ví Tubu trên web (390px); huỷ đơn', expected: 'Ví trừ đúng tổng đơn, có dòng wallet_transactions; đơn PAID; huỷ đơn hoàn tiền về ví; walletBalance = SUM(wallet_transactions)' }, async (c) => {
  const U = 'returning';
  const UID = 'uat_returning';
  await clearCart(U);
  const wcols = (await sql(`SELECT column_name FROM information_schema.columns WHERE table_name = 'wallet_transactions' ORDER BY ordinal_position`)).map((x) => x.column_name);
  c.ev('cột wallet_transactions', wcols.join(','));
  await seedWallet(UID, 200000);
  try {
    const s = await openWeb(U, { width: 390, path: '/' });
    await quoteWatcher(s);
    await addViaPdp(s, 'dau-tram-be-cobote', { qty: 1 });
    await openCheckout(s);
    const wallet = s.page.getByRole('radio', { name: /Ví Tubu/ });
    c.ok('có lựa chọn Ví Tubu (ngoài Q4 — xem U6-37)', (await wallet.count()) > 0);
    if ((await wallet.count()) === 0) {
      c.blocked('web không còn lựa chọn Ví Tubu');
    } else {
      c.ok('Ví Tubu chọn được khi đủ tiền', await wallet.isEnabled(), await bodyText(s.page).then((x) => x.slice(0, 80)));
      await wallet.check();
      await waitReady(s);
      const r = await place(s);
      c.ok('đặt hàng bằng Ví → 201', r.status === 201 && !!r.code, { status: r.status, body: r.status >= 300 ? r.body : undefined });
      const o = await orderRow(r.code);
      c.ev('orders', o);
      c.ok('DB: paymentMethod WALLET, PAID', o?.paymentMethod === 'WALLET' && o.paymentStatus === 'PAID', o && { pm: o.paymentMethod, pay: o.paymentStatus, st: o.status });
      const u1 = (await sql(`SELECT "walletBalance"::int AS w FROM users WHERE id = $1`, UID))[0].w;
      c.ok('ví giảm đúng tổng đơn (200.000 − 89.000)', u1 === 200000 - o.total, { wallet: u1, total: o.total });
      const tx = await sql(`SELECT * FROM wallet_transactions WHERE "userId" = $1 ORDER BY "createdAt" DESC LIMIT 3`, UID).catch(() => []);
      c.ev('wallet_transactions', tx);
      c.ok('có dòng wallet_transactions trừ tiền cho đơn', tx.some((x) => Number(x.amount ?? x.delta) === -o.total || Number(x.amount ?? x.delta) === o.total), tx.slice(0, 2));
      await nav(s, `/tai-khoan/don-hang/${r.code}`);
      await s.page.getByRole('button', { name: 'Hủy đơn' }).first().click();
      await s.page.getByRole('alertdialog').getByRole('button', { name: 'Hủy đơn' }).click();
      await s.page.waitForTimeout(2500);
      const u2 = (await sql(`SELECT "walletBalance"::int AS w FROM users WHERE id = $1`, UID))[0].w;
      c.ok('huỷ đơn: hoàn tiền về ví (200.000)', u2 === 200000, { wallet: u2 });
    }
    await s.close();
  } finally {
    await seedWallet(UID, 0);
    await clearCart(U);
  }
});

// ───────────── U6-39 mua qua gian hàng CTV (hoa hồng 8% sau giao)
await rec.run('U6-39', { role: 'Khách quay lại mua qua gian hàng /s/uatctv', journey: 'Gian hàng CTV', steps: 'Mở /s/uatctv rồi thêm sản phẩm, thanh toán COD (390px); giao xong; xem hoa hồng của CTV', expected: 'Đơn gắn storefrontSlug=uatctv và referrer = CTV; sau giao có dòng hoa hồng của uat_ctv = 8% tiền hàng (sau giảm), giữ 10 ngày (chưa rút được)' }, async (c) => {
  const U = 'returning';
  const UID = 'uat_returning';
  await clearCart(U);
  const s = await openWeb(U, { width: 390, path: '/s/uatctv' });
  await quoteWatcher(s);
  const t = await bodyText(s.page);
  c.ev('gian hàng', t.slice(0, 300));
  const link = s.page.locator('a[href^="/san-pham/"]').first();
  const href = await link.getAttribute('href');
  c.ok('gian hàng có sản phẩm để bấm', !!href, href);
  await link.click();
  await s.page.waitForURL(/\/san-pham\//, { timeout: 30_000 });
  await s.page.waitForTimeout(1500);
  await s.page.getByRole('button', { name: /Thêm vào giỏ/ }).first().click();
  await s.page.waitForTimeout(2000);
  await openCheckout(s);
  const q = s.lastQuote;
  c.ev('báo giá', q && { subtotal: q.subtotal, total: q.total });
  const r = await place(s);
  c.ok('đặt hàng → 201', r.status === 201 && !!r.code, { status: r.status, body: r.status >= 300 ? r.body : undefined });
  const o = await orderRow(r.code);
  c.ev('orders', o);
  c.ok('DB: storefrontSlug = uatctv', o?.storefrontSlug === 'uatctv', o?.storefrontSlug);
  c.ok('DB: referrerUserId = uat_ctv', o?.referrerUserId === 'uat_ctv', o?.referrerUserId);
  await sendOrderStatus(L, r.code, 'shipped');
  const dl = await sendOrderStatus(L, r.code, 'delivered');
  c.ok('delivered xử lý xong', dl.event?.status === 'PROCESSED', dl.event);
  await sleep(1500);
  const com = await sql(`SELECT "affiliateUserId", "orderTotal"::int AS "orderTotal", "commissionableTotal"::int AS "commissionableTotal", rate::float AS rate, amount::int AS amount, status, "approvedAt", "lockedAt" FROM commissions WHERE "orderId" = (SELECT id FROM orders WHERE code = $1)`, r.code).catch((e) => [{ lỗi: String(e) }]);
  c.ev('commissions', com);
  const base = o.subtotal - o.discount;
  const expected = Math.round(base * 0.08);
  const amt = com[0] && Number(com[0].amount);
  c.ok(`hoa hồng = 8% × ${vnd(base)} = ${vnd(expected)}`, com.length >= 1 && Math.abs(amt - expected) <= 1, { amt, expected, rows: com.length });
  c.ok('hoa hồng của uat_ctv, trạng thái chờ (giữ 10 ngày)', com[0]?.affiliateUserId === 'uat_ctv' && /PENDING|HOLD|LOCK/i.test(com[0].status ?? ''), com[0]);
  await s.close();
});

await finish(rec);
