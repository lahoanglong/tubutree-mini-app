#!/usr/bin/env node
// Mở Mini App THẬT của lane (Vite 32N3, mã apps/miniapp) trong Playwright 390x844, đăng nhập sẵn bằng một user của lane.
//
// Chỉ giả phần chỉ Zalo làm được:
//   - zmp-sdk/apis: module Vite deps được bọc lại (re-export mọi hàm gốc), chỉ thay login/getAccessToken/getPhoneNumber/
//     getLocation/getUserInfo/scanQRCode và các lệnh mở UI native (openWebview, openChat, openShareSheet, followOA, ...).
//     getStorage/setStorage giữ bản gốc: ngoài Zalo trên host localhost, SDK tự lưu vào localStorage.
//   - Đổi token Zalo ở API: POST /auth/zalo-mini-app, /auth/guest, /auth/ensure-phone trả LoginResponse do CHÍNH API lane cấp
//     (lib.realLogin: refresh token thật trong DB lane → POST /auth/refresh của lane). /auth/refresh mặc định đi thẳng API thật.
// Mọi request API khác đi tới API lane thật. Request tới api.tubutree.com, họ Zalo, Sentry bị chặn (abort) và ghi lại;
// riêng GET font tĩnh h5.zadn.vn/static (icon zmp-ui) được cho qua và ghi ở s.staticCdn.
//
// Thư viện:  import { open } from './miniapp-session.mjs';
//   const s = await open(1, 'returning', { browser: 'chromium' | 'webkit', headless: true, path: '/' });
//   s.page, s.context, s.user, s.login (LoginResponse), s.requests (API: method, path, status, mocked), s.blocked, s.staticCdn,
//   s.zmpCalls() (lệnh zmp-sdk app đã gọi), s.setQr(text) (nội dung lần scanQRCode tới), s.apiLog(filter), s.close()
//   opts.phone: SĐT ghi cho user khi app xin SĐT (/auth/ensure-phone) mà user chưa có (mặc định 097xxxxxxx cố định theo id);
//   opts.denyPhone: khách từ chối chia sẻ SĐT. opts.mockRefresh: /auth/refresh cũng đổi bằng realLogin.
//   user = 'guest' → không giả đăng nhập: app tự đi /auth/guest tới API thật (khách mới theo deviceId).
// CLI:  node miniapp-session.mjs <lane> <user> [--webkit] [--headed] [--path /] [--shot file.png] [--hold giây]
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { findUser, lane, laneEnv, playwright, prismaFor, realLogin, closePrisma, STATE } from './lib.mjs';

const BLOCK_HOST = /(^|\.)(api\.tubutree\.com|zalo\.me|zaloapp\.com|zdn\.vn|zadn\.vn|zalopay\.vn|sentry\.io|ingest\.sentry\.io)$/i;
const STATIC_CDN = /^https:\/\/h5\.zadn\.vn\/static\//;
const ZMP_MODULE = /\/node_modules\/\.vite\/deps\/zmp-sdk_apis\.js/;
const VIEWPORT = { width: 390, height: 844 };
const UA_IOS =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

/** Lệnh zmp-sdk được thay. Thân hàm chạy trong trình duyệt; cấu hình đọc lúc gọi từ window.__UAT_ZMP__. */
const FAKES = {
  login: `async () => { if (S().guest) throw Object.assign(new Error('UAT: khách, không có Zalo'), { code: -1401 }); return 'Success'; }`,
  getAccessToken: `async () => { if (S().guest) throw Object.assign(new Error('UAT: khách, không có Zalo'), { code: -1401 }); return 'uat-zalo-access:' + S().zaloId; }`,
  getPhoneNumber: `async () => { if (S().denyPhone) throw Object.assign(new Error('UAT: từ chối SĐT'), { code: -2003 }); return { token: 'uat-phone-token' }; }`,
  getLocation: `async () => ({ token: 'uat-location-token' })`,
  getUserInfo: `async () => ({ userInfo: { id: S().zaloId || 'uat-guest', idByOA: S().zaloId || 'uat-guest', name: S().fullName || 'Khách UAT', avatar: '', followedOA: false } })`,
  scanQRCode: `async () => ({ content: S().qr ?? '' })`,
  openWebview: `async () => ({})`,
  openOutApp: `async () => ({})`,
  openChat: `async () => ({})`,
  openPhone: `async () => ({})`,
  openSMS: `async () => ({})`,
  openShareSheet: `async () => ({ status: 1, shareType: 0, numberOfUser: 1 })`,
  openPostFeed: `async () => ({ status: 1, shareType: 0, numberOfUser: 1 })`,
  followOA: `async () => ({})`,
  unfollowOA: `async () => ({})`,
  requestSendNotification: `async () => ({})`,
  vibrate: `async () => ({})`,
  saveImageToGallery: `async () => ({})`,
  openProfile: `async () => ({})`,
  openMiniApp: `async () => ({})`,
  createShortcut: `async () => ({})`,
};

/** Tên export của module deps (khối `export { a as b, c };` cuối file esbuild). */
function exportNames(code) {
  const blocks = [...code.matchAll(/export\s*\{([^}]*)\}/g)];
  if (!blocks.length) throw new Error('module zmp-sdk_apis.js không có khối export — Vite đổi định dạng deps?');
  const names = [];
  for (const b of blocks) {
    for (const part of b[1].split(',')) {
      const t = part.trim();
      if (!t) continue;
      const m = t.match(/^(?:[\w$]+\s+as\s+)?([\w$]+)$/);
      if (m) names.push(m[1]);
    }
  }
  return [...new Set(names)];
}

function wrapperModule(origUrl, names) {
  const kept = names.filter((n) => !(n in FAKES) && n !== 'default');
  const faked = names.filter((n) => n in FAKES);
  const lines = [
    `import * as O from ${JSON.stringify(origUrl)};`,
    `const S = () => window.__UAT_ZMP__ || {};`,
    `const rec = (name, args) => { try { (window.__uatZmpCalls ||= []).push({ name, args: JSON.parse(JSON.stringify(args ?? [])), at: Date.now() }); } catch { (window.__uatZmpCalls ||= []).push({ name, at: Date.now() }); } };`,
    // App gọi kiểu promise; vẫn gọi success/fail cho mã nào dùng kiểu callback của SDK.
    `const wrap = (name, impl) => async (...args) => { rec(name, args); const cb = args[0] && typeof args[0] === 'object' ? args[0] : {}; try { const r = await impl(...args); cb.success?.(r); return r; } catch (e) { cb.fail?.(e); throw e; } };`,
    kept.length ? `export const { ${kept.join(', ')} } = O;` : '',
    ...faked.map((n) => `export const ${n} = wrap(${JSON.stringify(n)}, ${FAKES[n]});`),
    names.includes('default') ? `export default O.default;` : '',
  ];
  return lines.filter(Boolean).join('\n');
}

const corsHeaders = (req) => {
  const origin = req.headers().origin;
  return {
    'access-control-allow-origin': origin ?? '*',
    'access-control-allow-credentials': 'true',
    'access-control-allow-headers': req.headers()['access-control-request-headers'] ?? 'authorization,content-type',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    vary: 'Origin',
  };
};

/** Zalo đã xác minh SĐT: ghi SĐT vào user nếu còn trống và chưa ai dùng — phần AuthService làm sau khi Zalo giải mã phoneToken. */
async function fakeZaloPhone(L, user, phone) {
  if (!phone) return;
  const prisma = prismaFor(L);
  const fresh = await prisma.user.findUnique({ where: { id: user.id } });
  if (fresh.phone) return;
  const taken = await prisma.user.findUnique({ where: { phone } });
  if (taken) throw new Error(`SĐT ${phone} đã thuộc user ${taken.id}`);
  await prisma.user.update({ where: { id: user.id }, data: { phone, phoneVerifiedAt: new Date() } });
}

/** SĐT mặc định khi app xin SĐT mà opts.phone không có: cố định theo user (097 + 7 số từ sha1 id) để chạy lại ra cùng số. */
function autoPhone(id) {
  const h = createHash('sha1').update(String(id)).digest();
  return `097${String(h.readUInt32BE(0) % 10_000_000).padStart(7, '0')}`;
}

export async function open(laneN, userKey, opts = {}) {
  const { browser: engine = 'chromium', headless = true, path: startPath = '/', mockRefresh = false, phone = null, denyPhone = false, waitMs = 20_000 } = opts;
  const L = lane(laneN);
  laneEnv(L);
  const guest = userKey === 'guest';
  const user = guest ? null : await findUser(L, userKey);
  const pw = playwright();
  if (!['chromium', 'webkit'].includes(engine)) throw new Error(`browser phải là chromium|webkit, nhận ${engine}`);
  const browser = await pw[engine].launch({ headless });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent: UA_IOS,
    locale: 'vi-VN',
    timezoneId: 'Asia/Ho_Chi_Minh',
  });
  await context.addInitScript((cfg) => {
    window.__UAT_ZMP__ = cfg;
  }, { guest, zaloId: user?.zaloId ?? null, fullName: user?.fullName ?? null, denyPhone, qr: '' });

  const requests = [];
  const blocked = [];
  const staticCdn = [];
  const mocked = new WeakSet();
  let login = null;

  await context.route(
    (u) => BLOCK_HOST.test(u.hostname),
    (route) => {
      const req = route.request();
      // Font icon của zmp-ui nằm trên CDN tĩnh của Zalo (h5.zadn.vn/static): GET tài nguyên tĩnh, không phải lời gọi hệ thống Zalo.
      if (STATIC_CDN.test(req.url()) && req.method() === 'GET') {
        staticCdn.push(req.url());
        return route.continue();
      }
      blocked.push({ method: req.method(), url: req.url() });
      return route.abort('blockedbyclient');
    },
  );

  await context.route(ZMP_MODULE, async (route) => {
    const url = route.request().url();
    if (url.includes('uat-orig=1')) return route.continue();
    const resp = await route.fetch();
    const code = await resp.text();
    const origUrl = url + (url.includes('?') ? '&' : '?') + 'uat-orig=1';
    return route.fulfill({ status: 200, contentType: 'application/javascript', body: wrapperModule(origUrl, exportNames(code)) });
  });

  const authPaths = new Set(['/auth/zalo-mini-app', '/auth/ensure-phone', ...(guest ? [] : ['/auth/guest']), ...(mockRefresh ? ['/auth/refresh'] : [])]);
  const apiOrigin = new URL(L.apiUrl).origin;
  await context.route(
    (u) => u.origin === apiOrigin && u.pathname.startsWith('/api/auth/') && authPaths.has(u.pathname.slice(4)),
    async (route) => {
      const req = route.request();
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: corsHeaders(req) });
      mocked.add(req);
      const p = new URL(req.url()).pathname.slice(4);
      if (guest) {
        // Khách: không có Zalo nên app không được tới đây; trả đúng lỗi của API khi token Zalo hỏng.
        return route.fulfill({ status: 401, headers: corsHeaders(req), contentType: 'application/json', body: '{"statusCode":401,"message":"UAT: khách không có Zalo"}' });
      }
      if (p === '/auth/ensure-phone' && !denyPhone) await fakeZaloPhone(L, user, phone ?? autoPhone(user.id));
      const r = await realLogin(L, user.id);
      if (r.status !== 200 && r.status !== 201) {
        return route.fulfill({ status: r.status, headers: corsHeaders(req), contentType: 'application/json', body: JSON.stringify(r.body) });
      }
      login = r.body;
      return route.fulfill({ status: 200, headers: corsHeaders(req), contentType: 'application/json', body: JSON.stringify(r.body) });
    },
  );

  context.on('requestfinished', async (req) => {
    if (!req.url().startsWith(L.apiUrl) || req.method() === 'OPTIONS') return;
    const res = await req.response().catch(() => null);
    const u = new URL(req.url());
    requests.push({ method: req.method(), path: u.pathname.slice(4) + u.search, status: res?.status() ?? 0, mocked: mocked.has(req) });
  });
  context.on('requestfailed', (req) => {
    if (!req.url().startsWith(L.apiUrl)) return;
    const u = new URL(req.url());
    requests.push({ method: req.method(), path: u.pathname.slice(4) + u.search, status: 0, failure: req.failure()?.errorText, mocked: mocked.has(req) });
  });

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  const authDone = page
    .waitForResponse((r) => r.url().startsWith(`${L.apiUrl}/auth/`) && r.request().method() === 'POST' && r.status() < 300, { timeout: waitMs })
    .catch(() => null);
  await page.goto(`${L.miniUrl}${startPath}`, { waitUntil: 'domcontentloaded', timeout: waitMs });
  await authDone;
  await page.waitForLoadState('networkidle', { timeout: waitMs }).catch(() => undefined);

  return {
    lane: L,
    browser,
    context,
    page,
    user,
    get login() {
      return login;
    },
    requests,
    blocked,
    staticCdn,
    errors,
    zmpCalls: () => page.evaluate(() => window.__uatZmpCalls ?? []),
    setQr: (content) => page.evaluate((c) => (window.__UAT_ZMP__.qr = c), content),
    apiLog: (re) => requests.filter((r) => !re || re.test(`${r.method} ${r.path}`)),
    goto: async (p) => {
      await page.goto(`${L.miniUrl}${p}`, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle', { timeout: waitMs }).catch(() => undefined);
    },
    close: async () => {
      await context.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
      await closePrisma();
    },
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  const argv = process.argv.slice(2);
  const flag = (k) => argv.includes(k);
  const opt = (k, d) => (argv.indexOf(k) >= 0 ? argv[argv.indexOf(k) + 1] : d);
  const [laneArg, userArg] = argv;
  if (!laneArg || !userArg) {
    console.error('dùng: node miniapp-session.mjs <lane> <user|guest> [--webkit] [--headed] [--path /] [--shot file.png] [--hold giây]');
    process.exit(2);
  }
  const engine = flag('--webkit') ? 'webkit' : 'chromium';
  const s = await open(laneArg, userArg, { browser: engine, headless: !flag('--headed'), path: opt('--path', '/') });
  const shot = opt('--shot', path.join(STATE, `lane-${s.lane.n}`, 'shots', `miniapp-${userArg}-${engine}.png`));
  fs.mkdirSync(path.dirname(shot), { recursive: true });
  await s.page.screenshot({ path: shot });
  const me = await s.page.evaluate(() => document.body.innerText.slice(0, 400));
  console.log(JSON.stringify({ url: s.page.url(), user: s.user && { id: s.user.id, role: s.user.role }, loginUser: s.login?.user?.id ?? null, screenshot: shot }, null, 2));
  console.log('--- request API (method path → status, mocked = giả đổi token Zalo)');
  for (const r of s.requests) console.log(`${r.method} ${r.path} → ${r.status}${r.mocked ? '  [mocked]' : ''}${r.failure ? `  ${r.failure}` : ''}`);
  console.log('--- lệnh zmp-sdk app đã gọi:', JSON.stringify((await s.zmpCalls()).map((c) => c.name)));
  console.log('--- request bị chặn:', JSON.stringify(s.blocked));
  if (s.errors.length) console.log('--- lỗi trang:', JSON.stringify(s.errors));
  console.log('--- chữ đầu trang:', JSON.stringify(me));
  const hold = Number(opt('--hold', 0));
  if (hold > 0) await new Promise((r) => setTimeout(r, hold * 1000));
  await s.close();
}
