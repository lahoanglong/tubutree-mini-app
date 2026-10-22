#!/usr/bin/env node
// U1 nhóm C: mã giảm giá (thẻ hộp hàng 30k/199k chỉ khách mới, WELCOME30, FREESHIP, XANH10, voucher chào mừng, freeship đơn đầu,
// chồng mã, lỗi hết hạn/hết lượt/sai điều kiện) + thanh toán COD thành công. Mọi số tiền đối chiếu DB lane.
// Chạy: node u1-c-voucher-cod.mjs [U1-11 ...]
import {
  L, BROWSER, open, sql, api, apiOk, freshCustomer, addToCart, addAddress, clearCart, shot, runCases, dismissOnboarding,
  applyVoucherUI, quoteFeed, settledQuote, cartToCheckout, addAddressUI, placeOrderUI, orderEvidence, couponState, stockOf,
  unusedCardCode, quickOrderApi, waitPancakePush, fakePancakeOrder, pointsState, sleep,
} from './u1-lib.mjs';

const ADMIN = { user: 'uat_admin' };
const pts = (goods, mult = 1) => Math.floor(goods * 0.02 * mult);

/** Giỏ → (áp mã) → thanh toán → báo giá cuối → đặt COD. Trả mọi thứ để đối chiếu. */
async function buyFlow(c, s, { code, fromList, addAddr = false, method = 'COD', place = true, shotName }) {
  const p = s.page;
  await dismissOnboarding(p);
  let applied = null;
  if (code || fromList) {
    applied = await applyVoucherUI(p, code, { fromList });
    c.evidence(`áp mã ${code ?? fromList}`, { status: applied.status, snackbar: applied.snack, couponCode: applied.body?.couponCode, discount: applied.body?.discount, message: applied.message });
  }
  const feed = quoteFeed(p);
  await cartToCheckout(p);
  if (addAddr) {
    const a = await addAddressUI(p);
    c.evidence('thêm địa chỉ qua form', { status: a.status, ward: a.body?.ward, provinceCode: a.body?.provinceCode, wardCode: a.body?.wardCode });
  }
  const q = await settledQuote(p, feed);
  const qb = q?.body ?? {};
  c.evidence('báo giá cuối (POST /checkout/quote)', {
    subtotal: qb.subtotal, discount: qb.discount, couponApplied: qb.couponApplied, couponNotice: qb.couponNotice, tierDiscount: qb.tierDiscount,
    pointsUsed: qb.pointsUsed, pointsDiscount: qb.pointsDiscount, shippingFee: qb.shippingFee, firstOrderShipWaived: qb.firstOrderShipWaived,
    total: qb.total, pointsEarned: qb.pointsEarned,
  });
  if (shotName) c.evidence('ảnh thanh toán', await shot(p, `${shotName}-checkout`));
  if (!place) return { applied, quote: qb };
  const placed = await placeOrderUI(p, method);
  c.evidence('đặt đơn', { status: placed.status, code: placed.code, button: placed.buttonText, message: placed.body?.message });
  await p.waitForTimeout(1500);
  if (shotName) c.evidence('ảnh sau đặt', await shot(p, `${shotName}-placed`));
  return { applied, quote: qb, placed, pageText: await p.locator('body').innerText() };
}

const cases = [
  {
    id: 'U1-11',
    role: 'Khách mới (đã nhận thẻ HOPSAN, có voucher chào mừng)',
    journey: 'Mã thẻ 30k (đơn từ 199k, chỉ khách mới) + freeship đơn đầu từ 199k → thêm địa chỉ → COD → đơn thành công',
    steps:
      'Nhận thẻ (POST /coupons/claim) → giỏ FUWA-DW-1L 120k + FUWA-GL-500 79k = 199.000đ → "Chọn mã" gõ mã thẻ "Áp dụng" → "Thanh toán (2)" → "Thêm địa chỉ mới" (form tỉnh/phường) → COD → "Đặt hàng · 169.000đ"',
    expected:
      'Giảm 30.000đ; phí giao 0đ nhờ freeship đơn đầu (tiền hàng 199.000đ ≥ 199.000đ) dù sau mã còn 169.000đ < ngưỡng chung 200.000đ; tổng 169.000đ; điểm dự kiến 2% × 169.000 = 3.380; DB: CONFIRMED/COD, couponDiscount 30000, shippingFee 0, total 169000, 1 coupon_redemptions, usedCount 1; tồn kho mỗi SKU −1; giỏ trống; giả Pancake nhận đơn cod 169.000',
    async run(c) {
      const u = await freshCustomer('c11', { welcome: true });
      const card = await unusedCardCode();
      const cl = await apiOk(L, 'POST', '/coupons/claim', { user: u.id, body: { code: card } });
      c.evidence('nhận thẻ', { code: card, alreadyClaimed: cl.alreadyClaimed });
      await addToCart(u.id, 'FUWA-DW-1L', 1);
      await addToCart(u.id, 'FUWA-GL-500', 1);
      const stock0 = { dw: await stockOf('FUWA-DW-1L'), gl: await stockOf('FUWA-GL-500') };
      const s = await open(L.n, u.id, { browser: BROWSER, path: '/cart' });
      try {
        const r = await buyFlow(c, s, { code: card, addAddr: true, shotName: 'U1-11' });
        c.check('áp mã thẻ: snackbar "Đã áp dụng mã …"', r.applied.status < 300 && /Đã áp dụng mã/.test(r.applied.snack ?? ''), r.applied.snack);
        c.check('báo giá: giảm 30.000đ, phí giao 0đ, tổng 169.000đ', r.quote.discount === 30000 && r.quote.shippingFee === 0 && r.quote.total === 169000, r.quote);
        c.check('báo giá: điểm dự kiến 3.380 (2% × 169.000)', r.quote.pointsEarned === pts(169000), r.quote.pointsEarned);
        c.check('nút "Đặt hàng · 169.000đ"', r.placed.buttonText.includes('169.000đ'), r.placed.buttonText);
        c.check('POST /checkout/place-order 201', r.placed.status === 201, r.placed.status);
        c.check('màn thành công', /Đặt hàng thành công|đặt thành công|Cảm ơn/i.test(r.pageText), r.pageText.slice(0, 200));
        const o = await orderEvidence(r.placed.code);
        c.evidence('SQL đơn', o);
        c.check('DB: CONFIRMED/COD/UNPAID', o.status === 'CONFIRMED' && o.paymentMethod === 'COD' && o.paymentStatus === 'UNPAID');
        c.check('DB: subtotal 199000, couponDiscount 30000, discount 30000, shippingFee 0, total 169000', o.subtotal === 199000 && o.couponDiscount === 30000 && o.discount === 30000 && o.shippingFee === 0 && o.total === 169000);
        c.check('DB: couponCode = mã thẻ, pointsEarned 3380', o.couponCode === card && o.pointsEarned === 3380);
        c.check('DB: tổng paidTotal các dòng = total - ship', o.items.reduce((x, i) => x + (i.paidTotal ?? 0), 0) === o.total - o.shippingFee, o.items);
        const cs = await couponState(card);
        c.evidence('SQL mã thẻ', cs);
        c.check('DB: 1 lượt dùng, usedCount 1/1', cs.redemptions === 1 && cs.usedCount === 1 && o.redemptions.length === 1);
        const stock1 = { dw: await stockOf('FUWA-DW-1L'), gl: await stockOf('FUWA-GL-500') };
        c.evidence('tồn kho trước/sau', { stock0, stock1 });
        c.check('DB: tồn kho mỗi SKU giảm 1', stock1.dw.stock === stock0.dw.stock - 1 && stock1.gl.stock === stock0.gl.stock - 1);
        const cart = await api(L, 'GET', '/cart', { user: u.id });
        c.check('giỏ trống sau đặt', (cart.body?.items ?? []).length === 0);
        await waitPancakePush(r.placed.code);
        const fp = await fakePancakeOrder(r.placed.code);
        c.evidence('giả Pancake', fp && { id: fp.id, cod: fp.cod, total_discount: fp.total_discount, shipping_fee: fp.shipping_fee, custom_id: fp.custom_id });
        c.check('giả Pancake nhận đơn, cod 169.000', fp && Number(fp.cod) === 169000, fp?.cod);
      } finally {
        await s.close();
      }
    },
  },
  {
    id: 'U1-12',
    role: 'Khách mới / khách quay lại',
    journey: 'Mã thẻ sai điều kiện: đơn dưới 199k, giỏ chỉ hàng giờ vàng, khách cũ gõ mã thẻ ở giỏ',
    steps:
      '(a) khách mới giỏ 194.000đ (COBOTE-DC-50 + SOK-RC-1KG) gõ mã thẻ; (b) khách mới giỏ chỉ BHN-HN-500 giờ vàng 195k×2 gõ mã thẻ; (c) uat_returning gõ một mã thẻ chưa ai nhận',
    expected:
      '(a) "Đơn tối thiểu 199.000đ để dùng mã này." (b) lời báo hàng giờ vàng không tính vào đơn tối thiểu (c) "Mã này chỉ dành cho khách đặt đơn đầu tiên tại Tubu Tree." và mã KHÔNG bị khách cũ giữ (0 dòng coupon_claims); giỏ không gắn mã',
    async run(c) {
      const card = await unusedCardCode();
      const u = await freshCustomer('c12');
      await addToCart(u.id, 'COBOTE-DC-50', 1);
      await addToCart(u.id, 'SOK-RC-1KG', 1);
      let s = await open(L.n, u.id, { browser: BROWSER, path: '/cart' });
      try {
        await dismissOnboarding(s.page);
        const a = await applyVoucherUI(s.page, card);
        c.evidence('(a) 194k', a);
        c.evidence('(a) ảnh', await shot(s.page, 'U1-12a-card-min-order'));
        c.check('(a) báo "Đơn tối thiểu 199.000đ để dùng mã này."', a.status === 400 && /Đơn tối thiểu 199\.000đ/.test(a.message ?? '') && (a.snack ?? '').includes('199.000đ'), a);
      } finally {
        await s.close();
      }
      await clearCart(u.id);
      await addToCart(u.id, 'BHN-HN-500', 2);
      s = await open(L.n, u.id, { browser: BROWSER, path: '/cart' });
      try {
        await dismissOnboarding(s.page);
        const b = await applyVoucherUI(s.page, card);
        c.evidence('(b) chỉ hàng giờ vàng 390k', b);
        c.check('(b) báo hàng giờ vàng không tính', b.status === 400 && /giờ vàng/i.test(b.message ?? ''), b.message);
      } finally {
        await s.close();
      }
      const before = await couponState(card);
      await clearCart('uat_returning');
      await addToCart('uat_returning', 'FUWA-DW-5L', 1);
      s = await open(L.n, 'returning', { browser: BROWSER, path: '/cart' });
      try {
        const r = await applyVoucherUI(s.page, card);
        c.evidence('(c) khách cũ', r);
        c.evidence('(c) ảnh', await shot(s.page, 'U1-12c-card-returning'));
        c.check('(c) báo chỉ khách mới', r.status === 400 && r.message === 'Mã này chỉ dành cho khách đặt đơn đầu tiên tại Tubu Tree.', r.message);
        const after = await couponState(card);
        c.check('(c) DB: khách cũ không giữ được thẻ (claims không đổi)', after.claims === before.claims, { before, after });
        const [cart] = await sql(`SELECT "couponCode" FROM carts WHERE "userId" = 'uat_returning'`);
        c.check('(c) giỏ không gắn mã', !cart.couponCode, cart);
      } finally {
        await s.close();
        await clearCart('uat_returning');
      }
    },
  },
  {
    id: 'U1-13',
    role: 'Khách mới (voucher chào mừng cấp lúc tạo tài khoản)',
    journey: 'Voucher chào mừng ở đơn 1, WELCOME30 ở đơn 2 (luật A4: chấp nhận giảm hai lần), WELCOME30 lần 2 bị chặn',
    steps:
      'Đơn 1: giỏ 199.000đ → chọn "Quà chào mừng thành viên mới" từ ví → COD. Đơn 2: giỏ 210.000đ (FUWA-LD-2L) → gõ WELCOME30 → COD. Đơn 3: giỏ 210.000đ → gõ WELCOME30',
    expected:
      'Đơn 1: giảm 30.000đ, ship 0 (freeship đơn đầu), tổng 169.000đ. Đơn 2: giảm 30.000đ, không còn freeship đơn đầu → tiền hàng 210k ≥ 200k ngưỡng chung → ship 0, tổng 180.000đ. Đơn 3: "Bạn đã dùng hết lượt cho mã này." DB: WELCOME-<id> usedCount 1/1, WELCOME30 1 lượt của khách',
    async run(c) {
      const u = await freshCustomer('c13', { welcome: true });
      c.evidence('cấp voucher chào mừng', u.welcome);
      await addAddress(u);
      await addToCart(u.id, 'FUWA-DW-1L', 1);
      await addToCart(u.id, 'FUWA-GL-500', 1);
      let s = await open(L.n, u.id, { browser: BROWSER, path: '/cart' });
      let o1;
      try {
        const r = await buyFlow(c, s, { fromList: 'Quà chào mừng thành viên mới', shotName: 'U1-13-o1' });
        c.check('đơn 1: áp voucher chào mừng', r.applied.status < 300 && /^WELCOME-/.test(r.applied.body?.couponCode ?? ''), r.applied.body?.couponCode);
        c.check('đơn 1: giảm 30.000đ, ship 0, tổng 169.000đ', r.quote.discount === 30000 && r.quote.shippingFee === 0 && r.quote.total === 169000, r.quote);
        o1 = await orderEvidence(r.placed.code);
        c.evidence('SQL đơn 1', o1);
        c.check('DB đơn 1: couponCode WELCOME-…, total 169000, redemption 1', /^WELCOME-/.test(o1.couponCode) && o1.total === 169000 && o1.redemptions.length === 1 && o1.redemptions[0].usedCount === 1);
      } finally {
        await s.close();
      }
      await addToCart(u.id, 'FUWA-LD-2L', 1);
      s = await open(L.n, u.id, { browser: BROWSER, path: '/cart' });
      try {
        const r = await buyFlow(c, s, { code: 'WELCOME30', shotName: 'U1-13-o2' });
        c.check('đơn 2: WELCOME30 áp được (khách mới giảm lần hai — A4)', r.applied.status < 300 && r.applied.body?.couponCode === 'WELCOME30');
        c.check('đơn 2: giảm 30.000đ, ship 0 (210k ≥ 200k), tổng 180.000đ', r.quote.discount === 30000 && r.quote.shippingFee === 0 && r.quote.total === 180000 && r.quote.firstOrderShipWaived === 0, r.quote);
        const o2 = await orderEvidence(r.placed.code);
        c.evidence('SQL đơn 2', o2);
        c.check('DB đơn 2: WELCOME30, couponDiscount 30000, total 180000', o2.couponCode === 'WELCOME30' && o2.couponDiscount === 30000 && o2.total === 180000);
      } finally {
        await s.close();
      }
      await addToCart(u.id, 'FUWA-LD-2L', 1);
      s = await open(L.n, u.id, { browser: BROWSER, path: '/cart' });
      try {
        await dismissOnboarding(s.page);
        const r = await applyVoucherUI(s.page, 'WELCOME30');
        c.evidence('đơn 3: WELCOME30 lần 2', r);
        c.check('đơn 3: "Bạn đã dùng hết lượt cho mã này."', r.status === 400 && r.message === 'Bạn đã dùng hết lượt cho mã này.' && (r.snack ?? '').includes('hết lượt'), r);
        const [n] = await sql(`SELECT COUNT(*)::int AS n FROM coupon_redemptions r JOIN coupons c ON c.id=r."couponId" WHERE c.code='WELCOME30' AND r."userId"=$1`, u.id);
        c.check('DB: WELCOME30 đúng 1 lượt của khách', n.n === 1, n);
      } finally {
        await s.close();
        await clearCart(u.id);
      }
    },
  },
  {
    id: 'U1-14',
    role: 'Khách mới / khách đã có 1 đơn hạng Mầm Xanh',
    journey: 'FREESHIP: chồng lên freeship đơn đầu (không được gì) và dùng cho đơn thường dưới ngưỡng',
    steps:
      '(a) khách mới giỏ 199.000đ gõ FREESHIP → thanh toán → đặt COD; (b) khách đã có 1 đơn, giỏ FUWA-DW-1L 120.000đ: thanh toán không mã (xem phí) rồi gõ FREESHIP → đặt COD',
    expected:
      '(a) snackbar giỏ KHÔNG ghi "Đã áp dụng mã FREESHIP" mà báo "Mã chưa được áp dụng cho đơn này: Đơn từ 199.000đ đã được miễn phí giao, mã FREESHIP được giữ cho đơn sau." (sau Q12); couponNotice của báo giá cùng lý do; đơn KHÔNG ghi couponCode, không tốn lượt FREESHIP; (b) không mã: phí 19.000đ (120k < 200k); có FREESHIP: phí 0, tổng 120.000đ, DB 1 lượt FREESHIP',
    async run(c) {
      const u = await freshCustomer('c14a');
      await addAddress(u);
      await addToCart(u.id, 'FUWA-DW-1L', 1);
      await addToCart(u.id, 'FUWA-GL-500', 1);
      let s = await open(L.n, u.id, { browser: BROWSER, path: '/cart' });
      try {
        const r = await buyFlow(c, s, { code: 'FREESHIP', shotName: 'U1-14a' });
        c.evidence('(a) snackbar áp FREESHIP', r.applied.snack);
        const NOTICE_A = 'Mã chưa được áp dụng cho đơn này: Đơn từ 199.000đ đã được miễn phí giao, mã FREESHIP được giữ cho đơn sau.';
        c.check('(a) snackbar giỏ: đúng câu "chưa được áp dụng", không còn "Đã áp dụng mã FREESHIP"', r.applied.snack === NOTICE_A && !/Đã áp dụng mã/.test(r.applied.snack), r.applied.snack);
        c.check('(a) báo giá: couponApplied=false + couponNotice cùng lý do', r.quote.couponApplied === false && r.quote.couponNotice === NOTICE_A, { couponApplied: r.quote.couponApplied, couponNotice: r.quote.couponNotice });
        c.check('(a) ship 0 nhờ freeship đơn đầu, tổng 199.000đ', r.quote.shippingFee === 0 && r.quote.total === 199000);
        const o = await orderEvidence(r.placed.code);
        c.evidence('(a) SQL đơn', o);
        c.check('(a) DB: đơn không ghi couponCode, không có lượt FREESHIP', o.couponCode === null && o.redemptions.length === 0);
      } finally {
        await s.close();
      }
      const v = await freshCustomer('c14b');
      await addAddress(v);
      const first = await quickOrderApi(v.id, 'SOK-RC-1KG', 3);
      c.evidence('(b) đơn đầu qua API', { code: first.code, total: first.quote.total });
      await addToCart(v.id, 'FUWA-DW-1L', 1);
      s = await open(L.n, v.id, { browser: BROWSER, path: '/cart' });
      try {
        const r0 = await buyFlow(c, s, { place: false, shotName: 'U1-14b-nocoupon' });
        c.check('(b) không mã: phí 19.000đ, tổng 139.000đ', r0.quote.shippingFee === 19000 && r0.quote.total === 139000, r0.quote);
        await s.goto('/cart');
        const r = await buyFlow(c, s, { code: 'FREESHIP', shotName: 'U1-14b-freeship' });
        c.check('(b) FREESHIP: phí 0, tổng 120.000đ', r.quote.shippingFee === 0 && r.quote.total === 120000 && r.quote.couponApplied === true, r.quote);
        const o = await orderEvidence(r.placed.code);
        c.evidence('(b) SQL đơn', o);
        c.check('(b) DB: couponCode FREESHIP, shippingFee 0, total 120000, 1 lượt', o.couponCode === 'FREESHIP' && o.shippingFee === 0 && o.total === 120000 && o.redemptions.length === 1);
      } finally {
        await s.close();
      }
    },
  },
  {
    id: 'U1-15',
    role: 'Khách quay lại hạng Mầm Xanh (đã có đơn)',
    journey: 'XANH10: dưới đơn tối thiểu 250k; đơn lớn chạm trần 50k',
    steps: '(a) giỏ 199.000đ gõ XANH10; (b) giỏ VIS-SR-50 460k + FUWA-BT-500 135k = 595.000đ gõ XANH10 → COD',
    expected: '(a) "Đơn tối thiểu 250.000đ để dùng mã này." (b) 10% = 59.500đ kẹp trần 50.000đ; tổng 545.000đ; DB couponDiscount 50000; điểm 2% × 545.000 = 10.900',
    async run(c) {
      const u = await freshCustomer('c15');
      await addAddress(u);
      await quickOrderApi(u.id, 'SOK-RC-1KG', 3);
      await addToCart(u.id, 'FUWA-DW-1L', 1);
      await addToCart(u.id, 'FUWA-GL-500', 1);
      let s = await open(L.n, u.id, { browser: BROWSER, path: '/cart' });
      try {
        await dismissOnboarding(s.page);
        const a = await applyVoucherUI(s.page, 'XANH10');
        c.evidence('(a)', a);
        c.check('(a) "Đơn tối thiểu 250.000đ để dùng mã này."', a.status === 400 && a.message === 'Đơn tối thiểu 250.000đ để dùng mã này.', a.message);
      } finally {
        await s.close();
      }
      await clearCart(u.id);
      await addToCart(u.id, 'VIS-SR-50', 1);
      await addToCart(u.id, 'FUWA-BT-500', 1);
      s = await open(L.n, u.id, { browser: BROWSER, path: '/cart' });
      try {
        const r = await buyFlow(c, s, { code: 'XANH10', shotName: 'U1-15b' });
        c.check('(b) giảm 50.000đ (trần), ship 0, tổng 545.000đ', r.quote.discount === 50000 && r.quote.shippingFee === 0 && r.quote.total === 545000, r.quote);
        c.check('(b) điểm dự kiến 10.900', r.quote.pointsEarned === pts(545000), r.quote.pointsEarned);
        const o = await orderEvidence(r.placed.code);
        c.evidence('(b) SQL đơn', o);
        c.check('(b) DB: couponDiscount 50000, total 545000, pointsEarned 10900', o.couponDiscount === 50000 && o.total === 545000 && o.pointsEarned === 10900 && o.couponCode === 'XANH10');
      } finally {
        await s.close();
      }
    },
  },
  {
    id: 'U1-16',
    role: 'Khách mới',
    journey: 'Mã hết hạn / hết lượt / ngừng áp dụng / sai hạng / không tồn tại báo đúng chữ',
    steps:
      'Admin tạo qua POST /admin/coupons: U1EXP (lùi endAt về hôm qua), U1ONE (usageLimit 1, khách khác đã dùng), U1OFF (PATCH isActive=false), U1TIER (scope TIER CO_THU); khách mới giỏ 199k lần lượt gõ từng mã + U1KHONGCO',
    expected:
      'U1EXP "Mã giảm giá đã hết hạn hoặc chưa hiệu lực."; U1ONE "Mã giảm giá đã hết lượt sử dụng."; U1OFF "Mã giảm giá đã ngừng áp dụng."; U1TIER "Mã chỉ áp dụng cho hạng thành viên khác."; U1KHONGCO "Mã giảm giá không tồn tại."; giỏ không gắn mã',
    async run(c) {
      const sfx = Date.now().toString(36).slice(-4).toUpperCase();
      const now = Date.now();
      const base = { type: 'AMOUNT', value: 20000, minOrder: 100000, startAt: new Date(now - 864e5 * 2).toISOString(), endAt: new Date(now + 864e5 * 10).toISOString(), scope: 'PUBLIC', perUserLimit: 1 };
      const mk = async (code, extra = {}) => apiOk(L, 'POST', '/admin/coupons', { ...ADMIN, body: { ...base, code, ...extra } });
      const exp = await mk(`U1EXP${sfx}`);
      await sql(`UPDATE coupons SET "endAt" = now() - interval '1 day' WHERE id = $1 RETURNING code`, exp.id);
      const one = await mk(`U1ONE${sfx}`, { usageLimit: 1 });
      const off = await mk(`U1OFF${sfx}`);
      await apiOk(L, 'PATCH', `/admin/coupons/${off.id}`, { ...ADMIN, body: { isActive: false } });
      await mk(`U1TIER${sfx}`, { scope: 'TIER', scopeMeta: { tierId: 'CO_THU' } });
      const other = await freshCustomer('c16o');
      await addAddress(other);
      await addToCart(other.id, 'FUWA-DW-1L', 1);
      await apiOk(L, 'POST', '/cart/coupon', { user: other.id, body: { code: `U1ONE${sfx}` } });
      const oq = await apiOk(L, 'POST', '/checkout/quote', { user: other.id, body: { addressId: (await apiOk(L, 'GET', '/me/addresses', { user: other.id }))[0].id } });
      const oo = await apiOk(L, 'POST', '/checkout/place-order', { user: other.id, body: { addressId: (await apiOk(L, 'GET', '/me/addresses', { user: other.id }))[0].id, paymentMethod: 'COD', expectedTotal: oq.total }, headers: { 'idempotency-key': `u1c16-${sfx}` } });
      c.evidence('khách khác dùng hết U1ONE', { order: oo.code, coupon: await couponState(`U1ONE${sfx}`) });
      const u = await freshCustomer('c16');
      await addToCart(u.id, 'FUWA-DW-1L', 1);
      await addToCart(u.id, 'FUWA-GL-500', 1);
      const want = {
        [`U1EXP${sfx}`]: 'Mã giảm giá đã hết hạn hoặc chưa hiệu lực.',
        [`U1ONE${sfx}`]: 'Mã giảm giá đã hết lượt sử dụng.',
        [`U1OFF${sfx}`]: 'Mã giảm giá đã ngừng áp dụng.',
        [`U1TIER${sfx}`]: 'Mã chỉ áp dụng cho hạng thành viên khác.',
        U1KHONGCO: 'Mã giảm giá không tồn tại.',
      };
      const s = await open(L.n, u.id, { browser: BROWSER, path: '/cart' });
      try {
        await dismissOnboarding(s.page);
        for (const [code, msg] of Object.entries(want)) {
          const r = await applyVoucherUI(s.page, code);
          c.evidence(code, { status: r.status, message: r.message, snackbar: r.snack });
          c.check(`${code} → "${msg}" (API + snackbar)`, r.status === 400 && r.message === msg && (r.snack ?? '').includes(msg), { message: r.message, snack: r.snack });
        }
        c.evidence('ảnh', await shot(s.page, 'U1-16-coupon-errors'));
        const [cart] = await sql(`SELECT "couponCode" FROM carts WHERE "userId" = $1`, u.id);
        c.check('giỏ không gắn mã nào', !cart.couponCode, cart);
      } finally {
        await s.close();
      }
    },
  },
  {
    id: 'U1-17',
    role: 'Khách mới',
    journey: 'Chồng mã: mỗi đơn 1 mã (mã sau thay mã trước), mã + freeship đơn đầu cùng áp',
    steps: 'Giỏ 278.000đ (FUWA-DW-1L 120k + FUWA-GL-500 79k + COBOTE-PW-100 79k) → áp WELCOME30 → áp XANH10 → thanh toán → đặt COD',
    expected:
      'Sau mã thứ hai giỏ chỉ còn XANH10 (carts.couponCode), sheet ghi "Mỗi đơn hàng chỉ áp dụng 1 mã giảm giá"; báo giá giảm 27.800đ (10%) và ship 0, tổng 250.200đ; đơn ghi 1 mã, 0 lượt WELCOME30',
    async run(c) {
      const u = await freshCustomer('c17');
      await addAddress(u);
      for (const sku of ['FUWA-DW-1L', 'FUWA-GL-500', 'COBOTE-PW-100']) await addToCart(u.id, sku, 1);
      const s = await open(L.n, u.id, { browser: BROWSER, path: '/cart' });
      try {
        await dismissOnboarding(s.page);
        const a = await applyVoucherUI(s.page, 'WELCOME30');
        c.check('áp WELCOME30', a.status < 300 && a.body?.couponCode === 'WELCOME30');
        const r = await buyFlow(c, s, { code: 'XANH10', shotName: 'U1-17' });
        c.check('sheet có câu "Mỗi đơn hàng chỉ áp dụng 1 mã giảm giá"', a.sheetNote && r.applied.sheetNote);
        c.check('mã sau thay mã trước: giỏ = XANH10', r.applied.body?.couponCode === 'XANH10');
        c.check('báo giá: giảm 27.800đ, ship 0, tổng 250.200đ', r.quote.discount === 27800 && r.quote.shippingFee === 0 && r.quote.total === 250200, r.quote);
        const o = await orderEvidence(r.placed.code);
        c.evidence('SQL đơn', o);
        c.check('DB: đơn 1 mã XANH10, 1 lượt, couponDiscount 27800, total 250200', o.couponCode === 'XANH10' && o.redemptions.length === 1 && o.couponDiscount === 27800 && o.total === 250200);
        const [w] = await sql(`SELECT COUNT(*)::int AS n FROM coupon_redemptions r JOIN coupons c ON c.id=r."couponId" WHERE c.code='WELCOME30' AND r."userId"=$1`, u.id);
        c.check('DB: 0 lượt WELCOME30', w.n === 0);
      } finally {
        await s.close();
      }
    },
  },
];

await runCases(cases);
