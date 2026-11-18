#!/usr/bin/env node
/**
 * Đo phòng thí nghiệm LCP / CLS / TBT của 5 trang web trên một bản dựng production đang chạy (`next start`), cộng kích thước HTML.
 * Điều kiện như thẻ "Fast 4G" của Chrome DevTools và CPU chậm 4 lần, khung 390×844 có cảm ứng, mỗi lần đo một ngữ cảnh mới (bộ nhớ đệm trống),
 * lấy trung vị của `--runs` lần (mặc định 3).
 *
 * An toàn khi web trỏ vào API PROD: trình duyệt chỉ được gửi GET/HEAD; mọi request khác và mọi đường `/events` bị chặn tại chỗ, nên không
 * một sự kiện hay thao tác ghi nào tới máy chủ thật. Request GET tới API khác origin được lấy hộ và gắn header CORS cho origin cục bộ.
 *
 *   node scripts/perf/lab-vitals.mjs --base http://localhost:3132 [--runs 3] [--out kết-quả.json] [--shots thư-mục] [--api https://api.tubutree.com]
 */
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const { chromium } = createRequire(join(ROOT, 'apps/e2e/package.json'))('@playwright/test');

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]?.startsWith('--') ? '1' : all[i + 1] ?? '1']] : acc), []),
);
const BASE = (args.base ?? 'http://localhost:3132').replace(/\/$/, '');
const RUNS = Number(args.runs ?? 3);
const API_HOSTS = (args.api ?? 'https://api.tubutree.com').split(',').map((u) => new URL(u).host);

/** Chrome DevTools "Fast 4G": 9 Mb/s xuống, 1,5 Mb/s lên, RTT 60 ms, đã nhân hệ số của Lighthouse (độ trễ ×2,75, băng thông ×0,9). */
const FAST_4G = { offline: false, latency: 60 * 2.75, downloadThroughput: ((9 * 1e6) / 8) * 0.9, uploadThroughput: ((1.5 * 1e6) / 8) * 0.9 };
const CPU_SLOWDOWN = 4;
const VIEWPORT = { width: 390, height: 844 };
/** Sau `load` chờ thêm ngần này cho LCP muộn, khối tải lười và tác vụ dài sau hydrate. */
const SETTLE_MS = 6000;

/** Ghi số đo từ trước khi trang chạy dòng script nào: tác vụ dài không có bộ đệm nên phải nghe từ đầu. */
const OBSERVE = () => {
  const m = { lcp: 0, lcpTag: '', cls: 0, fcp: 0, longTasks: [] };
  window.__lab = m;
  const on = (type, fn) => {
    try {
      new PerformanceObserver((l) => l.getEntries().forEach(fn)).observe({ type, buffered: true });
    } catch {}
  };
  on('largest-contentful-paint', (e) => {
    m.lcp = e.startTime;
    m.lcpTag = e.element ? `${e.element.tagName.toLowerCase()}${e.element.closest('[data-home-block]') ? `@${e.element.closest('[data-home-block]').getAttribute('data-home-block')}` : ''}` : '';
  });
  on('layout-shift', (e) => {
    if (!e.hadRecentInput) m.cls += e.value;
  });
  on('paint', (e) => {
    if (e.name === 'first-contentful-paint') m.fcp = e.startTime;
  });
  on('longtask', (e) => m.longTasks.push([e.startTime, e.duration]));
};

async function guard(context) {
  await context.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    if (/\/events(\/|$)/.test(url.pathname)) return route.abort();
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: cors(req) });
    if (method !== 'GET' && method !== 'HEAD') return route.abort();
    // Ảnh, font, script đi thẳng qua mạng giả lập (bị bóp băng thông như thật); chỉ fetch/XHR tới API khác origin mới cần gắn CORS.
    if (!API_HOSTS.includes(url.host) || !['fetch', 'xhr'].includes(req.resourceType())) return route.continue();
    try {
      const res = await route.fetch();
      return route.fulfill({ response: res, headers: { ...res.headers(), ...cors(req) } });
    } catch {
      return route.abort();
    }
  });
}

function cors(req) {
  const origin = req.headers().origin ?? BASE;
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-headers': req.headers()['access-control-request-headers'] ?? '*',
    'access-control-allow-methods': 'GET, HEAD, OPTIONS',
  };
}

async function measureOnce(browser, path) {
  const context = await browser.newContext({ viewport: VIEWPORT, isMobile: true, hasTouch: true, deviceScaleFactor: 3, locale: 'vi-VN' });
  await guard(context);
  await context.addInitScript(OBSERVE);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', FAST_4G);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_SLOWDOWN });
  const res = await page.goto(BASE + path, { waitUntil: 'load', timeout: 120_000 });
  await page.waitForTimeout(SETTLE_MS);
  const m = await page.evaluate(() => window.__lab);
  await context.close();
  const tbt = m.longTasks.filter(([start]) => start >= m.fcp).reduce((sum, [, d]) => sum + Math.max(0, d - 50), 0);
  const longMs = m.longTasks.reduce((sum, [, d]) => sum + d, 0);
  return { status: res?.status() ?? 0, lcp: Math.round(m.lcp), lcpTag: m.lcpTag, cls: Math.round(m.cls * 1e4) / 1e4, tbt: Math.round(tbt), fcp: Math.round(m.fcp), longTasks: m.longTasks.length, longMs: Math.round(longMs) };
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

/** Byte HTML chưa nén và trên dây (gzip) của một đường dẫn, đọc thẳng socket nên không bị tự giải nén. */
function htmlBytes(path, encoding) {
  const u = new URL(BASE + path);
  const req = u.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise((ok, fail) => {
    req(u, { headers: { 'accept-encoding': encoding, accept: 'text/html' } }, (res) => {
      let n = 0;
      res.on('data', (c) => (n += c.length));
      res.on('end', () => ok({ status: res.statusCode, bytes: n, cache: res.headers['x-nextjs-cache'] ?? '' }));
    })
      .on('error', fail)
      .end();
  });
}

async function productPath() {
  if (args.pdp) return args.pdp;
  const html = await fetch(`${BASE}/san-pham`).then((r) => r.text());
  const slug = /href="\/san-pham\/([a-z0-9-]+)"/.exec(html)?.[1];
  if (!slug) throw new Error('Không tìm thấy sản phẩm nào trong /san-pham để đo PDP; truyền --pdp /san-pham/<slug>.');
  return `/san-pham/${slug}`;
}

async function shots(browser, dir) {
  mkdirSync(dir, { recursive: true });
  for (const width of [360, 390, 1440]) {
    const mobile = width < 768;
    const context = await browser.newContext({ viewport: { width, height: mobile ? 800 : 900 }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1, locale: 'vi-VN' });
    await guard(context);
    const page = await context.newPage();
    await page.goto(`${BASE}/`, { waitUntil: 'load', timeout: 120_000 });
    // Cuộn hết trang để mọi khối tải khi gần tới khung nhìn đều đã vẽ, rồi về đầu trang chụp toàn trang.
    for (let y = 0, h = 1; y < h; y += 400) {
      h = await page.evaluate((top) => (window.scrollTo(0, top), document.documentElement.scrollHeight), y);
      await page.waitForTimeout(120);
    }
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(500);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await page.screenshot({ path: join(dir, `home-${width}.png`), fullPage: true });
    console.log(`ảnh home-${width}.png (tràn ngang ${overflow}px)`);
    await context.close();
  }
}

const browser = await chromium.launch();
try {
  const pdp = await productPath();
  const pages = ['/', '/san-pham', pdp, '/gio-hang', '/vuon-xanh'];
  const html = {};
  for (const p of pages) {
    await htmlBytes(p, 'identity');
    html[p] = { raw: await htmlBytes(p, 'identity'), gzip: await htmlBytes(p, 'gzip') };
  }
  const lab = {};
  for (const p of pages) {
    const runs = [];
    for (let i = 0; i < RUNS; i++) runs.push(await measureOnce(browser, p));
    lab[p] = { lcp: median(runs.map((r) => r.lcp)), cls: median(runs.map((r) => r.cls)), tbt: median(runs.map((r) => r.tbt)), runs };
  }
  const out = { base: BASE, at: new Date().toISOString(), conditions: { viewport: VIEWPORT, network: 'Fast 4G (DevTools)', cpuSlowdown: CPU_SLOWDOWN, runs: RUNS }, html, lab };
  if (args.out) writeFileSync(args.out, JSON.stringify(out, null, 2));
  console.log('| Trang | HTML chưa nén (B) | HTML gzip (B) | FCP (ms) | LCP (ms) | CLS | TBT (ms) | tác vụ dài (số / ms) | phần tử LCP |');
  console.log('|---|---:|---:|---:|---:|---:|---:|---|---|');
  for (const p of pages) {
    const l = lab[p];
    const fcp = median(l.runs.map((r) => r.fcp));
    const lt = `${median(l.runs.map((r) => r.longTasks))} / ${median(l.runs.map((r) => r.longMs))}`;
    console.log(`| ${p} | ${html[p].raw.bytes} | ${html[p].gzip.bytes} | ${fcp} | ${l.lcp} | ${l.cls} | ${l.tbt} | ${lt} | ${l.runs.map((r) => r.lcpTag).join(', ')} |`);
  }
  if (args.shots) await shots(browser, args.shots);
} finally {
  await browser.close();
}
