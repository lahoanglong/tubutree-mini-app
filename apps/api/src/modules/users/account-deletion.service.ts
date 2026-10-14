import { randomBytes } from 'node:crypto';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/** Mã lỗi ổn định để admin UI nhận diện (message tiếng Việt có thể đổi câu chữ). */
export const ACCOUNT_DELETION_BLOCKED = 'ACCOUNT_DELETION_BLOCKED';
export const ANONYMIZED_NAME = 'Người dùng đã xoá';

export type DeletionBlockerCode =
  | 'PRIVILEGED_ROLE'
  | 'WALLET_BALANCE'
  | 'CONVERTED_POINTS'
  | 'CASHBACK_PENDING'
  | 'ORDER_IN_PROGRESS'
  | 'PAYOUT_PENDING'
  | 'RETURN_PENDING'
  | 'CUSTOMER_REFUND_PENDING'
  | 'SUBSCRIPTION_ACTIVE'
  | 'COMMISSION_UNPAID'
  | 'DEALER_CREDIT';

export interface DeletionBlocker {
  code: DeletionBlockerCode;
  message: string;
}

export type DeletionListStatus = 'PENDING' | 'RESOLVED' | 'ALL';

type Db = Prisma.TransactionClient;

type BlockerUser = {
  id: string;
  role: string;
  walletBalance: number;
  pointsConvertedBalance: number;
  cashbackPending: number;
};

const OPEN_ORDER_STATUSES = ['PENDING_PAYMENT', 'CONFIRMED', 'PACKED', 'SHIPPING'] as const;

const vnd = (n: number) => `${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}đ`;

/**
 * C-016 / A1-017: xử lý yêu cầu xoá tài khoản bằng ẨN DANH chứ không xoá cứng — đơn, hoa hồng, sổ Ví,
 * lệnh rút, công nợ đại lý là chứng từ kế toán/thuế phải giữ và đang trỏ khoá ngoại về users. Chỉ thay
 * các trường nhận diện được con người (tên, SĐT, email, ngày sinh, ảnh, zaloId, địa chỉ, CCCD, tài khoản
 * ngân hàng gian hàng) và khoá đăng nhập.
 * Cố ý GIỮ: lệnh rút (Payout.bankInfo) và hoàn tiền đơn (OrderCustomerRefund) vì là chứng từ chi tiền
 * phải đối soát được; MST/tên công ty/địa chỉ trong yêu cầu hoá đơn vì hoá đơn VAT đã/sẽ xuất phải lưu
 * theo luật kế toán (chỉ bỏ email liên hệ).
 * isBlocked làm JwtStrategy từ chối access token đã cấp (trễ tối đa SessionStateService.TTL_MS) và chặn
 * cấp token mới; refresh token bị thu hồi.
 */
@Injectable()
export class AccountDeletionService {
  private readonly logger = new Logger(AccountDeletionService.name);

  constructor(private readonly prisma: PrismaService) {}

  async list(status: DeletionListStatus = 'PENDING') {
    const requests = await this.prisma.accountDeletionRequest.findMany({
      where: status === 'ALL' ? {} : { status },
      orderBy: { createdAt: status === 'PENDING' ? 'asc' : 'desc' },
      take: 100,
    });
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(requests.map((r) => r.userId))] } },
      select: {
        id: true,
        fullName: true,
        phone: true,
        role: true,
        walletBalance: true,
        pointsConvertedBalance: true,
        cashbackPending: true,
        createdAt: true,
      },
    });
    const byId = new Map(users.map((u) => [u.id, u]));
    const pendingUsers = users.filter((u) => requests.some((r) => r.userId === u.id && r.status === 'PENDING'));
    const blockers = pendingUsers.length > 0 ? await this.collectBlockers(this.prisma, pendingUsers) : new Map();
    return requests.map((r) => ({
      ...r,
      user: byId.get(r.userId) ?? null,
      blockers: r.status === 'PENDING' ? (blockers.get(r.userId) ?? []) : [],
    }));
  }

  /**
   * Idempotent: yêu cầu đã RESOLVED thì trả `alreadyProcessed: true`, không chạy lại. Khoá dòng yêu
   * cầu rồi dòng user (FOR UPDATE) để 2 admin cùng bấm thì người sau chờ và thấy RESOLVED, còn các ghi
   * tiền vào users (vd cộng Ví) phải chờ lần kiểm số dư này xong.
   */
  async process(requestId: string, adminId: string, adminNote?: string) {
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "account_deletion_requests" WHERE "id" = ${requestId} FOR UPDATE`;
      if (locked.length === 0) throw new NotFoundException('Không tìm thấy yêu cầu xoá tài khoản.');
      const request = await tx.accountDeletionRequest.findUniqueOrThrow({ where: { id: requestId } });
      if (request.status === 'RESOLVED') {
        return { alreadyProcessed: true, requestId, userId: request.userId, reviewedAt: request.reviewedAt };
      }

      await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${request.userId} FOR UPDATE`;
      const user = await tx.user.findUnique({ where: { id: request.userId } });
      const now = new Date();

      if (user) {
        const blockers = (await this.collectBlockers(tx, [user])).get(user.id) ?? [];
        if (blockers.length > 0) {
          throw new BadRequestException({
            statusCode: 400,
            error: 'Bad Request',
            code: ACCOUNT_DELETION_BLOCKED,
            message: `Chưa thể xoá tài khoản: ${blockers.map((b) => b.message).join('; ')}.`,
            blockers,
          });
        }
        await this.anonymize(tx, user.id, requestId, now);
      } else {
        this.logger.warn(`Yêu cầu xoá ${requestId}: không còn user ${request.userId}, chỉ đóng yêu cầu.`);
      }

      const note = adminNote?.trim() || null;
      await tx.accountDeletionRequest.updateMany({
        where: { userId: request.userId, status: 'PENDING' },
        data: { status: 'RESOLVED', reviewedBy: adminId, reviewedAt: now, adminNote: note },
      });
      return { alreadyProcessed: false, requestId, userId: request.userId, reviewedAt: now };
    });
  }

  /** Gom bằng groupBy (cố định 8 truy vấn) thay vì 8 truy vấn × mỗi dòng: danh sách admin tới 100 dòng. */
  private async collectBlockers(db: Db, users: BlockerUser[]): Promise<Map<string, DeletionBlocker[]>> {
    const ids = users.map((u) => u.id);
    const [orders, payouts, returns, refunds, subs, commissions, cashbackTxns, dealerCredit] = await Promise.all([
      db.order.groupBy({
        by: ['userId'],
        where: { userId: { in: ids }, status: { in: [...OPEN_ORDER_STATUSES] } },
        _count: { _all: true },
      }),
      db.payout.groupBy({
        by: ['userId'],
        where: { userId: { in: ids }, status: { in: ['REQUESTED', 'APPROVED'] } },
        _count: { _all: true },
      }),
      db.returnRequest.groupBy({
        by: ['userId'],
        where: { userId: { in: ids }, status: 'REQUESTED' },
        _count: { _all: true },
      }),
      db.orderCustomerRefund.findMany({
        where: { status: { in: ['PENDING', 'PROCESSING'] }, OR: [{ customerUserId: { in: ids } }, { order: { userId: { in: ids } } }] },
        select: { customerUserId: true, order: { select: { userId: true } } },
      }),
      db.subscription.groupBy({
        by: ['userId'],
        where: { userId: { in: ids }, status: { in: ['ACTIVE', 'PAUSED'] } },
        _count: { _all: true },
      }),
      db.commission.groupBy({
        by: ['affiliateUserId'],
        where: {
          affiliateUserId: { in: ids },
          OR: [{ status: { in: ['PENDING', 'LOCKED'] } }, { status: 'APPROVED', payoutBatchId: null }],
        },
        _count: { _all: true },
      }),
      db.cashbackTransaction.groupBy({
        by: ['userId'],
        where: { userId: { in: ids }, status: { in: ['PENDING', 'CONFIRMED'] } },
        _count: { _all: true },
      }),
      db.dealerCreditLedger.groupBy({ by: ['userId'], where: { userId: { in: ids } }, _sum: { delta: true } }),
    ]);

    const countBy = <K extends string>(rows: ({ _count: { _all: number } } & Record<K, string>)[], key: K) =>
      new Map(rows.map((r) => [r[key], r._count._all]));
    const orderN = countBy(orders, 'userId');
    const payoutN = countBy(payouts, 'userId');
    const returnN = countBy(returns, 'userId');
    const subN = countBy(subs, 'userId');
    const commissionN = countBy(commissions, 'affiliateUserId');
    const cashbackN = countBy(cashbackTxns, 'userId');
    const creditSum = new Map(dealerCredit.map((r) => [r.userId, r._sum.delta ?? 0]));
    const refundN = new Map<string, number>();
    for (const r of refunds) {
      for (const uid of new Set([r.customerUserId, r.order.userId])) {
        if (uid && ids.includes(uid)) refundN.set(uid, (refundN.get(uid) ?? 0) + 1);
      }
    }

    const result = new Map<string, DeletionBlocker[]>();
    for (const user of users) {
      const out: DeletionBlocker[] = [];
      const add = (code: DeletionBlockerCode, message: string) => out.push({ code, message });
      const n = (m: Map<string, number>) => m.get(user.id) ?? 0;
      if (user.role === 'ADMIN' || user.role === 'STAFF') {
        add('PRIVILEGED_ROLE', 'tài khoản đang có quyền quản trị/nhân viên, cần gỡ quyền trước');
      }
      if (user.walletBalance > 0) add('WALLET_BALANCE', `Ví Tubu còn ${vnd(user.walletBalance)}, khách cần rút hết trước`);
      if (user.walletBalance < 0) add('WALLET_BALANCE', `Ví Tubu đang âm ${vnd(-user.walletBalance)}, cần đối soát trước`);
      // Q-03a: lô quy đổi là tiền trả trước nhưng không quy ra tiền được, nên không có cách tất toán
      // nào khác ngoài để khách tiêu hết (OQ-14).
      if (user.pointsConvertedBalance > 0) {
        add('CONVERTED_POINTS', `còn ${user.pointsConvertedBalance} Điểm Xanh không hết hạn chưa dùng`);
      }
      if (user.cashbackPending > 0 || n(cashbackN) > 0) add('CASHBACK_PENDING', 'còn khoản hoàn tiền mua sắm đang chờ');
      if (n(orderN) > 0) add('ORDER_IN_PROGRESS', `còn ${n(orderN)} đơn hàng chưa hoàn tất (chờ thanh toán/đang xử lý/đang giao)`);
      if (n(payoutN) > 0) add('PAYOUT_PENDING', `còn ${n(payoutN)} yêu cầu rút tiền chờ xử lý`);
      if (n(returnN) > 0) add('RETURN_PENDING', `còn ${n(returnN)} yêu cầu đổi trả chờ duyệt`);
      if (n(refundN) > 0) add('CUSTOMER_REFUND_PENDING', `còn ${n(refundN)} khoản hoàn tiền đơn chưa chuyển`);
      if (n(subN) > 0) add('SUBSCRIPTION_ACTIVE', `còn ${n(subN)} gói giao định kỳ đang chạy hoặc tạm dừng`);
      if (n(commissionN) > 0) add('COMMISSION_UNPAID', `còn ${n(commissionN)} khoản hoa hồng chưa trả`);
      const credit = creditSum.get(user.id) ?? 0;
      if (credit !== 0) add('DEALER_CREDIT', `công nợ đại lý chưa tất toán (${credit < 0 ? '-' : ''}${vnd(Math.abs(credit))})`);
      result.set(user.id, out);
    }
    return result;
  }

  private async anonymize(tx: Db, userId: string, requestId: string, now: Date) {
    await tx.user.update({
      where: { id: userId },
      data: {
        fullName: ANONYMIZED_NAME,
        phone: null,
        email: null,
        dob: null,
        avatarUrl: null,
        personalTaxId: null,
        zaloId: null,
        zaloAccessToken: null,
        zaloRefreshToken: null,
        isBlocked: true,
        // Link/mã giới thiệu cũ còn lưu ngoài kia sẽ tiếp tục ghi công (tạo hoa hồng PENDING không ai
        // nhận được) nếu giữ mã; đổi sang mã ngẫu nhiên không đoán được để mọi tra cứu theo mã cũ trượt.
        referralCode: `DEL${randomBytes(8).toString('hex').toUpperCase()}`,
        metadata: { anonymizedAt: now.toISOString(), deletionRequestId: requestId },
      },
    });
    await tx.referralTouch.updateMany({ where: { referrerUserId: userId, expiresAt: { gt: now } }, data: { expiresAt: now } });
    // Giữ dòng địa chỉ (gói định kỳ đã huỷ vẫn trỏ FK RESTRICT tới) nhưng xoá phần nhận diện; tỉnh/huyện
    // giữ lại vì đơn cũ và thống kê vùng giao còn dùng, một mình chúng không chỉ ra được ai.
    await tx.address.updateMany({ where: { userId }, data: { recipient: ANONYMIZED_NAME, phone: '', street: '' } });
    await tx.$executeRaw`
      UPDATE "orders"
      SET "shippingAddress" = "shippingAddress" || jsonb_build_object('recipient', ${ANONYMIZED_NAME}::text, 'phone', '', 'street', '')
      WHERE "userId" = ${userId} AND jsonb_typeof("shippingAddress") = 'object'`;
    await tx.order.updateMany({ where: { userId }, data: { note: null, recyclingNote: null } });
    await tx.$executeRaw`
      UPDATE "orders" SET "invoiceRequest" = "invoiceRequest" - 'email'
      WHERE "userId" = ${userId} AND jsonb_typeof("invoiceRequest") = 'object'`;
    await tx.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } });
    await tx.dealerApplication.updateMany({
      where: { userId },
      data: { ownerName: ANONYMIZED_NAME, phone: '', address: '', cccdFrontUrl: '', cccdBackUrl: '', storeFrontUrl: null },
    });
    await tx.storefront.updateMany({
      where: { ownerUserId: userId },
      data: {
        isPublished: false,
        title: ANONYMIZED_NAME,
        headerNote: null,
        avatarUrl: null,
        coverUrl: null,
        bankName: null,
        bankBin: null,
        bankAccountNo: null,
        bankAccountName: null,
        warehouseAddress: null,
        warehousePhone: null,
      },
    });
  }
}
