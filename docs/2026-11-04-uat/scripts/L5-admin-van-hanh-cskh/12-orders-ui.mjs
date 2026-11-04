// Đơn hàng thao tác bằng GIAO DIỆN admin (web): Kế toán 375 bấm "Đã nhận tiền", CSKH 1280 bấm "Huỷ đơn", Kho 375 chỉ thấy "Đã đóng gói".
// Đối chiếu DB sau mỗi thao tác. Dùng: node 12-orders-ui.mjs
import { L, SHOTS, ENV, check, rec, save, short, placeOrder, orderRow, userState, sql, sleep } from './_lib.mjs';

const WT = '/Users/longla/coding/tubutree-mini-app/.claude/worktrees/uat-1104';
const { openWeb } = await import(`${WT}/docs/2026-10-20-uat/tools/uat-harness/web-session.mjs`);
const J = 'Đơn hàng bằng giao diện';
async function bypassApi(ctx) {
  await ctx.route((u) => u.href.startsWith(L.apiUrl), (route) => route.continue({ headers: { ...route.request().headers(), 'x-throttle-bypass': ENV.THROTTLE_BYPASS_TOKEN } }));
}
async function openOrder(s, code) {
  await s.page.goto(`${L.webUrl}/admin?tab=orders`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await s.page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => undefined);
  const box = s.page.getByPlaceholder(/mã đơn/i).first();
  await box.waitFor({ timeout: 20000 }).catch(async () => { await s.page.screenshot({ path: `${SHOTS}/ui-openorder-fail.png` }); console.log('không thấy ô tìm đơn; URL', s.page.url()); });
  await box.fill(code, { timeout: 5000 });
  await s.page.getByRole('button', { name: /Tìm kiếm/ }).first().click();
  await s.page.waitForTimeout(1500);
  const wide = (s.page.viewportSize()?.width ?? 0) >= 1024;
  if (wide) {
    await s.page.locator('tr', { hasText: code }).getByRole('button', { name: /Xem & Sửa/ }).first().click({ timeout: 8000 });
    await s.page.waitForTimeout(800);
    await s.page.screenshot({ path: `${SHOTS}/ui1280-row-menu.png` });
    const item = s.page.getByRole('menuitem', { name: /Xem|Sửa|Chi tiết/ }).first();
    if (await item.count()) await item.click({ timeout: 5000 }).catch(() => undefined);
  } else {
    await s.page.getByText(code).first().click();
  }
  await s.page.waitForTimeout(1500);
}
const textOf = (s) => s.page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').trim());

// 1. Kế toán 375: "Đã nhận tiền"
{
  const { code } = await placeOrder('returning', { method: 'BANK_TRANSFER' });
  const o0 = await orderRow(code);
  const s = await openWeb(5, 'ketoan', { viewport: { width: 375, height: 800 }, path: '/admin?tab=orders' });
  await bypassApi(s.context);
  await openOrder(s, code);
  await s.page.screenshot({ path: `${SHOTS}/ui375-ketoan-order-open.png` });
  const txt = await textOf(s);
  check('L5-OUI-01', 'ketoan', 'web375', J, 'Kế toán mở đơn chuyển khoản chưa trả ở 375px', 'thấy khối "Xác nhận đã nhận tiền" + nút "Đã nhận tiền"; SĐT khách chỉ hiện đuôi (che)', /Đã nhận tiền/.test(txt) && !/0901000003/.test(txt), `có nút=${/Đã nhận tiền/.test(txt)}; lộ SĐT đầy đủ=${/0901000003/.test(txt)}`, txt.slice(0, 240));
  const refInput = s.page.getByPlaceholder(/FT26270/).first();
  if (await refInput.count()) await refInput.fill('FT26UI0001');
  const from = s.requests.length;
  const payBtn = s.page.locator('section[aria-label="Xác nhận đã nhận tiền"] button', { hasText: 'Đã nhận tiền' }).first();
  const clickErr = await payBtn.click({ timeout: 8000 }).then(() => '', (e) => String(e.message).split('\n')[0]);
  if (clickErr) console.log('lỗi bấm nút:', clickErr);
  await s.page.waitForTimeout(700);
  await s.page.screenshot({ path: `${SHOTS}/ui375-ketoan-order-confirm-sheet.png` });
  const sheetTxt = await textOf(s);
  check('L5-OUI-02a', 'ketoan', 'web375', J, 'Bấm "Đã nhận tiền" hiện hộp xác nhận', 'có hộp "Xác nhận đã nhận tiền" nêu số tiền + mã đơn + câu hậu quả, chưa ghi gì vào DB', /Xác nhận đã nhận 120\.000đ/.test(sheetTxt) && (await orderRow(code)).ps === 'UNPAID', `hộp: ${(sheetTxt.match(/Xác nhận đã nhận [^?]*\?/) ?? [''])[0].slice(0, 120)}`, null);
  const sheetOk = s.page.getByRole('button', { name: 'Đã nhận tiền', exact: true }).last();
  const clickErr2 = await sheetOk.click({ timeout: 8000 }).then(() => '', (e) => String(e.message).split('\n')[0]);
  if (clickErr2) console.log('lỗi bấm xác nhận:', clickErr2);
  await s.page.waitForTimeout(2500);
  await s.page.screenshot({ path: `${SHOTS}/ui375-ketoan-order-paid.png` });
  const o1 = await orderRow(code);
  const req = s.requests.slice(from).find((r) => /confirm-payment/.test(r.path));
  const msg = (await textOf(s)).match(/Đã (ghi nhận|xác nhận)[^.]{0,120}/)?.[0] ?? '';
  check('L5-OUI-02', 'ketoan', 'web375', J, 'Kế toán bấm "Đã nhận tiền" + mã giao dịch', 'POST confirm-payment 2xx; DB paymentStatus PAID, paidAt có, trạng thái rời PENDING_PAYMENT; màn báo kết quả', req?.status < 300 && o1.ps === 'PAID' && !!o1.paidAt && o1.status !== 'PENDING_PAYMENT', `${req ? `${req.method} ${req.path} ${req.status}` : 'không gọi API'}; DB ${o0.status}/${o0.ps} -> ${o1.status}/${o1.ps}; chữ báo: "${msg}"`, { o0, o1 });
  const hist = await sql(`SELECT note FROM order_status_history WHERE "orderId"=$1 ORDER BY "createdAt" DESC LIMIT 2`, [o1.id]).catch(() => []);
  rec('L5-OUI-02b', 'ketoan', 'web375', J, 'Lịch sử đơn ghi mã giao dịch', 'ghi mã FT26UI0001', JSON.stringify(hist), hist, JSON.stringify(hist).includes('FT26UI0001') ? 'PASS' : 'CAN_CHU');
  await s.close();
}

// 2. CSKH 1280: "Huỷ đơn" COD
{
  const { code } = await placeOrder('returning', { method: 'COD' });
  const o0 = await orderRow(code);
  const u0 = await userState('uat_returning');
  const s = await openWeb(5, 'cskh', { viewport: { width: 1280, height: 800 }, path: '/admin?tab=orders' });
  await bypassApi(s.context);
  await openOrder(s, code);
  await s.page.screenshot({ path: `${SHOTS}/ui1280-cskh-order-open.png` });
  const btns = await s.page.evaluate(() => [...document.querySelectorAll('button')].map((b) => b.textContent.trim()).filter((t) => /Xác nhận|Đã đóng gói|Giao vận|Đã giao hàng|Huỷ đơn/.test(t)));
  check('L5-OUI-03', 'cskh', 'web1280', J, 'CSKH mở đơn COD đã xác nhận', 'chỉ thấy "Huỷ đơn" (CSKH chỉ được huỷ: order-actor-transitions.ts), không thấy Đã đóng gói / Giao vận / Đã giao hàng', btns.includes('Huỷ đơn') && !btns.some((t) => /Đã đóng gói|Giao vận|Đã giao hàng/.test(t)), `nút chuyển trạng thái: ${JSON.stringify(btns)}`, btns);
  const cErr = await s.page.getByRole('button', { name: /^Huỷ đơn$/ }).first().click({ timeout: 8000 }).then(() => '', (e) => String(e.message).split('\n')[0]);
  if (cErr) console.log('lỗi bấm Huỷ đơn:', cErr);
  await s.page.waitForTimeout(800);
  await s.page.screenshot({ path: `${SHOTS}/ui1280-cskh-cancel-dialog.png` });
  const dlg = await textOf(s);
  const reason = s.page.getByRole('textbox').last();
  if (await reason.count()) await reason.fill('UAT: khách đổi ý').catch(() => undefined);
  const from = s.requests.length;
  const confirmBtn = s.page.getByRole('button', { name: /^(Huỷ đơn|Xác nhận huỷ|Đồng ý|Xác nhận)$/ }).last();
  await confirmBtn.click({ timeout: 8000 }).catch(() => undefined);
  await s.page.waitForTimeout(2500);
  const o1 = await orderRow(code);
  const u1 = await userState('uat_returning');
  const req = s.requests.slice(from).find((r) => /\/status$/.test(r.path));
  check('L5-OUI-04', 'cskh', 'web1280', J, 'CSKH bấm "Huỷ đơn" và xác nhận trong hộp thoại', 'PUT status 2xx; DB CANCELLED; COD chưa giao nên Ví không đổi', req?.status < 300 && o1.status === 'CANCELLED' && u1.wallet === u0.wallet, `${req ? `${req.method} ${req.path} ${req.status}` : 'không gọi API'}; DB ${o0.status} -> ${o1.status}; ví ${u0.wallet} -> ${u1.wallet}; hộp thoại: "${dlg.slice(dlg.indexOf('Huỷ'), dlg.indexOf('Huỷ') + 160)}"`, { o0, o1 });
  await s.close();
}

// 3. Kho 375: chỉ "Đã đóng gói"
{
  const { code } = await placeOrder('returning', { method: 'COD' });
  const s = await openWeb(5, 'kho', { viewport: { width: 375, height: 800 }, path: '/admin?tab=orders' });
  await bypassApi(s.context);
  await openOrder(s, code);
  await s.page.screenshot({ path: `${SHOTS}/ui375-kho-order-open.png` });
  const btns = await s.page.evaluate(() => [...document.querySelectorAll('button')].map((b) => b.textContent.trim()).filter((t) => /^(Xác nhận|Đã đóng gói|Giao vận|Đã giao hàng|Huỷ đơn)$/.test(t)));
  check('L5-OUI-05', 'kho', 'web375', J, 'Kho mở đơn COD đã xác nhận ở 375px', 'chỉ thấy "Đã đóng gói" (KHO chỉ PACKED)', btns.length === 1 && btns[0] === 'Đã đóng gói', `nút: ${JSON.stringify(btns)}`, btns);
  const o0 = await orderRow(code);
  const from = s.requests.length;
  const pErr = await s.page.getByRole('button', { name: /^Đã đóng gói$/ }).first().click({ timeout: 8000 }).then(() => '', (e) => String(e.message).split('\n')[0]);
  if (pErr) console.log('lỗi bấm Đã đóng gói:', pErr);
  await s.page.waitForTimeout(2500);
  const o1 = await orderRow(code);
  const req = s.requests.slice(from).find((r) => /\/status$/.test(r.path));
  check('L5-OUI-06', 'kho', 'web375', J, 'Kho bấm "Đã đóng gói"', 'PUT status 2xx; DB PACKED', req?.status < 300 && o1.status === 'PACKED', `${req ? `${req.method} ${req.path} ${req.status}` : 'không gọi API'}; DB ${o0.status} -> ${o1.status}`, { o0, o1 });
  await s.close();
}

// 4. Admin 1280 thấy đủ nút + SĐT đầy đủ
{
  const { code } = await placeOrder('returning', { method: 'COD' });
  const s = await openWeb(5, 'admin', { viewport: { width: 1280, height: 800 }, path: '/admin?tab=orders' });
  await bypassApi(s.context);
  await openOrder(s, code);
  await s.page.screenshot({ path: `${SHOTS}/ui1280-admin-order-open.png` });
  const txt = await textOf(s);
  const btns = await s.page.evaluate(() => [...document.querySelectorAll('button')].map((b) => b.textContent.trim()).filter((t) => /^(Đã đóng gói|Giao vận|Đã giao hàng|Huỷ đơn)$/.test(t)));
  check('L5-OUI-07', 'admin', 'web1280', J, 'ADMIN mở đơn COD đã xác nhận', 'thấy SĐT đầy đủ; có nút Đã đóng gói + Huỷ đơn', /0901000003/.test(txt) && btns.includes('Đã đóng gói') && btns.includes('Huỷ đơn'), `SĐT đầy đủ=${/0901000003/.test(txt)}; nút ${JSON.stringify(btns)}`, btns);
  await s.close();
}
save('12-orders-ui');
process.exit(0);
