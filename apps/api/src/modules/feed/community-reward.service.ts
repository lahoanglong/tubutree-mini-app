import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CoinsService } from '../wallet/coins.service';
import { SystemConfigService } from '../system-config/system-config.service';

/**
 * Thưởng TubuXu cho hoạt động cộng đồng. Idempotent qua reason + partial unique index
 * (reason WHERE refType='COMMUNITY'). Chỉ thưởng khi bài PUBLISHED (caller đảm bảo).
 */
@Injectable()
export class CommunityRewardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly coins: CoinsService,
    private readonly config: SystemConfigService,
  ) {}

  /** Thưởng khi bài được đăng công khai. Trần số lần/ngày để chống spam. */
  async rewardPost(userId: string, postId: string): Promise<void> {
    const amount = await this.config.get<number>('community.post_reward', 200);
    if (amount <= 0) return;
    const cap = await this.config.get<number>('community.daily_post_reward_cap', 3);
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    const todayCount = await this.prisma.coinTransaction.count({
      where: { userId, refType: 'COMMUNITY', reason: { startsWith: 'COMMUNITY_POST:' }, createdAt: { gte: since } },
    });
    if (todayCount >= cap) return;
    await this.coins.grantCoins(userId, amount, `COMMUNITY_POST:${postId}`, 'COMMUNITY', postId);
  }

  /** Thưởng người trả lời (không thưởng khi tự trả lời bài của chính mình). Trần số lần/ngày để chống farm xu. */
  async rewardAnswer(answererId: string, postAuthorId: string, commentId: string): Promise<void> {
    if (answererId === postAuthorId) return;
    const amount = await this.config.get<number>('community.answer_reward', 100);
    if (amount <= 0) return;
    const cap = await this.config.get<number>('community.daily_answer_reward_cap', 10);
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    const todayCount = await this.prisma.coinTransaction.count({
      where: { userId: answererId, refType: 'COMMUNITY', reason: { startsWith: 'COMMUNITY_ANSWER:' }, createdAt: { gte: since } },
    });
    if (todayCount >= cap) return;
    await this.coins.grantCoins(answererId, amount, `COMMUNITY_ANSWER:${commentId}`, 'COMMUNITY', commentId);
  }

  /** Thưởng khi câu trả lời được chọn hay nhất (không thưởng nếu trỏ chính chủ bài). */
  async rewardBestAnswer(answererId: string, postAuthorId: string, commentId: string): Promise<void> {
    if (answererId === postAuthorId) return;
    const amount = await this.config.get<number>('community.best_answer_reward', 500);
    await this.coins.grantCoins(answererId, amount, `COMMUNITY_BEST:${commentId}`, 'COMMUNITY', commentId);
  }
}
