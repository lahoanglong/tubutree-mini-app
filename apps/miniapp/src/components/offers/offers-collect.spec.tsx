import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type * as ZmpUi from 'zmp-ui';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  coreGet: vi.fn(),
  navigate: vi.fn(),
  claim: vi.fn(),
  pendingCode: null as string | null,
}));
vi.mock('zmp-ui', async (importOriginal) => ({ ...(await importOriginal<typeof ZmpUi>()), useNavigate: () => mocks.navigate }));
vi.mock('../../services/core-http', () => ({ coreHttp: { get: mocks.coreGet } }));
vi.mock('../../hooks/use-claim-coupon', () => ({ useClaimCoupon: () => ({ claim: mocks.claim, pendingCode: mocks.pendingCode }) }));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));

import { COLLECT_HINT_KEY } from '@tubutree/app-core/home-layout';
import { OffersCollect } from './offers-collect';

const DAY = 86_400_000;
const coupon = (code: string, over: Record<string, unknown> = {}) => ({
  code,
  title: null,
  type: 'AMOUNT',
  value: 30_000,
  minOrder: 199_000,
  maxDiscount: null,
  startAt: new Date(Date.now() - DAY).toISOString(),
  endAt: new Date(Date.now() + 20 * DAY).toISOString(),
  newCustomerOnly: false,
  claimedCount: 0,
  usageLimit: null,
  ...over,
});

let collectable: unknown;
function renderCollect(walletCodes: string[] = [], walletLoading = false) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <OffersCollect walletCodes={new Set(walletCodes)} walletLoading={walletLoading} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.pendingCode = null;
  collectable = [];
  mocks.coreGet.mockImplementation(async () => {
    if ((collectable as { isHttpError?: boolean }).isHttpError) throw collectable;
    return collectable;
  });
});

describe('OffersCollect — khối Nhận mã ở trang Ưu đãi', () => {
  it('5 mã chưa nhận: chỉ 3 thẻ đầu, nút "Lưu mã" gọi claim, "Tất cả 5 mã" tới /vouchers', async () => {
    collectable = ['A', 'B', 'C', 'D', 'E'].map((c, i) => coupon(c, { endAt: new Date(Date.now() + (i + 2) * DAY).toISOString() }));
    renderCollect();
    const region = await screen.findByRole('region', { name: 'Nhận mã' });
    expect(within(region).getAllByRole('group')).toHaveLength(3);
    fireEvent.click(within(region).getAllByRole('button', { name: 'Lưu mã' })[0]!);
    expect(mocks.claim).toHaveBeenCalledWith('A');
    const all = within(region).getByRole('button', { name: 'Xem tất cả Mã giảm giá' });
    expect(all).toHaveTextContent('Tất cả 5 mã');
    fireEvent.click(all);
    expect(mocks.navigate).toHaveBeenCalledWith('/vouchers');
  });

  it('mã đã có trong ví hoặc đã hết lượt không chiếm chỗ: chỉ mã nhận được ngay', async () => {
    collectable = [coupon('MINE'), coupon('FULL', { usageLimit: 3, claimedCount: 3 }), coupon('OPEN')];
    renderCollect(['MINE']);
    const region = await screen.findByRole('region', { name: 'Nhận mã' });
    expect(within(region).getAllByRole('group')).toHaveLength(1);
    expect(within(region).getByText(/OPEN/)).toBeInTheDocument();
    expect(within(region).getByRole('button', { name: 'Xem tất cả Mã giảm giá' })).toHaveTextContent('Tất cả 1 mã');
  });

  it('không có mã nào nhận được: không vẽ gì', async () => {
    collectable = [coupon('MINE')];
    const { container } = renderCollect(['MINE']);
    await waitFor(() => expect(mocks.coreGet).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('tải lỗi: khối lỗi tại chỗ có "Thử lại", bấm thì gọi lại và vẽ được mã', async () => {
    collectable = { isHttpError: true, response: { status: 500, data: { message: 'x' } } };
    renderCollect();
    const retry = await screen.findByRole('button', { name: 'Thử lại' });
    expect(screen.getByText('Chưa tải được mã giảm giá')).toBeInTheDocument();
    collectable = [coupon('A')];
    fireEvent.click(retry);
    expect(await screen.findByRole('button', { name: 'Lưu mã' })).toBeInTheDocument();
    expect(mocks.coreGet).toHaveBeenCalledTimes(2);
  });

  it('đang nhận một mã: nút của mã đó báo bận (aria-busy)', async () => {
    collectable = [coupon('A'), coupon('B')];
    mocks.pendingCode = 'A';
    renderCollect();
    const buttons = await screen.findAllByRole('button', { name: 'Lưu mã' });
    expect(buttons[0]).toHaveAttribute('aria-busy', 'true');
    expect(buttons[1]).not.toHaveAttribute('aria-busy');
  });

  it('nhớ số mã lần trước để giữ chỗ lúc tải: có gợi ý 2 thì khung chờ cao đúng 2 thẻ, chưa nhớ thì im lặng', async () => {
    let release: (v: unknown) => void = () => undefined;
    mocks.coreGet.mockReturnValue(new Promise((r) => (release = r)));
    localStorage.setItem(COLLECT_HINT_KEY, '2');
    const first = renderCollect();
    const frame = screen.getByTestId('offers-collect-loading');
    // Chỗ của hàng tiêu đề (44px) cộng 2 thẻ cách nhau 12px: khối thật vào chỗ không đẩy gì xuống.
    expect(frame.firstElementChild).toHaveStyle({ height: '44px' });
    expect(frame.lastElementChild).toHaveStyle({ height: `${2 * 88 + 12}px` });
    release([]);
    await waitFor(() => expect(first.container).toBeEmptyDOMElement());
    expect(localStorage.getItem(COLLECT_HINT_KEY)).toBe('0');
    first.unmount();
    localStorage.clear();
    mocks.coreGet.mockReturnValue(new Promise(() => undefined));
    expect(renderCollect().container).toBeEmptyDOMElement();
  });

  it('ghi gợi ý số thẻ đã vẽ (tối đa 3) sau khi tải xong', async () => {
    collectable = ['A', 'B', 'C', 'D'].map((c) => coupon(c));
    renderCollect();
    await screen.findByRole('region', { name: 'Nhận mã' });
    expect(localStorage.getItem(COLLECT_HINT_KEY)).toBe('3');
  });
});
