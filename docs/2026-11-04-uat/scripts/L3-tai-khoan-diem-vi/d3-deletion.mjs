// D3: yêu cầu xoá tài khoản: chặn khi ví còn tiền mà chưa đồng ý / còn khoản hoàn mở / còn đơn; đường thành công (ví đã đồng ý bỏ).
import { A, makeRec, place, codeOf, bankWebhook, sql, sql1, walletLedger, pointsLedger, done, L } from './lib3.mjs';
const { rec, check } = makeRec('d3-deletion');
const J = 'Yêu cầu xoá tài khoản';
const R = 'returning', rid = 'uat_returning';
const w = await walletLedger(rid);
const open0 = await sql(`SELECT "orderCode", status, amount::int, kind FROM order_customer_refunds WHERE status IN ('PENDING','PROCESSING') ORDER BY "createdAt"`);
check('D3-0', R, 'API', J, 'tiền đề: ví còn tiền, còn khoản hoàn ngân hàng PENDING (do B1-10 để lại)', 'B1-10', w.bal > 0 && open0.length > 0, `ví=${JSON.stringify(w)} khoản mở=${JSON.stringify(open0)}`);
const noTick = await A(R, 'POST', '/me/deletion-request', { reason: 'thử UAT', acknowledgedWalletBalance: w.bal, acceptWalletForfeit: false });
check('D3-1', R, 'API', J, 'ví còn tiền, không tick đồng ý bỏ số dư: 400 WALLET_FORFEIT_CONSENT, không tạo yêu cầu', 'users.service.ts requestAccountDeletion', noTick.status === 400 && noTick.body.code === 'WALLET_FORFEIT_CONSENT' && (await sql1(`SELECT count(*)::int n FROM account_deletion_requests WHERE "userId"=$1`, rid)).n === 0, `POST=${noTick.status} ${JSON.stringify(noTick.body)}`);
const wrong = await A(R, 'POST', '/me/deletion-request', { reason: 'thử UAT', acknowledgedWalletBalance: w.bal - 1000, acceptWalletForfeit: true });
check('D3-2', R, 'API', J, 'đồng ý nhưng số dư đã thấy lệch số thật: 400 "Số dư Ví Tubu vừa đổi..."', 'users.service.ts', wrong.status === 400 && /vừa đổi/.test(JSON.stringify(wrong.body)), `POST=${wrong.status} ${JSON.stringify(wrong.body)}`);
const ok = await A(R, 'POST', '/me/deletion-request', { reason: 'thử UAT', acknowledgedWalletBalance: w.bal, acceptWalletForfeit: true });
const req = await sql1(`SELECT id, status, "walletForfeitAmount"::int fa FROM account_deletion_requests WHERE "userId"=$1 AND status='PENDING'`, rid);
check('D3-3', R, 'API', J, 'đồng ý đúng số dư: ghi nhận yêu cầu, tài khoản CHƯA bị xoá, thông điệp "tài khoản CHƯA bị xoá"', 'users.service.ts requestAccountDeletion', ok.status === 201 && req?.fa === w.bal && /CHƯA bị xoá/.test(ok.body.message) && (await sql1(`SELECT "fullName" n FROM users WHERE id=$1`, rid)).n !== 'Người dùng đã xoá', `POST=${ok.status} ${JSON.stringify(ok.body)} SQL=${JSON.stringify(req)}`);
const again = await A(R, 'POST', '/me/deletion-request', { reason: 'lần 2', acknowledgedWalletBalance: w.bal, acceptWalletForfeit: true });
check('D3-4', R, 'API', J, 'gửi lại: không tạo dòng thứ hai (alreadyRequested)', 'users.service.ts', again.body.alreadyRequested === true && (await sql1(`SELECT count(*)::int n FROM account_deletion_requests WHERE "userId"=$1`, rid)).n === 1, `POST=${again.status} ${JSON.stringify(again.body)}`);
const lst = await A('admin', 'GET', '/admin/account-deletion-requests?status=PENDING');
const row = (lst.body ?? []).find((r) => r.userId === rid);
const codes = (row?.blockers ?? []).map((b) => b.code);
check('D3-5', 'admin', 'API', J, 'danh sách admin hiện blockers: CUSTOMER_REFUND_PENDING (khoản hoàn mở) + ORDER_IN_PROGRESS; KHÔNG còn WALLET_BALANCE (khách đã đồng ý)', 'account-deletion.service.ts collectBlockers', codes.includes('CUSTOMER_REFUND_PENDING') && codes.includes('ORDER_IN_PROGRESS') && !codes.includes('WALLET_BALANCE'), `blockers=${JSON.stringify(row?.blockers)}`);
const pr = await A('admin', 'POST', `/admin/account-deletion-requests/${req.id}/process`, {});
check('D3-6', 'admin', 'API', J, 'admin bấm Xử lý khi còn khoản hoàn mở: 400 ACCOUNT_DELETION_BLOCKED, KHÔNG ẩn danh, ví không đổi', 'account-deletion.service.ts processOnce', pr.status === 400 && pr.body.code === 'ACCOUNT_DELETION_BLOCKED' && (await walletLedger(rid)).bal === w.bal && (await sql1(`SELECT "fullName" n FROM users WHERE id=$1`, rid)).n === 'Nguyễn Thị Quay Lại', `POST=${pr.status} ${JSON.stringify(pr.body).slice(0, 500)}`);
// Bản Mini App cũ (chỉ gửi reason) khi ví còn tiền: đóng yêu cầu cũ bằng UPDATE rồi gửi lại
await sql(`UPDATE account_deletion_requests SET status='RESOLVED', "adminNote"='UAT: đóng tay để thử bản cũ' WHERE "userId"=$1 AND status='PENDING' RETURNING id`, rid);
const legacy = await A(R, 'POST', '/me/deletion-request', { reason: 'bản cũ' });
const lst2 = await A('admin', 'GET', '/admin/account-deletion-requests?status=PENDING');
const row2 = (lst2.body ?? []).find((r) => r.userId === rid);
check('D3-7', R, 'API', J, 'Mini App cũ (chỉ gửi reason) khi ví còn tiền: ghi nhận, admin thấy blocker WALLET_BALANCE "khách chưa đồng ý bỏ số dư"', 'users.service.ts comment: bản đã phát hành', legacy.status === 201 && (row2?.blockers ?? []).some((b) => b.code === 'WALLET_BALANCE' && /chưa đồng ý/.test(b.message)), `POST=${legacy.status} blockers=${JSON.stringify(row2?.blockers)}`);
const pr2 = await A('admin', 'POST', `/admin/account-deletion-requests/${row2.id}/process`, {});
check('D3-8', 'admin', 'API', J, 'admin Xử lý: bị chặn, câu "Chưa thể xoá tài khoản: ..."', 'account-deletion.service.ts', pr2.status === 400 && /^Chưa thể xoá tài khoản/.test(pr2.body.message), `POST=${pr2.status} ${pr2.body.message}`);
const rf = await sql1(`SELECT id FROM order_customer_refunds WHERE status='PENDING' LIMIT 1`);
const cl = await A('admin', 'POST', `/admin/customer-refunds/${rf.id}/claim`, {});
const mp = await A('admin', 'POST', `/admin/customer-refunds/${rf.id}/mark-paid`, { bankRef: 'UAT-FT26110401' });
const lst3 = await A('admin', 'GET', '/admin/account-deletion-requests?status=PENDING');
const row3 = (lst3.body ?? []).find((r) => r.userId === rid);
check('D3-9', 'admin', 'API', J, 'admin chuyển khoản xong + mark-paid: khoản COMPLETED, blocker CUSTOMER_REFUND_PENDING hết; vẫn còn blocker khác', 'customer-refunds.service.ts markPaid; collectBlockers', cl.ok && mp.ok && !(row3?.blockers ?? []).some((b) => b.code === 'CUSTOMER_REFUND_PENDING') && (row3?.blockers ?? []).length > 0, `claim=${cl.status} mark-paid=${mp.status} ${JSON.stringify(mp.body).slice(0, 200)} blockers=${JSON.stringify((row3?.blockers ?? []).map((b) => b.code))}`);
const notiRefund = (await A(R, 'GET', '/me/notifications')).body.find((n) => /UAT-FT26110401/.test(JSON.stringify(n)));
check('D3-10', R, 'API', J, 'khách nhận thông báo đã chuyển khoản kèm mã giao dịch', 'customer-refunds.service.ts markPaid (D2)', !!notiRefund, `thông báo=${notiRefund ? JSON.stringify(notiRefund.payload).slice(0, 300) : 'không thấy'}`);

const N = 'new_nophone', nid = 'uat_new_nophone';
const p = await place(N, [{ slug: 'nuoc-lau-kinh-fuwa3e', qty: 1 }], { payment: 'BANK_TRANSFER', tag: 'D3n' });
const nc = codeOf(p.order);
if (!nc) {
  rec('D3-11', N, 'API', J, 'khách chưa SĐT đặt đơn chuyển khoản để tạo ví', '', `place=${p.placeStatus} ${JSON.stringify(p.raw).slice(0, 300)}`, `place=${p.placeStatus} ${JSON.stringify(p.raw).slice(0, 300)}`, 'BLOCKED');
} else {
  bankWebhook(nc, p.order?.total ?? p.quote.total, `${nc} thanh toan`);
  await A(N, 'POST', `/orders/${nc}/cancel`, { cancelReasonCode: 'CHANGED_MIND' });
  const nw = await walletLedger(nid);
  const nreq = await A(N, 'POST', '/me/deletion-request', { reason: 'đường thành công', acknowledgedWalletBalance: nw.bal, acceptWalletForfeit: true });
  const nrow = await sql1(`SELECT id FROM account_deletion_requests WHERE "userId"=$1 AND status='PENDING'`, nid);
  const lst4 = await A('admin', 'GET', '/admin/account-deletion-requests?status=PENDING');
  const bl = ((lst4.body ?? []).find((r) => r.userId === nid)?.blockers ?? []).map((b) => b.code);
  const proc = await A('admin', 'POST', `/admin/account-deletion-requests/${nrow.id}/process`, {});
  const after = await sql1(`SELECT "fullName" n, "walletBalance"::int wb, "isBlocked" b, email, phone, dob FROM users WHERE id=$1`, nid);
  const fw = await sql(`SELECT delta::int, type, "refType" FROM wallet_transactions WHERE "userId"=$1 ORDER BY "createdAt" DESC LIMIT 1`, nid);
  const wl = await walletLedger(nid);
  check('D3-11', N, 'API', J, 'đường thành công: ví đã đồng ý bỏ, không khoản mở: admin Xử lý -> ẩn danh, ví về 0 bằng 1 dòng ADJUST, sổ khớp', 'account-deletion.service.ts forfeitWallet + anonymize', proc.ok && after.n === 'Người dùng đã xoá' && after.wb === 0 && fw[0]?.type === 'ADJUST' && fw[0]?.delta === -nw.bal && wl.bal === wl.sum_w && !after.email && !after.phone && !after.dob, `trước: ví=${nw.bal} request=${nreq.status} blockers=${JSON.stringify(bl)} process=${proc.status} ${JSON.stringify(proc.body)} sau=${JSON.stringify(after)} dòng ví cuối=${JSON.stringify(fw[0])} sổ=${JSON.stringify(wl)}`);
  await new Promise((r) => setTimeout(r, 6000));
  const tk = await A(N, 'GET', '/me');
  check('D3-12', N, 'API', J, 'tài khoản đã xoá: token cũ bị từ chối (sau cache phiên 5 giây)', 'SessionStateService + isBlocked', tk.status === 401 || tk.status === 403, `GET /me sau xoá 6 giây = ${tk.status} ${JSON.stringify(tk.body).slice(0, 200)}`);
}
await done();
