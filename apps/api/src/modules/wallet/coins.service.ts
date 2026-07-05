import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';

type Db = PrismaService | Prisma.TransactionClient;

/**
 * TubuXu (coinsBalance) — tiền tệ tiêu trong app. Bất biến coinsBalance == SUM(CoinTransaction.delta).
 * Nguồn xu: đổi từ Ví (WalletService.convertToXu) + thưởng giới thiệu. Sink: mua hàng/nước/cây.
 */
@Injectable()
export class CoinsService {
  private readonly logger = new Logger(CoinsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
  ) {}

  /**
   * Tổng quan xu: số dư, lịch sử gần nhất, thống kê giới thiệu (số bạn thành công + xu kiếm
   * được) và tiến độ mốc thưởng thêm (referralMilestones + nextMilestone sắp tới).
   */
  async getOverview(userId: string) {
    const [user, transactions, referralAgg, referralCount, milestones] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { coinsBalance: true, referralCode: true },
      }),
      this.prisma.coinTransaction.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      this.prisma.coinTransaction.aggregate({
        where: { userId, refType: 'REFERRAL' },
        _sum: { delta: true },
      }),
      // Mỗi reason REFERRAL_CASHBACK:<refereeId> = 1 bạn được mời có cashback đầu tiên.
      this.prisma.coinTransaction.count({
        where: { userId, reason: { startsWith: 'REFERRAL_CASHBACK:' } },
      }),
      this.config.get<{ count: number; bonus: number }[]>('coins.referral_milestones', []),
    ]);
    const sortedMilestones = [...milestones].sort((a, b) => a.count - b.count);
    const nextMilestone = sortedMilestones.find((m) => m.count > referralCount) ?? null;
    return {
      coinsBalance: user.coinsBalance,
      referralCode: user.referralCode,
      referralEarned: referralAgg._sum.delta ?? 0,
      referralSuccessCount: referralCount,
      referralMilestones: sortedMilestones,
      nextMilestone,
      transactions,
    };
  }

  /**
   * Cộng xu (thưởng/đổi-vào). Idempotent: partial unique index (reason WHERE refType='REFERRAL')
   * → caller thua race / gọi lại ăn P2002 → bail no-op. Atomic create + increment.
   */
  async grantCoins(
    userId: string,
    amount: number,
    reason: string,
    refType?: string,
    refId?: string,
  ): Promise<void> {
    if (amount <= 0) return;
    try {
      await this.prisma.$transaction([
        this.prisma.coinTransaction.create({ data: { userId, delta: amount, reason, refType, refId } }),
        this.prisma.user.update({ where: { id: userId }, data: { coinsBalance: { increment: amount } } }),
      ]);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        this.logger.debug(`grantCoins idempotent skip reason=${reason}`);
        return;
      }
      throw err;
    }
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

  /**
   * Thưởng xu giới thiệu khi referee có cashback CONFIRMED đầu tiên: CẢ người mời lẫn người
   * được mời. Idempotent qua reason nhúng refereeId + partial unique index. Bỏ qua nếu
   * referee chưa có người giới thiệu (referredById null) hoặc trỏ chính mình.
   */
  async grantReferralCoins(refereeId: string): Promise<void> {
    const referee = await this.prisma.user.findUnique({
      where: { id: refereeId },
      select: { referredById: true },
    });
    const referrerId = referee?.referredById;
    if (!referrerId || referrerId === refereeId) return;

    const referrerReward = await this.config.get<number>('coins.referrer_reward', 5000);
    const refereeReward = await this.config.get<number>('coins.referee_reward', 5000);
    await this.grantCoins(referrerId, referrerReward, `REFERRAL_CASHBACK:${refereeId}`, 'REFERRAL', refereeId);
    await this.grantCoins(refereeId, refereeReward, `REFERRED_CASHBACK:${refereeId}`, 'REFERRAL', refereeId);
    await this.awardReferralMilestones(referrerId);
  }

  /**
   * Thưởng thêm khi số bạn giới thiệu thành công (cộng dồn) của referrer chạm mốc cấu hình
   * (coins.referral_milestones). Reason nhúng referrerId + số mốc → globally unique, cùng
   * partial unique index (reason WHERE refType='REFERRAL') đảm bảo mỗi mốc chỉ thưởng 1 lần.
   */
  private async awardReferralMilestones(referrerId: string): Promise<void> {
    const milestones = await this.config.get<{ count: number; bonus: number }[]>('coins.referral_milestones', []);
    if (!milestones.length) return;
    const successCount = await this.prisma.coinTransaction.count({
      where: { userId: referrerId, reason: { startsWith: 'REFERRAL_CASHBACK:' } },
    });
    for (const m of milestones) {
      if (successCount >= m.count && m.bonus > 0) {
        await this.grantCoins(referrerId, m.bonus, `REFERRAL_MILESTONE:${referrerId}:${m.count}`, 'REFERRAL', referrerId);
      }
    }
  }
}
