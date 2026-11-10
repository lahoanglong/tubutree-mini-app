import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpError } from '../../services/http';
import { gameMoreCopy } from '@tubutree/app-core/game-more-copy';
import type * as GameApi from '../../services/game-api';
import { LOCK_REFRESH_WAIT_MS } from '../../utils/settle-within';

const mocks = vi.hoisted(() => ({
  answerQuiz: vi.fn(),
  openSnackbar: vi.fn(),
  collectDew: vi.fn(),
  unlockPlot: vi.fn(),
  repairStreak: vi.fn(),
  claimMission: vi.fn(),
  claimSeasonPass: vi.fn(),
}));
vi.mock('zmp-ui', () => ({ useSnackbar: () => ({ openSnackbar: mocks.openSnackbar }) }));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));
vi.mock('../../services/game-api', async (orig) => ({
  ...(await orig<typeof GameApi>()),
  answerQuiz: mocks.answerQuiz,
  collectDew: mocks.collectDew,
  unlockPlot: mocks.unlockPlot,
  repairStreak: mocks.repairStreak,
  claimMission: mocks.claimMission,
  claimSeasonPass: mocks.claimSeasonPass,
}));

import { useGameActions } from './use-game-actions';

const serverError = (message: string) => new HttpError(message, undefined, { status: 400, data: { message } } as never);

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidate = vi.spyOn(qc, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  const hook = renderHook(() => useGameActions({ onHarvest: vi.fn(), onAnswered: vi.fn() }), { wrapper });
  return { invalidate, hook };
}

describe('useGameActions: trả lời câu đố', () => {
  it('máy chủ nói câu không thuộc bộ hôm nay: tải lại bộ câu và báo ngắn, không đọc lời máy chủ', async () => {
    mocks.answerQuiz.mockRejectedValue(serverError('Câu hỏi này không thuộc bộ câu hôm nay.'));
    const { invalidate, hook } = setup();
    await act(async () => hook.result.current.answerM.mutate({ id: 'q1', choice: 0 }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: gameMoreCopy.quiz.staleSet, type: 'warning' }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['game', 'quiz'] });
  });

  it('lỗi khác: báo lời máy chủ, không tải lại bộ câu', async () => {
    mocks.openSnackbar.mockClear();
    mocks.answerQuiz.mockRejectedValue(serverError('Bạn đã trả lời câu này rồi.'));
    const { invalidate, hook } = setup();
    await act(async () => hook.result.current.answerM.mutate({ id: 'q1', choice: 0 }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalled());
    expect(mocks.openSnackbar.mock.calls[0]?.[0].text).not.toBe(gameMoreCopy.quiz.staleSet);
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ['game', 'quiz'] });
  });
});

type Actions = ReturnType<typeof useGameActions>;

// Mỗi khoá là một truy vấn đang được xem (observer) nên invalidateQueries thật sự tải lại nó; bộ chuyển không có observer thì
// invalidateQueries xong ngay và không chứng minh được khoá có giữ tới khi dữ liệu về hay không.
const PROBES = {
  profile: ['game', 'profile'],
  missions: ['game', 'missions'],
  seasonPass: ['game', 'seasonPass'],
  me: ['me'],
  loyalty: ['loyalty'],
} as const;
type Probe = keyof typeof PROBES;

/** Lần tải đầu của mọi khoá xong ngay; lần tải lại của `held` treo tới khi `release()` (hoặc mãi mãi nếu không ai gọi). */
function setupHeld(held: Probe) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const fetched: Record<Probe, number> = { profile: 0, missions: 0, seasonPass: 0, me: 0, loyalty: 0 };
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  const hook = renderHook(
    () => {
      const useProbe = (name: Probe) =>
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
      return useGameActions({ onHarvest: vi.fn(), onAnswered: vi.fn() });
    },
    { wrapper },
  );
  return { hook, fetched, release: () => release() };
}

const ONE_SHOT: {
  name: string;
  api: ReturnType<typeof vi.fn>;
  result: unknown;
  tap: (a: Actions) => void;
  pending: (a: Actions) => boolean;
  held: Probe[];
}[] = [
  { name: 'hứng sương', api: mocks.collectDew, result: { seedsEarned: 5, totalSeeds: 10 }, tap: (a) => a.dewM.mutate(), pending: (a) => a.dewM.isPending, held: ['profile', 'me', 'loyalty'] },
  { name: 'mở lô đất', api: mocks.unlockPlot, result: { unlocked: true }, tap: (a) => a.unlockM.mutate(1), pending: (a) => a.unlockM.isPending, held: ['profile', 'me', 'loyalty'] },
  { name: 'hồi sinh chuỗi', api: mocks.repairStreak, result: { repaired: true }, tap: (a) => a.repairM.mutate(), pending: (a) => a.repairM.isPending, held: ['profile'] },
  { name: 'nhận thưởng bậc Chặng Mùa', api: mocks.claimSeasonPass, result: { claimed: true, reward: { type: 'SEEDS', amount: 5 } }, tap: (a) => a.claimPassM.mutate({ tier: 1, track: 'free' }), pending: (a) => a.claimPassM.isPending, held: ['seasonPass', 'profile', 'loyalty'] },
  { name: 'nhận thưởng nhiệm vụ', api: mocks.claimMission, result: { claimed: true, rewardPoints: 5, couponCode: null }, tap: (a) => a.claimMissionM.mutate('NEW_USER'), pending: (a) => a.claimMissionM.isPending, held: ['missions', 'me', 'loyalty'] },
];
const HOLD_CASES = ONE_SHOT.flatMap((c) => c.held.map((h) => [c.name, h, c] as const));

const settleTicks = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 25)); });

describe('useGameActions: việc một-lần giữ khoá tới khi dữ liệu mới về', () => {
  beforeEach(() => {
    for (const c of ONE_SHOT) c.api.mockReset();
  });

  it.each(HOLD_CASES)('%s: chạm lại khi %s chưa tải xong bị bỏ qua; về rồi thì nhả và gọi được lần hai', async (_name, held, c) => {
    c.api.mockResolvedValue(c.result);
    const { hook, fetched, release } = setupHeld(held);
    await waitFor(() => expect(Object.values(fetched).every((n) => n === 1)).toBe(true));
    act(() => c.tap(hook.result.current));
    await waitFor(() => expect(fetched[held]).toBe(2));
    await settleTicks();
    expect(c.pending(hook.result.current)).toBe(true);
    act(() => c.tap(hook.result.current));
    await settleTicks();
    expect(c.api).toHaveBeenCalledTimes(1);
    await act(async () => release());
    await waitFor(() => expect(c.pending(hook.result.current)).toBe(false));
    act(() => c.tap(hook.result.current));
    await waitFor(() => expect(c.api).toHaveBeenCalledTimes(2));
  });
});

describe('useGameActions: dữ liệu làm mới treo mãi thì nhả khoá sau LOCK_REFRESH_WAIT_MS, không sớm hơn', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(ONE_SHOT.map((c) => [c.name, c] as const))('%s', async (_name, c) => {
    c.api.mockReset();
    c.api.mockResolvedValue(c.result);
    const held = c.held[0]!;
    const { hook, fetched } = setupHeld(held);
    await waitFor(() => expect(Object.values(fetched).every((n) => n === 1)).toBe(true));
    vi.useFakeTimers();
    act(() => c.tap(hook.result.current));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(fetched[held]).toBe(2);
    expect(c.pending(hook.result.current)).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(LOCK_REFRESH_WAIT_MS - 1); });
    expect(c.pending(hook.result.current)).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOCK_REFRESH_WAIT_MS);
      for (let i = 0; i < 3; i++) await vi.advanceTimersByTimeAsync(0);
    });
    expect(c.pending(hook.result.current)).toBe(false);
    act(() => c.tap(hook.result.current));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(c.api).toHaveBeenCalledTimes(2);
  });
});
