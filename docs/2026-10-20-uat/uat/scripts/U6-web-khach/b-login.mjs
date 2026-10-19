// Nhóm B: đăng nhập Zalo OAuth trên web (giả phía Zalo), phiên, đăng xuất, returnTo, chống open redirect.
// Cần web lane 6 có NEXT_PUBLIC_ZALO_APP_ID: script tự chạy restart-web.sh with-zalo.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { L, Recorder, finish, openWeb, nav, bodyText, badReqs, sql, realLogin, clearCart, call, variantId, sleep } from './_lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
execFileSync('bash', [path.join(HERE, 'restart-web.sh'), 'with-zalo'], { stdio: 'inherit' });

const rec = new Recorder('b-login');
const sha = (t) => createHash('sha256').update(t).digest('hex');
const ORIGIN = 'http://localhost:3262';

/** Chặn POST /auth/zalo-oauth: thay phần Zalo (đổi code) bằng LoginResponse do CHÍNH API lane cấp (refresh token thật trong DB). */
async function fakeOauthExchange(context, userKey, out) {
  await context.route('**/auth/zalo-oauth', async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.continue();
    const real = await realLogin(L, userKey, { web: true });
    out.body = real.body;
    out.setCookie = real.setCookie;
    out.posted = req.postDataJSON();
    out.userId = real.user.id;
    const m = /tubu_rt=([^;]+)/.exec(real.setCookie ?? '');
    out.refresh = m?.[1] ? decodeURIComponent(m[1]) : null;
    await route.fulfill({
      status: real.status,
      contentType: 'application/json',
      headers: {
        'access-control-allow-origin': ORIGIN,
        'access-control-allow-credentials': 'true',
        ...(real.setCookie ? { 'set-cookie': real.setCookie } : {}),
      },
      body: JSON.stringify(real.body),
    });
  });
}

const startLogin = async (s, returnTo) => {
  await nav(s, `/dang-nhap${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ''}`);
  const b0 = s.blocked.length;
  await s.page.getByRole('button', { name: /Đăng nhập với Zalo/ }).click();
  for (let i = 0; i < 30 && s.blocked.length === b0; i++) await sleep(200);
  const url = s.blocked.slice(b0).map((b) => b.url).find((u) => /oauth\.zaloapp\.com/.test(u));
  // Trang Zalo bị bộ khung chặn nên tab đang ở trang lỗi: về lại origin web (sessionStorage của tab còn nguyên) để đọc state/verifier.
  await s.page.goto(`${L.webUrl}/dang-nhap`, { waitUntil: 'domcontentloaded' });
  return url ? new URL(url) : null;
};

for (const w of [390, 1440]) {
  const tag = `${w}`;
  const s = await openWeb('guest', { width: w, path: '/' });

  await rec.run(`U6-12-${tag}`, { role: 'Khách chưa đăng nhập', journey: 'Đăng nhập', steps: `Mở /dang-nhap?returnTo=/gio-hang (${w}px), bấm "Đăng nhập với Zalo"`, expected: 'Trình duyệt đi tới oauth.zaloapp.com với app_id, redirect_uri=<web>/dang-nhap/callback, code_challenge (PKCE) và state ngẫu nhiên; state/verifier lưu ở sessionStorage' }, async (c) => {
    const r = await nav(s, '/dang-nhap?returnTo=%2Fgio-hang');
    const t = await bodyText(s.page);
    c.ok('không còn câu "tạm ngưng" khi đã có Zalo App ID', !/tạm ngưng/.test(t), t.slice(0, 300));
    const u = await startLogin(s, '/gio-hang');
    c.ok('đi tới oauth.zaloapp.com', !!u, s.blocked.map((b) => b.url).slice(-2));
    if (u) {
      c.ok('có app_id', !!u.searchParams.get('app_id'), u.searchParams.get('app_id'));
      c.ok('redirect_uri = web/dang-nhap/callback', u.searchParams.get('redirect_uri') === `${ORIGIN}/dang-nhap/callback`, u.searchParams.get('redirect_uri'));
      c.ok('code_challenge PKCE 43 ký tự', /^[A-Za-z0-9_-]{43}$/.test(u.searchParams.get('code_challenge') ?? ''), u.searchParams.get('code_challenge'));
      const st = await s.page.evaluate(() => sessionStorage.getItem('tubu_oauth_state'));
      const vf = await s.page.evaluate(() => sessionStorage.getItem('tubu_pkce_verifier'));
      c.ok('state trên URL = state trong sessionStorage', st && st === u.searchParams.get('state'), { url: u.searchParams.get('state'), st });
      c.ok('có PKCE verifier trong sessionStorage', !!vf && vf.length >= 43, vf?.length);
      c.ev('URL OAuth (rút gọn)', u.toString().slice(0, 300));
    }
    await c.shot(s.page, `dang-nhap-bam-${tag}`);
  });

  await rec.run(`U6-13-${tag}`, { role: 'Khách chưa đăng nhập', journey: 'Đăng nhập', steps: `Trang /dang-nhap/callback (${w}px) với lỗi Zalo, thiếu code, sai state, và gọi thật /auth/zalo-oauth (API lane không có khoá Zalo)`, expected: 'Mỗi trường hợp hiện câu tiếng Việt dễ hiểu (không chuỗi kỹ thuật/stack), có nút "Đăng nhập lại" hoặc "Thử lại" và "Về trang chủ"; không bao giờ kẹt ở "Đang đăng nhập…"' }, async (c) => {
    const cases = [
      ['access_denied', '/dang-nhap/callback?error=access_denied', /từ chối cấp quyền/],
      ['thiếu code', '/dang-nhap/callback', /không gửi kèm mã đăng nhập/],
      ['sai state', '/dang-nhap/callback?code=ABC&state=sai-state', /Phiên đăng nhập không hợp lệ/],
    ];
    for (const [name, p, re] of cases) {
      await nav(s, p);
      const t = await bodyText(s.page);
      c.ok(`${name}: câu thông báo đúng`, re.test(t), t.slice(0, 300));
      c.ok(`${name}: có nút đăng nhập lại + về trang chủ`, /Đăng nhập lại|Thử lại/.test(t) && /Về trang chủ/.test(t));
      c.ok(`${name}: không lộ chuỗi kỹ thuật`, !/Error|undefined|\[object|at \w+\.|stack/i.test(t), t.slice(0, 200));
    }
    // Gọi thật API (không chặn): state đúng, code giả.
    const u = await startLogin(s, '/tai-khoan');
    const st = u?.searchParams.get('state');
    const before = s.requests.length;
    await nav(s, `/dang-nhap/callback?code=FAKECODE&state=${st}`);
    await sleep(1500);
    const t = await bodyText(s.page);
    const call1 = s.requests.slice(before).find((x) => /zalo-oauth/.test(x.path));
    c.ev('POST /auth/zalo-oauth thật', call1);
    c.ok('API từ chối code giả (không 2xx)', call1 && call1.status >= 400, call1);
    c.ok('trang hiện lỗi thân thiện thay vì kẹt', /Đăng nhập chưa thành công/.test(t) && !/Đang đăng nhập…\s*$/.test(t), t.slice(0, 400));
    c.ok('không lộ chuỗi kỹ thuật của Zalo/Axios', !/invalid|ECONN|Request failed|axios|Zalo OAuth thất bại/i.test(t), t.slice(0, 300));
    await c.shot(s.page, `callback-loi-api-${tag}`);
  });

  await rec.run(`U6-14-${tag}`, { role: 'Khách → khách quay lại (uat_returning)', journey: 'Đăng nhập', steps: `Bấm đăng nhập, callback đúng state (đổi code do bộ khung giả, token do API lane cấp), vào /gio-hang (${w}px), tải lại, đăng xuất`, expected: 'Về đúng returnTo=/gio-hang, đã đăng nhập (tên trên header), cookie tubu_rt HttpOnly; tải lại vẫn đăng nhập; đăng xuất thì refresh token bị thu hồi trong DB và cookie cũ không dùng lại được (401)' }, async (c) => {
    const ex = {};
    await fakeOauthExchange(s.context, 'returning', ex);
    const u = await startLogin(s, '/gio-hang');
    const st = u.searchParams.get('state');
    await nav(s, `/dang-nhap/callback?code=FAKEOK&state=${st}`, { wait: 2500 });
    c.ok('POST /auth/zalo-oauth gửi code + codeVerifier', ex.posted?.code === 'FAKEOK' && typeof ex.posted?.codeVerifier === 'string' && ex.posted.codeVerifier.length >= 43, { code: ex.posted?.code, verifierLen: ex.posted?.codeVerifier?.length });
    c.ok('về đúng returnTo /gio-hang', s.page.url().replace(ORIGIN, '') === '/gio-hang', s.page.url());
    let t = await bodyText(s.page);
    c.ok('đã đăng nhập: thấy giỏ hàng (không còn lời mời đăng nhập)', /Giỏ hàng/.test(t) && !/Đăng nhập để xem giỏ hàng/.test(t), t.slice(0, 200));
    c.ok('header có tên người dùng (Lại / Nguyễn Thị Quay Lại)', /Quay Lại|\bLại\b/.test(t), t.slice(0, 160));
    const cookies = await s.context.cookies(L.webUrl);
    const rt = cookies.find((k) => k.name === 'tubu_rt');
    const rtApi = (await s.context.cookies('http://localhost:3261/api/auth')).find((k) => k.name === 'tubu_rt');
    c.ev('cookie tubu_rt', rtApi ? { httpOnly: rtApi.httpOnly, sameSite: rtApi.sameSite, path: rtApi.path, secure: rtApi.secure } : 'không thấy (cookie theo path /api/auth)');
    c.ok('cookie tubu_rt là HttpOnly', !!rtApi && rtApi.httpOnly === true, rtApi);
    c.ok('JS không đọc được cookie refresh', !(await s.page.evaluate(() => document.cookie)).includes('tubu_rt'));
    const marker = await s.page.evaluate(() => localStorage.getItem('tubu_web_session'));
    c.ok('cờ phiên localStorage = 1', marker === '1', marker);
    // Phiên sống qua tải lại
    const r1 = await nav(s, '/tai-khoan', { wait: 1500 });
    t = await bodyText(s.page);
    c.ok('tải lại /tai-khoan vẫn đăng nhập', /34\.400/.test(t) && /Lộc Biếc/.test(t), t.slice(0, 200));
    c.ok('tải lại gọi /auth/refresh → 200', r1.reqs.some((x) => /auth\/refresh/.test(x.path) && x.status === 200), r1.reqs.map((x) => `${x.method} ${x.path} ${x.status}`));
    await c.shot(s.page, `da-dang-nhap-${tag}`);
    // Đăng xuất
    const cookieBefore = (await s.context.cookies('http://localhost:3261/api/auth')).find((k) => k.name === 'tubu_rt');
    const loP = s.page.waitForResponse((r) => /auth\/logout/.test(r.url()), { timeout: 15_000 }).catch(() => null);
    await s.page.getByRole('button', { name: /Đăng xuất/ }).first().click();
    const lo = await loP;
    await s.page.waitForTimeout(1500);
    c.ok('POST /auth/logout → 2xx', lo && lo.status() < 300, lo && { method: lo.request().method(), status: lo.status() });
    const rows = await sql(`SELECT "revokedAt" IS NOT NULL AS revoked FROM refresh_tokens WHERE "tokenHash" = $1`, sha(decodeURIComponent(cookieBefore.value)));
    c.ev('refresh_tokens của cookie cũ', rows);
    // cookie lúc đăng xuất là bản đã xoay; kiểm tra mọi token còn hiệu lực của user
    const live = await sql(`SELECT count(*)::int AS n FROM refresh_tokens WHERE "userId" = 'uat_returning' AND "revokedAt" IS NULL AND "expiresAt" > now() AND "rotatedAt" IS NULL`);
    c.ev('refresh token còn sống của uat_returning sau đăng xuất (mọi thiết bị)', live);
    t = await bodyText(s.page);
    c.ok('sau đăng xuất: header hiện Đăng nhập', /Đăng nhập/.test(t), t.slice(0, 150));
    await nav(s, '/gio-hang');
    t = await bodyText(s.page);
    c.ok('sau đăng xuất: /gio-hang hiện lời mời đăng nhập', /Đăng nhập để xem giỏ hàng/.test(t), t.slice(0, 200));
    // Dùng lại cookie cũ → 401
    const res = await fetch(`${L.apiUrl}/auth/refresh`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-client': 'web', cookie: `tubu_rt=${cookieBefore.value}` }, body: '{}' });
    c.ok('cookie refresh cũ sau đăng xuất bị từ chối (401/400/403)', [400, 401, 403].includes(res.status), res.status);
    await c.shot(s.page, `sau-dang-xuat-${tag}`);
  });

  await rec.run(`U6-15-${tag}`, { role: 'Khách → khách mới (uat_new)', journey: 'Đăng nhập + Giỏ', steps: `Chưa đăng nhập bấm "Thêm vào giỏ" ở PDP nước rửa tay (${w}px), đăng nhập xong`, expected: 'Quay lại đúng PDP và món đã chọn tự vào giỏ (server: cart_items có 1 dòng FUWA-HW-500 × 1); không bị cộng đôi' }, async (c) => {
    await clearCart('new');
    const s2 = await openWeb('guest', { width: w, path: '/san-pham/nuoc-rua-tay-fuwa3e' });
    const ex = {};
    await fakeOauthExchange(s2.context, 'new', ex);
    await s2.page.getByRole('button', { name: /Thêm vào giỏ/ }).first().click();
    await s2.page.waitForURL(/dang-nhap/, { timeout: 15_000 });
    const b0 = s2.blocked.length;
    await s2.page.getByRole('button', { name: /Đăng nhập với Zalo/ }).click();
    for (let i = 0; i < 30 && s2.blocked.length === b0; i++) await sleep(200);
    const u = new URL(s2.blocked.slice(b0).map((b) => b.url).find((x) => /oauth\.zaloapp\.com/.test(x)));
    await nav(s2, `/dang-nhap/callback?code=FAKEOK2&state=${u.searchParams.get('state')}`, { wait: 3000 });
    c.ok('quay lại PDP', /\/san-pham\/nuoc-rua-tay-fuwa3e/.test(s2.page.url()), s2.page.url());
    await sleep(1500);
    const cart = await call('new', 'GET', '/cart');
    const items = (cart.body?.items ?? []).map((i) => ({ sku: i.sku ?? i.variationName, qty: i.quantity }));
    c.ev('giỏ server', items);
    c.ok('giỏ server có đúng 1 dòng × 1', cart.body?.items?.length === 1 && cart.body.items[0].quantity === 1, items);
    const rows = await sql(`SELECT v.sku, ci.quantity FROM cart_items ci JOIN carts c ON c.id = ci."cartId" JOIN variations v ON v.id = ci."variationId" WHERE c."userId" = 'uat_new'`);
    c.ok('DB cart_items: FUWA-HW-500 × 1', rows.length === 1 && rows[0].sku === 'FUWA-HW-500' && rows[0].quantity === 1, rows);
    await c.shot(s2.page, `them-gio-sau-dang-nhap-${tag}`);
    await s2.close();
    await clearCart('new');
  });

  await rec.run(`U6-16-${tag}`, { role: 'Khách chưa đăng nhập', journey: 'Bảo mật đăng nhập', steps: `Callback đúng state nhưng returnTo độc hại (https://evil.example, //evil.example, /\\evil) ghi vào sessionStorage (${w}px)`, expected: 'Đăng nhập xong luôn ở trên localhost:3262 (về "/" nếu returnTo không hợp lệ), không bao giờ chuyển ra domain ngoài' }, async (c) => {
    const s3 = await openWeb('guest', { width: w, path: '/' });
    const ex = {};
    await fakeOauthExchange(s3.context, 'new_nophone', ex);
    for (const bad of ['https://evil.example/x', '//evil.example', '/\\evil.example']) {
      const u = await startLogin(s3, null);
      await s3.page.evaluate((v) => sessionStorage.setItem('tubu_return_to', v), bad);
      await nav(s3, `/dang-nhap/callback?code=FAKEOK3&state=${u.searchParams.get('state')}`, { wait: 2500 });
      const host = new URL(s3.page.url()).host;
      c.ok(`returnTo="${bad}" không ra ngoài`, host === 'localhost:3262', s3.page.url());
      await s3.page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
      await s3.context.clearCookies();
    }
    await s3.close();
  });

  await rec.run(`U6-17-${tag}`, { role: 'Khách quay lại', journey: 'Phiên', steps: `Phiên hết hạn: thu hồi refresh token trong DB rồi mở /tai-khoan (${w}px)`, expected: 'Web nhận 401 từ /auth/refresh, xoá cờ phiên và coi là khách (lời mời đăng nhập), không treo ở "Đang tải" và không lặp request vô hạn' }, async (c) => {
    const s4 = await openWeb('returning', { width: w, path: '/tai-khoan' });
    c.ok('đã đăng nhập ban đầu', /34\.400/.test(await bodyText(s4.page)));
    await sql(`UPDATE refresh_tokens SET "revokedAt" = now() WHERE "userId" = 'uat_returning' AND "revokedAt" IS NULL`);
    const b = s4.requests.length;
    await nav(s4, '/tai-khoan', { wait: 2000 });
    const t = await bodyText(s4.page);
    const refreshes = s4.requests.slice(b).filter((x) => /auth\/refresh/.test(x.path));
    c.ev('refresh khi phiên chết', refreshes);
    c.ok('hiện lời mời đăng nhập', /Đăng nhập để xem tài khoản/.test(t), t.slice(0, 200));
    c.ok('không lặp refresh quá 2 lần', refreshes.length <= 2, refreshes.length);
    c.ok('cờ phiên đã xoá', (await s4.page.evaluate(() => localStorage.getItem('tubu_web_session'))) === null);
    await c.shot(s4.page, `phien-het-han-${tag}`);
    await s4.close();
  });

  await s.close();
}
await finish(rec);
