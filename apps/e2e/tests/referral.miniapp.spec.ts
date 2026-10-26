import type { ReferralOverview, WalletSummary, LoyaltyOverview } from '../../miniapp/src/services/account-api';
import { test, expect, makeUser, mockSession, reply, type MockApi } from './support/mock-api';

/**
 * Zalo Mini App E2E — Giới thiệu bạn bè. Không có trang riêng: khối "Mời bạn bè mua hàng" (mã, chia sẻ, số bạn thành công)
 * nằm ở /profile (apps/miniapp/src/pages/profile.tsx, GET /me/referral). Trang Ví không còn khối này.
 */

const WALLET: WalletSummary = {
  walletBalance: 0,
  cashbackPending: 0,
  commissionApproved: 0,
  commissionPending: 0,
};

const LOYALTY: LoyaltyOverview = {
  pointsBalance: 50,
  pointsConvertedBalance: 0,
  tierPoints: 50,
  tier: { id: 'tier-1', name: 'Mầm Xanh', multiplier: 1, perks: [] },
  nextTier: { id: 'tier-2', name: 'Lộc Biếc', minPoints: 500, pointsToGo: 450 },
  tiers: [
    { id: 'tier-1', name: 'Mầm Xanh', minPoints: 0, multiplier: 1 },
    { id: 'tier-2', name: 'Lộc Biếc', minPoints: 500, multiplier: 1.2 },
  ],
};

const REFERRAL: ReferralOverview = {
  referralCode: 'BANBE77',
  successCount: 2,
  earnedPoints: 40,
  milestones: [{ count: 5, bonusPoints: 100 }],
  nextMilestone: { count: 5, bonusPoints: 100 },
  minOrderAmount: 250_000,
  windowDays: 14,
};

function mockProfilePage(api: MockApi, referral: unknown = REFERRAL, role: 'CUSTOMER' | 'AFFILIATE' = 'CUSTOMER') {
  mockSession(api, makeUser({ id: 'user-ref', role, referralCode: 'BANBE77' }));
  api.get('/me/wallet', WALLET);
  api.get('/me/loyalty', LOYALTY);
  api.get('/me/referral', referral as object);
  api.get('/auth/me', { ownsBrand: false });
  api.allowUnmocked('GET /affiliate/me', 'GET /me/coupons', 'GET /me/notifications', 'GET /notifications', 'GET /brand/owner/me', 'GET /dealer/me');
}

test.describe('Giới thiệu bạn bè', () => {
  test('hiện mã, điều kiện thưởng, số bạn thành công và tiến độ tới mốc kế tiếp từ API', async ({ page, api }) => {
    mockProfilePage(api);
    await page.goto('/profile');

    await expect(page.getByRole('heading', { name: 'Mời bạn bè mua hàng' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('BANBE77', { exact: true })).toBeVisible();
    await expect(page.getByText(/250\.000/)).toBeVisible();
    await expect(page.getByText(/trong 14 ngày/)).toBeVisible();
    await expect(page.getByText('Đã mời thành công 2 bạn, nhận 40 điểm.')).toBeVisible();
    await expect(page.getByText('Mời thêm 3 bạn để nhận 100 điểm')).toBeVisible();
  });

  test('chưa có ai giới thiệu và hết mốc: vẫn hiện mã, số 0, không còn dòng "Mời thêm"', async ({ page, api }) => {
    mockProfilePage(api, { ...REFERRAL, successCount: 0, earnedPoints: 0, milestones: [], nextMilestone: null });
    await page.goto('/profile');

    await expect(page.getByText('BANBE77', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Đã mời thành công/)).toHaveCount(0);
    await expect(page.getByText(/Mời thêm \d+ bạn/)).toHaveCount(0);
  });

  test('chia sẻ: lời gọi share sheet hợp lệ nên không báo lỗi chia sẻ và Ví vẫn dùng được', async ({ page, api }) => {
    mockProfilePage(api);
    await page.goto('/profile');

    await page.getByRole('button', { name: 'Chia sẻ', exact: true }).click({ timeout: 15_000 });
    // Trước đây thumbnail thiếu làm zmp-sdk từ chối (zod) nên luôn rơi vào thông báo dự phòng. Nay payload hợp lệ, SDK
    // ngoài Zalo trả về bình thường: không có thông báo lỗi, nút vẫn bấm được. Nhánh dự phòng (SDK từ chối → chép
    // liên kết + báo; người dùng huỷ → im lặng) do wallet.spec.tsx kiểm, vì e2e không ép được SDK từ chối.
    await page.waitForTimeout(500);
    await expect(page.getByText(/Chưa chia sẻ được qua Zalo|Mã giới thiệu của bạn/)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Chia sẻ', exact: true })).toBeEnabled();
    await expect(page.getByText('BANBE77', { exact: true })).toBeVisible();
  });

  test('/me/referral lỗi 500: vẫn có mã của khách, không có số liệu và không hứa con số', async ({ page, api }) => {
    mockProfilePage(api, reply(500, { message: 'Lỗi tạm thời' }));
    await page.goto('/profile');

    await expect(page.getByText('BANBE77', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Đã mời thành công/)).toHaveCount(0);
    await expect(page.getByText('Bạn nhận Điểm Xanh khi bạn bè vào app bằng mã của bạn và mua hàng.')).toBeVisible();
  });

  test('CTV (AFFILIATE) không thấy số liệu Điểm Xanh giới thiệu vì API không thưởng cho role này', async ({ page, api }) => {
    mockProfilePage(api, REFERRAL, 'AFFILIATE');
    await page.goto('/profile');

    await expect(page.getByText('BANBE77', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Đã mời thành công/)).toHaveCount(0);
  });

  test('hồ sơ: chạm mã giới thiệu báo đã sao chép; clipboard bị từ chối thì báo mã để chép tay', async ({ page, api }) => {
    mockSession(api, makeUser({ id: 'user-ref', referralCode: 'BANBE77' }));
    api.get('/me/loyalty', LOYALTY);
    api.get('/me/wallet', WALLET);
    api.get('/me/referral', { ...REFERRAL, referralCode: 'BANBE77' });
    api.get('/auth/me', { ownsBrand: false });
    api.allowUnmocked('GET /me/coupons', 'GET /me/notifications', 'GET /notifications', 'GET /brand/owner/me', 'GET /dealer/me');
    await page.addInitScript(() => {
      (window as unknown as { __copyOk: boolean }).__copyOk = true;
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: (t: string) =>
            (window as unknown as { __copyOk: boolean }).__copyOk
              ? ((window as unknown as { __copied: string }).__copied = t, Promise.resolve())
              : Promise.reject(new Error('denied')),
        },
      });
      document.execCommand = () => false;
    });
    await page.goto('/profile');

    const copy = page.getByRole('button', { name: /Sao chép mã BANBE77/ });
    await copy.click({ timeout: 15_000 });
    await expect(page.getByText('Đã sao chép mã giới thiệu')).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __copied: string }).__copied)).toBe('BANBE77');

    await page.evaluate(() => ((window as unknown as { __copyOk: boolean }).__copyOk = false));
    await copy.click();
    await expect(page.getByText('Không sao chép được — mã của bạn: BANBE77')).toBeVisible();
  });
});
