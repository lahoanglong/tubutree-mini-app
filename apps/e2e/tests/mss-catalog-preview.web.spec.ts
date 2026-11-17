import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { adminShellDefaults, expect, test, type MockApi } from './support/mock-api';
import { solidPng } from './support/noise-png';

/**
 * Nội dung sản phẩm từ MSS trên web (wave tubu-mss-catalog-enrichment) ở 360px: trang sản phẩm đã ghép nội dung MSS, trang xem trước
 * `/san-pham/_preview` (băng, nút mua tắt, noindex, frame-ancestors chỉ ở đường xem trước), token hết hạn, nhúng iframe, thẻ Ops "Nội dung từ MSS".
 *
 * Phần dựng phía máy chủ của Next gọi API từ máy chủ nên mock trình duyệt không chặn được: ca (1), (2), (4), (5) cần API giả
 * `scripts/mss-preview-fixture-api.mjs` (cách chạy ở đầu file đó) và tự bỏ qua khi API đang chạy không phải API giả; ca (4) còn cần
 * bản build có MSS_PREVIEW_FRAME_ANCESTORS=https://mss.e2e.test. Ca (3) chạy được với API thật (token lạ → 404 preview_expired).
 */
interface Fixture {
  slug: string;
  tokens: { ok: string; expired: string; down: string; missing: string };
  mediaHost: string;
  product: { name: string; brand: string; images: string[]; videos: string[] };
}

const fixture = JSON.parse(readFileSync(path.resolve(__dirname, 'support/mss-catalog-fixture.json'), 'utf8')) as Fixture;
const SHOTS = '/tmp/review/tubu/shots/waves/tubu-mss-catalog-enrichment';
const MSS_ORIGIN = 'https://mss.e2e.test';
const PNG = solidPng(120, 120, [196, 214, 176]);

const previewUrl = (token: string, frame?: 'miniapp' | 'web') => `/san-pham/_preview?token=${token}${frame ? `&frame=${frame}` : ''}`;
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const pwned = (page: Page) => page.evaluate(() => (window as unknown as { __pwned?: string }).__pwned);

async function shot(page: Page, name: string): Promise<void> {
  mkdirSync(SHOTS, { recursive: true });
  await page.evaluate(() => document.fonts.ready.then(() => undefined)).catch(() => {});
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

async function serveMedia(page: Page): Promise<void> {
  await page.route(`https://${fixture.mediaHost}/**`, (route) =>
    route.request().url().endsWith('.jpg') ? route.fulfill({ status: 200, contentType: 'image/png', body: PNG }) : route.fulfill({ status: 404, body: '' }),
  );
}

/** Lời gọi trình duyệt của trang sản phẩm cho khách chưa đăng nhập: khối phụ rỗng, không làm đổi bố cục khối chính. */
function mockPdpBrowser(api: MockApi): void {
  api.get(`/products/${fixture.slug}`, { variations: [{ id: 'v-mss-e2e-500', sku: 'NRC-500', name: 'Chai 500ml', retailPrice: 89000, salePrice: null, stock: 12 }] });
  api.get(`/products/${fixture.slug}/related`, []);
  api.get(`/products/${fixture.slug}/bought-together`, []);
  api.get('/products/for-you', []);
  api.get(`/products/${fixture.slug}/reviews`, { average: 0, count: 0, videoCount: 0, distribution: {}, items: [] });
  api.allowUnmocked('POST /events', 'POST /events/web', 'GET /products/:slug/stock', 'GET /products/:slug/reviews/can-review', 'GET /affiliate/me', 'GET /cart');
}

/** Ca (1), (2), (4), (5) chỉ có nghĩa khi máy chủ Next đang đọc API giả: token mẫu `ok` ra đúng sản phẩm mẫu. */
async function requireFixtureApi(page: Page): Promise<void> {
  const res = await page.request.get(previewUrl(fixture.tokens.ok));
  const html = await res.text();
  test.skip(!html.includes(fixture.product.name), 'Next không đọc API giả mss-preview-fixture-api.mjs (xem đầu file spec)');
}

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'Web Customer', 'tự đặt khổ 360px, chỉ chạy ở một project');
  await page.setViewportSize({ width: 360, height: 780 });
  await serveMedia(page);
});

test('(1) trang sản phẩm đã ghép nội dung MSS: 5 ảnh https + 1 video, mô tả HTML lọc sạch không chạy mã, không tràn ngang ở 360px', async ({ page, api }) => {
  await requireFixtureApi(page);
  mockPdpBrowser(api);
  const res = await page.goto(`/san-pham/${fixture.slug}`);
  expect(res!.status()).toBe(200);
  await expect(page.locator('[data-pdp-block="main"]')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('h1')).toHaveText(fixture.product.name);

  const slides = page.locator('[aria-roledescription="slide"]');
  await expect(slides).toHaveCount(6);
  expect(await slides.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))).toEqual([
    'Ảnh 1 trên 6',
    'Ảnh 2 trên 6',
    'Ảnh 3 trên 6',
    'Ảnh 4 trên 6',
    'Ảnh 5 trên 6',
    'Video 6 trên 6',
  ]);
  const imgSrcs = await page.locator('[aria-roledescription="slide"] img').evaluateAll((els) => els.map((e) => (e as HTMLImageElement).src));
  for (const src of fixture.product.images) expect(imgSrcs).toContain(src);
  expect(await page.locator('[aria-roledescription="slide"] video').count()).toBe(1);

  const desc = page.locator('[data-pdp-block="description"]');
  await expect(desc.locator('strong').first()).toHaveText('bồ kết và vỏ bưởi');
  await expect(desc.locator('li')).toHaveCount(3);
  expect(await desc.locator('script, img, [onerror], a[href^="javascript"]').count()).toBe(0);
  const text = (await desc.textContent()) ?? '';
  expect(text).toContain('Rửa với nước ấm cho sạch nhanh.');
  expect(text).not.toMatch(/<\/?(p|ul|li|strong|script|img|a)\b|onerror|javascript:|__pwned/i);
  expect(await pwned(page)).toBeUndefined();

  expect(res!.headers()['x-frame-options']).toBe('DENY');
  expect(res!.headers()['content-security-policy']).toBeUndefined();
  expect(await noHorizontalScroll(page)).toBe(true);
  await shot(page, 'pdp-mss-merged-360');
});

test('(2) xem trước frame=miniapp: băng BẢN XEM TRƯỚC, nút mua tắt, noindex, frame-ancestors chỉ ở đường xem trước, không gọi đo hay giỏ', async ({ page, api }) => {
  await requireFixtureApi(page);
  const res = await page.goto(previewUrl(fixture.tokens.ok, 'miniapp'));
  expect(res!.status()).toBe(200);
  const headers = res!.headers();
  expect(headers['content-security-policy']).toMatch(/^frame-ancestors /);
  expect(headers['x-frame-options']).toBeUndefined();
  expect(headers['cache-control']).toContain('no-store');
  expect(headers['x-robots-tag']).toBe('noindex, nofollow');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');

  const banner = page.getByTestId('preview-banner');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('BẢN XEM TRƯỚC');
  await expect(banner).toContainText('Bản 7, hết hạn lúc 08:15 01/01/2099');
  await expect(page.locator('[data-preview-frame="miniapp"]')).toBeVisible();
  await expect(page.locator('h1')).toHaveText(fixture.product.name);
  await expect(page.locator('[aria-roledescription="slide"]')).toHaveCount(6);

  const buy = page.locator('[data-testid="preview-buy"]:visible');
  await expect(buy).toHaveCount(1);
  await expect(buy).toBeDisabled();
  await buy.click({ force: true });
  expect(await page.locator('[data-testid="pdp-add-to-cart"], [data-testid="wishlist-heart"], [data-testid="share-button"]').count()).toBe(0);
  expect(await page.locator('header, footer, nav').count()).toBe(0);

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(banner).toBeInViewport();
  expect(await pwned(page)).toBeUndefined();
  expect(await noHorizontalScroll(page)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, 'preview-miniapp-360');

  const pdp = await page.request.get(`/san-pham/${fixture.slug}`);
  expect(pdp.headers()['content-security-policy']).toBeUndefined();
  expect(pdp.headers()['x-frame-options']).toBe('DENY');
  expect(api.calls.filter((c) => c.path.startsWith('/cart') || c.path.startsWith('/events'))).toEqual([]);
});

test('(3) token hết hạn: báo "Phiên xem trước đã hết hạn, mở lại từ MSS" ngay trong trang, không có nút mua', async ({ page }) => {
  const res = await page.goto(previewUrl(fixture.tokens.expired, 'miniapp'));
  expect(res!.headers()['x-robots-tag']).toBe('noindex, nofollow');
  await expect(page.getByTestId('preview-banner')).toBeVisible();
  await expect(page.locator('[data-problem="expired"] [data-testid="error-message"]')).toHaveText('Phiên xem trước đã hết hạn, mở lại từ MSS');
  expect(await page.locator('[data-testid="preview-buy"]').count()).toBe(0);
  expect(await noHorizontalScroll(page)).toBe(true);
  await shot(page, 'preview-expired-360');
});

test('(4) nhúng iframe: origin MSS được phép nhúng xem trước; origin khác bị frame-ancestors chặn; trang sản phẩm bị X-Frame-Options chặn', async ({ page }, testInfo) => {
  await requireFixtureApi(page);
  const csp = (await page.request.get(previewUrl(fixture.tokens.ok))).headers()['content-security-policy'] ?? '';
  test.skip(!csp.split(/\s+/).includes(MSS_ORIGIN), `bản build không cho ${MSS_ORIGIN} nhúng (MSS_PREVIEW_FRAME_ANCESTORS)`);
  // Trang https giả nhúng thẳng http://localhost thì Chrome chặn ở tầng mạng (nội dung trộn, truy cập mạng riêng) trước khi đọc header.
  // Nên web được phục vụ lại dưới một origin https giả: route.fetch lấy phản hồi thật của Next (giữ nguyên header) rồi trả cho khung.
  const base = String(testInfo.project.use.baseURL);
  const TUBU = 'https://tubu.e2e.test';
  await page.route(`${TUBU}/**`, async (route) => {
    const u = new URL(route.request().url());
    await route.fulfill({ response: await route.fetch({ url: `${base}${u.pathname}${u.search}` }) });
  });
  test.setTimeout(60_000);
  const framing: string[] = [];
  page.on('console', (m) => {
    if (/X-Frame-Options|frame-ancestors/.test(m.text())) framing.push(m.text());
  });
  const enforcedAncestorsBlock = () => framing.some((t) => !/report-only|\[Report Only\]/i.test(t) && t.includes(`frame-ancestors ${MSS_ORIGIN}`));
  const host = (origin: string, frames: Record<string, string>) =>
    page.route(`${origin}/embed`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: `<!doctype html><body>${Object.entries(frames)
          .map(([id, src]) => `<iframe id="${id}" src="${TUBU}${src}" width="360" height="640"></iframe>`)
          .join('')}</body>`,
      }),
    );
  await host(MSS_ORIGIN, { ok: previewUrl(fixture.tokens.ok, 'miniapp'), pdp: `/san-pham/${fixture.slug}` });
  await host('https://other.e2e.test', { deny: previewUrl(fixture.tokens.ok, 'miniapp') });

  await page.goto(`${MSS_ORIGIN}/embed`);
  await expect(page.frameLocator('#ok').getByTestId('preview-banner')).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => framing.some((t) => /X-Frame-Options/.test(t) && /deny/i.test(t)), { timeout: 10_000 }).toBe(true);
  expect(await page.frameLocator('#pdp').locator('h1').count()).toBe(0);
  expect(enforcedAncestorsBlock()).toBe(false);

  const onMssPage = framing.splice(0);
  await page.goto('https://other.e2e.test/embed');
  await expect.poll(enforcedAncestorsBlock, { timeout: 10_000 }).toBe(true);
  expect(await page.frameLocator('#deny').getByTestId('preview-banner').count()).toBe(0);
  mkdirSync(SHOTS, { recursive: true });
  writeFileSync(`${SHOTS}/iframe-framing-console.txt`, [`# ${MSS_ORIGIN} nhúng xem trước + trang sản phẩm`, ...onMssPage, '# https://other.e2e.test nhúng xem trước', ...framing].join('\n'));
});

test('(5) thẻ Ops "Nội dung từ MSS" ở 360px: số đếm, lần kéo gần nhất, lý do bằng tiếng Việt, không tràn ngang', async ({ page, api }) => {
  await requireFixtureApi(page);
  const admin = { id: 'u-admin', fullName: 'Quản trị E2E', referralCode: 'ADM', phone: '0900000000', role: 'ADMIN', pointsBalance: 0, pointsConvertedBalance: 0, walletBalance: 0 };
  api.post('/auth/refresh', () => ({ accessToken: 'e2e-token', refreshToken: 'e2e-refresh', user: admin }));
  api.get('/me', admin);
  adminShellDefaults(api);
  api.get('/admin/mss/catalog', {
    enabled: true,
    effective: true,
    lastRunAt: '2026-11-17T02:30:00.000Z',
    lastFinishedAt: '2026-11-17T02:31:00.000Z',
    lastFullAt: '2026-11-16T19:40:00.000Z',
    watermark: '2026-11-17T02:29:00.000Z',
    lastStatus: 'partial',
    lastTrigger: 'cron',
    lastError: 'GET catalog/products trang 3: timeout_after_10000ms_without_any_response_from_mss_host',
    lastStats: {
      kind: 'incremental',
      pages: 3,
      received: 120,
      applied: 40,
      unchanged: 70,
      skipped: { unknown_product: 6, stale_version: 2 },
      trimmed: { media_rejected: 3, html_emptied: 1 },
    },
    published: 111,
    unpublished: 2,
    removed: 1,
    pending: 4,
  });
  api.get('/admin/ops/health', {
    generatedAt: '2026-11-17T03:00:00.000Z',
    thresholds: { unsyncedMinutes: 30, stuckOrders: 5, webhookFailed: 5, queueFailed1h: 5, repeatHours: 6, gomdonBacklogMinutes: 60 },
    pancake: {
      configured: true,
      lastPushOkAt: null,
      lastWebhookAt: null,
      lastWebhookProcessedAt: null,
      webhookFailed24h: 0,
      webhookFailedOpen: 0,
      webhookStuck: 0,
      failedEvents: [],
      unsynced: 0,
      stuck: 0,
      stuckOrders: [],
      attention: 0,
      attentionOrders: [],
      catalog: { lastOkAt: null, lastErrorAt: null, lastError: null, detail: null },
    },
    gomdon: {
      configured: false,
      connection: null,
      credentialsRejected: false,
      lastWebhookAt: null,
      webhookFailed24h: 0,
      webhookFailedOpen: 0,
      failedEvents: [],
      openAlerts: 0,
      alerts: [],
      attention: 0,
      backlog: 0,
      backlogOrders: [],
    },
    queues: { ok: true, items: [] },
    cronJobs: [],
    problems: [],
  });
  api.allowUnmocked('GET /admin/mss/order-events', 'GET /admin/customer-refunds');
  await page.addInitScript(() => {
    try {
      localStorage.setItem('tubu_web_session', '1');
    } catch {
      // không có localStorage: thẻ không mở được, ca sẽ đỏ ở bước tìm thẻ
    }
  });
  await page.goto('/admin?tab=opsHealth');
  const card = page.getByRole('region', { name: 'Nội dung từ MSS' });
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(card).toContainText('Đang chạy');
  await expect(card.getByTestId('mss-catalog-last-run')).toContainText('Nhận 120, ghép 40, không đổi 70 (theo mốc, 3 trang)');
  await expect(card.locator('ul[aria-label="Bị bỏ qua ở lần kéo gần nhất"] > li')).toHaveCount(2);
  await expect(card).not.toContainText('unknown_product');
  await card.scrollIntoViewIfNeeded();
  expect(await noHorizontalScroll(page)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, 'ops-mss-catalog-card-360');
});
