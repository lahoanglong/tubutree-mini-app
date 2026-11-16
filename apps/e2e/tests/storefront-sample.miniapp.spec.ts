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
});
