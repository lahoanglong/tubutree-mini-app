// Ranh giới ngày giờ Việt Nam (UTC+7): đặt hoạt động của "tối qua 23:30 giờ VN" rồi kiểm tra hôm nay tính là ngày mới.
// Chỉ phân biệt được lỗi dùng ngày UTC khi giờ chạy nằm trong 00:00-07:00 giờ VN (ngày VN đã sang, ngày UTC chưa): script ghi rõ điều kiện này.
// Chạy trên lane vừa chạy 60-race.mjs. Chạy: node 80-tz.mjs
import { call, sql, pointsState, check, short, msg, closeDb, vnToday } from './l4lib.mjs';

const mk = (journey, step, expected, persona = '') => ({ persona, viewport: 'API', journey, step, expected });
const now = new Date();
const VN = 7 * 3600_000;
const vnMidnight = new Date(Math.floor((now.getTime() + VN) / 86_400_000) * 86_400_000 - VN);
const lateYesterday = new Date(vnMidnight.getTime() - 30 * 60_000); // 23:30 hôm qua giờ VN
const iso = (d) => d.toISOString().replace('T', ' ').slice(0, 19);
const vnKey = (d) => new Date(d.getTime() + VN).toISOString().slice(0, 10);
const discriminating = vnKey(now) !== now.toISOString().slice(0, 10);
const cond = discriminating ? 'phép thử phân biệt được ngày VN với ngày UTC' : 'CHÚ Ý: giờ chạy ngoài 00:00-07:00 VN nên không phân biệt được lỗi dùng ngày UTC';
console.log(`bây giờ ${now.toISOString()} (VN ${vnKey(now)}); tối qua 23:30 VN = ${lateYesterday.toISOString()}; ${cond}`);

// ---------- TZ-01 vòng quay: 5 lượt "tối qua 23:30" không được tính vào hôm nay
{
  const u = 'uat_cskh';
  await sql(`UPDATE users SET "pointsBalance" = "pointsBalance" + 100000 WHERE id='${u}'`);
  await sql(`INSERT INTO points_transactions (id, "userId", delta, reason, "refType", "refId", lot, "createdAt", "expiresAt") VALUES ('uat_fixture_tz_spin', '${u}', 100000, 'UAT_FIXTURE_SPIN', 'UAT', 'tz', 'STANDARD', now(), now() + interval '300 days')`);
  for (let i = 0; i < 5; i++) await sql(`INSERT INTO game_spins (id, "userId", "prizeId", "prizeName", "prizeValue", "rewardType", "spunAt") VALUES ('uat_tz_spin_${i}', '${u}', 'p-none', 'Chúc may mắn', 0, 'NONE', '${iso(lateYesterday)}')`);
  const rs = [];
  for (let i = 0; i < 5; i++) rs.push(await call('cskh', 'POST', '/game/spin'));
  const sixth = await call('cskh', 'POST', '/game/spin');
  const st = await pointsState(u);
  check('TZ-01', mk('Ranh giới ngày VN', '5 lượt quay lúc 23:30 hôm qua giờ VN, rồi quay hôm nay', 'Hôm nay vẫn quay đủ 5 lượt (ngày VN mới); lượt thứ 6 mới bị chặn; số dư = tổng sổ', 'cskh'),
    rs.every((r) => r.status === 201 || r.status === 200) && sixth.status === 400 && st.balance === st.ledgerSum, `${rs.map((r) => r.status).join(',')} / lượt 6: ${sixth.status} ${msg(sixth)}; ${cond}; số dư ${st.balance} sổ ${st.ledgerSum}`);
}

// ---------- TZ-02 hứng sương: lần hứng "tối qua 23:30"
{
  const u = 'uat_cskh';
  await sql(`UPDATE game_profiles SET "lastDewAt" = '${iso(lateYesterday)}' WHERE "userId"='${u}'`);
  const before = (await sql(`SELECT "totalSeeds" AS s FROM game_profiles WHERE "userId"='${u}'`))[0].s;
  const r = await call('cskh', 'POST', '/game/dew/collect');
  const after = (await sql(`SELECT "totalSeeds" AS s FROM game_profiles WHERE "userId"='${u}'`))[0].s;
  check('TZ-02', mk('Ranh giới ngày VN', 'Hứng sương lúc 23:30 hôm qua giờ VN, hôm nay hứng lại', 'Hôm nay hứng được +15 giọt (ngày VN mới)', 'cskh'), (r.status === 201 || r.status === 200) && after - before === 15, `${r.status} ${msg(r)}; giọt ${before}→${after}; ${cond}`);
}

// ---------- TZ-03 chuỗi điểm danh: điểm danh 23:30 hôm qua giờ VN, hôm nay điểm danh tiếp = ngày 2
{
  const u = 'uat_kho';
  const first = await call('kho', 'POST', '/me/daily-check-in');
  const yKey = vnKey(lateYesterday);
  await sql(`UPDATE loyalty_check_ins SET "dayKey" = '${yKey}', "createdAt" = '${iso(lateYesterday)}' WHERE "userId"='${u}'`);
  await sql(`UPDATE points_transactions SET "refId" = '${yKey}', "createdAt" = '${iso(lateYesterday)}' WHERE "userId"='${u}' AND "refType"='CHECKIN'`);
  await sql(`UPDATE game_profiles SET "lastCheckInAt" = '${iso(lateYesterday)}' WHERE "userId"='${u}'`);
  const bef = await pointsState(u);
  const second = await call('kho', 'POST', '/me/daily-check-in');
  const aft = await pointsState(u);
  const prof = (await sql(`SELECT "streakDays" AS s FROM game_profiles WHERE "userId"='${u}'`))[0].s;
  check('TZ-03', mk('Ranh giới ngày VN', 'Điểm danh lúc 23:30 hôm qua giờ VN, hôm nay điểm danh tiếp', 'Tính là ngày liền kề: chuỗi 2, cộng 1.000 Điểm Xanh ngày 2 (DAILY_CHECKIN:DAY_2); không báo "đã điểm danh hôm nay"', 'kho'),
    (second.status === 201 || second.status === 200) && prof === 2 && aft.balance - bef.balance === 1000 && aft.balance === aft.ledgerSum, `lần 1 ${first.status}; lần 2 ${second.status} ${short(second.body, 180)}; chuỗi ${prof}; ${bef.balance}→${aft.balance} sổ ${aft.ledgerSum}; ${cond}`);
}

// ---------- TZ-04 thưởng đăng bài: dòng thưởng lúc 23:30 hôm qua không chiếm trần hôm nay
{
  const u = 'uat_ketoan';
  await sql(`UPDATE users SET "pointsBalance" = "pointsBalance" + 1000 WHERE id='${u}'`);
  await sql(`INSERT INTO points_transactions (id, "userId", delta, reason, "refType", "refId", lot, "createdAt", "expiresAt") VALUES ('uat_fixture_tz_post', '${u}', 1000, 'COMMUNITY_POST:uat_tz_old', 'COMMUNITY', 'uat_tz_old', 'STANDARD', '${iso(lateYesterday)}', now() + interval '300 days')`);
  const catId = (await call('ketoan', 'GET', '/feed/categories')).body?.[0]?.id;
  const bef = await pointsState(u);
  const p = await call('ketoan', 'POST', '/feed', { categoryId: catId, kind: 'MANUAL', body: 'Bài đăng đầu ngày mới để thử trần thưởng 1 bài mỗi ngày.' });
  const aft = await pointsState(u);
  check('TZ-04', mk('Ranh giới ngày VN', 'Đã nhận thưởng đăng bài lúc 23:30 hôm qua giờ VN, hôm nay đăng bài', 'Hôm nay vẫn được thưởng 1.000 (trần 1 bài/ngày tính theo ngày VN); số dư = tổng sổ', 'ketoan'),
    p.status === 201 && p.body?.status === 'PUBLISHED' && aft.balance - bef.balance === 1000 && aft.balance === aft.ledgerSum, `${p.status} ${short(p.body, 100)}; ${bef.balance}→${aft.balance} sổ ${aft.ledgerSum}; ${cond}`);
}

await closeDb();
