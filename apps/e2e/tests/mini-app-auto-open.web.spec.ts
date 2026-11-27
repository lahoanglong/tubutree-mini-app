import { mkdirSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { expect, publicConfig, test, type MockApi } from './support/mock-api';
import { firstProduct } from './support/pdp-product';

/**
 * Web điện thoại tự mở Zalo Mini App (W42, cờ `app.mobile_miniapp_redirect_enabled`): apps/web/src/components/layout/mini-app-auto-open.tsx.
 * Trình duyệt Playwright có `navigator.webdriver = true` nên mặc định chỉ thấy dải mời (không chuyển ngầm); ca tự mở giả lập trình duyệt thường
 * bằng cách che `webdriver`, rồi chặn lượt sang zalo.me để kiểm đúng link. Đặt MINIAPP_AUTO_SHOTS_DIR để chụp ảnh 375px.
 */
const SHOTS = process.env.MINIAPP_AUTO_SHOTS_DIR;
const PAGE = '/cau-chuyen';
const DEEP_LINK_RE = /^https:\/\/zalo\.me\/s\/\d+\/brand-story$/;

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'Web Customer Mobile', 'cần UA điện thoại (Pixel 7), chỉ chạy ở một project');
});
test.use({ viewport: { width: 375, height: 812 } });

function mockPage(api: MockApi, flagOn: boolean): void {
  api.get('/config/public', { ...publicConfig(), mobileMiniappRedirectEnabled: flagOn });
  // Trang tĩnh: lời gọi phụ (đếm giỏ, gợi ý, sự kiện) không phải đối tượng của spec này.
  api.allowUnmocked('GET /:a', 'GET /:a/:b', 'GET /:a/:b/:c', 'POST /events', 'POST /events/:a', 'POST /events/:a/:b');
}

async function cookieOf(page: Page, name: string) {
  return (await page.context().cookies()).find((c) => c.name === name) ?? null;
}

function zaloRequests(page: Page): string[] {
  const urls: string[] = [];
  page.on('request', (r) => {
    if (r.url().startsWith('https://zalo.me/')) urls.push(r.url());
  });
  return urls;
}

const bar = (page: Page) => page.getByTestId('miniapp-smartbar');

/**
 * Đo dịch bố cục (W44 U4): tổng layout-shift không do thao tác của khách, và đỉnh phần tử đầu của `<main>` lúc DOMContentLoaded (trước khi
 * React vẽ dải) để so với lúc dải đã hiện. Chỗ giữ chỗ đúng thì hai số trùng nhau.
 */
async function watchLayout(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __cls: number; __topAtDcl: number | null; __reservedAtDcl: boolean };
    w.__cls = 0;
    w.__topAtDcl = null;
    w.__reservedAtDcl = false;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) if (!e.hadRecentInput) w.__cls += e.value;
    }).observe({ type: 'layout-shift', buffered: true });
    document.addEventListener('DOMContentLoaded', () => {
      w.__reservedAtDcl = document.documentElement.hasAttribute('data-miniapp-bar');
      const first = document.querySelector('main')?.firstElementChild;
      w.__topAtDcl = first ? first.getBoundingClientRect().top : null;
    });
  });
}

const layoutNow = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { __cls: number; __topAtDcl: number | null; __reservedAtDcl: boolean };
    const first = document.querySelector('main')?.firstElementChild;
    return { cls: w.__cls, topAtDcl: w.__topAtDcl, reservedAtDcl: w.__reservedAtDcl, top: first ? first.getBoundingClientRect().top : null };
  });

test.describe('Web điện thoại: tự mở Mini App (W42)', () => {
  test('cờ tắt: không dải, không lớp phủ, không cookie, không sang Zalo', async ({ page, api }) => {
    mockPage(api, false);
    const zalo = zaloRequests(page);
    await page.goto(PAGE);
    await expect(page.locator('main').first()).toBeVisible();
    await page.waitForTimeout(2500);
    await expect(bar(page)).toHaveCount(0);
    await expect(page.getByTestId('miniapp-opening')).toHaveCount(0);
    expect(await cookieOf(page, 'tubu_mini_auto')).toBeNull();
    expect(zalo).toEqual([]);
  });

  test('cờ bật, trình duyệt tự động: chỉ dải mời nằm trong luồng ở đầu nội dung, không cookie tự mở, không sang Zalo', async ({ page, api }) => {
    mockPage(api, true);
    const zalo = zaloRequests(page);
    await page.goto(PAGE);
    await expect(bar(page)).toBeVisible({ timeout: 15_000 });
    await expect(bar(page).getByRole('button', { name: 'Mở', exact: true })).toBeVisible();
    expect(await bar(page).evaluate((el) => getComputedStyle(el).position)).toBe('static');
    const box = (await bar(page).boundingBox())!;
    const mainTop = (await page.locator('main').first().boundingBox())!.y;
    expect(box.y + box.height, 'dải nằm trên nội dung, không đè').toBeLessThanOrEqual(mainTop + 1);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(375);
    // Trang con tràn viền (PageHeader): nút lùi nổi không được đè lên dải.
    const back = (await page.getByRole('button', { name: 'Quay lại' }).first().boundingBox())!;
    const overlap = !(back.x + back.width <= box.x || box.x + box.width <= back.x || back.y + back.height <= box.y || box.y + box.height <= back.y);
    expect(overlap, `nút lùi ${JSON.stringify(back)} đè dải ${JSON.stringify(box)}`).toBe(false);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    expect(await cookieOf(page, 'tubu_mini_auto')).toBeNull();
    expect(zalo).toEqual([]);
    if (SHOTS) {
      mkdirSync(SHOTS, { recursive: true });
      await page.screenshot({ path: `${SHOTS}/web375-miniapp-smartbar.png` });
    }
  });

  test('× trên dải: ghi tubu_stay_web 24 giờ, dải biến mất và không quay lại khi tải lại', async ({ page, api }) => {
    mockPage(api, true);
    await page.goto(PAGE);
    await bar(page).getByRole('button', { name: 'Đóng, ở lại bản Web' }).click();
    await expect(bar(page)).toHaveCount(0);
    const stay = (await cookieOf(page, 'tubu_stay_web'))!;
    expect(stay.value).toBe('1');
    expect(Math.abs(stay.expires - Date.now() / 1000 - 86_400)).toBeLessThan(300);
    await page.reload();
    await expect(page.locator('main').first()).toBeVisible();
    await page.waitForTimeout(2500);
    await expect(bar(page)).toHaveCount(0);
  });

  test('?stay=web: ghi tubu_stay_web, bỏ tham số khỏi địa chỉ, không dải', async ({ page, api }) => {
    mockPage(api, true);
    await page.goto(`${PAGE}?ref=A1&stay=web`);
    await expect.poll(async () => (await cookieOf(page, 'tubu_stay_web'))?.value ?? null, { timeout: 15_000 }).toBe('1');
    await expect.poll(() => new URL(page.url()).search).toBe('?ref=A1');
    await page.waitForTimeout(1500);
    await expect(bar(page)).toHaveCount(0);
    expect(await cookieOf(page, 'tubu_mini_auto')).toBeNull();
  });

  test('trang bị loại (giỏ hàng): không dải', async ({ page, api }) => {
    mockPage(api, true);
    await page.goto('/gio-hang');
    await page.waitForTimeout(2500);
    await expect(bar(page)).toHaveCount(0);
  });

  test('trình duyệt thường: ghi tubu_mini_auto 24 giờ, lớp phủ có lối "Ở lại bản Web" dạng chữ, rồi mở đúng màn Mini App', async ({ page, api }) => {
    mockPage(api, true);
    await page.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, 'webdriver', { configurable: true, get: () => false });
    });
    // Giữ lượt sang zalo.me tới khi kiểm xong: trang hiện tại còn nguyên lớp phủ trong lúc chờ (như khi hệ điều hành hỏi "Mở bằng Zalo?").
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('https://zalo.me/**', async (route) => {
      await hold;
      await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Zalo</title><p>zalo</p>' });
    });
    const nav = page.waitForRequest((r) => r.url().startsWith('https://zalo.me/'), { timeout: 20_000 });
    await page.goto(PAGE);
    const overlay = page.getByTestId('miniapp-opening');
    await expect(overlay).toBeVisible({ timeout: 15_000 });
    await expect(overlay.getByRole('status')).toHaveText('Đang mở Tubu Tree trên Zalo…');
    const stay = overlay.getByRole('button', { name: 'Ở lại bản Web' });
    await expect(stay).toBeVisible();
    expect(await stay.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
    if (SHOTS) {
      mkdirSync(SHOTS, { recursive: true });
      await page.screenshot({ path: `${SHOTS}/web375-miniapp-opening.png` });
    }
    expect((await nav).url()).toMatch(DEEP_LINK_RE);
    const auto = await cookieOf(page, 'tubu_mini_auto');
    expect(auto?.value).toBe('1');
    expect(Math.abs(auto!.expires - Date.now() / 1000 - 86_400)).toBeLessThan(300);
    // Playwright chờ lượt chuyển đang treo xong mới đọc lại DOM, nên ca "bấm Ở lại sau khi đã gửi lượt chuyển" kiểm ở mini-app-auto-open.spec.tsx.
    release();
    await expect.poll(() => page.url(), { timeout: 15_000 }).toMatch(DEEP_LINK_RE);
  });

  test('lớp phủ không biến mất đột ngột: giây 4,5 mờ dần 300ms (data-leaving, không chặn chạm) rồi mới nhường chỗ cho dải mời (W44 U1)', async ({ page, api }) => {
    mockPage(api, true);
    await page.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, 'webdriver', { configurable: true, get: () => false });
      // Pha mờ chỉ 300ms, ngắn hơn nhịp dò của expect: ghi lại bằng MutationObserver ngay lúc lớp phủ đổi trạng thái.
      type Leaving = { at: number; duration: string; property: string; pointer: string; hidden: string | null; stayDisabled: boolean | null; bar: boolean; mid?: number; goneAt?: number };
      const w = window as unknown as { __leaving?: Leaving };
      new MutationObserver(() => {
        const el = document.querySelector<HTMLElement>('[data-testid="miniapp-opening"]');
        if (el && el.hasAttribute('data-leaving') && !w.__leaving) {
          const cs = getComputedStyle(el);
          const rec: Leaving = {
            at: performance.now(),
            duration: cs.transitionDuration,
            property: cs.transitionProperty,
            pointer: cs.pointerEvents,
            hidden: el.getAttribute('aria-hidden'),
            stayDisabled: el.querySelector('button')?.disabled ?? null,
            bar: !!document.querySelector('[data-testid="miniapp-smartbar"]'),
          };
          w.__leaving = rec;
          setTimeout(() => {
            const now = document.querySelector('[data-testid="miniapp-opening"]');
            if (now) rec.mid = Number(getComputedStyle(now).opacity);
          }, 150);
        }
        if (w.__leaving && !el && w.__leaving.goneAt === undefined) w.__leaving.goneAt = performance.now();
      }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-leaving'] });
    });
    // Huỷ lượt sang zalo.me như khi máy chưa cài Zalo hay khách bấm Huỷ ở hộp "Mở bằng Zalo?": trang hiện tại ở lại tới giây 4,5.
    await page.route('https://zalo.me/**', (route) => route.abort('aborted'));
    await page.goto(PAGE);
    const overlay = page.getByTestId('miniapp-opening');
    await expect(overlay).toBeVisible({ timeout: 15_000 });
    expect(await overlay.getAttribute('data-leaving')).toBeNull();
    await expect(overlay).toHaveCount(0, { timeout: 10_000 });
    await expect(bar(page)).toBeVisible();
    const rec = await page.evaluate(() => (window as unknown as { __leaving?: Record<string, unknown> }).__leaving ?? null);
    expect(rec, 'lớp phủ phải qua pha data-leaving trước khi rời đi').not.toBeNull();
    expect({ duration: rec!.duration, property: rec!.property, pointer: rec!.pointer, hidden: rec!.hidden, stayDisabled: rec!.stayDisabled, bar: rec!.bar }).toEqual({
      duration: '0.3s',
      property: 'opacity',
      pointer: 'none',
      hidden: 'true',
      stayDisabled: true,
      // Dải đã vẽ bên dưới lớp phủ đang mờ: lúc lớp phủ đi hẳn, trang không nhảy thêm lần nữa.
      bar: true,
    });
    expect(rec!.mid as number, 'giữa pha mờ, lớp phủ trong suốt một phần').toBeGreaterThan(0);
    expect(rec!.mid as number).toBeLessThan(1);
    const stayed = (rec!.goneAt as number) - (rec!.at as number);
    expect(stayed, `lớp phủ còn ${stayed}ms sau khi bắt đầu mờ`).toBeGreaterThanOrEqual(250);
    expect(stayed).toBeLessThan(1500);
  });

  test('ảnh: lớp phủ đang mờ, dải mời đã nằm bên dưới (đặt MINIAPP_AUTO_SHOTS_DIR)', async ({ page, api }) => {
    test.skip(!SHOTS, 'chỉ chụp ảnh khi có MINIAPP_AUTO_SHOTS_DIR');
    mockPage(api, true);
    await page.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, 'webdriver', { configurable: true, get: () => false });
    });
    await page.route('https://zalo.me/**', (route) => route.abort('aborted'));
    // Đồng hồ giả dừng lại trong pha mờ (hẹn giờ 300ms không chạy), và kéo dài hiệu ứng để chụp được giữa chừng.
    await page.clock.install();
    await page.goto(PAGE);
    const overlay = page.getByTestId('miniapp-opening');
    await expect(overlay).toBeVisible({ timeout: 15_000 });
    await page.clock.pauseAt(Date.now());
    await page.addStyleTag({ content: '.tubu-miniapp-opening { transition-duration: 4s !important; }' });
    await page.clock.runFor(4400);
    for (let i = 0; i < 20 && (await overlay.getAttribute('data-leaving')) === null; i++) await page.clock.runFor(50);
    await expect(overlay).toHaveAttribute('data-leaving', '');
    await page.waitForTimeout(1200);
    mkdirSync(SHOTS!, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/web375-miniapp-leaving.png` });
    await expect(bar(page)).toHaveCount(1);
  });
});

test.describe('Web điện thoại: chỗ giữ dải mời không đẩy trang (W44 U4)', () => {
  async function expectNoShift(page: Page, api: MockApi, baseURL: string | undefined, path: string, shot: string) {
    mockPage(api, true);
    await page.context().addCookies([{ name: 'tubu_mini_auto', value: '1', url: baseURL! }]);
    await watchLayout(page);
    await page.goto(path);
    await expect(bar(page)).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(1500);
    const m = await layoutNow(page);
    expect(m.reservedAtDcl, 'boot script giữ chỗ trước lần vẽ đầu').toBe(true);
    expect(m.topAtDcl).not.toBeNull();
    expect(Math.abs(m.top! - m.topAtDcl!), `đỉnh nội dung lúc tải ${m.topAtDcl} so lúc có dải ${m.top}`).toBeLessThanOrEqual(1);
    expect(m.cls, 'tổng layout-shift').toBeLessThan(0.01);
    if (SHOTS) {
      mkdirSync(SHOTS, { recursive: true });
      await page.screenshot({ path: `${SHOTS}/${shot}` });
    }
  }

  test('Trang chủ: khách đã từng được tự mở (cookie tubu_mini_auto) thấy dải ngay chỗ đã giữ, CLS < 0,01', async ({ page, api, baseURL }) => {
    await expectNoShift(page, api, baseURL, '/', 'web375-miniapp-slot-home.png');
  });

  test('Trang sản phẩm tràn viền: dải cạnh nút lùi nổi ở chỗ đã giữ, CLS < 0,01', async ({ page, api, baseURL, request }) => {
    const p = await firstProduct(request);
    test.skip(!p, 'DB e2e chưa có sản phẩm');
    await expectNoShift(page, api, baseURL, `/san-pham/${p!.slug}`, 'web375-miniapp-slot-pdp.png');
  });

  test('cookie tubu_stay_web: boot script không giữ chỗ, không có khoảng trống', async ({ page, api, baseURL }) => {
    mockPage(api, true);
    await page.context().addCookies([
      { name: 'tubu_mini_auto', value: '1', url: baseURL! },
      { name: 'tubu_stay_web', value: '1', url: baseURL! },
    ]);
    await watchLayout(page);
    await page.goto(PAGE);
    await expect(page.locator('main').first()).toBeVisible();
    await page.waitForTimeout(2500);
    const m = await layoutNow(page);
    expect(m.reservedAtDcl).toBe(false);
    await expect(bar(page)).toHaveCount(0);
    expect(await page.locator('.tubu-miniapp-slot').evaluate((el) => el.getBoundingClientRect().height)).toBe(0);
  });
});

test.describe('Web điện thoại: chữ phụ dải mời không bị cắt (W44 U6)', () => {
  for (const width of [360, 375]) {
    test(`${width}px: "Mua nhanh & tích điểm" hiện đủ`, async ({ page, api }) => {
      mockPage(api, true);
      await page.setViewportSize({ width, height: 800 });
      await page.goto(PAGE);
      await expect(bar(page)).toBeVisible({ timeout: 15_000 });
      const sub = bar(page).locator('.tubu-miniapp-bar__sub');
      await expect(sub).toHaveText('Mua nhanh & tích điểm');
      const fit = await sub.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
      expect(fit.scroll, `scrollWidth ${fit.scroll} > clientWidth ${fit.client}`).toBeLessThanOrEqual(fit.client);
      const title = await bar(page).locator('.tubu-miniapp-bar__title').evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
      expect(title.scroll, `tiêu đề: scrollWidth ${title.scroll} > clientWidth ${title.client}`).toBeLessThanOrEqual(title.client);
      // Mỗi dòng chữ một dòng: dải cao đúng 54px như chỗ đã giữ.
      const h = (await bar(page).boundingBox())!.height;
      expect(Math.abs(h - 54), `dải cao ${h}px`).toBeLessThanOrEqual(0.5);
      if (SHOTS) {
        mkdirSync(SHOTS, { recursive: true });
        await bar(page).screenshot({ path: `${SHOTS}/web${width}-miniapp-bar.png` });
      }
    });
  }
});
