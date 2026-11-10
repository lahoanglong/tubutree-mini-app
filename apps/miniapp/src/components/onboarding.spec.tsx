import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type * as ZmpUi from 'zmp-ui';
import { HttpError } from '../services/http';
import { LOCK_REFRESH_WAIT_MS } from '../utils/settle-within';
import { hasPartnerLinkParams, ONBOARDING_SNOOZE_KEY, ONBOARDING_SNOOZE_MS, shouldShowOnboarding } from './onboarding-rules';

const mocks = vi.hoisted(() => ({
  location: { pathname: '/', search: '' },
  storage: {} as Record<string, string>,
  setStorage: vi.fn(),
  getMe: vi.fn(),
  complete: vi.fn(),
  openSnackbar: vi.fn(),
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<typeof ZmpUi>()),
  useLocation: () => mocks.location,
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('zmp-sdk/apis', () => ({
  getStorage: async () => mocks.storage,
  setStorage: async (arg: { data: Record<string, string> }) => {
    mocks.setStorage(arg);
    return {};
  },
}));
vi.mock('../services/account-api', () => ({ getMe: mocks.getMe, completeOnboarding: mocks.complete }));
vi.mock('../store/auth', () => ({ useAuthStore: () => ({ status: 'authenticated' }) }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

import { OnboardingGate } from './onboarding';

const base = { onboarded: false, pathname: '/', search: '', openedFromPartnerLink: false, snoozedUntil: null, now: 1_000 };

describe('Luật hiện quiz onboarding (C-018)', () => {
  it('chỉ hiện ở Trang chủ cho khách chưa làm quiz', () => {
    expect(shouldShowOnboarding(base)).toBe(true);
    expect(shouldShowOnboarding({ ...base, onboarded: true })).toBe(false);
  });

  it.each(['/product/nuoc-rua-chen', '/checkout', '/s/shop-lan', '/brand/tubu', '/cart'])('không phủ route %s', (pathname) => {
    expect(shouldShowOnboarding({ ...base, pathname })).toBe(false);
  });

  it('không hiện khi vào từ link CTV/gian hàng (?ref=, ?s=), kể cả lúc mở app', () => {
    expect(shouldShowOnboarding({ ...base, search: '?ref=CTV01' })).toBe(false);
    expect(shouldShowOnboarding({ ...base, search: '?s=shop-lan' })).toBe(false);
    expect(shouldShowOnboarding({ ...base, openedFromPartnerLink: true })).toBe(false);
    expect(hasPartnerLinkParams('', '#/product/a?ref=X')).toBe(true);
    expect(hasPartnerLinkParams('?utm=1', '#/')).toBe(false);
  });

  it('"Để sau" còn hạn thì không hiện, hết hạn thì hiện lại', () => {
    expect(shouldShowOnboarding({ ...base, snoozedUntil: 2_000 })).toBe(false);
    expect(shouldShowOnboarding({ ...base, snoozedUntil: 500 })).toBe(true);
  });
});

function renderGate(openedFromPartnerLink?: boolean) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><OnboardingGate enabled openedFromPartnerLink={openedFromPartnerLink} /></QueryClientProvider>);
}

describe('OnboardingGate — khảo sát đang tắt', () => {
  it('mặc định không vẽ gì, không gọi API (không phủ màn chào lúc mở app)', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(<QueryClientProvider client={qc}><OnboardingGate /></QueryClientProvider>);
    expect(container).toBeEmptyDOMElement();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});

describe('OnboardingGate (C-018)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.location = { pathname: '/', search: '' };
    mocks.storage = {};
    mocks.getMe.mockResolvedValue({ onboarded: false });
  });

  it('ở Trang chủ: hiện quiz, không hứa quà chào mừng hay gợi ý sản phẩm', async () => {
    renderGate();
    expect(await screen.findByText('Chào mừng đến Tubu Tree!')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/quà chào mừng|gợi ý sản phẩm/);
  });

  it('mở app bằng link CTV (cờ do entry truyền vào), về Trang chủ vẫn không phủ quiz', async () => {
    renderGate(true);
    await waitFor(() => expect(mocks.getMe).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText('Chào mừng đến Tubu Tree!')).toBeNull();
  });

  it('mở link sản phẩm: không phủ quiz', async () => {
    mocks.location = { pathname: '/product/abc', search: '' };
    renderGate();
    await waitFor(() => expect(mocks.getMe).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText('Chào mừng đến Tubu Tree!')).toBeNull();
  });

  it('bấm "Để sau" (nút thật) → nhớ 7 ngày trên máy', async () => {
    const before = Date.now();
    renderGate();
    fireEvent.click(await screen.findByRole('button', { name: 'Để sau' }));
    expect(screen.queryByText('Chào mừng đến Tubu Tree!')).toBeNull();
    await waitFor(() => expect(mocks.setStorage).toHaveBeenCalled());
    const saved = Number(mocks.setStorage.mock.calls[0]?.[0].data[ONBOARDING_SNOOZE_KEY]);
    expect(saved).toBeGreaterThanOrEqual(before + ONBOARDING_SNOOZE_MS);
  });

  it('đã bấm "Để sau" trong 7 ngày → lần mở sau không hiện', async () => {
    mocks.storage = { [ONBOARDING_SNOOZE_KEY]: String(Date.now() + 60_000) };
    renderGate();
    await waitFor(() => expect(mocks.getMe).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText('Chào mừng đến Tubu Tree!')).toBeNull();
  });
});

describe('OnboardingGate — các bước quiz (C-076 di cư DS v2: giữ nguyên hành vi)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.location = { pathname: '/', search: '' };
    mocks.storage = {};
    mocks.getMe.mockResolvedValue({ onboarded: false });
    mocks.complete.mockResolvedValue({});
  });

  const next = () => fireEvent.click(screen.getByRole('button', { name: /^(Tiếp tục|Hoàn tất)$/ }));

  it('là hộp thoại có tên, mỗi bước đúng một tiêu đề và không còn emoji làm icon', async () => {
    renderGate();
    expect(await screen.findByRole('dialog', { name: 'Chào mừng đến Tubu Tree' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu' }));
    expect(screen.getByRole('heading', { name: 'Bạn quan tâm điều gì nhất?' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading')).toHaveLength(1);
    expect(screen.getAllByRole('checkbox')).toHaveLength(5);
    expect(document.body.textContent).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it('"Tiếp tục" chỉ bấm được khi đã chọn; câu nhiều đáp án bật/tắt từng ý, câu một đáp án thay ý cũ', async () => {
    renderGate();
    fireEvent.click(await screen.findByRole('button', { name: 'Bắt đầu' }));
    expect(screen.getByRole('button', { name: 'Tiếp tục' })).toBeDisabled();
    const eco = screen.getByRole('checkbox', { name: 'Sống xanh, tái chế' });
    fireEvent.click(eco);
    expect(eco).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('button', { name: 'Tiếp tục' })).toBeEnabled();
    fireEvent.click(eco);
    expect(eco).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('button', { name: 'Tiếp tục' })).toBeDisabled();
    fireEvent.click(eco);
    next();
    expect(screen.getByRole('heading', { name: 'Làn da của bạn thế nào?' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Dầu' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Khô' }));
    expect(screen.getByRole('radio', { name: 'Dầu' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('radio', { name: 'Khô' })).toHaveAttribute('aria-checked', 'true');
  });

  it('"Quay lại" về câu trước và giữ đáp án; hoàn tất gửi đúng danh sách đáp án rồi hiện lời cảm ơn', async () => {
    renderGate();
    fireEvent.click(await screen.findByRole('button', { name: 'Bắt đầu' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chăm sóc da' }));
    next();
    fireEvent.click(screen.getByRole('radio', { name: 'Nhạy cảm' }));
    next();
    fireEvent.click(screen.getByRole('button', { name: 'Quay lại' }));
    expect(screen.getByRole('radio', { name: 'Nhạy cảm' })).toHaveAttribute('aria-checked', 'true');
    next();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Gia đình' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Em bé' }));
    next();
    fireEvent.click(screen.getByRole('radio', { name: 'Giá tốt' }));
    expect(screen.getByRole('button', { name: 'Hoàn tất' })).toBeEnabled();
    next();
    await waitFor(() => expect(mocks.complete).toHaveBeenCalledWith(['skincare', 'sensitive_skin', 'family', 'baby', 'price']));
    expect(await screen.findByRole('heading', { name: 'Tuyệt vời!' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Khám phá ngay' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('OnboardingGate — "Hoàn tất" khoá đồng bộ chạm đúp (W108A)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.location = { pathname: '/', search: '' };
    mocks.storage = {};
    mocks.getMe.mockResolvedValue({ onboarded: false });
  });

  const next = () => fireEvent.click(screen.getByRole('button', { name: /^(Tiếp tục|Hoàn tất)$/ }));
  // Trả lời đủ bốn câu, dừng ở câu cuối với nút "Hoàn tất" chưa bấm.
  async function answerAll() {
    renderGate();
    fireEvent.click(await screen.findByRole('button', { name: 'Bắt đầu' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chăm sóc da' }));
    next();
    fireEvent.click(screen.getByRole('radio', { name: 'Nhạy cảm' }));
    next();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Gia đình' }));
    next();
    fireEvent.click(screen.getByRole('radio', { name: 'Giá tốt' }));
    return screen.getByRole('button', { name: 'Hoàn tất' });
  }

  it('chạm đúp "Hoàn tất" trong cùng một khung hình chỉ gửi một lần; xong hiện lời cảm ơn', async () => {
    let resolve!: (v: unknown) => void;
    mocks.complete.mockReturnValueOnce(new Promise((res) => { resolve = res; }));
    const done = await answerAll();
    await act(async () => {
      fireEvent.click(done);
      fireEvent.click(done);
    });
    expect(mocks.complete).toHaveBeenCalledTimes(1);
    await act(async () => resolve({}));
    expect(await screen.findByRole('heading', { name: 'Tuyệt vời!' })).toBeInTheDocument();
    expect(mocks.complete).toHaveBeenCalledTimes(1);
  });

  it('gửi lỗi thì nhả khoá: bấm lại gửi được và hiện lời cảm ơn', async () => {
    mocks.complete.mockRejectedValueOnce(new Error('mạng')).mockResolvedValue({});
    const done = await answerAll();
    await act(async () => {
      fireEvent.click(done);
      fireEvent.click(done);
    });
    expect(mocks.complete).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Hoàn tất' })).not.toHaveAttribute('aria-busy'));
    expect(screen.queryByRole('heading', { name: 'Tuyệt vời!' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Hoàn tất' }));
    await waitFor(() => expect(mocks.complete).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('heading', { name: 'Tuyệt vời!' })).toBeInTheDocument();
  });
});


// W113A: "Hoàn tất" bị máy chủ từ chối (400/404/409) thì tải lại ['me'] và giữ khoá tới khi dữ liệu về (tối đa LOCK_REFRESH_WAIT_MS); mất mạng, quá hạn, 401, 5xx nhả ngay, không tải lại.
describe('OnboardingGate — "Hoàn tất" bị từ chối thì giữ khoá tới khi hồ sơ làm mới về (W113A)', () => {
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
  const next = () => fireEvent.click(screen.getByRole('button', { name: /^(Tiếp tục|Hoàn tất)$/ }));
  const doneBtn = () => screen.getByRole('button', { name: 'Hoàn tất' });
  /** Dựng cổng onboarding với `invalidateQueries` giả (giữ lời hứa tải lại trong tay), trả lời đủ bốn câu và dừng ở nút "Hoàn tất". */
  async function answerAll(refresh: () => Promise<unknown>) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const invalidate = vi.spyOn(qc, 'invalidateQueries').mockImplementation((() => refresh()) as never);
    render(<QueryClientProvider client={qc}><OnboardingGate enabled /></QueryClientProvider>);
    fireEvent.click(await screen.findByRole('button', { name: 'Bắt đầu' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chăm sóc da' }));
    next();
    fireEvent.click(screen.getByRole('radio', { name: 'Nhạy cảm' }));
    next();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Gia đình' }));
    next();
    fireEvent.click(screen.getByRole('radio', { name: 'Giá tốt' }));
    return invalidate;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.complete.mockReset();
    mocks.location = { pathname: '/', search: '' };
    mocks.storage = {};
    mocks.getMe.mockResolvedValue({ onboarded: false });
  });

  it.each([
    [400, 'Bạn đã làm khảo sát rồi'],
    [404, 'Không tìm thấy hồ sơ'],
    [409, 'Hồ sơ vừa được cập nhật'],
  ])('bị từ chối %i: báo lỗi một lần, tải lại [me], khoá giữ tới khi dữ liệu về rồi mới nhả', async (status, message) => {
    mocks.complete.mockRejectedValueOnce(serverError(message, status)).mockResolvedValue({});
    const refresh = deferred();
    const invalidate = await answerAll(() => refresh.promise);
    fireEvent.click(doneBtn());
    await waitFor(() => expect(errorToasts(message)).toBe(1));
    expect(invalidate.mock.calls.map(([filter]) => filter)).toEqual([{ queryKey: ['me'] }]);
    expect(doneBtn()).toHaveAttribute('aria-busy', 'true');
    await act(async () => {
      fireEvent.click(doneBtn());
      fireEvent.click(doneBtn());
    });
    expect(mocks.complete).toHaveBeenCalledTimes(1);
    await act(async () => refresh.resolve());
    await settle();
    await waitFor(() => expect(doneBtn()).not.toHaveAttribute('aria-busy'));
    expect(errorToasts(message)).toBe(1);
    expect(screen.queryByRole('heading', { name: 'Tuyệt vời!' })).toBeNull();
    fireEvent.click(doneBtn());
    await waitFor(() => expect(mocks.complete).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('heading', { name: 'Tuyệt vời!' })).toBeInTheDocument();
  });

  it.each([
    ['mất mạng', new HttpError('Network Error', 'ERR_NETWORK')],
    ['hết thời gian', new HttpError('timeout', 'ECONNABORTED')],
    ['máy chủ lỗi 503', serverError('Service Unavailable', 503)],
    ['hết phiên 401', serverError('Unauthorized', 401)],
  ])('%s: báo lỗi, nhả khoá ngay, không tải lại [me]', async (_label, error) => {
    mocks.complete.mockRejectedValueOnce(error).mockResolvedValue({});
    const invalidate = await answerAll(() => new Promise(() => undefined));
    fireEvent.click(doneBtn());
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })));
    await waitFor(() => expect(doneBtn()).not.toHaveAttribute('aria-busy'));
    expect(invalidate).not.toHaveBeenCalled();
    fireEvent.click(doneBtn());
    await waitFor(() => expect(mocks.complete).toHaveBeenCalledTimes(2));
  });

  it('tải lại treo mãi: khoá nhả đúng sau LOCK_REFRESH_WAIT_MS', async () => {
    mocks.complete.mockRejectedValueOnce(serverError('Hồ sơ vừa được cập nhật', 409)).mockResolvedValue({});
    await answerAll(() => new Promise(() => undefined));
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      fireEvent.click(doneBtn());
      await waitFor(() => expect(errorToasts('Hồ sơ vừa được cập nhật')).toBe(1));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(LOCK_REFRESH_WAIT_MS - 500);
      });
      expect(doneBtn()).toHaveAttribute('aria-busy', 'true');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });
      await waitFor(() => expect(doneBtn()).not.toHaveAttribute('aria-busy'));
    } finally {
      vi.useRealTimers();
    }
    fireEvent.click(doneBtn());
    await waitFor(() => expect(mocks.complete).toHaveBeenCalledTimes(2));
  });
});
