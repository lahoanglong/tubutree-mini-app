// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@/test-utils/render-hook';

const mocks = vi.hoisted(() => ({ userId: 'u1', coupons: [] as Array<{ code: string; endAt: string }> }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: { id: mocks.userId } }) }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => 'authenticated' }));
vi.mock('@/lib/core-http', () => ({
  coreHttp: {
    get: async (path: string) => (path.includes('check-in') ? { canCheckInToday: false, checkedInToday: true } : mocks.coupons),
  },
}));

import { useMarkExpiringSeen, useOffersDot } from './use-offers-dot';

const DAY = 86_400_000;
const soon = (code: string, days: number) => ({ code, endAt: new Date(Date.now() + days * DAY).toISOString() });

function both(coupons: ReadonlyArray<{ code: string; endAt: string }>) {
  return renderHook(() => {
    useMarkExpiringSeen(coupons as never);
    return useOffersDot(true);
  });
}

describe('chấm đỏ Ưu đãi theo tài khoản (web)', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.userId = 'u1';
    mocks.coupons = [];
  });

  it('mã sắp hết hạn: chấm sáng, mở trang Ưu đãi (đánh dấu đã xem) thì tắt', async () => {
    mocks.coupons = [soon('A', 2)];
    const dot = renderHook(() => useOffersDot(true));
    await waitFor(() => expect(dot.result.current).not.toBeNull());
    const seen = both(mocks.coupons);
    await waitFor(() => expect(seen.result.current).toBeNull());
  });

  it('mã được gia hạn (endAt đổi) và vẫn sắp hết hạn: chấm sáng lại', async () => {
    mocks.coupons = [soon('A', 2)];
    const first = both(mocks.coupons);
    await waitFor(() => expect(first.result.current).toBeNull());
    mocks.coupons = [soon('A', 1)];
    const again = renderHook(() => useOffersDot(true));
    await waitFor(() => expect(again.result.current).not.toBeNull());
  });

  it('đổi tài khoản trên cùng máy: mã tài khoản trước đã xem không tắt chấm của tài khoản sau', async () => {
    mocks.coupons = [soon('A', 2)];
    const first = both(mocks.coupons);
    await waitFor(() => expect(first.result.current).toBeNull());
    mocks.userId = 'u2';
    const other = renderHook(() => useOffersDot(true));
    await waitFor(() => expect(other.result.current).not.toBeNull());
  });
});
