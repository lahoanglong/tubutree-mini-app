#!/usr/bin/env node
// U5 tiền nội bộ trên web admin thật 1440:
//   U5-20 rút tiền CTV: KẾ TOÁN không có nút Duyệt (API 403) → ADMIN Duyệt → KẾ TOÁN "Đã chuyển khoản"
//   U5-21 hoàn tiền mua trên sàn (cashback): KẾ TOÁN "Duyệt hoàn tiền" → job settle → Ví
//   U5-22 hoá đơn VAT: KẾ TOÁN "Đã xuất hoá đơn" + hộp "Việc cần xử lý"
//   U5-23 công nợ đại lý: đơn ghi nợ → KẾ TOÁN "Xác nhận đã nhận, giảm nợ"
// Dùng: node u5-money.mjs [--only=U5-20,U5-21]
import { randomUUID } from 'node:crypto';
import { L, api, apiOk, brief, done, exec, money, openWebSession, placeOrder, q, recorder, runCase, runJob, sendOrderStatus, shot, sleep, waitPancake } from './u5lib.mjs';
import { laneEnv } from '../../../tools/uat-harness/lib.mjs';

const rec = recorder('u5-money');
const only = (process.argv.find((a) => a.startsWith('--only=')) ?? '').slice(7).split(',').filter(Boolean);
const want = (id) => !only.length || only.includes(id);
const waitApi = (page, re, method = 'POST') =>
  page.waitForResponse((r) => re.test(new URL(r.url()).pathname) && r.request().method() === method, { timeout: 30_000 });

async function openOrder(page, code) {
  const search = page.getByPlaceholder(/Tìm mã đơn/);
  await search.waitFor({ timeout: 90_000 });
  await search.fill(code);
  await page.getByRole('button', { name: 'Tìm kiếm', exact: true }).click();
  const row = page.getByRole('row').filter({ hasText: code });
  await row.first().waitFor({ timeout: 30_000 });
  await row.first().getByRole('button', { name: /Xem & Sửa/ }).click();
}

// ---------- U5-20 rút tiền CTV
if (want('U5-20')) {
  await runCase(rec, { id: 'U5-20', role: 'ADMIN + KẾ TOÁN', journey: 'Duyệt rút tiền (chỉ ADMIN) và "Đã chi" (kế toán)', steps: 'uat_returning mua qua gian hàng /s/uatctv (COD 8×FUWA-HW-500), Pancake giao xong; lùi deliveredAt/lockedAt 11 ngày, chạy commissions.approve-due; CTV rút hết về ngân hàng; KẾ TOÁN mở tab rút tiền (thử Duyệt bằng API); ADMIN bấm "Duyệt"; KẾ TOÁN nhập mã GD → "Đã chuyển khoản"', expected: 'Hoa hồng 8% tiền hàng; KẾ TOÁN không thấy nút Duyệt, API approve 403; ADMIN duyệt → APPROVED; KẾ TOÁN chi → PAID, bankRef, paidBy = kế toán; commission PAID, không còn hoa hồng khả dụng' }, async () => {
    const o = await placeOrder('returning', { lines: [{ sku: 'FUWA-HW-500', qty: 8 }], paymentMethod: 'COD', storefrontSlug: 'uatctv' });
    await waitPancake(o.code);
    await sendOrderStatus(L, o.code, 'shipped');
    await sendOrderStatus(L, o.code, 'delivered');
    const [com0] = await q(`SELECT c.id, c.status, c.amount::int, c.rate, c."commissionableTotal"::int FROM commissions c JOIN orders o ON o.id = c."orderId" WHERE o.code = $1`, o.code);
    await exec(`UPDATE orders SET "deliveredAt" = "deliveredAt" - interval '11 days' WHERE code = $1`, o.code);
    await exec(`UPDATE commissions SET "lockedAt" = "lockedAt" - interval '11 days' WHERE id = $1`, com0.id);
    const job = runJob('commissions.approve-due');
    const dash = await apiOk('GET', '/affiliate/dashboard', { user: 'ctv' });
    const avail = dash.withdrawableCommission ?? dash.availableCommission ?? com0.amount;
    const req = await api('POST', '/affiliate/payouts', { user: 'ctv', headers: { 'idempotency-key': randomUUID() }, body: { amount: avail, method: 'BANK', bankInfo: { bankName: 'Techcombank', accountNumber: '19031234567890', accountName: 'NGUYEN THI CTV' } } });
    if (!req.ok) throw new Error(`CTV rút ${req.status} ${brief(req.body, 300)}`);
    const payoutId = req.body.payoutId ?? req.body.id;
    const ktApprove = await api('POST', `/admin/payouts/${payoutId}/approve`, { user: 'ketoan', body: {} });
    // Duyệt/chi nay gửi expectedAmount (số đang hiện trên màn): lệch số thực nhận thì 409 "tải lại", không ghi gì.
    const staleApprove = await api('POST', `/admin/payouts/${payoutId}/approve`, { user: 'admin', body: { expectedAmount: avail + 1000 } });
    const [poStale] = await q(`SELECT status FROM payouts WHERE id = $1`, payoutId);
    // KẾ TOÁN xem tab
    let s = await openWebSession('ketoan', '/admin?tab=payouts');
    let ktButtons;
    let ev = '';
    try {
      const reqTab = s.page.getByRole('tab', { name: 'Đang chờ duyệt', exact: true });
      await reqTab.waitFor({ timeout: 90_000 });
      await reqTab.click();
      await s.page.getByText('19031234567890').first().waitFor({ timeout: 30_000 }).catch(() => undefined);
      await s.page.waitForLoadState('networkidle').catch(() => undefined);
      ktButtons = { duyet: await s.page.getByRole('button', { name: 'Duyệt', exact: true }).count(), tuchoi: await s.page.getByRole('button', { name: /Từ chối/ }).count() };
      ev = await shot(s.page, 'payouts-ketoan-requested-1440');
    } finally {
      await s.close();
    }
    // ADMIN duyệt trên UI
    s = await openWebSession('admin', '/admin?tab=payouts');
    let apSt = 0;
    let approveBody = '';
    let markBody = '';
    try {
      const btn = s.page.getByRole('button', { name: 'Duyệt', exact: true }).first();
      await btn.waitFor({ timeout: 90_000 });
      const r = waitApi(s.page, /\/api\/admin\/payouts\/[^/]+\/approve$/);
      s.page.on('request', (rq) => {
        if (/\/api\/admin\/payouts\/[^/]+\/approve$/.test(new URL(rq.url()).pathname)) approveBody = rq.postData() ?? '';
      });
      await btn.click();
      const d = s.page.getByRole('alertdialog');
      if (await d.isVisible({ timeout: 2000 }).catch(() => false)) await d.getByRole('button').last().click();
      apSt = (await r).status();
      await s.page.waitForLoadState('networkidle').catch(() => undefined);
      ev += `, ${await shot(s.page, 'payouts-admin-approved-1440')}`;
    } finally {
      await s.close();
    }
    const staleMark = await api('POST', `/admin/payouts/${payoutId}/mark-paid`, { user: 'ketoan', body: { expectedAmount: avail + 1000, bankRef: 'FT26UATSTALE' } });
    const [poStale2] = await q(`SELECT status FROM payouts WHERE id = $1`, payoutId);
    // KẾ TOÁN chi
    s = await openWebSession('ketoan', '/admin?tab=payouts');
    let paySt = 0;
    try {
      const p = s.page;
      const tabApproved = p.getByRole('tab', { name: 'Đã duyệt, chờ chuyển khoản', exact: true });
      if (await tabApproved.count()) await tabApproved.first().click();
      const input = p.getByLabel('Mã giao dịch ngân hàng').first();
      await input.waitFor({ timeout: 90_000 });
      await input.fill('FT26UATPAYOUT20');
      const r = waitApi(p, /\/api\/admin\/payouts\/[^/]+\/mark-paid$/);
      p.on('request', (rq) => {
        if (/\/api\/admin\/payouts\/[^/]+\/mark-paid$/.test(new URL(rq.url()).pathname)) markBody = rq.postData() ?? '';
      });
      await p.getByRole('button', { name: 'Đã chuyển khoản', exact: true }).first().click();
      const d = p.getByRole('alertdialog');
      await d.waitFor({ timeout: 10_000 });
      const dText = await d.innerText();
      await d.getByRole('button', { name: 'Đã chuyển khoản', exact: true }).click();
      paySt = (await r).status();
      await p.waitForLoadState('networkidle').catch(() => undefined);
      ev += `, ${await shot(p, 'payouts-ketoan-paid-1440')} (hộp thoại: "${brief(dText.replace(/\n/g, ' / '), 140)}")`;
    } finally {
      await s.close();
    }
    const day = new Date().toISOString().slice(0, 10);
    const csv = await api('GET', `/admin/reports/exports/payouts?from=${day}&to=${day}`, { user: 'ketoan' });
    const csvHead = String(csv.body).split('\n')[0] ?? '';
    const [po] = await q(`SELECT status, amount::int, "grossAmount"::int, "taxWithheld"::int, fee::int, "reviewedBy", "paidBy", "bankRef" FROM payouts WHERE id = $1`, payoutId);
    const [com1] = await q(`SELECT status, amount::int, "payoutBatchId" FROM commissions WHERE id = $1`, com0.id);
    const dash2 = await apiOk('GET', '/affiliate/dashboard', { user: 'ctv' });
    const expectCom = Math.round(o.order.subtotal * 0.08);
    const ok = com0.amount === expectCom && ktApprove.status === 403 && ktButtons.duyet === 0 && apSt < 300 && paySt < 300 && po.status === 'PAID' && po.reviewedBy === 'uat_admin' && po.paidBy === 'uat_ketoan' && po.bankRef === 'FT26UATPAYOUT20' && po.grossAmount === com0.amount
      && staleApprove.status === 409 && /tải lại/.test(JSON.stringify(staleApprove.body)) && poStale.status === 'REQUESTED'
      && staleMark.status === 409 && /tải lại/.test(JSON.stringify(staleMark.body)) && poStale2.status === 'APPROVED'
      && JSON.parse(approveBody || '{}').expectedAmount === avail && JSON.parse(markBody || '{}').expectedAmount === avail
      && csv.status === 200 && csvHead.includes('Thuế đã hoàn về Ví');
    return {
      actual: `Đơn ${o.code} tiền hàng ${o.order.subtotal}đ → hoa hồng ${com0.amount}đ (8% = ${expectCom}), ${com0.status}; job ${brief(job.result ?? job, 60)}; khả dụng ${avail}. CTV rút → ${req.status}. KẾ TOÁN approve API → ${ktApprove.status}; nút trên tab: Duyệt=${ktButtons.duyet}, Từ chối=${ktButtons.tuchoi}. ADMIN Duyệt → ${apSt}. KẾ TOÁN chi → ${paySt}. payouts: ${brief(po, 200)}. commission: ${brief(com1, 100)}. Khả dụng sau: ${dash2.withdrawableCommission ?? brief(dash2, 80)}. Luật mới: approve lệch expectedAmount → ${staleApprove.status} "${brief(staleApprove.body?.message ?? '', 150)}" (payout vẫn ${poStale.status}); mark-paid lệch → ${staleMark.status} (vẫn ${poStale2.status}); UI gửi approve ${approveBody}, mark-paid ${markBody}; CSV lệnh rút ${csv.status} có cột "Thuế đã hoàn về Ví (VNĐ)": ${csvHead.includes('Thuế đã hoàn về Ví')}`,
      evidence: `${ev}; SQL payouts (reviewedBy/paidBy/bankRef), commissions`,
      verdict: ok ? 'PASS' : 'FAIL',
    };
  });
}

// ---------- U5-21 cashback sàn ngoài
if (want('U5-21')) {
  await runCase(rec, { id: 'U5-21', role: 'KẾ TOÁN', journey: 'Duyệt hoàn tiền mua trên sàn (Hoàn tiền sàn ngoài)', steps: 'uat_returning bấm mua Shopee qua app (POST /cashback/click); giả AccessTrade postback pending (đơn 500.000đ, hoa hồng 25.000đ); KẾ TOÁN tab "Hoàn tiền sàn ngoài" → "Duyệt hoàn tiền" → xác nhận; lùi confirmedAt quá cashback.hold_days, chạy cashback.settle', expected: 'Khách nhận 70% hoa hồng = 17.500đ: PENDING (chưa giữ tiền) → CONFIRMED (cashbackPending +17.500) → PAID, Ví +17.500, cashbackPending về như trước, walletBalance = SUM(sổ ví); SĐT trên danh sách của kế toán bị che' }, async () => {
    const before = await money('uat_returning');
    const click = await apiOk('POST', '/cashback/click', { user: 'returning', body: { merchantId: 'cb-shopee' } });
    const [c] = await q(`SELECT "utmTraceId" FROM cashback_clicks WHERE "userId" = 'uat_returning' ORDER BY "clickedAt" DESC LIMIT 1`);
    const env = laneEnv(L);
    const orderId = `SHP-UAT-${Date.now()}`;
    const pb = await fetch(`${L.apiUrl127}/webhooks/accesstrade`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-accesstrade-token': env.ACCESSTRADE_WEBHOOK_SECRET },
      body: JSON.stringify({ utm_content: c.utmTraceId, order_id: orderId, amount: 500000, commission: 25000, status: 'pending' }),
    });
    const pbBody = await pb.text();
    const pbBad = await fetch(`${L.apiUrl127}/webhooks/accesstrade`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-accesstrade-token': 'sai' }, body: JSON.stringify({ utm_content: c.utmTraceId, order_id: `${orderId}-x`, amount: 1, commission: 1, status: 'approved' }) });
    const [t0] = await q(`SELECT id, status, "userReward"::int FROM cashback_transactions WHERE "merchantOrderId" = $1`, orderId);
    const mid0 = await money('uat_returning');
    const listKt = await api('GET', '/admin/cashback/transactions?status=PENDING', { user: 'ketoan' });
    const s = await openWebSession('ketoan', '/admin?tab=cashback');
    let st = 0;
    let ev = '';
    try {
      const p = s.page;
      const btn = p.getByRole('button', { name: 'Duyệt hoàn tiền', exact: true }).first();
      await btn.waitFor({ timeout: 90_000 });
      ev = await shot(p, 'cashback-ketoan-pending-1440');
      const r = waitApi(p, /\/api\/admin\/cashback\/transactions\/[^/]+\/review$/);
      await btn.click();
      const d = p.getByRole('alertdialog');
      await d.waitFor({ timeout: 10_000 });
      await d.getByRole('button', { name: 'Duyệt hoàn tiền', exact: true }).click();
      st = (await r).status();
      await p.waitForLoadState('networkidle').catch(() => undefined);
      ev += `, ${await shot(p, 'cashback-ketoan-confirmed-1440')}`;
    } finally {
      await s.close();
    }
    const [t1] = await q(`SELECT status, "confirmedAt" FROM cashback_transactions WHERE id = $1`, t0.id);
    const mid = await money('uat_returning');
    const [hold] = await q(`SELECT value FROM system_configs WHERE key = 'cashback.hold_days'`);
    const days = Number(hold?.value ?? 30) + 1;
    await exec(`UPDATE cashback_transactions SET "confirmedAt" = "confirmedAt" - ($2 || ' days')::interval WHERE id = $1`, t0.id, String(days));
    const job = runJob('cashback.settle');
    const [t2] = await q(`SELECT status, "paidAt" FROM cashback_transactions WHERE id = $1`, t0.id);
    const after = await money('uat_returning');
    const phoneMasked = JSON.stringify(listKt.body).includes('0901000003') ? 'KHÔNG che' : 'che';
    const ok = pb.status < 300 && pbBad.status === 401 && t0.userReward === 17500 && mid0.cashbackPending === before.cashbackPending && mid.cashbackPending - before.cashbackPending === 17500 && st < 300 && t1.status === 'CONFIRMED' && t2.status === 'PAID' && after.wallet - before.wallet === 17500 && after.wallet === after.walletLedger && after.cashbackPending === before.cashbackPending && phoneMasked === 'che';
    return {
      actual: `Click ${brief(click, 60)}. Postback đúng token → ${pb.status} ${brief(pbBody, 60)}; token sai → ${pbBad.status}. Giao dịch ${t0.status} userReward ${t0.userReward}. cashbackPending ${before.cashbackPending}→${mid0.cashbackPending}→${mid.cashbackPending}→${after.cashbackPending}. UI duyệt → ${st}, ${t1.status}. Settle (hold ${days - 1} ngày) ${brief(job.result ?? job, 60)} → ${t2.status}. Ví ${before.wallet}→${after.wallet}, SUM(sổ ví) ${after.walletLedger}. SĐT trong danh sách kế toán: ${phoneMasked}`,
      evidence: `${ev}; SQL cashback_transactions, users.cashbackPending/walletBalance, wallet_transactions`,
      verdict: ok ? 'PASS' : 'FAIL',
    };
  });
}

// ---------- U5-22 hoá đơn VAT
if (want('U5-22')) {
  await runCase(rec, { id: 'U5-22', role: 'KẾ TOÁN', journey: 'Hoá đơn VAT: ghi nhận "Đã xuất hoá đơn"', steps: 'uat_returning đặt COD có yêu cầu hoá đơn công ty; xem "Việc cần xử lý" của ADMIN và KẾ TOÁN; KẾ TOÁN mở đơn → khối "Hoá đơn VAT" → link https → "Đã xuất hoá đơn" → xác nhận; gọi lại API', expected: 'invoiceStatus ISSUED + invoiceUrl; lần 2 bị chặn 400 "đã được phát hành"; B18: hoá đơn chờ xuất nằm trong việc của kế toán' }, async () => {
    const o = await placeOrder('returning', { lines: [{ sku: 'BHN-TEA-20', qty: 3 }], paymentMethod: 'COD', invoiceRequest: { taxCode: '0312345678', companyName: 'CONG TY TNHH UAT XANH', address: '1 Lê Lợi, Q1, HCM', email: 'ketoan@uat-xanh.vn' } });
    const inboxAdmin = await apiOk('GET', '/admin/ops/inbox', { user: 'admin' });
    const inboxKt = await apiOk('GET', '/admin/ops/inbox', { user: 'ketoan' });
    const pick = (b) => JSON.stringify(b).match(/"invoicePending"[^,}]*/)?.[0] ?? '(không có khoá invoicePending)';
    const s = await openWebSession('ketoan', '/admin?tab=orders');
    let st = 0;
    let ev = '';
    try {
      const p = s.page;
      await openOrder(p, o.code);
      const sec = p.getByRole('region', { name: 'Hoá đơn VAT' });
      await sec.waitFor({ timeout: 20_000 });
      await sec.getByLabel('Link hoá đơn điện tử (tuỳ chọn)').fill('https://hoadon.uat-xanh.vn/HD0001');
      const r = waitApi(p, /\/api\/admin\/orders\/[^/]+\/issue-invoice$/);
      await sec.getByRole('button', { name: 'Đã xuất hoá đơn', exact: true }).click();
      const d = p.getByRole('alertdialog');
      await d.waitFor({ timeout: 10_000 });
      await d.getByRole('button', { name: 'Đã xuất hoá đơn', exact: true }).click();
      st = (await r).status();
      await p.waitForLoadState('networkidle').catch(() => undefined);
      ev = await shot(p, 'invoice-ketoan-issued-1440');
    } finally {
      await s.close();
    }
    const [od] = await q(`SELECT id, "invoiceStatus", "invoiceUrl" FROM orders WHERE code = $1`, o.code);
    const again = await api('POST', `/admin/orders/${od.id}/issue-invoice`, { user: 'ketoan', body: {} });
    const ktInboxHas = /invoicePending/.test(JSON.stringify(inboxKt));
    const ok = st < 300 && od.invoiceStatus === 'ISSUED' && od.invoiceUrl === 'https://hoadon.uat-xanh.vn/HD0001' && again.status === 400;
    return {
      actual: `UI issue-invoice → ${st}; DB invoiceStatus=${od.invoiceStatus}, url=${od.invoiceUrl}. Gọi lại → ${again.status} ${brief(again.body?.message, 90)}. Hộp việc: ADMIN ${pick(inboxAdmin)}, KẾ TOÁN ${pick(inboxKt)}${ktInboxHas ? '' : ' → kế toán KHÔNG thấy hoá đơn chờ (D2-03 còn mở)'}`,
      evidence: `${ev}; SQL orders.invoiceStatus/invoiceUrl; GET /admin/ops/inbox theo vai trò`,
      verdict: ok ? 'PASS' : 'FAIL',
      note: ktInboxHas ? '' : 'D2-03',
    };
  });
}

// ---------- U5-23 công nợ đại lý
if (want('U5-23')) {
  await runCase(rec, { id: 'U5-23', role: 'KẾ TOÁN', journey: 'Công nợ đại lý: ghi nhận đại lý trả một phần nợ', steps: 'uat_dealer (DEALER_2, hạn mức 20 triệu) đặt đơn sỉ ghi công nợ ≥ 3 triệu; KẾ TOÁN mở đơn → "Công nợ đại lý" → nhập 1.000.000đ + mã GD → "Xác nhận đã nhận, giảm nợ" → xác nhận; tab "Đại lý & công nợ"', expected: 'Đơn ghi nợ vào thẳng CONFIRMED (dealer.service.ts:303-308 lưu paymentMethod BANK_TRANSFER); sổ công nợ +tổng đơn khi đặt, −1.000.000 khi kế toán ghi nhận; dư nợ = tổng − 1.000.000 (SUM(delta) khớp số hiện ở tab); thao tác ghi người làm' }, async () => {
    const [v] = await q(`SELECT id, sku, "retailPrice"::int AS rp FROM variations WHERE sku = 'HEC-DEO-50'`);
    const qty = 45;
    const addr = await q(`SELECT id FROM addresses WHERE "userId" = 'uat_dealer' LIMIT 1`);
    const d = await api('POST', '/dealer/orders', { user: 'dealer', headers: { 'idempotency-key': randomUUID() }, body: { items: [{ variationId: v.id, quantity: qty }], paymentMethod: 'CREDIT', note: 'UAT lane 5 công nợ', ...(addr[0] ? { addressId: addr[0].id } : {}) } });
    if (!d.ok) throw new Error(`đặt đơn sỉ ${d.status} ${brief(d.body, 300)}`);
    const code = d.body.code ?? d.body.order?.code ?? d.body.orders?.[0]?.code;
    const [o] = await q(`SELECT id, code, total::int, status, "paymentMethod" FROM orders WHERE code = $1`, code);
    const led0 = await q(`SELECT COALESCE(SUM(delta),0)::int AS debt, COUNT(*)::int AS n FROM dealer_credit_ledgers WHERE "userId" = 'uat_dealer'`);
    const bankRef = `FT26UATDEBT${Date.now() % 1e7}`;
    const s = await openWebSession('ketoan', '/admin?tab=orders');
    let st = 0;
    let ev = '';
    let tabDebt = '';
    try {
      const p = s.page;
      await openOrder(p, code);
      const sec = p.getByRole('region', { name: 'Công nợ đại lý' });
      await sec.waitFor({ timeout: 20_000 });
      await sec.getByRole('button').first().click();
      await sec.getByLabel('Số tiền đã nhận (đ)').fill('1000000');
      await sec.getByLabel('Mã giao dịch').fill(bankRef);
      const r = waitApi(p, /\/api\/admin\/dealers\/[^/]+\/credit-payment$/);
      await sec.getByRole('button', { name: /Xác nhận đã nhận, giảm nợ/ }).click();
      const dl = p.getByRole('alertdialog');
      await dl.waitFor({ timeout: 10_000 });
      await dl.getByRole('button', { name: 'Đã nhận tiền', exact: true }).click();
      st = (await r).status();
      await p.waitForLoadState('networkidle').catch(() => undefined);
      ev = await shot(p, 'dealer-debt-ketoan-paid-1440');
      await s.goto('/admin?tab=dealerAccounts');
      await p.getByText(/Đại lý/).first().waitFor({ timeout: 60_000 });
      await p.waitForLoadState('networkidle').catch(() => undefined);
      ev += `, ${await shot(p, 'dealer-accounts-ketoan-1440')}`;
      tabDebt = (await p.locator('body').innerText()).match(/[\d.]+\s?đ/g)?.slice(0, 6).join(' ') ?? '';
    } finally {
      await s.close();
    }
    const replay = await api('POST', '/admin/dealers/uat_dealer/credit-payment', { user: 'ketoan', headers: { 'idempotency-key': bankRef }, body: { amount: 1000000, bankRef } });
    const led = await q(`SELECT delta::int, "refType", note FROM dealer_credit_ledgers WHERE "userId" = 'uat_dealer' ORDER BY "createdAt"`);
    const debt = led.reduce((a, x) => a + x.delta, 0);
    const acc = await apiOk('GET', '/admin/dealers/accounts', { user: 'ketoan' });
    const row = (acc.data ?? acc.items ?? acc).find?.((x) => (x.userId ?? x.id) === 'uat_dealer');
    const ok = o.status === 'CONFIRMED' && led.some((x) => x.refType === 'ORDER' && x.note?.includes(code) && x.delta === o.total) && st < 300 && debt === led0[0].debt - 1_000_000 && led.filter((x) => x.note?.includes(bankRef)).length === 1 && row?.debt === debt;
    return {
      actual: `Đơn sỉ ${code} ${o.status}/${o.paymentMethod} tổng ${o.total}đ (${qty}×${v.sku} ${v.rp}đ, giá đại lý DEALER_2 −30%); dư nợ sau đặt ${led0[0].debt}. UI credit-payment (mã GD ${bankRef}) → ${st}; gửi lại cùng mã → ${replay.status}, dòng sổ mang mã này: ${led.filter((x) => x.note?.includes(bankRef)).length}. Sổ: ${brief(led.map((x) => `${x.delta} ${x.refType}`), 160)} → dư nợ ${debt}. API accounts: ${brief(row, 160)}. Tab hiện: ${tabDebt}`,
      evidence: `${ev}; SQL SUM(dealer_credit_ledgers.delta) WHERE userId='uat_dealer'`,
      verdict: ok ? 'PASS' : 'FAIL',
    };
  });
}

rec.save();
await done();
