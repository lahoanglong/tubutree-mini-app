// "Cần xử lý Pancake" + Hoàn tiền khách (API lane 5).
// Nguồn luật: admin.service.ts resolvePancakeAttention (KHO "Đã xử lý"; khoản COD chờ Kế toán phải xử lý ở Hoàn tiền khách trước),
//             pancake-attention.ts (lý do), customer-refunds-admin.controller.ts (KE_TOAN: verify/claim/mark-paid; che SĐT cho Kế toán thuần),
//             order-reversal.service.ts (đơn đã PAID huỷ + chọn BANK => khoản PENDING, không cộng Ví).
import { execFileSync } from 'node:child_process';
import { call, check, rec, save, short, sql, placeOrder, waitPancake, orderRow, userState, sleep } from './_lib.mjs';

const WT = '/Users/longla/coding/tubutree-mini-app/.claude/worktrees/uat-1104';
const env = { ...process.env, PATH: `${process.env.HOME}/.local/node/node-v22.23.3-darwin-arm64/bin:${process.env.PATH}` };
const hook = (code, st) => execFileSync('node', [`${WT}/docs/2026-10-20-uat/tools/uat-harness/pancake-webhook.mjs`, '5', code, st], { cwd: WT, env, encoding: 'utf8', timeout: 90000 });
async function waitStatus(code, want, ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const o = await orderRow(code);
    if (o.status === want) return o;
    await sleep(500);
  }
  return orderRow(code);
}

// ---------- P1. Pancake báo huỷ sau bàn giao: vào "Cần xử lý Pancake" ----------
const P1 = await placeOrder('returning', { qty: 1, method: 'COD', slug: 'nuoc-giat-fuwa3e' });
await waitPancake(P1.code);
let o1 = await orderRow(P1.code);
await call('kho', 'PUT', `/admin/orders/${o1.id}/status`, { status: 'PACKED' });
hook(P1.code, 'shipped');
await waitStatus(P1.code, 'SHIPPING');
const cancelHook = hook(P1.code, 'cancelled');
await sleep(2500);
o1 = await orderRow(P1.code);
const att = await call('kho', 'GET', '/admin/orders?pancake=attention&limit=50');
const inQueue = att.body.data?.some((o) => o.code === P1.code);
const sqlAtt = await sql(`SELECT count(*)::int n FROM orders WHERE "pancakeAttentionAt" IS NOT NULL`);
check('L5-PK-queue-appear', 'kho', 'web1280', 'Cần xử lý Pancake', 'Pancake báo HUỶ đơn đã bàn giao', 'đơn vào hàng đợi (pancakeAttention có lý do), lọc ?pancake=attention thấy đơn, số đếm khớp SQL', !!o1.pa && inQueue && (att.body.meta?.total ?? att.body.total) === sqlAtt[0].n, `lý do="${(o1.pa ?? '').slice(0, 90)}"; trong hàng đợi=${inQueue}; API=${att.body.meta?.total}, SQL=${sqlAtt[0].n}; đơn ${o1.status}`, { cancelHook: cancelHook.split('\n').slice(-4).join(' ').slice(0, 200) });
for (const who of ['cskh', 'ketoan', 'marketing', 'staff']) {
  const r = await call(who, 'POST', `/admin/orders/${o1.id}/pancake-attention/resolve`, { note: 'thử' });
  check(`L5-PK-resolve-deny-${who}`, who, 'api', 'Cần xử lý Pancake', `${who} bấm Đã xử lý`, '403 (chỉ KHO/ADMIN)', r.status === 403, `HTTP ${r.status}`, short(r.body));
}
const cnt = await call('kho', 'GET', '/admin/ops/inbox');
const resolveOk = await call('kho', 'POST', `/admin/orders/${o1.id}/pancake-attention/resolve`, { note: 'đã gọi kho xác nhận (uat)' });
const o1b = await orderRow(P1.code);
const hist = await sql(`SELECT note, "actorId" a FROM order_status_history WHERE "orderId"=$1 ORDER BY "createdAt" DESC LIMIT 2`, [o1.id]);
check('L5-PK-resolve-ok', 'kho', 'web1280', 'Cần xử lý Pancake', 'KHO bấm "Đã xử lý"', '200; đơn rời hàng đợi (pancakeAttention rỗng); lịch sử đơn ghi ai xử lý', resolveOk.status < 300 && !o1b.pa && hist.some((h) => h.a === 'uat_kho'), `HTTP ${resolveOk.status}; còn lý do=${!!o1b.pa}`, { hist });
const resolveAgain = await call('kho', 'POST', `/admin/orders/${o1.id}/pancake-attention/resolve`, {});
check('L5-PK-resolve-twice', 'kho', 'api', 'Cần xử lý Pancake', 'bấm lần hai', '400: đơn không còn trong hàng đợi', resolveAgain.status === 400, `HTTP ${resolveAgain.status}`, short(resolveAgain.body));
const unsynced = await call('kho', 'GET', '/admin/orders?pancake=unsynced');
check('L5-PK-unsynced-filter', 'kho', 'api', 'Cần xử lý Pancake', 'lọc ?pancake=unsynced', '200 (đơn mới đẩy sau 15 phút mới tính chưa lên)', unsynced.ok, `HTTP ${unsynced.status} n=${unsynced.body.data?.length}`, '');

// ---------- P2. COD đã giao, Pancake báo "Đã hoàn": tiền KHÔNG tự hoàn, chờ Kế toán ----------
const P2 = await placeOrder('returning', { qty: 1, method: 'COD', slug: 'serum-duong-am-visante' });
await waitPancake(P2.code);
const o2 = await orderRow(P2.code);
await call('kho', 'PUT', `/admin/orders/${o2.id}/status`, { status: 'PACKED' });
hook(P2.code, 'shipped');
hook(P2.code, 'delivered');
await waitStatus(P2.code, 'DELIVERED');
const uBefore = await userState('uat_returning');
hook(P2.code, 'returned');
const o2r = await waitStatus(P2.code, 'RETURNED');
const uAfter = await userState('uat_returning');
const refRow = (await sql(`SELECT id, kind::text k, status::text s, amount::int a, method::text m, "refKey" rk FROM order_customer_refunds WHERE "orderId"=$1`, [o2.id]))[0];
check('L5-PK-cod-return-unverified', 'ketoan', 'web1280', 'Hoàn tiền khách: COD trả hàng', 'Pancake báo "Đã hoàn" cho đơn COD đã giao', 'đơn RETURNED; Ví khách KHÔNG tự tăng; có khoản RETURN trạng thái UNVERIFIED; đơn vào hàng đợi Pancake với lý do COD chờ Kế toán (pancake-attention.ts)', o2r.status === 'RETURNED' && uAfter.wallet === uBefore.wallet && refRow?.s === 'UNVERIFIED' && /COD/.test(o2r.pa ?? ''), `đơn ${o2r.status}; Ví ${uBefore.wallet}->${uAfter.wallet}; khoản ${refRow?.k}/${refRow?.s}/${refRow?.a}`, { refRow, pa: (o2r.pa ?? '').slice(0, 120) });
const resolveBlocked = await call('kho', 'POST', `/admin/orders/${o2.id}/pancake-attention/resolve`, {});
check('L5-PK-resolve-blocked-cod', 'kho', 'api', 'Hoàn tiền khách: COD trả hàng', 'KHO bấm Đã xử lý khi còn khoản COD chờ Kế toán', '400: xử lý ở mục Hoàn tiền khách trước (admin.service.ts:1400)', resolveBlocked.status === 400 && /Hoàn tiền khách/.test(JSON.stringify(resolveBlocked.body)), `HTTP ${resolveBlocked.status}`, short(resolveBlocked.body));
// danh sách Hoàn tiền khách theo vai trò
for (const who of ['cskh', 'kho', 'marketing', 'staff']) {
  const r = await call(who, 'GET', '/admin/customer-refunds');
  check(`L5-RF-list-deny-${who}`, who, 'api', 'Hoàn tiền khách', `${who} xem Hoàn tiền khách`, '403', r.status === 403, `HTTP ${r.status}`, short(r.body));
}
const lk = await call('ketoan', 'GET', '/admin/customer-refunds?status=UNVERIFIED');
const row = lk.body.data?.find((r) => r.id === refRow.id);
check('L5-RF-list-ketoan', 'ketoan', 'web1280', 'Hoàn tiền khách', 'Kế toán xem khoản chờ đối soát', '200, thấy khoản COD trả hàng chờ đối soát', lk.ok && !!row, `HTTP ${lk.status}; khoản ${row?.id}`, short(row, 300));
const tooMuch = await call('ketoan', 'POST', `/admin/customer-refunds/${refRow.id}/verify`, { amount: refRow.a + 1 });
check('L5-RF-verify-over', 'ketoan', 'api', 'Hoàn tiền khách', 'xác nhận hoàn quá số khoản', '400: tối đa phần chưa hoàn', tooMuch.status === 400, `HTTP ${tooMuch.status}`, short(tooMuch.body));
const wlBefore = await userState('uat_returning');
const ver = await call('ketoan', 'POST', `/admin/customer-refunds/${refRow.id}/verify`, { note: 'hãng xác nhận đã thu COD (uat)' });
const afterVer = (await sql(`SELECT status::text s, amount::int a FROM order_customer_refunds WHERE id=$1`, [refRow.id]))[0];
const o2c = await orderRow(P2.code);
check('L5-RF-verify-ok', 'ketoan', 'web1280', 'Hoàn tiền khách', 'Kế toán xác nhận hãng đã thu COD', 'khoản UNVERIFIED -> PENDING; lý do COD rời hàng đợi Pancake', ver.status < 300 && afterVer.s === 'PENDING' && !(o2c.pa ?? '').includes('COD'), `HTTP ${ver.status}; khoản ${afterVer.s}; còn lý do=${!!o2c.pa}`, short(ver.body, 200));
const claimC = await call('cskh', 'POST', `/admin/customer-refunds/${refRow.id}/claim`, {});
check('L5-RF-claim-deny-cskh', 'cskh', 'api', 'Hoàn tiền khách', 'CSKH bấm bắt đầu chuyển khoản', '403', claimC.status === 403, `HTTP ${claimC.status}`, short(claimC.body));
const claimKt = await call('ketoan', 'POST', `/admin/customer-refunds/${refRow.id}/claim`, { bankName: 'Vietcombank', accountNumber: '0011004567890', accountName: 'NGUYEN THI QUAY LAI' });
check('L5-RF-claim-ketoan-typed-bank', 'ketoan', 'api', 'Hoàn tiền khách', 'Kế toán tự nhập số tài khoản nhận thay khách', '403: nhân viên không nhập tài khoản nhận, nhờ quản trị viên (customer-refunds.service assertStaffMayHandle)', claimKt.status === 403, `HTTP ${claimKt.status}`, short(claimKt.body));
const mpEarly = await call('ketoan', 'POST', `/admin/customer-refunds/${refRow.id}/mark-paid`, { bankRef: 'UATRF000' });
check('L5-RF-markpaid-no-account', 'ketoan', 'api', 'Hoàn tiền khách', 'Đã chi khi khách chưa có tài khoản nhận', '403: khách chưa chọn tài khoản nhận (không chi khi chưa biết chuyển đâu)', mpEarly.status === 403, `HTTP ${mpEarly.status}`, short(mpEarly.body));
const claim = await call('admin', 'POST', `/admin/customer-refunds/${refRow.id}/claim`, { bankName: 'Vietcombank', accountNumber: '0011004567890', accountName: 'NGUYEN THI QUAY LAI' });
const afterClaim = (await sql(`SELECT status::text s FROM order_customer_refunds WHERE id=$1`, [refRow.id]))[0];
check('L5-RF-claim-ok', 'admin', 'web1280', 'Hoàn tiền khách', 'ADMIN nhập tài khoản và bắt đầu chuyển khoản', 'khoản sang PROCESSING', claim.status < 300 && afterClaim.s === 'PROCESSING', `HTTP ${claim.status}; ${afterClaim.s}`, short(claim.body, 240));
const mpNoRef = await call('ketoan', 'POST', `/admin/customer-refunds/${refRow.id}/mark-paid`, {});
check('L5-RF-markpaid-noref', 'ketoan', 'api', 'Hoàn tiền khách', 'Đã chi không có mã giao dịch', '400 (bankRef bắt buộc)', mpNoRef.status === 400, `HTTP ${mpNoRef.status}`, short(mpNoRef.body));
const mpLock = await call('ketoan', 'POST', `/admin/customer-refunds/${refRow.id}/mark-paid`, { bankRef: 'UATRF001', note: 'chuyển khoản uat' });
check('L5-RF-markpaid-claimed-by-other', 'ketoan', 'api', 'Hoàn tiền khách', 'Kế toán bấm Đã chi khoản do ADMIN đang chuyển', '400: chỉ người đang chuyển được xác nhận, hoặc chọn Tiếp quản kèm lý do (customer-refunds.service)', mpLock.status === 400 && /Tiếp quản/.test(JSON.stringify(mpLock.body)), `HTTP ${mpLock.status}`, short(mpLock.body, 260));
const mp = await call('ketoan', 'POST', `/admin/customer-refunds/${refRow.id}/mark-paid`, { bankRef: 'UATRF001', note: 'chuyển khoản uat', takeOver: true, takeOverReason: 'Admin nhờ kế toán chi giúp (uat)' });
const afterMp = (await sql(`SELECT status::text s FROM order_customer_refunds WHERE id=$1`, [refRow.id]))[0];
const wlAfter = await userState('uat_returning');
check('L5-RF-markpaid-ok', 'ketoan', 'web1280', 'Hoàn tiền khách', 'Kế toán bấm Đã chi', 'khoản COMPLETED; chi bằng chuyển khoản tay nên Ví khách KHÔNG đổi; Ví = sổ Ví', mp.status < 300 && afterMp.s === 'COMPLETED' && wlAfter.wallet === wlBefore.wallet && wlAfter.wallet === wlAfter.wsum, `HTTP ${mp.status}; ${JSON.stringify(afterMp)}; Ví ${wlBefore.wallet}->${wlAfter.wallet}`, short(mp.body, 240));
const mp2 = await call('ketoan', 'POST', `/admin/customer-refunds/${refRow.id}/mark-paid`, { bankRef: 'UATRF001' });
check('L5-RF-markpaid-twice', 'ketoan', 'api', 'Hoàn tiền khách', 'bấm Đã chi lần hai', '4xx, không ghi hai lần', mp2.status >= 400 && mp2.status < 500, `HTTP ${mp2.status}`, short(mp2.body));
const resolveAfter = await call('kho', 'POST', `/admin/orders/${o2.id}/pancake-attention/resolve`, {});
rec('L5-PK-resolve-after-refund', 'kho', 'api', 'Hoàn tiền khách: COD trả hàng', 'KHO bấm Đã xử lý sau khi Kế toán xong', 'tuỳ lý do còn lại: 400 "không còn trong hàng đợi" là đúng nếu Kế toán đã gỡ lý do', `HTTP ${resolveAfter.status} ${short(resolveAfter.body, 120)}`, { pa: (await orderRow(P2.code)).pa }, [200, 201, 400].includes(resolveAfter.status) ? 'PASS' : 'FAIL');

// ---------- P3. huỷ đơn CHUYỂN KHOẢN đã trả, khách chọn nhận về NGÂN HÀNG ----------
const P3 = await placeOrder('returning', { qty: 1, method: 'BANK_TRANSFER', slug: 'nuoc-rua-chen-fuwa3e' });
await waitPancake(P3.code);
const o3 = await orderRow(P3.code);
await call('ketoan', 'POST', `/admin/orders/${o3.id}/confirm-payment`, { bankRef: 'UATGD003' });
const uP0 = await userState('uat_returning');
const cancelBank = await call('returning', 'POST', `/orders/${P3.code}/cancel`, { refundMethod: 'BANK', bankName: 'Vietcombank', accountNumber: '0011004567890', accountName: 'NGUYEN THI QUAY LAI', cancelReasonCode: 'CHANGED_MIND' });
const o3b = await orderRow(P3.code);
const uP1 = await userState('uat_returning');
const r3 = (await sql(`SELECT id, kind::text k, status::text s, amount::int a, method::text m FROM order_customer_refunds WHERE "orderId"=$1`, [o3.id]))[0];
check('L5-RF-cancel-bank', 'returning', 'mini375', 'Hoàn toàn phần về ngân hàng', 'khách huỷ đơn đã chuyển khoản, chọn nhận về ngân hàng', `đơn CANCELLED/REFUNDED; có khoản CANCEL PENDING ${o3.total}đ; Ví KHÔNG đổi`, cancelBank.status < 300 && o3b.status === 'CANCELLED' && r3?.k === 'CANCEL' && r3?.s === 'PENDING' && r3?.a === o3.total && uP1.wallet === uP0.wallet, `HTTP ${cancelBank.status}; ${o3b.status}/${o3b.ps}; khoản ${JSON.stringify(r3)}; Ví ${uP0.wallet}->${uP1.wallet}`, short(cancelBank.body, 160));
if (r3) {
  const cl = await call('ketoan', 'POST', `/admin/customer-refunds/${r3.id}/claim`, {});
  const mpo = await call('ketoan', 'POST', `/admin/customer-refunds/${r3.id}/mark-paid`, { bankRef: 'UATRF002' });
  const fin = (await sql(`SELECT status::text s FROM order_customer_refunds WHERE id=$1`, [r3.id]))[0];
  const uP2 = await userState('uat_returning');
  check('L5-RF-cancel-bank-paid', 'ketoan', 'web1280', 'Hoàn toàn phần về ngân hàng', 'Kế toán claim rồi Đã chi', 'COMPLETED; Ví khách không đổi', cl.status < 300 && mpo.status < 300 && fin.s === 'COMPLETED' && uP2.wallet === uP1.wallet, `claim ${cl.status}; paid ${mpo.status}; ${fin.s}; Ví ${uP1.wallet}->${uP2.wallet}`, short(mpo.body, 200));
}
// thiếu số tài khoản
const P4 = await placeOrder('returning', { qty: 1, method: 'BANK_TRANSFER', slug: 'nuoc-giat-fuwa3e' });
const o4 = await orderRow(P4.code);
await call('ketoan', 'POST', `/admin/orders/${o4.id}/confirm-payment`, {});
const badBank = await call('returning', 'POST', `/orders/${P4.code}/cancel`, { refundMethod: 'BANK', bankName: 'Vietcombank' });
const o4b = await orderRow(P4.code);
check('L5-RF-cancel-bank-missing', 'returning', 'mini375', 'Hoàn toàn phần về ngân hàng', 'huỷ chọn ngân hàng nhưng thiếu số tài khoản', '400 lời tiếng Việt, đơn KHÔNG bị huỷ', badBank.status === 400 && o4b.status !== 'CANCELLED', `HTTP ${badBank.status}; đơn ${o4b.status}`, short(badBank.body));
// ---------- P5. che SĐT trong ghi chú khoản hoàn cho Kế toán ----------
const P5 = await placeOrder('returning', { qty: 1, method: 'COD', slug: 'nuoc-rua-chen-fuwa3e' });
await waitPancake(P5.code);
const o5 = await orderRow(P5.code);
await call('kho', 'PUT', `/admin/orders/${o5.id}/status`, { status: 'PACKED' });
hook(P5.code, 'shipped'); hook(P5.code, 'delivered'); await waitStatus(P5.code, 'DELIVERED'); hook(P5.code, 'returned'); await waitStatus(P5.code, 'RETURNED');
const r5 = (await sql(`SELECT id FROM order_customer_refunds WHERE "orderId"=$1`, [o5.id]))[0];
await call('ketoan', 'POST', `/admin/customer-refunds/${r5.id}/verify`, { note: 'khách gọi từ 0912345678 xác nhận' });
const l5k = await call('ketoan', 'GET', `/admin/customer-refunds?q=${P5.code}`);
const l5a = await call('admin', 'GET', `/admin/customer-refunds?q=${P5.code}`);
const noteK = JSON.stringify(l5k.body.data?.[0]?.adminNote ?? ''), noteA = JSON.stringify(l5a.body.data?.[0]?.adminNote ?? '');
check('L5-RF-note-mask', 'ketoan', 'web1280', 'Hoàn tiền khách: che SĐT', 'ghi chú khoản hoàn có SĐT', 'Kế toán thấy SĐT trong ghi chú bị che; ADMIN thấy đủ', !noteK.includes('0912345678') && noteA.includes('0912345678'), `kế toán: ${noteK}; admin: ${noteA}`, '');
save('06-pancake-refunds');
console.log(JSON.stringify({ P1: P1.code, P2: P2.code, P3: P3.code, P4: P4.code }));
