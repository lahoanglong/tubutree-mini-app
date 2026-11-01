// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, render, type Rendered } from '@/test-utils/dom';
import { resetFlashSales } from '@/lib/use-flash-sales';

vi.mock('@/lib/shop-client', () => ({ getActiveFlashSales: async () => [] }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => 'guest' }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: async () => ({}), post: async () => ({}), delete: async () => ({}) } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined }) }));

import { PRIORITY_CARDS } from './product-card';
import { ProductGrid } from './product-grid';
import { ProductRail } from './product-rail';

const item = (n: number) => ({
  id: `p${n}`, slug: `sp-${n}`, brand: 'Tubu', name: `Sản phẩm ${n}`, thumbnail: `https://cdn.example/${n}.jpg`,
  basePrice: 50_000, salePrice: null, isFeatured: false, inStock: true,
});
const ITEMS = [1, 2, 3, 4, 5, 6].map(item);

let mounted: Rendered[] = [];
beforeEach(() => resetFlashSales());
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});
const mount = async (ui: React.ReactElement) => {
  const r = render(ui);
  mounted.push(r);
  await flush();
  return r.container;
};

describe('ProductGrid', () => {
  it('mỗi sản phẩm một ô; priorityCount thẻ đầu tải ảnh ngay, mặc định tải lười hết', async () => {
    const c = await mount(<ProductGrid items={ITEMS} variant="grid" priorityCount={PRIORITY_CARDS} />);
    expect(c.querySelectorAll('li').length).toBe(6);
    expect(Array.from(c.querySelectorAll('img')).map((i) => i.getAttribute('loading'))).toEqual(['eager', 'eager', 'eager', 'eager', 'lazy', 'lazy']);
    const none = await mount(<ProductGrid items={ITEMS} variant="grid" />);
    expect(Array.from(none.querySelectorAll('img')).every((i) => i.getAttribute('loading') === 'lazy')).toBe(true);
  });

  it('loading vẽ khung chờ cùng số ô, ẩn khỏi trình đọc màn hình, không có thẻ thật', async () => {
    const c = await mount(<ProductGrid items={[]} variant="grid" loading skeletonCount={4} />);
    expect(c.querySelector('[data-testid="catalog-grid-skeleton"]')!.getAttribute('aria-hidden')).toBe('true');
    expect(c.querySelectorAll('[data-testid="catalog-tile-skeleton"]').length).toBe(4);
    expect(c.querySelector('a')).toBeNull();
  });

  it('rankFrom đánh hạng liên tiếp; renderAfter và renderImageOverlay nhận đúng sản phẩm', async () => {
    const c = await mount(
      <ProductGrid
        items={ITEMS.slice(0, 2)}
        variant="rank"
        rankFrom={4}
        renderAfter={(p) => <p data-testid="after">{p.id}</p>}
        renderImageOverlay={(p) => <button type="button" aria-label={`Thêm ${p.id}`}>+</button>}
      />,
    );
    expect(Array.from(c.querySelectorAll('[data-ds-part="rank"]')).map((e) => e.textContent)).toEqual(['#4', '#5']);
    expect(Array.from(c.querySelectorAll('[data-testid="after"]')).map((e) => e.textContent)).toEqual(['p1', 'p2']);
    expect(c.querySelector('button[aria-label="Thêm p2"]')).not.toBeNull();
  });

  it('noteOf đưa ghi chú vào trong thẻ; thẻ không ghi chú giữ chỗ dòng đó', async () => {
    const c = await mount(<ProductGrid items={ITEMS.slice(0, 3)} variant="grid" noteOf={(p, i) => (i === 1 ? `Dùng hằng ngày (${p.id})` : undefined)} />);
    expect(Array.from(c.querySelectorAll('[data-ds-part="note"]')).map((n) => n.textContent)).toEqual(['', 'Dùng hằng ngày (p2)', '']);
    const none = await mount(<ProductGrid items={ITEMS.slice(0, 3)} variant="grid" noteOf={() => undefined} />);
    expect(none.querySelectorAll('[data-ds-part="note"]').length).toBe(0);
  });

  it('cùng một sản phẩm xuất hiện hai lần vẫn dựng đủ hai ô (khoá theo id và vị trí)', async () => {
    const c = await mount(<ProductGrid items={[item(1), item(1)]} variant="grid" />);
    expect(c.querySelectorAll('li').length).toBe(2);
  });
});

describe('ProductRail', () => {
  it('noteOf đưa ghi chú vào thẻ của kệ', async () => {
    const c = await mount(<ProductRail items={ITEMS.slice(0, 3)} variant="rail-md" label="Nổi bật" noteOf={(_, i) => (i === 0 ? 'Mình dùng mỗi ngày' : undefined)} />);
    expect(Array.from(c.querySelectorAll('[data-ds-part="note"]')).map((n) => n.textContent)).toEqual(['Mình dùng mỗi ngày', '', '']);
  });

  it('bề rộng ô theo biến thể: 128 cho rail-sm/rank/flash, 148 cho rail-md', async () => {
    const width = async (variant: 'rail-sm' | 'rail-md' | 'rank' | 'flash') =>
      ((await mount(<ProductRail items={ITEMS.slice(0, 1)} variant={variant} label="Kệ" />)).querySelector('a.tubu-tile-link')!.closest('[style*="flex: 0 0 auto"]') as HTMLElement).style.width;
    expect(await width('rail-sm')).toBe('var(--tile-w-sm)');
    expect(await width('rank')).toBe('var(--tile-w-sm)');
    expect(await width('flash')).toBe('var(--tile-w-sm)');
    expect(await width('rail-md')).toBe('var(--tile-w-md)');
  });

  it('kệ tràn lề bằng class: dưới md bù lề 16px của trang, từ md chỉ bù đúng đệm 12px của kệ (thẻ đầu thẳng tiêu đề, không lấn cột nội dung)', async () => {
    const region = (await mount(<ProductRail items={ITEMS.slice(0, 1)} variant="rail-md" label="Kệ" />)).querySelector('[role="region"]') as HTMLElement;
    expect(region.className.split(' ')).toContain('tubu-bleed-rail');
    expect(region.className).not.toMatch(/-mx-|max-w-none/);
    expect(region.style.margin).toBe('');
    expect(region.style.padding).toBe('var(--rail-pad-block)');
  });

  it('có vùng cuộn có tên; loading vẽ khung chờ đúng số lượng', async () => {
    const c = await mount(<ProductRail items={[]} variant="rail-md" label="Sản phẩm bán chạy" loading skeletonCount={3} />);
    expect(c.querySelector('[role="region"]')!.getAttribute('aria-label')).toBe('Sản phẩm bán chạy');
    expect(c.querySelectorAll('[data-testid="catalog-tile-skeleton"]').length).toBe(3);
  });
});
