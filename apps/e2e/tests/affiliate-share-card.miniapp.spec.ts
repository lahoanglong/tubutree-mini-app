import { test, expect, makeUser, mockSession } from './support/mock-api';
import { mockAffiliateDashboard } from './support/affiliate-mocks';

/**
 * Zalo Mini App E2E — thẻ chia sẻ CTV ở tab Chia sẻ (tubu-w56-01; apps/miniapp/src/pages/affiliate.tsx,
 * components/affiliate/referral-share-card.tsx). Một thẻ: mã, ưu đãi khách mới, ba số, hai nút một chạm.
 * Mock CTV_DASHBOARD: 42 lượt bấm, 5 đơn, đang chờ 60.000đ + chờ chuyển 120.000đ = 180.000đ chưa vào Ví.
 */

const VIEWPORTS = [
  { width: 320, height: 640 },
  { width: 360, height: 800 },
  { width: 375, height: 812 },
];

for (const vp of VIEWPORTS) {
  test(`thẻ chia sẻ CTV vừa khổ ${vp.width}px: ba số, hai nút >= 44px, không tràn ngang`, async ({ page, api }, testInfo) => {
    await page.setViewportSize(vp);
    mockSession(api, makeUser({ id: 'aff-1', role: 'AFFILIATE', fullName: 'Affiliate 1', referralCode: 'AFF1' }));
    mockAffiliateDashboard(api);
    await page.goto('/affiliate?tab=share');

    const card = page.getByTestId('ctv-share-card');
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card.getByTestId('ctv-share-code')).toHaveText('CTV-AFF1');
    await expect(card.getByTestId('ctv-share-offer')).toContainText('khách mới');

    const strip = card.getByTestId('ctv-metric-strip');
    await expect(strip.locator('> div')).toHaveCount(3);
    await expect(strip.getByTestId('ctv-metric-clicks')).toContainText('42');
    await expect(strip.getByTestId('ctv-metric-clicks')).toContainText('Lượt bấm');
    await expect(strip.getByTestId('ctv-metric-orders')).toContainText('5');
    await expect(strip.getByTestId('ctv-metric-orders')).toContainText('Đơn thành công');
    await expect(strip.getByTestId('ctv-metric-pending')).toContainText('180.000đ');
    await expect(strip.getByTestId('ctv-metric-pending')).toContainText('Hoa hồng chờ rút');

    for (const name of ['Chia sẻ Zalo', 'Sao chép link']) {
      const button = card.getByRole('button', { name });
      // Nhãn đủ chữ, không bị cắt thành "Chia…" (scrollWidth > clientWidth trên phần tử chứa chữ).
      const clipped = await button.evaluate((el) => Array.from(el.querySelectorAll('*')).some((n) => n.scrollWidth > n.clientWidth + 1) || el.scrollWidth > el.clientWidth + 1);
      expect(clipped, `${name} không bị cắt chữ`).toBe(false);
      const box = await button.boundingBox();
      expect(box, name).not.toBeNull();
      expect(box!.height, `${name} cao >= 44px`).toBeGreaterThanOrEqual(44);
      expect(box!.x + box!.width, `${name} nằm trong khung ${vp.width}px`).toBeLessThanOrEqual(vp.width);
    }

    // Thẻ nằm trong khung, trang không có thanh cuộn ngang.
    const cardBox = await card.boundingBox();
    expect(cardBox!.x + cardBox!.width).toBeLessThanOrEqual(vp.width);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    await card.screenshot({ path: testInfo.outputPath(`share-card-${vp.width}.png`) });
  });
}
