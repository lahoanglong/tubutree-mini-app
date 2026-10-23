#!/usr/bin/env node
// Mở web THẬT của lane (next dev 32N2, cần lane-up.sh <N> --web) đã đăng nhập, khổ 390 (iPhone) hoặc 1440 (desktop).
// Không giả gì: cookie tubu_rt mang refresh token thật (chèn vào refresh_tokens của DB lane), cờ localStorage tubu_web_session=1;
// web tự gọi POST /api/auth/refresh (x-client: web) tới API lane, API xoay token và set cookie mới như ở thật.
// Cookie domain localhost dùng chung cho mọi cổng, nên web localhost:32N2 gửi được cookie tới API localhost:32N1 (cùng site).
//
// Thư viện:  import { openWeb } from './web-session.mjs';
//   const s = await openWeb(1, 'admin', { width: 1440, path: '/admin', browser: 'chromium' | 'webkit', headless: true });
//   s.page, s.context, s.user, s.requests (API: method, path, status), s.blocked, s.close()
//   user = 'guest' → không cookie, không cờ (khách chưa đăng nhập).
// CLI:  node web-session.mjs <lane> <user|guest> [--w 390|1440] [--path /admin] [--webkit] [--headed] [--shot file.png]
import fs from 'node:fs';
import path from 'node:path';
import { findUser, lane, laneEnv, mintRefresh, playwright, closePrisma, STATE } from './lib.mjs';

const BLOCK_HOST = /(^|\.)(api\.tubutree\.com|zalo\.me|zaloapp\.com|zdn\.vn|zadn\.vn|zalopay\.vn|sentry\.io|ingest\.sentry\.io)$/i;
const UA_IOS =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

export async function openWeb(laneN, userKey, opts = {}) {
  const { width = 390, path: startPath = '/', browser: engine = 'chromium', headless = true, waitMs = 90_000 } = opts;
  if (![390, 1440].includes(Number(width))) throw new Error(`width phải là 390 hoặc 1440, nhận ${width}`);
  const L = lane(laneN);
  laneEnv(L);
  const guest = userKey === 'guest';
  const user = guest ? null : await findUser(L, userKey);
  const mobile = Number(width) === 390;
  const browser = await playwright()[engine].launch({ headless });
  const context = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    ...(mobile ? { deviceScaleFactor: 2, isMobile: engine === 'chromium', hasTouch: true, userAgent: UA_IOS } : {}),
    locale: 'vi-VN',
    timezoneId: 'Asia/Ho_Chi_Minh',
  });
  if (user) {
    const rt = await mintRefresh(L, user.id);
    await context.addCookies([{ name: 'tubu_rt', value: rt, domain: 'localhost', path: '/api/auth', httpOnly: true, secure: false, sameSite: 'Lax' }]);
    await context.addInitScript(() => {
      try {
        localStorage.setItem('tubu_web_session', '1');
      } catch {
        /* storage bị chặn: web coi như khách */
      }
    });
  }
  const requests = [];
  const blocked = [];
  await context.route(
    (u) => BLOCK_HOST.test(u.hostname),
    (route) => {
      blocked.push({ method: route.request().method(), url: route.request().url() });
      return route.abort('blockedbyclient');
    },
  );
  context.on('requestfinished', async (req) => {
    if (!req.url().startsWith(L.apiUrl) || req.method() === 'OPTIONS') return;
    const res = await req.response().catch(() => null);
    const u = new URL(req.url());
    requests.push({ method: req.method(), path: u.pathname.slice(4) + u.search, status: res?.status() ?? 0 });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  // next dev dịch trang ở lần mở đầu: chờ lâu hơn Mini App.
  await page.goto(`${L.webUrl}${startPath}`, { waitUntil: 'domcontentloaded', timeout: waitMs });
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined);
  return {
    lane: L,
    browser,
    context,
    page,
    user,
    requests,
    blocked,
    errors,
    goto: async (p) => {
      await page.goto(`${L.webUrl}${p}`, { waitUntil: 'domcontentloaded', timeout: waitMs });
      await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined);
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
  const opt = (k, d) => (argv.indexOf(k) >= 0 ? argv[argv.indexOf(k) + 1] : d);
  const [laneArg, userArg] = argv;
  if (!laneArg || !userArg) {
    console.error('dùng: node web-session.mjs <lane> <user|guest> [--w 390|1440] [--path /admin] [--webkit] [--headed] [--shot file.png]');
    process.exit(2);
  }
  const width = Number(opt('--w', 390));
  const engine = argv.includes('--webkit') ? 'webkit' : 'chromium';
  const s = await openWeb(laneArg, userArg, { width, path: opt('--path', '/'), browser: engine, headless: !argv.includes('--headed') });
  const shot = opt('--shot', path.join(STATE, `lane-${s.lane.n}`, 'shots', `web-${userArg}-${width}-${engine}.png`));
  fs.mkdirSync(path.dirname(shot), { recursive: true });
  await s.page.screenshot({ path: shot });
  console.log(JSON.stringify({ url: s.page.url(), user: s.user && { id: s.user.id, role: s.user.role }, screenshot: shot }, null, 2));
  console.log('--- request API');
  for (const r of s.requests) console.log(`${r.method} ${r.path} → ${r.status}`);
  console.log('--- request bị chặn:', JSON.stringify(s.blocked));
  if (s.errors.length) console.log('--- lỗi trang:', JSON.stringify(s.errors.slice(0, 5)));
  console.log('--- chữ đầu trang:', JSON.stringify((await s.page.evaluate(() => document.body.innerText)).slice(0, 300)));
  await s.close();
}
