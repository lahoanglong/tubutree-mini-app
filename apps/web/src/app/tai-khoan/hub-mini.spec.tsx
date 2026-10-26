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
  it('h1 chỉ cho trình đọc màn hình; không có dòng "← Trang chủ" ở điện thoại; không dải tiêu đề', async () => {
    const c = await mount();
    expect(c.querySelector('h1')!.className).toContain('sr-only');
    expect(c.querySelector('main')!.hasAttribute('data-page-bleed')).toBe(false);
    const back = Array.from(c.querySelectorAll('a')).find((a) => a.textContent?.includes('Trang chủ'))!;
    expect(back.closest('.max-md\\:hidden')).not.toBeNull();
  });

  it('dải xanh chuyển màu tràn ngang ôm hồ sơ; ba ô số liệu là thẻ trắng nổi đè mép dưới', async () => {
    const c = await mount();
    const head = c.querySelector<HTMLAnchorElement>('a[href="/tai-khoan/ho-so"]')!;
    const band = head.parentElement as HTMLElement;
    expect(band.className).toContain('bg-[linear-gradient(');
    const tiles = Array.from(c.querySelectorAll('a')).filter((a) => /^(Điểm Xanh|Ví Tubu|Mã giảm giá):/.test(a.getAttribute('aria-label') ?? ''));
    expect(tiles).toHaveLength(3);
    for (const t of tiles) {
      expect(t.className).toContain('bg-[var(--color-bg-surface)]');
      expect(t.className).toContain('text-center');
    }
    expect(tiles[0]!.parentElement!.className).toContain('-mt-5');
    expect(tiles[0]!.parentElement!.className).toContain('grid-cols-3');
  });

  it('hàng trạng thái đơn có năm ô ở điện thoại và khối "Đơn hàng của tôi" có ô tìm chỉ từ md', async () => {
    const c = await mount();
    const row = c.querySelector('section[aria-label="Đơn của tôi"]')!;
    expect(row.querySelectorAll('a.tubu-press').length).toBe(6);
    expect(row.querySelector('.grid-cols-5')!.children).toHaveLength(5);
  });

  it('khối "Đơn hàng của tôi" ẩn ở điện thoại (Mini App không có)', async () => {
    const c = await mount();
    const h = Array.from(c.querySelectorAll('h2')).find((e) => e.textContent?.includes('Đơn hàng của tôi'))!;
    expect(h.closest('div.max-md\\:hidden')).not.toBeNull();
  });
});
