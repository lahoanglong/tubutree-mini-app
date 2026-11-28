import { test, expect, makeUser, mockSession } from './support/mock-api';
import { mockNewbieGame } from './support/game-newbie-states';

/**
 * Số lần gọi máy chủ khi mở trang game (B-80). Trước khi sửa: 10 lần của game (16 tính cả vỏ app). Nay tab Vườn chỉ tải khi
 * mở; lần gọi của vỏ app (phiên, cấu hình, giỏ, số đơn…) không thuộc trang game nên không tính vào trần.
 * Sảnh mini game (W164) thêm đúng một lần GET /game/arcade/status cho khách thật: 5 → 6.
 * "Chơi hôm nay" (game mini) thêm một lần GET /game/mini/today để biết cờ game.mini.enabled (cấu hình công khai không có cờ này): 6 → 7.
 * Phần Hôm nay của thẻ Nhiệm vụ (nhiệm vụ hằng ngày) thêm một lần GET /game/daily, dùng chung với chấm nhắc ở thanh đáy: 7 → 8.
 */
const GAME_OWNED = /^GET \/(game\/|me\/loyalty$|me\/daily-check-in$)/;

test('mở /game: tối đa 8 lần gọi API của game, tab Khu vườn tải khi mở', async ({ page, api }) => {
  mockSession(api, makeUser({ id: 'u-newbie', fullName: 'Khách mới', pointsBalance: 0 }));
  mockNewbieGame(api, 'new');
  await page.goto('/game');
  await expect(page.getByRole('tab', { name: 'Chăm vườn' })).toBeVisible({ timeout: 15_000 });
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(800);
  const opened = api.calls.map((c) => `${c.method} ${c.path}`);
  console.log(`GAME_CALLS_OPEN ${opened.length}\n${opened.join('\n')}`);
  expect(opened.filter((c) => GAME_OWNED.test(c))).toHaveLength(8);
  expect(opened.filter((c) => c === 'GET /game/daily')).toHaveLength(1);
  expect(opened.some((c) => /game\/(garden|forest|collection|community|season)/.test(c))).toBe(false);
  const before = opened.length;
  await page.getByRole('tab', { name: 'Khu vườn' }).click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);
  const all = api.calls.map((c) => `${c.method} ${c.path}`);
  console.log(`GAME_CALLS_GARDEN_TAB +${all.length - before}\n${all.slice(before).join('\n')}`);
  expect(all.slice(before).filter((c) => /game\/(garden|forest|collection|community|season)/.test(c)).length).toBeGreaterThanOrEqual(4);
});
