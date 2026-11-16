// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { makeRewardCatalog, makeRewardItem } from '@/components/loyalty/reward-fixtures';

// RewardsView là thân Kho quà dùng chung cho /kho-qua và tab Đổi quà của /uu-dai: tự đọc phiên, KHÔNG mang theo khung trang (không h1, không main),
// để nhúng vào trang khác không sinh thêm tiêu đề. Logic đổi quà có spec riêng ở app/kho-qua (page, redeem-locks, redeem-settle).
const state = vi.hoisted(() => ({
  phase: 'authenticated' as string,
  rewards: null as object | null,
  preview: null as object | null,
  calls: [] as string[],
  pathname: '/uu-dai',
  search: '',
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => state.pathname,
  useSearchParams: () => new URLSearchParams(state.search),
}));
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
  state.pathname = '/uu-dai';
  state.search = '';
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

  it('khách ở tab Đổi quà của hub Ưu đãi: nút Đăng nhập mang returnTo=/uu-dai?tab=rewards để đăng nhập xong quay về đúng hub', async () => {
    state.phase = 'guest';
    state.pathname = '/uu-dai';
    state.search = 'tab=rewards';
    const c = await mount();
    const login = c.querySelector<HTMLAnchorElement>('a[href^="/dang-nhap"]');
    expect(login?.getAttribute('href')).toBe(`/dang-nhap?returnTo=${encodeURIComponent('/uu-dai?tab=rewards')}`);
  });

  it('khách ở /kho-qua độc lập (không query): returnTo vẫn là /kho-qua', async () => {
    state.phase = 'guest';
    state.pathname = '/kho-qua';
    state.search = '';
    const c = await mount();
    const login = c.querySelector<HTMLAnchorElement>('a[href^="/dang-nhap"]');
    expect(login?.getAttribute('href')).toBe('/dang-nhap?returnTo=%2Fkho-qua');
  });

  it('W179-C: phoneVerified=false hiện đúng 1 thẻ thông báo mở Zalo Mini App ở tab quà vật lý (1 nút), khoá nút Đổi trên thẻ quà vật lý', async () => {
    const base = makeRewardCatalog();
    state.rewards = {
      ...base,
      phoneVerified: false,
      rewards: base.rewards.map((r) => (r.kind === 'SEED_PACK' || r.kind === 'GIFT' ? { ...r, canRedeem: false } : r)),
    };
    const c = await mount();
    expect(c.querySelector('[data-testid="rewards-phone-verify-banner"]')).toBeNull();
    expect((byText(c, 'button', 'Đổi') as HTMLButtonElement).disabled).toBe(false);

    click(byText(c, '[role="tab"]', 'Cây và hạt')!);
    await flush(2);
    const banner = c.querySelector<HTMLElement>('[data-testid="rewards-phone-verify-banner"]');
    expect(banner?.textContent).toContain('Xác minh số điện thoại qua Zalo để đổi quà hiện vật');
    expect(banner?.querySelector<HTMLAnchorElement>('a[href*="zalo.me/s/"]')?.textContent).toBe('Mở Zalo Mini App để xác minh');
    const seedCard = Array.from(c.querySelectorAll<HTMLElement>('[data-reward]')).find((el) => el.textContent?.includes('Gói hạt giống Tubu'))!;
    expect((byText(seedCard, 'button', 'Đổi') as HTMLButtonElement).disabled).toBe(true);
  });
});
