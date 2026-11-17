import { expect, test, mockSession } from './support/mock-api';
import { SETUPS } from './support/tour-setups';
import { mockTourWorld, tourUser } from './support/tour-world';

/**
 * Điểm danh chỉ ở MỘT chỗ: Vườn Xanh (/game). Khách đăng nhập, hôm nay chưa điểm danh, đi qua ba màn có nói tới điểm danh
 * (Vườn Xanh, Điểm Xanh, Ưu đãi): tổng số nút hành động điểm danh đang hiện là 1 và nằm ở Vườn Xanh; Điểm Xanh và Ưu đãi chỉ có dòng
 * trạng thái "Hôm nay bạn chưa điểm danh" mở Vườn Xanh.
 */

// Mọi nhãn nút làm việc điểm danh trên các màn (loyalty-copy, game-newbie, game-more-copy, daily-check-in-guest-copy). Neo đầu chuỗi
// để dòng trạng thái ("Hôm nay bạn chưa điểm danh …") không bị tính là nút.
const CHECK_IN_ACTION = /^(Điểm danh|Đã điểm danh|Nhận nước hôm nay|Nhận Điểm Xanh hôm nay)/;
const STATUS_TODO = 'Hôm nay bạn chưa điểm danh';

const SCREENS = [
  { path: '/game', ready: (page: import('@playwright/test').Page) => page.getByRole('button', { name: CHECK_IN_ACTION }).first() },
  { path: '/loyalty', ready: (page: import('@playwright/test').Page) => page.getByRole('region', { name: STATUS_TODO }) },
  { path: '/offers', ready: (page: import('@playwright/test').Page) => page.getByRole('region', { name: STATUS_TODO }) },
] as const;

test('điểm danh chỉ có nút ở Vườn Xanh: /game, /loyalty, /offers cộng lại đúng 1 nút', async ({ page, api }) => {
  const user = tourUser();
  mockSession(api, user);
  mockTourWorld(api, user);
  SETUPS['/game']!(api);
  SETUPS['/offers']!(api);
  api.get('/me/daily-check-in', { checkedInToday: false, pointsDone: false, waterDone: false, streakDays: 2, currentCycleDay: 3, todayPoints: 3, todayWater: 10, rewards: [] });
  api.allowUnmocked('GET /auth/me', 'GET /game/season-pass');
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('tubu_garden_hint_seen', '1');
    } catch {
      // không có localStorage: màn vẫn dựng
    }
  });

  const found: Record<string, number> = {};
  for (const screen of SCREENS) {
    await page.goto(screen.path);
    await expect(screen.ready(page)).toBeVisible({ timeout: 15_000 });
    found[screen.path] = await page.getByRole('button', { name: CHECK_IN_ACTION }).filter({ visible: true }).count();
    if (screen.path !== '/game') await expect(page.getByRole('region', { name: STATUS_TODO })).toBeVisible();
  }

  expect(found).toEqual({ '/game': 1, '/loyalty': 0, '/offers': 0 });
});
