// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { makeGiftRedemption, makeRewardCatalog } from '@/components/loyalty/reward-fixtures';

// Mini App rewards.spec.tsx (W100A): điểm đã trừ nên kết quả phải hiện ngay cả khi làm mới danh sách quà treo (chờ có hạn 4 giây, không chờ vô hạn),
// và sau lỗi thì khoá nút nhả đúng ở hạn đó chứ không giữ mãi.

const state = vi.hoisted(() => ({
  rewards: null as object | null,
  calls: [] as { method: string; path: string; headers?: Record<string, string> }[],
  redeem: null as null | (() => Promise<unknown>),
  rewardsGate: null as Promise<void> | null,
  keySeq: 0,
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/' }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => 'authenticated' }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ retrySession: vi.fn() }) }));
vi.mock('@/lib/idempotency-key', () => ({ newIdempotencyKey: () => `key-${++state.keySeq}` }));
vi.mock('@/lib/core-http', () => ({
  coreHttp: {
    get: async (path: string) => {
      state.calls.push({ method: 'get', path });
      if (path === '/me/loyalty/rewards') {
        if (state.rewardsGate) await state.rewardsGate;
        return state.rewards;
      }
      if (path === '/me/loyalty') return { pointsBalance: 30_000, pointsConvertedBalance: 5000, lockedPoints: 0, redeemablePoints: 30_000 };
      throw new Error(`chưa mock ${path}`);
    },
    post: async (path: string, _body?: unknown, opts?: { headers?: Record<string, string> }) => {
      state.calls.push({ method: 'post', path, headers: opts?.headers });
      return state.redeem!();
    },
  },
}));

import RewardsPage from './page';

const VOUCHER_RESULT = (code = 'FREESHIP-ABC') => ({
  success: true,
  message: 'ok',
  pointsSpent: 20_000,
  remainingPoints: 10_000,
  redemption: makeGiftRedemption({ giftKind: 'VOUCHER', status: 'FULFILLED', code: null, couponCode: code }),
  coupon: { code, type: 'FREESHIP', value: 0, minOrder: 99000, maxDiscount: null, endAt: '2026-11-16T16:59:59.000Z' },
});

const REDEEM_FREESHIP = '/me/loyalty/rewards/reward-freeship/redeem';
let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<RewardsPage />);
  mounted.push(r);
  await flush(8);
  return r.container;
};
const postsOf = (path: string) => state.calls.filter((c) => c.method === 'post' && c.path === path);
const card = (c: HTMLElement, name: string) => {
  const el = Array.from(c.querySelectorAll<HTMLElement>('[data-reward]')).find((x) => x.textContent?.includes(name));
  if (!el) throw new Error(`không thấy thẻ ${name}`);
  return el;
};
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const openConfirm = async (c: HTMLElement, name: string) => {
  click(byText(card(c, name), 'button', 'Đổi'));
  await flush(3);
};
const confirmBtn = () => byText(dialog()!, 'button', 'Xác nhận đổi') as HTMLButtonElement;
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
  state.rewards = makeRewardCatalog();
  state.calls = [];
  state.keySeq = 0;
  state.redeem = async () => VOUCHER_RESULT();
  state.rewardsGate = null;
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('/kho-qua — làm mới danh sách quà treo thì kết quả vẫn hiện sau 4 giây', () => {
  it('thành công: khung kết quả chưa hiện ở 3,9 giây (còn chờ dữ liệu), hiện ở 4 giây dù danh sách chưa về', async () => {
    const c = await mount();
    await openConfirm(c, 'Miễn phí vận chuyển');
    state.rewardsGate = new Promise<void>(() => undefined);
    click(confirmBtn());
    await flush(4);
    expect(dialog()!.textContent).toContain('Xác nhận đổi quà');
    await advance(3_900);
    expect(dialog()!.textContent).toContain('Xác nhận đổi quà');
    expect(dialog()!.textContent).not.toContain('Đổi quà thành công');
    await advance(200);
    await flush(4);
    expect(dialog()!.textContent).toContain('Đổi quà thành công');
    expect(postsOf(REDEEM_FREESHIP)).toHaveLength(1);
  });

  it('lỗi: lời lỗi hiện ngay, nút giữ khoá tới 4 giây rồi nhả dù danh sách chưa về; bấm lại gửi CÙNG khoá', async () => {
    state.redeem = vi.fn().mockRejectedValueOnce(new Error('Mất mạng')).mockResolvedValue(VOUCHER_RESULT('X'));
    const c = await mount();
    await openConfirm(c, 'Miễn phí vận chuyển');
    state.rewardsGate = new Promise<void>(() => undefined);
    const btn = confirmBtn();
    click(btn);
    await flush(4);
    expect(dialog()!.querySelector('[role="alert"]')?.textContent).toBe('Mất mạng');
    expect(btn.getAttribute('aria-busy')).toBe('true');
    await advance(3_900);
    click(btn);
    await flush(2);
    expect(postsOf(REDEEM_FREESHIP)).toHaveLength(1);
    await advance(200);
    await flush(4);
    expect(btn.hasAttribute('aria-busy')).toBe(false);
    state.rewardsGate = null;
    click(btn);
    await flush(6);
    expect(postsOf(REDEEM_FREESHIP).map((p) => p.headers?.['Idempotency-Key'])).toEqual(['key-2', 'key-2']);
  });
});
