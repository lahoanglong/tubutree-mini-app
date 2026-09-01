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

  /**
   * Thưởng khi bài được đăng công khai. Trần số lần/ngày để chống spam.
   * Đếm-rồi-quyết TRONG transaction Serializable: đăng nhiều bài dồn dập (concurrent requests)
   * không thể cùng đọc chung 1 todayCount rồi cùng lọt qua trần — 1 trong các tx sẽ P2034,
   * nuốt lỗi (bỏ qua thưởng lần đó) thay vì throw, vì thưởng cộng đồng là best-effort.
   */
  async rewardPost(userId: string, postId: string): Promise<void> {
    const amount = await this.config.get<number>('community.post_reward', 200);
    if (amount <= 0) return;
    const cap = await this.config.get<number>('community.daily_post_reward_cap', 3);
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    try {
      await this.prisma.$transaction(
        async (tx) => {
          const todayCount = await tx.coinTransaction.count({
            where: { userId, refType: 'COMMUNITY', reason: { startsWith: 'COMMUNITY_POST:' }, createdAt: { gte: since } },
          });
          if (todayCount >= cap) return;
          await this.coins.grantCoins(userId, amount, `COMMUNITY_POST:${postId}`, 'COMMUNITY', postId, tx);
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (err) {
      if (!(typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2034')) throw err;
    }
  }

  /**
   * Thưởng người trả lời (không thưởng khi tự trả lời bài của chính mình). Trần số lần/ngày
   * để chống farm xu — cùng cơ chế Serializable + nuốt P2034 như rewardPost (xem ghi chú trên).
   */
  async rewardAnswer(answererId: string, postAuthorId: string, commentId: string): Promise<void> {
    if (answererId === postAuthorId) return;
    const amount = await this.config.get<number>('community.answer_reward', 100);
    if (amount <= 0) return;
    const cap = await this.config.get<number>('community.daily_answer_reward_cap', 10);
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    try {
      await this.prisma.$transaction(
        async (tx) => {
          const todayCount = await tx.coinTransaction.count({
            where: { userId: answererId, refType: 'COMMUNITY', reason: { startsWith: 'COMMUNITY_ANSWER:' }, createdAt: { gte: since } },
          });
          if (todayCount >= cap) return;
          await this.coins.grantCoins(answererId, amount, `COMMUNITY_ANSWER:${commentId}`, 'COMMUNITY', commentId, tx);
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (err) {
      if (!(typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2034')) throw err;
    }
  }

  /**
   * Thưởng khi câu trả lời được chọn hay nhất (không thưởng nếu trỏ chính chủ bài).
   * Idempotent THEO BÀI (postId), KHÔNG theo comment — chủ bài đổi best-answer sang
   * comment khác (hợp lệ, sửa lựa chọn) không cấp thưởng lần 2 (partial unique index
   * reason WHERE refType='COMMUNITY' → P2002 → grantCoins bail idempotent). Nếu key theo
   * commentId, đổi best-answer liên tục giữa nhiều tài khoản phụ farm được xu vô hạn.
   */
  async rewardBestAnswer(answererId: string, postAuthorId: string, postId: string): Promise<void> {
    if (answererId === postAuthorId) return;
    const amount = await this.config.get<number>('community.best_answer_reward', 500);
    await this.coins.grantCoins(answererId, amount, `COMMUNITY_BEST:${postId}`, 'COMMUNITY', postId);
  }

  /** Thưởng người thắng sự kiện cộng đồng (Pha 4). Idempotent qua reason (partial unique index refType='COMMUNITY'). */
  async rewardEventWinner(userId: string, eventId: string, amount: number): Promise<void> {
    if (amount <= 0) return;
    await this.coins.grantCoins(userId, amount, `COMMUNITY_EVENT_WIN:${eventId}:${userId}`, 'COMMUNITY', eventId);
  }
}
