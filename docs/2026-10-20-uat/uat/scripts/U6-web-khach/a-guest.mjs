// Nhóm A: khách chưa đăng nhập duyệt web (SSR/SEO, danh mục, tìm kiếm, chi tiết sản phẩm, gian hàng, nhãn hàng, trang tĩnh, cổng đăng nhập).
// Chạy: node a-guest.mjs   (lane 6 đã bật với --web)
import { L, Recorder, finish, openWeb, nav, bodyText, badReqs, overflowX, sql, apiOk, call, vnd, sleep } from './_lib.mjs';

const rec = new Recorder('a-guest');
const WIDTHS = [390, 1440];
const sessions = {};
for (const w of WIDTHS) sessions[w] = await openWeb('guest', { width: w, path: '/' });

const fetchHtml = async (p, headers = {}) => {
  const r = await fetch(`${L.webUrl}${p}`, { redirect: 'manual', headers });
  return { status: r.status, html: await r.text(), headers: Object.fromEntries(r.headers) };
};
// Trang nhãn đọc API qua fetch có revalidate 300 (apps/web/src/lib/api.ts getBrand): Data Cache của Next giữ bản đã đăng tới 5 phút
// sau khi gỡ đăng, nên lần chạy lại đo "trước khi đăng" ra 200. `next dev` bỏ qua cache khi request có Cache-Control: no-cache.
const NO_CACHE = { 'cache-control': 'no-cache' };
const noScript = (html) => html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ');

// Brand Fuwa3e mặc định chưa đăng (isPublished=false): ghi nhận 404 trước, rồi admin đăng để thử trang SSR.
// Chạy lại trên lane đã dùng: gỡ đăng trước để "trước khi đăng" luôn đo đúng.
const brands = await apiOk(L, 'GET', '/admin/brands', { user: 'admin' });
const fuwa = brands.find((b) => b.slug === 'fuwa3e');
await call('admin', 'PATCH', `/admin/brands/${fuwa.id}`, { isPublished: false });
const brandBefore = await fetchHtml('/brand/fuwa3e', NO_CACHE);
const brandBeforeApi = (await fetch(`${L.apiUrl127}/brand/public/fuwa3e`)).status;
const brandBeforeCached = (await fetchHtml('/brand/fuwa3e')).status;

// ───────────── U6-01 trang chủ
await rec.run('U6-01', { role: 'Khách chưa đăng nhập', journey: 'Duyệt', steps: 'Mở / ở 390 và 1440; đọc khối Danh mục, Ưu đãi giờ vàng, Bán chạy', expected: 'Trang 200, không tràn ngang, không request API lỗi, giá giờ vàng = giá flash sale trong DB (BHN-CGL-100 165.000đ, BHN-CW-500 119.000đ, BHN-HN-500 195.000đ)' }, async (c) => {
  for (const w of WIDTHS) {
    const s = sessions[w];
    const r = await nav(s, '/');
    const t = await bodyText(s.page);
    const ox = await overflowX(s.page);
    c.ok(`${w}: HTTP 200`, r.status === 200, r.status);
    c.ok(`${w}: không tràn ngang`, ox.sw <= ox.iw + 1, ox);
    c.ok(`${w}: API không lỗi`, badReqs(r.reqs).length === 0, badReqs(r.reqs));
    c.ok(`${w}: không lỗi JS`, r.errs.length === 0, r.errs);
    c.ok(`${w}: có khối Danh mục / giờ vàng / Bán chạy`, /Danh mục/.test(t) && /Ưu đãi giờ vàng/.test(t) && /Bán chạy/.test(t));
    c.ok(`${w}: giá giờ vàng đúng`, t.includes('165.000đ') && t.includes('119.000đ') && t.includes('195.000đ'));
    c.ok(`${w}: hiện nút Đăng nhập`, /Đăng nhập/.test(t));
    await c.shot(s.page, `home-${w}`);
    c.ev(`${w} request API`, r.reqs.map((x) => `${x.method} ${x.path} ${x.status}`).join('; '));
  }
  const fs = await sql(`SELECT v.sku, fi."flashPrice"::int AS price FROM flash_sale_items fi JOIN variations v ON v.id = fi."variationId" ORDER BY v.sku`).catch(() => []);
  c.ev('DB flash_sale_items', fs);
});

// ───────────── U6-02 danh mục + sắp xếp + lọc
await rec.run('U6-02', { role: 'Khách chưa đăng nhập', journey: 'Duyệt', steps: 'Mở /san-pham; đọc số sản phẩm; sắp xếp Giá tăng / Giá giảm; chọn danh mục', expected: 'Số sản phẩm = số sản phẩm đang bán trong DB; Giá tăng thì thẻ đầu rẻ nhất; chọn danh mục chỉ còn sản phẩm danh mục đó' }, async (c) => {
  const [{ n }] = await sql(`SELECT count(*)::int AS n FROM products WHERE "isActive" = true AND "approvalStatus" = 'APPROVED'`);
  for (const w of WIDTHS) {
    const s = sessions[w];
    const r = await nav(s, '/san-pham');
    const t = await bodyText(s.page);
    const m = /(\d+) sản phẩm/.exec(t);
    c.ok(`${w}: số sản phẩm hiển thị = DB`, m && Number(m[1]) === n, { ui: m?.[1], db: n });
    c.ok(`${w}: API không lỗi`, badReqs(r.reqs).length === 0, badReqs(r.reqs));
    const ox = await overflowX(s.page);
    c.ok(`${w}: không tràn ngang`, ox.sw <= ox.iw + 1, ox);
    await c.shot(s.page, `san-pham-${w}`);
    // Sắp xếp giá tăng: đọc giá hiển thị của các thẻ.
    await s.page.getByRole('button', { name: /Giá tăng/ }).first().click().catch(async () => {
      await s.page.getByText('Giá tăng', { exact: true }).first().click();
    });
    await s.page.waitForTimeout(1500);
    const prices = await s.page.evaluate(() => {
      const out = [];
      document.querySelectorAll('a[href^="/san-pham/"]').forEach((a) => {
        const m = /(\d{1,3}(?:\.\d{3})*)đ/.exec(a.textContent || '');
        if (m) out.push(Number(m[1].replace(/\./g, '')));
      });
      return out;
    });
    const sorted = [...prices].sort((a, b) => a - b);
    c.ok(`${w}: Giá tăng sắp đúng thứ tự (20 thẻ đầu)`, JSON.stringify(prices.slice(0, 20)) === JSON.stringify(sorted.slice(0, 20)), prices.slice(0, 12));
    c.ev(`${w} giá sau Giá tăng`, prices.slice(0, 12).join(','));
    await s.page.getByRole('button', { name: /Giá giảm/ }).first().click().catch(() => undefined);
    await s.page.waitForTimeout(1500);
    const prices2 = await s.page.evaluate(() => {
      const out = [];
      document.querySelectorAll('a[href^="/san-pham/"]').forEach((a) => {
        const m = /(\d{1,3}(?:\.\d{3})*)đ/.exec(a.textContent || '');
        if (m) out.push(Number(m[1].replace(/\./g, '')));
      });
      return out;
    });
    c.ok(`${w}: Giá giảm — thẻ đầu đắt nhất`, prices2.length > 0 && prices2[0] === Math.max(...prices2), prices2.slice(0, 6));
  }
});

// ───────────── U6-03 tìm kiếm
await rec.run('U6-03', { role: 'Khách chưa đăng nhập', journey: 'Tìm', steps: 'Gõ "cà phê", "ca phe" (không dấu), chuỗi vô nghĩa vào ô tìm', expected: 'Có dấu và không dấu đều ra đủ sản phẩm có "cà phê" trong tên (4 trong DB lane); chuỗi vô nghĩa ra trạng thái rỗng, không lỗi' }, async (c) => {
  const fold = (x) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').toLowerCase();
  const names = await sql(`SELECT name FROM products WHERE "isActive" = true`);
  const n = names.filter((r) => fold(r.name).includes('ca phe')).length;
  c.ev('số sản phẩm có "cà phê" trong tên (DB, bỏ dấu)', n);
  for (const w of WIDTHS) {
    const s = sessions[w];
    for (const q of ['cà phê', 'ca phe']) {
      const r = await nav(s, `/san-pham?q=${encodeURIComponent(q)}`);
      const t = await bodyText(s.page);
      const m = /(\d+) sản phẩm/.exec(t);
      c.ok(`${w}: "${q}" ra đúng số SP cà phê (${n})`, m && Number(m[1]) === n, { ui: m?.[1], db: n });
      if (q === 'cà phê') await c.shot(s.page, `tim-ca-phe-${w}`);
      c.ok(`${w}: "${q}" API không lỗi`, badReqs(r.reqs).length === 0, badReqs(r.reqs));
    }
    await nav(s, `/san-pham?q=${encodeURIComponent('zzzxyz không có')}`);
    const t3 = await bodyText(s.page);
    c.ok(`${w}: chuỗi vô nghĩa hiện trạng thái rỗng`, /Không (có|tìm thấy)|chưa có|0 sản phẩm/i.test(t3), t3.slice(0, 300));
    await c.shot(s.page, `tim-rong-${w}`);
    // ô tìm ở header: gõ và Enter
    const box = s.page.getByRole('searchbox').or(s.page.getByPlaceholder(/Tìm sản phẩm/)).first();
    if (await box.count()) {
      await nav(s, '/');
      const b2 = s.page.getByPlaceholder(/Tìm sản phẩm/).first();
      if (await b2.isVisible().catch(() => false)) {
        await b2.fill('serum');
        await b2.press('Enter');
        await s.page.waitForTimeout(2500);
        c.ok(`${w}: ô tìm ở header dẫn tới kết quả "serum"`, /serum/i.test(await bodyText(s.page)) && /q=serum|serum/i.test(s.page.url()), s.page.url());
      } else c.note(`${w}: ô tìm header không hiện ở khổ này`);
    }
  }
});

// ───────────── U6-04 chi tiết SP: SSR/SEO
await rec.run('U6-04', { role: 'Khách chưa đăng nhập', journey: 'Chi tiết SP', steps: 'GET HTML thô (không chạy JS) /san-pham/serum-duong-am-visante; xem title, canonical, JSON-LD, nội dung', expected: 'HTML thô đã có tên SP, giá, mô tả, JSON-LD Product có offers.price khớp giá trong DB; canonical không kèm ?ref=' }, async (c) => {
  const slug = 'serum-duong-am-visante';
  const { status, html } = await fetchHtml(`/san-pham/${slug}?ref=UATCTV&utm_source=x`);
  c.ok('HTTP 200', status === 200, status);
  const body = noScript(html);
  c.ok('HTML thô có tên SP', body.includes('Serum dưỡng ẩm Visante'));
  c.ok('HTML thô có giá 289.000đ (biến thể 30ml giá sale)', body.includes('289.000'), body.match(/\d{1,3}(?:\.\d{3})+\s?đ/g)?.slice(0, 6));
  const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  c.ok('có JSON-LD', ld.length > 0);
  let parsed = null;
  try {
    parsed = JSON.parse(ld[0].replace(/\\u003c/g, '<'));
  } catch (e) {
    c.ok('JSON-LD parse được', false, String(e));
  }
  c.ev('JSON-LD', JSON.stringify(parsed)?.slice(0, 600));
  const canon = /<link rel="canonical" href="([^"]+)"/.exec(html)?.[1];
  c.ok('canonical không kèm ?ref', canon && !canon.includes('ref='), canon);
  c.ok('có thẻ og:title', /property="og:title"/.test(html));
  const [v] = await sql(`SELECT v."salePrice"::int AS sale, v."retailPrice"::int AS retail FROM variations v JOIN products p ON p.id = v."productId" WHERE p.slug = $1 ORDER BY v."retailPrice" LIMIT 1`, slug);
  const offerPrice = JSON.stringify(parsed ?? {}).match(/"(?:lowPrice|price)":"?(\d+)/)?.[1];
  c.ev('giá DB', v);
  c.ok('JSON-LD giá = giá thấp nhất trong DB', Number(offerPrice) === (v.sale ?? v.retail), { offerPrice, db: v });
});

// ───────────── U6-05 PDP giờ vàng + biến thể
await rec.run('U6-05', { role: 'Khách chưa đăng nhập', journey: 'Chi tiết SP', steps: 'Mở PDP Cao cà gai leo (giờ vàng) và Serum (2 biến thể), đổi biến thể', expected: 'Giờ vàng 165.000đ (-25% so 220.000đ); Serum 30ml 289.000đ, đổi 50ml thì 460.000đ; đếm ngược giờ vàng hiện' }, async (c) => {
  for (const w of WIDTHS) {
    const s = sessions[w];
    let r = await nav(s, '/san-pham/cao-ca-gai-leo-bhnong');
    let t = await bodyText(s.page);
    c.ok(`${w}: PDP giờ vàng hiện 165.000đ`, t.includes('165.000đ'), t.slice(0, 200));
    c.ok(`${w}: giá gốc 220.000đ gạch`, t.includes('220.000đ'));
    c.ok(`${w}: có -25%`, /-25%/.test(t));
    c.ok(`${w}: API không lỗi`, badReqs(r.reqs).length === 0, badReqs(r.reqs));
    await c.shot(s.page, `pdp-flash-${w}`);
    r = await nav(s, '/san-pham/serum-duong-am-visante');
    t = await bodyText(s.page);
    c.ok(`${w}: Serum mặc định 289.000đ`, t.includes('289.000đ'));
    const opt50 = s.page.getByRole('radio', { name: /50ml/ }).or(s.page.getByRole('button', { name: /50ml/ })).first();
    if (await opt50.count()) {
      await opt50.click();
      await s.page.waitForTimeout(800);
      t = await bodyText(s.page);
      c.ok(`${w}: chọn 50ml hiện 460.000đ`, t.includes('460.000đ'), t.slice(0, 300));
    } else c.ok(`${w}: tìm thấy lựa chọn 50ml`, false);
    await c.shot(s.page, `pdp-serum-${w}`);
  }
});

// ───────────── U6-06 khách bấm thêm giỏ
await rec.run('U6-06', { role: 'Khách chưa đăng nhập', journey: 'Giỏ', steps: 'Mở PDP nước rửa tay, bấm "Thêm vào giỏ"', expected: 'Chuyển sang /dang-nhap kèm returnTo về PDP; giỏ chưa bị tạo trên server (không có request POST /cart/items)' }, async (c) => {
  for (const w of WIDTHS) {
    const s = sessions[w];
    await nav(s, '/san-pham/nuoc-rua-tay-fuwa3e');
    const before = s.requests.length;
    await s.page.getByRole('button', { name: /Thêm vào giỏ/ }).first().click();
    await s.page.waitForURL(/dang-nhap/, { timeout: 15_000 }).catch(() => undefined);
    const url = s.page.url();
    c.ok(`${w}: chuyển sang /dang-nhap`, /\/dang-nhap/.test(url), url);
    c.ok(`${w}: returnTo về PDP`, /returnTo=%2Fsan-pham%2Fnuoc-rua-tay-fuwa3e/.test(url), url);
    const posts = s.requests.slice(before).filter((r) => r.method === 'POST' && /\/cart/.test(r.path));
    c.ok(`${w}: không POST /cart khi chưa đăng nhập`, posts.length === 0, posts);
    await c.shot(s.page, `them-gio-khach-${w}`);
  }
});

// ───────────── U6-07 gian hàng
await rec.run('U6-07', { role: 'Khách chưa đăng nhập', journey: 'Gian hàng', steps: 'GET HTML thô /s/uatctv (đã duyệt), /s/uatctvpending (chờ duyệt), /s/khongco; mở /s/uatctv ở 390 và 1440', expected: 'Gian hàng đã duyệt 200, HTML thô có tên gian hàng + sản phẩm; chờ duyệt và không tồn tại đều 404 (storefront.require_approval bật)' }, async (c) => {
  const ok = await fetchHtml('/s/uatctv');
  const pend = await fetchHtml('/s/uatctvpending');
  const none = await fetchHtml('/s/khongco');
  c.ok('/s/uatctv 200', ok.status === 200, ok.status);
  c.ok('HTML thô có tên gian hàng "Góc Xanh Của Phạm CTV"', noScript(ok.html).includes('Góc Xanh Của Phạm CTV'));
  c.ok('/s/uatctvpending (chờ duyệt) 404', pend.status === 404, pend.status);
  c.ok('/s/khongco 404', none.status === 404, none.status);
  const items = await sql(`SELECT p.name FROM storefront_items si JOIN storefront_collections sc ON sc.id = si."collectionId" JOIN storefronts s ON s.id = sc."storefrontId" JOIN products p ON p.id = si."productId" WHERE s.slug = 'uatctv'`).catch(() => null);
  c.ev('sản phẩm gian hàng trong DB', items);
  for (const w of WIDTHS) {
    const s = sessions[w];
    const r = await nav(s, '/s/uatctv');
    const ox = await overflowX(s.page);
    c.ok(`${w}: không tràn ngang`, ox.sw <= ox.iw + 1, ox);
    c.ok(`${w}: API không lỗi`, badReqs(r.reqs).length === 0, badReqs(r.reqs));
    await c.shot(s.page, `gian-hang-${w}`);
    const t = await bodyText(s.page);
    c.ev(`${w} chữ`, t.slice(0, 500));
  }
  const pre = await sql(`SELECT slug, "isPublished", "approvedAt" IS NOT NULL AS approved FROM storefronts ORDER BY slug`);
  c.ev('DB storefronts', pre);
});

// ───────────── U6-08 nhãn hàng
await rec.run('U6-08', { role: 'Khách chưa đăng nhập', journey: 'Nhãn hàng', steps: 'GET /brand/fuwa3e khi nhãn chưa đăng (404), admin đăng nhãn (PATCH /admin/brands/:id), mở lại ở 390 và 1440', expected: 'Chưa đăng thì 404; đăng rồi 200, HTML thô có tên nhãn + sản phẩm Fuwa3e; trang không tràn ngang' }, async (c) => {
  c.ev('trước khi đăng: API /brand/public/fuwa3e, web bỏ cache, web qua Data Cache', { api: brandBeforeApi, web: brandBefore.status, webCached: brandBeforeCached });
  c.ok('trước khi đăng: 404', brandBefore.status === 404 && brandBeforeApi === 404, { web: brandBefore.status, api: brandBeforeApi });
  if (brandBeforeCached !== 404) c.note(`web qua Data Cache vẫn trả ${brandBeforeCached} ngay sau khi gỡ đăng (ISR revalidate 300 giây)`);
  const up = await call('admin', 'PATCH', `/admin/brands/${fuwa.id}`, { isPublished: true });
  c.ok('admin đăng nhãn → 200', up.status < 300, up.status);
  const ssr = await fetchHtml('/brand/fuwa3e', NO_CACHE);
  c.ok('sau khi đăng: 200', ssr.status === 200, ssr.status);
  const txt = noScript(ssr.html);
  c.ok('HTML thô có tên nhãn', txt.includes('Fuwa3e'));
  const prods = await sql(`SELECT name FROM products WHERE "brandId" = $1 AND "isActive" = true`, fuwa.id);
  const missing = prods.filter((p) => !txt.includes(p.name.replace(/&/g, '&amp;')));
  c.ok('HTML thô liệt kê đủ sản phẩm của nhãn', missing.length === 0, { total: prods.length, missing: missing.map((m) => m.name) });
  for (const w of WIDTHS) {
    const s = sessions[w];
    const r = await nav(s, '/brand/fuwa3e');
    const ox = await overflowX(s.page);
    c.ok(`${w}: không tràn ngang`, ox.sw <= ox.iw + 1, ox);
    c.ok(`${w}: API không lỗi`, badReqs(r.reqs).length === 0, badReqs(r.reqs));
    await c.shot(s.page, `brand-${w}`);
  }
});

// ───────────── U6-09 trang tĩnh / chính sách
await rec.run('U6-09', { role: 'Khách chưa đăng nhập', journey: 'Trang tĩnh', steps: 'Mở /gioi-thieu, /cau-chuyen, /chinh-sach/{dieu-khoan,bao-mat,doi-tra,van-chuyen}', expected: 'Mọi trang 200, không còn chỗ trống chưa điền "[Tên công ty]", "[số ngày]" (đã biết D8-5: chủ tự điền)' }, async (c) => {
  for (const p of ['/gioi-thieu', '/cau-chuyen', '/chinh-sach/dieu-khoan', '/chinh-sach/bao-mat', '/chinh-sach/doi-tra', '/chinh-sach/van-chuyen']) {
    const { status, html } = await fetchHtml(p);
    const body = noScript(html).replace(/<[^>]+>/g, ' ');
    const holes = [...new Set(body.match(/\[[^\]\n]{2,40}\]/g) ?? [])].filter((h) => !/^\[\d+\]$/.test(h));
    c.ok(`${p} 200`, status === 200, status);
    c.ok(`${p} không còn chỗ trống [..] (đã biết D8-5, chủ tự điền)`, holes.length === 0, holes.slice(0, 6));
  }
  const s = sessions[390];
  await nav(s, '/chinh-sach/doi-tra');
  await c.shot(s.page, 'chinh-sach-doi-tra-390');
});

// ───────────── U6-10 cổng đăng nhập cho khách
await rec.run('U6-10', { role: 'Khách chưa đăng nhập', journey: 'Cổng đăng nhập', steps: 'Mở các trang riêng tư khi chưa đăng nhập', expected: 'Mỗi trang hiện lời mời đăng nhập (không trắng trang, không lộ dữ liệu), có liên kết /dang-nhap?returnTo=<trang>; không gọi API riêng tư' }, async (c) => {
  const pages = ['/gio-hang', '/thanh-toan', '/tai-khoan', '/tai-khoan/don-hang', '/tai-khoan/diem-xanh', '/tai-khoan/vi-tubu', '/tai-khoan/yeu-thich', '/tai-khoan/dia-chi', '/tai-khoan/thong-bao', '/kho-qua', '/vuon-xanh', '/doi-rac', '/tu-van', '/hoc-vien', '/cong-dong/xep-hang'];
  for (const w of WIDTHS) {
    const s = sessions[w];
    for (const p of pages) {
      const r = await nav(s, p, { wait: 600 });
      const t = await bodyText(s.page);
      const login = await s.page.locator('a[href*="/dang-nhap"]').count();
      const priv = r.reqs.filter((x) => !/^\/(config|home|flash|products|categories|auth\/refresh)/.test(x.path));
      let ok = /Đăng nhập/.test(t) && login > 0;
      // /tu-van: AI tắt theo cấu hình thì tự về trang chủ; /doi-rac: chương trình chưa mở (waste.enabled=false) thì báo tạm dừng thay vì mời đăng nhập.
      if (p === '/tu-van' && r.url === '/') ok = true;
      if (p === '/doi-rac' && /Chương trình đang tạm dừng/.test(t)) ok = true;
      c.ok(`${w} ${p}: có lời mời đăng nhập + liên kết`, ok, { url: r.url, text: t.slice(0, 120), login });
      if (priv.some((x) => x.status === 401)) c.note(`${w} ${p}: có request 401 ${priv.filter((x) => x.status === 401).map((x) => x.path)}`);
      if (w === 390 && ['/gio-hang', '/tai-khoan', '/vuon-xanh'].includes(p)) await c.shot(s.page, `cong-dang-nhap${p.replace(/\//g, '-')}-${w}`);
    }
  }
});

// ───────────── U6-11 trang đăng nhập (lane không có NEXT_PUBLIC_ZALO_APP_ID)
await rec.run('U6-11', { role: 'Khách chưa đăng nhập', journey: 'Đăng nhập', steps: 'Mở /dang-nhap?returnTo=/gio-hang ở 390 và 1440', expected: 'Có nút "Đăng nhập với Zalo", liên kết Điều khoản/Bảo mật, nút quay lại; khi build thiếu Zalo App ID thì nói rõ "tạm ngưng" kèm hotline thay vì để khách bấm gặp lỗi' }, async (c) => {
  for (const w of WIDTHS) {
    const s = sessions[w];
    const r = await nav(s, '/dang-nhap?returnTo=%2Fgio-hang');
    const t = await bodyText(s.page);
    const hasBtn = /Đăng nhập với Zalo/.test(t);
    c.ev(`${w} chế độ web`, hasBtn ? 'có NEXT_PUBLIC_ZALO_APP_ID: nút Đăng nhập với Zalo' : 'thiếu NEXT_PUBLIC_ZALO_APP_ID: trang báo tạm ngưng');
    c.ok(`${w}: có nút đăng nhập, hoặc (khi build thiếu Zalo App ID) câu "tạm ngưng" kèm hotline`, hasBtn || (/tạm ngưng/.test(t) && /0984 606 774/.test(t)), t.slice(0, 300));
    c.ok(`${w}: có Điều khoản + Bảo mật`, /Điều khoản/.test(t) && /Chính sách bảo mật/.test(t));
    c.ok(`${w}: API không lỗi`, badReqs(r.reqs).length === 0, badReqs(r.reqs));
    c.ev(`${w} chữ`, t.slice(0, 600));
    await c.shot(s.page, `dang-nhap-${w}`);
  }
});

for (const w of WIDTHS) await sessions[w].close();
await finish(rec);
