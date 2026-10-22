// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, flush, render, type Rendered } from '@/test-utils/dom';
import { headingProblems, smallTouchTargets, unnamedControls } from '@/test-utils/a11y';

// Cùng ý nghĩa wishlist.tsx của Mini App: chỉ gọi /me/wishlist khi đã đăng nhập, lưới thẻ sản phẩm, trạng thái rỗng và lỗi có Thử lại.

const mocks = vi.hoisted(() => ({
  phase: 'authenticated' as 'authenticated' | 'guest' | 'loading' | 'unavailable',
  get: vi.fn(),
}));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => mocks.phase }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ retrySession: vi.fn() }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined }) }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get } }));

import WishlistPage from './page';

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
