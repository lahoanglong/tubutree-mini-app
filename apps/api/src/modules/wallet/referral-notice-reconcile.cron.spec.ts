import { MILESTONE_PREFIX } from './referral-reward';
import { ReferralNoticeReconcileCron, shownPointsMatch } from './referral-notice-reconcile.cron';

describe('shownPointsMatch', () => {
  it('khớp số điểm đúng đơn vị hiện tại', () => {
    expect(shownPointsMatch(20_000, '20.000')).toBe(true);
    expect(shownPointsMatch(20, '20')).toBe(true);
  });

  it('khớp số điểm của log cũ (đơn vị trước points_1d) nhân 1.000', () => {
    expect(shownPointsMatch(20_000, '20')).toBe(true);
    expect(shownPointsMatch(1_500_000, '1.500')).toBe(true);
  });

  it('không khớp số khác, rỗng hoặc thiếu', () => {
    expect(shownPointsMatch(20_000, '21')).toBe(false);
    expect(shownPointsMatch(20_000, '2.000')).toBe(false);
    expect(shownPointsMatch(20_000, '')).toBe(false);
    expect(shownPointsMatch(20_000, undefined)).toBe(false);
  });
});

describe('ReferralNoticeReconcileCron.milestoneCovered: log thông báo cũ', () => {
  const build = (shown: string) => {
    const reason = `${MILESTONE_PREFIX}owner:3`;
    const prisma = {
      pointsTransaction: { findMany: jest.fn().mockResolvedValue([{ id: 'p1', delta: 20_000, reason, createdAt: new Date('2026-10-18T10:00:00Z') }]) },
      notificationLog: { findMany: jest.fn().mockResolvedValue([{ payload: { data: { count: '3', points: shown } } }]) },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
    const cron = new ReferralNoticeReconcileCron(prisma as never);
    const covered = (cron as unknown as { milestoneCovered: (o: string, g: string[], f: Date, t: Date) => Promise<string[]> }).milestoneCovered(
      'owner',
      ['guest'],
      new Date('2026-10-18T00:00:00Z'),
      new Date('2026-10-19T00:00:00Z'),
    );
    return covered;
  };

  it('log ghi 20 (đơn vị cũ) cho dòng mốc 20.000 → coi là đã gửi', async () => {
    await expect(build('20')).resolves.toEqual(['p1']);
  });

  it('log ghi 20.000 (đơn vị mới) → coi là đã gửi', async () => {
    await expect(build('20.000')).resolves.toEqual(['p1']);
  });

  it('log ghi số khác → chưa gửi', async () => {
    await expect(build('25')).resolves.toEqual([]);
  });
});
