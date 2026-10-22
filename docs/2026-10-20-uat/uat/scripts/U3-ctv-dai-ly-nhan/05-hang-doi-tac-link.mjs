#!/usr/bin/env node
// U3-35..U3-37: hàng gian hàng đối tác không có hoa hồng CTV; đơn sỉ không mua được hàng đối tác;
// link CTV có mã l=<shortCode>: click được đếm, chuyển đổi (conversions) thì không (D3-06 phần còn mở).
// Dùng: node 05-hang-doi-tac-link.mjs
import {
  L, api, apiOk, closeDb, commissionsOf, ensureUser, log, openMini, orderRow, placeOrderApi, recorder, short, shot, sql, variationBySku,
} from './u3lib.mjs';

const R = recorder('05-hang-doi-tac-link');
const RUN = Date.now().toString(36).slice(-5);
const D = 'uat_dealer';
let mini;
try {
  // ---------- U3-35 hàng đối tác + hàng Tubu cùng đơn qua mã CTV ----------
  const store = await apiOk(L, 'GET', '/merchant/store', { user: D });
  if (!store.isPublished) {
    const pub = await api(L, 'POST', '/merchant/store/publish', { user: D, body: { isPublished: true } });
    log('publish store', pub.status, short(pub.body, 300));
  }
  const created = await apiOk(L, 'POST', '/merchant/products', {
    user: D,
    body: { name: `Xà bông thủ công đối tác ${RUN}`, description: 'Hàng gian hàng đối tác (đại lý tự giao), dùng cho UAT U3.', basePrice: 150_000, stock: 50 },
  });
  const pid = created.id ?? created.product?.id;
  const rv = await apiOk(L, 'POST', `/admin/merchant-products/${pid}/review`, { user: 'uat_admin', body: { approve: true } });
  const pv = (await sql(`SELECT v.id, v.sku, v."retailPrice", v.stock, p."approvalStatus"::text ap, p."storefrontId" FROM variations v JOIN products p ON p.id = v."productId" WHERE p.id = $1`, pid))[0];
  const tubu = await variationBySku('FUWA-DW-1L');
  const BUY = `uat_u3ptn${RUN}`;
  await ensureUser(BUY, { phone: `0906${String(Date.now()).slice(-6)}` });
  const o = await placeOrderApi(BUY, [{ variationId: pv.id, quantity: 1 }, { variationId: tubu.id, quantity: 1 }], { referralCode: 'UATCTV' });
  // Đơn có hàng đối tác tách thành nhiều đơn con; lấy theo khách (khách mới) thay vì đọc phản hồi place-order.
  const codes = (await sql(`SELECT code FROM orders WHERE "userId" = $1 ORDER BY "createdAt"`, BUY)).map((x) => x.code);
  const perOrder = [];
  for (const c of codes) {
    const items = await sql(`SELECT v.sku, oi."paidTotal"::int paid, p."storefrontId" IS NOT NULL partner FROM order_items oi JOIN orders o ON o.id = oi."orderId" JOIN variations v ON v.id = oi."variationId" JOIN products p ON p.id = v."productId" WHERE o.code = $1`, c);
    perOrder.push({ code: c, ref: (await orderRow(c)).referrerUserId, items, commissions: (await commissionsOf(c)).map((x) => ({ u: x.affiliateUserId, s: x.status, amt: x.amount })) });
  }
  const allItems = perOrder.flatMap((x) => x.items);
  const tubuPaid = allItems.filter((i) => !i.partner).reduce((s, i) => s + i.paid, 0);
  const partnerPaid = allItems.filter((i) => i.partner).reduce((s, i) => s + i.paid, 0);
  const comm = perOrder.flatMap((x) => x.commissions);
  const commSum = comm.reduce((s, c) => s + c.amt, 0);
  const partnerOrderComm = perOrder.filter((x) => x.items.every((i) => i.partner)).flatMap((x) => x.commissions).reduce((s, c) => s + c.amt, 0);
  R.add({
    id: 'U3-35', role: 'Khách mới / CTV', journey: 'Không hoa hồng hàng gian hàng đối tác', title: 'Đơn gồm 1 SP đối tác (150.000đ) + FUWA-DW-1L (120.000đ) qua mã UATCTV',
    steps: `uat_dealer GET /merchant/store (gian hàng đối tác) → POST /merchant/products → ADMIN POST /admin/merchant-products/:id/review approve → khách ${BUY} giỏ 2 dòng → place-order referralCode=UATCTV`,
    expected: 'Hoa hồng = floor(8% × tiền hàng Tubu đã trả) = 9.600đ; phần hàng đối tác 0đ (không dòng hoặc dòng 0)',
    actual: { product: { id: pid, sku: pv.sku, ap: pv.ap, review: rv?.approvalStatus ?? rv?.status }, orders: perOrder, tubuPaid, partnerPaid, commSum },
    evidence: `SQL order_items ${short(allItems)}; SQL commissions ${short(comm)}; Σ = ${commSum}`,
    status: partnerPaid > 0 && tubuPaid > 0 && commSum === Math.floor((tubuPaid * 8) / 100) && partnerOrderComm === 0 ? 'PASS' : 'FAIL',
  });

  // ---------- U3-36 đơn sỉ không mua được hàng đối tác ----------
  const d36 = await api(L, 'POST', '/dealer/orders', { user: D, headers: { 'idempotency-key': `u3-36-${RUN}` }, body: { items: [{ variationId: pv.id, quantity: 30 }], paymentMethod: 'PREPAID' } });
  const inPrice = (await apiOk(L, 'GET', '/dealer/pricelist', { user: D })).some((r) => r.variationId === pv.id);
  R.add({
    id: 'U3-36', role: 'Đại lý', journey: 'Bảng giá sỉ chỉ hàng Tubu', title: 'Đặt đơn sỉ với biến thể hàng đối tác',
    steps: `GET /dealer/pricelist; POST /dealer/orders PREPAID ${pv.sku}×30`,
    expected: 'Bảng giá không có hàng đối tác; API 400 PARTNER_GOODS_NOT_ELIGIBLE',
    actual: { inPricelist: inPrice, status: d36.status, body: d36.body },
    evidence: `HTTP ${d36.status} ${short(d36.body, 240)}`,
    status: !inPrice && d36.status === 400 ? 'PASS' : 'FAIL',
  });

  // ---------- U3-37 link CTV có mã l=: click và chuyển đổi ----------
  // Link mới mỗi lượt: lượt mở được khử trùng theo (mã link, IP băm, ngày VN), cùng máy chạy lại trong ngày sẽ không được đếm lần 2.
  const link = await apiOk(L, 'POST', '/affiliate/links', { user: 'uat_ctv', body: { targetType: 'HOMEPAGE' } });
  const me0 = await apiOk(L, 'GET', '/affiliate/dashboard', { user: 'uat_ctv' });
  const before = (await sql(`SELECT clicks, conversions FROM affiliate_links WHERE "shortCode" = $1`, link.shortCode))[0];
  const BUY2 = `uat_u3lnk${RUN}`;
  await ensureUser(BUY2, { phone: `0905${String(Date.now()).slice(-6)}` });
  mini = await openMini(BUY2, { path: `/?ref=UATCTV&l=${link.shortCode}` });
  await mini.page.waitForTimeout(3000);
  const clickReq = mini.requests.filter((r) => r.path.startsWith('/affiliate/click')).map((r) => ({ m: r.method, s: r.status }));
  await mini.close();
  mini = null;
  const mid = (await sql(`SELECT clicks, conversions FROM affiliate_links WHERE "shortCode" = $1`, link.shortCode))[0];
  const o37 = await placeOrderApi(BUY2, [{ variationId: tubu.id, quantity: 1 }]);
  const r37 = await orderRow(o37.code);
  const c37 = await commissionsOf(o37.code);
  const after = (await sql(`SELECT clicks, conversions FROM affiliate_links WHERE "shortCode" = $1`, link.shortCode))[0];
  const me1 = await apiOk(L, 'GET', '/affiliate/dashboard', { user: 'uat_ctv' });
  const totalComm = (await sql(`SELECT count(DISTINCT "orderId")::int n FROM commissions WHERE "affiliateUserId" = 'uat_ctv'`))[0].n;
  const notRejected = (await sql(`SELECT count(*)::int n FROM commissions WHERE "affiliateUserId" = 'uat_ctv' AND status <> 'REJECTED'`))[0].n;
  // Luật 2026-10-22: "Chuyển đổi" = số đơn đã ghi công (commission không REJECTED); Mini App chỉ ghi số lượt bấm của link, không ghi "0 đơn".
  mini = await openMini('ctv', { path: '/affiliate' });
  const clickLine = mini.page.getByText(`${after.clicks} lượt bấm`).first();
  const clickShown = await clickLine.waitFor({ timeout: 20_000 }).then(() => true, () => false);
  await clickLine.scrollIntoViewIfNeeded().catch(() => undefined);
  const s37 = await shot(mini.page, 'U3-37-link-click-chuyen-doi');
  const bodyText = (await mini.page.innerText('body')).replace(/\s+/g, ' ');
  const zeroDon = /\d+ lượt bấm\s*·\s*\d+ đơn/.test(bodyText) || /click\s*·\s*\d+ đơn/.test(bodyText);
  // MiniStat vẽ số trước, nhãn sau.
  const statShown = new RegExp(`(?<!\\d)${me1.totalConversions}\\s*Chuyển đổi`).test(bodyText);
  await mini.close();
  mini = null;
  R.add({
    id: 'U3-37', role: 'Khách mới / CTV', journey: 'Theo dõi click và chuyển đổi của link', title: `Khách mới mở /?ref=UATCTV&l=${link.shortCode} rồi đặt đơn`,
    steps: `Mini App khách ${BUY2} mở link → POST /affiliate/click; place-order (gán CTV bằng lượt chạm) → CTV mở /affiliate`,
    expected: 'clicks +1; đơn gán uat_ctv có hoa hồng; "Chuyển đổi" (dashboard totalConversions) +1 và = số đơn đã ghi công (commission không REJECTED); Mini App ghi "N lượt bấm" cho link, không ghi "· 0 đơn"; ô "Chuyển đổi" hiện đúng số',
    actual: { clickReq, before, mid, after, ref: r37.referrerUserId, commissions: c37.map((x) => [x.status, x.amount]), dashConversions: [me0.totalConversions, me1.totalConversions], ordersWithCommission: totalComm, notRejected, clickShown, zeroDon, statShown },
    evidence: `${s37}; SQL affiliate_links ${link.shortCode} clicks ${before.clicks}→${mid.clicks}→${after.clicks}, cột conversions ${before.conversions}→${after.conversions} (không dùng nữa); orders.referrerUserId ${r37.referrerUserId}; GET /affiliate/dashboard totalConversions ${me0.totalConversions}→${me1.totalConversions} (CTV có ${totalComm} đơn có hoa hồng)`,
    status: mid.clicks === before.clicks + 1 && r37.referrerUserId === 'uat_ctv' && c37.length === 1 && me1.totalConversions === me0.totalConversions + 1 &&
      me1.totalConversions === notRejected && clickShown && !zeroDon && statShown ? 'PASS' : 'FAIL',
    data: { knownId: 'D3-06 / U3-B01 (chuyển đổi = số đơn đã ghi công, chủ chốt 2026-10-22)' },
  });
} catch (e) {
  console.error(e);
  R.add({ id: 'U3-35..37', title: 'script lỗi', actual: String(e?.message ?? e).slice(0, 600), status: 'BLOCKED' });
} finally {
  await mini?.close().catch(() => undefined);
  R.save();
  await closeDb();
}
