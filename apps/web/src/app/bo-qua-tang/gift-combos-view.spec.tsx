// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BundleDTO, GiftLanding } from '@tubutree/app-core/api/bundle';
import type { ProductCard } from '@tubutree/app-core/api/catalog';
import { click, flush, render, type Rendered } from '@/test-utils/dom';
import { smallTouchTargets, unnamedControls } from '@/test-utils/a11y';

// Trang Bộ quà tặng & combo khởi đầu (web): combo thật với giá tính từ giá món, hai mốc đọc từ máy chủ, thêm cả combo một chạm, trạng thái trống.

const mocks = vi.hoisted(() => ({ get: vi.fn(), addAll: vi.fn(), push: vi.fn(), phase: 'authenticated' as string }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get } }));
vi.mock('@/lib/shop-combo', () => ({ addAllToCart: mocks.addAll }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => mocks.phase }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }), usePathname: () => '/bo-qua-tang' }));

import GiftCombosView from './gift-combos-view';

const card = (id: string, price: number): ProductCard => ({
  id, slug: `sp-${id}`, brand: 'Tubu', name: `Sản phẩm ${id}`, thumbnail: null, basePrice: price, salePrice: null, isFeatured: false, inStock: true, repVariationId: `v-${id}`,
});
const combo = (id: string, a: [string, number], b: [string, number], pct = 10): BundleDTO => ({
  id, kind: 'BUNDLE_PCT', title: `Combo ${id}`, pct, endAt: new Date(Date.now() + 86_400_000).toISOString(), anchorProductId: null,
  items: [a, b].map(([pid, price]) => ({ productId: pid, variationId: `v-${pid}`, maxQty: 1, addonPrice: null, inStock: true, product: card(pid, price) })),
});
const landing = (over: Partial<GiftLanding> = {}): GiftLanding => ({
  combos: [combo('c1', ['a', 120_000], ['b', 85_000]), combo('c2', ['c', 300_000], ['d', 100_000], 15)],
  freeshipThreshold: 199_000,
  giftTrialMinOrder: 299_000,
  ...over,
});

let mounted: Rendered[] = [];
const mount = async (initial?: GiftLanding) => {
  const r = render(<GiftCombosView initial={initial} initialFetchedAt={Date.now()} />);
  mounted.push(r);
  await flush(8);
  return r.container;
};
const addAllButtons = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLButtonElement>('button')).filter((b) => /Thêm cả combo/.test(b.textContent ?? ''));

beforeEach(() => {
  mocks.get.mockReset().mockImplementation(async (path: string) => {
    if (path === '/bundles/gift-landing') return landing();
    throw new Error(`đường dẫn lạ ${path}`);
  });
  mocks.addAll.mockReset().mockResolvedValue({});
  mocks.push.mockReset();
  mocks.phase = 'authenticated';
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('GiftCombosView (/bo-qua-tang)', () => {
  it('tiêu đề trang là h1, mỗi combo một thẻ với giá cả bộ tính từ giá thật của món', async () => {
    const c = await mount(landing());
    expect(c.querySelector('h1')!.textContent).toBe('Bộ quà tặng & combo khởi đầu');
    expect(Array.from(c.querySelectorAll('h3')).map((h) => h.textContent)).toEqual(['Combo c1', 'Combo c2']);
    const text = c.textContent!;
    // c1: 205.000đ − (12.000 + 8.500) = 184.500đ; c2: 400.000đ − 15% = 340.000đ.
    expect(text).toContain('184.500đ');
    expect(text).toContain('Tiết kiệm 20.500đ');
    expect(text).toContain('340.000đ');
    expect(text).toContain('Tiết kiệm 60.000đ');
    expect(c.querySelector('[data-testid="gift-combos-list"]')!.className).toContain('tabular-nums');
  });

  it('hai mốc đọc từ máy chủ: Miễn phí giao hàng và quà dùng thử 0đ', async () => {
    const c = await mount(landing());
    const callouts = Array.from(c.querySelectorAll('[data-testid="gift-combos-callout"]')).map((el) => el.textContent);
    expect(callouts).toEqual(['Miễn phí giao hàng cho đơn từ 199.000đ', 'Tặng quà dùng thử 0đ cho đơn từ 299.000đ']);
  });

  it('mốc đổi hay quà hết thì chữ đổi theo, không ghi cứng', async () => {
    const c = await mount(landing({ freeshipThreshold: 250_000, giftTrialMinOrder: null }));
    const callouts = Array.from(c.querySelectorAll('[data-testid="gift-combos-callout"]')).map((el) => el.textContent);
    expect(callouts).toEqual(['Miễn phí giao hàng cho đơn từ 250.000đ']);
  });

  it('"Thêm cả combo" thêm đúng món của combo đó một chạm, báo ở role=status', async () => {
    const c = await mount(landing());
    click(addAllButtons(c)[1]!);
    await flush();
    expect(mocks.addAll).toHaveBeenCalledWith([{ variationId: 'v-c', quantity: 1 }, { variationId: 'v-d', quantity: 1 }]);
    expect(c.querySelector('[role="status"]')!.textContent).toBe('Đã thêm cả combo vào giỏ');
  });

  it('khách chưa đăng nhập: chuyển sang đăng nhập kèm đường quay lại, không gọi giỏ', async () => {
    mocks.phase = 'guest';
    const c = await mount(landing());
    click(addAllButtons(c)[0]!);
    expect(mocks.addAll).not.toHaveBeenCalled();
    expect(mocks.push).toHaveBeenCalledWith(expect.stringContaining('/dang-nhap'));
  });

  it('0 combo: trạng thái trống có lối sang sản phẩm, mốc vẫn hiện', async () => {
    const c = await mount(landing({ combos: [] }));
    expect(c.textContent).toContain('Chưa có combo nào đang mở bán');
    expect(c.querySelector('a[href="/san-pham"]')).not.toBeNull();
    expect(addAllButtons(c)).toHaveLength(0);
    expect(c.querySelectorAll('[data-testid="gift-combos-callout"]')).toHaveLength(2);
  });

  it('không có dữ liệu máy chủ thì tự tải; nút đủ 44px và có tên đọc', async () => {
    const c = await mount(undefined);
    expect(mocks.get).toHaveBeenCalledWith('/bundles/gift-landing', { anonymous: true });
    expect(addAllButtons(c)).toHaveLength(2);
    expect(unnamedControls(c)).toEqual([]);
    expect(smallTouchTargets(c)).toEqual([]);
  });
});
