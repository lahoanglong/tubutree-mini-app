// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QUICK_ADD_SOLD_OUT } from '@tubutree/app-core/quick-add';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { flush, render, type Rendered } from '@/test-utils/dom';
import { GUEST_CART_KEY } from '@/lib/guest-cart/store';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  push: vi.fn(),
  phase: 'authenticated' as 'authenticated' | 'guest' | 'loading',
}));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => mocks.phase }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get, post: mocks.post, delete: vi.fn() } }));
vi.mock('@/lib/shop-client', () => ({ getActiveFlashSales: async () => [] }));
vi.mock('@/lib/cart-feedback', () => ({ playCartFeedback: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }), usePathname: () => '/' }));
vi.mock('@/components/variation-sheet', () => ({
  VariationSheet: (p: { open: boolean; variations: { id: string; stock: number }[]; onConfirm: (v: { id: string; stock: number }, qty: number) => void }) =>
    p.open ? (
      <div data-testid="variation-sheet">
        <button type="button" data-testid="sheet-confirm" onClick={() => p.onConfirm(p.variations[1]!, 2)}>
          xác nhận
        </button>
      </div>
    ) : null,
}));

import { ProductCard } from '@/components/mini/product-card';
import { HomeQuickAddProvider } from './home-quick-add';

const product = (over: Record<string, unknown> = {}) => ({
  id: 'p1', slug: 'nuoc-rua-chen', brand: 'Tubu', name: 'Nước rửa chén', thumbnail: null, basePrice: 100000, salePrice: null, isFeatured: false, inStock: true, ...over,
});
const variation = (id: string, stock = 5) => ({ id, name: `Loại ${id}`, sku: id, attributes: {}, retailPrice: 100000, salePrice: null, stock });

let detail: { variations: ReturnType<typeof variation>[] };
let config: Record<string, unknown>;
let postGate: Promise<void> | null;
let mounted: Rendered[] = [];

const posts = () => mocks.post.mock.calls.filter(([path]) => path === '/cart/items');
const detailCalls = () => mocks.get.mock.calls.filter(([path]) => String(path).startsWith('/products/'));
const mount = async (items = [product()]) => {
  const r = render(
    <HomeQuickAddProvider>
      {items.map((p) => (
        <ProductCard key={p.id} product={p} variant="grid" showWishlist={false} />
      ))}
    </HomeQuickAddProvider>,
  );
  mounted.push(r);
  await flush(6);
  return r.container;
};
const plus = (c: HTMLElement, name = 'Nước rửa chén') => c.querySelector<HTMLButtonElement>(`button[aria-label="${fillCopy('card.quickAdd', { name })}"]`);

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  mocks.phase = 'authenticated';
  mocks.push.mockReset();
  detail = { variations: [variation('v1')] };
  config = {};
  postGate = null;
  mocks.get.mockReset().mockImplementation(async (path: string) => {
    if (path.startsWith('/products/')) return detail;
    if (path === '/config/public') return config;
    return [];
  });
  mocks.post.mockReset().mockImplementation(async () => {
    if (postGate) await postGate;
    return { items: [] };
  });
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('Trang chủ: nút ＋ thêm nhanh trên thẻ sản phẩm', () => {
  it('hai cú chạm sát nhau (dưới 300ms) vào CÙNG một nút ＋ chỉ gửi MỘT lượt thêm giỏ', async () => {
    let open!: () => void;
    postGate = new Promise<void>((r) => (open = r));
    const c = await mount();
    const btn = plus(c)!;
    await act(async () => {
      btn.click();
      btn.click();
    });
    await flush(6);
    open();
    await flush(8);
    expect(detailCalls()).toHaveLength(1);
    expect(posts()).toHaveLength(1);
    expect(posts()[0]![1]).toMatchObject({ variationId: 'v1', quantity: 1 });
    expect(c.textContent).toContain('Đã thêm vào giỏ!');
  });

  it('chạm hai thẻ khác nhau: nút của thẻ đang thêm báo bận (aria-busy), thẻ còn lại vẫn có nút', async () => {
    let open!: () => void;
    postGate = new Promise<void>((r) => (open = r));
    const c = await mount([product(), product({ id: 'p2', slug: 'dau-goi', name: 'Dầu gội' })]);
    await act(async () => {
      plus(c)!.click();
    });
    await flush(6);
    expect(plus(c)!.getAttribute('aria-busy')).toBe('true');
    expect(plus(c)!.getAttribute('aria-disabled')).toBe('true');
    expect(plus(c, 'Dầu gội')!.getAttribute('aria-busy')).toBe('false');
    open();
    await flush(8);
    expect(plus(c)!.getAttribute('aria-busy')).toBe('false');
  });

  it('hết hàng: thẻ KHÔNG có nút ＋ (và không gọi API nào)', async () => {
    const c = await mount([product({ inStock: false })]);
    expect(plus(c)).toBeNull();
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('nhiều phân loại còn hàng: mở bảng chọn phân loại, KHÔNG thêm thẳng vào giỏ', async () => {
    detail = { variations: [variation('v1'), variation('v2')] };
    const c = await mount();
    await act(async () => {
      plus(c)!.click();
    });
    await flush(8);
    expect(c.querySelector('[data-testid="variation-sheet"]')).not.toBeNull();
    expect(posts()).toHaveLength(0);
  });

  it('tải chi tiết thấy mọi phân loại đã hết: báo hết hàng, không thêm giỏ', async () => {
    detail = { variations: [variation('v1', 0)] };
    const c = await mount();
    await act(async () => {
      plus(c)!.click();
    });
    await flush(8);
    expect(posts()).toHaveLength(0);
    expect(c.querySelector('[role="alert"]')).not.toBeNull();
  });

  describe('khách chưa đăng nhập', () => {
    beforeEach(() => {
      mocks.phase = 'guest';
    });

    it('cờ giỏ khách tắt: nhớ món rồi sang đăng nhập (kèm trang sản phẩm để quay lại), không gọi API giỏ', async () => {
      const c = await mount();
      await act(async () => {
        plus(c)!.click();
      });
      await flush(8);
      expect(posts()).toHaveLength(0);
      expect(mocks.push).toHaveBeenCalledTimes(1);
      expect(String(mocks.push.mock.calls[0]![0])).toContain(encodeURIComponent('/san-pham/nuoc-rua-chen'));
      expect(JSON.parse(sessionStorage.getItem('tubu_pending_add')!)).toMatchObject({ variationId: 'v1', quantity: 1 });
    });

    it('cờ giỏ khách bật + một phân loại: thêm vào giỏ khách trên máy, không sang đăng nhập, không gọi API giỏ', async () => {
      config = { webGuestCartEnabled: true };
      const c = await mount();
      await act(async () => {
        plus(c)!.click();
      });
      await flush(10);
      expect(posts()).toHaveLength(0);
      expect(mocks.push).not.toHaveBeenCalled();
      expect(localStorage.getItem(GUEST_CART_KEY) ?? '').toContain('v1');
      expect(c.textContent).toContain('Đã thêm vào giỏ!');
    });

    it('cờ giỏ khách bật + nhiều phân loại: mở bảng chọn (không sang đăng nhập); xác nhận ghi đúng phân loại và số lượng vào giỏ khách', async () => {
      config = { webGuestCartEnabled: true };
      detail = { variations: [variation('v1'), variation('v2', 4)] };
      const c = await mount();
      await act(async () => {
        plus(c)!.click();
      });
      await flush(10);
      expect(mocks.push).not.toHaveBeenCalled();
      expect(localStorage.getItem(GUEST_CART_KEY)).toBeNull();
      const confirm = document.querySelector<HTMLButtonElement>('[data-testid="sheet-confirm"]');
      expect(confirm).not.toBeNull();
      await act(async () => {
        confirm!.click();
      });
      await flush(6);
      expect(posts()).toHaveLength(0);
      expect(mocks.push).not.toHaveBeenCalled();
      expect(JSON.parse(localStorage.getItem(GUEST_CART_KEY)!)).toMatchObject([{ variationId: 'v2', slug: 'nuoc-rua-chen', quantity: 2 }]);
      expect(document.querySelector('[data-testid="variation-sheet"]')).toBeNull();
      expect(c.textContent).toContain('Đã thêm vào giỏ!');
    });

    it('cờ giỏ khách bật + mọi phân loại đã hết: báo hết hàng, không ghi giỏ, không sang đăng nhập', async () => {
      config = { webGuestCartEnabled: true };
      detail = { variations: [variation('v1', 0), variation('v2', 0)] };
      const c = await mount();
      await act(async () => {
        plus(c)!.click();
      });
      await flush(10);
      expect(mocks.push).not.toHaveBeenCalled();
      expect(localStorage.getItem(GUEST_CART_KEY)).toBeNull();
      expect(c.textContent).toContain(QUICK_ADD_SOLD_OUT);
    });

    it('cờ tắt mà điều hướng sang đăng nhập ném lỗi đồng bộ: báo lỗi cho khách, không im lặng và không nuốt', async () => {
      mocks.push.mockImplementation(() => {
        throw new Error('điều hướng hỏng');
      });
      const c = await mount();
      await act(async () => {
        plus(c)!.click();
      });
      await flush(8);
      expect(mocks.push).toHaveBeenCalledTimes(1);
      expect(c.querySelector('[role="alert"]')).not.toBeNull();
    });

    it('mở bảng chọn lúc là khách rồi phiên thành đăng nhập: xác nhận đi giỏ máy chủ, không ghi vào giỏ trình duyệt', async () => {
      config = { webGuestCartEnabled: true };
      detail = { variations: [variation('v1'), variation('v2')] };
      const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
      const tree = () => (
        <HomeQuickAddProvider>
          <ProductCard product={product()} variant="grid" showWishlist={false} />
        </HomeQuickAddProvider>
      );
      const r = render(tree(), client);
      mounted.push(r);
      await flush(6);
      await act(async () => {
        plus(r.container)!.click();
      });
      await flush(10);
      expect(r.container.querySelector('[data-testid="variation-sheet"]')).not.toBeNull();
      mocks.phase = 'authenticated';
      await act(async () => {
        r.root.render(<QueryClientProvider client={client}>{tree()}</QueryClientProvider>);
      });
      await act(async () => {
        r.container.querySelector<HTMLButtonElement>('[data-testid="sheet-confirm"]')!.click();
      });
      await flush(8);
      expect(posts()).toHaveLength(1);
      expect(JSON.stringify(posts()[0])).toContain('v2');
      expect(localStorage.getItem(GUEST_CART_KEY)).toBeNull();
    });

    it('nhiều phân loại: sang trang sản phẩm đăng nhập để khách tự chọn, không thêm hộ', async () => {
      detail = { variations: [variation('v1'), variation('v2')] };
      const c = await mount();
      await act(async () => {
        plus(c)!.click();
      });
      await flush(8);
      expect(posts()).toHaveLength(0);
      expect(mocks.push).toHaveBeenCalledTimes(1);
      expect(sessionStorage.getItem('tubu_pending_add')).toBeNull();
    });
  });

  it('đang khôi phục phiên (chưa biết là ai): cú chạm bị bỏ qua, không gọi API', async () => {
    mocks.phase = 'loading';
    const c = await mount();
    await act(async () => {
      plus(c)!.click();
    });
    await flush(6);
    expect(detailCalls()).toHaveLength(0);
    expect(mocks.post).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
  });
});
