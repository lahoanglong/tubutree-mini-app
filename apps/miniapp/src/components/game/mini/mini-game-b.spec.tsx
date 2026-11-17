import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MiniChoiceItem, MiniMatchCard, MiniProductCard } from '@tubutree/shared-types';
import { gameCopy } from '@tubutree/app-core/game-mini/copy';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  login: vi.fn(),
  get: vi.fn(),
  post: vi.fn(),
  auth: { status: 'authenticated' as 'authenticated' | 'idle' },
}));
vi.mock('../../../lib/smart-nav', () => ({ useSmartNavigate: () => mocks.navigate }));
vi.mock('../../ui/auth-gate', () => ({ useLoginWithNotice: () => mocks.login }));
vi.mock('../../../store/auth', () => ({ useAuthStore: { getState: () => mocks.auth } }));
vi.mock('../../../services/cart-key', () => ({ cartStorefrontSlug: () => null }));
vi.mock('../../../services/core-http', () => ({ coreHttp: { get: mocks.get, post: mocks.post } }));
vi.mock('../../ui/product-tile', () => ({ ProductTile: ({ href }: { href: string }) => <div data-testid="tile" data-href={href} /> }));

import MiniBasket from './mini-basket';
import MiniBasketCart from './mini-basket-cart';
import MiniMatch from './mini-match';
import MiniOrigin from './mini-origin';

const wrap = (ui: ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>
);

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

beforeEach(() => {
  mocks.auth.status = 'authenticated';
  mocks.get.mockReset();
  mocks.post.mockReset();
  mocks.login.mockReset();
  mocks.navigate.mockReset();
});
afterEach(() => vi.useRealTimers());

describe('MiniBasketCart (Mini)', () => {
  it('một món hết hàng: một lệnh thêm giỏ cho hai món còn hàng, báo tên món hết, nút thành "Xem giỏ hàng", không gọi API game', async () => {
    mocks.get.mockResolvedValue({ data: [catalog('nuoc-rua-chen'), catalog('giam-gao', false), catalog('khan-lau')], total: 3 });
    mocks.post.mockResolvedValue({ ok: true });
    render(wrap(<MiniBasketCart products={SET} />));
    fireEvent.click(screen.getByRole('button', { name: gameCopy('basket.add') }));
    await waitFor(() => expect(screen.getByTestId('mini-basket-status')).toHaveTextContent(gameCopy('basket.added', { n: 2 })));
    expect(screen.getByTestId('mini-basket-status')).toHaveTextContent(gameCopy('basket.skipped', { names: 'Giấm gạo' }));
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(mocks.post.mock.calls[0]![0]).toBe('/cart/items/batch');
    expect(mocks.post.mock.calls[0]![1]).toEqual({ items: [{ variationId: 'v-nuoc-rua-chen', quantity: 1 }, { variationId: 'v-khan-lau', quantity: 1 }] });
    const paths = [...mocks.get.mock.calls, ...mocks.post.mock.calls].map((c) => String(c[0]));
    expect(paths.some((p) => p.includes('/game'))).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: gameCopy('basket.viewCart') }));
    expect(mocks.navigate).toHaveBeenCalledWith('/cart');
    expect(mocks.post).toHaveBeenCalledTimes(1);
  });

  it('chạm đúp nút thêm giỏ chỉ gửi một lần', async () => {
    let release: (v: unknown) => void = () => {};
    mocks.get.mockResolvedValue({ data: SET.map((p) => catalog(p.slug)), total: 3 });
    mocks.post.mockImplementation(() => new Promise((r) => (release = r)));
    render(wrap(<MiniBasketCart products={SET} />));
    const btn = screen.getByRole('button', { name: gameCopy('basket.add') });
    fireEvent.click(btn);
    fireEvent.click(btn);
    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1));
    fireEvent.click(btn);
    await act(async () => release({ ok: true }));
    await waitFor(() => expect(screen.getByTestId('mini-basket-status')).toHaveTextContent(gameCopy('basket.added', { n: 3 })));
    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(mocks.post).toHaveBeenCalledTimes(1);
  });

  it('chưa đăng nhập: mời đăng nhập, khách bỏ ngang thì không gửi gì', async () => {
    mocks.auth.status = 'idle';
    mocks.login.mockResolvedValue(undefined);
    render(wrap(<MiniBasketCart products={SET} />));
    fireEvent.click(screen.getByRole('button', { name: gameCopy('basket.add') }));
    await waitFor(() => expect(mocks.login).toHaveBeenCalledTimes(1));
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.post).not.toHaveBeenCalled();
  });
});

describe('MiniBasket (Mini)', () => {
  const task = { id: 't1', task: 'Rửa chén bát', products: [...SET, prod('a', 'Nước hoa'), prod('b', 'Sơn tường'), prod('c', 'Xà phòng')] };

  it('chọn 3 trong 6: món thứ tư không vào và có lời nhắc, đổi ý được, Xong nộp đúng một lần', () => {
    const onFinish = vi.fn();
    render(<MiniBasket content={{ task }} onFinish={onFinish} onStatus={() => {}} />);
    const done = screen.getByRole('button', { name: gameCopy('basket.done') });
    for (const i of [0, 1, 2]) fireEvent.click(screen.getByTestId(`mini-basket-item-${i}`));
    fireEvent.click(screen.getByTestId('mini-basket-item-3'));
    expect(screen.getByTestId('mini-basket-item-3')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('mini-basket-item-3')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByTestId('mini-basket-hint')).toHaveTextContent(gameCopy('basket.full'));
    fireEvent.click(screen.getByTestId('mini-basket-item-1'));
    fireEvent.click(screen.getByTestId('mini-basket-item-4'));
    fireEvent.click(done);
    fireEvent.click(done);
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(onFinish).toHaveBeenCalledWith(['nuoc-rua-chen', 'khan-lau', 'b']);
  });

  it('hết giờ: nộp các món đang chọn', () => {
    vi.useFakeTimers();
    const onFinish = vi.fn();
    render(<MiniBasket content={{ task }} onFinish={onFinish} onStatus={() => {}} />);
    fireEvent.click(screen.getByTestId('mini-basket-item-0'));
    act(() => vi.advanceTimersByTime(46_000));
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(onFinish).toHaveBeenCalledWith(['nuoc-rua-chen']);
  });
});

describe('MiniMatch (Mini)', () => {
  const cards: MiniMatchCard[] = [
    { cardId: 'i1', label: 'Bồ hòn', side: 'ingredient' },
    { cardId: 'u1', label: 'Tạo bọt', side: 'use' },
    { cardId: 'i2', label: 'Giấm', side: 'ingredient' },
    { cardId: 'u2', label: 'Tẩy cặn', side: 'use' },
  ];

  it('ghép nguyên liệu với công dụng, hai thẻ cùng loại báo không khớp, ghép đủ thì nộp một lần', () => {
    vi.useFakeTimers();
    const onFinish = vi.fn();
    render(<MiniMatch content={{ cards }} onFinish={onFinish} onStatus={() => {}} />);
    fireEvent.click(screen.getByTestId('mini-match-card-0'));
    fireEvent.click(screen.getByTestId('mini-match-card-2'));
    expect(screen.getByTestId('mini-match-card-0')).toHaveAttribute('data-state', 'mismatch');
    expect(screen.getByTestId('mini-match-hint')).toHaveTextContent(gameCopy('match.mismatch'));
    act(() => vi.advanceTimersByTime(900));
    expect(screen.getByTestId('mini-match-card-0')).toHaveAttribute('data-state', 'idle');
    fireEvent.click(screen.getByTestId('mini-match-card-0'));
    fireEvent.click(screen.getByTestId('mini-match-card-3'));
    expect(screen.getByTestId('mini-match-card-3')).toHaveAttribute('data-state', 'paired');
    expect(screen.getByTestId('mini-match-card-3')).toHaveTextContent(gameCopy('match.pair', { k: 1 }));
    fireEvent.click(screen.getByTestId('mini-match-card-1'));
    fireEvent.click(screen.getByTestId('mini-match-card-2'));
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(onFinish).toHaveBeenCalledWith([
      ['i1', 'u2'],
      ['i2', 'u1'],
    ]);
  });
});

describe('MiniOrigin (Mini)', () => {
  const items: MiniChoiceItem[] = [
    { id: 'o1', prompt: 'Chè Shan tuyết', options: ['Hà Giang', 'Lâm Đồng', 'Huế', 'Cà Mau'], product: null },
    { id: 'o2', prompt: 'Mật ong bạc hà', options: ['Mèo Vạc', 'Bến Tre', 'Huế', 'Đà Lạt'], product: prod('mat-ong', 'Mật ong') },
  ];

  it('chọn vùng rồi Lượt tiếp; lượt sản phẩm có nhãn; lượt cuối là Xong và nộp đáp án', () => {
    const onFinish = vi.fn();
    render(<MiniOrigin content={{ items }} onFinish={onFinish} onStatus={() => {}} />);
    expect(screen.getByRole('button', { name: gameCopy('origin.next') })).toBeDisabled();
    fireEvent.click(screen.getByTestId('mini-origin-option-0'));
    fireEvent.click(screen.getByRole('button', { name: gameCopy('origin.next') }));
    expect(screen.getByTestId('mini-origin-prompt')).toHaveTextContent('Mật ong bạc hà');
    expect(screen.getByText(gameCopy('origin.productTurn'))).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('mini-origin-option-2'));
    fireEvent.click(screen.getByRole('button', { name: gameCopy('quiz.finish') }));
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(onFinish).toHaveBeenCalledWith([0, 2]);
  });
});
