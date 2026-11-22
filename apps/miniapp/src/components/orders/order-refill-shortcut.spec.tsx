import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Thẻ Refill ở Chi tiết đơn đã giao (Mini App, tubu-w18-02): cùng luật, chữ và thẻ với web OrderRefillShortcut.

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  coreGet: vi.fn(),
  addToCart: vi.fn(),
  notify: vi.fn(),
  track: vi.fn(),
  login: vi.fn(),
  status: 'authenticated' as string,
}));

vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useNavigate: () => mocks.navigate,
}));
vi.mock('../../services/core-http', () => ({ coreHttp: { get: mocks.coreGet } }));
vi.mock('../../services/shop-api', () => ({ addToCart: mocks.addToCart }));
vi.mock('../../services/analytics', () => ({ trackEvent: mocks.track }));
vi.mock('../../hooks/use-notify', () => ({ useNotify: () => ({ notify: mocks.notify }) }));
vi.mock('../../hooks/use-login-notice', () => ({ useLoginWithNotice: () => mocks.login }));
vi.mock('../../store/auth', () => ({ useAuthStore: { getState: () => ({ status: mocks.status }) } }));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));
vi.mock('../../utils/cart-feedback', () => ({ playCartFeedback: vi.fn() }));

import { OrderRefillShortcut, type OrderRefillShortcutProps } from './order-refill-shortcut';

const offer = (id: string, price: number) => ({
  productId: `p-${id}`, slug: `refill-${id}`, name: `Túi Refill ${id} 2L`, thumbnail: null, variationId: `v-${id}`, price, compareAt: null, sizeLabel: '2L', inStock: true, tubu: true,
});
const bottle = (id: string) => ({ productId: `b-${id}`, slug: `chai-${id}`, name: `Nước rửa chén ${id} 500ml`, thumbnail: null, price: 68_000, compareAt: null, sizeLabel: '500ml', inStock: true });

function renderCard(props: Partial<OrderRefillShortcutProps> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <OrderRefillShortcut delivered refillOn slugs={['chai-a', 'khan-tre']} {...props} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.status = 'authenticated';
  mocks.coreGet.mockImplementation(async (path: string) => {
    if (path === '/catalog/refill-pairs/landing') {
      return { enabled: true, pairs: [{ bottle: bottle('a'), refill: offer('a', 200_000), savingPct: 26 }, { bottle: bottle('c'), refill: offer('c', 230_000), savingPct: 15 }] };
    }
    throw new Error(`đường dẫn lạ ${path}`);
  });
  mocks.addToCart.mockResolvedValue({ items: [] });
});

describe('OrderRefillShortcut (Mini App)', () => {
  it('đơn đã giao có chai ghép được: khối "Lần sau rót lại bằng Refill" với đúng gói thay cho chai trong đơn, báo đã hiện surface order, chạm thẻ mở trang gói', async () => {
    renderCard();
    const section = await screen.findByRole('region', { name: 'Lần sau rót lại bằng Refill' });
    expect(section.querySelector('h2')!.textContent).toBe('Lần sau rót lại bằng Refill');
    expect(screen.getAllByTestId('pdp-refill-add')).toHaveLength(1);
    expect(section.textContent).toContain('Chọn túi Refill 2L tiết kiệm');
    expect(section.textContent).toContain('200.000đ');
    expect(mocks.coreGet).toHaveBeenCalledWith('/catalog/refill-pairs/landing', { anonymous: true });
    expect(mocks.track).toHaveBeenCalledWith('refill_swap_shown', 'miniapp', { surface: 'order' });
    fireEvent.click(screen.getByTestId('pdp-refill-open'));
    expect(mocks.navigate).toHaveBeenCalledWith('/product/refill-a');
  });

  it('"+ Thêm" một chạm: đúng gói, số lượng 1, chạm đúp chỉ một lệnh; xong báo đã thêm và refill_swap_applied surface order', async () => {
    let resolve!: (v: unknown) => void;
    mocks.addToCart.mockImplementation(() => new Promise((r) => (resolve = r)));
    renderCard();
    const add = await screen.findByTestId('pdp-refill-add');
    await act(async () => {
      fireEvent.click(add);
      fireEvent.click(add);
    });
    expect(mocks.addToCart).toHaveBeenCalledTimes(1);
    expect(mocks.addToCart).toHaveBeenCalledWith('v-a', 1);
    await act(async () => resolve({ items: [] }));
    await waitFor(() => expect(mocks.track).toHaveBeenCalledWith('refill_swap_applied', 'miniapp', { surface: 'order' }));
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
  });

  it('chưa đăng nhập: mời đăng nhập trước; vẫn chưa đăng nhập thì không thêm', async () => {
    mocks.status = 'guest';
    renderCard();
    const add = await screen.findByTestId('pdp-refill-add');
    await act(async () => {
      fireEvent.click(add);
    });
    expect(mocks.login).toHaveBeenCalledTimes(1);
    expect(mocks.addToCart).not.toHaveBeenCalled();
  });

  it('gói đã có trong đơn: không gợi ý lại gói đó, chai khác không có trong đơn thì không có khối', async () => {
    const { container } = renderCard({ slugs: ['chai-a', 'refill-a'] });
    await waitFor(() => expect(mocks.coreGet).toHaveBeenCalled());
    await act(async () => undefined);
    expect(container).toBeEmptyDOMElement();
  });

  it.each([
    ['đơn chưa giao', { delivered: false }],
    ['cờ catalog.refill_first_enabled tắt', { refillOn: false }],
    ['đơn cũ không có slug', { slugs: [null, undefined, ''] }],
  ])('%s: không hỏi trang Refill, không có khối', async (_label, props) => {
    const { container } = renderCard(props as Partial<OrderRefillShortcutProps>);
    await act(async () => undefined);
    expect(mocks.coreGet).not.toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
  });
});
