// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { makeGiftRedemption, makeRewardCatalog } from '@/components/loyalty/reward-fixtures';

// Khoá của "Xác nhận đổi" và "Dùng ngay" trong khung kết quả của Kho quà (Mini: rewards.tsx): nút đang giữ focus không `disabled` thật,
// không đóng khung khi POST còn bay, lỗi cũng giữ khoá tới khi danh sách quà làm mới về.

const state = vi.hoisted(() => ({
  rewards: null as object | null,
  calls: [] as { method: string; path: string; headers?: Record<string, string> }[],
  redeem: null as null | (() => Promise<unknown>),
  rewardsGate: null as Promise<void> | null,
  keySeq: 0,
  push: vi.fn(),
  cartGate: null as Promise<void> | null,
  applied: [] as string[],
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: state.push }), usePathname: () => '/' }));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getCart: async () => {
    if (state.cartGate) await state.cartGate;
    return { itemCount: 2, couponCode: null };
  },
  applyCoupon: async (code: string) => {
    state.applied.push(code);
    return { couponCode: code, discount: 0, freeship: true };
  },
}));
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
const rewardGets = () => state.calls.filter((c) => c.method === 'get' && c.path === '/me/loyalty/rewards');
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
const twice = async (el: HTMLElement) => {
  act(() => {
    el.click();
    el.click();
  });
  await flush(2);
};
const press = (key: string) =>
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });

beforeEach(() => {
  state.rewards = makeRewardCatalog();
  state.calls = [];
  state.keySeq = 0;
  state.redeem = async () => VOUCHER_RESULT();
  state.rewardsGate = null;
  state.cartGate = null;
  state.applied = [];
  state.push.mockReset();
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('/kho-qua — "Xác nhận đổi" giữ focus, khung không đóng khi POST còn bay', () => {
  it('chạm đúp cùng khung hình chỉ POST một lần; nút báo aria-busy + aria-disabled, KHÔNG disabled, vẫn giữ focus', async () => {
    state.redeem = () => new Promise(() => {});
    const c = await mount();
    await openConfirm(c, 'Miễn phí vận chuyển');
    const btn = confirmBtn();
    btn.focus();
    await twice(btn);
    expect(postsOf(REDEEM_FREESHIP)).toHaveLength(1);
    expect(btn.getAttribute('aria-busy')).toBe('true');
    expect(btn.getAttribute('aria-disabled')).toBe('true');
    expect(btn.hasAttribute('disabled')).toBe(false);
    expect(document.activeElement).toBe(btn);
  });

  it('POST còn bay: Huỷ tắt, X, Esc, nền không đóng khung; POST xong thì khung kết quả hiện', async () => {
    let resolve!: (v: unknown) => void;
    state.redeem = () => new Promise((r) => (resolve = r));
    const c = await mount();
    await openConfirm(c, 'Miễn phí vận chuyển');
    click(confirmBtn());
    await flush(2);
    const cancel = byText(dialog()!, 'button', 'Huỷ') as HTMLButtonElement;
    expect(cancel.disabled).toBe(true);
    click(cancel);
    press('Escape');
    click(document.querySelector<HTMLElement>('[data-sheet-backdrop]'));
    await flush(2);
    expect(dialog()!.textContent).toContain('Xác nhận đổi quà');
    expect(dialog()!.querySelector('button[aria-label="Đóng"]')).toBeNull();
    await act(async () => resolve(VOUCHER_RESULT()));
    await flush(6);
    expect(dialog()!.textContent).toContain('Đổi quà thành công');
    expect(postsOf(REDEEM_FREESHIP)).toHaveLength(1);
  });

  it('POST xong (lỗi): khung đóng được lại ngay, không đợi làm mới danh sách', async () => {
    state.redeem = () => Promise.reject(new Error('Quà này đã hết'));
    const c = await mount();
    await openConfirm(c, 'Miễn phí vận chuyển');
    let release!: () => void;
    state.rewardsGate = new Promise<void>((r) => (release = r));
    click(confirmBtn());
    await flush(4);
    expect(dialog()!.querySelector('[role="alert"]')?.textContent).toBe('Quà này đã hết');
    expect((byText(dialog()!, 'button', 'Huỷ') as HTMLButtonElement).disabled).toBe(false);
    release();
    await flush(4);
  });

  it('lỗi: khoá giữ tới khi danh sách quà làm mới về; chạm "Xác nhận đổi" lúc đó không POST lần hai, về rồi mới gửi lại CÙNG khoá', async () => {
    state.redeem = vi.fn().mockRejectedValueOnce(new Error('Mất mạng')).mockResolvedValue(VOUCHER_RESULT('X'));
    const c = await mount();
    await openConfirm(c, 'Miễn phí vận chuyển');
    const getsBefore = rewardGets().length;
    let release!: () => void;
    state.rewardsGate = new Promise<void>((r) => (release = r));
    const btn = confirmBtn();
    btn.focus();
    click(btn);
    await flush(4);
    expect(postsOf(REDEEM_FREESHIP)).toHaveLength(1);
    expect(rewardGets().length).toBe(getsBefore + 1);
    expect(dialog()!.querySelector('[role="alert"]')?.textContent).toBe('Mất mạng');
    expect(btn.getAttribute('aria-busy')).toBe('true');
    await twice(btn);
    expect(postsOf(REDEEM_FREESHIP)).toHaveLength(1);
    expect(document.activeElement).toBe(btn);
    state.rewardsGate = null;
    release();
    await flush(6);
    expect(btn.hasAttribute('aria-busy')).toBe(false);
    click(btn);
    await flush(6);
    expect(postsOf(REDEEM_FREESHIP).map((p) => p.headers?.['Idempotency-Key'])).toEqual(['key-2', 'key-2']);
  });

  it('thành công: khoá giữ tới khi danh sách quà làm mới về, rồi mới thấy khung kết quả', async () => {
    const c = await mount();
    await openConfirm(c, 'Miễn phí vận chuyển');
    let release!: () => void;
    state.rewardsGate = new Promise<void>((r) => (release = r));
    const btn = confirmBtn();
    click(btn);
    await flush(4);
    expect(btn.getAttribute('aria-busy')).toBe('true');
    expect(dialog()!.textContent).toContain('Xác nhận đổi quà');
    await twice(btn);
    expect(postsOf(REDEEM_FREESHIP)).toHaveLength(1);
    state.rewardsGate = null;
    release();
    await flush(6);
    expect(dialog()!.textContent).toContain('Đổi quà thành công');
    expect(postsOf(REDEEM_FREESHIP)).toHaveLength(1);
  });
});

describe('/kho-qua — "Dùng ngay" trong khung kết quả báo bận', () => {
  it('đang chờ giỏ: nút aria-busy + aria-disabled (không disabled, giữ focus), chạm đúp chỉ áp mã một lần', async () => {
    const c = await mount();
    await openConfirm(c, 'Miễn phí vận chuyển');
    click(confirmBtn());
    await flush(6);
    let release!: () => void;
    state.cartGate = new Promise<void>((r) => (release = r));
    const use = byText(dialog()!, 'button', 'Dùng ngay') as HTMLButtonElement;
    expect(use.hasAttribute('aria-busy')).toBe(false);
    use.focus();
    await twice(use);
    expect(use.getAttribute('aria-busy')).toBe('true');
    expect(use.getAttribute('aria-disabled')).toBe('true');
    expect(use.hasAttribute('disabled')).toBe(false);
    expect(document.activeElement).toBe(use);
    expect(state.applied).toEqual([]);
    state.cartGate = null;
    release();
    await flush(6);
    expect(state.applied).toEqual(['FREESHIP-ABC']);
    expect(state.push).toHaveBeenCalledTimes(1);
  });
});
