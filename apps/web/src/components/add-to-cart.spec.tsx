// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';

// BUYERWEB-15: khách bấm "Thêm vào giỏ" khi chưa đăng nhập phải quay lại đúng sản phẩm và món đó được thêm nốt.
// BUYERWEB-9: tồn kho trong HTML là bản ISR cũ; trang hỏi lại tồn kho thật.

const mocks = vi.hoisted(() => ({
  auth: { status: 'idle' as string, initialized: true, user: null as unknown },
  push: vi.fn(),
  addToCart: vi.fn(),
  getProductStock: vi.fn(),
}));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => mocks.auth }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push, replace: vi.fn() }) }));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  addToCart: mocks.addToCart,
  getProductStock: mocks.getProductStock,
}));

import AddToCart from './add-to-cart';

const VARIATIONS = [
  { id: 'v1', name: '250ml', retailPrice: 200000, salePrice: 150000, stock: 5 },
  { id: 'v2', name: '500ml', retailPrice: 300000, salePrice: null, stock: 9 },
];
const CART = { items: [], itemCount: 2 };

let mounted: Rendered[] = [];
const mount = (variations = VARIATIONS) => {
  const r = render(<AddToCart slug="dau-goi" variations={variations} />);
  mounted.push(r);
  return r;
};
const addButton = (c: HTMLElement) => byText(c, 'button', /Thêm vào giỏ|Hết hàng|Đang thêm/) as HTMLButtonElement;

beforeEach(() => {
  sessionStorage.clear();
  mocks.auth = { status: 'idle', initialized: true, user: null };
  mocks.push.mockReset();
  mocks.addToCart.mockReset().mockResolvedValue(CART);
  mocks.getProductStock.mockReset().mockResolvedValue({ v1: 5, v2: 9 });
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('AddToCart — khách chưa đăng nhập', () => {
  it('chuyển sang đăng nhập kèm returnTo về đúng trang sản phẩm và nhớ phân loại + số lượng đã chọn', async () => {
    const { container } = mount();
    await flush();
    click(byText(container, 'button', '500ml'));
    click(container.querySelector('button[aria-label="Tăng số lượng"]'));
    click(container.querySelector('button[aria-label="Tăng số lượng"]'));
    click(addButton(container));
    expect(mocks.push).toHaveBeenCalledWith('/dang-nhap?returnTo=%2Fsan-pham%2Fdau-goi');
    expect(JSON.parse(sessionStorage.getItem('tubu_pending_add')!)).toMatchObject({ variationId: 'v2', quantity: 3 });
    expect(mocks.addToCart).not.toHaveBeenCalled();
  });

  it('đang khôi phục phiên (initialized=false): nút tạm khoá, không đẩy khách đang đăng nhập sang trang đăng nhập', async () => {
    mocks.auth = { status: 'idle', initialized: false, user: null };
    const { container } = mount();
    await flush();
    expect(addButton(container).disabled).toBe(true);
    click(addButton(container));
    expect(mocks.push).not.toHaveBeenCalled();
  });
});

describe('AddToCart — quay lại sau đăng nhập', () => {
  it('thêm nốt món đã chọn trước khi đăng nhập và báo "Đã thêm vào giỏ!"', async () => {
    sessionStorage.setItem('tubu_pending_add', JSON.stringify({ variationId: 'v2', quantity: 3, at: Date.now() }));
    mocks.auth = { status: 'authenticated', initialized: true, user: { id: 'u1' } };
    const { container } = mount();
    await flush();
    expect(mocks.addToCart).toHaveBeenCalledTimes(1);
    expect(mocks.addToCart).toHaveBeenCalledWith('v2', 3);
    expect(container.textContent).toContain('Đã thêm vào giỏ!');
    expect(sessionStorage.getItem('tubu_pending_add')).toBeNull();
    expect(container.querySelector('button[aria-pressed="true"]')!.textContent).toContain('500ml');
  });

  it('không có món chờ thì không tự thêm gì', async () => {
    mocks.auth = { status: 'authenticated', initialized: true, user: { id: 'u1' } };
    mount();
    await flush();
    expect(mocks.addToCart).not.toHaveBeenCalled();
  });

  it('món chờ của sản phẩm khác không bị thêm nhầm vào trang này', async () => {
    sessionStorage.setItem('tubu_pending_add', JSON.stringify({ variationId: 'khac', quantity: 1, at: Date.now() }));
    mocks.auth = { status: 'authenticated', initialized: true, user: { id: 'u1' } };
    mount();
    await flush();
    expect(mocks.addToCart).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('tubu_pending_add')).not.toBeNull();
  });

  it('API từ chối (hết hàng) thì hiện lời nhắn của API thay vì im lặng', async () => {
    sessionStorage.setItem('tubu_pending_add', JSON.stringify({ variationId: 'v1', quantity: 2, at: Date.now() }));
    mocks.addToCart.mockRejectedValue(new Error('Chỉ còn 0 sản phẩm trong kho.'));
    mocks.auth = { status: 'authenticated', initialized: true, user: { id: 'u1' } };
    const { container } = mount();
    await flush();
    expect(container.textContent).toContain('Chỉ còn 0 sản phẩm trong kho.');
  });
});

describe('AddToCart — tồn kho thật thay cho bản ISR', () => {
  it('ISR báo còn hàng nhưng tồn thật = 0: nút "Hết hàng" và không cho thêm', async () => {
    mocks.auth = { status: 'authenticated', initialized: true, user: { id: 'u1' } };
    mocks.getProductStock.mockResolvedValue({ v1: 0 });
    const { container } = mount([VARIATIONS[0]!]);
    await flush();
    expect(addButton(container).textContent).toBe('Hết hàng');
    expect(addButton(container).disabled).toBe(true);
  });

  it('ISR báo hết nhưng vừa nhập kho: cho mua lại', async () => {
    mocks.auth = { status: 'authenticated', initialized: true, user: { id: 'u1' } };
    mocks.getProductStock.mockResolvedValue({ v1: 4 });
    const { container } = mount([{ ...VARIATIONS[0]!, stock: 0 }]);
    await flush();
    expect(addButton(container).disabled).toBe(false);
    expect(container.textContent).toContain('Chỉ còn 4 sản phẩm');
  });

  it('phân loại mặc định hết thật mà phân loại khác còn: tự chọn phân loại còn hàng', async () => {
    mocks.getProductStock.mockResolvedValue({ v1: 0, v2: 9 });
    const { container } = mount();
    await flush();
    expect(container.querySelector('button[aria-pressed="true"]')!.textContent).toContain('500ml');
  });

  it('khách đã tự chọn phân loại thì không bị đổi ngầm', async () => {
    mocks.getProductStock.mockImplementation(() => new Promise((r) => setTimeout(() => r({ v1: 0, v2: 9 }), 0)));
    const { container } = mount();
    click(byText(container, 'button', '250ml'));
    await flush();
    expect(container.querySelector('button[aria-pressed="true"]')!.textContent).toContain('250ml');
  });

  it('số lượng không vượt tồn thật', async () => {
    mocks.auth = { status: 'authenticated', initialized: true, user: { id: 'u1' } };
    mocks.getProductStock.mockResolvedValue({ v1: 2, v2: 9 });
    const { container } = mount();
    await flush();
    for (let i = 0; i < 5; i++) click(container.querySelector('button[aria-label="Tăng số lượng"]'));
    click(addButton(container));
    await flush();
    expect(mocks.addToCart).toHaveBeenCalledWith('v1', 2);
  });

  it('không lấy được tồn thật (API lỗi): vẫn dùng bản ISR, không vỡ trang', async () => {
    mocks.getProductStock.mockRejectedValue(new Error('x'));
    const { container } = mount();
    await flush();
    expect(addButton(container).disabled).toBe(false);
  });
});
