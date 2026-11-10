// @vitest-environment jsdom
import { act } from 'react';
import { useQuery } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, NetworkError } from '@/lib/client-api';
import { LOCK_REFRESH_WAIT_MS } from '@/lib/settle-within';

// Lệnh một-lần của Vườn Xanh bị máy chủ từ chối bằng 400/404/409 (đã nhận, lô đã đổi, thiếu nước/điểm, không còn đủ điều kiện): thẻ đang hiện
// đã cũ nên tải lại đúng khoá rồi mới nhả khoá (hạn 4 giây); lời lỗi hiện ngay. Mất mạng, 401, 403, 5xx không nói gì về trạng thái thật nên không tải lại.
// Tặng nước (giftM) có spec riêng ở gift-water.spec.tsx.

const api = vi.hoisted(() => ({
  checkIn: vi.fn(),
  collectDew: vi.fn(),
  buyStreakFreeze: vi.fn(),
  repairStreak: vi.fn(),
  giftWater: vi.fn(),
  waterTree: vi.fn(),
  buyTree: vi.fn(),
  unlockPlot: vi.fn(),
  waterPlot: vi.fn(),
  claimSeasonPass: vi.fn(),
  claimMission: vi.fn(),
  shareHarvest: vi.fn(),
  answerQuiz: vi.fn(),
}));
vi.mock('@tubutree/app-core/api/game', async (orig) => ({ ...(await orig<typeof import('@tubutree/app-core/api/game')>()), ...api }));

import { renderHook, newTestClient, waitFor } from '@/test-utils/render-hook';
import { useGameActions } from './use-game-actions';

type Actions = ReturnType<typeof useGameActions>;

// Mỗi khoá là một truy vấn đang được xem (observer) nên invalidateQueries thật sự tải lại nó; khoá không có observer thì invalidateQueries xong ngay và
// không chứng minh được nút có giữ tới khi dữ liệu về hay không.
const PROBES = {
  profile: ['game', 'profile'],
  missions: ['game', 'missions'],
  seasonPass: ['game', 'seasonPass'],
  me: ['me'],
  loyalty: ['loyalty'],
  quiz: ['game', 'quiz'],
  checkIn: ['loyalty-checkin'],
} as const;
type Probe = keyof typeof PROBES;

/** Lần tải đầu của mọi khoá xong ngay; lần tải lại của `held` treo tới khi `release()` (hoặc mãi mãi nếu không ai gọi). */
function setupHeld(held: Probe) {
  const fetched: Record<Probe, number> = { profile: 0, missions: 0, seasonPass: 0, me: 0, loyalty: 0, quiz: 0, checkIn: 0 };
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const notify = vi.fn();
  const hook = renderHook(
    () => {
      const useProbe = (name: Probe) =>
        // eslint-disable-next-line react-hooks/rules-of-hooks -- thứ tự gọi cố định theo danh sách bên dưới
        useQuery({
          queryKey: PROBES[name],
          queryFn: async () => {
            fetched[name] += 1;
            if (name === held && fetched[name] > 1) await gate;
            return fetched[name];
          },
        });
      useProbe('profile');
      useProbe('missions');
      useProbe('seasonPass');
      useProbe('me');
      useProbe('loyalty');
      useProbe('quiz');
      useProbe('checkIn');
      return useGameActions({ notify, onHarvest: vi.fn(), onAnswered: vi.fn() });
    },
    { client: newTestClient() },
  );
  return { hook, fetched, notify, release: () => release() };
}

const allFetchedOnce = (fetched: Record<Probe, number>) => Object.values(fetched).every((n) => n === 1);
const settleTicks = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 25));
  });
const reject = (status: number) => new ApiError('Máy chủ từ chối', status);
const quizStale = (status: number) => new ApiError('Câu hỏi này không thuộc bộ câu hôm nay.', status);

interface Case {
  name: string;
  api: ReturnType<typeof vi.fn>;
  tap: (a: Actions) => void;
  pending: (a: Actions) => boolean;
  /** Khoá nào bị tải lại khi máy chủ từ chối; ca đầu của danh sách là khoá được giữ treo ở các ca còn lại. */
  held: Probe[];
  stale: (status: number) => ApiError;
}
const REFRESHED: Probe[] = ['profile', 'me', 'loyalty'];
const CASES: Case[] = [
  { name: 'điểm danh (checkInM)', api: api.checkIn, tap: (a) => a.checkInM.mutate(), pending: (a) => a.checkInM.isPending, held: [...REFRESHED, 'checkIn'], stale: reject },
  { name: 'hứng sương (dewM)', api: api.collectDew, tap: (a) => a.dewM.mutate(), pending: (a) => a.dewM.isPending, held: REFRESHED, stale: reject },
  { name: 'mua vé giữ lửa (freezeM)', api: api.buyStreakFreeze, tap: (a) => a.freezeM.mutate(), pending: (a) => a.freezeM.isPending, held: REFRESHED, stale: reject },
  { name: 'hồi sinh chuỗi (repairM)', api: api.repairStreak, tap: (a) => a.repairM.mutate(), pending: (a) => a.repairM.isPending, held: REFRESHED, stale: reject },
  { name: 'mở lô đất (unlockM)', api: api.unlockPlot, tap: (a) => a.unlockM.mutate(1), pending: (a) => a.unlockM.isPending, held: REFRESHED, stale: reject },
  { name: 'tưới cây chính 20💧 (waterM)', api: api.waterTree, tap: (a) => a.waterM.mutate(20), pending: (a) => a.waterM.isPending, held: REFRESHED, stale: reject },
  { name: 'tưới lô phụ (waterPlotM)', api: api.waterPlot, tap: (a) => a.waterPlotM.mutate('plot-1'), pending: (a) => a.waterPlotM.isPending, held: REFRESHED, stale: reject },
  { name: 'nhận thưởng bậc Chặng Mùa (claimPassM)', api: api.claimSeasonPass, tap: (a) => a.claimPassM.mutate({ tier: 1, track: 'free' }), pending: (a) => a.claimPassM.isPending, held: ['seasonPass', 'profile', 'me', 'loyalty'], stale: reject },
  { name: 'nhận thưởng nhiệm vụ (claimMissionM)', api: api.claimMission, tap: (a) => a.claimMissionM.mutate('NEW_USER'), pending: (a) => a.claimMissionM.isPending, held: ['missions', 'me', 'loyalty'], stale: reject },
  { name: 'trả lời câu đố ngoài bộ (answerM)', api: api.answerQuiz, tap: (a) => a.answerM.mutate({ id: 'q1', choice: 0 }), pending: (a) => a.answerM.isPending, held: ['quiz'], stale: quizStale },
];
const STALE = CASES.flatMap((c) => [
  ...c.held.map((h) => [c.name, 400, h, c] as const),
  ...[404, 409].map((status) => [c.name, status, c.held[0]!, c] as const),
]);
const TEMPORARY = CASES.flatMap((c) => [401, 403, 500, 502].map((status) => [c.name, status, c] as const));

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('Vườn Xanh: lệnh một-lần bị máy chủ từ chối (400/404/409) tải lại rồi mới nhả khoá', () => {
  it.each(STALE)('%s bị từ chối %i: tải lại %s, giữ khoá tới khi về (chạm lại không gọi API), báo lỗi một lần, rồi nhả', async (_name, status, held, c) => {
    c.api.mockRejectedValue(c.stale(status));
    const { hook, fetched, notify, release } = setupHeld(held);
    await waitFor(() => expect(allFetchedOnce(fetched)).toBe(true));
    await act(async () => c.tap(hook.result.current));
    await waitFor(() => expect(fetched[held]).toBe(2));
    await settleTicks();
    expect(c.pending(hook.result.current)).toBe(true);
    await act(async () => c.tap(hook.result.current));
    await settleTicks();
    expect(c.api).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0]?.[1]).toBe('error');
    await act(async () => release());
    await waitFor(() => expect(c.pending(hook.result.current)).toBe(false));
    await act(async () => c.tap(hook.result.current));
    await waitFor(() => expect(c.api).toHaveBeenCalledTimes(2));
    hook.unmount();
  });

  it.each(TEMPORARY)('%s gặp %i (lỗi tạm): chỉ báo lỗi, không tải lại, nhả khoá ngay', async (_name, status, c) => {
    c.api.mockRejectedValue(reject(status));
    const { hook, fetched, notify } = setupHeld(c.held[0]!);
    await waitFor(() => expect(allFetchedOnce(fetched)).toBe(true));
    await act(async () => c.tap(hook.result.current));
    await waitFor(() => expect(notify).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(c.pending(hook.result.current)).toBe(false));
    await settleTicks();
    expect(allFetchedOnce(fetched)).toBe(true);
    await act(async () => c.tap(hook.result.current));
    await waitFor(() => expect(c.api).toHaveBeenCalledTimes(2));
    hook.unmount();
  });

  it.each(CASES.map((c) => [c.name, c] as const))('%s mất mạng: chỉ báo lỗi, không tải lại, nhả khoá ngay', async (_name, c) => {
    c.api.mockRejectedValue(new NetworkError(false));
    const { hook, fetched, notify } = setupHeld(c.held[0]!);
    await waitFor(() => expect(allFetchedOnce(fetched)).toBe(true));
    await act(async () => c.tap(hook.result.current));
    await waitFor(() => expect(notify).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(c.pending(hook.result.current)).toBe(false));
    await settleTicks();
    expect(allFetchedOnce(fetched)).toBe(true);
    hook.unmount();
  });
});

describe('Vườn Xanh: bị từ chối mà dữ liệu tải lại treo mãi thì nhả khoá sau LOCK_REFRESH_WAIT_MS, không sớm hơn', () => {
  it.each(CASES.map((c) => [c.name, c] as const))('%s', async (_name, c) => {
    c.api.mockRejectedValue(c.stale(400));
    const held = c.held[0]!;
    const { hook, fetched } = setupHeld(held);
    await waitFor(() => expect(allFetchedOnce(fetched)).toBe(true));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await act(async () => c.tap(hook.result.current));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetched[held]).toBe(2);
    expect(c.pending(hook.result.current)).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOCK_REFRESH_WAIT_MS - 1);
    });
    expect(c.pending(hook.result.current)).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOCK_REFRESH_WAIT_MS);
      for (let i = 0; i < 3; i++) await vi.advanceTimersByTimeAsync(0);
    });
    expect(c.pending(hook.result.current)).toBe(false);
    await act(async () => c.tap(hook.result.current));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(c.api).toHaveBeenCalledTimes(2);
    hook.unmount();
  });
});

describe('Vườn Xanh: các ca biên của khoá khi bị từ chối', () => {
  const WATERED = { progress: 1, target: 100, harvested: false };

  it('lô A bị từ chối đang giữ khoá tải lại: tưới lô B vẫn gọi được ngay (khoá theo lô)', async () => {
    api.waterPlot.mockRejectedValueOnce(reject(400)).mockResolvedValueOnce(WATERED);
    const { hook, fetched } = setupHeld('profile');
    await waitFor(() => expect(allFetchedOnce(fetched)).toBe(true));
    await act(async () => hook.result.current.waterPlotM.mutate('plot-1'));
    await waitFor(() => expect(fetched.profile).toBe(2));
    await act(async () => hook.result.current.waterPlotM.mutate('plot-2'));
    await waitFor(() => expect(api.waterPlot).toHaveBeenCalledTimes(2));
    expect(api.waterPlot).toHaveBeenNthCalledWith(2, expect.anything(), 'plot-2', 20);
    hook.unmount();
  });

  it('nút Thu hoạch (tưới 0💧) bị từ chối 400: tải lại hồ sơ và giữ khoá tới khi về, để thẻ cũ không bấm lại mãi', async () => {
    api.waterTree.mockRejectedValue(reject(400));
    const { hook, fetched, release } = setupHeld('profile');
    await waitFor(() => expect(allFetchedOnce(fetched)).toBe(true));
    await act(async () => hook.result.current.waterM.mutate(0));
    await waitFor(() => expect(fetched.profile).toBe(2));
    await settleTicks();
    expect(hook.result.current.waterM.isPending).toBe(true);
    await act(async () => hook.result.current.waterM.mutate(0));
    await settleTicks();
    expect(api.waterTree).toHaveBeenCalledTimes(1);
    await act(async () => release());
    await waitFor(() => expect(hook.result.current.waterM.isPending).toBe(false));
    hook.unmount();
  });

  it('lỗi câu đố khác (không phải câu ngoài bộ) bị 400: chỉ báo lời máy chủ, không tải lại bộ câu', async () => {
    api.answerQuiz.mockRejectedValue(new ApiError('Bạn đã trả lời câu này rồi.', 400));
    const { hook, fetched, notify } = setupHeld('quiz');
    await waitFor(() => expect(allFetchedOnce(fetched)).toBe(true));
    await act(async () => hook.result.current.answerM.mutate({ id: 'q1', choice: 0 }));
    await waitFor(() => expect(notify).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(hook.result.current.answerM.isPending).toBe(false));
    await settleTicks();
    expect(fetched.quiz).toBe(1);
    hook.unmount();
  });
});

/** Một lượt góp qua `mutateAsync` như TreeFund gọi: `settled` chỉ bật khi Promise xong, tức lúc khoá ref ở TreeFund nhả. */
function startBuy(hook: { result: { current: Actions } }) {
  const outcome = { settled: false, ok: undefined as boolean | undefined };
  act(() => {
    void hook.result.current.buyTreeM.mutateAsync('key-12345678').then(
      () => Object.assign(outcome, { settled: true, ok: true }),
      () => Object.assign(outcome, { settled: true, ok: false }),
    );
  });
  return outcome;
}

describe('Vườn Xanh: góp quỹ trồng cây (buyTreeM, mutateAsync): Promise chỉ xong khi dữ liệu mới về', () => {
  const BUY_HELD: Probe[] = ['profile', 'me', 'loyalty'];
  const BUY_STALE = [...BUY_HELD.map((h) => [400, h] as const), ...[404, 409].map((status) => [status, 'profile' as Probe] as const)];

  it.each(BUY_STALE)('bị từ chối %i: tải lại %s, mutateAsync chưa xong và isPending còn true tới khi về, báo một lần', async (status, held) => {
    api.buyTree.mockRejectedValue(reject(status));
    const { hook, fetched, notify, release } = setupHeld(held);
    await waitFor(() => expect(allFetchedOnce(fetched)).toBe(true));
    const outcome = startBuy(hook);
    await waitFor(() => expect(fetched[held]).toBe(2));
    await settleTicks();
    expect(outcome.settled).toBe(false);
    expect(hook.result.current.buyTreeM.isPending).toBe(true);
    expect(notify).toHaveBeenCalledTimes(1);
    await act(async () => release());
    await waitFor(() => expect(outcome).toMatchObject({ settled: true, ok: false }));
    await waitFor(() => expect(hook.result.current.buyTreeM.isPending).toBe(false));
    hook.unmount();
  });

  it.each([401, 500, 502])('gặp %i (lỗi tạm): mutateAsync reject ngay, không tải lại', async (status) => {
    api.buyTree.mockRejectedValue(reject(status));
    const { hook, fetched, notify } = setupHeld('profile');
    await waitFor(() => expect(allFetchedOnce(fetched)).toBe(true));
    const outcome = startBuy(hook);
    await waitFor(() => expect(outcome).toMatchObject({ settled: true, ok: false }));
    await settleTicks();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(allFetchedOnce(fetched)).toBe(true);
    hook.unmount();
  });

  it('mất mạng: mutateAsync reject ngay, không tải lại', async () => {
    api.buyTree.mockRejectedValue(new NetworkError(false));
    const { hook, fetched } = setupHeld('profile');
    await waitFor(() => expect(allFetchedOnce(fetched)).toBe(true));
    const outcome = startBuy(hook);
    await waitFor(() => expect(outcome).toMatchObject({ settled: true, ok: false }));
    await settleTicks();
    expect(allFetchedOnce(fetched)).toBe(true);
    hook.unmount();
  });

  it('tải lại treo mãi: mutateAsync reject sau LOCK_REFRESH_WAIT_MS, không sớm hơn', async () => {
    api.buyTree.mockRejectedValue(reject(400));
    const { hook, fetched } = setupHeld('profile');
    await waitFor(() => expect(allFetchedOnce(fetched)).toBe(true));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const outcome = startBuy(hook);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetched.profile).toBe(2);
    expect(outcome.settled).toBe(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOCK_REFRESH_WAIT_MS - 1);
    });
    expect(outcome.settled).toBe(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOCK_REFRESH_WAIT_MS);
      for (let i = 0; i < 3; i++) await vi.advanceTimersByTimeAsync(0);
    });
    expect(outcome).toMatchObject({ settled: true, ok: false });
    hook.unmount();
  });
});
