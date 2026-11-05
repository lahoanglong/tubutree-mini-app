import { GoneException, Injectable } from '@nestjs/common';
import { decodeKeysetCursor, encodeKeysetCursor, KEYSET_ORDER, keysetAfter } from '../../common/keyset-cursor';
import { paginated, skipTake } from '../../common/pagination';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Ví Tubu (walletBalance, VND thật) — nhận hoa hồng CTV + cashback Shopee.
 * Đường ra duy nhất: trả đơn (rút ngân hàng đã bỏ theo chính sách Zalo 4.5). Đổi sang TubuXu đã bỏ ở PD-3 (Q-03).
 */
@Injectable()
export class WalletService {
  constructor(private readonly prisma: PrismaService) {}

  async getWallet(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const [commApproved, commPending] = await Promise.all([
      this.prisma.commission.aggregate({
        where: { affiliateUserId: userId, status: 'APPROVED', payoutBatchId: null },
        _sum: { amount: true },
      }),
      this.prisma.commission.aggregate({
        where: { affiliateUserId: userId, status: { in: ['PENDING', 'LOCKED'] } },
        _sum: { amount: true },
      }),
    ]);
    return {
      walletBalance: user.walletBalance, // số dư khả dụng (trả đơn)
      cashbackPending: user.cashbackPending, // cashback chờ hết hold
      commissionApproved: commApproved._sum.amount ?? 0, // hoa hồng có thể chuyển vào Ví
      commissionPending: commPending._sum.amount ?? 0,
    };
  }

  /**
   * Sao kê Ví Tubu từ sổ cái wallet_transactions (C-060), mới nhất trước. Chỉ trả mã đơn (để mở
   * chi tiết đơn); refId khác là id nội bộ (payout, giao dịch cashback, tài khoản khách đã gộp).
   */
  /**
   * Sao kê Ví. Có `cursor` thì phân trang keyset `(createdAt, id)` (không lặp/sót khi có dòng mới chèn đầu giữa hai lần gọi);
   * không có thì offset như cũ (web và Mini App bản cũ). Cả hai đều trả `meta.nextCursor` để client mới chuyển sang keyset.
   */
  async getTransactions(userId: string, page: number, limit: number, cursor?: string) {
    const base = { userId };
    const where = cursor ? { AND: [base, keysetAfter(decodeKeysetCursor(cursor))] } : base;
    const [fetched, total] = await Promise.all([
      this.prisma.walletTransaction.findMany({
        where,
        orderBy: KEYSET_ORDER,
        ...(cursor ? { take: limit + 1 } : skipTake(page, limit)),
        select: { id: true, delta: true, balanceAfter: true, type: true, refType: true, refId: true, reason: true, createdAt: true },
      }),
      this.prisma.walletTransaction.count({ where: base }),
    ]);
    const hasMore = cursor ? fetched.length > limit : page * limit < total;
    const rows = cursor ? fetched.slice(0, limit) : fetched;
    const last = rows[rows.length - 1];
    const data = rows.map(({ refType, refId, ...r }) => ({ ...r, orderId: refType === 'ORDER' ? refId : null }));
    const result = paginated(data, page, limit, total);
    result.meta.nextCursor = hasMore && last ? encodeKeysetCursor(last) : null;
    return result;
  }

  /**
   * Đổi Ví → xu đã ngừng (PD-3, Q-03): TubuXu gộp vào Điểm Xanh. Route giữ một bản phát hành để
   * client cũ nhận 410 đọc được; không mở transaction, không trừ ví. Dòng sổ XU_CONVERT cũ giữ nguyên.
   */
  async convertToXu(): Promise<never> {
    throw new GoneException('Đổi Ví sang xu đã ngừng. Tiền trong Ví Tubu dùng để trả đơn.');
  }
}
