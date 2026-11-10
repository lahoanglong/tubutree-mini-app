import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpError } from '../services/http';
import { LOCK_REFRESH_WAIT_MS } from '../utils/settle-within';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  openSnackbar: vi.fn(),
  getMerchants: vi.fn(),
  createCashbackClick: vi.fn(),
  getCashbackTransactions: vi.fn(),
  getWallet: vi.fn(),
  openAffiliateLink: vi.fn(),
}));

vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  useNavigate: () => mocks.navigate,
  useLocation: () => ({ pathname: '/cashback', search: '', state: null }),
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../services/cashback-api', () => ({
  getMerchants: mocks.getMerchants,
  createCashbackClick: mocks.createCashbackClick,
  getCashbackTransactions: mocks.getCashbackTransactions,
}));
vi.mock('../services/account-api', () => ({ getWallet: mocks.getWallet }));
vi.mock('../services/zmp-bridge', () => ({ openAffiliateLink: mocks.openAffiliateLink }));
vi.mock('../hooks/use-public-config', () => ({ usePublicConfig: () => ({ cashbackHoldDays: 45 }) }));
vi.mock('../store/auth', () => {
  const state = { status: 'authenticated' };
  return { useAuthStore: (sel?: (s: typeof state) => unknown) => (sel ? sel(state) : state) };
});
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

import CashbackPage from './cashback';

const MERCHANTS = [
  { id: 'm1', slug: 'shopee', name: 'Shopee', logoUrl: '', category: 'mall', baseRate: '0.05', terms: 'Không áp dụng đơn hoàn huỷ.' },
  { id: 'm2', slug: 'lazada', name: 'Lazada', logoUrl: '', category: 'mall', baseRate: '0.035', terms: null },
];
const TXNS = [
  { id: 'c1', merchantOrderId: 'ABCDEFGHIJKLMN', orderAmount: 500_000, commission: 0, userReward: 25_000, status: 'PENDING', confirmedAt: null, paidAt: null },
  { id: 'c2', merchantOrderId: '', orderAmount: 200_000, commission: 0, userReward: 7_000, status: 'CONFIRMED', confirmedAt: null, paidAt: null },
  { id: 'c3', merchantOrderId: 'X1', orderAmount: 100_000, commission: 0, userReward: 5_000, status: 'PAID', confirmedAt: null, paidAt: null },
  { id: 'c4', merchantOrderId: 'X2', orderAmount: 100_000, commission: 0, userReward: 0, status: 'REJECTED', confirmedAt: null, paidAt: null },
];

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CashbackPage />
    </QueryClientProvider>,
  );
}

function stubLoaded() {
  mocks.getMerchants.mockResolvedValue(MERCHANTS);
  mocks.getCashbackTransactions.mockResolvedValue(TXNS);
  mocks.getWallet.mockResolvedValue({ cashbackPending: 123_000 });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CashbackPage — hiển thị (hành vi giữ nguyên khi chuyển DS v2)', () => {
  it('có đúng một h1 ở trạng thái đang tải và đã tải (C-114)', async () => {
    mocks.getMerchants.mockReturnValue(new Promise(() => {}));
    mocks.getCashbackTransactions.mockReturnValue(new Promise(() => {}));
    mocks.getWallet.mockReturnValue(new Promise(() => {}));
    const loading = renderPage();
    expect(loading.container.querySelectorAll('h1')).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Hoàn tiền');
    loading.unmount();

    vi.clearAllMocks();
    stubLoaded();
    const loaded = renderPage();
    await screen.findByText('Shopee');
    expect(loaded.container.querySelectorAll('h1')).toHaveLength(1);
  });

  it('hiện khoản đã duyệt chờ về Ví, lưới sàn kèm tỉ lệ và danh sách giao dịch đúng số liệu', async () => {
    stubLoaded();
    renderPage();
    expect(await screen.findByText('Đã duyệt, chờ về Ví')).toBeInTheDocument();
    expect(await screen.findByText('123.000đ')).toBeInTheDocument();
    expect(await screen.findByText('Shopee')).toBeInTheDocument();
    expect(screen.getByText(/(^|\s)5%$/)).toBeInTheDocument();
    expect(screen.getByText(/3,5%$/)).toBeInTheDocument();
    expect(screen.getByText('+25.000đ')).toBeInTheDocument();
    expect(screen.getByText('Đơn 500.000đ · #ABCDEFGHIJ')).toBeInTheDocument();
    expect(screen.getByText('Đơn 200.000đ')).toBeInTheDocument();
    for (const label of ['Chờ duyệt', 'Đã duyệt', 'Đã hoàn vào Ví', 'Từ chối']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('lỗi tải ví KHÔNG hiện 0đ mà báo lỗi kèm Thử lại', async () => {
    stubLoaded();
    mocks.getWallet.mockRejectedValueOnce(new Error('x')).mockResolvedValue({ cashbackPending: 123_000 });
    renderPage();
    const retry = await screen.findByRole('button', { name: 'Thử lại' });
    expect(screen.queryByText('Đã duyệt, chờ về Ví')).toBeNull();
    fireEvent.click(retry);
    expect(await screen.findByText('123.000đ')).toBeInTheDocument();
  });

  it('chưa có sàn / chưa có giao dịch → báo trống đúng câu chữ; lỗi tải sàn khác với trống', async () => {
    mocks.getMerchants.mockResolvedValue([]);
    mocks.getCashbackTransactions.mockResolvedValue([]);
    mocks.getWallet.mockResolvedValue({ cashbackPending: 0 });
    renderPage();
    expect(await screen.findByText('Chưa có sàn đối tác nào.')).toBeInTheDocument();
    expect(screen.getByText('Chưa có giao dịch hoàn tiền. Bắt đầu mua sắm qua các sàn ở trên.')).toBeInTheDocument();
  });

  it('lỗi tải sàn → ErrorState + Thử lại gọi lại getMerchants, không hiện "Chưa có sàn"', async () => {
    mocks.getMerchants.mockRejectedValueOnce(new Error('x')).mockResolvedValue(MERCHANTS);
    mocks.getCashbackTransactions.mockResolvedValue([]);
    mocks.getWallet.mockResolvedValue({ cashbackPending: 0 });
    renderPage();
    const retry = await screen.findByRole('button', { name: 'Thử lại' });
    expect(screen.queryByText('Chưa có sàn đối tác nào.')).toBeNull();
    fireEvent.click(retry);
    expect(await screen.findByText('Shopee')).toBeInTheDocument();
    expect(mocks.getMerchants).toHaveBeenCalledTimes(2);
  });
});

describe('CashbackPage — chọn sàn và nhận hoàn tiền', () => {
  it('bấm sàn → mở chi tiết (số ngày giữ lấy từ cấu hình, điều khoản, lưu ý) rồi tạo click và mở link', async () => {
    stubLoaded();
    mocks.createCashbackClick.mockResolvedValue({ deeplink: 'https://aff.example/abc' });
    renderPage();
    fireEvent.click(await screen.findByText('Shopee'));
    expect(await screen.findByText('Hoàn đến 5% giá trị đơn')).toBeInTheDocument();
    expect(screen.getByText('Cách nhận hoàn tiền')).toBeInTheDocument();
    expect(screen.getByText('Sàn xác nhận đơn → hoàn tiền vào Ví Tubu (sau 45 ngày)')).toBeInTheDocument();
    expect(screen.getByText('Không áp dụng đơn hoàn huỷ.')).toBeInTheDocument();
    expect(screen.getByText(/phải bấm từ đây mỗi lần mua/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Mua sắm & nhận hoàn tiền' }));
    await waitFor(() => expect(mocks.createCashbackClick).toHaveBeenCalledWith('m1'));
    await waitFor(() => expect(mocks.openAffiliateLink).toHaveBeenCalledWith('https://aff.example/abc'));
    expect(mocks.openSnackbar).toHaveBeenCalledWith({
      text: 'Đã ghi nhận hoàn tiền! Đang chuyển hướng sang sàn…',
      type: 'success',
    });
  });

  it('tạo click lỗi → snackbar lỗi, KHÔNG mở link', async () => {
    stubLoaded();
    mocks.createCashbackClick.mockRejectedValue(new Error('x'));
    renderPage();
    fireEvent.click(await screen.findByText('Lazada'));
    fireEvent.click(await screen.findByRole('button', { name: 'Mua sắm & nhận hoàn tiền' }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })));
    expect(mocks.openAffiliateLink).not.toHaveBeenCalled();
  });
});

describe('CashbackPage — vùng chạm, bàn phím và biểu tượng (C-076, C-113)', () => {
  it('thẻ sàn là nút (role=button) bấm được bằng bàn phím và mở chi tiết', async () => {
    stubLoaded();
    renderPage();
    const tile = (await screen.findByText('Shopee')).closest('[role="button"]') as HTMLElement | null;
    expect(tile).not.toBeNull();
    expect(within(tile!).getByText(/(^|\s)5%$/)).toBeInTheDocument();
    fireEvent.keyDown(tile!, { key: 'Enter' });
    expect(await screen.findByText('Hoàn đến 5% giá trị đơn')).toBeInTheDocument();
  });

  it('nút "Mua sắm & nhận hoàn tiền" cao tối thiểu 44px', async () => {
    stubLoaded();
    renderPage();
    fireEvent.click(await screen.findByText('Shopee'));
    const btn = await screen.findByRole('button', { name: 'Mua sắm & nhận hoàn tiền' });
    expect(Number.parseFloat(btn.style.minHeight)).toBeGreaterThanOrEqual(44);
  });

  it('không dùng ký tự/emoji làm biểu tượng (⚠, ↩) trong chữ hiển thị', async () => {
    stubLoaded();
    renderPage();
    fireEvent.click(await screen.findByText('Shopee'));
    const note = await screen.findByText(/phải bấm từ đây mỗi lần mua/);
    expect(note.textContent).not.toMatch(/⚠/);
    expect(screen.getByText(/3,5%$/).textContent).not.toMatch(/↩/);
  });
});

describe('CashbackPage — "Mua sắm & nhận hoàn tiền" khoá chạm đúp (W76A)', () => {
  const deferred = () => {
    let resolve!: (v: unknown) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
  const openShopee = async () => {
    fireEvent.click(await screen.findByText('Shopee'));
    return screen.findByRole('button', { name: 'Mua sắm & nhận hoàn tiền' });
  };

  beforeEach(() => {
    stubLoaded();
  });

  it('chạm đúp trong cùng một khung hình chỉ tạo một click hoàn tiền và mở link một lần', async () => {
    const d = deferred();
    mocks.createCashbackClick.mockReturnValueOnce(d.promise);
    renderPage();
    const btn = await openShopee();
    await act(async () => {
      fireEvent.click(btn);
      fireEvent.click(btn);
    });
    expect(mocks.createCashbackClick).toHaveBeenCalledTimes(1);
    await act(async () => d.resolve({ deeplink: 'https://aff.example/abc' }));
    await waitFor(() => expect(mocks.openAffiliateLink).toHaveBeenCalledWith('https://aff.example/abc'));
    expect(mocks.createCashbackClick).toHaveBeenCalledTimes(1);
    expect(mocks.openAffiliateLink).toHaveBeenCalledTimes(1);
    expect(mocks.openSnackbar.mock.calls.filter(([a]) => (a as { type: string }).type === 'success')).toHaveLength(1);
  });

  it('đang tạo click: nút aria-busy mà không bị disabled (giữ focus)', async () => {
    const d = deferred();
    mocks.createCashbackClick.mockReturnValueOnce(d.promise);
    renderPage();
    const btn = await openShopee();
    btn.focus();
    fireEvent.click(btn);
    await waitFor(() => expect(btn).toHaveAttribute('aria-busy', 'true'));
    expect(btn).not.toBeDisabled();
    expect(btn).toHaveFocus();
    await act(async () => d.resolve({ deeplink: 'https://aff.example/abc' }));
  });

  it('tạo click lỗi thì nhả khoá, bấm lại gọi lần hai và mở link', async () => {
    mocks.createCashbackClick.mockRejectedValueOnce(new Error('x')).mockResolvedValue({ deeplink: 'https://aff.example/abc' });
    renderPage();
    const btn = await openShopee();
    fireEvent.click(btn);
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })));
    expect(mocks.openAffiliateLink).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Mua sắm & nhận hoàn tiền' }));
    await waitFor(() => expect(mocks.createCashbackClick).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mocks.openAffiliateLink).toHaveBeenCalledTimes(1));
  });
});

// W113A: tạo click bị máy chủ từ chối hẳn (400/404/409/422) thì đóng tấm sàn; riêng 400/404/409 còn tải lại danh sách sàn và giữ khoá tới khi dữ liệu về (tối đa LOCK_REFRESH_WAIT_MS). Mất mạng, quá hạn, 401, 5xx: tấm còn mở, nhả khoá ngay, không tải lại.
describe('CashbackPage — Mua sắm bị từ chối: đóng tấm, tải lại sàn, giữ khoá (W113A)', () => {
  const serverError = (message: string, status: number) => new HttpError(message, undefined, { status, data: { message }, headers: {} });
  const deferred = () => {
    let resolve!: (v?: unknown) => void;
    const promise = new Promise((res) => {
      resolve = res;
    });
    return { promise, resolve };
  };
  const settle = () =>
    act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
  const errorToasts = (text: string) => mocks.openSnackbar.mock.calls.filter(([o]) => o.type === 'error' && o.text === text).length;
  const BUY = { name: 'Mua sắm & nhận hoàn tiền' };
  const renderLive = (refresh: () => Promise<unknown>) => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const invalidate = vi.spyOn(qc, 'invalidateQueries').mockImplementation((() => refresh()) as never);
    render(<QueryClientProvider client={qc}><CashbackPage /></QueryClientProvider>);
    return invalidate;
  };
  const openShopee = async () => {
    fireEvent.click(await screen.findByText('Shopee'));
    return screen.findByRole('button', BUY);
  };

  beforeEach(() => {
    stubLoaded();
    mocks.createCashbackClick.mockReset();
  });

  it.each([
    [400, 'Sàn tạm ngừng hoàn tiền'],
    [404, 'Không tìm thấy sàn'],
    [409, 'Sàn vừa đổi điều khoản'],
  ])('bị từ chối %i: đóng tấm, báo lỗi một lần, tải lại danh sách sàn, khoá giữ tới khi dữ liệu về', async (status, message) => {
    mocks.createCashbackClick.mockRejectedValueOnce(serverError(message, status)).mockResolvedValue({ deeplink: 'https://aff.example/abc' });
    const refresh = deferred();
    const invalidate = renderLive(() => refresh.promise);
    fireEvent.click(await openShopee());
    await waitFor(() => expect(errorToasts(message)).toBe(1));
    await waitFor(() => expect(screen.queryByRole('button', BUY)).toBeNull());
    expect(invalidate.mock.calls.map(([filter]) => filter)).toEqual([{ queryKey: ['cashback-merchants'] }]);
    // Mở lại tấm khi dữ liệu chưa về: nút vẫn bận, chạm thêm không gửi lần hai.
    const again = await openShopee();
    expect(again).toHaveAttribute('aria-busy', 'true');
    await act(async () => {
      fireEvent.click(again);
      fireEvent.click(again);
    });
    expect(mocks.createCashbackClick).toHaveBeenCalledTimes(1);
    await act(async () => refresh.resolve());
    await settle();
    await waitFor(() => expect(screen.getByRole('button', BUY)).not.toHaveAttribute('aria-busy'));
    expect(errorToasts(message)).toBe(1);
    fireEvent.click(screen.getByRole('button', BUY));
    await waitFor(() => expect(mocks.createCashbackClick).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mocks.openAffiliateLink).toHaveBeenCalledWith('https://aff.example/abc'));
  });

  it('bị từ chối 422: đóng tấm nhưng không tải lại danh sách, nhả khoá ngay', async () => {
    mocks.createCashbackClick.mockRejectedValueOnce(serverError('Dữ liệu không hợp lệ', 422)).mockResolvedValue({ deeplink: 'https://aff.example/abc' });
    const invalidate = renderLive(() => new Promise(() => undefined));
    fireEvent.click(await openShopee());
    await waitFor(() => expect(errorToasts('Dữ liệu không hợp lệ')).toBe(1));
    await waitFor(() => expect(screen.queryByRole('button', BUY)).toBeNull());
    expect(invalidate).not.toHaveBeenCalled();
    const again = await openShopee();
    expect(again).not.toHaveAttribute('aria-busy');
    fireEvent.click(again);
    await waitFor(() => expect(mocks.createCashbackClick).toHaveBeenCalledTimes(2));
  });

  it.each([
    ['mất mạng', new HttpError('Network Error', 'ERR_NETWORK')],
    ['hết thời gian', new HttpError('timeout', 'ECONNABORTED')],
    ['máy chủ lỗi 503', serverError('Service Unavailable', 503)],
    ['hết phiên 401', serverError('Unauthorized', 401)],
  ])('%s: tấm còn mở, nhả khoá ngay, không tải lại danh sách', async (_label, error) => {
    mocks.createCashbackClick.mockRejectedValueOnce(error).mockResolvedValue({ deeplink: 'https://aff.example/abc' });
    const invalidate = renderLive(() => new Promise(() => undefined));
    fireEvent.click(await openShopee());
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })));
    await waitFor(() => expect(screen.getByRole('button', BUY)).not.toHaveAttribute('aria-busy'));
    expect(invalidate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', BUY));
    await waitFor(() => expect(mocks.createCashbackClick).toHaveBeenCalledTimes(2));
  });

  it('tải lại treo mãi: khoá nhả đúng sau LOCK_REFRESH_WAIT_MS', async () => {
    mocks.createCashbackClick.mockRejectedValueOnce(serverError('Sàn vừa đổi điều khoản', 409)).mockResolvedValue({ deeplink: 'https://aff.example/abc' });
    renderLive(() => new Promise(() => undefined));
    const btn = await openShopee();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      fireEvent.click(btn);
      await waitFor(() => expect(errorToasts('Sàn vừa đổi điều khoản')).toBe(1));
      await waitFor(() => expect(screen.queryByRole('button', BUY)).toBeNull());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(LOCK_REFRESH_WAIT_MS - 500);
      });
      expect(await openShopee()).toHaveAttribute('aria-busy', 'true');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });
      await waitFor(() => expect(screen.getByRole('button', BUY)).not.toHaveAttribute('aria-busy'));
    } finally {
      vi.useRealTimers();
    }
    fireEvent.click(screen.getByRole('button', BUY));
    await waitFor(() => expect(mocks.createCashbackClick).toHaveBeenCalledTimes(2));
  });
});
