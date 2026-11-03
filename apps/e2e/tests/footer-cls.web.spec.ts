import { test, expect, type MockApi } from './support/mock-api';

const USER = {
  id: 'u-fcls', fullName: 'Nguyễn Văn An', referralCode: 'AN123', phone: '0912345678', role: 'CUSTOMER',
  pointsBalance: 1681, pointsConvertedBalance: 119, walletBalance: 0,
};
const CLS_MAX = 0.1;

const notif = (n: number) => ({ id: `n${n}`, templateCode: 'x', payload: {}, status: 'SENT', sentAt: new Date(Date.now() - n * 3_600_000).toISOString() });
const tiers = ['Mầm Xanh', 'Lộc Biếc', 'Cổ Thụ', 'Rừng Xanh'].map((name, i) => ({ id: `t${i + 1}`, name, minPoints: i * 200, minSpending: i * 4_000_000, multiplier: 1 + i * 0.1, perks: ['Quà sinh nhật', 'Freeship đơn từ 99k', 'Ưu tiên chăm sóc'] }));
const wasteMe = {
  programmeEnabled: true, eligibility: 'OK', blocked: false, shipLockedAt: null,
  laneFlags: { dropoff: true, mailin: true, pickup: false }, parcelLimits: { maxWeightKg: 10, maxEdgeCm: 60 },
  balance: { pointsBalance: 9000, pointsConvertedBalance: 5000, redeemablePoints: 14000 },
  monthUsage: { capMonthKey: '2026-10', pointsUsed: 0, pointsCap: 200000 }, impactGrams: 1940,
  thresholds: { mailinMinPoints: 15000, pickupMinPoints: 10000, maxOpenRequests: 3 },
  items: [{ id: 'item-carton', code: 'CARTON', name: 'Thùng carton', unitLabel: 'thùng', unitsPerPoint: 1, pointsPerGroup: 1000, dropsPerUnit: 0, dailyCapQty: 10, monthlyCapQty: 20, status: 'ACTIVE', prepInstructions: 'Gấp phẳng', imageUrl: null, gramsPerUnit: null, hazardous: false, sortOrder: 1, monthRemainingQty: 20, dayRemainingQty: 10 }],
  openRequests: [], deskPoints: [],
};

interface Route { name: string; fixme?: string; path: string; hold: string; mock: (api: MockApi) => void }
const ROUTES: Route[] = [
  {
    name: 'thong-bao', path: '/tai-khoan/thong-bao', hold: '/me/notifications',
    mock: (api) => { api.get('/me/notifications', () => Array.from({ length: 12 }, (_, i) => notif(i))); },
  },
  {
    name: 'diem-xanh', path: '/tai-khoan/diem-xanh', hold: '/me/loyalty',
    mock: (api) => {
      api.get('/me/loyalty', {
        pointsBalance: 1681, pointsConvertedBalance: 119,
        tier: { id: 't1', name: 'Mầm Xanh', multiplier: 1, perks: ['Quà sinh nhật'] },
        nextTier: { id: 't2', name: 'Lộc Biếc', minPoints: 200, minSpending: 4_000_000, pointsToGo: 120, spendingToGo: 2_500_000 },
        tiers, spent12m: 1_500_000, tierPoints: 80, rates: { earnPct: 2, vndPerPoint: 50, vndPerPointRedeem: 1000, maxRedeemPct: 0.5 },
      });
      api.get('/waste/requests', []);
      api.get('/me/coupons', []);
      api.get('/me/points/transactions', []);
      api.get('/me/daily-check-in', { checkedInToday: false, streakDays: 2, currentCycleDay: 3, todayPoints: 3, todayWater: 10, rewards: [1, 2, 3, 4, 5, 6, 7].map((day) => ({ day, points: day, claimed: day < 3, isToday: day === 3 })) });
      api.get('/me/loyalty/member-card', { memberCode: 'TUBUAN123', name: 'An', phone: null, tierName: 'Mầm Xanh', tierMultiplier: 1, pointsBalance: 1681, posCreditEnabled: true });
    },
  },
  {
    name: 'doi-rac', fixme: 'recycle-home.tsx (vùng waste của phiên db): khung chờ <main> chưa có aria-busy, chờ db thêm; bỏ fixme khi xong', path: '/doi-rac', hold: '/waste/me',
    mock: (api) => {
      api.get('/waste/me', wasteMe);
      api.get('/waste/requests', []);
      api.get('/me/loyalty/rewards', { pointsBalance: 9000, pointsConvertedBalance: 5000, lockedPoints: 0, redeemablePoints: 14000, giftClaimDays: 60, claimPoint: null, rewards: [] });
    },
  },
];

/** Web 375, khách đã đăng nhập, API chính của trang về muộn: chân trang gọn không được hiện dưới khung chờ rồi bị đẩy đi khi dữ liệu về (HIEUNANG-04). */
for (const r of ROUTES) {
  test(`CLS ${r.path} 375: khung chờ về muộn`, async ({ page, api }) => {
    test.fixme(!!r.fixme, r.fixme);
    await page.setViewportSize({ width: 375, height: 812 });
    let release!: () => void;
    const hold = new Promise<void>((resolve) => { release = resolve; });
    await page.context().addCookies([{ name: 'tubu_web_session', value: '1', domain: 'localhost', path: '/' }]);
    await page.addInitScript(() => {
      try { localStorage.setItem('tubu_web_session', '1'); } catch { /* không có localStorage */ }
      const w = window as unknown as { __cls: number };
      w.__cls = 0;
      new PerformanceObserver((list) => {
        for (const e of list.getEntries() as unknown as { hadRecentInput: boolean; value: number }[]) if (!e.hadRecentInput) w.__cls += e.value;
      }).observe({ type: 'layout-shift', buffered: true });
    });
    api.post('/auth/refresh', () => ({ accessToken: 'e2e-token', user: USER }));
    api.get('/me', () => USER);
    api.get('/me/notifications/unread-count', { count: 0 });
    api.get('/me/subscriptions', []);
    api.get('/me/wishlist/ids', []);
    api.get('/cart', { items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 350000, itemCount: 0 });
    api.get('/config/public', { freeshipThreshold: 500000, waste: { enabled: true, dropoff: true, mailin: true, pickup: false } });
    r.mock(api);
    // Giữ lời gọi chính: đăng ký sau cùng để ghi đè mock cùng đường dẫn bằng bản chờ.
    const real = r;
    const cap: { fn?: () => unknown } = {};
    real.mock({ get: (p: string, h: unknown) => { if (p === real.hold) cap.fn = typeof h === 'function' ? (h as () => unknown) : () => h; } } as unknown as MockApi);
    let held = false;
    api.get(r.hold, async () => { held = true; await hold; return cap.fn!(); });
    await page.goto(r.path);
    // Phiên đã xong (lời gọi chính đã bắt đầu) và khung chờ RIÊNG của trang đã hiện, không còn RouteSkeleton của bước khôi phục phiên.
    await expect.poll(() => held, { timeout: 20_000 }).toBe(true);
    await expect(page.locator('[aria-busy="true"]:not([role="status"])').first()).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[role="status"][aria-busy="true"]')).toHaveCount(0);
    const footerHidden = await page.evaluate(() => { const f = document.querySelector('footer[data-compact-footer]'); return !f || getComputedStyle(f).display === 'none'; });
    release();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(800);
    const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
    test.info().annotations.push({ type: 'CLS', description: `${cls.toFixed(4)} footerHiddenWhileLoading=${footerHidden}` });
    console.log(`CLS ${r.path} = ${cls.toFixed(4)} footerHiddenWhileLoading=${footerHidden}`);
    expect(footerHidden).toBe(true);
    expect(cls).toBeLessThan(CLS_MAX);
  });
}
