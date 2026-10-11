import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RewardPointsService } from './reward-points.service';

type Db = PrismaService | Prisma.TransactionClient;

/**
 * TubuXu (coinsBalance) — PD-3: đã gộp vào Điểm Xanh (migration B quy đổi số dư, 1.000 xu = 1 điểm).
 * Không còn nguồn cộng xu: thưởng đi qua RewardPointsService. File giữ để đọc lịch sử coin_transactions
 * và đường tiêu xu còn lại cho tới lượt L3 (checkout/game) gỡ hẳn.
 */
@Injectable()
export class CoinsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rewards: RewardPointsService,
  ) {}

  /** Tổng quan xu cũ: số dư, lịch sử gần nhất; thống kê giới thiệu nay tính bằng Điểm Xanh (GET /me/referral). */
  async getOverview(userId: string) {
    const [user, transactions, referral] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { coinsBalance: true } }),
      this.prisma.coinTransaction.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      this.rewards.getReferralOverview(userId),
    ]);
    return {
      coinsBalance: user.coinsBalance,
      referralCode: referral.referralCode,
      referralEarnedPoints: referral.earnedPoints,
      referralSuccessCount: referral.successCount,
      referralMilestones: referral.milestones,
      nextMilestone: referral.nextMilestone,
      transactions,
    };
  }

  /**
   * Tiêu xu. Atomic trừ (gte guard → không âm số dư, không double-spend). Nhận `tx?` để chạy
   * trong transaction của caller (vd checkout trả đơn bằng xu cùng tx tạo đơn).
   */
  async spendCoins(
    userId: string,
    amount: number,
    reason: string,
    refType?: string,
    refId?: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    if (!Number.isInteger(amount) || amount <= 0) throw new BadRequestException('Số TubuXu không hợp lệ.');
    const run = async (db: Db) => {
      const dec = await db.user.updateMany({
        where: { id: userId, coinsBalance: { gte: amount } },
        data: { coinsBalance: { decrement: amount } },
      });
      if (dec.count === 0) throw new BadRequestException('Không đủ TubuXu.');
      await db.coinTransaction.create({ data: { userId, delta: -amount, reason, refType, refId } });
    };
    if (tx) return run(tx);
    await this.prisma.$transaction((t) => run(t));
  }
}
