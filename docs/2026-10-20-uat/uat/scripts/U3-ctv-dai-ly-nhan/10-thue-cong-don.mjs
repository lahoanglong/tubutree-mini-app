#!/usr/bin/env node
// U3-46..U3-49 (ca mới, chạy lại 2026-10-22): thuế TNCN cộng dồn tháng VN (Q2) và tự hoàn thuế giữ dư khi từ chối lệnh rút (Q2b).
// Ví dụ của chủ: A 1.500.000đ (Yêu cầu) + B 1.000.000đ cùng tháng → B giữ 250.000đ; admin từ chối A → 250.000đ tự hoàn.
// Dựng: mỗi CTV mới có đơn qua mã giới thiệu → giao → đủ 10 ngày → APPROVED, rồi hoa hồng được đặt đúng số tiền ví dụ bằng SQL
// (đơn thật chỉ ~9.600đ; dựng đơn 18 triệu mỗi lần làm cạn tồn kho lane). Mọi lệnh rút, duyệt, từ chối, chi đi qua API thật.
// Dùng: node 10-thue-cong-don.mjs
import { L, api, apiOk, closeDb, deliver, ensureUser, exec, log, matureCommissions, openWeb, placeOrderApi, recorder, short, shot, sql, variationBySku } from './u3lib.mjs';

const R = recorder('10-thue-cong-don');
const RUN = Date.now().toString(36).slice(-5);
const vnd = (n) => `${Number(n).toLocaleString('vi-VN')}đ`;
const TAXID = '079123456789';
const bank = { bankName: 'Techcombank', accountNumber: '19031234567', accountName: 'NGUYEN VAN CTV' };
const ADMIN = 'uat_admin';
let seq = 0;

async function newCtv(tag) {
  const id = `uat_u3q${tag}${RUN}`;
  await ensureUser(id, { phone: `0907${String(Date.now()).slice(-6)}`, name: `CTV thuế ${tag}` });
  await apiOk(L, 'POST', '/affiliate/register', { user: id, body: { termsVersion: 'uat-u3' } });
  const u = (await sql(`SELECT "referralCode" FROM users WHERE id = $1`, id))[0];
  return { id, code: u.referralCode };
}

/** Một khoản hoa hồng APPROVED đúng `amount` cho CTV (đơn thật qua mã, rồi đặt số tiền bằng SQL). */
async function approvedCommission(ctv, amount) {
  const buyer = `uat_u3qb${RUN}${++seq}`;
  await ensureUser(buyer, { phone: `0908${String(Date.now()).slice(-6)}` });
  const v = await variationBySku('FUWA-DW-1L');
  const o = await placeOrderApi(buyer, [{ variationId: v.id, quantity: 1 }], { referralCode: ctv.code });
  await deliver(o.code);
  await matureCommissions(o.code);
  const n = await exec(
    `UPDATE commissions SET amount = $2 WHERE status = 'APPROVED' AND "payoutBatchId" IS NULL AND "affiliateUserId" = $1 AND "orderId" = (SELECT id FROM orders WHERE code = $3)`,
    ctv.id, amount, o.code,
  );
  if (n !== 1) throw new Error(`không đặt được hoa hồng ${amount} cho ${ctv.id} (đơn ${o.code}, ${n} dòng)`);
  return o.code;
}

async function available(ctv) {
  return (await sql(`SELECT COALESCE(SUM(amount),0)::int s FROM commissions WHERE "affiliateUserId" = $1 AND status = 'APPROVED' AND "payoutBatchId" IS NULL`, ctv.id))[0].s;
}

async function rut(ctv, method = 'BANK') {
  const amount = await available(ctv);
  const r = await api(L, 'POST', '/affiliate/payouts', {
    user: ctv.id,
    headers: { 'idempotency-key': `u3-${ctv.id}-${++seq}` },
    body: { amount, method, ...(method === 'BANK' ? { bankInfo: bank } : {}), taxId: TAXID },
  });
  const row = r.ok
    ? (await sql(`SELECT id, status::text s, method::text m, "grossAmount"::int g, "taxWithheld"::int tax, "taxRefunded"::int ref, amount::int amt FROM payouts WHERE "userId" = $1 ORDER BY "requestedAt" DESC, id DESC LIMIT 1`, ctv.id))[0]
    : null;
  return { http: r.status, body: r.body, row, amount };
}

const payoutRow = async (id) =>
  (await sql(`SELECT id, status::text s, "grossAmount"::int g, "taxWithheld"::int tax, "taxRefunded"::int ref, amount::int amt FROM payouts WHERE id = $1`, id))[0];
const walletOf = async (id) =>
  (await sql(`SELECT "walletBalance"::int b, (SELECT COALESCE(SUM(delta),0)::int FROM wallet_transactions w WHERE w."userId" = $1) led FROM users WHERE id = $1`, id))[0];
const refundRows = (id) => sql(`SELECT delta::int d, type::text t, "refId", reason FROM wallet_transactions WHERE "userId" = $1 AND type::text = 'PIT_REFUND' ORDER BY "createdAt"`, id);
const pitOk = (r) => r.http < 300 && r.row;

let web;
try {
  // ---------- U3-46: cộng dồn tháng, B của ví dụ chủ giữ 250.000đ ----------
  const c1 = await newCtv('a');
  await approvedCommission(c1, 1_500_000);
  const A1 = await rut(c1);
  await approvedCommission(c1, 1_000_000);
  const B1 = await rut(c1);
  R.add({
    id: 'U3-46', role: 'CTV', journey: 'Thuế TNCN cộng dồn tháng (Q2)', title: 'A 1.500.000đ (Yêu cầu) + B 1.000.000đ cùng tháng: A không thuế, B giữ 250.000đ',
    steps: `${c1.id}: hoa hồng 1.500.000đ → POST /affiliate/payouts BANK (A); hoa hồng 1.000.000đ → rút tiếp (B), cùng tháng VN`,
    expected: 'A: gross 1.500.000, thuế 0, thực nhận 1.500.000 (tổng tháng 1,5 triệu < 2 triệu); B: gross 1.000.000, thuế 250.000 = 10% × 2.500.000 − 0, thực nhận 750.000',
    actual: { A: A1.row, B: B1.row, http: [A1.http, B1.http] },
    evidence: `SQL payouts: A ${short(A1.row)}; B ${short(B1.row)}`,
    status: pitOk(A1) && pitOk(B1) && A1.row.s === 'REQUESTED' && A1.row.g === 1_500_000 && A1.row.tax === 0 && A1.row.amt === 1_500_000 &&
      B1.row.s === 'REQUESTED' && B1.row.g === 1_000_000 && B1.row.tax === 250_000 && B1.row.amt === 750_000 ? 'PASS' : 'FAIL',
  });

  // ---------- U3-47: từ chối A khi B còn "Yêu cầu" → B giảm thuế, tăng thực nhận ngay ----------
  const w47a = await walletOf(c1.id);
  const rej1 = await api(L, 'POST', `/admin/payouts/${A1.row.id}/reject`, { user: ADMIN, body: { reason: 'UAT U3-47: sai số tài khoản' } });
  const A1b = await payoutRow(A1.row.id);
  const B1b = await payoutRow(B1.row.id);
  const w47b = await walletOf(c1.id);
  const refunds47 = await refundRows(c1.id);
  const avail47 = await available(c1);
  web = await openWeb('admin', { width: 1440, path: '/admin?tab=payouts' });
  const w = web.page;
  const card = w.locator('div.rounded-card').filter({ hasText: vnd(B1b.amt) }).filter({ hasText: c1.code }).first();
  let uiOk = false;
  try {
    await card.waitFor({ timeout: 90_000 });
    uiOk = true;
  } catch { /* chụp ảnh bên dưới để xem */ }
  const s47 = await shot(w, 'U3-47-admin-lenh-B-sau-tu-choi-A');
  const cardText = uiOk ? (await card.innerText()).replace(/\s+/g, ' ') : null;
  await web.close();
  web = null;
  R.add({
    id: 'U3-47', role: 'ADMIN / CTV', journey: 'Từ chối lệnh rút tự hoàn thuế giữ dư (Q2b), lệnh còn Yêu cầu', title: 'Từ chối A: lệnh B còn "Yêu cầu" giảm thuế 250.000đ → 0, tăng thực nhận 750.000đ → 1.000.000đ',
    steps: `ADMIN POST /admin/payouts/${A1.row.id}/reject; web admin 1440 /admin?tab=payouts xem thẻ lệnh B`,
    expected: 'A REJECTED, hoa hồng của A về APPROVED (rút lại được 1.500.000đ); B vẫn REQUESTED, taxWithheld 0, amount 1.000.000, taxRefunded 0; Ví KHÔNG đổi, không có dòng PIT_REFUND (tránh trả hai lần nếu B bị từ chối); thẻ B trên admin hiện 1.000.000đ',
    actual: { rejectHttp: rej1.status, A: A1b, B: B1b, wallet: [w47a, w47b], pitRefundRows: refunds47.length, availableAfter: avail47, cardText },
    evidence: `${s47}; SQL A ${short(A1b)}; B ${short(B1b)}; ví ${w47a.b}→${w47b.b} (sổ ${w47b.led}); dòng PIT_REFUND ${refunds47.length}; thẻ B: ${short(cardText, 300)}`,
    status: rej1.status < 300 && A1b.s === 'REJECTED' && avail47 === 1_500_000 && B1b.s === 'REQUESTED' && B1b.tax === 0 && B1b.amt === 1_000_000 && B1b.ref === 0 &&
      w47b.b === w47a.b && refunds47.length === 0 && uiOk ? 'PASS' : 'FAIL',
  });

  // ---------- U3-48: B đã duyệt, rồi từ chối A → hoàn vào Ví ----------
  const c2 = await newCtv('b');
  await approvedCommission(c2, 1_500_000);
  const A2 = await rut(c2);
  await approvedCommission(c2, 1_000_000);
  const B2 = await rut(c2);
  const ap2 = await api(L, 'POST', `/admin/payouts/${B2.row.id}/approve`, { user: ADMIN, body: { expectedAmount: B2.row.amt } });
  const w48a = await walletOf(c2.id);
  const rej2 = await api(L, 'POST', `/admin/payouts/${A2.row.id}/reject`, { user: ADMIN, body: { reason: 'UAT U3-48: sai số tài khoản' } });
  const B2b = await payoutRow(B2.row.id);
  const w48b = await walletOf(c2.id);
  const refunds48 = await refundRows(c2.id);
  // Kế toán chi B theo số đã duyệt, báo cáo thuế tháng: thu nhập 1.000.000 = thuế thực giữ 0 + thực nhận 750.000 + đã hoàn Ví 250.000.
  const pay2 = await api(L, 'POST', `/admin/payouts/${B2.row.id}/mark-paid`, { user: 'uat_ketoan', body: { bankRef: `FT26U3Q${RUN}`, expectedAmount: B2.row.amt } });
  const month = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 7);
  const pit2 = await apiOk(L, 'GET', `/admin/payouts/pit-report?month=${month}`, { user: 'uat_ketoan' });
  const pitRow2 = (pit2.rows ?? []).find((r) => r.userId === c2.id);
  R.add({
    id: 'U3-48', role: 'ADMIN / KẾ TOÁN / CTV', journey: 'Từ chối lệnh rút tự hoàn thuế giữ dư (Q2b), lệnh đã duyệt → Ví', title: 'B đã duyệt (thuế 250.000đ), từ chối A: Ví cộng 250.000đ dòng "Hoàn thuế TNCN giữ dư"',
    steps: `${c2.id}: A 1.500.000đ, B 1.000.000đ (thuế 250.000đ) cùng tháng; ADMIN duyệt B; ADMIN từ chối A; kế toán chi B; GET /admin/payouts/pit-report?month=${month}`,
    expected: 'Ví +250.000đ đúng 1 dòng PIT_REFUND ("Hoàn thuế TNCN giữ dư…"), sổ Ví = số dư; B taxRefunded 250.000, thực nhận chuyển khoản vẫn 750.000đ; báo cáo tháng: thuế thực giữ 0, gross 1.000.000, thực nhận 1.000.000',
    actual: { approveHttp: ap2.status, A: await payoutRow(A2.row.id), B: B2b, rejectHttp: rej2.status, wallet: [w48a, w48b], refunds: refunds48, markPaidHttp: pay2.status, pitRow: pitRow2 },
    evidence: `SQL B ${short(B2b)}; ví ${w48a.b}→${w48b.b} (sổ ${w48b.led}); wallet_transactions PIT_REFUND ${short(refunds48)}; pit-report ${short(pitRow2)}`,
    status: ap2.status < 300 && rej2.status < 300 && B2.row.tax === 250_000 && B2b.s === 'APPROVED' && B2b.ref === 250_000 && B2b.amt === 750_000 && w48b.b === w48a.b + 250_000 &&
      w48b.b === w48b.led && refunds48.length === 1 && refunds48[0].d === 250_000 && /Hoàn thuế TNCN giữ dư/.test(refunds48[0].reason) && pay2.status < 300 &&
      pitRow2?.taxWithheld === 0 && pitRow2?.grossAmount === 1_000_000 && pitRow2?.netAmount === 1_000_000 ? 'PASS' : 'FAIL',
  });

  // ---------- U3-49: B rút về Ví (chi ngay), từ chối A → hoàn Ví; rút tiếp trong tháng không bị truy thu sai ----------
  const c3 = await newCtv('c');
  await approvedCommission(c3, 1_500_000);
  const A3 = await rut(c3);
  await approvedCommission(c3, 1_000_000);
  const B3 = await rut(c3, 'WALLET_BALANCE');
  const w49a = await walletOf(c3.id);
  const rej3 = await api(L, 'POST', `/admin/payouts/${A3.row.id}/reject`, { user: ADMIN, body: { reason: 'UAT U3-49: sai số tài khoản' } });
  const B3b = await payoutRow(B3.row.id);
  const w49b = await walletOf(c3.id);
  const refunds49 = await refundRows(c3.id);
  // Hoa hồng của A đã trả về APPROVED; rút lại trong tháng: tổng tháng = B 1.000.000 + A 1.500.000 = 2,5 triệu → thuế phải giữ 250.000,
  // thuế đã giữ ròng ở B = 250.000 − 250.000 hoàn = 0 → lần này giữ đúng 250.000 (không bỏ sót vì tưởng B còn giữ, không giữ gấp đôi).
  const C3 = await rut(c3, 'WALLET_BALANCE');
  R.add({
    id: 'U3-49', role: 'ADMIN / CTV', journey: 'Từ chối lệnh rút tự hoàn thuế giữ dư (Q2b), rút về Ví', title: 'B rút về Ví (thuế 250.000đ, Ví +750.000đ), từ chối A: Ví +250.000đ; rút lại 1.500.000đ cùng tháng bị giữ đúng 250.000đ (không truy thu sai)',
    steps: `${c3.id}: A 1.500.000đ BANK (Yêu cầu); B 1.000.000đ rút về Ví; ADMIN từ chối A; rút lại hoa hồng của A (1.500.000đ) về Ví`,
    expected: 'Trước từ chối: B thuế 250.000, Ví +750.000. Sau từ chối: Ví +250.000 (1 dòng PIT_REFUND), B taxRefunded 250.000. rút lại 1.500.000đ: thuế 250.000 = 10% × (1.000.000 + 1.500.000) − thuế giữ ròng ở B (250.000 − 250.000 = 0), Ví +1.250.000; sổ Ví = số dư',
    actual: { B: B3.row, rejectHttp: rej3.status, Bafter: B3b, wallet: [w49a, w49b], refunds: refunds49, C: C3.row },
    evidence: `SQL B ${short(B3b)}; ví trước từ chối ${w49a.b}, sau ${w49b.b}; PIT_REFUND ${short(refunds49)}; rút lại ${short(C3.row)}; sổ Ví cuối ${(await walletOf(c3.id)).led} = số dư ${(await walletOf(c3.id)).b}`,
    status: B3.row.tax === 250_000 && B3.row.amt === 750_000 && B3.row.s === 'PAID' && rej3.status < 300 && w49b.b === w49a.b + 250_000 && refunds49.length === 1 && refunds49[0].d === 250_000 &&
      B3b.ref === 250_000 && C3.row?.g === 1_500_000 && C3.row?.tax === 250_000 && C3.row?.amt === 1_250_000 && (await walletOf(c3.id)).b === (await walletOf(c3.id)).led ? 'PASS' : 'FAIL',
  });
  log('xong');
} catch (e) {
  console.error(e);
  if (web) await shot(web.page, 'U3-46-49-loi-web');
  R.add({ id: 'U3-46..49', title: 'script lỗi', status: 'BLOCKED', actual: e instanceof Error ? e.message : String(e) });
} finally {
  await web?.close().catch(() => undefined);
  R.save();
  await closeDb();
}
