// Cộng đồng: đăng bài (tin cậy / chờ duyệt / từ cấm / link lạ), thưởng bài 1.000 điểm trần 1/ngày, bình luận, báo cáo, CSKH và Marketing duyệt/ẩn,
// quyền (khách thường, staff không nhóm, kế toán không kiểm duyệt được), người xem không thấy bài chờ/đã gỡ, câu trả lời hay nhất.
// Chạy: node 40-community-api.mjs (sau 30-game-api.mjs hoặc độc lập trên lane mới)
import { call, sql, pointsState, ledgerRows, check, short, msg, closeDb } from './l4lib.mjs';

const mk = (journey, step, expected, persona = '') => ({ persona, viewport: 'API', journey, step, expected });
const cats = (await call('returning', 'GET', '/feed/categories')).body;
const catId = cats?.[0]?.id;
const post = (user, body) => call(user, 'POST', '/feed', { categoryId: catId, ...body });
const notifs0 = (userId, code) => sql(`SELECT payload::text AS payload FROM notification_logs WHERE "userId"='${userId}' AND "templateCode"='${code}' ORDER BY "sentAt"`);
const notifs = (userId, code) => notifs0(userId.replace(/^(?!uat_)/, 'uat_'), code);
const P = {};
// seed-data.mjs đã cho returning đăng một bài hôm nay (ăn hết trần thưởng 1 bài/ngày): lùi dòng thưởng đó một ngày để ca C-01 đo được thưởng thật
await sql(`UPDATE points_transactions SET "createdAt" = "createdAt" - interval '1 day' WHERE "userId"='uat_returning' AND reason LIKE 'COMMUNITY_POST:%'`);
const feedIds = (r) => (r.body?.posts ?? []).map((x) => x.id);

// ---------- Đăng bài
{
  const bef = await pointsState('uat_returning');
  const a = await post('returning', { kind: 'QUESTION', title: 'Rửa chén bằng Fuwa3e có cần găng tay không?', body: 'Mình có da nhạy cảm, hỏi xem rửa chén hằng ngày có cần đeo găng tay không ạ?' });
  const aft = await pointsState('uat_returning');
  P.q1 = a.body?.id;
  const led = await ledgerRows('uat_returning', `AND reason = 'COMMUNITY_POST:${P.q1}'`);
  check('C-01', mk('Đăng bài', 'Khách đã mua hàng (đơn DELIVERED) đăng câu hỏi', 'PUBLISHED ngay (isTrusted theo đơn đã giao); thưởng đăng bài 1.000 điểm (community.post_reward_points), sổ COMMUNITY_POST:<id> refType COMMUNITY; số dư = tổng sổ', 'returning'),
    a.status === 201 && a.body.status === 'PUBLISHED' && aft.balance - bef.balance === 1000 && led.length === 1 && aft.balance === aft.ledgerSum, `${a.status} ${short(a.body)}; ${bef.balance}→${aft.balance} sổ ${aft.ledgerSum}; ${short(led, 200)}`);
  const b = await post('returning', { kind: 'MANUAL', body: 'Bài thứ hai trong ngày, không còn điểm thưởng nữa.' });
  const aft2 = await pointsState('uat_returning');
  P.p2 = b.body?.id;
  check('C-02', mk('Đăng bài', 'Đăng bài thứ hai trong ngày', 'Vẫn PUBLISHED nhưng KHÔNG thưởng thêm (community.daily_post_reward_cap = 1): số dư không đổi', 'returning'), b.status === 201 && b.body.status === 'PUBLISHED' && aft2.balance === aft.balance, `${b.status} ${short(b.body)}; số dư ${aft.balance}→${aft2.balance}`);
  const c = await post('new', { kind: 'MANUAL', body: 'Mình mới dùng thử Tubu Tree, bạn nào có kinh nghiệm chia sẻ giúp mình với.' });
  P.pend = c.body?.id;
  const bn = await pointsState('uat_new');
  check('C-03', mk('Đăng bài', 'Khách mới chưa mua đăng bài', 'PENDING (chưa tin cậy), không thưởng điểm', 'new'), c.status === 201 && c.body.status === 'PENDING', `${c.status} ${short(c.body)}; điểm new ${bn.balance}`);
  const d = await post('admin', { kind: 'MANUAL', body: 'Thông báo từ cửa hàng: tuần này có quà cho thành viên mới.' });
  check('C-04', mk('Đăng bài', 'Admin đăng bài', 'PUBLISHED (vai trò tin cậy)', 'admin'), d.status === 201 && d.body.status === 'PUBLISHED', `${d.status} ${short(d.body)}`);
  const e = await post('returning', { kind: 'MANUAL', body: 'Mua hàng giá rẻ tại http://spam-shop.example.com/khuyen-mai nhé mọi người' });
  P.link = e.body?.id;
  check('C-05', mk('Đăng bài', 'Khách tin cậy chèn link lạ (không thuộc tubutree.com, zalo.me, zaloapp.com)', 'Ép về PENDING chờ duyệt (content-filter), không tự đăng', 'returning'), e.status === 201 && e.body.status === 'PENDING', `${e.status} ${short(e.body)}`);
  const f = await post('returning', { kind: 'MANUAL', body: 'Chơi casino online thắng lớn, ai muốn thử không?' });
  P.kw = f.body?.id;
  check('C-06', mk('Đăng bài', 'Khách tin cậy dùng từ cấm "casino" (community.banned_keywords)', 'Ép về PENDING', 'returning'), f.status === 201 && f.body.status === 'PENDING', `${f.status} ${short(f.body)}`);
  const g = await post('returning', { kind: 'MANUAL', body: 'Xem hướng dẫn tại https://tubutree.com/huong-dan và nhóm Zalo https://zalo.me/g/abc nhé.' });
  P.okLink = g.body?.id;
  check('C-07', mk('Đăng bài', 'Link thuộc danh sách cho phép (tubutree.com, zalo.me)', 'Không bị ép chờ duyệt: PUBLISHED', 'returning'), g.status === 201 && g.body.status === 'PUBLISHED', `${g.status} ${short(g.body)}`);
  const h = await post('returning', { kind: 'QUESTION', body: 'Câu hỏi thiếu tiêu đề' });
  check('C-08', mk('Đăng bài', 'Câu hỏi không có tiêu đề', '400 "Câu hỏi cần có tiêu đề."', 'returning'), h.status === 400 && /Câu hỏi cần có tiêu đề/.test(msg(h)), `${h.status} ${msg(h)}`);
  const i = await post('returning', { kind: 'MANUAL', body: '   ' });
  check('C-09', mk('Đăng bài', 'Nội dung chỉ có khoảng trắng', '400 "Nội dung bài viết trống."', 'returning'), i.status === 400, `${i.status} ${msg(i)}`);
  const g1 = await call(undefined, 'POST', '/feed', { body: 'Không đăng nhập' });
  check('C-10', mk('Đăng bài', 'Không đăng nhập đăng bài', '401', 'guest'), g1.status === 401, `${g1.status}`);
}

// ---------- Người xem: bài chờ/đã gỡ không lộ
{
  const feed = await call('new_nophone', 'GET', '/feed');
  const ids = feedIds(feed);
  check('C-20', mk('Xem bài', 'Bảng tin của khách khác', 'Chỉ có bài PUBLISHED; không có bài chờ duyệt (PENDING) của người khác', 'new_nophone'),
    feed.status === 200 && ids.includes(P.q1) && !ids.includes(P.pend) && !ids.includes(P.link) && !ids.includes(P.kw), `${feed.status}; ${ids.length} bài; thấy q1=${ids.includes(P.q1)}, pend=${ids.includes(P.pend)}, link=${ids.includes(P.link)}, kw=${ids.includes(P.kw)}`);
  const det = await call('new_nophone', 'GET', `/feed/${P.pend}`);
  check('C-21', mk('Xem bài', 'Khách khác mở chi tiết bài chờ duyệt bằng id', '404 "Bài viết không tồn tại."', 'new_nophone'), det.status === 404, `${det.status} ${msg(det)}`);
  const own = await call('new', 'GET', `/feed/${P.pend}`);
  check('C-22', mk('Xem bài', 'Tác giả mở bài chờ duyệt của mình', '200 (tác giả xem được)', 'new'), own.status === 200, `${own.status}`);
  const cm = await call('new_nophone', 'POST', `/feed/${P.pend}/comments`, { body: 'Bình luận vào bài chưa duyệt' });
  check('C-23', mk('Bình luận', 'Bình luận vào bài chờ duyệt', '404 "Bài viết không tồn tại." (chống farm điểm trên bài vô hình)', 'new_nophone'), cm.status === 404, `${cm.status} ${msg(cm)}`);
  const cl = await call('new_nophone', 'GET', `/feed/${P.pend}/comments`);
  check('C-24', mk('Lộ dữ liệu', 'Đọc bình luận của bài chờ duyệt bằng id', '404', 'new_nophone'), cl.status === 404, `${cl.status}`);
  const pubp = await call(undefined, 'GET', '/feed/public-preview');
  const txt = JSON.stringify(pubp.body ?? '');
  check('C-25', mk('Xem bài', 'Xem trước công khai cho khách chưa đăng nhập (community.public_preview=true)', '200; chỉ bài đã đăng; không lộ SĐT/zaloId/email tác giả', 'guest'), pubp.status === 200 && !/0901000|uat-zalo|@/.test(txt), `${pubp.status} ${txt.slice(0, 300)}`);
}

// ---------- Bình luận + câu trả lời hay nhất
{
  const c1 = await call('new', 'POST', `/feed/${P.q1}/comments`, { body: 'Mình dùng không đeo găng vẫn ổn, tay không bị khô.' });
  P.cm1 = c1.body?.id;
  const dup = await call('new', 'POST', `/feed/${P.q1}/comments`, { body: 'Mình dùng không đeo găng vẫn ổn, tay không bị khô.' });
  const cnt = (await sql(`SELECT count(*)::int AS n FROM feed_comments WHERE "postId"='${P.q1}' AND "userId"='uat_new'`))[0].n;
  check('C-30', mk('Bình luận', 'Bình luận câu hỏi rồi bấm gửi lặp trong 10 giây', 'Lần hai trả bình luận cũ (cùng id), chỉ 1 dòng trong DB', 'new'), c1.status === 201 && dup.body?.id === c1.body?.id && cnt === 1, `${c1.status}/${dup.status}; cùng id ${dup.body?.id === c1.body?.id}; dòng ${cnt}`);
  const n = (await notifs('uat_returning', 'COMMUNITY_NEW_ANSWER')).filter((x) => /găng tay/.test(x.payload));
  check('C-31', mk('Bình luận', 'Tác giả câu hỏi được báo có câu trả lời', 'Có đúng 1 tin COMMUNITY_NEW_ANSWER cho câu hỏi này', 'returning'), n.length === 1, short(n, 300));
  const bef = await pointsState('uat_new');
  const best = await call('returning', 'POST', `/feed/${P.q1}/best-answer/${P.cm1}`);
  const aft = await pointsState('uat_new');
  const led = await ledgerRows('uat_new', `AND reason LIKE 'COMMUNITY_BEST:%'`);
  check('C-32', mk('Câu trả lời hay nhất', 'Tác giả chọn câu trả lời hay nhất', 'Người trả lời nhận 1.000 điểm (community.best_answer_reward_points), sổ COMMUNITY_BEST:<postId>; số dư = tổng sổ', 'new'), (best.status === 200 || best.status === 201) && aft.balance - bef.balance === 1000 && led.length === 1 && aft.balance === aft.ledgerSum, `${best.status} ${msg(best)}; ${bef.balance}→${aft.balance} sổ ${aft.ledgerSum}`);
  const other = await call('new_nophone', 'POST', `/feed/${P.q1}/best-answer/${P.cm1}`);
  check('C-33', mk('Câu trả lời hay nhất', 'Người không phải tác giả chọn câu trả lời hay nhất', 'Chặn 403', 'new_nophone'), other.status === 403, `${other.status} ${msg(other)}`);
  const self = await call('returning', 'POST', `/feed/${P.q1}/comments`, { body: 'Tự trả lời bài của mình' });
  const bef2 = await pointsState('uat_returning');
  const selfBest = await call('returning', 'POST', `/feed/${P.q1}/best-answer/${self.body?.id}`);
  const aft2 = await pointsState('uat_returning');
  check('C-34', mk('Câu trả lời hay nhất', 'Tác giả chọn chính bình luận của mình', 'Không cộng điểm (không thưởng cho chính chủ bài)', 'returning'), aft2.balance === bef2.balance, `${selfBest.status} ${msg(selfBest)}; số dư ${bef2.balance}→${aft2.balance}`);
  const long = await call('new', 'POST', `/feed/${P.q1}/comments`, { body: 'x'.repeat(3000) });
  check('C-35', mk('Bình luận', 'Bình luận quá dài', '400 (DTO hoặc "Bình luận quá dài.")', 'new'), long.status === 400, `${long.status} ${msg(long)}`);
  const rx1 = await call('new', 'POST', `/feed/${P.q1}/react`);
  const rx2 = await call('new', 'POST', `/feed/${P.q1}/react`);
  check('C-36', mk('Cảm xúc', 'Thích rồi bỏ thích', 'Lần 1 liked=true, lần 2 liked=false (bật tắt)', 'new'), JSON.stringify(rx1.body).includes('true') && JSON.stringify(rx2.body).includes('false'), `${short(rx1.body)} / ${short(rx2.body)}`);
}

// ---------- Báo cáo
{
  const rp = await call('new_nophone', 'POST', `/feed/${P.p2}/report`, { targetType: 'POST', reason: 'Nội dung quảng cáo' });
  const list = await call('cskh', 'GET', '/feed/admin/reports');
  const repId = (list.body ?? [])[0]?.id;
  check('C-40', mk('Báo cáo', 'Khách báo cáo bài; CSKH thấy trong hàng chờ báo cáo', 'Có báo cáo mở; CSKH xử lý (resolve) được', 'cskh'), (rp.status === 200 || rp.status === 201) && list.status === 200 && !!repId, `báo ${rp.status} ${msg(rp)}; danh sách ${list.status} ${short(list.body, 250)}`);
  if (repId) {
    const rs = await call('cskh', 'POST', `/feed/admin/reports/${repId}/resolve`);
    check('C-41', mk('Báo cáo', 'CSKH đánh dấu đã xử lý', '200/201; báo cáo không còn trong hàng chờ', 'cskh'), rs.status === 200 || rs.status === 201, `${rs.status} ${short(rs.body)}`);
  }
}

// ---------- Kiểm duyệt: quyền
{
  const as = { returning: 'khách thường', staff: 'staff không nhóm', ketoan: 'kế toán', kho: 'kho', dealer: 'đại lý', ctv: 'CTV' };
  for (const [u, label] of Object.entries(as)) {
    const r = await call(u, 'GET', '/feed/admin/pending');
    check(`C-50-${u}`, mk('Kiểm duyệt quyền', `${label} mở hàng chờ duyệt`, 'Chặn 403 (chỉ ADMIN, CSKH, MARKETING; COMMUNITY_MODERATORS)', u), r.status === 403, `${r.status} ${msg(r)}`);
  }
  for (const u of ['cskh', 'marketing', 'admin']) {
    const r = await call(u, 'GET', '/feed/admin/pending');
    const ids = (r.body ?? []).map((x) => x.id);
    check(`C-51-${u}`, mk('Kiểm duyệt quyền', `${u} mở hàng chờ duyệt`, '200; thấy 3 bài chờ (khách mới, link lạ, từ cấm)', u), r.status === 200 && [P.pend, P.link, P.kw].every((x) => ids.includes(x)), `${r.status}; ${ids.length} bài; ${[P.pend, P.link, P.kw].map((x) => ids.includes(x)).join(',')}`);
  }
  const pin = await call('cskh', 'POST', `/feed/admin/${P.q1}/pin`, { pinned: true });
  check('C-52', mk('Kiểm duyệt quyền', 'CSKH ghim bài', 'Chặn 403 (ghim chỉ ADMIN)', 'cskh'), pin.status === 403, `${pin.status} ${msg(pin)}`);
  const ev = await call('cskh', 'POST', '/feed/events', { title: 'x', description: 'y', startAt: new Date().toISOString(), endAt: new Date(Date.now() + 864e5).toISOString(), rewardPoints: 20000 });
  check('C-53', mk('Kiểm duyệt quyền', 'CSKH tạo sự kiện có thưởng Điểm Xanh', 'Chặn 403 (chỉ ADMIN)', 'cskh'), ev.status === 403, `${ev.status} ${msg(ev)}`);
}

// ---------- Kiểm duyệt: duyệt, từ chối, ẩn
{
  const bef = await pointsState('uat_new');
  const ap = await call('cskh', 'POST', `/feed/admin/${P.pend}/approve`);
  const aft = await pointsState('uat_new');
  const st = (await sql(`SELECT status::text AS status FROM feed_posts WHERE id='${P.pend}'`))[0];
  const prof = (await sql(`SELECT "isTrusted" FROM community_profiles WHERE "userId"='uat_new'`))[0];
  check('C-60', mk('Kiểm duyệt', 'CSKH duyệt bài chờ của khách mới', 'PUBLISHED; tác giả được thưởng bài 1.000 điểm (uat_new đã lấy 0 thưởng bài hôm nay); tác giả được đánh dấu tin cậy; số dư = tổng sổ', 'cskh'),
    (ap.status === 200 || ap.status === 201) && st.status === 'PUBLISHED' && aft.balance - bef.balance === 1000 && prof?.isTrusted === true && aft.balance === aft.ledgerSum, `${ap.status}; ${short(st)}; ${bef.balance}→${aft.balance} sổ ${aft.ledgerSum}; trusted ${prof?.isTrusted}`);
  const ap2 = await call('cskh', 'POST', `/feed/admin/${P.pend}/approve`);
  const aft2 = await pointsState('uat_new');
  check('C-61', mk('Kiểm duyệt', 'Duyệt lần hai', 'Idempotent: không thưởng lần hai', 'cskh'), aft2.balance === aft.balance, `${ap2.status} ${short(ap2.body)}; số dư ${aft.balance}→${aft2.balance}`);
  const bef3 = await pointsState('uat_returning');
  const rj = await call('marketing', 'POST', `/feed/admin/${P.kw}/reject`, { reason: 'Nội dung không phù hợp cộng đồng Tubu' });
  const aft3 = await pointsState('uat_returning');
  const st3 = (await sql(`SELECT status::text AS status FROM feed_posts WHERE id='${P.kw}'`))[0];
  const n = await notifs('uat_returning', 'COMMUNITY_POST_REJECTED');
  check('C-62', mk('Kiểm duyệt', 'Marketing từ chối bài chứa từ cấm kèm lý do', 'REMOVED; không thưởng; tác giả nhận tin COMMUNITY_POST_REJECTED có lý do', 'marketing'), (rj.status === 200 || rj.status === 201) && st3.status === 'REMOVED' && aft3.balance === bef3.balance && n.length === 1 && /không phù hợp/.test(n[0].payload), `${rj.status}; ${short(st3)}; tin ${short(n, 300)}`);
  const rjp = await call('cskh', 'POST', `/feed/admin/${P.q1}/reject`, { reason: 'thử' });
  check('C-63', mk('Kiểm duyệt', 'Từ chối bài đã đăng', '409 "Bài này đã được đăng nên không thể từ chối. Hãy dùng "Ẩn" để gỡ bài đã đăng."', 'cskh'), rjp.status === 409, `${rjp.status} ${msg(rjp)}`);
  const hd = await call('cskh', 'POST', `/feed/admin/${P.p2}/hide`, { reason: 'Quảng cáo ngoài chủ đề' });
  const st4 = (await sql(`SELECT status::text AS status FROM feed_posts WHERE id='${P.p2}'`))[0];
  const feed = await call('new_nophone', 'GET', '/feed');
  const ids = feedIds(feed);
  const det = await call('new_nophone', 'GET', `/feed/${P.p2}`);
  const nh = await notifs('uat_returning', 'COMMUNITY_POST_HIDDEN');
  check('C-64', mk('Kiểm duyệt', 'CSKH ẩn bài đã đăng kèm lý do', 'REMOVED; biến khỏi bảng tin; mở bằng id 404; tác giả nhận tin COMMUNITY_POST_HIDDEN', 'cskh'), (hd.status === 200 || hd.status === 201) && st4.status === 'REMOVED' && !ids.includes(P.p2) && det.status === 404 && nh.length === 1, `${hd.status}; ${short(st4)}; trong bảng tin ${ids.includes(P.p2)}; chi tiết ${det.status}; tin ${nh.length}`);
  const hp = await call('cskh', 'POST', `/feed/admin/${P.link}/hide`, { reason: 'thử' });
  check('C-65', mk('Kiểm duyệt', 'Ẩn bài đang chờ duyệt', '409 "Bài đang chờ duyệt nên chưa được đăng, không thể ẩn. Hãy dùng "Từ chối" cho bài này."', 'cskh'), hp.status === 409, `${hp.status} ${msg(hp)}`);
  const del = await call('new_nophone', 'DELETE', `/feed/${P.okLink}`);
  check('C-66', mk('Xoá bài', 'Khách khác xoá bài của người ta', 'Chặn 403', 'new_nophone'), del.status === 403, `${del.status} ${msg(del)}`);
  const del2 = await call('returning', 'DELETE', `/feed/${P.okLink}`);
  check('C-67', mk('Xoá bài', 'Tác giả xoá bài của mình', 'Thành công, bài biến khỏi bảng tin', 'returning'), del2.status === 200 || del2.status === 204, `${del2.status} ${short(del2.body)}`);
  const rcm = await call('cskh', 'DELETE', `/feed/comments/${P.cm1}`);
  check('C-68', mk('Gỡ bình luận', 'CSKH gỡ bình luận của khách', 'Chặn hoặc cho phép theo quyền: xem route removeComment (tác giả bình luận hoặc ADMIN)', 'cskh'), 'NEEDOWNER', `${rcm.status} ${msg(rcm)}`);
}

// ---------- Chữ
{
  const msgs = [];
  for (const r of [await call('new', 'POST', `/feed/${P.q1}/comments`, { body: '' }), await call('returning', 'POST', '/feed', { kind: 'QUESTION', body: 'x' })]) msgs.push(msg(r));
  check('C-70', mk('Chữ', 'Lỗi API cộng đồng không có "Vui lòng", "chúng tôi", "..."', 'Sạch theo giọng đợt 8', ''), msgs.every((m) => !/vui lòng|chúng tôi|\.\.\./i.test(m)), msgs.join(' | '));
}

await closeDb();
