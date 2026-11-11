import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach, type MockInstance } from 'vitest';
import { formatVnd } from '../utils/format';
import { vi as t } from '../i18n/vi';
import { HttpError } from '../services/http';
import { LOCK_REFRESH_WAIT_MS } from '../utils/settle-within';

const mocks = vi.hoisted(() => ({
  getMyPayroll: vi.fn(),
  updateBank: vi.fn(),
  getHistory: vi.fn(),
  openSnackbar: vi.fn(),
  navigate: vi.fn(),
  role: 'STAFF' as string,
  // Ô ảnh giả ghi lại props lần vẽ gần nhất: test tự báo "đang tải"/"tải xong" như ô thật.
  picker: { onChange: (_url: string): void => undefined, onBusyChange: (_busy: boolean): void => undefined, disabled: false },
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  Sheet: ({ visible, children }: { visible: boolean; children: ReactNode }) => (visible ? <div>{children}</div> : null),
  useNavigate: () => mocks.navigate,
  useLocation: () => ({ pathname: '/my-payroll', search: '', state: null }),
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../services/payroll-api', () => ({ getMyPayroll: mocks.getMyPayroll, updateBank: mocks.updateBank }));
vi.mock('../services/attendance-api', () => ({ getHistory: mocks.getHistory }));
vi.mock('../services/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
  getLoadErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));
vi.mock('../store/auth', () => ({
  useAuthStore: (sel: (s: { user: { role: string } }) => unknown) => sel({ user: { role: mocks.role } }),
}));
vi.mock('../components/image-upload', () => ({
  ImageUpload: ({ label, onChange, onBusyChange, disabled }: { label: string; onChange: (url: string) => void; onBusyChange?: (busy: boolean) => void; disabled?: boolean }) => {
    mocks.picker = { onChange, onBusyChange: onBusyChange ?? (() => undefined), disabled: Boolean(disabled) };
    return (
      <button type="button" disabled={disabled} onClick={() => onChange('https://img.test/qr.png')}>
        {label}
      </button>
    );
  },
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
  // Trong một worker jsdom, lần dựng và truy vấn đầu tiên (khởi động lạnh) tốn hàng trăm ms và chạy ngay trong lần gọi đầu của lệnh chờ,
  // ăn mất ngân sách 1 giây của nó: ca đầu file rớt ngẫu nhiên khi máy bận. Chạy trước một vòng ở đây để chi phí rơi vào hook; hạn 8 giây
  // chỉ để vòng khởi động này không tự rớt, không nới lệnh chờ của ca nào.
  beforeAll(async () => {
    mocks.getMyPayroll.mockImplementation((year: number, month: number) => Promise.resolve(payroll(year, month)));
    mocks.getHistory.mockResolvedValue(SESSIONS);
    const { unmount } = renderPage();
    await screen.findByText(/^Thực nhận tháng/, undefined, { timeout: 8000 });
    unmount();
  }, 20_000);

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
    expect(screen.getByText('Trang dành cho nhân viên')).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual(['Lương của tôi']);
    expect(mocks.getMyPayroll).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Về Cá nhân' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/profile');
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
      Promise.resolve(payroll(y, m, { status: 'PAID', proofImageUrl: 'https://res.cloudinary.com/t/proof.jpg' })),
    );
    const paid = renderPage();
    expect(await screen.findByAltText('Xác nhận chuyển khoản')).toHaveAttribute('src', 'https://res.cloudinary.com/t/proof.jpg');
    expect(screen.getByText('Ảnh xác nhận đã chuyển:')).toBeInTheDocument();
    paid.unmount();

    mocks.getMyPayroll.mockImplementation((y: number, m: number) =>
      Promise.resolve(payroll(y, m, { status: 'FINALIZED', proofImageUrl: 'https://res.cloudinary.com/t/proof.jpg' })),
    );
    renderPage();
    await screen.findByText('Thực nhận tháng 3/2026');
    expect(screen.queryByAltText('Xác nhận chuyển khoản')).not.toBeInTheDocument();
  });

  it('ảnh xác nhận là javascript:, http:// lạ hay svg thì không đổ vào img', async () => {
    for (const bad of ['javascript:alert(1)', 'http://evil.example/p.jpg', 'data:image/svg+xml;base64,PHN2Zz4=']) {
      mocks.getMyPayroll.mockImplementation((y: number, m: number) => Promise.resolve(payroll(y, m, { status: 'PAID', proofImageUrl: bad })));
      const r = renderPage();
      await screen.findByText('Thực nhận tháng 3/2026');
      expect(screen.queryByAltText('Xác nhận chuyển khoản')).not.toBeInTheDocument();
      r.unmount();
    }
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
    expect(screen.getByLabelText('Mã số ngân hàng (6 chữ số, VD 970407; chưa biết thì tải ảnh QR ở dưới)')).toHaveValue('970407');
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

describe('Lương của tôi: "Lưu" thông tin nhận lương khoá chạm đúp (W76A)', () => {
  const deferred = () => {
    let resolve!: (v: unknown) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
  const openBankSheet = async () => {
    await screen.findByText('Thực nhận tháng 3/2026');
    fireEvent.click(screen.getByRole('button', { name: 'Thông tin nhận lương' }));
    return screen.getByRole('button', { name: 'Lưu' });
  };

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

  it('chạm đúp "Lưu" trong cùng một khung hình chỉ lưu một lần và báo thành công một lần', async () => {
    const d = deferred();
    mocks.updateBank.mockReturnValueOnce(d.promise);
    renderPage();
    const save = await openBankSheet();
    await act(async () => {
      fireEvent.click(save);
      fireEvent.click(save);
    });
    expect(mocks.updateBank).toHaveBeenCalledTimes(1);
    await act(async () => d.resolve(PROFILE));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã lưu thông tin nhận lương.', type: 'success' }));
    expect(mocks.updateBank).toHaveBeenCalledTimes(1);
    expect(mocks.openSnackbar.mock.calls.filter(([a]) => (a as { type: string }).type === 'success')).toHaveLength(1);
  });

  it('đang lưu: nút aria-busy mà không bị disabled (giữ focus)', async () => {
    const d = deferred();
    mocks.updateBank.mockReturnValueOnce(d.promise);
    renderPage();
    const save = await openBankSheet();
    save.focus();
    fireEvent.click(save);
    await waitFor(() => expect(save).toHaveAttribute('aria-busy', 'true'));
    expect(save).not.toBeDisabled();
    expect(save).toHaveFocus();
    await act(async () => d.resolve(PROFILE));
  });

  it('lưu lỗi thì nhả khoá, bấm lại gọi lần hai', async () => {
    mocks.updateBank.mockRejectedValueOnce(new Error('Máy chủ bận')).mockResolvedValue(PROFILE);
    renderPage();
    const save = await openBankSheet();
    fireEvent.click(save);
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Máy chủ bận', type: 'error' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(mocks.updateBank).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã lưu thông tin nhận lương.', type: 'success' }));
  });
});

describe('Lương của tôi: ảnh QR còn đang lên thì "Lưu" chờ (W90A)', () => {
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
  const openBankSheet = async () => {
    renderPage();
    await screen.findByText('Thực nhận tháng 3/2026');
    fireEvent.click(screen.getByRole('button', { name: 'Thông tin nhận lương' }));
    await screen.findByRole('button', { name: 'QR nhận lương' });
  };

  it('đang tải QR: nút Lưu khoá + đổi nhãn, bấm không gọi updateBank; tải xong thì lưu kèm QR mới', async () => {
    await openBankSheet();
    act(() => mocks.picker.onBusyChange(true));
    const waiting = screen.getByRole('button', { name: t.common.imagesUploading });
    expect(waiting).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Lưu' })).toBeNull();
    fireEvent.click(waiting);
    await new Promise((r) => setTimeout(r, 30));
    expect(mocks.updateBank).not.toHaveBeenCalled();

    act(() => {
      mocks.picker.onChange('https://img.test/qr-moi.png');
      mocks.picker.onBusyChange(false);
    });
    const save = await screen.findByRole('button', { name: 'Lưu' });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(mocks.updateBank).toHaveBeenCalledTimes(1));
    expect(mocks.updateBank).toHaveBeenCalledWith(expect.objectContaining({ qrImageUrl: 'https://img.test/qr-moi.png' }));
  });

  it('QR còn đang lên: tấm không đóng được (mất nút Đóng, Esc không đóng); xong thì đóng được', async () => {
    await openBankSheet();
    expect(screen.getByRole('button', { name: 'Đóng' })).toBeInTheDocument();

    act(() => mocks.picker.onBusyChange(true));
    expect(screen.queryByRole('button', { name: 'Đóng' })).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'QR nhận lương' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t.common.imagesUploading })).toBeDisabled();

    // Xong lượt tải thì Esc đóng được: chứng tỏ Esc ở trên bị chặn vì khoá chứ không phải vì test không bắt được phím.
    act(() => mocks.picker.onBusyChange(false));
    expect(await screen.findByRole('button', { name: 'Đóng' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'QR nhận lương' })).toBeNull());
  });

  it('đang lưu thì ô ảnh khoá: đổi QR lúc này không vào bản đang gửi', async () => {
    let release!: (v: unknown) => void;
    mocks.updateBank.mockReturnValueOnce(new Promise((r) => (release = r)));
    await openBankSheet();
    expect(screen.getByRole('button', { name: 'QR nhận lương' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(mocks.updateBank).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('button', { name: 'QR nhận lương' })).toBeDisabled());
    await act(async () => release(PROFILE));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'QR nhận lương' })).toBeNull());
  });
});

// W112A: lưu thông tin nhận lương bị máy chủ từ chối vì hồ sơ nhân viên đã đổi (400/404/409) thì nút Lưu giữ khoá tới khi dữ liệu làm mới về (tối đa LOCK_REFRESH_WAIT_MS), kẻo bấm lại trên bản cũ nhận đúng lỗi đó. Mất mạng, quá hạn, 401, 5xx không nói gì về hồ sơ: không tải lại, nhả ngay.
describe('Lương của tôi: máy chủ từ chối thì giữ khoá tới khi dữ liệu làm mới về (W112A)', () => {
  type Refresh = () => Promise<unknown>;
  type Opened = { invalidate: MockInstance<QueryClient['invalidateQueries']>; button: () => HTMLElement };
  type Case = {
    name: string;
    /** Lệnh ghi bị giả lập. */
    write: ReturnType<typeof vi.fn>;
    /** Khoá tải lại kỳ vọng khi máy chủ từ chối, đúng thứ tự gọi. */
    keys: string[][];
    open: (refresh: Refresh) => Promise<Opened>;
  };

  const deferred = () => {
    let resolve!: (v?: unknown) => void;
    const promise = new Promise((res) => {
      resolve = res;
    });
    return { promise, resolve };
  };
  const serverError = (message: string, status: number) => new HttpError(message, undefined, { status, data: { message }, headers: {} });
  const errorSnackbars = () => mocks.openSnackbar.mock.calls.filter((c) => c[0].type === 'error').length;
  // TanStack báo cache qua setTimeout(0): đợi một nhịp để `isPending` kịp về false sau khi lệnh xong.
  const settle = () =>
    act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
  /** Dựng trang và thay `invalidateQueries` để soi khoá tải lại và giữ lời hứa tải lại trong tay. */
  const renderLive = (refresh: Refresh) => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const invalidate = vi.spyOn(qc, 'invalidateQueries').mockImplementation((() => refresh()) as never);
    render(
      <QueryClientProvider client={qc}>
        <MyPayrollPage />
      </QueryClientProvider>,
    );
    return invalidate;
  };

  const CASES: Case[] = [
    {
      name: 'lưu thông tin nhận lương (bankM)',
      write: mocks.updateBank,
      keys: [['my-payroll']],
      open: async (refresh) => {
        const invalidate = renderLive(refresh);
        await screen.findByText('Thực nhận tháng 3/2026');
        fireEvent.click(screen.getByRole('button', { name: 'Thông tin nhận lương' }));
        return {
          invalidate,
          // W114A/W115A: tấm đóng khi dữ liệu mới về (404/409), cùng lúc khoá nhả; mở lại tấm nếu đã đóng thì mới lấy được nút Lưu.
          button: () => {
            if (!screen.queryByRole('button', { name: 'Lưu' })) fireEvent.click(screen.getByRole('button', { name: 'Thông tin nhận lương' }));
            return screen.getByRole('button', { name: 'Lưu' });
          },
        };
      },
    },
  ];

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-03-15T05:00:00Z'));
    vi.clearAllMocks();
    mocks.role = 'STAFF';
    mocks.getMyPayroll.mockImplementation((year: number, month: number) => Promise.resolve(payroll(year, month)));
    mocks.getHistory.mockResolvedValue(SESSIONS);
    mocks.updateBank.mockReset();
    mocks.updateBank.mockResolvedValue(PROFILE);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe.each(CASES)('$name', (c) => {
    it.each([
      [400, 'Hồ sơ nhân viên không còn hợp lệ'],
      [404, 'Không tìm thấy hồ sơ nhân viên'],
      [409, 'Vừa có thay đổi, bạn thử lại nhé'],
    ])('bị từ chối %i: báo lỗi một lần, tải lại đúng khoá, nút giữ khoá tới khi dữ liệu về rồi mới nhả', async (status, message) => {
      c.write.mockReset();
      c.write.mockRejectedValueOnce(serverError(message, status)).mockResolvedValue(PROFILE);
      const refresh = deferred();
      const { invalidate, button } = await c.open(() => refresh.promise);
      fireEvent.click(button());
      await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: message, type: 'error' }));
      expect(errorSnackbars()).toBe(1);
      expect(invalidate.mock.calls.map(([filter]) => filter)).toEqual(c.keys.map((queryKey) => ({ queryKey })));
      // Đã có lời báo lỗi mà dữ liệu chưa về: nút vẫn bận, chạm thêm không gửi lần hai.
      expect(button()).toHaveAttribute('aria-busy', 'true');
      await act(async () => {
        fireEvent.click(button());
        fireEvent.click(button());
      });
      expect(c.write).toHaveBeenCalledTimes(1);
      await act(async () => refresh.resolve());
      await settle();
      await waitFor(() => expect(button()).not.toHaveAttribute('aria-busy'));
      expect(errorSnackbars()).toBe(1);
      fireEvent.click(button());
      await waitFor(() => expect(c.write).toHaveBeenCalledTimes(2));
      // Gửi lại đúng thứ đã gửi lần đầu: không đổi nội dung, không thêm trường.
      expect(c.write.mock.calls[1]).toEqual(c.write.mock.calls[0]);
    });

    it.each([
      ['mất mạng', new HttpError('Network Error', 'ERR_NETWORK')],
      ['hết thời gian', new HttpError('timeout', 'ECONNABORTED')],
      ['máy chủ lỗi 503', serverError('Service Unavailable', 503)],
      ['hết phiên 401', serverError('Unauthorized', 401)],
    ])('%s: không giữ khoá chờ tải lại, khoá nhả ngay', async (_label, error) => {
      c.write.mockReset();
      c.write.mockRejectedValueOnce(error).mockResolvedValue(PROFILE);
      const { invalidate, button } = await c.open(() => new Promise(() => undefined));
      fireEvent.click(button());
      await waitFor(() => expect(errorSnackbars()).toBe(1));
      await waitFor(() => expect(button()).not.toHaveAttribute('aria-busy'));
      expect(invalidate).not.toHaveBeenCalled();
      fireEvent.click(button());
      await waitFor(() => expect(c.write).toHaveBeenCalledTimes(2));
      expect(c.write.mock.calls[1]).toEqual(c.write.mock.calls[0]);
    });

    it('tải lại treo mãi: khoá nhả đúng sau LOCK_REFRESH_WAIT_MS', async () => {
      c.write.mockReset();
      c.write.mockRejectedValueOnce(serverError('Vừa có thay đổi, bạn thử lại nhé', 409)).mockResolvedValue(PROFILE);
      const { button } = await c.open(() => new Promise(() => undefined));
      // beforeEach chỉ giả Date; muốn giả cả setTimeout phải bỏ bản cũ rồi dựng lại (trang đã tính tháng xong nên Date thật không ảnh hưởng).
      vi.useRealTimers();
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        fireEvent.click(button());
        await waitFor(() => expect(errorSnackbars()).toBe(1));
        await act(async () => {
          await vi.advanceTimersByTimeAsync(LOCK_REFRESH_WAIT_MS - 500);
        });
        expect(button()).toHaveAttribute('aria-busy', 'true');
        await act(async () => {
          await vi.advanceTimersByTimeAsync(600);
        });
        await waitFor(() => expect(button()).not.toHaveAttribute('aria-busy'));
      } finally {
        vi.useRealTimers();
      }
      fireEvent.click(button());
      await waitFor(() => expect(c.write).toHaveBeenCalledTimes(2));
    });
  });
});

// W114A: tấm "Thông tin nhận lương" có ô nhập nên chỉ đóng khi hồ sơ nhân viên không còn hoặc vừa đổi (404/409); 400/422 là lỗi ở chính ô nhập, giữ tấm kèm giá trị đã gõ. Khoá chạm giữ như W112A: 400/404/409 chờ dữ liệu về, 422 và lỗi tạm nhả ngay. Đích luôn là hồ sơ của chính người đang đăng nhập, nhưng khách đóng tấm rồi mở lại lúc lệnh còn bay thì lệnh trễ không được đóng lần mở mới.
describe('Lương của tôi: tấm nhận lương đóng khi hồ sơ không còn (W114A)', () => {
  const deferred = () => {
    let resolve!: (v?: unknown) => void;
    const promise = new Promise((res) => {
      resolve = res;
    });
    return { promise, resolve };
  };
  const serverError = (message: string, status: number) => new HttpError(message, undefined, { status, data: { message }, headers: {} });
  const errorSnackbars = () => mocks.openSnackbar.mock.calls.filter((c) => c[0].type === 'error').length;
  const settle = () =>
    act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
  const sendBtn = () => screen.queryByRole('button', { name: 'Lưu' });
  const isOpen = () => sendBtn() !== null;
  const openSheet = () => fireEvent.click(screen.getByRole('button', { name: 'Thông tin nhận lương' }));
  const accountInput = () => screen.getByLabelText('Số tài khoản');
  const renderLive = (refresh: () => Promise<unknown>) => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const invalidate = vi.spyOn(qc, 'invalidateQueries').mockImplementation((() => refresh()) as never);
    render(
      <QueryClientProvider client={qc}>
        <MyPayrollPage />
      </QueryClientProvider>,
    );
    return invalidate;
  };
  const open = async (refresh: () => Promise<unknown>) => {
    const invalidate = renderLive(refresh);
    await screen.findByText('Thực nhận tháng 3/2026');
    openSheet();
    fireEvent.change(accountInput(), { target: { value: '9998887776' } });
    return invalidate;
  };
  const tap = () => {
    const send = sendBtn();
    if (send) fireEvent.click(send);
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-03-15T05:00:00Z'));
    vi.clearAllMocks();
    mocks.role = 'STAFF';
    mocks.getMyPayroll.mockImplementation((year: number, month: number) => Promise.resolve(payroll(year, month)));
    mocks.getHistory.mockResolvedValue(SESSIONS);
    mocks.updateBank.mockReset();
    mocks.updateBank.mockResolvedValue(PROFILE);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    [404, 'Không tìm thấy hồ sơ nhân viên'],
    [409, 'Vừa có thay đổi, bạn thử lại nhé'],
  ])('bị từ chối %i: báo lỗi một lần, tải lại đúng khoá, tấm và khoá giữ tới khi dữ liệu về rồi mới đóng và nhả', async (status, message) => {
    mocks.updateBank.mockRejectedValueOnce(serverError(message, status)).mockResolvedValue(PROFILE);
    const refresh = deferred();
    const invalidate = await open(() => refresh.promise);
    tap();
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: message, type: 'error' }));
    expect(errorSnackbars()).toBe(1);
    expect(invalidate.mock.calls.map(([filter]) => filter)).toEqual([{ queryKey: ['my-payroll'] }]);
    // W115A: dữ liệu chưa về thì tấm còn mở, nút còn bận và bấm tiếp không gửi lần hai; tấm chỉ đóng sau khi dữ liệu về.
    await settle();
    expect(isOpen()).toBe(true);
    expect(screen.getByRole('button', { name: 'Lưu' })).toHaveAttribute('aria-busy', 'true');
    tap();
    await settle();
    expect(mocks.updateBank).toHaveBeenCalledTimes(1);
    await act(async () => refresh.resolve());
    await settle();
    await waitFor(() => expect(isOpen()).toBe(false));
    openSheet();
    expect(screen.getByRole('button', { name: 'Lưu' })).not.toHaveAttribute('aria-busy');
    expect(errorSnackbars()).toBe(1);
    tap();
    await waitFor(() => expect(mocks.updateBank).toHaveBeenCalledTimes(2));
  });

  it('lệnh lưu bị từ chối 404 trễ, trong lúc khách đã đóng tấm rồi mở lại và đang gõ: lần mở mới giữ nguyên, chữ đã gõ còn đó', async () => {
    let reject!: (e: unknown) => void;
    mocks.updateBank.mockReturnValueOnce(new Promise((_, rej) => { reject = rej; }));
    await open(() => Promise.resolve());
    tap();
    await waitFor(() => expect(mocks.updateBank).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
    await waitFor(() => expect(isOpen()).toBe(false));
    openSheet();
    expect(accountInput()).toHaveValue(PROFILE.bankAccountNo);
    fireEvent.change(accountInput(), { target: { value: '1112223334' } });
    await act(async () => reject(serverError('Không tìm thấy hồ sơ nhân viên', 404)));
    await waitFor(() => expect(errorSnackbars()).toBe(1));
    await settle();
    expect(isOpen()).toBe(true);
    expect(accountInput()).toHaveValue('1112223334');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Lưu' })).not.toHaveAttribute('aria-busy'));
    tap();
    await waitFor(() => expect(mocks.updateBank).toHaveBeenCalledTimes(2));
    expect(mocks.updateBank).toHaveBeenLastCalledWith(expect.objectContaining({ bankAccountNo: '1112223334' }));
  });

  it('bị từ chối 400: giữ tấm mở kèm giá trị đã gõ, khoá giữ tới khi dữ liệu về rồi mới nhả', async () => {
    mocks.updateBank.mockRejectedValueOnce(serverError('Số tài khoản không hợp lệ', 400)).mockResolvedValue(PROFILE);
    const refresh = deferred();
    const invalidate = await open(() => refresh.promise);
    tap();
    await waitFor(() => expect(errorSnackbars()).toBe(1));
    expect(invalidate).toHaveBeenCalledTimes(1);
    await settle();
    expect(isOpen()).toBe(true);
    expect(accountInput()).toHaveValue('9998887776');
    expect(screen.getByRole('button', { name: 'Lưu' })).toHaveAttribute('aria-busy', 'true');
    tap();
    await settle();
    expect(mocks.updateBank).toHaveBeenCalledTimes(1);
    await act(async () => refresh.resolve());
    await settle();
    expect(isOpen()).toBe(true);
    expect(accountInput()).toHaveValue('9998887776');
    tap();
    await waitFor(() => expect(mocks.updateBank).toHaveBeenCalledTimes(2));
  });

  it('bị từ chối 422: giữ tấm mở kèm giá trị đã gõ, không tải lại nên khoá nhả ngay', async () => {
    mocks.updateBank.mockRejectedValueOnce(serverError('Dữ liệu không hợp lệ', 422)).mockResolvedValue(PROFILE);
    const invalidate = await open(() => new Promise(() => undefined));
    tap();
    await waitFor(() => expect(errorSnackbars()).toBe(1));
    await settle();
    expect(invalidate).not.toHaveBeenCalled();
    expect(isOpen()).toBe(true);
    expect(accountInput()).toHaveValue('9998887776');
    tap();
    await waitFor(() => expect(mocks.updateBank).toHaveBeenCalledTimes(2));
  });

  it.each([
    ['mất mạng', new HttpError('Network Error', 'ERR_NETWORK')],
    ['hết thời gian', new HttpError('timeout', 'ECONNABORTED')],
    ['máy chủ lỗi 503', serverError('Service Unavailable', 503)],
    ['hết phiên 401', serverError('Unauthorized', 401)],
  ])('%s: giữ tấm mở kèm giá trị đã gõ, không tải lại, khoá nhả ngay để thử lại', async (_label, error) => {
    mocks.updateBank.mockRejectedValueOnce(error).mockResolvedValue(PROFILE);
    const invalidate = await open(() => new Promise(() => undefined));
    tap();
    await waitFor(() => expect(errorSnackbars()).toBe(1));
    await settle();
    expect(isOpen()).toBe(true);
    expect(accountInput()).toHaveValue('9998887776');
    expect(invalidate).not.toHaveBeenCalled();
    tap();
    await waitFor(() => expect(mocks.updateBank).toHaveBeenCalledTimes(2));
    expect(errorSnackbars()).toBe(1);
  });
});

// W115A: thứ tự thống nhất khi máy chủ từ chối lệnh lưu: lời báo → dữ liệu mới về (hoặc quá LOCK_REFRESH_WAIT_MS) → đóng tấm → nhả khoá. Tấm không đóng trước lúc dữ liệu về; lúc đóng phải còn là đúng lần mở đã gửi lệnh. 400/422 và lỗi tạm vẫn không đóng tấm.
describe('Lương của tôi: tấm nhận lương đóng sau khi dữ liệu mới về (W115A)', () => {
  const deferred = () => {
    let resolve!: (v?: unknown) => void;
    const promise = new Promise((res) => {
      resolve = res;
    });
    return { promise, resolve };
  };
  const serverError = (message: string, status: number) => new HttpError(message, undefined, { status, data: { message }, headers: {} });
  const errorSnackbars = () => mocks.openSnackbar.mock.calls.filter((c) => c[0].type === 'error').length;
  const settle = () =>
    act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
  const sendBtn = () => screen.queryByRole('button', { name: 'Lưu' });
  const isOpen = () => sendBtn() !== null;
  const openSheet = () => fireEvent.click(screen.getByRole('button', { name: 'Thông tin nhận lương' }));
  const accountInput = () => screen.getByLabelText('Số tài khoản');
  const open = async (refresh: () => Promise<unknown>) => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const invalidate = vi.spyOn(qc, 'invalidateQueries').mockImplementation((() => refresh()) as never);
    render(
      <QueryClientProvider client={qc}>
        <MyPayrollPage />
      </QueryClientProvider>,
    );
    await screen.findByText('Thực nhận tháng 3/2026');
    openSheet();
    fireEvent.change(accountInput(), { target: { value: '9998887776' } });
    return invalidate;
  };
  const tap = () => {
    const send = sendBtn();
    if (send) fireEvent.click(send);
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-03-15T05:00:00Z'));
    vi.clearAllMocks();
    mocks.role = 'STAFF';
    mocks.getMyPayroll.mockImplementation((year: number, month: number) => Promise.resolve(payroll(year, month)));
    mocks.getHistory.mockResolvedValue(SESSIONS);
    mocks.updateBank.mockReset();
    mocks.updateBank.mockResolvedValue(PROFILE);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    [404, 'Không tìm thấy hồ sơ nhân viên'],
    [409, 'Vừa có thay đổi, bạn thử lại nhé'],
  ])('bị từ chối %i: tấm còn mở và nút còn bận khi bảng lương chưa tải lại xong, đóng sau khi tải xong, rồi nhả khoá', async (status, message) => {
    mocks.updateBank.mockRejectedValueOnce(serverError(message, status)).mockResolvedValue(PROFILE);
    const refresh = deferred();
    const invalidate = await open(() => refresh.promise);
    tap();
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: message, type: 'error' }));
    await settle();
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(isOpen()).toBe(true);
    expect(accountInput()).toHaveValue('9998887776');
    expect(screen.getByRole('button', { name: 'Lưu' })).toHaveAttribute('aria-busy', 'true');
    tap();
    await settle();
    expect(mocks.updateBank).toHaveBeenCalledTimes(1);
    await act(async () => refresh.resolve());
    await settle();
    await waitFor(() => expect(isOpen()).toBe(false));
    expect(errorSnackbars()).toBe(1);
    expect(invalidate).toHaveBeenCalledTimes(1);
    // Khoá đã nhả: lần mở kế gửi lại được.
    openSheet();
    expect(screen.getByRole('button', { name: 'Lưu' })).not.toHaveAttribute('aria-busy');
    tap();
    await waitFor(() => expect(mocks.updateBank).toHaveBeenCalledTimes(2));
  });

  it('tải lại treo mãi: tấm đóng đúng sau LOCK_REFRESH_WAIT_MS, không sớm hơn', async () => {
    mocks.updateBank.mockRejectedValueOnce(serverError('Vừa có thay đổi, bạn thử lại nhé', 409)).mockResolvedValue(PROFILE);
    await open(() => new Promise(() => undefined));
    // beforeEach chỉ giả Date; muốn giả cả setTimeout phải bỏ bản cũ rồi dựng lại (trang đã tính tháng xong nên Date thật không ảnh hưởng).
    vi.useRealTimers();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      tap();
      await waitFor(() => expect(errorSnackbars()).toBe(1));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(LOCK_REFRESH_WAIT_MS - 500);
      });
      expect(isOpen()).toBe(true);
      expect(screen.getByRole('button', { name: 'Lưu' })).toHaveAttribute('aria-busy', 'true');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });
      await waitFor(() => expect(isOpen()).toBe(false));
    } finally {
      vi.useRealTimers();
    }
    openSheet();
    expect(screen.getByRole('button', { name: 'Lưu' })).not.toHaveAttribute('aria-busy');
    tap();
    await waitFor(() => expect(mocks.updateBank).toHaveBeenCalledTimes(2));
  });

  it('khách đóng tấm rồi mở lại và gõ tiếp trong lúc chờ dữ liệu về: tấm của lần mở mới không bị đóng, chữ đã gõ còn đó', async () => {
    mocks.updateBank.mockRejectedValueOnce(serverError('Không tìm thấy hồ sơ nhân viên', 404)).mockResolvedValue(PROFILE);
    const refresh = deferred();
    await open(() => refresh.promise);
    tap();
    await waitFor(() => expect(errorSnackbars()).toBe(1));
    await settle();
    expect(isOpen()).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
    await waitFor(() => expect(isOpen()).toBe(false));
    openSheet();
    fireEvent.change(accountInput(), { target: { value: '1112223334' } });
    await act(async () => refresh.resolve());
    await settle();
    expect(isOpen()).toBe(true);
    expect(accountInput()).toHaveValue('1112223334');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Lưu' })).not.toHaveAttribute('aria-busy'));
    tap();
    await waitFor(() => expect(mocks.updateBank).toHaveBeenCalledTimes(2));
    expect(mocks.updateBank).toHaveBeenLastCalledWith(expect.objectContaining({ bankAccountNo: '1112223334' }));
  });

  it.each([
    ['400 (lỗi ở ô nhập, có tải lại)', serverError('Số tài khoản không hợp lệ', 400), true],
    ['422 (lỗi ở ô nhập, không tải lại)', serverError('Dữ liệu không hợp lệ', 422), false],
    ['mất mạng', new HttpError('Network Error', 'ERR_NETWORK'), false],
    ['hết thời gian', new HttpError('timeout', 'ECONNABORTED'), false],
    ['hết phiên 401', serverError('Unauthorized', 401), false],
    ['máy chủ lỗi 503', serverError('Service Unavailable', 503), false],
  ])('%s: tấm giữ mở kèm giá trị đã gõ, kể cả sau khi dữ liệu về', async (_label, error, refetches) => {
    mocks.updateBank.mockRejectedValueOnce(error).mockResolvedValue(PROFILE);
    const refresh = deferred();
    const invalidate = await open(() => refresh.promise);
    tap();
    await waitFor(() => expect(errorSnackbars()).toBe(1));
    await settle();
    expect(invalidate).toHaveBeenCalledTimes(refetches ? 1 : 0);
    expect(isOpen()).toBe(true);
    await act(async () => refresh.resolve());
    await settle();
    expect(isOpen()).toBe(true);
    expect(accountInput()).toHaveValue('9998887776');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Lưu' })).not.toHaveAttribute('aria-busy'));
    tap();
    await waitFor(() => expect(mocks.updateBank).toHaveBeenCalledTimes(2));
  });
});

// W117A: hồ sơ nhân viên tải lại trong lúc tấm "Thông tin nhận lương" còn mở (máy chủ từ chối rồi tải lại, nơi khác đổi hồ sơ): ô khách CHƯA chạm đổi theo hồ sơ mới, ô khách ĐÃ sửa giữ chữ. Trước đây Lưu gửi lại giá trị cũ của ô chưa chạm và đè lên hồ sơ mới trên máy chủ.
describe('Lương của tôi: tấm nhận lương bám hồ sơ mới về, ô khách đã sửa giữ chữ (W117A)', () => {
  const D2 = { ...PROFILE, bankBin: '970436', bankAccountNo: '5555555555', bankAccountName: 'TRAN THI B', qrImageUrl: 'https://img.test/qr-d2.png' };
  const BIN_LABEL = 'Mã số ngân hàng (6 chữ số, VD 970407; chưa biết thì tải ảnh QR ở dưới)';
  const serverError = (message: string, status: number) => new HttpError(message, undefined, { status, data: { message }, headers: {} });
  const binInput = () => screen.getByLabelText(BIN_LABEL);
  const accountInput = () => screen.getByLabelText('Số tài khoản');
  const nameInput = () => screen.getByLabelText('Tên chủ tài khoản');
  const sheetOpen = () => screen.queryByRole('button', { name: 'Lưu' }) !== null;
  const openSheet = () => fireEvent.click(screen.getByRole('button', { name: 'Thông tin nhận lương' }));

  function renderWithClient() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MyPayrollPage />
      </QueryClientProvider>,
    );
    return qc;
  }
  /** Máy chủ trả hồ sơ mới ở lượt tải sau. */
  const serveD2 = () =>
    mocks.getMyPayroll.mockImplementation((year: number, month: number) => Promise.resolve({ ...payroll(year, month), profile: D2 }));
  const reload = (qc: QueryClient) =>
    act(async () => {
      await qc.invalidateQueries({ queryKey: ['my-payroll'] });
    });
  /** Mở tấm trên hồ sơ D1 và khách chỉ sửa ô số tài khoản. */
  async function openAndEditAccount() {
    const qc = renderWithClient();
    await screen.findByText('Thực nhận tháng 3/2026');
    openSheet();
    fireEvent.change(accountInput(), { target: { value: '9998887776' } });
    return qc;
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-03-15T05:00:00Z'));
    vi.clearAllMocks();
    mocks.role = 'STAFF';
    mocks.getMyPayroll.mockImplementation((year: number, month: number) => Promise.resolve(payroll(year, month)));
    mocks.getHistory.mockResolvedValue(SESSIONS);
    mocks.updateBank.mockReset();
    mocks.updateBank.mockResolvedValue(PROFILE);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('hồ sơ mới về lúc tấm đang mở: ô chưa chạm (mã ngân hàng, tên chủ tài khoản) đổi theo, ô khách đã sửa (số tài khoản) giữ chữ', async () => {
    const qc = await openAndEditAccount();
    expect(binInput()).toHaveValue('970407');
    serveD2();
    await reload(qc);
    await waitFor(() => expect(binInput()).toHaveValue('970436'));
    expect(nameInput()).toHaveValue('TRAN THI B');
    expect(accountInput()).toHaveValue('9998887776');
    expect(sheetOpen()).toBe(true);
  });

  it('Lưu sau khi hồ sơ mới về gửi giá trị MỚI của ô chưa chạm (kể cả ảnh QR) cùng chữ khách đã sửa, không gửi lại giá trị cũ', async () => {
    const qc = await openAndEditAccount();
    serveD2();
    await reload(qc);
    await waitFor(() => expect(binInput()).toHaveValue('970436'));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(mocks.updateBank).toHaveBeenCalledTimes(1));
    expect(mocks.updateBank).toHaveBeenCalledWith({
      bankBin: '970436',
      bankAccountNo: '9998887776',
      bankAccountName: 'TRAN THI B',
      qrImageUrl: 'https://img.test/qr-d2.png',
    });
  });

  it('ảnh QR khách đã đổi giữ nguyên khi hồ sơ mới về (kèm QR khác), các ô chưa chạm vẫn đổi theo', async () => {
    const qc = renderWithClient();
    await screen.findByText('Thực nhận tháng 3/2026');
    openSheet();
    fireEvent.click(screen.getByRole('button', { name: 'QR nhận lương' }));
    serveD2();
    await reload(qc);
    await waitFor(() => expect(binInput()).toHaveValue('970436'));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(mocks.updateBank).toHaveBeenCalledTimes(1));
    expect(mocks.updateBank).toHaveBeenCalledWith({
      bankBin: '970436',
      bankAccountNo: '5555555555',
      bankAccountName: 'TRAN THI B',
      qrImageUrl: 'https://img.test/qr.png',
    });
  });

  it('bị từ chối 400 giữ tấm mở: bảng lương tải lại về hồ sơ mới, ô chưa chạm đổi theo, ô khách đã sửa giữ chữ, Lưu lại gửi bản mới', async () => {
    mocks.updateBank.mockRejectedValueOnce(serverError('Số tài khoản không hợp lệ', 400)).mockResolvedValue(PROFILE);
    await openAndEditAccount();
    // Máy chủ đã đổi hồ sơ ở nơi khác: lượt tải lại sau khi bị từ chối trả bản mới.
    serveD2();
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Số tài khoản không hợp lệ', type: 'error' }));
    await waitFor(() => expect(binInput()).toHaveValue('970436'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Lưu' })).not.toHaveAttribute('aria-busy'));
    expect(sheetOpen()).toBe(true);
    expect(nameInput()).toHaveValue('TRAN THI B');
    expect(accountInput()).toHaveValue('9998887776');
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(mocks.updateBank).toHaveBeenCalledTimes(2));
    expect(mocks.updateBank).toHaveBeenLastCalledWith({
      bankBin: '970436',
      bankAccountNo: '9998887776',
      bankAccountName: 'TRAN THI B',
      qrImageUrl: 'https://img.test/qr-d2.png',
    });
  });

  it('đóng rồi mở lại: nạp lại từ hồ sơ hiện tại, bỏ chữ đã sửa của lần trước', async () => {
    const qc = await openAndEditAccount();
    fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
    await waitFor(() => expect(sheetOpen()).toBe(false));
    serveD2();
    await reload(qc);
    openSheet();
    expect(binInput()).toHaveValue('970436');
    expect(accountInput()).toHaveValue('5555555555');
    expect(nameInput()).toHaveValue('TRAN THI B');
  });
});
