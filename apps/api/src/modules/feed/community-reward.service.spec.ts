import { CommunityRewardService } from './community-reward.service';

function deps(over: Record<string, unknown> = {}) {
  const coins = { grantCoins: jest.fn().mockResolvedValue(undefined) };
  const config = { get: jest.fn().mockResolvedValue(0) };
  const prisma: any = { coinTransaction: { count: jest.fn().mockResolvedValue(0) } };
  // rewardPost/rewardAnswer chạy đếm-rồi-cấp TRONG $transaction(async tx => ..., {isolationLevel})
  // — tx nhận CHÍNH prisma mock này nên tx.coinTransaction.count dùng chung mock ở trên.
  prisma.$transaction = jest.fn((cb: (tx: unknown) => unknown) => cb(prisma));
  return { coins, config, prisma, ...over } as any;
}
function make(d: ReturnType<typeof deps>) {
  return new CommunityRewardService(d.prisma, d.coins, d.config);
}

describe('CommunityRewardService.rewardPost', () => {
  it('thưởng post_reward với reason COMMUNITY_POST + refType COMMUNITY khi chưa chạm trần', async () => {
    const d = deps();
    d.config.get.mockImplementation(async (k: string, f: number) => (k === 'community.post_reward' ? 200 : f));
    await make(d).rewardPost('u1', 'p1');
    expect(d.coins.grantCoins).toHaveBeenCalledWith('u1', 200, 'COMMUNITY_POST:p1', 'COMMUNITY', 'p1', d.prisma);
  });

  it('chạm trần ngày → KHÔNG thưởng', async () => {
    const d = deps();
    d.config.get.mockImplementation(async (k: string, f: number) =>
      k === 'community.post_reward' ? 200 : k === 'community.daily_post_reward_cap' ? 3 : f,
    );
    d.prisma.coinTransaction.count.mockResolvedValue(3);
    await make(d).rewardPost('u1', 'p1');
    expect(d.coins.grantCoins).not.toHaveBeenCalled();
  });

  it('race P2034 (2 bài đăng dồn dập đụng Serializable) → nuốt lỗi, KHÔNG throw (best-effort)', async () => {
    const d = deps();
    d.config.get.mockImplementation(async (k: string, f: number) => (k === 'community.post_reward' ? 200 : f));
    d.prisma.$transaction = jest.fn().mockRejectedValue({ code: 'P2034', message: 'serialization failure' });
    await expect(make(d).rewardPost('u1', 'p1')).resolves.toBeUndefined();
  });

  it('lỗi khác P2034 → vẫn throw (không nuốt lỗi bất kỳ)', async () => {
    const d = deps();
    d.config.get.mockImplementation(async (k: string, f: number) => (k === 'community.post_reward' ? 200 : f));
    d.prisma.$transaction = jest.fn().mockRejectedValue(new Error('db down'));
    await expect(make(d).rewardPost('u1', 'p1')).rejects.toThrow('db down');
  });
});

describe('CommunityRewardService.rewardAnswer', () => {
  it('trả lời bài của người khác → thưởng answer_reward', async () => {
    const d = deps();
    d.config.get.mockImplementation(async (k: string, f: number) => (k === 'community.answer_reward' ? 100 : f));
    await make(d).rewardAnswer('answerer', 'author', 'c1');
    expect(d.coins.grantCoins).toHaveBeenCalledWith('answerer', 100, 'COMMUNITY_ANSWER:c1', 'COMMUNITY', 'c1', d.prisma);
  });

  it('tự trả lời bài của mình → KHÔNG thưởng', async () => {
    const d = deps();
    await make(d).rewardAnswer('same', 'same', 'c1');
    expect(d.coins.grantCoins).not.toHaveBeenCalled();
  });

  it('chạm trần trả lời/ngày → KHÔNG thưởng', async () => {
    const d = deps();
    d.config.get.mockImplementation(async (k: string, f: number) =>
      k === 'community.answer_reward' ? 100 : k === 'community.daily_answer_reward_cap' ? 10 : f);
    d.prisma.coinTransaction.count.mockResolvedValue(10);
    await make(d).rewardAnswer('answerer', 'author', 'c1');
    expect(d.coins.grantCoins).not.toHaveBeenCalled();
  });
});

describe('CommunityRewardService.rewardEventWinner', () => {
  it('amount > 0 → thưởng qua grantCoins reason COMMUNITY_EVENT_WIN:<eventId>:<userId>, refType COMMUNITY', async () => {
    const d = deps();
    await make(d).rewardEventWinner('u1', 'ev1', 1000);
    expect(d.coins.grantCoins).toHaveBeenCalledWith('u1', 1000, 'COMMUNITY_EVENT_WIN:ev1:u1', 'COMMUNITY', 'ev1');
  });

  it('amount <= 0 → KHÔNG thưởng', async () => {
    const d = deps();
    await make(d).rewardEventWinner('u1', 'ev1', 0);
    expect(d.coins.grantCoins).not.toHaveBeenCalled();
  });

  it('amount âm → KHÔNG thưởng', async () => {
    const d = deps();
    await make(d).rewardEventWinner('u1', 'ev1', -100);
    expect(d.coins.grantCoins).not.toHaveBeenCalled();
  });
});

describe('CommunityRewardService.rewardBestAnswer', () => {
  it('best-answer của người khác → thưởng best_answer_reward, reason khoá theo POST (không theo comment)', async () => {
    const d = deps();
    d.config.get.mockImplementation(async (k: string, f: number) => (k === 'community.best_answer_reward' ? 500 : f));
    await make(d).rewardBestAnswer('answerer', 'author', 'p1');
    expect(d.coins.grantCoins).toHaveBeenCalledWith('answerer', 500, 'COMMUNITY_BEST:p1', 'COMMUNITY', 'p1');
  });

  it('best-answer trỏ chính chủ bài → KHÔNG thưởng', async () => {
    const d = deps();
    await make(d).rewardBestAnswer('same', 'same', 'p1');
    expect(d.coins.grantCoins).not.toHaveBeenCalled();
  });

  it('đổi best-answer sang comment khác CÙNG bài → reason KHÔNG đổi (chặn farm xu bằng đổi best-answer liên tục)', async () => {
    const d = deps();
    d.config.get.mockImplementation(async (k: string, f: number) => (k === 'community.best_answer_reward' ? 500 : f));
    // Lần 1: chọn c1 làm best (câu trả lời của alt1).
    await make(d).rewardBestAnswer('alt1', 'author', 'p1');
    // Lần 2: chủ bài đổi ý, chọn c2 làm best (câu trả lời của alt2) — cùng postId.
    await make(d).rewardBestAnswer('alt2', 'author', 'p1');
    const reasons = d.coins.grantCoins.mock.calls.map((c: unknown[]) => c[2]);
    expect(reasons).toEqual(['COMMUNITY_BEST:p1', 'COMMUNITY_BEST:p1']);
    // 2 reason giống hệt nhau → CoinsService.grantCoins (partial unique index reason
    // WHERE refType='COMMUNITY') sẽ chặn lần cấp thứ 2 bằng P2002 idempotent-skip.
  });
});
