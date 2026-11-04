// C1: hết hạn điểm (lùi mốc bằng SQL + job points.expire), nhắc sắp hết hạn; C2: rớt hạng có ân hạn 30 ngày rồi hạ hạng.
import { A, makeRec, place, codeOf, deliver, job, sql, sql1, pointsLedger, done, L, sleep } from './lib3.mjs';
const { rec, check } = makeRec('c1-expiry-tier');
const J = 'Điểm Xanh: hết hạn';
const U = process.env.PERSONA_C1 ?? 'cskh', uid = `uat_${U}`;
const vDW = (await sql1(`SELECT id FROM variations WHERE sku='FUWA-DW-1L'`)).id;
const o = [];
for (const [i, qty] of [[1, 3], [2, 2]]) {
  const p = await place(U, [{ vid: vDW, qty }], { tag: `C1o${i}` });
  const code = codeOf(p.order);
  const dl = await deliver(code);
  if (dl.some((x) => x.error)) console.log('deliver lỗi', JSON.stringify(dl));
  job('DeliveredEffectsResyncCron.resyncPending');
  await sql(`UPDATE orders SET "deliveredAt" = "deliveredAt" - interval '8 days' WHERE code=$1 RETURNING id`, code);
  o.push({ code, pts: p.quote.pointsEarned, id: (await sql1(`SELECT id FROM orders WHERE code=$1`, code)).id });
}
check('C1-1', U, 'API', J, 'hai đơn giao xong cộng điểm 2 lô riêng', 'loyalty.earn_pct=2 (hạng chưa có ×1)', o.length === 2 && (await pointsLedger(uid)).bal === o[0].pts + o[1].pts, `đơn=${JSON.stringify(o)} sổ=${JSON.stringify(await pointsLedger(uid))}`);
// Tiêu 1.000 điểm (FIFO từ lô đơn 1) bằng đơn thứ ba
const p3 = await place(U, [{ vid: vDW, qty: 1 }], { tag: 'C1o3', pointsToUse: 1000 });
const code3 = codeOf(p3.order);
const afterSpend = await pointsLedger(uid);
check('C1-2', U, 'API', J, 'tiêu 1.000 điểm khi đặt đơn (đã hết khoá), sổ khớp', 'max_redeem_pct=20%; 1 điểm = 1đ', p3.quote.pointsUsed === 1000 && afterSpend.bal === o[0].pts + o[1].pts - 1000 && afterSpend.bal === afterSpend.sum_std, `quote.pointsUsed=${p3.quote.pointsUsed} sổ=${JSON.stringify(afterSpend)}`);
// Lùi hạn lô đơn 1 về quá khứ
await sql(`UPDATE points_transactions SET "expiresAt" = now() - interval '1 minute' WHERE reason=$1 RETURNING id`, `ORDER_DELIVERED:${o[0].code}`);
const j = job('points.expire');
const after = await pointsLedger(uid);
const ex = await sql(`SELECT delta::int, lot, reason, "refType", "refId" FROM points_transactions WHERE "userId"=$1 AND reason='POINTS_EXPIRED'`, uid);
const expectedExpired = o[0].pts - 1000;
check('C1-3', U, 'API', J, 'job points.expire: trừ đúng phần còn lại của lô hết hạn (lô đơn 1 trừ phần đã tiêu FIFO), không đụng lô đơn 2', 'loyalty-expiry.service.ts: FIFO tiêu lô cũ nhất; EXPIRY_REASON POINTS_EXPIRED', ex.length === 1 && ex[0].delta === -expectedExpired && after.bal === o[1].pts && after.bal === after.sum_std, `job=${JSON.stringify(j.result ?? j)} POINTS_EXPIRED=${JSON.stringify(ex)} kỳ vọng -${expectedExpired}; số dư trước=${afterSpend.bal} sau=${after.bal} (kỳ vọng ${o[1].pts}) sổ=${JSON.stringify(after)}`);
const j2 = job('points.expire');
const ex2 = await sql(`SELECT count(*)::int n FROM points_transactions WHERE "userId"=$1 AND reason='POINTS_EXPIRED'`, uid);
check('C1-4', U, 'API', J, 'chạy job lần hai: không trừ lần hai', 'idempotent', ex2[0].n === 1 && (await pointsLedger(uid)).bal === after.bal, `job2=${JSON.stringify(j2.result ?? j)} số dòng POINTS_EXPIRED=${ex2[0].n}`);
const tr = (await A(U, 'GET', '/me/points/transactions?limit=10')).body;
const arr = Array.isArray(tr) ? tr : tr.data ?? tr.items ?? [];
check('C1-5', U, 'API', J, 'lịch sử điểm hiện dòng hết hạn', 'GET /me/points/transactions', !!arr.find((r) => r.reason === 'POINTS_EXPIRED' && r.delta === -expectedExpired), `dòng=${JSON.stringify(arr.find((r) => r.reason === 'POINTS_EXPIRED'))}`);
// Nhắc sắp hết hạn: đặt hạn lô đơn 2 sau 3 ngày
await sql(`UPDATE points_transactions SET "expiresAt" = now() + interval '3 days' WHERE reason=$1 RETURNING id`, `ORDER_DELIVERED:${o[1].code}`);
const jr = job('points.expiry-reminder');
const lo = (await A(U, 'GET', '/me/loyalty')).body;
const feed = (await A(U, 'GET', '/me/notifications')).body;
const items = feed?.items ?? feed?.data ?? (Array.isArray(feed) ? feed : []);
const rem = items.find((n) => /EXPIR|hết hạn/i.test(JSON.stringify(n)));
check('C1-6', U, 'API', J, 'điểm sắp hết hạn trong 7 ngày: /me/loyalty báo expiringPoints, job nhắc tạo thông báo', 'loyalty.point_expiry_reminder_days=7', lo.expiringPoints?.amount === o[1].pts && !!rem, `job=${JSON.stringify(jr.result ?? jr)} expiringPoints=${JSON.stringify(lo.expiringPoints)} thông báo=${rem ? JSON.stringify(rem).slice(0, 350) : 'không thấy; ' + JSON.stringify(items.slice(0, 2)).slice(0, 300)}`);
const jr2 = job('points.expiry-reminder');
const feed2 = (await A(U, 'GET', '/me/notifications')).body;
const items2 = feed2?.items ?? feed2?.data ?? (Array.isArray(feed2) ? feed2 : []);
check('C1-7', U, 'API', J, 'chạy job nhắc lần hai: không nhắc trùng', 'dedupe', items2.filter((n) => /EXPIR|hết hạn/i.test(JSON.stringify(n))).length === items.filter((n) => /EXPIR|hết hạn/i.test(JSON.stringify(n))).length, `trước=${items.filter((n) => /EXPIR|hết hạn/i.test(JSON.stringify(n))).length} sau=${items2.filter((n) => /EXPIR|hết hạn/i.test(JSON.stringify(n))).length}`);
// dọn đơn 3
if (code3) await A(U, 'POST', `/orders/${code3}/cancel`, { cancelReasonCode: 'CHANGED_MIND' });

// C2: rớt hạng có ân hạn
const B = process.env.PERSONA_C2 ?? 'kho', bid = `uat_${B}`;
const t0 = await sql1(`SELECT "tierId" t, "tierGraceUntil" g FROM users WHERE id=$1`, bid);
await sql(`UPDATE orders SET "createdAt" = "createdAt" - interval '13 months' WHERE "userId"=$1 AND status='DELIVERED' RETURNING id`, bid);
await sql(`UPDATE points_transactions SET "createdAt" = "createdAt" - interval '13 months' WHERE "userId"=$1 RETURNING id`, bid);
const jt = job('tiers.recalc');
const t1 = await sql1(`SELECT "tierId" t, "tierGraceUntil" g FROM users WHERE id=$1`, bid);
const days = t1.g ? (new Date(t1.g).getTime() - Date.now()) / 864e5 : null;
check('C2-1', B, 'API', J, 'chi tiêu 12 tháng rớt mốc: GIỮ hạng cũ, đặt ân hạn 30 ngày', 'loyalty.tier_grace_days=30; tier-policy.ts decideTier', t1.t === t0.t && days > 29 && days <= 30.01, `job=${JSON.stringify(jt.result ?? jt)} trước=${JSON.stringify(t0)} sau=${JSON.stringify(t1)} ân hạn còn ${days?.toFixed(2)} ngày`);
const lg = (await A(B, 'GET', '/me/loyalty')).body;
check('C2-2', B, 'API', J, '/me/loyalty hiện tierGrace khi đang ân hạn', 'getOverview tierGrace', !!lg.tierGrace, `tierGrace=${JSON.stringify(lg.tierGrace)} tier=${lg.tier?.id}`);
const jt2 = job('tiers.recalc');
const t2 = await sql1(`SELECT "tierId" t, "tierGraceUntil" g FROM users WHERE id=$1`, bid);
check('C2-3', B, 'API', J, 'job chạy lần hai: ân hạn KHÔNG gia hạn', 'tier-policy.ts: còn trong grace → giữ, không gia hạn', String(t2.g) === String(t1.g), `ân hạn trước=${t1.g} sau=${t2.g}`);
await sql(`UPDATE users SET "tierGraceUntil" = now() - interval '1 minute' WHERE id=$1 RETURNING id`, bid);
const jt3 = job('tiers.recalc');
const t3 = await sql1(`SELECT "tierId" t, "tierGraceUntil" g FROM users WHERE id=$1`, bid);
check('C2-4', B, 'API', J, 'hết ân hạn: hạ về hạng đạt được (Mầm Xanh), xoá ân hạn', 'tier-policy.ts', t3.t === 'MAM_XANH' && t3.g === null, `job=${JSON.stringify(jt3.result ?? jt3)} sau=${JSON.stringify(t3)}`);
const lg2 = (await A(B, 'GET', '/me/loyalty')).body;
check('C2-5', B, 'API', J, '/me/loyalty sau hạ hạng: hệ số 1, hạng Mầm Xanh', 'membership_tiers', lg2.tier?.id === 'MAM_XANH' && lg2.earnMultiplier === 1, `tier=${lg2.tier?.id} earnMultiplier=${lg2.earnMultiplier}`);
await done();
