import { expect, test } from './support/mock-api';
import { STAT_CASES, STAT_MIN_GAP, statFacts } from './support/account-stat-facts';

/**
 * Web khách, trang Cá nhân ở 320px: cùng luật với Mini App. Ô Điểm Xanh từ 1.000 điểm không gãy hai dòng, ô Ví từ 10 triệu tới
 * 100 triệu không sát mép hay tràn ngang. Đo bằng chữ thật trong trình duyệt.
 */
test.use({ viewport: { width: 320, height: 568 } });

test.describe('Web khách: ô Điểm Xanh và Ví ở 320px', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('tubu_web_session', '1');
      } catch {
        // không có localStorage: spec vẫn chạy, chỉ không có phiên khôi phục
      }
    });
  });

  for (const c of STAT_CASES) {
    test(`${c.pointsText} một dòng, ${c.walletText} không sát mép, không tràn`, async ({ page, api }) => {
      const me = () => ({
        id: 'u-stat', fullName: 'Nguyễn Văn An', email: null, dob: null, avatarUrl: null, phone: '0912345678', role: 'CUSTOMER', referralCode: 'AN123',
        onboarded: true, segments: [], pointsBalance: c.points, pointsConvertedBalance: 0, walletBalance: c.wallet,
      });
      api.post('/auth/refresh', () => ({ accessToken: 'e2e-token', user: me() }));
      api.get('/me', () => me());
      api.get('/me/loyalty', { tier: { name: 'Hạt Giống' }, pointsBalance: c.points, pointsConvertedBalance: 0 });
      api.get('/me/coupons', [{ id: 'c1', code: 'A' }]);
      api.get('/me/notifications', []);
      api.get('/config/public', { aiAdvisorEnabled: false });
      api.get('/auth/me', () => ({ ...me(), ownsBrand: false }));
      api.get('/dealer/me', { status: 'NONE', isDealer: false });
      api.get('/orders', { data: [], meta: { page: 1, limit: 20, total: 0 } });
      api.allowUnmocked('GET /me/referral', 'GET /me/summary', 'GET /me/wallet', 'GET /brand/owner/me', 'GET /me/subscriptions', 'GET /chat/summary');
      await page.goto('/tai-khoan');
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
