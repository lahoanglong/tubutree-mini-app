import type { Page } from '@playwright/test';
import { test, expect, type MockApi } from './support/mock-api';
import { CATALOG, mockDiscovery, mockHomeEngagement } from './support/discovery-mocks';
import { campaignBanner, mockCampaigns } from './support/campaign-mocks';
import { mockCollectable, mockWallet } from './support/voucher-mocks';

/**
 * Zalo Mini App E2E — độ ổn định bố cục của Ưu đãi khi banner OFFERS_TOP về muộn. Dự án Mini chạy WebKit, không có PerformanceObserver 'layout-shift',
 * nên spec ép Chromium để đo CLS thật (cùng cách với campaigns-cls). Mọi khối khác (Giờ vàng, Nhận mã, Điểm Xanh, Mã của tôi) đã về và vẽ xong TRƯỚC khi
 * nhả banner, rồi bộ đếm được đặt về 0: con số đo chỉ còn là cú nhảy do banner về, không lẫn nhịp tải của khối khác. API mock toàn bộ; không dùng waitForTimeout.
 */
test.use({ browserName: 'chromium', viewport: { width: 375, height: 812 } });

const HOUR = 3_600_000;

function mockFlash(api: MockApi): void {
  api.get('/flash-sales/active', () => {
    const now = Date.now();
    return CATALOG.slice(4, 7).map((p, i) => ({
      itemId: `fi-${p.id}`, variationId: `v-${p.id}`, productSlug: p.slug, productName: p.name, variationName: null, thumbnail: p.thumbnail,
      flashPrice: 59_000 + i * 1_000, retailPrice: p.basePrice, salePrice: p.salePrice, soldCount: 10 + i, quota: 50,
      endAt: new Date(now + 3 * HOUR).toISOString(), serverNow: new Date(now).toISOString(),
    }));
  });
}

async function trackLayoutShift(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __cls: number; __shifts: string[] };
    w.__cls = 0;
    w.__shifts = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as unknown as { hadRecentInput: boolean; value: number; sources: { node: Node | null }[] }[]) {
        if (e.hadRecentInput) continue;
        w.__cls += e.value;
        const names = e.sources.map((s) => {
          const el = s.node instanceof Element ? s.node : s.node?.parentElement;
          return el?.closest('section[aria-label],section[aria-labelledby],[data-testid]')?.getAttribute('aria-label') ?? el?.closest('[data-testid]')?.getAttribute('data-testid') ?? '?';
        });
        w.__shifts.push(`${e.value.toFixed(4)} ${[...new Set(names)].join(',')}`);
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
}

const resetCls = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { __cls: number; __shifts: string[] };
    w.__cls = 0;
    w.__shifts = [];
  });

async function settledCls(page: Page): Promise<{ value: number; detail: string }> {
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  return page.evaluate(() => {
    const w = window as unknown as { __cls: number; __shifts: string[] };
    return { value: w.__cls, detail: w.__shifts.join(' | ') };
  });
}

/** Mở Ưu đãi của khách cũ đã được máy nhớ; banner (nếu có) bị giữ tới khi gọi hàm trả về. Khung chờ của các khối khác đã được máy nhớ nên chúng cũng không nhảy. */
async function openOffers(page: Page, api: MockApi, o: { banner: boolean; hint: boolean }): Promise<() => void> {
  let release!: () => void;
  const hold = new Promise<void>((resolve) => { release = resolve; });
  mockDiscovery(api, { returning: true });
  mockHomeEngagement(api);
  mockFlash(api);
  mockCollectable(api);
  mockWallet(api);
  mockCampaigns(api, { offers: o.banner ? [campaignBanner('uu-dai', { title: 'Ưu đãi tháng 11' })] : [], hold });
  await trackLayoutShift(page);
  await page.addInitScript((hasBannerHint) => {
    localStorage.setItem('tubu_home_kind', JSON.stringify({ userId: 'user-4b', kind: 'returning' }));
    localStorage.setItem('tubu_home_flash', '1');
    localStorage.setItem('tubu_offers_collect', '2');
    if (hasBannerHint) localStorage.setItem('tubu_offers_banner', '1');
  }, o.hint);
  await page.goto('/offers');
  // Mọi khối khác đã vẽ xong khi banner còn bị giữ.
  await expect(page.getByRole('region', { name: 'Giờ vàng hôm nay', exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('region', { name: 'Nhận mã', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Mã của tôi', exact: true })).toBeVisible();
  await expect(page.getByTestId('offers-collect-loading')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Chương trình nổi bật' })).toHaveCount(0);
  return release;
}

test.describe('Ưu đãi Mini — CLS khi có banner OFFERS_TOP', () => {
  test('máy nhớ lần trước có banner: khung chờ cùng tỉ lệ giữ chỗ nên banner về muộn không đẩy khối nào (CLS ≤ 0,02)', async ({ page, api }) => {
    const release = await openOffers(page, api, { banner: true, hint: true });
    await expect(page.getByTestId('offers-banner-loading')).toBeVisible();
    const before = (await page.getByRole('region', { name: 'Giờ vàng hôm nay', exact: true }).boundingBox())!.y;
    await resetCls(page);
    release();
    await expect(page.getByRole('region', { name: 'Chương trình nổi bật' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('offers-banner-loading')).toHaveCount(0);
    const { value, detail } = await settledCls(page);
    expect(value, `CLS ${value.toFixed(4)}: ${detail}`).toBeLessThanOrEqual(0.02);
    // Cùng một kết luận bằng toạ độ: Giờ vàng đứng nguyên chỗ.
    expect((await page.getByRole('region', { name: 'Giờ vàng hôm nay', exact: true }).boundingBox())!.y).toBeCloseTo(before, 0);
  });

  test('đối chứng: máy không nhớ banner mà banner về muộn thì Giờ vàng bị đẩy xuống (phép đo không vô nghĩa)', async ({ page, api }) => {
    const release = await openOffers(page, api, { banner: true, hint: false });
    await resetCls(page);
    release();
    await expect(page.getByRole('region', { name: 'Chương trình nổi bật' })).toBeVisible({ timeout: 15_000 });
    const { value } = await settledCls(page);
    expect(value).toBeGreaterThan(0.02);
  });

  test('không có chiến dịch và máy không nhớ banner: không khung giữ chỗ nào, nên cũng không nhảy (CLS ≤ 0,02)', async ({ page, api }) => {
    const release = await openOffers(page, api, { banner: false, hint: false });
    expect(await page.getByTestId('offers-banner-loading').count()).toBe(0);
    await resetCls(page);
    release();
    await expect.poll(() => api.callsTo('GET', '/campaigns').length, { timeout: 10_000 }).toBeGreaterThan(0);
    const { value, detail } = await settledCls(page);
    await expect(page.getByRole('region', { name: 'Chương trình nổi bật' })).toHaveCount(0);
    await expect(page.getByTestId('offers-banner-loading')).toHaveCount(0);
    expect(value, `CLS ${value.toFixed(4)}: ${detail}`).toBeLessThanOrEqual(0.02);
  });

  test('máy nhớ có banner mà chiến dịch đã hết: khung chờ biến mất, ghi nhớ không còn banner', async ({ page, api }) => {
    const release = await openOffers(page, api, { banner: false, hint: true });
    await expect(page.getByTestId('offers-banner-loading')).toBeVisible();
    release();
    await expect(page.getByTestId('offers-banner-loading')).toHaveCount(0, { timeout: 15_000 });
    await expect.poll(() => page.evaluate(() => localStorage.getItem('tubu_offers_banner'))).toBe('0');
  });
});
