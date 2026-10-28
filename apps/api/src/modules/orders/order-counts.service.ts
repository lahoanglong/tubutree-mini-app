import { Injectable } from '@nestjs/common';
import type { OrderStatus } from '@tubutree/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { ORDER_STATUS_GROUPS } from './order-status-groups';

/**
 * Nhóm trạng thái của từng tab trang Đơn hàng, theo đúng bộ lọc `status`/`group` mà tab gửi cho GET /orders
 * (nhóm gộp lấy từ `ORDER_STATUS_GROUPS` để danh sách và số đếm không lệch nhau).
 */
export const ORDER_COUNT_GROUPS = {
  pending_payment: ['PENDING_PAYMENT'],
  processing: ORDER_STATUS_GROUPS.processing,
  shipping: ['SHIPPING'],
  delivered: ['DELIVERED'],
  closed: ORDER_STATUS_GROUPS.closed,
} as const satisfies Record<string, readonly OrderStatus[]>;

export type OrderStatusCounts = Record<keyof typeof ORDER_COUNT_GROUPS, number>;

@Injectable()
export class OrderCountsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Số đơn của khách theo từng tab trong một truy vấn, thay cho một lời gọi GET /orders?limit=1 mỗi tab. */
  async statusCounts(userId: string): Promise<OrderStatusCounts> {
    const rows = await this.prisma.order.groupBy({ by: ['status'], where: { userId }, _count: { _all: true } });
    const byStatus = new Map<string, number>(rows.map((r) => [r.status, r._count._all]));
    const out = {} as OrderStatusCounts;
    for (const key of Object.keys(ORDER_COUNT_GROUPS) as (keyof OrderStatusCounts)[]) {
      out[key] = ORDER_COUNT_GROUPS[key].reduce((sum, status) => sum + (byStatus.get(status) ?? 0), 0);
    }
    return out;
  }
}
