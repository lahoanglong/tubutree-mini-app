// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MiniKitchenSwap, MiniProductCard } from '@tubutree/shared-types';
import { BASKET_PENDING_KEY, KITCHEN_PENDING_KEY, decodeBasketPending, encodeBasketPending } from '@tubutree/app-core/game-mini/basket-cart';
import { gameCopy } from '@tubutree/app-core/game-mini/copy';
import { kitchenCopy } from '@tubutree/app-core/game-mini/kitchen-copy';
import { click, flush, render, type Rendered } from '@/test-utils/dom';
import { waitFor } from '@/test-utils/render-hook';

const mocks = vi.hoisted(() => ({ push: vi.fn(), get: vi.fn(), post: vi.fn(), phase: 'authenticated' as 'authenticated' | 'guest' }));
vi.mock('next/link', () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }), usePathname: () => '/vuon-xanh/choi/kitchen_swap' }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => mocks.phase, useAuthRestoring: () => false }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get, post: mocks.post } }));
vi.mock('@/lib/cart-key', () => ({ cartStorefrontSlug: () => null }));
vi.mock('@/lib/use-public-config', () => ({ usePublicConfig: () => ({ waste: { enabled: false } }) }));

import MiniBasketCart from './mini-basket-cart';
import MiniKitchenSwapBoard from './mini-kitchen-swap';
import MiniRoundShell from './mini-round-shell';

const prod = (slug: string, name: string): MiniProductCard => ({ slug, name, imageUrl: null, price: 50_000, inStock: true });
const swaps: MiniKitchenSwap[] = (['table', 'kitchen', 'bag'] as const).map((corner, i) => ({
  id: `k${i}`,
  corner,
  item: `Món ${i}`,
  emoji: i === 0 ? '🍬' : null,
  hidden: `Vỏ nhựa ${i}`,
  options: [prod(`a-${i}`, `Sản phẩm A${i}`), prod(`b-${i}`, `Sản phẩm B${i}`), prod(`c-${i}`, `Sản phẩm C${i}`)].map((product, j) => ({ product, fact: `Bao bì ${i}-${j}` })),
}));
const SET = [prod('a-0', 'Sản phẩm A0'), prod('a-1', 'Sản phẩm A1'), prod('a-2', 'Sản phẩm A2')];
const catalog = (slug: string) => ({
  id: `p-${slug}`,
  slug,
  brand: 'Tubu',
  name: slug,
  thumbnail: null,
  basePrice: 50_000,
  salePrice: null,
  repVariationId: `v-${slug}`,
  isFeatured: false,
  inStock: true,
});

let mounted: Rendered | null = null;
const q = (id: string) => mounted!.container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const buttonByText = (text: string) => [...mounted!.container.querySelectorAll('button')].find((b) => b.textContent?.trim() === text) ?? null;

beforeEach(() => {
  mocks.phase = 'authenticated';
  mocks.get.mockReset();
  mocks.post.mockReset();
  mocks.push.mockReset();
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.useRealTimers();
  window.sessionStorage.clear();
});

describe('Căn Bếp Xanh: bàn chơi (web)', () => {
  it('chạm một sản phẩm là đổi và khoá món: hiện điều bao bì ghi, ẩn lựa chọn, "Góc tiếp" mới bấm được', () => {
    const onFinish = vi.fn();
    const onStatus = vi.fn();
    mounted = render(<MiniKitchenSwapBoard content={{ swaps }} onFinish={onFinish} onStatus={onStatus} />);
    expect(q('mini-kitchen-item')?.textContent).toBe('Món 0');
    expect(q('mini-kitchen-hidden')?.textContent).toContain('Vỏ nhựa 0');
    expect(q('mini-kitchen-corner-0')?.getAttribute('aria-current')).toBe('step');
    expect(q('mini-kitchen-corner-0')?.getAttribute('aria-label')).toBe(kitchenCopy('cornerTodoAria', { corner: 'Bàn ăn' }));
    expect(buttonByText(kitchenCopy('next'))?.disabled).toBe(true);
    expect(q('mini-kitchen-fact')).toBeNull();

    click(q('mini-kitchen-option-1'));
    expect(q('mini-kitchen-swapped')?.textContent).toBe(kitchenCopy('swapped', { name: 'Sản phẩm B0' }));
    expect(q('mini-kitchen-fact-text')?.textContent).toBe('Bao bì 0-1');
    expect(document.activeElement).toBe(q('mini-kitchen-fact'));
    expect(q('mini-kitchen-option-0')).toBeNull();
    expect(q('mini-kitchen-scene')?.getAttribute('data-swapped')).toBe('true');
    expect(q('mini-kitchen-corner-0')?.getAttribute('data-state')).toBe('done');
    expect(q('mini-kitchen-corner-0')?.getAttribute('aria-label')).toBe(kitchenCopy('cornerDoneAria', { corner: 'Bàn ăn' }));
    expect(onStatus).toHaveBeenLastCalledWith(expect.objectContaining({ done: 1, total: 3 }));
    expect(buttonByText(kitchenCopy('next'))?.disabled).toBe(false);
    expect(onFinish).not.toHaveBeenCalled();
  });

  it('đi hết 3 góc: góc cuối là "Nộp bài", nộp đúng một lần với slug đã đổi ở từng món', () => {
    const onFinish = vi.fn();
    mounted = render(<MiniKitchenSwapBoard content={{ swaps }} onFinish={onFinish} onStatus={() => {}} />);
    click(q('mini-kitchen-option-0'));
    click(buttonByText(kitchenCopy('next')));
    expect(q('mini-kitchen-item')?.textContent).toBe('Món 1');
    expect(document.activeElement).toBe(q('mini-kitchen-scene'));
    click(q('mini-kitchen-option-2'));
    click(buttonByText(kitchenCopy('next')));
    click(q('mini-kitchen-option-1'));
    const submit = buttonByText(kitchenCopy('finish'));
    expect(submit).not.toBeNull();
    click(submit);
    click(submit);
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(onFinish).toHaveBeenCalledWith(['a-0', 'c-1', 'b-2']);
  });

  it('hết 45 giây: nộp các món đã đổi, món chưa đổi là null; không nộp lần hai', () => {
    vi.useFakeTimers();
    const onFinish = vi.fn();
    mounted = render(<MiniKitchenSwapBoard content={{ swaps }} onFinish={onFinish} onStatus={() => {}} />);
    click(q('mini-kitchen-option-2'));
    click(buttonByText(kitchenCopy('next')));
    act(() => {
      vi.advanceTimersByTime(45_500);
    });
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(onFinish).toHaveBeenCalledWith(['c-0', null, null]);
    click(q('mini-kitchen-option-0'));
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(onFinish).toHaveBeenCalledTimes(1);
  });
});

describe('Căn Bếp Xanh: thêm 3 sản phẩm vào giỏ dùng thử (web)', () => {
  it('chữ riêng của Căn Bếp Xanh, một lệnh thêm giỏ cho cả 3 sản phẩm, không gọi API game', async () => {
    mocks.get.mockResolvedValue({ data: SET.map((p) => catalog(p.slug)), total: 3 });
    mocks.post.mockResolvedValue({ ok: true });
    mounted = render(<MiniBasketCart game="kitchen_swap" products={SET} />);
    expect(q('mini-kitchen-set')?.textContent).toContain(kitchenCopy('set'));
    const links = [...mounted.container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(links).toEqual(SET.map((p) => `/san-pham/${p.slug}?entrySource=game:kitchen_swap`));
    click(buttonByText(kitchenCopy('add')));
    await waitFor(() => expect(q('mini-kitchen-status')?.textContent).toContain(gameCopy('basket.added', { n: 3 })));
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(mocks.post.mock.calls[0]![1]).toEqual({ items: SET.map((p) => ({ variationId: `v-${p.slug}`, quantity: 1 })) });
    const paths = [...mocks.get.mock.calls, ...mocks.post.mock.calls].map((c) => String(c[0]));
    expect(paths.some((p) => p.includes('/game'))).toBe(false);
    expect(buttonByText(gameCopy('basket.viewCart'))).not.toBeNull();
  });

  it('khách chưa đăng nhập: ghi bộ vào khoá riêng của Căn Bếp Xanh, quay về đúng màn Căn Bếp Xanh', async () => {
    mocks.phase = 'guest';
    mounted = render(<MiniBasketCart game="kitchen_swap" products={SET} />);
    click(buttonByText(kitchenCopy('add')));
    await flush();
    expect(String(mocks.push.mock.calls[0]![0])).toContain(encodeURIComponent('/vuon-xanh/choi/kitchen_swap'));
    expect(decodeBasketPending(window.sessionStorage.getItem(KITCHEN_PENDING_KEY))?.map((p) => p.slug)).toEqual(SET.map((p) => p.slug));
    expect(window.sessionStorage.getItem(BASKET_PENDING_KEY)).toBeNull();
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('khung ván Căn Bếp Xanh hiện lại bộ chờ của chính nó, không lấy bộ của Giỏ Đúng Việc', async () => {
    window.sessionStorage.setItem(KITCHEN_PENDING_KEY, encodeBasketPending(SET));
    window.sessionStorage.setItem(BASKET_PENDING_KEY, encodeBasketPending([prod('khac', 'Món của Giỏ Đúng Việc')]));
    mocks.get.mockResolvedValue({ dayKey: '2026-11-18', games: [], rewardEligible: true, noRewardReason: null, caps: {} });
    mounted = render(<MiniRoundShell game="kitchen_swap" />);
    await waitFor(() => expect(q('mini-kitchen-pending')).not.toBeNull());
    expect(q('mini-kitchen-pending')?.textContent).toContain(kitchenCopy('pending'));
    expect(q('mini-kitchen-pending')?.textContent).toContain('Sản phẩm A1');
    expect(q('mini-basket-pending')).toBeNull();
    expect(window.sessionStorage.getItem(KITCHEN_PENDING_KEY)).toBeNull();
    expect(window.sessionStorage.getItem(BASKET_PENDING_KEY)).not.toBeNull();
  });
});
