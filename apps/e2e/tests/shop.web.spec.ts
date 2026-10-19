import type { Page } from '@playwright/test';
import { expect, makeUser, mockSession, reply, test, type MockApi } from './support/mock-api';

/**
 * Web khách, cửa hàng: Trang chủ "/" như Mini App (dòng 1) và danh mục + tìm kiếm ở /san-pham (chuyển từ "/", 00-ma-tran dòng 2). Mọi lời gọi /api/** từ trình
 * duyệt đi qua mock (fixture `api`); phần Next gọi API phía server (danh sách đầu, chân trang) không mock được và trả dữ liệu
 * thật của DB e2e đã seed, React Query coi dữ liệu đó còn tươi (staleTime 60s) nên không tải lại. `refetchStale` đẩy đồng hồ
 * trình duyệt đi xa rồi giả lập mất/có mạng để các truy vấn đó tải lại qua mock. Host phải là localhost.
 */

const product = (n: number, over: Record<string, unknown> = {}) => ({
  id: `p${n}`, slug: `sp-${n}`, brand: 'Tubu', name: `Sản phẩm ${n}`, thumbnail: null, basePrice: 100000 + n,
  salePrice: null, isFeatured: false, inStock: true, ...over,
});
const pageOf = (data: unknown[], total: number, page = 1, limit = 24) => ({ data, meta: { page, limit, total } });

/** Làm dữ liệu SSR hết tươi rồi kích tải lại khi có mạng trở lại; lặp tới khi mock nhận được lời gọi (có thể chạy trước lúc hydrate xong). */
async function refetchStale(page: Page, api: MockApi, method: string, pattern: string) {
  await expect
    .poll(async () => {
      await page.evaluate(() => {
        const w = window as unknown as { __tubuClockShifted?: boolean };
        if (!w.__tubuClockShifted) {
          w.__tubuClockShifted = true;
          const real = Date.now.bind(Date);
          Date.now = () => real() + 10 * 60_000;
        }
        window.dispatchEvent(new Event('offline'));
        window.dispatchEvent(new Event('online'));
      });
      return api.callsTo(method, pattern).length;
    })
    .toBeGreaterThan(0);
}

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
    await refetchStale(page, api, 'GET', '/products');
    await expect(page).toHaveURL(/\/san-pham\?q=dau(\+|%20)goi&utm_source=zalo/);
    await expect(page.getByRole('heading', { level: 1, name: 'Khám phá' })).toBeVisible();
    const call = api.callsTo('GET', '/products').at(-1)!.query;
    expect(call.get('q')).toBe('dau goi');
  });

  test('lưới danh mục, sắp xếp và bộ lọc ghi vào URL và gọi API đúng tham số', async ({ page, api }) => {
    mockCatalog(api);
    api.get('/products', ({ call }) => {
      if (call.query.get('limit') === '1') return pageOf([product(1)], 5, 1, 1);
      return pageOf([product(1), product(2)], 2);
    });
    await page.goto('/san-pham');
    await refetchStale(page, api, 'GET', '/categories');
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
    await refetchStale(page, api, 'GET', '/products');
    await expect(page.getByRole('region', { name: 'Bán chạy' }).getByText('Bán chạy nhất')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Mới về vườn' }).getByText('Hàng mới nhất')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Dành cho bạn' })).toHaveCount(0);
    // Điện thoại: chuông hiện cả với khách như Mini App (trang Thông báo tự đòi đăng nhập); máy tính không có chuông cho khách.
    const phone = (page.viewportSize()?.width ?? 1280) < 768;
    await expect(page.getByRole('link', { name: /^Thông báo/ })).toHaveCount(phone ? 1 : 0);
    expect(api.callsTo('GET', '/me/purchased-items')).toHaveLength(0);

    await page.getByRole('button', { name: 'Dầu gội' }).click();
    await expect(page).toHaveURL(/\/san-pham\?category=c-goi$/);
    await page.goBack();
    if (phone) {
      await page.getByRole('link', { name: 'Bạn đang tìm gì hôm nay?' }).click();
      await expect(page).toHaveURL(/\/san-pham(\?focus=search)?$/);
    } else {
      // Máy tính chỉ giữ ô tìm của thanh đầu website; ô vỏ ở trang chủ chỉ có ở điện thoại.
      await expect(page.getByRole('link', { name: 'Bạn đang tìm gì hôm nay?' })).toHaveCount(0);
    }
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
    await refetchStale(page, api, 'GET', '/products');
    await expect(page.getByRole('link', { name: 'Thông báo, 2 chưa đọc' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Dành cho bạn' }).getByText('Gợi ý riêng')).toBeVisible();
    const rail = page.getByRole('region', { name: 'Mua lại' });
    await expect(rail.getByText('Đã mua 2 lần')).toBeVisible();

    await rail.getByRole('button', { name: 'Mua lại' }).click();
    const addedCall = api.waitForCall('POST', '/cart/items');
    await page.getByRole('dialog', { name: 'Mua lại' }).getByRole('button', { name: 'Thêm vào giỏ (1)' }).click();
    const added = (await addedCall).body;
    expect(added).toEqual({ variationId: 'v1', quantity: 1, addSource: 'repurchase' });
    await expect(page).toHaveURL(/\/gio-hang/);
  });

  test('API sản phẩm sập sau khi server đã có dữ liệu: lưới giữ nguyên, không hiện dải lỗi cấp trang', async ({ page, api }) => {
    // Dải lỗi cấp trang chỉ hiện khi cả ba lưới chưa từng có dữ liệu (home-view pageDown); trang SSR luôn mang sẵn dữ liệu thật của DB e2e nên
    // trường hợp "sập hẳn từ đầu" chỉ kiểm được ở vitest (home-parts.spec), không dựng lại được qua mock phía trình duyệt.
    mockCatalog(api);
    api.get('/config/public', { freeshipThreshold: 350000, subscribeDiscountPct: 0.12 });
    api.get('/products', () => reply(503, { message: 'Máy chủ đang bận' }));
    await page.goto('/');
    await expect(page.getByRole('region', { name: 'Bán chạy' })).toBeVisible();
    await refetchStale(page, api, 'GET', '/products');
    await expect.poll(() => api.callsTo('GET', '/products').length).toBeGreaterThanOrEqual(6);
    await expect(page.getByRole('region', { name: 'Chưa tải được Trang chủ' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Bán chạy' })).toBeVisible();
  });

  test('điện thoại 320px: không cuộn ngang', async ({ page, api }) => {
    mockHome(api);
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto('/');
    await refetchStale(page, api, 'GET', '/products');
    await expect(page.getByText('Bán chạy nhất')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

/**
 * Trang sản phẩm /san-pham/[slug] (00-ma-tran dòng 3). Phần server của Next (getProduct, gợi ý) gọi API thật nên không mock được:
 * spec lấy một sản phẩm có sẵn trong DB e2e và tự bỏ qua khi DB không có sản phẩm nào; mọi lời gọi từ trình duyệt đi qua mock.
 */
test.describe('Web khách: trang sản phẩm', () => {
  const API_ORIGIN = `http://localhost:${process.env.E2E_API_PORT ?? '3001'}`;

  async function firstProduct(request: import('@playwright/test').APIRequestContext) {
    const res = await request.get(`${API_ORIGIN}/api/products?limit=1`).catch(() => null);
    if (!res?.ok()) return null;
    const first = ((await res.json()) as { data?: { slug: string }[] }).data?.[0];
    if (!first) return null;
    const detail = await request.get(`${API_ORIGIN}/api/products/${encodeURIComponent(first.slug)}`);
    return detail.ok() ? ((await detail.json()) as { id: string; slug: string; variations: { id: string; stock: number }[] }) : null;
  }

  function mockPdp(api: MockApi, p: { slug: string; variations: { id: string; stock: number }[] }, over: { affiliate?: boolean } = {}) {
    api.get('/flash-sales/active', []);
    api.get('/config/public', { freeshipThreshold: 350000, subscribeDiscountPct: 0.12 });
    api.get(`/products/${p.slug}/reviews/can-review`, { canReview: false });
    api.get(`/products/${p.slug}`, { variations: p.variations });
    api.get(`/products/${p.slug}/related`, []);
    api.get(`/products/${p.slug}/bought-together`, []);
    api.get(`/products/${p.slug}/reviews`, { average: 0, count: 0, videoCount: 0, distribution: {}, items: [] });
    api.get('/me/wishlist/ids', []);
    api.get('/me/coupons', [
      { code: 'GIAM20', type: 'AMOUNT', value: 20000, minOrder: 100000, maxDiscount: null, endAt: '2027-01-01T00:00:00.000Z' },
    ]);
    api.get('/affiliate/me', { isAffiliate: over.affiliate === true });
    api.get('/me/addresses', [
      { id: 'a1', recipient: 'Nguyễn Văn An', phone: '0912345678', province: 'Hà Nội', district: '', ward: 'Phường Ba Đình', street: '12 Phố Huế', provinceCode: '84_VN01', districtCode: '', wardCode: '84_VN01_00004', isDefault: true },
    ]);
    api.get('/me/wallet', { walletBalance: 300000, cashbackPending: 0, commissionApproved: 0, commissionPending: 0, withdrawMin: 0, withdrawFee: 0 });
  }

  const signIn = (page: import('@playwright/test').Page) =>
    page.addInitScript(() => {
      try {
        localStorage.setItem('tubu_web_session', '1');
      } catch {
        // không có localStorage: spec vẫn chạy, chỉ không có phiên khôi phục
      }
    });

  test('khách chưa đăng nhập bấm Mở nhóm mua chung: sang đăng nhập kèm returnTo về đúng sản phẩm, không tạo nhóm', async ({ page, api, request }) => {
    const p = await firstProduct(request);
    test.skip(!p, 'DB e2e chưa có sản phẩm nào');
    mockPdp(api, p!);
    api.post('/auth/refresh', reply(401, { message: 'Chưa đăng nhập' }));
    await page.goto(`/san-pham/${p!.slug}`);
    await page.getByRole('button', { name: /Mở nhóm mua chung/ }).click();
    await page.waitForURL(/\/dang-nhap/);
    expect(new URL(page.url()).searchParams.get('returnTo')).toBe(`/san-pham/${p!.slug}`);
    expect(api.callsTo('POST', '/group-buy')).toHaveLength(0);
  });

  test('đăng nhập: chép mã giảm giá, mở nhóm mua chung gửi {productId} rồi sang /mua-chung/:id', async ({ page, api, request }) => {
    const p = await firstProduct(request);
    test.skip(!p, 'DB e2e chưa có sản phẩm nào');
    await signIn(page);
    mockSession(api, makeUser({ id: 'u1', fullName: 'Nguyễn Văn An', referralCode: 'AN123' }));
    mockPdp(api, p!);
    api.post('/group-buy', { id: 'g1' });
    api.get('/group-buy', [group('g1')]);
    api.get('/group-buy/g1', group('g1', { isOwner: true, joined: true }));
    await page.goto(`/san-pham/${p!.slug}`);
    await expect(page.getByRole('button', { name: 'Sao chép mã GIAM20' })).toBeVisible();
    const call = async () => {
      const created = api.waitForCall('POST', '/group-buy');
      await page.getByRole('button', { name: /Mở nhóm mua chung/ }).click();
      return (await created).body;
    };
    expect(await call()).toEqual({ productId: p!.id });
    await expect(page).toHaveURL(/\/mua-chung\/g1(\?moi=1)?$/);
  });

  test('đặt định kỳ: sheet gửi đúng body tạo subscription và báo đơn đầu', async ({ page, api, request }) => {
    const p = await firstProduct(request);
    const inStock = p?.variations.find((v) => v.stock > 0);
    test.skip(!p || !inStock, 'DB e2e chưa có sản phẩm còn hàng');
    await signIn(page);
    mockSession(api, makeUser({ id: 'u1', fullName: 'Nguyễn Văn An', referralCode: 'AN123' }));
    mockPdp(api, p!);
    api.post('/me/subscriptions', {
      id: 's1', quantity: 1, intervalWeeks: 4, status: 'ACTIVE', nextRunAt: '2026-11-07T00:00:00.000Z', productName: 'x',
      firstOrder: { id: 'o1', code: 'TB-1', status: 'CONFIRMED', paymentMethod: 'COD', total: 100000 },
    });
    await page.goto(`/san-pham/${p!.slug}`);
    await page.getByRole('button', { name: /Đặt định kỳ/ }).click();
    const dialog = page.getByRole('dialog', { name: /Đặt định kỳ/ });
    await dialog.getByRole('button', { name: '6 tuần' }).click();
    const created = api.waitForCall('POST', '/me/subscriptions');
    await dialog.getByRole('button', { name: 'Bắt đầu đặt định kỳ' }).click();
    const body = (await created).body as Record<string, unknown>;
    expect(body).toMatchObject({ quantity: 1, intervalWeeks: 6, addressId: 'a1', paymentMethod: 'COD' });
    expect(body).not.toHaveProperty('startDate');
    await expect(page.getByText(/Đã tạo lịch định kỳ và đơn đầu TB-1/)).toBeVisible();
  });

  test('điện thoại 320px: không cuộn ngang', async ({ page, api, request }) => {
    const p = await firstProduct(request);
    test.skip(!p, 'DB e2e chưa có sản phẩm nào');
    mockPdp(api, p!);
    api.post('/auth/refresh', reply(401, { message: 'Chưa đăng nhập' }));
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto(`/san-pham/${p!.slug}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

const signedIn = (page: import('@playwright/test').Page) =>
  page.addInitScript(() => {
    try {
      localStorage.setItem('tubu_web_session', '1');
    } catch {
      // không có localStorage: spec vẫn chạy, chỉ không có phiên khôi phục
    }
  });

const group = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  product: { name: `Sản phẩm ${id}`, slug: `sp-${id}`, thumbnail: null },
  targetSize: 5, currentSize: 2, unitPrice: 80000, basePrice: 100000, discountPct: 20, status: 'OPEN',
  expiresAt: new Date(Date.now() + 3 * 3600_000).toISOString(), joined: false, isOwner: false, ...over,
});

const noHorizontalScroll = (page: import('@playwright/test').Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.describe('Web: yêu thích', () => {
  test('khách chưa đăng nhập: mời đăng nhập và không gọi /me/wishlist', async ({ page, api }) => {
    api.post('/auth/refresh', reply(401, { message: 'Chưa đăng nhập' }));
    await page.goto('/tai-khoan/yeu-thich');
    await expect(page.getByRole('link', { name: 'Đăng nhập với Zalo' })).toHaveAttribute('href', '/dang-nhap?returnTo=%2Ftai-khoan%2Fyeu-thich');
    expect(api.callsTo('GET', '/me/wishlist')).toHaveLength(0);
  });

  test('đã đăng nhập: hiện lưới sản phẩm yêu thích; danh sách rỗng thì có lối khám phá', async ({ page, api }) => {
    await signedIn(page);
    mockSession(api, makeUser({ id: 'u1', fullName: 'Nguyễn Văn An' }));
    api.get('/flash-sales/active', []);
    api.get('/me/wishlist', [product(1), product(2)]);
    await page.goto('/tai-khoan/yeu-thich');
    await expect(page.getByRole('heading', { level: 1, name: 'Sản phẩm yêu thích' })).toBeVisible();
    await expect(page.getByText('Sản phẩm 1')).toBeVisible();
    await expect(page.getByText('Sản phẩm 2')).toBeVisible();
  });

  test('danh sách rỗng: trạng thái trống dẫn sang /san-pham', async ({ page, api }) => {
    await signedIn(page);
    mockSession(api, makeUser({ id: 'u1', fullName: 'Nguyễn Văn An' }));
    api.get('/me/wishlist', []);
    await page.goto('/tai-khoan/yeu-thich');
    await expect(page.getByText('Chưa có sản phẩm yêu thích')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Khám phá sản phẩm' })).toHaveAttribute('href', '/san-pham');
  });
});

test.describe('Web: mua chung', () => {
  test('khách chưa đăng nhập: xem được danh sách, bấm Đăng nhập để tham gia sang đăng nhập kèm returnTo, không gửi tham gia', async ({ page, api }) => {
    api.post('/auth/refresh', reply(401, { message: 'Chưa đăng nhập' }));
    api.get('/group-buy', [group('g1')]);
    await page.goto('/mua-chung');
    await expect(page.getByRole('heading', { level: 1, name: 'Mua chung giá tốt' })).toBeVisible();
    await expect(page.getByText('2/5 người')).toBeVisible();
    await page.getByRole('button', { name: 'Đăng nhập để tham gia' }).click();
    await page.waitForURL(/\/dang-nhap/);
    expect(new URL(page.url()).searchParams.get('returnTo')).toBe('/mua-chung');
    expect(api.callsTo('POST', '/group-buy/:id/join')).toHaveLength(0);
  });

  test('đã đăng nhập: tham gia gửi POST /group-buy/:id/join rồi báo đã tham gia', async ({ page, api }) => {
    await signedIn(page);
    mockSession(api, makeUser({ id: 'u1', fullName: 'Nguyễn Văn An', referralCode: 'AN123' }));
    api.get('/group-buy', [group('g1')]);
    api.post('/group-buy/g1/join', { joined: true, currentSize: 3, status: 'OPEN' });
    await page.goto('/mua-chung');
    const joined = api.waitForCall('POST', '/group-buy/g1/join');
    await page.getByRole('button', { name: /Tham gia mua chung/ }).click();
    await joined;
    await expect(page.getByText('Đã tham gia nhóm')).toBeVisible();
  });

  test('link mời /mua-chung/:id: nhóm được mời hiện đầu danh sách kèm biểu ngữ', async ({ page, api }) => {
    await signedIn(page);
    mockSession(api, makeUser({ id: 'u1', fullName: 'Nguyễn Văn An' }));
    api.get('/group-buy', [group('g1')]);
    api.get('/group-buy/g2', group('g2'));
    await page.goto('/mua-chung/g2');
    await expect(page.getByText('Bạn được mời vào nhóm này')).toBeVisible();
    await expect(page.getByText('Sản phẩm g2')).toBeVisible();
    await expect(page.getByText('Sản phẩm g1')).toBeVisible();
  });

  test('điện thoại 320px: không cuộn ngang', async ({ page, api }) => {
    api.post('/auth/refresh', reply(401, { message: 'Chưa đăng nhập' }));
    api.get('/group-buy', [group('g1', { product: { name: 'Một sản phẩm có tên rất dài để thử tràn ngang trên màn hình hẹp', slug: 'sp', thumbnail: null } })]);
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto('/mua-chung');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(await noHorizontalScroll(page)).toBeLessThanOrEqual(0);
  });
});

test.describe('Web: nhãn hàng', () => {
  const API_ORIGIN = `http://localhost:${process.env.E2E_API_PORT ?? '3001'}`;

  async function firstBrandSlug(request: import('@playwright/test').APIRequestContext) {
    const res = await request.get(`${API_ORIGIN}/api/brands`).catch(() => null);
    if (!res?.ok()) return null;
    return ((await res.json()) as { slug?: string | null }[]).find((b) => b.slug)?.slug ?? null;
  }

  test('đăng nhập: Theo dõi gửi POST rồi đổi thành Đang theo dõi; bấm lại gửi DELETE', async ({ page, api, request }) => {
    const slug = await firstBrandSlug(request);
    test.skip(!slug, 'DB e2e chưa có nhãn công khai nào');
    await signedIn(page);
    mockSession(api, makeUser({ id: 'u1', fullName: 'Nguyễn Văn An' }));
    api.get(`/brand/${slug}/follow-state`, { following: false, followerCount: 3 });
    api.get(`/brand/${slug}/share-to-earn`, { eligible: false });
    api.post(`/brand/${slug}/follow`, { following: true, followerCount: 4 });
    api.delete(`/brand/${slug}/follow`, { following: false, followerCount: 3 });
    await page.goto(`/brand/${slug}`);
    await page.getByRole('button', { name: 'Theo dõi' }).click();
    await api.waitForCall('POST', `/brand/${slug}/follow`);
    await expect(page.getByRole('button', { name: 'Đang theo dõi' })).toBeVisible();
    await page.getByRole('button', { name: 'Đang theo dõi' }).click();
    await api.waitForCall('DELETE', `/brand/${slug}/follow`);
    await expect(page.getByRole('button', { name: 'Theo dõi' })).toBeVisible();
  });

  test('khách chưa đăng nhập bấm Theo dõi: sang đăng nhập kèm returnTo về đúng trang nhãn', async ({ page, api, request }) => {
    const slug = await firstBrandSlug(request);
    test.skip(!slug, 'DB e2e chưa có nhãn công khai nào');
    api.post('/auth/refresh', reply(401, { message: 'Chưa đăng nhập' }));
    await page.goto(`/brand/${slug}`);
    await page.getByRole('button', { name: 'Theo dõi' }).click();
    await page.waitForURL(/\/dang-nhap/);
    expect(new URL(page.url()).searchParams.get('returnTo')).toBe(`/brand/${slug}`);
    expect(api.callsTo('POST', `/brand/${slug}/follow`)).toHaveLength(0);
  });

  test('CTV đủ điều kiện: dải kiếm tiền mở sheet chia sẻ với link mang mã giới thiệu', async ({ page, api, request }) => {
    const slug = await firstBrandSlug(request);
    test.skip(!slug, 'DB e2e chưa có nhãn công khai nào');
    await signedIn(page);
    mockSession(api, makeUser({ id: 'u1', fullName: 'Nguyễn Văn An' }));
    api.get(`/brand/${slug}/follow-state`, { following: false, followerCount: 3 });
    api.get(`/brand/${slug}/share-to-earn`, { eligible: true, maxAffiliateRate: 15, referralCode: 'AFF1', brandSlug: slug });
    await page.goto(`/brand/${slug}`);
    await page.getByRole('button', { name: /nhận tới 15% hoa hồng/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Chia sẻ nhãn hàng' });
    await expect(dialog.getByText(new RegExp(`/brand/${slug}\\?ref=AFF1`)).first()).toBeVisible();
  });
});

test.describe('Web khách: Hành trình nguyên liệu /cau-chuyen', () => {
  test('mở ô nhãn: sheet có câu chuyện và nút dẫn tới /san-pham?brand= theo tên trong catalog', async ({ page, api }) => {
    api.post('/auth/refresh', reply(401, { message: 'Chưa đăng nhập' }));
    await page.goto('/cau-chuyen');
    await expect(page.getByRole('heading', { level: 1, name: 'Hành trình nguyên liệu' })).toBeVisible();
    await page.getByRole('button', { name: /Le Plateau.*Lâm Đồng \(Cầu Đất\)/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Le Plateau' });
    await expect(dialog.getByText(/Arabica Cầu Đất/)).toBeVisible();
    await expect(dialog.getByRole('link', { name: 'Khám phá sản phẩm Le Plateau' })).toHaveAttribute('href', '/san-pham?brand=Le%20Plateau%20Coffee');
  });

  test('điện thoại 320px: không cuộn ngang', async ({ page, api }) => {
    api.post('/auth/refresh', reply(401, { message: 'Chưa đăng nhập' }));
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto('/cau-chuyen');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(await noHorizontalScroll(page)).toBeLessThanOrEqual(0);
  });
});
