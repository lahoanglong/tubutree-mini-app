// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';

// Bảng chọn THẬT (không thay bằng bản rút gọn như page.spec): thêm nhanh từ Yêu thích dùng cùng VariationSheet với trang sản phẩm,
// nên nút "Thêm vào giỏ" phải ghi đúng số tiền giỏ tăng khi giỏ đã có sẵn cùng phân loại (máy chủ giá Giờ vàng trên cả dòng).

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
}));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => 'authenticated' }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ retrySession: vi.fn() }) }));
vi.mock('next/navigation', () => ({ usePathname: () => '/', useRouter: () => ({ push: () => undefined }) }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get, post: mocks.post } }));
// Cùng một mảng ở mọi lần vẽ (như kho thật), có itemId để hỏi số suất theo khách.
const FLASH = vi.hoisted(() => [{ itemId: 'fi-var-1', productSlug: 'khan-uot', variationId: 'var-1', flashPrice: 26_000, perUserLimit: 3 }]);
vi.mock('@/lib/use-flash-sales', () => ({
  useActiveFlashSales: () => FLASH,
}));

import WishlistPage from './page';

const variation = (id: string, retailPrice: number) => ({ id, name: `Loại ${id}`, sku: id, attributes: {}, retailPrice, salePrice: null, stock: 245 });
const detail = { id: 'p1', slug: 'khan-uot', name: 'Khăn ướt', thumbnail: null, variations: [variation('var-1', 35_000), variation('var-2', 20_000)] };
const card = { id: 'p1', slug: 'khan-uot', brand: 'Tubu', name: 'Khăn ướt', thumbnail: null, basePrice: 35_000, salePrice: null, isFeatured: false, inStock: true, repVariationId: 'var-1' };

let cartItems: { id: string; variationId: string; quantity: number }[] = [];
let cartFails = false;
let allowance: Record<string, { perUserLeft: number; allowance: number }> | Error = new Error('404');
let mounted: Rendered[] = [];

beforeEach(() => {
  cartItems = [];
  cartFails = false;
  allowance = new Error('404');
  mocks.post.mockReset().mockResolvedValue({ items: [] });
  mocks.get.mockReset().mockImplementation(async (path: string) => {
    if (path === '/me/wishlist') return [card];
    if (path.startsWith('/products/')) return detail;
    if (path.startsWith('/flash-sales/me/allowance')) {
      if (allowance instanceof Error) throw allowance;
      return { items: allowance };
    }
    if (path === '/cart') {
      if (cartFails) throw new Error('boom');
      return { items: cartItems, itemCount: cartItems.reduce((n, l) => n + l.quantity, 0) };
    }
    return [];
  });
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  document.body.innerHTML = '';
});

const dialog = () => document.body.querySelector('[role="dialog"]') as HTMLElement | null;
const confirmButton = () => byText(dialog()!, 'button', /^Thêm vào giỏ/) as HTMLButtonElement;
const status = () => dialog()!.querySelector('[role="status"]');

async function openSheet() {
  const r = render(<WishlistPage />);
  mounted.push(r);
  await flush(4);
  click(r.container.querySelector('button[aria-label="Thêm Khăn ướt vào giỏ"]'));
  // Bảng nạp qua next/dynamic: lần đầu trong tiến trình phải chờ chunk, nên chờ tới khi có hộp thoại thay vì đếm số lượt flush.
  for (let i = 0; i < 40 && !dialog(); i++) await flush(2);
  expect(dialog()).not.toBeNull();
}

describe('/tai-khoan/yeu-thich: bảng Thêm nhanh đọc giỏ để ghi đúng tiền', () => {
  it('ví dụ reviewer (giới hạn 3, giỏ có 2 gói var-1, chọn 2): nút ghi phần giỏ tăng 88.000đ, không phải 52.000đ', async () => {
    cartItems = [{ id: 'l1', variationId: 'var-1', quantity: 2 }];
    await openSheet();
    click(dialog()!.querySelector('button[aria-label="Tăng số lượng"]'));
    await flush(2);
    expect(confirmButton().textContent).toBe('Thêm vào giỏ · 88.000đ');
    expect(status()!.textContent).toBe('Giỏ đã có 2. Thêm 2 thì cả 4 sản phẩm tính giá thường.');
  });

  it('giỏ đang đúng giới hạn (3), thêm nhanh 1: nút ghi 62.000đ (4 × 35.000 − 3 × 26.000), không phải 26.000đ', async () => {
    cartItems = [{ id: 'l1', variationId: 'var-1', quantity: 3 }];
    await openSheet();
    expect(confirmButton().textContent).toBe('Thêm vào giỏ · 62.000đ');
    expect(status()!.textContent).toBe('Giỏ đã có 3. Thêm 1 thì cả 4 sản phẩm tính giá thường.');
  });

  it('giỏ rỗng hoặc chỉ có phân loại khác: số như trước (1 × giá Giờ vàng, không ghi chú)', async () => {
    cartItems = [{ id: 'l2', variationId: 'var-2', quantity: 9 }];
    await openSheet();
    expect(confirmButton().textContent).toBe('Thêm vào giỏ · 26.000đ');
    expect(status()!.textContent).toBe('');
  });

  it('giỏ lỗi: coi như rỗng, bảng vẫn mở và nút vẫn bấm được', async () => {
    cartFails = true;
    await openSheet();
    expect(confirmButton().textContent).toBe('Thêm vào giỏ · 26.000đ');
    expect(confirmButton().disabled).toBe(false);
  });
  it('đã dùng hết suất Giờ vàng ở đơn trước (perUserLeft 0): nút ghi giá thường 35.000đ, ghi chú hết suất; chỉ gọi endpoint khi mở bảng', async () => {
    allowance = { 'fi-var-1': { perUserLeft: 0, allowance: 0 } };
    const r = render(<WishlistPage />);
    mounted.push(r);
    await flush(4);
    expect(mocks.get.mock.calls.some(([p]) => String(p).startsWith('/flash-sales/me/allowance'))).toBe(false);
    click(r.container.querySelector('button[aria-label="Thêm Khăn ướt vào giỏ"]'));
    for (let i = 0; i < 40 && !dialog(); i++) await flush(2);
    await flush(3);
    expect(confirmButton().textContent).toBe('Thêm vào giỏ · 35.000đ');
    expect(status()!.textContent).toBe('Bạn không còn suất Giờ vàng của sản phẩm này nên tính giá thường.');
    const asked = mocks.get.mock.calls.map(([p]) => String(p)).filter((p) => p.startsWith('/flash-sales/me/allowance'));
    expect(asked).toEqual(['/flash-sales/me/allowance?items=fi-var-1']);
  });

  it('endpoint lỗi: bảng ghi số như trước (1 × giá Giờ vàng)', async () => {
    await openSheet();
    await flush(3);
    expect(confirmButton().textContent).toBe('Thêm vào giỏ · 26.000đ');
    expect(status()!.textContent).toBe('');
  });
});
