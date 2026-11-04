// U1: chụp và rút chữ các màn mua hàng trên Mini 375, web 375, web 1280 cho một persona.
// Chạy:  node /Users/longla/coding/tubutree-mini-app/.claude/worktrees/gl-1103-docs/docs/2026-11-04-uat/scripts/L1-mua-hang/U1-capture.mjs <persona> [nhóm: pub|cart|order|all] [lọc-khoá]
// Kết quả: results/ui/<persona>/<khoá>/<khổ>.json  +  shots/L1-mua-hang/<persona>__<khoá>__<khổ>.png
import fs from 'node:fs';
import path from 'node:path';
import { openSurface, shot, shotFull, closePrisma, RESULTS, SHOTS, sql, sqlExec, api, L } from './lib.mjs';
import { V, who, fresh, fillCart, quote, place } from './kit.mjs';

const persona = process.argv[2] ?? 'returning';
const group = process.argv[3] ?? 'all';
const filter = process.argv[4];
const SURFACES = ['mini375', 'web375', 'web1280'];
const enc = encodeURIComponent;

// ---- bảng màn: khoá, đường dẫn Mini/web, nhóm, hàm dựng trạng thái ----
const pub = [
  { key: 'home', mini: '/', web: '/' },
  { key: 'browse', mini: '/browse', web: '/san-pham' },
  { key: 'category', mini: '/browse?category=cat-cleaning', web: '/san-pham?category=cat-cleaning' },
  { key: 'search-dau', mini: `/browse?q=${enc('rửa chén')}`, web: `/san-pham?q=${enc('rửa chén')}` },
  { key: 'search-khongdau', mini: `/browse?q=${enc('rua chen')}`, web: `/san-pham?q=${enc('rua chen')}` },
  { key: 'search-rong', mini: `/browse?q=${enc('xyzabc')}`, web: `/san-pham?q=${enc('xyzabc')}` },
  { key: 'pdp-bienthe', mini: '/product/nuoc-rua-chen-fuwa3e', web: '/san-pham/nuoc-rua-chen-fuwa3e' },
  { key: 'pdp-sale', mini: '/product/serum-duong-am-visante', web: '/san-pham/serum-duong-am-visante' },
  { key: 'pdp-flash', mini: '/product/hat-dieu-rang-moc-bhnong', web: '/san-pham/hat-dieu-rang-moc-bhnong' },
  { key: 'pdp-hethang', mini: '/product/tieu-den-bhnong', web: '/san-pham/tieu-den-bhnong' },
  { key: 'pdp-khongco', mini: '/product/khong-co-san-pham-nay', web: '/san-pham/khong-co-san-pham-nay' },
  { key: 'flash', mini: '/flash-sale', web: '/gio-vang' },
  { key: 'vouchers', mini: '/vouchers', web: '/ma-giam-gia' },
];
const cart = [
  { key: 'cart-trong', mini: '/cart', web: '/gio-hang', setup: async (w) => fillCart(w, []) },
  { key: 'cart-co-hang', mini: '/cart', web: '/gio-hang', setup: async (w) => fillCart(w, [[V.LAUNDRY, 2], [V.SERUM30, 1]]) },
  { key: 'cart-duoi-ngu', mini: '/cart', web: '/gio-hang', setup: async (w) => fillCart(w, [[V.KINH, 1]]) },
  {
    key: 'cart-ma-giam',
    mini: '/cart',
    web: '/gio-hang',
    setup: async (w) => {
      await fillCart(w, [[V.LAUNDRY, 1], [V.HANDWASH, 1]]);
      await api(L, 'POST', '/cart/coupon', { token: w.token, body: { code: 'UATX10' } });
    },
  },
  {
    key: 'cart-flash',
    mini: '/cart',
    web: '/gio-hang',
    setup: async (w) => fillCart(w, [['cmqfv2cns001nzxplvuhm8hyq', 1], [V.DISH1L, 1]]),
  },
  {
    key: 'cart-het-hang',
    mini: '/cart',
    web: '/gio-hang',
    setup: async (w) => {
      await fillCart(w, [[V.GAOLUT, 2], [V.KINH, 1]]);
      await sqlExec(`update variations set stock = 0 where id = '${V.GAOLUT}'`);
    },
    teardown: async () => sqlExec(`update variations set stock = 220 where id = '${V.GAOLUT}'`),
  },
  {
    key: 'checkout',
    mini: '/checkout',
    web: '/thanh-toan',
    setup: async (w) => fillCart(w, [[V.LAUNDRY, 1], [V.HANDWASH, 1]]),
  },
  {
    key: 'checkout-diem',
    mini: '/checkout',
    web: '/thanh-toan',
    setup: async (w) => fillCart(w, [[V.LAUNDRY, 2], [V.SERUM30, 1]]),
  },
  { key: 'checkout-trong', mini: '/checkout', web: '/thanh-toan', setup: async (w) => fillCart(w, []) },
];
const orderPages = [
  { key: 'orders', mini: '/orders', web: '/tai-khoan/don-hang' },
  { key: 'order-cho-ck', mini: (c) => `/order/${c.pending}`, web: (c) => `/tai-khoan/don-hang/${c.pending}`, needs: 'pending' },
  { key: 'order-da-giao', mini: (c) => `/order/${c.delivered}`, web: (c) => `/tai-khoan/don-hang/${c.delivered}`, needs: 'delivered' },
  { key: 'order-da-huy', mini: (c) => `/order/${c.cancelled}`, web: (c) => `/tai-khoan/don-hang/${c.cancelled}`, needs: 'cancelled' },
  { key: 'order-cod', mini: (c) => `/order/${c.cod}`, web: (c) => `/tai-khoan/don-hang/${c.cod}`, needs: 'cod' },
  { key: 'bank-payment', mini: (c) => `/bank-payment/${c.pending}`, web: (c) => `/thanh-toan/chuyen-khoan/${c.pending}`, needs: 'pending' },
  { key: 'order-khong-co', mini: '/order/TUBU0000000000', web: '/tai-khoan/don-hang/TUBU0000000000' },
];

const wanted = [...(group === 'pub' || group === 'all' ? pub : []), ...(group === 'cart' || group === 'all' ? cart : []), ...(group === 'order' || group === 'all' ? orderPages : [])].filter((p) => !filter || p.key.includes(filter));

const isGuest = persona === 'guest';
const w = isGuest || persona === 'noaddr' ? null : await who(persona);
const wFresh = persona === 'noaddr' ? await fresh('noaddr') : null;
const wAny = w ?? (isGuest ? await who('guest') : wFresh);
if (persona === 'noaddr') {
  await sqlExec(`delete from addresses where "userId" = '${wAny.userId}'`);
}

// mã đơn mẫu của persona cho nhóm order
async function orderCodes() {
  const q = (status, extra = '') => sql(`select code from orders where "userId"='${wAny.userId}' and ${status} ${extra} order by "createdAt" desc limit 1`).then((r) => r[0]?.code);
  return {
    pending: await q(`status='PENDING_PAYMENT' and "paymentMethod"='BANK_TRANSFER'`),
    delivered: await q(`status='DELIVERED'`),
    cancelled: await q(`status='CANCELLED'`),
    cod: await q(`status in ('CONFIRMED','PACKED','SHIPPING') and "paymentMethod"='COD'`),
  };
}

/** Cuộn hết khung cuộn lớn nhất (Mini cuộn trong một khung bên trong, web cuộn cả trang) để các khối tải lười hiện đủ, rồi về đầu trang. */
async function autoScroll(page) {
  for (let i = 0; i < 40; i++) {
    const more = await page.evaluate(() => {
      const cands = [document.scrollingElement, ...document.querySelectorAll('*')].filter((el) => {
        if (!el) return false;
        const st = getComputedStyle(el);
        return el.scrollHeight > el.clientHeight + 40 && (el === document.scrollingElement || /(auto|scroll)/.test(st.overflowY));
      });
      cands.sort((a, b) => b.scrollHeight - a.scrollHeight);
      const el = cands[0];
      if (!el) return false;
      const before = el.scrollTop;
      el.scrollTop = before + 500;
      return el.scrollTop > before;
    });
    await page.waitForTimeout(350);
    if (!more) break;
  }
  await page.evaluate(() => {
    for (const el of [document.scrollingElement, ...document.querySelectorAll('*')]) if (el && el.scrollTop) el.scrollTop = 0;
  });
  await page.waitForTimeout(300);
}

/** Ảnh khổ điện thoại theo từng màn hình cuộn (khung cuộn lớn nhất): <tên>.png là đầu trang, <tên>__p2.png... là các đoạn kế. */
async function stepShots(page, name, n) {
  await shot(page, name);
  for (let i = 2; i <= n; i++) {
    const moved = await page.evaluate(() => {
      const cands = [document.scrollingElement, ...document.querySelectorAll('*')].filter((el) => {
        if (!el) return false;
        const st = getComputedStyle(el);
        return el.scrollHeight > el.clientHeight + 40 && (el === document.scrollingElement || /(auto|scroll)/.test(st.overflowY));
      });
      cands.sort((a, b) => b.scrollHeight - a.scrollHeight);
      const el = cands[0];
      if (!el) return false;
      const before = el.scrollTop;
      el.scrollTop = before + Math.round(window.innerHeight * 0.85);
      return el.scrollTop > before;
    });
    if (!moved) break;
    await page.waitForTimeout(400);
    await shot(page, `${name}__p${i}`);
  }
  await page.evaluate(() => {
    for (const el of [document.scrollingElement, ...document.querySelectorAll('*')]) if (el && el.scrollTop) el.scrollTop = 0;
  });
}

const outDir = path.join(RESULTS, 'ui', persona);
fs.mkdirSync(outDir, { recursive: true });
const codes = group === 'cart' || group === 'pub' ? {} : await orderCodes();

for (const page of wanted) {
  if (page.needs && !codes[page.needs]) {
    console.log(`BỎ QUA ${persona}/${page.key}: persona không có đơn ${page.needs}`);
    continue;
  }
  const dir = path.join(outDir, page.key);
  fs.mkdirSync(dir, { recursive: true });
  for (const surf of SURFACES) {
    const miniPath = typeof page.mini === 'function' ? page.mini(codes) : page.mini;
    const webPath = typeof page.web === 'function' ? page.web(codes) : page.web;
    const t0 = Date.now();
    let s;
    // Dựng lại trạng thái giỏ cho TỪNG khổ: bản tự áp mã/xoá mã của khổ trước ghi xuống server và làm lệch khổ sau.
    if (page.setup) await page.setup(wAny);
    try {
      s = await openSurface(surf, isGuest ? 'guest' : persona === 'noaddr' ? 'noaddr' : persona, surf === 'mini375' ? miniPath : webPath);
      await s.page.waitForTimeout(2500);
      if (surf === 'mini375' || surf === 'web375') await s.page.waitForTimeout(500);
      await autoScroll(s.page);
      const text = await s.page.evaluate(() => document.body.innerText);
      const png = `${persona}__${page.key}__${surf}`;
      if (surf === 'web1280') {
        await shotFull(s.page, png).catch(async () => shot(s.page, png));
      } else {
        await stepShots(s.page, png, page.shots ?? 3);
      }
      const info = await s.page.evaluate(() => ({
        title: document.title,
        scrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth,
        url: location.pathname + location.search,
      }));
      fs.writeFileSync(
        path.join(dir, `${surf}.json`),
        JSON.stringify({ persona, key: page.key, surf, ms: Date.now() - t0, ...info, text, badRequests: s.requests.filter((r) => r.status >= 400 || r.status === 0), errors: s.errors, consoleErrors: s.consoleErrors.slice(0, 8), blocked: s.blocked }, null, 1),
      );
      console.log(`ok ${persona}/${page.key}/${surf} ${Date.now() - t0}ms scrollW=${info.scrollW}/${info.clientW} bad=${s.requests.filter((r) => r.status >= 400).length}`);
    } catch (e) {
      console.log(`LỖI ${persona}/${page.key}/${surf}: ${e.message}`);
      fs.writeFileSync(path.join(dir, `${surf}.json`), JSON.stringify({ persona, key: page.key, surf, error: String(e.message) }));
    } finally {
      await s?.close().catch(() => undefined);
    }
  }
  if (page.teardown) await page.teardown();
}
await closePrisma();
