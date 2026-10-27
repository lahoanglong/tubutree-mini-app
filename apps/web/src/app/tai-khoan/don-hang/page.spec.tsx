// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, flush, render, type Rendered } from '@/test-utils/dom';
import { headingProblems, unnamedControls } from '@/test-utils/a11y';

// Mini App orders.spec.tsx: tab gốc "Đơn hàng", 7 tab, thẻ đơn, Thanh toán ngay, Mua lại, Xem thêm, trạng thái trống, gợi ý khách mới.

const m = vi.hoisted(() => ({
  auth: { user: { id: 'u1' } as null | Record<string, unknown>, status: 'authenticated', initialized: true, sessionUnavailable: false },
  search: new URLSearchParams(),
  replace: vi.fn(),
  push: vi.fn(),
}));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => m.auth }));
vi.mock('@/lib/cart-key', () => ({ cartStorefrontSlug: () => null, cartKey: () => ['cart', null], useCartKey: () => ['cart', null] }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: m.replace, push: m.push }),
  usePathname: () => '/tai-khoan/don-hang',
  useSearchParams: () => m.search,
}));

import OrdersPage from './page';

const item = (name: string, over: Record<string, unknown> = {}) => ({
  id: `i-${name}`, variationId: `v-${name}`, productName: name, variationName: '', unitPrice: 50000, quantity: 1, total: 50000,
  thumbnail: null, stock: 9, available: true, ...over,
});
const order = (code: string, over: Record<string, unknown> = {}) => ({
  id: `id-${code}`, code, status: 'DELIVERED', subtotal: 50000, discount: 0, shippingFee: 0, total: 50000, paymentMethod: 'COD',
  paymentStatus: 'PAID', createdAt: '2026-10-01T03:00:00Z', items: [item('Nước rửa chén')], ...over,
});

interface Call { method: string; path: string; query: URLSearchParams; body: unknown }
let calls: Call[] = [];
let orders: Record<string, unknown>[] = [];
let total: number | undefined;
let ordersFail = false;
let offer: unknown = { isNewCustomer: false, welcomeVoucher: null };
let purchased: unknown[] = [];

function stubApi() {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = new URL(url);
      const path = u.pathname.replace(/^\/api/, '');
      const method = init?.method ?? 'GET';
      calls.push({ method, path, query: u.searchParams, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
      if (path === '/orders') {
        if (ordersFail) return json({ message: 'Máy chủ bận' }, 500);
        const page = Number(u.searchParams.get('page') ?? 1);
        const limit = Number(u.searchParams.get('limit') ?? 20);
        return json({ data: orders.slice((page - 1) * limit, page * limit), meta: { page, limit, total: total ?? orders.length } });
      }
      if (path === '/me/new-customer-offer') return json(offer);
      if (path === '/me/purchased-items') return json({ items: purchased, nextCursor: null });
      if (path === '/me/subscriptions') return json([]);
      if (path === '/config/public') return json({ subscribeDiscountPct: 0.12 });
      if (path.endsWith('/repurchase')) return json({ items: [], results: [{ orderItemId: 'i-Nước rửa chén', status: 'added', addedQuantity: 1 }] });
      return json({});
    }),
  );
}
const sent = (path: string) => calls.filter((c) => c.path === path);

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<OrdersPage />);
  mounted.push(r);
  await flush(8);
  return r.container;
};
const btn = (label: string, root: ParentNode = document.body) =>
  Array.from(root.querySelectorAll('button')).find((b) => b.textContent === label) as HTMLButtonElement | undefined;

beforeEach(() => {
  m.auth.user = { id: 'u1' };
  m.auth.status = 'authenticated';
  m.auth.initialized = true;
  m.auth.sessionUnavailable = false;
  m.search = new URLSearchParams();
  m.replace.mockReset();
  m.push.mockReset();
  orders = [order('TUBU1')];
  total = undefined;
  ordersFail = false;
  offer = { isNewCustomer: false, welcomeVoucher: null };
  purchased = [];
  stubApi();
});
afterEach(() => {
  mounted.forEach((x) => x.unmount());
  mounted = [];
  vi.unstubAllGlobals();
});

describe('trang Đơn hàng /tai-khoan/don-hang', () => {
  it('tiêu đề "Đơn hàng", 7 tab gồm "Định kỳ", một h1, nút có tên', async () => {
    const c = await mount();
    expect(c.querySelector('h1')?.textContent).toBe('Đơn hàng');
    const tabs = Array.from(c.querySelectorAll('[role="tab"]')).map((t) => t.textContent);
    expect(tabs).toEqual(['Tất cả', 'Chờ thanh toán', 'Đang xử lý', 'Đang giao', 'Đã giao', 'Đã huỷ/hoàn', 'Định kỳ']);
    expect(headingProblems(c)).toEqual([]);
    expect(unnamedControls(c)).toEqual([]);
  });

  it('tab "Tất cả" gửi GET /orders page=1 limit=20 không kèm bộ lọc; thẻ đơn dẫn tới chi tiết', async () => {
    const c = await mount();
    const q = sent('/orders')[0]!.query;
    expect(Object.fromEntries(q)).toEqual({ page: '1', limit: '20' });
    expect(c.querySelector('a[href="/tai-khoan/don-hang/TUBU1"]')).not.toBeNull();
  });

  it.each([
    ['processing', 'group', 'processing'],
    ['pending_payment', 'status', 'PENDING_PAYMENT'],
    ['shipping', 'status', 'SHIPPING'],
    ['delivered', 'status', 'DELIVERED'],
    ['closed', 'group', 'closed'],
  ])('?tab=%s gửi %s=%s', async (tab, key, value) => {
    m.search = new URLSearchParams({ tab });
    await mount();
    expect(sent('/orders')[0]!.query.get(key)).toBe(value);
  });

  it('bấm tab ghi ?tab= vào URL (replace) để tải lại hay chia sẻ link vẫn đúng tab', async () => {
    const c = await mount();
    click(Array.from(c.querySelectorAll('[role="tab"]')).find((t) => t.textContent === 'Đang giao') ?? null);
    expect(m.replace).toHaveBeenCalledWith('/tai-khoan/don-hang?tab=shipping', { scroll: false });
  });

  it('?tab=subscriptions mở thẳng "Định kỳ", không tải danh sách đơn', async () => {
    m.search = new URLSearchParams({ tab: 'subscriptions' });
    const c = await mount();
    expect(c.textContent).toContain('Chưa có lịch đặt định kỳ');
    expect(sent('/orders')).toHaveLength(0);
    expect(sent('/me/subscriptions')).toHaveLength(1);
  });

  it('?tab= lạ → "Tất cả"', async () => {
    m.search = new URLSearchParams({ tab: 'lung-tung' });
    const c = await mount();
    expect(c.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('Tất cả');
  });

  it('đơn chuyển khoản chờ thanh toán: "Thanh toán ngay" dẫn tới trang chuyển khoản của đơn', async () => {
    orders = [order('TUBU2', { status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID', paymentDeadline: '2099-01-01T00:00:00Z' })];
    const c = await mount();
    expect(Array.from(c.querySelectorAll('a')).find((a) => a.textContent === 'Thanh toán ngay')?.getAttribute('href')).toBe('/thanh-toan/chuyen-khoan/TUBU2');
  });

  it('"Mua lại" trên thẻ → sheet → gửi repurchase đúng body → sang giỏ', async () => {
    const c = await mount();
    click(btn('Mua lại', c) ?? null);
    await flush();
    expect(document.body.textContent).toContain('Từ đơn TUBU1');
    click(btn('Thêm vào giỏ (1)') ?? null);
    await flush(8);
    expect(sent('/orders/TUBU1/repurchase')[0]!.body).toEqual({ items: [{ orderItemId: 'i-Nước rửa chén', quantity: 1 }], addSource: 'repurchase' });
    expect(m.push).toHaveBeenCalledWith('/gio-hang');
  });

  it('còn trang sau → "Xem thêm" tải trang 2 và nối vào danh sách', async () => {
    orders = Array.from({ length: 25 }, (_, i) => order(`TUBU${i + 1}`));
    const c = await mount();
    expect(c.querySelectorAll('[data-testid="order-card"]')).toHaveLength(20);
    click(btn('Xem thêm', c) ?? null);
    await flush(8);
    expect(sent('/orders').map((x) => x.query.get('page'))).toEqual(['1', '2']);
    expect(c.querySelectorAll('[data-testid="order-card"]')).toHaveLength(25);
    expect(btn('Xem thêm', c)).toBeUndefined();
  });

  it('tab "Tất cả" rỗng: trạng thái trống có lối "Bắt đầu mua"', async () => {
    orders = [];
    const c = await mount();
    expect(c.textContent).toContain('Bạn chưa có đơn nào');
    expect(Array.from(c.querySelectorAll('a')).find((a) => a.textContent === 'Bắt đầu mua')?.getAttribute('href')).toBe('/san-pham');
  });

  it('tab khác "Tất cả" rỗng: thông báo nhẹ, không lối mua đơn đầu, không gọi ưu đãi khách mới', async () => {
    orders = [];
    m.search = new URLSearchParams({ tab: 'shipping' });
    const c = await mount();
    expect(c.textContent).toContain('Không có đơn nào ở mục này');
    expect(Array.from(c.querySelectorAll('a')).some((a) => a.textContent === 'Bắt đầu mua')).toBe(false);
    expect(sent('/me/new-customer-offer')).toHaveLength(0);
  });

  it('lỗi tải: báo lỗi, "Thử lại" gọi lại API', async () => {
    ordersFail = true;
    const c = await mount();
    expect(c.querySelector('[role="alert"]')?.textContent).toContain('Máy chủ đang bận');
    ordersFail = false;
    click(btn('Thử lại', c) ?? null);
    await flush(8);
    expect(c.querySelector('a[href="/tai-khoan/don-hang/TUBU1"]')).not.toBeNull();
    expect(sent('/orders')).toHaveLength(2);
  });

  it('kệ Mua lại chỉ ở tab "Tất cả", nằm dưới danh sách đơn', async () => {
    purchased = [{
      variationId: 'v1', productId: 'p1', slug: 'nrc', productName: 'Nước rửa chén', variationName: 'Chanh', brand: 'Tubu', thumbnail: null,
      price: 65000, salePrice: null, stock: 8, inStock: true, timesBought: 2, lastPurchasedAt: '2026-09-10T00:00:00Z',
    }];
    const c = await mount();
    const rail = c.querySelector('section[aria-label="Mua lại"]')!;
    const list = c.querySelector('[data-testid="order-card"]')!;
    expect(rail).not.toBeNull();
    expect(list.compareDocumentPosition(rail) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    mounted.forEach((x) => x.unmount());
    mounted = [];
    calls = [];
    m.search = new URLSearchParams({ tab: 'delivered' });
    const c2 = await mount();
    expect(c2.querySelector('section[aria-label="Mua lại"]')).toBeNull();
    expect(sent('/me/purchased-items')).toHaveLength(0);
  });
});

describe('trang Đơn hàng: đơn trống chỉ nhắc voucher chào mừng khi khách thật sự có', () => {
  beforeEach(() => {
    orders = [];
  });
  const welcome = (over: Record<string, unknown> = {}) => ({
    isNewCustomer: true, welcomeVoucher: { code: 'WELCOME', type: 'AMOUNT', value: 30000, minOrder: 199000, endAt: null, ...over },
  });

  it('có mã chào mừng: số trong chữ theo mã của khách', async () => {
    offer = welcome();
    const c = await mount();
    expect(c.textContent).toContain('Đơn đầu từ 199.000đ dùng được mã giảm giá chào mừng 30.000đ');
  });

  it('mã không đòi đơn tối thiểu: bỏ cụm "từ …"', async () => {
    offer = welcome({ minOrder: 0 });
    const c = await mount();
    expect(c.textContent).toContain('Đơn đầu dùng được mã giảm giá chào mừng 30.000đ');
    expect(c.textContent).not.toContain('Đơn đầu từ');
  });

  it('không tải được ưu đãi khách mới: màn trống vẫn hiện, không nhắc voucher', async () => {
    offer = undefined;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const path = new URL(url).pathname.replace(/^\/api/, '');
      const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
      if (path === '/orders') return json({ data: [], meta: { page: 1, limit: 20, total: 0 } });
      if (path === '/me/new-customer-offer') return json({ message: 'lỗi' }, 500);
      return json({});
    }));
    const c = await mount();
    expect(c.textContent).toContain('Bạn chưa có đơn nào');
    expect(c.textContent).not.toContain('mã giảm giá chào mừng');
  });

  it('khách không phải khách mới: không nhắc voucher', async () => {
    offer = { isNewCustomer: false, welcomeVoucher: null };
    const c = await mount();
    expect(c.textContent).not.toContain('mã giảm giá chào mừng');
  });

  it('khách đã có đơn: không gọi API ưu đãi khách mới', async () => {
    orders = [order('TUBU1')];
    await mount();
    expect(sent('/me/new-customer-offer')).toHaveLength(0);
  });
});

describe('trang Đơn hàng: phiên', () => {
  it('khách chưa đăng nhập: mời đăng nhập mang returnTo, không gọi API đơn', async () => {
    m.auth.status = 'idle';
    m.auth.user = null;
    const c = await mount();
    expect(sent('/orders')).toHaveLength(0);
    expect(c.querySelector('a[href^="/dang-nhap"]')?.getAttribute('href')).toBe(`/dang-nhap?returnTo=${encodeURIComponent('/tai-khoan/don-hang')}`);
  });

  it('đang khôi phục phiên: chỉ "Đang tải…"', async () => {
    m.auth.status = 'idle';
    m.auth.initialized = false;
    const c = await mount();
    expect(c.textContent).toContain('Đang tải…');
    expect(sent('/orders')).toHaveLength(0);
  });
});
