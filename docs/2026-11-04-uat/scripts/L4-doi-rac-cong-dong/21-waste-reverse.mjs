// Đổi rác (phần 2): thu hồi điểm, thu gom kèm đơn. Chạy sau 20-waste-desk.mjs.
// (cũ) quầy xác nhận cân, cộng điểm, đối chiếu sổ; hạn mức tháng; quà đổi điểm; hết hạn nhận quà; hết hạn giữ chỗ; tin nhắc.
// Chạy sau 00-setup.mjs và 10-waste-api.mjs (lấy id yêu cầu ở params.json). Chạy: node 20-waste-desk.mjs
import { execFileSync } from 'node:child_process';
import { call, idem, sql, sleep, pointsState, ledgerRows, check, short, msg, toneIssues, readParams, saveParams, closeDb, H, WT } from './l4lib.mjs';

const P = readParams();
const mk = (journey, step, expected, persona = '', viewport = 'API') => ({ persona, viewport, journey, step, expected });
const confirm = (user, route, id, lines, extra = {}) => call(user, 'POST', route === 'DESK' ? `/waste/desk/requests/${id}/confirm` : `/admin/waste/requests/${id}/confirm`, { lines, ...extra });
const runJob = (job, args) => {
  const out = execFileSync('node', [`${H}/run-job.mjs`, '4', job, ...(args ? ['--args', JSON.stringify(args)] : [])], { cwd: WT, env: process.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return out.trim().slice(-400);
};
const notifs = (userId, code) => sql(`SELECT "templateCode", payload::text AS payload, status FROM notification_logs WHERE "userId"='${userId}' AND "templateCode"='${code}' ORDER BY "sentAt"`);
const gameSeeds = async (u) => (await sql(`SELECT "totalSeeds" AS s FROM game_profiles WHERE "userId"='${u}'`))[0]?.s ?? 0;

// ---------- Thu hồi điểm (dựng yêu cầu mới rồi thu hồi, để chạy lại được)
const mkDone = async (user, qty, tag, itemId = 'wi-bubble-wrap') => {
  const c = await call(user, 'POST', '/waste/requests', { consent: true, method: 'DROP_OFF', pointId: P.whId, lines: [{ itemId, declaredQty: qty }] }, idem(tag));
  const f = await call('staff', 'POST', `/waste/desk/requests/${c.body.id}/confirm`, { lines: [{ itemId, declaredQty: qty, receivedQty: qty }] });
  return { id: c.body.id, code: c.body.code, created: c.status, confirmed: f.status, awarded: f.body?.pointsAwarded };
};
{
  const rq = await mkDone('returning', 2, 'rv1');
  const bef = await pointsState('uat_returning');
  const r = await call('admin', 'POST', `/admin/waste/requests/${rq.id}/reverse`, { reason: 'UAT thử thu hồi do khai khống' });
  const aft = await pointsState('uat_returning');
  const led = await ledgerRows('uat_returning', `AND "refId"='${rq.id}' AND delta < 0`);
  const st = (await sql(`SELECT status::text AS status, "reversalShortfallPoints" AS short FROM waste_requests WHERE id='${rq.id}'`))[0];
  const n = await notifs('uat_returning', 'WASTE_POINTS_REVERSED');
  check('D-90', mk('Thu hồi điểm', 'Staff cộng 2.000 cho yêu cầu mới của returning, admin thu hồi (ví đủ)', 'Trừ đúng 2.000: sổ có dòng âm refId=<yêu cầu>, status REVERSED, shortfall 0, tin WASTE_POINTS_REVERSED "Tubu đã thu hồi 2.000 Điểm Xanh của yêu cầu <mã>. Lý do: …."; số dư = tổng sổ', 'admin'),
    rq.awarded === 2000 && (r.status === 200 || r.status === 201) && st.status === 'REVERSED' && bef.balance - aft.balance === 2000 && aft.balance === aft.ledgerSum && led.length === 1 && led[0].delta === -2000 && n.length >= 1,
    `cộng ${rq.awarded}; thu hồi ${r.status} ${msg(r)} ${short(r.body, 160)}; ${bef.balance}→${aft.balance} sổ ${aft.ledgerSum}; ${short(st)}; sổ âm ${short(led, 200)}; tin ${short(n[n.length - 1], 260)}`);
  const again = await call('admin', 'POST', `/admin/waste/requests/${rq.id}/reverse`, { reason: 'UAT lần hai' });
  const aft2 = await pointsState('uat_returning');
  check('D-91', mk('Thu hồi điểm', 'Thu hồi lần hai cùng yêu cầu', 'Không trừ thêm (số dư không đổi)', 'admin'), aft2.balance === aft.balance, `${again.status} ${msg(again)}; số dư ${aft.balance}→${aft2.balance}`);
  const cust = await call('staff', 'POST', `/admin/waste/requests/${rq.id}/reverse`, { reason: 'staff thử' });
  check('D-92', mk('Thu hồi điểm', 'Staff (không phải ADMIN) thu hồi điểm', 'Chặn 403', 'staff'), cust.status === 403, `${cust.status}`);
  // ví không đủ: khách đã tiêu bớt điểm trước khi bị thu hồi
  const rq2 = await mkDone('new', 5, 'rv2', 'wi-tubu-bottle');
  P.giftId = (await sql(`SELECT id FROM waste_gifts WHERE name LIKE 'Túi vải Tubu (UAT)%' ORDER BY "createdAt" DESC LIMIT 1`))[0]?.id;
  await sql(`UPDATE waste_gifts SET stock = GREATEST(COALESCE(stock,0),1) WHERE id='${P.giftId}'`);
  const g = await call('new', 'POST', `/me/loyalty/rewards/${P.giftId}/redeem`, undefined, idem('rvg'));
  const b2 = await pointsState('uat_new');
  const r2 = await call('admin', 'POST', `/admin/waste/requests/${rq2.id}/reverse`, { reason: 'UAT thu hồi khi khách đã tiêu bớt' });
  const a2 = await pointsState('uat_new');
  const st2 = (await sql(`SELECT status::text AS status, "reversalShortfallPoints" AS short FROM waste_requests WHERE id='${rq2.id}'`))[0];
  check('D-93', mk('Thu hồi điểm', 'Khách new được cộng 10.000, đổi quà 5.000, rồi bị thu hồi yêu cầu 10.000', 'Chỉ thu hồi phần còn trong ví: trừ 5.000, shortfall 5.000, số dư 0 (không âm); điểm đã dùng không đòi lại (thể lệ mục 8); số dư = tổng sổ', 'admin'),
    rq2.awarded === 10000 && g.status === 201 && b2.balance === 5000 && a2.balance === 0 && st2.short === 5000 && a2.balance === a2.ledgerSum, `cộng ${rq2.awarded}; đổi quà ${g.status} ${msg(g)}; trước ${b2.balance} sau ${a2.balance} sổ ${a2.ledgerSum}; ${short(st2)}; thu hồi ${r2.status} ${short(r2.body, 160)}`);
}

// ---------- Thu gom kèm đơn
{
  await call('admin', 'PUT', '/admin/config', { key: 'waste.lane_pickup_enabled', value: true });
  await sleep(6000);
  const me = await call('returning', 'GET', '/waste/me');
  check('D-95', mk('Thu gom kèm đơn', 'Bật waste.lane_pickup_enabled (Gomdon vẫn tắt)', 'pickup vẫn tắt trên /waste/me (cần cả cờ Gomdon, keys.ts mô tả). Luồng đầy đủ (gắn đơn, bưu tá nhận) cần Gomdon thật: BLOCKED', 'returning'), me.body?.laneFlags?.pickup === false ? 'BLOCKED' : false, `laneFlags ${short(me.body?.laneFlags)}`);
  await call('admin', 'PUT', '/admin/config', { key: 'waste.lane_pickup_enabled', value: false });
}

await closeDb();
