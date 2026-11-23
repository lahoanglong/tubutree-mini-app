// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { GreenBoxPage } from '@tubutree/app-core/api/bundle';
import { click, flush, render, type Rendered } from '@/test-utils/dom';
import { smallTouchTargets, unnamedControls } from '@/test-utils/a11y';

// Trang ghép Hộp Xanh (web): thanh nhiều bậc theo bảng bậc máy chủ, chip nhảy danh mục, bậc xem trước cho giỏ khách, số máy chủ cho khách đã đăng nhập.

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  getCart: vi.fn(),
  track: vi.fn(),
  phase: 'authenticated' as string,
  guestLines: [] as { variationId: string; slug: string; quantity: number; addedAt: number }[],
}));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get } }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => mocks.phase }));
vi.mock('@/lib/shop-client', () => ({ getCart: mocks.getCart }));
vi.mock('@/lib/cart-key', () => ({ useCartKey: () => ['cart', null] }));
vi.mock('@/lib/analytics', () => ({ trackWebEvent: mocks.track }));
vi.mock('@/lib/guest-cart/use-guest-cart', () => ({ useGuestCartLines: () => mocks.guestLines }));
vi.mock('@/components/home/home-quick-add', () => ({ HomeQuickAddProvider: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('@/components/mini', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ProductGrid: ({ items, loading }: { items: { slug: string; name: string }[]; loading?: boolean }) =>
    loading ? <div data-testid="grid-loading" /> : <ul data-testid="green-box-grid">{items.map((p) => <li key={p.slug}>{p.name}</li>)}</ul>,
}));
vi.mock('next/navigation', () => ({ usePathname: () => '/hop-xanh', useRouter: () => ({ push: vi.fn(), back: vi.fn() }) }));

import GreenBoxView from './green-box-view';

const scrollIntoView = vi.fn();
Element.prototype.scrollIntoView = scrollIntoView;

const product = (slug: string) => ({ id: slug, slug, name: `Món ${slug}`, brand: 'Tubu', thumbnail: null, basePrice: 50_000, salePrice: null, isFeatured: false, inStock: true });
const TIERS = [
  { minItems: 3, pct: 3 },
  { minItems: 5, pct: 5 },
  { minItems: 7, pct: 7 },
];
const pageData = (over: Partial<GreenBoxPage> = {}): GreenBoxPage => ({
  enabled: true,
  tiers: TIERS,
  groups: [
    { category: { id: 'c1', name: 'Nhà bếp', slug: 'nha-bep' }, products: [product('a'), product('b'), product('c')] },
    { category: { id: 'c2', name: 'Phòng tắm', slug: 'phong-tam' }, products: [product('d')] },
  ] as GreenBoxPage['groups'],
  ...over,
});
const guestLine = (slug: string, variationId = `v-${slug}`) => ({ variationId, slug, quantity: 1, addedAt: 1 });

let mounted: Rendered[] = [];
const mount = async (initial: GreenBoxPage = pageData()) => {
  const r = render(<GreenBoxView initial={initial} />);
  mounted.push(r);
  await flush(8);
  return r.container;
};
const barTexts = (c: HTMLElement) => Array.from(c.querySelectorAll('[data-testid="green-box-bar-text"]')).map((el) => el.textContent);
const stepper = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-testid="green-box-stepper"]')!;

beforeEach(() => {
  mocks.get.mockReset().mockImplementation(async (path: string) => {
    if (path === '/bundles/green-box') return pageData();
    throw new Error(`đường dẫn lạ ${path}`);
  });
  mocks.getCart.mockReset().mockResolvedValue({ items: [], greenBox: { items: 4, tier: TIERS[0], next: TIERS[1], tiers: TIERS, discount: 7_200 } });
  mocks.track.mockReset();
  scrollIntoView.mockReset();
  mocks.phase = 'authenticated';
  mocks.guestLines = [];
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('GreenBoxView (/hop-xanh, tubu-w22-01)', () => {
  it('đã đăng nhập: thanh bậc và thanh đếm đọc số máy chủ tính trên giỏ', async () => {
    const c = await mount();
    expect(c.querySelector('h1')!.textContent).toBe('Hộp Xanh tự chọn');
    expect(barTexts(c)).toEqual(['Đã chọn 4 món · giảm 3%', 'Đã chọn 4 món · giảm 3%']);
    expect(c.querySelector('[data-testid="green-box-stepper-text"]')!.textContent).toBe('Thêm 1 món nữa');
    expect(stepper(c).textContent).toContain('Giảm 5%');
    const bars = Array.from(c.querySelectorAll('[role="progressbar"]'));
    expect(bars.map((b) => [b.getAttribute('aria-label'), b.getAttribute('aria-valuenow')])).toEqual([
      ['Mốc 3 món giảm 3%, đã đạt', '100'],
      ['Mốc 5 món giảm 5%, chưa đạt', '50'],
      ['Mốc 7 món giảm 7%, chưa đạt', '0'],
    ]);
    expect(Array.from(c.querySelectorAll('[data-testid="green-box-step"]')).map((s) => s.textContent)).toEqual(['3 món-3%', '5 món-5%', '7 món-7%']);
  });

  it('khách chưa đăng nhập: bậc xem trước từ số sản phẩm khác nhau của trang trong giỏ khách, nói "dự kiến giảm", không đọc giỏ máy chủ', async () => {
    mocks.phase = 'guest';
    // Hai phân loại của "a" tính 1; "zz" không có ở trang nên không tính.
    mocks.guestLines = [guestLine('a', 'v-a1'), guestLine('a', 'v-a2'), guestLine('b'), guestLine('d'), guestLine('zz')];
    const c = await mount();
    expect(barTexts(c)).toEqual(['Đã chọn 3 món · dự kiến giảm 3%', 'Đã chọn 3 món · dự kiến giảm 3%']);
    expect(c.querySelector('[data-testid="green-box-stepper-text"]')!.textContent).toBe('Thêm 2 món nữa');
    expect(mocks.getCart).not.toHaveBeenCalled();
  });

  it('khách chưa đủ bậc đầu: chỉ đếm món, không hứa mức giảm', async () => {
    mocks.phase = 'guest';
    mocks.guestLines = [guestLine('a')];
    const c = await mount();
    expect(barTexts(c)[0]).toBe('Đã chọn 1 món');
    expect(c.querySelector('[data-testid="green-box-stepper-text"]')!.textContent).toBe('Thêm 2 món nữa');
    expect(stepper(c).textContent).toContain('Giảm 3%');
  });

  it('chip nhảy danh mục: mỗi danh mục có món một chip, chạm thì cuộn mượt tới đúng mục; nút đủ 44px và có tên', async () => {
    const c = await mount();
    const row = c.querySelector('[role="region"][aria-label="Chọn nhanh danh mục"]')!;
    const chips = Array.from(row.querySelectorAll('button'));
    expect(chips.map((b) => b.textContent)).toEqual(['Nhà bếp(3)', 'Phòng tắm(1)']);
    click(chips[1]!);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.contexts[0]).toBe(c.querySelector('#hop-xanh-c2-section'));
    expect(scrollIntoView.mock.calls[0]![0]).toMatchObject({ behavior: 'smooth', block: 'start' });
    expect(unnamedControls(c)).toEqual([]);
    expect(smallTouchTargets(row as HTMLElement)).toEqual([]);
  });

  it('người dùng chọn giảm chuyển động: nhảy thẳng, không cuộn mượt', async () => {
    const original = window.matchMedia;
    window.matchMedia = ((q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
    try {
      const c = await mount();
      click(c.querySelector('[role="region"][aria-label="Chọn nhanh danh mục"] button'));
      expect(scrollIntoView.mock.calls[0]![0]).toMatchObject({ behavior: 'auto' });
    } finally {
      window.matchMedia = original;
    }
  });

  it('bậc đổi ở cấu hình thì thanh đổi theo; chỉ một danh mục có món thì không có hàng chip', async () => {
    const tiers = [
      { minItems: 2, pct: 4 },
      { minItems: 10, pct: 9 },
    ];
    mocks.getCart.mockResolvedValue({ items: [], greenBox: { items: 6, tier: tiers[0], next: tiers[1], tiers, discount: 1_000 } });
    const data = pageData({ tiers, groups: [{ category: null, products: [product('a')] }] as GreenBoxPage['groups'] });
    mocks.get.mockResolvedValue(data);
    const c = await mount(data);
    expect(Array.from(c.querySelectorAll('[data-testid="green-box-step"]')).map((s) => s.textContent)).toEqual(['2 món-4%', '10 món-9%']);
    expect(c.querySelector('[data-testid="green-box-stepper-text"]')!.textContent).toBe('Thêm 4 món nữa');
    expect(c.querySelector('[role="region"][aria-label="Chọn nhanh danh mục"]')).toBeNull();
    expect(Array.from(c.querySelectorAll('h2')).map((h) => h.textContent)).toEqual(['Món khác']);
  });

  it('cờ tắt: báo chưa mở, không thanh bậc, không báo đã xem', async () => {
    const off = { enabled: false, tiers: [], groups: [] };
    mocks.get.mockResolvedValue(off);
    const c = await mount(off);
    expect(c.textContent).toContain('Hộp Xanh chưa mở. Bạn quay lại sau nhé.');
    expect(c.querySelector('[data-testid="green-box-stepper"]')).toBeNull();
    expect(mocks.track).not.toHaveBeenCalled();
  });
});
