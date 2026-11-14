import type { ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HttpError } from '../../services/http';
import { pickKitProducts, type HomeQuizAnswers } from '@tubutree/app-core/arcade/home-quiz';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: { status: 'authenticated' as 'authenticated' | 'unauthenticated', user: null as { id: string; phone: string | null; zaloId: string | null } | null },
  arcadeStatus: vi.fn(),
  login: vi.fn(),
  navigate: vi.fn(),
  snackbar: vi.fn(),
  submit: vi.fn(),
  fetchProducts: vi.fn(),
  fetchProduct: vi.fn(),
  addToCart: vi.fn(),
  getCart: vi.fn(),
  fetchFlash: vi.fn(),
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useNavigate: () => mocks.navigate,
  useSnackbar: () => ({ openSnackbar: mocks.snackbar }),
}));
vi.mock('../../store/auth', () => {
  const state = () => ({ status: mocks.auth.status, user: mocks.auth.user });
  return { useAuthStore: Object.assign((sel: (s: ReturnType<typeof state>) => unknown) => sel(state()), { getState: state }) };
});
vi.mock('../../hooks/use-login-notice', () => ({ useLoginWithNotice: () => mocks.login }));
vi.mock('../../services/arcade-api', () => ({
  arcadeStatusQuery: { queryKey: ['game', 'arcade'], queryFn: () => mocks.arcadeStatus() },
  submitArcadeRun: vi.fn(),
  submitHomeQuiz: (answers: unknown) => mocks.submit(answers),
}));
vi.mock('../../services/shop-api', () => ({
  fetchProducts: (q: unknown) => mocks.fetchProducts(q),
  fetchProduct: (slug: string) => mocks.fetchProduct(slug),
  addToCart: (...a: unknown[]) => mocks.addToCart(...a),
  getCart: () => mocks.getCart(),
  fetchActiveFlashSales: () => mocks.fetchFlash(),
}));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));
vi.mock('../variation-sheet', () => ({
  VariationSheet: (p: { variations: { id: string }[]; onConfirm: (v: { id: string }, qty: number) => void }) => (
    <div data-testid="variation-sheet">
      <button type="button" onClick={() => p.onConfirm(p.variations[1]!, 2)}>
        xác nhận phân loại
      </button>
    </div>
  ),
}));
vi.mock('../ui/product-card', () => ({
  ProductCard: (p: { product: { name: string }; variant: string; showWishlist?: boolean; listSource?: string; addLabel?: string; onAdd?: () => void }) => (
    <div data-testid="kit-card" data-variant={p.variant} data-wishlist={String(p.showWishlist)} data-source={p.listSource}>
      <span>{p.product.name}</span>
      {p.onAdd && (
        <button type="button" onClick={p.onAdd}>
          {p.addLabel}
        </button>
      )}
    </div>
  ),
}));

import { HomeQuizCard } from './home-quiz-card';

const REAL_USER = { id: 'u1', phone: '0900000001', zaloId: 'zalo-1' };
const DEVICE_USER = { id: 'g1', phone: null, zaloId: 'guest_abc' };
const ANSWERS: HomeQuizAnswers = { family: 'baby_pet', worry: 'grease', format: 'bottle' };
const LABELS = ['Có em bé hoặc thú cưng', 'Vết dầu mỡ bám dai', 'Chai vòi tiện lợi'];
const product = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id, slug: `sp-${id}`, brand: 'Tubu', name, thumbnail: null, basePrice: 50_000, salePrice: null, isFeatured: false, inStock: true, ...over,
});
const CATALOG = [
  product('a', 'Nước rửa chén Bồ Hòn chai vòi', { sold: 90 }),
  product('b', 'Nước lau sàn tinh dầu sả chanh', { sold: 40 }),
  product('c', 'Xà phòng hữu cơ dịu nhẹ', { sold: 10 }),
  product('d', 'Nước tẩy dầu mỡ hết hàng', { inStock: false }),
  product('e', 'Túi refill nước giặt', { sold: 5 }),
  product('f', 'Nước rửa chén Bồ Hòn ngừng bán', { isActive: false }),
];
const page = (data: unknown[]) => ({ data, meta: { page: 1, limit: 40, total: data.length } });
const detail = (variations: { id: string; stock: number }[]) => ({ id: 'a', slug: 'sp-a', name: 'Nước rửa chén', thumbnail: null, variations: variations.map((v) => ({ name: v.id, sku: v.id, attributes: {}, retailPrice: 50_000, salePrice: null, ...v })) });

let qc: QueryClient;
function renderCard() {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrap = (children: ReactNode) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return render(wrap(<HomeQuizCard />));
}
const sheet = () => within(screen.getByRole('dialog', { name: 'Chẩn đoán tổ ấm' }));
const openSheet = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu Chẩn đoán tổ ấm' }));
  return screen.findByTestId('home-quiz-step');
};
async function answerAll() {
  await openSheet();
  for (const label of LABELS) {
    fireEvent.click(sheet().getByRole('button', { name: new RegExp(label) }));
    if (label !== LABELS[2]) await waitFor(() => expect(screen.getByTestId('home-quiz-step')).not.toHaveTextContent(label));
  }
  await screen.findByTestId('home-quiz-result');
}
const names = () => screen.getAllByTestId('kit-card').map((c) => c.querySelector('span')!.textContent);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.status = 'authenticated';
  mocks.auth.user = REAL_USER;
  mocks.arcadeStatus.mockResolvedValue({ games: {}, window: null, windowBonus: false, nextWindowAt: null, quizClaimed: false });
  mocks.fetchProducts.mockResolvedValue(page(CATALOG));
  mocks.submit.mockResolvedValue({ granted: 10, alreadyClaimed: false, totalSeeds: 50 });
  mocks.addToCart.mockResolvedValue({ items: [], itemCount: 0 });
  mocks.getCart.mockResolvedValue({ items: [], itemCount: 0 });
  mocks.fetchFlash.mockResolvedValue([]);
  mocks.fetchProduct.mockResolvedValue(detail([{ id: 'v1', stock: 5 }]));
  mocks.login.mockResolvedValue(undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('HomeQuizCard: thẻ mời (tĩnh)', () => {
  it('vùng có tên theo h2, có mô tả, quà và nút Bắt đầu có tên đọc màn hình; chưa gọi API nào, chưa dựng sheet', () => {
    renderCard();
    const region = screen.getByRole('region', { name: 'Chẩn đoán tổ ấm' });
    expect(within(region).getByRole('heading', { level: 2, name: 'Chẩn đoán tổ ấm' })).toBeInTheDocument();
    expect(within(region).getByText(fillCopy('homeQuiz.card.sub'))).toBeInTheDocument();
    expect(within(region).getByText(fillCopy('homeQuiz.card.reward'))).toBeInTheDocument();
    expect(within(region).getByRole('button', { name: 'Bắt đầu Chẩn đoán tổ ấm' })).toHaveTextContent('Bắt đầu');
    expect(screen.queryByRole('dialog')).toBeNull();
    for (const fn of [mocks.fetchProducts, mocks.submit, mocks.fetchProduct, mocks.addToCart, mocks.getCart]) expect(fn).not.toHaveBeenCalled();
  });
});

describe('HomeQuizCard: dòng quà trên thẻ', () => {
  const REWARD = fillCopy('homeQuiz.card.reward');
  const CLAIMED = fillCopy('homeQuiz.result.claimed');
  const claimedStatus = (quizClaimed: boolean) => ({ games: {}, window: null, windowBonus: false, nextWindowAt: null, quizClaimed });

  it('khách thật chưa nhận quà: vẫn nói lần đầu có quà Giọt nước; hỏi trạng thái đúng một lần', async () => {
    mocks.arcadeStatus.mockResolvedValue(claimedStatus(false));
    renderCard();
    await waitFor(() => expect(mocks.arcadeStatus).toHaveBeenCalledTimes(1));
    expect(screen.getByText(REWARD)).toBeInTheDocument();
    expect(screen.queryByText(CLAIMED)).toBeNull();
  });

  it('khách thật đã nhận quà (quizClaimed: true): thẻ không hứa quà nữa, dùng câu trung tính', async () => {
    mocks.arcadeStatus.mockResolvedValue(claimedStatus(true));
    renderCard();
    expect(await screen.findByText(CLAIMED)).toBeInTheDocument();
    expect(screen.queryByText(REWARD)).toBeNull();
    expect(screen.getByText(fillCopy('homeQuiz.card.sub'))).toBeInTheDocument();
  });

  it('trạng thái đang tải hoặc lỗi: giữ lời hứa mặc định, không treo thẻ', async () => {
    mocks.arcadeStatus.mockRejectedValue(new Error('mạng'));
    renderCard();
    await waitFor(() => expect(mocks.arcadeStatus).toHaveBeenCalled());
    expect(screen.getByText(REWARD)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bắt đầu Chẩn đoán tổ ấm' })).toBeEnabled();
  });

  it.each([
    ['khách chưa đăng nhập', 'unauthenticated', null],
    ['tài khoản khách theo thiết bị', 'authenticated', DEVICE_USER],
  ] as const)('%s: không gọi trạng thái mini game và vẫn thấy lời hứa quà', (_name, status, user) => {
    mocks.auth.status = status;
    mocks.auth.user = user;
    mocks.arcadeStatus.mockResolvedValue(claimedStatus(true));
    renderCard();
    expect(mocks.arcadeStatus).not.toHaveBeenCalled();
    expect(screen.getByText(REWARD)).toBeInTheDocument();
  });

  it('nhận quà xong trong sheet thì sau khi đóng, thẻ đổi sang câu đã nhận (trạng thái được làm mới)', async () => {
    mocks.arcadeStatus.mockResolvedValue(claimedStatus(false));
    renderCard();
    await waitFor(() => expect(mocks.arcadeStatus).toHaveBeenCalledTimes(1));
    mocks.arcadeStatus.mockResolvedValue(claimedStatus(true));
    await answerAll();
    await screen.findByText(fillCopy('homeQuiz.result.granted', { n: 10 }));
    fireEvent.click(sheet().getByRole('button', { name: 'Đóng' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByText(CLAIMED)).toBeInTheDocument();
    expect(screen.queryByText(REWARD)).toBeNull();
  });
});

describe('HomeQuizCard: ba câu hỏi', () => {
  it('mở sheet ở câu 1/3: h3 là câu hỏi, hai đáp án là nút aria-pressed=false, chưa có nút Quay lại', async () => {
    renderCard();
    const step = await openSheet();
    expect(within(step).getByText('Câu 1/3')).toBeInTheDocument();
    expect(within(step).getByRole('heading', { level: 3, name: 'Nhà bạn có em bé hoặc thú cưng không?' })).toBeInTheDocument();
    const options = within(step).getAllByRole('button');
    expect(options).toHaveLength(2);
    for (const option of options) expect(option).toHaveAttribute('aria-pressed', 'false');
    expect(step).toHaveAttribute('role', 'group');
    expect(sheet().queryByRole('button', { name: 'Quay lại' })).toBeNull();
    expect(mocks.fetchProducts).not.toHaveBeenCalled();
  });

  it('chạm một đáp án sang câu kế ngay, đưa focus vào khối câu hỏi mới; ba câu có 2, 3, 2 đáp án', async () => {
    renderCard();
    await openSheet();
    const counts: number[] = [];
    for (const label of LABELS.slice(0, 2)) {
      counts.push(within(screen.getByTestId('home-quiz-step')).getAllByRole('button').length);
      fireEvent.click(sheet().getByRole('button', { name: new RegExp(label) }));
      await waitFor(() => expect(screen.getByTestId('home-quiz-step')).not.toHaveTextContent(label));
      expect(document.activeElement).toBe(screen.getByTestId('home-quiz-step'));
    }
    counts.push(within(screen.getByTestId('home-quiz-step')).getAllByRole('button').length);
    expect(counts).toEqual([2, 3, 2]);
    expect(within(screen.getByTestId('home-quiz-step')).getByText('Câu 3/3')).toBeInTheDocument();
  });

  it('hai cú chạm cùng nhịp vào một câu chỉ sang câu kế MỘT lần (không nhảy cóc câu 2)', async () => {
    renderCard();
    await openSheet();
    const option = sheet().getByRole('button', { name: /Có em bé hoặc thú cưng/ });
    act(() => {
      option.click();
      option.click();
    });
    expect(await screen.findByText('Câu 2/3')).toBeInTheDocument();
    expect(screen.queryByTestId('home-quiz-result')).toBeNull();
  });

  it('Quay lại về câu trước và giữ đáp án đã chọn (aria-pressed=true)', async () => {
    renderCard();
    await openSheet();
    fireEvent.click(sheet().getByRole('button', { name: /Có em bé hoặc thú cưng/ }));
    await screen.findByText('Câu 2/3');
    fireEvent.click(sheet().getByRole('button', { name: 'Quay lại' }));
    await screen.findByText('Câu 1/3');
    expect(sheet().getByRole('button', { name: /Có em bé hoặc thú cưng/ })).toHaveAttribute('aria-pressed', 'true');
    expect(sheet().getByRole('button', { name: /Chỉ có người lớn/ })).toHaveAttribute('aria-pressed', 'false');
    expect(sheet().queryByRole('button', { name: 'Quay lại' })).toBeNull();
  });

  it('đóng rồi mở lại sheet: giữ nguyên câu đang trả lời, không làm lại từ đầu', async () => {
    renderCard();
    await openSheet();
    fireEvent.click(sheet().getByRole('button', { name: /Có em bé hoặc thú cưng/ }));
    await screen.findByText('Câu 2/3');
    fireEvent.click(sheet().getByRole('button', { name: 'Đóng' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu Chẩn đoán tổ ấm' }));
    expect(await screen.findByText('Câu 2/3')).toBeInTheDocument();
  });
});

describe('HomeQuizCard: kết quả và gợi ý sản phẩm', () => {
  it('tải sản phẩm một lần (40 món bán chạy), hiện đúng 2-3 món pickKitProducts chọn theo thứ tự, bỏ món hết hàng và ngừng bán', async () => {
    renderCard();
    await answerAll();
    await screen.findAllByTestId('kit-card');
    expect(mocks.fetchProducts).toHaveBeenCalledTimes(1);
    expect(mocks.fetchProducts).toHaveBeenCalledWith({ limit: 40, sort: 'best_seller' });
    const expected = pickKitProducts(ANSWERS, CATALOG).map((p) => p.name);
    expect(expected.length).toBeGreaterThanOrEqual(2);
    expect(expected.length).toBeLessThanOrEqual(3);
    expect(names()).toEqual(expected);
    expect(names()).not.toContain('Nước tẩy dầu mỡ hết hàng');
    expect(names()).not.toContain('Nước rửa chén Bồ Hòn ngừng bán');
    expect(sheet().getByRole('heading', { level: 3, name: fillCopy('homeQuiz.result.title') })).toBeInTheDocument();
  });

  it('thẻ gợi ý dùng dạng dòng, không tim yêu thích, ghi nguồn home_quiz, nút "+ Thêm vào giỏ" cho từng món', async () => {
    renderCard();
    await answerAll();
    const cards = await screen.findAllByTestId('kit-card');
    for (const card of cards) {
      expect(card).toHaveAttribute('data-variant', 'line');
      expect(card).toHaveAttribute('data-wishlist', 'false');
      expect(card).toHaveAttribute('data-source', 'home_quiz');
      expect(within(card).getByRole('button', { name: '+ Thêm vào giỏ' })).toBeInTheDocument();
    }
  });

  it('đang tải gợi ý: 3 khung chờ dạng dòng, không có thẻ thật', async () => {
    let release!: (v: unknown) => void;
    mocks.fetchProducts.mockReturnValue(new Promise((resolve) => (release = resolve)));
    renderCard();
    await answerAll();
    const loading = screen.getByTestId('home-quiz-loading');
    expect(loading).toHaveAttribute('aria-busy', 'true');
    expect(loading.querySelectorAll('.tubu-skeleton, [class*="skeleton"]').length).toBeGreaterThan(0);
    expect(screen.queryByTestId('kit-card')).toBeNull();
    await act(async () => release(page(CATALOG)));
    await screen.findAllByTestId('kit-card');
    expect(screen.queryByTestId('home-quiz-loading')).toBeNull();
  });

  it('không có món bán được: câu báo trống kèm nút Xem sản phẩm, bấm thì đóng sheet và mở /browse', async () => {
    mocks.fetchProducts.mockResolvedValue(page([product('x', 'Hết hàng', { inStock: false })]));
    renderCard();
    await answerAll();
    expect(await screen.findByText(fillCopy('homeQuiz.result.empty'))).toBeInTheDocument();
    expect(screen.queryByTestId('kit-card')).toBeNull();
    fireEvent.click(sheet().getByRole('button', { name: 'Xem sản phẩm' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/browse');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('tải lỗi: báo "Chưa tải được gợi ý", Thử lại tải lại và hiện món; quà vẫn xử lý riêng', async () => {
    mocks.fetchProducts.mockRejectedValueOnce(new Error('mạng'));
    renderCard();
    await answerAll();
    expect(await screen.findByText(fillCopy('homeQuiz.result.loadError'))).toBeInTheDocument();
    expect(screen.queryByTestId('kit-card')).toBeNull();
    fireEvent.click(sheet().getByRole('button', { name: /Thử lại/ }));
    await screen.findAllByTestId('kit-card');
    expect(mocks.fetchProducts).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(fillCopy('homeQuiz.result.loadError'))).toBeNull();
  });

  it('Làm lại: về câu 1 với đáp án trống, kết quả cũ mất', async () => {
    renderCard();
    await answerAll();
    await screen.findAllByTestId('kit-card');
    fireEvent.click(sheet().getByRole('button', { name: 'Làm lại' }));
    expect(await screen.findByText('Câu 1/3')).toBeInTheDocument();
    expect(screen.queryByTestId('kit-card')).toBeNull();
    for (const option of within(screen.getByTestId('home-quiz-step')).getAllByRole('button')) expect(option).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('HomeQuizCard: quà Giọt nước', () => {
  it('đã đăng nhập: gửi đúng ba đáp án đúng một lần và báo số Giọt nước nhận được', async () => {
    renderCard();
    await answerAll();
    expect(await screen.findByText(fillCopy('homeQuiz.result.granted', { n: 10 }))).toBeInTheDocument();
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    expect(mocks.submit).toHaveBeenCalledWith(ANSWERS);
    expect(sheet().queryByRole('button', { name: fillCopy('homeQuiz.result.guest') })).toBeNull();
  });

  it('đóng, mở lại, làm lại cả bộ câu hỏi: vẫn chỉ MỘT lần gửi quà (mỗi tài khoản một lần)', async () => {
    renderCard();
    await answerAll();
    await screen.findByText(fillCopy('homeQuiz.result.granted', { n: 10 }));
    fireEvent.click(sheet().getByRole('button', { name: 'Đóng' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu Chẩn đoán tổ ấm' }));
    await screen.findByTestId('home-quiz-result');
    fireEvent.click(sheet().getByRole('button', { name: 'Làm lại' }));
    await screen.findByText('Câu 1/3');
    for (const label of LABELS) {
      fireEvent.click(sheet().getByRole('button', { name: new RegExp(label) }));
      if (label !== LABELS[2]) await waitFor(() => expect(screen.getByTestId('home-quiz-step')).not.toHaveTextContent(label));
    }
    await screen.findByTestId('home-quiz-result');
    expect(mocks.submit).toHaveBeenCalledTimes(1);
  });

  it('đã nhận từ trước (alreadyClaimed) hoặc granted = 0: không hứa Giọt nước nào', async () => {
    mocks.submit.mockResolvedValue({ granted: 0, alreadyClaimed: true, totalSeeds: 50 });
    renderCard();
    await answerAll();
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1));
    await screen.findAllByTestId('kit-card');
    expect(screen.queryByText(/Bạn nhận \d+ Giọt nước/)).toBeNull();
    expect(within(screen.getByTestId('home-quiz-result')).getByText(fillCopy('homeQuiz.result.claimed'))).toBeInTheDocument();
  });

  it('granted = 0 mà chưa đánh dấu đã nhận: không hứa quà và cũng không nói đã nhận', async () => {
    mocks.submit.mockResolvedValue({ granted: 0, alreadyClaimed: false, totalSeeds: 50 });
    renderCard();
    await answerAll();
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1));
    await screen.findAllByTestId('kit-card');
    const result = within(screen.getByTestId('home-quiz-result'));
    expect(result.queryByText(/Bạn nhận \d+ Giọt nước/)).toBeNull();
    expect(result.queryByText(fillCopy('homeQuiz.result.claimed'))).toBeNull();
  });

  it('lưu quà lỗi rồi Làm lại và hoàn thành lần nữa: gửi lại MỘT lần (lần lỗi không tính), sau đó mới khoá', async () => {
    mocks.submit.mockRejectedValueOnce(new Error('mạng'));
    renderCard();
    await answerAll();
    await screen.findByText(fillCopy('homeQuiz.result.error'));
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    fireEvent.click(sheet().getByRole('button', { name: 'Làm lại' }));
    await screen.findByText('Câu 1/3');
    expect(screen.queryByText(fillCopy('homeQuiz.result.error'))).toBeNull();
    for (const label of LABELS) {
      fireEvent.click(sheet().getByRole('button', { name: new RegExp(label) }));
      if (label !== LABELS[2]) await waitFor(() => expect(screen.getByTestId('home-quiz-step')).not.toHaveTextContent(label));
    }
    expect(await screen.findByText(fillCopy('homeQuiz.result.granted', { n: 10 }))).toBeInTheDocument();
    expect(mocks.submit).toHaveBeenCalledTimes(2);
    expect(mocks.submit).toHaveBeenLastCalledWith(ANSWERS);
    fireEvent.click(sheet().getByRole('button', { name: 'Làm lại' }));
    await screen.findByText('Câu 1/3');
    for (const label of LABELS) {
      fireEvent.click(sheet().getByRole('button', { name: new RegExp(label) }));
      if (label !== LABELS[2]) await waitFor(() => expect(screen.getByTestId('home-quiz-step')).not.toHaveTextContent(label));
    }
    await screen.findByTestId('home-quiz-result');
    expect(mocks.submit).toHaveBeenCalledTimes(2);
  });

  it('tài khoản khách theo thiết bị (guest_): xem đủ gợi ý, KHÔNG gửi quà, có nút đăng nhập; không gọi trạng thái mini game', async () => {
    mocks.auth.user = DEVICE_USER;
    renderCard();
    await answerAll();
    await screen.findAllByTestId('kit-card');
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(mocks.arcadeStatus).not.toHaveBeenCalled();
    expect(sheet().queryByText(fillCopy('homeQuiz.result.error'))).toBeNull();
    fireEvent.click(sheet().getByRole('button', { name: fillCopy('homeQuiz.result.guest') }));
    expect(mocks.login).toHaveBeenCalledTimes(1);
  });

  it('tài khoản khách theo thiết bị vẫn thêm được vào giỏ (giỏ không cần khách thật)', async () => {
    mocks.auth.user = DEVICE_USER;
    renderCard();
    await answerAll();
    fireEvent.click(within((await screen.findAllByTestId('kit-card'))[0]!).getByRole('button', { name: '+ Thêm vào giỏ' }));
    await waitFor(() => expect(mocks.addToCart).toHaveBeenCalledWith('v1', 1));
    expect(mocks.login).not.toHaveBeenCalled();
  });

  it('lưu quà lỗi: báo lỗi, vẫn thấy gợi ý sản phẩm, Thử lại gửi lại và hiện quà', async () => {
    mocks.submit.mockRejectedValueOnce(new Error('mạng'));
    renderCard();
    await answerAll();
    expect(await screen.findByText(fillCopy('homeQuiz.result.error'))).toBeInTheDocument();
    await screen.findAllByTestId('kit-card');
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    fireEvent.click(sheet().getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByText(fillCopy('homeQuiz.result.granted', { n: 10 }))).toBeInTheDocument();
    expect(mocks.submit).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(fillCopy('homeQuiz.result.error'))).toBeNull();
  });

  it('khách: xem đủ gợi ý, KHÔNG gửi quà; nút đăng nhập mở đăng nhập; đăng nhập xong thì quà tự được ghi một lần', async () => {
    mocks.auth.status = 'unauthenticated';
    mocks.auth.user = null;
    const view = renderCard();
    await answerAll();
    await screen.findAllByTestId('kit-card');
    expect(mocks.submit).not.toHaveBeenCalled();
    fireEvent.click(sheet().getByRole('button', { name: fillCopy('homeQuiz.result.guest') }));
    expect(mocks.login).toHaveBeenCalledTimes(1);
    mocks.auth.status = 'authenticated';
    mocks.auth.user = REAL_USER;
    view.rerender(
      <QueryClientProvider client={qc}>
        <HomeQuizCard />
      </QueryClientProvider>,
    );
    expect(await screen.findByText(fillCopy('homeQuiz.result.granted', { n: 10 }))).toBeInTheDocument();
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    expect(mocks.submit).toHaveBeenCalledWith(ANSWERS);
    expect(sheet().queryByRole('button', { name: fillCopy('homeQuiz.result.guest') })).toBeNull();
  });
});

describe('HomeQuizCard: thêm vào giỏ một chạm', () => {
  const firstAdd = async () => within((await screen.findAllByTestId('kit-card'))[0]!).getByRole('button', { name: '+ Thêm vào giỏ' });

  it('một phân loại còn hàng: tải chi tiết rồi thêm thẳng 1 sản phẩm, báo đã thêm, cập nhật giỏ', async () => {
    renderCard();
    await answerAll();
    fireEvent.click(await firstAdd());
    await waitFor(() => expect(mocks.addToCart).toHaveBeenCalledTimes(1));
    expect(mocks.fetchProduct).toHaveBeenCalledWith('sp-a');
    expect(mocks.addToCart).toHaveBeenCalledWith('v1', 1);
    await waitFor(() => expect(mocks.snackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' })));
    expect(qc.getQueryData(['cart', null])).toEqual({ items: [], itemCount: 0 });
    expect(screen.queryByTestId('variation-sheet')).toBeNull();
  });

  it('hết hàng ngay lúc bấm: báo đúng lời chung, không gọi giỏ', async () => {
    mocks.fetchProduct.mockResolvedValue(detail([{ id: 'v1', stock: 0 }]));
    renderCard();
    await answerAll();
    fireEvent.click(await firstAdd());
    await waitFor(() => expect(mocks.snackbar).toHaveBeenCalledWith(expect.objectContaining({ text: 'Sản phẩm vừa hết hàng. Bạn xem sản phẩm khác nhé.', type: 'error' })));
    expect(mocks.addToCart).not.toHaveBeenCalled();
  });

  it('từ hai phân loại: mở bảng chọn, chưa thêm gì cho tới khi khách xác nhận', async () => {
    mocks.fetchProduct.mockResolvedValue(detail([{ id: 'v1', stock: 5 }, { id: 'v2', stock: 5 }]));
    renderCard();
    await answerAll();
    fireEvent.click(await firstAdd());
    expect(await screen.findByTestId('variation-sheet')).toBeInTheDocument();
    expect(mocks.addToCart).not.toHaveBeenCalled();
  });

  const rejection = (status: number) => new HttpError('từ chối', undefined, { status, data: { message: 'từ chối' }, headers: {} });
  const openPicker = async () => {
    mocks.fetchProduct.mockResolvedValue(detail([{ id: 'v1', stock: 5 }, { id: 'v2', stock: 5 }]));
    renderCard();
    await answerAll();
    fireEvent.click(await firstAdd());
    await screen.findByTestId('variation-sheet');
  };

  it('bảng chọn phân loại: xác nhận thêm đúng phân loại và số lượng đã chọn rồi đóng bảng', async () => {
    await openPicker();
    fireEvent.click(screen.getByRole('button', { name: 'xác nhận phân loại' }));
    await waitFor(() => expect(mocks.addToCart).toHaveBeenCalledWith('v2', 2));
    await waitFor(() => expect(screen.queryByTestId('variation-sheet')).toBeNull());
  });

  it('bảng chọn: lỗi 409 (món không còn) đóng bảng và tải lại giỏ, danh sách; lỗi 400 (chỉ còn N) giữ bảng để giảm số lượng', async () => {
    await openPicker();
    mocks.addToCart.mockRejectedValueOnce(rejection(409));
    fireEvent.click(screen.getByRole('button', { name: 'xác nhận phân loại' }));
    await waitFor(() => expect(screen.queryByTestId('variation-sheet')).toBeNull());
    expect(mocks.snackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
    await waitFor(() => expect(mocks.fetchProducts.mock.calls.length).toBeGreaterThanOrEqual(2));
    mocks.addToCart.mockRejectedValueOnce(rejection(400));
    fireEvent.click(await firstAdd());
    fireEvent.click(await screen.findByRole('button', { name: 'xác nhận phân loại' }));
    await waitFor(() => expect(mocks.addToCart).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mocks.snackbar.mock.calls.filter(([a]) => a.type === 'error')).toHaveLength(2));
    expect(screen.getByTestId('variation-sheet')).toBeInTheDocument();
  });

  it('thêm giỏ lỗi: báo lỗi và nút bấm lại được; hai món bấm sát nhau chỉ gửi MỘT lệnh', async () => {
    mocks.addToCart.mockRejectedValueOnce(new Error('mạng'));
    renderCard();
    await answerAll();
    const buttons = (await screen.findAllByTestId('kit-card')).map((c) => within(c).getByRole('button', { name: '+ Thêm vào giỏ' }));
    act(() => {
      buttons[0]!.click();
      buttons[1]!.click();
    });
    await waitFor(() => expect(mocks.snackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })));
    expect(mocks.addToCart).toHaveBeenCalledTimes(1);
    fireEvent.click(buttons[0]!);
    await waitFor(() => expect(mocks.addToCart).toHaveBeenCalledTimes(2));
  });

  it('khách: mời đăng nhập trước, chưa đăng nhập được thì không gọi chi tiết hay giỏ', async () => {
    mocks.auth.status = 'unauthenticated';
    mocks.auth.user = null;
    renderCard();
    await answerAll();
    fireEvent.click(await firstAdd());
    await waitFor(() => expect(mocks.login).toHaveBeenCalledTimes(1));
    expect(mocks.fetchProduct).not.toHaveBeenCalled();
    expect(mocks.addToCart).not.toHaveBeenCalled();
  });

  it('khách đăng nhập thành công ngay lúc bấm: thêm tiếp món vừa chọn', async () => {
    mocks.auth.status = 'unauthenticated';
    mocks.auth.user = null;
    mocks.login.mockImplementation(async () => {
      mocks.auth.status = 'authenticated';
      mocks.auth.user = REAL_USER;
    });
    renderCard();
    await answerAll();
    fireEvent.click(await firstAdd());
    await waitFor(() => expect(mocks.addToCart).toHaveBeenCalledWith('v1', 1));
    expect(mocks.login).toHaveBeenCalledTimes(1);
  });
});

describe('HomeQuizCard: tiếp cận được', () => {
  it('trong sheet mọi nút có tên, đáp án là nút thật, h2 của sheet đúng một', async () => {
    renderCard();
    await answerAll();
    await screen.findAllByTestId('kit-card');
    const dialog = screen.getByRole('dialog', { name: 'Chẩn đoán tổ ấm' });
    for (const button of within(dialog).getAllByRole('button')) expect((button.getAttribute('aria-label') ?? button.textContent ?? '').trim().length).toBeGreaterThan(0);
    expect(dialog.querySelectorAll('h2')).toHaveLength(1);
    expect(dialog.querySelector('[aria-live="polite"]')).not.toBeNull();
  });
});
