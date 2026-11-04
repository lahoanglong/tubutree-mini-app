// C14: (1) bấm "Chuyển vào Ví" song song với Idempotency-Key KHÁC nhau: Ví chỉ được cộng một lần, sổ ví = số dư;
//      (2) CTV dán URL/SĐT/HTML vào lời nhắn gian hàng: trang công khai hiện thành chữ, không thành liên kết hay thẻ HTML.
// Luật: affiliate.service.ts requestPayout (chỉ chuyển trọn số khả dụng, WALLET_BALANCE 1:1); Mini không có liên kết ra ngoài (AGENTS.md quy tắc Mini).
// Chạy sau c9 (đụng uat_ctv): node c14-payout-race-note.mjs (từ gốc worktree uat-1104).
import fs from 'node:fs';
import path from 'node:path';
import { H, SHOTS, call, short, sql, exec, buy, check, done, webhook, runJob, idk } from './common.mjs';
const { open } = await import(`${H}/miniapp-session.mjs`);
const { openWeb } = await import(`${H}/web-session.mjs`);

const M = (journey, persona, size, step, expect) => ({ title: journey, persona, size, journey, step, expect });
const CTV = 'uat_ctv';
const truth = async () => {
  const [u] = await sql(`SELECT "walletBalance"::int w FROM users WHERE id=$1`, CTV);
  const [l] = await sql(`SELECT COALESCE(SUM(delta),0)::int s FROM wallet_transactions WHERE "userId"=$1`, CTV);
  return { balance: u.w, ledger: l.s };
};

// ---------- (1) race chuyển Ví ----------
for (let i = 0; i < 2; i++) {
  const b = await buy('new', [['FUWA-HW-500', 1]], { paymentMethod: 'COD', referralCode: 'UATCTV' });
  webhook(b.code, 'shipped');
  webhook(b.code, 'delivered');
  await exec(`UPDATE commissions SET "lockedAt" = now() - interval '11 days' WHERE "orderId" = (SELECT id FROM orders WHERE code=$1) AND status='LOCKED'`, b.code);
}
runJob('AffiliateService.approveDueCommissions');
const avail = (await call('ctv', 'GET', '/affiliate/dashboard')).body.withdrawableCommission;
const w0 = await truth();
const [p0] = await sql(`SELECT count(*)::int n FROM payouts WHERE "userId"=$1`, CTV);
const [m0] = await sql(`SELECT COALESCE(SUM("grossAmount"),0)::int g FROM payouts WHERE "userId"=$1 AND "requestedAt" + interval '7 hours' >= date_trunc('month', (now() AT TIME ZONE 'UTC') + interval '7 hours')`, CTV);
const rs = await Promise.all(Array.from({ length: 5 }, () => call('ctv', 'POST', '/affiliate/payouts', { amount: avail, method: 'WALLET_BALANCE' }, { 'idempotency-key': idk('l6race') })));
const w1 = await truth();
const [p1] = await sql(`SELECT count(*)::int n FROM payouts WHERE "userId"=$1`, CTV);
const [pay] = await sql(`SELECT "grossAmount"::int g, "taxWithheld"::int t, amount::int n FROM payouts WHERE "userId"=$1 ORDER BY "requestedAt" DESC LIMIT 1`, CTV);
const [left] = await sql(`SELECT count(*)::int n FROM commissions WHERE "affiliateUserId"=$1 AND status='APPROVED'`, CTV);
const ok201 = rs.filter((r) => r.status === 201).length;
const maxTax = Math.floor(avail * 0.1);
check('L6-C21', M('Bấm Chuyển vào Ví song song 5 lần (khoá Idempotency-Key khác nhau): Ví chỉ cộng một lần', 'ctv', 'API', `POST /affiliate/payouts ×5 đồng thời, mỗi lần amount=${avail}`, `đúng 1 lần 201; các lần còn lại bị từ chối (400, hết khoản khả dụng); một dòng payouts gốc ${avail} (affiliate.service.ts requestPayout); Ví cộng đúng số thực nhận (gốc trừ thuế TNCN 10% khi tổng tháng ≥ 5.000.000đ) một lần; số dư = Σ sổ ví; không còn APPROVED`),
  avail > 0 && ok201 === 1 && pay.g === avail && pay.t >= 0 && pay.t <= maxTax && pay.n === pay.g - pay.t && w1.balance === w0.balance + pay.n && w1.balance === w1.ledger && p1.n === p0.n + 1 && left.n === 0,
  `khả dụng=${avail}; trạng thái=${rs.map((r) => r.status).join(',')}; payout gốc/thuế/thực nhận=${pay.g}/${pay.t}/${pay.n} (tổng gốc tháng trước đó ${m0.g}); Ví ${w0.balance}→${w1.balance} Σsổ ${w1.ledger}; payouts ${p0.n}→${p1.n}; APPROVED còn ${left.n}; lỗi mẫu=${short(rs.find((r) => r.status !== 201)?.body?.message, 120)}`, 'SQL wallet_transactions + payouts + commissions');

// ---------- (2) URL/SĐT/HTML trong lời nhắn gian hàng ----------
const [sf] = await sql(`SELECT "headerNote" h FROM storefronts WHERE "ownerUserId"=$1`, CTV);
const NOTE = 'Zalo 0987654321 hoặc https://example.com/khuyen-mai <b>đậm</b>';
const up = await call('ctv', 'PATCH', '/storefront/me', { headerNote: NOTE });
const seen = {};
try {
  const probe = (page) => page.evaluate(() => {
    const main = document.querySelector('main') ?? document.body;
    const anchors = [...main.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')).filter((h) => /^(https?:|tel:|zalo:|mailto:)/i.test(h) && !/tubutree|localhost/i.test(h));
    const bold = main.querySelectorAll('b').length;
    return { anchors, bold, hasText: main.innerText.includes('khuyen-mai') };
  });
  const mini = await open(6, 'guest', { path: '/s/uatctv', viewport: { width: 375, height: 812, isMobile: true } });
  try { await mini.page.waitForTimeout(3000); seen.mini = await probe(mini.page); await mini.page.screenshot({ path: path.join(SHOTS, 'mini375-cong-khai-loi-nhan-url.png') }); } finally { await mini.close(); }
  const web = await openWeb(6, 'guest', { path: '/s/uatctv', viewport: { width: 375, height: 812, isMobile: true } });
  try { await web.page.waitForTimeout(3000); seen.web = await probe(web.page); await web.page.screenshot({ path: path.join(SHOTS, 'web375-cong-khai-loi-nhan-url.png') }); } finally { await web.close(); }
} finally {
  await call('ctv', 'PATCH', '/storefront/me', { headerNote: sf?.h ?? '' });
}
fs.writeFileSync(path.join(SHOTS, 'cong-khai-loi-nhan-url.json'), JSON.stringify({ up: up.status, seen }, null, 2));
const linked = [...(seen.mini?.anchors ?? []), ...(seen.web?.anchors ?? [])];
const raw = (seen.mini?.bold ?? 0) + (seen.web?.bold ?? 0);
check('L6-F26', M('Lời nhắn gian hàng có URL, SĐT và thẻ HTML: trang công khai hiện thành chữ thường', 'ctv + guest', 'mini375+web375', 'PATCH /storefront/me headerNote rồi mở /s/uatctv trên Mini và web', 'lưu được; không thẻ <b> thật; nếu có liên kết ra ngoài thì ghi CẦN CHỦ (Mini không có liên kết ngoài)'),
  up.ok && raw === 0 && linked.length === 0, `PATCH=${up.status}; Mini=${short(seen.mini, 200)}; web=${short(seen.web, 200)}`, 'shots/L6-ctv-dai-ly-nhan/mini375-cong-khai-loi-nhan-url.png',
  up.ok && raw === 0 && linked.length > 0 ? 'CẦN CHỦ' : undefined);
await done();
