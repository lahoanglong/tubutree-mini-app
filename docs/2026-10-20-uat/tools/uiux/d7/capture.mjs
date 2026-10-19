// Bộ chụp D7 (admin 1440 + web khách 1440), chép từ scripts/uiux/capture.mjs. Không ghi vào file đã commit.
//
// Cách chạy (từ gốc worktree uat):
//   export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH
//   # 1) proxy SSR chỉ-đọc (fixture /s/:slug, /brand/:slug), cổng 3231
//   UIUX_API=http://127.0.0.1:3221 SSR_PROXY_PORT=3231 node docs/2026-10-20-uat/tools/uiux/d7/ssr-proxy.mjs &
//   # 2) web Next trỏ SSR qua proxy
//   (cd apps/web && API_BASE_URL=http://127.0.0.1:3231/api NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:3231/api npx next dev -H 0.0.0.0 -p 3222) &
//   # 3) chụp
//   UIUX_API=http://127.0.0.1:3221 UIUX_WEB_BASE=http://localhost:3222 \
//     node docs/2026-10-20-uat/tools/uiux/d7/capture.mjs [--set admin|staff|customer|all] [--only regex] [--states a,b] [--force]
//   # 4) dò hành động nguy hiểm / tiêu điểm bàn phím (ghi screens/web-probe.jsonl)
//   ... capture.mjs --probe danger [--only regex]
//   ... capture.mjs --probe focus [--only regex]
//
// Ghi: docs/2026-10-20-uat/screens/web/<id>__<state>__1440.png (khung 1440x900) + __1440full.png (toàn trang, cắt 6000px)
//      docs/2026-10-20-uat/screens/web.jsonl (resume được: key đã có và không fail thì bỏ qua, --force chụp lại).
// Mọi /api/** của trình duyệt đi qua ApiRouter (lib/api-router.mjs): ghi luôn là giả, chỉ GET công khai chuyển tới UIUX_API.
import fs from 'node:fs';
import path from 'node:path';
import { chromium, VIEWPORTS, ROOT, pageMetrics, runAxe } from './lib/pw.mjs';
import { ApiRouter, loadEndpoints } from './lib/api-router.mjs';
import { makeSession, makeCurated } from './lib/sessions.mjs';
import { artUri } from './lib/art.mjs';
import { adminRoutes, customerRoutes } from './routes-d7.mjs';

const args = process.argv.slice(2);
const opt = (k) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
};
const set = opt('--set') ?? 'all';
const probe = opt('--probe');
const only = opt('--only') ? new RegExp(opt('--only')) : null;
const onlyStates = opt('--states')?.split(',');
const force = args.includes('--force');
const API = (process.env.UIUX_API ?? 'http://127.0.0.1:3221').replace(/\/+$/, '');
const base = (process.env.UIUX_WEB_BASE ?? 'http://localhost:3222').replace(/\/+$/, '');
const OUT = path.join(ROOT, 'docs/2026-10-20-uat/screens');
const shotDir = path.join(OUT, 'web');
const resFile = path.join(OUT, probe ? 'web-probe.jsonl' : 'web.jsonl');
fs.mkdirSync(shotDir, { recursive: true });

const done = new Set();
if (fs.existsSync(resFile) && !force) {
  for (const l of fs.readFileSync(resFile, 'utf8').split('\n')) {
    if (!l.trim()) continue;
    try {
      const j = JSON.parse(l);
      if (!j.fail) done.add(j.key);
    } catch {
      /* bỏ dòng hỏng */
    }
  }
}

const prodList = (await (await fetch(`${API}/api/products?limit=8`)).json()).data.map((p) => ({ ...p, thumbnail: p.thumbnail ?? artUri(p.name) }));
const ctx0 = { product: prodList[0].slug, brand: process.env.UIUX_BRAND ?? 'bhnong' };
let routes = [];
if (set === 'admin' || set === 'all') routes.push(...adminRoutes().filter((r) => r.group === 'admin'));
if (set === 'staff' || set === 'all') routes.push(...adminRoutes().filter((r) => r.group === 'staff'));
if (set === 'customer' || set === 'all') routes.push(...customerRoutes(ctx0));
routes = routes.filter((r) => !only || only.test(r.id));
const endpoints = loadEndpoints('web-endpoints.json');
const browser = await chromium.launch({ args: ['--disable-dev-shm-usage', '--disable-gpu'] });

// Chữ in hoa dạng enum lộ ra giao diện (bỏ viết tắt tiếng Việt/kỹ thuật quen thuộc).
const ACRONYMS = new Set(['VAT', 'COD', 'CTV', 'KPI', 'CSV', 'POS', 'OTP', 'URL', 'SKU', 'VND', 'TNCN', 'CSKH', 'FAQ', 'API', 'HCMC', 'HCM', 'QR', 'OA', 'ID', 'SĐT', 'SMS', 'PDF', 'CCCD', 'MST', 'ZNS', 'OCOP', 'GMV', 'AOV', 'LTV', 'DAU', 'MAU', 'WAU', 'TUBU', 'XANH', 'WELCOME', 'FREESHIP', 'MAIL', 'HTML', 'JSON', 'UTC', 'GMT', 'ICT', 'BHXH', 'BHYT', 'COMBO', 'SALE', 'FLASH', 'NEW', 'HOT', 'VIP', 'OK', 'PDP', 'CTA', 'UTM', 'DNS', 'SSL', 'HTTP', 'HTTPS', 'TP', 'GHN', 'GHTK', 'VNPAY', 'MOMO', 'ZALO', 'PANCAKE', 'ADMIN', 'STAFF', 'IN']);
function textChecks(text) {
  const enumLeak = new Set();
  for (const m of text.matchAll(/(?<![\p{L}\p{N}_])(?:[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+|[A-Z]{4,})(?![\p{L}\p{N}_])/gu)) {
    const w = m[0];
    if (ACRONYMS.has(w) || /^TUBU\d/.test(w) || /^[A-Z]+\d+$/.test(w)) continue;
    enumLeak.add(w);
  }
  const rawMoney = [...text.matchAll(/(?<![\d.,])\d{5,}\s?(?:đ|₫|VND|vnđ)/g)].map((m) => m[0]).slice(0, 6);
  const commaMoney = [...text.matchAll(/\d{1,3}(?:,\d{3})+\s?(?:đ|₫|VND)/g)].map((m) => m[0]).slice(0, 6);
  const xu = [...text.matchAll(/(?<![\p{L}])(xu|Xu)(?![\p{L}])/gu)].length;
  const english = [...text.matchAll(/\b(Loading|Error|Submit|Cancel|Save|Delete|undefined|null|NaN|Invalid Date|\[object Object\])\b/g)].map((m) => m[0]);
  return { enumLeak: [...enumLeak].slice(0, 20), rawMoney, commaMoney, xu, english: [...new Set(english)] };
}

async function navInfo(page) {
  return page.evaluate(() => {
    const nav = document.querySelector('nav[aria-label="Mục quản trị"]');
    if (!nav) return null;
    const items = [...nav.querySelectorAll('button')].map((b) => b.textContent.replace(/\s+/g, ' ').trim());
    const active = nav.querySelector('button[aria-current="page"]')?.textContent.replace(/\s+/g, ' ').trim() ?? null;
    return { items, active };
  });
}

async function openPage(route, state) {
  const persona = route.persona;
  const guest = persona === 'guest';
  const session = guest ? { user: null, me: null } : makeSession(persona);
  const router = new ApiRouter({
    state,
    session,
    endpoints,
    curated: makeCurated({ persona: guest ? 'customer' : persona, products: prodList }),
    web: true,
  });
  const context = await browser.newContext({ ...VIEWPORTS['1440'], locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh', reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 160)));
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e).slice(0, 160)));
  await router.install(page);
  if (!guest) await page.addInitScript(() => localStorage.setItem('tubu_web_session', '1'));
  if (guest) await page.route((u) => u.pathname === '/api/auth/refresh', (rt) => rt.fulfill({ status: 401, contentType: 'application/json', body: '{"message":"no session"}' }));
  const t0 = Date.now();
  await page.goto(base + route.path, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(700);
  let prev = -1;
  let same = 0;
  for (let i = 0; i < 16 && same < 2; i++) {
    const len = await page.evaluate(() => (document.body.innerText || '').length + document.images.length * 1000);
    same = len === prev ? same + 1 : 0;
    prev = len;
    await page.waitForTimeout(350);
  }
  return { page, context, router, errors, loadMs: Date.now() - t0 };
}

async function shoot(route, state) {
  const key = `${route.id}__${state}__1440`;
  if (done.has(key)) return;
  const rec = { key, id: route.id, path: route.path, persona: route.persona, state, tab: route.tab, group: route.group, at: new Date().toISOString() };
  let h;
  try {
    h = await openPage(route, state);
    const { page, router, errors } = h;
    rec.loadMs = h.loadMs;
    rec.finalUrl = await page.evaluate(() => location.pathname + location.search);
    const m = await page.evaluate(pageMetrics);
    Object.assign(rec, {
      title: m.title,
      hOverflow: m.hOverflow,
      scrollW: m.scrollW,
      scrollH: m.scrollH,
      tapTotal: m.tapTotal,
      tapSmall: m.tapSmall,
      tinyText: m.tinyText,
      fontSizes: m.fontSizes,
      h1: m.h1,
      hasMain: m.hasMain,
      headings: m.headings.slice(0, 14),
      images: m.images,
      imagesNoAlt: m.imagesNoAlt,
      bodyText: m.bodyText.slice(0, 3000),
    });
    // Chữ gốc (textContent) của nút văn bản đang hiện, bỏ phần CSS uppercase — innerText trả chữ đã in hoa nên nhãn nhóm bị nhận nhầm là enum.
    const rawText = await page.evaluate(() => {
      const out = [];
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = w.nextNode())) {
        const el = n.parentElement;
        if (!el || !n.textContent.trim() || el.closest('script,style,noscript')) continue;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || cs.textTransform === 'uppercase') continue;
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        out.push(n.textContent.trim());
      }
      return out.join(' \n ');
    });
    rec.text = textChecks(rawText);
    rec.nav = await navInfo(page);
    if (route.expectTabs) rec.expectTabs = route.expectTabs;
    rec.tables = await page.evaluate(() => {
      const main = document.querySelector('main') ?? document.body;
      const t = main.querySelectorAll('table');
      const rows = [...t].reduce((a, x) => a + x.querySelectorAll('tbody tr').length, 0);
      const search = main.querySelectorAll('input[type=search], input[placeholder*="Tìm" i], input[aria-label*="Tìm" i], input[placeholder*="tìm" i]').length;
      const selects = main.querySelectorAll('select').length;
      const more = [...main.querySelectorAll('button')].filter((b) => /Tải thêm|Xem thêm|Trang sau|Trang trước|›|»/.test(b.textContent)).length;
      const pager = main.querySelectorAll('[aria-label*="trang" i], nav[aria-label*="Phân trang" i]').length;
      return { tables: t.length, rows, search, selects, more, pager };
    });
    if (state === 'normal' || state === 'long') {
      const ax = await runAxe(page).catch((e) => String(e));
      rec.axe = typeof ax === 'string' ? ax : ax.map((v) => ({ id: v.id, impact: v.impact, count: v.count, n: v.nodes.slice(0, 3).map((n) => ({ t: n.target, h: n.html, d: n.data })) }));
    }
    const vpFile = path.join(shotDir, `${key}.png`);
    await page.screenshot({ path: vpFile });
    rec.shot = path.relative(ROOT, vpFile);
    if (m.scrollH > 920) {
      const fullFile = path.join(shotDir, `${key}full.png`);
      const hgt = Math.min(m.scrollH, 6000);
      await page.screenshot({ path: fullFile, fullPage: true, clip: { x: 0, y: 0, width: 1440, height: hgt } });
      rec.shotFull = path.relative(ROOT, fullFile);
    }
    rec.errors = errors.slice(0, 6);
    rec.unmocked = [...router.unmocked].slice(0, 8);
    rec.calls = router.calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.path}`).slice(0, 6);
  } catch (e) {
    rec.fail = String(e).slice(0, 300);
  } finally {
    if (h) {
      h.router.dispose();
      await h.page.close().catch(() => {});
      await h.context.close().catch(() => {});
    }
  }
  fs.appendFileSync(resFile, JSON.stringify(rec) + '\n');
  console.log(rec.fail ? 'FAIL' : 'ok  ', key, rec.fail ?? `${rec.loadMs}ms axe=${Array.isArray(rec.axe) ? rec.axe.filter((v) => v.impact === 'serious' || v.impact === 'critical').length : '-'} enum=${rec.text?.enumLeak.length}`);
}

// Nút mang nghĩa nguy hiểm (huỷ/hoàn/duyệt/chi/khoá/xoá/từ chối) bên ngoài hộp thoại.
const DANGER_RE = /^(Huỷ đơn|Hủy đơn|Huỷ|Hủy|Hoàn tiền|Duyệt|Từ chối|Đã chi|Đã nhận tiền|Khoá|Khóa|Mở khoá|Chặn|Xoá|Xóa|Thu hồi|Gỡ|Vô hiệu|Tắt|Đánh dấu đã chi|Xác nhận đã chi|Duyệt rút|Chi thưởng|Xoá tài khoản|Hạ vai trò)/i;

async function probeDanger(route) {
  const key = `danger__${route.id}`;
  if (done.has(key)) return;
  const rec = { key, kind: 'danger', id: route.id, path: route.path, at: new Date().toISOString(), buttons: [] };
  let h;
  try {
    h = await openPage(route, 'normal');
    const labels = await h.page.evaluate((reSrc) => {
      const re = new RegExp(reSrc, 'i');
      const main = document.querySelector('main') ?? document.body;
      const out = [];
      for (const b of main.querySelectorAll('button')) {
        if (b.closest('nav,[role=dialog],[role=alertdialog],[data-confirm-backdrop]')) continue;
        const r = b.getBoundingClientRect();
        if (!r.width || !r.height || b.disabled) continue;
        const t = b.textContent.replace(/\s+/g, ' ').trim();
        if (!re.test(t)) continue;
        if (!out.some((o) => o.label === t)) {
          const cs = getComputedStyle(b);
          out.push({ label: t, color: cs.color, bg: cs.backgroundColor, border: cs.borderColor, cls: (b.className || '').toString().slice(0, 160) });
        }
      }
      return out.slice(0, 8);
    }, DANGER_RE.source);
    await h.page.close();
    await h.context.close();
    h.router.dispose();
    h = null;
    for (const lb of labels) {
      const g = await openPage(route, 'normal');
      let native = null;
      g.page.on('dialog', async (d) => {
        native = `${d.type()}: ${d.message().slice(0, 120)}`;
        await d.dismiss().catch(() => {});
      });
      const before = g.router.calls.length;
      const btn = g.page.locator('main button', { hasText: lb.label }).filter({ hasNotText: '__never__' }).first();
      let clicked = true;
      await btn.click({ timeout: 5000 }).catch(() => (clicked = false));
      await g.page.waitForTimeout(700);
      const dlg = await g.page.evaluate(() => {
        const d = document.querySelector('[role=alertdialog],[role=dialog]');
        if (!d) return null;
        const btns = [...d.querySelectorAll('button')].map((b) => ({ t: b.textContent.replace(/\s+/g, ' ').trim(), bg: getComputedStyle(b).backgroundColor, color: getComputedStyle(b).color }));
        return { role: d.getAttribute('role'), title: (d.querySelector('h2,h3')?.textContent ?? '').trim().slice(0, 80), text: d.textContent.replace(/\s+/g, ' ').trim().slice(0, 200), btns, focus: document.activeElement?.textContent?.trim().slice(0, 30) ?? null };
      });
      const writes = g.router.calls.slice(before).filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.path}`);
      let shot = null;
      if (dlg) {
        const f = path.join(shotDir, `danger__${route.id}__${lb.label.replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 30)}.png`);
        await g.page.screenshot({ path: f });
        shot = path.relative(ROOT, f);
      }
      rec.buttons.push({ ...lb, clicked, dialog: dlg, native, writesWithoutConfirm: writes, shot });
      g.router.dispose();
      await g.page.close().catch(() => {});
      await g.context.close().catch(() => {});
    }
  } catch (e) {
    rec.fail = String(e).slice(0, 300);
  } finally {
    if (h) {
      h.router.dispose();
      await h.page.close().catch(() => {});
      await h.context.close().catch(() => {});
    }
  }
  fs.appendFileSync(resFile, JSON.stringify(rec) + '\n');
  console.log(rec.fail ? 'FAIL' : 'ok  ', key, rec.fail ?? rec.buttons.map((b) => `${b.label}:${b.dialog ? 'dlg' : b.native ? 'native' : b.writesWithoutConfirm.length ? 'WRITE!' : 'none'}`).join(' | '));
}

async function probeFocus(route) {
  const key = `focus__${route.id}`;
  if (done.has(key)) return;
  const rec = { key, kind: 'focus', id: route.id, path: route.path, at: new Date().toISOString(), steps: [] };
  let h;
  try {
    h = await openPage(route, 'normal');
    await h.page.mouse.click(5, 5);
    for (let i = 0; i < 25; i++) {
      await h.page.keyboard.press('Tab');
      const s = await h.page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return { tag: 'body' };
        const cs = getComputedStyle(el);
        const ring = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || (cs.boxShadow && cs.boxShadow !== 'none');
        const r = el.getBoundingClientRect();
        return {
          tag: el.tagName.toLowerCase(),
          label: (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || '').replace(/\s+/g, ' ').trim().slice(0, 40),
          ring,
          outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`,
          shadow: cs.boxShadow.slice(0, 60),
          inView: r.top >= 0 && r.bottom <= innerHeight,
          inNav: !!el.closest('nav'),
        };
      });
      rec.steps.push(s);
    }
    const f = path.join(shotDir, `focus__${route.id}.png`);
    await h.page.screenshot({ path: f });
    rec.shot = path.relative(ROOT, f);
  } catch (e) {
    rec.fail = String(e).slice(0, 300);
  } finally {
    if (h) {
      h.router.dispose();
      await h.page.close().catch(() => {});
      await h.context.close().catch(() => {});
    }
  }
  fs.appendFileSync(resFile, JSON.stringify(rec) + '\n');
  console.log(rec.fail ? 'FAIL' : 'ok  ', key, rec.fail ?? `${rec.steps.filter((s) => s.tag !== 'body' && !s.ring).length}/${rec.steps.length} không có vòng tiêu điểm`);
}

for (const route of routes) {
  if (probe === 'danger') {
    if (route.persona === 'admin') await probeDanger(route);
    continue;
  }
  if (probe === 'focus') {
    await probeFocus(route);
    continue;
  }
  for (const state of onlyStates ?? route.states) {
    if (!route.states.includes(state)) continue;
    await shoot(route, state);
  }
}
await browser.close();
console.log('xong');
