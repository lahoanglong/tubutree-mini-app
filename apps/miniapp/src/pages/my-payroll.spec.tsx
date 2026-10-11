import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { formatVnd } from '../utils/format';

const mocks = vi.hoisted(() => ({
  getMyPayroll: vi.fn(),
  updateBank: vi.fn(),
  getHistory: vi.fn(),
  openSnackbar: vi.fn(),
  role: 'STAFF' as string,
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  Sheet: ({ visible, children }: { visible: boolean; children: ReactNode }) => (visible ? <div>{children}</div> : null),
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/my-payroll', search: '', state: null }),
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../services/payroll-api', () => ({ getMyPayroll: mocks.getMyPayroll, updateBank: mocks.updateBank }));
vi.mock('../services/attendance-api', () => ({ getHistory: mocks.getHistory }));
vi.mock('../services/api', () => ({ getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)) }));
vi.mock('../store/auth', () => ({
  useAuthStore: (sel: (s: { user: { role: string } }) => unknown) => sel({ user: { role: mocks.role } }),
}));
vi.mock('../components/image-upload', () => ({
  ImageUpload: ({ label, onChange }: { label: string; onChange: (url: string) => void }) => (
    <button type="button" onClick={() => onChange('https://img.test/qr.png')}>
      {label}
    </button>
  ),
}));

import MyPayrollPage from './my-payroll';

const PROFILE = {
  hourlyRate: 30000,
  bankBin: '970407',
  bankAccountNo: '0123456789',
  bankAccountName: 'NGUYEN VAN A',
  qrImageUrl: null,
  active: true,
};

const day = (id: string, date: string, workedMinutes: number, fines: number, net: number) => ({
  id,
  workDate: `${date}T00:00:00.000Z`,
  workedMinutes,
  hourlyRate: 30000,
  gross: net + fines,
  fines,
  net,
});

function payroll(year: number, month: number, over: Record<string, unknown> = {}) {
  return {
    month: {
      year,
      month,
      totalMinutes: 870,
      gross: 475000,
      totalFines: 20000,
      net: 415000,
      status: 'FINALIZED',
      paidAt: null,
      proofImageUrl: null,
      note: null,
      ...over,
    },
    days: [
      day('d1', '2026-03-02', 270, 0, 135000),
      day('d2', '2026-03-03', 480, 20000, 220000),
      day('d3', '2026-03-10', 120, 0, 60000),
    ],
    profile: PROFILE,
  };
}

// Phiên của ngày 02/03: vào 08:00 (trễ), ra 12:30 (giờ VN).
const SESSIONS = [
  { id: 's1', shiftId: 'sh1', checkinAt: '2026-03-02T01:00:00.000Z', checkoutAt: '2026-03-02T05:30:00.000Z', isLate: true, closeReason: null },
];

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MyPayrollPage />
    </QueryClientProvider>,
  );
}

describe('Lương của tôi theo DS v2 (C-076, C-114)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-03-15T05:00:00Z'));
    vi.clearAllMocks();
    mocks.role = 'STAFF';
    mocks.getMyPayroll.mockImplementation((year: number, month: number) => Promise.resolve(payroll(year, month)));
    mocks.getHistory.mockResolvedValue(SESSIONS);
    mocks.updateBank.mockResolvedValue(PROFILE);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('đúng một h1 "Lương của tôi" (đang tải, có dữ liệu), kể cả khi không phải nhân viên', async () => {
    mocks.getMyPayroll.mockReturnValue(new Promise(() => undefined));
    const loading = renderPage();
    expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual(['Lương của tôi']);
    expect(loading.container.querySelectorAll('.tubu-skeleton').length).toBeGreaterThan(0);
    loading.unmount();

    mocks.getMyPayroll.mockImplementation((y: number, m: number) => Promise.resolve(payroll(y, m)));
    const ok = renderPage();
    await screen.findByText('Thực nhận tháng 3/2026');
    expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual(['Lương của tôi']);
    ok.unmount();

    mocks.role = 'CUSTOMER';
    mocks.getMyPayroll.mockClear();
    renderPage();
    expect(screen.getByText('Trang dành cho nhân viên.')).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual(['Lương của tôi']);
    expect(mocks.getMyPayroll).not.toHaveBeenCalled();
  });

  it('hiện thực nhận, giờ công, đơn giá, lương gộp, phạt, trạng thái đúng như số máy chủ trả về', async () => {
    renderPage();
    expect(await screen.findByText('Thực nhận tháng 3/2026')).toBeInTheDocument();
    expect(screen.getByText(formatVnd(415000))).toBeInTheDocument();
    expect(screen.getByText('Giờ công: 14h30')).toBeInTheDocument();
    expect(screen.getByText(`Đơn giá: ${formatVnd(30000)}/h`)).toBeInTheDocument();
    expect(screen.getByText(`Lương gộp: ${formatVnd(475000)}`)).toBeInTheDocument();
    expect(screen.getByText(`Phạt: ${formatVnd(20000)}`)).toBeInTheDocument();
    expect(screen.getByText('Đã chốt')).toBeInTheDocument();
    expect(mocks.getMyPayroll).toHaveBeenCalledWith(2026, 3);
    // Biên theo GIỜ VN: 01/03 00:00 VN = 28/02 17:00Z; 01/04 00:00 VN = 31/03 17:00Z.
    expect(mocks.getHistory).toHaveBeenCalledWith('2026-02-28T17:00:00.000Z', '2026-03-31T17:00:00.000Z');
  });

  it('gom theo tuần T2–CN kèm tổng giờ và tiền; ngày có phạt hiện số phạt', async () => {
    renderPage();
    expect(await screen.findByText('Tuần 1 (02/03–08/03)')).toBeInTheDocument();
    expect(screen.getByText(`12h30 · ${formatVnd(355000)}`)).toBeInTheDocument();
    expect(screen.getByText('Tuần 2 (09/03–15/03)')).toBeInTheDocument();
    expect(screen.getByText(`2h00 · ${formatVnd(60000)}`)).toBeInTheDocument();
    expect(screen.getByText('T2 02 · 4h30')).toBeInTheDocument();
    expect(screen.getByText(`−${formatVnd(20000)} phạt`)).toBeInTheDocument();
  });

  it('bấm vào ngày xổ các phiên chấm công; ngày không có phiên báo không có phiên', async () => {
    renderPage();
    fireEvent.click(await screen.findByText('T2 02 · 4h30'));
    expect(await screen.findByText('08:00 → 12:30 · trễ')).toBeInTheDocument();
    fireEvent.click(screen.getByText('T3 03 · 8h00'));
    expect(await screen.findByText('Không có phiên chấm công.')).toBeInTheDocument();
    // Mở ngày khác thì ngày cũ gập lại.
    expect(screen.queryByText('08:00 → 12:30 · trễ')).not.toBeInTheDocument();
  });

  it('hàng ngày là nút thật (Tab/Enter), báo mở/gập bằng aria-expanded và cao >= 44px', async () => {
    renderPage();
    const row = await screen.findByRole('button', { name: /T2 02 · 4h30/ });
    expect(row).toHaveAttribute('aria-expanded', 'false');
    expect(row.style.minHeight).toBe('44px');
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(row).toHaveAttribute('aria-expanded', 'true');
    expect(await screen.findByText('08:00 → 12:30 · trễ')).toBeInTheDocument();
    fireEvent.click(row);
    expect(row).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('08:00 → 12:30 · trễ')).not.toBeInTheDocument();
  });

  it('nút chuyển tháng có tên, cao >= 44px và đổi đúng tháng truy vấn', async () => {
    renderPage();
    await screen.findByText('Thực nhận tháng 3/2026');
    const prev = screen.getByRole('button', { name: 'Tháng trước' });
    const next = screen.getByRole('button', { name: 'Tháng sau' });
    expect(prev.style.minHeight).toBe('44px');
    expect(next.style.minHeight).toBe('44px');
    fireEvent.click(prev);
    expect(await screen.findByText('Tháng 2/2026')).toBeInTheDocument();
    await waitFor(() => expect(mocks.getMyPayroll).toHaveBeenCalledWith(2026, 2));
    fireEvent.click(screen.getByRole('button', { name: 'Tháng sau' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tháng sau' }));
    expect(await screen.findByText('Tháng 4/2026')).toBeInTheDocument();
    await waitFor(() => expect(mocks.getMyPayroll).toHaveBeenCalledWith(2026, 4));
  });

  it('đã trả kèm ảnh xác nhận thì hiện ảnh; chưa trả thì không', async () => {
    mocks.getMyPayroll.mockImplementation((y: number, m: number) =>
      Promise.resolve(payroll(y, m, { status: 'PAID', proofImageUrl: 'https://img.test/proof.jpg' })),
    );
    const paid = renderPage();
    expect(await screen.findByAltText('Xác nhận chuyển khoản')).toHaveAttribute('src', 'https://img.test/proof.jpg');
    expect(screen.getByText('Ảnh xác nhận đã chuyển:')).toBeInTheDocument();
    paid.unmount();

    mocks.getMyPayroll.mockImplementation((y: number, m: number) =>
      Promise.resolve(payroll(y, m, { status: 'FINALIZED', proofImageUrl: 'https://img.test/proof.jpg' })),
    );
    renderPage();
    await screen.findByText('Thực nhận tháng 3/2026');
    expect(screen.queryByAltText('Xác nhận chuyển khoản')).not.toBeInTheDocument();
  });

  it('chưa có công thì báo trống; lỗi tải thì có Thử lại gọi lại API', async () => {
    mocks.getMyPayroll.mockImplementation((y: number, m: number) => Promise.resolve({ ...payroll(y, m), days: [] }));
    const empty = renderPage();
    expect(await screen.findByText('Chưa có dữ liệu công tháng này.')).toBeInTheDocument();
    empty.unmount();

    mocks.getMyPayroll.mockReset();
    mocks.getMyPayroll.mockRejectedValueOnce(new Error('Mất kết nối')).mockImplementation((y: number, m: number) => Promise.resolve(payroll(y, m)));
    renderPage();
    expect(await screen.findByText('Mất kết nối')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    await waitFor(() => expect(mocks.getMyPayroll).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Thực nhận tháng 3/2026')).toBeInTheDocument();
  });

  it('thông tin nhận lương: nạp sẵn hồ sơ ngân hàng, lưu gửi giá trị đã cắt khoảng trắng, báo thành công, đóng khung và tải lại', async () => {
    renderPage();
    await screen.findByText('Thực nhận tháng 3/2026');
    fireEvent.click(screen.getByRole('button', { name: 'Thông tin nhận lương' }));
    expect(screen.getByRole('heading', { level: 2, name: 'Thông tin nhận lương' })).toBeInTheDocument();
    fireEvent.change(screen.getByDisplayValue('970407'), { target: { value: ' 970436 ' } });
    expect(screen.getByDisplayValue('0123456789')).toBeInTheDocument();
    expect(screen.getByDisplayValue('NGUYEN VAN A')).toBeInTheDocument();
    mocks.getMyPayroll.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() =>
      expect(mocks.updateBank).toHaveBeenCalledWith({
        bankBin: '970436',
        bankAccountNo: '0123456789',
        bankAccountName: 'NGUYEN VAN A',
        qrImageUrl: undefined,
      }),
    );
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã lưu thông tin nhận lương.', type: 'success' }));
    await waitFor(() => expect(screen.queryByDisplayValue('970407')).not.toBeInTheDocument());
    await waitFor(() => expect(mocks.getMyPayroll).toHaveBeenCalled());
  });

  it('thông tin nhận lương: ô nhập có nhãn gắn với ô và ảnh QR đi kèm khi lưu', async () => {
    renderPage();
    await screen.findByText('Thực nhận tháng 3/2026');
    fireEvent.click(screen.getByRole('button', { name: 'Thông tin nhận lương' }));
    expect(screen.getByLabelText('Mã ngân hàng (BIN Napas, VD 970407)')).toHaveValue('970407');
    expect(screen.getByLabelText('Số tài khoản')).toHaveValue('0123456789');
    expect(screen.getByLabelText('Tên chủ tài khoản')).toHaveValue('NGUYEN VAN A');
    fireEvent.click(screen.getByRole('button', { name: 'QR nhận lương' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() =>
      expect(mocks.updateBank).toHaveBeenCalledWith(expect.objectContaining({ qrImageUrl: 'https://img.test/qr.png' })),
    );
  });

  it('lưu lỗi: báo lỗi và giữ khung để nhập lại', async () => {
    mocks.updateBank.mockRejectedValue(new Error('Máy chủ bận'));
    renderPage();
    await screen.findByText('Thực nhận tháng 3/2026');
    fireEvent.click(screen.getByRole('button', { name: 'Thông tin nhận lương' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Máy chủ bận', type: 'error' }));
    expect(screen.getByDisplayValue('970407')).toBeInTheDocument();
  });

  it('đổi tháng đang tải mà mở thông tin nhận lương: vẫn nạp hồ sơ ngân hàng đã có, không để ô rỗng', async () => {
    renderPage();
    await screen.findByText('Thực nhận tháng 3/2026');
    mocks.getMyPayroll.mockReturnValue(new Promise(() => undefined));
    fireEvent.click(screen.getByRole('button', { name: 'Tháng trước' }));
    await screen.findByText('Tháng 2/2026');
    fireEvent.click(screen.getByRole('button', { name: 'Thông tin nhận lương' }));
    expect(screen.getByDisplayValue('970407')).toBeInTheDocument();
    expect(screen.getByDisplayValue('0123456789')).toBeInTheDocument();
    expect(screen.getByDisplayValue('NGUYEN VAN A')).toBeInTheDocument();
  });
});
