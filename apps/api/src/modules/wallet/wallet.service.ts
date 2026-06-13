import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';

/** Ví Tubu (Build Spec §6.x, §15 affiliate.min_withdraw_bank). */
@Injectable()
export class WalletService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
  ) {}

  async getWallet(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const [commApproved, commPending] = await Promise.all([
      this.prisma.commission.aggregate({
        where: { affiliateUserId: userId, status: 'APPROVED' },
        _sum: { amount: true },
      }),
      this.prisma.commission.aggregate({
        where: { affiliateUserId: userId, status: { in: ['PENDING', 'LOCKED'] } },
        _sum: { amount: true },
      }),
    ]);
    return {
      walletBalance: user.walletBalance, // số dư khả dụng (rút/thanh toán)
      cashbackPending: user.cashbackPending, // cashback chờ hết hold
      commissionApproved: commApproved._sum.amount ?? 0, // hoa hồng có thể rút
      commissionPending: commPending._sum.amount ?? 0,
    };
  }

  /** Rút từ Ví Tubu (walletBalance) về STK ngân hàng. */
  async withdraw(userId: string, amount: number, bankInfo: object) {
    const min = await this.config.get<number>('affiliate.min_withdraw_bank', 50000);
    if (amount < min) {
      throw new BadRequestException(`Số tiền rút tối thiểu ${min.toLocaleString('vi-VN')}đ.`);
    }
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.walletBalance < amount) throw new BadRequestException('Số dư ví không đủ.');

    const payout = await this.prisma.$transaction(async (tx) => {
      // Trừ tiền ATOMIC: chỉ trừ nếu số dư còn đủ (where gte) — chống TOCTOU/overdraft
      // khi 2 lệnh rút chạy đồng thời (check ở trên có thể đã cũ).
      const dec = await tx.user.updateMany({
        where: { id: userId, walletBalance: { gte: amount } },
        data: { walletBalance: { decrement: amount } },
      });
      if (dec.count === 0) throw new BadRequestException('Số dư ví không đủ.');
      return tx.payout.create({
        data: { userId, amount, method: 'BANK', bankInfo, status: 'REQUESTED' },
      });
    });
    return { ok: true, payoutId: payout.id, status: 'REQUESTED' };
  }
}
