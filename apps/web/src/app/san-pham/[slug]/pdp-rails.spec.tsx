// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PdpSelectionProvider } from '@/components/pdp-selection';
import { flush, render, type Rendered } from '@/test-utils/dom';

const mocks = vi.hoisted(() => ({ phase: 'guest' as string, get: vi.fn() }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => mocks.phase }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get } }));
vi.mock('@/components/mini/product-rail', () => ({
  ProductRail: ({ items, label }: { items: { id: string; name: string }[]; label: string }) => (
    <ul data-testid="rail" aria-label={label}>
      {items.map((i) => (
        <li key={i.id}>{i.name}</li>
      ))}
    </ul>
  ),
}));
vi.mock('@/components/mini/product-grid', () => ({
  ProductGrid: ({ items }: { items: { id: string; name: string }[] }) => (
    <ul data-testid="feed-grid">
      {items.map((i) => (
        <li key={i.id}>{i.name}</li>
      ))}
    </ul>
  ),
}));

import { PdpRails } from './pdp-rails';

const card = (id: string) => ({ id, name: `Món ${id}`, slug: id });
const many = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => card(`${prefix}${i}`));

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<PdpRails productId="cur" slug="cur" brand="Tubu" initialRelated={[]} initialBoughtTogether={[]} />);
  mounted.push(r);
  await flush();
  return r.container;
};
const paths = () => mocks.get.mock.calls.map((c) => String(c[0]));

beforeEach(() => {
  mocks.get.mockReset();
  mocks.get.mockImplementation(async (path: string) => {
    if (path === '/products/for-you') return many('fy', 6);
    if (path === '/products') return { data: [card('cur'), ...many('bs', 6)], meta: { page: 1, limit: 24, total: 7 } };
    throw new Error(`đường không mong đợi: ${path}`);
  });
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('PdpRails: "Có thể bạn cũng thích"', () => {
  it('khách vãng lai: không gọi /products/for-you (cần JWT, sẽ 401), lấy bán chạy và bỏ món đang xem', async () => {
    mocks.phase = 'guest';
    const c = await mount();
    expect(paths()).not.toContain('/products/for-you');
    expect(paths()).toContain('/products');
    expect(mocks.get.mock.calls.find((x) => x[0] === '/products')?.[1]).toMatchObject({ query: { sort: 'best_seller', limit: 10 } });
    const items = Array.from(c.querySelectorAll('[data-testid="feed-grid"] li')).map((li) => li.textContent);
    expect(items).toHaveLength(6);
    expect(items).not.toContain('Món cur');
    expect(c.querySelector('#pdp-feed-title')?.textContent).toBe('Có thể bạn cũng thích');
  });

  it('đang khôi phục phiên thì chưa gọi nguồn gợi ý nào', async () => {
    mocks.phase = 'loading';
    await mount();
    expect(paths()).not.toContain('/products/for-you');
    expect(paths()).not.toContain('/products');
  });

  it('khách đã đăng nhập: dùng gợi ý cá nhân, không gọi danh sách công khai', async () => {
    mocks.phase = 'authenticated';
    const c = await mount();
    expect(paths()).toContain('/products/for-you');
    expect(paths()).not.toContain('/products');
    expect(Array.from(c.querySelectorAll('[data-testid="feed-grid"] li')).map((li) => li.textContent)).toContain('Món fy0');
  });

  it('API trả sai dạng (không phải mảng): khối ẩn, trang không vỡ', async () => {
    mocks.phase = 'authenticated';
    mocks.get.mockImplementation(async (path: string) => (path === '/products/for-you' ? { error: 'x' } : []));
    const c = await mount();
    expect(c.querySelector('#pdp-feed-title')).toBeNull();
  });
});

describe('PdpRails: bỏ 2 món đang nằm ở khối "Gợi ý mua kèm hợp vị"', () => {
  const VARIATIONS = [{ id: 'v-cur', retailPrice: 100_000, salePrice: null, stock: 10 }];
  const together = [card('b1'), card('b2'), card('b3'), card('b4'), card('b5'), card('b6')].map((c) => ({ ...c, inStock: true, repVariationId: `v-${c.id}`, basePrice: 50_000, salePrice: null, brand: 'Tubu', thumbnail: null, isFeatured: false }));
  const mountWith = async (fbt: React.ComponentProps<typeof PdpRails>['fbt'], selected = 'v-cur') => {
    const r = render(
      <PdpSelectionProvider initialId={selected}>
        <PdpRails productId="cur" slug="cur" brand="Tubu" initialRelated={[]} initialBoughtTogether={together} fbt={fbt} />
      </PdpSelectionProvider>,
    );
    mounted.push(r);
    await flush();
    return r.container;
  };
  const shelf = (c: HTMLElement) => Array.from(c.querySelectorAll('[data-testid="rail"] li')).map((li) => li.textContent);

  it('khối đang hiện: 2 món đầu của "Khách thường mua cùng" nằm ở khối nên dải bên dưới chỉ còn các món sau', async () => {
    mocks.phase = 'guest';
    const c = await mountWith({ name: 'Món đang xem', thumbnail: null, variations: VARIATIONS });
    expect(shelf(c)).toEqual(['Món b3', 'Món b4', 'Món b5', 'Món b6']);
  });

  it('còn dưới sàn 3 món sau khi nhường 2 món cho khối: dải "Khách thường mua cùng" ẩn hẳn (không để dải lẻ 1–2 món)', async () => {
    mocks.phase = 'guest';
    const r = render(
      <PdpSelectionProvider initialId="v-cur">
        <PdpRails productId="cur" slug="cur" brand="Tubu" initialRelated={[]} initialBoughtTogether={together.slice(0, 4)} fbt={{ name: 'Món đang xem', thumbnail: null, variations: VARIATIONS }} />
      </PdpSelectionProvider>,
    );
    mounted.push(r);
    await flush();
    expect(shelf(r.container)).toEqual([]);
  });

  it('khối ẩn (món đang xem hết hàng): dải giữ đủ món, không mất món nào', async () => {
    mocks.phase = 'guest';
    const c = await mountWith({ name: 'Món đang xem', thumbnail: null, variations: [{ ...VARIATIONS[0]!, stock: 0 }] });
    expect(shelf(c)).toHaveLength(6);
  });

  it('khối ẩn (gian hàng tạm nghỉ): dải giữ đủ món', async () => {
    mocks.phase = 'guest';
    const c = await mountWith({ name: 'Món đang xem', thumbnail: null, variations: VARIATIONS, blockedReason: 'Gian hàng tạm nghỉ' });
    expect(shelf(c)).toHaveLength(6);
  });

  it('không truyền fbt (trang không có phân loại): dải giữ đủ món', async () => {
    mocks.phase = 'guest';
    const c = await mountWith(undefined);
    expect(shelf(c)).toHaveLength(6);
  });
});
