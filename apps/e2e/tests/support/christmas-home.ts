import { mkdirSync } from 'fs';
import path from 'path';
import type { Page } from '@playwright/test';
import type { CheckInResult, CheckInStatusResponse } from '../../../miniapp/src/services/account-api';
import { publicConfig, type MockApi } from './mock-api';

/** Ngày giữa lịch quà 14–25/12 (giờ VN): ô 14/12 đã mở, 15/12 lỡ, 16/12 hôm nay, 17–25/12 khoá. Đồng hồ trang cố định ở đây (`page.clock.setFixedTime`). */
export const XMAS_NOW = new Date('2026-12-16T10:00:00+07:00');

const status = (claimed: boolean): CheckInStatusResponse => ({
  checkedInToday: claimed,
  streakDays: claimed ? 1 : 0,
  currentCycleDay: 1,
  streakDay: 1,
  todayPoints: claimed ? 0 : 1000,
  todayWater: claimed ? 0 : 10,
  pointsDone: claimed,
  waterDone: claimed,
  rewards: [1, 2, 3, 4, 5, 6, 7].map((day) => ({ day, points: day * 1000, claimed: claimed && day === 1, isToday: day === 1 })),
  checkInDays: claimed ? ['2026-12-14', '2026-12-16'] : ['2026-12-14'],
});

const RESULT: CheckInResult = {
  points: { success: true, cycleDay: 1, streakDays: 1, pointsEarned: 1000, totalPoints: 1000, message: 'Đã nhận 1.000 Điểm Xanh' },
  water: { seedsEarned: 10, streakDays: 1, totalSeeds: 10, streakFrozeUsed: false, bonusNote: '' },
  alreadyDone: false,
  pending: [],
};

/**
 * Bật mùa Noel Xanh cho Trang chủ (cấu hình công khai `seasonalTheme: 'christmas'`) và điểm danh hôm nay chưa mở; POST mở quà đổi trạng thái sang đã mở.
 * Đăng ký SAU mock phiên/Trang chủ của spec (đăng ký sau thắng). Trả số lần POST để spec kiểm "mở một lần".
 */
export function mockChristmasHome(api: MockApi): { posts: () => number } {
  let claimed = false;
  let posts = 0;
  api.get('/config/public', publicConfig({ seasonalTheme: 'christmas' }));
  api.get('/me/daily-check-in', () => status(claimed));
  api.post('/me/daily-check-in', () => {
    posts += 1;
    claimed = true;
    return RESULT;
  });
  return { posts: () => posts };
}

/** Ảnh chụp cho báo cáo wave: chỉ ghi khi có `XMAS_SHOTS_DIR` (không làm chậm lượt e2e thường). */
export async function xmasShot(page: Page, name: string): Promise<void> {
  const dir = process.env.XMAS_SHOTS_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `${name}.png`) });
}
