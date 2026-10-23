// Nhóm F: tài khoản khách trên web. Hub số dư, hồ sơ, Điểm Xanh (số dư + sổ + điểm danh), Ví Tubu, yêu thích, thông báo, cài đặt, sổ địa chỉ.
// Số dư/sổ luôn đối chiếu DB; mỗi màn so với Mini App cùng dữ liệu.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  L, Recorder, finish, openWeb, openMini, nav, bodyText, badReqs, overflowX, sql, call, clearCart, vnd, sleep, ledger,
} from './_lib.mjs';

const rec = new Recorder('f-account');
const WIDTHS = [390, 1440];
const HERE = path.dirname(fileURLToPath(import.meta.url));
const miniShot = (name) => path.join(HERE, '../../shots/U6-web-khach', name);
const num = (n) => new Intl.NumberFormat('vi-VN').format(n);
const R = 'returning';
const RID = 'uat_returning';

async function mini(user, p, wait = 4500) {
  const m = await openMini(user, { path: '/' });
  await m.page.goto(`http://localhost:3263${p}`);
  await m.page.waitForTimeout(wait);
  const t = await m.page.evaluate(() => document.body.innerText);
  return { m, t };
}

// ───────────── U6-60 hub tài khoản
for (const w of WIDTHS) {
  await rec.run(`U6-60-${w}`, { role: 'Khách quay lại (Lộc Biếc)', journey: 'Hub Tài khoản', steps: `Mở /tai-khoan, đối chiếu từng con số với DB, mở từng mục menu (${w}px)`, expected: 'Điểm Xanh = users.pointsBalance + pointsConvertedBalance; Ví Tubu = users.walletBalance; số mã giảm giá = GET /me/coupons; mã giới thiệu = users.referralCode; tên + hạng đúng DB; "Đơn hàng của tôi (N)" = số đơn DB; mỗi mục menu mở được không lỗi; không tràn ngang; cùng số với Mini App /profile' }, async (c) => {
    const [u] = await sql(`SELECT "pointsBalance"::int pb, "pointsConvertedBalance"::int pc, "walletBalance"::int wb, "referralCode" rc, "fullName" fn, "tierId" t FROM users WHERE id = $1`, RID);
    const coupons = (await call(R, 'GET', '/me/coupons')).body ?? [];
    const nOrders = (await sql(`SELECT count(*)::int n FROM orders WHERE "userId" = $1`, RID))[0].n;
    const s = await openWeb(R, { width: w, path: '/' });
    const r = await nav(s, '/tai-khoan');
    const t = await bodyText(s.page);
    c.ev('DB', { ...u, coupons: coupons.length, nOrders });
    c.ok(`Điểm Xanh hiện ${num(u.pb + u.pc)} (= pointsBalance ${u.pb} + quy đổi ${u.pc})`, t.includes(num(u.pb + u.pc)), t.slice(t.indexOf('Mã giới thiệu'), t.indexOf('Mã giới thiệu') + 200));
    c.ok(`Ví Tubu hiện ${vnd(u.wb)}`, t.includes(`${vnd(u.wb)}`), '');
    c.ok(`"${coupons.length} mã" giảm giá khớp /me/coupons`, t.includes(`${coupons.length} mã`), coupons.map((x) => x.code));
    c.ok(`mã giới thiệu ${u.rc}`, t.includes(u.rc));
    c.ok(`tên "${u.fn}" và hạng "Lộc Biếc"`, t.includes(u.fn) && t.includes('Lộc Biếc'));
    // Khổ điện thoại (PR #24): hub giống Mini App, danh sách đơn nằm ở tab "Đơn hàng"; khối "Đơn hàng của tôi (N)" chỉ còn từ md.
    if (w >= 768) c.ok(`"Đơn hàng của tôi (${nOrders})"`, t.includes(`Đơn hàng của tôi (${nOrders})`), t.slice(t.indexOf('Đơn hàng của tôi'), t.indexOf('Đơn hàng của tôi') + 40));
    else c.ok('hub có đường vào "Đơn hàng" (thanh tab dưới)', (await s.page.locator('a[href="/tai-khoan/don-hang"]').count()) > 0, t.slice(-80));
    const links = await s.page.locator('main a[href^="/"]').evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute('href')))].filter((h) => !h.startsWith('/tai-khoan/don-hang/')));
    c.ev('các liên kết trên hub', links);
    const bad = [];
    for (const h of links.filter((x) => !/^\/(san-pham|gio-hang)?$/.test(x)).slice(0, 14)) {
      const rr = await nav(s, h, { wait: 700 });
      const tt = await bodyText(s.page);
      if (rr.status >= 400 || badReqs(rr.reqs).some((x) => / 5\d\d$/.test(x)) || /Application error|Internal Server Error/.test(tt)) bad.push({ h, status: rr.status, reqs: badReqs(rr.reqs) });
    }
    c.ok('mọi liên kết menu mở được, không 5xx/trang lỗi', bad.length === 0, bad);
    await nav(s, '/tai-khoan');
    const ox = await overflowX(s.page);
    c.ok('không tràn ngang', ox.sw <= ox.iw + 1, ox);
    c.ok('không request API lỗi khi vào hub (ngoài /brand/owner/me)', badReqs(r.reqs).filter((x) => !x.includes('/brand/owner/me')).length === 0, badReqs(r.reqs));
    const brandNoise = badReqs(r.reqs).filter((x) => x.includes('/brand/owner/me'));
    if (brandNoise.length) c.note('mỗi lần tải hub (và mọi trang đã đăng nhập) gọi GET /brand/owner/me → 404 + 1 lỗi console (nhiễu, xem U6-B05)');
    await c.shot(s.page, `hub-${w}`);
    if (w === 390) {
      const { m, t: mt } = await mini(R, '/profile');
      for (const [label, val] of [['Điểm Xanh', num(u.pb + u.pc)], ['mã giảm giá', `${coupons.length} mã`], ['mã giới thiệu', u.rc], ['Ví Tubu', vnd(u.wb)]]) {
        c.ok(`Mini App /profile cùng hiện ${label} (${val})`, mt.includes(val), mt.slice(0, 300));
      }
      await m.page.screenshot({ path: miniShot('U6-60-mini-profile.png') });
      await m.close();
    }
    await s.close();
  });
}

// ───────────── U6-61 sửa hồ sơ (dùng uat_new_nophone để không làm bẩn dữ liệu khách chính)
await rec.run('U6-61', { role: 'Khách mới chưa có SĐT (uat_new_nophone)', journey: 'Sửa hồ sơ', steps: 'Mở /tai-khoan/ho-so; nhập email sai → báo lỗi; nhập tên + email + ngày sinh hợp lệ → Lưu; tải lại; thử sửa ngày sinh lần hai (390px)', expected: 'Email sai: lỗi "Email không hợp lệ" và nút Lưu khoá; lưu đúng → users.fullName/email/dob cập nhật; ngày sinh chỉ đặt một lần (ô khoá sau khi có); SĐT hiển thị "Chưa có số điện thoại" và không sửa được ở đây' }, async (c) => {
  const UID = 'uat_new_nophone';
  const before = (await sql(`SELECT "fullName" fn, email, dob FROM users WHERE id = $1`, UID))[0];
  c.ev('trước', before);
  const s = await openWeb('new_nophone', { width: 390, path: '/' });
  await nav(s, '/tai-khoan/ho-so');
  let t = await bodyText(s.page);
  // Mini App không có khối số điện thoại ở màn sửa hồ sơ; web giữ khối này từ md (ho-so/page.tsx, max-md:hidden).
  c.ok('khổ 390: không có khối SĐT, giống Mini App (web không xác minh SĐT, Q2)', !/Số điện thoại/.test(t), t.slice(0, 200));
  const sw = await openWeb('new_nophone', { width: 1440, path: '/' });
  await nav(sw, '/tai-khoan/ho-so');
  const tw = await bodyText(sw.page);
  c.ok('khổ 1440: SĐT hiện "Chưa có số điện thoại"', /Chưa có số điện thoại/.test(tw), tw.slice(tw.indexOf('Số điện thoại'), tw.indexOf('Số điện thoại') + 80));
  await sw.close();
  const email = s.page.getByLabel('Email');
  await email.fill('khong-hop-le');
  await email.blur();
  await s.page.waitForTimeout(400);
  t = await bodyText(s.page);
  c.ok('email sai → "Email không hợp lệ" + nút Lưu bị khoá', /Email không hợp lệ/.test(t) && (await s.page.getByRole('button', { name: 'Lưu thay đổi' }).isDisabled()));
  await c.shot(s.page, 'ho-so-email-sai');
  await s.page.getByLabel('Họ và tên').fill('Trần Chưa Số Đã Sửa');
  await email.fill('uat.nophone@example.com');
  if (!before.dob) await s.page.getByLabel('Ngày sinh').fill('1995-03-14');
  const saveP = s.page.waitForResponse((r) => /\/me\/profile|\/me$/.test(r.url()) && ['PATCH', 'PUT', 'POST'].includes(r.request().method()), { timeout: 20_000 }).catch(() => null);
  await s.page.getByRole('button', { name: 'Lưu thay đổi' }).click();
  const sr = await saveP;
  await s.page.waitForTimeout(1500);
  c.ev('lưu hồ sơ', sr && { method: sr.request().method(), status: sr.status(), url: sr.url().replace(L.apiUrl127 ?? '', '') });
  c.ok('lưu hồ sơ → 2xx', sr && sr.status() < 300, sr && sr.status());
  const after = (await sql(`SELECT "fullName" fn, email, dob FROM users WHERE id = $1`, UID))[0];
  c.ev('sau', after);
  c.ok('DB: fullName + email đã đổi', after.fn === 'Trần Chưa Số Đã Sửa' && after.email === 'uat.nophone@example.com', after);
  if (!before.dob) c.ok('DB: dob = 1995-03-14', String(after.dob).startsWith('1995-03-14'), after.dob);
  await nav(s, '/tai-khoan/ho-so');
  const dobRO = await s.page.getByLabel('Ngày sinh').evaluate((e) => e.readOnly);
  c.ok('ngày sinh đã đặt thì ô bị khoá (chỉ đặt một lần)', dobRO === true, dobRO);
  t = await bodyText(s.page);
  c.ok('hiện câu "Ngày sinh chỉ đặt được một lần"', /chỉ đặt được một lần/.test(t));
  await c.shot(s.page, 'ho-so-da-luu');
  await s.close();
  // khôi phục để lần chạy sau lặp lại được
  await sql(`UPDATE users SET "fullName" = $2, email = $3, dob = NULL WHERE id = $1`, UID, before.fn, before.email);
});

// ───────────── U6-62 trang Điểm Xanh: số dư, sổ, hết hạn, điểm đang chờ, mã giảm giá
for (const w of WIDTHS) {
  await rec.run(`U6-62-${w}`, { role: 'Khách quay lại (Lộc Biếc)', journey: 'Điểm Xanh', steps: `Mở /tai-khoan/diem-xanh và đối chiếu sổ điểm với DB (${w}px)`, expected: 'Tổng điểm = pointsBalance; "điểm đang chờ" = lockedPoints của /me/loyalty; điểm sắp hết hạn + ngày = lô sớm nhất trong DB; mỗi dòng lịch sử (số điểm có dấu, ngày, "Hết hạn" = +12 tháng) khớp points_transactions; "Còn X triệu để lên hạng" khớp spent12m; danh sách mã giảm giá = /me/coupons; cùng nội dung với Mini App' }, async (c) => {
    const [u] = await sql(`SELECT "pointsBalance"::int pb FROM users WHERE id = $1`, RID);
    const loy = (await call(R, 'GET', '/me/loyalty')).body;
    const rows = await sql(`SELECT delta::int, reason, "refId", "expiresAt", "createdAt", lot FROM points_transactions WHERE "userId" = $1 ORDER BY "createdAt" DESC LIMIT 100`, RID);
    const ld = await ledger(RID);
    c.ev('loyalty', { pointsBalance: loy.pointsBalance, lockedPoints: loy.lockedPoints, lockedUntil: loy.lockedUntil, redeemable: loy.redeemablePoints, expiring: loy.expiringPoints, spent12m: loy.spent12m });
    c.ok('DB: pointsBalance = SUM(sổ STANDARD)', ld.balance === ld.ledgerSum, ld);
    const s = await openWeb(R, { width: w, path: '/' });
    const r = await nav(s, '/tai-khoan/diem-xanh');
    const t = await bodyText(s.page);
    c.ok(`tổng điểm hiển thị ${num(loy.pointsTotal ?? loy.pointsBalance)}`, t.includes(`${num(loy.pointsTotal ?? loy.pointsBalance)} Điểm Xanh`), t.slice(t.indexOf('Tích điểm'), t.indexOf('Tích điểm') + 120));
    const lockDate = (loy.lockedPoints ?? 0) - (loy.lockedReturnPoints ?? 0);
    // Chủ chốt U6-B06 (2026-10-20): bỏ dòng "điểm đang chờ, mở khoá ngày" ở mọi khổ (theo Mini App). Commit d0e4bee3 bỏ luôn dòng "điểm đang chờ xử lý đổi/trả" cùng hàm lockedPointsLines.
    c.ok('không còn dòng "điểm đang chờ, mở khoá ngày" (U6-B06)', !/điểm đang chờ, mở khoá ngày|điểm đang chờ/.test(t), { lockedPoints: loy.lockedPoints, lockedReturnPoints: loy.lockedReturnPoints, lockedUntil: loy.lockedUntil });
    if ((loy.lockedReturnPoints ?? 0) > 0) c.note(`Dòng "${num(loy.lockedReturnPoints)} điểm đang chờ xử lý đổi/trả" cũng không còn trên trang Điểm Xanh (cùng hàm bị xoá ở d0e4bee3); Mini App không có dòng này. Số điểm khoá vẫn nằm ở trang thanh toán.`);
    if (loy.expiringPoints) c.ok(`"${num(loy.expiringPoints.amount)} Điểm Xanh sẽ hết hạn" đúng lô sớm nhất`, t.includes(`${num(loy.expiringPoints.amount)} Điểm Xanh sẽ hết hạn`), t.slice(t.indexOf('sẽ hết hạn') - 30, t.indexOf('sẽ hết hạn') + 40));
    const exp = (await sql(`SELECT min("expiresAt") m FROM points_transactions WHERE "userId" = $1 AND delta > 0 AND "expiresAt" > now() AND lot = 'STANDARD'`, RID))[0].m;
    c.ev('lô điểm sớm hết hạn nhất (DB)', exp);
    // dòng lịch sử
    const hist = t.slice(t.indexOf('Lịch sử Điểm Xanh'));
    const shown = [...hist.matchAll(/([+−-])\s?([\d.]+)\n/g)].map((x) => `${x[1] === '+' ? '' : '-'}${x[2].replace(/\./g, '')}`.replace(/^$/, ''));
    const shownNums = shown.map(Number).sort((a, b) => a - b);
    const dbNums = rows.map((x) => x.delta).sort((a, b) => a - b);
    c.ev('lịch sử trên trang', shownNums);
    c.ev('lịch sử DB (≤100)', dbNums);
    c.ok(`lịch sử: ${dbNums.length} dòng, từng số điểm khớp DB`, JSON.stringify(shownNums) === JSON.stringify(dbNums), { shown: shownNums, db: dbNums });
    const exp12 = rows.filter((x) => x.delta > 0 && x.expiresAt).every((x) => {
      const d = new Date(x.createdAt);
      d.setMonth(d.getMonth() + 12);
      return Math.abs(new Date(x.expiresAt) - d) < 2 * 86400_000;
    });
    c.ok('DB: mỗi lô cộng điểm có hạn = ngày nhận + 12 tháng', exp12, rows.filter((x) => x.delta > 0).map((x) => `${x.createdAt?.slice?.(0, 10)}→${x.expiresAt?.slice?.(0, 10)}`));
    const cps = (await call(R, 'GET', '/me/coupons')).body ?? [];
    c.ok(`mã giảm giá của tôi: ${cps.length} mã khớp /me/coupons`, cps.every((x) => t.includes(`Mã ${x.code}`)) && t.includes(`${cps.length} mã`), cps.map((x) => x.code));
    c.ok('có dòng luật "Tích 2% tiền hàng" và "1 điểm = 1đ … tối đa 20% giá trị đơn"', /Tích 2% tiền hàng/.test(t) && /1 điểm = 1đ/.test(t) && /tối đa 20%/.test(t));
    c.ok('Điểm Xanh có hạn 12 tháng được nêu', /hạn 12 tháng/.test(t));
    const ox = await overflowX(s.page);
    c.ok('không tràn ngang', ox.sw <= ox.iw + 1, ox);
    c.ok('không request API lỗi (ngoài /brand/owner/me)', badReqs(r.reqs).filter((x) => !x.includes('/brand/owner/me')).length === 0, badReqs(r.reqs));
    await c.shot(s.page, `diem-xanh-${w}`);
    if (w === 390) {
      const { m, t: mt } = await mini(R, '/loyalty');
      const lines = (x) => x.split('\n').map((l) => l.trim()).filter(Boolean);
      const webLines = new Set(lines(t));
      const miniLines = lines(mt);
      const onlyMini = miniLines.filter((l) => !webLines.has(l));
      const onlyWeb = [...webLines].filter((l) => !lines(mt).includes(l) && !/^(Tìm sản phẩm|N|Lại|← Tài khoản|Điều khoản|Bảo mật|Đổi trả|Vận chuyển|Facebook|TikTok|Hotline|Hỗ trợ|tubutree|Sống xanh)/.test(l));
      c.ev('dòng chỉ có ở Mini App', onlyMini.slice(0, 15));
      c.ev('dòng chỉ có ở web', onlyWeb.slice(0, 15));
      c.ok('web và Mini App cùng hiện số điểm + mã giảm giá + điểm danh', mt.includes(num(loy.pointsTotal ?? loy.pointsBalance)) && mt.includes('Điểm danh +1000'), mt.slice(0, 200));
      c.ok('Mini App cũng không có dòng "điểm đang chờ" (khớp web sau U6-B06)', !/điểm đang chờ/.test(mt), mt.slice(0, 120));
      await m.page.screenshot({ path: miniShot('U6-62-mini-loyalty.png') });
      await m.close();
    }
    await s.close();
  });
}

// ───────────── U6-63 điểm danh Điểm Xanh (khách mới không SĐT) + bấm lần hai
await rec.run('U6-63', { role: 'Khách mới chưa có SĐT (uat_new_nophone)', journey: 'Điểm danh Điểm Xanh', steps: 'Mở /tai-khoan/diem-xanh, bấm "Điểm danh +1000", bấm lại (390px)', expected: 'Lần đầu: +1.000 điểm (ngày 1 của chu kỳ), 1 dòng sổ + loyalty_check_ins (dayKey hôm nay, cycleDay 1, streak 1), pointsBalance tăng đúng 1.000 = SUM(sổ), nút chuyển "đã điểm danh"; bấm lần hai không cộng thêm (DB không đổi). Q2: web không bắt xác minh SĐT để điểm danh' }, async (c) => {
  const UID = 'uat_new_nophone';
  // Đặt lại để chạy lại trong cùng ngày được: dòng sổ CHECKIN có unique riêng (userId, refId=dayKey), xoá loyalty_check_ins thôi thì POST vẫn bị P2002.
  for (const r of await sql(`SELECT id, delta::int AS d FROM points_transactions WHERE "userId" = $1 AND "refType" = 'CHECKIN' AND lot = 'STANDARD'`, UID)) {
    await sql(`DELETE FROM points_transactions WHERE id = $1`, r.id);
    await sql(`UPDATE users SET "pointsBalance" = "pointsBalance" - $2::int WHERE id = $1`, UID, r.d);
  }
  await sql(`DELETE FROM loyalty_check_ins WHERE "userId" = $1`, UID);
  const before = await ledger(UID);
  const s = await openWeb('new_nophone', { width: 390, path: '/' });
  await nav(s, '/tai-khoan/diem-xanh');
  const btn = s.page.getByRole('button', { name: /Điểm danh \+1000|Điểm danh/ }).first();
  c.ok('có nút "Điểm danh +1000"', (await btn.count()) > 0 && /Điểm danh/.test(await btn.innerText()), await btn.innerText().catch(() => ''));
  const respP = s.page.waitForResponse((r) => /check-in/.test(r.url()) && r.request().method() === 'POST', { timeout: 20_000 }).catch(() => null);
  await btn.click();
  const resp = await respP;
  await s.page.waitForTimeout(2500);
  c.ev('POST điểm danh', resp && { status: resp.status(), body: await resp.json().catch(() => null) });
  c.ok('POST điểm danh → 2xx', resp && resp.status() < 300, resp && resp.status());
  const ci = await sql(`SELECT "cycleDay" cd, "streakDays" sd, points::int p, "dayKey" dk FROM loyalty_check_ins WHERE "userId" = $1`, UID);
  c.ev('loyalty_check_ins', ci);
  c.ok('DB: đúng 1 dòng điểm danh, ngày 1, +1.000, streak 1', ci.length === 1 && ci[0].cd === 1 && ci[0].p === 1000 && ci[0].sd === 1, ci);
  const mid = await ledger(UID);
  c.ok('pointsBalance +1.000 và = SUM(sổ)', mid.balance === before.balance + 1000 && mid.balance === mid.ledgerSum, { before, mid });
  const t = await bodyText(s.page);
  c.ok('trang hiện "Đã điểm danh" / chuỗi 1 ngày và số dư 1.000', /đã điểm danh|Chuỗi: 1 ngày/i.test(t) && /1\.000 (điểm|Điểm Xanh)/.test(t), t.slice(t.indexOf('Điểm danh nhận'), t.indexOf('Điểm danh nhận') + 200));
  await c.shot(s.page, 'diem-danh-xong');
  // lần hai: gọi thẳng API để chắc chắn BE chặn
  const again = await call('new_nophone', 'POST', '/me/loyalty/check-in');
  c.ev('điểm danh lần 2 qua API', { status: again.status, body: again.body });
  const end = await ledger(UID);
  c.ok('điểm danh lần 2 không cộng thêm điểm (DB không đổi)', end.balance === mid.balance && (await sql(`SELECT count(*)::int n FROM loyalty_check_ins WHERE "userId" = $1`, UID))[0].n === 1, { mid, end, again: again.status });
  await s.close();
});

// ───────────── U6-64 Ví Tubu: số dư và lịch sử (cấp số dư bằng SQL cho khách không SĐT), nút Rút
await rec.run('U6-64', { role: 'Khách mới chưa có SĐT (uat_new_nophone)', journey: 'Ví Tubu', steps: 'Cấp ví 150.000đ bằng SQL + 1 dòng sổ ví; mở /tai-khoan/vi-tubu; bấm "Rút ngân hàng" (390 và 1440px)', expected: 'Số dư = walletBalance = SUM(wallet_transactions); lịch sử hiện đúng dòng +150.000đ; "Rút ngân hàng" khách chưa có SĐT được hướng dẫn rõ (không lỗi trắng); không có chữ "xu"' }, async (c) => {
  const UID = 'uat_new_nophone';
  await sql(`DELETE FROM wallet_transactions WHERE "userId" = $1`, UID);
  await sql(`UPDATE users SET "walletBalance" = 150000 WHERE id = $1`, UID);
  await sql(`INSERT INTO wallet_transactions (id, "userId", delta, "balanceAfter", type, "refType", reason, "createdAt") VALUES (md5(random()::text), $1, 150000, 150000, 'ADJUST', 'UAT', 'Cấp thử UAT', now())`, UID);
  try {
    for (const w of WIDTHS) {
      const s = await openWeb('new_nophone', { width: w, path: '/' });
      const r = await nav(s, '/tai-khoan/vi-tubu');
      const t = await bodyText(s.page);
      const wsum = (await sql(`SELECT COALESCE(SUM(delta),0)::int s FROM wallet_transactions WHERE "userId" = $1`, UID))[0].s;
      c.ok(`${w}: số dư ${vnd(150000)} = SUM(sổ ví) ${wsum}`, t.includes('150.000đ') && wsum === 150000, t.slice(t.indexOf('số dư khả dụng'), t.indexOf('số dư khả dụng') + 60));
      c.ok(`${w}: lịch sử có dòng +150.000đ`, /\+150\.000đ/.test(t), t.slice(t.indexOf('Lịch sử Ví'), t.indexOf('Lịch sử Ví') + 160));
      c.ok(`${w}: không có chữ "xu"`, !/\bxu\b/i.test(t.replace(/\bxu cũ\b/i, '')), (t.match(/.{20}\bxu\b.{20}/gi) ?? []).slice(0, 3));
      const ox = await overflowX(s.page);
      c.ok(`${w}: không tràn ngang`, ox.sw <= ox.iw + 1, ox);
      if (w === 390) {
        await c.shot(s.page, 'vi-tubu-390');
        await s.page.getByRole('button', { name: /Rút ngân hàng/ }).click();
        await s.page.waitForTimeout(1500);
        const t2 = await bodyText(s.page);
        c.ev('sau khi bấm Rút ngân hàng', t2.slice(0, 700));
        c.ok('bấm "Rút ngân hàng": có biểu mẫu/hướng dẫn hiển thị (không im lặng)', t2 !== t, t2.slice(0, 300));
        await c.shot(s.page, 'vi-tubu-rut');
      } else await c.shot(s.page, 'vi-tubu-1440');
      c.ok(`${w}: không request API lỗi (ngoài /brand/owner/me)`, badReqs(r.reqs).filter((x) => !x.includes('/brand/owner/me')).length === 0, badReqs(r.reqs));
      await s.close();
    }
  } finally {
    await sql(`DELETE FROM wallet_transactions WHERE "userId" = $1`, UID);
    await sql(`UPDATE users SET "walletBalance" = 0 WHERE id = $1`, UID);
  }
});

// ───────────── U6-65 yêu thích
await rec.run('U6-65', { role: 'Khách quay lại + khách chưa đăng nhập', journey: 'Sản phẩm yêu thích', steps: 'Khách ghé: bấm tim trên PDP → mời đăng nhập; khách đăng nhập: bấm tim → /tai-khoan/yeu-thich có sản phẩm; bỏ tim → trống (390px)', expected: 'Khách ghé bị đưa tới /dang-nhap có returnTo; khách đăng nhập: wishlists có dòng đúng productId, trang yêu thích hiện sản phẩm, bỏ tim thì dòng DB mất' }, async (c) => {
  const prod = (await sql(`SELECT id, name FROM products WHERE slug = 'dau-tram-be-cobote'`))[0];
  await sql(`DELETE FROM wishlists WHERE "userId" = $1`, RID);
  const g = await openWeb('guest', { width: 390, path: '/' });
  await nav(g, '/san-pham/dau-tram-be-cobote');
  await g.page.getByRole('button', { name: /yêu thích/i }).first().click();
  await g.page.waitForTimeout(2500);
  c.ok('khách ghé bấm tim → sang /dang-nhap có returnTo về sản phẩm', /\/dang-nhap/.test(g.page.url()) && /returnTo=%2Fsan-pham%2Fdau-tram-be-cobote|returnTo=\/san-pham\/dau-tram-be-cobote/.test(g.page.url()), g.page.url());
  await g.close();
  const s = await openWeb(R, { width: 390, path: '/' });
  await nav(s, '/san-pham/dau-tram-be-cobote');
  const heart = s.page.getByRole('button', { name: /yêu thích/i }).first();
  const addP = s.page.waitForResponse((r) => /\/me\/wishlist/.test(r.url()) && r.request().method() === 'POST', { timeout: 15_000 }).catch(() => null);
  await heart.click();
  const ar = await addP;
  await s.page.waitForTimeout(1500);
  c.ok('POST /me/wishlist → 2xx', ar && ar.status() < 300, ar && ar.status());
  const w1 = await sql(`SELECT "productId" FROM wishlists WHERE "userId" = $1`, RID);
  c.ok('DB: 1 dòng wishlists đúng productId', w1.length === 1 && w1[0].productId === prod.id, w1);
  await nav(s, '/tai-khoan/yeu-thich');
  let t = await bodyText(s.page);
  c.ok('trang yêu thích hiện "Dầu tràm cho bé Cobote"', t.includes('Dầu tràm cho bé Cobote'), t.slice(0, 200));
  await c.shot(s.page, 'yeu-thich-co');
  await nav(s, '/san-pham/dau-tram-be-cobote');
  const delP = s.page.waitForResponse((r) => /\/me\/wishlist\//.test(r.url()) && r.request().method() === 'DELETE', { timeout: 15_000 }).catch(() => null);
  await s.page.getByRole('button', { name: /yêu thích/i }).first().click();
  const dr = await delP;
  await s.page.waitForTimeout(1500);
  c.ok('DELETE /me/wishlist/:id → 2xx', dr && dr.status() < 300, dr && dr.status());
  c.ok('DB: không còn dòng wishlists', (await sql(`SELECT count(*)::int n FROM wishlists WHERE "userId" = $1`, RID))[0].n === 0);
  await nav(s, '/tai-khoan/yeu-thich');
  t = await bodyText(s.page);
  c.ok('trang yêu thích trống: "Chưa có sản phẩm yêu thích"', /Chưa có sản phẩm yêu thích/.test(t));
  await s.close();
});

// ───────────── U6-66 thông báo
await rec.run('U6-66', { role: 'Khách quay lại', journey: 'Thông báo', steps: 'Mở /tai-khoan/thong-bao; so với GET /me/notifications; "Đọc tất cả"; bấm một thông báo đơn hàng (390px)', expected: 'Danh sách = API (mới nhất trước), thông báo đơn hàng có mã đơn; "Đọc tất cả" đặt mọi dòng thành READ (notification_logs.status) và số chưa đọc ở menu/hub về 0; bấm thông báo đơn dẫn tới chi tiết đơn đó' }, async (c) => {
  const api = (await call(R, 'GET', '/me/notifications')).body ?? [];
  const unread0 = api.filter((n) => n.status !== 'READ').length;
  c.ev('API', { total: api.length, unread: unread0, first: api[0] && { code: api[0].templateCode, body: api[0].payload?.body } });
  const s = await openWeb(R, { width: 390, path: '/' });
  const r = await nav(s, '/tai-khoan/thong-bao');
  let t = await bodyText(s.page);
  const first = api[0]?.payload?.body?.slice(0, 40);
  c.ok('thông báo mới nhất của API hiện trên đầu danh sách', !!first && t.includes(first), { first, text: t.slice(0, 300) });
  c.ok('trang không báo lỗi', badReqs(r.reqs).filter((x) => !x.includes('/brand/owner/me')).length === 0, badReqs(r.reqs));
  await c.shot(s.page, 'thong-bao');
  const hubBadge = async () => {
    await nav(s, '/tai-khoan');
    const tt = await bodyText(s.page);
    const m = tt.match(/Thông báo\n(\d+)/);
    return m ? Number(m[1]) : 0;
  };
  const badge0 = await hubBadge();
  c.ev('badge hub trước', badge0);
  c.ok(`badge thông báo ở hub = số chưa đọc API (${unread0})`, badge0 === unread0, { badge0, unread0 });
  await nav(s, '/tai-khoan/thong-bao');
  const readAll = s.page.getByRole('button', { name: 'Đọc tất cả' });
  if (await readAll.count()) {
    const respP = s.page.waitForResponse((x) => /read-all/.test(x.url()), { timeout: 15_000 }).catch(() => null);
    await readAll.click();
    const rr = await respP;
    await s.page.waitForTimeout(1500);
    c.ok('POST read-all → 2xx', rr && rr.status() < 300, rr && rr.status());
  } else c.note('không có nút "Đọc tất cả" (đã đọc hết)');
  const st = await sql(`SELECT status, count(*)::int n FROM notification_logs WHERE "userId" = $1 AND channel = 'IN_APP' GROUP BY status`, RID).catch(() => []);
  c.ev('notification_logs theo trạng thái', st);
  const api2 = (await call(R, 'GET', '/me/notifications')).body ?? [];
  c.ok('sau "Đọc tất cả": API không còn thông báo chưa đọc', api2.filter((n) => n.status !== 'READ').length === 0, api2.filter((n) => n.status !== 'READ').length);
  const badge1 = await hubBadge();
  c.ok('badge hub về 0', badge1 === 0, badge1);
  await nav(s, '/tai-khoan/thong-bao');
  const orderNote = s.page.locator('ul button', { hasText: /Đơn TUBU/ }).first();
  if (await orderNote.count()) {
    await orderNote.click();
    await s.page.waitForTimeout(1200);
    t = await bodyText(s.page);
    c.ok('bấm thông báo → mở "Chi tiết thông báo" với nội dung đầy đủ', /Chi tiết thông báo/.test(t) && /Đơn TUBU/.test(t), t.slice(0, 300));
    await c.shot(s.page, 'thong-bao-chi-tiet');
    const act = s.page.getByRole('link', { name: /Xem đơn|đơn hàng|Chi tiết đơn/i }).last();
    if (await act.count()) {
      const href = await act.getAttribute('href');
      await act.click();
      await s.page.waitForURL(/\/tai-khoan\/don-hang\//, { timeout: 20_000 }).catch(() => null);
      c.ok('nút trong chi tiết thông báo dẫn tới đúng đơn (href khớp mã đơn trong thông báo)', /\/tai-khoan\/don-hang\/TUBU\d+/.test(s.page.url()) && s.page.url().endsWith(href ?? '?'), `${href} -> ${s.page.url()}`);
    } else c.note('chi tiết thông báo đơn không có nút điều hướng tới đơn (chỉ hiện chữ)');
  } else c.ok('có thông báo đơn hàng để bấm', false, t.slice(0, 200));
  await s.close();
});

// ───────────── U6-67 cài đặt: công tắc thông báo, cỡ chữ, đăng xuất
await rec.run('U6-67', { role: 'Khách quay lại', journey: 'Cài đặt', steps: 'Mở /tai-khoan/cai-dat; tắt "Khuyến mãi & mã giảm giá"; đổi cỡ chữ Lớn; tải lại (390px)', expected: 'Công tắc lưu vào users.notifyPromo (DB) và còn nguyên sau tải lại; "Cập nhật đơn hàng" luôn bật và không tắt được; cỡ chữ đổi ngay cỡ chữ gốc của trang và nhớ sau tải lại; trang không có chữ "xu"' }, async (c) => {
  await sql(`UPDATE users SET "notifyPromo" = true WHERE id = $1`, RID);
  const s = await openWeb(R, { width: 390, path: '/' });
  await nav(s, '/tai-khoan/cai-dat');
  let t0;
  const promo = s.page.getByRole('switch', { name: 'Khuyến mãi & mã giảm giá' });
  c.ok('công tắc Khuyến mãi đang bật', (await promo.getAttribute('aria-checked')) === 'true');
  t0 = await bodyText(s.page);
  c.ok('"Cập nhật đơn hàng" luôn bật: là dòng chữ cố định, không có công tắc để tắt', /Cập nhật đơn hàng\s*\n?Luôn bật/.test(t0) && (await s.page.getByRole('switch', { name: 'Cập nhật đơn hàng' }).count()) === 0, t0.slice(t0.indexOf('Cập nhật đơn hàng'), t0.indexOf('Cập nhật đơn hàng') + 120));
  const respP = s.page.waitForResponse((r) => /notifications\/prefs/.test(r.url()) && r.request().method() === 'PATCH', { timeout: 15_000 }).catch(() => null);
  await promo.click();
  const pr = await respP;
  await s.page.waitForTimeout(1200);
  c.ok('PATCH prefs → 2xx', pr && pr.status() < 300, pr && pr.status());
  c.ok('DB: notifyPromo = false', (await sql(`SELECT "notifyPromo" v FROM users WHERE id = $1`, RID))[0].v === false);
  await nav(s, '/tai-khoan/cai-dat');
  c.ok('tải lại: công tắc vẫn tắt', (await s.page.getByRole('switch', { name: 'Khuyến mãi & mã giảm giá' }).getAttribute('aria-checked')) === 'false');
  const fs0 = await s.page.evaluate(() => getComputedStyle(document.documentElement).fontSize);
  await s.page.getByRole('radio', { name: /Lớn/ }).click();
  await s.page.waitForTimeout(600);
  const fs1 = await s.page.evaluate(() => getComputedStyle(document.documentElement).fontSize);
  c.ev('cỡ chữ gốc', { trước: fs0, sau: fs1 });
  c.ok('chọn "Lớn" làm cỡ chữ gốc lớn hơn', parseFloat(fs1) > parseFloat(fs0), { fs0, fs1 });
  await nav(s, '/tai-khoan/cai-dat');
  const fs2 = await s.page.evaluate(() => getComputedStyle(document.documentElement).fontSize);
  c.ok('tải lại vẫn giữ cỡ chữ Lớn', fs2 === fs1, { fs1, fs2 });
  await c.shot(s.page, 'cai-dat-co-chu-lon');
  const t = await bodyText(s.page);
  c.ok('không có mục xoá tài khoản/yêu cầu xoá dữ liệu trên trang này (ghi nhận để chủ quyết định)', !/Xóa tài khoản|Xoá tài khoản|xóa dữ liệu|xoá dữ liệu/i.test(t), '');
  await s.page.getByRole('radio', { name: /Vừa/ }).click();
  await sql(`UPDATE users SET "notifyPromo" = true WHERE id = $1`, RID);
  await s.close();
});

// ───────────── U6-68 sổ địa chỉ: thêm, đặt mặc định, sửa, xoá (uat_new_nophone)
await rec.run('U6-68', { role: 'Khách mới chưa có SĐT (uat_new_nophone)', journey: 'Sổ địa chỉ', steps: 'Thêm 2 địa chỉ, đặt địa chỉ thứ hai làm mặc định, sửa đường, xoá địa chỉ (390px)', expected: 'Mỗi thao tác khớp DB: địa chỉ đầu tiên tự là mặc định; chọn mặc định chuyển cờ isDefault duy nhất; sửa lưu đúng; xoá địa chỉ mặc định thì còn lại địa chỉ khác được chọn làm mặc định hoặc báo rõ; luôn có tối đa 1 mặc định' }, async (c) => {
  const UID = 'uat_new_nophone';
  await sql(`DELETE FROM addresses WHERE "userId" = $1`, UID);
  const s = await openWeb('new_nophone', { width: 390, path: '/' });
  const fill = async (form, name, street) => {
    await form.getByLabel('Người nhận').fill(name);
    await form.getByLabel('Số điện thoại').fill('0901000099');
    await form.getByLabel('Tỉnh/thành').selectOption({ label: 'Thành phố Hồ Chí Minh' });
    await s.page.waitForTimeout(800);
    await form.getByLabel('Phường/xã').selectOption({ label: 'Phường Bến Thành' });
    await form.getByLabel('Số nhà, đường').fill(street);
    await form.getByRole('button', { name: 'Lưu địa chỉ' }).click();
    await s.page.waitForTimeout(2000);
  };
  await nav(s, '/tai-khoan/dia-chi');
  let t = await bodyText(s.page);
  c.ev('trạng thái trống', t.slice(t.indexOf('Sổ địa chỉ'), t.indexOf('Sổ địa chỉ') + 200));
  await s.page.getByRole('button', { name: /Thêm địa chỉ mới/ }).click();
  await fill(s.page.getByRole('form', { name: /Thêm địa chỉ mới/ }), 'Nhà A', '1 Đường A');
  await s.page.getByRole('button', { name: /Thêm địa chỉ mới/ }).click();
  await fill(s.page.getByRole('form', { name: /Thêm địa chỉ mới/ }), 'Nhà B', '2 Đường B');
  let rows = await sql(`SELECT recipient, street, "isDefault" d FROM addresses WHERE "userId" = $1 ORDER BY recipient`, UID);
  c.ev('DB sau khi thêm 2', rows);
  c.ok('DB: 2 địa chỉ, đúng 1 mặc định = địa chỉ đầu tiên (Nhà A)', rows.length === 2 && rows.filter((x) => x.d).length === 1 && rows.find((x) => x.d)?.recipient === 'Nhà A', rows);
  await c.shot(s.page, 'dia-chi-2');
  const cardB = s.page.locator('li, div', { hasText: 'Nhà B' }).filter({ has: s.page.getByRole('button', { name: /Đặt làm mặc định|Mặc định/ }) }).last();
  const setDefault = s.page.getByRole('button', { name: /làm mặc định/ }).first();
  if (await setDefault.count()) {
    await setDefault.click();
    await s.page.waitForTimeout(1800);
    rows = await sql(`SELECT recipient, "isDefault" d FROM addresses WHERE "userId" = $1 ORDER BY recipient`, UID);
    c.ok('đặt làm mặc định → chỉ còn đúng 1 mặc định và là Nhà B', rows.filter((x) => x.d).length === 1 && rows.find((x) => x.d)?.recipient === 'Nhà B', rows);
  } else {
    c.ok('có nút "Đặt làm mặc định" cho địa chỉ không mặc định', false, (await bodyText(s.page)).slice(0, 400));
  }
  // sửa
  await s.page.getByRole('button', { name: /Sửa địa chỉ của Nhà A/ }).click();
  await s.page.waitForTimeout(800);
  const editForm = (await s.page.getByRole('form', { name: /Sửa địa chỉ/ }).count()) ? s.page.getByRole('form', { name: /Sửa địa chỉ/ }) : s.page.getByRole('form').last();
  await editForm.getByLabel('Số nhà, đường').fill('99 Đường Đã Sửa');
  await editForm.getByRole('button', { name: /Lưu/ }).click();
  await s.page.waitForTimeout(2000);
  rows = await sql(`SELECT recipient, street FROM addresses WHERE "userId" = $1 ORDER BY recipient`, UID);
  c.ok('sửa: có địa chỉ đường "99 Đường Đã Sửa"', rows.some((x) => x.street === '99 Đường Đã Sửa'), rows);
  // xoá
  await nav(s, '/tai-khoan/dia-chi');
  await s.page.getByRole('button', { name: /Xóa địa chỉ của Nhà B/ }).click();
  await s.page.waitForTimeout(600);
  t = await bodyText(s.page);
  c.ev('hộp xoá (Nhà B đang là mặc định)', t.slice(0, 400));
  const confirm = s.page.getByRole('alertdialog').getByRole('button', { name: /Xóa/ });
  if (await confirm.count()) await confirm.click();
  await s.page.waitForTimeout(2000);
  rows = await sql(`SELECT recipient, "isDefault" d FROM addresses WHERE "userId" = $1`, UID);
  c.ev('DB sau xoá', rows);
  c.ok('sau khi xoá địa chỉ mặc định (Nhà B): còn 1 địa chỉ (Nhà A)', rows.length === 1 && rows[0].recipient === 'Nhà A', rows);
  c.ok('địa chỉ còn lại tự thành mặc định (không để khách mất mặc định)', rows.length === 1 && rows[0].d === true, rows);
  await c.shot(s.page, 'dia-chi-sau-xoa');
  await s.close();
  // trả lại trạng thái cho lần chạy sau: chỉ để lại 1 địa chỉ mặc định (U6-35 cần)
  if (!rows.length) await sql(`INSERT INTO addresses (id, "userId", recipient, phone, province, district, ward, street, "isDefault", "provinceCode", "districtCode", "wardCode") SELECT md5(random()::text || clock_timestamp()::text), 'uat_new_nophone', 'Khách Chưa SĐT', '0901000099', province, district, ward, street, true, "provinceCode", "districtCode", "wardCode" FROM addresses WHERE "userId" = 'uat_returning' ORDER BY "isDefault" DESC LIMIT 1`);
});

await finish(rec);
