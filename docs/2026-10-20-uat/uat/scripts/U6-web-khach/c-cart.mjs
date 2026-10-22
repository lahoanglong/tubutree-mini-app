// Nhóm C: giỏ hàng của khách quay lại (uat_returning, hạng Lộc Biếc) trên web: thêm từ PDP, đổi số lượng, xoá + hoàn tác,
// tồn kho, giờ vàng, mua một phần giỏ, giỏ giống Mini App. Đối chiếu DB (cart_items) và API /cart.
import { L, Recorder, finish, openWeb, openMini, nav, bodyText, badReqs, overflowX, sql, call, clearCart, cartRows, addViaPdp, digits, vnd, sleep } from './_lib.mjs';

const rec = new Recorder('c-cart');
const U = 'returning';
const UID = 'uat_returning';
const WIDTHS = [390, 1440];

const lineRegion = (s, name) => s.page.locator('li, div').filter({ hasText: name }).last();

for (const w of WIDTHS) {
  const s = await openWeb(U, { width: w, path: '/' });

  await rec.run(`U6-20-${w}`, { role: 'Khách quay lại (Lộc Biếc)', journey: 'Giỏ', steps: `PDP nước rửa tay (${w}px): Thêm vào giỏ ×1 rồi ×2 nữa; mở /gio-hang`, expected: 'Giỏ chỉ có 1 dòng FUWA-HW-500 số lượng 3 (gộp dòng), thành tiền 267.000đ = 3 × 89.000đ; DB cart_items khớp; badge giỏ ở header hiện 3; thông báo "Đã thêm vào giỏ!"' }, async (c) => {
    await clearCart(U);
    const r1 = await addViaPdp(s, 'nuoc-rua-tay-fuwa3e', { qty: 1 });
    c.ok('POST /cart/items lần 1 → 2xx', r1.status >= 200 && r1.status < 300, r1.status);
    c.ok('hiện "Đã thêm vào giỏ!"', /Đã thêm vào giỏ/.test(await bodyText(s.page)));
    await c.shot(s.page, `pdp-da-them-${w}`);
    const r2 = await addViaPdp(s, 'nuoc-rua-tay-fuwa3e', { qty: 2 });
    c.ok('POST /cart/items lần 2 → 2xx', r2.status >= 200 && r2.status < 300, r2.status);
    const db = await cartRows(UID);
    c.ev('DB cart_items', db);
    c.ok('DB: 1 dòng FUWA-HW-500 × 3', db.length === 1 && db[0].sku === 'FUWA-HW-500' && db[0].qty === 3, db);
    const r = await nav(s, '/gio-hang');
    const t = await bodyText(s.page);
    c.ok('cart page: có sản phẩm + số lượng 3', /Nước rửa tay sinh học Fuwa3e/.test(t) && /\n3\n/.test(t), t.slice(0, 300));
    c.ok('cart page: thành tiền 267.000đ', t.includes('267.000đ'), t.slice(0, 400));
    c.ok('cart page: API không lỗi', badReqs(r.reqs).length === 0, badReqs(r.reqs));
    const ox = await overflowX(s.page);
    c.ok('không tràn ngang', ox.sw <= ox.iw + 1, ox);
    const badge = await s.page.locator('header').first().innerText();
    c.ok('badge giỏ ở header = 3', /(^|\s)3(\s|$)/.test(badge), badge.replace(/\n/g, ' | ').slice(0, 120));
    await c.shot(s.page, `gio-hang-${w}`);
  });

  await rec.run(`U6-21-${w}`, { role: 'Khách quay lại (Lộc Biếc)', journey: 'Giỏ', steps: `Giỏ có 2 dòng (nước rửa tay ×1, dầu tràm bé ×2) (${w}px): bấm Tăng, Giảm, Xoá rồi Hoàn tác`, expected: 'Mỗi thao tác cập nhật server ngay (DB khớp); tạm tính = Σ đơn giá × số lượng; Giảm ở 1 không xuống 0; Xoá có thanh "Đã bỏ khỏi giỏ" và Hoàn tác trả lại đúng dòng/số lượng' }, async (c) => {
    await clearCart(U);
    await call(U, 'POST', '/cart/items', { variationId: (await sql(`SELECT id FROM variations WHERE sku='FUWA-HW-500'`))[0].id, quantity: 1 });
    await call(U, 'POST', '/cart/items', { variationId: (await sql(`SELECT id FROM variations WHERE sku='COBOTE-TR-50'`))[0].id, quantity: 2 });
    await nav(s, '/gio-hang');
    const inc = s.page.getByRole('button', { name: 'Tăng số lượng Nước rửa tay sinh học Fuwa3e' });
    const dec = s.page.getByRole('button', { name: 'Giảm số lượng Nước rửa tay sinh học Fuwa3e' });
    await inc.click();
    await s.page.waitForTimeout(1200);
    let db = await cartRows(UID);
    c.ok('Tăng → DB FUWA-HW-500 = 2', db.find((x) => x.sku === 'FUWA-HW-500')?.qty === 2, db);
    let t = await bodyText(s.page);
    // tạm tính = 2×89000 + 2×89000 = 356.000đ
    c.ok('tạm tính 356.000đ sau khi tăng', t.includes('356.000đ'), t.slice(0, 500));
    await dec.click();
    await s.page.waitForTimeout(1200);
    await dec.click().catch(() => undefined);
    await s.page.waitForTimeout(1200);
    db = await cartRows(UID);
    c.ok('Giảm 2 lần không đưa số lượng xuống dưới 1', db.find((x) => x.sku === 'FUWA-HW-500')?.qty === 1, db);
    await s.page.getByRole('button', { name: /^(Xóa|Xoá) Dầu tràm cho bé Cobote khỏi giỏ hàng$/ }).click();
    await s.page.waitForTimeout(1500);
    db = await cartRows(UID);
    c.ok('Xoá → DB chỉ còn FUWA-HW-500', db.length === 1 && db[0].sku === 'FUWA-HW-500', db);
    t = await bodyText(s.page);
    c.ok('hiện thanh "Đã bỏ khỏi giỏ"', /Đã bỏ khỏi giỏ/.test(t), t.slice(0, 300));
    await c.shot(s.page, `xoa-hoan-tac-${w}`);
    await s.page.getByRole('button', { name: /Hoàn tác/ }).click();
    await s.page.waitForTimeout(1500);
    db = await cartRows(UID);
    c.ok('Hoàn tác → DB lại có COBOTE-TR-50 × 2', db.find((x) => x.sku === 'COBOTE-TR-50')?.qty === 2 && db.length === 2, db);
    const api = await call(U, 'GET', '/cart');
    const expected = db.reduce((a, x) => a + (x.sale ?? x.retail) * x.qty, 0);
    c.ok('API /cart subtotal = Σ DB', api.body?.subtotal === expected, { api: api.body?.subtotal, expected });
    c.ok('trang hiện đúng tạm tính', (await bodyText(s.page)).includes(vnd(expected)), vnd(expected));
  });

  await rec.run(`U6-22-${w}`, { role: 'Khách quay lại (Lộc Biếc)', journey: 'Giỏ', steps: `Tồn kho: đặt tồn VIS-SR-50 = 3 (SQL); PDP Serum 50ml tăng số lượng quá tồn; thêm giỏ; rồi tồn về 0 khi đã ở giỏ (${w}px)`, expected: 'PDP nhắc "Chỉ còn 3", bộ đếm không vượt 3; thêm quá tồn bị từ chối bằng thông báo; khi tồn về 0 giỏ chặn thanh toán kèm lời giải thích và nút Thanh toán khoá; PDP hết hàng hiện "Hết hàng"' }, async (c) => {
    await clearCart(U);
    await sql(`UPDATE variations SET stock = 3 WHERE sku = 'VIS-SR-50'`);
    try {
      await nav(s, '/san-pham/serum-duong-am-visante');
      await s.page.getByRole('button', { name: /50ml/ }).first().click();
      let t = await bodyText(s.page);
      c.ok('PDP nhắc "Chỉ còn 3 sản phẩm"', /Chỉ còn 3 sản phẩm/.test(t), t.slice(0, 400));
      for (let i = 0; i < 6; i++) await s.page.getByRole('button', { name: 'Tăng số lượng' }).click();
      const shown = await s.page.locator('[aria-live="polite"]').filter({ hasText: /^\d+$/ }).first().innerText();
      c.ok('bộ đếm số lượng dừng ở 3', shown.trim() === '3', shown);
      const r = await addViaPdp(s, 'serum-duong-am-visante', { qty: 3, variantRe: /50ml/ });
      c.ok('thêm 3 (đúng tồn) → 2xx', r.status >= 200 && r.status < 300, r.status);
      // ép thêm lần nữa qua API: vượt tồn phải bị từ chối
      const vid = (await sql(`SELECT id FROM variations WHERE sku='VIS-SR-50'`))[0].id;
      const over = await call(U, 'POST', '/cart/items', { variationId: vid, quantity: 1 });
      c.ok('API từ chối thêm quá tồn (4xx)', over.status >= 400 && over.status < 500, { status: over.status, body: over.body });
      c.ev('lời từ chối', over.body);
      // tồn về 0 khi đã ở giỏ
      await sql(`UPDATE variations SET stock = 0 WHERE sku = 'VIS-SR-50'`);
      await nav(s, '/gio-hang');
      t = await bodyText(s.page);
      c.ok('giỏ báo hết hàng / vượt tồn', /hết hàng|vượt|Chỉ còn/i.test(t), t.slice(0, 500));
      const pay = s.page.getByRole('link', { name: /Thanh toán/ }).or(s.page.getByRole('button', { name: /Thanh toán/ })).first();
      const disabled = await pay.evaluate((el) => el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true' || el.classList.contains('pointer-events-none')).catch(() => null);
      c.ok('nút Thanh toán bị khoá', disabled === true, { disabled });
      await c.shot(s.page, `het-hang-trong-gio-${w}`);
      await nav(s, '/san-pham/serum-duong-am-visante');
      await s.page.getByRole('button', { name: /50ml/ }).first().click();
      t = await bodyText(s.page);
      c.ok('PDP hiện "Hết hàng"', /Hết hàng/.test(t), t.slice(0, 300));
      await c.shot(s.page, `pdp-het-hang-${w}`);
    } finally {
      await sql(`UPDATE variations SET stock = 30 WHERE sku = 'VIS-SR-50'`);
      await clearCart(U);
    }
  });

  await rec.run(`U6-23-${w}`, { role: 'Khách quay lại (Lộc Biếc)', journey: 'Giỏ', steps: `Giờ vàng trong giỏ: thêm Cao cà gai leo (flash 165.000đ, mỗi người tối đa 2) ×1 rồi cố thêm tới 3 (${w}px)`, expected: 'Giỏ tính 165.000đ/chiếc (không phải 220.000đ), thành tiền 165.000đ; khi vượt giới hạn 2 chiếc giờ vàng/người thì có lời nhắc rõ "giảm còn 2 để được giá giờ vàng, hoặc mua 3 với giá thường" và cả dòng tính giá thường (660.000đ)' }, async (c) => {
    await clearCart(U);
    // Giới hạn giờ vàng cộng dồn theo người, đúng nguồn API dùng (flash-sale.service.ts resolveEffective): perUserLimit trừ
    // flash_sale_purchases.quantity, và không vượt số suất còn của đợt. Lane đã chạy U6-39 (mua 1 chiếc giờ vàng) thì còn 1.
    const lim = (await sql(`SELECT fi."perUserLimit"::int AS lim, (fi.quota - fi."soldCount")::int AS quota_left, COALESCE((SELECT p.quantity FROM flash_sale_purchases p WHERE p."flashSaleItemId" = fi.id AND p."userId" = 'uat_returning'), 0)::int AS bought FROM flash_sale_items fi JOIN variations v ON v.id = fi."variationId" WHERE v.sku = 'BHN-CGL-100'`))[0];
    const allow = Math.min(lim.quota_left, Math.max(0, lim.lim - lim.bought));
    c.ev('giới hạn giờ vàng của khách', { ...lim, allow });
    const r = await addViaPdp(s, 'cao-ca-gai-leo-bhnong', { qty: 1 });
    c.ok('thêm giờ vàng → 2xx', r.status >= 200 && r.status < 300, r.status);
    await nav(s, '/gio-hang');
    let t = await bodyText(s.page);
    c.ok('giỏ hiện 165.000đ', t.includes('165.000đ'), t.slice(0, 400));
    c.ok('giỏ không tính 220.000đ cho dòng giờ vàng', !/Tạm tính\s*\n?\s*220\.000đ/.test(t));
    const api = await call(U, 'GET', '/cart');
    c.ok('API: unitPrice 165000, isFlash', api.body?.items?.[0]?.unitPrice === 165000 && api.body.items[0].isFlash === true, api.body?.items?.[0] && { unitPrice: api.body.items[0].unitPrice, isFlash: api.body.items[0].isFlash });
    await c.shot(s.page, `gio-gio-vang-${w}`);
    const vid = (await sql(`SELECT id FROM variations WHERE sku='BHN-CGL-100'`))[0].id;
    for (const q of [1, 1]) await call(U, 'POST', '/cart/items', { variationId: vid, quantity: q });
    const api3 = await call(U, 'GET', '/cart');
    const it = api3.body?.items?.[0];
    c.ev('giỏ khi có 3 chiếc', { qty: it?.quantity, unitPrice: it?.unitPrice, total: it?.total, limitNotice: it?.flashLimitNotice, subtotal: api3.body?.subtotal });
    // Luật của app: vượt giới hạn thì CẢ dòng tính giá thường (3 × 220.000) kèm lời nhắc giảm còn 2 để được giá giờ vàng.
    c.ok('3 chiếc: cả dòng tính giá thường 660.000đ và có lời nhắc giới hạn giờ vàng', api3.body?.subtotal === 3 * 220000 && new RegExp(`tối đa ${allow}\\b`).test(it?.flashLimitNotice ?? ''), { subtotal: api3.body?.subtotal, notice: it?.flashLimitNotice });
    await nav(s, '/gio-hang');
    t = await bodyText(s.page);
    c.ok('giỏ hiện thông báo giới hạn giờ vàng', /giới hạn|tối đa|Giờ vàng/i.test(t) && new RegExp(`tối đa ${allow}\\b`).test(t), t.slice(0, 500));
    await c.shot(s.page, `gio-vuot-gioi-han-gio-vang-${w}`);
    await clearCart(U);
  });

  await s.close();
}

// ───────────── U6-24 giỏ web = giỏ Mini App
await rec.run('U6-24', { role: 'Khách quay lại (Lộc Biếc)', journey: 'Giỏ', steps: 'Thêm 2 món bằng web (nước rửa tay ×2, serum 30ml ×1); mở Mini App /cart cùng tài khoản; đổi số lượng trên Mini App rồi tải lại web', expected: 'Mini App và web cùng giỏ: cùng 2 dòng, cùng số lượng, cùng tạm tính; đổi bên này thì bên kia thấy sau khi tải lại' }, async (c) => {
  await clearCart(U);
  const s = await openWeb(U, { width: 390, path: '/' });
  await addViaPdp(s, 'nuoc-rua-tay-fuwa3e', { qty: 2 });
  await addViaPdp(s, 'serum-duong-am-visante', { qty: 1, variantRe: /30ml/ });
  await nav(s, '/gio-hang');
  const webText = await bodyText(s.page);
  const sub = (await call(U, 'GET', '/cart')).body?.subtotal;
  c.ev('tạm tính theo API', sub);
  const m = await openMini(U, { path: '/cart' });
  await m.page.waitForTimeout(3500);
  const miniText = await m.page.evaluate(() => document.body.innerText);
  c.ev('chữ Mini App /cart', miniText.replace(/\n+/g, ' | ').slice(0, 500));
  await c.shot(m.page, 'mini-gio-hang');
  c.ok('Mini App có "Nước rửa tay sinh học Fuwa3e"', /Nước rửa tay sinh học Fuwa3e/.test(miniText));
  c.ok('Mini App có "Serum dưỡng ẩm Visante"', /Serum dưỡng ẩm Visante/.test(miniText));
  c.ok('Mini App hiện tạm tính giống web (467.000đ)', miniText.includes(vnd(sub)) && webText.includes(vnd(sub)), { sub: vnd(sub) });
  // Đổi số lượng trên Mini App bằng API của Mini App (cùng endpoint): tăng nước rửa tay lên 3 qua nút giao diện nếu tìm được.
  const incBtn = m.page.getByRole('button', { name: /Tăng|\+/ }).first();
  if (await incBtn.count()) {
    await incBtn.click();
    await m.page.waitForTimeout(1500);
    const db = await cartRows(UID);
    c.ev('DB sau khi bấm + trên Mini App', db);
    await nav(s, '/gio-hang');
    const t2 = await bodyText(s.page);
    const total = db.reduce((a, x) => a + (x.sale ?? x.retail) * x.qty, 0);
    c.ok('web thấy thay đổi từ Mini App sau khi tải lại (tạm tính khớp DB)', t2.includes(vnd(total)), { total: vnd(total) });
  } else c.note('không tìm thấy nút + trên Mini App');
  await m.close();
  await s.close();
  await clearCart(U);
});

await finish(rec);
