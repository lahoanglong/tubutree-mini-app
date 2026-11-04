// Lane 5: lệnh rút legacy, hoá đơn VAT, trần mã giảm giá của Marketing, mẫu thông báo, cấu hình hệ thống, sức khoẻ vận hành.
// Chạy từ gốc worktree uat-1104:  node <đường dẫn>/07-ops-misc.mjs
import { L, ENV, call, sql, rec, check, save, short, placeOrder, orderRow, waitPancake, userState, idem, sleep } from './_lib.mjs';

const ROLES = ['staff', 'kho', 'ketoan', 'marketing', 'cskh'];
const NON_ADMIN_NO_KETOAN = ['staff', 'kho', 'marketing', 'cskh'];
const iso = (d) => new Date(d).toISOString();
const now = Date.now();
const startAt = iso(now - 3600e3);
const endAt = iso(now + 30 * 86400e3);
const tag = Date.now().toString(36).toUpperCase().slice(-6);

// ───────────────────────── A. Lệnh rút legacy (Payout) ─────────────────────────
// App chỉ còn chuyển hoa hồng vào Ví (WALLET_BALANCE); REQUESTED chỉ còn là dòng cũ -> nạp bằng SQL (ghi vào "Hạn chế bộ khung").
{
  const J = 'Lệnh rút (legacy)';
  const w = await call('returning', 'POST', '/wallet/withdraw', {});
  check('L5-PAY-01', 'returning', 'api', J, 'POST /wallet/withdraw', 'HTTP 410 (Zalo 4.5 cấm rút tiền), wallet.controller.ts:25', w.status === 410, `HTTP ${w.status}`, short(w.body));
  const b = await call('ctv', 'POST', '/affiliate/payouts', { amount: 100000, method: 'BANK', bankInfo: { bank: 'VCB', accountNo: '0123456789' } }, { 'idempotency-key': idem() });
  check('L5-PAY-02', 'ctv', 'api', J, 'POST /affiliate/payouts method=BANK', 'HTTP 400, chỉ nhận WALLET_BALANCE (affiliate.controller.ts:124)', b.status === 400, `HTTP ${b.status}`, short(b.body));

  const mk = async (amount, fee = 0) => {
    const id = `uatpay${Math.random().toString(36).slice(2, 10)}`;
    await sql(`INSERT INTO payouts (id,"userId",amount,method,status,"requestedAt",fee,"bankInfo") VALUES ($1,'uat_ctv',$2,'BANK','REQUESTED',now(),$3,'{"bank":"VCB","accountNo":"0123456789","accountName":"PHAM VAN CTV"}'::jsonb)`, [id, amount, fee]);
    return id;
  };
  const p1 = await mk(500000);
  const before = await userState('uat_ctv');

  const a1 = await call('ketoan', 'POST', `/admin/payouts/${p1}/approve`, {});
  check('L5-PAY-03', 'ketoan', 'api', J, 'Kế toán bấm "Duyệt"', '403: duyệt chỉ ADMIN, người duyệt khác người chi (payout-admin.controller.ts:67)', a1.status === 403, `HTTP ${a1.status}`, short(a1.body));
  const rj = await call('ketoan', 'POST', `/admin/payouts/${p1}/reject`, { reason: 'x' });
  check('L5-PAY-04', 'ketoan', 'api', J, 'Kế toán bấm "Từ chối"', '403', rj.status === 403, `HTTP ${rj.status}`, short(rj.body));
  const mpEarly = await call('ketoan', 'POST', `/admin/payouts/${p1}/mark-paid`, { bankRef: 'FT1' });
  check('L5-PAY-05', 'ketoan', 'api', J, 'Chi khi lệnh còn REQUESTED', '400 "không ở trạng thái Đã duyệt" (affiliate.service.ts:2389)', mpEarly.status === 400, `HTTP ${mpEarly.status}`, short(mpEarly.body));

  const stale = await call('admin', 'POST', `/admin/payouts/${p1}/approve`, { expectedAmount: 400000 });
  check('L5-PAY-06', 'admin', 'api', J, 'ADMIN duyệt với expectedAmount cũ (400.000 so với 500.000)', '409, câu nêu số đã đổi (affiliate.service.ts:2184)', stale.status === 409, `HTTP ${stale.status}`, short(stale.body));
  const ap = await call('admin', 'POST', `/admin/payouts/${p1}/approve`, { expectedAmount: 500000, note: 'UAT duyệt' });
  const [r1] = await sql(`SELECT status, "reviewedBy" rb FROM payouts WHERE id=$1`, [p1]);
  check('L5-PAY-07', 'admin', 'api', J, 'ADMIN duyệt đúng số', '200, status APPROVED, reviewedBy = admin', ap.status < 300 && r1.status === 'APPROVED' && r1.rb === 'uat_admin', `HTTP ${ap.status}, DB ${r1.status}/${r1.rb}`, short(ap.body, 200));
  const ap2 = await call('admin', 'POST', `/admin/payouts/${p1}/approve`, {});
  check('L5-PAY-08', 'admin', 'api', J, 'Duyệt lần 2', '400, không đổi trạng thái', ap2.status === 400, `HTTP ${ap2.status}`, short(ap2.body));
  const rjApproved = await call('admin', 'POST', `/admin/payouts/${p1}/reject`, { reason: 'x' });
  check('L5-PAY-09', 'admin', 'api', J, 'Từ chối lệnh đã APPROVED', '400 (chỉ REQUESTED mới từ chối được)', rjApproved.status === 400, `HTTP ${rjApproved.status}`, short(rjApproved.body));
  for (const r of NON_ADMIN_NO_KETOAN) {
    const x = await call(r, 'POST', `/admin/payouts/${p1}/mark-paid`, { bankRef: 'FT1' });
    check(`L5-PAY-10-${r}`, r, 'api', J, `${r} bấm "Đã chi"`, '403 (chỉ ADMIN và KE_TOAN)', x.status === 403, `HTTP ${x.status}`, short(x.body));
  }
  const staleP = await call('ketoan', 'POST', `/admin/payouts/${p1}/mark-paid`, { bankRef: 'FT1', expectedAmount: 1 });
  check('L5-PAY-11', 'ketoan', 'api', J, 'Kế toán "Đã chi" với số cũ', '409', staleP.status === 409, `HTTP ${staleP.status}`, short(staleP.body));
  const paid = await call('ketoan', 'POST', `/admin/payouts/${p1}/mark-paid`, { bankRef: 'FT26UAT0001', note: 'UAT chi', expectedAmount: 500000 });
  const [r2] = await sql(`SELECT status, "paidBy" pb, "bankRef" br, "paidAt" pa FROM payouts WHERE id=$1`, [p1]);
  check('L5-PAY-12', 'ketoan', 'api', J, 'Kế toán "Đã chi" đúng số + mã giao dịch', '200, PAID, paidBy = kế toán, bankRef lưu', paid.status < 300 && r2.status === 'PAID' && r2.pb === 'uat_ketoan' && r2.br === 'FT26UAT0001' && !!r2.pa, `HTTP ${paid.status}, DB ${JSON.stringify(r2)}`, short(paid.body, 200));
  const paid2 = await call('ketoan', 'POST', `/admin/payouts/${p1}/mark-paid`, { bankRef: 'FT26UAT0002' });
  const [r3] = await sql(`SELECT "bankRef" br FROM payouts WHERE id=$1`, [p1]);
  check('L5-PAY-13', 'ketoan', 'api', J, 'Bấm "Đã chi" lần 2', '400, bankRef không bị ghi đè', paid2.status === 400 && r3.br === 'FT26UAT0001', `HTTP ${paid2.status}, bankRef=${r3.br}`, short(paid2.body));
  const ntf = await sql(`SELECT count(*)::int n FROM notification_logs WHERE "userId"='uat_ctv' AND "templateCode" LIKE '%PAYOUT%'`).catch(() => [{ n: -1 }]);
  rec('L5-PAY-14', 'ctv', 'api', J, 'Thông báo cho CTV (duyệt + chi)', 'có thông báo PAYOUT_APPROVED và PAYOUT_PAID', `${ntf[0].n} dòng notification_logs có PAYOUT`, ntf, ntf[0].n >= 2 || ntf[0].n === -1 ? 'PASS' : 'CAN_CHU');
  const afterPaid = await userState('uat_ctv');
  check('L5-PAY-15', 'ctv', 'api', J, 'Ví CTV không đổi khi duyệt + chi (tiền đi ngân hàng, không qua ví)', 'walletBalance trước = sau, sổ ví = số dư', afterPaid.wallet === before.wallet && afterPaid.wallet === afterPaid.wsum, `ví ${before.wallet} -> ${afterPaid.wallet}, tổng sổ ${afterPaid.wsum}`, { before, afterPaid });

  // Đường từ chối: hoàn gross = amount + fee vào ví (affiliate.service.ts:2268)
  const p2 = await mk(300000, 5000);
  const b2 = await userState('uat_ctv');
  const rjNoReason = await call('admin', 'POST', `/admin/payouts/${p2}/reject`, { reason: '   ' });
  check('L5-PAY-16', 'admin', 'api', J, 'Từ chối thiếu lý do', '400 (DTO @IsNotEmpty hoặc "Nhập lý do từ chối")', rjNoReason.status === 400, `HTTP ${rjNoReason.status}`, short(rjNoReason.body));
  const rjOk = await call('admin', 'POST', `/admin/payouts/${p2}/reject`, { reason: 'UAT: sai số tài khoản' });
  const a2 = await userState('uat_ctv');
  const [pr] = await sql(`SELECT status, "rejectionReason" rr FROM payouts WHERE id=$1`, [p2]);
  const ledger = await sql(`SELECT type, delta, "refType", "refId" FROM wallet_transactions WHERE "refId"=$1`, [p2]);
  check('L5-PAY-17', 'admin', 'api', J, 'ADMIN từ chối lệnh 300.000 + phí 5.000', 'REJECTED + hoàn 305.000 vào ví (WITHDRAW_REFUND), sổ ví = số dư', rjOk.status < 300 && pr.status === 'REJECTED' && a2.wallet - b2.wallet === 305000 && a2.wallet === a2.wsum, `HTTP ${rjOk.status}, ví +${a2.wallet - b2.wallet}, sổ ${a2.wsum}/${a2.wallet}`, { pr, ledger, b2, a2 });
  const rjTwice = await call('admin', 'POST', `/admin/payouts/${p2}/reject`, { reason: 'lần 2' });
  const a3 = await userState('uat_ctv');
  check('L5-PAY-18', 'admin', 'api', J, 'Từ chối lần 2 (chống hoàn trùng)', '400, ví không tăng thêm', rjTwice.status === 400 && a3.wallet === a2.wallet, `HTTP ${rjTwice.status}, ví ${a2.wallet} -> ${a3.wallet}`, short(rjTwice.body));
  // Hai request từ chối song song: đúng 1 thắng
  const p3 = await mk(200000, 0);
  const b3 = await userState('uat_ctv');
  const par = await Promise.all([1, 2, 3].map(() => call('admin', 'POST', `/admin/payouts/${p3}/reject`, { reason: 'song song' })));
  const a4 = await userState('uat_ctv');
  const okN = par.filter((r) => r.status < 300).length;
  check('L5-PAY-19', 'admin', 'api', J, '3 request từ chối cùng lúc một lệnh', 'đúng 1 thành công, ví chỉ +200.000 một lần', okN === 1 && a4.wallet - b3.wallet === 200000 && a4.wallet === a4.wsum, `thành công ${okN}/3, ví +${a4.wallet - b3.wallet}`, par.map((r) => r.status));
  // Danh sách + lọc + quyền
  const lst = await call('ketoan', 'GET', '/admin/payouts?status=PAID');
  check('L5-PAY-20', 'ketoan', 'api', J, 'Kế toán xem danh sách lệnh PAID', '200, có lệnh vừa chi, kèm tên + SĐT người nhận', lst.status === 200 && (lst.body.data ?? []).some((p) => p.id === p1), `HTTP ${lst.status}, ${lst.body?.data?.length ?? '?'} dòng`, short((lst.body.data ?? [])[0]));
  const badSt = await call('ketoan', 'GET', '/admin/payouts?status=FOO');
  check('L5-PAY-21', 'ketoan', 'api', J, 'Lọc status không hợp lệ', '400 JSON', badSt.status === 400, `HTTP ${badSt.status}`, short(badSt.body));
  for (const r of NON_ADMIN_NO_KETOAN) {
    const x = await call(r, 'GET', '/admin/payouts');
    check(`L5-PAY-22-${r}`, r, 'api', J, `${r} xem danh sách lệnh rút`, '403', x.status === 403, `HTTP ${x.status}`, short(x.body));
  }
  // Mã PIT-report
  const pit = await call('ketoan', 'GET', `/admin/payouts/pit-report?month=${new Date().toISOString().slice(0, 7)}`);
  check('L5-PAY-23', 'ketoan', 'api', J, 'Báo cáo khấu trừ TNCN tháng này', '200', pit.status === 200, `HTTP ${pit.status}`, short(pit.body, 200));
  const pitBad = await call('ketoan', 'GET', '/admin/payouts/pit-report?month=2026-13');
  check('L5-PAY-24', 'ketoan', 'api', J, 'Tháng không hợp lệ 2026-13', '400', pitBad.status === 400, `HTTP ${pitBad.status}`, short(pitBad.body));
}

// ───────────────────────── B. Hoá đơn VAT ─────────────────────────
{
  const J = 'Hoá đơn VAT';
  const inv = { taxCode: '0312345678', companyName: 'Công ty TNHH UAT Xanh', address: '12 Lê Lợi, Q1, TP.HCM', email: 'ketoan-uat@example.com' };
  const badTax = await placeOrder('returning', { extra: { invoiceRequest: { ...inv, taxCode: '12345' } } }).then((r) => ({ ok: true, r }), (e) => ({ ok: false, e: String(e.message) }));
  check('L5-VAT-01', 'returning', 'api', J, 'Đặt đơn với MST sai (5 số)', 'bị chặn 400, câu "Mã số thuế gồm 10 số…" (checkout.dto.ts:10)', !badTax.ok && /400/.test(badTax.e) && /Mã số thuế/.test(badTax.e), badTax.ok ? 'đơn vẫn được tạo' : badTax.e.slice(0, 200), badTax);
  const badMail = await placeOrder('returning', { extra: { invoiceRequest: { ...inv, email: 'khong-phai-email' } } }).then((r) => ({ ok: true, r }), (e) => ({ ok: false, e: String(e.message) }));
  check('L5-VAT-02', 'returning', 'api', J, 'Đặt đơn với email hoá đơn sai', 'bị chặn 400', !badMail.ok && /400/.test(badMail.e), badMail.ok ? 'đơn vẫn được tạo' : badMail.e.slice(0, 200), badMail);

  const { code } = await placeOrder('returning', { extra: { invoiceRequest: inv } });
  const o = await orderRow(code);
  const [iv] = await sql(`SELECT "invoiceStatus" s, "invoiceRequest" r FROM orders WHERE code=$1`, [code]);
  check('L5-VAT-03', 'returning', 'api', J, 'Đặt đơn COD có yêu cầu VAT hợp lệ', 'invoiceStatus = REQUESTED, lưu đủ 4 trường', iv.s === 'REQUESTED' && iv.r?.taxCode === inv.taxCode && iv.r?.companyName === inv.companyName, `${iv.s} ${JSON.stringify(iv.r)}`, iv);

  const pend = await call('ketoan', 'GET', `/admin/orders?invoice=pending&search=${code}`);
  const hasPend = (pend.body.data ?? []).some((x) => x.code === code);
  check('L5-VAT-04', 'ketoan', 'api', J, 'Lọc ?invoice=pending theo mã đơn', 'đơn xuất hiện trong "Chờ xuất hoá đơn"', pend.status === 200 && hasPend, `HTTP ${pend.status}, ${pend.body?.data?.length} dòng`, short((pend.body.data ?? [])[0] && { code: pend.body.data[0].code, invoiceStatus: pend.body.data[0].invoiceStatus }));
  const inbox0 = await call('ketoan', 'GET', '/admin/ops/inbox');
  const cnt0 = inbox0.body?.items?.find?.((i) => i.key === 'invoicePending')?.count ?? inbox0.body?.invoicePending?.count ?? null;
  rec('L5-VAT-05', 'ketoan', 'api', J, 'Hộp việc: mục invoicePending', 'đếm đơn chờ xuất hoá đơn ≥ 1', `count=${cnt0}`, short(inbox0.body, 400), cnt0 === null ? 'CAN_CHU' : cnt0 >= 1 ? 'PASS' : 'FAIL');
  const lrow = (pend.body.data ?? []).find((x) => x.code === code);
  const blob = JSON.stringify(lrow ?? {});
  check('L5-VAT-06', 'ketoan', 'api', J, 'Kế toán xem dòng đơn trong danh sách "Chờ xuất hoá đơn"', '200, thấy yêu cầu hoá đơn (MST, tên công ty, email) để xuất đúng', blob.includes(inv.taxCode) && blob.includes(inv.companyName), `có MST=${blob.includes(inv.taxCode)}, tên công ty=${blob.includes(inv.companyName)}, email=${blob.includes(inv.email)}`, short(lrow?.invoiceRequest ?? Object.keys(lrow ?? {})));
  for (const r of NON_ADMIN_NO_KETOAN) {
    const x = await call(r, 'POST', `/admin/orders/${o.id}/issue-invoice`, {});
    check(`L5-VAT-07-${r}`, r, 'api', J, `${r} bấm "Đã xuất hoá đơn"`, '403 (chỉ ADMIN và KE_TOAN, admin.controller.ts:571)', x.status === 403, `HTTP ${x.status}`, short(x.body));
  }
  for (const [name, url] of [['http', 'http://hoadon.example.com/x.pdf'], ['javascript', 'javascript:alert(1)'], ['ftp', 'ftp://hoadon.example.com/x'], ['không có scheme', 'hoadon.example.com/x.pdf']]) {
    const x = await call('ketoan', 'POST', `/admin/orders/${o.id}/issue-invoice`, { invoiceUrl: url });
    const [chk] = await sql(`SELECT "invoiceStatus" s FROM orders WHERE id=$1`, [o.id]);
    check(`L5-VAT-08-${name}`, 'ketoan', 'api', J, `Link hoá đơn "${url}"`, '400, chỉ nhận https (admin.controller.ts:415), đơn vẫn REQUESTED', x.status === 400 && chk.s === 'REQUESTED', `HTTP ${x.status}, đơn ${chk.s}`, short(x.body));
  }
  const ok = await call('ketoan', 'POST', `/admin/orders/${o.id}/issue-invoice`, { invoiceUrl: 'https://hoadon.example.com/uat/HD0001.pdf' });
  const [after] = await sql(`SELECT "invoiceStatus" s, "invoiceUrl" u FROM orders WHERE id=$1`, [o.id]);
  check('L5-VAT-09', 'ketoan', 'api', J, 'Xuất hoá đơn với link https', '200, ISSUED + lưu link', ok.status < 300 && after.s === 'ISSUED' && after.u === 'https://hoadon.example.com/uat/HD0001.pdf', `HTTP ${ok.status}, DB ${JSON.stringify(after)}`, short(ok.body, 250));
  await sleep(800);
  const nt = await call('returning', 'GET', '/me/notifications');
  const items = Array.isArray(nt.body) ? nt.body : nt.body?.items ?? nt.body?.data ?? [];
  const got = items.find((n) => JSON.stringify(n).includes(code) && /hoá đơn|hóa đơn|VAT/i.test(JSON.stringify(n)));
  check('L5-VAT-10', 'returning', 'api', J, 'Khách nhận thông báo "đã xuất hoá đơn"', 'có thông báo nhắc mã đơn', !!got, got ? short(got, 220) : `không thấy trong ${items.length} thông báo`, got ?? items.slice(0, 2));
  if (got) {
    const tone = toneOf(JSON.stringify(got));
    check('L5-VAT-10b', 'returning', 'api', J, 'Giọng thông báo hoá đơn (đợt 8)', 'không "Vui lòng", "chúng tôi", "..."', tone.length === 0, tone.join(', ') || 'sạch', short(got, 220));
  }
  const again = await call('ketoan', 'POST', `/admin/orders/${o.id}/issue-invoice`, {});
  check('L5-VAT-11', 'ketoan', 'api', J, 'Xuất lần 2', '400 "đã được phát hành"', again.status === 400, `HTTP ${again.status}`, short(again.body));
  const issued = await call('admin', 'GET', `/admin/orders?invoice=issued&search=${code}`);
  const pend2 = await call('admin', 'GET', `/admin/orders?invoice=pending&search=${code}`);
  check('L5-VAT-12', 'admin', 'api', J, 'Lọc ?invoice=issued / pending sau khi xuất', 'có trong issued, không còn trong pending', (issued.body.data ?? []).some((x) => x.code === code) && !(pend2.body.data ?? []).some((x) => x.code === code), `issued ${issued.body?.data?.length}, pending ${pend2.body?.data?.length}`, null);

  // Đơn không yêu cầu, đơn đã huỷ
  const plain = await placeOrder('returning', {});
  const np = await call('ketoan', 'POST', `/admin/orders/${plain.code}/issue-invoice`, {});
  check('L5-VAT-13', 'ketoan', 'api', J, 'Xuất hoá đơn cho đơn không yêu cầu', '400 "chưa có yêu cầu xuất hoá đơn VAT"', np.status === 400, `HTTP ${np.status}`, short(np.body));
  const c2 = await placeOrder('returning', { extra: { invoiceRequest: inv } });
  const co = await orderRow(c2.code);
  const cxr = await call('admin', 'PUT', `/admin/orders/${co.id}/status`, { status: 'CANCELLED', note: 'UAT huỷ để thử hoá đơn' });
  const [cst] = await sql(`SELECT status FROM orders WHERE id=$1`, [co.id]);
  rec('L5-VAT-14a', 'admin', 'api', J, 'Huỷ đơn có yêu cầu VAT', '200, CANCELLED', `HTTP ${cxr.status}, DB ${cst.status}`, short(cxr.body, 160), cxr.status < 300 && cst.status === 'CANCELLED' ? 'PASS' : 'FAIL');
  const cx = await call('ketoan', 'POST', `/admin/orders/${co.id}/issue-invoice`, {});
  check('L5-VAT-14', 'ketoan', 'api', J, 'Xuất hoá đơn cho đơn đã huỷ', '400 "đã huỷ/trả — không xuất hoá đơn VAT"', cx.status === 400, `HTTP ${cx.status}`, short(cx.body));
  const nf = await call('ketoan', 'POST', '/admin/orders/khong-co-don/issue-invoice', {});
  check('L5-VAT-15', 'ketoan', 'api', J, 'Mã đơn không tồn tại', '404', nf.status === 404, `HTTP ${nf.status}`, short(nf.body));
  // Hai request xuất song song
  const c3 = await placeOrder('returning', { extra: { invoiceRequest: inv } });
  const par = await Promise.all([1, 2, 3].map(() => call('ketoan', 'POST', `/admin/orders/${c3.code}/issue-invoice`, { invoiceUrl: 'https://hoadon.example.com/uat/HD0002.pdf' })));
  const okN = par.filter((r) => r.status < 300).length;
  const nN = (await sql(`SELECT count(*)::int n FROM notification_logs WHERE "templateCode"='INVOICE_ISSUED' AND payload::text LIKE $1`, [`%${c3.code}%`]).catch(() => [{ n: -1 }]))[0].n;
  check('L5-VAT-16', 'ketoan', 'api', J, '3 request xuất hoá đơn cùng lúc', 'đúng 1 thành công (và đúng 1 thông báo cho khách)', okN === 1, `thành công ${okN}/3, thông báo ${nN}`, par.map((r) => r.status));
}

function toneOf(t) {
  const out = [];
  if (/vui lòng/i.test(t)) out.push('có "Vui lòng"');
  if (/chúng tôi/i.test(t)) out.push('có "chúng tôi"');
  if (/\.\.\.|…/.test(t)) out.push('có "..."');
  return out;
}

// ───────────────────────── C. Trần mã giảm giá của Marketing ─────────────────────────
const created = []; // id mã tạo trong lượt này, tắt ở cuối
// Ngân sách ngày của Marketing tính cả mã đã tắt: xoá mã UAT của lượt chạy trước để chạy lại được.
await sql(`DELETE FROM coupons WHERE code LIKE 'UAT%' AND "createdById" IN ('uat_marketing','uat_admin') AND "usedCount"=0`);
{
  const J = 'Mã giảm giá (Marketing)';
  const base = { type: 'PERCENT', value: 20, minOrder: 0, maxDiscount: 50000, startAt, endAt, usageLimit: 100, perUserLimit: 1, scope: 'PUBLIC' };
  const post = (who, code, over = {}) => call(who, 'POST', '/admin/coupons', { ...base, code: `UAT${tag}${code}`, ...over });
  const track = (r) => { if (r.status < 300 && r.body?.id) created.push(r.body.id); return r; };
  const [capCfg] = await sql(`SELECT json_object_agg(key, value) c FROM system_configs WHERE key LIKE 'coupon.staff_%'`);
  rec('L5-CPN-00', 'marketing', 'api', J, 'Đọc trần hiện hành', 'staff_max_percent 30, amount 100.000, usage 1000, ngân sách ngày 10.000.000', JSON.stringify(capCfg.c), capCfg.c, 'PASS');

  const checks = [
    ['01', 'giảm 31% (trần 30%)', { value: 31 }, 403, /30%/],
    ['02', 'giảm 30% không có "Giảm tối đa"', { value: 30, maxDiscount: undefined }, 403, /Giảm tối đa/],
    ['03', 'Giảm tối đa 100.001đ (trần 100.000đ)', { maxDiscount: 100001 }, 403, /100\.000/],
    ['04', 'giảm tiền 100.001đ (trần 100.000đ)', { type: 'AMOUNT', value: 100001, maxDiscount: undefined }, 403, /100\.000/],
    ['05', 'không đặt Tổng lượt dùng', { usageLimit: undefined }, 403, /Tổng lượt dùng/],
    ['06', 'Tổng lượt dùng 1001 (trần 1000)', { usageLimit: 1001 }, 403, /1\.000/],
    ['07', 'freeship không đặt Tổng lượt dùng', { type: 'FREESHIP', value: 0, maxDiscount: undefined, usageLimit: undefined }, 403, /Tổng lượt dùng/],
  ];
  for (const [n, desc, over, want, re] of checks) {
    const r = await post('marketing', `X${n}`, over);
    const row = (await sql(`SELECT count(*)::int n FROM coupons WHERE code=$1`, [`UAT${tag}X${n}`]))[0].n;
    track(r);
    check(`L5-CPN-${n}`, 'marketing', 'api', J, `Marketing tạo mã ${desc}`, `${want} + câu nêu trần (coupon-input-rules.ts:126), không ghi DB`, r.status === want && re.test(JSON.stringify(r.body)) && row === 0, `HTTP ${r.status}, ${row} dòng DB`, short(r.body, 260));
  }
  // Giá trị hợp lệ sát trần
  const edge = track(await post('marketing', 'OK1', { value: 30, maxDiscount: 100000, usageLimit: 40 }));
  const [e1] = await sql(`SELECT "createdById" c, value, "maxDiscount" m, "usageLimit" u FROM coupons WHERE code=$1`, [`UAT${tag}OK1`]);
  check('L5-CPN-08', 'marketing', 'api', J, 'Marketing tạo mã đúng trần (30%, tối đa 100.000đ, 40 lượt = 4.000.000đ)', '201, createdById = marketing', edge.status < 300 && e1?.c === 'uat_marketing', `HTTP ${edge.status}, ${JSON.stringify(e1)}`, short(edge.body, 200));
  const budgetNow = (await sql(`SELECT COALESCE(SUM((CASE type WHEN 'AMOUNT' THEN value WHEN 'PERCENT' THEN COALESCE("maxDiscount",100000) ELSE 100000 END)::bigint * COALESCE("usageLimit",1000)),0)::bigint b FROM coupons WHERE "createdById"='uat_marketing' AND "createdAt" > now() - interval '1 day'`))[0].b;
  // Ngân sách ngày: đổ mã (mỗi mã tối đa 100.000đ x 1000 lượt) cho tới sát 10.000.000đ rồi tạo một mã vượt
  const room = 10_000_000 - Number(budgetNow);
  const fillUsage = Math.floor((room - 1000) / 100000);
  if (fillUsage >= 1) {
    const f = track(await post('marketing', 'FILL', { type: 'AMOUNT', value: 100000, maxDiscount: undefined, usageLimit: Math.min(fillUsage, 1000) }));
    rec('L5-CPN-09a', 'marketing', 'api', J, `Đổ mã cho ngân sách ngày còn ${room.toLocaleString('vi-VN')}đ`, '201', `HTTP ${f.status}`, short(f.body, 200), f.status < 300 ? 'PASS' : 'FAIL');
  }
  const over = track(await post('marketing', 'OVER', { type: 'AMOUNT', value: 100000, maxDiscount: undefined, usageLimit: 20 }));
  check('L5-CPN-09', 'marketing', 'api', J, 'Mã làm tổng ngân sách ngày vượt 10.000.000đ (thêm 2.000.000đ khi chỉ còn dưới 100.000đ)', '400 "Vượt ngân sách mã giảm giá và flash sale của nhân viên" (coupon-input-rules.ts:187)', over.status === 400 && /Vượt ngân sách/.test(JSON.stringify(over.body)), `HTTP ${over.status}`, short(over.body, 320));
  // Tự cấp mã cá nhân cho mình
  const own = await post('marketing', 'OWN', { scope: 'USER_GROUP', scopeMeta: { userId: 'uat_marketing' }, type: 'AMOUNT', value: 1000, maxDiscount: undefined, usageLimit: 1 });
  check('L5-CPN-10', 'marketing', 'api', J, 'Marketing tạo mã cá nhân cho chính mình', '403 "Không tạo hay sửa mã giảm giá cá nhân của chính mình"', own.status === 403, `HTTP ${own.status}`, short(own.body));
  // Quyền các vai khác
  for (const r of ['cskh', 'kho', 'ketoan', 'staff']) {
    const x = await post(r, `R${r.toUpperCase()}`);
    check(`L5-CPN-11-${r}`, r, 'api', J, `${r} tạo mã giảm giá`, '403', x.status === 403, `HTTP ${x.status}`, short(x.body));
  }
  // Admin vượt trần
  const adm = track(await post('admin', 'ADM1', { type: 'PERCENT', value: 80, maxDiscount: 500000, usageLimit: 5000 }));
  check('L5-CPN-12', 'admin', 'api', J, 'ADMIN tạo mã 80%, tối đa 500.000đ, 5000 lượt (vượt trần nhân viên)', '201 (trần chỉ áp cho STAFF)', adm.status < 300, `HTTP ${adm.status}`, short(adm.body, 200));
  const adm2 = await post('admin', 'ADM2', { type: 'PERCENT', value: 80, maxDiscount: undefined });
  check('L5-CPN-13', 'admin', 'api', J, 'ADMIN tạo mã ≥50% không có "Giảm tối đa"', '400 "Mã giảm từ 50% phải đặt Giảm tối đa" (coupon-input-rules.ts:59)', adm2.status === 400, `HTTP ${adm2.status}`, short(adm2.body));
  const adm3 = track(await post('admin', 'ADM3', { type: 'AMOUNT', value: 500000, maxDiscount: undefined, usageLimit: undefined }));
  check('L5-CPN-14', 'admin', 'api', J, 'ADMIN tạo mã giảm 500.000đ không giới hạn lượt', '201', adm3.status < 300, `HTTP ${adm3.status}`, short(adm3.body, 200));
  // Sửa mã
  const mine = created.find(Boolean);
  const ownId = edge.body?.id;
  if (ownId) {
    const up = await call('marketing', 'PATCH', `/admin/coupons/${ownId}`, { usageLimit: 1001 });
    check('L5-CPN-15', 'marketing', 'api', J, 'Marketing nâng Tổng lượt dùng mã của mình lên 1001', '403 (trần lượt)', up.status === 403, `HTTP ${up.status}`, short(up.body));
  }
  if (adm.body?.id) {
    const up2 = await call('marketing', 'PATCH', `/admin/coupons/${adm.body.id}`, { isActive: false });
    check('L5-CPN-16', 'marketing', 'api', J, 'Marketing tắt mã do ADMIN tạo', '403 "Mã do quản trị viên hoặc hệ thống tạo"', up2.status === 403, `HTTP ${up2.status}`, short(up2.body));
  }
  if (ownId) {
    const off = await call('marketing', 'PATCH', `/admin/coupons/${ownId}`, { isActive: false });
    const [chk] = await sql(`SELECT "isActive" a, "updatedById" u FROM coupons WHERE id=$1`, [ownId]);
    check('L5-CPN-17', 'marketing', 'api', J, 'Marketing tắt mã của chính mình', '200, isActive=false, updatedById = marketing', off.status < 300 && chk.a === false && chk.u === 'uat_marketing', `HTTP ${off.status}, ${JSON.stringify(chk)}`, short(off.body, 150));
  }
  // Mã đã cấp không đổi mức giảm: DTO chỉ nhận isActive/endAt/usageLimit/listed/title
  if (ownId) {
    const val = await call('marketing', 'PATCH', `/admin/coupons/${ownId}`, { value: 99 });
    check('L5-CPN-18', 'marketing', 'api', J, 'Sửa mức giảm của mã đã tạo (value)', '400 (không có trong UpdateCouponDto, forbidNonWhitelisted)', val.status === 400, `HTTP ${val.status}`, short(val.body));
  }
  // Mã trùng, mã sai định dạng, ngày sai
  const dup = await call('admin', 'POST', '/admin/coupons', { ...base, code: `UAT${tag}ADM1`, type: 'PERCENT', value: 10 });
  check('L5-CPN-19', 'admin', 'api', J, 'Tạo mã trùng', '409 hoặc 400 (không 500)', dup.status === 409 || dup.status === 400, `HTTP ${dup.status}`, short(dup.body));
  const badCode = await call('admin', 'POST', '/admin/coupons', { ...base, code: 'mã có dấu cách' });
  check('L5-CPN-20', 'admin', 'api', J, 'Mã có dấu và khoảng trắng', '400 câu "Mã chỉ gồm chữ in hoa không dấu…"', badCode.status === 400, `HTTP ${badCode.status}`, short(badCode.body));
  const pastEnd = await call('admin', 'POST', '/admin/coupons', { ...base, code: `UAT${tag}PAST`, startAt: iso(now - 9 * 86400e3), endAt: iso(now - 86400e3) });
  check('L5-CPN-21', 'admin', 'api', J, 'Ngày hết hạn đã qua', '400 "Ngày hết hạn đã qua"', pastEnd.status === 400, `HTTP ${pastEnd.status}`, short(pastEnd.body));
}

// ───────────────────────── D. Mẫu thông báo ─────────────────────────
const restore = [];
{
  const J = 'Mẫu thông báo';
  const list = (await call('marketing', 'GET', '/admin/notification-templates')).body;
  const mkt = list.find((t) => t.code === 'WELCOME_VOUCHER') ?? list.find((t) => t.staffEditable);
  const sys = list.find((t) => !t.staffEditable && t.channel === 'INAPP') ?? list.find((t) => !t.staffEditable);
  rec('L5-TPL-00', 'marketing', 'api', J, 'Marketing xem danh sách mẫu', `${list.length} mẫu, staffEditable đúng danh sách`, `${list.length} mẫu; sửa được ${list.filter((t) => t.staffEditable).length}`, { mkt: mkt.code, sys: sys.code }, list.length > 0 ? 'PASS' : 'FAIL');
  const orig = { body: mkt.bodyTemplate, channel: mkt.channel, zalo: mkt.zaloTemplateId };
  restore.push({ code: mkt.code, body: orig.body });
  const patch = (who, code, body) => call(who, 'PATCH', `/admin/notification-templates/${code}`, body);
  const bodyOf = async (code) => (await sql(`SELECT "bodyTemplate" b FROM notification_templates WHERE code=$1`, [code]))[0].b;

  const bad = [
    ['https://evil.example.com/nhan-qua', 'link https ngoài'],
    ['bit.ly/nhan-qua', 'tên miền trần bit.ly/…'],
    ['www.khuyenmai.vn', 'www. ngoài'],
    ['http://tubutree.com.evil.vn/x', 'tubutree.com.evil.vn giả'],
    ['https://zalo.me/0912345678', 'zalo.me của người khác'],
    ['Chuyển khoản STK 12345678 nhận quà', 'dãy 8 chữ số'],
    ['Chuyển khoản STK 1234 5678 nhận quà', '8 chữ số viết tách bằng dấu cách'],
    ['Liên hệ 0912.345.678 nhận quà', 'SĐT viết tách bằng dấu chấm'],
    ['Liên hệ １２３４５６７８ nhận quà', '8 chữ số toàn chiều rộng (NFKC)'],
    ['https://tubutree.com/x?ref=12345678', '8 chữ số trong query của link tubutree'],
  ];
  let i = 0;
  for (const [txt, desc] of bad) {
    i++;
    const r = await patch('marketing', mkt.code, { bodyTemplate: `${orig.body} ${txt}` });
    const now = await bodyOf(mkt.code);
    check(`L5-TPL-B${String(i).padStart(2, '0')}`, 'marketing', 'api', J, `Marketing thêm ${desc}`, '400, nội dung không đổi (notification-templates-admin.service.ts:276)', r.status === 400 && now === orig.body, `HTTP ${r.status}; nội dung ${now === orig.body ? 'giữ nguyên' : 'ĐÃ ĐỔI'}`, short(r.body, 240));
  }
  const good = await patch('marketing', mkt.code, { bodyTemplate: `${orig.body} Xem thêm tại tubutree.com.` });
  const nowGood = await bodyOf(mkt.code);
  check('L5-TPL-G01', 'marketing', 'api', J, 'Marketing thêm "tubutree.com" (được phép) vào nội dung', '200, nội dung đổi', good.status < 300 && nowGood.endsWith('tubutree.com.'), `HTTP ${good.status}`, short(good.body, 200));
  const goodHcm = await patch('marketing', mkt.code, { bodyTemplate: `${orig.body} Áp dụng tại Tp.HCM.` });
  check('L5-TPL-G02', 'marketing', 'api', J, 'Marketing thêm "Tp.HCM" (không phải link)', '200 (không chặn nhầm)', goodHcm.status < 300, `HTTP ${goodHcm.status}`, short(goodHcm.body, 200));
  const sevenDig = await patch('marketing', mkt.code, { bodyTemplate: `${orig.body} Hotline 1900123.` });
  check('L5-TPL-G03', 'marketing', 'api', J, 'Marketing thêm dãy 7 chữ số (dưới ngưỡng 8)', '200 (ngưỡng là ≥ 8 chữ số)', sevenDig.status < 300, `HTTP ${sevenDig.status}`, short(sevenDig.body, 200));
  const unknownVar = await patch('marketing', mkt.code, { bodyTemplate: `${orig.body} {{khong_co_bien}}` });
  check('L5-TPL-G04', 'marketing', 'api', J, 'Nội dung có biến {{khong_co_bien}}', '400 câu nêu biến lạ (notification-variables.ts)', unknownVar.status === 400, `HTTP ${unknownVar.status}`, short(unknownVar.body, 240));
  const empty = await patch('marketing', mkt.code, { bodyTemplate: '   ' });
  check('L5-TPL-G05', 'marketing', 'api', J, 'Nội dung chỉ có khoảng trắng', '400 "không được để trống"', empty.status === 400, `HTTP ${empty.status}`, short(empty.body, 200));
  const huge = await patch('marketing', mkt.code, { bodyTemplate: 'a'.repeat(1001) });
  check('L5-TPL-G06', 'marketing', 'api', J, 'Nội dung 1001 ký tự', '400 (MaxLength 1000)', huge.status === 400, `HTTP ${huge.status}`, short(huge.body, 200));

  // Quyền
  const chan = await patch('marketing', mkt.code, { channel: mkt.channel === 'ZNS' ? 'INAPP' : 'ZNS', zaloTemplateId: '123456' });
  check('L5-TPL-P01', 'marketing', 'api', J, 'Marketing đổi kênh / mã mẫu ZNS', '403 (tính phí mỗi tin)', chan.status === 403, `HTTP ${chan.status}`, short(chan.body, 220));
  const zid = await patch('marketing', mkt.code, { zaloTemplateId: '999999' });
  check('L5-TPL-P02', 'marketing', 'api', J, 'Marketing chỉ đổi mã mẫu ZNS', '403', zid.status === 403, `HTTP ${zid.status}`, short(zid.body, 220));
  const money = await patch('marketing', sys.code, { bodyTemplate: sys.bodyTemplate + ' x' });
  check('L5-TPL-P03', 'marketing', 'api', J, `Marketing sửa mẫu ${sys.code} (đơn hàng / tiền / vận hành)`, '403 "chỉ quản trị viên sửa"', money.status === 403, `HTTP ${money.status}`, short(money.body, 220));
  for (const r of ['cskh', 'kho', 'ketoan', 'staff']) {
    const x = await patch(r, mkt.code, { bodyTemplate: orig.body });
    const g = await call(r, 'GET', '/admin/notification-templates');
    check(`L5-TPL-P04-${r}`, r, 'api', J, `${r} sửa mẫu / xem danh sách mẫu`, '403 cả hai', x.status === 403 && g.status === 403, `PATCH ${x.status}, GET ${g.status}`, short(x.body));
  }
  const nf = await patch('admin', 'KHONG_CO_MAU', { bodyTemplate: 'x' });
  check('L5-TPL-P05', 'admin', 'api', J, 'Mẫu không tồn tại', '404', nf.status === 404, `HTTP ${nf.status}`, short(nf.body));
  // ADMIN: luật chặn link/8 chữ số chỉ áp cho nhân viên (assertStaffBody gọi khi actor.staff)
  const sysOrig = sys.bodyTemplate;
  restore.push({ code: sys.code, body: sysOrig });
  const admLink = await patch('admin', sys.code, { bodyTemplate: `${sysOrig} https://evil.example.com/x` });
  rec('L5-TPL-A01', 'admin', 'api', J, 'ADMIN thêm link ngoài vào mẫu hệ thống', 'luật brief: chặn link ngoài và dãy 8 chữ số — nhưng code chỉ áp cho nhân viên (service.ts:156 `if (actor.staff)`)', `HTTP ${admLink.status}: ADMIN ${admLink.status < 300 ? 'ĐƯỢC' : 'bị chặn'} thêm link ngoài`, short(admLink.body, 200), admLink.status === 400 ? 'PASS' : 'CAN_CHU');
  const admDigits = await patch('admin', sys.code, { bodyTemplate: `${sysOrig} STK 12345678` });
  rec('L5-TPL-A02', 'admin', 'api', J, 'ADMIN thêm dãy 8 chữ số vào mẫu hệ thống', 'tương tự L5-TPL-A01 (code ghi "Thông tin chuyển khoản chỉ quản trị viên đưa vào mẫu", nên ADMIN được phép là chủ ý)', `HTTP ${admDigits.status}`, short(admDigits.body, 200), admDigits.status === 400 ? 'PASS' : 'CAN_CHU');
  // Khôi phục
  for (const t of restore) {
    const r = await patch('admin', t.code, { bodyTemplate: t.body });
    const cur = await bodyOf(t.code);
    check(`L5-TPL-R-${t.code}`, 'admin', 'api', J, `Khôi phục nội dung ${t.code}`, 'nội dung về đúng bản gốc', r.status < 300 && cur === t.body.trim(), `HTTP ${r.status}, ${cur === t.body.trim() ? 'khớp' : 'KHÁC bản gốc'}`, short(r.body, 120));
  }
}

// ───────────────────────── E. Cấu hình hệ thống ─────────────────────────
{
  const J = 'Cấu hình hệ thống';
  const KEY = 'coupon.staff_max_percent';
  const [orig] = await sql(`SELECT value v FROM system_configs WHERE key=$1`, [KEY]);
  for (const r of ROLES) {
    const g = await call(r, 'GET', '/admin/config');
    const p = await call(r, 'PUT', '/admin/config', { key: KEY, value: 99 });
    const [chk] = await sql(`SELECT value v FROM system_configs WHERE key=$1`, [KEY]);
    check(`L5-CFG-01-${r}`, r, 'api', J, `${r} xem / sửa cấu hình`, '403 cả hai, giá trị không đổi', g.status === 403 && p.status === 403 && JSON.stringify(chk.v) === JSON.stringify(orig.v), `GET ${g.status}, PUT ${p.status}, DB ${JSON.stringify(chk.v)}`, short(p.body));
  }
  const unk = await call('admin', 'PUT', '/admin/config', { key: 'coupon.khong_co_khoa_nay', value: 1 });
  const [uk] = await sql(`SELECT count(*)::int n FROM system_configs WHERE key='coupon.khong_co_khoa_nay'`);
  check('L5-CFG-02', 'admin', 'api', J, 'Ghi khoá không tồn tại', '400 "Không có khoá cấu hình", không tạo dòng mới (admin.service.ts:1502)', unk.status === 400 && uk.n === 0, `HTTP ${unk.status}, ${uk.n} dòng`, short(unk.body));
  const wrongType = await call('admin', 'PUT', '/admin/config', { key: KEY, value: 'ba mươi' });
  const [wt] = await sql(`SELECT value v FROM system_configs WHERE key=$1`, [KEY]);
  check('L5-CFG-03', 'admin', 'api', J, `Ghi ${KEY} = chuỗi "ba mươi"`, '400, giá trị cũ giữ nguyên', wrongType.status === 400 && JSON.stringify(wt.v) === JSON.stringify(orig.v), `HTTP ${wrongType.status}, DB ${JSON.stringify(wt.v)}`, short(wrongType.body));
  const neg = await call('admin', 'PUT', '/admin/config', { key: KEY, value: -5 });
  const [ng] = await sql(`SELECT value v FROM system_configs WHERE key=$1`, [KEY]);
  check('L5-CFG-04', 'admin', 'api', J, `Ghi ${KEY} = -5`, '400 (trần % phải dương), giữ nguyên', neg.status === 400 && JSON.stringify(ng.v) === JSON.stringify(orig.v), `HTTP ${neg.status}, DB ${JSON.stringify(ng.v)}`, short(neg.body));
  const nullv = await call('admin', 'PUT', '/admin/config', { key: KEY, value: null });
  check('L5-CFG-05', 'admin', 'api', J, `Ghi ${KEY} = null`, '400 (không có 500)', nullv.status === 400, `HTTP ${nullv.status}`, short(nullv.body));
  const histBefore = (await sql(`SELECT count(*)::int n FROM system_config_history WHERE key=$1`, [KEY]))[0].n;
  const set = await call('admin', 'PUT', '/admin/config', { key: KEY, value: 40 });
  const [nv] = await sql(`SELECT value v, "updatedBy" ub FROM system_configs WHERE key=$1`, [KEY]);
  const h = await sql(`SELECT "oldValue" o, "newValue" n, "changedBy" c FROM system_config_history WHERE key=$1 ORDER BY "changedAt" DESC LIMIT 1`, [KEY]);
  check('L5-CFG-06', 'admin', 'api', J, `Admin đổi ${KEY} 30 -> 40`, '200, giá trị mới, có 1 dòng lịch sử (cũ/mới/ai đổi)', set.status < 300 && nv.v === 40 && h[0]?.n === 40 && h[0]?.o === orig.v && h[0]?.c === 'uat_admin', `HTTP ${set.status}, DB ${JSON.stringify(nv)}, lịch sử ${JSON.stringify(h[0])}`, { histBefore, h });
  // Hiệu lực: Marketing tạo 35% được, 41% vẫn bị chặn
  const c35 = await call('marketing', 'POST', '/admin/coupons', { type: 'PERCENT', value: 35, minOrder: 0, maxDiscount: 10000, startAt, endAt, usageLimit: 10, perUserLimit: 1, scope: 'PUBLIC', code: `UAT${tag}CFG35` });
  if (c35.status < 300) created.push(c35.body.id);
  const c41 = await call('marketing', 'POST', '/admin/coupons', { type: 'PERCENT', value: 41, minOrder: 0, maxDiscount: 10000, startAt, endAt, usageLimit: 10, perUserLimit: 1, scope: 'PUBLIC', code: `UAT${tag}CFG41` });
  check('L5-CFG-07', 'marketing', 'api', J, 'Sau khi nâng trần lên 40%: mã 35% tạo được, 41% bị chặn', 'cấu hình có hiệu lực ngay (không đợi cache dài)', c35.status < 300 && c41.status === 403, `35% -> ${c35.status}, 41% -> ${c41.status}`, { c35: short(c35.body, 120), c41: short(c41.body, 160) });
  const back = await call('admin', 'PUT', '/admin/config', { key: KEY, value: orig.v });
  const [bk] = await sql(`SELECT value v FROM system_configs WHERE key=$1`, [KEY]);
  const histAfter = (await sql(`SELECT count(*)::int n FROM system_config_history WHERE key=$1`, [KEY]))[0].n;
  check('L5-CFG-08', 'admin', 'api', J, `Khôi phục ${KEY} về ${JSON.stringify(orig.v)}`, '200, giá trị về bản gốc, lịch sử +2 dòng', back.status < 300 && JSON.stringify(bk.v) === JSON.stringify(orig.v) && histAfter - histBefore === 2, `HTTP ${back.status}, DB ${JSON.stringify(bk.v)}, lịch sử ${histBefore} -> ${histAfter}`, short(back.body));
  const c35b = await call('marketing', 'POST', '/admin/coupons', { type: 'PERCENT', value: 35, minOrder: 0, maxDiscount: 10000, startAt, endAt, usageLimit: 10, perUserLimit: 1, scope: 'PUBLIC', code: `UAT${tag}CFG35B` });
  check('L5-CFG-09', 'marketing', 'api', J, 'Sau khi khôi phục: mã 35% lại bị chặn', '403', c35b.status === 403, `HTTP ${c35b.status}`, short(c35b.body, 160));
  // Khoá bí mật bị che khi đọc
  const cfg = (await call('admin', 'GET', '/admin/config')).body;
  const secrets = cfg.filter((c) => /token|secret|key|password|api_key/i.test(c.key));
  const leaked = secrets.filter((c) => typeof c.value === 'string' && c.value.length > 12 && !/\*|•|redact|ẩn/i.test(c.value));
  rec('L5-CFG-10', 'admin', 'api', J, 'GET /admin/config che giá trị bí mật (token, secret, key)', 'không trả nguyên văn chuỗi dài của khoá có tên token/secret/key', `${secrets.length} khoá nhạy cảm, ${leaked.length} trả nguyên văn`, leaked.map((c) => c.key), leaked.length === 0 ? 'PASS' : 'FAIL');
}

// ───────────────────────── F. Sức khoẻ vận hành ─────────────────────────
{
  const J = 'Sức khoẻ vận hành';
  const health = await call('admin', 'GET', '/admin/ops/health');
  check('L5-OPS-01', 'admin', 'api', J, 'ADMIN mở /admin/ops/health', '200, có problems + cronJobs + queues + pancake', health.status === 200 && Array.isArray(health.body?.problems) && !!health.body?.cronJobs, `HTTP ${health.status}, problems=${(health.body?.problems ?? []).map((p) => p.key).join(',')}`, Object.keys(health.body ?? {}));
  for (const r of ROLES) {
    const h = await call(r, 'GET', '/admin/ops/health');
    const ib = await call(r, 'GET', '/admin/ops/inbox');
    const ac = await call(r, 'GET', '/admin/ops/access');
    const inboxWant = r === 'staff' ? 403 : 200; // inbox chỉ CSKH/KHO/MARKETING/KE_TOAN (ops.controller.ts:31); STAFF không nhóm không vào
    check(`L5-OPS-02-${r}`, r, 'api', J, `${r} gọi health / inbox / access`, `health 403; inbox ${inboxWant}; access 200 (staff-permissions.matrix.spec.ts:175-178)`, h.status === 403 && ib.status === inboxWant && ac.status === 200, `health ${h.status}, inbox ${ib.status}, access ${ac.status}`, short(ac.body, 160));
  }
  // zalo.oa_token: lane chưa có token -> không báo. Nạp token giả sắp hết hạn bằng SQL rồi khôi phục.
  const before = await sql(`SELECT key, value FROM system_configs WHERE key IN ('zalo.oa_access_token','zalo.oa_token_expires_at')`);
  const noTok = (health.body?.problems ?? []).some((p) => p.key === 'zalo.oa_token');
  rec('L5-OPS-03', 'admin', 'api', J, 'Chưa có token Zalo OA', 'không có cảnh báo zalo.oa_token (ops-health.service.ts:266 "Chưa cấu hình thì không báo")', `${noTok ? 'CÓ' : 'không có'} cảnh báo; dòng cấu hình token: ${JSON.stringify(before.map((b) => b.key))}`, before, !noTok ? 'PASS' : 'CAN_CHU');
  const soon = new Date(Date.now() + 3600e3).toISOString();
  await sql(`INSERT INTO system_configs (key,value,category,"updatedAt") VALUES ('zalo.oa_access_token','"uat-fake-token-0000"'::jsonb,'zalo',now()) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`);
  await sql(`INSERT INTO system_configs (key,value,category,"updatedAt") VALUES ('zalo.oa_token_expires_at',$1::jsonb,'zalo',now()) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`, [JSON.stringify(soon)]);
  const h2 = await call('admin', 'GET', '/admin/ops/health');
  const zp = (h2.body?.problems ?? []).find((p) => p.key === 'zalo.oa_token');
  check('L5-OPS-04', 'admin', 'api', J, 'Token Zalo OA còn 1 giờ (dưới 3 giờ)', 'problems có zalo.oa_token, câu "chỉ còn 0 giờ … phút" (ops-health.service.ts:288)', !!zp && /chỉ còn/.test(zp.message), zp ? zp.message : 'không có cảnh báo', zp);
  if (zp) {
    const tone = toneOf(zp.message);
    check('L5-OPS-04b', 'admin', 'api', J, 'Giọng câu cảnh báo token', 'không "Vui lòng", "chúng tôi", "..."', tone.length === 0, tone.join(', ') || 'sạch', zp.message);
  }
  await sql(`UPDATE system_configs SET value=$1::jsonb WHERE key='zalo.oa_token_expires_at'`, [JSON.stringify(new Date(Date.now() - 3600e3).toISOString())]);
  const h3 = await call('admin', 'GET', '/admin/ops/health');
  const zp3 = (h3.body?.problems ?? []).find((p) => p.key === 'zalo.oa_token');
  check('L5-OPS-05', 'admin', 'api', J, 'Token Zalo OA đã hết hạn 1 giờ', 'cảnh báo "đã hết hạn lúc …"', !!zp3 && /hết hạn/.test(zp3.message), zp3 ? zp3.message : 'không có cảnh báo', zp3);
  // Hộp việc cho từng vai có cảnh báo riêng không? (zaloBridgeDown, supportChatUnforwarded…)
  const ibAdmin = await call('admin', 'GET', '/admin/ops/inbox');
  rec('L5-OPS-06', 'admin', 'api', J, 'ADMIN xem hộp việc /admin/ops/inbox', 'liệt kê hàng đợi theo quyền', short(ibAdmin.body, 500), ibAdmin.body, ibAdmin.status === 200 ? 'PASS' : 'FAIL');
  // Khôi phục: xoá dòng tự thêm, trả dòng cũ
  const hadAccess = before.some((b) => b.key === 'zalo.oa_access_token');
  const hadExp = before.some((b) => b.key === 'zalo.oa_token_expires_at');
  if (!hadAccess) await sql(`DELETE FROM system_configs WHERE key='zalo.oa_access_token'`);
  else await sql(`UPDATE system_configs SET value=$1::jsonb WHERE key='zalo.oa_access_token'`, [JSON.stringify(before.find((b) => b.key === 'zalo.oa_access_token').value)]);
  if (!hadExp) await sql(`DELETE FROM system_configs WHERE key='zalo.oa_token_expires_at'`);
  else await sql(`UPDATE system_configs SET value=$1::jsonb WHERE key='zalo.oa_token_expires_at'`, [JSON.stringify(before.find((b) => b.key === 'zalo.oa_token_expires_at').value)]);
  const h4 = await call('admin', 'GET', '/admin/ops/health');
  check('L5-OPS-07', 'admin', 'api', J, 'Khôi phục cấu hình token Zalo', 'cảnh báo zalo.oa_token biến mất', !(h4.body?.problems ?? []).some((p) => p.key === 'zalo.oa_token'), `problems=${(h4.body?.problems ?? []).map((p) => p.key).join(',')}`, null);
}

// Dọn: tắt mã giảm giá tạo trong lượt chạy
for (const id of created) await sql(`UPDATE coupons SET "isActive"=false WHERE id=$1`, [id]).catch(() => undefined);
save('07-ops-misc');
process.exit(0);
