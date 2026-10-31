// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, flush, render, type Rendered } from '@/test-utils/dom';
import { headingProblems, smallTouchTargets, unnamedControls } from '@/test-utils/a11y';

// Cùng ý nghĩa wishlist.tsx của Mini App: chỉ gọi /me/wishlist khi đã đăng nhập, lưới thẻ sản phẩm, trạng thái rỗng và lỗi có Thử lại.

const mocks = vi.hoisted(() => ({
  phase: 'authenticated' as 'authenticated' | 'guest' | 'loading' | 'unavailable',
  get: vi.fn(),
  post: vi.fn(),
}));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => mocks.phase }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ retrySession: vi.fn() }) }));
vi.mock('next/navigation', () => ({ usePathname: () => '/', useRouter: () => ({ push: () => undefined }) }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get, post: mocks.post } }));
// Bảng chọn thật nạp qua next/dynamic; thay bằng bản rút gọn để test không phụ thuộc bảng đáy.
vi.mock('@/components/variation-sheet', () => ({
  VariationSheet: (p: { open: boolean; variations: { id: string }[]; onConfirm: (v: { id: string }, qty: number) => void }) =>
    p.open ? (
      <div data-testid="variation-sheet">
        <button type="button" onClick={() => p.onConfirm(p.variations[1]!, 2)}>
          xác nhận phân loại
        </button>
      </div>
    ) : null,
}));

import WishlistPage from './page';
import { QUICK_ADD_SOLD_OUT } from '@tubutree/app-core/quick-add';

const card = (id: string, name: string) => ({
  id, slug: `sp-${id}`, brand: 'Tubu', name, thumbnail: null, basePrice: 100000, salePrice: null, isFeatured: false, inStock: true,
});

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<WishlistPage />);
  mounted.push(r);
  await flush(4);
  return r.container;
};

beforeEach(() => {
  mocks.phase = 'authenticated';
  mocks.get.mockReset().mockResolvedValue([card('a', 'Nước rửa chén'), card('b', 'Xà phòng')]);
  mocks.post.mockReset().mockResolvedValue({ items: [] });
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('/tai-khoan/yeu-thich — Sản phẩm yêu thích', () => {
  it('đã đăng nhập: gọi /me/wishlist và hiện thẻ sản phẩm dẫn tới trang sản phẩm', async () => {
    const c = await mount();
    expect(mocks.get).toHaveBeenCalledWith('/me/wishlist');
    expect(c.querySelector('h1')?.textContent).toBe('Sản phẩm yêu thích');
    const links = Array.from(c.querySelectorAll('a[href^="/san-pham/"]')).map((a) => a.getAttribute('href'));
    expect(links).toEqual(['/san-pham/sp-a', '/san-pham/sp-b']);
    expect(c.textContent).toContain('Nước rửa chén');
  });

  it('khách chưa đăng nhập: mời đăng nhập, quay lại đúng trang, không gọi API (tránh 401)', async () => {
    mocks.phase = 'guest';
    const c = await mount();
    expect(c.querySelector('a[href^="/dang-nhap"]')?.getAttribute('href')).toBe('/dang-nhap?returnTo=%2Ftai-khoan%2Fyeu-thich');
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('đang khôi phục phiên: hiện đang tải, không gọi API', async () => {
    mocks.phase = 'loading';
    const c = await mount();
    expect(c.textContent).toContain('Đang tải');
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('phiên chập chờn (unavailable): nói mất kết nối, không mời đăng nhập', async () => {
    mocks.phase = 'unavailable';
    const c = await mount();
    expect(c.textContent).toContain('Không kết nối được với Tubu Tree');
    expect(c.querySelector('a[href^="/dang-nhap"]')).toBeNull();
  });

  it('chưa có sản phẩm: trạng thái rỗng, "Khám phá sản phẩm" sang /san-pham', async () => {
    mocks.get.mockResolvedValue([]);
    const c = await mount();
    expect(c.textContent).toContain('Chưa có sản phẩm yêu thích');
    expect(c.textContent).toContain('Chạm biểu tượng trái tim trên sản phẩm để lưu lại xem sau.');
    expect(c.querySelector('a[href="/san-pham"]')?.textContent).toBe('Khám phá sản phẩm');
  });

  it('lỗi tải: báo lỗi và Thử lại tải lại danh sách', async () => {
    mocks.get.mockRejectedValueOnce(new Error('boom'));
    const c = await mount();
    expect(c.querySelector('[role="alert"]')).not.toBeNull();
    click(Array.from(c.querySelectorAll('button')).find((b) => b.textContent === 'Thử lại')!);
    await flush(4);
    // Tim trên thẻ gọi thêm danh sách id yêu thích; chỉ đếm lần tải danh sách.
    expect(mocks.get.mock.calls.filter(([path]) => path === '/me/wishlist')).toHaveLength(2);
    expect(c.textContent).toContain('Nước rửa chén');
  });

  it('một h1, điều khiển có tên, vùng chạm đủ 44px', async () => {
    const c = await mount();
    expect(headingProblems(c)).toEqual([]);
    expect(unnamedControls(c)).toEqual([]);
    expect(smallTouchTargets(c)).toEqual([]);
  });
});

describe('/tai-khoan/yeu-thich — nút giỏ nhanh', () => {
  const variation = (id: string, stock = 5) => ({ id, name: `Loại ${id}`, sku: id, attributes: {}, retailPrice: 100000, salePrice: null, stock });
  let detail: { variations: ReturnType<typeof variation>[] };

  beforeEach(() => {
    detail = { variations: [variation('v1')] };
    mocks.get.mockImplementation(async (path: string) => {
      if (path === '/me/wishlist') return [card('a', 'Nước rửa chén'), { ...card('b', 'Xà phòng'), inStock: false }, { ...card('c', 'Dầu gội'), salePrice: 80000 }];
      if (path.startsWith('/products/')) return detail;
      return [];
    });
  });

  const addButton = (c: HTMLElement, name: string) => c.querySelector<HTMLButtonElement>(`button[aria-label="Thêm ${name} vào giỏ"]`);

  it('chỉ thẻ còn hàng có nút, có tên đọc màn hình và vùng chạm 44px; thẻ hết hàng ghi "Hết hàng", thẻ giảm giá ghi % giảm', async () => {
    const c = await mount();
    expect(addButton(c, 'Nước rửa chén')).not.toBeNull();
    expect(addButton(c, 'Dầu gội')).not.toBeNull();
    expect(addButton(c, 'Xà phòng')).toBeNull();
    expect(addButton(c, 'Nước rửa chén')!.className).toContain('h-11');
    expect(addButton(c, 'Nước rửa chén')!.className).toContain('w-11');
    expect(c.textContent).toContain('Hết hàng');
    expect(c.textContent).toContain('-20%');
    expect(unnamedControls(c)).toEqual([]);
    expect(smallTouchTargets(c)).toEqual([]);
  });

  it('một phân loại: thêm thẳng 1 sản phẩm với nguồn wishlist, báo đã thêm và không mở bảng chọn', async () => {
    const c = await mount();
    click(addButton(c, 'Nước rửa chén')!);
    await flush(6);
    expect(mocks.get).toHaveBeenCalledWith('/products/sp-a');
    const [path, body] = mocks.post.mock.calls[0]!;
    expect(path).toBe('/cart/items');
    expect(body).toEqual({ variationId: 'v1', quantity: 1, addSource: 'wishlist' });
    expect(c.querySelector('[role="status"]')?.textContent).toContain('Đã thêm');
    expect(c.querySelector('[data-testid="variation-sheet"]')).toBeNull();
  });

  it('nhiều phân loại: mở bảng chọn, chỉ thêm khi khách xác nhận', async () => {
    detail = { variations: [variation('v1'), variation('v2')] };
    const c = await mount();
    click(addButton(c, 'Nước rửa chén')!);
    await flush(8);
    expect(c.querySelector('[data-testid="variation-sheet"]')).not.toBeNull();
    expect(mocks.post).not.toHaveBeenCalled();
    click(Array.from(c.querySelectorAll('button')).find((b) => b.textContent === 'xác nhận phân loại')!);
    await flush(6);
    expect(mocks.post.mock.calls[0]![1]).toEqual({ variationId: 'v2', quantity: 2, addSource: 'wishlist' });
    expect(c.querySelector('[data-testid="variation-sheet"]')).toBeNull();
  });

  it('hết hàng ngay lúc bấm (tồn đã đổi): báo cho khách, không thêm giỏ', async () => {
    detail = { variations: [variation('v1', 0)] };
    const c = await mount();
    click(addButton(c, 'Nước rửa chén')!);
    await flush(6);
    expect(mocks.post).not.toHaveBeenCalled();
    expect(c.querySelector('[role="alert"]')?.textContent).toBe(QUICK_ADD_SOLD_OUT);
    // Tải lại danh sách để thẻ hiện lớp "Hết hàng" và bỏ nút giỏ; bấm lại không ra cùng lời báo.
    expect(mocks.get.mock.calls.filter(([path]) => path === '/me/wishlist').length).toBeGreaterThanOrEqual(2);
  });

  it('thêm giỏ lỗi: nói rõ lỗi và nút bấm lại được', async () => {
    mocks.post.mockRejectedValueOnce(new Error('boom'));
    const c = await mount();
    click(addButton(c, 'Nước rửa chén')!);
    await flush(6);
    expect(c.querySelector('[role="alert"]')).not.toBeNull();
    expect(addButton(c, 'Nước rửa chén')!.disabled).toBe(false);
  });
});
