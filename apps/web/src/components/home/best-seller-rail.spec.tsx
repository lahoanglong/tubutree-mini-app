// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, flush, render, type Rendered } from '@/test-utils/dom';

const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => 'guest', useAuthRestoring: () => false }));

import { BestSellerRail, BestSellerRailQuery } from './best-seller-rail';

const card = (n: number) => ({ id: `p${n}`, slug: `sp-${n}`, name: `Sản phẩm ${n}`, brand: 'Tubu', thumbnail: null, basePrice: 50000, salePrice: null, repVariationId: `v${n}`, isFeatured: false, inStock: true });
const cards = (n: number) => Array.from({ length: n }, (_, i) => card(i + 1));

let mounted: Rendered | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});
beforeEach(() => mocks.get.mockReset());

describe('BestSellerRail web — Bán chạy nhất có hạng (Q18)', () => {
  it('tiêu đề SectionHeader "Bán chạy nhất" kèm dòng cơ sở xếp hạng và "Xem tất cả" sang trang xếp hạng', () => {
    mounted = render(<BestSellerRail items={cards(4)} loading={false} />);
    const section = mounted.container.querySelector('section[aria-label="Bán chạy nhất"]')!;
    expect(section.querySelector('h2')?.textContent).toBe('Bán chạy nhất');
    expect(section.textContent).toContain('Theo lượt bán 30 ngày qua');
    expect(section.querySelector('a[aria-label="Xem tất cả Bán chạy nhất"]')?.getAttribute('href')).toBe('/ban-chay');
  });

  it('basis total (API cũ, xếp theo tổng lượt bán): phụ đề ghi "Theo tổng lượt bán", không còn "30 ngày qua"', () => {
    mounted = render(<BestSellerRail items={cards(4)} basis="total" loading={false} />);
    const section = mounted.container.querySelector('section[aria-label="Bán chạy nhất"]')!;
    expect(section.textContent).toContain('Theo tổng lượt bán');
    expect(section.textContent).not.toContain('30 ngày qua');
  });

  it('mỗi thẻ có hạng #1, #2, #3... theo thứ tự lượt bán', () => {
    mounted = render(<BestSellerRail items={cards(4)} loading={false} />);
    const text = mounted.container.textContent ?? '';
    for (const rank of ['#1', '#2', '#3', '#4']) expect(text).toContain(rank);
    expect(text.indexOf('#1')).toBeLessThan(text.indexOf('#2'));
  });

  it('kệ đã bỏ món trùng kệ trên: thẻ ghi hạng thật được truyền vào (#2, #3, #5), không đánh lại từ #1', () => {
    mounted = render(<BestSellerRail items={[card(2), card(3), card(5)]} ranks={[2, 3, 5]} loading={false} />);
    const text = mounted.container.textContent ?? '';
    for (const rank of ['#2', '#3', '#5']) expect(text).toContain(rank);
    expect(text).not.toContain('#1');
    expect(text).not.toContain('#4');
  });

  it('rỗng và không lỗi thì ẩn cả khối; rỗng mà lỗi thì khối lỗi có "Thử lại"', () => {
    const onRetry = vi.fn();
    mounted = render(<BestSellerRail items={[]} loading={false} />);
    expect(mounted.container.textContent).toBe('');
    mounted.unmount();
    mounted = render(<BestSellerRail items={[]} loading={false} error={new Error('x')} onRetry={onRetry} />);
    click(mounted.container.querySelector('button[aria-label="Thử lại Bán chạy nhất"]'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('đang tải: khung chờ 5 ô cùng cỡ thẻ hạng, vẫn có tiêu đề', () => {
    mounted = render(<BestSellerRail items={[]} loading />);
    const section = mounted.container.querySelector('section[aria-label="Bán chạy nhất"]')!;
    expect(section.querySelector('h2')?.textContent).toBe('Bán chạy nhất');
    const cells = section.querySelectorAll('[role="region"] [style*="--tile-w-sm"]');
    expect(cells).toHaveLength(5);
    expect(section.textContent).not.toContain('#');
  });
});

describe('BestSellerRailQuery (tab Đơn hàng): tự tải, cùng khoá với Trang chủ', () => {
  it('xin sort=best_seller_30d, 12 món rồi hiện kệ có hạng khi đủ 3 món', async () => {
    mocks.get.mockResolvedValue({ data: cards(5), meta: { page: 1, limit: 12, total: 5 } });
    mounted = render(<BestSellerRailQuery />);
    await flush(8);
    expect(JSON.stringify(mocks.get.mock.calls[0])).toContain('best_seller_30d');
    expect(mounted.container.textContent).toContain('#1');
  });

  it('API cũ từ chối best_seller_30d (400): tự lùi về best_seller và phụ đề ghi "Theo tổng lượt bán"', async () => {
    mocks.get.mockImplementation(async (_path: string, opts?: { query?: { sort?: string } }) => {
      if (opts?.query?.sort === 'best_seller_30d') throw Object.assign(new Error('bad'), { status: 400 });
      return { data: cards(5), meta: { page: 1, limit: 12, total: 5 } };
    });
    mounted = render(<BestSellerRailQuery />);
    await flush(8);
    expect(mounted.container.textContent).toContain('Theo tổng lượt bán');
    expect(mounted.container.textContent).toContain('#1');
  });

  it('dưới 3 món thì ẩn khối', async () => {
    mocks.get.mockResolvedValue({ data: cards(2), meta: { page: 1, limit: 12, total: 2 } });
    mounted = render(<BestSellerRailQuery />);
    await flush(8);
    expect(mounted.container.textContent).toBe('');
  });
});
