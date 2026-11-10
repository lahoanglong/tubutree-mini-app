import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { vi as t } from '../i18n/vi';

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
      <button type="button" disabled={disabled} onClick={() => onChange('https://img.test/e.png')}>
        {label}
      </button>
    );
  },
}));

import { HttpError } from '../services/http';
import { LOCK_REFRESH_WAIT_MS } from '../utils/settle-within';
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
      expect(screen.getByText('Trang dành cho nhân viên')).toBeInTheDocument();
      expect(h1s()).toEqual(['Ca làm của tôi']);
      expect(mocks.getShifts).not.toHaveBeenCalled();
      expect(mocks.getAttendanceStatus).not.toHaveBeenCalled();
    });

    it('không phải nhân viên: nút "Về Cá nhân" mở /profile', () => {
      mocks.role = 'CUSTOMER';
      renderPage();
      fireEvent.click(screen.getByRole('button', { name: 'Về Cá nhân' }));
      expect(mocks.navigate).toHaveBeenCalledWith('/profile');
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
    it('đang tải trạng thái chấm công: KHÔNG báo "không có ca đã duyệt" (chưa biết), không có nút Vào ca', async () => {
      mocks.getAttendanceStatus.mockReturnValue(new Promise(() => undefined));
      renderPage();
      await screen.findByText('T2 · 09/03');
      expect(screen.queryByText('Hôm nay bạn không có ca đã duyệt.')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Vào ca' })).not.toBeInTheDocument();
    });

    it('trạng thái chấm công lỗi: báo không tải được và Thử lại gọi lại; không nói "không có ca"', async () => {
      mocks.getAttendanceStatus.mockRejectedValueOnce(new Error('Mất kết nối')).mockResolvedValue({ shifts: [], openSession: null });
      renderPage();
      expect(await screen.findByText('Không tải được trạng thái chấm công.')).toBeInTheDocument();
      expect(screen.queryByText('Hôm nay bạn không có ca đã duyệt.')).not.toBeInTheDocument();
      fireEvent.click(screen.getAllByRole('button', { name: 'Thử lại' })[0]!);
      await waitFor(() => expect(mocks.getAttendanceStatus).toHaveBeenCalledTimes(2));
      expect(await screen.findByText('Hôm nay bạn không có ca đã duyệt.')).toBeInTheDocument();
    });

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

    it('ra ca trong lúc nhịp heartbeat còn đang lấy vị trí: nhịp cũ không gửi heartbeat và không báo "tự ra ca"', async () => {
      const spy = vi.spyOn(globalThis, 'setInterval');
      mocks.getAttendanceStatus
        .mockResolvedValueOnce({ shifts: [], openSession: OPEN_SESSION })
        .mockResolvedValue({ shifts: [], openSession: null });
      let gotLocation!: (v: unknown) => void;
      mocks.acquireLocationPayload.mockReturnValueOnce(new Promise((r) => (gotLocation = r)));
      mocks.heartbeat.mockResolvedValue({ closed: true });
      renderPage();
      await screen.findByText('Đang trong ca · vào lúc 08:30 · đi trễ');
      const tick = spy.mock.calls.find((c) => c[1] === 3 * 60 * 1000)![0] as () => Promise<void>;
      const running = tick();
      fireEvent.click(screen.getByRole('button', { name: 'Ra ca' }));
      await waitFor(() => expect(mocks.checkout).toHaveBeenCalledTimes(1));
      await screen.findByText('Hôm nay bạn không có ca đã duyệt.');
      await act(async () => {
        gotLocation({ lat: 1, lng: 2 });
        await running;
      });
      expect(mocks.heartbeat).not.toHaveBeenCalled();
      expect(mocks.openSnackbar).not.toHaveBeenCalledWith({ text: 'Đã tự ra ca (ra khỏi vùng công ty).', type: 'info' });
    });

    it('ra ca trong lúc nhịp heartbeat còn đang lấy vị trí: lỗi vị trí đến muộn không hiện cảnh báo', async () => {
      const spy = vi.spyOn(globalThis, 'setInterval');
      mocks.getAttendanceStatus
        .mockResolvedValueOnce({ shifts: [], openSession: OPEN_SESSION })
        .mockResolvedValue({ shifts: [], openSession: null });
      let failLate!: () => void;
      mocks.acquireLocationPayload.mockImplementationOnce(
        (onFailure?: (m: string) => void) =>
          new Promise((r) => {
            failLate = () => {
              onFailure?.('Không lấy được vị trí: hết thời gian chờ tín hiệu GPS.');
              r({});
            };
          }),
      );
      renderPage();
      await screen.findByText('Đang trong ca · vào lúc 08:30 · đi trễ');
      const tick = spy.mock.calls.find((c) => c[1] === 3 * 60 * 1000)![0] as () => Promise<void>;
      const running = tick();
      fireEvent.click(screen.getByRole('button', { name: 'Ra ca' }));
      await waitFor(() => expect(mocks.checkout).toHaveBeenCalledTimes(1));
      await screen.findByText('Hôm nay bạn không có ca đã duyệt.');
      await act(async () => {
        failLate();
        await running;
      });
      expect(mocks.openSnackbar).not.toHaveBeenCalledWith({
        text: 'Không lấy được vị trí: hết thời gian chờ tín hiệu GPS.',
        type: 'warning',
      });
    });

    it('rời trang khi heartbeat đã gửi: câu trả lời "closed" vẫn báo "tự ra ca" và tải lại trạng thái', async () => {
      const spy = vi.spyOn(globalThis, 'setInterval');
      mocks.getAttendanceStatus.mockResolvedValue({ shifts: [], openSession: OPEN_SESSION });
      mocks.acquireLocationPayload.mockResolvedValue({ lat: 1, lng: 2 });
      let answered!: (v: unknown) => void;
      mocks.heartbeat.mockReturnValueOnce(new Promise((r) => (answered = r)));
      const view = renderPage();
      await screen.findByText('Đang trong ca · vào lúc 08:30 · đi trễ');
      const tick = spy.mock.calls.find((c) => c[1] === 3 * 60 * 1000)![0] as () => Promise<void>;
      const running = tick();
      await waitFor(() => expect(mocks.heartbeat).toHaveBeenCalledTimes(1));
      view.unmount();
      await act(async () => {
        answered({ closed: true });
        await running;
      });
      expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã tự ra ca (ra khỏi vùng công ty).', type: 'info' });
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

    it('thẻ ngày hôm nay (T4 · 11/03) có nhãn "Hôm nay" và viền nổi; ngày khác thì không', async () => {
      renderPage();
      await screen.findByText('T2 · 09/03');
      const card = (label: string) => screen.getByRole('heading', { level: 2, name: label }).parentElement!.parentElement!.parentElement!.parentElement!;
      const today = card('T4 · 11/03');
      expect(today).toHaveTextContent('Hôm nay');
      expect(today.style.border).toContain('1.5px solid');
      const other = card('T5 · 12/03');
      expect(other).not.toHaveTextContent('Hôm nay');
      expect(other.style.border).toBe('');
      expect(screen.getAllByText('Hôm nay')).toHaveLength(1);
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
      fireEvent.click(await screen.findByRole('button', { name: 'Đăng ký ca' }));
      expect(screen.getByLabelText('Bắt đầu')).toHaveValue('08:00');
      expect(screen.getByLabelText('Kết thúc')).toHaveValue('17:00');
      expect(screen.queryByLabelText('Giờ')).not.toBeInTheDocument();
    });

    it('mặc định T2–T6 từ hôm nay; ngày đã qua bị khoá; gửi đúng các ngày với giờ 08:00–17:00', async () => {
      mocks.createShifts.mockResolvedValue({ created: 3 });
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Đăng ký ca' }));
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
      fireEvent.click(await screen.findByRole('button', { name: 'Đăng ký ca' }));
      fireEvent.click(screen.getByRole('button', { name: 'T6 13/03' }));
      expect(screen.getByRole('button', { name: 'Gửi duyệt (2 ngày)' })).toBeEnabled();
      fireEvent.click(screen.getByRole('button', { name: 'T4 11/03' }));
      fireEvent.click(screen.getByRole('button', { name: 'T5 12/03' }));
      expect(screen.getByRole('button', { name: 'Gửi duyệt' })).toBeDisabled();
    });

    it('chọn ca chuẩn thì ẩn ô giờ và gửi giờ + templateId của ca chuẩn', async () => {
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Đăng ký ca' }));
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

  // W76A: hai cú chạm trong CÙNG một khung hình (trước khi React vẽ lại `isPending`) từng gửi hai yêu cầu; khoá ref chặn ngay.
  describe('khoá chạm đúp trong cùng một khung hình (W76A)', () => {
    const deferred = () => {
      let resolve!: (v: unknown) => void;
      let reject!: (e: unknown) => void;
      const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    };
    const snackbarWith = (text: string) => mocks.openSnackbar.mock.calls.filter((c) => c[0].text === text).length;
    const errorSnackbars = () => mocks.openSnackbar.mock.calls.filter((c) => c[0].type === 'error').length;
    const SP2 = shift('sp2', '2026-03-13', 'PENDING');
    const TWO_PENDING = [WEEK_SHIFTS[1]!, SP2];

    describe('chấm công hôm nay (checkinM, checkoutM)', () => {
      const withTodayShifts = (...shifts: unknown[]) =>
        mocks.getAttendanceStatus.mockResolvedValue({ shifts, openSession: null });
      const withOpenSession = () => mocks.getAttendanceStatus.mockResolvedValue({ shifts: [], openSession: OPEN_SESSION });

      it('chạm đúp "Vào ca" chỉ vào ca một lần và lấy vị trí một lần; đang xử lý nút aria-busy', async () => {
        const d = deferred();
        withTodayShifts(TODAY_SHIFT);
        mocks.checkin.mockReturnValueOnce(d.promise);
        renderPage();
        const btn = await screen.findByRole('button', { name: 'Vào ca' });
        await act(async () => {
          fireEvent.click(btn);
          fireEvent.click(btn);
        });
        expect(mocks.acquireLocationPayload).toHaveBeenCalledTimes(1);
        expect(mocks.checkin).toHaveBeenCalledTimes(1);
        expect(mocks.checkin).toHaveBeenCalledWith({ shiftId: 'sh1', lat: 10.1, lng: 106.2 });
        await waitFor(() => expect(btn).toHaveAttribute('aria-busy', 'true'));
        await act(async () => d.resolve({ sessionId: 's1', isLate: false }));
        await waitFor(() => expect(snackbarWith('Đã vào ca. Chúc làm việc vui!')).toBe(1));
        expect(mocks.checkin).toHaveBeenCalledTimes(1);
      });

      it('Vào ca lỗi thì nhả khoá, bấm lại vào ca lần hai', async () => {
        withTodayShifts(TODAY_SHIFT);
        mocks.checkin.mockRejectedValueOnce(new Error('Sai mạng WiFi')).mockResolvedValue({ sessionId: 's1', isLate: false });
        renderPage();
        const btn = await screen.findByRole('button', { name: 'Vào ca' });
        await act(async () => {
          fireEvent.click(btn);
          fireEvent.click(btn);
        });
        expect(mocks.checkin).toHaveBeenCalledTimes(1);
        await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Sai mạng WiFi', type: 'error' }));
        await waitFor(() => expect(btn).not.toHaveAttribute('aria-busy'));
        fireEvent.click(btn);
        await waitFor(() => expect(mocks.checkin).toHaveBeenCalledTimes(2));
        await waitFor(() => expect(snackbarWith('Đã vào ca. Chúc làm việc vui!')).toBe(1));
      });

      it('hai ca trong ngày: chạm "Vào ca" của cả hai trong một khung hình chỉ gửi ca đầu (một người chỉ có một phiên mở)', async () => {
        const d = deferred();
        withTodayShifts(TODAY_SHIFT, shift('sh2', TODAY, 'APPROVED', { startAt: vn(TODAY, '13:00'), endAt: vn(TODAY, '17:00') }));
        mocks.checkin.mockReturnValueOnce(d.promise);
        renderPage();
        await screen.findAllByRole('button', { name: 'Vào ca' });
        const [first, second] = screen.getAllByRole('button', { name: 'Vào ca' });
        await act(async () => {
          fireEvent.click(first!);
          fireEvent.click(second!);
        });
        expect(mocks.checkin).toHaveBeenCalledTimes(1);
        expect(mocks.checkin.mock.calls[0]![0]).toMatchObject({ shiftId: 'sh1' });
        await act(async () => d.resolve({ sessionId: 's1', isLate: false }));
        await waitFor(() => expect(snackbarWith('Đã vào ca. Chúc làm việc vui!')).toBe(1));
      });

      it('chạm đúp "Ra ca" chỉ ra ca một lần; đang xử lý nút aria-busy', async () => {
        const d = deferred();
        withOpenSession();
        mocks.checkout.mockReturnValueOnce(d.promise);
        renderPage();
        const btn = await screen.findByRole('button', { name: 'Ra ca' });
        await act(async () => {
          fireEvent.click(btn);
          fireEvent.click(btn);
        });
        expect(mocks.checkout).toHaveBeenCalledTimes(1);
        expect(mocks.checkout).toHaveBeenCalledWith(undefined);
        await waitFor(() => expect(btn).toHaveAttribute('aria-busy', 'true'));
        await act(async () => d.resolve({ checkedOut: true }));
        await waitFor(() => expect(snackbarWith('Đã ra ca.')).toBe(1));
        expect(mocks.checkout).toHaveBeenCalledTimes(1);
      });

      it('Ra ca lỗi thì nhả khoá, bấm lại ra ca lần hai', async () => {
        withOpenSession();
        mocks.checkout.mockRejectedValueOnce(new Error('Mất kết nối')).mockResolvedValue({ checkedOut: true });
        renderPage();
        const btn = await screen.findByRole('button', { name: 'Ra ca' });
        await act(async () => {
          fireEvent.click(btn);
          fireEvent.click(btn);
        });
        expect(mocks.checkout).toHaveBeenCalledTimes(1);
        await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Mất kết nối', type: 'error' }));
        await waitFor(() => expect(btn).not.toHaveAttribute('aria-busy'));
        fireEvent.click(btn);
        await waitFor(() => expect(mocks.checkout).toHaveBeenCalledTimes(2));
        await waitFor(() => expect(snackbarWith('Đã ra ca.')).toBe(1));
      });

      it.each([
        ['Ra ca', 'Xác nhận ra ca', undefined],
        ['Xác nhận ra ca', 'Ra ca', vn(TODAY, '11:00')],
      ])('bấm "%s" rồi "%s" trong một khung hình: cùng một khoá, chỉ gửi lệnh đầu', async (first, second, at) => {
        const d = deferred();
        withOpenSession();
        mocks.checkout.mockReturnValueOnce(d.promise);
        renderPage();
        fireEvent.click(await screen.findByText('Quên ra ca? Chọn giờ đã về →'));
        fireEvent.change(timeInputs()[0]!, { target: { value: '11:00' } });
        const firstBtn = screen.getByRole('button', { name: first });
        const secondBtn = screen.getByRole('button', { name: second });
        await act(async () => {
          fireEvent.click(firstBtn);
          fireEvent.click(secondBtn);
        });
        expect(mocks.checkout).toHaveBeenCalledTimes(1);
        expect(mocks.checkout).toHaveBeenCalledWith(at);
        await act(async () => d.resolve({ checkedOut: true }));
        await waitFor(() => expect(snackbarWith('Đã ra ca.')).toBe(1));
        expect(mocks.checkout).toHaveBeenCalledTimes(1);
      });
    });

    describe('thêm / sửa ca (saveM)', () => {
      const openAddSheet = async () => {
        renderPage();
        fireEvent.click(await screen.findByRole('button', { name: 'Thêm ca T4 11/03' }));
        fireEvent.click(screen.getByRole('button', { name: 'Ca sáng (08:00–12:00)' }));
        return screen.getByRole('button', { name: 'Gửi duyệt' });
      };

      it('chạm đúp "Gửi duyệt" chỉ tạo một ca; đang gửi nút aria-busy, không disabled; xong thì đóng khung', async () => {
        const d = deferred();
        mocks.createShifts.mockReturnValueOnce(d.promise);
        const send = await openAddSheet();
        await act(async () => {
          fireEvent.click(send);
          fireEvent.click(send);
        });
        expect(mocks.createShifts).toHaveBeenCalledTimes(1);
        await waitFor(() => expect(send).toHaveAttribute('aria-busy', 'true'));
        expect(send).not.toBeDisabled();
        await act(async () => d.resolve({ created: 1 }));
        await waitFor(() => expect(snackbarWith('Đã gửi ca chờ duyệt.')).toBe(1));
        await waitFor(() => expect(screen.queryByText('Chọn ca chuẩn')).not.toBeInTheDocument());
        expect(mocks.createShifts).toHaveBeenCalledTimes(1);
      });

      it('thêm ca lỗi thì nhả khoá, bấm lại gửi lần hai', async () => {
        mocks.createShifts.mockRejectedValueOnce(new Error('Trùng ca')).mockResolvedValue({ created: 1 });
        const send = await openAddSheet();
        await act(async () => {
          fireEvent.click(send);
          fireEvent.click(send);
        });
        expect(mocks.createShifts).toHaveBeenCalledTimes(1);
        await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Trùng ca', type: 'error' }));
        await waitFor(() => expect(send).not.toHaveAttribute('aria-busy'));
        fireEvent.click(send);
        await waitFor(() => expect(mocks.createShifts).toHaveBeenCalledTimes(2));
        await waitFor(() => expect(snackbarWith('Đã gửi ca chờ duyệt.')).toBe(1));
      });

      it('chạm đúp "Lưu" khi sửa ca chỉ cập nhật một lần', async () => {
        const d = deferred();
        mocks.updateShift.mockReturnValueOnce(d.promise);
        renderPage();
        fireEvent.click(await screen.findByRole('button', { name: /^Sửa ca / }));
        const save = screen.getByRole('button', { name: 'Lưu' });
        await act(async () => {
          fireEvent.click(save);
          fireEvent.click(save);
        });
        expect(mocks.updateShift).toHaveBeenCalledTimes(1);
        expect(mocks.updateShift).toHaveBeenCalledWith('sp', { startAt: vn('2026-03-12', '08:00'), endAt: vn('2026-03-12', '12:00') });
        await waitFor(() => expect(save).toHaveAttribute('aria-busy', 'true'));
        await act(async () => d.resolve({}));
        await waitFor(() => expect(snackbarWith('Đã cập nhật ca.')).toBe(1));
        expect(mocks.updateShift).toHaveBeenCalledTimes(1);
      });

      it('sửa ca lỗi thì nhả khoá, bấm lại lưu lần hai', async () => {
        mocks.updateShift.mockRejectedValueOnce(new Error('Ca đã được duyệt')).mockResolvedValue({});
        renderPage();
        fireEvent.click(await screen.findByRole('button', { name: /^Sửa ca / }));
        const save = screen.getByRole('button', { name: 'Lưu' });
        await act(async () => {
          fireEvent.click(save);
          fireEvent.click(save);
        });
        expect(mocks.updateShift).toHaveBeenCalledTimes(1);
        await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Ca đã được duyệt', type: 'error' }));
        await waitFor(() => expect(save).not.toHaveAttribute('aria-busy'));
        fireEvent.click(save);
        await waitFor(() => expect(mocks.updateShift).toHaveBeenCalledTimes(2));
      });
    });

    describe('xoá ca (delM, khoá theo id ca)', () => {
      it('chạm đúp "Xoá ca" chỉ xoá một lần; đang xoá nút aria-busy, không disabled; tải lại lịch một lần', async () => {
        const d = deferred();
        mocks.deleteShift.mockReturnValueOnce(d.promise);
        renderPage();
        const del = await screen.findByRole('button', { name: /^Xoá ca / });
        await act(async () => {
          fireEvent.click(del);
          fireEvent.click(del);
        });
        expect(mocks.deleteShift).toHaveBeenCalledTimes(1);
        expect(mocks.deleteShift).toHaveBeenCalledWith('sp');
        await waitFor(() => expect(del).toHaveAttribute('aria-busy', 'true'));
        expect(del).not.toBeDisabled();
        await act(async () => d.resolve({ deleted: true }));
        await waitFor(() => expect(snackbarWith('Đã xoá ca.')).toBe(1));
        await waitFor(() => expect(mocks.getShifts).toHaveBeenCalledTimes(2));
        expect(mocks.deleteShift).toHaveBeenCalledTimes(1);
      });

      it('xoá lỗi thì nhả khoá, bấm lại gọi lần hai', async () => {
        mocks.deleteShift.mockRejectedValueOnce(new Error('Ca đã được duyệt')).mockResolvedValue({ deleted: true });
        renderPage();
        const del = await screen.findByRole('button', { name: /^Xoá ca / });
        await act(async () => {
          fireEvent.click(del);
          fireEvent.click(del);
        });
        expect(mocks.deleteShift).toHaveBeenCalledTimes(1);
        await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Ca đã được duyệt', type: 'error' }));
        await waitFor(() => expect(del).not.toHaveAttribute('aria-busy'));
        fireEvent.click(del);
        await waitFor(() => expect(mocks.deleteShift).toHaveBeenCalledTimes(2));
        await waitFor(() => expect(snackbarWith('Đã xoá ca.')).toBe(1));
      });

      it('hai ca khác nhau trong một khung hình: cả hai cùng được xoá, chạm lặp vào ca đầu bị bỏ qua', async () => {
        const a = deferred();
        const b = deferred();
        mocks.getShifts.mockResolvedValue(TWO_PENDING);
        mocks.deleteShift.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
        renderPage();
        const delA = await screen.findByRole('button', { name: 'Xoá ca T5 12/03' });
        const delB = screen.getByRole('button', { name: 'Xoá ca T6 13/03' });
        await act(async () => {
          fireEvent.click(delA);
          fireEvent.click(delB);
          fireEvent.click(delA);
        });
        expect(mocks.deleteShift.mock.calls.map((c) => c[0])).toEqual(['sp', 'sp2']);
        await act(async () => {
          a.resolve({ deleted: true });
          b.resolve({ deleted: true });
        });
        await waitFor(() => expect(snackbarWith('Đã xoá ca.')).toBe(2));
      });
    });

    describe('sửa và xoá cùng một ca (khoá chung theo id ca)', () => {
      const openEdit = async (name: string | RegExp) => {
        fireEvent.click(await screen.findByRole('button', { name }));
        return screen.getByRole('button', { name: 'Lưu' });
      };

      it.each([
        ['Lưu', 'Xoá ca', 'updateShift'],
        ['Xoá ca', 'Lưu', 'deleteShift'],
      ])('bấm "%s" rồi "%s" của cùng một ca trong một khung hình: chỉ gửi lệnh đầu (%s)', async (first, _second, only) => {
        const d = deferred();
        mocks.updateShift.mockReturnValue(d.promise);
        mocks.deleteShift.mockReturnValue(d.promise);
        renderPage();
        const save = await openEdit('Sửa ca T5 12/03');
        const del = screen.getByRole('button', { name: 'Xoá ca T5 12/03' });
        const [firstBtn, secondBtn] = first === 'Lưu' ? [save, del] : [del, save];
        await act(async () => {
          fireEvent.click(firstBtn);
          fireEvent.click(secondBtn);
        });
        expect(mocks.updateShift).toHaveBeenCalledTimes(only === 'updateShift' ? 1 : 0);
        expect(mocks.deleteShift).toHaveBeenCalledTimes(only === 'deleteShift' ? 1 : 0);
        await waitFor(() => expect(save).toHaveAttribute('aria-busy', 'true'));
        expect(del).toHaveAttribute('aria-busy', 'true');
        await act(async () => d.resolve({}));
        await waitFor(() => expect(del).not.toHaveAttribute('aria-busy'));
        expect(mocks.updateShift.mock.calls.length + mocks.deleteShift.mock.calls.length).toBe(1);
      });

      it('sửa ca A rồi xoá ca B trong một khung hình: hai ca khác nhau nên cả hai cùng đi', async () => {
        const a = deferred();
        const b = deferred();
        mocks.getShifts.mockResolvedValue(TWO_PENDING);
        mocks.updateShift.mockReturnValueOnce(a.promise);
        mocks.deleteShift.mockReturnValueOnce(b.promise);
        renderPage();
        const save = await openEdit('Sửa ca T5 12/03');
        const delB = screen.getByRole('button', { name: 'Xoá ca T6 13/03' });
        await act(async () => {
          fireEvent.click(save);
          fireEvent.click(delB);
        });
        expect(mocks.updateShift).toHaveBeenCalledTimes(1);
        expect(mocks.updateShift.mock.calls[0]![0]).toBe('sp');
        expect(mocks.deleteShift).toHaveBeenCalledTimes(1);
        expect(mocks.deleteShift).toHaveBeenCalledWith('sp2');
        await act(async () => {
          a.resolve({});
          b.resolve({ deleted: true });
        });
        await waitFor(() => expect(snackbarWith('Đã xoá ca.')).toBe(1));
      });

      it('xoá lỗi thì nhả khoá chung, sửa ca đó được ngay', async () => {
        mocks.deleteShift.mockRejectedValueOnce(new Error('Ca đã được duyệt'));
        renderPage();
        const save = await openEdit('Sửa ca T5 12/03');
        const del = screen.getByRole('button', { name: 'Xoá ca T5 12/03' });
        await act(async () => {
          fireEvent.click(del);
        });
        await waitFor(() => expect(errorSnackbars()).toBe(1));
        await waitFor(() => expect(del).not.toHaveAttribute('aria-busy'));
        fireEvent.click(save);
        await waitFor(() => expect(mocks.updateShift).toHaveBeenCalledTimes(1));
      });
    });

    describe('đăng ký nhanh (quickM)', () => {
      const openQuick = async () => {
        renderPage();
        fireEvent.click(await screen.findByRole('button', { name: 'Đăng ký ca' }));
        return screen.getByRole('button', { name: 'Gửi duyệt (3 ngày)' });
      };

      it('chạm đúp "Gửi duyệt" chỉ đăng ký một lần; đang gửi nút aria-busy, không disabled', async () => {
        const d = deferred();
        mocks.createShifts.mockReturnValueOnce(d.promise);
        const send = await openQuick();
        await act(async () => {
          fireEvent.click(send);
          fireEvent.click(send);
        });
        expect(mocks.createShifts).toHaveBeenCalledTimes(1);
        expect(mocks.createShifts.mock.calls[0]![0]).toHaveLength(3);
        await waitFor(() => expect(send).toHaveAttribute('aria-busy', 'true'));
        expect(send).not.toBeDisabled();
        await act(async () => d.resolve({ created: 3 }));
        await waitFor(() => expect(snackbarWith('Đã đăng ký 3 ca chờ duyệt.')).toBe(1));
        expect(mocks.createShifts).toHaveBeenCalledTimes(1);
      });

      it('lỗi thì nhả khoá, bấm lại đăng ký lần hai', async () => {
        mocks.createShifts.mockRejectedValueOnce(new Error('Trùng ca')).mockResolvedValue({ created: 3 });
        const send = await openQuick();
        await act(async () => {
          fireEvent.click(send);
          fireEvent.click(send);
        });
        expect(mocks.createShifts).toHaveBeenCalledTimes(1);
        await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Trùng ca', type: 'error' }));
        await waitFor(() => expect(send).not.toHaveAttribute('aria-busy'));
        fireEvent.click(send);
        await waitFor(() => expect(mocks.createShifts).toHaveBeenCalledTimes(2));
        await waitFor(() => expect(snackbarWith('Đã đăng ký 3 ca chờ duyệt.')).toBe(1));
      });
    });

    describe('chép tuần trước (copyM)', () => {
      it('chạm đúp "Chép tuần" chỉ chép một lần; đang chép nút aria-busy', async () => {
        const d = deferred();
        mocks.copyWeek.mockReturnValueOnce(d.promise);
        renderPage();
        const btn = await screen.findByRole('button', { name: 'Chép tuần trước' });
        await act(async () => {
          fireEvent.click(btn);
          fireEvent.click(btn);
        });
        expect(mocks.copyWeek).toHaveBeenCalledTimes(1);
        await waitFor(() => expect(btn).toHaveAttribute('aria-busy', 'true'));
        await act(async () => d.resolve({ created: 2, skipped: 0 }));
        await waitFor(() => expect(snackbarWith('Đã chép 2 ca từ tuần trước.')).toBe(1));
        expect(mocks.copyWeek).toHaveBeenCalledTimes(1);
      });

      it('lỗi thì nhả khoá, bấm lại chép lần hai', async () => {
        mocks.copyWeek.mockRejectedValueOnce(new Error('Mất kết nối')).mockResolvedValue({ created: 2, skipped: 0 });
        renderPage();
        const btn = await screen.findByRole('button', { name: 'Chép tuần trước' });
        await act(async () => {
          fireEvent.click(btn);
          fireEvent.click(btn);
        });
        expect(mocks.copyWeek).toHaveBeenCalledTimes(1);
        await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Mất kết nối', type: 'error' }));
        await waitFor(() => expect(btn).not.toHaveAttribute('aria-busy'));
        fireEvent.click(btn);
        await waitFor(() => expect(mocks.copyWeek).toHaveBeenCalledTimes(2));
        await waitFor(() => expect(snackbarWith('Đã chép 2 ca từ tuần trước.')).toBe(1));
      });
    });

    // Làm mới trạng thái sau "Vào ca" lỗi khi đã có dữ liệu cũ: refetch mặc định HUỶ lượt đang chạy rồi gọi lại,
    // nên hai cú chạm "Thử lại" mà nút không tự khoá sẽ gửi hai yêu cầu.
    describe('"Thử lại" trạng thái chấm công sau khi làm mới lỗi (W80A)', () => {
      it('hai cú chạm cùng nhịp vào "Thử lại" chỉ tải lại một lần', async () => {
        const d = deferred();
        mocks.getAttendanceStatus
          .mockResolvedValueOnce({ shifts: [TODAY_SHIFT], openSession: null })
          .mockRejectedValueOnce(new Error('Mất kết nối'))
          .mockReturnValueOnce(d.promise);
        renderPage();
        fireEvent.click(await screen.findByRole('button', { name: 'Vào ca' }));
        await screen.findByText('Không tải được trạng thái chấm công.');
        const retry = screen.getAllByRole('button', { name: 'Thử lại' })[0]!;
        await act(async () => {
          fireEvent.click(retry);
          fireEvent.click(retry);
        });
        expect(mocks.getAttendanceStatus).toHaveBeenCalledTimes(3);
        await act(async () => d.resolve({ shifts: [], openSession: null }));
        expect(await screen.findByText('Hôm nay bạn không có ca đã duyệt.')).toBeInTheDocument();
        expect(mocks.getAttendanceStatus).toHaveBeenCalledTimes(3);
      });
    });

    describe('huỷ ca đã duyệt (cancelM)', () => {
      const openCancel = async () => {
        renderPage();
        fireEvent.click(await screen.findByRole('button', { name: /^Huỷ ca / }));
        fireEvent.change(screen.getByPlaceholderText('Lý do huỷ'), { target: { value: 'Bận việc nhà' } });
        return screen.getByRole('button', { name: 'Xác nhận huỷ' });
      };

      it('chạm đúp "Xác nhận huỷ" chỉ huỷ một lần; đang huỷ nút aria-busy, không disabled; xong thì đóng khung', async () => {
        const d = deferred();
        mocks.cancelShift.mockReturnValueOnce(d.promise);
        const confirm = await openCancel();
        await act(async () => {
          fireEvent.click(confirm);
          fireEvent.click(confirm);
        });
        expect(mocks.cancelShift).toHaveBeenCalledTimes(1);
        expect(mocks.cancelShift).toHaveBeenCalledWith('sa', { reason: 'Bận việc nhà', isEmergency: false, evidenceUrl: undefined });
        await waitFor(() => expect(confirm).toHaveAttribute('aria-busy', 'true'));
        expect(confirm).not.toBeDisabled();
        await act(async () => d.resolve({ cancelled: true, penalty: false }));
        await waitFor(() => expect(snackbarWith('Đã huỷ ca (không phạt).')).toBe(1));
        await waitFor(() => expect(screen.queryByText('Huỷ ca đã duyệt')).not.toBeInTheDocument());
        expect(mocks.cancelShift).toHaveBeenCalledTimes(1);
      });

      it('lỗi thì nhả khoá, bấm lại huỷ lần hai', async () => {
        mocks.cancelShift.mockRejectedValueOnce(new Error('Quá hạn huỷ')).mockResolvedValue({ cancelled: true, penalty: false });
        const confirm = await openCancel();
        await act(async () => {
          fireEvent.click(confirm);
          fireEvent.click(confirm);
        });
        expect(mocks.cancelShift).toHaveBeenCalledTimes(1);
        await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Quá hạn huỷ', type: 'error' }));
        await waitFor(() => expect(confirm).not.toHaveAttribute('aria-busy'));
        fireEvent.click(confirm);
        await waitFor(() => expect(mocks.cancelShift).toHaveBeenCalledTimes(2));
        await waitFor(() => expect(snackbarWith('Đã huỷ ca (không phạt).')).toBe(1));
      });
    });
  });
  describe('ảnh chứng cứ huỷ ca còn đang lên (W90A)', () => {
    const openEmergencyCancel = async () => {
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: /^Huỷ ca / }));
      fireEvent.change(screen.getByPlaceholderText('Lý do huỷ'), { target: { value: 'Ốm' } });
      fireEvent.click(screen.getByText('Đột xuất (có chứng cứ)'));
      fireEvent.click(await screen.findByRole('button', { name: 'Ảnh chứng cứ' }));
    };

    it('đổi ảnh khác: lúc ảnh mới còn lên, nút khoá + đổi nhãn, bấm không huỷ ca; xong thì gửi ảnh MỚI', async () => {
      await openEmergencyCancel();
      expect(screen.getByRole('button', { name: 'Xác nhận huỷ' })).toBeEnabled();

      act(() => mocks.picker.onBusyChange(true));
      const waiting = screen.getByRole('button', { name: t.common.imagesUploading });
      expect(waiting).toBeDisabled();
      fireEvent.click(waiting);
      await new Promise((r) => setTimeout(r, 30));
      expect(mocks.cancelShift).not.toHaveBeenCalled();

      act(() => {
        mocks.picker.onChange('https://img.test/moi.png');
        mocks.picker.onBusyChange(false);
      });
      const confirm = await screen.findByRole('button', { name: 'Xác nhận huỷ' });
      expect(confirm).toBeEnabled();
      fireEvent.click(confirm);
      await waitFor(() => expect(mocks.cancelShift).toHaveBeenCalledTimes(1));
      expect(mocks.cancelShift).toHaveBeenCalledWith('sa', { reason: 'Ốm', isEmergency: true, evidenceUrl: 'https://img.test/moi.png' });
    });

    it('tắt "Đột xuất" giữa lúc ảnh còn lên: ô ảnh biến mất nên nút không bị giữ vì ảnh không ai chờ; bật lại thì chờ tiếp tới khi lượt đó xong', async () => {
      await openEmergencyCancel();
      act(() => mocks.picker.onBusyChange(true));
      expect(screen.getByRole('button', { name: t.common.imagesUploading })).toBeDisabled();

      fireEvent.click(screen.getByText('Đột xuất (có chứng cứ)'));
      expect(screen.queryByRole('button', { name: 'Ảnh chứng cứ' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Xác nhận huỷ' })).toBeEnabled();

      fireEvent.click(screen.getByText('Đột xuất (có chứng cứ)'));
      expect(screen.getByRole('button', { name: t.common.imagesUploading })).toBeDisabled();
      act(() => mocks.picker.onBusyChange(false));
      expect(await screen.findByRole('button', { name: 'Xác nhận huỷ' })).toBeEnabled();
    });

    it('ảnh còn đang lên: tấm huỷ ca không đóng được (mất nút Đóng, Esc không đóng); xong thì đóng được', async () => {
      await openEmergencyCancel();
      expect(screen.getByRole('button', { name: 'Đóng' })).toBeInTheDocument();

      act(() => mocks.picker.onBusyChange(true));
      expect(screen.queryByRole('button', { name: 'Đóng' })).toBeNull();
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.getByRole('heading', { level: 2, name: 'Huỷ ca đã duyệt' })).toBeInTheDocument();

      // Xong lượt tải thì Esc đóng được: chứng tỏ Esc ở trên bị chặn vì khoá chứ không phải vì test không bắt được phím.
      act(() => mocks.picker.onBusyChange(false));
      expect(await screen.findByRole('button', { name: 'Đóng' })).toBeInTheDocument();
      fireEvent.keyDown(document, { key: 'Escape' });
      await waitFor(() => expect(screen.queryByText('Huỷ ca đã duyệt')).not.toBeInTheDocument());
    });

    it('mở huỷ ca khác sau khi đóng tấm ca trước: không mang ảnh chứng cứ của ca trước (Xác nhận huỷ chờ ảnh mới)', async () => {
      mocks.getShifts.mockResolvedValue([
        ...WEEK_SHIFTS,
        shift('sb', '2026-03-15', 'APPROVED', { approvedStart: vn('2026-03-15', '09:00'), approvedEnd: vn('2026-03-15', '13:00') }),
      ]);
      renderPage();
      const cancelButtons = await screen.findAllByRole('button', { name: /^Huỷ ca / });
      expect(cancelButtons).toHaveLength(2);
      fireEvent.click(cancelButtons[0]!);
      fireEvent.change(screen.getByPlaceholderText('Lý do huỷ'), { target: { value: 'Ốm' } });
      fireEvent.click(screen.getByText('Đột xuất (có chứng cứ)'));
      fireEvent.click(await screen.findByRole('button', { name: 'Ảnh chứng cứ' }));
      expect(screen.getByRole('button', { name: 'Xác nhận huỷ' })).toBeEnabled();

      fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
      await waitFor(() => expect(screen.queryByText('Huỷ ca đã duyệt')).not.toBeInTheDocument());
      fireEvent.click(screen.getAllByRole('button', { name: /^Huỷ ca / })[1]!);

      expect(await screen.findByRole('heading', { level: 2, name: 'Huỷ ca đã duyệt' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Xác nhận huỷ' })).toBeDisabled();
      fireEvent.click(screen.getByRole('button', { name: 'Ảnh chứng cứ' }));
      const confirm = screen.getByRole('button', { name: 'Xác nhận huỷ' });
      expect(confirm).toBeEnabled();
      fireEvent.click(confirm);
      await waitFor(() => expect(mocks.cancelShift).toHaveBeenCalledTimes(1));
      expect(mocks.cancelShift).toHaveBeenCalledWith('sb', { reason: 'Ốm', isEmergency: true, evidenceUrl: 'https://img.test/e.png' });
    });

    it('đang huỷ ca thì ô ảnh khoá', async () => {
      let release!: (v: unknown) => void;
      mocks.cancelShift.mockReturnValueOnce(new Promise((r) => (release = r)));
      await openEmergencyCancel();
      expect(screen.getByRole('button', { name: 'Ảnh chứng cứ' })).toBeEnabled();
      fireEvent.click(screen.getByRole('button', { name: 'Xác nhận huỷ' }));
      await waitFor(() => expect(mocks.cancelShift).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(screen.getByRole('button', { name: 'Ảnh chứng cứ' })).toBeDisabled());
      await act(async () => release({ cancelled: true, penalty: false }));
      await waitFor(() => expect(screen.queryByText('Huỷ ca đã duyệt')).not.toBeInTheDocument());
    });
  });

  // W112A: lệnh ghi bị máy chủ từ chối vì ca/phiên đã đổi (400/404/409) thì nút giữ khoá tới khi dữ liệu làm mới về (tối đa LOCK_REFRESH_WAIT_MS), kẻo bấm lại trên số cũ nhận đúng lỗi đó. Mất mạng, quá hạn, 401, 5xx không nói gì về trạng thái thật: không tải lại, nhả ngay.
  describe('máy chủ từ chối thì giữ khoá tới khi dữ liệu làm mới về (W112A)', () => {
    type Refresh = () => Promise<unknown>;
    type Opened = { invalidate: MockInstance<QueryClient['invalidateQueries']>; button: () => HTMLElement };
    type Case = {
      name: string;
      /** Lệnh ghi bị giả lập. */
      write: ReturnType<typeof vi.fn>;
      /** Khoá tải lại kỳ vọng khi máy chủ từ chối, đúng thứ tự gọi. */
      keys: string[][];
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
          <StaffPage />
        </QueryClientProvider>,
      );
      return invalidate;
    };
    const named = (name: string | RegExp) => () => screen.getByRole('button', { name });
    // Tuần 09/03–15/03 (NOW = 11/03): khoá lịch tuần là ['my-shifts', thứ Hai].
    const WEEK_KEY = [['my-shifts', '2026-03-09']];
    const ATTN_KEY = [['attn-status']];

    const CASES: Case[] = [
      {
        name: 'Vào ca (checkinM)',
        write: mocks.checkin,
        keys: ATTN_KEY,
        succeed: { sessionId: 's1', isLate: false },
        open: async (refresh) => {
          mocks.getAttendanceStatus.mockResolvedValue({ shifts: [TODAY_SHIFT], openSession: null });
          const invalidate = renderLive(refresh);
          await screen.findByRole('button', { name: 'Vào ca' });
          return { invalidate, button: named('Vào ca') };
        },
      },
      {
        name: 'Ra ca (checkoutM)',
        write: mocks.checkout,
        keys: ATTN_KEY,
        succeed: { checkedOut: true },
        open: async (refresh) => {
          mocks.getAttendanceStatus.mockResolvedValue({ shifts: [], openSession: OPEN_SESSION });
          const invalidate = renderLive(refresh);
          await screen.findByRole('button', { name: 'Ra ca' });
          return { invalidate, button: named('Ra ca') };
        },
      },
      {
        name: 'Ra ca lùi giờ (checkoutM, tấm Xác nhận ra ca)',
        write: mocks.checkout,
        keys: ATTN_KEY,
        succeed: { checkedOut: true },
        open: async (refresh) => {
          mocks.getAttendanceStatus.mockResolvedValue({ shifts: [], openSession: OPEN_SESSION });
          const invalidate = renderLive(refresh);
          fireEvent.click(await screen.findByText('Quên ra ca? Chọn giờ đã về →'));
          fireEvent.change(timeInputs()[0]!, { target: { value: '11:00' } });
          return { invalidate, button: named('Xác nhận ra ca') };
        },
      },
      {
        name: 'Gửi duyệt ca mới (saveM tạo)',
        write: mocks.createShifts,
        keys: WEEK_KEY,
        succeed: { created: 1 },
        open: async (refresh) => {
          const invalidate = renderLive(refresh);
          fireEvent.click(await screen.findByRole('button', { name: 'Thêm ca T4 11/03' }));
          fireEvent.click(screen.getByRole('button', { name: 'Ca sáng (08:00–12:00)' }));
          return { invalidate, button: named('Gửi duyệt') };
        },
      },
      {
        name: 'Lưu ca đã gửi (saveM sửa)',
        write: mocks.updateShift,
        keys: WEEK_KEY,
        succeed: {},
        open: async (refresh) => {
          const invalidate = renderLive(refresh);
          fireEvent.click(await screen.findByRole('button', { name: /^Sửa ca / }));
          return { invalidate, button: named('Lưu') };
        },
      },
      {
        name: 'Xoá ca (delM)',
        write: mocks.deleteShift,
        keys: WEEK_KEY,
        succeed: { deleted: true },
        open: async (refresh) => {
          const invalidate = renderLive(refresh);
          await screen.findByRole('button', { name: /^Xoá ca / });
          return { invalidate, button: named(/^Xoá ca /) };
        },
      },
      {
        name: 'Đăng ký ca nhanh (quickM)',
        write: mocks.createShifts,
        keys: WEEK_KEY,
        succeed: { created: 3 },
        open: async (refresh) => {
          const invalidate = renderLive(refresh);
          fireEvent.click(await screen.findByRole('button', { name: 'Đăng ký ca' }));
          return { invalidate, button: named('Gửi duyệt (3 ngày)') };
        },
      },
      {
        name: 'Chép tuần trước (copyM)',
        write: mocks.copyWeek,
        keys: WEEK_KEY,
        succeed: { created: 2, skipped: 0 },
        open: async (refresh) => {
          const invalidate = renderLive(refresh);
          await screen.findByRole('button', { name: 'Chép tuần trước' });
          return { invalidate, button: named('Chép tuần trước') };
        },
      },
      {
        name: 'Xác nhận huỷ ca (cancelM)',
        write: mocks.cancelShift,
        keys: WEEK_KEY,
        succeed: { cancelled: true, penalty: false },
        open: async (refresh) => {
          const invalidate = renderLive(refresh);
          fireEvent.click(await screen.findByRole('button', { name: /^Huỷ ca / }));
          fireEvent.change(screen.getByPlaceholderText('Lý do huỷ'), { target: { value: 'Bận việc nhà' } });
          return { invalidate, button: named('Xác nhận huỷ') };
        },
      },
    ];

    describe.each(CASES)('$name', (c) => {
      it.each([
        [400, 'Ca vừa được duyệt, tải lại.'],
        [404, 'Không tìm thấy ca nữa'],
        [409, 'Vừa có thay đổi, bạn thử lại nhé'],
      ])('bị từ chối %i: báo lỗi một lần, tải lại đúng khoá, nút giữ khoá tới khi dữ liệu về rồi mới nhả', async (status, message) => {
        c.write.mockRejectedValueOnce(serverError(message, status)).mockResolvedValue(c.succeed);
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
      });

      it.each([
        ['mất mạng', new HttpError('Network Error', 'ERR_NETWORK')],
        ['hết thời gian', new HttpError('timeout', 'ECONNABORTED')],
        ['máy chủ lỗi 503', serverError('Service Unavailable', 503)],
        ['hết phiên 401', serverError('Unauthorized', 401)],
      ])('%s: không giữ khoá chờ tải lại, khoá nhả ngay, không tải lại khoá nào', async (_label, error) => {
        c.write.mockRejectedValueOnce(error).mockResolvedValue(c.succeed);
        const { invalidate, button } = await c.open(() => new Promise(() => undefined));
        fireEvent.click(button());
        await waitFor(() => expect(errorSnackbars()).toBe(1));
        await waitFor(() => expect(button()).not.toHaveAttribute('aria-busy'));
        expect(invalidate).not.toHaveBeenCalled();
        fireEvent.click(button());
        await waitFor(() => expect(c.write).toHaveBeenCalledTimes(2));
      });

      it('tải lại treo mãi: khoá nhả đúng sau LOCK_REFRESH_WAIT_MS', async () => {
        c.write.mockRejectedValueOnce(serverError('Vừa có thay đổi, bạn thử lại nhé', 409)).mockResolvedValue(c.succeed);
        const { button } = await c.open(() => new Promise(() => undefined));
        // Bộ hẹn giờ giả chỉ bật từ lúc này: Date đã giả từ beforeEach nên dựng lại cả hai, giữ đúng mốc NOW của tuần đang hiện.
        vi.useRealTimers();
        vi.useFakeTimers({ shouldAdvanceTime: true });
        vi.setSystemTime(new Date(NOW));
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

    // Sửa và Xoá cùng một ca chung khoá theo id ca: lúc Xoá còn giữ khoá chờ lịch mới, Lưu của đúng ca đó cũng phải chờ.
    describe('khoá chung theo id ca khi đang chờ dữ liệu mới', () => {
      it('xoá bị từ chối 409: Lưu cùng ca bị bỏ qua tới khi lịch tuần về, sau đó sửa được', async () => {
        mocks.deleteShift.mockRejectedValueOnce(serverError('Ca vừa được duyệt, tải lại.', 409));
        const refresh = deferred();
        renderLive(() => refresh.promise);
        fireEvent.click(await screen.findByRole('button', { name: 'Sửa ca T5 12/03' }));
        const save = screen.getByRole('button', { name: 'Lưu' });
        const del = screen.getByRole('button', { name: 'Xoá ca T5 12/03' });
        await act(async () => {
          fireEvent.click(del);
        });
        await waitFor(() => expect(errorSnackbars()).toBe(1));
        await act(async () => {
          fireEvent.click(save);
        });
        expect(mocks.updateShift).not.toHaveBeenCalled();
        await act(async () => refresh.resolve());
        await settle();
        await waitFor(() => expect(del).not.toHaveAttribute('aria-busy'));
        fireEvent.click(save);
        await waitFor(() => expect(mocks.updateShift).toHaveBeenCalledTimes(1));
        expect(mocks.deleteShift).toHaveBeenCalledTimes(1);
      });
    });
  });
});
