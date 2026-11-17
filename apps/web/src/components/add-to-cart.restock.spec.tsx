// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, flush, render, type Rendered } from '@/test-utils/dom';

// "Báo tôi khi có hàng" thay nút xám "Tạm hết hàng" khi cờ catalog.restock_alert_enabled bật (wave tubu-notify-cap-restock).

const mocks = vi.hoisted(() => ({
  auth: { status: 'idle' as string, initialized: true, user: null as unknown },
  push: vi.fn(),
  getProductStock: vi.fn(),
  getActiveFlashSales: vi.fn(),
  getFlashAllowance: vi.fn(),
  getCart: vi.fn(),
  fetchRestockStatus: vi.fn(),
  subscribeRestock: vi.fn(),
  unsubscribeRestock: vi.fn(),
}));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => mocks.auth }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push, replace: vi.fn() }) }));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  getProductStock: mocks.getProductStock,
  getActiveFlashSales: mocks.getActiveFlashSales,
  getFlashAllowance: mocks.getFlashAllowance,
  getCart: mocks.getCart,
}));
vi.mock('@tubutree/app-core/api/restock-alerts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tubutree/app-core/api/restock-alerts')>()),
  fetchRestockStatus: mocks.fetchRestockStatus,
  subscribeRestock: mocks.subscribeRestock,
  unsubscribeRestock: mocks.unsubscribeRestock,
}));

import AddToCart from './add-to-cart';
import { resetFlashSales } from '@/lib/use-flash-sales';

const OUT = [{ id: 'v1', name: '250ml', retailPrice: 200000, salePrice: null, stock: 0 }];
const MIXED = [
  { id: 'v1', name: '250ml', retailPrice: 200000, salePrice: null, stock: 0 },
  { id: 'v2', name: '500ml', retailPrice: 300000, salePrice: null, stock: 4 },
];

let mounted: Rendered[] = [];
const mount = (variations = OUT, productId: string | null = 'p1') => {
  const r = render(<AddToCart slug="dau-goi" variations={variations} productId={productId ?? undefined} />);
  mounted.push(r);
  return r;
};
const restockButton = (c: HTMLElement) => c.querySelector<HTMLButtonElement>('[data-testid="pdp-restock"]');
const authed = () => {
  mocks.auth = { status: 'authenticated', initialized: true, user: { id: 'u1' } };
};

beforeEach(() => {
  sessionStorage.clear();
  mocks.auth = { status: 'idle', initialized: true, user: null };
  mocks.push.mockReset();
  mocks.getProductStock.mockReset().mockResolvedValue({ v1: 0, v2: 4 });
  resetFlashSales();
  mocks.getActiveFlashSales.mockReset().mockResolvedValue([]);
  mocks.getCart.mockReset().mockResolvedValue({ items: [], itemCount: 0 });
  mocks.getFlashAllowance.mockReset().mockRejectedValue(new Error('404'));
  mocks.fetchRestockStatus.mockReset().mockResolvedValue({ enabled: true, variationIds: [] });
  mocks.subscribeRestock.mockReset().mockResolvedValue({ variationId: 'v1', subscribed: true });
  mocks.unsubscribeRestock.mockReset().mockResolvedValue({ variationId: 'v1', subscribed: false });
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('AddToCart — Báo tôi khi có hàng', () => {
  it('cờ tắt: vẫn nút xám "Tạm hết hàng", không có nút báo hàng về', async () => {
    authed();
    mocks.fetchRestockStatus.mockResolvedValue({ enabled: false, variationIds: [] });
    const { container } = mount();
    await flush();
    expect(restockButton(container)).toBeNull();
    const grey = [...container.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Tạm hết hàng' && b.disabled);
    expect(grey).toBeDefined();
  });

  it('không có mã sản phẩm (khối mua ngoài trang sản phẩm): không hỏi trạng thái, giữ nút xám', async () => {
    authed();
    const { container } = mount(OUT, null);
    await flush();
    expect(mocks.fetchRestockStatus).not.toHaveBeenCalled();
    expect(restockButton(container)).toBeNull();
  });

  it('phân loại đang chọn còn hàng: thanh mua như thường, không có nút báo hàng về', async () => {
    authed();
    const { container } = mount(MIXED);
    await flush();
    expect(restockButton(container)).toBeNull();
    expect(container.querySelector('[data-testid="buy-now"]')).not.toBeNull();
  });

  it('cờ bật: chip phân loại hết hàng chọn được, chọn nó thì nút chính thành "Báo tôi khi có hàng" và đăng ký đúng phân loại đó', async () => {
    authed();
    const { container } = mount(MIXED);
    await flush();
    const outChip = [...container.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.startsWith('250ml'))!;
    expect(outChip.disabled).toBe(false);
    click(outChip);
    await flush();
    expect(restockButton(container)!.textContent).toBe('Báo tôi khi có hàng');
    click(restockButton(container));
    await flush();
    expect(mocks.subscribeRestock).toHaveBeenCalledWith(expect.anything(), 'v1');
  });

  it('cờ tắt: chip phân loại hết hàng vẫn khoá như trước', async () => {
    authed();
    mocks.fetchRestockStatus.mockResolvedValue({ enabled: false, variationIds: [] });
    const { container } = mount(MIXED);
    await flush();
    const outChip = [...container.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.startsWith('250ml'))!;
    expect(outChip.disabled).toBe(true);
  });

  it('đã đăng nhập: bấm "Báo tôi khi có hàng" thì đăng ký, nút thành "Đã đăng ký báo hàng · Huỷ"; bấm lại thì huỷ', async () => {
    authed();
    const { container } = mount();
    await flush();
    expect(mocks.fetchRestockStatus).toHaveBeenCalledWith(expect.anything(), 'p1', { anonymous: false });
    expect(restockButton(container)!.textContent).toBe('Báo tôi khi có hàng');
    expect(restockButton(container)!.getAttribute('aria-pressed')).toBe('false');
    mocks.fetchRestockStatus.mockResolvedValue({ enabled: true, variationIds: ['v1'] });
    click(restockButton(container));
    await flush();
    expect(mocks.subscribeRestock).toHaveBeenCalledTimes(1);
    expect(mocks.subscribeRestock).toHaveBeenCalledWith(expect.anything(), 'v1');
    expect(restockButton(container)!.textContent).toBe('Đã đăng ký báo hàng · Huỷ');
    expect(restockButton(container)!.getAttribute('aria-pressed')).toBe('true');
    expect(container.textContent).toContain('Có hàng Tubu sẽ báo bạn ở mục Thông báo.');
    mocks.fetchRestockStatus.mockResolvedValue({ enabled: true, variationIds: [] });
    click(restockButton(container));
    await flush();
    expect(mocks.unsubscribeRestock).toHaveBeenCalledWith(expect.anything(), 'v1');
    expect(restockButton(container)!.textContent).toBe('Báo tôi khi có hàng');
  });

  it('đăng ký lỗi: nút về như cũ và báo lỗi', async () => {
    authed();
    mocks.subscribeRestock.mockRejectedValue(new Error('Bạn đang chờ báo hàng về cho 20 sản phẩm, đã đủ số tối đa.'));
    const { container } = mount();
    await flush();
    click(restockButton(container));
    await flush();
    expect(restockButton(container)!.textContent).toBe('Báo tôi khi có hàng');
  });

  it('khách chưa đăng nhập: nhớ phân loại, sang đăng nhập rồi quay lại đúng trang; không gọi đăng ký', async () => {
    const { container } = mount();
    await flush();
    expect(mocks.fetchRestockStatus).toHaveBeenCalledWith(expect.anything(), 'p1', { anonymous: true });
    click(restockButton(container));
    expect(mocks.push).toHaveBeenCalledWith('/dang-nhap?returnTo=%2Fsan-pham%2Fdau-goi');
    expect(JSON.parse(sessionStorage.getItem('tubu_pending_restock')!)).toMatchObject({ variationId: 'v1' });
    expect(mocks.subscribeRestock).not.toHaveBeenCalled();
  });

  it('quay lại sau đăng nhập: đăng ký nốt đúng một lần (dù có hai nút điện thoại và máy tính), xoá ý định', async () => {
    authed();
    sessionStorage.setItem('tubu_pending_restock', JSON.stringify({ variationId: 'v1', at: Date.now() }));
    mount();
    await flush();
    await flush();
    expect(mocks.subscribeRestock).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem('tubu_pending_restock')).toBeNull();
  });

  it('quay lại sau đăng nhập mà khách đã đăng ký từ trước: không gửi lại (gửi lại là huỷ)', async () => {
    authed();
    mocks.fetchRestockStatus.mockResolvedValue({ enabled: true, variationIds: ['v1'] });
    sessionStorage.setItem('tubu_pending_restock', JSON.stringify({ variationId: 'v1', at: Date.now() }));
    mount();
    await flush();
    await flush();
    expect(mocks.subscribeRestock).not.toHaveBeenCalled();
    expect(mocks.unsubscribeRestock).not.toHaveBeenCalled();
  });
});
