// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClientProvider } from '@tanstack/react-query';
import { flush, render, type Rendered } from '@/test-utils/dom';
import { newTestClient } from '@/test-utils/render-hook';

// Khác home-view.spec: ở đây core-http và home-feed là bản THẬT, chỉ giả apiFetch (lớp mạng), để chứng minh HomeView bật bộ chặn
// request gộp khi mở và gỡ nó khi rời trang.
const net = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('@/lib/client-api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/client-api')>()), apiFetch: net.apiFetch }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => 'authenticated', useAuthRestoring: () => false }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: { id: 'u1', fullName: 'Lan', pointsBalance: 0 } }) }));
vi.mock('@/lib/use-flash-sales', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/use-flash-sales')>()), useActiveFlashSales: () => [] }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/route-map', () => ({ isWebRouteReady: () => true }));

import HomeView from './home-view';
import { coreHttp } from '@/lib/core-http';
import { disarmHomeFeed, resetHomeFeed } from '@/lib/home-feed';

const CONFIG = { freeshipThreshold: 350_000, subscribeDiscountPct: 0.17, affiliateWalletMultiplier: 1, cashbackHoldDays: 30, loyalty: { vndPerPoint: 20_000, vndPerPointRedeem: 1_000 } };
const CATEGORIES = [{ id: 'c-goi', parentId: null, name: 'Dầu gội', slug: 'dau-goi', image: null, sortOrder: 1, productCount: 4 }];
const card = (id: string, name: string) => ({ id, slug: id, brand: 'Tubu', name, thumbnail: null, basePrice: 50000, salePrice: null, isFeatured: true, inStock: true });
const PAGE = { data: [card('f1', 'Món nổi bật')], meta: { page: 1, limit: 6, total: 1 } };

const routes: Record<string, unknown> = {
  '/home': { publicConfig: CONFIG, categories: CATEGORIES, brands: [], flashActive: [], featured: PAGE, newest: PAGE, bestSellers: PAGE },
  '/home/me': {
    forYou: [card('f1', 'Món nổi bật')], flashUpcoming: [], activeOrderCount: { count: 0 }, wasteOpenRequestCount: 0,
    purchasedItems: { items: [], nextCursor: null }, newCustomerOffer: { isNewCustomer: true, welcomeVoucher: null }, purchasedLimit: 10,
  },
  '/me/notifications/unread-count': { count: 0 },
  '/me/subscriptions': [], '/me/loyalty': { tier: { name: 'Mầm Xanh' }, pointsBalance: 0, pointsConvertedBalance: 0 }, '/me/coupons': [],
  '/me/daily-check-in': { checkedInToday: true, streakDays: 1, currentCycleDay: 1, rewards: [] }, '/feed': { posts: [] },
  '/products': PAGE, '/products/for-you': [], '/categories': CATEGORIES, '/brands': [], '/config/public': CONFIG,
  '/flash-sales/active': [], '/flash-sales/upcoming': [],
};
const paths = () => net.apiFetch.mock.calls.map(([p]) => String(p).split('?')[0]);

let mounted: Rendered | null = null;
beforeEach(() => {
  localStorage.clear();
  disarmHomeFeed();
  net.apiFetch.mockReset().mockImplementation(async (path: string) => {
    const key = path.split('?')[0]!;
    if (!(key in routes)) throw new Error(`đường dẫn lạ ${path}`);
    return routes[key];
  });
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  disarmHomeFeed();
});

describe('HomeView + request gộp (core-http thật)', () => {
  it('mở Trang chủ: các khối dùng /home và /home/me, không gọi lẻ những khối đã có trong đó', async () => {
    mounted = render(<QueryClientProvider client={newTestClient()}><HomeView /></QueryClientProvider>);
    await flush(15);
    const p = paths();
    expect(p).toContain('/home');
    expect(p).toContain('/home/me');
    for (const dup of ['/config/public', '/flash-sales/active', '/flash-sales/upcoming', '/orders/active-count', '/me/new-customer-offer']) {
      expect(p, dup).not.toContain(dup);
    }
    expect(mounted.container.textContent).toContain('Món nổi bật');
  });

  it('rời Trang chủ: bộ chặn được gỡ, request lẻ ở trang khác đi thẳng ra mạng', async () => {
    mounted = render(<QueryClientProvider client={newTestClient()}><HomeView /></QueryClientProvider>);
    await flush(15);
    mounted.unmount();
    mounted = null;
    net.apiFetch.mockClear();
    // Nếu bộ chặn còn sống, reset trả các khối đã dùng về trạng thái chưa lấy: request kế tiếp sẽ bị chặn thay vì đi thẳng.
    resetHomeFeed();
    await coreHttp.get('/config/public');
    expect(paths()).toEqual(['/config/public']);
  });
});
