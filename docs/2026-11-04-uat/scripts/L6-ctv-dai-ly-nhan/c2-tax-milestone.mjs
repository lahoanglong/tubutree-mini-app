// C2: thuế TNCN khấu trừ, tin cần MST, thưởng mốc tháng, thu hồi mốc khi đơn trả/huỷ (cột revokedAt/revokeDebt/revokeTaken), bậc CTV.
// Chạy sau c1-money.mjs trên cùng lane: node c2-tax-milestone.mjs (từ gốc worktree uat-1104).
// Luật: affiliate.pit_withhold_pct=0.1, affiliate.pit_withhold_threshold=5.000.000đ (cộng dồn tháng VN, affiliate.service.ts personalIncomeTax),
// mốc 3/10/30/80 triệu = 50.000/200.000/600.000/2.000.000 Điểm Xanh (ctv-milestones.ts), thu hồi theo ctv-milestone-revoke.ts.
import { call, short, sql, exec, buy, orderRow, commissionOf, notifs, check, done, webhook, runJob, idk, sleep, varId } from './common.mjs';

const T = (title, persona, step, expect) => ({ title, persona, size: 'API', journey: title, step, expect });
const CTV = 'uat_ctv';
const deliver = (code) => { webhook(code, 'shipped'); webhook(code, 'delivered'); };
async function approveAll(codes) {
  for (const code of codes) await exec(`UPDATE commissions SET "lockedAt" = now() - interval '11 days' WHERE "orderId" = (SELECT id FROM orders WHERE code=$1) AND status='LOCKED'`, code);
  runJob('AffiliateService.approveDueCommissions');
}
const wallet = async (uid) => {
  const [u] = await sql(`SELECT "walletBalance"::int w, "pointsBalance"::int p FROM users WHERE id=$1`, uid);
  const [l] = await sql(`SELECT COALESCE(SUM(delta),0)::int s FROM wallet_transactions WHERE "userId"=$1`, uid);
  const [p] = await sql(`SELECT COALESCE(SUM(delta),0)::int s FROM points_transactions WHERE "userId"=$1 AND lot='STANDARD'`, uid);
  return { balance: u.w, ledger: l.s, points: u.p, pointsLedger: p.s };
};
const monthRev = async (uid) => (await sql(`SELECT COALESCE(SUM("commissionableTotal"),0)::int s FROM commissions WHERE "affiliateUserId"=$1 AND status IN ('APPROVED','PAID') AND "approvedAt" >= TIMESTAMPTZ '2026-10-31 17:00:00+00' AND "approvedAt" < TIMESTAMPTZ '2026-11-30 17:00:00+00'`, uid))[0].s;

let codes = [];
let rev1 = 0;
// RESUME=1: chạy tiếp từ phần bậc CTV (g) sau khi phần a–f đã chạy xong, lấy lại đơn và doanh số từ SQL.
if (process.env.RESUME) {
  codes = (await sql(`SELECT o.code FROM orders o JOIN order_items oi ON oi."orderId"=o.id JOIN variations v ON v.id=oi."variationId" WHERE v.sku='VIS-SR-50' ORDER BY o."createdAt" DESC LIMIT 3`)).map((r) => r.code).reverse();
  rev1 = await monthRev(CTV);
} else {
// ---------- a. % hoa hồng riêng của biến thể (admin) ----------
const vSR = await varId('VIS-SR-50');
{
  const bad1 = await call('admin', 'PUT', `/admin/commission-rates/variations/${vSR}`, { rate: 51 });
  const bad2 = await call('admin', 'PUT', `/admin/commission-rates/variations/${vSR}`, { rate: 7.5 });
  const forbidden = await call('ctv', 'PUT', `/admin/commission-rates/variations/${vSR}`, { rate: 50 });
  const ok = await call('admin', 'PUT', `/admin/commission-rates/variations/${vSR}`, { rate: 50 });
  check('L6-D01', T('Admin đặt % hoa hồng riêng cho biến thể: chặn quá trần/số lẻ, CTV không đặt được', 'admin', 'PUT /admin/commission-rates/variations/:id', 'rate 51 → 400 (trần affiliate.max_rate_pct=50); 7.5 → 400 không phải số nguyên; CTV gọi → 403; rate 50 → 200'),
    bad1.status === 400 && bad2.status === 400 && forbidden.status === 403 && ok.status === 200, `51→${bad1.status} ${short(bad1.body, 160)} | 7.5→${bad2.status} ${short(bad2.body, 160)} | CTV→${forbidden.status} | 50→${ok.status}`, 'API');
}

// ---------- b. ba đơn lớn qua mã CTV ----------
codes = [];
for (let i = 0; i < 3; i++) {
  const b = await buy('new', [['VIS-SR-50', 10]], { paymentMethod: 'COD', referralCode: 'UATCTV' });
  if (!b.ok) { check(`L6-D02-${i}`, T('Đặt đơn lớn 4.600.000đ qua mã CTV', 'new', 'place-order', 'đơn 201'), false, `status=${b.status} ${short(b.body, 300)}`, 'API'); continue; }
  codes.push(b.code);
}
{
  const rows = await Promise.all(codes.map(commissionOf));
  const ok = rows.every((r) => r.length === 1 && r[0].amount === 2_300_000 && r[0].base === 4_600_000 && r[0].rate === 50 && r[0].status === 'PENDING');
  check('L6-D02', T('Hoa hồng theo % riêng của biến thể (50%) thay mức mặc định 8%', 'new', 'place-order 10×VIS-SR-50 (4.600.000đ) ×3 qua mã UATCTV', 'mỗi đơn hoa hồng floor(4.600.000 × 50%) = 2.300.000đ, nền 4.600.000đ'), ok && codes.length === 3, `đơn=${codes.join(',')}; ${rows.map((r) => `${r[0]?.amount}/${r[0]?.base}/${r[0]?.rate}%`).join(' ; ')}`, 'SQL commissions');
}
codes.forEach(deliver);
const before = await wallet(CTV);
const [pit0] = await sql(`SELECT COALESCE(SUM("grossAmount"),0)::int g, COALESCE(SUM("taxWithheld"),0)::int t, COALESCE(SUM("taxRefunded"),0)::int r FROM payouts WHERE "userId"=$1 AND "grossAmount" IS NOT NULL AND status <> 'REJECTED' AND "requestedAt" >= TIMESTAMPTZ '2026-10-31 17:00:00+00' AND "requestedAt" < TIMESTAMPTZ '2026-11-30 17:00:00+00'`, CTV);
await approveAll(codes);
const approvedSum = (await sql(`SELECT COALESCE(SUM(amount),0)::int s, count(*)::int c FROM commissions WHERE "affiliateUserId"=$1 AND status='APPROVED' AND "payoutBatchId" IS NULL`, CTV))[0];
const expTax = Math.min(Math.max(Math.round((pit0.g + approvedSum.s) * 0.1) - (pit0.t - pit0.r), 0), approvedSum.s);
const dash = (await call('ctv', 'GET', '/affiliate/dashboard')).body;
check('L6-D03', T('Hoa hồng đã chốt: bảng điều khiển cộng đúng, xem trước thuế', 'ctv', 'GET /affiliate/dashboard sau khi duyệt', `withdrawableCommission = Σ APPROVED (${approvedSum.s}); withdrawTaxPreview = round(10% × tổng tháng) − thuế đã giữ = ${expTax}`),
  dash.withdrawableCommission === approvedSum.s && dash.withdrawTaxPreview === expTax && dash.withdrawTaxPreview > 0, `dashboard=${short(dash, 500)}; payout tháng trước đó gross=${pit0.g} tax=${pit0.t}`, 'API + SQL');

// ---------- d. tự chuyển bị chặn vì thiếu MST, có tin ----------
const nTaxBefore = (await notifs(CTV, 'COMMISSION_TAX_ID_NEEDED')).length;
const payoutsBefore = (await sql(`SELECT count(*)::int c FROM payouts WHERE "userId"=$1`, CTV))[0].c;
runJob('AffiliateService.autoTransferApprovedToWallet');
runJob('AffiliateService.autoTransferApprovedToWallet');
await sleep(600);
const afterBlock = await wallet(CTV);
const stillApproved = (await sql(`SELECT count(*)::int c FROM commissions WHERE "affiliateUserId"=$1 AND status='APPROVED' AND "payoutBatchId" IS NULL`, CTV))[0].c;
const payoutsAfter = (await sql(`SELECT count(*)::int c FROM payouts WHERE "userId"=$1`, CTV))[0].c;
const nTax = await notifs(CTV, 'COMMISSION_TAX_ID_NEEDED');
const lastTax = nTax.at(-1);
check('L6-D04', T('Tự chuyển vào Ví bị chặn khi thuế TNCN cần MST mà chưa có: tiền không đi, có tin COMMISSION_TAX_ID_NEEDED một lần/tháng', 'ctv', 'autoTransferApprovedToWallet ×2 (thiếu personalTaxId)', `commission còn APPROVED, không payout mới, Ví không đổi; đúng 1 tin mới (dedupeKey theo tháng) nêu ${approvedSum.s.toLocaleString('vi-VN')}đ và tháng 11/2026`),
  stillApproved === approvedSum.c && payoutsAfter === payoutsBefore && afterBlock.balance === before.balance && nTax.length === nTaxBefore + 1 && JSON.stringify(lastTax?.payload).includes(approvedSum.s.toLocaleString('vi-VN')) && JSON.stringify(lastTax?.payload).includes('11/2026'),
  `còn APPROVED=${stillApproved}/${approvedSum.c}; payout ${payoutsBefore}→${payoutsAfter}; Ví ${before.balance}→${afterBlock.balance}; tin mới=${nTax.length - nTaxBefore}: ${short(lastTax?.payload, 420)}`, 'SQL');
check('L6-D05', T('Giọng chữ tin cần MST', 'ctv', 'đọc nội dung COMMISSION_TAX_ID_NEEDED', 'không "Vui lòng", "chúng tôi", "..."; chỉ đường mở mục Hoa hồng'), !/Vui lòng|chúng tôi|\.\.\./i.test(JSON.stringify(lastTax?.payload)), short(lastTax?.payload?.body, 400), 'SQL');

// ---------- e. CTV tự bấm chuyển: MST sai/thiếu/đúng ----------
{
  const avail = approvedSum.s;
  const none = await call('ctv', 'POST', '/affiliate/payouts', { amount: avail, method: 'WALLET_BALANCE' }, { 'idempotency-key': idk() });
  const bad = await call('ctv', 'POST', '/affiliate/payouts', { amount: avail, method: 'WALLET_BALANCE', taxId: '123' }, { 'idempotency-key': idk() });
  check('L6-D06', T('Chuyển Ví khi bị khấu trừ thuế: thiếu MST → báo mã PIT_TAX_ID_REQUIRED; MST sai dạng → báo định dạng', 'ctv', 'POST /affiliate/payouts không taxId; taxId=123', 'thiếu: 400 code PIT_TAX_ID_REQUIRED; sai: 400 "Mã số thuế cá nhân gồm 10 chữ số, hoặc số CCCD 12 chữ số."'),
    none.status === 400 && none.body.code === 'PIT_TAX_ID_REQUIRED' && bad.status === 400 && /10 chữ số, hoặc số CCCD 12 chữ số/.test(JSON.stringify(bad.body)), `thiếu=${none.status} ${short(none.body, 260)} | sai=${bad.status} ${short(bad.body, 200)}`, 'API');
  const w0 = await wallet(CTV);
  const key = idk('l6tax');
  const ok = await call('ctv', 'POST', '/affiliate/payouts', { amount: avail, method: 'WALLET_BALANCE', taxId: '0312345678' }, { 'idempotency-key': key });
  const w1 = await wallet(CTV);
  const [p] = await sql(`SELECT id, amount, "grossAmount" g, "taxWithheld" tax, "taxId", status FROM payouts WHERE "idempotencyKey"=$1`, key);
  const [u] = await sql(`SELECT "personalTaxId" t FROM users WHERE id=$1`, CTV);
  const [wt] = await sql(`SELECT delta, type, reason FROM wallet_transactions WHERE "userId"=$1 ORDER BY "createdAt" DESC LIMIT 1`, CTV);
  check('L6-D07', T('Chuyển Ví kèm MST: khấu trừ TNCN đúng công thức, Ví cộng phần thực nhận', 'ctv', 'POST /affiliate/payouts taxId=0312345678', `gross ${avail}; thuế = ${expTax}; Ví + ${avail - expTax}; payout lưu gross/tax/MST; hồ sơ lưu MST; sổ ví = số dư`),
    ok.status === 201 && p?.g === avail && p?.tax === expTax && p?.amount === avail - expTax && p?.taxId === '0312345678' && u.t === '0312345678' && w1.balance === w0.balance + avail - expTax && w1.balance === w1.ledger && wt?.delta === avail - expTax,
    `resp=${short(ok.body, 220)}; payout=${short(p)}; users.personalTaxId=${u.t}; Ví ${w0.balance}→${w1.balance} (Σsổ ${w1.ledger}); dòng sổ=${short(wt)}`, 'SQL');
  check('L6-D08', T('Lý do dòng sổ Ví nêu thuế đã khấu trừ', 'ctv', 'đọc wallet_transactions.reason', 'reason nhắc "đã khấu trừ thuế TNCN"'), /đã khấu trừ thuế TNCN/.test(wt?.reason ?? ''), wt?.reason ?? '', 'SQL');
  const stmt = await call('ctv', 'GET', '/affiliate/tax-statement?year=2026');
  const [agg] = await sql(`SELECT COALESCE(SUM("grossAmount"),0)::int g, COALESCE(SUM("taxWithheld"),0)::int t FROM payouts WHERE "userId"=$1 AND "grossAmount" IS NOT NULL AND status='PAID'`, CTV);
  check('L6-D09', T('Bảng kê thuế TNCN trong năm khớp sổ payout', 'ctv', 'GET /affiliate/tax-statement?year=2026', 'tổng thu nhập và thuế khớp Σ payout PAID'), stmt.status === 200 && JSON.stringify(stmt.body).includes(String(agg.g)) && JSON.stringify(stmt.body).includes(String(agg.t)), `statement=${short(stmt.body, 500)}; SQL gross=${agg.g} tax=${agg.t}`, 'API + SQL');
  const pit = await call('admin', 'GET', '/admin/payouts/pit-report?month=2026-11');
  check('L6-D10', T('Báo cáo thuế TNCN tháng cho kế toán có CTV này', 'admin', 'GET /admin/payouts/pit-report?month=2026-11', 'có dòng CTV uat_ctv với tổng thu nhập và thuế khớp SQL'), pit.status === 200 && JSON.stringify(pit.body).includes(CTV) && JSON.stringify(pit.body).includes(String(agg.t)), `status=${pit.status} ${short(pit.body, 420)}`, 'API');
  const none2 = await call('ctv', 'GET', '/admin/payouts/pit-report?month=2026-11');
  check('L6-D11', T('CTV không xem được báo cáo thuế của kế toán', 'ctv', 'GET /admin/payouts/pit-report', '403'), none2.status === 403, `status=${none2.status}`, 'API');
}

// ---------- f. thưởng mốc tháng ----------
rev1 = await monthRev(CTV);
{
  const m = await call('ctv', 'GET', '/affiliate/milestones');
  const ms = m.body?.milestones ?? [];
  const can = Object.fromEntries(ms.map((x) => [x.id, x.canClaim]));
  const expected = { 'milestone-3m': rev1 >= 3_000_000, 'milestone-10m': rev1 >= 10_000_000, 'milestone-30m': rev1 >= 30_000_000, 'milestone-80m': rev1 >= 80_000_000 };
  check('L6-D12', T('Bảng mốc thưởng tháng: doanh số đã chốt và trạng thái từng mốc', 'ctv', 'GET /affiliate/milestones', `doanh số tháng 11/2026 = ${rev1} (Σ commissionableTotal APPROVED/PAID); canClaim theo ngưỡng 3/10/30/80 triệu`),
    m.body?.monthKey === '2026-11' && m.body?.currentRevenue === rev1 && JSON.stringify(can) === JSON.stringify(expected) && ms.map((x) => x.rewardPoints).join() === '50000,200000,600000,2000000', `currentRevenue=${m.body?.currentRevenue}; canClaim=${JSON.stringify(can)}; thưởng=${ms.map((x) => x.rewardPoints)}`, 'API + SQL');
  const early = await call('ctv', 'POST', '/affiliate/milestones/milestone-30m/claim', {});
  check('L6-D13', T('Nhận mốc chưa đạt bị từ chối', 'ctv', 'POST /affiliate/milestones/milestone-30m/claim', '400 "Doanh số đã chốt tháng … chưa đạt ngưỡng 30.000.000đ."'), rev1 < 30_000_000 && early.status === 400 && /chưa đạt ngưỡng 30\.000\.000đ/.test(early.body.message), `${early.status} ${short(early.body, 260)}`, 'API');
  const b0 = await wallet(CTV);
  const [r1, r2] = await Promise.all([call('ctv', 'POST', '/affiliate/milestones/milestone-10m/claim', {}), call('ctv', 'POST', '/affiliate/milestones/milestone-10m/claim', {})]);
  const wins = [r1, r2].filter((r) => r.status === 201 || r.status === 200).length;
  const claim3 = await call('ctv', 'POST', '/affiliate/milestones/milestone-3m/claim', {});
  const again3 = await call('ctv', 'POST', '/affiliate/milestones/milestone-3m/claim', {});
  const b1 = await wallet(CTV);
  const lines = await sql(`SELECT delta, reason, lot, "refType" FROM points_transactions WHERE "userId"=$1 AND reason LIKE 'CTV_MILESTONE:%' ORDER BY "createdAt"`, CTV);
  const claims = await sql(`SELECT "milestoneId", "monthKey", "rewardPoints", revenue, "revokedAt", "revokeCount", "revokeDebt", "revokeTaken" FROM ctv_milestone_claims WHERE "userId"=$1 ORDER BY "milestoneId"`, CTV);
  check('L6-D14', T('Nhận thưởng mốc: một lần duy nhất (kể cả bấm đôi song song), cộng Điểm Xanh lô STANDARD, sổ = số dư', 'ctv', 'POST /affiliate/milestones/:id/claim (10m song song ×2, 3m hai lần)', 'mốc 10m: đúng 1 lần thành công (+200.000), mốc 3m: lần 2 → 400 "Bạn đã nhận thưởng mốc này rồi."; điểm +250.000; users.pointsBalance = Σ STANDARD'),
    rev1 >= 10_000_000 && wins === 1 && claim3.status === 201 && again3.status === 400 && /đã nhận thưởng mốc này rồi/.test(again3.body.message) && b1.points === b0.points + 250_000 && b1.points === b1.pointsLedger && lines.length === 2 && lines.every((l) => l.lot === 'STANDARD'),
    `song song: ${r1.status}/${r2.status}; 3m: ${claim3.status} ${short(claim3.body, 180)}; lần 2: ${again3.status} ${short(again3.body, 120)}; điểm ${b0.points}→${b1.points} (Σsổ ${b1.pointsLedger}); dòng sổ=${short(lines)}; claims=${short(claims, 500)}`, 'SQL');
  const pts = (await sql(`SELECT "expiresAt" FROM points_transactions WHERE "userId"=$1 AND reason LIKE 'CTV_MILESTONE:%' LIMIT 1`, CTV))[0];
  check('L6-D15', T('Điểm thưởng mốc có hạn dùng (lô STANDARD có expiresAt)', 'ctv', 'SQL points_transactions.expiresAt', 'expiresAt khác null'), !!pts?.expiresAt, `expiresAt=${pts?.expiresAt}`, 'SQL');
}

}

// ---------- g. bậc CTV ----------
{
  const tiers = await call('ctv', 'GET', '/affiliate/tiers');
  const names = (tiers.body?.allTiers ?? []).map((t) => `${t.name}:${t.min}:${t.milestoneRewardPoints}`).join('|');
  const exp = 'Tân binh:0:null|Đồng:3000000:50000|Bạc:10000000:200000|Vàng:30000000:600000|Kim Cương:80000000:2000000';
  const wantTier = rev1 >= 80_000_000 ? 'Kim Cương' : rev1 >= 30_000_000 ? 'Vàng' : rev1 >= 10_000_000 ? 'Bạc' : rev1 >= 3_000_000 ? 'Đồng' : 'Tân binh';
  check('L6-D16', T('Bảng bậc CTV: 5 bậc, ngưỡng và thưởng mốc; bậc hiện tại theo doanh số đã chốt', 'ctv', 'GET /affiliate/tiers', `5 bậc đúng ngưỡng; bậc hiện tại ${wantTier} (doanh số ${rev1})`), names === exp && tiers.body?.tier?.name === wantTier && tiers.body?.revenue === rev1, `allTiers=${names}; tier=${short(tiers.body?.tier)}; revenue=${tiers.body?.revenue}`, 'API + SQL');
  const pub = await call(null, 'GET', '/storefront/public/uatctv');
  const raw = JSON.stringify(pub.body ?? {});
  check('L6-D17', T('Huy hiệu bậc công khai trên gian hàng CTV: có tên bậc, KHÔNG lộ doanh số/hoa hồng', 'guest', 'GET /storefront/public/uatctv', `có tên bậc ${wantTier}, không có số doanh số ${rev1} hay monthRevenue/commission`), pub.status === 200 && raw.includes(wantTier) && !raw.includes(String(rev1)) && !/monthRevenue|commissionableTotal|bonusPct|walletBalance|pointsBalance/.test(raw), `status=${pub.status}; tier=${short(pub.body?.owner ?? pub.body?.tier ?? pub.body?.ctvTier, 200)}`, 'API');
}

// ---------- h. thu hồi mốc khi đơn trả hàng ----------
{
  const w0 = await wallet(CTV);
  const [cB] = await commissionOf(codes[1]);
  const [cC] = await commissionOf(codes[2]);
  const [payout] = await sql(`SELECT id, "grossAmount" g, "taxWithheld" t, "taxRefunded" r FROM payouts WHERE id=$1`, cB.walletPayoutId);
  const shareB = Math.ceil((cB.amount * (payout.t - payout.r)) / payout.g);
  const shareC = Math.ceil((cC.amount * (payout.t - payout.r)) / payout.g);
  const expectDebit = (cB.amount - shareB) + (cC.amount - shareC);
  webhook(codes[1], 'returned');
  webhook(codes[2], 'returned');
  await sleep(2000);
  const w1 = await wallet(CTV);
  const rev2 = await monthRev(CTV);
  const rows = await sql(`SELECT delta, reason, type FROM wallet_transactions WHERE "userId"=$1 AND type='COMMISSION_REVERSAL' ORDER BY "createdAt" DESC LIMIT 2`, CTV);
  check('L6-D18', T('Đơn trả hàng sau khi hoa hồng đã vào Ví (đã khấu trừ thuế): chỉ trừ phần thực nhận, sổ = số dư', 'ctv', 'webhook returned ×2 (đơn B, C)', `Ví −(2.300.000 − phần thuế ceil(2.300.000×${payout.t}/${payout.g})) mỗi đơn = −${expectDebit}`),
    w1.balance === w0.balance - expectDebit && w1.balance === w1.ledger && rows.length === 2, `thuế lệnh gốc ${payout.t}/${payout.g}; phần thuế mỗi đơn ${shareB}; Ví ${w0.balance}→${w1.balance} (kỳ vọng −${expectDebit}); Σsổ ${w1.ledger}; dòng=${short(rows, 300)}`, 'SQL');
  const claims = await sql(`SELECT "milestoneId", "rewardPoints", "revokedAt", "revokeCount", "revokeDebt", "revokeTaken" FROM ctv_milestone_claims WHERE "userId"=$1 ORDER BY "milestoneId"`, CTV);
  const lost = (id, thr) => rev2 < thr;
  const c10 = claims.find((c) => c.milestoneId === 'milestone-10m');
  const c3 = claims.find((c) => c.milestoneId === 'milestone-3m');
  const revokeLines = await sql(`SELECT delta, reason, lot, "refType" FROM points_transactions WHERE "userId"=$1 AND reason LIKE 'AFFILIATE_MILESTONE_REVOKE:%'`, CTV);
  const okRev = (lost('10m', 10_000_000) ? !!c10.revokedAt && c10.revokeCount === 1 && c10.revokeTaken === 200_000 && c10.revokeDebt === 0 : !c10.revokedAt) && (lost('3m', 3_000_000) ? !!c3.revokedAt : !c3.revokedAt);
  check('L6-D19', T('Thu hồi thưởng mốc khi doanh số đã chốt rơi dưới ngưỡng (đơn bị trả)', 'ctv', 'sau trả đơn B, C: ctv_milestone_claims.revokedAt/revokeTaken/revokeDebt', `doanh số tháng ${rev1} → ${rev2}: mốc 10 triệu bị thu 200.000 điểm (revokedAt, revokeCount=1, revokeTaken=200000, revokeDebt=0), mốc 3 triệu giữ`),
    okRev && w1.points === w0.points - 200_000 && w1.points === w1.pointsLedger && revokeLines.length === 1 && revokeLines[0].delta === -200_000, `doanh số ${rev1}→${rev2}; claims=${short(claims, 600)}; dòng thu hồi=${short(revokeLines)}; điểm ${w0.points}→${w1.points} (Σsổ ${w1.pointsLedger})`, 'SQL');
  await sleep(500);
  const nrv = await notifs(CTV, 'COMMISSION_MILESTONE_REVOKED');
  const nb = nrv.at(-1)?.payload?.body ?? '';
  check('L6-D20', T('Tin thu hồi thưởng mốc COMMISSION_MILESTONE_REVOKED', 'ctv', 'notification_logs', 'có đúng 1 tin gộp, nêu tháng 11/2026, "Mốc Tăng Tốc 10 Triệu", "200.000 Điểm Xanh thưởng mốc đã được thu lại", lời nhắc nhận lại; không "Vui lòng"/"chúng tôi"/"..."'),
    nrv.length === 1 && /11\/2026/.test(nb) && /Mốc Tăng Tốc 10 Triệu/.test(nb) && /200\.000 Điểm Xanh thưởng mốc đã được thu lại/.test(nb) && /nhận lại được/.test(nb) && !/Vui lòng|chúng tôi|\.\.\./i.test(nb), `${nrv.length} tin: ${nb}`, 'SQL');
  runJob('AffiliateService.notifyMilestoneRevokes');
  const nrv2 = await notifs(CTV, 'COMMISSION_MILESTONE_REVOKED');
  check('L6-D21', T('Chạy lại quét tin thu hồi không báo đôi (dedupeKey)', 'ctv', 'run-job notifyMilestoneRevokes', 'vẫn đúng 1 tin'), nrv2.length === 1, `${nrv2.length} tin`, 'SQL');
  const r2 = await call('ctv', 'GET', '/affiliate/milestones');
  const m10 = (r2.body?.milestones ?? []).find((x) => x.id === 'milestone-10m');
  check('L6-D22', T('Sau thu hồi, bảng mốc cho phép nhận lại khi doanh số lên lại; chưa đủ thì canClaim=false', 'ctv', 'GET /affiliate/milestones', `doanh số ${rev2} < 10.000.000 nên canClaim=false, claimed=false`), m10 && m10.claimed === false && m10.canClaim === (rev2 >= 10_000_000), short(m10, 300), 'API');
}

// ---------- i. nhận lại mốc khi doanh số lên lại ----------
{
  const b = await buy('new', [['FUWA-DW-5L', 11]], { paymentMethod: 'COD', referralCode: 'UATCTV' });
  deliver(b.code);
  await approveAll([b.code]);
  const rev3 = await monthRev(CTV);
  const w0 = await wallet(CTV);
  const rc = await call('ctv', 'POST', '/affiliate/milestones/milestone-10m/claim', {});
  const w1 = await wallet(CTV);
  const [claim] = await sql(`SELECT "revokedAt", "revokeCount", "revokeDebt", "rewardPoints" FROM ctv_milestone_claims WHERE "userId"=$1 AND "milestoneId"='milestone-10m'`, CTV);
  const [line] = await sql(`SELECT delta, reason FROM points_transactions WHERE "userId"=$1 AND reason LIKE 'CTV_MILESTONE:milestone-10m:%#1'`, CTV);
  check('L6-D23', T('Doanh số lên lại ngưỡng: nhận lại mốc đã bị thu hồi', 'ctv', 'mua thêm 11×FUWA-DW-5L, duyệt, POST claim milestone-10m', `doanh số ${rev3} ≥ 10 triệu: nhận lại +200.000 điểm (dòng "#1"), claim.revokedAt=null, sổ = số dư`),
    rev3 >= 10_000_000 && rc.status === 201 && rc.body.rewardPoints === 200_000 && w1.points === w0.points + 200_000 && w1.points === w1.pointsLedger && claim.revokedAt === null && line?.delta === 200_000,
    `doanh số=${rev3}; resp=${short(rc.body, 220)}; điểm ${w0.points}→${w1.points} (Σsổ ${w1.pointsLedger}); claim=${short(claim)}; dòng=${short(line)}`, 'SQL');
}

// ---------- j. đối soát cuối ----------
{
  const w = await wallet(CTV);
  check('L6-D24', T('Đối soát cuối c2: Ví và Điểm Xanh của CTV', 'ctv', 'SQL tổng', 'walletBalance = Σ wallet_transactions; pointsBalance = Σ points_transactions lô STANDARD'), w.balance === w.ledger && w.points === w.pointsLedger, `Ví ${w.balance}/${w.ledger}; điểm ${w.points}/${w.pointsLedger}`, 'SQL');
}
await done();
