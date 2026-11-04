// Ca thêm tìm lỗi: sửa bài để lách kiểm duyệt, đố vui (đáp án, trần ngày, trả lời lặp), cờ chặn khách ở Đổi rác (blocked / shipLocked), sửa yêu cầu vượt trần.
// Chạy sau 80-tz.mjs trên cùng lane. Chạy: node 85-extra.mjs
import { call, idem, sql, pointsState, check, short, msg, readParams, closeDb, toneIssues } from './l4lib.mjs';

const P = readParams();
const mk = (journey, step, expected, persona = '') => ({ persona, viewport: 'API', journey, step, expected });
const want = (n) => !process.env.ONLY || process.env.ONLY.split(',').includes(n);
const okc = (r) => r.status === 200 || r.status === 201;

// ---------- Cộng đồng: sửa bài đã đăng để lách bộ lọc
if (want('edit')) {
  const catId = (await call('returning', 'GET', '/feed/categories')).body?.[0]?.id;
  const p = await call('returning', 'POST', '/feed', { categoryId: catId, kind: 'MANUAL', body: 'Bài hiền lành về cách phân loại bao bì tại nhà.' });
  const id = p.body?.id;
  const e1 = await call('returning', 'PATCH', `/feed/${id}`, { body: 'Mua hàng giá rẻ tại http://spam-shop.example.com/khuyen-mai nhé.' });
  const st1 = (await sql(`SELECT status::text AS s FROM feed_posts WHERE id='${id}'`))[0].s;
  const seen1 = ((await call('new_nophone', 'GET', '/feed')).body?.posts ?? []).some((x) => x.id === id);
  check('X-01', mk('Sửa bài', 'Bài PUBLISHED của khách tin cậy bị sửa thành nội dung có link lạ', 'Không được tự đăng: về PENDING (hoặc bị chặn 400); người khác không thấy bài trong bảng tin', 'returning'), (st1 === 'PENDING' || e1.status === 400) && !seen1, `PATCH ${e1.status} ${msg(e1)}; trạng thái ${st1}; người khác thấy ${seen1}`);
  const q2 = await call('returning', 'POST', '/feed', { categoryId: catId, kind: 'MANUAL', body: 'Bài thứ hai hiền lành để thử sửa thêm từ cấm.' });
  const e2 = await call('returning', 'PATCH', `/feed/${q2.body?.id}`, { body: 'Chơi casino online thắng lớn.' });
  const st2 = (await sql(`SELECT status::text AS s FROM feed_posts WHERE id='${q2.body?.id}'`))[0].s;
  check('X-02', mk('Sửa bài', 'Bài PUBLISHED bị sửa thành chứa từ cấm (casino)', 'Về PENDING hoặc bị chặn; không còn công khai', 'returning'), st2 === 'PENDING' || e2.status === 400, `PATCH ${e2.status} ${msg(e2)}; trạng thái ${st2}`);
  const e3 = await call('new_nophone', 'PATCH', `/feed/${q2.body?.id}`, { body: 'Người khác sửa bài của mình.' });
  check('X-03', mk('Sửa bài', 'Khách khác sửa bài của người ta', '403/404', 'new_nophone'), e3.status === 403 || e3.status === 404, `${e3.status} ${msg(e3)}`);
  const rem = await call('returning', 'POST', '/feed', { categoryId: catId, kind: 'MANUAL', body: 'Bài sẽ xoá rồi bình luận.' });
  await call('returning', 'DELETE', `/feed/${rem.body?.id}`);
  const cm = await call('dealer', 'POST', `/feed/${rem.body?.id}/comments`, { body: 'Bình luận vào bài đã xoá.' });
  const rx = await call('dealer', 'POST', `/feed/${rem.body?.id}/react`);
  const cnt = (await sql(`SELECT count(*)::int AS n FROM feed_comments WHERE "postId"='${rem.body?.id}'`))[0].n;
  check('X-04', mk('Bài đã xoá', 'Bình luận và bấm thích vào bài đã xoá', 'Chặn (404): không có bình luận mới trong DB', 'dealer'), (cm.status === 404 || cm.status === 400 || cm.status === 403) && cnt === 0, `bình luận ${cm.status} ${msg(cm)}; thích ${rx.status}; dòng ${cnt}`);
}

// ---------- Vườn Xanh: đố vui
if (want('quiz')) {
  const u = 'marketing';
  const q = await call(u, 'GET', '/game/quiz/today');
  const items = q.body?.questions ?? q.body?.quizzes ?? (Array.isArray(q.body) ? q.body : []);
  const ids = items.map((x) => x.id);
  const rows = ids.length ? await sql(`SELECT id, correct, "waterReward" AS w FROM game_quizzes WHERE id IN (${ids.map((i) => `'${i}'`).join(',')})`) : [];
  const seeds = async () => (await sql(`SELECT COALESCE((SELECT "totalSeeds" FROM game_profiles WHERE "userId"='uat_${u}'),0) AS s`))[0].s;
  const s0 = await seeds();
  const first = rows[0];
  const wrongChoice = first ? (first.correct === 0 ? 1 : 0) : 0;
  const a = first ? await call(u, 'POST', `/game/quiz/${first.id}/answer`, { choice: wrongChoice }) : { status: 0, body: {} };
  const s1 = await seeds();
  check('X-10', mk('Đố vui', 'Trả lời sai câu 1', 'isCorrect=false, nhận ít nước (game.quiz_wrong_seeds), lộ đáp án đúng sau khi trả lời, có giải thích', u),
    okc(a) && a.body?.isCorrect === false && s1 - s0 === (a.body?.waterEarned ?? -1) && typeof a.body?.correct === 'number', `${a.status} ${short(a.body, 200)}; giọt ${s0}→${s1}; câu hỏi ${ids.length}`);
  const again = first ? await call(u, 'POST', `/game/quiz/${first.id}/answer`, { choice: first.correct }) : { status: 0, body: {} };
  check('X-11', mk('Đố vui', 'Trả lời lại câu đã trả lời hôm nay', '400 "Bạn đã trả lời câu này hôm nay."; không cộng nước', u), again.status === 400 && /đã trả lời câu này/.test(msg(again)) && (await seeds()) === s1, `${again.status} ${msg(again)}`);
  const second = rows[1];
  const s2 = await seeds();
  const b = second ? await call(u, 'POST', `/game/quiz/${second.id}/answer`, { choice: second.correct }) : { status: 0, body: {} };
  const s3 = await seeds();
  check('X-12', mk('Đố vui', 'Trả lời đúng câu 2', `isCorrect=true, +${second?.w ?? '?'} nước theo độ khó (game_quizzes.waterReward)`, u), okc(b) && b.body?.isCorrect === true && s3 - s2 === second.w, `${b.status} ${short(b.body, 160)}; giọt ${s2}→${s3}; waterReward DB ${second?.w}`);
  const out = await call(u, 'POST', '/game/quiz/not-a-real-id/answer', { choice: 0 });
  check('X-13', mk('Đố vui', 'Trả lời câu không thuộc bộ hôm nay', '400 "Câu hỏi không tồn tại." hoặc "không thuộc bộ câu hôm nay"', u), out.status === 400, `${out.status} ${msg(out)}`);
  let last = null;
  for (let i = 2; i < rows.length; i++) last = await call(u, 'POST', `/game/quiz/${rows[i].id}/answer`, { choice: rows[i].correct });
  const sixth = await call(u, 'POST', `/game/quiz/${rows[0]?.id}/answer`, { choice: 0 });
  check('X-15', mk('Đố vui', 'Hết bộ câu trong ngày rồi gửi thêm', 'Chặn 400 "Bạn đã trả lời đủ N câu hôm nay"', u), sixth.status === 400, `bộ ${rows.length} câu; câu cuối ${last?.status}; gửi thêm ${sixth.status} ${msg(sixth)}`);
}

// ---------- Vườn Xanh: đố vui, đáp án ngoài phạm vi (người dùng riêng để chạy lại được)
if (want('quiz14')) {
  const u = 'cskh';
  const q = await call(u, 'GET', '/game/quiz/today');
  const items = q.body?.questions ?? q.body?.quizzes ?? (Array.isArray(q.body) ? q.body : []);
  const first = items[0];
  const s0 = (await sql(`SELECT COALESCE((SELECT "totalSeeds" FROM game_profiles WHERE "userId"='uat_${u}'),0) AS s`))[0].s;
  const bad = first ? await call(u, 'POST', `/game/quiz/${first.id}/answer`, { choice: 99 }) : { status: 0 };
  const s1 = (await sql(`SELECT COALESCE((SELECT "totalSeeds" FROM game_profiles WHERE "userId"='uat_${u}'),0) AS s`))[0].s;
  check('X-14', mk('Đố vui', 'Chọn đáp án ngoài phạm vi (choice=99)', 'Luật chưa nêu: AnswerDto chỉ @IsInt @Min(0), không chặn trên. Ghi nhận cách xử lý thực tế', u), bad.status === 400 || bad.status === 409 ? true : 'NEEDOWNER', `${bad.status} ${short(bad.body, 160)}; giọt ${s0}→${s1}`);
}

// ---------- Đổi rác: cờ chặn
if (want('flags')) {
  const flags = async (userId, body) => call('admin', 'PUT', `/admin/waste/users/${userId}/flags`, body);
  const mkReq = (user, method) => call(user, 'POST', '/waste/requests', method === 'MAIL_IN'
    ? { consent: true, method, packagingConsent: true, postagePaidConsent: true, lines: [{ itemId: 'wi-tubu-bottle', declaredQty: 8 }] }
    : { consent: true, method, pointId: P.whId, lines: [{ itemId: 'wi-bubble-wrap', declaredQty: 1 }] }, idem(`flag-${user}-${method}`));
  const set = await flags('uat_kho', { blocked: true, reason: 'UAT thử chặn' });
  const blk = await mkReq('kho', 'DROP_OFF');
  const meBlk = await call('kho', 'GET', '/waste/me');
  check('X-20', mk('Cờ chặn', 'Admin chặn khách khỏi Đổi rác, khách tạo yêu cầu', `Chặn 403 "Tài khoản của bạn tạm không tham gia Đổi rác, liên hệ Tubu Tree."`, 'kho'), set.status === 200 && blk.status === 403 && /tạm không tham gia Đổi rác/.test(msg(blk)), `đặt cờ ${set.status}; tạo ${blk.status} ${msg(blk)}; GET /waste/me ${meBlk.status}`);
  const free = await flags('uat_kho', { blocked: false, reason: 'UAT bỏ chặn' });
  const unb = await mkReq('kho', 'DROP_OFF');
  check('X-21', mk('Cờ chặn', 'Bỏ chặn rồi tạo lại', 'Tạo được 201', 'kho'), free.status === 200 && unb.status === 201, `bỏ cờ ${free.status}; tạo ${unb.status} ${msg(unb)}`);
  const sl = await flags('uat_kho', { shipLocked: true, reason: 'UAT khoá gửi kho' });
  const m = await mkReq('kho', 'MAIL_IN');
  const d = await call('kho', 'POST', '/waste/requests', { consent: true, method: 'DROP_OFF', pointId: P.whId, lines: [{ itemId: 'wi-carton', declaredQty: 1 }] }, idem('flag-kho-drop2'));
  check('X-22', mk('Cờ chặn', 'Khoá đường gửi kho: tạo MAIL_IN, rồi DROP_OFF', 'MAIL_IN 403 "Đường gửi kho và thu kèm đơn đang tạm dừng..."; DROP_OFF vẫn tạo được', 'kho'), m.status === 403 && /tạm dừng/.test(msg(m)) && d.status === 201, `MAIL_IN ${m.status} ${msg(m)}; DROP_OFF ${d.status}`);
  await flags('uat_kho', { shipLocked: false, reason: 'UAT mở lại' });
  const nf = await flags('uat_kho', {}).catch(() => ({ status: 0 }));
  check('X-23', mk('Cờ chặn', 'Đặt cờ không có trường nào', '400', 'admin'), nf.status === 400, `${nf.status} ${msg(nf)}`);
  const nonAdmin = await call('staff', 'PUT', '/admin/waste/users/uat_kho/flags', { blocked: true, reason: 'staff thử' });
  check('X-24', mk('Cờ chặn', 'Staff (không phải ADMIN) đặt cờ chặn khách', '403', 'staff'), nonAdmin.status === 403, `${nonAdmin.status}`);
}

// ---------- Đổi rác: sửa yêu cầu vượt trần
if (want('editcap')) {
  const c = await call('ctv_pending', 'POST', '/waste/requests', { consent: true, method: 'DROP_OFF', pointId: P.whId, lines: [{ itemId: 'wi-carton', declaredQty: 4 }] }, idem('edit-cap'));
  if (c.status !== 201) {
    check('X-30', mk('Sửa yêu cầu', 'Sửa carton 4 → 11 (trần ngày 10)', 'Chặn; sửa → 10 được', 'ctv_pending'), 'BLOCKED', `không tạo được yêu cầu nền: ${c.status} ${msg(c)}`);
  } else {
    const over = await call('ctv_pending', 'PATCH', `/waste/requests/${c.body.id}`, { lines: [{ itemId: 'wi-carton', declaredQty: 11 }] });
    const ok = await call('ctv_pending', 'PATCH', `/waste/requests/${c.body.id}`, { lines: [{ itemId: 'wi-carton', declaredQty: 10 }] });
    const row = (await sql(`SELECT "declaredQty" AS q FROM waste_request_lines WHERE "requestId"='${c.body.id}'`))[0];
    check('X-30', mk('Sửa yêu cầu', 'Sửa carton 4 → 11 (trần ngày 10), rồi 4 → 10', 'Sửa lên 11 bị chặn 409 (không tính chính yêu cầu đang sửa vào số đã dùng), sửa lên 10 được; DB còn 10', 'ctv_pending'), over.status === 409 && okc(ok) && row.q === 10, `→11: ${over.status} ${msg(over)}; →10: ${ok.status}; DB ${row?.q}`);
    const big = await call('ctv_pending', 'PATCH', `/waste/requests/${c.body.id}`, { lines: [{ itemId: 'wi-milk-carton', declaredQty: 5 }] });
    const toPartner = await call('ctv_pending', 'PATCH', `/waste/requests/${c.body.id}`, { lines: [{ itemId: 'wi-carton', declaredQty: 2 }, { itemId: 'wi-milk-carton', declaredQty: 5 }], pointId: P.partnerId });
    check('X-31', mk('Sửa yêu cầu', 'Đổi yêu cầu sang điểm đại lý kèm hộp sữa (món chỉ kho nhận)', 'Chặn 409 (đại lý không nhận hộp sữa)', 'ctv_pending'), toPartner.status === 409 || toPartner.status === 400, `thêm hộp sữa tại kho ${big.status}; sang đại lý ${toPartner.status} ${msg(toPartner)}`);
  }
}

// ---------- Quà hiện vật: admin huỷ lượt đổi (hoàn điểm, hoàn tồn kho, lần hai, đã trao, khách từng bị thu hồi)
if (want('giftcancel')) {
  const g = await call('admin', 'POST', '/admin/waste/gifts', { kind: 'GIFT', name: 'Quà thử huỷ (UAT)', description: 'Thử admin huỷ', pointsCost: 100, status: 'ACTIVE', stock: 3, claimInstructions: 'Nhận tại kho' });
  const gid = g.body?.id;
  const stock = async () => (await sql(`SELECT stock FROM waste_gifts WHERE id='${gid}'`))[0].stock;
  const red = async (user, tag) => (await call(user, 'POST', `/me/loyalty/rewards/${gid}/redeem`, undefined, idem(tag))).body?.redemption;
  const r1 = await red('dealer', 'cx1');
  const bef = await pointsState('uat_dealer');
  const st0 = await stock();
  const c1 = await call('admin', 'POST', `/admin/waste/gift-redemptions/${r1?.id}/cancel`, { reason: 'UAT huỷ thử' });
  const aft = await pointsState('uat_dealer');
  const st1 = await stock();
  const c2 = await call('admin', 'POST', `/admin/waste/gift-redemptions/${r1?.id}/cancel`, { reason: 'UAT huỷ lần hai' });
  const aft2 = await pointsState('uat_dealer');
  const refundRows = await sql(`SELECT count(*)::int AS n FROM points_transactions WHERE "userId"='uat_dealer' AND delta=100 AND reason LIKE 'GIFT_REFUND%'`);
  check('X-50', mk('Huỷ quà', 'Admin huỷ lượt đổi quà READY của khách bình thường (không nêu refundPoints)', 'Mặc định hoàn 100 điểm một lần, trả 1 vào tồn kho (2→3), lượt thành CANCELLED; huỷ lần hai 409 và không hoàn thêm; số dư = tổng sổ', 'admin'),
    c1.status === 200 && aft.balance - bef.balance === 100 && st1 - st0 === 1 && c2.status === 409 && aft2.balance === aft.balance && aft.balance === aft.ledgerSum, `huỷ ${c1.status} ${msg(c1)}; ${bef.balance}→${aft.balance} sổ ${aft.ledgerSum}; tồn ${st0}→${st1}; huỷ lần hai ${c2.status} ${msg(c2)}; dòng hoàn ${short(refundRows, 60)}`);
  const r2 = await red('dealer', 'cx2');
  await call('staff', 'POST', '/waste/desk/gifts/fulfil', { code: r2?.code, pointId: P.whId });
  const c3 = await call('admin', 'POST', `/admin/waste/gift-redemptions/${r2?.id}/cancel`, { reason: 'UAT huỷ quà đã trao' });
  check('X-51', mk('Huỷ quà', 'Admin huỷ lượt đổi đã trao (FULFILLED)', '409 "Chỉ huỷ được lượt đổi quà đang chờ nhận."', 'admin'), c3.status === 409, `${c3.status} ${msg(c3)}`);
  const r3 = await red('new', 'cx3');
  const sc = await call('staff', 'POST', `/admin/waste/gift-redemptions/${r3?.id}/cancel`, { reason: 'staff thử huỷ' });
  const noReason = await call('admin', 'POST', `/admin/waste/gift-redemptions/${r3?.id}/cancel`, { reason: 'x' });
  check('X-52', mk('Huỷ quà', 'Staff huỷ lượt đổi; admin huỷ với lý do 1 ký tự', 'Staff 403; lý do quá ngắn 400', 'staff'), sc.status === 403 && noReason.status === 400, `staff ${sc.status}; lý do ngắn ${noReason.status} ${msg(noReason)}`);
  const bad = await call('admin', 'POST', `/admin/waste/gift-redemptions/${r3?.id}/cancel`, { reason: 'Huỷ vì khách từng bị thu hồi' });
  const wasReversed = (await sql(`SELECT count(*)::int AS n FROM waste_requests WHERE "userId"='uat_new' AND status='REVERSED'`))[0].n;
  const b3 = await pointsState('uat_new');
  const noRefund = await call('admin', 'POST', `/admin/waste/gift-redemptions/${r3?.id}/cancel`, { reason: 'Huỷ vì khách từng bị thu hồi', refundPoints: false });
  const a3 = await pointsState('uat_new');
  check('X-53', mk('Huỷ quà', 'Huỷ lượt đổi của khách từng bị thu hồi điểm: không nêu refundPoints, rồi nêu refundPoints=false', wasReversed > 0 ? 'Lần đầu 400 "hãy chọn rõ có hoàn điểm hay không"; chọn false thì không hoàn, tồn kho trả lại' : 'Khách chưa từng bị thu hồi: hoàn mặc định', 'admin'),
    wasReversed > 0 ? bad.status === 400 && /chọn rõ/.test(msg(bad)) && noRefund.status === 200 && a3.balance === b3.balance : bad.status === 200, `đã bị thu hồi ${wasReversed}; không nêu ${bad.status} ${msg(bad)}; false ${noRefund.status}; số dư ${b3.balance}→${a3.balance}`);
}

// ---------- chữ API của đợt: không "Vui lòng", "chúng tôi", "..."
if (want('tone')) {
  const samples = [];
  const probes = [
    ['returning', 'POST', '/waste/requests', { consent: true, method: 'DROP_OFF', lines: [] }],
    ['returning', 'POST', '/game/quiz/xxx/answer', { choice: 0 }],
    ['returning', 'POST', '/feed/xxx/comments', { body: 'x' }],
    ['returning', 'GET', '/waste/requests/xxx'],
    ['returning', 'POST', '/me/loyalty/rewards/xxx/redeem'],
    ['returning', 'POST', '/game/missions/xxx/claim'],
    ['staff', 'POST', '/waste/desk/lookup', { code: 'xxx' }],
  ];
  for (const [u, m, p, b] of probes) {
    const r = await call(u, m, p, b, m === 'POST' ? idem('t') : {});
    samples.push(`${m} ${p} ${r.status} "${msg(r)}"`);
  }
  const issues = toneIssues(samples.join(' '));
  check('X-40', mk('Chữ API', '7 lỗi thường gặp của Đổi rác, đố vui, bình luận, đổi quà, nhiệm vụ', 'Không có "Vui lòng", "chúng tôi", "..."', 'returning'), issues.length === 0, `${issues.join(',') || 'sạch'}; ${samples.join(' ; ').slice(0, 500)}`);
}
await closeDb();
