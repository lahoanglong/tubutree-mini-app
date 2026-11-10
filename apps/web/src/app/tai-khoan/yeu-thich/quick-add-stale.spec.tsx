// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, flush, render, type Rendered } from '@/test-utils/dom';
import { ApiError, NetworkError } from '@/lib/client-api';

// Giỏ nhanh ở Yêu thích: máy chủ từ chối bằng 400/404/409 (sản phẩm đã gỡ, phân loại hết hàng) nghĩa là thẻ đang hiện đã cũ: lời lỗi hiện ngay, tải lại danh sách yêu thích
// rồi mới nhả khoá (tối đa 4 giây), và lời lỗi không mất cùng khối lưới khi danh sách tải lại làm thẻ biến mất. Mất mạng, 401, 403, 5xx không tải lại.
// Mini App (wishlist.tsx) chỉ báo lỗi: web chặt hơn có chủ ý.

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
}));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => 'authenticated' }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ retrySession: vi.fn() }) }));
vi.mock('next/navigation', () => ({ usePathname: () => '/', useRouter: () => ({ push: () => undefined }) }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get, post: mocks.post } }));
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

const card = (id: string, name: string, inStock = true) => ({
  id, slug: `sp-${id}`, brand: 'Tubu', name, thumbnail: null, basePrice: 100000, salePrice: null, isFeatured: false, inStock,
});
const variation = (id: string, stock = 5) => ({ id, name: `Loại ${id}`, sku: id, attributes: {}, retailPrice: 100000, salePrice: null, stock });

const STALE = [
  [400, 'Sản phẩm đã hết hàng.'],
  [404, 'Không tìm thấy sản phẩm này.'],
  [409, 'Giỏ hàng vừa thay đổi, hãy thử lại.'],
] as const;
const TRANSIENT: Array<[string, unknown]> = [
  ['401', new ApiError('Phiên hết hạn', 401)],
  ['403', new ApiError('Không có quyền', 403)],
  ['500', new ApiError('Internal server error', 500)],
  ['502', new ApiError('Bad gateway', 502)],
  ['503', new ApiError('Service unavailable', 503)],
  ['mất mạng', new NetworkError(false)],
];

let wishlist: unknown[] = [];
let wishlistGate: Promise<void> | null = null;
let detail: { variations: ReturnType<typeof variation>[] } = { variations: [variation('v1')] };
let detailError: unknown = null;
const holdWishlist = () => {
  let open!: () => void;
  wishlistGate = new Promise<void>((r) => (open = r));
  return () => {
    wishlistGate = null;
    open();
  };
};
const listFetches = () => mocks.get.mock.calls.filter(([path]) => path === '/me/wishlist').length;
const productFetches = () => mocks.get.mock.calls.filter(([path]) => String(path).startsWith('/products/')).length;

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<WishlistPage />);
  mounted.push(r);
  await flush(4);
  return r.container;
};
const addButton = (c: HTMLElement, name: string) => c.querySelector<HTMLButtonElement>(`button[aria-label="Thêm ${name} vào giỏ"]`);
const alertText = (c: HTMLElement) => c.querySelector('[role="alert"]')?.textContent ?? null;
const tapTogether = async (...els: Array<HTMLElement | null>) => {
  await act(async () => {
    for (const e of els) e!.click();
  });
};
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
  wishlist = [card('a', 'Nước rửa chén'), card('c', 'Dầu gội')];
  wishlistGate = null;
  detail = { variations: [variation('v1')] };
  detailError = null;
  mocks.get.mockReset().mockImplementation(async (path: string) => {
    if (path === '/me/wishlist') {
      if (wishlistGate) await wishlistGate;
      return wishlist;
    }
    if (path.startsWith('/products/')) {
      if (detailError) throw detailError;
      return detail;
    }
    return [];
  });
  mocks.post.mockReset().mockResolvedValue({ items: [] });
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.useRealTimers();
});

describe('Yêu thích: giỏ nhanh bị máy chủ từ chối vì trạng thái đã đổi', () => {
  describe.each([
    ['tải chi tiết sản phẩm', (err: unknown) => (detailError = err)],
    ['thêm giỏ', (err: unknown) => mocks.post.mockRejectedValue(err)],
  ] as const)('%s', (_where, fail) => {
    it.each(STALE)('HTTP %i: lời lỗi hiện ngay, tải lại danh sách, thẻ giữ bận (chạm lại không gọi API) tới khi xong; lời lỗi còn khi danh sách về rỗng', async (status, message) => {
      const c = await mount();
      const add = addButton(c, 'Nước rửa chén')!;
      const release = holdWishlist();
      wishlist = [];
      fail(new ApiError(message, status));
      const listBefore = listFetches();
      await tapTogether(add);
      await flush(8);
      expect(alertText(c)).toContain(message);
      expect(listFetches() - listBefore).toBe(1);
      expect(add.getAttribute('aria-busy')).toBe('true');
      expect(add.getAttribute('aria-disabled')).toBe('true');
      const other = addButton(c, 'Dầu gội')!;
      expect(other.getAttribute('aria-disabled')).toBe('true');
      expect(other.getAttribute('aria-busy')).not.toBe('true');
      const fetchesBefore = productFetches();
      const postsBefore = mocks.post.mock.calls.length;
      await tapTogether(add, other);
      await flush(2);
      expect(productFetches()).toBe(fetchesBefore);
      expect(mocks.post.mock.calls.length).toBe(postsBefore);
      release();
      await flush(8);
      expect(c.textContent).toContain('Chưa có sản phẩm yêu thích');
      expect(alertText(c)).toContain(message);
    });

    it.each(TRANSIENT)('lỗi tạm (%s): báo lỗi, không tải lại danh sách, nhả khoá ngay', async (_name, error) => {
      const c = await mount();
      const add = addButton(c, 'Nước rửa chén')!;
      fail(error);
      const listBefore = listFetches();
      await tapTogether(add);
      await flush(8);
      expect(alertText(c)).toBeTruthy();
      expect(listFetches() - listBefore).toBe(0);
      expect(add.getAttribute('aria-busy')).toBe('false');
      expect(add.getAttribute('aria-disabled')).toBeNull();
      expect(addButton(c, 'Dầu gội')!.getAttribute('aria-disabled')).toBeNull();
    });

    it('tải lại không bao giờ về: còn khoá ở 3 giây, nhả sau 4 giây', async () => {
      const c = await mount();
      const add = addButton(c, 'Nước rửa chén')!;
      holdWishlist();
      fail(new ApiError('Sản phẩm đã hết hàng.', 400));
      await tapTogether(add);
      await flush(8);
      await advance(3_000);
      expect(add.getAttribute('aria-busy')).toBe('true');
      const fetchesBefore = productFetches();
      await tapTogether(add);
      expect(productFetches()).toBe(fetchesBefore);
      await advance(1_500);
      await flush(4);
      expect(add.getAttribute('aria-busy')).toBe('false');
    });
  });

  it('bảng chọn phân loại: xác nhận bị từ chối 409 thì đóng bảng, báo lỗi, tải lại danh sách và giữ khoá tới khi xong', async () => {
    detail = { variations: [variation('v1'), variation('v2')] };
    const c = await mount();
    click(addButton(c, 'Nước rửa chén')!);
    await flush(8);
    const confirm = Array.from(c.querySelectorAll('button')).find((b) => b.textContent === 'xác nhận phân loại')!;
    const release = holdWishlist();
    mocks.post.mockRejectedValue(new ApiError('Phân loại này vừa hết hàng.', 409));
    const listBefore = listFetches();
    await tapTogether(confirm);
    await flush(8);
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(alertText(c)).toContain('Phân loại này vừa hết hàng.');
    expect(listFetches() - listBefore).toBe(1);
    expect(c.querySelector('[data-testid="variation-sheet"]')).toBeNull();
    const add = addButton(c, 'Dầu gội')!;
    await tapTogether(add);
    await flush(2);
    expect(productFetches()).toBe(1);
    release();
    await flush(8);
    mocks.post.mockResolvedValue({ items: [] });
    detail = { variations: [variation('v1')] };
    await tapTogether(add);
    await flush(8);
    expect(productFetches()).toBe(2);
  });
});
