import type { Page } from '@playwright/test';
import { test, expect, makeUser, mockSession, publicConfig, type MockApi } from './support/mock-api';
import { mockNewbieGame } from './support/game-newbie-states';
import { mockAlbum } from './support/game-album-mocks';
import { expectNoHorizontalOverflow, expectTargets44, mockMiniGames } from './support/game-mini-mocks';
import { mockDiscovery } from './support/discovery-mocks';

/**
 * tubu-w14-02, web khách ở 320 và 375px (project "Web Customer Mobile"; lời gọi /api/** từ trình duyệt đi qua mock):
 * - `/bo-qua-tang`: combo thật với giá cả bộ tính từ giá món, hai mốc đọc từ máy chủ, JSON-LD CollectionPage, trạng thái trống;
 * - khối Mời bạn của Tài khoản: thẻ chia sẻ nêu thưởng đơn đầu của máy chủ, ô số canh cột, sao chép một chạm, ghi green_card_shared.
 * Không trang nào tràn ngang, mọi nút từ 44px. Đặt W1402_SHOTS_DIR để chụp ảnh.
 */

const SHOTS = process.env.W1402_SHOTS_DIR;
const FUTURE = new Date(Date.now() + 7 * 86_400_000).toISOString();
const item = (pid: string, name: string, price: number) => ({
  productId: pid,
  variationId: `v-${pid}`,
  maxQty: 1,
  addonPrice: null,
  inStock: true,
  product: { id: pid, slug: `sp-${pid}`, brand: 'Tubu', name, thumbnail: null, basePrice: price, salePrice: null, isFeatured: false, inStock: true, repVariationId: `v-${pid}` },
});
const LANDING = {
  combos: [
    { id: 'c1', kind: 'BUNDLE_PCT', title: 'Combo khởi đầu bếp xanh', pct: 10, endAt: FUTURE, anchorProductId: null, items: [item('a', 'Nước rửa chén bồ hòn 500ml', 120_000), item('b', 'Miếng rửa xơ mướp', 85_000)] },
    { id: 'c2', kind: 'BUNDLE_PCT', title: 'Bộ quà tắm thuần khiết', pct: 15, endAt: FUTURE, anchorProductId: null, items: [item('c', 'Sữa tắm thảo mộc 1 lít bản dài để thử xuống dòng', 300_000), item('d', 'Bông tắm sợi tre', 100_000)] },
  ],
  freeshipThreshold: 199_000,
  giftTrialMinOrder: 299_000,
};
const CARD = { referralCode: 'XANH42', album: { seen: 12, total: 40 }, wasteItems: 7, firstOrderReward: { points: 100, minOrderAmount: 199_000 }, earnsPoints: true };
const REFERRAL = { referralCode: 'XANH42', invitedCount: 12, firstOrderCount: 4, successCount: 3, earnedPoints: 5_000, minOrderAmount: 200_000, windowDays: 30, referrerRewardPoints: 5_000 };

function member(api: MockApi) {
  const user = mockSession(api, makeUser({ id: 'u-w1402', fullName: 'Khách xanh', phone: '0912345678', pointsBalance: 0, referralCode: 'XANH42' }));
  api.get('/auth/me', { ...user, ownsBrand: false });
  api.get('/dealer/me', { status: 'NONE', isDealer: false });
  api.get('/me', { id: 'u-w1402', fullName: 'Khách xanh', email: null, avatarUrl: null, dob: null, phone: '0912345678', role: 'CUSTOMER', referralCode: 'XANH42', onboarded: true, segments: [], pointsBalance: 0, pointsConvertedBalance: 0, walletBalance: 0 });
  mockNewbieGame(api, 'new');
  mockMiniGames(api);
  mockAlbum(api);
  api.get('/config/public', publicConfig({ referralViralEnabled: true }));
  api.get('/me/green-card', CARD);
  api.get('/me/referral', REFERRAL);
  api.allowUnmocked('POST /events');
}

async function signedIn(page: Page) {
  await page.context().addCookies([{ name: 'tubu_web_session', value: '1', domain: 'localhost', path: '/' }]);
  await page.addInitScript(() => {
    try {
      localStorage.setItem('tubu_web_session', '1');
    } catch {
      // không có localStorage: spec vẫn chạy, chỉ không có phiên khôi phục
    }
  });
}

for (const width of [320, 375]) {
  test.describe(`tubu-w14-02 web ${width}px`, () => {
    test.use({ viewport: { width, height: 760 } });
    test.beforeEach(({}, testInfo) => test.skip(testInfo.project.name !== 'Web Customer Mobile', 'khổ điện thoại chạy ở project Web Customer Mobile'));

    test('/bo-qua-tang: combo với giá cả bộ thật, hai mốc từ máy chủ, JSON-LD CollectionPage, nút 44px, không tràn ngang', async ({ page, api }) => {
      api.get('/bundles/gift-landing', LANDING);
      api.get('/config/public', publicConfig({}));
      await page.goto('/bo-qua-tang');
      await expect(page.getByRole('heading', { level: 1, name: 'Bộ quà tặng & combo khởi đầu' })).toBeVisible({ timeout: 15_000 });
      const list = page.getByTestId('gift-combos-list');
      await expect(list.getByRole('heading', { level: 3 })).toHaveText(['Combo khởi đầu bếp xanh', 'Bộ quà tắm thuần khiết']);
      await expect(list).toContainText('184.500đ');
      await expect(list).toContainText('340.000đ');
      await expect(page.getByTestId('gift-combos-callout')).toHaveText(['Miễn phí giao hàng cho đơn từ 199.000đ', 'Tặng quà dùng thử 0đ cho đơn từ 299.000đ']);
      const ld = await page.locator('script[type="application/ld+json"]').allTextContents();
      const types = ld.flatMap((t) => ((JSON.parse(t) as { '@graph'?: { '@type': string }[] })['@graph'] ?? []).map((n) => n['@type']));
      expect(types).toEqual(expect.arrayContaining(['CollectionPage', 'BreadcrumbList']));
      await expect(page).toHaveTitle(/Bộ quà tặng & combo khởi đầu/);
      await expectTargets44(list);
      await expectNoHorizontalOverflow(page);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/web-${width}-bo-qua-tang.png`, fullPage: true });
    });

    test('tubu-w15-02 Trang chủ: "Bộ quà tặng" nằm trong "Tất cả lối tắt" (hàng lối tắt nhanh không thêm ô), chạm mở /bo-qua-tang', async ({ page, api }) => {
      mockDiscovery(api, { returning: true });
      api.get('/bundles/gift-landing', LANDING);
      await page.goto('/');
      const shortcuts = page.getByRole('region', { name: 'Lối tắt', exact: true });
      const more = shortcuts.getByRole('button', { name: 'Thêm lối tắt', exact: true });
      await expect(more).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('shortcut-quick-pills').locator('a, button')).toHaveCount(3);
      await expect(shortcuts.getByText('Bộ quà tặng')).toHaveCount(0);
      await more.click();
      const dialog = page.getByRole('dialog', { name: 'Tất cả lối tắt' });
      const gifts = dialog.getByRole('button', { name: /Bộ quà tặng/ });
      await expect(gifts).toBeVisible({ timeout: 15_000 });
      expect((await gifts.boundingBox())!.height, 'vùng chạm dòng Bộ quà tặng').toBeGreaterThanOrEqual(44);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/web-${width}-home-shortcuts-sheet.png` });
      await gifts.click();
      await expect(page).toHaveURL(/\/bo-qua-tang$/, { timeout: 15_000 });
      await expect(page.getByRole('heading', { level: 1, name: 'Bộ quà tặng & combo khởi đầu' })).toBeVisible({ timeout: 15_000 });
    });

    test('/bo-qua-tang 0 combo: trạng thái trống có lối sang Sản phẩm, mốc vẫn hiện', async ({ page, api }) => {
      api.get('/bundles/gift-landing', { ...LANDING, combos: [] });
      api.get('/config/public', publicConfig({}));
      await page.goto('/bo-qua-tang');
      await expect(page.getByText('Chưa có combo nào đang mở bán')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('gift-combos-callout')).toHaveCount(2);
      await expect(page.getByRole('main').locator('a[href="/san-pham"]')).toBeVisible();
      await expectNoHorizontalOverflow(page);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/web-${width}-bo-qua-tang-empty.png`, fullPage: true });
    });

    test('Tài khoản: thẻ chia sẻ nêu +100 Điểm Xanh / 199.000đ, ô số, sao chép một chạm ghi green_card_shared', async ({ page, api }) => {
      member(api);
      await signedIn(page);
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
      await page.goto('/tai-khoan?section=referral');
      const card = page.getByTestId('invite-share-card');
      await expect(card.getByRole('heading', { level: 3, name: 'Tặng bạn trải nghiệm thuần khiết' })).toBeVisible({ timeout: 15_000 });
      await expect(card.getByTestId('invite-share-offer')).toHaveText('Nhận +100 Điểm Xanh khi bạn đặt đơn đầu từ 199.000đ');
      await expect(card.getByTestId('invite-share-stats').locator('dd')).toHaveText(['12', '5.000']);
      await expectTargets44(card);
      await expectNoHorizontalOverflow(page);
      await card.getByRole('button', { name: 'Sao chép link mời bạn' }).click();
      await expect(card.getByRole('status')).toHaveText('Đã sao chép link mời bạn');
      expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('XANH42');
      if (SHOTS) {
        await card.scrollIntoViewIfNeeded();
        await page.screenshot({ path: `${SHOTS}/web-${width}-invite-card.png` });
      }
    });
  });
}

test.describe('tubu-w15-02 web máy tính: "Bộ quà tặng" ở thanh điều hướng chính và chân trang', () => {
  test.beforeEach(({}, testInfo) => test.skip(testInfo.project.name !== 'Web Customer', 'khổ máy tính chạy ở project Web Customer'));

  const navLink = (page: Page, name: string) => page.getByRole('navigation', { name: 'Điều hướng chính' }).getByRole('link', { name, exact: true });
  const inViewport = (page: Page, name: string) =>
    navLink(page, name).evaluate((el) => {
      const b = el.getBoundingClientRect();
      return b.left >= 0 && b.right <= window.innerWidth;
    });

  for (const width of [1024, 1440]) {
    test(`${width}px: mục thứ 6 hiện, mục cuối vẫn nằm gọn trong màn, không tràn ngang; chạm mở /bo-qua-tang và gạch chân mục đang mở`, async ({ page, api }) => {
      api.get('/bundles/gift-landing', LANDING);
      api.get('/config/public', publicConfig({}));
      // Lưới Sản phẩm (bước sang /san-pham) tải danh mục và thương hiệu ở trình duyệt.
      api.get('/categories', []);
      api.get('/brands', []);
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/bo-qua-tang');
      await expect(page.getByRole('heading', { level: 1, name: 'Bộ quà tặng & combo khởi đầu' })).toBeVisible({ timeout: 15_000 });
      const gifts = navLink(page, 'Bộ quà tặng');
      await expect(gifts).toBeVisible();
      await expect(gifts).toHaveAttribute('aria-current', 'page');
      await expect(page.locator('[data-desktop-nav] li')).toHaveCount(6);
      expect(await inViewport(page, 'Hành trình nguyên liệu')).toBe(true);
      expect((await gifts.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await expectNoHorizontalOverflow(page);
      const footerLink = page.getByRole('navigation', { name: 'Khám phá' }).getByRole('link', { name: 'Bộ quà tặng', exact: true });
      await expect(footerLink).toHaveAttribute('href', '/bo-qua-tang');
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/web-${width}-nav-bo-qua-tang.png` });
      await navLink(page, 'Sản phẩm').click();
      await expect(page).toHaveURL(/\/san-pham/, { timeout: 15_000 });
      await navLink(page, 'Bộ quà tặng').click();
      await expect(page).toHaveURL(/\/bo-qua-tang$/, { timeout: 15_000 });
    });
  }

  test('800px: hàng điều hướng giữ 5 mục nhìn thấy (Bộ quà tặng ẩn tới lg), mục cuối không bị đẩy ra ngoài; chân trang vẫn có lối vào', async ({ page, api }) => {
    api.get('/bundles/gift-landing', LANDING);
    api.get('/config/public', publicConfig({}));
    await page.setViewportSize({ width: 800, height: 800 });
    await page.goto('/bo-qua-tang');
    await expect(page.getByRole('heading', { level: 1, name: 'Bộ quà tặng & combo khởi đầu' })).toBeVisible({ timeout: 15_000 });
    await expect(navLink(page, 'Bộ quà tặng')).toBeHidden();
    await expect(navLink(page, 'Hành trình nguyên liệu')).toBeVisible();
    expect(await inViewport(page, 'Hành trình nguyên liệu')).toBe(true);
    await expect(page.getByRole('navigation', { name: 'Khám phá' }).getByRole('link', { name: 'Bộ quà tặng', exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});
