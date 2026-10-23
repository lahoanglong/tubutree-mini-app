#!/usr/bin/env node
// U2-07..U2-08: tin nhắc điểm sắp hết hạn (trước 7 ngày, chống gửi lặp) và điểm hết hạn sau 12 tháng (lùi mốc + job points.expire),
// gồm lô đã tiêu một phần (FIFO: chỉ phần còn lại của lô hết hạn bị trừ).
// Chạy sau u2-a-earn.mjs (dùng khách uat_u2_mam và uat_returning). Dùng: node u2-b-expiry.mjs [lane=7] [--headed]
import { prisma, kase, main, ledger, rowsFor, runJob, loyaltyOf, q, x, shotPage } from './u2lib.mjs';

const DAY = 86_400_000;

async function notifRows(userId) {
  return q(`SELECT id, "templateCode", channel::text AS channel, status::text AS status, "sentAt", payload FROM notification_logs WHERE "userId" = $1 AND "templateCode" = 'POINTS_EXPIRING' ORDER BY "sentAt"`, userId).catch(async () =>
    q(`SELECT * FROM notification_logs WHERE "userId" = $1 AND "templateCode" = 'POINTS_EXPIRING'`, userId),
  );
}

await main(async (results) => {
  const MAM = 'uat_u2_mam';
  const first = (await rowsFor(MAM, 'ORDER_DELIVERED:%'))[0];

  {
    const c = kase('U2-07', 'Tin nhắc điểm sắp hết hạn: lô hết hạn sau 10 ngày không nhắc; sau 5 ngày nhắc 1 lần; chạy lại không nhắc lặp');
    try {
      c.ev('lô thử', { reason: first.reason, delta: first.delta });
      const n0 = (await notifRows(MAM)).length;
      // Mọi lô của khách ra ngoài cửa sổ 7 ngày, trừ lô thử
      await x(`UPDATE points_transactions SET "expiresAt" = now() + interval '300 days' WHERE "userId" = $1 AND delta > 0 AND reason <> $2`, MAM, first.reason);
      await x(`UPDATE points_transactions SET "expiresAt" = now() + interval '10 days' WHERE "userId" = $1 AND reason = $2`, MAM, first.reason);
      const j1 = runJob('points.expiry-reminder');
      const n1 = (await notifRows(MAM)).length;
      c.check('lô hết hạn sau 10 ngày (ngoài cửa sổ 7 ngày): job không tạo tin nhắc', n1 === n0, { before: n0, after: n1, job: j1.result ?? null });
      await x(`UPDATE points_transactions SET "expiresAt" = now() + interval '5 days' WHERE "userId" = $1 AND reason = $2`, MAM, first.reason);
      const lo = await loyaltyOf(MAM);
      c.ev('/me/loyalty expiringPoints', lo.expiringPoints);
      c.check('/me/loyalty báo expiringPoints đúng lô (amount, ngày)', lo.expiringPoints && lo.expiringPoints.amount === first.delta && Math.abs(new Date(lo.expiringPoints.expiresAt).getTime() - (Date.now() + 5 * DAY)) < 5 * 60_000, lo.expiringPoints);
      runJob('points.expiry-reminder');
      const rows2 = await notifRows(MAM);
      c.ev('notification_logs POINTS_EXPIRING', rows2);
      c.check('lô hết hạn sau 5 ngày: job tạo đúng 1 dòng notification_logs POINTS_EXPIRING', rows2.length === n0 + 1, { count: rows2.length });
      runJob('points.expiry-reminder');
      const rows3 = await notifRows(MAM);
      c.check('chạy job lần 2 trong kỳ: không nhắc lặp', rows3.length === rows2.length, { count: rows3.length });
      const shot = await shotPage(MAM, '/loyalty', 'U2-07-loyalty-expiring');
      const line = shot.text.split('\n').filter((t) => /hết hạn/i.test(t)).slice(0, 4);
      c.ev('màn /loyalty', { shot: shot.file, lines: line });
      c.check('màn /loyalty Mini App hiện dòng điểm sắp hết hạn', line.length > 0, line);
      const inapp = await q(`SELECT title, body, "createdAt" FROM notifications WHERE "userId" = $1 ORDER BY "createdAt" DESC LIMIT 3`, MAM).catch((e) => `bảng notifications: ${e.message.split('\n').pop()}`);
      c.ev('thông báo trong app (bảng notifications, nếu có)', inapp);
    } catch (e) {
      c.error(e);
    }
    results.push(c.finish());
  }

  {
    const c = kase('U2-08', 'Điểm hết hạn 12 tháng: lùi hạn lô về quá khứ, chạy points.expire → trừ đúng phần còn lại (FIFO), số dư = sổ, chạy lại không trừ lần hai');
    try {
      // (a) lô chưa tiêu: khách Mầm Xanh, lô 500 điểm của đơn đầu
      const b1 = await ledger(MAM);
      await x(`UPDATE points_transactions SET "expiresAt" = now() - interval '1 minute' WHERE "userId" = $1 AND reason = $2`, MAM, first.reason);
      const j = runJob('points.expire');
      const a1 = await ledger(MAM);
      const exp1 = await rowsFor(MAM, 'POINTS_EXPIRED');
      c.ev('(a) Mầm Xanh', { before: b1.balance, after: a1.balance, expiredRows: exp1.map((r) => r.delta), job: j.ms });
      c.check('(a) lô 500 điểm chưa tiêu: 1 dòng POINTS_EXPIRED −500, số dư −500, = SUM sổ', exp1.length === 1 && exp1[0].delta === -first.delta && a1.balance === b1.balance - first.delta && a1.balance === a1.stdSum, { exp: exp1.map((r) => r.delta), before: b1.balance, after: a1.balance, sum: a1.stdSum });
      // (b) lô đã tiêu một phần: uat_returning có lô 34.400 (đơn cũ, cộng trước) rồi tiêu 24.000 ở U2-05 → lô cũ còn 10.400
      const R = 'uat_returning';
      const lots = await q(`SELECT delta::int AS delta, reason, "createdAt", "expiresAt" FROM points_transactions WHERE "userId" = $1 ORDER BY "createdAt"`, R);
      c.ev('(b) sổ uat_returning trước', lots);
      const oldLot = lots.find((r) => r.delta > 0 && r.reason.startsWith('ORDER_DELIVERED:'));
      const spent = -lots.filter((r) => r.delta < 0).reduce((s, r) => s + r.delta, 0);
      const remain = Math.max(0, oldLot.delta - spent);
      const b2 = await ledger(R);
      await x(`UPDATE points_transactions SET "expiresAt" = now() - interval '1 minute' WHERE "userId" = $1 AND reason = $2`, R, oldLot.reason);
      runJob('points.expire');
      const a2 = await ledger(R);
      const exp2 = await rowsFor(R, 'POINTS_EXPIRED');
      c.ev('(b) sau', { oldLot: oldLot.delta, spent, expectExpire: remain, before: b2.balance, after: a2.balance, expiredRows: exp2.map((r) => r.delta) });
      c.check(`(b) lô ${oldLot.delta} đã bị tiêu ${spent} (FIFO): chỉ trừ ${remain}, số dư = SUM sổ`, exp2.length === 1 && exp2[0].delta === -remain && a2.balance === b2.balance - remain && a2.balance === a2.stdSum, { exp: exp2.map((r) => r.delta), before: b2.balance, after: a2.balance, sum: a2.stdSum });
      runJob('points.expire');
      const a3 = await ledger(R);
      const a3m = await ledger(MAM);
      c.check('chạy points.expire lần 2: không trừ thêm', a3.balance === a2.balance && a3m.balance === a1.balance && (await rowsFor(R, 'POINTS_EXPIRED')).length === 1, { R: a3.balance, MAM: a3m.balance });
      const lo = await loyaltyOf(R);
      c.check('/me/loyalty: pointsBalance = số dư DB sau hết hạn', lo.pointsBalance === a3.balance, { api: lo.pointsBalance, db: a3.balance });
      const tx = await q(`SELECT delta::int AS delta, reason FROM points_transactions WHERE "userId" = $1 AND reason = 'POINTS_EXPIRED'`, R);
      c.ev('dòng sổ hết hạn', tx);
    } catch (e) {
      c.error(e);
    }
    results.push(c.finish());
  }
});
