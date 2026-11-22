import { test, expect, makeUser, mockSession } from './support/mock-api';

/**
 * Zalo Mini App: nhãn "Gian hàng mẫu" ở trang gian hàng công khai (`/s/:slug`). Luồng đăng ký gian hàng 4 bước và gian hàng chờ duyệt (B-40)
 * đã chuyển sang web từ W177 (`/storefront` ở Mini App là thẻ chuyển web). Mọi lời gọi API đi qua mock có trạng thái.
 */

const PRODUCT = { id: 'p1', name: 'Kem dưỡng', slug: 'kem', thumbnail: null, brand: 'Tubu', basePrice: 120_000, salePrice: null };

test.describe('Mini App: gian hàng mẫu', () => {
  test('gian hàng mẫu: khách thấy nhãn Gian hàng mẫu và dòng giải thích', async ({ page, api }) => {
    mockSession(api, makeUser({ id: 'c-1', role: 'CUSTOMER', fullName: 'Khách', referralCode: 'KH1' }));
    api.get('/me/wishlist/ids', []);
    api.post('/affiliate/touch', { ok: true });
    api.get('/flash-sales/active', []);
    api.get('/storefront/public/:slug', {
      id: 'sf9', slug: 'mebimla', type: 'CTV', approved: true, isSample: true, title: 'Mẹ bỉm lười', headerNote: 'Đồ mình đã dùng thật',
      avatarUrl: null, coverUrl: null, themeColor: null, referralCode: 'SAMPLE-MEBIMLA',
      collections: [{ id: 'c1', title: 'Cho bé', items: [{ id: 'i1', note: null, product: { ...PRODUCT, ratingAvg: null, reviewCount: 0, sold: 0, thumbnail: null } }] }],
    });
    await page.goto('/s/mebimla');
    await expect(page.getByText('Gian hàng mẫu').first()).toBeVisible();
    await expect(page.getByTestId('sample-note')).toContainText('không phải người bán thật');
  });

  // 375px: tối đa hai hàng như web; 320px được xuống hàng thứ ba nhưng không tràn ngang.
  for (const [width, maxRows] of [[320, 3], [375, 2]] as const) {
    test(`dải cam kết ${width}px: 4 chip chữ ngắn, tối đa ${maxRows} hàng, không tràn ngang`, async ({ page, api }) => {
      await page.setViewportSize({ width, height: 800 });
      mockSession(api, makeUser({ id: 'c-1', role: 'CUSTOMER', fullName: 'Khách', referralCode: 'KH1' }));
      api.get('/me/wishlist/ids', []);
      api.post('/affiliate/touch', { ok: true });
      api.get('/flash-sales/active', []);
      api.get('/storefront/public/:slug', {
        id: 'sf1', slug: 'chi-lan', type: 'CTV', approved: true, isSample: false, title: 'Góc xanh của Lan', headerNote: null,
        avatarUrl: null, coverUrl: null, themeColor: null, referralCode: 'LAN1',
        collections: [{ id: 'c1', title: 'Bếp', items: [{ id: 'i1', note: null, product: { ...PRODUCT, ratingAvg: null, reviewCount: 0, sold: 0, thumbnail: null } }] }],
      });
      await page.goto('/s/chi-lan');
      const trust = page.getByTestId('storefront-trust');
      await expect(trust.getByRole('heading', { name: 'Cam kết của gian hàng' })).toBeAttached();
      const chips = trust.getByRole('listitem');
      await expect(chips).toHaveText(['Hàng đã qua duyệt', 'Theo dõi đơn', 'Thanh toán qua Tubu', 'Đổi trả nếu lỗi']);
      const tops = new Set(await chips.evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top))));
      expect(tops.size).toBeLessThanOrEqual(maxRows);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
  }
});
