import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { vi as t } from '../i18n/vi';

const mocks = vi.hoisted(() => ({
  getDealerMe: vi.fn(),
  applyDealer: vi.fn(),
  openSnackbar: vi.fn(),
  // Ô ảnh giả ghi lại props lần vẽ gần nhất theo nhãn: test tự báo "đang tải"/"tải xong" như ô thật.
  pickers: {} as Record<string, { onChange: (url: string) => void; onBusyChange: (busy: boolean) => void; disabled: boolean }>,
}));

vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/dealer', search: '', state: null }),
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../services/dealer-api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getDealerMe: mocks.getDealerMe,
  applyDealer: mocks.applyDealer,
}));
vi.mock('../hooks/use-public-config', () => ({ usePublicConfig: () => ({ isLoaded: true, dealer: { maxDiscountPct: 0.45, reviewHours: 24 } }) }));
vi.mock('../components/image-upload', () => ({
  ImageUpload: ({ label, onChange, onBusyChange, disabled }: { label: string; onChange: (u: string) => void; onBusyChange?: (busy: boolean) => void; disabled?: boolean }) => {
    mocks.pickers[label] = { onChange, onBusyChange: onBusyChange ?? (() => undefined), disabled: Boolean(disabled) };
    return (
      <button type="button" disabled={disabled} onClick={() => onChange('data:image/jpeg;base64,AA')}>{label}</button>
    );
  },
}));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

import { HttpError } from '../services/http';
import { LOCK_REFRESH_WAIT_MS } from '../utils/settle-within';
import DealerPage from './dealer';

const NONE = { isDealer: false, status: null, tier: null, currentDebt: 0 };

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}><DealerPage /></QueryClientProvider>);
}

async function fillForm() {
  await screen.findByText('Gửi hồ sơ đăng ký');
  const boxes = screen.getAllByRole('textbox');
  boxes.forEach((b, i) => fireEvent.change(b, { target: { value: i === 1 ? '' : `giá trị ${i}` } }));
  fireEvent.click(screen.getByText('Ảnh CCCD mặt trước *'));
  fireEvent.click(screen.getByText('Ảnh CCCD mặt sau *'));
  return screen.getByRole('button', { name: 'Gửi hồ sơ đăng ký' });
}

async function fillAndSubmit() {
  fireEvent.click(await fillForm());
}

describe('DealerPage gửi lại hồ sơ sau khi mất phản hồi', () => {
  beforeEach(() => vi.clearAllMocks());

  it('API trả DEALER_APPLICATION_PENDING: làm mới dealer-me và sang màn chờ duyệt', async () => {
    mocks.getDealerMe.mockResolvedValueOnce(NONE).mockResolvedValue({ ...NONE, status: 'PENDING' });
    mocks.applyDealer.mockRejectedValue(
      new HttpError('x', 'ERR_BAD_REQUEST', {
        status: 400,
        data: { code: 'DEALER_APPLICATION_PENDING', message: 'Bạn đã có đơn đăng ký đang chờ duyệt.' },
        headers: {},
      }),
    );
    renderPage();
    await fillAndSubmit();
    await waitFor(() => expect(mocks.applyDealer).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Hồ sơ đang được duyệt')).toBeInTheDocument();
    expect(mocks.getDealerMe).toHaveBeenCalledTimes(2);
    // Hồ sơ đã được nhận: báo bằng thông tin, không phải lỗi.
    expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Bạn đã có đơn đăng ký đang chờ duyệt.', type: 'info' });
    expect(mocks.openSnackbar).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
  });
});

// W76A: hai cú chạm trong CÙNG một khung hình (trước khi React vẽ lại `isPending`) từng gửi hai hồ sơ.
describe('DealerPage gửi hồ sơ đăng ký khoá chạm đúp trong cùng một khung hình (W76A)', () => {
  const deferred = () => {
    let resolve!: (v: unknown) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
  const SENT = 'Đã gửi hồ sơ đăng ký đại lý!';
  const count = (text: string) => mocks.openSnackbar.mock.calls.filter((c) => c[0].text === text).length;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.applyDealer.mockReset();
    mocks.getDealerMe.mockReset();
    mocks.getDealerMe.mockResolvedValue(NONE);
  });

  it('chạm đúp "Gửi hồ sơ đăng ký" chỉ gửi một hồ sơ; đang gửi nút aria-busy, không disabled', async () => {
    const d = deferred();
    mocks.applyDealer.mockReturnValueOnce(d.promise);
    renderPage();
    const submit = await fillForm();
    await act(async () => {
      fireEvent.click(submit);
      fireEvent.click(submit);
    });
    expect(mocks.applyDealer).toHaveBeenCalledTimes(1);
    expect(mocks.applyDealer.mock.calls[0]![0]).toMatchObject({ businessName: 'giá trị 0', cccdFrontUrl: 'data:image/jpeg;base64,AA' });
    await waitFor(() => expect(submit).toHaveAttribute('aria-busy', 'true'));
    expect(submit).not.toBeDisabled();
    await act(async () => d.resolve({ ok: true }));
    await waitFor(() => expect(count(SENT)).toBe(1));
    expect(mocks.applyDealer).toHaveBeenCalledTimes(1);
  });

  it('lỗi thì nhả khoá, bấm lại gửi lần hai', async () => {
    mocks.applyDealer.mockRejectedValueOnce(new Error('Máy chủ bận')).mockResolvedValue({ ok: true });
    renderPage();
    const submit = await fillForm();
    await act(async () => {
      fireEvent.click(submit);
      fireEvent.click(submit);
    });
    expect(mocks.applyDealer).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })));
    await waitFor(() => expect(submit).not.toHaveAttribute('aria-busy'));
    fireEvent.click(submit);
    await waitFor(() => expect(mocks.applyDealer).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(count(SENT)).toBe(1));
  });
});

describe('DealerPage: ảnh CCCD còn đang lên thì "Gửi hồ sơ đăng ký" chờ (W90A)', () => {
  const FRONT = 'Ảnh CCCD mặt trước *';
  const BACK = 'Ảnh CCCD mặt sau *';

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.applyDealer.mockReset().mockResolvedValue({ ok: true });
    mocks.getDealerMe.mockReset().mockResolvedValue(NONE);
  });

  it('chọn lại cả hai ảnh: còn một ô đang tải là nút vẫn khoá, bấm không gửi hồ sơ; cả hai xong mới gửi, kèm ảnh MỚI', async () => {
    renderPage();
    await fillForm();
    act(() => mocks.pickers[FRONT]!.onBusyChange(true));
    act(() => mocks.pickers[BACK]!.onBusyChange(true));
    const waiting = screen.getByRole('button', { name: t.common.imagesUploading });
    expect(waiting).toBeDisabled();
    fireEvent.click(waiting);
    await new Promise((r) => setTimeout(r, 30));
    expect(mocks.applyDealer).not.toHaveBeenCalled();

    act(() => {
      mocks.pickers[FRONT]!.onChange('data:image/jpeg;base64,MOI');
      mocks.pickers[FRONT]!.onBusyChange(false);
    });
    expect(screen.getByRole('button', { name: t.common.imagesUploading })).toBeDisabled();

    act(() => mocks.pickers[BACK]!.onBusyChange(false));
    const submit = await screen.findByRole('button', { name: 'Gửi hồ sơ đăng ký' });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    await waitFor(() => expect(mocks.applyDealer).toHaveBeenCalledTimes(1));
    expect(mocks.applyDealer.mock.calls[0]![0]).toMatchObject({ cccdFrontUrl: 'data:image/jpeg;base64,MOI', cccdBackUrl: 'data:image/jpeg;base64,AA' });
  });

  it('đang gửi hồ sơ thì cả hai ô ảnh khoá', async () => {
    let release!: (v: unknown) => void;
    mocks.applyDealer.mockReturnValueOnce(new Promise((r) => (release = r)));
    renderPage();
    const submit = await fillForm();
    expect(screen.getByRole('button', { name: FRONT })).toBeEnabled();
    fireEvent.click(submit);
    await waitFor(() => expect(mocks.applyDealer).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('button', { name: FRONT })).toBeDisabled());
    expect(screen.getByRole('button', { name: BACK })).toBeDisabled();
    await act(async () => release({ ok: true }));
    await waitFor(() => expect(screen.getByRole('button', { name: FRONT })).toBeEnabled());
  });
});

// W103A: mutation chỉ xong khi onSuccess/onError trả Promise xong; không trả thì nút sáng lại trong lúc dealer-me còn đang tải, form vẫn hiện và bấm lại gửi hồ sơ thứ hai.
describe('DealerPage: Gửi hồ sơ giữ khoá tới khi trạng thái hồ sơ làm mới về (W103A)', () => {
  const deferred = <T,>() => {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((res) => {
      resolve = res;
    });
    return { promise, resolve };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.applyDealer.mockReset();
    mocks.getDealerMe.mockReset();
  });

  it('gửi thành công: dealer-me chưa về thì nút còn aria-busy và ô ảnh còn khoá, chạm lại không gửi hồ sơ thứ hai; về PENDING thì sang màn chờ duyệt', async () => {
    const refetch = deferred<unknown>();
    mocks.getDealerMe.mockResolvedValueOnce(NONE).mockReturnValueOnce(refetch.promise);
    mocks.applyDealer.mockResolvedValue({ ok: true });
    renderPage();
    const submit = await fillForm();
    fireEvent.click(submit);
    await waitFor(() => expect(mocks.getDealerMe).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã gửi hồ sơ đăng ký đại lý!', type: 'success' }));
    expect(submit).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('button', { name: 'Ảnh CCCD mặt trước *' })).toBeDisabled();
    fireEvent.click(submit);
    await new Promise((r) => setTimeout(r, 30));
    expect(mocks.applyDealer).toHaveBeenCalledTimes(1);

    await act(async () => refetch.resolve({ ...NONE, status: 'PENDING' }));
    expect(await screen.findByText('Hồ sơ đang được duyệt')).toBeInTheDocument();
    expect(mocks.applyDealer).toHaveBeenCalledTimes(1);
  });

  it('API báo đã có hồ sơ chờ duyệt (DEALER_APPLICATION_PENDING): nút giữ khoá tới khi dealer-me về, báo bằng thông tin chứ không phải lỗi', async () => {
    const refetch = deferred<unknown>();
    mocks.getDealerMe.mockResolvedValueOnce(NONE).mockReturnValueOnce(refetch.promise);
    mocks.applyDealer.mockRejectedValue(
      new HttpError('x', 'ERR_BAD_REQUEST', { status: 400, data: { code: 'DEALER_APPLICATION_PENDING', message: 'Bạn đã có đơn đăng ký đang chờ duyệt.' }, headers: {} }),
    );
    renderPage();
    const submit = await fillForm();
    fireEvent.click(submit);
    await waitFor(() => expect(mocks.getDealerMe).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Bạn đã có đơn đăng ký đang chờ duyệt.', type: 'info' }));
    expect(submit).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(submit);
    await new Promise((r) => setTimeout(r, 30));
    expect(mocks.applyDealer).toHaveBeenCalledTimes(1);

    await act(async () => refetch.resolve({ ...NONE, status: 'PENDING' }));
    expect(await screen.findByText('Hồ sơ đang được duyệt')).toBeInTheDocument();
    expect(mocks.openSnackbar).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
  });

  it('dealer-me tải lại lỗi: khoá vẫn nhả (không treo nút), form còn đó để thử lại', async () => {
    mocks.getDealerMe.mockResolvedValueOnce(NONE).mockRejectedValue(new Error('mạng chập chờn'));
    mocks.applyDealer.mockResolvedValue({ ok: true });
    renderPage();
    const submit = await fillForm();
    fireEvent.click(submit);
    await waitFor(() => expect(mocks.getDealerMe).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(submit).not.toHaveAttribute('aria-busy'));
    expect(screen.getByRole('button', { name: 'Gửi hồ sơ đăng ký' })).toBeEnabled();
  });

  it('lỗi tiếng Anh của máy chủ không hiện thô: snackbar là câu tiếng Việt, hồ sơ không bị coi là đã nhận (dealer-me tải lại chỉ để đối chiếu, vẫn ở form)', async () => {
    mocks.getDealerMe.mockResolvedValue(NONE);
    mocks.applyDealer.mockRejectedValue(
      new HttpError('x', 'ERR_BAD_REQUEST', { status: 400, data: { message: 'phone must be a string' }, headers: {} }),
    );
    renderPage();
    fireEvent.click(await fillForm());
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })));
    const text = mocks.openSnackbar.mock.calls.find((c) => c[0].type === 'error')![0].text as string;
    expect(text).toBe(t.errors.generic);
    expect(text).not.toMatch(/must be/);
    await waitFor(() => expect(mocks.getDealerMe).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Gửi hồ sơ đăng ký' })).not.toHaveAttribute('aria-busy'));
    expect(screen.queryByText('Hồ sơ đang được duyệt')).toBeNull();
  });
});

// W118A: mọi lời từ chối của máy chủ vì màn đã cũ (400/404/409) đều tải lại dealer-me và giữ khoá tới khi nó về, không riêng mã DEALER_APPLICATION_PENDING.
describe('DealerPage: Gửi hồ sơ bị từ chối thì tải lại trạng thái hồ sơ rồi mới nhả khoá (W118A)', () => {
  const deferred = <T,>() => {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((res) => {
      resolve = res;
    });
    return { promise, resolve };
  };
  const rejection = (status: number, message = 'Hồ sơ chưa hợp lệ.') =>
    new HttpError('x', 'ERR_BAD_REQUEST', { status, data: { message }, headers: {} });
  const errorToasts = () => mocks.openSnackbar.mock.calls.filter((c) => c[0].type === 'error').length;
  const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.applyDealer.mockReset();
    mocks.getDealerMe.mockReset();
  });

  it.each([[400], [404], [409]])('bị từ chối %i: tải lại dealer-me, nút giữ khoá tới khi về, chạm lại không gửi; về rồi nhả và gửi lại được', async (status) => {
    const refetch = deferred<unknown>();
    mocks.getDealerMe.mockResolvedValueOnce(NONE).mockReturnValueOnce(refetch.promise);
    mocks.applyDealer.mockRejectedValueOnce(rejection(status)).mockResolvedValue({ ok: true });
    renderPage();
    const submit = await fillForm();
    fireEvent.click(submit);
    await waitFor(() => expect(mocks.getDealerMe).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(errorToasts()).toBe(1));
    expect(submit).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(submit);
    await settle();
    expect(mocks.applyDealer).toHaveBeenCalledTimes(1);

    await act(async () => refetch.resolve(NONE));
    await waitFor(() => expect(submit).not.toHaveAttribute('aria-busy'));
    expect(errorToasts()).toBe(1);
    fireEvent.click(submit);
    await waitFor(() => expect(mocks.applyDealer).toHaveBeenCalledTimes(2));
  });

  it('bị từ chối 409 mà dealer-me về PENDING (hồ sơ đã nhận ở máy khác): sang màn chờ duyệt', async () => {
    mocks.getDealerMe.mockResolvedValueOnce(NONE).mockResolvedValue({ ...NONE, status: 'PENDING' });
    mocks.applyDealer.mockRejectedValue(rejection(409, 'Hồ sơ vừa có thay đổi.'));
    renderPage();
    fireEvent.click(await fillForm());
    expect(await screen.findByText('Hồ sơ đang được duyệt')).toBeInTheDocument();
    expect(mocks.applyDealer).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['mất mạng', new HttpError('Network Error', 'ERR_NETWORK')],
    ['hết thời gian', new HttpError('timeout', 'ECONNABORTED')],
    ['máy chủ lỗi 503', new HttpError('Service Unavailable', undefined, { status: 503, data: { message: 'Service Unavailable' }, headers: {} })],
    ['hết phiên 401', new HttpError('Unauthorized', undefined, { status: 401, data: { message: 'Unauthorized' }, headers: {} })],
  ])('%s: không tải lại dealer-me, nhả khoá ngay, gửi lại được', async (_label, error) => {
    mocks.getDealerMe.mockResolvedValue(NONE);
    mocks.applyDealer.mockRejectedValueOnce(error).mockResolvedValue({ ok: true });
    renderPage();
    const submit = await fillForm();
    fireEvent.click(submit);
    await waitFor(() => expect(errorToasts()).toBe(1));
    await waitFor(() => expect(submit).not.toHaveAttribute('aria-busy'));
    await settle();
    expect(mocks.getDealerMe).toHaveBeenCalledTimes(1);
    fireEvent.click(submit);
    await waitFor(() => expect(mocks.applyDealer).toHaveBeenCalledTimes(2));
  });

  it('dealer-me tải lại treo mãi: khoá nhả đúng sau LOCK_REFRESH_WAIT_MS', async () => {
    mocks.getDealerMe.mockResolvedValueOnce(NONE).mockReturnValue(new Promise(() => undefined));
    mocks.applyDealer.mockRejectedValueOnce(rejection(400)).mockResolvedValue({ ok: true });
    renderPage();
    const submit = await fillForm();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      fireEvent.click(submit);
      await waitFor(() => expect(errorToasts()).toBe(1));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(LOCK_REFRESH_WAIT_MS - 500);
      });
      expect(submit).toHaveAttribute('aria-busy', 'true');
      fireEvent.click(submit);
      expect(mocks.applyDealer).toHaveBeenCalledTimes(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });
      await waitFor(() => expect(submit).not.toHaveAttribute('aria-busy'));
    } finally {
      vi.useRealTimers();
    }
    fireEvent.click(submit);
    await waitFor(() => expect(mocks.applyDealer).toHaveBeenCalledTimes(2));
  });
});
