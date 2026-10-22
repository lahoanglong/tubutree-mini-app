#!/usr/bin/env node
// U1 nhóm B: trang chủ khách mới/khách quay lại, duyệt, tìm kiếm, lọc, sắp xếp, chi tiết SP, giỏ (sửa số lượng, xoá, hết hàng).
// Chạy: node u1-b-browse-cart.mjs [U1-06 ...]
import {
  L, BROWSER, open, sql, api, freshCustomer, addToCart, variation, shot, runCases, dismissOnboarding, waitApi,
} from './u1-lib.mjs';

/** Thứ tự xuất hiện (trên trang) của các vùng có tên. */
async function regionOrder(page, names) {
  const out = {};
  for (const n of names) {
    const r = page.getByRole('region', { name: n, exact: true });
    out[n] = (await r.count()) ? (await r.first().boundingBox())?.y ?? null : null;
  }
  return out;
}

/** Ghi lại mọi response GET /products (danh sách) trang nhận được. */
function productFeed(page) {
  const seen = [];
  page.on('response', async (r) => {
    const u = new URL(r.url());
    if (r.request().method() !== 'GET' || u.pathname !== '/api/products') return;
    try {
      seen.push({ query: Object.fromEntries(u.searchParams), body: await r.json() });
    } catch { /* bỏ */ }
  });
  return seen;
}
const lastFeed = (seen, pred = () => true) => [...seen].reverse().find((x) => pred(x.query));
const itemsOf = (resp) => resp?.body?.items ?? resp?.body?.data ?? [];
// Giá đang bán của thẻ SP (ProductTile): salePrice ?? basePrice (catalog.service.ts toCard).
const priceOf = (p) => p.salePrice ?? p.basePrice;

const cases = [
  {
    id: 'U1-06',
    role: 'Khách mới (vừa nhận voucher chào mừng) / Khách quay lại',
    journey: 'Trang chủ bố cục khách mới (home.new_customer_layout bật)',
    steps: 'Khách mới mở / → đọc thứ tự vùng; khách quay lại uat_returning mở / → đọc thứ tự vùng',
    expected:
      'Khách mới: "Quà khách mới" (có voucher chào mừng 30.000đ, freeship đơn đầu từ 199.000đ, 2% Điểm Xanh) đứng trước "Danh mục", "Danh mục" trước "Ưu đãi giờ vàng". Khách quay lại: không có "Quà khách mới", có vùng "Mua lại"',
    async run(c) {
      const [cfg] = await sql(`SELECT value FROM system_configs WHERE key = 'home.new_customer_layout'`);
      c.evidence('SQL home.new_customer_layout', cfg);
      const u = await freshCustomer('b06', { welcome: true });
      let s = await open(L.n, u.id, { browser: BROWSER, path: '/' });
      try {
        await dismissOnboarding(s.page);
        const gift = s.page.getByRole('region', { name: 'Quà khách mới' });
        await gift.waitFor({ timeout: 15_000 });
        const order = await regionOrder(s.page, ['Quà khách mới', 'Danh mục', 'Ưu đãi giờ vàng', 'Bán chạy']);
        c.evidence('khách mới: toạ độ y các vùng', order);
        c.evidence('ảnh', await shot(s.page, 'U1-06-home-new'));
        const giftText = await gift.innerText();
        c.evidence('chữ vùng Quà khách mới', giftText);
        c.check('khách mới: Quà khách mới < Danh mục < Ưu đãi giờ vàng', order['Quà khách mới'] < order['Danh mục'] && order['Danh mục'] < order['Ưu đãi giờ vàng'], order);
        c.check('Quà khách mới nêu voucher chào mừng 30.000đ đơn từ 199.000đ', /Mã giảm giá chào mừng 30\.000đ/.test(giftText) && /199\.000đ/.test(giftText));
        c.check('Quà khách mới nêu freeship đơn đầu từ 199.000đ', giftText.includes('Miễn phí giao hàng cho đơn đầu tiên từ 199.000đ'));
        c.check('Quà khách mới nêu 2% Điểm Xanh, 1 điểm = 1đ', giftText.includes('2% tiền hàng thành Điểm Xanh, 1 điểm = 1đ'));
      } finally {
        await s.close();
      }
      s = await open(L.n, 'returning', { browser: BROWSER, path: '/' });
      try {
        await s.page.getByRole('region', { name: 'Mua lại' }).waitFor({ timeout: 15_000 });
        const order = await regionOrder(s.page, ['Quà khách mới', 'Mua lại', 'Danh mục', 'Ưu đãi giờ vàng']);
        c.evidence('khách quay lại: toạ độ y các vùng', order);
        c.evidence('ảnh', await shot(s.page, 'U1-06-home-returning'));
        c.check('khách quay lại: không có Quà khách mới, có Mua lại', order['Quà khách mới'] === null && order['Mua lại'] !== null, order);
      } finally {
        await s.close();
      }
    },
  },
  {
    id: 'U1-07',
    role: 'Khách mới',
    journey: 'Duyệt, tìm kiếm (có dấu/không dấu), lọc, sắp xếp',
    steps:
      '/browse → gõ "mat ong" → bấm "Tìm “mat ong”"; xoá → chọn danh mục "Tẩy rửa sinh học"; xoá danh mục → sắp xếp "Giá tăng"; Bộ lọc → "Dưới 100k" → "Xem N sản phẩm"',
    expected:
      'Tìm không dấu ra "Mật ong rừng nguyên chất BH.Nong"; danh mục chỉ ra SP thuộc danh mục đó (đối chiếu DB); "Giá tăng" theo giá bán tăng dần; lọc "Dưới 100k" chỉ ra SP giá < 100.000đ; số đếm khớp danh sách',
    async run(c) {
      const u = await freshCustomer('b07');
      const s = await open(L.n, u.id, { browser: BROWSER, path: '/browse' });
      const feed = productFeed(s.page);
      try {
        const p = s.page;
        await dismissOnboarding(p);
        const box = p.getByRole('searchbox', { name: 'Tìm sản phẩm' });
        await box.fill('mat ong');
        await p.getByRole('button', { name: /Tìm “mat ong”/ }).click();
        await p.waitForTimeout(1500);
        const sr = lastFeed(feed, (q) => (q.q ?? q.search ?? q.keyword ?? '').includes('mat ong'));
        const names = itemsOf(sr).map((x) => x.name);
        c.evidence('GET /products tìm "mat ong"', { query: sr?.query, names });
        c.evidence('ảnh', await shot(p, 'U1-07-search'));
        c.check('tìm không dấu "mat ong" ra Mật ong rừng nguyên chất BH.Nong', names.includes('Mật ong rừng nguyên chất BH.Nong'), names);
        c.check('kết quả hiện trên màn', await p.getByRole('button', { name: 'Mật ong rừng nguyên chất BH.Nong' }).first().isVisible());

        await s.goto('/browse');
        const feed2 = productFeed(p);
        await dismissOnboarding(p);
        await p.getByRole('region', { name: 'Danh mục' }).getByRole('button', { name: 'Tẩy rửa sinh học' }).click();
        await p.waitForTimeout(1500);
        const cr = lastFeed(feed2, (q) => q.category || q.categoryId || q.categorySlug);
        const catNames = itemsOf(cr).map((x) => x.name);
        const [cat] = await sql(`SELECT id, slug FROM categories WHERE name = 'Tẩy rửa sinh học'`);
        const dbNames = (await sql(`SELECT name FROM products WHERE "isActive" AND $1 = ANY("categoryIds") ORDER BY name`, cat?.id)).map((r) => r.name);
        c.evidence('danh mục Tẩy rửa sinh học: API vs DB', { query: cr?.query, api: [...catNames].sort(), db: dbNames });
        c.evidence('ảnh', await shot(p, 'U1-07-category'));
        c.check('danh mục: tập SP = DB (SP đang bán của danh mục)', JSON.stringify([...catNames].sort()) === JSON.stringify(dbNames), { api: catNames.length, db: dbNames.length });

        await s.goto('/browse');
        const feed3 = productFeed(p);
        await dismissOnboarding(p);
        await p.getByRole('group', { name: 'Sắp xếp' }).getByRole('button', { name: 'Giá tăng' }).click();
        await p.waitForTimeout(1500);
        const so = lastFeed(feed3, (q) => q.sort);
        const list = itemsOf(so).map((x) => ({ name: x.name, basePrice: x.basePrice, salePrice: x.salePrice, price: priceOf(x) }));
        const prices = list.map((x) => x.price);
        const inversions = list.flatMap((x, i) => (i > 0 && list[i - 1].price > x.price ? [`${list[i - 1].name} ${list[i - 1].price} > ${x.name} ${x.price}`] : []));
        c.evidence('sắp xếp Giá tăng (trang 1)', { query: so?.query, list: list.slice(0, 16), inversions });
        c.evidence('ảnh', await shot(p, 'U1-07-sort-price-asc'));
        c.check('Giá tăng: giá đang bán (salePrice ?? basePrice, giá khách thấy) không giảm qua trang 1', prices.length > 5 && inversions.length === 0, inversions);

        await p.getByRole('button', { name: 'Bộ lọc' }).click();
        await p.getByRole('group', { name: 'Khoảng giá' }).getByRole('button', { name: 'Dưới 100k' }).click();
        await p.waitForTimeout(800);
        const seeBtn = p.getByRole('button', { name: /^Xem \d+ sản phẩm$/ });
        const seeText = await seeBtn.innerText();
        await seeBtn.click();
        await p.waitForTimeout(1500);
        const fr = lastFeed(feed3, (q) => q.maxPrice || q.priceMax);
        const fp = itemsOf(fr).map((x) => ({ name: x.name, price: priceOf(x) }));
        const total = fr?.body?.total ?? fr?.body?.meta?.total;
        c.evidence('lọc Dưới 100k', { button: seeText, query: fr?.query, total, items: fp });
        c.evidence('ảnh', await shot(p, 'U1-07-filter-under-100k'));
        c.check('lọc Dưới 100k: mọi SP giá < 100.000đ', fp.length > 0 && fp.every((x) => x.price < 100_000), fp.filter((x) => x.price >= 100_000));
        c.check('số trên nút "Xem N sản phẩm" = total API', seeText.includes(String(total)), { seeText, total });
        c.check('không lỗi API', s.requests.every((r) => r.status < 400), s.requests.filter((r) => r.status >= 400));
      } finally {
        await s.close();
      }
    },
  },
  {
    id: 'U1-08',
    role: 'Khách mới',
    journey: 'Chi tiết SP (giá, giá giờ vàng, điểm dự kiến) → thêm vào giỏ số lượng 2',
    steps: 'Mở /product/hat-dieu-rang-moc-bhnong (giờ vàng) và /product/nuoc-rua-chen-fuwa3e → tăng số lượng lên 2 → "Thêm vào giỏ"',
    expected:
      'Giờ vàng hiện 119.000đ và giá gạch nhất quán với dải giờ vàng trang chủ; SP thường hiện 120.000đ, "Nhận tối đa 2.400 Điểm Xanh" (2% × hạng Mầm Xanh ×1); sau thêm: cart_items quantity 2, badge giỏ cập nhật',
    async run(c) {
      const u = await freshCustomer('b08');
      const s = await open(L.n, u.id, { browser: BROWSER, path: '/product/hat-dieu-rang-moc-bhnong' });
      try {
        const p = s.page;
        await dismissOnboarding(p);
        await p.getByRole('heading', { level: 1 }).waitFor();
        const flashText = await p.locator('main').innerText();
        c.evidence('ảnh', await shot(p, 'U1-08-pd-flash'));
        const head = flashText.split('\n').slice(0, 12).join(' | ');
        c.evidence('chữ đầu trang SP giờ vàng', head);
        c.check('giá giờ vàng 119.000đ hiện ở chi tiết', head.includes('119.000đ'));
        const v = await variation('BHN-CW-500');
        c.evidence('DB variation BHN-CW-500', { retailPrice: v.retailPrice, salePrice: v.salePrice });
        // Dải giờ vàng trang chủ gạch 159.000đ (-25%), thẻ SP gạch 180.000đ (-34%): ghi lại giá gạch ở chi tiết để so.
        const struck = /119\.000đ\s*\|?\s*(\d{3}\.000đ)/.exec(head.replace(/\n/g, ' '))?.[1] ?? null;
        c.evidence('giá gạch ở chi tiết', struck);
        await s.goto('/product/nuoc-rua-chen-fuwa3e');
        await dismissOnboarding(p);
        const txt = await p.locator('main').innerText();
        c.check('SP thường 120.000đ + "Nhận tối đa 2.400 Điểm Xanh"', txt.includes('120.000đ') && txt.includes('Nhận tối đa 2.400 Điểm Xanh'), txt.split('\n').slice(0, 8));
        await p.getByRole('button', { name: 'Tăng số lượng' }).click();
        const add = waitApi(p, 'POST', /\/api\/cart\/items$/);
        await p.getByRole('button', { name: 'Thêm vào giỏ', exact: true }).click();
        const r = await add;
        c.check('POST /cart/items 201', r.status() < 300, r.status());
        const rows = await sql(
          `SELECT v.sku, ci.quantity FROM cart_items ci JOIN carts ct ON ct.id = ci."cartId" JOIN variations v ON v.id = ci."variationId" WHERE ct."userId" = $1`,
          u.id,
        );
        c.evidence('SQL cart_items', rows);
        c.check('DB: giỏ có FUWA-DW-1L × 2', rows.length === 1 && rows[0].sku === 'FUWA-DW-1L' && rows[0].quantity === 2);
        await p.waitForTimeout(800);
        c.check('badge "Xem giỏ hàng" = 2', (await p.getByRole('button', { name: 'Xem giỏ hàng' }).innerText()).includes('2'));
        c.evidence('ảnh', await shot(p, 'U1-08-pd-added'));
      } finally {
        await s.close();
      }
    },
  },
  {
    id: 'U1-09',
    role: 'Khách mới',
    journey: 'Giỏ: tăng/giảm số lượng, xoá dòng',
    steps: 'Giỏ có FUWA-GL-500×1 + SOK-RC-1KG×1 → "Tăng số lượng" FUWA-GL-500 → "Giảm số lượng" → "Xoá" SOK-RC-1KG',
    expected: 'Mỗi thao tác gọi PATCH/DELETE thật, DB cart_items đổi theo; tạm tính trên màn = tổng DB (79k×n + 75k)',
    async run(c) {
      const u = await freshCustomer('b09');
      await addToCart(u.id, 'FUWA-GL-500', 1);
      await addToCart(u.id, 'SOK-RC-1KG', 1);
      const s = await open(L.n, u.id, { browser: BROWSER, path: '/cart' });
      const dbCart = () =>
        sql(
          `SELECT v.sku, ci.quantity FROM cart_items ci JOIN carts ct ON ct.id = ci."cartId" JOIN variations v ON v.id = ci."variationId" WHERE ct."userId" = $1 ORDER BY v.sku`,
          u.id,
        );
      const subtotalText = async () => (await s.page.locator('main').innerText()).match(/Tạm tính[^\n]*\n?\s*([\d.]+đ)/)?.[1] ?? null;
      try {
        const p = s.page;
        await dismissOnboarding(p);
        const row = (name) =>
          p.locator('div').filter({ has: p.getByRole('button', { name: `Xoá ${name}`, exact: true }) }).filter({ has: p.getByRole('checkbox', { name: `Chọn ${name}` }) }).last();
        const gl = row('Nước lau kính enzyme Fuwa3e');
        let w = waitApi(p, 'PATCH', /\/api\/cart\/items\/[^/]+$/);
        await gl.getByRole('button', { name: 'Tăng số lượng' }).click();
        await w;
        await p.waitForTimeout(500);
        let db = await dbCart();
        c.evidence('sau tăng', { db, ui: await subtotalText() });
        c.check('tăng: FUWA-GL-500 = 2 trong DB', db.find((x) => x.sku === 'FUWA-GL-500')?.quantity === 2);
        c.check('tạm tính 233.000đ (79k×2+75k)', (await subtotalText()) === '233.000đ', await subtotalText());
        w = waitApi(p, 'PATCH', /\/api\/cart\/items\/[^/]+$/);
        await gl.getByRole('button', { name: 'Giảm số lượng' }).click();
        await w;
        await p.waitForTimeout(500);
        db = await dbCart();
        c.check('giảm: FUWA-GL-500 = 1 trong DB', db.find((x) => x.sku === 'FUWA-GL-500')?.quantity === 1, db);
        w = waitApi(p, 'DELETE', /\/api\/cart\/items\/[^/]+$/);
        await p.getByRole('button', { name: 'Xoá Gạo lứt huyết rồng Sokfram' }).click();
        const confirm = p.getByRole('button', { name: /^(Xoá|Xóa|Đồng ý)$/ });
        if (await confirm.isVisible({ timeout: 1500 }).catch(() => false)) await confirm.click();
        await w;
        await p.waitForTimeout(500);
        db = await dbCart();
        c.evidence('sau xoá', { db, ui: await subtotalText() });
        c.check('xoá: chỉ còn FUWA-GL-500×1 trong DB', db.length === 1 && db[0].sku === 'FUWA-GL-500');
        c.check('tạm tính 79.000đ', (await subtotalText()) === '79.000đ', await subtotalText());
        c.evidence('ảnh', await shot(p, 'U1-09-cart-edit'));
      } finally {
        await s.close();
      }
    },
  },
  {
    id: 'U1-10',
    role: 'Khách mới',
    journey: 'Giỏ có dòng hết hàng / vượt tồn',
    steps:
      'Giỏ COBOTE-PW-100×2 + SOK-RC-1KG×1; đặt stock COBOTE-PW-100 = 0 → mở /cart; bỏ chọn dòng hết hàng → xem nút Thanh toán; đặt stock = 1 → mở lại; khôi phục stock',
    expected:
      'Dòng hết hàng ghi "Sản phẩm đã hết hàng", nút Thanh toán khoá, lời nhắc chỉ đúng việc cần làm (xoá/bỏ chọn dòng hết hàng); tạm tính không tính dòng không mua được; bỏ chọn dòng đó thì thanh toán được; stock=1 qty=2 → nhắc giảm số lượng',
    async run(c) {
      const u = await freshCustomer('b10');
      await addToCart(u.id, 'COBOTE-PW-100', 2);
      await addToCart(u.id, 'SOK-RC-1KG', 1);
      const before = (await sql(`SELECT stock FROM variations WHERE sku = 'COBOTE-PW-100'`))[0].stock;
      await sql(`UPDATE variations SET stock = 0 WHERE sku = 'COBOTE-PW-100' RETURNING stock`);
      let s;
      try {
        s = await open(L.n, u.id, { browser: BROWSER, path: '/cart' });
        const p = s.page;
        await dismissOnboarding(p);
        await p.getByRole('button', { name: /^Thanh toán/ }).waitFor();
        const txt = await p.locator('main').innerText();
        const status = await p.getByRole('status').filter({ hasText: /tồn kho|hết hàng/ }).allInnerTexts();
        const sub = txt.match(/Tạm tính[^\n]*\n?\s*([\d.]+đ)/)?.[1];
        c.evidence('stock=0: chữ trên giỏ', { status, subtotal: sub, freeshipLine: txt.match(/Bạn được miễn phí ship[^\n]*/)?.[0] ?? null });
        c.evidence('ảnh', await shot(p, 'U1-10-cart-oos'));
        c.check('dòng ghi "Sản phẩm đã hết hàng"', txt.includes('Sản phẩm đã hết hàng'));
        c.check('nút Thanh toán bị khoá', await p.getByRole('button', { name: /^Thanh toán/ }).isDisabled());
        c.check('lời nhắc nói đúng việc cần làm với hàng đã hết (xoá/bỏ chọn), không chỉ "giảm số lượng"', status.some((t) => /hết hàng|Xoá|bỏ chọn/i.test(t)), status);
        c.check('tạm tính không cộng dòng hết hàng (= 75.000đ)', sub === '75.000đ', sub);
        await p.getByRole('checkbox', { name: 'Chọn Phấn rôm thảo dược Cobote' }).click();
        await p.waitForTimeout(800);
        const pay = p.getByRole('button', { name: /^Thanh toán/ });
        const txt2 = await p.locator('main').innerText();
        c.evidence('sau bỏ chọn dòng hết hàng', { button: await pay.innerText(), disabled: await pay.isDisabled(), subtotal: txt2.match(/Tạm tính[^\n]*\n?\s*([\d.]+đ)/)?.[1] });
        c.check('bỏ chọn dòng hết hàng → Thanh toán (1) bấm được', !(await pay.isDisabled()) && /\(1\)/.test(await pay.innerText()));
        await s.close();
        s = null;
        await sql(`UPDATE variations SET stock = 1 WHERE sku = 'COBOTE-PW-100' RETURNING stock`);
        s = await open(L.n, u.id, { browser: BROWSER, path: '/cart' });
        await dismissOnboarding(s.page);
        await s.page.getByRole('button', { name: /^Thanh toán/ }).waitFor();
        const st2 = await s.page.getByRole('status').allInnerTexts();
        const t3 = await s.page.locator('main').innerText();
        c.evidence('stock=1, qty=2', { status: st2, line: t3.match(/Phấn rôm[^\n]*\n[^\n]*\n[^\n]*/)?.[0] });
        c.evidence('ảnh', await shot(s.page, 'U1-10-cart-overstock'));
        c.check('stock 1 < qty 2: nhắc giảm số lượng và khoá thanh toán', st2.some((t) => /vượt tồn kho/.test(t)) && (await s.page.getByRole('button', { name: /^Thanh toán/ }).isDisabled()), st2);
      } finally {
        await s?.close();
        await sql(`UPDATE variations SET stock = $1 WHERE sku = 'COBOTE-PW-100' RETURNING stock`, before);
      }
    },
  },
];

await runCases(cases);
