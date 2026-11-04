// C3: thu hồi thưởng mốc khi số dư điểm CTV thiếu (ghi nợ revokeDebt), tin ghi nợ, nhận lại trừ nợ. Dùng CTV thứ hai (uat_ctv_pending).
// Luật: ctv-milestone-revoke.ts (thiếu thì dòng nợ delta 0 refType REFERRAL_DEBT, claim.revokeDebt/revokeTaken); claimMilestone trừ nợ khi nhận lại.
// Chạy sau c2: node c3-debt.mjs (từ gốc worktree uat-1104).
import { call, short, sql, exec, buy, notifs, check, done, webhook, runJob, sleep, commissionOf } from './common.mjs';

const T = (title, persona, step, expect) => ({ title, persona, size: 'API', journey: title, step, expect });
const P = 'uat_ctv_pending';
const deliver = (code) => { webhook(code, 'shipped'); webhook(code, 'delivered'); };
const approve = async (code) => { await exec(`UPDATE commissions SET "lockedAt" = now() - interval '11 days' WHERE "orderId" = (SELECT id FROM orders WHERE code=$1) AND status='LOCKED'`, code); runJob('AffiliateService.approveDueCommissions'); };
const pts = async () => { const [u] = await sql(`SELECT "pointsBalance"::int p FROM users WHERE id=$1`, P); const [l] = await sql(`SELECT COALESCE(SUM(delta),0)::int s FROM points_transactions WHERE "userId"=$1 AND lot='STANDARD'`, P); return { p: u.p, s: l.s }; };

// 7 × FUWA-DW-5L (430.000đ) = 3.010.000đ, đúng qua mốc 3 triệu
const big = await buy('new', [['FUWA-DW-5L', 7]], { paymentMethod: 'COD', referralCode: 'UATCTVPENDING' });
const [cm] = await commissionOf(big.code);
check('L6-E01', T('CTV chờ duyệt gian hàng vẫn hưởng hoa hồng đơn qua mã của mình', 'new', 'place-order 7×FUWA-DW-5L qua mã UATCTVPENDING', 'commission 8% = floor(3.010.000×8%) = 240.800đ cho uat_ctv_pending'), big.ok && cm?.uid === P && cm?.amount === 240_800, `đơn=${big.code}; commission=${short(cm, 260)}`, 'SQL');
deliver(big.code);
await approve(big.code);
const claim = await call('ctv_pending', 'POST', '/affiliate/milestones/milestone-3m/claim', {});
const p1 = await pts();
check('L6-E02', T('CTV thứ hai nhận mốc 3 triệu', 'ctv_pending', 'POST claim milestone-3m', '+50.000 Điểm Xanh, sổ = số dư'), claim.status === 201 && p1.p === 50_000 && p1.s === 50_000, `${claim.status} ${short(claim.body, 200)}; điểm ${p1.p}/Σsổ ${p1.s}`, 'SQL');

// tiêu hết điểm bằng đơn của chính CTV (pointsToUse)
let spent = 0;
const attempts = [];
for (let i = 0; i < 6; i++) {
  const left = (await pts()).p;
  if (left <= 0) break;
  const r = await buy('ctv_pending', [['FUWA-DW-5L', 1]], { paymentMethod: 'COD', pointsToUse: left });
  attempts.push(`${r.status}${r.ok ? '' : ' ' + short(r.body, 150)}`);
  if (!r.ok) break;
  spent += left - (await pts()).p;
}
const p2 = await pts();
check('L6-E03', T('CTV dùng Điểm Xanh thưởng mốc để mua hàng (pointsToUse)', 'ctv_pending', 'place-order với pointsToUse', 'điểm giảm đúng số đã dùng, sổ = số dư'), spent > 0 && p2.p === p2.s, `đã dùng ${spent}; còn ${p2.p}/Σsổ ${p2.s}; lần thử: ${attempts.join(' | ')}`, 'SQL', spent > 0 ? undefined : 'BLOCKED');

if (p2.p >= 50_000) {
  check('L6-E04', T('Ghi nợ thu hồi mốc khi số dư thiếu', 'ctv_pending', 'không tiêu được điểm', 'bỏ qua'), false, `không tiêu được điểm (còn ${p2.p}); ca nợ không dựng được`, 'API', 'BLOCKED');
} else {
  const balBefore = p2.p;
  webhook(big.code, 'returned');
  await sleep(2000);
  const [c] = await sql(`SELECT "revokedAt", "revokeCount", "revokeDebt", "revokeTaken" FROM ctv_milestone_claims WHERE "userId"=$1 AND "milestoneId"='milestone-3m'`, P);
  const taken = Math.min(50_000, Math.max(balBefore, 0));
  const debt = 50_000 - taken;
  const lines = await sql(`SELECT delta, reason, "refType" FROM points_transactions WHERE "userId"=$1 AND (reason LIKE 'AFFILIATE_MILESTONE_REVOKE:%' OR reason LIKE 'AFFILIATE_MILESTONE_DEBT:%') ORDER BY "createdAt"`, P);
  const p3 = await pts();
  check('L6-E04', T('Thu hồi mốc khi điểm đã tiêu: thu phần còn lại, ghi nợ phần thiếu', 'ctv_pending', 'webhook returned đơn mốc; SQL claim + sổ điểm', `thu ${taken} (số dư), nợ ${debt}; claim.revokeTaken=${taken}, revokeDebt=${debt}; điểm không âm; sổ = số dư`),
    !!c?.revokedAt && c.revokeTaken === taken && c.revokeDebt === debt && p3.p >= 0 && p3.p === p3.s && (debt > 0 ? lines.some((l) => l.delta === 0 && l.refType === 'REFERRAL_DEBT') : true), `claim=${short(c)}; dòng=${short(lines, 400)}; điểm ${balBefore}→${p3.p}/Σsổ ${p3.s}`, 'SQL');
  await sleep(500);
  const n = await notifs(P, 'COMMISSION_MILESTONE_REVOKED');
  const body = n.at(-1)?.payload?.body ?? '';
  check('L6-E05', T('Tin thu hồi mốc có nợ nói rõ phần chưa thu được', 'ctv_pending', 'notification_logs', debt > 0 ? '"ghi nợ"/"chưa thu hết" kèm số điểm, nhắc sẽ trừ khi nhận lại mốc; không "Vui lòng"/"chúng tôi"/"..."' : 'tin thu hồi đủ'),
    n.length === 1 && (debt > 0 ? /chưa thu/.test(body) && new RegExp(debt.toLocaleString('vi-VN')).test(body) && /sẽ trừ khi bạn nhận lại mốc/.test(body) : true) && !/Vui lòng|chúng tôi|\.\.\./i.test(body), `${n.length} tin: ${body}`, 'SQL');

  // doanh số lên lại: nhận lại, trừ phần nợ
  const b2 = await buy('new', [['FUWA-DW-5L', 7]], { paymentMethod: 'COD', referralCode: 'UATCTVPENDING' });
  deliver(b2.code);
  await approve(b2.code);
  const m = await call('ctv_pending', 'GET', '/affiliate/milestones');
  const m3 = (m.body?.milestones ?? []).find((x) => x.id === 'milestone-3m');
  const w0 = await pts();
  const rc = await call('ctv_pending', 'POST', '/affiliate/milestones/milestone-3m/claim', {});
  const w1 = await pts();
  const [c2] = await sql(`SELECT "revokedAt", "revokeDebt", "revokeCount" FROM ctv_milestone_claims WHERE "userId"=$1 AND "milestoneId"='milestone-3m'`, P);
  const want = Math.max(0, 50_000 - debt);
  check('L6-E06', T('Nhận lại mốc sau khi bị thu hồi có nợ: chỉ nhận phần chưa bị nợ trừ', 'ctv_pending', 'đơn mới 3.010.000đ duyệt, POST claim milestone-3m', `bảng mốc hiện rewardPoints=${want}; nhận lại +${want} điểm; claim mở lại (revokedAt null)`),
    rc.status === 201 && m3?.rewardPoints === want && rc.body.rewardPoints === want && w1.p === w0.p + want && w1.p === w1.s && c2.revokedAt === null, `bảng=${short(m3, 220)}; resp=${rc.status} ${short(rc.body, 300)}; điểm ${w0.p}→${w1.p}/Σsổ ${w1.s}; claim=${short(c2)}`, 'SQL');
  if (want === 0) {
    const zero = /nhận lại 0 Điểm Xanh/.test(rc.body?.message ?? '');
    check('L6-E07', T('Chữ khi nhận lại mốc mà phần nợ ăn hết thưởng', 'ctv_pending', 'đọc message của POST claim và bảng mốc', 'luật nợ đã chốt (trừ nợ khi nhận lại); chữ "nhận lại 0 Điểm Xanh" và nút nhận 0 điểm chưa có luật chữ riêng nên ghi CẦN CHỦ'), !zero, `message="${rc.body?.message}"; bảng mốc rewardPoints=0 canClaim=true`, 'API', zero ? 'CẦN CHỦ' : 'PASS');
  }
}
const w = await pts();
check('L6-E08', T('Đối soát điểm CTV thứ hai', 'ctv_pending', 'SQL', 'pointsBalance = Σ STANDARD'), w.p === w.s, `${w.p}/${w.s}`, 'SQL');
await done();
