// Vườn Xanh: điểm danh (Điểm Xanh + giọt nước), chuỗi 7 ngày, lỡ ngày, vé giữ lửa, hồi sinh chuỗi, sương, vòng quay (trần 5 lượt/ngày),
// nhiệm vụ, đố vui. Mỗi ca cộng/trừ điểm đối chiếu số dư = tổng sổ. Chạy trên lane vừa dựng; chạy lại cần lane mới (00-lane-fresh.sh).
// Chạy: node 30-game-api.mjs
import { call, idem, sql, sleep, pointsState, ledgerRows, check, short, msg, toneIssues, closeDb } from './l4lib.mjs';

const mk = (journey, step, expected, persona = '') => ({ persona, viewport: 'API', journey, step, expected });
const prof = async (u) => (await sql(`SELECT "totalSeeds" AS seeds, "streakDays" AS streak, "streakFreezes" AS freezes, "longestStreak" AS longest, "brokenStreakDays" AS broken FROM game_profiles WHERE "userId"='${u}'`))[0] ?? null;
const vnKey = (d = new Date()) => new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 10);

/** Lùi toàn bộ dấu vết điểm danh của user một ngày (giả lập "hôm qua đã điểm danh") để lần bấm kế tiếp rơi vào ngày kế. */
async function shiftBack(u, days = 1) {
  await sql(`UPDATE loyalty_check_ins SET "dayKey" = to_char(("dayKey"::date - ${days}), 'YYYY-MM-DD') WHERE "userId"='${u}'`);
  await sql(`UPDATE points_transactions SET "refId" = to_char(("refId"::date - ${days}), 'YYYY-MM-DD') WHERE "userId"='${u}' AND "refType"='CHECKIN'`);
  await sql(`UPDATE game_profiles SET "lastCheckInAt" = "lastCheckInAt" - interval '${days} days' WHERE "userId"='${u}'`);
}

// ---------- Điểm danh ngày đầu
{
  const s0 = await call('new', 'GET', '/me/daily-check-in');
  check('G-01', mk('Điểm danh', 'Trạng thái trước khi điểm danh lần đầu', 'checkedInToday=false; hôm nay +1.000 Điểm Xanh (loyalty.checkin_points[0]) và +65 giọt nước (game.daily_login_seeds 15 + game.first_checkin_bonus 50)', 'new'),
    s0.status === 200 && s0.body.checkedInToday === false && s0.body.todayPoints === 1000 && s0.body.todayWater === 65, short(s0.body, 400));
  const bef = await pointsState('uat_new');
  const seeds0 = (await prof('uat_new'))?.seeds ?? 0;
  const r = await call('new', 'POST', '/me/daily-check-in');
  const aft = await pointsState('uat_new');
  const led = await ledgerRows('uat_new', `AND "refType"='CHECKIN'`);
  const p = await prof('uat_new');
  check('G-02', mk('Điểm danh', 'Điểm danh ngày 1', '+1.000 Điểm Xanh (sổ DAILY_CHECKIN:DAY_1, refType CHECKIN), +65 giọt nước, chuỗi 1; số dư = tổng sổ', 'new'),
    (r.status === 200 || r.status === 201) && aft.balance - bef.balance === 1000 && aft.balance === aft.ledgerSum && led.length === 1 && led[0].reason === 'DAILY_CHECKIN:DAY_1' && p.seeds - seeds0 === 65 && p.streak === 1,
    `${r.status} ${short(r.body, 300)}; ${bef.balance}→${aft.balance} sổ ${aft.ledgerSum}; giọt ${seeds0}→${p?.seeds} chuỗi ${p?.streak}`);
  const r2 = await call('new', 'POST', '/me/daily-check-in');
  const aft2 = await pointsState('uat_new');
  const cnt = (await sql(`SELECT count(*)::int AS n FROM points_transactions WHERE "userId"='uat_new' AND "refType"='CHECKIN'`))[0].n;
  check('G-03', mk('Giới hạn lượt/ngày', 'Điểm danh lần hai trong ngày', 'alreadyDone=true, không cộng thêm (sổ vẫn 1 dòng CHECKIN, số dư và giọt nước không đổi)', 'new'),
    r2.body?.alreadyDone === true && cnt === 1 && aft2.balance === aft.balance && (await prof('uat_new')).seeds === p.seeds, `${r2.status} ${short(r2.body, 200)}; dòng sổ ${cnt}`);
}

// ---------- Chuỗi 7 ngày: bảng điểm [1000×6, 2000], mốc nước 3 ngày +5, 7 ngày +30
{
  const expectPts = [1000, 1000, 1000, 1000, 1000, 1000, 2000, 1000];
  const expectWater = [15 + 50, 15, 15 + 5, 15, 15, 15 + 5, 15 + 30, 15];
  const rows = [];
  let allOk = true;
  for (let day = 2; day <= 8; day++) {
    await shiftBack('uat_new', 1);
    const bef = await pointsState('uat_new');
    const pb = await prof('uat_new');
    const r = await call('new', 'POST', '/me/daily-check-in');
    const aft = await pointsState('uat_new');
    const pa = await prof('uat_new');
    const dPts = aft.balance - bef.balance;
    const dWater = pa.seeds - pb.seeds;
    const ok = (r.status === 200 || r.status === 201) && dPts === expectPts[day - 1] && dWater === expectWater[day - 1] && pa.streak === day && aft.balance === aft.ledgerSum;
    if (!ok) allOk = false;
    rows.push(`ngày ${day}: +${dPts} điểm (mong ${expectPts[day - 1]}), +${dWater} nước (mong ${expectWater[day - 1]}), chuỗi ${pa.streak}${ok ? '' : ' LỆCH'}`);
  }
  check('G-04', mk('Chuỗi ngày', 'Điểm danh liên tiếp ngày 2..8 (lùi mốc điểm danh một ngày bằng SQL giữa các lần bấm)', 'Điểm theo bảng [1.000 ×6, 2.000 ngày 7, 1.000 ngày 8 quay lại ngày 1]; nước: 15, +5 ở chuỗi 3 và 6, +30 ở chuỗi 7 (game.streak_7_bonus), chuỗi tăng 1/ngày; số dư = tổng sổ mỗi lần', 'new'), allOk, rows.join(' | '));
  const m = await call('new', 'GET', '/game/missions');
  const c7 = (m.body ?? []).find((x) => x.code === 'CHECKIN_7');
  check('G-05', mk('Nhiệm vụ', 'Nhiệm vụ Chăm chỉ 7 ngày sau chuỗi 8', 'completed=true, claimed=false, thưởng 30.000 (missions.rewardPoints)', 'new'), m.status === 200 && c7?.completed === true && c7?.claimed === false && c7?.rewardPoints === 30000, short(c7));
  const bef = await pointsState('uat_new');
  const c = await call('new', 'POST', '/game/missions/CHECKIN_7/claim');
  const aft = await pointsState('uat_new');
  const led = await ledgerRows('uat_new', `AND "reason" LIKE '%MISSION%'`);
  check('G-06', mk('Nhiệm vụ', 'Nhận thưởng Chăm chỉ 7 ngày', '+30.000 một lần, sổ có dòng MISSION; số dư = tổng sổ', 'new'), (c.status === 200 || c.status === 201) && aft.balance - bef.balance === 30000 && aft.balance === aft.ledgerSum && led.length === 1, `${c.status} ${msg(c)} ${short(c.body, 160)}; ${bef.balance}→${aft.balance} sổ ${aft.ledgerSum}; dòng ${short(led, 200)}`);
  const c2 = await call('new', 'POST', '/game/missions/CHECKIN_7/claim');
  const aft2 = await pointsState('uat_new');
  check('G-07', mk('Nhiệm vụ', 'Nhận lần hai cùng nhiệm vụ', '400 "Bạn đã nhận thưởng nhiệm vụ này rồi." không cộng thêm', 'new'), c2.status === 400 && /đã nhận thưởng nhiệm vụ này rồi/.test(msg(c2)) && aft2.balance === aft.balance, `${c2.status} ${msg(c2)}`);
  const f = await call('new', 'POST', '/game/missions/FIRST_ORDER/claim');
  check('G-08', mk('Nhiệm vụ', 'Nhận nhiệm vụ Đơn hàng đầu tiên khi chưa có đơn', 'Chặn 400 (chưa đủ điều kiện), không cộng điểm', 'new'), f.status === 400, `${f.status} ${msg(f)}`);
  const nf = await call('new', 'POST', '/game/missions/KHONG_CO/claim');
  check('G-09', mk('Nhiệm vụ', 'Nhận nhiệm vụ không tồn tại', '404 "Nhiệm vụ "KHONG_CO" không tồn tại."', 'new'), nf.status === 404, `${nf.status} ${msg(nf)}`);
}

// ---------- Lỡ ngày: returning điểm danh, rồi lỡ 10 ngày
{
  const r1 = await call('returning', 'POST', '/me/daily-check-in');
  await shiftBack('uat_returning', 1);
  await call('returning', 'POST', '/me/daily-check-in');
  const p1 = await prof('uat_returning');
  await shiftBack('uat_returning', 10);
  const pb = await prof('uat_returning');
  const bef = await pointsState('uat_returning');
  const s = await call('returning', 'GET', '/me/daily-check-in');
  const r = await call('returning', 'POST', '/me/daily-check-in');
  const aft = await pointsState('uat_returning');
  const pa = await prof('uat_returning');
  check('G-10', mk('Chuỗi ngày', 'Chuỗi 2 ngày, lỡ 10 ngày rồi quay lại', 'Chuỗi về 1; điểm ngày 1 = 1.000; nước = 15 + quà quay lại 60 (game.comeback_seeds, gap ≥ 7) = 75; ghi nhận chuỗi vừa mất 2 để hồi sinh; số dư = tổng sổ', 'returning'),
    p1.streak === 2 && pa.streak === 1 && pa.broken === 2 && pa.seeds - pb.seeds === 75 && aft.balance - bef.balance === 1000 && aft.balance === aft.ledgerSum,
    `chuỗi trước ${p1.streak}; sau ${pa.streak}; chuỗi vừa mất ${pa.broken}; +${pa.seeds - pb.seeds} nước; +${aft.balance - bef.balance} điểm; trạng thái dự báo ${short({ w: s.body?.todayWater, p: s.body?.todayPoints }, 80)}`);
  // hồi sinh chuỗi: cost 50, nước đủ?
  const rep = await call('returning', 'POST', '/game/streak/repair');
  const pr = await prof('uat_returning');
  check('G-11', mk('Chuỗi ngày', 'Hồi sinh chuỗi vừa mất (game.streak_repair_cost 50 giọt nước)', 'Trừ đúng 50 giọt, chuỗi = 2 + 1 = 3, chuỗi mất reset; bấm lại → 400 không có chuỗi để hồi sinh', 'returning'),
    (rep.status === 200 || rep.status === 201) && rep.body?.repaired === true && pa.seeds - pr.seeds === 50 && pr.streak === 3, `${rep.status} ${msg(rep)} ${short(rep.body, 160)}; nước ${pa.seeds}→${pr.seeds}; chuỗi ${pr.streak}`);
  const rep2 = await call('returning', 'POST', '/game/streak/repair');
  check('G-12', mk('Chuỗi ngày', 'Hồi sinh lần hai', '400 "Không có chuỗi nào để hồi sinh."', 'returning'), rep2.status === 400 && /Không có chuỗi nào để hồi sinh/.test(msg(rep2)), `${rep2.status} ${msg(rep2)}`);
}

// ---------- Vé giữ lửa
{
  // dùng new: nước đủ? new có 65+15+... nhiều; mua vé 40 giọt
  const pb = await prof('uat_new');
  const b = await call('new', 'POST', '/game/streak-freeze/buy');
  const pa = await prof('uat_new');
  check('G-13', mk('Chuỗi ngày', 'Mua vé giữ lửa (game.streak_freeze_cost 40 giọt)', 'Trừ 40 giọt, streakFreezes +1', 'new'), (b.status === 200 || b.status === 201) && pb.seeds - pa.seeds === 40 && pa.freezes === pb.freezes + 1, `${b.status} ${msg(b)} ${short(b.body, 160)}; nước ${pb.seeds}→${pa.seeds}; vé ${pb.freezes}→${pa.freezes}`);
  // lỡ đúng 1 ngày (cách 2 ngày) có vé: chuỗi tiếp tục
  await shiftBack('uat_new', 2);
  const bef = await pointsState('uat_new');
  const before = await prof('uat_new');
  const r = await call('new', 'POST', '/me/daily-check-in');
  const after = await prof('uat_new');
  check('G-14', mk('Chuỗi ngày', 'Lỡ 1 ngày khi còn vé giữ lửa', 'Chuỗi nối tiếp (+1), vé giữ lửa bị dùng (−1)', 'new'), after.streak === before.streak + 1 && after.freezes === before.freezes - 1, `chuỗi ${before.streak}→${after.streak}; vé ${before.freezes}→${after.freezes}; ${r.status}`);
}

// ---------- Sương
{
  const pb = await prof('uat_new');
  const a = await call('new', 'POST', '/game/dew/collect');
  const pa = await prof('uat_new');
  const b = await call('new', 'POST', '/game/dew/collect');
  check('G-15', mk('Giới hạn lượt/ngày', 'Hứng sương hai lần trong ngày', 'Lần 1 +15 giọt (game.dew_seeds); lần 2 400 "Hôm nay bạn đã hứng giọt sương rồi 🌿"', 'new'), (a.status === 200 || a.status === 201) && pa.seeds - pb.seeds === 15 && b.status === 400, `lần 1 ${a.status} +${pa.seeds - pb.seeds}; lần 2 ${b.status} ${msg(b)}`);
}

// ---------- Vòng quay: 10.000 điểm/lượt, 5 lượt/ngày
{
  // đủ điểm cho 6 lượt: dựng đúng 2 dòng (số dư + sổ) trong cùng một giao dịch, như một lần cộng thật
  await sql(`UPDATE users SET "pointsBalance" = "pointsBalance" + 100000 WHERE id='uat_new'`);
  await sql(`INSERT INTO points_transactions (id, "userId", delta, reason, "refType", "refId", lot, "createdAt", "expiresAt") VALUES ('uat_fixture_spin_1', 'uat_new', 100000, 'UAT_FIXTURE_SPIN', 'UAT', 'spin', 'STANDARD', now(), now() + interval '300 days')`);
  const start = await pointsState('uat_new');
  const results = [];
  let okAll = true;
  for (let i = 1; i <= 5; i++) {
    const bef = await pointsState('uat_new');
    const sp = await call('new', 'POST', '/game/spin');
    const aft = await pointsState('uat_new');
    const prize = sp.body?.prize;
    const gain = prize?.rewardType === 'POINTS' ? prize.value : 0;
    const ok = (sp.status === 200 || sp.status === 201) && aft.balance - bef.balance === gain - 10000 && aft.balance === aft.ledgerSum;
    if (!ok) okAll = false;
    results.push(`#${i} ${prize?.name} (${prize?.rewardType}) Δ${aft.balance - bef.balance}${ok ? '' : ' LỆCH ' + sp.status + ' ' + msg(sp)}`);
  }
  const spins = (await sql(`SELECT count(*)::int AS n FROM game_spins WHERE "userId"='uat_new'`))[0].n;
  check('G-20', mk('Vòng quay', 'Quay 5 lượt liên tiếp', 'Mỗi lượt trừ 10.000 (sổ GAME_SPIN_COST), cộng đúng giải điểm nếu trúng điểm (GAME_SPIN_WIN), giải nước vào bình, giải voucher có phiếu; số dư = tổng sổ sau MỖI lượt; 5 dòng game_spins', 'new'), okAll && spins === 5, results.join(' | ') + `; game_spins ${spins}`);
  const bef = await pointsState('uat_new');
  const six = await call('new', 'POST', '/game/spin');
  const aft = await pointsState('uat_new');
  check('G-21', mk('Giới hạn lượt/ngày', 'Quay lượt thứ 6 trong ngày', '400 "Bạn đã quay đủ 5 lượt hôm nay. Hẹn bạn ngày mai nhé!" và KHÔNG trừ 10.000 (giao dịch huỷ); số dư không đổi', 'new'),
    six.status === 400 && /Bạn đã quay đủ 5 lượt hôm nay. Hẹn bạn ngày mai nhé!/.test(msg(six)) && bef.balance === aft.balance && aft.balance === aft.ledgerSum, `${six.status} ${msg(six)}; số dư ${bef.balance}→${aft.balance} sổ ${aft.ledgerSum}`);
  const poor = await call('new_nophone', 'POST', '/game/spin');
  const poor2 = await call('ctv_pending', 'POST', '/game/spin');
  check('G-22', mk('Vòng quay', 'Khách 0 điểm quay', '400 "Cần 10.000 Điểm Xanh để quay."', 'ctv_pending'), poor2.status === 400 && /Cần 10\.000 Điểm Xanh để quay\./.test(msg(poor2)), `${poor2.status} ${msg(poor2)}`);
  const coup = await sql(`SELECT count(*)::int AS n FROM game_spins WHERE "userId"='uat_new' AND "rewardType"='COUPON'`);
  console.log('trúng voucher:', coup[0].n);
}

// ---------- Đố vui
{
  const q = await call('returning', 'GET', '/game/quiz/today');
  check('G-30', mk('Đố vui', 'Lấy câu đố hôm nay', '200, có câu hỏi và các lựa chọn (không lộ đáp án đúng trong dữ liệu trả về)', 'returning'), q.status === 200 && !JSON.stringify(q.body).includes('"correct'), short(q.body, 400));
}

// ---------- Cổng
{
  const g = await call(undefined, 'GET', '/game/profile');
  check('G-40', mk('Cổng', 'Không đăng nhập mở hồ sơ Vườn', '401', 'guest'), g.status === 401, `${g.status}`);
  const t = await call('new_nophone', 'POST', '/me/daily-check-in');
  check('G-41', mk('Cổng', 'Khách chưa có SĐT điểm danh', 'Giọt nước vẫn nhận; Điểm Xanh bị chặn kèm pointsBlocked (pointsBlockedFor) hoặc 403: ghi nhận thực tế', 'new_nophone'), 'NEEDOWNER', `${t.status} ${short(t.body, 300)}`);
}

await closeDb();
