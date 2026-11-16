import type { Page } from '@playwright/test';
import type { WastePickupQuoteResponse, WasteRequestDetailDTO } from '@tubutree/shared-types';
import type { createWasteRequest } from '../../miniapp/src/services/waste-api';
import { test, expect, makeUser, mockSession, publicConfig } from './support/mock-api';
import { CHECKOUT_ADDRESS } from './support/checkout-mocks';
import {
  expectNoOverflow,
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

test.describe('Đổi rác lấy quà — khách', () => {
  test('pin: chọn pin ở bước món rồi sang bước cách giao, Gửi về kho bị khoá kèm lý do, Mang tới điểm nhận vẫn chọn được', async ({ page, api }) => {
    mockSession(api, makeUser({ id: 'u-wx' }));
    mockWasteCustomer(api, { points: [wastePoint({ id: 'wp-q1' })] });
    await page.goto('/recycle/new');
    const card = page.locator('[data-item]').filter({ hasText: 'Pin đã dùng' });
    await expect(card).toBeVisible({ timeout: 15_000 });
    const plus = card.getByRole('button', { name: 'Tăng số lượng' });
    for (let i = 0; i < 10; i++) await plus.click();
    await page.getByRole('button', { name: 'Tiếp tục' }).click();
    const mail = page.getByRole('radio', { name: /Gửi về kho/ });
    await expect(mail).toHaveAttribute('aria-disabled', 'true');
    await expect(mail.getByText(/không gửi qua đường vận chuyển, chỉ mang tới điểm nhận được/)).toBeVisible();
    await expect(page.getByRole('radio', { name: /Mang tới điểm nhận/ })).not.toHaveAttribute('aria-disabled', 'true');
  });

  test('/refill chuyển sang /recycle', async ({ page, api }) => {
    mockSession(api, makeUser({ id: 'u-wx' }));
    mockWasteCustomer(api, { points: [wastePoint({ id: 'wp-q1' })] });
    await page.goto('/refill');
    await expect(page).toHaveURL(/\/recycle$/);
  });

  test('golden: tạo yêu cầu mang tới điểm → điểm nhận xác nhận trên web → khách thấy điểm', async ({ page, api }) => {
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
    await page.getByText('Tôi đồng ý với Thể lệ Đổi rác và để Tubu Tree xử lý yêu cầu này').click();
    await page.getByRole('button', { name: 'Tạo yêu cầu' }).click();

    await expect(page.getByText('TR-7K3QP').first()).toBeVisible();
    const [created] = api.callsTo('POST', '/waste/requests');
    const expected: CreateBody = { method: 'DROP_OFF', lines: [{ itemId: 'wi-carton', declaredQty: 3 }], pointId: 'wp-q1', consent: true, consentVersion: '2026-10-17.1' };
    expect(created?.body).toEqual(expected);
    expect(created?.headers['idempotency-key']).toMatch(/^[A-Za-z0-9_-]{8,128}$/);

    // Điểm nhận xác nhận trên web (quầy nhận không còn ở Mini App từ W177): máy chủ ghi hoàn tất và cộng điểm, khách mở lại thấy kết quả.
    request.current = { ...request.current, status: 'COMPLETED', pointsAwarded: 3000, completedAt: '2026-10-17T06:00:00.000Z', editable: false, cancellable: false };

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
    api.get('/me/wallet', { walletBalance: 0, cashbackPending: 0, commissionApproved: 0, commissionPending: 0 });
    api.get('/me/coupons', []);
    api.get('/dealer/me', { isDealer: false, status: 'NONE', tier: null, currentDebt: 0 });
    api.get('/auth/me', { ownsBrand: false });
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

  test('W178 shipper lấy tận nhà thiếu Điểm Xanh: 1 chạm chuyển sang Thu kèm đơn, hoặc trả phần thiếu bằng Ví Tubu (375 px không tràn ngang)', async ({ page, api }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    mockSession(api, makeUser({ id: 'u-wx' }));
    const createdReq = wasteDetail({
      id: 'wr-hp-wallet',
      code: 'TR-W178K',
      method: 'HOME_PICKUP',
      status: 'OPEN',
      pointName: 'Kho Tubu TP.HCM',
      homePickup: {
        gomdonStatus: '1',
        statusText: 'Đã tạo đơn, chờ bưu tá tới lấy rác',
        shipFeeVnd: 25_000,
        shipFeePointsUsed: 8_000,
        shipFeeCodVnd: 0,
        shipFeePointsRefunded: 0,
        shipFeeCashVnd: 17_000,
        shipFeeCashMethod: 'WALLET',
        shipFeeCashPaid: true,
        shipFeeCashRefundedVnd: 0,
        declaredWeightGrams: 2000,
        pickupAddressText: '123 Lê Lợi, Phường Sài Gòn, TP. Hồ Chí Minh',
        timeline: [{ at: '2026-11-16T03:00:00.000Z', text: 'Đã tạo đơn thu gom' }],
      },
    });
    mockWasteCustomer(api, {
      me: {
        laneFlags: { dropoff: true, mailin: true, pickup: true },
        balance: { pointsBalance: 8_000, pointsConvertedBalance: 0, redeemablePoints: 8_000 },
      },
      points: [wastePoint({ id: 'wp-q1' })],
      requests: [createdReq],
    });
    api.get('/config/public', publicConfig({ waste: { enabled: true, dropoff: true, mailin: true, pickup: true } }));
    api.get('/me/addresses', [CHECKOUT_ADDRESS]);
    api.post('/events', { accepted: 1 });
    const shortQuote: WastePickupQuoteResponse = {
      shipFeeVnd: 25_000,
      estimated: false,
      estimatedPoints: 5_000,
      minPoints: 3_000,
      pointsAvailable: 8_000,
      pointsApplicable: 8_000,
      remainingFeeVnd: 17_000,
      addressOk: true,
      addressMessage: null,
      blocked: 'Phí shipper lấy rác cần trả bằng Điểm Xanh, bạn còn thiếu 17.000 điểm. Hãy chọn mang tới điểm thu gom hoặc đổi rác kèm đơn mua nhé',
      blockedCode: 'NEED_FEE_PAYMENT',
      cashDueVnd: 17_000,
      feePaths: {
        wallet: { balance: 40_000, enough: true },
        bankTransfer: { enabled: false },
        attachNextOrder: { available: true, reason: null, existingRequestId: null },
      },
    };
    api.post('/waste/pickup-quote', () => shortQuote);
    api.post('/waste/requests', () => createdReq);
    api.get('/waste/requests/:id', () => createdReq);

    await page.goto('/recycle/new');
    const card = page.locator('[data-item]').filter({ hasText: 'Thùng carton cũ' });
    for (let i = 0; i < 5; i++) await card.getByRole('button', { name: 'Tăng số lượng' }).click();
    await page.getByRole('button', { name: 'Tiếp tục' }).click();
    await page.getByRole('radio', { name: /Shipper lấy tận nhà/ }).click();

    const shortBlock = page.getByTestId('home-pickup-fee-short');
    await expect(shortBlock).toBeVisible();
    await expect(shortBlock.getByText('Miễn phí lấy rác 100%')).toBeVisible();
    await expect(shortBlock.getByText('Khuyên dùng')).toBeVisible();
    await expect(page.getByTestId('home-pickup-cash-due')).toHaveText('17.000đ');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    const attachBox = await page.getByTestId('fee-path-attach').boundingBox();
    expect(attachBox?.height ?? 0).toBeGreaterThanOrEqual(44);
    const walletBox = await page.getByTestId('fee-path-wallet').boundingBox();
    expect(walletBox?.height ?? 0).toBeGreaterThanOrEqual(44);

    // 1 chạm chuyển sang Thu kèm đơn mua kế tiếp -> giữ nguyên món, đổi phương thức
    await page.getByTestId('fee-path-attach').click();
    await expect(page.getByTestId('home-pickup-fee-short')).toHaveCount(0);
    await expect(page.getByRole('radio', { name: /Thu kèm đơn mua/ })).toHaveAttribute('aria-checked', 'true');

    // Quay lại Shipper lấy tận nhà -> chọn trả 17.000đ bằng Ví Tubu
    await page.getByRole('radio', { name: /Shipper lấy tận nhà/ }).click();
    await expect(page.getByTestId('home-pickup-fee-short')).toBeVisible();
    await page.getByText('Tôi đồng ý với Thể lệ Đổi rác và để Tubu Tree xử lý yêu cầu này').click();
    await expect(page.getByRole('button', { name: 'Chọn cách trả phí' })).toBeDisabled();
    await page.getByTestId('fee-path-wallet').click();
    const payBtn = page.getByRole('button', { name: 'Trả 17.000đ từ Ví và đặt lấy rác' });
    await expect(payBtn).toBeEnabled();
    await payBtn.click();

    await expect(page.getByText('TR-W178K').first()).toBeVisible();
    await expect(page.getByText('Đã trả từ Ví')).toBeVisible();
    const [created] = api.callsTo('POST', '/waste/requests');
    expect(created?.body).toMatchObject({
      method: 'HOME_PICKUP',
      usePointsForShipFee: true,
      shipFeePayment: 'WALLET',
      expectedCashVnd: 17_000,
    });
  });
});
