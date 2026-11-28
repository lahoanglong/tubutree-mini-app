import { test, expect, type MockApi } from './support/mock-api';
import type { NoelEconomyPeriod, NoelMetricsDTO } from '@tubutree/shared-types';

/**
 * Admin: tab "Noel" (chỉ khi `theme.seasonal` = christmas). Mock mọi lệnh gọi /api/ nên KHÔNG cần API/DB.
 * Mở thẳng `/admin?tab=noel`; ảnh chụp 375px và 1280px nằm ở test-results (hoặc đường dẫn NOEL_SHOT_DIR).
 */

const ADMIN_LOGIN = {
  accessToken: 'mock-admin-access-token',
  refreshToken: 'mock-admin-refresh-token',
  user: { id: 'admin-1', role: 'ADMIN', fullName: 'Test Admin', avatarUrl: null, pointsBalance: 0, walletBalance: 0, referralCode: 'ADMIN1' },
};

function mockAdminSession(api: MockApi) {
  api.post('/auth/refresh', ADMIN_LOGIN);
  api.get('/cart', { items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 0, itemCount: 0 });
}

const tap = (users: number, taps: number) => ({ users, taps });
const period = (over: Partial<NoelEconomyPeriod>): NoelEconomyPeriod => ({
  fromDayKey: '2026-12-14',
  toDayKey: '2026-12-20',
  miniUsers: 0,
  miniRewardedRounds: 0,
  miniWater: 0,
  miniPoints: 0,
  maxUserWaterInDay: 0,
  maxUserPointsInDay: 0,
  maxGlobalPointsInDay: 0,
  arcadeRewardedRuns: 0,
  arcadeWater: 0,
  ...over,
});
const DAYS = ['2026-12-14', '2026-12-15', '2026-12-16', '2026-12-17', '2026-12-18', '2026-12-19', '2026-12-20'];
const SLOTS = ['star', 'lights', 'baubles', 'gifts', 'reindeer', 'wreath'];

const SNAPSHOT: NoelMetricsDTO = {
  generatedAt: '2026-12-20T03:00:00.000Z',
  days: 7,
  seasonalTheme: 'christmas',
  fromDayKey: '2026-12-14',
  toDayKey: '2026-12-20',
  claims: { users: 40, claims: 140, perDay: DAYS.map((dayKey, i) => ({ dayKey, count: 10 + i * 5 })), reachedStreak3: 18, reachedStreak7: 4 },
  advent: {
    year: 2026,
    phase: 'during',
    daysElapsed: 7,
    requiredDays: 6,
    opensByDay: Array.from({ length: 12 }, (_, i) => ({ day: i + 1, dayKey: `2026-12-${14 + i}`, users: i < 7 ? 30 - i : 0 })),
    openedAny: 40,
    completed: 8,
    completionPct: 20,
  },
  ornaments: SLOTS.map((slot, i) => ({ slot, unlock: tap(i + 1, i + 1), hang: tap(i, i * 2), remove: tap(i > 2 ? 1 : 0, i > 2 ? 2 : 0) })),
  share: tap(12, 20),
  snow: { on: tap(5, 6), off: tap(4, 18), offSharePct: 75 },
  games: [
    { game: 'dew_catcher', kind: 'arcade', plays: 120, users: 45, avgScore: 412.3, avgOutOf: null, rewardedPlays: 90, water: 450, points: 90 },
    { game: 'refill_rush', kind: 'arcade', plays: 36, users: 20, avgScore: 180, avgOutOf: null, rewardedPlays: 30, water: 150, points: 30 },
    { game: 'eco_merge', kind: 'mini', plays: 30, users: 20, avgScore: 4.3, avgOutOf: 8, rewardedPlays: 25, water: 125, points: 25 },
    { game: 'green_conveyor', kind: 'mini', plays: 22, users: 15, avgScore: 6, avgOutOf: 8, rewardedPlays: 18, water: 90, points: 18 },
    { game: 'daily_quiz', kind: 'mini', plays: 60, users: 40, avgScore: 2.5, avgOutOf: 3, rewardedPlays: 40, water: 200, points: 40 },
  ],
  economy: {
    caps: { miniWaterPerUserDay: 40, miniPointsPerUserDay: 100, miniGlobalPointsPerDay: 200_000 },
    current: period({ miniUsers: 30, miniRewardedRounds: 83, miniWater: 415, miniPoints: 83, maxUserWaterInDay: 40, maxUserPointsInDay: 60, maxGlobalPointsInDay: 900, arcadeRewardedRuns: 120, arcadeWater: 600 }),
    previous: period({ fromDayKey: '2026-12-07', toDayKey: '2026-12-13', miniUsers: 28, miniRewardedRounds: 76, miniWater: 380, miniPoints: 76, maxUserWaterInDay: 40, maxUserPointsInDay: 50, maxGlobalPointsInDay: 600, arcadeRewardedRuns: 100, arcadeWater: 500 }),
  },
  retention: {
    cohortFromDayKey: '2026-12-12',
    cohortToDayKey: '2026-12-18',
    noel: { userDays: 100, returned: 60, ratePct: 60 },
    other: { userDays: 400, returned: 120, ratePct: 30 },
  },
};

const shotPath = (name: string) => `${process.env.NOEL_SHOT_DIR ?? 'test-results'}/${name}`;

test.describe('Admin: tab Noel', () => {
  test.beforeEach(async ({ page, api }) => {
    mockAdminSession(api);
    await page.addInitScript(() => {
      window.localStorage.setItem('tubu_web_session', '1');
    });
    api.get('/admin/customer-refunds', { data: [], meta: { page: 1, limit: 1, total: 0 } });
    api.get('/admin/config', [{ key: 'theme.seasonal', value: 'christmas', description: 'Giao diện mùa', category: 'theme' }]);
    api.get('/admin/analytics/noel', SNAPSHOT);
  });

  test('1280px: đủ khối, số theo giờ Việt Nam; đổi 14 ngày gọi lại API', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/admin?tab=noel');

    await expect(page.getByRole('heading', { name: 'Noel Xanh', level: 2 })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('navigation', { name: 'Mục quản trị' }).getByRole('button', { name: 'Noel' })).toBeVisible();
    const summary = page.getByLabel('Tóm tắt Noel');
    await expect(summary).toContainText('140 lượt · TB 20/ngày');
    await expect(summary).toContainText('8/40 khách');
    await expect(summary).toContainText('75%');
    await expect(page.getByRole('region', { name: 'Game trong Sảnh', exact: true })).toContainText('Hứng Giọt Sương');
    await expect(page.getByRole('region', { name: 'Thưởng game đã phát' })).toContainText('Chưa thấy thưởng game vượt trần');
    await expect(page.getByRole('region', { name: 'Quay lại hôm sau (D+1)' })).toContainText('Chênh lệch: +30 điểm phần trăm.');
    await expect(page.getByText('Cập nhật lúc 10:00')).toBeVisible();
    await page.screenshot({ path: shotPath('noel-1280.png'), fullPage: true });

    const requestPromise = page.waitForRequest((r) => r.url().includes('/admin/analytics/noel') && r.url().includes('days=14'));
    await page.getByRole('button', { name: '14 ngày' }).click();
    await requestPromise;
  });

  test('375px: không tràn ngang cả trang; nút chạm đủ 44px; bảng game cuộn trong khung riêng', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto('/admin?tab=noel');
    await expect(page.getByRole('heading', { name: 'Noel Xanh', level: 2 })).toBeVisible({ timeout: 15_000 });

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);

    const heights = await page
      .getByRole('group', { name: 'Khoảng thời gian' })
      .getByRole('button')
      .evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
    expect(heights).toHaveLength(3);
    for (const h of heights) expect(h).toBeGreaterThanOrEqual(44);

    await page.screenshot({ path: shotPath('noel-375.png'), fullPage: true });
  });

  test('mùa Noel tắt: menu không có Noel, ?tab=noel rơi về tab đầu và không hiện tab Noel', async ({ page, api }) => {
    api.get('/admin/config', []);
    // Rơi về tab đầu (Hôm nay): các lời gọi của tab đó không thuộc phạm vi ca này.
    api.allowUnmocked('GET /admin/dashboard/today', 'GET /admin/analytics/retention-daily');
    const noelCalls: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/admin/analytics/noel')) noelCalls.push(r.url());
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/admin?tab=noel');
    await expect(page.getByRole('navigation', { name: 'Mục quản trị' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('navigation', { name: 'Mục quản trị' }).getByRole('button', { name: 'Noel', exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Noel Xanh', level: 2 })).toHaveCount(0);
    expect(noelCalls).toEqual([]);
  });
});
