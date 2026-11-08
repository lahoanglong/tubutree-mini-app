// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, flush, render, type Rendered } from '@/test-utils/dom';

// "Đang giảm" đếm đúng món mà thẻ đang gạch giá, gồm cả giá Giờ vàng: trang đọc cùng kho Giờ vàng và cùng đồng hồ với ProductCard.

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  flash: [] as { productSlug: string; variationId: string; flashPrice: number; endAt?: string }[],
}));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => 'authenticated' }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ retrySession: vi.fn() }) }));
vi.mock('next/navigation', () => ({ usePathname: () => '/', useRouter: () => ({ push: () => undefined }) }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get, post: mocks.post } }));
vi.mock('@/lib/use-flash-sales', () => ({ useActiveFlashSales: () => mocks.flash }));

import WishlistPage from './page';

const item = (id: string, name: string, salePrice: number | null, inStock: boolean) => ({
  id,
  slug: `sp-${id}`,
  brand: 'Tubu',
  name,
  thumbnail: null,
  basePrice: 100000,
  salePrice,
  isFeatured: false,
  inStock,
});
const MIXED = [item('a', 'Nước rửa chén', 80000, true), item('b', 'Xà phòng', null, true), item('c', 'Dầu gội', 70000, false), item('d', 'Nước giặt', null, false)];

const flashFor = (slug: string, endAfterMs: number, flashPrice = 60000) => ({
  productSlug: slug,
  variationId: `v-${slug}`,
  flashPrice,
  endAt: new Date(Date.now() + endAfterMs).toISOString(),
});

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<WishlistPage />);
  mounted.push(r);
  await flush(4);
  return r.container;
};
// Nút tim trên thẻ cũng có aria-pressed, nên chỉ tìm chip trong vùng dải lọc.
const row = (c: HTMLElement) => c.querySelector<HTMLElement>('[role="region"][aria-label="Lọc sản phẩm yêu thích"]');
const chip = (c: HTMLElement, label: string) =>
  Array.from(row(c)?.querySelectorAll<HTMLButtonElement>('button[aria-pressed]') ?? []).find((b) => (b.textContent ?? '').startsWith(label))!;
// Thẻ đang giảm nhờ Giờ vàng mở sản phẩm ở phân loại đó (`?v=`): so theo đường dẫn.
const shown = (c: HTMLElement) => Array.from(c.querySelectorAll('a[href^="/san-pham/"]')).map((a) => a.getAttribute('href')!.split('?')[0]);

beforeEach(() => {
  mocks.flash = [];
  mocks.get.mockReset().mockImplementation(async (path: string) => (path === '/me/wishlist' ? MIXED : []));
  mocks.post.mockReset().mockResolvedValue({ items: [] });
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('/tai-khoan/yeu-thich — Đang giảm theo Giờ vàng', () => {
  it('món chỉ giảm nhờ Giờ vàng được đếm và hiện ở Đang giảm; Tất cả và Còn hàng không đổi', async () => {
    mocks.flash = [flashFor('sp-b', 3_600_000)];
    const c = await mount();
    expect(['Tất cả', 'Đang giảm', 'Còn hàng'].map((l) => chip(c, l).textContent)).toEqual(['Tất cả(4)', 'Đang giảm(3)', 'Còn hàng(2)']);
    click(chip(c, 'Đang giảm'));
    expect(shown(c)).toEqual(['/san-pham/sp-a', '/san-pham/sp-b', '/san-pham/sp-c']);
  });

  it('suất đã hết hạn, suất không rẻ hơn giá bán và suất của sản phẩm khác không làm món thành đang giảm', async () => {
    mocks.flash = [flashFor('sp-b', -1_000), flashFor('sp-d', 3_600_000, 100000), flashFor('sp-khac', 3_600_000)];
    const c = await mount();
    expect(chip(c, 'Đang giảm').textContent).toBe('Đang giảm(2)');
  });

  it('lọc ra rỗng chỉ vì suất Giờ vàng đã hết hạn: có câu báo theo bộ lọc', async () => {
    mocks.get.mockImplementation(async (path: string) => (path === '/me/wishlist' ? [item('b', 'Xà phòng', null, true)] : []));
    mocks.flash = [flashFor('sp-b', -1_000)];
    const c = await mount();
    click(chip(c, 'Đang giảm'));
    expect(c.textContent).toContain('Chưa có sản phẩm đang giảm giá trong danh sách yêu thích');
  });

  it('suất hết giờ khi khách còn đang xem: số đếm và lưới tự bỏ món, không cần tải lại', async () => {
    // Timer thật: `flush` của bộ test dùng setTimeout nên không giả đồng hồ được; mốc 2,5 giây chừa chỗ cho máy tải nặng dựng và bấm chip trước khi suất hết.
    mocks.flash = [flashFor('sp-b', 2_500)];
    const c = await mount();
    click(chip(c, 'Đang giảm'));
    expect(chip(c, 'Đang giảm').textContent).toBe('Đang giảm(3)');
    expect(shown(c)).toEqual(['/san-pham/sp-a', '/san-pham/sp-b', '/san-pham/sp-c']);
    await vi.waitFor(() => expect(chip(c, 'Đang giảm').textContent).toBe('Đang giảm(2)'), { timeout: 8_000 });
    expect(shown(c)).toEqual(['/san-pham/sp-a', '/san-pham/sp-c']);
  });
});
