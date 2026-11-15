import { mkdirSync } from 'fs';
import path from 'path';
import { expect, test, mockSession } from './support/mock-api';
import { tourEntries } from './support/tour';
import { mockTourWorld, tourUser } from './support/tour-world';

/**
 * W166: dải "Nhịp Sống Xanh 7 Ngày" ở đầu Vườn Xanh, đo ở 375x812: cao ≤ 52px, đúng một hàng 7 ô cho cả trang, không tràn ngang,
 * và nút chính của ngày (tưới/điểm danh) vẫn nằm trong màn đầu. `W166_SHOTS` (thư mục) thì chụp thêm ảnh khung đầu.
 */
const VIEW = { width: 375, height: 812 };
const BOTTOM_NAV = 76;

test.use({ viewport: VIEW });

test('Vườn Xanh 375x812: dải Nhịp Sống Xanh cao ≤ 52px, một hàng 7 ô, nút chính còn trong màn đầu', async ({ page, api }) => {
  const entry = tourEntries().find((e) => e.key === '/game')!;
  const user = tourUser(entry.role);
  mockSession(api, user);
  mockTourWorld(api, user);
  entry.setup?.(api);
  // Đã chơi một ván mini game hôm nay: ô hôm nay của dải phải đầy dù hồ sơ chưa điểm danh.
  api.get('/game/arcade/status', {
    games: { dew_catcher: { bestScore: 220, plays: 1, used: 1, cap: 3 }, refill_rush: { bestScore: 0, plays: 0, used: 0, cap: 3 } },
    window: null, windowBonus: false, nextWindowAt: null, quizClaimed: false,
  });
  await page.addInitScript(() => window.localStorage.setItem('tubu_garden_hint_seen', '1'));
  await page.goto(entry.miniapp);

  const strip = page.getByTestId('week-rhythm');
  await expect(strip).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('week-rhythm')).toHaveCount(1);
  await expect(strip.getByRole('listitem')).toHaveCount(7);

  const box = (await strip.boundingBox())!;
  expect(box.height).toBeLessThanOrEqual(52);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(VIEW.width);

  await expect(strip.locator('[data-today="true"]')).toHaveAttribute('data-state', 'done');

  // Bảy ô trên MỘT hàng ngang: cùng y, không xuống dòng.
  const tops = await strip.getByRole('listitem').evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
  expect(new Set(tops).size).toBe(1);

  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(VIEW.width);

  // Thẻ Điểm danh không còn hàng 7 ô thứ hai; câu thưởng ngày 3/7 vẫn còn đúng một lần.
  await expect(page.getByTestId('streak-cell')).toHaveCount(0);
  await expect(page.getByText(/Thưởng thêm ngày 3/)).toHaveCount(1);

  // Nút chính của ngày vẫn trong màn đầu (không bị dải đẩy xuống dưới thanh đáy).
  const primary = page.getByRole('button', { name: /Nhận nước hôm nay|Tưới/ }).first();
  await expect(primary).toBeVisible();
  const p = (await primary.boundingBox())!;
  expect(p.y + p.height).toBeLessThanOrEqual(VIEW.height - BOTTOM_NAV);

  const shots = process.env.W166_SHOTS;
  if (shots) {
    mkdirSync(shots, { recursive: true });
    await page.screenshot({ path: path.join(shots, 'game-375.png'), scale: 'css' });
  }
});
