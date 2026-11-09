// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@/test-utils/render-hook';

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

  it('lỗi: báo lỗi, vẫn bận tới khi trạng thái điểm danh tải lại xong, rồi nhả để gọi lại được', async () => {
    mocks.post.mockRejectedValueOnce(new Error('mất mạng')).mockResolvedValue(RESULT);
    const h = await mountLoaded();
    const fresh = gate<unknown>();
    mocks.get.mockReturnValue(fresh.promise);
    await act(async () => {
      h.result.current.checkIn();
    });
    await waitFor(() => expect(h.result.current.message?.error).toBe(true));
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(h.result.current.pending).toBe(true);
    await act(async () => {
      h.result.current.checkIn();
    });
    expect(mocks.post).toHaveBeenCalledTimes(1);
    await act(async () => {
      fresh.resolve(STATUS);
    });
    await waitFor(() => expect(h.result.current.pending).toBe(false));
    await act(async () => {
      h.result.current.checkIn();
    });
    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(2));
  });
});
