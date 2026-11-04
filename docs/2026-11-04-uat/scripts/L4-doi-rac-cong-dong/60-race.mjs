// Đua song song (Promise.all) trên các thao tác cộng/trừ điểm: điểm danh, vòng quay, đổi quà, quà tồn kho 1, xác nhận cân, thu hồi, huỷ-vs-xác nhận,
// trần khai báo ngày, câu trả lời hay nhất, thưởng đăng bài, giọt nước (vé giữ lửa, hứng sương), nhiệm vụ 7 ngày, idempotency.
// Chạy sau 40-community-api.mjs trên cùng lane (dùng người dùng ít bị đụng: brand, ketoan, marketing, kho, dealer). Chạy: node 60-race.mjs
import { call, idem, sql, pointsState, ledgerRows, check, short, msg, readParams, closeDb } from './l4lib.mjs';

const P = readParams();
const only = process.argv.slice(2);
const want = (id) => only.length === 0 || only.includes(id);
const mk = (journey, step, expected, persona = '') => ({ persona, viewport: 'API', journey, step, expected });
const par = (n, fn) => Promise.all(Array.from({ length: n }, (_, i) => fn(i)));
const okc = (r) => r.status === 200 || r.status === 201;
const prof = async (u) => (await sql(`SELECT "totalSeeds" AS seeds, "streakFreezes" AS freezes, "streakDays" AS streak FROM game_profiles WHERE "userId"='${u}'`))[0] ?? { seeds: 0, freezes: 0, streak: 0 };
const cnt = async (q) => (await sql(q))[0].n;
const tally = (rs) => rs.map((r) => r.status).sort().join(',');

async function shiftBack(u, days = 1) {
  await sql(`UPDATE loyalty_check_ins SET "dayKey" = 'S' || to_char(("dayKey"::date - ${days}), 'YYYY-MM-DD') WHERE "userId"='${u}' AND "dayKey" NOT LIKE 'S%'`);
  await sql(`UPDATE loyalty_check_ins SET "dayKey" = substr("dayKey", 2) WHERE "userId"='${u}' AND "dayKey" LIKE 'S%'`);
  await sql(`UPDATE points_transactions SET "refId" = 'S' || to_char(("refId"::date - ${days}), 'YYYY-MM-DD') WHERE "userId"='${u}' AND "refType"='CHECKIN' AND "refId" NOT LIKE 'S%'`);
  await sql(`UPDATE points_transactions SET "refId" = substr("refId", 2) WHERE "userId"='${u}' AND "refType"='CHECKIN' AND "refId" LIKE 'S%'`);
  await sql(`UPDATE game_profiles SET "lastCheckInAt" = "lastCheckInAt" - interval '${days} days' WHERE "userId"='${u}'`);
}

// ---------- R-01 điểm danh song song
{
  const bef = await pointsState('uat_brand');
  const s0 = (await prof('uat_brand')).seeds;
  const rs = await par(6, () => call('brand', 'POST', '/me/daily-check-in'));
  const aft = await pointsState('uat_brand');
  const rows = await cnt(`SELECT count(*)::int AS n FROM points_transactions WHERE "userId"='uat_brand' AND "refType"='CHECKIN'`);
  const ci = await cnt(`SELECT count(*)::int AS n FROM loyalty_check_ins WHERE "userId"='uat_brand'`);
  const s1 = (await prof('uat_brand')).seeds;
  check('R-01', mk('Đua song song', '6 lượt điểm danh cùng lúc cùng một khách (chưa điểm danh hôm nay)', 'Đúng 1 lần cộng 1.000 Điểm Xanh + 65 giọt nước: 1 dòng sổ CHECKIN, 1 dòng loyalty_check_ins; số dư = tổng sổ', 'brand'),
    aft.balance - bef.balance === 1000 && rows === 1 && ci === 1 && s1 - s0 === 65 && aft.balance === aft.ledgerSum, `mã trả ${tally(rs)}; ${bef.balance}→${aft.balance} sổ ${aft.ledgerSum}; dòng sổ CHECKIN ${rows}; check_ins ${ci}; giọt ${s0}→${s1}`);
}

// ---------- R-02 vé giữ lửa song song (giọt nước 65, vé 40)
{
  const p0 = await prof('uat_brand');
  const rs = await par(4, () => call('brand', 'POST', '/game/streak-freeze/buy'));
  const p1 = await prof('uat_brand');
  const wins = rs.filter(okc).length;
  check('R-02', mk('Đua song song', '4 lượt mua vé giữ lửa cùng lúc khi chỉ đủ giọt cho 1 vé (65 giọt, vé 40)', 'Đúng 1 vé: giọt 65→25, không âm; số vé tăng đúng số lần thành công', 'brand'),
    wins === 1 && p1.seeds === p0.seeds - 40 && p1.seeds >= 0 && p1.freezes - p0.freezes === wins, `mã ${tally(rs)}; giọt ${p0.seeds}→${p1.seeds}; vé ${p0.freezes}→${p1.freezes}`);
}

// ---------- R-03 hứng sương song song
{
  const p0 = await prof('uat_brand');
  const rs = await par(5, () => call('brand', 'POST', '/game/dew/collect'));
  const p1 = await prof('uat_brand');
  const wins = rs.filter(okc).length;
  check('R-03', mk('Đua song song', '5 lượt hứng sương cùng lúc (1 lần/ngày, +15 giọt)', 'Đúng 1 lần +15 giọt', 'brand'), wins === 1 && p1.seeds - p0.seeds === 15, `mã ${tally(rs)}; giọt ${p0.seeds}→${p1.seeds}`);
}

// ---------- R-04 vòng quay song song (đủ điểm cho 8 lượt, trần 5/ngày)
{
  await sql(`UPDATE users SET "pointsBalance" = "pointsBalance" + 100000 WHERE id='uat_ketoan'`);
  await sql(`INSERT INTO points_transactions (id, "userId", delta, reason, "refType", "refId", lot, "createdAt", "expiresAt") VALUES ('uat_fixture_spin_race', 'uat_ketoan', 100000, 'UAT_FIXTURE_SPIN', 'UAT', 'race', 'STANDARD', now(), now() + interval '300 days')`);
  const bef = await pointsState('uat_ketoan');
  const rs = await par(8, () => call('ketoan', 'POST', '/game/spin'));
  const aft = await pointsState('uat_ketoan');
  const spins = await cnt(`SELECT count(*)::int AS n FROM game_spins WHERE "userId"='uat_ketoan'`);
  const costs = await cnt(`SELECT count(*)::int AS n FROM points_transactions WHERE "userId"='uat_ketoan' AND reason='GAME_SPIN_COST'`);
  const wins = rs.filter(okc).length;
  check('R-04', mk('Đua song song', '8 lượt quay cùng lúc (trần 5 lượt/ngày, mỗi lượt 10.000)', 'Tối đa 5 lượt thành công; số dòng game_spins = số dòng GAME_SPIN_COST = số lượt thành công; số dư = tổng sổ', 'ketoan'),
    wins <= 5 && spins === wins && costs === wins && aft.balance === aft.ledgerSum, `mã ${tally(rs)}; thành công ${wins}; game_spins ${spins}; dòng COST ${costs}; ${bef.balance}→${aft.balance} sổ ${aft.ledgerSum}`);
}

// ---------- R-05 đổi quà điểm: trừ kép
{
  const bef = await pointsState('uat_returning');
  const rs = await par(5, (i) => call('returning', 'POST', '/me/loyalty/rewards/reward-freeship/redeem', undefined, idem(`dbl${i}`)));
  const aft = await pointsState('uat_returning');
  const wins = rs.filter(okc).length;
  const spent = bef.balance - aft.balance;
  check('R-05', mk('Đua song song', '5 lượt đổi phiếu Miễn phí vận chuyển (20.000) cùng lúc, khác idempotency-key, ví đủ cho ' + Math.floor(bef.balance / 20000) + ' lượt', 'Số lượt thành công ≤ ví cho phép; số dư không âm; trừ đúng 20.000 × số lượt thành công; số dư = tổng sổ', 'returning'),
    wins <= Math.floor(bef.balance / 20000) && aft.balance >= 0 && spent === wins * 20000 && aft.balance === aft.ledgerSum, `mã ${tally(rs)}; ${bef.balance}→${aft.balance} sổ ${aft.ledgerSum}; thành công ${wins}`);
}

// ---------- R-06 cùng idempotency-key song song
{
  const key = `l4-same-${Date.now()}`;
  const bef = await pointsState('uat_new');
  const rs = await par(5, () => call('new', 'POST', '/me/loyalty/rewards/reward-freeship/redeem', undefined, { 'idempotency-key': key }));
  const aft = await pointsState('uat_new');
  const ids = new Set(rs.map((r) => r.body?.redemption?.id ?? r.body?.id));
  check('R-06', mk('Đua song song', '5 lượt đổi phiếu cùng một idempotency-key bắn cùng lúc', 'Chỉ trừ 20.000 một lần (idempotency giữ được dưới đua song song); số dư = tổng sổ', 'new'),
    bef.balance - aft.balance === 20000 && aft.balance === aft.ledgerSum, `mã ${tally(rs)}; ${bef.balance}→${aft.balance} sổ ${aft.ledgerSum}; id khác nhau ${ids.size}`);
}

// ---------- R-07 quà hiện vật tồn kho 1, 3 khách cùng lúc
let giftId;
{
  const g = await call('admin', 'POST', '/admin/waste/gifts', { kind: 'GIFT', name: 'Quà đua tồn kho (UAT)', description: 'Thử đua tồn kho', pointsCost: 100, status: 'ACTIVE', stock: 1, claimInstructions: 'Nhận tại kho' });
  giftId = g.body?.id;
  const users = ['new', 'returning', 'admin'];
  const before = {};
  for (const u of users) before[u] = await pointsState(`uat_${u}`);
  const rs = await Promise.all(users.map((u, i) => call(u, 'POST', `/me/loyalty/rewards/${giftId}/redeem`, undefined, idem(`stock${i}`))));
  const wins = rs.filter(okc).length;
  const after = {};
  for (const u of users) after[u] = await pointsState(`uat_${u}`);
  const stock = (await sql(`SELECT stock FROM waste_gifts WHERE id='${giftId}'`))[0].stock;
  const redemptions = await cnt(`SELECT count(*)::int AS n FROM waste_gift_redemptions WHERE "giftId"='${giftId}' AND status <> 'CANCELLED'`);
  const spent = users.reduce((s, u) => s + (before[u].balance - after[u].balance), 0);
  check('R-07', mk('Đua song song', 'Quà hiện vật tồn kho 1 (100 điểm), 3 khách bấm đổi cùng lúc', 'Đúng 1 khách đổi được; tồn kho = 0 (không âm); 1 lượt đổi; tổng trừ 100; số dư mọi người = tổng sổ', 'new+returning+admin'),
    wins === 1 && stock === 0 && redemptions === 1 && spent === 100 && users.every((u) => after[u].balance === after[u].ledgerSum), `mã ${tally(rs)}; tồn ${stock}; lượt đổi ${redemptions}; tổng trừ ${spent}`);
  P.raceGiftCode = rs.find(okc)?.body?.redemption?.code;
}

// ---------- R-08 trao quà song song
{
  const code = P.raceGiftCode;
  const rs = code ? await par(3, () => call('staff', 'POST', '/waste/desk/gifts/fulfil', { code, pointId: P.whId })) : [];
  const done = code ? await cnt(`SELECT count(*)::int AS n FROM waste_gift_redemptions WHERE code='${code}' AND status='FULFILLED'`) : -1;
  check('R-08', mk('Đua song song', '3 nhân viên quầy bấm trao cùng một mã quà cùng lúc', 'Đúng 1 lần trao thành công, các lần còn lại 409', 'staff'), rs.filter(okc).length === 1 && done === 1, `mã ${tally(rs)}; trạng thái FULFILLED ${done}`);
}

// ---------- R-09 xác nhận cân song song (staff x3 + admin x2) rồi thu hồi song song
let reqId;
{
  const c = await call('brand', 'POST', '/waste/requests', { consent: true, method: 'DROP_OFF', pointId: P.whId, lines: [{ itemId: 'wi-bubble-wrap', declaredQty: 2 }] }, idem('r9'));
  reqId = c.body?.id;
  const lines = [{ itemId: 'wi-bubble-wrap', declaredQty: 2, receivedQty: 2 }];
  const bef = await pointsState('uat_brand');
  const rs = await Promise.all([
    ...[0, 1, 2].map(() => call('staff', 'POST', `/waste/desk/requests/${reqId}/confirm`, { lines })),
    ...[0, 1].map(() => call('admin', 'POST', `/admin/waste/requests/${reqId}/confirm`, { lines })),
  ]);
  const aft = await pointsState('uat_brand');
  const credits = await cnt(`SELECT count(*)::int AS n FROM points_transactions WHERE "userId"='uat_brand' AND "refId"='${reqId}' AND delta > 0`);
  check('R-09', mk('Đua song song', 'Cùng một yêu cầu, 3 lượt staff + 2 lượt admin xác nhận cân cùng lúc (2 nilon = 2.000 điểm)', 'Cộng đúng 1 lần 2.000: 1 dòng sổ dương theo yêu cầu; số dư = tổng sổ', 'staff+admin'),
    aft.balance - bef.balance === 2000 && credits === 1 && aft.balance === aft.ledgerSum, `mã ${tally(rs)}; ${bef.balance}→${aft.balance} sổ ${aft.ledgerSum}; dòng cộng ${credits}`);
  const bef2 = await pointsState('uat_brand');
  const rv = await par(4, () => call('admin', 'POST', `/admin/waste/requests/${reqId}/reverse`, { reason: 'UAT thu hồi đua' }));
  const aft2 = await pointsState('uat_brand');
  const neg = await cnt(`SELECT count(*)::int AS n FROM points_transactions WHERE "userId"='uat_brand' AND "refId"='${reqId}' AND delta < 0`);
  check('R-10', mk('Đua song song', '4 lượt thu hồi điểm cùng lúc cùng một yêu cầu', 'Trừ đúng 1 lần 2.000 (1 dòng sổ âm); số dư = tổng sổ', 'admin'),
    bef2.balance - aft2.balance === 2000 && neg === 1 && aft2.balance === aft2.ledgerSum, `mã ${tally(rv)}; ${bef2.balance}→${aft2.balance} sổ ${aft2.ledgerSum}; dòng âm ${neg}`);
}

// ---------- R-11 huỷ vs xác nhận cùng lúc (6 lần)
{
  const bad = [];
  const outs = [];
  for (let i = 0; i < 6; i++) {
    const c = await call('brand', 'POST', '/waste/requests', { consent: true, method: 'DROP_OFF', pointId: P.whId, lines: [{ itemId: 'wi-bubble-wrap', declaredQty: 1 }] }, idem(`cx${i}`));
    if (!c.body?.id) { bad.push(`tạo lỗi ${c.status} ${msg(c)}`); continue; }
    const id = c.body.id;
    const [a, b] = await Promise.all([
      call('brand', 'POST', `/waste/requests/${id}/cancel`),
      call('staff', 'POST', `/waste/desk/requests/${id}/confirm`, { lines: [{ itemId: 'wi-bubble-wrap', declaredQty: 1, receivedQty: 1 }] }),
    ]);
    const st = (await sql(`SELECT status::text AS s FROM waste_requests WHERE id='${id}'`))[0].s;
    const credits = await cnt(`SELECT count(*)::int AS n FROM points_transactions WHERE "userId"='uat_brand' AND "refId"='${id}' AND delta > 0`);
    outs.push(`${st}/cộng ${credits} (huỷ ${a.status}, xác nhận ${b.status})`);
    if ((st === 'CANCELLED' && credits > 0) || (st === 'COMPLETED' && credits !== 1) || (!['CANCELLED', 'COMPLETED'].includes(st))) bad.push(`${id}: ${st} cộng ${credits}`);
  }
  const fin = await pointsState('uat_brand');
  check('R-11', mk('Đua song song', 'Khách huỷ và nhân viên xác nhận cùng lúc, lặp 6 yêu cầu', 'Mỗi yêu cầu kết thúc nhất quán: CANCELLED không có điểm, hoặc COMPLETED có đúng 1 dòng cộng; không có yêu cầu vừa huỷ vừa được cộng', 'brand+staff'),
    bad.length === 0 && fin.balance === fin.ledgerSum, `${outs.join(' | ')}; bất thường: ${bad.join(' ; ') || 'không'}; số dư ${fin.balance} sổ ${fin.ledgerSum}`);
}

// ---------- R-12 trần khai báo trong ngày (carton ≤ 10, tối đa 3 yêu cầu mở)
{
  const rs = await par(5, (i) => call('marketing', 'POST', '/waste/requests', { consent: true, method: 'DROP_OFF', pointId: P.whId, lines: [{ itemId: 'wi-carton', declaredQty: 6 }] }, idem(`cap${i}`)));
  const sumQty = await cnt(`SELECT COALESCE(sum(l."declaredQty"),0)::int AS n FROM waste_request_lines l JOIN waste_requests r ON r.id=l."requestId" WHERE r."userId"='uat_marketing' AND l."itemId"='wi-carton' AND r.status::text NOT IN ('CANCELLED','REJECTED','EXPIRED')`);
  const wins = rs.filter(okc).length;
  check('R-12', mk('Đua song song', '5 yêu cầu carton × 6 cùng lúc (trần carton 10/ngày, tối đa 3 yêu cầu mở)', 'Tổng carton khai trong ngày ≤ 10 (đúng 1 yêu cầu qua)', 'marketing'), sumQty <= 10 && wins === 1, `mã ${tally(rs)}; tổng carton đang khai ${sumQty}; yêu cầu qua ${wins}`);
}

// ---------- R-13 tạo yêu cầu cùng idempotency-key song song
{
  const key = `l4-rq-${Date.now()}`;
  const rs = await par(5, () => call('kho', 'POST', '/waste/requests', { consent: true, method: 'DROP_OFF', pointId: P.whId, lines: [{ itemId: 'wi-tubu-bottle', declaredQty: 1 }] }, { 'idempotency-key': key }));
  const n = await cnt(`SELECT count(*)::int AS n FROM waste_requests WHERE "userId"='uat_kho'`);
  check('R-13', mk('Đua song song', '5 lượt tạo yêu cầu cùng idempotency-key bắn cùng lúc', 'Chỉ tạo 1 yêu cầu', 'kho'), n === 1, `mã ${tally(rs)}; số yêu cầu của khách ${n}`);
}

// ---------- R-14 câu trả lời hay nhất: chọn hai bình luận khác nhau cùng lúc
{
  const q = await call('returning', 'POST', '/feed', { categoryId: (await call('returning', 'GET', '/feed/categories')).body?.[0]?.id, kind: 'QUESTION', title: 'Thử đua câu trả lời hay nhất', body: 'Hai người cùng trả lời, mình chọn cùng lúc.' });
  const qid = q.body?.id;
  const a = await call('dealer', 'POST', `/feed/${qid}/comments`, { body: 'Trả lời A từ đại lý.' });
  const b = await call('ketoan', 'POST', `/feed/${qid}/comments`, { body: 'Trả lời B từ kế toán.' });
  const bA = await pointsState('uat_dealer');
  const bB = await pointsState('uat_ketoan');
  const rs = await Promise.all([a, a, a, b, b, b].map((c) => call('returning', 'POST', `/feed/${qid}/best-answer/${c.body?.id}`)));
  const aA = await pointsState('uat_dealer');
  const aB = await pointsState('uat_ketoan');
  const paid = (aA.balance - bA.balance) + (aB.balance - bB.balance);
  const rows = await cnt(`SELECT count(*)::int AS n FROM points_transactions WHERE reason = 'COMMUNITY_BEST:${qid}'`);
  const best = (await sql(`SELECT "bestCommentId" AS b FROM feed_posts WHERE id='${qid}'`))[0].b;
  check('R-14', mk('Đua song song', 'Tác giả chọn câu trả lời hay nhất của hai người khác nhau cùng lúc (3 + 3 lượt)', 'Chỉ một câu được chọn; thưởng 1.000 chỉ trả cho một người, một lần; số dư = tổng sổ', 'returning'),
    paid === 1000 && rows === 1 && !!best && aA.balance === aA.ledgerSum && aB.balance === aB.ledgerSum, `mã ${tally(rs)}; bestCommentId ${best}; tổng thưởng ${paid}; dòng sổ ${rows}`);
}

// ---------- R-15 thưởng đăng bài song song (trần 1/ngày)
{
  const catId = (await call('kho', 'GET', '/feed/categories')).body?.[0]?.id;
  const bef = await pointsState('uat_kho');
  const rs = await par(5, (i) => call('kho', 'POST', '/feed', { categoryId: catId, kind: 'MANUAL', body: `Bài đua số ${i}: chia sẻ cách phân loại rác nhựa tại nhà.` }));
  const aft = await pointsState('uat_kho');
  const rows = await cnt(`SELECT count(*)::int AS n FROM points_transactions WHERE "userId"='uat_kho' AND reason LIKE 'COMMUNITY_POST:%'`);
  const pub = rs.filter((r) => r.body?.status === 'PUBLISHED').length;
  check('R-15', mk('Đua song song', '5 bài đăng cùng lúc của một người dùng tin cậy chưa đăng hôm nay (thưởng 1.000, trần 1 bài/ngày)', pub === 0 ? 'Không đo được nếu không được đăng ngay' : 'Tối đa 1 lần thưởng 1.000', 'kho'),
    pub === 0 ? 'BLOCKED' : rows <= 1 && aft.balance - bef.balance <= 1000 && aft.balance === aft.ledgerSum, `mã ${tally(rs)}; PUBLISHED ${pub}; dòng thưởng ${rows}; ${bef.balance}→${aft.balance} sổ ${aft.ledgerSum}`);
}

// ---------- R-16 bình luận trùng song song
{
  const catId = (await call('returning', 'GET', '/feed/categories')).body?.[0]?.id;
  const q = await call('returning', 'POST', '/feed', { categoryId: catId, kind: 'MANUAL', body: 'Bài thử bình luận trùng song song.' });
  const rs = await par(5, () => call('dealer', 'POST', `/feed/${q.body?.id}/comments`, { body: 'Bình luận gửi trùng cùng lúc.' }));
  const n = await cnt(`SELECT count(*)::int AS n FROM feed_comments WHERE "postId"='${q.body?.id}' AND "userId"='uat_dealer'`);
  check('R-16', mk('Đua song song', '5 lượt gửi cùng một bình luận cùng lúc (chống trùng trong 10 giây)', 'Chỉ 1 bình luận trong DB', 'dealer'), n === 1, `mã ${tally(rs)}; dòng ${n}`);
  const likes = await par(7, () => call('dealer', 'POST', `/feed/${q.body?.id}/react`));
  const rows = await cnt(`SELECT count(*)::int AS n FROM feed_reactions WHERE "postId"='${q.body?.id}'`);
  const lc = (await sql(`SELECT "likeCount" AS n FROM feed_posts WHERE id='${q.body?.id}'`))[0].n;
  check('R-17', mk('Đua song song', '7 lượt bấm thích cùng lúc của một người', 'likeCount khớp số dòng feed_reactions (0 hoặc 1), không lệch', 'dealer'), lc === rows && rows <= 1, `mã ${tally(likes)}; dòng cảm xúc ${rows}; likeCount ${lc}`);
}

// ---------- R-18 nhiệm vụ 7 ngày nhận song song
{
  const u = 'dealer';
  const bef0 = await pointsState('uat_dealer');
  for (let i = 0; i < 7; i++) {
    await call(u, 'POST', '/me/daily-check-in');
    if (i < 6) await shiftBack('uat_dealer', 1);
  }
  const bef = await pointsState('uat_dealer');
  const rs = await par(5, () => call(u, 'POST', '/game/missions/CHECKIN_7/claim'));
  const aft = await pointsState('uat_dealer');
  const rows = await cnt(`SELECT count(*)::int AS n FROM points_transactions WHERE "userId"='uat_dealer' AND reason LIKE 'MISSION:CHECKIN_7%'`);
  check('R-18', mk('Đua song song', 'Chuỗi 7 ngày xong, 5 lượt nhận thưởng Chăm chỉ 7 ngày (30.000) cùng lúc', 'Cộng đúng 1 lần 30.000; 1 dòng sổ MISSION:CHECKIN_7; số dư = tổng sổ', 'dealer'),
    aft.balance - bef.balance === 30000 && rows === 1 && aft.balance === aft.ledgerSum, `mã ${tally(rs)}; ${bef.balance}→${aft.balance} sổ ${aft.ledgerSum}; dòng ${rows} (số dư đầu ${bef0.balance})`);
}

await closeDb();
