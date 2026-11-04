// Lệnh rút CTV (luồng cũ, dựng bằng SQL vì API không còn tạo lệnh BANK mới) bằng GIAO DIỆN Admin 375: "Duyệt" rồi Kế toán 375 "Đã chuyển khoản" (đã kiểm ở 18),
// và "Từ chối (hoàn tiền)" bắt buộc lý do + hoàn amount+fee vào Ví CTV, sổ Ví khớp. Dùng: node 22-payout-ui.mjs
import { L, SHOTS, ENV, check, rec, save, short, sql, userState } from './_lib.mjs';

const WT = '/Users/longla/coding/tubutree-mini-app/.claude/worktrees/uat-1104';
const { openWeb } = await import(`${WT}/docs/2026-10-20-uat/tools/uat-harness/web-session.mjs`);
const J = 'Lệnh rút CTV bằng giao diện (375)';
const bypassApi = (ctx) => ctx.route((u) => u.href.startsWith(L.apiUrl), (route) => route.continue({ headers: { ...route.request().headers(), 'x-throttle-bypass': ENV.THROTTLE_BYPASS_TOKEN } }));
const settle = async (s) => { await s.page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => undefined); await s.page.waitForTimeout(900); };
const textOf = (s) => s.page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').trim());
const mk = async (amount, fee) => {
  const id = `uatpui${Math.random().toString(36).slice(2, 9)}`;
  await sql(`INSERT INTO payouts (id,"userId",amount,method,status,"requestedAt",fee,"bankInfo") VALUES ($1,'uat_ctv',$2,'BANK','REQUESTED',now(),$3,'{"bank":"VCB","accountNo":"0123456789","accountName":"PHAM VAN CTV"}'::jsonb)`, [id, amount, fee]);
  return id;
};
const cardOf = (s, amountText) => s.page.locator('div.rounded-card', { hasText: amountText }).filter({ has: s.page.getByRole('button', { name: /^Duyệt$/ }) }).first();

try {
  const pA = await mk(510000, 0);
  const pB = await mk(320000, 5000);
  const w0 = await userState('uat_ctv');
  const s = await openWeb(5, 'admin', { viewport: { width: 375, height: 800 }, path: '/admin?tab=payouts' });
  await bypassApi(s.context);
  await settle(s);
  await s.page.screenshot({ path: `${SHOTS}/ui375-admin-payouts.png`, fullPage: true });
  const t0 = await textOf(s);
  check('L5-PUI-01', 'admin', 'web375', J, 'Admin mở tab Thuế TNCN hoa hồng (có 2 lệnh rút cũ REQUESTED)', 'mục "Lệnh rút ngân hàng cũ" mở sẵn ở "Chờ duyệt", thấy 510.000đ và 320.000đ (phí 5.000đ), có nút Duyệt + Từ chối', /510\.000đ/.test(t0) && /320\.000đ/.test(t0) && /đã trừ phí 5\.000đ/.test(t0), `thấy 510.000đ=${/510\.000đ/.test(t0)}; 320.000đ=${/320\.000đ/.test(t0)}; phí=${/đã trừ phí 5\.000đ/.test(t0)}`, null);

  const from = s.requests.length;
  await cardOf(s, '510.000đ').getByRole('button', { name: /^Duyệt$/ }).click({ timeout: 8000 });
  await s.page.waitForTimeout(800);
  await s.page.screenshot({ path: `${SHOTS}/ui375-admin-payout-approve-dialog.png` });
  const d1 = await textOf(s);
  const [pre] = await sql(`SELECT status::text s FROM payouts WHERE id=$1`, [pA]);
  const hasDlg = /Duyệt lệnh rút tiền/.test(d1);
  if (hasDlg) await s.page.locator('[role="alertdialog"] button, [role="dialog"] button').filter({ hasText: /^Duyệt lệnh rút$/ }).last().click({ timeout: 8000 });
  await s.page.waitForTimeout(2500);
  const [post] = await sql(`SELECT status::text s, "reviewedBy" r FROM payouts WHERE id=$1`, [pA]).catch(async () => sql(`SELECT status::text s FROM payouts WHERE id=$1`, [pA]));
  const req = s.requests.slice(from).find((r) => /approve/.test(r.path) && r.method === 'POST');
  const w1 = await userState('uat_ctv');
  check('L5-PUI-02', 'admin', 'web375', J, 'Admin bấm "Duyệt" lệnh 510.000đ rồi xác nhận', 'hộp "Duyệt lệnh rút tiền" hỏi trước (DB còn REQUESTED); xác nhận: POST approve 2xx, DB APPROVED; Ví CTV không đổi (chưa chi)', hasDlg && pre.s === 'REQUESTED' && req?.status < 300 && post.s === 'APPROVED' && w0.wallet === w1.wallet, `hộp=${hasDlg}; trước xác nhận ${pre.s}; ${req ? `${req.method} ${req.path} ${req.status}` : 'không gọi API'}; sau ${JSON.stringify(post)}; Ví ${w0.wallet} -> ${w1.wallet}`, null);

  const cardB = s.page.locator('div.rounded-card', { hasText: '320.000đ' }).filter({ has: s.page.getByRole('button', { name: /^Từ chối/ }) }).first();
  const fromB = s.requests.length;
  await cardB.getByRole('button', { name: /^Từ chối/ }).click({ timeout: 8000 });
  await s.page.waitForTimeout(700);
  const noReason = await s.page.evaluate(() => [...document.querySelectorAll('[role="alert"]')].map((e) => e.textContent.trim()).join(' | '));
  const reqNo = s.requests.slice(fromB).some((r) => /reject/.test(r.path) && r.method === 'POST');
  const [stillB] = await sql(`SELECT status::text s FROM payouts WHERE id=$1`, [pB]);
  await s.page.screenshot({ path: `${SHOTS}/ui375-admin-payout-reject-noreason.png` });
  check('L5-PUI-03', 'admin', 'web375', J, 'Admin bấm "Từ chối (hoàn tiền)" khi chưa ghi lý do', 'báo phải ghi lý do (tiếng Việt), không gọi API, lệnh vẫn REQUESTED', !reqNo && stillB.s === 'REQUESTED' && (/lý do/i.test(noReason) || /lý do/i.test(await textOf(s))), `gọi API=${reqNo}; DB ${stillB.s}; cảnh báo: "${noReason}"`, null);
  await cardB.getByLabel(/Ghi chú \/ lý do/).fill('UAT: sai số tài khoản');
  const fromC = s.requests.length;
  await cardB.getByRole('button', { name: /^Từ chối/ }).click({ timeout: 8000 });
  await s.page.waitForTimeout(800);
  await s.page.screenshot({ path: `${SHOTS}/ui375-admin-payout-reject-dialog.png` });
  const d2 = await textOf(s);
  const [preB] = await sql(`SELECT status::text s FROM payouts WHERE id=$1`, [pB]);
  const hasDlg2 = /Từ chối lệnh rút tiền/.test(d2) && /HOÀN LẠI/.test(d2);
  if (hasDlg2) await s.page.locator('[role="alertdialog"] button, [role="dialog"] button').filter({ hasText: /^Từ chối$/ }).last().click({ timeout: 8000 });
  await s.page.waitForTimeout(2500);
  const [postB] = await sql(`SELECT status::text s, "rejectionReason" r FROM payouts WHERE id=$1`, [pB]);
  const reqB = s.requests.slice(fromC).find((r) => /reject/.test(r.path) && r.method === 'POST');
  const w2 = await userState('uat_ctv');
  check('L5-PUI-04', 'admin', 'web375', J, 'Admin ghi lý do rồi "Từ chối (hoàn tiền)" lệnh 320.000đ (phí 5.000đ)', 'hộp nêu "Tiền/hoa hồng sẽ được HOÀN LẠI cho CTV"; xác nhận: POST reject 2xx, DB REJECTED + lý do; Ví CTV +325.000đ (amount + fee); sổ Ví = số dư', hasDlg2 && preB.s === 'REQUESTED' && reqB?.status < 300 && postB.s === 'REJECTED' && postB.r === 'UAT: sai số tài khoản' && w2.wallet - w1.wallet === 325000 && w2.wallet === w2.wsum, `hộp=${hasDlg2}; ${reqB ? `${reqB.method} ${reqB.path} ${reqB.status}` : 'không gọi API'}; DB ${JSON.stringify(postB)}; Ví ${w1.wallet} -> ${w2.wallet} (${w2.wallet - w1.wallet >= 0 ? '+' : ''}${w2.wallet - w1.wallet}); sổ Ví ${w2.wsum}`, null);
  await s.page.screenshot({ path: `${SHOTS}/ui375-admin-payouts-after.png`, fullPage: true });
  await s.close();
} catch (e) {
  rec('L5-PUI-ERR', '-', '-', J, 'Bước chạy script', 'không lỗi', `lỗi script: ${String(e.message).split('\n')[0]}`, null, 'BLOCKED');
}
save('22-payout-ui');
process.exit(0);
