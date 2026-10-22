#!/usr/bin/env node
// U3-41..U3-44: trang nhãn /brand/fuwa3e (Mini App + web SSR) với khối "Chương trình đại lý" hiện cho mọi người (đã chốt
// 2026-10-19), màn chủ nhãn /brand-owner: doanh thu đối soát SQL, chủ nhãn thêm khuyến mãi → hiện trên trang công khai.
// Fuwa3e trong lane đang isPublished=false: ADMIN bật trong lượt chạy rồi trả lại như cũ.
// Dùng: node 07-thuong-hieu.mjs
import { L, api, apiOk, closeDb, log, openMini, openWeb, recorder, short, shot, sql } from './u3lib.mjs';

const R = recorder('07-thuong-hieu');
const RUN = Date.now().toString(36).slice(-5);
const BRAND_ID = '75ae0443eea88aa90f3c2bec9bc3ece1';
const SLUG = 'fuwa3e';
const fresh = async (path, needles) => {
  const r = await fetch(`${L.webUrl}${path}`, { headers: { 'cache-control': 'no-cache' } });
  const html = await r.text();
  return { status: r.status, ...Object.fromEntries(needles.map((n) => [n, html.includes(n)])) };
};
let mini;
let web;
let wasPublished;
try {
  wasPublished = (await sql(`SELECT "isPublished" p FROM brands WHERE id = $1`, BRAND_ID))[0].p;
  if (!wasPublished) await apiOk(L, 'PATCH', `/admin/brands/${BRAND_ID}`, { user: 'uat_admin', body: { isPublished: true } });
  let reward = (await sql(`SELECT id, title FROM dealer_rewards WHERE "isActive" AND ("brandId" = $1 OR "brandId" IS NULL) ORDER BY "createdAt" DESC LIMIT 1`, BRAND_ID))[0];
  if (!reward) {
    reward = await apiOk(L, 'POST', '/admin/dealer-rewards', { user: 'uat_admin', body: { brandId: BRAND_ID, type: 'TOUR', title: `Tour đại lý UAT ${RUN}`, threshold: 50_000_000, period: 'QUARTER' } });
  }
  const pub = await apiOk(L, 'GET', `/brand/public/${SLUG}`, { bypass: true });
  const sqlRewards = (await sql(`SELECT title FROM dealer_rewards WHERE "isActive" AND ("brandId" = $1 OR "brandId" IS NULL)`, BRAND_ID)).map((x) => x.title).sort();

  // ---------- U3-41 Mini App: khách chưa đăng nhập + khách thường thấy khối đại lý ----------
  const viewers = {};
  for (const who of ['guest', 'returning']) {
    mini = await openMini(who, { path: `/brand/${SLUG}` });
    const blk = mini.page.getByRole('heading', { name: 'Chương trình đại lý' });
    await blk.waitFor({ timeout: 30_000 }).catch(() => undefined);
    await blk.scrollIntoViewIfNeeded().catch(() => undefined);
    const txt = await mini.page.evaluate(() => document.body.innerText);
    viewers[who] = { block: txt.includes('Chương trình đại lý'), reward: txt.includes(reward.title), cta: /Đăng ký đại lý|Vào kênh đại lý|Xem hồ sơ đại lý/.exec(txt)?.[0] ?? null, shot: await shot(mini.page, `U3-41-mini-nhan-${who}`) };
    await mini.close();
    mini = null;
  }
  R.add({
    id: 'U3-41', role: 'Khách (chưa đăng nhập / thường)', journey: '/brand/<slug> trên Mini App', title: 'Trang nhãn Fuwa3e hiện khối "Chương trình đại lý" cho mọi người',
    steps: `ADMIN PATCH /admin/brands/${BRAND_ID} isPublished=true; Mini App guest và uat_returning mở /brand/${SLUG}`,
    expected: 'Cả hai thấy tiêu đề "Chương trình đại lý", tên phần thưởng đang chạy và nút "Đăng ký đại lý"; API dealerRewards khớp SQL dealer_rewards active (brand hoặc chung)',
    actual: { viewers, apiRewards: pub.dealerRewards?.map((d) => d.title).sort(), sqlRewards, products: pub.products?.length },
    evidence: `${viewers.guest.shot}, ${viewers.returning.shot}; API dealerRewards ${pub.dealerRewards?.length} = SQL ${sqlRewards.length}; sản phẩm ${pub.products?.length}`,
    status: viewers.guest.block && viewers.guest.reward && viewers.returning.block && viewers.returning.reward && viewers.guest.cta === 'Đăng ký đại lý' && JSON.stringify(pub.dealerRewards?.map((d) => d.title).sort()) === JSON.stringify(sqlRewards) ? 'PASS' : 'FAIL',
  });

  // ---------- U3-42 web SSR ----------
  const ssr = await fresh(`/brand/${SLUG}`, ['Chương trình đại lý', reward.title, 'Fuwa3e']);
  web = await openWeb('guest', { width: 390, path: `/brand/${SLUG}` });
  await web.page.getByText('Chương trình đại lý').first().waitFor({ timeout: 60_000 }).catch(() => undefined);
  await web.page.getByText('Chương trình đại lý').first().scrollIntoViewIfNeeded().catch(() => undefined);
  const s42a = await shot(web.page, 'U3-42-web-nhan-390-khach');
  await web.close();
  web = await openWeb('returning', { width: 1440, path: `/brand/${SLUG}` });
  await web.page.getByText('Chương trình đại lý').first().waitFor({ timeout: 60_000 }).catch(() => undefined);
  const webTxt = await web.page.evaluate(() => document.body.innerText);
  const s42b = await shot(web.page, 'U3-42-web-nhan-1440');
  await web.close();
  web = null;
  R.add({
    id: 'U3-42', role: 'Khách (web)', journey: '/brand/<slug> trên web SSR', title: 'Web /brand/fuwa3e (SSR 3232) có sản phẩm + khối "Chương trình đại lý"',
    steps: `GET ${L.webUrl}/brand/${SLUG} (render mới); Playwright khách 390 và uat_returning 1440`,
    expected: 'HTTP 200; HTML SSR có "Chương trình đại lý" và tên phần thưởng; giao diện hiện khối cho khách chưa đăng nhập',
    actual: { ssr, web1440: webTxt.includes('Chương trình đại lý') },
    evidence: `${s42a}, ${s42b}; HTTP ${ssr.status}; HTML có khối=${ssr['Chương trình đại lý']}, có "${reward.title}"=${ssr[reward.title]}`,
    status: ssr.status === 200 && ssr['Chương trình đại lý'] && ssr[reward.title] && webTxt.includes('Chương trình đại lý') ? 'PASS' : 'FAIL',
  });

  // ---------- U3-43 chủ nhãn: doanh thu ----------
  const sales = await apiOk(L, 'GET', '/brand/owner/me/sales?period=30d', { user: 'uat_brand' });
  const q = await sql(
    `SELECT COALESCE(SUM(oi.total),0)::bigint rev, COALESCE(SUM(oi.quantity),0)::int units, count(DISTINCT o.id)::int n
       FROM order_items oi JOIN orders o ON o.id = oi."orderId" JOIN variations v ON v.id = oi."variationId" JOIN products p ON p.id = v."productId"
      WHERE p."brandId" = $1 AND o."createdAt" >= $2::timestamptz AND o."createdAt" <= $3::timestamptz
        AND o.status::text NOT IN ('PENDING_PAYMENT','CANCELLED','RETURNED') AND o."paymentStatus"::text NOT IN ('REFUNDED','FAILED')`,
    BRAND_ID, sales.from, sales.to,
  );
  const partialReturns = (await sql(`SELECT count(*)::int n FROM return_requests r JOIN orders o ON o.id = r."orderId" WHERE o."createdAt" >= $1::timestamptz`, sales.from))[0].n;
  mini = await openMini('brand', { path: '/brand-owner' });
  let p = mini.page;
  await p.getByRole('tab', { name: 'Doanh thu' }).or(p.getByRole('button', { name: 'Doanh thu', exact: true })).first().click();
  await p.waitForTimeout(2500);
  const ownerTxt = await p.evaluate(() => document.body.innerText);
  const s43 = await shot(p, 'U3-43-chu-nhan-doanh-thu');
  const revStr = Number(sales.revenue).toLocaleString('vi-VN');
  R.add({
    id: 'U3-43', role: 'Chủ nhãn (uat_brand)', journey: 'Màn chủ nhãn: doanh thu', title: 'Tab "Doanh thu" 30 ngày khớp SQL',
    steps: 'Mini App uat_brand /brand-owner → "Doanh thu"; GET /brand/owner/me/sales?period=30d; SQL tổng order_items của nhãn',
    expected: 'revenue = SQL Σ order_items.total (đơn không ở PENDING_PAYMENT/CANCELLED/RETURNED, không REFUNDED/FAILED) trong [from,to]; orderCount, unitsSold khớp; màn hiện đúng số',
    actual: { api: { revenue: sales.revenue, orderCount: sales.orderCount, unitsSold: sales.unitsSold, delivered: sales.delivered }, sql: q[0], partialReturns, uiHasRevenue: ownerTxt.includes(revStr) },
    evidence: `${s43}; API revenue ${sales.revenue} / ${sales.orderCount} đơn / ${sales.unitsSold} SP; SQL ${q[0].rev} / ${q[0].n} / ${q[0].units}; order_returns trong kỳ: ${partialReturns}`,
    status: Number(sales.revenue) === Number(q[0].rev) && sales.orderCount === q[0].n && sales.unitsSold === q[0].units && ownerTxt.includes(revStr) ? 'PASS' : 'FAIL',
  });

  // ---------- U3-44 chủ nhãn thêm khuyến mãi → hiện công khai ----------
  const title = `MUA 2 TẶNG 1 UAT ${RUN}`;
  await p.getByRole('tab', { name: 'Hồ sơ & khuyến mãi' }).or(p.getByRole('button', { name: 'Hồ sơ & khuyến mãi', exact: true })).first().click();
  await p.getByLabel('Tiêu đề (MUA 2 TẶNG 1)').fill(title);
  await p.getByLabel('Mô tả', { exact: true }).fill('Áp dụng nước rửa chén Fuwa3e');
  const add = p.waitForResponse((r) => r.url().endsWith('/api/brand/owner/me/promotions') && r.request().method() === 'POST', { timeout: 20_000 });
  await p.getByRole('button', { name: 'Thêm khuyến mãi' }).click();
  const addr = await add;
  await p.waitForTimeout(1000);
  const s44a = await shot(p, 'U3-44-chu-nhan-them-khuyen-mai');
  await mini.close();
  mini = null;
  const promoRow = (await sql(`SELECT id, title, "isActive", "startAt", "endAt" FROM brand_promotions WHERE "brandId" = $1 AND title = $2`, BRAND_ID, title))[0];
  const pub44 = await apiOk(L, 'GET', `/brand/public/${SLUG}`, { bypass: true });
  mini = await openMini('guest', { path: `/brand/${SLUG}` });
  await mini.page.getByText(title).first().waitFor({ timeout: 30_000 }).catch(() => undefined);
  const mini44 = (await mini.page.evaluate(() => document.body.innerText)).includes(title);
  const s44b = await shot(mini.page, 'U3-44-mini-nhan-khuyen-mai-moi');
  await mini.close();
  mini = null;
  const web44 = await fresh(`/brand/${SLUG}`, [title]);
  R.add({
    id: 'U3-44', role: 'Chủ nhãn / khách', journey: 'Màn chủ nhãn: khuyến mãi', title: 'Chủ nhãn "Thêm khuyến mãi" → hiện trên trang nhãn công khai',
    steps: `/brand-owner → "Hồ sơ & khuyến mãi" → Tiêu đề "${title}", Mô tả → "Thêm khuyến mãi"; khách mở /brand/${SLUG} (Mini App, web)`,
    expected: 'POST 201; dòng khuyến mãi active, startAt ≤ now ≤ endAt (+30 ngày); API công khai có; Mini App và web SSR hiện tiêu đề',
    actual: { post: addr.status(), promoRow, api: pub44.promotions?.some((x) => x.title === title), mini44, web44 },
    evidence: `${s44a}, ${s44b}; HTTP ${addr.status()}; SQL ${short(promoRow)}; web SSR ${web44.status} có tiêu đề=${web44[title]}`,
    status: addr.status() === 201 && promoRow && pub44.promotions?.some((x) => x.title === title) && mini44 && web44[title] ? 'PASS' : 'FAIL',
  });
} catch (e) {
  console.error(e);
  R.add({ id: 'U3-41..44', title: 'script lỗi', actual: String(e?.message ?? e).slice(0, 600), status: 'BLOCKED' });
} finally {
  await mini?.close().catch(() => undefined);
  await web?.close().catch(() => undefined);
  if (wasPublished === false) await api(L, 'PATCH', `/admin/brands/${BRAND_ID}`, { user: 'uat_admin', body: { isPublished: false } }).catch(() => undefined);
  R.save();
  await closeDb();
}
