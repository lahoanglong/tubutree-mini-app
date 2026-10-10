import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import {
  LEGACY_REFERRAL_CASHBACK_PREFIX,
  lockReferee,
  REFERRAL_ORDER2_PREFIX,
  REFERRAL_ORDER2_REVOKE_PREFIX,
} from './referral-reward';

type Db = PrismaService | Prisma.TransactionClient;

/**
 * TubuXu (coinsBalance) — tiền tệ tiêu trong app. Bất biến coinsBalance == SUM(CoinTransaction.delta).
 * Nguồn xu: đổi từ Ví (WalletService.convertToXu) + thưởng giới thiệu (đơn thứ 2 của bạn được mời). Sink: mua hàng/nước/cây.
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
      this.countReferralSuccesses(userId),
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
   * Cộng xu (thưởng/đổi-vào). Idempotent: partial unique index (reason WHERE refType='REFERRAL'
   * hoặc 'COMMUNITY', ...) → caller thua race / gọi lại thì INSERT không ghi dòng nào → no-op.
   * Nhận `tx?` để chạy TRONG transaction của caller (vd cap/ngày cần đọc-rồi-quyết cùng 1 tx
   * Serializable với việc cấp xu, xem CommunityRewardService.rewardPost/rewardAnswer).
   *
   * Dùng ON CONFLICT DO NOTHING (createMany skipDuplicates) thay vì bắt P2002: một câu lệnh lỗi
   * unique làm Postgres huỷ cả transaction đang mở, nên bắt P2002 rồi đi tiếp sẽ khiến mọi lệnh
   * sau đó của caller trong cùng tx nổ 25P02 (C-061).
   */
  async grantCoins(
    userId: string,
    amount: number,
    reason: string,
    refType?: string,
    refId?: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    if (amount <= 0) return;
    const run = async (db: Prisma.TransactionClient) => {
      const inserted = await db.coinTransaction.createMany({
        data: [{ userId, delta: amount, reason, refType, refId }],
        skipDuplicates: true,
      });
      if (inserted.count === 0) {
        this.logger.debug(`grantCoins idempotent skip reason=${reason}`);
        return;
      }
      await db.user.update({ where: { id: userId }, data: { coinsBalance: { increment: amount } } });
    };
    if (tx) return run(tx);
    await this.prisma.$transaction((t) => run(t));
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
   * Thưởng người mời khi người được mời (refereeId) có đơn thứ 2 giao thành công trong
   * referral.window_days ngày kể từ đơn đầu (Q-05). Gọi mỗi khi một đơn của người được mời sang
   * DELIVERED; tự xét lại từ DB nên gọi lặp/song song an toàn. Người mời là CTV thì không thưởng
   * (CTV chỉ hưởng hoa hồng). Người được mời không nhận thêm xu — họ đã có voucher chào mừng.
   */
  async grantReferralOrderReward(refereeId: string): Promise<boolean> {
    const referee = await this.prisma.user.findUnique({
      where: { id: refereeId },
      select: { referredById: true },
    });
    const referrerId = referee?.referredById;
    if (!referrerId || referrerId === refereeId) return false;
    const referrer = await this.prisma.user.findUnique({ where: { id: referrerId }, select: { role: true } });
    if (!referrer || referrer.role === 'AFFILIATE') return false;

    const [reward, windowDays] = await Promise.all([
      this.config.get<number>('coins.referrer_reward', 5000),
      this.config.get<number>('referral.window_days', 30),
    ]);
    if (!(reward > 0)) return false;

    const granted = await this.prisma.$transaction(async (tx) => {
      await lockReferee(tx, refereeId);
      const already = await tx.coinTransaction.findFirst({
        where: {
          refType: 'REFERRAL',
          reason: { in: [`${REFERRAL_ORDER2_PREFIX}${refereeId}`, `${LEGACY_REFERRAL_CASHBACK_PREFIX}${refereeId}`] },
        },
        select: { id: true },
      });
      if (already) return false;
      const [first, second] = await tx.order.findMany({
        where: { userId: refereeId, status: 'DELIVERED', type: 'RETAIL', placedForCustomer: false },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: 2,
        select: { id: true, createdAt: true },
      });
      if (!first || !second) return false;
      if (second.createdAt.getTime() - first.createdAt.getTime() > windowDays * 864e5) return false;

      const inserted = await tx.coinTransaction.createMany({
        data: [
          {
            userId: referrerId,
            delta: reward,
            reason: `${REFERRAL_ORDER2_PREFIX}${refereeId}`,
            refType: 'REFERRAL',
            refId: `${first.id}:${second.id}`,
          },
        ],
        skipDuplicates: true,
      });
      if (inserted.count === 0) return false;
      await tx.user.update({ where: { id: referrerId }, data: { coinsBalance: { increment: reward } } });
      return true;
    });
    if (granted) await this.awardReferralMilestones(referrerId);
    return granted;
  }

  /** Số bạn giới thiệu thành công còn hiệu lực: thưởng (kể cả kiểu cũ qua cashback) trừ lần đã thu hồi. */
  private async countReferralSuccesses(referrerId: string): Promise<number> {
    const [legacy = 0, granted = 0, revoked = 0] = await Promise.all(
      [LEGACY_REFERRAL_CASHBACK_PREFIX, REFERRAL_ORDER2_PREFIX, REFERRAL_ORDER2_REVOKE_PREFIX].map((prefix) =>
        this.prisma.coinTransaction.count({
          where: { userId: referrerId, refType: 'REFERRAL', reason: { startsWith: prefix } },
        }),
      ),
    );
    return legacy + granted - revoked;
  }

  /**
   * Thưởng thêm khi số bạn giới thiệu thành công (cộng dồn) của referrer chạm mốc cấu hình
   * (coins.referral_milestones). Reason nhúng referrerId + số mốc → globally unique, cùng
   * partial unique index (reason WHERE refType='REFERRAL') đảm bảo mỗi mốc chỉ thưởng 1 lần.
   */
  private async awardReferralMilestones(referrerId: string): Promise<void> {
    const milestones = await this.config.get<{ count: number; bonus: number }[]>('coins.referral_milestones', []);
    if (!milestones.length) return;
    const successCount = await this.countReferralSuccesses(referrerId);
    for (const m of milestones) {
      if (successCount >= m.count && m.bonus > 0) {
        await this.grantCoins(referrerId, m.bonus, `REFERRAL_MILESTONE:${referrerId}:${m.count}`, 'REFERRAL', referrerId);
      }
    }
  }
}
