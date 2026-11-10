// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { makeGiftRedemption } from '@/components/loyalty/reward-fixtures';

// "Quà của tôi" (Mini: rewards-mine.tsx): "Dùng ngay" dùng MỘT khoá cho cả ví mã (hook ở thân trang, không mỗi hàng một khoá), "Thử lại" trả refetch.

const state = vi.hoisted(() => ({
  mine: [] as object[],
  error: null as Error | null,
  gate: null as Promise<void> | null,
  calls: [] as string[],
  push: vi.fn(),
  cartGate: null as Promise<void> | null,
  applied: [] as string[],
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: state.push }),
  useSearchParams: () => new URLSearchParams(''),
  usePathname: () => '/kho-qua/cua-toi',
}));
vi.mock('@/components/ui/qr-code', () => ({ QrCode: ({ value }: { value: string }) => <div data-testid="qr">{value}</div> }));
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
vi.mock('@/lib/core-http', () => ({
  coreHttp: {
    get: async (path: string) => {
      state.calls.push(path);
      if (path === '/me/loyalty/rewards/mine') {
        if (state.gate) await state.gate;
        if (state.error) throw state.error;
        return state.mine;
      }
      throw new Error(`chưa mock ${path}`);
    },
  },
}));

import RewardsMinePage from './page';

let mounted: Rendered[] = [];
const voucher = (id: string, code: string, name: string) =>
  makeGiftRedemption({ id, giftKind: 'VOUCHER', giftName: name, status: 'FULFILLED', code: null, couponCode: code, claimPoint: null, couponEndAt: '2099-12-31T10:00:00.000Z', couponUsed: false });
const entry = (c: HTMLElement, name: string) => {
  const el = Array.from(c.querySelectorAll<HTMLElement>('[data-redemption]')).find((x) => x.textContent?.includes(name));
  if (!el) throw new Error(`không thấy ${name}`);
  return el.querySelector('button') as HTMLButtonElement;
};

beforeEach(() => {
  state.mine = [voucher('r1', 'FREESHIP-ABC', 'Miễn phí vận chuyển'), voucher('r2', 'GIAM10-XYZ', 'Giảm 10 nghìn')];
  state.error = null;
  state.gate = null;
  state.calls = [];
  state.push.mockReset();
  state.cartGate = null;
  state.applied = [];
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  document.body.innerHTML = '';
});

describe('/kho-qua/cua-toi — "Dùng ngay" một khoá cho cả ví', () => {
  it('chạm hai hàng khác nhau liền nhau: chỉ mã đầu được áp, một lần chuyển trang; hàng đang chạy aria-busy giữ focus, hàng kia tắt', async () => {
    const r = render(<RewardsMinePage />);
    mounted.push(r);
    await flush(8);
    let release!: () => void;
    state.cartGate = new Promise<void>((res) => (release = res));
    const a = entry(r.container, 'Miễn phí vận chuyển');
    const b = entry(r.container, 'Giảm 10 nghìn');
    a.focus();
    act(() => {
      a.click();
      b.click();
    });
    await flush(2);
    expect(state.applied).toEqual([]);
    expect(a.getAttribute('aria-busy')).toBe('true');
    expect(a.getAttribute('aria-disabled')).toBe('true');
    expect(a.hasAttribute('disabled')).toBe(false);
    expect(document.activeElement).toBe(a);
    expect(b.disabled).toBe(true);
    expect(b.hasAttribute('aria-busy')).toBe(false);
    state.cartGate = null;
    release();
    await flush(6);
    expect(state.applied).toEqual(['FREESHIP-ABC']);
    expect(state.push).toHaveBeenCalledTimes(1);
    expect(a.hasAttribute('aria-busy')).toBe(false);
    expect(b.disabled).toBe(false);
  });
});

describe('/kho-qua/cua-toi — "Thử lại" khi chưa có dữ liệu', () => {
  // Chỉ màn chưa có dữ liệu mới hiện "Thử lại" (đã có danh sách mà tải lại nền lỗi thì giữ danh sách, xem page.spec.tsx). Khoá chạm đúp của nút nằm ở
  // components/ui/error-state.tsx (usePressLock, spec riêng ở error-state.spec.tsx); truy vấn chưa có dữ liệu dùng chung lượt tải đang bay nên đếm lời gọi API
  // không phân biệt được có khoá hay không. Test này chỉ kiểm màn lỗi biến mất và danh sách hiện khi tải lại được.
  it('danh sách chưa từng tải được: bấm "Thử lại" thì tải lại một lần, màn lỗi biến mất và danh sách hiện', async () => {
    state.error = new Error('Mạng lỗi');
    const r = render(<RewardsMinePage />);
    mounted.push(r);
    await flush(8);
    const retry = byText(r.container, 'button', 'Thử lại') as HTMLButtonElement;
    expect(retry).not.toBeNull();
    const before = state.calls.filter((p) => p === '/me/loyalty/rewards/mine').length;
    state.error = null;
    click(retry);
    await flush(6);
    expect(state.calls.filter((p) => p === '/me/loyalty/rewards/mine').length).toBe(before + 1);
    expect(byText(r.container, 'button', 'Thử lại')).toBeNull();
    expect(r.container.textContent).toContain('Miễn phí vận chuyển');
  });
});
