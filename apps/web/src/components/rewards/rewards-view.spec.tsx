// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, flush, render, type Rendered } from '@/test-utils/dom';
import { makeRewardCatalog, makeRewardItem } from '@/components/loyalty/reward-fixtures';

// RewardsView là thân Kho quà dùng chung cho /kho-qua và tab Đổi quà của /uu-dai: tự đọc phiên, KHÔNG mang theo khung trang (không h1, không main),
// để nhúng vào trang khác không sinh thêm tiêu đề. Logic đổi quà có spec riêng ở app/kho-qua (page, redeem-locks, redeem-settle).
const state = vi.hoisted(() => ({
  phase: 'authenticated' as string,
  rewards: null as object | null,
  preview: null as object | null,
  calls: [] as string[],
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/uu-dai' }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => state.phase }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ retrySession: vi.fn() }) }));
vi.mock('@/lib/core-http', () => ({
  coreHttp: {
    get: async (path: string) => {
      state.calls.push(path);
      if (path === '/loyalty/preview') return state.preview;
      if (path === '/me/loyalty/rewards') return state.rewards;
      if (path === '/me/loyalty') return { pointsBalance: 30_000, pointsConvertedBalance: 5000, lockedPoints: 0, redeemablePoints: 30_000 };
      throw new Error(`chưa mock ${path}`);
    },
    post: async () => ({}),
  },
}));

import { RewardsView } from './rewards-view';

let mounted: Rendered | null = null;
const mount = async () => {
  mounted = render(<RewardsView />);
  await flush(8);
  return mounted.container;
};

beforeEach(() => {
  state.phase = 'authenticated';
  state.rewards = makeRewardCatalog();
  state.preview = { rewards: [makeRewardItem({ canRedeem: false })], giftClaimDays: 60, claimPoint: null, tiers: [], rates: {}, pointExpireMonths: 12 };
  state.calls = [];
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = '';
});

describe('RewardsView (thân Kho quà dùng chung)', () => {
  it('đã đăng nhập: số dư, liên kết "Quà của tôi", thẻ quà có nút Đổi; không có h1 hay main', async () => {
    const c = await mount();
    expect(c.textContent).toContain('35.000 điểm');
    expect(c.querySelector('a[href="/kho-qua/cua-toi"]')?.textContent).toContain('Quà của tôi');
    expect(c.querySelector('[data-reward]')).not.toBeNull();
    expect(byText(c, 'button', 'Đổi')).not.toBeNull();
    expect(c.querySelector('h1')).toBeNull();
    expect(c.querySelector('main')).toBeNull();
  });

  it('khách chưa đăng nhập: xem quà và giá, không nút Đổi, chỉ gọi API xem trước', async () => {
    state.phase = 'guest';
    const c = await mount();
    expect(c.textContent).toContain('Miễn phí vận chuyển');
    expect(byText(c, 'button', 'Đổi')).toBeNull();
    expect(state.calls).toEqual(['/loyalty/preview']);
    expect(c.querySelector('h1')).toBeNull();
  });

  it('đang khôi phục phiên: khung chờ, chưa gọi API nào; phiên mất mạng: nói mất kết nối', async () => {
    state.phase = 'loading';
    let c = await mount();
    expect(state.calls).toEqual([]);
    expect(c.querySelector('[data-reward]')).toBeNull();
    mounted!.unmount();
    state.phase = 'unavailable';
    c = await mount();
    expect(c.textContent).toContain('Không kết nối được với Tubu Tree');
    expect(state.calls).toEqual([]);
  });
});
