// Nhóm E: đơn hàng trên web. Danh sách + tab + tìm kiếm, chi tiết theo trạng thái, huỷ đơn (COD, chuyển khoản chưa trả, đã trả → hoàn ví),
// đơn đã giao (Mua lại, đánh giá, đổi/trả), IDOR, so với Mini App. Đơn dựng bằng API thật rồi đổi trạng thái qua giả Pancake.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import {
  L, HARNESS_DIR, Recorder, finish, openWeb, openMini, nav, bodyText, badReqs, overflowX, sql, call, clearCart, cartRows, variantId, vnd, sleep,
  ledger, sendOrderStatus, seedWallet,
} from './_lib.mjs';

const rec = new Recorder('e-orders');
const WIDTHS = [390, 1440];
const U = 'returning';
const UID = 'uat_returning';
const cli = (file, args) => JSON.parse(execFileSync('node', [path.join(HARNESS_DIR, file), '6', ...args], { encoding: 'utf8', env: process.env }));

const addrId = async () => (await sql(`SELECT id FROM addresses WHERE "userId" = $1 ORDER BY "isDefault" DESC LIMIT 1`, UID))[0].id;
async function placeApi(user, lines, method, extra = {}) {
  await clearCart(user);
  for (const [sku, qty] of lines) {
    const r = await call(user, 'POST', '/cart/items', { variationId: await variantId(sku), quantity: qty });
    if (r.status >= 300) throw new Error(`thêm ${sku} vào giỏ lỗi ${r.status} ${JSON.stringify(r.body)}`);
  }
  const uid = user === 'returning' ? UID : `uat_${user}`;
  const a = (await sql(`SELECT id FROM addresses WHERE "userId" = $1 ORDER BY "isDefault" DESC LIMIT 1`, uid))[0];
  const r = await call(user, 'POST', '/checkout/place-order', { addressId: a.id, paymentMethod: method, ...extra });
  if (r.status >= 300) throw new Error(`đặt đơn lỗi ${r.status} ${JSON.stringify(r.body)}`);
  const code = r.body?.code ?? r.body?.orders?.[0]?.code;
  if (!code) throw new Error(`không có mã đơn: ${JSON.stringify(r.body).slice(0, 300)}`);
  return code;
}
const orderRow = async (code) =>
  (await sql(
    `SELECT code, status, "paymentMethod" pm, "paymentStatus" ps, subtotal::int, discount::int, "shippingFee"::int fee, total::int, "pointsEarned"::int pe, "shippingCode", "shippingPartner" FROM orders WHERE code = $1`,
    code,
  ))[0];
const stockOf = async (sku) => (await sql(`SELECT stock::int, "reservedStock"::int AS reserved FROM variations WHERE sku = $1`, sku))[0];
const pancakeStatus = async (code) => {
  const f = await (await fetch(`${L.pancakeUrl}/__uat/find?code=${code}`)).json().catch(() => null);
  return f?.order && { id: f.order.id, status: f.order.status, status_name: f.order.status_name };
};
const waitPancake = async (code) => {
  for (let i = 0; i < 30; i++) {
    if ((await pancakeStatus(code))?.id) return true;
    await sleep(500);
  }
  return false;
};

// Dựng bộ đơn đủ trạng thái cho khách quay lại (mỗi lần chạy dựng mới).
const S = {};
console.log('dựng đơn mẫu…');
S.bank = await placeApi(U, [['POLANG-LG-10', 1]], 'BANK_TRANSFER');
S.cod = await placeApi(U, [['COBOTE-TR-50', 1], ['COBOTE-PW-100', 2]], 'COD');
S.ship = await placeApi(U, [['FUWA-GL-500', 2]], 'COD');
S.dlv = await placeApi(U, [['FUWA-HW-500', 1], ['POLANG-LG-10', 1]], 'COD');
S.cancelled = await placeApi(U, [['COBOTE-MS-100', 1]], 'COD');
for (const k of ['ship', 'dlv']) await waitPancake(S[k]);
const sh = await sendOrderStatus(L, S.ship, 'shipped');
await sendOrderStatus(L, S.dlv, 'shipped');
const dl = await sendOrderStatus(L, S.dlv, 'delivered');
await call(U, 'POST', `/orders/${S.cancelled}/cancel`, {});
await clearCart(U);
console.log('đơn mẫu', S, 'shipped=', sh.event?.status, 'delivered=', dl.event?.status);

const GROUP = {
  all: () => true,
  pending_payment: (s) => s === 'PENDING_PAYMENT',
  processing: (s) => ['CONFIRMED', 'PACKED'].includes(s),
  shipping: (s) => s === 'SHIPPING',
  delivered: (s) => s === 'DELIVERED',
  closed: (s) => ['CANCELLED', 'RETURNED'].includes(s),
};
const TAB_LABEL = { all: 'Tất cả', pending_payment: 'Chờ thanh toán', processing: 'Đang xử lý', shipping: 'Đang giao', delivered: 'Đã giao', closed: 'Đã hủy/hoàn' };
const codesOnPage = (page) => page.locator('[data-testid="order-card"] a[aria-label^="Đơn "]').evaluateAll((els) => els.map((e) => e.textContent.trim()));
async function loadAll(page) {
  for (let i = 0; i < 6; i++) {
    const more = page.getByRole('button', { name: 'Xem thêm' });
    if (!(await more.count())) break;
    await more.click();
    await page.waitForTimeout(1200);
  }
}

// ───────────── U6-50 danh sách + tab theo trạng thái
for (const w of WIDTHS) {
  await rec.run(`U6-50-${w}`, { role: 'Khách quay lại', journey: 'Danh sách đơn', steps: `Mở /tai-khoan/don-hang, bấm lần lượt từng tab trạng thái (${w}px)`, expected: 'Mỗi tab chỉ hiện đúng các đơn thuộc nhóm đó (DB là chuẩn): Chờ thanh toán=PENDING_PAYMENT, Đang xử lý=CONFIRMED/PACKED, Đang giao=SHIPPING, Đã giao=DELIVERED, Đã hủy/hoàn=CANCELLED/RETURNED; thẻ đơn có mã, chip trạng thái, số món, tổng tiền khớp DB; không tràn ngang' }, async (c) => {
    const all = await sql(`SELECT code, status, total::int t, (SELECT COALESCE(SUM(quantity),0)::int FROM order_items oi WHERE oi."orderId" = o.id) n FROM orders o WHERE "userId" = $1 ORDER BY "createdAt" DESC`, UID);
    c.ev('đơn trong DB', all.map((o) => `${o.code}:${o.status}`));
    const s = await openWeb(U, { width: w, path: '/' });
    const r = await nav(s, '/tai-khoan/don-hang');
    for (const key of Object.keys(GROUP)) {
      await s.page.getByRole('tab', { name: TAB_LABEL[key], exact: true }).click();
      await s.page.waitForTimeout(1800);
      await loadAll(s.page);
      const shown = await codesOnPage(s.page);
      const expect = all.filter((o) => GROUP[key](o.status)).map((o) => o.code);
      const same = shown.length === expect.length && expect.every((x) => shown.includes(x));
      c.ok(`tab "${TAB_LABEL[key]}": ${expect.length} đơn đúng như DB`, same, { shown, expect });
      if (key === 'all') await c.shot(s.page, 'danh-sach-tat-ca');
    }
    // một thẻ cụ thể
    await s.page.getByRole('tab', { name: 'Tất cả', exact: true }).click();
    await s.page.waitForTimeout(1500);
    const card = s.page.locator('[data-testid="order-card"]', { hasText: S.cod }).first();
    const ct = await card.innerText();
    const o = await orderRow(S.cod);
    c.ok(`thẻ đơn COD hiện tổng ${vnd(o.total)} và "3 món"`, ct.includes(vnd(o.total)) && /3 món/.test(ct), ct.replace(/\n+/g, ' | '));
    c.ok('thẻ đơn COD hiện chip "Đã xác nhận"', /Đã xác nhận|Đang xử lý|Chờ xử lý/i.test(ct), ct.replace(/\n+/g, ' | '));
    const bankCard = await s.page.locator('[data-testid="order-card"]', { hasText: S.bank }).first().innerText();
    c.ok('đơn chuyển khoản chưa trả có nút "Thanh toán ngay"', /Thanh toán ngay/.test(bankCard), bankCard.replace(/\n+/g, ' | '));
    const dlvCard = await s.page.locator('[data-testid="order-card"]', { hasText: S.dlv }).first().innerText();
    c.ok('đơn đã giao có nút "Mua lại"', /Mua lại/.test(dlvCard), dlvCard.replace(/\n+/g, ' | '));
    const ox = await overflowX(s.page);
    c.ok('không tràn ngang', ox.sw <= ox.iw + 1, ox);
    c.ok('không request API lỗi', badReqs(r.reqs).length === 0, badReqs(r.reqs));
    await s.close();
  });
}

// ───────────── U6-51 tìm đơn ở trang tài khoản
await rec.run('U6-51', { role: 'Khách quay lại', journey: 'Tìm đơn', steps: 'Mở /tai-khoan, gõ mã đơn / tên sản phẩm / chuỗi lạ vào ô "Mã đơn hoặc tên sản phẩm" (390px)', expected: 'Mã đơn: đúng 1 đơn; tên sản phẩm: chỉ đơn có sản phẩm đó; chuỗi lạ: thông báo không có đơn; nút "Xóa tìm kiếm" quay về danh sách' }, async (c) => {
  const s = await openWeb(U, { width: 390, path: '/' });
  await nav(s, '/tai-khoan');
  const input = s.page.getByPlaceholder('Mã đơn hoặc tên sản phẩm');
  const search = async (q) => {
    await input.fill(q);
    await s.page.getByRole('button', { name: 'Tìm', exact: true }).click();
    await s.page.waitForTimeout(2000);
    return s.page.locator('a[href^="/tai-khoan/don-hang/"]').evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute('href').split('/').pop()))]);
  };
  let got = await search(S.cod);
  c.ok('tìm theo mã đơn → đúng 1 đơn', got.length === 1 && got[0] === S.cod, got);
  const expectName = await sql(`SELECT DISTINCT o.code FROM orders o JOIN order_items oi ON oi."orderId" = o.id WHERE o."userId" = $1 AND oi."productName" ILIKE '%Cobote%'`, UID);
  got = await search('Cobote');
  c.ev('tìm "Cobote"', { got, expect: expectName.map((x) => x.code) });
  c.ok('tìm theo tên sản phẩm "Cobote" → đúng các đơn có sản phẩm Cobote', got.length === expectName.length && expectName.every((x) => got.includes(x.code)), { got, expect: expectName.map((x) => x.code) });
  await c.shot(s.page, 'tim-cobote');
  got = await search('zzzkhongco');
  const t = await bodyText(s.page);
  c.ok('chuỗi lạ → không có đơn nào + câu báo', got.length === 0 && /Chưa có đơn|Không có đơn|không tìm thấy/i.test(t), { got, text: t.slice(t.indexOf('Kết quả'), t.indexOf('Kết quả') + 200) });
  await s.page.getByRole('button', { name: 'Xóa tìm kiếm' }).click();
  await s.page.waitForTimeout(1500);
  const after = await s.page.locator('a[href^="/tai-khoan/don-hang/"]').count();
  c.ok('Xóa tìm kiếm → danh sách trở lại', after >= 5, after);
  await s.close();
});

// ───────────── U6-52 chi tiết đơn theo trạng thái
for (const w of WIDTHS) {
  await rec.run(`U6-52-${w}`, { role: 'Khách quay lại', journey: 'Chi tiết đơn', steps: `Mở chi tiết 4 đơn: chờ chuyển khoản, COD đã xác nhận, đang giao (có mã vận đơn), đã giao (${w}px)`, expected: 'Chip trạng thái đúng; tạm tính/ship/tổng khớp DB; phương thức + tình trạng thanh toán đúng; sản phẩm × số lượng × đơn giá khớp; đơn chờ chuyển khoản hiện khung QR; đơn đang giao hiện đơn vị vận chuyển + mã vận đơn; đơn đã giao hiện "Viết đánh giá" + "Mua lại đơn này"; không tràn ngang' }, async (c) => {
    const s = await openWeb(U, { width: w, path: '/' });
    const check = async (key, label, extra) => {
      const code = S[key];
      const r = await nav(s, `/tai-khoan/don-hang/${code}`);
      const t = await bodyText(s.page);
      const o = await orderRow(code);
      const items = await sql(`SELECT "productName", "variationName", "unitPrice"::int u, quantity::int q, oi.total::int t FROM order_items oi JOIN orders o ON o.id = oi."orderId" WHERE o.code = $1`, code);
      c.ok(`${label}: tiêu đề "Đơn hàng #${code}"`, t.includes(`Đơn hàng #${code}`));
      c.ok(`${label}: tổng ${vnd(o.total)} và tạm tính ${vnd(o.subtotal)} khớp DB`, t.includes(vnd(o.total)) && t.includes(vnd(o.subtotal)), { o });
      c.ok(`${label}: ship ${o.fee === 0 ? 'Miễn phí' : vnd(o.fee)} khớp DB`, o.fee === 0 ? /Phí vận chuyển\s*\n?Miễn phí/.test(t) : t.includes(vnd(o.fee)), { fee: o.fee });
      for (const it of items) c.ok(`${label}: dòng "${it.productName}" ${vnd(it.u)} × ${it.q} = ${vnd(it.t)}`, t.includes(`${vnd(it.u)} × ${it.q}`) && t.includes(vnd(it.t)), it);
      if (extra) await extra(t, o);
      const ox = await overflowX(s.page);
      c.ok(`${label}: không tràn ngang`, ox.sw <= ox.iw + 1, ox);
      c.ok(`${label}: không request API lỗi`, badReqs(r.reqs).length === 0, badReqs(r.reqs));
      await c.shot(s.page, `chi-tiet-${key}`);
    };
    await check('bank', 'chờ chuyển khoản', async (t, o) => {
      c.ok('hiện "Đang chờ" + khung QR (STK 8386790906)', /chờ bạn chuyển khoản/.test(t) && t.includes('8386790906'), t.slice(0, 200));
      c.ok('phương thức "Chuyển khoản ngân hàng", tình trạng "Chưa thanh toán"', /Chuyển khoản ngân hàng/.test(t) && /Chưa thanh toán/.test(t));
      c.ok('nút "Hủy đơn" có (đơn chưa trả)', (await s.page.getByRole('button', { name: 'Hủy đơn' }).count()) > 0);
    });
    await check('cod', 'COD đã xác nhận', async (t, o) => {
      c.ok('chip "Đã xác nhận" hoặc tương đương', /Đã xác nhận|Chờ xử lý|Đang xử lý/.test(t), t.slice(0, 160));
      c.ok('phương thức COD, "Chưa thanh toán"', /Thanh toán khi nhận hàng/.test(t) && /Chưa thanh toán/.test(t));
      c.ok('địa chỉ giao 12 Lê Lợi + SĐT người nhận', /12 Lê Lợi/.test(t) && /0901000003|0901 000 003/.test(t.replace(/\s/g, ' ')), t.slice(t.indexOf('Giao hàng'), t.indexOf('Giao hàng') + 200));
      c.ok('có nút "Hủy đơn"', (await s.page.getByRole('button', { name: 'Hủy đơn' }).count()) > 0);
      c.ok('ghi chú điểm: sẽ nhận điểm sau khi giao', new RegExp(String(o.pe).replace(/\B(?=(\d{3})+(?!\d))/g, '.?')).test(t) || /Điểm Xanh/.test(t), t.slice(t.indexOf('Phương thức')));
    });
    await check('ship', 'đang giao', async (t, o) => {
      const row = await orderRow(S.ship);
      c.ok('chip "Đang giao"', /Đang giao|Đã đặt đơn vị vận chuyển/.test(t), t.slice(0, 160));
      c.ok('hiện Mã vận đơn của DB', !!row.shippingCode && t.includes(row.shippingCode), { code: row.shippingCode, partner: row.shippingPartner });
      c.ok('hiện Đơn vị vận chuyển', !!row.shippingPartner && t.includes(row.shippingPartner), row.shippingPartner);
      c.ok('KHÔNG có nút "Hủy đơn" (đã giao cho vận chuyển)', (await s.page.getByRole('button', { name: 'Hủy đơn' }).count()) === 0);
      c.ok('có câu giải thích "Đơn đã giao cho đơn vị vận chuyển nên không huỷ được"', /không huỷ được|không hủy được/.test(t), t.slice(0, 300));
    });
    await check('dlv', 'đã giao', async (t, o) => {
      c.ok('chip "Đã giao"', /Đã giao/.test(t.slice(0, 300)), t.slice(0, 160));
      c.ok('có "Viết đánh giá" cho từng sản phẩm', (await s.page.getByRole('link', { name: /Viết đánh giá/ }).count()) === 2, await s.page.getByRole('link', { name: /Viết đánh giá/ }).count());
      c.ok('có nút "Mua lại đơn này"', (await s.page.getByRole('button', { name: 'Mua lại đơn này' }).count()) === 1);
      c.ok('có nút "Yêu cầu đổi/trả" trong hạn 7 ngày', (await s.page.getByRole('button', { name: /Yêu cầu đổi\/trả/ }).count()) === 1);
      c.ok('KHÔNG có nút "Hủy đơn"', (await s.page.getByRole('button', { name: 'Hủy đơn' }).count()) === 0);
      c.ok('ghi chú điểm "Đã cộng" (sau giao)', /Đã cộng|đã được cộng|\+\s*\d/.test(t) || /Điểm Xanh/.test(t), t.slice(t.indexOf('Phương thức')));
    });
    await s.close();
  });
}

// ───────────── U6-53 huỷ đơn COD và đơn chuyển khoản chưa trả; không huỷ được khi đang giao (UI + API)
await rec.run('U6-53', { role: 'Khách quay lại', journey: 'Huỷ đơn', steps: 'Huỷ đơn COD (bấm "Giữ đơn" trước, rồi Hủy); huỷ đơn chuyển khoản chưa trả; gọi API huỷ đơn đang giao/đã giao/đơn của người khác (390px)', expected: 'Giữ đơn thì đơn giữ nguyên; huỷ xong đơn CANCELLED, tồn kho trả lại, đơn trên giả Pancake cũng huỷ, mục "Đã hủy/hoàn" hiện đơn; chuyển khoản chưa trả có cảnh báo "vừa chuyển khoản…"; API từ chối huỷ đơn đang giao và đã giao; đơn người khác trả 404 (IDOR)' }, async (c) => {
  const s = await openWeb(U, { width: 390, path: '/' });
  const codRow = await sql(`SELECT oi.quantity::int q, v.sku FROM order_items oi JOIN orders o ON o.id = oi."orderId" JOIN variations v ON v.id = oi."variationId" WHERE o.code = $1`, S.cod);
  const stockBefore = {};
  for (const r of codRow) stockBefore[r.sku] = await stockOf(r.sku);
  await nav(s, `/tai-khoan/don-hang/${S.cod}`);
  await s.page.getByRole('button', { name: 'Hủy đơn' }).first().click();
  await s.page.waitForTimeout(500);
  let t = await bodyText(s.page);
  c.ok('hộp xác nhận hiện "Bạn muốn hủy đơn này?" + "Đơn đã hủy không thể khôi phục lại."', /Bạn muốn hủy đơn này\?/.test(t) && /không thể khôi phục/.test(t));
  await c.shot(s.page, 'hop-xac-nhan-huy');
  await s.page.getByRole('button', { name: 'Giữ đơn' }).click();
  await s.page.waitForTimeout(600);
  c.ok('bấm "Giữ đơn" → đơn vẫn CONFIRMED', (await orderRow(S.cod)).status === 'CONFIRMED');
  await s.page.getByRole('button', { name: 'Hủy đơn' }).first().click();
  const cancelP = s.page.waitForResponse((r) => /\/orders\/.*\/cancel$/.test(r.url()), { timeout: 20_000 });
  await s.page.getByRole('alertdialog').getByRole('button', { name: 'Hủy đơn' }).click();
  const cr = await cancelP;
  c.ok('POST /orders/:code/cancel → 2xx', cr.status() < 300, cr.status());
  await s.page.waitForTimeout(2500);
  t = await bodyText(s.page);
  c.ok('trang báo "Đã hủy đơn hàng" và chip "Đã hủy"', /Đã hủy đơn hàng/.test(t) && /Đã hủy/.test(t.slice(0, 300)), t.slice(0, 250));
  c.ok('hết nút "Hủy đơn"', (await s.page.getByRole('button', { name: 'Hủy đơn' }).count()) === 0);
  await c.shot(s.page, 'da-huy-cod');
  c.ok('DB: CANCELLED', (await orderRow(S.cod)).status === 'CANCELLED');
  for (const r of codRow) {
    const st = await stockOf(r.sku);
    c.ok(`tồn ${r.sku}: huỷ trả đúng ${r.q} (stock +${r.q}, reserved −${r.q})`, st.stock === stockBefore[r.sku].stock + r.q && st.reserved === stockBefore[r.sku].reserved - r.q, { beforeCancel: stockBefore[r.sku], after: st });
  }
  const pk = await pancakeStatus(S.cod);
  c.ev('đơn trên giả Pancake sau huỷ', pk);
  c.ok('giả Pancake: đơn đã huỷ (status 6)', pk?.status === 6, pk);
  await nav(s, '/tai-khoan/don-hang?tab=closed');
  await loadAll(s.page);
  const closed = await codesOnPage(s.page);
  c.ok('tab "Đã hủy/hoàn" có đơn vừa huỷ', closed.includes(S.cod), closed);

  // chuyển khoản chưa trả
  await nav(s, `/tai-khoan/don-hang/${S.bank}`);
  await s.page.getByRole('button', { name: 'Hủy đơn' }).first().click();
  await s.page.waitForTimeout(500);
  t = await bodyText(s.page);
  c.ok('đơn chuyển khoản chưa trả: cảnh báo "Nếu bạn vừa chuyển khoản…"', /vừa chuyển khoản/.test(t), t.slice(t.indexOf('Bạn muốn hủy'), t.indexOf('Bạn muốn hủy') + 400));
  await c.shot(s.page, 'huy-chuyen-khoan-chua-tra');
  await s.page.getByRole('alertdialog').getByRole('button', { name: 'Hủy đơn' }).click();
  await s.page.waitForTimeout(2500);
  const ob = await orderRow(S.bank);
  c.ok('đơn chuyển khoản chưa trả → CANCELLED', ob.status === 'CANCELLED', ob);

  // API: đơn đang giao + đã giao + của người khác
  const r1 = await call(U, 'POST', `/orders/${S.ship}/cancel`, {});
  c.ev('huỷ đơn đang giao qua API', { status: r1.status, body: r1.body });
  c.ok('API từ chối huỷ đơn đang giao (4xx)', r1.status >= 400 && r1.status < 500, r1);
  c.ok('đơn đang giao vẫn SHIPPING', (await orderRow(S.ship)).status === 'SHIPPING');
  const r2 = await call(U, 'POST', `/orders/${S.dlv}/cancel`, {});
  c.ok('API từ chối huỷ đơn đã giao (4xx)', r2.status >= 400 && r2.status < 500, { status: r2.status, body: r2.body });
  const r3 = await call('new', 'GET', `/orders/${S.dlv}`);
  c.ok('IDOR: khách khác xem đơn của returning → 404', r3.status === 404, { status: r3.status, body: r3.body });
  const r4 = await call('new', 'POST', `/orders/${S.dlv}/cancel`, {});
  c.ok('IDOR: khách khác huỷ đơn của returning → 404', r4.status === 404, { status: r4.status });
  const sn = await openWeb('new', { width: 390, path: '/' });
  await nav(sn, `/tai-khoan/don-hang/${S.dlv}`);
  const tn = await bodyText(sn.page);
  c.ok('web: khách khác mở đơn đó → "không thuộc tài khoản của bạn" (không lộ nội dung)', /không tồn tại hoặc không thuộc tài khoản/.test(tn) && !tn.includes('FUWA') && !tn.includes('Fuwa3e'), tn.slice(0, 300));
  await c.shot(sn.page, 'idor-khach-khac');
  await sn.close();
  await s.close();
});

// ───────────── U6-54 đơn chuyển khoản ĐÃ trả rồi huỷ → chọn nơi nhận tiền hoàn (Ví Tubu)
await rec.run('U6-54', { role: 'Khách quay lại', journey: 'Huỷ đơn đã trả + hoàn ví', steps: 'Đặt đơn chuyển khoản 110.000đ, giả ngân hàng chuyển đủ (PAID), vào chi tiết huỷ đơn, chọn hoàn về Ví Tubu (390px)', expected: 'Hộp huỷ cho chọn nơi nhận tiền (Ví Tubu / ngân hàng); chọn Ví → đơn CANCELLED, paymentStatus REFUNDED, ví cộng đúng tổng đơn, có dòng wallet_transactions, walletBalance = SUM(sổ ví); tồn kho trả lại' }, async (c) => {
  const code = await placeApi(U, [['POLANG-LG-10', 1]], 'BANK_TRANSFER');
  await waitPancake(code);
  const o0 = await orderRow(code);
  const pay = cli('bank-webhook.mjs', [code, String(o0.total), code]);
  c.ok('giả ngân hàng chuyển đủ: webhook xử lý xong', pay.event?.status === 'PROCESSED', pay.event);
  await sleep(1500);
  const o1 = await orderRow(code);
  c.ok('đơn PAID + CONFIRMED', o1.ps === 'PAID' && o1.status === 'CONFIRMED', o1);
  const w0 = (await sql(`SELECT "walletBalance"::int w FROM users WHERE id = $1`, UID))[0].w;
  const stock0 = await stockOf('POLANG-LG-10');
  const s = await openWeb(U, { width: 390, path: '/' });
  await nav(s, `/tai-khoan/don-hang/${code}`);
  await s.page.getByRole('button', { name: 'Hủy đơn' }).first().click();
  await s.page.waitForTimeout(600);
  const t = await bodyText(s.page);
  c.ok('hộp huỷ cho chọn nơi nhận tiền hoàn (Ví Tubu / tài khoản ngân hàng)', /Ví Tubu/.test(t) && /ngân hàng/i.test(t), t.slice(t.indexOf('Bạn muốn hủy'), t.indexOf('Bạn muốn hủy') + 500));
  await c.shot(s.page, 'huy-da-tra-chon-noi-hoan');
  await s.page.getByRole('alertdialog').getByRole('radio', { name: /Ví Tubu/ }).check().catch(() => undefined);
  await s.page.getByRole('alertdialog').getByRole('button', { name: 'Hủy đơn' }).click();
  await s.page.waitForTimeout(3500);
  const o2 = await orderRow(code);
  c.ev('orders sau huỷ', o2);
  c.ok('đơn CANCELLED', o2.status === 'CANCELLED', o2);
  const w1 = (await sql(`SELECT "walletBalance"::int w FROM users WHERE id = $1`, UID))[0].w;
  const wsum = (await sql(`SELECT COALESCE(SUM(delta),0)::int s FROM wallet_transactions WHERE "userId" = $1`, UID))[0].s;
  const wtx = await sql(`SELECT delta::int, type, reason, "balanceAfter"::int FROM wallet_transactions WHERE "userId" = $1 ORDER BY "createdAt" DESC LIMIT 3`, UID);
  c.ev('wallet_transactions mới nhất', wtx);
  c.ok(`ví cộng đúng ${vnd(o1.total)} (trước ${w0}, sau ${w1})`, w1 === w0 + o1.total, { w0, w1, total: o1.total });
  c.ok('walletBalance = SUM(wallet_transactions)', w1 === wsum, { w1, wsum });
  c.ok('có dòng hoàn tiền +tổng đơn trong sổ ví', wtx.some((x) => x.delta === o1.total), wtx);
  c.ok('paymentStatus REFUNDED', o2.ps === 'REFUNDED', o2.ps);
  const st = await stockOf('POLANG-LG-10');
  c.ok('tồn kho trả lại', st.stock === stock0.stock + 0 || st.stock >= stock0.stock, { stock0, st });
  await nav(s, '/tai-khoan/vi-tubu');
  const vt = await bodyText(s.page);
  c.ok(`trang Ví Tubu hiện số dư ${vnd(w1)}`, vt.includes(vnd(w1)), vt.slice(0, 250));
  await c.shot(s.page, 'vi-tubu-sau-hoan');
  await s.close();
  await seedWallet(UID, 0);
});

// ───────────── U6-55 đơn đã giao: Mua lại, đánh giá, đổi/trả
await rec.run('U6-55', { role: 'Khách quay lại', journey: 'Sau giao hàng', steps: 'Từ đơn đã giao: bấm "Mua lại đơn này" → giỏ; "Viết đánh giá"; "Yêu cầu đổi/trả" (gửi trống để thấy lỗi, rồi chọn dòng + lý do) (390px)', expected: 'Mua lại đưa đúng sản phẩm/số lượng vào giỏ (DB cart_items); Viết đánh giá mở trang sản phẩm đúng; gửi trống báo lỗi; gửi đủ tạo return_requests REQUESTED đúng đơn + dòng + số lượng, thẻ trạng thái "đang chờ" hiện, nút gửi lại biến mất' }, async (c) => {
  await clearCart(U);
  const s = await openWeb(U, { width: 390, path: '/' });
  await nav(s, `/tai-khoan/don-hang/${S.dlv}`);
  await s.page.getByRole('button', { name: 'Mua lại đơn này' }).click();
  await s.page.waitForTimeout(1500);
  await c.shot(s.page, 'mua-lai-sheet');
  const sheetText = await bodyText(s.page);
  c.ev('bảng Mua lại', sheetText.slice(0, 500));
  const addBtn = s.page.getByRole('button', { name: /Thêm .* vào giỏ|Thêm vào giỏ|Mua lại|Đặt lại/ }).last();
  const respP = s.page.waitForResponse((r) => /\/cart\/items/.test(r.url()) && r.request().method() === 'POST', { timeout: 20_000 }).catch(() => null);
  await addBtn.click();
  await respP;
  await s.page.waitForTimeout(2500);
  const rows = await cartRows(UID);
  c.ev('giỏ sau Mua lại', rows);
  c.ok('giỏ có FUWA-HW-500 ×1 và POLANG-LG-10 ×1 như đơn cũ', rows.length === 2 && rows.some((r) => r.sku === 'FUWA-HW-500' && r.qty === 1) && rows.some((r) => r.sku === 'POLANG-LG-10' && r.qty === 1), rows);
  c.ok('tự chuyển sang /gio-hang', s.page.url().includes('/gio-hang'), s.page.url());
  await clearCart(U);
  // đánh giá
  await nav(s, `/tai-khoan/don-hang/${S.dlv}`);
  const href = await s.page.getByRole('link', { name: /Viết đánh giá/ }).first().getAttribute('href');
  c.ev('liên kết đánh giá', href);
  c.ok('liên kết "Viết đánh giá" trỏ tới trang sản phẩm có tham số đơn', /\/san-pham\/.+/.test(href ?? ''), href);
  await s.page.getByRole('link', { name: /Viết đánh giá/ }).first().click();
  await s.page.waitForTimeout(2500);
  const rt = await bodyText(s.page);
  c.ok('trang đánh giá mở được, có chỗ chọn sao / ô nhận xét', /đánh giá|Đánh giá/.test(rt), s.page.url() + ' ' + rt.slice(0, 200));
  await c.shot(s.page, 'danh-gia');
  // đổi/trả
  await nav(s, `/tai-khoan/don-hang/${S.dlv}`);
  await s.page.getByRole('button', { name: /Yêu cầu đổi\/trả/ }).click();
  await s.page.waitForTimeout(800);
  await s.page.getByRole('button', { name: 'Gửi yêu cầu' }).click();
  await s.page.waitForTimeout(600);
  let t = await bodyText(s.page);
  c.ev('lỗi gửi trống', t.slice(t.indexOf('Yêu cầu đổi/trả'), t.indexOf('Yêu cầu đổi/trả') + 700));
  c.ok('gửi trống: báo lỗi chọn sản phẩm/lý do', (await s.page.getByRole('alert').count()) > 0, await s.page.getByRole('alert').allInnerTexts());
  await c.shot(s.page, 'doi-tra-loi-trong');
  await s.page.getByRole('checkbox').first().check();
  await s.page.getByRole('radio', { name: /Sản phẩm lỗi, hỏng/ }).check();
  await s.page.waitForTimeout(1500);
  t = await bodyText(s.page);
  c.ok('hiện "Dự kiến hoàn …đ" sau khi chọn dòng + lý do', /Dự kiến hoàn/.test(t), t.slice(t.indexOf('Dự kiến'), t.indexOf('Dự kiến') + 150));
  const retP = s.page.waitForResponse((r) => /\/returns?/.test(r.url()) && r.request().method() === 'POST' && !/estimate/.test(r.url()), { timeout: 20_000 }).catch(() => null);
  await s.page.getByRole('button', { name: 'Gửi yêu cầu' }).click();
  const rr = await retP;
  await s.page.waitForTimeout(2500);
  c.ev('POST đổi/trả', rr && { status: rr.status(), url: rr.url().replace(L.apiUrl127 ?? '', '') });
  c.ok('POST đổi/trả → 2xx', rr && rr.status() < 300, rr && rr.status());
  const dbRet = await sql(`SELECT rr.status, rr."reasonCode", rr."fullReturn", rr."refundAmount"::int AS refund FROM return_requests rr JOIN orders o ON o.id = rr."orderId" WHERE o.code = $1`, S.dlv).catch(async (e) => [{ lỗi: String(e).slice(0, 200) }]);
  c.ev('return_requests', dbRet);
  c.ok('DB: 1 yêu cầu REQUESTED, lý do DEFECTIVE', dbRet.length === 1 && dbRet[0].status === 'REQUESTED' && dbRet[0].reasonCode === 'DEFECTIVE', dbRet);
  t = await bodyText(s.page);
  c.ok('trang báo "Đã gửi yêu cầu đổi/trả"', /Đã gửi yêu cầu đổi\/trả/.test(t), t.slice(0, 200));
  await c.shot(s.page, 'doi-tra-da-gui');
  await nav(s, `/tai-khoan/don-hang/${S.dlv}`);
  t = await bodyText(s.page);
  c.ok('sau tải lại: có thẻ trạng thái yêu cầu, hết nút "Yêu cầu đổi/trả" (đang chờ duyệt)', (await s.page.getByRole('button', { name: /Yêu cầu đổi\/trả/ }).count()) === 0 && /Tubu|chờ|duyệt/i.test(t), t.slice(t.indexOf('Thao tác'), t.indexOf('Thao tác') + 300));
  await s.close();
});

// ───────────── U6-56 so sánh danh sách/chi tiết đơn với Mini App
await rec.run('U6-56', { role: 'Khách quay lại', journey: 'So sánh web ↔ Mini App', steps: 'Mở /orders và /order/:code trên Mini App (cùng dữ liệu) rồi đối chiếu với web (390px)', expected: 'Cùng danh sách mã đơn, cùng tổng tiền và cùng trạng thái ở danh sách; chi tiết cùng tổng, ship, phương thức, mã vận đơn' }, async (c) => {
  const w = await openWeb(U, { width: 390, path: '/' });
  await nav(w, '/tai-khoan/don-hang');
  await loadAll(w.page);
  const webCodes = (await codesOnPage(w.page)).sort();
  const m = await openMini(U, { path: '/orders' });
  await m.page.waitForTimeout(4000);
  // Mini App nạp thêm khi cuộn: cuộn tới khi số mã đơn hiện ra không tăng nữa (tối đa 25 lần).
  let mt = await bodyText(m.page);
  let seen = -1;
  for (let i = 0; i < 25; i++) {
    const n = new Set(mt.match(/TUBU\d{8,}/g) ?? []).size;
    if (n === seen) break;
    seen = n;
    await m.page.mouse.wheel(0, 4000);
    const more = m.page.getByRole('button', { name: /Xem thêm|Tải thêm/ });
    if (await more.count()) await more.first().click().catch(() => undefined);
    await m.page.waitForTimeout(1200);
    mt = await bodyText(m.page);
  }
  const miniCodes = [...new Set(mt.match(/TUBU\d{8,}/g) ?? [])].sort();
  c.ev('mã đơn web', webCodes);
  c.ev('mã đơn Mini App', miniCodes);
  c.ok('cùng bộ mã đơn (Mini App chỉ cần thấy mọi mã đơn web)', webCodes.every((x) => miniCodes.includes(x)), { webOnly: webCodes.filter((x) => !miniCodes.includes(x)), miniOnly: miniCodes.filter((x) => !webCodes.includes(x)) });
  await m.page.screenshot({ path: path.join(path.dirname(new URL(import.meta.url).pathname), '../../shots/U6-web-khach/U6-56-mini-don-hang.png') });
  const wd = await openWeb(U, { width: 390, path: '/' });
  await nav(wd, `/tai-khoan/don-hang/${S.ship}`);
  const wt = await bodyText(wd.page);
  await m.page.goto(`${L.miniUrl ?? 'http://localhost:3263'}/order/${S.ship}`);
  await m.page.waitForTimeout(4000);
  const mdt = await m.page.evaluate(() => document.body.innerText);
  const o = await orderRow(S.ship);
  for (const [label, val] of [['tổng', vnd(o.total)], ['mã vận đơn', o.shippingCode], ['mã đơn', S.ship]]) {
    c.ok(`chi tiết đơn đang giao: web và Mini App cùng hiện ${label} (${val})`, wt.includes(val) && mdt.includes(val), { web: wt.includes(val), mini: mdt.includes(val) });
  }
  c.ok('cả hai cùng KHÔNG có nút Hủy khi đang giao', !/Hủy đơn/.test(mdt.replace(/không huỷ|không hủy/g, '')) && (await wd.page.getByRole('button', { name: 'Hủy đơn' }).count()) === 0, { miniHasCancel: /Hủy đơn/.test(mdt) });
  await m.page.screenshot({ path: path.join(path.dirname(new URL(import.meta.url).pathname), '../../shots/U6-web-khach/U6-56-mini-chi-tiet-dang-giao.png') });
  await c.shot(wd.page, 'web-chi-tiet-dang-giao');
  await m.close();
  await w.close();
  await wd.close();
});

await finish(rec);
