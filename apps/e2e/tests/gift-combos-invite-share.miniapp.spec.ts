import type { Page } from '@playwright/test';
import { test, expect, makeUser, mockSession, publicConfig, type MockApi } from './support/mock-api';
import { mockNewbieGame } from './support/game-newbie-states';
import { mockAlbum } from './support/game-album-mocks';
import { expectNoHorizontalOverflow, expectTargets44, mockMiniGames } from './support/game-mini-mocks';
import { mockDiscovery } from './support/discovery-mocks';

/**
 * tubu-w14-02, Mini App ở 320 và 375px:
 * - `/gift-combos` (lối "Xem tất cả" của Combo tiết kiệm): combo thật với giá cả bộ tính từ giá món, hai mốc đọc từ máy chủ, trạng thái trống;
 * - khối Mời bạn của Cá nhân: thẻ chia sẻ nêu thưởng đơn đầu của máy chủ, ô số canh cột, sao chép một chạm.
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
const BATCH_CART = {
  items: [{ id: 'l-a', variationId: 'v-a', productId: 'a', slug: 'sp-a', name: 'Nước rửa chén bồ hòn 500ml', thumbnail: null, quantity: 1, unitPrice: 75_000, total: 75_000, stock: 9 }, { id: 'l-b', variationId: 'v-b', productId: 'b', slug: 'sp-b', name: 'Miếng rửa xơ mướp', thumbnail: null, quantity: 1, unitPrice: 75_000, total: 75_000, stock: 9 }],
  couponCode: null,
  subtotal: 150_000,
  comboDiscount: 30_000,
  discount: 0,
  freeship: false,
  freeshipThreshold: 199_000,
  itemCount: 2,
};
// tubu-w22-01: combo 50% bị kẹp ở 30.000đ (bộ nhân viên tạo vượt trần tiền): thẻ hứa đúng số máy chủ trả, nhãn % là mức thật.
const SAVING_LANDING = { ...LANDING, combos: [{ ...LANDING.combos[0]!, pct: 50, saving: 30_000 }, LANDING.combos[1]!] };
const CARD = { referralCode: 'XANH42', album: { seen: 12, total: 40 }, wasteItems: 7, firstOrderReward: { points: 100, minOrderAmount: 199_000 }, earnsPoints: true };
const REFERRAL = { referralCode: 'XANH42', invitedCount: 12, firstOrderCount: 4, successCount: 3, earnedPoints: 5_000, minOrderAmount: 200_000, windowDays: 30, referrerRewardPoints: 5_000 };

async function stubClipboard(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: (t: string) => ((window as unknown as { __copied: string }).__copied = t, Promise.resolve()) },
    });
  });
}

function member(api: MockApi) {
  mockSession(api, makeUser({ id: 'u-w1402', fullName: 'Khách xanh', pointsBalance: 0, referralCode: 'XANH42' }));
  mockNewbieGame(api, 'new');
  mockMiniGames(api);
  mockAlbum(api);
  api.get('/config/public', publicConfig({ referralViralEnabled: true }));
  api.get('/me/green-card', CARD);
  api.get('/me/referral', REFERRAL);
  api.get('/auth/me', { ownsBrand: false });
  api.allowUnmocked('POST /events', 'GET /affiliate/me', 'GET /me/coupons', 'GET /me/notifications', 'GET /notifications', 'GET /brand/owner/me', 'GET /dealer/me', 'GET /me/wallet', 'GET /me/loyalty');
}

for (const width of [320, 375]) {
  test.describe(`tubu-w14-02 Mini App ${width}px`, () => {
    test.use({ viewport: { width, height: 760 } });

    test('Bộ quà tặng: combo với giá cả bộ thật, hai mốc từ máy chủ, nút 44px, không tràn ngang', async ({ page, api }) => {
      member(api);
      api.get('/bundles/gift-landing', LANDING);
      await page.goto('/gift-combos');
      await expect(page.getByRole('heading', { level: 1, name: 'Bộ quà tặng & combo khởi đầu' })).toBeVisible({ timeout: 15_000 });
      const list = page.getByTestId('gift-combos-list');
      await expect(list.getByRole('heading', { level: 3 })).toHaveText(['Combo khởi đầu bếp xanh', 'Bộ quà tắm thuần khiết']);
      await expect(list).toContainText('184.500đ');
      await expect(list).toContainText('340.000đ');
      await expect(page.getByTestId('gift-combos-callout')).toHaveText(['Miễn phí giao hàng cho đơn từ 199.000đ', 'Tặng quà dùng thử 0đ cho đơn từ 299.000đ']);
      await expectTargets44(list);
      await expectNoHorizontalOverflow(page);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/mini-${width}-gift-combos.png`, fullPage: true });
    });

    test('tubu-w22-01 Thêm cả combo: "Tiết kiệm" là số máy chủ, câu mốc Miễn phí giao hàng ngay dưới thẻ vừa bấm, không tràn ngang', async ({ page, api }) => {
      member(api);
      api.get('/bundles/gift-landing', SAVING_LANDING);
      api.post('/cart/items/batch', BATCH_CART);
      api.get('/cart', BATCH_CART);
      await page.goto('/gift-combos');
      const list = page.getByTestId('gift-combos-list');
      await expect(list).toContainText('Tiết kiệm 30.000đ', { timeout: 15_000 });
      await expect(list).toContainText('175.000đ');
      await expect(list).toContainText('Combo -14%');
      await list.getByRole('button', { name: /^Thêm cả combo Combo khởi đầu bếp xanh/ }).click();
      const cues = page.getByTestId('gift-combos-cue');
      await expect(cues.first()).toHaveText('Mua thêm 49.000đ để được Miễn phí giao hàng 🚚');
      await expect(cues.nth(1)).toHaveText('');
      await expect(page.getByText('Đã thêm cả combo vào giỏ').first()).toBeVisible();
      await expectNoHorizontalOverflow(page);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/mini-${width}-gift-combos-added.png` });
    });

    test('tubu-w15-02 Trang chủ: "Bộ quà tặng" nằm trong hộp "Thêm lối tắt" (lưới vẫn 8 ô), chạm mở /gift-combos', async ({ page, api }) => {
      mockDiscovery(api, { returning: true });
      api.get('/bundles/gift-landing', LANDING);
      await page.goto('/');
      const shortcuts = page.getByRole('region', { name: 'Lối tắt', exact: true });
      const more = shortcuts.getByRole('button', { name: 'Thêm lối tắt', exact: true });
      await expect(more).toBeVisible({ timeout: 30_000 });
      await expect(shortcuts.locator('.tubu-shortcut-cell')).toHaveCount(8);
      await expect(shortcuts.getByRole('button', { name: /Bộ quà tặng/ })).toHaveCount(0);
      await more.click();
      const dialog = page.getByRole('dialog', { name: 'Thêm lối tắt' });
      const gifts = dialog.getByRole('button', { name: /Bộ quà tặng/ });
      await expect(gifts).toBeVisible({ timeout: 15_000 });
      expect((await gifts.boundingBox())!.height, 'vùng chạm dòng Bộ quà tặng').toBeGreaterThanOrEqual(44);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/mini-${width}-home-shortcuts-sheet.png` });
      await gifts.click();
      await expect(page).toHaveURL(/\/gift-combos$/, { timeout: 15_000 });
      await expect(page.getByRole('heading', { level: 1, name: 'Bộ quà tặng & combo khởi đầu' })).toBeVisible({ timeout: 15_000 });
    });

    test('Bộ quà tặng 0 combo: trạng thái trống có lối sang Sản phẩm, mốc vẫn hiện', async ({ page, api }) => {
      member(api);
      api.get('/bundles/gift-landing', { ...LANDING, combos: [] });
      await page.goto('/gift-combos');
      await expect(page.getByText('Chưa có combo nào đang mở bán')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('gift-combos-callout')).toHaveCount(2);
      await expect(page.getByRole('button', { name: 'Xem sản phẩm khác' })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/mini-${width}-gift-combos-empty.png`, fullPage: true });
    });

    test('Cá nhân: thẻ chia sẻ nêu +100 Điểm Xanh / 199.000đ, ô số, sao chép một chạm', async ({ page, api }) => {
      member(api);
      await stubClipboard(page);
      await page.goto('/profile?section=referral');
      const card = page.getByTestId('invite-share-card');
      await expect(card.getByRole('heading', { level: 3, name: 'Tặng bạn trải nghiệm thuần khiết' })).toBeVisible({ timeout: 15_000 });
      await expect(card.getByTestId('invite-share-offer')).toHaveText('Nhận +100 Điểm Xanh khi bạn đặt đơn đầu từ 199.000đ');
      await expect(card.getByTestId('invite-progress')).toHaveCount(0);
      await expect(card.getByTestId('invite-share-stats').locator('dd')).toHaveText(['12', '5.000']);
      await expectTargets44(card);
      await expectNoHorizontalOverflow(page);
      await card.getByRole('button', { name: 'Sao chép link mời bạn' }).click();
      await expect(page.getByText('Đã sao chép link mời bạn')).toBeVisible();
      expect(await page.evaluate(() => (window as unknown as { __copied?: string }).__copied ?? '')).toContain('XANH42');
      if (SHOTS) {
        await card.scrollIntoViewIfNeeded();
        await page.screenshot({ path: `${SHOTS}/mini-${width}-invite-card.png` });
      }
    });
  });
}
