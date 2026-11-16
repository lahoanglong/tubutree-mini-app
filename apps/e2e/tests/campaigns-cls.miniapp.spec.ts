import type { Page } from '@playwright/test';
import { test, expect, type MockApi } from './support/mock-api';
import { PURCHASED_PAGE } from './support/buy-flow-mocks';
import { CATALOG, mockDiscovery } from './support/discovery-mocks';
import { campaignBanner, mockCampaigns } from './support/campaign-mocks';

/**
 * Zalo Mini App E2E — độ ổn định bố cục khi banner chiến dịch về muộn (gói P11). Dự án Mini chạy WebKit, không có PerformanceObserver 'layout-shift',
 * nên spec này ép Chromium để đo CLS thật (cùng cách với home-p6-cls). Nền là đúng kịch bản của home-p6-cls (khách cũ đã được máy nhớ, Mua lại và ô khuyến mãi
 * về muộn) để mọi khối khác đã ổn định, nên chỉ ô khuyến mãi là thứ có thể làm trang nhảy. Ô khuyến mãi (đứng trên lưới Gợi ý) chỉ có MỘT khối: Giờ vàng đang
 * chạy thì không banner; banner chỉ hiện khi truy vấn Giờ vàng đã chốt mà không có suất nào. API mock toàn bộ; không dùng waitForTimeout.
 */
test.use({ browserName: 'chromium' });

const HOUR = 3_600_000;

/** `live: false` = truy vấn Giờ vàng về muộn rồi báo không có suất nào (ô khuyến mãi mới nhường cho banner). */
function mockFlash(api: MockApi, hold: Promise<void>, live = true): void {
  api.get('/flash-sales/active', async () => {
    await hold;
    if (!live) return [];
    const now = Date.now();
    return CATALOG.slice(4, 7).map((p, i) => ({
      itemId: `fi-${p.id}`, variationId: `v-${p.id}`, productSlug: p.slug, productName: p.name, variationName: null, thumbnail: p.thumbnail,
      flashPrice: 59_000 + i * 1_000, retailPrice: p.basePrice, salePrice: p.salePrice, soldCount: 10 + i, quota: 50,
      endAt: new Date(now + 3 * HOUR).toISOString(), serverNow: new Date(now).toISOString(),
    }));
  });
}

/** Ghi từng lần nhảy kèm khối Trang chủ bị đẩy, để lúc đỏ biết khối nào chứ không chỉ một con số. */
async function trackLayoutShift(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __cls: number; __shifts: string[] };
    w.__cls = 0;
    w.__shifts = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as unknown as { hadRecentInput: boolean; value: number; sources: { node: Node | null }[] }[]) {
        if (e.hadRecentInput) continue;
        w.__cls += e.value;
        const blocks = e.sources.map((s) => (s.node instanceof Element ? s.node : s.node?.parentElement)?.closest('[data-home-block]')?.getAttribute('data-home-block') ?? '?');
        w.__shifts.push(`${e.value.toFixed(4)} ${[...new Set(blocks)].join(',')}`);
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
}

async function settledCls(page: Page): Promise<{ value: number; detail: string }> {
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  return page.evaluate(() => {
    const w = window as unknown as { __cls: number; __shifts: string[] };
    return { value: w.__cls, detail: w.__shifts.join(' | ') };
  });
}

/**
 * `banner: true` = ô khuyến mãi là banner: Giờ vàng về muộn và trống (máy không nhớ có Giờ vàng, nhớ có banner). `banner: false` = ô khuyến mãi là Giờ vàng
 * (máy nhớ có Giờ vàng), chiến dịch rỗng và không nhớ banner.
 */
async function openReturningHome(page: Page, api: MockApi, o: { banner: boolean }): Promise<() => void> {
  let release!: () => void;
  const hold = new Promise<void>((resolve) => { release = resolve; });
  mockDiscovery(api, { returning: true });
  mockFlash(api, hold, !o.banner);
  api.get('/me/purchased-items', async () => {
    await hold;
    return PURCHASED_PAGE;
  });
  mockCampaigns(api, { home: o.banner ? [campaignBanner('thu', { title: 'Giữa Thu' }), campaignBanner('cu', { title: 'Tri ân khách cũ', audience: 'RETURNING' })] : [], hold });
  await trackLayoutShift(page);
  await page.addInitScript((hasBannerHint) => {
    localStorage.setItem('tubu_home_kind', JSON.stringify({ userId: 'user-4b', kind: 'returning' }));
    if (!hasBannerHint) localStorage.setItem('tubu_home_flash', '1');
    localStorage.setItem('tubu_home_purchased', 'one');
    if (hasBannerHint) localStorage.setItem('tubu_home_banner', '1');
  }, o.banner);
  await page.goto('/');
  if (!o.banner) await expect(page.getByTestId('flash-sale-loading')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('purchased-rail-loading')).toBeVisible();
  return release;
}

async function waitSettled(page: Page, o: { banner: boolean }): Promise<void> {
  if (o.banner) await expect(page.getByRole('region', { name: 'Chương trình nổi bật' })).toBeVisible({ timeout: 15_000 });
  else await expect(page.getByRole('region', { name: 'Giờ vàng', exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('region', { name: 'Mua lại' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('region', { name: 'Gợi ý hôm nay' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('flash-sale-loading')).toHaveCount(0);
  await expect(page.getByTestId('purchased-rail-loading')).toHaveCount(0);
  await expect(page.getByTestId('home-banner-loading')).toHaveCount(0);
  await expect(page.getByTestId('catalog-grid-skeleton')).toHaveCount(0);
}

test.describe('Trang chủ Mini — CLS khi có banner chiến dịch', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('máy nhớ lần trước có banner, dữ liệu về muộn (Giờ vàng trống): banner chỉ hiện sau khi Giờ vàng chốt, khung chờ cùng tỉ lệ giữ chỗ nên không đẩy khối nào (CLS ≤ 0,02)', async ({ page, api }) => {
    const release = await openReturningHome(page, api, { banner: true });
    release();
    await expect(page.getByRole('region', { name: 'Chương trình nổi bật' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('group', { name: /Tri ân khách cũ/ })).toBeAttached();
    // Ô khuyến mãi một khối: banner hiện thì không Giờ vàng.
    await expect(page.getByRole('region', { name: 'Giờ vàng', exact: true })).toHaveCount(0);
    await waitSettled(page, { banner: true });
    const { value, detail } = await settledCls(page);
    expect(value, `CLS ${value.toFixed(4)}: ${detail}`).toBeLessThanOrEqual(0.02);
  });

  test('không có chiến dịch và máy không nhớ banner: không khung giữ chỗ nào, nên cũng không nhảy (CLS ≤ 0,02)', async ({ page, api }) => {
    const release = await openReturningHome(page, api, { banner: false });
    expect(await page.getByTestId('home-banner-loading').count()).toBe(0);
    release();
    await waitSettled(page, { banner: false });
    await expect(page.getByRole('region', { name: 'Chương trình nổi bật' })).toHaveCount(0);
    const { value, detail } = await settledCls(page);
    expect(value, `CLS ${value.toFixed(4)}: ${detail}`).toBeLessThanOrEqual(0.02);
  });
});
