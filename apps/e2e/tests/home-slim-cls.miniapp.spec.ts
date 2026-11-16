import type { Page } from '@playwright/test';
import { expect, test, mockSession } from './support/mock-api';
import { observeCls, readClsTotal } from './support/cls-observer';
import { mockTourWorld, tourOrder, tourUser, ORDER_SHIPPING } from './support/tour-world';
import { probeW182 } from './support/w182-probe';

/**
 * Trang chủ Mini App gọn ở 360×640 và 393×852: thẻ sản phẩm đầu tiên lộ trong khung nhìn đầu (trên thanh đáy), CLS ≤ 0,1 cho khách mới máy chưa nhớ gì
 * và khách có việc cần làm mà dải việc về muộn, không tràn ngang, vùng chạm ≥ 44px, nút ＋ trên thẻ không đè chữ. Dự án Mini chạy WebKit (không có
 * 'layout-shift'), nên ép Chromium để đo CLS thật. `HOME_SLIM_MEASURE=1`: chỉ in số đo, không chặn; `HOME_SLIM_SHOTS`: thư mục chụp ảnh.
 */
test.use({ browserName: 'chromium' });

const MEASURE_ONLY = process.env.HOME_SLIM_MEASURE === '1';
const SHOT_DIR = process.env.HOME_SLIM_SHOTS;
const CLS_MAX = 0.1;
const CARD_VISIBLE_MIN = 48;
const LATE_MS = 1200;
const SIZES = [
  { width: 360, height: 640 },
  { width: 393, height: 852 },
] as const;

async function homeMetrics(page: Page) {
  return page.evaluate(() => {
    const shown = (el: Element) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
    };
    const card = Array.from(document.querySelectorAll('[data-home-block] [data-ds="product-tile"]')).find(shown);
    const nav = Array.from(document.querySelectorAll('nav, [role="navigation"]')).find(
      (n) => getComputedStyle(n).position === 'fixed' && n.getBoundingClientRect().bottom >= window.innerHeight - 1 && shown(n),
    );
    const scroller = (document.querySelector('.zaui-page') as HTMLElement | null) ?? document.documentElement;
    const hits = (a: DOMRect, b: DOMRect) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
    const plusOverText: string[] = [];
    for (const tile of Array.from(document.querySelectorAll('[data-ds="product-tile"]'))) {
      const plus = Array.from(tile.querySelectorAll('button[aria-label$=" vào giỏ"]')).find(shown);
      if (!plus) continue;
      const pr = plus.getBoundingClientRect();
      const texts = Array.from(tile.querySelectorAll('*')).filter(
        (el) => !plus.contains(el) && shown(el) && Array.from(el.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim() !== ''),
      );
      if (texts.some((el) => hits(pr, el.getBoundingClientRect()))) plusOverText.push(plus.getAttribute('aria-label') ?? '');
    }
    return {
      firstCardTop: card ? Math.round(card.getBoundingClientRect().top) : null,
      visibleBottom: Math.round(nav ? nav.getBoundingClientRect().top : window.innerHeight),
      dom: document.getElementsByTagName('*').length,
      heightViewports: Math.round((scroller.scrollHeight / window.innerHeight) * 100) / 100,
      overflowX: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
      plusButtons: document.querySelectorAll('[data-ds="product-tile"] button[aria-label$=" vào giỏ"]').length,
      plusOverText,
    };
  });
}

for (const who of ['new', 'todo'] as const) {
  for (const size of SIZES) {
    test(`Trang chủ Mini ${size.width}px, ${who === 'new' ? 'khách mới máy chưa nhớ gì' : 'khách có việc cần làm, dải việc về muộn, máy chưa nhớ'}`, async ({ page, api }) => {
      const user = tourUser('CUSTOMER');
      mockSession(api, user);
      mockTourWorld(api, user);
      if (who === 'new') {
        api.get('/orders/home-todo', { pending: null, shipping: null, processing: null });
      } else {
        const late = () => new Promise((resolve) => setTimeout(resolve, LATE_MS));
        api.get('/orders/home-todo', async () => {
          await late();
          return { pending: null, shipping: { order: tourOrder(ORDER_SHIPPING, 'SHIPPING'), total: 1 }, processing: null };
        });
      }
      api.allowUnmocked('GET /auth/me', 'GET /waste/requests');
      await page.addInitScript(() => {
        try {
          localStorage.setItem('tubu_garden_hint_seen', '1');
        } catch {
          // không có localStorage: trang vẫn dựng
        }
      });
      await observeCls(page);
      await page.setViewportSize(size);
      await page.goto('/');
      await expect(page.locator('[data-home-block] [data-ds="product-tile"]').first()).toBeVisible({ timeout: 15_000 });
      await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
      await page.waitForTimeout(LATE_MS + 900);

      const cls = await readClsTotal(page);
      const m = await homeMetrics(page);
      const line = `HOME_SLIM_MINI ${who} ${size.width}x${size.height} cls=${cls.cls.toFixed(4)} firstCard=${m.firstCardTop ?? 'none'} visibleBottom=${m.visibleBottom} dom=${m.dom} height=${m.heightViewports}vh overflowX=${m.overflowX} plus=${m.plusButtons}`;
      console.log(line);
      if (cls.sources.length) console.log(cls.sources.slice(0, 6).map((s) => `  shift ${s}`).join('\n'));
      if (SHOT_DIR) await page.screenshot({ path: `${SHOT_DIR}/mini-${who}-${size.width}.png` });
      if (MEASURE_ONLY) return;

      const probe = await probeW182(page, { touch: true, capsule: false });
      expect(m.overflowX, 'tràn ngang').toBe(0);
      expect(probe.small, `vùng chạm nhỏ ${JSON.stringify(probe.small)}`).toEqual([]);
      expect(probe.textOverlap, 'chữ đè nhau').toEqual([]);
      expect(cls.cls, `CLS ${cls.sources.join(' ; ')}`).toBeLessThanOrEqual(CLS_MAX);
      expect(m.firstCardTop, 'có thẻ sản phẩm').not.toBeNull();
      expect(m.firstCardTop!, 'thẻ sản phẩm đầu tiên lộ trong khung nhìn đầu').toBeLessThanOrEqual(m.visibleBottom - CARD_VISIBLE_MIN);
      expect(m.plusButtons, 'thẻ còn hàng có nút ＋').toBeGreaterThan(0);
      expect(m.plusOverText, 'nút ＋ không đè chữ của thẻ').toEqual([]);
    });
  }
}
