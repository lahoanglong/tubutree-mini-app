#!/usr/bin/env node
// U2-01..U2-06: tích Điểm Xanh đơn app theo hạng, điểm chờ (khoá hết cửa sổ đổi/trả), dùng điểm (trần 20%), lên hạng theo ngưỡng.
// Dùng: node u2-a-earn.mjs [lane=7] [--headed] [--only U2-01,U2-03]
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import {
  L, prisma, kase, main, ledger, rowsFor, ensureCustomer, fillCart, miniCheckout, apiPlace, deliver, backdateOrder, runJob,
  loyaltyOf, pct, shotPage, q, x, api, HARNESS, waitPushed, log, sendOrderStatus,
} from './u2lib.mjs';

const only = (() => {
  const i = process.argv.indexOf('--only');
  return i > 0 ? new Set(process.argv[i + 1].split(',')) : null;
})();
const want = (id) => !only || only.has(id);

/** Đơn app 199.000đ của khách đã có hạng, đặt trên Mini App, giao xong, đối chiếu điểm = 2% tiền hàng sau giảm × hệ số. */
async function earnCase(c, { user, mult, lines, coupon, expectGoods, expectShip, shot }) {
  const before = await ledger(user);
  c.ev('trước', before);
  const cp = await fillCart(user, lines, coupon);
  if (coupon) c.check(`áp mã ${coupon} vào giỏ`, cp && cp.status < 300, { status: cp?.status, body: cp?.body?.message ?? undefined });
  const r = await miniCheckout(user, { shot });
  c.ev('báo giá màn checkout', r.quote && { subtotal: r.quote.subtotal, discount: r.quote.discount, tierDiscount: r.quote.tierDiscount, shippingFee: r.quote.shippingFee, total: r.quote.total, pointsEarned: r.quote.pointsEarned });
  c.ev('nút đặt', r.label);
  c.check('Mini App: đặt đơn 201, không request lỗi/ra ngoài', r.status < 300 && r.code && r.bad.length === 0 && r.blocked.length === 0, { status: r.status, code: r.code, bad: r.bad, blocked: r.blocked });
  const goods = r.quote.subtotal - (r.quote.discount ?? 0) - (r.quote.tierDiscount ?? 0) - (r.quote.comboDiscount ?? 0) - (r.quote.pointsDiscount ?? 0);
  const expectPts = pct(expectGoods, 2, mult);
  c.check(`báo giá: tiền hàng sau giảm ${expectGoods}đ, phí giao ${expectShip}đ`, goods === expectGoods && r.quote.shippingFee === expectShip, { goods, shippingFee: r.quote.shippingFee });
  c.check(`báo giá: pointsEarned = floor(${expectGoods} × 2% × ${mult}) = ${expectPts} (không tính ship)`, r.quote.pointsEarned === expectPts, { pointsEarned: r.quote.pointsEarned });
  const order = await prisma.order.findUnique({ where: { code: r.code }, select: { id: true, total: true, shippingFee: true, pointsEarned: true, status: true, discount: true } });
  c.check('DB: orders.pointsEarned = báo giá', order.pointsEarned === expectPts, order);
  c.ev('giao', await deliver(r.code));
  const rows = await rowsFor(user, `ORDER_DELIVERED:${r.code}`);
  const after = await ledger(user);
  c.ev('sổ sau giao', { rows, after });
  // Pancake gửi lại webhook "delivered" (thử lại/trùng) và job resync chạy: không được cộng lần hai
  await sendOrderStatus(L, r.code, 'delivered');
  runJob('DeliveredEffectsResyncCron.resyncPending');
  const rowsAgain = await rowsFor(user, `ORDER_DELIVERED:${r.code}`);
  c.check('webhook delivered lặp + job resync: vẫn 1 dòng', rowsAgain.length === 1, rowsAgain.length);
  c.check('SQL: đúng 1 dòng ORDER_DELIVERED:<mã> = pointsEarned', rows.length === 1 && rows[0].delta === expectPts && rows[0].refId === order.id, rows.map((x) => x.delta));
  c.check('SQL: số dư = trước + điểm đơn = SUM(delta STANDARD)', after.balance === before.balance + expectPts && after.balance === after.stdSum, { before: before.balance, after: after.balance, stdSum: after.stdSum });
  const exp = rows[0]?.expiresAt && rows[0]?.createdAt ? (new Date(rows[0].expiresAt).getTime() - new Date(rows[0].createdAt).getTime()) / 86_400_000 : null;
  c.check('SQL: hạn dòng điểm = ngày cộng + 12 tháng (365/366 ± 1 ngày)', exp !== null && exp >= 364 && exp <= 367, { days: exp && Number(exp.toFixed(2)), expiresAt: rows[0]?.expiresAt });
  return { code: r.code, order, quote: r.quote, before, after, points: expectPts };
}

await main(async (results) => {
  // ── Dựng: khách Mầm Xanh đã có 1 đơn giao (hạng chỉ được gán ở đơn DELIVERED đầu tiên) ──
  const MAM = 'uat_u2_mam';
  await ensureCustomer({ id: MAM, name: 'Khách U2 Mầm Xanh', phone: '0901000021' });
  if (!(await prisma.order.findFirst({ where: { userId: MAM, status: 'DELIVERED' } }))) {
    const first = await apiPlace(MAM, [['VIS-MASK-1', 1]]);
    await deliver(first.code);
    log('dựng', `khách Mầm Xanh: đơn đầu ${first.code} (25.000đ) đã giao`);
  }

  if (want('U2-01')) {
    const c = kase('U2-01', 'Mầm Xanh: đơn app 199.000đ, phí giao 19.000đ → 3.980 điểm (×1, không tính ship)');
    try {
      const u = await prisma.user.findUnique({ where: { id: MAM }, select: { tierId: true } });
      c.check('khách đang hạng Mầm Xanh (MAM_XANH)', u.tierId === 'MAM_XANH', u);
      const r = await earnCase(c, { user: MAM, mult: 1, lines: [['FUWA-DW-1L', 1], ['FUWA-GL-500', 1]], expectGoods: 199000, expectShip: 19000, shot: 'U2-01' });
      c.check('đúng ví dụ luật: 199.000đ Mầm Xanh = 3.980 điểm', r.points === 3980, r.points);
      c.ev('mã đơn', r.code);
    } catch (e) {
      c.error(e);
    }
    results.push(c.finish());
  }

  if (want('U2-02')) {
    const c = kase('U2-02', 'Lộc Biếc: 289.000đ, mã XANH10 giảm 28.900đ → 2% × 1,2 trên 260.100đ = 6.242 điểm');
    try {
      const r = await earnCase(c, { user: 'uat_returning', mult: 1.2, lines: [['FUWA-LD-2L', 1], ['FUWA-GL-500', 1]], coupon: 'XANH10', expectGoods: 260100, expectShip: 0, shot: 'U2-02' });
      c.ev('mã đơn', r.code);
    } catch (e) {
      c.error(e);
    }
    results.push(c.finish());
  }

  // ── Dựng + U2-06b: khách lên Đại Thụ bằng đơn thật ≥ 20.000.000đ (chuyển khoản, Pancake đối soát, giao) ──
  const DT = 'uat_u2_daithu';
  await ensureCustomer({ id: DT, name: 'Khách U2 Đại Thụ', phone: '0901000022' });
  if (want('U2-06b')) {
    const c = kase('U2-06b', 'Lên hạng theo ngưỡng chi tiêu 12 tháng: đơn 20.250.000đ giao xong → Đại Thụ (ngưỡng 20.000.000đ)');
    try {
      const had = await prisma.order.findFirst({ where: { userId: DT, status: 'DELIVERED' } });
      if (!had) {
        const big = await apiPlace(DT, [['VIS-SR-50', 30], ['FUWA-DW-5L', 15]], { paymentMethod: 'BANK_TRANSFER' });
        c.ev('đơn lớn', { code: big.code, subtotal: big.quote.subtotal, total: big.quote.total, pointsEarned: big.quote.pointsEarned });
        await waitPushed(big.code);
        const paid = execFileSync('node', [path.join(HARNESS, 'bank-webhook.mjs'), String(L.n), big.code, String(big.quote.total)], { encoding: 'utf8' });
        c.ev('chuyển khoản', JSON.parse(paid).order ?? JSON.parse(paid));
        c.ev('giao', await deliver(big.code));
      }
      const u = await prisma.user.findUnique({ where: { id: DT }, select: { tierId: true } });
      const lo = await loyaltyOf(DT);
      c.ev('/me/loyalty', { tier: lo.tier?.id, spent12m: lo.spent12m, earnMultiplier: lo.earnMultiplier, nextTier: lo.nextTier });
      c.check('DB: tierId = DAI_THU sau đơn giao đầu (spent12m ≥ 20.000.000)', u.tierId === 'DAI_THU' && lo.spent12m >= 20_000_000, { tierId: u.tierId, spent12m: lo.spent12m });
      c.check('/me/loyalty: earnMultiplier 1,5', lo.earnMultiplier === 1.5, lo.earnMultiplier);
      const firstPts = await rowsFor(DT, 'ORDER_DELIVERED:%');
      c.ev('điểm đơn lớn', firstPts.map((r) => ({ delta: r.delta, reason: r.reason })));
    } catch (e) {
      c.error(e);
    }
    results.push(c.finish());
  }

  if (want('U2-03')) {
    const c = kase('U2-03', 'Đại Thụ: đơn app 199.000đ → 199.000 × 2% × 1,5 = 5.970 điểm');
    try {
      const u = await prisma.user.findUnique({ where: { id: DT }, select: { tierId: true } });
      if (u.tierId !== 'DAI_THU') {
        c.block(`khách chưa lên Đại Thụ (tierId=${u.tierId}) — xem U2-06b`);
      } else {
        const r = await earnCase(c, { user: DT, mult: 1.5, lines: [['FUWA-DW-1L', 1], ['FUWA-GL-500', 1]], expectGoods: 199000, expectShip: 0, shot: 'U2-03' });
        c.check('đúng 5.970 điểm', r.points === 5970, r.points);
        c.ev('mã đơn', r.code);
      }
    } catch (e) {
      c.error(e);
    }
    results.push(c.finish());
  }

  if (want('U2-04')) {
    const c = kase('U2-04', 'Điểm chờ: đơn vừa giao bị khoá tới hết cửa sổ đổi/trả 7 ngày; lùi mốc giao 8 ngày → dùng được');
    try {
      const user = MAM;
      const last = await prisma.order.findFirst({ where: { userId: user, status: 'DELIVERED' }, orderBy: { deliveredAt: 'desc' }, select: { code: true, pointsEarned: true, deliveredAt: true } });
      const lo1 = await loyaltyOf(user);
      const led1 = await ledger(user);
      c.ev('đơn mới giao', last);
      c.ev('/me/loyalty trước', { pointsBalance: lo1.pointsBalance, lockedPoints: lo1.lockedPoints, redeemablePoints: lo1.redeemablePoints, lockedUntil: lo1.lockedUntil });
      c.check('/me/loyalty: lockedPoints gồm điểm đơn vừa giao, redeemable = số dư − khoá', lo1.lockedPoints >= last.pointsEarned && lo1.redeemablePoints === lo1.pointsBalance - lo1.lockedPoints && lo1.pointsBalance === led1.balance, { locked: lo1.lockedPoints, redeemable: lo1.redeemablePoints, bal: lo1.pointsBalance });
      const unlock = new Date(new Date(last.deliveredAt).getTime() + 7 * 86_400_000);
      c.check('lockedUntil = giao + 7 ngày', lo1.lockedUntil && Math.abs(new Date(lo1.lockedUntil).getTime() - unlock.getTime()) < 120_000, { lockedUntil: lo1.lockedUntil, expect: unlock.toISOString() });
      const shot1 = await shotPage(user, '/loyalty', 'U2-04-loyalty-locked');
      const lockedLine = shot1.text.split('\n').filter((t) => /khoá|khóa|chờ|dùng được|đổi\/trả/i.test(t)).slice(0, 6);
      c.ev('màn /loyalty (khoá)', { shot: shot1.file, lines: lockedLine });
      // Checkout: số điểm dùng được không gồm phần khoá
      await fillCart(user, [['FUWA-HW-500', 1]]);
      const addressId = (await prisma.address.findFirst({ where: { userId: user, isDefault: true } })).id;
      const qq = await api(L, 'POST', '/checkout/quote', { user, body: { addressId, pointsToUse: lo1.pointsBalance } });
      c.check('báo giá: redeemablePoints = số dư − khoá; điểm dùng ≤ phần dùng được', qq.body.redeemablePoints === lo1.redeemablePoints && qq.body.pointsUsed <= lo1.redeemablePoints, { redeemablePoints: qq.body.redeemablePoints, lockedPoints: qq.body.lockedPoints, pointsUsed: qq.body.pointsUsed });
      // Lùi mốc giao 8 ngày (hết cửa sổ) — tính lúc đọc, không cần job
      for (const o of await prisma.order.findMany({ where: { userId: user, status: 'DELIVERED', deliveredAt: { gt: new Date(Date.now() - 7 * 86_400_000) } }, select: { code: true } })) await backdateOrder(o.code, 8);
      const lo2 = await loyaltyOf(user);
      c.ev('/me/loyalty sau lùi 8 ngày', { pointsBalance: lo2.pointsBalance, lockedPoints: lo2.lockedPoints, redeemablePoints: lo2.redeemablePoints });
      c.check('sau hết cửa sổ: lockedPoints 0, redeemable = số dư', lo2.lockedPoints === 0 && lo2.redeemablePoints === lo2.pointsBalance, lo2.lockedPoints);
      const job = runJob('DeliveredEffectsResyncCron.resyncPending');
      c.ev('job resyncPending', job.result);
      const led2 = await ledger(user);
      c.check('SQL: số dư không đổi khi mở khoá (khoá chỉ là phép đọc), = SUM sổ', led2.balance === led1.balance && led2.balance === led2.stdSum, { before: led1.balance, after: led2.balance, stdSum: led2.stdSum });
      const shot2 = await shotPage(user, '/loyalty', 'U2-04-loyalty-unlocked');
      c.ev('màn /loyalty (mở)', shot2.file);
    } catch (e) {
      c.error(e);
    }
    results.push(c.finish());
  }

  if (want('U2-05')) {
    const c = kase('U2-05', 'Dùng điểm trên Mini App: trần 20% tiền hàng; sổ trừ đúng, đơn ghi pointsUsed; điểm tích tính trên tiền hàng sau giảm');
    try {
      const user = 'uat_returning';
      // Mở khoá điểm các đơn U2-02 trước đó của khách (hết cửa sổ) để có đủ điểm dùng
      for (const o of await prisma.order.findMany({ where: { userId: user, status: 'DELIVERED', deliveredAt: { gt: new Date(Date.now() - 7 * 86_400_000) } }, select: { code: true } })) await backdateOrder(o.code, 8);
      const before = await ledger(user);
      const lo = await loyaltyOf(user);
      c.ev('trước', { ...before, redeemable: lo.redeemablePoints, maxRedeemPct: lo.rates?.maxRedeemPct });
      await fillCart(user, [['FUWA-DW-1L', 1]]);
      const r = await miniCheckout(user, { usePoints: true, shot: 'U2-05' });
      c.ev('báo giá', r.quote && { subtotal: r.quote.subtotal, pointsUsed: r.quote.pointsUsed, pointsDiscount: r.quote.pointsDiscount, pointsMax: r.quote.pointsMax, shippingFee: r.quote.shippingFee, total: r.quote.total, pointsEarned: r.quote.pointsEarned });
      c.check('Mini App: bật Điểm Xanh, đặt đơn 201', r.status < 300 && r.code && r.bad.length === 0, { status: r.status, code: r.code, bad: r.bad });
      const cap = Math.floor(120000 * 0.2);
      c.check(`trần: pointsUsed = min(dùng được ${lo.redeemablePoints}, 20% × 120.000 = ${cap})`, r.quote.pointsUsed === Math.min(cap, lo.redeemablePoints) && r.quote.pointsDiscount === r.quote.pointsUsed, { pointsUsed: r.quote.pointsUsed, pointsDiscount: r.quote.pointsDiscount });
      const o = await prisma.order.findUnique({ where: { code: r.code }, select: { id: true, pointsUsed: true, pointsUsedConverted: true, total: true, pointsEarned: true, discount: true } });
      const spend = await q(`SELECT delta::int AS delta, reason FROM points_transactions WHERE "userId" = $1 AND "refId" = $2 AND delta < 0`, user, o.id);
      const after = await ledger(user);
      c.ev('đơn + sổ', { order: o, spend, after });
      c.check('SQL: một dòng trừ điểm = −pointsUsed; số dư = trước − pointsUsed = SUM sổ', spend.length === 1 && spend[0].delta === -o.pointsUsed && after.balance === before.balance - o.pointsUsed && after.balance === after.stdSum, { spend, before: before.balance, after: after.balance, stdSum: after.stdSum });
      c.check('điểm tích của đơn dùng điểm = 2% × 1,2 × (120.000 − điểm dùng)', o.pointsEarned === pct(120000 - o.pointsUsed, 2, 1.2), { pointsEarned: o.pointsEarned, goodsAfterPoints: 120000 - o.pointsUsed });
      c.ev('mã đơn', r.code);
      // Thử vượt trần qua API: pointsToUse lớn hơn trần bị kẹp
      await fillCart(user, [['FUWA-DW-1L', 1]]);
      const addressId = (await prisma.address.findFirst({ where: { userId: user, isDefault: true } })).id;
      const over = await api(L, 'POST', '/checkout/quote', { user, body: { addressId, pointsToUse: 999999 } });
      c.check('API: pointsToUse 999.999 bị kẹp về trần 20% (không lỗi, không vượt)', over.status < 300 && over.body.pointsUsed <= cap, { status: over.status, pointsUsed: over.body.pointsUsed });
      await fillCart(user, []);
    } catch (e) {
      c.error(e);
    }
    results.push(c.finish());
  }

  if (want('U2-06')) {
    const c = kase('U2-06', 'Lên hạng Mầm Xanh → Lộc Biếc theo ngưỡng 1.500.000đ (×1.000): dưới ngưỡng giữ hạng, đạt ngưỡng lên ngay khi giao');
    try {
      const user = MAM;
      const lo0 = await loyaltyOf(user);
      c.ev('trước', { tier: lo0.tier?.id, spent12m: lo0.spent12m, nextTier: lo0.nextTier });
      c.check('ngưỡng Lộc Biếc = 1.500.000đ, Đại Thụ 20.000.000đ, Cổ Thụ 50.000.000đ (bảng hạng)', JSON.stringify(lo0.tiers.map((t) => t.minSpending)) === JSON.stringify([null, 1500000, 20000000, 50000000]), lo0.tiers.map((t) => [t.id, t.minSpending, t.minPoints, t.multiplier]));
      // Đơn đưa chi tiêu lên ngay dưới ngưỡng
      const gap = 1_500_000 - lo0.spent12m;
      c.ev('còn thiếu', gap);
      // Đơn đưa chi tiêu tới sát dưới ngưỡng (còn thiếu 20.000–45.000đ): n × 430.000đ + m × 25.000đ, freeship (≥200k)
      const target = gap - 45_000;
      const n5 = Math.floor(target / 430_000);
      const m = Math.floor((target - n5 * 430_000) / 25_000);
      const a = await apiPlace(user, [...(n5 ? [['FUWA-DW-5L', n5]] : []), ...(m ? [['VIS-MASK-1', m]] : [])]);
      await deliver(a.code);
      const lo1 = await loyaltyOf(user);
      const t1 = await prisma.user.findUnique({ where: { id: user }, select: { tierId: true } });
      c.ev('sau đơn 1', { code: a.code, total: a.quote.total, spent12m: lo1.spent12m, tier: t1.tierId, spendingToGo: lo1.nextTier?.spendingToGo });
      c.check('chi tiêu < 1.500.000 → vẫn Mầm Xanh', lo1.spent12m < 1_500_000 && t1.tierId === 'MAM_XANH', { spent12m: lo1.spent12m, tierId: t1.tierId });
      const left = 1_500_000 - lo1.spent12m;
      // Đơn đủ bù phần thiếu: chọn sku rẻ nhất có giá ≥ phần thiếu (hoặc 2 món)
      const b = await apiPlace(user, [['FUWA-LD-2L', Math.max(1, Math.ceil(left / 210000))]]);
      c.ev('đơn 2', { code: b.code, total: b.quote.total, pointsEarned: b.quote.pointsEarned, multAtQuote: 1 });
      await deliver(b.code);
      const lo2 = await loyaltyOf(user);
      const t2 = await prisma.user.findUnique({ where: { id: user }, select: { tierId: true } });
      c.ev('sau đơn 2', { spent12m: lo2.spent12m, tier: t2.tierId, earnMultiplier: lo2.earnMultiplier });
      c.check('chi tiêu ≥ 1.500.000 → Lộc Biếc ngay khi giao (không chờ cron), hệ số 1,2', lo2.spent12m >= 1_500_000 && t2.tierId === 'LOC_BIEC' && lo2.earnMultiplier === 1.2, { spent12m: lo2.spent12m, tierId: t2.tierId, mult: lo2.earnMultiplier });
      c.check('điểm đơn vừa đưa lên hạng tính theo hệ số lúc đặt (×1)', b.quote.pointsEarned === pct(b.quote.subtotal - (b.quote.discount ?? 0), 2, 1), b.quote.pointsEarned);
      // Đơn kế tiếp nhân 1,2
      await fillCart(user, [['FUWA-DW-1L', 1], ['FUWA-GL-500', 1]]);
      const addressId = (await prisma.address.findFirst({ where: { userId: user, isDefault: true } })).id;
      const q3 = await api(L, 'POST', '/checkout/quote', { user, body: { addressId } });
      c.check('đơn kế tiếp 199.000đ báo 4.776 điểm (×1,2)', q3.body.pointsEarned === 4776, { pointsEarned: q3.body.pointsEarned, shippingFee: q3.body.shippingFee });
      c.ev('spent12m có tính phí giao', { note: 'spending12m cộng orders.total (gồm ship)', totals: await q(`SELECT code, subtotal, "shippingFee", total FROM orders WHERE "userId" = $1 AND status = 'DELIVERED' ORDER BY "createdAt"`, user) });
      await fillCart(user, []);
      const shot = await shotPage(user, '/loyalty', 'U2-06-loyalty-loc-biec');
      c.ev('màn /loyalty', shot.file);
    } catch (e) {
      c.error(e);
    }
    results.push(c.finish());
  }

  if (want('U2-06c')) {
    const c = kase('U2-06c', 'Rớt hạng có ân hạn: trả cả đơn vừa đưa khách lên Lộc Biếc → chi tiêu < 1.500.000; cron tiers.recalc giữ Lộc Biếc + ân hạn 30 ngày; hết ân hạn, cron hạ về Mầm Xanh');
    try {
      const user = MAM;
      const ld = await prisma.variation.findUnique({ where: { sku: 'FUWA-LD-2L' }, select: { id: true } });
      const b = await prisma.order.findFirst({ where: { userId: user, status: 'DELIVERED', items: { some: { variationId: ld.id } } }, orderBy: { createdAt: 'desc' }, select: { id: true, code: true, total: true, pointsEarned: true } });
      const before = await ledger(user);
      const req = await api(L, 'POST', `/orders/${b.code}/return-request`, { user, body: { reasonCode: 'DEFECTIVE', refundMethod: 'WALLET' } });
      c.ev('khách trả cả đơn', { code: b.code, status: req.status, id: req.body?.id, message: req.body?.message });
      const prev = await api(L, 'GET', `/admin/return-requests/${req.body.id}/preview`, { user: 'uat_admin' });
      const rev = await api(L, 'POST', `/admin/return-requests/${req.body.id}/review`, { user: 'uat_admin', body: { approve: true, note: 'UAT U2-06c', ...(prev.body?.refund !== undefined ? { expectedRefund: prev.body.refund } : {}) } });
      await api(L, 'POST', `/admin/return-requests/${req.body.id}/received`, { user: 'uat_admin', body: { note: 'Kho đã nhận (UAT)' } });
      const o = await prisma.order.findUnique({ where: { id: b.id }, select: { status: true } });
      const u1 = await prisma.user.findUnique({ where: { id: user }, select: { tierId: true, tierGraceUntil: true } });
      const lo1 = await loyaltyOf(user);
      const after = await ledger(user);
      const rev1 = await rowsFor(user, `ORDER_REVERSED:${b.code}`);
      c.ev('sau trả', { review: rev.status, order: o.status, tier: u1, spent12m: lo1.spent12m, reversed: rev1.map((r) => r.delta), balance: [before.balance, after.balance], wallet: [before.wallet, after.wallet] });
      c.check('đơn RETURNED, thu hồi đủ điểm đơn, số dư = SUM sổ, ví + tiền hàng', o.status === 'RETURNED' && rev1.length === 1 && rev1[0].delta === -b.pointsEarned && after.balance === after.stdSum && after.wallet === before.wallet + b.total, { status: o.status, reversed: rev1.map((r) => r.delta), earned: b.pointsEarned, wallet: [before.wallet, after.wallet] });
      c.ev('ngay sau trả (luồng trả hàng không gọi recalcTier; rớt hạng chỉ áp ở cron đêm, loyalty.service.ts:390)', { tierId: u1.tierId, tierGraceUntil: u1.tierGraceUntil });
      c.check('ngay sau trả: chi tiêu < 1.500.000 nhưng chưa rớt hạng (vẫn LOC_BIEC)', lo1.spent12m < 1_500_000 && u1.tierId === 'LOC_BIEC', { spent12m: lo1.spent12m, tierId: u1.tierId });
      const jobA = runJob('tiers.recalc');
      const uA = await prisma.user.findUnique({ where: { id: user }, select: { tierId: true, tierGraceUntil: true } });
      const graceDays = uA.tierGraceUntil ? (new Date(uA.tierGraceUntil).getTime() - Date.now()) / 86_400_000 : null;
      c.ev('cron tiers.recalc lần 1', { job: jobA.result ?? jobA.harnessExitError ?? null, tier: uA });
      c.check('cron đêm đầu tiên: giữ LOC_BIEC, đặt ân hạn ≈ 30 ngày', uA.tierId === 'LOC_BIEC' && graceDays !== null && Math.abs(graceDays - 30) < 0.1, { tierId: uA.tierId, graceDays: graceDays && Number(graceDays.toFixed(2)) });
      runJob('tiers.recalc');
      const uB = await prisma.user.findUnique({ where: { id: user }, select: { tierId: true, tierGraceUntil: true } });
      c.check('cron đêm sau (còn ân hạn): giữ LOC_BIEC, không gia hạn ân hạn', uB.tierId === 'LOC_BIEC' && uB.tierGraceUntil?.getTime() === uA.tierGraceUntil?.getTime(), { tierId: uB.tierId, grace: [uA.tierGraceUntil, uB.tierGraceUntil] });
      await x(`UPDATE users SET "tierGraceUntil" = now() - interval '1 minute' WHERE id = $1`, user);
      const job = runJob('tiers.recalc');
      const u2 = await prisma.user.findUnique({ where: { id: user }, select: { tierId: true, tierGraceUntil: true } });
      const lo2 = await loyaltyOf(user);
      c.ev('sau hết ân hạn + tiers.recalc', { job: job.result ?? job.harnessExitError ?? null, tier: u2, earnMultiplier: lo2.earnMultiplier });
      c.check('hết ân hạn: job hạ về MAM_XANH, hệ số 1', u2.tierId === 'MAM_XANH' && u2.tierGraceUntil === null && lo2.earnMultiplier === 1, { tierId: u2.tierId, grace: u2.tierGraceUntil, mult: lo2.earnMultiplier });
    } catch (e) {
      c.error(e);
    }
    results.push(c.finish());
  }
});
