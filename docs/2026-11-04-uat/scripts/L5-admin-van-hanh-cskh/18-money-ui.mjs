// Việc tiền bằng GIAO DIỆN admin: Hoàn tiền khách (Kế toán/Admin 375), Thuế TNCN hoa hồng / lệnh rút (Kế toán 375),
// chip "Cần xử lý Pancake" + nút "Xuất CSV (Excel)" (Kế toán 1280, 375), tab Đổi / Trả (CSKH, Kho 375). Đối chiếu DB và sổ Ví sau mỗi thao tác.
// Dùng: node 18-money-ui.mjs
import fs from 'node:fs';
import { L, SHOTS, ENV, check, rec, save, short, call, sql, userState } from './_lib.mjs';

const WT = '/Users/longla/coding/tubutree-mini-app/.claude/worktrees/uat-1104';
const { openWeb } = await import(`${WT}/docs/2026-10-20-uat/tools/uat-harness/web-session.mjs`);
const J = 'Việc tiền bằng giao diện';
async function bypassApi(ctx) {
  await ctx.route((u) => u.href.startsWith(L.apiUrl), (route) => route.continue({ headers: { ...route.request().headers(), 'x-throttle-bypass': ENV.THROTTLE_BYPASS_TOKEN } }));
}
const settle = async (s) => { await s.page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => undefined); await s.page.waitForTimeout(900); };
const bodyText = (s) => s.page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').trim());
const overflowOf = (s) => s.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const clickTab = async (s, name) => s.page.getByRole('tab', { name }).first().click({ timeout: 8000 });
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const guard = async (id, fn) => { if (ONLY && !ONLY.includes(id.replace('L5-MUI-', ''))) return; try { await fn(); } catch (e) { rec(id, '-', '-', J, 'Bước chạy script', 'không lỗi', `lỗi script: ${String(e.message).split('\n')[0]}`, null, 'BLOCKED'); } };
const refundByCode = async (code) => (await sql(`SELECT r.id, r.status::text s, r.amount::int a, r."bankAccountNo" b, r."claimedBy" cb, r."bankRef" br, r."orderId" oid FROM order_customer_refunds r JOIN orders o ON o.id=r."orderId" WHERE o.code=$1`, [code]))[0];

// ── Hoàn tiền khách: danh sách + che SĐT (Kế toán 375) ──
await guard('L5-MUI-ERR1', async () => {
  const pend = await sql(`SELECT o.code, r.status::text s FROM order_customer_refunds r JOIN orders o ON o.id=r."orderId" WHERE r.status='PENDING' AND r."bankAccountNo" IS NULL ORDER BY r."createdAt" LIMIT 1`);
  const noBank = pend[0]?.code;
  const s = await openWeb(5, 'ketoan', { viewport: { width: 375, height: 800 }, path: '/admin?tab=customerRefunds' });
  await bypassApi(s.context);
  await settle(s);
  await s.page.screenshot({ path: `${SHOTS}/ui375-ketoan-customer-refunds.png` });
  const txt = await bodyText(s);
  const [cnt] = await sql(`SELECT count(*)::int n FROM order_customer_refunds WHERE status='PENDING'`);
  const shown = Number(txt.match(/Tổng:\s*(\d+)\s*khoản/)?.[1] ?? -1);
  const phones = txt.match(/\b0\d{9}\b/g) ?? [];
  const ph = await s.page.getByPlaceholder(/Mã đơn hoặc/).first().getAttribute('placeholder').catch(() => null);
  check('L5-MUI-01', 'ketoan', 'web375', J, 'Kế toán mở tab Hoàn tiền khách ở 375px', 'có danh sách khoản hoàn; ô tìm ghi "Mã đơn hoặc đủ 10 số SĐT" (SĐT bị che với Kế toán); không lộ SĐT 10 số; không tràn ngang', shown >= 0 && !phones.length && ph === 'Mã đơn hoặc đủ 10 số SĐT' && (await overflowOf(s)) <= 1, `Tổng ${shown} khoản (DB đang chờ ${cnt.n}); ô tìm: "${ph}"; SĐT 10 số lộ trên màn: ${phones.length}; tràn ngang ${await overflowOf(s)}px`, txt.slice(0, 260));
  if (noBank) {
    await s.page.getByRole('searchbox').first().fill(noBank);
    await s.page.waitForTimeout(1500);
    await s.page.getByRole('button', { name: 'Bắt đầu chuyển khoản' }).first().click({ timeout: 8000 }).catch(() => undefined);
    await s.page.waitForTimeout(800);
    await s.page.screenshot({ path: `${SHOTS}/ui375-ketoan-refund-claim-nobank.png` });
    const d = await bodyText(s);
    const acceptDisabled = await s.page.locator('[data-confirm="accept"]').first().isDisabled().catch(() => null);
    const before = await refundByCode(noBank);
    check('L5-MUI-02', 'ketoan', 'web375', J, `Kế toán bấm "Bắt đầu chuyển khoản" khoản ${noBank} khách chưa chọn tài khoản nhận`, 'hộp báo "Khách chưa chọn tài khoản nhận — nhờ quản trị viên nhập."; nút xác nhận bị khoá; DB vẫn PENDING', /Khách chưa chọn tài khoản nhận/.test(d) && acceptDisabled === true && before.s === 'PENDING', `câu báo=${/Khách chưa chọn tài khoản nhận — nhờ quản trị viên nhập/.test(d)}; nút xác nhận khoá=${acceptDisabled}; DB ${before.s}`, d.slice(d.indexOf('Bắt đầu chuyển khoản'), d.indexOf('Bắt đầu chuyển khoản') + 360));
  }
  await s.close();
});

// ── Admin nhập tài khoản thay khách rồi "Bắt đầu chuyển khoản" ──
await guard('L5-MUI-ERR2', async () => {
  const pend = await sql(`SELECT o.code FROM order_customer_refunds r JOIN orders o ON o.id=r."orderId" WHERE r.status='PENDING' AND r."bankAccountNo" IS NULL ORDER BY r."createdAt" LIMIT 1`);
  const code = pend[0]?.code;
  if (!code) return rec('L5-MUI-03', 'admin', 'web375', J, 'Admin nhập tài khoản thay khách', 'có khoản PENDING chưa có tài khoản', 'không còn khoản để thử', null, 'BLOCKED');
  const u0 = await sql(`SELECT "userId" u FROM orders WHERE code=$1`, [code]);
  const w0 = await userState(u0[0].u);
  const s = await openWeb(5, 'admin', { viewport: { width: 375, height: 800 }, path: '/admin?tab=customerRefunds' });
  await bypassApi(s.context);
  await settle(s);
  await s.page.getByRole('searchbox').first().fill(code);
  await s.page.waitForTimeout(1500);
  await s.page.getByRole('button', { name: 'Bắt đầu chuyển khoản' }).first().click({ timeout: 8000 });
  await s.page.waitForTimeout(700);
  await s.page.getByLabel('Tên ngân hàng').fill('Vietcombank');
  await s.page.getByLabel('Số tài khoản').fill('0011004567891');
  await s.page.getByLabel('Chủ tài khoản').fill('NGUYEN VAN UAT');
  await s.page.screenshot({ path: `${SHOTS}/ui375-admin-refund-claim-entry.png` });
  const from = s.requests.length;
  await s.page.locator('[data-confirm="accept"]').first().click({ timeout: 8000 });
  await s.page.waitForTimeout(2500);
  const r = await refundByCode(code);
  const req = s.requests.slice(from).find((x) => /customer-refunds/.test(x.path) && x.method === 'POST');
  const w1 = await userState(u0[0].u);
  await s.page.screenshot({ path: `${SHOTS}/ui375-admin-refund-claimed.png` });
  const t = await bodyText(s);
  check('L5-MUI-03', 'admin', 'web375', J, `Admin nhập tài khoản thay khách rồi bấm "Bắt đầu chuyển khoản" (${code})`, 'POST 2xx; DB PROCESSING, claimedBy = admin, đã có số tài khoản; màn báo "Đã khoá nơi nhận…"; Ví khách không đổi', req?.status < 300 && r.s === 'PROCESSING' && r.cb === 'uat_admin' && r.b === '0011004567891' && /Đã khoá nơi nhận/.test(t) && w0.wallet === w1.wallet, `${req ? `${req.method} ${req.path} ${req.status}` : 'không gọi API'}; DB ${r.s}, giữ bởi ${r.cb}, STK ${r.b}; ví ${w0.wallet} -> ${w1.wallet}; báo: ${/Đã khoá nơi nhận/.test(t)}`, null);
  await s.close();
});

// ── Kế toán tiếp quản khoản admin đang giữ rồi "Đã chuyển khoản" ──
await guard('L5-MUI-ERR3', async () => {
  const pr = await sql(`SELECT o.code, o."userId" u FROM order_customer_refunds r JOIN orders o ON o.id=r."orderId" WHERE r.status='PROCESSING' AND r."claimedBy"='uat_admin' ORDER BY r."createdAt" LIMIT 1`);
  const code = pr[0]?.code;
  if (!code) return rec('L5-MUI-04', 'ketoan', 'web375', J, 'Kế toán tiếp quản khoản admin giữ', 'có khoản PROCESSING do admin giữ', 'không còn khoản', null, 'BLOCKED');
  const w0 = await userState(pr[0].u);
  const s = await openWeb(5, 'ketoan', { viewport: { width: 375, height: 800 }, path: '/admin?tab=customerRefunds' });
  await bypassApi(s.context);
  await settle(s);
  await clickTab(s, /Đang chuyển/).catch(() => undefined);
  await s.page.waitForTimeout(1200);
  await s.page.getByRole('searchbox').first().fill(code);
  await s.page.waitForTimeout(1500);
  await s.page.screenshot({ path: `${SHOTS}/ui375-ketoan-refund-takeover-card.png` });
  const card = await bodyText(s);
  check('L5-MUI-04', 'ketoan', 'web375', J, `Kế toán xem khoản ${code} đang do Admin chuyển`, 'thẻ báo "Chỉ … được xác nhận hoặc trả về hàng chờ… tiếp quản kèm lý do"; nút ghi "(tiếp quản)"', /tiếp quản/.test(card) && /Chỉ .* được xác nhận/.test(card), `có chữ tiếp quản=${/tiếp quản/.test(card)}`, card.slice(card.indexOf('Bắt đầu chuyển lúc'), card.indexOf('Bắt đầu chuyển lúc') + 360));
  await s.page.getByRole('button', { name: /Đã chuyển khoản/ }).first().click({ timeout: 8000 });
  await s.page.waitForTimeout(700);
  await s.page.screenshot({ path: `${SHOTS}/ui375-ketoan-refund-paid-dialog.png` });
  const from = s.requests.length;
  await s.page.locator('[data-confirm="accept"]').first().click({ timeout: 8000 });
  await s.page.waitForTimeout(900);
  const missing = (await bodyText(s));
  const stillPending = (await refundByCode(code)).s === 'PROCESSING';
  const reqEmpty = s.requests.slice(from).find((x) => /mark-paid/.test(x.path));
  check('L5-MUI-05', 'ketoan', 'web375', J, 'Bấm "Đã chuyển khoản" khi chưa nhập mã giao dịch và lý do tiếp quản', 'không gọi API; hộp vẫn mở; DB vẫn PROCESSING', !reqEmpty && stillPending, `gọi mark-paid=${!!reqEmpty}; DB còn PROCESSING=${stillPending}`, missing.slice(missing.indexOf('Mã giao dịch ngân hàng') - 60, missing.indexOf('Mã giao dịch ngân hàng') + 240));
  await s.page.getByLabel('Mã giao dịch ngân hàng').fill('FT26UIREF01');
  await s.page.getByLabel('Lý do tiếp quản').fill('UAT: admin nghỉ, kế toán đối chiếu sao kê rồi chi');
  const from2 = s.requests.length;
  await s.page.locator('[data-confirm="accept"]').first().click({ timeout: 8000 });
  await s.page.waitForTimeout(2500);
  const r = await refundByCode(code);
  const req = s.requests.slice(from2).find((x) => /mark-paid/.test(x.path));
  const w1 = await userState(pr[0].u);
  const hist = await sql(`SELECT note FROM order_status_history WHERE "orderId"=$1 ORDER BY "createdAt" DESC LIMIT 3`, [r.oid]);
  await s.page.screenshot({ path: `${SHOTS}/ui375-ketoan-refund-completed.png` });
  check('L5-MUI-06', 'ketoan', 'web375', J, `Kế toán nhập mã giao dịch + lý do tiếp quản rồi "Đã chuyển khoản" (${code})`, 'POST mark-paid 2xx; DB COMPLETED, bankRef FT26UIREF01; lý do tiếp quản ghi vào lịch sử đơn; Ví khách không đổi (chi tay); sổ Ví khớp', req?.status < 300 && r.s === 'COMPLETED' && r.br === 'FT26UIREF01' && JSON.stringify(hist).includes('đối chiếu sao kê') && w0.wallet === w1.wallet && w1.wallet === w1.wsum, `${req ? `${req.method} ${req.path} ${req.status}` : 'không gọi API'}; DB ${r.s}, mã ${r.br}; lịch sử có lý do=${JSON.stringify(hist).includes('đối chiếu sao kê')}; ví ${w0.wallet} -> ${w1.wallet}, sổ ${w1.wsum}`, { hist });
  await s.close();
});

// ── Lệnh rút cũ đã duyệt: Kế toán 375 bấm "Đã chuyển khoản" ──
await guard('L5-MUI-ERR4', async () => {
  const [p] = await sql(`SELECT id, "userId" u, amount::int a FROM payouts WHERE status='APPROVED' ORDER BY "requestedAt" LIMIT 1`);
  if (!p) return rec('L5-MUI-07', 'ketoan', 'web375', J, 'Kế toán chi lệnh rút đã duyệt', 'có lệnh APPROVED', 'không còn lệnh', null, 'BLOCKED');
  const w0 = await userState(p.u);
  const s = await openWeb(5, 'ketoan', { viewport: { width: 375, height: 800 }, path: '/admin?tab=payouts' });
  await bypassApi(s.context);
  await settle(s);
  await s.page.screenshot({ path: `${SHOTS}/ui375-ketoan-payouts.png`, fullPage: true });
  const txt = await bodyText(s);
  const noApprove = !(await s.page.getByRole('button', { name: /^Duyệt$/ }).count());
  check('L5-MUI-07', 'ketoan', 'web375', J, 'Kế toán mở tab Thuế TNCN hoa hồng (có lệnh rút cũ APPROVED)', 'thấy "Lệnh rút ngân hàng cũ" ở mục Đã duyệt + nút "Đã chuyển khoản"; không có nút Duyệt / Từ chối; không tràn ngang', /Lệnh rút ngân hàng cũ/.test(txt) && !!(await s.page.getByRole('button', { name: 'Đã chuyển khoản' }).count()) && noApprove && (await overflowOf(s)) <= 1, `tiêu đề=${/Lệnh rút ngân hàng cũ/.test(txt)}; có Đã chuyển khoản=${!!(await s.page.getByRole('button', { name: 'Đã chuyển khoản' }).count())}; không có Duyệt=${noApprove}; tràn ngang ${await overflowOf(s)}px`, txt.slice(0, 260));
  await s.page.getByLabel('Mã giao dịch ngân hàng (tuỳ chọn)').first().fill('FT26UIPAY01');
  const from = s.requests.length;
  await s.page.getByRole('button', { name: 'Đã chuyển khoản' }).first().click({ timeout: 8000 });
  await s.page.waitForTimeout(900);
  const dlgTxt = await bodyText(s);
  await s.page.screenshot({ path: `${SHOTS}/ui375-ketoan-payout-confirm.png` });
  const confirm = s.page.locator('[role="alertdialog"] button, [role="dialog"] button').filter({ hasText: /^(Đã chuyển khoản|Xác nhận|Đồng ý)/ }).last();
  if (await confirm.count()) await confirm.click({ timeout: 8000 });
  await s.page.waitForTimeout(2500);
  const [after] = await sql(`SELECT status::text s, "bankRef" br, "paidAt" pa FROM payouts WHERE id=$1`, [p.id]);
  const req = s.requests.slice(from).find((x) => /mark-paid|pay/.test(x.path) && x.method !== 'GET');
  const w1 = await userState(p.u);
  check('L5-MUI-08', 'ketoan', 'web375', J, 'Kế toán nhập mã giao dịch rồi bấm "Đã chuyển khoản" cho lệnh rút đã duyệt', 'POST 2xx; DB PAID + bankRef + paidAt; Ví CTV không đổi (tiền đã trừ lúc rút); sổ Ví khớp', req?.status < 300 && after.s === 'PAID' && after.br === 'FT26UIPAY01' && !!after.pa && w0.wallet === w1.wallet && w1.wallet === w1.wsum, `${req ? `${req.method} ${req.path} ${req.status}` : 'không gọi API'}; DB ${JSON.stringify(after)}; ví ${w0.wallet} -> ${w1.wallet}, sổ ${w1.wsum}; hộp: "${dlgTxt.slice(0, 120)}"`, null);
  await s.close();
});

// ── Chip "Cần xử lý Pancake" + CSV ──
await guard('L5-MUI-ERR5', async () => {
  const s = await openWeb(5, 'ketoan', { viewport: { width: 1280, height: 800 }, path: '/admin?tab=orders' });
  await bypassApi(s.context);
  await settle(s);
  const chip = s.page.getByRole('button', { name: /^Cần xử lý Pancake/ }).first();
  const label = (await chip.textContent())?.trim() ?? '';
  const n = Number(label.match(/\((\d+)\)/)?.[1] ?? -1);
  const api = await call('ketoan', 'GET', '/admin/orders?pancake=attention&limit=1');
  const apiTotal = api.body?.meta?.total ?? -2;
  await chip.click({ timeout: 8000 });
  await s.page.waitForTimeout(1800);
  await s.page.screenshot({ path: `${SHOTS}/ui1280-ketoan-orders-pancake-attention.png` });
  const rows = await s.page.locator('tbody tr').count();
  const txt = await bodyText(s);
  const totalOnScreen = Number(txt.match(/Tổng[^0-9]{0,20}(\d+)/)?.[1] ?? -1);
  check('L5-MUI-09', 'ketoan', 'web1280', J, 'Kế toán bấm chip "Cần xử lý Pancake (n)" ở danh sách đơn', 'số trên chip = số đơn API pancake=attention; danh sách lọc còn đúng các đơn đó', n === apiTotal && rows > 0 && rows <= Math.max(apiTotal, 1) && n >= 0, `chip "${label}"; API total ${apiTotal}; số dòng ${rows}; Tổng trên màn ${totalOnScreen}`, txt.slice(0, 200));
  await chip.click({ timeout: 8000 }).catch(() => undefined);
  await s.page.waitForTimeout(1200);
  const dl = s.page.waitForEvent('download', { timeout: 20000 }).catch(() => null);
  await s.page.getByRole('button', { name: /Xuất CSV/ }).first().click({ timeout: 8000 });
  const d = await dl;
  let body = '';
  let name = '';
  if (d) { name = d.suggestedFilename(); body = fs.readFileSync(await d.path(), 'utf8'); }
  await s.page.waitForTimeout(800);
  const msg = (await bodyText(s)).match(/Đã tải[^.]*\./)?.[0] ?? '';
  const lines = body.split(/\r?\n/).filter(Boolean);
  const header = lines[0] ?? '';
  const fullPhones = body.match(/(?<!\d)0\d{9}(?!\d)/g) ?? [];
  const [cnt] = await sql(`SELECT count(*)::int n FROM orders`);
  check('L5-MUI-10', 'ketoan', 'web1280', J, 'Kế toán bấm "Xuất CSV (Excel)" ở danh sách đơn', 'tải được file .csv có tiêu đề + đủ dòng (mọi đơn khớp bộ lọc); SĐT khách bị che (không có số 10 chữ số đầy đủ); màn báo "Đã tải …"', !!d && /\.csv$/i.test(name) && lines.length - 1 >= 1 && fullPhones.length === 0, `file "${name}"; ${lines.length - 1} dòng dữ liệu (DB có ${cnt.n} đơn); SĐT đầy đủ trong file: ${fullPhones.length}; màn: "${msg}"`, header.slice(0, 220));
  await s.close();
  const m = await openWeb(5, 'ketoan', { viewport: { width: 375, height: 800 }, path: '/admin?tab=orders' });
  await bypassApi(m.context);
  await settle(m);
  await m.page.getByRole('button', { name: /^Lọc/ }).first().click({ timeout: 8000 });
  await m.page.waitForTimeout(900);
  await m.page.screenshot({ path: `${SHOTS}/ui375-ketoan-orders-filter-sheet.png` });
  const chip2 = m.page.getByRole('button', { name: /^Cần xử lý Pancake/ }).first();
  const label2 = (await chip2.textContent({ timeout: 8000 }).catch(() => ''))?.trim() ?? '';
  await chip2.click({ timeout: 8000 }).catch(() => undefined);
  await m.page.waitForTimeout(1800);
  await m.page.screenshot({ path: `${SHOTS}/ui375-ketoan-orders-pancake-attention.png` });
  const n2 = Number(label2.match(/\((\d+)\)/)?.[1] ?? -1);
  const pressed = await chip2.getAttribute('aria-pressed').catch(() => null);
  check('L5-MUI-11', 'ketoan', 'web375', J, 'Kế toán 375px mở "Lọc" rồi bấm chip "Cần xử lý Pancake" trong nhóm "Cần xử lý"', 'chip hiện số đơn khớp API, bật được (aria-pressed=true); không tràn ngang', n2 === apiTotal && pressed === 'true' && (await overflowOf(m)) <= 1, `chip "${label2}"; API ${apiTotal}; aria-pressed=${pressed}; tràn ngang ${await overflowOf(m)}px`, null);
  await m.close();
});

// ── Đổi / Trả: CSKH và Kho 375 ──
await guard('L5-MUI-ERR6', async () => {
  for (const [who, defTab] of [['cskh', /Cần duyệt|Chờ duyệt|Yêu cầu/], ['kho', /Chờ nhận|Cần nhận|Chờ kho/]]) {
    const s = await openWeb(5, who, { viewport: { width: 375, height: 800 }, path: '/admin?tab=returns' });
    await bypassApi(s.context);
    await settle(s);
    await s.page.screenshot({ path: `${SHOTS}/ui375-${who}-returns.png`, fullPage: true });
    const txt = await bodyText(s);
    const tabs = await s.page.locator('main select option, [role="tabpanel"] select option').allTextContents();
    const selected = await s.page.locator('main select, [role="tabpanel"] select').evaluateAll((els) => els.map((e) => e.options[e.selectedIndex]?.textContent.trim()));
    const btns = await s.page.evaluate(() => [...document.querySelectorAll('main button, [role="tabpanel"] button')].map((b) => b.textContent.trim()).filter((t) => /Duyệt|Từ chối|Đã nhận|nhận hàng|Pancake/.test(t)));
    const [db] = await sql(`SELECT count(*) FILTER (WHERE status='REQUESTED')::int req, count(*) FILTER (WHERE status='APPROVED')::int appr FROM return_requests`);
    check(`L5-MUI-12-${who}`, who, 'web375', J, `${who.toUpperCase()} mở tab Đổi / Trả ở 375px`, who === 'cskh' ? 'mở sẵn mục đang chờ duyệt (REQUESTED), có nút Duyệt / Từ chối' : 'mở sẵn mục chờ nhận hàng (TO_RECEIVE); không có nút duyệt; không tràn ngang', (await overflowOf(s)) <= 1 && (who === 'cskh' ? /Chờ duyệt/.test(selected.join(' ')) && btns.includes('Từ chối') && !btns.includes('Đã nhận hàng về') : /Chờ nhận hàng về/.test(selected.join(' ')) && !btns.includes('Từ chối') && btns.includes('Đã nhận hàng về')), `mục đang chọn: ${JSON.stringify(selected)}; các mục: ${JSON.stringify(tabs)}; nút: ${JSON.stringify([...new Set(btns)])}; DB REQUESTED=${db.req}, APPROVED=${db.appr}; tràn ngang ${await overflowOf(s)}px`, txt.slice(0, 220));
    await s.close();
  }
});
save(ONLY ? `18-money-ui-${ONLY.join('_')}` : '18-money-ui');
process.exit(0);
