import { Logger } from '@nestjs/common';
import { CommunityRewardService } from './community-reward.service';

const EXP = new Date('2027-10-15T00:00:00Z');

function deps(over: Record<string, unknown> = {}) {
  const rewards = { grant: jest.fn().mockResolvedValue(true), expiresAt: jest.fn().mockResolvedValue(EXP) };
  const config = { get: jest.fn().mockImplementation(async (_k: string, f: unknown) => f) };
  // PD-3: trần/ngày đếm cả sổ xu cũ (thưởng trong ngày deploy) lẫn sổ điểm.
  const prisma: any = {
    coinTransaction: { count: jest.fn().mockResolvedValue(0) },
    pointsTransaction: { count: jest.fn().mockResolvedValue(0) },
    $queryRaw: jest.fn().mockResolvedValue([]),
  };
  // rewardPost/rewardAnswer chạy đếm-rồi-cấp TRONG $transaction(async tx => ...) sau khi khoá dòng users
  // — tx nhận CHÍNH prisma mock này nên tx.*.count dùng chung mock ở trên.
  prisma.$transaction = jest.fn((cb: (tx: unknown) => unknown) => cb(prisma));
  return { rewards, config, prisma, ...over } as any;
}
function make(d: ReturnType<typeof deps>) {
  return new CommunityRewardService(d.prisma, d.rewards, d.config);
}
const keys = (d: ReturnType<typeof deps>) => d.config.get.mock.calls.map((c: unknown[]) => c[0]);

describe('CommunityRewardService.rewardPost', () => {
  it('mặc định 1 Điểm Xanh (community.post_reward_points), reason COMMUNITY_POST + refType COMMUNITY', async () => {
    const d = deps();
    await make(d).rewardPost('u1', 'p1');
    expect(d.rewards.grant).toHaveBeenCalledWith('u1', 1, 'COMMUNITY_POST:p1', 'COMMUNITY', 'p1', d.prisma, EXP);
    expect(keys(d)).toContain('community.post_reward_points');
  });

  it('KHÔNG đọc khoá xu cũ community.post_reward (DB còn 200 xu)', async () => {
    const d = deps();
    d.config.get.mockImplementation(async (k: string, f: unknown) => (k === 'community.post_reward' ? 200 : f));
    await make(d).rewardPost('u1', 'p1');
    expect(d.rewards.grant.mock.calls[0][1]).toBe(1);
    expect(keys(d)).not.toContain('community.post_reward');
  });

  it('trần mặc định 1 bài/ngày (OQ-6): đã có 1 dòng hôm nay ở sổ xu cũ → KHÔNG thưởng', async () => {
    const d = deps();
    d.prisma.coinTransaction.count.mockResolvedValue(1);
    await make(d).rewardPost('u1', 'p1');
    expect(d.rewards.grant).not.toHaveBeenCalled();
  });

  it('trần ngày đếm HỢP hai sổ: 1 xu + 1 điểm = 2 ≥ trần 2 → KHÔNG thưởng', async () => {
    const d = deps();
    d.config.get.mockImplementation(async (k: string, f: unknown) => (k === 'community.daily_post_reward_cap' ? 2 : f));
    d.prisma.coinTransaction.count.mockResolvedValue(1);
    d.prisma.pointsTransaction.count.mockResolvedValue(1);
    await make(d).rewardPost('u1', 'p1');
    expect(d.rewards.grant).not.toHaveBeenCalled();
  });

  it('xung đột tuần tự hoá P2034 một lần → thử lại và vẫn cấp thưởng', async () => {
    const d = deps();
    const run = d.prisma.$transaction;
    d.prisma.$transaction = jest.fn().mockRejectedValueOnce({ code: 'P2034', message: 'serialization failure' }).mockImplementation(run);
    await make(d).rewardPost('u1', 'p1');
    expect(d.prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(d.rewards.grant).toHaveBeenCalledTimes(1);
  });

  it('deadlock 40P01 (mã Postgres trong meta) cũng được thử lại', async () => {
    const d = deps();
    const run = d.prisma.$transaction;
    d.prisma.$transaction = jest.fn().mockRejectedValueOnce({ code: 'P2010', meta: { code: '40P01' } }).mockImplementation(run);
    await make(d).rewardPost('u1', 'p1');
    expect(d.rewards.grant).toHaveBeenCalledTimes(1);
  });

  it('P2034 mãi → thử đúng 3 lần, log cảnh báo, KHÔNG throw (best-effort)', async () => {
    const d = deps();
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    d.prisma.$transaction = jest.fn().mockRejectedValue({ code: 'P2034', message: 'serialization failure' });
    await expect(make(d).rewardPost('u1', 'p1')).resolves.toBeUndefined();
    expect(d.prisma.$transaction).toHaveBeenCalledTimes(3);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('COMMUNITY_POST:p1'));
    warn.mockRestore();
  });

  it('hạn điểm đọc TRƯỚC khi mở transaction (không đọc config trong tx)', async () => {
    const d = deps();
    await make(d).rewardPost('u1', 'p1');
    expect(d.rewards.expiresAt.mock.invocationCallOrder[0]).toBeLessThan(d.prisma.$transaction.mock.invocationCallOrder[0]);
  });

  it('lỗi khác P2034 → vẫn throw (không nuốt lỗi bất kỳ)', async () => {
    const d = deps();
    d.prisma.$transaction = jest.fn().mockRejectedValue(new Error('db down'));
    await expect(make(d).rewardPost('u1', 'p1')).rejects.toThrow('db down');
  });

  it('cấu hình 0 / không phải số nguyên dương → tắt thưởng, không gọi grant', async () => {
    for (const v of [0, -1, 1.5, '2']) {
      const d = deps();
      d.config.get.mockImplementation(async (k: string, f: unknown) => (k === 'community.post_reward_points' ? v : f));
      await make(d).rewardPost('u1', 'p1');
      expect(d.rewards.grant).not.toHaveBeenCalled();
    }
  });
});

describe('CommunityRewardService.rewardAnswer', () => {
  it('mặc định 0 điểm (0,1 điểm không biểu diễn được) → không thưởng', async () => {
    const d = deps();
    await make(d).rewardAnswer('answerer', 'author', 'c1');
    expect(d.rewards.grant).not.toHaveBeenCalled();
    expect(keys(d)).toContain('community.answer_reward_points');
  });

  it('admin bật community.answer_reward_points = 1 → thưởng reason COMMUNITY_ANSWER', async () => {
    const d = deps();
    d.config.get.mockImplementation(async (k: string, f: unknown) => (k === 'community.answer_reward_points' ? 1 : f));
    await make(d).rewardAnswer('answerer', 'author', 'c1');
    expect(d.rewards.grant).toHaveBeenCalledWith('answerer', 1, 'COMMUNITY_ANSWER:c1', 'COMMUNITY', 'c1', d.prisma, EXP);
  });

  it('tự trả lời bài của mình → KHÔNG thưởng', async () => {
    const d = deps();
    d.config.get.mockImplementation(async (k: string, f: unknown) => (k === 'community.answer_reward_points' ? 1 : f));
    await make(d).rewardAnswer('same', 'same', 'c1');
    expect(d.rewards.grant).not.toHaveBeenCalled();
  });

  it('chạm trần trả lời/ngày → KHÔNG thưởng', async () => {
    const d = deps();
    d.config.get.mockImplementation(async (k: string, f: unknown) =>
      k === 'community.answer_reward_points' ? 1 : k === 'community.daily_answer_reward_cap' ? 10 : f);
    d.prisma.pointsTransaction.count.mockResolvedValue(10);
    await make(d).rewardAnswer('answerer', 'author', 'c1');
    expect(d.rewards.grant).not.toHaveBeenCalled();
  });
});

describe('CommunityRewardService.rewardEventWinner', () => {
  it('điểm > 0 → thưởng qua grant reason COMMUNITY_EVENT_WIN:<eventId>:<userId>, refType COMMUNITY', async () => {
    const d = deps();
    await make(d).rewardEventWinner('u1', 'ev1', 5);
    expect(d.rewards.grant).toHaveBeenCalledWith('u1', 5, 'COMMUNITY_EVENT_WIN:ev1:u1', 'COMMUNITY', 'ev1');
  });

  it('điểm <= 0 → KHÔNG thưởng', async () => {
    const d = deps();
    await make(d).rewardEventWinner('u1', 'ev1', 0);
    await make(d).rewardEventWinner('u1', 'ev1', -100);
    expect(d.rewards.grant).not.toHaveBeenCalled();
  });
});

describe('CommunityRewardService.rewardBestAnswer', () => {
  it('mặc định 1 điểm (community.best_answer_reward_points), reason khoá theo POST (không theo comment)', async () => {
    const d = deps();
    await make(d).rewardBestAnswer('answerer', 'author', 'p1');
    // tham số cuối là tx — best-answer cũng đếm-rồi-cấp trong transaction như rewardPost/rewardAnswer.
    expect(d.rewards.grant).toHaveBeenCalledWith('answerer', 1, 'COMMUNITY_BEST:p1', 'COMMUNITY', 'p1', d.prisma, EXP);
    expect(keys(d)).not.toContain('community.best_answer_reward');
  });

  it('best-answer trỏ chính chủ bài → KHÔNG thưởng', async () => {
    const d = deps();
    await make(d).rewardBestAnswer('same', 'same', 'p1');
    expect(d.rewards.grant).not.toHaveBeenCalled();
  });

  it('đổi best-answer sang comment khác CÙNG bài → reason KHÔNG đổi (chặn farm bằng đổi best-answer liên tục)', async () => {
    const d = deps();
    await make(d).rewardBestAnswer('alt1', 'author', 'p1');
    await make(d).rewardBestAnswer('alt2', 'author', 'p1');
    const reasons = d.rewards.grant.mock.calls.map((c: unknown[]) => c[2]);
    // 2 reason giống hệt nhau → RewardPointsService.grant (partial unique index reason WHERE
    // refType='COMMUNITY' ở sổ điểm + kiểm dòng cùng reason ở sổ xu cũ) chặn lần cấp thứ 2.
    expect(reasons).toEqual(['COMMUNITY_BEST:p1', 'COMMUNITY_BEST:p1']);
  });

  // P1-2 (docs/2026-09-08-review-progress.md): idempotency theo postId CHỈ chặn farm trên CÙNG 1 bài.
  // Phải có trần NGÀY như 2 reward anh em (rewardPost/rewardAnswer đều đã đi qua rewardWithDailyCap).
  it('trần mặc định 3/ngày (OQ-6): đã 3 lần hôm nay → KHÔNG thưởng (chặn farm qua nhiều bài khác nhau)', async () => {
    const d = deps();
    d.prisma.pointsTransaction.count.mockResolvedValue(2);
    d.prisma.coinTransaction.count.mockResolvedValue(1);
    await make(d).rewardBestAnswer('answerer', 'author', 'p1');
    expect(d.rewards.grant).not.toHaveBeenCalled();
  });

  it('đếm trần best-answer theo reason COMMUNITY_BEST của HÔM NAY ở cả hai sổ, trong transaction đã khoá dòng người nhận', async () => {
    const d = deps();
    await make(d).rewardBestAnswer('answerer', 'author', 'p1');
    for (const m of [d.prisma.coinTransaction.count, d.prisma.pointsTransaction.count]) {
      expect(m).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: 'answerer', refType: 'COMMUNITY', reason: { startsWith: 'COMMUNITY_BEST:' } }),
        }),
      );
    }
    expect(d.prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(d.prisma.$transaction).toHaveBeenCalledWith(expect.any(Function));
  });
});

// C-026: trần thưởng "trong ngày" phải đếm từ 00:00 giờ VN dù host chạy UTC.
describe('CommunityRewardService — đầu ngày theo giờ VN (C-026)', () => {
  it('01:30 ngày 10/3 giờ VN → đếm từ 2026-03-09T17:00Z', async () => {
    const d = deps();
    jest.useFakeTimers().setSystemTime(new Date('2026-03-09T18:30:00Z'));
    try {
      await make(d).rewardPost('u1', 'p1');
    } finally {
      jest.useRealTimers();
    }
    const where = d.prisma.pointsTransaction.count.mock.calls[0][0].where;
    expect(where.createdAt.gte.toISOString()).toBe('2026-03-09T17:00:00.000Z');
  });
});
