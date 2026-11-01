import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type * as ZmpUi from 'zmp-ui';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  coreGet: vi.fn(),
  navigate: vi.fn(),
  claim: vi.fn(),
  pendingCode: null as string | null,
  phase: 'guest' as 'authenticated' | 'guest' | 'loading',
}));
vi.mock('zmp-ui', async (importOriginal) => ({ ...(await importOriginal<typeof ZmpUi>()), useNavigate: () => mocks.navigate }));
vi.mock('../../services/core-http', () => ({ coreHttp: { get: mocks.coreGet } }));
vi.mock('../../hooks/use-claim-coupon', () => ({ useClaimCoupon: () => ({ claim: mocks.claim, pendingCode: mocks.pendingCode }) }));
vi.mock('../../hooks/use-auth-phase', () => ({ useAuthPhase: () => mocks.phase }));
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
let mine: unknown;
const MINE_PATH = '/coupons/collectable/mine';
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
  mocks.phase = 'guest';
  collectable = [];
  mine = { claimed: [], newCustomerOnly: [] };
  mocks.coreGet.mockImplementation(async (path: string) => {
    if (path === MINE_PATH) return mine;
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

  it('mã đã có trong ví hoặc đã hết lượt không chiếm chỗ: chỉ mã nhận được ngay; nhãn đếm đủ số thẻ trang /vouchers sẽ vẽ', async () => {
    collectable = [coupon('MINE'), coupon('FULL', { usageLimit: 3, claimedCount: 3 }), coupon('OPEN')];
    renderCollect(['MINE']);
    const region = await screen.findByRole('region', { name: 'Nhận mã' });
    expect(within(region).getAllByRole('group')).toHaveLength(1);
    expect(within(region).getByText(/OPEN/)).toBeInTheDocument();
    // /vouchers tab Nhận mã vẽ cả mã đã lưu và mã hết lượt: 3 thẻ, không phải 1.
    expect(within(region).getByRole('button', { name: 'Xem tất cả Mã giảm giá' })).toHaveTextContent('Tất cả 3 mã');
  });

  it('khách chưa đăng nhập không gọi phần riêng của khách', async () => {
    collectable = [coupon('A')];
    renderCollect();
    await screen.findByRole('region', { name: 'Nhận mã' });
    expect(mocks.coreGet.mock.calls.filter(([p]) => p === MINE_PATH)).toHaveLength(0);
  });

  it('mã khách đã nhận mà ví không còn (đã dùng hết lượt cá nhân) không chiếm chỗ và không có nút Lưu mã', async () => {
    mocks.phase = 'authenticated';
    collectable = [coupon('USED', { usageLimit: 100, claimedCount: 10 }), coupon('OPEN')];
    mine = { claimed: ['USED'], newCustomerOnly: [] };
    renderCollect();
    const region = await screen.findByRole('region', { name: 'Nhận mã' });
    expect(within(region).getAllByRole('group')).toHaveLength(1);
    expect(within(region).getByText(/OPEN/)).toBeInTheDocument();
    expect(within(region).queryByText(/USED/)).toBeNull();
    expect(within(region).getByRole('button', { name: 'Xem tất cả Mã giảm giá' })).toHaveTextContent('Tất cả 2 mã');
  });

  it('mã chỉ dành khách mới mà khách đã có đơn không chiếm chỗ; chỉ còn mã ấy thì ẩn cả khối', async () => {
    mocks.phase = 'authenticated';
    collectable = [coupon('NEWONLY', { newCustomerOnly: true })];
    mine = { claimed: [], newCustomerOnly: ['NEWONLY'] };
    const { container } = renderCollect();
    await waitFor(() => expect(mocks.coreGet.mock.calls.filter(([p]) => p === MINE_PATH)).toHaveLength(1));
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('phần riêng của khách chưa tải xong thì chưa vẽ thẻ Lưu mã (khỏi nháy rồi biến mất)', async () => {
    mocks.phase = 'authenticated';
    collectable = [coupon('USED'), coupon('OPEN')];
    let release: (v: unknown) => void = () => undefined;
    mocks.coreGet.mockImplementation(async (path: string) => (path === MINE_PATH ? new Promise((r) => (release = r)) : collectable));
    renderCollect();
    await waitFor(() => expect(mocks.coreGet.mock.calls.filter(([p]) => p === MINE_PATH)).toHaveLength(1));
    expect(screen.queryByRole('button', { name: 'Lưu mã' })).toBeNull();
    release({ claimed: ['USED'], newCustomerOnly: [] });
    expect(await screen.findAllByRole('button', { name: 'Lưu mã' })).toHaveLength(1);
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
