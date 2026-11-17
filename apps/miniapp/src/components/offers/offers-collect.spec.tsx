import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider, type UseQueryResult } from '@tanstack/react-query';
import type * as ReactQuery from '@tanstack/react-query';
import type * as ZmpUi from 'zmp-ui';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  coreGet: vi.fn(),
  navigate: vi.fn(),
  claim: vi.fn(),
  apply: vi.fn(),
  pendingCode: null as string | null,
  phase: 'guest' as 'authenticated' | 'guest' | 'loading',
  refetch: vi.fn(),
}));
// Đếm số lần màn gọi `refetch` (không phải số lần gọi API): query chưa có dữ liệu tự gộp các lần tải chồng nên chỉ đếm API không phân biệt được.
vi.mock('@tanstack/react-query', async (importOriginal) => {
  const orig = await importOriginal<typeof ReactQuery>();
  return {
    ...orig,
    useQuery: ((...args: unknown[]) => {
      const result = (orig.useQuery as (...a: unknown[]) => UseQueryResult)(...args);
      return { ...result, refetch: (...a: Parameters<UseQueryResult['refetch']>) => { mocks.refetch(); return result.refetch(...a); } };
    }) as typeof orig.useQuery,
  };
});
vi.mock('zmp-ui', async (importOriginal) => ({ ...(await importOriginal<typeof ZmpUi>()), useNavigate: () => mocks.navigate }));
vi.mock('../../services/core-http', () => ({ coreHttp: { get: mocks.coreGet } }));
vi.mock('../../hooks/use-claim-coupon', () => ({ useClaimCoupon: () => ({ claim: mocks.claim, pendingCode: mocks.pendingCode }) }));
vi.mock('../../hooks/use-coupon-use', () => ({ useCouponUse: () => ({ apply: mocks.apply }) }));
vi.mock('../../hooks/use-auth-phase', () => ({ useAuthPhase: () => mocks.phase }));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));

import { COLLECT_HINT_KEY } from '@tubutree/app-core/home-layout';
import { OffersCollect, type OffersWallet } from './offers-collect';

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

const inWallet = (code: string) => ({ code, type: 'AMOUNT' as const, value: 30_000, minOrder: 199_000, maxDiscount: null, endAt: new Date(Date.now() + 20 * DAY).toISOString() });
const walletOf = (codes: string[], over: Partial<OffersWallet> = {}): OffersWallet => ({
  data: codes.map(inWallet),
  isError: false,
  isLoading: false,
  isFetching: false,
  error: null,
  refetch: vi.fn(),
  ...over,
});

let collectable: unknown;
let mine: unknown;
const MINE_PATH = '/coupons/collectable/mine';
function renderCollect(walletCodes: string[] = [], walletLoading = false, openAll = false, wallet?: OffersWallet) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <OffersCollect wallet={wallet ?? walletOf(walletCodes, { isLoading: walletLoading })} openAll={openAll} />
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
  it('5 mã chưa nhận: chỉ 3 thẻ đầu, nút "Lưu mã" gọi claim, "Tất cả (5)" mở cả kho ngay tại chỗ (không sang trang khác)', async () => {
    collectable = ['A', 'B', 'C', 'D', 'E'].map((c, i) => coupon(c, { endAt: new Date(Date.now() + (i + 2) * DAY).toISOString() }));
    renderCollect();
    const region = await screen.findByRole('region', { name: 'Nhận mã' });
    expect(within(region).getAllByRole('group')).toHaveLength(3);
    fireEvent.click(within(region).getAllByRole('button', { name: 'Lưu mã' })[0]!);
    expect(mocks.claim).toHaveBeenCalledWith('A');
    // Tên đọc chứa đủ nhãn nhìn thấy (có tổng số) cộng đích đến.
    const all = within(region).getByRole('button', { name: 'Tất cả (5) Mã giảm giá' });
    expect(all).toHaveTextContent('Tất cả (5)');
    fireEvent.click(all);
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(within(region).getAllByRole('group')).toHaveLength(5);
  });

  it('mã đã có trong ví hoặc đã hết lượt không chiếm chỗ: chỉ mã nhận được ngay; nhãn đếm đủ số thẻ khối mở sẽ vẽ', async () => {
    collectable = [coupon('MINE'), coupon('FULL', { usageLimit: 3, claimedCount: 3 }), coupon('OPEN')];
    renderCollect(['MINE']);
    const region = await screen.findByRole('region', { name: 'Nhận mã' });
    expect(within(region).getAllByRole('group')).toHaveLength(1);
    expect(within(region).getByText(/OPEN/)).toBeInTheDocument();
    // Khối mở vẽ cả mã đã lưu và mã hết lượt: 3 thẻ, không phải 1.
    expect(within(region).getByRole('button', { name: 'Tất cả (3) Mã giảm giá' })).toHaveTextContent('Tất cả (3)');
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
    expect(within(region).getByRole('button', { name: 'Tất cả (2) Mã giảm giá' })).toHaveTextContent('Tất cả (2)');
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

  it('"Thử lại" trả Promise tải lại (W82A): hai cú chạm cùng nhịp chỉ tải lại một lần, tải xong thì vẽ được mã', async () => {
    collectable = { isHttpError: true, response: { status: 500, data: { message: 'x' } } };
    renderCollect();
    const retry = await screen.findByRole('button', { name: 'Thử lại' });
    mocks.refetch.mockClear();
    let finish!: (v: unknown) => void;
    mocks.coreGet.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await act(async () => {
      fireEvent.click(retry);
      fireEvent.click(retry);
    });
    expect(mocks.refetch).toHaveBeenCalledTimes(1);

    await act(async () => finish([coupon('A')]));
    expect(await screen.findByRole('button', { name: 'Lưu mã' })).toBeInTheDocument();
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

describe('OffersCollect — kho mã mở tại chỗ (thay trang Mã giảm giá cũ)', () => {
  const HISTORY_FREE = { claimed: [], newCustomerOnly: [] };
  const expandAll = async () => {
    const region = await screen.findByRole('region', { name: 'Nhận mã' });
    fireEvent.click(within(region).getByRole('button', { name: /^Tất cả \(\d+\) Mã giảm giá$/ }));
    return region;
  };
  const ticketLabels = (region: HTMLElement) => within(region).getAllByRole('group').map((g) => g.textContent ?? '');

  beforeEach(() => {
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    mine = HISTORY_FREE;
  });

  it('mở: vẽ MỌI mã của kho kể cả mã đã lưu (Dùng ngay), đã dùng hết lượt cá nhân (Đã dùng), hết lượt, kèm câu "Mỗi đơn dùng 1 mã" và hàng chip; focus vào chip Tất cả', async () => {
    mocks.phase = 'authenticated';
    collectable = [coupon('OPEN'), coupon('SAVED'), coupon('SPENT', { usageLimit: 100, claimedCount: 3 }), coupon('FULL', { usageLimit: 3, claimedCount: 3 })];
    mine = { claimed: ['SAVED', 'SPENT'], newCustomerOnly: [] };
    renderCollect(['SAVED']);
    const region = await expandAll();
    expect(within(region).getAllByRole('group')).toHaveLength(4);
    expect(within(region).getByText('Mỗi đơn dùng 1 mã')).toBeInTheDocument();
    expect(within(region).getAllByRole('button', { name: 'Lưu mã' })).toHaveLength(1);
    expect(within(region).getByText('Đã dùng')).toBeInTheDocument();
    expect(within(region).getByText('Đã hết lượt')).toBeInTheDocument();
    fireEvent.click(within(region).getByRole('button', { name: 'Dùng ngay' }));
    expect(mocks.apply).toHaveBeenCalledWith('SAVED');
    expect(mocks.claim).not.toHaveBeenCalled();
    // Nút "Tất cả" vừa biến mất: focus không rơi về đầu trang.
    await waitFor(() => expect(within(region).getByRole('button', { name: 'Tất cả' })).toHaveFocus());
    expect(within(region).queryByRole('button', { name: /Tất cả \(\d+\)/ })).toBeNull();
  });

  it('mã chỉ dành khách mới mà khách đã có đơn: ghi lý do; đã nhận mà không còn áp dụng (claimedIneligible): ghi "không còn áp dụng", không ghi Đã dùng, không nút', async () => {
    mocks.phase = 'authenticated';
    collectable = [coupon('OPEN'), coupon('NEWONLY', { newCustomerOnly: true }), coupon('LAPSED', { newCustomerOnly: true })];
    mine = { claimed: ['LAPSED'], newCustomerOnly: ['NEWONLY'], claimedIneligible: ['LAPSED'] };
    renderCollect();
    const region = await expandAll();
    expect(within(region).getByText('Chỉ dành cho khách đặt đơn đầu tiên')).toBeInTheDocument();
    expect(within(region).getByText('Chỉ dành cho khách đặt đơn đầu tiên, nên không còn áp dụng')).toBeInTheDocument();
    expect(within(region).queryByText('Đã dùng')).toBeNull();
    expect(within(region).getAllByRole('button', { name: 'Lưu mã' })).toHaveLength(1);
    expect(within(region).queryByRole('button', { name: 'Dùng ngay' })).toBeNull();
  });

  it('chip Miễn phí giao hàng chỉ giữ mã freeship (aria-pressed đổi), không có chip Của shop; chip Giảm giá quay lại', async () => {
    collectable = [coupon('NEW10'), coupon('SHIP', { type: 'FREESHIP', value: 0 })];
    renderCollect();
    const region = await expandAll();
    expect(within(region).queryByRole('button', { name: 'Của shop' })).toBeNull();
    const chip = within(region).getByRole('button', { name: 'Miễn phí giao hàng' });
    expect(chip).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(chip);
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    expect(within(region).getAllByRole('group').map((g) => g.getAttribute('aria-label'))).toEqual(['Miễn phí giao hàng']);
    fireEvent.click(within(region).getByRole('button', { name: 'Giảm giá' }));
    expect(within(region).getByText('Giảm 30k')).toBeInTheDocument();
  });

  it('bộ lọc không còn mã nào: "Không có mã nào ở mục này"; nút "Xem tất cả mã" đặt lại về Tất cả, hiện lại phiếu và trả focus về chip Tất cả', async () => {
    collectable = [coupon('NEW10')];
    renderCollect();
    const region = await expandAll();
    fireEvent.click(within(region).getByRole('button', { name: 'Miễn phí giao hàng' }));
    expect(within(region).getByText('Không có mã nào ở mục này')).toBeInTheDocument();
    fireEvent.click(within(region).getByRole('button', { name: 'Xem tất cả mã' }));
    expect(within(region).getByText('Giảm 30k')).toBeInTheDocument();
    expect(within(region).getByRole('button', { name: 'Tất cả' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(region).queryByRole('button', { name: 'Xem tất cả mã' })).toBeNull();
    await waitFor(() => expect(within(region).getByRole('button', { name: 'Tất cả' })).toHaveFocus());
  });

  it('Sắp hết hạn: mã đã dùng hết lượt cá nhân dù hạn còn trong 3 ngày không lọt vào chip; mã còn nhận được thì có', async () => {
    mocks.phase = 'authenticated';
    collectable = [coupon('OPEN', { title: 'Mã còn nhận', endAt: new Date(Date.now() + DAY).toISOString() }), coupon('SPENT', { title: 'Mã đã dùng hết', endAt: new Date(Date.now() + DAY).toISOString() })];
    mine = { claimed: ['SPENT'], newCustomerOnly: [] };
    renderCollect();
    const region = await expandAll();
    expect(within(region).getByText('Mã đã dùng hết')).toBeInTheDocument();
    fireEvent.click(within(region).getByRole('button', { name: 'Sắp hết hạn' }));
    expect(within(region).getByText('Mã còn nhận')).toBeInTheDocument();
    expect(within(region).queryByText('Mã đã dùng hết')).toBeNull();
  });

  it('ví tải lỗi: mã đã nhận không bị ghi Đã dùng, không có Dùng ngay; dải "Chưa tải được mã bạn đã lưu" có Thử lại tải lại ví', async () => {
    mocks.phase = 'authenticated';
    collectable = [coupon('NEW10'), coupon('OPEN')];
    mine = { claimed: ['NEW10'], newCustomerOnly: [] };
    const wallet = walletOf([], { data: undefined, isError: true, error: { isHttpError: true, response: { status: 500, data: { message: 'x' } } } });
    renderCollect([], false, true, wallet);
    const region = await screen.findByRole('region', { name: 'Nhận mã' });
    expect(within(region).getByText('Chưa tải được mã bạn đã lưu')).toBeInTheDocument();
    expect(within(region).queryByText('Đã dùng')).toBeNull();
    expect(within(region).queryByRole('button', { name: 'Dùng ngay' })).toBeNull();
    expect(within(region).getAllByRole('button', { name: 'Lưu mã' })).toHaveLength(1);
    fireEvent.click(within(region).getByRole('button', { name: 'Thử lại' }));
    expect(wallet.refetch).toHaveBeenCalledTimes(1);
  });

  it('"Thu gọn" (aria-expanded, trỏ vào danh sách) về 3 mã còn nhận được, đặt lại bộ lọc, trả focus về "Tất cả (n)"', async () => {
    collectable = ['A', 'B', 'C', 'D', 'E'].map((c) => coupon(c));
    renderCollect();
    const region = await expandAll();
    fireEvent.click(within(region).getByRole('button', { name: 'Miễn phí giao hàng' }));
    const collapse = within(region).getByRole('button', { name: 'Thu gọn' });
    expect(collapse).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById(collapse.getAttribute('aria-controls')!)).not.toBeNull();
    fireEvent.click(collapse);
    expect(within(region).getAllByRole('group')).toHaveLength(3);
    expect(within(region).queryByRole('button', { name: 'Thu gọn' })).toBeNull();
    const all = within(region).getByRole('button', { name: 'Tất cả (5) Mã giảm giá' });
    await waitFor(() => expect(all).toHaveFocus());
    fireEvent.click(all);
    expect(within(region).getByRole('button', { name: 'Tất cả' })).toHaveAttribute('aria-pressed', 'true');
    expect(ticketLabels(region)).toHaveLength(5);
  });

  it('mở sẵn từ link (?codes=all): lúc tải giữ chỗ 3 thẻ kể cả chưa có gợi ý; vào chỗ thì cuộn tới khối đúng một lần', async () => {
    let release: (v: unknown) => void = () => undefined;
    mocks.coreGet.mockImplementation(async (path: string) => (path === MINE_PATH ? mine : new Promise((r) => (release = r))));
    renderCollect([], false, true);
    const frame = screen.getByTestId('offers-collect-loading');
    expect(frame.lastElementChild).toHaveStyle({ height: `${3 * 88 + 2 * 12}px` });
    expect(window.HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();
    await act(async () => release([coupon('A'), coupon('B')]));
    const region = await screen.findByRole('region', { name: 'Nhận mã' });
    expect(within(region).getAllByRole('group')).toHaveLength(2);
    expect(within(region).getByRole('button', { name: 'Thu gọn' })).toBeInTheDocument();
    await waitFor(() => expect(window.HTMLElement.prototype.scrollIntoView).toHaveBeenCalledTimes(1));
    fireEvent.click(within(region).getByRole('button', { name: 'Miễn phí giao hàng' }));
    expect(window.HTMLElement.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('mở sẵn mà kho trống: khối vẫn hiện chữ "Hôm nay chưa có mã mới", không chip, không "Thu gọn"', async () => {
    collectable = [];
    renderCollect([], false, true);
    const region = await screen.findByRole('region', { name: 'Nhận mã' });
    expect(within(region).getByText('Hôm nay chưa có mã mới')).toBeInTheDocument();
    expect(within(region).queryByRole('button')).toBeNull();
  });

  it('mở sẵn mà kho lỗi: khối lỗi tại chỗ có Thử lại', async () => {
    collectable = { isHttpError: true, response: { status: 500, data: { message: 'x' } } };
    renderCollect([], false, true);
    expect(await screen.findByRole('button', { name: 'Thử lại' })).toBeInTheDocument();
    expect(screen.getByText('Chưa tải được mã giảm giá')).toBeInTheDocument();
  });

  it('gập (không có ?codes=all) thì không cuộn trang', async () => {
    collectable = [coupon('A')];
    renderCollect();
    await screen.findByRole('region', { name: 'Nhận mã' });
    expect(window.HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();
  });
});
