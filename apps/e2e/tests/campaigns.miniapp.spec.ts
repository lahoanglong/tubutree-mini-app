import type { Page } from '@playwright/test';
import { test, expect, type MockApi } from './support/mock-api';
import { CATALOG, mockDiscovery, mockHomeEngagement } from './support/discovery-mocks';
import { CAMPAIGN_CODE, CAMPAIGN_SLUG, CAMPAIGN_TITLE, campaignBanner, campaignDetail, mockCampaigns } from './support/campaign-mocks';

/**
 * Zalo Mini App E2E — banner và trang chiến dịch (gói P11), 375×812. API mock toàn bộ (ảnh banner là data-URI, không qua mạng); không dùng waitForTimeout.
 * Chiều cao banner: bề rộng 375 trừ đệm 16 mỗi bên, tỉ lệ 5:2 → 137px (cùng số với `HOME_SETTLING_HEIGHTS.banner` ở app-core).
 */
test.use({ viewport: { width: 375, height: 812 } });

const HOUR = 3_600_000;
const BANNER_HEIGHT = 137;

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

async function blockHeights(page: Page): Promise<Record<string, number>> {
  return page.evaluate(() => Object.fromEntries(Array.from(document.querySelectorAll<HTMLElement>('[data-home-block]')).map((el) => [el.dataset.homeBlock!, el.getBoundingClientRect().height])));
}

const carousel = (page: Page) => page.getByRole('region', { name: 'Chương trình nổi bật' });
const slides = (page: Page) => carousel(page).locator('[aria-roledescription="slide"]');

test.describe('Banner chiến dịch ở Trang chủ', () => {
  test('không có chiến dịch: khối banner không có chiều cao, không băng chuyền, Giờ vàng vẫn trọn trong màn đầu 812', async ({ page, api }) => {
    mockDiscovery(api, { returning: true });
    mockFlash(api);
    mockCampaigns(api);
    await page.goto('/');
    const flash = page.getByRole('region', { name: 'Giờ vàng', exact: true });
    await expect(flash).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('region', { name: 'Gợi ý hôm nay' })).toBeVisible({ timeout: 15_000 });
    expect((await blockHeights(page)).banner ?? 0).toBe(0);
    await expect(carousel(page)).toHaveCount(0);
    await expect(page.getByTestId('home-banner-loading')).toHaveCount(0);
    expect(api.callsTo('GET', '/campaigns').length).toBeGreaterThan(0);
    const box = (await flash.boundingBox())!;
    expect(box.y + box.height, `Giờ vàng kết thúc ở ${Math.round(box.y + box.height)}px`).toBeLessThanOrEqual(812);
  });

  test('khách mới thấy chiến dịch cho mọi người và cho khách mới, không thấy chiến dịch của khách cũ; khối cao đúng 137px', async ({ page, api }) => {
    mockDiscovery(api);
    mockCampaigns(api, {
      home: [campaignBanner('thu', { title: 'Giữa Thu' }), campaignBanner('moi', { title: 'Quà khách mới', audience: 'NEW' }), campaignBanner('cu', { title: 'Tri ân khách cũ', audience: 'RETURNING' })],
    });
    await page.goto('/');
    await expect(carousel(page)).toBeVisible({ timeout: 15_000 });
    await expect(slides(page)).toHaveCount(2);
    await expect(carousel(page).getByRole('group', { name: 'Giữa Thu, 1 trên 2' })).toBeAttached();
    await expect(carousel(page).getByRole('group', { name: 'Quà khách mới, 2 trên 2' })).toBeAttached();
    await expect(carousel(page).getByText('Tri ân khách cũ')).toHaveCount(0);
    const heights = await blockHeights(page);
    expect(heights.banner, `banner cao ${heights.banner}px`).toBeGreaterThanOrEqual(BANNER_HEIGHT - 1);
    expect(heights.banner).toBeLessThanOrEqual(BANNER_HEIGHT + 1);
  });

  test('nút "Dừng tự chuyển" bấm được và giữ trạng thái; bấm slide đi tới trang chiến dịch', async ({ page, api }) => {
    mockDiscovery(api);
    mockCampaigns(api, {
      home: [campaignBanner(CAMPAIGN_SLUG, { title: CAMPAIGN_TITLE }), campaignBanner('moi', { title: 'Quà khách mới', audience: 'NEW' })],
      details: { [CAMPAIGN_SLUG]: campaignDetail() },
    });
    await page.goto('/');
    const pause = page.getByRole('button', { name: 'Dừng tự chuyển' });
    await expect(pause).toBeVisible({ timeout: 15_000 });
    await expect(pause).toHaveAttribute('aria-pressed', 'false');
    await pause.click();
    await expect(pause).toHaveAttribute('aria-pressed', 'true');
    await carousel(page).getByRole('link').first().click();
    await expect(page.getByRole('heading', { level: 1, name: CAMPAIGN_TITLE })).toBeVisible({ timeout: 15_000 });
    expect(new URL(page.url()).pathname).toBe(`/campaign/${CAMPAIGN_SLUG}`);
  });

  test('một chiến dịch duy nhất: không chấm, không nút Dừng', async ({ page, api }) => {
    mockDiscovery(api);
    mockCampaigns(api, { home: [campaignBanner('thu', { title: 'Giữa Thu' })] });
    await page.goto('/');
    await expect(slides(page)).toHaveCount(1, { timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Dừng tự chuyển' })).toHaveCount(0);
    await expect(carousel(page).getByRole('button', { name: /^Xem chương trình/ })).toHaveCount(0);
  });
});

test.describe('Trang chiến dịch', () => {
  test('khách chưa đăng nhập xem được ảnh, tên (h1), mã giảm giá và lưới sản phẩm', async ({ page, api }) => {
    // Chưa có phiên: ứng dụng thử tạo phiên khách ở lúc mở, không liên quan nội dung trang (không mockSession nên đây đúng là khách).
    api.allowUnmocked('POST /auth/guest');
    mockCampaigns(api, { details: { [CAMPAIGN_SLUG]: campaignDetail() } });
    await page.goto(`/campaign/${CAMPAIGN_SLUG}`);
    await expect(page.getByRole('heading', { level: 1, name: CAMPAIGN_TITLE })).toBeVisible({ timeout: 15_000 });
    // Ảnh đầu là ảnh trang trí (alt rỗng): h1 ngay trên đã gọi tên chương trình, trình đọc màn hình không đọc lặp.
    await expect(page.locator('img[alt=""][src^="data:image/svg+xml"]')).toBeVisible();
    await expect(page.getByRole('img', { name: CAMPAIGN_TITLE })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Mã giảm giá của chương trình' }).getByText(CAMPAIGN_CODE)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sao chép mã' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Sản phẩm trong chương trình' }).locator('[data-ds="product-tile"]')).toHaveCount(3);
  });

  test('chiến dịch hết hạn hay không có (API 404): "Chương trình đã kết thúc" kèm nút về Trang chủ', async ({ page, api }) => {
    mockDiscovery(api);
    mockCampaigns(api);
    await page.goto('/campaign/da-het-han');
    await expect(page.getByText('Chương trình đã kết thúc')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Thử lại' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Về trang chủ' }).click();
    await expect.poll(() => new URL(page.url()).pathname).toBe('/');
  });
});

test.describe('Banner đầu Ưu đãi', () => {
  test('banner OFFERS_TOP nằm trên cùng, trước thẻ Điểm Xanh', async ({ page, api }) => {
    mockDiscovery(api, { returning: true });
    mockHomeEngagement(api);
    mockCampaigns(api, { offers: [campaignBanner('uu-dai', { title: 'Ưu đãi tháng 11' })], home: [campaignBanner('khac', { title: 'Chỉ ở Trang chủ' })] });
    await page.goto('/offers');
    await expect(carousel(page)).toBeVisible({ timeout: 15_000 });
    await expect(carousel(page).getByRole('link', { name: /Ưu đãi tháng 11/ })).toBeVisible();
    await expect(page.getByText('Chỉ ở Trang chủ')).toHaveCount(0);
    const banner = (await carousel(page).boundingBox())!;
    const points = (await page.getByRole('region', { name: 'Điểm Xanh của bạn' }).boundingBox())!;
    expect(banner.y).toBeLessThan(points.y);
    expect(api.callsTo('GET', '/campaigns').some((c) => c.query.get('placement') === 'OFFERS_TOP')).toBe(true);
  });
});
