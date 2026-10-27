import { expect, reply, test, type MockApi } from './support/mock-api';

/**
 * Web khách: Điểm Xanh và hạng thành viên (/tai-khoan/diem-xanh). Mọi lời gọi /api/** đi qua mock (fixture `api`).
 * Điểm danh phải gửi đúng POST /me/daily-check-in một lần dù bấm đúp; thẻ thành viên số mã hoá đúng memberCode.
 */

const USER = {
  id: 'u1', fullName: 'Nguyễn Văn An', referralCode: 'AN123', phone: '0912345678', role: 'CUSTOMER',
  pointsBalance: 1681, pointsConvertedBalance: 119, walletBalance: 0,
};
const TIERS = [
  { id: 't1', name: 'Mầm Xanh', minPoints: 0, minSpending: 0, multiplier: 1 },
  { id: 't2', name: 'Lộc Biếc', minPoints: 200, minSpending: 4_000_000, multiplier: 1.2 },
];
const REWARDS = [1, 2, 3, 4, 5, 6, 7].map((day) => ({ day, points: day === 7 ? 10 : day, claimed: day < 3, isToday: day === 3 }));

/** `tall`: cột phải rất cao (4 hạng × 3 quyền lợi, đủ 3 lối tắt) còn cột trái ngắn (chưa có mã, chưa có lịch sử), ca làm hở hàng ở lưới hai cột. */
function mockLoyalty(api: MockApi, checkIn: { done: boolean }, opts: { tall?: boolean } = {}) {
  const tiers = opts.tall
    ? ['Mầm Xanh', 'Lộc Biếc', 'Cổ Thụ', 'Rừng Xanh'].map((name, i) => ({ id: `t${i + 1}`, name, minPoints: i * 200, minSpending: i * 4_000_000, multiplier: 1 + i * 0.1, perks: ['Quà sinh nhật', 'Freeship đơn từ 99k', 'Ưu tiên chăm sóc'] }))
    : TIERS;
  api.post('/auth/refresh', () => ({ accessToken: 'e2e-token', user: USER }));
  api.get('/me', () => USER);
  api.get('/config/public', { freeshipThreshold: 500000, waste: { enabled: !!opts.tall, dropoff: !!opts.tall, mailin: false, pickup: false } });
  api.get('/me/loyalty', {
    pointsBalance: 1681, pointsConvertedBalance: 119,
    tier: { id: 't1', name: 'Mầm Xanh', multiplier: 1, perks: ['Quà sinh nhật'] },
    nextTier: { id: 't2', name: 'Lộc Biếc', minPoints: 200, minSpending: 4_000_000, pointsToGo: 120, spendingToGo: 2_500_000 },
    tiers, spent12m: 1_500_000, tierPoints: 80,
    rates: { earnPct: 2, vndPerPoint: 50, vndPerPointRedeem: 1000, maxRedeemPct: 0.5 },
  });
  api.get('/me/coupons', opts.tall ? [] : [{ code: 'FREESHIP1', type: 'FREESHIP', value: 0, minOrder: 199000, maxDiscount: null, endAt: '2026-12-31T05:00:00Z' }]);
  api.get('/me/points/transactions', opts.tall ? [] : [{ id: 'p1', delta: 250, reason: 'ORDER_DELIVERED:TB0', expiresAt: null, createdAt: '2026-10-10T05:00:00Z' }]);
  api.get('/me/daily-check-in', () => ({ checkedInToday: checkIn.done, streakDays: 2, currentCycleDay: 3, todayPoints: 3, todayWater: 10, rewards: REWARDS }));
  api.post('/me/daily-check-in', () => {
    checkIn.done = true;
    return {
      points: { success: true, cycleDay: 3, streakDays: 3, pointsEarned: 3, totalPoints: 1803, message: 'Điểm danh thành công +3 Điểm Xanh' },
      water: { seedsEarned: 10, streakDays: 3, totalSeeds: 1260, streakFrozeUsed: false, bonusNote: '' },
      alreadyDone: false,
      pending: [],
    };
  });
  api.get('/me/loyalty/member-card', {
    memberCode: 'TUBUAN123', name: 'An', phone: null, tierName: 'Mầm Xanh', tierMultiplier: 1, pointsBalance: 1681, posCreditEnabled: true,
  });
}

const GUEST_PREVIEW = {
  rewards: [
    { id: 'reward-freeship', kind: 'VOUCHER', name: 'Miễn phí vận chuyển', description: 'Đơn từ 99.000đ', label: null, pointsCost: 20000, imageUrl: null, stockRemaining: null, soldOut: false, canRedeem: false, claimInstructions: null, voucher: { type: 'FREESHIP', value: 0, minOrder: 99000, maxDiscount: null, validDays: 30 }, sortOrder: 1 },
  ],
  giftClaimDays: 60,
  claimPoint: null,
  tiers: [
    { id: 'MAM_XANH', name: 'Mầm Xanh', minPoints: 0, minSpending: null, multiplier: 1, perks: ['Quà sinh nhật'] },
    { id: 'LOC_BIEC', name: 'Lộc Biếc', minPoints: 2500, minSpending: 5000000, multiplier: 1.2, perks: ['Freeship đơn từ 99k'] },
  ],
  rates: { earnPct: 2, vndPerPoint: 50, vndPerPointRedeem: 1, maxRedeemPct: 0.2 },
  pointExpireMonths: 12,
};

test.describe('Web khách: Điểm Xanh và hạng thành viên', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('tubu_web_session', '1');
      } catch {
        // không có localStorage: spec vẫn chạy, chỉ không có phiên khôi phục
      }
    });
  });

  test('thẻ hạng, mã giảm giá và lịch sử hiện đúng số từ API', async ({ page, api }) => {
    mockLoyalty(api, { done: false });
    await page.goto('/tai-khoan/diem-xanh');
    await expect(page.getByRole('heading', { name: 'Hạng thành viên & Điểm Xanh', level: 1 })).toBeVisible();
    await expect(page.getByText('1.800 Điểm Xanh')).toBeVisible();
    await expect(page.getByText('trong đó 119 điểm không hết hạn')).toBeVisible();
    await expect(page.getByText('Còn 2,5 triệu mua hàng để lên hạng Lộc Biếc')).toBeVisible();
    await expect(page.getByText('Miễn phí giao hàng')).toBeVisible();
    await expect(page.getByText('Tích điểm từ đơn hàng', { exact: true })).toBeVisible();
  });

  test('từ lg mã giảm giá và điểm danh nằm ở cột trái, trên lịch sử; không rơi xuống dưới', async ({ page, api }, testInfo) => {
    test.skip(testInfo.project.name !== 'Web Customer', 'Hai cột chỉ có ở máy tính');
    mockLoyalty(api, { done: false });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/tai-khoan/diem-xanh');
    const box = async (name: string) => (await page.getByRole('region', { name }).boundingBox())!;
    await expect(page.getByRole('region', { name: 'Mã giảm giá của tôi' })).toBeVisible();
    const coupons = await box('Mã giảm giá của tôi');
    const history = await box('Lịch sử Điểm Xanh');
    expect(coupons.y).toBeLessThan(history.y);
    expect(coupons.y).toBeLessThan(900);
    // Hai cột thật: cột phải (các hạng) nằm bên phải thẻ mã giảm giá.
    const tiers = await box('Các hạng');
    expect(tiers.x).toBeGreaterThan(coupons.x + coupons.width - 1);
  });

  test('từ lg cột phải cao hơn cột trái: thẻ trái vẫn cách nhau đúng 16px, không bị chia thêm chiều cao dư', async ({ page, api }, testInfo) => {
    test.skip(testInfo.project.name !== 'Web Customer', 'Hai cột chỉ có ở máy tính');
    mockLoyalty(api, { done: false }, { tall: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/tai-khoan/diem-xanh');
    const coupons = page.getByRole('region', { name: 'Mã giảm giá của tôi' });
    await expect(coupons).toBeVisible();
    await expect(page.getByTestId('daily-check-in')).toBeVisible();
    // Chờ mọi khối tải xong (không còn lời gọi nào chạy) rồi đo cả bốn hộp trong MỘT lần đọc, để chiều cao không đổi giữa các lần đo.
    await expect(page.getByRole('region', { name: 'Lịch sử Điểm Xanh' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Các hạng' })).toBeVisible();
    await page.waitForLoadState('networkidle');
    const { c, d, h, right } = await page.evaluate(() => {
      const r = (el: Element | null) => {
        const b = el!.getBoundingClientRect();
        return { y: b.top + window.scrollY, height: b.height };
      };
      const region = (name: string) => document.querySelector(`[role="region"][aria-label="${name}"], section[aria-label="${name}"]`);
      return {
        c: r(region('Mã giảm giá của tôi')),
        d: r(document.querySelector('[data-testid="daily-check-in"]')),
        h: r(region('Lịch sử Điểm Xanh')),
        right: r(region('Các hạng')),
      };
    });
    expect(right.y + right.height).toBeGreaterThan(h.y + h.height); // đúng ca: cột phải thật sự cao hơn
    expect(Math.abs(d.y - (c.y + c.height) - 16)).toBeLessThanOrEqual(1);
    expect(Math.abs(h.y - (d.y + d.height) - 16)).toBeLessThanOrEqual(1);
  });

  test('điểm danh: bấm đúp chỉ gửi một POST, báo kết quả và nút chuyển "Đã điểm danh"', async ({ page, api }) => {
    mockLoyalty(api, { done: false });
    await page.goto('/tai-khoan/diem-xanh');
    const button = page.getByRole('button', { name: 'Điểm danh', exact: true });
    await expect(button).toBeEnabled();
    await button.dblclick();
    await expect(page.getByText('+3 Điểm Xanh · +10 giọt nước')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Đã điểm danh', exact: true })).toBeDisabled();
    expect(api.callsTo('POST', '/me/daily-check-in')).toHaveLength(1);
  });

  test('"Dùng ngay" mà máy chủ từ chối mã: thẻ mã hiện đúng lý do (role=alert)', async ({ page, api }) => {
    mockLoyalty(api, { done: true });
    api.get('/cart', { items: [], itemCount: 2, subtotal: 150000, discount: 0, freeship: false, freeshipThreshold: 199000, couponCode: null });
    api.post('/cart/coupon', () => reply(400, { message: 'Đơn tối thiểu 199.000đ' }));
    await page.goto('/tai-khoan/diem-xanh');
    await page.getByRole('button', { name: 'Dùng mã FREESHIP1 ngay' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Chưa chọn sẵn được mã: Đơn tối thiểu 199.000đ' })).toBeVisible();
    expect(api.callsTo('POST', '/cart/coupon')).toHaveLength(1);
  });

  test('thẻ thành viên số: hiện mã gõ tay được và lời nhắc, Đóng tắt thẻ', async ({ page, api }) => {
    mockLoyalty(api, { done: true });
    await page.goto('/tai-khoan/diem-xanh');
    await page.getByRole('button', { name: /Thẻ thành viên số/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Thẻ Thành Viên Tubu' });
    await expect(dialog.getByText('TUBUAN123')).toBeVisible();
    await expect(dialog.getByRole('img', { name: 'QR' })).toBeVisible();
    await expect(dialog.getByText(/Đưa mã QR này cho thu ngân/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Đóng', exact: true }).last().click();
    await expect(dialog).toHaveCount(0);
  });

  test('khách chưa đăng nhập xem được bảng hạng và có nút Đăng nhập để đổi, không gọi API điểm', async ({ page, api }) => {
    api.post('/auth/refresh', () => reply(401, { message: 'Hết phiên' }));
    api.get('/loyalty/preview', GUEST_PREVIEW);
    await page.goto('/tai-khoan/diem-xanh');
    await expect(page.getByRole('main').getByRole('link', { name: 'Đăng nhập để đổi' })).toBeVisible();
    await expect(page.getByText('Freeship đơn từ 99k')).toBeVisible();
    expect(api.callsTo('GET', '/me/loyalty')).toHaveLength(0);
  });
});

/**
 * Web khách: Ví Tubu (/tai-khoan/vi-tubu). Không còn nút rút về ngân hàng (chính sách Zalo 4.5);
 * sao kê tải thêm theo 20 dòng/trang, dòng rút cũ vẫn hiện nhãn lịch sử.
 */
const WALLET_TXNS = [
  { id: 't1', delta: 50_000, balanceAfter: 1_250_000, type: 'CASHBACK', reason: null, orderId: null, createdAt: '2026-10-05T07:04:00Z' },
  { id: 't2', delta: -100_000, balanceAfter: 1_200_000, type: 'WITHDRAW', reason: 'Rút về ngân hàng', orderId: null, createdAt: '2026-10-04T10:00:00Z' },
  { id: 't3', delta: 10_000, balanceAfter: 1_300_000, type: 'ADJUST', reason: null, orderId: null, createdAt: '2026-10-03T10:00:00Z' },
];

function mockWallet(api: MockApi) {
  api.post('/auth/refresh', () => ({ accessToken: 'e2e-token', user: USER }));
  api.get('/me', () => USER);
  api.get('/me/wallet', { walletBalance: 1_250_000, cashbackPending: 0, commissionApproved: 0, commissionPending: 0 });
  api.get('/me/loyalty', { pointsBalance: 1681, pointsConvertedBalance: 119, tier: { id: 't1', name: 'Mầm Xanh', multiplier: 1, perks: [] }, tiers: TIERS, rates: { earnPct: 2, vndPerPoint: 50, vndPerPointRedeem: 1000, maxRedeemPct: 0.5 } });
  api.get('/me/referral', { referralCode: 'AN123', successCount: 2, earnedPoints: 20, milestones: [{ count: 5, bonusPoints: 50 }], nextMilestone: { count: 5, bonusPoints: 50 } });
  api.get('/me/wallet/transactions', ({ call }) => {
    const page = Number(call.query.get('page') ?? 1);
    return { data: page === 1 ? WALLET_TXNS.slice(0, 2) : WALLET_TXNS.slice(2), meta: { page, limit: 2, total: 3 } };
  });
}

test.describe('Web khách: Ví Tubu', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('tubu_web_session', '1');
      } catch {
        // không có localStorage: spec vẫn chạy, chỉ không có phiên khôi phục
      }
    });
  });

  test('số dư, Điểm Xanh, mã giới thiệu và sao kê hiện đúng số từ API; Xem thêm nạp trang 2', async ({ page, api }) => {
    mockWallet(api);
    await page.goto('/tai-khoan/vi-tubu');
    await expect(page.getByRole('heading', { name: 'Ví Tubu', level: 1 })).toBeVisible();
    await expect(page.getByText('1.250.000đ').first()).toBeVisible();
    await expect(page.getByText('trong đó 119 điểm không hết hạn')).toBeVisible();
    await expect(page.getByText('Rút về ngân hàng', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Xem thêm' }).click();
    await expect(page.getByText('Số dư 1.300.000đ')).toBeVisible();
  });

  test('không còn nút hay sheet rút về ngân hàng, không gọi POST /wallet/withdraw', async ({ page, api }) => {
    mockWallet(api);
    await page.goto('/tai-khoan/vi-tubu');
    await expect(page.getByText('Ví Tubu (số dư khả dụng)')).toBeVisible();
    await expect(page.getByRole('button', { name: /Rút/ })).toHaveCount(0);
    await expect(page.getByText('Dùng để trả tiền hàng ở bước thanh toán')).toBeVisible();
    expect(api.callsTo('POST', '/wallet/withdraw')).toHaveLength(0);
  });

  test('khách chưa đăng nhập được mời đăng nhập, không gọi API ví', async ({ page, api }) => {
    api.post('/auth/refresh', () => reply(401, { message: 'Hết phiên' }));
    await page.goto('/tai-khoan/vi-tubu');
    await expect(page.getByRole('main').getByRole('link', { name: /Đăng nhập/ })).toBeVisible();
    expect(api.callsTo('GET', '/me/wallet')).toHaveLength(0);
  });
});

/**
 * Web khách: Kho quà (/kho-qua), Quà của tôi (/kho-qua/cua-toi) và Hoàn tiền (/hoan-tien). Đổi quà gửi đúng một POST redeem
 * kèm Idempotency-Key dù bấm đúp; Hoàn tiền gửi POST /cashback/click rồi mở link đối tác ở tab mới.
 */
const CLAIM_POINT = {
  name: 'Kho Tubu TP.HCM', addressLine: '99 Nguyễn Văn Linh', communeName: 'Phường Tân Phong', provinceName: 'TP.HCM',
  openingHours: { MON: [{ open: '08:00', close: '17:00' }] },
};
const REWARD_ITEMS = [
  { id: 'reward-freeship', kind: 'VOUCHER', name: 'Miễn phí vận chuyển', description: 'Đơn từ 99.000đ', label: null, pointsCost: 20_000, imageUrl: null, stockRemaining: null, soldOut: false, canRedeem: true, claimInstructions: null, voucher: { type: 'FREESHIP', value: 0, minOrder: 99000, maxDiscount: null, validDays: 30 }, sortOrder: 1 },
  { id: 'reward-discount-50k', kind: 'VOUCHER', name: 'Giảm 50.000đ', description: 'Đơn từ 300.000đ', label: null, pointsCost: 50_000, imageUrl: null, stockRemaining: null, soldOut: false, canRedeem: false, claimInstructions: null, voucher: { type: 'AMOUNT', value: 50000, minOrder: 300000, maxDiscount: null, validDays: 30 }, sortOrder: 2 },
  { id: 'gift-seed', kind: 'SEED_PACK', name: 'Gói hạt giống Tubu', description: 'Hạt rau mầm', label: null, pointsCost: 25_000, imageUrl: null, stockRemaining: 3, soldOut: false, canRedeem: true, claimInstructions: 'Nhận tại kho Tubu TP.HCM', voucher: null, sortOrder: 4 },
];
const REDEMPTION = {
  id: 'red-1', giftId: 'gift-seed', giftKind: 'SEED_PACK', giftName: 'Gói hạt giống Tubu', pointsCost: 25_000, status: 'READY', code: 'QG-8K2M9P4T',
  claimExpiresAt: '2026-12-16T17:30:00.000Z', claimPoint: CLAIM_POINT, fulfilledAt: null, cancelledAt: null, cancelReason: null, refundedPoints: null, couponCode: null, createdAt: '2026-10-17T03:00:00.000Z',
};

function mockRewards(api: MockApi, state: { redeemed: boolean }) {
  api.post('/auth/refresh', () => ({ accessToken: 'e2e-token', user: USER }));
  api.get('/me', () => USER);
  api.get('/config/public', { freeshipThreshold: 500000, waste: { enabled: false, dropoff: false, mailin: false, pickup: false } });
  api.get('/me/loyalty', { pointsBalance: 30_000, pointsConvertedBalance: 5000, lockedPoints: 0, redeemablePoints: 30_000, tier: null, nextTier: null, tiers: TIERS });
  api.get('/me/loyalty/rewards', () => ({
    pointsBalance: state.redeemed ? 10_000 : 30_000, pointsConvertedBalance: 5000, lockedPoints: 0, redeemablePoints: state.redeemed ? 10_000 : 30_000,
    giftClaimDays: 60, claimPoint: CLAIM_POINT, rewards: REWARD_ITEMS,
  }));
  api.get('/me/loyalty/rewards/mine', () => [REDEMPTION]);
  api.post('/me/loyalty/rewards/:id/redeem', () => {
    state.redeemed = true;
    return {
      success: true, message: 'ok', pointsSpent: 20_000, remainingPoints: 10_000,
      redemption: { ...REDEMPTION, giftKind: 'VOUCHER', status: 'FULFILLED', code: null, couponCode: 'FREESHIP-ABC', claimPoint: null },
      coupon: { code: 'FREESHIP-ABC', type: 'FREESHIP', value: 0, minOrder: 99000, maxDiscount: null, endAt: '2026-11-16T16:59:59.000Z' },
    };
  });
}

const CASHBACK_MERCHANTS = [{ id: 'm1', slug: 'shopee', name: 'Shopee', logoUrl: '', category: 'mall', baseRate: '0.05', terms: 'Không áp dụng đơn hoàn huỷ.' }];

test.describe('Web khách: Kho quà và Hoàn tiền', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('tubu_web_session', '1');
      } catch {
        // không có localStorage: spec vẫn chạy, chỉ không có phiên khôi phục
      }
    });
  });

  test('Kho quà: số dư hai lô, thẻ đủ điểm và thiếu điểm theo tab', async ({ page, api }) => {
    mockRewards(api, { redeemed: false });
    await page.goto('/kho-qua');
    await expect(page.getByRole('heading', { name: 'Kho quà', level: 1 })).toBeVisible();
    await expect(page.getByText('35.000 điểm')).toBeVisible();
    await expect(page.getByText('Cần thêm 20.000 điểm')).toBeVisible();
    await page.getByRole('tab', { name: 'Cây và hạt' }).click();
    await expect(page.getByText('Còn 3')).toBeVisible();
  });

  test('đổi mã giảm giá: bấm đúp chỉ gửi một POST redeem kèm Idempotency-Key, báo mã đã vào ví', async ({ page, api }) => {
    mockRewards(api, { redeemed: false });
    await page.goto('/kho-qua');
    await page.getByRole('button', { name: 'Đổi' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Xác nhận đổi quà' });
    await expect(dialog.getByText('-20.000 điểm')).toBeVisible();
    await dialog.getByRole('button', { name: 'Xác nhận đổi' }).dblclick();
    await expect(page.getByText('Mã FREESHIP-ABC đã vào ví mã giảm giá')).toBeVisible();
    const posts = api.callsTo('POST', '/me/loyalty/rewards/:id/redeem');
    expect(posts).toHaveLength(1);
    expect(posts[0]!.path).toBe('/me/loyalty/rewards/reward-freeship/redeem');
    expect(posts[0]!.headers['idempotency-key']).toBeTruthy();
  });

  test('Quà của tôi: mã QG- cỡ lớn, QR, nơi nhận và hạn nhận', async ({ page, api }) => {
    mockRewards(api, { redeemed: false });
    await page.goto('/kho-qua/cua-toi');
    await expect(page.getByRole('heading', { name: 'Quà của tôi', level: 1 })).toBeVisible();
    await expect(page.getByText('QG-8K2M9P4T', { exact: true })).toBeVisible();
    await expect(page.getByRole('img', { name: 'QR' })).toBeVisible();
    await expect(page.getByText('Nhận tại Kho Tubu TP.HCM')).toBeVisible();
    await expect(page.getByText('Hạn nhận 17/12/2026')).toBeVisible();
  });

  test('khách chưa đăng nhập xem được quà và có nút Đăng nhập để đổi, không có nút Đổi, không gọi API kho quà', async ({ page, api }) => {
    api.post('/auth/refresh', () => reply(401, { message: 'Hết phiên' }));
    api.get('/loyalty/preview', GUEST_PREVIEW);
    await page.goto('/kho-qua');
    await expect(page.getByRole('main').getByRole('link', { name: 'Đăng nhập để đổi' })).toBeVisible();
    await expect(page.getByText('Miễn phí vận chuyển')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Đổi', exact: true })).toHaveCount(0);
    expect(api.callsTo('GET', '/me/loyalty/rewards')).toHaveLength(0);
  });

  test('Hoàn tiền: chọn sàn, POST /cashback/click đúng merchantId rồi mở link đối tác ở tab mới', async ({ page, api, context }) => {
    api.post('/auth/refresh', () => ({ accessToken: 'e2e-token', user: USER }));
    api.get('/me', () => USER);
    api.get('/config/public', { freeshipThreshold: 500000, cashbackHoldDays: 45, waste: { enabled: false, dropoff: false, mailin: false, pickup: false } });
    api.get('/cashback/merchants', CASHBACK_MERCHANTS);
    api.get('/cashback/transactions', []);
    api.get('/me/wallet', { walletBalance: 0, cashbackPending: 123_000, commissionApproved: 0, commissionPending: 0 });
    api.post('/cashback/click', () => ({ deeplink: 'https://example.com/aff/abc' }));
    await context.route('https://example.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Sàn</title>' }));
    await page.goto('/hoan-tien');
    await expect(page.getByText('123.000đ')).toBeVisible();
    await page.getByRole('button', { name: /Shopee/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Shopee' });
    await expect(dialog.getByText('Sàn xác nhận đơn → hoàn tiền vào Ví Tubu (sau 45 ngày)')).toBeVisible();
    const popupPromise = context.waitForEvent('page');
    await dialog.getByRole('button', { name: 'Mua sắm & nhận hoàn tiền' }).click();
    const popup = await popupPromise;
    await popup.waitForURL('https://example.com/aff/abc');
    expect(popup.url()).toBe('https://example.com/aff/abc');
    expect(await popup.evaluate(() => window.opener)).toBeNull();
    expect(api.callsTo('POST', '/cashback/click')[0]!.body).toEqual({ merchantId: 'm1' });
  });
});

/**
 * Khung khu tài khoản từ 1024px: khách có cookie phiên thấy khung hai cột ngay HTML đầu (SSR đọc cookie), nên nội dung không dịch ngang
 * khi phiên khôi phục xong; khách vãng lai không có cookie thì không có khung. Giữ /auth/refresh lại để đo đúng lúc "đang khôi phục".
 */
test.describe('Web khách: khung tài khoản không nhảy ngang khi khôi phục phiên (lg)', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  const mainLeft = (page: import('@playwright/test').Page) =>
    page.evaluate(() => Math.round(document.querySelector('main')!.getBoundingClientRect().left));

  for (const path of ['/tai-khoan/vi-tubu', '/kho-qua']) {
    test(`${path}: có cookie phiên, main đứng đúng chỗ ở HTML đầu và sau khi phiên về`, async ({ page, context, api, baseURL }) => {
      test.skip(test.info().project.name !== 'Web Customer', 'chỉ đo bố cục máy tính');
      if (path === '/kho-qua') mockRewards(api, { redeemed: false });
      else mockWallet(api);
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      api.post('/auth/refresh', async () => {
        await gate;
        return { accessToken: 'e2e-token', user: USER };
      });
      await context.addCookies([{ name: 'tubu_web_session', value: '1', url: baseURL! }]);
      await page.addInitScript(() => localStorage.setItem('tubu_web_session', '1'));

      await page.goto(path, { waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('account-shell-nav-skeleton')).toBeVisible();
      const first = await mainLeft(page);
      release();
      await expect(page.getByTestId('account-shell-nav')).toBeVisible();
      await expect(page.getByRole('main').first()).toBeVisible();
      expect(await mainLeft(page)).toBe(first);
    });
  }

  test('khách vãng lai (không cookie, không cờ): không có khung khôi phục', async ({ page, api }) => {
    test.skip(test.info().project.name !== 'Web Customer', 'chỉ đo bố cục máy tính');
    mockWallet(api);
    await page.goto('/tai-khoan/vi-tubu');
    await expect(page.getByTestId('account-shell-nav-skeleton')).toHaveCount(0);
    await expect(page.getByTestId('account-shell-nav')).toHaveCount(0);
  });
});
