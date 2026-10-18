import { expect, reply, test, type MockApi } from './support/mock-api';

/**
 * Web khách, cửa hàng: Trang chủ "/" như Mini App (dòng 1) và danh mục + tìm kiếm ở /san-pham (chuyển từ "/", 00-ma-tran dòng 2). Mọi lời gọi /api/** từ trình
 * duyệt đi qua mock (fixture `api`); phần Next gọi API phía server (danh sách đầu, chân trang) không mock được nên trang
 * phải tự tải lại phía trình duyệt khi server không có dữ liệu — spec này dựa vào đúng điều đó. Host phải là localhost.
 */

const product = (n: number, over: Record<string, unknown> = {}) => ({
  id: `p${n}`, slug: `sp-${n}`, brand: 'Tubu', name: `Sản phẩm ${n}`, thumbnail: null, basePrice: 100000 + n,
  salePrice: null, isFeatured: false, inStock: true, ...over,
});
const pageOf = (data: unknown[], total: number, page = 1, limit = 24) => ({ data, meta: { page, limit, total } });

function mockCatalog(api: MockApi) {
  api.get('/categories', [
    { id: 'c-goi', parentId: null, name: 'Dầu gội', slug: 'dau-goi', image: null, sortOrder: 1, productCount: 4 },
    { id: 'c-xa', parentId: null, name: 'Xà phòng', slug: 'xa-phong', image: null, sortOrder: 2, productCount: 2 },
  ]);
  api.get('/brands', [{ brand: 'Tubu', count: 3 }, { brand: 'Mộc An', count: 2 }]);
  api.get('/flash-sales/active', []);
  api.get('/search/suggest', [{ slug: 'nuoc-rua-chen', name: 'Nước rửa chén', thumbnail: null, basePrice: 65000 }]);
}

test.describe('Web khách: danh mục /san-pham', () => {
  test('link cũ /?q= chuyển 307 sang /san-pham giữ nguyên query', async ({ page, api }) => {
    mockCatalog(api);
    api.get('/products', pageOf([product(1)], 1));
    await page.goto('/?q=dau+goi&utm_source=zalo');
    await expect(page).toHaveURL(/\/san-pham\?q=dau\+goi&utm_source=zalo/);
    await expect(page.getByRole('heading', { level: 1, name: 'Khám phá' })).toBeVisible();
    const call = (await api.waitForCall('GET', '/products')).query;
    expect(call.get('q')).toBe('dau goi');
  });

  test('lưới danh mục, sắp xếp và bộ lọc ghi vào URL và gọi API đúng tham số', async ({ page, api }) => {
    mockCatalog(api);
    api.get('/products', ({ call }) => {
      if (call.query.get('limit') === '1') return pageOf([product(1)], 5, 1, 1);
      return pageOf([product(1), product(2)], 2);
    });
    await page.goto('/san-pham');
    await expect(page.getByText('Sản phẩm 1')).toBeVisible();

    await page.getByRole('button', { name: 'Dầu gội' }).click();
    await expect(page).toHaveURL(/\/san-pham\?category=c-goi$/);
    await expect(page.getByRole('region', { name: 'Danh mục' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Giá tăng' }).click();
    await expect(page).toHaveURL(/category=c-goi&sort=price_asc/);

    await page.getByRole('button', { name: 'Bộ lọc' }).click();
    const dialog = page.getByRole('dialog', { name: 'Bộ lọc' });
    await dialog.getByRole('button', { name: 'Chỉ hiện còn hàng' }).click();
    await dialog.getByRole('button', { name: 'Từ 4★ trở lên' }).click();
    await dialog.getByRole('button', { name: 'Xem 5 sản phẩm' }).click();
    await expect(page).toHaveURL(/inStock=1&rating=4&sort=price_asc/);

    const last = api.callsTo('GET', '/products').at(-1)!.query;
    expect(last.get('category')).toBe('c-goi');
    expect(last.get('inStock')).toBe('true');
    expect(last.get('minRating')).toBe('4');
    expect(last.get('sort')).toBe('price_asc');
    await expect(page.getByRole('button', { name: 'Bộ lọc (2)' })).toBeVisible();
  });

  test('gõ hiện gợi ý sản phẩm; Enter ghi từ khoá vào URL; tìm không ra thì nói rõ', async ({ page, api }) => {
    mockCatalog(api);
    api.get('/products', ({ call }) => (call.query.get('q') === 'xyz' ? pageOf([], 0) : pageOf([product(1)], 1)));
    await page.goto('/san-pham');
    const input = page.getByRole('searchbox', { name: 'Tìm sản phẩm' });
    await input.fill('nước');
    await expect(page.getByRole('button', { name: /Nước rửa chén/ })).toBeVisible();
    await expect(page).toHaveURL(/\/san-pham$/);

    await input.fill('xyz');
    await input.press('Enter');
    await expect(page).toHaveURL(/\/san-pham\?q=xyz$/);
    await expect(page.getByText('Không tìm thấy "xyz"')).toBeVisible();
    await page.getByRole('button', { name: 'Xoá tìm kiếm & bộ lọc' }).click();
    await expect(page).toHaveURL(/\/san-pham$/);
  });

  test('"Xem thêm" tải trang kế và nối vào danh sách', async ({ page, api }) => {
    mockCatalog(api);
    api.get('/products', ({ call }) =>
      call.query.get('page') === '2' ? pageOf([product(3)], 3, 2, 2) : pageOf([product(1), product(2)], 3, 1, 2),
    );
    await page.goto('/san-pham');
    await expect(page.getByText('Sản phẩm 2')).toBeVisible();
    await page.getByRole('button', { name: 'Xem thêm' }).click();
    await expect(page.getByText('Sản phẩm 3')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Xem thêm' })).toHaveCount(0);
  });

  test('điện thoại 320px: không cuộn ngang kể cả khi đang mở gợi ý', async ({ page, api }) => {
    mockCatalog(api);
    api.get('/products', pageOf([product(1)], 1));
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto('/san-pham');
    await expect(page.getByText('Sản phẩm 1')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await page.getByRole('searchbox', { name: 'Tìm sản phẩm' }).fill('nước');
    await expect(page.getByRole('button', { name: /Nước rửa chén/ })).toBeVisible();
    const withSuggest = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(withSuggest).toBeLessThanOrEqual(0);
  });
});

const PURCHASED = {
  variationId: 'v1', productId: 'p1', slug: 'nuoc-rua-chen', productName: 'Nước rửa chén', variationName: 'Chanh', brand: 'Tubu',
  thumbnail: null, price: 65000, salePrice: null, stock: 8, inStock: true, timesBought: 2, lastPurchasedAt: '2026-09-10T00:00:00.000Z',
};

function mockHome(api: MockApi) {
  mockCatalog(api);
  api.get('/products', ({ call }) => {
    const sort = call.query.get('sort');
    if (sort === 'best_seller') return pageOf([product(1, { name: 'Bán chạy nhất' })], 1, 1, 6);
    if (sort === 'newest') return pageOf([product(2, { name: 'Hàng mới nhất' })], 1, 1, 6);
    return pageOf([product(3, { name: 'Sản phẩm nổi bật' })], 1, 1, 12);
  });
  api.get('/config/public', { freeshipThreshold: 350000, subscribeDiscountPct: 0.12, loyalty: { vndPerPoint: 50, vndPerPointRedeem: 1000 } });
  api.get('/flash-sales/active', []);
}

function mockCustomer(api: MockApi) {
  const user = {
    id: 'u1', fullName: 'Nguyễn Văn An', referralCode: 'AN123', phone: '0912345678', role: 'CUSTOMER',
    pointsBalance: 60, pointsConvertedBalance: 0, walletBalance: 0,
  };
  api.post('/auth/refresh', () => ({ accessToken: 'e2e-token', user }));
  api.get('/me/notifications', [{ id: 'n1', status: 'SENT' }, { id: 'n2', status: 'SENT' }]);
  api.get('/me/purchased-items', { items: [PURCHASED], nextCursor: null });
  api.get('/products/for-you', [product(9, { name: 'Gợi ý riêng' })]);
  api.get('/orders/active-count', { count: 0 });
  api.get('/me/subscriptions', []);
  api.get('/me/new-customer-offer', { isNewCustomer: false, welcomeVoucher: null });
  api.get('/flash-sales/upcoming', []);
}

test.describe('Web khách: Trang chủ /', () => {
  test('khách vãng lai: ba lưới công khai, ô tìm sang /san-pham?focus=search, danh mục sang /san-pham?category=', async ({ page, api }) => {
    mockHome(api);
    await page.goto('/');
    await expect(page.getByRole('region', { name: 'Bán chạy' }).getByText('Bán chạy nhất')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Mới về vườn' }).getByText('Hàng mới nhất')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Dành cho bạn' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /^Thông báo/ })).toHaveCount(0);
    expect(api.callsTo('GET', '/me/purchased-items')).toHaveLength(0);

    await page.getByRole('button', { name: 'Dầu gội' }).click();
    await expect(page).toHaveURL(/\/san-pham\?category=c-goi$/);
    await page.goBack();
    await page.getByRole('link', { name: 'Bạn đang tìm gì hôm nay?' }).click();
    await expect(page).toHaveURL(/\/san-pham(\?focus=search)?$/);
  });

  test('khách cũ đã đăng nhập: chuông có số chưa đọc, Mua lại gửi POST /cart/items addSource repurchase rồi sang giỏ', async ({ page, api }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('tubu_web_session', '1');
      } catch {
        // không có localStorage: spec vẫn chạy, chỉ không có phiên khôi phục
      }
    });
    mockHome(api);
    mockCustomer(api);
    api.post('/cart/items', { items: [], couponCode: null, subtotal: 65000, discount: 0, freeship: false, freeshipThreshold: 350000, itemCount: 1 });
    api.get('/cart', { items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 350000, itemCount: 0 });

    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Thông báo, 2 chưa đọc' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Dành cho bạn' }).getByText('Gợi ý riêng')).toBeVisible();
    const rail = page.getByRole('region', { name: 'Mua lại' });
    await expect(rail.getByText('Đã mua 2 lần')).toBeVisible();

    await rail.getByRole('button', { name: 'Mua lại' }).click();
    await page.getByRole('dialog', { name: 'Mua lại' }).getByRole('button', { name: 'Thêm vào giỏ (1)' }).click();
    const added = (await api.waitForCall('POST', '/cart/items')).body;
    expect(added).toEqual({ variationId: 'v1', quantity: 1, addSource: 'repurchase' });
    await expect(page).toHaveURL(/\/gio-hang/);
  });

  test('API sản phẩm sập hẳn: một dải lỗi cấp trang, Thử lại tải lại và hiện sản phẩm', async ({ page, api }) => {
    mockCatalog(api);
    api.get('/config/public', { freeshipThreshold: 350000, subscribeDiscountPct: 0.12 });
    let down = true;
    api.get('/products', () => (down ? reply(503, { message: 'Máy chủ đang bận' }) : pageOf([product(1, { name: 'Bán chạy nhất' })], 1, 1, 6)));
    await page.goto('/');
    const banner = page.getByRole('region', { name: 'Chưa tải được Trang chủ' });
    await expect(banner).toBeVisible();
    await expect(page.getByTestId('home-block-error')).toHaveCount(0);
    down = false;
    await banner.getByRole('button', { name: 'Thử lại' }).click();
    await expect(page.getByText('Bán chạy nhất').first()).toBeVisible();
    await expect(banner).toHaveCount(0);
  });

  test('điện thoại 320px: không cuộn ngang', async ({ page, api }) => {
    mockHome(api);
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto('/');
    await expect(page.getByText('Bán chạy nhất')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
