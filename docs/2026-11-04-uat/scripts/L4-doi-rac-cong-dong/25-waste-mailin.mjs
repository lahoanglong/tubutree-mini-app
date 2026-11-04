// Đổi rác, đường GỬI VỀ KHO (MAIL_IN): tạo, mã vận đơn, kho nhận kiện, xác nhận cân (đủ / thiếu), từ chối cước chưa trả, kiện không rõ chủ, đại lý không nhận kiện gửi kho.
// Chạy sau 21-waste-reverse.mjs trên cùng lane. Chạy: node 25-waste-mailin.mjs
import { call, idem, sql, pointsState, check, short, msg, readParams, closeDb } from './l4lib.mjs';

const P = readParams();
const mk = (journey, step, expected, persona = '') => ({ persona, viewport: 'API', journey, step, expected });
const seeds = async (u) => (await sql(`SELECT COALESCE((SELECT "totalSeeds" FROM game_profiles WHERE "userId"='${u}'),0) AS s`))[0].s;
const mail = async (user, qty, tracking) => {
  const c = await call(user, 'POST', '/waste/requests', { consent: true, method: 'MAIL_IN', packagingConsent: true, postagePaidConsent: true, lines: [{ itemId: 'wi-tubu-bottle', declaredQty: qty }] }, idem(`mi-${user}`));
  if (c.status !== 201) return { c };
  const t = tracking ? await call(user, 'PUT', `/waste/requests/${c.body.id}/tracking`, { carrier: 'GHN', trackingCode: tracking }) : null;
  return { c, t, id: c.body.id, code: c.body.code };
};
const rec = (user, id, match = { phoneMatchConfirmed: true }) => call('staff', 'POST', `/admin/waste/requests/${id}/receive`, { match });
const status = async (id) => (await sql(`SELECT status::text AS st, "pointsAwarded" AS pts, "receivedAt", "rejectionReason"::text AS rej FROM waste_requests WHERE id='${id}'`))[0];

// ---------- A: gói đủ
const A = await mail('ctv', 8, 'GHN-UAT-A001');
check('M-01', mk('Gửi về kho', 'Khách tạo gói 8 vỏ Tubu và nhập mã vận đơn', 'MAIL_IN IN_TRANSIT, ước tính 16.000 điểm; điểm nhận là kho', 'ctv'), A.c.status === 201 && A.t?.status === 200 && (await status(A.id)).st === 'IN_TRANSIT', `${A.c.status} ${short(A.c.body, 120)}; tracking ${A.t?.status}`);

const noMatch = await rec('staff', A.id, {});
const afterNo = await status(A.id);
check('M-02', mk('Gửi về kho', 'Kho bấm nhận kiện nhưng không xác nhận khớp (không mã TR, không tick khớp SĐT)', 'Không nhận được: ghi vào kiện không rõ chủ (unmatched), yêu cầu vẫn IN_TRANSIT', 'staff'),
  afterNo.st === 'IN_TRANSIT', `${noMatch.status} ${short(noMatch.body, 200)}; trạng thái ${afterNo.st}`);

const ok = await rec('staff', A.id);
const afterOk = await status(A.id);
check('M-03', mk('Gửi về kho', 'Kho nhận kiện, tick khớp mã vận đơn + SĐT', 'RECEIVED, có receivedAt; khách nhận tin kiện đã tới kho', 'staff'), (ok.status === 200 || ok.status === 201) && afterOk.st === 'RECEIVED', `${ok.status} ${short(ok.body, 160)}; trạng thái ${afterOk.st}`);

const again = await rec('staff', A.id);
check('M-04', mk('Gửi về kho', 'Bấm nhận kiện lần hai (nhấn đúp)', 'Không tạo trạng thái mới: báo đã nhận (ALREADY_RECEIVED) hoặc từ chối nhẹ; yêu cầu vẫn RECEIVED', 'staff'), (await status(A.id)).st === 'RECEIVED' && (again.status === 200 || again.status === 201 || again.status === 409), `${again.status} ${short(again.body, 160)}`);

const cancelRec = await call('ctv', 'POST', `/waste/requests/${A.id}/cancel`);
check('M-05', mk('Gửi về kho', 'Khách huỷ yêu cầu khi kiện đã tới kho', 'Chặn (409): kho đã nhận kiện', 'ctv'), cancelRec.status === 409 && (await status(A.id)).st === 'RECEIVED', `${cancelRec.status} ${msg(cancelRec)}`);

{
  const bef = await pointsState('uat_ctv');
  const s0 = await seeds('uat_ctv');
  const f = await call('staff', 'POST', `/waste/desk/requests/${A.id}/confirm`, { lines: [{ itemId: 'wi-tubu-bottle', declaredQty: 8, receivedQty: 8 }], receivedWeightGrams: 2400 });
  const aft = await pointsState('uat_ctv');
  const s1 = await seeds('uat_ctv');
  const row = await status(A.id);
  const led = await sql(`SELECT delta FROM points_transactions WHERE "userId"='uat_ctv' AND reason='RECYCLE:${A.code}'`);
  check('M-06', mk('Gửi về kho', 'Kho xác nhận cân đủ 8/8 vỏ Tubu (2 giọt/vỏ, 2.000 điểm/vỏ)', 'Cộng đúng 16.000 điểm (sổ RECYCLE:<mã>) + 16 giọt nước cho Vườn; COMPLETED; số dư = tổng sổ', 'staff'),
    (f.status === 200 || f.status === 201) && row.st === 'COMPLETED' && aft.balance - bef.balance === 16000 && led.length === 1 && s1 - s0 === 16 && aft.balance === aft.ledgerSum, `${f.status} ${msg(f)} ${short(f.body, 120)}; ${bef.balance}→${aft.balance} sổ ${aft.ledgerSum}; giọt ${s0}→${s1}; dòng sổ ${short(led, 60)}`);
}

// ---------- B: gói thiếu 1 vỏ bị hỏng
const B = await mail('ketoan', 8, 'GHN-UAT-B001');
await rec('staff', B.id);
{
  const bef = await pointsState('uat_ketoan');
  const noReason = await call('staff', 'POST', `/waste/desk/requests/${B.id}/confirm`, { lines: [{ itemId: 'wi-tubu-bottle', declaredQty: 8, receivedQty: 7 }] });
  check('M-07', mk('Gửi về kho', 'Nhận thiếu 7/8 không ghi lý do', 'Chặn 400 (cần lý do nhận thiếu)', 'staff'), noReason.status === 400 && (await status(B.id)).st === 'RECEIVED', `${noReason.status} ${msg(noReason)}`);
  const f = await call('staff', 'POST', `/waste/desk/requests/${B.id}/confirm`, { lines: [{ itemId: 'wi-tubu-bottle', declaredQty: 8, receivedQty: 7, shortfallReason: 'DAMAGED' }] });
  const aft = await pointsState('uat_ketoan');
  check('M-08', mk('Gửi về kho', 'Nhận thiếu 7/8 vì hỏng, ghi lý do', 'Cộng theo số nhận: 7 × 2.000 = 14.000; COMPLETED; số dư = tổng sổ', 'staff'), (f.status === 200 || f.status === 201) && aft.balance - bef.balance === 14000 && aft.balance === aft.ledgerSum, `${f.status} ${msg(f)}; ${bef.balance}→${aft.balance} sổ ${aft.ledgerSum}`);
}

// ---------- C: kiện còn cước phải trả, kho từ chối ngay ở cửa
const C = await mail('dealer', 8, 'GHN-UAT-C001');
{
  const bef = await pointsState('uat_dealer');
  const r = await call('staff', 'POST', `/waste/desk/requests/${C.id}/reject`, { rejectionReason: 'UNPAID_POSTAGE', rejectionNote: 'Kiện còn cước phải trả', match: { phoneMatchConfirmed: true } });
  const row = await status(C.id);
  const aft = await pointsState('uat_dealer');
  const n = await sql(`SELECT payload::text AS p FROM notification_logs WHERE "userId"='uat_dealer' AND payload::text LIKE '%${C.code}%' ORDER BY "sentAt" DESC LIMIT 1`);
  check('M-09', mk('Gửi về kho', 'Kho từ chối kiện còn cước phải trả (UNPAID_POSTAGE)', 'REJECTED/UNPAID_POSTAGE, không cộng điểm, khách nhận tin nêu lý do', 'staff'),
    (r.status === 200 || r.status === 201) && row.st === 'REJECTED' && row.rej === 'UNPAID_POSTAGE' && aft.balance === bef.balance, `${r.status} ${msg(r)}; ${short(row, 100)}; số dư ${bef.balance}→${aft.balance}; tin ${short(n[0]?.p, 220)}`);
}

// ---------- D: kiện không rõ chủ, ghép tay
const D = await mail('marketing', 8, 'GHN-UAT-D001');
{
  const un = await call('staff', 'POST', '/admin/waste/unmatched', { carrier: 'GHN', trackingCode: 'GHN-UAT-D001', description: 'Kiện vỏ chai, ghi tay không SĐT' });
  const uid = un.body?.id;
  const res = await call('staff', 'POST', `/admin/waste/unmatched/${uid}/resolve`, { action: 'MATCH', requestId: D.id, note: 'Khớp mã vận đơn' });
  const row = await status(D.id);
  check('M-10', mk('Gửi về kho', 'Ghi kiện không rõ chủ rồi ghép vào yêu cầu theo mã vận đơn', 'Yêu cầu chuyển RECEIVED, dòng unmatched RESOLVED', 'staff'), (un.status === 201 || un.status === 200) && (res.status === 200 || res.status === 201) && row.st === 'RECEIVED', `tạo ${un.status} ${short(un.body, 80)}; ghép ${res.status} ${msg(res)}; trạng thái ${row.st}`);
  const twice = await call('staff', 'POST', `/admin/waste/unmatched/${uid}/resolve`, { action: 'MATCH', requestId: D.id, note: 'Ghép lần hai' });
  check('M-11', mk('Gửi về kho', 'Ghép lại kiện đã ghép', 'Chặn 409 (kiện không còn mở)', 'staff'), twice.status === 409, `${twice.status} ${msg(twice)}`);
}

// ---------- E: điểm đại lý không nhận kiện gửi kho
{
  const E = await mail('brand', 8, 'GHN-UAT-E001');
  await rec('staff', E.id);
  const f = await call('ctv', 'POST', `/waste/desk/requests/${E.id}/confirm`, { lines: [{ itemId: 'wi-tubu-bottle', declaredQty: 8, receivedQty: 8 }] });
  const row = await status(E.id);
  check('M-12', mk('Gửi về kho', 'Chủ điểm đại lý xác nhận cân yêu cầu GỬI VỀ KHO', 'Chặn (403/409): chỉ kho TP.HCM xử lý kiện gửi; yêu cầu vẫn RECEIVED, không cộng điểm', 'ctv'), (f.status === 403 || f.status === 409 || f.status === 404) && row.st === 'RECEIVED', `${f.status} ${msg(f)}; trạng thái ${row.st}`);
}

// ---------- F: sửa tracking trùng giữa hai khách
{
  const F = await mail('new_nophone', 8, 'GHN-UAT-A001');
  check('M-13', mk('Gửi về kho', 'Khách chưa có SĐT gửi về kho', 'Chặn (cần SĐT)', 'new_nophone'), F.c.status === 403, `${F.c.status} ${msg(F.c)}`);
}
await closeDb();
