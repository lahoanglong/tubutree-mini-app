import type { Page } from '@playwright/test';
import { expect, test, mockSession, publicConfig, type MockApi } from './support/mock-api';
import { observeCls, readClsTotal } from './support/cls-observer';
import { mockTourWorld, productCard, seedCatalog, swatch, tourUser } from './support/tour-world';

/**
 * Đợt tốc độ trên máy khách, phía Mini App:
 * - Dải Story nằm trong chunk phần dưới Trang chủ (entry nhẹ hơn): trong lúc chunk chưa về, khối giữ đúng 144px bằng ô chờ, chunk về thì dải thật
 *   thay vào mà khối không đổi cao (không nhảy trang), ở 360×640 và 390×844.
 * - Cờ `perf.rum_enabled` tắt (mặc định): ẩn app không gửi sự kiện `mini_vital` nào. Bật với 100% mẫu: gửi một gói `mini_vital` qua hàng đợi sự kiện
 *   sẵn có, đúng route mẫu và nhóm khung nhìn.
 * Dự án Mini chạy WebKit (không có 'layout-shift'), nên ép Chromium để đo CLS và LCP thật.
 */
test.use({ browserName: 'chromium' });

/** `HOME_SETTLING_HEIGHTS.stories` ở app-core: chiều cao giữ chỗ của dải Story. */
const STORIES_HEIGHT = 144;
const CHUNK_DELAY_MS = 1500;
const SIZES = [
  { width: 360, height: 640 },
  { width: 390, height: 844 },
] as const;
const SHOTS = '/tmp/review/tubu/shots/waves/tubu-w4-05-real-user-vitals-and-speed-budget';

interface QueuedEvent {
  eventName: string;
  props?: Record<string, unknown>;
}

const sentEvents = (api: MockApi): QueuedEvent[] =>
  api.callsTo('POST', '/events').flatMap((c) => (c.body as { events?: QueuedEvent[] } | undefined)?.events ?? []);
const vitalEvents = (api: MockApi) => sentEvents(api).filter((e) => e.eventName === 'mini_vital');

/** Ẩn app như khi khách vuốt ra màn hình chính của Zalo: trình duyệt test không tự ẩn trang, nên giả `visibilityState` rồi phát sự kiện. */
async function hideApp(page: Page) {
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

function setup(api: MockApi, perfRum?: { enabled: boolean; samplePct: number }) {
  const user = tourUser('CUSTOMER');
  mockSession(api, user);
  mockTourWorld(api, user);
  if (perfRum) api.get('/config/public', { ...publicConfig({ aiAdvisorEnabled: true, freeshipThreshold: 500_000 }), perfRum });
  api.get('/orders/home-todo', { pending: null, shipping: null, processing: null });
  api.post('/events', { accepted: 1 });
  api.allowUnmocked('GET /auth/me', 'GET /waste/requests');
}

/** Dải Story chỉ hiện khi Bán chạy nhất có ≥ 3 món có ảnh; thế giới mock mặc định không có ảnh nên dải trả rỗng. Ca này cho mọi thẻ một ảnh. */
function withPhotos(api: MockApi) {
  api.get('/products', ({ call }) => {
    const page = Number(call.query.get('page') ?? 1);
    const limit = Number(call.query.get('limit') ?? 20);
    const rows = seedCatalog();
    return {
      data: rows.slice((page - 1) * limit, page * limit).map((p, i) => ({ ...productCard(p), thumbnail: swatch(p.name, 90 + i * 17) })),
      meta: { page, limit, total: rows.length },
    };
  });
}

async function storiesBox(page: Page) {
  return page.locator('[data-home-block="stories"]').evaluate((el) => Math.round(el.getBoundingClientRect().height));
}

for (const size of SIZES) {
  test(`Mini ${size.width}×${size.height}: dải Story giữ 144px bằng ô chờ khi chunk phần dưới chưa về, dải thật thay vào không nhảy`, async ({ page, api }) => {
    setup(api);
    withPhotos(api);
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    // Vite dev phục vụ từng module riêng: giữ module phần dưới Trang chủ để thấy ô chờ, rồi thả.
    await page.route(/\/src\/components\/home\/home-below\.tsx/, async (route) => {
      await Promise.race([held, new Promise((r) => setTimeout(r, CHUNK_DELAY_MS * 4))]);
      await route.continue();
    });
    await observeCls(page);
    await page.setViewportSize(size);
    await page.goto('/');

    const wait = page.locator('[data-home-block="stories"] [data-testid="home-stories-wait"]');
    await expect(wait).toBeAttached({ timeout: 15_000 });
    expect(await storiesBox(page), 'khối Story lúc chờ chunk').toBe(STORIES_HEIGHT);
    await page.screenshot({ path: `${SHOTS}/mini-home-wait-${size.width}x${size.height}.png` });

    release();
    await expect(wait).toHaveCount(0, { timeout: 15_000 });
    await expect(page.locator('[data-home-block="stories"] [data-testid="story-reel-strip"]')).toBeVisible({ timeout: 15_000 });
    expect(await storiesBox(page), 'khối Story sau khi dải thật về').toBe(STORIES_HEIGHT);

    await page.waitForTimeout(600);
    await page.screenshot({ path: `${SHOTS}/mini-home-${size.width}x${size.height}.png` });
    const cls = await readClsTotal(page);
    const overflowX = await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth));
    console.log(`VITALS_MINI_STORY ${size.width}x${size.height} cls=${cls.cls.toFixed(4)} overflowX=${overflowX}`);
    expect(overflowX, 'tràn ngang').toBe(0);
    expect(cls.cls, `CLS ${cls.sources.join(' ; ')}`).toBeLessThanOrEqual(0.1);
  });
}

test('Mini: cờ perf.rum_enabled tắt thì ẩn app không gửi mini_vital nào (vẫn xả các sự kiện khác như cũ)', async ({ page, api }) => {
  setup(api);
  await page.setViewportSize(SIZES[1]);
  await page.goto('/');
  await expect(page.locator('[data-home-block] [data-ds="product-tile"]').first()).toBeVisible({ timeout: 15_000 });
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
  await hideApp(page);
  await expect.poll(() => sentEvents(api).length, { timeout: 15_000 }).toBeGreaterThan(0);
  await page.waitForTimeout(1000);
  expect(vitalEvents(api)).toEqual([]);
});

test('Mini: cờ bật, mẫu 100% thì ẩn app gửi một gói mini_vital (có READY) với route mẫu "/" và khung nhìn "s"', async ({ page, api }) => {
  setup(api, { enabled: true, samplePct: 100 });
  await page.setViewportSize(SIZES[0]);
  await page.goto('/');
  await expect(page.locator('[data-home-block] [data-ds="product-tile"]').first()).toBeVisible({ timeout: 15_000 });
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
  // READY là lần rảnh đầu tiên sau `load`: chờ nó chốt rồi mới ẩn app.
  await page.waitForTimeout(800);
  await hideApp(page);
  // Sự kiện đo xếp hàng sau lượt xả lúc ẩn thì đi ở lượt xả định kỳ 10 giây kế tiếp.
  await expect.poll(() => vitalEvents(api).length, { timeout: 20_000 }).toBeGreaterThan(0);
  const vitals = vitalEvents(api);
  const names = vitals.map((e) => e.props?.name);
  expect(new Set(names).size, 'mỗi chỉ số một lần').toBe(names.length);
  expect(names).toContain('READY');
  for (const e of vitals) {
    expect(['LCP', 'CLS', 'READY']).toContain(e.props?.name);
    expect(typeof e.props?.value).toBe('number');
    expect(['good', 'needs-improvement', 'poor']).toContain(e.props?.rating);
    expect(e.props?.route).toBe('/');
    expect(e.props?.vp).toBe('s');
  }
  await hideApp(page);
  await page.waitForTimeout(1000);
  expect(vitalEvents(api).length, 'ẩn lần nữa không gửi thêm gói').toBe(vitals.length);
});
