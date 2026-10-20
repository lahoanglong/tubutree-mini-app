// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { headingProblems, smallTouchTargets, unnamedControls } from '@/test-utils/a11y';

// mv-order: hub tài khoản giống Mini App ở điện thoại. Gốc: chép ý profile-hub.spec.tsx, profile-brand-owner.spec.tsx và profile.spec.ts (Mini App): thẻ đầu, ba số dư, menu theo nhóm,
// mục theo vai trò/cờ, đại lý và chủ nhãn đổi theo dữ liệu, mã giới thiệu có nút chép. Mục trỏ route pending bị ẩn.

const mocks = vi.hoisted(() => ({
  auth: {
    user: { id: 'u1', fullName: 'Nguyễn An', avatarUrl: null as string | null, role: 'CUSTOMER', referralCode: 'AN1', pointsBalance: 0, pointsConvertedBalance: 0, walletBalance: 0 } as Record<string, unknown>,
    status: 'authenticated',
    initialized: true,
    sessionUnavailable: false,
    logout: vi.fn(),
    retrySession: vi.fn(),
  },
  routes: {} as Record<string, () => unknown>,
  calls: [] as string[],
  notReady: new Set<string>(),
  meName: 'Nguyễn An' as string | null,
}));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => mocks.auth }));
vi.mock('@/lib/route-map', () => ({ isWebRouteReady: (p: string) => !mocks.notReady.has(p) }));
vi.mock('@/lib/core-http', () => ({
  coreHttp: {
    get: async (path: string) => {
      mocks.calls.push(path);
      const h = mocks.routes[path];
      if (!h) throw new Error(`no route ${path}`);
      return h();
    },
  },
}));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  getMe: async () => ({ fullName: mocks.meName, phone: '0912345678', pointsBalance: 1800, pointsConvertedBalance: 0, walletBalance: 50000 }),
  fetchOrdersPage: async () => ({ data: [], meta: { page: 1, limit: 20, total: 0 } }),
}));

import AccountPage from './page';
import { ApiError } from '@/lib/client-api';

const defaults = (): Record<string, () => unknown> => ({
  '/me/loyalty': () => ({ tier: { name: 'Hạt Giống' }, pointsBalance: 1800, pointsConvertedBalance: 0 }),
  '/me/coupons': () => [{ id: 'c1' }, { id: 'c2' }],
  '/me/notifications': () => [{ id: 'n1', status: 'SENT' }, { id: 'n2', status: 'READ' }, { id: 'n3', status: 'FAILED' }],
  '/config/public': () => ({ aiAdvisorEnabled: false, loyalty: { marketplaceClaimEnabled: false } }),
  '/brand/owner/me': () => {
    throw new ApiError('Không tìm thấy', 404);
  },
  '/dealer/me': () => ({ status: 'NONE', isDealer: false }),
});

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<AccountPage />);
  mounted.push(r);
  await flush(8);
  return r.container;
};
const link = (c: HTMLElement, href: string) => c.querySelector<HTMLAnchorElement>(`a[href="${href}"]`);
const headings2 = (c: HTMLElement) => Array.from(c.querySelectorAll('h2')).map((h) => h.textContent);

beforeEach(() => {
  mocks.auth.user = { id: 'u1', fullName: 'Nguyễn An', avatarUrl: null, role: 'CUSTOMER', referralCode: 'AN1', pointsBalance: 0, pointsConvertedBalance: 0, walletBalance: 0 };
  mocks.auth.logout.mockReset();
  mocks.routes = defaults();
  mocks.calls = [];
  mocks.notReady = new Set();
  mocks.meName = 'Nguyễn An';
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
});

describe('hub /tai-khoan như Mini App (điện thoại)', () => {
  it('h1 chỉ cho trình đọc màn hình; không có dòng "← Trang chủ"; không dải tiêu đề', async () => {
    const c = await mount();
    expect(c.querySelector('h1')!.className).toContain('max-md:sr-only');
    expect(c.querySelector('main')!.hasAttribute('data-page-bleed')).toBe(true);
    const back = Array.from(c.querySelectorAll('a')).find((a) => a.textContent?.includes('Trang chủ'))!;
    expect(back.closest('.max-md\\:hidden')).not.toBeNull();
  });

  it('dải xanh chuyển màu tràn ngang ôm hồ sơ và mã giới thiệu; ba ô số liệu là thẻ trắng nổi đè mép dưới', async () => {
    const c = await mount();
    const hero = c.querySelector('section[aria-label="Thông tin tài khoản"]')!;
    expect(hero.className).toContain('max-md:bg-transparent');
    const band = hero.firstElementChild as HTMLElement;
    expect(band.className).toContain('max-md:bg-[linear-gradient(');
    const tiles = Array.from(hero.querySelectorAll('a')).filter((a) => /Điểm Xanh|Ví Tubu|Mã giảm giá/.test(a.textContent ?? ''));
    expect(tiles).toHaveLength(3);
    for (const t of tiles) {
      expect(t.className).toContain('max-md:bg-[var(--color-bg-surface)]');
      expect(t.className).toContain('max-md:text-center');
    }
    expect(tiles[0]!.parentElement!.className).toContain('max-md:-mt-5');
    expect(tiles[2]!.className).toContain('col-span-2');
  });

  it('khối "Đơn hàng của tôi" ẩn ở điện thoại (Mini App không có)', async () => {
    const c = await mount();
    const h = Array.from(c.querySelectorAll('h2')).find((e) => e.textContent?.includes('Đơn hàng của tôi'))!;
    expect(h.closest('div.max-md\\:hidden')).not.toBeNull();
  });
});
