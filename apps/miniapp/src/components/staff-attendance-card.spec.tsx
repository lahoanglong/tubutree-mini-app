import { fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const openSnackbar = vi.hoisted(() => vi.fn());
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useSnackbar: () => ({ openSnackbar }),
}));

const api = vi.hoisted(() => ({
  getAttendanceStatus: vi.fn(),
  acquireLocationPayload: vi.fn(),
  checkin: vi.fn(),
  checkout: vi.fn(),
  heartbeat: vi.fn(),
}));
vi.mock('../services/attendance-api', () => api);

import { StaffAttendanceCard } from './staff-attendance-card';

const SHIFT = { id: 'shift-1', startAt: '2026-11-16T01:00:00.000Z', endAt: '2026-11-16T05:00:00.000Z', approvedStart: null, approvedEnd: null };
const OPEN = { id: 'sess-1', shiftId: 'shift-1', staffId: 'u1', checkinAt: '2026-11-16T01:05:00.000Z', checkoutAt: null, isLate: false, lastHeartbeatAt: '2026-11-16T01:05:00.000Z' };

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <StaffAttendanceCard />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  openSnackbar.mockReset();
  for (const fn of Object.values(api)) fn.mockReset();
  api.acquireLocationPayload.mockResolvedValue({ locationToken: 'loc-token', zaloAccessToken: 'zalo-token' });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('StaffAttendanceCard — chấm công trong Mini App (web không chấm công được)', () => {
  it('hôm nay không có ca đã duyệt: nói rõ và không có nút Vào ca', async () => {
    api.getAttendanceStatus.mockResolvedValue({ shifts: [], openSession: null });
    renderCard();
    expect(await screen.findByText('Hôm nay bạn không có ca đã duyệt.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Vào ca' })).toBeNull();
  });

  it('Vào ca: lấy vị trí rồi gửi đúng shiftId kèm token vị trí, báo thành công và đọc lại trạng thái', async () => {
    api.getAttendanceStatus.mockResolvedValue({ shifts: [SHIFT], openSession: null });
    api.checkin.mockResolvedValue({ sessionId: 'sess-1', isLate: false });
    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: 'Vào ca' }));
    await waitFor(() => expect(api.checkin).toHaveBeenCalledWith({ shiftId: 'shift-1', locationToken: 'loc-token', zaloAccessToken: 'zalo-token' }));
    await waitFor(() => expect(openSnackbar).toHaveBeenCalledWith({ text: 'Đã vào ca. Chúc làm việc vui!', type: 'success' }));
    await waitFor(() => expect(api.getAttendanceStatus).toHaveBeenCalledTimes(2));
  });

  it('Vào ca trễ: báo đi trễ bằng giọng thông tin, không phải thành công', async () => {
    api.getAttendanceStatus.mockResolvedValue({ shifts: [SHIFT], openSession: null });
    api.checkin.mockResolvedValue({ sessionId: 'sess-1', isLate: true });
    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: 'Vào ca' }));
    await waitFor(() => expect(openSnackbar).toHaveBeenCalledWith({ text: 'Đã vào ca (đi trễ — có thể bị phạt).', type: 'info' }));
  });

  it('Vào ca lỗi vị trí: lời lý do vị trí đi kèm lời máy chủ, báo lỗi', async () => {
    api.getAttendanceStatus.mockResolvedValue({ shifts: [SHIFT], openSession: null });
    api.acquireLocationPayload.mockImplementation(async (onFailure?: (m: string) => void) => {
      onFailure?.('Không lấy được vị trí: bạn chưa cấp quyền vị trí cho Zalo.');
      return {};
    });
    api.checkin.mockRejectedValue(new Error('Bạn đang ở ngoài vùng công ty'));
    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: 'Vào ca' }));
    await waitFor(() => expect(openSnackbar).toHaveBeenCalledTimes(1));
    const shown = openSnackbar.mock.calls[0]?.[0] as { type: string; text: string };
    expect(shown.type).toBe('error');
    expect(shown.text).toContain('Không lấy được vị trí');
  });

  it('đang trong ca: hiện giờ vào ca, nút Ra ca gửi ra ca không kèm giờ lùi', async () => {
    api.getAttendanceStatus.mockResolvedValue({ shifts: [SHIFT], openSession: OPEN });
    api.checkout.mockResolvedValue({ checkedOut: true });
    renderCard();
    expect(await screen.findByText(/Đang trong ca · vào lúc/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Vào ca' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Ra ca' }));
    await waitFor(() => expect(api.checkout).toHaveBeenCalledWith(undefined));
    await waitFor(() => expect(openSnackbar).toHaveBeenCalledWith({ text: 'Đã ra ca.', type: 'success' }));
  });

  it('đang trong ca: còn lối "Quên ra ca? Chọn giờ đã về" để ra ca lùi giờ', async () => {
    api.getAttendanceStatus.mockResolvedValue({ shifts: [SHIFT], openSession: OPEN });
    renderCard();
    expect(await screen.findByRole('button', { name: /Quên ra ca\? Chọn giờ đã về/ })).toBeInTheDocument();
  });

  it('tải trạng thái lỗi: có câu báo và nút Thử lại đọc lại trạng thái', async () => {
    api.getAttendanceStatus.mockRejectedValueOnce(new Error('network')).mockResolvedValue({ shifts: [], openSession: null });
    renderCard();
    expect(await screen.findByText('Không tải được trạng thái chấm công.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByText('Hôm nay bạn không có ca đã duyệt.')).toBeInTheDocument();
  });

  it('đang trong ca: gửi heartbeat mỗi 3 phút kèm vị trí; máy chủ tự ra ca thì báo và đọc lại trạng thái', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.getAttendanceStatus.mockResolvedValue({ shifts: [SHIFT], openSession: OPEN });
    api.heartbeat.mockResolvedValue({ open: false, closed: true, reason: 'OUT_OF_ZONE' });
    renderCard();
    await screen.findByText(/Đang trong ca/);
    expect(api.heartbeat).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3 * 60 * 1000 + 50);
    });
    await waitFor(() => expect(api.heartbeat).toHaveBeenCalledWith({ locationToken: 'loc-token', zaloAccessToken: 'zalo-token' }));
    await waitFor(() => expect(openSnackbar).toHaveBeenCalledWith({ text: 'Đã tự ra ca (ra khỏi vùng công ty).', type: 'info' }));
  });

  it('không trong ca: không bao giờ gửi heartbeat', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.getAttendanceStatus.mockResolvedValue({ shifts: [SHIFT], openSession: null });
    renderCard();
    await screen.findByRole('button', { name: 'Vào ca' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    });
    expect(api.heartbeat).not.toHaveBeenCalled();
  });
});
