// Chạy ĐỒNG THỜI các thao tác tiền của admin (bấm đúp / hai nhân viên cùng bấm): chỉ một bên được thắng, tiền và kho chỉ đổi một lần.
// Đối chiếu SQL sổ Ví / sổ điểm / tồn kho sau mỗi ca. Dùng: node 15-races.mjs
import { execFileSync } from 'node:child_process';
import { call, check, rec, save, short, sql, placeOrder, waitPancake, orderRow, userState, sleep } from './_lib.mjs';

const WT = '/Users/longla/coding/tubutree-mini-app/.claude/worktrees/uat-1104';
const HOOK = `${WT}/docs/2026-10-20-uat/tools/uat-harness/pancake-webhook.mjs`;
const env = { ...process.env, PATH: `${process.env.HOME}/.local/node/node-v22.23.3-darwin-arm64/bin:${process.env.PATH}` };
const pancake = (code, st) => execFileSync('node', [HOOK, '5', code, st], { cwd: WT, env, encoding: 'utf8', timeout: 90000 });
const J = 'Thao tác đồng thời';
const ok = (r) => r.status >= 200 && r.status < 300;
async function deliver(code) {
  const o = await orderRow(code);
  await call('kho', 'PUT', `/admin/orders/${o.id}/status`, { status: 'PACKED' });
  pancake(code, 'shipped');
  pancake(code, 'delivered');
  for (let i = 0; i < 30; i++) {
    if ((await orderRow(code)).status === 'DELIVERED') return true;
    await sleep(500);
  }
  return false;
}
const ledgerFor = (code) => sql(`SELECT type::text t, delta::int d FROM wallet_transactions WHERE "userId"='uat_returning' AND reason LIKE $1`, [`%${code}%`]);

// R1: 5 request "Đã nhận tiền" cùng lúc
{
  const { code } = await placeOrder('returning', { method: 'BANK_TRANSFER' });
  const o = await orderRow(code);
  const rs = await Promise.all([1, 2, 3, 4, 5].map((i) => call(i % 2 ? 'ketoan' : 'admin', 'POST', `/admin/orders/${o.id}/confirm-payment`, { bankRef: `FT26RACE${i}` })));
  const o1 = await orderRow(code);
  const hist = await sql(`SELECT count(*)::int n FROM order_status_history WHERE "orderId"=$1 AND note LIKE '%Đã nhận tiền%'`, [o.id]);
  const win = rs.filter(ok).length;
  check('L5-RACE-01', 'ketoan', 'api', J, '5 request "Đã nhận tiền" cùng lúc (Kế toán + Admin)', 'đơn PAID một lần, đúng 1 dòng lịch sử "Đã nhận tiền" (không ghi trùng)', o1.ps === 'PAID' && hist[0].n === 1 && win >= 1, `mã ${rs.map((r) => r.status).join(',')}; DB ${o1.status}/${o1.ps}; ${hist[0].n} dòng lịch sử`, { win, hist });
}

// R2: huỷ đơn chuyển khoản ĐÃ trả, 5 request cùng lúc: hoàn Ví đúng 1 lần
{
  const { code } = await placeOrder('returning', { method: 'BANK_TRANSFER' });
  const o = await orderRow(code);
  await call('ketoan', 'POST', `/admin/orders/${o.id}/confirm-payment`, {});
  await waitPancake(code);
  const u0 = await userState('uat_returning');
  const rs = await Promise.all([1, 2, 3, 4, 5].map((i) => call(i % 2 ? 'cskh' : 'admin', 'PUT', `/admin/orders/${o.id}/status`, { status: 'CANCELLED', note: `UAT race ${i}` })));
  await sleep(1500);
  const u1 = await userState('uat_returning');
  const o1 = await orderRow(code);
  const led = await ledgerFor(code);
  const refundRows = led.filter((l) => l.d > 0);
  check('L5-RACE-02', 'cskh', 'api', J, '5 request huỷ cùng một đơn chuyển khoản đã trả (CSKH + Admin)', `hoàn Ví đúng 1 lần = ${o.total}đ; sổ Ví = số dư; đơn CANCELLED/REFUNDED`, u1.wallet - u0.wallet === o.total && refundRows.length === 1 && u1.wallet === u1.wsum && o1.status === 'CANCELLED', `mã ${rs.map((r) => r.status).join(',')}; Ví ${u0.wallet} -> ${u1.wallet} (+${u1.wallet - u0.wallet}); ${refundRows.length} dòng sổ hoàn; đơn ${o1.status}/${o1.ps}`, { led, u0, u1 });
}

// R3: duyệt đổi/trả 4 request cùng lúc + "đã nhận hàng về" 4 request cùng lúc
{
  const A = await placeOrder('returning', { qty: 2, method: 'COD' });
  await waitPancake(A.code);
  const delivered = await deliver(A.code);
  const oa = await orderRow(A.code);
  const items = await sql(`SELECT id, quantity::int q, "variationId" v FROM order_items WHERE "orderId"=$1`, [oa.id]);
  const req = await call('returning', 'POST', `/orders/${A.code}/return-request`, { reasonCode: 'DEFECTIVE', reason: 'Hàng lỗi UAT race', items: [{ orderItemId: items[0].id, quantity: 1 }] });
  rec('L5-RACE-03a', 'returning', 'api', J, 'Chuẩn bị: COD giao xong + yêu cầu trả 1/2 món', 'đơn DELIVERED, yêu cầu REQUESTED', `delivered=${delivered}; HTTP ${req.status}`, short(req.body, 160), delivered && ok(req) ? 'PASS' : 'BLOCKED');
  if (delivered && ok(req)) {
    const rid = req.body.id;
    const pv = await call('cskh', 'GET', `/admin/return-requests/${rid}/preview`);
    const u0 = await userState('uat_returning');
    const rs = await Promise.all([1, 2, 3, 4].map(() => call('cskh', 'POST', `/admin/return-requests/${rid}/review`, { approve: true, expectedRefund: pv.body.refund })));
    await sleep(1200);
    const u1 = await userState('uat_returning');
    const led = (await ledgerFor(A.code)).filter((l) => l.d > 0);
    check('L5-RACE-03', 'cskh', 'api', J, '4 request CSKH duyệt cùng một yêu cầu đổi/trả', `hoàn Ví đúng 1 lần = ${pv.body.refund}đ; sổ Ví = số dư; sổ điểm = điểm`, u1.wallet - u0.wallet === pv.body.refund && led.length === 1 && u1.wallet === u1.wsum && u1.points === u1.psum, `mã ${rs.map((r) => r.status).join(',')}; Ví +${u1.wallet - u0.wallet} (xem trước ${pv.body.refund}); ${led.length} dòng sổ hoàn; điểm ${u0.points} -> ${u1.points}, sổ ${u1.psum}`, { led });
    const st0 = (await sql(`SELECT stock::int s FROM variations WHERE id=$1`, [items[0].v]))[0].s;
    const rc = await Promise.all([1, 2, 3, 4].map(() => call('kho', 'POST', `/admin/return-requests/${rid}/received`, {})));
    await sleep(800);
    const st1 = (await sql(`SELECT stock::int s FROM variations WHERE id=$1`, [items[0].v]))[0].s;
    check('L5-RACE-04', 'kho', 'api', J, '4 request Kho "Đã nhận hàng về" cùng lúc', 'tồn kho chỉ +1 (đúng số lượng trả)', st1 - st0 === 1, `mã ${rc.map((r) => r.status).join(',')}; kho ${st0} -> ${st1}`, null);
  }
}

// R5: Kho "Đã đóng gói" 4 request cùng lúc; CSKH huỷ + Kho đóng gói cùng lúc trên một đơn
{
  const { code } = await placeOrder('returning', { method: 'COD' });
  const o = await orderRow(code);
  const rs = await Promise.all([1, 2, 3, 4].map(() => call('kho', 'PUT', `/admin/orders/${o.id}/status`, { status: 'PACKED' })));
  const hist = await sql(`SELECT count(*)::int n FROM order_status_history WHERE "orderId"=$1 AND "toStatus"='PACKED'`, [o.id]);
  const o1 = await orderRow(code);
  check('L5-RACE-05', 'kho', 'api', J, '4 request Kho "Đã đóng gói" cùng lúc', 'đơn PACKED, đúng 1 dòng lịch sử PACKED', o1.status === 'PACKED' && hist[0].n === 1, `mã ${rs.map((r) => r.status).join(',')}; ${hist[0].n} dòng lịch sử PACKED; đơn ${o1.status}`, null);
  const c = await placeOrder('returning', { method: 'COD' });
  const oc = await orderRow(c.code);
  const [rp, rc] = await Promise.all([call('kho', 'PUT', `/admin/orders/${oc.id}/status`, { status: 'PACKED' }), call('cskh', 'PUT', `/admin/orders/${oc.id}/status`, { status: 'CANCELLED', note: 'UAT race huỷ' })]);
  await sleep(1000);
  const oc1 = await orderRow(c.code);
  const stockRows = await sql(`SELECT count(*)::int n FROM order_status_history WHERE "orderId"=$1`, [oc.id]);
  rec('L5-RACE-06', 'cskh', 'api', J, 'Kho đóng gói và CSKH huỷ CÙNG LÚC trên một đơn COD', 'kết quả cuối nhất quán: CANCELLED hoặc PACKED, không ở trạng thái lai; tồn kho khớp (huỷ hoàn kho đúng 1 lần)', `Kho ${rp.status}, CSKH ${rc.status}; đơn ${oc1.status}; ${stockRows[0].n} dòng lịch sử`, { rp: short(rp.body, 100), rc: short(rc.body, 100) }, ['PACKED', 'CANCELLED'].includes(oc1.status) ? 'PASS' : 'FAIL');
}

// R7: lệnh rút: duyệt và từ chối cùng lúc
{
  const id = `uatrace${Math.random().toString(36).slice(2, 9)}`;
  await sql(`INSERT INTO payouts (id,"userId",amount,method,status,"requestedAt",fee,"bankInfo") VALUES ($1,'uat_ctv',250000,'BANK','REQUESTED',now(),0,'{"bank":"VCB","accountNo":"0123456789"}'::jsonb)`, [id]);
  const u0 = await userState('uat_ctv');
  const rs = await Promise.all([
    call('admin', 'POST', `/admin/payouts/${id}/approve`, {}), call('admin', 'POST', `/admin/payouts/${id}/reject`, { reason: 'race 1' }),
    call('admin', 'POST', `/admin/payouts/${id}/approve`, {}), call('admin', 'POST', `/admin/payouts/${id}/reject`, { reason: 'race 2' }),
  ]);
  const [p] = await sql(`SELECT status FROM payouts WHERE id=$1`, [id]);
  const u1 = await userState('uat_ctv');
  const refunded = u1.wallet - u0.wallet;
  const consistent = (p.status === 'REJECTED' && refunded === 250000) || (p.status === 'APPROVED' && refunded === 0);
  check('L5-RACE-07', 'admin', 'api', J, 'Duyệt và từ chối (mỗi bên 2 request) cùng một lệnh rút', 'đúng một bên thắng: REJECTED thì hoàn 250.000đ đúng 1 lần, APPROVED thì không hoàn; sổ Ví = số dư', consistent && rs.filter(ok).length === 1 && u1.wallet === u1.wsum, `mã ${rs.map((r) => r.status).join(',')}; lệnh ${p.status}; Ví +${refunded}`, { u0, u1 });
}

// R8: ngân sách mã giảm giá của Marketing: 6 request song song, mỗi mã tối đa 3.000.000đ, ngân sách ngày 10.000.000đ
{
  await sql(`DELETE FROM coupons WHERE code LIKE 'UATRACE%' OR (code LIKE 'UAT%' AND "createdById"='uat_marketing' AND "usedCount"=0)`);
  const tag = Date.now().toString(36).toUpperCase().slice(-5);
  const now = Date.now();
  const mk = (i) => call('marketing', 'POST', '/admin/coupons', { code: `UATRACE${tag}${i}`, type: 'AMOUNT', value: 30000, minOrder: 0, startAt: new Date(now - 3600e3).toISOString(), endAt: new Date(now + 30 * 86400e3).toISOString(), usageLimit: 100, perUserLimit: 1, scope: 'PUBLIC' });
  const rs = await Promise.all([1, 2, 3, 4, 5, 6].map(mk));
  const made = rs.filter(ok).length;
  const exposure = Number((await sql(`SELECT COALESCE(SUM(value * "usageLimit"),0)::bigint e FROM coupons WHERE "createdById"='uat_marketing' AND "createdAt" > now() - interval '1 day'`))[0].e);
  check('L5-RACE-08', 'marketing', 'api', J, '6 request tạo mã (mỗi mã tối đa giảm 3.000.000đ) cùng lúc, ngân sách ngày 10.000.000đ', 'tổng mức giảm tối đa của mã Marketing tạo trong ngày không vượt 10.000.000đ (khoá advisory)', exposure <= 10_000_000 && made <= 3, `mã ${rs.map((r) => r.status).join(',')}; tạo được ${made}; tổng ${exposure.toLocaleString('vi-VN')}đ`, { exposure });
  await sql(`UPDATE coupons SET "isActive"=false WHERE code LIKE 'UATRACE%'`);
}

// R9: bấm "Xử lý xong" Pancake nhiều lần cùng lúc
{
  const rows = await sql(`SELECT id, code FROM orders WHERE "pancakeAttention" IS NOT NULL ORDER BY "createdAt" DESC LIMIT 1`);
  if (rows[0]) {
    const rs = await Promise.all([1, 2, 3].map(() => call('admin', 'POST', `/admin/orders/${rows[0].id}/pancake-attention/resolve`, { note: 'UAT race' })));
    const after = await orderRow(rows[0].code);
    check('L5-RACE-09', 'admin', 'api', J, '3 request "Đã xử lý" cùng một đơn Pancake', 'cờ attention về rỗng, không 500', after.pa === null && rs.every((r) => r.status < 500), `mã ${rs.map((r) => r.status).join(',')}; attention sau=${JSON.stringify(after.pa)}`, rs.map((r) => short(r.body, 80)));
  } else {
    rec('L5-RACE-09', 'admin', 'api', J, '3 request "Đã xử lý" cùng một đơn Pancake', 'không 500', 'không còn đơn cần xử lý để thử', null, 'BLOCKED');
  }
}
const fin = await userState('uat_returning');
check('L5-RACE-10', 'returning', 'api', J, 'Cuối lượt: Ví và điểm của khách khớp sổ', 'walletBalance = SUM(sổ Ví); pointsBalance = SUM(sổ điểm)', fin.wallet === fin.wsum && fin.points === fin.psum, `ví ${fin.wallet}/${fin.wsum}; điểm ${fin.points}/${fin.psum}`, fin);
save('15-races');
process.exit(0);
