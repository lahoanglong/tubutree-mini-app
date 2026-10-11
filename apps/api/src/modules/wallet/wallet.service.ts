import { BadRequestException, GoneException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { paginated, skipTake } from '../../common/pagination';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { applyWalletDelta } from './wallet-ledger.service';

/**
 * Ví Tubu (walletBalance, VND thật) — nhận hoa hồng CTV + cashback Shopee.
 * Đường ra: trả đơn hoặc rút ngân hàng (min wallet.withdraw_min, phí wallet.withdraw_fee). Đổi sang
 * TubuXu đã bỏ ở PD-3 (Q-03).
 */
@Injectable()
export class WalletService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
  ) {}

  async getWallet(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const [commApproved, commPending, withdrawMin, withdrawFee] = await Promise.all([
      this.prisma.commission.aggregate({
        where: { affiliateUserId: userId, status: 'APPROVED', payoutBatchId: null },
        _sum: { amount: true },
      }),
      this.prisma.commission.aggregate({
        where: { affiliateUserId: userId, status: { in: ['PENDING', 'LOCKED'] } },
        _sum: { amount: true },
      }),
      this.config.get<number>('wallet.withdraw_min', 100000),
      this.config.get<number>('wallet.withdraw_fee', 3000),
    ]);
    return {
      walletBalance: user.walletBalance, // số dư khả dụng (rút / trả đơn)
      cashbackPending: user.cashbackPending, // cashback chờ hết hold
      commissionApproved: commApproved._sum.amount ?? 0, // hoa hồng có thể rút
      commissionPending: commPending._sum.amount ?? 0,
      withdrawMin, // rút tối thiểu
      withdrawFee, // phí chuyển khoản ngân hàng
    };
  }

  /**
   * Sao kê Ví Tubu từ sổ cái wallet_transactions (C-060), mới nhất trước. Chỉ trả mã đơn (để mở
   * chi tiết đơn); refId khác là id nội bộ (payout, giao dịch cashback, tài khoản khách đã gộp).
   */
  async getTransactions(userId: string, page: number, limit: number) {
    const where = { userId };
    const [rows, total] = await Promise.all([
      this.prisma.walletTransaction.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...skipTake(page, limit),
        select: { id: true, delta: true, balanceAfter: true, type: true, refType: true, refId: true, reason: true, createdAt: true },
      }),
      this.prisma.walletTransaction.count({ where }),
    ]);
    const data = rows.map(({ refType, refId, ...r }) => ({ ...r, orderId: refType === 'ORDER' ? refId : null }));
    return paginated(data, page, limit, total);
  }

  /**
   * Đổi Ví → xu đã ngừng (PD-3, Q-03): TubuXu gộp vào Điểm Xanh. Route giữ một bản phát hành để
   * client cũ nhận 410 đọc được; không mở transaction, không trừ ví. Dòng sổ XU_CONVERT cũ giữ nguyên.
   */
  async convertToXu(): Promise<never> {
    throw new GoneException('Đổi Ví sang xu đã ngừng. Tiền trong Ví Tubu vẫn rút được hoặc trả đơn.');
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
        // So sánh gross (net+fee đã lưu) với `amount` của request hiện tại: nếu client đổi số
        // tiền rồi bấm lại CÙNG key (vd sau lỗi mạng), tuyệt đối không được trộn lẫn amount mới
        // với Payout cũ — phải từ chối rõ ràng thay vì trả dữ liệu sai lệch.
        const existingGross = existing.amount + existing.fee;
        if (existingGross !== amount) {
          throw new BadRequestException(
            'Yêu cầu trước đó với số tiền khác đã được xử lý, vui lòng tải lại và thử lại.',
          );
        }
        return {
          ok: true,
          payoutId: existing.id,
          status: existing.status,
          withdrawn: existingGross,
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
        const created = await tx.payout.create({
          data: { userId, amount: net, fee, method: 'BANK', bankInfo, status: 'REQUESTED', idempotencyKey: key },
        });
        // Trừ GROSS dưới khoá dòng user (check ở trên có thể đã cũ khi 2 lệnh rút chạy đồng
        // thời); không đủ → throw, rollback luôn Payout vừa tạo. refId = payout để lệnh hoàn khi
        // admin từ chối (WITHDRAW_REFUND) đối chiếu được.
        await applyWalletDelta(tx, {
          userId,
          delta: -amount,
          type: 'WITHDRAW',
          refType: 'PAYOUT',
          refId: created.id,
          reason: `Rút về ngân hàng (phí ${fee}đ)`,
        });
        return created;
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
