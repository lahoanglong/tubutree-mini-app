import type { Locator, Page } from '@playwright/test';
import { test, expect, makeUser, mockSession, type MockApi } from './support/mock-api';
import { mockDiscovery, mockHomeEngagement } from './support/discovery-mocks';
import { mockFlashSlots } from './support/flash-slot-mocks';
import { CAMPAIGN_SLUG, CAMPAIGN_TITLE, campaignDetail, mockCampaigns } from './support/campaign-mocks';
import { mockCollectable, mockCouponHistory, mockWallet } from './support/voucher-mocks';

/**
 * Bốn trang mua sắm có PageHeader (Bán chạy nhất, Giờ vàng, Chiến dịch, Mã giảm giá) phải đặt tiêu đề cùng hàng với nút Quay lại như Giỏ hàng.
 * Lớp `page` của vỏ app cộng thêm 48px đệm đầu khi có nút lùi, mà PageHeader đã tự đệm chỗ cho nút: dùng cả hai thì tiêu đề rơi xuống hàng hai
 * và đầu trang thừa 48px (review hình bước chốt, P1 #5). Đo ở 375px với `--safe-top` 0 (trình duyệt) và 47 (tai thỏ); viewport thấp để trang cuộn được.
 */
test.use({ viewport: { width: 375, height: 520 } });

const SAFE_TOPS = [0, 47] as const;
const BACK_BAR = 56;

async function setSafeTop(page: Page, px: number): Promise<void> {
  await page.addInitScript((value) => {
    document.addEventListener('DOMContentLoaded', () => document.documentElement.style.setProperty('--safe-top', `${value}px`));
  }, px);
}

const mid = (b: { y: number; height: number }) => b.y + b.height / 2;
const round = (n: number) => Math.round(n);

function mockAll(api: MockApi): void {
  mockSession(api, makeUser({ id: 'user-title-row', fullName: 'Khách Tiêu Đề' }));
  mockDiscovery(api, { tree: true, returning: true });
  mockHomeEngagement(api);
  mockFlashSlots(api);
  mockCampaigns(api, { details: { [CAMPAIGN_SLUG]: campaignDetail() } });
  mockCollectable(api);
  mockWallet(api);
  mockCouponHistory(api);
}

interface Screen {
  name: string;
  url: string;
  title: string;
  /** Hàng dính của trang (nếu có): đứng ngay dưới thanh lùi khi cuộn. */
  sticky?: (page: Page) => Locator;
}

const SCREENS: Screen[] = [
  { name: 'Bán chạy nhất', url: '/best-sellers', title: 'Bán chạy nhất', sticky: (p) => p.getByRole('tablist', { name: 'Danh mục bán chạy' }).locator('..') },
  { name: 'Giờ vàng', url: '/flash-sale', title: 'Giờ vàng', sticky: (p) => p.getByTestId('flash-sticky') },
  { name: 'Chiến dịch', url: `/campaign/${CAMPAIGN_SLUG}`, title: CAMPAIGN_TITLE },
  { name: 'Mã giảm giá', url: '/vouchers', title: 'Mã giảm giá', sticky: (p) => p.getByRole('tablist', { name: 'Nhóm mã giảm giá' }).locator('..') },
];

for (const safe of SAFE_TOPS) {
  test.describe(`--safe-top ${safe}px`, () => {
    for (const s of SCREENS) {
      test(`${s.name}: tiêu đề cùng hàng nút Quay lại, không thụt xuống hàng hai`, async ({ page, api }) => {
        mockAll(api);
        await setSafeTop(page, safe);
        await page.goto(s.url);
        const h1 = page.getByRole('heading', { level: 1, name: s.title });
        await expect(h1).toBeVisible({ timeout: 15_000 });
        const back = page.getByRole('button', { name: 'Quay lại', exact: true });
        await expect(back).toBeVisible();
        const h = (await h1.boundingBox())!;
        const b = (await back.boundingBox())!;
        expect(Math.abs(mid(h) - mid(b)), `tâm tiêu đề ${round(mid(h))}px, tâm nút Quay lại ${round(mid(b))}px`).toBeLessThanOrEqual(12);
        expect(mid(h), `tiêu đề nằm trong dải thanh lùi (${BACK_BAR + safe}px)`).toBeLessThan(BACK_BAR + safe);
        expect(h.x, 'tiêu đề chừa chỗ cho nút Quay lại bên trái').toBeGreaterThanOrEqual(56);
      });

      const sticky = s.sticky;
      if (!sticky) continue;
      test(`${s.name}: hàng dính dính khít dưới thanh lùi khi cuộn, không hở`, async ({ page, api }) => {
        mockAll(api);
        // Viewport thấp hơn để cả trang Mã giảm giá (chỉ 3 phiếu) đủ dài mà cuộn tới chỗ hàng dính bám.
        await page.setViewportSize({ width: 375, height: 380 });
        await setSafeTop(page, safe);
        await page.goto(s.url);
        const bar = sticky(page);
        await expect(bar).toBeVisible({ timeout: 15_000 });
        const scroller = page.locator('.zaui-page', { has: bar }).first();
        await scroller.evaluate((el) => el.scrollTo(0, 5000));
        await expect.poll(() => scroller.evaluate((el) => el.scrollTop), { timeout: 10_000 }).toBeGreaterThan(60);
        await expect.poll(async () => round((await bar.boundingBox())!.y), { timeout: 5_000 }).toBe(BACK_BAR + safe);
      });
    }
  });
}
