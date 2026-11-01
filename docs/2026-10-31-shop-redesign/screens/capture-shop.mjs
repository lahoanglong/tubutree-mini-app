#!/usr/bin/env node
// Chụp các màn gian hàng của lane 7 (đợt review 2026-10-31, chụp lại ở bước chốt 2026-11-01). Dựa trên docs/2026-10-28-review/tools/capture.mjs
// nhưng: danh sách màn riêng, ảnh ghi vào thư mục con `--out` (mặc định final/), cuộn tới hết trang (tối đa `max` ảnh mỗi màn).
// Dùng: node capture-shop.mjs [--out final] [--phase mini375,web375,web1280] [--filter chuỗi] [--force]
// Lần chụp đầu (31/10) ghi thẳng vào thư mục này: `--out .` và danh sách màn cũ trong git log.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WT = path.resolve(HERE, '../../..');
const H = path.join(WT, 'docs/2026-10-20-uat/tools/uat-harness');
const { open } = await import(path.join(H, 'miniapp-session.mjs'));
const { openWeb } = await import(path.join(H, 'web-session.mjs'));

const LANE = 7;
const MAX_SHOTS = 12;
const argv = process.argv.slice(2);
const opt = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const OUT = path.resolve(HERE, opt('--out', 'final'));
const flag = (k) => argv.includes(k);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const THROTTLE_BYPASS = (fs.readFileSync(path.join(H, `state/lane-${LANE}/lane.env`), 'utf8').match(/^THROTTLE_BYPASS_TOKEN=(.*)$/m) ?? [])[1]?.trim() ?? '';

const MOBILE = { width: 375, height: 812, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const DESKTOP = { width: 1280, height: 800, deviceScaleFactor: 1, isMobile: false, hasTouch: false };
const VP = { mini375: { app: 'miniapp', viewport: MOBILE }, web375: { app: 'web', viewport: MOBILE }, web1280: { app: 'web', viewport: DESKTOP } };

const PDP_FLASH = 'nuoc-rua-chen-fuwa3e';
const PDP_BUNDLE = 'nuoc-giat-fuwa3e';
// Id do seed-l7/final.mjs tạo trên DB lane 7: mục con "Rửa chén & rau quả" của "Tẩy rửa sinh học", khối COMBO của gian hàng uatctv.
const CAT_PARENT = 'cat-cleaning';
const CAT_CHILD = 'cmvxv9z780004okypmsq3js8c';
const CTV_BLOCK = 'cmvwjxayf0059f7uctc6i4pb1';
const CAMPAIGN = 'tuan-le-song-xanh';
// key, mini path, web path, personas (khổ 375), persona khổ 1280, tuỳ chọn { max: số ảnh tối đa, tab: regex tên tab cần bấm trước khi chụp }
const SCREENS = [
  ['home', '/', '/', ['guest', 'returning'], 'returning', { max: 12 }],
  ['browse-hub', '/browse', '/san-pham', ['returning'], 'returning', { max: 8 }],
  ['browse-parent', `/browse?category=${CAT_PARENT}`, `/san-pham?category=${CAT_PARENT}`, ['returning'], 'returning', { max: 5 }],
  ['browse-child', `/browse?category=${CAT_CHILD}`, `/san-pham?category=${CAT_CHILD}`, ['returning'], 'returning', { max: 3 }],
  ['browse-search', '/browse?q=nuoc', '/san-pham?q=nuoc', ['returning'], 'returning', { max: 3 }],
  ['product-flash', `/product/${PDP_FLASH}`, `/san-pham/${PDP_FLASH}`, ['returning'], 'returning', { max: 14 }],
  ['product-bundle', `/product/${PDP_BUNDLE}`, `/san-pham/${PDP_BUNDLE}`, ['returning', 'guest'], 'returning', { max: 14 }],
  ['cart', '/cart', '/gio-hang', ['returning'], 'returning', { max: 6 }],
  ['s-slug', '/s/uatctv', '/s/uatctv', ['guest'], 'guest', { max: 12 }],
  ['storefront', '/storefront', '/ctv/gian-hang', ['ctv'], 'ctv', { max: 10 }],
  ['storefront-block', `/storefront?khoi=${CTV_BLOCK}`, `/ctv/gian-hang?khoi=${CTV_BLOCK}`, ['ctv'], 'ctv', { max: 8 }],
  ['brand-slug', '/brand/fuwa3e', '/brand/fuwa3e', ['guest'], 'guest', { max: 10 }],
  ['offers', '/offers', '/uu-dai', ['returning', 'guest'], 'returning', { max: 10 }],
  ['vouchers', '/vouchers', '/ma-giam-gia', ['returning'], 'returning', { max: 5 }],
  ['flash-sale', '/flash-sale', '/gio-vang', ['returning'], 'returning', { max: 8 }],
  ['flash-sale-upcoming', '/flash-sale', '/gio-vang', ['guest'], 'guest', { max: 5, tab: /12:00/ }],
  ['best-sellers', '/best-sellers', '/ban-chay', ['returning'], 'returning', { max: 8 }],
  ['campaign', `/campaign/${CAMPAIGN}`, `/chien-dich/${CAMPAIGN}`, ['guest'], 'guest', { max: 6 }],
];

function cells() {
  const out = [];
  for (const phase of Object.keys(VP)) {
    const { app, viewport } = VP[phase];
    for (const [key, mini, web, personas, wide, o = {}] of SCREENS) {
      const p = app === 'miniapp' ? mini : web;
      if (!p) continue;
      const list = phase === 'web1280' ? (wide ? [wide] : []) : personas;
      for (const persona of list) out.push({ id: `${key}__${persona}__${phase}`, key, persona, phase, app, viewport, path: p, max: o.max ?? MAX_SHOTS, tab: o.tab ?? null });
    }
  }
  return out;
}

const HIDE_CSS = 'nextjs-portal{display:none !important}';
const markScroller = () => {
  const root = document.scrollingElement || document.documentElement;
  let best = root;
  let bestRange = root.scrollHeight - root.clientHeight;
  for (const el of document.querySelectorAll('*')) {
    const cs = getComputedStyle(el);
    if (!/(auto|scroll)/.test(cs.overflowY) || el.clientHeight < 200) continue;
    const range = el.scrollHeight - el.clientHeight;
    if (range > bestRange + 8) {
      best = el;
      bestRange = range;
    }
  }
  document.querySelectorAll('[data-ux-scroll]').forEach((e) => e.removeAttribute('data-ux-scroll'));
  best.setAttribute('data-ux-scroll', '1');
  return { range: bestRange, height: best.scrollHeight };
};
const scrollStep = () => {
  const el = document.querySelector('[data-ux-scroll]') || document.scrollingElement;
  const max = el.scrollHeight - el.clientHeight;
  const cur = el.scrollTop;
  if (cur >= max - 2) return false;
  el.scrollTo(0, Math.min(cur + Math.round(window.innerHeight * 0.85), max));
  return true;
};
const scrollInfo = () => {
  const el = document.querySelector('[data-ux-scroll]') || document.scrollingElement;
  return { top: el.scrollTop, max: el.scrollHeight - el.clientHeight, height: el.scrollHeight };
};
const textHead = () => (document.body?.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 400);

async function runCell(c) {
  const dir = path.join(OUT, c.phase);
  fs.mkdirSync(dir, { recursive: true });
  const t0 = Date.now();
  const openIt = () => (c.app === 'miniapp' ? open(LANE, c.persona, { viewport: c.viewport, path: c.path, waitMs: 60_000 }) : openWeb(LANE, c.persona, { viewport: c.viewport, path: c.path }));
  let s;
  try {
    s = await openIt();
  } catch {
    await sleep(2000);
    s = await openIt();
  }
  try {
    const page = s.page;
    if (c.app === 'web' && THROTTLE_BYPASS) {
      await s.context.route((u) => u.pathname.startsWith('/api/'), (route) => route.fallback({ headers: { ...route.request().headers(), 'x-throttle-bypass': THROTTLE_BYPASS } }));
    }
    await sleep(2500);
    if (c.tab) {
      await page.getByRole('tab', { name: c.tab }).first().click({ timeout: 15_000 });
      await sleep(1500);
    }
    await page.addStyleTag({ content: HIDE_CSS }).catch(() => undefined);
    await page.evaluate(markScroller).catch(() => undefined);
    const files = [];
    let truncated = false;
    for (let n = 1; n <= c.max; n++) {
      if (n > 1) {
        const moved = await page.evaluate(scrollStep).catch(() => false);
        if (!moved) break;
        await sleep(700);
      }
      const name = `${c.key}__${c.persona}__${c.phase}__s${n}.png`;
      await page.screenshot({ path: path.join(dir, name) });
      files.push(`${c.phase}/${name}`);
      if (n === c.max) truncated = (await page.evaluate(scrollInfo).catch(() => ({ top: 0, max: 0 }))).max - (await page.evaluate(scrollInfo).catch(() => ({ top: 0 }))).top > 2;
    }
    const info = await page.evaluate(scrollInfo).catch(() => null);
    const head = await page.evaluate(textHead).catch(() => '');
    const apiCalls = s.requests.filter((x) => x.method !== 'OPTIONS').map((x) => ({ method: x.method, path: x.path, status: x.status }));
    return {
      id: c.id, key: c.key, persona: c.persona, phase: c.phase, path: c.path, url: page.url(), files, truncated, scrollHeight: info?.height ?? null,
      apiErrors: apiCalls.filter((x) => x.status >= 400 || x.status === 0), pageErrors: s.errors.slice(0, 8).map((e) => e.slice(0, 250)),
      consoleErrors: (s.consoleErrors ?? []).slice(0, 8), textHead: head, ms: Date.now() - t0,
    };
  } finally {
    await s.close().catch(() => undefined);
  }
}

const phases = opt('--phase', Object.keys(VP).join(',')).split(',');
const filter = opt('--filter', null);
const force = flag('--force');
const idx = (phase) => path.join(OUT, `index-${phase}.jsonl`);
const done = new Set(phases.flatMap((p) => (fs.existsSync(idx(p)) ? fs.readFileSync(idx(p), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((l) => !l.error).map((l) => l.id) : [])));
let todo = cells().filter((c) => phases.includes(c.phase) && (!filter || c.id.includes(filter)));
if (!force) todo = todo.filter((c) => !done.has(c.id));
console.log(`lane ${LANE}: cần chụp ${todo.length} ô`);
let i = 0;
for (const c of todo) {
  i++;
  const t = Date.now();
  let line;
  try {
    line = await runCell(c);
  } catch (e) {
    line = { id: c.id, key: c.key, persona: c.persona, phase: c.phase, path: c.path, files: [], error: String(e).slice(0, 300) };
  }
  if (fs.existsSync(idx(c.phase))) {
    const keep = fs.readFileSync(idx(c.phase), 'utf8').split('\n').filter(Boolean).filter((l) => JSON.parse(l).id !== c.id);
    fs.writeFileSync(idx(c.phase), keep.map((l) => l + '\n').join(''));
  }
  fs.appendFileSync(idx(c.phase), `${JSON.stringify(line)}\n`);
  console.log(`[${i}/${todo.length}] ${c.id} ${line.error ? 'LỖI ' + line.error : `${line.files.length} ảnh${line.truncated ? ' (cắt)' : ''}, lỗi API ${line.apiErrors.length}, pageErrors ${line.pageErrors.length}`} (${((Date.now() - t) / 1000).toFixed(1)}s)`);
}
process.exit(0);
