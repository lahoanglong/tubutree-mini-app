import { test, expect, makeUser, mockSession } from './support/mock-api';
import { STAT_CASES, STAT_MIN_GAP, statFacts } from './support/account-stat-facts';

/**
 * Zalo Mini App, trang Cá nhân ở 320px: ô Điểm Xanh từ 1.000 điểm không gãy hai dòng, ô Ví từ 10 triệu tới 100 triệu không sát mép
 * hay tràn ngang. Ba ô chia đều nên mỗi ô chỉ khoảng 93px; đo bằng chữ thật (Inter) trong trình duyệt.
 */
test.use({ viewport: { width: 320, height: 568 } });

test.describe('Zalo Mini App E2E - ô Điểm Xanh và Ví ở 320px', () => {
  for (const c of STAT_CASES) {
    test(`${c.pointsText} một dòng, ${c.walletText} không sát mép, không tràn`, async ({ page, api }) => {
      mockSession(api, makeUser({ id: 'u-stat', fullName: 'Nguyễn Văn An', pointsBalance: c.points, walletBalance: c.wallet }));
      api.get('/me/loyalty', { tier: { name: 'Hạt Giống' }, pointsBalance: c.points, pointsConvertedBalance: 0 });
      api.get('/me/wallet', { walletBalance: c.wallet });
      api.get('/me/coupons', [{ id: 'c1', code: 'A' }]);
      api.allowUnmocked('GET /me/referral', 'GET /dealer/me', 'GET /auth/me', 'GET /brand/owner/me', 'GET /me/subscriptions', 'GET /chat/summary', 'GET /me/summary', 'GET /me/notifications');
      await page.goto('/profile');
      await expect(page.getByText(c.pointsText, { exact: true })).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText(c.walletText, { exact: true })).toBeVisible();

      const points = await statFacts(page, 'Điểm Xanh');
      const wallet = await statFacts(page, 'Ví Tubu');
      console.log(`STAT_FACTS ${JSON.stringify([points, wallet])}`);
      expect(points.text).toBe(c.pointsText);
      expect(wallet.text).toBe(c.walletText);
      for (const f of [points, wallet]) {
        expect(f.lines, `${f.text}: số dòng`).toBe(1);
        expect(f.overflow, `${f.text}: tràn ngang`).toBeLessThanOrEqual(0);
        expect(f.left, `${f.text}: cách mép trái`).toBeGreaterThanOrEqual(STAT_MIN_GAP);
        expect(f.right, `${f.text}: cách mép phải`).toBeGreaterThanOrEqual(STAT_MIN_GAP);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    });
  }
});
