#!/usr/bin/env node
// U5 đơn hàng hằng ngày của admin/kế toán trên web admin thật 1440:
//   U5-10 tìm/lọc đơn · U5-11 ADMIN "Đã nhận tiền" · U5-12 KẾ TOÁN "Đã nhận tiền" + SĐT che · U5-13 huỷ đơn COD
//   U5-14 huỷ đơn chuyển khoản đã trả = hoàn toàn phần vào Ví · U5-15 trả một phần → hoàn ngân hàng → KẾ TOÁN chi
// Dữ liệu: khách đặt đơn qua chính API checkout (lane 5). Mọi kết quả tiền/điểm đối chiếu SQL.
// Dùng: node u5-orders.mjs [--only U5-13,U5-14]
import { L, api, apiOk, bankWebhook, brief, done, money, openWebSession, placeOrder, q, recorder, runCase, sendOrderStatus, shot, sleep, waitPancake } from './u5lib.mjs';

const rec = recorder('u5-orders');
const only = (process.argv.find((a) => a.startsWith('--only=')) ?? '').slice(7).split(',').filter(Boolean);
const want = (id) => !only.length || only.includes(id);

async function openOrder(page, code) {
  const search = page.getByPlaceholder(/Tìm mã đơn/);
  await search.waitFor({ timeout: 90_000 });
  await search.fill(code);
  await page.getByRole('button', { name: 'Tìm kiếm', exact: true }).click();
  const row = page.getByRole('row').filter({ hasText: code });
  await row.first().waitFor({ timeout: 30_000 });
  await row.first().getByRole('button', { name: /Xem & Sửa/ }).click();
  return row.first();
}
const waitApi = (page, re, method = 'POST') =>
  page.waitForResponse((r) => re.test(new URL(r.url()).pathname) && r.request().method() === method, { timeout: 30_000 });

const ord = (code) =>
  q(`SELECT id, code, status, "paymentStatus", "paymentMethod", total::int, "paidAt", "pointsUsed"::int, "userId" FROM orders WHERE code = $1`, code).then((r) => r[0]);
const history = (orderId) =>
  q(`SELECT "fromStatus", "toStatus", "actorId", "actorType", note FROM order_status_history WHERE "orderId" = $1 ORDER BY "createdAt"`, orderId);

// ---------- U5-10: tìm/lọc đơn
if (want('U5-10')) {
  await runCase(rec, { id: 'U5-10', role: 'ADMIN', journey: 'Lọc/tìm đơn (tab Đơn hàng)', steps: 'Đặt 2 đơn (COD + chuyển khoản) cho uat_new; web admin: tìm theo mã đơn, theo SĐT 0901000001, lọc "Chờ thanh toán"', expected: 'Tìm mã → đúng 1 dòng; tìm SĐT → mọi đơn của SĐT đó (khớp SQL); lọc trạng thái → chỉ đơn PENDING_PAYMENT (khớp SQL)' }, async () => {
    const a = await placeOrder('new', { lines: [{ sku: 'FUWA-HW-500', qty: 1 }], paymentMethod: 'COD' });
    const b = await placeOrder('new', { lines: [{ sku: 'COBOTE-TR-50', qty: 1 }], paymentMethod: 'BANK_TRANSFER' });
    const s = await openWebSession('admin', '/admin?tab=orders');
    try {
      const p = s.page;
      await openOrder(p, a.code);
      const rowsCode = await p.getByRole('row').filter({ hasText: /TUBU\d+/ }).count();
      // tìm theo SĐT
      const search = p.getByPlaceholder(/Tìm mã đơn/);
      await search.fill('0901000001');
      const listResp = waitApi(p, /\/api\/admin\/orders$/, 'GET');
      await p.getByRole('button', { name: 'Tìm kiếm', exact: true }).click();
      const lr = await (await listResp).json();
      await p.waitForLoadState('networkidle').catch(() => undefined);
      const uiCodes = (await p.getByRole('row').filter({ hasText: /TUBU\d+/ }).allInnerTexts()).map((t) => /TUBU\d+/.exec(t)?.[0]).filter(Boolean);
      const sqlPhone = (await q(`SELECT code FROM orders o JOIN users u ON u.id = o."userId" WHERE u.phone = '0901000001' OR o."shippingAddress"->>'phone' = '0901000001' ORDER BY code`)).map((r) => r.code);
      const ev1 = await shot(p, 'orders-search-phone-1440');
      // lọc trạng thái
      await search.fill('');
      const fResp = waitApi(p, /\/api\/admin\/orders$/, 'GET');
      await p.getByLabel('Lọc đơn theo trạng thái').selectOption('PENDING_PAYMENT');
      const fr = await (await fResp).json();
      await p.waitForLoadState('networkidle').catch(() => undefined);
      const uiPending = (await p.getByRole('row').filter({ hasText: /TUBU\d+/ }).allInnerTexts()).map((t) => /TUBU\d+/.exec(t)?.[0]).filter(Boolean);
      const sqlPending = (await q(`SELECT code FROM orders WHERE status = 'PENDING_PAYMENT' ORDER BY code`)).map((r) => r.code);
      const ev2 = await shot(p, 'orders-filter-pending-1440');
      const okPhone = JSON.stringify([...new Set(uiCodes)].sort()) === JSON.stringify(sqlPhone);
      const okPending = JSON.stringify([...new Set(uiPending)].sort()) === JSON.stringify(sqlPending);
      return {
        actual: `Tìm mã ${a.code}: ${rowsCode} dòng. Tìm SĐT: UI ${[...new Set(uiCodes)].join(',')} (API total ${lr.meta?.total}) vs SQL ${sqlPhone.join(',')}. Lọc Chờ thanh toán: UI ${[...new Set(uiPending)].join(',')} (API total ${fr.meta?.total}) vs SQL ${sqlPending.join(',')}`,
        evidence: `${ev1}, ${ev2}; SQL: SELECT code FROM orders … phone='0901000001' / status='PENDING_PAYMENT'`,
        verdict: rowsCode >= 1 && okPhone && okPending ? 'PASS' : 'FAIL',
        data: { cod: a.code, bank: b.code },
      };
    } finally {
      await s.close();
    }
  });
}

// ---------- U5-11 / U5-12: "Đã nhận tiền"
async function confirmPaymentCase(id, role, label) {
  await runCase(rec, { id, role: label, journey: '"Đã nhận tiền" đơn chuyển khoản lẻ (khách chuyển sai nội dung)', steps: `uat_returning đặt đơn chuyển khoản; khoản CK nội dung "chuyen tien hang" (giả ngân hàng: Pancake không ghép được); ${label} mở đơn → "Đã nhận tiền" + mã GD → xác nhận; gọi lại API lần 2`, expected: 'Đơn PENDING_PAYMENT/UNPAID → CONFIRMED/PAID, paidAt ghi, lịch sử đơn ghi người bấm; lần 2 không đổi gì (idempotent); không điểm nào được cộng trước khi giao' }, async () => {
    const before = await money('uat_returning');
    const o = await placeOrder('returning', { lines: [{ sku: 'COBOTE-PW-100', qty: 2 }, { sku: 'BHN-TEA-20', qty: 1 }], paymentMethod: 'BANK_TRANSFER' });
    await waitPancake(o.code);
    const bank = bankWebhook(o.code, o.order.total, 'chuyen tien hang');
    const s = await openWebSession(role, '/admin?tab=orders');
    try {
      const p = s.page;
      await openOrder(p, o.code);
      const extra = {};
      if (role === 'ketoan') {
        extra.statusButtons = await p.getByRole('button', { name: /^(Hủy đơn|Đã đóng gói|Giao vận|Đã giao hàng)$/ }).count();
        const lr = await api('GET', `/admin/orders?search=${o.code}`, { user: 'ketoan' });
        const row = lr.body?.data?.[0];
        extra.phoneSeen = JSON.stringify({ user: row?.user?.phone, ship: row?.shippingAddress?.phone }).slice(0, 120);
        extra.pageHasFullPhone = (await p.locator('body').innerText()).includes('0901000003');
      }
      await p.getByLabel('Mã giao dịch ngân hàng').first().fill(`FT26UAT${id.replace('-', '')}`);
      const resp = waitApi(p, /\/api\/admin\/orders\/[^/]+\/confirm-payment$/);
      await p.getByRole('button', { name: 'Đã nhận tiền', exact: true }).first().click();
      const dlg = p.getByRole('alertdialog');
      if (await dlg.isVisible().catch(() => false)) await dlg.getByRole('button', { name: 'Đã nhận tiền', exact: true }).click();
      else {
        await dlg.waitFor({ timeout: 5000 }).catch(() => undefined);
        if (await dlg.isVisible().catch(() => false)) await dlg.getByRole('button', { name: 'Đã nhận tiền', exact: true }).click();
      }
      const r = await resp;
      await p.waitForLoadState('networkidle').catch(() => undefined);
      const ev = await shot(p, `orders-confirm-payment-${role}-1440`);
      const after = await ord(o.code);
      const again = await api('POST', `/admin/orders/${after.id}/confirm-payment`, { user: role, body: {} });
      const after2 = await ord(o.code);
      const hist = await history(after.id);
      const m = await money('uat_returning');
      const okKt = role !== 'ketoan' || (extra.statusButtons === 0 && !extra.pageHasFullPhone && !/0901000003/.test(extra.phoneSeen));
      const ok = r.status() < 300 && after.status === 'CONFIRMED' && after.paymentStatus === 'PAID' && after.paidAt && after2.paidAt === after.paidAt && m.points === before.points && hist.some((h) => h.actorId === `uat_${role}`) && okKt;
      return {
        actual: `Giả NH: matched=${bank.matched}. UI confirm-payment → ${r.status()}. DB: ${after.status}/${after.paymentStatus} paidAt=${after.paidAt}. Gọi lại → ${again.status} ${brief(again.body, 80)}, paidAt giữ nguyên=${after2.paidAt === after.paidAt}. Điểm ${before.points}→${m.points}. Lịch sử: ${brief(hist.map((h) => `${h.fromStatus}→${h.toStatus} by ${h.actorId}`).join('; '), 160)}${role === 'ketoan' ? `. KẾ TOÁN: nút trạng thái=${extra.statusButtons}, SĐT API ${extra.phoneSeen}, trang có SĐT đầy đủ=${extra.pageHasFullPhone}` : ''}`,
        evidence: `${ev}; đơn ${o.code} tổng ${o.order.total}đ; SQL orders.status/paymentStatus/paidAt + order_status_history`,
        verdict: ok ? 'PASS' : 'FAIL',
      };
    } finally {
      await s.close();
    }
  });
}
if (want('U5-11')) await confirmPaymentCase('U5-11', 'admin', 'ADMIN');
if (want('U5-12')) await confirmPaymentCase('U5-12', 'ketoan', 'KẾ TOÁN');

// ---------- U5-13: huỷ đơn COD
if (want('U5-13')) {
  await runCase(rec, { id: 'U5-13', role: 'ADMIN', journey: 'Huỷ đơn COD đã xác nhận', steps: 'uat_returning đặt COD 3×FUWA-HW-500 (đã lên giả Pancake); admin mở đơn → "Hủy đơn" → lý do → "Huỷ đơn"', expected: 'Đơn CANCELLED, tồn kho trả lại đủ 3, giả Pancake nhận lệnh huỷ, không phát sinh hoàn tiền/ví (khách chưa trả), lịch sử đơn ghi lý do' }, async () => {
    const [v0] = await q(`SELECT stock FROM variations WHERE sku = 'FUWA-HW-500'`);
    const before = await money('uat_returning');
    const o = await placeOrder('returning', { lines: [{ sku: 'FUWA-HW-500', qty: 3 }], paymentMethod: 'COD' });
    const pid = await waitPancake(o.code);
    const [v1] = await q(`SELECT stock FROM variations WHERE sku = 'FUWA-HW-500'`);
    const s = await openWebSession('admin', '/admin?tab=orders');
    try {
      const p = s.page;
      await openOrder(p, o.code);
      await p.getByRole('button', { name: 'Hủy đơn', exact: true }).click();
      const dlg = p.getByRole('alertdialog');
      await dlg.waitFor({ timeout: 10_000 });
      const dlgText = await dlg.innerText();
      await dlg.getByRole('textbox').fill('UAT: khách đổi ý qua hotline');
      const resp = waitApi(p, /\/api\/admin\/orders\/[^/]+\/status$/, 'PUT');
      await dlg.getByRole('button', { name: 'Huỷ đơn', exact: true }).click();
      const r = await resp;
      await p.waitForLoadState('networkidle').catch(() => undefined);
      const ev = await shot(p, 'orders-cancel-cod-1440');
      await sleep(1500);
      const after = await ord(o.code);
      const [v2] = await q(`SELECT stock FROM variations WHERE sku = 'FUWA-HW-500'`);
      const m = await money('uat_returning');
      const refunds = await q(`SELECT kind, amount::int, status FROM order_customer_refunds WHERE "orderId" = $1`, after.id);
      const hist = await history(after.id);
      const reqs = await (await fetch(`http://127.0.0.1:3258/__uat/requests`)).json().catch(() => []);
      const pancakeCancel = (Array.isArray(reqs) ? reqs : reqs.requests ?? []).filter((x) => String(x.path ?? x.url ?? '').includes(String(pid)) && /PUT/i.test(x.method ?? ''));
      const ok = r.status() < 300 && after.status === 'CANCELLED' && v2.stock === v0.stock && v1.stock === v0.stock - 3 && m.wallet === before.wallet && refunds.length === 0 && hist.some((h) => h.toStatus === 'CANCELLED' && /đổi ý/.test(h.note ?? ''));
      return {
        actual: `PUT status → ${r.status()}; DB ${after.status}/${after.paymentStatus}. Tồn kho ${v0.stock}→${v1.stock} (đặt)→${v2.stock} (huỷ). Ví ${before.wallet}→${m.wallet}, refund rows ${refunds.length}. Giả Pancake PUT đơn ${pid}: ${pancakeCancel.length} lời gọi${pancakeCancel[0] ? ` ${brief(pancakeCancel[0].body ?? pancakeCancel[0], 100)}` : ''}. Hộp thoại: "${brief(dlgText.replace(/\n/g, ' / '), 200)}"`,
        evidence: `${ev}; SQL variations.stock, order_customer_refunds, order_status_history (note), /__uat/requests`,
        verdict: ok ? 'PASS' : 'FAIL',
      };
    } finally {
      await s.close();
    }
  });
}

// ---------- U5-14: huỷ đơn chuyển khoản đã trả = hoàn toàn phần vào Ví
if (want('U5-14')) {
  await runCase(rec, { id: 'U5-14', role: 'ADMIN', journey: 'Hoàn tiền toàn phần: huỷ đơn chuyển khoản đã PAID (dùng điểm)', steps: 'uat_returning đặt chuyển khoản, dùng 5.000 điểm; giả NH chuyển đủ đúng nội dung (Pancake ghép → PAID); admin mở đơn → "Hủy đơn" → xác nhận', expected: 'D2: hoàn đủ tổng đơn vào Ví Tubu ngay; trả lại 5.000 điểm đã dùng; walletBalance = SUM(wallet_transactions.delta); pointsBalance = SUM(sổ STANDARD); đơn CANCELLED/REFUNDED' }, async () => {
    const before = await money('uat_returning');
    const o = await placeOrder('returning', { lines: [{ sku: 'COBOTE-PW-100', qty: 3 }], paymentMethod: 'BANK_TRANSFER', pointsToUse: 5000 });
    await waitPancake(o.code);
    const mid0 = await money('uat_returning');
    const paid = bankWebhook(o.code, o.order.total, `${o.code} thanh toan`);
    const mid = await ord(o.code);
    const s = await openWebSession('admin', '/admin?tab=orders');
    try {
      const p = s.page;
      await openOrder(p, o.code);
      await p.getByRole('button', { name: 'Hủy đơn', exact: true }).click();
      const dlg = p.getByRole('alertdialog');
      await dlg.waitFor({ timeout: 10_000 });
      const dlgText = await dlg.innerText();
      const resp = waitApi(p, /\/api\/admin\/orders\/[^/]+\/status$/, 'PUT');
      await dlg.getByRole('button', { name: 'Huỷ đơn', exact: true }).click();
      const r = await resp;
      await p.waitForLoadState('networkidle').catch(() => undefined);
      const ev = await shot(p, 'orders-cancel-paid-refund-1440');
      await sleep(1000);
      const after = await ord(o.code);
      const m = await money('uat_returning');
      const wtx = await q(`SELECT delta::int, type, reason, "refId" FROM wallet_transactions WHERE "userId" = 'uat_returning' ORDER BY "createdAt" DESC LIMIT 3`);
      const ptx = await q(`SELECT delta::int, reason FROM points_transactions WHERE "userId" = 'uat_returning' ORDER BY "createdAt" DESC LIMIT 3`);
      const ok = r.status() < 300 && after.status === 'CANCELLED' && m.wallet - before.wallet === o.order.total && m.wallet === m.walletLedger && m.points === before.points && m.points === m.pointsLedger && mid0.points === before.points - 5000;
      return {
        actual: `Sau CK: ${mid.status}/${mid.paymentStatus} (bank matched=${paid.matched}). Huỷ → ${r.status()}; DB ${after.status}/${after.paymentStatus}. Ví ${before.wallet}→${m.wallet} (+${m.wallet - before.wallet}, tổng đơn ${o.order.total}), SUM(sổ ví)=${m.walletLedger}. Điểm ${before.points}→${mid0.points} (đặt)→${m.points} (huỷ), SUM(sổ)=${m.pointsLedger}. Sổ ví mới nhất: ${brief(wtx[0], 120)}; sổ điểm: ${brief(ptx.slice(0, 2), 160)}. Hộp thoại: "${brief(dlgText.replace(/\n/g, ' / '), 220)}"`,
        evidence: `${ev}; SQL users.walletBalance vs SUM(wallet_transactions.delta), pointsBalance vs SUM(points_transactions STANDARD)`,
        verdict: ok ? 'PASS' : 'FAIL',
      };
    } finally {
      await s.close();
    }
  });
}

// ---------- U5-15: trả một phần → hoàn ngân hàng → KẾ TOÁN chi
if (want('U5-15')) {
  await runCase(rec, { id: 'U5-15', role: 'CSKH + KHO + KẾ TOÁN', journey: 'Hoàn tiền một phần: trả 1 trong 2 dòng của đơn đã giao, hoàn về ngân hàng', steps: 'uat_new đặt COD 2 dòng (2×COBOTE-PW-100 + 1×BHN-PP-200), Pancake giao xong; khách xin trả 1×BHN-PP-200 về TK ngân hàng; CSKH duyệt (API); KHO "Đã nhận hàng về"; KẾ TOÁN tab "Hoàn tiền khách" → "Bắt đầu chuyển khoản" → "Đã chuyển" + mã GD', expected: 'Tiền hoàn = giá dòng trả (95.000đ, không hoàn ship vì lỗi khách); điểm đơn bị thu lại đúng phần dòng trả; khoản hoàn PENDING → PROCESSING → COMPLETED có bankRef; đơn vẫn DELIVERED (trả một phần)' }, async () => {
    const o = await placeOrder('new', { lines: [{ sku: 'COBOTE-PW-100', qty: 2 }, { sku: 'BHN-PP-200', qty: 1 }], paymentMethod: 'COD' });
    await waitPancake(o.code);
    await sendOrderStatus(L, o.code, 'shipped');
    const dl = await sendOrderStatus(L, o.code, 'delivered');
    const del = await ord(o.code);
    const ptsAfterDeliver = await money('uat_new');
    const items = await q(`SELECT oi.id, v.sku, oi.quantity, oi."unitPrice"::int AS unit FROM order_items oi JOIN variations v ON v.id = oi."variationId" WHERE oi."orderId" = $1`, del.id);
    const line = items.find((i) => i.sku === 'BHN-PP-200');
    const est = await api('POST', `/orders/${o.code}/return-estimate`, { user: 'new', body: { reasonCode: 'OTHER', items: [{ orderItemId: line.id, quantity: 1 }] } });
    const rr = await api('POST', `/orders/${o.code}/return-request`, {
      user: 'new',
      body: { reasonCode: 'OTHER', reason: 'Không hợp mùi', items: [{ orderItemId: line.id, quantity: 1 }], refundMethod: 'BANK', bankName: 'Vietcombank', accountNumber: '0071000123456', accountName: 'NGUYEN VAN MOI' },
    });
    if (!rr.ok) throw new Error(`return-request ${rr.status} ${brief(rr.body, 300)}`);
    const reqId = rr.body.id ?? rr.body.request?.id;
    const pv = await api('GET', `/admin/return-requests/${reqId}/preview`, { user: 'cskh' });
    const rv = await api('POST', `/admin/return-requests/${reqId}/review`, { user: 'cskh', body: { approve: true, note: 'UAT duyệt trả 1 dòng', expectedRefund: pv.body?.refundAmount ?? pv.body?.total } });
    const rcv = await api('POST', `/admin/return-requests/${reqId}/received`, { user: 'kho', body: {} });
    const [rq] = await q(`SELECT status, "refundAmount"::int, "shippingRefund"::int, "pointsReversed"::int, "refundMethod", "fullReturn" FROM return_requests WHERE id = $1`, reqId);
    const ptsAfterReturn = await money('uat_new');
    const [ref0] = await q(`SELECT id, kind, status, amount::int, "bankAccountNo" FROM order_customer_refunds WHERE "orderId" = $1`, del.id);
    // KẾ TOÁN chi trên web
    const s = await openWebSession('ketoan', '/admin?tab=customerRefunds');
    let ev = '';
    let claimSt = 0;
    let paidSt = 0;
    try {
      const p = s.page;
      await p.getByText(o.code).first().waitFor({ timeout: 90_000 });
      ev = await shot(p, 'refunds-ketoan-queue-1440');
      const claimBtn = p.getByRole('button', { name: 'Bắt đầu chuyển khoản', exact: true }).first();
      if (await claimBtn.count()) {
        const cr = waitApi(p, /\/api\/admin\/customer-refunds\/[^/]+\/claim$/);
        await claimBtn.click();
        const d = p.getByRole('alertdialog');
        await d.waitFor({ timeout: 10_000 });
        await d.getByRole('button').last().click();
        claimSt = (await cr).status();
        await p.waitForLoadState('networkidle').catch(() => undefined);
      }
      await p.getByRole('button', { name: /^Đã chuyển khoản/ }).first().click();
      const d2 = p.getByRole('alertdialog');
      await d2.waitFor({ timeout: 10_000 });
      await d2.getByLabel(/Mã giao dịch ngân hàng/).fill('FT26UATREFUND15');
      const mr = waitApi(p, /\/api\/admin\/customer-refunds\/[^/]+\/mark-paid$/);
      await d2.getByRole('button').last().click();
      paidSt = (await mr).status();
      await p.waitForLoadState('networkidle').catch(() => undefined);
      ev += `, ${await shot(p, 'refunds-ketoan-paid-1440')}`;
    } finally {
      await s.close();
    }
    const [ref1] = await q(`SELECT kind, status, amount::int, "bankRef", "completedBy" FROM order_customer_refunds WHERE "orderId" = $1`, del.id);
    const after = await ord(o.code);
    const pts = await q(`SELECT delta::int, reason FROM points_transactions WHERE "refId" = $1 OR reason LIKE $2 ORDER BY "createdAt"`, del.id, `%${o.code}%`);
    const earned = pts.filter((x) => x.delta > 0).reduce((a, x) => a + x.delta, 0);
    const reversed = -pts.filter((x) => x.delta < 0).reduce((a, x) => a + x.delta, 0);
    const lineShare = Math.round((earned * line.unit) / (items.reduce((a, i) => a + i.unit * i.quantity, 0)));
    const ok = rq?.status === 'APPROVED' && rq.refundAmount === line.unit && rq.shippingRefund === 0 && ref1?.status === 'COMPLETED' && ref1.amount === line.unit && ref1.bankRef === 'FT26UATREFUND15' && after.status === 'DELIVERED' && Math.abs(reversed - lineShare) <= 1 && ptsAfterReturn.points === ptsAfterReturn.pointsLedger;
    return {
      actual: `Giao: ${dl.order?.status}. Ước tính ${est.status} ${brief(est.body, 100)}. Yêu cầu ${rr.status}; CSKH duyệt ${rv.status}; KHO nhận ${rcv.status}. return_requests: ${brief(rq, 160)}. Khoản hoàn trước chi: ${brief(ref0, 120)}. KẾ TOÁN claim ${claimSt}, mark-paid ${paidSt} → ${brief(ref1, 140)}. Đơn ${after.status}. Điểm: cộng ${earned}, thu lại ${reversed} (phần dòng ≈ ${lineShare}); điểm ${ptsAfterDeliver.points}→${ptsAfterReturn.points}, SUM(sổ)=${ptsAfterReturn.pointsLedger}`,
      evidence: `${ev}; SQL return_requests, order_customer_refunds, points_transactions theo đơn ${o.code}`,
      verdict: ok ? 'PASS' : 'FAIL',
    };
  });
}

rec.save();
await done();
