import { expect, test } from './support/mock-api';
import { mockCollectable, mockCollectableMine, mockCouponHistory, mockWallet } from './support/voucher-mocks';
import { COLLECT_TICKETS, LONG_NAME, WALLET_TICKETS, expectButtonsStable, expectCompactTickets, expectNameVisibleWhole } from './support/voucher-ticket-checks';

/**
 * Web khổ 375px, Mã giảm giá (/ma-giam-gia): phiếu cao đúng như Mini App (voucher-ticket-height.miniapp.spec.ts, cùng bộ mock): 88px phiếu trơn, 98px phiếu có tên ngắn, 138px phiếu tên 40 ký tự có hàng đáy gãy;
 * nhãn một dòng, tên tối đa hai dòng, nút chính nằm trọn trong phiếu, một cách ghi số. Mọi lời gọi từ trình duyệt đi qua mock; trang không gọi API ở máy chủ nên không cần dữ liệu e2e.
 * Host phải là localhost (baseURL).
 */
const user = {
  id: 'u1', fullName: 'Nguyễn Văn An', referralCode: 'AN123', phone: '0912345678', role: 'CUSTOMER',
  pointsBalance: 0, pointsConvertedBalance: 0, walletBalance: 0,
};

test.describe('Web khổ 375px: phiếu mã giảm giá cao như Mini App', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test.beforeEach(async ({ page, api }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('tubu_web_session', '1');
      } catch {
        // không có localStorage: spec vẫn chạy, chỉ không có phiên khôi phục
      }
    });
    api.post('/auth/refresh', () => ({ accessToken: 'e2e-token', user }));
    api.get('/me', () => user);
    mockCollectable(api, COLLECT_TICKETS as never);
    mockCollectableMine(api, { claimed: [], newCustomerOnly: [] });
    mockWallet(api, WALLET_TICKETS as never);
    mockCouponHistory(api);
    api.allowUnmocked('GET /affiliate/me', 'GET /me/wishlist/ids', 'GET /cart', 'POST /events', 'GET /notifications/unread-count');
  });

  test('Mã của tôi: phiếu 88 đến 96px (hàng đáy gãy thì 104px), nhãn một dòng, không trộn cách ghi số', async ({ page }) => {
    await page.goto('/ma-giam-gia?tab=mine');
    const panel = page.getByRole('tabpanel', { name: 'Mã của tôi' });
    await expectCompactTickets(panel.getByRole('group'), WALLET_TICKETS.length);
    await expectNameVisibleWhole(panel);
    await expectButtonsStable(panel.getByRole('group'));
  });

  test('Nhận mã: phiếu có tên, mã dài và "Còn 3 lượt" vẫn trong khung 104px, cạnh phiếu trơn chênh không quá 16px', async ({ page }) => {
    await page.goto('/ma-giam-gia');
    const panel = page.getByRole('tabpanel', { name: 'Nhận mã' });
    await expectCompactTickets(panel.getByRole('group'), COLLECT_TICKETS.length);
    await expectNameVisibleWhole(panel);
  });

  test('Nhận mã: tên admin 40 ký tự xuống tối đa hai dòng, nút "Lưu mã" giữ cỡ và nằm trọn trong phiếu', async ({ page }) => {
    await page.goto('/ma-giam-gia');
    const panel = page.getByRole('tabpanel', { name: 'Nhận mã' });
    const groups = panel.getByRole('group');
    await expect(groups).toHaveCount(COLLECT_TICKETS.length, { timeout: 15_000 });
    const name = panel.getByTestId('voucher-name').filter({ hasText: LONG_NAME }).first();
    await expect(name).toBeVisible();
    const box = (await name.boundingBox())!;
    expect(box.height, `tên cao ${box.height}px`).toBeGreaterThan(24);
    expect(box.height, `tên cao ${box.height}px`).toBeLessThanOrEqual(41);
    const metaW = (await name.locator('xpath=following-sibling::*[@data-testid="voucher-meta"]').boundingBox())!.width;
    expect(box.width, `tên rộng ${box.width}px, điều kiện ${metaW}px`).toBeGreaterThan(140);
    await expectButtonsStable(groups);
  });
});
