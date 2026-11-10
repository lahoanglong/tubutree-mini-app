// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Friend } from '@tubutree/app-core/api/game';
import { click, flush, render, type Rendered } from '@/test-utils/dom';
import { ApiError, NetworkError } from '@/lib/client-api';

// Tặng nước bạn bè (hiện tắt ở web bằng GAME_SOCIAL_ON_WEB, nhưng mã đã có và có test khoá chạm đúp ở app/vuon-xanh/garden-locks.spec.tsx):
// tặng là việc một-lần mỗi ngày mỗi bạn, nên máy chủ từ chối 400/404/409 ("đã tặng hôm nay", "chưa đủ nước", không còn là bạn) có nghĩa là danh sách bạn và số nước đang hiện đã cũ:
// tải lại rồi mới nhả khoá (hạn 4 giây), lời lỗi hiện ngay. Mất mạng, 401, 403, 5xx không nói gì về trạng thái thật nên không tải lại.

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

import { renderHook } from '@/test-utils/render-hook';
import { FriendGifts } from './friend-gifts';
import { useGameActions } from './use-game-actions';

const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  Object.values(api).forEach((fn) => fn.mockReset());
});

describe('useGameActions: tặng nước bị máy chủ từ chối thì tải lại rồi mới nhả khoá', () => {
  function setup(hold: Promise<unknown> | null) {
    const notify = vi.fn();
    const hook = renderHook(() => useGameActions({ notify, onHarvest: vi.fn(), onAnswered: vi.fn() }));
    const invalidate = vi.spyOn(hook.client, 'invalidateQueries').mockImplementation(() => (hold ?? Promise.resolve()) as Promise<void>);
    return { hook, notify, invalidate };
  }
  const keysOf = (spy: ReturnType<typeof setup>['invalidate']) => spy.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey: unknown }).queryKey)).sort();

  it.each([
    [400, 'Hôm nay bạn đã tặng nước cho người này rồi 🌿'],
    [404, 'Không tìm thấy bạn bè này.'],
    [409, 'Lệnh tặng đang được xử lý.'],
  ])('HTTP %i: lời lỗi hiện ngay, làm mới danh sách bạn, số nước và điểm, khoá giữ tới khi xong', async (status, message) => {
    const reload = deferred<void>();
    api.giftWater.mockRejectedValue(new ApiError(message, status));
    const { hook, notify, invalidate } = setup(reload.promise);
    await act(async () => hook.result.current.giftM.mutate('f1'));
    await advance(100);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining(message), 'error');
    expect(keysOf(invalidate)).toEqual([JSON.stringify(['game']), JSON.stringify(['loyalty']), JSON.stringify(['me'])]);
    expect(hook.result.current.giftM.isPending).toBe(true);
    await act(async () => hook.result.current.giftM.mutate('f1'));
    expect(api.giftWater).toHaveBeenCalledTimes(1);
    await act(async () => reload.resolve());
    await advance(100);
    expect(hook.result.current.giftM.isPending).toBe(false);
    await act(async () => hook.result.current.giftM.mutate('f1'));
    await advance(100);
    expect(api.giftWater).toHaveBeenCalledTimes(2);
    hook.unmount();
  });

  it('khoá nhả sau 4 giây dù việc tải lại không bao giờ về', async () => {
    api.giftWater.mockRejectedValue(new ApiError('Hôm nay bạn đã tặng nước cho người này rồi 🌿', 400));
    const { hook } = setup(new Promise(() => undefined));
    await act(async () => hook.result.current.giftM.mutate('f1'));
    await advance(100);
    await advance(2_900);
    expect(hook.result.current.giftM.isPending).toBe(true);
    await advance(1_500);
    expect(hook.result.current.giftM.isPending).toBe(false);
    expect(hook.result.current.giftM.isError).toBe(true);
    hook.unmount();
  });

  it('khoá chỉ theo bạn đang bị từ chối: bạn khác vẫn tặng được trong lúc việc tải lại treo', async () => {
    api.giftWater.mockImplementation(async (_http: unknown, id: string) => {
      if (id === 'f1') throw new ApiError('Hôm nay bạn đã tặng nước cho người này rồi 🌿', 400);
      return { amount: 5, recipientId: id };
    });
    const { hook } = setup(new Promise(() => undefined));
    await act(async () => hook.result.current.giftM.mutate('f1'));
    await advance(100);
    await act(async () => hook.result.current.giftM.mutate('f3'));
    await advance(100);
    expect(api.giftWater.mock.calls.map((c) => c[1])).toEqual(['f1', 'f3']);
    hook.unmount();
  });

  it.each([
    ['401', new ApiError('Phiên đăng nhập hết hạn', 401)],
    ['403', new ApiError('Tài khoản bị khoá', 403)],
    ['500', new ApiError('Internal server error', 500)],
    ['502', new ApiError('Bad gateway', 502)],
    ['503', new ApiError('Service unavailable', 503)],
    ['mất mạng', new NetworkError(false)],
  ])('lỗi tạm (%s): chỉ báo lỗi, không tải lại, nhả khoá ngay', async (_name, error) => {
    api.giftWater.mockRejectedValue(error);
    const { hook, notify, invalidate } = setup(new Promise(() => undefined));
    await act(async () => hook.result.current.giftM.mutate('f1'));
    await advance(100);
    expect(notify).toHaveBeenCalledWith(expect.any(String), 'error');
    expect(invalidate).not.toHaveBeenCalled();
    expect(hook.result.current.giftM.isPending).toBe(false);
    hook.unmount();
  });

  it('thành công vẫn làm mới và giữ khoá tới khi xong (không đổi)', async () => {
    const reload = deferred<void>();
    api.giftWater.mockResolvedValue({ amount: 5, recipientId: 'f1' });
    const { hook, invalidate } = setup(reload.promise);
    await act(async () => hook.result.current.giftM.mutate('f1'));
    await advance(100);
    expect(keysOf(invalidate)).toEqual([JSON.stringify(['game']), JSON.stringify(['loyalty']), JSON.stringify(['me'])]);
    expect(hook.result.current.giftM.isPending).toBe(true);
    await act(async () => reload.resolve());
    await advance(100);
    expect(hook.result.current.giftM.isPending).toBe(false);
    hook.unmount();
  });
});

const FRIENDS: Friend[] = [
  { id: 'f1', nickname: 'Lan', giftedToday: false },
  { id: 'f3', nickname: 'Hà', giftedToday: false },
  { id: 'f4', nickname: 'Mai', giftedToday: true },
];

describe('FriendGifts: nút báo bận cho MỌI bạn đang được tặng, nút đã tặng không rớt focus', () => {
  let mounted: Rendered[] = [];
  function Host({ friends }: { friends: Friend[] }) {
    const { giftM } = useGameActions({ notify: vi.fn(), onHarvest: vi.fn(), onAnswered: vi.fn() });
    return <FriendGifts friends={friends} onGift={(id) => giftM.mutate(id)} />;
  }
  const mount = async (friends: Friend[] = FRIENDS) => {
    const r = render(<Host friends={friends} />);
    mounted.push(r);
    await flush(2);
    return r.container;
  };
  const giftBtns = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLButtonElement>('button'));
  const tapTogether = (...els: HTMLElement[]) =>
    act(async () => {
      for (const el of els) el.click();
    });
  afterEach(() => {
    mounted.forEach((m) => m.unmount());
    mounted = [];
  });

  it('hai bạn cùng đang bay: cả hai nút aria-busy và aria-disabled (không chỉ bạn bấm sau cùng), bạn còn lại rảnh; không nút nào disabled', async () => {
    const f1 = deferred<unknown>();
    const f3 = deferred<unknown>();
    api.giftWater.mockImplementation((_http: unknown, id: string) => (id === 'f1' ? f1.promise : f3.promise));
    const c = await mount();
    const [a, b, done] = giftBtns(c);
    await tapTogether(a!, b!);
    await flush(2);
    for (const el of [a!, b!]) {
      expect(el.getAttribute('aria-busy')).toBe('true');
      expect(el.getAttribute('aria-disabled')).toBe('true');
      expect(el.disabled).toBe(false);
    }
    expect(done!.getAttribute('aria-busy')).toBeNull();
    await tapTogether(a!, b!);
    expect(api.giftWater).toHaveBeenCalledTimes(2);
    await act(async () => f1.resolve({ amount: 5, recipientId: 'f1' }));
    await flush(4);
    expect(a!.getAttribute('aria-busy')).toBeNull();
    expect(b!.getAttribute('aria-busy')).toBe('true');
    await act(async () => f3.resolve({ amount: 5, recipientId: 'f3' }));
    await flush(4);
    expect(b!.getAttribute('aria-busy')).toBeNull();
  });

  it('"Đã tặng hôm nay": không disabled (nút đang giữ focus không rớt về body khi danh sách đổi), aria-disabled, chạm không gọi API', async () => {
    const c = await mount();
    const done = giftBtns(c).find((b) => b.textContent === 'Đã tặng hôm nay')!;
    expect(done.disabled).toBe(false);
    expect(done.getAttribute('aria-disabled')).toBe('true');
    done.focus();
    expect(document.activeElement).toBe(done);
    click(done);
    await flush(2);
    expect(api.giftWater).not.toHaveBeenCalled();
  });

  it('bạn chưa được tặng hôm nay: nút rảnh, không aria-disabled', async () => {
    const c = await mount();
    const idle = giftBtns(c)[0]!;
    expect(idle.textContent).toBe('Tặng 💧');
    expect(idle.getAttribute('aria-disabled')).toBeNull();
    expect(idle.getAttribute('aria-busy')).toBeNull();
  });
});
