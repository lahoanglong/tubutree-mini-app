#!/usr/bin/env node
// Chụp màn của lane N (Mini App, web khách, admin) làm bằng chứng review UX. Chạy tuần tự, resume được.
// Dùng:
//   node capture.mjs --list
//   node capture.mjs [--lane 5] [--phase mini375,mini1280,web375,web768,web1280,admin1280,admin375]
//        [--state ok,loading,slow5s,error500,offline,empty,longtext] [--keys key|home,cart,...] [--filter chuỗi] [--limit n] [--force]
// Khổ: mini375 mini1280 web375 web768 web1280 admin1280 admin375. Trạng thái mặc định: ok.
// --keys: danh sách khoá màn trong routes.json (hoặc admin) cách nhau dấu phẩy; "key" = hằng KEY_SCREENS. Trạng thái khác ok mặc định chỉ chạy KEY_SCREENS.
// Mỗi ô = (app, khổ, màn, persona, trạng thái). Ảnh: screens/<nhãn>/<khoá>__<persona>__<nhãn>__s<n>.png, nhãn = khổ hoặc khổ-trạng thái.
// Mỗi nhãn ghi index riêng screens/index-<nhãn>.jsonl để hai tiến trình chạy song song không ghi đè nhau.
// Trạng thái (đăng nhập xong ở "/" rồi mới chặn/làm chậm /api/, trừ ghi chú):
//   loading  mọi /api/ trễ 4 giây, chụp ở 700 ms (1 ảnh)
//   slow5s   mọi /api/ trễ 5 giây; s1 ở 1,5 giây, s2 ở 6,5 giây
//   error500 GET /api/ (trừ /api/auth/) trả 500 JSON
//   offline  mọi /api/ (trừ /api/auth/, để phiên còn sống khi nạp lại trang) bị abort internetdisconnected
//   empty    GET /api/ (trừ /api/auth/ và /api/me) trả JSON đã thay mọi mảng bằng []
//   longtext GET /api/ (trừ /api/auth/) trả JSON có giá trị chuỗi của name/title/productName/fullName/displayName thay bằng câu 120 ký tự
// msToIdle tính từ lúc mở trình duyệt tới networkidle của lần mở trang, gồm cả khởi động trình duyệt và đăng nhập.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { open } from '../../2026-10-20-uat/tools/uat-harness/miniapp-session.mjs';
import { openWeb } from '../../2026-10-20-uat/tools/uat-harness/web-session.mjs';
import { runAxe } from '../../../scripts/uiux/lib/pw.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCREENS = path.resolve(HERE, '../screens');
const argv = process.argv.slice(2);
const opt = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const flag = (k) => argv.includes(k);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LANE = Number(opt('--lane', 5));
const R = JSON.parse(fs.readFileSync(path.join(HERE, 'routes.json'), 'utf8'));
if (R.lane !== LANE) console.error(`CẢNH BÁO: routes.json dựng cho lane ${R.lane}, đang chụp lane ${LANE}. Chạy: node build-routes.mjs --lane ${LANE}`);

// Màn chính: trang chủ, danh mục, tìm kiếm, chi tiết SP, giỏ, thanh toán, danh sách đơn, chi tiết đơn, Điểm Xanh, Ưu đãi,
// Vườn Xanh, đổi rác, chat, Cá nhân, CTV, đại lý, Ví Tubu (khoá thật trong routes.json).
export const KEY_SCREENS = ['home', 'browse-category', 'browse-search', 'product-slug', 'cart', 'checkout', 'orders', 'order-code', 'loyalty', 'offers', 'game', 'recycle', 'chat', 'profile', 'affiliate', 'dealer', 'wallet'];

const THROTTLE_BYPASS = (() => {
  try {
    const m = fs.readFileSync(path.resolve(HERE, `../../2026-10-20-uat/tools/uat-harness/state/lane-${LANE}/lane.env`), 'utf8').match(/^THROTTLE_BYPASS_TOKEN=(.*)$/m);
    return m ? m[1].trim() : '';
  } catch {
    return '';
  }
})();

const MOBILE = { width: 375, height: 812, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const TABLET = { width: 768, height: 1024, deviceScaleFactor: 1, isMobile: false, hasTouch: false };
const DESKTOP = { width: 1280, height: 800, deviceScaleFactor: 1, isMobile: false, hasTouch: false };
const VP = {
  mini375: { app: 'miniapp', vp: '375', viewport: MOBILE },
  mini1280: { app: 'miniapp', vp: '1280', viewport: DESKTOP },
  web375: { app: 'web', vp: '375', viewport: MOBILE },
  web768: { app: 'web', vp: '768', viewport: TABLET },
  web1280: { app: 'web', vp: '1280', viewport: DESKTOP },
  admin1280: { app: 'admin', vp: '1280', viewport: DESKTOP },
  admin375: { app: 'admin', vp: '375', viewport: MOBILE },
};
const PHASES = Object.keys(VP);
const STATES = ['ok', 'loading', 'slow5s', 'error500', 'offline', 'empty', 'longtext'];
const labelOf = (phase, state) => (state === 'ok' ? phase : `${phase}-${state}`);
const indexFile = (label) => path.join(SCREENS, `index-${label}.jsonl`);
const CUSTOMER = ['returning', 'new', 'guest'];
const rolePersona = (r) => (r.miniPersonas ?? r.webPersonas ?? []).find((p) => !CUSTOMER.includes(p)) ?? 'returning';

export function expand(keysSel) {
  const cells = [];
  const add = (phase, state, key, persona, p) => {
    const v = VP[phase];
    const label = labelOf(phase, state);
    cells.push({ id: `${key}__${persona}__${label}`, phase, label, state, key, persona, path: p, ...v });
  };
  const keep = (key, state) => (keysSel ? keysSel.includes(key) : state === 'ok' || KEY_SCREENS.includes(key));
  const routesFor = (phase) => {
    const app = VP[phase].app;
    if (app === 'admin') return R.admin.map((a) => ({ key: a.key, path: a.path, personas: ['admin'] }));
    return R.routes
      .filter((r) => (app === 'miniapp' ? r.mini : r.web))
      .filter((r) => !(app === 'web' && (r.key === 'admin' || r.key === 'admin-community') && phase !== 'web375'))
      .map((r) => ({
        key: r.key,
        path: app === 'miniapp' ? r.mini : r.web,
        personas: app === 'miniapp' ? r.miniPersonas : r.webPersonas.length ? r.webPersonas : ['returning'],
        role: rolePersona(r),
      }));
  };
  for (const state of STATES) {
    for (const phase of PHASES) {
      for (const r of routesFor(phase)) {
        if (!keep(r.key, state)) continue;
        if (state === 'ok') {
          const full = phase === 'mini375' || phase === 'web375' || phase.startsWith('admin');
          if (full) for (const persona of r.personas) add(phase, 'ok', r.key, persona, r.path);
          else add(phase, 'ok', r.key, phase === 'mini1280' ? r.role : 'returning', r.path);
        } else {
          add(phase, state, r.key, phase.startsWith('admin') ? 'admin' : r.role, r.path);
        }
      }
    }
  }
  return cells;
}

const readIndexFile = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const readAllIndex = () => (fs.existsSync(SCREENS) ? fs.readdirSync(SCREENS).filter((f) => /^index-.*\.jsonl$/.test(f)).flatMap((f) => readIndexFile(path.join(SCREENS, f))) : []);
const dropFromIndex = (label, id) => {
  const keep = readIndexFile(indexFile(label)).filter((l) => l.id !== id);
  fs.writeFileSync(indexFile(label), keep.map((l) => JSON.stringify(l)).join('\n') + (keep.length ? '\n' : ''));
};

const HIDE_CSS = 'nextjs-portal{display:none !important}';

const pageProbe = () => {
  const text = (document.body?.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
  const sel = 'a[href],button,[role=button],[role=link],[role=tab],[role=menuitem],input:not([type=hidden]),select,textarea,summary,[onclick]';
  const examples = [];
  let count = 0;
  for (const el of document.querySelectorAll(sel)) {
    if (el.closest('nextjs-portal') || el.disabled) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) === 0) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.width < 44 || r.height < 44) {
      count++;
      if (examples.length < 5) {
        const label = (el.innerText || el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('placeholder') || '').trim().replace(/\s+/g, ' ').slice(0, 40);
        const cls = typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/)[0]}` : '';
        examples.push({ text: label, sel: `${el.tagName.toLowerCase()}${cls}`, w: Math.round(r.width), h: Math.round(r.height) });
      }
    }
  }
  return { text, smallTargets: { count, examples } };
};

/** Gắn data-ux-scroll vào phần tử cuộn chính (trang hoặc khung cuộn trong), trả về độ cuộn tối đa. */
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
  return bestRange;
};

const scrollStep = () => {
  const el = document.querySelector('[data-ux-scroll]') || document.scrollingElement;
  const max = el.scrollHeight - el.clientHeight;
  const cur = el.scrollTop;
  if (cur >= max - 2) return false;
  el.scrollTo(0, Math.min(cur + window.innerHeight, max));
  return true;
};

const scrollTop = () => {
  const el = document.querySelector('[data-ux-scroll]') || document.scrollingElement;
  el.scrollTo(0, 0);
};


/** Dấu hiệu trạng thái của trang: trắng trang, nút Thử lại, khung chờ. */
const stateProbe = () => {
  const body = document.body;
  const text = (body?.innerText ?? '').replace(/\s+/g, ' ').trim();
  const letters = (text.match(/\p{L}/gu) ?? []).length;
  const hasImg = !!body?.querySelector('img,svg image,picture');
  const hasRetry = [...document.querySelectorAll('button,[role=button],a')].some((e) => /Thử lại/.test(e.textContent ?? ''));
  const hasSkeleton = !!document.querySelector('[class*="skeleton" i],[class*="shimmer" i],[class*="animate-pulse" i]');
  return { blank: letters < 20 && !hasImg, hasRetry, hasSkeleton };
};

async function shoot(page, cell, maxShots, dir) {
  await page.addStyleTag({ content: HIDE_CSS }).catch(() => undefined);
  await page.evaluate(markScroller).catch(() => undefined);
  const files = [];
  for (let n = 1; n <= maxShots; n++) {
    if (n > 1) {
      const moved = await page.evaluate(scrollStep).catch(() => false);
      if (!moved) break;
      await sleep(450);
    }
    files.push(await shootOne(page, cell, n, dir));
  }
  await page.evaluate(scrollTop).catch(() => undefined);
  return files;
}

async function shootOne(page, cell, n, dir) {
  await page.addStyleTag({ content: HIDE_CSS }).catch(() => undefined);
  const name = `${cell.key}__${cell.persona}__${cell.label}__s${n}.png`;
  await page.screenshot({ path: path.join(dir, name) });
  return path.relative(SCREENS, path.join(dir, name));
}

async function analyse(page) {
  let axe;
  try {
    const v = await runAxe(page);
    const byRule = {};
    const examples = {};
    for (const x of v) {
      byRule[x.id] = x.count;
      if (x.id === 'color-contrast' || x.id === 'target-size') examples[x.id] = x.nodes.slice(0, 3);
    }
    axe = { violations: v.length, byRule, examples };
  } catch (e) {
    axe = { error: String(e).slice(0, 200) };
  }
  return axe;
}


const norm = (r) => r.filter((x) => x.method !== 'OPTIONS').map((x) => ({ method: x.method, path: x.path, status: x.status }));

const LONG_TEXT = 'Bộ sản phẩm làm sạch thân thiện môi trường dành cho cả gia đình Việt, dùng được mỗi ngày, bền lâu và rất tiết kiệm';
const LONG_KEYS = new Set(['name', 'title', 'productName', 'fullName', 'displayName']);
const emptyArrays = (v) => (Array.isArray(v) ? [] : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, emptyArrays(x)])) : v);
const longText = (v) => {
  if (Array.isArray(v)) return v.map(longText);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, LONG_KEYS.has(k) && typeof x === 'string' ? LONG_TEXT : longText(x)]));
  return v;
};

/** Cài chặn/làm chậm /api/ cho một trạng thái; gọi SAU khi đăng nhập xong. */
async function installState(context, state) {
  const isApi = (u) => u.pathname.startsWith('/api/');
  const isAuth = (u) => u.pathname.startsWith('/api/auth/');
  await context.route(isApi, async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const get = req.method() === 'GET';
    try {
      if (state === 'loading' || state === 'slow5s') {
        await sleep(state === 'loading' ? 4000 : 5000);
        return await route.fallback();
      }
      if (isAuth(u)) return await route.fallback();
      if (state === 'offline') return await route.abort('internetdisconnected');
      if (state === 'error500') {
        if (!get) return await route.fallback();
        return await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ statusCode: 500, message: 'Lỗi máy chủ (giả lập)', error: 'Internal Server Error' }) });
      }
      if ((state === 'empty' || state === 'longtext') && get) {
        if (state === 'empty' && u.pathname === '/api/me') return await route.fallback();
        const res = await route.fetch();
        const ct = res.headers()['content-type'] ?? '';
        if (!ct.includes('json')) return await route.fulfill({ response: res });
        let body;
        try {
          body = await res.json();
        } catch {
          return await route.fulfill({ response: res });
        }
        const out = state === 'empty' ? emptyArrays(body) : longText(body);
        return await route.fulfill({ response: res, body: JSON.stringify(out), headers: { ...res.headers(), 'content-type': 'application/json' } });
      }
      return await route.fallback();
    } catch {
      /* trang đã đóng giữa chừng */
    }
  });
}

async function runCell(cell) {
  const dir = path.join(SCREENS, cell.label);
  fs.mkdirSync(dir, { recursive: true });
  const mini = cell.app === 'miniapp';
  const stateRun = cell.state !== 'ok';
  const startPath = stateRun ? '/' : cell.path;
  const t0 = Date.now();
  const openIt = () =>
    mini
      ? open(LANE, cell.persona, { viewport: cell.viewport, path: startPath, waitMs: 60_000 })
      : openWeb(LANE, cell.persona, { viewport: cell.viewport, path: startPath });
  let s;
  try {
    s = await openIt();
  } catch (e) {
    await sleep(2000);
    s = await openIt();
  }
  const msToIdle = Date.now() - t0;
  try {
    const page = s.page;
    let files = [];
    let probeS1 = null;
    if (!mini && THROTTLE_BYPASS) {
      // web/admin: nạp lại trang gọi lại POST /auth/refresh; tránh 429 làm trang kẹt "Đang tải…".
      await s.context.route((u) => u.pathname.startsWith('/api/'), (route) => route.fallback({ headers: { ...route.request().headers(), 'x-throttle-bypass': THROTTLE_BYPASS } }));
    }
    if (stateRun) {
      s.requests.length = 0;
      s.errors.length = 0;
      if (s.consoleErrors) s.consoleErrors.length = 0;
      await installState(s.context, cell.state);
      const target = `${mini ? s.lane.miniUrl : s.lane.webUrl}${cell.path}`;
      if (cell.state === 'loading') {
        const t = Date.now();
        await page.goto(target, { waitUntil: 'commit', timeout: 60_000 });
        await sleep(Math.max(0, 700 - (Date.now() - t)));
        files = await shoot(page, cell, 1, dir);
      } else if (cell.state === 'slow5s') {
        const t = Date.now();
        await page.goto(target, { waitUntil: 'commit', timeout: 60_000 });
        await sleep(Math.max(0, 1500 - (Date.now() - t)));
        files.push(await shootOne(page, cell, 1, dir));
        probeS1 = await page.evaluate(stateProbe).catch(() => null);
        await sleep(Math.max(0, 6500 - (Date.now() - t)));
        files.push(await shootOne(page, cell, 2, dir));
      } else {
        await s.goto(cell.path);
        await sleep(1500);
        files = await shoot(page, cell, 3, dir);
      }
    } else {
      await sleep(1500);
      files = await shoot(page, cell, 3, dir);
    }
    const probe = await page.evaluate(pageProbe).catch(() => ({ text: '', smallTargets: { count: 0, examples: [] } }));
    const st = (await page.evaluate(stateProbe).catch(() => null)) ?? { blank: null, hasRetry: null, hasSkeleton: null };
    const axe = cell.state === 'loading' || cell.state === 'slow5s' ? null : await analyse(page);
    const apiCalls = norm(s.requests);
    return {
      id: cell.id,
      app: cell.app,
      vp: cell.vp,
      lane: LANE,
      key: cell.key,
      persona: cell.persona,
      state: cell.state,
      url: page.url(),
      files,
      apiCalls,
      apiErrors: apiCalls.filter((c) => c.status >= 400),
      consoleErrors: (s.consoleErrors ?? []).slice(0, 15),
      pageErrors: s.errors.map((e) => e.slice(0, 250)).slice(0, 10),
      blank: st.blank,
      hasRetry: st.hasRetry,
      hasSkeleton: st.hasSkeleton,
      ...(probeS1 ? { s1: probeS1 } : {}),
      textHead: probe.text,
      msToIdle: stateRun ? null : msToIdle,
      axe,
      smallTargets: probe.smallTargets,
    };
  } finally {
    await s.close().catch(() => undefined);
  }
}

async function main() {
  const keysArg = opt('--keys', null);
  const keysSel = keysArg ? (keysArg === 'key' || keysArg === 'KEY_SCREENS' ? KEY_SCREENS : keysArg.split(',')) : null;
  const all = expand(keysSel);
  if (flag('--list')) {
    const by = {};
    for (const c of all) by[`${c.phase}/${c.state}`] = (by[`${c.phase}/${c.state}`] ?? 0) + 1;
    console.log(JSON.stringify({ total: all.length, by }, null, 2));
    return;
  }
  fs.mkdirSync(SCREENS, { recursive: true });
  const phases = opt('--phase', PHASES.join(',')).split(',');
  const states = opt('--state', 'ok').split(',');
  for (const x of [...phases.filter((p) => !PHASES.includes(p)), ...states.filter((p) => !STATES.includes(p))]) throw new Error(`khổ/trạng thái lạ: ${x}`);
  const filter = opt('--filter', null);
  const limit = Number(opt('--limit', 0));
  const force = flag('--force');
  const done = new Set(readAllIndex().map((l) => l.id));
  let todo = all.filter((c) => phases.includes(c.phase) && states.includes(c.state) && (!filter || c.id.includes(filter)));
  if (!force) todo = todo.filter((c) => !done.has(c.id));
  if (limit) todo = todo.slice(0, limit);
  console.log(`lane ${LANE}: cần chụp ${todo.length} ô (tổng ma trận ${all.length}, đã có ${done.size})`);
  let i = 0;
  for (const cell of todo) {
    i++;
    const t = Date.now();
    let line;
    try {
      line = await runCell(cell);
    } catch (e) {
      line = { id: cell.id, app: cell.app, vp: cell.vp, lane: LANE, key: cell.key, persona: cell.persona, state: cell.state, url: null, files: [], apiCalls: [], apiErrors: [], consoleErrors: [], pageErrors: [], blank: null, hasRetry: null, hasSkeleton: null, textHead: '', msToIdle: null, axe: null, smallTargets: null, error: String(e).slice(0, 300) };
    }
    if (force) dropFromIndex(cell.label, cell.id);
    fs.appendFileSync(indexFile(cell.label), `${JSON.stringify(line)}\n`);
    console.log(`[${i}/${todo.length}] ${cell.id} ${line.error ? 'LỖI ' + line.error : `${line.files.length} ảnh, ${line.apiErrors.length} lỗi API, pageErrors ${line.pageErrors.length}`} (${((Date.now() - t) / 1000).toFixed(1)}s)`);
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main().then(() => process.exit(0));
