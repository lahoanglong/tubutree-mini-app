// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BundleDTO, GiftLanding } from '@tubutree/app-core/api/bundle';
import type { ProductCard } from '@tubutree/app-core/api/catalog';
import { ApiError } from '@/lib/client-api';
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

  const cues = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLElement>('[data-testid="gift-combos-cue"]'));

  it('"Thêm cả combo" thêm đúng món của combo đó một chạm, báo ngay dưới thẻ vừa bấm (role=status)', async () => {
    const c = await mount(landing());
    click(addAllButtons(c)[1]!);
    await flush();
    expect(mocks.addAll).toHaveBeenCalledWith([{ variationId: 'v-c', quantity: 1 }, { variationId: 'v-d', quantity: 1 }]);
    expect(cues(c).map((el) => [el.getAttribute('role'), el.textContent])).toEqual([
      ['status', ''],
      ['status', 'Đã thêm cả combo vào giỏ'],
    ]);
  });

  it('sau khi thêm: câu còn thiếu tới Miễn phí giao hàng, rồi quà dùng thử 0đ, đọc từ giỏ máy chủ trả về', async () => {
    mocks.addAll.mockResolvedValueOnce({ items: [{ stock: 5, total: 150_000 }], freeship: false, freeshipThreshold: 199_000 });
    const c = await mount(landing());
    click(addAllButtons(c)[0]!);
    await flush();
    expect(cues(c)[0]!.textContent).toBe('Đã thêm cả combo vào giỏMua thêm 49.000đ để được Miễn phí giao hàng 🚚');
    const giftTrial = { base: 220_000, minOrder: 299_000, nextMinOrder: 299_000, shortfall: 79_000, options: [{ variationId: 'g1' }], selectedVariationId: null, declined: false };
    mocks.addAll.mockResolvedValueOnce({ items: [{ stock: 5, total: 220_000 }], freeship: true, freeshipThreshold: 199_000, giftTrial });
    click(addAllButtons(c)[1]!);
    await flush();
    expect(cues(c).map((el) => el.textContent)).toEqual(['', 'Đã thêm cả combo vào giỏ🎁 Thêm 79.000đ để nhận quà dùng thử 0đ']);
  });

  it('thêm lỗi: lời lỗi ngay dưới thẻ đó, không có câu mốc', async () => {
    mocks.addAll.mockRejectedValueOnce(new Error('mạng'));
    const c = await mount(landing());
    click(addAllButtons(c)[0]!);
    await flush();
    expect(cues(c)[0]!.textContent).toBe('Chưa thêm được combo, giỏ của bạn không thay đổi. Bạn thử lại nhé.');
    expect(cues(c)[0]!.querySelector('.text-danger-fg')).not.toBeNull();
  });

  it('máy chủ từ chối vì món hết hàng, danh sách tải lại không còn bộ đó: lời từ chối vẫn hiện ở vùng báo chung của trang', async () => {
    mocks.addAll.mockRejectedValueOnce(new ApiError('Sản phẩm Sản phẩm a đã hết hàng', 409));
    const c = await mount(landing());
    const status = () => c.querySelector<HTMLElement>('[data-testid="gift-combos-status"]')!;
    expect(status().textContent).toBe('');
    mocks.get.mockResolvedValue(landing({ combos: [combo('c2', ['c', 300_000], ['d', 100_000], 15)] }));
    click(addAllButtons(c)[0]!);
    await flush(8);
    expect(cues(c)).toHaveLength(1);
    expect(status().getAttribute('role')).toBe('status');
    expect(status().textContent).toBe('Sản phẩm Sản phẩm a đã hết hàng');
    expect(status().querySelector('.text-danger-fg')).not.toBeNull();
  });

  it('"Tiết kiệm" là số máy chủ (cùng hàm giỏ trừ): bộ bị kẹp trần hứa đúng số kẹp, nhãn % là mức thật', async () => {
    const c = await mount(landing({ combos: [{ ...combo('c1', ['a', 120_000], ['b', 85_000], 50), saving: 30_000 }] }));
    const text = c.querySelector('[data-testid="gift-combos-list"]')!.textContent!;
    expect(text).toContain('Tiết kiệm 30.000đ');
    expect(text).toContain('175.000đ');
    expect(text).toContain('Combo -14%');
    // Giỏ cắt phần giảm theo dòng, không theo %: thẻ không ghi giá trong bộ của từng món.
    expect(c.querySelectorAll('[data-testid="combo-item-price"]')).toHaveLength(0);
  });

  it('số máy chủ khớp phép % từng món: thẻ ghi giá lẻ và giá trong bộ của từng món (cộng lại bằng giá cả bộ)', async () => {
    const c = await mount(landing({ combos: [{ ...combo('c1', ['a', 120_000], ['b', 85_000], 10), saving: 20_500 }] }));
    const rows = [...c.querySelectorAll('[data-testid="combo-item-price"]')].map((r) => r.textContent);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('108.000đ');
    expect(rows[1]).toContain('76.500đ');
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
