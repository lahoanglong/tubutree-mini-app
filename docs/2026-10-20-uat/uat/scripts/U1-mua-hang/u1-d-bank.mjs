#!/usr/bin/env node
// U1 nhóm D: thanh toán chuyển khoản QR (CONG TY TNHH TUBU TREE, 8386790906, Techcombank) + giả webhook ngân hàng/Pancake:
// đủ tiền, thiếu tiền, thừa tiền, gửi trùng, chuyển hai lần, sai nội dung, quá hạn. Trạng thái đơn đối chiếu DB, chữ đối chiếu màn.
// Chạy: node u1-d-bank.mjs [U1-18 ...]
import {
  L, BROWSER, open, sql, api, apiOk, freshCustomer, addToCart, addAddress, shot, runCases, dismissOnboarding, quoteFeed,
  settledQuote, cartToCheckout, placeOrderUI, orderEvidence, bankTransfer, waitPancakePush, fakePancakeOrder, postWebhook, runJob,
  couponState, stockOf, sleep, applyVoucherUI,
} from './u1-lib.mjs';
import { dedupeKey } from '../../../tools/uat-harness/pancake-webhook.mjs';

const BANK = { name: 'Ngân hàng TMCP Kỹ Thương Việt Nam', bin: '970407', accountNo: '8386790906', accountName: 'CONG TY TNHH TUBU TREE' };

/** Tách TLV EMVCo (VietQR) để đọc trường 38/54/62 và kiểm CRC. */
function parseEmv(s) {
  const out = {};
  let i = 0;
  while (i + 4 <= s.length) {
    const id = s.slice(i, i + 2);
    const len = Number(s.slice(i + 2, i + 4));
    out[id] = s.slice(i + 4, i + 4 + len);
    i += 4 + len;
  }
  return out;
}
function crc16(input) {
  let crc = 0xffff;
  for (let i = 0; i < input.length; i++) {
    crc ^= input.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/** Khách mới, giỏ 199.000đ, đặt CHUYỂN KHOẢN trên UI → đang ở /bank-payment/:code. */
async function placeBankOrder(c, tag, { coupon } = {}) {
  const u = await freshCustomer(tag, { welcome: !!coupon });
  await addAddress(u);
  await addToCart(u.id, 'FUWA-DW-1L', 1);
  await addToCart(u.id, 'FUWA-GL-500', 1);
  const s = await open(L.n, u.id, { browser: BROWSER, path: '/cart' });
  await dismissOnboarding(s.page);
  if (coupon) {
    const a = await applyVoucherUI(s.page, null, { fromList: coupon });
    c.evidence('áp mã', { status: a.status, couponCode: a.body?.couponCode });
  }
  const feed = quoteFeed(s.page);
  await cartToCheckout(s.page);
  const q = await settledQuote(s.page, feed);
  const placed = await placeOrderUI(s.page, 'BANK_TRANSFER');
  c.evidence('đặt đơn chuyển khoản', { status: placed.status, code: placed.code, button: placed.buttonText, total: q?.body?.total });
  await s.page.waitForURL(/\/bank-payment\//, { timeout: 15_000 });
  await s.page.getByText('Số tài khoản').waitFor({ timeout: 15_000 });
  // Chờ hiệu ứng trượt trang xong (trang giỏ trống còn nằm bên trái trong ~1 giây).
  await s.page.waitForTimeout(1500);
  await waitPancakePush(placed.code);
  return { u, s, code: placed.code, total: q?.body?.total };
}

async function waitPaidOnPage(page, ms = 15_000) {
  try {
    await page.getByText('Đã nhận thanh toán!').waitFor({ timeout: ms });
    return true;
  } catch {
    return false;
  }
}

const refunds = (orderId) => sql(`SELECT kind, amount, status, "refKey" FROM order_customer_refunds WHERE "orderId" = $1 ORDER BY "createdAt"`, orderId);
const notes = async (userId, since) =>
  (await sql(`SELECT "templateCode", channel, status, payload FROM notification_logs WHERE "userId" = $1 AND "sentAt" >= $2 ORDER BY "sentAt"`, userId, since)).map((n) => ({
    ...n,
    text: JSON.stringify(n.payload).slice(0, 300),
  }));

const cases = [
  {
    id: 'U1-18',
    role: 'Khách mới',
    journey: 'Đặt đơn chuyển khoản → màn QR: đúng tài khoản, số tiền, nội dung, hạn',
    steps: 'Giỏ 199.000đ → "Thanh toán" → chọn "Chuyển khoản ngân hàng" → "Đặt hàng · 199.000đ" → màn /bank-payment/<mã>; đọc GET /payments/bank-qr/<mã> và giải mã VietQR',
    expected:
      'Màn ghi Ngân hàng TMCP Kỹ Thương Việt Nam, STK 8386790906, chủ TK CONG TY TNHH TUBU TREE, số tiền 199.000đ, nội dung CK = mã đơn, hạn chuyển 24 giờ; VietQR: BIN 970407 (Techcombank) + STK 8386790906, trường 54 = 199000, 62-08 = mã đơn, CRC đúng; DB PENDING_PAYMENT/UNPAID, tồn kho đã giữ',
    async run(c) {
      const { u, s, code, total } = await placeBankOrder(c, 'd18');
      try {
        const txt = await s.page.locator('body').innerText();
        c.evidence('ảnh', await shot(s.page, 'U1-18-bank-qr'));
        c.evidence('chữ màn QR', txt.split('\n').filter((l) => l.trim()).slice(0, 30));
        for (const [label, v] of [['Ngân hàng', BANK.name], ['Số tài khoản', BANK.accountNo], ['Chủ tài khoản', BANK.accountName], ['Số tiền', '199.000đ'], ['Nội dung CK', code]]) {
          c.check(`màn có ${label}: ${v}`, txt.includes(v));
        }
        const img = await s.page.locator('img[src*="vietqr"]').first().getAttribute('src').catch(() => null);
        c.evidence('ảnh QR src', img);
        c.check('ảnh QR trỏ 970407-8386790906, amount=199000, addInfo=mã đơn', !!img && img.includes('970407-8386790906') && img.includes('amount=199000') && img.includes(`addInfo=${code}`), img);
        const qr = await apiOk(L, 'GET', `/payments/bank-qr/${code}`, { user: u.id });
        const emv = parseEmv(qr.qrString);
        const m38 = parseEmv(emv['38'] ?? '');
        const acq = parseEmv(m38['01'] ?? '');
        const add = parseEmv(emv['62'] ?? '');
        const body = qr.qrString.slice(0, -4);
        c.evidence('GET /payments/bank-qr', { amount: qr.amount, bank: qr.bank, memo: qr.memo, paymentDeadline: qr.paymentDeadline, emv: { bin: acq['00'], acc: acq['01'], amount: emv['54'], addInfo: add['08'], crc: emv['63'] } });
        c.check('VietQR: BIN 970407 + STK 8386790906 + NAPAS QRIBFTTA', acq['00'] === BANK.bin && acq['01'] === BANK.accountNo && m38['02'] === 'QRIBFTTA');
        c.check('VietQR: số tiền 199000, nội dung = mã đơn, CRC đúng', emv['54'] === String(total) && add['08'] === code && crc16(body) === emv['63']);
        const o = await orderEvidence(code);
        c.evidence('SQL đơn', o);
        const hours = (new Date(qr.paymentDeadline) - new Date(o.createdAt)) / 3.6e6;
        c.check('hạn chuyển khoản = 24 giờ sau lúc đặt', Math.abs(hours - 24) < 0.01, hours);
        c.check('màn nêu "Vui lòng chuyển khoản trước"', txt.includes('Vui lòng chuyển khoản trước'));
        c.check('DB: PENDING_PAYMENT/UNPAID/BANK_TRANSFER, total 199000', o.status === 'PENDING_PAYMENT' && o.paymentStatus === 'UNPAID' && o.paymentMethod === 'BANK_TRANSFER' && o.total === 199000);
        const st = await stockOf('FUWA-DW-1L');
        c.check('DB: tồn kho đã giữ (reservedStock > 0)', st.reservedStock > 0, st);
      } finally {
        await s.close();
      }
    },
  },
  {
    id: 'U1-19',
    role: 'Khách mới',
    journey: 'Chuyển đủ tiền, đúng nội dung → đơn tự xác nhận, màn QR tự đổi',
    steps: 'Đơn chuyển khoản 199.000đ, giữ màn QR mở → bank-webhook.mjs <mã> 199000 (nội dung = mã đơn) → chờ màn tự làm mới (4 giây/lần)',
    expected: 'Màn đổi sang "Đã nhận thanh toán!"; DB CONFIRMED/PAID, paidAt có, pancakeAttention null; không có dòng hoàn tiền',
    async run(c) {
      const { s, code, total } = await placeBankOrder(c, 'd19');
      try {
        const t = bankTransfer(code, total);
        c.evidence('giả chuyển khoản', { matched: t.matched, event: t.event, after: t.orderAfter });
        const paidShown = await waitPaidOnPage(s.page);
        c.evidence('ảnh', await shot(s.page, 'U1-19-bank-paid'));
        c.check('màn tự đổi "Đã nhận thanh toán!"', paidShown);
        const o = await orderEvidence(code);
        c.evidence('SQL đơn', o);
        c.check('DB: CONFIRMED/PAID, paidAt có, không cần xử lý', o.status === 'CONFIRMED' && o.paymentStatus === 'PAID' && !!o.paidAt && !o.pancakeAttention);
        c.check('DB: không có dòng hoàn tiền', (await refunds(o.id)).length === 0);
      } finally {
        await s.close();
      }
    },
  },
  {
    id: 'U1-20',
    role: 'Khách mới',
    journey: 'Chuyển thiếu tiền rồi chuyển bù',
    steps:
      '(a) Đơn A 199.000đ → chuyển 100.000đ (đúng nội dung) → xem màn QR + chi tiết đơn + thông báo → chuyển bù 99.000đ; (b) đơn B: chuyển 100.000đ → quét lại mã QR trên màn (chuyển đúng số QR ghi)',
    expected:
      'Sau 100k: đơn vẫn PENDING_PAYMENT/UNPAID, admin có pancakeAttention "Khách chuyển thiếu…"; khách được báo đã nhận 100.000đ, còn thiếu 99.000đ; màn QR (nơi khách đang đứng) và mã VietQR đổi sang số còn thiếu 99.000đ, khớp lời thông báo "chuyển thêm phần còn thiếu"; sau 99k: PAID, attention xoá; (b) quét lại QR không làm khách chuyển dư',
    async run(c) {
      const { u, s, code } = await placeBankOrder(c, 'd20');
      const since = new Date();
      try {
        const t1 = bankTransfer(code, 100000);
        c.evidence('chuyển 100k', { event: t1.event, after: t1.orderAfter });
        await s.page.waitForTimeout(5000);
        const qrText = await s.page.locator('body').innerText();
        c.evidence('ảnh màn QR sau chuyển thiếu', await shot(s.page, 'U1-20-bank-short-qr'));
        await s.goto(`/order/${code}`);
        await s.page.waitForTimeout(1500);
        const odText = await s.page.locator('body').innerText();
        c.evidence('ảnh chi tiết đơn sau chuyển thiếu', await shot(s.page, 'U1-20-bank-short-order'));
        const o1 = await orderEvidence(code);
        c.evidence('SQL đơn sau 100k', { status: o1.status, paymentStatus: o1.paymentStatus, pancakeAttention: o1.pancakeAttention, pancakePaidReported: o1.pancakePaidReported });
        c.check('DB: vẫn PENDING_PAYMENT/UNPAID', o1.status === 'PENDING_PAYMENT' && o1.paymentStatus === 'UNPAID');
        c.check('DB: admin thấy "Khách chuyển thiếu" (pancakeAttention)', /chuyển thiếu/i.test(o1.pancakeAttention ?? ''), o1.pancakeAttention);
        const n1 = await notes(u.id, since);
        c.evidence('thông báo cho khách sau chuyển thiếu', n1);
        const told = /100\.000|thiếu|99\.000/.test(qrText) || /100\.000đ|còn thiếu|thiếu 99\.000/.test(odText) || n1.some((n) => /thiếu/i.test(n.text));
        c.evidence('màn QR/chi tiết đơn có nhắc khoản thiếu?', { qr: qrText.match(/[^\n]*(thiếu|100\.000)[^\n]*/g), order: odText.match(/[^\n]*(thiếu|100\.000|Chờ thanh toán|chờ thanh toán)[^\n]*/g) });
        c.check('khách được báo đã nhận một phần / còn thiếu bao nhiêu', told);
        const qr1 = await apiOk(L, 'GET', `/payments/bank-qr/${code}`, { user: u.id });
        const emv1 = parseEmv(qr1.qrString);
        c.evidence('GET /payments/bank-qr sau 100k', { amount: qr1.amount, emvAmount: emv1['54'], pancakePaidReported: o1.pancakePaidReported });
        c.check('màn QR + VietQR đổi sang số còn thiếu 99.000đ', qr1.amount === 99000 && emv1['54'] === '99000' && /99\.000đ/.test(qrText), { amount: qr1.amount, emv: emv1['54'] });
        const t2 = bankTransfer(code, 99000);
        c.evidence('chuyển bù 99k', { event: t2.event, bankPaymentTotal: t2.bankPaymentTotal, after: t2.orderAfter });
        const o2 = await orderEvidence(code);
        c.check('sau chuyển bù: CONFIRMED/PAID, attention xoá', o2.status === 'CONFIRMED' && o2.paymentStatus === 'PAID' && !o2.pancakeAttention, { status: o2.status, ps: o2.paymentStatus, att: o2.pancakeAttention });
      } finally {
        await s.close();
      }
      const B = await placeBankOrder(c, 'd20b');
      const sinceB = new Date();
      try {
        bankTransfer(B.code, 100000);
        const qr = await apiOk(L, 'GET', `/payments/bank-qr/${B.code}`, { user: B.u.id });
        const scanned = Number(parseEmv(qr.qrString)['54']);
        const t = bankTransfer(B.code, scanned);
        const o = await orderEvidence(B.code);
        const rf = await refunds(o.id);
        const n = await notes(B.u.id, sinceB);
        c.evidence('(b) quét lại QR sau khi đã chuyển 100k', { qrAmount: scanned, bankPaymentTotal: t.bankPaymentTotal, status: o.status, ps: o.paymentStatus, refunds: rf, customerNotices: n.map((x) => x.templateCode) });
        c.check('(b) quét lại QR không làm khách chuyển dư', rf.length === 0, rf);
      } finally {
        await B.s.close();
      }
    },
  },
  {
    id: 'U1-21',
    role: 'Khách mới',
    journey: 'Chuyển thừa tiền',
    steps: 'Đơn 199.000đ → chuyển 249.000đ một lần (đúng nội dung)',
    expected:
      'Đơn PAID; ghi khoản OVERPAYMENT 50.000đ trạng thái UNVERIFIED; admin nhận OPS_REFUND_ALERT "tiền trả dư chờ đối soát"; khách CHƯA được báo hoàn cho tới khi admin "Xác nhận tiền dư" (luật đã chốt, apps/api/src/modules/orders/refund-queue.ts:319-322)',
    async run(c) {
      const { u, s, code } = await placeBankOrder(c, 'd21');
      const since = new Date();
      try {
        const t = bankTransfer(code, 249000);
        c.evidence('chuyển 249k', { event: t.event, after: t.orderAfter });
        await waitPaidOnPage(s.page);
        c.evidence('ảnh', await shot(s.page, 'U1-21-bank-over'));
        const o = await orderEvidence(code);
        const rf = await refunds(o.id);
        c.evidence('SQL đơn + hoàn tiền', { status: o.status, ps: o.paymentStatus, refunds: rf });
        c.check('DB: CONFIRMED/PAID', o.status === 'CONFIRMED' && o.paymentStatus === 'PAID');
        c.check('DB: 1 khoản OVERPAYMENT 50.000đ', rf.length === 1 && rf[0].kind === 'OVERPAYMENT' && rf[0].amount === 50000, rf);
        const n = await notes(u.id, since);
        c.evidence('thông báo cho khách', n);
        c.check('khách chưa nhận thông báo hoàn tiền dư (chờ admin đối soát)', !n.some((x) => /REFUND/.test(x.templateCode)), n.map((x) => x.templateCode));
        const ops = await sql(`SELECT "userId", channel, status, payload FROM notification_logs WHERE "templateCode" = 'OPS_REFUND_ALERT' AND "sentAt" >= $1 AND payload::text LIKE $2`, since, `%${code}%`);
        c.evidence('SQL thông báo admin OPS_REFUND_ALERT', ops.map((x) => ({ userId: x.userId, channel: x.channel, status: x.status, text: JSON.stringify(x.payload).slice(0, 220) })));
        c.check('admin có OPS_REFUND_ALERT về tiền dư của đơn', ops.length > 0);
      } finally {
        await s.close();
      }
    },
  },
  {
    id: 'U1-22',
    role: 'Khách mới',
    journey: 'Webhook gửi trùng 2 lần / khách chuyển hai lần đủ tiền',
    steps:
      '(a) đơn A: chuyển đủ 199k → gửi lại NGUYÊN body webhook đó lần nữa (Pancake gửi lại); (b) đơn B: chuyển đủ 199k hai lần (hai giao dịch)',
    expected:
      '(a) lần hai bị gộp trùng (cùng dedupeKey, 1 dòng pancake_webhook_events), đơn PAID một lần, 0 khoản hoàn; (b) đơn PAID, khoản OVERPAYMENT 199.000đ cho lần chuyển thứ hai',
    async run(c) {
      const A = await placeBankOrder(c, 'd22a');
      try {
        const t = bankTransfer(A.code, A.total);
        c.evidence('(a) lần 1', { event: t.event, after: t.orderAfter });
        // Pancake gửi lại đúng một thông báo: dựng body từ đơn trên giả Pancake rồi gửi HAI lần y hệt.
        const body = { type: 'orders', ...(await fakePancakeOrder(A.code)) };
        const key = dedupeKey(body);
        const cnt = async () => (await sql(`SELECT COUNT(*)::int AS n FROM pancake_webhook_events WHERE "dedupeKey" = $1`, key))[0].n;
        const paidAt0 = (await orderEvidence(A.code)).paidAt;
        const r1 = await postWebhook(L, body);
        const n1 = await cnt();
        const r2 = await postWebhook(L, body);
        const n2 = await cnt();
        c.evidence('(a) gửi body lần 1 / lần 2', { key: key.slice(0, 40), first: { http: r1.http, reply: r1.reply, event: r1.event, rows: n1 }, second: { http: r2.http, reply: r2.reply, event: r2.event, rows: n2 } });
        const o = await orderEvidence(A.code);
        const rf = await refunds(o.id);
        c.evidence('(a) SQL', { status: o.status, ps: o.paymentStatus, paidAt0, paidAt: o.paidAt, refunds: rf });
        c.check('(a) lần 2 HTTP 200, gộp vào cùng 1 dòng sự kiện (không xử lý lại)', r2.http === 200 && n1 === 1 && n2 === 1 && r2.event?.id === r1.event?.id, { r1: r1.event, r2: r2.event, n1, n2 });
        c.check('(a) paidAt không đổi', String(o.paidAt) === String(paidAt0));
        c.check('(a) đơn PAID một lần, 0 khoản hoàn', o.paymentStatus === 'PAID' && rf.length === 0);
      } finally {
        await A.s.close();
      }
      const B = await placeBankOrder(c, 'd22b');
      try {
        const t1 = bankTransfer(B.code, B.total);
        const t2 = bankTransfer(B.code, B.total);
        c.evidence('(b) hai lần chuyển', { first: t1.event, second: t2.event, bankPaymentTotal: t2.bankPaymentTotal });
        const o = await orderEvidence(B.code);
        const rf = await refunds(o.id);
        c.evidence('(b) SQL', { status: o.status, ps: o.paymentStatus, refunds: rf });
        c.check('(b) PAID + OVERPAYMENT 199.000đ', o.paymentStatus === 'PAID' && rf.length === 1 && rf[0].kind === 'OVERPAYMENT' && rf[0].amount === 199000, rf);
      } finally {
        await B.s.close();
      }
    },
  },
  {
    id: 'U1-23',
    role: 'Khách mới',
    journey: 'Chuyển khoản sai nội dung',
    steps: 'Đơn 199.000đ → chuyển 199.000đ nội dung "chuyen tien hang" (không có mã đơn)',
    expected: 'Pancake không ghép được: không webhook, đơn vẫn PENDING_PAYMENT/UNPAID, màn QR vẫn "Đang chờ thanh toán…" (kế toán phải bấm "Đã nhận tiền" — lane admin)',
    async run(c) {
      const { s, code, total } = await placeBankOrder(c, 'd23');
      try {
        const t = bankTransfer(code, total, 'chuyen tien hang');
        c.evidence('giả chuyển khoản sai nội dung', t);
        await s.page.waitForTimeout(5000);
        const txt = await s.page.locator('body').innerText();
        c.evidence('ảnh', await shot(s.page, 'U1-23-bank-wrong-memo'));
        const o = await orderEvidence(code);
        c.check('không ghép được (matched=false)', t.matched === false);
        c.check('DB: vẫn PENDING_PAYMENT/UNPAID', o.status === 'PENDING_PAYMENT' && o.paymentStatus === 'UNPAID');
        c.check('màn vẫn "Đang chờ thanh toán"', /Đang chờ thanh toán/.test(txt));
      } finally {
        await s.close();
      }
    },
  },
  {
    id: 'U1-24',
    role: 'Khách mới (dùng voucher chào mừng)',
    journey: 'Quá hạn chuyển khoản → đơn tự huỷ, trả mã + kho; tiền về muộn',
    steps:
      'Đơn chuyển khoản 199k dùng voucher chào mừng → lùi createdAt 25 giờ → run-job orders.pending-payment-expiry (PendingPaymentExpiryCron.expireStale) → mở lại màn QR → chuyển 169.000đ muộn',
    expected:
      'Đơn CANCELLED; lượt voucher chào mừng trả lại (usedCount 0, 0 redemption); tồn kho trả; màn QR (đang mở lẫn mở lại) thôi hiện STK/QR và nói rõ đơn đã huỷ vì quá hạn; tiền về muộn: đơn KHÔNG sống lại, ghi khoản hoàn LATE_PAYMENT 169.000đ và báo khách chọn nơi nhận',
    async run(c) {
      const { u, s, code, total } = await placeBankOrder(c, 'd24', { coupon: 'Quà chào mừng thành viên mới' });
      const since = new Date();
      try {
        const o0 = await orderEvidence(code);
        c.evidence('đơn lúc đặt', { total: o0.total, couponCode: o0.couponCode, redemptions: o0.redemptions });
        const stock0 = await stockOf('FUWA-DW-1L');
        await sql(`UPDATE orders SET "createdAt" = "createdAt" - interval '25 hours' WHERE code = $1 RETURNING code`, code);
        const job = runJob('PendingPaymentExpiryCron.expireStale');
        c.evidence('run-job expireStale', job.result);
        const o = await orderEvidence(code);
        const cs = await couponState(o0.couponCode);
        const stock1 = await stockOf('FUWA-DW-1L');
        c.evidence('SQL sau huỷ', { status: o.status, ps: o.paymentStatus, coupon: cs, stock0, stock1 });
        c.check('DB: đơn CANCELLED', o.status === 'CANCELLED');
        c.check('DB: voucher chào mừng trả lượt (usedCount 0, 0 redemption)', cs.usedCount === 0 && cs.redemptions === 0, cs);
        c.check('DB: tồn kho FUWA-DW-1L trả lại 1', stock1.stock === stock0.stock + 1 || stock1.reservedStock === stock0.reservedStock - 1, { stock0, stock1 });
        // Màn QR khách đang mở từ trước (poll 4 giây/lần) — trường hợp hay gặp nhất khi quá hạn.
        await s.page.waitForTimeout(9000);
        const open = await s.page.locator('body').innerText();
        c.evidence('ảnh màn QR đang mở lúc đơn bị huỷ', await shot(s.page, 'U1-24-bank-expired-open'));
        c.evidence('chữ màn QR đang mở sau huỷ', open.split('\n').filter((x) => x.trim()).slice(0, 22));
        c.check('màn QR đang mở thôi hiện STK/QR sau khi đơn huỷ', !open.includes(BANK.accountNo));
        await s.goto(`/bank-payment/${code}`);
        await s.page.waitForTimeout(2000);
        const txt = await s.page.locator('body').innerText();
        c.evidence('ảnh màn QR mở lại sau huỷ', await shot(s.page, 'U1-24-bank-expired'));
        c.evidence('chữ màn QR mở lại sau huỷ', txt.split('\n').filter((x) => x.trim()).slice(0, 12));
        c.check('màn QR mở lại không còn hiện STK để chuyển', !txt.includes(BANK.accountNo));
        c.check('màn QR mở lại nói rõ đơn đã huỷ (không phải "Không tải được… Thử lại")', /huỷ|hủy|quá hạn/i.test(txt), txt.split('\n').slice(0, 4));
        const late = bankTransfer(code, total);
        c.evidence('tiền về muộn', { event: late.event, after: late.orderAfter });
        const o2 = await orderEvidence(code);
        const rf = await refunds(o2.id);
        c.evidence('SQL sau tiền muộn', { status: o2.status, ps: o2.paymentStatus, refunds: rf });
        c.check('đơn không sống lại (vẫn CANCELLED)', o2.status === 'CANCELLED');
        c.check('ghi khoản LATE_PAYMENT 169.000đ', rf.some((r) => r.kind === 'LATE_PAYMENT' && r.amount === total), rf);
        const n = await notes(u.id, since);
        c.evidence('thông báo cho khách', n.map((x) => ({ templateCode: x.templateCode, text: x.text.slice(0, 220) })));
        c.check('khách nhận ORDER_PAYMENT_EXPIRED + REFUND_LATE_PAYMENT', ['ORDER_PAYMENT_EXPIRED', 'REFUND_LATE_PAYMENT'].every((t) => n.some((x) => x.templateCode === t)), n.map((x) => x.templateCode));
      } finally {
        await s.close();
      }
    },
  },
];

await runCases(cases);
