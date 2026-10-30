import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CheckInStatusResponse } from '@tubutree/app-core/api/loyalty';

const mocks = vi.hoisted(() => ({
  status: null as CheckInStatusResponse | null,
  ensurePhone: vi.fn(),
  checkIn: vi.fn(),
}));
vi.mock('../../hooks/use-check-in', () => ({
  useCheckIn: () => ({
    status: mocks.status,
    statusQ: { isLoading: false, isError: false, refetch: vi.fn() },
    view: mocks.status ? { canCheckIn: !mocks.status.checkedInToday, buttonLabel: mocks.status.checkedInToday ? 'Đã điểm danh' : 'Điểm danh' } : null,
    pending: false,
    checkIn: mocks.checkIn,
  }),
}));
vi.mock('../../store/auth', () => ({
  useAuthStore: (sel: (s: unknown) => unknown) => sel({ ensurePhoneOrThrow: mocks.ensurePhone }),
}));

import { DailyCheckInCard } from './daily-check-in-card';

const REWARDS = Array.from({ length: 7 }, (_, i) => ({ day: i + 1, points: 1000, claimed: false, isToday: i === 0 }));
const base: CheckInStatusResponse = {
  checkedInToday: false,
  streakDays: 0,
  currentCycleDay: 1,
  todayPoints: 1000,
  todayWater: 10,
  pointsDone: false,
  waterDone: false,
  rewards: REWARDS,
};

describe('DailyCheckInCard: khách vãng lai không được hứa Điểm Xanh', () => {
  beforeEach(() => {
    mocks.ensurePhone.mockReset();
    mocks.status = null;
  });

  it('user thật: hứa "+1.000 Điểm Xanh · +10 giọt nước", không có câu mời đăng nhập', () => {
    mocks.status = base;
    render(<DailyCheckInCard authed />);
    expect(screen.getByText('Hôm nay nhận +1.000 Điểm Xanh · +10 giọt nước')).toBeInTheDocument();
    expect(screen.queryByTestId('guest-points-note')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Ngày 1: +1.000 Điểm Xanh')).toBeInTheDocument();
  });

  it('khách vãng lai: giọt nước vẫn hiện, không chữ "+N Điểm Xanh", có câu và nút đăng nhập Zalo', async () => {
    mocks.status = { ...base, todayPoints: 0, pointsBlocked: 'GUEST' };
    render(<DailyCheckInCard authed />);
    expect(screen.getByText('Hôm nay nhận +10 giọt nước')).toBeInTheDocument();
    const note = await screen.findByTestId('guest-points-note');
    expect(note).toHaveTextContent('Đăng nhập Zalo để nhận Điểm Xanh');
    expect(screen.queryByText(/\+[\d.]+ Điểm Xanh/)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Ngày 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Điểm danh' })).toBeEnabled();
  });

  it('nút Đăng nhập Zalo gọi luồng liên kết sẵn có (ensurePhoneOrThrow)', async () => {
    mocks.ensurePhone.mockResolvedValue('0901234567');
    mocks.status = { ...base, todayPoints: 0, pointsBlocked: 'GUEST' };
    render(<DailyCheckInCard authed />);
    fireEvent.click(await screen.findByRole('button', { name: 'Đăng nhập Zalo' }));
    await waitFor(() => expect(mocks.ensurePhone).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Đăng nhập Zalo' })).toBeEnabled());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('khách từ chối chia sẻ số điện thoại: báo thử lại, nút bấm lại được', async () => {
    mocks.ensurePhone.mockResolvedValue(null);
    mocks.status = { ...base, todayPoints: 0, pointsBlocked: 'GUEST' };
    render(<DailyCheckInCard authed />);
    fireEvent.click(await screen.findByRole('button', { name: 'Đăng nhập Zalo' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Chưa đăng nhập được Zalo. Bạn thử lại nhé.');
  });

  it('khách đã điểm danh hôm nay: vẫn có câu mời, thể lệ không nhắc Điểm Xanh', async () => {
    mocks.status = { ...base, checkedInToday: true, todayPoints: 0, pointsBlocked: 'GUEST' };
    render(<DailyCheckInCard authed />);
    expect(await screen.findByTestId('guest-points-note')).toBeInTheDocument();
    const rule = screen.getByTestId('daily-check-in').textContent ?? '';
    expect(rule).toContain('nhận giọt nước');
    expect(rule).not.toContain('Một lần bấm nhận cả Điểm Xanh');
  });
});
