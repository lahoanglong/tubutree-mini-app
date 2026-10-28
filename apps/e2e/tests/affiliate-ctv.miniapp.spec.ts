import type { CtvMilestoneItem, CtvMilestonesResponse } from '../../miniapp/src/services/affiliate-api';
import { test, expect, makeUser, mockSession, reply, type MockApi } from './support/mock-api';
import { CTV_MILESTONES, MILESTONE_3M, mockAffiliateDashboard } from './support/affiliate-mocks';

/**
 * Zalo Mini App E2E — Dashboard CTV: bậc doanh số + thưởng mốc Điểm Xanh
 * (apps/miniapp/src/pages/affiliate.tsx; route affiliate.controller.ts: GET /affiliate/tiers,
 * GET /affiliate/milestones, POST /affiliate/milestones/:id/claim body { month }).
 *
 * Bậc chỉ là danh hiệu (không hứa "+X% hoa hồng"); thưởng thật là Điểm Xanh khi đạt mốc doanh số ĐÃ
 * CHỐT. Mock có trạng thái: nhận xong thì GET /affiliate/milestones trả claimed:true như backend.
 */

function mockCtv(api: MockApi, previous: CtvMilestonesResponse['previousMonth'] = null) {
  mockSession(api, makeUser({ id: 'aff-1', role: 'AFFILIATE', fullName: 'Affiliate 1', referralCode: 'AFF1' }));
  const claimed = new Set<string>();
  const mark = (m: CtvMilestoneItem, month: string): CtvMilestoneItem =>
    claimed.has(`${m.id}:${month}`) ? { ...m, claimed: true, canClaim: false } : m;
  mockAffiliateDashboard(api, {
    milestones: () => {
      // Như affiliate.service getMilestones: tháng trước chỉ trả mốc CÒN nhận được, hết thì null.
      const prevLeft = previous
        ? previous.milestones.map((m) => mark(m, previous.monthKey)).filter((m) => m.canClaim)
        : [];
      return {
        ...CTV_MILESTONES,
        milestones: CTV_MILESTONES.milestones.map((m) => mark(m, CTV_MILESTONES.monthKey)),
        previousMonth: previous && prevLeft.length > 0 ? { ...previous, milestones: prevLeft } : null,
      };
    },
  });
  api.post('/affiliate/milestones/:id/claim', ({ params, call }) => {
    const month = (call.body as { month?: string } | undefined)?.month ?? CTV_MILESTONES.monthKey;
    const key = `${params.id}:${month}`;
    if (claimed.has(key)) return reply(400, { message: 'Bạn đã nhận thưởng mốc này rồi.' });
    claimed.add(key);
    return {
      success: true,
      message: `Chúc mừng bạn đã nhận 50 Điểm Xanh từ ${MILESTONE_3M.title}!`,
      rewardPoints: MILESTONE_3M.rewardPoints,
      monthKey: month,
    };
  });
}

test.describe('Dashboard CTV — bậc doanh số & thưởng mốc Điểm Xanh', () => {
  test('Bậc CTV theo doanh số đã chốt + bảng 5 bậc kèm thưởng mốc Điểm Xanh (không hứa % bonus)', async ({ page, api }) => {
    mockCtv(api);
    await page.goto('/affiliate');

    await expect(page.getByText('CTV Đồng')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Bậc theo doanh số đã chốt tháng này')).toBeVisible();
    await expect(page.getByText('doanh số đã chốt để lên bậc Bạc', { exact: false })).toBeVisible();

    await page.getByText('Bảng 5 bậc CTV & thưởng mốc Điểm Xanh').click();
    await expect(page.getByText('Đồng (Hiện tại)')).toBeVisible();
    await expect(page.getByText('Bậc khởi đầu')).toBeVisible();
    await expect(page.getByText('Thưởng mốc +50 điểm')).toBeVisible();
    await expect(page.getByText('Thưởng mốc +2.000 điểm')).toBeVisible();
    await expect(page.getByText('DS từ 10.000.000đ')).toBeVisible();
    await expect(page.getByText(/bonus/i)).toHaveCount(0);
  });

  test('Nhận thưởng mốc tháng này → POST đúng mốc + tháng, nút chuyển "Đã nhận"', async ({ page, api }) => {
    mockCtv(api);
    await page.goto('/affiliate');

    await expect(page.getByText('Thưởng mốc doanh số tháng')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('tháng 9/2026 · Đã chốt 3.200.000đ')).toBeVisible();
    await expect(page.getByText('Đang chờ chốt:', { exact: false })).toBeVisible();
    // Mốc 10tr chưa đạt → không có nút nhận, ghi số còn thiếu theo doanh số ĐÃ CHỐT.
    await expect(page.getByText('Còn thiếu 6.800.000đ doanh số đã chốt')).toBeVisible();

    const claim = page.getByRole('button', { name: 'Nhận thưởng' });
    await expect(claim).toHaveCount(1);
    const posted = api.waitForCall('POST', '/affiliate/milestones/:id/claim');
    await claim.click();
    const call = await posted;
    expect(call.path).toBe('/affiliate/milestones/milestone-3m/claim');
    expect(call.body).toEqual({ month: '2026-09' });

    await expect(page.getByText('Chúc mừng bạn đã nhận 50 Điểm Xanh', { exact: false })).toBeVisible({ timeout: 5_000 });
    await page.getByRole('button', { name: /Xem tất cả \d+ mốc/ }).click();
    await expect(page.getByText('Đã nhận', { exact: true })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('Đã cộng vào Điểm Xanh')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Nhận thưởng' })).toHaveCount(0);
    expect(api.callsTo('POST', '/affiliate/milestones/:id/claim')).toHaveLength(1);
  });

  test('Mốc tháng trước còn hạn: gửi kèm month của tháng trước', async ({ page, api }) => {
    mockCtv(api, { monthKey: '2026-08', revenue: 3_500_000, milestones: [MILESTONE_3M] });
    await page.goto('/affiliate');

    await expect(page.getByText('Thưởng tháng 8/2026 chưa nhận', { exact: false })).toBeVisible({ timeout: 15_000 });
    // 2 nút "Nhận thưởng": tháng trước (hiện trước) và tháng này; từ 2 mốc nhận được có thêm "Nhận tất cả".
    const buttons = page.getByRole('button', { name: 'Nhận thưởng' });
    await expect(buttons).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Nhận tất cả (2 mốc, +100 điểm)' })).toBeVisible();

    const posted = api.waitForCall('POST', '/affiliate/milestones/:id/claim');
    await buttons.first().click();
    const call = await posted;
    expect(call.body).toEqual({ month: '2026-08' });
    // Đã nhận hết mốc tháng trước → khối tháng trước biến mất, còn nút của tháng này.
    await expect(page.getByText('Thưởng tháng 8/2026 chưa nhận', { exact: false })).toHaveCount(0, { timeout: 5_000 });
    await expect(page.getByRole('button', { name: 'Nhận thưởng' })).toHaveCount(1);
    await expect(page.getByRole('button', { name: /Nhận tất cả/ })).toHaveCount(0);
  });

  test('Nhận tất cả: gọi lần lượt từng mốc, tháng trước trước, rồi báo số mốc đã nhận', async ({ page, api }) => {
    mockCtv(api, { monthKey: '2026-08', revenue: 3_500_000, milestones: [MILESTONE_3M] });
    await page.goto('/affiliate');

    await page.getByRole('button', { name: /Nhận tất cả/ }).click({ timeout: 15_000 });
    await expect(page.getByText('Đã nhận 2 mốc thưởng.')).toBeVisible({ timeout: 5_000 });
    const calls = api.callsTo('POST', '/affiliate/milestones/:id/claim');
    expect(calls.map((c) => (c.body as { month: string }).month)).toEqual(['2026-08', '2026-09']);
    await expect(page.getByRole('button', { name: 'Nhận thưởng' })).toHaveCount(0);
  });
});
