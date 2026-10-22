#!/usr/bin/env node
// U3-08..U3-15: rút hoa hồng CTV. Số dư 0 / thiếu / một phần / dưới mức tối thiểu; rút về Ví trên Mini App; đơn lớn (lên đơn hộ, chuyển khoản)
// → hoa hồng ≥ 2 triệu → khấu trừ TNCN 10% (bắt MST/CCCD); hai lệnh rút cùng lúc; KẾ TOÁN không duyệt được; ADMIN duyệt trên web admin;
// KẾ TOÁN bấm "Đã chuyển khoản" trên web admin; ADMIN từ chối → hoa hồng trở lại "Có thể rút". Mọi ca tiền đối chiếu SQL.
// Dùng: node 02-rut-tien.mjs
import {
  L, api, apiOk, bankPay, closeDb, commissionsOf, deliver, ensureUser, exec, itemsForGoods, itemsOf, log, matureCommissions, openMini, openWeb, orderRow,
  placeOrderApi, recorder, short, shot, sql, variationBySku, waitPancake,
} from './u3lib.mjs';

const R = recorder('02-rut-tien');
const CTV = 'uat_ctv';
const RUN = Date.now().toString(36).slice(-5);
const vnd = (n) => `${Number(n).toLocaleString('vi-VN')}đ`;

const available = async (u = CTV) =>
  (await sql(`SELECT COALESCE(SUM(amount),0)::int s, count(*)::int n FROM commissions WHERE "affiliateUserId" = $1 AND status = 'APPROVED' AND "payoutBatchId" IS NULL`, u))[0];
const wallet = async (u = CTV) =>
  (await sql(`SELECT "walletBalance"::int b, (SELECT COALESCE(SUM(delta),0)::int FROM wallet_transactions w WHERE w."userId" = $1) AS led FROM users WHERE id = $1`, u))[0];

// Q2 (chủ chốt 2026-10-20): thuế TNCN cộng dồn các lần rút trong tháng VN, giữ 10% tổng tháng khi tổng từ 2.000.000đ, trừ phần đã giữ ở các lệnh trước.
// Lệnh bị từ chối và lệnh không có grossAmount không tính (affiliate.service.ts personalIncomeTax).
const pitPrior = async (u = CTV) =>
  (await sql(
    `SELECT COALESCE(SUM("grossAmount"),0)::int g, COALESCE(SUM("taxWithheld" - "taxRefunded"),0)::int held FROM payouts
      WHERE "userId" = $1 AND "grossAmount" IS NOT NULL AND status <> 'REJECTED'
        AND "requestedAt" >= date_trunc('month', now() AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh'`,
    u,
  ))[0];
const pitExpect = (prior, gross) => {
  const total = prior.g + gross;
  const owed = total >= 2_000_000 ? Math.round(total * 0.1) - prior.held : 0;
  return Math.min(Math.max(owed, 0), gross);
};

let mini;
let web;
try {
  // Đưa uat_ctv về trạng thái đầu (chạy lại được): lệnh rút còn REQUESTED bị ADMIN từ chối, phần APPROVED còn lại rút hết về Ví.
  for (const r of await sql(`SELECT id FROM payouts WHERE "userId" = $1 AND status = 'REQUESTED'`, CTV)) {
    await apiOk(L, 'POST', `/admin/payouts/${r.id}/reject`, { user: 'uat_admin', body: { reason: 'UAT U3: dọn lệnh cũ trước khi chạy lại' } });
  }
  for (const r of await sql(`SELECT id FROM payouts WHERE "userId" = $1 AND status = 'APPROVED'`, CTV)) {
    await apiOk(L, 'POST', `/admin/payouts/${r.id}/mark-paid`, { user: 'uat_ketoan', body: { bankRef: 'UAT-U3-DON-LENH-CU' } });
  }
  const left = await available();
  if (left.s > 0) {
    await apiOk(L, 'POST', '/affiliate/payouts', { user: CTV, headers: { 'idempotency-key': `u3-reset-${RUN}` }, body: { amount: left.s, method: 'WALLET_BALANCE', taxId: '079123456789' } });
  }
  log('đã dọn số dư CTV', { left });

  // Dựng: hoa hồng nhỏ (< 50.000đ) APPROVED cho uat_ctv từ đơn khách mới qua mã UATCTV (đường đầy đủ đã kiểm trên UI ở U3-04..06).
  const buyer = `uat_u3w${RUN}`;
  await ensureUser(buyer, { phone: `0904${String(Date.now()).slice(-6)}` });
  const small = await variationBySku('FUWA-DW-1L');
  const o1 = await placeOrderApi(buyer, [{ variationId: small.id, quantity: 1 }], { referralCode: 'UATCTV' });
  await deliver(o1.code);
  await matureCommissions(o1.code);
  const a0 = await available();
  log('dựng xong hoa hồng nhỏ', { order: o1.code, available: a0 });

  // ---------- U3-08 rút khi không có hoa hồng ----------
  const r8 = await api(L, 'POST', '/affiliate/payouts', {
    user: 'uat_ctv_pending', headers: { 'idempotency-key': `u3-8-${RUN}` },
    body: { amount: 100000, method: 'BANK', bankInfo: { bankName: 'Techcombank', accountNumber: '19031234567', accountName: 'CTV CHO DUYET' } },
  });
  const p8 = (await sql(`SELECT count(*)::int n FROM payouts WHERE "userId" = 'uat_ctv_pending'`))[0].n;
  R.add({
    id: 'U3-08', role: 'CTV', journey: 'Rút tiền: số dư 0', title: 'CTV chưa có hoa hồng APPROVED bấm rút',
    steps: 'POST /affiliate/payouts uat_ctv_pending amount 100.000 BANK',
    expected: '400 "Không có hoa hồng khả dụng để rút."; không tạo payout',
    actual: { status: r8.status, body: r8.body, payouts: p8 },
    evidence: `HTTP ${r8.status} ${short(r8.body?.message)}; SQL count(payouts uat_ctv_pending)=${p8}`,
    status: r8.status === 400 && /Không có hoa hồng/.test(JSON.stringify(r8.body)) && p8 === 0 ? 'PASS' : 'FAIL',
  });

  // ---------- U3-09 rút thiếu / thừa / dưới mức tối thiểu ----------
  const bank = { bankName: 'Techcombank', accountNumber: '19031234567', accountName: 'NGUYEN VAN CTV' };
  const over = await api(L, 'POST', '/affiliate/payouts', { user: CTV, headers: { 'idempotency-key': `u3-9a-${RUN}` }, body: { amount: a0.s + 1, method: 'BANK', bankInfo: bank } });
  const part = await api(L, 'POST', '/affiliate/payouts', { user: CTV, headers: { 'idempotency-key': `u3-9b-${RUN}` }, body: { amount: Math.max(1, a0.s - 1000), method: 'BANK', bankInfo: bank } });
  const minb = await api(L, 'POST', '/affiliate/payouts', { user: CTV, headers: { 'idempotency-key': `u3-9c-${RUN}` }, body: { amount: a0.s, method: 'BANK', bankInfo: bank } });
  const a9 = await available();
  R.add({
    id: 'U3-09', role: 'CTV', journey: 'Rút tiền: số dư thiếu / một phần / dưới tối thiểu', title: 'Rút quá số dư, rút một phần, rút ngân hàng dưới 50.000đ',
    steps: `Số dư APPROVED ${vnd(a0.s)}; POST /affiliate/payouts BANK amount = số dư+1, số dư−1000, đúng số dư (< affiliate.min_withdraw_bank 50.000)`,
    expected: '400 "không đủ"; 400 "Chỉ hỗ trợ rút toàn bộ"; 400 "tối thiểu 50.000đ"; số dư APPROVED không đổi',
    actual: { a0, over: [over.status, over.body?.message], part: [part.status, part.body?.message], minb: [minb.status, minb.body?.message], a9 },
    evidence: `HTTP ${over.status}/${part.status}/${minb.status}; SQL SUM APPROVED trước ${a0.s} sau ${a9.s}`,
    status: a0.s > 0 && a0.s < 50000 && over.status === 400 && /không đủ/.test(over.body?.message) && part.status === 400 && /toàn bộ/.test(part.body?.message) &&
      minb.status === 400 && /tối thiểu/.test(minb.body?.message) && a9.s === a0.s ? 'PASS' : 'FAIL',
  });

  // ---------- U3-10 rút về Ví Tubu trên Mini App ----------
  const w0 = await wallet();
  const prior10 = await pitPrior();
  const tax10 = pitExpect(prior10, a0.s);
  const rows10 = await sql(`SELECT id FROM commissions WHERE "affiliateUserId" = $1 AND status = 'APPROVED' AND "payoutBatchId" IS NULL`, CTV);
  mini = await openMini(CTV, { path: '/affiliate' });
  let p = mini.page;
  await p.getByRole('button', { name: 'Rút tiền hoa hồng' }).click();
  await p.getByText('Ví Tubu', { exact: true }).click();
  const recv = p.getByRole('button', { name: /^Nhận .* vào Ví$/ });
  await recv.waitFor({ timeout: 10_000 });
  const s10a = await shot(p, 'U3-10-rut-ve-vi-form');
  const pr = p.waitForResponse((r) => r.url().endsWith('/api/affiliate/payouts') && r.request().method() === 'POST', { timeout: 20_000 });
  await recv.click();
  const r10 = await pr;
  const b10 = await r10.json();
  await p.waitForTimeout(800);
  const s10b = await shot(p, 'U3-10-rut-ve-vi-xong');
  await mini.close();
  mini = null;
  const w1 = await wallet();
  const pay10 = await sql(`SELECT id, amount::int, "grossAmount"::int AS gross, "taxWithheld"::int AS tax, method, status::text FROM payouts WHERE "userId" = $1 AND method = 'WALLET_BALANCE' ORDER BY "requestedAt" DESC LIMIT 1`, CTV);
  const paidRows = await sql(`SELECT count(*)::int n FROM commissions WHERE id = ANY($1::text[]) AND status = 'PAID'`, rows10.map((r) => r.id));
  const wt = await sql(`SELECT delta::int, type::text, "refType", "refId" FROM wallet_transactions WHERE "userId" = $1 ORDER BY "createdAt" DESC LIMIT 1`, CTV);
  R.add({
    id: 'U3-10', role: 'CTV', journey: 'Rút tiền về Ví Tubu (Mini App)', title: 'Rút toàn bộ hoa hồng < 2 triệu về Ví: quy đổi 1:1, không trừ TNCN',
    steps: '/affiliate → "Rút tiền" → "Ví Tubu" → "Nhận … vào Ví"',
    expected: `201; payout WALLET_BALANCE PAID gross ${vnd(a0.s)}, taxWithheld ${vnd(tax10)} (Q2: tổng tháng ${vnd(prior10.g + a0.s)}${prior10.g + a0.s < 2_000_000 ? ' dưới ngưỡng 2.000.000đ nên 0' : ''}); walletBalance += ${vnd(a0.s - tax10)} = SUM(wallet_transactions); commissions PAID`,
    actual: { http: r10.status(), body: b10, prior10, tax10, w0, w1, pay10, paidRows: paidRows[0].n, of: rows10.length, wt },
    evidence: `${s10a}, ${s10b}; SQL walletBalance ${w0.b}→${w1.b}, SUM ledger ${w1.led}; payout ${short(pay10)}; wallet_tx ${short(wt)}`,
    status: r10.status() < 300 && w1.b === w0.b + a0.s - tax10 && w1.b === w1.led && pay10[0]?.status === 'PAID' && pay10[0]?.tax === tax10 && pay10[0]?.amount === a0.s - tax10 &&
      paidRows[0].n === rows10.length ? 'PASS' : 'FAIL',
  });

  // Dựng: CTV lên đơn hộ khách, chuyển khoản, ~25,6 triệu → hoa hồng > 2 triệu.
  const custPhone = `0905${String(Date.now()).slice(-6)}`;
  const customer = {
    recipient: 'Khách Của CTV U3', phone: custPhone, province: 'Thành phố Hồ Chí Minh', district: '', ward: 'Phường Bến Thành', street: '1 Lê Lợi',
    provinceCode: '84_VN79', districtCode: '', wardCode: '84_VN7926743',
  };
  // Hoa hồng 8% phải vượt ngưỡng 2.000.000đ: tiền hàng ≥ 26.000.000đ.
  const items = (await itemsForGoods(26_000_000)).map(({ variationId, quantity }) => ({ variationId, quantity }));
  const q = await apiOk(L, 'POST', '/affiliate/orders/quote', { user: CTV, body: { items } });
  const big = await apiOk(L, 'POST', '/affiliate/orders', {
    user: CTV, headers: { 'idempotency-key': `u3-big-${RUN}` }, body: { items, customer, paymentMethod: 'BANK_TRANSFER', expectedTotal: q.total },
  });
  const bigCode = big.code ?? big.order?.code;
  await waitPancake(bigCode);
  const bp = bankPay(bigCode, q.total);
  await deliver(bigCode);
  await matureCommissions(bigCode);
  const bigComm = await commissionsOf(bigCode);
  const bigOrder = await orderRow(bigCode);
  const bigExpect = (await itemsOf(bigCode)).reduce((t, i) => t + Math.floor(((i.paidTotal ?? i.total) * 8) / 100), 0);
  log('đơn hộ lớn', { bigCode, quote: q.total, bank: bp.orderAfter, bigComm });

  // ---------- U3-11 TNCN 10% bắt MST/CCCD ----------
  await exec(`UPDATE users SET "personalTaxId" = NULL WHERE id = $1`, CTV);
  const a11 = await available();
  const prior11 = await pitPrior();
  const tax11 = pitExpect(prior11, a11.s);
  const noTax = await api(L, 'POST', '/affiliate/payouts', { user: CTV, headers: { 'idempotency-key': `u3-11-${RUN}` }, body: { amount: a11.s, method: 'BANK', bankInfo: bank } });
  const p11 = (await sql(`SELECT count(*)::int n FROM payouts WHERE "userId" = $1 AND status = 'REQUESTED'`, CTV))[0].n;
  R.add({
    id: 'U3-11', role: 'CTV', journey: 'Trừ TNCN 10% (≥ 2.000.000đ)', title: 'Lệnh rút ≥ 2 triệu chưa có MST/CCCD bị chặn, báo số thuế',
    steps: `Đơn hộ chuyển khoản ${bigCode} ${vnd(bigOrder.total)} → giao → đủ 10 ngày → APPROVED ${vnd(a11.s)}; POST /affiliate/payouts BANK không taxId`,
    expected: `400 code PIT_TAX_ID_REQUIRED, câu báo khấu trừ ${vnd(tax11)} (Q2: 10% × (đã rút trong tháng ${vnd(prior11.g)} + lần này ${vnd(a11.s)}) − thuế đã giữ ${vnd(prior11.held)}); không tạo payout`,
    actual: { bigComm: bigComm.map((c) => ({ s: c.status, amt: c.amount, base: c.commissionableTotal })), a11, prior11, tax11, status: noTax.status, body: noTax.body, requested: p11 },
    evidence: `SQL commissions ${bigCode}: ${short(bigComm.map((c) => [c.status, c.amount]))}; HTTP ${noTax.status} ${short(noTax.body)}`,
    status: bigComm[0]?.amount === bigExpect && a11.s >= 2_000_000 && noTax.status === 400 && noTax.body?.code === 'PIT_TAX_ID_REQUIRED' &&
      String(noTax.body?.message).includes(vnd(tax11)) && p11 === 0 ? 'PASS' : 'FAIL',
  });

  // ---------- U3-12 hai lệnh rút cùng lúc ----------
  const before12 = await sql(`SELECT count(*)::int n FROM payouts WHERE "userId" = $1`, CTV);
  const body = { amount: a11.s, method: 'BANK', bankInfo: bank, taxId: '079123456789' };
  const [x, y] = await Promise.all([
    api(L, 'POST', '/affiliate/payouts', { user: CTV, headers: { 'idempotency-key': `u3-12a-${RUN}` }, body }),
    api(L, 'POST', '/affiliate/payouts', { user: CTV, headers: { 'idempotency-key': `u3-12b-${RUN}` }, body }),
  ]);
  const after12 = await sql(`SELECT count(*)::int n FROM payouts WHERE "userId" = $1`, CTV);
  const win = [x, y].find((r) => r.ok);
  const pay12 = win ? (await sql(`SELECT id, amount::int, "grossAmount"::int AS gross, "taxWithheld"::int AS tax, "taxId", status::text FROM payouts WHERE id = $1`, win.body.payoutId))[0] : null;
  const batched = win ? (await sql(`SELECT COALESCE(SUM(amount),0)::int s, count(*)::int n, string_agg(DISTINCT status::text, ',') st FROM commissions WHERE "payoutBatchId" = $1`, win.body.payoutId))[0] : null;
  const a12 = await available();
  const tax = tax11;
  R.add({
    id: 'U3-12', role: 'CTV', journey: 'Rút 2 lần cùng lúc + trừ TNCN', title: 'Hai POST /affiliate/payouts song song (khoá khác nhau), có MST',
    steps: 'Promise.all 2 lệnh rút BANK cùng số dư, Idempotency-Key khác nhau, taxId 079123456789',
    expected: `Đúng 1 lệnh 201 REQUESTED, lệnh kia 400/409; 1 payout mới: gross ${vnd(a11.s)}, taxWithheld ${vnd(tax)}, amount ${vnd(a11.s - tax)}; commissions gắn payoutBatchId, tổng = gross; số dư có thể rút về 0`,
    actual: { x: [x.status, x.body?.status ?? x.body?.message], y: [y.status, y.body?.status ?? y.body?.message], created: after12[0].n - before12[0].n, pay12, batched, a12 },
    evidence: `HTTP ${x.status}/${y.status}; SQL payout ${short(pay12)}; commissions theo batch ${short(batched)}; còn APPROVED chưa rút ${a12.s}`,
    status: [x, y].filter((r) => r.ok).length === 1 && [x, y].some((r) => r.status === 400 || r.status === 409) && after12[0].n - before12[0].n === 1 &&
      pay12?.gross === a11.s && pay12?.tax === tax && pay12?.amount === a11.s - tax && batched?.s === a11.s && a12.s === 0 ? 'PASS' : 'FAIL',
  });

  // ---------- U3-13 KẾ TOÁN không duyệt được; ADMIN duyệt trên web admin ----------
  const kt = await api(L, 'POST', `/admin/payouts/${pay12.id}/approve`, { user: 'uat_ketoan', body: {} });
  web = await openWeb('admin', { width: 1440, path: '/admin?tab=payouts' });
  let w = web.page;
  const card = () => w.locator('div.rounded-card').filter({ hasText: vnd(pay12.amount) }).filter({ hasText: 'UATCTV' }).first();
  await card().waitFor({ timeout: 90_000 });
  const ap = w.waitForResponse((r) => /\/api\/admin\/payouts\/[^/]+\/approve$/.test(new URL(r.url()).pathname), { timeout: 20_000 });
  await card().getByRole('button', { name: 'Duyệt', exact: true }).click();
  // Duyệt giờ có hộp xác nhận "Duyệt lệnh rút tiền" (gói q2-tncn: gửi kèm expectedAmount để không duyệt theo số cũ).
  const dlg13 = w.getByRole('alertdialog');
  await dlg13.waitFor({ timeout: 10_000 });
  await dlg13.getByRole('button', { name: 'Duyệt lệnh rút' }).click();
  const apr = await ap;
  await w.waitForTimeout(800);
  const s13 = await shot(w, 'U3-13-admin-duyet-rut');
  await web.close();
  web = null;
  const st13 = (await sql(`SELECT status::text s, "reviewedBy" FROM payouts WHERE id = $1`, pay12.id))[0];
  R.add({
    id: 'U3-13', role: 'KẾ TOÁN / ADMIN', journey: 'Admin duyệt rút (chỉ ADMIN)', title: 'KẾ TOÁN gọi duyệt bị 403; ADMIN bấm "Duyệt" trên web admin',
    steps: `POST /admin/payouts/${pay12.id}/approve bằng uat_ketoan; web admin 1440 /admin?tab=payouts → thẻ lệnh ${vnd(pay12.amount)} → "Duyệt"`,
    expected: 'KẾ TOÁN 403; ADMIN 2xx; payout APPROVED, reviewedBy = uat_admin',
    actual: { ketoan: [kt.status, kt.body?.message], admin: apr.status(), st13 },
    evidence: `${s13}; HTTP ketoan ${kt.status}, admin ${apr.status()}; SQL payout ${short(st13)}`,
    status: kt.status === 403 && apr.status() < 300 && st13.s === 'APPROVED' && st13.reviewedBy === 'uat_admin' ? 'PASS' : 'FAIL',
  });

  // ---------- U3-14 KẾ TOÁN bấm "Đã chuyển khoản" ----------
  web = await openWeb('ketoan', { width: 1440, path: '/admin?tab=payouts' });
  w = web.page;
  await card().waitFor({ timeout: 90_000 });
  await card().getByLabel('Mã giao dịch ngân hàng').fill(`FT26U3${RUN}`);
  await card().getByRole('button', { name: 'Đã chuyển khoản', exact: true }).click();
  const dlg = w.getByRole('alertdialog');
  await dlg.waitFor({ timeout: 10_000 });
  const [mpr] = await Promise.all([
    w.waitForResponse((r) => /\/api\/admin\/payouts\/[^/]+\/mark-paid$/.test(new URL(r.url()).pathname), { timeout: 20_000 }),
    dlg.getByRole('button', { name: 'Đã chuyển khoản' }).click(),
  ]);
  await w.waitForTimeout(800);
  const s14 = await shot(w, 'U3-14-ketoan-da-chi');
  await web.close();
  web = null;
  const st14 = (await sql(`SELECT status::text s, "paidBy", "bankRef", "paidAt" FROM payouts WHERE id = $1`, pay12.id))[0];
  const cm14 = (await sql(`SELECT string_agg(DISTINCT status::text, ',') st, count(*)::int n FROM commissions WHERE "payoutBatchId" = $1`, pay12.id))[0];
  const month = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 7);
  const pit = await apiOk(L, 'GET', `/admin/payouts/pit-report?month=${month}`, { user: 'uat_ketoan' });
  const pitRow = (pit.rows ?? []).find((r) => r.userId === CTV);
  const pitSql = (await sql(`SELECT COALESCE(SUM("taxWithheld"),0)::int t FROM payouts WHERE "userId" = $1 AND status = 'PAID' AND to_char("paidAt" + interval '7 hours', 'YYYY-MM') = $2`, CTV, month))[0].t;
  R.add({
    id: 'U3-14', role: 'KẾ TOÁN', journey: 'Kế toán bấm "Đã chi"', title: 'KẾ TOÁN bấm "Đã chuyển khoản" trên web admin; báo cáo TNCN tháng khớp sổ',
    steps: `web admin uat_ketoan 1440 /admin?tab=payouts (lọc mặc định "Đã duyệt") → nhập mã GD → "Đã chuyển khoản" → xác nhận; GET /admin/payouts/pit-report?month=${month}`,
    expected: 'mark-paid 2xx; payout PAID, paidBy uat_ketoan, bankRef lưu; commissions của lệnh PAID; pit-report taxWithheld CTV = SUM(taxWithheld PAID tháng) trong DB',
    actual: { http: mpr.status(), st14, cm14, pitRow, pitSql },
    evidence: `${s14}; SQL payout ${short(st14)}; commissions ${short(cm14)}; pit-report ${short(pitRow)} vs SQL ${pitSql}`,
    status: mpr.status() < 300 && st14.s === 'PAID' && st14.paidBy === 'uat_ketoan' && st14.bankRef === `FT26U3${RUN}` && cm14.st === 'PAID' && pitRow?.taxWithheld === pitSql ? 'PASS' : 'FAIL',
  });

  // ---------- U3-15 ADMIN từ chối → hoa hồng trở lại ----------
  const buyer2 = `uat_u3r${RUN}`;
  await ensureUser(buyer2, { phone: `0906${String(Date.now()).slice(-6)}` });
  const v5 = await variationBySku('FUWA-LD-2L');
  const o2 = await placeOrderApi(buyer2, [{ variationId: v5.id, quantity: 4 }], { referralCode: 'UATCTV' });
  await deliver(o2.code);
  await matureCommissions(o2.code);
  const a15 = await available();
  const req15 = await apiOk(L, 'POST', '/affiliate/payouts', { user: CTV, headers: { 'idempotency-key': `u3-15-${RUN}` }, body: { amount: a15.s, method: 'BANK', bankInfo: bank } });
  const rej = await api(L, 'POST', `/admin/payouts/${req15.payoutId}/reject`, { user: 'uat_admin', body: { reason: 'Sai số tài khoản, CTV gửi lại' } });
  const st15 = (await sql(`SELECT status::text s, "rejectionReason" FROM payouts WHERE id = $1`, req15.payoutId))[0];
  const back = await available();
  R.add({
    id: 'U3-15', role: 'ADMIN / CTV', journey: 'Admin từ chối lệnh rút', title: 'Từ chối lệnh rút trả hoa hồng về "Có thể rút"',
    steps: `Đơn ${o2.code} qua mã UATCTV → giao → đủ 10 ngày; CTV rút BANK ${vnd(a15.s)}; ADMIN POST /admin/payouts/:id/reject có lý do`,
    expected: 'payout REJECTED có lý do; commissions về APPROVED, payoutBatchId null; số dư có thể rút lại = trước khi rút',
    actual: { a15, req15, rej: [rej.status], st15, back },
    evidence: `HTTP reject ${rej.status}; SQL payout ${short(st15)}; SUM APPROVED chưa rút trước ${a15.s} sau ${back.s}`,
    status: rej.status < 300 && st15.s === 'REJECTED' && back.s === a15.s && back.n === a15.n ? 'PASS' : 'FAIL',
  });
} catch (e) {
  console.error(e);
  if (mini) await shot(mini.page, 'U3-08-15-loi-mini');
  if (web) await shot(web.page, 'U3-08-15-loi-web');
  R.add({ id: 'U3-08..15', title: 'script lỗi', status: 'BLOCKED', actual: e instanceof Error ? e.message : String(e) });
} finally {
  await mini?.close().catch(() => undefined);
  await web?.close().catch(() => undefined);
  R.save();
  await closeDb();
}
