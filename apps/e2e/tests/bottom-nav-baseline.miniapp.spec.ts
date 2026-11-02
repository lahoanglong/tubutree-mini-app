import { mkdirSync } from 'node:fs';
import { test, expect } from './support/mock-api';
import { mockDiscovery } from './support/discovery-mocks';
import { MAX_BASELINE_DRIFT_PX, tabLabelBottoms } from './support/nav-baseline';

/** Mini App 375x812: nhãn của cả 5 tab (kể cả "Vườn Xanh" ở tab giữa nổi) cùng đường chân chữ, lệch tối đa 0,5 px. Đặt SHOT_DIR để chụp ảnh. */
test.describe('Mini App — thanh đáy: đường chân chữ nhãn tab', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('cả 5 nhãn có đáy chữ lệch tối đa 0,5 px (có badge đơn đang xử lý)', async ({ page, api }) => {
    mockDiscovery(api, { returning: true, shipping: true });
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Điều hướng chính' });
    await expect(nav).toBeVisible({ timeout: 15_000 });
    await page.waitForLoadState('networkidle');
    const dir = process.env.SHOT_DIR;
    if (dir) {
      mkdirSync(dir, { recursive: true });
      await page.screenshot({ path: `${dir}/mini375-trang-chu.png` });
      await nav.screenshot({ path: `${dir}/mini375-thanh-day.png` });
    }
    const bottoms = await tabLabelBottoms(nav);
    console.log(`NAV_BASELINE_MINI ${JSON.stringify(bottoms)}`);
    expect(bottoms.map((b) => b.text)).toEqual(['Trang chủ', 'Danh mục', 'Vườn Xanh', 'Ưu đãi', 'Cá nhân']);
    const values = bottoms.map((b) => b.bottom);
    expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(MAX_BASELINE_DRIFT_PX);
  });
});
