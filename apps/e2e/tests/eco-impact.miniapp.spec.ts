import type { Page } from '@playwright/test';
import { test, expect, type MockApi } from './support/mock-api';
import { catalogHandler, mockDiscovery, BINH_SUA, NRC } from './support/discovery-mocks';
import { mockPilotProduct, PILOT_PRODUCT, PILOT_SLUG } from './support/pilot-mocks';

/**
 * Nhãn xanh có nguồn trên Mini App (wave tubu-w2-01-eco-impact-passport-and-product-badges), 360px và 393px, API mock toàn bộ:
 * thẻ có nhãn "Can refill" không cao hơn thẻ không nhãn cùng hàng (nhãn nằm trong khe một dòng của tên); trang sản phẩm có khối "Điểm cộng
 * xanh" ngay sau khối lợi ích, nguồn ghi bằng chữ (webview Zalo chặn link ngoài), không tràn ngang; không có `ecoFacts` (cờ tắt) thì không có
 * khối. Hộ chiếu Xanh chỉ có trên web (`gaps` trong route-map.json). ECO_SHOTS=<thư mục> thì chụp ảnh.
 */
const SHOTS = process.env.ECO_SHOTS;
const SRC = 'https://www.pannature.org/bao-cao-refill';
const PDP_FACTS = [
  { kind: 'REFILL_PACK', variationId: null, valueGrams: null, baselineText: null, label: null, co2Grams: null, sourceUrl: SRC },
  { kind: 'PLASTIC_AVOIDED', variationId: null, valueGrams: 1180, baselineText: 'so với 20 chai 500ml cùng loại', label: null, co2Grams: null, sourceUrl: SRC },
];

function mockGridWithEco(api: MockApi): void {
  mockDiscovery(api);
  const base = catalogHandler();
  api.get('/products', (ctx) => {
    const res = base(ctx) as { data?: { slug: string }[] };
    if (!res || !Array.isArray(res.data)) return res;
    return { ...res, data: res.data.map((p) => (p.slug === NRC.slug ? { ...p, ecoFacts: [{ kind: 'REFILL_PACK', valueGrams: null, label: null }] } : p)) };
  });
}

function mockPdp(api: MockApi, ecoFacts: unknown[] | null): void {
  mockPilotProduct(api);
  api.get('/products/:slug', { ...PILOT_PRODUCT, shortDesc: 'Sạch dầu mỡ, dịu tay', ...(ecoFacts ? { ecoFacts } : {}) });
  api.get('/config/public', { freeshipThreshold: 200_000, returnWindowDays: 7, subscribeDiscountPct: 0.12 });
  api.allowUnmocked('POST /events', 'GET /products/:slug/compare', 'GET /products/:slug/bundles', 'GET /me/purchased-items');
}

async function openPdp(page: Page): Promise<void> {
  await page.goto(`/product/${PILOT_SLUG}`);
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 20_000 });
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
}

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

for (const vp of [
  { width: 360, height: 780 },
  { width: 393, height: 852 },
]) {
  test.describe(`Nhãn xanh Mini ${vp.width}px`, () => {
    test.use({ viewport: vp });

    test('thẻ có nhãn "Can refill" không cao hơn thẻ không nhãn cùng hàng', async ({ page, api }) => {
      mockGridWithEco(api);
      await page.goto('/browse?all=1');
      const grid = page.getByTestId('catalog-grid');
      const tileOf = (name: string) => grid.locator('[data-ds="product-tile"]').filter({ has: page.getByRole('button', { name, exact: true }) });
      const eco = tileOf(NRC.name);
      const plain = tileOf(BINH_SUA.name);
      await expect(eco).toBeVisible({ timeout: 30_000 });
      await expect(plain).toBeVisible();
      await expect(eco.getByText('Can refill', { exact: true })).toBeVisible();
      await expect(plain.getByText('Can refill', { exact: true })).toHaveCount(0);
      const box = (tile: typeof eco) =>
        tile.evaluate((el) => {
          const name = el.querySelector<HTMLElement>('[data-ds-part="body"] button[aria-label]')!.getBoundingClientRect();
          return { top: Math.round(el.getBoundingClientRect().top), nameHeight: Math.round(name.height), height: Math.round(el.getBoundingClientRect().height) };
        });
      const [a, b] = [await box(eco), await box(plain)];
      expect(a.top, 'hai thẻ cùng hàng').toBe(b.top);
      expect(Math.abs(a.nameHeight - b.nameHeight), 'khe tên không cao thêm').toBeLessThanOrEqual(1);
      expect(a.height, 'thẻ có nhãn không cao hơn').toBeLessThanOrEqual(b.height + 1);
      expect(await noHorizontalScroll(page)).toBe(true);
      if (SHOTS) await eco.screenshot({ path: `${SHOTS}/mini-${vp.width}-card-badge.png` });
    });

    test('trang sản phẩm: dòng Điểm cộng xanh nằm trong Điểm nổi bật (≤3 dòng), sau dòng lợi ích, nguồn bằng chữ, không link, không tràn ngang', async ({ page, api }) => {
      mockPdp(api, PDP_FACTS);
      await openPdp(page);
      // tubu-w47-01: khối "Điểm cộng xanh" riêng gộp vào Điểm nổi bật (trần 3 dòng chia giữa mô tả ngắn, Điểm cộng xanh và chứng nhận).
      await expect(page.getByTestId('pdp-eco')).toHaveCount(0);
      const block = page.getByTestId('pdp-highlights');
      await block.scrollIntoViewIfNeeded();
      await expect(block).toBeVisible();
      const kinds = await block.locator('li').evaluateAll((els) => els.map((e) => e.getAttribute('data-kind')));
      expect(kinds.length, `Điểm nổi bật tối đa 3 dòng: ${kinds.join(', ')}`).toBeLessThanOrEqual(3);
      const eco = block.locator('li[data-kind="eco"]');
      const n = await eco.count();
      expect(n, 'có ít nhất một dòng Điểm cộng xanh').toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(2);
      expect(kinds.lastIndexOf('benefit'), 'dòng lợi ích đứng trước dòng Điểm cộng xanh').toBeLessThan(kinds.indexOf('eco'));
      if (n === 2) await expect(eco.nth(1)).toContainText('Giảm khoảng 1,2 kg nhựa mỗi món, so với 20 chai 500ml cùng loại (ước tính)');
      await expect(eco.first().getByText('Nguồn: pannature.org')).toBeVisible();
      await expect(block.locator('a')).toHaveCount(0);
      await expect(page.getByText('Hộ chiếu Xanh')).toHaveCount(0);
      expect(await noHorizontalScroll(page)).toBe(true);
      if (SHOTS) await block.screenshot({ path: `${SHOTS}/mini-${vp.width}-pdp-eco.png` });
    });

    test('không có ecoFacts (cờ tắt hay chưa duyệt): không có khối', async ({ page, api }) => {
      mockPdp(api, null);
      await openPdp(page);
      await expect(page.getByTestId('pdp-eco')).toHaveCount(0);
      await expect(page.locator('[data-testid="pdp-highlights"] li[data-kind="eco"]')).toHaveCount(0);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/mini-${vp.width}-pdp-no-eco.png` });
    });
  });
}
