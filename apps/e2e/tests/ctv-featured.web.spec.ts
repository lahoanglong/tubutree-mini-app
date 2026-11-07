import { expect, reply, test, type MockApi } from './support/mock-api';
import { expectPressFeedback, probeTapTargets } from './support/touch-probe';
import { FEATURED_PICKER, FEATURED_REF, W43B_SIZES, expectFeaturedBlock, expectFeaturedCopy, stubClipboard } from './support/wave43b';

/**
 * W43B: bảng điều khiển CTV của web (/ctv), ở 375×812 và 1440×900: huy hiệu bậc ở thẻ tiền và khối "Sản phẩm hoa hồng nổi bật" ở tab Chia sẻ
 * (xếp theo tiền hoa hồng, nút Chép link giới thiệu chép link có ?ref=). Chạy Chromium (phép đo hệ số co chập chờn trên WebKit Linux của CI). Mọi lời gọi /api/** đi qua mock.
 */
test.use({ browserName: 'chromium' });

const USER = { id: 'u1', fullName: 'Nguyễn Văn An', referralCode: FEATURED_REF, phone: '0912345678', role: 'CUSTOMER', pointsBalance: 0, walletBalance: 0 };
const TIER = { name: 'Hạt Giống', emoji: '🌱', nextName: null, nextThreshold: null, toNext: 0 };
const DASH = {
  todayCommission: 5_000, monthCommission: 125_000, pendingCommission: 30_000, withdrawableCommission: 80_000, withdrawingCommission: 0,
  totalClicks: 4, totalConversions: 1, monthRevenue: 0, tier: TIER,
};

function mockCtv(api: MockApi, picker: () => unknown = () => FEATURED_PICKER) {
  api.post('/auth/refresh', () => ({ accessToken: 'e2e-token', user: USER }));
  api.get('/me', () => USER);
  api.get('/config/public', { freeshipThreshold: 500000, waste: { enabled: false, dropoff: false, mailin: false, pickup: false } });
  api.get('/affiliate/me', { isAffiliate: true, referralCode: FEATURED_REF, walletBalance: 0 });
  api.get('/affiliate/tiers', { revenue: 0, tier: TIER, allTiers: [{ name: 'Hạt Giống', emoji: '🌱', min: 0, milestoneRewardPoints: null }] });
  api.get('/affiliate/milestones', { monthKey: '2026-10', currentRevenue: 0, pendingRevenue: 0, holdDays: 20, milestones: [], previousMonth: null });
  api.get('/affiliate/analytics/storefronts', { storefronts: [] });
  api.get('/affiliate/analytics/products', []);
  api.get('/academy/courses', []);
  api.get('/me/wallet', { walletBalance: 0, cashbackPending: 0, commissionApproved: 80_000, commissionPending: 30_000 });
  api.get('/affiliate/dashboard', DASH);
  api.get('/affiliate/links', []);
  api.get('/affiliate/commissions', []);
  api.get('/affiliate/payouts', []);
  api.get('/affiliate/tax-statement', { year: 2026, fullName: null, taxId: null, items: [], totals: { grossAmount: 0, taxWithheld: 0, netAmount: 0 } });
  api.get('/storefront/me/products', picker);
}

for (const size of W43B_SIZES) {
  test.describe(`Web CTV hoa hồng nổi bật ${size.width}×${size.height}`, () => {
    test.beforeEach(async ({ page, browserName }, testInfo) => {
      test.skip(testInfo.project.name !== 'Web Customer Mobile', 'Khổ do spec tự đặt: một project là đủ');
      expect(browserName, 'spec nhấn giữ phải chạy Chromium').toBe('chromium');
      await page.setViewportSize(size);
      await page.addInitScript(() => {
        try {
          localStorage.setItem('tubu_web_session', '1');
        } catch {
          // không có localStorage: spec vẫn chạy, chỉ không có phiên khôi phục
        }
      });
    });

    test('thẻ tiền: huy hiệu bậc cạnh nhãn, số tiền dùng số đều', async ({ page, api }) => {
      mockCtv(api);
      await page.goto('/ctv');
      await expect(page.getByRole('heading', { name: 'Cộng tác viên', level: 1 })).toBeVisible();
      const amount = page.getByText('80.000đ', { exact: true }).first();
      await expect(amount).toBeVisible();
      expect(await amount.evaluate((el) => getComputedStyle(el).fontVariantNumeric)).toContain('tabular-nums');
      await expect(page.getByTestId('ctv-hero-tier')).toContainText('CTV Hạt Giống');
    });

    test('tab Chia sẻ: hai dòng xếp theo tiền hoa hồng, nút Chép link đủ 44px', async ({ page, api }) => {
      mockCtv(api);
      await page.goto('/ctv');
      await page.getByRole('tab', { name: 'Chia sẻ', exact: true }).click();
      const block = await expectFeaturedBlock(page);
      expect(await probeTapTargets(page, { scope: '[data-testid="ctv-featured"]' })).toEqual([]);
      await expectPressFeedback(page, block.getByTestId('ctv-featured-row').nth(0).getByRole('button'), 'nút Chép link giới thiệu');
    });

    test('chạm Chép link giới thiệu: clipboard có link ?ref= của CTV, nhãn Đã chép link rồi tự trả về', async ({ page, api }) => {
      await stubClipboard(page);
      mockCtv(api);
      await page.goto('/ctv');
      await page.getByRole('tab', { name: 'Chia sẻ', exact: true }).click();
      const block = await expectFeaturedBlock(page);
      await expectFeaturedCopy(page, block);
    });

    test('tải danh sách lỗi: lời báo và nút Thử lại; thử lại được thì hiện danh sách', async ({ page, api }) => {
      let failing = true;
      mockCtv(api, () => (failing ? reply(500, { message: 'Lỗi máy chủ', statusCode: 500 }) : FEATURED_PICKER));
      await page.goto('/ctv');
      await page.getByRole('tab', { name: 'Chia sẻ', exact: true }).click();
      const block = page.getByTestId('ctv-featured');
      await expect(block.getByRole('alert')).toContainText('Chưa tải được danh sách sản phẩm.', { timeout: 30_000 });
      failing = false;
      await block.getByRole('button', { name: 'Thử lại' }).click();
      await expectFeaturedBlock(page);
    });
  });
}
