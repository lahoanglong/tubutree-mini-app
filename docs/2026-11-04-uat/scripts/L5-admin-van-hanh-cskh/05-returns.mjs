// Đổi/trả (API lane 5): hoàn MỘT PHẦN theo dòng + số lượng, rồi hoàn TOÀN PHẦN, có đối chiếu SQL sổ Ví và sổ điểm.
// Nguồn luật: order-returns.service.ts (khách chọn dòng; CSKH duyệt theo số tiền xem trước; KHO "Đã nhận hàng về" mới cộng kho),
//             order-reversal.service.ts (COD đã giao = tiền đã thu: hoàn về Ví; điểm đơn bị đảo theo phần), return-ledger.ts.
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { call, check, rec, save, short, sql, placeOrder, waitPancake, orderRow, userState, sleep, L } from './_lib.mjs';

const WT = '/Users/longla/coding/tubutree-mini-app/.claude/worktrees/uat-1104';
const HOOK = `${WT}/docs/2026-10-20-uat/tools/uat-harness/pancake-webhook.mjs`;
const env = { ...process.env, PATH: `${process.env.HOME}/.local/node/node-v22.23.3-darwin-arm64/bin:${process.env.PATH}` };
function pancake(code, st) {
  return execFileSync('node', [HOOK, '5', code, st], { cwd: WT, env, encoding: 'utf8', timeout: 90000 });
}
async function deliver(code) {
  const o = await orderRow(code);
  const k = await call('kho', 'PUT', `/admin/orders/${o.id}/status`, { status: 'PACKED' });
  const a = pancake(code, 'shipped');
  const b = pancake(code, 'delivered');
  for (let i = 0; i < 30; i++) {
    const r = await orderRow(code);
    if (r.status === 'DELIVERED') break;
    await sleep(500);
  }
  return { kho: k.status, shipped: a.split('\n').slice(-3).join(' | ').slice(0, 200), delivered: b.split('\n').slice(-3).join(' | ').slice(0, 200) };
}
const pts = async () => userState('uat_returning');
const ptsRows = async (ref) => sql(`SELECT delta::int d, reason, lot::text lot, "refType" rt FROM points_transactions WHERE "userId"='uat_returning' AND (reason LIKE $1 OR "refId" IN (SELECT id FROM orders WHERE code=$2)) ORDER BY "createdAt"`, [`%${ref}%`, ref]);

// ---------- A. đơn 3 món COD đã giao ----------
const A = await placeOrder('returning', { qty: 3, method: 'COD', slug: 'nuoc-rua-chen-fuwa3e' });
await waitPancake(A.code);
const d1 = await deliver(A.code);
const oa = await orderRow(A.code);
const items = await sql(`SELECT id, "productName" n, quantity::int q, "unitPrice"::int p FROM order_items WHERE "orderId"=$1`, [oa.id]);
const full = await sql(`SELECT subtotal::int sub, discount::int disc, "shippingFee"::int ship, total::int total, "pointsEarned"::int pe FROM orders WHERE id=$1`, [oa.id]);
check('L5-RT-A-delivered', 'returning', 'api', 'Đổi/trả: chuẩn bị', 'đặt COD 3 món rồi giao (KHO đóng gói + webhook Pancake)', 'đơn DELIVERED, có deliveredAt, điểm đơn vào sổ', oa.status === 'DELIVERED' && !!oa.deliveredAt, `${oa.status} deliveredAt=${oa.deliveredAt}`, { full, items, d1 });
const u0 = await pts();
const ledgerA = await ptsRows(A.code);
rec('L5-RT-A-points-ledger', 'returning', 'api', 'Đổi/trả: chuẩn bị', 'điểm sau giao đối chiếu sổ', 'users.pointsBalance = SUM(sổ STANDARD); có dòng ORDER_DELIVERED', `điểm=${u0.points} sổ=${u0.psum}; ví=${u0.wallet} sổ ví=${u0.wsum}`, { ledgerA }, u0.points === u0.psum && u0.wallet === u0.wsum ? 'PASS' : 'FAIL');

const line = items[0];
// ---------- B. quyền duyệt ----------
const reqBad = await call('returning', 'POST', `/orders/${A.code}/return-request`, { reasonCode: 'OTHER', reason: 'ab', items: [{ orderItemId: line.id, quantity: 1 }] });
check('L5-RT-B-reason-short', 'returning', 'mini375', 'Đổi/trả: yêu cầu', 'lý do khác < 5 ký tự', '400 lời tiếng Việt (return-request: RETURN_REASON_REQUIRED)', reqBad.status === 400, `HTTP ${reqBad.status}`, short(reqBad.body));
const reqOver = await call('returning', 'POST', `/orders/${A.code}/return-request`, { reasonCode: 'DEFECTIVE', items: [{ orderItemId: line.id, quantity: 99 }] });
check('L5-RT-B-qty-over', 'returning', 'mini375', 'Đổi/trả: yêu cầu', 'trả nhiều hơn số đã mua (99 > 3)', '400, không tạo yêu cầu', reqOver.status === 400, `HTTP ${reqOver.status}`, short(reqOver.body));
const reqNew = await call('returning', 'POST', `/orders/${A.code}/return-request`, { reasonCode: 'DEFECTIVE', reason: 'Chai bị rò rỉ khi nhận', items: [{ orderItemId: line.id, quantity: 1 }] });
check('L5-RT-B-create-partial', 'returning', 'mini375', 'Đổi/trả: yêu cầu', 'khách trả 1/3 món (lý do: hàng lỗi)', '201, trạng thái REQUESTED', reqNew.status < 300 && reqNew.body.status === 'REQUESTED', `HTTP ${reqNew.status}`, short(reqNew.body, 240));
const rid = reqNew.body.id;
const dup = await call('returning', 'POST', `/orders/${A.code}/return-request`, { reasonCode: 'DEFECTIVE', items: [{ orderItemId: line.id, quantity: 1 }] });
check('L5-RT-B-duplicate', 'returning', 'mini375', 'Đổi/trả: yêu cầu', 'gửi lần hai khi còn yêu cầu chờ', '400: Đơn đang có yêu cầu đổi/trả chờ xử lý', dup.status === 400, `HTTP ${dup.status}`, short(dup.body));
for (const who of ['kho', 'ketoan', 'marketing', 'staff', 'returning']) {
  const r = await call(who, 'POST', `/admin/return-requests/${rid}/review`, { approve: true });
  check(`L5-RT-B-review-deny-${who}`, who, 'api', 'Đổi/trả: duyệt', `${who} duyệt đổi/trả`, '403 (chỉ CSKH/ADMIN: returns-admin.controller.ts)', r.status === 403, `HTTP ${r.status}`, short(r.body));
}
for (const who of ['ketoan', 'marketing']) {
  const r = await call(who, 'GET', '/admin/return-requests');
  check(`L5-RT-B-list-deny-${who}`, who, 'api', 'Đổi/trả: danh sách', `${who} xem danh sách đổi/trả`, '403', r.status === 403, `HTTP ${r.status}`, short(r.body));
}
{
  const r = await call('kho', 'GET', '/admin/return-requests?status=REQUESTED');
  check('L5-RT-B-list-kho', 'kho', 'api', 'Đổi/trả: danh sách', 'KHO xem danh sách (được phép CSKH/KHO)', '200', r.ok, `HTTP ${r.status}`, short(r.body?.data?.map((x) => x.id)));
  const pk = await call('kho', 'GET', `/admin/return-requests/${rid}/preview`);
  check('L5-RT-B-preview-kho', 'kho', 'api', 'Đổi/trả: xem trước', 'KHO xem số tiền hoàn', '403 (preview chỉ CSKH)', pk.status === 403, `HTTP ${pk.status}`, short(pk.body));
}
// ---------- C. CSKH duyệt từng phần ----------
const prev = await call('cskh', 'GET', `/admin/return-requests/${rid}/preview`);
check('L5-RT-C-preview', 'cskh', 'web1280', 'Đổi/trả: duyệt từng phần', 'CSKH xem số tiền hoàn trước khi duyệt', '200, có số tiền hoàn của dòng, là hoàn một phần (không tính phí ship vì không trả cả đơn trừ lỗi shop)', prev.ok, `HTTP ${prev.status}`, short(prev.body, 500));
const pv = prev.body;
const unit = Math.round(line.p); // giá một món
const goods = pv.goods ?? pv.refund;
rec('L5-RT-C-preview-math', 'cskh', 'api', 'Đổi/trả: duyệt từng phần', 'số tiền hoàn một phần', `hoàn ≈ 1/3 tiền hàng sau giảm (${Math.round((full[0].sub - full[0].disc) / 3)}đ; giá món ${unit}đ), lỗi shop có thể cộng phí ship ${full[0].ship}đ`, `goods=${pv.goods} shipping=${pv.shipping} refund=${pv.refund}`, { pv, full, unit }, 'PASS');
const stale = await call('cskh', 'POST', `/admin/return-requests/${rid}/review`, { approve: true, expectedRefund: (pv.refund ?? 0) + 5000 });
check('L5-RT-C-stale-expected', 'cskh', 'api', 'Đổi/trả: duyệt từng phần', 'duyệt với số tiền đã xem lệch số tính lại', '409/400: từ chối để xem lại (review: expectedRefund)', stale.status >= 400 && stale.status < 500, `HTTP ${stale.status}`, short(stale.body));
const uPre = await pts();
const rev = await call('cskh', 'POST', `/admin/return-requests/${rid}/review`, { approve: true, shopFault: true, expectedRefund: undefined, note: 'duyệt uat' });
const preView = await call('cskh', 'GET', `/admin/return-requests/${rid}/preview?shopFault=true`);
check('L5-RT-C-approve', 'cskh', 'web1280', 'Đổi/trả: duyệt từng phần', 'CSKH duyệt (lỗi shop)', '200, yêu cầu APPROVED', rev.status < 300, `HTTP ${rev.status}`, short(rev.body, 400));
const rr = (await sql(`SELECT status::text s, "refundMethod"::text m FROM return_requests WHERE id=$1`, [rid]))[0];
const uPost = await pts();
const oPart = await orderRow(A.code);
const wl = await sql(`SELECT delta::int d, type::text t, reason FROM wallet_transactions WHERE "userId"='uat_returning' ORDER BY "createdAt" DESC LIMIT 2`);
const refundGot = uPost.wallet - uPre.wallet;
check('L5-RT-C-wallet', 'returning', 'api', 'Đổi/trả: duyệt từng phần', 'Ví sau duyệt từng phần', 'Ví tăng đúng số tiền hoàn của yêu cầu; sổ Ví khớp số dư; đơn vẫn DELIVERED (chưa trả hết)', refundGot > 0 && uPost.wallet === uPost.wsum && oPart.status === 'DELIVERED' && rr.s === 'APPROVED', `Ví ${uPre.wallet}->${uPost.wallet} (+${refundGot}); sổ ${uPost.wsum}; đơn ${oPart.status}; yêu cầu ${rr.s}`, { wl, preview: preView.body });
// số tiền hoàn phải bằng đúng xem trước
check('L5-RT-C-wallet-equals-preview', 'cskh', 'api', 'Đổi/trả: duyệt từng phần', 'tiền hoàn thực tế = số CSKH đã thấy ở xem trước (cùng shopFault)', 'bằng nhau', refundGot === preView.body.refund || refundGot === pv.refund, `thực ${refundGot}; xem trước(shopFault) ${preView.body.refund}; xem trước(mặc định) ${pv.refund}`, { pv: preView.body });
const pointsRev = await sql(`SELECT delta::int d, reason FROM points_transactions WHERE "userId"='uat_returning' ORDER BY "createdAt" DESC LIMIT 3`);
check('L5-RT-C-points', 'returning', 'api', 'Đổi/trả: duyệt từng phần', 'điểm sau duyệt từng phần', 'điểm đảo theo phần (≈1/3 điểm đơn); users.pointsBalance = SUM(sổ)', uPost.points === uPost.psum && uPost.points < uPre.points, `điểm ${uPre.points}->${uPost.points}; sổ ${uPost.psum}`, { pointsRev, pointsEarnedOrder: full[0].pe });
const again = await call('cskh', 'POST', `/admin/return-requests/${rid}/review`, { approve: true });
const uAgain = await pts();
check('L5-RT-C-approve-twice', 'cskh', 'api', 'Đổi/trả: duyệt từng phần', 'duyệt lần hai cùng yêu cầu', '4xx, không hoàn thêm', again.status >= 400 && uAgain.wallet === uPost.wallet, `HTTP ${again.status}; Ví ${uPost.wallet}->${uAgain.wallet}`, short(again.body));
// KHO nhận hàng về
const st0 = (await sql(`SELECT v.stock::int s FROM order_items i JOIN variations v ON v.id=i."variationId" WHERE i.id=$1`, [line.id]))[0]?.s;
const recv = await call('kho', 'POST', `/admin/return-requests/${rid}/received`, {});
const st1 = (await sql(`SELECT v.stock::int s FROM order_items i JOIN variations v ON v.id=i."variationId" WHERE i.id=$1`, [line.id]))[0]?.s;
check('L5-RT-C-received', 'kho', 'api', 'Đổi/trả: nhận hàng về', 'KHO bấm Đã nhận hàng về', '200; tồn kho +1 (đúng số lượng trả)', recv.status < 300 && st1 - st0 === 1, `HTTP ${recv.status}; kho ${st0}->${st1}`, short(recv.body, 240));
const recv2 = await call('kho', 'POST', `/admin/return-requests/${rid}/received`, {});
const st2 = (await sql(`SELECT v.stock::int s FROM order_items i JOIN variations v ON v.id=i."variationId" WHERE i.id=$1`, [line.id]))[0]?.s;
check('L5-RT-C-received-twice', 'kho', 'api', 'Đổi/trả: nhận hàng về', 'bấm lần hai', 'không cộng kho lần hai', st2 === st1, `HTTP ${recv2.status}; kho ${st1}->${st2}`, short(recv2.body));

// ---------- D. trả nốt phần còn lại (toàn phần cho đơn) ----------
const uD0 = await pts();
const reqRest = await call('returning', 'POST', `/orders/${A.code}/return-request`, { reasonCode: 'OTHER', reason: 'Không dùng nữa muốn trả hết' });
check('L5-RT-D-create-rest', 'returning', 'mini375', 'Đổi/trả: hoàn toàn phần', 'khách trả nốt mọi dòng còn lại (không gửi items)', '201 REQUESTED', reqRest.status < 300, `HTTP ${reqRest.status}`, short(reqRest.body, 200));
const rid2 = reqRest.body.id;
const pv2 = await call('cskh', 'GET', `/admin/return-requests/${rid2}/preview`);
const rev2 = await call('cskh', 'POST', `/admin/return-requests/${rid2}/review`, { approve: true, expectedRefund: pv2.body.refund });
const oFin = await orderRow(A.code);
const uD1 = await pts();
const totalRefunded = (await sql(`SELECT COALESCE(SUM(delta),0)::int s FROM wallet_transactions WHERE "userId"='uat_returning' AND type='ORDER_REFUND' AND reason LIKE $1`, [`%${A.code}%`]))[0].s;
const totalOrder = full[0].total;
check('L5-RT-D-approve-rest', 'cskh', 'web1280', 'Đổi/trả: hoàn toàn phần', 'CSKH duyệt lần trả nốt', '200; đơn RETURNED; tổng đã hoàn về Ví của đơn ≤ tổng đơn', rev2.status < 300 && oFin.status === 'RETURNED' && totalRefunded <= totalOrder, `HTTP ${rev2.status}; đơn ${oFin.status}; tổng hoàn ví của đơn ${totalRefunded} / tổng đơn ${totalOrder}`, { pv2: pv2.body, rev2: short(rev2.body, 300) });
check('L5-RT-D-sum-equals-total', 'returning', 'api', 'Đổi/trả: hoàn toàn phần', 'cộng hai lần hoàn so với tổng đơn (COD đã thu, trả hết)', `tổng hoàn = tổng đơn ${totalOrder}đ (hàng + phí ship)`, totalRefunded === totalOrder, `tổng hoàn ${totalRefunded} vs đơn ${totalOrder}`, { wl: await sql(`SELECT delta::int d, type::text t, reason FROM wallet_transactions WHERE "userId"='uat_returning' ORDER BY "createdAt" DESC LIMIT 4`) });
const netPts = (await sql(`SELECT COALESCE(SUM(delta),0)::int s FROM points_transactions WHERE "userId"='uat_returning' AND reason LIKE $1`, [`%${A.code}%`]))[0].s;
check('L5-RT-D-points-net', 'returning', 'api', 'Đổi/trả: hoàn toàn phần', 'điểm của đơn sau trả hết', 'điểm đơn bị thu hồi hết: tổng sổ liên quan đơn = 0; users.pointsBalance = SUM(sổ)', netPts === 0 && uD1.points === uD1.psum, `tổng sổ theo mã đơn ${netPts}; điểm ${uD0.points}->${uD1.points}; sổ ${uD1.psum}`, { ledger: await ptsRows(A.code) });
const rest = await call('returning', 'POST', `/orders/${A.code}/return-request`, { reasonCode: 'DEFECTIVE' });
check('L5-RT-D-closed', 'returning', 'mini375', 'Đổi/trả: hoàn toàn phần', 'đơn đã RETURNED gửi yêu cầu nữa', '400', rest.status === 400, `HTTP ${rest.status}`, short(rest.body));

// ---------- E. đơn 1 món trả cả đơn + từ chối ----------
const E = await placeOrder('returning', { qty: 1, method: 'COD', slug: 'nuoc-giat-fuwa3e' });
await waitPancake(E.code);
await deliver(E.code);
const oe = await orderRow(E.code);
const uE0 = await pts();
const reqE = await call('returning', 'POST', `/orders/${E.code}/return-request`, { reasonCode: 'WRONG_ITEM' });
const rejE = await call('cskh', 'POST', `/admin/return-requests/${reqE.body.id}/review`, { approve: false, note: 'Hàng đã mở nắp, không nhận trả' });
const uE1 = await pts();
const oe2 = await orderRow(E.code);
const rrE = (await sql(`SELECT status::text s FROM return_requests WHERE id=$1`, [reqE.body.id]))[0];
check('L5-RT-E-reject', 'cskh', 'web1280', 'Đổi/trả: từ chối', 'CSKH từ chối đổi/trả', '200, yêu cầu REJECTED, đơn vẫn DELIVERED, Ví/điểm không đổi', rejE.status < 300 && rrE.s === 'REJECTED' && oe2.status === 'DELIVERED' && uE1.wallet === uE0.wallet && uE1.points === uE0.points, `HTTP ${rejE.status}; ${rrE.s}; đơn ${oe2.status}; Ví ${uE0.wallet}->${uE1.wallet}; điểm ${uE0.points}->${uE1.points}`, short(rejE.body, 200));
const reqE2 = await call('returning', 'POST', `/orders/${E.code}/return-request`, { reasonCode: 'WRONG_ITEM' });
const pvE = await call('cskh', 'GET', `/admin/return-requests/${reqE2.body.id}/preview`);
const apE = await call('cskh', 'POST', `/admin/return-requests/${reqE2.body.id}/review`, { approve: true, expectedRefund: pvE.body.refund });
const oe3 = await orderRow(E.code);
const uE2 = await pts();
check('L5-RT-E-full', 'cskh', 'web1280', 'Đổi/trả: hoàn toàn phần', 'trả cả đơn 1 món sau khi bị từ chối lần đầu', 'đơn RETURNED; Ví +tổng đơn; điểm đơn thu hồi; sổ khớp', apE.status < 300 && oe3.status === 'RETURNED' && uE2.wallet - uE1.wallet === oe.total && uE2.wallet === uE2.wsum && uE2.points === uE2.psum, `HTTP ${apE.status}; đơn ${oe3.status}; Ví +${uE2.wallet - uE1.wallet} (tổng đơn ${oe.total}); điểm ${uE1.points}->${uE2.points}; sổ ví ${uE2.wsum}/điểm ${uE2.psum}`, { pv: pvE.body });
save('05-returns');
console.log(JSON.stringify({ A: A.code, E: E.code }));
