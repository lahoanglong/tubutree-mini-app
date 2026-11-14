// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, flush, render, type Rendered } from '@/test-utils/dom';

// Tab Đổi quà tải lười (React.lazy): module Kho quà chỉ được nạp khi khách mở tab, không nằm trong gói của tab gốc. Một file riêng vì lazy ghi nhớ kết quả
// theo từng lần nạp module trang, nên chỉ ca đầu tiên của một file đo được "chưa nạp".
const state = vi.hoisted(() => ({ search: '', listeners: new Set<() => void>(), loads: 0 }));

vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => 'guest' }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: null, retrySession: vi.fn() }) }));
vi.mock('@/lib/use-coupon-use', () => ({ useCouponUse: () => ({ copy: vi.fn(), use: vi.fn(), notice: null, cancel: vi.fn(), usingCode: null }) }));
vi.mock('next/navigation', async () => {
  const { useSyncExternalStore } = await import('react');
  const subscribe = (l: () => void) => {
    state.listeners.add(l);
    return () => state.listeners.delete(l);
  };
  return {
    useRouter: () => ({
      push: vi.fn(),
      replace: (href: string) => {
        state.search = href.split('?')[1] ?? '';
        state.listeners.forEach((l) => l());
      },
    }),
    useSearchParams: () => new URLSearchParams(useSyncExternalStore(subscribe, () => state.search, () => state.search)),
    usePathname: () => '/uu-dai',
  };
});
vi.mock('@/components/rewards/rewards-view', async () => {
  const { createElement } = await import('react');
  state.loads += 1;
  return { RewardsView: () => createElement('div', { 'data-testid': 'rewards-view' }, 'Kho quà') };
});
vi.mock('@/lib/core-http', () => ({
  coreHttp: { get: async (path: string) => (path === '/config/public' ? { waste: { enabled: false } } : []), post: async () => ({}) },
}));

import OffersPage from './page';

let mounted: Rendered | null = null;
beforeEach(() => {
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('/uu-dai — tab Đổi quà nạp lười', () => {
  it('mở Săn mã và Mã của tôi không nạp module Kho quà; mở Đổi quà thì nạp đúng một lần, quay lại không nạp thêm', async () => {
    mounted = render(<OffersPage />);
    await flush(8);
    const c = mounted.container;
    const open = async (label: string) => {
      click(Array.from(c.querySelectorAll<HTMLElement>('[role="tab"]')).find((t) => t.textContent === label)!);
      await flush(8);
    };
    expect(state.loads).toBe(0);
    await open('Mã của tôi');
    expect(state.loads).toBe(0);
    expect(c.querySelector('[data-testid="rewards-view"]')).toBeNull();
    await open('Đổi quà');
    expect(state.loads).toBe(1);
    expect(c.querySelector('[data-testid="rewards-view"]')).not.toBeNull();
    await open('Săn mã');
    await open('Đổi quà');
    expect(state.loads).toBe(1);
  });
});
