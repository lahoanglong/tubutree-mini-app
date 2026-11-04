// C15: thưởng doanh số quý của đại lý (tiền thật vào công nợ) + mốc thưởng tour/quà (duyệt tay). Chạy sau c9 và c14 (đụng công nợ uat_dealer).
// Luật: dealer.service.ts dealerVolume (doanh số = tiền hàng total - shippingFee của đơn ĐÃ CHỐT: PACKED/SHIPPING/DELIVERED + đã trả hoặc có dòng công nợ ORDER),
// bonusForRevenue (config dealer.quarterly_bonus_tiers), payoutQuarterlyBonuses (dòng QUARTER_BONUS delta âm, idempotent theo quý),
// clawbackQuarterBonusForOrder (dòng QUARTER_BONUS_ADJ delta dương = min(thưởng còn giữ, bậc(V) - bậc(V không có đơn))), claimReward / approveRewardClaim / markRewardClaimPaid.
// Cách chạy: node c15-dealer-bonus-rewards.mjs (từ gốc worktree uat-1104). Cuối script trả khoá cấu hình và tắt phần thưởng thử.
import { call, short, sql, exec, check, done, sleep, varId, ensureAddress, idk, webhook, runJob, notifs, vnd } from './common.mjs';

const T = (title, persona, step, expect) => ({ title, persona, size: 'API', journey: title, step, expect });
const D = 'uat_dealer';
const Q = { quarter: 'Q4/2026', start: '2026-09-30T17:00:00Z', end: '2026-12-31T17:00:00Z' };
const NOW = { $date: '2027-01-11T22:00:00Z' };
const TIERS = [{ min: 3_000_000, pct: 2 }, { min: 6_000_000, pct: 4 }];
const bonusFor = (rev) => {
  const hit = [...TIERS].sort((a, b) => b.min - a.min).find((t) => rev >= t.min);
  return hit ? Math.round((rev * hit.pct) / 100) : 0;
};
const debt = async () => (await sql(`SELECT COALESCE(SUM(delta),0)::int s FROM dealer_credit_ledgers WHERE "userId"=$1`, D))[0].s;
const settledRevenue = async () => (await sql(`
  SELECT COALESCE(SUM(o.total - o."shippingFee"),0)::int r FROM orders o
  WHERE o."userId"=$1 AND o.type::text='DEALER' AND o.status::text IN ('PACKED','SHIPPING','DELIVERED')
    AND o."createdAt" >= $2::timestamptz AND o."createdAt" < $3::timestamptz AND o."paymentStatus"::text NOT IN ('REFUNDED','FAILED')
    AND (o."paymentStatus"::text='PAID' OR EXISTS (SELECT 1 FROM dealer_credit_ledgers l WHERE l."userId"=o."userId" AND l."refType"='ORDER' AND l."refId"=o.id))`, D, Q.start, Q.end))[0].r;
const bonusRows = () => sql(`SELECT delta::int d, "refType" t, "refId" r FROM dealer_credit_ledgers WHERE "userId"=$1 AND "refType" LIKE 'QUARTER_BONUS%' ORDER BY "createdAt", id`, D);
const orderState = async (id) => (await sql(`SELECT code, status::text s, "paymentStatus"::text ps, total::int t, "shippingFee"::int ship, "pancakePushStatus"::text push FROM orders WHERE id=$1`, id))[0];

const cfgRow = (await sql(`SELECT value FROM system_configs WHERE key='dealer.quarterly_bonus_tiers'`))[0];
const addressId = await ensureAddress('dealer');
const vid = await varId('SOK-CT-150');
const out = {};

try {
  // ---------- chuẩn bị: bậc thưởng thử, hai phần thưởng, hai đơn công nợ ----------
  const setCfg = await call('admin', 'PUT', '/admin/config', { key: 'dealer.quarterly_bonus_tiers', value: TIERS });
  await sleep(6500);
  await exec(`DELETE FROM dealer_quarter_bonus_tiers WHERE quarter=$1`, Q.quarter);
  await exec(`DELETE FROM dealer_reward_claims WHERE "rewardId" LIKE 'uatrw%'`);
  await exec(`DELETE FROM dealer_rewards WHERE id LIKE 'uatrw%'`);
  for (const [id, title, threshold, active] of [['uatrw1', 'Quà UAT mốc 5 triệu', 5_000_000, true], ['uatrw2', 'Tour UAT mốc 3 triệu', 3_000_000, true], ['uatrw0', 'Quà UAT đã ngừng', 1, false]]) {
    await exec(`INSERT INTO dealer_rewards (id, type, title, description, threshold, period, "isActive", "sortOrder", "updatedAt") VALUES ($1, 'GIFT'::"DealerRewardType", $2, 'UAT', $3, 'QUARTER', $4, 0, now())`, id, title, threshold, active);
  }
  const debt0 = await debt();
  const rev0 = await settledRevenue();
  const place = () => call('dealer', 'POST', '/dealer/orders', { items: [{ variationId: vid, quantity: 45 }], paymentMethod: 'CREDIT', addressId }, { 'idempotency-key': idk('l6w') });
  const X = await place();
  const Y = await place();
  out.setup = { cfg: setCfg.status, debt0, rev0, X: X.status, Y: Y.status, xId: X.body?.id, yId: Y.body?.id };
  if (!X.ok || !Y.ok) {
    check('L6-W00', T('Dựng dữ liệu thưởng quý: hai đơn công nợ 45×SOK-CT-150', 'dealer', 'POST /dealer/orders paymentMethod=CREDIT ×2', '201 cả hai'), false, short(out.setup, 400), 'API', 'BLOCKED');
    throw new Error(`không dựng được đơn: ${short(out.setup)}`);
  }
  const xs = await orderState(X.body.id);
  const ys = await orderState(Y.body.id);
  const lineRev = xs.t - xs.ship;
  const settle = async (o) => {
    const s = await orderState(o.id ?? o);
    let how = 'webhook shipped';
    try { webhook(s.code, 'shipped'); } catch (e) {
      how = `admin PACKED (webhook lỗi: ${String(e.message).slice(0, 60)})`;
      await call('admin', 'PUT', `/admin/orders/${o.id ?? o}/status`, { status: 'PACKED', note: 'UAT' });
    }
    return { how, st: await orderState(o.id ?? o) };
  };

  // ---------- W01 sổ công nợ ghi đủ hai đơn ----------
  const ledgerOrders = await sql(`SELECT "refId" r, delta::int d FROM dealer_credit_ledgers WHERE "userId"=$1 AND "refType"='ORDER' AND "refId" IN ($2,$3)`, D, X.body.id, Y.body.id);
  check('L6-W01', T('Đơn mua chịu 45×SOK-CT-150 (hai đơn): sổ công nợ +tổng đơn mỗi đơn, công nợ tăng đúng', 'dealer', 'POST /dealer/orders CREDIT ×2', `mỗi đơn: ORDER delta = +tổng (${vnd(xs.t)}); công nợ = ${vnd(debt0)} + ${vnd(xs.t + ys.t)}`),
    ledgerOrders.length === 2 && ledgerOrders.every((l) => l.d === xs.t) && xs.t === ys.t && (await debt()) === debt0 + xs.t + ys.t, `ORDER=${short(ledgerOrders)}; công nợ ${debt0} → ${await debt()}; tổng đơn=${xs.t} ship=${xs.ship}`, 'SQL dealer_credit_ledgers');

  // ---------- chốt X, thử nhận thưởng khi doanh số chưa đủ ----------
  const sx = await settle(X.body.id);
  const claimEarly = await call('dealer', 'POST', '/dealer/rewards/uatrw1/claim', {});
  const revX = await settledRevenue();
  check('L6-W02', T('Nhận thưởng mốc 5 triệu khi doanh số đã chốt mới 3,1 triệu (đơn Y chưa đóng gói): bị từ chối, không tạo yêu cầu', 'dealer', 'POST /dealer/rewards/uatrw1/claim', `400 nêu doanh số đã chốt ${vnd(lineRev)} < mốc ${vnd(5_000_000)} và phần chưa chốt; dealer_reward_claims không đổi`),
    sx.st.s === 'SHIPPING' && revX === rev0 + lineRev && claimEarly.status === 400 && /chưa đạt mốc/.test(claimEarly.body?.message ?? '') && (await sql(`SELECT count(*)::int c FROM dealer_reward_claims WHERE "userId"=$1`, D))[0].c === 0,
    `${sx.how}; X=${sx.st.s}; doanh số SQL=${revX}; ${claimEarly.status} ${short(claimEarly.body?.message, 260)}`, 'SQL orders + dealer_reward_claims');

  // ---------- chốt Y: báo cáo quý khớp SQL và bậc thưởng ----------
  const sy = await settle(Y.body.id);
  const revXY = await settledRevenue();
  const rep = await call('dealer', 'GET', '/dealer/quarterly-report');
  const wantPct = TIERS.slice().reverse().find((t) => revXY >= t.min)?.pct ?? 0;
  check('L6-W03', T('Báo cáo quý đại lý: doanh số đã chốt, % thưởng và tiền thưởng khớp SQL và bảng bậc', 'dealer', 'GET /dealer/quarterly-report sau khi cả hai đơn lên SHIPPING', `revenue = Σ(total - ship) đơn đã chốt = ${vnd(rev0 + 2 * lineRev)}; bonusPct ${wantPct}%; bonusAmount ${vnd(bonusFor(rev0 + 2 * lineRev))}`),
    sy.st.s === 'SHIPPING' && revXY === rev0 + 2 * lineRev && rep.body?.revenue === revXY && rep.body?.bonusPct === wantPct && rep.body?.bonusAmount === bonusFor(revXY) && rep.body?.quarter === Q.quarter,
    `${sy.how}; SQL=${revXY}; API=${short({ q: rep.body?.quarter, rev: rep.body?.revenue, pct: rep.body?.bonusPct, amt: rep.body?.bonusAmount, orders: rep.body?.orderCount, pending: rep.body?.pendingRevenue })}`, 'API + SQL');

  // ---------- nhận thưởng khi đủ mốc, gửi lại ----------
  const prog = await call('dealer', 'GET', '/dealer/rewards');
  const claim1 = await call('dealer', 'POST', '/dealer/rewards/uatrw1/claim', { note: 'UAT' });
  const claim1b = await call('dealer', 'POST', '/dealer/rewards/uatrw1/claim', {});
  const gone = await call('dealer', 'POST', '/dealer/rewards/uatrw0/claim', {});
  const nClaims = (await sql(`SELECT count(*)::int c, max("volumeAtClaim")::int v FROM dealer_reward_claims WHERE "userId"=$1 AND "rewardId"='uatrw1'`, D))[0];
  check('L6-W04', T('Nhận thưởng mốc 5 triệu khi doanh số chốt đạt: tạo đúng một yêu cầu PENDING; gửi lại không tạo trùng; phần thưởng đã ngừng không nhận được', 'dealer', 'POST /dealer/rewards/uatrw1/claim ×2; uatrw0/claim', `lần đầu success alreadyClaimed=false PENDING volumeAtClaim=${revXY}; lần hai alreadyClaimed=true; 1 dòng SQL; phần thưởng ngừng → 404`),
    claim1.status === 201 && claim1.body?.alreadyClaimed === false && claim1.body?.claimStatus === 'PENDING' && claim1b.body?.alreadyClaimed === true && nClaims.c === 1 && nClaims.v === revXY && gone.status === 404 && JSON.stringify(prog.body).includes('uatrw1'),
    `tiến trình ${prog.status}; lần1=${claim1.status} ${short({ a: claim1.body?.alreadyClaimed, s: claim1.body?.claimStatus }, 80)}; lần2=${claim1b.status} ${short({ a: claim1b.body?.alreadyClaimed }, 60)}; SQL=${short(nClaims)}; ngừng=${gone.status} ${short(gone.body?.message, 100)}`, 'API + SQL dealer_reward_claims');
  const claimId = claim1.body?.claim?.id;

  // ---------- trả thưởng quý (cron ngày 10) ----------
  // dealer.service.ts settledVisibleBy: đơn chốt trong 60 giây gần nhất chưa được cron thấy (SETTLE_VISIBILITY_MARGIN_MS), nên chờ quá mốc đó.
  await sleep(66_000);
  const dBefore = await debt();
  const pay1 = runJob('DealerService.payoutQuarterlyBonuses', [NOW]);
  const rowsA = await bonusRows();
  const pay2 = runJob('DealerService.payoutQuarterlyBonuses', [NOW]);
  const rowsB = await bonusRows();
  const want = bonusFor(revXY);
  const notif = await notifs(D, 'DEALER_BONUS_PAID');
  check('L6-W05', T('Cron trả thưởng quý: ghi một dòng QUARTER_BONUS delta âm đúng số tiền; chạy lại không trả trùng; đại lý nhận thông báo', 'dealer', 'DealerService.payoutQuarterlyBonuses (now = 12/01/2027) ×2', `dòng QUARTER_BONUS refId ${Q.quarter} delta -${want}; công nợ ${vnd(dBefore)} → ${vnd(dBefore - want)}; lần hai không thêm dòng; có DEALER_BONUS_PAID`),
    rowsA.filter((r) => r.t === 'QUARTER_BONUS').length === 1 && rowsA.find((r) => r.t === 'QUARTER_BONUS')?.d === -want && rowsA.find((r) => r.t === 'QUARTER_BONUS')?.r === Q.quarter && (await debt()) === dBefore - want && rowsB.length === rowsA.length && notif.length >= 1,
    `lần1=${short(pay1, 120)}; lần2=${short(pay2, 120)}; dòng=${short(rowsB)}; công nợ ${dBefore}→${await debt()}; thông báo=${notif.length}`, 'SQL dealer_credit_ledgers + notification_logs');

  // ---------- huỷ đơn Y sau khi đã trả thưởng: thu hồi phần biên ----------
  const cancel = await call('admin', 'PUT', `/admin/orders/${Y.body.id}/status`, { status: 'CANCELLED', note: 'UAT thu hồi thưởng' });
  let ys2 = await orderState(Y.body.id);
  let how = 'admin CANCELLED';
  if (ys2.s !== 'CANCELLED') {
    how = `admin CANCELLED bị từ chối (${cancel.status} ${short(cancel.body?.message, 100)}), dùng webhook returned`;
    try { webhook(ys.code, 'returned'); } catch (e) { how += ` lỗi ${String(e.message).slice(0, 80)}`; }
    ys2 = await orderState(Y.body.id);
  }
  const rows2 = await bonusRows();
  const adj = rows2.filter((r) => r.t === 'QUARTER_BONUS_ADJ');
  const wantAdj = Math.min(want, bonusFor(revXY) - bonusFor(revXY - lineRev));
  const cancelRows = await sql(`SELECT delta::int d, "refType" t FROM dealer_credit_ledgers WHERE "userId"=$1 AND "refId"=$2 AND "refType" <> 'ORDER'`, D, Y.body.id);
  const debtAfter = await debt();
  const wantDebt = debt0 + xs.t - bonusFor(revXY - lineRev);
  check('L6-W06', T('Huỷ/trả một đơn đã tính thưởng: thu hồi đúng phần biên của đơn đó (bậc 4% về 2%), hoàn công nợ đơn; công nợ chỉ còn nợ đơn X trừ thưởng của X', 'dealer', 'admin huỷ đơn Y (hoặc webhook returned) sau khi trả thưởng quý', `ADJ delta +${wantAdj} (= ${bonusFor(revXY)} - ${bonusFor(revXY - lineRev)}); công nợ = nợ đầu + tổng X - thưởng của X = ${wantDebt}`),
    ['CANCELLED', 'RETURNED'].includes(ys2.s) && adj.length === 1 && adj[0].d === wantAdj && adj[0].r === `${Q.quarter}:${Y.body.id}` && debtAfter === wantDebt,
    `${how}; Y=${ys2.s}; ADJ=${short(adj)}; dòng hoàn đơn=${short(cancelRows)}; công nợ ${debtAfter} (kỳ vọng ${wantDebt})`, 'SQL dealer_credit_ledgers');

  // ---------- lặp lại huỷ: không thu hồi lần hai ----------
  const cancel2 = await call('admin', 'PUT', `/admin/orders/${Y.body.id}/status`, { status: 'CANCELLED', note: 'UAT lặp' });
  const rows3 = await bonusRows();
  check('L6-W07', T('Lệnh huỷ lặp lại cùng đơn: không thu hồi thưởng lần hai, công nợ không đổi', 'dealer', 'admin huỷ đơn Y lần hai', 'không thêm dòng ADJ; công nợ như trước'), rows3.filter((r) => r.t === 'QUARTER_BONUS_ADJ').length === 1 && (await debt()) === debtAfter, `huỷ lần hai=${cancel2.status} ${short(cancel2.body?.message, 100)}; ADJ=${rows3.filter((r) => r.t === 'QUARTER_BONUS_ADJ').length}; công nợ=${await debt()}`, 'SQL');

  // ---------- duyệt yêu cầu thưởng khi doanh số đã tụt dưới mốc ----------
  const appr = await call('admin', 'POST', `/admin/dealer-reward-claims/${claimId}/approve`, { note: 'UAT' });
  const stillPending = (await sql(`SELECT status::text s FROM dealer_reward_claims WHERE id=$1`, claimId))[0]?.s;
  check('L6-W08', T('Duyệt yêu cầu nhận thưởng sau khi đơn bị huỷ làm doanh số chốt tụt dưới mốc: bị chặn, yêu cầu vẫn PENDING', 'admin', 'POST /admin/dealer-reward-claims/:id/approve', `400 "Doanh số đã chốt ... hiện chỉ còn ${vnd(revXY - lineRev)} (mốc 5.000.000đ ...)"; trạng thái PENDING`),
    appr.status === 400 && /hiện chỉ còn/.test(appr.body?.message ?? '') && stillPending === 'PENDING', `${appr.status} ${short(appr.body?.message, 260)}; trạng thái=${stillPending}`, 'SQL dealer_reward_claims');
  const rej0 = await call('admin', 'POST', `/admin/dealer-reward-claims/${claimId}/reject`, { reason: '  ' });
  const rej = await call('admin', 'POST', `/admin/dealer-reward-claims/${claimId}/reject`, { reason: 'Doanh số tụt dưới mốc sau khi huỷ đơn' });
  const reopen = await call('admin', 'POST', `/admin/dealer-reward-claims/${claimId}/reopen`, { note: 'UAT mở lại' });
  const st2 = (await sql(`SELECT status::text s, "rejectionReason" r FROM dealer_reward_claims WHERE id=$1`, claimId))[0];
  check('L6-W09', T('Từ chối cần lý do (lý do trống bị chặn); mở lại yêu cầu bị từ chối về PENDING và xoá lý do', 'admin', 'POST reject (lý do trống, rồi có lý do), reopen', 'reject trống 400 "Nhập lý do từ chối."; reject có lý do → REJECTED; reopen → PENDING, rejectionReason null'),
    rej0.status === 400 && /Nhập lý do/.test(rej0.body?.message ?? '') && rej.ok && reopen.ok && st2.s === 'PENDING' && st2.r === null, `trống=${rej0.status} ${short(rej0.body?.message, 80)}; reject=${rej.status}; reopen=${reopen.status}; cuối=${short(st2)}`, 'SQL dealer_reward_claims');

  // ---------- mốc 3 triệu: duyệt và chi (người duyệt khác người chi) ----------
  const c2 = await call('dealer', 'POST', '/dealer/rewards/uatrw2/claim', {});
  const c2id = c2.body?.claim?.id;
  const early = await call('ketoan', 'POST', `/admin/dealer-reward-claims/${c2id}/mark-paid`, { note: 'UAT' });
  const kApprove = await call('ketoan', 'POST', `/admin/dealer-reward-claims/${c2id}/approve`, { note: 'UAT' });
  const aOk = await call('admin', 'POST', `/admin/dealer-reward-claims/${c2id}/approve`, { note: 'UAT' });
  const kPay = await call('ketoan', 'POST', `/admin/dealer-reward-claims/${c2id}/mark-paid`, { note: 'UAT chi' });
  const kPay2 = await call('ketoan', 'POST', `/admin/dealer-reward-claims/${c2id}/mark-paid`, { note: 'UAT chi lần hai' });
  const fin = (await sql(`SELECT status::text s, "paidBy" pb, "reviewedBy" rb FROM dealer_reward_claims WHERE id=$1`, c2id))[0];
  const dNotif = await notifs(D, 'DEALER_REWARD_CLAIM_%');
  check('L6-W10', T('Thưởng mốc 3 triệu: dealer nhận khi doanh số còn 3,1 triệu; kế toán không duyệt và không chi trước khi duyệt; admin duyệt, kế toán chi một lần; đại lý nhận thông báo', 'dealer + admin + ketoan', 'claim uatrw2; ketoan mark-paid/approve; admin approve; ketoan mark-paid ×2', 'claim 201 PENDING; ketoan mark-paid khi chưa duyệt → 400; ketoan approve → 403; admin approve → APPROVED; ketoan mark-paid → PAID; lần hai → 400'),
    c2.status === 201 && c2.body?.claimStatus === 'PENDING' && early.status === 400 && kApprove.status === 403 && aOk.ok && kPay.ok && kPay2.status === 400 && fin.s === 'PAID' && fin.pb !== fin.rb && dNotif.length >= 1,
    `claim=${c2.status}; chi sớm=${early.status} ${short(early.body?.message, 80)}; ketoan duyệt=${kApprove.status}; admin duyệt=${aOk.status}; chi=${kPay.status}; chi lần hai=${kPay2.status} ${short(kPay2.body?.message, 80)}; SQL=${short(fin)}; thông báo đại lý=${dNotif.length}`, 'SQL dealer_reward_claims + notification_logs');
} finally {
  if (cfgRow) await call('admin', 'PUT', '/admin/config', { key: 'dealer.quarterly_bonus_tiers', value: cfgRow.value }).catch(() => undefined);
  else await exec(`DELETE FROM system_configs WHERE key='dealer.quarterly_bonus_tiers'`).catch(() => undefined);
  await exec(`UPDATE dealer_rewards SET "isActive"=false WHERE id LIKE 'uatrw%'`).catch(() => undefined);
}
await done();
