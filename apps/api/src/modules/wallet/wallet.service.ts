import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';

/**
 * Ví Tubu (walletBalance, VND thật) — nhận hoa hồng CTV + cashback Shopee.
 * Hai đường ra: đổi sang TubuXu (×1.2, khuyến khích tiêu trong app) hoặc rút ngân hàng
 * (min wallet.withdraw_min, phí wallet.withdraw_fee). Xem docs spec TubuXu 2026-06-24.
 */
@Injectable()
export class WalletService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
  ) {}

  async getWallet(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const [commApproved, commPending, multiplier, withdrawMin, withdrawFee] = await Promise.all([
      this.prisma.commission.aggregate({
        where: { affiliateUserId: userId, status: 'APPROVED', payoutBatchId: null },
        _sum: { amount: true },
      }),
      this.prisma.commission.aggregate({
        where: { affiliateUserId: userId, status: { in: ['PENDING', 'LOCKED'] } },
        _sum: { amount: true },
      }),
      this.config.get<number>('wallet.xu_convert_multiplier', 1.2),
      this.config.get<number>('wallet.withdraw_min', 100000),
      this.config.get<number>('wallet.withdraw_fee', 3000),
    ]);
    return {
      walletBalance: user.walletBalance, // số dư khả dụng (rút/đổi xu)
      coinsBalance: user.coinsBalance, // TubuXu (tiêu trong app)
      cashbackPending: user.cashbackPending, // cashback chờ hết hold
      commissionApproved: commApproved._sum.amount ?? 0, // hoa hồng có thể rút
      commissionPending: commPending._sum.amount ?? 0,
      xuConvertMultiplier: multiplier, // 1.2 → đổi Ví nhận thêm 20% xu
      withdrawMin, // rút tối thiểu
      withdrawFee, // phí chuyển khoản ngân hàng
    };
  }

  /**
   * Đổi Ví → TubuXu (×multiplier). Atomic: trừ ví (gte guard chống overdraft) +
   * cộng xu + ghi CoinTransaction trong 1 transaction (bất biến coinsBalance == Σdelta).
   */
  async convertToXu(userId: string, amountVnd: number) {
    if (!Number.isInteger(amountVnd) || amountVnd <= 0) {
      throw new BadRequestException('Số tiền đổi không hợp lệ.');
    }
    const multiplier = await this.config.get<number>('wallet.xu_convert_multiplier', 1.2);
    const received = Math.floor(amountVnd * multiplier);
    await this.prisma.$transaction(async (tx) => {
      const dec = await tx.user.updateMany({
        where: { id: userId, walletBalance: { gte: amountVnd } },
        data: { walletBalance: { decrement: amountVnd } },
      });
      if (dec.count === 0) throw new BadRequestException('Số dư Ví không đủ.');
      await tx.user.update({ where: { id: userId }, data: { coinsBalance: { increment: received } } });
      await tx.coinTransaction.create({
        data: { userId, delta: received, reason: 'CONVERT_FROM_WALLET', refType: 'CONVERT' },
      });
    });
    return { spent: amountVnd, received, multiplier };
  }

  /**
   * Rút từ Ví Tubu (walletBalance) về STK ngân hàng. Min wallet.withdraw_min, trừ
   * phí chuyển khoản wallet.withdraw_fee → Payout.amount = số thực nhận (net).
   */
  async withdraw(userId: string, amount: number, bankInfo: object, idempotencyKey?: string) {
    // Chuẩn hoá '' / khoảng trắng → undefined: header rỗng (proxy/bug) nếu giữ '' sẽ ghi vào
    // payouts.idempotencyKey='' rồi lệnh rút thứ 2 cũng '' đụng unique index → P2002 thoát ra 500.
    const key = idempotencyKey?.trim() || undefined;
    // Idempotency: double-tap nút Rút / retry sau timeout cùng key → trả lại Payout đã tạo,
    // KHÔNG trừ ví lần 2 (mirror place-order). Unique index payouts.idempotencyKey là guard cứng.
    if (key) {
      const existing = await this.prisma.payout.findUnique({ where: { idempotencyKey: key } });
      // idempotencyKey unique toàn cục (không compound theo userId) — nếu key trùng nhưng
      // thuộc user khác (đụng độ hiếm/keygen yếu ở client cũ) thì KHÔNG trả payout của người
      // khác ra ngoài; coi như đụng key, bắt buộc client thử lại với key mới.
      if (existing && existing.userId === userId) {
        return {
          ok: true,
          payoutId: existing.id,
          status: existing.status,
          withdrawn: existing.amount + existing.fee,
          fee: existing.fee,
          net: existing.amount,
        };
      }
      if (existing) {
        throw new BadRequestException('Idempotency-Key đã được sử dụng, vui lòng thử lại.');
      }
    }

    const min = await this.config.get<number>('wallet.withdraw_min', 100000);
    const fee = await this.config.get<number>('wallet.withdraw_fee', 3000);
    if (amount < min) {
      throw new BadRequestException(`Số tiền rút tối thiểu ${min.toLocaleString('vi-VN')}đ.`);
    }
    const net = amount - fee;
    // Phòng thủ cấu hình sai (phí ≥ tiền rút): không bao giờ trừ ví rồi tạo Payout 0/âm.
    if (net <= 0) {
      throw new BadRequestException('Số tiền rút phải lớn hơn phí chuyển khoản ngân hàng.');
    }
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.walletBalance < amount) throw new BadRequestException('Số dư ví không đủ.');

    let payout: Awaited<ReturnType<typeof this.prisma.payout.create>>;
    try {
      payout = await this.prisma.$transaction(async (tx) => {
        // Trừ tiền ATOMIC: chỉ trừ nếu số dư còn đủ (where gte) — chống TOCTOU/overdraft
        // khi 2 lệnh rút chạy đồng thời (check ở trên có thể đã cũ).
        const dec = await tx.user.updateMany({
          where: { id: userId, walletBalance: { gte: amount } },
          data: { walletBalance: { decrement: amount } },
        });
        if (dec.count === 0) throw new BadRequestException('Số dư ví không đủ.');
        return tx.payout.create({
          data: { userId, amount: net, fee, method: 'BANK', bankInfo, status: 'REQUESTED', idempotencyKey: key },
        });
      });
    } catch (err) {
      // Race 2 request cùng Idempotency-Key: kẻ thua ăn P2002 trên unique key → trả lại Payout
      // mà kẻ thắng đã tạo (đã trừ ví đúng 1 lần), KHÔNG để lỗi ra ngoài.
      if (key && err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const existing = await this.prisma.payout.findUnique({ where: { idempotencyKey: key } });
        if (existing && existing.userId === userId) {
          return {
            ok: true,
            payoutId: existing.id,
            status: existing.status,
            withdrawn: existing.amount + existing.fee,
            fee: existing.fee,
            net: existing.amount,
          };
        }
      }
      throw err;
    }
    return { ok: true, payoutId: payout.id, status: 'REQUESTED' as const, withdrawn: amount, fee, net };
  }
}
