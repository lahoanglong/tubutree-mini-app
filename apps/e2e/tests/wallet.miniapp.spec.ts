import type {
  LoyaltyOverview,
  ReferralOverview,
  WalletSummary,
  WalletTxnPage,
} from '../../miniapp/src/services/account-api';
import { test, expect, makeUser, mockSession } from './support/mock-api';

/**
 * Zalo Mini App E2E - Ví Tubu sau khi TubuXu gộp vào Điểm Xanh (PD-3, Q-03/Q-26).
 * Trang /wallet (apps/miniapp/src/pages/wallet.tsx) gọi: GET /me/wallet, /me/referral, /me/loyalty,
 * /me/wallet/transactions (route NestJS: wallet.controller.ts, loyalty.controller.ts).
 *
 * Kiểm: không còn thẻ TubuXu, nút/sheet "Đổi Ví → TubuXu" hay mẹo ×1,2; Điểm Xanh là MỘT số (thường + quy
 * đổi) kèm dòng "trong đó N điểm không hết hạn"; khối mời bạn đọc /me/referral bằng đơn vị Điểm Xanh;
 * trang không gọi /me/coins (đã 410) hay /wallet/convert-xu.
 */

const WALLET: WalletSummary = {
  walletBalance: 350000,
  cashbackPending: 0,
  commissionApproved: 0,
  commissionPending: 0,
};

const LOYALTY: LoyaltyOverview = {
  pointsBalance: 120,
  pointsConvertedBalance: 30,
  tierPoints: 120,
  tier: { id: 'tier-1', name: 'Mầm Xanh', multiplier: 1, perks: [] },
  nextTier: { id: 'tier-2', name: 'Lộc Biếc', minPoints: 500, pointsToGo: 380 },
  tiers: [
    { id: 'tier-1', name: 'Mầm Xanh', minPoints: 0, multiplier: 1 },
    { id: 'tier-2', name: 'Lộc Biếc', minPoints: 500, multiplier: 1.2 },
  ],
};

const REFERRAL: ReferralOverview = {
  referralCode: 'E2EREF',
  successCount: 2,
  earnedPoints: 10,
  milestones: [{ count: 3, bonusPoints: 20 }],
  nextMilestone: { count: 3, bonusPoints: 20 },
};

const NO_TXNS: WalletTxnPage = { data: [], meta: { page: 1, limit: 20, total: 0 } };

test.describe('Zalo Mini App E2E - Ví Tubu (không còn TubuXu)', () => {
  test.beforeEach(async ({ api }) => {
    mockSession(api, makeUser({ id: 'user-wallet', fullName: 'Nguyễn Văn A', pointsBalance: 120, pointsConvertedBalance: 30, walletBalance: 350000 }));
    api.get('/me/wallet', WALLET);
    api.get('/me/loyalty', LOYALTY);
    api.get('/me/referral', REFERRAL);
    api.get('/me/wallet/transactions', NO_TXNS);
  });

  test('Ví chỉ còn tiền thật: không thẻ TubuXu, không nút đổi sang xu, không mẹo ×1,2', async ({ page, api }) => {
    await page.goto('/wallet');

    await expect(page.getByText('Ví Tubu (số dư khả dụng)')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('350.000đ').first()).toBeVisible();
    await expect(page.getByRole('button', { name: /Rút/ })).toHaveCount(0);

    await expect(page.getByText(/tubu ?xu/i)).toHaveCount(0);
    await expect(page.getByText(/(?<![\p{L}])xu(?![\p{L}])/iu)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Đổi/ })).toHaveCount(0);

    expect(api.callsTo('GET', '/me/coins')).toHaveLength(0);
    expect(api.callsTo('POST', '/wallet/convert-xu')).toHaveLength(0);
  });

  test('Điểm Xanh là tổng hai lô, ghi rõ phần không hết hạn không ra tiền; Mời bạn không còn nằm trong Ví', async ({ page }) => {
    await page.goto('/wallet');

    await expect(page.getByText('Điểm Xanh (đổi giảm giá)')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('150 điểm', { exact: true })).toBeVisible();
    await expect(page.getByText('trong đó 30 điểm không hết hạn')).toBeVisible();
    await expect(page.getByText('Không rút ra tiền.', { exact: false })).toBeVisible();

    await expect(page.getByText('Mời bạn — nhận Điểm Xanh')).toHaveCount(0);
    await expect(page.getByText(/Mời thêm \d+ bạn/)).toHaveCount(0);
  });
});
