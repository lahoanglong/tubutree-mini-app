#!/usr/bin/env node
// U4-05..U4-12: khách tạo yêu cầu đổi rác trên Mini App thật (mang tới điểm, gửi kiện MAIL_IN), chọn sai điểm nhận,
// sửa/huỷ yêu cầu, trần ngày/tháng/số yêu cầu mở, cổng SĐT/khách vãng lai. Cần 00-setup.mjs đã chạy.
// Dùng: node 10-recycle-customer.mjs [lane] [--headed]
import fs from 'node:fs';
import { open } from '../../../tools/uat-harness/miniapp-session.mjs';
import { Case, L, call, closePrisma, idem, log, q, relShot, runCase, saveResults, shot, short, headless } from './u4-lib.mjs';

const { warehouseId, partnerId } = JSON.parse(fs.readFileSync(new URL('./results/points.json', import.meta.url), 'utf8'));
const cases = [];
const state = {};

async function incItem(page, name, n) {
  const card = page.locator('[data-item]').filter({ hasText: name });
  await card.first().waitFor({ timeout: 20_000 });
  const plus = card.first().getByRole('button', { name: 'Tăng số lượng' });
  for (let i = 0; i < n; i++) await plus.click();
}

async function reqRow(id) {
  const [r] = await q(
    `SELECT r.id, r.code, r.method::text, r.status::text, r."pointId", r."estimatedPoints"::int, r."estimatedDrops"::int, r."trackingCode", r.carrier,
            (SELECT json_agg(json_build_object('item', l."itemId", 'qty', l."declaredQty") ORDER BY l."itemId") FROM waste_request_lines l WHERE l."requestId" = r.id) AS lines
       FROM waste_requests r WHERE r.id = $1`,
    id,
  );
  return r;
}

/** Thẻ "Mang tới điểm nhận" → "Chọn điểm nhận" → trang điểm nhận. */
async function gotoPoints(page) {
  await page.waitForURL(/step=method/, { timeout: 15_000 });
  const card = page.getByRole('radio', { name: /Mang tới điểm nhận/ });
  await card.waitFor({ timeout: 20_000 });
  await card.click();
  await page.getByRole('button', { name: /Chọn điểm nhận|Đổi điểm nhận/ }).click();
  await page.waitForURL(/\/recycle\/points/, { timeout: 15_000 });
  await page.getByRole('radiogroup', { name: 'Chọn điểm nhận' }).waitFor({ timeout: 20_000 });
}

async function createFromMethodStep(page, consents) {
  for (const t of consents) await page.getByText(t, { exact: true }).click();
  const resp = page.waitForResponse((r) => r.url().endsWith('/api/waste/requests') && r.request().method() === 'POST', { timeout: 20_000 });
  await page.getByRole('button', { name: 'Tạo yêu cầu' }).click();
  const r = await resp;
  const body = await r.json().catch(() => null);
  await page.waitForURL(/\/recycle\/r\//, { timeout: 15_000 }).catch(() => undefined);
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
  return { status: r.status(), body };
}

const CONSENT = 'Tôi đồng ý cho Tubu Tree xử lý yêu cầu này';
const PACKAGING = 'Tôi đóng gói không lẫn pin, hoá chất, vật nhọn, đồ ướt hoặc bẩn';
const POSTAGE = 'Tôi đã trả đủ cước gửi, kho từ chối kiện còn cước phải trả khi nhận';

// ---------- U4-05: mang tới đại lý: carton + nilon
cases.push(
  await runCase(
    new Case('U4-05', {
      role: 'KHÁCH (uat_returning)',
      journey: 'Đổi rác: mang tới đại lý (carton + nilon)',
      steps: '/recycle → "Đổi rác ngay" → carton +3, nilon +2 → Tiếp tục → "Mang tới điểm nhận" → "Chọn điểm nhận" → Đại lý Xanh Quận 3 → "Chọn điểm này" → tick đồng ý → "Tạo yêu cầu"',
      expected: 'Tạo yêu cầu OPEN mã TR-xxxxx tại đại lý, ước tính 3×1.000 + 2×1.000 = 5.000 điểm (bảng ×1.000); chưa cộng điểm vào sổ',
    }),
    async (c) => {
      const s = await open(L.n, 'returning', { headless, path: '/recycle' });
      try {
        const p = s.page;
        await p.getByRole('button', { name: 'Đổi rác ngay' }).click();
        await p.waitForURL(/\/recycle\/new/, { timeout: 15_000 });
        await incItem(p, 'Thùng carton cũ', 3);
        await incItem(p, 'Nilon chống sốc', 2);
        const est = p.getByText('Ước tính 5.000 điểm', { exact: true });
        await est.first().waitFor({ timeout: 15_000 });
        c.check('Bước 1 hiện "Ước tính 5.000 điểm"', await est.first().isVisible());
        await p.screenshot({ path: shot('U4-05-step1') });
        await p.getByRole('button', { name: 'Tiếp tục' }).click();
        await gotoPoints(p);
        await p.getByRole('radio', { name: /Đại lý Xanh Quận 3/ }).click();
        const choose = p.getByRole('button', { name: 'Chọn điểm này' });
        c.check('Đại lý chọn được (đủ món)', await choose.isEnabled());
        await choose.click();
        await p.waitForURL(/step=method/, { timeout: 15_000 });
        await p.screenshot({ path: shot('U4-05-method') });
        const cr = await createFromMethodStep(p, [CONSENT]);
        c.check('POST /waste/requests → 201', cr.status === 201, { status: cr.status, code: cr.body?.code, msg: cr.body?.message });
        await p.screenshot({ path: shot('U4-05-created') });
        const row = await reqRow(cr.body?.id);
        state.retDealer = row;
        c.check('DB: OPEN, DROP_OFF, điểm = đại lý, ước tính 5.000', row && row.status === 'OPEN' && row.method === 'DROP_OFF' && row.pointId === partnerId && row.estimatedPoints === 5000, row);
        c.check('Mã dạng TR-XXXXX', /^TR-[2-9A-HJKMNP-TV-Z]{5}$/.test(row?.code ?? ''), row?.code);
        const lr = await q(`SELECT count(*)::int AS n FROM points_transactions WHERE "userId"='uat_returning' AND reason LIKE 'RECYCLE:%'`);
        c.check('Sổ điểm: chưa có dòng RECYCLE (chỉ cộng khi nơi nhận xác nhận)', lr[0].n === 0, lr[0]);
        c.actual(`Tạo ${row?.code} OPEN tại đại lý, ước tính ${row?.estimatedPoints} điểm, lines ${JSON.stringify(row?.lines)}.`);
        c.ev(relShot('U4-05-step1'));
        c.ev(relShot('U4-05-created'));
        c.ev(`SQL waste_requests → ${short(row, 260)}`);
      } finally {
        await s.close();
      }
    },
  ),
);

// ---------- U4-06 + U4-07: hộp sữa / vỏ chai Tubu: đại lý không nhận, kho HCMC nhận
cases.push(
  await runCase(
    new Case('U4-06', {
      role: 'KHÁCH (uat_returning)',
      journey: 'Đổi rác: chọn sai điểm nhận cho hộp sữa + vỏ chai Tubu',
      steps: '/recycle/new: hộp sữa +12, vỏ chai Tubu +2 → Tiếp tục → Mang tới điểm nhận → Chọn điểm nhận → bấm Đại lý Xanh Quận 3; gọi thẳng POST /waste/requests pointId=đại lý',
      expected: 'Thẻ đại lý ghi "Không nhận" cạnh hộp sữa và vỏ chai Tubu, ô đại lý bị khoá, nút "Chọn điểm này" tắt; API trả 409, không tạo yêu cầu',
    }),
    async (c) => {
      const s = await open(L.n, 'returning', { headless, path: '/recycle/new' });
      try {
        const p = s.page;
        await incItem(p, 'Vỏ hộp sữa sạch', 12);
        await incItem(p, 'Vỏ chai, hộp Tubu Tree', 2);
        await p.getByText('Ước tính 6.000 điểm', { exact: true }).first().waitFor({ timeout: 15_000 });
        await p.getByRole('button', { name: 'Tiếp tục' }).click();
        await gotoPoints(p);
        const dealer = p.getByRole('radio', { name: /Đại lý Xanh Quận 3/ });
        const badge = (await dealer.innerText()).replace(/\s+/g, ' ');
        c.check('Thẻ đại lý ghi "Không nhận" cạnh hộp sữa và vỏ chai Tubu', /Vỏ hộp sữa sạch Không nhận/.test(badge) && /Vỏ chai, hộp Tubu Tree Không nhận/.test(badge), short(badge, 220));
        c.check('Ô chọn đại lý bị khoá (aria-disabled=true)', (await dealer.getAttribute('aria-disabled')) === 'true', await dealer.getAttribute('aria-disabled'));
        await dealer.click({ force: true }).catch(() => undefined);
        const choose = p.getByRole('button', { name: 'Chọn điểm này' });
        c.check('Bấm đại lý: nút "Chọn điểm này" vẫn tắt', await choose.isDisabled());
        await p.screenshot({ path: shot('U4-06-wrong-point') });
        // Kho HCMC: chọn được, tạo yêu cầu (U4-07 dùng tiếp)
        await p.getByRole('radio', { name: /Kho Tubu Tree HCM/ }).click();
        c.check('Chọn kho HCMC: nút "Chọn điểm này" bật', await choose.isEnabled());
        await choose.click();
        await p.waitForURL(/step=method/, { timeout: 15_000 });
        const cr = await createFromMethodStep(p, [CONSENT]);
        state.retWarehouseCreate = cr;
        await p.screenshot({ path: shot('U4-07-created-warehouse') });
      } finally {
        await s.close();
      }
      const before = await q(`SELECT count(*)::int AS n FROM waste_requests WHERE "userId"='uat_returning'`);
      const milk = await call('POST', '/waste/requests', 'returning', { method: 'DROP_OFF', pointId: partnerId, lines: [{ itemId: 'wi-milk-carton', declaredQty: 10 }], consent: true }, idem());
      const bottle = await call('POST', '/waste/requests', 'returning', { method: 'DROP_OFF', pointId: partnerId, lines: [{ itemId: 'wi-tubu-bottle', declaredQty: 1 }], consent: true }, idem());
      const after = await q(`SELECT count(*)::int AS n FROM waste_requests WHERE "userId"='uat_returning'`);
      c.check('API hộp sữa tại đại lý → 409', milk.status === 409, { status: milk.status, msg: milk.body?.message });
      c.check('API vỏ chai Tubu tại đại lý → 409', bottle.status === 409, { status: bottle.status, msg: bottle.body?.message });
      c.check('DB: không thêm yêu cầu', after[0].n === before[0].n, { before: before[0].n, after: after[0].n });
      c.actual(`UI khoá đại lý ("Điểm này không nhận…"); API → ${milk.status} "${milk.body?.message}" / ${bottle.status}.`);
      c.ev(relShot('U4-06-wrong-point'));
      c.ev(`POST /waste/requests {pointId: đại lý, milk 10} → ${milk.status} ${short(milk.body?.message, 140)}`);
      c.ev(`SELECT count(*) FROM waste_requests WHERE userId=uat_returning: ${before[0].n} → ${after[0].n}`);
    },
  ),
);

cases.push(
  await runCase(
    new Case('U4-07', {
      role: 'KHÁCH (uat_returning)',
      journey: 'Đổi rác: hộp sữa + vỏ chai Tubu mang tới kho HCMC',
      steps: 'Tiếp U4-06: chọn "Kho Tubu Tree HCM" → "Chọn điểm này" → tick đồng ý → "Tạo yêu cầu"',
      expected: 'Tạo yêu cầu OPEN tại kho, ước tính floor(12/5)×1.000 + 2×2.000 = 6.000 điểm, 4 giọt nước',
    }),
    async (c) => {
      const cr = state.retWarehouseCreate;
      c.check('POST /waste/requests → 201', cr?.status === 201, { status: cr?.status, msg: cr?.body?.message });
      const row = await reqRow(cr?.body?.id);
      state.retWarehouse = row;
      c.check('DB: OPEN tại kho, 6.000 điểm, 4 giọt', row && row.status === 'OPEN' && row.pointId === warehouseId && row.estimatedPoints === 6000 && row.estimatedDrops === 4, row);
      c.actual(`${row?.code} OPEN tại kho, ước tính ${row?.estimatedPoints} điểm, ${row?.estimatedDrops} giọt.`);
      c.ev(relShot('U4-07-created-warehouse'));
      c.ev(`SQL → ${short(row, 260)}`);
    },
  ),
);

// ---------- U4-08: gửi kiện MAIL_IN
cases.push(
  await runCase(
    new Case('U4-08', {
      role: 'KHÁCH (uat_returning)',
      journey: 'Đổi rác: gửi kiện về kho (MAIL_IN) + nhập mã vận đơn',
      steps:
        'API preview MAIL_IN carton 10 (dưới tối thiểu) và tạo thiếu 2 ô đồng ý; UI /recycle/new carton +15 → "Gửi về kho Tubu HCM" → tick 3 ô → Tạo yêu cầu → nhập Hãng "GHTK", Mã vận đơn → "Đã gửi"',
      expected: 'Dưới 15.000 điểm: chặn BELOW_MIN; thiếu đồng ý: 400; đủ: yêu cầu OPEN 15.000 điểm; nhập vận đơn → IN_TRANSIT, lưu mã',
    }),
    async (c) => {
      const pv = await call('POST', '/waste/preview', 'returning', { method: 'MAIL_IN', lines: [{ itemId: 'wi-carton', declaredQty: 10 }] });
      c.check('Preview carton 10 MAIL_IN → block BELOW_MIN thiếu 5.000', pv.body?.blocks?.some((b) => b.code === 'BELOW_MIN' && b.missingPoints === 5000), pv.body?.blocks);
      const noConsent = await call('POST', '/waste/requests', 'returning', { method: 'MAIL_IN', lines: [{ itemId: 'wi-carton', declaredQty: 15 }], consent: true }, idem());
      c.check('Tạo MAIL_IN thiếu 2 ô đồng ý → 400', noConsent.status === 400, { status: noConsent.status, msg: noConsent.body?.message });
      const s = await open(L.n, 'returning', { headless, path: '/recycle/new' });
      let row;
      try {
        const p = s.page;
        await incItem(p, 'Thùng carton cũ', 15);
        await p.getByText('Ước tính 15.000 điểm', { exact: true }).first().waitFor({ timeout: 15_000 });
        await p.getByRole('button', { name: 'Tiếp tục' }).click();
        await p.waitForURL(/step=method/, { timeout: 15_000 });
        const mail = p.getByRole('radio', { name: /Gửi về kho Tubu HCM/ });
        await mail.waitFor({ timeout: 20_000 });
        await mail.click();
        await p.screenshot({ path: shot('U4-08-mailin-method') });
        const cr = await createFromMethodStep(p, [CONSENT, PACKAGING, POSTAGE]);
        c.check('UI tạo MAIL_IN → 201', cr.status === 201, { status: cr.status, msg: cr.body?.message });
        row = await reqRow(cr.body?.id);
        c.check('DB: OPEN, MAIL_IN, kho, 15.000 điểm', row && row.status === 'OPEN' && row.method === 'MAIL_IN' && row.pointId === warehouseId && row.estimatedPoints === 15000, row);
        await p.screenshot({ path: shot('U4-08-mailin-created'), fullPage: true });
        await p.getByLabel('Hãng').fill('GHTK');
        await p.getByLabel('Mã vận đơn').fill('GHTKUATWASTE0001');
        const tr = p.waitForResponse((r) => /\/api\/waste\/requests\/[^/]+\/tracking$/.test(r.url()) && r.request().method() === 'PUT', { timeout: 20_000 });
        await p.getByRole('button', { name: 'Đã gửi' }).click();
        const trR = await tr;
        c.check('PUT tracking → 200', trR.status() === 200, trR.status());
        await p.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
        await p.screenshot({ path: shot('U4-08-mailin-tracking'), fullPage: true });
      } finally {
        await s.close();
      }
      const after = await reqRow(row?.id);
      state.retMail = after;
      c.check('DB: IN_TRANSIT, carrier GHTK, mã vận đơn lưu', after?.status === 'IN_TRANSIT' && after.carrier === 'GHTK' && after.trackingCode === 'GHTKUATWASTE0001', after);
      c.actual(`Preview carton 10 → BELOW_MIN; thiếu đồng ý → ${noConsent.status}; ${after?.code} tạo 15.000 điểm, sau "Đã gửi" status=${after?.status}.`);
      c.ev(relShot('U4-08-mailin-created'));
      c.ev(relShot('U4-08-mailin-tracking'));
      c.ev(`POST /waste/preview MAIL_IN carton10 → blocks ${short(pv.body?.blocks, 160)}`);
      c.ev(`SQL → ${short(after, 260)}`);
    },
  ),
);

// ---------- U4-09: sửa yêu cầu
cases.push(
  await runCase(
    new Case('U4-09', {
      role: 'KHÁCH (uat_new)',
      journey: 'Đổi rác: sửa món của yêu cầu',
      steps: 'API tạo DROP_OFF đại lý carton 2; UI /recycle/r/:id → "Sửa món" → carton +2 → "Lưu thay đổi"; sửa yêu cầu MAIL_IN đã có vận đơn (PATCH)',
      expected: 'Yêu cầu OPEN được sửa: carton 4, ước tính 4.000, có sự kiện REQUEST_EDITED; yêu cầu đã nhập vận đơn không sửa được (409)',
    }),
    async (c) => {
      const cr = await call('POST', '/waste/requests', 'new', { method: 'DROP_OFF', pointId: partnerId, lines: [{ itemId: 'wi-carton', declaredQty: 2 }], consent: true }, idem());
      c.check('Tạo DROP_OFF carton 2 → 201', cr.status === 201, { status: cr.status, msg: cr.body?.message });
      state.newEdit = cr.body;
      const s = await open(L.n, 'new', { headless, path: `/recycle/r/${cr.body.id}` });
      try {
        const p = s.page;
        await p.getByRole('button', { name: 'Sửa món' }).click();
        await p.waitForURL(/\/edit$/, { timeout: 15_000 });
        await incItem(p, 'Thùng carton cũ', 2);
        const save = p.waitForResponse((r) => r.url().endsWith(`/api/waste/requests/${cr.body.id}`) && r.request().method() === 'PATCH', { timeout: 20_000 });
        await p.getByRole('button', { name: 'Lưu thay đổi' }).click();
        const sv = await save;
        c.check('PATCH /waste/requests/:id → 200', sv.status() === 200, sv.status());
        await p.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
        await p.screenshot({ path: shot('U4-09-edited'), fullPage: true });
      } finally {
        await s.close();
      }
      const row = await reqRow(cr.body.id);
      c.check('DB: carton 4, ước tính 4.000', row.lines?.[0]?.qty === 4 && row.estimatedPoints === 4000, row);
      const [ev] = await q(`SELECT count(*)::int AS n FROM waste_events WHERE "requestId" = $1 AND kind = 'REQUEST_EDITED'`, cr.body.id);
      c.check('waste_events: có REQUEST_EDITED', ev.n === 1, ev);
      const locked = await call('PATCH', `/waste/requests/${state.retMail?.id}`, 'returning', { lines: [{ itemId: 'wi-carton', declaredQty: 16 }] });
      c.check('Sửa MAIL_IN đã có vận đơn → 409', locked.status === 409, { status: locked.status, msg: locked.body?.message });
      c.actual(`UI sửa → carton ${row.lines?.[0]?.qty}, ${row.estimatedPoints} điểm; sửa yêu cầu đã gửi kiện → ${locked.status} "${locked.body?.message}".`);
      c.ev(relShot('U4-09-edited'));
      c.ev(`SQL waste_requests → ${short(row, 200)}; waste_events REQUEST_EDITED=${ev.n}`);
    },
  ),
);

// ---------- U4-10: huỷ yêu cầu
cases.push(
  await runCase(
    new Case('U4-10', {
      role: 'KHÁCH (uat_new, uat_returning)',
      journey: 'Đổi rác: huỷ yêu cầu',
      steps: 'UI /recycle/r/:id (yêu cầu U4-09) → "Huỷ yêu cầu" → "Xác nhận huỷ"; API huỷ yêu cầu MAIL_IN đang IN_TRANSIT',
      expected: 'Yêu cầu OPEN → CANCELLED, trả lại phần trần đã giữ; yêu cầu đã gửi kiện không huỷ được (409)',
    }),
    async (c) => {
      const id = state.newEdit?.id;
      const s = await open(L.n, 'new', { headless, path: `/recycle/r/${id}` });
      try {
        const p = s.page;
        await p.getByRole('button', { name: 'Huỷ yêu cầu' }).first().click();
        const resp = p.waitForResponse((r) => r.url().endsWith(`/api/waste/requests/${id}/cancel`), { timeout: 20_000 });
        await p.getByRole('button', { name: 'Xác nhận huỷ' }).click();
        const r = await resp;
        c.check('POST cancel → 200', r.status() === 200, r.status());
        await p.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
        await p.screenshot({ path: shot('U4-10-cancelled'), fullPage: true });
      } finally {
        await s.close();
      }
      const row = await reqRow(id);
      c.check('DB: CANCELLED', row.status === 'CANCELLED', row.status);
      const pv = await call('POST', '/waste/preview', 'new', { lines: [{ itemId: 'wi-carton', declaredQty: 1 }] });
      c.check('Preview: còn đủ 60.000 điểm tháng (phần giữ đã trả)', pv.body?.pointsMonthRemaining === 60000, pv.body?.pointsMonthRemaining);
      const mail = await call('POST', `/waste/requests/${state.retMail?.id}/cancel`, 'returning');
      c.check('Huỷ MAIL_IN IN_TRANSIT → 409', mail.status === 409, { status: mail.status, msg: mail.body?.message });
      c.actual(`UI huỷ → ${row.status}; pointsMonthRemaining=${pv.body?.pointsMonthRemaining}; huỷ yêu cầu đã gửi kiện → ${mail.status} "${mail.body?.message}".`);
      c.ev(relShot('U4-10-cancelled'));
    },
  ),
);

// ---------- U4-11: trần ngày, trần tháng, số yêu cầu mở
cases.push(
  await runCase(
    new Case('U4-11', {
      role: 'KHÁCH (uat_new)',
      journey: 'Đổi rác: trần ngày, trần tháng, tối đa 3 yêu cầu mở',
      steps:
        'Preview DROP_OFF carton 11 tại đại lý; preview MAIL_IN carton 30 + vỏ chai 20; preview vỏ chai 21; tạo 3 yêu cầu (kho carton 1, đại lý nilon 1, đại lý carton 1) rồi yêu cầu thứ 4',
      expected: 'Carton/ngày 10 → ITEM_DAY_CAP; 70.000 > 60.000 điểm/tháng → POINTS_MONTH_CAP; vỏ chai/tháng 20 → ITEM_MONTH_CAP; yêu cầu thứ 4 → 409 MAX_OPEN',
    }),
    async (c) => {
      const day = await call('POST', '/waste/preview', 'new', { method: 'DROP_OFF', pointId: partnerId, lines: [{ itemId: 'wi-carton', declaredQty: 11 }] });
      c.check('carton 11 DROP_OFF → ITEM_DAY_CAP', day.body?.blocks?.some((b) => b.code === 'ITEM_DAY_CAP'), day.body?.blocks);
      const month = await call('POST', '/waste/preview', 'new', { method: 'MAIL_IN', lines: [{ itemId: 'wi-carton', declaredQty: 30 }, { itemId: 'wi-tubu-bottle', declaredQty: 20 }] });
      c.check('70.000 điểm MAIL_IN → POINTS_MONTH_CAP', month.body?.blocks?.some((b) => b.code === 'POINTS_MONTH_CAP'), { est: month.body?.estimatedPoints, blocks: month.body?.blocks });
      const bott = await call('POST', '/waste/preview', 'new', { method: 'MAIL_IN', lines: [{ itemId: 'wi-tubu-bottle', declaredQty: 21 }] });
      c.check('vỏ chai 21 → ITEM_MONTH_CAP', bott.body?.blocks?.some((b) => b.code === 'ITEM_MONTH_CAP'), bott.body?.blocks);
      const made = [];
      for (const body of [
        { method: 'DROP_OFF', pointId: warehouseId, lines: [{ itemId: 'wi-carton', declaredQty: 2 }], consent: true },
        { method: 'DROP_OFF', pointId: partnerId, lines: [{ itemId: 'wi-bubble-wrap', declaredQty: 1 }], consent: true },
        { method: 'DROP_OFF', pointId: partnerId, lines: [{ itemId: 'wi-carton', declaredQty: 1 }], consent: true },
      ]) {
        const r = await call('POST', '/waste/requests', 'new', body, idem());
        made.push({ status: r.status, id: r.body?.id, code: r.body?.code });
      }
      state.newOpen = made;
      c.check('3 yêu cầu đầu → 201', made.every((m) => m.status === 201), made);
      const fourth = await call('POST', '/waste/requests', 'new', { method: 'DROP_OFF', pointId: partnerId, lines: [{ itemId: 'wi-carton', declaredQty: 1 }], consent: true }, idem());
      c.check('yêu cầu thứ 4 → 409 tối đa 3', fourth.status === 409 && /3/.test(fourth.body?.message ?? ''), { status: fourth.status, msg: fourth.body?.message });
      const [open3] = await q(`SELECT count(*)::int AS n FROM waste_requests WHERE "userId"='uat_new' AND status IN ('OPEN','IN_TRANSIT','RECEIVED')`);
      c.check('DB: đúng 3 yêu cầu mở', open3.n === 3, open3);
      c.actual(`day=${day.body?.blocks?.map((b) => b.code)}, month=${month.body?.blocks?.map((b) => b.code)}, item month=${bott.body?.blocks?.map((b) => b.code)}; thứ 4 → ${fourth.status} "${fourth.body?.message}".`);
      c.ev(`preview blocks: ${short({ day: day.body?.blocks, month: month.body?.blocks, bottle: bott.body?.blocks }, 300)}`);
      c.ev(`SQL count yêu cầu mở uat_new = ${open3.n}`);
    },
  ),
);

// ---------- U4-12: cổng SĐT / khách vãng lai
cases.push(
  await runCase(
    new Case('U4-12', {
      role: 'KHÁCH chưa có SĐT (uat_new_nophone), khách vãng lai',
      journey: 'Đổi rác: chỉ người có tài khoản + SĐT tham gia',
      steps: 'GET /waste/me và POST /waste/requests bằng uat_new_nophone; POST /auth/guest rồi POST /waste/requests; Mini App mở /recycle bằng guest',
      expected: 'NEED_PHONE / GUEST, tạo yêu cầu → 403; khách vãng lai thấy thẻ xin đăng nhập',
    }),
    async (c) => {
      const me = await call('GET', '/waste/me', 'new_nophone');
      c.check('nophone: eligibility NEED_PHONE', me.body?.eligibility === 'NEED_PHONE', me.body?.eligibility);
      const cr = await call('POST', '/waste/requests', 'new_nophone', { method: 'DROP_OFF', pointId: partnerId, lines: [{ itemId: 'wi-carton', declaredQty: 1 }], consent: true }, idem());
      c.check('nophone: tạo → 403', cr.status === 403, { status: cr.status, msg: cr.body?.message });
      const g = await fetch(`${L.apiUrl127}/auth/guest`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ deviceId: `uat-u4-guest-${Date.now()}` }) });
      const gb = await g.json().catch(() => ({}));
      const gtok = gb.accessToken;
      const gr = gtok
        ? await fetch(`${L.apiUrl127}/waste/requests`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${gtok}`, 'idempotency-key': `u4-${Date.now()}` },
            body: JSON.stringify({ method: 'DROP_OFF', pointId: partnerId, lines: [{ itemId: 'wi-carton', declaredQty: 1 }], consent: true }),
          })
        : null;
      c.check('guest: tạo → 403', gr?.status === 403, { guestLogin: g.status, status: gr?.status });
      const s = await open(L.n, 'guest', { headless, path: '/recycle' });
      try {
        await s.page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
        await s.page.screenshot({ path: shot('U4-12-guest-recycle') });
        const txt = await s.page.evaluate(() => document.body.innerText);
        c.check('guest: trang /recycle mời đăng nhập, không có nút "Đổi rác ngay"', /Đăng nhập|đăng nhập/.test(txt) && !/Đổi rác ngay/.test(txt), short(txt.replace(/\s+/g, ' '), 200));
      } finally {
        await s.close();
      }
      c.actual(`nophone ${me.body?.eligibility}, tạo → ${cr.status} "${cr.body?.message}"; guest tạo → ${gr?.status}.`);
      c.ev(relShot('U4-12-guest-recycle'));
    },
  ),
);

fs.writeFileSync(new URL('./results/recycle-state.json', import.meta.url), JSON.stringify(state, null, 2));
await closePrisma();
saveResults('10-recycle-customer', cases);
log('state', Object.keys(state));
