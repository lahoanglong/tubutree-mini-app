// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@/test-utils/render-hook';
import { checkInQuery, loyaltyQuery, pointsTxnQuery } from '@tubutree/app-core/queries/loyalty';
import { ApiError, NetworkError } from '@/lib/client-api';
import { coreHttp } from '@/lib/core-http';

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get, post: mocks.post } }));

import { useCheckIn } from './use-check-in';

const REWARDS = Array.from({ length: 7 }, (_, i) => ({ day: i + 1, points: 1000, claimed: false, isToday: i === 0 }));
const STATUS = { checkedInToday: false, streakDays: 0, currentCycleDay: 1, todayPoints: 1000, todayWater: 10, pointsDone: false, waterDone: false, rewards: REWARDS };
const DONE = { ...STATUS, checkedInToday: true };
const RESULT = { points: { success: true, cycleDay: 1, streakDays: 1, pointsEarned: 1000, totalPoints: 1000, message: '' }, water: null, alreadyDone: false, pending: [] };

const gate = <T,>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};

let unmount: (() => void) | null = null;
beforeEach(() => {
  mocks.get.mockReset();
  mocks.post.mockReset();
});
afterEach(() => {
  unmount?.();
  unmount = null;
});

async function mountLoaded() {
  mocks.get.mockResolvedValue(STATUS);
  const h = renderHook(() => useCheckIn(true));
  unmount = h.unmount;
  await waitFor(() => expect(h.result.current.status).toBeTruthy());
  return h;
}

describe('useCheckIn (web): khoá giữ tới khi trạng thái mới về', () => {
  it('hai lần gọi cùng khung hình chỉ POST một lần; POST xong mà trạng thái chưa về thì vẫn bận, gọi thêm không POST lần hai', async () => {
    mocks.post.mockResolvedValue(RESULT);
    const h = await mountLoaded();
    const fresh = gate<unknown>();
    mocks.get.mockReturnValue(fresh.promise);
    await act(async () => {
      h.result.current.checkIn();
      h.result.current.checkIn();
    });
    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1));
    expect(h.result.current.pending).toBe(true);
    await act(async () => {
      h.result.current.checkIn();
    });
    expect(mocks.post).toHaveBeenCalledTimes(1);
    await act(async () => {
      fresh.resolve(DONE);
    });
    await waitFor(() => expect(h.result.current.pending).toBe(false));
    expect(h.result.current.status?.checkedInToday).toBe(true);
    expect(mocks.post).toHaveBeenCalledTimes(1);
  });

  it('thành công: làm mới Điểm Xanh, Vườn Xanh, trạng thái điểm danh và lịch sử điểm (đúng bốn nơi)', async () => {
    mocks.post.mockResolvedValue(RESULT);
    const h = await mountLoaded();
    const invalidate = vi.spyOn(h.client, 'invalidateQueries');
    await act(async () => {
      h.result.current.checkIn();
    });
    await waitFor(() => expect(h.result.current.pending).toBe(false));
    const keys = invalidate.mock.calls.map(([filters]) => (filters as { queryKey: unknown[] }).queryKey);
    expect(keys).toHaveLength(4);
    expect(keys).toEqual(expect.arrayContaining([loyaltyQuery(coreHttp).queryKey, ['game'], checkInQuery(coreHttp).queryKey, pointsTxnQuery(coreHttp).queryKey]));
  });

  it.each([400, 404, 409, 422])('máy chủ từ chối %i: báo lỗi ngay, tải lại trạng thái điểm danh, vẫn bận tới khi nó về rồi nhả để gọi lại được', async (status) => {
    mocks.post.mockRejectedValueOnce(new ApiError('Hôm nay bạn đã điểm danh rồi.', status)).mockResolvedValue(RESULT);
    const h = await mountLoaded();
    const getsBefore = mocks.get.mock.calls.length;
    const fresh = gate<unknown>();
    mocks.get.mockReturnValue(fresh.promise);
    await act(async () => {
      h.result.current.checkIn();
    });
    await waitFor(() => expect(h.result.current.message?.error).toBe(true));
    expect(h.result.current.message?.text).toBe('Hôm nay bạn đã điểm danh rồi.');
    expect(mocks.get.mock.calls.length).toBe(getsBefore + 1);
    expect(h.result.current.pending).toBe(true);
    await act(async () => {
      h.result.current.checkIn();
    });
    expect(mocks.post).toHaveBeenCalledTimes(1);
    await act(async () => {
      fresh.resolve(DONE);
    });
    await waitFor(() => expect(h.result.current.pending).toBe(false));
    expect(h.result.current.status?.checkedInToday).toBe(true);
    await act(async () => {
      h.result.current.checkIn();
    });
    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(2));
  });

  it.each([
    ['401', () => new ApiError('Phiên hết hạn', 401)],
    ['403', () => new ApiError('Không có quyền', 403)],
    ['500', () => new ApiError('Máy chủ lỗi', 500)],
    ['503', () => new ApiError('Máy chủ bận', 503)],
    ['mất mạng', () => new NetworkError(false)],
  ])('%s: báo lỗi, KHÔNG tải lại trạng thái, nhả khoá ngay để bấm lại được', async (_name, make) => {
    mocks.post.mockRejectedValueOnce(make()).mockResolvedValue(RESULT);
    const h = await mountLoaded();
    const getsBefore = mocks.get.mock.calls.length;
    mocks.get.mockReturnValue(new Promise(() => undefined));
    await act(async () => {
      h.result.current.checkIn();
    });
    await waitFor(() => expect(h.result.current.pending).toBe(false));
    expect(h.result.current.message?.error).toBe(true);
    expect(mocks.get.mock.calls.length).toBe(getsBefore);
    await act(async () => {
      h.result.current.checkIn();
    });
    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(2));
  });

  describe('dữ liệu mới treo mãi: khoá nhả đúng sau 4 giây', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
    });
    afterEach(() => {
      vi.useRealTimers();
    });
    const heldFor4s = async (h: Awaited<ReturnType<typeof mountLoaded>>) => {
      await act(async () => {
        h.result.current.checkIn();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_900);
      });
      expect(h.result.current.pending).toBe(true);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
      expect(h.result.current.pending).toBe(false);
    };

    it('điểm danh xong mà số dư/trạng thái không về', async () => {
      mocks.post.mockResolvedValue(RESULT);
      const h = await mountLoaded();
      mocks.get.mockReturnValue(new Promise(() => undefined));
      await heldFor4s(h);
    });

    it('máy chủ từ chối mà trạng thái không về', async () => {
      mocks.post.mockRejectedValue(new ApiError('Đã điểm danh rồi.', 409));
      const h = await mountLoaded();
      mocks.get.mockReturnValue(new Promise(() => undefined));
      await heldFor4s(h);
    });
  });
});
