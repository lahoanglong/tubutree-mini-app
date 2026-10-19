import type {
  CheckInReward,
  CheckInResult,
  CheckInStatusResponse,
  CouponDTO,
  LoyaltyOverview,
  MemberCardResponse,
} from '../../miniapp/src/services/account-api';
import type { RedeemRewardResultDTO, RewardCatalogDTO } from '@tubutree/shared-types';
import { test, expect, makeUser, mockSession, reply, type MockApi } from './support/mock-api';
import { flushEvents } from './support/events';

/**
 * Zalo Mini App E2E — Hạng thành viên / Điểm Xanh (apps/miniapp/src/pages/loyalty.tsx).
 * Route (apps/api/src/modules/loyalty/loyalty.controller.ts):
 *   GET  /me/loyalty, /me/coupons, /me/points/transactions
 *   GET  /me/loyalty/rewards          POST /me/loyalty/rewards/:id/redeem
 *   GET  /me/loyalty/check-in         POST /me/loyalty/check-in   (todayPoints = điểm ô hôm nay)
 *   GET  /me/loyalty/member-card      (memberCode = payload QR thật; posCreditEnabled)
 * Mock có trạng thái: sau POST, các GET trả số liệu mới như backend (UI refetch qua invalidate).
 */

const CHECKIN_TABLE = [5, 5, 10, 10, 15, 15, 30];
const MEMBER_CODE = 'TUBUE2EREF';

interface LoyaltyState {
  points: number;
  checkedInToday: boolean;
  coupons: CouponDTO[];
  /** Điểm từ đơn mới giao còn trong hạn đổi/trả — backend chưa cho đổi quà (loyalty.service lockedOrderPoints). */
  locked?: { points: number; until: string };
}

const redeemable = (s: LoyaltyState) => Math.max(0, s.points - (s.locked?.points ?? 0));

function checkInStatus(s: LoyaltyState): CheckInStatusResponse {
  const cycleDay = 3;
  const rewards: CheckInReward[] = CHECKIN_TABLE.map((points, i) => ({
    day: i + 1,
    points,
    claimed: i + 1 < cycleDay || (s.checkedInToday && i + 1 === cycleDay),
    isToday: i + 1 === cycleDay,
  }));
  return {
    checkedInToday: s.checkedInToday,
    streakDays: s.checkedInToday ? 3 : 2,
    currentCycleDay: cycleDay,
    todayPoints: CHECKIN_TABLE[cycleDay - 1],
    rewards,
  };
}

function overview(s: LoyaltyState): LoyaltyOverview {
  return {
    pointsBalance: s.points,
    // Điểm xét hạng chỉ từ mua hàng — điểm danh/đổi quà không làm đổi con số này.
    tierPoints: 60,
    tier: { id: 'tier-1', name: 'Mầm Xanh', multiplier: 1, perks: ['Tích điểm ×1 trên mọi đơn'] },
    nextTier: { id: 'tier-2', name: 'Lộc Biếc', minPoints: 500, pointsToGo: 440 },
    tiers: [
      { id: 'tier-1', name: 'Mầm Xanh', minPoints: 0, multiplier: 1 },
      { id: 'tier-2', name: 'Lộc Biếc', minPoints: 500, multiplier: 1.2 },
    ],
    ...(s.locked
      ? { lockedPoints: s.locked.points, lockedReturnPoints: 0, lockedUntil: s.locked.until, redeemablePoints: redeemable(s) }
      : {}),
  };
}

const REWARDS = [
  { id: 'reward-freeship', title: 'Voucher Miễn phí vận chuyển', pointsCost: 20, type: 'FREESHIP', value: 0, minOrder: 99000 },
  { id: 'reward-discount-50k', title: 'Voucher Giảm 50.000đ', pointsCost: 50, type: 'AMOUNT', value: 50000, minOrder: 300000 },
  { id: 'reward-discount-100k', title: 'Voucher Giảm 100.000đ', pointsCost: 100, type: 'AMOUNT', value: 100000, minOrder: 600000 },
] as const;

function catalog(s: LoyaltyState): RewardCatalogDTO {
  return {
    pointsBalance: s.points,
    pointsConvertedBalance: 0,
    lockedPoints: s.locked?.points ?? 0,
    redeemablePoints: redeemable(s),
    giftClaimDays: 60,
    claimPoint: null,
    rewards: REWARDS.map((r, i) => ({
      id: r.id,
      kind: 'VOUCHER',
      name: r.title,
      description: `${r.title} cho đơn từ ${r.minOrder.toLocaleString('vi-VN')}đ`,
      label: null,
      pointsCost: r.pointsCost,
      imageUrl: null,
      stockRemaining: null,
      soldOut: false,
      // Như backend: canRedeem theo điểm DÙNG ĐƯỢC, không theo số dư.
      canRedeem: redeemable(s) >= r.pointsCost,
      claimInstructions: null,
      voucher: { type: r.type, value: r.value, minOrder: r.minOrder, maxDiscount: null, validDays: 30 },
      sortOrder: i + 1,
    })),
  };
}

function mockLoyalty(
  api: MockApi,
  opts: { posCreditEnabled?: boolean; locked?: LoyaltyState['locked'] } = {},
): LoyaltyState {
  const s: LoyaltyState = { points: 60, checkedInToday: false, coupons: [], locked: opts.locked };
  mockSession(api, makeUser({ id: 'user-loyal', fullName: 'Lê Thành Viên', referralCode: 'E2EREF', pointsBalance: 60 }));
  // Analytics tracker (services/analytics.ts) xả lô khi ẩn app / mỗi 10s: spec chạy chậm sẽ chạm POST /events.
  api.post('/events', { accepted: 1 });
  api.get('/me/loyalty', () => overview(s));
  api.get('/me/coupons', () => s.coupons);
  api.get('/me/points/transactions', []);
  api.get('/me/loyalty/rewards', () => catalog(s));
  api.get('/me/loyalty/check-in', () => checkInStatus(s));
  api.post('/me/loyalty/check-in', async () => {
    // Giữ response 400ms: cú chạm thứ 2 của double-tap rơi đúng lúc request đang bay — đó là
    // cửa sổ mà busyRef/disabled của loyalty.tsx phải chặn.
    await new Promise((r) => setTimeout(r, 400));
    // Như loyalty.service dailyCheckIn (unique theo ngày VN): lần 2 trong ngày → 400.
    if (s.checkedInToday) return reply(400, { message: 'Hôm nay bạn đã điểm danh nhận điểm rồi 🌿' });
    const pts = CHECKIN_TABLE[2]!;
    s.checkedInToday = true;
    s.points += pts;
    const res: CheckInResult = {
      success: true,
      cycleDay: 3,
      streakDays: 3,
      pointsEarned: pts,
      totalPoints: s.points,
      message: `Điểm danh Ngày 3 thành công! Nhận +${pts} Điểm Xanh.`,
    };
    return res;
  });
  api.post('/me/loyalty/rewards/:id/redeem', ({ params, call }) => {
    expect(call.headers['idempotency-key']).toMatch(/^[A-Za-z0-9_-]{8,128}$/);
    const r = REWARDS.find((x) => x.id === params.id)!;
    s.points -= r.pointsCost;
    const coupon: CouponDTO = {
      code: 'LOYAL50K-E2E1',
      type: r.type,
      value: r.value,
      minOrder: r.minOrder,
      maxDiscount: null,
      endAt: '2026-10-20T16:59:59.000Z',
    };
    s.coupons = [...s.coupons, coupon];
    const res: RedeemRewardResultDTO = {
      success: true,
      message: `Đổi thành công ${r.title}!`,
      pointsSpent: r.pointsCost,
      remainingPoints: s.points,
      redemption: {
        id: 'red-e2e',
        giftId: r.id,
        giftKind: 'VOUCHER',
        giftName: r.title,
        pointsCost: r.pointsCost,
        status: 'FULFILLED',
        code: null,
        claimExpiresAt: null,
        claimPoint: null,
        fulfilledAt: '2026-10-17T03:00:00.000Z',
        cancelledAt: null,
        cancelReason: null,
        refundedPoints: null,
        couponCode: coupon.code,
        createdAt: '2026-10-17T03:00:00.000Z',
      },
      coupon,
    };
    return res;
  });
  const card: MemberCardResponse = {
    memberCode: MEMBER_CODE,
    name: 'Lê Thành Viên',
    phone: '0901234567',
    tierName: 'Mầm Xanh',
    tierMultiplier: 1,
    pointsBalance: 60,
    posCreditEnabled: opts.posCreditEnabled ?? false,
  };
  api.get('/me/loyalty/member-card', card);
  return s;
}

test.describe('Hạng thành viên — Điểm Xanh', () => {
  test('Xả hàng đợi analytics (POST /events) khi đang ở trang Điểm Xanh không vỡ mock', async ({ page, api }) => {
    mockLoyalty(api);
    await page.goto('/loyalty');
    await expect(page.getByText('Điểm danh nhận Điểm Xanh')).toBeVisible({ timeout: 15_000 });

    await flushEvents(page);
    await expect.poll(() => api.callsTo('POST', '/events').length, { timeout: 5_000 }).toBeGreaterThan(0);
  });

  test('Điểm danh hằng ngày: nút ghi đúng điểm hôm nay, chạm đúp chỉ gọi API 1 lần, xong thì khoá', async ({ page, api }) => {
    mockLoyalty(api);
    await page.goto('/loyalty');

    await expect(page.getByText('Điểm danh nhận Điểm Xanh')).toBeVisible({ timeout: 15_000 });
    // Tiến độ hạng theo điểm XÉT HẠNG (pointsToGo), không theo số dư.
    await expect(page.getByText('điểm tích từ mua hàng để lên hạng Lộc Biếc')).toBeVisible();

    const btn = page.getByRole('button', { name: 'Điểm danh +10' });
    await expect(btn).toBeEnabled();
    const posted = api.waitForCall('POST', '/me/loyalty/check-in');
    await btn.dblclick();
    await posted;

    await expect(page.getByText('Điểm danh Ngày 3 thành công! Nhận +10 Điểm Xanh.')).toBeVisible({ timeout: 5_000 });
    // invalidate ['loyalty-checkin'] → GET trả checkedInToday:true → nút khoá.
    await expect(page.getByRole('button', { name: 'Đã điểm danh' })).toBeDisabled({ timeout: 5_000 });
    // Số dư mới từ GET /me/loyalty (60 + 10) — cộng đúng MỘT lần.
    await expect(page.getByText('Tích điểm ×1 · 70 điểm Xanh')).toBeVisible();
    expect(api.callsTo('POST', '/me/loyalty/check-in')).toHaveLength(1);
  });

  test('Đổi điểm lấy mã giảm giá: xác nhận → trừ điểm → mã vào Mã giảm giá của tôi, quà không đủ điểm bị khoá', async ({ page, api }) => {
    mockLoyalty(api);
    await page.goto('/loyalty');

    await page.getByText('Kho quà', { exact: true }).click({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/rewards$/);

    const card = (name: string) => page.locator('[data-reward]').filter({ hasText: name });
    // 60 điểm < 100 → quà 100 điểm không có nút Đổi.
    await expect(card('Voucher Giảm 100.000đ').getByText('Cần thêm 40 điểm')).toBeVisible({ timeout: 15_000 });
    await expect(card('Voucher Giảm 100.000đ').getByRole('button', { name: 'Đổi' })).toHaveCount(0);

    await card('Voucher Giảm 50.000đ').getByRole('button', { name: 'Đổi' }).click();
    const redeemed = api.waitForCall('POST', '/me/loyalty/rewards/:id/redeem');
    await page.getByRole('button', { name: 'Xác nhận đổi' }).click();
    const call = await redeemed;
    expect(call.path).toBe('/me/loyalty/rewards/reward-discount-50k/redeem');

    await expect(page.getByText('Mã LOYAL50K-E2E1 đã vào ví mã giảm giá')).toBeVisible({ timeout: 5_000 });
    await page.getByRole('button', { name: 'Xem ví mã' }).click();
    await expect(page).toHaveURL(/\/loyalty$/);
    await expect(page.getByText('Mã LOYAL50K-E2E1 · đơn từ 300.000đ')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('Tích điểm ×1 · 10 điểm Xanh')).toBeVisible();
    expect(api.callsTo('POST', '/me/loyalty/rewards/:id/redeem')).toHaveLength(1);
  });

  test('Điểm từ đơn mới giao (còn hạn đổi/trả) chưa đổi quà được: nói rõ lý do + ngày mở, không báo "Cần X điểm" sai', async ({ page, api }) => {
    // 60 điểm, 40 điểm từ đơn giao gần đây — 2026-10-03T17:30Z = 00:30 04/10 giờ VN.
    mockLoyalty(api, { locked: { points: 40, until: '2026-10-03T17:30:00.000Z' } });
    await page.goto('/rewards');

    await expect(
      page.getByText('Đổi quà dùng được 20 điểm: 40 điểm từ đơn mới giao sẽ dùng được sau ngày 04/10/2026 (hết hạn đổi/trả hàng).'),
    ).toBeVisible({ timeout: 15_000 });
    const card = (name: string) => page.locator('[data-reward]').filter({ hasText: name });
    // Chỉ dùng được 20 điểm: quà 50 điểm thiếu 30, quà 100 điểm thiếu 80; quà 20 điểm vẫn đổi được.
    await expect(card('Voucher Giảm 50.000đ').getByText('Cần thêm 30 điểm')).toBeVisible();
    await expect(card('Voucher Giảm 100.000đ').getByText('Cần thêm 80 điểm')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Đổi', exact: true })).toHaveCount(1);
  });

  test('Thẻ thành viên: QR thật của memberCode, chép mã, lời nhắc KHÔNG hứa tích điểm tại quầy khi tắt', async ({ page, api }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: (t: string) => {
            (window as unknown as { __copied?: string }).__copied = t;
            return Promise.resolve();
          },
        },
      });
    });
    mockLoyalty(api, { posCreditEnabled: false });
    await page.goto('/loyalty');

    await page.getByText('Thẻ thành viên số (mã QR)').click({ timeout: 15_000 });
    const modal = page.locator('.zaui-sheet').filter({ hasText: 'Thẻ Thành Viên Tubu' });
    await expect(modal.getByText(MEMBER_CODE, { exact: true })).toBeVisible({ timeout: 5_000 });
    // QrCode (components/qr-code.tsx) vẽ ảnh PNG từ memberCode — không còn barcode giả.
    await expect(modal.getByRole('img', { name: 'QR' })).toHaveAttribute('src', /^data:image\/png;base64,/);
    await expect(modal.getByText('Tích Điểm Xanh khi mua tại cửa hàng chưa được áp dụng', { exact: false })).toBeVisible();
    await expect(modal.getByText('Đưa mã QR này cho thu ngân', { exact: false })).toHaveCount(0);

    await modal.getByText('Chép', { exact: true }).click();
    await expect(page.getByText('Đã sao chép mã thành viên')).toBeVisible({ timeout: 5_000 });
    expect(await page.evaluate(() => (window as unknown as { __copied?: string }).__copied)).toBe(MEMBER_CODE);
  });

  test('Thẻ thành viên khi tích điểm tại quầy BẬT: nhắc đưa QR cho thu ngân', async ({ page, api }) => {
    mockLoyalty(api, { posCreditEnabled: true });
    await page.goto('/loyalty');

    await page.getByText('Thẻ thành viên số (mã QR)').click({ timeout: 15_000 });
    const modal = page.locator('.zaui-sheet').filter({ hasText: 'Thẻ Thành Viên Tubu' });
    await expect(modal.getByText('Đưa mã QR này cho thu ngân', { exact: false })).toBeVisible({ timeout: 5_000 });
  });
});
