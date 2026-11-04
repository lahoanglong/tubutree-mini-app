// Đổi rác: quầy xác nhận cân, cộng điểm, đối chiếu sổ; hạn mức tháng; quà đổi điểm; hết hạn nhận quà; hết hạn giữ chỗ; tin nhắc.
// Chạy sau 00-setup.mjs và 10-waste-api.mjs (lấy id yêu cầu ở params.json). Chạy: node 20-waste-desk.mjs
import { execFileSync } from 'node:child_process';
import { call, idem, sql, sleep, pointsState, ledgerRows, check, short, msg, toneIssues, readParams, saveParams, closeDb, H, WT } from './l4lib.mjs';

const P = readParams();
const mk = (journey, step, expected, persona = '', viewport = 'API') => ({ persona, viewport, journey, step, expected });
const confirm = (user, route, id, lines, extra = {}) => call(user, 'POST', route === 'DESK' ? `/waste/desk/requests/${id}/confirm` : `/admin/waste/requests/${id}/confirm`, { lines, ...extra });
// run-job khởi động cả ứng dụng Nest nên thỉnh thoảng nổ lúc khởi động (bộ khung); thử lại tối đa 3 lần, lần cuối giữ stderr để biết lý do
const runJob = (job, args) => {
  let last = '';
  for (let i = 0; i < 3; i++) {
    try {
      const out = execFileSync('node', [`${H}/run-job.mjs`, '4', job, ...(args ? ['--args', JSON.stringify(args)] : [])], { cwd: WT, env: process.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      return (i ? `(thử lại lần ${i + 1}) ` : '') + out.trim().slice(-400);
    } catch (e) {
      last = String(e.stderr ?? e.message).split('\n').filter((l) => !/^\[Nest\]/.test(l)).slice(-6).join(' / ').slice(0, 500);
    }
  }
  throw new Error(`run-job ${job} lỗi 3 lần: ${last}`);
};
const notifs = (userId, code) => sql(`SELECT "templateCode", payload::text AS payload, status FROM notification_logs WHERE "userId"='${userId}' AND "templateCode"='${code}' ORDER BY "sentAt"`);
const gameSeeds = async (u) => (await sql(`SELECT "totalSeeds" AS s FROM game_profiles WHERE "userId"='${u}'`))[0]?.s ?? 0;

// ---------- Quầy: quyền
{
  const c = await call('returning', 'GET', '/waste/desk/points');
  const l = await call('returning', 'POST', '/waste/desk/lookup', { code: P.R1code });
  check('D-01', mk('Quầy', 'Khách thường mở quầy', 'Danh sách điểm quầy rỗng; tra mã bị chặn 403 (không phải nhân viên, waste-desk.service lookup)', 'returning'), c.status === 200 && (c.body?.length ?? 0) === 0 && l.status === 403, `points ${c.status} ${short(c.body)}; lookup ${l.status} ${msg(l)}`);
  const s = await call('staff', 'GET', '/waste/desk/points');
  check('D-02', mk('Quầy', 'Nhân viên (STAFF không nhóm) mở quầy', 'Thấy kho Tubu (WAREHOUSE) với quota null, trần xác nhận ngày còn đủ (waste.staff_daily_cap_points)', 'staff'), s.status === 200 && s.body.some((p) => p.kind === 'WAREHOUSE'), short(s.body, 400));
}

// ---------- Tra mã
{
  const l = await call('staff', 'POST', '/waste/desk/lookup', { code: P.R1code });
  const r = l.body?.request;
  check('D-03', mk('Quầy', 'Tra mã yêu cầu của returning', 'Trả yêu cầu + dòng hàng; tên và SĐT khách bị che (customerView), cờ warehouseOnly cho hộp sữa và vỏ Tubu', 'staff'),
    (l.status === 200 || l.status === 201) && r?.code === P.R1code && !/0901000003/.test(JSON.stringify(l.body)), short({ name: r?.customerName, phone: r?.customerPhone, lines: r?.lines?.map((x) => [x.itemName, x.declaredQty, x.warehouseOnly]) }, 500));
  const bad = await call('staff', 'POST', '/waste/desk/lookup', { code: 'TR-ZZZZZ' });
  const miss = await sql(`SELECT count(*)::int AS n FROM waste_events WHERE kind::text='LOOKUP_MISS'`);
  check('D-04', mk('Quầy', 'Tra mã không có', '404 "Không tìm thấy mã" + ghi sự kiện LOOKUP_MISS', 'staff'), bad.status === 404 && msg(bad) === 'Không tìm thấy mã' && miss[0].n >= 1, `${bad.status} ${msg(bad)}; LOOKUP_MISS ${miss[0].n}`);
  const noRole = await call('staff', 'POST', '/waste/desk/lookup', { code: P.R2code });
  check('D-05', mk('Quầy', 'Staff tra mã của điểm đại lý (staff chỉ có kho)', '404: mã thuộc điểm mà người này không phụ trách thì như không có', 'staff'), noRole.status === 404, `${noRole.status} ${msg(noRole)}`);
}

// ---------- Xác nhận sai
{
  const wrongQty = await confirm('staff', 'DESK', P.R3b, [{ itemId: 'wi-carton', declaredQty: 9, receivedQty: 2 }]);
  check('D-10', mk('Xác nhận', 'Số khai gửi lên khác số khách đã khai (khách vừa sửa)', '409 "Khách vừa sửa yêu cầu, bạn tra lại mã"', 'staff'), wrongQty.status === 409 && /Khách vừa sửa/.test(msg(wrongQty)), `${wrongQty.status} ${msg(wrongQty)}`);
  const noReason = await confirm('staff', 'DESK', P.R3b, [{ itemId: 'wi-carton', declaredQty: 2, receivedQty: 1 }]);
  check('D-08', mk('Xác nhận', 'Nhận thiếu không ghi lý do', '400 "Dòng nhận thiếu phải có lý do"', 'staff'), noReason.status === 400 && /phải có lý do/.test(msg(noReason)), `${noReason.status} ${msg(noReason)}`);
  const over = await confirm('staff', 'DESK', P.R3b, [{ itemId: 'wi-carton', declaredQty: 2, receivedQty: 3 }]);
  check('D-09', mk('Xác nhận', 'Số nhận lớn hơn số khai', '400 "Số thực nhận phải là số nguyên từ 0 tới số khai"', 'staff'), over.status === 400, `${over.status} ${msg(over)}`);
  const cust = await confirm('returning', 'DESK', P.R3b, [{ itemId: 'wi-carton', declaredQty: 2, receivedQty: 2 }]);
  check('D-11', mk('Xác nhận', 'Khách tự xác nhận yêu cầu của mình qua quầy', 'Chặn 403 (không phải nhân viên điểm)', 'returning'), cust.status === 403, `${cust.status} ${msg(cust)}`);
  const custAdmin = await confirm('returning', 'ADMIN', P.R3b, [{ itemId: 'wi-carton', declaredQty: 2, receivedQty: 2 }]);
  check('D-12', mk('Xác nhận', 'Khách gọi route /admin/waste/requests/:id/confirm', 'Chặn 403 (Roles STAFF/ADMIN)', 'returning'), custAdmin.status === 403, `${custAdmin.status} ${msg(custAdmin)}`);
}

// ---------- Cộng điểm R1 (kho): carton 5/5, hộp sữa 10→7 (bẩn), vỏ Tubu 2/2 → 5.000 + 1.000 + 4.000 = 10.000, 4 giọt
const beforeR = await pointsState('uat_returning');
const seedsBefore = await gameSeeds('uat_returning');
const linesR1 = [{ itemId: 'wi-carton', declaredQty: 5, receivedQty: 5 }, { itemId: 'wi-milk-carton', declaredQty: 10, receivedQty: 7, shortfallReason: 'DIRTY' }, { itemId: 'wi-tubu-bottle', declaredQty: 2, receivedQty: 2 }];
{
  const r = await confirm('staff', 'DESK', P.R1, linesR1, { receivedWeightGrams: 4200 });
  const after = await pointsState('uat_returning');
  const led = await ledgerRows('uat_returning', `AND reason='RECYCLE:${P.R1code}'`);
  const seedsAfter = await gameSeeds('uat_returning');
  const req = (await sql(`SELECT status::text AS status, "pointsAwarded", "dropsAwarded", "confirmedByUserId", "receivedWeightGrams" FROM waste_requests WHERE id='${P.R1}'`))[0];
  check('D-20', mk('Cộng điểm', 'Staff xác nhận R1 tại kho (carton 5/5, hộp sữa 7/10 bẩn, vỏ Tubu 2/2, cân 4.200g)', 'pointsAwarded = 5×1.000 + floor(7/5)×1.000 + 2×2.000 = 10.000 (linePoints theo ảnh chụp mức quy đổi); 4 giọt nước; sổ có đúng 1 dòng RECYCLE:<mã> +10.000; pointsBalance +10.000 = tổng sổ', 'staff'),
    r.status === 201 || r.status === 200 ? (r.body.pointsAwarded === 10000 && r.body.dropsAwarded === 4 && after.balance - beforeR.balance === 10000 && after.balance === after.ledgerSum && led.length === 1 && led[0].delta === 10000 && seedsAfter - seedsBefore === 4) : false,
    `status ${r.status} ${short(r.body, 260)}; số dư ${beforeR.balance}→${after.balance}; tổng sổ ${after.ledgerSum}; sổ ${short(led, 250)}; giọt ${seedsBefore}→${seedsAfter}; req ${short(req)}`);
  const n = await notifs('uat_returning', 'WASTE_POINTS_CREDITED');
  check('D-21', mk('Cộng điểm', 'Tin báo cộng điểm', 'Tin WASTE_POINTS_CREDITED: "Yêu cầu <mã> đã đếm xong. Tubu đã cộng 10.000 Điểm Xanh và 4 giọt nước." (waste-notifier pointsCredited)', 'returning'), n.length >= 1 && /10\.000 Điểm Xanh và 4 giọt nước/.test(n[n.length - 1].payload ?? ''), short(n, 400));
  const replay = await confirm('staff', 'DESK', P.R1, linesR1);
  const after2 = await pointsState('uat_returning');
  const cnt = await sql(`SELECT count(*)::int AS n FROM points_transactions WHERE reason='RECYCLE:${P.R1code}'`);
  check('D-22', mk('Cộng điểm', 'Gửi lại đúng yêu cầu xác nhận (bấm hai lần)', 'Phát lại kết quả cũ, KHÔNG cộng lần hai: sổ vẫn 1 dòng, số dư không đổi', 'staff'), (replay.status === 200 || replay.status === 201) && replay.body.pointsAwarded === 10000 && cnt[0].n === 1 && after2.balance === after.balance, `status ${replay.status}; dòng sổ ${cnt[0].n}; số dư ${after.balance}→${after2.balance}`);
  const diff = await confirm('staff', 'DESK', P.R1, [{ itemId: 'wi-carton', declaredQty: 5, receivedQty: 5 }, { itemId: 'wi-milk-carton', declaredQty: 10, receivedQty: 10 }, { itemId: 'wi-tubu-bottle', declaredQty: 2, receivedQty: 2 }]);
  check('D-23', mk('Cộng điểm', 'Xác nhận lại với số liệu khác', '409 "Yêu cầu đã được xác nhận với số liệu khác"', 'staff'), diff.status === 409 && /số liệu khác/.test(msg(diff)), `${diff.status} ${msg(diff)}`);
  const cx = await call('returning', 'POST', `/waste/requests/${P.R1}/cancel`);
  check('D-24', mk('Huỷ yêu cầu', 'Khách huỷ yêu cầu đã COMPLETED', '409 "Yêu cầu này không còn huỷ được"', 'returning'), cx.status === 409 && /không còn huỷ được/.test(msg(cx)), `${cx.status} ${msg(cx)}`);
}

// ---------- Điểm đại lý
{
  const staffTry = await confirm('staff', 'DESK', P.R2, [{ itemId: 'wi-carton', declaredQty: 3, receivedQty: 3 }, { itemId: 'wi-bubble-wrap', declaredQty: 2, receivedQty: 2 }]);
  check('D-30', mk('Điểm đại lý', 'Staff (không thuộc đại lý) xác nhận yêu cầu của điểm đại lý', '403 "Bạn không phải người ở điểm nhận này"', 'staff'), staffTry.status === 403, `${staffTry.status} ${msg(staffTry)}`);
  const ownPts = await call('ctv', 'GET', '/waste/desk/points');
  check('D-31', mk('Điểm đại lý', 'Chủ điểm đại lý mở quầy', 'Thấy đúng điểm của mình (PARTNER) với hạn mức tháng 100.000; không thấy kho', 'ctv'), ownPts.status === 200 && ownPts.body.length === 1 && ownPts.body[0].kind === 'PARTNER' && ownPts.body[0].quota?.limit === 100000, short(ownPts.body, 400));
  const lookKho = await call('ctv', 'POST', '/waste/desk/lookup', { code: P.R3bCode ?? 'TR-ZZZZZ' });
  const bef = await pointsState('uat_returning');
  const r = await confirm('ctv', 'DESK', P.R2, [{ itemId: 'wi-carton', declaredQty: 3, receivedQty: 3 }, { itemId: 'wi-bubble-wrap', declaredQty: 2, receivedQty: 2 }]);
  const aft = await pointsState('uat_returning');
  const usage = await sql(`SELECT "pointsUsed" FROM waste_point_usage WHERE "pointId"='${P.partnerId}'`);
  check('D-32', mk('Điểm đại lý', 'Chủ điểm đại lý xác nhận carton 3 + nilon 2', 'Cộng 3×1.000 + 2×1.000 = 5.000; quota điểm dùng 5.000, còn 95.000; số dư = tổng sổ', 'ctv'),
    (r.status === 200 || r.status === 201) && r.body.pointsAwarded === 5000 && aft.balance - bef.balance === 5000 && aft.balance === aft.ledgerSum && r.body.quota?.remaining === 95000 && usage[0]?.pointsUsed === 5000, `${r.status} ${short(r.body, 260)}; số dư ${bef.balance}→${aft.balance} tổng sổ ${aft.ledgerSum}; usage ${short(usage)}`);
  // tự xác nhận yêu cầu của chính mình
  const mine = await call('ctv', 'POST', '/waste/requests', { consent: true, method: 'DROP_OFF', pointId: P.partnerId, lines: [{ itemId: 'wi-carton', declaredQty: 1 }] }, idem('ctv'));
  const self = await confirm('ctv', 'DESK', mine.body.id, [{ itemId: 'wi-carton', declaredQty: 1, receivedQty: 1 }]);
  check('D-33', mk('Điểm đại lý', 'Chủ điểm tự tạo yêu cầu rồi tự xác nhận', '403 "Bạn không thể xác nhận yêu cầu này" (không tự cộng điểm cho mình)', 'ctv'), mine.status === 201 && self.status === 403, `tạo ${mine.status}; xác nhận ${self.status} ${msg(self)}`);
  // Món chỉ kho nhận lọt vào yêu cầu điểm đại lý (API chặn từ lúc tạo, nên dựng bằng SQL để thử chốt cuối ở bước xác nhận)
  const u = await call('new', 'POST', '/waste/requests', { consent: true, method: 'DROP_OFF', pointId: P.whId, lines: [{ itemId: 'wi-milk-carton', declaredQty: 5 }] }, idem('wo'));
  await sql(`UPDATE waste_requests SET "pointId"='${P.partnerId}' WHERE id='${u.body.id}'`);
  const bad = await confirm('ctv', 'DESK', u.body.id, [{ itemId: 'wi-milk-carton', declaredQty: 5, receivedQty: 5 }]);
  check('D-34', mk('Điểm đại lý', 'Hộp sữa nằm trong yêu cầu của điểm đại lý (dựng bằng SQL), đại lý xác nhận có nhận', '409 "Điểm đại lý không xác nhận được món chỉ kho Tubu HCMC nhận. Từ chối yêu cầu hoặc chuyển khách tới kho." Không cộng điểm', 'ctv'), bad.status === 409 && /món chỉ kho Tubu HCMC nhận/.test(msg(bad)), `${bad.status} ${msg(bad)}`);
  const zero = await confirm('ctv', 'DESK', u.body.id, [{ itemId: 'wi-milk-carton', declaredQty: 5, receivedQty: 0, shortfallReason: 'NOT_ACCEPTED' }]);
  check('D-35', mk('Điểm đại lý', 'Cùng yêu cầu: đại lý ghi nhận 0 (không nhận hộp sữa)', 'Cho qua với 0 điểm: hoàn tất 0 điểm, khách không mất gì (waste-confirm comment "Counted 0 is let through")', 'ctv'), (zero.status === 200 || zero.status === 201) && zero.body.pointsAwarded === 0, `${zero.status} ${short(zero.body, 200)} ${msg(zero)}`);
  P.milkReqId = u.body.id; P.ctvSelfReq = mine.body.id;
}

// ---------- Từ chối
{
  const noNote = await call('staff', 'POST', `/waste/desk/requests/${P.N1}/reject`, { rejectionReason: 'OTHER' });
  check('D-40', mk('Từ chối', 'Từ chối lý do "Khác" không ghi chú', '400 "Lý do Khác cần ghi chú"', 'staff'), noNote.status === 400 && /Lý do Khác cần ghi chú/.test(msg(noNote)), `${noNote.status} ${msg(noNote)}`);
  const bef = await pointsState('uat_new');
  const rj = await call('staff', 'POST', `/waste/desk/requests/${P.N1}/reject`, { rejectionReason: 'WET' });
  const aft = await pointsState('uat_new');
  const n = await notifs('uat_new', 'WASTE_REQUEST_REJECTED');
  check('D-41', mk('Từ chối', 'Staff từ chối yêu cầu N1 (hàng ướt)', 'REJECTED, không cộng điểm (số dư không đổi); tin "Yêu cầu <mã> chưa được nhận: hàng bị ướt. Bạn xem chi tiết trong mục Đổi rác."', 'staff'),
    (rj.status === 200 || rj.status === 201) && rj.body.status === 'REJECTED' && bef.balance === aft.balance && n.length === 1 && /hàng bị ướt/.test(n[0].payload), `${rj.status} ${short(rj.body)}; số dư ${bef.balance}→${aft.balance}; tin ${short(n, 300)}`);
  const conf = await confirm('staff', 'DESK', P.N1, [{ itemId: 'wi-bubble-wrap', declaredQty: 4, receivedQty: 4 }]);
  check('D-42', mk('Từ chối', 'Xác nhận cộng điểm yêu cầu đã bị từ chối', '409 "Yêu cầu không ở trạng thái xác nhận được"', 'staff'), conf.status === 409, `${conf.status} ${msg(conf)}`);
}

// ---------- Admin route + hạn mức điểm tháng
{
  const bef = await pointsState('uat_returning');
  const r = await confirm('admin', 'ADMIN', P.R3b, [{ itemId: 'wi-carton', declaredQty: 2, receivedQty: 2 }]);
  const aft = await pointsState('uat_returning');
  check('D-50', mk('Cộng điểm', 'Admin xác nhận R3b qua /admin/waste/requests/:id/confirm (carton 2/2)', '+2.000, số dư = tổng sổ', 'admin'), (r.status === 200 || r.status === 201) && aft.balance - bef.balance === 2000 && aft.balance === aft.ledgerSum, `${r.status} ${short(r.body, 200)}; ${bef.balance}→${aft.balance} (sổ ${aft.ledgerSum})`);
  // trần điểm tháng: hạ trần xuống 20.000 rồi tạo yêu cầu vượt
  const used = (await sql(`SELECT COALESCE(SUM(COALESCE("pointsAwarded","estimatedPoints")),0)::int AS p FROM waste_requests WHERE "userId"='uat_returning' AND status::text IN ('OPEN','IN_TRANSIT','RECEIVED','COMPLETED','REVERSED') AND "capMonthKey"='2026-11'`))[0].p;
  const setCap = await call('admin', 'PUT', '/admin/config', { key: 'waste.customer_monthly_cap_points', value: used + 3000 });
  await sleep(6000);
  const over = await call('returning', 'POST', '/waste/requests', { consent: true, method: 'DROP_OFF', pointId: P.whId, lines: [{ itemId: 'wi-bubble-wrap', declaredQty: 5 }] }, idem('cap'));
  check('D-51', mk('Hạn mức tháng', `Hạ trần điểm tháng còn ${used + 3000} (đã dùng ${used}); khai nilon 5 (5.000 điểm)`, `409 "Tháng này bạn chỉ còn 3.000 Điểm Xanh trong trần đổi rác" (POINTS_MONTH_CAP)`, 'returning'), setCap.status === 200 && over.status === 409 && /chỉ còn 3\.000 Điểm Xanh trong trần đổi rác/.test(msg(over)), `${over.status} ${msg(over)}`);
  const okQ = await call('returning', 'POST', '/waste/requests', { consent: true, method: 'DROP_OFF', pointId: P.whId, lines: [{ itemId: 'wi-bubble-wrap', declaredQty: 3 }] }, idem('cap2'));
  check('D-52', mk('Hạn mức tháng', 'Khai nilon 3 (đúng 3.000 điểm còn lại)', 'Nhận (chạm trần, không vượt)', 'returning'), okQ.status === 201, `${okQ.status} ${msg(okQ)}`);
  if (okQ.status === 201) await call('returning', 'POST', `/waste/requests/${okQ.body.id}/cancel`);
  await call('admin', 'PUT', '/admin/config', { key: 'waste.customer_monthly_cap_points', value: 60000 });
  await sleep(3000);
}

// ---------- Quà đổi điểm
{
  const cat = await call('returning', 'GET', '/me/loyalty/rewards');
  check('D-60', mk('Kho quà', 'Danh sách quà', 'Có 4 phiếu giảm giá + quà trồng cây; giá theo bảng seed (20.000 / 50.000 / 75.000 / 100.000)', 'returning'), cat.status === 200, short(cat.body, 500));
  const bef = await pointsState('uat_returning');
  const key = `l4-redeem-${Date.now()}`;
  const a = await call('returning', 'POST', '/me/loyalty/rewards/reward-freeship/redeem', undefined, { 'idempotency-key': key });
  const b = await call('returning', 'POST', '/me/loyalty/rewards/reward-freeship/redeem', undefined, { 'idempotency-key': key });
  const aft = await pointsState('uat_returning');
  const led = await ledgerRows('uat_returning', `AND reason LIKE 'LOYALTY_REDEEM_VOUCHER:reward-freeship'`);
  const coupons = await sql(`SELECT code, type::text AS type, "minOrder", "endAt" FROM coupons WHERE id IN (SELECT "couponId" FROM waste_gift_redemptions WHERE "userId"='uat_returning')`);
  check('D-61', mk('Đổi quà', 'Đổi phiếu Miễn phí vận chuyển (20.000 điểm), bấm hai lần cùng idempotency-key', 'Trừ đúng 20.000 một lần; sổ 1 dòng LOYALTY_REDEEM_VOUCHER:reward-freeship −20.000; phiếu FREESHIP đơn tối thiểu 99.000, hạn 30 ngày; số dư = tổng sổ', 'returning'),
    a.status === 201 && b.status === 201 && bef.balance - aft.balance === 20000 && led.length === 1 && led[0].delta === -20000 && aft.balance === aft.ledgerSum && coupons[0]?.type === 'FREESHIP' && coupons[0]?.minOrder === 99000,
    `${a.status}/${b.status}; ${bef.balance}→${aft.balance} (sổ ${aft.ledgerSum}); dòng sổ ${short(led, 200)}; phiếu ${short(coupons, 250)}`);
  const cur = (await pointsState('uat_returning')).balance;
  const tooMuch = await call('new', 'POST', '/me/loyalty/rewards/reward-discount-100k/redeem', undefined, idem('x'));
  check('D-62', mk('Đổi quà', 'Khách 0 điểm đổi phiếu 100.000 điểm', '400 "Bạn cần 100.000 Điểm Xanh để đổi ưu đãi này (hiện có 0 điểm)."', 'new'), tooMuch.status === 400 && /Bạn cần 100\.000 Điểm Xanh/.test(msg(tooMuch)), `${tooMuch.status} ${msg(tooMuch)}`);
  const tree = await call('returning', 'POST', '/me/loyalty/rewards/gift-tree/redeem', undefined, idem('tree'));
  check('D-63', mk('Đổi quà', 'Đổi quà góp quỹ trồng cây ở màn Kho quà', '400 "Quà góp quỹ trồng cây đổi bằng nút Góp cây ở Vườn Xanh." (loyalty.service redeemReward)', 'returning'), tree.status === 400 && /Góp cây ở Vườn Xanh/.test(msg(tree)), `${tree.status} ${msg(tree)}`);
}

// ---------- Quà hiện vật: hết hàng, trao tại quầy, hết hạn nhận quà + hoàn điểm
{
  const g = await call('admin', 'POST', '/admin/waste/gifts', { kind: 'GIFT', name: 'Túi vải Tubu (UAT)', description: 'Túi vải nhận tại kho', pointsCost: 5000, status: 'ACTIVE', stock: 2, claimInstructions: 'Nhận tại kho giờ hành chính' });
  const gid = g.body?.id;
  check('D-70', mk('Quà hiện vật', 'Admin tạo quà hiện vật tồn kho 2', 'Tạo 201', 'admin'), g.status === 201 && !!gid, `${g.status} ${msg(g)} ${gid}`);
  const bef = await pointsState('uat_returning');
  const r1 = await call('returning', 'POST', `/me/loyalty/rewards/${gid}/redeem`, undefined, idem('g1'));
  const code1 = r1.body?.redemption?.code;
  const aft = await pointsState('uat_returning');
  const row = (await sql(`SELECT status::text AS status, "claimExpiresAt", "createdAt" FROM waste_gift_redemptions WHERE code='${code1}'`))[0];
  const days = row ? Math.round((new Date(row.claimExpiresAt) - new Date(row.createdAt)) / 86400000) : null;
  check('D-71', mk('Quà hiện vật', 'Returning đổi quà hiện vật (5.000 điểm)', 'READY + mã QG-xxxxxxxx; trừ 5.000 (sổ GIFT_REDEEM:<id>); hạn nhận = 60 ngày (waste.gift_claim_days); tồn kho 2→1', 'returning'),
    r1.status === 201 && /^QG-/.test(code1 ?? '') && bef.balance - aft.balance === 5000 && aft.balance === aft.ledgerSum && days === 60 && row.status === 'READY', `${r1.status} ${msg(r1)} mã ${code1}; ${bef.balance}→${aft.balance} sổ ${aft.ledgerSum}; hạn ${days} ngày`);
  // returning đổi tiếp cái thứ 2 (để thử hết hạn), rồi `new` hết hàng
  const r2 = await call('returning', 'POST', `/me/loyalty/rewards/${gid}/redeem`, undefined, idem('g2'));
  const code2 = r2.body?.redemption?.code;
  const sold = await call('new', 'POST', `/me/loyalty/rewards/${gid}/redeem`, undefined, idem('g3'));
  check('D-72', mk('Quà hiện vật', 'Hết tồn kho thì khách khác đổi', '400 "Quà này đã hết hoặc đã ngừng đổi"', 'new'), sold.status === 400 && /đã hết hoặc đã ngừng đổi/.test(msg(sold)), `${sold.status} ${msg(sold)}`);
  // trao quà tại quầy
  const look = await call('staff', 'POST', '/waste/desk/lookup', { code: code1 });
  const ful = await call('staff', 'POST', '/waste/desk/gifts/fulfil', { code: code1, pointId: P.whId });
  const again = await call('staff', 'POST', '/waste/desk/gifts/fulfil', { code: code1, pointId: P.whId });
  check('D-73', mk('Quà hiện vật', 'Quầy kho tra mã quà rồi trao', 'Tra ra type GIFT; trao → FULFILLED; trao lại → 409 "Lượt đổi quà này đã được trao hoặc đã huỷ."', 'staff'),
    look.body?.type === 'GIFT' && (ful.status === 200 || ful.status === 201) && ful.body?.status === 'FULFILLED' && again.status === 409, `lookup ${look.body?.type}; trao ${ful.status} ${ful.body?.status}; trao lại ${again.status} ${msg(again)}`);
  // hết hạn nhận quà: lùi claimExpiresAt cũ 2 ngày, chạy cron
  await sql(`UPDATE waste_gift_redemptions SET "claimExpiresAt" = now() - interval '2 days' WHERE code='${code2}'`);
  const late = await call('staff', 'POST', '/waste/desk/gifts/fulfil', { code: code2, pointId: P.whId });
  check('D-74', mk('Hết hạn nhận quà', 'Quầy trao quà đã quá hạn nhận', '409 "Quà đã quá hạn nhận, quầy không trao được nữa. Tubu sẽ xử lý lượt đổi này và báo khách."', 'staff'), late.status === 409 && /quá hạn nhận/.test(msg(late)), `${late.status} ${msg(late)}`);
  const bef2 = await pointsState('uat_returning');
  const stockBefore = (await sql(`SELECT stock FROM waste_gifts WHERE id='${gid}'`))[0].stock;
  const job = runJob('WasteGiftExpiryCron.run');
  const aft2 = await pointsState('uat_returning');
  const rf = await ledgerRows('uat_returning', `AND reason='GIFT_REFUND:${code2}'`);
  const stockAfter = (await sql(`SELECT stock FROM waste_gifts WHERE id='${gid}'`))[0].stock;
  const rr = (await sql(`SELECT status::text AS status, "refundedPoints", "cancelReason" FROM waste_gift_redemptions WHERE code='${code2}'`))[0];
  const nf = await notifs('uat_returning', 'WASTE_GIFT_EXPIRED');
  check('D-75', mk('Hết hạn nhận quà', 'Cron huỷ quà quá hạn nhận (WasteGiftExpiryCron.run)', 'CANCELLED, lý do "Quá hạn nhận", hoàn đúng 5.000 (sổ GIFT_REFUND:<mã> +5.000), tồn kho +1, tin WASTE_GIFT_EXPIRED; số dư = tổng sổ', 'returning'),
    rr?.status === 'CANCELLED' && rr.refundedPoints === 5000 && aft2.balance - bef2.balance === 5000 && rf.length === 1 && rf[0].delta === 5000 && stockAfter === stockBefore + 1 && aft2.balance === aft2.ledgerSum && nf.length >= 1,
    `job ${job.replace(/\s+/g, ' ').slice(-160)}; ${short(rr)}; ${bef2.balance}→${aft2.balance} sổ ${aft2.ledgerSum}; hoàn ${short(rf, 160)}; tồn ${stockBefore}→${stockAfter}; tin ${short(nf, 300)}`);
  const job2 = runJob('WasteGiftExpiryCron.run');
  const rf2 = await sql(`SELECT count(*)::int AS n FROM points_transactions WHERE reason='GIFT_REFUND:${code2}'`);
  check('D-76', mk('Hết hạn nhận quà', 'Chạy cron lần hai', 'Không hoàn lần hai (idempotent)', 'returning'), rf2[0].n === 1, `dòng hoàn ${rf2[0].n}; ${job2.replace(/\s+/g, ' ').slice(-100)}`);
  P.giftId = gid;
}

// ---------- Hết hạn giữ chỗ + tin nhắc
{
  const mkReq = async (user, method, extra = {}) => (await call(user, 'POST', '/waste/requests', { consent: true, method, ...extra }, idem('exp'))).body;
  const dp = await mkReq('new', 'DROP_OFF', { pointId: P.whId, lines: [{ itemId: 'wi-carton', declaredQty: 2 }] });
  const mi = await mkReq('new', 'MAIL_IN', { packagingConsent: true, postagePaidConsent: true, lines: [{ itemId: 'wi-tubu-bottle', declaredQty: 8 }] });
  // hạn chót = hết ngày VN của ngày mai (cách 24-48 giờ)
  const tmr = new Date(Date.now() + 7 * 3600_000 + 86400_000); tmr.setUTCHours(23, 59, 59, 999);
  const endTmrUtc = new Date(tmr.getTime() - 7 * 3600_000).toISOString();
  await sql(`UPDATE waste_requests SET "expiresAt"='${endTmrUtc}' WHERE id IN ('${dp.id}','${mi.id}')`);
  const ds = tmr.toISOString().slice(0, 10).split('-').reverse().join('/');
  const job = runJob('WasteExpiryCron.run');
  const nx = await notifs('uat_new', 'WASTE_REQUEST_EXPIRING');
  const texts = nx.map((n) => JSON.parse(n.payload).data);
  const bodyOf = (code) => texts.find((t) => t.code === code);
  check('D-80', mk('Tin nhắc hết hạn', 'Yêu cầu còn khoảng một ngày giữ chỗ (DROP_OFF + MAIL_IN chưa nhập mã vận đơn)', 'Mỗi yêu cầu nhận 1 tin WASTE_REQUEST_EXPIRING; mẫu mới: "…hạn chót là hết ngày <dd/MM/yyyy>. Bạn nhớ <mang rác tới điểm nhận | gửi kiện và nhập mã vận đơn> đến hết ngày đó nhé."', 'new'),
    nx.length === 2 && bodyOf(dp.code)?.until === ds && bodyOf(dp.code)?.next_step === 'mang rác tới điểm nhận' && bodyOf(mi.code)?.next_step === 'gửi kiện và nhập mã vận đơn',
    `job ${job.replace(/\s+/g, ' ').slice(-120)}; ngày mong ${ds}; tin ${short(texts, 500)}`);
  const tpl = (await sql(`SELECT "bodyTemplate" AS b FROM notification_templates WHERE code='WASTE_REQUEST_EXPIRING'`))[0].b;
  const rendered = tpl.replace('{{code}}', dp.code).replace('{{until}}', ds).replace('{{next_step}}', 'mang rác tới điểm nhận');
  check('D-81', mk('Tin nhắc hết hạn', 'Chữ mẫu mới "hạn chót là hết ngày"', 'Nội dung mẫu trong DB = bản đợt DR-03: "Yêu cầu {{code}} sắp hết hạn giữ chỗ, hạn chót là hết ngày {{until}}. Bạn nhớ {{next_step}} đến hết ngày đó nhé."', 'new'), /hạn chót là hết ngày/.test(tpl) && !/trước ngày đó/.test(tpl) && toneIssues(tpl).length === 0, `Bản dựng: ${rendered}`);
  runJob('WasteExpiryCron.run');
  const nx2 = await notifs('uat_new', 'WASTE_REQUEST_EXPIRING');
  check('D-82', mk('Tin nhắc hết hạn', 'Chạy cron lần hai trong cùng ngày', 'Không gửi trùng (dedupeKey waste:<id>:EXPIRING)', 'new'), nx2.length === 2, `số tin ${nx2.length}`);
  // đóng hết hạn
  await sql(`UPDATE waste_requests SET "expiresAt"=now() - interval '1 hour' WHERE id IN ('${dp.id}','${mi.id}')`);
  const job2 = runJob('WasteExpiryCron.run');
  const st = await sql(`SELECT code, status::text AS status, "closeReason"::text AS reason FROM waste_requests WHERE id IN ('${dp.id}','${mi.id}') ORDER BY code`);
  const ne = await notifs('uat_new', 'WASTE_REQUEST_EXPIRED');
  const miText = ne.map((n) => JSON.parse(n.payload)).find((t) => t.data?.code === mi.code)?.data;
  check('D-83', mk('Hết hạn giữ chỗ', 'Cron đóng yêu cầu quá hạn', 'EXPIRED + HOLD_EXPIRED; tin cho MAIL_IN nhắc "nhắn CSKH kèm mã vận đơn" (WASTE_MAIL_IN_HOLD_EXPIRED_TEXT)', 'new'),
    st.length === 2 && st.every((s) => s.status === 'EXPIRED' && s.reason === 'HOLD_EXPIRED') && /nhắn CSKH kèm mã vận đơn/.test(miText?.detail ?? ''), `${short(st)}; ${job2.replace(/\s+/g, ' ').slice(-80)}; tin MAIL_IN ${short(miText)}`);
  // trần hạn mức được trả: new khai lại carton 10 hôm nay
  const reuse = await call('new', 'POST', '/waste/requests', { consent: true, method: 'DROP_OFF', pointId: P.whId, lines: [{ itemId: 'wi-carton', declaredQty: 10 }] }, idem('reuse'));
  check('D-84', mk('Hết hạn giữ chỗ', 'Sau khi hết hạn, khai lại carton 10 trong ngày', 'Được: phần giới hạn đã giữ được trả lại (hết hạn không tính vào hạn mức)', 'new'), reuse.status === 201, `${reuse.status} ${msg(reuse)}`);
  if (reuse.status === 201) await call('new', 'POST', `/waste/requests/${reuse.body.id}/cancel`);
}

saveParams(P);
await closeDb();
