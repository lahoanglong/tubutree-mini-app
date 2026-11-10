import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpError } from '../services/http';
import { LOCK_REFRESH_WAIT_MS } from '../utils/settle-within';

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

// Ghi lại khoá có sẵn của use-check-in (chưa có spec riêng); wave 84A không đổi hook này.
describe('useCheckIn: khoá đồng bộ chống chạm đúp (kiểm lại hành vi có sẵn)', () => {
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

// W113A: điểm danh bị máy chủ từ chối vì trạng thái đã đổi (400/404/409) thì tải lại ['loyalty-checkin'] và giữ khoá tới khi dữ liệu về (tối đa LOCK_REFRESH_WAIT_MS). Quá hạn, mất kết nối, 5xx: nhả ngay nhưng vẫn làm mới nền một lần (máy chủ có thể đã ghi). 401 và lỗi khác: nhả ngay, không tải lại.
describe('useCheckIn: bị từ chối thì giữ khoá tới khi trạng thái điểm danh làm mới về (W113A)', () => {
  const serverError = (message: string, status: number) => new HttpError(message, undefined, { status, data: { message }, headers: {} });
  const settle = () =>
    act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
  const errorToasts = () => mocks.openSnackbar.mock.calls.filter(([o]) => o.type === 'error').length;
  function setupLive(refresh: () => Promise<unknown>) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const invalidate = vi.spyOn(qc, 'invalidateQueries').mockImplementation((() => refresh()) as never);
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    return { ...renderHook(() => useCheckIn(true), { wrapper }), invalidate };
  }

  it.each([
    [400, 'Hôm nay bạn đã điểm danh rồi'],
    [404, 'Không tìm thấy lượt điểm danh'],
    [409, 'Điểm danh vừa được ghi nhận'],
  ])('bị từ chối %i: báo lỗi một lần, tải lại đúng khoá, khoá giữ tới khi dữ liệu về rồi mới nhả', async (status, message) => {
    mocks.postDailyCheckIn.mockRejectedValueOnce(serverError(message, status)).mockResolvedValue(DONE);
    const refresh = deferred<void>();
    const { result, invalidate } = setupLive(() => refresh.promise);
    await act(async () => {
      result.current.checkIn();
    });
    await waitFor(() => expect(errorToasts()).toBe(1));
    expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: message, type: 'error' });
    expect(invalidate.mock.calls.map(([filter]) => filter)).toEqual([{ queryKey: ['loyalty-checkin'] }]);
    expect(result.current.pending).toBe(true);
    await act(async () => {
      result.current.checkIn();
      result.current.checkIn();
    });
    expect(mocks.postDailyCheckIn).toHaveBeenCalledTimes(1);
    await act(async () => refresh.resolve());
    await settle();
    await waitFor(() => expect(result.current.pending).toBe(false));
    expect(errorToasts()).toBe(1);
    await act(async () => {
      result.current.checkIn();
    });
    expect(mocks.postDailyCheckIn).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['mất mạng', new HttpError('Network Error', 'ERR_NETWORK')],
    ['hết thời gian', new HttpError('timeout', 'ECONNABORTED')],
    ['máy chủ lỗi 503', serverError('Service Unavailable', 503)],
  ])('%s: nhả khoá ngay, vẫn làm mới nền một lần vì máy chủ có thể đã ghi điểm danh', async (_label, error) => {
    mocks.postDailyCheckIn.mockRejectedValueOnce(error).mockResolvedValue(DONE);
    const { result, invalidate } = setupLive(() => new Promise(() => undefined));
    await act(async () => {
      result.current.checkIn();
    });
    await waitFor(() => expect(errorToasts()).toBe(1));
    await waitFor(() => expect(result.current.pending).toBe(false));
    expect(invalidate.mock.calls.map(([filter]) => filter)).toEqual([{ queryKey: ['loyalty-checkin'] }]);
    await act(async () => {
      result.current.checkIn();
    });
    expect(mocks.postDailyCheckIn).toHaveBeenCalledTimes(2);
  });

  it('hết phiên 401: nhả khoá ngay dù tải lại treo, vẫn tải lại nền một lần như trước', async () => {
    mocks.postDailyCheckIn.mockRejectedValueOnce(serverError('Unauthorized', 401)).mockResolvedValue(DONE);
    const { result, invalidate } = setupLive(() => new Promise(() => undefined));
    await act(async () => {
      result.current.checkIn();
    });
    await waitFor(() => expect(errorToasts()).toBe(1));
    await waitFor(() => expect(result.current.pending).toBe(false));
    expect(invalidate.mock.calls.map(([filter]) => filter)).toEqual([{ queryKey: ['loyalty-checkin'] }]);
    await act(async () => {
      result.current.checkIn();
    });
    expect(mocks.postDailyCheckIn).toHaveBeenCalledTimes(2);
  });

  it('tải lại treo mãi: khoá nhả đúng sau LOCK_REFRESH_WAIT_MS', async () => {
    mocks.postDailyCheckIn.mockRejectedValueOnce(serverError('Điểm danh vừa được ghi nhận', 409)).mockResolvedValue(DONE);
    const { result } = setupLive(() => new Promise(() => undefined));
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await act(async () => {
        result.current.checkIn();
      });
      await waitFor(() => expect(errorToasts()).toBe(1));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(LOCK_REFRESH_WAIT_MS - 500);
      });
      expect(result.current.pending).toBe(true);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });
      await waitFor(() => expect(result.current.pending).toBe(false));
    } finally {
      vi.useRealTimers();
    }
    await act(async () => {
      result.current.checkIn();
    });
    expect(mocks.postDailyCheckIn).toHaveBeenCalledTimes(2);
  });
});
