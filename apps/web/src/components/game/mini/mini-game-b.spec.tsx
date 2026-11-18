// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MiniChoiceItem, MiniMatchCard, MiniProductCard } from '@tubutree/shared-types';
import { BASKET_PENDING_KEY, decodeBasketPending, encodeBasketPending } from '@tubutree/app-core/game-mini/basket-cart';
import { gameCopy } from '@tubutree/app-core/game-mini/copy';
import { gameWebCopy } from '@tubutree/app-core/game-mini/web-copy';
import { click, flush, render, type Rendered } from '@/test-utils/dom';
import { waitFor } from '@/test-utils/render-hook';

const mocks = vi.hoisted(() => ({ push: vi.fn(), get: vi.fn(), post: vi.fn(), phase: 'authenticated' as 'authenticated' | 'guest' }));
vi.mock('next/link', () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }), usePathname: () => '/vuon-xanh/choi/basket' }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => mocks.phase, useAuthRestoring: () => false }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get, post: mocks.post } }));
vi.mock('@/lib/cart-key', () => ({ cartStorefrontSlug: () => null }));
vi.mock('@/lib/use-public-config', () => ({ usePublicConfig: () => ({ waste: { enabled: false } }) }));

import MiniBasket from './mini-basket';
import MiniBasketCart from './mini-basket-cart';
import MiniMatch from './mini-match';
import MiniOrigin from './mini-origin';
import MiniOriginMap from './mini-origin-map';
import MiniRoundShell from './mini-round-shell';

const prod = (slug: string, name: string): MiniProductCard => ({ slug, name, imageUrl: null, price: 50_000, inStock: true });
const SET = [prod('nuoc-rua-chen', 'Nước rửa chén'), prod('giam-gao', 'Giấm gạo'), prod('khan-lau', 'Khăn lau')];
const catalog = (slug: string, inStock = true) => ({
  id: `p-${slug}`,
  slug,
  brand: 'Tubu',
  name: slug,
  thumbnail: null,
  basePrice: 50_000,
  salePrice: null,
  repVariationId: `v-${slug}`,
  isFeatured: false,
  inStock,
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

describe('MiniBasketCart (web)', () => {
  it('một món hết hàng: một lệnh thêm giỏ cho hai món còn hàng, báo tên món hết, nút thành "Xem giỏ hàng", không gọi API game', async () => {
    mocks.get.mockResolvedValue({ data: [catalog('nuoc-rua-chen'), catalog('giam-gao', false), catalog('khan-lau')], total: 3 });
    mocks.post.mockResolvedValue({ ok: true });
    mounted = render(<MiniBasketCart products={SET} />);
    click(buttonByText(gameCopy('basket.add')));
    await waitFor(() => expect(q('mini-basket-status')?.textContent).toContain(gameCopy('basket.added', { n: 2 })));
    expect(q('mini-basket-status')?.textContent).toContain(gameCopy('basket.skipped', { names: 'Giấm gạo' }));
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(mocks.post.mock.calls[0]![0]).toBe('/cart/items/batch');
    expect(mocks.post.mock.calls[0]![1]).toEqual({ items: [{ variationId: 'v-nuoc-rua-chen', quantity: 1 }, { variationId: 'v-khan-lau', quantity: 1 }] });
    const paths = [...mocks.get.mock.calls, ...mocks.post.mock.calls].map((c) => String(c[0]));
    expect(paths.some((p) => p.includes('/game'))).toBe(false);
    click(buttonByText(gameCopy('basket.viewCart')));
    expect(mocks.push).toHaveBeenCalledWith('/gio-hang');
    expect(mocks.post).toHaveBeenCalledTimes(1);
  });

  it('chạm đúp nút thêm giỏ chỉ gửi một lần', async () => {
    let release: (v: unknown) => void = () => {};
    mocks.get.mockResolvedValue({ data: SET.map((p) => catalog(p.slug)), total: 3 });
    mocks.post.mockImplementation(() => new Promise((r) => (release = r)));
    mounted = render(<MiniBasketCart products={SET} />);
    const btn = buttonByText(gameCopy('basket.add'));
    click(btn);
    click(btn);
    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1));
    click(btn);
    await act(async () => release({ ok: true }));
    await flush();
    expect(q('mini-basket-status')?.textContent).toContain(gameCopy('basket.added', { n: 3 }));
    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(mocks.post).toHaveBeenCalledTimes(1);
  });

  it('khách chưa đăng nhập: sang đăng nhập rồi quay về màn chơi, chưa ghi gì vào giỏ', async () => {
    mocks.phase = 'guest';
    mounted = render(<MiniBasketCart products={SET} />);
    click(buttonByText(gameCopy('basket.add')));
    await flush();
    expect(mocks.push).toHaveBeenCalledTimes(1);
    expect(String(mocks.push.mock.calls[0]![0])).toContain(encodeURIComponent('/vuon-xanh/choi/basket'));
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.post).not.toHaveBeenCalled();
    expect(decodeBasketPending(window.sessionStorage.getItem(BASKET_PENDING_KEY))?.map((p) => p.slug)).toEqual(SET.map((p) => p.slug));
  });

  it('bộ chờ của ván trước: tiêu đề riêng; thêm xong thì xoá bộ chờ', async () => {
    window.sessionStorage.setItem(BASKET_PENDING_KEY, encodeBasketPending(SET));
    mocks.get.mockResolvedValue({ data: SET.map((p) => catalog(p.slug)), total: 3 });
    mocks.post.mockResolvedValue({ ok: true });
    mounted = render(<MiniBasketCart products={SET} pending />);
    expect(q('mini-basket-pending')?.textContent).toContain(gameWebCopy('basket.pending'));
    click(buttonByText(gameCopy('basket.add')));
    await waitFor(() => expect(q('mini-basket-status')?.textContent).toContain(gameCopy('basket.added', { n: 3 })));
    expect(window.sessionStorage.getItem(BASKET_PENDING_KEY)).toBeNull();
  });
});

describe('MiniRoundShell (web): Giỏ Đúng Việc sau khi đăng nhập', () => {
  it('có bộ chờ thì hiện lại trên màn bắt đầu (một lần, đọc xong là xoá), bấm thêm thì vào giỏ', async () => {
    window.sessionStorage.setItem(BASKET_PENDING_KEY, encodeBasketPending(SET));
    mocks.get.mockImplementation((path: string) =>
      Promise.resolve(path.startsWith('/products') ? { data: SET.map((p) => catalog(p.slug)), total: 3 } : { dayKey: '2026-11-17', games: [], rewardEligible: true, noRewardReason: null, caps: {} }),
    );
    mocks.post.mockResolvedValue({ ok: true });
    mounted = render(<MiniRoundShell game="basket" />);
    await waitFor(() => expect(q('mini-basket-pending')).not.toBeNull());
    expect(q('mini-basket-pending')?.textContent).toContain('Nước rửa chén');
    expect(window.sessionStorage.getItem(BASKET_PENDING_KEY)).toBeNull();
    click(buttonByText(gameCopy('basket.add')));
    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith('/cart/items/batch', expect.anything(), undefined));
  });

  it('không có bộ chờ (hay bộ quá hạn) thì không có khối này', async () => {
    window.sessionStorage.setItem(BASKET_PENDING_KEY, encodeBasketPending(SET, Date.now() - 31 * 60_000));
    mocks.get.mockResolvedValue({ dayKey: '2026-11-17', games: [], rewardEligible: true, noRewardReason: null, caps: {} });
    mounted = render(<MiniRoundShell game="basket" />);
    await flush();
    expect(q('mini-basket-pending')).toBeNull();
  });
});

describe('MiniBasket (web)', () => {
  const task = { id: 't1', task: 'Rửa chén bát', products: [...SET, prod('a', 'Nước hoa'), prod('b', 'Sơn tường'), prod('c', 'Xà phòng')] };

  it('chọn 3 trong 6: món thứ tư không vào, đổi ý được, Xong nộp đúng một lần', () => {
    const onFinish = vi.fn();
    mounted = render(<MiniBasket content={{ task }} onFinish={onFinish} onStatus={() => {}} />);
    for (const i of [0, 1, 2]) click(q(`mini-basket-item-${i}`));
    click(q('mini-basket-item-3'));
    expect(q('mini-basket-item-3')?.getAttribute('aria-pressed')).toBe('false');
    expect(q('mini-basket-hint')?.textContent).toBe(gameCopy('basket.full'));
    click(q('mini-basket-item-1'));
    click(q('mini-basket-item-4'));
    const done = buttonByText(gameCopy('basket.done'));
    click(done);
    click(done);
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(onFinish).toHaveBeenCalledWith(['nuoc-rua-chen', 'khan-lau', 'b']);
  });
});

describe('MiniMatch (web)', () => {
  const cards: MiniMatchCard[] = [
    { cardId: 'i1', label: 'Bồ hòn', side: 'ingredient' },
    { cardId: 'u1', label: 'Tạo bọt', side: 'use' },
    { cardId: 'i2', label: 'Giấm', side: 'ingredient' },
    { cardId: 'u2', label: 'Tẩy cặn', side: 'use' },
  ];

  it('thẻ là nút thật có tên đọc được; ghép đủ thì nộp một lần', () => {
    const onFinish = vi.fn();
    mounted = render(<MiniMatch content={{ cards }} onFinish={onFinish} onStatus={() => {}} />);
    expect(q('mini-match-card-0')?.tagName).toBe('BUTTON');
    expect(q('mini-match-card-0')?.getAttribute('aria-label')).toBe(gameCopy('match.cardAria', { n: 1, label: 'Bồ hòn', side: gameCopy('match.side.ingredient') }));
    click(q('mini-match-card-1'));
    click(q('mini-match-card-0'));
    expect(q('mini-match-card-0')?.getAttribute('aria-label')).toBe(gameCopy('match.cardPairedAria', { n: 1, label: 'Bồ hòn', k: 1 }));
    click(q('mini-match-card-2'));
    click(q('mini-match-card-3'));
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(onFinish).toHaveBeenCalledWith([
      ['i1', 'u1'],
      ['i2', 'u2'],
    ]);
  });

  it('chạm lại thẻ của cặp đã ghép thì gỡ cặp, ghép lại được, chưa nộp', () => {
    const onFinish = vi.fn();
    mounted = render(<MiniMatch content={{ cards }} onFinish={onFinish} onStatus={() => {}} />);
    click(q('mini-match-card-0'));
    click(q('mini-match-card-3'));
    expect(q('mini-match-card-3')?.getAttribute('data-state')).toBe('paired');
    click(q('mini-match-card-3'));
    expect(q('mini-match-card-0')?.getAttribute('data-state')).toBe('idle');
    expect(q('mini-match-card-3')?.getAttribute('data-state')).toBe('idle');
    expect(q('mini-match-card-0')?.getAttribute('aria-label')).toBe(gameCopy('match.cardAria', { n: 1, label: 'Bồ hòn', side: gameCopy('match.side.ingredient') }));
    click(q('mini-match-card-0'));
    click(q('mini-match-card-1'));
    click(q('mini-match-card-2'));
    click(q('mini-match-card-3'));
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(onFinish).toHaveBeenCalledWith([
      ['i1', 'u1'],
      ['i2', 'u2'],
    ]);
  });
});

describe('MiniOrigin (web)', () => {
  const items: MiniChoiceItem[] = [
    { id: 'o1', prompt: 'Chè Shan tuyết', options: ['Hà Giang', 'Lâm Đồng', 'Huế', 'Cà Mau'], product: null },
    { id: 'o2', prompt: 'Mật ong bạc hà', options: ['Mèo Vạc', 'Bến Tre', 'Huế', 'Đà Lạt'], product: null },
  ];

  it('chọn vùng rồi Lượt tiếp; lượt cuối nộp đáp án; jsdom (không matchMedia) không có bản đồ', async () => {
    const onFinish = vi.fn();
    mounted = render(<MiniOrigin content={{ items }} onFinish={onFinish} onStatus={() => {}} />);
    click(q('mini-origin-option-1'));
    click(buttonByText(gameCopy('origin.next')));
    click(q('mini-origin-option-3'));
    click(buttonByText(gameCopy('quiz.finish')));
    await flush();
    expect(onFinish).toHaveBeenCalledWith([1, 3]);
    expect(q('mini-origin-map')).toBeNull();
  });

  it('bản đồ tô vùng của lựa chọn đang đánh dấu, có Hoàng Sa và Trường Sa', () => {
    mounted = render(<MiniOriginMap place="Đà Lạt" />);
    expect(q('mini-origin-map')?.getAttribute('data-spot')).toBe('lam-dong');
    expect(mounted.container.querySelectorAll('[data-on="true"]')).toHaveLength(1);
    expect(mounted.container.textContent).toContain('Hoàng Sa');
    expect(mounted.container.textContent).toContain('Trường Sa');
    expect(q('mini-origin-map-caption')?.textContent).toBe('Vùng bạn chọn: Đà Lạt');
  });
});
