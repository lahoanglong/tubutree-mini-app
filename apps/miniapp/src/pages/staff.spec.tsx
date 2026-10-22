import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAttendanceStatus: vi.fn(),
  acquireLocationPayload: vi.fn(),
  checkin: vi.fn(),
  checkout: vi.fn(),
  heartbeat: vi.fn(),
  getShifts: vi.fn(),
  getShiftTemplates: vi.fn(),
  createShifts: vi.fn(),
  updateShift: vi.fn(),
  deleteShift: vi.fn(),
  copyWeek: vi.fn(),
  cancelShift: vi.fn(),
  openSnackbar: vi.fn(),
  role: 'STAFF' as string,
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  Sheet: ({ visible, children }: { visible: boolean; children: ReactNode }) => (visible ? <div>{children}</div> : null),
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/staff', search: '', state: null }),
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../services/attendance-api', () => ({
  getAttendanceStatus: mocks.getAttendanceStatus,
  acquireLocationPayload: mocks.acquireLocationPayload,
  checkin: mocks.checkin,
  checkout: mocks.checkout,
  heartbeat: mocks.heartbeat,
}));
vi.mock('../services/shifts-api', () => ({
  getShifts: mocks.getShifts,
  getShiftTemplates: mocks.getShiftTemplates,
  createShifts: mocks.createShifts,
  updateShift: mocks.updateShift,
  deleteShift: mocks.deleteShift,
  copyWeek: mocks.copyWeek,
  cancelShift: mocks.cancelShift,
}));
vi.mock('../services/api', () => ({ getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)) }));
vi.mock('../store/auth', () => ({
  useAuthStore: (sel: (s: { user: { role: string } }) => unknown) => sel({ user: { role: mocks.role } }),
}));
vi.mock('../components/image-upload', () => ({
  ImageUpload: ({ label, onChange }: { label: string; onChange: (url: string) => void }) => (
    <button type="button" onClick={() => onChange('https://img.test/e.png')}>
      {label}
    </button>
  ),
}));

import StaffPage from './staff';

// 11/03/2026 12:00 giờ VN (Thứ 4): tuần 09/03–15/03, "hôm nay" = 11/03.
const NOW = '2026-03-11T05:00:00Z';
const TODAY = '2026-03-11';
const vn = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00+07:00`).toISOString();

const TEMPLATES = [
  { id: 't1', name: 'Ca sáng', startMin: 480, endMin: 720, active: true, sortOrder: 1 },
  { id: 't2', name: 'Ca chiều', startMin: 780, endMin: 1020, active: true, sortOrder: 2 },
];

const shift = (id: string, day: string, status: string, over: Record<string, unknown> = {}) => ({
  id,
  staffId: 'u1',
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
  ...over,
});

const WEEK_SHIFTS = [
  shift('sr', '2026-03-10', 'REJECTED', { rejectReason: 'Đủ người' }),
  shift('sp', '2026-03-12', 'PENDING'),
  shift('sa', '2026-03-13', 'APPROVED', { approvedStart: vn('2026-03-13', '09:00'), approvedEnd: vn('2026-03-13', '13:00') }),
  shift('sc', '2026-03-14', 'CANCELLED', { cancelPenalty: true }),
];

const OPEN_SESSION = {
  id: 'o1',
  shiftId: 'sh1',
  staffId: 'u1',
  checkinAt: '2026-03-11T01:30:00.000Z',
  checkoutAt: null,
  isLate: true,
  lastHeartbeatAt: '2026-03-11T04:00:00.000Z',
};

const TODAY_SHIFT = shift('sh1', TODAY, 'APPROVED');

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <StaffPage />
    </QueryClientProvider>,
  );
}

const h1s = () => screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent);
const timeInputs = () => [...document.querySelectorAll<HTMLInputElement>('input[type="time"]')];

describe('Ca làm của tôi theo DS v2 (C-076, C-114)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(NOW));
    vi.resetAllMocks();
    mocks.role = 'STAFF';
    mocks.getAttendanceStatus.mockResolvedValue({ shifts: [], openSession: null });
    mocks.acquireLocationPayload.mockResolvedValue({ lat: 10.1, lng: 106.2 });
    mocks.checkin.mockResolvedValue({ sessionId: 's1', isLate: false });
    mocks.checkout.mockResolvedValue({ checkedOut: true });
    mocks.heartbeat.mockResolvedValue({ closed: false });
    mocks.getShifts.mockResolvedValue(WEEK_SHIFTS);
    mocks.getShiftTemplates.mockResolvedValue(TEMPLATES);
    mocks.createShifts.mockResolvedValue({ created: 1 });
    mocks.updateShift.mockResolvedValue({});
    mocks.deleteShift.mockResolvedValue({ deleted: true });
    mocks.copyWeek.mockResolvedValue({ created: 2, skipped: 0 });
    mocks.cancelShift.mockResolvedValue({ cancelled: true, penalty: false });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('khung trang', () => {
    it('đúng một h1 "Ca làm của tôi" khi đang tải và khi có dữ liệu', async () => {
      mocks.getShifts.mockReturnValue(new Promise(() => undefined));
      const loading = renderPage();
      expect(h1s()).toEqual(['Ca làm của tôi']);
      expect(loading.container.querySelectorAll('.tubu-skeleton').length).toBeGreaterThan(0);
      loading.unmount();

      mocks.getShifts.mockResolvedValue(WEEK_SHIFTS);
      renderPage();
      await screen.findByText('T2 · 09/03');
      expect(h1s()).toEqual(['Ca làm của tôi']);
    });

    it('không phải nhân viên: báo không có quyền, vẫn đúng một h1, không gọi API', () => {
      mocks.role = 'CUSTOMER';
      renderPage();
      expect(screen.getByText('Trang dành cho nhân viên. Liên hệ quản trị để được cấp quyền.')).toBeInTheDocument();
      expect(h1s()).toEqual(['Ca làm của tôi']);
      expect(mocks.getShifts).not.toHaveBeenCalled();
      expect(mocks.getAttendanceStatus).not.toHaveBeenCalled();
    });

    it('lỗi tải ca: có nút Thử lại gọi lại API', async () => {
      mocks.getShifts.mockRejectedValueOnce(new Error('Mất kết nối')).mockResolvedValue(WEEK_SHIFTS);
      renderPage();
      expect(await screen.findByText('Mất kết nối')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
      await waitFor(() => expect(mocks.getShifts).toHaveBeenCalledTimes(2));
      expect(await screen.findByText('T2 · 09/03')).toBeInTheDocument();
    });
  });

  describe('thẻ "Chấm công hôm nay"', () => {
    it('hôm nay không có ca đã duyệt thì báo và không có nút Checkin', async () => {
      renderPage();
      expect(await screen.findByText('Hôm nay bạn không có ca đã duyệt.')).toBeInTheDocument();
      expect(screen.getByText('Cần ở đúng mạng WiFi công ty & trong vùng để chấm công.')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Vào ca' })).not.toBeInTheDocument();
    });

    it('Checkin: lấy vị trí rồi gửi cùng ca; đúng giờ báo thành công, tải lại trạng thái', async () => {
      mocks.getAttendanceStatus.mockResolvedValue({ shifts: [{ ...TODAY_SHIFT, approvedStart: vn(TODAY, '08:00'), approvedEnd: vn(TODAY, '12:00') }], openSession: null });
      renderPage();
      expect(await screen.findByText('Ca 08:00–12:00')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Vào ca' }));
      await waitFor(() => expect(mocks.checkin).toHaveBeenCalledWith({ shiftId: 'sh1', lat: 10.1, lng: 106.2 }));
      await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã vào ca. Chúc làm việc vui!', type: 'success' }));
      await waitFor(() => expect(mocks.getAttendanceStatus).toHaveBeenCalledTimes(2));
    });

    it('Checkin trễ: báo "đi trễ — có thể bị phạt" kiểu info', async () => {
      mocks.getAttendanceStatus.mockResolvedValue({ shifts: [TODAY_SHIFT], openSession: null });
      mocks.checkin.mockResolvedValue({ sessionId: 's1', isLate: true });
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Vào ca' }));
      await waitFor(() =>
        expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã vào ca (đi trễ — có thể bị phạt).', type: 'info' }),
      );
    });

    it('Checkin lỗi: hiện lỗi của máy chủ', async () => {
      mocks.getAttendanceStatus.mockResolvedValue({ shifts: [TODAY_SHIFT], openSession: null });
      mocks.checkin.mockRejectedValue(new Error('Sai mạng WiFi'));
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Vào ca' }));
      await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Sai mạng WiFi', type: 'error' }));
    });

    it('Checkin khi không lấy được vị trí: lý do vị trí đi kèm lỗi máy chủ trong cùng một thông báo', async () => {
      mocks.getAttendanceStatus.mockResolvedValue({ shifts: [TODAY_SHIFT], openSession: null });
      mocks.acquireLocationPayload.mockImplementation(async (onFailure?: (m: string) => void) => {
        onFailure?.('Không lấy được vị trí: hết thời gian chờ tín hiệu GPS.');
        return {};
      });
      mocks.checkin.mockRejectedValue(new Error('Bạn đang ở ngoài vùng công ty.'));
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Vào ca' }));
      await waitFor(() =>
        expect(mocks.openSnackbar).toHaveBeenCalledWith({
          text: 'Không lấy được vị trí: hết thời gian chờ tín hiệu GPS. Bạn đang ở ngoài vùng công ty.',
          type: 'error',
        }),
      );
    });

    it('heartbeat mất vị trí: báo đúng một lần cho cả chuỗi lỗi, có lại vị trí thì chuỗi mới báo lại', async () => {
      const spy = vi.spyOn(globalThis, 'setInterval');
      mocks.getAttendanceStatus.mockResolvedValue({ shifts: [], openSession: OPEN_SESSION });
      let failing = true;
      mocks.acquireLocationPayload.mockImplementation(async (onFailure?: (m: string) => void) => {
        if (failing) {
          onFailure?.('Không lấy được vị trí: bạn chưa cấp quyền vị trí cho Zalo.');
          return {};
        }
        return { lat: 1, lng: 2 };
      });
      renderPage();
      await screen.findByText('Đang trong ca · vào lúc 08:30 · đi trễ');
      const tick = spy.mock.calls.find((c) => c[1] === 3 * 60 * 1000)![0] as () => Promise<void>;
      const locCalls = () =>
        mocks.openSnackbar.mock.calls.filter((c) => String(c[0].text).startsWith('Không lấy được vị trí')).length;
      await tick();
      await tick();
      await tick();
      expect(locCalls()).toBe(1);
      expect(mocks.heartbeat).toHaveBeenCalledTimes(3);
      failing = false;
      await tick();
      failing = true;
      await tick();
      expect(locCalls()).toBe(2);
    });

    it('đang trong ca: hiện giờ vào và "đi trễ"; Checkout gọi API không kèm giờ', async () => {
      mocks.getAttendanceStatus.mockResolvedValue({ shifts: [], openSession: OPEN_SESSION });
      renderPage();
      expect(await screen.findByText('Đang trong ca · vào lúc 08:30 · đi trễ')).toBeInTheDocument();
      expect(screen.getByText('Nghỉ giữa ca? Ra ca rồi vào ca lại khi quay lại.')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Ra ca' }));
      await waitFor(() => expect(mocks.checkout).toHaveBeenCalledWith(undefined));
      await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã ra ca.', type: 'success' }));
    });

    it('"Quên checkout?" mở khung chọn giờ đã về; chỉ cho giờ sau giờ vào và không ở tương lai', async () => {
      mocks.getAttendanceStatus.mockResolvedValue({ shifts: [], openSession: OPEN_SESSION });
      renderPage();
      fireEvent.click(await screen.findByText('Quên ra ca? Chọn giờ đã về →'));
      expect(timeInputs().map((i) => i.value)).toEqual(['08:30']);
      const confirm = screen.getByRole('button', { name: 'Xác nhận ra ca' });
      // Giờ mặc định = giờ vào nên chưa hợp lệ.
      expect(confirm).toBeDisabled();
      expect(screen.getByText('Giờ đã chọn phải sau giờ vào ca (08:30) và không được ở tương lai.')).toBeInTheDocument();
      // 13:00 > 12:00 (bây giờ) → tương lai.
      fireEvent.change(timeInputs()[0]!, { target: { value: '13:00' } });
      expect(screen.getByRole('button', { name: 'Xác nhận ra ca' })).toBeDisabled();
      fireEvent.change(timeInputs()[0]!, { target: { value: '11:00' } });
      expect(screen.queryByText(/Giờ đã chọn phải sau giờ vào ca/)).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Xác nhận ra ca' }));
      await waitFor(() => expect(mocks.checkout).toHaveBeenCalledWith(vn(TODAY, '11:00')));
      await waitFor(() => expect(screen.queryByText('Ra ca lùi giờ')).not.toBeInTheDocument());
    });

    it('khung "Checkout lùi giờ" có tiêu đề h2 và ô giờ có nhãn', async () => {
      mocks.getAttendanceStatus.mockResolvedValue({ shifts: [], openSession: OPEN_SESSION });
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: /Quên ra ca\?/ }));
      expect(screen.getByRole('heading', { level: 2, name: 'Ra ca lùi giờ' })).toBeInTheDocument();
      expect(screen.getByLabelText('Giờ đã về')).toHaveValue('08:30');
    });

    it('nhịp heartbeat 3 phút: ra khỏi vùng thì báo tự checkout và tải lại trạng thái', async () => {
      const spy = vi.spyOn(globalThis, 'setInterval');
      mocks.getAttendanceStatus.mockResolvedValue({ shifts: [], openSession: OPEN_SESSION });
      mocks.acquireLocationPayload.mockResolvedValue({ lat: 1, lng: 2 });
      mocks.heartbeat.mockResolvedValue({ closed: true });
      renderPage();
      await screen.findByText('Đang trong ca · vào lúc 08:30 · đi trễ');
      const call = spy.mock.calls.find((c) => c[1] === 3 * 60 * 1000);
      expect(call).toBeDefined();
      await (call![0] as () => Promise<void>)();
      expect(mocks.heartbeat).toHaveBeenCalledWith({ lat: 1, lng: 2 });
      await waitFor(() =>
        expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã tự ra ca (ra khỏi vùng công ty).', type: 'info' }),
      );
      await waitFor(() => expect(mocks.getAttendanceStatus).toHaveBeenCalledTimes(2));
    });

    it('không trong ca thì không đặt nhịp heartbeat', async () => {
      const spy = vi.spyOn(globalThis, 'setInterval');
      renderPage();
      await screen.findByText('Hôm nay bạn không có ca đã duyệt.');
      expect(spy.mock.calls.some((c) => c[1] === 3 * 60 * 1000)).toBe(false);
    });
  });

  describe('lịch tuần', () => {
    it('hiện khoảng tuần, 7 ngày; chỉ ngày từ hôm nay có nút Thêm, ngày trống báo chưa đăng ký', async () => {
      renderPage();
      await screen.findByText('T2 · 09/03');
      expect(screen.getByText('09/03 – 15/03')).toBeInTheDocument();
      expect(mocks.getShifts).toHaveBeenCalledWith('2026-03-09T00:00:00.000Z', '2026-03-15T23:59:59.999Z');
      for (const label of ['T2 · 09/03', 'T3 · 10/03', 'T4 · 11/03', 'T5 · 12/03', 'T6 · 13/03', 'T7 · 14/03', 'CN · 15/03']) {
        expect(screen.getByText(label)).toBeInTheDocument();
      }
      expect(screen.getAllByRole('button', { name: /^Thêm ca / })).toHaveLength(5);
      expect(screen.getAllByText('Chưa đăng ký ca.')).toHaveLength(3);
    });

    it('mỗi ngày là một heading h2; hai nút chuyển tuần có tên, cao >= 44px và đổi đúng tuần truy vấn', async () => {
      renderPage();
      await screen.findByText('T2 · 09/03');
      expect(screen.getByRole('heading', { level: 2, name: 'T4 · 11/03' })).toBeInTheDocument();
      const prev = screen.getByRole('button', { name: 'Tuần trước' });
      const next = screen.getByRole('button', { name: 'Tuần sau' });
      expect(prev.style.minHeight).toBe('44px');
      expect(next.style.minHeight).toBe('44px');
      fireEvent.click(prev);
      expect(await screen.findByText('02/03 – 08/03')).toBeInTheDocument();
      await waitFor(() => expect(mocks.getShifts).toHaveBeenCalledWith('2026-03-02T00:00:00.000Z', '2026-03-08T23:59:59.999Z'));
      fireEvent.click(screen.getByRole('button', { name: 'Tuần sau' }));
      fireEvent.click(screen.getByRole('button', { name: 'Tuần sau' }));
      expect(await screen.findByText('16/03 – 22/03')).toBeInTheDocument();
    });

    it('mỗi ca hiện giờ, trạng thái, giờ đã chỉnh, lý do từ chối, phạt huỷ', async () => {
      renderPage();
      expect(await screen.findByText('Chờ duyệt')).toBeInTheDocument();
      expect(screen.getByText('Đã duyệt')).toBeInTheDocument();
      expect(screen.getByText('Từ chối')).toBeInTheDocument();
      expect(screen.getByText('Đã huỷ · phạt 1h')).toBeInTheDocument();
      expect(screen.getByText('Lý do: Đủ người')).toBeInTheDocument();
      // Ca đã duyệt hiện giờ đã chỉnh (09:00–13:00), không phải giờ đăng ký (08:00–12:00).
      expect(screen.getByText('09:00 – 13:00')).toBeInTheDocument();
      expect(screen.getByText('(đã chỉnh)')).toBeInTheDocument();
      expect(screen.getAllByText('08:00 – 12:00')).toHaveLength(3);
    });

    it('chỉ ca chờ duyệt có Sửa/Xoá; chỉ ca đã duyệt có Huỷ ca', async () => {
      renderPage();
      await screen.findByText('Chờ duyệt');
      expect(screen.getAllByRole('button', { name: /^Sửa ca / })).toHaveLength(1);
      expect(screen.getAllByRole('button', { name: /^Xoá ca / })).toHaveLength(1);
      expect(screen.getAllByRole('button', { name: /^Huỷ ca / })).toHaveLength(1);
      for (const b of [...screen.getAllByRole('button', { name: /^(Sửa|Xoá|Huỷ) ca / }), ...screen.getAllByRole('button', { name: /^Thêm ca / })]) {
        expect(b.style.minHeight).toBe('44px');
      }
    });

    it('Xoá ca chờ duyệt gọi API đúng ca, báo và tải lại', async () => {
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: /^Xoá ca / }));
      await waitFor(() => expect(mocks.deleteShift).toHaveBeenCalledWith('sp'));
      await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã xoá ca.', type: 'success' }));
      await waitFor(() => expect(mocks.getShifts).toHaveBeenCalledTimes(2));
    });

    it('Copy tuần trước: gửi mốc hai tuần; báo số ca đã copy hoặc không có ca', async () => {
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Chép tuần trước' }));
      await waitFor(() => expect(mocks.copyWeek).toHaveBeenCalledWith('2026-03-02T00:00:00.000Z', '2026-03-09T00:00:00.000Z'));
      await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã chép 2 ca từ tuần trước.', type: 'success' }));
      mocks.copyWeek.mockResolvedValue({ created: 0, skipped: 3 });
      fireEvent.click(screen.getByRole('button', { name: 'Chép tuần trước' }));
      await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Tuần trước không có ca để chép.', type: 'info' }));
    });
  });

  describe('thêm / sửa ca', () => {
    it('Thêm ca theo ca chuẩn: phải chọn ca chuẩn mới gửi được, gửi đúng ngày, giờ và templateId', async () => {
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Thêm ca T4 11/03' }));
      expect(screen.getByRole('heading', { level: 2, name: 'Thêm ca · T4 11/03' })).toBeInTheDocument();
      expect(screen.getByText('Chọn ca chuẩn')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Gửi duyệt' })).toBeDisabled();
      fireEvent.click(screen.getByRole('button', { name: 'Ca sáng (08:00–12:00)' }));
      fireEvent.click(screen.getByRole('button', { name: 'Gửi duyệt' }));
      await waitFor(() =>
        expect(mocks.createShifts).toHaveBeenCalledWith([
          { workDate: TODAY, startAt: vn(TODAY, '08:00'), endAt: vn(TODAY, '12:00'), templateId: 't1' },
        ]),
      );
      await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã gửi ca chờ duyệt.', type: 'success' }));
      await waitFor(() => expect(screen.queryByText('Chọn ca chuẩn')).not.toBeInTheDocument());
    });

    it('Thêm ca "Giờ khác": hiện hai ô giờ 08:00–12:00, gửi không kèm templateId', async () => {
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Thêm ca T4 11/03' }));
      expect(timeInputs()).toHaveLength(0);
      fireEvent.click(screen.getByRole('button', { name: 'Giờ khác' }));
      expect(timeInputs().map((i) => i.value)).toEqual(['08:00', '12:00']);
      fireEvent.change(timeInputs()[0]!, { target: { value: '09:00' } });
      fireEvent.click(screen.getByRole('button', { name: 'Gửi duyệt' }));
      await waitFor(() =>
        expect(mocks.createShifts).toHaveBeenCalledWith([
          { workDate: TODAY, startAt: vn(TODAY, '09:00'), endAt: vn(TODAY, '12:00'), templateId: undefined },
        ]),
      );
    });

    it('chưa có ca chuẩn nào: hiện ngay hai ô giờ, không có dòng "Chọn ca chuẩn"', async () => {
      mocks.getShiftTemplates.mockResolvedValue([]);
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Thêm ca T4 11/03' }));
      expect(timeInputs()).toHaveLength(2);
      expect(screen.queryByText('Chọn ca chuẩn')).not.toBeInTheDocument();
    });

    it('ca chuẩn là nút bật/tắt báo aria-pressed; ô giờ có nhãn "Bắt đầu"/"Kết thúc"', async () => {
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Thêm ca T4 11/03' }));
      const sang = screen.getByRole('button', { name: 'Ca sáng (08:00–12:00)' });
      expect(sang).toHaveAttribute('aria-pressed', 'false');
      fireEvent.click(sang);
      expect(sang).toHaveAttribute('aria-pressed', 'true');
      fireEvent.click(screen.getByRole('button', { name: 'Giờ khác' }));
      expect(sang).toHaveAttribute('aria-pressed', 'false');
      expect(screen.getByLabelText('Bắt đầu')).toHaveValue('08:00');
      expect(screen.getByLabelText('Kết thúc')).toHaveValue('12:00');
    });

    it('Sửa ca chờ duyệt: nạp sẵn giờ cũ, lưu gọi updateShift với giờ mới', async () => {
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: /^Sửa ca / }));
      expect(screen.getByRole('heading', { level: 2, name: 'Sửa ca · T5 12/03' })).toBeInTheDocument();
      expect(timeInputs().map((i) => i.value)).toEqual(['08:00', '12:00']);
      fireEvent.change(timeInputs()[1]!, { target: { value: '11:30' } });
      fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
      await waitFor(() =>
        expect(mocks.updateShift).toHaveBeenCalledWith('sp', { startAt: vn('2026-03-12', '08:00'), endAt: vn('2026-03-12', '11:30') }),
      );
      await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã cập nhật ca.', type: 'success' }));
    });

    it('gửi lỗi: báo lỗi máy chủ và giữ khung', async () => {
      mocks.createShifts.mockRejectedValue(new Error('Trùng ca'));
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Thêm ca T4 11/03' }));
      fireEvent.click(screen.getByRole('button', { name: 'Ca sáng (08:00–12:00)' }));
      fireEvent.click(screen.getByRole('button', { name: 'Gửi duyệt' }));
      await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Trùng ca', type: 'error' }));
      expect(screen.getByText('Chọn ca chuẩn')).toBeInTheDocument();
    });
  });

  describe('đăng ký nhanh cả tuần', () => {
    it('hai ô giờ có tên truy cập phân biệt "Bắt đầu"/"Kết thúc", không rơi về tên mặc định "Giờ"', async () => {
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Đăng ký nhanh' }));
      expect(screen.getByLabelText('Bắt đầu')).toHaveValue('08:00');
      expect(screen.getByLabelText('Kết thúc')).toHaveValue('17:00');
      expect(screen.queryByLabelText('Giờ')).not.toBeInTheDocument();
    });

    it('mặc định T2–T6 từ hôm nay; ngày đã qua bị khoá; gửi đúng các ngày với giờ 08:00–17:00', async () => {
      mocks.createShifts.mockResolvedValue({ created: 3 });
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Đăng ký nhanh' }));
      expect(screen.getByRole('heading', { level: 2, name: 'Đăng ký nhanh cả tuần' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'T2 09/03' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'T3 10/03' })).toBeDisabled();
      for (const d of ['T4 11/03', 'T5 12/03', 'T6 13/03']) {
        expect(screen.getByRole('button', { name: d })).toHaveAttribute('aria-pressed', 'true');
      }
      expect(screen.getByRole('button', { name: 'T7 14/03' })).toHaveAttribute('aria-pressed', 'false');
      expect(timeInputs().map((i) => i.value)).toEqual(['08:00', '17:00']);
      fireEvent.click(screen.getByRole('button', { name: 'Gửi duyệt (3 ngày)' }));
      await waitFor(() =>
        expect(mocks.createShifts).toHaveBeenCalledWith(
          ['2026-03-11', '2026-03-12', '2026-03-13'].map((d) => ({ workDate: d, startAt: vn(d, '08:00'), endAt: vn(d, '17:00'), templateId: undefined })),
        ),
      );
      await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã đăng ký 3 ca chờ duyệt.', type: 'success' }));
    });

    it('bỏ chọn một ngày thì số ngày giảm; bỏ hết thì không gửi được', async () => {
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Đăng ký nhanh' }));
      fireEvent.click(screen.getByRole('button', { name: 'T6 13/03' }));
      expect(screen.getByRole('button', { name: 'Gửi duyệt (2 ngày)' })).toBeEnabled();
      fireEvent.click(screen.getByRole('button', { name: 'T4 11/03' }));
      fireEvent.click(screen.getByRole('button', { name: 'T5 12/03' }));
      expect(screen.getByRole('button', { name: 'Gửi duyệt' })).toBeDisabled();
    });

    it('chọn ca chuẩn thì ẩn ô giờ và gửi giờ + templateId của ca chuẩn', async () => {
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Đăng ký nhanh' }));
      fireEvent.click(screen.getByRole('button', { name: 'Ca chiều (13:00–17:00)' }));
      expect(timeInputs()).toHaveLength(0);
      fireEvent.click(screen.getByRole('button', { name: 'T6 13/03' }));
      fireEvent.click(screen.getByRole('button', { name: 'Gửi duyệt (2 ngày)' }));
      await waitFor(() =>
        expect(mocks.createShifts).toHaveBeenCalledWith(
          ['2026-03-11', '2026-03-12'].map((d) => ({ workDate: d, startAt: vn(d, '13:00'), endAt: vn(d, '17:00'), templateId: 't2' })),
        ),
      );
    });
  });

  describe('huỷ ca đã duyệt', () => {
    const openCancel = async () => {
      fireEvent.click(await screen.findByRole('button', { name: /^Huỷ ca / }));
      expect(screen.getByRole('heading', { level: 2, name: 'Huỷ ca đã duyệt' })).toBeInTheDocument();
    };

    it('phải nhập lý do mới xác nhận được; huỷ không đột xuất không kèm chứng cứ', async () => {
      renderPage();
      await openCancel();
      expect(screen.getByRole('button', { name: 'Xác nhận huỷ' })).toBeDisabled();
      fireEvent.change(screen.getByPlaceholderText('Lý do huỷ'), { target: { value: '  Bận việc nhà ' } });
      fireEvent.click(screen.getByRole('button', { name: 'Xác nhận huỷ' }));
      await waitFor(() => expect(mocks.cancelShift).toHaveBeenCalledWith('sa', { reason: 'Bận việc nhà', isEmergency: false, evidenceUrl: undefined }));
      await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã huỷ ca (không phạt).', type: 'success' }));
      await waitFor(() => expect(screen.queryByText('Huỷ ca đã duyệt')).not.toBeInTheDocument());
    });

    it('đột xuất: hiện ô ảnh chứng cứ, bắt buộc có ảnh; báo phạt 1h khi máy chủ tính phạt', async () => {
      mocks.cancelShift.mockResolvedValue({ cancelled: true, penalty: true });
      renderPage();
      await openCancel();
      expect(screen.queryByRole('button', { name: 'Ảnh chứng cứ' })).not.toBeInTheDocument();
      fireEvent.change(screen.getByPlaceholderText('Lý do huỷ'), { target: { value: 'Ốm' } });
      fireEvent.click(screen.getByText('Đột xuất (có chứng cứ)'));
      expect(screen.getByRole('button', { name: 'Xác nhận huỷ' })).toBeDisabled();
      fireEvent.click(screen.getByRole('button', { name: 'Ảnh chứng cứ' }));
      fireEvent.click(screen.getByRole('button', { name: 'Xác nhận huỷ' }));
      await waitFor(() =>
        expect(mocks.cancelShift).toHaveBeenCalledWith('sa', { reason: 'Ốm', isEmergency: true, evidenceUrl: 'https://img.test/e.png' }),
      );
      await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã huỷ ca — bị tính phạt 1h công.', type: 'info' }));
    });

    it('công tắc "Đột xuất" là switch thật: có tên, aria-checked, Tab/Enter/Space, cao >= 44px', async () => {
      renderPage();
      await openCancel();
      const sw = screen.getByRole('switch', { name: 'Đột xuất (có chứng cứ)' });
      expect(sw).toHaveAttribute('aria-checked', 'false');
      expect(sw.style.minHeight).toBe('44px');
      fireEvent.keyDown(sw, { key: ' ' });
      expect(sw).toHaveAttribute('aria-checked', 'true');
      fireEvent.click(sw);
      expect(sw).toHaveAttribute('aria-checked', 'false');
    });

    it('ô lý do có nhãn gắn với ô', async () => {
      renderPage();
      await openCancel();
      expect(screen.getByLabelText('Lý do huỷ')).toBeInTheDocument();
    });

    it('huỷ lỗi: báo lỗi máy chủ, giữ khung và lý do đã nhập', async () => {
      mocks.cancelShift.mockRejectedValue(new Error('Quá hạn huỷ'));
      renderPage();
      await openCancel();
      fireEvent.change(screen.getByPlaceholderText('Lý do huỷ'), { target: { value: 'Ốm' } });
      fireEvent.click(screen.getByRole('button', { name: 'Xác nhận huỷ' }));
      await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Quá hạn huỷ', type: 'error' }));
      expect(screen.getByPlaceholderText('Lý do huỷ')).toHaveValue('Ốm');
    });
  });
});
