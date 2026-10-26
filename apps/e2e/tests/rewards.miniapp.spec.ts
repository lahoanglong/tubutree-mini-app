import type { GiftRedemptionDTO, RedeemRewardResultDTO, RewardCatalogDTO, RewardItemDTO } from '@tubutree/shared-types';
import { test, expect, makeUser, mockSession, reply, type MockApi } from './support/mock-api';
import { expectNoOverflow } from './support/waste-mocks';

/**
 * Zalo Mini App E2E — Kho quà (apps/miniapp/src/pages/rewards.tsx, rewards-mine.tsx).
 * Route: GET /me/loyalty/rewards, POST /me/loyalty/rewards/:id/redeem, GET /me/loyalty/rewards/mine,
 * POST /game/tree/buy (thẻ TREE đi qua Vườn Xanh, không qua redeem).
 */

const base = {
  description: 'Miễn phí vận chuyển cho 1 đơn từ 99.000đ — hữu ích khi đơn chưa đạt mức freeship của shop.',
  label: 'Phổ biến',
  imageUrl: null,
  stockRemaining: null,
  soldOut: false,
  canRedeem: true,
  claimInstructions: null,
} as const;

const freeship: RewardItemDTO = {
  ...base,
  id: 'reward-freeship',
  kind: 'VOUCHER',
  name: 'Miễn phí vận chuyển',
  pointsCost: 20_000,
  voucher: { type: 'FREESHIP', value: 0, minOrder: 99000, maxDiscount: null, validDays: 30 },
  sortOrder: 10,
};

const discount50k: RewardItemDTO = {
  ...freeship,
  id: 'reward-discount-50k',
  name: 'Giảm 50.000đ',
  description: 'Đơn từ 300.000đ',
  pointsCost: 50_000,
  canRedeem: false,
  voucher: { type: 'AMOUNT', value: 50000, minOrder: 300000, maxDiscount: null, validDays: 30 },
  sortOrder: 20,
};

const soldOutVoucher: RewardItemDTO = {
  ...base,
  id: 'gift-cup',
  kind: 'GIFT',
  name: 'Cốc tre Tubu',
  pointsCost: 30_000,
  stockRemaining: 0,
  soldOut: true,
  canRedeem: false,
  voucher: null,
  claimInstructions: 'Nhận tại kho',
  sortOrder: 45,
};

const tree: RewardItemDTO = {
  ...base,
  id: 'gift-tree',
  kind: 'TREE',
  name: 'Góp quỹ trồng cây',
  pointsCost: 50_000,
  canRedeem: true,
  voucher: null,
  sortOrder: 50,
};

function catalogOf(points = 40_000): RewardCatalogDTO {
  return {
    pointsBalance: points,
    pointsConvertedBalance: 0,
    lockedPoints: 0,
    redeemablePoints: points,
    giftClaimDays: 60,
    claimPoint: {
      name: 'Kho Tubu TP.HCM',
      addressLine: '1 Đường A',
      communeName: 'Phường B',
      provinceName: 'TP. Hồ Chí Minh',
      openingHours: {},
    },
    rewards: [freeship, discount50k, soldOutVoucher, tree],
  } as RewardCatalogDTO;
}

const redemption: GiftRedemptionDTO = {
  id: 'gr-1',
  giftId: 'reward-freeship',
  giftKind: 'VOUCHER',
  giftName: 'Miễn phí vận chuyển',
  pointsCost: 20_000,
  status: 'FULFILLED',
  code: null,
  claimExpiresAt: null,
  claimPoint: null,
  fulfilledAt: '2026-10-17T03:00:00.000Z',
  cancelledAt: null,
  cancelReason: null,
  refundedPoints: null,
  couponCode: 'FS-E2E1',
  createdAt: '2026-10-17T03:00:00.000Z',
};

const redeemResult: RedeemRewardResultDTO = {
  success: true,
  message: 'Đổi quà thành công',
  pointsSpent: 20_000,
  remainingPoints: 20_000,
  redemption,
  coupon: { code: 'FS-E2E1', type: 'FREESHIP', value: 0, minOrder: 99000, maxDiscount: null, endAt: '2026-11-16T16:59:59.000Z' },
};

function mockRewards(api: MockApi, points = 40_000): void {
  mockSession(api, makeUser({ id: 'user-rw', fullName: 'Lê Thành Viên', pointsBalance: points }));
  api.post('/events', { accepted: 1 });
  api.get('/me/loyalty', {
    pointsBalance: points,
    tierPoints: 60,
    tier: { id: 'tier-1', name: 'Mầm Xanh', multiplier: 1, perks: [] },
    nextTier: null,
    tiers: [{ id: 'tier-1', name: 'Mầm Xanh', minPoints: 0, multiplier: 1 }],
  });
  api.get('/me/coupons', []);
  api.get('/me/loyalty/rewards', () => catalogOf(points));
  api.get('/me/loyalty/rewards/mine', [redemption]);
}

const IDEM = /^[A-Za-z0-9_-]{8,128}$/;

test.describe('Kho quà', () => {
  test('đổi mã miễn phí vận chuyển: gửi Idempotency-Key, trừ điểm, mã vào Quà của tôi', async ({ page, api }) => {
    mockRewards(api);
    api.post('/me/loyalty/rewards/:id/redeem', redeemResult);
    await page.goto('/rewards');

    const card = page.locator('[data-reward]').filter({ hasText: /^Miễn phí vận chuyển/ });
    await expect(card).toBeVisible({ timeout: 15_000 });
    const posted = api.waitForCall('POST', '/me/loyalty/rewards/:id/redeem');
    await card.getByRole('button', { name: 'Đổi' }).click();
    await page.getByRole('button', { name: 'Xác nhận đổi' }).dblclick();
    const call = await posted;

    expect(call.path).toBe('/me/loyalty/rewards/reward-freeship/redeem');
    expect(call.headers['idempotency-key']).toMatch(IDEM);
    await expect(page.getByText('Mã FS-E2E1 đã vào ví mã giảm giá')).toBeVisible({ timeout: 5_000 });
    expect(api.callsTo('POST', '/me/loyalty/rewards/:id/redeem')).toHaveLength(1);

    await page.goto('/rewards/mine');
    await expect(page.getByText('FS-E2E1').first()).toBeVisible({ timeout: 15_000 });
  });

  test('quà hết hàng hiện "Đã hết" và không bấm được; thẻ không đủ điểm bị khoá', async ({ page, api }) => {
    mockRewards(api);
    api.post('/me/loyalty/rewards/:id/redeem', redeemResult);
    await page.goto('/rewards');

    const card = (name: string) => page.locator('[data-reward]').filter({ hasText: name });
    await page.getByText('Quà nhỏ', { exact: true }).click({ timeout: 15_000 });
    await expect(card('Cốc tre Tubu').getByText('Đã hết')).toBeVisible();
    await expect(card('Cốc tre Tubu').getByRole('button', { name: 'Đổi' })).toHaveCount(0);

    await page.getByText('Mã giảm giá', { exact: true }).click();
    await expect(card('Giảm 50.000đ').getByText('Cần thêm 10.000 điểm')).toBeVisible();
    await expect(card('Giảm 50.000đ').getByRole('button', { name: 'Đổi' })).toHaveCount(0);
    expect(api.callsTo('POST', '/me/loyalty/rewards/:id/redeem')).toHaveLength(0);
  });

  test('danh sách cũ trong bộ đệm: server trả 400 "Quà này đã hết hoặc đã ngừng đổi" thì báo đúng câu và tải lại danh sách', async ({ page, api }) => {
    mockRewards(api);
    api.post('/me/loyalty/rewards/:id/redeem', () =>
      reply(400, { statusCode: 400, message: 'Quà này đã hết hoặc đã ngừng đổi' }),
    );
    await page.goto('/rewards');

    const card = page.locator('[data-reward]').filter({ hasText: /^Miễn phí vận chuyển/ });
    await expect(card).toBeVisible({ timeout: 15_000 });
    await card.getByRole('button', { name: 'Đổi' }).click();
    await page.getByRole('button', { name: 'Xác nhận đổi' }).click();

    await expect(page.getByText('Quà này đã hết hoặc đã ngừng đổi')).toBeVisible({ timeout: 5_000 });
    await expect.poll(() => api.callsTo('GET', '/me/loyalty/rewards').length, { timeout: 5_000 }).toBeGreaterThanOrEqual(2);
  });

  test('thẻ TREE gọi POST /game/tree/buy (không gọi redeem)', async ({ page, api }) => {
    mockRewards(api, 60_000);
    api.post('/me/loyalty/rewards/:id/redeem', redeemResult);
    api.post('/game/tree/buy', {
      certificateCode: 'CERT-E2E-1',
      treeType: 'Cây Sưa Đỏ',
      cost: 50_000,
      pointsUsed: 50_000,
      pointsUsedConverted: 0,
    });
    await page.goto('/rewards');

    await page.getByText('Cây và hạt', { exact: true }).click({ timeout: 15_000 });
    const card = page.locator('[data-reward]').filter({ hasText: 'Góp quỹ trồng cây' });
    await card.getByRole('button', { name: 'Đổi' }).click();
    const posted = api.waitForCall('POST', '/game/tree/buy');
    await page.getByRole('button', { name: 'Xác nhận đổi' }).click();
    const call = await posted;

    await expect(page.getByText('Bạn đã góp một cây vào quỹ trồng cây của Tubu')).toBeVisible({ timeout: 5_000 });
    expect(call.headers['idempotency-key']).toMatch(IDEM);
    expect(api.callsTo('POST', '/game/tree/buy')).toHaveLength(1);
    expect(api.callsTo('POST', '/me/loyalty/rewards/:id/redeem')).toHaveLength(0);
    await expect(page.getByText('CERT-E2E-1')).toHaveCount(0);
    await expect(page.getByText('Cây Sưa Đỏ')).toHaveCount(0);
  });

  test('/rewards không tràn ngang', async ({ page, api }) => {
    mockRewards(api);
    await expectNoOverflow(page, '/rewards');
    await expectNoOverflow(page, '/rewards/mine');
  });
});
