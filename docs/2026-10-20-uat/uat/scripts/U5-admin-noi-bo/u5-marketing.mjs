#!/usr/bin/env node
// U5 marketing trên web admin thật 1440:
//   U5-30 tạo lô thẻ hộp hàng sàn (UI) · U5-31 trần mã nhân viên trên form (UI) · U5-32 trần mã qua API (mọi cạnh + ngân sách ngày)
//   U5-33 mẫu thông báo: chặn dãy 8 số / link ngoài / ngày đủ, sửa hợp lệ rồi trả lại (UI) · U5-34 mẫu đơn hàng/tiền: marketing bị chặn
//   U5-35 flash sale: marketing đặt giá giảm 90% (đối chiếu D2-01)
// Dùng: node u5-marketing.mjs [--only=U5-30,…]
import fs from 'node:fs';
import path from 'node:path';
import { api, apiOk, brief, done, exec, openWebSession, q, recorder, runCase, shot, SHOTS } from './u5lib.mjs';

const rec = recorder('u5-marketing');
const only = (process.argv.find((a) => a.startsWith('--only=')) ?? '').slice(7).split(',').filter(Boolean);
const want = (id) => !only.length || only.includes(id);
const tag = String(Date.now() % 1e6);
const dayKey = (d) => new Date(d.getTime() + 7 * 3600e3).toISOString().slice(0, 10);
const iso = (days) => new Date(Date.now() + days * 864e5).toISOString();

// Ngân sách 10 triệu/ngày của nhân viên cộng dồn mã + flash sale tạo trong ngày (coupon-input-rules.ts:143-171). U5-32 cố ý dùng hết,
// nên chạy lại trên cùng lane trong ngày sẽ hết ngân sách trước khi tới U5-30/U5-32. Lùi ngày tạo của dữ liệu lần trước để mỗi lần chạy bắt đầu từ ngân sách đầy.
await exec(`UPDATE coupons SET "createdAt" = "createdAt" - interval '2 days' WHERE "createdById" = 'uat_marketing' AND "createdAt" > now() - interval '1 day'`);
await exec(`UPDATE flash_sales SET "createdAt" = "createdAt" - interval '2 days' WHERE "createdBy" = 'uat_marketing' AND "createdAt" > now() - interval '1 day'`);

// ---------- U5-30 lô thẻ hộp hàng sàn
if (want('U5-30')) {
  await runCase(rec, { id: 'U5-30', role: 'MARKETING', journey: 'Tạo lô thẻ hộp hàng sàn (Voucher → Thẻ hộp hàng sàn)', steps: 'Tiền tố UATL5, 5 thẻ, Giảm tiền 30.000đ, đơn tối thiểu 199.000đ, hết hạn hôm nay+60 ngày, "Chỉ khách mới" → "Tạo lô và tải CSV"; khách mới (uat_new_nophone, 0 đơn) áp 1 mã vào giỏ 237.000đ, khách cũ áp mã khác', expected: 'Luật đã chốt: 30.000đ, đơn từ 199.000đ, hạn 60 ngày, chỉ khách mới, mỗi thẻ một mã (usageLimit 1, perUserLimit 1); file CSV tải về có 5 mã; createdById = uat_marketing; khách cũ bị từ chối' }, async () => {
    const s = await openWebSession('marketing', '/admin?tab=coupons');
    let ev = '';
    let csv = '';
    let st = 0;
    let defaultHint = '';
    try {
      const p = s.page;
      const panel = p.getByRole('region', { name: 'Thẻ hộp hàng sàn' });
      await panel.waitFor({ timeout: 90_000 });
      defaultHint = (await panel.innerText()).match(/Bỏ trống = \d+ ngày[^.]*/)?.[0] ?? '';
      const prefix = `UATL5${tag.slice(-3)}`.slice(0, 16);
      await panel.getByLabel('Tiền tố lô').fill(prefix);
      await panel.getByLabel('Số thẻ').fill('5');
      await panel.getByLabel('Loại ưu đãi').selectOption('AMOUNT');
      await panel.getByLabel('Mức giảm').fill('30000');
      await panel.getByLabel('Đơn tối thiểu').fill('199000');
      await panel.getByLabel('Thẻ hết hạn ngày').fill(dayKey(new Date(Date.now() + 60 * 864e5)));
      const dl = p.waitForEvent('download', { timeout: 30_000 });
      const r = p.waitForResponse((x) => /\/api\/admin\/coupon-batches$/.test(new URL(x.url()).pathname) && x.request().method() === 'POST', { timeout: 30_000 });
      await panel.getByRole('button', { name: /Tạo lô và tải CSV/ }).click();
      const d = p.getByRole('alertdialog');
      if (await d.isVisible({ timeout: 2500 }).catch(() => false)) await d.getByRole('button').last().click();
      st = (await r).status();
      const file = await dl;
      const out = path.join(SHOTS, `coupon-batch-${prefix}.csv`);
      await file.saveAs(out);
      csv = fs.readFileSync(out, 'utf8');
      await p.waitForLoadState('networkidle').catch(() => undefined);
      ev = await shot(p, 'coupon-batch-marketing-1440');
      const rows = await q(`SELECT code, type, value::int, "minOrder"::int, "usageLimit", "perUserLimit", "newCustomerOnly", "createdById", "startAt", "endAt" FROM coupons WHERE code LIKE $1 ORDER BY code`, `${prefix}-%`);
      const days = rows[0] ? Math.round((new Date(rows[0].endAt) - Date.now()) / 864e5) : null;
      const csvCodes = csv.split(/\r?\n/).filter((l) => l.includes(prefix)).length;
      // khách mới áp mã, khách cũ áp mã khác (cần giỏ ≥ 199.000đ)
      // uat_new đã có đơn từ các ca trước (U5-10, U5-15) nên không còn là khách mới: dùng uat_new_nophone (0 đơn).
      const [nOrders] = await q(`SELECT COUNT(*)::int AS n FROM orders WHERE "userId" = 'uat_new_nophone' AND status <> 'CANCELLED'`);
      const cartNew = await api('GET', '/cart', { user: 'new_nophone' });
      for (const it of cartNew.body?.items ?? []) await api('DELETE', `/cart/items/${it.id}`, { user: 'new_nophone' });
      const [v] = await q(`SELECT id FROM variations WHERE sku = 'COBOTE-PW-100'`);
      await api('POST', '/cart/items', { user: 'new_nophone', body: { variationId: v.id, quantity: 3, addSource: 'pdp' } }).then((r) => { if (!r.ok) throw new Error(`thêm giỏ ${r.status} ${brief(r.body)}`); });
      const applyNew = await api('POST', '/cart/coupon', { user: 'new_nophone', body: { code: rows[0]?.code } });
      await api('DELETE', '/cart/coupon', { user: 'new_nophone' });
      const cartR = await api('GET', '/cart', { user: 'returning' });
      for (const it of cartR.body?.items ?? []) await api('DELETE', `/cart/items/${it.id}`, { user: 'returning' });
      await api('POST', '/cart/items', { user: 'returning', body: { variationId: v.id, quantity: 3, addSource: 'pdp' } });
      const applyOld = await api('POST', '/cart/coupon', { user: 'returning', body: { code: rows[1]?.code } });
      const ok = st < 300 && rows.length === 5 && rows.every((x) => x.type === 'AMOUNT' && x.value === 30000 && x.minOrder === 199000 && x.usageLimit === 1 && x.perUserLimit === 1 && x.newCustomerOnly && x.createdById === 'uat_marketing') && days >= 59 && days <= 61 && csvCodes === 5 && applyNew.status < 300 && applyOld.status === 400;
      return {
        actual: `POST coupon-batches → ${st}; DB ${rows.length} mã ${brief(rows[0], 200)}; hạn còn ${days} ngày; CSV ${csvCodes} dòng mã. Khách mới (uat_new_nophone, ${nOrders.n} đơn) áp ${rows[0]?.code} → ${applyNew.status}${applyNew.status >= 400 ? ` ${brief(applyNew.body?.message, 90)}` : ''}; khách cũ áp ${rows[1]?.code} → ${applyOld.status} ${brief(applyOld.body?.message, 90)}. Gợi ý form: "${defaultHint}"`,
        evidence: `${ev}, shots/U5-admin-noi-bo/coupon-batch-${prefix}.csv; SQL coupons WHERE code LIKE '${prefix}-%'`,
        verdict: ok ? 'PASS' : 'FAIL',
      };
    } finally {
      await s.close();
    }
  });
}

// ---------- U5-31 trần mã trên form voucher (UI)
if (want('U5-31')) {
  await runCase(rec, { id: 'U5-31', role: 'MARKETING', journey: 'Tạo voucher vượt trần trên form web', steps: 'Form "Tạo mã giảm giá": (a) % giảm 31, giảm tối đa 50.000, 100 lượt; (b) % giảm 30, giảm tối đa 100.001; (c) Giảm tiền 100.001đ; (d) Giảm tiền 50.000đ, 1.001 lượt', expected: 'Cả 4 lần: API 403, form hiện lý do "Nhân viên tạo mã giảm tối đa…/Giảm tối đa…/Tổng lượt dùng… không quá…", không mã nào vào DB' }, async () => {
    const s = await openWebSession('marketing', '/admin?tab=coupons');
    const tries = [
      { code: `UATP31${tag}`, type: 'PERCENT', value: '31', max: '50000', usage: '100' },
      { code: `UATMX${tag}`, type: 'PERCENT', value: '30', max: '100001', usage: '100' },
      { code: `UATAM${tag}`, type: 'AMOUNT', value: '100001', max: '', usage: '10' },
      { code: `UATUS${tag}`, type: 'AMOUNT', value: '50000', max: '', usage: '1001' },
    ];
    const out = [];
    let ev = '';
    try {
      const p = s.page;
      const form = p.getByTestId('coupon-create-form');
      await form.waitFor({ timeout: 90_000 });
      for (const t of tries) {
        await form.getByLabel('Mã giảm giá', { exact: true }).fill(t.code);
        await form.getByLabel('Loại mã giảm giá', { exact: true }).selectOption(t.type);
        await form.getByPlaceholder('Giá trị').fill(t.value);
        await form.getByPlaceholder('Giảm tối đa (đ)').fill(t.max);
        await form.getByPlaceholder('Tổng lượt dùng').fill(t.usage);
        const r = p.waitForResponse((x) => /\/api\/admin\/coupons$/.test(new URL(x.url()).pathname) && x.request().method() === 'POST', { timeout: 30_000 });
        await form.getByRole('button', { name: 'Tạo mã giảm giá', exact: true }).click();
        const resp = await r;
        await p.waitForTimeout(400);
        const msg = (await form.locator('p.text-sm').last().innerText().catch(() => '')).trim();
        const [row] = await q(`SELECT code FROM coupons WHERE code = $1`, t.code);
        out.push({ code: t.code, status: resp.status(), msg, inDb: !!row });
      }
      ev = await shot(p, 'coupon-cap-form-marketing-1440');
    } finally {
      await s.close();
    }
    const ok = out.every((x) => x.status === 403 && !x.inDb && x.msg.length > 0);
    return {
      actual: out.map((x) => `${x.code}: ${x.status}, DB=${x.inDb ? 'CÓ' : 'không'}, "${brief(x.msg, 110)}"`).join(' | '),
      evidence: `${ev}; SQL SELECT code FROM coupons WHERE code IN (…)`,
      verdict: ok ? 'PASS' : 'FAIL',
    };
  });
}

// ---------- U5-32 trần mã qua API + ngân sách ngày + quyền sửa
if (want('U5-32')) {
  await runCase(rec, { id: 'U5-32', role: 'MARKETING (so với ADMIN)', journey: 'Trần mã nhân viên qua API: mọi cạnh, ngân sách 10 triệu/ngày, sửa mã của ADMIN, tự dùng mã mình tạo', steps: 'POST /admin/coupons bằng token marketing: thiếu Giảm tối đa, thiếu Tổng lượt, đúng trần 30%/100.000đ/10 lượt, đúng phần ngân sách còn lại, vượt thêm 1 mã, lô thẻ AMOUNT 100.001; PATCH mã ADMIN; marketing áp mã mình tạo; ADMIN tạo 50%/300.000đ/2.000 lượt', expected: 'Thiếu trường → 403; đúng trần → 201; đúng phần còn lại → 201, thêm 1 mã → 400 "Vượt ngân sách…"; lô vượt trần → 403; sửa mã ADMIN → 403; tự áp mã mình → bị chặn; ADMIN không bị trần → 201' }, async () => {
    const base = { startAt: iso(0), endAt: iso(30), scope: 'PUBLIC', perUserLimit: 1 };
    const res = {};
    const mk = async (k, body, user = 'marketing') => {
      const r = await api('POST', '/admin/coupons', { user, body: { ...base, ...body } });
      res[k] = { status: r.status, msg: brief(r.body?.message, 90) };
      return r;
    };
    await mk('thieuMax', { code: `UATNM${tag}`, type: 'PERCENT', value: 20, usageLimit: 10 });
    await mk('thieuLuot', { code: `UATNU${tag}`, type: 'AMOUNT', value: 20000 });
    await mk('dungTran', { code: `UATOK${tag}`, type: 'PERCENT', value: 30, maxDiscount: 100000, usageLimit: 10, minOrder: 300000 });
    const fromVn = new Date(new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10) + 'T00:00:00+07:00');
    const [u] = await q(
      `SELECT COALESCE(SUM((CASE "type" WHEN 'AMOUNT' THEN "value" WHEN 'PERCENT' THEN COALESCE("maxDiscount", 100000) ELSE 100000 END)::bigint * COALESCE("usageLimit", 1000)),0)::bigint AS used FROM coupons WHERE "createdById" = 'uat_marketing' AND "createdAt" >= $1 AND "createdAt" < $1::timestamp + interval '1 day'`,
      fromVn,
    );
    const remaining = 10_000_000 - u.used;
    let value = 0;
    let usage = 0;
    for (let k = Math.ceil(remaining / 100000); k <= 1000; k++) {
      if (remaining % k === 0 && remaining / k <= 100000) {
        value = remaining / k;
        usage = k;
        break;
      }
    }
    if (value > 0) await mk('dungNganSach', { code: `UATBG${tag}`, type: 'AMOUNT', value, usageLimit: usage, minOrder: 500000 });
    await mk('vuotNganSach', { code: `UATBX${tag}`, type: 'AMOUNT', value: 1000, usageLimit: 1, minOrder: 500000 });
    const batch = await api('POST', '/admin/coupon-batches', { user: 'marketing', body: { prefix: `UATBV${tag.slice(-3)}`, quantity: 2, type: 'AMOUNT', value: 100001, startAt: iso(0), endAt: iso(60), newCustomerOnly: true } });
    res.loVuotTran = { status: batch.status, msg: brief(batch.body?.message, 90) };
    const adm = await mk('adminKhongTran', { code: `UATAD${tag}`, type: 'PERCENT', value: 50, maxDiscount: 300000, usageLimit: 2000 }, 'admin');
    const patch = await api('PATCH', `/admin/coupons/${adm.body?.id}`, { user: 'marketing', body: { usageLimit: 5 } });
    res.suaMaAdmin = { status: patch.status, msg: brief(patch.body?.message, 90) };
    // marketing tự áp mã mình tạo
    const cart = await api('GET', '/cart', { user: 'marketing' });
    for (const it of cart.body?.items ?? []) await api('DELETE', `/cart/items/${it.id}`, { user: 'marketing' });
    const [v] = await q(`SELECT id FROM variations WHERE sku = 'COBOTE-PW-100'`);
    await api('POST', '/cart/items', { user: 'marketing', body: { variationId: v.id, quantity: 5, addSource: 'pdp' } });
    const self = await api('POST', '/cart/coupon', { user: 'marketing', body: { code: `UATOK${tag}` } });
    res.tuDungMaMinh = { status: self.status, msg: brief(self.body?.message, 90) };
    const exp = { thieuMax: 403, thieuLuot: 403, dungTran: 201, dungNganSach: 201, vuotNganSach: 400, loVuotTran: 403, adminKhongTran: 201, suaMaAdmin: 403 };
    const bad = Object.entries(exp).filter(([k, s]) => res[k]?.status !== s).map(([k, s]) => `${k} ${res[k]?.status}≠${s}`);
    if (!(res.tuDungMaMinh.status >= 400)) bad.push(`tuDungMaMinh ${res.tuDungMaMinh.status}`);
    return {
      actual: `Đã dùng hôm nay trước ca: ${u.used}đ → còn ${remaining}đ (mã đúng phần còn lại: ${value}đ × ${usage} lượt). ${Object.entries(res).map(([k, x]) => `${k}=${x.status}${x.status >= 400 ? ` "${x.msg}"` : ''}`).join('; ')}${bad.length ? ` · LỆCH: ${bad.join(', ')}` : ''}`,
      evidence: 'API POST/PATCH /admin/coupons, /admin/coupon-batches, POST /cart/coupon; SQL tổng mức giảm có thể phát ra trong ngày VN của uat_marketing (cùng công thức assertStaffDailyBudget)',
      verdict: bad.length ? 'FAIL' : 'PASS',
    };
  });
}

// ---------- U5-33 mẫu thông báo (UI)
if (want('U5-33')) {
  await runCase(rec, { id: 'U5-33', role: 'MARKETING', journey: 'Sửa mẫu thông báo khuyến mãi (WELCOME_VOUCHER) trên web', steps: 'Tab "Mẫu thông báo": thêm lần lượt "STK 1903 1234 5678", "xem https://khuyenmai-la.vn/x", "hạn 31/12/2026", "gọi 0901 234 567" → Lưu; rồi thêm " Mua ngay!" → Lưu; trả nội dung cũ → Lưu', expected: '4 lần đầu bị chặn 400 kèm lý do, DB giữ nguyên; lần sửa hợp lệ 200 và DB đổi; trả lại 200 và DB về đúng nội dung cũ; marketing chỉ thấy mẫu khuyến mãi (không thấy ORDER_*)' }, async () => {
    const [orig] = await q(`SELECT "bodyTemplate" FROM notification_templates WHERE code = 'WELCOME_VOUCHER'`);
    const s = await openWebSession('marketing', '/admin?tab=notificationTemplates');
    const out = [];
    let ev = '';
    let seesOrderTpl = null;
    let cardsSeen = 0;
    try {
      const p = s.page;
      const card = p.locator('div').filter({ hasText: 'WELCOME_VOUCHER' }).filter({ has: p.locator('textarea[name=bodyTemplate]') }).last();
      await card.waitFor({ timeout: 90_000 });
      cardsSeen = await p.locator('textarea[name=bodyTemplate]').count();
      seesOrderTpl = (await p.locator('body').innerText()).includes('ORDER_CONFIRMED');
      const ta = card.locator('textarea[name=bodyTemplate]');
      const trySave = async (label, body) => {
        await ta.fill(body);
        const r = p.waitForResponse((x) => /\/api\/admin\/notification-templates\/WELCOME_VOUCHER$/.test(new URL(x.url()).pathname) && x.request().method() === 'PATCH', { timeout: 30_000 });
        await card.getByRole('button', { name: 'Lưu', exact: true }).click();
        const resp = await r;
        await p.waitForTimeout(300);
        const msg = (await card.locator('[role=alert], [role=status]').last().innerText().catch(() => '')).trim();
        const [db] = await q(`SELECT "bodyTemplate" FROM notification_templates WHERE code = 'WELCOME_VOUCHER'`);
        out.push({ label, status: resp.status(), msg, db: db.bodyTemplate });
      };
      await trySave('8 số viết tách', `${orig.bodyTemplate} STK 1903 1234 5678`);
      await trySave('link ngoài', `${orig.bodyTemplate} xem https://khuyenmai-la.vn/x`);
      await trySave('ngày đủ', `${orig.bodyTemplate} hạn 31/12/2026`);
      await trySave('SĐT viết tách', `${orig.bodyTemplate} gọi 0901 234 567`);
      ev = await shot(p, 'template-blocked-marketing-1440');
      await trySave('hợp lệ', `${orig.bodyTemplate} Mua ngay!`);
      await trySave('trả lại', orig.bodyTemplate);
      ev += `, ${await shot(p, 'template-restored-marketing-1440')}`;
    } finally {
      await s.close();
    }
    const blocked = out.slice(0, 4);
    const ok = blocked.every((x) => x.status === 400 && x.db === orig.bodyTemplate && x.msg) && out[4].status === 200 && out[4].db.endsWith('Mua ngay!') && out[5].status === 200 && out[5].db === orig.bodyTemplate && seesOrderTpl === false;
    return {
      actual: `${out.map((x) => `${x.label}: ${x.status} "${brief(x.msg, 80)}" DB ${x.db === orig.bodyTemplate ? 'giữ nguyên' : 'ĐỔI'}`).join(' | ')}. Marketing thấy ${cardsSeen} mẫu, có ORDER_CONFIRMED: ${seesOrderTpl}`,
      evidence: `${ev}; SQL notification_templates.bodyTemplate WHERE code='WELCOME_VOUCHER' sau mỗi lần Lưu`,
      verdict: ok ? 'PASS' : 'FAIL',
    };
  });
}

// ---------- U5-34 mẫu đơn/tiền: marketing bị chặn, ADMIN sửa được
if (want('U5-34')) {
  await runCase(rec, { id: 'U5-34', role: 'MARKETING (so với ADMIN)', journey: 'Sửa mẫu đơn hàng/tiền bằng API', steps: 'PATCH /admin/notification-templates/ORDER_CANCELLED và ORDER_AWAITING_PAYMENT bằng token marketing; ADMIN thêm "STK 8386790906" vào ORDER_AWAITING_PAYMENT rồi trả lại', expected: 'Marketing → 403 (chỉ ADMIN sửa mẫu đơn/tiền); ADMIN được ghi số tài khoản thật vào mẫu (luật chặn dãy số chỉ áp cho nhân viên), trả lại đúng nội dung cũ' }, async () => {
    const [o1] = await q(`SELECT "bodyTemplate" FROM notification_templates WHERE code = 'ORDER_AWAITING_PAYMENT'`);
    const m1 = await api('PATCH', '/admin/notification-templates/ORDER_CANCELLED', { user: 'marketing', body: { bodyTemplate: 'Đơn {{order_code}} đã bị hủy.' } });
    const m2 = await api('PATCH', '/admin/notification-templates/ORDER_AWAITING_PAYMENT', { user: 'marketing', body: { bodyTemplate: `${o1.bodyTemplate} STK 8386790906` } });
    const a1 = await api('PATCH', '/admin/notification-templates/ORDER_AWAITING_PAYMENT', { user: 'admin', body: { bodyTemplate: `${o1.bodyTemplate} STK 8386790906 Techcombank` } });
    const [mid] = await q(`SELECT "bodyTemplate" FROM notification_templates WHERE code = 'ORDER_AWAITING_PAYMENT'`);
    const a2 = await api('PATCH', '/admin/notification-templates/ORDER_AWAITING_PAYMENT', { user: 'admin', body: { bodyTemplate: o1.bodyTemplate } });
    const [end] = await q(`SELECT "bodyTemplate" FROM notification_templates WHERE code = 'ORDER_AWAITING_PAYMENT'`);
    const ok = m1.status === 403 && m2.status === 403 && a1.status === 200 && mid.bodyTemplate.includes('8386790906') && a2.status === 200 && end.bodyTemplate === o1.bodyTemplate;
    return {
      actual: `Marketing ORDER_CANCELLED → ${m1.status} "${brief(m1.body?.message, 80)}"; ORDER_AWAITING_PAYMENT → ${m2.status}. ADMIN thêm STK → ${a1.status} (DB có STK: ${mid.bodyTemplate.includes('8386790906')}); trả lại → ${a2.status}, DB khớp bản cũ: ${end.bodyTemplate === o1.bodyTemplate}`,
      evidence: 'API PATCH /admin/notification-templates/:code; SQL notification_templates',
      verdict: ok ? 'PASS' : 'FAIL',
    };
  });
}

// ---------- U5-35 flash sale vượt trần (D2-01)
if (want('U5-35')) {
  await runCase(rec, { id: 'U5-35', role: 'MARKETING', journey: 'Flash sale: marketing đặt giá giảm 90% (đường vòng trần mã)', steps: 'POST /admin/flash-sales (marketing) → thêm món COBOTE-PW-100 (79.000đ) giá 7.900đ, quota 150 (≤ tồn kho), mỗi khách 150; ADMIN xoá đợt sau khi đo', expected: 'Trần đã chốt cho nhân viên là 30%/100.000đ mỗi đơn, 10 triệu/ngày: món giảm 90% × 150 suất (10,7 triệu giảm, một khách mua cả 150) phải bị chặn hoặc cần ADMIN', onError: 'FAIL' }, async () => {
    const sale = await api('POST', '/admin/flash-sales', { user: 'marketing', body: { title: `UAT L5 thử trần ${tag}`, startAt: iso(2), endAt: iso(3) } });
    const [v] = await q(`SELECT id, "retailPrice"::int AS rp, stock FROM variations WHERE sku = 'COBOTE-PW-100'`);
    // Quota ≤ tồn kho (API chặn "Quota vượt tồn kho" trước, không phải trần giá).
    const quota = Math.min(150, v.stock);
    const item = sale.ok ? await api('POST', `/admin/flash-sales/${sale.body.id}/items`, { user: 'marketing', body: { variationId: v.id, flashPrice: 7900, quota, perUserLimit: quota } }) : { status: 0, body: null };
    const [row] = sale.ok ? await q(`SELECT "flashPrice"::int, quota, "perUserLimit" FROM flash_sale_items WHERE "flashSaleId" = $1`, sale.body.id) : [];
    const del = sale.ok ? await api('DELETE', `/admin/flash-sales/${sale.body.id}`, { user: 'admin' }) : { status: 0 };
    const blocked = item.status === 403 || (item.status === 400 && !/tồn kho/i.test(item.body?.message ?? ''));
    return {
      actual: `Tạo đợt → ${sale.status}; thêm món 7.900đ (giảm ${Math.round((1 - 7900 / v.rp) * 100)}%) quota ${quota}, mỗi khách ${quota} → ${item.status} ${brief(item.body?.message ?? '', 80)}; DB ${brief(row)}; mức giảm có thể phát ra ${((v.rp - 7900) * quota).toLocaleString('vi-VN')}đ; xoá đợt (admin) → ${del.status}`,
      evidence: 'API POST /admin/flash-sales, /admin/flash-sales/:id/items; SQL flash_sale_items. Trùng D2-01 (docs/2026-10-20-uat/D2-auth-pii.md)',
      verdict: blocked ? 'PASS' : 'FAIL',
      note: 'D2-01',
    };
  });
}

rec.save();
await done();
