import { test, expect, makeUser, mockSession } from './support/mock-api';
import { mockNewbieGame } from './support/game-newbie-states';

/**
 * Số lần gọi máy chủ khi mở trang game (B-80). Trước khi sửa: 10 lần của game (16 tính cả vỏ app). Nay tab Vườn chỉ tải khi
 * mở; lần gọi của vỏ app (phiên, cấu hình, giỏ, số đơn…) không thuộc trang game nên không tính vào trần.
 */
const GAME_OWNED = /^GET \/(game\/|me\/loyalty$|me\/daily-check-in$)/;

test('mở /game: tối đa 5 lần gọi API của game, tab Vườn tải khi mở', async ({ page, api }) => {
  mockSession(api, makeUser({ id: 'u-newbie', fullName: 'Khách mới', pointsBalance: 0 }));
  mockNewbieGame(api, 'new');
  await page.goto('/game');
  await expect(page.getByRole('tab', { name: 'Hôm nay' })).toBeVisible({ timeout: 15_000 });
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(800);
  const opened = api.calls.map((c) => `${c.method} ${c.path}`);
  console.log(`GAME_CALLS_OPEN ${opened.length}\n${opened.join('\n')}`);
  expect(opened.filter((c) => GAME_OWNED.test(c))).toHaveLength(5);
  expect(opened.some((c) => /game\/(garden|forest|collection|community|season)/.test(c))).toBe(false);
  const before = opened.length;
  await page.getByRole('tab', { name: 'Vườn' }).click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);
  const all = api.calls.map((c) => `${c.method} ${c.path}`);
  console.log(`GAME_CALLS_GARDEN_TAB +${all.length - before}\n${all.slice(before).join('\n')}`);
  expect(all.slice(before).filter((c) => /game\/(garden|forest|collection|community|season)/.test(c)).length).toBeGreaterThanOrEqual(4);
});
