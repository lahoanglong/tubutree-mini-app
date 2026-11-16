import { test } from './support/mock-api';
import { expect, type Page } from '@playwright/test';
import { assertSeededOnCi } from './support/a11y-db';
import { observeCls, readClsTotal } from './support/cls-observer';
import { solidPng } from './support/noise-png';
import { seedTourPublicData } from './support/tour-db';
import { mockTourWorld, tourOrder, tourUser, ORDER_SHIPPING } from './support/tour-world';

/**
 * Trang chủ web gọn: thẻ sản phẩm đầu tiên nằm trong khung nhìn đầu, CLS ≤ 0,1 cho khách vãng lai (bộ nhớ trống) và khách có phiên mà máy chưa nhớ gì
 * (dải ngữ cảnh về muộn), không tràn ngang, trang không dài quá và không quá nhiều nút DOM. HTML đầu dựng từ DB e2e đã seed (như w182-acceptance).
 * `HOME_SLIM_MEASURE=1`: chỉ in số đo (lập bảng trước/sau), không chặn.
 */
const MEASURE_ONLY = process.env.HOME_SLIM_MEASURE === '1';
const SHOT_DIR = process.env.HOME_SLIM_SHOTS;
const CLS_MAX = 0.1;
/** Mục tiêu wave: trang chủ (trước khi cuộn vô tận nạp thêm) không dài quá 4,5 khung nhìn ở điện thoại, DOM ≤ 1.200 nút. */
const HEIGHT_MAX_VIEWPORTS = 4.5;
const DOM_MAX = 1200;
/** Thẻ đầu phải lộ ít nhất chừng này (px) trên thanh đáy: một mép ảnh lấp ló không phải "thấy sản phẩm". */
const CARD_VISIBLE_MIN = 48;
/** Dải ngữ cảnh của khách có phiên về sau chừng này: đủ để HTML đầu đã vẽ xong phần dưới. */
const LATE_MS = 1200;

const SIZES = [
  { width: 320, height: 640 },
  { width: 360, height: 640 },
  { width: 375, height: 812 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
] as const;

const IMAGE_PNG = solidPng(150, 60, [47, 107, 79]);
const isServedImage = (url: URL) => url.pathname === '/api/img' || url.pathname.startsWith('/api/public-image/');

test.beforeAll(async () => {
  for (let attempt = 1; ; attempt += 1) {
    try {
      assertSeededOnCi(await seedTourPublicData());
      return;
    } catch (e) {
      if (attempt >= 4 || !/40P01|deadlock/i.test(String(e))) throw e;
      await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
    }
  }
});

interface HomeMetrics {
  firstCardTop: number | null;
  visibleBottom: number;
  dom: number;
  heightViewports: number;
  overflowX: number;
}

async function homeMetrics(page: Page): Promise<HomeMetrics> {
  return page.evaluate(() => {
    const shown = (el: Element) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
    };
    const card = Array.from(document.querySelectorAll('main [data-ds="product-tile"]')).find(shown);
    const nav = Array.from(document.querySelectorAll('nav')).find((n) => getComputedStyle(n).position === 'fixed' && n.getBoundingClientRect().bottom >= window.innerHeight - 1 && shown(n));
    const visibleBottom = nav ? nav.getBoundingClientRect().top : window.innerHeight;
    return {
      firstCardTop: card ? Math.round(card.getBoundingClientRect().top + window.scrollY) : null,
      visibleBottom: Math.round(visibleBottom),
      dom: document.getElementsByTagName('*').length,
      heightViewports: Math.round((document.documentElement.scrollHeight / window.innerHeight) * 100) / 100,
      overflowX: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
    };
  });
}

for (const who of ['guest', 'session'] as const) {
  for (const size of SIZES) {
    test(`Trang chủ web ${size.width}px, ${who === 'guest' ? 'khách vãng lai bộ nhớ trống' : 'khách có phiên, máy chưa nhớ, dải ngữ cảnh về muộn'}`, async ({ page, api }, testInfo) => {
      test.skip(testInfo.project.name !== 'Web Customer', 'tự đặt khổ từng ca, chỉ chạy ở một project');
      const user = tourUser('CUSTOMER');
      mockTourWorld(api, user);
      if (who === 'session') {
        await page.context().addCookies([{ name: 'tubu_web_session', value: '1', domain: 'localhost', path: '/' }]);
        await page.addInitScript(() => {
          try {
            localStorage.setItem('tubu_web_session', '1');
            localStorage.setItem('tubu_garden_hint_seen', '1');
          } catch {
            // không có localStorage
          }
        });
        const late = () => new Promise((resolve) => setTimeout(resolve, LATE_MS));
        api.get('/me/summary', async () => {
          await late();
          return { orders: { pending_payment: 0, processing: 0, shipping: 1, delivered: 1, closed: 0, active: 1 }, unreadNotifications: 0, activeSubscriptions: 0 };
        });
        api.get('/orders/home-todo', async () => {
          await late();
          return { pending: null, shipping: { order: tourOrder(ORDER_SHIPPING, 'SHIPPING'), total: 1 }, processing: null };
        });
      } else {
        await page.addInitScript(() => {
          try {
            localStorage.setItem('tubu_garden_hint_seen', '1');
          } catch {
            // không có localStorage
          }
        });
      }
      api.allowUnmocked('GET /auth/me', 'GET /me/summary', 'GET /waste/requests');
      await page.route(isServedImage, (route) => route.fulfill({ contentType: 'image/png', body: IMAGE_PNG }));
      await observeCls(page);
      await page.setViewportSize(size);
      await page.goto('/');
      await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
      await page.evaluate(() => document.fonts.ready.then(() => undefined)).catch(() => {});
      await page.waitForTimeout(LATE_MS + 900);

      const cls = await readClsTotal(page);
      const m = await homeMetrics(page);
      const line = `HOME_SLIM ${who} ${size.width}x${size.height} cls=${cls.cls.toFixed(4)} firstCard=${m.firstCardTop ?? 'none'} visibleBottom=${m.visibleBottom} dom=${m.dom} height=${m.heightViewports}vh overflowX=${m.overflowX}`;
      console.log(line);
      if (cls.sources.length) console.log(cls.sources.slice(0, 6).map((s) => `  shift ${s}`).join('\n'));
      testInfo.annotations.push({ type: 'HOME_SLIM', description: line });
      if (SHOT_DIR) await page.screenshot({ path: `${SHOT_DIR}/web-${who}-${size.width}.png` });
      if (MEASURE_ONLY) return;

      expect(m.overflowX, 'tràn ngang').toBe(0);
      expect(cls.cls, `CLS ${cls.sources.join(' ; ')}`).toBeLessThanOrEqual(CLS_MAX);
      expect(m.firstCardTop, 'có thẻ sản phẩm').not.toBeNull();
      expect(m.firstCardTop!, 'thẻ sản phẩm đầu tiên lộ trong khung nhìn đầu').toBeLessThanOrEqual(m.visibleBottom - CARD_VISIBLE_MIN);
      if (size.width < 768) {
        expect(m.dom, 'số nút DOM').toBeLessThanOrEqual(DOM_MAX);
        expect(m.heightViewports, 'chiều dài trang (khung nhìn)').toBeLessThanOrEqual(HEIGHT_MAX_VIEWPORTS);
      }
    });
  }
}
