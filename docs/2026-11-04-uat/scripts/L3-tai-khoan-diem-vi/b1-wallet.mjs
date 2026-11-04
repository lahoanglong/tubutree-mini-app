// B1: Ví Tubu. Huỷ đơn chuyển khoản ĐÃ TRẢ -> hoàn vào ví; dùng ví để thanh toán; ví không đủ; hoàn về ngân hàng (khoản mở).
import { A, makeRec, place, codeOf, bankWebhook, deliver, job, sql, sql1, walletLedger, pointsLedger, done, L } from './lib3.mjs';
const { rec, check } = makeRec('b1-wallet');
const J = 'Ví: hoàn tiền huỷ đơn, thanh toán bằng ví';
const U = 'returning', uid = 'uat_returning';

const w0 = await walletLedger(uid);
// 1. đơn chuyển khoản, trả đủ -> huỷ -> ví
const p = await place(U, [{ slug: 'nuoc-giat-fuwa3e', qty: 1 }], { payment: 'BANK_TRANSFER', tag: 'B1a' });
const code = codeOf(p.order);
const total = p.order?.total ?? p.quote.total;
check('B1-1', U, 'API', J, 'đặt đơn chuyển khoản', 'BANK_TRANSFER cần Pancake đối soát', !!code, `code=${code} total=${total} (status ${p.placeStatus})`);
const b = bankWebhook(code, total, `${code} thanh toan`);
const st = await sql1(`SELECT status, "paymentStatus" ps, "paidAt" FROM orders WHERE code=$1`, code);
check('B1-2', U, 'API', J, 'webhook ngân hàng giả: đơn PAID/CONFIRMED', 'bank-transfer.service.ts + pancake payment', st.ps === 'PAID', `SQL orders: ${JSON.stringify(st)}`);
const cancel = await A(U, 'POST', `/orders/${code}/cancel`, { cancelReasonCode: 'CHANGED_MIND' });
const w1 = await walletLedger(uid);
const wtx = await sql(`SELECT delta::int, "balanceAfter"::int, type, "refType", "refId", reason, "createdAt" FROM wallet_transactions WHERE "userId"=$1 ORDER BY "createdAt" DESC LIMIT 3`, uid);
check('B1-3', U, 'API', J, 'huỷ đơn đã trả: ví +đúng tổng đơn, 1 dòng sổ ví, số dư = SUM(sổ)', 'refund-destination.ts: mặc định hoàn về Ví Tubu; wallet-ledger.service.ts C-060', cancel.ok && w1.bal === w0.bal + total && w1.bal === w1.sum_w && w1.n === w0.n + 1, `cancel=${cancel.status} ví trước=${JSON.stringify(w0)} sau=${JSON.stringify(w1)} sổ mới nhất=${JSON.stringify(wtx[0])}`);
const ord = await sql1(`SELECT status, "paymentStatus" ps FROM orders WHERE code=$1`, code);
check('B1-4', U, 'API', J, 'đơn CANCELLED, trạng thái thanh toán hoàn tiền', 'orders.service.cancelOrder', ord.status === 'CANCELLED', `SQL orders=${JSON.stringify(ord)}`);
// idempotent: huỷ lại không hoàn lần 2
const again = await A(U, 'POST', `/orders/${code}/cancel`, { cancelReasonCode: 'CHANGED_MIND' });
const w1b = await walletLedger(uid);
check('B1-5', U, 'API', J, 'bấm huỷ lại: không hoàn lần hai', 'orders.service.ts:390 đã CANCELLED thoát sớm', w1b.bal === w1.bal, `cancel lần 2=${again.status}; ví ${w1.bal} -> ${w1b.bal}`);
const wallet = (await A(U, 'GET', '/me/wallet')).body;
const txs = (await A(U, 'GET', '/me/wallet/transactions')).body;
const arr = txs.data ?? txs.items ?? txs;
check('B1-6', U, 'API', J, 'GET /me/wallet và /transactions khớp sổ', 'wallet.service.ts', wallet.walletBalance === w1b.bal && arr[0]?.delta === total && String(arr[0]?.reason).includes(code), `wallet=${JSON.stringify(wallet)} tx[0]=${JSON.stringify(arr[0])} (ghi chú: orderId trả id nội bộ cuid, không phải mã đơn; UI không dùng trường này)`);

// 2. thanh toán bằng ví
const bal = (await walletLedger(uid)).bal;
const pw = await place(U, [{ slug: 'nuoc-lau-kinh-fuwa3e', qty: 1 }], { payment: 'WALLET', tag: 'B1b' });
const wcode = codeOf(pw.order);
const wafter = await walletLedger(uid);
const wo = wcode ? await sql1(`SELECT total::int, status, "paymentStatus" ps, "paymentMethod" pm FROM orders WHERE code=$1`, wcode) : null;
check('B1-7', U, 'API', J, 'đặt đơn trả bằng Ví: ví giảm đúng tổng đơn, sổ ví có dòng âm, đơn PAID', 'checkout.service.ts:416, applyWalletDelta', !!wcode && wafter.bal === bal - wo.total && wafter.bal === wafter.sum_w && wo.ps === 'PAID', `ví trước=${bal} sau=${JSON.stringify(wafter)} đơn=${JSON.stringify(wo)} place=${pw.placeStatus}`);
// 3. ví không đủ
const pe = await place(U, [{ slug: 'nuoc-giat-fuwa3e', qty: 20 }], { payment: 'WALLET', tag: 'B1c' });
const msg = pe.raw?.message;
check('B1-8', U, 'API', J, 'ví không đủ: chặn, câu "Số dư Ví Tubu không đủ."', 'wallet-notice.ts WALLET_SHORT_MESSAGE', pe.placeStatus === 400 && /Số dư Ví Tubu không đủ/.test(JSON.stringify(msg)), `place=${pe.placeStatus} ${JSON.stringify(pe.raw).slice(0, 250)}; ví sau=${(await walletLedger(uid)).bal}`);
// 4. hoàn đơn ví: huỷ đơn trả bằng ví -> hoàn về ví
if (wcode) {
  const c = await A(U, 'POST', `/orders/${wcode}/cancel`, { cancelReasonCode: 'CHANGED_MIND' });
  const w3 = await walletLedger(uid);
  check('B1-9', U, 'API', J, 'huỷ đơn đã trả bằng ví: hoàn đủ về ví', 'refund-destination.ts: đơn trả bằng Ví hoàn về Ví', c.ok && w3.bal === bal && w3.bal === w3.sum_w, `cancel=${c.status} ví ${wafter.bal} -> ${w3.bal} (trước khi mua ${bal})`);
}
// 5. hoàn về ngân hàng: khoản PENDING (chặn xoá tài khoản ở ca riêng)
const pb = await place(U, [{ slug: 'nuoc-lau-kinh-fuwa3e', qty: 1 }], { payment: 'BANK_TRANSFER', tag: 'B1d' });
const bcode = codeOf(pb.order);
const bt = pb.order?.total ?? pb.quote.total;
bankWebhook(bcode, bt, `${bcode} thanh toan`);
const wb4 = await walletLedger(uid);
const cb = await A(U, 'POST', `/orders/${bcode}/cancel`, { cancelReasonCode: 'CHANGED_MIND', refundMethod: 'BANK', bankName: 'Vietcombank', accountNumber: '0123456789', accountName: 'nguyen thi quay lai' });
const wb5 = await walletLedger(uid);
const ref = await sql(`SELECT id, "orderCode", kind, method, status, amount::int, "bankName", "bankAccountNo", "bankAccountName" FROM order_customer_refunds WHERE "orderCode"=$1`, bcode);
check('B1-10', U, 'API', J, 'huỷ đơn đã trả, chọn hoàn về ngân hàng: không cộng ví, tạo 1 khoản MANUAL_TRANSFER PENDING', 'refund-destination.ts: Ví hoặc ngân hàng (admin chuyển tay)', cb.ok && wb5.bal === wb4.bal && ref.length === 1 && ref[0].status === 'PENDING' && ref[0].amount === bt, `cancel=${cb.status} ví ${wb4.bal}->${wb5.bal}; order_customer_refunds=${JSON.stringify(ref)}`);
const mine = (await A(U, 'GET', '/orders/me/refunds')).body;
check('B1-11', U, 'API', J, 'khách thấy khoản hoàn đang chờ ở GET /orders/me/refunds', 'customer-refunds.service.ts CUSTOMER_VISIBLE', JSON.stringify(mine).includes(bcode), `refunds=${JSON.stringify(mine).slice(0, 400)}`);
rec('B1-state', U, 'API', J, 'ghi lại mã đơn cho ca xoá tài khoản', '', `bankRefundOrder=${bcode} walletBalance=${wb5.bal}`, `${bcode}`, 'PASS');
await done();
