#!/usr/bin/env node
// U3-24..U3-34: kênh đại lý /dealer (uat_dealer, bậc DEALER_2: chiết khấu 30%, hạn mức 20.000.000đ, NET 15).
// Bảng giá theo bậc, đơn sỉ (tối thiểu 3 triệu, miễn ship từ 5 triệu theo luật đã chốt), trả trước + kế toán xác nhận,
// ghi công nợ + hạn mức, nợ quá hạn, đại lý "Báo đã CK" và kế toán ghi nhận trả nợ, thưởng quý, phần thưởng mốc,
// mã giới thiệu của đại lý. Đối soát: SUM(dealer_credit_ledgers) = currentDebt, từng dòng sổ khớp đơn/khoản trả.
// Dùng: node 04-dai-ly.mjs
import fs from 'node:fs';
import path from 'node:path';
import {
  OUT, jobExitIssues, L, api, apiOk, closeDb, commissionsOf, deliver, ensureAddress, ensureUser, log, openMini, orderRow, placeOrderApi,
  recorder, runJob, short, shot, sleep, sql, exec, variationBySku,
} from './u3lib.mjs';

const R = recorder('04-dai-ly');
const RUN = Date.now().toString(36).slice(-5);
const D = 'uat_dealer';
const vnd = (n) => `${Number(n).toLocaleString('vi-VN')}đ`;
const debtOf = async () => (await sql(`SELECT COALESCE(SUM(delta),0)::bigint d, count(*)::int n FROM dealer_credit_ledgers WHERE "userId" = $1`, D))[0];
const ledgerOf = (refId) => sql(`SELECT "refType", "refId", delta::int, note, "createdAt" FROM dealer_credit_ledgers WHERE "userId" = $1 AND "refId" = $2`, D, refId);
const dorder = async (code) =>
  (await sql(`SELECT id, code, type::text, status::text, "paymentStatus"::text ps, subtotal::int, "shippingFee"::int ship, total::int, "createdAt" FROM orders WHERE code = $1`, code))[0];
const SKUS = ['COBOTE-TR-50', 'POLANG-LG-10', 'FUWA-HW-500', 'HEC-FW-120', 'HEC-CL-80', 'VIS-CL-300', 'FUWA-FL-2L', 'HEC-DEO-50', 'LP-DRIP-10', 'BHN-PP-200', 'POLANG-GG-100', 'HEC-SH-300', 'SOK-CO-500', 'FUWA-BT-500', 'LP-ROB-250', 'SOK-CH-500', 'VIS-LIP-4', 'LP-INS-12'];

/** Dòng hàng cho đơn đại lý có tiền hàng (giá đại lý) ≥ target, không đụng phần đặt trước (giữ 10 tồn). */
async function dealerLines(target, price, { skip = [] } = {}) {
  const out = [];
  let left = target;
  const FLASH = ['BHN-CGL-100', 'BHN-CW-500', 'BHN-HN-500'];
  const rest = price.filter((x) => !SKUS.includes(x.sku)).sort((a, b) => b.stock * b.dealerPrice - a.stock * a.dealerPrice).map((x) => x.sku);
  for (const sku of [...SKUS, ...rest]) {
    if (left <= 0) break;
    if (skip.includes(sku) || FLASH.includes(sku)) continue;
    const r = price.find((x) => x.sku === sku);
    if (!r) continue;
    const q = Math.min(Math.max(0, r.stock - 10), Math.ceil(left / r.dealerPrice), 999);
    if (q <= 0) continue;
    out.push({ variationId: r.variationId, quantity: q, sku, unit: r.dealerPrice });
    left -= q * r.dealerPrice;
  }
  if (left > 0) throw new Error(`không đủ tồn cho đơn đại lý ${target}đ`);
  return out;
}
const sumLines = (ls) => ls.reduce((s, l) => s + l.unit * l.quantity, 0);
/** Doanh số đã chốt của đại lý trong [from, to) theo đúng luật DealerService.dealerVolume. */
const settledVolume = async (from, to) =>
  (await sql(
    `SELECT COALESCE(SUM(o.total),0)::bigint s FROM orders o WHERE o."userId" = $1 AND o.type = 'DEALER' AND o."createdAt" >= $2 AND o."createdAt" < $3
       AND o.status::text IN ('PACKED','SHIPPING','DELIVERED') AND o."paymentStatus"::text NOT IN ('REFUNDED','FAILED')
       AND (o."paymentStatus" = 'PAID' OR EXISTS (SELECT 1 FROM dealer_credit_ledgers l WHERE l."userId" = o."userId" AND l."refType" = 'ORDER' AND l."refId" = o.id))`,
    D, from, to,
  ))[0].s;
/** 'Q4/2026' → [đầu quý, đầu quý sau) giờ VN. */
function quarterRange(key) {
  const [, qn, yr] = key.match(/^Q(\d)\/(\d{4})$/);
  const q = Number(qn) - 1;
  const y = Number(yr);
  const VN = 7 * 3600_000;
  return [new Date(Date.UTC(y, q * 3, 1) - VN), new Date(Date.UTC(q === 3 ? y + 1 : y, q === 3 ? 0 : q * 3 + 3, 1) - VN)];
}
async function placeDealer(items, paymentMethod, key) {
  return api(L, 'POST', '/dealer/orders', {
    user: D,
    headers: { 'idempotency-key': key ?? `u3-d-${RUN}-${Math.random().toString(36).slice(2, 8)}` },
    body: { items: items.map(({ variationId, quantity }) => ({ variationId, quantity })), paymentMethod },
  });
}
async function ketoanPay(amount, tag) {
  return api(L, 'POST', `/admin/dealers/${D}/credit-payment`, {
    user: 'uat_ketoan',
    headers: { 'idempotency-key': `u3-kt-${RUN}-${tag}` },
    body: { amount, bankRef: `FTU3${RUN}${tag}`.toUpperCase().slice(0, 40), note: `UAT U3 ${tag}` },
  });
}
async function pasteAndPlace(p, text, method) {
  await p.getByRole('button', { name: 'Dán đơn' }).click();
  await p.locator('textarea').fill(text);
  await p.getByRole('button', { name: 'Thêm vào đơn' }).click();
  await p.getByText(/Khớp \d+ dòng/).waitFor({ timeout: 10_000 });
  const matched = await p.getByText(/Khớp \d+ dòng/).innerText();
  await p.keyboard.press('Escape');
  await p.waitForTimeout(600);
  if (await p.locator('textarea').isVisible().catch(() => false)) {
    await p.getByRole('button', { name: /Đóng/ }).first().click().catch(() => undefined);
    await p.waitForTimeout(600);
  }
  if (!method) return { matched };
  const resp = p.waitForResponse((r) => r.url().endsWith('/api/dealer/orders') && r.request().method() === 'POST', { timeout: 30_000 });
  await p.getByRole('button', { name: method === 'PREPAID' ? 'Trả trước' : 'Ghi công nợ' }).click();
  const r = await resp;
  return { matched, status: r.status(), body: await r.json().catch(() => null) };
}

let mini;
try {
  const dealerUser = (await sql(`SELECT phone FROM users WHERE id = $1`, D))[0];
  await ensureAddress(D, dealerUser.phone);
  // Chạy lại được: trả hết dư nợ còn lại của lượt trước bằng chính đường kế toán ghi nhận.
  const d00 = await debtOf();
  if (Number(d00.d) > 0) await ketoanPay(Number(d00.d), 'reset');
  const d0 = await debtOf();
  log('dư nợ đầu lượt', d0);

  // ---------- U3-24 bảng giá theo bậc ----------
  const price = await apiOk(L, 'GET', '/dealer/pricelist', { user: D });
  const me0 = await apiOk(L, 'GET', '/dealer/me', { user: D });
  const wrong = price.filter((r) => r.dealerPrice !== Math.round(r.retailPrice * 0.7));
  const dw5 = price.find((r) => r.sku === 'FUWA-DW-5L');
  const partnerRows = (await sql(`SELECT count(*)::int n FROM variations v JOIN products p ON p.id = v."productId" WHERE p."storefrontId" IS NOT NULL AND v.id = ANY($1::text[])`, price.map((r) => r.variationId)))[0].n;
  mini = await openMini(D, { path: '/dealer' });
  let p = mini.page;
  await p.getByText('FUWA-DW-5L').first().waitFor({ timeout: 30_000 }).catch(() => undefined);
  await p.getByPlaceholder('Tìm theo tên / SKU / thương hiệu').fill('FUWA-DW');
  await p.waitForTimeout(900);
  const ui24 = await p.evaluate(() => document.body.innerText);
  const s24 = await shot(p, 'U3-24-dai-ly-bang-gia');
  await p.getByPlaceholder('Tìm theo tên / SKU / thương hiệu').fill('');
  R.add({
    id: 'U3-24', role: 'Đại lý', journey: '/dealer bảng giá theo bậc', title: 'Bảng giá đại lý Cấp 2 = giá lẻ × 0,7; thẻ bậc + hạn mức + dư nợ',
    steps: 'Mini App uat_dealer mở /dealer → tab "Bảng giá" → tìm "FUWA-DW"; GET /dealer/pricelist, /dealer/me',
    expected: 'Mọi dòng dealerPrice = round(retailPrice × (1 − 0,3)) khi không có giá riêng; FUWA-DW-5L 480.000 → 336.000; không có hàng đối tác; thẻ "Hạn mức: 20.000.000 ₫"',
    actual: { rows: price.length, wrongRows: wrong.length, dw5: dw5 && { retail: dw5.retailPrice, dealer: dw5.dealerPrice, pct: dw5.discountPct }, partnerRows, tier: me0.tier?.name, limit: me0.tier?.creditLimit, debt: me0.currentDebt, uiHas336: /336\.000/.test(ui24), uiLimit: /Hạn mức: 20\.000\.000/.test(ui24) },
    evidence: `${s24}; API pricelist ${price.length} dòng, lệch công thức ${wrong.length}; FUWA-DW-5L ${dw5?.retailPrice}→${dw5?.dealerPrice}; SQL biến thể đối tác trong bảng giá: ${partnerRows}`,
    status: price.length > 0 && wrong.length === 0 && dw5?.dealerPrice === 336000 && partnerRows === 0 && me0.tier?.creditLimit === 20000000 && /336\.000/.test(ui24) ? 'PASS' : 'FAIL',
  });

  // ---------- U3-25 đơn sỉ dưới 3 triệu ----------
  // Luật (gói dai-ly, D11-01): tối thiểu dealer.min_order_value_vnd = 3.000.000đ tiền hàng; Mini App chặn trước ở thanh đặt (hai nút tắt),
  // API trả 400 DEALER_ORDER_BELOW_MIN.
  const orders25a = (await sql(`SELECT count(*)::int n FROM orders WHERE "userId" = $1 AND type = 'DEALER'`, D))[0].n;
  const r25 = await pasteAndPlace(p, 'FUWA-DW-1L 2');
  await p.waitForTimeout(800);
  const minText = await p.getByText(/Đơn tối thiểu 3\.000\.000/).first().innerText().catch(() => null);
  const prepaidOff = await p.getByRole('button', { name: 'Trả trước' }).isDisabled().catch(() => null);
  const creditOff = await p.getByRole('button', { name: 'Ghi công nợ' }).isDisabled().catch(() => null);
  const s25 = await shot(p, 'U3-25-don-si-duoi-3-trieu-bi-chan');
  const v25 = price.find((r) => r.sku === 'FUWA-DW-1L');
  const a25 = await placeDealer([{ variationId: v25.variationId, quantity: 2 }], 'PREPAID');
  const orders25b = (await sql(`SELECT count(*)::int n FROM orders WHERE "userId" = $1 AND type = 'DEALER'`, D))[0].n;
  R.add({
    id: 'U3-25', role: 'Đại lý', journey: 'Đơn sỉ tối thiểu 3 triệu', title: 'Dán đơn "FUWA-DW-1L 2" (168.000đ): giao diện chặn, API 400',
    steps: '/dealer → "Dán đơn" → "FUWA-DW-1L 2" → "Thêm vào đơn" → xem thanh đặt; POST /dealer/orders PREPAID cùng dòng',
    expected: 'Thanh đặt báo "Đơn tối thiểu 3.000.000đ tiền hàng — thêm …", cả "Trả trước" và "Ghi công nợ" tắt; API 400 code DEALER_ORDER_BELOW_MIN; số đơn đại lý không đổi',
    actual: { paste: r25.matched, minText, prepaidOff, creditOff, api: [a25.status, a25.body?.code, a25.body?.message], ordersBefore: orders25a, ordersAfter: orders25b },
    evidence: `${s25}; UI "${minText}"; nút Trả trước tắt=${prepaidOff}, Ghi công nợ tắt=${creditOff}; HTTP POST /dealer/orders ${a25.status} ${short(a25.body, 240)}; SQL count(orders DEALER) ${orders25a}→${orders25b}`,
    status: !!minText && prepaidOff === true && creditOff === true && a25.status === 400 && a25.body?.code === 'DEALER_ORDER_BELOW_MIN' && orders25b === orders25a ? 'PASS' : 'FAIL',
    data: { knownId: 'D11-01' },
  });

  // ---------- U3-26 đơn 3–5 triệu: phí giao ----------
  // Luật (Q7 chọn (1), gói dai-ly): dưới 5.000.000đ tiền hàng thu dealer.shipping_fee_below_threshold_vnd (19.000đ), tính vào total.
  const fee = Number((await sql(`SELECT value::text v FROM system_configs WHERE key = 'dealer.shipping_fee_below_threshold_vnd'`))[0].v);
  const l26 = await dealerLines(4_000_000, price);
  await p.getByRole('button', { name: 'Dán đơn' }).click();
  await p.locator('textarea').fill(l26.map((l) => `${l.sku} ${l.quantity}`).join('\n'));
  await p.getByRole('button', { name: 'Thêm vào đơn' }).click();
  await p.getByText(/Khớp \d+ dòng/).waitFor({ timeout: 10_000 });
  await p.keyboard.press('Escape');
  await p.waitForTimeout(800);
  const feeText = await p.getByText(/Phí giao/).first().innerText().catch(() => null);
  const s26 = await shot(p, 'U3-26-don-si-duoi-5-trieu-phi-giao');
  const p26 = await placeDealer(l26, 'PREPAID');
  const o26 = p26.ok ? await dorder(p26.body.code) : null;
  R.add({
    id: 'U3-26', role: 'Đại lý', journey: 'Phí giao đơn sỉ dưới 5 triệu', title: `Đơn sỉ trả trước ${vnd(sumLines(l26))} (dưới 5 triệu)`,
    steps: `Dán ${l26.length} dòng vào /dealer xem thanh đặt; POST /dealer/orders PREPAID ${l26.map((l) => `${l.sku}×${l.quantity}`).join(', ')}`,
    expected: `Luật mới: đơn 3–5 triệu thu phí giao ${vnd(fee)} (dealer.shipping_fee_below_threshold_vnd): Mini App hiện "Phí giao ${vnd(fee)}"; orders.shippingFee ${fee}, total = tiền hàng + phí`,
    actual: { feeCfg: fee, feeText, status: p26.status, order: o26, sumLines: sumLines(l26) },
    evidence: `${s26}; UI "${feeText}"; HTTP ${p26.status}; SQL orders ${short(o26)}`,
    status: p26.ok && o26?.ship === fee && o26.subtotal === sumLines(l26) && o26.total === o26.subtotal + fee && new RegExp(`Phí giao ${vnd(fee).replace('.', '\\.')}`).test(feeText ?? '') ? 'PASS' : 'FAIL',
    data: { knownId: 'D11-01' },
  });

  // ---------- U3-27 trả trước: kế toán xác nhận ----------
  const ck27 = await api(L, 'POST', `/admin/dealer-orders/${o26.code}/confirm-payment`, { user: 'uat_ketoan', body: { bankRef: `FTU3${RUN}PRE`.toUpperCase(), note: 'UAT U3-27' } });
  const o27 = await dorder(o26.code);
  const h27 = await sql(`SELECT "fromStatus" f, "toStatus" t, "actorType" a, "actorId" by, note FROM order_status_history WHERE "orderId" = $1 ORDER BY "createdAt"`, o26.id);
  const led27 = await ledgerOf(o26.id);
  R.add({
    id: 'U3-27', role: 'Kế toán', journey: 'Đơn trả trước', title: 'KẾ TOÁN xác nhận đã nhận chuyển khoản đơn trả trước',
    steps: `POST /admin/dealer-orders/${o26.code}/confirm-payment (uat_ketoan, bankRef)`,
    expected: '2xx; paymentStatus PAID, status rời PENDING_PAYMENT; có lịch sử trạng thái ghi bankRef; KHÔNG có dòng sổ công nợ (trả trước)',
    actual: { status: ck27.status, order: o27, history: h27, ledger: led27 },
    evidence: `HTTP ${ck27.status}; SQL orders ${short({ s: o27.status, ps: o27.ps })}; order_status_history ${short(h27, 300)}; dealer_credit_ledgers ${led27.length} dòng`,
    status: ck27.ok && o27.ps === 'PAID' && o27.status !== 'PENDING_PAYMENT' && led27.length === 0 ? 'PASS' : 'FAIL',
  });

  // ---------- U3-28 ghi công nợ ≥ 5 triệu qua giao diện ----------
  const l28 = await dealerLines(6_000_000, price, { skip: l26.map((l) => l.sku) });
  const before28 = await debtOf();
  await mini.goto('/dealer');
  p = mini.page;
  await p.getByRole('button', { name: 'Dán đơn' }).waitFor({ timeout: 30_000 });
  const r28 = await pasteAndPlace(p, l28.map((l) => `${l.sku} ${l.quantity}`).join('\n'), 'CREDIT');
  await p.waitForTimeout(1500);
  const ui28 = await p.evaluate(() => document.body.innerText);
  const s28 = await shot(p, 'U3-28-ghi-cong-no');
  const o28 = await dorder(r28.body.code);
  const led28 = await ledgerOf(o28.id);
  const after28 = await debtOf();
  const me28 = await apiOk(L, 'GET', '/dealer/me', { user: D });
  R.add({
    id: 'U3-28', role: 'Đại lý', journey: 'Ghi công nợ', title: `Dán ${l28.length} dòng (${vnd(sumLines(l28))}) → "Ghi công nợ"`,
    steps: '/dealer → "Dán đơn" → các dòng SKU + số lượng → "Thêm vào đơn" → "Ghi công nợ"',
    expected: 'Đơn CONFIRMED, total = Σ giá đại lý × SL, shippingFee 0 (≥ 5 triệu); 1 dòng sổ ORDER +total; currentDebt = SUM(sổ) = dư nợ trước + total',
    actual: { status: r28.status, order: o28, ledger: led28.map((x) => [x.refType, x.delta]), before: Number(before28.d), after: Number(after28.d), apiDebt: me28.currentDebt, expectTotal: sumLines(l28) },
    evidence: `${s28}; HTTP ${r28.status}; SQL orders ${short({ code: o28.code, s: o28.status, total: o28.total, ship: o28.ship })}; SQL SUM(dealer_credit_ledgers) ${before28.d}→${after28.d}; GET /dealer/me currentDebt ${me28.currentDebt}`,
    status: r28.status === 201 && o28.status === 'CONFIRMED' && o28.total === sumLines(l28) && o28.ship === 0 && led28.length === 1 && led28[0].delta === o28.total && Number(after28.d) === Number(before28.d) + o28.total && me28.currentDebt === Number(after28.d) ? 'PASS' : 'FAIL',
    data: { uiDebtShown: ui28.includes(Number(after28.d).toLocaleString('vi-VN')) },
  });

  // ---------- U3-29 vượt hạn mức ----------
  const room = 20_000_000 - Number(after28.d);
  const l29 = await dealerLines(room + 500_000, price, { skip: [...l26, ...l28].map((l) => l.sku) });
  const r29ui = await pasteAndPlace(p, l29.map((l) => `${l.sku} ${l.quantity}`).join('\n'));
  await p.waitForTimeout(800);
  const overText = await p.getByText('Vượt hạn mức công nợ — chọn Trả trước hoặc giảm số lượng.').isVisible().catch(() => false);
  const creditDisabled = await p.getByRole('button', { name: 'Ghi công nợ' }).isDisabled().catch(() => null);
  const s29 = await shot(p, 'U3-29-vuot-han-muc');
  const p29 = await placeDealer(l29, 'CREDIT');
  const after29 = await debtOf();
  const orders29 = (await sql(`SELECT count(*)::int n FROM orders WHERE "userId" = $1 AND type = 'DEALER'`, D))[0].n;
  await mini.close();
  mini = null;
  R.add({
    id: 'U3-29', role: 'Đại lý', journey: 'Hạn mức công nợ 20 triệu', title: `Giỏ ${vnd(sumLines(l29))} khi còn hạn mức ${vnd(room)}`,
    steps: '/dealer → "Dán đơn" giỏ vượt hạn mức → xem thanh đặt; POST /dealer/orders CREDIT cùng giỏ',
    expected: 'Giao diện báo "Vượt hạn mức công nợ…", nút "Ghi công nợ" tắt; API 400 "Vượt hạn mức công nợ."; sổ công nợ không đổi',
    actual: { paste: r29ui.matched, overText, creditDisabled, api: [p29.status, p29.body?.message], debt: [Number(after28.d), Number(after29.d)], ordersAfter: orders29 },
    evidence: `${s29}; HTTP ${p29.status} "${p29.body?.message}"; SQL SUM(dealer_credit_ledgers) ${after28.d}→${after29.d}`,
    status: overText && creditDisabled === true && p29.status === 400 && /Vượt hạn mức/.test(p29.body?.message ?? '') && Number(after29.d) === Number(after28.d) ? 'PASS' : 'FAIL',
  });

  // ---------- U3-30 nợ quá hạn NET 15 ----------
  // Luật (Q7 (1)): còn nợ đơn quá hạn NET 15 thì khoá đơn CREDIT (400 DEALER_CREDIT_OVERDUE); đơn PREPAID vẫn đặt được.
  await exec(`UPDATE dealer_credit_ledgers SET "createdAt" = now() - interval '20 days' WHERE "userId" = $1 AND "refType" = 'ORDER' AND "refId" = $2`, D, o28.id);
  const usedFor30 = [...l26, ...l28, ...l29].map((l) => l.sku);
  const l30 = await dealerLines(3_100_000, price, { skip: usedFor30 });
  const debt30a = await debtOf();
  const p30 = await placeDealer(l30, 'CREDIT');
  const debt30b = await debtOf();
  const p30pre = await placeDealer(l30, 'PREPAID');
  const o30pre = p30pre.ok ? await dorder(p30pre.body.code) : null;
  const age = (await sql(`SELECT "createdAt"::text c FROM dealer_credit_ledgers WHERE "refId" = $1`, o28.id))[0];
  R.add({
    id: 'U3-30', role: 'Đại lý', journey: 'Khoá mua chịu khi nợ quá hạn', title: 'Nợ đơn cũ đã 20 ngày (NET 15) → đặt thêm đơn "Ghi công nợ"; trả trước vẫn được',
    steps: `Lùi dealer_credit_ledgers.createdAt của ${o28.code} về 20 ngày trước; POST /dealer/orders CREDIT ${vnd(sumLines(l30))} (${l30.length} dòng), rồi PREPAID cùng giỏ`,
    expected: 'CREDIT 400 code DEALER_CREDIT_OVERDUE, sổ công nợ không đổi; PREPAID 201 (PENDING_PAYMENT, không dòng sổ)',
    actual: { credit: [p30.status, p30.body?.code, p30.body?.message], debt: [Number(debt30a.d), Number(debt30b.d)], prepaid: [p30pre.status, o30pre?.status], overdueLedgerCreatedAt: age.c },
    evidence: `SQL ledger ${o28.code} createdAt ${age.c}; HTTP CREDIT ${p30.status} ${short(p30.body, 240)}; SQL SUM sổ ${debt30a.d}→${debt30b.d}; HTTP PREPAID ${p30pre.status} ${short(o30pre)}`,
    status: p30.status === 400 && p30.body?.code === 'DEALER_CREDIT_OVERDUE' && Number(debt30b.d) === Number(debt30a.d) && p30pre.status === 201 && o30pre?.status === 'PENDING_PAYMENT' ? 'PASS' : 'FAIL',
    data: { knownId: 'D11-01' },
  });

  // ---------- U3-31 đại lý "Báo đã CK" không trừ nợ; kế toán ghi nhận mới trừ ----------
  const before31 = await debtOf();
  mini = await openMini(D, { path: '/dealer' });
  p = mini.page;
  await p.getByRole('tab', { name: 'Công nợ' }).or(p.getByRole('button', { name: 'Công nợ', exact: true })).first().click();
  await p.getByPlaceholder('Số tiền đã chuyển').fill('2000000');
  const rep = p.waitForResponse((r) => r.url().endsWith('/api/dealer/credit-payment') && r.request().method() === 'POST', { timeout: 20_000 });
  await p.getByRole('button', { name: 'Báo đã CK' }).click();
  const repr = await rep;
  await p.waitForTimeout(1000);
  const s31a = await shot(p, 'U3-31-dai-ly-bao-da-ck');
  await mini.close();
  mini = null;
  const mid31 = await debtOf();
  const over31 = await ketoanPay(Number(mid31.d) + 1_000_000, 'over');
  const pay31 = await ketoanPay(2_000_000, 'pay');
  const after31 = await debtOf();
  const me31 = await apiOk(L, 'GET', '/dealer/me', { user: D });
  const payRow = (await sql(`SELECT "refType", delta::int, note FROM dealer_credit_ledgers WHERE "userId" = $1 AND "refType" = 'PAYMENT' ORDER BY "createdAt" DESC LIMIT 1`, D))[0];
  R.add({
    id: 'U3-31', role: 'Đại lý / Kế toán', journey: 'Trả nợ', title: 'Đại lý "Báo đã CK" 2.000.000đ; KẾ TOÁN ghi nhận trả nợ',
    steps: '/dealer → "Công nợ" → "Số tiền đã chuyển" 2000000 → "Báo đã CK"; uat_ketoan POST /admin/dealers/uat_dealer/credit-payment (vượt dư nợ, rồi 2.000.000đ)',
    expected: '"Báo đã CK" 2xx nhưng sổ không đổi; kế toán ghi số lớn hơn dư nợ → 400; ghi 2.000.000đ → dòng PAYMENT −2.000.000 có bankRef, currentDebt = SUM(sổ) giảm đúng 2.000.000',
    actual: { report: repr.status(), debt: [Number(before31.d), Number(mid31.d), Number(after31.d)], over: [over31.status, over31.body?.message], pay: pay31.status, payRow, apiDebt: me31.currentDebt },
    evidence: `${s31a}; HTTP báo CK ${repr.status()}; SQL SUM sổ ${before31.d}→${mid31.d} (sau báo CK)→${after31.d} (sau kế toán); HTTP kế toán vượt ${over31.status}, đúng ${pay31.status}; dòng ${short(payRow)}`,
    status: repr.status() < 300 && Number(mid31.d) === Number(before31.d) && over31.status === 400 && pay31.ok && Number(after31.d) === Number(mid31.d) - 2_000_000 && payRow?.delta === -2_000_000 && me31.currentDebt === Number(after31.d) ? 'PASS' : 'FAIL',
  });

  // ---------- U3-32 thưởng quý ----------
  // Kỳ chưa trả thưởng gần nhất (lượt chạy lại lùi dần Q3/2026 → Q2/2026 …) để job idempotent không bỏ qua.
  const paidQ = new Set((await sql(`SELECT "refId" FROM dealer_credit_ledgers WHERE "userId" = $1 AND "refType" = 'QUARTER_BONUS'`, D)).map((x) => x.refId));
  let qy = 2026;
  let qi = 2;
  while (paidQ.has(`Q${qi + 1}/${qy}`)) {
    qi -= 1;
    if (qi < 0) { qi = 3; qy -= 1; }
  }
  const qKey = `Q${qi + 1}/${qy}`;
  const VN = 7 * 3600_000;
  const qStart = new Date(Date.UTC(qy, qi * 3, 1) - VN);
  const qMid = new Date(qStart.getTime() + 20 * 86_400_000);
  const nextQ = new Date(Date.UTC(qi === 3 ? qy + 1 : qy, qi === 3 ? 0 : qi * 3 + 3, 10, 4) - VN);
  const qCodes = [];
  const usedSkus = [...l26, ...l28, ...l29, ...l30].map((l) => l.sku);
  for (let i = 0; i < 3; i++) {
    const dnow = Number((await debtOf()).d);
    if (dnow > 0) await ketoanPay(dnow, `pre${i}`);
    const price32 = await apiOk(L, 'GET', '/dealer/pricelist', { user: D });
    const ls = await dealerLines(18_000_000, price32, { skip: usedSkus });
    const r = await placeDealer(ls, 'CREDIT');
    if (!r.ok) throw new Error(`đơn thưởng quý ${i} ${r.status}: ${JSON.stringify(r.body).slice(0, 300)}`);
    await deliver(r.body.code);
    const o = await dorder(r.body.code);
    qCodes.push(o);
    await ketoanPay(o.total, `q${i}`);
  }
  for (const o of qCodes) await exec(`UPDATE orders SET "createdAt" = $2 WHERE id = $1`, o.id, qMid);
  // Doanh số đã chốt của kỳ theo đúng luật dealerVolume (gồm cả đơn lượt trước đã lùi vào kỳ này nếu kỳ chưa trả thưởng).
  const qEnd = new Date(Date.UTC(qi === 3 ? qy + 1 : qy, qi === 3 ? 0 : qi * 3 + 3, 1) - VN);
  const revenue = await settledVolume(qStart, qEnd);
  const expPct = revenue >= 200_000_000 ? 4 : revenue >= 100_000_000 ? 3 : revenue >= 50_000_000 ? 2 : 0;
  const expBonus = Math.round((revenue * expPct) / 100);
  const before32 = await debtOf();
  const job = runJob('DealerService.payoutQuarterlyBonuses', [{ $date: nextQ.toISOString() }]);
  const after32 = await debtOf();
  const bonusRow = (await sql(`SELECT delta::int, note FROM dealer_credit_ledgers WHERE "userId" = $1 AND "refType" = 'QUARTER_BONUS' AND "refId" = $2`, D, qKey))[0];
  const job2 = runJob('DealerService.payoutQuarterlyBonuses', [{ $date: nextQ.toISOString() }]);
  const bonusRows = (await sql(`SELECT count(*)::int n FROM dealer_credit_ledgers WHERE "userId" = $1 AND "refType" = 'QUARTER_BONUS' AND "refId" = $2`, D, qKey))[0].n;
  const noti = (await sql(`SELECT count(*)::int n FROM notification_logs WHERE "userId" = $1 AND "templateCode" = 'DEALER_BONUS_PAID' AND "sentAt" > now() - interval '30 minutes'`, D).catch((e) => [{ n: e.meta?.message ?? 'lỗi' }]))[0].n;
  R.add({
    id: 'U3-32', role: 'Đại lý / hệ thống', journey: 'Thưởng doanh số quý', title: `Thưởng ${qKey}: đơn công nợ đã giao, doanh số đã chốt ${vnd(revenue)}`,
    steps: `3 đơn CREDIT (${qCodes.map((o) => o.code).join(', ')}) → webhook giao → kế toán ghi trả từng đơn → lùi orders.createdAt vào ${qKey} → run-job DealerService.payoutQuarterlyBonuses(now=${nextQ.toISOString()}) hai lần`,
    expected: `Bậc mặc định ≥50tr 2%, ≥100tr 3%, ≥200tr 4% → thưởng ${vnd(expBonus)}; 1 dòng sổ QUARTER_BONUS −thưởng; chạy lại không trả lần 2; dư nợ giảm đúng số thưởng`,
    actual: { revenue, expBonus, job: job.result ?? job.error, job2: job2.result ?? job2.error, bonusRow, bonusRows, debt: [Number(before32.d), Number(after32.d)], noti },
    evidence: `SQL doanh số đã chốt ${qKey} (DELIVERED/PACKED/SHIPPING + PAID hoặc có dòng sổ ORDER) ${revenue}; dealer_credit_ledgers QUARTER_BONUS ${short(bonusRow)} (${bonusRows} dòng); SUM sổ ${before32.d}→${after32.d}; notifications DEALER_BONUS_PAID ${noti}`,
    status: expBonus > 0 && bonusRow?.delta === -expBonus && bonusRows === 1 && Number(after32.d) === Number(before32.d) - expBonus ? 'PASS' : 'FAIL',
  });

  // ---------- U3-33 phần thưởng mốc (tour/quà) ----------
  const reward = await apiOk(L, 'POST', '/admin/dealer-rewards', {
    user: 'uat_admin',
    body: { brandId: '75ae0443eea88aa90f3c2bec9bc3ece1', type: 'GIFT', title: `Quà mốc UAT ${RUN}`, description: 'Đạt 5 triệu doanh số đã chốt trong quý', threshold: 5_000_000, period: 'QUARTER' },
  });
  const o28d = await deliver(o28.code).catch((e) => ({ err: e.message }));
  mini = await openMini(D, { path: '/dealer' });
  p = mini.page;
  await p.getByRole('tab', { name: 'Báo cáo' }).or(p.getByRole('button', { name: 'Báo cáo', exact: true })).first().click();
  const card = p.getByText(`Quà mốc UAT ${RUN}`).first();
  await card.waitFor({ timeout: 20_000 }).catch(() => undefined);
  await card.scrollIntoViewIfNeeded().catch(() => undefined);
  const claimResp = p.waitForResponse((r) => /\/api\/dealer\/rewards\/[^/]+\/claim$/.test(new URL(r.url()).pathname), { timeout: 20_000 });
  // Thẻ kỳ hiện tại đứng trước thẻ kỳ trước (rewardsProgress: [...current, ...previous]).
  const claimBtn = card.locator('xpath=ancestor::*[.//button[normalize-space()="Yêu cầu nhận thưởng"]][1]').getByRole('button', { name: 'Yêu cầu nhận thưởng' }).first();
  await claimBtn.click();
  const cr = await claimResp;
  await p.waitForTimeout(1000);
  const s33 = await shot(p, 'U3-33-dai-ly-yeu-cau-nhan-thuong');
  await mini.close();
  mini = null;
  const claim = (await sql(`SELECT id, status::text, "periodKey", threshold::int, "volumeAtClaim"::int vol FROM dealer_reward_claims WHERE "userId" = $1 AND "rewardId" = $2`, D, reward.id))[0];
  const ktApprove = await api(L, 'POST', `/admin/dealer-reward-claims/${claim.id}/approve`, { user: 'uat_ketoan', body: {} });
  const ap = await api(L, 'POST', `/admin/dealer-reward-claims/${claim.id}/approve`, { user: 'uat_admin', body: { note: 'UAT' } });
  const mp = await api(L, 'POST', `/admin/dealer-reward-claims/${claim.id}/mark-paid`, { user: 'uat_ketoan', body: { note: 'Đã trao quà' } });
  const claim2 = (await sql(`SELECT status::text, "reviewedBy", "paidBy" FROM dealer_reward_claims WHERE id = $1`, claim.id))[0];
  const curVol = await settledVolume(...quarterRange(claim.periodKey));
  R.add({
    id: 'U3-33', role: 'Đại lý / ADMIN / Kế toán', journey: 'Phần thưởng mốc đại lý', title: 'ADMIN tạo quà mốc 5 triệu/quý; đại lý bấm "Yêu cầu nhận thưởng"; duyệt rồi chi',
    steps: `POST /admin/dealer-rewards (brand Fuwa3e, 5.000.000/quý); giao ${o28.code}; /dealer → "Báo cáo" → "Yêu cầu nhận thưởng"; uat_ketoan approve (kỳ vọng 403), uat_admin approve, uat_ketoan mark-paid`,
    expected: 'claim kỳ hiện tại (Q4/2026) PENDING với volumeAtClaim = doanh số đã chốt của kỳ (SQL); KẾ TOÁN không duyệt được (403); ADMIN duyệt → APPROVED; KẾ TOÁN chi → PAID (paidBy)',
    actual: { deliver28: o28d, claimHttp: cr.status(), claim, sqlVol: curVol, ktApprove: ktApprove.status, approve: ap.status, markPaid: mp.status, claim2 },
    evidence: `${s33}; HTTP claim ${cr.status()}; SQL dealer_reward_claims ${short(claim)} → ${short(claim2)}; SQL doanh số đã chốt ${claim.periodKey} ${curVol}`,
    status: cr.status() < 300 && claim?.status === 'PENDING' && claim.periodKey === 'Q4/2026' && claim.vol === curVol && ktApprove.status === 403 && ap.ok && mp.ok && claim2.status === 'PAID' && claim2.paidBy === 'uat_ketoan' ? 'PASS' : 'FAIL',
    data: { rewardId: reward.id },
  });

  // ---------- U3-34 mã giới thiệu của đại lý ----------
  const BUY = `uat_u3dlb${RUN}`;
  await ensureUser(BUY, { phone: `0907${String(Date.now()).slice(-6)}` });
  const v34 = await variationBySku('FUWA-DW-1L');
  const o34 = await placeOrderApi(BUY, [{ variationId: v34.id, quantity: 2 }], { referralCode: 'UATDEALER' });
  const r34 = await orderRow(o34.code);
  const c34 = await commissionsOf(o34.code);
  const paid34 = (await sql(`SELECT COALESCE(SUM("paidTotal"),0)::int s FROM order_items oi JOIN orders o ON o.id = oi."orderId" WHERE o.code = $1`, o34.code).catch(() => [{ s: null }]))[0].s;
  R.add({
    id: 'U3-34', role: 'Đại lý / khách mới', journey: 'Đại lý giới thiệu khách lẻ', title: 'Khách mới đặt đơn lẻ với mã UATDEALER',
    steps: `POST /checkout/place-order referralCode=UATDEALER (khách ${BUY}, FUWA-DW-1L×2)`,
    expected: 'DEALER thuộc affiliate.commission_eligible_roles → referrer uat_dealer, hoa hồng 8% tiền hàng đã trả, PENDING',
    actual: { order: { code: o34.code, ref: r34.referrerUserId }, commissions: c34.map((c) => ({ u: c.affiliateUserId, s: c.status, amt: c.amount })), paid34 },
    evidence: `SQL orders.referrerUserId ${r34.referrerUserId}; commissions ${short(c34.map((c) => [c.affiliateUserId, c.status, c.amount]))}; SUM paidTotal ${paid34}`,
    status: r34.referrerUserId === D && c34.length === 1 && c34[0].affiliateUserId === D && c34[0].amount === Math.floor((paid34 * 8) / 100) && c34[0].status === 'PENDING' ? 'PASS' : 'FAIL',
  });

  // Đối soát cuối: SUM sổ = currentDebt, mỗi dòng ORDER khớp total đơn.
  const fin = await debtOf();
  const meF = await apiOk(L, 'GET', '/dealer/me', { user: D });
  const mism = await sql(`SELECT l."refId", l.delta::int, o.total::int FROM dealer_credit_ledgers l JOIN orders o ON o.id = l."refId" WHERE l."userId" = $1 AND l."refType" = 'ORDER' AND l.delta <> o.total`, D);
  log('đối soát cuối', { sum: fin.d, rows: fin.n, apiDebt: meF.currentDebt, mismatch: mism.length });
  fs.writeFileSync(path.join(OUT, '04-doi-soat.json'), JSON.stringify({ at: new Date().toISOString(), ledgerSum: Number(fin.d), ledgerRows: fin.n, apiDebt: meF.currentDebt, orderRowMismatch: mism, jobExitIssues }, null, 2));
} catch (e) {
  console.error(e);
  R.add({ id: 'U3-24..34', title: 'script lỗi', actual: String(e?.message ?? e).slice(0, 600), status: 'BLOCKED' });
} finally {
  await mini?.close().catch(() => undefined);
  R.save();
  await closeDb();
}
