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

  /** Tổng quan xu: số dư, lịch sử gần nhất, thống kê giới thiệu (số bạn thành công + xu kiếm được). */
  async getOverview(userId: string) {
    const [user, transactions, referralAgg, referralCount] = await Promise.all([
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
    ]);
    return {
      coinsBalance: user.coinsBalance,
      referralCode: user.referralCode,
      referralEarned: referralAgg._sum.delta ?? 0,
      referralSuccessCount: referralCount,
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
  }
}
