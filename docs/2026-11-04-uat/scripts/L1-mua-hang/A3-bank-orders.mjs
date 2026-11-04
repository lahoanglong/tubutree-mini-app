// A3: chuyển khoản QR + webhook ngân hàng (đủ, thiếu, thừa, trùng, sai nội dung, quá hạn), huỷ đơn chờ, mua lại, danh sách/chi tiết đơn, giao xong cộng điểm.
// Chạy sau A1, A2:  node /Users/longla/coding/tubutree-mini-app/.claude/worktrees/gl-1103-docs/docs/2026-11-04-uat/scripts/L1-mua-hang/A3-bank-orders.mjs [lọc-id]
import { execFileSync } from 'node:child_process';
import { L, H, UAT, sql, sqlExec, rec, closePrisma, api, idem, sleep } from './lib.mjs';
import { V, who, fresh, fillCart, quote, place, loadCfg, userFacts, oracle, diff, snapshot, reconcileOrder } from './kit.mjs';

const FILE = 'A3';
const only = process.argv[2];
const run = (id) => !only || id.startsWith(only);
const cfg = await loadCfg();
const msgOf = (r) => (Array.isArray(r.body?.message) ? r.body.message.join(' | ') : r.body?.message ?? JSON.stringify(r.body));
const NODE = process.execPath;
const sh = (script, args) => {
  try {
    return JSON.parse(execFileSync(NODE, [`${H}/${script}`, '1', ...args], { cwd: UAT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  } catch (e) {
    return { error: String(e.stdout || '') + String(e.stderr || '') };
  }
};
const bankWebhook = (code, amount, content) => sh('bank-webhook.mjs', [code, String(amount), ...(content === undefined ? [] : [content])]);
const pancakeHook = (code, status, extra = []) => sh('pancake-webhook.mjs', [code, status, ...extra]);

async function waitPancake(code, ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const r = (await sql(`select "pancakeOrderId" p from orders where code='${code}'`))[0];
    if (r?.p) return r.p;
    await sleep(1000);
  }
  return null;
}
const order = async (code) => (await sql(`select status, "paymentStatus" ps, total::int total, "paidAt", "pancakeAttention" att, "pancakePaidReported"::int rep, "pointsUsed"::int pu, "couponCode" cc, id from orders where code='${code}'`))[0];
const refunds = async (orderId) => sql(`select id, amount::int amount, kind, status from order_customer_refunds where "orderId"='${orderId}' order by "createdAt"`).catch(async (e) => sql(`select * from order_customer_refunds where "orderId"='${orderId}'`));
const hist = async (orderId) => sql(`select "fromStatus" f, "toStatus" t, "actorType" a, note from order_status_history where "orderId"='${orderId}' order by "createdAt"`);

/** Đặt đơn chuyển khoản mới cho persona, trả { w, code, row }. */
async function bankOrder(persona, lines, extra = {}) {
  const w = typeof persona === 'string' ? await who(persona) : persona;
  await fillCart(w, lines);
  if (extra.coupon) await api(L, 'POST', '/cart/coupon', { token: w.token, body: { code: extra.coupon } });
  const q = await quote(w, extra.pointsToUse ? { pointsToUse: extra.pointsToUse } : {});
  const p = await place(w, { paymentMethod: 'BANK_TRANSFER', expectedTotal: q.body.total, ...(extra.pointsToUse ? { pointsToUse: extra.pointsToUse } : {}) });
  if (p.status >= 300) throw new Error(`đặt đơn CK: ${p.status} ${msgOf(p)}`);
  await waitPancake(p.body.code);
  return { w, code: p.body.code, row: await order(p.body.code), q };
}

// vốn điểm cho ca dùng điểm (sổ + số dư đi cùng nhau)
async function topUp(userId, n) {
  await sqlExec(`insert into points_transactions (id, "userId", delta, reason, lot, "expiresAt") values ('uatl1_topup_${Date.now()}', '${userId}', ${n}, 'UAT_TOPUP', 'STANDARD', now() + interval '300 days')`);
  await sqlExec(`update users set "pointsBalance" = "pointsBalance" + ${n} where id = '${userId}'`);
}

// ---- B1: đặt đơn chuyển khoản, màn QR ----
let B1;
if (run('A3-01')) {
  const w = await who('returning');
  await topUp(w.userId, 20000);
  const snap0 = await snapshot(w.userId, [V.LAUNDRY, V.SERUM30]);
  B1 = await bankOrder(w, [[V.LAUNDRY, 1], [V.SERUM30, 1]], { pointsToUse: 8000 });
  const f = await userFacts(w.userId);
  const rc = await reconcileOrder(B1.code);
  const qr = await api(L, 'GET', `/payments/bank-qr/${B1.code}`, { token: w.token });
  const created = (await sql(`select "createdAt" c from orders where code='${B1.code}'`))[0].c;
  const ttl = 24;
  const exp = new Date(new Date(created).getTime() + ttl * 3600e3).getTime();
  const gotExp = new Date(qr.body.paymentDeadline ?? 0).getTime();
  const snap1 = await snapshot(w.userId, [V.LAUNDRY, V.SERUM30]);
  const probs = [...rc.problems];
  if (B1.row.status !== 'PENDING_PAYMENT' || B1.row.ps !== 'UNPAID') probs.push(`trạng thái ${B1.row.status}/${B1.row.ps}`);
  if (qr.status !== 200) probs.push(`bank-qr ${qr.status}`);
  if (Math.abs(gotExp - exp) > 120000) probs.push(`hạn CK ${qr.body.paymentDeadline} ≠ tạo+${ttl}h`);
  if (snap1.bal - snap0.bal !== -8000) probs.push(`điểm ${snap1.bal - snap0.bal}`);
  rec(FILE, { id: 'A3-01', persona: 'returning', surface: 'api', journey: 'chuyển khoản QR', step: 'đặt đơn BANK_TRANSFER 499.000đ dùng 8.000 điểm; lấy mã QR', expected: `PENDING_PAYMENT/UNPAID; QR đúng số tiền ${B1.row.total} và nội dung = mã đơn; hạn = tạo + ${ttl}h (orders.pending_payment_ttl_hours); điểm trừ 8.000; kho giữ chỗ`, actual: `${B1.row.status}/${B1.row.ps} total=${B1.row.total}; QR ${JSON.stringify(qr.body).slice(0, 380)}`, evidence: probs.join(' | ') || 'khớp SQL', status: probs.length ? 'FAIL' : 'PASS', code: B1.code });
}

// ---- B2: chuyển thiếu rồi bù ----
if (run('A3-02')) {
  const b = await bankOrder('returning', [[V.LAUNDRY, 1], [V.HANDWASH, 1]]);
  const part = 100000;
  const r1 = bankWebhook(b.code, part, `${b.code} thanh toan`);
  const a1 = await order(b.code);
  const noti = await sql(`select type, "createdAt" from notifications where "userId"='${b.w.userId}' order by "createdAt" desc limit 3`).catch(() => []);
  const okUnder = a1.status === 'PENDING_PAYMENT' && a1.ps === 'UNPAID' && /Khách chuyển thiếu/.test(a1.att ?? '') && a1.rep === part;
  rec(FILE, { id: 'A3-02a', persona: 'returning', surface: 'api', journey: 'chuyển khoản QR', step: `chuyển thiếu: ${part} / ${b.row.total}`, expected: 'đơn giữ PENDING_PAYMENT/UNPAID, "Cần xử lý Pancake: Khách chuyển thiếu …", pancakePaidReported = số đã nhận, khách được báo ORDER_UNDERPAID', actual: `${a1.status}/${a1.ps}; attention="${(a1.att ?? '').slice(0, 160)}"; reported=${a1.rep}`, evidence: `thông báo gần nhất: ${JSON.stringify(noti.map((n) => n.type))}; webhook ${JSON.stringify(r1.event ?? r1).slice(0, 120)}`, status: okUnder ? 'PASS' : 'FAIL', code: b.code });
  const rest = b.row.total - part;
  const r2 = bankWebhook(b.code, rest, `${b.code} thanh toan them`);
  const a2 = await order(b.code);
  const h = await hist(a2.id);
  const rf = await refunds(a2.id);
  const probs = [];
  if (a2.status !== 'CONFIRMED' || a2.ps !== 'PAID' || !a2.paidAt) probs.push(`sau bù: ${a2.status}/${a2.ps} paidAt=${a2.paidAt}`);
  if (a2.att && /chuyển thiếu/.test(a2.att)) probs.push('cảnh báo thiếu tiền chưa tự gỡ');
  if (rf.length) probs.push(`phát sinh hoàn tiền ${JSON.stringify(rf)}`);
  rec(FILE, { id: 'A3-02b', persona: 'returning', surface: 'api', journey: 'chuyển khoản QR', step: `bù phần còn thiếu ${rest}`, expected: 'CONFIRMED/PAID, paidAt ghi, cảnh báo thiếu tự gỡ, không có khoản hoàn', actual: `${a2.status}/${a2.ps} paidAt=${a2.paidAt}; att=${a2.att}`, evidence: `lịch sử: ${JSON.stringify(h.map((x) => `${x.f}→${x.t}(${x.a})`))}; ${probs.join(' | ') || 'khớp SQL'}`, status: probs.length ? 'FAIL' : 'PASS', code: b.code });
}

// ---- B3: đủ, đúng nội dung; ví và điểm không đổi cho tới khi giao ----
let B3;
if (run('A3-03')) {
  const w = await who('new_nophone');
  B3 = await bankOrder(w, [[V.LAUNDRY, 1]]);
  const snap0 = await snapshot(w.userId, []);
  const r = bankWebhook(B3.code, B3.row.total, `CK ${B3.code}`);
  const a = await order(B3.code);
  const snap1 = await snapshot(w.userId, []);
  const probs = [];
  if (a.status !== 'CONFIRMED' || a.ps !== 'PAID' || !a.paidAt) probs.push(`${a.status}/${a.ps}`);
  if (snap1.bal !== snap0.bal || snap1.wallet !== snap0.wallet || snap1.walletRows !== snap0.walletRows) probs.push('điểm/ví đổi khi mới thanh toán');
  rec(FILE, { id: 'A3-03', persona: 'new_nophone', surface: 'api', journey: 'chuyển khoản QR', step: 'chuyển đủ 210.000đ, nội dung "CK <mã đơn>"', expected: 'CONFIRMED/PAID; điểm và ví chưa đổi (điểm cộng khi giao)', actual: `${a.status}/${a.ps} paidAt=${a.paidAt}; điểm ${snap0.bal}→${snap1.bal}; ví ${snap0.wallet}→${snap1.wallet}`, evidence: probs.join(' | ') || 'khớp SQL', status: probs.length ? 'FAIL' : 'PASS', code: B3.code });
}

// ---- B4: chuyển thừa ----
if (run('A3-04')) {
  const b = await bankOrder('returning', [[V.LAUNDRY, 1]]);
  const over = 50000;
  const r = bankWebhook(b.code, b.row.total + over, `${b.code}`);
  const a = await order(b.code);
  const rf = await refunds(a.id);
  const w = await sql(`select coalesce(sum(delta),0)::int s from wallet_transactions where "userId"='${b.w.userId}'`);
  const probs = [];
  if (a.status !== 'CONFIRMED' || a.ps !== 'PAID') probs.push(`${a.status}/${a.ps}`);
  if (!rf.length) probs.push('không có yêu cầu hoàn phần thừa');
  else if (!rf.some((x) => x.amount === over)) probs.push(`khoản hoàn ${JSON.stringify(rf)} ≠ ${over}`);
  rec(FILE, { id: 'A3-04', persona: 'returning', surface: 'api', journey: 'chuyển khoản QR', step: `chuyển thừa ${over}đ (${b.row.total + over}/${b.row.total})`, expected: `PAID đúng tổng; phần thừa ${over}đ thành yêu cầu hoàn tiền chờ khách chọn nơi nhận (recordCumulativeOverpayment), ví chưa đổi`, actual: `${a.status}/${a.ps}; hoàn: ${JSON.stringify(rf)}; ví Σ=${w[0].s}`, evidence: probs.join(' | ') || 'khớp SQL', status: probs.length ? 'FAIL' : 'PASS', code: b.code });
  // khách thấy khoản hoàn qua API
  const mine = await api(L, 'GET', `/orders/me/refunds?orderId=${a.id}`, { token: b.w.token });
  rec(FILE, { id: 'A3-04b', persona: 'returning', surface: 'api', journey: 'chuyển khoản QR', step: 'khách xem khoản hoàn phần thừa khi khoản còn UNVERIFIED (chờ Kế toán đối soát)', expected: 'customer-refunds.service.ts CUSTOMER_VISIBLE = PENDING/PROCESSING/COMPLETED: khoản UNVERIFIED chưa hiện cho khách (đúng thiết kế); luật không nói khách có được báo "đã nhận thừa, chờ đối soát" hay không', actual: `${mine.status} ${JSON.stringify(mine.body).slice(0, 300)} (khoản SQL: ${JSON.stringify(rf)})`, status: mine.status === 200 && Array.isArray(mine.body) && mine.body.length === 0 ? 'CAN_CHU' : 'FAIL' });
}

// ---- B5: webhook gửi trùng; chuyển hai lần ----
if (run('A3-05')) {
  const b = await bankOrder('returning', [[V.LAUNDRY, 1]]);
  const first = bankWebhook(b.code, b.row.total, b.code);
  const after1 = await order(b.code);
  const h1 = (await hist(after1.id)).filter((x) => x.t === 'CONFIRMED' || x.a === 'PANCAKE').length;
  // gửi lại đúng payload cũ (Pancake gửi trùng)
  const again = pancakeHook(b.code, 'confirmed');
  const again2 = pancakeHook(b.code, 'confirmed');
  const a2 = await order(b.code);
  const rf = await refunds(a2.id);
  const h2 = (await hist(a2.id)).filter((x) => x.t === 'CONFIRMED' || x.a === 'PANCAKE').length;
  const probs = [];
  if (a2.ps !== 'PAID') probs.push(a2.ps);
  if (rf.length) probs.push(`webhook trùng sinh khoản hoàn ${JSON.stringify(rf)}`);
  if (h2 !== h1) probs.push(`lịch sử ${h1}→${h2} dòng`);
  rec(FILE, { id: 'A3-05a', persona: 'returning', surface: 'api', journey: 'chuyển khoản QR', step: 'Pancake gửi lại 2 lần webhook đơn (status 1 kèm bank_payment = tổng) sau khi đã PAID', expected: 'giữ PAID, không phát sinh khoản hoàn, lịch sử không thêm dòng', actual: `${a2.ps}; hoàn=${rf.length}; lịch sử ${h1}→${h2}; webhook ${JSON.stringify(again.event ?? again).slice(0, 100)}`, evidence: probs.join(' | ') || 'khớp SQL', status: probs.length ? 'FAIL' : 'PASS', code: b.code });
  // khách chuyển hai lần thật: thêm khoản đúng bằng tổng đơn
  const second = bankWebhook(b.code, b.row.total, `${b.code} lan 2`);
  const rf2 = await refunds(a2.id);
  rec(FILE, { id: 'A3-05b', persona: 'returning', surface: 'api', journey: 'chuyển khoản QR', step: 'khách chuyển lần 2 đúng bằng tổng đơn (đã PAID)', expected: `khoản dư ${b.row.total}đ vào hàng hoàn tiền (R3-MONEY-1)`, actual: `hoàn: ${JSON.stringify(rf2)}`, status: rf2.some((x) => x.amount === b.row.total) ? 'PASS' : 'FAIL', code: b.code });
}

// ---- B6: sai nội dung ----
if (run('A3-06')) {
  const b = await bankOrder('returning', [[V.HANDWASH, 1]]);
  const r = bankWebhook(b.code, b.row.total, 'chuyen tien hang');
  const a = await order(b.code);
  rec(FILE, { id: 'A3-06', persona: 'returning', surface: 'api', journey: 'chuyển khoản QR', step: 'chuyển đủ tiền nhưng nội dung không có mã đơn', expected: 'không tự ghép: đơn vẫn PENDING_PAYMENT/UNPAID (kế toán đối soát tay)', actual: `${a.status}/${a.ps}; webhook matched=${r.matched}`, status: a.status === 'PENDING_PAYMENT' && a.ps === 'UNPAID' && r.matched === false ? 'PASS' : 'FAIL', code: b.code });
}

// ---- B7: quá hạn, rồi tiền về muộn ----
let B7;
if (run('A3-07')) {
  const w = await who('returning');
  await topUp(w.userId, 5000);
  const b = await bankOrder(w, [[V.LAUNDRY, 1], [V.SERUM30, 1]], { pointsToUse: 5000, coupon: 'UATX10' });
  B7 = b;
  const snapA = await snapshot(w.userId, [V.LAUNDRY, V.SERUM30]);
  const redeem = (await sql(`select count(*)::int n from coupon_redemptions where "orderId"='${b.row.id}'`))[0].n;
  await sqlExec(`update orders set "createdAt" = now() - interval '25 hours' where code='${b.code}'`);
  const job = sh('run-job.mjs', ['orders.pending-payment-expiry']);
  const a = await order(b.code);
  const snapB = await snapshot(w.userId, [V.LAUNDRY, V.SERUM30]);
  const redeemAfter = (await sql(`select count(*)::int n from coupon_redemptions where "orderId"='${b.row.id}'`))[0].n;
  const probs = [];
  if (a.status !== 'CANCELLED') probs.push(`trạng thái ${a.status}`);
  if (snapB.bal - snapA.bal !== 5000) probs.push(`điểm hoàn ${snapB.bal - snapA.bal}, mong +5000`);
  if (snapB.ledgerStd - snapA.ledgerStd !== 5000) probs.push(`sổ điểm ${snapB.ledgerStd - snapA.ledgerStd}`);
  for (const v of [V.LAUNDRY, V.SERUM30]) if (snapB.stock[v].r - snapA.stock[v].r !== -1) probs.push(`kho ${v} giữ ${snapB.stock[v].r - snapA.stock[v].r}`);
  if (redeem === 1 && redeemAfter !== 0) probs.push('lượt dùng mã chưa trả');
  rec(FILE, { id: 'A3-07a', persona: 'returning', surface: 'api', journey: 'chuyển khoản QR', step: 'đơn CK quá 24 giờ, cron orders.pending-payment-expiry chạy', expected: 'CANCELLED; hoàn 5.000 điểm vào sổ; trả giữ chỗ kho; trả lượt mã', actual: `${a.status}; job=${JSON.stringify(job.result ?? job).slice(0, 100)}; điểm ${snapA.bal}→${snapB.bal}; sổ ${snapA.ledgerStd}→${snapB.ledgerStd}; lượt mã ${redeem}→${redeemAfter}`, evidence: probs.join(' | ') || 'khớp SQL', status: probs.length ? 'FAIL' : 'PASS', code: b.code });
  // tiền về sau khi đã huỷ
  const late = bankWebhook(b.code, b.row.total, `${b.code}`);
  const a2 = await order(b.code);
  const rf = await refunds(a2.id);
  rec(FILE, { id: 'A3-07b', persona: 'returning', surface: 'api', journey: 'chuyển khoản QR', step: 'khách vẫn chuyển tiền sau khi đơn đã tự huỷ', expected: `đơn giữ CANCELLED (không hồi sinh); phát sinh khoản hoàn ${b.row.total}đ chờ khách chọn Ví/ngân hàng`, actual: `${a2.status}/${a2.ps}; hoàn: ${JSON.stringify(rf)}`, status: a2.status === 'CANCELLED' && rf.some((x) => x.amount === b.row.total) ? 'PASS' : 'FAIL', code: b.code });
}

// ---- B8: khách huỷ đơn chờ / COD ----
if (run('A3-08')) {
  const w = await who('returning');
  await topUp(w.userId, 10000);
  const b = await bankOrder(w, [[V.LAUNDRY, 1]], { pointsToUse: 7000, coupon: 'UATX10' });
  const snapA = await snapshot(w.userId, [V.LAUNDRY]);
  const redeem = (await sql(`select count(*)::int n from coupon_redemptions where "orderId"='${b.row.id}'`))[0].n;
  const c = await api(L, 'POST', `/orders/${b.code}/cancel`, { token: w.token, body: { cancelReasonCode: 'CHANGED_MIND' } });
  const c2 = await api(L, 'POST', `/orders/${b.code}/cancel`, { token: w.token, body: {} });
  const snapB = await snapshot(w.userId, [V.LAUNDRY]);
  const a = await order(b.code);
  const h = await hist(a.id);
  const probs = [];
  if (a.status !== 'CANCELLED') probs.push(a.status);
  if (snapB.bal - snapA.bal !== 7000) probs.push(`điểm hoàn ${snapB.bal - snapA.bal}`);
  if (snapB.stock[V.LAUNDRY].r - snapA.stock[V.LAUNDRY].r !== -1) probs.push('kho chưa trả');
  if (c2.status >= 300) probs.push(`huỷ lần 2 ${c2.status}`);
  if (!h.some((x) => x.t === 'CANCELLED' && x.a === 'CUSTOMER' && /Đổi ý/.test(x.note ?? ''))) probs.push(`lịch sử ${JSON.stringify(h)}`);
  rec(FILE, { id: 'A3-08a', persona: 'returning', surface: 'api', journey: 'huỷ đơn chờ', step: 'khách huỷ đơn CK chờ thanh toán (lý do "Đổi ý"), bấm huỷ lần 2', expected: 'CANCELLED; điểm hoàn +7.000 một lần; kho trả; lần 2 vẫn 2xx; lịch sử ghi CUSTOMER + lý do', actual: `huỷ ${c.status}, lần 2 ${c2.status}; ${a.status}; điểm ${snapA.bal}→${snapB.bal}`, evidence: probs.join(' | ') || 'khớp SQL', status: probs.length ? 'FAIL' : 'PASS', code: b.code });
  // COD đã xác nhận: huỷ được; sau đóng gói/giao thì không
  const w2 = await who('new_nophone');
  await fillCart(w2, [[V.KINH, 2]]);
  const q = await quote(w2);
  const p = await place(w2, { expectedTotal: q.body.total });
  const cod = p.body.code;
  await waitPancake(cod);
  const x1 = await api(L, 'POST', `/orders/${cod}/cancel`, { token: w2.token, body: { cancelReasonCode: 'WRONG_ORDER' } });
  const aCod = await order(cod);
  rec(FILE, { id: 'A3-08b', persona: 'new_nophone', surface: 'api', journey: 'huỷ đơn chờ', step: 'khách huỷ đơn COD đã xác nhận (chưa đóng gói)', expected: 'CANCELLED', actual: `${x1.status} ${aCod.status}`, status: aCod.status === 'CANCELLED' ? 'PASS' : 'FAIL', code: cod });
  await fillCart(w2, [[V.KINH, 1]]);
  const q2 = await quote(w2);
  const p2 = await place(w2, { expectedTotal: q2.body.total });
  await waitPancake(p2.body.code);
  pancakeHook(p2.body.code, 'shipped', ['--tracking', 'UATTRACK001', '--carrier', 'GHN']);
  const x2 = await api(L, 'POST', `/orders/${p2.body.code}/cancel`, { token: w2.token, body: {} });
  const aShip = await order(p2.body.code);
  rec(FILE, { id: 'A3-08c', persona: 'new_nophone', surface: 'api', journey: 'huỷ đơn chờ', step: 'khách huỷ đơn đã bàn giao vận chuyển', expected: '400 "Đơn đã vào quy trình giao, bạn liên hệ hotline hoặc Zalo OA của Tubu để được hỗ trợ nhé." (hoặc câu bàn giao tương đương); đơn giữ nguyên', actual: `${x2.status} "${msgOf(x2)}"; ${aShip.status}`, status: x2.status === 400 && /liên hệ hotline hoặc Zalo OA/.test(msgOf(x2)) && aShip.status !== 'CANCELLED' ? 'PASS' : 'FAIL', code: p2.body.code });
  // đơn người khác
  const other = await api(L, 'POST', `/orders/${b.code}/cancel`, { token: (await who('new')).token, body: {} });
  const det = await api(L, 'GET', `/orders/${b.code}`, { token: (await who('new')).token });
  rec(FILE, { id: 'A3-08d', persona: 'new', surface: 'api', journey: 'chi tiết đơn', step: 'xem/huỷ đơn của người khác', expected: '404 "Không tìm thấy đơn hàng." cho cả hai (không lộ dữ liệu)', actual: `huỷ ${other.status} "${msgOf(other)}"; xem ${det.status} "${msgOf(det)}"`, status: other.status === 404 && det.status === 404 && msgOf(det) === 'Không tìm thấy đơn hàng.' ? 'PASS' : 'FAIL' });
}

// ---- B9: mua lại ----
if (run('A3-09')) {
  const w = await who('returning');
  const base = (await sql(`select o.code from orders o where o."userId"='${w.userId}' and o.status='DELIVERED' order by o."createdAt" limit 1`))[0].code;
  await fillCart(w, []);
  await sqlExec(`update variations set stock = 0 where id = '${V.SERUM30}'`);
  // đơn mẫu cũ: 4 x nước rửa chén 5L; tự dựng đơn có 2 dòng để thử một dòng hết hàng
  const o2 = await bankOrder(w, [[V.LAUNDRY, 1]]).catch(() => null);
  await sqlExec(`update variations set stock = 60 where id = '${V.SERUM30}'`);
  const r = await api(L, 'POST', `/orders/${base}/repurchase`, { token: w.token, body: {} });
  const cart = (await api(L, 'GET', '/cart', { token: w.token })).body;
  rec(FILE, { id: 'A3-09a', persona: 'returning', surface: 'api', journey: 'mua lại', step: `mua lại đơn đã giao ${base} (4 × nước rửa chén Can 5L)`, expected: '2xx; giỏ có Can 5L × 4 (kho 36 ≥ 4) giá hiện hành 430.000đ', actual: `${r.status} ${JSON.stringify(r.body).slice(0, 260)}; giỏ=${JSON.stringify(cart.items.map((i) => [i.variationName, i.quantity, i.unitPrice]))}`, status: r.status < 300 && cart.items.some((i) => i.variationName === 'Can 5L' && i.quantity === 4 && i.unitPrice === 430000) ? 'PASS' : 'FAIL', code: base });
  // dòng hết hàng: đơn nhiều dòng
  const multi = (await sql(`select o.code from orders o join order_items i on i."orderId"=o.id where o."userId"='${w.userId}' group by o.code having count(*)>=2 limit 1`))[0]?.code;
  if (multi) {
    const first = (await sql(`select i."variationId" v from order_items i join orders o on o.id=i."orderId" where o.code='${multi}' limit 1`))[0].v;
    await fillCart(w, []);
    await sqlExec(`update variations set stock = 0 where id = '${first}'`);
    const r2 = await api(L, 'POST', `/orders/${multi}/repurchase`, { token: w.token, body: {} });
    const c2 = (await api(L, 'GET', '/cart', { token: w.token })).body;
    await sqlExec(`update variations set stock = 100 where id = '${first}'`);
    rec(FILE, { id: 'A3-09b', persona: 'returning', surface: 'api', journey: 'mua lại', step: `mua lại ${multi} khi một dòng hết hàng`, expected: 'dòng hết hàng bị bỏ với lý do OUT_OF_STOCK, các dòng còn lại vào giỏ', actual: `${r2.status} ${JSON.stringify(r2.body).slice(0, 420)}; giỏ ${c2.items.length} dòng`, status: r2.status < 300 && JSON.stringify(r2.body).includes('OUT_OF_STOCK') ? 'PASS' : 'FAIL', code: multi });
  } else {
    rec(FILE, { id: 'A3-09b', persona: 'returning', surface: 'api', journey: 'mua lại', step: 'mua lại đơn nhiều dòng có dòng hết hàng', expected: '—', actual: 'không có đơn nhiều dòng', status: 'BLOCKED' });
  }
}

// ---- B10: danh sách / đếm / chi tiết ----
if (run('A3-10')) {
  const w = await who('returning');
  const list = await api(L, 'GET', '/orders?limit=100', { token: w.token });
  const counts = await api(L, 'GET', '/orders/status-counts', { token: w.token });
  const sqlTotal = (await sql(`select count(*)::int n from orders where "userId"='${w.userId}'`))[0].n;
  const rows = list.body.items ?? list.body.data ?? list.body;
  const byStatus = await sql(`select status, count(*)::int n from orders where "userId"='${w.userId}' group by 1 order by 1`);
  rec(FILE, { id: 'A3-10a', persona: 'returning', surface: 'api', journey: 'danh sách đơn', step: 'GET /orders và /orders/status-counts so với SQL', expected: `tổng ${sqlTotal} đơn; đếm tab khớp SQL ${JSON.stringify(byStatus.map((x) => [x.status, x.n]))}`, actual: `list ${list.status} ${Array.isArray(rows) ? rows.length : JSON.stringify(Object.keys(list.body))}; counts ${JSON.stringify(counts.body)}`, status: (Array.isArray(rows) ? rows.length : list.body.total) === sqlTotal ? 'PASS' : 'FAIL' });
  const guest = await who('guest');
  const gl = await api(L, 'GET', '/orders?limit=100', { token: guest.token });
  const gRows = gl.body.data ?? gl.body.items ?? [];
  const gSql = (await sql(`select count(*)::int n from orders where "userId"='${guest.userId}'`))[0].n;
  const foreign = gRows.filter((o) => o.userId !== guest.userId).length;
  rec(FILE, { id: 'A3-10b', persona: 'guest', surface: 'api', journey: 'danh sách đơn', step: 'khách vãng lai xem danh sách đơn của chính mình', expected: `chỉ đơn của chính guest (${gSql} theo SQL), không lộ đơn người khác`, actual: `${gl.status} ${gRows.length} đơn, ${foreign} đơn của người khác`, status: gl.status === 200 && gRows.length === gSql && foreign === 0 ? 'PASS' : 'FAIL' });
}

// ---- B11: giao xong cộng điểm đúng ----
if (run('A3-11')) {
  const w = await who('returning');
  const b = await bankOrder(w, [[V.LAUNDRY, 1], [V.SERUM30, 1]]);
  bankWebhook(b.code, b.row.total, b.code);
  pancakeHook(b.code, 'shipped', ['--tracking', 'UATTRACK002', '--carrier', 'GHN']);
  const snap0 = await snapshot(w.userId, []);
  pancakeHook(b.code, 'delivered');
  const r = sh('run-job.mjs', ['DeliveredEffectsResyncCron.resyncPending']);
  const a = await order(b.code);
  const snap1 = await snapshot(w.userId, []);
  const row = (await sql(`select "pointsEarned"::int pe, "deliveredEffectsAt" d from orders where code='${b.code}'`))[0];
  const ledger = await sql(`select delta::int d, reason from points_transactions where "userId"='${w.userId}' and reason like 'ORDER_DELIVERED:${b.code}%'`);
  const probs = [];
  if (a.status !== 'DELIVERED') probs.push(a.status);
  if (ledger.length !== 1 || ledger[0].d !== row.pe) probs.push(`sổ ${JSON.stringify(ledger)} ≠ pointsEarned ${row.pe}`);
  if (snap1.bal - snap0.bal !== row.pe) probs.push(`số dư +${snap1.bal - snap0.bal}, mong +${row.pe}`);
  rec(FILE, { id: 'A3-11', persona: 'returning', surface: 'api', journey: 'thanh toán chuyển khoản', step: 'đơn CK đã trả, giao xong (webhook delivered)', expected: 'DELIVERED; đúng 1 dòng sổ ORDER_DELIVERED:<mã> = pointsEarned (đã nhân hệ số hạng 1,2); số dư tăng đúng bằng đó', actual: `${a.status}; pointsEarned=${row.pe}; sổ=${JSON.stringify(ledger)}; điểm ${snap0.bal}→${snap1.bal}`, evidence: probs.join(' | ') || 'khớp SQL', status: probs.length ? 'FAIL' : 'PASS', code: b.code });
}
await closePrisma();
