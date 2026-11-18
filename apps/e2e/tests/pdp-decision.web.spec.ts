import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import type { APIRequestContext, Page } from '@playwright/test';
import { checkoutEtaLabel } from '../../../packages/app-core/src/shipping-eta';
import { expect, test, type MockApi } from './support/mock-api';
import { observeCls, readClsTotal } from './support/cls-observer';

/**
 * Trang sản phẩm web (tubu-w4-02) ở 360/390/768/1440. Phần server của Next đọc cờ từ DB e2e thật, nên spec chạy hai lượt:
 * PDP_DECISION_DB=off (seed mặc định, cờ tắt) ghi số đo "trước"; PDP_DECISION_DB=on (DB đã bật hai cờ và eta 2–4 ngày) kiểm các dòng mới,
 * so khối Vận chuyển (≤ +24px ở 360) và cột mua (≤ +56px ở 1440) với số đo lượt tắt, CLS không tăng. Mọi lời gọi từ trình duyệt đi qua mock.
 */
const MODE = process.env.PDP_DECISION_DB === 'on' ? 'on' : 'off';
const SHOTS = process.env.PDP_DECISION_SHOTS;
const METRICS = SHOTS ? `${SHOTS}/web-metrics-off.json` : null;
const ETA = { minDays: 2, maxDays: 4 };
const API_ORIGIN = `http://localhost:${process.env.E2E_API_PORT}`;
const MULTI = 'dau-goi-buoi-po-lang';
const SINGLE = 'sua-tam-sa-po-lang';

type Detail = { slug: string; variations: { id: string; stock: number }[] };
type Metrics = Record<string, { ship: number; column: number; cls: number }>;

async function detail(request: APIRequestContext, slug: string): Promise<Detail | null> {
  const r = await request.get(`${API_ORIGIN}/api/products/${slug}`).catch(() => null);
  return r?.ok() ? ((await r.json()) as Detail) : null;
}

async function openPdp(page: Page, api: MockApi, p: Detail, stock?: (i: number) => number): Promise<void> {
  api.get('/flash-sales/active', []);
  api.get('/config/public', { freeshipThreshold: 199_000, subscribeDiscountPct: 0.12, shippingEta: MODE === 'on' ? ETA : null, unitPriceEnabled: MODE === 'on', pdpEtaEnabled: MODE === 'on' });
  api.get(`/products/${p.slug}`, { variations: p.variations.map((v, i) => ({ ...v, stock: stock ? stock(i) : v.stock })) });
  api.get(`/products/${p.slug}/related`, []);
  api.get(`/products/${p.slug}/bought-together`, []);
  api.get('/products/for-you', []);
  api.get('/products', { data: [], meta: { page: 1, limit: 12, total: 0 } });
  api.get(`/products/${p.slug}/reviews`, { average: 0, count: 0, videoCount: 0, distribution: {}, items: [] });
  api.get('/me/wishlist/ids', []);
  await page.goto(`/san-pham/${p.slug}`);
  await expect(page.locator('[data-pdp-block="shipping"]')).toBeVisible();
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
  await page.waitForTimeout(400);
}

const box = async (page: Page, sel: string) => (await page.locator(sel).first().boundingBox())!;
/** Từ đầu khối giá tới hết khối Vận chuyển: mọi dòng mới nằm trong đoạn này (cột mua bên phải ở 1440). */
async function columnHeight(page: Page): Promise<number> {
  const top = await box(page, '[data-pdp-block="main"]');
  const ship = await box(page, '[data-pdp-block="shipping"]');
  return Math.round(ship.y + ship.height - top.y);
}
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

async function shoot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${SHOTS}/${name}-top.png` });
  await page.locator('[data-pdp-block="shipping"]').scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${SHOTS}/${name}-ship.png` });
}

test.describe(`Web khách: trang sản phẩm giúp chốt nhanh (DB cờ ${MODE})`, () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'Web Customer', 'mỗi khổ màn tự đặt viewport, chạy một project là đủ');
  });

  for (const width of [360, 390, 768, 1440]) {
    test(`${width}px: nhiều phân loại`, async ({ page, api, request }) => {
      const p = await detail(request, MULTI);
      test.skip(!p, `DB e2e không có ${MULTI}`);
      await page.setViewportSize({ width, height: 900 });
      await observeCls(page);
      await openPdp(page, api, p!);
      const { cls, sources } = await readClsTotal(page);
      const m = { ship: Math.round((await box(page, '[data-pdp-block="shipping"]')).height), column: await columnHeight(page), cls };
      expect(await noHorizontalScroll(page)).toBe(true);

      if (MODE === 'off') {
        await expect(page.getByTestId('pdp-unit-price')).toHaveCount(0);
        await expect(page.getByTestId('variation-unit-price')).toHaveCount(0);
        await expect(page.getByTestId('pdp-eta')).toHaveCount(0);
        await expect(page.getByTestId('pdp-freeship-gap')).toHaveCount(0);
        await expect(page.getByTestId('pdp-freeship')).toHaveText('Miễn phí giao hàng cho đơn từ 199.000đ');
        if (METRICS) {
          const all: Metrics = existsSync(METRICS) ? JSON.parse(readFileSync(METRICS, 'utf8')) : {};
          all[String(width)] = m;
          writeFileSync(METRICS, JSON.stringify(all, null, 2));
        }
        await shoot(page, `web-${width}-before`);
        return;
      }

      await expect(page.getByTestId('pdp-unit-price')).toHaveText('≈ 55.000đ / 100ml');
      await expect(page.locator('[data-pdp-block="variations"]').getByTestId('variation-unit-price')).toHaveText(['≈ 55.000đ / 100ml', '≈ 43.800đ / 100ml · Lợi hơn 20% mỗi 100ml']);
      await expect(page.getByText(/Lợi hơn/)).toHaveCount(1);
      await expect(page.getByTestId('pdp-eta')).toHaveText(`Nhận dự kiến ${checkoutEtaLabel(ETA, ['TUBU'])}`);
      await expect(page.getByTestId('pdp-freeship-gap')).toHaveText('Món này + 34.000đ là miễn phí giao');
      await expect(page.getByTestId('pdp-freeship')).toHaveCount(0);
      const before = METRICS && existsSync(METRICS) ? (JSON.parse(readFileSync(METRICS, 'utf8')) as Metrics)[String(width)] : undefined;
      test.info().annotations.push({ type: 'đo', description: `${width}: ship ${before?.ship}→${m.ship}, cột ${before?.column}→${m.column}, CLS ${before?.cls.toFixed(4)}→${cls.toFixed(4)}` });
      if (SHOTS) writeFileSync(`${SHOTS}/web-metrics-on-${width}.json`, JSON.stringify({ before, after: m }));
      if (before) {
        if (width === 360) expect(m.ship - before.ship, `khối Vận chuyển ${before.ship} → ${m.ship}`).toBeLessThanOrEqual(24);
        if (width === 1440) expect(m.column - before.column, `cột mua ${before.column} → ${m.column}`).toBeLessThanOrEqual(56);
        expect(cls, `CLS ${before.cls} → ${cls}: ${sources.join(' ; ')}`).toBeLessThanOrEqual(before.cls + 0.001);
      }
      await shoot(page, `web-${width}-after`);
    });
  }

  test('390px: một phân loại có dòng dưới giá, không chip', async ({ page, api, request }) => {
    const p = await detail(request, SINGLE);
    test.skip(!p || MODE === 'off', 'chỉ lượt cờ bật');
    await page.setViewportSize({ width: 390, height: 900 });
    await openPdp(page, api, p!);
    await expect(page.getByTestId('pdp-unit-price')).toHaveText('≈ 35.000đ / 100ml');
    await expect(page.getByTestId('variation-unit-price')).toHaveCount(0);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/web-390-after-single.png` });
  });

  test('390px: hết hàng thì không hứa ngày, giữ câu miễn phí giao tĩnh', async ({ page, api, request }) => {
    const p = await detail(request, MULTI);
    test.skip(!p || MODE === 'off', 'chỉ lượt cờ bật');
    await page.setViewportSize({ width: 390, height: 900 });
    await openPdp(page, api, p!, () => 0);
    await expect(page.getByTestId('pdp-eta')).toHaveCount(0);
    await expect(page.getByTestId('pdp-freeship-gap')).toHaveCount(0);
    await expect(page.getByTestId('pdp-freeship')).toHaveText('Miễn phí giao hàng cho đơn từ 199.000đ');
    await expect(page.getByTestId('variation-unit-price')).toHaveCount(0);
    if (SHOTS) {
      await page.locator('[data-pdp-block="shipping"]').scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${SHOTS}/web-390-after-oos.png` });
    }
  });
});
