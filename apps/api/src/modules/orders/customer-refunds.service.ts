import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { CustomerRefundStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { paginated, skipTake } from '../../common/pagination';

/**
 * Hàng đợi hoàn tiền khách cuối của đơn CTV lên hộ (order_customer_refunds, tạo bởi
 * OrderReversalService). Dòng MANUAL_TRANSFER PENDING là tiền Tubu đang nợ khách không có tài khoản:
 * admin chuyển khoản theo SĐT rồi xác nhận ở đây để sổ khớp.
 */
@Injectable()
export class CustomerRefundsService {
  private readonly logger = new Logger(CustomerRefundsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async list(status: CustomerRefundStatus | undefined, page: number, limit: number) {
    const where: Prisma.OrderCustomerRefundWhereInput = status ? { status } : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.orderCustomerRefund.findMany({ where, orderBy: { createdAt: 'desc' }, ...skipTake(page, limit) }),
      this.prisma.orderCustomerRefund.count({ where }),
    ]);
    return paginated(items, page, limit, total);
  }

  async markPaid(adminId: string, id: string, opts: { bankRef?: string; note?: string } = {}) {
    const res = await this.prisma.orderCustomerRefund.updateMany({
      where: { id, method: 'MANUAL_TRANSFER', status: 'PENDING' },
      data: {
        status: 'COMPLETED',
        completedBy: adminId,
        completedAt: new Date(),
        ...(opts.bankRef?.trim() ? { bankRef: opts.bankRef.trim() } : {}),
        ...(opts.note?.trim() ? { adminNote: opts.note.trim() } : {}),
      },
    });
    if (res.count === 0) {
      throw new BadRequestException('Khoản hoàn không còn chờ chuyển khoản hoặc vừa được xử lý — vui lòng tải lại.');
    }
    this.logger.log(`Admin ${adminId} xác nhận đã chuyển khoản hoàn tiền khách ${id}.`);
    return this.prisma.orderCustomerRefund.findUniqueOrThrow({ where: { id } });
  }
}
