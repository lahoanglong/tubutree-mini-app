// C8: khách trả MỘT PHẦN đơn có hoa hồng CTV — hoa hồng và nền doanh số giảm đúng phần dòng trả, theo % của chính dòng đó;
// hoa hồng đã vào Ví thì trừ Ví. Dùng CTV uat_returning (đăng ký ở c4) và khách new, SP COBOTE (không ca nào khác dùng).
// Luật: order-reversal.service.ts (reversePartialReturn: cắt hoa hồng theo lineAmounts, shareOf = round(số tiền × tỷ lệ luỹ kế)),
// affiliate.service.ts (debitCommissionFromWallet cho hoa hồng PAID). Chạy sau c4: node c8-partial-return.mjs (từ gốc worktree uat-1104).
import { call, short, sql, exec, buy, orderRow, commissionOf, check, done, webhook, runJob, varId, idk, sleep } from './common.mjs';

const T = (title, step, expect, persona = 'new') => ({ title, persona, size: 'API', journey: title, step, expect });
const CTV = 'uat_returning';
const share = (amount, ratio) => (amount <= 0 || ratio <= 0 ? 0 : ratio >= 1 ? amount : Math.round(amount * ratio));

const [role] = await sql(`SELECT role::text r FROM users WHERE id=$1`, CTV);
if (role.r !== 'AFFILIATE') await call('returning', 'POST', '/affiliate/register', { termsVersion: '2026-11-t1' });
const me = await call('returning', 'GET', '/affiliate/me');
const CODE = me.body?.referralCode;

// % riêng: DC-50 10%, MS-100 0% (dòng không có hoa hồng)
const vDC = await varId('COBOTE-DC-50');
const vMS = await varId('COBOTE-MS-100');
const r1 = await call('admin', 'PUT', `/admin/commission-rates/variations/${vDC}`, { rate: 10 });
const r0 = await call('admin', 'PUT', `/admin/commission-rates/variations/${vMS}`, { rate: 0 });
check('L6-J01', T('Admin đặt % hoa hồng theo biến thể: 10% và 0% (không hoa hồng)', 'PUT /admin/commission-rates/variations/:id rate=10 và rate=0', 'cả hai 200', 'admin'), r1.ok && r0.ok, `10→${r1.status}; 0→${r0.status} ${short(r0.body, 120)}`, 'API');

const deliver = (code) => { webhook(code, 'shipped'); webhook(code, 'delivered'); };
async function placeAndDeliver(qtyDC, qtyMS) {
  const b = await buy('new', [['COBOTE-DC-50', qtyDC], ['COBOTE-MS-100', qtyMS]], { paymentMethod: 'COD', referralCode: CODE });
  if (!b.ok) throw new Error(`đặt hàng lỗi ${b.status} ${short(b.body, 200)}`);
  deliver(b.code);
  return b.code;
}
const lines = (code) => sql(`SELECT oi.id, v.sku, oi.quantity q, oi.total FROM order_items oi JOIN variations v ON v.id=oi."variationId" JOIN orders o ON o.id=oi."orderId" WHERE o.code=$1 ORDER BY v.sku`, code);
async function partialReturn(code, items) {
  const rr = await call('new', 'POST', `/orders/${code}/return-request`, { reasonCode: 'DEFECTIVE', refundMethod: 'WALLET', items });
  if (!rr.ok) return { step: 'request', rr };
  const id = rr.body?.id ?? rr.body?.returnRequest?.id;
  const rv = await call('admin', 'POST', `/admin/return-requests/${id}/review`, { approve: true });
  return { id, rr, rv };
}

// ---------- đơn LOCKED: trả từng phần ----------
const code1 = await placeAndDeliver(2, 2);
const [c0] = await commissionOf(code1);
const li = await lines(code1);
const dc = li.find((x) => x.sku === 'COBOTE-DC-50');
const ms = li.find((x) => x.sku === 'COBOTE-MS-100');
const la = c0?.lineAmounts ?? {};
const lineDC = Number(la[dc.id] ?? 0);
check('L6-J02', T('Đơn 2×DC-50 (10%) + 2×MS-100 (0%): hoa hồng chỉ tính dòng 10%, dòng 0% không có trong lineAmounts', 'place-order referralCode của CTV; delivered', `hoa hồng = floor(${dc.total}×10%) = ${Math.floor(dc.total * 0.1)}; lineAmounts chỉ có dòng DC-50; trạng thái LOCKED`, 'new'),
  c0?.status === 'LOCKED' && c0.amount === Math.floor(dc.total * 0.1) && lineDC === c0.amount && !(ms.id in la) && c0.base === dc.total, `${short({ status: c0?.status, amount: c0?.amount, base: c0?.base, lineAmounts: la }, 300)}; dòng DC=${dc.total}, MS=${ms.total}`, 'SQL');

const p1 = await partialReturn(code1, [{ orderItemId: dc.id, quantity: 1 }]);
const [c1] = await commissionOf(code1);
const cut1 = share(lineDC, 1 / 2);
const baseCut1 = share(dc.total, 1 / 2);
check('L6-J03', T('Trả 1/2 dòng DC-50: hoa hồng giảm đúng nửa phần dòng, nền doanh số giảm nửa tiền dòng', 'POST return-request (items DC-50 ×1) rồi admin review approve', `hoa hồng ${c0.amount} → ${c0.amount - cut1}; commissionableTotal ${c0.base} → ${c0.base - baseCut1}; vẫn LOCKED`),
  p1.rv?.ok && c1.amount === c0.amount - cut1 && c1.base === c0.base - baseCut1 && c1.status === 'LOCKED', `request=${p1.rr?.status} review=${p1.rv?.status} ${short(p1.rv?.body, 160)}; sau=${short({ amount: c1.amount, base: c1.base, status: c1.status })}`, 'SQL');

const p2 = await partialReturn(code1, [{ orderItemId: ms.id, quantity: 2 }]);
const [c2] = await commissionOf(code1);
check('L6-J04', T('Trả toàn bộ dòng MS-100 (0%): hoa hồng và nền doanh số không đổi', 'return-request MS-100 ×2 + review approve', `amount ${c1.amount}, nền ${c1.base} giữ nguyên`),
  p2.rv?.ok && c2.amount === c1.amount && c2.base === c1.base, `review=${p2.rv?.status} ${short(p2.rv?.body, 140)}; sau=${short({ amount: c2.amount, base: c2.base })}`, 'SQL');

const p3 = await partialReturn(code1, [{ orderItemId: dc.id, quantity: 1 }]);
const [c3] = await commissionOf(code1);
const [o3] = await sql(`SELECT status::text s FROM orders WHERE code=$1`, code1);
const rrs = await sql(`SELECT rr."fullReturn" f FROM return_requests rr JOIN orders o ON o.id=rr."orderId" WHERE o.code=$1 AND rr.status::text='APPROVED' ORDER BY rr."createdAt"`, code1);
// yêu cầu cuối trả nốt mọi dòng còn lại nên đi đường trả cả đơn: phần hoa hồng còn lại (đúng bằng hoa hồng của nửa dòng chưa cắt) bị từ chối
check('L6-J05', T('Trả nốt DC-50 (đơn đã trả hết): đi đường trả cả đơn, phần hoa hồng còn lại bị từ chối, tổng thu hồi bằng hoa hồng gốc', 'return-request DC-50 ×1 (phần còn lại) + review approve', `đơn RETURNED, yêu cầu cuối fullReturn=true; commission REJECTED với amount còn lại = ${c0.amount - cut1}; cắt trước ${cut1} + từ chối ${c0.amount - cut1} = ${c0.amount}`),
  p3.rv?.ok && c3.status === 'REJECTED' && c3.amount === c0.amount - cut1 && cut1 + c3.amount === c0.amount && rrs.length === 3 && rrs[2].f === true && o3.s === 'RETURNED', `review=${p3.rv?.status}; sau=${short({ amount: c3.amount, base: c3.base, status: c3.status })}; đơn=${o3.s}; fullReturn=[${rrs.map((x) => x.f)}]`, 'SQL');

// ---------- đơn PAID: trả một phần thì trừ Ví ----------
const code2 = await placeAndDeliver(2, 1);
const li2 = await lines(code2);
const dc2 = li2.find((x) => x.sku === 'COBOTE-DC-50');
await exec(`UPDATE commissions SET "lockedAt" = now() - interval '11 days' WHERE "orderId" = (SELECT id FROM orders WHERE code=$1) AND status='LOCKED'`, code2);
runJob('AffiliateService.approveDueCommissions');
const [ca] = await commissionOf(code2);
const [avail] = await sql(`SELECT COALESCE(SUM(amount),0)::int s FROM commissions WHERE "affiliateUserId"=$1 AND status='APPROVED'`, CTV);
const [w0] = await sql(`SELECT "walletBalance"::int w FROM users WHERE id=$1`, CTV);
const pay = await call('returning', 'POST', '/affiliate/payouts', { amount: avail.s, method: 'WALLET_BALANCE' }, { 'idempotency-key': idk('l6j') });
const [cp] = await commissionOf(code2);
const [w1] = await sql(`SELECT "walletBalance"::int w FROM users WHERE id=$1`, CTV);
check('L6-J06', T('Hoa hồng của đơn 2×DC-50 duyệt xong, CTV chuyển vào Ví: PAID, Ví tăng đúng số', 'duyệt (lùi lockedAt 11 ngày) + POST /affiliate/payouts WALLET_BALANCE', `commission APPROVED ${ca?.amount}đ → PAID; Ví +${avail.s}đ`, 'returning'),
  ca?.status === 'APPROVED' && pay.ok && cp.status === 'PAID' && w1.w - w0.w === avail.s, `${short({ approved: ca?.status, amount: ca?.amount })}; payout ${pay.status} ${short(pay.body, 140)}; sau=${cp?.status}; Ví ${w0.w}→${w1.w} (khả dụng ${avail.s})`, 'SQL');

const lineDC2 = Number(((await commissionOf(code2))[0]?.lineAmounts ?? {})[dc2.id] ?? 0);
const cutW = share(lineDC2, 1 / 2);
const [pt] = await sql(`SELECT "grossAmount", "taxWithheld" FROM payouts WHERE id = (SELECT "walletPayoutId" FROM commissions WHERE "orderId"=(SELECT id FROM orders WHERE code=$1))`, code2);
const p4 = await partialReturn(code2, [{ orderItemId: dc2.id, quantity: 1 }]);
const [cq] = await commissionOf(code2);
const [w2] = await sql(`SELECT "walletBalance"::int w FROM users WHERE id=$1`, CTV);
const [rev] = await sql(`SELECT delta, type::text t, reason FROM wallet_transactions WHERE "userId"=$1 AND type::text='COMMISSION_REVERSAL' ORDER BY "createdAt" DESC LIMIT 1`, CTV);
check('L6-J07', T('Trả 1/2 dòng khi hoa hồng đã vào Ví: trừ Ví đúng phần hoa hồng bị cắt (dòng COMMISSION_REVERSAL), hoa hồng giữ PAID', 'return-request DC-50 ×1 + review approve', `hoa hồng ${ca.amount} → ${ca.amount - cutW}; Ví −${cutW}đ; 1 dòng COMMISSION_REVERSAL ${-cutW}; commission vẫn PAID`, 'new'),
  p4.rv?.ok && cq.amount === ca.amount - cutW && w1.w - w2.w === cutW && rev?.delta === -cutW && cq.status === 'PAID', `review=${p4.rv?.status}; amount ${ca.amount}→${cq.amount}; Ví ${w1.w}→${w2.w}; ${short(rev, 200)}; payout gộp=${short(pt)}`, 'SQL');
const [led] = await sql(`SELECT COALESCE(SUM(delta),0)::int s FROM wallet_transactions WHERE "userId"=$1`, CTV);
check('L6-J08', T('Ví của CTV sau trả một phần: số dư = Σ sổ ví', 'SQL walletBalance và Σ wallet_transactions', 'bằng nhau', 'returning'), w2.w === led.s, `${w2.w}/${led.s}`, 'SQL');

await exec(`UPDATE variations SET "affiliateRate"=NULL WHERE id IN ($1,$2)`, vDC, vMS);
await sleep(100);
await done();
