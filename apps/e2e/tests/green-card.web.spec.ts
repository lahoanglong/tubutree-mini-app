import type { Page } from '@playwright/test';
import { test, expect, makeUser, mockSession, publicConfig, type MockApi } from './support/mock-api';
import { mockNewbieGame } from './support/game-newbie-states';
import { mockAlbum } from './support/game-album-mocks';
import { expectNoHorizontalOverflow, expectTargets44, mockMiniGames } from './support/game-mini-mocks';

/**
 * Thẻ thành tích xanh (tubu-w8-02, cờ growth.referral_viral_enabled): ở Sổ tay Xanh là thẻ có số thẻ đã mở, số vỏ đã đổi, dòng thưởng đơn đầu và
 * hai nút chia sẻ / sao chép link mời; ở khối "Mời bạn" của Tài khoản chỉ thêm một dòng số, không thêm nút. Cờ tắt thì không gọi /me/green-card.
 */

const CARD = { referralCode: 'XANH42', album: { seen: 12, total: 40 }, wasteItems: 7, firstOrderReward: { points: 100, minOrderAmount: 199_000 }, earnsPoints: true };
const STATS = '12 thẻ xanh đã mở · 7 vỏ đã đổi';
const SHOTS = process.env.GREEN_CARD_SHOTS_DIR;

function member(api: MockApi, viral: boolean) {
  const user = mockSession(api, makeUser({ id: 'u-web', fullName: 'Khách xanh', phone: '0912345678', pointsBalance: 0, referralCode: 'XANH42' }));
  api.get('/auth/me', { ...user, ownsBrand: false });
  api.get('/dealer/me', { status: 'NONE', isDealer: false });
  mockNewbieGame(api, 'new');
  mockMiniGames(api);
  mockAlbum(api);
  api.get('/config/public', publicConfig({ referralViralEnabled: viral }));
  api.get('/me/green-card', CARD);
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

for (const { width, height, project } of [
  { width: 390, height: 844, project: 'Web Customer Mobile' },
  { width: 1440, height: 900, project: 'Web Customer' },
]) {
  test.describe(`Thẻ thành tích xanh web ${width}px`, () => {
    test.use({ viewport: { width, height } });
    test.beforeEach(({}, testInfo) => test.skip(testInfo.project.name !== project, `khổ ${width}px chạy ở project ${project}`));

    test('Sổ tay Xanh: thẻ dưới lưới có số, dòng thưởng, hai nút 44px; sao chép báo đã chép và ghi link mời có mã', async ({ page, api }) => {
      member(api, true);
      await signedIn(page);
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
      await page.goto('/vuon-xanh/so-tay');
      const card = page.getByTestId('green-card');
      await expect(card).toBeVisible({ timeout: 15_000 });
      await expect(card).toContainText(STATS);
      await expect(card).toContainText('cả hai nhận +100 Điểm Xanh');
      await expect(card.getByRole('button')).toHaveCount(2);
      await expectTargets44(card);
      await expectNoHorizontalOverflow(page);
      const gridBox = await page.getByTestId('album-grid').boundingBox();
      const cardBox = await card.boundingBox();
      expect(cardBox!.y).toBeGreaterThan(gridBox!.y + gridBox!.height - 1);
      await card.getByRole('button', { name: 'Sao chép link' }).click();
      await expect(card.getByRole('status')).toHaveText('Đã sao chép link mời bạn');
      const copied = await page.evaluate(() => navigator.clipboard.readText());
      expect(copied).toContain('XANH42');
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/web-${width}-album.png`, fullPage: true });
    });

    test('Tài khoản: khối Mời bạn thêm đúng một dòng số, không thêm nút', async ({ page, api }) => {
      member(api, true);
      // Trang Tài khoản đọc số dư từ GET /me (bản mặc định của mockSession chỉ có hồ sơ).
      api.get('/me', { id: 'u-web', fullName: 'Khách xanh', email: null, avatarUrl: null, dob: null, phone: '0912345678', role: 'CUSTOMER', referralCode: 'XANH42', onboarded: true, segments: [], pointsBalance: 0, pointsConvertedBalance: 0, walletBalance: 0 });
      await signedIn(page);
      await page.goto('/tai-khoan');
      const invite = page.getByRole('main').getByRole('button', { name: /^Mời bạn/ });
      await invite.click();
      const line = page.getByTestId('green-card-stats');
      await expect(line).toBeVisible({ timeout: 15_000 });
      await expect(line).toContainText(STATS);
      await expect(page.getByTestId('green-card')).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/web-${width}-account.png`, fullPage: true });
    });

    test('cờ tắt: không thẻ, không gọi /me/green-card', async ({ page, api }) => {
      member(api, false);
      await signedIn(page);
      await page.goto('/vuon-xanh/so-tay');
      await expect(page.getByTestId('album-grid')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('green-card')).toHaveCount(0);
      expect(api.callsTo('GET', '/me/green-card')).toHaveLength(0);
    });
  });
}
