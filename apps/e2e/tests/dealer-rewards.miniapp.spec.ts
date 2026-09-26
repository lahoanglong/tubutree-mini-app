import type {
  DealerMe,
  DealerRewardClaimResult,
  DealerRewardClaimStatus,
  DealerRewardProgress,
  DealerRewardsView,
  QuarterlyReport,
} from '../../miniapp/src/services/dealer-api';
import { test, expect, makeUser, mockSession, type MockApi } from './support/mock-api';

/**
 * Zalo Mini App E2E — Phần thưởng đại lý (tour/quà) ở tab "Báo cáo" của /dealer
 * (apps/miniapp/src/pages/dealer.tsx DealerRewardsCard; route dealer.controller.ts:
 * GET /dealer/rewards, POST /dealer/rewards/:id/claim body { periodKey }).
 *
 * Yêu cầu nhận thưởng là bản ghi THẬT (DealerRewardClaim PENDING → APPROVED/REJECTED → PAID), UI rẽ
 * nhánh theo claimStatus của backend: đã có yêu cầu thì KHÔNG bao giờ hiện lại nút.
 */

const DEALER_ME: DealerMe = {
  isDealer: true,
  status: 'APPROVED',
  tier: { id: 'dt-1', name: 'Đại lý Vàng', creditLimit: 50_000_000 },
  currentDebt: 2_000_000,
};

const REPORT: QuarterlyReport = {
  quarter: 'Q3/2026',
  periodStart: '2026-06-30T17:00:00.000Z',
  periodEnd: '2026-09-30T17:00:00.000Z',
  revenue: 120_000_000,
  orderCount: 14,
  pendingRevenue: 5_000_000,
  pendingOrderCount: 1,
  bonusPct: 2,
  bonusAmount: 2_400_000,
  nextTier: { min: 200_000_000, pct: 3, toNext: 80_000_000 },
  tiers: [
    { min: 100_000_000, pct: 2 },
    { min: 200_000_000, pct: 3 },
  ],
};

function progress(over: Partial<DealerRewardProgress> & Pick<DealerRewardProgress, 'id' | 'title'>): DealerRewardProgress {
  return {
    type: 'TOUR',
    description: null,
    threshold: 100_000_000,
    period: 'QUARTER',
    periodKey: 'Q3/2026',
    periodLabel: 'Quý 3/2026',
    isCurrentPeriod: true,
    volume: 120_000_000,
    pendingVolume: 0,
    achieved: true,
    toGo: 0,
    claimStatus: null,
    claimId: null,
    rejectionReason: null,
    claimDeadline: '2026-10-30T17:00:00.000Z',
    canClaim: true,
    ...over,
  };
}

const TOUR = progress({ id: 'rw-tour', title: 'Tour Đà Nẵng 3N2Đ', description: 'Cho 2 người, bay khứ hồi' });
const GIFT = progress({
  id: 'rw-gift',
  type: 'GIFT',
  title: 'Máy lọc nước cao cấp',
  threshold: 140_000_000,
  achieved: false,
  canClaim: false,
  toGo: 20_000_000,
  pendingVolume: 5_000_000,
});
const PREV = progress({
  id: 'rw-prev',
  type: 'OTHER',
  title: 'Thưởng nóng quý 2',
  periodKey: 'Q2/2026',
  periodLabel: 'Quý 2/2026',
  isCurrentPeriod: false,
  // Mốc LOẠI TRỪ: 00:00 giờ VN 01/08/2026 → hạn cuối "hết ngày 31/07/2026".
  claimDeadline: '2026-07-31T17:00:00.000Z',
});
const APPROVED = progress({
  id: 'rw-approved',
  type: 'GIFT',
  title: 'Bộ quà Tết',
  claimStatus: 'APPROVED',
  claimId: 'cl-approved',
  canClaim: false,
});
const REJECTED = progress({
  id: 'rw-rejected',
  type: 'GIFT',
  title: 'Voucher du lịch',
  claimStatus: 'REJECTED',
  claimId: 'cl-rejected',
  canClaim: false,
  rejectionReason: 'Doanh số chưa đủ sau đối soát',
});

function mockDealer(api: MockApi): void {
  mockSession(api, makeUser({ id: 'dealer-1', role: 'DEALER', fullName: 'Đại Lý Xanh' }));
  api.get('/dealer/me', DEALER_ME);
  api.get('/dealer/pricelist', []);
  api.get('/dealer/templates', []);
  api.get('/dealer/quarterly-report', REPORT);

  // Có trạng thái: POST tạo yêu cầu PENDING, GET sau đó trả claimStatus như backend (idempotent).
  const claims = new Map<string, DealerRewardClaimStatus>();
  const withClaims = (r: DealerRewardProgress): DealerRewardProgress => {
    const st = claims.get(`${r.id}|${r.periodKey}`);
    return st ? { ...r, claimStatus: st, claimId: `cl-${r.id}`, canClaim: false } : r;
  };
  api.get('/dealer/rewards', (): DealerRewardsView => ({
    quarter: 'Q3/2026',
    year: 2026,
    quarterVolume: 120_000_000,
    yearVolume: 300_000_000,
    quarterPendingVolume: 5_000_000,
    yearPendingVolume: 5_000_000,
    claimGraceDays: 30,
    rewards: [TOUR, GIFT, PREV, APPROVED, REJECTED].map(withClaims),
  }));
  api.post('/dealer/rewards/:id/claim', ({ params, call }): DealerRewardClaimResult => {
    const r = [TOUR, PREV].find((x) => x.id === params.id)!;
    const periodKey = (call.body as { periodKey?: string }).periodKey ?? r.periodKey;
    const key = `${r.id}|${periodKey}`;
    const alreadyClaimed = claims.has(key);
    claims.set(key, 'PENDING');
    return {
      success: true,
      alreadyClaimed,
      claimStatus: 'PENDING',
      message: `Đã gửi yêu cầu nhận "${r.title}" (${r.periodLabel}). Tubu Tree sẽ xét duyệt và báo kết quả trong mục Thông báo của app.`,
      claim: { id: `cl-${r.id}`, status: 'PENDING', periodKey, volumeAtClaim: r.volume, createdAt: '2026-09-20T09:00:00.000Z' },
      reward: { id: r.id, title: r.title, type: r.type, threshold: r.threshold },
      periodKey,
      periodLabel: r.periodLabel,
      currentVolume: r.volume,
    };
  });
}

/**
 * Dòng phần thưởng: div SÂU NHẤT có cả tiêu đề (đầu dòng) lẫn dòng gợi ý trạng thái (cuối dòng) —
 * header chỉ có tiêu đề, footer chỉ có gợi ý, nên phần tử khớp cuối cùng chính là dòng đó.
 */
function rewardRow(page: import('@playwright/test').Page, title: string) {
  const esc = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return page
    .locator('div')
    .filter({ hasText: new RegExp(`${esc}[\\s\\S]*(Đã đạt|Đã gửi yêu cầu|Tubu Tree sẽ)`) })
    .last();
}

test.describe('Đại lý — yêu cầu nhận thưởng mốc doanh số', () => {
  test.beforeEach(async ({ page, api }) => {
    mockDealer(api);
    await page.goto('/dealer');
    await expect(page.getByText('Đại lý Vàng')).toBeVisible({ timeout: 15_000 });
    await page.getByText('Báo cáo', { exact: true }).click();
    await expect(page.getByText('Phần thưởng đại lý')).toBeVisible({ timeout: 10_000 });
  });

  test('Hiển thị đúng trạng thái theo claimStatus / đạt mốc / kỳ trước', async ({ page }) => {
    // Chưa đạt: số còn thiếu + phần đang chờ thanh toán/đóng gói (chưa tính).
    await expect(page.getByText('Còn 20.000.000đ để đạt · 5.000.000đ đang chờ thanh toán/đóng gói')).toBeVisible();
    // Kỳ trước còn trong thời gian gia hạn → vẫn gửi được, ghi rõ hạn chót.
    await expect(page.getByText('Kỳ trước · Quý 2/2026')).toBeVisible();
    await expect(page.getByText('Đã đạt 🎉 · hạn gửi yêu cầu: hết ngày 31/07/2026')).toBeVisible();
    // Đã có yêu cầu → badge theo trạng thái, không có nút.
    await expect(page.getByText('Đã duyệt · chờ trao thưởng')).toBeVisible();
    await expect(page.getByText('Yêu cầu bị từ chối')).toBeVisible();
    await expect(page.getByText('Lý do: Doanh số chưa đủ sau đối soát')).toBeVisible();
    // Chỉ 2 dòng được bấm: Tour (kỳ này, đạt) + Thưởng nóng quý 2 (kỳ trước, còn hạn).
    await expect(page.getByRole('button', { name: 'Yêu cầu nhận thưởng' })).toHaveCount(2);
    await expect(page.getByText('Mốc đạt trong kỳ vẫn gửi yêu cầu được trong 30 ngày', { exact: false })).toBeVisible();
  });

  test('Gửi yêu cầu kỳ này → POST kèm periodKey, dòng chuyển "chờ duyệt" và mất nút', async ({ page, api }) => {
    const row = rewardRow(page, TOUR.title);
    const posted = api.waitForCall('POST', '/dealer/rewards/:id/claim');
    await row.getByRole('button', { name: 'Yêu cầu nhận thưởng' }).click();
    const call = await posted;
    expect(call.path).toBe('/dealer/rewards/rw-tour/claim');
    expect(call.body).toEqual({ periodKey: 'Q3/2026' });

    await expect(page.getByText(`Đã gửi yêu cầu nhận "${TOUR.title}"`, { exact: false })).toBeVisible({ timeout: 5_000 });
    await expect(row.getByText('Đã gửi yêu cầu · chờ duyệt')).toBeVisible({ timeout: 5_000 });
    await expect(row.getByRole('button', { name: 'Yêu cầu nhận thưởng' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Yêu cầu nhận thưởng' })).toHaveCount(1);
  });

  test('Gửi yêu cầu cho kỳ trước → periodKey của kỳ trước (Q2/2026)', async ({ page, api }) => {
    const row = rewardRow(page, PREV.title);
    const posted = api.waitForCall('POST', '/dealer/rewards/:id/claim');
    await row.getByRole('button', { name: 'Yêu cầu nhận thưởng' }).click();
    const call = await posted;
    expect(call.path).toBe('/dealer/rewards/rw-prev/claim');
    expect(call.body).toEqual({ periodKey: 'Q2/2026' });
    await expect(row.getByText('Đã gửi yêu cầu · chờ duyệt')).toBeVisible({ timeout: 5_000 });
  });
});
