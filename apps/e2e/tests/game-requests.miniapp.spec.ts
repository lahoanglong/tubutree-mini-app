import { test, expect, makeUser, mockSession } from './support/mock-api';
import { mockNewbieGame } from './support/game-newbie-states';

/** Số lần gọi máy chủ khi mở trang game (B-80). Tab Vườn chỉ tải khi mở. */
test('mở /game: tối đa 5 lần gọi API, tab Vườn tải khi mở', async ({ page, api }) => {
  mockSession(api, makeUser({ id: 'u-newbie', fullName: 'Khách mới', pointsBalance: 0 }));
  mockNewbieGame(api, 'new');
  await page.goto('/game');
  await expect(page.getByRole('tab', { name: 'Hôm nay' })).toBeVisible({ timeout: 15_000 });
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(800);
  const opened = api.calls.map((c) => `${c.method} ${c.path}`);
  console.log(`GAME_CALLS_OPEN ${opened.length}\n${opened.join('\n')}`);
  expect(opened.length).toBeLessThanOrEqual(5);
  const before = opened.length;
  await page.getByRole('tab', { name: 'Vườn' }).click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);
  const all = api.calls.map((c) => `${c.method} ${c.path}`);
  console.log(`GAME_CALLS_GARDEN_TAB +${all.length - before}\n${all.slice(before).join('\n')}`);
});
