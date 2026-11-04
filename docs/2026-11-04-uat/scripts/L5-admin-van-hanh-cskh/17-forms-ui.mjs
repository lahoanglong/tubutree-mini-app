// Biểu mẫu admin bằng GIAO DIỆN 375: Marketing tạo mã vượt trần (thấy lỗi tiếng Việt), tạo mã đúng trần; sửa mẫu thông báo có link ngoài / dãy 8 số;
// ADMIN xem Sức khoẻ hệ thống (có cảnh báo token Zalo OA khi nạp token giả) rồi khôi phục. Dùng: node 17-forms-ui.mjs
import { L, SHOTS, ENV, check, rec, save, short, call, sql, toneProblems } from './_lib.mjs';

const WT = '/Users/longla/coding/tubutree-mini-app/.claude/worktrees/uat-1104';
const { openWeb } = await import(`${WT}/docs/2026-10-20-uat/tools/uat-harness/web-session.mjs`);
const J = 'Biểu mẫu admin (375)';
const tag = Date.now().toString(36).toUpperCase().slice(-5);
async function bypassApi(ctx) {
  await ctx.route((u) => u.href.startsWith(L.apiUrl), (route) => route.continue({ headers: { ...route.request().headers(), 'x-throttle-bypass': ENV.THROTTLE_BYPASS_TOKEN } }));
}
const settle = async (s) => { await s.page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => undefined); await s.page.waitForTimeout(900); };
const bodyText = (s) => s.page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').trim());

// ── Marketing: mã giảm giá ──
await sql(`DELETE FROM coupons WHERE code LIKE 'UATUI%' AND "createdById"='uat_marketing'`);
{
  const s = await openWeb(5, 'marketing', { viewport: { width: 375, height: 800 }, path: '/admin?tab=coupons' });
  await bypassApi(s.context);
  await settle(s);
  await s.page.getByRole('button', { name: 'Tạo mã mới' }).first().click({ timeout: 8000 });
  await s.page.waitForTimeout(600);
  await s.page.screenshot({ path: `${SHOTS}/ui375-marketing-coupon-form.png` });
  const fill = async (label, v) => s.page.getByPlaceholder(label).first().fill(String(v));
  await s.page.getByLabel('Mã giảm giá', { exact: true }).first().fill(`UATUI${tag}A`);
  await fill('Giá trị', 31);
  await fill('Giảm tối đa (đ)', 50000);
  await fill('Tổng lượt dùng', 100);
  const submit = s.page.getByRole('button', { name: 'Tạo mã giảm giá' }).first();
  const from = s.requests.length;
  await submit.click({ timeout: 8000 });
  await s.page.waitForTimeout(2000);
  await s.page.screenshot({ path: `${SHOTS}/ui375-marketing-coupon-over-cap.png` });
  const req = s.requests.slice(from).find((r) => /\/admin\/coupons$/.test(r.path) && r.method === 'POST');
  const txt = await bodyText(s);
  const [row] = await sql(`SELECT count(*)::int n FROM coupons WHERE code=$1`, [`UATUI${tag}A`]);
  const msg = txt.match(/Nhân viên tạo mã giảm tối đa[^.]*\./)?.[0] ?? '';
  check('L5-FUI-01', 'marketing', 'web375', J, 'Marketing nhập mã 31% (trần 30%) rồi bấm "Tạo mã giảm giá"', 'POST 403; màn hiện câu "Nhân viên tạo mã giảm tối đa 30%…"; không ghi DB', req?.status === 403 && msg.length > 0 && row.n === 0, `${req ? `POST ${req.status}` : 'không gọi API'}; câu trên màn: "${msg}"; ${row.n} dòng DB`, txt.slice(txt.indexOf('Tạo mã giảm giá') - 80, txt.indexOf('Tạo mã giảm giá') + 260));
  const t = toneProblems(msg);
  check('L5-FUI-01b', 'marketing', 'web375', J, 'Giọng câu báo vượt trần', 'không "Vui lòng", "chúng tôi", "..."', t.length === 0, t.join(', ') || 'sạch', msg);
  await fill('Giá trị', 25);
  const from2 = s.requests.length;
  await submit.click({ timeout: 8000 });
  await s.page.waitForTimeout(2000);
  let req2 = s.requests.slice(from2).find((r) => /\/admin\/coupons$/.test(r.path) && r.method === 'POST');
  let txt2 = await bodyText(s);
  const budgetMsg = txt2.match(/Vượt ngân sách[^]*?quản trị viên tạo\./)?.[0] ?? '';
  if (req2?.status === 400 && budgetMsg) {
    const [used] = await sql(`SELECT count(*)::int n FROM coupons WHERE "createdById"='uat_marketing' AND "createdAt" >= (date_trunc('day', now() AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh')`);
    const tb = toneProblems(budgetMsg);
    check('L5-FUI-02a', 'marketing', 'web375', J, 'Marketing nhập 25% x 100 lượt x tối đa 50.000đ (quá ngân sách ngày còn lại) rồi bấm tạo', 'POST 400; màn nêu ngân sách ngày, phần vượt và số còn lại, chỉ sang quản trị viên; không ghi DB', tb.length === 0 && (await sql(`SELECT count(*)::int n FROM coupons WHERE code=$1`, [`UATUI${tag}A`]))[0].n === 0, `POST 400; câu: "${budgetMsg}"; marketing đã tạo hôm nay ${used.n} mã`, budgetMsg);
    await fill('Tổng lượt dùng', 5);
    const from3 = s.requests.length;
    await submit.click({ timeout: 8000 });
    await s.page.waitForTimeout(2000);
    req2 = s.requests.slice(from3).find((r) => /\/admin\/coupons$/.test(r.path) && r.method === 'POST');
    txt2 = await bodyText(s);
  }
  const [row2] = await sql(`SELECT "createdById" c, value::int v, "maxDiscount"::int m, "usageLimit"::int u FROM coupons WHERE code=$1`, [`UATUI${tag}A`]);
  check('L5-FUI-02', 'marketing', 'web375', J, 'Marketing giảm lượt dùng cho vừa ngân sách ngày rồi tạo lại (25%, tối đa 50.000đ)', 'POST 2xx; màn "Đã tạo mã giảm giá!"; DB createdById = marketing, 25%, tối đa 50.000đ', req2?.status < 300 && /Đã tạo mã giảm giá/.test(txt2) && row2?.c === 'uat_marketing' && row2?.v === 25 && row2?.m === 50000, `${req2 ? `POST ${req2.status}` : 'không gọi API'}; DB ${JSON.stringify(row2)}; màn: "${txt2.slice(txt2.indexOf('Tạo mã giảm giá') - 10, txt2.indexOf('Tạo mã giảm giá') + 200).slice(0, 220)}"`, null);
  await s.page.screenshot({ path: `${SHOTS}/ui375-marketing-coupon-created.png` });
  await s.close();
}

// ── Marketing: mẫu thông báo ──
{
  const list = (await call('marketing', 'GET', '/admin/notification-templates')).body;
  const tpl = list.find((t) => t.code === 'WELCOME_VOUCHER') ?? list.find((t) => t.staffEditable);
  const orig = tpl.bodyTemplate;
  const s = await openWeb(5, 'marketing', { viewport: { width: 375, height: 800 }, path: '/admin?tab=notificationTemplates' });
  await bypassApi(s.context);
  await settle(s);
  const idx = await s.page.evaluate((b) => [...document.querySelectorAll('textarea[name="bodyTemplate"]')].findIndex((t) => t.value === b), orig);
  const ta = s.page.locator('textarea[name="bodyTemplate"]').nth(idx);
  check('L5-FUI-03', 'marketing', 'web375', J, `Marketing mở tab Mẫu thông báo, thấy mẫu ${tpl.code}`, 'có ô nội dung của mẫu, sửa được', idx >= 0 && !(await ta.isDisabled()), `vị trí ô ${idx}`, null);
  const card = ta.locator('xpath=ancestor::div[contains(@class,"rounded")][1]');
  const saveBtn = card.getByRole('button', { name: 'Lưu' }).first();
  for (const [id, add, label] of [['04', ' Nhận quà tại bit.ly/nhan-qua', 'link rút gọn'], ['05', ' Chuyển khoản STK 1234 5678', 'dãy 8 chữ số viết tách']]) {
    await ta.fill(orig + add);
    await s.page.waitForTimeout(400);
    const dis = await saveBtn.isDisabled().catch(() => null);
    let outcome = '';
    let req = null;
    const from = s.requests.length;
    if (dis === false) {
      await saveBtn.click({ timeout: 5000 });
      await s.page.waitForTimeout(1800);
      req = s.requests.slice(from).find((r) => r.method === 'PATCH' && /notification-templates/.test(r.path));
    }
    const alertTxt = await s.page.evaluate(() => [...document.querySelectorAll('[role="alert"]')].map((e) => e.textContent.trim()).join(' | '));
    const [db] = await sql(`SELECT "bodyTemplate" b FROM notification_templates WHERE code=$1`, [tpl.code]);
    outcome = `nút Lưu ${dis ? 'bị khoá' : 'mở'}; ${req ? `PATCH ${req.status}` : 'không gọi API'}; cảnh báo: "${alertTxt.slice(0, 160)}"`;
    await s.page.screenshot({ path: `${SHOTS}/ui375-marketing-template-${id}.png` });
    check(`L5-FUI-${id}`, 'marketing', 'web375', J, `Marketing thêm ${label} vào mẫu ${tpl.code} rồi bấm Lưu`, 'không lưu được (nút khoá + cảnh báo, hoặc API 400 + cảnh báo tiếng Việt); DB không đổi', db.b === orig && (dis === true || req?.status === 400) && alertTxt.length > 0, outcome, null);
  }
  await ta.fill(orig + ' Xem thêm tại tubutree.com.');
  await s.page.waitForTimeout(400);
  const from = s.requests.length;
  await saveBtn.click({ timeout: 5000 }).catch(() => undefined);
  await s.page.waitForTimeout(1800);
  const req = s.requests.slice(from).find((r) => r.method === 'PATCH' && /notification-templates/.test(r.path));
  const status = await s.page.evaluate(() => [...document.querySelectorAll('[role="status"]')].map((e) => e.textContent.trim()).join(' | '));
  check('L5-FUI-06', 'marketing', 'web375', J, 'Marketing thêm "tubutree.com" rồi Lưu', 'PATCH 2xx và có dòng báo đã lưu', req?.status < 300, `${req ? `PATCH ${req.status}` : 'không gọi API'}; trạng thái: "${status.slice(0, 120)}"`, null);
  await s.close();
  await call('admin', 'PATCH', `/admin/notification-templates/${tpl.code}`, { bodyTemplate: orig });
  const [back] = await sql(`SELECT "bodyTemplate" b FROM notification_templates WHERE code=$1`, [tpl.code]);
  check('L5-FUI-06r', 'admin', 'api', J, 'Khôi phục nội dung mẫu', 'về bản gốc', back.b === orig.trim(), back.b === orig.trim() ? 'khớp' : 'khác', null);
}

// ── Admin: Sức khoẻ hệ thống ──
{
  const soon = new Date(Date.now() + 3600e3).toISOString();
  const before = await sql(`SELECT key FROM system_configs WHERE key IN ('zalo.oa_access_token','zalo.oa_token_expires_at')`);
  await sql(`INSERT INTO system_configs (key,value,category,"updatedAt") VALUES ('zalo.oa_access_token','"uat-fake-token-0000"'::jsonb,'zalo',now()) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`);
  await sql(`INSERT INTO system_configs (key,value,category,"updatedAt") VALUES ('zalo.oa_token_expires_at',$1::jsonb,'zalo',now()) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`, [JSON.stringify(soon)]);
  for (const [w, h] of [[375, 800], [1280, 800]]) {
    const s = await openWeb(5, 'admin', { viewport: { width: w, height: h }, path: '/admin?tab=opsHealth' });
    await bypassApi(s.context);
    await settle(s);
    await s.page.screenshot({ path: `${SHOTS}/ui${w}-admin-opshealth.png`, fullPage: true });
    const txt = await bodyText(s);
    const overflow = await s.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(`L5-FUI-07-${w}`, 'admin', w === 375 ? 'web375' : 'web1280', J, 'ADMIN mở Sức khoẻ hệ thống khi token Zalo OA còn 1 giờ', 'hiện cảnh báo token Zalo OA (chỉ còn … phút) và đơn cần xử lý Pancake; không tràn ngang', /Zalo OA/.test(txt) && /chỉ còn/.test(txt) && /Pancake/.test(txt) && overflow <= 1, `Zalo OA=${/Zalo OA/.test(txt)}; "chỉ còn"=${/chỉ còn/.test(txt)}; Pancake=${/Pancake/.test(txt)}; tràn ngang ${overflow}px`, txt.slice(txt.indexOf('Token Zalo') - 20, txt.indexOf('Token Zalo') + 220));
    await s.close();
  }
  for (const k of ['zalo.oa_access_token', 'zalo.oa_token_expires_at']) if (!before.some((b) => b.key === k)) await sql(`DELETE FROM system_configs WHERE key=$1`, [k]);
  const h = await call('admin', 'GET', '/admin/ops/health');
  check('L5-FUI-07r', 'admin', 'api', J, 'Khôi phục cấu hình token Zalo', 'cảnh báo zalo.oa_token biến mất', !(h.body.problems ?? []).some((p) => p.key === 'zalo.oa_token'), `problems=${(h.body.problems ?? []).map((p) => p.key).join(',')}`, null);
}
await sql(`UPDATE coupons SET "isActive"=false WHERE code LIKE 'UATUI%'`);
save('17-forms-ui');
process.exit(0);
