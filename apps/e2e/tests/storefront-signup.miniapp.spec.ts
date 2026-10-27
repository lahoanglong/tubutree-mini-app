import { test, expect, makeUser, mockSession, reply } from './support/mock-api';

/**
 * Zalo Mini App: luồng đăng ký gian hàng 4 bước (apps/miniapp/src/pages/storefront-signup.tsx), gian hàng chờ duyệt (B-40)
 * và nhãn "Gian hàng mẫu" ở trang công khai. Mọi lời gọi API đi qua mock có trạng thái.
 */

const PRODUCT = { id: 'p1', name: 'Kem dưỡng', slug: 'kem', thumbnail: null, brand: 'Tubu', basePrice: 120_000, salePrice: null };
const SF = (over: Record<string, unknown> = {}) => ({
  id: 'sf1', slug: 'aff1', type: 'CTV', title: 'Cửa hàng Xanh', headerNote: null, avatarUrl: null, coverUrl: null, theme: 'default', themeColor: null,
  subdomain: null, isPublished: false, referralCode: 'AFF1', subdomainEnabled: false, publicHiddenReason: null, status: 'DRAFT',
  collections: [], ...over,
});
const ITEM = { id: 'i1', productId: 'p1', note: null, isPinned: false, isHidden: false, sortOrder: 0, product: PRODUCT };
const WITH_ITEM = [{ id: 'c1', title: 'Chăm sóc da', kind: 'NORMAL', layout: 'GRID', comboDiscountPct: null, sortOrder: 0, items: [ITEM] }];
const EMPTY_STATS = { orders7d: 0, orders30d: 0, revenue30d: 0, commission30d: 0, byProduct: [] };

test.describe('Mini App: đăng ký gian hàng', () => {
  test('4 bước từ điều kiện tới gửi duyệt, rồi ghi Chờ duyệt thay vì Đang hiển thị', async ({ page, api }) => {
    mockSession(api, makeUser({ id: 'aff-1', role: 'AFFILIATE', fullName: 'Affiliate 1', referralCode: 'AFF1' }));
    const state = { created: false, templated: false, submitted: false };
    const current = () =>
      SF({ status: state.submitted ? 'PENDING_APPROVAL' : 'DRAFT', isPublished: state.submitted, collections: state.templated ? WITH_ITEM : [] });
    api.get('/affiliate/me', { isAffiliate: true, canRegister: true, canOpenStorefront: true, referralCode: 'AFF1', walletBalance: 0 });
    api.get('/storefront/me', () => (state.created ? current() : reply(404, { message: 'Chưa có gian hàng' })));
    api.get('/categories', [{ id: 'cat1', name: 'Chăm sóc da', slug: 'cham-soc-da', image: null }]);
    api.get('/storefront/me/products', []);
    api.get('/storefront/me/stats', EMPTY_STATS);
    api.get('/storefront/me/quests', { quests: [], totalEarnedPoints: 0, level: 0, levelMax: 5 });
    api.post('/storefront', () => {
      state.created = true;
      return current();
    });
    api.patch('/storefront/me', () => current());
    api.post('/storefront/me/apply-template', () => {
      state.templated = true;
      return { collectionId: 'c1', title: 'Chăm sóc da', itemCount: 8 };
    });
    api.post('/storefront/me/publish', () => {
      state.submitted = true;
      return current();
    });

    await page.goto('/storefront');
    await expect(page.getByText('Bước 1/4')).toBeVisible();
    await page.getByRole('button', { name: 'Bắt đầu mở gian hàng' }).click();
    await expect(page.getByText('Bước 2/4')).toBeVisible();
    await page.getByLabel('Tên gian hàng').fill('Shop của An');
    await page.getByRole('button', { name: 'Tiếp tục' }).click();
    await expect(page.getByText('Bước 3/4')).toBeVisible();
    await page.getByRole('button', { name: 'Chọn danh mục' }).click();
    await page.getByRole('button', { name: 'Dùng mẫu Chăm sóc da' }).click();
    await expect(page.getByText('Đã chọn 1 sản phẩm')).toBeVisible();
    await page.getByRole('button', { name: 'Tiếp tục' }).click();
    await expect(page.getByText('Bước 4/4')).toBeVisible();
    await expect(page.getByTestId('storefront-preview')).toBeVisible();
    await page.getByRole('button', { name: 'Gửi duyệt' }).click();
    await expect(page.getByText('Chờ duyệt').first()).toBeVisible();
    await expect(page.getByText('Đang hiển thị')).toHaveCount(0);
    expect(api.callsTo('POST', '/storefront/me/publish')[0]!.body).toEqual({ isPublished: true });
  });

  test('khách thường chưa là CTV: lối Đăng ký làm Cộng tác viên, không tạo được gian hàng', async ({ page, api }) => {
    mockSession(api, makeUser({ id: 'c-1', role: 'CUSTOMER', fullName: 'Khách', referralCode: 'KH1' }));
    api.get('/affiliate/me', { isAffiliate: false, canRegister: true, canOpenStorefront: false, walletBalance: 0 });
    api.get('/storefront/me', () => reply(404, { message: 'Chưa có gian hàng' }));
    await page.goto('/storefront');
    await expect(page.getByText('Bạn cần là Cộng tác viên trước khi mở gian hàng.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Đăng ký làm Cộng tác viên' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Bắt đầu mở gian hàng' })).toHaveCount(0);
    expect(api.callsTo('POST', '/storefront')).toHaveLength(0);
  });

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
