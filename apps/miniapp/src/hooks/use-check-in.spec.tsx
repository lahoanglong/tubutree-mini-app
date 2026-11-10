import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  openSnackbar: vi.fn(),
  postDailyCheckIn: vi.fn(),
  getDailyCheckInStatus: vi.fn(),
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));
vi.mock('../services/account-api', () => ({
  checkInView: () => ({ canCheckIn: true, buttonLabel: 'Điểm danh' }),
  getDailyCheckInStatus: (...a: unknown[]) => mocks.getDailyCheckInStatus(...a),
  postDailyCheckIn: (...a: unknown[]) => mocks.postDailyCheckIn(...a),
}));

import { useCheckIn } from './use-check-in';

const DONE = { points: { success: true, cycleDay: 1, streakDays: 1, pointsEarned: 1000, totalPoints: 1000, message: '' }, water: null, alreadyDone: false, pending: [] };

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return renderHook(() => useCheckIn(true), { wrapper });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getDailyCheckInStatus.mockResolvedValue({ checkedInToday: false, rewards: [] });
});

describe('useCheckIn: khoá đồng bộ chống chạm đúp', () => {
  it('hai lần checkIn() trong cùng khung hình chỉ gọi API một lần', async () => {
    mocks.postDailyCheckIn.mockReturnValue(deferred().promise);
    const { result } = setup();
    await act(async () => {
      result.current.checkIn();
      result.current.checkIn();
    });
    expect(mocks.postDailyCheckIn).toHaveBeenCalledTimes(1);
  });

  it('hai lần checkIn() cách nhau một microtask (React đã kịp chạy xen giữa) vẫn chỉ một lần', async () => {
    mocks.postDailyCheckIn.mockReturnValue(deferred().promise);
    const { result } = setup();
    await act(async () => {
      result.current.checkIn();
      await Promise.resolve();
      result.current.checkIn();
    });
    expect(mocks.postDailyCheckIn).toHaveBeenCalledTimes(1);
  });

  it('thành công: nhả khoá, lần điểm danh sau gọi API bình thường', async () => {
    mocks.postDailyCheckIn.mockResolvedValue(DONE);
    const { result } = setup();
    await act(async () => {
      result.current.checkIn();
    });
    await waitFor(() => expect(result.current.pending).toBe(false));
    await act(async () => {
      result.current.checkIn();
    });
    expect(mocks.postDailyCheckIn).toHaveBeenCalledTimes(2);
  });

  it('lỗi mạng: báo lỗi, nhả khoá, bấm lại gọi API lần hai', async () => {
    mocks.postDailyCheckIn.mockRejectedValueOnce(new Error('boom')).mockReturnValue(deferred().promise);
    const { result } = setup();
    await act(async () => {
      result.current.checkIn();
      result.current.checkIn();
    });
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })));
    await waitFor(() => expect(result.current.pending).toBe(false));
    await act(async () => {
      result.current.checkIn();
    });
    expect(mocks.postDailyCheckIn).toHaveBeenCalledTimes(2);
  });
});
