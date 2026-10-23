#!/usr/bin/env node
// U1 nhóm E: giờ vàng (giá, giới hạn mỗi khách, hết suất), Điểm Xanh lúc thanh toán (trần 20%, 1 điểm = 1đ, điểm đang khoá),
// khách quay lại (Mua lại, địa chỉ cũ, hạng Lộc Biếc), voucher sinh nhật, voucher win-back. Mọi ca tiền/điểm đối chiếu DB.
// Chạy: node u1-e-flash-points-returning.mjs [U1-25 ...]   (U1_BROWSER=webkit để chạy WebKit)
import {
  L, BROWSER, open, sql, api, apiOk, freshCustomer, addToCart, addAddress, clearCart, shot, runCases, dismissOnboarding, quoteFeed,
  settledQuote, cartToCheckout, placeOrderUI, orderEvidence, pointsState, stockOf, couponState, runJob, quickOrderApi, deliver,
  applyVoucherUI, variation, waitApi, waitPancakePush,
} from './u1-lib.mjs';

const RET = 'uat_returning';
const vnToday = () => new Date(Date.now() + 7 * 3.6e6).toISOString().slice(0, 10);

const flashItem = async (sku) =>
  (
    await sql(
      `SELECT fsi.id, fsi."flashPrice", fsi.quota, fsi."soldCount", fsi."perUserLimit" FROM flash_sale_items fsi JOIN variations v ON v.id = fsi."variationId" WHERE v.sku = $1`,
      sku,
    )
  )[0];
const purchases = async (itemId, userId) =>
  (await sql(`SELECT quantity FROM flash_sale_purchases WHERE "flashSaleItemId" = $1 AND "userId" = $2`, itemId, userId))[0]?.quantity ?? 0;
const tierMult = async (userId) =>
  Number((await sql(`SELECT t."pointMultiplier"::float AS m FROM users u LEFT JOIN membership_tiers t ON t.id = u."tierId" WHERE u.id = $1`, userId))[0]?.m ?? 1);
const earn = (goods, mult) => Math.floor((Math.floor(goods) * 2 * Math.round(mult * 100)) / 10_000);
const notes = async (userId, since) =>
  (await sql(`SELECT "templateCode", payload FROM notification_logs WHERE "userId" = $1 AND "sentAt" >= $2 ORDER BY "sentAt"`, userId, since)).map((n) => ({
    templateCode: n.templateCode,
    text: JSON.stringify(n.payload).slice(0, 240),
  }));

/** Giỏ (đã có hàng) → checkout UI → (tuỳ chọn tick Điểm Xanh) → đặt COD. */
async function checkoutUI(c, s, { usePoints = false, place = true, shotName, coupon } = {}) {
  const p = s.page;
  await dismissOnboarding(p);
  if (coupon) {
    const a = await applyVoucherUI(p, coupon.code ?? null, { fromList: coupon.fromList ?? null });
    c.evidence(`áp mã ${coupon.code ?? coupon.fromList}`, { status: a.status, snackbar: a.snack, couponCode: a.body?.couponCode, discount: a.body?.discount, message: a.message });
  }
  const feed = quoteFeed(p);
  await cartToCheckout(p);
  let q = await settledQuote(p, feed);
  const box = p.getByRole('checkbox', { name: /Điểm Xanh/ });
  const pointsUi = {
    disabled: await box.getAttribute('aria-disabled').catch(() => null),
    text: (await box.innerText().catch(() => '')).replace(/\s+/g, ' ').trim(),
  };
  if (usePoints) {
    await box.click();
    q = await settledQuote(p, feed);
    pointsUi.afterTick = (await box.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
    pointsUi.checked = await box.getAttribute('aria-checked');
  }
  const qb = q?.body ?? {};
  c.evidence('báo giá cuối (POST /checkout/quote)', {
    req: q?.req, subtotal: qb.subtotal, discount: qb.discount, tierDiscount: qb.tierDiscount, pointsUsed: qb.pointsUsed, pointsDiscount: qb.pointsDiscount,
    pointsMax: qb.pointsMax, shippingFee: qb.shippingFee, firstOrderShipWaived: qb.firstOrderShipWaived, total: qb.total, pointsEarned: qb.pointsEarned,
  });
  c.evidence('ô Điểm Xanh', pointsUi);
  if (shotName) c.evidence('ảnh thanh toán', await shot(p, `${shotName}-checkout`));
  if (!place) return { quote: qb, pointsUi };
  const placed = await placeOrderUI(p, 'COD');
  c.evidence('đặt đơn', { status: placed.status, code: placed.code, button: placed.buttonText, message: placed.body?.message });
  await p.waitForTimeout(1500);
  if (shotName) c.evidence('ảnh sau đặt', await shot(p, `${shotName}-placed`));
  return { quote: qb, pointsUi, placed, pageText: await p.locator('body').innerText() };
}

const cases = [
  {
    id: 'U1-25',
    role: 'Khách mới / khách đã mua giờ vàng',
    journey: 'Giờ vàng: giá, giới hạn 2 suất mỗi khách, hết suất',
    steps:
      '(a) Khách A mở trang SP Hạt điều BHN-CW-500 → giỏ 2 hộp → COD; (b) khách A mua tiếp 1 hộp; (c) khách B bỏ 3 hộp vào giỏ; (d) khách C đang ở checkout 1 hũ mật ong giờ vàng BHN-HN-500 thì suất bán hết (soldCount = quota) → bấm Đặt hàng; (e) mở lại trang SP khi hết suất',
    expected:
      '(a) giá giờ vàng 119.000đ (thay 159.000đ), đơn 238.000đ ship 0 (đơn đầu ≥199k), order_items flash, soldCount +2, flash_sale_purchases 2; (b) giá thường 159.000đ + "Bạn đã dùng hết suất giờ vàng của sản phẩm này, sản phẩm đang tính giá thường."; (c) cả dòng giá thường + "Giá giờ vàng chỉ áp dụng tối đa 2 sản phẩm cho bạn. Giảm số lượng còn 2…"; (d) không ghi đơn giá giờ vàng đã hết, khách được hỏi lại giá mới; soldCount không vượt quota; (e) giá thường 260.000đ',
    async run(c) {
      const CW = 'BHN-CW-500';
      const fi = await flashItem(CW);
      const v = await variation(CW);
      c.evidence('SQL giờ vàng BHN-CW-500 trước', { ...fi, salePrice: v.salePrice, retailPrice: v.retailPrice });
      // (a)
      const A = await freshCustomer('e25a');
      await addAddress(A);
      let s = await open(L.n, A.id, { browser: BROWSER, path: `/product/${v.product.slug}` });
      try {
        await dismissOnboarding(s.page);
        await s.page.waitForTimeout(1500);
        const pdp = await s.page.locator('body').innerText();
        c.evidence('ảnh trang SP giờ vàng', await shot(s.page, 'U1-25-flash-pdp'));
        c.check('(a) trang SP hiện giá giờ vàng 119.000đ', pdp.includes('119.000đ'), pdp.match(/[^\n]*119\.000đ[^\n]*/g));
        await addToCart(A.id, CW, 2);
        await s.goto('/cart');
        await s.page.waitForTimeout(1500);
        const cart = await apiOk(L, 'GET', '/cart', { user: A.id });
        const line = cart.items.find((i) => i.variationId === v.id);
        c.evidence('(a) GET /cart dòng giờ vàng', { unitPrice: line.unitPrice, quantity: line.quantity, isFlash: line.isFlash, flashLimitNotice: line.flashLimitNotice });
        c.check('(a) giỏ: 2 × 119.000đ, isFlash', line.unitPrice === 119000 && line.isFlash && line.quantity === 2);
        const r = await checkoutUI(c, s, { shotName: 'U1-25a' });
        const o = await orderEvidence(r.placed.code);
        const fi2 = await flashItem(CW);
        const pu = await purchases(fi.id, A.id);
        c.evidence('(a) SQL đơn + suất', { order: { subtotal: o.subtotal, shippingFee: o.shippingFee, total: o.total, pointsEarned: o.pointsEarned, items: o.items }, soldBefore: fi.soldCount, soldAfter: fi2.soldCount, purchase: pu });
        c.check('(a) DB: đơn 238.000đ, ship 0, dòng flash 119.000đ', o.total === 238000 && o.shippingFee === 0 && o.items[0].flash && o.items[0].unitPrice === 119000, o.items);
        c.check('(a) DB: soldCount +2, flash_sale_purchases = 2', fi2.soldCount === fi.soldCount + 2 && pu === 2);
        c.check('(a) DB: điểm dự kiến 2% × 238.000 = 4.760', o.pointsEarned === 4760, o.pointsEarned);
        // (b)
        await addToCart(A.id, CW, 1);
        await s.goto('/cart');
        await s.page.waitForTimeout(2000);
        const txt = await s.page.locator('body').innerText();
        c.evidence('ảnh giỏ khi đã hết suất của khách', await shot(s.page, 'U1-25b-flash-used'));
        const cb = await apiOk(L, 'GET', '/cart', { user: A.id });
        const lb = cb.items.find((i) => i.variationId === v.id);
        c.evidence('(b) GET /cart', { unitPrice: lb.unitPrice, isFlash: lb.isFlash, flashLimitNotice: lb.flashLimitNotice });
        c.check('(b) giá thường 159.000đ + báo đã dùng hết suất', lb.unitPrice === 159000 && !lb.isFlash && txt.includes('Bạn đã dùng hết suất giờ vàng của sản phẩm này, sản phẩm đang tính giá thường.'));
        await clearCart(A.id);
      } finally {
        await s.close();
      }
      // (c)
      const B = await freshCustomer('e25b');
      await addToCart(B.id, CW, 3);
      s = await open(L.n, B.id, { browser: BROWSER, path: '/cart' });
      try {
        await dismissOnboarding(s.page);
        await s.page.waitForTimeout(2000);
        const txt = await s.page.locator('body').innerText();
        c.evidence('ảnh giỏ 3 hộp', await shot(s.page, 'U1-25c-flash-over-limit'));
        const cb = await apiOk(L, 'GET', '/cart', { user: B.id });
        const lb = cb.items.find((i) => i.variationId === v.id);
        c.evidence('(c) GET /cart', { unitPrice: lb.unitPrice, isFlash: lb.isFlash, flashLimitNotice: lb.flashLimitNotice });
        c.check(
          '(c) cả dòng giá thường 159.000đ + "Giá giờ vàng chỉ áp dụng tối đa 2 sản phẩm cho bạn…"',
          lb.unitPrice === 159000 && !lb.isFlash && txt.includes('Giá giờ vàng chỉ áp dụng tối đa 2 sản phẩm cho bạn. Giảm số lượng còn 2 để được giá giờ vàng, hoặc mua 3 sản phẩm với giá thường.'),
        );
      } finally {
        await s.close();
      }
      // (d) + (e)
      const HN = 'BHN-HN-500';
      const fh = await flashItem(HN);
      const vh = await variation(HN);
      const C = await freshCustomer('e25c');
      await addAddress(C);
      await addToCart(C.id, HN, 1);
      s = await open(L.n, C.id, { browser: BROWSER, path: '/cart' });
      try {
        await dismissOnboarding(s.page);
        const r = await checkoutUI(c, s, { place: false });
        c.check('(d) báo giá trước khi hết suất: 195.000đ', r.quote.subtotal === 195000, r.quote.subtotal);
        await sql(`UPDATE flash_sale_items SET "soldCount" = quota WHERE id = $1 RETURNING id`, fh.id);
        const placed = await placeOrderUI(s.page, 'COD');
        await s.page.waitForTimeout(1500);
        const txt = await s.page.locator('body').innerText();
        c.evidence('(d) đặt khi vừa hết suất', { status: placed.status, body: placed.body, button: placed.buttonText });
        c.evidence('(d) chữ trên màn', txt.split('\n').filter((x) => /giá|Giá|thay đổi|cập nhật|hết/.test(x)).slice(0, 8));
        c.evidence('ảnh checkout khi hết suất', await shot(s.page, 'U1-25d-flash-soldout-checkout'));
        const [{ n }] = await sql(`SELECT COUNT(*)::int AS n FROM orders WHERE "userId" = $1`, C.id);
        const fh2 = await flashItem(HN);
        c.check('(d) không ghi đơn nào giá giờ vàng (400), soldCount = quota', placed.status === 400 && n === 0 && fh2.soldCount === fh2.quota, { status: placed.status, orders: n, sold: fh2.soldCount, quota: fh2.quota });
        c.check('(d) màn hỏi lại giá mới', /giá|thay đổi|cập nhật/i.test(txt));
        await s.goto(`/product/${vh.product.slug}`);
        await s.page.waitForTimeout(1500);
        const pdp = await s.page.locator('body').innerText();
        c.evidence('ảnh trang SP hết suất', await shot(s.page, 'U1-25e-flash-soldout-pdp'));
        const pub = await apiOk(L, 'GET', `/products/${vh.product.slug}`, { user: C.id }).catch((e) => ({ error: String(e).slice(0, 200) }));
        c.evidence('(e) trang SP khi hết suất', { has260: pdp.includes('260.000đ'), has195: pdp.includes('195.000đ'), lines: pdp.match(/[^\n]*(195|260)\.000đ[^\n]*/g) });
        c.check('(e) trang SP hết suất về giá thường 260.000đ, không còn 195.000đ', pdp.includes('260.000đ') && !pdp.includes('195.000đ'));
        void pub;
      } finally {
        await sql(`UPDATE flash_sale_items SET "soldCount" = $2 WHERE id = $1 RETURNING id`, fh.id, fh.soldCount);
        await s.close();
      }
    },
  },
  {
    id: 'U1-26',
    role: 'Khách có Điểm Xanh',
    journey: 'Dùng Điểm Xanh lúc thanh toán: điểm đang khoá, trần 20%, 1 điểm = 1đ, số dư nhỏ hơn trần',
    steps:
      'Khách mới đặt 4 can FUWA-DW-5L (1.720.000đ) COD → giả Pancake giao xong → (a) checkout 1 chai 120k: ô Điểm Xanh; (b) lùi deliveredAt của đơn 8 ngày (hết hạn đổi/trả 7 ngày) → tick Điểm Xanh → COD; (c) giỏ 1 can 430k → tick Điểm Xanh → COD',
    expected:
      'Giao xong +34.400 điểm (2% × 1.720.000), ORDER_DELIVERED; (a) điểm còn trong hạn đổi/trả nên chưa dùng được: ô bị khoá, báo giá pointsUsed 0; (b) trần 20% × 120.000 = 24.000 điểm → giảm 24.000đ, tổng 96.000đ + phí giao; sổ ORDER_REDEEM −24.000; (c) trần 86.000 > số dư 10.400 → dùng 10.400, giảm 10.400đ; số dư 0; mọi lúc tổng sổ điểm = users.pointsBalance; điểm tích = 2% × hệ số hạng × tiền hàng sau điểm',
    async run(c) {
      const u = await freshCustomer('e26');
      await addAddress(u);
      const first = await quickOrderApi(u.id, 'FUWA-DW-5L', 4);
      await waitPancakePush(first.code);
      const dl = await deliver(first.code);
      c.evidence('đơn 1 + giao xong (webhook Pancake)', { code: first.code, total: first.quote.total, deliveredEvent: dl?.event });
      const p0 = await pointsState(u.id);
      const o1 = await orderEvidence(first.code);
      c.evidence('SQL điểm sau giao', { points: p0, ledger: o1.ledger, tier: (await sql(`SELECT "tierId" FROM users WHERE id = $1`, u.id))[0] });
      c.check('giao xong: +34.400 điểm, sổ = số dư', p0.balance === 34400 && p0.ledgerStd === p0.balance && o1.ledger.some((l) => l.reason === `ORDER_DELIVERED:${first.code}` && l.delta === 34400), p0);
      // (a)
      await clearCart(u.id);
      await addToCart(u.id, 'FUWA-DW-1L', 1);
      let s = await open(L.n, u.id, { browser: BROWSER, path: '/cart' });
      try {
        const loy = await apiOk(L, 'GET', '/me/loyalty', { user: u.id });
        c.evidence('(a) GET /me/loyalty', { balance: loy.pointsBalance ?? loy.balance, usable: loy.usablePoints ?? loy.usable, locked: loy.lockedPoints ?? loy.locked });
        const r = await checkoutUI(c, s, { place: false, shotName: 'U1-26a-locked' });
        const qa = await apiOk(L, 'POST', '/checkout/quote', { user: u.id, body: { addressId: r.quote.addressId ?? (await apiOk(L, 'GET', '/me/addresses', { user: u.id }))[0].id, pointsToUse: 34400 } });
        c.evidence('(a) POST /checkout/quote pointsToUse 34400 (gọi thẳng API)', { pointsUsed: qa.pointsUsed, pointsDiscount: qa.pointsDiscount, total: qa.total });
        c.check('(a) điểm đang khoá: ô Điểm Xanh bị khoá', r.pointsUi.disabled === 'true', r.pointsUi);
        c.check('(a) API cũng không cho dùng điểm đang khoá (pointsUsed 0)', qa.pointsUsed === 0);
      } finally {
        await s.close();
      }
      // (b)
      await sql(`UPDATE orders SET "deliveredAt" = "deliveredAt" - interval '8 days' WHERE code = $1 RETURNING code`, first.code);
      const mult = await tierMult(u.id);
      s = await open(L.n, u.id, { browser: BROWSER, path: '/cart' });
      try {
        const r = await checkoutUI(c, s, { usePoints: true, shotName: 'U1-26b-cap' });
        const q = r.quote;
        c.check('(b) trần 20%: dùng 24.000 điểm = giảm 24.000đ', q.pointsUsed === 24000 && q.pointsDiscount === 24000, q);
        c.check('(b) tổng = 120.000 − 24.000 + phí giao', q.total === 120000 - 24000 + q.shippingFee, q);
        c.check(`(b) điểm tích = 2% × ${mult} × 96.000`, q.pointsEarned === earn(96000, mult), { pointsEarned: q.pointsEarned, want: earn(96000, mult) });
        c.check('(b) ô Điểm Xanh ghi "24.000"', /24\.000/.test(r.pointsUi.afterTick ?? ''), r.pointsUi.afterTick);
        const o = await orderEvidence(r.placed.code);
        const ps = await pointsState(u.id);
        c.evidence('(b) SQL đơn + điểm', { order: { subtotal: o.subtotal, pointsUsed: o.pointsUsed, pointsDiscount: o.pointsDiscount, shippingFee: o.shippingFee, total: o.total, pointsEarned: o.pointsEarned, items: o.items }, ledger: o.ledger, points: ps });
        c.check('(b) DB: pointsUsed 24000, pointsDiscount 24000, total khớp báo giá', o.pointsUsed === 24000 && o.pointsDiscount === 24000 && o.total === q.total);
        c.check('(b) DB: sổ ORDER_REDEEM −24.000, số dư 10.400 = tổng sổ', o.ledger.some((l) => l.reason === `ORDER_REDEEM:${o.code}` && l.delta === -24000) && ps.balance === 10400 && ps.ledgerStd === 10400, ps);
      } finally {
        await s.close();
      }
      // (c)
      await clearCart(u.id);
      await addToCart(u.id, 'FUWA-DW-5L', 1);
      s = await open(L.n, u.id, { browser: BROWSER, path: '/cart' });
      try {
        const r = await checkoutUI(c, s, { usePoints: true, shotName: 'U1-26c-balance' });
        const q = r.quote;
        const m2 = await tierMult(u.id);
        c.check('(c) trần 86.000 > số dư → dùng hết 10.400 điểm', q.pointsUsed === 10400 && q.pointsDiscount === 10400, q);
        c.check('(c) tổng = 430.000 − 10.400 + phí giao', q.total === 430000 - 10400 + q.shippingFee, q);
        c.check(`(c) điểm tích = 2% × ${m2} × 419.600`, q.pointsEarned === earn(419600, m2), { pointsEarned: q.pointsEarned, want: earn(419600, m2) });
        const o = await orderEvidence(r.placed.code);
        const ps = await pointsState(u.id);
        c.evidence('(c) SQL đơn + điểm', { order: { subtotal: o.subtotal, pointsUsed: o.pointsUsed, pointsDiscount: o.pointsDiscount, shippingFee: o.shippingFee, total: o.total, pointsEarned: o.pointsEarned }, ledger: o.ledger, points: ps });
        c.check('(c) DB: sổ ORDER_REDEEM −10.400, số dư 0 = tổng sổ', o.ledger.some((l) => l.delta === -10400) && ps.balance === 0 && ps.ledgerStd === 0, ps);
      } finally {
        await s.close();
      }
    },
  },
  {
    id: 'U1-27',
    role: 'Khách quay lại (uat_returning, Lộc Biếc, 34.400 điểm, đơn cũ đã giao)',
    journey: 'Mua lại từ Trang chủ → địa chỉ cũ chọn sẵn → COD; quyền lợi hạng Lộc Biếc',
    steps:
      'Trang chủ kệ "Mua lại" → "Mua lại" (Nước rửa chén Can 5L) → "Thêm vào giỏ (1)" → giỏ → "Thanh toán (1)" (không tick Điểm Xanh) → COD; thêm: báo giá API 1 chai 120k để xem ngưỡng miễn ship riêng của hạng',
    expected:
      'Kệ Mua lại có SP đơn cũ; sang giỏ với 1 can 430.000đ; checkout chọn sẵn địa chỉ mặc định 12 Lê Lợi, Phường Bến Thành; không tự tiêu điểm; phí giao 0; điểm tích 2% × 1,2 × 430.000 = 10.320; DB: đơn COD đúng địa chỉ, pointsUsed 0, số dư điểm không đổi; giỏ 120k: Lộc Biếc miễn ship từ 99k → phí 0 (khách hạng thường đã có đơn trả 19.000đ, U1-14b)',
    async run(c) {
      await clearCart(RET);
      const p0 = await pointsState(RET);
      const s = await open(L.n, RET, { browser: BROWSER, path: '/' });
      try {
        const p = s.page;
        await dismissOnboarding(p);
        const rail = p.getByRole('region', { name: 'Mua lại' });
        await rail.waitFor({ timeout: 15_000 });
        const railText = (await rail.innerText()).replace(/\s+/g, ' ');
        c.evidence('kệ Mua lại', railText.slice(0, 200));
        c.evidence('ảnh trang chủ khách quay lại', await shot(p, 'U1-27-home-rebuy'));
        c.check('kệ Mua lại có Nước rửa chén Can 5L', /Nước rửa chén sinh học Fuwa3e/.test(railText));
        await rail.getByRole('button', { name: 'Mua lại', exact: true }).first().click();
        const add = p.getByRole('button', { name: /^Thêm vào giỏ \(\d+\)$/ });
        await add.waitFor({ timeout: 10_000 });
        c.evidence('ảnh sheet Mua lại', await shot(p, 'U1-27-rebuy-sheet'));
        const posted = waitApi(p, 'POST', /\/api\/cart\/items$/);
        await add.click();
        await posted;
        await p.waitForURL(/\/cart$/, { timeout: 15_000 });
        await p.waitForTimeout(1200);
        const cart = await apiOk(L, 'GET', '/cart', { user: RET });
        c.evidence('GET /cart sau Mua lại', cart.items.map((i) => ({ name: i.productName, variation: i.variationName, qty: i.quantity, unitPrice: i.unitPrice })));
        c.check('Mua lại → tự sang giỏ, 1 can 430.000đ', cart.items.length === 1 && cart.items[0].unitPrice === 430000 && cart.items[0].quantity === 1);
        const r = await checkoutUI(c, s, { shotName: 'U1-27' });
        const coText = r.pageText;
        const q = r.quote;
        c.check('không tự tiêu điểm (pointsUsed 0)', q.pointsUsed === 0, q.pointsUsed);
        c.check('phí giao 0, tổng 430.000đ, điểm tích 10.320 (2% × 1,2)', q.shippingFee === 0 && q.total === 430000 && q.pointsEarned === 10320, q);
        const o = await orderEvidence(r.placed.code);
        const [addr] = await sql(`SELECT "shippingAddress" FROM orders WHERE code = $1`, r.placed.code).catch(() => [null]);
        const p1 = await pointsState(RET);
        c.evidence('SQL đơn + địa chỉ + điểm', { order: { status: o.status, paymentMethod: o.paymentMethod, total: o.total, shippingFee: o.shippingFee, pointsEarned: o.pointsEarned, pointsUsed: o.pointsUsed }, address: addr?.shippingAddress, before: p0, after: p1 });
        c.check('DB: đơn COD giao tới 12 Lê Lợi, Phường Bến Thành', JSON.stringify(addr?.shippingAddress ?? '').includes('12 Lê Lợi') && /Bến Thành/.test(JSON.stringify(addr?.shippingAddress ?? '')));
        c.check('DB: total 430000, pointsEarned 10320, pointsUsed 0; số dư điểm không đổi', o.total === 430000 && o.pointsEarned === 10320 && o.pointsUsed === 0 && p1.balance === p0.balance);
        c.check('màn thành công', /Cảm ơn/i.test(coText), coText.slice(0, 120));
      } finally {
        await s.close();
      }
      await clearCart(RET);
      await addToCart(RET, 'FUWA-DW-1L', 1);
      const addrId = (await apiOk(L, 'GET', '/me/addresses', { user: RET }))[0].id;
      const q = await apiOk(L, 'POST', '/checkout/quote', { user: RET, body: { addressId: addrId } });
      c.evidence('báo giá 120k của khách Lộc Biếc', { subtotal: q.subtotal, shippingFee: q.shippingFee, total: q.total, pointsEarned: q.pointsEarned });
      c.check('Lộc Biếc miễn ship từ 99k: 120k → phí 0, điểm 2.880 (2% × 1,2)', q.shippingFee === 0 && q.total === 120000 && q.pointsEarned === 2880, q);
      await clearCart(RET);
    },
  },
  {
    id: 'U1-28',
    role: 'Khách quay lại hạng Lộc Biếc có sinh nhật hôm nay',
    journey: 'Voucher sinh nhật theo hạng → dùng ở giỏ',
    steps:
      'Khách Lộc Biếc đặt ngày sinh = hôm nay qua PATCH /me → cron vouchers sinh nhật (VouchersService.birthdayVouchers, 1 giờ sáng) → ví mã → giỏ 1 chai 120k → "Dùng mã" sinh nhật → COD; thử đổi ngày sinh lần 2',
    expected:
      'Mã BIRTHDAY-<năm>-<tháng> 50.000đ (mức Lộc Biếc), không đơn tối thiểu, hạn 30 ngày, chỉ của khách này; thông báo BIRTHDAY_VOUCHER; đơn 120k giảm 50.000đ (ship 0 theo hạng), redemption 1; đổi ngày sinh lần 2 bị chặn "Ngày sinh chỉ có thể đặt một lần…"',
    async run(c) {
      const u = await freshCustomer('e28', { tierId: 'LOC_BIEC' });
      await addAddress(u);
      const since = new Date();
      const today = vnToday();
      const dob = `1990-${today.slice(5)}`;
      const set = await api(L, 'PATCH', '/me', { user: u.id, body: { dob } });
      c.evidence('PATCH /me dob', { status: set.status, dob });
      const again = await api(L, 'PATCH', '/me', { user: u.id, body: { dob: '1991-01-01' } });
      c.evidence('PATCH /me dob lần 2', { status: again.status, message: again.body?.message });
      c.check('đổi ngày sinh lần 2 bị chặn', again.status === 400 && /chỉ có thể đặt một lần/.test(again.body?.message ?? ''));
      const job = runJob('VouchersService.birthdayVouchers');
      c.evidence('run-job birthdayVouchers', { ms: job.ms });
      const [cp] = await sql(`SELECT code, type, value, "minOrder", "endAt", "usageLimit", scope, "scopeMeta" FROM coupons WHERE "scopeMeta"->>'userId' = $1 AND code LIKE 'BIRTHDAY%'`, u.id);
      c.evidence('SQL mã sinh nhật', cp);
      const days = cp ? (new Date(cp.endAt) - since) / 864e5 : null;
      c.check('mã BIRTHDAY 50.000đ, không tối thiểu, ~30 ngày, USER_GROUP của khách', !!cp && cp.value === 50000 && cp.minOrder == null && Math.abs(days - 30) < 0.1 && cp.scope === 'USER_GROUP');
      const n = await notes(u.id, since);
      c.evidence('thông báo', n);
      c.check('có thông báo BIRTHDAY_VOUCHER', n.some((x) => x.templateCode === 'BIRTHDAY_VOUCHER'));
      await addToCart(u.id, 'FUWA-DW-1L', 1);
      const s = await open(L.n, u.id, { browser: BROWSER, path: '/cart' });
      try {
        const r = await checkoutUI(c, s, { coupon: { code: cp.code }, shotName: 'U1-28' });
        c.check('báo giá: giảm 50.000đ, tổng 70.000đ', r.quote.discount === 50000 && r.quote.total === 70000 + r.quote.shippingFee, r.quote);
        const o = await orderEvidence(r.placed.code);
        c.evidence('SQL đơn', { couponCode: o.couponCode, couponDiscount: o.couponDiscount, shippingFee: o.shippingFee, total: o.total, pointsEarned: o.pointsEarned, redemptions: o.redemptions });
        c.check('DB: couponDiscount 50000, 1 redemption, usedCount 1', o.couponDiscount === 50000 && o.redemptions.length === 1 && o.redemptions[0].usedCount === 1);
      } finally {
        await s.close();
      }
    },
  },
  {
    id: 'U1-29',
    role: 'Khách lâu không quay lại (đơn cuối 61 ngày trước)',
    journey: 'Voucher win-back → dùng ở giỏ',
    steps:
      'Khách có 1 đơn đã giao, lùi createdAt đơn 61 ngày → cron VouchersService.winbackVouchers (2 giờ sáng) → giỏ 2 chai 240k → nhập mã win-back → COD; đối chứng: uat_returning (đơn cuối 40 ngày) không được cấp',
    expected:
      'Mã WINBACK-<tháng> 50.000đ, hạn 21 ngày, thông báo WINBACK_VOUCHER; đơn 240k giảm 50.000đ; khách đơn cuối < 60 ngày không có mã',
    async run(c) {
      const u = await freshCustomer('e29');
      await addAddress(u);
      const old = await quickOrderApi(u.id, 'FUWA-GL-500', 1);
      await waitPancakePush(old.code);
      await deliver(old.code);
      await sql(`UPDATE orders SET "createdAt" = now() - interval '61 days', "deliveredAt" = now() - interval '59 days' WHERE code = $1 RETURNING code`, old.code);
      const since = new Date();
      const before = await sql(`SELECT code FROM coupons WHERE "scopeMeta"->>'userId' = $1 AND code LIKE 'WINBACK%'`, RET);
      runJob('VouchersService.winbackVouchers');
      const [cp] = await sql(`SELECT code, type, value, "minOrder", "endAt", scope FROM coupons WHERE "scopeMeta"->>'userId' = $1 AND code LIKE 'WINBACK%'`, u.id);
      const ret = await sql(`SELECT code FROM coupons WHERE "scopeMeta"->>'userId' = $1 AND code LIKE 'WINBACK%'`, RET);
      c.evidence('SQL mã win-back', { coupon: cp, returningBefore: before, returningAfter: ret });
      const days = cp ? (new Date(cp.endAt) - since) / 864e5 : null;
      c.check('mã WINBACK 50.000đ, ~21 ngày', !!cp && cp.value === 50000 && Math.abs(days - 21) < 0.1);
      c.check('đối chứng: uat_returning (đơn cuối 40 ngày) không được cấp', ret.length === 0);
      const n = await notes(u.id, since);
      c.evidence('thông báo', n);
      c.check('có thông báo WINBACK_VOUCHER', n.some((x) => x.templateCode === 'WINBACK_VOUCHER'));
      await clearCart(u.id);
      await addToCart(u.id, 'FUWA-DW-1L', 2);
      const s = await open(L.n, u.id, { browser: BROWSER, path: '/cart' });
      try {
        const r = await checkoutUI(c, s, { coupon: { code: cp.code }, shotName: 'U1-29' });
        c.check('báo giá: giảm 50.000đ', r.quote.discount === 50000 && r.quote.total === 240000 - 50000 + r.quote.shippingFee, r.quote);
        const o = await orderEvidence(r.placed.code);
        c.evidence('SQL đơn', { couponCode: o.couponCode, couponDiscount: o.couponDiscount, shippingFee: o.shippingFee, total: o.total, redemptions: o.redemptions });
        c.check('DB: couponDiscount 50000, 1 redemption', o.couponDiscount === 50000 && o.redemptions.length === 1);
      } finally {
        await s.close();
      }
    },
  },
];

await runCases(cases);
