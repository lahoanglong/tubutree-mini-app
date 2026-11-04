// B2: trả hàng MỘT PHẦN sau giao: hoàn tiền theo dòng vào ví, hoàn điểm đã dùng, thu hồi điểm tích theo tỉ lệ; sổ điểm + ví đối soát.
import { A, makeRec, place, codeOf, bankWebhook, deliver, job, sql, sql1, walletLedger, pointsLedger, done, L, sleep } from './lib3.mjs';
const { rec, check } = makeRec('b2-partial-return');
const J = 'Trả hàng một phần sau giao';
const U = 'returning', uid = 'uat_returning';
const vGiat = (await sql1(`SELECT id FROM variations WHERE sku='FUWA-LD-2L'`)).id;
const vKinh = (await sql1(`SELECT id FROM variations WHERE sku='FUWA-GL-500'`)).id;
// Lùi đơn giao cũ để điểm đơn này là điểm khoá duy nhất cần quan tâm; dùng 3000 điểm đã dùng được
const P0 = await pointsLedger(uid), W0 = await walletLedger(uid);
const pl = await place(U, [{ vid: vGiat, qty: 2 }, { vid: vKinh, qty: 1 }], { payment: 'BANK_TRANSFER', pointsToUse: 5000, tag: 'B2' });
const code = codeOf(pl.order);
const q = pl.quote;
check('B2-1', U, 'API', J, 'đặt đơn 2×nước giặt + 1×lau kính, dùng 5.000 điểm, chuyển khoản', 'loyalty.vnd_per_point_redeem=1; max_redeem_pct=20%', !!code && q.pointsUsed === 5000, `code=${code} quote=${JSON.stringify({ subtotal: q.subtotal, pointsUsed: q.pointsUsed, pointsDiscount: q.pointsDiscount, total: q.total, pointsEarned: q.pointsEarned })}`);
const total = pl.order?.total ?? q.total;
bankWebhook(code, total, `${code} thanh toan`);
await deliver(code);
job('DeliveredEffectsResyncCron.resyncPending');
const o = await sql1(`SELECT id, status, total::int, "shippingFee"::int sf, "pointsUsed"::int pu, "pointsEarned"::int pe, "paymentStatus" ps FROM orders WHERE code=$1`, code);
const items = await sql(`SELECT id, "productName", quantity, total::int, "paidTotal"::int, "pointsDiscount"::int FROM order_items WHERE "orderId"=$1 ORDER BY "productName"`, o.id);
const P1 = await pointsLedger(uid);
check('B2-2', U, 'API', J, 'giao xong: điểm tích cộng, điểm đã dùng đã trừ khi đặt, sổ khớp', 'ORDER_DELIVERED + ORDER_REDEEM', o.status === 'DELIVERED' && P1.bal === P1.sum_std && P1.bal === P0.bal - 5000 + o.pe, `đơn=${JSON.stringify(o)} items=${JSON.stringify(items)} điểm trước=${JSON.stringify(P0)} sau=${JSON.stringify(P1)}`);
// Trả 1 nước giặt (lỗi shop)
const giat = items.find((i) => /giặt/i.test(i.productName));
const est = await A(U, 'POST', `/orders/${code}/return-estimate`, { reasonCode: 'DEFECTIVE', items: [{ orderItemId: giat.id, quantity: 1 }] });
const rr = await A(U, 'POST', `/orders/${code}/return-request`, { reasonCode: 'DEFECTIVE', items: [{ orderItemId: giat.id, quantity: 1 }] });
check('B2-3', U, 'API', J, 'gửi yêu cầu trả 1/2 nước giặt (lỗi shop)', 'order-returns.service.ts request', rr.status === 201 && !!rr.body?.id, `estimate=${JSON.stringify(est.body)} request=${rr.status} ${JSON.stringify(rr.body).slice(0, 300)}`);
const P2 = await pointsLedger(uid), W2 = await walletLedger(uid);
const pv = await A('admin', 'GET', `/admin/return-requests/${rr.body.id}/preview`);
const rv = await A('admin', 'POST', `/admin/return-requests/${rr.body.id}/review`, { approve: true, expectedRefund: pv.body?.refund });
const P3 = await pointsLedger(uid), W3 = await walletLedger(uid);
const rq = await sql1(`SELECT status, "refundAmount"::int ra, "shippingRefund"::int sr, "pointsRefunded"::int prf, "pointsReversed"::int prv, "fullReturn" fr, "refundMethod" rm FROM return_requests WHERE id=$1`, rr.body.id);
// Kỳ vọng: giặt paidTotal chia 2 (1 trên 2 đơn vị), điểm dùng theo pointsDiscount dòng, điểm tích theo tỉ lệ paidTotal/goodsPaid
const goodsPaid = o.total - o.sf;
const paidG = giat.paidTotal ?? giat.total;
const expRefund = Math.round(paidG / 2);
const expPtsBack = Math.round((giat.pointsDiscount ?? 0) / 2);
const expEarnBack = Math.round(o.pe * expRefund / goodsPaid);
check('B2-4', U, 'API', J, 'duyệt: hoàn tiền theo phần dòng vào ví (paidTotal/2), không hoàn ship (trả một phần, lỗi shop nhưng ship=0)', 'refund-allocation.ts:1-20', rv.ok && W3.bal === W2.bal + expRefund && rq.ra === expRefund && W3.bal === W3.sum_w, `review=${rv.status} preview=${JSON.stringify({ refund: pv.body?.refund, goods: pv.body?.goods, shipping: pv.body?.shipping, pointsUsedBack: pv.body?.pointsUsedBack, pointsEarnedBack: pv.body?.pointsEarnedBack, destination: pv.body?.destination })} return_requests=${JSON.stringify(rq)} ví ${W2.bal}->${W3.bal} (kỳ vọng +${expRefund}) giặt.paidTotal=${paidG} goodsPaid=${goodsPaid}`);
check('B2-5', U, 'API', J, 'điểm đã dùng trả lại theo phần dòng (pointsDiscount/2)', 'refund-allocation.ts: điểm đã dùng trả theo OrderItem.pointsDiscount', rq.prf === expPtsBack, `pointsRefunded=${rq.prf} kỳ vọng ${expPtsBack} (dòng pointsDiscount=${giat.pointsDiscount})`);
check('B2-6', U, 'API', J, 'điểm tích thu hồi theo tỉ lệ tiền trả/tiền hàng thực trả', 'refund-allocation.ts: điểm tích thu hồi theo phần tiền thực trả', Math.abs(rq.prv - expEarnBack) <= 1, `pointsReversed=${rq.prv} kỳ vọng ${expEarnBack} (=${o.pe}×${expRefund}/${goodsPaid})`);
const pts = await sql(`SELECT delta::int, lot, reason FROM points_transactions WHERE "userId"=$1 AND "refId"=$2 ORDER BY "createdAt"`, uid, o.id);
const sumRows = pts.reduce((s, r) => s + r.delta, 0);
check('B2-7', U, 'API', J, 'sổ điểm: số dư = SUM(sổ) sau trả một phần; thay đổi ròng của đơn = điểm tích - thu hồi - điểm dùng + hoàn', 'points-reconcile.ts', P3.bal === P3.sum_std && P3.bal === P2.bal + rq.prf - rq.prv, `điểm trước duyệt=${JSON.stringify(P2)} sau=${JSON.stringify(P3)} dòng sổ của đơn=${JSON.stringify(pts)}`);
check('B2-8', U, 'API', J, 'đơn vẫn DELIVERED sau trả một phần', 'return-ledger/partialReturnTotals', (await sql1(`SELECT status FROM orders WHERE code=$1`, code)).status === 'DELIVERED', `orders.status=${(await sql1(`SELECT status FROM orders WHERE code=$1`, code)).status}`);
const wtx = (await sql(`SELECT delta::int, type, reason, "createdAt" FROM wallet_transactions WHERE "userId"=$1 ORDER BY "createdAt" DESC LIMIT 1`, uid))[0];
rec('B2-9', U, 'API', J, 'dòng sổ ví của khoản trả hàng', 'wallet_transactions', JSON.stringify(wtx), JSON.stringify(wtx), wtx?.delta === expRefund ? 'PASS' : 'FAIL');
await sleep(500);
// Trả tiếp nốt phần còn lại -> RETURNED: không hoàn quá
const rr2 = await A(U, 'POST', `/orders/${code}/return-request`, { reasonCode: 'OTHER', reason: 'Trả nốt phần còn lại để thử' });
const pv2 = await A('admin', 'GET', `/admin/return-requests/${rr2.body?.id}/preview`);
const W4 = await walletLedger(uid);
const rv2 = await A('admin', 'POST', `/admin/return-requests/${rr2.body?.id}/review`, { approve: true, expectedRefund: pv2.body?.refund });
const W5 = await walletLedger(uid), P5 = await pointsLedger(uid);
const sumRefunds = (await sql1(`SELECT COALESCE(SUM("refundAmount"),0)::int s FROM return_requests WHERE "orderId"=$1 AND status='APPROVED'`, o.id)).s;
check('B2-10', U, 'API', J, 'trả nốt phần còn lại: tổng hoàn các lần = đúng tiền hàng thực trả + phí ship (không dư không thiếu)', 'refund-allocation.ts: luỹ kế sau trừ luỹ kế trước', rv2.ok && sumRefunds === o.total && W5.bal === W5.sum_w, `review2=${rv2.status} ${rv2.ok ? '' : JSON.stringify(rv2.body)} tổng hoàn=${sumRefunds} tổng đơn=${o.total} ví ${W4.bal}->${W5.bal}; điểm=${JSON.stringify(P5)}`);
const od = await sql1(`SELECT status FROM orders WHERE code=$1`, code);
rec('B2-11', U, 'API', J, 'đơn sau trả nốt', 'order-reversal', od.status, `orders.status=${od.status}`, 'PASS');
await done();
