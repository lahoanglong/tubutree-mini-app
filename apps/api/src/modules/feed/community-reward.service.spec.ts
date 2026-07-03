import { CommunityRewardService } from './community-reward.service';

function deps(over: Record<string, unknown> = {}) {
  const coins = { grantCoins: jest.fn().mockResolvedValue(undefined) };
  const config = { get: jest.fn().mockResolvedValue(0) };
  const prisma = { coinTransaction: { count: jest.fn().mockResolvedValue(0) } };
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
    expect(d.coins.grantCoins).toHaveBeenCalledWith('u1', 200, 'COMMUNITY_POST:p1', 'COMMUNITY', 'p1');
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
});

describe('CommunityRewardService.rewardAnswer', () => {
  it('trả lời bài của người khác → thưởng answer_reward', async () => {
    const d = deps();
    d.config.get.mockImplementation(async (k: string, f: number) => (k === 'community.answer_reward' ? 100 : f));
    await make(d).rewardAnswer('answerer', 'author', 'c1');
    expect(d.coins.grantCoins).toHaveBeenCalledWith('answerer', 100, 'COMMUNITY_ANSWER:c1', 'COMMUNITY', 'c1');
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

describe('CommunityRewardService.rewardBestAnswer', () => {
  it('best-answer của người khác → thưởng best_answer_reward', async () => {
    const d = deps();
    d.config.get.mockImplementation(async (k: string, f: number) => (k === 'community.best_answer_reward' ? 500 : f));
    await make(d).rewardBestAnswer('answerer', 'author', 'c1');
    expect(d.coins.grantCoins).toHaveBeenCalledWith('answerer', 500, 'COMMUNITY_BEST:c1', 'COMMUNITY', 'c1');
  });

  it('best-answer trỏ chính chủ bài → KHÔNG thưởng', async () => {
    const d = deps();
    await make(d).rewardBestAnswer('same', 'same', 'c1');
    expect(d.coins.grantCoins).not.toHaveBeenCalled();
  });
});
