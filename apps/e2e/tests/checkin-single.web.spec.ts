import { expect, test } from './support/mock-api';
import { SETUPS } from './support/tour-setups';
import { mockTourWorld, tourUser } from './support/tour-world';

/**
 * Web khách, bản của checkin-single.miniapp.spec.ts: điểm danh chỉ có nút ở Vườn Xanh (/vuon-xanh). Đăng nhập, hôm nay chưa điểm danh,
 * đi qua Vườn Xanh, Điểm Xanh (/tai-khoan/diem-xanh) và Ưu đãi (/uu-dai): tổng số nút hành động điểm danh đang hiện là 1 và nằm ở Vườn Xanh;
 * hai màn kia chỉ có dòng trạng thái "Hôm nay bạn chưa điểm danh" mở Vườn Xanh. Chạy cả khổ máy tính lẫn khổ điện thoại.
 */

// Mọi nhãn nút làm việc điểm danh (loyalty-copy, game-newbie, game-more-copy, daily-check-in-guest-copy). Neo đầu chuỗi để dòng trạng thái
// ("Hôm nay bạn chưa điểm danh …") không bị tính là nút.
const CHECK_IN_ACTION = /^(Điểm danh|Đã điểm danh|Nhận Điểm Xanh hôm nay)/;
const STATUS_TODO = 'Hôm nay bạn chưa điểm danh';

const SCREENS = [
  { path: '/vuon-xanh', ready: (page: import('@playwright/test').Page) => page.getByRole('button', { name: CHECK_IN_ACTION }).first() },
  { path: '/tai-khoan/diem-xanh', ready: (page: import('@playwright/test').Page) => page.getByRole('region', { name: STATUS_TODO }) },
  { path: '/uu-dai', ready: (page: import('@playwright/test').Page) => page.getByRole('region', { name: STATUS_TODO }) },
] as const;

test('điểm danh chỉ có nút ở Vườn Xanh: /vuon-xanh, /tai-khoan/diem-xanh, /uu-dai cộng lại đúng 1 nút', async ({ page, api }, testInfo) => {
  test.skip(!['Web Customer', 'Web Customer Mobile'].includes(testInfo.project.name), 'chỉ cần một project máy tính và một project điện thoại');
  await page.addInitScript(() => {
    try {
      localStorage.setItem('tubu_web_session', '1');
      localStorage.setItem('tubu_garden_hint_seen', '1');
    } catch {
      // không có localStorage: màn vẫn dựng
    }
  });
  mockTourWorld(api, tourUser());
  SETUPS['/game']!(api);
  SETUPS['/offers']!(api);
  api.get('/me/daily-check-in', { checkedInToday: false, pointsDone: false, waterDone: false, streakDays: 2, currentCycleDay: 3, todayPoints: 3, todayWater: 10, rewards: [] });
  api.allowUnmocked('GET /auth/me', 'GET /game/season-pass');

  const found: Record<string, number> = {};
  for (const screen of SCREENS) {
    await page.goto(screen.path);
    await expect(screen.ready(page)).toBeVisible({ timeout: 15_000 });
    found[screen.path] = await page.getByRole('button', { name: CHECK_IN_ACTION }).filter({ visible: true }).count();
    if (screen.path !== '/vuon-xanh') await expect(page.getByRole('region', { name: STATUS_TODO })).toBeVisible();
  }

  expect(found).toEqual({ '/vuon-xanh': 1, '/tai-khoan/diem-xanh': 0, '/uu-dai': 0 });
});
