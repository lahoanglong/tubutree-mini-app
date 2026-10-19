import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { AxiosError } from 'axios';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  openSnackbar: vi.fn(),
  getBankQr: vi.fn(),
  copyText: vi.fn(),
  fetchSupportContact: vi.fn(),
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div data-testid="page" className={className}>
      {children}
    </div>
  ),
  useParams: () => ({ code: 'TT001' }),
  useNavigate: () => mocks.navigate,
  useLocation: () => ({ pathname: '/bank-payment/TT001', search: '', state: null }),
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('./about-data', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchSupportContact: mocks.fetchSupportContact,
}));
vi.mock('../services/payment-api', () => ({ getBankQr: mocks.getBankQr }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));
vi.mock('../utils/clipboard', () => ({ copyText: mocks.copyText }));

import BankPaymentPage from './bank-payment';

const QR = {
  orderCode: 'TT001',
  amount: 120_000,
  paymentStatus: 'UNPAID' as const,
  bank: { bin: '970436', name: 'Vietcombank', accountNo: '0123456789', accountName: 'CONG TY TUBU' },
  memo: 'TT001',
  qrString: 'qr',
  qrImageUrl: 'https://example.test/qr.png',
};

// Cùng dải với scripts/uiux/static-scan.mjs, thêm ⌛ ⏳ ⭐.
const EMOJI = /[\u{1F300}-\u{1FAFF}☀-➿⌚⌛⏩-⏿⭐]/u;

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <BankPaymentPage />
    </QueryClientProvider>,
  );
}

describe('Thanh toán chuyển khoản: không dùng emoji làm icon (C-113)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getBankQr.mockResolvedValue(QR);
  });

  it('chờ thanh toán: dòng nhắc giữ nội dung chuyển khoản có icon cảnh báo bằng SVG, không emoji', async () => {
    const { container } = renderPage();
    const note = (await screen.findByText(/Giữ nguyên nội dung/)).closest('div') as HTMLElement;
    expect(note.textContent).toContain('Giữ nguyên nội dung TT001 để hệ thống tự xác nhận.');
    expect(note.querySelector('svg')).not.toBeNull();
    expect(EMOJI.test(container.textContent ?? '')).toBe(false);
  });

  it('bấm Kiểm tra khi chưa có tiền về: cảnh báo "chưa thấy tiền về", không emoji', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Tôi đã chuyển khoản/ }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledTimes(1));
    expect(mocks.openSnackbar).toHaveBeenCalledWith({
      text: 'Hệ thống chưa thấy tiền về. Ngân hàng thường xử lý từ 30s - 1 phút sau khi chuyển. Vui lòng kiểm tra lại sau ít phút nhé!',
      type: 'warning',
      position: 'top',
    });
  });

  it('bấm Kiểm tra khi giao dịch thất bại / hoàn tiền: báo lỗi, không emoji', async () => {
    mocks.getBankQr.mockResolvedValueOnce(QR).mockResolvedValue({ ...QR, paymentStatus: 'FAILED' });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Tôi đã chuyển khoản/ }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledTimes(1));
    expect(mocks.openSnackbar).toHaveBeenCalledWith({
      text: 'Giao dịch không thành công hoặc đã được hoàn lại. Vui lòng liên hệ bộ phận hỗ trợ.',
      type: 'error',
      position: 'top',
    });
  });

  it('bấm Kiểm tra khi tiền đã về: báo thành công và trang chuyển sang màn "Đã nhận thanh toán"', async () => {
    mocks.getBankQr.mockResolvedValueOnce(QR).mockResolvedValue({ ...QR, paymentStatus: 'PAID' });
    const { container } = renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Tôi đã chuyển khoản/ }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledTimes(1));
    expect(mocks.openSnackbar).toHaveBeenCalledWith({
      text: 'Đã nhận được thanh toán thành công! Đơn hàng của bạn đã được xác nhận.',
      type: 'success',
      position: 'top',
    });
    expect(await screen.findByText('Đã nhận thanh toán!')).toBeInTheDocument();
    expect(screen.getByText('Đơn TT001 đã được xác nhận. Cảm ơn bạn')).toBeInTheDocument();
    expect(EMOJI.test(container.textContent ?? '')).toBe(false);
  });

  it('bấm Kiểm tra khi trạng thái chưa rõ: báo thông tin "đã làm mới", không emoji', async () => {
    mocks.getBankQr.mockResolvedValueOnce(QR).mockResolvedValue({ ...QR, paymentStatus: 'REFUND_PENDING' });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Tôi đã chuyển khoản/ }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledTimes(1));
    expect(mocks.openSnackbar).toHaveBeenCalledWith({
      text: 'Đã làm mới trạng thái. Đang chờ hệ thống ngân hàng xác nhận.',
      type: 'info',
      position: 'top',
    });
  });

  it('đã thanh toán sẵn: nút "Xem đơn hàng" mở đơn thay thế lịch sử', async () => {
    mocks.getBankQr.mockResolvedValue({ ...QR, paymentStatus: 'PAID' });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Xem đơn hàng' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/order/TT001', { replace: true });
  });
});

// BUYERMINI-17: header tự dựng căn giữa nên dòng phụ chạy dưới nút Quay lại nổi (fixed, x 12→56) và mất chữ đầu.
describe('Thanh toán chuyển khoản: header chừa chỗ cho nút Quay lại (BUYERMINI-17)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getBankQr.mockResolvedValue(QR);
  });

  it('tiêu đề và dòng hướng dẫn nằm chung khối đã chừa 48px bên trái, không chạy dưới nút Quay lại', async () => {
    renderPage();
    const hint = await screen.findByText('Mở app ngân hàng / ví bất kỳ → quét mã VietQR bên dưới');
    const block = hint.parentElement as HTMLElement;
    expect(block.contains(screen.getByRole('heading', { level: 1 }))).toBe(true);
    expect(block.style.paddingLeft).toBe('48px');
    expect(block.style.textAlign).not.toBe('center');
  });
});

describe('Thanh toán chuyển khoản: mỗi trạng thái có đúng một h1 (axe page-has-heading-one, C-114)', () => {
  beforeEach(() => vi.clearAllMocks());

  const onlyH1 = () => {
    const h1 = screen.getAllByRole('heading', { level: 1 });
    expect(h1).toHaveLength(1);
    return h1[0]!;
  };

  it('chờ thanh toán: tiêu đề "Quét QR để chuyển khoản" là h1', async () => {
    mocks.getBankQr.mockResolvedValue(QR);
    renderPage();
    await screen.findByRole('button', { name: /Tôi đã chuyển khoản/ });
    expect(onlyH1().textContent).toBe('Quét QR để chuyển khoản');
  });

  it('đã thanh toán: "Đã nhận thanh toán!" là h1', async () => {
    mocks.getBankQr.mockResolvedValue({ ...QR, paymentStatus: 'PAID' });
    renderPage();
    await screen.findByRole('button', { name: 'Xem đơn hàng' });
    expect(onlyH1().textContent).toBe('Đã nhận thanh toán!');
  });

  it('đang tải và tải lỗi: h1 ẩn "Thanh toán chuyển khoản" giữ trang có tiêu đề mà không đổi bố cục', async () => {
    mocks.getBankQr.mockReturnValue(new Promise(() => {}));
    const loading = renderPage();
    expect(onlyH1().textContent).toBe('Thanh toán chuyển khoản');
    loading.unmount();

    mocks.getBankQr.mockRejectedValue(new Error('x'));
    renderPage();
    await screen.findByText('Chưa tải được thông tin thanh toán');
    expect(onlyH1().textContent).toBe('Thanh toán chuyển khoản');
  });
});

describe('Thanh toán chuyển khoản: lần dò nền lỗi không làm mất mã QR (R5-BUYER-1)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('đã có mã QR rồi mà bấm Kiểm tra gặp lỗi mạng: vẫn giữ nguyên QR và số tài khoản, chỉ báo lỗi bằng thông báo nhỏ', async () => {
    mocks.getBankQr.mockResolvedValueOnce(QR).mockRejectedValue(new Error('Network Error'));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Tôi đã chuyển khoản/ }));
    await waitFor(() =>
      expect(mocks.openSnackbar).toHaveBeenCalledWith({
        text: 'Không thể kết nối tới máy chủ. Vui lòng kiểm tra lại kết nối mạng.',
        type: 'error',
        position: 'top',
      }),
    );
    expect(screen.queryByText('Chưa tải được thông tin thanh toán')).toBeNull();
    expect(screen.getByText('0123456789')).toBeInTheDocument();
  });
});

describe('Thanh toán chuyển khoản: hạn thanh toán (BUYERMINI-8)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('có hạn → nói rõ chuyển trước giờ nào và quá hạn đơn tự huỷ', async () => {
    mocks.getBankQr.mockResolvedValue({ ...QR, paymentDeadline: new Date(Date.now() + 3_600_000).toISOString() });
    renderPage();
    const note = await screen.findByRole('note');
    expect(note).toHaveTextContent(/Vui lòng chuyển khoản trước \d{2}:\d{2} \d{2}\/\d{2}\/\d{4}\. Quá hạn đơn sẽ tự huỷ/);
  });

  it('API bản cũ không trả hạn → không hiện khung hạn', async () => {
    mocks.getBankQr.mockResolvedValue(QR);
    renderPage();
    await screen.findByText(/Giữ nguyên nội dung/);
    expect(screen.queryByRole('note')).toBeNull();
  });
});

describe('Thanh toán chuyển khoản: nút sao chép (D5-02)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getBankQr.mockResolvedValue(QR);
    mocks.copyText.mockResolvedValue(true);
  });

  const COPIES = [
    ['Sao chép số tài khoản', '0123456789', 'Đã sao chép số tài khoản'],
    ['Sao chép số tiền', '120000', 'Đã sao chép số tiền'],
    ['Sao chép nội dung chuyển khoản', 'TT001', 'Đã sao chép nội dung chuyển khoản'],
  ] as const;

  it('mỗi dòng có nút sao chép thật (button) tên rõ ràng, vùng chạm tối thiểu 44px', async () => {
    renderPage();
    for (const [name] of COPIES) {
      const btn = await screen.findByRole('button', { name });
      expect(btn.tagName).toBe('BUTTON');
      expect(btn.style.minWidth).toBe('44px');
      expect(btn.style.minHeight).toBe('44px');
    }
  });

  it.each(COPIES)('"%s" chép đúng giá trị, báo "Đã sao chép" bằng thông báo nhỏ và chữ đọc được', async (name, value, done) => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name }));
    expect(mocks.copyText).toHaveBeenCalledWith(value);
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: done, type: 'success', position: 'top' }));
    expect(await screen.findByRole('status')).toHaveTextContent(done);
  });

  it('chép không được (webview chặn clipboard): báo lỗi bảo chép tay, không hiện "Đã sao chép"', async () => {
    mocks.copyText.mockResolvedValue(false);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Sao chép số tài khoản' }));
    await waitFor(() =>
      expect(mocks.openSnackbar).toHaveBeenCalledWith({
        text: 'Không thể sao chép số tài khoản. Vui lòng sao chép thủ công.',
        type: 'error',
        position: 'top',
      }),
    );
    expect(screen.queryByText(/Đã sao chép/)).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('xác nhận "Đã sao chép" tự tắt sau vài giây để lần chép sau lại có phản hồi', async () => {
    renderPage();
    const btn = await screen.findByRole('button', { name: 'Sao chép số tiền' });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      fireEvent.click(btn);
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(screen.getByRole('status')).toHaveTextContent('Đã sao chép số tiền');
      act(() => {
        vi.advanceTimersByTime(2500);
      });
      expect(screen.queryByRole('status')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Thanh toán chuyển khoản: đếm ngược hạn thanh toán (D5-02)', () => {
  const NOW = new Date('2026-10-17T10:00:00Z');
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  });
  afterEach(() => vi.useRealTimers());

  it('còn hạn: khung nhắc có thêm dòng "Còn 2 giờ 30 phút" bên cạnh giờ hạn tuyệt đối', async () => {
    mocks.getBankQr.mockResolvedValue({ ...QR, paymentDeadline: '2026-10-17T12:30:00Z' });
    renderPage();
    const countdown = await screen.findByTestId('payment-countdown');
    expect(countdown).toHaveTextContent('Còn 2 giờ 30 phút để chuyển khoản');
    const note = countdown.closest('[role="note"]') as HTMLElement;
    expect(note).toHaveTextContent(/Vui lòng chuyển khoản trước \d{2}:\d{2} \d{2}\/\d{2}\/\d{4}\. Quá hạn đơn sẽ tự huỷ/);
    expect(within(note).getByTestId('payment-countdown')).toBe(countdown);
  });

  it('đồng hồ không phải vùng đọc tự động (không làm trình đọc màn hình đọc lại mỗi 15 giây)', async () => {
    mocks.getBankQr.mockResolvedValue({ ...QR, paymentDeadline: '2026-10-17T12:30:00Z' });
    renderPage();
    const el = await screen.findByTestId('payment-countdown');
    expect(el.closest('[aria-live]')).toBeNull();
    expect(el.closest('[role="status"], [role="alert"]')).toBeNull();
  });

  it('quá hạn: nói thẳng "quá hạn chuyển khoản" thay vì đồng hồ về 0 (và không còn QR, D14-02)', async () => {
    mocks.getBankQr.mockResolvedValue({ ...QR, paymentDeadline: '2026-10-17T09:00:00Z' });
    renderPage();
    expect(await screen.findByText(/Đơn đã quá hạn chuyển khoản/)).toBeInTheDocument();
    expect(screen.queryByTestId('payment-countdown')).toBeNull();
    expect(screen.queryByAltText('VietQR')).toBeNull();
  });

  it('API không trả hạn: giữ nguyên, không có đồng hồ (không bịa hạn)', async () => {
    mocks.getBankQr.mockResolvedValue(QR);
    renderPage();
    await screen.findByText(/Giữ nguyên nội dung/);
    expect(screen.queryByTestId('payment-countdown')).toBeNull();
  });
});

// D14-02: đơn bị huỷ/quá hạn khi khách đang ở màn QR.
describe('Thanh toán chuyển khoản: đơn bị huỷ hoặc quá hạn khi đang xem QR (D14-02)', () => {
  const CANCELLED = 'Đơn đã hủy/trả, không thể thanh toán.';
  const apiError = (status: number, message = CANCELLED) =>
    new AxiosError('Request failed', 'ERR_BAD_REQUEST', undefined, undefined, {
      status, statusText: '', headers: {}, config: {} as never, data: { message },
    });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getBankQr.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it('lần dò sau bị 400 "đơn đã huỷ": ẩn QR, số tài khoản và số tiền, hiện lý do và lối về chi tiết đơn', async () => {
    mocks.getBankQr.mockResolvedValueOnce(QR).mockRejectedValue(apiError(400));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Tôi đã chuyển khoản/ }));
    expect(await screen.findByText(CANCELLED)).toBeInTheDocument();
    expect(screen.queryByAltText('VietQR')).toBeNull();
    expect(screen.queryByText('0123456789')).toBeNull();
    expect(screen.queryByText(/Đang chờ thanh toán/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Tôi đã chuyển khoản/ })).toBeNull();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Xem đơn hàng' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/order/TT001', { replace: true });
  });

  it('bấm Kiểm tra mà máy chủ trả 400 nghiệp vụ: báo đúng lý do của máy chủ, không báo lỗi mạng', async () => {
    mocks.getBankQr.mockResolvedValueOnce(QR).mockRejectedValue(apiError(400));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Tôi đã chuyển khoản/ }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledTimes(1));
    expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: CANCELLED, type: 'error', position: 'top' });
  });

  it('gặp 400 thì dừng dò nền (không gọi máy chủ mỗi 4 giây nữa)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    mocks.getBankQr.mockResolvedValueOnce(QR).mockRejectedValue(apiError(400));
    renderPage();
    const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
    await tick(0);
    await tick(4_000);
    expect(mocks.getBankQr).toHaveBeenCalledTimes(2);
    await tick(30_000);
    expect(mocks.getBankQr).toHaveBeenCalledTimes(2);
  });

  it('lỗi 5xx hoặc mạng khi dò nền: vẫn giữ QR và tiếp tục dò', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    mocks.getBankQr.mockResolvedValueOnce(QR).mockRejectedValue(apiError(503, 'x'));
    renderPage();
    const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
    await tick(0);
    await tick(4_000);
    await tick(4_000);
    expect(mocks.getBankQr.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(screen.getByAltText('VietQR')).toBeInTheDocument();
  });

  it('lần dò sau bị 401 (phiên hết hạn, refresh chưa được): vẫn giữ QR và tiếp tục dò, không báo đơn đã đóng', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    mocks.getBankQr.mockResolvedValueOnce(QR).mockRejectedValueOnce(apiError(401, 'Unauthorized')).mockResolvedValue(QR);
    renderPage();
    const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
    await tick(0);
    await tick(4_000);
    expect(screen.getByAltText('VietQR')).toBeInTheDocument();
    expect(screen.queryByText('Unauthorized')).toBeNull();
    expect(screen.queryByText('Đơn không còn chờ chuyển khoản')).toBeNull();
    await tick(4_000);
    expect(mocks.getBankQr).toHaveBeenCalledTimes(3);
  });

  it('mở link của đơn đã huỷ: hiện lý do máy chủ và lối xem đơn, không có nút Thử lại vô ích', async () => {
    mocks.getBankQr.mockRejectedValue(apiError(400));
    renderPage();
    expect(await screen.findByText(CANCELLED)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Thử lại' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Xem đơn hàng' })).toBeInTheDocument();
  });

  it('quá hạn chuyển khoản theo giờ máy: ẩn QR và số tài khoản, nói rõ đã quá hạn', async () => {
    mocks.getBankQr.mockResolvedValue({ ...QR, paymentDeadline: new Date(Date.now() - 60_000).toISOString() });
    renderPage();
    expect(await screen.findByText(/đã quá hạn/i)).toBeInTheDocument();
    expect(screen.queryByAltText('VietQR')).toBeNull();
    expect(screen.queryByText('0123456789')).toBeNull();
    expect(screen.getByRole('button', { name: 'Xem đơn hàng' })).toBeInTheDocument();
  });
});

describe('Thanh toán chuyển khoản: bố cục và hướng dẫn (D6-01, D6-12)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getBankQr.mockResolvedValue(QR);
  });
  afterEach(() => document.body.classList.remove('with-back-btn'));

  it('màn QR có PageHeader (đã chừa chỗ nút Quay lại) nên Page không mang class "page": không cộng đệm 48px lần hai', async () => {
    document.body.classList.add('with-back-btn');
    const { container } = renderPage();
    await screen.findByRole('heading', { level: 1, name: 'Quét QR để chuyển khoản' });
    expect(container.querySelector('.page')).toBeNull();
  });

  it('khung chờ tải mô phỏng đúng vị trí tiêu đề (cạnh nút Quay lại), không dùng class "page" nên màn không nhảy khi tải xong', () => {
    mocks.getBankQr.mockReturnValue(new Promise(() => {}));
    document.body.classList.add('with-back-btn');
    const { container } = renderPage();
    expect(container.querySelector('.page')).toBeNull();
  });

  it('"Giữ nguyên nội dung" nằm trong khối lưu ý màu cảnh báo, không dùng chữ đỏ như báo lỗi', async () => {
    renderPage();
    const hint = await screen.findByText(/Giữ nguyên nội dung/);
    const note = hint.closest('[data-testid="memo-note"]') as HTMLElement;
    expect(note).not.toBeNull();
    expect(note.textContent).toContain('Giữ nguyên nội dung TT001 để hệ thống tự xác nhận.');
    expect(note.getAttribute('style')).toContain('--color-status-warning-bg');
    expect(note.innerHTML).not.toContain('--color-text-danger');
    expect(note.innerHTML).not.toContain('color="var(--color-text-danger)"');
  });
});

describe('Thanh toán chuyển khoản: lỗi tải có hướng dẫn và hotline (D6-02)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getBankQr.mockReset();
    mocks.fetchSupportContact.mockResolvedValue({ hotline: '0984606774', email: null, zaloOaName: null });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('máy chủ lỗi: tiêu đề, câu hướng dẫn, nút Thử lại, Xem đơn hàng và hotline, không còn một dòng chữ trơn', async () => {
    mocks.getBankQr.mockRejectedValue(new AxiosError('x', 'ERR_BAD_RESPONSE', undefined, undefined, { status: 503, statusText: '', headers: {}, config: {} as never, data: {} }));
    renderPage();
    expect(await screen.findByText('Chưa tải được thông tin thanh toán')).toBeInTheDocument();
    expect(screen.getByText('Máy chủ đang bận, thử lại nhé.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Thử lại' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Xem đơn hàng' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /Gọi 0984 606 774/ })).toBeInTheDocument();
    expect(screen.getByTestId('error-state-icon')).toBeInTheDocument();
  });

  it('mất mạng: nói thẳng "mất mạng" thay vì cùng câu với lỗi máy chủ', async () => {
    vi.stubGlobal('navigator', { ...navigator, onLine: false });
    mocks.getBankQr.mockRejectedValue(new AxiosError('Network Error', 'ERR_NETWORK'));
    renderPage();
    expect(await screen.findByText(/Có vẻ mất mạng/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Thử lại' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /Gọi 0984 606 774/ })).toBeInTheDocument();
  });

  it('Thử lại gọi lại máy chủ; Xem đơn hàng mở chi tiết đơn', async () => {
    mocks.getBankQr.mockRejectedValue(new Error('x'));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Thử lại' }));
    await waitFor(() => expect(mocks.getBankQr.mock.calls.length).toBeGreaterThanOrEqual(2));
    fireEvent.click(screen.getByRole('button', { name: 'Xem đơn hàng' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/order/TT001', { replace: true });
  });
});

describe('Thanh toán chuyển khoản: nút Kiểm tra khi phiên hết hạn (P3 miniapp-logic)', () => {
  const status = (s: number) =>
    new AxiosError('x', 'ERR_BAD_REQUEST', undefined, undefined, { status: s, statusText: '', headers: {}, config: {} as never, data: { message: 'Unauthorized' } });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getBankQr.mockReset();
  });

  it.each([[401], [403]])('gặp %i: báo phiên đăng nhập hết hạn và mời đăng nhập lại, không báo mất mạng', async (code) => {
    mocks.getBankQr.mockResolvedValueOnce(QR).mockRejectedValue(status(code));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Tôi đã chuyển khoản/ }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledTimes(1));
    const arg = mocks.openSnackbar.mock.calls[0]![0] as { text: string; type: string };
    expect(arg.type).toBe('error');
    expect(arg.text).toMatch(/phiên đăng nhập/i);
    expect(arg.text).toMatch(/đăng nhập lại/i);
    expect(arg.text).not.toMatch(/kết nối/i);
    expect(screen.getByAltText('VietQR')).toBeInTheDocument();
  });
});
