// U4: quy tắc Mini (thanh đáy 5 tab, không link ra ngoài), thứ tự khối Trang chủ lần mở thứ hai trên web 375, kẻ khối gây tràn ngang của Đơn hàng web 375.
// Chạy:  node /Users/longla/coding/tubutree-mini-app/.claude/worktrees/gl-1103-docs/docs/2026-11-04-uat/scripts/L1-mua-hang/U4-rules.mjs
import { openSurface, shot, rec, closePrisma } from './lib.mjs';

const FILE = 'U4';
const txt = (p) => p.evaluate(() => document.body.innerText);
const order = (t) => ['Giờ vàng', 'Mua lại', 'Danh mục', 'Bán chạy nhất'].map((h) => [h, t.indexOf(`\n${h}\n`) >= 0 ? t.indexOf(`\n${h}\n`) : t.indexOf(h)]).filter(([, i]) => i >= 0).sort((a, b) => a[1] - b[1]).map(([h]) => h).join(' > ');

// 1. thứ tự khối Trang chủ: lần mở đầu và lần mở thứ hai (cùng trình duyệt, máy đã nhớ loại khách)
const PART = process.argv[2] ?? 'all';
for (const surf of PART === 'all' || PART === 'home' ? ['mini375', 'web375'] : []) {
  const s = await openSurface(surf, 'returning', '/');
  try {
    await s.page.waitForTimeout(4500);
    for (let i = 0; i < 8; i++) {
      await s.page.evaluate(() => {
        const c = [document.scrollingElement, ...document.querySelectorAll('*')].filter((e) => e && e.scrollHeight > e.clientHeight + 40 && (e === document.scrollingElement || /(auto|scroll)/.test(getComputedStyle(e).overflowY))).sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
        if (c) c.scrollTop += 600;
      });
      await s.page.waitForTimeout(300);
    }
    const first = order(await txt(s.page));
    await s.page.goto(s.page.url());
    await s.page.waitForTimeout(4500);
    for (let i = 0; i < 8; i++) {
      await s.page.evaluate(() => {
        const c = [document.scrollingElement, ...document.querySelectorAll('*')].filter((e) => e && e.scrollHeight > e.clientHeight + 40 && (e === document.scrollingElement || /(auto|scroll)/.test(getComputedStyle(e).overflowY))).sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
        if (c) c.scrollTop += 600;
      });
      await s.page.waitForTimeout(300);
    }
    const second = order(await txt(s.page));
    rec(FILE, { id: `U4-home-order-${surf}`, persona: 'returning', surface: surf, journey: 'Trang chủ', step: 'thứ tự khối hàng, lần mở đầu và lần mở thứ hai cùng trình duyệt', expected: 'khách cũ: Giờ vàng > Mua lại > Danh mục > Bán chạy nhất (home-layout.ts RETURNING); lần đầu web có thể đặt Mua lại sau Bán chạy (homeKeptOrder)', actual: `lần 1: ${first}; lần 2: ${second}`, status: second === 'Giờ vàng > Mua lại > Danh mục > Bán chạy nhất' ? 'PASS' : 'FAIL' });
  } finally {
    await s.close();
  }
}

// 2. Mini: thanh đáy và link ngoài
const MINI_PAGES = ['/', '/browse', '/offers', '/game', '/profile', '/vouchers', '/flash-sale', '/cart', '/checkout', '/orders'];
const TABS = ['Trang chủ', 'Danh mục', 'Vườn Xanh', 'Ưu đãi', 'Cá nhân'];
for (const p of PART === 'all' || PART === 'bar' ? MINI_PAGES : []) {
  const s = await openSurface('mini375', 'returning', p);
  try {
    await s.page.waitForTimeout(3500);
    const info = await s.page.evaluate((tabs) => {
      const text = document.body.innerText;
      const ext = [...document.querySelectorAll('a[href]')].map((a) => a.href).filter((h) => /^https?:/i.test(h) && new URL(h).origin !== location.origin);
      const fixed = [...document.querySelectorAll('*')].filter((e) => {
        const st = getComputedStyle(e);
        const r = e.getBoundingClientRect();
        return st.position === 'fixed' && r.bottom >= window.innerHeight - 2 && r.height < 120 && tabs.filter((t) => e.innerText.includes(t)).length >= 3;
      });
      const bar = fixed[0];
      return { ext, tabsFound: bar ? tabs.filter((t) => bar.innerText.includes(t)).length : 0, hasBar: !!bar, text: text.slice(0, 80) };
    }, TABS);
    // nav-config.ts: 5 tab là /, /browse, /game, /offers, /profile; mọi trang khác là trang con, không có thanh đáy.
    const tabPage = ['/', '/browse', '/offers', '/game', '/profile'].includes(p);
    const okBar = tabPage ? info.hasBar && info.tabsFound === 5 : true;
    rec(FILE, { id: `U4-mini-bar-${p.replace(/\W+/g, '_') || 'home'}`, persona: 'returning', surface: 'mini375', journey: 'quy tắc Mini', step: `${p}: thanh đáy 5 tab; không link http(s) ra ngoài`, expected: tabPage ? '5 tab (Trang chủ, Danh mục, Vườn Xanh, Ưu đãi, Cá nhân) trên trang gốc; 0 link ngoài' : '0 link ngoài; trang con không có thanh đáy (nav-config.ts isRootPath)', actual: `thanh đáy=${info.hasBar} (${info.tabsFound}/5 nhãn); link ngoài: ${info.ext.length ? info.ext.slice(0, 3).join(', ') : 'không'}`, status: okBar && info.ext.length === 0 ? 'PASS' : 'FAIL' });
    if (p === '/') await shot(s.page, 'U4-mini-home-bar');
  } finally {
    await s.close();
  }
}

// 3. web 375: tìm khối làm Đơn hàng tràn ngang
if (PART === 'all' || PART === 'overflow') {
  const s = await openSurface('web375', 'returning', '/tai-khoan/don-hang');
  try {
    await s.page.waitForTimeout(4500);
    const r = await s.page.evaluate(() => {
      const W = document.documentElement.clientWidth;
      const out = [];
      for (const e of document.querySelectorAll('body *')) {
        const b = e.getBoundingClientRect();
        if (b.width === 0 || b.height === 0) continue;
        const st = getComputedStyle(e);
        if (st.visibility === 'hidden' || st.display === 'none') continue;
        if (b.right > W + 0.5 || b.left < -0.5) {
          // bỏ qua phần tử nằm trong khung cuộn ngang (overflow-x auto/scroll của tổ tiên)
          let a = e.parentElement;
          let scrolled = false;
          while (a && a !== document.body) {
            if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(a).overflowX)) {
              scrolled = true;
              break;
            }
            a = a.parentElement;
          }
          if (!scrolled) out.push(`${e.tagName.toLowerCase()}.${String(e.className).slice(0, 60)} right=${Math.round(b.right)} left=${Math.round(b.left)} "${(e.innerText || '').slice(0, 30).replace(/\n/g, ' ')}"`);
        }
      }
      return { W, sw: document.documentElement.scrollWidth, bodySw: document.body.scrollWidth, out: out.slice(0, 8) };
    });
    rec(FILE, { id: 'U4-orders-overflow-web375', persona: 'returning', surface: 'web375', journey: 'đơn hàng', step: 'Đơn hàng web 375: trang không được cuộn ngang', expected: 'scrollWidth = 375', actual: `scrollWidth=${r.sw} (body ${r.bodySw}) / ${r.W}; phần tử lòi ra: ${r.out.join(' || ') || 'không tìm thấy'}`, status: r.sw <= r.W ? 'PASS' : 'FAIL' });
  } finally {
    await s.close();
  }
}
await closePrisma();
