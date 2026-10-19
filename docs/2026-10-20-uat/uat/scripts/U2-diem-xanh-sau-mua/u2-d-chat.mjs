#!/usr/bin/env node
// U2-16..U2-17: B9 đơn CSKH lên trên Pancake (nguồn chat) tự cộng Điểm Xanh theo SĐT: tỉ lệ như đơn app (2% × hệ số hạng), chờ giao + 14
// ngày, tính hạng; SĐT chưa vào Mini App thì giữ 30 ngày, khách vào Mini App và chia sẻ đúng SĐT đó thì nhận; quá 30 ngày thì hết hiệu lực.
// Cờ loyalty.chat_order_points_enabled mặc định TẮT lúc mở khách: ca bật trên lane. Dùng: node u2-d-chat.mjs [lane=7] [--headed]
import fs from 'node:fs';
import path from 'node:path';
import { L, prisma, kase, main, ledger, open, api, setConfig, sendPlatform, runJob, loyaltyOf, q, x, sleep, headless, SHOTS, fillCart, log, pct } from './u2lib.mjs';

const R = 'uat_returning';
const claimsByOrder = async (pancakeId) =>
  q(`SELECT c.id, c."userId", c.kind::text AS kind, c.state::text AS state, c.points, c."ratePct"::text AS "ratePct", c.multiplier::text AS multiplier, c."countsForTier", c."releaseAt", c."holdUntil", c."reviewReason", c."orderPhone", e.status::text AS "orderStatus", e."goodsValue", e."deliveredAt"
     FROM external_points_claims c JOIN external_orders e ON e.id = c."externalOrderId" WHERE e."pancakeOrderId" = $1 ORDER BY c."createdAt"`, String(pancakeId));
const notifs = (userId, code) => q(`SELECT "templateCode", channel, status, "sentAt" FROM notification_logs WHERE "userId" = $1 AND "templateCode" LIKE $2 ORDER BY "sentAt"`, userId, code);

function addPlatformOrder(id, phone, tracking, price) {
  const file = path.join(L.pancakeDir, 'platform-orders.json');
  const list = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (list.some((o) => o.id === id)) return;
  const tpl = list.find((o) => o.id === 7700006);
  list.push({ ...structuredClone(tpl), id, bill_phone_number: phone, shipping_address: { ...tpl.shipping_address, phone_number: phone }, partner: { extend_code: tracking }, tracking_number: tracking, items: [{ ...tpl.items[0], variation_info: { ...tpl.items[0].variation_info, retail_price: price } }], total_price: price });
  fs.writeFileSync(file, `${JSON.stringify(list, null, 2)}\n`);
}

await main(async (results) => {
  await setConfig('loyalty.chat_order_points_enabled', true);
  log('dựng', 'bật loyalty.chat_order_points_enabled qua PUT /admin/config');
  await sleep(1200);

  {
    const c = kase('U2-16', 'Đơn CSKH (chat) 210.000đ của SĐT khách Lộc Biếc: webhook giao → claim PHONE tự tạo, 5.040 điểm (2% × 1,2); giao + 14 ngày → job cộng, tính vào hạng');
    try {
      const b0 = await ledger(R);
      const t0 = await loyaltyOf(R);
      const wh = await sendPlatform(L, 'GHTKUAT0000005', 'delivered');
      c.ev('webhook đơn chat 7700005', { http: wh.http, event: wh.event?.status, ext: wh.externalOrder && { source: wh.externalOrder.source, status: wh.externalOrder.status, phone: wh.externalOrder.phone, goodsValue: wh.externalOrder.goodsValue } });
      let [cl] = await claimsByOrder(7700005);
      c.ev('claim sau webhook', cl);
      const exp = pct(210000, 2, 1.2);
      c.check(`claim PHONE của uat_returning, PENDING, ${exp} điểm, ratePct 2, multiplier 1,2, countsForTier`, cl && cl.kind === 'PHONE' && cl.userId === R && cl.state === 'PENDING' && cl.points === exp && Number(cl.ratePct) === 2 && Number(cl.multiplier) === 1.2 && cl.countsForTier === true, cl && { kind: cl.kind, userId: cl.userId, state: cl.state, points: cl.points, ratePct: cl.ratePct, multiplier: cl.multiplier, countsForTier: cl.countsForTier });
      c.check('releaseAt = giao + 14 ngày', cl?.releaseAt && Math.abs(new Date(cl.releaseAt).getTime() - (new Date(cl.deliveredAt).getTime() + 14 * 86_400_000)) < 60_000, { releaseAt: cl?.releaseAt, deliveredAt: cl?.deliveredAt });
      const mine = await api(L, 'GET', '/me/external-points/claims?kind=PHONE', { user: R });
      c.ev('GET /me/external-points/claims?kind=PHONE', { status: mine.status, items: mine.body?.items?.map((i) => ({ state: i.state, points: i.points, kind: i.kind, expectedCreditAt: i.expectedCreditAt })) });
      runJob('external-claims.release');
      c.check('job trước hạn: chưa cộng', (await claimsByOrder(7700005))[0].state === 'PENDING');
      await x(`UPDATE external_orders SET "deliveredAt" = "deliveredAt" - interval '15 days' WHERE "pancakeOrderId" = '7700005'`);
      await x(`UPDATE external_points_claims SET "releaseAt" = "releaseAt" - interval '15 days' WHERE id = $1`, cl.id);
      const job = runJob('external-claims.release');
      c.ev('job release', job.result ?? job);
      [cl] = await claimsByOrder(7700005);
      const rows = await q(`SELECT delta::int AS delta, reason, lot::text AS lot FROM points_transactions WHERE "userId" = $1 AND reason LIKE 'PANCAKE_CHAT_ORDER%'`, R);
      const b1 = await ledger(R);
      const t1 = await loyaltyOf(R);
      c.ev('sau cộng', { state: cl.state, rows, bal: [b0.balance, b1.balance], spent12m: [t0.spent12m, t1.spent12m], tierPoints: [t0.tierPoints, t1.tierPoints] });
      c.check(`CREDITED, 1 dòng PANCAKE_CHAT_ORDER:7700005 +${exp}, số dư + ${exp} = SUM sổ`, cl.state === 'CREDITED' && rows.length === 1 && rows[0].delta === exp && b1.balance === b0.balance + exp && b1.balance === b1.stdSum, { state: cl.state, rows: rows.map((r) => r.delta), before: b0.balance, after: b1.balance, sum: b1.stdSum });
      c.check('tính hạng: spent12m +210.000, tierPoints +điểm', t1.spent12m === t0.spent12m + 210000 && t1.tierPoints === t0.tierPoints + exp, { spent12m: [t0.spent12m, t1.spent12m], tierPoints: [t0.tierPoints, t1.tierPoints] });
      const n = await notifs(R, 'CHAT_ORDER_POINTS%');
      c.ev('notification_logs CHAT_ORDER_POINTS_*', n);
      c.check('có bản ghi thông báo cộng điểm đơn chat (OA tắt trên lane, INAPP vẫn phải có)', n.some((r) => r.templateCode === 'CHAT_ORDER_POINTS_CREDITED'), n.map((r) => [r.templateCode, r.channel, r.status]));
      // Webhook lặp lại không cộng lần hai
      await sendPlatform(L, 'GHTKUAT0000005', 'delivered');
      runJob('external-claims.release');
      const rows2 = await q(`SELECT count(*)::int AS n FROM points_transactions WHERE "userId" = $1 AND reason = 'PANCAKE_CHAT_ORDER:7700005'`, R);
      c.check('webhook lặp + job lặp: vẫn đúng 1 dòng sổ', rows2[0].n === 1, rows2[0].n);
    } catch (e) {
      c.error(e);
    }
    results.push(c.finish());
  }

  {
    const c = kase('U2-17', 'Đơn CSKH của SĐT chưa vào Mini App (0901000013): giữ 30 ngày (HELD_NO_MEMBER); khách mới vào Mini App, chia sẻ SĐT đó lúc đặt đơn → nhận điểm');
    try {
      const wh = await sendPlatform(L, 'GHTKUAT0000006', 'delivered');
      c.ev('webhook 7700006', { http: wh.http, event: wh.event?.status });
      let [cl] = await claimsByOrder(7700006);
      c.check('claim PHONE chưa có chủ (userId null), PENDING, orderPhone 0901000013', cl && cl.userId === null && cl.kind === 'PHONE' && cl.state === 'PENDING' && cl.orderPhone === '0901000013', cl && { userId: cl.userId, state: cl.state, orderPhone: cl.orderPhone, points: cl.points });
      await x(`UPDATE external_orders SET "deliveredAt" = "deliveredAt" - interval '15 days' WHERE "pancakeOrderId" = '7700006'`);
      await x(`UPDATE external_points_claims SET "releaseAt" = "releaseAt" - interval '15 days' WHERE id = $1`, cl.id);
      runJob('external-claims.release');
      [cl] = await claimsByOrder(7700006);
      const holdDays = cl.holdUntil && cl.releaseAt ? (new Date(cl.holdUntil).getTime() - new Date(cl.releaseAt).getTime()) / 86_400_000 : null;
      c.ev('sau job', { state: cl.state, releaseAt: cl.releaseAt, holdUntil: cl.holdUntil, holdDays });
      c.check('tới hạn mà chưa có thành viên: HELD_NO_MEMBER, holdUntil = mốc cộng + 30 ngày', cl.state === 'HELD_NO_MEMBER' && holdDays !== null && Math.abs(holdDays - 30) < 0.01, { state: cl.state, holdDays });
      // Khách mới (chưa có SĐT) vào Mini App, đặt đơn đầu, chia sẻ SĐT 0901000013 khi app xin
      const U = 'uat_u2_chatnew';
      if (!(await prisma.user.findUnique({ where: { id: U } }))) {
        await prisma.user.create({ data: { id: U, zaloId: 'uat-zalo-u2-chatnew', fullName: 'Khách U2 Từ Chat', referralCode: 'U2CHATNEW', role: 'CUSTOMER' } });
        await api(L, 'POST', '/me/onboarding', { user: U, body: { segments: ['home_clean'] } });
      }
      // Địa chỉ cần SĐT người nhận; SĐT tài khoản vẫn trống tới khi khách chia sẻ
      const hasAddr = await prisma.address.findFirst({ where: { userId: U } });
      if (!hasAddr) {
        await api(L, 'POST', '/me/addresses', { user: U, body: { recipient: 'Khách Từ Chat', phone: '0901000013', province: 'Thành phố Hồ Chí Minh', district: '', ward: 'Phường Bến Thành', street: '5 Lê Lợi', provinceCode: '84_VN79', districtCode: '', wardCode: '84_VN7926743', isDefault: true } });
      }
      await fillCart(U, [['FUWA-DW-1L', 1], ['FUWA-GL-500', 1]]);
      const s = await open(L.n, U, { headless, path: '/cart', phone: '0901000013' });
      let placedStatus = null;
      try {
        const p = s.page;
        await p.getByRole('button', { name: /^Thanh toán \(\d+\)$/ }).click({ timeout: 20_000 });
        await p.waitForURL(/\/checkout$/, { timeout: 15_000 });
        const place = p.getByRole('button', { name: /^Đặt hàng · / });
        await place.waitFor({ timeout: 20_000 });
        const resp = p.waitForResponse((r) => r.url().endsWith('/api/checkout/place-order') && r.request().method() === 'POST', { timeout: 40_000 }).catch(() => null);
        await place.click();
        const r = await resp;
        placedStatus = r ? r.status() : null;
        await sleep(1500);
        await p.screenshot({ path: path.join(SHOTS, 'U2-17-chat-new-checkout.png') });
        c.ev('Mini App', { placeOrder: placedStatus, zmp: (await s.zmpCalls()).map((z) => z.name), auth: s.requests.filter((r2) => r2.path.startsWith('/auth/')).map((r2) => `${r2.method} ${r2.path} ${r2.status}${r2.mocked ? ' [giả]' : ''}`) });
      } finally {
        await s.close();
      }
      const u = await prisma.user.findUnique({ where: { id: U }, select: { phone: true, phoneVerifiedAt: true, pointsBalance: true } });
      c.check('Mini App xin SĐT (getPhoneNumber → /auth/ensure-phone), tài khoản có SĐT 0901000013', u.phone === '0901000013', u);
      [cl] = await claimsByOrder(7700006);
      c.ev('claim sau khi khách vào app', cl);
      if (cl.userId === U && cl.state !== 'CREDITED') runJob('external-claims.release');
      [cl] = await claimsByOrder(7700006);
      const rows = await q(`SELECT delta::int AS delta, reason FROM points_transactions WHERE "userId" = $1 AND reason LIKE 'PANCAKE_CHAT_ORDER%'`, U);
      const b = await ledger(U);
      c.ev('sau liên kết', { claim: { userId: cl.userId, state: cl.state, points: cl.points }, rows, balance: b.balance, stdSum: b.stdSum });
      c.check('claim gắn vào khách mới và CREDITED 3.600 điểm (2% × 180.000, khách chưa có hạng ×1), số dư = SUM sổ', cl.userId === U && cl.state === 'CREDITED' && rows.length === 1 && rows[0].delta === 3600 && b.balance === b.stdSum, { userId: cl.userId, state: cl.state, rows: rows.map((r) => r.delta), balance: b.balance });
      c.ev('notification_logs', await notifs(U, 'CHAT_ORDER_POINTS%'));
      // Quá 30 ngày không ai nhận → LAPSED, không ghi sổ
      addPlatformOrder(7700008, '0901000019', 'GHTKUAT0000008', 150000);
      await sendPlatform(L, 'GHTKUAT0000008', 'delivered');
      let [cl8] = await claimsByOrder(7700008);
      await x(`UPDATE external_orders SET "deliveredAt" = "deliveredAt" - interval '15 days' WHERE "pancakeOrderId" = '7700008'`);
      await x(`UPDATE external_points_claims SET "releaseAt" = "releaseAt" - interval '15 days' WHERE id = $1`, cl8.id);
      runJob('external-claims.release');
      await x(`UPDATE external_points_claims SET "holdUntil" = now() - interval '1 minute' WHERE id = $1 AND state = 'HELD_NO_MEMBER'`, cl8.id);
      runJob('external-claims.release');
      [cl8] = await claimsByOrder(7700008);
      const r8 = await q(`SELECT count(*)::int AS n FROM points_transactions WHERE reason = 'PANCAKE_CHAT_ORDER:7700008'`);
      c.ev('đơn chat 7700008 không ai nhận', { state: cl8.state, ledgerRows: r8[0].n });
      c.check('quá hạn giữ 30 ngày: LAPSED, không ghi sổ', cl8.state === 'LAPSED' && r8[0].n === 0, { state: cl8.state, rows: r8[0].n });
    } catch (e) {
      c.error(e);
    }
    results.push(c.finish());
  }
});
