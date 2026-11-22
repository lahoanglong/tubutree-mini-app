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

  it('hạng hụt vì kệ trên chiếm (#1, #2, #4) hay mất hạng 1 (#2, #3): thẻ chỉ ghi "Bán chạy" không số; hạng liền 1..k giữ số (P2 #4)', () => {
    const badges = () => Array.from(mounted!.container.querySelectorAll('[data-testid="best-seller-rail"] [data-ds-part="rank"]')).map((n) => n.textContent);
    mounted = render(<BestSellerRail items={[card(1), card(2), card(4)]} ranks={[1, 2, 4]} loading={false} />);
    expect(badges()).toEqual(['Bán chạy', 'Bán chạy', 'Bán chạy']);
    mounted.unmount();
    mounted = render(<BestSellerRail items={[card(2), card(3)]} ranks={[2, 3]} loading={false} />);
    expect(badges()).toEqual(['Bán chạy', 'Bán chạy']);
    mounted.unmount();
    mounted = render(<BestSellerRail items={[card(1), card(2), card(3)]} ranks={[1, 2, 3]} loading={false} />);
    expect(badges()).toEqual(['#1', '#2', '#3']);
  });

  it('một danh sách cho mọi khổ (HTML không có bản thẻ thứ hai): kệ vuốt ngang dưới lg, lưới 5 cột từ lg bằng lớp CSS', () => {
    mounted = render(<BestSellerRail items={cards(10)} loading={false} />);
    const c = mounted.container;
    // Bản lưới riêng (hidden lg:block) từng nhân đôi 10 thẻ trong HTML Trang chủ (~58 KB): không còn bản nào bị display:none.
    expect(c.querySelector('[data-testid="best-seller-grid"]')).toBeNull();
    expect(c.querySelectorAll('[data-ds="product-tile"]')).toHaveLength(10);
    expect(c.querySelectorAll('a[href^="/san-pham/"]')).toHaveLength(10);
    const rail = c.querySelector<HTMLElement>('[data-testid="best-seller-rail"]')!;
    expect(rail.className).not.toContain('hidden');
    const region = rail.querySelector<HTMLElement>('[role="region"][aria-label*="vuốt ngang"]')!;
    expect(region.className).toContain('tubu-bleed-rail');
    for (const cls of ['lg:mx-0', 'lg:p-0', 'lg:overflow-visible']) expect(region.className.split(' ')).toContain(cls);
    const list = region.querySelector<HTMLElement>(':scope > ul')!;
    for (const cls of ['flex', 'w-max', 'gap-3', 'lg:grid', 'lg:grid-cols-5', 'lg:gap-4']) expect(list.className.split(' ')).toContain(cls);
    const cells = Array.from(list.querySelectorAll<HTMLElement>(':scope > li'));
    expect(cells).toHaveLength(10);
    for (const li of cells) expect(li.className).toContain('w-[var(--tile-w-sm)]');
  });

  it('ảnh: hai thẻ đầu tải ngay khi Trang chủ xin (priorityCount), sizes theo cả kệ dưới lg (128px) lẫn lưới 5 cột từ lg', () => {
    // Ảnh Pancake đi qua /img có srcset theo bề rộng nên mới mang sizes (ảnh nguồn khác giữ nguyên cỡ, không cần sizes).
    const withPhoto = cards(4).map((p) => ({ ...p, thumbnail: `https://content.pancake.vn/2-26/${p.id}.jpg` }));
    mounted = render(<BestSellerRail items={withPhoto} loading={false} priorityCount={2} />);
    const imgs = Array.from(mounted.container.querySelectorAll('[data-testid="best-seller-rail"] img'));
    expect(imgs.map((i) => [i.getAttribute('loading'), i.getAttribute('fetchpriority')])).toEqual([
      ['eager', 'high'],
      ['eager', 'high'],
      ['lazy', null],
      ['lazy', null],
    ]);
    for (const i of imgs) expect(i.getAttribute('sizes')).toBe('(max-width: 1023px) 128px, calc((min(100vw, 1200px) - 112px) / 5)');
  });

  it('đang tải: 10 khung chờ (5 dưới lg, thêm 5 chỉ hiện từ lg cho hai hàng lưới); không có thẻ thật', () => {
    mounted = render(<BestSellerRail items={[]} loading />);
    const c = mounted.container;
    expect(c.querySelector('[data-testid="best-seller-rail"] ul')).toBeNull();
    const track = c.querySelector<HTMLElement>('[data-testid="best-seller-rail"] [role="region"] > [aria-hidden="true"]')!;
    for (const cls of ['flex', 'lg:grid', 'lg:grid-cols-5']) expect(track.className.split(' ')).toContain(cls);
    const cells = Array.from(track.querySelectorAll<HTMLElement>(':scope > div'));
    expect(cells).toHaveLength(10);
    expect(cells.filter((d) => d.className.includes('max-lg:hidden'))).toHaveLength(5);
  });

  it('kệ đã bỏ món trùng kệ trên (hạng #2, #3, #5): không đánh lại từ #1 và không ghi số hụt', () => {
    mounted = render(<BestSellerRail items={[card(2), card(3), card(5)]} ranks={[2, 3, 5]} loading={false} />);
    const text = mounted.container.textContent ?? '';
    for (const rank of ['#1', '#2', '#3', '#4', '#5']) expect(text).not.toContain(rank);
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

  it('đang tải: khung chờ cùng cỡ thẻ hạng (ô kệ như ô thẻ thật), vẫn có tiêu đề', () => {
    mounted = render(<BestSellerRail items={[]} loading />);
    const section = mounted.container.querySelector('section[aria-label="Bán chạy nhất"]')!;
    expect(section.querySelector('h2')?.textContent).toBe('Bán chạy nhất');
    const cells = Array.from(section.querySelectorAll<HTMLElement>('[role="region"] > [aria-hidden="true"] > div'));
    expect(cells.filter((d) => !d.className.includes('max-lg:hidden'))).toHaveLength(5);
    for (const d of cells) expect(d.className).toContain('w-[var(--tile-w-sm)]');
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
