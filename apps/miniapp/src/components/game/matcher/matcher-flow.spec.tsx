import type { ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gameCopy } from '@tubutree/app-core/game-mini/copy';
import { matcherCopy } from '@tubutree/app-core/game-mini/matcher-copy';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  login: vi.fn(),
  track: vi.fn(),
  get: vi.fn(),
  post: vi.fn(),
  status: 'authenticated' as 'authenticated' | 'idle',
}));
vi.mock('zmp-ui', async (orig) => ({ ...(await orig<Record<string, unknown>>()), useNavigate: () => vi.fn(), useLocation: () => ({ search: '?from=play_today' }) }));
vi.mock('../../../lib/smart-nav', () => ({ useSmartNavigate: () => mocks.navigate }));
vi.mock('../../../hooks/use-auth-phase', () => ({ useAuthPhase: () => (mocks.status === 'authenticated' ? 'authenticated' : 'guest') }));
vi.mock('../../../hooks/use-login-notice', () => ({ useLoginWithNotice: () => mocks.login }));
vi.mock('../../../services/analytics', () => ({ trackEvent: mocks.track }));
vi.mock('../../../services/cart-key', () => ({ cartStorefrontSlug: () => null }));
vi.mock('../../../services/core-http', () => ({ coreHttp: { get: mocks.get, post: mocks.post } }));
vi.mock('../../../store/auth', () => ({ useAuthStore: { getState: () => ({ status: mocks.status }) } }));

import MatcherFlow from './matcher-flow';

/**
 * Chọn Chuẩn Xanh trong Mini App: câu hỏi và bộ gợi ý từ API, 5 bước bằng chạm, nộp một lần; MỘT nút thêm cả bộ (một lệnh lô dù chạm đúp, khách
 * chưa đăng nhập đăng nhập tại chỗ rồi bộ được thêm tiếp); cờ tắt thì báo tạm nghỉ.
 */

const opt = (value: string, label: string) => ({ value, label, tags: [value] });
const CONTENT = {
  questions: [
    { code: 'need', step: 1, prompt: 'Bạn đang cần đồ cho việc gì nhất?', options: [opt('laundry', 'Giặt quần áo'), opt('kitchen', 'Rửa chén, bếp')], when: null },
    { code: 'kitchen_how', step: 2, prompt: 'Nhà bạn rửa chén thế nào?', options: [opt('hand', 'Rửa tay'), opt('machine', 'Máy rửa chén')], when: ['kitchen'] },
    { code: 'laundry_who', step: 2, prompt: 'Giặt cho ai là chính?', options: [opt('family', 'Cả nhà'), opt('kids', 'Bé nhỏ')], when: ['laundry'] },
    { code: 'size_home', step: 3, prompt: 'Bạn muốn mua cỡ nào?', options: [opt('small', 'Chai nhỏ'), opt('large', 'Chai lớn')], when: ['laundry', 'kitchen'] },
  ],
  trivia: [
    { id: 't-a', prompt: 'Baking soda có tính gì?', options: ['Axit nhẹ', 'Kiềm nhẹ'], answer: 1, explanation: 'Muối kiềm nhẹ.', sourceUrl: 'https://www.example.org/a' },
    { id: 't-b', prompt: 'Axit citric giúp gì?', options: ['Tạo bọt', 'Tan cặn vôi'], answer: 1, explanation: 'Hoà tan cặn.', sourceUrl: 'https://www.example.org/b' },
  ],
};
const item = (n: number) => ({
  slug: `mon-${n}`,
  productId: `p-${n}`,
  variationId: `v-${n}`,
  name: `Món xanh ${n}`,
  variationName: null,
  imageUrl: null,
  price: 100_000,
  compareAtPrice: null,
  flash: false,
  why: `Lý do ${n}`,
});
const RESULT = { outcomeId: 'o-kitchen', code: 'kitchen_machine', title: 'Bộ máy rửa chén', fallback: false, items: [item(1), item(2)], total: 200_000, water: 0 };

const wrap = (ui: ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>
);
const value = (v: string) => document.querySelector<HTMLElement>(`button[data-value="${v}"]`)!;
const resultPosts = () => mocks.post.mock.calls.filter((c) => c[0] === '/game/matcher/result');
const cartPosts = () => mocks.post.mock.calls.filter((c) => c[0] === '/cart/items/batch');

/** Câu hỏi về từ API: nút Bắt đầu chờ (loading) tới lúc có nội dung. */
async function start() {
  render(wrap(<MatcherFlow />));
  const btn = await screen.findByRole('button', { name: matcherCopy('intro.start') });
  await waitFor(() => expect(btn).not.toBeDisabled());
  fireEvent.click(btn);
  await screen.findByTestId('matcher-question-1');
}

async function play() {
  await start();
  fireEvent.click(value('kitchen'));
  fireEvent.click(screen.getByTestId('matcher-trivia').querySelector('.tubu-mg-option')!);
  await screen.findByTestId('matcher-trivia-feedback');
  fireEvent.click(screen.getByRole('button', { name: matcherCopy('next') }));
  fireEvent.click(value('machine'));
  fireEvent.click(screen.getByTestId('matcher-trivia').querySelector('.tubu-mg-option')!);
  fireEvent.click(await screen.findByRole('button', { name: matcherCopy('next') }));
  fireEvent.click(value('large'));
  return screen.findByTestId('matcher-result');
}

beforeEach(() => {
  mocks.status = 'authenticated';
  for (const m of [mocks.get, mocks.post, mocks.navigate, mocks.login, mocks.track]) m.mockReset();
  mocks.get.mockImplementation((path: string) => (path === '/game/matcher' ? Promise.resolve(CONTENT) : Promise.reject(new Error(`unmocked ${path}`))));
});

describe('MatcherFlow (Mini App)', () => {
  it('5 bước bằng chạm nộp đúng một lần; tiêu đề game dùng chung chữ với dòng "Chơi hôm nay"', async () => {
    mocks.post.mockResolvedValue(RESULT);
    await play();
    expect(screen.getAllByText(gameCopy('game.matcher.title')).length).toBeGreaterThan(0);
    expect(resultPosts()).toHaveLength(1);
    expect(resultPosts()[0]![1]).toMatchObject({ answers: expect.any(Object) });
    expect(screen.getByTestId('matcher-items').querySelectorAll('li')).toHaveLength(2);
    expect(screen.getByTestId('matcher-total')).toHaveTextContent(matcherCopy('result.total', { n: 2 }));
    expect(mocks.track).toHaveBeenCalledWith('matcher_started', 'miniapp', { entry: 'play_today' });
  });

  it('thêm cả bộ: chạm đúp vẫn một lệnh lô cho mọi món; xong thì nút thành "Xem giỏ" mở /cart', async () => {
    let release: (v: unknown) => void = () => {};
    mocks.post.mockImplementation((path: string) => (path === '/game/matcher/result' ? Promise.resolve(RESULT) : new Promise((r) => (release = r))));
    await play();
    const add = screen.getByRole('button', { name: matcherCopy('result.addAll') });
    fireEvent.click(add);
    fireEvent.click(add);
    await waitFor(() => expect(cartPosts()).toHaveLength(1));
    expect(cartPosts()[0]![1]).toMatchObject({ items: [{ variationId: 'v-1', quantity: 1 }, { variationId: 'v-2', quantity: 1 }], addSource: 'pdp' });
    await act(async () => release({ items: [], subtotal: 0, discount: 0, itemCount: 2 }));
    await waitFor(() => expect(screen.getByTestId('matcher-add-status')).toHaveTextContent(matcherCopy('result.added', { n: 2 })));
    fireEvent.click(screen.getByRole('button', { name: matcherCopy('result.viewCart') }));
    expect(mocks.navigate).toHaveBeenCalledWith('/cart');
    expect(cartPosts()).toHaveLength(1);
  });

  it('khách chưa đăng nhập: đăng nhập Zalo tại chỗ rồi bộ được thêm, kết quả giữ nguyên; bỏ dở thì không ghi gì', async () => {
    mocks.status = 'idle';
    mocks.post.mockResolvedValue(RESULT);
    await play();
    mocks.login.mockResolvedValueOnce(undefined);
    fireEvent.click(screen.getByRole('button', { name: matcherCopy('result.addAll') }));
    await waitFor(() => expect(mocks.login).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('button', { name: matcherCopy('result.addAll') })).not.toBeDisabled());
    expect(cartPosts()).toHaveLength(0);
    mocks.login.mockImplementationOnce(async () => {
      mocks.status = 'authenticated';
    });
    fireEvent.click(screen.getByRole('button', { name: matcherCopy('result.addAll') }));
    await waitFor(() => expect(screen.getByTestId('matcher-add-status')).toHaveTextContent(matcherCopy('result.added', { n: 2 })));
    expect(mocks.login).toHaveBeenCalledTimes(2);
    expect(cartPosts()).toHaveLength(1);
    expect(screen.getByTestId('matcher-result')).toBeInTheDocument();
  });

  it('lùi một bước giữ đáp án đã chọn', async () => {
    await start();
    fireEvent.click(value('kitchen'));
    await screen.findByTestId('matcher-trivia');
    fireEvent.click(screen.getByTestId('matcher-back'));
    expect(value('kitchen')).toHaveAttribute('aria-pressed', 'true');
  });

  it('cờ tắt (404 GAME_DISABLED): báo tạm nghỉ, nút về Vườn Xanh; không nộp gì', async () => {
    mocks.get.mockRejectedValue({ response: { status: 404, data: { code: 'GAME_DISABLED' } } });
    render(wrap(<MatcherFlow />));
    const off = await screen.findByTestId('matcher-off');
    expect(off).toHaveTextContent(matcherCopy('error.disabled'));
    fireEvent.click(screen.getByRole('button', { name: matcherCopy('error.home') }));
    expect(mocks.navigate).toHaveBeenCalledWith('/game');
    expect(mocks.post).not.toHaveBeenCalled();
  });
});
