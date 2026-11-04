// L5-B01 bằng giao diện: CSKH 1280 mở hộp "Huỷ đơn" cho đơn chuyển khoản chưa trả; đúng lúc bấm xác nhận thì Kế toán gọi "Đã nhận tiền".
// Chụp màn hình sau khi PUT status trả 2xx để xem người dùng có được báo gì không. Thử tối đa 4 đơn. Dùng: node 20-b01-ui.mjs
import { L, SHOTS, ENV, check, rec, save, call, placeOrder, orderRow, sleep } from './_lib.mjs';

const WT = '/Users/longla/coding/tubutree-mini-app/.claude/worktrees/uat-1104';
const { openWeb } = await import(`${WT}/docs/2026-10-20-uat/tools/uat-harness/web-session.mjs`);
const J = 'Huỷ đơn đồng thời với Đã nhận tiền (giao diện)';
const bypassApi = (ctx) => ctx.route((u) => u.href.startsWith(L.apiUrl), (route) => route.continue({ headers: { ...route.request().headers(), 'x-throttle-bypass': ENV.THROTTLE_BYPASS_TOKEN } }));
const textOf = (s) => s.page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').trim());

let shot = false;
for (let i = 1; i <= 4 && !shot; i++) {
  const { code } = await placeOrder('returning', { method: 'BANK_TRANSFER' });
  const o = await orderRow(code);
  const s = await openWeb(5, 'cskh', { viewport: { width: 1280, height: 800 }, path: '/admin?tab=orders' });
  await bypassApi(s.context);
  await s.page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => undefined);
  await s.page.getByPlaceholder(/mã đơn/i).first().fill(code);
  await s.page.getByRole('button', { name: /Tìm kiếm/ }).first().click();
  await s.page.waitForTimeout(1500);
  await s.page.locator('tr', { hasText: code }).getByRole('button', { name: /Xem & Sửa/ }).first().click({ timeout: 8000 });
  await s.page.waitForTimeout(800);
  const item = s.page.getByRole('menuitem', { name: /Xem|Sửa|Chi tiết/ }).first();
  if (await item.count()) await item.click({ timeout: 5000 }).catch(() => undefined);
  await s.page.waitForTimeout(1200);
  await s.page.getByRole('button', { name: /^Huỷ đơn$/ }).first().click({ timeout: 8000 });
  await s.page.waitForTimeout(700);
  const reason = s.page.getByRole('textbox').last();
  if (await reason.count()) await reason.fill('UAT: khách đổi ý').catch(() => undefined);
  const confirmBtn = s.page.getByRole('button', { name: /^(Huỷ đơn|Xác nhận huỷ|Đồng ý|Xác nhận)$/ }).last();
  const from = s.requests.length;
  let pay = { status: '-' };
  await s.context.route((u) => u.href.startsWith(L.apiUrl) && /\/status$/.test(u.pathname), async (route) => {
    const [, p] = await Promise.all([route.continue({ headers: { ...route.request().headers(), 'x-throttle-bypass': ENV.THROTTLE_BYPASS_TOKEN } }), call('ketoan', 'POST', `/admin/orders/${o.id}/confirm-payment`, {})]);
    pay = p;
  });
  await confirmBtn.click({ timeout: 8000 }).catch(() => undefined);
  await s.page.waitForTimeout(3000);
  const after = await orderRow(code);
  const req = s.requests.slice(from).find((r) => /\/status$/.test(r.path));
  const txt = await textOf(s);
  const lost = req && req.status < 300 && after.status !== 'CANCELLED';
  console.log(`lần ${i} ${code}: Đã nhận tiền ${pay.status}; PUT status ${req?.status}; đơn cuối ${after.status}/${after.ps}${lost ? ' <-- thua race' : ''}`);
  if (lost) {
    shot = true;
    await s.page.screenshot({ path: `${SHOTS}/ui1280-cskh-B01-cancel-lost-race.png` });
    const alerts = await s.page.evaluate(() => [...document.querySelectorAll('[role="alert"],[role="status"]')].map((e) => e.textContent.trim()).filter(Boolean));
    check('L5-B01-UI', 'cskh', 'web1280', J, `CSKH bấm xác nhận "Huỷ đơn" đúng lúc Kế toán "Đã nhận tiền" (${code})`, 'đơn được huỷ, hoặc màn báo rõ "chưa huỷ được: đơn vừa đổi trạng thái"', after.status === 'CANCELLED' || /chưa huỷ|không huỷ được|vừa đổi/i.test(txt), `PUT status ${req?.status}; đơn cuối ${after.status}/${after.ps}; thông báo trên màn: ${JSON.stringify(alerts)}`, txt.slice(0, 300));
  }
  await s.close();
}
if (!shot) rec('L5-B01-UI', 'cskh', 'web1280', J, 'Tái hiện bằng giao diện', 'thua race ở ít nhất 1/4 lần', 'không tái hiện bằng giao diện trong 4 lần (cửa sổ race quá hẹp); bản API tái hiện được ở L5-B01', null, 'BLOCKED');
save('20-b01-ui');
process.exit(0);
