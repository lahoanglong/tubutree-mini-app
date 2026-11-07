import type { Page } from '@playwright/test';
import { test, expect, makeUser, mockSession } from './support/mock-api';
import { observeCls, readClsTotal } from './support/cls-observer';
import { mockLoyaltyScreen, mockAddressBook } from './support/touch-p4-mocks';
import { NARROW_WIDTHS } from './support/layout-probe';

/**
 * W40A: Cá nhân, Điểm Xanh và Sổ địa chỉ của Mini App không nhảy bố cục khi dữ liệu về muộn (CLS ≤ 0,02) ở 320 / 360 / 375px. Dự án Mini chạy WebKit, không có
 * PerformanceObserver 'layout-shift', nên spec ép Chromium (cùng cách offers-cls). Khung chờ đã vẽ xong và bộ đếm được đặt về 0 TRƯỚC khi nhả lời gọi bị giữ:
 * con số đo chỉ còn là cú nhảy lúc khung chờ đổi thành nội dung thật. API mock toàn bộ.
 */
test.use({ browserName: 'chromium' });

const resetCls = (page: Page) => page.evaluate(() => {
  const w = window as unknown as { __cls: number; __clsSrc: string[] };
  w.__cls = 0;
  w.__clsSrc = [];
});

// Lời gọi bị giữ vẫn tính là đang bay nên 'networkidle' chỉ về khi có khoảng lặng 500ms: hạn 5 giây rồi đi tiếp thay vì treo tới hết giờ.
const settle = async (page: Page) => {
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined);
  // Khung chờ chỉ có ô xám và tiêu đề serif nên Inter chưa được tải: chữ thân trang đầu tiên sẽ vẽ bằng phông dự phòng rồi đổi sang Inter, một cú nhảy của phông chứ
  // không phải của dữ liệu về muộn. Nạp Inter xong rồi mới đo (phông trong app là tệp woff2 đóng sẵn, trên máy khách nạp gần như tức thì).
  await page.evaluate(async () => {
    await Promise.all(['400', '500', '600', '700'].map((w) => document.fonts.load(`${w} 14px Inter`)));
    await document.fonts.ready;
  });
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
};

function holdOnce(): { gate: Promise<void>; release: () => void } {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  return { gate, release };
}

for (const width of NARROW_WIDTHS) {
  test.describe(`Mini App ${width}px: không nhảy bố cục khi tải (CLS ≤ 0,02)`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width, height: 760 });
      await observeCls(page);
    });

    test('Cá nhân: hạng thành viên về muộn', async ({ page, api }) => {
      const { gate, release } = holdOnce();
      mockSession(api, makeUser({ id: 'u-cls', fullName: 'Nguyễn Văn An', pointsBalance: 12_450, walletBalance: 1_250_000 }));
      api.get('/me/loyalty', async () => {
        await gate;
        return { tier: { name: 'Hạt Giống' }, pointsBalance: 12_450, pointsConvertedBalance: 0 };
      });
      api.get('/me/wallet', { walletBalance: 1_250_000 });
      api.get('/me/coupons', [{ id: 'c1', code: 'A' }]);
      api.get('/me/summary', { orders: { pending_payment: 0, processing: 0, shipping: 0, delivered: 0, closed: 0, active: 0 }, unreadNotifications: 0, activeSubscriptions: 0 });
      api.get('/me/notifications', []);
      api.allowUnmocked('GET /me/referral', 'GET /dealer/me', 'GET /auth/me', 'GET /brand/owner/me', 'GET /me/subscriptions', 'GET /chat/summary', 'POST /events');
      await page.goto('/profile');
      await expect(page.getByText('Nguyễn Văn An').first()).toBeVisible({ timeout: 15_000 });
      await settle(page);
      await expect(page.getByText('Hạt Giống')).toHaveCount(0);
      await resetCls(page);
      release();
      await expect(page.getByText('Hạt Giống').first()).toBeVisible({ timeout: 15_000 });
      const { cls, sources } = await readClsTotal(page);
      expect(cls, `CLS ${cls.toFixed(4)}: ${sources.join(' | ')}`).toBeLessThanOrEqual(0.02);
    });

    test('Điểm Xanh: hạng, quà, lịch sử về muộn', async ({ page, api }) => {
      const { gate, release } = holdOnce();
      mockLoyaltyScreen(api);
      api.get('/me/points/transactions', async () => {
        await gate;
        return [
          { id: 'p1', delta: 1_250, reason: 'ORDER_DELIVERED:TB0001', expiresAt: null, createdAt: '2026-10-10T05:00:00Z' },
          { id: 'p2', delta: -100, reason: 'REDEEM_REWARD', expiresAt: null, createdAt: '2026-10-12T05:00:00Z' },
        ];
      });
      await page.goto('/loyalty');
      await expect(page.getByText('Lộc Biếc').first()).toBeVisible({ timeout: 15_000 });
      await settle(page);
      await expect(page.getByText('+1.250')).toHaveCount(0);
      await resetCls(page);
      release();
      await expect(page.getByText('+1.250').first()).toBeVisible({ timeout: 15_000 });
      const { cls, sources } = await readClsTotal(page);
      expect(cls, `CLS ${cls.toFixed(4)}: ${sources.join(' | ')}`).toBeLessThanOrEqual(0.02);
    });

    test('Sổ địa chỉ: danh sách về muộn (khung chờ hai thẻ)', async ({ page, api }) => {
      const { gate, release } = holdOnce();
      mockAddressBook(api);
      const base = { recipient: 'Nguyễn Văn An', phone: '0912345678', street: '12 Lê Lợi', province: 'Thành phố Hồ Chí Minh', provinceCode: '84_VN79', ward: 'Phường Sài Gòn', wardCode: '84_VN79_26734' };
      api.get('/me/addresses', async () => {
        await gate;
        return [{ id: 'a1', ...base, isDefault: true }, { id: 'a2', ...base, recipient: 'Trần Thị Bích Ngọc', isDefault: false }];
      });
      await page.goto('/addresses');
      await expect(page.getByRole('heading', { name: 'Sổ địa chỉ' }).first()).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText('Mặc định', { exact: true })).toHaveCount(0);
      await settle(page);
      await resetCls(page);
      release();
      await expect(page.getByText('Mặc định', { exact: true })).toBeVisible({ timeout: 15_000 });
      const { cls, sources } = await readClsTotal(page);
      expect(cls, `CLS ${cls.toFixed(4)}: ${sources.join(' | ')}`).toBeLessThanOrEqual(0.02);
    });
  });
}
