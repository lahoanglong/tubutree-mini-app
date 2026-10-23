#!/usr/bin/env node
// U4-13..U4-19: nhân viên quầy (kho HCMC) và chủ đại lý nhận hàng trên Mini App thật (/recycle/desk): đếm, nhận thiếu,
// xác nhận → cộng Điểm Xanh theo bảng ×1.000; đối chiếu sổ điểm bằng SQL; gọi lại không cộng đôi; từ chối; quyền; Thu kèm đơn.
// Cần 00-setup.mjs và 10-recycle-customer.mjs đã chạy (results/recycle-state.json).
// Dùng: node 20-recycle-desk.mjs [lane] [--headed]
import fs from 'node:fs';
import { open } from '../../../tools/uat-harness/miniapp-session.mjs';
import { Case, L, call, closePrisma, ledger, ledgerRows, log, notifs, q, relShot, runCase, saveResults, shot, short, headless } from './u4-lib.mjs';

const { warehouseId, partnerId } = JSON.parse(fs.readFileSync(new URL('./results/points.json', import.meta.url), 'utf8'));
const st = JSON.parse(fs.readFileSync(new URL('./results/recycle-state.json', import.meta.url), 'utf8'));
const cases = [];

async function deskLookup(p, code) {
  const input = p.getByRole('textbox', { name: 'Mã yêu cầu hoặc mã nhận quà' });
  await input.waitFor({ timeout: 20_000 });
  await input.fill(code);
  const resp = p.waitForResponse((r) => r.url().endsWith('/api/waste/desk/lookup'), { timeout: 20_000 });
  await p.getByRole('button', { name: 'Tra mã' }).click();
  const r = await resp;
  await p.getByRole('heading', { name: code }).waitFor({ timeout: 15_000 });
  return r.status();
}

async function deskConfirm(p) {
  const resp = p.waitForResponse((r) => /\/api\/waste\/desk\/requests\/[^/]+\/confirm$/.test(r.url()), { timeout: 20_000 });
  await p.getByRole('button', { name: 'Xác nhận đã nhận' }).click();
  const r = await resp;
  const body = await r.json().catch(() => null);
  await p.getByRole('status').filter({ hasText: 'Đã ghi nhận' }).waitFor({ timeout: 15_000 }).catch(() => undefined);
  return { status: r.status(), body };
}

const lineOf = (p, itemName) => p.locator('[data-line]').filter({ hasText: itemName }).first();

async function reqRow(id) {
  const [r] = await q(
    `SELECT r.code, r.status::text, r."pointsAwarded"::int, r."dropsAwarded"::int, r."confirmedByUserId",
            (SELECT json_agg(json_build_object('item', l."itemId", 'declared', l."declaredQty", 'received', l."receivedQty", 'reason', l."shortfallReason", 'pts', l."pointsAwarded") ORDER BY l."itemId") FROM waste_request_lines l WHERE l."requestId" = r.id) AS lines
       FROM waste_requests r WHERE r.id = $1`,
    id,
  );
  return r;
}

const seeds = async (userId) => (await q(`SELECT COALESCE((SELECT "totalSeeds" FROM game_profiles WHERE "userId" = $1), 0)::int AS s`, userId))[0].s;
const monthsAhead = (d) => (new Date(d).getTime() - Date.now()) / (30.44 * 86_400_000);

// ---------- U4-13: kho HCMC, nhận thiếu hộp sữa
cases.push(
  await runCase(
    new Case('U4-13', {
      role: 'NHÂN VIÊN quầy (uat_staff) → KHÁCH (uat_returning)',
      journey: 'Quầy kho HCMC nhận hàng, nhận thiếu, cộng điểm theo bảng',
      steps: '/recycle (có dòng "Nhận hàng tại điểm") → /recycle/desk → nhập mã TR- của U4-07 → "Tra mã" → hộp sữa giảm 12 → 8, lý do "Bẩn" → "Xác nhận đã nhận"',
      expected:
        'Điểm theo số thực nhận: floor(8/5)×1.000 + 2×2.000 = 5.000 điểm, +4 giọt; sổ có đúng 1 dòng RECYCLE:<mã> +5.000 hạn 12 tháng; số dư = trước + 5.000 = SUM(delta); khách nhận tin WASTE_POINTS_CREDITED',
    }),
    async (c) => {
      const req = st.retWarehouse;
      const before = await ledger('uat_returning');
      const seedsBefore = await seeds('uat_returning');
      const s = await open(L.n, 'staff', { headless, path: '/recycle' });
      try {
        const p = s.page;
        const row = p.getByText('Nhận hàng tại điểm');
        await row.first().waitFor({ timeout: 20_000 });
        c.check('/recycle của nhân viên có dòng "Nhận hàng tại điểm"', await row.first().isVisible());
        await row.first().click();
        await p.waitForURL(/\/recycle\/desk/, { timeout: 15_000 });
        c.check('POST /waste/desk/lookup → 2xx', (await deskLookup(p, req.code)) < 300);
        const milk = lineOf(p, 'Vỏ hộp sữa sạch');
        const minus = milk.getByRole('button', { name: 'Giảm số lượng' });
        for (let i = 0; i < 4; i++) await minus.click();
        await milk.getByLabel('Lý do nhận thiếu: Vỏ hộp sữa sạch').selectOption('DIRTY');
        const prev = p.getByText('Điểm Tubu sẽ cộng cho khách: 5.000 điểm');
        await prev.waitFor({ timeout: 10_000 });
        c.check('Thanh dưới: "Điểm Tubu sẽ cộng cho khách: 5.000 điểm"', await prev.isVisible());
        await p.screenshot({ path: shot('U4-13-desk-short') });
        const cf = await deskConfirm(p);
        c.check('POST confirm → 2xx, pointsAwarded 5.000, drops 4', cf.status < 300 && cf.body?.pointsAwarded === 5000 && cf.body?.dropsAwarded === 4, { status: cf.status, body: short(cf.body, 200) });
        await p.screenshot({ path: shot('U4-13-desk-done') });
        const done = await p.getByRole('status').filter({ hasText: 'Đã ghi nhận' }).innerText().catch(() => '');
        c.check('Thẻ xong: "Đã ghi nhận. Tubu sẽ cộng 5.000 điểm cho khách"', /Tubu sẽ cộng 5\.000 điểm cho khách/.test(done), short(done.replace(/\s+/g, ' '), 200));
      } finally {
        await s.close();
      }
      const row = await reqRow(req.id);
      c.check('DB yêu cầu: COMPLETED, 5.000 điểm, hộp sữa nhận 8 lý do DIRTY', row.status === 'COMPLETED' && row.pointsAwarded === 5000 && row.lines.some((l) => l.item === 'wi-milk-carton' && l.received === 8 && l.reason === 'DIRTY'), row);
      const rows = await ledgerRows('uat_returning', `RECYCLE:${req.code}`);
      const after = await ledger('uat_returning');
      c.check('SQL: đúng 1 dòng RECYCLE:<mã> delta 5.000', rows.length === 1 && rows[0].delta === 5000, rows);
      c.check('SQL: hạn điểm ≈ 12 tháng', rows[0] && monthsAhead(rows[0].expiresAt) > 11.5 && monthsAhead(rows[0].expiresAt) < 12.5, rows[0]?.expiresAt);
      c.check('SQL: số dư = trước + 5.000 = SUM(delta)', after.balance === before.balance + 5000 && after.balance === after.ledgerSum, { before, after });
      const seedsAfter = await seeds('uat_returning');
      c.check('game_profiles.totalSeeds +4', seedsAfter === seedsBefore + 4, { seedsBefore, seedsAfter });
      const n = await notifs('uat_returning', 'WASTE_POINTS_CREDITED');
      c.check('notification_logs: WASTE_POINTS_CREDITED "Tubu đã cộng 5.000 Điểm Xanh và 4 giọt nước"', n.some((x) => x.body.includes(req.code) && /cộng 5\.000 Điểm Xanh và 4 giọt nước/.test(x.body)), n.map((x) => x.body));
      c.actual(`${req.code}: ${row.pointsAwarded} điểm, ${row.dropsAwarded} giọt; sổ ${before.balance} → ${after.balance} (SUM ${after.ledgerSum}); tin: "${n.at(-1)?.body}".`);
      c.ev(relShot('U4-13-desk-short'));
      c.ev(relShot('U4-13-desk-done'));
      c.ev(`SQL points_transactions reason=RECYCLE:${req.code} → ${short(rows.map((r) => ({ delta: r.delta, lot: r.lot, expiresAt: r.expiresAt })), 200)}`);
      c.ev(`SQL users.pointsBalance ${before.balance} → ${after.balance}, SUM(delta STANDARD) = ${after.ledgerSum}`);
    },
  ),
);

// ---------- U4-14: chủ đại lý xác nhận carton + nilon
cases.push(
  await runCase(
    new Case('U4-14', {
      role: 'Chủ đại lý (uat_ctv, OWNER điểm PARTNER) → KHÁCH (uat_returning)',
      journey: 'Đại lý nhận carton + nilon, trừ hạn mức điểm của đại lý',
      steps: '/recycle/desk bằng uat_ctv → tra mã TR- của U4-05 → giữ nguyên số khai → "Xác nhận đã nhận"',
      expected: 'Cộng 5.000 điểm cho khách (sổ RECYCLE:<mã>, số dư = SUM); hạn mức đại lý dùng 5.000/200.000, còn 195.000 hiện trên thẻ',
    }),
    async (c) => {
      const req = st.retDealer;
      const before = await ledger('uat_returning');
      const s = await open(L.n, 'ctv', { headless, path: '/recycle/desk' });
      try {
        const p = s.page;
        c.check('POST /waste/desk/lookup → 2xx', (await deskLookup(p, req.code)) < 300);
        await p.screenshot({ path: shot('U4-14-dealer-lookup') });
        const cf = await deskConfirm(p);
        c.check('POST confirm → 2xx, 5.000 điểm, quota còn 195.000', cf.status < 300 && cf.body?.pointsAwarded === 5000 && cf.body?.quota?.remaining === 195000, short(cf.body, 220));
        const done = await p.getByRole('status').filter({ hasText: 'Đã ghi nhận' }).innerText().catch(() => '');
        c.check('Thẻ xong ghi "Hạn mức còn lại: 195.000 điểm"', /Hạn mức còn lại: 195\.000 điểm/.test(done), short(done.replace(/\s+/g, ' '), 200));
        await p.screenshot({ path: shot('U4-14-dealer-done') });
      } finally {
        await s.close();
      }
      const rows = await ledgerRows('uat_returning', `RECYCLE:${req.code}`);
      const after = await ledger('uat_returning');
      const [usage] = await q(`SELECT "pointsUsed"::int FROM waste_point_usage WHERE "pointId" = $1`, partnerId);
      c.check('SQL: 1 dòng RECYCLE:<mã> +5.000', rows.length === 1 && rows[0].delta === 5000, rows);
      c.check('SQL: số dư = trước + 5.000 = SUM(delta)', after.balance === before.balance + 5000 && after.balance === after.ledgerSum, { before, after });
      c.check('SQL waste_point_usage đại lý = 5.000', usage?.pointsUsed === 5000, usage);
      c.actual(`${req.code}: +5.000; sổ ${before.balance} → ${after.balance}; hạn mức đại lý dùng ${usage?.pointsUsed}.`);
      c.ev(relShot('U4-14-dealer-done'));
      c.ev(`SQL waste_point_usage.pointsUsed = ${usage?.pointsUsed}; users.pointsBalance ${before.balance} → ${after.balance} = SUM ${after.ledgerSum}`);
    },
  ),
);

// ---------- U4-15: kho nhận kiện MAIL_IN
cases.push(
  await runCase(
    new Case('U4-15', {
      role: 'NHÂN VIÊN quầy (uat_staff) → KHÁCH (uat_returning)',
      journey: 'Kho nhận kiện gửi về (MAIL_IN) theo mã TR- trên kiện',
      steps: '/recycle/desk → tra mã TR- của U4-08 (IN_TRANSIT) → đủ 15 thùng → "Xác nhận đã nhận"',
      expected: 'Cộng 15.000 điểm (sổ RECYCLE:<mã>, số dư = SUM); yêu cầu COMPLETED; trần tháng của khách còn 60.000 − 25.000 = 35.000',
    }),
    async (c) => {
      const req = st.retMail;
      const before = await ledger('uat_returning');
      const s = await open(L.n, 'staff', { headless, path: '/recycle/desk' });
      try {
        const p = s.page;
        c.check('POST /waste/desk/lookup → 2xx', (await deskLookup(p, req.code)) < 300);
        const cf = await deskConfirm(p);
        c.check('POST confirm (match parcelCode) → 2xx, 15.000 điểm', cf.status < 300 && cf.body?.pointsAwarded === 15000, short(cf.body, 220));
        await p.screenshot({ path: shot('U4-15-mailin-done') });
      } finally {
        await s.close();
      }
      const row = await reqRow(req.id);
      const rows = await ledgerRows('uat_returning', `RECYCLE:${req.code}`);
      const after = await ledger('uat_returning');
      c.check('DB: COMPLETED', row.status === 'COMPLETED', row.status);
      c.check('SQL: 1 dòng +15.000; số dư = trước + 15.000 = SUM', rows.length === 1 && rows[0].delta === 15000 && after.balance === before.balance + 15000 && after.balance === after.ledgerSum, { rows, before, after });
      const pv = await call('POST', '/waste/preview', 'returning', { lines: [{ itemId: 'wi-carton', declaredQty: 1 }] });
      c.check('Trần tháng còn 35.000', pv.body?.pointsMonthRemaining === 35000, pv.body?.pointsMonthRemaining);
      c.actual(`${req.code}: ${row.status}, +${rows[0]?.delta}; sổ ${before.balance} → ${after.balance}; trần tháng còn ${pv.body?.pointsMonthRemaining}.`);
      c.ev(relShot('U4-15-mailin-done'));
      c.ev(`SQL RECYCLE:${req.code} → ${rows[0]?.delta}; balance ${after.balance} = SUM ${after.ledgerSum}`);
    },
  ),
);

// ---------- U4-16: gọi lại xác nhận không cộng đôi
cases.push(
  await runCase(
    new Case('U4-16', {
      role: 'NHÂN VIÊN quầy (uat_staff)',
      journey: 'Bấm xác nhận lần hai (mạng chập chờn) không cộng đôi',
      steps: 'POST /waste/desk/requests/<U4-15>/confirm lần 2 cùng số liệu; lần 3 với số khác (14)',
      expected: 'Lần 2 trả lại kết quả cũ, sổ vẫn 1 dòng, số dư không đổi; số khác → 409',
    }),
    async (c) => {
      const req = st.retMail;
      const before = await ledger('uat_returning');
      const body = { lines: [{ itemId: 'wi-carton', declaredQty: 15, receivedQty: 15 }], match: { parcelCode: req.code } };
      const again = await call('POST', `/waste/desk/requests/${req.id}/confirm`, 'staff', body);
      const diff = await call('POST', `/waste/desk/requests/${req.id}/confirm`, 'staff', { lines: [{ itemId: 'wi-carton', declaredQty: 15, receivedQty: 14, shortfallReason: 'WET' }], match: { parcelCode: req.code } });
      const rows = await ledgerRows('uat_returning', `RECYCLE:${req.code}`);
      const after = await ledger('uat_returning');
      c.check('Lần 2 → 2xx, pointsAwarded 15.000', again.ok && again.body?.pointsAwarded === 15000, { status: again.status, pts: again.body?.pointsAwarded });
      c.check('Số khác → 409', diff.status === 409, { status: diff.status, msg: diff.body?.message });
      c.check('SQL: vẫn 1 dòng, số dư không đổi', rows.length === 1 && after.balance === before.balance && after.balance === after.ledgerSum, { rows: rows.length, before, after });
      c.actual(`lần 2 → ${again.status}; số khác → ${diff.status} "${diff.body?.message}"; sổ ${rows.length} dòng, số dư ${before.balance} → ${after.balance}.`);
      c.ev(`SQL count RECYCLE:${req.code} = ${rows.length}; balance ${after.balance} = SUM ${after.ledgerSum}`);
    },
  ),
);

// ---------- U4-17: từ chối yêu cầu
cases.push(
  await runCase(
    new Case('U4-17', {
      role: 'NHÂN VIÊN quầy (uat_staff) → KHÁCH (uat_new)',
      journey: 'Quầy từ chối cả yêu cầu (hàng ướt)',
      steps: '/recycle/desk → tra mã yêu cầu kho của uat_new (carton 2) → "Từ chối cả yêu cầu" → chọn "Ướt" → "Từ chối yêu cầu"',
      expected: 'REJECTED, không cộng điểm (sổ không đổi), khách nhận tin WASTE_REQUEST_REJECTED "hàng bị ướt"',
    }),
    async (c) => {
      const req = st.newOpen[0];
      const before = await ledger('uat_new');
      const s = await open(L.n, 'staff', { headless, path: '/recycle/desk' });
      try {
        const p = s.page;
        c.check('POST /waste/desk/lookup → 2xx', (await deskLookup(p, req.code)) < 300);
        await p.getByRole('button', { name: 'Từ chối cả yêu cầu' }).click();
        await p.getByRole('radio', { name: 'Ướt' }).check();
        const resp = p.waitForResponse((r) => /\/api\/waste\/desk\/requests\/[^/]+\/reject$/.test(r.url()), { timeout: 20_000 });
        await p.getByRole('button', { name: 'Từ chối yêu cầu' }).click();
        const r = await resp;
        c.check('POST reject → 2xx', r.status() < 300, r.status());
        await p.screenshot({ path: shot('U4-17-rejected') });
      } finally {
        await s.close();
      }
      const [row] = await q(`SELECT status::text, "rejectionReason"::text FROM waste_requests WHERE id = $1`, req.id);
      const after = await ledger('uat_new');
      const n = await notifs('uat_new', 'WASTE_REQUEST_REJECTED');
      c.check('DB: REJECTED / WET', row.status === 'REJECTED' && row.rejectionReason === 'WET', row);
      c.check('Sổ điểm uat_new không đổi', after.balance === before.balance && after.ledgerSum === before.ledgerSum, { before, after });
      c.check('Tin WASTE_REQUEST_REJECTED "hàng bị ướt"', n.some((x) => x.body.includes(req.code) && x.body.includes('hàng bị ướt')), n.map((x) => x.body));
      c.actual(`${req.code} → ${row.status}/${row.rejectionReason}; sổ ${before.balance} → ${after.balance}; tin "${n.at(-1)?.body}".`);
      c.ev(relShot('U4-17-rejected'));
    },
  ),
);

// ---------- U4-18: quyền ở quầy
cases.push(
  await runCase(
    new Case('U4-18', {
      role: 'Chủ đại lý, NHÂN VIÊN, KHÁCH',
      journey: 'Quyền tra/xác nhận ở quầy',
      steps: 'uat_ctv tra mã yêu cầu ở kho; uat_staff tra mã yêu cầu ở đại lý; khách uat_new gọi /waste/desk/lookup và confirm; uat_ctv confirm yêu cầu kho',
      expected: 'Mỗi người chỉ thấy yêu cầu của điểm mình (404 "Không tìm thấy mã"); khách bị 403; đại lý không xác nhận được yêu cầu kho',
    }),
    async (c) => {
      const whReq = st.newOpen[0];
      const dealerReq = st.newOpen[1];
      const a = await call('POST', '/waste/desk/lookup', 'ctv', { code: whReq.code });
      const b = await call('POST', '/waste/desk/lookup', 'staff', { code: dealerReq.code });
      const cu = await call('POST', '/waste/desk/lookup', 'new', { code: dealerReq.code });
      const cc = await call('POST', `/waste/desk/requests/${dealerReq.id}/confirm`, 'new', { lines: [{ itemId: 'wi-bubble-wrap', declaredQty: 1, receivedQty: 1 }] });
      const dc = await call('POST', `/waste/desk/requests/${st.newOpen[0].id}/confirm`, 'ctv', { lines: [{ itemId: 'wi-carton', declaredQty: 2, receivedQty: 2 }] });
      c.check('Đại lý tra mã của kho → 404', a.status === 404, { status: a.status, msg: a.body?.message });
      c.check('Nhân viên kho tra mã của đại lý → 404', b.status === 404, { status: b.status, msg: b.body?.message });
      c.check('Khách tra mã → 403', cu.status === 403, { status: cu.status, msg: cu.body?.message });
      c.check('Khách xác nhận → 403', cc.status === 403, { status: cc.status, msg: cc.body?.message });
      c.check('Đại lý xác nhận yêu cầu kho → 403', dc.status === 403, { status: dc.status, msg: dc.body?.message });
      const after = await ledger('uat_new');
      c.check('Sổ uat_new vẫn 0', after.balance === 0 && after.ledgerSum === 0, after);
      c.actual(`đại lý→kho ${a.status}; kho→đại lý ${b.status}; khách tra ${cu.status}, xác nhận ${cc.status}; đại lý xác nhận kho ${dc.status}.`);
      c.ev(short({ a: [a.status, a.body?.message], b: [b.status, b.body?.message], cu: [cu.status, cu.body?.message], cc: [cc.status, cc.body?.message], dc: [dc.status, dc.body?.message] }, 400));
    },
  ),
);

// ---------- U4-19: Thu kèm đơn (PICKUP)
cases.push(
  await runCase(
    new Case('U4-19', {
      role: 'KHÁCH (uat_returning)',
      journey: 'Đổi rác: Thu kèm đơn mua (PICKUP) + chữ "khoảng ngày"',
      steps: 'GET /waste/me laneFlags; POST /waste/requests method PICKUP; xem mẫu tin WASTE_PICKUP_STARTED',
      expected: 'Đường Thu kèm đơn cần Gomdon (chưa có văn bản, cờ waste.lane_pickup_enabled tắt) nên không mở; mẫu tin giữ chữ "khoảng ngày"',
    }),
    async (c) => {
      const me = await call('GET', '/waste/me', 'returning');
      const pk = await call('POST', '/waste/requests', 'returning', { method: 'PICKUP', lines: [{ itemId: 'wi-carton', declaredQty: 12 }], consent: true, packagingConsent: true, postagePaidConsent: true }, { 'idempotency-key': `u4-pickup-${Date.now()}` });
      const [tpl] = await q(`SELECT "bodyTemplate" FROM notification_templates WHERE code = 'WASTE_PICKUP_STARTED'`);
      c.ev(`laneFlags ${JSON.stringify(me.body?.laneFlags)}; POST PICKUP → ${pk.status} ${short(pk.body?.message, 120)}`);
      c.ev(`notification_templates WASTE_PICKUP_STARTED: "${tpl?.bodyTemplate}"`);
      c.check('Mẫu WASTE_PICKUP_STARTED có chữ "khoảng ngày"', /khoảng ngày/.test(tpl?.bodyTemplate ?? ''), tpl?.bodyTemplate);
      c.check('Lane đóng: laneFlags.pickup=false, tạo PICKUP bị chặn', me.body?.laneFlags?.pickup === false && pk.status >= 400, { flags: me.body?.laneFlags, status: pk.status });
      c.block(
        `Không chạy được hành trình Thu kèm đơn: lane không có Gomdon (GOMDON_* rỗng) nên computeWastePublicFlags trả pickup=false; tạo PICKUP → ${pk.status} "${pk.body?.message}". Mẫu tin giữ chữ "khoảng ngày": ${/khoảng ngày/.test(tpl?.bodyTemplate ?? '') ? 'có' : 'KHÔNG'}.`,
      );
    },
  ),
);

await closePrisma();
saveResults('20-recycle-desk', cases);
log('xong');
