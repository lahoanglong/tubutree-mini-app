import { mkdirSync } from 'fs';
import path from 'path';
import { test, expect, reply, replyEmptyBody } from './support/mock-api';
import { installVisualMode, settle } from './support/visual';
import { mockNewbieGame, newbieProfile } from './support/game-newbie-states';

/** Chụp /vuon-xanh ở 375x812 cho đợt G3; cặp của visual-g3.game.miniapp.spec.ts (thêm màn trống của tab Cộng đồng, chỉ có trên web). */
const OUT = process.env.GAME_SHOTS_DIR;
const USER = {
  id: 'u-newbie', fullName: 'Khách mới', referralCode: 'AN123', phone: '0912345678', role: 'CUSTOMER',
  pointsBalance: 20000, pointsConvertedBalance: 0, walletBalance: 0,
};
const ORDER_WATER = { perOrder: 100, weeklyCap: 300, weeklyGranted: 100 };
const FIRST_OPEN = { ...ORDER_WATER, claimedNow: 200 };

async function setup(page: import('@playwright/test').Page, api: import('./support/mock-api').MockApi) {
  await installVisualMode(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.addInitScript(() => {
    try {
      localStorage.setItem('tubu_web_session', '1');
    } catch {
      // không có localStorage: màn vẫn dựng
    }
  });
  api.post('/auth/refresh', () => ({ accessToken: 'e2e-token', user: USER }));
  api.get('/me', () => USER);
  api.get('/config/public', { freeshipThreshold: 500000, waste: { enabled: false, dropoff: false, mailin: false, pickup: false } });
  mockNewbieGame(api, 'after-checkin');
  api.get('/me/loyalty', { pointsBalance: 20000, redeemablePoints: 20000, redeemableTotal: 20000, tier: null, nextTier: null, tiers: [] });
  mkdirSync(path.join(OUT!, 'web'), { recursive: true });
}
const shot = (page: import('@playwright/test').Page, name: string, fullPage = true) => page.screenshot({ path: path.join(OUT!, 'web', `${name}.png`), fullPage });

test('chụp g3 Hôm nay có nước từ đơn hàng (web)', async ({ page, api }) => {
  test.skip(!OUT, 'đặt GAME_SHOTS_DIR để chụp');
  await setup(page, api);
  api.get('/game/profile', { ...newbieProfile('after-checkin'), totalSeeds: 65, orderWater: ORDER_WATER });
  await page.goto('/vuon-xanh');
  await expect(page.getByTestId('order-water-progress')).toBeVisible({ timeout: 15_000 });
  await settle(page);
  await shot(page, 'g3-today');
});

test('chụp g3 hộp thu hoạch có mã và loài mới (web)', async ({ page, api }) => {
  test.skip(!OUT, 'đặt GAME_SHOTS_DIR để chụp');
  await setup(page, api);
  api.get('/game/profile', { ...newbieProfile('after-checkin'), totalSeeds: 65, orderWater: ORDER_WATER });
  api.post('/game/tree/water', () => ({
    progress: 60, target: 60, harvested: true, treesPlanted: 1,
    reward: { coupon: 'XANH-123', coupons: ['XANH-123'], couponTerms: [{ code: 'XANH-123', value: 20000, minOrder: 150000, expiresAt: '2026-12-31T16:59:59.000Z' }], species: { id: 's', name: 'Sao đen', emoji: '🌴', rarity: 'RARE', ecoFact: 'Sống hàng trăm năm.' } },
  }));
  await page.goto('/vuon-xanh');
  await page.getByRole('button', { name: 'Tưới hết (65💧)' }).click({ timeout: 15_000 });
  await expect(page.getByText('Thu hoạch thành công!')).toBeVisible();
  await settle(page);
  await shot(page, 'g3-harvest-coupon', false);
});

test('chụp g3 hồ sơ cũ 400/60 thu hoạch ngay (web)', async ({ page, api }) => {
  test.skip(!OUT, 'đặt GAME_SHOTS_DIR để chụp');
  await setup(page, api);
  api.get('/game/profile', { ...newbieProfile('after-checkin'), totalSeeds: 20, harvestReady: true, ecoImpact: { progress: 60, target: 60, treeType: 'Cây Dứa Fuwa3e', treesPlanted: 0 } });
  await page.goto('/vuon-xanh');
  await expect(page.getByRole('button', { name: 'Thu hoạch cây' })).toBeVisible({ timeout: 15_000 });
  await settle(page);
  await shot(page, 'g3-old-profile', false);
});

test('chụp g3 tab Cộng đồng khi chưa có mùa và bảng trống (web)', async ({ page, api }) => {
  test.skip(!OUT, 'đặt GAME_SHOTS_DIR để chụp');
  await setup(page, api);
  api.get('/game/profile', { ...newbieProfile('after-checkin'), totalSeeds: 65 });
  await page.goto('/vuon-xanh?tab=community');
  await expect(page.getByTestId('leaderboard-empty')).toBeVisible({ timeout: 15_000 });
  await settle(page);
  await shot(page, 'g3-community-empty');
});

test('chụp g3 mở game lần đầu có nước từ đơn hàng (web)', async ({ page, api }) => {
  test.skip(!OUT, 'đặt GAME_SHOTS_DIR để chụp');
  await setup(page, api);
  api.get('/game/profile', { ...newbieProfile('after-checkin'), totalSeeds: 200, orderWater: { ...FIRST_OPEN, weeklyGranted: 200 } });
  await page.goto('/vuon-xanh');
  await expect(page.getByTestId('order-water-claimed')).toBeVisible({ timeout: 15_000 });
  await settle(page);
  await shot(page, 'g3-first-open');
});

test('chụp g3 bể vượt sức chứa nhờ nước đơn hàng (web)', async ({ page, api }) => {
  test.skip(!OUT, 'đặt GAME_SHOTS_DIR để chụp');
  await setup(page, api);
  api.get('/game/profile', { ...newbieProfile('after-checkin'), totalSeeds: 1050, tankCapacity: 1000, orderWater: ORDER_WATER });
  await page.goto('/vuon-xanh');
  await expect(page.getByTestId('tank-over')).toBeVisible({ timeout: 15_000 });
  await settle(page);
  await shot(page, 'g3-tank-over', false);
});

test('chụp g3 chưa có mùa, thân rỗng từ server (web)', async ({ page, api }) => {
  test.skip(!OUT, 'đặt GAME_SHOTS_DIR để chụp');
  await setup(page, api);
  api.get('/game/profile', { ...newbieProfile('after-checkin'), totalSeeds: 65 });
  api.get('/game/season', () => replyEmptyBody());
  await page.goto('/vuon-xanh?tab=community');
  await expect(page.getByTestId('season-empty')).toBeVisible({ timeout: 15_000 });
  await settle(page);
  await shot(page, 'g3-season-empty', false);
});

test('chụp g3 thẻ nước từ đơn hàng (web)', async ({ page, api }) => {
  test.skip(!OUT, 'đặt GAME_SHOTS_DIR để chụp');
  await setup(page, api);
  api.get('/game/profile', { ...newbieProfile('after-checkin'), totalSeeds: 65, orderWater: ORDER_WATER });
  await page.goto('/vuon-xanh');
  const card = page.getByTestId('order-water-progress').locator('xpath=ancestor::*[self::div or self::section][2]');
  await expect(page.getByTestId('order-water-progress')).toBeVisible({ timeout: 15_000 });
  await card.scrollIntoViewIfNeeded();
  await settle(page);
  await page.screenshot({ path: path.join(OUT!, 'web', 'g3-order-card.png'), clip: (await card.boundingBox()) ?? undefined });
});

test('chụp g3 màn lỗi tải có nút Thử lại (web)', async ({ page, api }) => {
  test.skip(!OUT, 'đặt GAME_SHOTS_DIR để chụp');
  await setup(page, api);
  api.get('/game/profile', { ...newbieProfile('after-checkin'), totalSeeds: 65 });
  api.get('/game/leaderboard', () => reply(500, { message: 'lỗi' }));
  await page.goto('/vuon-xanh?tab=community');
  await expect(page.getByText(/Chưa tải được bảng xếp hạng/)).toBeVisible({ timeout: 15_000 });
  await settle(page);
  await shot(page, 'g3-load-error', false);
});
