// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, flush, render, typeInto, type Rendered } from '@/test-utils/dom';
import { accessibleName, headingProblems, smallTouchTargets, unnamedControls } from '@/test-utils/a11y';

// C-123 + C-077 (web khách): mỗi trang khách có đúng một h1, heading không nhảy cấp, và mọi nút/ô nhập/
// select có tên truy cập. Đây là bản kiểm thay cho axe `heading-order`/`page-has-heading-one`/`button-name`/
// `label`/`select-name` (máy không chạy Playwright), áp trên DOM thật của từng trang.

const mocks = vi.hoisted(() => ({
  auth: {
    user: null as null | Record<string, unknown>,
    status: 'authenticated' as string,
    logout: vi.fn(),
    startZaloLogin: vi.fn(),
    handleCallback: vi.fn(),
  },
  search: new URLSearchParams(),
}));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => mocks.auth }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => mocks.search,
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

const CART = {
  items: [
    {
      id: 'i1',
      variationId: 'v1',
      productName: 'Dầu gội bồ kết',
      variationName: '500ml',
      slug: 'dau-goi',
      thumbnail: null,
      unitPrice: 150000,
      quantity: 2,
      stock: 5,
      total: 300000,
    },
  ],
  couponCode: null as string | null,
  subtotal: 300000,
  discount: 0,
  freeship: false,
  freeshipThreshold: 500000,
  itemCount: 2,
  unavailableItems: [{ id: 'u1', productName: 'Xà phòng cũ', variationName: '100g', quantity: 1 }],
};
const shop = vi.hoisted(() => ({
  cart: null as unknown,
  addresses: [] as unknown[],
  orders: [] as unknown[],
}));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  getCart: async () => shop.cart,
  getMyCoupons: async () => [
    { code: 'WELCOME30', type: 'PERCENT', value: 30, minOrder: null, maxDiscount: null, endAt: '2030-01-01T00:00:00Z' },
  ],
  getAddresses: async () => shop.addresses,
  checkoutQuote: async () => ({
    subtotal: 300000, discount: 0, pointsUsed: 0, pointsDiscount: 0, shippingFee: 30000, total: 330000,
    pointsEarned: 0, pointsBalance: 0, redeemablePoints: 0,
  }),
  getPublicConfig: async () => ({}),
  fetchOrdersPage: async () => ({
    data: shop.orders,
    meta: { page: 1, limit: 20, total: (shop.orders as unknown[]).length },
  }),
  getProductStock: async () => ({}),
  addToCart: vi.fn(),
  placeOrder: async () => ({
    code: 'TB-9', status: 'PENDING_PAYMENT', subtotal: 300000, discount: 0, shippingFee: 30000, total: 330000,
    paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID', createdAt: '2026-10-01T00:00:00Z', items: [],
  }),
  getBankQr: async () => ({
    orderCode: 'TB-9', amount: 330000, paymentStatus: 'UNPAID',
    bank: { bin: '970407', name: 'Techcombank', accountNo: '9984606774', accountName: 'CONG TY TUBU TREE' },
    memo: 'TB-9', qrString: 'x', qrImageUrl: 'https://img.vietqr.io/x.png',
  }),
}));
vi.mock('@/lib/geo-client', () => ({
  getProvinces: async () => [{ code: '84_VN01', name: 'Hà Nội' }],
  getCommunes: async () => [],
}));

const api = vi.hoisted(() => ({ product: null as unknown, storefront: null as unknown }));
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  getProduct: async () => api.product,
  getStorefront: async () => api.storefront,
}));
vi.mock('@/components/storefront-tracker', () => ({ StorefrontTracker: () => null, ReferralCapture: () => null }));

import CartPage from './gio-hang/page';
import CheckoutPage from './thanh-toan/page';
import AccountPage from './tai-khoan/page';
import LoginPage from './dang-nhap/page';
import CallbackPage from './dang-nhap/callback/page';
import ProductPage from './san-pham/[slug]/page';
import StorefrontPage from './s/[slug]/page';
import NotFound from './not-found';
import ErrorPage from './error';

let mounted: Rendered[] = [];
const mount = (ui: Parameters<typeof render>[0]) => {
  const r = render(ui);
  mounted.push(r);
  return r;
};

beforeEach(() => {
  mocks.auth.status = 'authenticated';
  mocks.auth.user = { id: 'u', fullName: 'Nguyễn An', referralCode: 'AN123', pointsBalance: 120, walletBalance: 50000 };
  mocks.search = new URLSearchParams();
  shop.cart = structuredClone(CART);
  shop.addresses = [
    { id: 'a1', recipient: 'An', phone: '0912345678', province: 'Hà Nội', district: '', ward: 'Cầu Giấy', street: '1 Xuân Thuỷ',
      provinceCode: '84_VN01', districtCode: '', wardCode: 'w1', isDefault: true },
  ];
  shop.orders = [
    { code: 'TB-1', status: 'PENDING_PAYMENT', subtotal: 1, discount: 0, shippingFee: 0, total: 150000, paymentMethod: 'COD', createdAt: '2026-10-01T00:00:00Z', items: [] },
  ];
  api.product = {
    id: 'p1', slug: 'dau-goi', brand: 'Tubu', name: 'Dầu gội bồ kết', shortDesc: 'Lành tính', description: 'Mô tả chi tiết',
    images: [], thumbnail: null, basePrice: 200000, salePrice: 150000, certifications: ['Thuần chay'],
    variations: [
      { id: 'v1', sku: 's1', name: '250ml', retailPrice: 200000, salePrice: 150000, stock: 5 },
      { id: 'v2', sku: 's2', name: '500ml', retailPrice: 300000, salePrice: null, stock: 0 },
    ],
  };
  api.storefront = {
    id: 's1', slug: 'minh-an', type: 'CTV', title: 'Gian hàng Minh An', headerNote: 'Sống xanh', themeColor: null,
    warehouseAddress: '1 Lê Lợi', warehousePhone: '0912345678', ownerTier: { name: 'Bạc', emoji: '🥈' },
    collections: [
      { id: 'c1', title: 'Chăm sóc tóc', items: [
        { id: 'it1', product: { id: 'p1', name: 'Dầu gội bồ kết', slug: 'dau-goi', brand: 'Tubu', basePrice: 200000, salePrice: 150000, sold: 12 } },
      ] },
    ],
  };
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.restoreAllMocks();
});

const expectAccessible = (container: HTMLElement) => {
  expect(headingProblems(container)).toEqual([]);
  expect(unnamedControls(container)).toEqual([]);
  expect(smallTouchTargets(container)).toEqual([]);
};

describe('trang khách — heading và tên truy cập (C-123, C-077)', () => {
  it('/san-pham/[slug]: một h1, các nút phân loại/số lượng có tên', async () => {
    const ui = await ProductPage({ params: Promise.resolve({ slug: 'dau-goi' }) });
    const { container } = mount(ui);
    await flush();
    expectAccessible(container);
    const pressed = Array.from(container.querySelectorAll('button[aria-pressed]')).map((b) => b.getAttribute('aria-pressed'));
    expect(pressed).toEqual(['true', 'false']);
    const labels = Array.from(container.querySelectorAll('button')).map((b) => b.getAttribute('aria-label'));
    expect(labels).toEqual(expect.arrayContaining(['Giảm số lượng', 'Tăng số lượng']));
  });

  it('/gio-hang có hàng: nút −/+/Xóa gắn với đúng sản phẩm, ô mã giảm giá có nhãn', async () => {
    const { container } = mount(<CartPage />);
    await flush();
    expectAccessible(container);
    const names = Array.from(container.querySelectorAll('button')).map((b) => b.getAttribute('aria-label') ?? b.textContent);
    expect(names).toContain('Giảm số lượng Dầu gội bồ kết');
    expect(names).toContain('Tăng số lượng Dầu gội bồ kết');
    const coupon = container.querySelector('#coupon-code');
    expect(coupon).not.toBeNull();
    expect(accessibleName(coupon!)).toBe('Mã giảm giá');
  });

  it('/gio-hang đã áp mã: nút bỏ mã có tên', async () => {
    (shop.cart as { couponCode: string | null; discount: number }).couponCode = 'WELCOME30';
    (shop.cart as { discount: number }).discount = 90000;
    const { container } = mount(<CartPage />);
    await flush();
    expectAccessible(container);
  });

  it('/gio-hang trống và chưa đăng nhập: vẫn đúng một h1', async () => {
    (shop.cart as { items: unknown[] }).items = [];
    const empty = mount(<CartPage />);
    await flush();
    expectAccessible(empty.container);
    mocks.auth.status = 'anonymous';
    const anon = mount(<CartPage />);
    await flush();
    expectAccessible(anon.container);
  });

  it('/thanh-toan: ô địa chỉ, select tỉnh/phường, radio thanh toán đều có tên', async () => {
    const { container } = mount(<CheckoutPage />);
    await flush();
    click(Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Thêm địa chỉ mới')) ?? null);
    await flush();
    expectAccessible(container);
    expect(container.querySelector('select[aria-label="Tỉnh/thành"]')).not.toBeNull();
    expect(container.querySelector('select[aria-label="Phường/xã"]')).not.toBeNull();
  });

  it('/thanh-toan sau khi đặt đơn chuyển khoản: h1 → h2, nút Sao chép có tên, địa chỉ không còn dấu phẩy thừa', async () => {
    const { container } = mount(<CheckoutPage />);
    await flush();
    expect(container.textContent).toContain('1 Xuân Thuỷ, Cầu Giấy, Hà Nội');
    click(Array.from(container.querySelectorAll('input[type="radio"]')).find((r) => (r as HTMLInputElement).name === 'pay') ?? null);
    click(Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Đặt hàng') ?? null);
    await flush(8);
    expect(container.textContent).toContain('Đặt hàng thành công!');
    expectAccessible(container);
    const copyLabels = Array.from(container.querySelectorAll('button')).map((b) => b.getAttribute('aria-label'));
    expect(copyLabels).toEqual(expect.arrayContaining(['Sao chép: 9984606774', 'Sao chép: TB-9']));
  });

  it('/tai-khoan: có h1 khi đã đăng nhập, khi chưa đăng nhập và khi đang tải', async () => {
    const authed = mount(<AccountPage />);
    await flush();
    expectAccessible(authed.container);
    mocks.auth.status = 'anonymous';
    const anon = mount(<AccountPage />);
    expectAccessible(anon.container);
    mocks.auth.status = 'loading';
    const loading = mount(<AccountPage />);
    expectAccessible(loading.container);
  });

  it('/dang-nhap: một h1', () => {
    mocks.auth.status = 'anonymous';
    const { container } = mount(<LoginPage />);
    expectAccessible(container);
  });

  it('/dang-nhap/callback: có h1 ở cả trạng thái lỗi và đang chờ', async () => {
    const failed = mount(<CallbackPage />);
    await flush();
    expectAccessible(failed.container);
    mocks.search = new URLSearchParams({ code: 'abc', state: 's' });
    mocks.auth.handleCallback.mockReturnValue(new Promise(() => undefined));
    const waiting = mount(<CallbackPage />);
    await flush();
    expectAccessible(waiting.container);
  });

  it('/s/[slug]: một h1 (tên gian hàng), mỗi bộ sưu tập là h2', async () => {
    const ui = await StorefrontPage({ params: Promise.resolve({ slug: 'minh-an' }) });
    const { container } = mount(ui);
    expectAccessible(container);
  });

  it('trang 404 và lỗi chung có h1', () => {
    expectAccessible(mount(<NotFound />).container);
    expectAccessible(mount(<ErrorPage error={new Error('x')} reset={() => undefined} />).container);
  });
});

describe('trang khách — chi tiết đơn (C-025)', () => {
  it('/tai-khoan: mỗi đơn dẫn tới trang chi tiết; đơn chuyển khoản chờ thanh toán có lối "Thanh toán" riêng', async () => {
    shop.orders = [
      { code: 'TB-1', status: 'PENDING_PAYMENT', subtotal: 1, discount: 0, shippingFee: 0, total: 150000, paymentMethod: 'COD', createdAt: '2026-10-01T00:00:00Z', items: [] },
      { code: 'TB-2', status: 'PENDING_PAYMENT', subtotal: 1, discount: 0, shippingFee: 0, total: 99000, paymentMethod: 'BANK_TRANSFER', createdAt: '2026-10-02T00:00:00Z', items: [] },
      { code: 'TB-3', status: 'DELIVERED', subtotal: 1, discount: 0, shippingFee: 0, total: 80000, paymentMethod: 'BANK_TRANSFER', createdAt: '2026-10-03T00:00:00Z', items: [] },
    ];
    const { container } = mount(<AccountPage />);
    await flush();
    expectAccessible(container);
    const link = (code: string) => container.querySelector<HTMLAnchorElement>(`a[href="/tai-khoan/don-hang/${code}"]`);
    expect(accessibleName(link('TB-1')!)).toBe('Xem chi tiết đơn TB-1');
    expect(link('TB-1')!.textContent).toBe('Xem chi tiết');
    expect(accessibleName(link('TB-2')!)).toBe('Thanh toán đơn TB-2');
    expect(link('TB-2')!.textContent).toBe('Thanh toán');
    expect(link('TB-3')!.textContent).toBe('Xem chi tiết');
  });

  // PC-9: ngày đơn là dd/MM/yyyy có đệm số 0 theo giờ Việt Nam, không phải "1/10/2026" của toLocaleDateString.
  it('/tai-khoan: ngày đặt của mỗi đơn dạng dd/MM/yyyy có đệm số 0', async () => {
    shop.orders = [
      { code: 'TB-1', status: 'DELIVERED', subtotal: 1, discount: 0, shippingFee: 0, total: 150000, paymentMethod: 'COD', createdAt: '2026-10-01T00:00:00Z', items: [] },
      { code: 'TB-2', status: 'DELIVERED', subtotal: 1, discount: 0, shippingFee: 0, total: 99000, paymentMethod: 'COD', createdAt: '2026-09-02T18:00:00Z', items: [] },
    ];
    const { container } = mount(<AccountPage />);
    await flush();
    const text = container.textContent ?? '';
    expect(text).toContain('0 sản phẩm · 01/10/2026');
    expect(text).toContain('0 sản phẩm · 03/09/2026');
    expect(text).not.toMatch(/(?<!\d)[1-9]\/\d{1,2}\/2026/);
  });

  it('/thanh-toan sau khi đặt đơn: nút chính dẫn tới chi tiết đơn vừa đặt', async () => {
    const { container } = mount(<CheckoutPage />);
    await flush();
    click(Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Đặt hàng') ?? null);
    await flush(8);
    expect(container.textContent).toContain('Đặt hàng thành công!');
    const detail = container.querySelector<HTMLAnchorElement>('a[href="/tai-khoan/don-hang/TB-9"]');
    expect(detail).not.toBeNull();
    expect(detail!.textContent).toBe('Xem chi tiết đơn');
  });
});

describe('trang khách — hành vi giữ nguyên sau khi đổi giao diện', () => {
  it('giỏ hàng: nhập mã giảm giá vẫn bật nút Áp dụng', async () => {
    const { container } = mount(<CartPage />);
    await flush();
    const input = container.querySelector<HTMLInputElement>('#coupon-code');
    const apply = () => Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Áp dụng') as HTMLButtonElement;
    expect(apply().disabled).toBe(true);
    typeInto(input, 'welcome30');
    expect(apply().disabled).toBe(false);
  });
});
