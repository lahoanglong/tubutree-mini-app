import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { formatVnd } from '../utils/format';
import { vi as t } from '../i18n/vi';
import { HttpError } from '../services/http';
import { LOCK_REFRESH_WAIT_MS } from '../utils/settle-within';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  openSnackbar: vi.fn(),
  role: 'ADMIN' as string,
  meId: 'me-not-listed' as string,
  listStaff: vi.fn(),
  grantStaff: vi.fn(),
  revokeStaff: vi.fn(),
  getShiftsPendingCount: vi.fn(),
  adminGetShifts: vi.fn(),
  approveShift: vi.fn(),
  rejectShift: vi.fn(),
  bulkApproveShifts: vi.fn(),
  adminGetTemplates: vi.fn(),
  createTemplate: vi.fn(),
  deleteTemplate: vi.fn(),
  adminGetPayroll: vi.fn(),
  adminGetDetail: vi.fn(),
  setRate: vi.fn(),
  finalizePayroll: vi.fn(),
  reopenPayroll: vi.fn(),
  markPaid: vi.fn(),
  adminEditSession: vi.fn(),
  // Ô ảnh giả ghi lại props lần vẽ gần nhất: test tự báo "đang tải"/"tải xong" như ô thật.
  picker: { onChange: (_url: string): void => undefined, onBusyChange: (_busy: boolean): void => undefined, disabled: false },
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  Sheet: ({ visible, children }: { visible: boolean; children: ReactNode }) => (visible ? <div>{children}</div> : null),
  useNavigate: () => mocks.navigate,
  useLocation: () => ({ pathname: '/admin', search: '', state: null }),
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../services/staff-api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  listStaff: mocks.listStaff,
  grantStaff: mocks.grantStaff,
  revokeStaff: mocks.revokeStaff,
  getShiftsPendingCount: mocks.getShiftsPendingCount,
}));
vi.mock('../services/shifts-api', () => ({
  adminGetShifts: mocks.adminGetShifts,
  approveShift: mocks.approveShift,
  rejectShift: mocks.rejectShift,
  bulkApproveShifts: mocks.bulkApproveShifts,
  adminGetTemplates: mocks.adminGetTemplates,
  createTemplate: mocks.createTemplate,
  deleteTemplate: mocks.deleteTemplate,
}));
vi.mock('../services/payroll-api', () => ({
  adminGetPayroll: mocks.adminGetPayroll,
  adminGetDetail: mocks.adminGetDetail,
  setRate: mocks.setRate,
  finalizePayroll: mocks.finalizePayroll,
  reopenPayroll: mocks.reopenPayroll,
  markPaid: mocks.markPaid,
}));
vi.mock('../services/attendance-api', () => ({ adminEditSession: mocks.adminEditSession }));
vi.mock('./admin-catalog-quality', () => ({ default: () => <div data-testid="catalog-section">Phần catalog</div> }));
vi.mock('../services/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
  getLoadErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));
vi.mock('../store/auth', () => ({
  useAuthStore: (sel: (s: { user: { role: string; id: string } }) => unknown) => sel({ user: { role: mocks.role, id: mocks.meId } }),
}));
vi.mock('../components/image-upload', () => ({
  ImageUpload: ({ label, onChange, onBusyChange, disabled }: { label: string; onChange: (url: string) => void; onBusyChange?: (busy: boolean) => void; disabled?: boolean }) => {
    mocks.picker = { onChange, onBusyChange: onBusyChange ?? (() => undefined), disabled: Boolean(disabled) };
    return (
      <button type="button" disabled={disabled} onClick={() => onChange('https://img.test/proof.png')}>
        {label}
      </button>
    );
  },
}));

import AdminPage from './admin';

// 11/03/2026 12:00 giờ VN: tháng 3/2026, tuần 09/03–15/03.
const NOW = '2026-03-11T05:00:00Z';
const vn = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00+07:00`).toISOString();

const MEMBERS = [
  { id: 'u1', phone: '0901234567', fullName: 'Lan', avatarUrl: null, role: 'STAFF', staffPermissions: ['KHO', 'KE_TOAN'], createdAt: '2026-01-01T00:00:00Z' },
  { id: 'u2', phone: '0912345678', fullName: null, avatarUrl: null, role: 'ADMIN', staffPermissions: [], createdAt: '2026-01-01T00:00:00Z' },
  { id: 'u3', phone: null, fullName: 'Chưa có số', avatarUrl: null, role: 'STAFF', staffPermissions: [], createdAt: '2026-01-01T00:00:00Z' },
];
const INVITES = [{ phone: '0987654321', role: 'STAFF', staffPermissions: ['CSKH'], createdAt: '2026-02-01T00:00:00Z' }];

const shift = (id: string, day: string, status: string, who: { id: string; name: string | null; phone: string | null }, over: Record<string, unknown> = {}) => ({
  id,
  staffId: who.id,
  workDate: `${day}T00:00:00.000Z`,
  startAt: vn(day, '08:00'),
  endAt: vn(day, '12:00'),
  templateId: null,
  status,
  approvedStart: null,
  approvedEnd: null,
  rejectReason: null,
  cancelReason: null,
  isEmergency: false,
  evidenceUrl: null,
  cancelPenalty: false,
  staff: { id: who.id, fullName: who.name, phone: who.phone, avatarUrl: null },
  ...over,
});
const LAN = { id: 'u1', name: 'Lan', phone: '0901234567' };
const NO_NAME = { id: 'u2', name: null, phone: '0912345678' };
const SHIFTS = [
  shift('s1', '2026-03-10', 'PENDING', LAN),
  shift('s2', '2026-03-11', 'PENDING', LAN),
  shift('s3', '2026-03-12', 'APPROVED', NO_NAME, { approvedStart: vn('2026-03-12', '09:00'), approvedEnd: vn('2026-03-12', '13:00') }),
  shift('s4', '2026-03-13', 'REJECTED', NO_NAME),
  shift('s5', '2026-03-14', 'CANCELLED', NO_NAME),
];

const month = (status: string, over: Record<string, unknown> = {}) => ({
  year: 2026,
  month: 3,
  totalMinutes: 870,
  gross: 475000,
  totalFines: 20000,
  net: 415000,
  status,
  paidAt: null,
  proofImageUrl: null,
  note: null,
  ...over,
});
const profile = (over: Record<string, unknown> = {}) => ({
  hourlyRate: 30000,
  bankBin: '970407',
  bankAccountNo: '0123456789',
  bankAccountName: 'NGUYEN LAN',
  qrImageUrl: null,
  active: true,
  ...over,
});
const PAY_ROWS = [
  { staff: { id: 'u1', fullName: 'Lan', phone: '0901234567' }, month: month('OPEN'), profile: profile(), qrImageUrl: null },
  {
    staff: { id: 'u2', fullName: null, phone: '0912345678' },
    month: month('FINALIZED', { totalMinutes: 600, totalFines: 0, net: 300000 }),
    profile: profile({ qrImageUrl: 'https://res.cloudinary.com/t/qr2.png' }),
    qrImageUrl: null,
  },
  { staff: { id: 'u3', fullName: 'Bình', phone: null }, month: month('PAID', { totalMinutes: 120, totalFines: 0, net: 100000 }), profile: null, qrImageUrl: 'https://img.vietqr.io/image/970436-0123456789-compact2.png?amount=100000' },
];

const day = (id: string, date: string, workedMinutes: number, net: number) => ({
  id,
  workDate: `${date}T00:00:00.000Z`,
  workedMinutes,
  hourlyRate: 30000,
  gross: net,
  fines: 0,
  net,
});
const DETAIL = {
  month: month('OPEN'),
  days: [day('d1', '2026-03-02', 270, 135000), day('d2', '2026-03-03', 480, 240000)],
  profile: profile(),
  sessions: [
    { id: 'ss1', shiftId: 'sh1', checkinAt: vn('2026-03-02', '08:00'), checkoutAt: vn('2026-03-02', '12:30'), isLate: true, closeReason: null },
    { id: 'ss2', shiftId: 'sh2', checkinAt: vn('2026-03-03', '22:00'), checkoutAt: null, isLate: false, closeReason: null },
  ],
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AdminPage />
    </QueryClientProvider>,
  );
}

const h1s = () => screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent);
const timeInputs = () => [...document.querySelectorAll<HTMLInputElement>('input[type="time"]')];
const goTab = (name: string) => fireEvent.click(screen.getByRole('tab', { name }));
const confirmSpy = () => vi.spyOn(window, 'confirm');

describe('Quản trị nhân sự theo DS v2 (C-076, C-114)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(NOW));
    vi.resetAllMocks();
    mocks.role = 'ADMIN';
    mocks.meId = 'me-not-listed';
    mocks.listStaff.mockResolvedValue({ members: MEMBERS, pendingInvites: INVITES });
    mocks.grantStaff.mockResolvedValue({ granted: 'STAFF', applied: true });
    mocks.revokeStaff.mockResolvedValue({ revoked: 1, downgraded: false });
    mocks.getShiftsPendingCount.mockResolvedValue(0);
    mocks.adminGetShifts.mockResolvedValue(SHIFTS);
    mocks.approveShift.mockResolvedValue({ approved: true });
    mocks.rejectShift.mockResolvedValue({ rejected: true });
    mocks.bulkApproveShifts.mockResolvedValue({ approved: 2 });
    mocks.adminGetTemplates.mockResolvedValue([{ id: 't1', name: 'Ca sáng', startMin: 480, endMin: 720, active: true, sortOrder: 1 }]);
    mocks.createTemplate.mockResolvedValue({});
    mocks.deleteTemplate.mockResolvedValue({ deleted: true });
    mocks.adminGetPayroll.mockResolvedValue(PAY_ROWS);
    mocks.adminGetDetail.mockResolvedValue(DETAIL);
    mocks.setRate.mockResolvedValue({});
    mocks.finalizePayroll.mockResolvedValue({ finalized: true });
    mocks.reopenPayroll.mockResolvedValue({ status: 'OPEN' });
    mocks.markPaid.mockResolvedValue({ paid: true });
    mocks.adminEditSession.mockResolvedValue({ updated: true });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('khung trang', () => {
    it('đúng một h1 "Quản trị nhân sự"; không phải ADMIN thì báo không có quyền và không gọi API', () => {
      mocks.role = 'STAFF';
      renderPage();
      expect(screen.getByText('Chỉ quản trị viên mới truy cập được trang này.')).toBeInTheDocument();
      expect(h1s()).toEqual(['Quản trị nhân sự']);
      expect(mocks.listStaff).not.toHaveBeenCalled();
    });

    it('ADMIN: một h1; bốn thẻ chuyển phần (tablist), mặc định "Nhân sự"; nút sang kiểm duyệt cộng đồng', async () => {
      renderPage();
      await screen.findByText('Lan');
      expect(h1s()).toEqual(['Quản trị nhân sự']);
      const tabs = screen.getAllByRole('tab');
      expect(tabs.map((x) => x.textContent)).toEqual(['Nhân sự', 'Duyệt ca', 'Lương', 'Catalog']);
      expect(screen.queryByRole('tab', { name: 'Duyệt đổi vỏ' })).toBeNull();
      expect(screen.getByRole('tab', { name: 'Nhân sự' })).toHaveAttribute('aria-selected', 'true');
      for (const tab of tabs) expect(tab.style.minHeight).toBe('44px');
      goTab('Lương');
      expect(screen.getByRole('tab', { name: 'Lương' })).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByRole('tab', { name: 'Nhân sự' })).toHaveAttribute('aria-selected', 'false');
      fireEvent.click(screen.getByRole('button', { name: t.community.moderation }));
      expect(mocks.navigate).toHaveBeenCalledWith('/admin/community');
    });
  });

  describe('Nhân sự', () => {
    it('liệt kê thành viên (tên hoặc "Chưa có tên", SĐT, vai trò) và lời mời chờ mở app', async () => {
      renderPage();
      expect(await screen.findByText('Lan')).toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 2, name: 'Nhân sự' })).toBeInTheDocument();
      expect(screen.getByText('0901234567 · Nhân viên')).toBeInTheDocument();
      expect(screen.getByText('Chưa có tên')).toBeInTheDocument();
      expect(screen.getByText('0912345678 · Quản trị')).toBeInTheDocument();
      expect(screen.getByText('— · Nhân viên')).toBeInTheDocument();
      expect(screen.getByText('Chờ mở app')).toBeInTheDocument();
      expect(screen.getByText('0987654321 · Nhân viên')).toBeInTheDocument();
      // Thành viên không có SĐT thì không thu hồi được.
      expect(screen.getAllByRole('button', { name: /^Thu hồi/ })).toHaveLength(2);
    });

    it('dòng của chính mình không có nút Thu hồi (API chặn tự thu hồi), ghi "(bạn)"', async () => {
      mocks.meId = 'u2';
      renderPage();
      await screen.findByText('Lan');
      expect(screen.getByText('(bạn)')).toBeInTheDocument();
      expect(screen.getAllByRole('button', { name: /^Thu hồi/ })).toHaveLength(1);
      expect(screen.queryByRole('button', { name: 'Thu hồi · 0912345678' })).toBeNull();
    });

    it('danh sách trống: báo trống kèm hướng dẫn "Thêm"', async () => {
      mocks.listStaff.mockResolvedValue({ members: [], pendingInvites: [] });
      renderPage();
      expect(await screen.findByText('Chưa có nhân sự')).toBeInTheDocument();
      expect(screen.getByText('Bấm “Thêm” để cấp quyền theo số điện thoại.')).toBeInTheDocument();
    });

    it('lỗi tải: có Thử lại gọi lại API', async () => {
      mocks.listStaff.mockRejectedValueOnce(new Error('Mất kết nối')).mockResolvedValue({ members: MEMBERS, pendingInvites: [] });
      renderPage();
      expect(await screen.findByText('Mất kết nối')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
      expect(await screen.findByText('Lan')).toBeInTheDocument();
      expect(mocks.listStaff).toHaveBeenCalledTimes(2);
    });

    it('Thu hồi mở tấm xác nhận (không dùng window.confirm); Huỷ thì không làm gì, đồng ý thì gọi API', async () => {
      const confirm = confirmSpy();
      renderPage();
      await screen.findByText('Lan');
      fireEvent.click(screen.getByRole('button', { name: 'Thu hồi · Lan' }));
      expect(screen.getByRole('heading', { level: 2, name: 'Thu hồi quyền?' })).toBeInTheDocument();
      expect(screen.getByText('Thu hồi quyền của Lan? Người này sẽ mất toàn bộ quyền nhân viên/quản trị.')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Huỷ' }));
      expect(mocks.revokeStaff).not.toHaveBeenCalled();
      expect(screen.queryByText('Thu hồi quyền?')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Thu hồi · Lan' }));
      expect(screen.getByRole('button', { name: 'Thu hồi' })).toBeDisabled();
      fireEvent.change(screen.getByLabelText('Lý do'), { target: { value: 'Nghỉ việc' } });
      fireEvent.click(screen.getByRole('button', { name: 'Thu hồi' }));
      await waitFor(() => expect(mocks.revokeStaff).toHaveBeenCalledWith('0901234567', 'Nghỉ việc'));
      await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã thu hồi quyền.', type: 'success' }));
      expect(screen.queryByText('Thu hồi quyền?')).not.toBeInTheDocument();
      // Người chưa có tên: hỏi bằng SĐT.
      fireEvent.click(screen.getByRole('button', { name: 'Thu hồi · 0912345678' }));
      expect(screen.getByText('Thu hồi quyền của 0912345678? Người này sẽ mất toàn bộ quyền nhân viên/quản trị.')).toBeInTheDocument();
      expect(confirm).not.toHaveBeenCalled();
    });

    it('nút Thu hồi trên thẻ nhân sự có viền đỏ để nhìn ra việc nguy hiểm', async () => {
      renderPage();
      await screen.findByText('Lan');
      const btn = screen.getByRole('button', { name: 'Thu hồi · Lan' });
      expect(btn.style.border).toContain('var(--color-text-danger)');
      expect(btn.style.color).toBe('var(--color-text-danger)');
    });

    it('Thu hồi mà gian hàng đối tác còn việc dở (storeBlocked): báo cảnh báo thay vì thành công trơn', async () => {
      mocks.revokeStaff.mockResolvedValueOnce({ revoked: 1, downgraded: true, storeBlocked: true });
      renderPage();
      await screen.findByText('Lan');
      fireEvent.click(screen.getByRole('button', { name: 'Thu hồi · Lan' }));
      fireEvent.change(screen.getByLabelText('Lý do'), { target: { value: 'Nghỉ việc' } });
      fireEvent.click(screen.getByRole('button', { name: 'Thu hồi' }));
      await waitFor(() =>
        expect(mocks.openSnackbar).toHaveBeenCalledWith({
          text: 'Đã gỡ quyền, nhưng gian hàng đối tác của người này còn việc dở nên được giữ nguyên và họ có thể chưa dùng được Cổng người bán. Xử lý ở tab "Đơn đối tác & đối soát" trên web admin xong thì: gian hàng loại CTV tắt cờ đối tác; gian hàng loại MERCHANT không tắt bằng cờ được, hãy đặt lại vai trò cho người này. Hoặc đặt lại vai trò DEALER để giữ nguyên gian hàng.',
          type: 'warning',
        }),
      );
    });

    it('Huỷ lời mời chờ mở app hỏi lý do rồi gọi thu hồi theo SĐT (không dùng window.confirm)', async () => {
      const confirm = confirmSpy();
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Huỷ lời mời · 0987654321' }));
      expect(mocks.revokeStaff).not.toHaveBeenCalled();
      expect(screen.getByRole('heading', { level: 2, name: 'Huỷ lời mời?' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Thu hồi' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Giữ lại' })).toBeInTheDocument();
      fireEvent.change(screen.getByLabelText('Lý do'), { target: { value: 'Mời nhầm số' } });
      fireEvent.click(screen.getByRole('button', { name: 'Huỷ lời mời' }));
      await waitFor(() => expect(mocks.revokeStaff).toHaveBeenCalledWith('0987654321', 'Mời nhầm số'));
      expect(confirm).not.toHaveBeenCalled();
    });

    it('thu hồi: sheet giữ mở trong lúc gửi và khi lỗi (kèm lý do đã gõ), chỉ đóng khi thành công', async () => {
      let finish!: (v: { revoked: number; downgraded: boolean }) => void;
      mocks.revokeStaff.mockImplementationOnce(() => new Promise((res) => { finish = res; }));
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Thu hồi · Lan' }));
      fireEvent.change(screen.getByLabelText('Lý do'), { target: { value: 'Nghỉ việc' } });
      fireEvent.click(screen.getByRole('button', { name: 'Thu hồi' }));
      await waitFor(() => expect(mocks.revokeStaff).toHaveBeenCalledTimes(1));
      expect(screen.getByRole('heading', { level: 2, name: 'Thu hồi quyền?' })).toBeInTheDocument();
      finish({ revoked: 1, downgraded: false });
      await waitFor(() => expect(screen.queryByRole('heading', { level: 2, name: 'Thu hồi quyền?' })).not.toBeInTheDocument());

      mocks.revokeStaff.mockRejectedValueOnce(new Error('Không thu hồi được'));
      fireEvent.click(await screen.findByRole('button', { name: 'Thu hồi · Lan' }));
      fireEvent.change(await screen.findByLabelText('Lý do'), { target: { value: 'Nghỉ việc' } });
      fireEvent.click(screen.getByRole('button', { name: 'Thu hồi' }));
      await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Không thu hồi được', type: 'error' }));
      expect(screen.getByRole('heading', { level: 2, name: 'Thu hồi quyền?' })).toBeInTheDocument();
      expect(screen.getByLabelText('Lý do')).toHaveValue('Nghỉ việc');
    });

    it('lý do thu hồi: cắt khoảng trắng, dưới 3 ký tự thì chưa cho thu hồi, tối đa 500 ký tự', async () => {
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Thu hồi · Lan' }));
      const reason = screen.getByLabelText('Lý do');
      expect(reason).toHaveAttribute('maxlength', '500');
      fireEvent.change(reason, { target: { value: '  ab  ' } });
      expect(screen.getByRole('button', { name: 'Thu hồi' })).toBeDisabled();
      fireEvent.change(reason, { target: { value: '  Hết hợp đồng  ' } });
      fireEvent.click(screen.getByRole('button', { name: 'Thu hồi' }));
      await waitFor(() => expect(mocks.revokeStaff).toHaveBeenCalledWith('0901234567', 'Hết hợp đồng'));
    });

    it('Thêm nhân sự: chỉ lưu được khi SĐT hợp lệ; cấp NHÂN VIÊN báo "áp ngay" hoặc "áp khi mở app"', async () => {
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Thêm' }));
      expect(screen.getByRole('heading', { level: 2, name: 'Thêm nhân sự theo SĐT' })).toBeInTheDocument();
      const save = screen.getByRole('button', { name: 'Lưu quyền' });
      expect(save).toBeDisabled();
      const phone = screen.getByLabelText('Số điện thoại');
      fireEvent.change(phone, { target: { value: '12345' } });
      expect(screen.getByRole('button', { name: 'Lưu quyền' })).toBeDisabled();
      fireEvent.change(phone, { target: { value: '0901112223' } });
      expect(screen.getByRole('button', { name: 'Lưu quyền' })).toBeDisabled();
      fireEvent.change(screen.getByLabelText('Lý do'), { target: { value: 'Nhân viên mới' } });
      expect(screen.getByRole('button', { name: 'Lưu quyền' })).toBeEnabled();
      fireEvent.click(screen.getByRole('button', { name: 'Lưu quyền' }));
      await waitFor(() => expect(mocks.grantStaff).toHaveBeenCalledWith('0901112223', 'STAFF', undefined, 'Nhân viên mới'));
      await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã cấp quyền & áp ngay.', type: 'success' }));
      await waitFor(() => expect(screen.queryByText('Thêm nhân sự theo SĐT')).not.toBeInTheDocument());

      mocks.grantStaff.mockResolvedValue({ granted: 'STAFF', applied: false });
      fireEvent.click(screen.getByRole('button', { name: 'Thêm' }));
      fireEvent.change(screen.getByLabelText('Số điện thoại'), { target: { value: '0907778889' } });
      fireEvent.change(screen.getByLabelText('Lý do'), { target: { value: 'Nhân viên mới' } });
      fireEvent.click(screen.getByRole('button', { name: 'Lưu quyền' }));
      await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã lưu quyền (sẽ áp khi họ mở app).', type: 'success' }));
    });

    it('đóng sheet Thêm mà chưa lưu thì lý do không kéo sang lần mở sau', async () => {
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Thêm' }));
      fireEvent.change(screen.getByLabelText('Lý do'), { target: { value: 'Lý do của người trước' } });
      fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
      await waitFor(() => expect(screen.queryByText('Thêm nhân sự theo SĐT')).not.toBeInTheDocument());
      fireEvent.click(screen.getByRole('button', { name: 'Thêm' }));
      expect(await screen.findByLabelText('Lý do')).toHaveValue('');
    });

    it('cấp QUẢN TRỊ phải xác nhận thêm bằng tấm xác nhận; Huỷ thì không gọi API và giữ SĐT đã gõ, đồng ý thì gửi vai trò ADMIN', async () => {
      const confirm = confirmSpy();
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Thêm' }));
      const staff = screen.getByRole('button', { name: 'Nhân viên' });
      const admin = screen.getByRole('button', { name: 'Quản trị' });
      expect(staff).toHaveAttribute('aria-pressed', 'true');
      expect(admin).toHaveAttribute('aria-pressed', 'false');
      fireEvent.click(admin);
      expect(admin).toHaveAttribute('aria-pressed', 'true');
      fireEvent.change(screen.getByLabelText('Số điện thoại'), { target: { value: '0901112223' } });
      fireEvent.change(screen.getByLabelText('Lý do'), { target: { value: 'Giao quyền quản trị' } });
      fireEvent.click(screen.getByRole('button', { name: 'Lưu quyền' }));
      expect(screen.getByRole('heading', { level: 2, name: 'Cấp quyền quản trị?' })).toBeInTheDocument();
      expect(screen.getByText('Xác nhận cấp quyền ADMIN (toàn quyền quản trị) cho SĐT 0901112223?')).toBeInTheDocument();
      expect(mocks.grantStaff).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Huỷ' }));
      expect(mocks.grantStaff).not.toHaveBeenCalled();
      expect((screen.getByLabelText('Số điện thoại') as HTMLInputElement).value).toBe('0901112223');
      fireEvent.click(screen.getByRole('button', { name: 'Lưu quyền' }));
      fireEvent.click(screen.getByRole('button', { name: 'Cấp quyền quản trị' }));
      await waitFor(() => expect(mocks.grantStaff).toHaveBeenCalledWith('0901112223', 'ADMIN', undefined, 'Giao quyền quản trị'));
      expect(confirm).not.toHaveBeenCalled();
    });

    describe('nhóm việc (E-57)', () => {
      const groupChips = () => within(screen.getByRole('group', { name: 'Nhóm việc' })).getAllByRole('button');

      it('thẻ nhân sự hiện nhóm việc; nhân viên chưa có nhóm thì nói rõ; quản trị không có dòng nhóm; lời mời chờ cũng hiện nhóm đã chọn', async () => {
        renderPage();
        await screen.findByText('Lan');
        expect(screen.getByText('Nhóm việc: Kho, Kế toán')).toBeInTheDocument();
        expect(screen.getByText('Chưa có nhóm việc (chỉ dùng quầy, Đổi rác, chấm công)')).toBeInTheDocument();
        expect(screen.getByText('Nhóm việc: Chăm sóc khách')).toBeInTheDocument();
        expect(screen.getAllByText(/Nhóm việc:|Chưa có nhóm việc/)).toHaveLength(3);
      });

      it('sheet Thêm: bốn nút chọn nhóm, bấm để bật/tắt; lưu gửi các nhóm theo thứ tự chuẩn', async () => {
        renderPage();
        fireEvent.click(await screen.findByRole('button', { name: 'Thêm' }));
        expect(groupChips().map((c) => c.textContent)).toEqual(['Chăm sóc khách', 'Kho', 'Nội dung và khuyến mãi', 'Kế toán']);
        expect(groupChips().every((c) => c.getAttribute('aria-pressed') === 'false')).toBe(true);
        fireEvent.click(screen.getByRole('button', { name: 'Kho' }));
        fireEvent.click(screen.getByRole('button', { name: 'Chăm sóc khách' }));
        fireEvent.click(screen.getByRole('button', { name: 'Kế toán' }));
        fireEvent.click(screen.getByRole('button', { name: 'Kế toán' }));
        expect(screen.getByRole('button', { name: 'Kho' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: 'Kế toán' })).toHaveAttribute('aria-pressed', 'false');
        fireEvent.change(screen.getByLabelText('Số điện thoại'), { target: { value: '0901112223' } });
        fireEvent.change(screen.getByLabelText('Lý do'), { target: { value: 'Giao quyền quản trị' } });
        fireEvent.click(screen.getByRole('button', { name: 'Lưu quyền' }));
        await waitFor(() => expect(mocks.grantStaff).toHaveBeenCalledWith('0901112223', 'STAFF', ['CSKH', 'KHO'], 'Giao quyền quản trị'));
      });

      it('gõ SĐT của nhân viên đang có: hiện nhóm đang có và nói lưu sẽ thay; SĐT lạ thì giữ dòng gợi ý chung', async () => {
        renderPage();
        fireEvent.click(await screen.findByRole('button', { name: 'Thêm' }));
        expect(screen.getByText('Không chọn nhóm nào: chỉ dùng quầy thu ngân, Đổi rác và chấm công.')).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText('Số điện thoại'), { target: { value: '0901234567' } });
        fireEvent.change(screen.getByLabelText('Lý do'), { target: { value: 'Giao quyền quản trị' } });
        expect(screen.getByText(/Nhóm đang có: Kho, Kế toán\. .*thay bằng nhóm bạn chọn/)).toBeInTheDocument();
        expect(screen.queryByText(/chỉ dùng quầy thu ngân/)).toBeNull();
        fireEvent.change(screen.getByLabelText('Số điện thoại'), { target: { value: '0907778889' } });
        fireEvent.change(screen.getByLabelText('Lý do'), { target: { value: 'Giao quyền quản trị' } });
        expect(screen.getByText('Không chọn nhóm nào: chỉ dùng quầy thu ngân, Đổi rác và chấm công.')).toBeInTheDocument();
      });

      it('vai trò không đổi mà nhóm đã đổi ngay: báo "Đã đổi nhóm việc của <SĐT> thành ...", không hứa "sẽ áp khi họ mở app"', async () => {
        mocks.grantStaff.mockResolvedValue({ granted: 'STAFF', applied: false, permissionsChanged: true });
        renderPage();
        fireEvent.click(await screen.findByRole('button', { name: 'Thêm' }));
        fireEvent.change(screen.getByLabelText('Số điện thoại'), { target: { value: '0901234567' } });
        fireEvent.change(screen.getByLabelText('Lý do'), { target: { value: 'Giao quyền quản trị' } });
        fireEvent.click(screen.getByRole('button', { name: 'Chăm sóc khách' }));
        fireEvent.click(screen.getByRole('button', { name: 'Lưu quyền' }));
        await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã đổi nhóm việc của 0901234567 thành Chăm sóc khách.', type: 'success' }));
      });

      it('nhân viên đã có mà không chọn nhóm: báo nhóm giữ nguyên, không hứa "sẽ áp khi họ mở app"', async () => {
        mocks.grantStaff.mockResolvedValue({ granted: 'STAFF', applied: false, permissionsChanged: false });
        renderPage();
        fireEvent.click(await screen.findByRole('button', { name: 'Thêm' }));
        fireEvent.change(screen.getByLabelText('Số điện thoại'), { target: { value: '0901234567' } });
        fireEvent.change(screen.getByLabelText('Lý do'), { target: { value: 'Giao quyền quản trị' } });
        fireEvent.click(screen.getByRole('button', { name: 'Lưu quyền' }));
        await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: '0901234567 đã là nhân viên, nhóm việc giữ nguyên.', type: 'success' }));
      });

      it('người chưa có tài khoản vẫn báo "sẽ áp khi họ mở app"', async () => {
        mocks.grantStaff.mockResolvedValue({ granted: 'STAFF', applied: false, permissionsChanged: false });
        renderPage();
        fireEvent.click(await screen.findByRole('button', { name: 'Thêm' }));
        fireEvent.change(screen.getByLabelText('Số điện thoại'), { target: { value: '0907778889' } });
        fireEvent.change(screen.getByLabelText('Lý do'), { target: { value: 'Giao quyền quản trị' } });
        fireEvent.click(screen.getByRole('button', { name: 'Lưu quyền' }));
        await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã lưu quyền (sẽ áp khi họ mở app).', type: 'success' }));
      });

      it('gõ SĐT của lời mời đang chờ có nhóm: nêu nhóm của lời mời thay vì gợi ý "chỉ dùng quầy"', async () => {
        renderPage();
        fireEvent.click(await screen.findByRole('button', { name: 'Thêm' }));
        fireEvent.change(screen.getByLabelText('Số điện thoại'), { target: { value: '0987654321' } });
        fireEvent.change(screen.getByLabelText('Lý do'), { target: { value: 'Giao quyền quản trị' } });
        expect(screen.getByText(/Lời mời đang chờ với nhóm: Chăm sóc khách\. .*giữ nguyên nhóm của lời mời/)).toBeInTheDocument();
        expect(screen.queryByText(/chỉ dùng quầy thu ngân/)).toBeNull();
      });

      it('lưu xong thì chọn lại từ đầu: nhóm của người trước không kéo sang người sau', async () => {
        renderPage();
        fireEvent.click(await screen.findByRole('button', { name: 'Thêm' }));
        fireEvent.click(screen.getByRole('button', { name: 'Kho' }));
        fireEvent.change(screen.getByLabelText('Số điện thoại'), { target: { value: '0901112223' } });
        fireEvent.change(screen.getByLabelText('Lý do'), { target: { value: 'Giao quyền quản trị' } });
        fireEvent.click(screen.getByRole('button', { name: 'Lưu quyền' }));
        await waitFor(() => expect(screen.queryByText('Thêm nhân sự theo SĐT')).not.toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: 'Thêm' }));
        expect(groupChips().every((c) => c.getAttribute('aria-pressed') === 'false')).toBe(true);
      });

      it('chọn Quản trị thì ẩn nhóm việc và không gửi nhóm đã chọn trước đó', async () => {
        renderPage();
        fireEvent.click(await screen.findByRole('button', { name: 'Thêm' }));
        fireEvent.click(screen.getByRole('button', { name: 'Kho' }));
        fireEvent.click(screen.getByRole('button', { name: 'Quản trị' }));
        expect(screen.queryByRole('group', { name: 'Nhóm việc' })).toBeNull();
        fireEvent.change(screen.getByLabelText('Số điện thoại'), { target: { value: '0901112223' } });
        fireEvent.change(screen.getByLabelText('Lý do'), { target: { value: 'Giao quyền quản trị' } });
        fireEvent.click(screen.getByRole('button', { name: 'Lưu quyền' }));
        fireEvent.click(screen.getByRole('button', { name: 'Cấp quyền quản trị' }));
        await waitFor(() => expect(mocks.grantStaff).toHaveBeenCalledWith('0901112223', 'ADMIN', undefined, 'Giao quyền quản trị'));
      });
    });

    it('cấp quyền lỗi: báo lỗi máy chủ và giữ khung', async () => {
      mocks.grantStaff.mockRejectedValue(new Error('SĐT không tồn tại'));
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Thêm' }));
      fireEvent.change(screen.getByLabelText('Số điện thoại'), { target: { value: '0901112223' } });
      fireEvent.change(screen.getByLabelText('Lý do'), { target: { value: 'Giao quyền quản trị' } });
      fireEvent.click(screen.getByRole('button', { name: 'Lưu quyền' }));
      await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'SĐT không tồn tại', type: 'error' }));
      expect((screen.getByLabelText('Số điện thoại') as HTMLInputElement).value).toBe('0901112223');
    });
  });

  describe('thẻ "Catalog"', () => {
    it('chỉ nạp phần kiểm tra catalog khi bấm thẻ, và đổi sang thẻ khác thì gỡ ra', async () => {
      renderPage();
      await screen.findByText('Lan');
      expect(screen.queryByTestId('catalog-section')).toBeNull();
      goTab('Catalog');
      expect(await screen.findByTestId('catalog-section')).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Catalog' })).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByRole('tabpanel', { name: 'Catalog' })).toBeInTheDocument();
      goTab('Lương');
      expect(screen.queryByTestId('catalog-section')).toBeNull();
    });
  });
  describe('số ca chờ duyệt trên thẻ "Duyệt ca" (E-26)', () => {
    it('có 3 ca chờ → nhãn "Duyệt ca (3)"; ba thẻ kia không đổi', async () => {
      mocks.getShiftsPendingCount.mockResolvedValue(3);
      renderPage();
      expect(await screen.findByRole('tab', { name: 'Duyệt ca (3)' })).toBeInTheDocument();
      expect(screen.getAllByRole('tab').map((x) => x.textContent)).toEqual(['Nhân sự', 'Duyệt ca (3)', 'Lương', 'Catalog']);
      expect(mocks.getShiftsPendingCount).toHaveBeenCalledTimes(1);
    });

    it('không có ca chờ → nhãn trơn "Duyệt ca", không thêm "(0)"', async () => {
      renderPage();
      await screen.findByText('Lan');
      await waitFor(() => expect(mocks.getShiftsPendingCount).toHaveBeenCalled());
      expect(screen.getByRole('tab', { name: 'Duyệt ca' })).toBeInTheDocument();
    });

    it('lấy số lỗi thì thẻ vẫn là "Duyệt ca", trang không vỡ', async () => {
      mocks.getShiftsPendingCount.mockRejectedValue(new Error('Mất kết nối'));
      renderPage();
      await screen.findByText('Lan');
      await waitFor(() => expect(mocks.getShiftsPendingCount).toHaveBeenCalled());
      expect(screen.getByRole('tab', { name: 'Duyệt ca' })).toBeInTheDocument();
    });

    it('không phải ADMIN thì không gọi lấy số ca chờ', () => {
      mocks.role = 'STAFF';
      renderPage();
      expect(mocks.getShiftsPendingCount).not.toHaveBeenCalled();
    });

    it('duyệt xong một ca thì số trên thẻ tải lại ngay', async () => {
      mocks.getShiftsPendingCount.mockResolvedValueOnce(2).mockResolvedValue(1);
      renderPage();
      await screen.findByRole('tab', { name: 'Duyệt ca (2)' });
      goTab('Duyệt ca (2)');
      await screen.findByText('09/03 – 15/03');
      await screen.findAllByText('Chờ duyệt');
      fireEvent.click(screen.getByRole('button', { name: 'Duyệt ca Lan T3 10/03' }));
      expect(await screen.findByRole('tab', { name: 'Duyệt ca (1)' })).toBeInTheDocument();
    });
  });

  describe('Duyệt ca', () => {
    const openShifts = async () => {
      renderPage();
      await screen.findByText('Lan');
      goTab('Duyệt ca');
      await screen.findByText('09/03 – 15/03');
      await screen.findAllByText('Chờ duyệt');
    };

    it('lấy ca theo tuần, gom theo nhân viên (tên hoặc SĐT), hiện giờ đã chỉnh và trạng thái', async () => {
      await openShifts();
      expect(mocks.adminGetShifts).toHaveBeenCalledWith('2026-03-09T00:00:00.000Z', '2026-03-15T23:59:59.999Z');
      expect(screen.getByRole('heading', { level: 2, name: 'Duyệt ca' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 3, name: 'Lan' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 3, name: '0912345678' })).toBeInTheDocument();
      expect(screen.getByText('T3 10/03 · 08:00–12:00')).toBeInTheDocument();
      expect(screen.getByText('T5 12/03 · 09:00–13:00')).toBeInTheDocument();
      expect(screen.getAllByText('Chờ duyệt')).toHaveLength(2);
      expect(screen.getByText('Đã duyệt')).toBeInTheDocument();
      // "Từ chối" vừa là nhãn trạng thái vừa là chữ của nút: nhãn là phần tử không nằm trong nút.
      expect(screen.getAllByText('Từ chối').some((el) => !el.closest('button'))).toBe(true);
      expect(screen.getByText('Đã huỷ')).toBeInTheDocument();
    });

    it('nút chuyển tuần có tên, cao >= 44px, đổi đúng tuần truy vấn', async () => {
      await openShifts();
      const prev = screen.getByRole('button', { name: 'Tuần trước' });
      expect(prev.style.minHeight).toBe('44px');
      fireEvent.click(prev);
      expect(await screen.findByText('02/03 – 08/03')).toBeInTheDocument();
      await waitFor(() => expect(mocks.adminGetShifts).toHaveBeenCalledWith('2026-03-02T00:00:00.000Z', '2026-03-08T23:59:59.999Z'));
    });

    it('tuần không có ca: báo trống; không có ca chờ thì không có "Duyệt tất cả"', async () => {
      mocks.adminGetShifts.mockResolvedValue([]);
      renderPage();
      await screen.findByText('Lan');
      goTab('Duyệt ca');
      expect(await screen.findByText('Không có ca nào trong tuần này')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Duyệt tất cả/ })).not.toBeInTheDocument();
    });

    it('chỉ ca chờ duyệt có ba hành động; mỗi nút có tên theo người và ngày, cao >= 44px', async () => {
      await openShifts();
      expect(screen.getAllByRole('button', { name: /^Duyệt ca / })).toHaveLength(2);
      expect(screen.getAllByRole('button', { name: /^Từ chối ca / })).toHaveLength(2);
      expect(screen.getAllByRole('button', { name: /^Chỉnh giờ / })).toHaveLength(2);
      for (const b of screen.getAllByRole('button', { name: /^(Duyệt|Từ chối) ca |^Chỉnh giờ / })) {
        expect(b.style.minHeight).toBe('44px');
      }
    });

    it('Duyệt một ca: gọi approveShift không kèm giờ, báo thành công', async () => {
      await openShifts();
      fireEvent.click(screen.getByRole('button', { name: 'Duyệt ca Lan T3 10/03' }));
      await waitFor(() => expect(mocks.approveShift).toHaveBeenCalledWith('s1', undefined));
      await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã duyệt ca.', type: 'success' }));
    });

    it('Duyệt tất cả: gửi đúng danh sách ca chờ duyệt, báo số ca đã duyệt', async () => {
      await openShifts();
      fireEvent.click(screen.getByRole('button', { name: 'Duyệt tất cả (2)' }));
      await waitFor(() => expect(mocks.bulkApproveShifts).toHaveBeenCalledWith(['s1', 's2']));
      await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã duyệt 2 ca.', type: 'success' }));
    });

    it('Chỉnh giờ & duyệt: nạp giờ đăng ký, chỉ duyệt khi giờ đúng dạng HH:mm, gửi mốc theo giờ VN', async () => {
      await openShifts();
      fireEvent.click(screen.getByRole('button', { name: 'Chỉnh giờ Lan T3 10/03' }));
      expect(screen.getByRole('heading', { level: 2, name: 'Chỉnh giờ & duyệt' })).toBeInTheDocument();
      const start = screen.getByLabelText('Bắt đầu');
      const end = screen.getByLabelText('Kết thúc');
      expect(start).toHaveValue('08:00');
      expect(end).toHaveValue('12:00');
      fireEvent.change(start, { target: { value: '9h' } });
      expect(screen.getByRole('button', { name: 'Duyệt với giờ đã chỉnh' })).toBeDisabled();
      fireEvent.change(start, { target: { value: '09:00' } });
      fireEvent.change(end, { target: { value: '11:30' } });
      fireEvent.click(screen.getByRole('button', { name: 'Duyệt với giờ đã chỉnh' }));
      await waitFor(() =>
        expect(mocks.approveShift).toHaveBeenCalledWith('s1', { approvedStart: vn('2026-03-10', '09:00'), approvedEnd: vn('2026-03-10', '11:30') }),
      );
      await waitFor(() => expect(screen.queryByText('Chỉnh giờ & duyệt')).not.toBeInTheDocument());
    });

    it('Từ chối: bắt buộc có lý do, gửi lý do đã cắt khoảng trắng, đóng khung', async () => {
      await openShifts();
      fireEvent.click(screen.getByRole('button', { name: 'Từ chối ca Lan T4 11/03' }));
      expect(screen.getByRole('heading', { level: 2, name: 'Từ chối ca' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Xác nhận từ chối' })).toBeDisabled();
      fireEvent.change(screen.getByLabelText('Lý do'), { target: { value: '  Đủ người ' } });
      fireEvent.click(screen.getByRole('button', { name: 'Xác nhận từ chối' }));
      await waitFor(() => expect(mocks.rejectShift).toHaveBeenCalledWith('s2', 'Đủ người'));
      await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã từ chối ca.', type: 'success' }));
      await waitFor(() => expect(screen.queryByText('Xác nhận từ chối')).not.toBeInTheDocument());
    });

    it('Ca chuẩn: liệt kê, xoá, thêm (đổi giờ ra phút) và chỉ thêm khi đủ tên + giờ đúng dạng', async () => {
      await openShifts();
      fireEvent.click(screen.getByRole('button', { name: 'Ca chuẩn' }));
      expect(await screen.findByRole('heading', { level: 2, name: 'Ca chuẩn' })).toBeInTheDocument();
      expect(await screen.findByText('Ca sáng · 08:00–12:00')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Xoá ca chuẩn Ca sáng' }));
      await waitFor(() => expect(mocks.deleteTemplate).toHaveBeenCalledWith('t1'));

      const add = screen.getByRole('button', { name: 'Thêm ca chuẩn' });
      expect(add).toBeDisabled();
      fireEvent.change(screen.getByLabelText('Tên ca'), { target: { value: ' Ca tối ' } });
      fireEvent.change(screen.getByLabelText('Bắt đầu'), { target: { value: '18:00' } });
      fireEvent.change(screen.getByLabelText('Kết thúc'), { target: { value: '21:00' } });
      fireEvent.click(screen.getByRole('button', { name: 'Thêm ca chuẩn' }));
      await waitFor(() => expect(mocks.createTemplate).toHaveBeenCalledWith({ name: 'Ca tối', startMin: 1080, endMin: 1260 }));
      await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã thêm ca chuẩn.', type: 'success' }));
      await waitFor(() => expect(screen.getByLabelText('Tên ca')).toHaveValue(''));
    });

    it('Ca chuẩn: tải danh sách lỗi thì báo lỗi kèm nút thử lại, chưa cho thêm (tránh thêm trùng khi danh sách đang trống)', async () => {
      mocks.adminGetTemplates.mockRejectedValueOnce(new Error('mạng lỗi'));
      await openShifts();
      fireEvent.click(screen.getByRole('button', { name: 'Ca chuẩn' }));
      expect(await screen.findByText('mạng lỗi')).toBeInTheDocument();
      fireEvent.change(screen.getByLabelText('Tên ca'), { target: { value: 'Ca tối' } });
      expect(screen.getByRole('button', { name: 'Thêm ca chuẩn' })).toBeDisabled();
      fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
      expect(await screen.findByText('Ca sáng · 08:00–12:00')).toBeInTheDocument();
      expect(screen.queryByText('mạng lỗi')).not.toBeInTheDocument();
      await waitFor(() => expect(screen.getByRole('button', { name: 'Thêm ca chuẩn' })).toBeEnabled());
    });

    it('Ca chuẩn: làm mới danh sách lỗi khi đã có dữ liệu cũ thì vẫn hiện lỗi + Thử lại (nút Thêm khoá có lời giải thích)', async () => {
      await openShifts();
      fireEvent.click(screen.getByRole('button', { name: 'Ca chuẩn' }));
      expect(await screen.findByText('Ca sáng · 08:00–12:00')).toBeInTheDocument();
      mocks.adminGetTemplates.mockRejectedValueOnce(new Error('mạng chập chờn'));
      fireEvent.click(screen.getByRole('button', { name: 'Xoá ca chuẩn Ca sáng' }));
      expect(await screen.findByText('mạng chập chờn')).toBeInTheDocument();
      fireEvent.change(screen.getByLabelText('Tên ca'), { target: { value: 'Ca tối' } });
      expect(screen.getByRole('button', { name: 'Thêm ca chuẩn' })).toBeDisabled();
      fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
      await waitFor(() => expect(screen.queryByText('mạng chập chờn')).not.toBeInTheDocument());
      await waitFor(() => expect(screen.getByRole('button', { name: 'Thêm ca chuẩn' })).toBeEnabled());
    });

    it('Ca chuẩn: tên trùng ca đã có (không phân biệt hoa thường) thì báo và không cho thêm', async () => {
      await openShifts();
      fireEvent.click(screen.getByRole('button', { name: 'Ca chuẩn' }));
      expect(await screen.findByText('Ca sáng · 08:00–12:00')).toBeInTheDocument();
      fireEvent.change(screen.getByLabelText('Tên ca'), { target: { value: ' ca SÁNG ' } });
      expect(screen.getByText('Đã có ca chuẩn cùng tên.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Thêm ca chuẩn' })).toBeDisabled();
      fireEvent.change(screen.getByLabelText('Tên ca'), { target: { value: 'Ca tối' } });
      expect(screen.queryByText('Đã có ca chuẩn cùng tên.')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Thêm ca chuẩn' })).toBeEnabled();
    });
  });

  describe('Lương', () => {
    const openPayroll = async () => {
      renderPage();
      await screen.findByText('Lan');
      goTab('Lương');
      await screen.findByText('14h30 · 30.000đ/h · Đang tính');
    };

    it('lấy bảng lương theo tháng; mỗi nhân viên hiện giờ, đơn giá, trạng thái, thực nhận, phạt', async () => {
      await openPayroll();
      expect(mocks.adminGetPayroll).toHaveBeenCalledWith(2026, 3);
      expect(screen.getByRole('heading', { level: 2, name: 'Lương' })).toBeInTheDocument();
      expect(screen.getByText('Tháng 3/2026')).toBeInTheDocument();
      expect(screen.getByText('10h00 · 30.000đ/h · Đã chốt')).toBeInTheDocument();
      expect(screen.getByText('2h00 · 0đ/h · Đã trả')).toBeInTheDocument();
      expect(screen.getByText(formatVnd(415000))).toBeInTheDocument();
      expect(screen.getByText(`−${formatVnd(20000)}`)).toBeInTheDocument();
      expect(screen.getByText('0912345678')).toBeInTheDocument();
      expect(screen.getByText('Bình')).toBeInTheDocument();
    });

    it('nút chuyển tháng có tên, cao >= 44px và đổi đúng tháng truy vấn', async () => {
      await openPayroll();
      const prev = screen.getByRole('button', { name: 'Tháng trước' });
      expect(prev.style.minHeight).toBe('44px');
      fireEvent.click(prev);
      expect(await screen.findByText('Tháng 2/2026')).toBeInTheDocument();
      await waitFor(() => expect(mocks.adminGetPayroll).toHaveBeenCalledWith(2026, 2));
    });

    it('nút theo trạng thái: Đang tính có Chốt + Đã chuyển; Đã chốt có Đã chuyển + Mở lại; Đã trả chỉ có Mở lại; QR khi có ảnh', async () => {
      await openPayroll();
      const has = (name: string) => screen.queryByRole('button', { name }) !== null;
      expect(has('Chốt · Lan')).toBe(true);
      expect(has('Đã chuyển · Lan')).toBe(true);
      expect(has('Mở lại · Lan')).toBe(false);
      expect(has('QR chuyển · Lan')).toBe(false);

      expect(has('Chốt · 0912345678')).toBe(false);
      expect(has('Đã chuyển · 0912345678')).toBe(true);
      expect(has('Mở lại · 0912345678')).toBe(true);
      expect(has('QR chuyển · 0912345678')).toBe(true);

      expect(has('Chốt · Bình')).toBe(false);
      expect(has('Đã chuyển · Bình')).toBe(false);
      expect(has('Mở lại · Bình')).toBe(true);
      expect(has('QR chuyển · Bình')).toBe(true);

      for (const b of screen.getAllByRole('button', { name: /^(Xem giờ|Đơn giá|QR chuyển|Chốt|Đã chuyển|Mở lại) · / })) {
        expect(b.style.minHeight).toBe('44px');
      }
    });

    it('Chốt lương gọi API đúng nhân viên và tháng; chỉ dòng đang chốt có spinner, dòng khác bị khoá', async () => {
      mocks.finalizePayroll.mockReturnValue(new Promise(() => undefined));
      mocks.adminGetPayroll.mockResolvedValue([PAY_ROWS[0], { ...PAY_ROWS[0], staff: { id: 'u9', fullName: 'Cúc', phone: null } }]);
      renderPage();
      await screen.findByText('Lan');
      goTab('Lương');
      fireEvent.click(await screen.findByRole('button', { name: 'Chốt · Lan' }));
      await waitFor(() => expect(mocks.finalizePayroll).toHaveBeenCalledWith('u1', 2026, 3));
      await waitFor(() => expect(screen.getByRole('button', { name: 'Chốt · Lan' })).toHaveAttribute('aria-busy', 'true'));
      expect(screen.getByRole('button', { name: 'Chốt · Cúc' })).toBeDisabled();
    });

    it('Chốt xong báo "Đã chốt lương." và tải lại bảng', async () => {
      await openPayroll();
      fireEvent.click(screen.getByRole('button', { name: 'Chốt · Lan' }));
      await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã chốt lương.', type: 'success' }));
      await waitFor(() => expect(mocks.adminGetPayroll).toHaveBeenCalledTimes(2));
    });

    it('Mở lại bảng lương mở tấm xác nhận; Huỷ thì không gọi API, đồng ý thì gọi đúng nhân viên + tháng', async () => {
      const confirm = confirmSpy();
      await openPayroll();
      fireEvent.click(screen.getByRole('button', { name: 'Mở lại · Bình' }));
      expect(screen.getByText(/^Mở lại bảng lương T3\/2026 của Bình\? Cần chốt lại sau khi sửa\./)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Huỷ' }));
      expect(mocks.reopenPayroll).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Mở lại · Bình' }));
      fireEvent.click(screen.getByRole('button', { name: 'Mở lại bảng lương' }));
      await waitFor(() => expect(mocks.reopenPayroll).toHaveBeenCalledWith('u3', 2026, 3));
      await waitFor(() =>
        expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã mở lại bảng lương — sửa xong nhớ chốt lại.', type: 'success' }),
      );
      expect(confirm).not.toHaveBeenCalled();
    });

    it('Mở lại tháng đã trả: hộp xác nhận nói rõ sẽ xoá dấu đã trả và ảnh chứng từ; tháng chỉ mới chốt thì không nhắc', async () => {
      await openPayroll();
      fireEvent.click(screen.getByRole('button', { name: 'Mở lại · Bình' }));
      expect(screen.getByText(/xoá dấu đã trả và ảnh chứng từ/)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Huỷ' }));
      fireEvent.click(screen.getByRole('button', { name: 'Mở lại · 0912345678' }));
      expect(screen.getByText('Mở lại bảng lương T3/2026 của NV? Cần chốt lại sau khi sửa.')).toBeInTheDocument();
      expect(screen.queryByText(/chứng từ/)).toBeNull();
    });

    it('Đơn giá: nạp đơn giá hiện tại, chỉ lưu khi toàn chữ số, gửi số', async () => {
      await openPayroll();
      fireEvent.click(screen.getByRole('button', { name: 'Đơn giá · Lan' }));
      expect(screen.getByRole('heading', { level: 2, name: 'Đơn giá giờ · Lan' })).toBeInTheDocument();
      const input = screen.getByLabelText('Đơn giá (VND/giờ)');
      expect(input).toHaveValue(30000);
      fireEvent.change(input, { target: { value: '' } });
      expect(screen.getByRole('button', { name: 'Lưu đơn giá' })).toBeDisabled();
      fireEvent.change(input, { target: { value: '35000' } });
      fireEvent.click(screen.getByRole('button', { name: 'Lưu đơn giá' }));
      await waitFor(() => expect(mocks.setRate).toHaveBeenCalledWith('u1', 35000));
      await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã lưu đơn giá.', type: 'success' }));
      await waitFor(() => expect(screen.queryByText('Lưu đơn giá')).not.toBeInTheDocument());
    });

    it('QR chuyển: hiện số tiền, ảnh QR (ưu tiên ảnh của dòng), tên chủ và số tài khoản', async () => {
      await openPayroll();
      fireEvent.click(screen.getByRole('button', { name: 'QR chuyển · Bình' }));
      const dialog = screen.getByRole('heading', { level: 2, name: 'Chuyển lương Bình' });
      expect(dialog).toBeInTheDocument();
      expect(screen.getByAltText('QR')).toHaveAttribute('src', 'https://img.vietqr.io/image/970436-0123456789-compact2.png?amount=100000');
      expect(screen.getAllByText(formatVnd(100000)).length).toBeGreaterThan(0);
      expect(screen.getByText('Quét chuyển khoản rồi bấm "Đã chuyển" để tải ảnh xác nhận.')).toBeInTheDocument();
    });

    it('QR chuyển dùng ảnh QR trong hồ sơ khi dòng không có ảnh riêng, kèm tài khoản ngân hàng', async () => {
      await openPayroll();
      fireEvent.click(screen.getByRole('button', { name: 'QR chuyển · 0912345678' }));
      expect(screen.getByAltText('QR')).toHaveAttribute('src', 'https://res.cloudinary.com/t/qr2.png');
      expect(screen.getByText('NGUYEN LAN · 0123456789')).toBeInTheDocument();
    });

    it('QR cấp dòng là javascript: thì không có nút QR chuyển', async () => {
      mocks.adminGetPayroll.mockResolvedValue([{ ...PAY_ROWS[2]!, qrImageUrl: 'javascript:alert(1)' }, PAY_ROWS[0]!]);
      renderPage();
      await screen.findByText('Lan');
      goTab('Lương');
      await screen.findByText('14h30 · 30.000đ/h · Đang tính');
      expect(screen.queryByRole('button', { name: 'QR chuyển · Bình' })).not.toBeInTheDocument();
    });

    it('Đã chuyển: bắt buộc có ảnh xác nhận; gửi năm, tháng, ảnh, ghi chú (rỗng thì bỏ)', async () => {
      await openPayroll();
      fireEvent.click(screen.getByRole('button', { name: 'Đã chuyển · Lan' }));
      expect(screen.getByRole('heading', { level: 2, name: 'Xác nhận đã chuyển · Lan' })).toBeInTheDocument();
      expect(screen.getAllByText(formatVnd(415000)).length).toBeGreaterThan(0);
      expect(screen.getByRole('button', { name: 'Đánh dấu đã trả' })).toBeDisabled();
      fireEvent.click(screen.getByRole('button', { name: 'Ảnh xác nhận chuyển khoản *' }));
      expect(screen.getByRole('button', { name: 'Đánh dấu đã trả' })).toBeEnabled();
      fireEvent.click(screen.getByRole('button', { name: 'Đánh dấu đã trả' }));
      await waitFor(() =>
        expect(mocks.markPaid).toHaveBeenCalledWith('u1', { year: 2026, month: 3, proofImageUrl: 'https://img.test/proof.png', note: undefined }),
      );
      await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã đánh dấu đã trả lương.', type: 'success' }));
      await waitFor(() => expect(screen.queryByText('Đánh dấu đã trả')).not.toBeInTheDocument());
    });

    it('Đã chuyển kèm ghi chú: gửi ghi chú; mở lại khung thì ảnh và ghi chú cũ đã xoá', async () => {
      await openPayroll();
      fireEvent.click(screen.getByRole('button', { name: 'Đã chuyển · Lan' }));
      fireEvent.click(screen.getByRole('button', { name: 'Ảnh xác nhận chuyển khoản *' }));
      fireEvent.change(screen.getByLabelText('Ghi chú (tuỳ chọn)'), { target: { value: 'CK 14h' } });
      fireEvent.click(screen.getByRole('button', { name: 'Đánh dấu đã trả' }));
      await waitFor(() =>
        expect(mocks.markPaid).toHaveBeenCalledWith('u1', { year: 2026, month: 3, proofImageUrl: 'https://img.test/proof.png', note: 'CK 14h' }),
      );
      await waitFor(() => expect(screen.queryByText('Đánh dấu đã trả')).not.toBeInTheDocument());
      fireEvent.click(screen.getByRole('button', { name: 'Đã chuyển · 0912345678' }));
      expect(screen.getByRole('button', { name: 'Đánh dấu đã trả' })).toBeDisabled();
      expect(screen.getByLabelText('Ghi chú (tuỳ chọn)')).toHaveValue('');
    });

    it('Xem giờ: tổng giờ, thực nhận, từng ngày và phiên (kể cả đang mở)', async () => {
      await openPayroll();
      fireEvent.click(screen.getByRole('button', { name: 'Xem giờ · Lan' }));
      expect(await screen.findByRole('heading', { level: 2, name: 'Giờ công · Lan · T3/2026' })).toBeInTheDocument();
      await waitFor(() => expect(mocks.adminGetDetail).toHaveBeenCalledWith('u1', 2026, 3));
      expect(await screen.findByText('T2 02/03 · 4h30')).toBeInTheDocument();
      expect(screen.getByText('T3 03/03 · 8h00')).toBeInTheDocument();
      expect(screen.getByText('08:00 → 12:30 · trễ')).toBeInTheDocument();
      expect(screen.getByText('22:00 → đang mở')).toBeInTheDocument();
      expect(screen.getByText('14h30')).toBeInTheDocument();
    });

    it('Xem giờ: tải chi tiết lỗi thì báo lỗi kèm nút thử lại', async () => {
      await openPayroll();
      mocks.adminGetDetail.mockRejectedValueOnce(new Error('không tải được giờ công'));
      fireEvent.click(screen.getByRole('button', { name: 'Xem giờ · Lan' }));
      expect(await screen.findByText('không tải được giờ công')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
      expect(await screen.findByText('T2 02/03 · 4h30')).toBeInTheDocument();
      expect(screen.queryByText('không tải được giờ công')).not.toBeInTheDocument();
    });

    it('Sửa giờ phiên: nạp giờ cũ, lưu gửi giờ vào/ra theo ngày làm, báo và tải lại', async () => {
      await openPayroll();
      fireEvent.click(screen.getByRole('button', { name: 'Xem giờ · Lan' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Sửa giờ phiên 08:00' }));
      expect(timeInputs().map((i) => i.value)).toEqual(['08:00', '12:30']);
      expect(screen.getByLabelText('Giờ vào')).toHaveValue('08:00');
      expect(screen.getByLabelText('Giờ ra')).toHaveValue('12:30');
      fireEvent.change(screen.getByLabelText('Giờ ra'), { target: { value: '12:45' } });
      mocks.adminGetPayroll.mockClear();
      fireEvent.click(screen.getByRole('button', { name: 'Lưu giờ' }));
      await waitFor(() =>
        expect(mocks.adminEditSession).toHaveBeenCalledWith('ss1', { checkinAt: vn('2026-03-02', '08:00'), checkoutAt: vn('2026-03-02', '12:45') }),
      );
      await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã sửa giờ & tính lại.', type: 'success' }));
      await waitFor(() => expect(mocks.adminGetPayroll).toHaveBeenCalled());
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Lưu giờ' })).not.toBeInTheDocument());
    });

    it('phiên chưa checkout: giờ ra bằng giờ vào thì báo và khoá Lưu; ca qua đêm đẩy giờ ra sang ngày hôm sau', async () => {
      await openPayroll();
      fireEvent.click(screen.getByRole('button', { name: 'Xem giờ · Lan' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Sửa giờ phiên 22:00' }));
      expect(screen.getByText('Nhập giờ ra khác giờ vào để lưu.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Lưu giờ' })).toBeDisabled();
      fireEvent.change(screen.getByLabelText('Giờ ra'), { target: { value: '02:00' } });
      expect(screen.queryByText('Nhập giờ ra khác giờ vào để lưu.')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Lưu giờ' }));
      await waitFor(() =>
        expect(mocks.adminEditSession).toHaveBeenCalledWith('ss2', { checkinAt: vn('2026-03-03', '22:00'), checkoutAt: vn('2026-03-04', '02:00') }),
      );
    });

    it('bảng lương trống: báo chưa có nhân sự', async () => {
      mocks.adminGetPayroll.mockResolvedValue([]);
      renderPage();
      await screen.findByText('Lan');
      goTab('Lương');
      expect(await screen.findByText('Chưa có nhân sự')).toBeInTheDocument();
    });

    it('lỗi tải bảng lương: có Thử lại gọi lại API', async () => {
      mocks.adminGetPayroll.mockRejectedValueOnce(new Error('Mất kết nối')).mockResolvedValue(PAY_ROWS);
      renderPage();
      await screen.findByText('Lan');
      goTab('Lương');
      expect(await screen.findByText('Mất kết nối')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
      expect(await screen.findByText('14h30 · 30.000đ/h · Đang tính')).toBeInTheDocument();
    });
  });

  describe('khoá chạm đúp trong cùng một khung hình (W79A)', () => {
    const deferred = () => {
      let resolve!: (v?: unknown) => void;
      let reject!: (e: unknown) => void;
      const promise = new Promise<unknown>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    };
    // Mọi cú chạm trong một lần `act`: React chưa kịp vẽ lại `isPending` giữa hai cú, như hai cú chạm sát nhau trên máy thật.
    const sameFrame = (...els: HTMLElement[]) =>
      act(async () => {
        for (const el of els) fireEvent.click(el);
      });
    const successCount = (text: string) => mocks.openSnackbar.mock.calls.filter(([a]) => a.type === 'success' && a.text === text).length;
    const btn = (name: string) => screen.getByRole('button', { name });
    const busy = (name: string) => waitFor(() => expect(btn(name)).toHaveAttribute('aria-busy', 'true'));

    describe('Nhân sự', () => {
      const openGrant = async (admin = false) => {
        renderPage();
        fireEvent.click(await screen.findByRole('button', { name: 'Thêm' }));
        if (admin) fireEvent.click(btn('Quản trị'));
        fireEvent.change(screen.getByLabelText('Số điện thoại'), { target: { value: '0901112223' } });
        fireEvent.change(screen.getByLabelText('Lý do'), { target: { value: 'Nhân viên mới' } });
      };
      const openRevoke = async () => {
        renderPage();
        fireEvent.click(await screen.findByRole('button', { name: 'Thu hồi · Lan' }));
        fireEvent.change(screen.getByLabelText('Lý do'), { target: { value: 'Nghỉ việc' } });
      };

      it('chạm đúp "Lưu quyền" chỉ cấp quyền một lần', async () => {
        const d = deferred();
        mocks.grantStaff.mockReturnValueOnce(d.promise);
        await openGrant();
        const save = btn('Lưu quyền');
        await sameFrame(save, save);
        expect(mocks.grantStaff).toHaveBeenCalledTimes(1);
        await busy('Lưu quyền');
        await act(async () => d.resolve({ granted: 'STAFF', applied: true }));
        await waitFor(() => expect(successCount('Đã cấp quyền & áp ngay.')).toBe(1));
        expect(mocks.grantStaff).toHaveBeenCalledTimes(1);
      });

      it('cấp quyền lỗi thì nhả khoá, bấm lại gọi lần hai', async () => {
        mocks.grantStaff.mockRejectedValueOnce(new Error('SĐT không tồn tại'));
        await openGrant();
        fireEvent.click(btn('Lưu quyền'));
        await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'SĐT không tồn tại', type: 'error' }));
        fireEvent.click(btn('Lưu quyền'));
        await waitFor(() => expect(mocks.grantStaff).toHaveBeenCalledTimes(2));
      });

      it('chạm đúp "Cấp quyền quản trị" ở tấm xác nhận chỉ cấp quyền ADMIN một lần', async () => {
        const d = deferred();
        mocks.grantStaff.mockReturnValueOnce(d.promise);
        await openGrant(true);
        fireEvent.click(btn('Lưu quyền'));
        const confirm = btn('Cấp quyền quản trị');
        await sameFrame(confirm, confirm);
        expect(mocks.grantStaff).toHaveBeenCalledTimes(1);
        expect(mocks.grantStaff).toHaveBeenCalledWith('0901112223', 'ADMIN', undefined, 'Nhân viên mới');
        await act(async () => d.resolve({ granted: 'ADMIN', applied: true }));
        await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' })));
        expect(mocks.grantStaff).toHaveBeenCalledTimes(1);
      });

      it('cấp quyền ADMIN lỗi thì nhả khoá, xác nhận lại gọi lần hai', async () => {
        mocks.grantStaff.mockRejectedValueOnce(new Error('Máy chủ bận'));
        await openGrant(true);
        fireEvent.click(btn('Lưu quyền'));
        fireEvent.click(btn('Cấp quyền quản trị'));
        await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Máy chủ bận', type: 'error' }));
        fireEvent.click(btn('Lưu quyền'));
        fireEvent.click(btn('Cấp quyền quản trị'));
        await waitFor(() => expect(mocks.grantStaff).toHaveBeenCalledTimes(2));
      });

      it('chạm đúp "Thu hồi" chỉ thu hồi quyền một lần', async () => {
        const d = deferred();
        mocks.revokeStaff.mockReturnValueOnce(d.promise);
        await openRevoke();
        const revoke = btn('Thu hồi');
        await sameFrame(revoke, revoke);
        expect(mocks.revokeStaff).toHaveBeenCalledTimes(1);
        expect(mocks.revokeStaff).toHaveBeenCalledWith('0901234567', 'Nghỉ việc');
        await busy('Thu hồi');
        expect(btn('Thu hồi')).not.toBeDisabled();
        await act(async () => d.resolve({ revoked: 1, downgraded: false }));
        await waitFor(() => expect(successCount('Đã thu hồi quyền.')).toBe(1));
        expect(mocks.revokeStaff).toHaveBeenCalledTimes(1);
      });

      it('thu hồi lỗi thì nhả khoá, bấm lại gọi lần hai', async () => {
        mocks.revokeStaff.mockRejectedValueOnce(new Error('Không thu hồi được'));
        await openRevoke();
        fireEvent.click(btn('Thu hồi'));
        await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Không thu hồi được', type: 'error' }));
        fireEvent.click(btn('Thu hồi'));
        await waitFor(() => expect(mocks.revokeStaff).toHaveBeenCalledTimes(2));
      });

      it('chạm đúp "Huỷ lời mời" ở tấm xác nhận chỉ gọi thu hồi một lần', async () => {
        const d = deferred();
        mocks.revokeStaff.mockReturnValueOnce(d.promise);
        renderPage();
        fireEvent.click(await screen.findByRole('button', { name: 'Huỷ lời mời · 0987654321' }));
        fireEvent.change(screen.getByLabelText('Lý do'), { target: { value: 'Mời nhầm số' } });
        const cancel = btn('Huỷ lời mời');
        await sameFrame(cancel, cancel);
        expect(mocks.revokeStaff).toHaveBeenCalledTimes(1);
        expect(mocks.revokeStaff).toHaveBeenCalledWith('0987654321', 'Mời nhầm số');
        await act(async () => d.resolve({ revoked: 1, downgraded: false }));
        await waitFor(() => expect(successCount('Đã thu hồi quyền.')).toBe(1));
      });
    });

    describe('Duyệt ca', () => {
      const openShifts = async () => {
        renderPage();
        await screen.findByText('Lan');
        goTab('Duyệt ca');
        await screen.findByText('09/03 – 15/03');
        await screen.findAllByText('Chờ duyệt');
      };
      const APPROVE_S1 = 'Duyệt ca Lan T3 10/03';
      const APPROVE_S2 = 'Duyệt ca Lan T4 11/03';
      const REJECT_S1 = 'Từ chối ca Lan T3 10/03';
      const REJECT_S2 = 'Từ chối ca Lan T4 11/03';
      const typeRejectReason = () => fireEvent.change(screen.getByLabelText('Lý do'), { target: { value: 'Đủ người' } });

      it('chạm đúp "Duyệt" một ca chỉ duyệt một lần; đang duyệt nút aria-busy', async () => {
        const d = deferred();
        mocks.approveShift.mockReturnValueOnce(d.promise);
        await openShifts();
        const approve = btn(APPROVE_S1);
        await sameFrame(approve, approve);
        expect(mocks.approveShift).toHaveBeenCalledTimes(1);
        await busy(APPROVE_S1);
        await act(async () => d.resolve({ approved: true }));
        await waitFor(() => expect(successCount('Đã duyệt ca.')).toBe(1));
        expect(mocks.approveShift).toHaveBeenCalledTimes(1);
      });

      it('duyệt lỗi thì nhả khoá, bấm lại gọi lần hai', async () => {
        mocks.approveShift.mockRejectedValueOnce(new Error('Ca không còn chờ duyệt'));
        await openShifts();
        fireEvent.click(btn(APPROVE_S1));
        await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Ca không còn chờ duyệt', type: 'error' }));
        fireEvent.click(btn(APPROVE_S1));
        await waitFor(() => expect(mocks.approveShift).toHaveBeenCalledTimes(2));
      });

      it('duyệt xong thì nhả khoá: bấm duyệt lại ca đó (danh sách chưa đổi) gọi lần hai', async () => {
        await openShifts();
        fireEvent.click(btn(APPROVE_S1));
        await waitFor(() => expect(successCount('Đã duyệt ca.')).toBe(1));
        await waitFor(() => expect(btn(APPROVE_S1)).not.toHaveAttribute('aria-busy'));
        fireEvent.click(btn(APPROVE_S1));
        await waitFor(() => expect(mocks.approveShift).toHaveBeenCalledTimes(2));
      });

      it('duyệt hai ca khác nhau trong cùng một khung hình: cả hai đều gọi API', async () => {
        const d1 = deferred();
        const d2 = deferred();
        mocks.approveShift.mockReturnValueOnce(d1.promise).mockReturnValueOnce(d2.promise);
        await openShifts();
        await sameFrame(btn(APPROVE_S1), btn(APPROVE_S2));
        expect(mocks.approveShift).toHaveBeenCalledTimes(2);
        expect(mocks.approveShift).toHaveBeenNthCalledWith(1, 's1', undefined);
        expect(mocks.approveShift).toHaveBeenNthCalledWith(2, 's2', undefined);
        await act(async () => {
          d1.resolve({ approved: true });
          d2.resolve({ approved: true });
        });
        await waitFor(() => expect(successCount('Đã duyệt ca.')).toBe(2));
      });

      it('duyệt ca A rồi ca B song song, B xong trước: nút của A và "Duyệt tất cả" vẫn aria-busy tới khi A xong', async () => {
        const dA = deferred();
        const dB = deferred();
        mocks.approveShift.mockReturnValueOnce(dA.promise).mockReturnValueOnce(dB.promise);
        await openShifts();
        await sameFrame(btn(APPROVE_S1), btn(APPROVE_S2));
        expect(mocks.approveShift).toHaveBeenCalledTimes(2);
        await busy(APPROVE_S2);
        await busy(APPROVE_S1);
        await busy('Duyệt tất cả (2)');
        await act(async () => dB.resolve({ approved: true }));
        await waitFor(() => expect(successCount('Đã duyệt ca.')).toBe(1));
        await waitFor(() => expect(btn(APPROVE_S2)).not.toHaveAttribute('aria-busy'));
        expect(btn(APPROVE_S1)).toHaveAttribute('aria-busy', 'true');
        expect(btn('Duyệt tất cả (2)')).toHaveAttribute('aria-busy', 'true');
        await act(async () => dA.resolve({ approved: true }));
        await waitFor(() => expect(successCount('Đã duyệt ca.')).toBe(2));
        await waitFor(() => expect(btn(APPROVE_S1)).not.toHaveAttribute('aria-busy'));
        expect(btn(APPROVE_S2)).not.toHaveAttribute('aria-busy');
        expect(btn('Duyệt tất cả (2)')).not.toHaveAttribute('aria-busy');
      });

      it('chạm đúp "Duyệt với giờ đã chỉnh" chỉ duyệt một lần', async () => {
        const d = deferred();
        mocks.approveShift.mockReturnValueOnce(d.promise);
        await openShifts();
        fireEvent.click(btn('Chỉnh giờ Lan T3 10/03'));
        fireEvent.change(screen.getByLabelText('Bắt đầu'), { target: { value: '09:00' } });
        const adjusted = btn('Duyệt với giờ đã chỉnh');
        await sameFrame(adjusted, adjusted);
        expect(mocks.approveShift).toHaveBeenCalledTimes(1);
        expect(mocks.approveShift).toHaveBeenCalledWith('s1', { approvedStart: vn('2026-03-10', '09:00'), approvedEnd: vn('2026-03-10', '12:00') });
        await busy('Duyệt với giờ đã chỉnh');
        await act(async () => d.resolve({ approved: true }));
        await waitFor(() => expect(successCount('Đã duyệt ca.')).toBe(1));
        expect(mocks.approveShift).toHaveBeenCalledTimes(1);
      });

      it('duyệt với giờ đã chỉnh lỗi thì nhả khoá, bấm lại gọi lần hai', async () => {
        mocks.approveShift.mockRejectedValueOnce(new Error('Giờ không hợp lệ'));
        await openShifts();
        fireEvent.click(btn('Chỉnh giờ Lan T3 10/03'));
        fireEvent.click(btn('Duyệt với giờ đã chỉnh'));
        await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Giờ không hợp lệ', type: 'error' }));
        fireEvent.click(btn('Duyệt với giờ đã chỉnh'));
        await waitFor(() => expect(mocks.approveShift).toHaveBeenCalledTimes(2));
      });

      it('chạm đúp "Xác nhận từ chối" chỉ từ chối một lần', async () => {
        const d = deferred();
        mocks.rejectShift.mockReturnValueOnce(d.promise);
        await openShifts();
        fireEvent.click(btn(REJECT_S1));
        typeRejectReason();
        const confirm = btn('Xác nhận từ chối');
        await sameFrame(confirm, confirm);
        expect(mocks.rejectShift).toHaveBeenCalledTimes(1);
        expect(mocks.rejectShift).toHaveBeenCalledWith('s1', 'Đủ người');
        await busy('Xác nhận từ chối');
        await act(async () => d.resolve({ rejected: true }));
        await waitFor(() => expect(successCount('Đã từ chối ca.')).toBe(1));
        expect(mocks.rejectShift).toHaveBeenCalledTimes(1);
      });

      it('từ chối lỗi thì nhả khoá, bấm lại gọi lần hai', async () => {
        mocks.rejectShift.mockRejectedValueOnce(new Error('Ca đã được duyệt'));
        await openShifts();
        fireEvent.click(btn(REJECT_S1));
        typeRejectReason();
        fireEvent.click(btn('Xác nhận từ chối'));
        await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Ca đã được duyệt', type: 'error' }));
        fireEvent.click(btn('Xác nhận từ chối'));
        await waitFor(() => expect(mocks.rejectShift).toHaveBeenCalledTimes(2));
      });

      it('Duyệt rồi Xác nhận từ chối cùng một ca trong một khung hình: chỉ lệnh đầu gọi API', async () => {
        const d = deferred();
        mocks.approveShift.mockReturnValueOnce(d.promise);
        await openShifts();
        fireEvent.click(btn(REJECT_S1));
        typeRejectReason();
        await sameFrame(btn(APPROVE_S1), btn('Xác nhận từ chối'));
        expect(mocks.approveShift).toHaveBeenCalledTimes(1);
        expect(mocks.rejectShift).not.toHaveBeenCalled();
        await act(async () => d.resolve({ approved: true }));
        await waitFor(() => expect(successCount('Đã duyệt ca.')).toBe(1));
        expect(mocks.rejectShift).not.toHaveBeenCalled();
      });

      it('Xác nhận từ chối rồi Duyệt cùng một ca trong một khung hình: chỉ lệnh đầu gọi API', async () => {
        const d = deferred();
        mocks.rejectShift.mockReturnValueOnce(d.promise);
        await openShifts();
        fireEvent.click(btn(REJECT_S1));
        typeRejectReason();
        await sameFrame(btn('Xác nhận từ chối'), btn(APPROVE_S1));
        expect(mocks.rejectShift).toHaveBeenCalledTimes(1);
        expect(mocks.approveShift).not.toHaveBeenCalled();
        await act(async () => d.resolve({ rejected: true }));
        await waitFor(() => expect(successCount('Đã từ chối ca.')).toBe(1));
        expect(mocks.approveShift).not.toHaveBeenCalled();
      });

      it('từ chối ca này, duyệt ca khác trong cùng một khung hình: cả hai đều gọi API', async () => {
        const d1 = deferred();
        const d2 = deferred();
        mocks.approveShift.mockReturnValueOnce(d1.promise);
        mocks.rejectShift.mockReturnValueOnce(d2.promise);
        await openShifts();
        fireEvent.click(btn(REJECT_S1));
        typeRejectReason();
        await sameFrame(btn(APPROVE_S2), btn('Xác nhận từ chối'));
        expect(mocks.approveShift).toHaveBeenCalledWith('s2', undefined);
        expect(mocks.rejectShift).toHaveBeenCalledWith('s1', 'Đủ người');
        await act(async () => {
          d1.resolve({ approved: true });
          d2.resolve({ rejected: true });
        });
        await waitFor(() => expect(successCount('Đã từ chối ca.')).toBe(1));
      });

      it('từ chối ca A khi ca A còn chạy rồi từ chối ca B: cả hai đều gọi API, xong hết thì không còn khoá nào kẹt', async () => {
        const dA = deferred();
        const dB = deferred();
        mocks.rejectShift.mockReturnValueOnce(dA.promise).mockReturnValueOnce(dB.promise);
        await openShifts();
        fireEvent.click(btn(REJECT_S1));
        typeRejectReason();
        await sameFrame(btn('Xác nhận từ chối'));
        expect(mocks.rejectShift).toHaveBeenCalledTimes(1);
        expect(mocks.rejectShift).toHaveBeenNthCalledWith(1, 's1', 'Đủ người');
        await busy('Xác nhận từ chối');
        // Tấm của ca A chỉ tự đóng khi thành công: đóng tay rồi mở tấm của ca B trong lúc A còn chạy.
        fireEvent.click(btn('Đóng'));
        fireEvent.click(btn(REJECT_S2));
        fireEvent.change(screen.getByLabelText('Lý do'), { target: { value: 'Trùng ca' } });
        await sameFrame(btn('Xác nhận từ chối'));
        expect(mocks.rejectShift).toHaveBeenCalledTimes(2);
        expect(mocks.rejectShift).toHaveBeenNthCalledWith(2, 's2', 'Trùng ca');
        await busy(APPROVE_S1);
        await busy(APPROVE_S2);
        await busy('Duyệt tất cả (2)');
        await act(async () => dA.resolve({ rejected: true }));
        await waitFor(() => expect(successCount('Đã từ chối ca.')).toBe(1));
        await waitFor(() => expect(btn(APPROVE_S1)).not.toHaveAttribute('aria-busy'));
        expect(btn(APPROVE_S2)).toHaveAttribute('aria-busy', 'true');
        expect(btn('Duyệt tất cả (2)')).toHaveAttribute('aria-busy', 'true');
        await act(async () => dB.resolve({ rejected: true }));
        await waitFor(() => expect(successCount('Đã từ chối ca.')).toBe(2));
        await waitFor(() => expect(btn(APPROVE_S2)).not.toHaveAttribute('aria-busy'));
        expect(btn(APPROVE_S1)).not.toHaveAttribute('aria-busy');
        expect(btn('Duyệt tất cả (2)')).not.toHaveAttribute('aria-busy');
        fireEvent.click(btn('Duyệt tất cả (2)'));
        await waitFor(() => expect(mocks.bulkApproveShifts).toHaveBeenCalledWith(['s1', 's2']));
        expect(mocks.rejectShift).toHaveBeenCalledTimes(2);
      });

      it('duyệt lỗi nhả khoá chung: từ chối đúng ca đó sau đó gọi được; từ chối lỗi nhả khoá chung: duyệt lại gọi được', async () => {
        mocks.approveShift.mockRejectedValueOnce(new Error('Mất kết nối'));
        mocks.rejectShift.mockRejectedValueOnce(new Error('Mất kết nối 2'));
        await openShifts();
        fireEvent.click(btn(REJECT_S1));
        typeRejectReason();
        fireEvent.click(btn(APPROVE_S1));
        await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Mất kết nối', type: 'error' }));
        fireEvent.click(btn('Xác nhận từ chối'));
        await waitFor(() => expect(mocks.rejectShift).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Mất kết nối 2', type: 'error' }));
        fireEvent.click(btn(APPROVE_S1));
        await waitFor(() => expect(mocks.approveShift).toHaveBeenCalledTimes(2));
      });

      it('chạm đúp "Duyệt tất cả" chỉ gửi một lần; đang gửi nút aria-busy', async () => {
        const d = deferred();
        mocks.bulkApproveShifts.mockReturnValueOnce(d.promise);
        await openShifts();
        const all = btn('Duyệt tất cả (2)');
        await sameFrame(all, all);
        expect(mocks.bulkApproveShifts).toHaveBeenCalledTimes(1);
        expect(mocks.bulkApproveShifts).toHaveBeenCalledWith(['s1', 's2']);
        await busy('Duyệt tất cả (2)');
        await act(async () => d.resolve({ approved: 2 }));
        await waitFor(() => expect(successCount('Đã duyệt 2 ca.')).toBe(1));
        expect(mocks.bulkApproveShifts).toHaveBeenCalledTimes(1);
      });

      it('"Duyệt tất cả" lỗi thì nhả khoá, bấm lại gọi lần hai', async () => {
        mocks.bulkApproveShifts.mockRejectedValueOnce(new Error('Mất kết nối'));
        await openShifts();
        fireEvent.click(btn('Duyệt tất cả (2)'));
        await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Mất kết nối', type: 'error' }));
        fireEvent.click(btn('Duyệt tất cả (2)'));
        await waitFor(() => expect(mocks.bulkApproveShifts).toHaveBeenCalledTimes(2));
      });

      it('"Duyệt tất cả" rồi Duyệt một ca trong một khung hình: chỉ "Duyệt tất cả" gọi API', async () => {
        const d = deferred();
        mocks.bulkApproveShifts.mockReturnValueOnce(d.promise);
        await openShifts();
        await sameFrame(btn('Duyệt tất cả (2)'), btn(APPROVE_S1));
        expect(mocks.bulkApproveShifts).toHaveBeenCalledTimes(1);
        expect(mocks.approveShift).not.toHaveBeenCalled();
        await act(async () => d.resolve({ approved: 2 }));
        await waitFor(() => expect(successCount('Đã duyệt 2 ca.')).toBe(1));
        expect(mocks.approveShift).not.toHaveBeenCalled();
      });

      it('Duyệt một ca rồi "Duyệt tất cả" trong một khung hình: chỉ ca đó gọi API', async () => {
        const d = deferred();
        mocks.approveShift.mockReturnValueOnce(d.promise);
        await openShifts();
        await sameFrame(btn(APPROVE_S1), btn('Duyệt tất cả (2)'));
        expect(mocks.approveShift).toHaveBeenCalledTimes(1);
        expect(mocks.bulkApproveShifts).not.toHaveBeenCalled();
        await act(async () => d.resolve({ approved: true }));
        await waitFor(() => expect(successCount('Đã duyệt ca.')).toBe(1));
        expect(mocks.bulkApproveShifts).not.toHaveBeenCalled();
      });

      it('"Duyệt tất cả" lỗi nhả khoá chung: duyệt một ca sau đó gọi được', async () => {
        mocks.bulkApproveShifts.mockRejectedValueOnce(new Error('Mất kết nối'));
        await openShifts();
        fireEvent.click(btn('Duyệt tất cả (2)'));
        await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Mất kết nối', type: 'error' }));
        fireEvent.click(btn(APPROVE_S2));
        await waitFor(() => expect(mocks.approveShift).toHaveBeenCalledWith('s2', undefined));
      });

      describe('Ca chuẩn', () => {
        const TWO_TEMPLATES = [
          { id: 't1', name: 'Ca sáng', startMin: 480, endMin: 720, active: true, sortOrder: 1 },
          { id: 't2', name: 'Ca chiều', startMin: 780, endMin: 1020, active: true, sortOrder: 2 },
        ];
        const openTemplates = async () => {
          await openShifts();
          fireEvent.click(btn('Ca chuẩn'));
          await screen.findByText('Ca sáng · 08:00–12:00');
        };
        const typeTemplate = () => fireEvent.change(screen.getByLabelText('Tên ca'), { target: { value: 'Ca tối' } });

        it('chạm đúp "Thêm ca chuẩn" chỉ thêm một ca', async () => {
          const d = deferred();
          mocks.createTemplate.mockReturnValueOnce(d.promise);
          await openTemplates();
          typeTemplate();
          await waitFor(() => expect(btn('Thêm ca chuẩn')).toBeEnabled());
          const add = btn('Thêm ca chuẩn');
          await sameFrame(add, add);
          expect(mocks.createTemplate).toHaveBeenCalledTimes(1);
          expect(mocks.createTemplate).toHaveBeenCalledWith({ name: 'Ca tối', startMin: 480, endMin: 720 });
          await busy('Thêm ca chuẩn');
          await act(async () => d.resolve({}));
          await waitFor(() => expect(successCount('Đã thêm ca chuẩn.')).toBe(1));
          expect(mocks.createTemplate).toHaveBeenCalledTimes(1);
        });

        it('thêm ca chuẩn lỗi thì nhả khoá, bấm lại gọi lần hai', async () => {
          mocks.createTemplate.mockRejectedValueOnce(new Error('Tên ca bị trùng'));
          await openTemplates();
          typeTemplate();
          await waitFor(() => expect(btn('Thêm ca chuẩn')).toBeEnabled());
          fireEvent.click(btn('Thêm ca chuẩn'));
          await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Tên ca bị trùng', type: 'error' }));
          fireEvent.click(btn('Thêm ca chuẩn'));
          await waitFor(() => expect(mocks.createTemplate).toHaveBeenCalledTimes(2));
        });

        it('chạm đúp "Xoá" một ca chuẩn chỉ xoá một lần; nút đang xoá aria-busy mà không disabled (giữ focus)', async () => {
          const d = deferred();
          mocks.deleteTemplate.mockReturnValueOnce(d.promise);
          await openTemplates();
          const del = btn('Xoá ca chuẩn Ca sáng');
          await sameFrame(del, del);
          expect(mocks.deleteTemplate).toHaveBeenCalledTimes(1);
          await busy('Xoá ca chuẩn Ca sáng');
          expect(btn('Xoá ca chuẩn Ca sáng')).not.toBeDisabled();
          await act(async () => d.resolve({ deleted: true }));
          await waitFor(() => expect(btn('Xoá ca chuẩn Ca sáng')).not.toHaveAttribute('aria-busy'));
          expect(mocks.deleteTemplate).toHaveBeenCalledTimes(1);
        });

        it('xoá hai ca chuẩn khác nhau trong cùng một khung hình: chỉ ca đầu gọi API, dòng còn lại bị khoá', async () => {
          const d = deferred();
          mocks.adminGetTemplates.mockResolvedValue(TWO_TEMPLATES);
          mocks.deleteTemplate.mockReturnValueOnce(d.promise);
          await openTemplates();
          await sameFrame(btn('Xoá ca chuẩn Ca sáng'), btn('Xoá ca chuẩn Ca chiều'));
          expect(mocks.deleteTemplate).toHaveBeenCalledTimes(1);
          expect(mocks.deleteTemplate).toHaveBeenCalledWith('t1');
          await busy('Xoá ca chuẩn Ca sáng');
          expect(btn('Xoá ca chuẩn Ca chiều')).toBeDisabled();
          await act(async () => d.resolve({ deleted: true }));
          await waitFor(() => expect(btn('Xoá ca chuẩn Ca chiều')).toBeEnabled());
        });

        it('xoá ca chuẩn lỗi thì nhả khoá, bấm lại gọi lần hai', async () => {
          mocks.deleteTemplate.mockRejectedValueOnce(new Error('Không xoá được'));
          await openTemplates();
          fireEvent.click(btn('Xoá ca chuẩn Ca sáng'));
          await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Không xoá được', type: 'error' }));
          await waitFor(() => expect(btn('Xoá ca chuẩn Ca sáng')).not.toHaveAttribute('aria-busy'));
          fireEvent.click(btn('Xoá ca chuẩn Ca sáng'));
          await waitFor(() => expect(mocks.deleteTemplate).toHaveBeenCalledTimes(2));
        });
      });
    });

    describe('Lương', () => {
      const TWO_OPEN = [PAY_ROWS[0], { ...PAY_ROWS[0], staff: { id: 'u9', fullName: 'Cúc', phone: null } }];
      const openPayroll = async (rows: unknown[] = PAY_ROWS) => {
        mocks.adminGetPayroll.mockResolvedValue(rows);
        renderPage();
        await screen.findByText('Lan');
        goTab('Lương');
        await screen.findByRole('heading', { level: 2, name: 'Lương' });
        await screen.findAllByRole('button', { name: /^Xem giờ · / });
      };
      const openPaid = async (who: string) => {
        fireEvent.click(btn(`Đã chuyển · ${who}`));
        fireEvent.click(btn('Ảnh xác nhận chuyển khoản *'));
      };
      const confirmReopen = (who: string) => {
        fireEvent.click(btn(`Mở lại · ${who}`));
        fireEvent.click(btn('Mở lại bảng lương'));
      };

      it('chạm đúp "Lưu đơn giá" chỉ lưu một lần', async () => {
        const d = deferred();
        mocks.setRate.mockReturnValueOnce(d.promise);
        await openPayroll();
        fireEvent.click(btn('Đơn giá · Lan'));
        fireEvent.change(screen.getByLabelText('Đơn giá (VND/giờ)'), { target: { value: '35000' } });
        const save = btn('Lưu đơn giá');
        await sameFrame(save, save);
        expect(mocks.setRate).toHaveBeenCalledTimes(1);
        expect(mocks.setRate).toHaveBeenCalledWith('u1', 35000);
        await busy('Lưu đơn giá');
        await act(async () => d.resolve({}));
        await waitFor(() => expect(successCount('Đã lưu đơn giá.')).toBe(1));
        expect(mocks.setRate).toHaveBeenCalledTimes(1);
      });

      it('lưu đơn giá lỗi thì nhả khoá, bấm lại gọi lần hai', async () => {
        mocks.setRate.mockRejectedValueOnce(new Error('Đơn giá không hợp lệ'));
        await openPayroll();
        fireEvent.click(btn('Đơn giá · Lan'));
        fireEvent.click(btn('Lưu đơn giá'));
        await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đơn giá không hợp lệ', type: 'error' }));
        fireEvent.click(btn('Lưu đơn giá'));
        await waitFor(() => expect(mocks.setRate).toHaveBeenCalledTimes(2));
      });

      it('chạm đúp "Chốt" một dòng chỉ chốt một lần; nút đang chốt aria-busy mà không disabled', async () => {
        const d = deferred();
        mocks.finalizePayroll.mockReturnValueOnce(d.promise);
        await openPayroll();
        const finalize = btn('Chốt · Lan');
        await sameFrame(finalize, finalize);
        expect(mocks.finalizePayroll).toHaveBeenCalledTimes(1);
        expect(mocks.finalizePayroll).toHaveBeenCalledWith('u1', 2026, 3);
        await busy('Chốt · Lan');
        expect(btn('Chốt · Lan')).not.toBeDisabled();
        await act(async () => d.resolve({ finalized: true }));
        await waitFor(() => expect(successCount('Đã chốt lương.')).toBe(1));
        expect(mocks.finalizePayroll).toHaveBeenCalledTimes(1);
      });

      it('chốt lỗi thì nhả khoá, bấm lại gọi lần hai', async () => {
        mocks.finalizePayroll.mockRejectedValueOnce(new Error('Chưa đủ dữ liệu'));
        await openPayroll();
        fireEvent.click(btn('Chốt · Lan'));
        await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Chưa đủ dữ liệu', type: 'error' }));
        fireEvent.click(btn('Chốt · Lan'));
        await waitFor(() => expect(mocks.finalizePayroll).toHaveBeenCalledTimes(2));
      });

      it('chốt hai nhân viên trong cùng một khung hình: chỉ dòng đầu gọi API (một việc mỗi lúc)', async () => {
        const d = deferred();
        mocks.finalizePayroll.mockReturnValueOnce(d.promise);
        await openPayroll(TWO_OPEN);
        await sameFrame(btn('Chốt · Lan'), btn('Chốt · Cúc'));
        expect(mocks.finalizePayroll).toHaveBeenCalledTimes(1);
        expect(mocks.finalizePayroll).toHaveBeenCalledWith('u1', 2026, 3);
        await act(async () => d.resolve({ finalized: true }));
        await waitFor(() => expect(successCount('Đã chốt lương.')).toBe(1));
        expect(mocks.finalizePayroll).toHaveBeenCalledTimes(1);
      });

      it('chạm đúp "Mở lại bảng lương" ở tấm xác nhận chỉ mở lại một lần', async () => {
        const d = deferred();
        mocks.reopenPayroll.mockReturnValueOnce(d.promise);
        await openPayroll();
        fireEvent.click(btn('Mở lại · Bình'));
        const confirm = btn('Mở lại bảng lương');
        await sameFrame(confirm, confirm);
        expect(mocks.reopenPayroll).toHaveBeenCalledTimes(1);
        expect(mocks.reopenPayroll).toHaveBeenCalledWith('u3', 2026, 3);
        await busy('Mở lại · Bình');
        expect(btn('Mở lại · Bình')).not.toBeDisabled();
        await act(async () => d.resolve({ status: 'OPEN' }));
        await waitFor(() => expect(successCount('Đã mở lại bảng lương — sửa xong nhớ chốt lại.')).toBe(1));
        expect(mocks.reopenPayroll).toHaveBeenCalledTimes(1);
      });

      it('xác nhận Mở lại khi việc khác đang giữ khoá: lệnh bị bỏ nhưng tấm vẫn mở và báo bận; hết bận thì xác nhận mới mở lại và đóng tấm', async () => {
        const d = deferred();
        mocks.finalizePayroll.mockReturnValueOnce(d.promise);
        await openPayroll();
        fireEvent.click(btn('Mở lại · Bình'));
        const reopenMessage = /^Mở lại bảng lương T3\/2026 của Bình/;
        expect(screen.getByText(reopenMessage)).toBeInTheDocument();
        await sameFrame(btn('Chốt · Lan'), btn('Mở lại bảng lương'));
        expect(mocks.finalizePayroll).toHaveBeenCalledTimes(1);
        expect(mocks.reopenPayroll).not.toHaveBeenCalled();
        expect(screen.getByText(reopenMessage)).toBeInTheDocument();
        await busy('Mở lại bảng lương');
        await act(async () => d.resolve({ finalized: true }));
        await waitFor(() => expect(successCount('Đã chốt lương.')).toBe(1));
        await waitFor(() => expect(btn('Mở lại bảng lương')).not.toHaveAttribute('aria-busy'));
        expect(screen.getByText(reopenMessage)).toBeInTheDocument();
        fireEvent.click(btn('Mở lại bảng lương'));
        await waitFor(() => expect(mocks.reopenPayroll).toHaveBeenCalledWith('u3', 2026, 3));
        expect(mocks.reopenPayroll).toHaveBeenCalledTimes(1);
        await waitFor(() => expect(screen.queryByText(reopenMessage)).toBeNull());
      });

      it('mở lại lỗi thì nhả khoá, mở lại lần hai gọi API lần hai', async () => {
        mocks.reopenPayroll.mockRejectedValueOnce(new Error('Không mở lại được'));
        await openPayroll();
        confirmReopen('Bình');
        await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Không mở lại được', type: 'error' }));
        await waitFor(() => expect(btn('Mở lại · Bình')).not.toHaveAttribute('aria-busy'));
        confirmReopen('Bình');
        await waitFor(() => expect(mocks.reopenPayroll).toHaveBeenCalledTimes(2));
      });

      it('chạm đúp "Đánh dấu đã trả" chỉ ghi đã trả một lần', async () => {
        const d = deferred();
        mocks.markPaid.mockReturnValueOnce(d.promise);
        await openPayroll();
        await openPaid('Lan');
        const paid = btn('Đánh dấu đã trả');
        await sameFrame(paid, paid);
        expect(mocks.markPaid).toHaveBeenCalledTimes(1);
        expect(mocks.markPaid).toHaveBeenCalledWith('u1', { year: 2026, month: 3, proofImageUrl: 'https://img.test/proof.png', note: undefined });
        await busy('Đánh dấu đã trả');
        await act(async () => d.resolve({ paid: true }));
        await waitFor(() => expect(successCount('Đã đánh dấu đã trả lương.')).toBe(1));
        expect(mocks.markPaid).toHaveBeenCalledTimes(1);
      });

      it('đánh dấu đã trả lỗi thì nhả khoá, bấm lại gọi lần hai', async () => {
        mocks.markPaid.mockRejectedValueOnce(new Error('Ảnh không hợp lệ'));
        await openPayroll();
        await openPaid('Lan');
        fireEvent.click(btn('Đánh dấu đã trả'));
        await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Ảnh không hợp lệ', type: 'error' }));
        fireEvent.click(btn('Đánh dấu đã trả'));
        await waitFor(() => expect(mocks.markPaid).toHaveBeenCalledTimes(2));
      });

      it('Chốt rồi Đánh dấu đã trả cùng một dòng trong một khung hình: chỉ lệnh đầu gọi API', async () => {
        const d = deferred();
        mocks.finalizePayroll.mockReturnValueOnce(d.promise);
        await openPayroll();
        await openPaid('Lan');
        await sameFrame(btn('Chốt · Lan'), btn('Đánh dấu đã trả'));
        expect(mocks.finalizePayroll).toHaveBeenCalledTimes(1);
        expect(mocks.markPaid).not.toHaveBeenCalled();
        await act(async () => d.resolve({ finalized: true }));
        await waitFor(() => expect(successCount('Đã chốt lương.')).toBe(1));
        expect(mocks.markPaid).not.toHaveBeenCalled();
      });

      it('Đánh dấu đã trả rồi Chốt cùng một dòng trong một khung hình: chỉ lệnh đầu gọi API', async () => {
        const d = deferred();
        mocks.markPaid.mockReturnValueOnce(d.promise);
        await openPayroll();
        await openPaid('Lan');
        await sameFrame(btn('Đánh dấu đã trả'), btn('Chốt · Lan'));
        expect(mocks.markPaid).toHaveBeenCalledTimes(1);
        expect(mocks.finalizePayroll).not.toHaveBeenCalled();
        await act(async () => d.resolve({ paid: true }));
        await waitFor(() => expect(successCount('Đã đánh dấu đã trả lương.')).toBe(1));
        expect(mocks.finalizePayroll).not.toHaveBeenCalled();
      });

      it('Mở lại rồi Đánh dấu đã trả cùng một dòng trong một khung hình: chỉ lệnh đầu gọi API', async () => {
        const d = deferred();
        mocks.reopenPayroll.mockReturnValueOnce(d.promise);
        await openPayroll();
        await openPaid('0912345678');
        fireEvent.click(btn('Mở lại · 0912345678'));
        await sameFrame(btn('Mở lại bảng lương'), btn('Đánh dấu đã trả'));
        expect(mocks.reopenPayroll).toHaveBeenCalledTimes(1);
        expect(mocks.markPaid).not.toHaveBeenCalled();
        await act(async () => d.resolve({ status: 'OPEN' }));
        await waitFor(() => expect(successCount('Đã mở lại bảng lương — sửa xong nhớ chốt lại.')).toBe(1));
        expect(mocks.markPaid).not.toHaveBeenCalled();
      });

      it('chốt lỗi nhả khoá chung: đánh dấu đã trả sau đó gọi được; đánh dấu đã trả lỗi nhả khoá chung: chốt lại gọi được', async () => {
        mocks.finalizePayroll.mockRejectedValueOnce(new Error('Chưa đủ dữ liệu'));
        mocks.markPaid.mockRejectedValueOnce(new Error('Ảnh không hợp lệ'));
        await openPayroll();
        await openPaid('Lan');
        fireEvent.click(btn('Chốt · Lan'));
        await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Chưa đủ dữ liệu', type: 'error' }));
        fireEvent.click(btn('Đánh dấu đã trả'));
        await waitFor(() => expect(mocks.markPaid).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Ảnh không hợp lệ', type: 'error' }));
        fireEvent.click(btn('Chốt · Lan'));
        await waitFor(() => expect(mocks.finalizePayroll).toHaveBeenCalledTimes(2));
      });

      it('mở lại lỗi nhả khoá chung: chốt dòng khác sau đó gọi được', async () => {
        mocks.reopenPayroll.mockRejectedValueOnce(new Error('Không mở lại được'));
        await openPayroll();
        confirmReopen('Bình');
        await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Không mở lại được', type: 'error' }));
        await waitFor(() => expect(btn('Chốt · Lan')).toBeEnabled());
        fireEvent.click(btn('Chốt · Lan'));
        await waitFor(() => expect(mocks.finalizePayroll).toHaveBeenCalledWith('u1', 2026, 3));
      });

      describe('Sửa giờ phiên', () => {
        const openEdit = async () => {
          await openPayroll();
          fireEvent.click(btn('Xem giờ · Lan'));
          fireEvent.click(await screen.findByRole('button', { name: 'Sửa giờ phiên 08:00' }));
          fireEvent.change(screen.getByLabelText('Giờ ra'), { target: { value: '12:45' } });
        };

        it('chạm đúp "Lưu giờ" chỉ sửa phiên một lần', async () => {
          const d = deferred();
          mocks.adminEditSession.mockReturnValueOnce(d.promise);
          await openEdit();
          const save = btn('Lưu giờ');
          await sameFrame(save, save);
          expect(mocks.adminEditSession).toHaveBeenCalledTimes(1);
          expect(mocks.adminEditSession).toHaveBeenCalledWith('ss1', { checkinAt: vn('2026-03-02', '08:00'), checkoutAt: vn('2026-03-02', '12:45') });
          await busy('Lưu giờ');
          await act(async () => d.resolve({ updated: true }));
          await waitFor(() => expect(successCount('Đã sửa giờ & tính lại.')).toBe(1));
          expect(mocks.adminEditSession).toHaveBeenCalledTimes(1);
        });

        it('sửa giờ lỗi thì nhả khoá, bấm lại gọi lần hai', async () => {
          mocks.adminEditSession.mockRejectedValueOnce(new Error('Giờ ra trước giờ vào'));
          await openEdit();
          fireEvent.click(btn('Lưu giờ'));
          await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Giờ ra trước giờ vào', type: 'error' }));
          fireEvent.click(btn('Lưu giờ'));
          await waitFor(() => expect(mocks.adminEditSession).toHaveBeenCalledTimes(2));
        });
      });
    });
  });
  describe('ảnh xác nhận chuyển khoản còn đang lên (W90A)', () => {
    const openPaySheet = async () => {
      mocks.adminGetPayroll.mockResolvedValue(PAY_ROWS);
      renderPage();
      await screen.findByText('Lan');
      goTab('Lương');
      await screen.findByText('14h30 · 30.000đ/h · Đang tính');
      fireEvent.click(screen.getByRole('button', { name: 'Đã chuyển · Lan' }));
      await screen.findByRole('heading', { level: 2, name: 'Xác nhận đã chuyển · Lan' });
    };
    const startUpload = () => act(() => mocks.picker.onBusyChange(true));
    const finishUpload = (url: string) =>
      act(() => {
        mocks.picker.onChange(url);
        mocks.picker.onBusyChange(false);
      });

    it('đổi ảnh khác: lúc ảnh mới còn lên, nút khoá + đổi nhãn, bấm không đánh dấu đã trả, tấm không đóng được; xong thì gửi ảnh MỚI', async () => {
      await openPaySheet();
      fireEvent.click(screen.getByRole('button', { name: 'Ảnh xác nhận chuyển khoản *' }));
      expect(screen.getByRole('button', { name: 'Đánh dấu đã trả' })).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Đóng' })).toBeInTheDocument();

      startUpload();
      const waiting = screen.getByRole('button', { name: t.common.imagesUploading });
      expect(waiting).toBeDisabled();
      fireEvent.click(waiting);
      expect(mocks.markPaid).not.toHaveBeenCalled();
      expect(screen.queryByRole('button', { name: 'Đóng' })).toBeNull();

      finishUpload('https://img.test/moi.png');
      const save = await screen.findByRole('button', { name: 'Đánh dấu đã trả' });
      expect(save).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Đóng' })).toBeInTheDocument();
      fireEvent.click(save);
      await waitFor(() => expect(mocks.markPaid).toHaveBeenCalledTimes(1));
      expect(mocks.markPaid).toHaveBeenCalledWith('u1', { year: 2026, month: 3, proofImageUrl: 'https://img.test/moi.png', note: undefined });
    });

    it('đang lưu thì ô ảnh khoá: đổi ảnh lúc này không vào bản đang gửi', async () => {
      let release!: (v: unknown) => void;
      mocks.markPaid.mockReturnValueOnce(new Promise((r) => (release = r)));
      await openPaySheet();
      fireEvent.click(screen.getByRole('button', { name: 'Ảnh xác nhận chuyển khoản *' }));
      expect(screen.getByRole('button', { name: 'Ảnh xác nhận chuyển khoản *' })).toBeEnabled();
      fireEvent.click(screen.getByRole('button', { name: 'Đánh dấu đã trả' }));
      await waitFor(() => expect(mocks.markPaid).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(screen.getByRole('button', { name: 'Ảnh xác nhận chuyển khoản *' })).toBeDisabled());
      expect(mocks.picker.disabled).toBe(true);
      await act(async () => release({ paid: true }));
      await waitFor(() => expect(screen.queryByText('Đánh dấu đã trả')).not.toBeInTheDocument());
    });
  });

  // W112A: lệnh ghi bị máy chủ từ chối vì màn đã cũ (400/404/409) thì nút giữ khoá tới khi dữ liệu làm mới về (tối đa LOCK_REFRESH_WAIT_MS), kẻo bấm lại trên số cũ nhận đúng lỗi đó. Mất mạng, quá hạn, 401, 5xx không nói gì về trạng thái thật: không tải lại, nhả ngay.
  describe('máy chủ từ chối thì giữ khoá tới khi dữ liệu làm mới về (W112A)', () => {
    type Refresh = () => Promise<unknown>;
    type Opened = {
      invalidate: MockInstance<QueryClient['invalidateQueries']>;
      /** Một lần người dùng bấm lệnh ghi, gồm cả các bước mở tấm xác nhận đứng trước nút gửi. */
      tap: () => void;
      /** Nút hiện aria-busy trong lúc lệnh giữ khoá. */
      busy: () => HTMLElement;
    };
    type Case = {
      name: string;
      /** Lệnh ghi bị giả lập. */
      write: ReturnType<typeof vi.fn>;
      /** Khoá tải lại kỳ vọng khi máy chủ từ chối, đúng thứ tự gọi. */
      keys: unknown[][];
      /** Giá trị lệnh ghi trả ở lần bấm lại sau khi nhả khoá. */
      succeed: unknown;
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
    const errorSnackbars = () => mocks.openSnackbar.mock.calls.filter(([a]) => a.type === 'error').length;
    // TanStack báo cache qua setTimeout(0): đợi một nhịp để `isPending` kịp về false sau khi lệnh xong.
    const settle = () =>
      act(async () => {
        await new Promise((r) => setTimeout(r, 30));
      });
    const btn = (name: string) => screen.getByRole('button', { name });
    const click = (name: string) => fireEvent.click(btn(name));
    /** Dựng trang và thay `invalidateQueries` để soi khoá tải lại và giữ lời hứa tải lại trong tay. */
    const renderLive = (refresh: Refresh) => {
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
      const invalidate = vi.spyOn(qc, 'invalidateQueries').mockImplementation((() => refresh()) as never);
      render(
        <QueryClientProvider client={qc}>
          <AdminPage />
        </QueryClientProvider>,
      );
      return invalidate;
    };
    const openPayroll = async (refresh: Refresh) => {
      const invalidate = renderLive(refresh);
      await screen.findByText('Lan');
      goTab('Lương');
      await screen.findByRole('heading', { level: 2, name: 'Lương' });
      await screen.findAllByRole('button', { name: /^Xem giờ · / });
      return invalidate;
    };
    const openShifts = async (refresh: Refresh) => {
      const invalidate = renderLive(refresh);
      await screen.findByText('Lan');
      goTab('Duyệt ca');
      await screen.findByText('09/03 – 15/03');
      await screen.findAllByText('Chờ duyệt');
      return invalidate;
    };
    const openTemplates = async (refresh: Refresh) => {
      const invalidate = await openShifts(refresh);
      click('Ca chuẩn');
      await screen.findByText('Ca sáng · 08:00–12:00');
      return invalidate;
    };

    // W113A: tấm "Đã chuyển" và tấm thu hồi đóng khi máy chủ từ chối 404/409 và dữ liệu mới đã về (hoặc quá hạn chờ), cùng lúc nhả khoá; sau đó muốn bấm lại thì phải mở lại tấm (đồng bộ, dùng được cả khi đồng hồ giả) rồi mới bấm nút xác nhận.
    const paidSendOpen = () => screen.queryByRole('button', { name: 'Đánh dấu đã trả' }) !== null;
    const reopenPaid = () => {
      click('Đã chuyển · Lan');
      const upload = btn('Ảnh xác nhận chuyển khoản *');
      // Ô ảnh bị khoá lúc lệnh còn chạy: mở lại trong lúc giữ khoá thì chưa có ảnh, nút gửi vẫn hiện trạng thái bận.
      if (!upload.hasAttribute('disabled')) fireEvent.click(upload);
    };
    const paidSend = () => {
      if (!paidSendOpen()) reopenPaid();
      const upload = btn('Ảnh xác nhận chuyển khoản *');
      if (!upload.hasAttribute('disabled')) fireEvent.click(upload);
      return btn('Đánh dấu đã trả');
    };
    // Trong lúc giữ khoá, nút "Thu hồi · Lan" của dòng bị khoá (disabled) nên tấm đã đóng KHÔNG mở lại được: thay vì nút trong tấm, trạng thái "đang giữ" đọc từ chính nút mở tấm (disabled ⇔ còn giữ).
    const revokeTrigger = () => btn('Thu hồi · Lan');
    const revokeLockProbe = () => {
      const probe = document.createElement('div');
      if (revokeTrigger().getAttribute('aria-disabled') === 'true') probe.setAttribute('aria-busy', 'true');
      return probe;
    };
    const revokeSend = () => {
      if (!screen.queryByRole('button', { name: 'Thu hồi' })) {
        fireEvent.click(revokeTrigger());
        const reason = screen.queryByLabelText('Lý do');
        if (reason) fireEvent.change(reason, { target: { value: 'Nghỉ việc' } });
      }
      const send = screen.queryByRole('button', { name: 'Thu hồi' });
      if (send) fireEvent.click(send);
    };

    // W114A: tấm đơn giá, tấm từ chối ca và tấm Thêm nhân sự đóng khi máy chủ từ chối 404/409 và dữ liệu mới đã về (hoặc quá hạn chờ), cùng lúc nhả khoá; sau đó muốn bấm lại thì phải mở lại tấm (đồng bộ, dùng được cả khi đồng hồ giả) rồi mới bấm nút gửi.
    const rateSend = () => {
      if (!screen.queryByRole('button', { name: 'Lưu đơn giá' })) {
        click('Đơn giá · Lan');
        fireEvent.change(screen.getByLabelText('Đơn giá (VND/giờ)'), { target: { value: '35000' } });
      }
      return 'Lưu đơn giá';
    };
    const rejectSend = () => {
      if (!screen.queryByRole('button', { name: 'Xác nhận từ chối' })) {
        click('Từ chối ca Lan T3 10/03');
        fireEvent.change(screen.getByLabelText('Lý do'), { target: { value: 'Đủ người' } });
      }
      return 'Xác nhận từ chối';
    };
    const grantSend = () => {
      if (!screen.queryByRole('button', { name: 'Lưu quyền' })) {
        click('Thêm');
        fireEvent.change(screen.getByLabelText('Số điện thoại'), { target: { value: '0901112223' } });
        fireEvent.change(screen.getByLabelText('Lý do'), { target: { value: 'Nhân viên mới' } });
      }
      return 'Lưu quyền';
    };

    const PAYROLL = [['admin-payroll', 2026, 3]];
    const SHIFT_KEYS = [['admin-shifts-pending'], ['admin-shifts', '2026-03-09']];
    const TEMPLATE_KEYS = [['admin-templates'], ['shift-templates']];
    const STAFF_KEYS = [['admin-staff']];

    const CASES: Case[] = [
      {
        name: 'lưu đơn giá (rateM)',
        write: mocks.setRate,
        keys: PAYROLL,
        succeed: {},
        open: async (refresh) => {
          const invalidate = await openPayroll(refresh);
          click('Đơn giá · Lan');
          fireEvent.change(screen.getByLabelText('Đơn giá (VND/giờ)'), { target: { value: '35000' } });
          return { invalidate, tap: () => click(rateSend()), busy: () => btn(rateSend()) };
        },
      },
      {
        name: 'chốt lương (finalizeM)',
        write: mocks.finalizePayroll,
        keys: PAYROLL,
        succeed: { finalized: true },
        open: async (refresh) => {
          const invalidate = await openPayroll(refresh);
          return { invalidate, tap: () => click('Chốt · Lan'), busy: () => btn('Chốt · Lan') };
        },
      },
      {
        name: 'mở lại bảng lương (reopenM)',
        write: mocks.reopenPayroll,
        keys: PAYROLL,
        succeed: { status: 'OPEN' },
        open: async (refresh) => {
          const invalidate = await openPayroll(refresh);
          return {
            invalidate,
            // Nút dòng đang `loading` thì bỏ qua cú chạm và không mở tấm xác nhận: chỉ bấm "Mở lại bảng lương" khi tấm thật sự mở.
            tap: () => {
              click('Mở lại · Bình');
              const confirm = screen.queryByRole('button', { name: 'Mở lại bảng lương' });
              if (confirm) fireEvent.click(confirm);
            },
            busy: () => btn('Mở lại · Bình'),
          };
        },
      },
      {
        name: 'đánh dấu đã trả (paidM)',
        write: mocks.markPaid,
        keys: PAYROLL,
        succeed: { paid: true },
        open: async (refresh) => {
          const invalidate = await openPayroll(refresh);
          click('Đã chuyển · Lan');
          click('Ảnh xác nhận chuyển khoản *');
          return { invalidate, tap: () => fireEvent.click(paidSend()), busy: paidSend };
        },
      },
      {
        name: 'sửa giờ phiên (editM)',
        write: mocks.adminEditSession,
        keys: [['admin-payroll-detail', 'u1', 2026, 3], ...PAYROLL],
        succeed: { updated: true },
        open: async (refresh) => {
          const invalidate = await openPayroll(refresh);
          click('Xem giờ · Lan');
          fireEvent.click(await screen.findByRole('button', { name: 'Sửa giờ phiên 08:00' }));
          fireEvent.change(screen.getByLabelText('Giờ ra'), { target: { value: '12:45' } });
          return { invalidate, tap: () => click('Lưu giờ'), busy: () => btn('Lưu giờ') };
        },
      },
      {
        name: 'duyệt ca (approveM)',
        write: mocks.approveShift,
        keys: SHIFT_KEYS,
        succeed: { approved: true },
        open: async (refresh) => {
          const invalidate = await openShifts(refresh);
          return { invalidate, tap: () => click('Duyệt ca Lan T3 10/03'), busy: () => btn('Duyệt ca Lan T3 10/03') };
        },
      },
      {
        name: 'từ chối ca (rejectM)',
        write: mocks.rejectShift,
        keys: SHIFT_KEYS,
        succeed: { rejected: true },
        open: async (refresh) => {
          const invalidate = await openShifts(refresh);
          click('Từ chối ca Lan T3 10/03');
          fireEvent.change(screen.getByLabelText('Lý do'), { target: { value: 'Đủ người' } });
          return { invalidate, tap: () => click(rejectSend()), busy: () => btn(rejectSend()) };
        },
      },
      {
        name: 'duyệt tất cả (bulkM)',
        write: mocks.bulkApproveShifts,
        keys: SHIFT_KEYS,
        succeed: { approved: 2 },
        open: async (refresh) => {
          const invalidate = await openShifts(refresh);
          return { invalidate, tap: () => click('Duyệt tất cả (2)'), busy: () => btn('Duyệt tất cả (2)') };
        },
      },
      {
        name: 'cấp quyền (grantM)',
        write: mocks.grantStaff,
        keys: STAFF_KEYS,
        succeed: { granted: 'STAFF', applied: true },
        open: async (refresh) => {
          const invalidate = renderLive(refresh);
          fireEvent.click(await screen.findByRole('button', { name: 'Thêm' }));
          fireEvent.change(screen.getByLabelText('Số điện thoại'), { target: { value: '0901112223' } });
          fireEvent.change(screen.getByLabelText('Lý do'), { target: { value: 'Nhân viên mới' } });
          return { invalidate, tap: () => click(grantSend()), busy: () => btn(grantSend()) };
        },
      },
      {
        name: 'thu hồi quyền (revokeM)',
        write: mocks.revokeStaff,
        keys: STAFF_KEYS,
        succeed: { revoked: 1, downgraded: false },
        open: async (refresh) => {
          const invalidate = renderLive(refresh);
          fireEvent.click(await screen.findByRole('button', { name: 'Thu hồi · Lan' }));
          fireEvent.change(screen.getByLabelText('Lý do'), { target: { value: 'Nghỉ việc' } });
          return { invalidate, tap: revokeSend, busy: revokeLockProbe };
        },
      },
      {
        name: 'thêm ca chuẩn (addM)',
        write: mocks.createTemplate,
        keys: TEMPLATE_KEYS,
        succeed: {},
        open: async (refresh) => {
          const invalidate = await openTemplates(refresh);
          fireEvent.change(screen.getByLabelText('Tên ca'), { target: { value: 'Ca tối' } });
          await waitFor(() => expect(btn('Thêm ca chuẩn')).toBeEnabled());
          return { invalidate, tap: () => click('Thêm ca chuẩn'), busy: () => btn('Thêm ca chuẩn') };
        },
      },
      {
        name: 'xoá ca chuẩn (delM)',
        write: mocks.deleteTemplate,
        keys: TEMPLATE_KEYS,
        succeed: { deleted: true },
        open: async (refresh) => {
          const invalidate = await openTemplates(refresh);
          return { invalidate, tap: () => click('Xoá ca chuẩn Ca sáng'), busy: () => btn('Xoá ca chuẩn Ca sáng') };
        },
      },
    ];

    describe.each(CASES)('$name', (c) => {
      it.each([
        [400, 'Việc này đã được xử lý rồi'],
        [404, 'Không tìm thấy nữa'],
        [409, 'Vừa có thay đổi, bạn thử lại nhé'],
      ])('bị từ chối %i: báo lỗi một lần, tải lại đúng khoá, nút giữ khoá tới khi dữ liệu về rồi mới nhả', async (status, message) => {
        c.write.mockRejectedValueOnce(serverError(message, status)).mockResolvedValue(c.succeed);
        const refresh = deferred();
        const { invalidate, tap, busy } = await c.open(() => refresh.promise);
        tap();
        await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: message, type: 'error' }));
        expect(errorSnackbars()).toBe(1);
        expect(invalidate.mock.calls.map(([filter]) => filter)).toEqual(c.keys.map((queryKey) => ({ queryKey })));
        // Đã có lời báo lỗi mà dữ liệu chưa về: nút vẫn bận, chạm thêm không gửi lần hai.
        expect(busy()).toHaveAttribute('aria-busy', 'true');
        // Tuần tự, không gộp một `act`: lệnh "Mở lại" phải vẽ xong tấm xác nhận rồi mới bấm được nút trong tấm. Khoá là ref nên không cần cùng khung hình.
        tap();
        tap();
        await settle();
        expect(c.write).toHaveBeenCalledTimes(1);
        expect(busy()).toHaveAttribute('aria-busy', 'true');
        await act(async () => refresh.resolve());
        await settle();
        await waitFor(() => expect(busy()).not.toHaveAttribute('aria-busy'));
        expect(errorSnackbars()).toBe(1);
        tap();
        await waitFor(() => expect(c.write).toHaveBeenCalledTimes(2));
      });

      it.each([
        ['mất mạng', new HttpError('Network Error', 'ERR_NETWORK')],
        ['hết thời gian', new HttpError('timeout', 'ECONNABORTED')],
        ['máy chủ lỗi 503', serverError('Service Unavailable', 503)],
        ['hết phiên 401', serverError('Unauthorized', 401)],
      ])('%s: không tải lại, khoá nhả ngay', async (_label, error) => {
        c.write.mockRejectedValueOnce(error).mockResolvedValue(c.succeed);
        const { invalidate, tap, busy } = await c.open(() => new Promise(() => undefined));
        tap();
        await waitFor(() => expect(errorSnackbars()).toBe(1));
        await waitFor(() => expect(busy()).not.toHaveAttribute('aria-busy'));
        expect(invalidate).not.toHaveBeenCalled();
        tap();
        await waitFor(() => expect(c.write).toHaveBeenCalledTimes(2));
      });

      it('tải lại treo mãi: khoá nhả đúng sau LOCK_REFRESH_WAIT_MS', async () => {
        c.write.mockRejectedValueOnce(serverError('Vừa có thay đổi, bạn thử lại nhé', 409)).mockResolvedValue(c.succeed);
        const { tap, busy } = await c.open(() => new Promise(() => undefined));
        // beforeEach chỉ giả Date: muốn tua setTimeout của settleWithin thì phải dựng lại đồng hồ giả đầy đủ.
        vi.useRealTimers();
        vi.useFakeTimers({ shouldAdvanceTime: true });
        try {
          tap();
          await waitFor(() => expect(errorSnackbars()).toBe(1));
          await act(async () => {
            await vi.advanceTimersByTimeAsync(LOCK_REFRESH_WAIT_MS - 500);
          });
          expect(busy()).toHaveAttribute('aria-busy', 'true');
          await act(async () => {
            await vi.advanceTimersByTimeAsync(600);
          });
          await waitFor(() => expect(busy()).not.toHaveAttribute('aria-busy'));
        } finally {
          vi.useRealTimers();
        }
        tap();
        await waitFor(() => expect(c.write).toHaveBeenCalledTimes(2));
      });
    });
  });

  // W113A: tấm có ô người dùng nhập (ảnh/ghi chú của "Đã chuyển", lý do thu hồi) chỉ đóng khi đích không còn hoặc vừa đổi (404/409); 400/422 là lỗi ở chính ô nhập nên tấm giữ mở để sửa. Khoá chạm giữ như W112A: 400/404/409 chờ dữ liệu về, 422 và lỗi tạm nhả ngay.
  describe('tấm nhập liệu đóng khi đích không còn (W113A)', () => {
    type Refresh = () => Promise<unknown>;
    type Case = {
      name: string;
      write: ReturnType<typeof vi.fn>;
      keys: unknown[][];
      succeed: unknown;
      open: (refresh: Refresh) => Promise<MockInstance<QueryClient['invalidateQueries']>>;
      /** Mở lại tấm (và điền) sau khi nó đã đóng; có thể không mở được khi nút mở đang khoá. */
      reopen: () => Promise<void>;
      /** Bấm nút gửi của tấm nếu tấm đang mở. */
      tap: () => void;
      /** Tấm đang hiện (nút gửi còn đó). */
      isOpen: () => boolean;
    };
    const deferred = () => {
      let resolve!: (v?: unknown) => void;
      const promise = new Promise((res) => {
        resolve = res;
      });
      return { promise, resolve };
    };
    const serverError = (message: string, status: number) => new HttpError(message, undefined, { status, data: { message }, headers: {} });
    const errorSnackbars = () => mocks.openSnackbar.mock.calls.filter(([a]) => a.type === 'error').length;
    const settle = () =>
      act(async () => {
        await new Promise((r) => setTimeout(r, 30));
      });
    const btn = (name: string) => screen.getByRole('button', { name });
    const maybe = (name: string) => screen.queryByRole('button', { name });
    const click = (name: string) => fireEvent.click(btn(name));
    const renderLive = (refresh: Refresh) => {
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
      const invalidate = vi.spyOn(qc, 'invalidateQueries').mockImplementation((() => refresh()) as never);
      render(
        <QueryClientProvider client={qc}>
          <AdminPage />
        </QueryClientProvider>,
      );
      return invalidate;
    };
    const openPayroll = async (refresh: Refresh) => {
      const invalidate = renderLive(refresh);
      await screen.findByText('Lan');
      goTab('Lương');
      await screen.findByRole('heading', { level: 2, name: 'Lương' });
      await screen.findAllByRole('button', { name: /^Xem giờ · / });
      return invalidate;
    };
    const openPaid = () => {
      click('Đã chuyển · Lan');
      fireEvent.click(maybe('Ảnh xác nhận chuyển khoản *') ?? btn('Ảnh xác nhận chuyển khoản *'));
    };
    const openRevoke = async () => {
      const open = await screen.findByRole('button', { name: 'Thu hồi · Lan' });
      fireEvent.click(open);
      const reason = screen.queryByLabelText('Lý do');
      if (reason) fireEvent.change(reason, { target: { value: 'Nghỉ việc' } });
    };

    const TEMPORARY: [string, unknown][] = [
      ['mất mạng', new HttpError('Network Error', 'ERR_NETWORK')],
      ['hết thời gian', new HttpError('timeout', 'ECONNABORTED')],
      ['máy chủ lỗi 503', serverError('Service Unavailable', 503)],
      ['hết phiên 401', serverError('Unauthorized', 401)],
    ];
    const CASES: Case[] = [
      {
        name: 'tấm "Đã chuyển" (paidM)',
        write: mocks.markPaid,
        keys: [['admin-payroll', 2026, 3]],
        succeed: { paid: true },
        open: async (refresh) => {
          const invalidate = await openPayroll(refresh);
          openPaid();
          return invalidate;
        },
        reopen: async () => openPaid(),
        tap: () => {
          const send = maybe('Đánh dấu đã trả');
          if (send) fireEvent.click(send);
        },
        isOpen: () => maybe('Đánh dấu đã trả') !== null,
      },
      {
        name: 'tấm "Thu hồi quyền" (revokeM)',
        write: mocks.revokeStaff,
        keys: [['admin-staff']],
        succeed: { revoked: 1, downgraded: false },
        open: async (refresh) => {
          const invalidate = renderLive(refresh);
          await openRevoke();
          return invalidate;
        },
        reopen: openRevoke,
        tap: () => {
          const send = maybe('Thu hồi');
          if (send) fireEvent.click(send);
        },
        isOpen: () => maybe('Thu hồi') !== null,
      },
    ];

    describe.each(CASES)('$name', (c) => {
      it.each([
        [404, 'Không tìm thấy nữa'],
        [409, 'Vừa có thay đổi, bạn thử lại nhé'],
      ])('bị từ chối %i: đóng tấm sau khi dữ liệu về, báo lỗi một lần, khoá giữ tới lúc đó rồi mới nhả', async (status, message) => {
        c.write.mockRejectedValueOnce(serverError(message, status)).mockResolvedValue(c.succeed);
        const refresh = deferred();
        const invalidate = await c.open(() => refresh.promise);
        c.tap();
        await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: message, type: 'error' }));
        expect(errorSnackbars()).toBe(1);
        expect(invalidate.mock.calls.map(([filter]) => filter)).toEqual(c.keys.map((queryKey) => ({ queryKey })));
        await settle();
        // Dữ liệu chưa về: tấm còn mở, chạm thêm không gửi lần hai.
        expect(c.isOpen()).toBe(true);
        c.tap();
        c.tap();
        await settle();
        expect(c.write).toHaveBeenCalledTimes(1);
        expect(c.isOpen()).toBe(true);
        await act(async () => refresh.resolve());
        await settle();
        await waitFor(() => expect(c.isOpen()).toBe(false));
        expect(errorSnackbars()).toBe(1);
        await c.reopen();
        await waitFor(() => expect(c.isOpen()).toBe(true));
        c.tap();
        await waitFor(() => expect(c.write).toHaveBeenCalledTimes(2));
      });

      it('bị từ chối 400: giữ tấm mở để sửa ô nhập, khoá vẫn giữ tới khi dữ liệu về rồi mới nhả', async () => {
        c.write.mockRejectedValueOnce(serverError('Lý do chưa hợp lệ', 400)).mockResolvedValue(c.succeed);
        const refresh = deferred();
        const invalidate = await c.open(() => refresh.promise);
        c.tap();
        await waitFor(() => expect(errorSnackbars()).toBe(1));
        expect(invalidate).toHaveBeenCalled();
        await settle();
        expect(c.isOpen()).toBe(true);
        c.tap();
        await settle();
        expect(c.write).toHaveBeenCalledTimes(1);
        await act(async () => refresh.resolve());
        await settle();
        expect(c.isOpen()).toBe(true);
        c.tap();
        await waitFor(() => expect(c.write).toHaveBeenCalledTimes(2));
        expect(errorSnackbars()).toBe(1);
      });

      it('bị từ chối 422: giữ tấm mở, không tải lại nên khoá nhả ngay', async () => {
        c.write.mockRejectedValueOnce(serverError('Dữ liệu không hợp lệ', 422)).mockResolvedValue(c.succeed);
        const invalidate = await c.open(() => new Promise(() => undefined));
        c.tap();
        await waitFor(() => expect(errorSnackbars()).toBe(1));
        await settle();
        expect(invalidate).not.toHaveBeenCalled();
        expect(c.isOpen()).toBe(true);
        c.tap();
        await waitFor(() => expect(c.write).toHaveBeenCalledTimes(2));
      });

      it.each(TEMPORARY)('%s: giữ tấm mở, không tải lại, khoá nhả ngay để thử lại', async (_label, error) => {
        c.write.mockRejectedValueOnce(error).mockResolvedValue(c.succeed);
        const invalidate = await c.open(() => new Promise(() => undefined));
        c.tap();
        await waitFor(() => expect(errorSnackbars()).toBe(1));
        await settle();
        expect(c.isOpen()).toBe(true);
        expect(invalidate).not.toHaveBeenCalled();
        c.tap();
        await waitFor(() => expect(c.write).toHaveBeenCalledTimes(2));
        expect(errorSnackbars()).toBe(1);
      });
    });

    it('tấm "Đã chuyển" của người khác mở trong lúc lệnh của Lan còn chạy không bị đóng theo lỗi 409 của Lan', async () => {
      const slow = deferred();
      mocks.markPaid.mockImplementation(() => slow.promise.then(() => Promise.reject(serverError('Vừa có thay đổi, bạn thử lại nhé', 409))));
      await openPayroll(() => new Promise(() => undefined));
      openPaid();
      click('Đánh dấu đã trả');
      await waitFor(() => expect(mocks.markPaid).toHaveBeenCalledTimes(1));
      // Tấm đóng được trong lúc lệnh chạy: đóng tấm của Lan, mở tấm của người kế (SĐT 0912345678).
      click('Đóng');
      click('Đã chuyển · 0912345678');
      expect(btn('Đánh dấu đã trả')).toBeInTheDocument();
      await act(async () => slow.resolve());
      await waitFor(() => expect(errorSnackbars()).toBe(1));
      await settle();
      expect(btn('Đánh dấu đã trả')).toBeInTheDocument();
    });
  });
  // W114A: tấm đơn giá, tấm chỉnh giờ & duyệt, tấm từ chối ca và tấm Thêm nhân sự có ô người dùng nhập nên chỉ đóng khi đích không còn hoặc vừa đổi (404/409); 400/422 là lỗi ở chính ô nhập nên tấm giữ mở kèm giá trị đã gõ. Khoá chạm giữ như W112A: 400/404/409 chờ dữ liệu về, 422 và lỗi tạm nhả ngay.
  describe('tấm nhập liệu còn lại đóng khi đích không còn (W114A)', () => {
    type Refresh = () => Promise<unknown>;
    type Case = {
      name: string;
      write: ReturnType<typeof vi.fn>;
      keys: unknown[][];
      succeed: unknown;
      open: (refresh: Refresh) => Promise<MockInstance<QueryClient['invalidateQueries']>>;
      /** Mở lại tấm (và điền) sau khi nó đã đóng. */
      reopen: () => void;
      /** Bấm nút gửi của tấm nếu tấm đang mở. */
      tap: () => void;
      /** Tấm đang hiện (nút gửi còn đó). */
      isOpen: () => boolean;
      /** Ô người dùng đã gõ và giá trị đã gõ lúc bấm gửi. */
      typed: () => HTMLInputElement | HTMLTextAreaElement;
      typedValue: string;
      /** Đóng tấm của đích đang chạy, mở tấm của đích khác và gõ giá trị riêng; trả giá trị đã gõ. */
      switchTarget: () => string;
    };
    const deferred = () => {
      let resolve!: (v?: unknown) => void;
      const promise = new Promise((res) => {
        resolve = res;
      });
      return { promise, resolve };
    };
    const serverError = (message: string, status: number) => new HttpError(message, undefined, { status, data: { message }, headers: {} });
    const errorSnackbars = () => mocks.openSnackbar.mock.calls.filter(([a]) => a.type === 'error').length;
    const settle = () =>
      act(async () => {
        await new Promise((r) => setTimeout(r, 30));
      });
    const btn = (name: string) => screen.getByRole('button', { name });
    const maybe = (name: string) => screen.queryByRole('button', { name });
    const click = (name: string) => fireEvent.click(btn(name));
    const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
    const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement | HTMLTextAreaElement;
    const renderLive = (refresh: Refresh) => {
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
      const invalidate = vi.spyOn(qc, 'invalidateQueries').mockImplementation((() => refresh()) as never);
      render(
        <QueryClientProvider client={qc}>
          <AdminPage />
        </QueryClientProvider>,
      );
      return invalidate;
    };
    const openPayroll = async (refresh: Refresh) => {
      const invalidate = renderLive(refresh);
      await screen.findByText('Lan');
      goTab('Lương');
      await screen.findByRole('heading', { level: 2, name: 'Lương' });
      await screen.findAllByRole('button', { name: /^Xem giờ · / });
      return invalidate;
    };
    const openShifts = async (refresh: Refresh) => {
      const invalidate = renderLive(refresh);
      await screen.findByText('Lan');
      goTab('Duyệt ca');
      await screen.findByText('09/03 – 15/03');
      await screen.findAllByText('Chờ duyệt');
      return invalidate;
    };
    const openRate = (who: string, value: string) => {
      click(`Đơn giá · ${who}`);
      type('Đơn giá (VND/giờ)', value);
    };
    const openAdjust = (day: string, value: string) => {
      click(`Chỉnh giờ Lan ${day}`);
      type('Bắt đầu', value);
    };
    const openReject = (day: string, value: string) => {
      click(`Từ chối ca Lan ${day}`);
      type('Lý do', value);
    };
    const openGrant = (phone: string, reason: string) => {
      click('Thêm');
      type('Số điện thoại', phone);
      type('Lý do', reason);
    };

    const PAYROLL = [['admin-payroll', 2026, 3]];
    const SHIFT_KEYS = [['admin-shifts-pending'], ['admin-shifts', '2026-03-09']];
    const TEMPORARY: [string, unknown][] = [
      ['mất mạng', new HttpError('Network Error', 'ERR_NETWORK')],
      ['hết thời gian', new HttpError('timeout', 'ECONNABORTED')],
      ['máy chủ lỗi 503', serverError('Service Unavailable', 503)],
      ['hết phiên 401', serverError('Unauthorized', 401)],
    ];
    const CASES: Case[] = [
      {
        name: 'tấm "Đơn giá" (rateM)',
        write: mocks.setRate,
        keys: PAYROLL,
        succeed: {},
        open: async (refresh) => {
          const invalidate = await openPayroll(refresh);
          openRate('Lan', '35000');
          return invalidate;
        },
        reopen: () => openRate('Lan', '35000'),
        tap: () => {
          const send = maybe('Lưu đơn giá');
          if (send) fireEvent.click(send);
        },
        isOpen: () => maybe('Lưu đơn giá') !== null,
        typed: () => field('Đơn giá (VND/giờ)'),
        typedValue: '35000',
        switchTarget: () => {
          click('Đóng');
          openRate('0912345678', '77000');
          return '77000';
        },
      },
      {
        name: 'tấm "Chỉnh giờ & duyệt" (approveM)',
        write: mocks.approveShift,
        keys: SHIFT_KEYS,
        succeed: { approved: true },
        open: async (refresh) => {
          const invalidate = await openShifts(refresh);
          openAdjust('T3 10/03', '08:30');
          return invalidate;
        },
        reopen: () => openAdjust('T3 10/03', '08:30'),
        tap: () => {
          const send = maybe('Duyệt với giờ đã chỉnh');
          if (send) fireEvent.click(send);
        },
        isOpen: () => maybe('Duyệt với giờ đã chỉnh') !== null,
        typed: () => field('Bắt đầu'),
        typedValue: '08:30',
        switchTarget: () => {
          click('Đóng');
          openAdjust('T4 11/03', '09:15');
          return '09:15';
        },
      },
      {
        name: 'tấm "Từ chối ca" (rejectM)',
        write: mocks.rejectShift,
        keys: SHIFT_KEYS,
        succeed: { rejected: true },
        open: async (refresh) => {
          const invalidate = await openShifts(refresh);
          openReject('T3 10/03', 'Đủ người');
          return invalidate;
        },
        reopen: () => openReject('T3 10/03', 'Đủ người'),
        tap: () => {
          const send = maybe('Xác nhận từ chối');
          if (send) fireEvent.click(send);
        },
        isOpen: () => maybe('Xác nhận từ chối') !== null,
        typed: () => field('Lý do'),
        typedValue: 'Đủ người',
        switchTarget: () => {
          click('Đóng');
          openReject('T4 11/03', 'Lý do khác');
          return 'Lý do khác';
        },
      },
      {
        name: 'tấm "Thêm nhân sự" (grantM)',
        write: mocks.grantStaff,
        keys: [['admin-staff']],
        succeed: { granted: 'STAFF', applied: true },
        open: async (refresh) => {
          const invalidate = renderLive(refresh);
          await screen.findByRole('button', { name: 'Thêm' });
          openGrant('0901112223', 'Nhân viên mới');
          return invalidate;
        },
        reopen: () => openGrant('0901112223', 'Nhân viên mới'),
        tap: () => {
          const send = maybe('Lưu quyền');
          if (send) fireEvent.click(send);
        },
        isOpen: () => maybe('Lưu quyền') !== null,
        typed: () => field('Số điện thoại'),
        typedValue: '0901112223',
        switchTarget: () => {
          click('Đóng');
          openGrant('0905556667', 'Lý do khác');
          return '0905556667';
        },
      },
    ];

    describe.each(CASES)('$name', (c) => {
      it.each([
        [404, 'Không tìm thấy nữa'],
        [409, 'Vừa có thay đổi, bạn thử lại nhé'],
      ])('bị từ chối %i: đóng tấm sau khi dữ liệu về, báo lỗi một lần, tải lại đúng khoá, khoá giữ tới lúc đó rồi mới nhả', async (status, message) => {
        c.write.mockRejectedValueOnce(serverError(message, status)).mockResolvedValue(c.succeed);
        const refresh = deferred();
        const invalidate = await c.open(() => refresh.promise);
        c.tap();
        await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: message, type: 'error' }));
        expect(errorSnackbars()).toBe(1);
        expect(invalidate.mock.calls.map(([filter]) => filter)).toEqual(c.keys.map((queryKey) => ({ queryKey })));
        await settle();
        // Dữ liệu chưa về: tấm còn mở, chạm thêm không gửi lần hai.
        expect(c.isOpen()).toBe(true);
        c.tap();
        c.tap();
        await settle();
        expect(c.write).toHaveBeenCalledTimes(1);
        expect(c.isOpen()).toBe(true);
        await act(async () => refresh.resolve());
        await settle();
        await waitFor(() => expect(c.isOpen()).toBe(false));
        expect(errorSnackbars()).toBe(1);
        if (!c.isOpen()) c.reopen();
        c.tap();
        await waitFor(() => expect(c.write).toHaveBeenCalledTimes(2));
      });

      it('bị từ chối 400: giữ tấm mở kèm giá trị đã gõ, khoá giữ tới khi dữ liệu về rồi mới nhả', async () => {
        c.write.mockRejectedValueOnce(serverError('Dữ liệu chưa hợp lệ', 400)).mockResolvedValue(c.succeed);
        const refresh = deferred();
        const invalidate = await c.open(() => refresh.promise);
        c.tap();
        await waitFor(() => expect(errorSnackbars()).toBe(1));
        expect(invalidate).toHaveBeenCalled();
        await settle();
        expect(c.isOpen()).toBe(true);
        expect(c.typed().value).toBe(c.typedValue);
        c.tap();
        await settle();
        expect(c.write).toHaveBeenCalledTimes(1);
        await act(async () => refresh.resolve());
        await settle();
        expect(c.isOpen()).toBe(true);
        expect(c.typed().value).toBe(c.typedValue);
        c.tap();
        await waitFor(() => expect(c.write).toHaveBeenCalledTimes(2));
        expect(errorSnackbars()).toBe(1);
      });

      it('bị từ chối 422: giữ tấm mở kèm giá trị đã gõ, không tải lại nên khoá nhả ngay', async () => {
        c.write.mockRejectedValueOnce(serverError('Dữ liệu không hợp lệ', 422)).mockResolvedValue(c.succeed);
        const invalidate = await c.open(() => new Promise(() => undefined));
        c.tap();
        await waitFor(() => expect(errorSnackbars()).toBe(1));
        await settle();
        expect(invalidate).not.toHaveBeenCalled();
        expect(c.isOpen()).toBe(true);
        expect(c.typed().value).toBe(c.typedValue);
        c.tap();
        await waitFor(() => expect(c.write).toHaveBeenCalledTimes(2));
      });

      it.each(TEMPORARY)('%s: giữ tấm mở kèm giá trị đã gõ, không tải lại, khoá nhả ngay để thử lại', async (_label, error) => {
        c.write.mockRejectedValueOnce(error).mockResolvedValue(c.succeed);
        const invalidate = await c.open(() => new Promise(() => undefined));
        c.tap();
        await waitFor(() => expect(errorSnackbars()).toBe(1));
        await settle();
        expect(c.isOpen()).toBe(true);
        expect(c.typed().value).toBe(c.typedValue);
        expect(invalidate).not.toHaveBeenCalled();
        c.tap();
        await waitFor(() => expect(c.write).toHaveBeenCalledTimes(2));
        expect(errorSnackbars()).toBe(1);
      });

      it('tấm của đích khác mở trong lúc lệnh của đích đầu còn chạy không bị đóng theo lỗi 409 của đích đầu', async () => {
        const slow = deferred();
        c.write.mockImplementation(() => slow.promise.then(() => Promise.reject(serverError('Vừa có thay đổi, bạn thử lại nhé', 409))));
        await c.open(() => new Promise(() => undefined));
        c.tap();
        await waitFor(() => expect(c.write).toHaveBeenCalledTimes(1));
        const other = c.switchTarget();
        expect(c.isOpen()).toBe(true);
        await act(async () => slow.resolve());
        await waitFor(() => expect(errorSnackbars()).toBe(1));
        await settle();
        expect(c.isOpen()).toBe(true);
        expect(c.typed().value).toBe(other);
      });
    });
  });

  // W115A: mọi tấm đóng vì máy chủ từ chối (404/409) đi cùng một thứ tự: báo lỗi → bắt đầu tải lại → dữ liệu mới về (hoặc quá hạn chờ) → đóng tấm → nhả khoá. Tấm không biến mất trong lúc màn còn dữ liệu cũ.
  describe('tấm đóng sau khi dữ liệu mới về rồi mới nhả khoá (W115A)', () => {
    type Refresh = () => Promise<unknown>;
    type Case = {
      name: string;
      write: ReturnType<typeof vi.fn>;
      succeed: unknown;
      open: (refresh: Refresh) => Promise<unknown>;
      /** Mở lại tấm (và điền) sau khi nó đã đóng. */
      reopen: () => void | Promise<void>;
      /** Bấm nút gửi của tấm nếu tấm đang mở. */
      tap: () => void;
      /** Tấm đang hiện (nút gửi còn đó). */
      isOpen: () => boolean;
      /** Đóng tấm của đích đang chạy rồi mở tấm của đích khác; không có với tấm không đóng được lúc lệnh chạy. */
      switchTarget?: () => void;
      /** Tấm của đích khác còn nguyên (chữ riêng đã gõ còn đó). */
      otherIntact?: () => boolean;
    };
    const deferred = () => {
      let resolve!: (v?: unknown) => void;
      const promise = new Promise((res) => {
        resolve = res;
      });
      return { promise, resolve };
    };
    const serverError = (message: string, status: number) => new HttpError(message, undefined, { status, data: { message }, headers: {} });
    const errorSnackbars = () => mocks.openSnackbar.mock.calls.filter(([a]) => a.type === 'error').length;
    const settle = () =>
      act(async () => {
        await new Promise((r) => setTimeout(r, 30));
      });
    const btn = (name: string) => screen.getByRole('button', { name });
    const maybe = (name: string) => screen.queryByRole('button', { name });
    const click = (name: string) => fireEvent.click(btn(name));
    const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
    const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement | HTMLTextAreaElement;
    const renderLive = (refresh: Refresh) => {
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
      vi.spyOn(qc, 'invalidateQueries').mockImplementation((() => refresh()) as never);
      render(
        <QueryClientProvider client={qc}>
          <AdminPage />
        </QueryClientProvider>,
      );
    };
    const openPayroll = async (refresh: Refresh) => {
      renderLive(refresh);
      await screen.findByText('Lan');
      goTab('Lương');
      await screen.findByRole('heading', { level: 2, name: 'Lương' });
      await screen.findAllByRole('button', { name: /^Xem giờ · / });
    };
    const openShifts = async (refresh: Refresh) => {
      renderLive(refresh);
      await screen.findByText('Lan');
      goTab('Duyệt ca');
      await screen.findByText('09/03 – 15/03');
      await screen.findAllByText('Chờ duyệt');
    };
    const openRate = (who: string, value: string) => {
      click(`Đơn giá · ${who}`);
      type('Đơn giá (VND/giờ)', value);
    };
    const openPaid = (who = 'Lan') => {
      click(`Đã chuyển · ${who}`);
      fireEvent.click(maybe('Ảnh xác nhận chuyển khoản *') ?? btn('Ảnh xác nhận chuyển khoản *'));
    };
    const openGrant = (phone: string, reason: string) => {
      click('Thêm');
      type('Số điện thoại', phone);
      type('Lý do', reason);
    };
    const openRevoke = async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Thu hồi · Lan' }));
      const reason = screen.queryByLabelText('Lý do');
      if (reason) fireEvent.change(reason, { target: { value: 'Nghỉ việc' } });
    };
    const openAdjust = (day: string, value: string) => {
      click(`Chỉnh giờ Lan ${day}`);
      type('Bắt đầu', value);
    };
    const openReject = (day: string, value: string) => {
      click(`Từ chối ca Lan ${day}`);
      type('Lý do', value);
    };
    const sendIfOpen = (name: string) => () => {
      const send = maybe(name);
      if (send) fireEvent.click(send);
    };
    const showing = (name: string) => () => maybe(name) !== null;

    const TEMPORARY: [string, unknown][] = [
      ['mất mạng', new HttpError('Network Error', 'ERR_NETWORK')],
      ['hết thời gian', new HttpError('timeout', 'ECONNABORTED')],
      ['máy chủ lỗi 503', serverError('Service Unavailable', 503)],
      ['hết phiên 401', serverError('Unauthorized', 401)],
    ];
    const CASES: Case[] = [
      {
        name: 'tấm "Đơn giá" (rateM)',
        write: mocks.setRate,
        succeed: {},
        open: async (refresh) => {
          await openPayroll(refresh);
          openRate('Lan', '35000');
        },
        reopen: () => openRate('Lan', '35000'),
        tap: sendIfOpen('Lưu đơn giá'),
        isOpen: showing('Lưu đơn giá'),
        switchTarget: () => {
          click('Đóng');
          openRate('0912345678', '77000');
        },
        otherIntact: () => field('Đơn giá (VND/giờ)').value === '77000',
      },
      {
        name: 'tấm "Đã chuyển" (paidM)',
        write: mocks.markPaid,
        succeed: { paid: true },
        open: async (refresh) => {
          await openPayroll(refresh);
          openPaid();
        },
        reopen: () => openPaid(),
        tap: sendIfOpen('Đánh dấu đã trả'),
        isOpen: showing('Đánh dấu đã trả'),
        switchTarget: () => {
          click('Đóng');
          openPaid('0912345678');
        },
        otherIntact: showing('Đánh dấu đã trả'),
      },
      {
        name: 'tấm "Thêm nhân sự" (grantM)',
        write: mocks.grantStaff,
        succeed: { granted: 'STAFF', applied: true },
        open: async (refresh) => {
          renderLive(refresh);
          await screen.findByRole('button', { name: 'Thêm' });
          openGrant('0901112223', 'Nhân viên mới');
        },
        reopen: () => openGrant('0901112223', 'Nhân viên mới'),
        tap: sendIfOpen('Lưu quyền'),
        isOpen: showing('Lưu quyền'),
        switchTarget: () => {
          click('Đóng');
          openGrant('0905556667', 'Lý do khác');
        },
        otherIntact: () => field('Số điện thoại').value === '0905556667',
      },
      {
        name: 'tấm "Thu hồi quyền" (revokeM)',
        write: mocks.revokeStaff,
        succeed: { revoked: 1, downgraded: false },
        open: async (refresh) => {
          renderLive(refresh);
          await openRevoke();
        },
        reopen: openRevoke,
        tap: sendIfOpen('Thu hồi'),
        isOpen: showing('Thu hồi'),
      },
      {
        name: 'tấm "Chỉnh giờ & duyệt" (approveM)',
        write: mocks.approveShift,
        succeed: { approved: true },
        open: async (refresh) => {
          await openShifts(refresh);
          openAdjust('T3 10/03', '08:30');
        },
        reopen: () => openAdjust('T3 10/03', '08:30'),
        tap: sendIfOpen('Duyệt với giờ đã chỉnh'),
        isOpen: showing('Duyệt với giờ đã chỉnh'),
        switchTarget: () => {
          click('Đóng');
          openAdjust('T4 11/03', '09:15');
        },
        otherIntact: () => field('Bắt đầu').value === '09:15',
      },
      {
        name: 'tấm "Từ chối ca" (rejectM)',
        write: mocks.rejectShift,
        succeed: { rejected: true },
        open: async (refresh) => {
          await openShifts(refresh);
          openReject('T3 10/03', 'Đủ người');
        },
        reopen: () => openReject('T3 10/03', 'Đủ người'),
        tap: sendIfOpen('Xác nhận từ chối'),
        isOpen: showing('Xác nhận từ chối'),
        switchTarget: () => {
          click('Đóng');
          openReject('T4 11/03', 'Lý do khác');
        },
        otherIntact: () => field('Lý do').value === 'Lý do khác',
      },
    ];

    /** Gom các mốc đã thấy theo thứ tự, bỏ lặp liền kề (tải lại hai khoá thì ghi "refetch" hai lần). */
    const inOrder = (events: string[]) => events.filter((e, i) => e !== events[i - 1]);
    /** Ghi mốc "closed" vào `events` ngay khi tấm đóng lại, theo DOM chứ không theo lần poll của test. */
    const watchClosing = (events: string[], isOpen: () => boolean) => {
      let wasOpen = isOpen();
      const observer = new MutationObserver(() => {
        const now = isOpen();
        if (wasOpen && !now) events.push('closed');
        wasOpen = now;
      });
      observer.observe(document.body, { subtree: true, childList: true, attributes: true });
      return () => observer.disconnect();
    };

    describe.each(CASES)('$name', (c) => {
      it.each([
        [404, 'Không tìm thấy nữa'],
        [409, 'Vừa có thay đổi, bạn thử lại nhé'],
      ])('bị từ chối %i: báo lỗi → bắt đầu tải lại → tấm còn mở và khoá còn giữ tới khi dữ liệu về → đóng đúng một lần → nhả khoá', async (status, message) => {
        const events: string[] = [];
        mocks.openSnackbar.mockImplementation((a: { type: string }) => {
          if (a.type === 'error') events.push('error');
        });
        c.write.mockRejectedValueOnce(serverError(message, status)).mockResolvedValue(c.succeed);
        const refresh = deferred();
        await c.open(() => {
          events.push('refetch');
          return refresh.promise;
        });
        const stopWatching = watchClosing(events, c.isOpen);
        c.tap();
        await waitFor(() => expect(errorSnackbars()).toBe(1));
        await settle();
        expect(c.isOpen()).toBe(true);
        c.tap();
        c.tap();
        await settle();
        expect(c.write).toHaveBeenCalledTimes(1);
        expect(c.isOpen()).toBe(true);
        expect(inOrder(events)).toEqual(['error', 'refetch']);
        await act(async () => refresh.resolve());
        await settle();
        await waitFor(() => expect(c.isOpen()).toBe(false));
        expect(inOrder(events)).toEqual(['error', 'refetch', 'closed']);
        stopWatching();
        // Đã đóng thì đóng hẳn: không có lần mở lại hay đóng lần hai, và chỉ một lời báo lỗi.
        await settle();
        expect(c.isOpen()).toBe(false);
        expect(errorSnackbars()).toBe(1);
        // Khoá đã nhả sau khi tấm đóng: mở lại bấm gửi được lần hai.
        await c.reopen();
        await waitFor(() => expect(c.isOpen()).toBe(true));
        c.tap();
        await waitFor(() => expect(c.write).toHaveBeenCalledTimes(2));
      });

      it('tải lại treo mãi: tấm còn mở tới sát LOCK_REFRESH_WAIT_MS, đóng ngay sau hạn rồi khoá nhả', async () => {
        c.write.mockRejectedValueOnce(serverError('Vừa có thay đổi, bạn thử lại nhé', 409)).mockResolvedValue(c.succeed);
        await c.open(() => new Promise(() => undefined));
        // beforeEach chỉ giả Date: muốn tua setTimeout của settleWithin thì phải dựng lại đồng hồ giả đầy đủ.
        vi.useRealTimers();
        vi.useFakeTimers({ shouldAdvanceTime: true });
        try {
          c.tap();
          await waitFor(() => expect(errorSnackbars()).toBe(1));
          await act(async () => {
            await vi.advanceTimersByTimeAsync(LOCK_REFRESH_WAIT_MS - 500);
          });
          expect(c.isOpen()).toBe(true);
          await act(async () => {
            await vi.advanceTimersByTimeAsync(600);
          });
          await waitFor(() => expect(c.isOpen()).toBe(false));
        } finally {
          vi.useRealTimers();
        }
        await c.reopen();
        await waitFor(() => expect(c.isOpen()).toBe(true));
        c.tap();
        await waitFor(() => expect(c.write).toHaveBeenCalledTimes(2));
      });

      it.each([
        ['400 (lỗi ở ô nhập, có tải lại)', serverError('Dữ liệu chưa hợp lệ', 400)],
        ['422 (không tải lại)', serverError('Dữ liệu không hợp lệ', 422)],
        ...TEMPORARY,
      ])('%s: tấm giữ mở trước, trong và sau lúc chờ, khoá nhả đúng lúc để thử lại', async (_label, error) => {
        c.write.mockRejectedValueOnce(error).mockResolvedValue(c.succeed);
        const refresh = deferred();
        await c.open(() => refresh.promise);
        c.tap();
        await waitFor(() => expect(errorSnackbars()).toBe(1));
        await settle();
        expect(c.isOpen()).toBe(true);
        await act(async () => refresh.resolve());
        await settle();
        expect(c.isOpen()).toBe(true);
        c.tap();
        await waitFor(() => expect(c.write).toHaveBeenCalledTimes(2));
        expect(errorSnackbars()).toBe(1);
      });
    });

    // Tấm thu hồi không đóng được lúc lệnh chạy nên không có đích khác để chuyển sang.
    describe.each(CASES.filter((c) => c.switchTarget && c.otherIntact))('$name', (c) => {
      it('tấm của đích khác mở trong lúc chờ dữ liệu về không bị đóng theo lỗi của đích đầu (so đích lúc đóng, không phải lúc lỗi về)', async () => {
        c.write.mockRejectedValueOnce(serverError('Vừa có thay đổi, bạn thử lại nhé', 409)).mockResolvedValue(c.succeed);
        const refresh = deferred();
        await c.open(() => refresh.promise);
        c.tap();
        await waitFor(() => expect(errorSnackbars()).toBe(1));
        await settle();
        // Lỗi đã về, dữ liệu chưa về: người dùng đóng tấm cũ và mở tấm của đích khác.
        c.switchTarget!();
        expect(c.isOpen()).toBe(true);
        await act(async () => refresh.resolve());
        await settle();
        expect(c.isOpen()).toBe(true);
        expect(c.otherIntact!()).toBe(true);
        expect(errorSnackbars()).toBe(1);
      });
    });
  });

  // W116A: phản hồi muộn (máy chủ từ chối sau khi chờ tải lại, hoặc báo xong) của lệnh gửi từ lần mở TRƯỚC không được đóng tấm của lần mở SAU khi khách tự đóng rồi mở lại CÙNG đích và đang gõ.
  // So đích (W115A) không đủ vì hai lần mở cùng một đích; mã số lần mở (useSheetSeq) phân biệt được.
  describe('tấm đóng rồi mở lại cùng đích trong lúc lệnh còn bay (W116A)', () => {
    type Refresh = () => Promise<unknown>;
    type Case = {
      name: string;
      write: ReturnType<typeof vi.fn>;
      succeed: unknown;
      open: (refresh: Refresh) => Promise<unknown>;
      /** Khách đóng tấm bằng nút X rồi mở lại CÙNG đích và gõ chữ mới, trong lúc lệnh/tải lại còn treo. */
      reopenAndType: () => void;
      /** Chữ vừa gõ ở lần mở sau còn nguyên. */
      typedIntact: () => boolean;
      /** Bấm nút gửi của tấm nếu tấm đang mở. */
      tap: () => void;
      /** Tấm đang hiện (nút gửi còn đó). */
      isOpen: () => boolean;
      /** Việc cần làm thêm ở lần mở sau để nút gửi bấm được lần hai (vd tải lại ảnh). */
      prepareResend?: () => void;
    };
    const deferred = () => {
      let resolve!: (v?: unknown) => void;
      const promise = new Promise((res) => {
        resolve = res;
      });
      return { promise, resolve };
    };
    const serverError = (message: string, status: number) => new HttpError(message, undefined, { status, data: { message }, headers: {} });
    const countSnackbars = (type: string) => mocks.openSnackbar.mock.calls.filter(([a]) => a.type === type).length;
    const settle = () =>
      act(async () => {
        await new Promise((r) => setTimeout(r, 30));
      });
    const btn = (name: string) => screen.getByRole('button', { name });
    const maybe = (name: string) => screen.queryByRole('button', { name });
    const click = (name: string) => fireEvent.click(btn(name));
    const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
    const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement | HTMLTextAreaElement;
    const renderLive = (refresh: Refresh) => {
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
      vi.spyOn(qc, 'invalidateQueries').mockImplementation((() => refresh()) as never);
      render(
        <QueryClientProvider client={qc}>
          <AdminPage />
        </QueryClientProvider>,
      );
    };
    const openPayroll = async (refresh: Refresh) => {
      renderLive(refresh);
      await screen.findByText('Lan');
      goTab('Lương');
      await screen.findByRole('heading', { level: 2, name: 'Lương' });
      await screen.findAllByRole('button', { name: /^Xem giờ · / });
    };
    const openShifts = async (refresh: Refresh) => {
      renderLive(refresh);
      await screen.findByText('Lan');
      goTab('Duyệt ca');
      await screen.findByText('09/03 – 15/03');
      await screen.findAllByText('Chờ duyệt');
    };
    const openRate = (value: string) => {
      click('Đơn giá · Lan');
      type('Đơn giá (VND/giờ)', value);
    };
    const uploadProof = () => fireEvent.click(btn('Ảnh xác nhận chuyển khoản *'));
    const openGrant = (phone: string, reason: string) => {
      click('Thêm');
      type('Số điện thoại', phone);
      type('Lý do', reason);
    };
    const openAdjust = (day: string, value: string) => {
      click(`Chỉnh giờ Lan ${day}`);
      type('Bắt đầu', value);
    };
    const openReject = (day: string, value: string) => {
      click(`Từ chối ca Lan ${day}`);
      type('Lý do', value);
    };
    const sendIfOpen = (name: string) => () => {
      const send = maybe(name);
      if (send) fireEvent.click(send);
    };
    const showing = (name: string) => () => maybe(name) !== null;

    const CASES: Case[] = [
      {
        name: 'tấm "Đơn giá" (rateM)',
        write: mocks.setRate,
        succeed: {},
        open: async (refresh) => {
          await openPayroll(refresh);
          openRate('35000');
        },
        reopenAndType: () => {
          click('Đóng');
          openRate('41000');
        },
        typedIntact: () => field('Đơn giá (VND/giờ)').value === '41000',
        tap: sendIfOpen('Lưu đơn giá'),
        isOpen: showing('Lưu đơn giá'),
      },
      {
        name: 'tấm "Đã chuyển" (paidM)',
        write: mocks.markPaid,
        succeed: { paid: true },
        open: async (refresh) => {
          await openPayroll(refresh);
          click('Đã chuyển · Lan');
          uploadProof();
        },
        reopenAndType: () => {
          click('Đóng');
          click('Đã chuyển · Lan');
          type('Ghi chú (tuỳ chọn)', 'Ghi chú mới');
        },
        typedIntact: () => field('Ghi chú (tuỳ chọn)').value === 'Ghi chú mới',
        tap: sendIfOpen('Đánh dấu đã trả'),
        isOpen: showing('Đánh dấu đã trả'),
        // Lần mở sau xoá ảnh cũ: phải chọn ảnh lại thì mới gửi được.
        prepareResend: uploadProof,
      },
      {
        name: 'tấm "Thêm nhân sự" (grantM)',
        write: mocks.grantStaff,
        succeed: { granted: 'STAFF', applied: true },
        open: async (refresh) => {
          renderLive(refresh);
          await screen.findByRole('button', { name: 'Thêm' });
          openGrant('0901112223', 'Nhân viên mới');
        },
        reopenAndType: () => {
          click('Đóng');
          click('Thêm');
          type('Lý do', 'Lý do mới');
        },
        // SĐT vẫn là SĐT cũ (đóng tấm không xoá SĐT): so SĐT không phân biệt được hai lần mở.
        typedIntact: () => field('Lý do').value === 'Lý do mới' && field('Số điện thoại').value === '0901112223',
        tap: sendIfOpen('Lưu quyền'),
        isOpen: showing('Lưu quyền'),
      },
      {
        name: 'tấm "Chỉnh giờ & duyệt" (approveM)',
        write: mocks.approveShift,
        succeed: { approved: true },
        open: async (refresh) => {
          await openShifts(refresh);
          openAdjust('T3 10/03', '08:30');
        },
        reopenAndType: () => {
          click('Đóng');
          openAdjust('T3 10/03', '09:45');
        },
        typedIntact: () => field('Bắt đầu').value === '09:45',
        tap: sendIfOpen('Duyệt với giờ đã chỉnh'),
        isOpen: showing('Duyệt với giờ đã chỉnh'),
      },
      {
        name: 'tấm "Từ chối ca" (rejectM)',
        write: mocks.rejectShift,
        succeed: { rejected: true },
        open: async (refresh) => {
          await openShifts(refresh);
          openReject('T3 10/03', 'Đủ người');
        },
        reopenAndType: () => {
          click('Đóng');
          openReject('T3 10/03', 'Lý do mới');
        },
        typedIntact: () => field('Lý do').value === 'Lý do mới',
        tap: sendIfOpen('Xác nhận từ chối'),
        isOpen: showing('Xác nhận từ chối'),
      },
    ];

    describe.each(CASES)('$name', (c) => {
      it('bị từ chối 409: khách đóng rồi mở lại cùng đích và gõ mới trong lúc chờ tải lại thì khi dữ liệu về tấm mới còn mở, chữ còn nguyên; báo lỗi, tải lại, nhả khoá vẫn chạy', async () => {
        c.write.mockRejectedValueOnce(serverError('Vừa có thay đổi, bạn thử lại nhé', 409)).mockResolvedValue(c.succeed);
        const refresh = deferred();
        let refetches = 0;
        await c.open(() => {
          refetches += 1;
          return refresh.promise;
        });
        c.tap();
        await waitFor(() => expect(countSnackbars('error')).toBe(1));
        await settle();
        expect(c.isOpen()).toBe(true);
        expect(refetches).toBeGreaterThan(0);
        c.reopenAndType();
        expect(c.isOpen()).toBe(true);
        await act(async () => refresh.resolve());
        await settle();
        expect(c.isOpen()).toBe(true);
        expect(c.typedIntact()).toBe(true);
        expect(countSnackbars('error')).toBe(1);
        // Khoá đã nhả: gửi lại ở lần mở mới chạy được, và lần mở mới vẫn đóng khi chính lệnh của nó xong.
        c.prepareResend?.();
        c.tap();
        await waitFor(() => expect(c.write).toHaveBeenCalledTimes(2));
        await waitFor(() => expect(c.isOpen()).toBe(false));
        expect(countSnackbars('success')).toBe(1);
      });

      it('báo xong muộn: khách đóng rồi mở lại cùng đích và gõ mới trong lúc lệnh còn bay thì tấm mới còn mở, chữ còn nguyên; báo thành công và tải lại vẫn chạy', async () => {
        const write = deferred();
        c.write.mockReturnValueOnce(write.promise);
        let refetches = 0;
        await c.open(() => {
          refetches += 1;
          return Promise.resolve();
        });
        c.tap();
        await settle();
        c.reopenAndType();
        expect(c.write).toHaveBeenCalledTimes(1);
        await act(async () => write.resolve(c.succeed));
        await settle();
        expect(countSnackbars('success')).toBe(1);
        expect(refetches).toBeGreaterThan(0);
        expect(c.isOpen()).toBe(true);
        expect(c.typedIntact()).toBe(true);
      });

      it('khách đóng tấm trong lúc lệnh còn bay và KHÔNG mở lại: báo xong vẫn đóng như cũ, không lỗi', async () => {
        const write = deferred();
        c.write.mockReturnValueOnce(write.promise);
        await c.open(() => Promise.resolve());
        c.tap();
        await settle();
        click('Đóng');
        await act(async () => write.resolve(c.succeed));
        await settle();
        expect(c.isOpen()).toBe(false);
        expect(countSnackbars('success')).toBe(1);
        expect(countSnackbars('error')).toBe(0);
      });
    });

    it('Duyệt thẳng ca A bằng nút Duyệt rồi mở tấm Chỉnh giờ của ca B: báo xong của A không đóng tấm của B', async () => {
      const write = deferred();
      mocks.approveShift.mockReturnValueOnce(write.promise);
      await openShifts(() => Promise.resolve());
      click('Duyệt ca Lan T3 10/03');
      await settle();
      openAdjust('T4 11/03', '09:15');
      await act(async () => write.resolve({ approved: true }));
      await settle();
      expect(countSnackbars('success')).toBe(1);
      expect(maybe('Duyệt với giờ đã chỉnh')).not.toBeNull();
      expect(field('Bắt đầu').value).toBe('09:15');
    });

    it('Duyệt thẳng ca A bằng nút Duyệt (gửi lúc tấm đóng) rồi mở tấm Chỉnh giờ của CHÍNH ca A trong lúc lệnh còn bay: báo xong thì tấm vẫn đóng như trước W116A (lệnh không thuộc lần mở nào); báo thành công và tải lại vẫn chạy', async () => {
      const write = deferred();
      mocks.approveShift.mockReturnValueOnce(write.promise);
      let refetches = 0;
      await openShifts(() => {
        refetches += 1;
        return Promise.resolve();
      });
      click('Duyệt ca Lan T3 10/03');
      await settle();
      openAdjust('T3 10/03', '09:15');
      expect(maybe('Duyệt với giờ đã chỉnh')).not.toBeNull();
      const before = refetches;
      await act(async () => write.resolve({ approved: true }));
      await settle();
      expect(countSnackbars('success')).toBe(1);
      expect(refetches).toBeGreaterThan(before);
      expect(maybe('Duyệt với giờ đã chỉnh')).toBeNull();
    });

    describe('Sửa giờ phiên (editM)', () => {
      const openEdit = async () => {
        await openPayroll(() => Promise.resolve());
        click('Xem giờ · Lan');
        fireEvent.click(await screen.findByRole('button', { name: 'Sửa giờ phiên 08:00' }));
        type('Giờ ra', '12:45');
      };

      it('khách đóng tấm Giờ công rồi mở lại cùng nhân viên (khung sửa vẫn mở) và gõ giờ mới trong lúc lệnh còn bay: báo xong muộn không đóng khung mới, giờ đang gõ còn nguyên; báo thành công và tải lại vẫn chạy', async () => {
        const write = deferred();
        mocks.adminEditSession.mockReturnValueOnce(write.promise);
        await openEdit();
        click('Lưu giờ');
        await settle();
        click('Đóng');
        click('Xem giờ · Lan');
        await screen.findByLabelText('Giờ ra');
        type('Giờ ra', '13:10');
        await act(async () => write.resolve({ updated: true }));
        await settle();
        expect(countSnackbars('success')).toBe(1);
        expect(mocks.adminEditSession).toHaveBeenCalledTimes(1);
        expect(field('Giờ ra').value).toBe('13:10');
        expect(maybe('Lưu giờ')).not.toBeNull();
      });

      it('đang lưu phiên này mà mở khung sửa phiên khác: báo xong của phiên đầu không đóng khung của phiên sau', async () => {
        const write = deferred();
        mocks.adminEditSession.mockReturnValueOnce(write.promise);
        await openEdit();
        click('Lưu giờ');
        await settle();
        click('Sửa giờ phiên 22:00');
        type('Giờ ra', '02:00');
        await act(async () => write.resolve({ updated: true }));
        await settle();
        expect(countSnackbars('success')).toBe(1);
        expect(field('Giờ ra').value).toBe('02:00');
      });

      it('không mở lại: báo xong đóng khung sửa như cũ', async () => {
        const write = deferred();
        mocks.adminEditSession.mockReturnValueOnce(write.promise);
        await openEdit();
        click('Lưu giờ');
        await settle();
        await act(async () => write.resolve({ updated: true }));
        await settle();
        expect(countSnackbars('success')).toBe(1);
        expect(screen.queryByLabelText('Giờ ra')).toBeNull();
      });
    });

    describe('Thêm ca chuẩn (addM)', () => {
      const openTemplates = async () => {
        await openShifts(() => Promise.resolve());
        click('Ca chuẩn');
        await screen.findByText('Ca sáng · 08:00–12:00');
        type('Tên ca', 'Ca tối');
        await waitFor(() => expect(btn('Thêm ca chuẩn')).toBeEnabled());
      };

      it('khách đóng tấm Ca chuẩn rồi mở lại và gõ tên mới trong lúc lệnh thêm còn bay: báo xong muộn không xoá tên đang gõ; báo thành công và tải lại vẫn chạy', async () => {
        const write = deferred();
        mocks.createTemplate.mockReturnValueOnce(write.promise);
        await openTemplates();
        click('Thêm ca chuẩn');
        await settle();
        click('Đóng');
        click('Ca chuẩn');
        await screen.findByText('Ca sáng · 08:00–12:00');
        type('Tên ca', 'Ca đêm');
        await act(async () => write.resolve({}));
        await settle();
        expect(countSnackbars('success')).toBe(1);
        expect(mocks.createTemplate).toHaveBeenCalledTimes(1);
        expect(field('Tên ca').value).toBe('Ca đêm');
      });

      it('không mở lại: báo xong xoá tên như cũ', async () => {
        const write = deferred();
        mocks.createTemplate.mockReturnValueOnce(write.promise);
        await openTemplates();
        click('Thêm ca chuẩn');
        await settle();
        await act(async () => write.resolve({}));
        await settle();
        expect(countSnackbars('success')).toBe(1);
        expect(field('Tên ca').value).toBe('');
      });
    });
  });

  describe('ô chưa chạm của tấm bám dữ liệu máy chủ mới, ô đã sửa giữ chữ (W117A)', () => {
    const serverError = (message: string, status: number) => new HttpError(message, undefined, { status, data: { message }, headers: {} });
    const settle = () =>
      act(async () => {
        await new Promise((r) => setTimeout(r, 30));
      });
    const btn = (name: string) => screen.getByRole('button', { name });
    const click = (name: string) => fireEvent.click(btn(name));
    const input = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
    const type = (label: string, value: string) => fireEvent.change(input(label), { target: { value } });
    // Tải lại thật (không giả `invalidateQueries`): kết quả mock mới của query chảy qua cache vào tấm đang mở, đúng như lúc dữ liệu mới về giữa chừng.
    const renderLive = () => {
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
      render(
        <QueryClientProvider client={qc}>
          <AdminPage />
        </QueryClientProvider>,
      );
      return qc;
    };
    const refetch = (qc: QueryClient, key: unknown[]) =>
      act(async () => {
        await qc.invalidateQueries({ queryKey: key });
      });
    const notBusy = (name: string) => waitFor(() => expect(btn(name)).not.toHaveAttribute('aria-busy', 'true'));

    describe('Đơn giá (rateM)', () => {
      const PAY_ROWS_D2 = PAY_ROWS.map((r) => (r.staff.id === 'u1' ? { ...r, profile: profile({ hourlyRate: 41000 }) } : r));
      const openRate = async () => {
        const qc = renderLive();
        await screen.findByText('Lan');
        goTab('Lương');
        await screen.findByText('14h30 · 30.000đ/h · Đang tính');
        click('Đơn giá · Lan');
        expect(input('Đơn giá (VND/giờ)')).toHaveValue(30000);
        return qc;
      };

      it('bảng lương tải lại có đơn giá mới khi khách chưa gõ: ô đổi theo, Lưu gửi đơn giá MỚI (trước đây gửi đơn giá cũ đè lên)', async () => {
        const qc = await openRate();
        mocks.adminGetPayroll.mockResolvedValue(PAY_ROWS_D2);
        await refetch(qc, ['admin-payroll']);
        await waitFor(() => expect(input('Đơn giá (VND/giờ)')).toHaveValue(41000));
        click('Lưu đơn giá');
        await waitFor(() => expect(mocks.setRate).toHaveBeenCalledTimes(1));
        expect(mocks.setRate).toHaveBeenCalledWith('u1', 41000);
      });

      it('khách đã gõ đơn giá: bảng lương tải lại không ghi đè chữ đang gõ, Lưu gửi đúng chữ đó', async () => {
        const qc = await openRate();
        type('Đơn giá (VND/giờ)', '45000');
        mocks.adminGetPayroll.mockResolvedValue(PAY_ROWS_D2);
        await refetch(qc, ['admin-payroll']);
        await screen.findByText('14h30 · 41.000đ/h · Đang tính');
        expect(input('Đơn giá (VND/giờ)')).toHaveValue(45000);
        click('Lưu đơn giá');
        await waitFor(() => expect(mocks.setRate).toHaveBeenCalledTimes(1));
        expect(mocks.setRate).toHaveBeenCalledWith('u1', 45000);
      });

      it('máy chủ từ chối 400 khi khách chưa gõ: bảng tải lại về đơn giá mới, tấm còn mở, ô là đơn giá mới, bấm Lưu lại gửi đơn giá mới', async () => {
        mocks.setRate.mockRejectedValueOnce(serverError('Đơn giá đã đổi', 400)).mockResolvedValue({});
        await openRate();
        mocks.adminGetPayroll.mockResolvedValue(PAY_ROWS_D2);
        click('Lưu đơn giá');
        await waitFor(() => expect(mocks.setRate).toHaveBeenNthCalledWith(1, 'u1', 30000));
        await waitFor(() => expect(input('Đơn giá (VND/giờ)')).toHaveValue(41000));
        await settle();
        await notBusy('Lưu đơn giá');
        click('Lưu đơn giá');
        await waitFor(() => expect(mocks.setRate).toHaveBeenCalledTimes(2));
        expect(mocks.setRate).toHaveBeenNthCalledWith(2, 'u1', 41000);
      });

      it('máy chủ từ chối 400 khi khách đã gõ: tấm còn mở, chữ đang gõ còn nguyên dù bảng tải lại có đơn giá khác', async () => {
        mocks.setRate.mockRejectedValueOnce(serverError('Đơn giá đã đổi', 400)).mockResolvedValue({});
        await openRate();
        type('Đơn giá (VND/giờ)', '45000');
        mocks.adminGetPayroll.mockResolvedValue(PAY_ROWS_D2);
        click('Lưu đơn giá');
        await waitFor(() => expect(mocks.setRate).toHaveBeenCalledTimes(1));
        await screen.findByText('14h30 · 41.000đ/h · Đang tính');
        await settle();
        await notBusy('Lưu đơn giá');
        expect(input('Đơn giá (VND/giờ)')).toHaveValue(45000);
        click('Lưu đơn giá');
        await waitFor(() => expect(mocks.setRate).toHaveBeenCalledTimes(2));
        expect(mocks.setRate).toHaveBeenNthCalledWith(2, 'u1', 45000);
      });

      it('đóng rồi mở lại: nạp lại từ bảng lương hiện tại, bỏ chữ đã gõ của lần trước', async () => {
        const qc = await openRate();
        type('Đơn giá (VND/giờ)', '45000');
        click('Đóng');
        mocks.adminGetPayroll.mockResolvedValue(PAY_ROWS_D2);
        await refetch(qc, ['admin-payroll']);
        await screen.findByText('14h30 · 41.000đ/h · Đang tính');
        click('Đơn giá · Lan');
        expect(input('Đơn giá (VND/giờ)')).toHaveValue(41000);
      });
    });

    describe('Sửa giờ phiên (editM)', () => {
      const DETAIL_D2 = { ...DETAIL, sessions: [{ ...DETAIL.sessions[0]!, checkinAt: vn('2026-03-02', '08:15') }, DETAIL.sessions[1]!] };
      const openSession = async () => {
        const qc = renderLive();
        await screen.findByText('Lan');
        goTab('Lương');
        await screen.findByText('14h30 · 30.000đ/h · Đang tính');
        click('Xem giờ · Lan');
        fireEvent.click(await screen.findByRole('button', { name: 'Sửa giờ phiên 08:00' }));
        expect(input('Giờ vào')).toHaveValue('08:00');
        expect(input('Giờ ra')).toHaveValue('12:30');
        return qc;
      };

      it('chi tiết tải lại có giờ vào mới, khách mới sửa giờ ra: giờ vào đổi theo, giờ ra giữ chữ; Lưu gửi giờ vào MỚI + giờ ra khách gõ', async () => {
        const qc = await openSession();
        type('Giờ ra', '13:00');
        mocks.adminGetDetail.mockResolvedValue(DETAIL_D2);
        await refetch(qc, ['admin-payroll-detail']);
        await waitFor(() => expect(input('Giờ vào')).toHaveValue('08:15'));
        expect(input('Giờ ra')).toHaveValue('13:00');
        click('Lưu giờ');
        await waitFor(() => expect(mocks.adminEditSession).toHaveBeenCalledTimes(1));
        expect(mocks.adminEditSession).toHaveBeenCalledWith('ss1', { checkinAt: vn('2026-03-02', '08:15'), checkoutAt: vn('2026-03-02', '13:00') });
      });

      it('máy chủ từ chối 400: chi tiết tải lại, khung còn mở, giờ vào chưa đụng là giờ mới, giờ ra giữ chữ khách; bấm Lưu lại gửi đúng hai giá trị đó', async () => {
        mocks.adminEditSession.mockRejectedValueOnce(serverError('Phiên đã đổi', 400)).mockResolvedValue({ updated: true });
        await openSession();
        type('Giờ ra', '13:00');
        mocks.adminGetDetail.mockResolvedValue(DETAIL_D2);
        click('Lưu giờ');
        await waitFor(() => expect(mocks.adminEditSession).toHaveBeenNthCalledWith(1, 'ss1', { checkinAt: vn('2026-03-02', '08:00'), checkoutAt: vn('2026-03-02', '13:00') }));
        await waitFor(() => expect(input('Giờ vào')).toHaveValue('08:15'));
        await settle();
        await notBusy('Lưu giờ');
        expect(input('Giờ ra')).toHaveValue('13:00');
        click('Lưu giờ');
        await waitFor(() => expect(mocks.adminEditSession).toHaveBeenCalledTimes(2));
        expect(mocks.adminEditSession).toHaveBeenNthCalledWith(2, 'ss1', { checkinAt: vn('2026-03-02', '08:15'), checkoutAt: vn('2026-03-02', '13:00') });
      });

      it('phiên đang mở được checkout ở nơi khác khi khách chưa gõ: giờ ra đổi theo giờ checkout thật', async () => {
        const qc = renderLive();
        await screen.findByText('Lan');
        goTab('Lương');
        await screen.findByText('14h30 · 30.000đ/h · Đang tính');
        click('Xem giờ · Lan');
        fireEvent.click(await screen.findByRole('button', { name: 'Sửa giờ phiên 22:00' }));
        expect(input('Giờ ra')).toHaveValue('22:00');
        mocks.adminGetDetail.mockResolvedValue({
          ...DETAIL,
          sessions: [DETAIL.sessions[0]!, { ...DETAIL.sessions[1]!, checkoutAt: vn('2026-03-04', '02:00') }],
        });
        await refetch(qc, ['admin-payroll-detail']);
        await waitFor(() => expect(input('Giờ ra')).toHaveValue('02:00'));
        expect(input('Giờ vào')).toHaveValue('22:00');
      });

      it('đóng tấm Giờ công rồi mở lại: nạp lại từ chi tiết hiện tại, bỏ chữ đã sửa của lần trước', async () => {
        await openSession();
        type('Giờ ra', '13:00');
        click('Đóng');
        click('Xem giờ · Lan');
        await waitFor(() => expect(input('Giờ ra')).toHaveValue('12:30'));
        expect(input('Giờ vào')).toHaveValue('08:00');
      });
    });

    describe('Chỉnh giờ & duyệt (approveM)', () => {
      const SHIFTS_D2 = SHIFTS.map((s) => (s.id === 's1' ? { ...s, startAt: vn('2026-03-10', '07:30') } : s));
      const openAdjust = async () => {
        const qc = renderLive();
        await screen.findByText('Lan');
        goTab('Duyệt ca');
        await screen.findByText('09/03 – 15/03');
        await screen.findAllByText('Chờ duyệt');
        click('Chỉnh giờ Lan T3 10/03');
        expect(input('Bắt đầu')).toHaveValue('08:00');
        expect(input('Kết thúc')).toHaveValue('12:00');
        return qc;
      };

      it('danh sách ca tải lại có giờ bắt đầu mới, khách mới sửa giờ kết thúc: giờ bắt đầu đổi theo, giờ kết thúc giữ chữ; Duyệt gửi giờ MỚI + giờ khách gõ', async () => {
        const qc = await openAdjust();
        type('Kết thúc', '11:30');
        mocks.adminGetShifts.mockResolvedValue(SHIFTS_D2);
        await refetch(qc, ['admin-shifts']);
        await waitFor(() => expect(input('Bắt đầu')).toHaveValue('07:30'));
        expect(input('Kết thúc')).toHaveValue('11:30');
        click('Duyệt với giờ đã chỉnh');
        await waitFor(() => expect(mocks.approveShift).toHaveBeenCalledTimes(1));
        expect(mocks.approveShift).toHaveBeenCalledWith('s1', { approvedStart: vn('2026-03-10', '07:30'), approvedEnd: vn('2026-03-10', '11:30') });
      });

      it('máy chủ từ chối 400: danh sách tải lại, tấm còn mở, giờ bắt đầu chưa đụng là giờ mới, giờ kết thúc giữ chữ khách; bấm Duyệt lại gửi đúng hai giá trị đó', async () => {
        mocks.approveShift.mockRejectedValueOnce(serverError('Ca đã đổi', 400)).mockResolvedValue({ approved: true });
        await openAdjust();
        type('Kết thúc', '11:30');
        mocks.adminGetShifts.mockResolvedValue(SHIFTS_D2);
        click('Duyệt với giờ đã chỉnh');
        await waitFor(() =>
          expect(mocks.approveShift).toHaveBeenNthCalledWith(1, 's1', { approvedStart: vn('2026-03-10', '08:00'), approvedEnd: vn('2026-03-10', '11:30') }),
        );
        await waitFor(() => expect(input('Bắt đầu')).toHaveValue('07:30'));
        await settle();
        await notBusy('Duyệt với giờ đã chỉnh');
        expect(input('Kết thúc')).toHaveValue('11:30');
        click('Duyệt với giờ đã chỉnh');
        await waitFor(() => expect(mocks.approveShift).toHaveBeenCalledTimes(2));
        expect(mocks.approveShift).toHaveBeenNthCalledWith(2, 's1', { approvedStart: vn('2026-03-10', '07:30'), approvedEnd: vn('2026-03-10', '11:30') });
      });

      it('đóng rồi mở lại: nạp lại từ ca hiện tại, bỏ chữ đã sửa của lần trước', async () => {
        const qc = await openAdjust();
        type('Kết thúc', '11:30');
        click('Đóng');
        mocks.adminGetShifts.mockResolvedValue(SHIFTS_D2);
        await refetch(qc, ['admin-shifts']);
        await screen.findByText('T3 10/03 · 07:30–12:00');
        click('Chỉnh giờ Lan T3 10/03');
        expect(input('Bắt đầu')).toHaveValue('07:30');
        expect(input('Kết thúc')).toHaveValue('12:00');
      });
    });
  });
});
