// A1: đơn giao xong -> điểm chờ (khoá theo cửa sổ đổi/trả) -> dùng được; hệ số theo hạng (Mầm Xanh, Lộc Biếc); sổ điểm khớp số dư.
import { A, makeRec, place, codeOf, deliver, job, sql, sql1, pointsLedger, done, L, clearCart, ensureAddress } from './lib3.mjs';
const { rec, check } = makeRec('a1-earn');
const J = 'Điểm Xanh: đơn giao xong';
const CFG = { earnPct: 2, retWindow: 7 };

for (const persona of ['new', 'returning']) {
  const tag = persona === 'new' ? 'A1a' : 'A1b';
  const before = await pointsLedger(`uat_${persona}`);
  const tierBefore = (await sql1(`SELECT "tierId" FROM users WHERE id=$1`, `uat_${persona}`)).tierId;
  const mult = tierBefore === 'LOC_BIEC' ? 1.2 : tierBefore === 'DAI_THU' ? 1.5 : tierBefore === 'CO_THU' ? 2 : 1;
  const p = await place(persona, [{ slug: 'nuoc-rua-chen-fuwa3e', qty: 1 }], { tag });
  const code = codeOf(p.order);
  const subtotal = p.quote?.subtotal, total = p.quote?.total;
  const expectedPts = Math.floor(((p.quote?.subtotal ?? 0) - (p.quote?.discount ?? 0) - (p.quote?.couponDiscount ?? 0)) * CFG.earnPct / 100 * mult);
  check(`${tag}-1`, persona, 'API', J, 'báo giá pointsEarned = tiền hàng × earn_pct(2%) × hệ số hạng', `loyalty.earn_pct=2; hạng ${tierBefore ?? 'chưa có (x1)'} => ×${mult}; ${subtotal}×2%×${mult}`, p.quote?.pointsEarned === expectedPts, `quote.pointsEarned=${p.quote?.pointsEarned} kỳ vọng ${expectedPts}; quote=${JSON.stringify({ subtotal, total, shippingFee: p.quote?.shippingFee, discount: p.quote?.discount, pointsEarned: p.quote?.pointsEarned })}`);
  check(`${tag}-2`, persona, 'API', J, 'đặt đơn COD 201', 'POST /checkout/place-order 201', p.placeStatus === 201 && !!code, `status=${p.placeStatus} code=${code}`);
  const ord = await sql1(`SELECT status, "pointsEarned"::int pe, "paymentMethod" pm FROM orders WHERE code=$1`, code);
  check(`${tag}-3`, persona, 'API', J, 'đơn đặt xong chưa cộng điểm (điểm chỉ cộng khi giao)', 'creditOrderPoints chỉ gọi khi DELIVERED (loyalty.service.ts:100)', (await pointsLedger(`uat_${persona}`)).bal === before.bal, `SQL users.pointsBalance trước=${before.bal} sau đặt=${(await pointsLedger(`uat_${persona}`)).bal}; orders.pointsEarned=${ord.pe}`);
  const d = await deliver(code);
  const j = job('DeliveredEffectsResyncCron.resyncPending');
  const after = await pointsLedger(`uat_${persona}`);
  const rows = await sql(`SELECT delta::int, lot, reason, "expiresAt", "refId" FROM points_transactions WHERE "userId"=$1 AND reason=$2`, `uat_${persona}`, `ORDER_DELIVERED:${code}`);
  check(`${tag}-4`, persona, 'API', J, 'webhook delivered + run-job: đúng 1 dòng ORDER_DELIVERED, delta = điểm báo giá, số dư = SUM(sổ)', 'unique (reason,refId); users.pointsBalance = SUM(delta) lô STANDARD', rows.length === 1 && rows[0].delta === p.quote?.pointsEarned && after.bal === after.sum_std && after.bal === before.bal + p.quote.pointsEarned, `SQL rows=${JSON.stringify(rows)} trước=${JSON.stringify(before)} sau=${JSON.stringify(after)} job=${JSON.stringify(j.result ?? j)} hook=${JSON.stringify(d.map((x) => x.order))}`);
  const exp = rows[0]?.expiresAt ? new Date(rows[0].expiresAt) : null;
  const months = exp ? (exp.getUTCFullYear() - new Date().getUTCFullYear()) * 12 + exp.getUTCMonth() - new Date().getUTCMonth() : null;
  check(`${tag}-5`, persona, 'API', J, 'điểm cộng có hạn 12 tháng', 'loyalty.point_expire_months=12', months === 12, `expiresAt=${rows[0]?.expiresAt}`);
  const lo = (await A(persona, 'GET', '/me/loyalty')).body;
  check(`${tag}-6`, persona, 'API', J, 'điểm chờ: lockedPoints = điểm đơn, redeemable = số dư - khoá, lockedUntil = giao + 7 ngày', 'returns.window_days=7 (lockedOrderPoints, loyalty.service.ts:614)', lo.lockedPoints === p.quote.pointsEarned && lo.redeemablePoints === lo.pointsBalance - lo.lockedPoints && !!lo.lockedUntil, `GET /me/loyalty ${JSON.stringify({ pointsBalance: lo.pointsBalance, lockedPoints: lo.lockedPoints, lockedUntil: lo.lockedUntil, redeemablePoints: lo.redeemablePoints, earnMultiplier: lo.earnMultiplier, tier: lo.tier?.id })}`);
  // Thử tiêu điểm đang chờ ở báo giá: phải bị chặn (kẹp về phần dùng được).
  const probe = await place(persona, [{ slug: 'nuoc-rua-chen-fuwa3e', qty: 1 }], { tag: tag + 'q', pointsToUse: lo.pointsBalance });
  const redeemableNow = lo.redeemablePoints;
  const usedQ = probe.quote?.pointsUsed ?? 0;
  check(`${tag}-7`, persona, 'API', J, 'báo giá với pointsToUse = toàn bộ số dư: chỉ dùng được phần không bị khoá', 'chỉ tiêu phần vượt lockedOrderPoints (loyalty.service.ts:100-110 comment); max_redeem_pct=20%', usedQ <= redeemableNow, `quote.pointsUsed=${usedQ} redeemable=${redeemableNow} pointsMax=${probe.quote?.pointsMax} pointsNotice=${probe.quote?.pointsNotice ?? ''}`);
  // huỷ đơn thử để khỏi để lại đơn mở và trả điểm đã dùng
  if (probe.order) { const c = await A(persona, 'POST', `/orders/${codeOf(probe.order)}/cancel`, { cancelReasonCode: 'CHANGED_MIND' }); rec(`${tag}-7x`, persona, 'API', J, 'dọn: huỷ đơn thử', '', `cancel ${c.status}`, JSON.stringify(c.body).slice(0, 200), c.ok ? 'PASS' : 'BLOCKED'); }
  // Lùi giao 8 ngày: hết cửa sổ đổi/trả -> điểm dùng được
  await sql(`UPDATE orders SET "deliveredAt" = "deliveredAt" - interval '8 days' WHERE code=$1 RETURNING id`, code);
  const lo2 = (await A(persona, 'GET', '/me/loyalty')).body;
  check(`${tag}-8`, persona, 'API', J, 'lùi giao 8 ngày: hết cửa sổ -> điểm dùng được (locked 0, redeemable = số dư)', 'returns.window_days=7', lo2.lockedPoints === 0 && lo2.redeemablePoints === lo2.pointsBalance, `GET /me/loyalty sau lùi: ${JSON.stringify({ pointsBalance: lo2.pointsBalance, lockedPoints: lo2.lockedPoints, redeemablePoints: lo2.redeemablePoints })}`);
  const tr = (await A(persona, 'GET', '/me/points/transactions?limit=20')).body;
  const arr = Array.isArray(tr) ? tr : tr.data ?? tr.items ?? [];
  const row = arr.find((r) => r.reason === `ORDER_DELIVERED:${code}`);
  const sorted = arr.every((r, i) => i === 0 || new Date(arr[i - 1].createdAt) >= new Date(r.createdAt));
  check(`${tag}-9`, persona, 'API', J, 'lịch sử điểm: có dòng ORDER_DELIVERED đúng delta, sắp mới nhất trước', 'getPointsTransactions mới nhất trước', !!row && row.delta === p.quote.pointsEarned && sorted, `GET /me/points/transactions: row=${JSON.stringify({ reason: row?.reason, delta: row?.delta, createdAt: row?.createdAt })} sorted=${sorted} n=${arr.length}`);
}
await done();
