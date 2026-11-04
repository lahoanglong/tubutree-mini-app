// A1: báo giá + đặt đơn COD theo ma trận persona x giỏ x mã x điểm, so với oracle (luật + SystemConfig) và SQL sổ.
// Chạy:  node /Users/longla/coding/tubutree-mini-app/.claude/worktrees/gl-1103-docs/docs/2026-11-04-uat/scripts/L1-mua-hang/A1-quote-place.mjs [lọc-id]
import { L, sql, rec, closePrisma, api } from './lib.mjs';
import { V, who, fillCart, quote, place, loadCfg, userFacts, oracle, diff, snapshot, reconcileOrder } from './kit.mjs';

const FILE = 'A1';
const only = process.argv[2];
const cfg = await loadCfg();

const UNIT = { [V.DISH1L]: 120000, [V.DISH5L]: 430000, [V.LAUNDRY]: 210000, [V.SERUM30]: 289000, [V.MASK]: 25000, [V.LIPBALM]: 79000, [V.HANDWASH]: 89000, [V.BOTRAUMA]: 99000, [V.GAOLUT]: 75000, [V.KINH]: 79000, [V.BUOI300]: 165000, [V.BUOI500]: 219000 };

/** Ca: id, persona, step, lines, coupon (mã hoặc null), points, doPlace. */
const CASES = [
  // returning (Lộc Biếc, ngưỡng freeship 99.000, nhân điểm 1,2)
  { id: 'A1-01', persona: 'returning', step: 'giỏ 709.000đ (2 nước giặt + serum), không mã', lines: [[V.LAUNDRY, 2], [V.SERUM30, 1]], doPlace: true },
  { id: 'A1-02', persona: 'returning', step: 'giỏ 79.000đ dưới ngưỡng 99.000 của hạng: phí giao 19.000', lines: [[V.LIPBALM, 1]], doPlace: true },
  { id: 'A1-03', persona: 'returning', step: 'giỏ đúng 99.000đ (ngưỡng hạng): miễn phí giao', lines: [[V.BOTRAUMA, 1]], doPlace: false },
  { id: 'A1-04', persona: 'returning', step: 'giỏ 89.000đ (dưới 99.000): phí giao 19.000', lines: [[V.HANDWASH, 1]], doPlace: false },
  { id: 'A1-05', persona: 'returning', step: 'dùng điểm vượt trần 20%: giỏ 79.000đ, xin 35.400 điểm', lines: [[V.LIPBALM, 1]], points: 35400, doPlace: true },
  { id: 'A1-06', persona: 'returning', step: 'dùng điểm dưới trần: giỏ 709.000đ, xin 10.000 điểm', lines: [[V.LAUNDRY, 2], [V.SERUM30, 1]], points: 10000, doPlace: true },
  { id: 'A1-07', persona: 'returning', step: 'XANH10 trên giỏ 709.000đ: 10% bị chặn trần 50.000đ', lines: [[V.LAUNDRY, 2], [V.SERUM30, 1]], coupon: 'XANH10', doPlace: true },
  { id: 'A1-08', persona: 'returning', step: 'XANH10 + điểm: giỏ 300.000đ (210.000 + 89.000 + 1.000?), mã trước điểm sau', lines: [[V.LAUNDRY, 1], [V.HANDWASH, 1]], coupon: 'XANH10', points: 20000, doPlace: false },
  { id: 'A1-09', persona: 'returning', step: 'WELCOME30 với khách đã có đơn: bị từ chối', lines: [[V.LAUNDRY, 1]], coupon: 'WELCOME30', applyErr: 'NEW_ONLY' },
  { id: 'A1-10', persona: 'returning', step: 'XANH10 dưới đơn tối thiểu 250.000đ', lines: [[V.LAUNDRY, 1]], coupon: 'XANH10', applyErr: 'MIN:250000' },
  { id: 'A1-11', persona: 'returning', step: 'FREESHIP với giỏ đã miễn phí giao theo hạng', lines: [[V.LAUNDRY, 1]], coupon: 'FREESHIP', doPlace: false },
  { id: 'A1-12', persona: 'returning', step: 'FREESHIP dưới đơn tối thiểu 99.000đ', lines: [[V.LIPBALM, 1]], coupon: 'FREESHIP', applyErr: 'MIN:99000' },
  { id: 'A1-13', persona: 'returning', step: 'mã không tồn tại', lines: [[V.LAUNDRY, 1]], coupon: 'KHONGCO', applyErr: 'MISSING' },
  // new (khách thật, chưa đơn): freeship đơn đầu 199.000, WELCOME30
  { id: 'A1-20', persona: 'new', step: 'giỏ 120.000đ: dưới 199.000, phí giao 19.000', lines: [[V.DISH1L, 1]], doPlace: false },
  { id: 'A1-21', persona: 'new', step: 'giỏ đúng 199.000đ: miễn phí giao đơn đầu, WELCOME30 đúng ngưỡng', lines: [[V.DISH1L, 1], [V.KINH, 1]], coupon: 'WELCOME30', doPlace: true },
  { id: 'A1-22', persona: 'new', step: 'WELCOME30 sau khi đã có đơn: bị từ chối', lines: [[V.LAUNDRY, 1]], coupon: 'WELCOME30', applyErr: 'NEW_ONLY' },
  { id: 'A1-23', persona: 'new', step: 'FREESHIP giỏ 120.000đ: miễn 19.000 phí giao', lines: [[V.DISH1L, 1]], coupon: 'FREESHIP', doPlace: true },
  { id: 'A1-24', persona: 'new', step: 'XANH10 giỏ 300.000đ (không tier, 10% = 30.000)', lines: [[V.LAUNDRY, 1], [V.HANDWASH, 1]], coupon: 'XANH10', doPlace: false },
  // new_nophone
  { id: 'A1-30', persona: 'new_nophone', step: 'WELCOME30 giỏ 210.000đ (có Zalo, chưa SĐT)', lines: [[V.LAUNDRY, 1]], coupon: 'WELCOME30', doPlace: true },
  { id: 'A1-31', persona: 'new_nophone', step: 'giỏ 79.000đ: phí giao 19.000', lines: [[V.KINH, 1]], doPlace: false },
  // guest
  { id: 'A1-40', persona: 'guest', step: 'WELCOME30: chỉ cho tài khoản Zalo', lines: [[V.LAUNDRY, 1]], coupon: 'WELCOME30', applyErr: 'REAL_USER' },
  { id: 'A1-41', persona: 'guest', step: 'giỏ 120.000đ: phí giao 19.000, không freeship đơn đầu', lines: [[V.DISH1L, 1]], doPlace: false },
  { id: 'A1-42', persona: 'guest', step: 'giỏ 210.000đ: miễn phí giao theo ngưỡng chung', lines: [[V.LAUNDRY, 1]], doPlace: true },
];

const MSG = {
  NEW_ONLY: 'Mã này chỉ dành cho khách đặt đơn đầu tiên tại Tubu Tree.',
  REAL_USER: 'Ưu đãi này chỉ dành cho tài khoản đã đăng nhập Zalo. Bạn đăng nhập bằng Zalo rồi thử lại nhé.',
  MISSING: 'Mã giảm giá không tồn tại.',
};
const msgOf = (r) => (Array.isArray(r.body?.message) ? r.body.message.join(' | ') : r.body?.message ?? JSON.stringify(r.body));

for (const c of CASES) {
  if (only && !c.id.startsWith(only)) continue;
  try {
    const w = await who(c.persona);
    const f = await userFacts(w.userId);
    const locked = (await sql(`select count(*)::int n from orders where "userId"='${w.userId}' and "deliveredAt" > now() - interval '8 days'`))[0].n;
    const filled = await fillCart(w, c.lines);
    if (filled.error) {
      rec(FILE, { id: c.id, persona: c.persona, surface: 'api', journey: 'giỏ', step: c.step, expected: 'thêm vào giỏ được', actual: `${filled.error.status} ${msgOf(filled.error)}`, status: 'FAIL' });
      continue;
    }
    const cp = c.coupon ? (await sql(`select * from coupons where code='${c.coupon}'`))[0] : null;
    const lines = c.lines.map(([v, q]) => ({ unit: UNIT[v], qty: q, flash: false }));
    const o = oracle({ lines, coupon: cp, pointsToUse: c.points ?? 0, cfg, facts: f, locked: locked > 0 ? 999999 : 0 });
    if (c.coupon) {
      const r = await api(L, 'POST', '/cart/coupon', { token: w.token, body: { code: c.coupon } });
      if (c.applyErr) {
        const msg = msgOf(r);
        let expect;
        if (c.applyErr.startsWith('MIN:')) expect = `Đơn tối thiểu ${Number(c.applyErr.slice(4)).toLocaleString('vi-VN')}đ để dùng mã này.`;
        else expect = MSG[c.applyErr];
        const ok = r.status === 400 && msg === expect;
        rec(FILE, { id: c.id, persona: c.persona, surface: 'api', journey: 'mã giảm giá', step: c.step, expected: `400 "${expect}" (coupons.service.ts)`, actual: `${r.status} "${msg}"`, evidence: JSON.stringify({ oracleReject: o.reject }), status: ok ? 'PASS' : 'FAIL' });
        continue;
      }
      if (r.status >= 300) {
        rec(FILE, { id: c.id, persona: c.persona, surface: 'api', journey: 'mã giảm giá', step: c.step, expected: 'áp mã được', actual: `${r.status} ${msgOf(r)}`, status: 'FAIL' });
        continue;
      }
    }
    const q = await quote(w, c.points ? { pointsToUse: c.points } : {});
    if (q.status >= 300) {
      rec(FILE, { id: c.id, persona: c.persona, surface: 'api', journey: 'báo giá', step: c.step, expected: 'báo giá 2xx', actual: `${q.status} ${msgOf(q)}`, status: 'FAIL' });
      continue;
    }
    const qa = { subtotal: q.body.subtotal, discount: q.body.discount, shippingFee: q.body.shippingFee, pointsUsed: q.body.pointsUsed, total: q.body.total, pointsEarned: q.body.pointsEarned };
    const qe = { subtotal: o.sub, discount: o.discount, shippingFee: o.ship, pointsUsed: o.pointsUsed, total: o.total, pointsEarned: o.pointsEarned };
    const dq = diff(qe, qa);
    rec(FILE, { id: `${c.id}-quote`, persona: c.persona, surface: 'api', journey: 'báo giá', step: c.step, expected: JSON.stringify(qe), actual: JSON.stringify(qa), evidence: `facts=${JSON.stringify({ tier: f.tierId, bal: f.bal, prior: f.prior, real: f.real })} couponNotice=${q.body.couponNotice}`, status: dq ? 'FAIL' : 'PASS', diff: dq });
    if (!c.doPlace) continue;

    const before = await snapshot(w.userId, c.lines.map(([v]) => v));
    const redBefore = cp ? (await sql(`select "usedCount" u from coupons where code='${c.coupon}'`))[0].u : null;
    const p = await place(w, { pointsToUse: c.points ?? 0, expectedTotal: q.body.total });
    if (p.status >= 300) {
      rec(FILE, { id: `${c.id}-place`, persona: c.persona, surface: 'api', journey: 'đặt đơn COD', step: c.step, expected: 'đặt được', actual: `${p.status} ${msgOf(p)}`, status: 'FAIL' });
      continue;
    }
    const code = p.body.code;
    const rc = await reconcileOrder(code);
    const after = await snapshot(w.userId, c.lines.map(([v]) => v));
    const problems = [...rc.problems];
    const row = rc.row;
    const oe = { subtotal: o.sub, discount: o.discount + o.tierDiscount + o.pointsDiscount, shippingFee: o.ship, total: o.total, pointsEarned: o.pointsEarned, pointsUsed: o.pointsUsed };
    const oa = { subtotal: Number(row.subtotal), discount: Number(row.discount), shippingFee: Number(row.shippingFee), total: Number(row.total), pointsEarned: Number(row.pointsEarned), pointsUsed: Number(row.pointsUsed) };
    const d2 = diff(oe, oa);
    if (d2) problems.push(`đơn ≠ oracle: ${d2}`);
    // sổ điểm: dùng điểm → một dòng âm trỏ tới đơn, số dư giảm đúng
    const dBal = after.bal - before.bal;
    const dLedger = after.ledgerStd - before.ledgerStd;
    if (dBal !== -o.pointsUsed) problems.push(`số dư điểm đổi ${dBal}, mong ${-o.pointsUsed}`);
    if (dLedger !== -o.pointsUsed) problems.push(`sổ điểm đổi ${dLedger}, mong ${-o.pointsUsed}`);
    if (after.bal !== after.ledgerStd + (f.bal - before.ledgerStd) && before.bal === before.ledgerStd && after.bal !== after.ledgerStd) problems.push(`số dư ${after.bal} ≠ Σ sổ ${after.ledgerStd}`);
    // kho: reservedStock tăng đúng số lượng
    for (const [v, qn] of c.lines) {
      const d = after.stock[v].r - before.stock[v].r;
      if (d !== qn) problems.push(`reservedStock ${v}: +${d}, mong +${qn}`);
    }
    if (cp) {
      const redAfter = (await sql(`select "usedCount" u from coupons where code='${c.coupon}'`))[0].u;
      const expectRedeem = o.couponEffective ? 1 : 0;
      // usedCount chỉ tăng với mã có usageLimit (coupons.service.ts redeemInTx); mã không giới hạn chỉ ghi dòng coupon_redemptions.
      const expectUsed = cp.usageLimit != null ? expectRedeem : 0;
      if (redAfter - redBefore !== expectUsed) problems.push(`usedCount ${c.coupon}: +${redAfter - redBefore}, mong +${expectUsed}`);
      if (rc.redeem !== expectRedeem) problems.push(`lượt dùng gắn đơn: ${rc.redeem}, mong ${expectRedeem}`);
    }
    if (row.status !== 'CONFIRMED' && row.status !== 'PENDING' && row.status !== 'NEW') problems.push(`trạng thái ${row.status}`);
    rec(FILE, {
      id: `${c.id}-place`, persona: c.persona, surface: 'api', journey: 'đặt đơn COD', step: c.step,
      expected: JSON.stringify(oe), actual: JSON.stringify(oa),
      evidence: `đơn ${code} ${row.status}/${row.paymentStatus}; balance ${before.bal}→${after.bal}; sổ ${before.ledgerStd}→${after.ledgerStd}; ${problems.join(' | ') || 'khớp SQL'}`,
      status: problems.length ? 'FAIL' : 'PASS', code,
    });
  } catch (e) {
    rec(FILE, { id: c.id, persona: c.persona, surface: 'api', step: c.step, expected: 'chạy được', actual: `lỗi script: ${e.message}`, status: 'BLOCKED' });
  }
}
await closePrisma();
