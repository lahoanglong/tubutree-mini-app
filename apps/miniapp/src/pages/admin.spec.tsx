import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { formatVnd } from '../utils/format';
import { vi as t } from '../i18n/vi';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  openSnackbar: vi.fn(),
  role: 'ADMIN' as string,
  listStaff: vi.fn(),
  grantStaff: vi.fn(),
  revokeStaff: vi.fn(),
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
  getPendingRefillReturns: vi.fn(),
  approveRefillReturn: vi.fn(),
  rejectRefillReturn: vi.fn(),
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  Sheet: ({ visible, children }: { visible: boolean; children: ReactNode }) => (visible ? <div>{children}</div> : null),
  useNavigate: () => mocks.navigate,
  useLocation: () => ({ pathname: '/admin', search: '', state: null }),
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../services/staff-api', () => ({ listStaff: mocks.listStaff, grantStaff: mocks.grantStaff, revokeStaff: mocks.revokeStaff }));
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
vi.mock('../services/refill-api', () => ({
  getPendingRefillReturns: mocks.getPendingRefillReturns,
  approveRefillReturn: mocks.approveRefillReturn,
  rejectRefillReturn: mocks.rejectRefillReturn,
}));
vi.mock('../services/api', () => ({ getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)) }));
vi.mock('../store/auth', () => ({
  useAuthStore: (sel: (s: { user: { role: string } }) => unknown) => sel({ user: { role: mocks.role } }),
}));
vi.mock('../components/image-upload', () => ({
  ImageUpload: ({ label, onChange }: { label: string; onChange: (url: string) => void }) => (
    <button type="button" onClick={() => onChange('https://img.test/proof.png')}>
      {label}
    </button>
  ),
}));

import AdminPage from './admin';

// 11/03/2026 12:00 giờ VN: tháng 3/2026, tuần 09/03–15/03.
const NOW = '2026-03-11T05:00:00Z';
const vn = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00+07:00`).toISOString();

const MEMBERS = [
  { id: 'u1', phone: '0901234567', fullName: 'Lan', avatarUrl: null, role: 'STAFF', createdAt: '2026-01-01T00:00:00Z' },
  { id: 'u2', phone: '0912345678', fullName: null, avatarUrl: null, role: 'ADMIN', createdAt: '2026-01-01T00:00:00Z' },
  { id: 'u3', phone: null, fullName: 'Chưa có số', avatarUrl: null, role: 'STAFF', createdAt: '2026-01-01T00:00:00Z' },
];
const INVITES = [{ phone: '0987654321', role: 'STAFF', createdAt: '2026-02-01T00:00:00Z' }];

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
    profile: profile({ qrImageUrl: 'https://img.test/qr2.png' }),
    qrImageUrl: null,
  },
  { staff: { id: 'u3', fullName: 'Bình', phone: null }, month: month('PAID', { totalMinutes: 120, totalFines: 0, net: 100000 }), profile: null, qrImageUrl: 'https://img.test/qr3.png' },
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

const REFILLS = [
  {
    id: 'r1',
    quantity: 3,
    seedsAwarded: 30,
    status: 'PENDING',
    createdAt: '2026-03-10T03:00:00.000Z',
    user: { id: 'k1', fullName: 'Hoa', phone: '0900000001' },
    pickupLocation: { id: 'l2', name: 'Kho Thủ Đức', address: '5 Võ Văn Ngân' },
  },
  { id: 'r2', quantity: 1, seedsAwarded: 10, status: 'PENDING', createdAt: '2026-03-10T04:00:00.000Z', user: { id: 'k2', fullName: '=Độc', phone: '0900000002' } },
];

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
    mocks.listStaff.mockResolvedValue({ members: MEMBERS, pendingInvites: INVITES });
    mocks.grantStaff.mockResolvedValue({ granted: 'STAFF', applied: true });
    mocks.revokeStaff.mockResolvedValue({ revoked: 1, downgraded: false });
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
    mocks.getPendingRefillReturns.mockResolvedValue(REFILLS);
    mocks.approveRefillReturn.mockResolvedValue({ ok: true });
    mocks.rejectRefillReturn.mockResolvedValue({ ok: true });
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
      expect(tabs.map((x) => x.textContent)).toEqual(['Nhân sự', 'Duyệt ca', 'Lương', 'Duyệt đổi vỏ']);
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

    it('Thu hồi hỏi lại; đồng ý thì gọi API, từ chối thì không làm gì', async () => {
      const confirm = confirmSpy().mockReturnValueOnce(false).mockReturnValueOnce(true);
      renderPage();
      await screen.findByText('Lan');
      fireEvent.click(screen.getByRole('button', { name: 'Thu hồi · Lan' }));
      expect(confirm).toHaveBeenCalledWith('Thu hồi quyền của Lan? Người này sẽ mất toàn bộ quyền nhân viên/quản trị.');
      expect(mocks.revokeStaff).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Thu hồi · Lan' }));
      await waitFor(() => expect(mocks.revokeStaff).toHaveBeenCalledWith('0901234567'));
      await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã thu hồi quyền.', type: 'success' }));
      // Người chưa có tên: hỏi bằng SĐT.
      confirm.mockReturnValueOnce(false);
      fireEvent.click(screen.getByRole('button', { name: 'Thu hồi · 0912345678' }));
      expect(confirm).toHaveBeenLastCalledWith('Thu hồi quyền của 0912345678? Người này sẽ mất toàn bộ quyền nhân viên/quản trị.');
    });

    it('Huỷ lời mời chờ mở app gọi thu hồi theo SĐT, không hỏi lại', async () => {
      const confirm = confirmSpy();
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Huỷ lời mời · 0987654321' }));
      await waitFor(() => expect(mocks.revokeStaff).toHaveBeenCalledWith('0987654321'));
      expect(confirm).not.toHaveBeenCalled();
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
      expect(screen.getByRole('button', { name: 'Lưu quyền' })).toBeEnabled();
      fireEvent.click(screen.getByRole('button', { name: 'Lưu quyền' }));
      await waitFor(() => expect(mocks.grantStaff).toHaveBeenCalledWith('0901112223', 'STAFF'));
      await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã cấp quyền & áp ngay.', type: 'success' }));
      await waitFor(() => expect(screen.queryByText('Thêm nhân sự theo SĐT')).not.toBeInTheDocument());

      mocks.grantStaff.mockResolvedValue({ granted: 'STAFF', applied: false });
      fireEvent.click(screen.getByRole('button', { name: 'Thêm' }));
      fireEvent.change(screen.getByLabelText('Số điện thoại'), { target: { value: '0907778889' } });
      fireEvent.click(screen.getByRole('button', { name: 'Lưu quyền' }));
      await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã lưu quyền (sẽ áp khi họ mở app).', type: 'success' }));
    });

    it('cấp QUẢN TRỊ phải xác nhận thêm; từ chối thì không gọi API, đồng ý thì gửi vai trò ADMIN', async () => {
      const confirm = confirmSpy().mockReturnValueOnce(false).mockReturnValueOnce(true);
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Thêm' }));
      const staff = screen.getByRole('button', { name: 'Nhân viên' });
      const admin = screen.getByRole('button', { name: 'Quản trị' });
      expect(staff).toHaveAttribute('aria-pressed', 'true');
      expect(admin).toHaveAttribute('aria-pressed', 'false');
      fireEvent.click(admin);
      expect(admin).toHaveAttribute('aria-pressed', 'true');
      fireEvent.change(screen.getByLabelText('Số điện thoại'), { target: { value: '0901112223' } });
      fireEvent.click(screen.getByRole('button', { name: 'Lưu quyền' }));
      expect(confirm).toHaveBeenCalledWith('Xác nhận cấp quyền ADMIN (toàn quyền quản trị) cho SĐT 0901112223?');
      expect(mocks.grantStaff).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Lưu quyền' }));
      await waitFor(() => expect(mocks.grantStaff).toHaveBeenCalledWith('0901112223', 'ADMIN'));
    });

    it('cấp quyền lỗi: báo lỗi máy chủ và giữ khung', async () => {
      mocks.grantStaff.mockRejectedValue(new Error('SĐT không tồn tại'));
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Thêm' }));
      fireEvent.change(screen.getByLabelText('Số điện thoại'), { target: { value: '0901112223' } });
      fireEvent.click(screen.getByRole('button', { name: 'Lưu quyền' }));
      await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'SĐT không tồn tại', type: 'error' }));
      expect((screen.getByLabelText('Số điện thoại') as HTMLInputElement).value).toBe('0901112223');
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

    it('Mở lại bảng lương hỏi lại; từ chối thì không gọi API, đồng ý thì gọi đúng nhân viên + tháng', async () => {
      const confirm = confirmSpy().mockReturnValueOnce(false).mockReturnValueOnce(true);
      await openPayroll();
      fireEvent.click(screen.getByRole('button', { name: 'Mở lại · Bình' }));
      expect(confirm).toHaveBeenCalledWith('Mở lại bảng lương T3/2026 của Bình? Cần chốt lại sau khi sửa.');
      expect(mocks.reopenPayroll).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Mở lại · Bình' }));
      await waitFor(() => expect(mocks.reopenPayroll).toHaveBeenCalledWith('u3', 2026, 3));
      await waitFor(() =>
        expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã mở lại bảng lương — sửa xong nhớ chốt lại.', type: 'success' }),
      );
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
      expect(screen.getByAltText('QR')).toHaveAttribute('src', 'https://img.test/qr3.png');
      expect(screen.getAllByText(formatVnd(100000)).length).toBeGreaterThan(0);
      expect(screen.getByText('Quét chuyển khoản rồi bấm "Đã chuyển" để tải ảnh xác nhận.')).toBeInTheDocument();
    });

    it('QR chuyển dùng ảnh QR trong hồ sơ khi dòng không có ảnh riêng, kèm tài khoản ngân hàng', async () => {
      await openPayroll();
      fireEvent.click(screen.getByRole('button', { name: 'QR chuyển · 0912345678' }));
      expect(screen.getByAltText('QR')).toHaveAttribute('src', 'https://img.test/qr2.png');
      expect(screen.getByText('NGUYEN LAN · 0123456789')).toBeInTheDocument();
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

  describe('Duyệt đổi vỏ', () => {
    const openRefill = async () => {
      renderPage();
      await screen.findByText('Lan');
      goTab('Duyệt đổi vỏ');
      await screen.findByText('Hoa');
    };

    it('liệt kê yêu cầu chờ duyệt kèm số vỏ và số nước; tiêu đề có số lượng', async () => {
      await openRefill();
      expect(screen.getByRole('heading', { level: 2, name: 'Duyệt đổi vỏ chai (2)' })).toBeInTheDocument();
      expect(screen.getByText(/0900000001 · Đổi/)).toBeInTheDocument();
      expect(screen.getByText('3 vỏ')).toBeInTheDocument();
      expect(screen.getByText('=Độc')).toBeInTheDocument();
    });

    it('mỗi yêu cầu hiện điểm khách sẽ mang vỏ tới; yêu cầu cũ chưa chọn điểm thì không có dòng đó', async () => {
      await openRefill();
      expect(screen.getByText('Mang tới: Kho Thủ Đức · 5 Võ Văn Ngân')).toBeInTheDocument();
      expect(screen.getAllByText(/^Mang tới: /)).toHaveLength(1);
    });

    it('lọc theo tên hoặc SĐT; nút xoá từ khoá có tên; không khớp thì báo; trống thì báo khác', async () => {
      await openRefill();
      const search = screen.getByRole('searchbox', { name: 'Tìm theo tên hoặc SĐT' });
      fireEvent.change(search, { target: { value: '0900000002' } });
      expect(screen.getByRole('heading', { level: 2, name: 'Duyệt đổi vỏ chai (1)' })).toBeInTheDocument();
      expect(screen.queryByText('Hoa')).not.toBeInTheDocument();
      fireEvent.change(search, { target: { value: 'không có' } });
      expect(screen.getByText('Không tìm thấy yêu cầu phù hợp')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Xoá từ khoá tìm' }));
      expect(search).toHaveValue('');
      expect(screen.getByText('Hoa')).toBeInTheDocument();
    });

    it('không có yêu cầu nào: báo trống', async () => {
      mocks.getPendingRefillReturns.mockResolvedValue([]);
      renderPage();
      await screen.findByText('Lan');
      goTab('Duyệt đổi vỏ');
      expect(await screen.findByText('Không có yêu cầu đổi vỏ chai nào đang chờ duyệt')).toBeInTheDocument();
    });

    it('Duyệt gọi API đúng yêu cầu, báo thành công; Từ chối báo kiểu info', async () => {
      await openRefill();
      fireEvent.click(screen.getByRole('button', { name: 'Duyệt · Hoa' }));
      await waitFor(() => expect(mocks.approveRefillReturn).toHaveBeenCalledWith('r1', 3));
      await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã duyệt yêu cầu đổi vỏ chai.', type: 'success' }));
      fireEvent.click(screen.getByRole('button', { name: 'Từ chối · =Độc' }));
      await waitFor(() => expect(mocks.rejectRefillReturn).toHaveBeenCalledWith('r2'));
      await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã từ chối yêu cầu.', type: 'info' }));
    });

    it('nhân viên đếm thiếu vỏ: giảm "Vỏ thực nhận" rồi Duyệt gửi đúng số đếm, giọt nước xem trước theo số đó', async () => {
      await openRefill();
      expect(screen.getByText('Đếm tại điểm nhận · +30 giọt nước')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Giảm số lượng' }));
      expect(screen.getByText('Đếm tại điểm nhận · +20 giọt nước')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Duyệt · Hoa' }));
      await waitFor(() => expect(mocks.approveRefillReturn).toHaveBeenCalledWith('r1', 2));
    });

    it('không cho nhập quá số khách khai; yêu cầu chỉ 1 vỏ thì không có bộ chọn và duyệt đúng 1', async () => {
      await openRefill();
      const plus = screen.getByRole('button', { name: 'Tăng số lượng' });
      expect(plus).toHaveAttribute('aria-disabled', 'true');
      expect(screen.getAllByRole('button', { name: 'Giảm số lượng' })).toHaveLength(1);
      fireEvent.click(screen.getByRole('button', { name: 'Duyệt · =Độc' }));
      await waitFor(() => expect(mocks.approveRefillReturn).toHaveBeenCalledWith('r2', 1));
    });

    it('đang duyệt một yêu cầu thì nút Từ chối của yêu cầu khác bị khoá', async () => {
      mocks.approveRefillReturn.mockReturnValue(new Promise(() => undefined));
      await openRefill();
      fireEvent.click(screen.getByRole('button', { name: 'Duyệt · Hoa' }));
      await waitFor(() => expect(screen.getByRole('button', { name: 'Từ chối · =Độc' })).toBeDisabled());
    });

    it('Xuất CSV chỉ gồm các dòng đang lọc, chống công thức Excel (dấu = đầu ô), kèm tên file', async () => {
      const links: HTMLAnchorElement[] = [];
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
        links.push(this);
      });
      await openRefill();
      fireEvent.change(screen.getByRole('searchbox', { name: 'Tìm theo tên hoặc SĐT' }), { target: { value: '0900000002' } });
      fireEvent.click(screen.getByRole('button', { name: 'Xuất CSV' }));
      expect(links).toHaveLength(1);
      expect(links[0]!.getAttribute('download')).toMatch(/^bao_cao_doi_vo_chai_\d+\.csv$/);
      const csv = decodeURI(links[0]!.getAttribute('href')!);
      expect(csv).toContain('ID,Khách hàng,SĐT,Số vỏ chai,Số nước,Thời gian,Điểm nhận');
      expect(csv).toContain('r2,"\'=Độc","0900000002",1,10,');
      expect(csv).not.toContain('\nr1,');
      await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã xuất file báo cáo CSV!', type: 'success' }));
    });

    it('Xuất CSV có cột Điểm nhận (để trống ở yêu cầu cũ)', async () => {
      const links: HTMLAnchorElement[] = [];
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
        links.push(this);
      });
      await openRefill();
      fireEvent.click(screen.getByRole('button', { name: 'Xuất CSV' }));
      const csv = decodeURI(links[0]!.getAttribute('href')!);
      expect(csv).toMatch(/\nr1,"Hoa","0900000001",3,30,"[^"]*","Kho Thủ Đức"/);
      expect(csv).toMatch(/\nr2,"'=Độc","0900000002",1,10,"[^"]*",""/);
    });

    it('Xuất CSV khi không có dòng nào: báo không có dữ liệu', async () => {
      await openRefill();
      fireEvent.change(screen.getByRole('searchbox', { name: 'Tìm theo tên hoặc SĐT' }), { target: { value: 'không có' } });
      fireEvent.click(screen.getByRole('button', { name: 'Xuất CSV' }));
      expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Không có dữ liệu để xuất CSV', type: 'info' });
    });
  });
});
