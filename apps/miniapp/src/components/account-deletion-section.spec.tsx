import { act, render as rtlRender, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WALLET_FORFEIT_AGREE, WALLET_FORFEIT_LOADING, WALLET_FORFEIT_UNKNOWN } from '../utils/account-deletion-copy';
import { HttpError } from '../services/http';
import { LOCK_REFRESH_WAIT_MS } from '../utils/settle-within';

const mocks = vi.hoisted(() => ({
  openSnackbar: vi.fn(),
  getWallet: vi.fn(),
  requestAccountDeletion: vi.fn(),
  hasOA: false,
  openOAChat: vi.fn(),
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useSnackbar: () => ({ openSnackbar: (opt: unknown) => mocks.openSnackbar(opt), closeSnackbar: vi.fn() }),
}));
vi.mock('../services/account-api', () => ({ requestAccountDeletion: mocks.requestAccountDeletion, getWallet: mocks.getWallet }));
vi.mock('../services/zmp-bridge', () => ({
  get hasOA() {
    return mocks.hasOA;
  },
  openOAChat: mocks.openOAChat,
}));
vi.mock('../services/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getErrorMessage: () => 'lỗi gửi',
}));

import { AccountDeletionSection } from './account-deletion-section';

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const mount = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const view = rtlRender(
    <QueryClientProvider client={qc}>
      <AccountDeletionSection />
    </QueryClientProvider>,
  );
  return { ...view, qc };
};
const openCard = async () => {
  fireEvent.click(await screen.findByRole('button', { name: 'Xoá tài khoản' }));
  await screen.findByText('Xoá tài khoản vĩnh viễn?');
};
const submitBtn = () => screen.getByRole('button', { name: /Gửi yêu cầu xoá/ });
const cancelBtn = () => screen.getByRole('button', { name: 'Huỷ' });
const agreeBox = () => screen.getByRole('checkbox', { name: new RegExp(WALLET_FORFEIT_AGREE.slice(0, 20)) });
const retryIn = (alert: HTMLElement) => within(alert).getByRole('button', { name: 'Thử lại' });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.hasOA = false;
  mocks.getWallet.mockReset().mockResolvedValue({ walletBalance: 0 });
  mocks.requestAccountDeletion.mockReset().mockResolvedValue({ message: 'Đã ghi nhận yêu cầu' });
});

describe('AccountDeletionSection: tải số dư Ví lỗi + Thử lại', () => {
  it('tải số dư lỗi: role="alert" có lời báo + "Thử lại"; nút gửi bị khoá; Huỷ vẫn đóng được', async () => {
    mocks.getWallet.mockRejectedValue(new Error('mạng'));
    mount();
    await openCard();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(WALLET_FORFEIT_UNKNOWN);
    expect(retryIn(alert)).toBeEnabled();
    expect(retryIn(alert).className).toContain('zaui-btn-secondary');
    expect(submitBtn()).toBeDisabled();
    expect(screen.queryByText(WALLET_FORFEIT_LOADING)).toBeNull();

    fireEvent.click(cancelBtn());
    expect(screen.queryByText('Xoá tài khoản vĩnh viễn?')).toBeNull();
  });

  it('"Thử lại": gọi lại số dư; đang tải nút xoay, vùng lỗi + focus đứng yên, không hiện chữ đang kiểm tra; xong thì mở khoá nút gửi', async () => {
    const retry = deferred<{ walletBalance: number }>();
    mocks.getWallet.mockRejectedValueOnce(new Error('mạng')).mockReturnValueOnce(retry.promise);
    mount();
    await openCard();
    const alert = await screen.findByRole('alert');
    const btn = retryIn(alert);
    btn.focus();
    fireEvent.click(btn);
    await waitFor(() => expect(mocks.getWallet).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(btn).toHaveAttribute('aria-busy', 'true'));

    expect(screen.getByRole('alert')).toBe(alert);
    expect(alert).toHaveTextContent(WALLET_FORFEIT_UNKNOWN);
    expect(document.activeElement).toBe(btn);
    expect(screen.queryByText(WALLET_FORFEIT_LOADING)).toBeNull();
    expect(submitBtn()).toBeDisabled();

    fireEvent.click(btn);
    expect(mocks.getWallet).toHaveBeenCalledTimes(2);

    await act(async () => retry.resolve({ walletBalance: 0 }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(submitBtn()).toBeEnabled();
  });

  it('"Thử lại" lỗi tiếp: vùng lỗi vẫn đó, nút hết xoay, thử lại được lần nữa', async () => {
    mocks.getWallet.mockRejectedValueOnce(new Error('mạng')).mockRejectedValueOnce(new Error('mạng')).mockResolvedValueOnce({ walletBalance: 0 });
    mount();
    await openCard();
    fireEvent.click(retryIn(await screen.findByRole('alert')));
    await waitFor(() => expect(mocks.getWallet).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(retryIn(screen.getByRole('alert'))).not.toHaveAttribute('aria-busy'));
    expect(screen.getByRole('alert')).toHaveTextContent(WALLET_FORFEIT_UNKNOWN);
    expect(submitBtn()).toBeDisabled();

    fireEvent.click(retryIn(screen.getByRole('alert')));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(mocks.getWallet).toHaveBeenCalledTimes(3);
    expect(submitBtn()).toBeEnabled();
  });

  it('đã Thử lại xong, đóng thẻ, cache Ví bị xoá (đăng xuất) rồi mở lại: lượt tải mới hiện chữ đang kiểm tra, không hiện vùng lỗi cũ', async () => {
    mocks.getWallet.mockRejectedValueOnce(new Error('mạng')).mockResolvedValueOnce({ walletBalance: 0 });
    const { qc } = mount();
    await openCard();
    fireEvent.click(retryIn(await screen.findByRole('alert')));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    fireEvent.click(cancelBtn());
    act(() => qc.removeQueries({ queryKey: ['wallet'] }));

    const slow = deferred<{ walletBalance: number }>();
    mocks.getWallet.mockReset().mockReturnValue(slow.promise);
    fireEvent.click(screen.getByRole('button', { name: 'Xoá tài khoản' }));
    expect(await screen.findByText(WALLET_FORFEIT_LOADING)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    await act(async () => slow.resolve({ walletBalance: 0 }));
  });

  it('đã tick đồng ý với số dư cũ, Thử lại ra số dư mới: tick bị bỏ, nút gửi khoá, phải tick lại thì mới gửi đúng số mới', async () => {
    mocks.getWallet.mockResolvedValueOnce({ walletBalance: 20000 }).mockRejectedValueOnce(new Error('mạng')).mockResolvedValueOnce({ walletBalance: 30000 });
    mocks.requestAccountDeletion.mockRejectedValueOnce(new Error('Số dư vừa đổi'));
    mount();
    await openCard();
    await screen.findByText(/Ví Tubu còn 20\.000đ/);
    fireEvent.click(agreeBox());
    fireEvent.click(submitBtn());
    const alert = await screen.findByRole('alert');
    expect(agreeBox()).not.toBeChecked();

    fireEvent.click(agreeBox());
    expect(agreeBox()).toBeChecked();
    expect(submitBtn()).toBeEnabled();
    fireEvent.click(retryIn(alert));
    await screen.findByText(/Ví Tubu còn 30\.000đ/);
    await waitFor(() => expect(agreeBox()).not.toBeChecked());
    expect(submitBtn()).toBeDisabled();
    expect(mocks.requestAccountDeletion).toHaveBeenCalledTimes(1);

    fireEvent.click(agreeBox());
    await waitFor(() => expect(submitBtn()).toBeEnabled());
    fireEvent.click(submitBtn());
    await waitFor(() => expect(mocks.requestAccountDeletion).toHaveBeenCalledTimes(2));
    expect(mocks.requestAccountDeletion).toHaveBeenLastCalledWith(undefined, { acknowledgedWalletBalance: 30000, acceptWalletForfeit: true });
  });

  it('tick đồng ý rồi Huỷ, mở lại thẻ (số dư cache giữ nguyên): ô đồng ý trống, nút gửi khoá', async () => {
    mocks.getWallet.mockResolvedValue({ walletBalance: 20000 });
    mount();
    await openCard();
    await screen.findByText(/Ví Tubu còn 20\.000đ/);
    fireEvent.click(agreeBox());
    expect(agreeBox()).toBeChecked();
    fireEvent.click(cancelBtn());
    fireEvent.click(screen.getByRole('button', { name: 'Xoá tài khoản' }));
    await screen.findByText(/Ví Tubu còn 20\.000đ/);
    expect(agreeBox()).not.toBeChecked();
    expect(submitBtn()).toBeDisabled();
  });

  it('đã Thử lại xong rồi gửi thành công (thẻ tự đóng), cache Ví bị xoá, mở lại: hiện chữ đang kiểm tra, không hiện vùng lỗi cũ', async () => {
    mocks.getWallet.mockRejectedValueOnce(new Error('mạng')).mockResolvedValueOnce({ walletBalance: 0 });
    const { qc } = mount();
    await openCard();
    fireEvent.click(retryIn(await screen.findByRole('alert')));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    await waitFor(() => expect(submitBtn()).toBeEnabled());
    fireEvent.click(submitBtn());
    await waitFor(() => expect(screen.queryByText('Xoá tài khoản vĩnh viễn?')).toBeNull());
    act(() => qc.removeQueries({ queryKey: ['wallet'] }));

    const slow = deferred<{ walletBalance: number }>();
    mocks.getWallet.mockReset().mockReturnValue(slow.promise);
    fireEvent.click(screen.getByRole('button', { name: 'Xoá tài khoản' }));
    expect(await screen.findByText(WALLET_FORFEIT_LOADING)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    await act(async () => slow.resolve({ walletBalance: 0 }));
  });

  it('còn số dư cũ mà lần tải lại lỗi (sau khi máy chủ từ chối): vẫn hiện số dư + vùng lỗi + Thử lại; đang gửi thì Thử lại bị khoá', async () => {
    mocks.getWallet.mockResolvedValueOnce({ walletBalance: 20000 }).mockRejectedValueOnce(new Error('mạng'));
    mocks.requestAccountDeletion.mockRejectedValueOnce(new Error('Số dư vừa đổi'));
    mount();
    await openCard();
    await screen.findByText(/Ví Tubu còn 20\.000đ/);
    fireEvent.click(agreeBox());
    fireEvent.click(submitBtn());
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(WALLET_FORFEIT_UNKNOWN);
    expect(screen.getByText(/Ví Tubu còn 20\.000đ/)).toBeInTheDocument();
    expect(agreeBox()).not.toBeChecked();

    const pending = deferred<{ message: string }>();
    mocks.requestAccountDeletion.mockReturnValueOnce(pending.promise);
    fireEvent.click(agreeBox());
    fireEvent.click(submitBtn());
    await waitFor(() => expect(submitBtn()).toHaveAttribute('aria-busy', 'true'));
    expect(retryIn(screen.getByRole('alert'))).toBeDisabled();
    await act(async () => pending.resolve({ message: 'Đã ghi nhận yêu cầu' }));
  });
});

describe('AccountDeletionSection: khoá khi đang gửi yêu cầu', () => {
  async function startPending() {
    mocks.getWallet.mockResolvedValue({ walletBalance: 20000 });
    const pending = deferred<{ message: string }>();
    mocks.requestAccountDeletion.mockReturnValue(pending.promise);
    mount();
    await openCard();
    await screen.findByText(/Ví Tubu còn 20\.000đ/);
    fireEvent.click(agreeBox());
    await waitFor(() => expect(submitBtn()).toBeEnabled());
    fireEvent.click(submitBtn());
    await waitFor(() => expect(submitBtn()).toHaveAttribute('aria-busy', 'true'));
    return pending;
  }

  it('đang gửi: Huỷ bị khoá và bấm không thu thẻ lại; ô đồng ý bị khoá; nút gửi báo bận nhưng giữ focus, bấm lại không gửi lần hai', async () => {
    const pending = await startPending();
    expect(cancelBtn()).toBeDisabled();
    fireEvent.click(cancelBtn());
    expect(screen.getByText('Xoá tài khoản vĩnh viễn?')).toBeInTheDocument();
    expect(agreeBox()).toBeDisabled();
    expect(agreeBox()).toBeChecked();

    const send = submitBtn();
    expect(send).toHaveAttribute('aria-disabled', 'true');
    send.focus();
    fireEvent.click(send);
    expect(mocks.requestAccountDeletion).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(send);

    await act(async () => pending.resolve({ message: 'Đã ghi nhận yêu cầu' }));
    await waitFor(() => expect(screen.queryByText('Xoá tài khoản vĩnh viễn?')).toBeNull());
    expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã ghi nhận yêu cầu', type: 'info' });
  });

  it('gửi lỗi: thẻ ở lại, Huỷ và ô đồng ý mở khoá lại, ô đồng ý bỏ tick, báo lỗi', async () => {
    const pending = await startPending();
    await act(async () => pending.reject(new Error('boom')));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'lỗi gửi', type: 'error' }));
    expect(screen.getByText('Xoá tài khoản vĩnh viễn?')).toBeInTheDocument();
    expect(cancelBtn()).toBeEnabled();
    expect(agreeBox()).toBeEnabled();
    await waitFor(() => expect(agreeBox()).not.toBeChecked());
    expect(submitBtn()).toBeDisabled();
  });

  it('thành công có OA: mở chat OA và đóng thẻ', async () => {
    mocks.hasOA = true;
    const pending = await startPending();
    await act(async () => pending.resolve({ message: 'Đã ghi nhận yêu cầu' }));
    await waitFor(() => expect(mocks.openOAChat).toHaveBeenCalledWith('Tôi muốn xoá tài khoản Tubu Tree'));
    expect(screen.queryByText('Xoá tài khoản vĩnh viễn?')).toBeNull();
  });
});

describe('AccountDeletionSection: nút gửi yêu cầu khoá đồng bộ chạm đúp (W78A)', () => {
  const readyToSend = async () => {
    mount();
    await openCard();
    await waitFor(() => expect(submitBtn()).toBeEnabled());
  };

  it('chạm đúp "Gửi yêu cầu xoá" trong cùng một khung hình chỉ gửi một yêu cầu; xong báo, mở OA và đóng thẻ một lần', async () => {
    mocks.hasOA = true;
    const pending = deferred<{ message: string }>();
    mocks.requestAccountDeletion.mockReturnValue(pending.promise);
    await readyToSend();
    const send = submitBtn();
    await act(async () => {
      fireEvent.click(send);
      fireEvent.click(send);
    });
    expect(mocks.requestAccountDeletion).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(submitBtn()).toHaveAttribute('aria-busy', 'true'));
    await act(async () => pending.resolve({ message: 'Đã ghi nhận yêu cầu' }));
    await waitFor(() => expect(screen.queryByText('Xoá tài khoản vĩnh viễn?')).toBeNull());
    expect(mocks.openSnackbar.mock.calls.filter(([o]) => (o as { type: string }).type === 'info')).toHaveLength(1);
    expect(mocks.openOAChat).toHaveBeenCalledTimes(1);
  });

  it('lỗi thì nhả khoá: chạm đúp chỉ báo lỗi một lần, bấm lại gọi lần hai và thành công thì đóng thẻ', async () => {
    const pending = deferred<{ message: string }>();
    mocks.requestAccountDeletion.mockReturnValueOnce(pending.promise);
    await readyToSend();
    const send = submitBtn();
    await act(async () => {
      fireEvent.click(send);
      fireEvent.click(send);
    });
    expect(mocks.requestAccountDeletion).toHaveBeenCalledTimes(1);
    await act(async () => pending.reject(new Error('boom')));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'lỗi gửi', type: 'error' }));
    expect(mocks.openSnackbar.mock.calls.filter(([o]) => (o as { type: string }).type === 'error')).toHaveLength(1);
    await waitFor(() => expect(submitBtn()).not.toHaveAttribute('aria-busy'));
    expect(screen.getByText('Xoá tài khoản vĩnh viễn?')).toBeInTheDocument();

    fireEvent.click(submitBtn());
    await waitFor(() => expect(mocks.requestAccountDeletion).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText('Xoá tài khoản vĩnh viễn?')).toBeNull());
  });

  it('nút "Xoá tài khoản" mở thẻ xác nhận chỉ một thẻ dù chạm đúp; chưa gửi gì lên máy chủ', async () => {
    mount();
    const open = await screen.findByRole('button', { name: 'Xoá tài khoản' });
    await act(async () => {
      fireEvent.click(open);
      fireEvent.click(open);
    });
    expect(screen.getAllByText('Xoá tài khoản vĩnh viễn?')).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /Gửi yêu cầu xoá/ })).toHaveLength(1);
    expect(mocks.requestAccountDeletion).not.toHaveBeenCalled();
  });
});

describe('AccountDeletionSection: số đều (tabular-nums)', () => {
  it('dòng báo số dư Ví mất có tabular-nums', async () => {
    mocks.getWallet.mockResolvedValue({ walletBalance: 20000 });
    mount();
    await openCard();
    const notice = await screen.findByText(/Ví Tubu còn 20\.000đ/);
    expect(notice.style.fontVariantNumeric).toBe('tabular-nums');
  });
});

describe('AccountDeletionSection: máy chủ từ chối vì số dư không còn khớp thì tải lại số dư rồi mới nhả khoá (W108A)', () => {
  const serverError = (message: string, status: number) => new HttpError(message, undefined, { status, data: { message } } as never);
  const errorToasts = () => mocks.openSnackbar.mock.calls.filter(([o]) => (o as { type: string }).type === 'error');
  const TEMPORARY: [string, unknown][] = [
    ['mất mạng', new HttpError('Network Error', 'ERR_NETWORK')],
    ['quá thời gian', new HttpError('timeout', 'ECONNABORTED')],
    ['máy chủ lỗi 503', serverError('Service Unavailable', 503)],
    ['hết phiên 401', serverError('Unauthorized', 401)],
    ['lỗi không phải HTTP', new Error('boom')],
  ];
  /** Mở thẻ với số dư 20.000đ đã tick đồng ý; lần tải lại số dư kế tiếp do `refetch` quyết định. */
  async function readyWithBalance(refetch: Promise<{ walletBalance: number }>) {
    mocks.getWallet.mockResolvedValueOnce({ walletBalance: 20000 }).mockReturnValueOnce(refetch).mockResolvedValue({ walletBalance: 30000 });
    mount();
    await openCard();
    await screen.findByText(/Ví Tubu còn 20\.000đ/);
    fireEvent.click(agreeBox());
    await waitFor(() => expect(submitBtn()).toBeEnabled());
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([400, 404, 409])('bị từ chối %i: tải lại số dư, ô đồng ý và nút Huỷ khoá tới khi số mới về, rồi phải tick lại đúng số mới mới gửi được', async (status) => {
    const refetch = deferred<{ walletBalance: number }>();
    mocks.requestAccountDeletion.mockRejectedValueOnce(serverError('Số dư Ví vừa đổi.', status));
    await readyWithBalance(refetch.promise);
    const send = submitBtn();
    await act(async () => {
      fireEvent.click(send);
      fireEvent.click(send);
    });
    await waitFor(() => expect(mocks.getWallet).toHaveBeenCalledTimes(2));
    expect(mocks.requestAccountDeletion).toHaveBeenCalledTimes(1);
    expect(errorToasts()).toHaveLength(1);
    expect(submitBtn()).toHaveAttribute('aria-busy', 'true');
    expect(agreeBox()).toBeDisabled();
    expect(agreeBox()).not.toBeChecked();
    expect(cancelBtn()).toBeDisabled();
    fireEvent.click(submitBtn());
    expect(mocks.requestAccountDeletion).toHaveBeenCalledTimes(1);

    await act(async () => refetch.resolve({ walletBalance: 30000 }));
    await screen.findByText(/Ví Tubu còn 30\.000đ/);
    await waitFor(() => expect(agreeBox()).toBeEnabled());
    expect(agreeBox()).not.toBeChecked();
    expect(submitBtn()).toBeDisabled();
    expect(cancelBtn()).toBeEnabled();
    expect(errorToasts()).toHaveLength(1);

    fireEvent.click(agreeBox());
    await waitFor(() => expect(submitBtn()).toBeEnabled());
    fireEvent.click(submitBtn());
    await waitFor(() => expect(mocks.requestAccountDeletion).toHaveBeenCalledTimes(2));
    expect(mocks.requestAccountDeletion).toHaveBeenLastCalledWith(undefined, { acknowledgedWalletBalance: 30000, acceptWalletForfeit: true });
  });

  it.each(TEMPORARY)('%s: khoá nhả ngay, không đợi số dư tải lại (ô đồng ý và Huỷ mở lại liền)', async (_label, error) => {
    const refetch = deferred<{ walletBalance: number }>();
    mocks.requestAccountDeletion.mockRejectedValueOnce(error);
    await readyWithBalance(refetch.promise);
    await act(async () => {
      fireEvent.click(submitBtn());
    });
    await waitFor(() => expect(errorToasts()).toHaveLength(1));
    await waitFor(() => expect(mocks.getWallet).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(submitBtn()).not.toHaveAttribute('aria-busy'));
    expect(agreeBox()).toBeEnabled();
    expect(cancelBtn()).toBeEnabled();
    await act(async () => refetch.resolve({ walletBalance: 20000 }));
  });

  it('bị từ chối mà số dư tải lại treo mãi: khoá nhả đúng sau LOCK_REFRESH_WAIT_MS, không sớm hơn', async () => {
    mocks.requestAccountDeletion.mockRejectedValueOnce(serverError('Số dư Ví vừa đổi.', 400));
    await readyWithBalance(new Promise<{ walletBalance: number }>(() => undefined));
    vi.useFakeTimers();
    await act(async () => {
      fireEvent.click(submitBtn());
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mocks.getWallet).toHaveBeenCalledTimes(2);
    expect(agreeBox()).toBeDisabled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOCK_REFRESH_WAIT_MS - 1);
    });
    expect(agreeBox()).toBeDisabled();
    expect(cancelBtn()).toBeDisabled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
      for (let i = 0; i < 3; i++) await vi.advanceTimersByTimeAsync(0);
    });
    expect(agreeBox()).toBeEnabled();
    expect(cancelBtn()).toBeEnabled();
  });
});
