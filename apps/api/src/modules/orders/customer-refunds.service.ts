import { BadRequestException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import type { CustomerRefundKind, CustomerRefundStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { paginated, skipTake } from '../../common/pagination';
import { NotificationsService } from '../notifications/notifications.service';
import { applyWalletDelta } from '../wallet/wallet-ledger.service';
import { formatVnd, maskedBank, normalizeBankDetails, type BankDetails } from './refund-destination';
import { announceBankRefund } from './refund-queue';

/** Khoản khách thấy ở chi tiết đơn (không lộ cột nội bộ như completedBy). */
export interface MyRefundView {
  id: string;
  orderId: string;
  orderCode: string;
  kind: CustomerRefundKind;
  amount: number;
  method: 'WALLET' | 'MANUAL_TRANSFER';
  status: CustomerRefundStatus;
  bankName: string | null;
  bankAccountNo: string | null;
  bankAccountName: string | null;
  bankRef: string | null;
  completedAt: Date | null;
  createdAt: Date;
  /** Khách còn chọn/đổi được nơi nhận (chưa chuyển khoản). */
  canChooseDestination: boolean;
}

const MINE_SELECT = {
  id: true,
  orderId: true,
  orderCode: true,
  kind: true,
  amount: true,
  method: true,
  status: true,
  bankName: true,
  bankAccountNo: true,
  bankAccountName: true,
  bankRef: true,
  completedAt: true,
  createdAt: true,
} as const;

/**
 * Hàng đợi hoàn tiền thủ công (order_customer_refunds). Dòng MANUAL_TRANSFER PENDING là tiền Tubu đang nợ khách:
 * khách huỷ/trả đơn trả trước chọn nhận về ngân hàng, tiền về muộn cho đơn đã huỷ, hoặc khách cuối của đơn CTV lên hộ.
 * Admin chuyển khoản tay rồi xác nhận kèm mã giao dịch; khách được báo ở mỗi bước (D2).
 */
@Injectable()
export class CustomerRefundsService {
  private readonly logger = new Logger(CustomerRefundsService.name);

  constructor(
    private readonly prisma: PrismaService,
    // Optional: test dựng tay một tham số vẫn chạy; app thật luôn wiring (NotificationsModule @Global).
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  async list(status: CustomerRefundStatus | undefined, page: number, limit: number, kind?: CustomerRefundKind) {
    const where: Prisma.OrderCustomerRefundWhereInput = { ...(status ? { status } : {}), ...(kind ? { kind } : {}) };
    const [items, total] = await this.prisma.$transaction([
      // Hàng chờ: cũ nhất trước để khoản nợ khách lâu nhất không bị chìm.
      this.prisma.orderCustomerRefund.findMany({
        where,
        orderBy: { createdAt: status === 'PENDING' ? 'asc' : 'desc' },
        ...skipTake(page, limit),
      }),
      this.prisma.orderCustomerRefund.count({ where }),
    ]);
    return paginated(items, page, limit, total);
  }

  async markPaid(
    adminId: string,
    id: string,
    opts: { bankRef?: string; note?: string; bankName?: string; accountNumber?: string; accountName?: string } = {},
  ) {
    const bankRef = opts.bankRef?.trim();
    if (!bankRef) throw new BadRequestException('Vui lòng nhập mã giao dịch ngân hàng của lần chuyển khoản hoàn tiền.');
    const row = await this.prisma.orderCustomerRefund.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Không tìm thấy khoản hoàn tiền.');
    const typedBank = opts.accountNumber?.trim() ? normalizeBankDetails(opts) : null;
    // Khoản của khách có tài khoản (huỷ/trả/tiền về muộn) phải có tài khoản nhận; khoản khách cuối đơn CTV chuyển theo SĐT.
    if (row.kind !== 'END_CUSTOMER' && !row.bankAccountNo && !typedBank) {
      throw new BadRequestException('Khoản này chưa có tài khoản nhận. Nhập tài khoản khách cung cấp trước khi xác nhận.');
    }
    const res = await this.prisma.orderCustomerRefund.updateMany({
      where: { id, method: 'MANUAL_TRANSFER', status: 'PENDING' },
      data: {
        status: 'COMPLETED',
        completedBy: adminId,
        completedAt: new Date(),
        bankRef,
        ...(opts.note?.trim() ? { adminNote: opts.note.trim() } : {}),
        ...(typedBank
          ? { bankName: typedBank.bankName, bankAccountNo: typedBank.accountNumber, bankAccountName: typedBank.accountName }
          : {}),
      },
    });
    if (res.count === 0) {
      throw new BadRequestException('Khoản hoàn không còn chờ chuyển khoản hoặc vừa được xử lý — vui lòng tải lại.');
    }
    this.logger.log(`Admin ${adminId} xác nhận đã chuyển khoản hoàn tiền khách ${id} (mã GD ${bankRef}).`);
    const done = await this.prisma.orderCustomerRefund.findUniqueOrThrow({ where: { id } });
    if (done.userId) {
      await this.notifications
        ?.notify(done.userId, 'REFUND_BANK_COMPLETED', {
          order_code: done.orderCode,
          amount: formatVnd(done.amount),
          bank: maskedBank(done),
          bank_ref: bankRef,
        })
        .catch(() => undefined);
    }
    return done;
  }

  /** Các khoản hoàn của chính khách (mọi đơn hoặc một đơn) — hiện ở chi tiết đơn. */
  async listMine(userId: string, orderId?: string): Promise<MyRefundView[]> {
    const rows = await this.prisma.orderCustomerRefund.findMany({
      where: { userId, ...(orderId ? { orderId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: MINE_SELECT,
    });
    return rows.map((r) => ({
      ...r,
      canChooseDestination: r.method === 'MANUAL_TRANSFER' && r.status === 'PENDING',
    }));
  }

  /** Tài khoản khách dùng gần nhất (khoản hoàn, yêu cầu trả, lệnh rút Ví) — để khách chọn lại thay vì gõ lại. */
  async lastBankDetails(userId: string): Promise<BankDetails | null> {
    const [refund, ret, payout] = await Promise.all([
      this.prisma.orderCustomerRefund.findFirst({
        where: { userId, bankAccountNo: { not: null } },
        orderBy: { createdAt: 'desc' },
        select: { bankName: true, bankAccountNo: true, bankAccountName: true, createdAt: true },
      }),
      this.prisma.returnRequest.findFirst({
        where: { userId, bankAccountNo: { not: null } },
        orderBy: { createdAt: 'desc' },
        select: { bankName: true, bankAccountNo: true, bankAccountName: true, createdAt: true },
      }),
      this.prisma.payout.findFirst({
        where: { userId, method: 'BANK' },
        orderBy: { requestedAt: 'desc' },
        select: { bankInfo: true, requestedAt: true },
      }),
    ]);
    const candidates: (BankDetails & { at: Date })[] = [];
    for (const r of [refund, ret]) {
      if (r?.bankAccountNo) {
        candidates.push({ bankName: r.bankName ?? '', accountNumber: r.bankAccountNo, accountName: r.bankAccountName ?? '', at: r.createdAt });
      }
    }
    const info = payout?.bankInfo as { bankName?: unknown; accountNumber?: unknown; accountName?: unknown } | null | undefined;
    if (payout && info && typeof info.accountNumber === 'string' && info.accountNumber) {
      candidates.push({
        bankName: typeof info.bankName === 'string' ? info.bankName : '',
        accountNumber: info.accountNumber,
        accountName: typeof info.accountName === 'string' ? info.accountName : '',
        at: payout.requestedAt,
      });
    }
    const best = candidates.sort((a, b) => b.at.getTime() - a.at.getTime())[0];
    return best ? { bankName: best.bankName, accountNumber: best.accountNumber, accountName: best.accountName } : null;
  }

  /**
   * Khách chọn (hoặc đổi) nơi nhận một khoản còn chờ chuyển khoản: Ví Tubu (cộng ngay, khoản đóng) hoặc tài khoản
   * ngân hàng (ghi tài khoản, admin chuyển). Guard (PENDING, MANUAL_TRANSFER) trong cùng câu ghi: admin vừa xác nhận
   * đã chuyển thì lần chọn Ví thua, không cộng tiền lần hai.
   */
  async chooseDestination(
    userId: string,
    id: string,
    input: { refundMethod: 'WALLET' | 'BANK'; bankName?: string; accountNumber?: string; accountName?: string },
  ): Promise<MyRefundView> {
    const row = await this.prisma.orderCustomerRefund.findUnique({ where: { id } });
    if (!row || row.userId !== userId) throw new NotFoundException('Không tìm thấy khoản hoàn tiền.');
    if (row.method !== 'MANUAL_TRANSFER' || row.status !== 'PENDING') {
      throw new BadRequestException('Khoản hoàn này đã được xử lý, không đổi được nơi nhận nữa.');
    }

    if (input.refundMethod === 'WALLET') {
      const won = await this.prisma.$transaction(async (tx) => {
        const flip = await tx.orderCustomerRefund.updateMany({
          where: { id, userId, method: 'MANUAL_TRANSFER', status: 'PENDING' },
          data: { method: 'WALLET', status: 'COMPLETED', customerUserId: userId, completedAt: new Date() },
        });
        if (flip.count === 0) return false;
        await applyWalletDelta(tx, {
          userId,
          delta: row.amount,
          type: 'ORDER_REFUND',
          refType: 'CUSTOMER_REFUND',
          refId: id,
          reason: `Hoàn tiền đơn ${row.orderCode}`,
        });
        return true;
      });
      if (!won) throw new BadRequestException('Khoản hoàn này vừa được xử lý — vui lòng tải lại.');
      await this.notifications
        ?.notify(userId, 'REFUND_WALLET_CREDITED', { order_code: row.orderCode, amount: formatVnd(row.amount) })
        .catch(() => undefined);
    } else {
      const bank = normalizeBankDetails(input);
      const res = await this.prisma.orderCustomerRefund.updateMany({
        where: { id, userId, method: 'MANUAL_TRANSFER', status: 'PENDING' },
        data: { bankName: bank.bankName, bankAccountNo: bank.accountNumber, bankAccountName: bank.accountName },
      });
      if (res.count === 0) throw new BadRequestException('Khoản hoàn này vừa được xử lý — vui lòng tải lại.');
      await announceBankRefund(
        { prisma: this.prisma, notifications: this.notifications, logger: this.logger },
        { orderCode: row.orderCode, amount: row.amount, userId, bankName: bank.bankName, bankAccountNo: bank.accountNumber },
      );
    }
    const fresh = await this.prisma.orderCustomerRefund.findUniqueOrThrow({ where: { id }, select: MINE_SELECT });
    return { ...fresh, canChooseDestination: fresh.method === 'MANUAL_TRANSFER' && fresh.status === 'PENDING' };
  }
}
