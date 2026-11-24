import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Trang Tiết kiệm với Refill (Mini App): cùng dữ liệu, chữ và luật với web /tiet-kiem-refill.

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  goSmart: vi.fn(),
  coreGet: vi.fn(),
  addToCart: vi.fn(),
  notify: vi.fn(),
  track: vi.fn(),
  login: vi.fn(),
  getSubscriptions: vi.fn(),
  status: 'authenticated' as string,
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div className="zaui-page">{children}</div>,
  useNavigate: () => mocks.navigate,
}));
vi.mock('../lib/smart-nav', () => ({ useSmartNavigate: () => mocks.goSmart }));
vi.mock('../services/core-http', () => ({ coreHttp: { get: mocks.coreGet } }));
vi.mock('../services/shop-api', () => ({ addToCart: mocks.addToCart }));
vi.mock('../services/analytics', () => ({ trackEvent: mocks.track }));
vi.mock('../hooks/use-notify', () => ({ useNotify: () => ({ notify: mocks.notify }) }));
vi.mock('../hooks/use-login-notice', () => ({ useLoginWithNotice: () => mocks.login }));
vi.mock('../store/auth', () => ({
  useAuthStore: Object.assign((pick: (s: { status: string }) => unknown) => pick({ status: mocks.status }), { getState: () => ({ status: mocks.status }) }),
}));
vi.mock('../services/subscriptions-api', () => ({ getSubscriptions: mocks.getSubscriptions, updateSubscription: vi.fn(), isStaleSubscriptionError: () => false }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));
vi.mock('../utils/cart-feedback', () => ({ playCartFeedback: vi.fn() }));

import RefillDealsPage from './refill-deals';

const offer = (id: string, price: number) => ({
  productId: `p-${id}`, slug: `refill-${id}`, name: `Túi Refill ${id} 2L`, thumbnail: null, variationId: `v-${id}`, price, compareAt: null, sizeLabel: '2L', inStock: true, tubu: true,
});
const bottle = (id: string) => ({ productId: `b-${id}`, slug: `chai-${id}`, name: `Nước rửa chén ${id} 500ml`, thumbnail: null, price: 68_000, compareAt: null, sizeLabel: '500ml', inStock: true });
let landing: unknown;

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RefillDealsPage />
    </QueryClientProvider>,
  );
}
const adds = () => screen.getAllByTestId('pdp-refill-add');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.status = 'authenticated';
  landing = {
    enabled: true,
    pairs: [
      { bottle: bottle('a'), refill: offer('a', 200_000), savingPct: 26 },
      { bottle: bottle('c'), refill: offer('c', 230_000), savingPct: 15 },
    ],
  };
  mocks.coreGet.mockImplementation(async (path: string) => {
    if (path === '/catalog/refill-pairs/landing') return landing;
    throw new Error(`đường dẫn lạ ${path}`);
  });
  mocks.addToCart.mockResolvedValue({ items: [] });
  mocks.getSubscriptions.mockResolvedValue([]);
});

describe('RefillDealsPage (Mini App, tubu-w17-01)', () => {
  it('h1, câu mở đầu "tới X%", mỗi hàng "Thay cho <chai>" + thẻ gói; báo đã hiện MỘT lần cho cả trang; chạm thẻ mở trang gói', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { level: 1, name: 'Tiết kiệm với Refill' })).toBeTruthy();
    const rows = await screen.findAllByTestId('refill-landing-row');
    expect(rows).toHaveLength(2);
    expect(screen.getAllByTestId('refill-landing-bottle').map((el) => el.textContent)).toEqual(['Thay cho Nước rửa chén a 500ml', 'Thay cho Nước rửa chén c 500ml']);
    expect(document.body.textContent).toMatch(/tới \d+%/);
    expect(mocks.coreGet).toHaveBeenCalledWith('/catalog/refill-pairs/landing', { anonymous: true });
    expect(mocks.track.mock.calls.filter((x) => x[0] === 'refill_swap_shown')).toEqual([['refill_swap_shown', 'miniapp', { surface: 'landing' }]]);
    fireEvent.click(screen.getAllByTestId('pdp-refill-open')[0]!);
    expect(mocks.navigate).toHaveBeenCalledWith('/product/refill-a');
  });

  it('khách có gói định kỳ đang chạy của một gói Refill trên trang: thẻ "Kỳ Refill tới" trên danh sách; không có gói như vậy thì không có thẻ', async () => {
    mocks.getSubscriptions.mockResolvedValue([
      {
        id: 's1', quantity: 1, intervalWeeks: 4, status: 'ACTIVE', nextRunAt: new Date(Date.now() + 10 * 864e5).toISOString(), productName: 'Túi Refill a 2L',
        variationName: 'Túi 2L', thumbnail: null, slug: 'refill-a', unitPrice: 200_000, effectiveDiscountPct: 0.1, cycleSubtotal: 200_000, cycleDiscount: 20_000, cycleGoods: 180_000,
      },
    ]);
    const { unmount } = renderPage();
    const card = await screen.findByTestId('refill-next-delivery');
    expect(card.compareDocumentPosition(screen.getByTestId('refill-landing-list')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(card.textContent).toContain('Giá định kỳ −10%, rẻ hơn giá lẻ 20.000đ');
    expect(screen.getByTestId('refill-next-postpone').textContent).toContain('Dời lịch kỳ tới (+7 ngày)');
    unmount();

    mocks.getSubscriptions.mockResolvedValue([]);
    renderPage();
    await screen.findAllByTestId('refill-landing-row');
    expect(screen.queryByTestId('refill-next-delivery')).toBeNull();
  });

  it('Câu hỏi thường gặp: ba câu, chạm mở/đóng câu trả lời', async () => {
    renderPage();
    const faq = await screen.findByTestId('refill-landing-faq');
    const buttons = faq.querySelectorAll('button');
    expect(buttons).toHaveLength(3);
    expect(buttons[0]!.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(buttons[0]!);
    expect(buttons[0]!.getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById('refill-faq-0')!.hidden).toBe(false);
    expect(document.getElementById('refill-faq-1')!.hidden).toBe(true);
  });

  it('"+ Thêm": đúng gói, số lượng 1, một lệnh mỗi lúc (thẻ khác aria-disabled); xong báo đã thêm và refill_swap_applied surface landing', async () => {
    let resolve!: (v: unknown) => void;
    mocks.addToCart.mockImplementation(() => new Promise((r) => (resolve = r)));
    renderPage();
    await screen.findAllByTestId('refill-landing-row');
    await act(async () => {
      fireEvent.click(adds()[1]!);
    });
    fireEvent.click(adds()[0]!);
    expect(mocks.addToCart).toHaveBeenCalledTimes(1);
    expect(mocks.addToCart).toHaveBeenCalledWith('v-c', 1);
    await waitFor(() => expect(adds()[0]!.getAttribute('aria-disabled')).toBe('true'));
    await act(async () => resolve({ items: [] }));
    await waitFor(() => expect(mocks.track).toHaveBeenCalledWith('refill_swap_applied', 'miniapp', { surface: 'landing' }));
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
  });

  it('chưa đăng nhập: mời đăng nhập trước; vẫn chưa đăng nhập thì không thêm', async () => {
    mocks.status = 'guest';
    renderPage();
    await screen.findAllByTestId('refill-landing-row');
    expect(mocks.getSubscriptions).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(adds()[0]!);
    });
    expect(mocks.login).toHaveBeenCalledTimes(1);
    expect(mocks.addToCart).not.toHaveBeenCalled();
  });

  it('máy chủ từ chối (gói vừa hết hàng): báo lỗi, không báo đã đổi', async () => {
    mocks.addToCart.mockRejectedValue(Object.assign(new Error('Sản phẩm đã hết hàng'), { response: { status: 409, data: { message: 'Sản phẩm đã hết hàng' } } }));
    renderPage();
    await screen.findAllByTestId('refill-landing-row');
    await act(async () => {
      fireEvent.click(adds()[0]!);
    });
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })));
    expect(mocks.track).not.toHaveBeenCalledWith('refill_swap_applied', expect.anything(), expect.anything());
  });

  it('cờ tắt hay không có cặp: lời trống dẫn về Danh mục, không FAQ, không báo đã hiện', async () => {
    landing = { enabled: false, pairs: [] };
    renderPage();
    expect(await screen.findByText('Chưa có gói Refill nào đang mở bán')).toBeTruthy();
    expect(screen.queryByTestId('refill-landing-faq')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Xem sản phẩm khác' }));
    expect(mocks.goSmart).toHaveBeenCalledWith('/browse');
    expect(mocks.track).not.toHaveBeenCalledWith('refill_swap_shown', expect.anything(), expect.anything());
  });
});
