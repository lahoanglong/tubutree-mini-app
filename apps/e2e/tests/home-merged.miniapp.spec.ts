import { test, expect } from './support/mock-api';
import { mockDiscovery } from './support/discovery-mocks';
import { HOME_ME, MERGED_FOR_YOU, MERGED_PURCHASED, lonePersonalCalls, mockMergedHome } from './support/home-merged';

/** Mini App: Trang chủ mở bằng GET /home + GET /home/me (mock đúng dạng API thật), hiện đủ khối và không gọi các endpoint lẻ đã gộp. */
test.describe('Trang chủ — request gộp', () => {
  test('mở Trang chủ: đủ khối từ /home + /home/me, không gọi endpoint lẻ đã gộp', async ({ page, api }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    mockDiscovery(api, { returning: true });
    mockMergedHome(api);
    await page.goto('/');
    await expect(page.getByRole('region', { name: 'Mua lại' }).getByText(MERGED_PURCHASED)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('region', { name: 'Thẻ thành viên' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Danh mục', exact: true }).getByText('Danh mục gộp')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Gợi ý cho bạn' }).getByText(MERGED_FOR_YOU)).toBeVisible();
    expect(api.callsTo('GET', '/home')).toHaveLength(1);
    const me = api.callsTo('GET', '/home/me');
    expect(me).toHaveLength(1);
    expect(me[0]!.query.get('purchasedLimit')).toBe(String(HOME_ME.purchasedLimit));
    expect(api.callsTo('GET', '/categories')).toHaveLength(0);
    // Request lẻ nổ muộn (sau khi nội dung đã hiện) vẫn phải bị bắt: chờ mạng yên rồi mới kiểm.
    await page.waitForLoadState('networkidle');
    expect(lonePersonalCalls(api)).toEqual([]);
  });
});
