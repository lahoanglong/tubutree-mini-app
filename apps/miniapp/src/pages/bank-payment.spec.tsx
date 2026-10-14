import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  openSnackbar: vi.fn(),
  getBankQr: vi.fn(),
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  useParams: () => ({ code: 'TT001' }),
  useNavigate: () => mocks.navigate,
  useLocation: () => ({ pathname: '/bank-payment/TT001', search: '', state: null }),
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../services/payment-api', () => ({ getBankQr: mocks.getBankQr }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

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
    await screen.findByText('Không tải được thông tin thanh toán.');
    expect(onlyH1().textContent).toBe('Thanh toán chuyển khoản');
  });
});

describe('Thanh toán chuyển khoản: hạn thanh toán (BUYERMINI-8)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('có hạn → nói rõ chuyển trước giờ nào và quá hạn đơn tự huỷ', async () => {
    mocks.getBankQr.mockResolvedValue({ ...QR, paymentDeadline: '2026-10-14T03:00:00.000Z' });
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

