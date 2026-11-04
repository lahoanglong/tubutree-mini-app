// C1: hoa hồng CTV đầu-cuối trên API thật của lane 6 (tiền: SQL đối chiếu sổ). Chạy: node c1-money.mjs  (từ gốc worktree uat-1104)
// Luật: affiliate.default_rate_pct=8, affiliate.attribution_days=7, affiliate.hold_days=10 (max với returns.window_days=7),
// affiliate.auto_wallet_transfer_enabled=true, affiliate.commission_eligible_roles=[AFFILIATE,DEALER]; nguồn mã: affiliate.service.ts.
import { call, short, sql, exec, buy, orderRow, commissionOf, notifs, check, done, webhook, runJob, idk, sleep } from './common.mjs';

const M = (journey, persona, step, expect) => ({ title: journey, persona, size: 'API', journey, step, expect });
const CTV = 'uat_ctv';

async function ctvWalletTruth(uid) {
  const [u] = await sql(`SELECT "walletBalance"::int w FROM users WHERE id=$1`, uid);
  const [l] = await sql(`SELECT COALESCE(SUM(delta),0)::int s FROM wallet_transactions WHERE "userId"=$1`, uid);
  return { balance: u.w, ledger: l.s };
}
async function deliver(code) { webhook(code, 'shipped'); webhook(code, 'delivered'); }
async function approveNow(code, days = 11) {
  await exec(`UPDATE commissions SET "lockedAt" = now() - interval '${days} days' WHERE "orderId" = (SELECT id FROM orders WHERE code=$1) AND status='LOCKED'`, code);
  return runJob('AffiliateService.approveDueCommissions');
}

// ---------- C01 baseline ----------
{
  const me = await call('ctv', 'GET', '/affiliate/me');
  const d = await call('ctv', 'GET', '/affiliate/dashboard');
  const ok = me.status === 200 && me.body.isAffiliate === true && me.body.referralCode === 'UATCTV' && d.status === 200 && d.body.autoWalletTransfer === true && d.body.tier?.name === 'Tân binh';
  check('L6-C01', M('Trang CTV: hồ sơ + bảng điều khiển ban đầu', 'ctv', 'GET /affiliate/me, /affiliate/dashboard', 'isAffiliate, mã UATCTV, bậc Tân binh, autoWalletTransfer=true (affiliate.auto_wallet_transfer_enabled)'), ok, `me=${short(me.body, 250)} dash=${short(d.body, 350)}`, 'API 200');
}

// ---------- C02 mua qua link (touch) ----------
const baseNotif = (await notifs(CTV, 'COMMISSION_NEW')).length;
const t = await call('new', 'POST', '/affiliate/touch', { referralCode: 'UATCTV', storefrontSlug: 'uatctv', kind: 'ctv' });
const [touch] = await sql(`SELECT "referrerUserId", "storefrontSlug", kind, "clickedAt", "expiresAt", EXTRACT(EPOCH FROM ("expiresAt"-"clickedAt"))/86400 days FROM referral_touches WHERE "userId"='uat_new'`);
check('L6-C02', M('Khách mới mở link CTV: ghi "chạm" giới thiệu', 'new', 'POST /affiliate/touch', 'hạn = clickedAt + affiliate.attribution_days (7 ngày)'), t.body?.ok === true && touch?.referrerUserId === CTV && Math.round(touch.days) === 7, `touch=${short(t.body)} row=${short(touch)}`, 'SQL referral_touches');

const b1 = await buy('new', [['FUWA-DW-5L', 1], ['FUWA-LD-2L', 1]], { paymentMethod: 'COD' });
const o1 = await orderRow(b1.code);
const c1 = await commissionOf(b1.code);
const items1 = await sql(`SELECT oi.id, oi."paidTotal", oi.total FROM order_items oi JOIN orders o ON o.id=oi."orderId" WHERE o.code=$1 ORDER BY oi.id`, b1.code);
const expect1 = items1.reduce((s, i) => s + Math.floor(((i.paidTotal ?? i.total) * 8) / 100), 0);
check('L6-C03', M('Khách mới mua qua link (chỉ có "chạm", không mã trong đơn): đơn ghi công CTV + hoa hồng PENDING', 'new', 'POST /checkout/place-order COD 640.000đ', `hoa hồng = Σ floor(tiền dòng thực trả × 8%) = ${expect1}đ`),
  o1?.ref === CTV && o1?.sf === 'uatctv' && c1.length === 1 && c1[0].status === 'PENDING' && c1[0].amount === expect1 && c1[0].rate === 8 && c1[0].base === 640000,
  `order ref=${o1?.ref} sf=${o1?.sf} total=${o1?.total}; commission=${short(c1[0], 300)}; Σ floor(paid*8%)=${expect1}`, 'SQL orders/commissions/order_items');
await sleep(800);
const n1 = await notifs(CTV, 'COMMISSION_NEW');
check('L6-C04', M('Báo CTV có đơn mới từ link', 'ctv', 'notification_logs COMMISSION_NEW', 'có tin COMMISSION_NEW kèm số hoa hồng dự kiến; giọng đợt 8 (không "Vui lòng", "chúng tôi")'),
  n1.length === baseNotif + 1 && /51\.200đ|hoa hồng dự kiến/.test(JSON.stringify(n1.at(-1)?.payload)) && !/Vui lòng|chúng tôi|\.\.\./i.test(JSON.stringify(n1.at(-1)?.payload)), short(n1.at(-1), 400), 'SQL notification_logs');

// ---------- C05 vòng đời: LOCKED -> giữ hold -> APPROVED -> tự vào Ví ----------
await deliver(b1.code);
const c1l = (await commissionOf(b1.code))[0];
runJob('AffiliateService.approveDueCommissions');
const stillLocked = (await commissionOf(b1.code))[0].status;
check('L6-C05', M('Đơn giao xong: hoa hồng PENDING→LOCKED, chưa duyệt trước hết hold', 'ctv', 'webhook shipped+delivered; run-job approveDueCommissions ngay', 'LOCKED có lockedAt; sau job ngay vẫn LOCKED (hold=max(affiliate.hold_days 10, returns.window_days 7)=10 ngày)'),
  c1l.status === 'LOCKED' && !!c1l.lockedAt && stillLocked === 'LOCKED', `trước job: ${c1l.status}; sau job: ${stillLocked}`, 'SQL commissions');
const ctvBefore = await ctvWalletTruth(CTV);
await exec(`UPDATE commissions SET "lockedAt" = now() - interval '9 days' WHERE "orderId" = (SELECT id FROM orders WHERE code=$1)`, b1.code);
runJob('AffiliateService.approveDueCommissions');
const c9 = (await commissionOf(b1.code))[0].status;
await approveNow(b1.code, 11);
const c11 = (await commissionOf(b1.code))[0];
check('L6-C06', M('Hoa hồng giữ đủ số ngày cấu hình mới được duyệt', 'ctv', 'lùi lockedAt 9 ngày → job; lùi 11 ngày → job', '9 ngày: vẫn LOCKED; 11 ngày: APPROVED có approvedAt'), c9 === 'LOCKED' && c11.status === 'APPROVED' && !!c11.approvedAt, `9 ngày=${c9}; 11 ngày=${c11.status} approvedAt=${c11.approvedAt}`, 'SQL commissions');
const dsh = (await call('ctv', 'GET', '/affiliate/dashboard')).body;
runJob('AffiliateService.autoTransferApprovedToWallet');
const c1p = (await commissionOf(b1.code))[0];
const w1 = await ctvWalletTruth(CTV);
const [pay1] = await sql(`SELECT id, amount, "grossAmount" g, "taxWithheld" tax, status, method FROM payouts WHERE id=$1`, c1p.walletPayoutId ?? 'x');
const [wt1] = await sql(`SELECT delta, "balanceAfter" b, type, "refType", "refId" FROM wallet_transactions WHERE "userId"=$1 ORDER BY "createdAt" DESC LIMIT 1`, CTV);
check('L6-C07', M('Hoa hồng APPROVED tự vào Ví 1:1 (affiliate.auto_wallet_transfer_enabled)', 'ctv', 'run-job autoTransferApprovedToWallet; SQL commission/payout/wallet', `Ví +${expect1}đ (không nhân hệ số), commission PAID gắn walletPayoutId, payout PAID/WALLET_BALANCE gross=${expect1} thuế 0, sổ ví = số dư`),
  c1p.status === 'PAID' && pay1?.amount === expect1 && pay1?.g === expect1 && pay1?.tax === 0 && wt1?.delta === expect1 && w1.balance === ctvBefore.balance + expect1 && w1.balance === w1.ledger,
  `dashboard trước: withdrawable=${dsh.withdrawableCommission}; commission=${c1p.status}; payout=${short(pay1)}; wallet_tx=${short(wt1)}; users.walletBalance=${w1.balance} Σsổ=${w1.ledger} (trước ${ctvBefore.balance})`, 'SQL');
await sleep(500);
const nw = await notifs(CTV, 'COMMISSION_WALLET_CREDITED');
check('L6-C08', M('Tin "đã chuyển hoa hồng vào Ví"', 'ctv', 'notification_logs', 'có tin COMMISSION_WALLET_CREDITED với số tiền đúng, không nhắc ngân hàng/rút tiền'),
  nw.length >= 1 && new RegExp(`${expect1.toLocaleString('vi-VN')}đ`).test(JSON.stringify(nw.at(-1).payload)) && !/ngân hàng/i.test(JSON.stringify(nw.at(-1).payload)), short(nw.at(-1)?.payload, 300), 'SQL notification_logs');

// ---------- C09 API rút tiền: chỉ vào Ví, không bank ----------
{
  const bank = await call('ctv', 'POST', '/affiliate/payouts', { amount: 1000, method: 'BANK', bankInfo: { bank: 'x' } }, { 'idempotency-key': idk() });
  const none = await call('ctv', 'POST', '/affiliate/payouts', { amount: 1000, method: 'WALLET_BALANCE' }, { 'idempotency-key': idk() });
  check('L6-C09', M('Rút hoa hồng về ngân hàng bị chặn; chuyển Ví khi không còn khoản khả dụng', 'ctv', 'POST /affiliate/payouts method=BANK; method=WALLET_BALANCE khi hết APPROVED', 'BANK → 400 "Hoa hồng chỉ chuyển vào Ví Tubu để mua hàng."; Ví khi hết khoản → 400 "Không có hoa hồng khả dụng để chuyển vào Ví."'),
    bank.status === 400 && bank.body.message === 'Hoa hồng chỉ chuyển vào Ví Tubu để mua hàng.' && none.status === 400 && /Không có hoa hồng khả dụng/.test(none.body.message), `BANK=${bank.status} ${short(bank.body, 200)} | WALLET=${none.status} ${short(none.body, 200)}`, 'API');
}

// ---------- C10 thu hồi sau khi đã vào Ví (đơn trả hàng) ----------
{
  const b = await buy('new', [['FUWA-HW-500', 2], ['COBOTE-PW-100', 1]], { paymentMethod: 'COD', referralCode: 'UATCTV' });
  const exp = Math.floor((89000 * 2 * 8) / 100) + Math.floor((79000 * 8) / 100);
  const c = (await commissionOf(b.code))[0];
  await deliver(b.code);
  await approveNow(b.code);
  runJob('AffiliateService.autoTransferApprovedToWallet');
  const before = await ctvWalletTruth(CTV);
  const paid = (await commissionOf(b.code))[0];
  webhook(b.code, 'returned');
  await sleep(1500);
  const after = await ctvWalletTruth(CTV);
  const aft = (await commissionOf(b.code))[0];
  const [rev] = await sql(`SELECT delta, type, reason, "balanceAfter" bal FROM wallet_transactions WHERE "userId"=$1 AND type='COMMISSION_REVERSAL' ORDER BY "createdAt" DESC LIMIT 1`, CTV);
  const [oS] = await sql(`SELECT status FROM orders WHERE code=$1`, b.code);
  check('L6-C10', M('Đơn bị trả hàng sau khi hoa hồng đã vào Ví: trừ lại Ví đúng số, commission REJECTED', 'ctv', 'webhook returned; SQL ví', `hoa hồng ${exp}đ; Ví −${exp}đ qua dòng COMMISSION_REVERSAL; sổ = số dư`),
    c.amount === exp && paid.status === 'PAID' && aft.status === 'REJECTED' && rev?.delta === -exp && after.balance === before.balance - exp && after.balance === after.ledger && oS.status === 'RETURNED',
    `tạo=${c.amount} (kỳ vọng ${exp}); trước trả: ${paid.status}, Ví ${before.balance}; sau: ${aft.status}, Ví ${after.balance}, Σsổ ${after.ledger}; dòng thu hồi=${short(rev)}; đơn=${oS.status}`, 'SQL');
  await sleep(500);
  const nr = await notifs(CTV, 'COMMISSION_REVERSED');
  check('L6-C11', M('Tin thu hồi hoa hồng khi đơn trả hàng', 'ctv', 'notification_logs COMMISSION_REVERSED', 'có tin kèm số tiền thu hồi'), nr.length >= 1 && new RegExp(exp.toLocaleString('vi-VN')).test(JSON.stringify(nr.at(-1).payload)), short(nr.at(-1)?.payload, 300), 'SQL');
}

// ---------- C12 huỷ khi chưa giao: commission REJECTED, không đụng Ví ----------
{
  const b = await buy('new', [['FUWA-GL-500', 3]], { paymentMethod: 'COD', referralCode: 'UATCTV' });
  const c0 = (await commissionOf(b.code))[0];
  const w0 = await ctvWalletTruth(CTV);
  webhook(b.code, 'cancelled');
  await sleep(1200);
  const c = (await commissionOf(b.code))[0];
  const w = await ctvWalletTruth(CTV);
  const [o] = await sql(`SELECT status FROM orders WHERE code=$1`, b.code);
  check('L6-C12', M('Huỷ đơn khi chưa giao: hoa hồng PENDING→REJECTED, Ví không đổi', 'ctv', 'webhook cancelled', 'REJECTED; Ví giữ nguyên; đơn CANCELLED'), c0.status === 'PENDING' && c.status === 'REJECTED' && w.balance === w0.balance && o.status === 'CANCELLED', `trước=${c0.status}/${c0.amount}; sau=${c.status}; Ví ${w0.balance}→${w.balance}; đơn=${o.status}`, 'SQL');
}

// ---------- C13-16 ghi công KHÔNG áp dụng ----------
{
  const self = await buy('ctv', [['FUWA-GL-500', 1]], { paymentMethod: 'COD', referralCode: 'UATCTV' });
  const cs = await commissionOf(self.code);
  const os = await orderRow(self.code);
  check('L6-C13', M('CTV tự mua bằng mã của mình: không hoa hồng', 'ctv', 'place-order referralCode=UATCTV bởi chính CTV', 'không có dòng commission, đơn không ghi công (referrerUserId null)'), self.ok && cs.length === 0 && !os.ref, `đơn=${self.code} ref=${os?.ref} commissions=${cs.length}`, 'SQL');

  // Khách mới đang có chạm CTV còn hạn: mã của khách thường KHÔNG được đè chạm đó (attribution.ts), nên hoa hồng vẫn về CTV chạm.
  const keep = await buy('new', [['FUWA-GL-500', 1]], { paymentMethod: 'COD', referralCode: 'UATRETURNING' });
  const ok0 = await orderRow(keep.code);
  check('L6-C14a', M('Mã giới thiệu của khách thường không đè chạm CTV còn hạn', 'new', 'place-order referralCode=UATRETURNING khi đang có chạm UATCTV', 'đơn vẫn ghi công CTV đang chạm (attribution.ts, findEligibleReferrer)'), keep.ok && ok0.ref === CTV, `ref=${ok0?.ref}`, 'SQL');
  await exec(`DELETE FROM referral_touches WHERE "userId"='uat_new'`);
  const cust = await buy('new', [['FUWA-GL-500', 1]], { paymentMethod: 'COD', referralCode: 'UATRETURNING' });
  const cc = await commissionOf(cust.code);
  const oc = await orderRow(cust.code);
  check('L6-C14', M('Mã giới thiệu của khách thường (CUSTOMER) không sinh hoa hồng', 'new', 'xoá chạm; place-order referralCode=UATRETURNING', 'không commission (affiliate.commission_eligible_roles=[AFFILIATE,DEALER])'), cust.ok && cc.length === 0 && !oc.ref, `ref=${oc?.ref} commissions=${cc.length}`, 'SQL');

  await call('new', 'POST', '/affiliate/touch', { referralCode: 'UATCTV', storefrontSlug: 'uatctv', kind: 'ctv' });
  await exec(`UPDATE referral_touches SET "expiresAt" = now() - interval '1 minute' WHERE "userId"='uat_new'`);
  const exp = await buy('new', [['FUWA-GL-500', 1]], { paymentMethod: 'COD' });
  const ce = await commissionOf(exp.code);
  const oe = await orderRow(exp.code);
  check('L6-C15', M('Chạm giới thiệu hết hạn (sau 7 ngày): đơn không ghi công', 'new', 'đặt hạn chạm về quá khứ rồi mua không mã', 'không commission'), exp.ok && ce.length === 0 && !oe.ref, `ref=${oe?.ref} commissions=${ce.length}`, 'SQL');

  const bad = await buy('new', [['FUWA-GL-500', 1]], { paymentMethod: 'COD', referralCode: 'KHONGCO123' });
  check('L6-C16', M('Mã giới thiệu không tồn tại: đơn vẫn đặt được, không hoa hồng', 'new', 'place-order referralCode=KHONGCO123', 'đơn 201, không commission'), bad.ok && (await commissionOf(bad.code)).length === 0, `status=${bad.status} code=${bad.code}`, 'SQL');
}

// ---------- C17 hàng bị chặn affiliate ----------
{
  const [pv] = await sql(`SELECT p.id pid FROM products p JOIN variations v ON v."productId"=p.id WHERE v.sku='FUWA-HW-500'`);
  await exec(`UPDATE products SET "affiliateBlocked" = true WHERE id = $1`, pv.pid);
  const b = await buy('new', [['FUWA-HW-500', 1]], { paymentMethod: 'COD', referralCode: 'UATCTV' });
  const c = await commissionOf(b.code);
  await exec(`UPDATE products SET "affiliateBlocked" = false WHERE id = $1`, pv.pid);
  check('L6-C17', M('Sản phẩm bị chặn affiliate (affiliateBlocked): không hoa hồng dòng đó', 'new', 'đặt hàng chỉ có SP bị chặn', 'không commission (amount 0 thì không tạo dòng)'), b.ok && c.length === 0, `commissions=${c.length}`, 'SQL');
}

// ---------- C18 idempotency chuyển Ví bằng tay ----------
{
  const b = await buy('new', [['FUWA-HW-500', 1]], { paymentMethod: 'COD', referralCode: 'UATCTV' });
  await deliver(b.code);
  await approveNow(b.code);
  const avail = (await call('ctv', 'GET', '/affiliate/dashboard')).body.withdrawableCommission;
  const less = await call('ctv', 'POST', '/affiliate/payouts', { amount: avail - 1, method: 'WALLET_BALANCE' }, { 'idempotency-key': idk() });
  const key = idk('l6pay');
  const w0 = await ctvWalletTruth(CTV);
  const r1 = await call('ctv', 'POST', '/affiliate/payouts', { amount: avail, method: 'WALLET_BALANCE' }, { 'idempotency-key': key });
  const r2 = await call('ctv', 'POST', '/affiliate/payouts', { amount: avail, method: 'WALLET_BALANCE' }, { 'idempotency-key': key });
  const w1 = await ctvWalletTruth(CTV);
  check('L6-C18', M('Chuyển hoa hồng vào Ví bằng tay: chỉ nhận trọn số khả dụng; gửi lại cùng Idempotency-Key không cộng đôi', 'ctv', 'POST /affiliate/payouts', `thiếu 1đ → 400; đủ ${avail}đ → 201 credited ${avail}; gửi lại cùng key → cùng kết quả, Ví +${avail} một lần`),
    less.status === 400 && /Chỉ chuyển được toàn bộ/.test(less.body.message) && r1.status === 201 && r1.body.credited === avail && r2.body.credited === avail && w1.balance === w0.balance + avail && w1.balance === w1.ledger,
    `thiếu1=${less.status} "${less.body.message}"; r1=${short(r1.body, 200)}; r2=${short(r2.body, 200)}; Ví ${w0.balance}→${w1.balance} Σsổ ${w1.ledger}`, 'SQL');
}

// ---------- C19 cổng lượt ngày 8:00 VN ----------
{
  const b = await buy('new', [['FUWA-HW-500', 1]], { paymentMethod: 'COD', referralCode: 'UATCTV' });
  await deliver(b.code);
  await approveNow(b.code);
  const before = (await commissionOf(b.code))[0].status;
  const early = runJob('AffiliateService.runDailyWalletTransferIfDue', [{ $date: new Date(Date.UTC(2026, 10, 3, 22, 0, 0)).toISOString() }]);
  const mid = (await commissionOf(b.code))[0].status;
  await exec(`DELETE FROM cron_runs WHERE job = 'AffiliateService.dailyWalletTransfer'`);
  const late = runJob('AffiliateService.runDailyWalletTransferIfDue', [{ $date: new Date(Date.UTC(2026, 10, 4, 2, 5, 0)).toISOString() }]);
  const after = (await commissionOf(b.code))[0].status;
  const again = runJob('AffiliateService.runDailyWalletTransferIfDue', [{ $date: new Date(Date.UTC(2026, 10, 4, 3, 5, 0)).toISOString() }]);
  check('L6-C19', M('Lượt tự chuyển ngày chỉ chạy từ 08:00 giờ VN và một lần mỗi ngày', 'ctv', 'runDailyWalletTransferIfDue lúc 05:00, 09:05, 10:05 VN', '05:00 → false, commission còn APPROVED; 09:05 → true, PAID; 10:05 cùng ngày → false'),
    early.result === false && mid === 'APPROVED' && late.result === true && after === 'PAID' && again.result === false, `trước=${before}; 05:00→${short(early.result)} (${mid}); 09:05→${short(late.result)} (${after}); 10:05→${short(again.result)}`, 'job + SQL');
}

// ---------- đối soát cuối ----------
{
  const w = await ctvWalletTruth(CTV);
  const commissionPaid = (await sql(`SELECT COALESCE(SUM(amount),0)::int s FROM commissions WHERE "affiliateUserId"=$1 AND status='PAID'`, CTV))[0].s;
  const credited = (await sql(`SELECT COALESCE(SUM(delta),0)::int s FROM wallet_transactions WHERE "userId"=$1 AND type='COMMISSION_PAYOUT'`, CTV))[0].s;
  const reversed = (await sql(`SELECT COALESCE(SUM(delta),0)::int s FROM wallet_transactions WHERE "userId"=$1 AND type='COMMISSION_REVERSAL'`, CTV))[0].s;
  check('L6-C20', M('Đối soát Ví CTV sau chuỗi ca', 'ctv', 'SQL tổng', 'users.walletBalance = Σ wallet_transactions; Σ COMMISSION_PAYOUT + Σ COMMISSION_REVERSAL = số dư'), w.balance === w.ledger && credited + reversed === w.balance, `walletBalance=${w.balance} Σsổ=${w.ledger}; Σ payout=${credited}; Σ reversal=${reversed}; Σ commission PAID hiện tại=${commissionPaid}`, 'SQL');
}
await done();
