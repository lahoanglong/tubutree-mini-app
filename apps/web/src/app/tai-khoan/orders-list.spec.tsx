// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, render, typeInto, type Rendered } from '@/test-utils/dom';
import { smallTouchTargets, unnamedControls } from '@/test-utils/a11y';

// R2-BUYERWEB-8: danh sách đơn chỉ có mã đơn, số sản phẩm và ngày; khách nhiều đơn không nhận ra đơn nào là đơn nào.

const state = vi.hoisted(() => ({
  calls: [] as { page: number; filter: Record<string, string>; cursor?: string }[],
  orders: [] as Record<string, unknown>[],
  /** Trang trả theo thứ tự gọi khi test muốn phân trang bằng con trỏ; rỗng = một trang như cũ. */
  keyset: [] as { data: Record<string, unknown>[]; nextCursor: string | null }[],
  push: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: state.push, replace: vi.fn() }) }));
vi.mock('@/lib/cart-key', () => ({ cartStorefrontSlug: () => null, cartKey: () => ['cart', null], useCartKey: () => ['cart', null] }));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({
    user: { id: 'u', fullName: 'An', referralCode: 'AN1', pointsBalance: 0, walletBalance: 0 },
    status: 'authenticated',
    initialized: true,
    sessionUnavailable: false,
    logout: vi.fn(),
  }),
}));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  getMe: async () => ({ pointsBalance: 0, walletBalance: 0 }),
  fetchOrdersPage: async (page: number, filter: Record<string, string> = {}, cursor?: string) => {
    state.calls.push({ page, filter, ...(cursor ? { cursor } : {}) });
    const k = state.keyset[state.calls.length - 1];
    if (k) return { data: k.data, meta: { page, limit: 20, total: 1, nextCursor: k.nextCursor } };
    return { data: state.orders, meta: { page, limit: 20, total: state.orders.length } };
  },
}));

import { OrdersSection } from './orders-section';

const item = (name: string, thumbnail: string | null = null, quantity = 1) => ({
  productName: name, variationName: '500ml', unitPrice: 100000, quantity, total: 100000 * quantity, thumbnail,
});
const order = (code: string, items: ReturnType<typeof item>[]) => ({
  code, status: 'DELIVERED', subtotal: 1, discount: 0, shippingFee: 0, total: 250000, paymentMethod: 'COD', createdAt: '2026-10-01T00:00:00Z', items,
});

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<OrdersSection />);
  mounted.push(r);
  await flush(6);
  return r.container;
};

beforeEach(() => {
  state.calls = [];
  state.orders = [];
  state.keyset = [];
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('danh sách đơn — tên và ảnh sản phẩm', () => {
  it('hiện tên + ảnh nhỏ của tối đa 2 sản phẩm đầu và đếm số còn lại', async () => {
    state.orders = [
      order('TB-1', [item('Dầu gội bưởi', 'https://img.test/a.jpg', 2), item('Nước rửa chén', null), item('Xà phòng'), item('Bàn chải')]),
    ];
    const c = await mount();
    const li = c.querySelector('li')!;
    expect(li.textContent).toContain('Dầu gội bưởi');
    expect(li.textContent).toContain('×2');
    expect(li.textContent).toContain('Nước rửa chén');
    expect(li.textContent).not.toContain('Xà phòng');
    expect(li.textContent).toContain('và 2 sản phẩm khác');
    const img = li.querySelector('img')!;
    expect(img.getAttribute('src')).toBe('https://img.test/a.jpg');
    expect(img.getAttribute('alt')).toBe('');
  });

  it('đơn một sản phẩm: không có dòng "và … khác"', async () => {
    state.orders = [order('TB-2', [item('Mật ong')])];
    const c = await mount();
    expect(c.textContent).toContain('Mật ong');
    expect(c.textContent).not.toContain('sản phẩm khác');
  });
});

describe('danh sách đơn — ô tìm kiếm', () => {
  it('gửi từ khoá cho API cùng bộ lọc trạng thái đang chọn và có nút Xoá tìm kiếm', async () => {
    state.orders = [order('TB-1', [item('Dầu gội bưởi')])];
    const c = await mount();
    click(byText(c, 'button', 'Đã giao'));
    await flush(4);
    typeInto(c.querySelector('input[type="search"]'), '  dau goi ');
    click(byText(c, 'button', 'Tìm'));
    await flush(6);
    expect(state.calls.at(-1)).toEqual({ page: 1, filter: { status: 'DELIVERED', q: 'dau goi' } });
    expect(c.textContent).toContain('Kết quả cho “dau goi”');
    click(byText(c, 'button', 'Xoá tìm kiếm'));
    await flush(6);
    expect(state.calls.at(-1)).toEqual({ page: 1, filter: { status: 'DELIVERED' } });
    expect((c.querySelector('input[type="search"]') as HTMLInputElement).value).toBe('');
  });

  it('không khớp đơn nào: câu báo riêng, không nói "chưa có đơn hàng nào"', async () => {
    const c = await mount();
    typeInto(c.querySelector('input[type="search"]'), 'zzz');
    click(byText(c, 'button', 'Tìm'));
    await flush(6);
    expect(c.textContent).toContain('Không tìm thấy đơn nào khớp “zzz”');
    expect(c.textContent).not.toContain('Bạn chưa có đơn hàng nào');
  });

  it('ô tìm có nhãn, nút đủ vùng chạm', async () => {
    const c = await mount();
    expect(unnamedControls(c)).toEqual([]);
    expect(smallTouchTargets(c)).toEqual([]);
  });
});

describe('danh sách đơn — nút Thanh toán', () => {
  it('đơn chuyển khoản chờ tiền dẫn tới trang chuyển khoản như onPay của Mini App, đơn khác về chi tiết', async () => {
    state.orders = [
      { ...order('TB/1?', [item('Dầu gội')]), status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER', paymentDeadline: new Date(Date.now() + 3_600_000).toISOString() },
      { ...order('TB-2', [item('Xà phòng')]), status: 'PENDING_PAYMENT', paymentMethod: 'COD' },
      { ...order('TB-3', [item('Bàn chải')]), status: 'PAID', paymentMethod: 'BANK_TRANSFER' },
    ];
    const c = await mount();
    const pay = c.querySelector('a[aria-label="Thanh toán đơn TB/1?"]');
    expect(pay?.getAttribute('href')).toBe('/thanh-toan/chuyen-khoan/TB%2F1%3F');
    expect(c.querySelector('a[aria-label="Xem chi tiết đơn TB/1?"]')?.getAttribute('href')).toBe('/tai-khoan/don-hang/TB%2F1%3F');
    expect(c.querySelector('a[aria-label^="Thanh toán đơn TB-2"]')).toBeNull();
    expect(c.querySelector('a[aria-label^="Thanh toán đơn TB-3"]')).toBeNull();
    expect(c.querySelector('a[aria-label="Xem chi tiết đơn TB-3"]')?.getAttribute('href')).toBe('/tai-khoan/don-hang/TB-3');
  });

  it('đơn chuyển khoản quá hạn hoặc Tubu đang xử lý tay: không mời trả, về link Xem chi tiết như canPayOrderNow của Mini App', async () => {
    const past = new Date(Date.now() - 3_600_000).toISOString();
    const future = new Date(Date.now() + 3_600_000).toISOString();
    state.orders = [
      { ...order('TB-4', [item('Dầu gội')]), status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER', paymentDeadline: past },
      { ...order('TB-5', [item('Xà phòng')]), status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER', paymentDeadline: future, manualHandling: true },
    ];
    const c = await mount();
    for (const code of ['TB-4', 'TB-5']) {
      expect(c.querySelector(`a[aria-label="Thanh toán đơn ${code}"]`)).toBeNull();
      expect(c.querySelector(`a[aria-label="Xem chi tiết đơn ${code}"]`)?.getAttribute('href')).toBe(`/tai-khoan/don-hang/${code}`);
    }
  });

  it('đơn còn hạn ghi "Thanh toán ngay" và in hạn như thẻ đơn Mini App', async () => {
    state.orders = [
      { ...order('TB-6', [item('Dầu gội')]), status: 'PENDING_PAYMENT', paymentStatus: 'UNPAID', paymentMethod: 'BANK_TRANSFER', paymentDeadline: new Date(Date.now() + 3_600_000).toISOString() },
    ];
    const c = await mount();
    expect(c.querySelector('a[aria-label="Thanh toán đơn TB-6"]')?.textContent).toBe('Thanh toán ngay');
    expect(c.querySelector('li')!.textContent).toMatch(/Hạn \d/);
  });
});

describe('danh sách đơn — phân trang bằng con trỏ keyset', () => {
  it('API trả nextCursor: "Xem thêm" gửi con trỏ đó, dù tổng/limit báo đã hết trang kiểu offset', async () => {
    state.keyset = [
      { data: [order('TB-1', [item('A')])], nextCursor: 'CUR1' },
      { data: [order('TB-2', [item('B')])], nextCursor: null },
    ];
    const c = await mount();
    click(byText(c, 'button', 'Xem thêm đơn cũ hơn')!);
    await flush(6);
    expect(state.calls[1]).toMatchObject({ page: 2, cursor: 'CUR1' });
    expect(c.textContent).toContain('TB-2');
    expect(byText(c, 'button', 'Xem thêm đơn cũ hơn')).toBeNull();
  });

  it('đơn lặp giữa hai trang chỉ hiện một lần', async () => {
    state.keyset = [
      { data: [order('TB-1', [item('A')])], nextCursor: 'CUR1' },
      { data: [order('TB-1', [item('A')]), order('TB-2', [item('B')])], nextCursor: null },
    ];
    const c = await mount();
    click(byText(c, 'button', 'Xem thêm đơn cũ hơn')!);
    await flush(6);
    expect(c.textContent?.match(/TB-1/g)).toHaveLength(1);
  });
});

// W46B: thẻ đơn ở khối đơn của Tài khoản (desktop) có "Mua lại" như thẻ đơn của Mini App, dùng chung sheet và luồng với chi tiết đơn.
describe('danh sách đơn — nút Mua lại', () => {
  const lineItem = { id: 'i-1', variationId: 'v-1', productName: 'Dầu gội bưởi', variationName: '500ml', unitPrice: 100000, quantity: 1, total: 100000, thumbnail: null, stock: 9, available: true };
  const orderOf = (code: string, status: string) => ({ ...order(code, [lineItem as unknown as ReturnType<typeof item>]), id: `id-${code}`, status });
  const fetched: { path: string; body: unknown }[] = [];
  const reorderLabels = (c: HTMLElement) =>
    Array.from(c.querySelectorAll('button')).map((b) => b.getAttribute('aria-label') ?? '').filter((l) => l.startsWith('Mua lại đơn '));

  beforeEach(() => {
    fetched.length = 0;
    state.push.mockReset();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const path = new URL(url).pathname.replace(/^\/api/, '');
        fetched.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
        const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } });
        if (path.endsWith('/repurchase')) return json({ items: [], results: [{ orderItemId: 'i-1', status: 'added', addedQuantity: 1 }] });
        return json({});
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('chỉ đơn đã xong (đã giao, đã huỷ, đã hoàn) có "Mua lại", nhãn nêu mã đơn; đơn còn đang chạy thì không', async () => {
    state.orders = [
      orderOf('TB-1', 'DELIVERED'), orderOf('TB-2', 'CANCELLED'), orderOf('TB-3', 'RETURNED'),
      orderOf('TB-4', 'PENDING_PAYMENT'), orderOf('TB-5', 'CONFIRMED'), orderOf('TB-6', 'PACKED'), orderOf('TB-7', 'SHIPPING'),
    ];
    const c = await mount();
    expect(reorderLabels(c)).toEqual(['Mua lại đơn TB-1', 'Mua lại đơn TB-2', 'Mua lại đơn TB-3']);
    expect(byText(c, 'button', 'Mua lại')).not.toBeNull();
  });

  it('nút có tên, đủ vùng chạm 44px, đứng cạnh liên kết "Xem chi tiết" của cùng thẻ', async () => {
    state.orders = [orderOf('TB-1', 'DELIVERED')];
    const c = await mount();
    expect(unnamedControls(c)).toEqual([]);
    expect(smallTouchTargets(c)).toEqual([]);
    const button = c.querySelector('button[aria-label="Mua lại đơn TB-1"]')!;
    const detail = c.querySelector('a[aria-label="Xem chi tiết đơn TB-1"]')!;
    expect(button.parentElement).toBe(detail.parentElement);
  });

  it('chưa bấm thì chưa dựng sheet và không gọi API nào; bấm mở sheet đúng đơn với dòng đã mua', async () => {
    state.orders = [orderOf('TB-1', 'DELIVERED')];
    const c = await mount();
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(fetched).toEqual([]);
    click(c.querySelector('button[aria-label="Mua lại đơn TB-1"]'));
    await flush(6);
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.body.textContent).toContain('Từ đơn TB-1');
    expect(document.body.textContent).toContain('Dầu gội bưởi');
  });

  it('"Thêm vào giỏ" gửi repurchase đúng body như chi tiết đơn rồi chuyển sang giỏ', async () => {
    state.orders = [orderOf('TB-1', 'DELIVERED')];
    const c = await mount();
    click(c.querySelector('button[aria-label="Mua lại đơn TB-1"]'));
    await flush(6);
    click(byText(document.body, 'button', 'Thêm vào giỏ (1)'));
    await flush(8);
    expect(fetched.find((f) => f.path === '/orders/TB-1/repurchase')?.body).toEqual({ items: [{ orderItemId: 'i-1', quantity: 1 }], addSource: 'repurchase' });
    expect(state.push).toHaveBeenCalledWith('/gio-hang');
  });

  it('mở đơn thứ nhất, đổi số lượng, đóng rồi mở đơn thứ hai: sheet theo đơn mới và số lượng mặc định, không giữ lựa chọn cũ', async () => {
    state.orders = [orderOf('TB-1', 'DELIVERED'), orderOf('TB-2', 'DELIVERED')];
    const c = await mount();
    click(c.querySelector('button[aria-label="Mua lại đơn TB-1"]'));
    await flush(6);
    expect(document.body.textContent).toContain('Từ đơn TB-1');
    click(document.querySelector('button[aria-label^="Tăng số lượng"]'));
    await flush(2);
    expect(byText(document.body, 'button', 'Thêm vào giỏ (2)')).not.toBeNull();
    click(document.querySelector('button[aria-label="Đóng"]'));
    await flush(4);
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();

    click(c.querySelector('button[aria-label="Mua lại đơn TB-2"]'));
    await flush(6);
    expect(document.body.textContent).toContain('Từ đơn TB-2');
    expect(document.body.textContent).not.toContain('Từ đơn TB-1');
    expect(byText(document.body, 'button', 'Thêm vào giỏ (1)')).not.toBeNull();
    expect(byText(document.body, 'button', 'Thêm vào giỏ (2)')).toBeNull();
  });
});
