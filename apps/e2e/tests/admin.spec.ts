import { test, expect } from '@playwright/test';

/**
 * Web Admin Dashboard E2E
 * API thực tế: /api/admin/dealer-applications (xem admin-client.ts)
 * Auth: Web dùng /api/auth/refresh để lấy session
 */
test.describe('Web Admin Dashboard E2E - Luồng Duyệt Đại Lý', () => {
  test.beforeEach(async ({ page }) => {
    // 1. Mock auth/refresh → trả về token Admin hợp lệ
    await page.route('**/api/auth/refresh', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          accessToken: 'mock-admin-access-token',
          refreshToken: 'mock-admin-refresh-token',
          user: { id: 'admin-1', role: 'ADMIN', fullName: 'Test Admin', phone: '0909000000' },
        }),
      });
    });

    // 2. Mock danh sách đại lý PENDING — URL thực tế: /api/admin/dealer-applications?status=PENDING
    await page.route('**/api/admin/dealer-applications*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 'dealer-123',
            businessName: 'Tạp hoá Cô Lan',
            ownerName: 'Nguyễn Thị Lan',
            phone: '0901234567',
            address: '123 Đường A, Quận 1',
            taxCode: null,
            cccdFrontUrl: '',
            cccdBackUrl: '',
            status: 'PENDING',
            createdAt: new Date().toISOString(),
          },
        ]),
      });
    });

    // 3. Navigate tới /admin — PHẢI set localStorage trước để auth-context.tsx
    //    đọc được refresh token (key: tubu_web_refresh) và gọi /api/auth/refresh
    await page.goto('/admin');
    // Inject refresh token vào localStorage rồi reload để AuthProvider khởi động lại
    await page.evaluate(() => {
      localStorage.setItem('tubu_web_refresh', 'mock-admin-refresh-token');
    });
    await page.reload();
  });

  test('Hiển thị và Duyệt hồ sơ Đại lý', async ({ page }) => {
    // Chờ tên doanh nghiệp và thông tin chủ hiển thị trong DealersTab
    await expect(page.locator('text=Tạp hoá Cô Lan')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=Nguyễn Thị Lan · 0901234567')).toBeVisible();

    // Mock API duyệt hồ sơ — POST /api/admin/dealer-applications/:id/review
    let reviewCalled = false;
    await page.route('**/api/admin/dealer-applications/dealer-123/review', async (route) => {
      reviewCalled = true;
      const payload = route.request().postDataJSON() as { approve: boolean; tierId?: string };
      expect(payload.approve).toBe(true);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
    });

    // Điền Tier ID rồi bấm Duyệt
    await page.fill('input[placeholder*="Tier"]', 'dealer_l1');
    await page.click('button:has-text("Duyệt")');

    // Đợi một chút để mutation hoàn thành
    await page.waitForTimeout(500);
    expect(reviewCalled).toBe(true);
  });
});
