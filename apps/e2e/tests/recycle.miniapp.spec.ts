import type { Page } from '@playwright/test';
import type { WasteDeskPointDTO, WasteRequestDetailDTO } from '@tubutree/shared-types';
import type { createWasteRequest } from '../../miniapp/src/services/waste-api';
import { test, expect, makeUser, mockSession } from './support/mock-api';
import {
  expectNoOverflow,
  mockDeskStaff,
  mockWasteCustomer,
  wasteDetail,
  wastePoint,
} from './support/waste-mocks';

/**
 * Zalo Mini App — Đổi rác lấy quà, luồng khách (apps/miniapp/src/pages/recycle*.tsx, route /recycle).
 * Mọi lời gọi /waste/* được mock ngay trong spec; mockSession không có route /waste/* nào.
 */

type CreateBody = Parameters<typeof createWasteRequest>[0];

async function toPointsStep(page: Page): Promise<void> {
  await page.goto('/recycle/new');
  const card = page.locator('[data-item]').filter({ hasText: 'Thùng carton cũ' });
  const plus = card.getByRole('button', { name: 'Tăng số lượng' });
  await expect(plus).toBeVisible({ timeout: 15_000 });
  for (let i = 0; i < 3; i++) await plus.click();
  await page.getByRole('button', { name: 'Tiếp tục' }).click();
  await page.getByRole('radio', { name: /Mang tới điểm nhận/ }).click();
  await page.getByRole('button', { name: 'Chọn điểm nhận' }).click();
  await expect(page.getByRole('searchbox', { name: 'Tìm điểm nhận' })).toBeVisible();
}

const DESK_POINT: WasteDeskPointDTO = {
  id: 'wp-q1',
  kind: 'PARTNER',
  name: 'Tạp hoá Cô Ba',
  giftHandoverEnabled: false,
  myRole: 'OWNER',
  quota: { limit: 100_000, used: 0, remaining: 100_000 },
  perkText: null,
  perkPendingText: null,
  staffDailyCapRemaining: 1_000_000,
};

test.describe('Đổi rác lấy quà — khách', () => {
  test('/refill chuyển sang /recycle', async ({ page, api }) => {
    mockSession(api, makeUser({ id: 'u-wx' }));
    mockWasteCustomer(api, { points: [wastePoint({ id: 'wp-q1' })] });
    await page.goto('/refill');
    await expect(page).toHaveURL(/\/recycle$/);
  });

  test('golden: tạo yêu cầu mang tới điểm → nhân viên xác nhận → khách thấy điểm', async ({ page, api }) => {
    const customer = makeUser({ id: 'u-wx' });
    mockSession(api, customer);
    const request: { current: WasteRequestDetailDTO } = {
      current: wasteDetail({ id: 'wr-e2e-1', code: 'TR-7K3QP', method: 'DROP_OFF', status: 'OPEN' }),
    };
    mockWasteCustomer(api, { points: [wastePoint({ id: 'wp-q1' })], requests: [request.current] });
    api.post('/waste/requests', () => request.current);
    api.get('/waste/requests/:id', () => request.current);

    await page.goto('/recycle');
    await page.getByRole('button', { name: 'Đổi rác ngay' }).click();
    await expect(page).toHaveURL(/\/recycle\/new$/);

    const card = page.locator('[data-item]').filter({ hasText: 'Thùng carton cũ' });
    for (let i = 0; i < 3; i++) await card.getByRole('button', { name: 'Tăng số lượng' }).click();
    await page.getByRole('button', { name: 'Tiếp tục' }).click();
    await page.getByRole('radio', { name: /Mang tới điểm nhận/ }).click();
    await page.getByRole('button', { name: 'Chọn điểm nhận' }).click();
    await page.getByRole('radio', { name: /Tạp hoá Cô Ba/ }).click();
    await page.getByRole('button', { name: 'Chọn điểm này' }).click();
    await expect(page.getByRole('button', { name: 'Tạo yêu cầu' })).toBeDisabled();
    await page.getByText('Tôi đồng ý cho Tubu Tree xử lý yêu cầu này').click();
    await page.getByRole('button', { name: 'Tạo yêu cầu' }).click();

    await expect(page.getByText('TR-7K3QP').first()).toBeVisible();
    const [created] = api.callsTo('POST', '/waste/requests');
    const expected: CreateBody = { method: 'DROP_OFF', lines: [{ itemId: 'wi-carton', declaredQty: 3 }], pointId: 'wp-q1', consent: true };
    expect(created?.body).toEqual(expected);
    expect(created?.headers['idempotency-key']).toMatch(/^[A-Za-z0-9_-]{8,128}$/);

    mockSession(api, makeUser({ id: 'u-staff', fullName: 'Chủ điểm Cô Ba' }));
    mockDeskStaff(api, {
      points: [DESK_POINT],
      lookup: {
        type: 'REQUEST',
        request: {
          id: 'wr-e2e-1',
          code: 'TR-7K3QP',
          method: 'DROP_OFF',
          status: 'OPEN',
          pointId: 'wp-q1',
          customerName: 'K*** E2E',
          customerPhone: '090****567',
          estimatedPoints: 3000,
          lines: [
            {
              itemId: 'wi-carton',
              itemName: 'Thùng carton cũ',
              unitLabel: 'thùng',
              unitsPerPoint: 1,
              pointsPerGroup: 1000,
              declaredQty: 3,
              receivedQty: null,
              hazardous: false,
            },
          ],
        },
      },
    });
    api.post('/waste/desk/requests/:id/confirm', () => {
      request.current = { ...request.current, status: 'COMPLETED', pointsAwarded: 3000, completedAt: '2026-10-17T06:00:00.000Z', editable: false, cancellable: false };
      return {
        requestId: 'wr-e2e-1',
        code: 'TR-7K3QP',
        status: 'COMPLETED',
        pointsAwarded: 3000,
        dropsAwarded: 0,
        quota: { limit: 100_000, used: 3000, remaining: 97_000 },
        staffDailyCapRemaining: 997_000,
      };
    });

    await page.goto('/recycle/desk');
    await page.getByRole('textbox').first().fill('TR-7K3QP');
    await page.getByRole('button', { name: 'Tra mã' }).click();
    const line = page.locator('[data-line]').filter({ hasText: 'Thùng carton cũ' });
    await expect(line).toBeVisible();
    await expect(page.getByText('Điểm Tubu sẽ cộng cho khách: 3.000 điểm')).toBeVisible();
    await page.getByRole('button', { name: 'Xác nhận đã nhận' }).click();
    await expect(page.getByText('Tubu sẽ cộng 3.000 điểm cho khách', { exact: true })).toBeVisible();
    await expect(page.getByText('Đã ghi nhận. Tubu sẽ cộng 3.000 điểm cho khách', { exact: true })).toBeVisible();
    const [confirmed] = api.callsTo('POST', '/waste/desk/requests/:id/confirm');
    expect(confirmed?.path).toBe('/waste/desk/requests/wr-e2e-1/confirm');
    expect(confirmed?.body).toEqual({ lines: [{ itemId: 'wi-carton', declaredQty: 3, receivedQty: 3 }] });

    mockSession(api, customer);
    mockWasteCustomer(api, { points: [wastePoint({ id: 'wp-q1' })], requests: [request.current] });
    api.get('/waste/requests/:id', () => request.current);
    await page.goto('/recycle/r/wr-e2e-1');
    await expect(page.getByText('Xem kết quả cộng điểm')).toBeVisible();
    await page.getByRole('button', { name: 'Xem kết quả cộng điểm' }).click();
    await expect(page.getByRole('heading', { name: 'Đã cộng 3.000 điểm' })).toBeVisible();
  });

  test('gửi về kho: nhập mã vận đơn', async ({ page, api }) => {
    mockSession(api, makeUser({ id: 'u-wx' }));
    let current = wasteDetail({ id: 'wr-mail-1', code: 'TR-M4ILX', method: 'MAIL_IN', status: 'OPEN', pointName: 'Kho Tubu TP.HCM' });
    mockWasteCustomer(api, { points: [] });
    api.get('/waste/requests/:id', () => current);
    api.on('PUT', '/waste/requests/:id/tracking', () => {
      current = { ...current, status: 'IN_TRANSIT', carrier: 'GHN', trackingCode: 'GHN123456', inTransitAt: '2026-10-17T05:00:00.000Z', editable: false };
      return current;
    });

    await page.goto('/recycle/r/wr-mail-1');
    await page.getByRole('textbox', { name: 'Hãng' }).fill('GHN');
    await page.getByRole('textbox', { name: 'Mã vận đơn' }).fill('GHN123456');
    await page.getByRole('button', { name: 'Đã gửi' }).click();

    await expect(page.getByText(/GHN123456/).first()).toBeVisible();
    const [saved] = api.callsTo('PUT', '/waste/requests/:id/tracking');
    expect(saved?.body).toEqual({ carrier: 'GHN', trackingCode: 'GHN123456' });
  });

  test('điểm hết hạn mức bị khoá', async ({ page, api }) => {
    mockSession(api, makeUser({ id: 'u-wx' }));
    mockWasteCustomer(api, {
      points: [wastePoint({ id: 'wp-q1' }), wastePoint({ id: 'wp-full', name: 'Điểm Hết Suất', quotaFull: true })],
    });
    await toPointsStep(page);

    const choose = page.getByRole('button', { name: 'Chọn điểm này' });
    await expect(page.getByText('Tạm hết hạn mức tháng này')).toBeVisible();
    const fullRadio = page.getByRole('radio', { name: /Điểm Hết Suất/ });
    await expect(fullRadio).toHaveAttribute('aria-disabled', 'true');
    await fullRadio.click({ force: true });
    await expect(fullRadio).toHaveAttribute('aria-checked', 'false');
    await expect(choose).toBeDisabled();
    await page.getByRole('radio', { name: /Tạp hoá Cô Ba/ }).click();
    await expect(choose).toBeEnabled();
  });

  test('khách từ chối quyền vị trí: không lỗi, không nhãn Gần nhất', async ({ page, api }) => {
    mockSession(api, makeUser({ id: 'u-wx' }));
    mockWasteCustomer(api, { points: [wastePoint({ id: 'wp-q1' })] });
    await toPointsStep(page);

    await page.getByRole('button', { name: 'Dùng vị trí của tôi' }).click();
    await expect(page.getByText('Gần nhất')).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Gần tôi' })).toHaveCount(0);
    await expect(page.getByRole('searchbox', { name: 'Tìm điểm nhận' })).toBeVisible();
    await expect(page.getByText('Tạp hoá Cô Ba')).toBeVisible();
    expect(api.callsTo('POST', '/waste/points/nearby')).toHaveLength(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('Home, Vườn Xanh và Cá nhân không gọi /waste/*', async ({ page, api }) => {
    mockSession(api, makeUser({ id: 'u-wx' }));
    api.get('/game/profile', {
      totalSeeds: 340,
      streakDays: 5,
      treeStage: 2,
      treeHealth: 'HEALTHY',
      streakFreezes: 1,
      lastDewAt: null,
      lastCheckInAt: null,
      ecoImpact: { progress: 40, target: 100, treeType: 'Cây Sưa Đỏ', treesPlanted: 3 },
      treePointsPrice: 300,
      spinCostPoints: 10,
    });
    api.get('/game/quiz/today', []);
    api.get('/game/leaderboard', []);
    api.get('/game/missions', []);
    api.get('/game/forest', { count: 0, plantedCount: 0, trees: [] });
    api.get('/game/community', { goal: null, myDrops: 0, pct: 0 });
    api.get('/game/collection', []);
    api.get('/game/season', null);
    api.get('/game/season/leaderboard', []);
    api.get('/game/friends', []);
    api.get('/game/garden', { plots: [], maxPlots: 4, nextUnlock: null });
    api.get('/me/loyalty', {
      pointsBalance: 100,
      tierPoints: 100,
      tier: { id: 'tier-1', name: 'Mầm Xanh', multiplier: 1, perks: [] },
      nextTier: { id: 'tier-2', name: 'Lộc Biếc', minPoints: 500, pointsToGo: 400 },
      tiers: [
        { id: 'tier-1', name: 'Mầm Xanh', minPoints: 0, multiplier: 1 },
        { id: 'tier-2', name: 'Lộc Biếc', minPoints: 500, multiplier: 1.2 },
      ],
    });
    api.get('/me/notifications', []);
    api.get('/me/wallet', { walletBalance: 0, cashbackPending: 0, commissionApproved: 0, commissionPending: 0, withdrawMin: 50000, withdrawFee: 0 });
    api.get('/me/coupons', []);
    api.get('/dealer/me', { isDealer: false, status: 'NONE', tier: null, currentDebt: 0 });
    api.get('/brand/owner/me', null);
    api.allowUnmocked('GET /game/season-pass', 'POST /events');

    for (const path of ['/', '/game', '/profile']) {
      await page.goto(path);
      await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 15_000 });
    }

    expect(api.calls.filter((c) => c.path.startsWith('/waste/'))).toEqual([]);
    expect(api.unmocked.filter((u) => u.includes(' /waste/'))).toEqual([]);
  });

  test('không tràn ngang ở 390 px, chữ thường và chữ lớn', async ({ page, api }) => {
    mockSession(api, makeUser({ id: 'u-wx' }));
    mockWasteCustomer(api, {
      points: [wastePoint({ id: 'wp-q1' })],
      requests: [
        wasteDetail({ id: 'wr-e2e-1', code: 'TR-7K3QP', method: 'DROP_OFF', status: 'OPEN' }),
        wasteDetail({ id: 'wr-done-1', code: 'TR-D0NE1', method: 'DROP_OFF', status: 'COMPLETED', pointsAwarded: 3000, editable: false, cancellable: false }),
      ],
    });
    api.get('/waste/rules', { text: 'Thể lệ thử nghiệm' });

    for (const path of ['/recycle', '/recycle/new', '/recycle/r/wr-e2e-1', '/recycle/requests', '/recycle/rules', '/recycle/done/wr-done-1']) {
      await expectNoOverflow(page, path);
    }

    await toPointsStep(page);
    const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(await fits()).toBe(true);
    await page.evaluate(() => document.documentElement.setAttribute('data-font-scale', 'large'));
    expect(await fits()).toBe(true);
  });
});
