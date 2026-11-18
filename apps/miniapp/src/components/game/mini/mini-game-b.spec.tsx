import type { ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MiniChoiceItem, MiniKitchenSwap, MiniMatchCard, MiniProductCard } from '@tubutree/shared-types';
import { gameCopy } from '@tubutree/app-core/game-mini/copy';
import { kitchenCopy } from '@tubutree/app-core/game-mini/kitchen-copy';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  login: vi.fn(),
  notify: vi.fn(),
  get: vi.fn(),
  post: vi.fn(),
  status: 'authenticated' as 'authenticated' | 'idle',
  phase: 'authenticated' as 'authenticated' | 'guest' | 'loading',
}));
vi.mock('zmp-ui', async (orig) => ({ ...(await orig<Record<string, unknown>>()), useNavigate: () => vi.fn() }));
vi.mock('../../../lib/smart-nav', () => ({ useSmartNavigate: () => mocks.navigate }));
vi.mock('../../../hooks/use-auth-phase', () => ({ useAuthPhase: () => mocks.phase }));
vi.mock('../../../hooks/use-login-notice', () => ({ useLoginWithNotice: () => mocks.login }));
vi.mock('../../../hooks/use-notify', () => ({ useNotify: () => ({ notify: mocks.notify }) }));
vi.mock('../../../services/cart-key', () => ({ cartStorefrontSlug: () => null }));
vi.mock('../../../services/core-http', () => ({ coreHttp: { get: mocks.get, post: mocks.post } }));
vi.mock('../../../store/auth', () => ({ useAuthStore: { getState: () => ({ status: mocks.status }) } }));

import MiniBasket from './mini-basket';
import MiniKitchenSwapBoard from './mini-kitchen-swap';
import MiniMatch from './mini-match';
import MiniOrigin from './mini-origin';
import { LearnedProducts, MiniBasketCart } from './mini-result-cart';

/**
 * Các bàn chơi Mini App của Ghép Cặp, Đoán Xuất Xứ, Giỏ Đúng Việc, Căn Bếp Xanh (chạm, nộp đúng một lần) và phần "Thêm vào giỏ" của màn kết
 * quả: một lệnh lô dù chạm đúp, món hết hàng được báo, khách chưa đăng nhập đăng nhập tại chỗ rồi món được thêm tiếp, không gọi API game nào.
 */

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
const wrap = (ui: ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>
);
const noop = () => {};
const paths = () => [...mocks.get.mock.calls, ...mocks.post.mock.calls].map((c) => String(c[0]));

beforeEach(() => {
  mocks.status = 'authenticated';
  mocks.phase = 'authenticated';
  for (const m of [mocks.get, mocks.post, mocks.navigate, mocks.login, mocks.notify]) m.mockReset();
});

describe('MiniBasket', () => {
  const task = { id: 't1', task: 'Rửa chén bát', products: [...SET, prod('a', 'Nước hoa'), prod('b', 'Sơn tường'), prod('c', 'Xà phòng')] };

  it('chạm chọn 3 trong 6: món thứ tư không vào (có lời nhắc), đổi ý được, Xong nộp đúng một lần', () => {
    const onFinish = vi.fn();
    render(<MiniBasket content={{ task }} onFinish={onFinish} onStatus={noop} />);
    const done = screen.getByRole('button', { name: gameCopy('basket.done') });
    expect(done).toBeDisabled();
    for (const i of [0, 1, 2]) fireEvent.click(screen.getByTestId(`mini-basket-item-${i}`));
    fireEvent.click(screen.getByTestId('mini-basket-item-3'));
    expect(screen.getByTestId('mini-basket-item-3')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('mini-basket-hint')).toHaveTextContent(gameCopy('basket.full'));
    fireEvent.click(screen.getByTestId('mini-basket-item-1'));
    fireEvent.click(screen.getByTestId('mini-basket-item-4'));
    fireEvent.click(done);
    fireEvent.click(done);
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(onFinish).toHaveBeenCalledWith(['nuoc-rua-chen', 'khan-lau', 'b']);
  });
});

describe('MiniMatch', () => {
  const cards: MiniMatchCard[] = [
    { cardId: 'i1', label: 'Bồ hòn', side: 'ingredient' },
    { cardId: 'u1', label: 'Tạo bọt', side: 'use' },
    { cardId: 'i2', label: 'Giấm', side: 'ingredient' },
    { cardId: 'u2', label: 'Tẩy cặn', side: 'use' },
  ];

  it('thẻ là nút có tên đọc được; chạm lại thẻ của cặp thì gỡ cặp; ghép đủ thì nộp một lần', () => {
    const onFinish = vi.fn();
    render(<MiniMatch content={{ cards }} onFinish={onFinish} onStatus={noop} />);
    const card = (i: number) => screen.getByTestId(`mini-match-card-${i}`);
    expect(card(0).tagName).toBe('BUTTON');
    expect(card(0)).toHaveAttribute('aria-label', gameCopy('match.cardAria', { n: 1, label: 'Bồ hòn', side: gameCopy('match.side.ingredient') }));
    fireEvent.click(card(0));
    fireEvent.click(card(3));
    expect(card(3)).toHaveAttribute('data-state', 'paired');
    fireEvent.click(card(3));
    expect(card(0)).toHaveAttribute('data-state', 'idle');
    fireEvent.click(card(1));
    fireEvent.click(card(0));
    expect(card(0)).toHaveAttribute('aria-label', gameCopy('match.cardPairedAria', { n: 1, label: 'Bồ hòn', k: 1 }));
    fireEvent.click(card(2));
    fireEvent.click(card(3));
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(onFinish).toHaveBeenCalledWith([
      ['i1', 'u1'],
      ['i2', 'u2'],
    ]);
  });
});

describe('MiniOrigin', () => {
  const items: MiniChoiceItem[] = [
    { id: 'o1', prompt: 'Chè Shan tuyết', options: ['Hà Giang', 'Lâm Đồng', 'Huế', 'Cà Mau'], product: null },
    { id: 'o2', prompt: 'Mật ong bạc hà', options: ['Mèo Vạc', 'Bến Tre', 'Huế', 'Đà Lạt'], product: prod('mat-ong', 'Mật ong bạc hà') },
  ];

  it('chọn vùng rồi Lượt tiếp; lượt sản phẩm có nhãn riêng; lượt cuối nộp đáp án một lần; Mini App không vẽ bản đồ', async () => {
    const onFinish = vi.fn();
    render(<MiniOrigin content={{ items }} onFinish={onFinish} onStatus={noop} />);
    expect(screen.getByRole('button', { name: gameCopy('origin.next') })).toBeDisabled();
    fireEvent.click(screen.getByTestId('mini-origin-option-1'));
    fireEvent.click(screen.getByRole('button', { name: gameCopy('origin.next') }));
    expect(screen.getByTestId('mini-origin-prompt')).toHaveTextContent('Mật ong bạc hà');
    expect(screen.getByText(gameCopy('origin.productTurn'))).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('mini-origin-option-3'));
    fireEvent.click(screen.getByRole('button', { name: gameCopy('quiz.finish') }));
    await waitFor(() => expect(onFinish).toHaveBeenCalledTimes(1));
    expect(onFinish).toHaveBeenCalledWith([1, 3]);
    expect(screen.queryByTestId('mini-origin-map')).toBeNull();
  });
});

describe('MiniKitchenSwapBoard', () => {
  const opt = (slug: string, fact: string) => ({ product: prod(slug, `SP ${slug}`), fact });
  const swaps: MiniKitchenSwap[] = [
    { id: 'k1', corner: 'kitchen', item: 'Nước rửa chén chai nhựa', emoji: null, hidden: 'Vỏ nhựa dùng một lần', options: [opt('a1', 'Bồ hòn'), opt('a2', 'Refill'), opt('a3', 'Bánh rửa chén')] },
    { id: 'k2', corner: 'bathroom', item: 'Nước tẩy bồn cầu', emoji: null, hidden: 'Chất tẩy mạnh', options: [opt('b1', 'Enzyme'), opt('b2', 'Giấm'), opt('b3', 'Baking soda')] },
  ];

  it('mỗi góc chạm một sản phẩm để đổi: khoá lựa chọn, hiện điều bao bì ghi, Góc tiếp; góc cuối nộp đúng một lần', () => {
    const onFinish = vi.fn();
    render(<MiniKitchenSwapBoard content={{ swaps }} onFinish={onFinish} onStatus={noop} />);
    expect(screen.getByTestId('mini-kitchen-corner-0')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByRole('button', { name: kitchenCopy('next') })).toBeDisabled();
    fireEvent.click(screen.getByTestId('mini-kitchen-option-1'));
    expect(screen.getByTestId('mini-kitchen-swapped')).toHaveTextContent(kitchenCopy('swapped', { name: 'SP a2' }));
    expect(screen.getByTestId('mini-kitchen-fact-text')).toHaveTextContent('Refill');
    expect(screen.queryByTestId('mini-kitchen-option-0')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: kitchenCopy('next') }));
    expect(screen.getByTestId('mini-kitchen-item')).toHaveTextContent('Nước tẩy bồn cầu');
    expect(screen.getByTestId('mini-kitchen-corner-1')).toHaveAttribute('aria-current', 'step');
    fireEvent.click(screen.getByTestId('mini-kitchen-option-0'));
    const finish = screen.getByRole('button', { name: kitchenCopy('finish') });
    fireEvent.click(finish);
    fireEvent.click(finish);
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(onFinish).toHaveBeenCalledWith(['a2', 'b1']);
  });
});

describe('MiniBasketCart (Mini App)', () => {
  it('một món hết hàng: một lệnh lô cho hai món còn hàng, báo tên món hết, nút thành "Xem giỏ hàng" mở /cart, không gọi API game', async () => {
    mocks.get.mockResolvedValue({ data: [catalog('nuoc-rua-chen'), catalog('giam-gao', false), catalog('khan-lau')], total: 3 });
    mocks.post.mockResolvedValue({ ok: true });
    render(wrap(<MiniBasketCart products={SET} game="basket" />));
    fireEvent.click(screen.getByRole('button', { name: gameCopy('basket.add') }));
    await waitFor(() => expect(screen.getByTestId('mini-basket-status')).toHaveTextContent(gameCopy('basket.added', { n: 2 })));
    expect(screen.getByTestId('mini-basket-status')).toHaveTextContent(gameCopy('basket.skipped', { names: 'Giấm gạo' }));
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(mocks.post.mock.calls[0]![0]).toBe('/cart/items/batch');
    expect(mocks.post.mock.calls[0]![1]).toEqual({ items: [{ variationId: 'v-nuoc-rua-chen', quantity: 1 }, { variationId: 'v-khan-lau', quantity: 1 }] });
    expect(paths().some((p) => p.includes('/game'))).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: gameCopy('basket.viewCart') }));
    expect(mocks.navigate).toHaveBeenCalledWith('/cart');
    expect(mocks.post).toHaveBeenCalledTimes(1);
  });

  it('chạm đúp nút thêm cả bộ chỉ gửi một lệnh; Căn Bếp Xanh dùng chữ riêng', async () => {
    let release: (v: unknown) => void = () => {};
    mocks.get.mockResolvedValue({ data: SET.map((p) => catalog(p.slug)), total: 3 });
    mocks.post.mockImplementation(() => new Promise((r) => (release = r)));
    render(wrap(<MiniBasketCart products={SET} game="kitchen_swap" />));
    expect(screen.getByTestId('mini-kitchen-set')).toHaveTextContent(kitchenCopy('set'));
    const btn = screen.getByRole('button', { name: kitchenCopy('add') });
    fireEvent.click(btn);
    fireEvent.click(btn);
    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1));
    fireEvent.click(btn);
    await act(async () => release({ ok: true }));
    await waitFor(() => expect(screen.getByTestId('mini-kitchen-status')).toHaveTextContent(gameCopy('basket.added', { n: 3 })));
    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(mocks.post).toHaveBeenCalledTimes(1);
  });

  it('khách chưa đăng nhập: đăng nhập Zalo ngay tại chỗ rồi bộ được thêm tiếp, không rời màn kết quả', async () => {
    mocks.status = 'idle';
    mocks.login.mockImplementation(async () => {
      mocks.status = 'authenticated';
    });
    mocks.get.mockResolvedValue({ data: SET.map((p) => catalog(p.slug)), total: 3 });
    mocks.post.mockResolvedValue({ ok: true });
    render(wrap(<MiniBasketCart products={SET} game="basket" />));
    fireEvent.click(screen.getByRole('button', { name: gameCopy('basket.add') }));
    await waitFor(() => expect(screen.getByTestId('mini-basket-status')).toHaveTextContent(gameCopy('basket.added', { n: 3 })));
    expect(mocks.login).toHaveBeenCalledTimes(1);
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('khách bỏ dở đăng nhập: không ghi gì vào giỏ, nút vẫn là "Thêm cả bộ" để bấm lại', async () => {
    mocks.status = 'idle';
    mocks.login.mockResolvedValue(undefined);
    render(wrap(<MiniBasketCart products={SET} game="basket" />));
    fireEvent.click(screen.getByRole('button', { name: gameCopy('basket.add') }));
    await waitFor(() => expect(mocks.login).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('button', { name: gameCopy('basket.add') })).not.toBeDisabled());
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.post).not.toHaveBeenCalled();
    expect(screen.getByTestId('mini-basket-status')).toBeEmptyDOMElement();
  });

  it('lệnh đầu lỗi mạng: báo thử lại, bấm lại được', async () => {
    mocks.get.mockRejectedValue(new Error('offline'));
    render(wrap(<MiniBasketCart products={SET} game="basket" />));
    fireEvent.click(screen.getByRole('button', { name: gameCopy('basket.add') }));
    await waitFor(() => expect(screen.getByTestId('mini-basket-status')).toHaveTextContent(gameCopy('basket.error')));
    expect(screen.getByRole('button', { name: gameCopy('basket.add') })).not.toBeDisabled();
  });
});

describe('LearnedProducts (Mini App)', () => {
  it('sản phẩm lượt cuối (Đoán Xuất Xứ): "+ Thêm vào giỏ" một chạm, chạm đúp vẫn một lệnh, báo bằng thanh thông báo', async () => {
    let release: (v: unknown) => void = () => {};
    mocks.get.mockResolvedValue({ data: [catalog('mat-ong')], total: 1 });
    mocks.post.mockImplementation(() => new Promise((r) => (release = r)));
    render(wrap(<LearnedProducts game="origin" product={prod('mat-ong', 'Mật ong bạc hà')} matchSlugs={[]} />));
    expect(screen.getByTestId('mini-result-product')).toHaveTextContent(gameCopy('result.originProduct'));
    const add = screen.getByRole('button', { name: gameCopy('result.add') });
    fireEvent.click(add);
    fireEvent.click(add);
    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1));
    expect(mocks.post.mock.calls[0]![1]).toEqual({ items: [{ variationId: 'v-mat-ong', quantity: 1 }] });
    await act(async () => release({ ok: true }));
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith({ text: gameCopy('basket.added', { n: 1 }), type: 'success' }));
    expect(paths().some((p) => p.includes('/game'))).toBe(false);
  });

  it('Ghép Cặp: thẻ sản phẩm theo cặp lấy giá/tồn kho từ danh mục; món hết hàng không có nút thêm', async () => {
    mocks.get.mockResolvedValue({ data: [catalog('dau-goi'), catalog('xa-bong', false)], total: 2 });
    render(wrap(<LearnedProducts game="match" product={null} matchSlugs={['dau-goi', 'xa-bong']} />));
    const panel = await screen.findByTestId('mini-result-products');
    expect(panel).toHaveTextContent(gameCopy('result.matchProduct'));
    expect(screen.getAllByRole('button', { name: gameCopy('result.add') })).toHaveLength(1);
  });

  it('khách chưa đăng nhập: đăng nhập tại chỗ rồi món được thêm', async () => {
    mocks.status = 'idle';
    mocks.login.mockImplementation(async () => {
      mocks.status = 'authenticated';
    });
    mocks.get.mockResolvedValue({ data: [catalog('mat-ong')], total: 1 });
    mocks.post.mockResolvedValue({ ok: true });
    render(wrap(<LearnedProducts game="daily_quiz" product={prod('mat-ong', 'Mật ong bạc hà')} matchSlugs={[]} />));
    fireEvent.click(screen.getByRole('button', { name: gameCopy('result.add') }));
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith({ text: gameCopy('basket.added', { n: 1 }), type: 'success' }));
    expect(mocks.login).toHaveBeenCalledTimes(1);
    expect(mocks.post).toHaveBeenCalledTimes(1);
  });
});
