// Nhóm G: cộng đồng, Vườn Xanh (game), Đổi rác (cả hai trạng thái bật/tắt), thông báo "mở Mini App" (Q2), phân quyền, trang lỗi/IDOR trên web.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import {
  L, Recorder, finish, openWeb, openMini, nav, bodyText, badReqs, overflowX, sql, call, clearCart, variantId, vnd, sleep, ledger,
} from './_lib.mjs';

const rec = new Recorder('g-misc');
const R = 'returning';
const RID = 'uat_returning';
const num = (n) => new Intl.NumberFormat('vi-VN').format(n);
// SystemConfigService nhớ mỗi khoá 60 giây (system-config.service.ts ttlMs = 60_000), nên sau khi đổi cấu hình phải chờ quá 60 giây
// kể từ lần đổi cuối. Lúc bắt đầu cũng coi như vừa đổi: lần chạy trước có thể để lại giá trị cũ trong bộ nhớ đệm của API.
let lastChange = Date.now();
const setCfg = async (key, value) => {
  const cur = (await sql(`SELECT value FROM system_configs WHERE key = $1`, key))[0]?.value;
  if (JSON.stringify(cur) === JSON.stringify(value)) return;
  await sql(`UPDATE system_configs SET value = $2::jsonb WHERE key = $1`, key, JSON.stringify(value));
  lastChange = Date.now();
};
const cfgWait = () => sleep(Math.max(0, 62_000 - (Date.now() - lastChange)));

// ───────────── U6-70 cộng đồng: đăng bài, thích, bình luận, xoá (khách quay lại); khách ghé xem được nhưng phải đăng nhập để đăng
await rec.run('U6-70', { role: 'Khách quay lại + khách chưa đăng nhập', journey: 'Cộng đồng', steps: 'Khách ghé mở /cong-dong rồi bấm "Đăng bài"; khách đăng nhập: đăng bài Hỏi đáp, mở bài, thích, bình luận, xoá bài (390px)', expected: 'Khách ghé xem được feed nhưng "Đăng bài" đưa tới đăng nhập; đăng bài tạo feed_posts (userId, kind, body, status hiển thị); thích tăng likeCount + feed_reactions đúng 1 dòng, bỏ thích về 0; bình luận tạo feed_comments; xoá bài làm bài biến mất khỏi feed' }, async (c) => {
  await sql(`DELETE FROM feed_posts WHERE "userId" = $1 AND body LIKE 'UAT web%'`, RID);
  const g = await openWeb('guest', { width: 390, path: '/' });
  await nav(g, '/cong-dong');
  let t = await bodyText(g.page);
  c.ok('khách ghé /cong-dong thấy lời mời đăng nhập (feed chỉ dành cho người đã đăng nhập, giống Mini App luôn đăng nhập)', /Đăng nhập để xem cộng đồng/.test(t) && /Đăng nhập với Zalo/.test(t), t.slice(0, 200));
  // Đường feed thật là /feed (community-feed.controller.ts @Controller('feed') @Get()); /feed/posts chỉ khớp @Get(':id').
  const feedAnon = await fetch(`${L.apiUrl127}/feed`).then((r) => r.status).catch(() => 0);
  c.ev('GET /feed không token', feedAnon);
  c.ok('API feed không trả bài cho khách chưa đăng nhập (401/403)', feedAnon === 401 || feedAnon === 403, feedAnon);
  await c.shot(g.page, 'khach-bam-dang-bai');
  await g.close();
  const s = await openWeb(R, { width: 390, path: '/' });
  await nav(s, '/cong-dong');
  await s.page.getByRole('button', { name: /Đăng bài|Đăng bài đầu tiên/ }).first().click();
  await s.page.waitForTimeout(1000);
  await s.page.getByRole('button', { name: 'Hỏi đáp' }).click();
  const title = s.page.getByPlaceholder(/Tiêu đề/);
  if (await title.count()) await title.fill('UAT web: dầu tràm dùng cho bé mấy tháng?');
  await s.page.getByPlaceholder('Chia sẻ chi tiết…').fill('UAT web: bé nhà mình 4 tháng tuổi dùng dầu tràm được chưa ạ?');
  await c.shot(s.page, 'soan-bai');
  // Web đăng bài bằng POST /feed (packages/app-core/src/api/feed.ts createPost).
  const postP = s.page.waitForResponse((r) => /\/feed(\?.*)?$/.test(r.url()) && r.request().method() === 'POST', { timeout: 20_000 }).catch(() => null);
  await s.page.getByRole('button', { name: /^Đăng$/ }).click();
  const pr = await postP;
  await s.page.waitForTimeout(2500);
  c.ev('POST đăng bài', pr && { status: pr.status(), body: (await pr.json().catch(() => null)) && JSON.stringify(await pr.json().catch(() => null)).slice(0, 200) });
  c.ok('POST /feed → 2xx', pr && pr.status() < 300, pr && pr.status());
  const post = (await sql(`SELECT id, kind, status, body, "likeCount"::int lc FROM feed_posts WHERE "userId" = $1 AND body LIKE 'UAT web%' ORDER BY "createdAt" DESC LIMIT 1`, RID))[0];
  c.ev('feed_posts', post);
  c.ok('DB: có bài QUESTION của uat_returning', !!post && post.kind === 'QUESTION', post);
  if (!post) {
    await s.close();
    return;
  }
  c.ev('trạng thái bài mới (hiển thị ngay hay chờ duyệt)', post.status);
  await nav(s, `/cong-dong/${post.id}`);
  t = await bodyText(s.page);
  c.ok('trang bài hiện nội dung vừa đăng', t.includes('dầu tràm dùng cho bé') || t.includes('4 tháng tuổi'), t.slice(0, 300));
  await c.shot(s.page, 'bai-viet');
  const like = s.page.getByRole('button', { name: /Thích|thích|Hữu ích/ }).first();
  if (await like.count()) {
    const lp = s.page.waitForResponse((r) => /\/feed\/[^/?]+\/react/.test(r.url()), { timeout: 15_000 }).catch(() => null);
    await like.click();
    const lr = await lp;
    await s.page.waitForTimeout(1200);
    const reacts = (await sql(`SELECT count(*)::int n FROM feed_reactions WHERE "postId" = $1`, post.id))[0].n;
    const lc = (await sql(`SELECT "likeCount"::int lc FROM feed_posts WHERE id = $1`, post.id))[0].lc;
    c.ok('thích → 1 dòng feed_reactions và likeCount = 1', reacts === 1 && lc === 1, { status: lr && lr.status(), reacts, lc });
    await like.click();
    await s.page.waitForTimeout(1200);
    const lc2 = (await sql(`SELECT "likeCount"::int lc FROM feed_posts WHERE id = $1`, post.id))[0].lc;
    c.ok('bỏ thích → likeCount về 0', lc2 === 0, lc2);
  } else c.ok('có nút thích trên bài', false, (await s.page.getByRole('button').allInnerTexts()).slice(0, 15));
  const box = s.page.getByPlaceholder('Viết trả lời…');
  if (await box.count()) {
    await box.fill('UAT web: bình luận thử');
    const cp = s.page.waitForResponse((r) => /\/comments/.test(r.url()) && r.request().method() === 'POST', { timeout: 15_000 }).catch(() => null);
    await s.page.getByRole('button', { name: 'Gửi' }).click();
    const cr = await cp;
    await s.page.waitForTimeout(1500);
    const cm = await sql(`SELECT body FROM feed_comments WHERE "postId" = $1`, post.id);
    c.ok('bình luận → 1 dòng feed_comments đúng nội dung', cm.length === 1 && cm[0].body === 'UAT web: bình luận thử', { status: cr && cr.status(), cm });
    t = await bodyText(s.page);
    c.ok('bình luận hiện ngay trên trang', t.includes('UAT web: bình luận thử'));
  } else c.ok('có ô "Viết trả lời…"', false, (await bodyText(s.page)).slice(0, 300));
  await c.shot(s.page, 'bai-viet-binh-luan');
  await s.page.getByRole('button', { name: 'Xoá' }).first().click();
  await s.page.waitForTimeout(700);
  const confirm = s.page.getByRole('dialog').getByRole('button', { name: /^(Xoá|Xóa)$/ });
  if (await confirm.count()) await confirm.click();
  await s.page.waitForTimeout(2500);
  const gone = (await sql(`SELECT status FROM feed_posts WHERE id = $1`, post.id))[0];
  c.ev('bài sau xoá', gone);
  c.ok('xoá bài: bài không còn hiển thị (bị xoá hoặc ẩn)', !gone || !/PUBLISHED|VISIBLE|ACTIVE/i.test(gone.status ?? ''), gone);
  await nav(s, '/cong-dong');
  t = await bodyText(s.page);
  c.ok('feed không còn bài đã xoá', !t.includes('dầu tràm dùng cho bé'), t.slice(0, 200));
  await s.close();
});

// ───────────── U6-71 bảng xếp hạng + sự kiện + chi tiết có dữ liệu
await rec.run('U6-71', { role: 'Khách quay lại', journey: 'Xếp hạng + sự kiện', steps: 'Mở /cong-dong/xep-hang và /cong-dong/su-kien ở 390 và 1440px', expected: 'Hai trang mở được, không lỗi API, không tràn ngang, trạng thái trống có câu hướng dẫn' }, async (c) => {
  for (const w of [390, 1440]) {
    const s = await openWeb(R, { width: w, path: '/' });
    for (const p of ['/cong-dong/xep-hang', '/cong-dong/su-kien']) {
      const r = await nav(s, p);
      const t = await bodyText(s.page);
      const ox = await overflowX(s.page);
      c.ok(`${w} ${p}: mở được, không lỗi API, không tràn ngang`, r.status === 200 && badReqs(r.reqs).length === 0 && ox.sw <= ox.iw + 1, { status: r.status, bad: badReqs(r.reqs), ox });
      c.ok(`${w} ${p}: có nội dung hoặc câu trạng thái trống`, /Chưa có|Bảng xếp hạng|Sự kiện/.test(t), t.slice(0, 160));
      await c.shot(s.page, `${p.split('/').pop()}-${w}`);
    }
    await s.close();
  }
});

// ───────────── U6-72 Vườn Xanh (game)
await rec.run('U6-72', { role: 'Khách mới chưa có SĐT (uat_new_nophone)', journey: 'Vườn Xanh', steps: 'Mở /vuon-xanh; điểm danh; điểm danh lần hai; tưới cây khi chưa đủ giọt nước; góp quỹ khi chưa đủ điểm; trả lời quiz (390px)', expected: 'Điểm danh lần đầu cộng giọt nước + game_profiles.streakDays=1; lần hai bị chặn (DB không đổi); tưới cây thiếu giọt báo rõ không trừ; góp quỹ thiếu điểm báo rõ không trừ điểm; quiz ghi đúng 1 lượt/ngày (game_quiz_attempts)' }, async (c) => {
  const UID = 'uat_new_nophone';
  await sql(`DELETE FROM game_quiz_attempts WHERE "userId" = $1`, UID);
  // Chạy lại trong cùng ngày: đưa Vườn Xanh của khách này về như chưa từng điểm danh.
  await sql(`UPDATE game_profiles SET "lastCheckInAt" = NULL, "streakDays" = 0, "longestStreak" = 0, "totalSeeds" = 0, "lastWateredAt" = NULL, "lastDewAt" = NULL WHERE "userId" = $1`, UID);
  const s = await openWeb('new_nophone', { width: 390, path: '/' });
  const r = await nav(s, '/vuon-xanh');
  let t = await bodyText(s.page);
  c.ok('trang mở được, có cây + "Điểm danh"', /Vườn Xanh/.test(t) && /Điểm danh/.test(t), t.slice(0, 200));
  c.ok('không request API lỗi (ngoài /brand/owner/me)', badReqs(r.reqs).filter((x) => !x.includes('/brand/owner/me')).length === 0, badReqs(r.reqs));
  const ox = await overflowX(s.page);
  c.ok('không tràn ngang', ox.sw <= ox.iw + 1, ox);
  await c.shot(s.page, 'vuon-xanh-dau');
  const pts0 = await ledger(UID);
  const gp0 = (await sql(`SELECT "streakDays" sd FROM game_profiles WHERE "userId" = $1`, UID))[0];
  const user0 = (await sql(`SELECT COALESCE((SELECT "totalSeeds"::int FROM game_profiles WHERE "userId" = $1), 0) AS coins`, UID))[0];
  c.ev('trước', { gp0, user0, pts0 });
  const ci = s.page.getByRole('button', { name: /^Điểm danh$/ }).first();
  const cp = s.page.waitForResponse((x) => /game\/.*check-?in|garden\/.*check-?in/.test(x.url()) && x.request().method() === 'POST', { timeout: 15_000 }).catch(() => null);
  await ci.click();
  const cr = await cp;
  await s.page.waitForTimeout(2500);
  c.ev('POST điểm danh Vườn Xanh', cr && { status: cr.status(), body: JSON.stringify(await cr.json().catch(() => null)).slice(0, 200) });
  const gp1 = (await sql(`SELECT "streakDays" sd FROM game_profiles WHERE "userId" = $1`, UID))[0];
  const user1 = (await sql(`SELECT COALESCE((SELECT "totalSeeds"::int FROM game_profiles WHERE "userId" = $1), 0) AS coins`, UID))[0];
  c.ev('sau điểm danh', { gp1, user1 });
  c.ok('DB: streakDays = 1 sau điểm danh', gp1?.sd === 1, gp1);
  c.ok('giọt nước tăng sau điểm danh', user1.coins > user0.coins, { user0, user1 });
  const again = await call('new_nophone', 'POST', '/game/check-in');
  c.ev('điểm danh Vườn Xanh lần 2 (API)', { status: again.status, body: again.body });
  const gp2 = (await sql(`SELECT "streakDays" sd FROM game_profiles WHERE "userId" = $1`, UID))[0];
  const user2 = (await sql(`SELECT COALESCE((SELECT "totalSeeds"::int FROM game_profiles WHERE "userId" = $1), 0) AS coins`, UID))[0];
  c.ok('điểm danh lần 2 không cộng thêm (DB không đổi)', gp2?.sd === gp1?.sd && user2.coins === user1.coins, { gp1, gp2, user1, user2 });
  // tưới cây khi thiếu giọt
  await sql(`UPDATE game_profiles SET "totalSeeds" = 0 WHERE "userId" = $1`, UID);
  await nav(s, '/vuon-xanh');
  const water = s.page.getByRole('button', { name: /Tưới cây/ }).first();
  await water.click();
  await s.page.waitForTimeout(2000);
  t = await bodyText(s.page);
  c.ev('sau khi tưới thiếu giọt', t.slice(0, 400));
  const coinsAfterWater = (await sql(`SELECT COALESCE((SELECT "totalSeeds"::int FROM game_profiles WHERE "userId" = $1), 0) AS coins`, UID))[0].coins;
  c.ok('tưới cây thiếu giọt: số giọt không âm và có câu báo (đủ/không đủ)', coinsAfterWater >= 0 && /không đủ|chưa đủ|Cần thêm|thiếu|giọt/.test(t), { coinsAfterWater });
  await c.shot(s.page, 'tuoi-cay-thieu-giot');
  // góp quỹ khi thiếu điểm
  const donate = s.page.getByRole('button', { name: /Góp quỹ trồng cây/ }).first();
  if (await donate.count()) {
    await donate.click();
    await s.page.waitForTimeout(2000);
    t = await bodyText(s.page);
    const pts1 = await ledger(UID);
    c.ok('góp quỹ khi 0 điểm: không trừ điểm và có câu báo', pts1.balance === pts0.balance + 0 || pts1.balance >= pts0.balance, { pts0, pts1, text: t.slice(0, 200) });
    c.ok('góp quỹ thiếu điểm hiện câu báo rõ ràng', /không đủ|chưa đủ|thiếu|Cần/.test(t), t.slice(t.indexOf('Góp quỹ'), t.indexOf('Góp quỹ') + 200));
    await c.shot(s.page, 'gop-quy-thieu-diem');
  }
  // quiz
  await nav(s, '/vuon-xanh');
  const quizOpt = s.page.getByRole('button', { name: /Gây ô nhiễm nhiệt nước biển|Sinh vật nhầm vi nhựa/ }).first();
  if (await quizOpt.count()) {
    const qp = s.page.waitForResponse((x) => /quiz/.test(x.url()) && x.request().method() === 'POST', { timeout: 15_000 }).catch(() => null);
    await quizOpt.click();
    const qr = await qp;
    await s.page.waitForTimeout(1500);
    const att = await sql(`SELECT "isCorrect" ok FROM game_quiz_attempts WHERE "userId" = $1`, UID);
    c.ok('quiz: đúng 1 dòng game_quiz_attempts', att.length === 1, { status: qr && qr.status(), att });
    await c.shot(s.page, 'quiz');
  } else c.note('không tìm thấy nút đáp án quiz theo tên (quiz đổi theo ngày)');
  await s.close();
});

// ───────────── U6-73 Đổi rác khi TẮT rồi khi BẬT, thể lệ công khai, so với Mini App
await rec.run('U6-73', { role: 'Khách quay lại + khách ghé', journey: 'Đổi rác', steps: 'waste.enabled=false: mở /doi-rac và /doi-rac/tao; bật waste.enabled + đặt thể lệ có "khoảng ngày": mở /doi-rac, /doi-rac/quy-dinh (đăng nhập và chưa đăng nhập), so với Mini App (390px)', expected: 'Tắt: "Chương trình đang tạm dừng" và không vào được trang tạo; bật: điểm hiển thị khớp /me/loyalty, bảng món + quy đổi khớp cấu hình (carton 1.000 điểm, vỏ chai Tubu 2.000 điểm…); thể lệ hiện cho CẢ khách ghé (trang công khai) với chữ "khoảng ngày"; cùng nội dung với Mini App /recycle' }, async (c) => {
  await setCfg('waste.enabled', false);
  await cfgWait();
  const s = await openWeb(R, { width: 390, path: '/' });
  await nav(s, '/doi-rac');
  let t = await bodyText(s.page);
  c.ok('tắt chương trình: /doi-rac báo "Chương trình đang tạm dừng"', /Chương trình đang tạm dừng/.test(t), t.slice(0, 200));
  await c.shot(s.page, 'doi-rac-tam-dung');
  await nav(s, '/doi-rac/tao');
  t = await bodyText(s.page);
  c.ok('tắt chương trình: /doi-rac/tao không cho tạo yêu cầu', /Chương trình đang tạm dừng/.test(t) && !/Bước 1\/3/.test(t), t.slice(0, 200));
  await setCfg('waste.enabled', true);
  await setCfg('waste.rules_text', 'Thể lệ UAT: chương trình nhận hàng từ khoảng ngày 01 đến khoảng ngày 30 hàng tháng. 1 thùng carton = 1.000 điểm.');
  await cfgWait();
  const loy = (await call(R, 'GET', '/me/loyalty')).body;
  await nav(s, '/doi-rac');
  t = await bodyText(s.page);
  c.ok(`bật: hiện điểm Điểm Xanh ${num(loy.pointsTotal ?? loy.pointsBalance)}`, t.includes(num(loy.pointsTotal ?? loy.pointsBalance)), t.slice(0, 300));
  c.ok('bật: có nút "Đổi rác ngay" + 2 cách (mang tới điểm nhận / gửi về kho Tubu HCM)', /Đổi rác ngay/.test(t) && /Mang tới điểm nhận/.test(t) && /Gửi về kho Tubu HCM/.test(t), t.slice(0, 600));
  c.ok('bảng quy đổi: carton 1.000 điểm, nilon 1.000 điểm, 5 vỏ hộp sữa = 1.000 điểm, vỏ chai Tubu 2.000 điểm', /1 thùng = 1\.000 điểm/.test(t) && /1 túi lớn = 1\.000 điểm/.test(t) && /5 vỏ = 1\.000 điểm/.test(t) && /1 vỏ = 2\.000 điểm/.test(t), t.slice(t.indexOf('Tubu nhận'), t.indexOf('Tubu nhận') + 500));
  await c.shot(s.page, 'doi-rac-bat');
  const mini = await openMini(R, { path: '/' });
  await mini.page.goto('http://localhost:3263/recycle');
  await mini.page.waitForTimeout(4500);
  const mt = await mini.page.evaluate(() => document.body.innerText);
  for (const needle of ['1 thùng = 1.000 điểm', '5 vỏ = 1.000 điểm', '1 vỏ = 2.000 điểm', 'Gửi về kho Tubu HCM', num(loy.pointsTotal ?? loy.pointsBalance)]) {
    c.ok(`Mini App /recycle cũng hiện "${needle}"`, mt.includes(needle) && t.includes(needle), { mini: mt.includes(needle), web: t.includes(needle) });
  }
  await mini.close();
  // thể lệ công khai
  const g = await openWeb('guest', { width: 390, path: '/' });
  const rg = await nav(g, '/doi-rac/quy-dinh');
  const tg = await bodyText(g.page);
  c.ev('thể lệ cho khách ghé', { text: tg.slice(0, 300), bad: badReqs(rg.reqs) });
  c.ok('thể lệ công khai: khách ghé đọc được nội dung có "khoảng ngày"', /khoảng ngày/.test(tg), tg.slice(0, 300));
  await c.shot(g.page, 'quy-dinh-khach');
  await g.close();
  const rl = await nav(s, '/doi-rac/quy-dinh');
  const tl = await bodyText(s.page);
  c.ok('thể lệ khi đã đăng nhập hiện nội dung có "khoảng ngày"', /khoảng ngày/.test(tl), tl.slice(0, 300));
  c.ok('trang thể lệ không phát sinh request lỗi 401/403', badReqs(rl.reqs).length === 0, badReqs(rl.reqs));
  await c.shot(s.page, 'quy-dinh-dang-nhap');
  await s.close();
});

// ───────────── U6-74 tính năng cần xác minh SĐT: web hiện thông báo "mở Mini App" (Q2)
await rec.run('U6-74', { role: 'Khách chưa có SĐT (uat_new_nophone) so với khách đã xác minh', journey: 'Thông báo mở Mini App (Q2)', steps: 'Khi chương trình đổi rác bật: mở /doi-rac, /doi-rac/tao, /doi-rac/diem-nhan, /doi-rac/yeu-cau bằng khách không SĐT và khách có SĐT (390px)', expected: 'Khách không SĐT thấy câu "Tính năng này cần mở Tubu Tree trên Zalo." thay vì chức năng; khách có SĐT dùng được; khách không SĐT vẫn mua hàng và điểm danh được trên web (Q2: web không bắt xác minh)' }, async (c) => {
  await setCfg('waste.enabled', true);
  await cfgWait();
  const a = await openWeb('new_nophone', { width: 390, path: '/' });
  const b = await openWeb(R, { width: 390, path: '/' });
  for (const p of ['/doi-rac', '/doi-rac/tao', '/doi-rac/diem-nhan', '/doi-rac/yeu-cau']) {
    await nav(a, p);
    await nav(b, p);
    const ta = await bodyText(a.page);
    const tb = await bodyText(b.page);
    c.ev(`${p} khách không SĐT`, ta.slice(0, 200));
    c.ok(`${p}: khách KHÔNG SĐT thấy "cần mở Tubu Tree trên Zalo"`, /cần mở Tubu Tree trên Zalo/.test(ta), ta.slice(0, 250));
    c.ok(`${p}: khách CÓ SĐT không bị chặn bởi thông báo đó`, !/cần mở Tubu Tree trên Zalo/.test(tb), tb.slice(0, 250));
    if (p === '/doi-rac/tao') await c.shot(a.page, 'q2-doi-rac-tao');
    if (p === '/doi-rac/yeu-cau') await c.shot(a.page, 'q2-doi-rac-yeu-cau');
  }
  await nav(a, '/doi-rac');
  await c.shot(a.page, 'q2-doi-rac');
  await a.close();
  await b.close();
});

// ───────────── U6-75 phân quyền: khách thường không vào được khu CTV/đại lý/nhân viên/quản trị (web + API)
await rec.run('U6-75', { role: 'Khách quay lại (CUSTOMER)', journey: 'Phân quyền', steps: 'Mở /admin, /nhan-vien, /nhan-vien/bang-luong, /hoc-vien, /chu-thuong-hieu trên web; gọi API quản trị/nhân viên/CTV bằng token khách (390px)', expected: 'Web: câu từ chối dễ hiểu, không lộ dữ liệu, không trang trắng; API: /admin/*, /staff/* trả 403, không trả dữ liệu người khác' }, async (c) => {
  const s = await openWeb(R, { width: 390, path: '/' });
  const expectText = {
    '/admin': /không có quyền truy cập trang quản trị/,
    '/nhan-vien': /Liên hệ quản trị để được cấp quyền|dành cho nhân viên/,
    '/nhan-vien/bang-luong': /dành cho nhân viên/,
    '/chu-thuong-hieu': /chưa được cấp quyền quản lý nhãn/,
  };
  for (const [p, re] of Object.entries(expectText)) {
    await nav(s, p);
    const t = await bodyText(s.page);
    c.ok(`${p}: câu từ chối rõ ràng, không lộ dữ liệu`, re.test(t), t.slice(0, 200));
  }
  const r = await nav(s, '/hoc-vien');
  const th = await bodyText(s.page);
  c.ev('/hoc-vien với khách thường', { text: th.slice(0, 250), bad: badReqs(r.reqs) });
  c.ok('/hoc-vien (CTV Academy): khách thường thấy lời mời/giải thích, không phải lỗi thô "Bạn không có quyền truy cập tài nguyên này" kèm nút Thử lại', !/Bạn không có quyền truy cập tài nguyên này/.test(th), th.slice(0, 250));
  await c.shot(s.page, 'hoc-vien-khach-thuong');
  for (const p of ['/admin/users', '/admin/orders', '/admin/config', '/staff/today', '/affiliate/dashboard', '/dealer/orders']) {
    const x = await call(R, 'GET', p);
    const own = ['/affiliate/dashboard', '/dealer/orders'].includes(p);
    if (own) {
      // Hai đường này trả dữ liệu theo chính người gọi: khách chưa làm CTV/đại lý nhận 200 với số 0 hoặc danh sách rỗng, không lộ dữ liệu người khác.
      const empty = Array.isArray(x.body) ? x.body.length === 0 : Object.values(x.body ?? {}).every((v) => typeof v !== 'number' || v === 0);
      c.ok(`API GET ${p} với token khách: 401/403/404, hoặc 200 chỉ gồm số 0/danh sách rỗng của chính họ`, [401, 403, 404].includes(x.status) || (x.status === 200 && empty), { status: x.status, body: JSON.stringify(x.body).slice(0, 160) });
    } else c.ok(`API GET ${p} với token khách → 401/403/404 (không 200)`, [401, 403, 404].includes(x.status), { status: x.status, body: JSON.stringify(x.body).slice(0, 120) });
  }
  const adm = await call(R, 'PUT', '/admin/config', { key: 'waste.gift_claim_days', value: 1 });
  c.ok('API PUT /admin/config với token khách → 401/403/404', [401, 403, 404].includes(adm.status), adm.status);
  c.ok('cấu hình waste.gift_claim_days không bị khách đổi (vẫn 60)', (await sql(`SELECT value v FROM system_configs WHERE key = 'waste.gift_claim_days'`))[0].v === 60);
  await s.close();
});

// ───────────── U6-76 trang lỗi, mã sai, IDOR trang chuyển khoản
await rec.run('U6-76', { role: 'Khách quay lại, khách mới, khách ghé', journey: 'Trang lỗi và IDOR', steps: 'Mở sản phẩm/gian hàng/đơn không tồn tại; khách khác mở trang QR chuyển khoản của đơn người khác; khách ghé mở QR (390px)', expected: 'Trang 404 thân thiện có đường quay về; trang QR của đơn người khác trả 404 và KHÔNG lộ STK/số tiền/mã đơn; khách ghé bị mời đăng nhập' }, async (c) => {
  const g = await openWeb('guest', { width: 390, path: '/' });
  let r = await nav(g, '/san-pham/khong-ton-tai-abc');
  let t = await bodyText(g.page);
  c.ok('sản phẩm không tồn tại: 404 + câu thân thiện + đường quay về', r.status === 404 && /không tìm thấy|không tồn tại|404/i.test(t), { status: r.status, text: t.slice(0, 200) });
  await c.shot(g.page, '404-san-pham');
  r = await nav(g, '/s/khong-co-gian-hang');
  t = await bodyText(g.page);
  c.ok('gian hàng không tồn tại: 404 + câu thân thiện', r.status === 404, { status: r.status, text: t.slice(0, 160) });
  r = await nav(g, '/tai-khoan/don-hang/TUBU0000000000000');
  t = await bodyText(g.page);
  c.ok('khách ghé mở đơn: mời đăng nhập, không lộ gì', /Đăng nhập/.test(t) && !/Đơn hàng #/.test(t), t.slice(0, 200));
  await g.close();
  // tạo đơn chuyển khoản của returning
  await clearCart(R);
  await call(R, 'POST', '/cart/items', { variationId: await variantId('COBOTE-TR-50'), quantity: 1 });
  const addr = (await sql(`SELECT id FROM addresses WHERE "userId" = $1 ORDER BY "isDefault" DESC LIMIT 1`, RID))[0].id;
  const po = await call(R, 'POST', '/checkout/place-order', { addressId: addr, paymentMethod: 'BANK_TRANSFER' });
  const code = po.body?.code ?? po.body?.orders?.[0]?.code;
  c.ok('dựng đơn chuyển khoản của returning', !!code, po);
  const q1 = await call('new', 'GET', `/payments/bank-qr/${code}`);
  c.ok('API: khách khác lấy QR đơn của returning → 404', q1.status === 404, { status: q1.status, body: JSON.stringify(q1.body).slice(0, 150) });
  const q0 = await call('guest', 'GET', `/payments/bank-qr/${code}`).catch(() => ({ status: 0 }));
  c.ev('khách ghé gọi QR', q0.status);
  const sn = await openWeb('new', { width: 390, path: '/' });
  r = await nav(sn, `/thanh-toan/chuyen-khoan/${code}`);
  t = await bodyText(sn.page);
  c.ok('web: khách khác mở trang QR đơn người khác → không lộ STK/số tiền/mã đơn', !t.includes('8386790906') && !t.includes(code) && !t.includes('Techcombank'), t.slice(0, 250));
  await c.shot(sn.page, 'idor-qr');
  await sn.close();
  await call(R, 'POST', `/orders/${code}/cancel`, {});
  await clearCart(R);
});

// dọn: trả cấu hình đổi rác về mặc định lane (tắt, thể lệ trống)
await setCfg('waste.enabled', false);
await setCfg('waste.rules_text', '');
await finish(rec);
