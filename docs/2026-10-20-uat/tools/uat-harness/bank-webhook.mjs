#!/usr/bin/env node
// Giả một khoản chuyển khoản vào TK nhận của shop (CONG TY TNHH TUBU TREE, 8386790906, Techcombank).
// API không có webhook ngân hàng riêng: đơn BANK_TRANSFER lên PAID khi Pancake POS (đã liên kết TK ngân hàng) đối soát khoản
// chuyển theo nội dung = mã đơn rồi bắn webhook đơn kèm bank_payment (apps/api/src/modules/integrations/payment/bank-transfer.service.ts,
// pancake.processor.ts onPaymentReconcile, pancake-payment.util.ts isPancakeOrderPaid). Script này đóng vai ngân hàng + Pancake:
//   1. nội dung không chứa mã đơn → Pancake không ghép được: chỉ ghi khoản lạ vào state, KHÔNG gửi webhook (kế toán phải bấm "Đã nhận tiền");
//   2. khớp → cộng dồn bank_payment lên đơn trên giả Pancake rồi gửi webhook đơn (token PANCAKE_WEBHOOK_SECRET).
// Dùng: bank-webhook.mjs <lane> <mãĐơn> <số tiền> [nội dung] [--dry]    (nội dung mặc định = mã đơn)
import fs from 'node:fs';
import path from 'node:path';
import { closePrisma, jsonOut, lane, prismaFor } from './lib.mjs';
import { postWebhook } from './pancake-webhook.mjs';

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const pos = args.filter((a) => a !== '--dry');
if (pos.length < 3) {
  console.error('dùng: bank-webhook.mjs <lane> <mãĐơn> <số tiền> [nội dung] [--dry]');
  process.exit(2);
}
const [laneArg, code, amountArg, ...contentParts] = pos;
const L = lane(laneArg);
const amount = Number(amountArg);
const content = contentParts.length ? contentParts.join(' ') : code;
const norm = (s) => String(s).toUpperCase().replace(/[^A-Z0-9]/g, '');

try {
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('số tiền phải là số nguyên dương (đồng)');
  const order = await prismaFor(L).order.findUnique({
    where: { code },
    select: { code: true, total: true, status: true, paymentMethod: true, paymentStatus: true, pancakeOrderId: true },
  });
  const txn = { at: new Date().toISOString(), account: '8386790906 Techcombank', amount, content };
  const ledger = path.join(L.pancakeDir, 'bank-transfers.jsonl');
  fs.mkdirSync(L.pancakeDir, { recursive: true });
  if (!norm(content).includes(norm(code)) || !order) {
    fs.appendFileSync(ledger, `${JSON.stringify({ ...txn, matched: false })}\n`);
    jsonOut({ matched: false, reason: !order ? `không có đơn ${code} trong DB lane` : 'nội dung CK không chứa mã đơn — Pancake không ghép được', txn, order });
  } else {
    const found = await (await fetch(`${L.pancakeUrl}/__uat/find?code=${encodeURIComponent(code)}`)).json().catch(() => null);
    if (!found || found.kind !== 'app') {
      throw new Error(`đơn ${code} chưa có trên giả Pancake (pancakeOrderId=${order.pancakeOrderId}) — chờ job đẩy đơn hoặc xem orders.pancakeSyncError`);
    }
    const paid = Number(found.order.bank_payment ?? 0) + amount;
    const upd = await (
      await fetch(`${L.pancakeUrl}/__uat/app-orders/${encodeURIComponent(found.order.id)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ bank_payment: paid }),
      })
    ).json();
    fs.appendFileSync(ledger, `${JSON.stringify({ ...txn, matched: true, pancakeOrderId: upd.id, bankPaymentTotal: paid })}\n`);
    const body = { type: 'orders', ...upd };
    const sent = dry ? { dry: true, body } : await postWebhook(L, body);
    const after = await prismaFor(L).order.findUnique({
      where: { code },
      select: { code: true, total: true, status: true, paymentStatus: true, paidAt: true, pancakeAttention: true },
    });
    jsonOut({ matched: true, txn, bankPaymentTotal: paid, orderTotal: order.total, ...sent, orderBefore: order, orderAfter: after });
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await closePrisma();
}
