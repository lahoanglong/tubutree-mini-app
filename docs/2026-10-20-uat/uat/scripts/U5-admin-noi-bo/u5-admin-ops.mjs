#!/usr/bin/env node
// U5 việc vận hành của admin trên web admin thật 1440:
//   U5-40 SystemConfig đổi rồi đổi lại · U5-41 khoá/mở user · U5-42 đổi vai trò theo SĐT · U5-43 xuất CSV đơn (che SĐT với kế toán)
//   U5-44 báo cáo doanh thu (đối chiếu SQL) · U5-45 "Cần xử lý Pancake" · U5-46 "Việc cần xử lý" theo vai trò · U5-47 Tổng quan KPI
// Dùng: node u5-admin-ops.mjs [--only=U5-40,…]
import fs from 'node:fs';
import path from 'node:path';
import { L, api, apiOk, bankWebhook, brief, done, openWebSession, placeOrder, q, recorder, runCase, shot, SHOTS, waitPancake } from './u5lib.mjs';
import { mintRefresh } from '../../../tools/uat-harness/lib.mjs';

const rec = recorder('u5-admin-ops');
const only = (process.argv.find((a) => a.startsWith('--only=')) ?? '').slice(7).split(',').filter(Boolean);
const want = (id) => !only.length || only.includes(id);
const waitApi = (page, re, method = 'POST') =>
  page.waitForResponse((r) => re.test(new URL(r.url()).pathname) && r.request().method() === method, { timeout: 30_000 });
const vnToday = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);

// ---------- U5-40 SystemConfig (khoá tiền/điểm có hỏi lại) + U5-48 (khoá tiền ngoài danh sách hỏi lại)
/** Gõ giá trị vào thẻ cấu hình `key` rồi bấm Lưu. Trả {dialog: chữ hộp xác nhận hoặc null, status PUT}. Có hộp thì bấm "Lưu thay đổi". */
async function saveConfig(p, key, value) {
  const input = p.getByLabel(key, { exact: true });
  await input.waitFor({ timeout: 90_000 });
  const card = p.locator('div.rounded-card').filter({ has: input }).last();
  await input.fill(value);
  const put = waitApi(p, /\/api\/admin\/config$/, 'PUT');
  put.catch(() => undefined);
  await card.getByRole('button', { name: 'Lưu', exact: true }).click();
  const d = p.getByRole('alertdialog');
  const seen = await d.waitFor({ timeout: 4000 }).then(() => true).catch(() => false);
  let dialog = null;
  if (seen) {
    dialog = (await d.innerText()).replace(/\n+/g, ' / ');
    await d.getByRole('button', { name: 'Lưu thay đổi', exact: true }).click();
  }
  const status = (await put).status();
  await p.waitForLoadState('networkidle').catch(() => undefined);
  return { dialog, status };
}
const cfg = async (key) => (await q(`SELECT value FROM system_configs WHERE key = $1`, key))[0]?.value;
const cfgHist = (key, n) => q(`SELECT "oldValue", "newValue", "changedBy" FROM system_config_history WHERE key = $1 ORDER BY "changedAt" DESC LIMIT ${n}`, key);

if (want('U5-40')) {
  await runCase(rec, { id: 'U5-40', role: 'ADMIN', journey: 'Cấu hình: đổi một khoá điểm rồi đổi lại', steps: 'Tab Cấu hình, khoá loyalty.max_redeem_pct (trần dùng điểm 20%): gõ "abc" → Lưu; gõ 0.25 → Lưu → hộp "Xác nhận đổi cấu hình tiền/điểm" → "Lưu thay đổi"; GET /admin/config đọc lại; đổi lại 0.2 như cũ', expected: 'JSON sai: báo "JSON không hợp lệ", không gọi API; đổi 0.25 có hộp xác nhận (config-item.tsx:9,31-37), DB = 0.25, system_config_history ghi uat_admin; đổi lại: DB = 0.2, thêm một dòng lịch sử' }, async () => {
    const key = 'loyalty.max_redeem_pct';
    const before = await cfg(key);
    const s = await openWebSession('admin', '/admin?tab=config');
    let ev = '';
    const out = {};
    try {
      const p = s.page;
      const input = p.getByLabel(key, { exact: true });
      await input.waitFor({ timeout: 90_000 });
      const card = p.locator('div.rounded-card').filter({ has: input }).last();
      let calls = 0;
      p.on('request', (r) => {
        if (r.method() === 'PUT' && /\/api\/admin\/config$/.test(r.url())) calls++;
      });
      await input.fill('abc');
      await card.getByRole('button', { name: 'Lưu', exact: true }).click();
      await p.waitForTimeout(800);
      out.badJson = { calls, err: (await card.locator('.text-danger-fg').innerText().catch(() => '')).trim() };
      ev = await shot(p, 'config-badjson-admin-1440');
      out.up = await saveConfig(p, key, '0.25');
      out.mid = await cfg(key);
      const all = await apiOk('GET', '/admin/config', { user: 'admin' });
      out.read = (Array.isArray(all) ? all : (all.items ?? [])).find((x) => x.key === key)?.value;
      ev += `, ${await shot(p, 'config-changed-admin-1440')}`;
      out.back = await saveConfig(p, key, JSON.stringify(before));
    } finally {
      await s.close();
    }
    const after = await cfg(key);
    const hist = await cfgHist(key, 2);
    const ok = out.badJson.calls === 0 && /JSON không hợp lệ/.test(out.badJson.err) && /tiền\/điểm/.test(out.up.dialog ?? '') && out.up.status < 300 && Number(out.mid) === 0.25 && out.back.status < 300 && JSON.stringify(after) === JSON.stringify(before) && hist.length === 2 && hist.every((x) => x.changedBy === 'uat_admin') && Number(hist[0].newValue) === Number(before) && Number(hist[1].newValue) === 0.25;
    return {
      actual: `JSON sai: ${out.badJson.calls} lời gọi PUT, lỗi "${out.badJson.err}". Đổi 0.25: hộp "${brief(out.up.dialog, 150)}" → PUT ${out.up.status}; DB ${JSON.stringify(out.mid)}; GET /admin/config đọc ${JSON.stringify(out.read)}. Đổi lại: hộp ${out.back.dialog ? 'có' : 'không'} → PUT ${out.back.status}; DB ${JSON.stringify(after)} (trước ${JSON.stringify(before)}). Lịch sử 2 dòng mới nhất: ${brief(hist, 200)}`,
      evidence: `${ev}; SQL system_configs + system_config_history WHERE key='${key}'`,
      verdict: ok ? 'PASS' : 'FAIL',
    };
  });
}

if (want('U5-48')) {
  await runCase(rec, { id: 'U5-48', role: 'ADMIN', journey: 'Cấu hình: khoá tiền affiliate.* / coupon.* có hỏi lại như khoá tiền khác không', steps: 'Tab Cấu hình, affiliate.min_withdraw_bank (mức rút tối thiểu CTV, luật 50.000đ): gõ 60000 → Lưu; rồi coupon.staff_max_percent (trần 30%): gõ 30 → Lưu (giữ nguyên giá trị); cuối cùng trả affiliate.min_withdraw_bank về 50000', expected: 'Khoá tiền/điểm nào cũng hiện hộp "Xác nhận đổi cấu hình tiền/điểm" trước khi ghi (cùng lý do như payment./loyalty./wallet.: "Áp dụng ngay cho mọi đơn, ví và điểm"); giá trị cuối = 50000 và 30' }, async () => {
    const s = await openWebSession('admin', '/admin?tab=config');
    let ev = '';
    const out = {};
    try {
      const p = s.page;
      out.aff = await saveConfig(p, 'affiliate.min_withdraw_bank', '60000');
      out.affDb = await cfg('affiliate.min_withdraw_bank');
      ev = await shot(p, 'config-affiliate-noconfirm-admin-1440');
      out.coupon = await saveConfig(p, 'coupon.staff_max_percent', '30');
      out.restore = await saveConfig(p, 'affiliate.min_withdraw_bank', '50000');
    } finally {
      await s.close();
      if (Number(await cfg('affiliate.min_withdraw_bank')) !== 50000) await apiOk('PUT', '/admin/config', { user: 'admin', body: { key: 'affiliate.min_withdraw_bank', value: 50000 } });
    }
    const final = { aff: await cfg('affiliate.min_withdraw_bank'), coupon: await cfg('coupon.staff_max_percent') };
    const hist = await cfgHist('affiliate.min_withdraw_bank', 2);
    const asked = Boolean(out.aff.dialog) && Boolean(out.coupon.dialog);
    return {
      actual: `affiliate.min_withdraw_bank 60000: hộp xác nhận ${out.aff.dialog ? 'CÓ' : 'KHÔNG'}, PUT ${out.aff.status}, DB ngay sau ${JSON.stringify(out.affDb)}. coupon.staff_max_percent: hộp ${out.coupon.dialog ? 'CÓ' : 'KHÔNG'}, PUT ${out.coupon.status}. Trả về 50000: hộp ${out.restore.dialog ? 'CÓ' : 'KHÔNG'}, PUT ${out.restore.status}. Cuối: ${JSON.stringify(final)}; lịch sử ${brief(hist, 160)}`,
      evidence: `${ev}; SQL system_configs, system_config_history; apps/web/src/components/admin/config-item.tsx:9 (MONEY_PREFIXES chỉ có payment., loyalty., shipping., wallet., waste.)`,
      verdict: asked && Number(final.aff) === 50000 ? 'PASS' : 'FAIL',
    };
  });
}

// ---------- U5-41 khoá / mở khoá
if (want('U5-41')) {
  await runCase(rec, { id: 'U5-41', role: 'ADMIN (CSKH chỉ xem)', journey: 'Khoá rồi mở khoá tài khoản (tab Người dùng)', steps: 'CSKH mở tab Người dùng tìm 0901000005 (không có nút Khoá); ADMIN tìm 0901000005 → "Khoá" → lý do → "Khoá tài khoản"; user dùng token cũ gọi /me, đổi refresh token; ADMIN "Mở khoá"; user gọi lại', expected: 'CSKH không có nút Khoá; khoá: users.isBlocked=true, blockedById=uat_admin, có dòng user_admin_events; token cũ và refresh đều bị từ chối; mở khoá: isBlocked=false, user gọi /me 200' }, async () => {
    const phone = '0901000005';
    let ev = '';
    let cskhBtns = -1;
    let s = await openWebSession('cskh', '/admin?tab=users');
    try {
      const sb = s.page.getByLabel('Tìm theo SĐT, tên hoặc mã người dùng');
      await sb.waitFor({ timeout: 90_000 });
      await sb.fill(phone);
      await s.page.getByRole('button', { name: 'Tìm kiếm', exact: true }).last().click();
      await s.page.getByText(phone).first().waitFor({ timeout: 20_000 });
      cskhBtns = await s.page.getByRole('button', { name: /^(Khoá|Mở khoá) / }).count();
      ev = await shot(s.page, 'users-cskh-view-1440');
    } finally {
      await s.close();
    }
    const out = {};
    s = await openWebSession('admin', '/admin?tab=users');
    try {
      const p = s.page;
      const sb = p.getByLabel('Tìm theo SĐT, tên hoặc mã người dùng');
      await sb.waitFor({ timeout: 90_000 });
      await sb.fill(phone);
      await p.getByRole('button', { name: 'Tìm kiếm', exact: true }).last().click();
      await p.getByText(phone).first().waitFor({ timeout: 20_000 });
      await p.getByRole('button', { name: /^Khoá / }).first().click();
      const d = p.getByRole('alertdialog');
      await d.waitFor({ timeout: 10_000 });
      await d.getByRole('textbox').fill('UAT: thử khoá tài khoản nghi farm voucher');
      const r = waitApi(p, /\/api\/admin\/users\/[^/]+\/block$/);
      await d.getByRole('button', { name: 'Khoá tài khoản', exact: true }).click();
      out.block = (await r).status();
      await p.waitForLoadState('networkidle').catch(() => undefined);
      ev += `, ${await shot(p, 'users-admin-blocked-1440')}`;
      const [u1] = await q(`SELECT "isBlocked", "blockedById", "blockedReason" FROM users WHERE phone = $1`, phone);
      out.u1 = u1;
      out.meOld = (await api('GET', '/me', { user: 'ctv_pending' })).status;
      const rt = await mintRefresh(L, 'uat_ctv_pending');
      const rf = await fetch(`${L.apiUrl127}/auth/refresh`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken: rt }) });
      out.refresh = rf.status;
      await p.getByRole('button', { name: /^Mở khoá / }).first().click();
      const d2 = p.getByRole('alertdialog');
      await d2.waitFor({ timeout: 10_000 });
      const r2 = waitApi(p, /\/api\/admin\/users\/[^/]+\/unblock$/);
      await d2.getByRole('button', { name: 'Mở khoá', exact: true }).click();
      out.unblock = (await r2).status();
      await p.waitForLoadState('networkidle').catch(() => undefined);
    } finally {
      await s.close();
    }
    const [u2] = await q(`SELECT "isBlocked", "blockedById" FROM users WHERE phone = $1`, phone);
    await new Promise((r) => setTimeout(r, 5500));
    out.meAfter = (await api('GET', '/me', { user: 'ctv_pending' })).status;
    const evs = await q(`SELECT kind, "actorId", reason FROM user_admin_events WHERE "userId" = 'uat_ctv_pending' ORDER BY "createdAt" DESC LIMIT 2`);
    const ok = cskhBtns === 0 && out.block < 300 && out.u1.isBlocked && out.u1.blockedById === 'uat_admin' && out.meOld >= 401 && out.meOld <= 403 && out.refresh >= 400 && out.unblock < 300 && !u2.isBlocked && out.meAfter === 200 && evs.length === 2;
    return {
      actual: `CSKH: ${cskhBtns} nút Khoá/Mở khoá. Khoá → ${out.block}; DB ${brief(out.u1, 140)}; token cũ /me → ${out.meOld}; refresh → ${out.refresh}. Mở khoá → ${out.unblock}; DB isBlocked=${u2.isBlocked}; /me sau 5,5 giây → ${out.meAfter}. user_admin_events: ${brief(evs, 180)}`,
      evidence: `${ev}; SQL users.isBlocked/blockedById + user_admin_events WHERE userId='uat_ctv_pending'`,
      verdict: ok ? 'PASS' : 'FAIL',
    };
  });
}

// ---------- U5-42 đổi vai trò
if (want('U5-42')) {
  await runCase(rec, { id: 'U5-42', role: 'ADMIN', journey: 'Đổi vai trò theo SĐT (CUSTOMER → CTV → CUSTOMER)', steps: 'Tab Người dùng, khối "Cấp / đổi vai trò theo SĐT": 0901000011 + "CTV" → Cấp quyền; rồi "Khách hàng" → Cấp quyền', expected: 'users.role AFFILIATE rồi CUSTOMER; mỗi lần một dòng user_admin_events (from → to, actor uat_admin); thông báo hiện vai trò cũ → mới' }, async () => {
    const phone = '0901000011';
    const s = await openWebSession('admin', '/admin?tab=users');
    const out = {};
    let ev = '';
    try {
      const p = s.page;
      const ph = p.getByPlaceholder('SĐT (user đã mở Mini App)');
      await ph.waitFor({ timeout: 90_000 });
      const box = p.locator('div.rounded-card').filter({ has: ph }).last();
      for (const [label, role] of [['CTV', 'AFFILIATE'], ['Khách hàng', 'CUSTOMER']]) {
        await ph.fill(phone);
        await p.getByLabel('Vai trò cần cấp').selectOption({ label });
        const r = waitApi(p, /\/api\/admin\/users\/role$/);
        await box.getByRole('button', { name: 'Cấp quyền', exact: true }).click();
        const st = (await r).status();
        await p.waitForTimeout(400);
        const msg = (await box.locator('p.text-sm').innerText().catch(() => '')).trim();
        const [u] = await q(`SELECT role FROM users WHERE phone = $1`, phone);
        out[role] = { st, msg, db: u.role };
      }
      ev = await shot(p, 'users-role-admin-1440');
    } finally {
      await s.close();
    }
    const evs = await q(`SELECT kind, "fromValue", "toValue", "actorId" FROM user_admin_events WHERE "userId" = 'uat_brand' ORDER BY "createdAt" DESC LIMIT 2`);
    const ok = out.AFFILIATE.st < 300 && out.AFFILIATE.db === 'AFFILIATE' && out.CUSTOMER.st < 300 && out.CUSTOMER.db === 'CUSTOMER' && evs.length === 2 && evs.every((e) => e.actorId === 'uat_admin');
    return {
      actual: `CTV: ${out.AFFILIATE.st}, DB ${out.AFFILIATE.db}, "${out.AFFILIATE.msg}". Khách hàng: ${out.CUSTOMER.st}, DB ${out.CUSTOMER.db}, "${out.CUSTOMER.msg}". user_admin_events: ${brief(evs, 200)}`,
      evidence: `${ev}; SQL users.role + user_admin_events WHERE userId='uat_brand'`,
      verdict: ok ? 'PASS' : 'FAIL',
    };
  });
}

// ---------- U5-43 xuất CSV đơn
/** CSV RFC 4180 tối giản: ô có ngoặc kép, xuống dòng trong ô. */
function parseCsv(txt) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < txt.length; i++) {
    const ch = txt[i];
    if (quoted) {
      if (ch === '"' && txt[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && txt[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1 || r[0]);
}
const unText = (s) => String(s ?? '').replace(/^="(.*)"$/, '$1');

if (want('U5-43')) {
  await runCase(rec, { id: 'U5-43', role: 'KẾ TOÁN (so với ADMIN)', journey: 'Xuất CSV đơn hàng (tab Đơn hàng → "Xuất CSV (Excel)")', steps: 'KẾ TOÁN và ADMIN mỗi người bấm "Xuất CSV (Excel)" không lọc; đếm dòng, đọc 3 cột SĐT (khách, người nhận, CTV) và cột Ghi chú', expected: 'Số dòng = số đơn trong DB; file của kế toán chỉ còn 3 số cuối mọi SĐT (B19, admin.controller.ts:496-498), file của ADMIN đầy đủ; tổng cột "Tổng tiền (VNĐ)" = SUM(total)' }, async () => {
    const files = {};
    let ev = '';
    for (const role of ['ketoan', 'admin']) {
      const s = await openWebSession(role, '/admin?tab=orders');
      try {
        const p = s.page;
        const btn = p.getByRole('button', { name: /Xuất CSV \(Excel\)/ });
        await btn.waitFor({ timeout: 90_000 });
        await p.waitForLoadState('networkidle').catch(() => undefined);
        const dl = p.waitForEvent('download', { timeout: 60_000 });
        await btn.click();
        const f = await dl;
        const out = path.join(SHOTS, `orders-export-${role}.csv`);
        await f.saveAs(out);
        files[role] = fs.readFileSync(out, 'utf8').replace(/^﻿/, '');
        ev += `${ev ? ', ' : ''}shots/U5-admin-noi-bo/orders-export-${role}.csv`;
      } finally {
        await s.close();
      }
    }
    const look = (txt) => {
      const [head, ...rows] = parseCsv(txt);
      const phoneCols = head.map((h, i) => (/SĐT/.test(h) ? i : -1)).filter((i) => i >= 0);
      const totalCol = head.indexOf('Tổng tiền (VNĐ)');
      const vals = rows.flatMap((r) => phoneCols.map((i) => unText(r[i]))).filter(Boolean);
      return {
        head,
        rows: rows.length,
        phoneCols: phoneCols.map((i) => head[i]),
        full: vals.filter((v) => /^(\+?84|0)\d{9,10}$/.test(v)).length,
        masked: vals.filter((v) => /^\*+\d{3}$/.test(v)).length,
        other: vals.filter((v) => !/^(\+?84|0)\d{9,10}$/.test(v) && !/^\*+\d{3}$/.test(v)).slice(0, 3),
        sum: rows.reduce((a, r) => a + Number(unText(r[totalCol]) || 0), 0),
        sample: rows[0] ? phoneCols.map((i) => unText(rows[0][i])) : [],
      };
    };
    const kt = look(files.ketoan);
    const ad = look(files.admin);
    const [{ n, sum }] = await q(`SELECT COUNT(*)::int AS n, SUM(total)::bigint AS sum FROM orders`);
    const ok = kt.rows === n && ad.rows === n && kt.full === 0 && kt.masked > 0 && ad.full > 0 && ad.masked === 0 && kt.sum === sum && ad.sum === sum;
    return {
      actual: `Cột SĐT: ${kt.phoneCols.join(', ')}. KẾ TOÁN: ${kt.rows} dòng, SĐT đầy đủ ${kt.full}, SĐT che ${kt.masked} (vd ${kt.sample.join(' | ')}), tổng tiền ${kt.sum}. ADMIN: ${ad.rows} dòng, đầy đủ ${ad.full}, che ${ad.masked} (vd ${ad.sample.join(' | ')}), tổng tiền ${ad.sum}. DB: ${n} đơn, SUM(total) ${sum}${kt.other.length ? `; ô SĐT lạ ở file kế toán: ${kt.other.join(',')}` : ''}`,
      evidence: `${ev}; SQL SELECT COUNT(*), SUM(total) FROM orders`,
      verdict: ok ? 'PASS' : 'FAIL',
    };
  });
}

// ---------- U5-44 báo cáo doanh thu
if (want('U5-44')) {
  await runCase(rec, { id: 'U5-44', role: 'KẾ TOÁN', journey: 'Báo cáo doanh thu hôm nay (tab Báo cáo)', steps: 'KẾ TOÁN mở tab Báo cáo; GET /admin/reports/revenue cho hôm nay; tự tính bằng SQL: đơn theo ngày đặt giờ VN, doanh thu = tổng đơn đã thu tiền (PAID, hoặc COD đã giao) trừ hoàn một phần đã duyệt', expected: 'Số đơn, đơn huỷ/trả, doanh thu, GMV của API = SQL (luật "Doanh thu tính theo ngày đặt đơn")' }, async () => {
    const day = vnToday();
    const r = await apiOk('GET', `/admin/reports/revenue?from=${day}&to=${day}`, { user: 'ketoan' });
    const [x] = await q(
      `WITH o AS (SELECT o.*, (SELECT SUM(rr."refundAmount" + rr."shippingRefund") FROM return_requests rr WHERE rr."orderId" = o.id AND rr.status = 'APPROVED') AS refund
         FROM orders o WHERE to_char(o."createdAt" + interval '7 hours', 'YYYY-MM-DD') = $1),
       paid AS (SELECT * FROM o WHERE status NOT IN ('CANCELLED','RETURNED') AND "paymentStatus" <> 'REFUNDED' AND ("paymentStatus" = 'PAID' OR (status = 'DELIVERED' AND "paymentMethod" = 'COD' AND fulfiller <> 'MERCHANT')))
       SELECT (SELECT COUNT(*) FROM o)::int AS orders, (SELECT COUNT(*) FROM o WHERE status IN ('CANCELLED','RETURNED'))::int AS cancelled,
              (SELECT COUNT(*) FROM paid)::int AS "paidOrders", (SELECT COALESCE(SUM(total),0) FROM paid)::bigint AS gross,
              (SELECT COALESCE(SUM(refund),0) FROM paid)::bigint AS "partialRefund",
              (SELECT COALESCE(SUM(total),0) FROM o WHERE status IN ('CONFIRMED','PACKED','SHIPPING','DELIVERED'))::bigint AS gmv`,
      day,
    );
    x.revenue = x.gross - x.partialRefund;
    const tot = r.totals ?? r.total ?? r.summary ?? r;
    const keys = ['orders', 'cancelled', 'paidOrders', 'gross', 'partialRefund', 'revenue', 'gmv'];
    const diff = keys.filter((k) => Number(tot?.[k]) !== Number(x[k]));
    const s = await openWebSession('ketoan', '/admin?tab=reports');
    let ev = '';
    try {
      await s.page.getByText(/Doanh thu/).first().waitFor({ timeout: 90_000 });
      await s.page.waitForLoadState('networkidle').catch(() => undefined);
      ev = await shot(s.page, 'reports-ketoan-1440', { fullPage: true });
    } finally {
      await s.close();
    }
    return {
      actual: `API: ${brief(Object.fromEntries(keys.map((k) => [k, tot?.[k]])), 220)}. SQL: ${brief(x, 220)}${diff.length ? ` · LỆCH ${diff.join(', ')}` : ' · khớp'}`,
      evidence: `${ev}; GET /admin/reports/revenue?from=${day}&to=${day}; SQL tự tính (điều kiện REVENUE_ORDER_SQL, apps/api/src/modules/admin/admin-revenue.ts:16-20)`,
      verdict: diff.length ? 'FAIL' : 'PASS',
    };
  });
}


// ---------- U5-45 Cần xử lý Pancake
const inboxCount = async (role, key) => ((await apiOk('GET', '/admin/ops/inbox', { user: role })).items.find((i) => i.key === key)?.count ?? null);

if (want('U5-45')) {
  await runCase(rec, { id: 'U5-45', role: 'ADMIN + KHO', journey: '"Cần xử lý Pancake": khách chuyển thiếu → xử lý → rời hàng đợi', steps: 'uat_returning đặt 3×SOK-RC-1KG chuyển khoản; giả NH + Pancake ghi nhận 50.000đ đúng nội dung (thiếu); ADMIN mở trang chủ "Việc cần xử lý" → bấm mục "Cần xử lý Pancake"; KHO mở đơn → ghi chú → "Đã xử lý" → xác nhận', expected: 'Đơn vẫn PENDING_PAYMENT/UNPAID, pancakeAttention bắt đầu "Khách chuyển thiếu"; số mục +1 (ADMIN và KHO); bấm mục mở tab Đơn hàng lọc đúng đơn; "Đã xử lý": pancakeAttention null, số mục −1, ghi chú + người xử lý vào log API (admin.service.ts:1249-1266, DTO admin.controller.ts:398-401 ghi "chỉ vào log vết")' }, async () => {
    const n0 = await inboxCount('admin', 'pancakeAttention');
    const k0 = await inboxCount('kho', 'pancakeAttention');
    const o = await placeOrder('returning', { lines: [{ sku: 'SOK-RC-1KG', qty: 3 }], paymentMethod: 'BANK_TRANSFER' });
    await waitPancake(o.code);
    const bw = bankWebhook(o.code, 50000, `${o.code} chuyen truoc`);
    let att;
    for (let i = 0; i < 40; i++) {
      [att] = await q(`SELECT id, status, "paymentStatus", "pancakeAttention", "pancakePaidReported"::int AS reported FROM orders WHERE code = $1`, o.code);
      if (att.pancakeAttention) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    const n1 = await inboxCount('admin', 'pancakeAttention');
    const k1 = await inboxCount('kho', 'pancakeAttention');
    let ev = '';
    let viaInbox = false;
    let s = await openWebSession('admin', '/admin');
    try {
      const p = s.page;
      const item = p.getByRole('button', { name: /Cần xử lý Pancake/ }).first();
      await item.waitFor({ timeout: 90_000 });
      ev = await shot(p, 'inbox-admin-pancake-1440');
      await item.click();
      await p.getByText(o.code).first().waitFor({ timeout: 30_000 }).catch(() => undefined);
      viaInbox = /tab=orders/.test(p.url()) && /pancake=attention/.test(p.url()) && (await p.getByText(o.code).count()) > 0;
      ev += `, ${await shot(p, 'orders-pancake-attention-admin-1440')}`;
    } finally {
      await s.close();
    }
    const logFile = path.join(L.logDir, 'api.log');
    const logStart = fs.statSync(logFile).size;
    const note = `UAT U5-45 da goi khach ${Date.now()}`;
    s = await openWebSession('kho', '/admin?tab=orders&pancake=attention');
    let st = 0;
    try {
      const p = s.page;
      const search = p.getByPlaceholder(/Tìm mã đơn/);
      await search.waitFor({ timeout: 90_000 });
      await search.fill(o.code);
      await p.getByRole('button', { name: 'Tìm kiếm', exact: true }).click();
      const row = p.getByRole('row').filter({ hasText: o.code }).first();
      await row.waitFor({ timeout: 30_000 });
      await row.getByRole('button', { name: /Xem & Sửa/ }).click();
      const sec = p.getByRole('region', { name: 'Cần xử lý Pancake' });
      await sec.waitFor({ timeout: 20_000 });
      await sec.getByLabel('Ghi chú đã xử lý Pancake').fill(note);
      const r = waitApi(p, /\/api\/admin\/orders\/[^/]+\/pancake-attention\/resolve$/);
      await sec.getByRole('button', { name: 'Đã xử lý', exact: true }).click();
      const d = p.getByRole('alertdialog');
      await d.waitFor({ timeout: 10_000 });
      ev += `, ${await shot(p, 'orders-pancake-confirm-kho-1440')}`;
      await d.getByRole('button', { name: 'Đã xử lý', exact: true }).click();
      st = (await r).status();
      await p.waitForLoadState('networkidle').catch(() => undefined);
      ev += `, ${await shot(p, 'orders-pancake-resolved-kho-1440')}`;
    } finally {
      await s.close();
    }
    const [after] = await q(`SELECT "pancakeAttention", "pancakeAttentionAt" FROM orders WHERE code = $1`, o.code);
    const n2 = await inboxCount('admin', 'pancakeAttention');
    const fd = fs.openSync(logFile, 'r');
    const buf = Buffer.alloc(fs.statSync(logFile).size - logStart);
    fs.readSync(fd, buf, 0, buf.length, logStart);
    fs.closeSync(fd);
    const logLine = buf.toString('utf8').split('\n').find((l) => l.includes(note)) ?? '';
    const ok = att.status === 'PENDING_PAYMENT' && att.paymentStatus === 'UNPAID' && /^Khách chuyển thiếu/.test(att.pancakeAttention ?? '') && n1 === n0 + 1 && k1 === k0 + 1 && viaInbox && st < 300 && after.pancakeAttention === null && n2 === n1 - 1 && /uat_kho/.test(logLine);
    return {
      actual: `Đơn ${o.code} tổng ${o.order.total}đ; giả NH 50.000đ (${brief(bw, 80)}); đơn ${att.status}/${att.paymentStatus}, pancakePaidReported ${att.reported}, "${brief(att.pancakeAttention, 120)}". Hộp việc ADMIN ${n0}→${n1}, KHO ${k0}→${k1}; bấm mục → tab Đơn hàng lọc "Cần xử lý Pancake" có đơn: ${viaInbox}. KHO "Đã xử lý" → ${st}; pancakeAttention=${after.pancakeAttention}; hộp việc ADMIN → ${n2}. Log API: "${brief(logLine.replace(/\s+/g, ' ').trim(), 200)}"`,
      evidence: `${ev}; SQL orders.pancakeAttention/pancakePaidReported; GET /admin/ops/inbox (admin, kho); state/lane-5/logs/api.log`,
      verdict: ok ? 'PASS' : 'FAIL',
    };
  });
}

// ---------- U5-46 Việc cần xử lý theo vai trò
if (want('U5-46')) {
  await runCase(rec, { id: 'U5-46', role: 'ADMIN / KẾ TOÁN / MARKETING / CSKH / KHO / NHÂN VIÊN', journey: '"Việc cần xử lý": số mục từng vai trò so với DB', steps: 'GET /admin/ops/inbox bằng token từng vai trò; đếm bằng SQL các hàng đợi (cùng điều kiện ops-inbox.service.ts:75-121); mở trang chủ /admin từng vai trò, chụp', expected: 'Mỗi vai trò chỉ thấy mục của nhóm mình (audience ở ops-inbox.service.ts); số khớp SQL; KẾ TOÁN thấy hoàn tiền khách, và theo B18 cả hoá đơn VAT chờ xuất + rút tiền đã duyệt chờ chi (kế toán là người bấm "Đã xuất hoá đơn"/"Đã chuyển khoản")' }, async () => {
    const one = async (s) => (await q(s))[0].n;
    const sql = {
      pancakeAttention: await one(`SELECT COUNT(*)::int n FROM orders WHERE "pancakeAttentionAt" IS NOT NULL`),
      customerRefunds: await one(`SELECT COUNT(*)::int n FROM order_customer_refunds WHERE status IN ('UNVERIFIED','PENDING','PROCESSING')`),
      payouts: await one(`SELECT COUNT(*)::int n FROM payouts WHERE status = 'REQUESTED'`),
      invoicePending: await one(`SELECT COUNT(*)::int n FROM orders WHERE "invoiceStatus" IN ('REQUESTED','FAILED') AND status NOT IN ('CANCELLED','RETURNED')`),
      returnsPending: await one(`SELECT COUNT(*)::int n FROM return_requests WHERE status = 'REQUESTED'`),
      communityPending: await one(`SELECT COUNT(*)::int n FROM feed_posts WHERE status = 'PENDING'`),
    };
    const approvedPayouts = await one(`SELECT COUNT(*)::int n FROM payouts WHERE status = 'APPROVED'`);
    const per = {};
    let ev = '';
    const statusOf = {};
    for (const role of ['admin', 'ketoan', 'marketing', 'cskh', 'kho', 'staff']) {
      const r = await api('GET', '/admin/ops/inbox', { user: role });
      statusOf[role] = r.status;
      per[role] = r.ok ? Object.fromEntries(r.body.items.map((i) => [i.key, i.count])) : {};
      const s = await openWebSession(role, '/admin');
      try {
        await s.page.getByRole('heading', { name: 'Việc cần xử lý' }).first().waitFor({ timeout: 90_000 }).catch(() => undefined);
        await s.page.waitForLoadState('networkidle').catch(() => undefined);
        ev += `${ev ? ', ' : ''}${await shot(s.page, `inbox-${role}-1440`)}`;
      } finally {
        await s.close();
      }
    }
    const mism = Object.entries(sql).filter(([k, v]) => per.admin[k] !== v).map(([k, v]) => `admin.${k}=${per.admin[k]}≠SQL ${v}`);
    const AUD = { ketoan: ['customerRefunds', 'merchantToSettle', 'merchantPayoutsPending'], marketing: ['communityPending', 'communityUnanswered'], cskh: ['returnsPending', 'communityPending', 'communityUnanswered', 'externalPoints'], kho: ['pancakeAttention', 'pancakeUnsynced', 'gomdonAttention', 'returnsToReceive'] };
    const STAFF_ALL = ['wasteToCount', 'wasteUnmatched'];
    const leak = [];
    for (const [role, keys] of Object.entries(AUD)) {
      const extra = Object.keys(per[role]).filter((k) => !keys.includes(k) && !STAFF_ALL.includes(k));
      if (extra.length) leak.push(`${role}: ${extra.join(',')}`);
    }
    const staffExtra = Object.keys(per.staff).filter((k) => !STAFF_ALL.includes(k));
    if (staffExtra.length) leak.push(`staff: ${staffExtra.join(',')}`);
    const ktMissing = ['customerRefunds', 'invoicePending'].filter((k) => !(k in per.ketoan));
    const ktPayoutKey = Object.keys(per.ketoan).some((k) => /payout/i.test(k) && k !== 'merchantPayoutsPending');
    const nonOk = Object.entries(statusOf).filter(([r, st]) => r !== "staff" && st !== 200).map(([r, st]) => `${r}=${st}`);
    const fail = mism.length || leak.length || ktMissing.length || !ktPayoutKey || nonOk.length || statusOf.staff !== 403;
    return {
      actual: `SQL ${brief(sql, 220)}; payout APPROVED chờ chi ${approvedPayouts}. ADMIN ${Object.keys(per.admin).length} mục${mism.length ? `, LỆCH ${mism.join('; ')}` : ', các mục đối chiếu khớp SQL'}. KẾ TOÁN: ${brief(per.ketoan, 160)}${ktMissing.length ? ` → THIẾU ${ktMissing.join(',')}` : ''}${ktPayoutKey ? '' : ' → không có mục rút tiền chờ chi'}. MARKETING: ${Object.keys(per.marketing).join(',')}. CSKH: ${Object.keys(per.cskh).join(',')}. KHO: ${Object.keys(per.kho).join(',')}. NHÂN VIÊN (không nhóm): GET ${statusOf.staff} (đúng @AllowStaff ở ops.controller.ts:31-33, tab duy nhất là Thu gom)${nonOk.length ? `. Lỗi gọi: ${nonOk.join(",")}` : ""}${leak.length ? `. Lộ mục: ${leak.join('; ')}` : '. Không vai trò nào thấy mục ngoài nhóm'}`,
      evidence: `${ev}; GET /admin/ops/inbox theo vai trò; SQL đếm hàng đợi; ops-inbox.service.ts:100,111-112`,
      verdict: fail ? 'FAIL' : 'PASS',
      note: ktMissing.includes('invoicePending') || !ktPayoutKey ? 'Xác nhận D2-03 (chưa sửa)' : '',
    };
  });
}

// ---------- U5-47 Tổng quan KPI
if (want('U5-47')) {
  await runCase(rec, { id: 'U5-47', role: 'ADMIN', journey: 'Bảng điều khiển "Tổng quan" so với DB', steps: 'Mở /admin?tab=dashboard; GET /admin/dashboard/stats; đếm SQL: tổng đơn, chờ xử lý (PENDING_PAYMENT+CONFIRMED), đang giao (PACKED+SHIPPING), đã giao, huỷ, trả, đổi/trả chờ, COD chưa thu, dư nợ đại lý, doanh thu (REVENUE_ORDER_SQL − hoàn một phần), GMV', expected: 'Mọi số API = SQL; trang hiện cùng số' }, async () => {
    const st = await apiOk('GET', '/admin/dashboard/stats', { user: 'admin' });
    const one = async (s) => Number((await q(s))[0].n);
    const REV = `o.status NOT IN ('CANCELLED','RETURNED') AND o."paymentStatus" <> 'REFUNDED' AND (o."paymentStatus" = 'PAID' OR (o.status = 'DELIVERED' AND o."paymentMethod" = 'COD' AND o.fulfiller <> 'MERCHANT'))`;
    const sql = {
      totalOrders: await one(`SELECT COUNT(*) n FROM orders`),
      pendingOrders: await one(`SELECT COUNT(*) n FROM orders WHERE status IN ('PENDING_PAYMENT','CONFIRMED')`),
      shippingOrders: await one(`SELECT COUNT(*) n FROM orders WHERE status IN ('PACKED','SHIPPING')`),
      deliveredOrders: await one(`SELECT COUNT(*) n FROM orders WHERE status = 'DELIVERED'`),
      cancelledOrders: await one(`SELECT COUNT(*) n FROM orders WHERE status = 'CANCELLED'`),
      returnedOrders: await one(`SELECT COUNT(*) n FROM orders WHERE status = 'RETURNED'`),
      pendingReturns: await one(`SELECT COUNT(*) n FROM return_requests WHERE status = 'REQUESTED'`),
      codPendingValue: await one(`SELECT COALESCE(SUM(total),0) n FROM orders WHERE "paymentMethod" = 'COD' AND "paymentStatus" = 'UNPAID' AND status IN ('CONFIRMED','PACKED','SHIPPING')`),
      dealerDebtOutstanding: await one(`SELECT COALESCE(SUM(b),0) n FROM (SELECT SUM(delta) b FROM dealer_credit_ledgers GROUP BY "userId") x WHERE b > 0`),
      totalRevenue: await one(`SELECT (SELECT COALESCE(SUM(total),0) FROM orders o WHERE ${REV}) - (SELECT COALESCE(SUM(r."refundAmount" + r."shippingRefund"),0) FROM return_requests r JOIN orders o ON o.id = r."orderId" WHERE r.status = 'APPROVED' AND ${REV}) n`),
      gmv: await one(`SELECT COALESCE(SUM(total),0) n FROM orders WHERE status IN ('CONFIRMED','PACKED','SHIPPING','DELIVERED')`),
    };
    const diff = Object.keys(sql).filter((k) => Number(st[k]) !== sql[k]);
    const s = await openWebSession('admin', '/admin?tab=dashboard');
    let ev = '';
    let onPage = [];
    try {
      const p = s.page;
      await p.waitForResponse((r) => /\/api\/admin\/dashboard\/stats$/.test(new URL(r.url()).pathname), { timeout: 90_000 }).catch(() => undefined);
      await p.waitForLoadState('networkidle').catch(() => undefined);
      await p.waitForTimeout(800);
      const body = (await p.locator('main').innerText().catch(() => p.locator('body').innerText())).replace(/\s+/g, ' ');
      const fmt = (n) => new Intl.NumberFormat('vi-VN').format(n);
      onPage = ['totalOrders', 'totalRevenue', 'dealerDebtOutstanding', 'codPendingValue'].map((k) => `${k}:${body.includes(fmt(sql[k])) || body.includes(String(sql[k]))}`);
      ev = await shot(p, 'dashboard-admin-1440', { fullPage: true });
    } finally {
      await s.close();
    }
    return {
      actual: `API ${brief(Object.fromEntries(Object.keys(sql).map((k) => [k, st[k]])), 260)} · SQL ${diff.length ? `LỆCH ${diff.map((k) => `${k} API ${st[k]} ≠ SQL ${sql[k]}`).join('; ')}` : 'khớp mọi khoá'} · số SQL có trên trang: ${onPage.join(', ')}`,
      evidence: `${ev}; GET /admin/dashboard/stats; SQL đếm (điều kiện admin.service.ts:734-820, admin-revenue.ts:16-20)`,
      verdict: diff.length ? 'FAIL' : 'PASS',
    };
  });
}

rec.save();
await done();
