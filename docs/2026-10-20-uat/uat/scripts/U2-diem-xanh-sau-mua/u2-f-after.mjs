#!/usr/bin/env node
// U2-23..U2-26: sau mua — huỷ đơn trước giao (hoàn điểm đã tiêu, voucher, tồn kho; đơn đã trả tiền hoàn vào Ví Tubu), trả hàng một
// phần sau giao (thu hồi điểm đã cộng theo tỉ lệ, hoàn tiền vào Ví), trả nốt phần còn lại, sổ Ví Tubu.
// Dùng: node u2-f-after.mjs [lane=7] [--headed]   (chạy sau u2-a..u2-e trên cùng lane)
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { L, prisma, kase, main, ledger, open, api, apiOk, q, sleep, headless, SHOTS, fillCart, miniCheckout, deliver, apiPlace, waitPushed, loyaltyOf, rowsFor, HARNESS, pct, x } from './u2lib.mjs';

const R = 'uat_returning';
const DT = 'uat_u2_daithu';

async function cancelOnMini(user, code, { wallet = false, shot } = {}) {
  const s = await open(L.n, user, { headless, path: `/order/${code}` });
  try {
    const p = s.page;
    await p.getByRole('button', { name: 'Hủy đơn', exact: true }).first().click({ timeout: 25_000 });
    await sleep(600);
    if (wallet) {
      const w = p.getByRole('radio', { name: /Ví Tubu/ });
      if (await w.count()) await w.first().click();
    }
    const text = (await p.evaluate(() => document.body.innerText)).split('\n').filter((t) => /hoàn|Ví Tubu|hủy|huỷ/i.test(t)).slice(0, 8);
    if (shot) await p.screenshot({ path: path.join(SHOTS, `${shot}-confirm.png`) });
    const resp = p.waitForResponse((r) => r.url().endsWith(`/api/orders/${code}/cancel`) && r.request().method() === 'POST', { timeout: 30_000 });
    await p.getByRole('button', { name: 'Hủy đơn', exact: true }).last().click();
    const r = await resp;
    const body = await r.json().catch(() => null);
    await sleep(1500);
    if (shot) await p.screenshot({ path: path.join(SHOTS, `${shot}-done.png`) });
    return { http: r.status(), body: body && { status: body.status, code: body.code }, sheetText: text };
  } finally {
    await s.close();
  }
}

async function couponState(userId, code) {
  const [cp] = await q(`SELECT id, code, "usedCount" FROM coupons WHERE code = $1`, code);
  const red = await q(`SELECT * FROM coupon_redemptions WHERE "couponId" = $1 AND "userId" = $2`, cp.id, userId);
  return { usedCount: cp.usedCount, redemptions: red.map((r) => ({ orderId: r.orderId, redeemedAt: r.redeemedAt })) };
}

await main(async (results) => {
  {
    const c = kase('U2-23', 'Huỷ đơn COD trước giao trên Mini App: đơn dùng WELCOME30 + Điểm Xanh → hoàn điểm đã tiêu, trả lượt mã, cộng lại tồn kho, không cộng điểm tích');
    try {
      // Mở khoá điểm các đơn vừa giao để có điểm dùng
      for (const o of await prisma.order.findMany({ where: { userId: R, status: 'DELIVERED', deliveredAt: { gt: new Date(Date.now() - 7 * 86_400_000) } }, select: { code: true } })) {
        await x(`UPDATE orders SET "deliveredAt" = "deliveredAt" - interval '8 days' WHERE code = $1`, o.code);
      }
      const v = await prisma.variation.findUnique({ where: { sku: 'FUWA-LD-2L' }, select: { id: true, stock: true } });
      const before = await ledger(R);
      const cp0 = await couponState(R, 'WELCOME30');
      const cp = await fillCart(R, [['FUWA-LD-2L', 1]], 'WELCOME30');
      c.check('áp WELCOME30 vào giỏ', cp && cp.status < 300, { status: cp?.status, message: cp?.body?.message });
      const r = await miniCheckout(R, { usePoints: true, shot: 'U2-23' });
      c.ev('đặt', { code: r.code, status: r.status, quote: r.quote && { subtotal: r.quote.subtotal, discount: r.quote.discount, pointsUsed: r.quote.pointsUsed, total: r.quote.total, pointsEarned: r.quote.pointsEarned } });
      const o = await prisma.order.findUnique({ where: { code: r.code }, select: { id: true, status: true, pointsUsed: true, couponDiscount: true, discount: true, total: true } });
      const mid = await ledger(R);
      const cp1 = await couponState(R, 'WELCOME30');
      const st1 = (await prisma.variation.findUnique({ where: { id: v.id }, select: { stock: true } })).stock;
      c.ev('sau đặt', { order: o, balance: mid.balance, coupon: cp1, stock: st1 });
      c.check('đặt: mã giảm 30.000, dùng điểm > 0, số dư −điểm, tồn kho −1, +1 dòng coupon_redemptions (WELCOME30 không có usageLimit nên usedCount không đếm)', (o.couponDiscount === 30000 || o.discount === 30000) && o.pointsUsed > 0 && mid.balance === before.balance - o.pointsUsed && st1 === v.stock - 1 && cp1.redemptions.length === cp0.redemptions.length + 1, { discount: o.discount, couponDiscount: o.couponDiscount, pointsUsed: o.pointsUsed, bal: [before.balance, mid.balance], stock: [v.stock, st1], redemptions: [cp0.redemptions.length, cp1.redemptions.length] });
      await waitPushed(r.code);
      const cancel = await cancelOnMini(R, r.code, { shot: 'U2-23-cancel' });
      c.ev('huỷ trên Mini App', cancel);
      const o2 = await prisma.order.findUnique({ where: { code: r.code }, select: { status: true } });
      const after = await ledger(R);
      const refund = await rowsFor(R, `ORDER_REFUND_POINTS:${r.code}`);
      const credited = await rowsFor(R, `ORDER_DELIVERED:${r.code}`);
      const cp2 = await couponState(R, 'WELCOME30');
      const st2 = (await prisma.variation.findUnique({ where: { id: v.id }, select: { stock: true } })).stock;
      c.ev('sau huỷ', { status: o2.status, refund: refund.map((x2) => x2.delta), balance: after.balance, stdSum: after.stdSum, coupon: cp2, stock: st2 });
      c.check('đơn CANCELLED', cancel.http < 300 && o2.status === 'CANCELLED', { http: cancel.http, status: o2.status });
      c.check('SQL: ORDER_REFUND_POINTS +pointsUsed, số dư về như trước = SUM sổ, không có ORDER_DELIVERED', refund.length === 1 && refund[0].delta === o.pointsUsed && after.balance === before.balance && after.balance === after.stdSum && credited.length === 0, { refund: refund.map((x2) => x2.delta), bal: [before.balance, after.balance], sum: after.stdSum });
      c.check('tồn kho cộng lại', st2 === v.stock, { before: v.stock, after: st2 });
      c.check('lượt dùng WELCOME30 được trả (dòng coupon_redemptions của đơn bị xoá, usedCount không đổi)', cp2.redemptions.length === cp0.redemptions.length && cp2.usedCount === cp0.usedCount, { usedCount: [cp0.usedCount, cp1.usedCount, cp2.usedCount], redemptions: [cp0.redemptions.length, cp1.redemptions.length, cp2.redemptions.length] });
      await fillCart(R, [['FUWA-LD-2L', 1]]);
      const again = await api(L, 'POST', '/cart/coupon', { user: R, body: { code: 'WELCOME30' } });
      c.check('áp lại WELCOME30 sau huỷ được (perUserLimit 1)', again.status < 300, { status: again.status, message: again.body?.message });
      await fillCart(R, []);
    } catch (e) {
      c.error(e);
    }
    results.push(c.finish());
  }

  {
    const c = kase('U2-24', 'Huỷ đơn chuyển khoản đã trả tiền trước giao: chọn nhận hoàn về Ví Tubu → ví + total, sổ ví khớp; điểm đã tiêu được hoàn');
    try {
      const w0 = await ledger(R);
      const placed = await apiPlace(R, [['FUWA-BT-500', 2]], { paymentMethod: 'BANK_TRANSFER' });
      await waitPushed(placed.code);
      const paid = JSON.parse(execFileSync('node', [path.join(HARNESS, 'bank-webhook.mjs'), String(L.n), placed.code, String(placed.quote.total)], { encoding: 'utf8' }));
      const o1 = await prisma.order.findUnique({ where: { code: placed.code }, select: { status: true, paymentStatus: true, total: true } });
      c.ev('đơn chuyển khoản', { code: placed.code, total: placed.quote.total, after: o1, bank: paid.order ?? paid });
      c.check('đơn PAID trước khi huỷ', o1.paymentStatus === 'PAID', o1);
      const cancel = await cancelOnMini(R, placed.code, { wallet: true, shot: 'U2-24-cancel-paid' });
      c.ev('huỷ', cancel);
      const o2 = await prisma.order.findUnique({ where: { code: placed.code }, select: { id: true, status: true, paymentStatus: true } });
      const w1 = await ledger(R);
      const wtx = await q(`SELECT delta::int AS delta, type::text AS type, "balanceAfter"::int AS "balanceAfter", reason FROM wallet_transactions WHERE "userId" = $1 AND "refId" = $2`, R, o2.id);
      const refunds = await q(`SELECT method::text AS method, status::text AS status, amount::int AS amount FROM order_customer_refunds WHERE "orderId" = $1`, o2.id).catch((e) => e.message.split('\n').pop());
      c.ev('sau huỷ', { order: o2, wallet: [w0.wallet, w1.wallet], walletSum: w1.walletSum, wtx, refunds });
      c.check('CANCELLED; ví + total (ORDER_REFUND), walletBalance = SUM sổ ví', o2.status === 'CANCELLED' && w1.wallet === w0.wallet + o1.total && wtx.some((t) => t.type === 'ORDER_REFUND' && t.delta === o1.total) && w1.wallet === w1.walletSum, { status: o2.status, wallet: [w0.wallet, w1.wallet], sum: w1.walletSum, wtx });
      const wallet = await api(L, 'GET', '/me/wallet', { user: R });
      c.check('/me/wallet hiện số dư mới', wallet.body?.walletBalance === w1.wallet, { api: wallet.body?.walletBalance, db: w1.wallet });
      const shot = path.join(SHOTS, 'U2-24-wallet.png');
      const s = await open(L.n, R, { headless, path: '/wallet' });
      try {
        await sleep(2000);
        await s.page.screenshot({ path: shot });
        c.ev('màn /wallet', (await s.page.evaluate(() => document.body.innerText)).split('\n').filter((t) => /đ$|Hoàn|hoàn/.test(t)).slice(0, 6));
      } finally {
        await s.close();
      }
    } catch (e) {
      c.error(e);
    }
    results.push(c.finish());
  }

  {
    const c = kase('U2-24b', 'Trả đơn bằng Ví Tubu trên Mini App: ví − total (ORDER_PAY), đơn PAID; giao xong cộng điểm như đơn thường');
    try {
      const w0 = await ledger(R);
      await fillCart(R, [['FUWA-DW-1L', 1]]);
      const r = await miniCheckout(R, { payment: /^Ví Tubu/, shot: 'U2-24b' });
      const o = await prisma.order.findUnique({ where: { code: r.code }, select: { id: true, status: true, paymentMethod: true, paymentStatus: true, total: true, pointsEarned: true } });
      const w1 = await ledger(R);
      const wtx = await q(`SELECT delta::int AS delta, type::text AS type FROM wallet_transactions WHERE "userId" = $1 AND "refId" = $2`, R, o.id);
      c.ev('đơn ví', { code: r.code, order: o, wallet: [w0.wallet, w1.wallet], wtx });
      c.check('Mini App đặt 201, WALLET + PAID, ví − total (ORDER_PAY), = SUM sổ ví', r.status < 300 && o.paymentMethod === 'WALLET' && o.paymentStatus === 'PAID' && w1.wallet === w0.wallet - o.total && wtx.some((t) => t.type === 'ORDER_PAY' && t.delta === -o.total) && w1.wallet === w1.walletSum, { status: r.status, pm: o.paymentMethod, ps: o.paymentStatus, wallet: [w0.wallet, w1.wallet], sum: w1.walletSum });
      c.check('điểm đơn trả bằng ví = 2% × 1,2 × 120.000 = 2.880', o.pointsEarned === pct(120000, 2, 1.2), o.pointsEarned);
      c.ev('giao', await deliver(r.code));
      const rows = await rowsFor(R, `ORDER_DELIVERED:${r.code}`);
      c.check('giao: dòng sổ +2.880', rows.length === 1 && rows[0].delta === o.pointsEarned, rows.map((x2) => x2.delta));
    } catch (e) {
      c.error(e);
    }
    results.push(c.finish());
  }

  {
    const c = kase('U2-25b', 'Trả một phần đơn có dùng Điểm Xanh (COD 289.000đ, dùng điểm): hoàn điểm đã tiêu theo phần trả + tiền phần còn lại vào Ví, thu hồi điểm tích theo tỉ lệ; sổ khớp');
    try {
      const b0 = await ledger(R);
      await fillCart(R, [['FUWA-LD-2L', 1], ['FUWA-GL-500', 1]]);
      const r = await miniCheckout(R, { usePoints: true, shot: 'U2-25b' });
      const o = await prisma.order.findUnique({ where: { code: r.code }, select: { id: true, pointsUsed: true, pointsEarned: true, total: true, subtotal: true, items: { select: { id: true, total: true } } } });
      c.ev('đơn', o);
      c.check('đơn dùng điểm > 0', o.pointsUsed > 0, o.pointsUsed);
      c.ev('giao', await deliver(r.code));
      const b1 = await ledger(R);
      const gl = o.items.find((i) => i.total === 79000);
      const est = await api(L, 'POST', `/orders/${r.code}/return-estimate`, { user: R, body: { reasonCode: 'DEFECTIVE', items: [{ orderItemId: gl.id, quantity: 1 }] } });
      c.ev('ước tính hoàn (khách thấy)', est.body);
      const req = await api(L, 'POST', `/orders/${r.code}/return-request`, { user: R, body: { reasonCode: 'DEFECTIVE', refundMethod: 'WALLET', items: [{ orderItemId: gl.id, quantity: 1 }] } });
      const prev = await api(L, 'GET', `/admin/return-requests/${req.body.id}/preview`, { user: 'uat_admin' });
      const rev = await api(L, 'POST', `/admin/return-requests/${req.body.id}/review`, { user: 'uat_admin', body: { approve: true, note: 'UAT U2-25b', ...(prev.body?.refund !== undefined ? { expectedRefund: prev.body.refund } : {}) } });
      await api(L, 'POST', `/admin/return-requests/${req.body.id}/received`, { user: 'uat_admin', body: { note: 'Kho đã nhận (UAT)' } });
      const [rq] = await q(`SELECT status::text AS status, "refundAmount", "shippingRefund", "pointsReversed", "pointsRefunded" FROM return_requests WHERE id = $1`, req.body.id);
      const pts = await q(`SELECT delta::int AS delta, reason FROM points_transactions WHERE "userId" = $1 AND reason LIKE $2 ORDER BY "createdAt"`, R, `%:${r.code}`);
      const b2 = await ledger(R);
      const share = (o.pointsUsed * 79000) / o.subtotal;
      c.ev('sau duyệt', { review: rev.status, request: rq, points: pts, balance: [b0.balance, b1.balance, b2.balance], wallet: [b1.wallet, b2.wallet], pointsShareOfLine: Number(share.toFixed(2)) });
      c.check('APPROVED; tiền hoàn + điểm hoàn = giá dòng 79.000 (±1)', rq.status === 'APPROVED' && Math.abs(rq.refundAmount + rq.pointsRefunded - 79000) <= 1, { refundAmount: rq.refundAmount, pointsRefunded: rq.pointsRefunded });
      c.check('điểm hoàn ≈ phần điểm đã tiêu của dòng (±1)', Math.abs(rq.pointsRefunded - share) <= 1, { pointsRefunded: rq.pointsRefunded, share });
      c.check('thu hồi điểm tích ≈ pointsEarned × 79.000/subtotal (±1)', Math.abs(rq.pointsReversed - (o.pointsEarned * 79000) / o.subtotal) <= 1, { pointsReversed: rq.pointsReversed, expect: (o.pointsEarned * 79000) / o.subtotal });
      c.check('SQL: số dư điểm = sau giao + điểm hoàn − thu hồi = SUM sổ; ví + refundAmount = SUM sổ ví', b2.balance === b1.balance + rq.pointsRefunded - rq.pointsReversed && b2.balance === b2.stdSum && b2.wallet === b1.wallet + rq.refundAmount && b2.wallet === b2.walletSum, { bal: [b1.balance, b2.balance], sum: b2.stdSum, wallet: [b1.wallet, b2.wallet], wsum: b2.walletSum });
    } catch (e) {
      c.error(e);
    }
    results.push(c.finish());
  }

  let retCode = null;
  {
    const c = kase('U2-25', 'Trả một phần sau giao (Đại Thụ, COD 199.000đ: trả nước lau kính 79.000đ, lý do lỗi): điểm khoá khi chờ, duyệt → thu hồi điểm theo tỉ lệ, hoàn 79.000đ vào Ví Tubu');
    try {
      await fillCart(DT, [['FUWA-DW-1L', 1], ['FUWA-GL-500', 1]]);
      const r = await miniCheckout(DT, { shot: 'U2-25' });
      retCode = r.code;
      c.ev('giao', await deliver(r.code));
      const o = await prisma.order.findUnique({ where: { code: r.code }, select: { id: true, pointsEarned: true, total: true, items: { select: { id: true, productName: true, variationName: true, total: true } } } });
      const b0 = await ledger(DT);
      const t0 = await loyaltyOf(DT);
      c.ev('đơn', o);
      // Khách gửi yêu cầu trả trên Mini App
      const s = await open(L.n, DT, { headless, path: `/order/${r.code}` });
      let req;
      try {
        const p = s.page;
        await p.getByRole('button', { name: 'Yêu cầu đổi/trả' }).click({ timeout: 25_000 });
        const gl = o.items.find((i) => i.total === 79000);
        await p.getByRole('checkbox', { name: new RegExp(`^Trả ${gl.productName}`) }).click();
        await p.getByRole('button', { name: 'Sản phẩm lỗi, hỏng' }).click();
        const w = p.getByRole('radio', { name: /Ví Tubu/ });
        if (await w.count()) await w.first().click();
        await sleep(800);
        await p.screenshot({ path: path.join(SHOTS, 'U2-25-return-sheet.png') });
        const resp = p.waitForResponse((x2) => x2.url().endsWith(`/api/orders/${r.code}/return-request`) && x2.request().method() === 'POST', { timeout: 30_000 });
        await p.getByRole('button', { name: 'Gửi yêu cầu' }).click();
        const rr = await resp;
        req = { http: rr.status(), body: await rr.json() };
        await sleep(1200);
        await p.screenshot({ path: path.join(SHOTS, 'U2-25-return-sent.png') });
      } finally {
        await s.close();
      }
      c.ev('POST return-request', { http: req.http, id: req.body?.id, status: req.body?.status, refundMethod: req.body?.refundMethod });
      c.check('yêu cầu trả 1 dòng tạo được (REQUESTED, nhận về Ví)', req.http < 300 && req.body?.status === 'REQUESTED' && (req.body?.refundMethod ?? 'WALLET') === 'WALLET', { http: req.http, status: req.body?.status });
      const lo1 = await loyaltyOf(DT);
      c.check('đang chờ xử lý trả: điểm đơn bị khoá (lockedReturnPoints)', lo1.lockedReturnPoints >= o.pointsEarned, { lockedReturnPoints: lo1.lockedReturnPoints, pointsEarned: o.pointsEarned });
      const prev = await api(L, 'GET', `/admin/return-requests/${req.body.id}/preview`, { user: 'uat_admin' });
      c.ev('admin preview', prev.body);
      const rev = await api(L, 'POST', `/admin/return-requests/${req.body.id}/review`, { user: 'uat_admin', body: { approve: true, note: 'UAT U2-25 duyệt', ...(prev.body?.refund !== undefined ? { expectedRefund: prev.body.refund } : {}) } });
      c.ev('admin duyệt', { status: rr2(rev), refundAmount: rev.body?.refundAmount, pointsReversed: rev.body?.pointsReversed, message: rev.body?.message });
      const recv = await api(L, 'POST', `/admin/return-requests/${req.body.id}/received`, { user: 'uat_admin', body: { note: 'Kho đã nhận (UAT)' } });
      c.ev('admin đã nhận hàng', { status: recv.status, message: recv.body?.message });
      const [rq] = await q(`SELECT status::text AS status, "refundAmount", "shippingRefund", "pointsReversed", "pointsRefunded", "fullReturn", "refundMethod" FROM return_requests WHERE id = $1`, req.body.id);
      const b1 = await ledger(DT);
      const pts = await q(`SELECT delta::int AS delta, reason, "refType" FROM points_transactions WHERE "userId" = $1 AND reason LIKE $2 ORDER BY "createdAt"`, DT, `%:${r.code}`);
      const wtx = await q(`SELECT delta::int AS delta, type::text AS type, reason FROM wallet_transactions WHERE "userId" = $1 AND "refId" IN (SELECT id FROM order_customer_refunds WHERE "orderId" = $2 UNION SELECT $2 UNION SELECT $3)`, DT, o.id, req.body.id).catch(() => []);
      const wAll = await q(`SELECT delta::int AS delta, type::text AS type, reason, "refType", "refId" FROM wallet_transactions WHERE "userId" = $1 ORDER BY "createdAt"`, DT);
      const t1 = await loyaltyOf(DT);
      const expectBack = Math.floor((o.pointsEarned * 79000) / 199000);
      c.ev('sau duyệt', { request: rq, points: pts, wallet: [b0.wallet, b1.wallet], walletRows: wAll, balance: [b0.balance, b1.balance], spent12m: [t0.spent12m, t1.spent12m] });
      c.check('return APPROVED, refundAmount 79.000', rq.status === 'APPROVED' && rq.refundAmount === 79000, rq);
      c.check(`thu hồi điểm theo tỉ lệ 79.000/199.000 × ${o.pointsEarned} ≈ ${expectBack} (±1)`, Math.abs(rq.pointsReversed - expectBack) <= 1 && pts.some((p2) => p2.delta === -rq.pointsReversed && p2.reason.startsWith('RETURN_REVERSED:')), { pointsReversed: rq.pointsReversed, rows: pts });
      c.check('SQL: số dư điểm = trước − pointsReversed = SUM sổ', b1.balance === b0.balance - rq.pointsReversed && b1.balance === b1.stdSum, { bal: [b0.balance, b1.balance], sum: b1.stdSum });
      c.check('Ví Tubu + 79.000 (ORDER_REFUND), walletBalance = SUM sổ ví', b1.wallet === b0.wallet + 79000 && wAll.some((w) => w.type === 'ORDER_REFUND' && w.delta === 79000) && b1.wallet === b1.walletSum, { wallet: [b0.wallet, b1.wallet], sum: b1.walletSum });
      c.check('chi tiêu xét hạng trừ phần đã hoàn (spent12m −79.000)', t1.spent12m === t0.spent12m - 79000, { spent12m: [t0.spent12m, t1.spent12m] });
      c.check('sau xử lý trả: hết khoá do chờ trả', t1.lockedReturnPoints === 0, t1.lockedReturnPoints);
      const shot = await (async () => {
        const s2 = await open(L.n, DT, { headless, path: `/order/${r.code}` });
        try {
          await sleep(2500);
          await s2.page.screenshot({ path: path.join(SHOTS, 'U2-25-order-after-return.png'), fullPage: true });
          return (await s2.page.evaluate(() => document.body.innerText)).split('\n').filter((t) => /điểm|Ví Tubu|hoàn|trả/i.test(t)).slice(0, 10);
        } finally {
          await s2.close();
        }
      })();
      c.ev('chi tiết đơn sau trả (Mini App)', shot);
    } catch (e) {
      c.error(e);
    }
    results.push(c.finish());
  }

  {
    const c = kase('U2-26', 'Trả nốt phần còn lại của đơn đã trả một phần: đơn RETURNED, thu hồi phần điểm còn lại (tổng thu hồi = điểm đã cộng), hoàn 120.000đ vào Ví');
    try {
      const o = await prisma.order.findUnique({ where: { code: retCode }, select: { id: true, pointsEarned: true, items: { select: { id: true, total: true } } } });
      const b0 = await ledger(DT);
      const rest = o.items.find((i) => i.total === 120000);
      const req = await api(L, 'POST', `/orders/${retCode}/return-request`, { user: DT, body: { reasonCode: 'DEFECTIVE', refundMethod: 'WALLET', items: [{ orderItemId: rest.id, quantity: 1 }] } });
      c.ev('khách gửi trả nốt (API)', { status: req.status, id: req.body?.id, message: req.body?.message });
      const prev = await api(L, 'GET', `/admin/return-requests/${req.body.id}/preview`, { user: 'uat_admin' });
      const rev = await api(L, 'POST', `/admin/return-requests/${req.body.id}/review`, { user: 'uat_admin', body: { approve: true, note: 'UAT U2-26', ...(prev.body?.refund !== undefined ? { expectedRefund: prev.body.refund } : {}) } });
      await api(L, 'POST', `/admin/return-requests/${req.body.id}/received`, { user: 'uat_admin', body: { note: 'Kho đã nhận (UAT)' } });
      c.ev('duyệt', { status: rev.status, message: rev.body?.message });
      const ord = await prisma.order.findUnique({ where: { id: o.id }, select: { status: true } });
      const reqs = await q(`SELECT status::text AS status, "refundAmount", "pointsReversed", "fullReturn" FROM return_requests WHERE "orderId" = $1 ORDER BY "createdAt"`, o.id);
      const pts = await q(`SELECT delta::int AS delta, reason, "refType" FROM points_transactions WHERE "userId" = $1 AND reason LIKE $2 ORDER BY "createdAt"`, DT, `%:${retCode}`);
      const b1 = await ledger(DT);
      const taken = -pts.filter((p2) => p2.delta < 0).reduce((s, p2) => s + p2.delta, 0);
      c.ev('sau', { order: ord.status, requests: reqs, points: pts, wallet: [b0.wallet, b1.wallet], balance: [b0.balance, b1.balance] });
      c.check('đơn RETURNED', ord.status === 'RETURNED', ord.status);
      c.check(`tổng điểm thu hồi = điểm đã cộng ${o.pointsEarned}`, taken === o.pointsEarned, { taken, earned: o.pointsEarned, rows: pts });
      c.check('Ví + 120.000; số dư điểm và ví = SUM sổ', b1.wallet === b0.wallet + 120000 && b1.wallet === b1.walletSum && b1.balance === b1.stdSum, { wallet: [b0.wallet, b1.wallet], wsum: b1.walletSum, bal: b1.balance, sum: b1.stdSum });
    } catch (e) {
      c.error(e);
    }
    results.push(c.finish());
  }
});

function rr2(r) {
  return r.status;
}
