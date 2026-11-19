import type { Page } from '@playwright/test';
import { test, expect, makeUser, mockSession, publicConfig, type MockApi } from './support/mock-api';
import { mockNewbieGame } from './support/game-newbie-states';
import { mockAlbum } from './support/game-album-mocks';
import { expectNoHorizontalOverflow, expectTargets44, mockMiniGames } from './support/game-mini-mocks';

/**
 * Thẻ thành tích xanh Mini App (tubu-w8-02, cờ growth.referral_viral_enabled), cùng hành vi với web (`green-card.web.spec.ts`): Sổ tay Xanh có
 * thẻ số + dòng thưởng + hai nút; khối "Mời bạn nhận quà" ở Cá nhân chỉ thêm một dòng số; cờ tắt thì không gọi /me/green-card.
 */

const CARD = { referralCode: 'XANH42', album: { seen: 12, total: 40 }, wasteItems: 7, firstOrderReward: { points: 100, minOrderAmount: 199_000 }, earnsPoints: true };
const STATS = '12 thẻ xanh đã mở · 7 vỏ đã đổi';
const SHOTS = process.env.GREEN_CARD_SHOTS_DIR;

function member(api: MockApi, viral: boolean) {
  mockSession(api, makeUser({ id: 'u-green', fullName: 'Khách xanh', pointsBalance: 0, referralCode: 'XANH42' }));
  mockNewbieGame(api, 'new');
  mockMiniGames(api);
  mockAlbum(api);
  api.get('/config/public', publicConfig({ referralViralEnabled: viral }));
  api.get('/me/green-card', CARD);
  api.allowUnmocked('POST /events');
}

async function stubClipboard(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: (t: string) => ((window as unknown as { __copied: string }).__copied = t, Promise.resolve()) },
    });
  });
}

test.describe('Thẻ thành tích xanh Mini App 390px', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('Sổ tay Xanh: thẻ dưới lưới có số, dòng thưởng, hai nút 44px; sao chép báo đã chép và ghi link có mã', async ({ page, api }) => {
    member(api, true);
    await stubClipboard(page);
    await page.goto('/game/album');
    const card = page.getByTestId('green-card');
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card).toContainText(STATS);
    await expect(card).toContainText('cả hai nhận +100 Điểm Xanh');
    await expect(card.getByRole('button')).toHaveCount(2);
    await expectTargets44(card);
    await expectNoHorizontalOverflow(page);
    await card.getByRole('button', { name: 'Sao chép link' }).click();
    await expect(page.getByText('Đã sao chép link mời bạn')).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __copied?: string }).__copied ?? '')).toContain('XANH42');
    if (SHOTS) {
      await card.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${SHOTS}/mini-390-album.png` });
    }
  });

  test('Cá nhân: khối Mời bạn nhận quà thêm đúng một dòng số, không thêm nút', async ({ page, api }) => {
    member(api, true);
    api.get('/auth/me', { ownsBrand: false });
    api.allowUnmocked('GET /affiliate/me', 'GET /me/coupons', 'GET /me/notifications', 'GET /notifications', 'GET /brand/owner/me', 'GET /dealer/me', 'GET /me/wallet', 'GET /me/loyalty');
    await page.goto('/profile?section=referral');
    await expect(page.getByRole('button', { name: /^Mời bạn nhận quà/ })).toHaveAttribute('aria-expanded', 'true', { timeout: 15_000 });
    const line = page.getByTestId('green-card-stats');
    await expect(line).toBeVisible();
    await expect(line).toContainText(STATS);
    await expect(page.getByTestId('green-card')).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    if (SHOTS) {
      await line.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${SHOTS}/mini-390-profile.png` });
    }
  });

  test('cờ tắt: không thẻ, không gọi /me/green-card', async ({ page, api }) => {
    member(api, false);
    await page.goto('/game/album');
    await expect(page.getByTestId('album-grid')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('green-card')).toHaveCount(0);
    expect(api.callsTo('GET', '/me/green-card')).toHaveLength(0);
  });
});
