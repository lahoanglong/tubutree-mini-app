#!/usr/bin/env node
// U2-09..U2-15: tích điểm đơn sàn bằng quét/nhập mã vận đơn (B6) trên Mini App /points/scan, khớp đơn trên giả Pancake.
// Luật: 1% tiền hàng, không nhân hệ số hạng, không tính hạng, mỗi mã một lần, chờ giao + 14 ngày, đơn hoàn thì huỷ.
// Cờ B6 mặc định TẮT lúc mở khách (loyalty.marketplace_claim_enabled, pancake.external_lookup_enabled): ca này bật trên lane để
// nghiệm thu trước khi chủ bật. Dùng: node u2-c-platform.mjs [lane=7] [--headed]
import fs from 'node:fs';
import path from 'node:path';
import { L, prisma, kase, main, ledger, open, api, setConfig, sendPlatform, runJob, loyaltyOf, q, x, sleep, headless, SHOTS, log } from './u2lib.mjs';

const R = 'uat_returning';
const NEW = 'uat_new';
const MAM = 'uat_u2_mam';
const DT = 'uat_u2_daithu';

/** Gửi mã trên Mini App thật: nhập tay hoặc "Quét mã" (scanQRCode giả trả nội dung). Trả HTTP + body + chữ kết quả. */
async function submitOnMini(user, code, { scan = false, shot } = {}) {
  const s = await open(L.n, user, { headless, path: '/points/scan' });
  try {
    const p = s.page;
    const input = p.getByPlaceholder('Ví dụ: SPXVN0123456789');
    await input.waitFor({ timeout: 20_000 });
    if (scan) {
      await s.setQr(code);
      await p.getByRole('button', { name: 'Quét mã' }).click();
      await p.waitForFunction((c) => document.querySelector('input')?.value === c, code, { timeout: 5_000 });
    } else {
      await input.fill(code);
    }
    const resp = p.waitForResponse((r) => r.url().endsWith('/api/me/external-points/claims') && r.request().method() === 'POST', { timeout: 30_000 });
    await p.getByRole('button', { name: 'Tích điểm' }).click();
    const r = await resp;
    const body = await r.json().catch(() => null);
    await sleep(1200);
    if (shot) await p.screenshot({ path: path.join(SHOTS, `${shot}.png`) });
    const alert = await p.getByRole('alert').first().textContent({ timeout: 1500 }).catch(() => null);
    const text = (await p.evaluate(() => document.body.innerText)).split('\n').filter((t) => /Điểm Xanh|Đã ghi nhận|Dự kiến|kiểm tra|Chưa thấy|đã được tích|tài khoản khác|Đang tìm|hoàn/i.test(t)).slice(0, 6);
    const zmp = (await s.zmpCalls()).map((c2) => c2.name);
    return { http: r.status(), body, alert, text, zmp, bad: s.requests.filter((x2) => !x2.mocked && x2.status >= 500) };
  } finally {
    await s.close();
  }
}

const claimOf = async (code) =>
  (await q(`SELECT c.id, c."userId", c.state::text AS state, c.points, c."ratePct"::text AS "ratePct", c.multiplier::text AS multiplier, c."countsForTier", c."releaseAt", c."reviewReason", c.kind::text AS kind, e."pancakeOrderId", e.status::text AS "orderStatus", e."goodsValue", e."deliveredAt"
             FROM external_points_claims c JOIN external_orders e ON e.id = c."externalOrderId" WHERE $1 = ANY(e."trackingCodes") OR e."marketplaceOrderSn" = $1 ORDER BY c."createdAt"`, code));

await main(async (results) => {
  await setConfig('loyalty.marketplace_claim_enabled', true);
  await setConfig('pancake.external_lookup_enabled', true);
  log('dựng', 'bật loyalty.marketplace_claim_enabled + pancake.external_lookup_enabled qua PUT /admin/config (admin)');
  await sleep(1500);

  {
    const c = kase('U2-09', 'Khách Lộc Biếc quét mã vận đơn Shopee đã giao 3 ngày (250.000đ): claim chờ, 2.500 điểm (1%, KHÔNG ×1,2), cộng từ giao + 14 ngày');
    try {
      const before = await ledger(R);
      const t0 = await loyaltyOf(R);
      const r = await submitOnMini(R, 'SPXVN05UAT0001', { scan: true, shot: 'U2-09-scan-result' });
      c.ev('POST /me/external-points/claims', { http: r.http, body: r.body, zmp: r.zmp, text: r.text });
      c.check('Mini App: Quét mã gọi scanQRCode, gửi mã → 201', r.http === 201 && r.zmp.includes('scanQRCode'), { http: r.http, zmp: r.zmp });
      c.check('kết quả: CLAIMED 2.500 điểm (1% × 250.000, không nhân hệ số Lộc Biếc)', r.body?.status === 'CLAIMED' && r.body?.points === 2500, { status: r.body?.status, points: r.body?.points });
      const [cl] = await claimOf('SPXVN05UAT0001');
      c.ev('DB claim', cl);
      const due = cl.deliveredAt ? new Date(new Date(cl.deliveredAt).getTime() + 14 * 86_400_000) : null;
      c.check('DB: claim PENDING, ratePct 1, multiplier 1, countsForTier false, releaseAt = giao + 14 ngày', cl.state === 'PENDING' && Number(cl.ratePct) === 1 && Number(cl.multiplier) === 1 && cl.countsForTier === false && due && Math.abs(new Date(cl.releaseAt).getTime() - due.getTime()) < 60_000, { ratePct: cl.ratePct, multiplier: cl.multiplier, countsForTier: cl.countsForTier, releaseAt: cl.releaseAt, expect: due });
      c.check('màn kết quả hiện "2.500 Điểm Xanh đang chờ cộng" + ngày dự kiến', r.text.some((t) => /2\.500 Điểm Xanh đang chờ cộng/.test(t)) && r.text.some((t) => /Dự kiến cộng từ/.test(t)), r.text);
      const after = await ledger(R);
      c.check('SQL: chưa ghi sổ điểm, số dư không đổi khi claim còn chờ', after.balance === before.balance && after.rows === before.rows, { before: before.balance, after: after.balance });
      runJob('external-claims.release');
      const [cl2] = await claimOf('SPXVN05UAT0001');
      c.check('job external-claims.release trước hạn 14 ngày: vẫn PENDING', cl2.state === 'PENDING', cl2.state);
      const t1 = await loyaltyOf(R);
      c.check('hạng/chi tiêu không đổi', t1.spent12m === t0.spent12m && t1.tierPoints === t0.tierPoints, { spent: [t0.spent12m, t1.spent12m], tierPoints: [t0.tierPoints, t1.tierPoints] });
    } catch (e) {
      c.error(e);
    }
    results.push(c.finish());
  }

  {
    const c = kase('U2-10', 'Nhập lại đúng mã của mình: trả trạng thái claim cũ, không tạo claim mới, không tính lần thử');
    try {
      const att0 = await q(`SELECT count(*)::int AS n FROM external_claim_attempts WHERE "userId" = $1`, R);
      const r = await submitOnMini(R, 'SPXVN05UAT0001', { shot: 'U2-10-resubmit' });
      c.ev('lần 2', { http: r.http, body: r.body, text: r.text });
      const rows = await claimOf('SPXVN05UAT0001');
      const att1 = await q(`SELECT count(*)::int AS n FROM external_claim_attempts WHERE "userId" = $1`, R);
      c.check('HTTP 2xx, cùng claimId, vẫn 1 claim', r.http < 300 && rows.length === 1 && r.body?.claimId === rows[0].id, { http: r.http, claims: rows.length, claimId: r.body?.claimId });
      c.check('không ghi thêm lần thử', att1[0].n === att0[0].n, { before: att0[0].n, after: att1[0].n });
    } catch (e) {
      c.error(e);
    }
    results.push(c.finish());
  }

  {
    const c = kase('U2-11', 'Khách khác nhập mã đã được người khác tích: 409 ALREADY_CLAIMED, không claim mới');
    try {
      const r = await submitOnMini(NEW, 'SPXVN05UAT0001', { shot: 'U2-11-other-user' });
      c.ev('uat_new gửi SPXVN05UAT0001', { http: r.http, body: r.body, alert: r.alert });
      c.check('409 ALREADY_CLAIMED, Mini App báo mã đã được dùng để tích điểm', r.http === 409 && r.body?.code === 'ALREADY_CLAIMED' && /đã được (dùng để )?tích điểm/.test(r.alert ?? ''), { http: r.http, code: r.body?.code, alert: r.alert });
      c.check('DB: vẫn 1 claim của uat_returning', (await claimOf('SPXVN05UAT0001')).length === 1);
    } catch (e) {
      c.error(e);
    }
    results.push(c.finish());
  }

  {
    const c = kase('U2-12', 'Mã của người khác (SĐT trên đơn ≠ SĐT thành viên): claim vào REVIEW, không tự cộng; CSKH huỷ và mở lại mã → chủ đơn nhận được');
    try {
      const r = await submitOnMini(MAM, 'SPXVN05UAT0002', { shot: 'U2-12-other-phone' });
      c.ev('uat_u2_mam gửi mã của uat_new', { http: r.http, body: r.body, text: r.text });
      const [cl] = await claimOf('SPXVN05UAT0002');
      c.check('claim REVIEW, lý do 3 số cuối SĐT khác', r.http === 201 && cl?.state === 'REVIEW' && /3 số cuối/.test(cl?.reviewReason ?? ''), { state: cl?.state, reviewReason: cl?.reviewReason });
      runJob('external-claims.release');
      const [cl1] = await claimOf('SPXVN05UAT0002');
      c.check('job release: claim REVIEW không tự cộng (đơn đã giao 20 ngày)', cl1.state === 'REVIEW', cl1.state);
      const r2 = await api(L, 'POST', '/me/external-points/claims', { user: NEW, body: { code: 'SPXVN05UAT0002' } });
      c.ev('chủ đơn uat_new gửi khi mã đang bị người khác giữ', { status: r2.status, body: r2.body });
      const vr = await api(L, 'POST', `/admin/external-claims/${cl.id}/void-and-reopen`, { user: 'uat_admin', body: { reason: 'Không phải đơn của thành viên này (UAT U2-12)' } });
      c.ev('admin void-and-reopen', { status: vr.status, body: vr.body?.message ?? vr.body?.state });
      const r3 = await submitOnMini(NEW, 'SPXVN05UAT0002', { shot: 'U2-12-owner-after-reopen' });
      c.ev('uat_new gửi lại sau khi mở mã', { http: r3.http, body: r3.body });
      const rows = await claimOf('SPXVN05UAT0002');
      c.check('sau mở lại: chủ đơn tạo được claim (REVIEW vì mã mở lại cần người khác duyệt, hoặc PENDING)', r3.http === 201 && rows.some((x2) => x2.userId === NEW && ['REVIEW', 'PENDING'].includes(x2.state)), rows.map((x2) => [x2.userId, x2.state, x2.reviewReason]));
    } catch (e) {
      c.error(e);
    }
    results.push(c.finish());
  }

  {
    const c = kase('U2-13', 'Mã không có trên Pancake: báo "chưa thấy", ghi lần thử; 5 mã không thấy trong 24h → khoá 24h (429 LOCKED)');
    try {
      const outs = [];
      const r1 = await submitOnMini(DT, 'SPXVN05NOTFOUND1', { shot: 'U2-13-not-found' });
      outs.push({ code: 'SPXVN05NOTFOUND1', http: r1.http, state: r1.body?.status ?? r1.body?.code, text: r1.text });
      c.check('mã không có: HTTP 2xx trạng thái tìm lại (SEARCHING), màn báo "Chưa thấy đơn này"', r1.http < 300 && r1.text.some((t) => /Chưa thấy đơn này/.test(t)), outs[0]);
      for (let i = 2; i <= 5; i++) {
        const r = await api(L, 'POST', '/me/external-points/claims', { user: DT, body: { code: `SPXVN05NOTFOUND${i}` } });
        outs.push({ code: `SPXVN05NOTFOUND${i}`, http: r.status, state: r.body?.status ?? r.body?.code });
      }
      const r6 = await api(L, 'POST', '/me/external-points/claims', { user: DT, body: { code: 'SPXVN05UAT0001' } });
      outs.push({ code: 'SPXVN05UAT0001 (lần 6)', http: r6.status, state: r6.body?.code, message: r6.body?.message });
      c.ev('chuỗi gửi', outs);
      c.check('lần thứ 6 sau 5 mã không thấy: 429 LOCKED', r6.status === 429 && r6.body?.code === 'LOCKED', outs[5]);
      const att = await q(`SELECT outcome::text AS outcome, count(*)::int AS n FROM external_claim_attempts WHERE "userId" = $1 GROUP BY 1`, DT).catch(async () => q(`SELECT count(*)::int AS n FROM external_claim_attempts WHERE "userId" = $1`, DT));
      c.ev('external_claim_attempts', att);
    } catch (e) {
      c.error(e);
    }
    results.push(c.finish());
  }

  {
    const c = kase('U2-14', 'Đơn đã hoàn trên sàn (Lazada) → 400 CLOSED; mã vận đơn của đơn app → 409 APP_ORDER; đơn chat nhập mã → 409 CHAT_ORDER; khách chưa có SĐT → 403');
    try {
      const a = await submitOnMini(R, 'LZDUAT00000004', { shot: 'U2-14-returned' });
      c.ev('LZDUAT00000004', { http: a.http, body: a.body, alert: a.alert });
      c.check('đơn Lazada đã hoàn: 400 CLOSED', a.http === 400 && a.body?.code === 'CLOSED', { http: a.http, code: a.body?.code });
      const app = await prisma.order.findFirst({ where: { userId: R, shippingCode: { not: null } }, select: { code: true, shippingCode: true } });
      const b = await api(L, 'POST', '/me/external-points/claims', { user: R, body: { code: app.shippingCode } });
      c.ev('mã vận đơn đơn app', { order: app, status: b.status, code: b.body?.code });
      c.check('mã vận đơn đơn Mini App: 409 APP_ORDER', b.status === 409 && b.body?.code === 'APP_ORDER', { status: b.status, code: b.body?.code });
      const d = await api(L, 'POST', '/me/external-points/claims', { user: R, body: { code: 'GHTKUAT0000005' } });
      c.check('mã đơn chat CSKH: 409 CHAT_ORDER', d.status === 409 && d.body?.code === 'CHAT_ORDER', { status: d.status, code: d.body?.code });
      const np = await api(L, 'POST', '/me/external-points/claims', { user: 'uat_new_nophone', body: { code: 'SPXVN05UAT0002' } });
      c.check('khách chưa có SĐT gửi mã: 403 NOT_ELIGIBLE_USER', np.status === 403 && np.body?.code === 'NOT_ELIGIBLE_USER', { status: np.status, code: np.body?.code });
    } catch (e) {
      c.error(e);
    }
    results.push(c.finish());
  }

  {
    const c = kase('U2-15', 'Đơn TikTok đang giao: claim chờ giao; giao xong + 14 ngày → job cộng 2.670 điểm (1%, ×1), không tính hạng; sau đó đơn hoàn → thu hồi. Đơn Shopee hoàn khi claim còn chờ → huỷ claim, không ghi sổ');
    try {
      const t0 = await loyaltyOf(R);
      const b0 = await ledger(R);
      const r = await api(L, 'POST', '/me/external-points/claims', { user: R, body: { code: 'GHNUAT00000003' } });
      c.ev('gửi GHNUAT00000003', { status: r.status, body: r.body });
      c.check('đơn đang giao: CLAIMED 2.670 điểm, claim PENDING, chưa có ngày dự kiến', r.status === 201 && r.body?.status === 'CLAIMED' && r.body?.points === 2670 && !r.body?.expectedCreditAt && (await claimOf('GHNUAT00000003'))[0]?.state === 'PENDING', { status: r.body?.status, points: r.body?.points, expectedCreditAt: r.body?.expectedCreditAt });
      const dlv = await sendPlatform(L, 'GHNUAT00000003', 'delivered');
      c.ev('webhook giao', { http: dlv.http, event: dlv.event?.status, ext: dlv.externalOrder && { status: dlv.externalOrder.status, deliveredAt: dlv.externalOrder.deliveredAt } });
      const [cl] = await claimOf('GHNUAT00000003');
      c.check('sau webhook giao: releaseAt = giao + 14 ngày', cl.releaseAt && Math.abs(new Date(cl.releaseAt).getTime() - (new Date(cl.deliveredAt).getTime() + 14 * 86_400_000)) < 60_000, { releaseAt: cl.releaseAt, deliveredAt: cl.deliveredAt });
      runJob('external-claims.release');
      c.check('job release ngay sau giao: chưa cộng', (await claimOf('GHNUAT00000003'))[0].state === 'PENDING');
      await x(`UPDATE external_orders SET "deliveredAt" = "deliveredAt" - interval '15 days' WHERE "pancakeOrderId" = '7700003'`);
      await x(`UPDATE external_points_claims SET "releaseAt" = "releaseAt" - interval '15 days' WHERE id = $1`, cl.id);
      const job = runJob('external-claims.release');
      c.ev('job release sau lùi 15 ngày', job.result ?? job);
      const [cl2] = await claimOf('GHNUAT00000003');
      const rows = await q(`SELECT delta::int AS delta, reason, lot::text AS lot, "expiresAt" FROM points_transactions WHERE "userId" = $1 AND reason LIKE 'MARKETPLACE_ORDER%'`, R);
      const b1 = await ledger(R);
      const t1 = await loyaltyOf(R);
      c.ev('sau cộng', { claim: cl2.state, rows, balance: [b0.balance, b1.balance], tier: [t0.tier?.id, t1.tier?.id], spent12m: [t0.spent12m, t1.spent12m], tierPoints: [t0.tierPoints, t1.tierPoints] });
      c.check('claim CREDITED, 1 dòng MARKETPLACE_ORDER:7700003 +2.670 (lô STANDARD), số dư +2.670 = SUM sổ', cl2.state === 'CREDITED' && rows.length === 1 && rows[0].delta === 2670 && b1.balance === b0.balance + 2670 && b1.balance === b1.stdSum, { state: cl2.state, rows: rows.map((x2) => x2.delta), before: b0.balance, after: b1.balance, sum: b1.stdSum });
      c.check('không tính hạng: spent12m và tierPoints không đổi', t1.spent12m === t0.spent12m && t1.tierPoints === t0.tierPoints, { spent12m: [t0.spent12m, t1.spent12m], tierPoints: [t0.tierPoints, t1.tierPoints] });
      // Đơn hoàn sau khi đã cộng
      const ret = await sendPlatform(L, 'GHNUAT00000003', 'returned');
      c.ev('webhook hoàn sau cộng', { http: ret.http, event: ret.event?.status, ext: ret.externalOrder?.status });
      const [cl3] = await claimOf('GHNUAT00000003');
      const rows3 = await q(`SELECT delta::int AS delta, reason FROM points_transactions WHERE "userId" = $1 AND reason LIKE 'MARKETPLACE_ORDER%' ORDER BY "createdAt"`, R);
      const b2 = await ledger(R);
      c.check('đơn hoàn sau khi cộng: claim REVERSED, dòng −2.670, số dư về như trước = SUM sổ', cl3.state === 'REVERSED' && rows3.some((x2) => x2.delta === -2670 && x2.reason.startsWith('MARKETPLACE_ORDER_REVERSED')) && b2.balance === b0.balance && b2.balance === b2.stdSum, { state: cl3.state, rows: rows3, balance: b2.balance, sum: b2.stdSum });
      // Đơn hoàn khi claim còn chờ
      const ret1 = await sendPlatform(L, 'SPXVN05UAT0001', 'returned');
      const [cl4] = await claimOf('SPXVN05UAT0001');
      const rows4 = await q(`SELECT count(*)::int AS n FROM points_transactions WHERE "userId" = $1 AND reason LIKE 'MARKETPLACE_ORDER%:7700001'`, R);
      c.ev('Shopee hoàn khi claim còn chờ', { http: ret1.http, event: ret1.event?.status, claim: cl4.state, ledgerRows: rows4[0].n });
      c.check('claim chờ + đơn hoàn → VOIDED, không có dòng sổ', cl4.state === 'VOIDED' && rows4[0].n === 0, { state: cl4.state, rows: rows4[0].n });
      const shot = await (async () => {
        const s = await open(L.n, R, { headless, path: '/points/scan' });
        try {
          await sleep(2000);
          await s.page.screenshot({ path: path.join(SHOTS, 'U2-15-claims-list.png'), fullPage: true });
          return (await s.page.evaluate(() => document.body.innerText)).split('\n').filter((t) => /Đã cộng|Đã huỷ|Đã thu hồi|Chờ|Đang kiểm tra/.test(t));
        } finally {
          await s.close();
        }
      })();
      c.ev('danh sách đơn ngoài app trên Mini App', shot);
    } catch (e) {
      c.error(e);
    }
    results.push(c.finish());
  }

  {
    const c = kase('U2-15b', 'Trần điểm đơn sàn theo tháng (loyalty.marketplace_claim_monthly_points_cap): vượt trần → 429 MONTHLY_CAP, không tạo claim');
    try {
      const file = path.join(L.pancakeDir, 'platform-orders.json');
      const list = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!list.some((o) => o.id === 7700007)) {
        const tpl = list.find((o) => o.id === 7700002);
        list.push({ ...structuredClone(tpl), id: 7700007, bill_phone_number: '0901000022', shipping_address: { ...tpl.shipping_address, phone_number: '0901000022' }, partner: { extend_code: 'SPXVN05UAT0007' }, tracking_number: 'SPXVN05UAT0007', invoice_info_list: [{ order_sn: '2610UATSHOPEE07' }], items: [{ ...tpl.items[0], variation_info: { ...tpl.items[0].variation_info, retail_price: 500000 } }], total_price: 500000 });
        fs.writeFileSync(file, `${JSON.stringify(list, null, 2)}\n`);
      }
      await setConfig('loyalty.marketplace_claim_monthly_points_cap', 3000);
      // Mở khoá U2-13 cho khách Đại Thụ: xoá lần thử không thấy (dữ liệu lane)
      await x(`DELETE FROM external_claim_attempts WHERE "userId" = $1`, DT);
      const r = await api(L, 'POST', '/me/external-points/claims', { user: DT, body: { code: 'SPXVN05UAT0007' } });
      c.ev('gửi đơn 500.000đ (5.000 điểm) khi trần 3.000', { status: r.status, body: r.body });
      c.check('429 MONTHLY_CAP', r.status === 429 && r.body?.code === 'MONTHLY_CAP', { status: r.status, code: r.body?.code });
      c.check('không tạo claim', (await claimOf('SPXVN05UAT0007')).length === 0);
      await setConfig('loyalty.marketplace_claim_monthly_points_cap', 200000);
      const r2 = await api(L, 'POST', '/me/external-points/claims', { user: DT, body: { code: 'SPXVN05UAT0007' } });
      c.check('trả trần 200.000: gửi lại được (CLAIMED 5.000 điểm, không ×1,5 dù Đại Thụ)', r2.status === 201 && r2.body?.status === 'CLAIMED' && r2.body?.points === 5000, { status: r2.status, claim: r2.body?.status, points: r2.body?.points });
    } catch (e) {
      c.error(e);
    } finally {
      await setConfig('loyalty.marketplace_claim_monthly_points_cap', 200000).catch(() => undefined);
    }
    results.push(c.finish());
  }
});
